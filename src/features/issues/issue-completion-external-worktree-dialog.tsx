import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { IssueCompletionExternalWorktreeDecision } from "./issue-commands";

interface IssueCompletionExternalWorktreeDialogProps {
  title: string;
  message: string;
  mergeAndDeleteLabel: string;
  skipLabel: string;
  cancelLabel: string;
  onDecision: (decision: IssueCompletionExternalWorktreeDecision) => void;
}

export function IssueCompletionExternalWorktreeDialog({
  title,
  message,
  mergeAndDeleteLabel,
  skipLabel,
  cancelLabel,
  onDecision,
}: IssueCompletionExternalWorktreeDialogProps) {
  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onDecision("cancel");
        }
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onDecision("cancel")}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onDecision("skip")}
          >
            {skipLabel}
          </Button>
          <Button type="button" onClick={() => onDecision("merge_and_delete")}>
            {mergeAndDeleteLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
