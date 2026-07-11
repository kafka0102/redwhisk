import type { Locale } from "@/shared/i18n/messages";
import i18n from "@/shared/i18n/i18n-instance";

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
  const t = i18n.getFixedT(locale);

  return [
    detail.message || t("issues.mergeConflictNeedsHandoff"),
    t("issues.mergeConflictResolvePrompt", { workspaceBranch, targetBranch }),
    t("issues.mergeConflictRelatedWorktree", { workspacePath }),
    t("issues.mergeConflictCompleteMerge"),
  ].join("\n");
}
