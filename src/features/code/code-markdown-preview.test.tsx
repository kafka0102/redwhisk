import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
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

  it("使用既有消息表格类名", () => {
    const { container } = renderPreview(`| 环节 | 结果 |
| --- | --- |
| 索引 | 短 |`);

    expect(container.querySelector("table")).toHaveClass(
      "agents-message__table",
    );
    expect(
      container.querySelector(".agents-message__table-scroll"),
    ).not.toBeNull();
    const head = container.querySelector("th");
    const cell = container.querySelector("td");
    expect(head).toHaveClass(
      "agents-message__table-cell",
      "agents-message__table-head",
    );
    expect(cell).toHaveClass("agents-message__table-cell");
    expect(cell).not.toHaveClass("agents-message__table-head");
  });

  it("按可见内容定列宽", () => {
    const { container } = renderPreview(`| 文件 | 写入 |
| --- | --- |
| \`robot-event-sample-cancel.json\` | 变更计划。取消迁移只作来源证据，不单凭它写成已取消 |`);

    const columns = [...container.querySelectorAll("col")].map(
      (column) => (column as HTMLElement).style.width,
    );
    expect(columns).toEqual(["30ch", "50ch"]);
  });

  it("列宽同时写在 col 和每个格子的 width、minWidth、maxWidth", () => {
    const { container } = renderPreview(`| 文件 | 写入 |
| --- | --- |
| \`robot-event-sample-cancel.json\` | 变更计划。取消迁移只作来源证据，不单凭它写成已取消 |`);

    expect(columnSizeList(container, "width")).toEqual(["30ch", "50ch"]);
    expect(columnSizeList(container, "minWidth")).toEqual(["30ch", "50ch"]);
    expect(columnSizeList(container, "maxWidth")).toEqual(["30ch", "50ch"]);
    for (const row of container.querySelectorAll("tr")) {
      const cells = [...row.querySelectorAll("th, td")] as HTMLElement[];
      expect(cells.map((cell) => cell.style.width)).toEqual(["30ch", "50ch"]);
      expect(cells.map((cell) => cell.style.minWidth)).toEqual([
        "30ch",
        "50ch",
      ]);
      expect(cells.map((cell) => cell.style.maxWidth)).toEqual([
        "30ch",
        "50ch",
      ]);
    }
  });

  it("长列和长中文都封顶 72ch", () => {
    const { container } = renderPreview(`| x |
| --- |
| ${"a".repeat(80)} |

| 汉 |
| --- |
| ${"汉".repeat(80)} |`);

    const tables = container.querySelectorAll("table");
    expect(columnSizeList(tables[0] as HTMLElement, "width")).toEqual(["72ch"]);
    expect(columnSizeList(tables[1] as HTMLElement, "width")).toEqual(["72ch"]);
  });

  it("全角括号按两个半角计，半角括号按一个半角计", () => {
    const { container } = renderPreview(`| （ |
| --- |
| a |

| ( |
| --- |
| a |`);

    const tables = container.querySelectorAll("table");
    expect(columnSizeList(tables[0] as HTMLElement, "width")).toEqual(["2ch"]);
    expect(columnSizeList(tables[1] as HTMLElement, "width")).toEqual(["1ch"]);
  });

  it("链接列只算标签", () => {
    const { container } = renderPreview(`| 项 |
| --- |
| [ADR-072](https://example.com/very/long/path) |`);

    expect(columnSizeList(container, "width")).toEqual(["7ch"]);
  });

  it("加粗和行内代码只算里面的字", () => {
    const { container } = renderPreview(`| 名 |
| --- |
| **风险** |

| 名 |
| --- |
| \`rid\` |`);

    const tables = container.querySelectorAll("table");
    expect(columnSizeList(tables[0] as HTMLElement, "width")).toEqual(["4ch"]);
    expect(columnSizeList(tables[1] as HTMLElement, "width")).toEqual(["3ch"]);
  });

  it("单元格首尾空格不计入列宽", () => {
    const { container } = renderPreview(`| 名 |
| --- |
|   索引   |`);

    expect(columnSizeList(container, "width")).toEqual(["4ch"]);
  });

  it("同一列多行取最宽的一行", () => {
    const { container } = renderPreview(`| x |
| --- |
| ab |
| abcd |`);

    expect(columnSizeList(container, "width")).toEqual(["4ch"]);
  });

  it("空列写成 0ch", () => {
    const { container } = renderPreview(`|  | 名 |
| --- | --- |
|  | 值 |`);

    expect(columnSizeList(container, "width")).toEqual(["0ch", "2ch"]);
  });

  it("保留 GFM 的右对齐和居中，默认列不写对齐", () => {
    const { container } = renderPreview(`| n | n | n |
| ---: | :---: | --- |
| 13 | 13 | 13 |`);

    const cells = container.querySelectorAll("td");
    expect(cells[0]?.style.textAlign).toBe("right");
    expect(cells[1]?.style.textAlign).toBe("center");
    expect(cells[2]?.style.textAlign).toBe("");
  });

  it("同一条预览里的两张表各自定宽", () => {
    const { container } = renderPreview(`| x |
| --- |
| ${"a".repeat(80)} |

| 环节 | 结果 |
| --- | --- |
| 索引 | 短 |`);

    const tables = container.querySelectorAll("table");
    expect(columnSizeList(tables[0] as HTMLElement, "width")).toEqual(["72ch"]);
    expect(columnSizeList(tables[1] as HTMLElement, "width")).toEqual([
      "4ch",
      "4ch",
    ]);
  });

  it("只滚动表格，前后段落留在外面", () => {
    const { container } = renderPreview(`前面一段

| 项 |
| --- |
| 值 |

后面一段`);

    const scroll = container.querySelector(".agents-message__table-scroll");
    expect(scroll?.querySelector("p")).toBeNull();
    expect(
      container.querySelectorAll(".agents-message__markdown > p"),
    ).toHaveLength(2);
  });

  it("没有表格时不渲染表格外壳", () => {
    const { container } = renderPreview("只有一段正文。");

    expect(container.querySelector(".agents-message__table")).toBeNull();
    expect(container.querySelector(".agents-message__table-scroll")).toBeNull();
  });

  it("表格和滚动容器都没有 aria-label", () => {
    const { container } = renderPreview(`| 项 |
| --- |
| 值 |`);

    expect(
      container.querySelector(".agents-message__table-scroll"),
    ).not.toHaveAttribute("aria-label");
    expect(container.querySelector("table")).not.toHaveAttribute("aria-label");
  });

  it("格子里的外链仍在新标签页打开", () => {
    renderPreview(`| 项 |
| --- |
| [文档](https://example.com/docs) |`);

    const link = screen.getByRole("link", { name: "文档" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("代码预览不引用 agents 内部，列宽规则只有一份", () => {
    const codeRoot = resolve(process.cwd(), "src/features/code");
    const violations: string[] = [];
    for (const file of listSourceFiles(codeRoot)) {
      const source = readFileSync(file, "utf8");
      if (importsAgentsFeature(source)) {
        violations.push(relative(codeRoot, file));
      }
    }
    expect(violations).toEqual([]);

    const srcRoot = resolve(process.cwd(), "src");
    const definitions: string[] = [];
    for (const file of listSourceFiles(srcRoot)) {
      const source = readFileSync(file, "utf8");
      if (source.includes("function halfwidthUnits(")) {
        definitions.push(relative(srcRoot, file));
      }
    }
    expect(definitions).toEqual(["shared/markdown/markdown-table-layout.tsx"]);
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

function columnSizeList(
  container: ParentNode,
  property: "width" | "minWidth" | "maxWidth",
): string[] {
  return [...container.querySelectorAll("col")].map(
    (column) => (column as HTMLElement).style[property],
  );
}

function listSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const fullPath = join(root, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...listSourceFiles(fullPath));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry) && !entry.includes(".test.")) {
      files.push(fullPath);
    }
  }
  return files;
}

function importsAgentsFeature(source: string): boolean {
  return source.split("\n").some((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("import ") && !trimmed.includes(" from ")) {
      return false;
    }
    return (
      /["'][^"']*features\/agents\//.test(trimmed) ||
      /["'](?:\.\.\/)+agents\//.test(trimmed)
    );
  });
}
