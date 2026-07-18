import type { WorkspaceChangeKind } from "./workspace-commands";

/** 变更状态字母（A/M/D/R/C/X），用于变更列表与文件树徽标统一字样。 */
export function getChangeKindStatusLabel(kind: WorkspaceChangeKind): string {
  switch (kind) {
    case "added":
    case "untracked":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "binary":
      return "X";
    case "modified":
      return "M";
  }
}

/** 变更状态配色类（绿 A、金黄 M、红 D），复用既有 session-commit-file 配色 token。 */
export function getChangeKindStatusClassName(
  kind: WorkspaceChangeKind,
): string {
  switch (kind) {
    case "modified":
      return "session-commit-file__status--modified";
    case "added":
    case "untracked":
      return "session-commit-file__status--added";
    case "renamed":
      return "session-commit-file__status--renamed";
    case "copied":
      return "session-commit-file__status--copied";
    case "deleted":
      return "session-commit-file__status--deleted";
    case "binary":
      return "session-commit-file__status--unknown";
  }
}
