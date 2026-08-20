import { invokeCommand } from "../../shared/commands/command-client";

export const CODE_LANGUAGE_DIAGNOSTICS_EVENT = "code-language-diagnostics";

export type CodeLanguageHostStatusKind = "ready" | "unavailable";
export type CodeLanguageUnavailableReason = "nodeNotFound" | "spawnFailed";
export type CodeLanguageDocumentKind = "didOpen" | "didChange" | "didClose";

export interface CodeLanguageHostInput {
  projectId: number;
  workspacePath: string;
}

export interface CodeLanguageHostStatus {
  status: CodeLanguageHostStatusKind;
  reason?: CodeLanguageUnavailableReason;
}

export interface CodeLanguageDocumentInput {
  projectId: number;
  workspacePath: string;
  uri: string;
  kind: CodeLanguageDocumentKind;
  languageId?: string;
  version?: number;
  text?: string;
}

export interface CodeLanguagePosition {
  line: number;
  character: number;
}

export interface CodeLanguageRange {
  start: CodeLanguagePosition;
  end: CodeLanguagePosition;
}

export interface CodeLanguageDiagnostic {
  range: CodeLanguageRange;
  message: string;
  severity?: number;
  source?: string;
  code?: string;
}

export interface CodeLanguageDiagnosticsEvent {
  projectId: number;
  workspacePath: string;
  uri: string;
  diagnostics: CodeLanguageDiagnostic[];
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

export async function notifyCodeLanguageDocument(
  input: CodeLanguageDocumentInput,
): Promise<void> {
  await invokeCommand<void>("notify_code_language_document", { input });
}
