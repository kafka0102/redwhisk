// 代码工作区 Markdown 只读预览。
//
// 使用 react-markdown + remark-gfm 渲染 GFM 内容（标题、列表、代码块、外链等）。
// 样式复用 agents-message 的 Markdown 类名，保持与既有预览视觉一致。
// 后续 Mermaid 叠加仅扩展本组件，不改 AgentMarkdown / Issue 只读路径。

import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import { memo } from "react";

const components: Components = {
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
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

export interface CodeMarkdownPreviewProps {
  content: string;
}

export const CodeMarkdownPreview = memo(function CodeMarkdownPreview({
  content,
}: CodeMarkdownPreviewProps) {
  return (
    <div className="agents-message__markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
