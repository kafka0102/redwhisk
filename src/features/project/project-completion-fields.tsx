import { Checkbox } from "@/components/ui/checkbox";
import { InfoTip } from "@/components/ui/info-tip";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "../../shared/i18n/i18n";
import type {
  ForgeHostName,
  ProjectCompletionAction,
  ProjectPrTarget,
} from "./project-forge-commands";

interface ProjectCompletionFieldsProps {
  host: ForgeHostName;
  cliInstalled: boolean;
  cliAuthenticated: boolean;
  repoDefaultBranch: string | null;
  action: ProjectCompletionAction;
  target: ProjectPrTarget;
  draft: boolean;
  confirmCompletionAction: boolean;
  disabled: boolean;
  onActionChange: (value: ProjectCompletionAction) => void;
  onTargetChange: (value: ProjectPrTarget) => void;
  onDraftChange: (value: boolean) => void;
  onConfirmCompletionActionChange: (value: boolean) => void;
}

export function ProjectCompletionFields({
  host,
  cliInstalled,
  cliAuthenticated,
  repoDefaultBranch,
  action,
  target,
  draft,
  confirmCompletionAction,
  disabled,
  onActionChange,
  onTargetChange,
  onDraftChange,
  onConfirmCompletionActionChange,
}: ProjectCompletionFieldsProps) {
  const { t } = useI18n();
  if (host !== "github" && host !== "gitlab") {
    return null;
  }
  const gitlab = host === "gitlab";
  const cli = gitlab ? "glab" : "gh";
  const status =
    cliInstalled && cliAuthenticated
      ? null
      : !cliInstalled && !cliAuthenticated
        ? t("completionCloseout.cliNotReady", { cli })
        : !cliInstalled
          ? t("completionCloseout.cliNotInstalled", { cli })
          : t("completionCloseout.cliNotAuthenticated");
  const requestName = t(
    gitlab
      ? "completionCloseout.mergeRequestName"
      : "completionCloseout.pullRequestName",
  );
  const actionItems = [
    { value: "merge_to_base", label: t("completionCloseout.mergeToBase") },
    {
      value: "open_pull_request",
      label: t(
        gitlab
          ? "completionCloseout.openMergeRequest"
          : "completionCloseout.openPullRequest",
      ),
    },
  ];
  const targetItems = [
    {
      value: "issue_base",
      label: t("completionCloseout.issueBaseTargetPlain"),
    },
    {
      value: "repo_default",
      label: repoDefaultBranch
        ? t("completionCloseout.repoDefaultTarget", {
            branch: repoDefaultBranch,
          })
        : t("completionCloseout.repoDefaultTargetPlain"),
    },
  ];
  const confirmItems = [
    { value: "no", label: t("completionCloseout.confirmCompletionActionNo") },
    { value: "yes", label: t("completionCloseout.confirmCompletionActionYes") },
  ];

  return (
    <>
      <div className="grid gap-1.5">
        <div className="flex items-center gap-2">
          <Label
            htmlFor="project-completion-action"
            className="text-xs text-muted-foreground"
          >
            {t("completionCloseout.afterCompletion")}
          </Label>
          {status ? (
            <span className="text-xs text-destructive">{status}</span>
          ) : null}
        </div>
        <Select
          items={actionItems}
          value={action}
          disabled={disabled}
          onValueChange={(value) => {
            if (value === "merge_to_base" || value === "open_pull_request") {
              onActionChange(value);
            }
          }}
        >
          <SelectTrigger id="project-completion-action" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="merge_to_base">
              {actionItems[0].label}
            </SelectItem>
            <SelectItem value="open_pull_request">
              {actionItems[1].label}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label
          htmlFor="project-confirm-completion-action"
          className="text-xs text-muted-foreground"
        >
          {t("completionCloseout.confirmCompletionAction")}
        </Label>
        <Select
          items={confirmItems}
          value={confirmCompletionAction ? "yes" : "no"}
          disabled={disabled}
          onValueChange={(value) => {
            if (value === "yes" || value === "no") {
              onConfirmCompletionActionChange(value === "yes");
            }
          }}
        >
          <SelectTrigger
            id="project-confirm-completion-action"
            className="w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="no">{confirmItems[0].label}</SelectItem>
            <SelectItem value="yes">{confirmItems[1].label}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {action === "open_pull_request" ? (
        <>
          <div className="grid gap-1.5">
            <Label
              htmlFor="project-pr-target"
              className="text-xs text-muted-foreground"
            >
              {t("completionCloseout.requestTarget", { name: requestName })}
            </Label>
            <Select
              items={targetItems}
              value={target}
              disabled={disabled}
              onValueChange={(value) => {
                if (value === "issue_base" || value === "repo_default") {
                  onTargetChange(value);
                }
              }}
            >
              <SelectTrigger id="project-pr-target" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="issue_base">
                  {targetItems[0].label}
                </SelectItem>
                <SelectItem value="repo_default">
                  {targetItems[1].label}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Checkbox
              id="project-pr-draft"
              checked={draft}
              disabled={disabled}
              onCheckedChange={(checked) => onDraftChange(checked === true)}
            />
            <Label htmlFor="project-pr-draft">{t("changeRequest.draft")}</Label>
            <InfoTip
              label={t("changeRequest.draft")}
              text={t("changeRequest.draftHint")}
            />
          </div>
        </>
      ) : null}
    </>
  );
}
