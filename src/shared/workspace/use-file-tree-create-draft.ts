import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getCommandErrorMessage } from "../commands/command-error";
import { useI18n } from "../i18n/i18n";
import { toast } from "../toast";
import {
  buildFileTreeDraftNode,
  buildFileTreeEntryPath,
  getFileTreeEntryNameError,
  insertFileTreeDraftNode,
  type FileTreeEntryCreateInput,
  type FileTreeEntryKind,
} from "./file-tree-create-draft";
import {
  findFileTreeNode,
  normalizeFileTreeDirectoryPath,
} from "./file-tree-listings";
import type { WorkspaceFileTreeNode } from "./workspace-commands";

export interface FileTreeCreateDraftState {
  /** 目标目录相对路径；根目录为 ""。 */
  directoryPath: string;
  kind: FileTreeEntryKind;
}

export interface FileTreeCreateDraftError {
  message: string;
  /** 每次失败自增，草稿行据此重新聚焦并选中已输入内容。 */
  revision: number;
}

export interface UseFileTreeCreateDraftOptions {
  /** 调用方交给面板的树数据（不含草稿节点）。 */
  fileTree: WorkspaceFileTreeNode[];
  /** 可选的「新建文件 / 新建文件夹」能力；未注入时草稿行永不出现。 */
  onCreateEntry?: (input: FileTreeEntryCreateInput) => Promise<void>;
  /** 展开目标目录并按层拉取其子节点，否则草稿行所在的行不可见。 */
  onDirectoryOpen?: (directoryPath: string) => void;
  /** 新建目录成功后把新目录展开并选中。 */
  onRevealDirectory?: (directoryPath: string) => void;
}

export interface UseFileTreeCreateDraftResult {
  draft: FileTreeCreateDraftState | null;
  draftError: FileTreeCreateDraftError | null;
  /** 交给 Tree 的数据：草稿节点位于目标目录子节点第 0 位。 */
  treeData: WorkspaceFileTreeNode[];
  cancelDraft: () => void;
  startDraft: (state: FileTreeCreateDraftState) => void;
  submitDraftName: (name: string) => void;
}

/**
 * 文件树行内新建的草稿行状态（ADR 0040）。
 *
 * 草稿行只存在于派生给 Tree 的数据里：提交成功或取消后草稿节点即消失，真实节点由
 * 调用方强刷该目录的 listing 带回。提交失败时草稿行与已输入内容留在原位，并给出
 * 错误提示，便于就地改名。
 */
export function useFileTreeCreateDraft({
  fileTree,
  onCreateEntry,
  onDirectoryOpen,
  onRevealDirectory,
}: UseFileTreeCreateDraftOptions): UseFileTreeCreateDraftResult {
  const { t } = useI18n();
  const [draft, setDraft] = useState<FileTreeCreateDraftState | null>(null);
  const [draftError, setDraftError] = useState<FileTreeCreateDraftError | null>(
    null,
  );
  const [revealToken, setRevealToken] = useState(0);
  const errorRevisionRef = useRef(0);
  const pendingRevealDirectoryRef = useRef<string | null>(null);

  const treeData = useMemo(() => {
    if (!draft) return fileTree;
    return insertFileTreeDraftNode(
      fileTree,
      draft.directoryPath,
      buildFileTreeDraftNode(draft),
    );
  }, [draft, fileTree]);

  const cancelDraft = useCallback(() => {
    setDraft(null);
    setDraftError(null);
  }, []);

  const startDraft = useCallback(
    (state: FileTreeCreateDraftState) => {
      if (!onCreateEntry) return;
      setDraftError(null);
      const directoryPath = normalizeFileTreeDirectoryPath(state.directoryPath);
      setDraft({ directoryPath, kind: state.kind });
      onDirectoryOpen?.(directoryPath);
    },
    [onCreateEntry, onDirectoryOpen],
  );

  const reportDraftError = useCallback((message: string) => {
    errorRevisionRef.current += 1;
    setDraftError({ message, revision: errorRevisionRef.current });
    toast.error(message);
  }, []);

  const submitDraftName = useCallback(
    (name: string) => {
      if (!draft || !onCreateEntry) return;
      const nameError = getFileTreeEntryNameError(name);
      if (nameError === "empty") {
        cancelDraft();
        return;
      }
      if (nameError === "invalidName") {
        reportDraftError(t("agentsFeature.newEntryNameInvalid"));
        return;
      }
      const target = draft;
      const entryName = name.trim();
      void onCreateEntry({ ...target, name: entryName })
        .then(() => {
          cancelDraft();
          if (target.kind !== "directory") {
            return;
          }
          pendingRevealDirectoryRef.current = buildFileTreeEntryPath(
            target.directoryPath,
            entryName,
          );
          // 该目录的 listing 可能已先于本回调回流（新建时强刷的响应早到）。
          // 自增 token 让 reveal effect 带着当前树数据再求值一次，避免漏展开。
          setRevealToken((token) => token + 1);
        })
        .catch((error: unknown) => {
          reportDraftError(getCommandErrorMessage(error, t));
        });
    },
    [cancelDraft, draft, onCreateEntry, reportDraftError, t],
  );

  // 新目录要等调用方强刷 listing 后才出现在树数据里；出现后再展开并选中它。
  useEffect(() => {
    const directoryPath = pendingRevealDirectoryRef.current;
    if (!directoryPath || !onRevealDirectory) return;
    if (!findFileTreeNode(fileTree, directoryPath)) return;
    pendingRevealDirectoryRef.current = null;
    onRevealDirectory(directoryPath);
  }, [fileTree, onRevealDirectory, revealToken]);

  return {
    cancelDraft,
    draft,
    draftError,
    startDraft,
    submitDraftName,
    treeData,
  };
}
