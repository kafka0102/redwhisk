import { useCallback, type ReactElement } from "react";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
} from "../../components/ui/context-menu";
import { useAlertDialog } from "../../components/ui/use-alert-dialog";
import { copyTextToClipboard } from "../commands/copy-text-to-clipboard";
import { useI18n } from "../i18n/i18n";
import { toast } from "../toast";

export interface WorkspacePathContextMenuTarget {
  displayName: string;
  relativePath: string;
  x: number;
  y: number;
  /** 未标明时按文件揭示。只有文件树的目录行传入 directory。 */
  kind?: "directory" | "file";
}

export interface WorkspacePathContextMenuProps {
  target: WorkspacePathContextMenuTarget | null;
  workspacePath?: string | null;
  /**
   * 可选的行内新建能力：注入后在复制三项**之上**多出「新建文件 / 新建文件夹」。
   * 未注入的调用方（会话侧栏文件树、代码搜索分组头、变更文件行）菜单保持现状。
   */
  createActions?: WorkspacePathContextMenuCreateActions | null;
  /**
   * 可选的删除能力：注入后在复制三项**之下**多出「删除」。
   * 未注入的调用方菜单保持现状。
   */
  deleteAction?: WorkspacePathContextMenuDeleteAction | null;
  onClose: () => void;
}

export interface WorkspacePathContextMenuCreateActions {
  onCreateDirectory: () => void;
  onCreateFile: () => void;
}

export interface WorkspacePathContextMenuDeleteAction {
  onDelete: () => void;
}

export function WorkspacePathContextMenu({
  target,
  workspacePath,
  createActions,
  deleteAction,
  onClose,
}: WorkspacePathContextMenuProps): ReactElement {
  const { messages, t } = useI18n();
  const { alertDialog, showAlert } = useAlertDialog();
  const showOpenInFinder = canOpenWorkspacePathInFinder(
    workspacePath,
    target?.relativePath,
  );

  const handleCopy = useCallback(
    async (text: string) => {
      if (await copyTextToClipboard(text)) {
        toast.success(messages.agentsFeature.copiedToClipboard);
      }
      // 剪贴板写入失败时静默忽略，与 terminal 的既有处理保持一致。
    },
    [messages.agentsFeature.copiedToClipboard],
  );

  const handleOpenInFinder = useCallback(() => {
    if (!target || !workspacePath || !target.relativePath) {
      return;
    }
    const absolutePath = joinWorkspacePath(workspacePath, target.relativePath);
    void openWorkspacePathInFinder(absolutePath, target.kind).catch(() => {
      showAlert({
        message: t("agentsFeature.openInFinderFailed"),
        type: "error",
      });
    });
  }, [showAlert, t, target, workspacePath]);

  return (
    <>
      <ContextMenu
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
      >
        <ContextMenuContent
          anchor={target ? { x: target.x, y: target.y } : null}
        >
          {createActions ? (
            <>
              <ContextMenuItem
                onClick={() => {
                  if (target) {
                    createActions.onCreateFile();
                  }
                }}
              >
                {t("agentsFeature.newFile")}
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  if (target) {
                    createActions.onCreateDirectory();
                  }
                }}
              >
                {t("agentsFeature.newFolder")}
              </ContextMenuItem>
            </>
          ) : null}
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
          {showOpenInFinder ? (
            <ContextMenuItem onClick={handleOpenInFinder}>
              {t("agentsFeature.openInFinder")}
            </ContextMenuItem>
          ) : null}
          {deleteAction ? (
            <ContextMenuItem
              onClick={() => {
                if (target) {
                  deleteAction.onDelete();
                }
              }}
            >
              {t("agentsFeature.deleteEntry")}
            </ContextMenuItem>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
      {alertDialog}
    </>
  );
}

function joinWorkspacePath(
  workspacePath: string,
  relativePath: string,
): string {
  return `${workspacePath.replace(/\/+$/, "")}/${relativePath}`;
}

function canOpenWorkspacePathInFinder(
  workspacePath: string | null | undefined,
  relativePath: string | null | undefined,
): boolean {
  return isMacPlatform() && Boolean(workspacePath) && Boolean(relativePath);
}

function isMacPlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
}

function openWorkspacePathInFinder(
  absolutePath: string,
  kind: "directory" | "file" | undefined,
): Promise<void> {
  if (kind === "directory") {
    return openPath(absolutePath);
  }
  return revealItemInDir(absolutePath);
}
