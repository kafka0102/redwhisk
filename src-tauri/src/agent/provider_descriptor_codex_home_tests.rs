use super::*;
use std::fs;
use std::path::Path;

fn codex_data_dir(temp: &tempfile::TempDir) -> std::path::PathBuf {
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

fn write_codex_profile_config(
    home: &Path,
    profile: &str,
    model: Option<&str>,
    effort: Option<&str>,
) {
    let profile_dir = home.join(".codex").join("profiles").join(profile);
    fs::create_dir_all(&profile_dir).expect("profile dir");
    let mut content = String::new();
    if let Some(model) = model {
        content.push_str(&format!("model = \"{model}\"\n"));
    }
    if let Some(effort) = effort {
        content.push_str(&format!("model_reasoning_effort = \"{effort}\"\n"));
    }
    fs::write(profile_dir.join("config.toml"), content).expect("write profile config");
}

#[test]
fn codex_resolve_runtime_config_reads_from_command_profile() {
    let temp = tempfile::tempdir().expect("temp");
    write_codex_config(temp.path(), Some("grok-4.6"), Some("high"));
    write_codex_profile_config(
        temp.path(),
        "asxs",
        Some("deepseek-v4-flash"),
        Some("xhigh"),
    );
    let data_dir = codex_data_dir(&temp);

    let config = CodexDescriptor.resolve_runtime_config(&data_dir, "codex-asxs", None, None);
    assert_eq!(config.model.as_deref(), Some("deepseek-v4-flash"));
    assert_eq!(config.effort.as_deref(), Some("xhigh"));
    assert_eq!(
        config.config_home.as_deref(),
        Some(temp.path().join(".codex/profiles/asxs").as_path())
    );
}

#[test]
fn codex_list_models_marks_selected_from_command_profile() {
    let temp = tempfile::tempdir().expect("temp");
    write_codex_config(temp.path(), Some("grok-4.6"), None);
    write_codex_profile_config(temp.path(), "asxs", Some("deepseek-v4-flash"), None);

    let models = CodexDescriptor.list_models(temp.path(), "codex-asxs");
    let default = models
        .iter()
        .find(|model| model.is_default == Some(true))
        .expect("有一个默认模型");
    assert_eq!(default.model_id, "deepseek-v4-flash");
}
