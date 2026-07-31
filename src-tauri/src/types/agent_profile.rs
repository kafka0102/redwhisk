use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentType {
    Codex,
    Claude,
    #[serde(rename = "opencode")]
    OpenCode,
    Grok,
}

impl AgentType {
    /// SQLite / repository 持久化字面量（与 migration CHECK、serde `snake_case` 一致）。
    ///
    /// **新增 variant 时必须同步扩展本方法与 [`Self::from_db_str`]；禁止在
    /// repository 再维护第二份 agent_type 字符串表。** 见
    /// `docs/architecture-design/agent-development-rules.md`「新增 AgentType 门禁」。
    pub fn as_db_str(&self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::OpenCode => "opencode",
            Self::Grok => "grok",
        }
    }

    /// 从 SQLite 字面量解析；未知值返回 `None`（调用方映射为持久化错误）。
    pub fn from_db_str(value: &str) -> Option<Self> {
        match value {
            "codex" => Some(Self::Codex),
            "claude" => Some(Self::Claude),
            "opencode" => Some(Self::OpenCode),
            "grok" => Some(Self::Grok),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentScope {
    Project,
    Global,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfileRecord {
    pub id: i64,
    pub name: String,
    pub agent_type: AgentType,
    pub command: String,
    pub scope: AgentScope,
    pub project_id: Option<i64>,
    pub mode: String,
    pub dangerous: bool,
    pub default_skill: String,
    pub prompt_template: String,
    pub del: i64,
    pub display_mode: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAgentProfileInput {
    pub id: Option<i64>,
    pub name: String,
    pub agent_type: AgentType,
    pub command: String,
    pub scope: AgentScope,
    pub project_id: Option<i64>,
    pub mode: String,
    pub dangerous: bool,
    pub default_skill: String,
    pub prompt_template: String,
    pub display_mode: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfileListResponse {
    pub profiles: Vec<AgentProfileRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCommandCheckResult {
    pub command: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestAgentCommandInput {
    pub command: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAgentProfilesInput {
    pub scope: AgentScope,
    pub project_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAgentProfileInput {
    pub id: i64,
}

/// 参数预览入参（ADR-0020）：依据 profile 的启动相关字段计算命令行参数。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewAgentCommandArgsInput {
    pub agent_type: AgentType,
    pub command: String,
    pub mode: String,
    pub dangerous: bool,
}

#[cfg(test)]
mod tests {
    use super::AgentType;

    #[test]
    fn agent_type_db_roundtrip_covers_all_variants() {
        // 穷尽 as_db_str 的 match 由编译器保证；此处保证 from_db_str 与 as_db_str 互逆。
        let variants = [
            AgentType::Codex,
            AgentType::Claude,
            AgentType::OpenCode,
            AgentType::Grok,
        ];
        for agent_type in variants {
            let literal = agent_type.as_db_str();
            assert_eq!(
                AgentType::from_db_str(literal),
                Some(agent_type),
                "from_db_str missing for {literal}"
            );
        }
    }

    #[test]
    fn agent_type_from_db_str_rejects_unknown() {
        assert_eq!(AgentType::from_db_str("unknown"), None);
        assert_eq!(AgentType::from_db_str(""), None);
    }
}
