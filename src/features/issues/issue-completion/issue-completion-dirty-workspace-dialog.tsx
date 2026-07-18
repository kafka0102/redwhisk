import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DirtyWorkspaceOption } from "../issue-commands";

interface IssueCompletionDirtyWorkspaceDialogProps {
  title: string;
  message: string;
  /** 弹框预填的分支名（情况一/二只读预填，情况三/session 关闭可编辑）。 */
  branchName: string | null;
  /** 分支名是否可编辑。 */
  branchNameEditable: boolean;
  branchNameLabel: string;
  autoCommitLabel: string;
  skipLabel: string;
  cancelLabel: string;
  onDecision: (
    decision: DirtyWorkspaceOption,
    branchName: string | null,
  ) => void;
}

export function IssueCompletionDirtyWorkspaceDialog({
  title,
  message,
  branchName,
  branchNameEditable,
  branchNameLabel,
  autoCommitLabel,
  skipLabel,
  cancelLabel,
  onDecision,
}: IssueCompletionDirtyWorkspaceDialogProps) {
  const [editedBranchName, setEditedBranchName] = useState(branchName ?? "");
  const resolvedBranchName = branchNameEditable
    ? editedBranchName || null
    : branchName;

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onDecision("cancel", resolvedBranchName);
        }
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="issue-completion-branch-name">
            {branchNameLabel}
          </Label>
          <Input
            id="issue-completion-branch-name"
            value={editedBranchName}
            readOnly={!branchNameEditable}
            onChange={(event) => setEditedBranchName(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onDecision("cancel", resolvedBranchName)}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onDecision("skip", resolvedBranchName)}
          >
            {skipLabel}
          </Button>
          <Button
            type="button"
            onClick={() => onDecision("auto_commit", resolvedBranchName)}
          >
            {autoCommitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
