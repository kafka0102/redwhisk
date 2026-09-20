use std::path::Path;

use crate::agent::descriptor_for;
use crate::types::agent_profile::AgentType;

/// 认定运行参数模型：启动期模型选择 → 该 Agent 启动时刻的当前模型（模型目录默认项）→ 空。
pub(super) fn resolve_startup_model(
    agent_type: &AgentType,
    home_dir: &Path,
    command: &str,
    requested_model: Option<&str>,
) -> Option<String> {
    if let Some(model) = requested_model
        .map(str::trim)
        .filter(|model| !model.is_empty())
    {
        return Some(model.to_string());
    }
    descriptor_for(agent_type)
        .list_models(home_dir, command)
        .into_iter()
        .find(|model| model.is_default == Some(true))
        .map(|model| model.model_id)
}

/// 从 RedWhisk data_dir 解析模型目录所用的用户 home。
///
/// 与现有启动期 runtime 配置一致：测试把 `.codex` / `.claude` 放在 `data_dir` 的父目录。
pub(super) fn user_home_for_startup_model(data_dir: &Path) -> &Path {
    data_dir.parent().unwrap_or(data_dir)
}
