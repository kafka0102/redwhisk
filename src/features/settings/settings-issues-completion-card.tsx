import { useId, type ReactElement } from "react";

import { Checkbox } from "../../components/ui/checkbox";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { useI18n } from "../../shared/i18n/i18n";
import type {
  ForgeHostName,
  ProjectCompletionAction,
  ProjectPrTarget,
} from "../project/project-forge-commands";

interface IssueSourceCompletionCardProps {
  action: ProjectCompletionAction;
  confirmCompletionAction: boolean;
  draft: boolean;
  host: ForgeHostName;
  repoDefaultBranch: string | null;
  target: ProjectPrTarget;
  onActionChange: (value: ProjectCompletionAction) => void;
  onConfirmCompletionActionChange: (value: boolean) => void;
  onDraftChange: (value: boolean) => void;
  onTargetChange: (value: ProjectPrTarget) => void;
  disabled?: boolean;
}

export function IssueSourceCompletionCard({
  action,
  confirmCompletionAction,
  draft,
  host,
  repoDefaultBranch,
  target,
  onActionChange,
  onConfirmCompletionActionChange,
  onDraftChange,
  onTargetChange,
  disabled = false,
}: IssueSourceCompletionCardProps): ReactElement | null {
  const { t } = useI18n();
  const titleId = useId();
  if (host !== "github" && host !== "gitlab") return null;

  const gitlab = host === "gitlab";
  const actionItems: Record<ProjectCompletionAction, string> = {
    merge_to_base: t("completionCloseout.mergeToBase"),
    open_pull_request: t(
      gitlab
        ? "completionCloseout.openMergeRequest"
        : "completionCloseout.openPullRequest",
    ),
  };
  const issueBaseLabel = repoDefaultBranch
    ? t("completionCloseout.issueBaseTarget", { branch: repoDefaultBranch })
    : t("completionCloseout.issueBaseTargetPlain");
  const repoDefaultLabel = repoDefaultBranch
    ? t("completionCloseout.repoDefaultTarget", { branch: repoDefaultBranch })
    : t("completionCloseout.repoDefaultTargetPlain");
  const targetItems: Record<ProjectPrTarget, string> = {
    issue_base: issueBaseLabel,
    repo_default: repoDefaultLabel,
  };
  const showRequest = action === "open_pull_request";

  return (
    <section aria-labelledby={titleId} className="settings-card">
      <div className="settings-card__header">
        <h4 id={titleId}>{t("settings.issueSource.completionTitle")}</h4>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="issue-source-completion-action">
          {t("settings.issueSource.completionAction")}
        </Label>
        <Select
          items={actionItems}
          value={action}
          onValueChange={(value) => {
            if (value === "merge_to_base" || value === "open_pull_request") {
              onActionChange(value);
            }
          }}
        >
          <SelectTrigger
            aria-label={t("settings.issueSource.completionAction")}
            className="w-full"
            disabled={disabled}
            id="issue-source-completion-action"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="merge_to_base">
              {actionItems.merge_to_base}
            </SelectItem>
            <SelectItem value="open_pull_request">
              {actionItems.open_pull_request}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      {showRequest ? (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="issue-source-pr-target">
              {t(
                gitlab
                  ? "settings.issueSource.mrTarget"
                  : "settings.issueSource.prTarget",
              )}
            </Label>
            <Select
              items={targetItems}
              value={target}
              onValueChange={(value) => {
                if (value === "issue_base" || value === "repo_default") {
                  onTargetChange(value);
                }
              }}
            >
              <SelectTrigger
                aria-label={t(
                  gitlab
                    ? "settings.issueSource.mrTarget"
                    : "settings.issueSource.prTarget",
                )}
                className="w-full"
                id="issue-source-pr-target"
                disabled={disabled}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="issue_base">
                  {targetItems.issue_base}
                </SelectItem>
                <SelectItem value="repo_default">
                  {targetItems.repo_default}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={draft}
              id="issue-source-pr-draft"
              disabled={disabled}
              onCheckedChange={(checked) => onDraftChange(checked === true)}
            />
            <Label htmlFor="issue-source-pr-draft">
              {t("changeRequest.draft")}
            </Label>
          </div>
        </>
      ) : null}
      <div className="flex items-center gap-2">
        <Checkbox
          checked={confirmCompletionAction}
          id="issue-source-confirm-again"
          disabled={disabled}
          onCheckedChange={(checked) =>
            onConfirmCompletionActionChange(checked === true)
          }
        />
        <Label htmlFor="issue-source-confirm-again">
          {t("settings.issueSource.confirmAgain")}
        </Label>
      </div>
    </section>
  );
}
