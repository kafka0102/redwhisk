import { useCallback, useRef, useState, type RefObject } from "react";
import type { TreeApi } from "react-arborist";

import { getCommandErrorMessage } from "../commands/command-error";
import { useI18n } from "../i18n/i18n";
import { toast } from "../toast";
import {
  buildFileTreeEntryPath,
  getFileTreeEntryNameError,
} from "./file-tree-create-draft";
import { parentFileTreeDirectory } from "./file-tree-listings";
import {
  canPasteFileTreePath,
  loadedChildNames,
  planFileTreePaste,
  type FileTreePasteTarget,
  type FileTreePathClipboard,
} from "./file-tree-paste-plan";
import { rebaseRelativePath } from "./file-tree-path-rebase";
import type { FileTreeOpenState } from "./file-tree-panel";
import type { WorkspaceFileTreeNode } from "./workspace-commands";

export interface FileTreePathTransferInput {
  destinationDirectory: string;
  destinationPath: string;
  operation: "copy" | "move";
  sourceDirectory: string;
  sourcePath: string;
}

export interface FileTreeRenameSession {
  errorMessage: string | null;
  errorRevision: number;
  generation: number;
  name: string;
  originalName: string;
  path: string;
}

export function useFileTreePathEdit(options: {
  fileTree: readonly WorkspaceFileTreeNode[];
  onOpenStateChange?: (openState: FileTreeOpenState) => void;
  onTransferEntry?: (input: FileTreePathTransferInput) => Promise<void>;
  treeApiRef: RefObject<TreeApi<WorkspaceFileTreeNode> | undefined>;
  workspacePath?: string | null;
}): {
  beginRename: (target: FileTreePasteTarget & { displayName: string }) => void;
  canPaste: boolean;
  cancelRename: () => void;
  changeRenameName: (name: string) => void;
  copyEntry: (target: FileTreePasteTarget) => void;
  cutEntry: (target: FileTreePasteTarget) => void;
  pasteEntry: (target: FileTreePasteTarget) => Promise<void>;
  rename: FileTreeRenameSession | null;
  submitRename: (generation: number) => Promise<void>;
} {
  const {
    fileTree,
    onOpenStateChange,
    onTransferEntry,
    treeApiRef,
    workspacePath: workspacePathProp,
  } = options;
  const { t } = useI18n();
  const [clipboard, setClipboard] = useState<FileTreePathClipboard | null>(
    null,
  );
  const [rename, setRename] = useState<FileTreeRenameSession | null>(null);
  const renameRef = useRef<FileTreeRenameSession | null>(null);
  const renameGenerationRef = useRef(0);
  const workspacePath = workspacePathProp ?? null;

  const setRenameSession = useCallback((next: FileTreeRenameSession | null) => {
    renameRef.current = next;
    setRename(next);
  }, []);

  const arm = useCallback(
    (
      operation: FileTreePathClipboard["operation"],
      target: FileTreePasteTarget,
    ) => {
      if (workspacePath == null || workspacePath.length === 0) {
        return;
      }
      setClipboard({
        kind: target.kind,
        operation,
        relativePath: target.relativePath,
        workspacePath,
      });
    },
    [workspacePath],
  );

  const rejectPaste = useCallback(
    (reason: "pathAlreadyExists" | "pathCopyIntoSelf" | "pathMoveIntoSelf") => {
      toast.error(t(`errors.AGENT_SESSION_VALIDATION_FAILED.${reason}`));
    },
    [t],
  );

  const rebaseOpenState = useCallback(
    (from: string, to: string) => {
      const api = treeApiRef.current;
      const current = { ...(api?.openState ?? {}) };
      const next: FileTreeOpenState = {};
      for (const [path, isOpen] of Object.entries(current)) {
        if (!isOpen) {
          continue;
        }
        const rebased = rebaseRelativePath(path, from, to);
        if (rebased !== path) {
          api?.close(path);
          api?.open(rebased);
        }
        next[rebased] = true;
      }
      onOpenStateChange?.(next);
    },
    [onOpenStateChange, treeApiRef],
  );

  const pasteEntry = useCallback(
    async (target: FileTreePasteTarget) => {
      const plan = planFileTreePaste({
        clipboard,
        fileTree,
        target,
        workspacePath,
      });
      if (plan.type === "disabled" || plan.type === "keep") {
        return;
      }
      if (plan.type === "reject") {
        rejectPaste(plan.reason);
        return;
      }
      if (!onTransferEntry) {
        return;
      }
      try {
        await onTransferEntry({
          destinationDirectory: plan.destinationDirectory,
          destinationPath: plan.destinationPath,
          operation: plan.operation,
          sourceDirectory: plan.sourceDirectory,
          sourcePath: plan.sourcePath,
        });
        if (plan.operation === "move") {
          setClipboard(null);
          rebaseOpenState(plan.sourcePath, plan.destinationPath);
        }
      } catch (error) {
        toast.error(getCommandErrorMessage(error, t));
      }
    },
    [
      clipboard,
      fileTree,
      onTransferEntry,
      rebaseOpenState,
      rejectPaste,
      t,
      workspacePath,
    ],
  );

  const beginRename = useCallback(
    (target: FileTreePasteTarget & { displayName: string }) => {
      renameGenerationRef.current += 1;
      setRenameSession({
        errorMessage: null,
        errorRevision: 0,
        generation: renameGenerationRef.current,
        name: target.displayName,
        originalName: target.displayName,
        path: target.relativePath,
      });
    },
    [setRenameSession],
  );

  const cancelRename = useCallback(() => {
    setRenameSession(null);
  }, [setRenameSession]);

  const changeRenameName = useCallback(
    (name: string) => {
      const current = renameRef.current;
      if (current === null) {
        return;
      }
      setRenameSession({ ...current, name });
    },
    [setRenameSession],
  );

  const submitRename = useCallback(
    async (generation: number) => {
      const current = renameRef.current;
      if (
        current === null ||
        current.generation !== renameGenerationRef.current ||
        generation !== current.generation
      ) {
        return;
      }
      const nameError = getFileTreeEntryNameError(current.name);
      if (
        nameError === "empty" ||
        current.name.trim() === current.originalName
      ) {
        setRenameSession(null);
        return;
      }
      if (nameError === "invalidName") {
        const errorMessage = t("agentsFeature.newEntryNameInvalid");
        toast.error(errorMessage);
        setRenameSession({
          ...current,
          errorMessage,
          errorRevision: current.errorRevision + 1,
        });
        return;
      }
      const trimmed = current.name.trim();
      const directoryPath = parentFileTreeDirectory(current.path);
      const siblings = loadedChildNames(fileTree, directoryPath);
      if (siblings !== null && siblings.has(trimmed)) {
        const errorMessage = t(
          "errors.AGENT_SESSION_VALIDATION_FAILED.pathAlreadyExists",
        );
        toast.error(errorMessage);
        setRenameSession({
          ...current,
          errorMessage,
          errorRevision: current.errorRevision + 1,
        });
        return;
      }
      if (!onTransferEntry) {
        return;
      }
      const destinationPath = buildFileTreeEntryPath(directoryPath, trimmed);
      try {
        await onTransferEntry({
          destinationDirectory: directoryPath,
          destinationPath,
          operation: "move",
          sourceDirectory: directoryPath,
          sourcePath: current.path,
        });
        setRenameSession(null);
        rebaseOpenState(current.path, destinationPath);
      } catch (error) {
        setRenameSession({
          ...current,
          errorMessage: getCommandErrorMessage(error, t),
          errorRevision: current.errorRevision + 1,
        });
      }
    },
    [fileTree, onTransferEntry, rebaseOpenState, setRenameSession, t],
  );

  return {
    beginRename,
    canPaste: canPasteFileTreePath(clipboard, workspacePath),
    cancelRename,
    changeRenameName,
    copyEntry: (target) => arm("copy", target),
    cutEntry: (target) => arm("cut", target),
    pasteEntry,
    rename,
    submitRename,
  };
}
