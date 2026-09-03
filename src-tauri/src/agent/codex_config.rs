use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const CODEX_CONFIG_DIR_NAME: &str = ".codex";
const CODEX_CONFIG_FILE_NAME: &str = "config.toml";
const CODEX_BIN_DIR_NAME: &str = "bin";
const CODEX_PROFILES_DIR_NAME: &str = "profiles";
const CODEX_PROFILE_COMMAND: &str = "codex-profile";
const CODEX_COMMAND_PREFIX: &str = "codex-";
const MODEL_KEY: &str = "model";
const REASONING_EFFORT_KEY: &str = "model_reasoning_effort";
const WRAPPER_SCRIPT_READ_LIMIT: usize = 8192;

pub fn read_model_from_home(home_dir: &Path) -> Option<String> {
    read_model_from_codex_home(&default_codex_home(home_dir))
}

pub fn read_reasoning_effort_from_home(home_dir: &Path) -> Option<String> {
    read_reasoning_effort_from_codex_home(&default_codex_home(home_dir))
}

pub fn write_model_to_home(home_dir: &Path, model: &str) -> io::Result<()> {
    write_model_to_codex_home(&default_codex_home(home_dir), model)
}

pub fn write_reasoning_effort_to_home(home_dir: &Path, effort: &str) -> io::Result<()> {
    write_reasoning_effort_to_codex_home(&default_codex_home(home_dir), effort)
}

pub fn read_model_from_codex_home(codex_home: &Path) -> Option<String> {
    let content = fs::read_to_string(codex_home_config_path(codex_home)).ok()?;
    content.lines().find_map(read_model_line)
}

pub fn read_reasoning_effort_from_codex_home(codex_home: &Path) -> Option<String> {
    let content = fs::read_to_string(codex_home_config_path(codex_home)).ok()?;
    content.lines().find_map(read_reasoning_effort_line)
}

pub fn write_model_to_codex_home(codex_home: &Path, model: &str) -> io::Result<()> {
    write_assignment_to_codex_home(codex_home, MODEL_KEY, model)
}

pub fn write_reasoning_effort_to_codex_home(codex_home: &Path, effort: &str) -> io::Result<()> {
    write_assignment_to_codex_home(codex_home, REASONING_EFFORT_KEY, effort)
}

/// 按 agent 命令解析实际 `CODEX_HOME`。
///
/// `codex-asxs` / `codex-profile asxs` 这类 wrapper 会把配置放到
/// `~/.codex/profiles/<name>`，而不是默认的 `~/.codex`。
pub fn resolve_codex_home(user_home: &Path, command: &str) -> PathBuf {
    let default_home = default_codex_home(user_home);
    if let Some(profile) =
        profile_name_from_command(command).or_else(|| profile_name_from_wrapper(user_home, command))
    {
        let profile_home = default_home.join(CODEX_PROFILES_DIR_NAME).join(profile);
        if profile_home.join(CODEX_CONFIG_FILE_NAME).is_file() {
            return profile_home;
        }
    }
    default_home
}

fn default_codex_home(user_home: &Path) -> PathBuf {
    user_home.join(CODEX_CONFIG_DIR_NAME)
}

fn codex_home_config_path(codex_home: &Path) -> PathBuf {
    codex_home.join(CODEX_CONFIG_FILE_NAME)
}

fn write_assignment_to_codex_home(codex_home: &Path, key: &str, value: &str) -> io::Result<()> {
    let config_path = codex_home_config_path(codex_home);
    let existing = fs::read_to_string(&config_path).unwrap_or_default();
    let next = write_assignment_content(&existing, key, value);
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(config_path, next)
}

fn profile_name_from_command(command: &str) -> Option<String> {
    let program = command_program(command)?;
    let basename = command_basename(program);
    if basename == CODEX_PROFILE_COMMAND {
        return command
            .split_whitespace()
            .nth(1)
            .filter(|token| !token.starts_with('-'))
            .map(str::to_string);
    }
    basename
        .strip_prefix(CODEX_COMMAND_PREFIX)
        .filter(|profile| !profile.is_empty() && *profile != "profile")
        .map(str::to_string)
}

fn profile_name_from_wrapper(user_home: &Path, command: &str) -> Option<String> {
    let program = command_program(command)?;
    let wrapper_path = resolve_wrapper_path(user_home, program)?;
    let content = read_wrapper_script(&wrapper_path)?;
    parse_profile_from_wrapper_script(&content)
}

fn command_program(command: &str) -> Option<&str> {
    command
        .split_whitespace()
        .next()
        .filter(|token| !token.is_empty())
}

fn command_basename(program: &str) -> &str {
    let trimmed = program.trim_matches(['"', '\'']);
    Path::new(trimmed)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(trimmed)
}

fn resolve_wrapper_path(user_home: &Path, program: &str) -> Option<PathBuf> {
    let path = Path::new(program);
    if path.is_file() {
        return Some(path.to_path_buf());
    }
    let nested = default_codex_home(user_home)
        .join(CODEX_BIN_DIR_NAME)
        .join(command_basename(program));
    nested.is_file().then_some(nested)
}

fn read_wrapper_script(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    if !bytes.starts_with(b"#!") {
        return None;
    }
    let end = bytes.len().min(WRAPPER_SCRIPT_READ_LIMIT);
    String::from_utf8(bytes[..end].to_vec()).ok()
}

fn parse_profile_from_wrapper_script(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            continue;
        }
        if let Some(profile) = profile_token_after(trimmed, CODEX_PROFILE_COMMAND) {
            return Some(profile);
        }
        if let Some(profile) = profile_from_codex_home_assignment(trimmed) {
            return Some(profile);
        }
    }
    None
}

fn profile_token_after(line: &str, marker: &str) -> Option<String> {
    let mut tokens = line.split_whitespace();
    while let Some(token) = tokens.next() {
        if command_basename(token) == marker {
            let profile = tokens.next()?;
            let profile = profile.trim_matches(['"', '\'']);
            if profile.is_empty() || profile.starts_with('-') {
                return None;
            }
            return Some(profile.to_string());
        }
    }
    None
}

fn profile_from_codex_home_assignment(line: &str) -> Option<String> {
    let assignment = line.split_once("CODEX_HOME=")?.1.trim();
    let value = assignment.trim_matches(['"', '\'', ';']);
    let (_, after_profiles) = value.rsplit_once("profiles/")?;
    let profile = after_profiles
        .split(|c: char| c == '/' || c == '\\' || c.is_whitespace())
        .next()
        .unwrap_or("")
        .trim_matches(['"', '\'']);
    (!profile.is_empty()).then(|| profile.to_string())
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

    #[test]
    fn resolve_codex_home_defaults_to_user_codex_dir() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        assert_eq!(
            resolve_codex_home(temp_dir.path(), "codex"),
            temp_dir.path().join(".codex")
        );
        assert_eq!(
            resolve_codex_home(temp_dir.path(), ""),
            temp_dir.path().join(".codex")
        );
    }

    #[test]
    fn resolve_codex_home_uses_profile_dir_for_named_command() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let profile_home = temp_dir.path().join(".codex/profiles/asxs");
        std::fs::create_dir_all(&profile_home).expect("profile dir");
        std::fs::write(
            profile_home.join("config.toml"),
            "model = \"deepseek-v4-flash\"\n",
        )
        .expect("config");

        assert_eq!(
            resolve_codex_home(temp_dir.path(), "codex-asxs"),
            profile_home
        );
        assert_eq!(
            resolve_codex_home(temp_dir.path(), "codex-profile asxs exec hello"),
            profile_home
        );
        assert_eq!(
            read_model_from_codex_home(&profile_home).as_deref(),
            Some("deepseek-v4-flash")
        );
    }

    #[test]
    fn resolve_codex_home_falls_back_when_profile_config_missing() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        assert_eq!(
            resolve_codex_home(temp_dir.path(), "codex-asxs"),
            temp_dir.path().join(".codex")
        );
    }

    #[test]
    fn resolve_codex_home_reads_profile_from_wrapper_script() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let bin_dir = temp_dir.path().join(".codex/bin");
        let profile_home = temp_dir.path().join(".codex/profiles/asxs");
        std::fs::create_dir_all(&bin_dir).expect("bin dir");
        std::fs::create_dir_all(&profile_home).expect("profile dir");
        std::fs::write(
            profile_home.join("config.toml"),
            "model = \"deepseek-v4-flash\"\n",
        )
        .expect("config");
        std::fs::write(
            bin_dir.join("my-codex"),
            "#!/usr/bin/env bash\nexec \"$ROOT_DIR/bin/codex-profile\" asxs \"$@\"\n",
        )
        .expect("wrapper");

        assert_eq!(
            resolve_codex_home(temp_dir.path(), "my-codex"),
            profile_home
        );
    }

    #[test]
    fn writes_model_to_codex_home_root_config() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let codex_home = temp_dir.path().join("profiles/asxs");
        std::fs::create_dir_all(&codex_home).expect("codex home");
        write_model_to_codex_home(&codex_home, "deepseek-v4-flash").expect("write");
        assert_eq!(
            read_model_from_codex_home(&codex_home).as_deref(),
            Some("deepseek-v4-flash")
        );
        assert!(codex_home.join("config.toml").is_file());
        assert!(!codex_home.join(".codex/config.toml").exists());
    }
}
