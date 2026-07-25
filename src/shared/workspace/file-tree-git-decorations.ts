import type { WorkspaceChangeKind } from "./workspace-commands";

/** 构建文件树 Git 装饰时所需的最小变更输入（相对路径 + kind）。 */
export interface FileTreeDecorationSource {
  filePath: string;
  kind: WorkspaceChangeKind;
}

/** 文件保留原 kind；目录为按 D > M > A 聚合后的代表 kind。 */
export interface FileTreeDecorations {
  fileKinds: ReadonlyMap<string, WorkspaceChangeKind>;
  directoryKinds: ReadonlyMap<string, WorkspaceChangeKind>;
}

const EMPTY_FILE_KINDS: ReadonlyMap<string, WorkspaceChangeKind> = new Map();
const EMPTY_DIRECTORY_KINDS: ReadonlyMap<string, WorkspaceChangeKind> =
  new Map();

const EMPTY_DECORATIONS: FileTreeDecorations = {
  fileKinds: EMPTY_FILE_KINDS,
  directoryKinds: EMPTY_DIRECTORY_KINDS,
};

/**
 * 聚合优先级（数值越大优先）：D > M > A/untracked。
 * renamed / copied / binary 按 M 参与聚合。
 */
function aggregationRank(kind: WorkspaceChangeKind): number {
  switch (kind) {
    case "deleted":
      return 3;
    case "modified":
    case "renamed":
    case "copied":
    case "binary":
      return 2;
    case "added":
    case "untracked":
      return 1;
  }
}

/** 目录着色用的代表 kind：A/untracked→added，M 族→modified，D→deleted。 */
function aggregationKind(kind: WorkspaceChangeKind): WorkspaceChangeKind {
  switch (kind) {
    case "deleted":
      return "deleted";
    case "added":
    case "untracked":
      return "added";
    case "modified":
    case "renamed":
    case "copied":
    case "binary":
      return "modified";
  }
}

/** 由变更 filePath 推导祖先目录相对路径（不含文件自身；根级文件返回空）。 */
function ancestorDirectoryPaths(filePath: string): string[] {
  const segments = filePath.split("/").filter((segment) => segment.length > 0);
  if (segments.length <= 1) {
    return [];
  }

  const directories: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    directories.push(segments.slice(0, index).join("/"));
  }
  return directories;
}

/**
 * 将未提交变更列表转为文件树装饰查找表。
 *
 * - 文件：以 `filePath` 为键保留原 kind（字母徽标可继续走 change-status）。
 * - 目录：对所有落在此前缀下的变更做 D > M > A 聚合。
 * - 重命名：只写入新路径；调用方不得、本函数也不会因 oldPath 单独写装饰。
 */
export function buildFileTreeDecorations(
  files: ReadonlyArray<FileTreeDecorationSource>,
): FileTreeDecorations {
  if (files.length === 0) {
    return EMPTY_DECORATIONS;
  }

  const fileKinds = new Map<string, WorkspaceChangeKind>();
  const directoryBest = new Map<
    string,
    { rank: number; kind: WorkspaceChangeKind }
  >();

  for (const file of files) {
    fileKinds.set(file.filePath, file.kind);

    const rank = aggregationRank(file.kind);
    const kind = aggregationKind(file.kind);

    for (const directoryPath of ancestorDirectoryPaths(file.filePath)) {
      const existing = directoryBest.get(directoryPath);
      if (existing === undefined || rank > existing.rank) {
        directoryBest.set(directoryPath, { rank, kind });
      }
    }
  }

  const directoryKinds = new Map<string, WorkspaceChangeKind>();
  for (const [path, best] of directoryBest) {
    directoryKinds.set(path, best.kind);
  }

  return { fileKinds, directoryKinds };
}
