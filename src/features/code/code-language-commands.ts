import { invokeCommand } from "../../shared/commands/command-client";

export type CodeLanguageHostStatusKind = "ready" | "unavailable";
export type CodeLanguageUnavailableReason = "nodeNotFound" | "spawnFailed";

export interface CodeLanguageHostInput {
  projectId: number;
  workspacePath: string;
}

export interface CodeLanguageHostStatus {
  status: CodeLanguageHostStatusKind;
  reason?: CodeLanguageUnavailableReason;
}

export async function ensureCodeLanguageHost(
  input: CodeLanguageHostInput,
): Promise<CodeLanguageHostStatus> {
  return invokeCommand<CodeLanguageHostStatus>("ensure_code_language_host", {
    input,
  });
}

export async function stopCodeLanguageHost(
  input: CodeLanguageHostInput,
): Promise<void> {
  await invokeCommand<void>("stop_code_language_host", { input });
}
