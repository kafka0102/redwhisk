import { useCallback } from "react";

import {
  buildActiveFileSignature,
  useActiveFileRefresh,
} from "../../../shared/workspace/use-active-file-refresh";
import type { SessionCacheUpdater } from "./session-workspace-cache-types";
import {
  readProjectWorktreeFile,
  type WorkspaceFileContent,
} from "./session-workspace-commands";
import type { SessionWorkspaceFileTab } from "./session-workspace-types";

/** 从工作区相对路径取 basename，作为 file tab 的标签（如 `src/app/a.ts` → `a.ts`）。 */
function fileNameFromWorkspacePath(filePath: string): string {
  const segments = filePath.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? filePath;
}

/**
 * 打开指定 session 工作区内的一个文件：先在 file tab 落加载态，再读取内容 / 写失败态。
 *
 * 文件树点击（`openFile`）与消息流路径点击（`openFilePathForSession`）共用这一段
 * 写入 + 读取逻辑，避免两套读取路径在「已打开是否重复读盘」与失败态归属上分叉。
 */
export async function openWorkspaceFileTab({
  projectId,
  sessionId,
  filePath,
  updateSessionCache,
  translateError,
}: {
  projectId: number;
  sessionId: number;
  filePath: string;
  updateSessionCache: SessionCacheUpdater;
  translateError: (error: unknown) => string;
}): Promise<void> {
  // 与 CodeWorkspace 对齐：已打开且仍在加载 / 已有内容时不重复读盘，
  // 避免连点同一文件触发二次 IO 与全量 cache 刷新。
  let shouldFetch = true;
  updateSessionCache(sessionId, (cache) => {
    const existing =
      cache.fileTab?.filePath === filePath ? cache.fileTab : null;
    if (existing != null) {
      shouldFetch = false;
      if (
        cache.activeWorkspaceTab === "file" &&
        (existing.content != null ||
          existing.isLoading ||
          existing.errorMessage != null)
      ) {
        return cache;
      }
      return {
        ...cache,
        activeWorkspaceTab: "file",
        fileTab: existing,
      };
    }
    return {
      ...cache,
      activeWorkspaceTab: "file",
      fileTab: {
        fileName: fileNameFromWorkspacePath(filePath),
        filePath,
        content: null,
        errorMessage: null,
        isLoading: true,
      },
    };
  });

  if (!shouldFetch) {
    return;
  }

  try {
    const content = await readProjectWorktreeFile({
      projectId,
      sessionId,
      filePath,
    });

    updateSessionCache(sessionId, (cache) => ({
      ...cache,
      fileTab:
        cache.fileTab?.filePath === filePath
          ? {
              ...cache.fileTab,
              content,
              errorMessage: null,
              isLoading: false,
            }
          : cache.fileTab,
    }));
  } catch (error) {
    updateSessionCache(sessionId, (cache) => ({
      ...cache,
      fileTab:
        cache.fileTab?.filePath === filePath
          ? {
              ...cache.fileTab,
              errorMessage: translateError(error),
              isLoading: false,
            }
          : cache.fileTab,
    }));
  }
}

/** 当前已加载正文的磁盘签名（size:mtime）；无正文（加载 / 错误态）时返回 null。 */
export function sessionFileTabSignature(
  fileTab: SessionWorkspaceFileTab | null,
): string | null {
  if (!fileTab?.content) {
    return null;
  }
  return buildActiveFileSignature(
    fileTab.content.sizeBytes,
    fileTab.content.modifiedAt,
  );
}

interface UseSessionActiveFileRefreshOptions {
  projectId: number;
  sessionId: number | null;
  /** 当前可见的文件 Tab；非 file workspace Tab 传 null。 */
  fileTab: SessionWorkspaceFileTab | null;
  enabled: boolean;
  updateSessionCache: SessionCacheUpdater;
  /** 命令错误 → 侧栏文案，与打开流程共用同一稳定引用。 */
  resolveErrorMessage: (error: unknown) => string;
}

/**
 * Session 文件查看器的可见刷新薄适配：检测 / 去抖 / 可见性由共享
 * `useActiveFileRefresh` 负责。Session 文件只读，签名变化直接静默替换正文；检测失败
 * 清空旧正文并写既有错误态。请求只带 `projectId + sessionId + filePath`，不伪造工作区根。
 */
export function useSessionActiveFileRefresh({
  projectId,
  sessionId,
  fileTab,
  enabled,
  updateSessionCache,
  resolveErrorMessage,
}: UseSessionActiveFileRefreshOptions): void {
  const handleContent = useCallback(
    (content: WorkspaceFileContent): void => {
      if (sessionId == null) {
        return;
      }
      const filePath = content.filePath;
      updateSessionCache(sessionId, (cache) =>
        cache.fileTab?.filePath === filePath
          ? {
              ...cache,
              fileTab: {
                ...cache.fileTab,
                content,
                errorMessage: null,
                isLoading: false,
              },
            }
          : cache,
      );
    },
    [sessionId, updateSessionCache],
  );

  const handleError = useCallback(
    (error: unknown, filePath: string): void => {
      if (sessionId == null) {
        return;
      }
      const errorMessage = resolveErrorMessage(error);
      updateSessionCache(sessionId, (cache) =>
        cache.fileTab?.filePath === filePath
          ? {
              ...cache,
              fileTab: {
                ...cache.fileTab,
                content: null,
                errorMessage,
                isLoading: false,
              },
            }
          : cache,
      );
    },
    [resolveErrorMessage, sessionId, updateSessionCache],
  );

  useActiveFileRefresh({
    projectId,
    sessionId,
    filePath: fileTab?.filePath ?? null,
    enabled,
    knownSignature: sessionFileTabSignature(fileTab),
    onContent: handleContent,
    onError: handleError,
  });
}
