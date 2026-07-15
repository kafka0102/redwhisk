import { invokeCommand } from "./command-client";

/** 终端背景主题，对应后端 `TerminalBackgroundTheme`（已解析，不含 `system`）。 */
export type TerminalBackgroundTheme = "light" | "dark";

export interface SetAppThemeInput {
  theme: TerminalBackgroundTheme;
}

/**
 * 将前端解析后的终端背景主题同步给后端，使后续 spawn 的 PTY 注入匹配的 `COLORFGBG`，
 * 让 Claude Code / Codex 等 CLI 选择与终端背景一致的配色。
 */
export function setAppTheme(input: SetAppThemeInput): Promise<void> {
  return invokeCommand<void>("set_app_theme", { input });
}
