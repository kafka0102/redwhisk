// 代码工作区 Markdown 只读预览。
//
// 使用 react-markdown + remark-gfm 渲染 GFM 内容（标题、列表、代码块、外链等）。
// language 为 mermaid 的围栏块走专用静态 SVG 渲染；其它代码块保持普通 pre/code。
// 样式复用 agents-message 的 Markdown 类名，保持与既有预览视觉一致。
// 不改 AgentMarkdown / Issue 只读路径。

import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import { memo, useMemo } from "react";

import { CodeMarkdownMermaidBlock } from "./code-markdown-mermaid-block";
import {
  codeChildrenToText,
  isMermaidLanguage,
  type CodeMarkdownTheme,
} from "./code-markdown-mermaid-helpers";

export interface CodeMarkdownPreviewProps {
  content: string;
  theme: CodeMarkdownTheme;
}

function createMarkdownComponents(theme: CodeMarkdownTheme): Components {
  return {
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
    // code 组件自行输出 block 级 pre；避免 mermaid 容器再被外层 pre 包裹。
    pre({ children }) {
      return <>{children}</>;
    },
    code(props) {
      const { className, children } = props;
      const isInline =
        typeof className !== "string" || !className.includes("language-");
      if (isInline) {
        return <code className="agents-message__code-inline">{children}</code>;
      }
      if (isMermaidLanguage(className)) {
        return (
          <CodeMarkdownMermaidBlock
            source={codeChildrenToText(children)}
            theme={theme}
          />
        );
      }
      return (
        <pre className="agents-message__code-block">
          <code className={className}>{children}</code>
        </pre>
      );
    },
  };
}

export const CodeMarkdownPreview = memo(function CodeMarkdownPreview({
  content,
  theme,
}: CodeMarkdownPreviewProps) {
  const components = useMemo(() => createMarkdownComponents(theme), [theme]);

  return (
    <div className="agents-message__markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
