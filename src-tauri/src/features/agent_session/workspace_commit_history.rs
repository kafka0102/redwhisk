//! 已提交历史读取：分页日志、worktree 自身提交，以及是否已推送。

use std::collections::HashSet;
use std::path::Path;

use crate::git::worktree::is_additional_worktree;
use crate::types::errors::CommandError;
use crate::types::session_workspace::{
    ProjectWorktreeCommitHistoryResponse, WorkspaceCommitChangedFile, WorkspaceCommitRecord,
};

use super::workspace::{hash_string, parse_commit_changed_file, run_git, run_git_owned};

const PRIMARY_BRANCHES: &[&str] = &["main", "master"];
pub(super) const DEFAULT_COMMIT_HISTORY_LIMIT: usize = 50;
const BASE_BRANCH_CANDIDATES: &[&str] = &[
    "origin/devlop",
    "devlop",
    "origin/develop",
    "develop",
    "origin/main",
    "main",
    "origin/master",
    "master",
];

struct CommitLogEntry {
    hash: String,
    short_hash: String,
    author_name: String,
    committed_at_seconds: i64,
    message: String,
    files: Vec<WorkspaceCommitChangedFile>,
}

pub(super) fn read_workspace_commit_history(
    root: &Path,
    base_branch: Option<&str>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<ProjectWorktreeCommitHistoryResponse, CommandError> {
    let limit = match limit {
        Some(value) if value > 0 => value,
        _ => DEFAULT_COMMIT_HISTORY_LIMIT,
    };
    let offset = offset.unwrap_or(0);
    let branch_name = current_branch_name(root)?;
    let is_worktree = is_additional_worktree(root).unwrap_or(false);

    // worktree 与非 worktree 都展示该分支最近 50 条全历史，不再用 base..HEAD 过滤。
    // worktree 场景下，落在分叉基 base..HEAD 范围内的提交属于“当前 worktree 创建”，
    // 通过 is_created_in_worktree 标记给前端做蓝/橘黄区分，其余为从 base 继承的历史。
    // 仅当 worktree 处于非主分支且能解出 base 时才计算该集合；主分支或 base 解析失败
    // 时全部视为 worktree 自身（保持主分支不过滤的现状，避免主分支历史被误判为他处
    // 提交）。base_branch 来自 session 记录的 target_branch（worktree 创建时的真实基
    // 分支），缺失时回退到 find_branch_base 的启发式。非 worktree 不计算该集合，
    // is_created_in_worktree 恒为 false。
    //
    // base_resolution 记录解出的 (merge-base hash, base 分支名)：name 来自 preferred
    // 或 upstream 或启发式候选；仅 worktree 且非主分支且成功解出时回填到响应的
    // base_branch，供前端渲染黄色 base Tag。
    let (worktree_own_commits, base_resolution): (
        Option<HashSet<String>>,
        Option<(String, String)>,
    ) = if is_worktree {
        match branch_name.as_deref() {
            Some(branch) if !PRIMARY_BRANCHES.contains(&branch) => {
                let resolved = find_branch_base(root, branch, base_branch)?;
                let own = resolved.as_ref().and_then(|(base_hash, _)| {
                    rev_list_range(root, &format!("{base_hash}..HEAD")).ok()
                });
                (own, resolved)
            }
            _ => (None, None),
        }
    } else {
        (None, None)
    };
    let base_branch_name = base_resolution.as_ref().map(|(_, name)| name.clone());

    let upstream = current_upstream(root)?;

    // 单次 git log --name-status 按 limit/offset 分页取提交与其变更文件，替代旧实现「每条提交
    // 一次 diff-tree」。--root 让初始提交也按新增展示，与旧 diff-tree --root 行为一致；
    // -M -C 保留重命名/复制检测。
    let log_output = run_git_owned(
        root,
        &[
            "log".to_string(),
            "--date-order".to_string(),
            format!("--max-count={limit}"),
            format!("--skip={offset}"),
            "--root".to_string(),
            "--name-status".to_string(),
            "-M".to_string(),
            "-C".to_string(),
            "--format=%H%x00%h%x00%an%x00%ct%x00%s".to_string(),
        ],
    )?;

    // 有 upstream 时只认该 upstream 可达的提交，远端名就是它。
    // 没有 upstream 的主 checkout（非 worktree、且在某个分支上）改认任一本地远端跟踪
    // 分支可达的提交，但远端名留空。linked worktree 与游离 HEAD 仍全部算未推送。
    // 两条路径都只读本地引用，不 fetch。rev-list 失败则按未推送，不阻断整页读取。
    let pushed_set = pushed_commit_hashes(
        root,
        upstream.as_deref(),
        is_worktree,
        branch_name.as_deref(),
    );

    // 解析：含 NUL 的行是提交头（hash\0shorthash\0author\0ct\0message），其后到下一
    // 个头之间的非空行是该提交的 name-status 变更文件，累加到最近一条提交上。
    let mut entries: Vec<CommitLogEntry> = Vec::new();
    for line in log_output.lines() {
        if line.contains('\0') {
            let mut parts = line.split('\0');
            let hash = parts.next().unwrap_or_default().to_string();
            if hash.is_empty() {
                continue;
            }
            entries.push(CommitLogEntry {
                hash,
                short_hash: parts.next().unwrap_or_default().to_string(),
                author_name: parts.next().unwrap_or_default().to_string(),
                committed_at_seconds: parts.next().unwrap_or_default().parse::<i64>().unwrap_or(0),
                message: parts.next().unwrap_or_default().to_string(),
                files: Vec::new(),
            });
        } else if let Some(entry) = entries.last_mut() {
            if let Some(file) = parse_commit_changed_file(line) {
                entry.files.push(file);
            }
        }
    }

    let mut commits = Vec::new();
    for entry in entries {
        let is_pushed = pushed_set.contains(&entry.hash);
        // 有 own 集合时按成员判定；无集合时 worktree 场景（主分支 / base 解析失败）
        // 视为全部自身（true），非 worktree 恒为 false。
        let is_created_in_worktree = match &worktree_own_commits {
            Some(own) => own.contains(&entry.hash),
            None => is_worktree,
        };
        commits.push(WorkspaceCommitRecord {
            hash: entry.hash,
            short_hash: entry.short_hash,
            message: entry.message,
            author_name: entry.author_name,
            committed_at: entry.committed_at_seconds.saturating_mul(1_000),
            files: entry.files,
            pushed_to: if is_pushed { upstream.clone() } else { None },
            is_pushed,
            is_created_in_worktree,
        });
    }

    let has_more = commits.len() >= limit;
    let signature = hash_string(&format!("{commits:?}"));
    Ok(ProjectWorktreeCommitHistoryResponse {
        commits,
        signature,
        is_worktree,
        base_branch: base_branch_name,
        has_more,
    })
}

fn pushed_commit_hashes(
    root: &Path,
    upstream: Option<&str>,
    is_worktree: bool,
    branch_name: Option<&str>,
) -> HashSet<String> {
    if let Some(upstream_ref) = upstream {
        return rev_list_hashes(root, &["rev-list", upstream_ref]);
    }
    if !is_worktree && branch_name.is_some() {
        return rev_list_hashes(root, &["rev-list", "--remotes"]);
    }
    HashSet::new()
}

fn rev_list_hashes(root: &Path, args: &[&str]) -> HashSet<String> {
    run_git(root, args)
        .ok()
        .map(|output| {
            output
                .lines()
                .map(|line| line.trim().to_string())
                .filter(|line| !line.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn current_branch_name(root: &Path) -> Result<Option<String>, CommandError> {
    let branch = run_git(root, &["branch", "--show-current"])?;
    let branch = branch.trim();
    if branch.is_empty() {
        Ok(None)
    } else {
        Ok(Some(branch.to_string()))
    }
}

// 取当前分支的 upstream 缩写名（如 `origin/dev`）。
//
// 没有 upstream（分支未设置跟踪、游离 HEAD 或仓库无远端）时 git 会以非零退出，
// 这属于合法状态而非错误：返回 None，不向上抛出，避免阻塞整个 commit history 读取。
// `--abbrev-ref` 让结果以 `origin/dev` 而非完整 ref 路径呈现，直接作为远端 tag 文案。
fn current_upstream(root: &Path) -> Result<Option<String>, CommandError> {
    let upstream = match run_git(root, &["rev-parse", "--abbrev-ref", "@{upstream}"]) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    let upstream = upstream.trim();
    if upstream.is_empty() || upstream == "@{upstream}" || upstream.starts_with("HEAD") {
        return Ok(None);
    }
    Ok(Some(upstream.to_string()))
}

// 列出某个 revision 范围（如 `base..HEAD`）内的全部 commit hash，用于标记 worktree
// 自身创建的提交。范围解析失败或无提交时返回空集合，不阻断整体读取。
fn rev_list_range(root: &Path, range: &str) -> Result<HashSet<String>, CommandError> {
    let output = run_git_owned(root, &["rev-list".to_string(), range.to_string()])?;
    Ok(output
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect())
}

// 计算当前 HEAD 相对某个 ref 的 merge-base。
//
// ref 不存在（`rev-parse --verify` 失败）或与 HEAD 没有共同历史（`merge-base` 失败）
// 时返回 None，不阻断调用方：base 解析是尽力而为，任一候选失败都应继续尝试下一个，
// 而不是让整条 commit history 读取失败。
fn merge_base_against(root: &Path, ref_name: &str) -> Result<Option<String>, CommandError> {
    if run_git(
        root,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{ref_name}^{{commit}}"),
        ],
    )
    .is_err()
    {
        return Ok(None);
    }

    let Ok(base) = run_git(root, &["merge-base", "HEAD", ref_name]) else {
        return Ok(None);
    };
    let base = base.trim();
    if base.is_empty() {
        Ok(None)
    } else {
        Ok(Some(base.to_string()))
    }
}

fn find_branch_base(
    root: &Path,
    current_branch: &str,
    preferred_base: Option<&str>,
) -> Result<Option<(String, String)>, CommandError> {
    // 优先使用调用方指定的 base（worktree 创建时记录的 target_branch）。它是该 worktree
    // 分支真正的分叉点，避免落到固定候选列表里更旧的分支——例如仓库里存在落后于 main
    // 的 devlop 时，按候选顺序会先命中 devlop，导致 base 过旧、把 main 上继承下来的
    // 提交全部计入 worktree 自身历史。
    if let Some(preferred) = preferred_base {
        if preferred != current_branch {
            if let Some(base) = merge_base_against(root, preferred)? {
                return Ok(Some((base, preferred.to_string())));
            }
        }
    }

    if let Ok(upstream) = run_git(root, &["rev-parse", "--abbrev-ref", "@{upstream}"]) {
        let upstream = upstream.trim();
        if !upstream.is_empty() {
            if let Some(base) = merge_base_against(root, upstream)? {
                return Ok(Some((base, upstream.to_string())));
            }
        }
    }

    for candidate in BASE_BRANCH_CANDIDATES {
        if *candidate == current_branch {
            continue;
        }
        if let Some(base) = merge_base_against(root, candidate)? {
            return Ok(Some((base, candidate.to_string())));
        }
    }

    Ok(None)
}
