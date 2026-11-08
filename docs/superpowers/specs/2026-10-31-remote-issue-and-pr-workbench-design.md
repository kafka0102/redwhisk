# 远程 Issue 与 PR/MR 工作台改版方案

> 状态：已评审通过；任务 1、2 已完成，后续按实施计划执行
> 日期：2026-10-31
> 调研原文：[2026-10-31-remote-issue-and-pr-sync-research.md](../../survey/2026-10-31-remote-issue-and-pr-sync-research.md)
> 相关：[任务完成后的合入与 PR/MR 调研](../../survey/task-completion-pr-mr.md)、[Issue 完成后的合入与 PR/MR](./2026-10-25-task-completion-pr-mr-design.md)、[Worktree 与 Git 生命周期](../../architecture-design/worktree-git-lifecycle.md)、[Settings 页面布局](../../architecture-design/settings-page-layout.md)、[数据模型与 Migration](../../domain/data-model.md)
> 静态原型：[issue-pr-workbench.prototype.html](../../../src/features/issues/issue-pr-workbench.prototype.html)
> 分步执行：[远程 Issue 与 PR/MR 工作台 8 任务实施计划](../plans/remote-issue-pr-workbench/README.md)

本文是产品与技术方案。任务拆分与当前执行状态以链接的实施计划为准；行为与视觉验收同时依据本文和静态原型。

## 1. 一句话结论

把远程 Issue 当成**本地镜像**，不把它做成双向同步的另一份事实源：

- 项目设置选择「仅本地 / 仅远程 / 混合」，模式只决定看板显示哪一类 Issue、新建默认去哪，切换不删除数据。
- 远程 Issue 的正文与评论按 Markdown 镜像进来；RedWhisk 自己的 `backlog / running / review / completed` 工作流状态与远端 `open / closed` **分成两条轴**，互不覆盖。
- 远程内容 v1 只读；写回只做三个显式动作：关闭 Issue、回写交付摘要、创建 PR/MR。不做标题/正文的双向字段合并。
- PR/MR 从「一个 URL 字段」升级为**一等缓存实体**：列表、详情、检查、评审、关联 Issue、合并门禁都在应用内；合并仍以宿主规则为准，不绕过保护分支。
- Issue 与 PR 共用同一个工作台入口（`Issues | Pull requests` 两个 Tab），不新增第七个左侧 Activity。

## 2. 现状与差距

| 能力 | 现在 | 缺口 |
| --- | --- | --- |
| Issue 创建 | 只能手动录入，存 SQLite | 无法从 GitHub / GitLab 拉取；无来源标识 |
| Issue 身份 | 项目内 `number` 自增，`#12` | 远程编号可能冲突；无 provider / repo / external id |
| Issue 状态 | `backlog` / `running` / `review` / `completed` | 远端 `open` / `closed` 没有建模；关闭/重开没有规则 |
| Issue 时间轴 | 本地 `issue_actions` + `issue_comments` | 远程评论与系统事件没有入口 |
| 项目设置 | General 里只有仓库、worktree、完成后动作 | 没有来源模式、连接、拉取范围、写回 |
| PR/MR 创建 | 完成时或变更页「更多」调用 `gh/glab` 创建 | 创建后只存 URL |
| PR/MR 处理 | 仅 `gh pr view` / `glab mr view` 只读标题、状态、检查 | 无列表、无详情、无评审、无合并门禁 |
| PR 与 Issue 关联 | `issue_pull_requests` 一 Issue 一 URL | 无法一 PR 关联多个 Issue；无法从 PR 反查 |
| 同步 | 无 | 无轮询、无增量、无限流退避、无删除检测 |

已经落地的部分不要重做：完成后动作（`merge_to_base` / `open_pull_request`）、项目级 `completion_action` / `pr_target` / `pr_draft`、`gh/glab` 创建路径、完成 flow 的 phase 与 effect 结构。

## 3. 调研结论

详细证据、官方链接与「未找到」项见调研原文。这里只保留对 RedWhisk 有决策价值的部分。

### 3.1 平台事实

| 事实 | 对 RedWhisk 的含义 |
| --- | --- |
| GitHub Issues 列表会把 PR 当成 Issue 返回，必须用 `pull_request` 字段过滤；Issue 的 `id` 与 PR 的 `id` 不是同一标识。 | 拉 Issue 时必须过滤 PR；不能把列表里的 `id` 当成 PR number。 |
| GitHub Issue 列表与 Issue 评论支持 `since`；PR 列表没有 `since`，只能按 `updated` 排序后本地截断。 | Issue 可增量；PR 列表要维护本地水位并周期全量对账。 |
| GitHub 官方不建议用 `sort=updated` 做跨页游标，对象更新会让翻页漂移。 | 增量 + 稳定排序；分页只跟 `Link` header。 |
| GitHub REST 认证后主限流约 5,000 请求/小时/用户，另有并发与单端点次级限流。 | 单项目串行、可见才轮询、失败退避，不能按「每个 Issue 一个请求」暴走。 |
| GitLab.com 当前已认证 API 约 2,000 次/分钟/用户，未认证 500 次/分钟/IP；触发限流返回 429，应遵循 `Retry-After`。 | GitLab 也要串行与退避；不能把 GitHub 的额度直接套过来。 |
| GitLab Issue 原生支持 `updated_after`；项目级 Issue 从 18.3 起支持 keyset，且必须显式 `pagination=keyset&order_by=id&sort=asc`。 | 优先 keyset；老实例回退 offset + `updated_after`。 |
| GitLab `merge_status` 已弃用，用 `detailed_merge_status`；MR 合并可用 `sha` 防未审提交。 | 合并门禁读 `detailed_merge_status`，合并时带 head SHA。 |
| GitLab 的 notes 同时包含用户评论与系统 note，用 `system=true` 区分；discussion 还有 resolved 状态。 | 评论与系统事件分开展示；v1 不写 diff discussion。 |
| 桌面端没有稳定公网入口，GitHub/GitLab webhook 都需要平台 POST 到可接收 URL。 | 桌面端只做 polling；webhook 仅作为可选自建 relay。 |
| GitHub 桌面端 OAuth 的官方路径是 device flow（不需要 client secret）；GitLab OAuth 支持 authorization code + PKCE。 | P3 原生客户端采用 device flow / PKCE，token 进系统 Keychain。 |
| GitHub 有通用 ETag / `If-None-Match` 与 304 不计主限流的官方语义；GitLab 官方 REST 文档未记录通用 ETag，不能假定一致。 | GitHub 做条件请求；GitLab 按 host/版本探测，探测不到就退化为 `updated_after` 增量。 |
| 404 可能表示「不存在」也可能表示「无权访问」；增量列表不会返回删除。 | 不能把「本次没拉到」当删除；需要周期全量对账与 `unavailable` 状态。 |
| PR/MR 的 `mergeable` 可能是 `null`（GitHub 正在计算），最终能否合并以合并接口返回为准。 | UI 只展示宿主状态；`null` 不能显示成「不可合并」；失败展示宿主错误。 |

### 3.2 三种产品原型

| 原型 | 代表 | Issue 的角色 | PR/MR 的角色 | RedWhisk 应借什么 |
| --- | --- | --- | --- | --- |
| Tracker-first | Linear | Issue 是事实源，PR 是关联工件 | 关联、自动改状态、回链 | 来源徽标、PR 关联 Issue、状态自动化 |
| Agent-first | GitHub Copilot coding agent、Codex Cloud、Cursor Cloud、Devin | Issue/任务触发 Agent | PR 是交付物，评审与合并留在宿主 | 从 Issue 启动、PR 作为完成结果、跟进评论 |
| Git-client | GitKraken、VS Code GitHub Pull Requests、JetBrains | Issue 不是核心 | 应用内 PR 收件箱、审阅、合并 | PR 列表、检查、评审、合并门禁 |

> 竞品的具体字段与同步范围以调研原文 C 节为准；未从一手来源确认的产品行为不写进实现依据。

#### 具体产品对照

以下只列调研原文 C 节能从官方文档确认的事实；未找到的项不写成产品能力。

| 产品 | 远程 Issue / 任务入口 | PR/MR 处理 | 同步与关联模型 | 对 RedWhisk 的启示 |
| --- | --- | --- | --- | --- |
| Linear（GitHub 集成） | 可镜像 GitHub Issue | PR 作为 Issue 附件驱动状态自动化，一个 Issue 可挂多个 PR | 可双向同步 title / description / status / assignee / labels / sub-issues / comments / priority；评论只同步 synced thread | Tracker-first 的完整形态；RedWhisk 不是 tracker，不需要复制全部双向字段 |
| Linear（GitLab 集成） | **不导入 GitLab Issue** | 仅 MR，通过标题/描述 magic word 关联并回写 linkback | 官方 FAQ 明确不支持 GitLab Issue 同步 | GitLab Issue 同步在同类产品里并不普遍；RedWhisk 同时支持 GitHub/GitLab Issue 是差异化，但成本更高 |
| GitHub Copilot coding agent | 把 Issue 分配给 Copilot | 启动时创建 draft PR | 分配时读取 Issue 标题、正文和当时评论；之后的 Issue 评论不进入会话，后续上下文写到 PR | Agent-first：Issue 是快照式触发器，PR 是后续协作面 |
| OpenAI Codex Cloud | 云端任务（prompt / 环境 / 分支） | 一个 task 可有多条 external PR，每条绑定 assistant turn | 未找到从 GitHub/GitLab Issue 创建 Codex 任务的官方说明 | 一个任务可产出多个 PR；RedWhisk 的关联表应允许一 Issue 多 PR |
| Cursor Cloud Agent | Slack、Linear、GitHub Issue/PR 评论、API、Web/IDE 均可启动 | 产出 merge-ready PR；多仓任务可分别开 PR | Agent run 为中心，PR 是交付物 | PR 评论可以成为 Agent 的后续输入；RedWhisk v1 先做单仓 |
| Devin | Linear / Jira 工单可分配或 @mention 启动 | 回写 PR/session 链接 | GitHub 入口只在开放 PR 评论；官方明确 `/devin` 在 Issue 评论被忽略 | “从 Issue 评论触发”不是通用模型；RedWhisk 用显式 UI 启动更可控 |
| OpenHands Issue→PR | 支持 GitHub / GitLab / Jira / Linear Issue | 自动回写进度与 PR | 默认 15 分钟轮询、持久去重、回写进度与 PR | 最接近 RedWhisk 的远程 Issue 自动化；低频轮询 + 可靠去重是可行基线 |
| Vibe Kanban | 本地 Issue → workspace → PR | 一个 Issue 可多个 workspace | 未找到远程 Issue 同步证据 | 本地工作流 + 多 workspace 的直接同类；RedWhisk 的远程同步是差异点 |
| GitKraken Launchpad | 以 PR/MR 为中心 | 应用内打开、合并、关闭，支持 GitHub/GitLab | 以宿主仓库/远端为准 | 应用内合并可行，但要以宿主规则为准 |
| VS Code GitHub Pull Requests | 扩展内浏览 PR | 检出、审阅、评论、合并 | 扩展绑定 GitHub | PR 列表 + 详情 + 检查是桌面工作台的最小闭环 |
| JetBrains | 从 IDE 创建 PR/MR | 创建、合并、关闭 | 同时覆盖 GitHub 与 GitLab | 同一套 UI 可同时覆盖两类宿主 |
| GitHub Desktop | 从当前分支预览并创建 PR | 创建后打开 github.com 完成标题与提交 | 官方未找到 Desktop 内合并文档 | 「创建」和「审阅」可以分离；不必第一版就做完整 review |
| Claude Code Desktop | 本地任务 | 用 `gh` 开 PR、监控 CI，通过后可自动 merge | 以本地任务为中心 | 「完成后自动开 PR」是成熟路径；自动 merge 要谨慎 |
| GitHub CLI / `glab` | 脚本化 | 创建、查看、检查、评论、批准、合并 | 以宿主 API 为准 | 可作为 v1 的适配层，但字段兼容性要进 capability 探测 |

#### 关键洞察

1. **Linear 能双向同步，是因为它本身就是 tracker。** RedWhisk 的目标是镜像用户已有的 GitHub/GitLab tracker，而不是取代它；因此 v1 只读 + 显式写回是合理的产品边界，不是能力妥协。
2. **GitLab Issue 同步在同类产品里并不普遍。** Linear 的 GitLab 集成只覆盖 MR。RedWhisk 若同时支持 GitHub/GitLab Issue，会形成差异化，但必须把 GitLab 的 keyset 版本、`updated_after`、notes/system note 等差异纳入 capability 探测。
3. **Agent-first 产品在触发时快照 Issue。** Copilot 只读取分配当时的标题、正文和评论；Devin 不在 Issue 评论里响应。RedWhisk 运行远程 Issue 时也应快照 prompt，不承诺实时吸收后续评论；后续上下文走 Session 或 PR。
4. **一个任务可以产出多个 PR。** Codex 的 task 持有多条 external PR；Cursor 的多仓任务可分别开 PR。RedWhisk 的 `change_request_issue_links` 必须是多对多，不能沿用 `issue_pull_requests` 的一对一。
5. **OpenHands 给出了远程 Issue 自动化的可行基线。** 15 分钟轮询、持久去重、回写进度与 PR；RedWhisk 可以在页面可见时更激进（90 秒），后台回到低频，并用唯一键保证幂等。
6. **Vibe Kanban 是本地 Issue 工作流的直接同类。** 它没有远程同步证据；RedWhisk 的远程镜像 + PR 收件箱是差异点，但不要为了远程能力牺牲本地 Issue 的轻量体验。
7. **应用内合并可行，但完整 review 仍在宿主。** GitKraken、VS Code、JetBrains 都做应用内合并；行内 review、SSO、保护分支治理仍以宿主为准。

RedWhisk 不是纯 tracker，也不是纯云端 Agent，更不是完整 Git 客户端。它需要三者的交集：

1. **Tracker-first 的来源与关联**：远程 Issue 进来后，仍能按来源筛选、看到作者/标签/里程碑、回链宿主。
2. **Agent-first 的执行链**：远程 Issue 与本地 Issue 一样能启动 Agent、进 worktree、走完成 flow。
3. **Git-client 的 PR 收件箱**：至少能看待审 PR、看检查、看评审、在规则允许时合并；不追求替代 GitHub 的行内 review。

### 3.3 关键取舍

| 取舍 | 行业常见做法 | RedWhisk 的选择 |
| --- | --- | --- |
| 远程 Issue 是否可编辑 | Linear 这类 tracker 做双向；工作台多为只读镜像 | v1 只读，编辑跳宿主；避免双向冲突 |
| 关闭时机 | PR 合并后关闭，或 `Closes #n` 由宿主关闭 | 创建 PR 时不立即关闭；默认 PR 合并后关闭 |
| 状态映射 | 用 label / 自定义状态映射 | 本地工作流状态独立；只做「完成 → 关闭」与「远端关闭 → 完成」两条规则 |
| PR 审阅深度 | Git 客户端做完整 review；Agent 产品只做链接 | v1 做列表/详情/检查/评审/合并；行内 review 后续 |
| 认证 | OAuth / App / PAT / CLI | v1 复用 `gh/glab` 登录态；P3 原生 HTTP + OAuth/PAT |
| 同步触发 | Webhook（服务端） | 桌面端只能轮询；条件请求 + 退避 |

### 3.4 直接结论

1. **不要把「本地 Issue」和「远程 Issue」做成两张表、两套看板。** `issues` 仍是唯一工作项表，远程身份放 `issue_external_refs`。
2. **RedWhisk 不需要做双向字段同步。** 只读镜像 + 显式写回是更稳的切口；Linear 的双向同步建立在其 tracker 身份上，不构成 RedWhisk 的必要条件。
3. **PR 必须是一等实体。** 只存 URL 无法做列表、检查、评审、合并门禁，也无法在 Issue 详情里表达「PR 待合并」。
4. **Issue 与 PR 放在同一个 surface。** 二者是同一交付链的两端；独立 Activity 会让「从 Issue 到 PR」多一次心智跳转。
5. **合并能力要克制。** 前提是宿主已经说「可合并」；不默认 auto-merge，不提供 admin 绕过。

## 4. 产品模型

### 4.1 两条状态轴

远程 Issue 进入 RedWhisk 后，必须同时表达两类事实：

| 轴 | 取值 | 事实源 | 谁能改 |
| --- | --- | --- | --- |
| 本地工作流状态 | `backlog` / `running` / `review` / `completed` | RedWhisk SQLite | 用户、完成 flow、Agent 启动 |
| 远端状态 | `open` / `closed`（GitHub 另有 `state_reason`） | GitHub / GitLab | 宿主用户、RedWhisk 的显式写回 |

两者不是一一映射。看板甬道按本地工作流状态排；卡片和详情用独立徽标显示远端状态。这样既保留 RedWhisk 的「待办 → 运行 → 待审核 → 完成」，又不会把远端 `closed` 误当成 Agent 已完成。

### 4.2 来源模式

项目级 `issue_source_mode`：

| 模式 | 看板显示 | 新建默认 | 同步 | 切换后的数据 |
| --- | --- | --- | --- | --- |
| `local` 仅本地 | 只显示 `source=local` | 本地 | 关闭 | 远程 Issue 隐藏但保留 |
| `remote` 仅远程 | 只显示 `source=remote` | 远程（需写权限） | 开启 | 本地 Issue 隐藏但保留 |
| `mixed` 混合 | 两者都显示 | 让用户选，记住上次选择 | 开启 | 全部显示 |

规则：

- 模式是**显示与创建策略**，不是数据分区。任何切换都不删除 `issues`、评论、附件、会话或完成记录。
- 切换前弹确认，只陈述事实：将隐藏多少本地/远程 Issue，是否开始/停止访问宿主。
- 远程模式下如果连接未就绪（CLI 未安装、未登录、token 过期），看板仍显示缓存，但 Issue 甬道的加号不显示；不回退成本地新建。
- 混合模式下新建表单顶部有来源分段控件；只显示选项名，不写解释文案；默认本地，项目记住上次选择。
- 看板来源筛选只出现在混合模式的 Issues Tab，位于 Tab 行右侧；选项为全部 / 仅本地 / GitHub 或 GitLab。仅远程与仅本地模式不展示。
- 仅本地模式下，PR Tab 显示空态与「连接 GitHub/GitLab 后可处理 PR」的入口，不隐藏 Tab，避免功能不可发现。

### 4.3 编号与身份

现有 `issues.number` 是项目内自增编号，已经用于 worktree 命名、附件目录、日志路径。远程 Issue 的 `#123` 不能替代它：

- 混合模式下本地 `#12` 与远程 `#12` 可能同时存在。
- 远程仓库可能重命名、迁移；编号只在 repo 内稳定。
- worktree 名、附件路径、归档路径已经依赖 `number`，不应为远程 Issue 改写。

因此：

- `issues.number` 继续作为**本地内部编号**，不参与远程身份判断。
- 远程身份由 `(provider, host, repo, external_number)` + `external_id` 组成；`external_id` 用于跨重命名稳定识别。
- 界面显示远程编号时带来源：`GH #128`、`GL #7`；本地显示 `#12`。详情页可看到 `acme/redwhisk #128`。
- worktree 名仍使用本地编号（例如 `issue-42-redwhisk`）；这是内部命名，不要求在 UI 暴露。

### 4.4 拉取范围

首次同步不能把大仓库全部 Issue 拉进来。项目级 `issue_sync_scope`：

| 取值 | GitHub | GitLab | 适用 |
| --- | --- | --- | --- |
| `assigned_to_me`（默认） | `assignee=@me` | `scope=assigned_to_me` | 个人工作台 |
| `all_open` | `state=open` | `state=opened` | 小团队、小仓库 |
| `label` | `labels=<name>` | `labels=<name>` | 按业务线/版本 |
| `all` | 含 closed | 含 closed | 归档、审计；首次同步慢 |

补充规则：

- 默认只拉 open；已导入的 Issue 即使后来关闭也继续更新，不因范围过滤而消失。
- `all` 只用于手动「全量同步」，自动轮询仍只拉最近更新的页。
- 单次同步上限：首次 500 条、增量 200 条；超出时提示「还有更多，继续同步」。
- 关闭的 Issue 默认进入 `completed`，但 `completion_source=remote_import`，不伪造 Agent 会话。
- GitHub 列表要过滤 `pull_request` 字段；GitLab 项目级 keyset 仅 18.3+，旧实例回退 offset。

### 4.5 写回

v1 只做三个显式写回：

| 动作 | 默认 | 说明 |
| --- | --- | --- |
| 完成后关闭远程 Issue | 开 | 仅当本地完成方式是「合并到 base」；创建 PR 时不立即关闭 |
| PR 合并后关闭关联 Issue | 开 | 轮询发现 PR merged 且 Issue 仍 open 时关闭 |
| 完成后回写交付摘要评论 | 开 | 复用现有 `issue_comments` 的交付摘要，不重写一份 |

不做：

- 标题/正文/标签/指派/里程碑的双向同步。
- 本地评论自动发到远程（v1 只回写完成摘要）。
- 远程状态变化自动改本地 `running` / `review`（见 4.6）。

### 4.6 状态迁移规则

同步只改「允许它改」的本地字段：

| 远端事件 | 本地状态 | 行为 |
| --- | --- | --- |
| 首次导入 open | 无 | 建 `issues` + ref，`status=backlog` |
| 首次导入 closed（范围含 closed） | 无 | 建 `issues` + ref，`status=completed`，`completion_source=remote_import` |
| 远端关闭 | `backlog` / `review` | 进入 `completed`，写 `issue_actions`（actor=remote） |
| 远端关闭 | `running` | **不改状态**，显示「远端已关闭」警告；不终止 Agent |
| 远端关闭 | `completed` | 只更新 ref，不重复写完成动作 |
| 远端重开 | `completed` 且无关联 Session | 回到 `backlog` |
| 远端重开 | `completed` 且有关联 Session | 保持 `completed`，显示「远端已重开」，提供显式「重新打开」 |
| 远端重开 | `backlog` / `running` / `review` | 只更新 ref |
| 本地完成（merge_to_base） | `completed` | 若写回开启，关闭远程 Issue + 可选评论 |
| 本地完成（open_pull_request） | `completed` | 不关闭远程；记录 PR 链接；PR 合并后再关闭 |
| 远端删除 / 无权访问 | 任意 | 不改本地状态；标记 ref `unavailable`；显示横幅与三个动作：保留为本地 / 移除关联 / 重试 |

原则：**同步不覆盖本地工作流状态；只有明确的关闭/重开规则和显式用户动作能改。**

### 4.7 冲突与删除

- 远程正文只读 → 不存在标题/正文冲突。
- 本地状态、会话、附件、完成记录永远以本地为准。
- 远程标签按名称映射到本地 `project_labels` 仅用于显示；不因为同步删除本地标签。
- 远程删除：保留本地副本；「保留为本地」把 `source` 改为 `local` 并删除 ref；「移除关联」只删除 ref，副本仍为本地；「删除本地副本」是独立的破坏性动作。
- 远程仓库重命名：`external_id` 不变，更新 `repo`、`url`；不重建 Issue。
- 404 不等于删除：可能是权限被撤销；先标记 `unavailable`，用一次显式 `GET` 或全量对账确认，不自动删。

## 5. 信息架构

### 5.1 一个工作台入口，两个 Tab

保留左侧 `Issues` Activity 图标，在 surface header 放 `Issues | Pull requests` 分段 Tab：

```text
[Issues 24] [Pull requests 8]      [全部 ▾] [已同步 2 分钟前] [刷新图标]
```

应用页面顶部不再显示 `项目名 / 仓库 · 分支` 这一行；项目与分支信息只在实际需要操作的区域出现。

顶部 Tab 右侧放来源筛选（仅混合 Issues）、同步状态与刷新图标；不放新建 Issue。刷新只显示图标；新建入口用 Issue 甬道的加号。

理由：

- PR 是 Issue 的交付物，二者共用「来源、同步、关联 Issue」语境。
- 不新增第七个 Activity，避免导航密度继续上升。
- 从 Issue 详情可以直接切到关联 PR，从 PR 详情可以回到 Issue。
- 未来如果 PR 使用频率足够高，再拆成独立 Activity；数据模型不受影响。

### 5.2 看板

- 四个甬道不变：待办 / 进行中 / 待审核 / 已完成。
- Tab 行右侧来源筛选（仅混合模式 Issues）：全部 / 仅本地 / GitHub 或 GitLab，三者互斥。仅远程与仅本地模式不展示来源筛选。
- 混合模式下卡片正常状态使用 Info 浅蓝背景，同步出错使用 Error 背景。
- 卡片 meta 行：`GH #128` / `GL #7` / `#12` + 更新时间 + 来源徽标。
- 卡片底部：远程标签、关联 PR 徽标（检查失败用红色，已合并用紫色/勾）。
- 仅本地模式下，远程 Issue 不出现；不展示来源筛选、同步状态与刷新图标。
- 仅远程模式下，本地 Issue 不出现；不展示来源筛选。
- 顶部 Tab 右侧显示来源筛选（仅混合 Issues）、同步时间 / 错误信息与刷新图标；刷新只显示图标，不显示「立即同步」文字；不放新建 Issue。

### 5.3 Issue 详情：分状态与来源

Issue 详情不能只做一套通用页面。待办没有 `linked_session`，没有运行参数、Token、日志路径，也没有「打开会话」；本地与远程的可编辑边界也不同。

#### 进入方式

| 状态 | 本地 Issue | 远程 Issue |
| --- | --- | --- |
| 待办 `backlog` | 点击卡片直接进入编辑表单 | 进入只读详情；正文只读，去宿主编辑 |
| 进行中 `running` | 只读详情 + 会话面板 | 只读详情 + 会话面板 + 宿主入口 |
| 待审核 `review` | 只读详情 + 会话面板 + 完成入口 | 只读详情 + 会话面板 + 关联 PR + 完成入口 |
| 已完成 `completed` | 只读详情 + 会话摘要 + 回看入口 | 只读详情 + 会话摘要 + 关联 PR + 宿主入口 |

待办本地直接编辑的理由：此时没有关联 Session，编辑标题/正文/标签是主任务；运行是下一步动作。待办远程不能直接编辑，因为远程正文 v1 只读；只读详情仍要提供「运行」和「打开宿主」。

#### 顶部动作矩阵

| 状态 | 本地 | 远程 |
| --- | --- | --- |
| 待办 | 返回、运行、保存、删除 | 返回、状态下拉、运行、更多 |
| 进行中 | 返回、状态下拉、更多 | 返回、状态下拉、更多 |
| 待审核 | 返回、状态下拉、完成、更多 | 返回、状态下拉、完成、更多 |
| 已完成 | 返回、状态下拉、查看回看、更多 | 返回、状态下拉、查看回看、更多 |

规则：

- 标题下不放状态标签。状态下拉显示当前状态，选项为待办 / 进行中 / 待审核 / 已完成；当前项打勾。已完成不能进入待审核；不能续接时不能进入进行中。
- 向前切换直接生效。回退先确认；执行中标记完成先确认。退回待办且已有会话时，再问是否删除残留 worktree，确认后回到看板。
- 从已完成选「进行中」不直接改状态，而是打开运行确认。
- 本地待办没有状态菜单，因为「保存」和「运行」已经覆盖此阶段；`删除` 只在待办提供。
- 远程待办顶部不放编辑，主操作是打开宿主。更多里的「编辑 Issue」只改本地副本。
- 进行中不再显示「运行」。标题行不放「打开会话」；有会话时，「查看会话」在会话信息卡片右侧。卡片上不放会话状态标签。
- 远程 Issue 的「打开 GitHub / GitLab」放在右侧 GitHub / GitLab 卡片标题行，不放在页面标题行。
- 待审核的主动作是「完成」；有关联 PR 时在右侧显示 PR 状态。
- 已完成不再显示「运行」；主动作是「查看回看」，重新打开走状态菜单。
- 本地 Issue 不显示「打开宿主」。远程正文 v1 仍以宿主为准，应用内编辑不写回远端。
- 更多菜单包含「编辑 Issue」和「删除」。编辑进入表单，返回回到只读详情；删除需确认。删除本地待办仍在顶部。远程 Issue 的删除只删本地副本，不删远端对象。

#### 详情页框架

- Issue 详情不显示 `Issues | Pull requests` Tab，也不显示同步状态和刷新。这两项只留在看板和 PR 列表。
- 不显示来源条（来源徽标 + 编号 + 标签）。编号在标题里；标签在主区（编辑时在表单，只读时在正文上方）。

#### 右侧栏

只渲染有内容的卡片。没有会话就不显示「会话信息」和「运行参数」，也不用「尚未运行」或「—」占位。不再使用「本地字段」：编号已在标题，标签已在主区。

| 状态 | 本地 | 远程 |
| --- | --- | --- |
| 待办 | 无右侧栏。主区是编辑表单 | 一张宿主卡片：仓库、远端状态、作者、指派 |
| 进行中 | 会话信息、运行参数 | 宿主卡片 + 会话信息 + 运行参数 |
| 待审核 | 会话信息、运行参数；有关联 PR 时加 PR 卡片 | 同上，并加关联 PR |
| 已完成 | 同待审核 | 同待审核 |

宿主卡片标题用 `GitHub` / `GitLab`，不重复编号。会话信息与现有只读面板一致：开始时间、结束时间（已结束才有）、执行时长、会话状态、Token（总计 / 输入 / 输出 / 缓存 / 命中率）、运行时日志或归档日志。运行参数：智能体、模型、工作流技能、开发模式、分支目录。

#### 编辑页标签与附件

编辑 Issue 沿用现有编辑体验，不另做字段块：

- 标题是编辑页顶部的单行输入框。
- 正文是现有富文本编辑器。工具栏提供正文级别、加粗、引用、代码块、无序 / 有序列表、图片、附件和清除格式；附件入口是工具栏里的回形针，不单独放「添加附件」按钮。
- 标签选择器位于编辑器下方：左侧是标签图标，右侧是已选中的彩色标签 chip。点图标打开下拉，选项为颜色圆点 + 标签名 + 勾选态，底部是「编辑标签」。
- 附件卡片位于编辑器正文下方：文件类型徽标 + 文件名 + View / Down / Del。添加、预览、下载、删除都在这里完成，不再额外渲染「附件」标题和横向大按钮。

#### 与现有实现的衔接

- 当前 `isEditablePageOpen` 只判断 `dialogMode === "create" || status === "backlog"`；增加远程 Issue 后必须追加 `source === "local"`，否则远程待办会错误进入本地编辑表单。
- `IssueReadOnlyPage` 需要接收 `source` 与 `remoteState`，按上表生成顶部动作；当前固定显示状态菜单 + 更多菜单，不足以表达待办/进行中/待审核/已完成差异。
- `IssueReadonlySessionPanel` 只在已有 Session 时渲染。待办没有 Session，不显示会话和运行参数。
- `IssueStatusMenu` 继续负责已完成 Issue 的重新打开；`查看回看` 与「更多」是独立入口。
- 远端 unavailable 在详情顶部显示红色横幅 + 保留为本地 / 移除关联 / 重试。宿主卡片的远端状态显示「不可用」。

### 5.4 新建 Issue

- 混合模式：来源分段控件（本地 / GitHub / GitLab），只显示选项名，默认记住上次选择。
- 仅本地：不显示来源控件。
- 仅远程：来源固定为对应宿主；CLI/token 未就绪时禁用创建。
- 远程创建：先调用宿主创建，成功后在同一事务里落本地镜像；失败不留本地半成品。
- 标签：远程模式下列出宿主标签；本地模式下列出本地标签。

### 5.5 项目设置

新增 Project Settings → `Issues` 菜单项，复用现有两栏骨架与 80% 内容容器：

1. **来源模式**：三张单选卡，只显示模式名。
2. **远程连接**：宿主、仓库、账号、登录状态、重新检测/重新登录；CLI 未就绪时给出可执行提示。
3. **拉取范围与同步**：范围、自动同步、间隔、刷新、最后同步时间。
4. **写回**：三个开关 + 一句「创建 PR 不立即关闭」的说明。
5. **完成后**：把现有 `completion_action` / `pr_target` / `pr_draft` / `confirm_completion_action` 从 General 移到这里。

General 只保留项目名称、仓库路径、worktree 位置、初始化命令。移动设置不改变数据库字段，只改变入口。

### 5.6 PR/MR 列表

- 顶部 Tab 右侧显示同步时间 / 错误信息与刷新图标；不放新建 Issue。
- 筛选：需要我审阅 / 我创建的 / 全部打开 / 最近合并。
- 行：state 图标、标题、`#number`、source → target、作者、更新时间。
- 检查列：`3/4 通过`、`1 失败`、`2 通过 · 1 运行中`；颜色 + 文字，不只靠颜色。
- 评审列：已批准 / 待审阅 / 需要修改 / 等待检查。
- 关联 Issue 列：`GH #128` 或 `本地 #12`。
- 行尾「打开」跳宿主；整行打开应用内详情。

### 5.7 PR/MR 详情

- 与 Issue 详情一样直接进入内容，不显示外层 `Issues | Pull requests` Tab，也不显示同步状态和刷新。
- 头部：`PR #132` + 标题 + state + 源/目标分支 + 作者 + 提交数 + 变更量。
- 操作：打开宿主、标记就绪、请求审阅、关闭、合并。
- Tab：概览 / 变更 / 检查 / 讨论。
- 概览：描述、关联 Issue、审阅者、标签、合并状态。
- 变更：文件列表 + diff 只读；大 diff 跳宿主。
- 检查：失败项置顶，展示名称、状态、耗时、日志链接。
- 讨论：评论与 review 只读；v1 不发评论，避免权限与审计复杂度。
- 右侧合并框：状态、阻塞原因、合并方式、删除源分支、合并按钮、在宿主处理。

### 5.8 合并

- 只在宿主返回可合并时启用；阻塞原因原样展示。
- 合并方式：merge commit / squash / rebase，默认跟随项目设置（v1 默认 squash）。
- 删除源分支：默认勾选，但只影响本次合并。
- 不做 `--admin`、不默认 auto-merge、不在检查失败时「强制合并」。
- 合并成功后刷新 PR + Issue；如果配置开启且 Issue 仍 open，关闭远程 Issue。

## 6. 数据模型

新增 migration `0060_remote_issue_and_change_requests.sql`。以下为设计稿，字段名实现时可微调，但语义不变。

### 6.1 项目设置

```sql
ALTER TABLE projects ADD COLUMN issue_source_mode TEXT NOT NULL DEFAULT 'local'
  CHECK (issue_source_mode IN ('local', 'remote', 'mixed'));
ALTER TABLE projects ADD COLUMN issue_sync_scope TEXT NOT NULL DEFAULT 'assigned_to_me'
  CHECK (issue_sync_scope IN ('assigned_to_me', 'all_open', 'label', 'all'));
ALTER TABLE projects ADD COLUMN issue_sync_label TEXT;
ALTER TABLE projects ADD COLUMN issue_sync_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (issue_sync_enabled IN (0, 1));
ALTER TABLE projects ADD COLUMN issue_sync_interval_seconds INTEGER NOT NULL DEFAULT 90
  CHECK (issue_sync_interval_seconds >= 60);
ALTER TABLE projects ADD COLUMN issue_writeback_close_on_complete INTEGER NOT NULL DEFAULT 1
  CHECK (issue_writeback_close_on_complete IN (0, 1));
ALTER TABLE projects ADD COLUMN issue_writeback_close_on_pr_merge INTEGER NOT NULL DEFAULT 1
  CHECK (issue_writeback_close_on_pr_merge IN (0, 1));
ALTER TABLE projects ADD COLUMN issue_writeback_comment INTEGER NOT NULL DEFAULT 1
  CHECK (issue_writeback_comment IN (0, 1));
ALTER TABLE projects ADD COLUMN last_issue_synced_at INTEGER;
ALTER TABLE projects ADD COLUMN last_issue_sync_error TEXT;
ALTER TABLE projects ADD COLUMN last_change_request_synced_at INTEGER;
```

连接身份单独一张 1:1 表，避免把 host/repo/login 塞进 `projects`：

```sql
CREATE TABLE project_forge_connections (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'gitlab')),
  host_url TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  login TEXT NOT NULL,
  auth_kind TEXT NOT NULL CHECK (auth_kind IN ('cli', 'pat', 'oauth')),
  auth_status TEXT NOT NULL CHECK (auth_status IN ('unknown', 'ready', 'expired', 'missing')),
  scopes_json TEXT NOT NULL DEFAULT '[]',
  checked_at INTEGER NOT NULL,
  UNIQUE (provider, host_url, repo_path)
);
```

`projects.forge_host` 继续保留给现有完成流程用；连接表是 Issue 同步与 PR 处理的来源。两者不一致时以连接表为准，并在设置页提示「重新检测」。

### 6.2 Issue 来源

```sql
ALTER TABLE issues ADD COLUMN source TEXT NOT NULL DEFAULT 'local'
  CHECK (source IN ('local', 'remote'));

CREATE TABLE issue_external_refs (
  issue_id INTEGER PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'gitlab')),
  host TEXT NOT NULL,
  repo TEXT NOT NULL,
  external_id TEXT NOT NULL,
  external_number INTEGER NOT NULL,
  external_url TEXT NOT NULL,
  remote_state TEXT NOT NULL CHECK (remote_state IN ('open', 'closed')),
  remote_state_reason TEXT,
  remote_author_json TEXT,
  remote_assignees_json TEXT NOT NULL DEFAULT '[]',
  remote_labels_json TEXT NOT NULL DEFAULT '[]',
  remote_milestone_json TEXT,
  remote_comment_count INTEGER NOT NULL DEFAULT 0,
  remote_created_at INTEGER,
  remote_updated_at INTEGER NOT NULL,
  synced_at INTEGER NOT NULL,
  etag TEXT,
  sync_status TEXT NOT NULL DEFAULT 'synced'
    CHECK (sync_status IN ('synced', 'stale', 'error', 'unavailable')),
  last_error TEXT,
  UNIQUE (project_id, provider, host, repo, external_number),
  UNIQUE (provider, host, external_id)
);

CREATE INDEX idx_issue_external_refs_project_id
  ON issue_external_refs(project_id, provider, remote_updated_at DESC);
```

评论与系统事件分表，避免污染本地 `issue_comments` 的 `UNIQUE(linked_session_id, linked_turn_id)` 语义：

```sql
CREATE TABLE issue_remote_comments (
  id INTEGER PRIMARY KEY,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  remote_comment_id TEXT NOT NULL,
  author_login TEXT NOT NULL,
  author_display_name TEXT,
  author_avatar_url TEXT,
  body TEXT NOT NULL,
  remote_created_at INTEGER NOT NULL,
  remote_updated_at INTEGER NOT NULL,
  UNIQUE (issue_id, remote_comment_id)
);

CREATE TABLE issue_remote_events (
  id INTEGER PRIMARY KEY,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  remote_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_login TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  remote_created_at INTEGER NOT NULL,
  UNIQUE (issue_id, remote_event_id)
);
```

时间轴查询在 service 层合并 `issue_actions` / `issue_comments` / `issue_remote_comments` / `issue_remote_events`，按 `created_at` 升序返回；前端不直接查表。

### 6.3 PR/MR

```sql
CREATE TABLE change_requests (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'gitlab')),
  host TEXT NOT NULL,
  repo TEXT NOT NULL,
  external_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ('open', 'draft', 'merged', 'closed')),
  author_login TEXT,
  author_avatar_url TEXT,
  source_branch TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  mergeable TEXT,
  merge_state_status TEXT,
  review_decision TEXT,
  checks_ok INTEGER NOT NULL DEFAULT 0,
  checks_failed INTEGER NOT NULL DEFAULT 0,
  checks_pending INTEGER NOT NULL DEFAULT 0,
  remote_created_at INTEGER,
  remote_updated_at INTEGER NOT NULL,
  synced_at INTEGER NOT NULL,
  detail_synced_at INTEGER,
  etag TEXT,
  UNIQUE (project_id, provider, host, repo, number),
  UNIQUE (provider, host, external_id)
);

CREATE TABLE change_request_issue_links (
  change_request_id INTEGER NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  link_kind TEXT NOT NULL CHECK (link_kind IN ('closing', 'mentioned', 'branch', 'manual')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (change_request_id, issue_id)
);

CREATE TABLE change_request_details (
  change_request_id INTEGER PRIMARY KEY REFERENCES change_requests(id) ON DELETE CASCADE,
  files_json TEXT NOT NULL DEFAULT '[]',
  checks_json TEXT NOT NULL DEFAULT '[]',
  reviews_json TEXT NOT NULL DEFAULT '[]',
  comments_json TEXT NOT NULL DEFAULT '[]',
  fetched_at INTEGER NOT NULL
);
```

`issue_pull_requests` 保留为历史表，新增 `change_request_id` 可空列；已有 URL 在首次同步/打开时解析并升级为 `change_requests` 行。解析失败的历史 URL 仍可按外链打开。

### 6.4 为什么详情用 JSON

PR 的 files / checks / reviews / comments 是宿主快照，形状差异大、更新频繁、只在详情页用。v1 存 JSON 快照，避免过早为每个 provider 的每个字段建表；列表页需要的字段已经提升到 `change_requests`。等做行内 review 时再拆评论表。

## 7. 后端架构

### 7.1 新模块

连接探测复用 `src-tauri/src/git/forge.rs` 的 `inspect_forge`、`parse_forge_url`、`cli_is_installed`。

Issue 与 PR/MR 的同步已经落在 `src-tauri/src/features/issue/github_issue_mirror`（`ForgeIssuePort`、GitHub/GitLab CLI 与解析）和 `src-tauri/src/features/change_request`（列表、同步、关联）。不要新建 `src-tauri/src/forge/`。

下面的树是当时拟定、尚未采用的形状。HTTP 适配仍未开工，开工前也不要把现有代码搬进这棵树。

```text
src-tauri/src/forge/
  mod.rs              // ForgeProvider / ForgeRepo / SyncScope / domain DTO
  port.rs             // trait ForgePort
  github/
    cli.rs            // v1: gh CLI adapter
    api.rs            // P3: REST/GraphQL adapter
    parse.rs          // JSON -> domain，含 fixture 测试
  gitlab/
    cli.rs            // v1: glab CLI adapter
    api.rs            // P3
    parse.rs
  sync/
    issue_sync.rs     // 拉取、upsert、评论/事件、游标、退避
    change_request_sync.rs
  commands.rs         // Tauri commands
```

现有调用走 `github_issue_mirror` 里的 `ForgeIssuePort`。`features/issue/` 与 `features/change_request/` 不直接拼 CLI 参数。上面的 `forge/` 树不是当前代码。

### 7.2 Port

```rust
pub trait ForgePort: Send + Sync {
    fn provider(&self) -> ForgeProvider;
    fn viewer(&self) -> Result<ForgeViewer, ForgeError>;
    fn list_issues(&self, scope: &SyncScope, cursor: Option<&str>)
        -> Result<Page<RemoteIssue>, ForgeError>;
    fn get_issue(&self, number: i64) -> Result<RemoteIssue, ForgeError>;
    fn list_comments(&self, number: i64, since: Option<i64>)
        -> Result<Vec<RemoteIssueComment>, ForgeError>;
    fn list_events(&self, number: i64, since: Option<i64>)
        -> Result<Vec<RemoteIssueEvent>, ForgeError>;
    fn create_issue(&self, input: CreateRemoteIssue) -> Result<RemoteIssue, ForgeError>;
    fn set_issue_state(&self, number: i64, state: RemoteIssueState) -> Result<(), ForgeError>;
    fn create_comment(&self, number: i64, body: &str) -> Result<(), ForgeError>;
    fn list_change_requests(&self, filter: ChangeRequestFilter, cursor: Option<&str>)
        -> Result<Page<RemoteChangeRequest>, ForgeError>;
    fn get_change_request(&self, number: i64) -> Result<RemoteChangeRequest, ForgeError>;
    fn get_change_request_details(&self, number: i64)
        -> Result<RemoteChangeRequestDetails, ForgeError>;
    fn mark_ready(&self, number: i64) -> Result<(), ForgeError>;
    fn merge(&self, number: i64, method: MergeMethod, delete_branch: bool)
        -> Result<(), ForgeError>;
}
```

`CliForge` 与 `HttpForge` 都实现它。v1 用 CLI，P3 切 HTTP 时 service、sync、UI 不动。

### 7.3 CLI 适配（v1）

| 能力 | GitHub | GitLab |
| --- | --- | --- |
| 当前账号 | `gh api user` | `glab api user` |
| Issue 列表 | `gh issue list --json ...` | `glab issue list --output json` |
| Issue 详情 | `gh issue view <n> --json ...` | `glab issue view <n> -F json` |
| 评论 | `gh issue view <n> --json comments` | `glab issue view <n> -F json`（notes 含 system） |
| 系统事件 | `gh api repos/{owner}/{repo}/issues/{n}/timeline` | `glab api projects/:id/issues/{iid}/resource_state_events` 等 |
| 创建 Issue | `gh issue create` | `glab issue create` |
| 关闭/重开 | `gh issue close/reopen` | `glab issue close/reopen` |
| PR 列表 | `gh pr list --json ...` | `glab mr list -F json` |
| PR 详情 | `gh pr view <n> --json ...` | `glab mr view <n> -F json` |
| 检查 | `gh pr checks <n> --json ...` | `glab ci status` / MR pipelines |
| 合并 | `gh pr merge --squash` | `glab mr merge --squash` |

glab 的开关以本机 `glab issue list --help` 为准，表里的 flag 不是契约。具体字段以 fixture 为准，不允许靠字符串猜输出。

CLI 适配的硬约束：

- 所有命令显式 `current_dir(project.repo_path)`，并走现有 `apply_interactive_path`，复用交互式登录态。
- 不把 token 放进命令行参数；CLI 自己管理凭据。
- 统一 3 秒短超时只用于 `auth status`；列表/详情用可取消的长超时，并在 UI 显示同步中。
- 错误输出只保留宿主返回的错误码/消息，脱敏后展示；不要把整段 stderr 塞进 toast。
- `gh` / `glab` 版本差异进 capability 探测；字段缺失要降级，不要让整个同步失败。

### 7.4 HTTP 适配（P3）

- GitHub：REST 为主，必要时 GraphQL（例如 PR 的 `closingIssuesReferences`、timeline 的 cross-reference）。
- GitLab：REST v4；项目级 Issue 优先 keyset（18.3+），旧实例回退 offset + `updated_after`。
- 条件请求：Issue/PR 列表与详情保存 `ETag`，下次 `If-None-Match`；304 不写库。
- 增量：GitHub Issue `since` + 稳定排序；GitHub PR 无 `since`，按 `updated` 排序后本地水位截断；GitLab `updated_after`。
- 限流：读 `X-RateLimit-Remaining` / `Retry-After`；退避到 `min(2^n * 30s, 30min)`；手动刷新重置。
- 单项目同一时刻最多一个同步请求；全局最多两个 adapter 并发。

### 7.5 Tauri 命令

新增（命名实现时可调）：

- `inspect_forge_connection(projectId)` → 连接、账号、能力、CLI 状态。
- `sync_project_issues(projectId, full?)` → `{ synced, created, updated, skipped, error? }`。
- `list_project_issues` 扩展 `source` / `syncStatus` 过滤，返回 remote ref 摘要。
- `get_issue_remote_detail(projectId, issueId)` → 远程 ref + 评论 + 事件。
- `create_remote_issue(input)`。
- `link_issue_external_ref(input)` / `unlink_issue_external_ref(input)`。
- `sync_project_change_requests(projectId, filter?)`。
- `list_project_change_requests(projectId, filter)`。
- `get_project_change_request(projectId, number)`。
- `merge_project_change_request(projectId, number, method, deleteBranch)`。
- `mark_project_change_request_ready(projectId, number)`。
- 事件：`issue-sync-changed`、`change-request-sync-changed`、`forge-auth-changed`。

所有命令走现有 `CommandError` + 错误码；新增 `ForgeAuthExpired` / `ForgeRateLimited` / `ForgeNotFound` / `ForgeUnavailable` / `ForgeWriteForbidden`，文案进 `locales`。

## 8. 认证与安全

### 8.1 v1：复用 CLI

- 不新增 OAuth App，不把 token 写进 SQLite。
- `gh auth status` / `glab auth status` 只做状态判断；真正的读取由具体命令触发。
- 企业实例：`GH_HOST` / `GITLAB_HOST` 或显式 `--hostname`；设置页展示 host，不提供「忽略证书」。
- CLI 未安装/未登录时：允许继续看缓存；禁用远程写入与新建；顶部横幅提供「重新登录」。

### 8.2 P3：原生 HTTP

- GitHub：官方桌面端路径是 GitHub App + device flow（只传 client ID，不需要 client secret），或 OAuth App 的 device flow；不要在客户端内置 client secret。
- GitLab：OAuth authorization code + PKCE（不需要 client secret），或 device authorization grant；PAT 作为兜底。
- token 存 OS keychain（`keyring` crate），不存 SQLite、不写日志、不放进命令参数。
- 最小权限：
  - GitHub fine-grained：Issues read/write、Pull requests read/write、Contents read、Metadata read。
  - GitLab：`read_api`（只读）或 `api`（读写）；`read_user` 用于账号。
- 日志脱敏：`Authorization`、`PRIVATE-TOKEN`、`GH_TOKEN`、`GITLAB_TOKEN` 一律替换为 `***`。

### 8.3 风险

- 远程图片/链接由 WebView 直接加载，可能泄露 IP 或触发追踪；v1 记录风险，P3 可加「不加载远程图片」。
- 宿主限流是共享的；过度轮询会影响用户其他工具。默认 90 秒、可见才轮询、失败退避。
- 合并是高风险写操作；必须二次确认，且只在宿主明确「可合并」时启用。
- 404 可能是无权访问；不能自动删除本地 Issue，统一进入 `unavailable` 并给用户选择。

## 9. 同步算法

### 9.1 Issue

```text
sync_project_issues(project_id, full):
  settings = load(project_id)
  if settings.mode == local: return skipped
  if !try_acquire(project_id): return coalesced
  connection = inspect_connection(project_id)
  if !connection.ready: mark error; emit auth-changed; return
  cursor = full ? None : load_cursor(project_id)
  loop:
    page = forge.list_issues(scope, cursor)
    transaction:
      for remote in page.items:
        if remote.is_pull_request: continue     // GitHub 列表会混入 PR
        upsert_issue_and_ref(remote)             // 见 9.2
    commit
    cursor = page.next
    if !page.has_more or page_count >= limit: break
  for issue in changed_this_run:
    comments = forge.list_comments(number, since)
    events = forge.list_events(number, since)
    upsert_comments_events(issue, comments, events)
  update last_synced_at; clear error; emit issue-sync-changed
```

### 9.2 Upsert 规则

| 情况 | 行为 |
| --- | --- |
| `(provider, host, external_id)` 已存在 | 更新 ref 与远程字段；不动 `issues.status`（除 4.6 规则） |
| 不存在，但 `(provider, host, repo, external_number)` 命中 | 更新 ref 的 `external_id`（repo 迁移/重建） |
| 不存在 | 新建 `issues`（`source=remote`，`number=MAX+1`）+ ref；open→backlog，closed→completed |
| 本地已软删 | 不复活；ref 标记 `unavailable` |
| 远程 404/410 | 先标记 `unavailable`，不自动删；显式确认或全量对账后再决定 |
| 同一次同步重复出现 | 唯一索引兜底；后写覆盖前写，计数只加一次 |

### 9.3 PR/MR

- 列表默认：open + draft + 最近 30 天 merged/closed，按 `updated_at desc`。
- 详情按需拉；打开详情时拉 files/checks/reviews/comments，之后 30 秒刷新（页面可见且窗口聚焦）。
- 列表 60 秒刷新；与 Issue 同步错开，避免同一时刻打满 API。
- PR 合并成功后：更新 PR state、关闭关联远程 Issue（若开启且仍 open）、刷新 Issue 卡片。
- PR 关闭未合并：本地 Issue 保持 completed，但显示「PR 已关闭未合并」，提供「重新打开 Issue」。
- GitHub `mergeable=null` 显示「正在计算」，不显示「不可合并」；合并失败时展示宿主错误。

### 9.4 失败与缓存

- 任何一次同步失败都不清空已有数据；只更新 `last_issue_sync_error` 和 ref 的 `sync_status=stale`。
- UI 顶部横幅显示：失败原因、最后成功时间、下次重试时间、重试按钮。
- 写操作失败不排队、不静默降级；保持本地状态不变，展示宿主错误。
- 周期全量对账：默认 6 小时一次，检测删除、权限撤销、仓库迁移；不在每次轮询里做全量。

## 10. 与现有完成流程衔接

现有 flow：

```text
detecting_workspace
  → prompting_dirty_decision → auto_committing → confirming_continue_after_commit
  → prompting_closeout_action
      ├ merge_to_base → reconciling_worktree → confirming_worktree_cleanup → completed
      └ open_pull_request → push → create PR/MR → completed
```

新增 effect（不新增 phase）：

| effect | 触发 | 行为 |
| --- | --- | --- |
| `link_change_request` | 创建 PR 成功 | 解析 URL/number，写 `change_requests` + `change_request_issue_links`，Issue 详情立即可见 |
| `writeback_completion_comment` | 完成成功 | 若 Issue 为远程且开关开启，把交付摘要发到远程 Issue |
| `close_remote_issue` | merge_to_base 完成 / PR merged | 若远程仍 open 且开关开启，关闭并写 `issue_actions` |

关键规则：

- **创建 PR 不立即关闭远程 Issue。** 本地 Issue 可以标记 completed，但远程保持 open，详情显示「PR 待合并」。
- PR 合并后，同步发现 merged → 关闭远程 Issue（默认开）→ 评论（若未发过）。
- 如果用户在完成弹窗明确选择「关闭远程 Issue」才立即关闭；这是覆盖默认值的显式动作。
- 外部 PR 已存在时，完成 flow 复用「关联已有 PR」，不重复创建。
- 远程 Issue 关闭不自动终止 running session；只提示。
- 一 PR 关联多 Issue：GitHub 用 closing keyword + timeline `cross-referenced` 校验；GitLab 用 closing pattern + `closes_issues` 校验。文本解析只做解释，不作为唯一事实。

## 11. 实施计划

### P0：只读镜像与来源模式（约 2 周）

1. Migration 0060 + repository / Rust DTO / TS 类型 / 数据模型文档。
2. `forge/` 骨架 + `ForgePort` + GitHub/GitLab CLI 适配的 `viewer` / `list_issues` / `get_issue` / `list_comments` / `list_events`。
3. `IssueSyncService`：范围、分页、upsert、评论/事件、last_synced、错误。
4. Project Settings → Issues：来源模式、连接、范围、同步开关/间隔、刷新。
5. 看板：来源徽标、仅本地/仅远程过滤；混合模式 Issues Tab 行右侧来源筛选（全部 / 仅本地 / GitHub 或 GitLab）；顶部 Tab 不放新建 Issue，刷新只显示图标。
6. 测试：adapter fixtures、upsert 幂等、模式切换不删数据、来源筛选。

验收：混合模式能同时看到本地与远程 Issue；重复同步不产生重复；切到仅本地后远程隐藏、切回恢复；CLI 未登录时显示缓存与错误条。

### P1：远程详情与写回（约 2 周）

7. 远程 Issue 详情：评论/系统事件合并时间轴、右侧宿主字段、只读正文、打开宿主。
8. 混合模式新建：来源分段控件只显示选项名；远程创建后回填。
9. 完成 flow 写回：关闭远程、交付摘要评论、PR 合并后关闭。
10. 模式切换确认、隐藏计数、远程删除/无权/仓库迁移状态。
11. 测试：完成写回幂等、远端关闭/重开规则、删除保留为本地。

验收：远程 Issue 详情能看到宿主评论；完成 merge_to_base 后远程关闭且评论一次；完成 open_pull_request 后远程不关闭，PR 合并后才关闭。

### P2：PR/MR 一等实体（约 3 周）

12. `change_requests` / links / details 三表 + repository + DTO。
13. PR 列表 Tab + 四个筛选 + 检查/评审/关联 Issue 列。
14. PR 详情：概览、文件、检查、讨论（只读）。
15. 创建 PR 时显式关联 Issue；导入 PR 时解析 closing keyword / 分支名 / 手动关联。
16. 合并、标记就绪、关闭/重开；合并门禁与错误展示。
17. 完成 flow 的 `link_change_request` effect。

验收：PR 列表能按「需要我审阅」筛选；详情检查失败时合并禁用；合并成功后 Issue 状态与 PR 链接同步；一 PR 多 Issue 关联可显示。

### P3：原生客户端与增量（约 3 周）

18. HTTP adapter + token keychain + OAuth/PAT 登录。
19. ETag / since / 增量游标 / 限流退避。
20. 行内 review 评论、回复、通知（可选）。
21. 自建 GitLab / GHES 加固、代理、遥测脱敏。

验收：不安装 `gh/glab` 也能完成 P0-P2 的核心读写；304 不写库；限流时按退避恢复。

## 12. 验收标准

- 三种模式切换均可逆，不删除任何 Issue、评论、附件、Session、完成记录。
- 远程 Issue 重复同步幂等；`(provider, host, external_id)` 唯一。
- 本地工作流状态不会被同步覆盖；远端关闭/重开严格按 4.6 表。
- 顶部 Tab 右侧显示筛选（仅混合 Issues）、同步时间 / 错误信息与刷新图标；不放新建 Issue；刷新仅图标。
- 混合模式 Issues 的来源筛选在顶栏右侧，选项为全部 / 仅本地 / GitHub 或 GitLab；仅远程与仅本地模式不展示来源筛选。模式尚未返回时也不展示来源筛选、同步状态、刷新和待办加号。
- 混合模式卡片正常为 Info 背景，出错为 Error 背景。
- 远程详情评论/事件按时间合并；本地 Agent 交付摘要仍可出现。
- 完成 flow：merge_to_base 关闭远程；open_pull_request 不提前关闭；PR 合并后关闭。
- PR 列表、详情、检查、评审、关联 Issue 可见；合并按钮只在宿主允许时启用；无 admin 绕过。
- 认证过期、离线、限流、远端删除都有明确状态与恢复动作。
- 所有用户可见文案进 i18n；中英文完整。
- 质量门禁按 `AGENTS.md` §5 执行；新增 Rust/前端文件不越文件大小门禁。

## 13. 非目标

- 完整的 GitHub/GitLab 客户端（仓库设置、Wiki、Actions、Projects、Milestones 管理）。
- 双向同步 Issue 标题/正文/标签/指派/里程碑。
- Webhook 接收（桌面端无公网 endpoint）。
- 行内 review、建议修改、逐行评论（P3 之后）。
- 自动 merge 默认开启、admin 绕过保护分支。
- Bitbucket / Gitea / Jira / Linear 作为 Issue 源（数据模型留扩展位，不在本期）。
- 一个项目连接多个仓库 / 多 forge。
- Fork PR 的跨仓合并（v1 只读展示）。

## 14. 开放问题

1. **远程正文是否允许写回？** 建议 v1 只读；如果产品要求编辑，走「打开宿主」或 P3 的写-through 编辑器，不做双向合并。
2. **混合模式新建默认本地还是远程？** 建议默认本地并记住上次选择；避免误把内部草稿发到公开仓库。
3. **关闭时机是否只做 PR 合并后？** 建议默认严格如此；完成弹窗提供「关闭远程 Issue」覆盖项。
4. **PR 是否独立 Activity？** 建议先做 Tab；如果 PR 使用频率超过 Issue，再拆。
5. **是否同步 closed Issue？** 默认只同步 open；首次全量可选 `all`，已导入的继续更新。
6. **远程标签如何映射？** v1 按名称映射到本地标签仅用于显示；不删除本地标签，不写回远程标签。
7. **远程图片隐私？** v1 允许 WebView 加载；P3 增加「不加载远程图片」或代理。
8. **Fork PR / 多仓库？** v1 只读展示，不合并；多仓库留给后续。

## 15. 静态原型

文件：[issue-pr-workbench.prototype.html](../../../src/features/issues/issue-pr-workbench.prototype.html)

单文件、无构建、无后端，沿用 `completion-closeout.prototype.html` 的评审方式：左侧场景导航，顶部说明，底部状态打印；左右键切换。

场景：

1. 混合模式看板（本地 + GitHub + GitLab）。
2. 仅远程 + 凭据失效（缓存、错误条、禁用新建）。
3. 进行中 · 远程（评论、系统事件、运行中的会话；打开 GitHub 在 GitHub 卡片）。
4. 混合模式新建 Issue（来源只显示选项名）。
5. 项目设置 → Issues（模式、连接、范围、同步、写回、完成后；不写解释文案）。
6. 切换来源模式确认（隐藏计数、非破坏性说明）。
7. PR 列表 · 待我审阅（检查、评审、关联 Issue）。
8. PR 详情 · 概览（不再显示外层 Issues / Pull requests Tab，合并框、阻塞原因）。
9. PR 详情 · 检查（失败项、日志链接、合并禁用）。
10. 合并弹窗（合并方式、删除分支、阻塞）。
11. 创建 PR 时关联 Issue（远程 vs 本地语义）。
12. PR 合并后（检查全通过、关联 Issue 已关闭、合并结果只读）。
13. 仅本地 · Pull requests 空态（保留入口、引导去设置连接）。
14. GitLab 项目设置（`glab` 连接、Merge Request 文案、MR 目标与写回）。
15. 远端已删除（保留为本地 / 移除关联 / 重试）。
16. 仅本地模式（不展示来源筛选与同步说明）。
17. 待办 · 本地（直接编辑表单，无会话/运行参数）。
18. 待办 · 远程（只读详情，无会话/运行参数，运行 + 打开宿主）。
19. 进行中 · 本地（只读详情 + 运行中的会话）。
20. 待审核 · 远程（会话 + 关联 PR + 完成入口）。
21. 已完成 · 远程（关闭会话 + 已合并 PR + 回看/重新打开）。
22. 已完成 · 本地（关闭会话 + 回看/重新打开，无宿主入口）。
23. 待审核 · 本地（关闭会话 + 完成入口，无宿主入口）。

原型只回答「看起来对不对、流程是否说得清」，不接 `gh/glab`，不改 SQLite。产品明确「通过」或「go」后再按本文拆实现 ticket。
