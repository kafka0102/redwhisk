import type { ITerminalOptions } from "@xterm/xterm";

import { getTerminalTheme } from "./terminal-theme";

const TERMINAL_WORD_SEPARATOR = " ()[]{}',\"`";

export const TERMINAL_FONT_FAMILY =
  '"SFMono-Regular", "JetBrains Mono", "IBM Plex Mono", Menlo, Monaco, Consolas, "Sarasa Mono SC", "Noto Sans Mono CJK SC", "PingFang SC", monospace';

export function createTerminalXtermOptions(input: {
  contentFontSize: number;
  theme: "light" | "dark";
}): ITerminalOptions {
  return {
    allowTransparency: false,
    convertEol: false,
    cursorBlink: false,
    cursorInactiveStyle: "outline",
    cursorStyle: "block",
    disableStdin: false,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: input.contentFontSize,
    fontWeight: "normal",
    fontWeightBold: "bold",
    letterSpacing: 0,
    lineHeight: 1,
    // 兜底 TUI 用 truecolor 画出的浅色前景（Codex / Claude Code 在 light 背景上
    // 常见）：xterm 默认 1（不调整），低于该比值的 cell 前景会被动态提亮到可见。
    minimumContrastRatio: 4.5,
    rightClickSelectsWord: false,
    scrollOnEraseInDisplay: true,
    scrollOnUserInput: true,
    scrollback: 10_000,
    smoothScrollDuration: 0,
    theme: getTerminalTheme(input.theme),
    wordSeparator: TERMINAL_WORD_SEPARATOR,
  };
}
