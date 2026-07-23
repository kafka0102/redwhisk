//! Descriptor 命令 snapshot 构造工具（TUI / bypass 参数）。

use std::path::Path;

use crate::agent::claude_config;
use crate::types::agent_session_stream::AgentModel;

pub(super) const CODEX_BYPASS_APPROVALS_AND_SANDBOX_ARG: &str =
    "--dangerously-bypass-approvals-and-sandbox";
pub(super) const CLAUDE_PERMISSION_MODE_ARG: &str = "--permission-mode";
pub(super) const CLAUDE_BYPASS_PERMISSIONS_MODE: &str = "bypassPermissions";
const CODEX_ASK_FOR_APPROVAL_ARG: &str = "--ask-for-approval";
const CODEX_ON_REQUEST_APPROVAL: &str = "on-request";
const CODEX_SANDBOX_ARG: &str = "--sandbox";
const CODEX_SANDBOX_WORKSPACE_WRITE: &str = "workspace-write";
const CODEX_SANDBOX_READ_ONLY: &str = "read-only";
pub(super) const CODEX_FALLBACK_BINARY: &str = "codex";
pub(super) const CLAUDE_FALLBACK_BINARY: &str = "claude";
pub(super) const OPENCODE_AUTO_ARG: &str = "--auto";
pub(super) const OPENCODE_FALLBACK_BINARY: &str = "opencode";

/// Codex 交互式 TUI：按 mode/dangerous 映射审批与沙箱，不注入 app-server。
pub(super) fn build_codex_tui_command_snapshot(raw_command: &str, mode: &str, dangerous: bool) -> String {
    let trimmed = raw_command.trim();
    match mode {
        "full-access" | "full-auto" => {
            append_missing_args(trimmed, &[CODEX_BYPASS_APPROVALS_AND_SANDBOX_ARG])
        }
        "auto" => append_missing_args(
            trimmed,
            &[
                CODEX_ASK_FOR_APPROVAL_ARG,
                CODEX_ON_REQUEST_APPROVAL,
                CODEX_SANDBOX_ARG,
                CODEX_SANDBOX_WORKSPACE_WRITE,
            ],
        ),
        "read-only" | "read_only" => append_missing_args(
            trimmed,
            &[
                CODEX_ASK_FOR_APPROVAL_ARG,
                CODEX_ON_REQUEST_APPROVAL,
                CODEX_SANDBOX_ARG,
                CODEX_SANDBOX_READ_ONLY,
            ],
        ),
        _ if dangerous => {
            append_missing_args(trimmed, &[CODEX_BYPASS_APPROVALS_AND_SANDBOX_ARG])
        }
        _ => trimmed.to_string(),
    }
}

/// Claude 交互式 TUI：按 mode/dangerous 映射 permission-mode，不注入 stream-json / -p。
pub(super) fn build_claude_tui_command_snapshot(raw_command: &str, mode: &str, dangerous: bool) -> String {
    let trimmed = raw_command.trim();
    if command_has_arg(trimmed, CLAUDE_PERMISSION_MODE_ARG) {
        return trimmed.to_string();
    }

    if mode == "full-access" || dangerous {
        return append_missing_args(
            trimmed,
            &[CLAUDE_PERMISSION_MODE_ARG, CLAUDE_BYPASS_PERMISSIONS_MODE],
        );
    }

    match mode {
        "plan" | "acceptEdits" | "auto" => {
            append_missing_args(trimmed, &[CLAUDE_PERMISSION_MODE_ARG, mode])
        }
        _ => trimmed.to_string(),
    }
}

/// OpenCode 交互式 TUI：trim；dangerous 或 mode=full-access 追加 `--auto`；
/// 不注入 `run` / `--format`（json 路径另票）。
pub(super) fn build_opencode_tui_command_snapshot(raw_command: &str, mode: &str, dangerous: bool) -> String {
    let trimmed = raw_command.trim();
    if mode == "full-access" || dangerous {
        append_missing_args(trimmed, &[OPENCODE_AUTO_ARG])
    } else {
        trimmed.to_string()
    }
}

pub(super) fn ensure_claude_bypass_permission_args(command: &str) -> String {
    if command_has_arg(command, CLAUDE_PERMISSION_MODE_ARG) {
        command.trim().to_string()
    } else {
        append_missing_args(
            command,
            &[CLAUDE_PERMISSION_MODE_ARG, CLAUDE_BYPASS_PERMISSIONS_MODE],
        )
    }
}

pub(super) fn append_missing_args(command: &str, args: &[&str]) -> String {
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
pub(super) fn claude_models_from_home(home_dir: &Path) -> Vec<AgentModel> {
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
