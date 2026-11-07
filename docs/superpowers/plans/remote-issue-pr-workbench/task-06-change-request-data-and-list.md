# 任务 6：PR/MR 一等数据与列表

## 元数据

| 项目 | 内容 |
| --- | --- |
| 状态 | 已完成 |
| 依赖 | 任务 3 |
| 直接后续 | 任务 7 |
| 最近更新 | 2026-11-06 |
| 总计划 | [README](./README.md) |

## 目标

把 PR/MR 从单个 URL 升级为可缓存、可关联、可筛选的一等实体，完成 Pull requests Tab 的列表视图。列表能展示检查、评审、关联 Issue、作者、分支、更新时间和视图筛选。

## 当前基线

- `issue_pull_requests` 只保存 `issue_id -> url`，并限制一个 Issue 一条记录。
- 现有 `view_change_request` 能在完成流程中按 URL 查询少量标题、状态和检查。
- Issues 工作台已有 `Issues | Pull requests` Tab，但 Pull requests 固定显示空态和计数 `0`。
- Issue 自动同步框架已完成，但 PR/MR 同步尚未实现。

先核对：

- `src-tauri/migrations/0057_project_completion_closeout.sql`
- `src-tauri/src/git/change_request.rs`
- `src-tauri/src/features/project/change_request_commands.rs`
- `src-tauri/src/features/issue/completion/publish.rs`
- `src/features/issues/issue-board-header.tsx`
- `src/features/issues/issues-activity.tsx`
- `src-tauri/src/features/issue/github_issue_mirror/`
- 产品设计第 6.3、9.3 节

## 本任务范围

### 数据模型

按产品设计 6.3 建立：

- `change_requests`：PR/MR 列表所需的一等快照。
- `change_request_issue_links`：PR/MR 与 Issue 多对多关联，记录关联类型。
- `change_request_details`：详情文件、检查、评审、评论 JSON 快照；本任务只建契约和必要写入，不实现详情页。

要求：

- `change_requests.state` 统一为 `open / draft / merged / closed`。
- GitHub PR 与 GitLab MR 使用同一模型。
- 唯一键至少保证项目、provider、host、repo、number 幂等。
- `issue_pull_requests` 保留为历史表；可增加 `change_request_id` 可空列。
- 旧 URL 在首次同步或打开时惰性解析升级；解析失败仍可打开原 URL，不得丢数据。
- 一个 PR/MR 可关联多个 Issue，一个 Issue 可关联多个 PR/MR。

### 列表同步

- GitHub 使用 `gh pr list`，GitLab 使用 `glab mr list`，通过统一 port/DTO 返回。
- 同步范围默认包含 open、draft 和最近 30 天 merged/closed。
- 列表按远端更新时间倒序。
- 同一 PR/MR 重复同步幂等更新。
- PR/MR 列表刷新与 Issue 刷新分开，默认 60 秒；只在页面可见、窗口聚焦时运行。
- Issue 与 PR 同步必须错开或共享单项目同步节流，避免同一时刻重复打满宿主。
- 同步失败保留已有列表缓存，并显示可恢复错误。

### 关联 Issue

- 导入 PR/MR 时解析明确关联：GitHub closing keyword、GitLab closing pattern、分支名和可用宿主关系字段。
- 文本解析只用于建立候选关系，不能伪造远端关闭事实。
- 支持手动关联接口，供任务 8 的创建 PR/复用已有 PR 使用。
- 列表的关联 Issue 列支持远程编号与本地编号显示。

### 列表界面

- Pull requests Tab 使用真实数量，不再固定为 `0`。
- Tab 行右侧保留同步状态和刷新图标，不放新建 Issue。
- 筛选为：需要我审阅、我创建的、全部打开、最近合并。
- 默认停在“需要我审阅”；没有匹配项时显示列表内空态。
- 行展示：
  - state 图标和标题。
  - PR/MR 编号、源分支 → 目标分支、作者、更新时间。
  - 检查摘要，文本与颜色同时表达。
  - 评审状态。
  - 关联 Issue。
  - 行尾“打开”外链。
- 整行点击留作任务 7 的详情入口；本任务可以导航到详情占位，但不得提交仅文案的假页面。
- 仅本地模式保留 Pull requests Tab，显示连接空态和“去设置连接”，不隐藏入口。
- 同步未就绪时避免展示错误的零结果；使用 loading/unknown 状态。

## 非目标

- 不在本任务实现 PR/MR 详情四个 Tab。
- 不在本任务实现标记就绪、请求审阅、关闭、合并。
- 不在本任务实现 PR 合并后的 Issue 关闭和评论写回。
- 不做行内 review、通知、auto-merge。
- 不支持一个项目连接多个 forge 或 fork 跨仓写操作。

## 原型页面

主原型：[issue-pr-workbench.prototype.html](../../../../src/features/issues/issue-pr-workbench.prototype.html)

| 场景 | 标题 | 本任务必须核对 |
| --- | --- | --- |
| `s7` | PR 列表 · 待我审阅 | 筛选、表头、行密度、检查/评审两行、关联 Issue、外链位置 |
| `s15` | 仅本地 · PR 空态 | 空态文案、设置入口、保留 Tab |
| `s1` | 混合模式看板 | Issues / Pull requests Tab 与同步栏的位置，不重做看板 |

截图建议：`task-06-s07-pr-list.png`、`task-06-s15-local-pr-empty.png`。列表截图必须包含 Tab、筛选和至少三行数据。

## 契约与测试要求

- 新增 migration、repository、DTO、command 和 event 时同步数据模型、Tauri contract、TypeScript 类型与 DTO parity。
- 新增 `change-request-sync-changed` 事件必须由 `emit_` 前缀函数发送。
- 新增命令必须有失败路径测试，符合仓库 command failure gate。
- CLI fixture 覆盖 GitHub PR 与 GitLab MR 的 open/draft/merged/closed、检查、评审、关联 Issue。
- 测试幂等 upsert、多对多关系、旧 URL 升级、解析失败回退、筛选和同步失败缓存。
- 测试列表真实计数、仅本地空态和同步状态。

## 验收标准

- Pull requests Tab 有真实列表和数量，默认“需要我审阅”。
- 四个筛选行为正确，最近合并会包含已合并记录。
- 检查失败、运行中、全部通过、待评审、已批准、草稿等状态文字与颜色均正确。
- 一个 Issue 多个 PR、一个 PR 多个 Issue 的数据可查询且列表展示正确。
- 旧 `issue_pull_requests` URL 升级不丢失；解析失败仍可打开。
- 同步失败不清空已有列表。
- 仅本地模式显示原型 `s15` 的连接空态。
- 指定原型场景逐项对照通过。

## 完成记录

## 完成记录

```text
日期：2026-11-08
状态：已完成
提交：未提交。本票要求停在提交之前。
实际改动：GitHub / GitLab fixture 经同一同步入口入库；open 与 draft 不受 30 天窗口限制，merged / closed 只保留 updated_at >= 时钟减 30 天。重复同步更新同一行。forge 失败保留已有行，outcome 为 cache_failed。local 跳过且不调用 forge。项目不存在返回 ProjectNotFound。同一项目锁被占用时 outcome 为 coalesced。closing、分支和手动关联写入 change_request_issue_links，不改 Issue 状态。详情 JSON 仍是空数组。前端在面板可见、窗口可见且聚焦、来源为 remote 或 mixed 时每 60 秒同步；失败不把已有列表换成空态。
验证命令与结果：pnpm test 2224 通过。cargo test --lib change_request 28 通过。check-rust-compile、文件大小、用户字符串、命令失败、reason、event emit、前端文件大小通过。dto_parity_export 更新快照后通过，dto-parity.test.ts 2 通过。未跑 pnpm build。
原型场景对照：s7 列表与 s15 仅本地空态由上一票落地。本票没有新的详情页，同步失败时保留上一票的列表行，不另做假详情。
旧 URL 升级结果：沿用上一票。能解析的 GitHub / GitLab URL 填 change_request_id，解析失败保留原文。
与原计划的差异：没有单独的 change request repository。列表和同步 SQL 留在 change_request feature，和上一票的列表查询同一层。Issue 同步与 PR 同步共用进程内锁；文件库按路径加项目编号，内存库按连接区分，避免测试互相挡住。
对任务 7 的数据与接口影响：可复用 list_project_change_requests、sync_project_change_requests、link_change_request_issue 和 change-request-sync-changed。change_request_details 的四个 JSON 仍是空数组，不要另建 PR 模型。
未完成项及承接任务：详情四个 Tab、标记就绪、请求审阅、关闭、合并留给任务 7 和任务 8。普通正文提到不建立链接。
```

## 计划校准

- 若宿主 CLI 无法一次返回某列所需摘要，允许列表显示“未知/去宿主查看”，但不得阻塞列表主闭环。
- 若自动关联不可靠，只建立高置信关系；候选关系留给任务 7 显示或任务 8 手动关联。
- 如果必须简化详情表写入，任务 7 仍应复用已定义的数据契约，不能另建一套 PR 模型。
- 完成本任务后把任务 7 状态解除阻塞，并写明实际可用的列表/关联接口。

## 完成时要更新的文档

- 本文件完成记录。
- 总计划状态和依赖。
- 数据模型与 Tauri contract。
- 任务 7 的当前基线、可复用 command/DTO 和已知能力限制。
- 任务 8 的关联接口基线。
