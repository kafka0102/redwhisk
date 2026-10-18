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

/// 把落库的 `startup_model` 还原成重建 provider 进程时要传的模型入参。
///
/// `startup_model` 存的是**发给 LLM 的参数**（Grok 有 `[model.<别名>]` 时是 wire 名），
/// 而启动时传给 provider 的是用户在模型目录里选中的**模型 id / 别名**——Grok 别名自带
/// base_url / api_key，直接拿 wire 名去 `-m` 会换掉路由与凭据。因此按目录反查：
/// wire 标签命中的条目取它的模型 id；无命中（目录已变或非别名 provider）按原值直传。
///
/// 返回 `None` 表示该 Session 没有可恢复的启动模型，调用方保持既有默认行为。
pub(super) fn resume_model_arg(
    agent_type: &AgentType,
    data_dir: &Path,
    command: &str,
    startup_model: Option<&str>,
) -> Option<String> {
    let startup_model = startup_model
        .map(str::trim)
        .filter(|model| !model.is_empty())?;
    let models =
        descriptor_for(agent_type).list_models(user_home_for_startup_model(data_dir), command);
    Some(
        models
            .iter()
            .find(|model| wire_model_label(model) == startup_model)
            .map(|model| model.model_id.clone())
            .unwrap_or_else(|| startup_model.to_string()),
    )
}

/// 从 RedWhisk data_dir 解析模型目录所用的用户 home。
///
/// 与现有启动期 runtime 配置一致：测试把 `.codex` / `.claude` 放在 `data_dir` 的父目录。
pub(super) fn user_home_for_startup_model(data_dir: &Path) -> &Path {
    data_dir.parent().unwrap_or(data_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Grok 别名：落库的是 wire 名，续接要还原回别名（别名带 base_url / api_key）。
    #[test]
    fn resume_model_arg_maps_grok_wire_model_back_to_alias() {
        let temp = tempfile::tempdir().expect("temp dir");
        let grok_dir = temp.path().join(".grok");
        fs::create_dir_all(&grok_dir).expect("grok dir");
        fs::write(
            grok_dir.join("config.toml"),
            "[model.my-model]\nmodel = \"grok-4.7\"\n\n[models]\ndefault = \"my-model\"\n",
        )
        .expect("write grok config");
        let data_dir = temp.path().join("redwhisk-data");

        assert_eq!(
            resume_model_arg(&AgentType::Grok, &data_dir, "grok", Some("grok-4.7")).as_deref(),
            Some("my-model")
        );
    }

    /// 目录里没有独立 wire 条目（wire == id）时保持原值，codex / claude 走这条。
    #[test]
    fn resume_model_arg_keeps_plain_model_id() {
        let temp = tempfile::tempdir().expect("temp dir");
        let data_dir = temp.path().join("redwhisk-data");

        assert_eq!(
            resume_model_arg(&AgentType::Claude, &data_dir, "claude", Some("sonnet")).as_deref(),
            Some("sonnet")
        );
    }

    #[test]
    fn resume_model_arg_is_none_without_startup_model() {
        let temp = tempfile::tempdir().expect("temp dir");
        let data_dir = temp.path().join("redwhisk-data");

        assert_eq!(
            resume_model_arg(&AgentType::Grok, &data_dir, "grok", None),
            None
        );
        assert_eq!(
            resume_model_arg(&AgentType::Grok, &data_dir, "grok", Some("  ")),
            None
        );
    }
}
