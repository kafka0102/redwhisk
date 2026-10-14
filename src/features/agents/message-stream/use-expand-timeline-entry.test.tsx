import { render, waitFor } from "@testing-library/react";
import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentTimelineItem } from "../agent-stream-types";
import { messageStreamReducer } from "./message-stream-reducer";
import type {
  MessageStreamAction,
  MessageStreamState,
} from "./message-stream-types";
import { useExpandTimelineEntry } from "./use-expand-timeline-entry";

vi.mock("../agent-session-commands", () => ({
  readTimelineItemAtOffset: vi.fn(),
}));

const { readTimelineItemAtOffset } = await import("../agent-session-commands");
const readTimelineItemAtOffsetMock = vi.mocked(readTimelineItemAtOffset);

afterEach(() => {
  readTimelineItemAtOffsetMock.mockReset();
});

function placeholderState(): MessageStreamState {
  const hydrated = messageStreamReducer(
    messageStreamReducer(
      {
        entries: [],
        turnStatus: "idle",
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
      },
      {
        type: "HYDRATE",
        items: Array.from({ length: 51 }, (_, turn) => ({
          item: {
            type: "tool_call",
            callId: `call-${turn}`,
            name: "shell",
            status: "completed",
            detail: {
              type: "shell",
              command: `echo ${turn}`,
              output: `body-${turn}`,
              exitCode: 0,
            },
          } as AgentTimelineItem,
          turnId: `turn-${turn}`,
          logOffset: 1000 + turn,
        })),
      },
    ),
    { type: "SET_ENTRY_EXPANDED", entryId: "call-0", expanded: false },
  );
  return hydrated;
}

function Probe({
  state,
  onDispatch,
}: {
  state: MessageStreamState;
  onDispatch: (action: MessageStreamAction) => void;
}) {
  const expand = useExpandTimelineEntry(1, 7, state, onDispatch);
  return (
    <button type="button" onClick={() => expand("call-0", true)}>
      expand
    </button>
  );
}

describe("useExpandTimelineEntry", () => {
  it("展开占位时按记下的字节位置回读这一行", async () => {
    const loaded: AgentTimelineItem = {
      type: "tool_call",
      callId: "call-0",
      name: "shell",
      status: "completed",
      detail: {
        type: "shell",
        command: "echo 0",
        output: "body-0",
        exitCode: 0,
      },
    };
    readTimelineItemAtOffsetMock.mockResolvedValue(loaded);
    const state = placeholderState();
    const actions: MessageStreamAction[] = [];
    const view = render(
      <Probe
        state={state}
        onDispatch={(action) => {
          actions.push(action);
        }}
      />,
    );

    act(() => {
      view.getByRole("button").click();
    });

    await waitFor(() => {
      expect(readTimelineItemAtOffsetMock).toHaveBeenCalledWith({
        projectId: 1,
        sessionId: 7,
        logOffset: 1000,
      });
    });
    await waitFor(() => {
      expect(
        actions.some((action) => action.type === "RESTORE_ENTRY_BODY"),
      ).toBe(true);
    });
    const next = actions.reduce(
      (current, action) => messageStreamReducer(current, action),
      state,
    );
    const entry = next.entries.find((item) => item.id === "call-0");
    expect(entry?.item).toMatchObject({
      type: "tool_call",
      detail: { output: "body-0" },
    });
  });

  it("回读失败时占位还在，并留下失败说明", async () => {
    readTimelineItemAtOffsetMock.mockRejectedValue(new Error("read failed"));
    const state = placeholderState();
    const actions: MessageStreamAction[] = [];
    const view = render(
      <Probe
        state={state}
        onDispatch={(action) => {
          actions.push(action);
        }}
      />,
    );

    act(() => {
      view.getByRole("button").click();
    });

    await waitFor(() => {
      expect(
        actions.some((action) => action.type === "SET_ENTRY_LOAD_ERROR"),
      ).toBe(true);
    });
    const failed = actions.reduce(
      (current, action) => messageStreamReducer(current, action),
      state,
    );
    expect(failed.entryLoadErrors["call-0"]).toBeTruthy();
    const entry = failed.entries.find((item) => item.id === "call-0");
    expect(entry?.item).toMatchObject({
      type: "tool_call",
      name: "shell",
      status: "completed",
    });
    if (
      entry?.item.type === "tool_call" &&
      entry.item.detail.type === "shell"
    ) {
      expect(entry.item.detail.output).toBeUndefined();
    }
  });
});
