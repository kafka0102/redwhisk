use std::path::Path;

use crate::agent::descriptor_for;
use crate::types::agent_profile::AgentType;

/// 认定运行参数模型：启动期模型选择 → 该 Agent 启动时刻的当前模型（模型目录默认项）→ 空。
///
/// 存的是发给 LLM 的模型参数：目录条目有 `wire_model` 时用它，否则用模型 id。
pub(super) fn resolve_startup_model(
    agent_type: &AgentType,
    home_dir: &Path,
    command: &str,
    requested_model: Option<&str>,
) -> Option<String> {
    let models = descriptor_for(agent_type).list_models(home_dir, command);
    let requested = requested_model
        .map(str::trim)
        .filter(|model| !model.is_empty());
    let selected =
        requested.and_then(|model_id| models.iter().find(|model| model.model_id == model_id));
    let selected = selected.or_else(|| models.iter().find(|model| model.is_default == Some(true)));
    selected
        .map(|model| wire_model_label(model))
        .or(requested.map(str::to_string))
}

fn wire_model_label(model: &crate::types::agent_session_stream::AgentModel) -> String {
    model
        .wire_model
        .as_deref()
        .map(str::trim)
        .filter(|wire| !wire.is_empty())
        .unwrap_or(model.model_id.as_str())
        .to_string()
}

/// 从 RedWhisk data_dir 解析模型目录所用的用户 home。
///
/// 与现有启动期 runtime 配置一致：测试把 `.codex` / `.claude` 放在 `data_dir` 的父目录。
pub(super) fn user_home_for_startup_model(data_dir: &Path) -> &Path {
    data_dir.parent().unwrap_or(data_dir)
}
