import type { CodeFileTab } from "./code-workspace-cache";
import type { CodeLanguageHostPort } from "./code-language-host-port";
import type { CodeLanguageUnavailableReason } from "./code-language-commands";
import { useCodeLanguageDiagnostics } from "./use-code-language-diagnostics";
import { useCodeLanguageDocuments } from "./use-code-language-documents";
import { useCodeLanguageHost } from "./use-code-language-host";

export function useCodeLanguageIntelligence(options: {
  projectId: number;
  workspacePath: string | null;
  activeTab: CodeFileTab | null;
  tabs: CodeFileTab[];
  debounceMs?: number;
  port?: CodeLanguageHostPort;
}): {
  unavailableReason: CodeLanguageUnavailableReason | null;
} {
  const host = useCodeLanguageHost(options);
  useCodeLanguageDocuments({
    debounceMs: options.debounceMs,
    isReady: host.isReady,
    port: options.port,
    projectId: options.projectId,
    tabs: options.tabs,
    workspacePath: options.workspacePath,
  });
  useCodeLanguageDiagnostics({
    port: options.port,
    projectId: options.projectId,
    unavailableReason: host.unavailableReason,
    workspacePath: options.workspacePath,
  });
  return { unavailableReason: host.unavailableReason };
}
