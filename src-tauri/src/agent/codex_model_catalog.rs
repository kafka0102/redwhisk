//! Codex 模型目录解析。
//!
//! 承载 Codex 的内置模型回退列表，以及「按当前选中模型标注默认」的候选构造：
//! 会话内模型查询（`codex_app_server::session`）与 provider descriptor 的 Codex
//! 模型解析（`provider_descriptor_command::codex_models_from_command`）都走本模块，
//! 仓库内只保留一份 Codex 候选定义。
//!
//! 决策来源见 ADR-0036（模型列表以本机配置为唯一来源）；术语见 `CONTEXT.md`
//! （模型目录 / 内置模型回退列表）。

use crate::types::agent_session_stream::AgentModel;

/// 内置回退候选共用的 reasoning effort 能力集合。
const COMMON_GPT_REASONING_EFFORTS: [&str; 4] = ["low", "medium", "high", "xhigh"];

/// 内置模型回退列表（`model_id` + 展示名）。
const COMMON_GPT_MODELS: [(&str, &str); 4] = [
    ("gpt-5.5", "GPT-5.5"),
    ("gpt-5", "GPT-5"),
    ("gpt-5-mini", "GPT-5 mini"),
    ("gpt-5-nano", "GPT-5 nano"),
];

/// 构造内置回退候选，不指定当前选中模型（默认标记落在 `gpt-5`）。
pub fn default_codex_models() -> Vec<AgentModel> {
    default_codex_models_with_selected(None)
}

/// 构造内置回退候选，并按本机配置解析出的当前模型标注默认。
///
/// - `selected_model_id` 为空（`None` / 空串）：默认标记落在内置列表的 `gpt-5`。
/// - 命中候选：把默认标记移到该条，其余条目清除默认标记。
/// - 未命中候选：把该模型插入首位并标默认，避免用户自定义模型被列表吞掉。
pub fn default_codex_models_with_selected(selected_model_id: Option<&str>) -> Vec<AgentModel> {
    let selected_model_id = selected_model_id
        .map(str::trim)
        .filter(|model_id| !model_id.is_empty());
    let mut models = COMMON_GPT_MODELS
        .iter()
        .map(|(model_id, display_name)| AgentModel {
            model_id: (*model_id).into(),
            display_name: Some((*display_name).into()),
            is_default: Some(selected_model_id.is_none() && *model_id == "gpt-5"),
            default_reasoning_effort: Some("medium".into()),
            supported_reasoning_efforts: COMMON_GPT_REASONING_EFFORTS
                .into_iter()
                .map(str::to_string)
                .collect(),
        })
        .collect::<Vec<_>>();

    if let Some(selected_model_id) = selected_model_id {
        let mut did_match = false;
        for model in &mut models {
            let is_selected = model.model_id == selected_model_id;
            model.is_default = Some(is_selected);
            did_match |= is_selected;
        }
        if !did_match {
            models.insert(
                0,
                AgentModel {
                    model_id: selected_model_id.to_string(),
                    display_name: Some(selected_model_id.to_string()),
                    is_default: Some(true),
                    default_reasoning_effort: Some("medium".into()),
                    supported_reasoning_efforts: COMMON_GPT_REASONING_EFFORTS
                        .into_iter()
                        .map(str::to_string)
                        .collect(),
                },
            );
        }
    }

    models
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_codex_models_returns_common_gpt_capabilities() {
        assert_eq!(
            default_codex_models(),
            vec![
                AgentModel {
                    model_id: "gpt-5.5".into(),
                    display_name: Some("GPT-5.5".into()),
                    is_default: Some(false),
                    default_reasoning_effort: Some("medium".into()),
                    supported_reasoning_efforts: vec![
                        "low".into(),
                        "medium".into(),
                        "high".into(),
                        "xhigh".into(),
                    ],
                },
                AgentModel {
                    model_id: "gpt-5".into(),
                    display_name: Some("GPT-5".into()),
                    is_default: Some(true),
                    default_reasoning_effort: Some("medium".into()),
                    supported_reasoning_efforts: vec![
                        "low".into(),
                        "medium".into(),
                        "high".into(),
                        "xhigh".into(),
                    ],
                },
                AgentModel {
                    model_id: "gpt-5-mini".into(),
                    display_name: Some("GPT-5 mini".into()),
                    is_default: Some(false),
                    default_reasoning_effort: Some("medium".into()),
                    supported_reasoning_efforts: vec![
                        "low".into(),
                        "medium".into(),
                        "high".into(),
                        "xhigh".into(),
                    ],
                },
                AgentModel {
                    model_id: "gpt-5-nano".into(),
                    display_name: Some("GPT-5 nano".into()),
                    is_default: Some(false),
                    default_reasoning_effort: Some("medium".into()),
                    supported_reasoning_efforts: vec![
                        "low".into(),
                        "medium".into(),
                        "high".into(),
                        "xhigh".into(),
                    ],
                },
            ]
        );
    }

    #[test]
    fn default_codex_models_marks_selected_config_model() {
        let models = default_codex_models_with_selected(Some("gpt-5.5"));

        assert_eq!(
            models
                .iter()
                .filter(|model| model.is_default == Some(true))
                .count(),
            1
        );
        assert_eq!(models[0].model_id, "gpt-5.5");
        assert_eq!(models[0].is_default, Some(true));
    }

    #[test]
    fn default_codex_models_keeps_unknown_configured_model_visible() {
        let models = default_codex_models_with_selected(Some("gpt-custom-preview"));

        assert_eq!(models[0].model_id, "gpt-custom-preview");
        assert_eq!(
            models[0].display_name.as_deref(),
            Some("gpt-custom-preview")
        );
        assert_eq!(models[0].is_default, Some(true));
    }
}
