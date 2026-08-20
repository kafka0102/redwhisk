import { useEffect, useState } from "react";

import type { CodeFileTab } from "./code-workspace-cache";
import {
  ensureCodeLanguageHost,
  stopCodeLanguageHost,
  type CodeLanguageUnavailableReason,
} from "./code-language-commands";
import { isCodeLanguageFile } from "./is-code-language-file";

export function useCodeLanguageHost(options: {
  projectId: number;
  workspacePath: string | null;
  activeTab: CodeFileTab | null;
}): {
  unavailableReason: CodeLanguageUnavailableReason | null;
} {
  const { projectId, workspacePath, activeTab } = options;
  const [hostReason, setHostReason] =
    useState<CodeLanguageUnavailableReason | null>(null);
  const shouldEnsure = Boolean(
    workspacePath &&
    activeTab?.content &&
    isCodeLanguageFile({
      isBinary: activeTab.content.isBinary,
      isTooLarge: activeTab.content.isTooLarge,
      language: activeTab.content.language,
    }),
  );

  useEffect(() => {
    if (!workspacePath) {
      return;
    }
    return () => {
      void stopCodeLanguageHost({ projectId, workspacePath });
    };
  }, [projectId, workspacePath]);

  useEffect(() => {
    if (!workspacePath || !shouldEnsure) {
      return;
    }
    let cancelled = false;
    void ensureCodeLanguageHost({ projectId, workspacePath }).then(
      (status) => {
        if (cancelled) {
          return;
        }
        setHostReason(
          status.status === "unavailable"
            ? (status.reason ?? "spawnFailed")
            : null,
        );
      },
      () => {
        if (!cancelled) {
          setHostReason("spawnFailed");
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, shouldEnsure, workspacePath]);

  return { unavailableReason: shouldEnsure ? hostReason : null };
}
