// Codex json 在当前 Turn 仍运行时，把输入框消息插入这一轮。
// 没有可插入的 Turn 时立刻新开一轮；其它拒绝退回排队追问。

import type { TFunction } from "i18next";

import { getCommandErrorMessage } from "../../../shared/commands/command-error";
import { sendAgentMessage, steerAgentTurn } from "../agent-session-commands";
import type { AgentMessageAttachment } from "../agent-session-commands";

export interface SteerRunningTurnInput {
  projectId: number;
  sessionId: number;
  message: string;
  attachments: AgentMessageAttachment[];
  onBeforeSend?: () => Promise<void>;
  onMessageSent?: (message: string) => void;
  t: TFunction;
}

export type SteerRunningTurnResult =
  | { kind: "steered" }
  | { kind: "started" }
  | { kind: "queue" }
  | { kind: "failed"; message: string };

function isNoSteerableTurn(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    "reason" in error &&
    (error as { reason?: unknown }).reason === "noSteerableTurn"
  );
}

export async function steerOrStartRunningTurn(
  input: SteerRunningTurnInput,
): Promise<SteerRunningTurnResult> {
  try {
    await input.onBeforeSend?.();
    await steerAgentTurn({
      projectId: input.projectId,
      sessionId: input.sessionId,
      message: input.message,
      attachments: input.attachments,
    });
    input.onMessageSent?.(input.message);
    return { kind: "steered" };
  } catch (error) {
    if (!isNoSteerableTurn(error)) {
      return { kind: "queue" };
    }
  }
  try {
    await sendAgentMessage({
      projectId: input.projectId,
      sessionId: input.sessionId,
      message: input.message,
      attachments: input.attachments,
    });
    input.onMessageSent?.(input.message);
    return { kind: "started" };
  } catch (error) {
    return {
      kind: "failed",
      message: getCommandErrorMessage(error, input.t),
    };
  }
}
