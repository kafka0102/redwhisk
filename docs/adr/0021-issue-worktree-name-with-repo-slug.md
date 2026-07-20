# ADR 0021：Issue Worktree 名采用 issue 编号 + 仓库路径 slug

## 状态

采纳（已执行）。

## 背景

隔离执行 Issue 时，分支与目录原先固定为 `issue-{项目内编号}`。多项目并行或目录并排时，仅靠编号难以辨认归属仓库；用 Issue 标题做 slug 则依赖翻译且会随标题改名漂移。

## 决定

1. 新建 RedWhisk 托管 worktree 时，工作分支名与目录主名为 **`issue-{项目内编号}-{reponame}`**。
2. **`reponame` 取仓库路径最后一级目录名**（非可变的项目展示名）；经本地规范化：小写、中文按字转拼音（无声调）、仅保留 `[a-z0-9]` 并以 `-` 连接。
3. **`reponame` 最长 20 字符**；截断时优先去掉末尾放不下的完整词；若首词本身超过 20，才对该词硬截到 20。slug 为空则退回 `issue-{项目内编号}`。
4. 创建前占用检测认**新主路径**以及该 Issue 既有 worktree session 路径；磁盘上无 session 的旧式 `issue-{编号}` 不自动视为占用，也不做批量迁移。
5. 命名规则作为 git worktree 生命周期深 module 内的纯函数实现，便于单测；session 仍持久化实际 `workspace_branch` / `workspace_path`，后续对账与清理只认记录值。

## 后果

- 并排 worktree 目录可读性提升（例如 `issue-137-redwhisk`）。
- 仓库目录改名后，**新**建 worktree 会用新 slug；已有 session 不受影响。
- 分支过滤器 `issue-` + 数字前缀仍可识别新命名。
- 需同步 lifecycle 文档与创建/占用相关测试期望。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 固定 `issue-{编号}` | 多仓库并排时难以辨认 |
| `issue-{编号}` + Issue 标题译词 | 需翻译策略，标题改动导致命名漂移 |
| 使用 `projects.name` 作 reponame | 展示名用户可改，分支名不可预期 |
| 在线翻译 API | 与桌面离线、确定性单测冲突 |
| 自动迁移旧 `issue-N` 路径 | 风险高、范围大，非本需求 |

## 代码事实来源

- 领域语言：`CONTEXT.md`（Issue Worktree 名、Worktree 所有权）
- 生命周期 module：`src-tauri/src/git/worktree.rs`
- 创建与占用：`src-tauri/src/features/agent_session/launch.rs`
- 相关：`docs/architecture-design/worktree-git-lifecycle.md`、[ADR-0010](./0010-worktree-lifecycle-deep-module.md)
