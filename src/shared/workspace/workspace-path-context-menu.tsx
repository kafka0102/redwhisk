import { useCallback, type ReactElement } from "react";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
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
  /**
   * 只有「代码」Activity 文件树注入。注入后菜单改成四组，并提供剪切、复制、粘贴、重命名。
   */
  editActions?: WorkspacePathContextMenuEditActions | null;
  onClose: () => void;
}

export interface WorkspacePathContextMenuCreateActions {
  onCreateDirectory: () => void;
  onCreateFile: () => void;
}

export interface WorkspacePathContextMenuDeleteAction {
  onDelete: () => void;
}

export interface WorkspacePathContextMenuEditActions {
  canPaste: boolean;
  onCopyEntry: () => void;
  onCut: () => void;
  onPaste: () => void;
  onRename: () => void;
}

export function WorkspacePathContextMenu({
  target,
  workspacePath,
  createActions,
  deleteAction,
  editActions,
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

  const showNewFolder = createActions != null && target?.kind === "directory";
  const sections: ReactElement[][] = [];
  const createSection: ReactElement[] = [];
  if (createActions) {
    createSection.push(
      <ContextMenuItem
        key="new-file"
        onClick={() => {
          if (target) {
            createActions.onCreateFile();
          }
        }}
      >
        {t("agentsFeature.newFile")}
      </ContextMenuItem>,
    );
  }
  if (showNewFolder && createActions) {
    createSection.push(
      <ContextMenuItem
        key="new-folder"
        onClick={() => {
          if (target) {
            createActions.onCreateDirectory();
          }
        }}
      >
        {t("agentsFeature.newFolder")}
      </ContextMenuItem>,
    );
  }
  if (editActions && showOpenInFinder) {
    createSection.push(
      <ContextMenuItem key="finder" onClick={handleOpenInFinder}>
        {t("agentsFeature.openInFinder")}
      </ContextMenuItem>,
    );
  }
  if (createSection.length > 0) {
    sections.push(createSection);
  }

  const copySection: ReactElement[] = [
    <ContextMenuItem
      key="copy-name"
      onClick={() => {
        if (target) {
          void handleCopy(target.displayName);
        }
      }}
    >
      {messages.agentsFeature.copyFileName}
    </ContextMenuItem>,
    <ContextMenuItem
      key="copy-relative"
      onClick={() => {
        if (target) {
          void handleCopy(target.relativePath);
        }
      }}
    >
      {messages.agentsFeature.copyRelativePath}
    </ContextMenuItem>,
  ];
  if (workspacePath && target) {
    const absolutePath = joinWorkspacePath(workspacePath, target.relativePath);
    copySection.push(
      <ContextMenuItem
        key="copy-absolute"
        onClick={() => {
          void handleCopy(absolutePath);
        }}
      >
        {messages.agentsFeature.copyAbsolutePath}
      </ContextMenuItem>,
    );
  } else if (workspacePath) {
    copySection.push(
      <ContextMenuItem key="copy-absolute">
        {messages.agentsFeature.copyAbsolutePath}
      </ContextMenuItem>,
    );
  }
  if (!editActions && showOpenInFinder) {
    copySection.push(
      <ContextMenuItem key="finder" onClick={handleOpenInFinder}>
        {t("agentsFeature.openInFinder")}
      </ContextMenuItem>,
    );
  }
  sections.push(copySection);

  if (editActions) {
    sections.push([
      <ContextMenuItem key="cut" onClick={editActions.onCut}>
        {t("agentsFeature.cut")}
      </ContextMenuItem>,
      <ContextMenuItem key="copy-entry" onClick={editActions.onCopyEntry}>
        {t("agentsFeature.copyEntry")}
      </ContextMenuItem>,
      <ContextMenuItem
        key="paste"
        aria-disabled={editActions.canPaste ? undefined : true}
        disabled={!editActions.canPaste}
        onClick={() => {
          if (editActions.canPaste) {
            editActions.onPaste();
          }
        }}
      >
        {t("agentsFeature.paste")}
      </ContextMenuItem>,
    ]);
  }

  const renameSection: ReactElement[] = [];
  if (editActions) {
    renameSection.push(
      <ContextMenuItem key="rename" onClick={editActions.onRename}>
        {t("agentsFeature.rename")}
      </ContextMenuItem>,
    );
  }
  if (deleteAction) {
    renameSection.push(
      <ContextMenuItem
        key="delete"
        onClick={() => {
          if (target) {
            deleteAction.onDelete();
          }
        }}
      >
        {t("agentsFeature.deleteEntry")}
      </ContextMenuItem>,
    );
  }
  if (renameSection.length > 0) {
    sections.push(renameSection);
  }

  const menuItems = sections.flatMap((section, index) => {
    if (!editActions || index === 0) {
      return section;
    }
    return [<ContextMenuSeparator key={`separator-${index}`} />, ...section];
  });

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
          {menuItems}
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
