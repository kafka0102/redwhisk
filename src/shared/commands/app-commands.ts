import { invokeCommand } from "./command-client";

/** 与 Rust `ThemePreference` 同步（camelCase）。 */
export type ThemePreference = "light" | "dark" | "system";

/** 终端背景主题，对应后端 `TerminalBackgroundTheme`（已解析，不含 `system`）。 */
export type TerminalBackgroundTheme = "light" | "dark";

export interface SetAppThemeInput {
  themePreference: ThemePreference;
  theme: TerminalBackgroundTheme;
}

/** 与 Rust `AppThemePreferenceChangedEvent` 同步。 */
export interface AppThemePreferenceChangedEvent {
  themePreference: ThemePreference;
}

/** 全局主题偏好变更事件（跨窗 UI 同步）。 */
export const APP_THEME_PREFERENCE_CHANGED_EVENT =
  "app-theme-preference-changed";

/**
 * 将应用主题偏好与本窗已解析的终端背景主题同步给后端：
 * 更新后续 spawn 的 `COLORFGBG`，并广播跨窗偏好变更事件。
 */
export function setAppTheme(input: SetAppThemeInput): Promise<void> {
  return invokeCommand<void>("set_app_theme", { input });
}

export function isAppThemePreferenceChangedEvent(
  value: unknown,
): value is AppThemePreferenceChangedEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.themePreference === "light" ||
    record.themePreference === "dark" ||
    record.themePreference === "system"
  );
}
