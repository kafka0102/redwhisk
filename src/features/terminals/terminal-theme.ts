import type { ITheme } from "@xterm/xterm";

/**
 * xterm 16 色 + 光标主题。
 *
 * light 模式必须保证 white / brightWhite 相对 background 有足够对比度：
 * 许多 TUI（含 Grok 输入框 caret、内部滚动条）用 ANSI white/brightWhite 画 UI，
 * 若映射为近白则在 light 背景上不可见；dark 模式无此问题。
 *
 * 不设置 selectionForeground：xterm 在选中时会把它强制覆盖到选区所有 cell，
 * 抹平原本的 ANSI / truecolor 彩色文字（对齐 iTerm2 / VS Code「仅覆盖背景、
 * 保留原色」的选中行为）。选区可读性由 selectionBackground 与各前景色的对比保证。
 */
export function getTerminalTheme(theme: "light" | "dark"): ITheme {
  if (theme === "dark") {
    return {
      // 与 app dark chrome (#1f2022) 对齐，并避免近纯黑导致 Codex TUI composer
      // （OSC 11 自适应 truecolor ≈ bg+30）与输出区不可区分。
      background: "#1f2022",
      cursor: "#f5f5f5",
      cursorAccent: "#1f2022",
      foreground: "#f2f3f5",
      selectionBackground: "#264f78",
      selectionInactiveBackground: "#2d3440",
      black: "#0f172a",
      red: "#f87171",
      green: "#4ade80",
      yellow: "#facc15",
      blue: "#60a5fa",
      magenta: "#c084fc",
      cyan: "#22d3ee",
      white: "#d4d4d4",
      brightBlack: "#747b86",
      brightRed: "#fb7185",
      brightGreen: "#86efac",
      brightYellow: "#fde047",
      brightBlue: "#93c5fd",
      brightMagenta: "#d8b4fe",
      brightCyan: "#67e8f9",
      brightWhite: "#f8fafc",
    };
  }

  return {
    background: "#ffffff",
    cursor: "#161515",
    cursorAccent: "#ffffff",
    foreground: "#161515",
    selectionBackground: "#dbeafe",
    selectionInactiveBackground: "#e5e7eb",
    black: "#0f172a",
    red: "#a12d24",
    green: "#1f6b44",
    yellow: "#9b6b16",
    blue: "#275dad",
    magenta: "#8a3b8f",
    cyan: "#1b6f78",
    // light 背景上 ANSI white 必须仍是“可见的浅灰”，不能贴近 #fff
    white: "#6b7280",
    brightBlack: "#64748b",
    brightRed: "#c2410c",
    brightGreen: "#15803d",
    brightYellow: "#a16207",
    brightBlue: "#1d4ed8",
    brightMagenta: "#a21caf",
    brightCyan: "#0f766e",
    // brightWhite 在 light 主题中作高对比强调色（近黑），避免 TUI chrome 洗白
    brightWhite: "#111827",
  };
}

/** WCAG relative luminance for sRGB hex (#rgb / #rrggbb). */
export function hexRelativeLuminance(hex: string): number {
  const normalized = normalizeHex(hex);
  const r = channelToLinear(parseInt(normalized.slice(0, 2), 16) / 255);
  const g = channelToLinear(parseInt(normalized.slice(2, 4), 16) / 255);
  const b = channelToLinear(parseInt(normalized.slice(4, 6), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two sRGB hex colors. */
export function hexContrastRatio(a: string, b: string): number {
  const l1 = hexRelativeLuminance(a);
  const l2 = hexRelativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function normalizeHex(hex: string): string {
  const raw = hex.trim().replace(/^#/, "");
  if (raw.length === 3) {
    return raw
      .split("")
      .map((ch) => `${ch}${ch}`)
      .join("")
      .toLowerCase();
  }
  if (raw.length !== 6) {
    throw new Error(`invalid hex color: ${hex}`);
  }
  return raw.toLowerCase();
}

function channelToLinear(channel: number): number {
  return channel <= 0.03928
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}
