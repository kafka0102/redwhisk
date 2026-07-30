use serde::{Deserialize, Serialize};

/// 应用主题偏好（可含跟随系统）。跨窗同步时以此值为准，各窗本地再解析 light/dark。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThemePreference {
    Light,
    Dark,
    System,
}

/// 已解析的终端/文档背景主题（不含 system）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalBackgroundTheme {
    Light,
    Dark,
}

/// `set_app_theme` 入参：偏好 + 本窗已解析主题。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAppThemeInput {
    pub theme_preference: ThemePreference,
    pub theme: TerminalBackgroundTheme,
}

/// 全局主题偏好变更事件载荷（跨窗 UI 同步）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppThemePreferenceChangedEvent {
    pub theme_preference: ThemePreference,
}
