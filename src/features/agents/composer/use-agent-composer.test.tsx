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
  onMessageSent?: (message: string) => void;
  onState: (state: UseAgentComposerResult) => void;
}

function Probe({
  projectId,
  sessionId,
  turnStatus,
  onMessageSent,
  onState,
}: ProbeProps) {
  const state = useAgentComposer({
    projectId,
    sessionId,
    turnStatus,
    onMessageSent,
  });
  onState(state);
  return <div data-testid="probe" />;
}

type ProbeInput = Omit<ProbeProps, "onState">;

async function renderProbe(props: ProbeInput): Promise<{
  getState: () => UseAgentComposerResult | null;
  rerenderWith: (next: { turnStatus: TurnStatus }) => void;
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
      onMessageSent={props.onMessageSent}
      onState={captureState}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return {
    getState: () => latest,
    rerenderWith: (next: { turnStatus: TurnStatus }) => {
      result.rerender(
        <Probe
          projectId={props.projectId}
          sessionId={props.sessionId}
          turnStatus={next.turnStatus}
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

  it("handleSetEffort(null) 调用 setAgentThinking 且 effort=undefined", async () => {
    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 10,
      turnStatus: "idle",
    });
    await act(async () => {
      await getState()!.handleSetEffort(null);
    });
    expect(setAgentThinkingMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 10,
      effort: undefined,
    });
    expect(getState()!.effort).toBeNull();
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
    // 初始 effort 为 null，失败后回滚到 null
    expect(getState()!.effort).toBeNull();
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
});
