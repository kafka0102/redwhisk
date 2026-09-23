//! 回归：首个 git 子进程不得同步等待「交互式 shell PATH」解析。
//!
//! git 子进程会注入 login+interactive shell 解析出的 PATH（让 git hook 能找到 pnpm 等）。
//! 该解析要拉起 `.zshrc`（nvm / compinit），实测 4–5 秒、上限 15 秒。历史上首个 git 调用
//! 出现在 `open_project` 热路径（`list_code_workspaces` → `git worktree list`），于是
//! 「启动后点击项目 → 工作台出现」被拖到十秒级；之后切换项目因缓存已命中只要百毫秒。
//!
//! 本测试必须独占一个测试二进制：进程内首次 git 调用就是「未缓存」状态。

use std::process::Command;
use std::time::{Duration, Instant};

use redwhisk_lib::git::worktree::list_code_workspaces;

#[test]
fn first_git_command_does_not_wait_for_interactive_shell_path_probe() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo = temp_dir.path();
    let status = Command::new("git")
        .args(["init", "-b", "main"])
        .current_dir(repo)
        .status()
        .expect("git init");
    assert!(status.success(), "git init 失败");

    let started = Instant::now();
    let roots = list_code_workspaces(repo).expect("list code workspaces");
    let elapsed = started.elapsed();

    assert_eq!(roots.len(), 1, "应只返回项目根工作区");
    assert!(
        elapsed < Duration::from_secs(1),
        "首个 git 调用不得等待交互式 shell PATH 探测（历史为 4–15 秒），实际 {elapsed:?}"
    );
}
