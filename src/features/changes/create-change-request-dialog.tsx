import { useEffect, useState, type FormEvent } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingDialog } from "@/components/ui/loading-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAlertDialog } from "@/components/ui/use-alert-dialog";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import { toast } from "../../shared/toast";
import { listIssues } from "../issues/issue-commands";
import {
  createChangeRequest,
  previewChangeRequest,
  type ForgeHostName,
} from "../project/project-forge-commands";

type LinkMode = "none" | "remote" | "local";

interface LinkableIssue {
  id: number;
  number: number;
  title: string;
  source: string;
  externalNumber: number | null;
}

export interface CreateChangeRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  workspacePath: string;
  host: ForgeHostName;
}

export function CreateChangeRequestDialog({
  open,
  onOpenChange,
  projectId,
  workspacePath,
  host,
}: CreateChangeRequestDialogProps) {
  const { t } = useI18n();
  const { alertDialog, showAlert } = useAlertDialog();
  const gitlab = host === "gitlab";
  const noun = t(
    gitlab
      ? "completionCloseout.mergeRequestName"
      : "completionCloseout.pullRequestName",
  );
  const dialogTitle = t(
    gitlab
      ? "changeRequest.createMergeRequest"
      : "changeRequest.createPullRequest",
  );
  const [sourceBranch, setSourceBranch] = useState("");
  const [targetBranch, setTargetBranch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [repoDefault, setRepoDefault] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(true);
  const [existingUrl, setExistingUrl] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [linkMode, setLinkMode] = useState<LinkMode>("none");
  const [linkIssueId, setLinkIssueId] = useState("");
  const [issues, setIssues] = useState<LinkableIssue[]>([]);
  const sameAsDefault =
    repoDefault != null &&
    sourceBranch.length > 0 &&
    sourceBranch === repoDefault;

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    void previewChangeRequest({ projectId, workspacePath })
      .then((preview) => {
        if (cancelled) {
          return;
        }
        const current = preview.currentBranch ?? "";
        const fallback = preview.repoDefaultBranch ?? preview.branches[0] ?? "";
        setSourceBranch(current);
        setRepoDefault(preview.repoDefaultBranch);
        setBranches(preview.branches);
        setTargetBranch(fallback);
        setTitle(preview.title);
        setBody(preview.body);
        setDraft(preview.prDraft);
        setExistingUrl(preview.existingUrl);
        setLinkMode("none");
        setLinkIssueId("");
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          showAlert({
            type: "error",
            message: getCommandErrorMessage(error, t),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, showAlert, t, workspacePath]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    void listIssues({ projectId, sourceFilter: "all" })
      .then((response) => {
        if (!cancelled) {
          setIssues(linkableIssues(response.issues));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIssues([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  function handleOpenChange(nextOpen: boolean): void {
    if (creating) {
      return;
    }
    onOpenChange(nextOpen);
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (creating) {
      return;
    }
    if (existingUrl) {
      await openUrl(existingUrl);
      onOpenChange(false);
      return;
    }
    if (sameAsDefault) {
      return;
    }
    const selected = issues.find((issue) => String(issue.id) === linkIssueId);
    if (linkMode !== "none" && selected == null) {
      return;
    }
    setCreating(true);
    try {
      await createChangeRequest({
        projectId,
        workspacePath,
        base: targetBranch,
        title,
        body,
        draft,
        linkMode,
        linkIssueId: linkMode === "none" ? null : (selected?.id ?? null),
        remoteNumber:
          linkMode === "remote" ? (selected?.externalNumber ?? null) : null,
      });
      toast.success(t("changeRequest.created"));
      onOpenChange(false);
    } catch (error) {
      showAlert({
        type: "error",
        message: getCommandErrorMessage(error, t),
      });
    } finally {
      setCreating(false);
    }
  }

  const targetOptions =
    branches.includes(targetBranch) || targetBranch.length === 0
      ? branches
      : [targetBranch, ...branches];
  const targetItems = targetOptions.map((branch) => ({
    value: branch,
    label: branch,
  }));
  const linkModeItems = [
    { value: "none", label: t("changeRequest.linkNone") },
    { value: "remote", label: t("changeRequest.linkRemote") },
    { value: "local", label: t("changeRequest.linkLocal") },
  ];
  const linkCandidates = issues.filter((issue) =>
    linkMode === "remote"
      ? issue.source === "remote" && issue.externalNumber != null
      : issue.source === "local",
  );
  const linkIssueItems = linkCandidates.map((issue) => ({
    value: String(issue.id),
    label:
      linkMode === "remote"
        ? `#${issue.externalNumber ?? ""} ${issue.title}`
        : `#${issue.number} ${issue.title}`,
  }));
  const linkBlocked = linkMode !== "none" && linkIssueId.length === 0;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="w-full gap-3 sm:max-w-[440px]"
          showCloseButton={!creating}
        >
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              void handleSubmit(event);
            }}
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {dialogTitle}
                {sameAsDefault ? (
                  <InfoTip
                    label={t("changeRequest.sameBranchHint")}
                    text={t("changeRequest.sameBranchHint")}
                  />
                ) : null}
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="change-request-source">
                {t("changeRequest.sourceBranch")}
              </Label>
              <Input id="change-request-source" readOnly value={sourceBranch} />
            </div>
            {existingUrl ? (
              <div className="grid gap-1.5">
                <Label>{t("issueSummary.pullRequestUrl")}</Label>
                <button
                  type="button"
                  className="text-left text-sm underline"
                  onClick={() => {
                    void openUrl(existingUrl);
                  }}
                >
                  {existingUrl}
                </button>
              </div>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="change-request-target">
                    {t("changeRequest.targetBranch")}
                  </Label>
                  <Select
                    items={targetItems}
                    value={targetBranch}
                    disabled={creating || sameAsDefault}
                    onValueChange={(value) => {
                      if (value) {
                        setTargetBranch(value);
                      }
                    }}
                  >
                    <SelectTrigger
                      id="change-request-target"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {targetOptions.map((branch) => (
                        <SelectItem key={branch} value={branch}>
                          {branch}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="change-request-title">
                    {t("changeRequest.title")}
                  </Label>
                  <Input
                    id="change-request-title"
                    disabled={creating || sameAsDefault}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="change-request-body">
                    {t("changeRequest.body")}
                  </Label>
                  <textarea
                    id="change-request-body"
                    className="min-h-[78px] w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                    disabled={creating || sameAsDefault}
                    rows={4}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="change-request-link">
                    {t("changeRequest.link")}
                  </Label>
                  <Select
                    items={linkModeItems}
                    value={linkMode}
                    disabled={creating || sameAsDefault}
                    onValueChange={(value) => {
                      if (
                        value === "none" ||
                        value === "remote" ||
                        value === "local"
                      ) {
                        setLinkMode(value);
                        setLinkIssueId("");
                      }
                    }}
                  >
                    <SelectTrigger id="change-request-link" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {linkModeItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {linkMode === "none" ? null : (
                  <div className="grid gap-1.5">
                    <Label htmlFor="change-request-link-issue">
                      {linkMode === "remote"
                        ? t("changeRequest.linkRemote")
                        : t("changeRequest.linkLocal")}
                    </Label>
                    <Select
                      items={linkIssueItems}
                      value={linkIssueId}
                      disabled={creating || sameAsDefault}
                      onValueChange={(value) => {
                        if (value) {
                          setLinkIssueId(value);
                        }
                      }}
                    >
                      <SelectTrigger
                        id="change-request-link-issue"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {linkIssueItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id="change-request-draft"
                    checked={draft}
                    disabled={creating || sameAsDefault}
                    onCheckedChange={(checked) => setDraft(checked === true)}
                  />
                  <Label htmlFor="change-request-draft">
                    {t("changeRequest.draft")}
                  </Label>
                  <InfoTip
                    label={t("changeRequest.draft")}
                    text={t("changeRequest.draftHint")}
                  />
                </div>
              </>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={creating}
                onClick={() => handleOpenChange(false)}
              >
                {t("completionCloseout.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={
                  creating ||
                  (sameAsDefault && !existingUrl) ||
                  (!existingUrl && linkBlocked)
                }
              >
                {existingUrl
                  ? t("changeRequest.view")
                  : t("changeRequest.create", { name: noun })}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <LoadingDialog
        dismissible={false}
        message={t("changeRequest.creating")}
        open={creating}
      />
      {alertDialog}
    </>
  );
}

function linkableIssues(value: unknown): LinkableIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const issues: LinkableIssue[] = [];
  for (const item of value) {
    if (item == null || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "number" || typeof record.number !== "number") {
      continue;
    }
    issues.push({
      id: record.id,
      number: record.number,
      title: typeof record.title === "string" ? record.title : "",
      source: typeof record.source === "string" ? record.source : "local",
      externalNumber:
        typeof record.externalNumber === "number"
          ? record.externalNumber
          : null,
    });
  }
  return issues;
}
