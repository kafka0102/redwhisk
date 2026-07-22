import { describe, expect, it } from "vitest";

import { getTerminalTheme, hexContrastRatio } from "./terminal-theme";

/**
 * Feedback loop：Grok 等 TUI 在 light 终端里用 ANSI white / brightWhite
 * 画输入 caret、内部滚动条；若相对 background 对比度过低，用户只能看到
 * xterm 外层滚动条，看不到 Grok 内部 chrome（dark 正常）。
 *
 * UI 组件最低对比度取 WCAG 2.1 非文本对比 3:1；正文/光标 4.5:1。
 */
const MIN_UI_CONTRAST = 3;
const MIN_TEXT_CONTRAST = 4.5;

const LIGHT_UI_KEYS = ["white", "brightWhite", "brightBlack"] as const;
const TEXT_KEYS = ["foreground", "cursor"] as const;

describe("terminal theme contrast (Grok light-mode visibility)", () => {
  it("light: ANSI white/brightWhite keep UI-level contrast on background", () => {
    const theme = getTerminalTheme("light");
    const background = requireHex(theme.background, "background");

    for (const key of LIGHT_UI_KEYS) {
      const color = requireHex(theme[key], key);
      const ratio = hexContrastRatio(color, background);
      expect(
        ratio,
        `light ${key}=${color} vs bg=${background} contrast ${ratio.toFixed(2)} < ${MIN_UI_CONTRAST} (Grok scrollbar/caret washout)`,
      ).toBeGreaterThanOrEqual(MIN_UI_CONTRAST);
    }
  });

  it("light: default foreground and cursor stay text-readable on background", () => {
    const theme = getTerminalTheme("light");
    const background = requireHex(theme.background, "background");

    for (const key of TEXT_KEYS) {
      const color = requireHex(theme[key], key);
      const ratio = hexContrastRatio(color, background);
      expect(
        ratio,
        `light ${key}=${color} vs bg=${background} contrast ${ratio.toFixed(2)} < ${MIN_TEXT_CONTRAST}`,
      ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });

  it("dark: white/brightWhite remain visible (control — must stay green)", () => {
    const theme = getTerminalTheme("dark");
    const background = requireHex(theme.background, "background");

    for (const key of ["white", "brightWhite"] as const) {
      const color = requireHex(theme[key], key);
      const ratio = hexContrastRatio(color, background);
      expect(
        ratio,
        `dark ${key}=${color} vs bg=${background} contrast ${ratio.toFixed(2)} < ${MIN_UI_CONTRAST}`,
      ).toBeGreaterThanOrEqual(MIN_UI_CONTRAST);
    }
  });

  it("does not pin selectionForeground so selection keeps original text colors", () => {
    // 设了 selectionForeground 时，xterm（core 与 webgl renderer）会把它强制覆盖
    // 到选区所有 cell，抹平 ANSI / truecolor 彩色文字。不设则恢复 iTerm2 / VS Code
    // 「仅覆盖背景、保留原色」的选中行为 —— 这是选中后文字不再统一变黑/变白的根因。
    expect(getTerminalTheme("light").selectionForeground).toBeUndefined();
    expect(getTerminalTheme("dark").selectionForeground).toBeUndefined();
  });

  it("documents legacy light washout values fail the Grok symptom threshold", () => {
    // 修复前 light 调色板：white/brightWhite 贴白，TUI chrome 不可见
    const legacyWhite = "#d4d4d4";
    const legacyBrightWhite = "#f8fafc";
    const lightBg = "#ffffff";
    expect(hexContrastRatio(legacyWhite, lightBg)).toBeLessThan(
      MIN_UI_CONTRAST,
    );
    expect(hexContrastRatio(legacyBrightWhite, lightBg)).toBeLessThan(
      MIN_UI_CONTRAST,
    );
  });
});

function requireHex(value: string | undefined, label: string): string {
  if (!value || !value.startsWith("#")) {
    throw new Error(`expected hex for ${label}, got ${String(value)}`);
  }
  return value;
}

/**
 * Codex TUI 用 OSC 11 读取默认背景后，把底部 composer 画成 truecolor ≈ bg+~30。
 * 近纯黑背景（旧值 #050506）抬升后仍约 #232323，对比度 ~1.3:1，肉眼等同全黑。
 * 要求 dark background 足够抬离纯黑，使自适应 composer 条带可辨。
 */
const CODEX_COMPOSER_LIFT = 30;
const MIN_CODEX_COMPOSER_CONTRAST = 1.4;

describe("terminal theme contrast (Codex dark composer strip)", () => {
  it("dark: background is lifted so Codex adaptive composer stays distinguishable", () => {
    const theme = getTerminalTheme("dark");
    const background = requireHex(theme.background, "background");
    const lifted = liftHex(background, CODEX_COMPOSER_LIFT);
    const ratio = hexContrastRatio(background, lifted);
    expect(
      ratio,
      `dark bg=${background} lifted=${lifted} contrast ${ratio.toFixed(2)} < ${MIN_CODEX_COMPOSER_CONTRAST} (Codex composer washout)`,
    ).toBeGreaterThanOrEqual(MIN_CODEX_COMPOSER_CONTRAST);
  });

  it("documents legacy near-black dark bg fails the Codex composer threshold", () => {
    const legacyBg = "#050506";
    const lifted = liftHex(legacyBg, CODEX_COMPOSER_LIFT);
    expect(hexContrastRatio(legacyBg, lifted)).toBeLessThan(
      MIN_CODEX_COMPOSER_CONTRAST,
    );
  });
});

/**
 * dark 选区相对背景须可辨：active 对齐 VS Code dark 量级（约 1.9），
 * inactive 弱于 active 但仍可见；默认前景在 active 选区上保持正文可读。
 */
const MIN_DARK_SELECTION_ACTIVE_CONTRAST = 1.8;
const MIN_DARK_SELECTION_INACTIVE_CONTRAST = 1.25;

describe("terminal theme contrast (dark selection readability)", () => {
  it("dark: active selectionBackground contrasts enough against background", () => {
    const theme = getTerminalTheme("dark");
    const background = requireHex(theme.background, "background");
    const selection = requireHex(
      theme.selectionBackground,
      "selectionBackground",
    );
    const ratio = hexContrastRatio(selection, background);
    expect(
      ratio,
      `dark selectionBackground=${selection} vs bg=${background} contrast ${ratio.toFixed(2)} < ${MIN_DARK_SELECTION_ACTIVE_CONTRAST}`,
    ).toBeGreaterThanOrEqual(MIN_DARK_SELECTION_ACTIVE_CONTRAST);
  });

  it("dark: inactive selectionInactiveBackground stays distinguishable on background", () => {
    const theme = getTerminalTheme("dark");
    const background = requireHex(theme.background, "background");
    const selection = requireHex(
      theme.selectionInactiveBackground,
      "selectionInactiveBackground",
    );
    const ratio = hexContrastRatio(selection, background);
    expect(
      ratio,
      `dark selectionInactiveBackground=${selection} vs bg=${background} contrast ${ratio.toFixed(2)} < ${MIN_DARK_SELECTION_INACTIVE_CONTRAST}`,
    ).toBeGreaterThanOrEqual(MIN_DARK_SELECTION_INACTIVE_CONTRAST);
  });

  it("dark: default foreground remains text-readable on active selection", () => {
    const theme = getTerminalTheme("dark");
    const foreground = requireHex(theme.foreground, "foreground");
    const selection = requireHex(
      theme.selectionBackground,
      "selectionBackground",
    );
    const ratio = hexContrastRatio(foreground, selection);
    expect(
      ratio,
      `dark foreground=${foreground} vs selectionBackground=${selection} contrast ${ratio.toFixed(2)} < ${MIN_TEXT_CONTRAST}`,
    ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });
});

function liftHex(hex: string, amount: number): string {
  const raw = hex.replace(/^#/, "");
  const r = Math.min(255, parseInt(raw.slice(0, 2), 16) + amount);
  const g = Math.min(255, parseInt(raw.slice(2, 4), 16) + amount);
  const b = Math.min(255, parseInt(raw.slice(4, 6), 16) + amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
