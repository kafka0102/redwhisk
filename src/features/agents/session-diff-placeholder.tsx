import { GitBranch } from "lucide-react";

import type { SessionWorkspaceFile } from "./session-workspace-types";

interface SessionDiffPlaceholderProps {
  file: SessionWorkspaceFile;
}

export function SessionDiffPlaceholder({ file }: SessionDiffPlaceholderProps) {
  return (
    <section className="session-tab-placeholder" aria-label="Diff placeholder">
      <header className="session-tab-placeholder__header">
        <GitBranch aria-hidden="true" size={15} strokeWidth={1.8} />
        <h3>{file.fileName}</h3>
      </header>
      <pre className="session-tab-placeholder__body">
        {`当前版本暂不实现 Diff 渲染。
模拟文件：${file.filePath}
点击其他变更文件会替换同一个“变更”Tab。`}
      </pre>
    </section>
  );
}
