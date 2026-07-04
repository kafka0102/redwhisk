import type { Locale } from "@/shared/i18n/messages";

export interface WorktreeMergeDetail {
  message?: string | null;
  targetBranch?: string | null;
  workspaceBranch?: string | null;
  workspacePath?: string | null;
}

export function buildWorktreeMergeConflictPrompt(
  detail: WorktreeMergeDetail,
  locale: Locale,
): string {
  const targetBranch = detail.targetBranch || "target branch";
  const workspaceBranch = detail.workspaceBranch || "temporary issue branch";
  const workspacePath = detail.workspacePath || "current worktree";

  if (locale === "zh") {
    return [
      detail.message || "代码合并存在冲突，需要你接管处理。",
      `请解决临时分支 ${workspaceBranch} 合并到最初记录的目标分支 ${targetBranch} 时产生的冲突。`,
      `相关 worktree：${workspacePath}`,
      "解决冲突后，请完成合并并确保代码最终合入目标分支。",
    ].join("\n");
  }

  return [
    detail.message || "A merge conflict was detected and needs your help.",
    `Please resolve the conflicts from merging ${workspaceBranch} into the originally recorded target branch ${targetBranch}.`,
    `Related worktree: ${workspacePath}`,
    "After resolving conflicts, complete the merge and make sure the code lands on the target branch.",
  ].join("\n");
}
