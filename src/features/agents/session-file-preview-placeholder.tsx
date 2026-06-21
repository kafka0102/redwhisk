import { FileCode2 } from "lucide-react";

import type { SessionWorkspaceFile } from "./session-workspace-types";

interface SessionFilePreviewPlaceholderProps {
  file: SessionWorkspaceFile;
}

export function SessionFilePreviewPlaceholder({
  file,
}: SessionFilePreviewPlaceholderProps) {
  return (
    <section className="session-tab-placeholder" aria-label="File placeholder">
      <header className="session-tab-placeholder__header">
        <FileCode2 aria-hidden="true" size={15} strokeWidth={1.8} />
        <h3>{file.fileName}</h3>
      </header>
      <pre className="session-tab-placeholder__body">
        {`// 当前版本使用静态内容模拟代码预览。
// 代码预览占位：${file.filePath}
export function Preview() {
  return "${file.fileName}";
}`}
      </pre>
    </section>
  );
}
