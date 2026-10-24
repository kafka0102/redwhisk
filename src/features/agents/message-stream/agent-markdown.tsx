// Agent 消息文本的 Markdown 渲染封装。
//
// 使用 react-markdown + remark-gfm 渲染 assistant 消息（含代码块、列表、表格、
// 删除线、任务列表）。自定义 code/a 渲染以贴合 RedWhisk 设计系统（等宽代码块）。
// 链接按三态分类：http(s) 新标签页打开；工作区内文件路径交给侧栏
// `SessionFileViewer`（`sessionFileLinks.openFilePath`，不做 `_blank`）；
// 解析不了的保持纯文本，不外泄原始指令。不引入语法高亮，首版只要可读。

import remarkGfm from "remark-gfm";
import type { TFunction } from "i18next";
import type { Components } from "react-markdown";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import { memo, useMemo } from "react";

import { useI18n } from "../../../shared/i18n/i18n";
import {
  parseFileReference,
  resolveWorkspaceRelativePath,
  type SessionFileLinks,
} from "./session-file-links";

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
      if (isInline) {
        return <code className="agents-message__code-inline">{children}</code>;
      }
      return (
        <pre className="agents-message__code-block">
          <code className={className}>{children}</code>
        </pre>
      );
    },
  };
}

interface AgentMarkdownProps {
  children: string;
  /** 本地文件链接能力；缺失时本地路径只显示文本（不接管链接）。 */
  sessionFileLinks?: SessionFileLinks;
}

export const AgentMarkdown = memo(function AgentMarkdown({
  children,
  sessionFileLinks,
}: AgentMarkdownProps) {
  const { t } = useI18n();
  const components = useMemo(
    () => createMarkdownComponents(sessionFileLinks, t),
    [sessionFileLinks, t],
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
