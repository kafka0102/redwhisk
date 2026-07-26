import { useEffect, useState } from "react";

import {
  resolveWorkspaceGithubRemote,
  type ProjectWorkspaceInput,
  type WorkspaceGithubRemote,
} from "./workspace-commands";

/**
 * 解析 workspace 的 github.com remote（origin 优先）。非 GitHub 或失败时为 null。
 * 不依赖 isPushed；仅决定菜单「在 GitHub 上打开」是否显示。
 */
export function useWorkspaceGithubRemote(
  workspaceInput: ProjectWorkspaceInput | null | undefined,
): WorkspaceGithubRemote | null {
  const [remote, setRemote] = useState<WorkspaceGithubRemote | null>(null);

  const projectId = workspaceInput?.projectId ?? null;
  const sessionId = workspaceInput?.sessionId ?? null;
  const workspacePath = workspaceInput?.workspacePath ?? null;

  useEffect(() => {
    if (projectId === null) {
      queueMicrotask(() => {
        setRemote(null);
      });
      return;
    }

    let cancelled = false;
    void resolveWorkspaceGithubRemote({
      projectId,
      sessionId,
      workspacePath,
    })
      .then((response) => {
        if (cancelled) return;
        setRemote(response.remote ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setRemote(null);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, sessionId, workspacePath]);

  return remote;
}
