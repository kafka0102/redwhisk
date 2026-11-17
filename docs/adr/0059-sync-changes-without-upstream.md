# 0059. 无 upstream 的同步更改只数尚未出现在任何远端跟踪分支上的提交

## 状态

采纳（待执行）。

## 背景

变更 Activity 的「同步更改」原先只在项目主 checkout 已有 upstream，且相对该 upstream 有 ahead 或 behind 时出现。`itsm-risk` 的 `feature/change` 没有 upstream，工作区是干净的，但仍有 4 个提交不在任何 `origin/*` 上，空态因此停在「暂无未提交变更」。相对 `origin/master` 同时落后另外 4 个提交，两边已经分叉。

## 决定

1. 有 upstream 时，计数和点击行为不变：仍相对该 upstream 的 ahead/behind。
2. 没有 upstream 时，不计算 behind，也不与 `origin/HEAD` 比较。只数从当前 HEAD 可达、且不在任何远端跟踪分支上的提交。大于 0，且未提交文件为空、当前是项目主 checkout 时，空态显示「同步更改 N↑」。
3. 该按钮的点击沿用安全推送里没有 upstream 的路径：`git push -u origin HEAD`。不先拉取默认远端分支。
4. linked worktree 与游离 HEAD 仍不提供「同步更改」。计数仍只读本地 remote-tracking，不在计数时 fetch。
5. 没有 upstream 的主 checkout，已提交时间轴与这套计数使用同一判定：已包含在任一远端跟踪分支上的提交为紫点，其余为蓝点。不显示远端分支名 Tag。有 upstream 时圆点与 Tag 仍只相对该 upstream。
6. linked worktree 与游离 HEAD 的圆点不改，仍按是否由该 worktree 创建区分蓝与橘黄。

## 后果

- `feature/change` 会显示「同步更改 4↑」。点击后推送并设置 `origin/feature/change`，不会合入 `origin/master` 上多出来的 4 个提交。
- `feature/change` 上那 4 个不在任何 `origin/*` 的提交保持蓝点，更早且已在某个远端跟踪分支上的提交改为紫点，旁边没有远端分支名。
- 下拉里的游离 `HEAD` 不出现「同步更改」，圆点也不改成紫/蓝。
- 本地 remote-tracking 过期时，数量可能暂时偏大，直到既有的后台 fetch 更新。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 继续要求先设置 upstream 才显示数量 | 没有 upstream 的本地分支看不到待推送数量 |
| 相对 `origin/master` 显示 ahead 与 behind | 会把与默认分支的分叉当成需要同步，点击还会先拉取无关提交 |
| 把待推送提交数写进「未提交变更」标题 | 未提交变更只数工作区文件；待推送提交不是未提交文件 |
| 游离 worktree 也改用同一套紫/蓝 | 游离 HEAD 的圆点继续表示是否由该 worktree 创建，不表示是否已在远端 |

## 代码事实来源

- `src-tauri/src/git/branch_sync.rs`：无 upstream 时同步状态为 None
- `src-tauri/src/git/remote/mod.rs`：无 upstream 的推送已是 `git push -u origin HEAD`
- `docs/adr/0031-changes-safe-push-ff-only.md`：安全推送不在分叉时自动 merge
