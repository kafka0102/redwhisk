import { render, waitFor } from "@testing-library/react";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AgentPermissionRequest,
  AgentStreamEventEnvelope,
  AgentTimelineItem,
  TimelineHistoryItem,
} from "../agent-stream-types";
import {
  clearAgentMessageStreamCacheForTest,
  isAgentMessageStreamSubscriptionStaleForTest,
  useAgentMessageStream,
} from "./use-agent-message-stream";
import type { MessageStreamState } from "./message-stream-types";

// vi.hoisted 让 mock 工厂与测试体共享同一份可变 listeners。
const mocks = vi.hoisted(() => ({
  listeners: [] as Array<{
    eventName: string;
    callback: (event: { payload: AgentStreamEventEnvelope }) => void;
  }>,
  unlisten: vi.fn(),
  listenError: null as Error | null,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    (
      eventName: string,
      callback: (event: { payload: AgentStreamEventEnvelope }) => void,
    ) => {
      if (mocks.listenError) {
        return Promise.reject(mocks.listenError);
      }
      mocks.listeners.push({ eventName, callback });
      return Promise.resolve(mocks.unlisten);
    },
  ),
}));

vi.mock("../agent-session-commands", () => ({
  readAgentTimeline: vi.fn(),
}));

const { readAgentTimeline } = await import("../agent-session-commands");
const readAgentTimelineMock = vi.mocked(readAgentTimeline);

function historyItems(items: AgentTimelineItem[]): TimelineHistoryItem[] {
  return items.map((item) => ({ item }));
}

function permissionRequest(id: string): AgentPermissionRequest {
  return { id, kind: "tool", actions: [] };
}

let originalRequestAnimationFrame: typeof window.requestAnimationFrame;
let originalCancelAnimationFrame: typeof window.cancelAnimationFrame;

beforeEach(() => {
  originalRequestAnimationFrame = window.requestAnimationFrame;
  originalCancelAnimationFrame = window.cancelAnimationFrame;
  window.requestAnimationFrame = (callback) =>
    window.setTimeout(() => callback(performance.now()), 16);
  window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
});

afterEach(() => {
  window.requestAnimationFrame = originalRequestAnimationFrame;
  window.cancelAnimationFrame = originalCancelAnimationFrame;
  clearAgentMessageStreamCacheForTest();
  mocks.listenError = null;
  vi.useRealTimers();
});

interface ProbeProps {
  projectId: number;
  sessionId: number;
  onState: (state: ReturnType<typeof useAgentMessageStream>) => void;
}

function Probe({ projectId, sessionId, onState }: ProbeProps) {
  const result = useAgentMessageStream({ projectId, sessionId });
  onState(result);
  return <div data-testid="probe" />;
}

async function renderProbe(props: ProbeProps) {
  let latest: MessageStreamState | null = null;
  let latestDispatch:
    | ReturnType<typeof useAgentMessageStream>["dispatch"]
    | null = null;
  const captureState = (result: ReturnType<typeof useAgentMessageStream>) => {
    latest = result.state;
    latestDispatch = result.dispatch;
  };
  const result = render(
    <Probe
      projectId={props.projectId}
      sessionId={props.sessionId}
      onState={captureState}
    />,
  );
  // 等待 effects（含 readAgentTimeline 与 listen）落地。
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    result,
    getState: () => latest,
    dispatch: (action: Parameters<NonNullable<typeof latestDispatch>>[0]) => {
      act(() => {
        latestDispatch?.(action);
      });
    },
    /** rerender 时复用同一份 state 捕获器，保证 getState 始终读到最新值。 */
    rerenderWith: (next: { projectId: number; sessionId: number }) => {
      result.rerender(
        <Probe
          projectId={next.projectId}
          sessionId={next.sessionId}
          onState={captureState}
        />,
      );
    },
  };
}

describe("useAgentMessageStream", () => {
  function dispatchFrame() {
    act(() => {
      vi.advanceTimersByTime(16);
      vi.advanceTimersByTime(1);
    });
  }

  it("readAgentTimeline 完成后用历史 timeline 种子 state", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([
        { type: "user_message", text: "你好", messageId: "u1" },
        { type: "assistant_message", text: "你好！", messageId: "a1" },
      ]),
      effort: null,
      model: null,
    });
    mocks.listeners.length = 0;

    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 10,
      onState: () => {},
    });
    const state = getState()!;
    expect(state.isInitialized).toBe(true);
    expect(state.entries).toHaveLength(2);
    expect(state.entries[0].id).toBe("u1");
  });

  it("readAgentTimeline 完成后用历史 effort 初始化 state", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([]),
      effort: "high",
      model: null,
    });
    mocks.listeners.length = 0;

    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 10,
      onState: () => {},
    });
    const state = getState()!;
    expect(state.isInitialized).toBe(true);
    expect(state.entries).toEqual([]);
    expect(state.effort).toBe("high");
  });

  it("readAgentTimeline 完成后用历史 model 初始化 state", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([]),
      effort: null,
      model: "gpt-5.2",
    });
    mocks.listeners.length = 0;

    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 10,
      onState: () => {},
    });
    const state = getState()!;
    expect(state.isInitialized).toBe(true);
    expect(state.entries).toEqual([]);
    expect(state.model).toBe("gpt-5.2");
  });

  it("readAgentTimeline 失败时设置 error 并标记 initialized", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockRejectedValue(new Error("db error"));
    mocks.listeners.length = 0;

    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 11,
      onState: () => {},
    });
    const state = getState()!;
    expect(state.isInitialized).toBe(true);
    expect(state.lastError).toBe("db error");
  });

  it("事件流到达后 dispatch 到 state", async () => {
    vi.useFakeTimers();
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([]),
      effort: null,
      model: null,
    });
    mocks.listeners.length = 0;

    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 12,
      onState: () => {},
    });

    act(() => {
      mocks.listeners[0].callback({
        payload: {
          projectId: 1,
          sessionId: 12,
          seq: 1,
          epoch: "epoch-1",
          event: { type: "turn_started", turnId: "t1" },
        },
      });
    });

    dispatchFrame();
    expect(getState()!.turnStatus).toBe("running");
    vi.useRealTimers();
  });

  it("同一帧内的事件流批量 dispatch 到 state", async () => {
    vi.useFakeTimers();
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([]),
      effort: null,
      model: null,
    });
    mocks.listeners.length = 0;

    const { getState, result } = await renderProbe({
      projectId: 1,
      sessionId: 120,
      onState: () => {},
    });

    act(() => {
      mocks.listeners[0].callback({
        payload: {
          projectId: 1,
          sessionId: 120,
          seq: 1,
          epoch: "epoch-1",
          event: {
            type: "timeline",
            item: { type: "assistant_message", text: "你", messageId: "a1" },
            seq: 1,
            timestamp: 0,
          },
        },
      });
      mocks.listeners[0].callback({
        payload: {
          projectId: 1,
          sessionId: 120,
          seq: 2,
          epoch: "epoch-1",
          event: {
            type: "timeline",
            item: {
              type: "assistant_message",
              text: "你好",
              messageId: "a1",
            },
            seq: 2,
            timestamp: 0,
          },
        },
      });
    });

    expect(getState()!.entries).toHaveLength(0);

    dispatchFrame();

    expect(getState()!.entries).toHaveLength(1);
    expect(getState()!.entries[0].item).toEqual({
      type: "assistant_message",
      text: "你好",
      messageId: "a1",
    });

    result.unmount();
  });

  it("同一帧内 turn_completed 不越过未 flush 的 timeline，避免误恢复 running", async () => {
    vi.useFakeTimers();
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([]),
      effort: null,
      model: null,
    });
    mocks.listeners.length = 0;

    const { getState, result } = await renderProbe({
      projectId: 1,
      sessionId: 121,
      onState: () => {},
    });

    act(() => {
      mocks.listeners[0].callback({
        payload: {
          projectId: 1,
          sessionId: 121,
          seq: 1,
          epoch: "epoch-1",
          event: { type: "turn_started", turnId: "t-race" },
        },
      });
      mocks.listeners[0].callback({
        payload: {
          projectId: 1,
          sessionId: 121,
          seq: 2,
          epoch: "epoch-1",
          event: {
            type: "timeline",
            item: {
              type: "tool_call",
              callId: "call_1",
              name: "shell",
              detail: { type: "shell", command: "git status" },
              status: "completed",
            },
            seq: 2,
            timestamp: 0,
          },
        },
      });
      mocks.listeners[0].callback({
        payload: {
          projectId: 1,
          sessionId: 121,
          seq: 3,
          epoch: "epoch-1",
          event: {
            type: "timeline",
            item: {
              type: "assistant_message",
              text: "已完成",
              messageId: "a-race",
            },
            seq: 3,
            timestamp: 0,
          },
        },
      });
      mocks.listeners[0].callback({
        payload: {
          projectId: 1,
          sessionId: 121,
          seq: 4,
          epoch: "epoch-1",
          event: {
            type: "turn_completed",
            turnId: "t-race",
            usage: null,
            stopReason: "end_turn",
          },
        },
      });
    });

    // 未 flush 前不应提前应用 turn_completed，否则会把 tool_call 当成末条异常中断。
    expect(getState()!.turnStatus).toBe("idle");
    expect(getState()!.entries).toHaveLength(0);

    dispatchFrame();

    const state = getState()!;
    const visible = state.entries.filter(
      (entry) => entry.kind !== "turn_boundary",
    );
    expect(state.turnStatus).toBe("idle");
    expect(state.turnInterrupted).toBe(false);
    expect(visible).toHaveLength(2);
    expect(visible[1].item).toEqual({
      type: "assistant_message",
      text: "已完成",
      messageId: "a-race",
    });

    result.unmount();
    vi.useRealTimers();
  });

  it("首次进入后的实时工具调用记下信封上的回读位置", async () => {
    vi.useFakeTimers();
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([]),
      effort: null,
      model: null,
    });
    mocks.listeners.length = 0;

    const { getState, result } = await renderProbe({
      projectId: 1,
      sessionId: 122,
      onState: () => {},
    });

    act(() => {
      mocks.listeners[0].callback({
        payload: {
          projectId: 1,
          sessionId: 122,
          seq: 1,
          epoch: "epoch-1",
          logOffset: 4096,
          event: {
            type: "timeline",
            item: {
              type: "tool_call",
              callId: "call-live",
              name: "shell",
              detail: { type: "shell", command: "echo", output: "now" },
              status: "completed",
            },
            seq: 1,
            timestamp: 0,
          },
        },
      });
    });
    dispatchFrame();

    const tool = getState()!.entries.find(
      (entry) => entry.kind === "tool_call",
    );
    expect(tool?.logOffset).toBe(4096);

    result.unmount();
    vi.useRealTimers();
  });

  it("忽略其它 projectId/sessionId 的事件", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([]),
      effort: null,
      model: null,
    });
    mocks.listeners.length = 0;

    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 13,
      onState: () => {},
    });

    act(() => {
      mocks.listeners[0].callback({
        payload: {
          projectId: 1,
          sessionId: 999,
          seq: 1,
          epoch: "epoch-1",
          event: { type: "turn_started", turnId: "t1" },
        },
      });
    });

    expect(getState()!.turnStatus).toBe("idle");
  });

  it("unmount 时调用 unlisten", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([]),
      effort: null,
      model: null,
    });
    mocks.listeners.length = 0;
    mocks.unlisten.mockClear();

    const { result } = await renderProbe({
      projectId: 1,
      sessionId: 14,
      onState: () => {},
    });
    result.unmount();
    expect(mocks.unlisten).toHaveBeenCalled();
  });

  it("切换 session 时重置 state", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([
        { type: "user_message", text: "旧", messageId: "u1" },
      ]),
      effort: null,
      model: null,
    });
    mocks.listeners.length = 0;

    const { getState, rerenderWith } = await renderProbe({
      projectId: 1,
      sessionId: 15,
      onState: () => {},
    });
    expect(getState()!.entries).toHaveLength(1);

    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([
        { type: "user_message", text: "新", messageId: "u2" },
      ]),
      effort: null,
      model: null,
    });

    rerenderWith({ projectId: 1, sessionId: 16 });

    await waitFor(() => {
      expect(readAgentTimelineMock).toHaveBeenCalledWith({
        projectId: 1,
        sessionId: 16,
      });
    });
    await waitFor(() => {
      expect(getState()!.entries[0]?.id).toBe("u2");
    });

    const state = getState()!;
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].id).toBe("u2");
  });

  it("切回没有日志字节的缓存时恢复整段消息流，不再重读打开回放", async () => {
    vi.useFakeTimers();
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValueOnce({
      items: historyItems([
        { type: "user_message", text: "旧", messageId: "u1" },
      ]),
      effort: null,
      model: null,
    });
    readAgentTimelineMock.mockResolvedValueOnce({
      items: historyItems([
        { type: "user_message", text: "新", messageId: "u2" },
      ]),
      effort: null,
      model: null,
    });
    mocks.listeners.length = 0;

    const { getState, rerenderWith } = await renderProbe({
      projectId: 1,
      sessionId: 17,
      onState: () => {},
    });
    expect(getState()!.entries[0]?.id).toBe("u1");

    rerenderWith({ projectId: 1, sessionId: 18 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getState()!.entries[0]?.id).toBe("u2");

    const readsBeforeReturn = readAgentTimelineMock.mock.calls.length;
    rerenderWith({ projectId: 1, sessionId: 17 });

    expect(getState()!.entries[0]?.id).toBe("u1");
    expect(getState()!.entries[0]?.item).toMatchObject({ text: "旧" });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readAgentTimelineMock.mock.calls.length).toBe(readsBeforeReturn);
    expect(getState()!.entries[0]?.id).toBe("u1");
  });

  it("切回已缓存会话时按日志字节补上离开期间的最终正文", async () => {
    vi.useFakeTimers();
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValueOnce({
      items: [
        {
          item: {
            type: "assistant_message",
            text: "离开时的正文",
            messageId: "msg-final",
          },
          logOffset: 100,
        },
      ],
      effort: null,
      model: null,
      windowEndOffset: 100,
    });
    readAgentTimelineMock.mockResolvedValueOnce({
      items: historyItems([
        { type: "user_message", text: "其它会话", messageId: "other" },
      ]),
      effort: null,
      model: null,
    });
    readAgentTimelineMock.mockResolvedValueOnce({
      items: [
        {
          item: {
            type: "assistant_message",
            text: "离开后的完整正文",
            messageId: "msg-final",
          },
          logOffset: 480,
        },
      ],
      effort: null,
      model: null,
      windowEndOffset: 480,
      resetRequired: false,
    });
    mocks.listeners.length = 0;

    const { getState, rerenderWith } = await renderProbe({
      projectId: 1,
      sessionId: 19,
      onState: () => {},
    });
    expect(getState()!.entries[0]?.item).toMatchObject({
      text: "离开时的正文",
    });

    rerenderWith({ projectId: 1, sessionId: 20 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    rerenderWith({ projectId: 1, sessionId: 19 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    dispatchFrame();

    expect(readAgentTimelineMock).toHaveBeenLastCalledWith({
      projectId: 1,
      sessionId: 19,
      sinceLogOffset: 100,
    });
    expect(getState()!.entries).toHaveLength(1);
    expect(getState()!.entries[0]?.item).toMatchObject({
      text: "离开后的完整正文",
    });
  });

  it("同一批增量再应用一次时正文不重复", async () => {
    vi.useFakeTimers();
    const finalItem = {
      item: {
        type: "assistant_message" as const,
        text: "离开后的完整正文",
        messageId: "msg-final",
      },
      logOffset: 480,
    };
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValueOnce({
      items: [
        {
          item: {
            type: "assistant_message",
            text: "离开时的正文",
            messageId: "msg-final",
          },
          logOffset: 100,
        },
      ],
      effort: null,
      model: null,
      windowEndOffset: 100,
    });
    readAgentTimelineMock.mockResolvedValue({
      items: [finalItem],
      effort: null,
      model: null,
      windowEndOffset: 480,
      resetRequired: false,
    });
    mocks.listeners.length = 0;

    const { getState, rerenderWith } = await renderProbe({
      projectId: 1,
      sessionId: 21,
      onState: () => {},
    });

    rerenderWith({ projectId: 1, sessionId: 22 });
    await act(async () => {
      await Promise.resolve();
    });
    rerenderWith({ projectId: 1, sessionId: 21 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    dispatchFrame();
    rerenderWith({ projectId: 1, sessionId: 22 });
    await act(async () => {
      await Promise.resolve();
    });
    rerenderWith({ projectId: 1, sessionId: 21 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    dispatchFrame();

    const messages = getState()!.entries.filter(
      (entry) => entry.id === "msg-final",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.item).toMatchObject({ text: "离开后的完整正文" });
  });

  it("日志游标失效时整份替换，并保留已展开的条目", async () => {
    vi.useFakeTimers();
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValueOnce({
      items: [
        {
          item: {
            type: "tool_call",
            callId: "call-1",
            name: "read",
            status: "running",
            detail: { type: "read", path: "a.ts" },
          },
          logOffset: 100,
        },
      ],
      effort: null,
      model: null,
      windowEndOffset: 100,
    });
    readAgentTimelineMock.mockResolvedValueOnce({
      items: historyItems([
        { type: "user_message", text: "其它", messageId: "other" },
      ]),
      effort: null,
      model: null,
    });
    readAgentTimelineMock.mockResolvedValueOnce({
      items: [],
      effort: null,
      model: null,
      resetRequired: true,
    });
    readAgentTimelineMock.mockResolvedValueOnce({
      items: [
        {
          item: {
            type: "assistant_message",
            text: "归档后的正文",
            messageId: "msg-reset",
          },
          logOffset: 20,
        },
      ],
      effort: null,
      model: null,
      windowEndOffset: 20,
    });
    mocks.listeners.length = 0;

    const { getState, rerenderWith, dispatch } = await renderProbe({
      projectId: 1,
      sessionId: 23,
      onState: () => {},
    });
    const toolId = getState()!.entries[0]?.id;
    expect(toolId).toBeTruthy();
    dispatch({
      type: "SET_ENTRY_EXPANDED",
      entryId: toolId!,
      expanded: true,
    });
    expect(getState()!.expandedEntryIds).toContain(toolId);

    rerenderWith({ projectId: 1, sessionId: 24 });
    await act(async () => {
      await Promise.resolve();
    });
    rerenderWith({ projectId: 1, sessionId: 23 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    dispatchFrame();

    expect(getState()!.entries.map((entry) => entry.id)).toEqual(["msg-reset"]);
    expect(getState()!.entries[0]?.item).toMatchObject({
      text: "归档后的正文",
    });
    expect(getState()!.expandedEntryIds).toContain(toolId);
  });

  it("订阅失败会记下过期标记，再次进入后清除并补上正文", async () => {
    vi.useFakeTimers();
    mocks.listenError = new Error("listen failed");
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValueOnce({
      items: [
        {
          item: {
            type: "assistant_message",
            text: "离开时的正文",
            messageId: "msg-final",
          },
          logOffset: 100,
        },
      ],
      effort: null,
      model: null,
      windowEndOffset: 100,
    });
    readAgentTimelineMock.mockResolvedValueOnce({
      items: historyItems([
        { type: "user_message", text: "垫一场", messageId: "pad" },
      ]),
      effort: null,
      model: null,
    });
    readAgentTimelineMock.mockResolvedValueOnce({
      items: [
        {
          item: {
            type: "assistant_message",
            text: "订阅恢复后的正文",
            messageId: "msg-final",
          },
          logOffset: 220,
        },
      ],
      effort: null,
      model: null,
      windowEndOffset: 220,
      resetRequired: false,
    });
    mocks.listeners.length = 0;

    const { getState, rerenderWith } = await renderProbe({
      projectId: 1,
      sessionId: 25,
      onState: () => {},
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(isAgentMessageStreamSubscriptionStaleForTest(1, 25)).toBe(true);

    mocks.listenError = null;
    rerenderWith({ projectId: 1, sessionId: 26 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    rerenderWith({ projectId: 1, sessionId: 25 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    dispatchFrame();

    expect(isAgentMessageStreamSubscriptionStaleForTest(1, 25)).toBe(false);
    expect(getState()!.entries[0]?.item).toMatchObject({
      text: "订阅恢复后的正文",
    });
  });

  it("离开期间 turn 已结束，切回缓存会话不应继续显示运行中", async () => {
    vi.useFakeTimers();
    readAgentTimelineMock.mockReset();
    // 首次进入：冷读带一条已落盘正文，游标 100。
    readAgentTimelineMock.mockResolvedValueOnce({
      items: [
        {
          item: { type: "assistant_message", text: "开始", messageId: "m0" },
          logOffset: 100,
        },
      ],
      effort: null,
      model: null,
      windowEndOffset: 100,
    });
    // 离开后切到别的会话。
    readAgentTimelineMock.mockResolvedValueOnce({
      items: historyItems([
        { type: "user_message", text: "其它会话", messageId: "other" },
      ]),
      effort: null,
      model: null,
    });
    // 切回：按日志字节补齐离开期间落盘的正文，此时该轮已经结束。
    readAgentTimelineMock.mockResolvedValueOnce({
      items: [
        {
          item: {
            type: "assistant_message",
            text: "离开后完成的正文",
            messageId: "m1",
          },
          logOffset: 480,
        },
      ],
      effort: null,
      model: null,
      windowEndOffset: 480,
      resetRequired: false,
    });
    mocks.listeners.length = 0;

    const { getState, rerenderWith } = await renderProbe({
      projectId: 1,
      sessionId: 31,
      onState: () => {},
    });

    act(() => {
      mocks.listeners[0].callback({
        payload: {
          projectId: 1,
          sessionId: 31,
          seq: 1,
          epoch: "epoch-1",
          event: { type: "turn_started", turnId: "t1" },
        },
      });
    });
    dispatchFrame();
    expect(getState()!.turnStatus).toBe("running");

    rerenderWith({ projectId: 1, sessionId: 32 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    rerenderWith({ projectId: 1, sessionId: 31 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    dispatchFrame();

    const visible = getState()!.entries.filter(
      (entry) => entry.kind !== "turn_boundary",
    );
    expect(visible[visible.length - 1]?.item).toMatchObject({
      text: "离开后完成的正文",
    });
    expect(getState()!.turnStatus).toBe("idle");
    vi.useRealTimers();
  });

  it("首次进入会话时按日志快照恢复待审批卡片", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValueOnce({
      items: historyItems([
        { type: "user_message", text: "开始", messageId: "u1" },
      ]),
      effort: null,
      model: null,
      pendingPermissions: [permissionRequest("perm-restart")],
    });
    mocks.listeners.length = 0;

    const { getState } = await renderProbe({
      projectId: 1,
      sessionId: 41,
      onState: () => {},
    });

    expect(getState()!.pendingPermissions.map(({ id }) => id)).toEqual([
      "perm-restart",
    ]);
  });

  it("离开期间挂起的审批在切回会话时补回卡片", async () => {
    vi.useFakeTimers();
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValueOnce({
      items: [
        {
          item: { type: "assistant_message", text: "开始", messageId: "m0" },
          logOffset: 100,
        },
      ],
      effort: null,
      model: null,
      windowEndOffset: 100,
    });
    readAgentTimelineMock.mockResolvedValueOnce({
      items: historyItems([
        { type: "user_message", text: "其它会话", messageId: "other" },
      ]),
      effort: null,
      model: null,
    });
    // 补读：离开期间没有新正文，只有一条挂起等待审批的请求。
    readAgentTimelineMock.mockResolvedValueOnce({
      items: [],
      effort: null,
      model: null,
      windowEndOffset: 100,
      resetRequired: false,
      pendingPermissions: [permissionRequest("perm-waiting")],
    });
    mocks.listeners.length = 0;

    const { getState, rerenderWith } = await renderProbe({
      projectId: 1,
      sessionId: 42,
      onState: () => {},
    });
    expect(getState()!.pendingPermissions).toEqual([]);

    rerenderWith({ projectId: 1, sessionId: 43 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    rerenderWith({ projectId: 1, sessionId: 42 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    dispatchFrame();

    expect(getState()!.pendingPermissions.map(({ id }) => id)).toEqual([
      "perm-waiting",
    ]);
    vi.useRealTimers();
  });
});
