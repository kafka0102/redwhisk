# 任务 1：项目来源模式与连接设置

## 元数据

| 项目 | 内容 |
| --- | --- |
| 状态 | 已完成 |
| 依赖 | 无 |
| 直接后续 | 任务 2、任务 3 |
| 最近更新 | 2026-11-06 |
| 总计划 | [README](./README.md) |

## 目标

项目能持久化 Issue 来源模式、同步范围和写回配置，能识别当前仓库的 GitHub/GitLab 连接和 CLI 登录状态，并保证旧项目升级后默认仍为仅本地。

## 当前基线

- 迁移 `0060_project_issue_source_settings.sql` 已增加项目来源、同步、写回和连接字段。
- 来源模式为 `local / remote / mixed`，默认 `local`。
- 同步范围为 `assigned_to_me / all_open / label / all`。
- 自动同步默认开启，默认间隔 90 秒。
- 连接信息由 git remote 与 `gh auth status` / `glab auth status` 探测，不保存 CLI token。
- Project Settings 已增加 Issues 入口和对应三张设置卡。
- 模式切换只改变数据可见性与新建来源，集成测试已覆盖不删除历史数据。

主要实现：

- `src-tauri/migrations/0060_project_issue_source_settings.sql`
- `src-tauri/src/features/project/issue_source.rs`
- `src-tauri/src/db/project_issue_source_repository.rs`
- `src-tauri/src/types/project_issue_source.rs`
- `src/features/settings/settings-issues-panel.tsx`
- `src/features/settings/settings-issues-mode-card.tsx`
- `src/features/settings/settings-issues-connection-card.tsx`
- `src/features/settings/settings-issues-completion-card.tsx`

## 原型对照

| 场景 | 标题 | 本任务核对内容 |
| --- | --- | --- |
| `s5` | 项目设置 · Issues | 来源模式、连接、拉取范围、同步、写回和完成后动作的分区与字段布局 |
| `s6` | 切换来源模式 | 隐藏数量、非破坏性说明、取消/确认动作 |
| `s16` | GitLab 项目设置 | provider、Merge Request 文案、GitLab 连接状态 |

已实现差异：

- `s6` 的切换确认框尚未实现。当前单选立即更新草稿，保存时直接持久化。
- 宿主展示以 git remote 探测结果为准；原型中的宿主下拉只用于表达状态，不应改造成可伪造任意的连接。

## 完成记录

### 2026-11-06 回填

日期：2026-11-04 至 2026-11-05

状态：已完成

提交：

- `ce7b0136 feat: 保存项目 Issue 来源与远程连接`
- `0d7c8e15 fix: 对齐 Issue 来源设置的分区与字段布局`
- `a61866df fix: 按来源模式切换远程连接与完成后设置`

实际改动：

- 增加项目 Issue 来源、同步、写回和连接持久化。
- 增加 GitHub/GitLab remote 识别和 CLI 登录状态探测。
- 增加 Issues 设置页，并把完成后动作从 General 移到 Issues。
- 仅本地模式隐藏远程连接和写回配置。

验证证据：

- repository/command 测试覆盖默认值、保存、读取和模式切换不删除历史。
- 设置页测试覆盖三种模式、连接状态、标签范围、完成后动作迁移。
- 已完成提交中的既有门禁通过记录保留在原提交历史。

原型场景对照：

- `s5` 已实现核心分区与字段。
- `s16` 已实现 GitLab 文案和状态。
- `s6` 仅实现非破坏性持久化语义，确认框尚未实现。

与原计划的差异：

- 模式切换确认框缺失，已转为任务 3 的必做遗留项。
- 连接字段是自动探测只读展示，不是手工可编辑连接。

对后续任务的影响：

- 任务 2 可以直接读取来源模式、连接快照、同步范围和写回开关。
- 任务 3 必须补齐模式切换确认，不需要重做本任务的持久化与设置页骨架。

未完成项及承接任务：

- `s6` 模式切换确认框 → 任务 3。

## 计划校准

保持本任务为已完成。模式切换确认是实现缺口，不要求在任务 1 原地返工；任务 3 接入 GitLab 和跨宿主设置时一并完成，避免重复修改同一设置链路。

## 后续 Agent 注意事项

- 不重复新增来源设置字段，先检查 `0060` 和现有 DTO。
- 修改 `s5`、`s6`、`s16` 时必须同时核对任务 3 的跨宿主要求。
- 任何模式切换都不得执行删除 Issue、评论、附件、Session 或完成记录的操作。
