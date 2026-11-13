import { createContext } from "react";

import type { FileTreeCreateDraftError } from "./use-file-tree-create-draft";
import type { FileTreeRenameSession } from "./use-file-tree-path-edit";
import type {
  WorkspaceChangeKind,
  WorkspaceFileTreeNode,
} from "./workspace-commands";

/**
 * 行渲染快照。react-arborist 把 Tree 的 children 当作组件类型渲染，
 * 这个类型必须稳定：identity 一变，重命名输入框就会卸载重挂，挂载时的
 * focus 把光标甩到文件名末尾。快照走 context，按键只更新值，不换组件。
 */
export interface FileTreeRowRenderModel {
  cancelDraft: () => void;
  cancelRename: () => void;
  changeRenameName: (name: string) => void;
  changedFileKinds?: ReadonlyMap<string, WorkspaceChangeKind>;
  directoryKinds?: ReadonlyMap<string, WorkspaceChangeKind>;
  draftError: FileTreeCreateDraftError | null;
  menuPath: string | null;
  onContextMenuNode: (
    node: WorkspaceFileTreeNode,
    x: number,
    y: number,
  ) => void;
  onOpenFile: (file: WorkspaceFileTreeNode) => void;
  rename: FileTreeRenameSession | null;
  submitDraftName: (name: string) => void;
  submitRename: (generation: number) => Promise<void>;
}

export const FileTreeRowModelContext =
  createContext<FileTreeRowRenderModel | null>(null);

/** 测试在 arborist 之外手动挂行时读取面板刚刚发布的快照。 */
let latestFileTreeRowModel: FileTreeRowRenderModel | null = null;

export function publishFileTreeRowModel(model: FileTreeRowRenderModel): void {
  latestFileTreeRowModel = model;
}

export function readFileTreeRowModel(): FileTreeRowRenderModel | null {
  return latestFileTreeRowModel;
}
