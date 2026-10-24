// 行内代码里的工作区文件路径存在性探测。
//
// 检查走现有只读 command `stat_project_worktree_file`：成功 = 存在，失败 = 不存在。
// 结果按 `projectId:sessionId:path` 做模块级缓存（同一路径只探测一次，流式重渲染不
// 重复 IPC）；探测在 effect 里批量发起，渲染期只读已有的探测结果，不发请求、不写 ref。

import { useCallback, useEffect, useState } from "react";

import { statProjectWorktreeFile } from "../../../shared/workspace/workspace-commands";
import type { SessionFileLinks } from "./session-file-links";

/** 缓存 key → 是否存在。 */
const fileExistenceCache = new Map<string, boolean>();
/** 在途探测：同一 key 只发一次请求，流式重渲染不重复发起。 */
const inFlightProbes = new Map<string, Promise<void>>();

function cacheKey(
  projectId: number,
  sessionId: number,
  filePath: string,
): string {
  return `${projectId}:${sessionId}:${filePath}`;
}

/** 清理模块级缓存；仅供测试使用。 */
export function clearWorkspaceFileExistenceCacheForTest(): void {
  fileExistenceCache.clear();
  inFlightProbes.clear();
}

function probeFileExistence(
  projectId: number,
  sessionId: number,
  filePath: string,
): Promise<void> {
  const key = cacheKey(projectId, sessionId, filePath);
  const inFlight = inFlightProbes.get(key);
  if (inFlight !== undefined) {
    return inFlight;
  }

  const request = statProjectWorktreeFile({ projectId, sessionId, filePath })
    .then(() => {
      fileExistenceCache.set(key, true);
    })
    .catch(() => {
      fileExistenceCache.set(key, false);
    })
    .finally(() => {
      inFlightProbes.delete(key);
    });
  inFlightProbes.set(key, request);
  return request;
}

/** 收集候选路径里当前已确认存在的部分；只读模块级缓存。 */
function collectExistingPaths(
  projectId: number,
  sessionId: number,
  candidatePaths: readonly string[],
): Set<string> {
  const existing = new Set<string>();
  for (const filePath of candidatePaths) {
    if (fileExistenceCache.get(cacheKey(projectId, sessionId, filePath))) {
      existing.add(filePath);
    }
  }
  return existing;
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

/**
 * 批量探测候选路径的存在性，返回「该工作区相对路径是否存在」的判定函数。
 *
 * `sessionFileLinks` 缺失（Issue 时间轴、TUI 归档回看）时不发任何请求，判定恒为 false。
 */
export function useWorkspaceFileExistence(
  sessionFileLinks: SessionFileLinks | undefined,
  candidatePaths: readonly string[],
): (relativePath: string) => boolean {
  const projectId = sessionFileLinks?.projectId;
  const sessionId = sessionFileLinks?.sessionId;
  const [existingPaths, setExistingPaths] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  useEffect(() => {
    if (projectId === undefined || sessionId === undefined) {
      return;
    }
    // 已缓存过的路径（前一条消息探测过）直接同步进状态，不再发请求。
    const cachedExisting = collectExistingPaths(
      projectId,
      sessionId,
      candidatePaths,
    );
    const updateExistingPaths = (next: Set<string>) => {
      setExistingPaths((previous) =>
        setsEqual(previous, next) ? previous : next,
      );
    };
    updateExistingPaths(cachedExisting);

    const unknownPaths = candidatePaths.filter(
      (filePath) =>
        !fileExistenceCache.has(cacheKey(projectId, sessionId, filePath)),
    );
    if (unknownPaths.length === 0) {
      return;
    }

    let isCancelled = false;
    void Promise.all(
      unknownPaths.map((filePath) =>
        probeFileExistence(projectId, sessionId, filePath),
      ),
    ).then(() => {
      if (!isCancelled) {
        updateExistingPaths(
          collectExistingPaths(projectId, sessionId, candidatePaths),
        );
      }
    });
    return () => {
      isCancelled = true;
    };
  }, [candidatePaths, projectId, sessionId]);

  return useCallback(
    (relativePath: string) => existingPaths.has(relativePath),
    [existingPaths],
  );
}
