import { useEffect, useRef } from "react";

import {
  getCodeLanguageHostPort,
  type CodeLanguageHostPort,
} from "./code-language-host-port";
import type { CodeLanguageUnavailableReason } from "./code-language-commands";
import {
  applyCodeLanguageMarkers,
  clearCodeLanguageMarkersForRoot,
} from "./code-language-markers";

export function useCodeLanguageDiagnostics(options: {
  projectId: number;
  workspacePath: string | null;
  unavailableReason: CodeLanguageUnavailableReason | null;
  port?: CodeLanguageHostPort;
}): void {
  const { projectId, workspacePath, unavailableReason, port } = options;
  const portRef = useRef(port ?? getCodeLanguageHostPort());

  useEffect(() => {
    portRef.current = port ?? getCodeLanguageHostPort();
  });

  useEffect(() => {
    if (!workspacePath) {
      return;
    }
    return portRef.current.subscribeDiagnostics((payload) => {
      if (payload.projectId !== projectId) {
        return;
      }
      if (payload.workspacePath.trim() !== workspacePath.trim()) {
        return;
      }
      applyCodeLanguageMarkers(payload.uri, payload.diagnostics);
    });
  }, [projectId, workspacePath]);

  useEffect(() => {
    if (!workspacePath) {
      return;
    }
    return () => {
      clearCodeLanguageMarkersForRoot(workspacePath);
    };
  }, [projectId, workspacePath]);

  useEffect(() => {
    if (unavailableReason && workspacePath) {
      clearCodeLanguageMarkersForRoot(workspacePath);
    }
  }, [unavailableReason, workspacePath]);
}
