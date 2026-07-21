// AgentComposer 组件测试。
//
// 覆盖：空态渲染、输入后发送按钮启用、Enter 换行、Shift/Ctrl/Cmd+Enter 发送、
// IME 合成中不触发快捷提交、running 状态显示取消按钮、用量条渲染、
// 附件 chip 渲染与移除、模型 Select 选项渲染、错误内联显示。
//
// base-ui Select 的弹出层在 jsdom 中需交互才挂载，故选项渲染测试通过
// SelectItem 的文本（在 content 内）配合 waitFor 断言；发送/取消等核心交互
// 直接验证命令 mock 被调用。

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentComposer } from "./agent-composer";
import { clearComposerDraftCacheForTest } from "./use-agent-composer";
import type { AgentUsage } from "../agent-stream-types";

const dialogMocks = vi.hoisted(() => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: dialogMocks.open,
}));

vi.mock("../agent-session-commands", () => ({
  listAgentModels: vi.fn(),
  listAgentModes: vi.fn(),
  setAgentModel: vi.fn(),
  sendAgentMessage: vi.fn(),
  cancelAgentTurn: vi.fn(),
  saveAgentAttachment: vi.fn(),
}));

const {
  listAgentModels,
  setAgentModel,
  sendAgentMessage,
  cancelAgentTurn,
  saveAgentAttachment,
} = await import("../agent-session-commands");
const listAgentModelsMock = vi.mocked(listAgentModels);
const setAgentModelMock = vi.mocked(setAgentModel);
const sendAgentMessageMock = vi.mocked(sendAgentMessage);
const cancelAgentTurnMock = vi.mocked(cancelAgentTurn);
const saveAgentAttachmentMock = vi.mocked(saveAgentAttachment);

const SAMPLE_USAGE: AgentUsage = {
  contextWindowUsedTokens: 30000,
  contextWindowMaxTokens: 200000,
};

beforeEach(() => {
  vi.clearAllMocks();
  // 草稿缓存是 module-level 单例，跨用例共享，每个用例前清空避免互相污染。
  clearComposerDraftCacheForTest();
  dialogMocks.open.mockResolvedValue(null);
  sendAgentMessageMock.mockResolvedValue(undefined);
  cancelAgentTurnMock.mockResolvedValue(undefined);
  setAgentModelMock.mockResolvedValue(undefined);
  saveAgentAttachmentMock.mockImplementation(
    async (input: { sourcePath: string; displayName: string }) => ({
      path: `/data/agent-attachments/1/${input.displayName}`,
      displayName: input.displayName,
      kind: "text",
    }),
  );
  listAgentModelsMock.mockResolvedValue({
    capabilities: {
      modelTypeLabel: "Codex",
      canShowModel: true,
      supportsModelSwitching: true,
      supportsReasoningEffort: true,
      supportsModes: true,
    },
    models: [
      {
        modelId: "gpt-5",
        displayName: "GPT-5",
        isDefault: true,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
      },
      {
        modelId: "gpt-4o",
        displayName: "GPT-4o",
        supportedReasoningEfforts: [],
      },
    ],
  });
});

async function renderComposer(
  overrides: {
    turnStatus?: "idle" | "running" | "failed" | "canceled";
    usage?: AgentUsage | null;
    currentModelId?: string | null;
  } = {},
) {
  const result = render(
    <AgentComposer
      projectId={1}
      sessionId={10}
      turnStatus={overrides.turnStatus ?? "idle"}
      usage={overrides.usage ?? null}
      currentModelId={overrides.currentModelId}
    />,
  );
  // list_agent_models 始终拉取（capabilities 一并返回）。
  await waitFor(() => {
    expect(listAgentModelsMock).toHaveBeenCalled();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return result;
}

describe("AgentComposer", () => {
  it("渲染输入框、附件按钮与发送按钮（默认禁用）", async () => {
    await renderComposer();
    expect(
      screen.getByRole("textbox", { name: "Message input" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add attachment" }),
    ).toBeInTheDocument();
    const sendButton = screen.getByRole("button", { name: "Send message" });
    expect(sendButton).toBeDisabled();
  });

  it("输入文本后发送按钮启用", async () => {
    const user = userEvent.setup();
    await renderComposer();
    const textarea = screen.getByRole("textbox", { name: "Message input" });
    await user.type(textarea, "你好");
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
  });

  it("点击发送按钮调用 sendAgentMessage 并清空输入", async () => {
    const user = userEvent.setup();
    await renderComposer();
    const textarea = screen.getByRole("textbox", { name: "Message input" });
    await user.type(textarea, "你好");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => {
      expect(sendAgentMessageMock).toHaveBeenCalledWith({
        projectId: 1,
        sessionId: 10,
        message: "你好",
        attachments: [],
      });
    });
    expect(textarea).toHaveValue("");
  });

  it("点击发送后按钮立即禁用，重复点击不会重复发送", async () => {
    let resolveSend: (() => void) | null = null;
    const releaseSend = () => {
      if (resolveSend === null) {
        throw new Error("send promise was not initialized");
      }
      resolveSend();
    };
    sendAgentMessageMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveSend = resolve;
      }),
    );
    const user = userEvent.setup();
    await renderComposer();
    const textarea = screen.getByRole("textbox", { name: "Message input" });
    await user.type(textarea, "你好");

    const sendButton = screen.getByRole("button", { name: "Send message" });
    await user.click(sendButton);

    await waitFor(() => {
      expect(sendButton).toBeDisabled();
    });

    await user.click(sendButton);
    expect(sendAgentMessageMock).toHaveBeenCalledTimes(1);

    releaseSend();
    await waitFor(() => {
      expect(textarea).toHaveValue("");
    });
  });

  it("Enter 不发送消息，插入换行", async () => {
    const user = userEvent.setup();
    await renderComposer();
    const textarea = screen.getByRole("textbox", { name: "Message input" });
    await user.type(textarea, "你好");
    await user.type(textarea, "{Enter}");
    expect(sendAgentMessageMock).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("你好\n");
  });

  it("Shift+Enter 发送消息并清空输入", async () => {
    const user = userEvent.setup();
    await renderComposer();
    const textarea = screen.getByRole("textbox", { name: "Message input" });
    await user.type(textarea, "你好");
    await user.type(textarea, "{Shift>}{Enter}{/Shift}");
    await waitFor(() => {
      expect(sendAgentMessageMock).toHaveBeenCalledWith({
        projectId: 1,
        sessionId: 10,
        message: "你好",
        attachments: [],
      });
    });
    expect(textarea).toHaveValue("");
  });

  it("Ctrl+Enter 发送消息并清空输入", async () => {
    const user = userEvent.setup();
    await renderComposer();
    const textarea = screen.getByRole("textbox", { name: "Message input" });
    await user.type(textarea, "你好");
    await user.type(textarea, "{Control>}{Enter}{/Control}");
    await waitFor(() => {
      expect(sendAgentMessageMock).toHaveBeenCalledWith({
        projectId: 1,
        sessionId: 10,
        message: "你好",
        attachments: [],
      });
    });
    expect(textarea).toHaveValue("");
  });

  it("Cmd+Enter 发送消息并清空输入", async () => {
    const user = userEvent.setup();
    await renderComposer();
    const textarea = screen.getByRole("textbox", { name: "Message input" });
    await user.type(textarea, "你好");
    await user.type(textarea, "{Meta>}{Enter}{/Meta}");
    await waitFor(() => {
      expect(sendAgentMessageMock).toHaveBeenCalledWith({
        projectId: 1,
        sessionId: 10,
        message: "你好",
        attachments: [],
      });
    });
    expect(textarea).toHaveValue("");
  });

  it("IME 合成中 Shift+Enter 不触发提交", async () => {
    const user = userEvent.setup();
    await renderComposer();
    const textarea = screen.getByRole("textbox", { name: "Message input" });
    await user.type(textarea, "你好");
    fireEvent.keyDown(textarea, {
      key: "Enter",
      shiftKey: true,
      isComposing: true,
    });
    expect(sendAgentMessageMock).not.toHaveBeenCalled();
  });

  it("发送按钮仅显示图标，不展示文字", async () => {
    await renderComposer();
    const sendButton = screen.getByRole("button", { name: "Send message" });
    expect(sendButton).toBeInTheDocument();
    expect(sendButton).not.toHaveTextContent("发送");
  });

  it("turnStatus=running 时显示终止按钮并调用 cancelAgentTurn", async () => {
    const user = userEvent.setup();
    await renderComposer({ turnStatus: "running" });
    const stopButton = screen.getByRole("button", {
      name: "Cancel current task",
    });
    expect(stopButton).not.toHaveTextContent("停止");
    await user.click(stopButton);
    await waitFor(() => {
      expect(cancelAgentTurnMock).toHaveBeenCalledWith({
        projectId: 1,
        sessionId: 10,
      });
    });
  });

  it("终止失败时使用 toast 提示，不渲染为输入框下方错误", async () => {
    cancelAgentTurnMock.mockRejectedValueOnce(new Error("后端不可达"));
    const user = userEvent.setup();
    await renderComposer({ turnStatus: "running" });

    await user.click(
      screen.getByRole("button", { name: "Cancel current task" }),
    );

    const toast = await screen.findByText("后端不可达");
    expect(toast).toHaveClass("agents-composer__toast");
    expect(document.querySelector(".agents-composer__error")).toBeNull();
  });

  it("无 usage 时不显示上下文用量", async () => {
    await renderComposer({ usage: null });
    expect(screen.queryByText(/上下文/)).not.toBeInTheDocument();
  });

  it("有 usage 时渲染用量文本与百分比详情", async () => {
    await renderComposer({ usage: SAMPLE_USAGE });
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "15",
    );
    expect(screen.getByText("15% used")).toBeInTheDocument();
  });

  it("添加附件后渲染 chip 与缺口提示文案", async () => {
    dialogMocks.open.mockResolvedValue("/tmp/report.txt");
    const user = userEvent.setup();
    await renderComposer();
    await user.click(screen.getByRole("button", { name: "Add attachment" }));
    await waitFor(() => {
      expect(screen.getByText("report.txt")).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        "Attachments are saved but will not be sent with messages yet.",
      ),
    ).toBeInTheDocument();
  });

  it("点击 chip 移除按钮删除附件", async () => {
    dialogMocks.open.mockResolvedValue("/tmp/report.txt");
    const user = userEvent.setup();
    await renderComposer();
    await user.click(screen.getByRole("button", { name: "Add attachment" }));
    await waitFor(() => {
      expect(screen.getByText("report.txt")).toBeInTheDocument();
    });
    await user.click(
      screen.getByRole("button", { name: "Remove attachment report.txt" }),
    );
    await waitFor(() => {
      expect(screen.queryByText("report.txt")).not.toBeInTheDocument();
    });
  });

  it("发送失败时内联显示错误", async () => {
    sendAgentMessageMock.mockRejectedValueOnce(new Error("网络中断"));
    const user = userEvent.setup();
    await renderComposer();
    const textarea = screen.getByRole("textbox", { name: "Message input" });
    await user.type(textarea, "再试");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => {
      expect(screen.getByText("网络中断")).toBeInTheDocument();
    });
  });

  it("模型加载失败时内联显示非运行中以外的错误", async () => {
    listAgentModelsMock.mockRejectedValueOnce(new Error("后端不可达"));
    await renderComposer();
    await waitFor(() => {
      expect(
        screen.getByText(/Model load failed: 后端不可达/),
      ).toBeInTheDocument();
    });
  });

  it("模型来源请求失败时显示真实错误而不是退化为 Codex 标签", async () => {
    listAgentModelsMock.mockRejectedValueOnce(
      new Error("当前 Session 没有运行中的结构化会话。"),
    );
    await renderComposer();
    await waitFor(() => {
      expect(listAgentModelsMock).toHaveBeenCalled();
    });
    expect(
      screen.getByText(
        /Model load failed: 当前 Session 没有运行中的结构化会话/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Current model type"),
    ).not.toBeInTheDocument();
  });

  it("渲染无可见文字标签的模型与 Think 选择器", async () => {
    await renderComposer();
    expect(
      screen.getByRole("combobox", { name: "Select model" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Think mode" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Think")).not.toBeInTheDocument();
    expect(screen.queryByText("模型")).not.toBeInTheDocument();
  });

  it("Think 模式展示模型声明的超高档位且不提供关闭选项", async () => {
    const user = userEvent.setup();
    await renderComposer({ currentModelId: "gpt-5" });

    await user.click(screen.getByRole("combobox", { name: "Think mode" }));

    expect(await screen.findByText("X-High")).toBeInTheDocument();
    expect(screen.queryByText("关闭")).not.toBeInTheDocument();
  });

  it("模型选中值使用统一展示大小写", async () => {
    await renderComposer({ currentModelId: "gpt-5" });
    expect(
      screen.getByRole("combobox", { name: "Select model" }),
    ).toHaveTextContent("GPT-5");
  });

  it("当前模型未知时优先显示列表里的默认模型", async () => {
    listAgentModelsMock.mockResolvedValueOnce({
      capabilities: {
        modelTypeLabel: "Codex",
        canShowModel: true,
        supportsModelSwitching: true,
        supportsReasoningEffort: true,
        supportsModes: true,
      },
      models: [
        {
          modelId: "gpt-5.5",
          displayName: "GPT-5.5",
          isDefault: true,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
        },
        {
          modelId: "gpt-5",
          displayName: "GPT-5",
          isDefault: false,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
        },
      ],
    });

    await renderComposer();

    expect(
      screen.getByRole("combobox", { name: "Select model" }),
    ).toHaveTextContent("GPT-5.5");
  });

  it("Claude 也请求模型列表并展示模型选择器（Think 仍不展示）", async () => {
    listAgentModelsMock.mockResolvedValue({
      capabilities: {
        modelTypeLabel: "Claude",
        canShowModel: true,
        supportsModelSwitching: true,
        supportsReasoningEffort: false,
        supportsModes: false,
      },
      models: [
        {
          modelId: "gpt-5",
          displayName: "GPT-5",
          isDefault: true,
          supportedReasoningEfforts: [],
        },
      ],
    });
    await renderComposer();
    // Claude 现在也会展示模型：canShowModel=true，会请求模型列表。
    expect(listAgentModelsMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 10,
    });
    // 模型区域展示（mock 返回非空 + isReadOnly 默认 false → 可切换下拉）。
    expect(
      screen.getByRole("combobox", { name: "Select model" }),
    ).toBeInTheDocument();
    // Think 模式 Claude 不支持，仍不展示。
    expect(screen.queryByText("Think")).not.toBeInTheDocument();
    // 发送按钮仍渲染。
    expect(
      screen.getByRole("button", { name: "Send message" }),
    ).toBeInTheDocument();
  });
});
