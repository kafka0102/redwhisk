// mermaid 围栏识别与严格配置（与 UI 组件分离，避免 react-refresh 限制）。

import type { ReactNode } from "react";

export const MERMAID_STRICT_CONFIG = {
  startOnLoad: false,
  securityLevel: "strict" as const,
  flowchart: { htmlLabels: false },
};

export type CodeMarkdownTheme = "light" | "dark";

export function toMermaidTheme(theme: CodeMarkdownTheme): "default" | "dark" {
  return theme === "dark" ? "dark" : "default";
}

export function normalizeMermaidSource(source: string): string {
  return source.replace(/\n$/, "");
}

export function isMermaidLanguage(className: string | undefined): boolean {
  if (typeof className !== "string") {
    return false;
  }
  const match = /language-(\S+)/i.exec(className);
  return match !== null && match[1].toLowerCase() === "mermaid";
}

export function codeChildrenToText(children: ReactNode): string {
  if (typeof children === "string") {
    return children;
  }
  if (Array.isArray(children)) {
    return children
      .map((child) => (typeof child === "string" ? child : ""))
      .join("");
  }
  return "";
}
