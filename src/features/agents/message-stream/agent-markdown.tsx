// Agent 消息文本的 Markdown 渲染封装。
//
// 使用 react-markdown + remark-gfm 渲染 assistant 消息（含代码块、列表、表格、
// 删除线、任务列表）。自定义 code/a 渲染以贴合 RedWhisk 设计系统（等宽代码块、
// 外链新标签页）。不引入语法高亮，首版只要可读。

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

interface AgentMarkdownProps {
  children: string;
}

export const AgentMarkdown = memo(function AgentMarkdown({
  children,
}: AgentMarkdownProps) {
  return (
    <div className="agents-message__markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
});
