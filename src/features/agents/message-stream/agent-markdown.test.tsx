import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentMarkdown } from "./agent-markdown";
import type { SessionFileLinks } from "./session-file-links";
import { clearWorkspaceFileExistenceCacheForTest } from "./use-workspace-file-existence";

vi.mock("../../../shared/workspace/workspace-commands", () => ({
  statProjectWorktreeFile: vi.fn(() => Promise.reject(new Error("not found"))),
}));

vi.mock("../../../shared/commands/copy-text-to-clipboard", () => ({
  copyTextToClipboard: vi.fn(async () => true),
}));

vi.mock("../../../shared/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

const { statProjectWorktreeFile } =
  await import("../../../shared/workspace/workspace-commands");
const statMock = vi.mocked(statProjectWorktreeFile);

const { copyTextToClipboard } =
  await import("../../../shared/commands/copy-text-to-clipboard");
const copyTextToClipboardMock = vi.mocked(copyTextToClipboard);

const { toast } = await import("../../../shared/toast");

const hljsCore = (await import("highlight.js/lib/core")).default;

beforeEach(() => {
  statMock.mockClear();
  statMock.mockImplementation(() => Promise.reject(new Error("not found")));
  clearWorkspaceFileExistenceCacheForTest();
  copyTextToClipboardMock.mockReset();
  copyTextToClipboardMock.mockResolvedValue(true);
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe("AgentMarkdown", () => {
  it("为有序确认菜单保留可恢复数字编号的列表结构", () => {
    const { container } = render(
      <AgentMarkdown>{`请回复编号。

1. 批准当前 proposal / design / spec，并按推荐组合继续实现
2. 批准当前 proposal / design / spec，但我要改实现路径
3. 先修改 proposal / design / tasks / spec
4. 先停在设计阶段`}</AgentMarkdown>,
    );

    const orderedList = container.querySelector("ol");

    expect(orderedList).toHaveClass("agents-message__ordered-list");
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });
});

const SESSION_FILE_LINKS: SessionFileLinks = {
  projectId: 1,
  sessionId: 10,
  workspacePath: "/Users/tester/repo",
  homePath: "/Users/tester",
  openFilePath: () => {},
};

describe("AgentMarkdown 链接分类", () => {
  it("http(s) 链接维持新标签页打开", () => {
    render(
      <AgentMarkdown sessionFileLinks={SESSION_FILE_LINKS}>
        {"见 [文档](https://example.com/docs)。"}
      </AgentMarkdown>,
    );

    const link = screen.getByRole("link", { name: "文档" });

    expect(link).toHaveAttribute("href", "https://example.com/docs");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("工作区相对路径渲染为按钮并回传相对路径", async () => {
    const openFilePath = vi.fn();
    const user = userEvent.setup();

    render(
      <AgentMarkdown sessionFileLinks={{ ...SESSION_FILE_LINKS, openFilePath }}>
        {"见 [a.ts](./src/app/a.ts)。"}
      </AgentMarkdown>,
    );

    await user.click(
      screen.getByRole("button", { name: "Open file src/app/a.ts" }),
    );

    expect(openFilePath).toHaveBeenCalledWith("src/app/a.ts");
  });

  it("剥掉行号后缀后打开文件（不跳转行）", async () => {
    const openFilePath = vi.fn();
    const user = userEvent.setup();

    render(
      <AgentMarkdown sessionFileLinks={{ ...SESSION_FILE_LINKS, openFilePath }}>
        {"见 [a.ts](src/app/a.ts#L12C3) 与 [a.ts](src/app/a.ts:12)。"}
      </AgentMarkdown>,
    );

    const buttons = screen.getAllByRole("button", {
      name: "Open file src/app/a.ts",
    });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[0]);
    await user.click(buttons[1]);

    expect(openFilePath).toHaveBeenNthCalledWith(1, "src/app/a.ts");
    expect(openFilePath).toHaveBeenNthCalledWith(2, "src/app/a.ts");
  });

  it("工作区外绝对路径与网络共享保持原文且不可点", () => {
    render(
      <AgentMarkdown sessionFileLinks={SESSION_FILE_LINKS}>
        {"见 [hosts](/etc/hosts) 与 [share](//server/share/a.ts)。"}
      </AgentMarkdown>,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("hosts")).toBeInTheDocument();
    expect(screen.getByText("share")).toBeInTheDocument();
  });

  it("工作区内绝对路径与 file URL 也收成相对路径后可点", async () => {
    const openFilePath = vi.fn();
    const user = userEvent.setup();

    render(
      <AgentMarkdown sessionFileLinks={{ ...SESSION_FILE_LINKS, openFilePath }}>
        {
          "见 [a.ts](/Users/tester/repo/src/app/a.ts) 与 [b.ts](file:///Users/tester/repo/src/b.ts)。"
        }
      </AgentMarkdown>,
    );

    await user.click(
      screen.getByRole("button", { name: "Open file src/app/a.ts" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Open file src/b.ts" }),
    );

    expect(openFilePath).toHaveBeenNthCalledWith(1, "src/app/a.ts");
    expect(openFilePath).toHaveBeenNthCalledWith(2, "src/b.ts");
  });

  it("mailto 与编辑器协议不给可点行为", () => {
    render(
      <AgentMarkdown sessionFileLinks={SESSION_FILE_LINKS}>
        {
          "联系 [作者](mailto:someone@example.com)，或用 [编辑器](vscode://file/Users/tester/repo/src/app/a.ts) 打开。"
        }
      </AgentMarkdown>,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("作者")).toBeInTheDocument();
    expect(screen.getByText("编辑器")).toBeInTheDocument();
  });

  it("未注入文件链接能力时本地路径回落纯文本", () => {
    render(<AgentMarkdown>{"见 [a.ts](src/app/a.ts)。"}</AgentMarkdown>);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("a.ts")).toBeInTheDocument();
  });
});

describe("AgentMarkdown 行内代码文件路径", () => {
  it("存在的工作区相对路径行内代码可点，点击回传相对路径", async () => {
    statMock.mockResolvedValue({
      filePath: "src/app/a.ts",
      sizeBytes: 10,
      modifiedAt: null,
    });
    const openFilePath = vi.fn();
    const user = userEvent.setup();

    render(
      <AgentMarkdown sessionFileLinks={{ ...SESSION_FILE_LINKS, openFilePath }}>
        {"改动见 `src/app/a.ts` 与 `./src/app/a.ts`。"}
      </AgentMarkdown>,
    );

    const buttons = await screen.findAllByRole("button", {
      name: "Open file src/app/a.ts",
    });
    expect(buttons).toHaveLength(2);
    expect(statMock).toHaveBeenCalledTimes(1);

    await user.click(buttons[0]);

    expect(openFilePath).toHaveBeenCalledWith("src/app/a.ts");
  });

  it("后端拒绝的路径保持普通 code 且没有按钮 role", async () => {
    render(
      <AgentMarkdown sessionFileLinks={SESSION_FILE_LINKS}>
        {"改动见 `./src/app/missing.ts`。"}
      </AgentMarkdown>,
    );

    await waitFor(() => {
      expect(statMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("./src/app/missing.ts").tagName).toBe("CODE");
  });

  it("不像工作区路径的行内代码不参与探测也不可点", async () => {
    statMock.mockResolvedValue({
      filePath: "src/app/a.ts",
      sizeBytes: 10,
      modifiedAt: null,
    });

    render(
      <AgentMarkdown sessionFileLinks={SESSION_FILE_LINKS}>
        {
          "见 `pnpm test`、`useI18n`、`const a = 1`、`https://example.com`、`//server/share/a.ts`。"
        }
      </AgentMarkdown>,
    );

    await waitFor(() => {
      expect(screen.getByText("pnpm test")).toBeInTheDocument();
    });
    expect(statMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("围栏代码块里的路径不参与探测也不可点", async () => {
    statMock.mockResolvedValue({
      filePath: "src/app/a.ts",
      sizeBytes: 10,
      modifiedAt: null,
    });

    render(
      <AgentMarkdown sessionFileLinks={SESSION_FILE_LINKS}>
        {"```\nsrc/app/a.ts\n```"}
      </AgentMarkdown>,
    );

    await waitFor(() => {
      expect(screen.getByText("src/app/a.ts")).toBeInTheDocument();
    });
    expect(statMock).not.toHaveBeenCalled();
    // 围栏代码块自带复制按钮，但里面的路径不该变成可点文件按钮。
    expect(
      screen.queryByRole("button", { name: "Open file src/app/a.ts" }),
    ).not.toBeInTheDocument();
  });

  it("未注入文件链接能力时不发存在性检查请求，行内代码保持原样", async () => {
    statMock.mockResolvedValue({
      filePath: "src/app/a.ts",
      sizeBytes: 10,
      modifiedAt: null,
    });

    render(<AgentMarkdown>{"改动见 `src/app/a.ts`。"}</AgentMarkdown>);

    await waitFor(() => {
      expect(screen.getByText("src/app/a.ts")).toBeInTheDocument();
    });
    expect(statMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("流式追加内容后已探测过的路径不重复请求", async () => {
    statMock.mockResolvedValue({
      filePath: "src/app/a.ts",
      sizeBytes: 10,
      modifiedAt: null,
    });

    const { rerender } = render(
      <AgentMarkdown sessionFileLinks={SESSION_FILE_LINKS}>
        {"改动见 `src/app/a.ts`"}
      </AgentMarkdown>,
    );
    await screen.findByRole("button", { name: "Open file src/app/a.ts" });

    rerender(
      <AgentMarkdown sessionFileLinks={SESSION_FILE_LINKS}>
        {"改动见 `src/app/a.ts`，另见 `src/app/b.ts`。"}
      </AgentMarkdown>,
    );

    await waitFor(() => {
      expect(statMock).toHaveBeenCalledTimes(2);
    });
    expect(statMock).toHaveBeenNthCalledWith(1, {
      projectId: 1,
      sessionId: 10,
      filePath: "src/app/a.ts",
    });
    expect(statMock).toHaveBeenNthCalledWith(2, {
      projectId: 1,
      sessionId: 10,
      filePath: "src/app/b.ts",
    });
  });
});

describe("AgentMarkdown 围栏代码", () => {
  it("已知语言渲染高亮结构并标出语言", () => {
    const { container } = render(
      <AgentMarkdown>{"```ts\nconst answer: number = 1;\n```"}</AgentMarkdown>,
    );

    expect(container.querySelectorAll("pre")).toHaveLength(1);
    expect(container.querySelector(".hljs-keyword")).not.toBeNull();
    expect(screen.getByText("ts")).toBeInTheDocument();
  });

  it("复制按钮把原文写入剪贴板并提示成功", async () => {
    const user = userEvent.setup();

    render(<AgentMarkdown>{"```ts\nconst answer = 1;\n```"}</AgentMarkdown>);

    await user.click(screen.getByRole("button", { name: "Copy code" }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Copied to clipboard");
    });
    expect(copyTextToClipboardMock).toHaveBeenCalledWith("const answer = 1;\n");
  });

  it("复制失败时提示失败文案", async () => {
    copyTextToClipboardMock.mockResolvedValueOnce(false);
    const user = userEvent.setup();

    render(<AgentMarkdown>{"```ts\nconst answer = 1;\n```"}</AgentMarkdown>);

    await user.click(screen.getByRole("button", { name: "Copy code" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to copy");
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("未知语言回落纯文本且逐字保留原文", () => {
    const { container } = render(
      <AgentMarkdown>{"```unknownlang\nconst answer = 1;\n```"}</AgentMarkdown>,
    );

    const code = container.querySelector("pre code");

    expect(code?.className).toBe("language-unknownlang");
    expect(code?.textContent).toBe("const answer = 1;\n");
    expect(container.querySelector(".hljs-keyword")).toBeNull();
  });

  it("无 info string 的围栏代码回落纯文本", () => {
    const { container } = render(
      <AgentMarkdown>{"```\nplain text\n```"}</AgentMarkdown>,
    );

    const code = container.querySelector("pre code");

    expect(code?.textContent).toBe("plain text\n");
    expect(container.querySelector(".hljs-keyword")).toBeNull();
  });

  it("高亮抛错时仍显示原文且不崩", () => {
    const highlightSpy = vi
      .spyOn(hljsCore, "highlight")
      .mockImplementationOnce(() => {
        throw new Error("highlight failed");
      });

    const { container } = render(
      <AgentMarkdown>{"```ts\nconst answer = 1;\n```"}</AgentMarkdown>,
    );

    expect(highlightSpy).toHaveBeenCalled();
    expect(container.querySelector("pre code")?.textContent).toBe(
      "const answer = 1;\n",
    );
    expect(container.querySelector(".hljs-keyword")).toBeNull();
  });

  it("行内代码 DOM 与样式保持不变", () => {
    const { container } = render(
      <AgentMarkdown>{"见 `pnpm test`。"}</AgentMarkdown>,
    );

    expect(container.querySelector("code")).toHaveClass(
      "agents-message__code-inline",
    );
    expect(container.querySelector("pre")).toBeNull();
  });
});

describe("AgentMarkdown 表格", () => {
  it("表格列宽贴内容", () => {
    const { container } = render(
      <AgentMarkdown>{`| 环节 | 结果 |
| --- | --- |
| 索引 | 短 |`}</AgentMarkdown>,
    );

    const columns = container.querySelectorAll("col");

    expect(columns).toHaveLength(2);
    expect(columns[0]?.style.width).toBe("4ch");
    expect(columns[0]?.style.minWidth).toBe("4ch");
    expect(columns[1]?.style.width).toBe("4ch");
    expect(columns[1]?.style.minWidth).toBe("4ch");
    for (const cell of container.querySelectorAll("th, td")) {
      expect((cell as HTMLElement).style.width).toBe(
        (cell as HTMLElement).style.maxWidth,
      );
      expect((cell as HTMLElement).style.maxWidth).not.toBe("");
    }
  });

  it("列宽贴单元格而不是更短的列名", () => {
    const { container } = render(
      <AgentMarkdown>{`| 项 |
| --- |
| 索引 |`}</AgentMarkdown>,
    );

    expect(columnWidthList(container)).toEqual(["4ch"]);
  });

  it("长单元格封顶 72 个半角", () => {
    const { container } = render(
      <AgentMarkdown>{`| x |
| --- |
| ${"a".repeat(80)} |`}</AgentMarkdown>,
    );

    expect(columnWidthList(container)).toEqual(["72ch"]);
  });

  it("超长列名也封顶 72 个半角", () => {
    const { container } = render(
      <AgentMarkdown>{`| ${"a".repeat(80)} |
| --- |
| b |`}</AgentMarkdown>,
    );

    expect(columnWidthList(container)).toEqual(["72ch"]);
  });

  it("链接列宽只算标签", () => {
    const { container } = render(
      <AgentMarkdown>{`| 项 |
| --- |
| [ADR-072](https://example.com/very/long/path) |`}</AgentMarkdown>,
    );

    expect(columnWidthList(container)).toEqual(["7ch"]);
  });

  it("加粗和斜体只算里面的字", () => {
    const { container } = render(
      <AgentMarkdown>{`| 名 |
| --- |
| **风险** |

| 名 |
| --- |
| *ab* |`}</AgentMarkdown>,
    );

    const tables = container.querySelectorAll("table");
    expect(columnWidthList(tables[0] as HTMLElement)).toEqual(["4ch"]);
    expect(columnWidthList(tables[1] as HTMLElement)).toEqual(["2ch"]);
  });

  it("行内代码只算代码文字", () => {
    const { container } = render(
      <AgentMarkdown>{`| 名 |
| --- |
| \`rid\` |`}</AgentMarkdown>,
    );

    expect(columnWidthList(container)).toEqual(["3ch"]);
  });

  it("链接标签和周围文字按可见顺序拼接", () => {
    const { container } = render(
      <AgentMarkdown>{`| 名 |
| --- |
| 见 [ADR-072](https://example.com/x) 完 |`}</AgentMarkdown>,
    );

    expect(columnWidthList(container)).toEqual(["13ch"]);
  });

  it("单元格首尾空格不计入列宽", () => {
    const { container } = render(
      <AgentMarkdown>{`| 名 |
| --- |
|   索引   |`}</AgentMarkdown>,
    );

    expect(columnWidthList(container)).toEqual(["4ch"]);
  });

  it("同一列多行取最宽的一行", () => {
    const { container } = render(
      <AgentMarkdown>{`| x |
| --- |
| ab |
| abcd |`}</AgentMarkdown>,
    );

    expect(columnWidthList(container)).toEqual(["4ch"]);
  });

  it("保留 GFM 的居中和右对齐，默认列不写对齐", () => {
    const { container } = render(
      <AgentMarkdown>{`| n |
| ---: |
| 13 |

| n |
| :---: |
| 13 |

| n |
| --- |
| 13 |`}</AgentMarkdown>,
    );

    const cells = container.querySelectorAll("td");
    expect(cells[0]?.style.textAlign).toBe("right");
    expect(cells[1]?.style.textAlign).toBe("center");
    expect(cells[2]?.style.textAlign).toBe("");
  });

  it("只滚动表格，前后段落留在外面", () => {
    const { container } = render(
      <AgentMarkdown>{`前面一段

| 项 |
| --- |
| 值 |

后面一段`}</AgentMarkdown>,
    );

    const scroll = container.querySelector(".agents-message__table-scroll");
    expect(scroll?.querySelector("p")).toBeNull();
    expect(
      container.querySelectorAll(".agents-message__markdown > p"),
    ).toHaveLength(2);
  });

  it("格子有表头类名，且不带无障碍标签", () => {
    const { container } = render(
      <AgentMarkdown>{`| 项 |
| --- |
| 值 |`}</AgentMarkdown>,
    );

    const head = container.querySelector("th");
    const cell = container.querySelector("td");
    expect(head).toHaveClass(
      "agents-message__table-cell",
      "agents-message__table-head",
    );
    expect(cell).toHaveClass("agents-message__table-cell");
    expect(cell).not.toHaveClass("agents-message__table-head");
    expect(
      container.querySelector(".agents-message__table-scroll"),
    ).not.toHaveAttribute("aria-label");
    expect(container.querySelector("table")).not.toHaveAttribute("aria-label");
  });

  it("同一条消息里的两张表各自定宽", () => {
    const { container } = render(
      <AgentMarkdown>{`| x |
| --- |
| ${"a".repeat(80)} |

| 环节 | 结果 |
| --- | --- |
| 索引 | 短 |`}</AgentMarkdown>,
    );

    const tables = container.querySelectorAll("table");
    expect(columnWidthList(tables[0] as HTMLElement)).toEqual(["72ch"]);
    expect(columnWidthList(tables[1] as HTMLElement)).toEqual(["4ch", "4ch"]);
  });

  it("单元格里的外链仍在新标签页打开", () => {
    render(
      <AgentMarkdown sessionFileLinks={SESSION_FILE_LINKS}>
        {`| 项 |
| --- |
| [文档](https://example.com/docs) |`}
      </AgentMarkdown>,
    );

    const link = screen.getByRole("link", { name: "文档" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("单元格里的工作区文件链接仍是按钮", async () => {
    const openFilePath = vi.fn();
    const user = userEvent.setup();

    render(
      <AgentMarkdown sessionFileLinks={{ ...SESSION_FILE_LINKS, openFilePath }}>
        {`| 项 |
| --- |
| [a.ts](./src/app/a.ts) |`}
      </AgentMarkdown>,
    );

    await user.click(
      screen.getByRole("button", { name: "Open file src/app/a.ts" }),
    );
    expect(openFilePath).toHaveBeenCalledWith("src/app/a.ts");
  });

  it("没有表格时不渲染表格外壳", () => {
    const { container } = render(
      <AgentMarkdown>{"只有一段正文。"}</AgentMarkdown>,
    );

    expect(container.querySelector(".agents-message__table")).toBeNull();
    expect(container.querySelector(".agents-message__table-scroll")).toBeNull();
  });

  it("全角括号按两个半角计，半角括号按一个半角计", () => {
    const { container } = render(
      <AgentMarkdown>{`| （ |
| --- |
| a |

| ( |
| --- |
| a |`}</AgentMarkdown>,
    );

    const tables = container.querySelectorAll("table");
    expect(columnWidthList(tables[0] as HTMLElement)).toEqual(["2ch"]);
    expect(columnWidthList(tables[1] as HTMLElement)).toEqual(["1ch"]);
  });

  it("表格样式画出边框、表头底色，并只让表格横向滚动", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/shared/styles/message-stream.css"),
      "utf8",
    );
    const cell = cssRule(css, ".agents-message__table-cell");
    const head = cssRule(css, ".agents-message__table-head");
    const table = cssRule(css, ".agents-message__table");
    const scroll = cssRule(css, ".agents-message__table-scroll");
    const markdown = cssRule(css, ".agents-message__markdown");

    expect(cell).toMatch(/border:\s*1px solid var\(--color-border\)/);
    expect(cell).toMatch(/box-sizing:\s*content-box/);
    expect(cell).toMatch(/padding:\s*4px 8px/);
    expect(cell).toMatch(/word-break:\s*normal/);
    expect(cell).toMatch(/overflow-wrap:\s*break-word/);
    expect(cell).not.toMatch(/word-break:\s*break-word/);
    expect(head).toMatch(/background:\s*var\(--color-surface-muted\)/);
    expect(table).toMatch(/width:\s*max-content/);
    expect(table).not.toMatch(/width:\s*100%/);
    expect(table).not.toMatch(/table-layout:\s*fixed/);
    expect(scroll).toMatch(/overflow-x:\s*auto/);
    expect(scroll).toMatch(/max-width:\s*100%/);
    expect(markdown).not.toMatch(/overflow-x/);
  });
});

function columnWidthList(container: ParentNode): string[] {
  return [...container.querySelectorAll("col")].map((column) => {
    const cell = column as HTMLElement;
    expect(cell.style.minWidth).toBe(cell.style.width);
    return cell.style.width;
  });
}

function cssRule(css: string, selector: string): string {
  const marker = `\n${selector} {`;
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open, close);
}
