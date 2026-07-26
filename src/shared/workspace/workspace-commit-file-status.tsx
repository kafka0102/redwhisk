import { FileIcon, FilePenLine, FilePlus, Files, FileX } from "lucide-react";
import type { ReactElement } from "react";

import type { WorkspaceCommitStatus } from "./workspace-commands";

/** 提交变更文件状态图标（与时间轴文件行一致）。 */
export function renderCommitFileStatusIcon(
  status: WorkspaceCommitStatus,
): ReactElement {
  const iconProps = {
    "aria-hidden": "true" as const,
    className: "session-commit-file__icon",
    size: 15,
    strokeWidth: 1.8,
  };

  switch (status) {
    case "A":
      return <FilePlus {...iconProps} />;
    case "D":
      return <FileX {...iconProps} />;
    case "R":
    case "C":
      return <Files {...iconProps} />;
    case "M":
      return <FilePenLine {...iconProps} />;
    case "T":
    case "U":
    case "X":
      return <FileIcon {...iconProps} />;
  }
}

/** 提交状态字母配色类（与时间轴一致）。 */
export function getCommitFileStatusClassName(
  status: WorkspaceCommitStatus,
): string {
  switch (status) {
    case "M":
      return "session-commit-file__status--modified";
    case "A":
      return "session-commit-file__status--added";
    case "R":
      return "session-commit-file__status--renamed";
    case "C":
      return "session-commit-file__status--copied";
    case "D":
      return "session-commit-file__status--deleted";
    case "T":
      return "session-commit-file__status--type-changed";
    case "U":
      return "session-commit-file__status--unmerged";
    case "X":
      return "session-commit-file__status--unknown";
  }
}
