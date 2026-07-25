import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CodeMarkdownPreview } from "./code-markdown-preview";

describe("CodeMarkdownPreview", () => {
  it("renders markdown headings from source text", () => {
    render(<CodeMarkdownPreview content="# Hello Markdown" />);

    expect(
      screen.getByRole("heading", { name: "Hello Markdown" }),
    ).toBeInTheDocument();
  });

  it("opens external links in a new tab", () => {
    render(
      <CodeMarkdownPreview content="See [docs](https://example.com/docs)." />,
    );

    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("href", "https://example.com/docs");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("renders fenced code blocks as pre/code", () => {
    const { container } = render(
      <CodeMarkdownPreview
        content={`\`\`\`ts
const x = 1;
\`\`\``}
      />,
    );

    const codeBlock = container.querySelector("pre code.language-ts");
    expect(codeBlock).not.toBeNull();
    expect(codeBlock?.textContent).toContain("const x = 1;");
  });

  it("renders ordered lists for numbered GFM content", () => {
    render(
      <CodeMarkdownPreview
        content={`1. first
2. second`}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });
});
