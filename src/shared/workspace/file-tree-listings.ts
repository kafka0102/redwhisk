import type { WorkspaceFileTreeNode } from "./workspace-commands";

/** 工作区根目录在 listings 中的键；对应 command 省略 `directoryPath`。 */
export const ROOT_FILE_TREE_DIRECTORY = "";

export interface FileTreeDirectoryListing {
  nodes: WorkspaceFileTreeNode[];
  signature: string;
}

export function normalizeFileTreeDirectoryPath(
  directoryPath: string | null | undefined,
): string {
  if (directoryPath == null) {
    return ROOT_FILE_TREE_DIRECTORY;
  }
  const trimmed = directoryPath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (trimmed === "" || trimmed === ".") {
    return ROOT_FILE_TREE_DIRECTORY;
  }
  return trimmed;
}

export function parentFileTreeDirectory(filePath: string): string {
  const normalized = normalizeFileTreeDirectoryPath(filePath);
  if (normalized === ROOT_FILE_TREE_DIRECTORY) {
    return ROOT_FILE_TREE_DIRECTORY;
  }
  const separatorIndex = normalized.lastIndexOf("/");
  if (separatorIndex <= 0) {
    return ROOT_FILE_TREE_DIRECTORY;
  }
  return normalized.slice(0, separatorIndex);
}

export function fileTreeDirectoryAncestors(directoryPath: string): string[] {
  const normalized = normalizeFileTreeDirectoryPath(directoryPath);
  if (normalized === ROOT_FILE_TREE_DIRECTORY) {
    return [];
  }
  const parts = normalized.split("/");
  const paths: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    paths.push(parts.slice(0, index + 1).join("/"));
  }
  return paths;
}

export function visitFileTreeAncestorDirectories(
  filePath: string,
  visit: (directoryPath: string) => void,
): void {
  const parent = parentFileTreeDirectory(filePath);
  if (parent === ROOT_FILE_TREE_DIRECTORY) {
    return;
  }
  for (const directoryPath of fileTreeDirectoryAncestors(parent)) {
    visit(directoryPath);
  }
}

export function upsertFileTreeListing(
  listings: Readonly<Record<string, FileTreeDirectoryListing>>,
  directoryPath: string,
  listing: FileTreeDirectoryListing,
): Record<string, FileTreeDirectoryListing> {
  const key = normalizeFileTreeDirectoryPath(directoryPath);
  const previous = listings[key];
  if (previous != null && previous.signature === listing.signature) {
    return listings as Record<string, FileTreeDirectoryListing>;
  }
  return {
    ...listings,
    [key]: listing,
  };
}

export function assembleFileTree(
  listings: Readonly<Record<string, FileTreeDirectoryListing>>,
): WorkspaceFileTreeNode[] {
  const visiting = new Set<string>();
  const attach = (nodes: WorkspaceFileTreeNode[]): WorkspaceFileTreeNode[] =>
    nodes.map((node) => {
      if (node.kind !== "directory") {
        return node;
      }
      const listing = listings[node.path];
      if (listing == null || visiting.has(node.path)) {
        return node;
      }
      visiting.add(node.path);
      const children = attach(listing.nodes);
      visiting.delete(node.path);
      return {
        ...node,
        children,
      };
    });
  return attach(listings[ROOT_FILE_TREE_DIRECTORY]?.nodes ?? []);
}

export function fileTreeChildrenAccessor(
  node: WorkspaceFileTreeNode,
): WorkspaceFileTreeNode[] | null {
  if (node.kind !== "directory") {
    return null;
  }
  return node.children ?? [];
}

export function findFileTreeNode(
  nodes: readonly WorkspaceFileTreeNode[],
  path: string,
): WorkspaceFileTreeNode | null {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }
    const descendant = findFileTreeNode(node.children ?? [], path);
    if (descendant != null) {
      return descendant;
    }
  }
  return null;
}

export function isFileTreeDirectoryLoaded(
  listings: Readonly<Record<string, FileTreeDirectoryListing>>,
  tree: readonly WorkspaceFileTreeNode[],
  directoryPath: string,
): boolean {
  const pathKey = normalizeFileTreeDirectoryPath(directoryPath);
  if (pathKey === ROOT_FILE_TREE_DIRECTORY) {
    return listings[ROOT_FILE_TREE_DIRECTORY] != null;
  }
  if (listings[pathKey] != null) {
    return true;
  }
  const node = findFileTreeNode(tree, pathKey);
  return node?.kind === "directory" && node.children !== undefined;
}

export function fileTreeDirectoryPathsToLoad(
  listings: Readonly<Record<string, FileTreeDirectoryListing>>,
): string[] {
  const keys = Object.keys(listings);
  if (keys.length === 0) {
    return [ROOT_FILE_TREE_DIRECTORY];
  }
  return keys;
}
