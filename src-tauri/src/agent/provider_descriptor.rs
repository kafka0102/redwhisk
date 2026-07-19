//! Provider 能力描述符：把 Codex / Claude 的启动期能力差异从 service / command 层
//! 下沉到 provider 实现。
//!
//! service / command 通过 [`descriptor_for`] 查表获取描述符，不再 `match agent_type`。
//! 新增第 3 种 agent：实现 [`AgentProviderDescriptor`] + 在 [`descriptor_for`] 注册一行，
//! service / command 零改动。见 ADR-0015。

use std::path::Path;

use crate::agent::claude_config;
use crate::agent::codex_app_server::session::default_codex_models_with_selected;
use crate::agent::codex_config;
use crate::types::agent_profile::AgentType;
use crate::types::agent_session_stream::AgentModel;

const CODEX_BYPASS_APPROVALS_AND_SANDBOX_ARG: &str = "--dangerously-bypass-approvals-and-sandbox";
const CLAUDE_PERMISSION_MODE_ARG: &str = "--permission-mode";
const CLAUDE_BYPASS_PERMISSIONS_MODE: &str = "bypassPermissions";
const CODEX_FALLBACK_BINARY: &str = "codex";
const CLAUDE_FALLBACK_BINARY: &str = "claude";

/// 启动期 runtime 配置（model / effort），由 descriptor 按 provider 规则解析后填入
/// [`crate::agent::provider_factory::AgentSessionStartRequest`]。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeConfig {
    pub model: Option<String>,
    pub effort: Option<String>,
}

/// Provider 能力描述符：把 Codex / Claude 的启动期能力差异收回 provider 实现。
///
/// service / command 不再 `match agent_type`，而是 `descriptor_for(agent_type).<method>()`。
pub trait AgentProviderDescriptor: Send + Sync {
    /// 对应的 agent 类型。
    fn agent_type(&self) -> AgentType;

    /// 解析启动期 model / effort。
    ///
    /// `data_dir` 用于定位 provider 配置目录；`requested_*` 为调用方显式入参，优先于
    /// 配置文件读取。各 provider 决定是否读配置、是否忽略 effort。
    fn resolve_runtime_config(
        &self,
        data_dir: &Path,
        requested_model: Option<&str>,
        requested_effort: Option<&str>,
    ) -> RuntimeConfig;

    /// 构造 PTY 进程启动命令（补全 provider 必需的 bypass 参数）。
    ///
    /// 用于非 structured 的进程启动路径（`spawn_agent_process`）。
    fn build_command_snapshot_with_bypass(&self, raw_command: &str) -> String;

    /// 构造 issue launch 路径的 command snapshot。
    ///
    /// Codex 走 structured 协议（仅 trim，不加 CLI bypass）；Claude 走 CLI（补 bypass）。
    fn build_launch_command_snapshot(&self, raw_command: &str) -> String;

    /// resume 路径下 `command_snapshot` 为空时的兜底命令（provider 默认 binary + bypass）。
    fn fallback_command_when_snapshot_empty(&self) -> String;

    /// 列出 provider 可切换的模型（读 `home_dir` 下 provider 配置）。
    fn list_models(&self, home_dir: &Path) -> Vec<AgentModel>;

    /// 模型列表是否只读（第三方接口不允许切换）。
    fn is_model_list_read_only(&self, home_dir: &Path) -> bool;
}

/// 按 agent 类型查表获取 descriptor。
///
/// 2 种 provider 用 `match` 查表即可（编译期穷尽性是优点）；待第 3 种落地或需动态注册时
/// 再换 `HashMap`（见 ADR-0015）。
pub fn descriptor_for(agent_type: &AgentType) -> &'static dyn AgentProviderDescriptor {
    static CODEX: CodexDescriptor = CodexDescriptor;
    static CLAUDE: ClaudeDescriptor = ClaudeDescriptor;
    match agent_type {
        AgentType::Codex => &CODEX,
        AgentType::Claude => &CLAUDE,
    }
}

// ===== Codex =====

/// Codex provider 描述符。
#[derive(Debug, Clone, Copy)]
pub struct CodexDescriptor;

impl AgentProviderDescriptor for CodexDescriptor {
    fn agent_type(&self) -> AgentType {
        AgentType::Codex
    }

    fn resolve_runtime_config(
        &self,
        data_dir: &Path,
        requested_model: Option<&str>,
        requested_effort: Option<&str>,
    ) -> RuntimeConfig {
        // Codex 配置目录 = data_dir 的父目录（~/.codex 与 data_dir 同级约定）。
        let home = data_dir.parent();
        let model = requested_model
            .map(str::to_string)
            .or_else(|| home.and_then(codex_config::read_model_from_home));
        let effort = requested_effort
            .map(str::to_string)
            .or_else(|| home.and_then(codex_config::read_reasoning_effort_from_home));
        RuntimeConfig { model, effort }
    }

    fn build_command_snapshot_with_bypass(&self, raw_command: &str) -> String {
        append_missing_args(raw_command, &[CODEX_BYPASS_APPROVALS_AND_SANDBOX_ARG])
    }

    fn build_launch_command_snapshot(&self, raw_command: &str) -> String {
        // structured 协议走 app-server，CLI 命令只需 trim，不加 bypass。
        raw_command.trim().to_string()
    }

    fn fallback_command_when_snapshot_empty(&self) -> String {
        append_missing_args(
            CODEX_FALLBACK_BINARY,
            &[CODEX_BYPASS_APPROVALS_AND_SANDBOX_ARG],
        )
    }

    fn list_models(&self, home_dir: &Path) -> Vec<AgentModel> {
        default_codex_models_with_selected(codex_config::read_model_from_home(home_dir).as_deref())
    }

    fn is_model_list_read_only(&self, _home_dir: &Path) -> bool {
        false
    }
}

// ===== Claude =====

/// Claude provider 描述符。
#[derive(Debug, Clone, Copy)]
pub struct ClaudeDescriptor;

impl AgentProviderDescriptor for ClaudeDescriptor {
    fn agent_type(&self) -> AgentType {
        AgentType::Claude
    }

    fn resolve_runtime_config(
        &self,
        _data_dir: &Path,
        requested_model: Option<&str>,
        _requested_effort: Option<&str>,
    ) -> RuntimeConfig {
        // Claude 不支持 reasoning effort；model 取调用方入参。
        RuntimeConfig {
            model: requested_model.map(str::to_string),
            effort: None,
        }
    }

    fn build_command_snapshot_with_bypass(&self, raw_command: &str) -> String {
        ensure_claude_bypass_permission_args(raw_command)
    }

    fn build_launch_command_snapshot(&self, raw_command: &str) -> String {
        ensure_claude_bypass_permission_args(raw_command)
    }

    fn fallback_command_when_snapshot_empty(&self) -> String {
        ensure_claude_bypass_permission_args(CLAUDE_FALLBACK_BINARY)
    }

    fn list_models(&self, home_dir: &Path) -> Vec<AgentModel> {
        claude_models_from_home(home_dir)
    }

    fn is_model_list_read_only(&self, home_dir: &Path) -> bool {
        claude_config::read_settings_from_home(home_dir)
            .map(|snapshot| claude_config::is_third_party(&snapshot))
            .unwrap_or(false)
    }
}

// ===== 内部工具：bypass 参数补全（原 features/agent_session/command_snapshot.rs） =====

fn ensure_claude_bypass_permission_args(command: &str) -> String {
    if command_has_arg(command, CLAUDE_PERMISSION_MODE_ARG) {
        command.trim().to_string()
    } else {
        append_missing_args(
            command,
            &[CLAUDE_PERMISSION_MODE_ARG, CLAUDE_BYPASS_PERMISSIONS_MODE],
        )
    }
}

fn append_missing_args(command: &str, args: &[&str]) -> String {
    let trimmed = command.trim();
    let mut command_line = trimmed.to_string();

    for arg in args {
        if command_has_arg(trimmed, arg) {
            continue;
        }

        if !command_line.is_empty() {
            command_line.push(' ');
        }
        command_line.push_str(arg);
    }

    command_line
}

fn command_has_arg(command: &str, arg: &str) -> bool {
    command.split_whitespace().any(|part| part == arg)
}

/// 从 `~/.claude/settings.json` 解析 Claude 可用模型列表（原 commands.rs）。
///
/// - 第三方接口（存在 base_url / auth_token）：返回单个只读模型，modelId 取
///   `env.ANTHROPIC_MODEL` 或顶层 `model`，前端展示但不允许切换。
/// - 官方接口：返回 opus / sonnet / haiku 列表，当前 settings.json 的 `model`
///   字段对应项标 `is_default`，允许用户切换并持久化。
fn claude_models_from_home(home_dir: &Path) -> Vec<AgentModel> {
    let snapshot = match claude_config::read_settings_from_home(home_dir) {
        Some(s) => s,
        None => return Vec::new(),
    };
    if claude_config::is_third_party(&snapshot) {
        // 第三方接口：只读展示当前真实模型（env.ANTHROPIC_MODEL 优先于顶层 model）。
        let current = snapshot.anthropic_model.or(snapshot.model.clone());
        let model_id = current.clone().unwrap_or_else(|| "claude".to_string());
        return vec![AgentModel {
            model_id,
            display_name: current,
            is_default: Some(true),
            default_reasoning_effort: None,
            supported_reasoning_efforts: Vec::new(),
        }];
    }
    // 官方接口：返回 opus / sonnet / haiku，当前 settings.json 的 model 标默认。
    let current = snapshot.model.as_deref();
    claude_config::OFFICIAL_CLAUDE_MODELS
        .iter()
        .map(|(model_id, display_name)| AgentModel {
            model_id: (*model_id).to_string(),
            display_name: Some((*display_name).to_string()),
            // 当前 settings.json 的 model 字段匹配则标默认（兼容 "sonnet[1m]" 等带后缀别名）。
            is_default: Some(current.is_some_and(|c| c == *model_id || c.starts_with(model_id))),
            default_reasoning_effort: None,
            supported_reasoning_efforts: Vec::new(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn codex_data_dir(temp: &tempfile::TempDir) -> std::path::PathBuf {
        // 约定：data_dir 的 parent 即 home；temp.path() 当 home，data_dir = home/data。
        temp.path().join("data")
    }

    fn write_codex_config(home: &Path, model: Option<&str>, effort: Option<&str>) {
        let codex_dir = home.join(".codex");
        fs::create_dir_all(&codex_dir).expect("codex dir");
        let mut content = String::new();
        if let Some(model) = model {
            content.push_str(&format!("model = \"{model}\"\n"));
        }
        if let Some(effort) = effort {
            content.push_str(&format!("model_reasoning_effort = \"{effort}\"\n"));
        }
        fs::write(codex_dir.join("config.toml"), content).expect("write config");
    }

    #[test]
    fn descriptor_for_returns_matching_descriptor() {
        assert_eq!(descriptor_for(&AgentType::Codex).agent_type(), AgentType::Codex);
        assert_eq!(
            descriptor_for(&AgentType::Claude).agent_type(),
            AgentType::Claude
        );
    }

    #[test]
    fn codex_resolve_runtime_config_reads_from_data_dir_parent() {
        let temp = tempfile::tempdir().expect("temp");
        write_codex_config(temp.path(), Some("gpt-5"), Some("high"));
        let data_dir = codex_data_dir(&temp);

        let config = CodexDescriptor.resolve_runtime_config(&data_dir, None, None);
        assert_eq!(config.model.as_deref(), Some("gpt-5"));
        assert_eq!(config.effort.as_deref(), Some("high"));
    }

    #[test]
    fn codex_resolve_runtime_config_prefers_requested_over_config() {
        let temp = tempfile::tempdir().expect("temp");
        write_codex_config(temp.path(), Some("gpt-5"), Some("high"));
        let data_dir = codex_data_dir(&temp);

        let config = CodexDescriptor.resolve_runtime_config(&data_dir, Some("gpt-5.5"), Some("xhigh"));
        assert_eq!(config.model.as_deref(), Some("gpt-5.5"));
        assert_eq!(config.effort.as_deref(), Some("xhigh"));
    }

    #[test]
    fn claude_resolve_runtime_config_ignores_effort_and_data_dir() {
        let temp = tempfile::tempdir().expect("temp");
        let data_dir = codex_data_dir(&temp);

        let config = ClaudeDescriptor.resolve_runtime_config(&data_dir, Some("sonnet"), Some("high"));
        assert_eq!(config.model.as_deref(), Some("sonnet"));
        assert!(config.effort.is_none());
    }

    #[test]
    fn claude_resolve_runtime_config_returns_none_when_no_request() {
        let temp = tempfile::tempdir().expect("temp");
        let data_dir = codex_data_dir(&temp);

        let config = ClaudeDescriptor.resolve_runtime_config(&data_dir, None, None);
        assert!(config.model.is_none());
        assert!(config.effort.is_none());
    }

    #[test]
    fn codex_build_command_snapshot_with_bypass_appends_flag() {
        assert_eq!(
            CodexDescriptor.build_command_snapshot_with_bypass("codex"),
            "codex --dangerously-bypass-approvals-and-sandbox"
        );
    }

    #[test]
    fn codex_build_command_snapshot_with_bypass_keeps_existing_flag() {
        assert_eq!(
            CodexDescriptor
                .build_command_snapshot_with_bypass("codex --dangerously-bypass-approvals-and-sandbox"),
            "codex --dangerously-bypass-approvals-and-sandbox"
        );
    }

    #[test]
    fn claude_build_command_snapshot_with_bypass_appends_permission_mode() {
        assert_eq!(
            ClaudeDescriptor.build_command_snapshot_with_bypass("claude"),
            "claude --permission-mode bypassPermissions"
        );
    }

    #[test]
    fn claude_build_command_snapshot_with_bypass_keeps_existing_permission_mode() {
        assert_eq!(
            ClaudeDescriptor.build_command_snapshot_with_bypass("claude --permission-mode auto"),
            "claude --permission-mode auto"
        );
    }

    #[test]
    fn codex_build_launch_command_snapshot_trims_only() {
        assert_eq!(
            CodexDescriptor.build_launch_command_snapshot(" codex-asxs "),
            "codex-asxs"
        );
    }

    #[test]
    fn claude_build_launch_command_snapshot_appends_bypass() {
        assert_eq!(
            ClaudeDescriptor.build_launch_command_snapshot("claude"),
            "claude --permission-mode bypassPermissions"
        );
    }

    #[test]
    fn fallback_command_when_snapshot_empty_returns_default_with_bypass() {
        assert_eq!(
            CodexDescriptor.fallback_command_when_snapshot_empty(),
            "codex --dangerously-bypass-approvals-and-sandbox"
        );
        assert_eq!(
            ClaudeDescriptor.fallback_command_when_snapshot_empty(),
            "claude --permission-mode bypassPermissions"
        );
    }

    #[test]
    fn codex_list_models_marks_selected_from_config() {
        let temp = tempfile::tempdir().expect("temp");
        write_codex_config(temp.path(), Some("gpt-5"), None);

        let models = CodexDescriptor.list_models(temp.path());
        let default = models
            .iter()
            .find(|m| m.is_default == Some(true))
            .expect("有一个默认模型");
        assert_eq!(default.model_id, "gpt-5");
    }

    #[test]
    fn codex_is_model_list_read_only_is_always_false() {
        let temp = tempfile::tempdir().expect("temp");
        assert!(!CodexDescriptor.is_model_list_read_only(temp.path()));
    }

    #[test]
    fn claude_list_models_empty_when_no_settings() {
        let temp = tempfile::tempdir().expect("temp");
        assert!(ClaudeDescriptor.list_models(temp.path()).is_empty());
    }

    #[test]
    fn claude_list_models_official_marks_current_default() {
        let temp = tempfile::tempdir().expect("temp");
        let claude_dir = temp.path().join(".claude");
        fs::create_dir_all(&claude_dir).expect("claude dir");
        fs::write(
            claude_dir.join("settings.json"),
            r#"{"model": "sonnet", "env": {}}"#,
        )
        .expect("write settings");

        let models = ClaudeDescriptor.list_models(temp.path());
        let ids: Vec<&str> = models.iter().map(|m| m.model_id.as_str()).collect();
        assert_eq!(ids, vec!["opus", "sonnet", "haiku"]);
        let default = models
            .iter()
            .find(|m| m.is_default == Some(true))
            .expect("sonnet 默认");
        assert_eq!(default.model_id, "sonnet");
    }

    #[test]
    fn claude_is_model_list_read_only_detects_third_party() {
        let temp = tempfile::tempdir().expect("temp");
        let claude_dir = temp.path().join(".claude");
        fs::create_dir_all(&claude_dir).expect("claude dir");
        fs::write(
            claude_dir.join("settings.json"),
            r#"{"model": "sonnet[1m]", "env": {"ANTHROPIC_BASE_URL": "http://x:9009"}}"#,
        )
        .expect("write settings");

        assert!(ClaudeDescriptor.is_model_list_read_only(temp.path()));
    }

    #[test]
    fn claude_is_model_list_read_only_false_for_official() {
        let temp = tempfile::tempdir().expect("temp");
        let claude_dir = temp.path().join(".claude");
        fs::create_dir_all(&claude_dir).expect("claude dir");
        fs::write(
            claude_dir.join("settings.json"),
            r#"{"model": "opus", "env": {}}"#,
        )
        .expect("write settings");

        assert!(!ClaudeDescriptor.is_model_list_read_only(temp.path()));
    }
}
