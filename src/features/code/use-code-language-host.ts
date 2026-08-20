import { useEffect, useRef, useState } from "react";

import type { CodeFileTab } from "./code-workspace-cache";
import {
  getCodeLanguageHostPort,
  type CodeLanguageHostPort,
} from "./code-language-host-port";
import type { CodeLanguageUnavailableReason } from "./code-language-commands";
import { isCodeLanguageFile } from "./is-code-language-file";

export function useCodeLanguageHost(options: {
  projectId: number;
  workspacePath: string | null;
  activeTab: CodeFileTab | null;
  port?: CodeLanguageHostPort;
}): {
  unavailableReason: CodeLanguageUnavailableReason | null;
  isReady: boolean;
} {
  const { projectId, workspacePath, activeTab, port } = options;
  const portRef = useRef(port ?? getCodeLanguageHostPort());
  const [hostReason, setHostReason] =
    useState<CodeLanguageUnavailableReason | null>(null);
  const [readyWorkspaceKey, setReadyWorkspaceKey] = useState<string | null>(
    null,
  );
  const workspaceKey = workspacePath ? `${projectId}:${workspacePath}` : null;

  useEffect(() => {
    portRef.current = port ?? getCodeLanguageHostPort();
  });
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
    const hostPort = portRef.current;
    return () => {
      void hostPort.stop({ projectId, workspacePath });
    };
  }, [projectId, workspacePath]);

  useEffect(() => {
    if (!workspacePath || !shouldEnsure) {
      return;
    }
    let cancelled = false;
    void portRef.current.ensure({ projectId, workspacePath }).then(
      (status) => {
        if (cancelled) {
          return;
        }
        if (status.status === "unavailable") {
          setHostReason(status.reason ?? "spawnFailed");
          setReadyWorkspaceKey(null);
          return;
        }
        setHostReason(null);
        setReadyWorkspaceKey(`${projectId}:${workspacePath}`);
      },
      () => {
        if (!cancelled) {
          setHostReason("spawnFailed");
          setReadyWorkspaceKey(null);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, shouldEnsure, workspacePath]);

  return {
    unavailableReason: shouldEnsure ? hostReason : null,
    isReady: workspaceKey !== null && readyWorkspaceKey === workspaceKey,
  };
}
