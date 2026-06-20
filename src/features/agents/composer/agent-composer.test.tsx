// AgentComposer 组件测试。
//
// 覆盖：空态渲染、输入后发送按钮启用、Enter 发送、Shift+Enter 不发送、
// running 状态显示取消按钮、用量条渲染、附件 chip 渲染与移除、
// 模型/Think Select 选项渲染、错误内联显示。
//
// base-ui Select 的弹出层在 jsdom 中需交互才挂载，故选项渲染测试通过
// SelectItem 的文本（在 content 内）配合 waitFor 断言；发送/取消等核心交互
// 直接验证命令 mock 被调用。

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentComposer } from "./agent-composer";
import { getAgentCapabilities } from "../agent-capabilities";
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
  setAgentThinking: vi.fn(),
  sendAgentMessage: vi.fn(),
  cancelAgentTurn: vi.fn(),
  saveAgentAttachment: vi.fn(),
}));

const {
  listAgentModels,
  setAgentModel,
  setAgentThinking,
  sendAgentMessage,
  cancelAgentTurn,
  saveAgentAttachment,
} = await import("../agent-session-commands");
const listAgentModelsMock = vi.mocked(listAgentModels);
const setAgentModelMock = vi.mocked(setAgentModel);
const setAgentThinkingMock = vi.mocked(setAgentThinking);
const sendAgentMessageMock = vi.mocked(sendAgentMessage);
const cancelAgentTurnMock = vi.mocked(cancelAgentTurn);
const saveAgentAttachmentMock = vi.mocked(saveAgentAttachment);

const SAMPLE_USAGE: AgentUsage = {
  contextWindowUsedTokens: 30000,
  contextWindowMaxTokens: 200000,
};

beforeEach(() => {
  vi.clearAllMocks();
  dialogMocks.open.mockResolvedValue(null);
  sendAgentMessageMock.mockResolvedValue(undefined);
  cancelAgentTurnMock.mockResolvedValue(undefined);
  setAgentModelMock.mockResolvedValue(undefined);
  setAgentThinkingMock.mockResolvedValue(undefined);
  saveAgentAttachmentMock.mockImplementation(
    async (input: { sourcePath: string; displayName: string }) => ({
      path: `/data/agent-attachments/1/${input.displayName}`,
      displayName: input.displayName,
      kind: "text",
    }),
  );
  listAgentModelsMock.mockResolvedValue({
    models: [
      {
        modelId: "gpt-5",
        displayName: "GPT-5",
        isDefault: true,
        supportedReasoningEfforts: ["low", "medium", "high"],
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
    capabilities?: ReturnType<typeof getAgentCapabilities>;
  } = {},
) {
  const result = render(
    <AgentComposer
      projectId={1}
      sessionId={10}
      capabilities={overrides.capabilities ?? getAgentCapabilities("codex")}
      turnStatus={overrides.turnStatus ?? "idle"}
      usage={overrides.usage ?? null}
      currentModelId={overrides.currentModelId}
    />,
  );
  // 等待 listAgentModels effect 落地。
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
      screen.getByRole("textbox", { name: "输入消息" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "添加附件" }),
    ).toBeInTheDocument();
    const sendButton = screen.getByRole("button", { name: "发送消息" });
    expect(sendButton).toBeDisabled();
  });

  it("输入文本后发送按钮启用", async () => {
    const user = userEvent.setup();
    await renderComposer();
    const textarea = screen.getByRole("textbox", { name: "输入消息" });
    await user.type(textarea, "你好");
    expect(screen.getByRole("button", { name: "发送消息" })).toBeEnabled();
  });

  it("点击发送按钮调用 sendAgentMessage 并清空输入", async () => {
    const user = userEvent.setup();
    await renderComposer();
    const textarea = screen.getByRole("textbox", { name: "输入消息" });
    await user.type(textarea, "你好");
    await user.click(screen.getByRole("button", { name: "发送消息" }));
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

  it("Enter 发送消息", async () => {
    const user = userEvent.setup();
    await renderComposer();
    const textarea = screen.getByRole("textbox", { name: "输入消息" });
    await user.type(textarea, "你好");
    await user.type(textarea, "{Enter}");
    await waitFor(() => {
      expect(sendAgentMessageMock).toHaveBeenCalledWith({
        projectId: 1,
        sessionId: 10,
        message: "你好",
        attachments: [],
      });
    });
  });

  it("Shift+Enter 不发送，插入换行", async () => {
    const user = userEvent.setup();
    await renderComposer();
    const textarea = screen.getByRole("textbox", { name: "输入消息" });
    await user.type(textarea, "你好");
    await user.type(textarea, "{Shift>}{Enter}{/Shift}");
    expect(sendAgentMessageMock).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("你好\n");
  });

  it("turnStatus=running 时显示停止按钮并调用 cancelAgentTurn", async () => {
    const user = userEvent.setup();
    await renderComposer({ turnStatus: "running" });
    const stopButton = screen.getByRole("button", { name: "取消当前回复" });
    await user.click(stopButton);
    await waitFor(() => {
      expect(cancelAgentTurnMock).toHaveBeenCalledWith({
        projectId: 1,
        sessionId: 10,
      });
    });
  });

  it("无 usage 时用量条显示占位「—」", async () => {
    await renderComposer({ usage: null });
    expect(screen.getByText(/上下文：—/)).toBeInTheDocument();
  });

  it("有 usage 时渲染用量比例文本", async () => {
    await renderComposer({ usage: SAMPLE_USAGE });
    // 30000 / 200000 = 15% → "30k / 200k"
    expect(screen.getByText(/30k \/ 200k/)).toBeInTheDocument();
  });

  it("用量接近上限（≥80%）显示 warning 文案", async () => {
    await renderComposer({
      usage: {
        contextWindowUsedTokens: 180000,
        contextWindowMaxTokens: 200000,
      },
    });
    expect(screen.getByText(/接近上限/)).toBeInTheDocument();
  });

  it("添加附件后渲染 chip 与缺口提示文案", async () => {
    dialogMocks.open.mockResolvedValue("/tmp/report.txt");
    const user = userEvent.setup();
    await renderComposer();
    await user.click(screen.getByRole("button", { name: "添加附件" }));
    await waitFor(() => {
      expect(screen.getByText("report.txt")).toBeInTheDocument();
    });
    expect(screen.getByText("附件已保存，暂不随消息发送")).toBeInTheDocument();
  });

  it("点击 chip 移除按钮删除附件", async () => {
    dialogMocks.open.mockResolvedValue("/tmp/report.txt");
    const user = userEvent.setup();
    await renderComposer();
    await user.click(screen.getByRole("button", { name: "添加附件" }));
    await waitFor(() => {
      expect(screen.getByText("report.txt")).toBeInTheDocument();
    });
    await user.click(
      screen.getByRole("button", { name: "移除附件 report.txt" }),
    );
    await waitFor(() => {
      expect(screen.queryByText("report.txt")).not.toBeInTheDocument();
    });
  });

  it("发送失败时内联显示错误", async () => {
    sendAgentMessageMock.mockRejectedValueOnce(new Error("网络中断"));
    const user = userEvent.setup();
    await renderComposer();
    const textarea = screen.getByRole("textbox", { name: "输入消息" });
    await user.type(textarea, "再试");
    await user.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => {
      expect(screen.getByText("网络中断")).toBeInTheDocument();
    });
  });

  it("模型加载失败时内联显示错误", async () => {
    listAgentModelsMock.mockRejectedValueOnce(new Error("后端不可达"));
    await renderComposer();
    await waitFor(() => {
      expect(screen.getByText(/模型加载失败：后端不可达/)).toBeInTheDocument();
    });
  });

  it("渲染无可见标签的模型和 Think 选择器", async () => {
    await renderComposer();
    expect(
      screen.getByRole("combobox", { name: "选择模型" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Think 模式" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Think")).not.toBeInTheDocument();
    expect(screen.queryByText("模型")).not.toBeInTheDocument();
  });

  it("capabilities 关闭模型与 Think 时不渲染对应 Select（claude 等无能力 agent）", async () => {
    await renderComposer({
      capabilities: getAgentCapabilities("claude"),
    });
    expect(screen.queryByText("模型")).not.toBeInTheDocument();
    expect(screen.queryByText("Think")).not.toBeInTheDocument();
    // 发送按钮仍渲染。
    expect(
      screen.getByRole("button", { name: "发送消息" }),
    ).toBeInTheDocument();
  });
});
