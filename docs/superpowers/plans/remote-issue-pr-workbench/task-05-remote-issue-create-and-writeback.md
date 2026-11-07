# 任务 5：远程 Issue 创建与写回

## 元数据

| 项目 | 内容 |
| --- | --- |
| 状态 | 已完成 |
| 依赖 | 任务 4 |
| 直接后续 | 任务 8 |
| 最近更新 | 2026-11-07 |
| 总计划 | [README](./README.md) |

## 目标

完成远程 Issue 的创建和显式写回闭环：混合模式可选择来源，远程创建后落本地镜像；完成 Issue 时按设置关闭远端并最多回写一次交付摘要；远端不可用时保留本地副本并提供恢复动作。

## 当前基线

- 项目设置已持久化创建来源、完成时关闭远端、PR 合并后关闭和摘要评论开关。
- 当前 `require_local_issue_create` 在创建来源为 remote 时直接拒绝，reason 为 `remoteCreateUnavailable`。
- GitHub/GitLab Issue 读取由前序任务提供；写入能力尚未实现。
- 现有完成 flow 已支持 `merge_to_base` 和 `open_pull_request`，且能在创建 PR 后记录旧 URL。
- 任务 4 的时间轴契约：只扩展现有 `get_issue_timeline`。条目合并本地动作、本地评论、远程评论和远程系统事件，`source` 为 `local` 或 `remote`，远程评论的 `actionType` 是 `remote_comment`。本任务不拉取宿主评论或系统事件。那次拉取属于下一次 Issue 同步扩展，验收是同步成功写入两表且失败不清空。本任务仍负责远程创建和完成写回。

先核对：

- `src-tauri/src/features/issue/source_gate.rs`
- `src-tauri/src/features/issue/commands.rs`
- `src-tauri/src/features/issue/github_issue_mirror/port.rs`
- `src-tauri/src/features/issue/completion/`
- `src-tauri/src/git/change_request.rs`
- `src/features/settings/issue-source-commands.ts`
- `src/features/issues/issue-editable-page.tsx`
- `src/features/issues/issue-completion/`

## 本任务范围

### 新建来源选择

- 混合模式显示本地 / GitHub / GitLab 来源选择，只显示选项名，不显示解释文案。
- 选项由当前连接 provider 和可用性决定；不可用 provider 不可伪造选择。
- 仅本地模式不显示来源控件，创建完全离线。
- 仅远程模式固定使用当前宿主，不显示可切换来源。
- CLI 未安装、未登录或连接未就绪时禁用远程创建，并给出进入设置的入口。
- 默认继续使用本地并记住上次选择。

### 远程创建与镜像

- 通过当前 provider 的 CLI 创建远程 Issue。
- 远程创建成功后，在单个本地数据库事务内创建 `issues` 行和 `issue_external_refs` 行，并映射远程编号、URL、作者、标签、指派和 open 状态。
- 远程创建失败时不得留下本地半成品。
- 远程成功但本地事务失败时，返回可恢复错误并携带远端 URL；下一次同步必须按外部身份幂等导入该 Issue，不能重复创建。
- 远程创建成功后看板立即出现镜像；若事件刷新失败，返回成功结果并提供重试刷新，不回滚远端对象。
- 正文、标题、标签、指派的后续编辑仍只改本地副本，v1 不写回远程。

### 完成写回

- 完成方式为“合并到 base”且设置开启时，完成后关闭远程 Issue。
- 完成方式为“提交 PR/MR”时不得提前关闭远程 Issue；远端保持 open，Issue 详情显示“PR 待合并”。
- 摘要评论按设置执行；同一个本地完成结果最多写回一次。
- 写回失败不回滚已经成立的本地完成状态；持久化待写回状态、错误和重试入口，后续同步或显式重试不得重复评论。
- 远程已关闭时不重复关闭；远程已关闭后重开必须遵循任务 2 的远端状态规则。
- 所有远程写操作在 CLI 登录态、权限或网络不可用时快速失败，并展示可执行错误。

实现可使用 SQLite outbox/幂等记录保存待写回动作，但语义必须满足“失败可恢复、成功只执行一次、状态可观察”。

### 远端不可用与副本处理

- 404/410 先标记 `unavailable`，不自动删除本地 Issue。
- 详情顶部显示不可用横幅和最后成功同步信息。
- 提供三个明确动作：
  - 保留为本地：删除远程关联，`issues.source` 改为 `local`，保留评论、附件、Session 和完成记录。
  - 移除关联：保留远程来源语义的历史说明，但停止后续同步；不得误删本地副本。
  - 重试：重新探测连接和该 Issue；恢复后继续同步。
- 无权限与“确实删除”在 UI 上合并为不可用；不得仅凭一次 404 判断删除。

## 非目标

- 不实现 PR/MR 列表和详情。
- 不实现 PR 合并后的 Issue 关闭；该部分由任务 8 接入。
- 不实现远程标题、正文、标签、指派的写回或双向同步。
- 不在本任务实现行内评论和回复；只写回系统生成的一次交付摘要。
- 不增加 token/OAuth 配置。

## 原型页面

主原型：[issue-pr-workbench.prototype.html](../../../../src/features/issues/issue-pr-workbench.prototype.html)

| 场景 | 标题 | 本任务必须核对 |
| --- | --- | --- |
| `s4` | 混合模式新建 Issue | 来源选择只显示名称、远程创建后回填本地、表单布局 |
| `s12` | 远端已删除 | 不可用横幅、保留本地、移除关联、重试 |

补充原型：[completion-closeout.prototype.html](../../../../src/features/issues/issue-completion/completion-closeout.prototype.html)

| 场景 | 标题 | 本任务必须核对 |
| --- | --- | --- |
| `s4` | 提交 PR 或合并 | 完成动作选择；选择提交 PR 时远程不立即关闭 |
| `s7` | 已有打开的 PR | 已有 PR 时复用关联语义，不重复创建 |
| `s11` | 完成后的 PR 链接 | 本地完成后远程状态与链接提示 |

截图建议：`task-05-s04-create-source.png`、`task-05-s12-remote-unavailable.png`、`task-05-closeout-s04.png`。

## 契约与测试要求

- 新增远程写命令时同步 Tauri command 注册表、错误码、Rust/TypeScript DTO 和 i18n。
- CLI fixture 覆盖创建成功、认证失败、无权限、网络失败、返回非法 URL/编号。
- 测试远程创建失败不留本地行。
- 测试远程创建后镜像事务和幂等重放。
- 测试完成关闭、摘要评论开关、重复完成、重试、只执行一次。
- 测试 `open_pull_request` 不关闭远程 Issue。
- 测试 unavailable 的保留、解绑、重试，并验证不自动删除。
- 测试旧本地创建行为不变。

## 验收标准

- 混合、仅远程、仅本地三种新建来源行为正确。
- GitHub/GitLab 远程创建成功后可立即在看板打开，且只生成一个本地镜像。
- 远程标题/正文只读，本地编辑不会偷偷写回远程。
- `merge_to_base` 按设置关闭远程并只评论一次。
- `open_pull_request` 不提前关闭远程。
- 写回失败可重试，不重复评论，不推翻本地完成状态。
- 远端不可用时不删除本地数据，三个恢复动作均可执行。
- 指定原型场景逐项对照通过。

## 完成记录

```text
日期：2026-11-07
状态：已实现。提交 hash 留空，由提交代理补。
提交：f12717efe99169fc3bb62701b83eddf9b172be20
实际改动：远程创建落到一条本地镜像；完成写回不新增 phase。合并到 base 且关闭开关开启时关闭远端。创建 PR 后远程保持 open，详情显示待合并。同一完成结果的摘要评论只写一次，失败留下待写回并可重试。404、410 和无权限把外部身份标为 unavailable，不删除 Issue、评论、附件、Session、完成记录。详情横幅动作恰好是保留为本地、移除关联、重试。
验证命令与结果：见本票实现回报。Rust 行为测试覆盖 404、410、无权限横幅、保留为本地、移除关联、重试成功和重试失败。
原型场景对照：提交 PR 不关闭远端；详情为待合并；远端不可用时三个动作都在横幅上，不出现确认删除。
写回幂等策略：入口是 apply_completion_writeback 与 retry_issue_completion_writeback。同一本地完成结果最多一条远程摘要评论。
远端不可用恢复：入口是 apply_issue_recovery。保留为本地把 source 改为 local，外部身份 sync_status=kept_local，不再参与同步。移除关联为 unlinked，后续同步跳过，时间轴保留 remote_origin。重试成功清除横幅并继续同步；失败则横幅和 Issue 行都还在。
与原计划的差异：PR 合并后关闭远程 Issue 不在本任务。
对任务 8 的影响：创建 PR 后远程不关闭；写回幂等入口和待合并状态已经可用。PR 合并后关闭仍留给任务 8。
未完成项及承接任务：PR 合并后关闭远程 Issue 留给任务 8。
```

## 计划校准

- 跨远端和本地数据库不存在真正的分布式事务。以“远端失败无本地半成品；远端成功后本地镜像幂等可恢复”为正确边界，不假装单事务能覆盖外部系统。
- 若远端写回失败，不把本地 Issue 回滚为未完成；记录待写回状态并提供重试。
- 若任务 4 的详情契约缺少关闭/评论所需字段，允许在本任务补最小字段，并同步任务 7/8 的当前基线。
- 任何写回语义变化都必须与产品设计第 10 节保持一致，禁止静默减少幂等或恢复能力。

## 完成时要更新的文档

- 本文件完成记录。
- 总计划状态与变更历史。
- 数据模型、Tauri contract、错误码和 i18n（按实际改动）。
- 任务 8 的当前基线：写明创建 PR 后远程不关闭、写回幂等接口和待合并状态。
