import { useCallback, type ReactElement } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
} from "../../components/ui/context-menu";
import { useI18n } from "../i18n/i18n";
import { toast } from "../toast";

export interface WorkspacePathContextMenuTarget {
  displayName: string;
  relativePath: string;
  x: number;
  y: number;
}

export interface WorkspacePathContextMenuProps {
  target: WorkspacePathContextMenuTarget | null;
  workspacePath?: string | null;
  onClose: () => void;
}

export function WorkspacePathContextMenu({
  target,
  workspacePath,
  onClose,
}: WorkspacePathContextMenuProps): ReactElement {
  const { messages } = useI18n();

  const handleCopy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard?.writeText(text);
        toast.success(messages.agentsFeature.copiedToClipboard);
      } catch {
        // 剪贴板写入失败时静默忽略，与 terminal 的既有处理保持一致。
      }
    },
    [messages.agentsFeature.copiedToClipboard],
  );

  return (
    <ContextMenu
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ContextMenuContent anchor={target ? { x: target.x, y: target.y } : null}>
        <ContextMenuItem
          onClick={() => {
            if (target) {
              void handleCopy(target.displayName);
            }
          }}
        >
          {messages.agentsFeature.copyFileName}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            if (target) {
              void handleCopy(target.relativePath);
            }
          }}
        >
          {messages.agentsFeature.copyRelativePath}
        </ContextMenuItem>
        {workspacePath ? (
          <ContextMenuItem
            onClick={() => {
              if (target) {
                void handleCopy(
                  joinWorkspacePath(workspacePath, target.relativePath),
                );
              }
            }}
          >
            {messages.agentsFeature.copyAbsolutePath}
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function joinWorkspacePath(
  workspacePath: string,
  relativePath: string,
): string {
  return `${workspacePath.replace(/\/+$/, "")}/${relativePath}`;
}
