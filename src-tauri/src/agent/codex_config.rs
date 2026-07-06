use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const CODEX_CONFIG_DIR_NAME: &str = ".codex";
const CODEX_CONFIG_FILE_NAME: &str = "config.toml";
const MODEL_KEY: &str = "model";
const REASONING_EFFORT_KEY: &str = "model_reasoning_effort";

pub fn read_model_from_home(home_dir: &Path) -> Option<String> {
    let content = fs::read_to_string(codex_config_path(home_dir)).ok()?;
    content.lines().find_map(read_model_line)
}

pub fn read_reasoning_effort_from_home(home_dir: &Path) -> Option<String> {
    let content = fs::read_to_string(codex_config_path(home_dir)).ok()?;
    content.lines().find_map(read_reasoning_effort_line)
}

pub fn write_model_to_home(home_dir: &Path, model: &str) -> io::Result<()> {
    let config_path = codex_config_path(home_dir);
    let existing = fs::read_to_string(&config_path).unwrap_or_default();
    let next = write_assignment_content(&existing, MODEL_KEY, model);

    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(config_path, next)
}

pub fn write_reasoning_effort_to_home(home_dir: &Path, effort: &str) -> io::Result<()> {
    let config_path = codex_config_path(home_dir);
    let existing = fs::read_to_string(&config_path).unwrap_or_default();
    let next = write_assignment_content(&existing, REASONING_EFFORT_KEY, effort);

    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(config_path, next)
}

fn codex_config_path(home_dir: &Path) -> PathBuf {
    home_dir
        .join(CODEX_CONFIG_DIR_NAME)
        .join(CODEX_CONFIG_FILE_NAME)
}

fn read_model_line(line: &str) -> Option<String> {
    read_string_assignment(line, MODEL_KEY)
}

fn read_reasoning_effort_line(line: &str) -> Option<String> {
    read_string_assignment(line, REASONING_EFFORT_KEY)
}

fn read_string_assignment(line: &str, key: &str) -> Option<String> {
    let trimmed = line.trim_start();
    if trimmed.starts_with('#') || !trimmed.starts_with(key) {
        return None;
    }

    let after_key = &trimmed[key.len()..];
    if !after_key.trim_start().starts_with('=') {
        return None;
    }
    let value = after_key.trim_start().trim_start_matches('=').trim_start();
    read_quoted_string(value)
}

fn read_quoted_string(value: &str) -> Option<String> {
    let mut chars = value.chars();
    if chars.next()? != '"' {
        return None;
    }

    let mut result = String::new();
    let mut is_escaped = false;
    for char in chars {
        if is_escaped {
            result.push(char);
            is_escaped = false;
            continue;
        }
        match char {
            '\\' => is_escaped = true,
            '"' => return Some(result),
            _ => result.push(char),
        }
    }
    None
}

fn write_assignment_content(content: &str, key: &str, value: &str) -> String {
    let escaped = escape_toml_string(value);
    let replacement = format!("{key} = \"{escaped}\"");
    let mut did_replace = false;
    let mut lines = Vec::new();

    for line in content.lines() {
        if is_string_assignment(line, key) {
            lines.push(replacement.clone());
            did_replace = true;
        } else {
            lines.push(line.to_string());
        }
    }

    if !did_replace {
        lines.push(replacement);
    }

    let mut next = lines.join("\n");
    if content.ends_with('\n') || !next.is_empty() {
        next.push('\n');
    }
    next
}

fn is_string_assignment(line: &str, key: &str) -> bool {
    let trimmed = line.trim_start();
    if trimmed.starts_with('#') || !trimmed.starts_with(key) {
        return false;
    }
    trimmed[key.len()..].trim_start().starts_with('=')
}

fn escape_toml_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_reasoning_effort_from_codex_config() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let codex_dir = temp_dir.path().join(".codex");
        std::fs::create_dir_all(&codex_dir).expect("codex dir");
        std::fs::write(
            codex_dir.join("config.toml"),
            "model = \"gpt-5.5\"\nmodel_reasoning_effort = \"high\"\n",
        )
        .expect("config");

        let effort = read_reasoning_effort_from_home(temp_dir.path());

        assert_eq!(effort.as_deref(), Some("high"));
    }

    #[test]
    fn reads_model_from_codex_config() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let codex_dir = temp_dir.path().join(".codex");
        std::fs::create_dir_all(&codex_dir).expect("codex dir");
        std::fs::write(
            codex_dir.join("config.toml"),
            "model = \"gpt-5.5\"\nmodel_reasoning_effort = \"high\"\n",
        )
        .expect("config");

        let model = read_model_from_home(temp_dir.path());

        assert_eq!(model.as_deref(), Some("gpt-5.5"));
    }

    #[test]
    fn writes_reasoning_effort_to_existing_codex_config() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let codex_dir = temp_dir.path().join(".codex");
        std::fs::create_dir_all(&codex_dir).expect("codex dir");
        let config_path = codex_dir.join("config.toml");
        std::fs::write(
            &config_path,
            "model = \"gpt-5.5\"\nmodel_reasoning_effort = \"high\"\n",
        )
        .expect("config");

        write_reasoning_effort_to_home(temp_dir.path(), "xhigh").expect("write effort");

        let content = std::fs::read_to_string(config_path).expect("read config");
        assert!(content.contains("model_reasoning_effort = \"xhigh\""));
        assert!(!content.contains("model_reasoning_effort = \"high\""));
    }

    #[test]
    fn writes_model_to_existing_codex_config() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let codex_dir = temp_dir.path().join(".codex");
        std::fs::create_dir_all(&codex_dir).expect("codex dir");
        let config_path = codex_dir.join("config.toml");
        std::fs::write(
            &config_path,
            "model = \"gpt-5\"\nmodel_reasoning_effort = \"high\"\n",
        )
        .expect("config");

        write_model_to_home(temp_dir.path(), "gpt-5.5").expect("write model");

        let content = std::fs::read_to_string(config_path).expect("read config");
        assert!(content.contains("model = \"gpt-5.5\""));
        assert!(!content.contains("model = \"gpt-5\"\n"));
        assert!(content.contains("model_reasoning_effort = \"high\""));
    }
}
