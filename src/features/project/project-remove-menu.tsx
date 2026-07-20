import { Ellipsis } from "lucide-react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { useConfirmDialog } from "../../components/ui/use-confirm-dialog";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import { deleteProject, removeProjectFromList } from "./project-commands";

interface ProjectRemoveMenuProps {
  projectId: number;
  messagesSource: "projectHome" | "projectSwitcher";
  onRemoved: () => Promise<void>;
  onOpenInCurrentWindow: () => Promise<void>;
  onOpenInNewWindow: () => Promise<void>;
  onError?: (message: string) => void;
}

export function ProjectRemoveMenu({
  messagesSource,
  onError,
  onOpenInCurrentWindow,
  onOpenInNewWindow,
  onRemoved,
  projectId,
}: ProjectRemoveMenuProps) {
  const { messages, t } = useI18n();
  const copy = messages[messagesSource];
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [isBusy, setIsBusy] = useState(false);

  async function runAction(action: () => Promise<void>) {
    setIsBusy(true);
    try {
      await action();
    } catch (error: unknown) {
      onError?.(getCommandErrorMessage(error, t));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRemove() {
    const confirmed = await confirm({
      title: copy.removeFromListConfirmTitle,
      message: copy.removeFromListConfirmMessage,
      confirmLabel: copy.removeFromList,
      cancelLabel: messages.confirmDialog.cancel,
    });
    if (!confirmed) {
      return;
    }

    await runAction(async () => {
      await removeProjectFromList({ projectId });
      await onRemoved();
    });
  }

  async function handleDelete() {
    const confirmed = await confirm({
      title: copy.deleteProjectConfirmTitle,
      message: copy.deleteProjectConfirmMessage,
      confirmLabel: copy.deleteProject,
      cancelLabel: messages.confirmDialog.cancel,
      confirmVariant: "destructive",
    });
    if (!confirmed) {
      return;
    }

    await runAction(async () => {
      await deleteProject({ projectId });
      await onRemoved();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="project-item-more"
          aria-label={copy.moreActions}
          disabled={isBusy}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
        >
          <Ellipsis aria-hidden="true" size={16} strokeWidth={1.9} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <DropdownMenuItem
            disabled={isBusy}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void runAction(onOpenInCurrentWindow);
            }}
          >
            {copy.openInCurrentWindow}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isBusy}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void runAction(onOpenInNewWindow);
            }}
          >
            {copy.openInNewWindow}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={isBusy}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void handleRemove();
            }}
          >
            {copy.removeFromList}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isBusy}
            variant="destructive"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void handleDelete();
            }}
          >
            {copy.deleteProject}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmationDialog}
    </>
  );
}
