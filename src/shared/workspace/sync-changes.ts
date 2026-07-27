import type { BranchSyncStatus } from "./workspace-commands";

/** 全局偏好：同步更改确认框「确定且不再显示」。 */
export const SYNC_CONFIRM_DISMISSED_STORAGE_KEY =
  "redwhisk.changes.syncConfirmDismissed";

export type SyncRemoteAction = "pull" | "push";

export type SyncConfirmDirection = "pull" | "push" | "both";

export function isSyncConfirmDismissed(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): boolean {
  return storage.getItem(SYNC_CONFIRM_DISMISSED_STORAGE_KEY) === "1";
}

export function dismissSyncConfirm(
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(SYNC_CONFIRM_DISMISSED_STORAGE_KEY, "1");
}

export function needsBranchSync(
  branchSync: BranchSyncStatus | null | undefined,
): boolean {
  if (branchSync == null) {
    return false;
  }
  return branchSync.ahead > 0 || branchSync.behind > 0;
}

/**
 * 未提交空态是否展示「同步更改」按钮。
 * Agent 会话侧不传 isProjectRoot / onSync 时 hasSyncHandler 为 false，不展示。
 */
export function shouldShowSyncChangesButton(input: {
  fileCount: number;
  isLoading: boolean;
  hasError: boolean;
  isProjectRoot: boolean;
  branchSync: BranchSyncStatus | null | undefined;
  hasSyncHandler: boolean;
}): boolean {
  if (!input.hasSyncHandler) {
    return false;
  }
  if (!input.isProjectRoot) {
    return false;
  }
  if (input.fileCount !== 0) {
    return false;
  }
  if (input.isLoading || input.hasError) {
    return false;
  }
  return needsBranchSync(input.branchSync);
}

export function resolveSyncActions(
  branchSync: Pick<BranchSyncStatus, "ahead" | "behind">,
): SyncRemoteAction[] {
  const actions: SyncRemoteAction[] = [];
  if (branchSync.behind > 0) {
    actions.push("pull");
  }
  if (branchSync.ahead > 0) {
    actions.push("push");
  }
  return actions;
}

export function resolveSyncConfirmDirection(
  branchSync: Pick<BranchSyncStatus, "ahead" | "behind">,
): SyncConfirmDirection | null {
  const actions = resolveSyncActions(branchSync);
  if (actions.length === 0) {
    return null;
  }
  if (actions.length === 2) {
    return "both";
  }
  return actions[0] ?? null;
}

/** 三形态按钮文案：仅 behind / 仅 ahead / 双向。 */
export function formatSyncChangesLabel(
  branchSync: Pick<BranchSyncStatus, "ahead" | "behind">,
  labels: {
    behindOnly: (count: number) => string;
    aheadOnly: (count: number) => string;
    both: (behind: number, ahead: number) => string;
  },
): string | null {
  const { ahead, behind } = branchSync;
  if (behind > 0 && ahead > 0) {
    return labels.both(behind, ahead);
  }
  if (behind > 0) {
    return labels.behindOnly(behind);
  }
  if (ahead > 0) {
    return labels.aheadOnly(ahead);
  }
  return null;
}
