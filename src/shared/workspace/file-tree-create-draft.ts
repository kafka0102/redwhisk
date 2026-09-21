import {
  ROOT_FILE_TREE_DIRECTORY,
  normalizeFileTreeDirectoryPath,
} from "./file-tree-listings";
import type { WorkspaceFileTreeNode } from "./workspace-commands";

/** 行内新建的条目类型；与工作区文件树节点的 kind 同义。 */
export type FileTreeEntryKind = WorkspaceFileTreeNode["kind"];

/** 行内新建的落盘输入：目标目录相对路径（根目录为 ""）+ 类型 + 名字。 */
export interface FileTreeEntryCreateInput {
  directoryPath: string;
  kind: FileTreeEntryKind;
  name: string;
}

/** 前端合成草稿节点的 id 前缀；行渲染器靠它识别「这一行是草稿行」。 */
export const FILE_TREE_DRAFT_NODE_ID_PREFIX = "__file-tree-draft__:";

/**
 * 草稿行落在目标目录子节点第 0 位的合成节点。
 *
 * 见 ADR 0040：不使用 react-arborist 内置 create/edit，靠 id 哨兵识别草稿行，
 * 数据 DTO 不新增字段。id 带上目标目录与类型，切换新建目标时草稿行必然重建，
 * 不会把上一处已输入的名字带过来。
 */
export function buildFileTreeDraftNode(input: {
  directoryPath: string;
  kind: FileTreeEntryKind;
}): WorkspaceFileTreeNode {
  const id = buildFileTreeDraftNodeId(input.kind, input.directoryPath);
  return {
    id,
    isIgnored: false,
    kind: input.kind,
    name: "",
    path: id,
  };
}

export function buildFileTreeDraftNodeId(
  kind: FileTreeEntryKind,
  directoryPath: string,
): string {
  return `${FILE_TREE_DRAFT_NODE_ID_PREFIX}${kind}:${normalizeFileTreeDirectoryPath(directoryPath)}`;
}

export function isFileTreeDraftNodeId(id: string): boolean {
  return id.startsWith(FILE_TREE_DRAFT_NODE_ID_PREFIX);
}

/**
 * 把草稿节点插到目标目录子节点的第 0 位。
 *
 * 目录子节点尚未加载时（children 缺失）也接受草稿节点：草稿行随后的创建会强刷
 * 该目录 listing，真实节点由后端数据补上。目标目录不在树数据里时保持原内容。
 */
export function insertFileTreeDraftNode(
  nodes: readonly WorkspaceFileTreeNode[],
  directoryPath: string,
  draftNode: WorkspaceFileTreeNode,
): WorkspaceFileTreeNode[] {
  return (
    insertDraftInto(
      nodes,
      normalizeFileTreeDirectoryPath(directoryPath),
      draftNode,
    ) ?? [...nodes]
  );
}

function insertDraftInto(
  nodes: readonly WorkspaceFileTreeNode[],
  targetPath: string,
  draftNode: WorkspaceFileTreeNode,
): WorkspaceFileTreeNode[] | null {
  if (targetPath === ROOT_FILE_TREE_DIRECTORY) {
    return [draftNode, ...nodes];
  }
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.kind !== "directory") continue;
    if (node.path === targetPath) {
      const next = [...nodes];
      next[index] = {
        ...node,
        children: [draftNode, ...(node.children ?? [])],
      };
      return next;
    }
    const children = node.children ?? [];
    if (children.length === 0) continue;
    const nextChildren = insertDraftInto(children, targetPath, draftNode);
    if (nextChildren === null) continue;
    const next = [...nodes];
    next[index] = { ...node, children: nextChildren };
    return next;
  }
  return null;
}

/** 目标目录 + 名字 → 工作区相对路径（新建只创建最后一层，父目录须已存在）。 */
export function buildFileTreeEntryPath(
  directoryPath: string,
  name: string,
): string {
  const target = normalizeFileTreeDirectoryPath(directoryPath);
  return target === ROOT_FILE_TREE_DIRECTORY ? name : `${target}/${name}`;
}

export type FileTreeEntryNameError = "empty" | "invalidName";

/**
 * 名字校验：空白 = 取消（不提交、不报错）；含 `/`、`.`、`..` = 非法（不提交并提示）。
 *
 * 与后端 `fileNameInvalid` 守卫同义，这里先拦一次，避免明显非法的名字走一趟 IPC。
 */
export function getFileTreeEntryNameError(
  name: string,
): FileTreeEntryNameError | null {
  const trimmed = name.trim();
  if (trimmed === "") return "empty";
  if (trimmed === "." || trimmed === ".." || trimmed.includes("/")) {
    return "invalidName";
  }
  return null;
}
