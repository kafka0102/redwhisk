//! Codex 模型目录解析。
//!
//! 承载 Codex 模型候选的三级本机来源（模型目录文件 → CLI 模型缓存 → 内置模型回退列表）
//! 与「按当前选中模型标注默认」的候选构造：会话内模型查询（`codex_app_server::session`）
//! 与 provider descriptor 的 Codex 模型解析（`provider_descriptor_command::codex_models_from_command`）
//! 都走本模块，仓库内只保留一份 Codex 候选定义。
//!
//! 决策来源见 ADR-0036（模型列表以本机配置为唯一来源）；术语见 `CONTEXT.md`
//! （模型目录 / 内置模型回退列表）。

use std::fs;
use std::path::Path;

use serde_json::Value;

use crate::agent::codex_config;
use crate::types::agent_session_stream::AgentModel;

/// CLI 模型缓存文件名（位于 `CODEX_HOME` 下）。
const CLI_MODEL_CACHE_FILE_NAME: &str = "models_cache.json";
/// 目录条目可见性：只有 `list` 进入候选（`hide` 如自动审查模型被过滤）。
const LISTED_VISIBILITY: &str = "list";
/// 条目缺 `priority` 时的排序权重：排到最后，稳定排序保留文件内相对顺序。
const MISSING_PRIORITY: i64 = i64::MAX;
/// 存量模型与「自定义模型插入项」共用的 effort 能力集合。
const LEGACY_REASONING_EFFORTS: [&str; 4] = ["low", "medium", "high", "xhigh"];

/// 内置模型回退列表：`(model_id, 展示名, 默认 effort, 支持的 effort 集合)`，按优先级排列。
///
/// 内容对齐 codex-cli 0.154.0 内置目录中 `visibility = "list"` 的 6 个模型（ADR-0036 第 4 条）；
/// 隐藏条目（`gpt-5.4` / `gpt-5.4-mini` / daybreak 系列 / `codex-auto-review`）不列入。
const BUILTIN_CODEX_MODELS: [(&str, &str, &str, &[&str]); 6] = [
    (
        "gpt-6-astra",
        "GPT-6-Astra",
        "low",
        &["low", "medium", "high", "xhigh", "max", "ultra"],
    ),
    (
        "gpt-5.6-sol",
        "GPT-5.6-Sol",
        "low",
        &["low", "medium", "high", "xhigh", "max", "ultra"],
    ),
    (
        "gpt-5.6-terra",
        "GPT-5.6-Terra",
        "medium",
        &["low", "medium", "high", "xhigh", "max", "ultra"],
    ),
    (
        "gpt-5.6-luna",
        "GPT-5.6-Luna",
        "medium",
        &["low", "medium", "high", "xhigh", "max"],
    ),
    ("gpt-5.5", "GPT-5.5", "medium", &LEGACY_REASONING_EFFORTS),
    ("gpt-5.2", "GPT-5.2", "medium", &LEGACY_REASONING_EFFORTS),
];

/// 当前模型不在候选中时，插入项的兜底 effort 能力（本机配置不声明自定义模型的能力）。
const INSERTED_MODEL_DEFAULT_EFFORT: &str = "medium";
const INSERTED_MODEL_EFFORTS: [&str; 4] = LEGACY_REASONING_EFFORTS;

/// 解析 Codex 模型候选，并按本机配置解析出的当前模型标注默认。
///
/// 三级本机来源，命中即止（ADR-0036 第 2 条）：
///
/// 1. `config.toml` 的 `model_catalog_json` 指向的模型目录文件；
/// 2. 同 `CODEX_HOME` 下的 CLI 模型缓存；
/// 3. 内置模型回退列表。
///
/// `codex_home` 为 `None`（配置根不可解析）时直接落到第 3 级；
/// `selected_model_id` 为 `None` 时回退读 `config.toml` 的 `model`。
/// 全程 best-effort：文件缺失、JSON 损坏、`models` 键缺失、条目缺字段一律降级到
/// 下一级或空候选，不 panic、不返回错误。
pub fn resolve_models(
    codex_home: Option<&Path>,
    selected_model_id: Option<&str>,
) -> Vec<AgentModel> {
    let selected_model_id = selected_model_id
        .map(str::to_string)
        .or_else(|| codex_home.and_then(codex_config::read_model_from_codex_home));
    let mut models = codex_home
        .and_then(models_from_catalog_file)
        .or_else(|| codex_home.and_then(models_from_cli_cache))
        .unwrap_or_else(builtin_models);
    mark_selected(&mut models, selected_model_id.as_deref());
    models
}

/// 第 1 级来源：配置指向的模型目录文件。
///
/// 未配置该键、路径不存在或指向目录、文件不可读、JSON 损坏时返回 `None`（落到下一级）。
fn models_from_catalog_file(codex_home: &Path) -> Option<Vec<AgentModel>> {
    let catalog_path = codex_config::read_model_catalog_path_from_codex_home(codex_home)?;
    read_models_file(Path::new(catalog_path.trim()))
}

/// 第 2 级来源：`CODEX_HOME` 下的 CLI 模型缓存。
fn models_from_cli_cache(codex_home: &Path) -> Option<Vec<AgentModel>> {
    read_models_file(&codex_home.join(CLI_MODEL_CACHE_FILE_NAME))
}

/// 读取并解析一个模型目录 JSON 文件；不是文件（含路径不存在、指向目录）或不可读时返回 `None`。
fn read_models_file(path: &Path) -> Option<Vec<AgentModel>> {
    if !path.is_file() {
        return None;
    }
    parse_catalog_models(&fs::read_to_string(path).ok()?)
}

/// 解析目录文件与 CLI 缓存共用的 JSON 形状（顶层 `models` 数组）。
///
/// JSON 损坏或缺 `models` 数组时返回 `None`，由调用方落到下一级来源。
fn parse_catalog_models(content: &str) -> Option<Vec<AgentModel>> {
    let catalog: Value = serde_json::from_str(content).ok()?;
    let entries = catalog.get("models")?.as_array()?;
    Some(listed_models(entries))
}

/// 只保留可见性为「列出」的条目，按 `priority` 升序（稳定排序）。
fn listed_models(entries: &[Value]) -> Vec<AgentModel> {
    let mut listed: Vec<(i64, AgentModel)> =
        entries.iter().filter_map(catalog_entry_model).collect();
    listed.sort_by_key(|(priority, _model)| *priority);
    listed.into_iter().map(|(_priority, model)| model).collect()
}

/// 把单个目录条目映射为候选；缺 `slug` 或可见性不是 `list` 时跳过该条。
fn catalog_entry_model(entry: &Value) -> Option<(i64, AgentModel)> {
    let model_id = non_empty_string(entry.get("slug"))?;
    if non_empty_string(entry.get("visibility")).as_deref() != Some(LISTED_VISIBILITY) {
        return None;
    }
    let priority = entry
        .get("priority")
        .and_then(Value::as_i64)
        .unwrap_or(MISSING_PRIORITY);
    Some((
        priority,
        AgentModel {
            model_id,
            display_name: non_empty_string(entry.get("display_name")),
            is_default: None,
            default_reasoning_effort: non_empty_string(entry.get("default_reasoning_level")),
            supported_reasoning_efforts: reasoning_efforts(entry.get("supported_reasoning_levels")),
        },
    ))
}

/// 支持的 effort 集合：取每个条目的 `effort` 字段，缺失或非字符串的条目忽略。
fn reasoning_efforts(value: Option<&Value>) -> Vec<String> {
    let Some(levels) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    levels
        .iter()
        .filter_map(|level| non_empty_string(level.get("effort")))
        .collect()
}

fn non_empty_string(value: Option<&Value>) -> Option<String> {
    let text = value?.as_str()?.trim();
    (!text.is_empty()).then(|| text.to_string())
}

fn builtin_models() -> Vec<AgentModel> {
    BUILTIN_CODEX_MODELS
        .iter()
        .map(
            |(model_id, display_name, default_effort, supported_efforts)| AgentModel {
                model_id: (*model_id).into(),
                display_name: Some((*display_name).into()),
                is_default: None,
                default_reasoning_effort: Some((*default_effort).into()),
                supported_reasoning_efforts: supported_efforts
                    .iter()
                    .map(|effort| (*effort).to_string())
                    .collect(),
            },
        )
        .collect()
}

/// 按当前选中模型标注默认。
///
/// - `selected_model_id` 为空（`None` / 空串）：默认标记落在候选首条；候选为空则不产生条目。
/// - 命中候选：把默认标记移到该条，其余条目清除默认标记。
/// - 未命中候选：把该模型插入首位并标默认，避免用户自定义模型被列表吞掉。
fn mark_selected(models: &mut Vec<AgentModel>, selected_model_id: Option<&str>) {
    let selected_model_id = selected_model_id
        .map(str::trim)
        .filter(|model_id| !model_id.is_empty());

    let Some(selected_model_id) = selected_model_id else {
        for (index, model) in models.iter_mut().enumerate() {
            model.is_default = Some(index == 0);
        }
        return;
    };

    let mut did_match = false;
    for model in models.iter_mut() {
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
                default_reasoning_effort: Some(INSERTED_MODEL_DEFAULT_EFFORT.into()),
                supported_reasoning_efforts: INSERTED_MODEL_EFFORTS
                    .into_iter()
                    .map(str::to_string)
                    .collect(),
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_models_marks_selected_config_model() {
        let models = resolve_models(None, Some("gpt-5.5"));

        assert_eq!(
            models
                .iter()
                .filter(|model| model.is_default == Some(true))
                .count(),
            1
        );
        let selected = models
            .iter()
            .find(|model| model.model_id == "gpt-5.5")
            .expect("候选含配置里的当前模型");
        assert_eq!(selected.is_default, Some(true));
    }

    #[test]
    fn resolve_models_keeps_unknown_configured_model_visible() {
        let models = resolve_models(None, Some("gpt-custom-preview"));

        assert_eq!(models[0].model_id, "gpt-custom-preview");
        assert_eq!(
            models[0].display_name.as_deref(),
            Some("gpt-custom-preview")
        );
        assert_eq!(models[0].is_default, Some(true));
    }
}
