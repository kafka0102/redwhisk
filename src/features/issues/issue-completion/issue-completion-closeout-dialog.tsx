import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InfoTip } from "@/components/ui/info-tip";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "../../../shared/i18n/i18n";
import {
  previewChangeRequest,
  type ForgeHostName,
  type ProjectCompletionAction,
  type ProjectPrTarget,
} from "../../project/project-forge-commands";
import type { CloseoutFlowDecision } from "./completion-flow-client";
import type { CloseoutDialogState } from "./use-closeout-prompt";

interface IssueCompletionCloseoutDialogProps {
  state: CloseoutDialogState;
  onDecision: (decision: CloseoutFlowDecision | null) => void;
}

export function IssueCompletionCloseoutDialog({
  state,
  onDecision,
}: IssueCompletionCloseoutDialogProps) {
  const { t } = useI18n();
  const [host, setHost] = useState<ForgeHostName>("github");
  const [action, setAction] =
    useState<ProjectCompletionAction>("merge_to_base");
  const [target, setTarget] = useState<ProjectPrTarget>("issue_base");
  const [draft, setDraft] = useState(true);
  const [repoDefault, setRepoDefault] = useState<string | null>(null);
  const [existingUrl, setExistingUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(state.workspacePath != null);
  const gitlab = host === "gitlab";
  const existing = existingUrl != null;
  const showRequest = action === "open_pull_request" && !existing;

  useEffect(() => {
    if (!state.workspacePath) {
      return;
    }
    let cancelled = false;
    void previewChangeRequest({
      projectId: state.projectId,
      workspacePath: state.workspacePath,
    })
      .then((preview) => {
        if (cancelled) {
          return;
        }
        setHost(preview.host === "gitlab" ? "gitlab" : "github");
        setAction(preview.completionAction);
        setTarget(preview.prTarget);
        setDraft(preview.prDraft);
        setRepoDefault(preview.repoDefaultBranch);
        setExistingUrl(preview.existingUrl);
      })
      .catch(() => {
        if (!cancelled) {
          setHost("github");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [state.projectId, state.workspacePath]);

  const openLabel = existing
    ? t(
        gitlab
          ? "completionCloseout.linkExistingMergeRequest"
          : "completionCloseout.linkExistingPullRequest",
      )
    : t(
        gitlab
          ? "completionCloseout.openMergeRequest"
          : "completionCloseout.openPullRequest",
      );
  const primaryLabel =
    action === "merge_to_base"
      ? t("completionCloseout.mergeAndComplete")
      : existing
        ? t(
            gitlab
              ? "completionCloseout.linkExistingMr"
              : "completionCloseout.linkExistingPr",
          )
        : t(
            gitlab
              ? "completionCloseout.createMrAndComplete"
              : "completionCloseout.createPrAndComplete",
          );
  const issueBase = state.issueBase ?? "";
  const resolvedBase =
    action === "merge_to_base" || target === "issue_base"
      ? issueBase
      : (repoDefault ?? issueBase);
  const actionItems = [
    { value: "merge_to_base", label: t("completionCloseout.mergeToBase") },
    { value: "open_pull_request", label: openLabel },
  ];
  const issueBaseLabel = issueBase
    ? t("completionCloseout.issueBaseTarget", { branch: issueBase })
    : t("completionCloseout.issueBaseTargetPlain");
  const repoDefaultLabel = repoDefault
    ? t("completionCloseout.repoDefaultTarget", { branch: repoDefault })
    : t("completionCloseout.repoDefaultTargetPlain");
  const targetItems = [
    { value: "issue_base", label: issueBaseLabel },
    { value: "repo_default", label: repoDefaultLabel },
  ];

  function confirm(): void {
    onDecision({
      action,
      base: resolvedBase,
      draft,
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onDecision(null);
        }
      }}
    >
      <DialogContent
        className="w-full gap-3 sm:max-w-[420px]"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{t("completionCloseout.chooseTitle")}</DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">
            {t("completionCloseout.workBranch")}
          </dt>
          <dd>
            <code>{state.workBranch ?? ""}</code>
          </dd>
          <dt className="text-muted-foreground">
            {t("completionCloseout.baseBranch")}
          </dt>
          <dd>
            <code>{issueBase}</code>
          </dd>
          {existing && existingUrl ? (
            <>
              <dt className="text-muted-foreground">
                {t("completionCloseout.existingRequest")}
              </dt>
              <dd>
                <button
                  type="button"
                  className="text-left underline"
                  onClick={() => {
                    void openUrl(existingUrl);
                  }}
                >
                  {existingUrl}
                </button>
              </dd>
            </>
          ) : null}
        </dl>
        <div className="grid gap-1.5">
          <Label htmlFor="closeout-action">
            {t("completionCloseout.afterCompletion")}
          </Label>
          <Select
            items={actionItems}
            value={action}
            disabled={loading}
            onValueChange={(value) => {
              if (value === "merge_to_base" || value === "open_pull_request") {
                setAction(value);
              }
            }}
          >
            <SelectTrigger id="closeout-action" className="w-full">
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
        {showRequest ? (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="closeout-target">
                {t("completionCloseout.requestTarget", {
                  name: t(
                    gitlab
                      ? "completionCloseout.mergeRequestName"
                      : "completionCloseout.pullRequestName",
                  ),
                })}
              </Label>
              <Select
                items={targetItems}
                value={target}
                onValueChange={(value) => {
                  if (value === "issue_base" || value === "repo_default") {
                    setTarget(value);
                  }
                }}
              >
                <SelectTrigger id="closeout-target" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="issue_base">{issueBaseLabel}</SelectItem>
                  <SelectItem value="repo_default">
                    {repoDefaultLabel}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                id="closeout-draft"
                checked={draft}
                onCheckedChange={(checked) => setDraft(checked === true)}
              />
              <Label htmlFor="closeout-draft">{t("changeRequest.draft")}</Label>
              <InfoTip
                label={t("changeRequest.draft")}
                text={t("changeRequest.draftHint")}
              />
            </div>
          </>
        ) : null}
        {loading ? (
          <p className="text-xs text-muted-foreground">
            {t("completionCloseout.loading")}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onDecision(null)}
          >
            {t("completionCloseout.cancel")}
          </Button>
          <Button type="button" disabled={loading} onClick={confirm}>
            {primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
