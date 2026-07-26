import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { CodeFileTab } from "./code-workspace-cache";
import {
  useCodeActiveFileRefresh,
  type CodeExternalFileConflict,
} from "./use-code-active-file-refresh";
import type { ExternalConflictChoice } from "./use-code-unsaved-confirm";

export function useCodeActiveFileRefreshBinding({
  projectId,
  workspacePath,
  activePath,
  enabled,
  knownSignature,
  setTabs,
  resolveErrorMessage,
  confirmExternalConflict,
  tabsRef,
}: {
  projectId: number;
  workspacePath: string | null;
  activePath: string | null;
  enabled: boolean;
  knownSignature: string | null;
  setTabs: Dispatch<SetStateAction<CodeFileTab[]>>;
  resolveErrorMessage: (error: unknown) => string;
  confirmExternalConflict: (
    fileName: string,
  ) => Promise<ExternalConflictChoice>;
  tabsRef: { current: CodeFileTab[] };
}): void {
  const handleExternalConflict = useCallback(
    async (conflict: CodeExternalFileConflict) => {
      const tab = tabsRef.current.find(
        (item) => item.filePath === conflict.filePath,
      );
      const fileName = tab?.fileName ?? conflict.filePath;
      const choice = await confirmExternalConflict(fileName);
      if (choice !== "useDisk") {
        return;
      }
      setTabs((currentTabs) =>
        currentTabs.map((item) => {
          if (item.filePath !== conflict.filePath) {
            return item;
          }
          return {
            ...item,
            content: conflict.content,
            errorMessage: null,
            isDirty: false,
            isLoading: false,
            savedContent: conflict.content.content,
          };
        }),
      );
    },
    [confirmExternalConflict, setTabs, tabsRef],
  );

  const isTabDirty = useCallback(
    (filePath: string) =>
      tabsRef.current.some((tab) => tab.filePath === filePath && tab.isDirty),
    [tabsRef],
  );

  useCodeActiveFileRefresh({
    projectId,
    workspacePath,
    activePath,
    enabled,
    knownSignature,
    setTabs,
    resolveErrorMessage,
    isTabDirty,
    onExternalConflict: handleExternalConflict,
  });
}
