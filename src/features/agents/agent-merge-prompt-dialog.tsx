import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { useI18n } from "../../shared/i18n/i18n";

type Messages = ReturnType<typeof useI18n>["messages"];

interface AgentMergePromptDialogProps {
  open: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
  messages: Messages;
}

/**
 * 合并冲突 / 目标 worktree 脏时，向 agent session 注入合并 prompt 的确认弹窗。
 * 从 agents-activity 抽出，消费 useAgentSessionCompletionFlow 的 mergePrompt handler。
 */
export function AgentMergePromptDialog({
  open,
  isSubmitting,
  onClose,
  onConfirm,
  messages,
}: AgentMergePromptDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {messages.agentsFeature.mergeToBaseBranchQuestion}
          </DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <Button
            disabled={isSubmitting}
            type="button"
            variant="secondary"
            onClick={onClose}
          >
            {messages.agentsFeature.mergeToBaseBranchNo}
          </Button>
          <Button
            disabled={isSubmitting}
            type="button"
            onClick={() => {
              void onConfirm();
            }}
          >
            {isSubmitting
              ? messages.agentsFeature.submitting
              : messages.agentsFeature.mergeToBaseBranchYes}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
