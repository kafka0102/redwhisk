// 工具卡正文的纯文本处理：超长内容截断与搜索模式文案。
//
// shell / read / write / edit 的正文共用同一截断口径，避免各处自行切片；
// 本文件不渲染，只做文本处理。

import type { ToolCallDetail } from "../agent-stream-types";

/** 工具卡正文最多渲染的字符数，超出即截断并给出截断提示。 */
export const MAX_TOOL_DETAIL_TEXT_LENGTH = 20_000;

/** 截断结果：可见文本 + 用于截断提示的字符数。 */
export interface TruncatedToolText {
  text: string;
  isTruncated: boolean;
  visibleCharacters: number;
  totalCharacters: number;
}

/** 超过阈值时截断文本；空文本返回 null（调用方据此不渲染正文）。 */
export function truncateToolDetailText(
  text: string | null | undefined,
): TruncatedToolText | null {
  if (!text) {
    return null;
  }
  if (text.length <= MAX_TOOL_DETAIL_TEXT_LENGTH) {
    return {
      text,
      isTruncated: false,
      visibleCharacters: text.length,
      totalCharacters: text.length,
    };
  }
  return {
    text: text.slice(0, MAX_TOOL_DETAIL_TEXT_LENGTH),
    isTruncated: true,
    visibleCharacters: MAX_TOOL_DETAIL_TEXT_LENGTH,
    totalCharacters: text.length,
  };
}

/** 搜索模式的可读文案（`files_with_matches` → `files with matches`）。 */
export function formatSearchMode(
  mode: Extract<ToolCallDetail, { type: "search" }>["mode"],
): string {
  if (mode === "files_with_matches") {
    return "files with matches";
  }
  return mode;
}
