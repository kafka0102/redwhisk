/**
 * TUI Issue 归档路径与回看正文预处理（与后端 session-logs/archive 布局对齐）。
 */

/** 路径是否含连续段 `session-logs` + `archive`（Issue 完成归档日志）。 */
export function isTuiArchiveLogPath(
  logPath: string | null | undefined,
): boolean {
  if (logPath == null || logPath.trim() === "") {
    return false;
  }
  const normalized = logPath.replace(/\\/g, "/");
  const segments = normalized
    .split("/")
    .filter((segment) => segment.length > 0);
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (
      segments[index] === "session-logs" &&
      segments[index + 1] === "archive"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 归档快照 → AgentMarkdown 源文：去掉交付标签；将 `• ## 标题` 收成 ATX 标题，
 * 便于与 JSON 模式一致渲染标题层级。不剥离 ** / 链接等行内标记。
 */
export function prepareTuiArchiveMarkdownForRender(text: string): string {
  if (text === "") {
    return "";
  }
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").map((line) => {
    let next = line
      .replace(/<\/?issue-comment>/gi, "")
      .replace(/<\/?issue-comment\s*\/?>/gi, "");
    // 可选列表符（• / - / * / 数字.）后接 ATX 标题 → 仅保留标题标记。
    next = next.replace(/^(\s*)(?:[•\-*]|\d+\.)\s+(#{1,6}\s+\S.*)$/u, "$1$2");
    return next;
  });
  return collapseBlankLines(lines);
}

function collapseBlankLines(lines: string[]): string {
  const out: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line.trim() === "") {
      blankRun += 1;
      if (blankRun > 1) {
        continue;
      }
      out.push("");
      continue;
    }
    blankRun = 0;
    out.push(line);
  }
  while (out.length > 0 && out[0] === "") {
    out.shift();
  }
  while (out.length > 0 && out[out.length - 1] === "") {
    out.pop();
  }
  return out.join("\n");
}

/** 归档回看读盘上限：结论归档通常短于 live ring，但仍可能超默认 32KiB。 */
export const TUI_ARCHIVE_READ_MAX_BYTES = 512_000;
