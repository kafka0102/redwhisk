import type { ToolCallDetail } from "../agent-stream-types";

/**
 * 合并同一 callId 的两个 ToolCallDetail（字段级合并）。
 *
 * tool_use 先建立摘要，tool_result 再回填正文。incoming 非空字段覆盖
 * existing，空字段保留 existing。type 不一致时以 incoming 为准。
 */
export function mergeToolCallDetail(
  existing: ToolCallDetail,
  incoming: ToolCallDetail,
): ToolCallDetail {
  if (existing.type !== incoming.type) {
    return incoming;
  }
  switch (incoming.type) {
    case "shell": {
      const prev = existing as Extract<ToolCallDetail, { type: "shell" }>;
      return {
        type: "shell",
        command: incoming.command || prev.command,
        output: incoming.output ?? prev.output,
        exitCode: incoming.exitCode ?? prev.exitCode,
      };
    }
    case "read": {
      const prev = existing as Extract<ToolCallDetail, { type: "read" }>;
      return {
        type: "read",
        path: incoming.path || prev.path,
        content: incoming.content ?? prev.content,
      };
    }
    case "edit": {
      const prev = existing as Extract<ToolCallDetail, { type: "edit" }>;
      return {
        type: "edit",
        path: incoming.path || prev.path,
        diff: incoming.diff ?? prev.diff,
      };
    }
    case "write": {
      const prev = existing as Extract<ToolCallDetail, { type: "write" }>;
      return {
        type: "write",
        path: incoming.path || prev.path,
        content: incoming.content ?? prev.content,
      };
    }
    case "search": {
      const prev = existing as Extract<ToolCallDetail, { type: "search" }>;
      return {
        type: "search",
        query: incoming.query || prev.query,
        mode: incoming.mode,
        matches: incoming.matches.length > 0 ? incoming.matches : prev.matches,
      };
    }
    case "sub_agent": {
      const prev = existing as Extract<ToolCallDetail, { type: "sub_agent" }>;
      return {
        type: "sub_agent",
        childSessionId: incoming.childSessionId ?? prev.childSessionId,
      };
    }
    case "collab_agent": {
      const prev = existing as Extract<
        ToolCallDetail,
        { type: "collab_agent" }
      >;
      return {
        type: "collab_agent",
        prompt: incoming.prompt?.trim() ? incoming.prompt : prev.prompt,
        receiverThreadIds:
          incoming.receiverThreadIds.length > 0
            ? incoming.receiverThreadIds
            : prev.receiverThreadIds,
        senderThreadId: incoming.senderThreadId ?? prev.senderThreadId,
      };
    }
    case "plan": {
      return {
        type: "plan",
        text: incoming.text,
      };
    }
    case "unknown": {
      const prev = existing as Extract<ToolCallDetail, { type: "unknown" }>;
      return {
        type: "unknown",
        rawInput: incoming.rawInput ?? prev.rawInput,
        rawOutput: incoming.rawOutput ?? prev.rawOutput,
      };
    }
    default:
      return incoming;
  }
}
