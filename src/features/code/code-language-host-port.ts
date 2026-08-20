import { subscribeTauriEvent } from "../../shared/tauri-event/use-tauri-event";
import {
  CODE_LANGUAGE_DIAGNOSTICS_EVENT,
  ensureCodeLanguageHost,
  notifyCodeLanguageDocument,
  stopCodeLanguageHost,
  type CodeLanguageDiagnosticsEvent,
  type CodeLanguageDocumentInput,
  type CodeLanguageHostInput,
  type CodeLanguageHostStatus,
} from "./code-language-commands";

export interface CodeLanguageHostPort {
  ensure(input: CodeLanguageHostInput): Promise<CodeLanguageHostStatus>;
  stop(input: CodeLanguageHostInput): Promise<void>;
  notifyDocument(input: CodeLanguageDocumentInput): Promise<void>;
  subscribeDiagnostics(
    handler: (payload: CodeLanguageDiagnosticsEvent) => void,
  ): () => void;
}

let injectedPort: CodeLanguageHostPort | null = null;

export function setCodeLanguageHostPortForTests(
  port: CodeLanguageHostPort | null,
): void {
  injectedPort = port;
}

export function getCodeLanguageHostPort(): CodeLanguageHostPort {
  return injectedPort ?? createTauriCodeLanguageHostPort();
}

export function createTauriCodeLanguageHostPort(): CodeLanguageHostPort {
  return {
    ensure: ensureCodeLanguageHost,
    stop: stopCodeLanguageHost,
    notifyDocument: notifyCodeLanguageDocument,
    subscribeDiagnostics: (
      handler: (payload: CodeLanguageDiagnosticsEvent) => void,
    ): (() => void) =>
      subscribeTauriEvent(CODE_LANGUAGE_DIAGNOSTICS_EVENT, handler),
  };
}
