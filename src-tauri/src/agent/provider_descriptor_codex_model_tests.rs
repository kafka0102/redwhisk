//! Codex 模型目录候选单测（Seam 1：descriptor 模型解析 + 伪造 home 目录）。
//!
//! 与 `provider_descriptor_codex_home_tests.rs` 分工：那边覆盖 `CODEX_HOME` 定位，
//! 本文件覆盖候选来源（模型目录文件 → CLI 模型缓存 → 内置回退列表）、过滤排序、
//! 当前模型标注与降级（见 ADR-0036 第 2、3、4 条）。

use super::*;
use std::fs;
use std::path::Path;

/// 模型目录文件样例：含隐藏项、乱序 `priority`、缺 `display_name` 的条目。
const CATALOG_JSON: &str = r#"{"models":[
  {"slug":"grok-4.6","display_name":"Grok 4.6","default_reasoning_level":"high","supported_reasoning_levels":[{"effort":"low","description":"Fast responses with lighter reasoning"},{"effort":"high"},{"effort":"max"}],"visibility":"list","priority":3},
  {"slug":"codex-auto-review","display_name":"Codex Auto Review","default_reasoning_level":"medium","supported_reasoning_levels":[{"effort":"low"}],"visibility":"hide","priority":1},
  {"slug":"deepseek-flash","display_name":"DeepSeek-Flash","default_reasoning_level":"high","supported_reasoning_levels":[{"effort":"low"},{"effort":"max"}],"visibility":"list","priority":2},
  {"slug":"qwen3.8-max-aliyun","default_reasoning_level":"high","supported_reasoning_levels":[{"effort":"high"},{"effort":"max"}],"visibility":"list","priority":5}
]}"#;

/// CLI 模型缓存样例：顶层除 `models` 外还有 `fetched_at` / `etag` / `client_version`。
const CACHE_JSON: &str = r#"{"fetched_at":"2026-04-21T09:37:27Z","etag":"W/\"9eae\"","client_version":"0.154.0","models":[
  {"slug":"gpt-5.2","display_name":"GPT-5.2","default_reasoning_level":"medium","supported_reasoning_levels":[{"effort":"low"},{"effort":"medium"},{"effort":"high"},{"effort":"xhigh"}],"visibility":"list","priority":10},
  {"slug":"codex-auto-review","display_name":"Codex Auto Review","visibility":"hide","priority":29},
  {"slug":"gpt-5.4","display_name":"gpt-5.4","default_reasoning_level":"medium","supported_reasoning_levels":[{"effort":"low"},{"effort":"xhigh"}],"visibility":"list","priority":2}
]}"#;

const CATALOG_FILE_NAME: &str = "models.json";
const CACHE_FILE_NAME: &str = "models_cache.json";

fn write_codex_config_raw(home: &Path, content: &str) {
    fs::create_dir_all(home.join(".codex")).expect("codex dir");
    fs::write(home.join(".codex").join("config.toml"), content).expect("write config");
}

fn write_codex_json(home: &Path, file_name: &str, content: &str) {
    fs::create_dir_all(home.join(".codex")).expect("codex dir");
    fs::write(home.join(".codex").join(file_name), content).expect("write json");
}

/// 写 `.codex/config.toml`：当前模型 + `model_catalog_json` 指向 `.codex/models.json`。
fn write_codex_catalog(home: &Path, current_model: Option<&str>, catalog_json: &str) {
    write_codex_json(home, CATALOG_FILE_NAME, catalog_json);
    write_codex_config_raw(
        home,
        &format!(
            "{}model_catalog_json = \"{}\"\n",
            current_model
                .map(|model| format!("model = \"{model}\"\n"))
                .unwrap_or_default(),
            home.join(".codex").join(CATALOG_FILE_NAME).display()
        ),
    );
}

fn model_ids(models: &[AgentModel]) -> Vec<&str> {
    models.iter().map(|model| model.model_id.as_str()).collect()
}

fn default_model_ids(models: &[AgentModel]) -> Vec<&str> {
    models
        .iter()
        .filter(|model| model.is_default == Some(true))
        .map(|model| model.model_id.as_str())
        .collect()
}

fn find_model<'a>(models: &'a [AgentModel], model_id: &str) -> &'a AgentModel {
    models
        .iter()
        .find(|model| model.model_id == model_id)
        .unwrap_or_else(|| panic!("候选应含 {model_id}"))
}

fn efforts_of<'a>(models: &'a [AgentModel], model_id: &str) -> Vec<&'a str> {
    find_model(models, model_id)
        .supported_reasoning_efforts
        .iter()
        .map(String::as_str)
        .collect()
}

fn default_effort_of<'a>(models: &'a [AgentModel], model_id: &str) -> Option<&'a str> {
    find_model(models, model_id)
        .default_reasoning_effort
        .as_deref()
}

// ===== 三级来源 =====

#[test]
fn codex_list_models_prefers_configured_catalog_file_over_builtin() {
    let temp = tempfile::tempdir().expect("temp");
    write_codex_catalog(temp.path(), Some("qwen3.8-max-aliyun"), CATALOG_JSON);

    let models = CodexDescriptor.list_models(temp.path(), "codex");

    // 候选完全来自目录文件：隐藏项被过滤、按 priority 升序、不混入任何内置项。
    assert_eq!(
        model_ids(&models),
        vec!["deepseek-flash", "grok-4.6", "qwen3.8-max-aliyun"]
    );
    assert_eq!(default_model_ids(&models), vec!["qwen3.8-max-aliyun"]);
    assert_eq!(
        find_model(&models, "deepseek-flash")
            .display_name
            .as_deref(),
        Some("DeepSeek-Flash")
    );
    assert_eq!(default_effort_of(&models, "deepseek-flash"), Some("high"));
    assert_eq!(efforts_of(&models, "deepseek-flash"), vec!["low", "max"]);
    assert_eq!(efforts_of(&models, "grok-4.6"), vec!["low", "high", "max"]);
    // 目录条目缺 display_name 时不编造展示名（前端回退 model id）。
    assert_eq!(find_model(&models, "qwen3.8-max-aliyun").display_name, None);
}

#[test]
fn codex_list_models_uses_cli_cache_without_catalog_config() {
    let temp = tempfile::tempdir().expect("temp");
    write_codex_config_raw(temp.path(), "model = \"gpt-5.2\"\n");
    write_codex_json(temp.path(), CACHE_FILE_NAME, CACHE_JSON);

    let models = CodexDescriptor.list_models(temp.path(), "codex");

    assert_eq!(model_ids(&models), vec!["gpt-5.4", "gpt-5.2"]);
    assert_eq!(default_model_ids(&models), vec!["gpt-5.2"]);
    assert_eq!(
        find_model(&models, "gpt-5.4").display_name.as_deref(),
        Some("gpt-5.4")
    );
    assert_eq!(default_effort_of(&models, "gpt-5.4"), Some("medium"));
    assert_eq!(
        efforts_of(&models, "gpt-5.2"),
        vec!["low", "medium", "high", "xhigh"]
    );
}

#[test]
fn codex_list_models_falls_back_to_builtin_without_local_source() {
    let temp = tempfile::tempdir().expect("temp");
    write_codex_config_raw(temp.path(), "");

    let models = CodexDescriptor.list_models(temp.path(), "codex");

    assert_eq!(
        model_ids(&models),
        vec![
            "gpt-6-astra",
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
            "gpt-5.5",
            "gpt-5.2",
        ]
    );
    assert_eq!(default_model_ids(&models), vec!["gpt-6-astra"]);
    // 展示名逐项来自内置列表；非默认项显式标 false（不是留空）。
    assert_eq!(
        find_model(&models, "gpt-6-astra").display_name.as_deref(),
        Some("GPT-6-Astra")
    );
    assert_eq!(
        find_model(&models, "gpt-5.6-luna").display_name.as_deref(),
        Some("GPT-5.6-Luna")
    );
    assert_eq!(
        find_model(&models, "gpt-5.2").display_name.as_deref(),
        Some("GPT-5.2")
    );
    assert!(models.iter().all(|model| model.is_default.is_some()));
    assert_eq!(
        models
            .iter()
            .filter(|model| model.is_default == Some(false))
            .count(),
        5
    );
}

#[test]
fn codex_builtin_fallback_carries_per_model_reasoning_efforts() {
    let temp = tempfile::tempdir().expect("temp");
    write_codex_config_raw(temp.path(), "");

    let models = CodexDescriptor.list_models(temp.path(), "codex");

    let with_ultra = vec!["low", "medium", "high", "xhigh", "max", "ultra"];
    assert_eq!(efforts_of(&models, "gpt-6-astra"), with_ultra);
    assert_eq!(efforts_of(&models, "gpt-5.6-sol"), with_ultra);
    assert_eq!(efforts_of(&models, "gpt-5.6-terra"), with_ultra);
    assert_eq!(
        efforts_of(&models, "gpt-5.6-luna"),
        vec!["low", "medium", "high", "xhigh", "max"]
    );
    let legacy = vec!["low", "medium", "high", "xhigh"];
    assert_eq!(efforts_of(&models, "gpt-5.5"), legacy);
    assert_eq!(efforts_of(&models, "gpt-5.2"), legacy);
    assert_eq!(default_effort_of(&models, "gpt-6-astra"), Some("low"));
    assert_eq!(default_effort_of(&models, "gpt-5.6-terra"), Some("medium"));
    assert_eq!(default_effort_of(&models, "gpt-5.2"), Some("medium"));
}

// ===== 目录文件不可用时落到 CLI 缓存 =====

#[test]
fn codex_list_models_uses_cache_when_catalog_path_missing() {
    let temp = tempfile::tempdir().expect("temp");
    let missing = temp.path().join("nowhere.json");
    write_codex_config_raw(
        temp.path(),
        &format!("model_catalog_json = \"{}\"\n", missing.display()),
    );
    write_codex_json(temp.path(), CACHE_FILE_NAME, CACHE_JSON);

    assert_eq!(
        model_ids(&CodexDescriptor.list_models(temp.path(), "codex")),
        vec!["gpt-5.4", "gpt-5.2"]
    );
}

#[test]
fn codex_list_models_uses_cache_when_catalog_path_is_directory() {
    let temp = tempfile::tempdir().expect("temp");
    fs::create_dir_all(temp.path().join(".codex").join("models.json")).expect("dir as catalog");
    write_codex_config_raw(
        temp.path(),
        &format!(
            "model_catalog_json = \"{}\"\n",
            temp.path().join(".codex").join("models.json").display()
        ),
    );
    write_codex_json(temp.path(), CACHE_FILE_NAME, CACHE_JSON);

    assert_eq!(
        model_ids(&CodexDescriptor.list_models(temp.path(), "codex")),
        vec!["gpt-5.4", "gpt-5.2"]
    );
}

#[test]
fn codex_list_models_uses_cache_when_catalog_json_corrupt() {
    let temp = tempfile::tempdir().expect("temp");
    write_codex_catalog(temp.path(), None, "{\"models\":[{\"slug\":");
    write_codex_json(temp.path(), CACHE_FILE_NAME, CACHE_JSON);

    assert_eq!(
        model_ids(&CodexDescriptor.list_models(temp.path(), "codex")),
        vec!["gpt-5.4", "gpt-5.2"]
    );
}

#[test]
fn codex_list_models_uses_cache_when_catalog_lacks_models_key() {
    let temp = tempfile::tempdir().expect("temp");
    write_codex_catalog(temp.path(), None, r#"{"model_categories":[]}"#);
    write_codex_json(temp.path(), CACHE_FILE_NAME, CACHE_JSON);

    assert_eq!(
        model_ids(&CodexDescriptor.list_models(temp.path(), "codex")),
        vec!["gpt-5.4", "gpt-5.2"]
    );
}

#[test]
fn codex_list_models_uses_builtin_when_cache_also_unusable() {
    let temp = tempfile::tempdir().expect("temp");
    write_codex_catalog(temp.path(), None, "not json at all");
    write_codex_json(temp.path(), CACHE_FILE_NAME, "{\"models\":\"oops\"}");

    let models = CodexDescriptor.list_models(temp.path(), "codex");

    assert_eq!(models.len(), 6);
    assert_eq!(default_model_ids(&models), vec!["gpt-6-astra"]);
}

// ===== 条目级降级 =====

#[test]
fn codex_list_models_skips_unlisted_or_unidentified_entries() {
    let temp = tempfile::tempdir().expect("temp");
    write_codex_catalog(
        temp.path(),
        None,
        r#"{"models":[
  {"slug":"gpt-6-astra","visibility":"list","priority":1},
  {"display_name":"没有 slug","visibility":"list","priority":2},
  {"slug":"daybreak-blue","visibility":"hide","priority":3},
  {"slug":"缺可见性","priority":4},
  {"slug":"  ","visibility":"list","priority":5},
  "不是对象",
  {"slug":"gpt-5.2","visibility":"list","priority":6}
]}"#,
    );

    let models = CodexDescriptor.list_models(temp.path(), "codex");

    assert_eq!(model_ids(&models), vec!["gpt-6-astra", "gpt-5.2"]);
    // 无当前模型时默认标记落在首条。
    assert_eq!(default_model_ids(&models), vec!["gpt-6-astra"]);
}

#[test]
fn codex_list_models_sorts_entries_without_priority_last() {
    let temp = tempfile::tempdir().expect("temp");
    write_codex_catalog(
        temp.path(),
        None,
        r#"{"models":[
  {"slug":"no-priority","visibility":"list"},
  {"slug":"priority-9","visibility":"list","priority":9},
  {"slug":"priority-2","visibility":"list","priority":2},
  {"slug":"priority-null","visibility":"list","priority":null},
  {"slug":"priority-7","visibility":"list","priority":7}
]}"#,
    );

    let models = CodexDescriptor.list_models(temp.path(), "codex");

    assert_eq!(
        model_ids(&models),
        vec![
            "priority-2",
            "priority-7",
            "priority-9",
            "no-priority",
            "priority-null",
        ]
    );
}

#[test]
fn codex_list_models_tolerates_missing_capability_fields() {
    let temp = tempfile::tempdir().expect("temp");
    write_codex_catalog(
        temp.path(),
        None,
        r#"{"models":[{"slug":"bare","visibility":"list","priority":1,"supported_reasoning_levels":"low"}]}"#,
    );

    let models = CodexDescriptor.list_models(temp.path(), "codex");

    assert_eq!(model_ids(&models), vec!["bare"]);
    assert_eq!(find_model(&models, "bare").display_name, None);
    assert_eq!(default_effort_of(&models, "bare"), None);
    assert!(efforts_of(&models, "bare").is_empty());
}

// ===== 当前模型标注 =====

#[test]
fn codex_list_models_inserts_unknown_current_model_first() {
    let temp = tempfile::tempdir().expect("temp");
    write_codex_catalog(temp.path(), Some("my-gateway-model"), CATALOG_JSON);

    let models = CodexDescriptor.list_models(temp.path(), "codex");

    assert_eq!(
        model_ids(&models),
        vec![
            "my-gateway-model",
            "deepseek-flash",
            "grok-4.6",
            "qwen3.8-max-aliyun",
        ]
    );
    assert_eq!(default_model_ids(&models), vec!["my-gateway-model"]);
    assert_eq!(
        find_model(&models, "my-gateway-model")
            .display_name
            .as_deref(),
        Some("my-gateway-model")
    );
    assert_eq!(
        default_effort_of(&models, "my-gateway-model"),
        Some("medium")
    );
    assert_eq!(
        efforts_of(&models, "my-gateway-model"),
        vec!["low", "medium", "high", "xhigh"]
    );
}

#[test]
fn codex_list_models_marks_first_catalog_entry_without_current_model() {
    let temp = tempfile::tempdir().expect("temp");
    write_codex_catalog(temp.path(), None, CATALOG_JSON);

    let models = CodexDescriptor.list_models(temp.path(), "codex");

    assert_eq!(default_model_ids(&models), vec!["deepseek-flash"]);
}

#[test]
fn codex_list_models_keeps_only_current_model_when_catalog_lists_none() {
    let temp = tempfile::tempdir().expect("temp");
    write_codex_catalog(
        temp.path(),
        Some("hidden-only-model"),
        r#"{"models":[{"slug":"codex-auto-review","visibility":"hide","priority":1}]}"#,
    );

    let models = CodexDescriptor.list_models(temp.path(), "codex");

    assert_eq!(model_ids(&models), vec!["hidden-only-model"]);
    assert_eq!(default_model_ids(&models), vec!["hidden-only-model"]);
}

// ===== 多 profile：各自 CODEX_HOME 独立取数 =====

#[test]
fn codex_list_models_reads_catalog_of_resolved_profile_home() {
    let temp = tempfile::tempdir().expect("temp");
    write_codex_catalog(temp.path(), Some("qwen3.8-max-aliyun"), CATALOG_JSON);
    let profile_home = temp.path().join(".codex").join("profiles").join("asxs");
    fs::create_dir_all(&profile_home).expect("profile dir");
    fs::write(profile_home.join(CACHE_FILE_NAME), CACHE_JSON).expect("write profile cache");
    fs::write(profile_home.join("config.toml"), "model = \"gpt-5.4\"\n")
        .expect("write profile config");

    let profile_models = CodexDescriptor.list_models(temp.path(), "codex-asxs");
    let root_models = CodexDescriptor.list_models(temp.path(), "codex");

    assert_eq!(model_ids(&profile_models), vec!["gpt-5.4", "gpt-5.2"]);
    assert_eq!(default_model_ids(&profile_models), vec!["gpt-5.4"]);
    assert_eq!(
        model_ids(&root_models),
        vec!["deepseek-flash", "grok-4.6", "qwen3.8-max-aliyun"]
    );
}
