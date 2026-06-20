// useAgentComposer hook 的单元测试。
//
// 通过 renderProbe 模式间接测 hook（项目无 renderHook 习惯，参考
// use-agent-message-stream.test.tsx）。mock @tauri-apps/plugin-dialog 与
// ../agent-session-commands。

import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TurnStatus } from "../message-stream/message-stream-types";
import { useAgentComposer } from "./use-agent-composer";
import type { UseAgentComposerResult } from "./use-agent-composer";
import type { ComposerEffort } from "./composer-types";

const dialogMocks = vi.hoisted(() => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: dialogMocks.open,
}));

vi.mock("../agent-session-commands", () => ({
  sendAgentMessage: vi.fn(),
  cancelAgentTurn: vi.fn(),
  saveAgentAttachment: vi.fn(),
  setAgentThinking: vi.fn(),
}));

const {
  sendAgentMessage,
  cancelAgentTurn,
  saveAgentAttachment,
  setAgentThinking,
} = await import("../agent-session-commands");
const sendAgentMessageMock = vi.mocked(sendAgentMessage);
const cancelAgentTurnMock = vi.mocked(cancelAgentTurn);
const saveAgentAttachmentMock = vi.mocked(saveAgentAttachment);
const setAgentThinkingMock = vi.mocked(setAgentThinking);

interface ProbeProps {
  projectId: number;
  sessionId: number;
  turnStatus: TurnStatus;
  currentEffort?: ComposerEffort | null;
  onMessageSent?: (message: string) => void;
  onState: (state: UseAgentComposerResult) => void;
}

function Probe({
  projectId,
  sessionId,
  turnStatus,
  currentEffort,
  onMessageSent,
  onState,
}: ProbeProps) {
  const state = useAgentComposer({
    projectId,
    sessionId,
    turnStatus,
    currentEffort,
    onMessageSent,
  });
  onState(state);
  return <div data-testid="probe" />;
}

type ProbeInput = Omit<ProbeProps, "onState">;

async function renderProbe(props: ProbeInput): Promise<{
  getState: () => UseAgentComposerResult | null;
  rerenderWith: (
    next: Partial<Pick<ProbeProps, "turnStatus" | "currentEffort">>,
  ) => void;
}> {
  let latest: UseAgentComposerResult | null = null;
  const captureState = (state: UseAgentComposerResult) => {
    latest = state;
  };
  const result = render(
    <Probe
      projectId={props.projectId}
      sessionId={props.sessionId}
      turnStatus={props.turnStatus}
      currentEffort={props.currentEffort}
      onMessageSent={props.onMessageSent}
      onState={captureState}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return {
    getState: () => latest,
    rerenderWith: (
      next: Partial<Pick<ProbeProps, "turnStatus" | "currentEffort">>,
    ) => {
      result.rerender(
        <Probe
          projectId={props.projectId}
          sessionId={props.sessionId}
          turnStatus={next.turnStatus ?? props.turnStatus}
          currentEffort={
            Object.prototype.hasOwnProperty.call(next, "currentEffort")
              ? next.currentEffort
              : props.currentEffort
          }
          onMessageSent={props.onMessageSent}
          onState={captureState}
        />,
      );
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dialogMocks.open.mockResolvedValue(null);
  sendAgentMessageMock.mockResolvedValue(undefined);
  cancelAgentTurnMock.mockResolvedValue(undefined);
  saveAgentAttachmentMock.mockImplementation(
    async (input: { sourcePath: string; displayName: string }) => ({
      path: `/data/agent-attachments/1/${input.displayName}`,
      displayName: input.displayName,
      kind: "text",
    }),
  );
  setAgentThinkingMock.mockResolvedValue(undefined);
});

describe("useAgentComposer", () => {
  it("初始状态：空文本、无附件、isSending 取决于 turnStatus", async () => {
    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 10,
      turnStatus: "idle",
    });
    const state = getState()!;
    expect(state.text).toBe("");
    expect(state.attachments).toEqual([]);
    expect(state.isSending).toBe(false);
    expect(state.submitError).toBeNull();
  });

  it("turnStatus=running 时 isSending 为 true", async () => {
    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 10,
      turnStatus: "running",
    });
    expect(getState()!.isSending).toBe(true);
  });

  it("空文本不发送", async () => {
    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 10,
      turnStatus: "idle",
    });
    await act(async () => {
      await getState()!.handleSubmit();
    });
    expect(sendAgentMessageMock).not.toHaveBeenCalled();
  });

  it("发送成功：调用 sendAgentMessage、清空文本、触发 onMessageSent", async () => {
    const onMessageSent = vi.fn();
    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 10,
      turnStatus: "idle",
      onMessageSent,
    });
    await act(async () => {
      getState()!.setText("你好");
    });
    await act(async () => {
      await getState()!.handleSubmit();
    });
    expect(sendAgentMessageMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 10,
      message: "你好",
      attachments: [],
    });
    expect(getState()!.text).toBe("");
    expect(onMessageSent).toHaveBeenCalledWith("你好");
  });

  it("发送失败：设置 submitError 且保留文本", async () => {
    sendAgentMessageMock.mockRejectedValueOnce(new Error("网络错误"));
    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 10,
      turnStatus: "idle",
    });
    await act(async () => {
      getState()!.setText("重试我");
    });
    await act(async () => {
      await getState()!.handleSubmit();
    });
    expect(getState()!.submitError).toBe("网络错误");
    expect(getState()!.text).toBe("重试我");
  });

  it("handleCancel 调用 cancelAgentTurn", async () => {
    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 10,
      turnStatus: "running",
    });
    await act(async () => {
      await getState()!.handleCancel();
    });
    expect(cancelAgentTurnMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 10,
    });
  });

  it("添加附件成功：chip 从 saving 转为 saved", async () => {
    dialogMocks.open.mockResolvedValue("/tmp/report.txt");
    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 10,
      turnStatus: "idle",
    });
    await act(async () => {
      await getState()!.handleAddAttachment();
    });
    const attachments = getState()!.attachments;
    expect(attachments).toHaveLength(1);
    expect(attachments[0].status).toBe("saved");
    expect(attachments[0].displayName).toBe("report.txt");
    expect(attachments[0].savedPath).toBe(
      "/data/agent-attachments/1/report.txt",
    );
    expect(saveAgentAttachmentMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 10,
      sourcePath: "/tmp/report.txt",
      displayName: "report.txt",
    });
  });

  it("发送时携带已落盘附件并清空附件列表", async () => {
    dialogMocks.open.mockResolvedValue("/tmp/screenshot.png");
    saveAgentAttachmentMock.mockResolvedValueOnce({
      path: "/data/agent-attachments/1/screenshot.png",
      displayName: "screenshot.png",
      kind: "image",
    });
    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 10,
      turnStatus: "idle",
    });
    await act(async () => {
      await getState()!.handleAddAttachment();
    });
    await act(async () => {
      getState()!.setText("请看这张图");
    });
    await act(async () => {
      await getState()!.handleSubmit();
    });
    expect(sendAgentMessageMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 10,
      message: "请看这张图",
      attachments: [
        {
          path: "/data/agent-attachments/1/screenshot.png",
          displayName: "screenshot.png",
          kind: "image",
        },
      ],
    });
    expect(getState()!.text).toBe("");
    expect(getState()!.attachments).toEqual([]);
  });

  it("附件仍在落盘时阻止提交并提示", async () => {
    // saveAgentAttachment 不 resolve，使附件卡在 saving 状态。
    saveAgentAttachmentMock.mockReturnValueOnce(new Promise(() => {}));
    dialogMocks.open.mockResolvedValue("/tmp/slow.txt");
    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 10,
      turnStatus: "idle",
    });
    // 触发添加但不 await，让附件停留在 saving。
    act(() => {
      void getState()!.handleAddAttachment();
    });
    await act(async () => {
      getState()!.setText("先发文本");
    });
    await act(async () => {
      await getState()!.handleSubmit();
    });
    expect(sendAgentMessageMock).not.toHaveBeenCalled();
    expect(getState()!.submitError).toBe("附件正在上传，请稍候");
    expect(getState()!.text).toBe("先发文本");
  });

  it("用户取消选择（open 返回 null）不添加附件", async () => {
    dialogMocks.open.mockResolvedValue(null);
    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 10,
      turnStatus: "idle",
    });
    await act(async () => {
      await getState()!.handleAddAttachment();
    });
    expect(getState()!.attachments).toHaveLength(0);
    expect(saveAgentAttachmentMock).not.toHaveBeenCalled();
  });

  it("附件落盘失败：chip 转为 error 状态并带 error 文案", async () => {
    dialogMocks.open.mockResolvedValue("/tmp/bad.txt");
    saveAgentAttachmentMock.mockRejectedValueOnce(new Error("磁盘满"));
    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 10,
      turnStatus: "idle",
    });
    await act(async () => {
      await getState()!.handleAddAttachment();
    });
    const attachments = getState()!.attachments;
    expect(attachments).toHaveLength(1);
    expect(attachments[0].status).toBe("error");
    expect(attachments[0].error).toBe("磁盘满");
  });

  it("handleRemoveAttachment 按 id 移除", async () => {
    dialogMocks.open.mockResolvedValue("/tmp/a.txt");
    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 10,
      turnStatus: "idle",
    });
    await act(async () => {
      await getState()!.handleAddAttachment();
    });
    const id = getState()!.attachments[0].id;
    await act(async () => {
      getState()!.handleRemoveAttachment(id);
    });
    expect(getState()!.attachments).toHaveLength(0);
  });

  it("默认 Think 为 medium", async () => {
    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 10,
      turnStatus: "idle",
    });
    expect(getState()!.effort).toBe("medium");
  });

  it("handleSetEffort(high) 调用 setAgentThinking 且 effort=high", async () => {
    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 10,
      turnStatus: "idle",
    });
    await act(async () => {
      await getState()!.handleSetEffort("high");
    });
    expect(setAgentThinkingMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 10,
      effort: "high",
    });
    expect(getState()!.effort).toBe("high");
  });

  it("setAgentThinking 失败：回滚 effort 并设 submitError", async () => {
    setAgentThinkingMock.mockRejectedValueOnce(new Error("不支持"));
    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 10,
      turnStatus: "idle",
    });
    await act(async () => {
      getState()!.handleSetEffort("low");
    });
    // 初始 effort 为 medium，失败后回滚到 medium。
    expect(getState()!.effort).toBe("medium");
    expect(getState()!.submitError).toBe("不支持");
  });

  it("rerender turnStatus 后 isSending 跟随更新", async () => {
    const { getState, rerenderWith } = await renderProbe({
      projectId: 1,
      sessionId: 10,
      turnStatus: "idle",
    });
    expect(getState()!.isSending).toBe(false);
    rerenderWith({ turnStatus: "running" });
    await waitFor(() => {
      expect(getState()!.isSending).toBe(true);
    });
  });

  it("rerender currentEffort 后 effort 跟随父级状态更新", async () => {
    const { getState, rerenderWith } = await renderProbe({
      projectId: 1,
      sessionId: 10,
      turnStatus: "idle",
      currentEffort: null,
    });
    expect(getState()!.effort).toBe("medium");

    rerenderWith({ currentEffort: "medium" });

    await waitFor(() => {
      expect(getState()!.effort).toBe("medium");
    });
  });
});
