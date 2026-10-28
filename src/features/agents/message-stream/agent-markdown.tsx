// Agent 消息文本的 Markdown 渲染封装。
//
// 使用 react-markdown + remark-gfm 渲染 assistant 消息（含代码块、列表、表格、
// 删除线、任务列表）。自定义 a / pre / code / table 渲染以贴合 RedWhisk 设计系统。
// 链接按三态分类：http(s) 新标签页打开；工作区内文件路径交给侧栏
// `SessionFileViewer`（`sessionFileLinks.openFilePath`，不做 `_blank`）；
// 解析不了的保持纯文本，不外泄原始指令。
// 行内代码里的工作区相对路径先做语法判定，再经后端存在性检查确认后才变成可点元素，
// 不存在的路径保持普通 `<code>`。
// 围栏代码交给 `MessageCodeBlock`（语法高亮 + 复制按钮）；围栏与行内的分流放在
// `pre` 渲染器里，避免外层 `<pre>` 与代码块自带的 `<pre>` 叠成两层。

import remarkGfm from "remark-gfm";
import type { TFunction } from "i18next";
import type { Components } from "react-markdown";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import { memo, useMemo } from "react";

import { useI18n } from "../../../shared/i18n/i18n";
import {
  extractInlineCodeTexts,
  resolveInlineCodeFilePath,
} from "./inline-code-kind";
import { MessageCodeBlock } from "./message-code-block";
import {
  parseFileReference,
  resolveWorkspaceRelativePath,
  type SessionFileLinks,
} from "./session-file-links";
import { useWorkspaceFileExistence } from "./use-workspace-file-existence";

/** 约 36 个汉字。宽字符计 2，其余计 1。 */
const TABLE_COLUMN_CAP_UNITS = 72;

const WIDE_CODE_POINT_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0x303e],
  [0x3040, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
];

interface MarkdownTreeNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: MarkdownTreeNode[];
}

function isWideCodePoint(codePoint: number): boolean {
  return WIDE_CODE_POINT_RANGES.some(
    ([start, end]) => codePoint >= start && codePoint <= end,
  );
}

function halfwidthUnits(text: string): number {
  let units = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    units += codePoint !== undefined && isWideCodePoint(codePoint) ? 2 : 1;
  }
  return units;
}

function visibleTextFromNode(node: MarkdownTreeNode): string {
  if (node.type === "text") {
    return node.value ?? "";
  }
  return (node.children ?? []).map(visibleTextFromNode).join("");
}

function elementChildren(node: MarkdownTreeNode): MarkdownTreeNode[] {
  return (node.children ?? []).filter((child) => child.type === "element");
}

function tableRows(table: MarkdownTreeNode): MarkdownTreeNode[] {
  const rows: MarkdownTreeNode[] = [];
  for (const section of elementChildren(table)) {
    if (section.tagName === "tr") {
      rows.push(section);
      continue;
    }
    for (const row of elementChildren(section)) {
      if (row.tagName === "tr") {
        rows.push(row);
      }
    }
  }
  return rows;
}

function rowCells(row: MarkdownTreeNode): MarkdownTreeNode[] {
  return elementChildren(row).filter(
    (cell) => cell.tagName === "th" || cell.tagName === "td",
  );
}

function columnContentUnits(text: readonly string[]): number {
  const widest = text.reduce(
    (max, cell) => Math.max(max, halfwidthUnits(cell)),
    0,
  );
  return Math.min(TABLE_COLUMN_CAP_UNITS, widest);
}

function columnWidths(table: MarkdownTreeNode): number[] {
  const rows = tableRows(table);
  const header = rows[0];
  if (header === undefined) {
    return [];
  }
  const body = rows.slice(1);
  return rowCells(header).map((headerCell, index) =>
    columnContentUnits([
      visibleTextFromNode(headerCell).trim(),
      ...body.map((row) =>
        visibleTextFromNode(
          rowCells(row)[index] ?? { type: "element", children: [] },
        ).trim(),
      ),
    ]),
  );
}

function markdownTreeNode(node: unknown): MarkdownTreeNode | null {
  if (typeof node !== "object" || node === null || !("type" in node)) {
    return null;
  }
  const record = node as { type: unknown };
  if (record.type !== "element") {
    return null;
  }
  return node as MarkdownTreeNode;
}

function tableCellAlign(align: unknown): "center" | "right" | undefined {
  if (align === "center" || align === "right") {
    return align;
  }
  return undefined;
}

/**
 * react-markdown 默认只放行 http(s) / mailto 等白名单协议，`file:` 会被清成空串，
 * 链接分类就再也看不到原始目标。这里只对 `file:` 放行，其余仍走默认规则：
 * `file:` 目标在我们的渲染里只会变成按钮或纯文本，不会被当作 `<a href>` 透出。
 */
function transformUrl(url: string): string {
  return /^file:/i.test(url) ? url : defaultUrlTransform(url);
}

/**
 * 构造 react-markdown 的组件映射。
 *
 * `sessionFileLinks` 缺失（Issue 时间轴、TUI 归档回看等复用方）时不接管本地路径，
 * 本地路径回落纯文本。
 */
function createMarkdownComponents(
  sessionFileLinks: SessionFileLinks | undefined,
  isWorkspaceFilePath: (relativePath: string) => boolean,
  t: TFunction,
): Components {
  return {
    a({ href, children }) {
      const reference = href === undefined ? null : parseFileReference(href);
      if (reference?.kind === "external") {
        return (
          <a href={reference.href} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      }

      const filePath =
        reference?.kind === "local" && sessionFileLinks !== undefined
          ? resolveWorkspaceRelativePath(
              reference.path,
              sessionFileLinks.workspacePath,
              sessionFileLinks.homePath,
            )
          : null;
      if (filePath === null || sessionFileLinks === undefined) {
        // 解析不了的链接不带 href，也不把原始指令（如 :codex-file-citation）显示出来。
        return <span>{children}</span>;
      }

      return (
        <button
          type="button"
          className="agents-message__file-link"
          aria-label={t("agentsFeature.openWorkspaceFileLink", {
            path: filePath,
          })}
          onClick={() => sessionFileLinks.openFilePath(filePath)}
        >
          {children}
        </button>
      );
    },
    ol({ children, start }) {
      return (
        <ol className="agents-message__ordered-list" start={start}>
          {children}
        </ol>
      );
    },
    ul({ children }) {
      return <ul className="agents-message__unordered-list">{children}</ul>;
    },
    table({ children, node }) {
      const tree = markdownTreeNode(node);
      const widths = tree === null ? [] : columnWidths(tree);
      return (
        <div className="agents-message__table-scroll">
          <table className="agents-message__table">
            <colgroup>
              {widths.map((units, index) => (
                <col
                  key={index}
                  style={{ width: `${units}ch`, minWidth: `${units}ch` }}
                />
              ))}
            </colgroup>
            {children}
          </table>
        </div>
      );
    },
    th({ children, node }) {
      const textAlign = tableCellAlign(node?.properties?.align);
      return (
        <th
          className="agents-message__table-cell agents-message__table-head"
          style={textAlign === undefined ? undefined : { textAlign }}
        >
          {children}
        </th>
      );
    },
    td({ children, node }) {
      const textAlign = tableCellAlign(node?.properties?.align);
      return (
        <td
          className="agents-message__table-cell"
          style={textAlign === undefined ? undefined : { textAlign }}
        >
          {children}
        </td>
      );
    },
    // 围栏代码块由 `pre` 接管：react-markdown 只在围栏代码外生成 `<pre>`（行内代码
    // 没有这一层），所以「是不是围栏」只在这里判断 —— 只看 `code` 的 className 区分
    // 不出两者（没有 info string 的围栏不带 `language-*`）。围栏原文与 info string
    // 取自 `node`，避免外层 `<pre>` 与 `MessageCodeBlock` 自带的 `<pre>` 叠成两层。
    pre({ children, node }) {
      const codeElement = node?.children[0];
      if (codeElement?.type !== "element" || codeElement.tagName !== "code") {
        return <pre className="agents-message__code-block">{children}</pre>;
      }
      const rawText = codeElement.children[0];
      const rawClassName = codeElement.properties.className;
      return (
        <MessageCodeBlock
          className={
            Array.isArray(rawClassName) ? rawClassName.join(" ") : undefined
          }
          code={rawText?.type === "text" ? rawText.value : ""}
        />
      );
    },
    code({ className, children }) {
      // react-markdown v10 把 inline/block 都走 code；围栏代码已由上面的 `pre`
      // 渲染器接管，这里只渲染行内代码，非行内分支保留原有 `<code>` 结构。
      const isInline =
        typeof className !== "string" || !className.includes("language-");
      if (!isInline) {
        return <code className={className}>{children}</code>;
      }

      const inlineText = typeof children === "string" ? children : null;
      const filePath =
        inlineText === null
          ? null
          : inlineCodeFilePath(inlineText, sessionFileLinks);
      // 中间的 undefined 判定只为让 TS 收窄出 sessionFileLinks：
      // inlineCodeFilePath 返回非 null 时它必然已定义。
      if (
        filePath === null ||
        sessionFileLinks === undefined ||
        !isWorkspaceFilePath(filePath)
      ) {
        return <code className="agents-message__code-inline">{children}</code>;
      }

      const openFilePath = sessionFileLinks.openFilePath;
      return (
        <button
          type="button"
          className="agents-message__code-inline agents-message__code-inline--link"
          aria-label={t("agentsFeature.openWorkspaceFileLink", {
            path: filePath,
          })}
          onClick={() => openFilePath(filePath)}
        >
          {children}
        </button>
      );
    },
  };
}

interface AgentMarkdownProps {
  children: string;
  /** 本地文件链接能力；缺失时本地路径只显示文本（不接管链接）。 */
  sessionFileLinks?: SessionFileLinks;
}

/** 无候选路径时的稳定空数组，避免每次渲染换新引用导致探测 effect 重跑。 */
const NO_CANDIDATE_PATHS: readonly string[] = [];

/**
 * 单个行内代码 span → 工作区相对路径；不像路径、无法相对化或未接侧栏时返回 `null`。
 *
 * 渲染与候选收集共用这一处归一化，避免判定口径分叉。
 */
function inlineCodeFilePath(
  text: string,
  sessionFileLinks: SessionFileLinks | undefined,
): string | null {
  if (sessionFileLinks === undefined) {
    return null;
  }
  return resolveInlineCodeFilePath(
    text,
    sessionFileLinks.workspacePath,
    sessionFileLinks.homePath,
  );
}

/**
 * 从消息文本里扫出需要做存在性检查的工作区相对路径（去重）。
 *
 * 只有单反引号 span 参与，围栏代码块内的路径不探测。
 */
function collectCandidatePaths(
  markdown: string,
  sessionFileLinks: SessionFileLinks | undefined,
): readonly string[] {
  if (sessionFileLinks === undefined) {
    return NO_CANDIDATE_PATHS;
  }

  const paths = new Set<string>();
  for (const text of extractInlineCodeTexts(markdown)) {
    const filePath = inlineCodeFilePath(text, sessionFileLinks);
    if (filePath !== null) {
      paths.add(filePath);
    }
  }
  return paths.size === 0 ? NO_CANDIDATE_PATHS : [...paths];
}

export const AgentMarkdown = memo(function AgentMarkdown({
  children,
  sessionFileLinks,
}: AgentMarkdownProps) {
  const { t } = useI18n();
  const candidatePaths = useMemo(
    () => collectCandidatePaths(children, sessionFileLinks),
    [children, sessionFileLinks],
  );
  const isWorkspaceFilePath = useWorkspaceFileExistence(
    sessionFileLinks,
    candidatePaths,
  );
  const components = useMemo(
    () => createMarkdownComponents(sessionFileLinks, isWorkspaceFilePath, t),
    [isWorkspaceFilePath, sessionFileLinks, t],
  );

  return (
    <div className="agents-message__markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={transformUrl}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
