import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentMarkdown } from "./agent-markdown";
import type { SessionFileLinks } from "./session-file-links";
import { clearWorkspaceFileExistenceCacheForTest } from "./use-workspace-file-existence";

vi.mock("../../../shared/workspace/workspace-commands", () => ({
  statProjectWorktreeFile: vi.fn(() => Promise.reject(new Error("not found"))),
}));

const { statProjectWorktreeFile } =
  await import("../../../shared/workspace/workspace-commands");
const statMock = vi.mocked(statProjectWorktreeFile);

beforeEach(() => {
  statMock.mockClear();
  statMock.mockImplementation(() => Promise.reject(new Error("not found")));
  clearWorkspaceFileExistenceCacheForTest();
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
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
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
