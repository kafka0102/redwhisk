use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IssueSourceMode {
    Local,
    Remote,
    Mixed,
}

impl IssueSourceMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Remote => "remote",
            Self::Mixed => "mixed",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "local" => Some(Self::Local),
            "remote" => Some(Self::Remote),
            "mixed" => Some(Self::Mixed),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IssueSyncScope {
    AssignedToMe,
    AllOpen,
    Label,
    All,
}

impl IssueSyncScope {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AssignedToMe => "assigned_to_me",
            Self::AllOpen => "all_open",
            Self::Label => "label",
            Self::All => "all",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "assigned_to_me" => Some(Self::AssignedToMe),
            "all_open" => Some(Self::AllOpen),
            "label" => Some(Self::Label),
            "all" => Some(Self::All),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IssueCreateSource {
    Local,
    Remote,
}

impl IssueCreateSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Remote => "remote",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "local" => Some(Self::Local),
            "remote" => Some(Self::Remote),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ForgeProvider {
    Github,
    Gitlab,
}

impl ForgeProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Github => "github",
            Self::Gitlab => "gitlab",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "github" => Some(Self::Github),
            "gitlab" => Some(Self::Gitlab),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ForgeAuthStatus {
    Unknown,
    Ready,
    Expired,
    Unauthenticated,
    CliMissing,
    NotForge,
}

impl ForgeAuthStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Ready => "ready",
            Self::Expired => "expired",
            Self::Unauthenticated => "unauthenticated",
            Self::CliMissing => "cli_missing",
            Self::NotForge => "not_forge",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "unknown" => Some(Self::Unknown),
            "ready" => Some(Self::Ready),
            "expired" => Some(Self::Expired),
            "unauthenticated" => Some(Self::Unauthenticated),
            "cli_missing" => Some(Self::CliMissing),
            "not_forge" => Some(Self::NotForge),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIssueConnection {
    pub provider: Option<ForgeProvider>,
    pub host_url: Option<String>,
    pub repo_path: Option<String>,
    pub login: Option<String>,
    pub cli_installed: bool,
    pub cli_authenticated: bool,
    pub auth_status: ForgeAuthStatus,
    pub checked_at: i64,
}

impl ProjectIssueConnection {
    pub fn unknown() -> Self {
        Self {
            provider: None,
            host_url: None,
            repo_path: None,
            login: None,
            cli_installed: false,
            cli_authenticated: false,
            auth_status: ForgeAuthStatus::Unknown,
            checked_at: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIssueSourceSettings {
    pub project_id: i64,
    pub issue_source_mode: IssueSourceMode,
    pub issue_sync_scope: IssueSyncScope,
    pub issue_sync_label: Option<String>,
    pub issue_sync_enabled: bool,
    pub issue_sync_interval_seconds: i64,
    pub issue_writeback_close_on_complete: bool,
    pub issue_writeback_close_on_pr_merge: bool,
    pub issue_writeback_comment: bool,
    pub issue_create_source: IssueCreateSource,
    pub local_issue_count: i64,
    pub remote_issue_count: i64,
    pub connection: ProjectIssueConnection,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateProjectIssueSourceSettings {
    pub project_id: i64,
    pub issue_source_mode: Option<IssueSourceMode>,
    pub issue_sync_scope: Option<IssueSyncScope>,
    pub issue_sync_label: Option<String>,
    pub issue_sync_enabled: Option<bool>,
    pub issue_sync_interval_seconds: Option<i64>,
    pub issue_writeback_close_on_complete: Option<bool>,
    pub issue_writeback_close_on_pr_merge: Option<bool>,
    pub issue_writeback_comment: Option<bool>,
    pub issue_create_source: Option<IssueCreateSource>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectIssueSourceSettingsInput {
    pub project_id: i64,
    #[serde(default)]
    pub issue_source_mode: Option<Value>,
    #[serde(default)]
    pub issue_sync_scope: Option<Value>,
    #[serde(default)]
    pub issue_sync_label: Option<Value>,
    #[serde(default)]
    pub issue_sync_enabled: Option<Value>,
    #[serde(default)]
    pub issue_sync_interval_seconds: Option<Value>,
    #[serde(default)]
    pub issue_writeback_close_on_complete: Option<Value>,
    #[serde(default)]
    pub issue_writeback_close_on_pr_merge: Option<Value>,
    #[serde(default)]
    pub issue_writeback_comment: Option<Value>,
    #[serde(default)]
    pub issue_create_source: Option<Value>,
}
