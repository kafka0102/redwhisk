import { Ellipsis } from "lucide-react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { useConfirmDialog } from "../../components/ui/use-confirm-dialog";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import { removeProjectFromList } from "./project-commands";

interface ProjectRemoveMenuProps {
  projectId: number;
  messagesSource: "projectHome" | "projectSwitcher";
  onRemoved: () => Promise<void>;
  onError?: (message: string) => void;
}

export function ProjectRemoveMenu({
  messagesSource,
  onError,
  onRemoved,
  projectId,
}: ProjectRemoveMenuProps) {
  const { messages, t } = useI18n();
  const copy = messages[messagesSource];
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [isRemoving, setIsRemoving] = useState(false);

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

    setIsRemoving(true);
    try {
      await removeProjectFromList({ projectId });
      await onRemoved();
    } catch (error: unknown) {
      onError?.(getCommandErrorMessage(error, t));
    } finally {
      setIsRemoving(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="project-item-more"
          aria-label={copy.moreActions}
          disabled={isRemoving}
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
            disabled={isRemoving}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void handleRemove();
            }}
          >
            {copy.removeFromList}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmationDialog}
    </>
  );
}
