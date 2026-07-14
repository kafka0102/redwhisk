use serde::{Deserialize, Serialize};

/// 应用更新检测结果（综合缓存、SemVer、冷却与忽略偏好）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    /// 是否应在 Workbench 顶栏展示版本提醒。
    pub should_show_prompt: bool,
    /// 本地应用版本（无 `v` 前缀）。
    pub current_version: String,
    /// 是否存在严格大于本地的已发布 latest。
    pub has_update: bool,
    /// 远端 latest 版本（无 `v` 前缀）；无已发布 latest 时为 null。
    pub latest_version: Option<String>,
    /// GitHub Release 页面 URL。
    pub release_url: Option<String>,
    /// 用户忽略的版本号。
    pub ignored_version: Option<String>,
    /// 冷却结束时间（UTC RFC3339）；未冷却为 null。
    pub snooze_until: Option<String>,
    /// 最近一次成功解析远端版本的时间（UTC RFC3339）。
    pub checked_at: Option<String>,
    /// 仅强制刷新失败时填充稳定错误码；启动静默检查通常为 null。
    pub error_code: Option<UpdateCheckErrorCode>,
}

/// 强制检查失败时的稳定错误码（camelCase 序列化）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateCheckErrorCode {
    Network,
    InvalidResponse,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetUpdateStatusInput {
    /// true 时绕过 TTL 缓存并请求网络；成功后清除 snooze。
    #[serde(default)]
    pub force_refresh: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DismissUpdatePromptInput {
    pub action: DismissUpdatePromptAction,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DismissUpdatePromptAction {
    Snooze7Days,
    IgnoreVersion,
}

/// SQLite 中的应用更新偏好与检查缓存（单行 id=1）。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AppUpdateStateRecord {
    pub snooze_until: Option<String>,
    pub ignored_version: Option<String>,
    pub last_checked_at: Option<String>,
    pub cached_latest_version: Option<String>,
    pub cached_release_url: Option<String>,
}
