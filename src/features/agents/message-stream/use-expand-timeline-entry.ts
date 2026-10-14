// 展开可折叠项：热区内只记展开；占位按记下的字节位置回读这一行。

import { useEffect, useRef } from "react";
import type { Dispatch } from "react";

import { readTimelineItemAtOffset } from "../agent-session-commands";
import type {
  MessageStreamAction,
  MessageStreamState,
} from "./message-stream-types";
import { getCommandErrorMessage } from "../../../shared/commands/command-error";
import { useI18n } from "../../../shared/i18n/i18n";

export function useExpandTimelineEntry(
  projectId: number,
  sessionId: number,
  state: MessageStreamState,
  dispatch: Dispatch<MessageStreamAction>,
): (entryId: string, expanded: boolean) => void {
  const { t } = useI18n();
  const requestId = useRef(0);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    requestId.current += 1;
  }, [projectId, sessionId]);

  return (entryId: string, expanded: boolean) => {
    dispatch({ type: "SET_ENTRY_EXPANDED", entryId, expanded });
    if (!expanded) {
      return;
    }
    const entry = stateRef.current.entries.find((item) => item.id === entryId);
    if (!entry || entry.item.type !== "tool_call" || entry.logOffset == null) {
      return;
    }
    if (hasToolCallBody(entry.item.detail)) {
      return;
    }
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    const logOffset = entry.logOffset;
    void readTimelineItemAtOffset({ projectId, sessionId, logOffset })
      .then((item) => {
        if (requestId.current !== currentRequest) {
          return;
        }
        dispatch({ type: "RESTORE_ENTRY_BODY", entryId, item });
      })
      .catch((error: unknown) => {
        if (requestId.current !== currentRequest) {
          return;
        }
        dispatch({
          type: "SET_ENTRY_LOAD_ERROR",
          entryId,
          error: getCommandErrorMessage(error, t),
        });
      });
  };
}

function hasToolCallBody(
  detail: Extract<
    import("../agent-stream-types").AgentTimelineItem,
    { type: "tool_call" }
  >["detail"],
): boolean {
  switch (detail.type) {
    case "shell":
      return detail.output != null;
    case "read":
    case "write":
      return detail.content != null;
    case "edit":
      return detail.diff != null;
    case "search":
      return detail.matches.length > 0;
    case "plan":
      return detail.text.length > 0;
    case "unknown":
      return detail.rawOutput != null;
    default:
      return true;
  }
}
