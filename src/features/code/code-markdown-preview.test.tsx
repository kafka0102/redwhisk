import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { CodeMarkdownPreview } from "./code-markdown-preview";

const mermaidMock = vi.hoisted(() => {
  return {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, _source: string) => ({
      svg: '<svg data-testid="mermaid-svg"><text>diagram</text></svg>',
    })),
  };
});

vi.mock("mermaid", () => ({
  default: mermaidMock,
}));

function renderPreview(
  content: string,
  theme: "light" | "dark" = "light",
): ReturnType<typeof render> {
  return render(
    <I18nProvider initialLocale="en">
      <CodeMarkdownPreview content={content} theme={theme} />
    </I18nProvider>,
  );
}

describe("CodeMarkdownPreview", () => {
  beforeEach(() => {
    mermaidMock.initialize.mockClear();
    mermaidMock.render.mockReset();
    mermaidMock.render.mockImplementation(
      async (_id: string, _source: string) => ({
        svg: '<svg data-testid="mermaid-svg"><text>diagram</text></svg>',
      }),
    );
  });

  it("renders markdown headings from source text", () => {
    renderPreview("# Hello Markdown");

    expect(
      screen.getByRole("heading", { name: "Hello Markdown" }),
    ).toBeInTheDocument();
  });

  it("opens external links in a new tab", () => {
    renderPreview("See [docs](https://example.com/docs).");

    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("href", "https://example.com/docs");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("renders fenced code blocks as pre/code", () => {
    const { container } = renderPreview(`\`\`\`ts
const x = 1;
\`\`\``);

    const codeBlock = container.querySelector("pre code.language-ts");
    expect(codeBlock).not.toBeNull();
    expect(codeBlock?.textContent).toContain("const x = 1;");
  });

  it("renders ordered lists for numbered GFM content", () => {
    renderPreview(`1. first
2. second`);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });

  it("renders mermaid fenced blocks as a static diagram container", async () => {
    renderPreview(`\`\`\`mermaid
flowchart TD
  A --> B
\`\`\``);

    const diagram = await screen.findByTestId("code-mermaid-diagram");
    expect(diagram.querySelector("svg")).not.toBeNull();
    expect(mermaidMock.render).toHaveBeenCalled();
    const sourceArg = mermaidMock.render.mock.calls[0]?.[1] as string;
    expect(sourceArg).toContain("flowchart TD");
    expect(sourceArg).toContain("A --> B");
  });

  it("treats mermaid language as case-insensitive", async () => {
    renderPreview(`\`\`\`MERMAID
sequenceDiagram
  Alice->>Bob: Hi
\`\`\``);

    await screen.findByTestId("code-mermaid-diagram");
    expect(mermaidMock.render).toHaveBeenCalled();
  });

  it("keeps non-mermaid fenced blocks as ordinary code", async () => {
    const { container } = renderPreview(`\`\`\`bash
echo hi
\`\`\``);

    expect(container.querySelector("pre code.language-bash")).not.toBeNull();
    expect(
      screen.queryByTestId("code-mermaid-diagram"),
    ).not.toBeInTheDocument();
    expect(mermaidMock.render).not.toHaveBeenCalled();
  });

  it("shows a block-level i18n error and source when mermaid fails", async () => {
    mermaidMock.render.mockRejectedValueOnce(new Error("parse error"));

    renderPreview(`# Still here

\`\`\`mermaid
not a valid diagram
\`\`\``);

    const error = await screen.findByTestId("code-mermaid-error");
    expect(error).toHaveTextContent(
      /could not render mermaid|failed to render/i,
    );
    expect(error.textContent).toContain("not a valid diagram");
    expect(
      screen.getByRole("heading", { name: "Still here" }),
    ).toBeInTheDocument();
  });

  it("re-renders mermaid when theme changes", async () => {
    const { rerender } = render(
      <I18nProvider initialLocale="en">
        <CodeMarkdownPreview
          content={`\`\`\`mermaid
flowchart TD
  A --> B
\`\`\``}
          theme="light"
        />
      </I18nProvider>,
    );

    await screen.findByTestId("code-mermaid-diagram");
    expect(mermaidMock.initialize).toHaveBeenCalled();
    const lightCalls = mermaidMock.initialize.mock.calls;
    const lightConfig = lightCalls[lightCalls.length - 1]?.[0] as {
      theme?: string;
    };
    expect(lightConfig.theme).toBe("default");

    mermaidMock.render.mockClear();
    mermaidMock.initialize.mockClear();

    rerender(
      <I18nProvider initialLocale="en">
        <CodeMarkdownPreview
          content={`\`\`\`mermaid
flowchart TD
  A --> B
\`\`\``}
          theme="dark"
        />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(mermaidMock.render).toHaveBeenCalled();
    });
    const darkCalls = mermaidMock.initialize.mock.calls;
    const darkConfig = darkCalls[darkCalls.length - 1]?.[0] as {
      theme?: string;
      securityLevel?: string;
      flowchart?: { htmlLabels?: boolean };
    };
    expect(darkConfig.theme).toBe("dark");
    expect(darkConfig.securityLevel).toBe("strict");
    expect(darkConfig.flowchart?.htmlLabels).toBe(false);
  });

  it("initializes mermaid with strict security settings", async () => {
    renderPreview(`\`\`\`mermaid
flowchart TD
  A --> B
\`\`\``);

    await screen.findByTestId("code-mermaid-diagram");
    expect(mermaidMock.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: "strict",
        flowchart: expect.objectContaining({ htmlLabels: false }),
      }),
    );
  });
});
