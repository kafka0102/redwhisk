// Agent 消息文本的 Markdown 渲染封装。
//
// 使用 react-markdown + remark-gfm 渲染 assistant 消息（含代码块、列表、表格、
// 删除线、任务列表）。自定义 code/a 渲染以贴合 RedWhisk 设计系统（等宽代码块）。
// 链接按三态分类：http(s) 新标签页打开；工作区内文件路径交给侧栏
// `SessionFileViewer`（`sessionFileLinks.openFilePath`，不做 `_blank`）；
// 解析不了的保持纯文本，不外泄原始指令。不引入语法高亮，首版只要可读。
// 行内代码里的工作区相对路径先做语法判定，再经后端存在性检查确认后才变成可点元素，
// 不存在的路径保持普通 `<code>`。

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
import {
  parseFileReference,
  resolveWorkspaceRelativePath,
  type SessionFileLinks,
} from "./session-file-links";
import { useWorkspaceFileExistence } from "./use-workspace-file-existence";

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
    code(props) {
      // react-markdown v10 把 inline/block 都走 code；通过 className 区分行内。
      const { className, children } = props;
      const isInline =
        typeof className !== "string" || !className.includes("language-");
      if (!isInline) {
        return (
          <pre className="agents-message__code-block">
            <code className={className}>{children}</code>
          </pre>
        );
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
