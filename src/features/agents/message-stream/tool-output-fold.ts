// 工具卡里大块输出 / 大 diff 是否需要在卡内嵌套折叠的阈值判定（纯函数）。
//
// 阈值来自 spec `.scratch/session-json-rendering-links/spec.md` 关键决策 7：
// 输出超过 40 行或 4000 字符、diff 超过 120 行才折叠，小内容维持原有可读布局。

/** 输出折叠的行数阈值（spec 决策 7）。 */
export const TOOL_OUTPUT_FOLD_LINE_LIMIT = 40;

/** 输出折叠的字符数阈值（spec 决策 7）。 */
export const TOOL_OUTPUT_FOLD_CHARACTER_LIMIT = 4000;

/** diff 折叠的行数阈值（spec 决策 7）。 */
export const TOOL_DIFF_FOLD_LINE_LIMIT = 120;

/**
 * 统计文本行数，用于折叠摘要。
 *
 * 空文本按 0 行；CRLF / CR 归一为 LF；末行换行不额外计一行。
 */
export function countTextLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  const normalized = text.replace(/\r\n?/g, "\n");
  const body = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return body.split("\n").length;
}

/** 输出超过任一阈值（40 行或 4000 字符）时需要嵌套折叠。 */
export function isFoldableToolOutput(text: string): boolean {
  return (
    countTextLines(text) > TOOL_OUTPUT_FOLD_LINE_LIMIT ||
    text.length > TOOL_OUTPUT_FOLD_CHARACTER_LIMIT
  );
}

/** diff 超过 120 行时需要嵌套折叠。 */
export function isFoldableToolDiff(diff: string): boolean {
  return countTextLines(diff) > TOOL_DIFF_FOLD_LINE_LIMIT;
}
