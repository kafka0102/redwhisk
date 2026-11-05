import {
  findFileTreeNode,
  parentFileTreeDirectory,
} from "./file-tree-listings";
import type { WorkspaceFileTreeNode } from "./workspace-commands";

export type FileTreePasteRejectReason =
  | "pathAlreadyExists"
  | "pathCopyIntoSelf"
  | "pathMoveIntoSelf";

export interface FileTreePathClipboard {
  kind: WorkspaceFileTreeNode["kind"];
  operation: "copy" | "cut";
  relativePath: string;
  workspacePath: string;
}

export interface FileTreePasteTarget {
  kind: WorkspaceFileTreeNode["kind"];
  relativePath: string;
}

export type FileTreePastePlan =
  | { type: "disabled" }
  | { type: "keep" }
  | { reason: FileTreePasteRejectReason; type: "reject" }
  | {
      destinationDirectory: string;
      destinationPath: string;
      operation: "copy" | "move";
      sourceDirectory: string;
      sourcePath: string;
      type: "transfer";
    };

/** 目标目录已加载的直接子项名字。未加载时返回 null，调用方不得自行循环改名。 */
export function loadedChildNames(
  fileTree: readonly WorkspaceFileTreeNode[],
  directoryPath: string,
): ReadonlySet<string> | null {
  if (directoryPath.length === 0) {
    return new Set(fileTree.map((node) => node.name));
  }
  const directory = findFileTreeNode(fileTree, directoryPath);
  if (directory?.kind !== "directory" || directory.children === undefined) {
    return null;
  }
  return new Set(directory.children.map((node) => node.name));
}

/**
 * 同一目录复制时的新名字。
 * 文件夹、无点的文件、以及只有一个前导点的文件，整名后加「 副本」。
 * 其他文件把「 副本」插在最后一个点之前。候选已存在则改为「 副本 2」。
 */
export function buildDuplicateEntryName(
  name: string,
  existingNames: ReadonlySet<string>,
): string {
  const first = withCopyMarker(name, "");
  if (!existingNames.has(first)) {
    return first;
  }
  for (let index = 2; index < 1000; index += 1) {
    const candidate = withCopyMarker(name, ` ${index}`);
    if (!existingNames.has(candidate)) {
      return candidate;
    }
  }
  return withCopyMarker(name, " 1000");
}

export function planFileTreePaste(input: {
  clipboard: FileTreePathClipboard | null;
  fileTree: readonly WorkspaceFileTreeNode[];
  target: FileTreePasteTarget;
  workspacePath: string | null | undefined;
}): FileTreePastePlan {
  const clipboard = input.clipboard;
  if (
    clipboard === null ||
    input.workspacePath == null ||
    input.workspacePath.length === 0 ||
    clipboard.workspacePath !== input.workspacePath
  ) {
    return { type: "disabled" };
  }

  const destinationDirectory =
    input.target.kind === "directory"
      ? input.target.relativePath
      : parentFileTreeDirectory(input.target.relativePath);
  const sourceDirectory = parentFileTreeDirectory(clipboard.relativePath);

  if (
    clipboard.kind === "directory" &&
    isSameOrDescendant(destinationDirectory, clipboard.relativePath)
  ) {
    return {
      reason:
        clipboard.operation === "cut" ? "pathMoveIntoSelf" : "pathCopyIntoSelf",
      type: "reject",
    };
  }

  if (
    clipboard.operation === "cut" &&
    destinationDirectory === sourceDirectory
  ) {
    return { type: "keep" };
  }

  const sourceName = entryName(clipboard.relativePath);
  const existingNames = loadedChildNames(input.fileTree, destinationDirectory);
  const destinationName =
    clipboard.operation === "copy" && destinationDirectory === sourceDirectory
      ? buildDuplicateEntryName(sourceName, existingNames ?? new Set())
      : sourceName;
  if (
    destinationName === sourceName &&
    existingNames !== null &&
    existingNames.has(destinationName)
  ) {
    return { reason: "pathAlreadyExists", type: "reject" };
  }

  const destinationPath =
    destinationDirectory.length === 0
      ? destinationName
      : `${destinationDirectory}/${destinationName}`;
  return {
    destinationDirectory,
    destinationPath,
    operation: clipboard.operation === "cut" ? "move" : "copy",
    sourceDirectory,
    sourcePath: clipboard.relativePath,
    type: "transfer",
  };
}

export function canPasteFileTreePath(
  clipboard: FileTreePathClipboard | null,
  workspacePath: string | null | undefined,
): boolean {
  return (
    clipboard !== null &&
    workspacePath != null &&
    workspacePath.length > 0 &&
    clipboard.workspacePath === workspacePath
  );
}

function entryName(relativePath: string): string {
  const separator = relativePath.lastIndexOf("/");
  return separator === -1 ? relativePath : relativePath.slice(separator + 1);
}

function isSameOrDescendant(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}/`);
}

function withCopyMarker(name: string, numberSuffix: string): string {
  const marker = ` 副本${numberSuffix}`;
  if (usesWholeNameMarker(name)) {
    return `${name}${marker}`;
  }
  const dot = name.lastIndexOf(".");
  return `${name.slice(0, dot)}${marker}${name.slice(dot)}`;
}

function usesWholeNameMarker(name: string): boolean {
  const firstDot = name.indexOf(".");
  if (firstDot === -1) {
    return true;
  }
  return name.startsWith(".") && name.indexOf(".", 1) === -1;
}
