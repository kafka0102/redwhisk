import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentMessageStreamView } from "./agent-message-stream";
import {
  PARENT_OUTPUT_STALL_MS,
  parentActivityKey,
  useParentOutputStalled,
} from "./parent-output-stall";
import type {
  MessageStreamEntry,
  MessageStreamState,
} from "./message-stream-types";

function userEntry(id: string): MessageStreamEntry {
  return {
    id,
    kind: "user_message",
    item: { type: "user_message", text: id, messageId: id },
  };
}

function assistantEntry(
  id: string,
  text: string,
  subagentId?: string,
): MessageStreamEntry {
  return {
    id,
    kind: "assistant_message",
    item: { type: "assistant_message", text, messageId: id, subagentId },
  };
}

function shellEntry(
  id: string,
  status: "running" | "completed",
  output = "",
): MessageStreamEntry {
  return {
    id,
    kind: "tool_call",
    item: {
      type: "tool_call",
      callId: id,
      name: "shell",
      status,
      detail: { type: "shell", command: "pnpm test", output },
    },
  };
}

function runningState(entries: MessageStreamEntry[]): MessageStreamState {
  return {
    entries,
    turnStatus: "running",
    usage: null,
    pendingPermissions: [],
    mode: null,
    model: null,
    effort: null,
    lastSeq: null,
    lastError: null,
    turnInterrupted: false,
    interruptedStopReason: null,
    subagentInterrupted: false,
    subagents: [],
    isInitialized: true,
    expandedEntryIds: [],
    entryLoadErrors: {},
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("parentActivityKey", () => {
  it("子智能体输出不改变父会话活动标记", () => {
    const before = [userEntry("u1"), shellEntry("call-1", "running")];
    const after = [
      ...before,
      assistantEntry("child", "子线程还在写", "thr_child"),
    ];
    expect(parentActivityKey(after)).toBe(parentActivityKey(before));
  });

  it("父会话新正文、工具状态和后一次用户消息会改变活动标记", () => {
    const base = [userEntry("u1")];
    const withAssistant = [...base, assistantEntry("a1", "先看")];
    const longer = [...base, assistantEntry("a1", "先看规格")];
    const completed = [...base, shellEntry("call-1", "completed", "ok")];
    const nextUser = [...completed, userEntry("u2")];
    expect(parentActivityKey(withAssistant)).not.toBe(parentActivityKey(base));
    expect(parentActivityKey(longer)).not.toBe(
      parentActivityKey(withAssistant),
    );
    expect(parentActivityKey(completed)).not.toBe(parentActivityKey(base));
    expect(parentActivityKey(nextUser)).not.toBe(parentActivityKey(completed));
  });
});

describe("useParentOutputStalled", () => {
  it("父会话 3 分钟没有新输出后才算停滞，子智能体输出不重新计时", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T16:01:50Z"));
    const entries = [userEntry("u1"), shellEntry("call-1", "completed")];
    const hook = renderHook(
      ({ items, active }) => useParentOutputStalled(items, active),
      { initialProps: { items: entries, active: true } },
    );
    expect(hook.result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(PARENT_OUTPUT_STALL_MS - 1);
    });
    expect(hook.result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(hook.result.current).toBe(true);

    hook.rerender({
      items: [...entries, assistantEntry("child", "还在写", "thr_child")],
      active: true,
    });
    expect(hook.result.current).toBe(true);

    hook.rerender({
      items: [...entries, assistantEntry("a2", "父会话继续")],
      active: true,
    });
    expect(hook.result.current).toBe(false);

    hook.rerender({ items: entries, active: false });
    expect(hook.result.current).toBe(false);
  });
});

describe("AgentMessageStreamView parent output stall", () => {
  it("把正在思考换成超过 3 分钟没有新输出", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T16:01:50Z"));
    render(
      <AgentMessageStreamView
        sessionFileLinks={undefined}
        agentType="grok"
        isTurnRunning
        state={runningState([userEntry("u1")])}
      />,
    );
    expect(screen.getByText("Thinking...")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(PARENT_OUTPUT_STALL_MS);
    });
    expect(screen.getByText("No new output for 3 minutes")).toBeInTheDocument();
    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
  });
});
