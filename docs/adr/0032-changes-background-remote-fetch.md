# 0032. 变更 Activity 主 checkout 可见时低频后台 fetch

## 状态

采纳（已执行）。

## 背景

变更 Activity 的条件轮询（[ADR-0008](./0008-changes-promoted-to-activity-with-conditional-polling.md)）每 4s/8s 只读本地 `git status` 与 `HEAD...@{upstream}` / `git log`，**禁止**嵌在该路径上隐式 `git fetch`（见 `branch_sync` 与「同步更改」领域语言）。结果是：远端有人 push 后，若本地从未更新 remote-tracking，ahead/behind 与 UI 可长时间不变，用户会误判为「变更检测失效」。

显式 fetch 入口已有：签出弹窗标题刷新、pull、安全 push。缺少「停留在变更页时后台发现远端」的能力。

## 决定

1. **仅项目主 checkout**、变更 Activity 启用且 **document 可见**、worktree 可恢复时，每 **60s** 调用既有 `fetch_project_remotes`（`git fetch --all --prune`）。
2. **成功后**再调用既有 `refreshChanges` + `refreshCommitHistory`（soft revalidate）；**失败静默**，不 toast、不打断 4s/8s 本地轮询。
3. **挂载 / 切根不立即 fetch**，首拍在 60s 间隔后，避免拖慢进入变更页。
4. **linked worktree 不做后台 fetch**（与后端 `require_project_root_for_remote_ops` 一致）。
5. **不把 fetch 嵌进 4s/8s 本地刷新路径**，避免网络放大与 IPC 压力。

## 后果

- 主 checkout 停留变更页约一分钟内可看到远端 behind / 同步更改状态更新（仍依赖本地 tracking；已提交时间轴仍以本地 HEAD 历史为准，仅 behind 标签与 `is_pushed` 会随 tracking 变化）。
- 增加低频网络与凭证使用；隐藏页面 / 切走 Activity 时停 fetch。
- 4s/8s 路径仍为纯本地，性能特征与 ADR-0008 / performance 规范对本地轮询的约束不变。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 每次 4s/8s 本地 refresh 都 fetch | 网络与阻塞成本过高 |
| 仅文案提示用户手动刷新远程 | 不能解决「等一分钟也不变」的体感 |
| worktree 也后台 fetch | 后端 remote ops 仅主 checkout；跨 worktree 共享 object db 时主根 fetch 已够更新 tracking |

## 代码事实来源

- 实现：`src/features/changes/use-changes-auto-refresh.ts`（`CHANGES_REMOTE_FETCH_INTERVAL_MS`）
- 命令：`fetch_project_remotes` / `fetchProjectRemotes`
- 领域语言：`CONTEXT.md`（变更 Activity、同步更改）
- 相关：`docs/adr/0008-changes-promoted-to-activity-with-conditional-polling.md`、`docs/standards/performance.md`
