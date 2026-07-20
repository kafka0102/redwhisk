//! Issue Worktree 命名：`issue-{number}-{reponame}`（见 ADR-0021）。
//!
//! 纯函数，无 git / 文件系统副作用，便于单测。

use std::path::Path;

use pinyin::ToPinyin;

/// reponame 段最长字符数（仅 ASCII slug，按字节长度等价）。
const REPO_SLUG_MAX_LEN: usize = 20;

/// 由 issue 项目内编号与仓库路径生成 Issue Worktree 主名（分支名与目录主名）。
///
/// - reponame 取 `repo_path` 最后一级目录名，经本地 slug 规范化；
/// - 空 slug 时退回 `issue-{issue_number}`。
pub fn issue_worktree_base_name(issue_number: i64, repo_path: &Path) -> String {
    let slug = repo_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(slugify_repo_basename)
        .filter(|slug| !slug.is_empty());

    match slug {
        Some(slug) => format!("issue-{issue_number}-{slug}"),
        None => format!("issue-{issue_number}"),
    }
}

/// 将仓库 basename 规范为 reponame slug（小写、拼音按字分词、最长 20、优先整词截断）。
pub fn slugify_repo_basename(basename: &str) -> String {
    let words = tokenize_repo_basename(basename);
    truncate_slug_words(&words, REPO_SLUG_MAX_LEN)
}

fn tokenize_repo_basename(basename: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();

    for ch in basename.chars() {
        if ch.is_ascii_alphanumeric() {
            current.push(ch.to_ascii_lowercase());
            continue;
        }

        if !current.is_empty() {
            words.push(std::mem::take(&mut current));
        }

        if let Some(py) = ch.to_pinyin() {
            let plain = py.plain();
            if !plain.is_empty() {
                words.push(plain.to_string());
            }
        }
    }

    if !current.is_empty() {
        words.push(current);
    }

    words
}

fn truncate_slug_words(words: &[String], max_len: usize) -> String {
    if words.is_empty() || max_len == 0 {
        return String::new();
    }

    let first = &words[0];
    if first.len() > max_len {
        return first.chars().take(max_len).collect();
    }

    let mut result = String::new();
    for (index, word) in words.iter().enumerate() {
        let needed = if index == 0 {
            word.len()
        } else {
            word.len() + 1
        };
        if result.len() + needed > max_len {
            break;
        }
        if index > 0 {
            result.push('-');
        }
        result.push_str(word);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn ascii_basename_becomes_issue_number_and_slug() {
        assert_eq!(
            issue_worktree_base_name(137, Path::new("/Users/dev/redwhisk")),
            "issue-137-redwhisk"
        );
    }

    #[test]
    fn chinese_basename_is_pinyin_per_character() {
        assert_eq!(
            issue_worktree_base_name(3, Path::new("/tmp/红须")),
            "issue-3-hong-xu"
        );
        assert_eq!(slugify_repo_basename("我的仓库"), "wo-de-cang-ku");
    }

    #[test]
    fn mixed_ascii_and_chinese_keeps_ascii_words_and_pinyin_tokens() {
        assert_eq!(slugify_repo_basename("My仓库App"), "my-cang-ku-app");
    }

    #[test]
    fn non_alnum_becomes_separator_and_collapses() {
        assert_eq!(slugify_repo_basename("Foo__Bar--Baz"), "foo-bar-baz");
        assert_eq!(slugify_repo_basename("..."), "");
    }

    #[test]
    fn empty_slug_falls_back_to_issue_number_only() {
        assert_eq!(
            issue_worktree_base_name(9, Path::new("/tmp/...")),
            "issue-9"
        );
        assert_eq!(
            issue_worktree_base_name(9, Path::new("/")),
            "issue-9"
        );
    }

    #[test]
    fn reponame_truncates_at_20_preferring_whole_words() {
        // words: very, long, repository, name, here → fit "very-long-repository" (20)
        assert_eq!(
            slugify_repo_basename("very-long-repository-name-here"),
            "very-long-repository"
        );
        // "my-super-long-tooling" = 20 exactly if last word fits; "my-super-long-tool" next?
        // my(2) + super(5) + long(4) + repository(10) with dashes = 2+1+5+1+4+1+10 = 24 > 20
        // my-super-long = 13, next repository needs 11 → stop at my-super-long
        assert_eq!(slugify_repo_basename("my-super-long-repository"), "my-super-long");
    }

    #[test]
    fn single_word_longer_than_20_is_hard_cut() {
        assert_eq!(
            slugify_repo_basename("verylongrepositorynamehere"),
            "verylongrepositoryna"
        );
        assert_eq!(slugify_repo_basename("verylongrepositoryna").len(), 20);
    }

    #[test]
    fn upper_case_ascii_is_lowercased() {
        assert_eq!(slugify_repo_basename("RedWhisk"), "redwhisk");
    }

    #[test]
    fn pathbuf_basename_is_used_not_parent() {
        let path = PathBuf::from("/data/projects/demo-app");
        assert_eq!(issue_worktree_base_name(1, &path), "issue-1-demo-app");
    }
}
