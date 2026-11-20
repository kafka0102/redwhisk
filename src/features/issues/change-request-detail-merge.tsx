import { useState, type JSX } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import {
  mergeChangeRequest,
  type ChangeRequestDetail,
} from "./change-request-commands";
import { isMerged } from "./change-request-detail-model";

type MergeMethod = "squash" | "merge" | "rebase";

export function ChangeRequestDetailMerge({
  projectId,
  detail,
  onDetail,
}: {
  projectId: number;
  detail: ChangeRequestDetail;
  onDetail: (detail: ChangeRequestDetail) => void;
}): JSX.Element {
  if (isMerged(detail.state)) {
    return <MergedSidebar detail={detail} />;
  }
  return (
    <OpenMergePanel projectId={projectId} detail={detail} onDetail={onDetail} />
  );
}

function MergedSidebar({
  detail,
}: {
  detail: ChangeRequestDetail;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <section className="change-request-panel">
      <div className="change-request-panel__header">
        <h3>{t("issues.changeRequests.merge")}</h3>
        <span className="change-request-chip change-request-chip--merged">
          {t("issues.changeRequests.merged")}
        </span>
      </div>
      <p>
        {t("issues.changeRequests.mergedInto", {
          branch: detail.targetBranch,
        })}
      </p>
      {detail.mergeMethod ? (
        <p>{mergedMethodLabel(detail.mergeMethod, t)}</p>
      ) : null}
      {detail.mergeCommitSha ? (
        <p className="mono">{detail.mergeCommitSha}</p>
      ) : null}
      {detail.sourceBranchDeleted === true ? (
        <p>{t("issues.changeRequests.sourceBranchDeleted")}</p>
      ) : null}
    </section>
  );
}

function OpenMergePanel({
  projectId,
  detail,
  onDetail,
}: {
  projectId: number;
  detail: ChangeRequestDetail;
  onDetail: (detail: ChangeRequestDetail) => void;
}): JSX.Element {
  const { t } = useI18n();
  const allowed = hostAllowsMerge(detail);
  const computing = isComputingMerge(detail);
  const [open, setOpen] = useState(false);
  return (
    <section className="change-request-panel">
      <div className="change-request-panel__header">
        <h3>{t("issues.changeRequests.merge")}</h3>
        <span
          className={`change-request-chip ${allowed ? "change-request-chip--success" : "change-request-chip--danger"}`}
        >
          {computing
            ? t("issues.changeRequests.computingMerge")
            : allowed
              ? t("issues.changeRequests.readyToMerge")
              : t("issues.changeRequests.blocked")}
        </span>
      </div>
      {computing ? <p>{t("issues.changeRequests.computingMerge")}</p> : null}
      {detail.blockingReasons.length > 0 ? (
        <ul>
          {detail.blockingReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      <Button
        type="button"
        disabled={!allowed}
        onClick={() => {
          if (allowed) {
            setOpen(true);
          }
        }}
      >
        {detail.provider === "gitlab"
          ? t("issues.changeRequests.mergeMergeRequest")
          : t("issues.changeRequests.mergePullRequest")}
      </Button>
      {open ? (
        <MergeDialog
          projectId={projectId}
          detail={detail}
          onClose={() => {
            setOpen(false);
          }}
          onDetail={onDetail}
        />
      ) : null}
    </section>
  );
}

function MergeDialog({
  projectId,
  detail,
  onClose,
  onDetail,
}: {
  projectId: number;
  detail: ChangeRequestDetail;
  onClose: () => void;
  onDetail: (detail: ChangeRequestDetail) => void;
}): JSX.Element {
  const { t } = useI18n();
  const [method, setMethod] = useState<MergeMethod>("squash");
  const [deleteSourceBranch, setDeleteSourceBranch] = useState(true);
  const [help, setHelp] = useState<MergeMethod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const options: Array<{ id: MergeMethod; label: string; text: string }> = [
    {
      id: "squash",
      label: t("issues.changeRequests.squashMerge"),
      text: squashHelp(detail.commitCount, t),
    },
    {
      id: "merge",
      label: t("issues.changeRequests.createMergeCommit"),
      text: t("issues.changeRequests.mergeHelp"),
    },
    {
      id: "rebase",
      label: t("issues.changeRequests.rebaseMerge"),
      text: t("issues.changeRequests.rebaseHelp"),
    },
  ];
  const methodSupported = detail.supportedMergeMethods.includes(method);
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) {
          onClose();
        }
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("issues.changeRequests.merge")}</DialogTitle>
        </DialogHeader>
        <fieldset className="change-request-merge-methods">
          {options.map((option) => {
            const supported = detail.supportedMergeMethods.includes(option.id);
            return (
              <div key={option.id}>
                <label>
                  <input
                    type="radio"
                    name="change-request-merge-method"
                    value={option.id}
                    checked={method === option.id}
                    disabled={!supported || pending}
                    onChange={() => {
                      setMethod(option.id);
                    }}
                  />
                  {option.label}
                </label>
                <button
                  type="button"
                  aria-label={t("issues.changeRequests.mergeOptionHelp", {
                    method: option.label,
                  })}
                  onClick={() => {
                    setHelp((current) =>
                      current === option.id ? null : option.id,
                    );
                  }}
                >
                  <HelpIcon />
                </button>
                {help === option.id ? <p>{option.text}</p> : null}
              </div>
            );
          })}
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={deleteSourceBranch}
            disabled={pending}
            onChange={(event) => {
              setDeleteSourceBranch(event.target.checked);
            }}
          />
          {t("issues.changeRequests.deleteSourceBranch")}
        </label>
        {error == null ? null : <p role="alert">{error}</p>}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={onClose}
          >
            {t("issues.changeRequests.cancel")}
          </Button>
          <Button
            type="button"
            disabled={pending || !methodSupported}
            onClick={() => {
              if (pending || !methodSupported || !hostAllowsMerge(detail)) {
                return;
              }
              setPending(true);
              setError(null);
              void mergeChangeRequest({
                projectId,
                provider: detail.provider,
                number: detail.number,
                method,
                deleteSourceBranch,
              })
                .then((next) => {
                  onDetail(next);
                  onClose();
                })
                .catch((caught: unknown) => {
                  setError(getCommandErrorMessage(caught, t));
                })
                .finally(() => {
                  setPending(false);
                });
            }}
          >
            {t("issues.changeRequests.merge")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HelpIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" />
      <path
        d="M8 11.2v.2M6.6 6.3a1.4 1.4 0 1 1 2.3 1.1c-.4.3-.7.6-.7 1.1V9"
        fill="none"
        stroke="currentColor"
      />
    </svg>
  );
}

function squashHelp(
  count: number | null,
  t: (key: string, values?: Record<string, unknown>) => string,
): string {
  if (count == null) {
    return t("issues.changeRequests.squashHelpMany");
  }
  return t("issues.changeRequests.squashHelpCount", { count });
}

function mergedMethodLabel(method: string, t: (key: string) => string): string {
  switch (method.toLowerCase()) {
    case "squash":
      return t("issues.changeRequests.mergedSquashMethod");
    case "merge":
      return t("issues.changeRequests.createMergeCommit");
    case "rebase":
      return t("issues.changeRequests.rebaseMerge");
    default:
      return method;
  }
}

function hostAllowsMerge(detail: ChangeRequestDetail): boolean {
  if (detail.blockingReasons.length > 0) {
    return false;
  }
  if (detail.provider === "gitlab") {
    return detail.mergeable === "mergeable";
  }
  return detail.mergeable === "MERGEABLE";
}

function isComputingMerge(detail: ChangeRequestDetail): boolean {
  if (detail.blockingReasons.length > 0) {
    return false;
  }
  const value = detail.mergeable?.trim() ?? "";
  return value.length === 0 || detail.mergeable === "UNKNOWN";
}
