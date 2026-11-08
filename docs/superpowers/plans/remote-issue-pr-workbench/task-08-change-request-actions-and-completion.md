# 任务 8：PR/MR 操作与完成流程接入

## 元数据

| 项目 | 内容 |
| --- | --- |
| 状态 | 可开始 |
| 依赖 | 任务 5、任务 7 |
| 直接后续 | 无 |
| 最近更新 | 2026-11-08 |
| 总计划 | [README](./README.md) |

## 目标

完成 PR/MR 写操作和 Issue 完成流程集成：支持标记就绪、请求审阅、关闭、合并；创建 PR/MR 成功后建立应用内关联；合并或关闭后正确处理关联 Issue、远程 Issue 和摘要评论。

- 任务 5 已提供远程 Issue 创建、写回幂等入口和待合并状态。创建 PR 后远程不关闭。PR 合并后关闭远程 Issue 仍留给本任务。
- 写回入口是 `apply_completion_writeback` 与 `retry_issue_completion_writeback`。同一本地完成结果最多一条远程摘要评论。详情在关联 PR 仍 open 时显示「PR 待合并」。
- 任务 6 已提供手动关联命令 `link_change_request_issue`。同一项目、同一 change request、同一 Issue 重复调用仍是一条，`link_kind` 为 `manual`。它不修改 Issue 完成状态。
- 任务 7 已提供 PR/MR 详情、检查、评审、关联关系和只读合并框。详情命令是 `get_project_change_request`；`detailStatus` 为 `fresh` / `cached` / `unavailable`。合并方式、删除源分支和合并按钮禁用，不执行合并。
- Issue 与 PR/MR 双向关联已落地：详情列出全部关联 Issue；Issue 侧栏按关联创建时间展示一等变更请求卡片。
- 待审核页已去掉「完成」按钮；状态下拉选「已完成」仍走现有完成流程。
- 现有完成 flow 已支持“合并到 base”和“提交 PR/MR”，并保存旧 `issue_pull_requests.url`。
- 现有 `publish_change_request` 会检测同分支已存在的 PR/MR；本任务必须把复用结果升级为一等实体关联。
- 当前没有应用内 PR/MR 合并能力。

先核对任务 5、7 完成记录，并按实际接口核对：

- `src-tauri/src/git/change_request.rs`
- `src-tauri/src/features/issue/completion/publish.rs`
- `src-tauri/src/features/issue/completion/effect_interpreter.rs`
- `src/features/issues/issue-completion/`
- 任务 6/7 新增的 change request service
- 产品设计第 5.8、9.3、10 节

## 本任务范围

### PR/MR 写操作

- 标记草稿为就绪。
- 请求指定审阅者；输入与错误按宿主能力处理。
- 关闭未合并 PR/MR。
- 合并 PR/MR。
- 所有写操作在提交后重新同步该 PR/MR 和关联 Issue，UI 使用宿主返回结果，不在前端乐观伪造最终状态。
- 写操作失败时本地已有状态保持不变，展示宿主错误。

### 合并门禁

- 只有宿主明确表示可合并时才启用合并按钮。
- `mergeable=null` 或宿主仍在计算时显示“正在计算”，不是“不可合并”。
- 展示全部阻塞原因，不在前端根据少量检查字段自行推断最终可合并性。
- 合并前二次确认。
- 支持 merge commit / squash / rebase，默认跟随项目设置，v1 默认 squash。
- “本次删除源分支”默认勾选，只影响当前合并。
- 禁止默认 auto-merge、`--admin`、强制合并和绕过保护分支。
- 合并成功后更新 PR state、检查、关联 Issue 卡片和远端 Issue 状态。

### 创建或复用 PR/MR

- 完成 flow 选择“提交 PR/MR”后创建请求。
- 创建成功后写入 `change_requests` 并建立与当前 Issue 的 `change_request_issue_links`。
- 同分支已有打开 PR/MR 时复用并建立关联，不重复创建。
- 创建失败保持本地 Issue 完成前的正确状态；不静默降级成本地合并。
- 创建成功后本地 Issue 可以进入 completed，但远程 Issue 保持 open，详情显示“PR/MR 待合并”。

### 合并后联动

- PR/MR 合并后按项目设置关闭关联远程 Issue。
- 摘要评论按设置执行，并复用任务 5 的幂等写回机制。
- 一 PR/MR 多 Issue、一 Issue 多 PR/MR 都必须正确处理；任一关联远程 Issue 的失败可独立重试。
- 合并成功后看板、Issue 详情、PR 列表与 PR 详情同步刷新。

### PR 关闭未合并

- 本地 Issue 可保持 completed，但关联卡片显示“PR/MR 已关闭未合并”。
- 提供显式“重新打开 Issue”动作，不在同步时自动改回进行中。
- 远程 Issue 不因 PR 关闭未合并而自动关闭。

### 错误与恢复

- 覆盖认证过期、限流、无写权限、不可合并、宿主不可用和对象不存在。
- 错误进 i18n，保留宿主可操作信息和脱敏后的原因。
- 写操作失败不排队、不后台静默重试；用户可显式重试。
- 关闭/评论等可恢复副作用复用任务 5 的 SQLite 待写回状态，不重复执行。

## 非目标

- 不新增行内 review、逐行评论、suggestion、通知。
- 不增加 auto-merge 默认开启或管理员绕过。
- 不支持 fork 跨仓合并。
- 不新增独立 PR Activity。
- 不实现多项目、多 forge 连接。

## 原型页面

主原型：[issue-pr-workbench.prototype.html](../../../../src/features/issues/issue-pr-workbench.prototype.html)

| 场景 | 标题 | 本任务必须核对 |
| --- | --- | --- |
| `s10` | 合并弹窗 · 被检查阻塞 | 阻塞原因、合并方式、删除分支、禁用主按钮 |
| `s11` | 创建 PR 时关联 Issue | 关联字段、远程/本地语义、草稿选项 |
| `s14` | PR 合并后 | 合并结果、关联 Issue 已关闭、刷新后的只读状态 |
| `s20` | 待审核 · 远程 Issue | PR 待合并、完成入口和关联状态 |

补充原型：[completion-closeout.prototype.html](../../../../src/features/issues/issue-completion/completion-closeout.prototype.html)

| 场景 | 标题 | 本任务必须核对 |
| --- | --- | --- |
| `s4` | 提交 PR 或合并 | 完成动作选择与默认动作 |
| `s7` | 已有打开的 PR | 复用并关联，不重复创建 |
| `s11` | 完成后的 PR 链接 | 完成后展示链接且不自动合并 |

截图建议：`task-08-s10-merge-blocked.png`、`task-08-s11-create-link.png`、`task-08-s14-merged.png`、`task-08-closeout-s07-existing-pr.png`。

## 契约与测试要求

- 新增写操作 command、错误码、DTO、事件同步 Tauri contract 和 TypeScript 类型。
- 所有新增 `#[tauri::command]` 必须有失败路径测试，函数体包含命令名与 `expect_err`。
- GitHub/GitLab fixture 覆盖标记就绪、请求审阅、关闭、合并、认证失败、限流、无权限和不可合并。
- 测试 mergeable 计算中、阻塞、可通过三种状态。
- 测试检查失败、缺少批准、冲突时合并不可执行且后端也拒绝绕过。
- 测试创建后关联、复用已有 PR/MR、创建失败不改变本地状态。
- 测试合并后按开关关闭多关联 Issue、幂等评论、重复重试。
- 测试 PR 关闭未合并后的显式重新打开。
- 测试列表、Issue 详情和 PR 详情刷新一致性。

## 验收标准

- 标记就绪、请求审阅、关闭、合并都有实际宿主行为和刷新结果。
- 合并门禁与宿主一致；任何阻塞条件下前后端都不能强制合并。
- 创建 PR/MR 成功后立即建立一等实体关联。
- 已有打开 PR/MR 被复用而不是重复创建。
- 完成方式为提交 PR/MR 时远程 Issue 保持 open，显示待合并。
- 合并成功后按设置关闭关联远程 Issue并只评论一次。
- 多 Issue/多 PR 关联都正确刷新。
- PR 关闭未合并时提供显式重新打开，不自动修改本地完成状态。
- 指定原型场景逐项对照通过。

## 完成记录

实现完成后追加。

```text
日期：
状态：
提交：
实际改动：
验证命令与结果：
原型场景对照：
合并门禁来源：
创建/复用及关联结果：
合并/关闭后的 Issue 联动：
与原计划的差异：
未完成项及承接任务：
```

## 计划校准

- 若宿主 CLI 对某一写操作能力不一致，按 provider 明确禁用并提示去宿主处理；不得伪造成功。
- 若任务 5/7 的数据接口需要小范围补齐，可直接扩展并记录，不另建重复模型。
- 若宿主返回可合并但合并接口失败，以后者错误为准，并刷新最新状态。
- 任何安全性、幂等或保护分支能力被缩小时，必须视为产品目标偏差，不能直接标记完成。

## 完成时要更新的文档

- 本文件完成记录。
- 总计划状态、变更历史和最终验收结论。
- Tauri contract、错误码、数据模型、Worktree/Git 生命周期相关文档（按实际改动）。
- 若最终实现与产品设计有差异，更新产品设计或新增 ADR，并记录原因。
