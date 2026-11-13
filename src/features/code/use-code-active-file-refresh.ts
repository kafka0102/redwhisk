import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import {
  buildActiveFileSignature,
  useActiveFileRefresh,
} from "../../shared/workspace/use-active-file-refresh";
import type { WorkspaceFileContent } from "../../shared/workspace/workspace-commands";
import type { CodeFileTab } from "./code-workspace-cache";

export { buildActiveFileSignature };

export interface CodeExternalFileConflict {
  content: WorkspaceFileContent;
  filePath: string;
}

export interface UseCodeActiveFileRefreshOptions {
  projectId: number;
  workspacePath: string | null;
  activePath: string | null;
  enabled: boolean;
  /** 当前激活 tab 已加载正文的签名（size:mtime），用于打开后首轮 stat 免重复 read。 */
  knownSignature: string | null;
  setTabs: Dispatch<SetStateAction<CodeFileTab[]>>;
  resolveErrorMessage: (error: unknown) => string;
  /** 判断指定 tab 是否 dirty；用于外部变更时避免静默覆盖。 */
  isTabDirty?: (filePath: string) => boolean;
  /** dirty 时外部签名变化：不覆盖缓冲，改由调用方弹出冲突确认。 */
  onExternalConflict?: (conflict: CodeExternalFileConflict) => void;
}

/**
 * 「代码」Activity 的激活文件刷新薄适配：检测、去抖、可见性由共享
 * `useActiveFileRefresh` 负责；本层只把新正文落到 tab，并保留 dirty 冲突语义。
 */
export function useCodeActiveFileRefresh({
  projectId,
  workspacePath,
  activePath,
  enabled,
  knownSignature,
  setTabs,
  resolveErrorMessage,
  isTabDirty,
  onExternalConflict,
}: UseCodeActiveFileRefreshOptions): void {
  const resolveErrorMessageRef = useRef(resolveErrorMessage);
  const setTabsRef = useRef(setTabs);
  const isTabDirtyRef = useRef(isTabDirty);
  const onExternalConflictRef = useRef(onExternalConflict);

  useEffect(() => {
    resolveErrorMessageRef.current = resolveErrorMessage;
  }, [resolveErrorMessage]);

  useEffect(() => {
    setTabsRef.current = setTabs;
  }, [setTabs]);

  useEffect(() => {
    isTabDirtyRef.current = isTabDirty;
  }, [isTabDirty]);

  useEffect(() => {
    onExternalConflictRef.current = onExternalConflict;
  }, [onExternalConflict]);

  useActiveFileRefresh({
    projectId,
    workspacePath,
    filePath: activePath,
    enabled,
    knownSignature,
    onContent: (content) => {
      const filePath = content.filePath;
      if (isTabDirtyRef.current?.(filePath)) {
        // dirty 缓冲不静默覆盖；交由 onExternalConflict 二选一。
        onExternalConflictRef.current?.({ content, filePath });
        return;
      }
      setTabsRef.current((currentTabs) =>
        currentTabs.map((tab) => {
          if (tab.filePath !== filePath) {
            return tab;
          }
          // 防御：无 isTabDirty 回调时仍不覆盖 dirty 缓冲。
          if (tab.isDirty) {
            return tab;
          }
          return {
            ...tab,
            content,
            errorMessage: null,
            isDirty: false,
            isLoading: false,
            savedContent: content.content,
          };
        }),
      );
    },
    onError: (error, filePath) => {
      setTabsRef.current((currentTabs) =>
        currentTabs.map((tab) =>
          tab.filePath === filePath
            ? {
                ...tab,
                content: null,
                errorMessage: resolveErrorMessageRef.current(error),
                isLoading: false,
              }
            : tab,
        ),
      );
    },
  });
}
