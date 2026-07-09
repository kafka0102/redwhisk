# project-scoped-numbering Specification

## Purpose
TBD - created by archiving change project-scoped-issue-session-number. Update Purpose after archive.
## Requirements
### Requirement: 项目内自增且不可逆的编号

系统 SHALL 为每个 issue 与每个 agent session 维护一个项目内自增的 `number`，在同一 `project_id` 内连续且唯一。`number` SHALL 不可逆递增：条目被软删除后其 `number` 作废、不复用，新创建的条目拿到更大的号。`number` SHALL 在创建条目的事务内按 `COALESCE(MAX(number),0)+1`（计算时不过滤软删除行）分配；当并发导致 `UNIQUE(project_id, number)` 冲突时，系统 SHALL 回滚该事务并重试分配。全局主键 `id` SHALL 保留作内部寻址，跨边界寻址继续使用 `projectId + issueId / sessionId`。

#### Scenario: 新建 issue 在项目内连续递增

- **WHEN** 用户在某 project 内依次创建第 N 个 issue
- **THEN** 系统在该 project 内为新建 issue 分配 `number = N`
- **AND** 该 `number` 在同 project 的所有 issue（含软删除）中唯一

#### Scenario: 软删除后编号不复用

- **WHEN** 某 project 内 `number = 3` 的 issue 被软删除
- **AND** 用户随后在该 project 内新建 issue
- **THEN** 新 issue 的 `number` 大于 3
- **AND** `number = 3` 不被重新分配给任何新 issue

#### Scenario: 跨项目编号相互独立

- **WHEN** project A 与 project B 各自创建第一个 issue
- **THEN** 两个 issue 的 `number` 均为 1
- **AND** 两个 project 的编号序列互不影响

#### Scenario: 并发创建唯一约束冲突重试

- **WHEN** 两个并发请求在同一 project 内同时创建 issue 并算得相同 `number`
- **THEN** 其中一个事务因 `UNIQUE(project_id, number)` 冲突回滚
- **AND** 系统重试分配更大的 `number` 直到成功

### Requirement: issue 编号在 UI 展示

issue 的用户可见编号 SHALL 使用项目内 `number`。看板卡片、Issue summary 标题、Run Issue 弹窗标题、会话列表行的关联 issue 编号 SHALL 显示为基于 `number` 的 `#N` 形式，不再使用全局 `id`。

#### Scenario: 看板卡片展示项目内编号

- **WHEN** 用户查看某 project 的 Issues 看板
- **THEN** 每张 issue 卡片显示的编号为该 issue 的 `number`（形如 `#N`）

#### Scenario: summary 与 run dialog 标题使用编号

- **WHEN** 用户打开某 issue 的 summary 或 run dialog
- **THEN** 标题中的 issue 编号为该 issue 的 `number`

#### Scenario: 会话列表行展示关联 issue 编号

- **WHEN** 用户查看 Agents 会话列表
- **THEN** 会话行展示的关联 issue 编号为该 issue 的 `number`

### Requirement: session 编号用于日志命名

agent session 的 `number` SHALL 用于 session 日志文件命名，使同一 project 内日志文件名按 session 编号连续可读。session 编号 SHALL NOT 在 UI 中以数字形式展示。

#### Scenario: 运行态与归档日志使用 session 编号

- **WHEN** 系统为新 agent session 构造运行态结构化日志或归档日志文件名
- **THEN** 文件名中的 session 标识为该 session 的 `number`
- **AND** 同一 project 内不同 session 的日志文件名不因编号复用而冲突

#### Scenario: session 编号不在 UI 展示

- **WHEN** 用户查看 Agents 会话列表或会话详情
- **THEN** UI 不显示 session 自身的编号数字
- **AND** 会话列表行仅展示关联 issue 的 `number`

### Requirement: 新数据路径使用项目内编号

对新创建的 issue 与 agent session，agent session 日志文件名、worktree 分支名与目录、附件目录 SHALL 使用项目内编号构造。worktree 分支名 SHALL 形如 `issue-{issueNumber}`；completion / merge-back 流程记录的 `workspace_branch` SHALL 与分支名一致使用编号。附件 token `{{issue-attachment:{attachment_id}}}` SHALL 继续以 `attachment_id` 寻址，不嵌入 issue 编号。历史 issue / session 的既有日志文件、worktree 分支、附件目录 SHALL 保持原全局 id 命名，不被迁移。

#### Scenario: 新 issue 的 worktree 与附件使用编号

- **WHEN** 系统为新 issue 创建 worktree 与附件目录
- **THEN** worktree 分支名与目录名为 `issue-{issueNumber}`
- **AND** 附件目录为 `.redwhisk/issues/{issueNumber}/attachments/...`

#### Scenario: 旧数据路径保持不变

- **WHEN** 系统访问在本变更上线前创建的 issue / session 的日志、worktree 分支或附件
- **THEN** 这些资产保留原全局 id 命名
- **AND** Open Log 与诊断入口能正常访问旧命名资产

