import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import type { IssueRecord, IssueStatus } from "../issue-commands";
import { useI18n } from "../../../shared/i18n/i18n";
import { canReopenCompletedIssue } from "./can-reopen-completed-issue";

const ISSUE_STATUS_ORDER: IssueStatus[] = [
  "backlog",
  "running",
  "review",
  "completed",
];

function statusLabelFor(
  status: IssueStatus,
  messages: ReturnType<typeof useI18n>["messages"],
): string {
  switch (status) {
    case "backlog":
      return messages.issues.backlog;
    case "running":
      return messages.issues.inProgress;
    case "review":
      return messages.issues.review;
    case "completed":
      return messages.issues.done;
  }
}

export function IssueStatusMenu({
  selectedIssue,
  isSaving,
  onAdvanceStatus,
}: {
  selectedIssue: IssueRecord | null;
  isSaving: boolean;
  onAdvanceStatus: (targetStatus: IssueStatus) => void;
}) {
  const { messages } = useI18n();
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const currentStatus = selectedIssue?.status ?? "backlog";
  const canReopenRunning = selectedIssue
    ? canReopenCompletedIssue(selectedIssue)
    : false;

  useEffect(() => {
    if (!isStatusMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!statusMenuRef.current?.contains(event.target as Node)) {
        setIsStatusMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [isStatusMenuOpen]);

  return (
    <div ref={statusMenuRef} className="issue-dialog__status-menu">
      <Button
        aria-expanded={isStatusMenuOpen}
        aria-haspopup="menu"
        aria-label={messages.issues.openStatusOptions}
        className="issue-dialog__status-trigger"
        disabled={isSaving}
        size="sm"
        type="button"
        variant="outline"
        onClick={() => setIsStatusMenuOpen((currentValue) => !currentValue)}
      >
        <span>{statusLabelFor(currentStatus, messages)}</span>
        <ChevronDown aria-hidden="true" size={14} strokeWidth={1.9} />
      </Button>
      {isStatusMenuOpen ? (
        <div className="issue-dialog__status-popup" role="menu">
          {ISSUE_STATUS_ORDER.map((status) => {
            const isCurrent = status === currentStatus;
            // 已完成不能直接进入 Review。运行中仅在当前 Agent 能续接时可选。
            const isBlockedFromCompleted =
              currentStatus === "completed" &&
              (status === "review" ||
                (status === "running" && !canReopenRunning));

            const resumeUnavailableHint =
              status === "running" &&
              currentStatus === "completed" &&
              !canReopenRunning
                ? messages.issues.reopenResumeUnavailable
                : null;

            return (
              <button
                key={status}
                className="issue-dialog__status-option"
                disabled={isSaving || isCurrent || isBlockedFromCompleted}
                role="menuitem"
                title={resumeUnavailableHint ?? undefined}
                type="button"
                onClick={() => {
                  setIsStatusMenuOpen(false);
                  if (!isCurrent && !isBlockedFromCompleted) {
                    onAdvanceStatus(status);
                  }
                }}
              >
                <span>{statusLabelFor(status, messages)}</span>
                {isCurrent ? (
                  <Check aria-hidden="true" size={14} strokeWidth={2} />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
