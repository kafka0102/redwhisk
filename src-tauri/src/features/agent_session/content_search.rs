//! 工作区内容搜索：进程内纯 Rust 遍历 + 行匹配（ADR-0019）。
//!
//! 忽略目录与文件树一致（`HIDDEN_DIRS`）；跳过符号链接、二进制与 >1MB 文件。
//! 结果有界：最多 200 个文件 / 每文件 50 条 / 共 2000 条匹配。

use std::fs;
use std::path::{Path, PathBuf};

use regex::{escape, Regex, RegexBuilder};

use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::session_workspace::{
    WorkspaceContentSearchFileGroup, WorkspaceContentSearchInput, WorkspaceContentSearchMatch,
    WorkspaceContentSearchResponse,
};

/// 与 `workspace.rs` 的文本预览上限保持一致。
const MAX_TEXT_FILE_BYTES: u64 = 1_000_000;
/// 与 `workspace.rs` 文件树忽略目录保持一致。
const HIDDEN_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".vite",
];

const MAX_RESULT_FILES: usize = 200;
const MAX_MATCHES_PER_FILE: usize = 50;
const MAX_TOTAL_MATCHES: usize = 2000;

/// 在给定代码根上执行内容搜索（不访问 DB；由调用方先解析 workspace root）。
pub fn search_workspace_content(
    root: &Path,
    input: &WorkspaceContentSearchInput,
) -> Result<WorkspaceContentSearchResponse, CommandError> {
    let query = input.query.trim();
    if query.is_empty() {
        return Ok(WorkspaceContentSearchResponse {
            files: Vec::new(),
            file_count: 0,
            match_count: 0,
            truncated: false,
        });
    }

    let matcher = build_matcher(
        query,
        input.match_case,
        input.match_whole_word,
        input.use_regex,
    )?;
    let mut files: Vec<WorkspaceContentSearchFileGroup> = Vec::new();
    let mut total_matches: usize = 0;
    let mut truncated = false;

    walk_and_search(
        root,
        root,
        &matcher,
        &input.include,
        &input.exclude,
        &mut files,
        &mut total_matches,
        &mut truncated,
    )?;

    files.sort_by(|left, right| left.file_path.cmp(&right.file_path));

    Ok(WorkspaceContentSearchResponse {
        file_count: files.len() as u32,
        match_count: total_matches as u32,
        files,
        truncated,
    })
}

enum Matcher {
    Literal { needle: String, match_case: bool },
    Regex(Regex),
}

fn build_matcher(
    query: &str,
    match_case: bool,
    match_whole_word: bool,
    use_regex: bool,
) -> Result<Matcher, CommandError> {
    if use_regex {
        let pattern = if match_whole_word {
            format!(r"\b(?:{query})\b")
        } else {
            query.to_string()
        };
        let compiled = RegexBuilder::new(&pattern)
            .case_insensitive(!match_case)
            .build()
            .map_err(|error| {
                CommandError::new(
                    CommandErrorCode::AgentSessionValidationFailed,
                    "搜索正则无效。",
                )
                .with_reason("invalidSearchRegex")
                .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
            })?;
        return Ok(Matcher::Regex(compiled));
    }

    if match_whole_word {
        let pattern = format!(r"\b{}\b", escape(query));
        let compiled = RegexBuilder::new(&pattern)
            .case_insensitive(!match_case)
            .build()
            .map_err(|error| {
                CommandError::new(
                    CommandErrorCode::AgentSessionValidationFailed,
                    "搜索正则无效。",
                )
                .with_reason("invalidSearchRegex")
                .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
            })?;
        return Ok(Matcher::Regex(compiled));
    }

    Ok(Matcher::Literal {
        needle: query.to_string(),
        match_case,
    })
}

fn find_first_match(line: &str, matcher: &Matcher) -> Option<(usize, usize)> {
    match matcher {
        Matcher::Literal { needle, match_case } => {
            if *match_case {
                line.find(needle.as_str())
                    .map(|start| (start, start + needle.len()))
            } else {
                let lower_line = line.to_lowercase();
                let lower_needle = needle.to_lowercase();
                lower_line
                    .find(&lower_needle)
                    .map(|start| (start, start + needle.len()))
            }
        }
        Matcher::Regex(regex) => regex.find(line).map(|m| (m.start(), m.end())),
    }
}

#[allow(clippy::too_many_arguments)]
fn walk_and_search(
    root: &Path,
    dir: &Path,
    matcher: &Matcher,
    include: &[String],
    exclude: &[String],
    files: &mut Vec<WorkspaceContentSearchFileGroup>,
    total_matches: &mut usize,
    truncated: &mut bool,
) -> Result<(), CommandError> {
    if *truncated || files.len() >= MAX_RESULT_FILES || *total_matches >= MAX_TOTAL_MATCHES {
        *truncated = true;
        return Ok(());
    }

    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };

    let mut paths: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if file_type.is_dir() && HIDDEN_DIRS.contains(&name.as_str()) {
            continue;
        }
        paths.push(path);
    }
    paths.sort();

    for path in paths {
        if *truncated || files.len() >= MAX_RESULT_FILES || *total_matches >= MAX_TOTAL_MATCHES {
            *truncated = true;
            break;
        }

        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink() {
            continue;
        }

        if metadata.is_dir() {
            walk_and_search(
                root,
                &path,
                matcher,
                include,
                exclude,
                files,
                total_matches,
                truncated,
            )?;
            continue;
        }

        if !metadata.is_file() {
            continue;
        }

        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");

        if !path_passes_filters(&relative_path, include, exclude) {
            continue;
        }

        if metadata.len() > MAX_TEXT_FILE_BYTES {
            continue;
        }

        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        if is_binary_bytes(&bytes) {
            continue;
        }
        let Ok(content) = String::from_utf8(bytes) else {
            continue;
        };

        let mut matches: Vec<WorkspaceContentSearchMatch> = Vec::new();
        let mut file_match_count: u32 = 0;
        for (index, line) in content.lines().enumerate() {
            if *total_matches >= MAX_TOTAL_MATCHES {
                *truncated = true;
                break;
            }
            if matches.len() >= MAX_MATCHES_PER_FILE {
                *truncated = true;
                break;
            }
            if let Some((start, end)) = find_first_match(line, matcher) {
                file_match_count += 1;
                *total_matches += 1;
                matches.push(WorkspaceContentSearchMatch {
                    line_number: (index + 1) as u32,
                    line_text: line.to_string(),
                    match_start: Some(start as u32),
                    match_end: Some(end as u32),
                });
            }
        }

        if !matches.is_empty() {
            if files.len() >= MAX_RESULT_FILES {
                *truncated = true;
                // 回退本文件已计入的 total_matches
                *total_matches -= matches.len();
                break;
            }
            let file_name = Path::new(&relative_path)
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| relative_path.clone());
            files.push(WorkspaceContentSearchFileGroup {
                file_path: relative_path,
                file_name,
                match_count: file_match_count,
                matches,
            });
        }
    }

    Ok(())
}

/// include 空 = 全过；exclude 命中则拒绝；include 非空时须命中至少一条。
/// v1 使用极简 glob：`*` 匹配单段内任意字符，`**` 匹配跨段，其余字面匹配。
fn path_passes_filters(path: &str, include: &[String], exclude: &[String]) -> bool {
    if exclude.iter().any(|pattern| glob_match(pattern, path)) {
        return false;
    }
    if include.is_empty() {
        return true;
    }
    include.iter().any(|pattern| glob_match(pattern, path))
}

fn glob_match(pattern: &str, path: &str) -> bool {
    let pattern = pattern.trim();
    if pattern.is_empty() {
        return false;
    }
    // 将简易 glob 转成正则：先 escape，再还原 ** / * 语义。
    let mut regex_source = String::from("^");
    let chars: Vec<char> = pattern.chars().collect();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '*' {
            if index + 1 < chars.len() && chars[index + 1] == '*' {
                regex_source.push_str(".*");
                index += 2;
                if index < chars.len() && chars[index] == '/' {
                    index += 1;
                }
            } else {
                regex_source.push_str("[^/]*");
                index += 1;
            }
            continue;
        }
        let ch = chars[index];
        if r".+?()[]{}^$|\".contains(ch) {
            regex_source.push('\\');
        }
        regex_source.push(ch);
        index += 1;
    }
    regex_source.push('$');
    Regex::new(&regex_source)
        .map(|regex| regex.is_match(path))
        .unwrap_or(false)
}

fn is_binary_bytes(bytes: &[u8]) -> bool {
    bytes.contains(&0) || std::str::from_utf8(bytes).is_err()
}

#[cfg(test)]
#[path = "content_search_test.rs"]
mod tests;
