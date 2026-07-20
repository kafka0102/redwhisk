import {
  injectAgentSessionPrompt,
  resumeStructuredAgentSession,
  type InjectAgentSessionPromptInput,
  type InjectAgentSessionPromptResult,
} from "./agent-session-commands";
import { toCommandError } from "../../shared/commands/command-error";

/**
 * 向 Session 注入 prompt；会话已在运行（structured handle 或 TUI PTY）时直接注入。
 *
 * worktree 合并 handoff / merge prompt 确认路径使用：
 * - 旧路径无条件先 resume，Codex TUI 等缺少 `codex_session_id` 的 live session 会误报
 *   `missingResumeSessionId`，尽管 inject 本可经 PTY 成功。
 * - 仅在 inject 明确回报 notRunning 时再 resume 重建 handle，随后重试 inject。
 */
export async function injectSessionPromptWithResume(
  input: InjectAgentSessionPromptInput,
): Promise<InjectAgentSessionPromptResult> {
  try {
    return await injectAgentSessionPrompt(input);
  } catch (error) {
    if (!isNotRunningForInjectError(error)) {
      throw error;
    }
  }

  await resumeStructuredAgentSession({
    projectId: input.projectId,
    sessionId: input.sessionId,
  });
  return injectAgentSessionPrompt(input);
}

function isNotRunningForInjectError(error: unknown): boolean {
  const commandError = toCommandError(error);
  return (
    commandError.code === "AGENT_SESSION_NOT_RUNNING" ||
    commandError.reason === "notRunningForInject"
  );
}
