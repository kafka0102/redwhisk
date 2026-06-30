import { render, waitFor } from "@testing-library/react";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentStreamEventEnvelope } from "../agent-stream-types";
import {
  clearAgentMessageStreamCacheForTest,
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
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    (
      eventName: string,
      callback: (event: { payload: AgentStreamEventEnvelope }) => void,
    ) => {
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
  const captureState = (result: ReturnType<typeof useAgentMessageStream>) => {
    latest = result.state;
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
    });
  }

  it("readAgentTimeline 完成后用历史 timeline 种子 state", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: [
        { type: "user_message", text: "你好", messageId: "u1" },
        { type: "assistant_message", text: "你好！", messageId: "a1" },
      ],
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
      items: [],
      effort: "high",
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
    readAgentTimelineMock.mockResolvedValue({ items: [] });
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
    readAgentTimelineMock.mockResolvedValue({ items: [] });
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

  it("忽略其它 projectId/sessionId 的事件", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({ items: [] });
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
    readAgentTimelineMock.mockResolvedValue({ items: [] });
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
      items: [{ type: "user_message", text: "旧", messageId: "u1" }],
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
      items: [{ type: "user_message", text: "新", messageId: "u2" }],
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

  it("切回已缓存 session 时恢复对应 state", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValueOnce({
      items: [{ type: "user_message", text: "旧", messageId: "u1" }],
    });
    readAgentTimelineMock.mockResolvedValueOnce({
      items: [{ type: "user_message", text: "新", messageId: "u2" }],
    });
    mocks.listeners.length = 0;

    const { getState, rerenderWith } = await renderProbe({
      projectId: 1,
      sessionId: 17,
      onState: () => {},
    });
    expect(getState()!.entries[0]?.id).toBe("u1");

    rerenderWith({ projectId: 1, sessionId: 18 });
    await waitFor(() => {
      expect(getState()!.entries[0]?.id).toBe("u2");
    });

    readAgentTimelineMock.mockClear();
    rerenderWith({ projectId: 1, sessionId: 17 });

    await waitFor(() => {
      expect(getState()!.entries[0]?.id).toBe("u1");
    });
    expect(readAgentTimelineMock).not.toHaveBeenCalled();
  });
});
