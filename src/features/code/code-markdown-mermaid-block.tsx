// 代码工作区 Markdown 预览中的单个 mermaid 围栏块。
//
// 客户端将源码渲染为静态只读 SVG；主题跟随 light/dark；失败时仅本块错误态。

import { useEffect, useId, useState } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import {
  MERMAID_STRICT_CONFIG,
  normalizeMermaidSource,
  toMermaidTheme,
  type CodeMarkdownTheme,
} from "./code-markdown-mermaid-helpers";

export interface CodeMarkdownMermaidBlockProps {
  source: string;
  theme: CodeMarkdownTheme;
}

type MermaidRenderState =
  | { status: "loading" }
  | { status: "ready"; svg: string }
  | { status: "error" };

export function CodeMarkdownMermaidBlock({
  source,
  theme,
}: CodeMarkdownMermaidBlockProps) {
  const { messages } = useI18n();
  const reactId = useId().replace(/:/g, "");
  const [state, setState] = useState<MermaidRenderState>({ status: "loading" });
  const normalizedSource = normalizeMermaidSource(source);

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram(): Promise<void> {
      setState({ status: "loading" });
      try {
        const mermaidModule = await import("mermaid");
        const mermaid = mermaidModule.default;
        mermaid.initialize({
          ...MERMAID_STRICT_CONFIG,
          theme: toMermaidTheme(theme),
        });
        const renderId = `code-mermaid-${reactId}-${Date.now().toString(36)}`;
        const result = await mermaid.render(renderId, normalizedSource);
        if (!cancelled) {
          setState({ status: "ready", svg: result.svg });
        }
      } catch {
        if (!cancelled) {
          setState({ status: "error" });
        }
      }
    }

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [normalizedSource, reactId, theme]);

  if (state.status === "error") {
    return (
      <div
        className="code-workspace__mermaid-error"
        data-testid="code-mermaid-error"
        role="alert"
      >
        <p className="code-workspace__mermaid-error-message">
          {messages.agentsFeature.mermaidRenderFailed}
        </p>
        <pre className="agents-message__code-block">
          <code className="language-mermaid">{normalizedSource}</code>
        </pre>
      </div>
    );
  }

  if (state.status === "ready") {
    return (
      <div
        className="code-workspace__mermaid"
        data-testid="code-mermaid-diagram"
        // mermaid 在 securityLevel=strict 下输出静态 SVG；禁止 htmlLabels。
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    );
  }

  return (
    <div
      className="code-workspace__mermaid code-workspace__mermaid--loading"
      data-testid="code-mermaid-loading"
      aria-busy="true"
    />
  );
}
