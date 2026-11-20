# 远程 Issue 正文规范化、完成评论与跨仓库关联调研

> 调研日期：2026-11-20。外部事实只采用当天打开的官方文档、官方 API reference、官方 CLI 手册与官方仓库 README。本仓库行为以当前代码、`CONTEXT.md` 与 `docs/adr/` 为准。
> 状态：已完成。没有一手证据的能力写「未找到」，不把二手对比文当结论。
> 不重复 [2026-10-31 远程 Issue 与 PR/MR 同步调研](./2026-10-31-remote-issue-and-pr-sync-research.md)；本文只覆盖「创建后改写正文」「完成时追加评论」「如何串进工作台」和「关联另一个仓库的 Issue」。

## 结论摘要

1. 创建远程 Issue 时继续提交用户原文，不要等模型先美化。GitHub `POST /repos/{owner}/{repo}/issues` 和 GitLab `POST /projects/:id/issues` 都接受当时给出的 `body` / `description`，没有「先草稿、后规范」的官方状态。[GitHub 创建 Issue](https://docs.github.com/en/rest/issues/issues#create-an-issue) [GitLab Issues API](https://docs.gitlab.com/api/issues/)
2. 美化后的正文可以事后整篇替换：GitHub `PATCH /repos/{owner}/{repo}/issues/{issue_number}` 的 `body`，GitLab `PUT /projects/:id/issues/:issue_iid` 的 `description`。两边这次打开的参数表都没有 `If-Match` 或版本号，不能靠平台做乐观锁。[GitHub 更新 Issue](https://docs.github.com/en/rest/issues/issues#update-an-issue) [GitLab 更新 Issue](https://docs.gitlab.com/api/issues/)
3. 完成说明应该是追加评论，不是再改一遍正文。GitHub `POST .../issues/{issue_number}/comments` 和 GitLab `POST .../issues/:issue_iid/notes` 都只接收正文，没有幂等键。重复调用会再发一条。[GitHub 创建评论](https://docs.github.com/en/rest/issues/comments#create-an-issue-comment) [GitLab 创建 Issue note](https://docs.gitlab.com/api/notes/)
4. 不要把这件事只做成派发 prompt 或 skill。业界已落地的工作台把 Issue 当输入快照、把 PR 当交付、把评论当进度；没有一家官方文档把「执行中让模型改写远程 Issue 正文」写成标准闭环。GitHub Copilot 甚至写明：指派之后新出现的 Issue 评论，agent 不会再看到。[Copilot cloud agent](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github)
5. RedWhisk 已经有「本地完成之后，最多向远程 Issue 发一次交付摘要」；没有「把远程正文改写成背景 / 需求 / 验证」的路径。远程正文在现有设计里是只读镜像，同步会把远端标题和正文写回本地。[`writeback_store.rs`](../../src-tauri/src/features/issue/completion/writeback_store.rs) [工作台设计](../superpowers/specs/2026-10-31-remote-issue-and-pr-workbench-design.md)
6. 默认串联应放在宿主生命周期，而不是模型记得去跑 `gh` / `glab`：创建时交原文；分析完成后由应用写一次正文；用户完成本地任务后由现有写回发一条评论。模型只产出结构化正文和摘要。
7. 跨仓库「正式关联」不对称。GitHub 明确支持跨仓库的是子 Issue：创建参数写明要对父 Issue 所在仓库和当前仓库都有 triage。GitLab 明确支持跨项目的是 Issue links：`target_project_id` 指向另一个项目，调用者必须能更新两边。[GitHub 创建 Issue](https://docs.github.com/en/rest/issues/issues#create-an-issue) [GitLab Issue links](https://docs.gitlab.com/api/issue_links/)
8. 只在正文里写 `owner/repo#123` 或完整 URL，得到的是引用和反向提及，不是父/子、blocks 或 relates 关系。做不到正式关联时，这是最小可用落点。[GitHub 自动链接](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/autolinked-references-and-urls) [GitLab 交叉引用](https://docs.gitlab.com/user/project/issues/crosslinking_issues/)
9. Skill 可以当外置实验，不能当唯一实现。本仓库的 workflow skill 注入只是一句「使用 skill … 执行任务」，不会带上远程 Issue URL。[`run-prompt-builder.ts`](../../src/features/issues/issue-run/run-prompt-builder.ts)

## 现状与缺口

创建远程 Issue 时，GitHub 走 `gh issue create --title --body`，GitLab 走 `glab issue create --title --description`。正文就是草稿的 `body`，草稿来自用户描述（附件只替换成宿主链接）。[`create_cli.rs`](../../src-tauri/src/features/issue/github_issue_mirror/create_cli.rs) [`host_attachment_body.rs`](../../src-tauri/src/features/issue/host_attachment_body.rs)

没有后续更新远程正文的命令。同步方向是远端到本地：`update_visible_text` 用远程标题和正文覆盖本地可见文本。[`sync.rs`](../../src-tauri/src/features/issue/github_issue_mirror/sync.rs)

本地交付评论和远程评论是两条管道：

| 管道 | 现在做什么 | 不做什么 |
| --- | --- | --- |
| 本地 `<issue-comment>` | 成功 turn 抽出标签就写入 `issue_comments`；没有标签时，只有 `initial` / `completion` 用助手正文兜底 | 不调用 GitHub / GitLab。[`completion_comment.rs`](../../src-tauri/src/features/issue/completion_comment.rs) |
| 远程完成写回 | 本地已经完成后，若项目打开评论开关且 `comment_done` 还是假，把最近一条带 `linked_session_id` 的本地评论用 `gh issue comment` 或 `glab issue note` 发到远端，只发一次 | 不改远程标题或正文。失败不撤销本地完成。[`writeback.rs`](../../src-tauri/src/features/issue/completion/writeback.rs) [`CONTEXT.md`](../../CONTEXT.md) |

派发 prompt 目前不会要求模型输出 `<issue-comment>`。`ISSUE_DELIVERY_SUMMARY_INSTRUCTION` 还在，注释写明暂时不注入；测试也断言最终 prompt 不含这个标签。ADR 0029 曾要求首轮 prompt 必须追加这句，和当前代码不一致。[`run-prompt-builder.ts`](../../src/features/issues/issue-run/run-prompt-builder.ts) [ADR 0029](../adr/0029-agent-turn-comment-multica-fallback.md)

同一条 prompt 也不含远程 Issue URL 或编号。workflow skill 只前置「使用 skill {name} 执行任务：」或英文等价句，然后拼上本地描述。[`run-prompt-builder.ts`](../../src/features/issues/issue-run/run-prompt-builder.ts)

2026-10-31 工作台设计把远程正文定为 v1 只读，写回只做三件事：关闭、回写一次交付摘要、创建 PR/MR。不做标题或正文的双向合并。这次若要美化远程正文，是一条新的显式写回，不是把该决定悄悄改成双向同步。[工作台设计](../superpowers/specs/2026-10-31-remote-issue-and-pr-workbench-design.md)

创建参数里没有父 Issue、关联 Issue 或外部 URL 字段。[`ForgeIssueDraft`](../../src-tauri/src/features/issue/github_issue_mirror/port.rs)

## GitHub

### 更新正文

`PATCH /repos/{owner}/{repo}/issues/{issue_number}` 的 `body` 是 Issue 内容；`title` 可单独改。Issue owner、有 push 权限的用户，或 Triage 角色可以编辑。该页参数表没有条件写、ETag 或幂等键。`labels` 和 `assignees` 是整组替换，空数组会清空；只改正文时不要带这些字段。[GitHub 更新 Issue](https://docs.github.com/en/rest/issues/issues#update-an-issue)

这次打开的更新端点没有写 fine-grained token 的权限名，只写了仓库角色。评论接口的响应里，GitHub App 权限对象包含 `issues` 这一项，但是字符串级别，没有在创建评论的说明里展开成 read/write。[GitHub 评论](https://docs.github.com/en/rest/issues/comments)

网页上的描述编辑会留下编辑历史，除非作者或有写权限的人删掉。这只说明 UI 有历史，不提供 API 级冲突检测。[编辑 Issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/editing-an-issue)

`gh issue edit --body` 会设置新正文。不传 body 类参数时，已有正文保留。多条一起编辑时，手册写明这些 Issue 必须在同一仓库；`-R` 用来改命令指向的仓库。[gh issue edit](https://cli.github.com/manual/gh_issue_edit)

Issue forms / form schema 是创建时的表单配置，文档状态仍是 public preview。这次打开的 schema 页和编辑页都没有「创建之后自动把已有正文重写成模板」的能力。未找到 forms 能替代事后美化的说明。[form schema](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema)

GitHub 另有 Issue suggestions：agent 提议改 type、label、field、assignee 或关闭状态，维护者批准后才生效。动作枚举是 `set_type`、`add_label`、`add_field`、`add_assignee`、`close_issue`，没有改 body。更新接口里的 `issue_field_values[].suggest=true` 也只是把字段值存成待审建议。这是「元数据建议」，不是正文美化。[建议列表](https://docs.github.com/en/rest/issues/issues#list-issue-suggestions) [批准建议](https://docs.github.com/en/rest/issues/issues#approve-an-issue-suggestion)

### 追加评论

`POST /repos/{owner}/{repo}/issues/{issue_number}/comments`，body 必填。会触发通知，发太快会吃次级限流。参数只有 `body`。响应里的作者是 `user`；若由 GitHub App 发出，`performed_via_github_app` 非空。创建说明没有另写「作者恒为 token 用户」。[创建评论](https://docs.github.com/en/rest/issues/comments#create-an-issue-comment)

已有评论可用 `PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}` 改 body。这是按评论 id 更新，不是按业务键去重。[更新评论](https://docs.github.com/en/rest/issues/comments#update-an-issue-comment)

`gh issue comment --body` 追加一条。`--edit-last` 改的是当前用户的最后一条评论，`--create-if-none` 只能和 `--edit-last` 一起用。这不是通用幂等键。[gh issue comment](https://cli.github.com/manual/gh_issue_comment)

评论接口文档写明大多数端点使用 `X-GitHub-Api-Version: 2026-03-10`。[评论总览](https://docs.github.com/en/rest/issues/comments)

### 引用和正式关联

| 机制 | 跨仓库 | 语义 | 证据 |
| --- | --- | --- | --- |
| 正文或评论里的 `owner/repo#123`、Issue URL | 支持引用 | 缩短成链接，并默认产生 backlink。不是父/子，也不是 blocked-by | [自动链接](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/autolinked-references-and-urls) |
| 子 Issue / `parent_issue_id` | 支持。创建说明写明：设置父 Issue 需要对父仓库和当前仓库都有 triage | 父子。每父最多 100 个子，最多 8 层。UI 可从其他仓库挑选已有 Issue | [创建 Issue](https://docs.github.com/en/rest/issues/issues#create-an-issue) [添加子 Issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues) |
| `gh issue create --parent`、`gh issue edit --add-sub-issue` | 参数接受 number 或 URL，因此可以指向别的仓库；用户文档的 UI 明确写了其他仓库 | 同上 | [gh issue create](https://cli.github.com/manual/gh_issue_create) [gh issue edit](https://cli.github.com/manual/gh_issue_edit) |
| `POST .../issues/{number}/relates_to`，body 是全局 `issue_id` | 未写明。参数只说「要标成相关的 issue id」，没有「其他仓库」或「两个仓库都要有权限」这种句子 | 正式的 relates。不是 closing，也不是父子 | [添加相关 Issue](https://docs.github.com/en/rest/issues/issues#add-a-related-issue) |
| blocked-by / blocking | 未写明。CLI 接受 number 或 URL，示例仍是同一仓库 `octo-org/octo-repo#200` | 依赖。至少 triage。Free、Pro、Team、Enterprise Cloud 可用 | [创建依赖](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies) |
| closing keyword `Fixes owner/repo#100` | 支持，但这是 PR 关闭另一个仓库的 Issue | 不是两条 Issue 之间的关联 | [把 PR 链到 Issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue) |
| 从 PR 侧边栏手工链接 Issue | 不支持。Issue 和 PR 必须在同一仓库，每条 PR 最多 10 个 | Development 链接 | 同上 |
| 从 Issue 侧边栏手工链接 PR 或分支 | PR 可以在别的仓库，Issue 仍是当前这条 | 仍然是 PR/分支，不是另一条 Issue | 同上 |

Issues REST 页能在 Issue 对象上看到 `issue_dependencies_summary`，但目录里没有创建 blocked-by 的端点。未找到 REST 创建依赖的官方端点；现成命令是 `gh issue edit --add-blocked-by`。[依赖](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies)

这次没有打开到官方 GraphQL reference 里的具体 mutation 页，因此不把 `addSubIssue` 等 mutation 名写成已核实结论。REST 的 `parent_issue_id` 和 `gh` 的 URL 参数已经够用。

## GitLab

### 更新正文

`PUT /projects/:id/issues/:issue_iid`。至少要带一个可更新字段；`description` 和 `title` 都在其中。描述上限 1,048,576 字符。这次打开的参数表没有版本令牌或幂等键。[GitLab 更新 Issue](https://docs.gitlab.com/api/issues/)

`glab issue update <id> --description` 替换描述。不传 `--description` 时，`--attach` 把附件引用追加到已有描述末尾。`<id>` 可以是 IID，也可以是 Issue URL；`-R` 指向另一个项目。[glab issue update](https://gitlab.com/gitlab-org/cli/-/blob/main/docs/source/issue/update.md)

### 追加评论

`POST /projects/:id/issues/:issue_iid/notes`，`body` 必填，上限 1,000,000 字符。`PUT .../notes/:note_id` 可以改已有 note。列表响应含 `system`；文档写明有些系统 note 不在 Notes API 里，而是 label、state、milestone 等独立事件。[创建 note](https://docs.gitlab.com/api/notes/) [更新 note](https://docs.gitlab.com/api/notes/)

创建或更新 note 时，GitLab 会先执行再去掉 quick actions，并去掉回车和末尾空白。所以评论正文里的 `/close`、`/label` 会变成真实操作，而且存下来的正文可能和发出去的不同。[Note 规范化](https://docs.gitlab.com/api/notes/)

`glab issue note <id> -m` 发表评论，别名是 `comment`。没有「按键更新上一条」的参数。子命令列表是 board、close、create、delete、list、note、reopen、subscribe、unsubscribe、update、view。未找到 `glab issue link`。[glab issue note](https://gitlab.com/gitlab-org/cli/-/blob/main/docs/source/issue/note.md) [glab issue](https://gitlab.com/gitlab-org/cli/-/blob/main/docs/source/issue/_index.md)

### 引用和正式关联

| 机制 | 跨项目 | 语义 | 证据 |
| --- | --- | --- | --- |
| 正文、提交或 MR 里的 `#iid`、`<project>#iid`、完整 URL | 支持。同组用项目名加 IID，跨组用完整 URL | 给被提及的 Issue 加一条活动记录。提一次，两边都能看到。不是 Issue link 资源 | [交叉引用](https://docs.gitlab.com/user/project/issues/crosslinking_issues/) |
| `POST /projects/:id/issues/:issue_iid/links` | 支持。`target_project_id` 是目标项目的 id 或 URL-encoded path，`target_issue_iid` 是目标 IID | 双向关系。`link_type` 为 `relates_to`（默认）、`blocks`、`is_blocked_by`。调用者必须被允许更新两边，否则失败 | [创建 Issue link](https://docs.gitlab.com/api/issue_links/) |

`https://docs.gitlab.com/user/project/issues/related_issues/` 打开后只是搬家提示。替换后的 linked items 页面这次没有打开，所以不描述 GitLab UI 上的点击步骤。

## CLI 覆盖范围

| 需要的事 | gh | glab |
| --- | --- | --- |
| 替换正文 | `gh issue edit <n\|url> --body` | `glab issue update <id> --description` |
| 追加评论 | `gh issue comment <n\|url> --body` | `glab issue note <id> -m` |
| 改自己的上一条评论 | `--edit-last` | 未找到对应参数 |
| 创建时挂到另一个仓库的父 Issue | `--parent` 接受 URL | 未找到对应参数 |
| 把已有 Issue 收成子 Issue | `--add-sub-issue` 接受 URL | 未找到 |
| relates / blocks | relates 未找到子命令。blocked-by 有 `--add-blocked-by`，但是否跨仓库未写明 | 未找到子命令，需直接调用 Issue links API |

两边的 `-R` / `--repo` 都能把命令打到当前 git remote 以外的仓库，但登录身份必须看得到那个仓库。[gh issue edit](https://cli.github.com/manual/gh_issue_edit) [glab issue](https://gitlab.com/gitlab-org/cli/-/blob/main/docs/source/issue/_index.md)

## 业界工作台

| 产品 | 官方文档实际写了什么 | 没写什么 |
| --- | --- | --- |
| GitHub Copilot cloud agent | 把 Issue 指派给 Copilot 后，它收到标题、描述、当时已有的评论和附加说明，然后开 PR 并请求审查。指派之后新加的 Issue 评论不会再进入 agent；需求变更应写到它开的 PR 上。也可从 Issue 页面带着 Issue 上下文开会话 | 未找到「执行中改写 Issue 正文」 |
| Claude Code GitHub Actions | 在 Issue 或 PR 评论里 `@claude` 后，进度和结果以同一条 Issue 或 PR 上的评论出现，并在工作过程中更新这条评论。也可以把 Issue 做成 PR | 未找到改写 Issue 正文 |
| Linear GitHub 同步 | 双向同步 Issue；同步线程里的评论双向同步，线程外评论不同步。子 Issue 可以跨仓库，但另一端可能没有父 Issue | 同步不是「美化正文」 |
| Linear cloud coding agent | 把已经写清楚的 Issue 派给云端 agent，用 Claude Code 或 Codex 做成 draft PR。文档强调派发前把结果、范围和约束写清，并提到 Code Intelligence 可在派发前打磨描述 | 未找到派发后回写 GitHub/GitLab 正文 |
| GitLab Duo | Agent Platform 用 agents 和 flows 做多步工作，flows 可在 UI、CLI、IDE 跑 | 这次打开的 Duo 首页和 flows 概览没有「改写 Issue 描述再追加完成 note」 |
| Devin | 官方介绍只说它能写、跑、测代码。`/integrations/github` 返回 404 | 未找到 Issue 正文回写或完成评论的官方说明 |
| OpenAI Codex | 官方仓库 README 把产品分成 CLI、IDE、桌面和 chatgpt.com/codex。`developers.openai.com/codex` 这次返回 403 | 未找到从 Issue 开工并回写评论的官方页 |
| Cursor cloud / background agents | `cursor.com` 文档连接超时 | 未找到 |

来源：[Copilot on GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github)、[Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions)、[Linear GitHub](https://linear.app/docs/github)、[Linear cloud coding agent](https://linear.app/docs/linear-cloud-coding-agent)、[GitLab Duo](https://docs.gitlab.com/user/gitlab_duo/)、[GitLab flows](https://docs.gitlab.com/user/duo_agent_platform/flows/)、[Devin 介绍](https://docs.devin.ai/get-started/devin-intro)、[Codex README](https://github.com/openai/codex/blob/main/README.md)。

四种串法，按这些证据归类：

1. 只靠用户 prompt，让模型自己调用 `gh` / `glab`。Copilot 和 Linear 都不是这样做的。Copilot 还证明：执行开始后，Issue 上的新评论不会回到 agent。模型忘记、重复评论、或在 GitLab note 里触发 quick action，都没有宿主兜底。
2. 仓库 skill / custom agent。Copilot 可以选仓库里的 custom agent；Linear 会读仓库里的 `skills.md` 以及 Claude Code / Codex 的既有配置。这些技能提供的是实现指导，文档没有把它们写成「去更新 Issue 正文」的步骤。
3. 宿主在生命周期上编排。Claude Code GitHub Action 是工作流监听评论并回写评论；Linear Loops 是 Issue 进入 Triage 时自动派发。模型不负责记住何时调用 API。
4. 平台原生。Copilot 的「Assign to Copilot」和 Linear 的「Delegate」把 Issue 冻结成任务输入，交付物是 PR。RedWhisk 若模仿这条，美化必须发生在派发编码之前，或者作为一次独立、可跳过的写回，而不是编码 turn 的副作用。

## 软件内建议

创建路径保持现在这样：用户点创建就用原文调用 `gh` / `glab`。美化失败不能让远程 Issue 不存在。

美化放在远程 Issue 已经有编号之后的单独一步，触发点用「这次任务的分析已经产生规范正文」，不要绑在每个 turn 上。应用取模型给出的结构化正文，自己调用更新接口。不要让编码 agent 直接 `gh issue edit --body`。

写之前先读远端正文。只有它仍等于当初提交的原文时才替换。已经被人改过就放弃替换，改发一条评论说明规范稿在本地。更新接口没有冲突令牌，这是能做的保守策略。替换后的正文里保留固定章节「原始描述」，因为下一次同步会把远端正文镜像回本地描述，不保留就会丢掉原话。

规范稿建议只含四块：背景、要做什么、不做什么、怎么验证。这是产品约定，不是平台字段。

完成评论继续走现有写回：本地完成之后、`comment_done` 为假、摘要非空，才发一条。不要在美化成功时再发一遍同样的内容。幂等用已经存在的 `comment_done`，不要依赖平台。发出去的 GitLab 正文要避免以 `/` 开头的 quick action。

本地 `<issue-comment>` 仍然只写 SQLite。远程评论只是完成写回的投递。两套正文不要合成一个标签。派发 prompt 若要恢复交付摘要，按 ADR 0029 注入，并另外加上远程 Issue URL；URL 不是 skill 自己猜得出来的。

和 2026-10-31「远程正文只读」的关系：这是一次显式、单向、有前置条件的正文写回，不是打开双向字段合并。设计文档需要新决定后才能做。

## Skill / 外置工作流

可以做一个 skill，输入只有三样：当前远程 Issue URL、可选的关联 Issue URL、用户原文。允许的命令只限：

- `gh issue view` / `glab issue view` 读当前正文
- 正文仍等于原文时，`gh issue edit --body` 或 `glab issue update --description`
- 任务完成时追加一条评论

不要允许 skill 自己 `close`、改标签、改指派人。GitLab 评论会被 quick action 吃掉，skill 文本里也不要写这些命令。

和软件内方案比，skill 缺四件事：

- 派发 prompt 现在不会把远程 URL 交给模型，skill 不知道要改哪一条。
- 没有 `comment_done` 这种幂等。模型重试就会再评论一次。
- 当前 Forge 登录只保证这个项目的 remote。另一个仓库返回 404 或权限错误时，skill 没有产品级的降级。
- 同步仍会把远端正文写回本地。skill 改完正文，本地描述会在下次同步时变掉，原话若没写进正文就丢了。

因此 skill 适合在应用还没有该写回时手动试用。一旦要稳定发生，应把同一份正文和摘要交给宿主代发。

## 跨仓库关联

用户给的通常是 URL 或 `owner/repo#编号`，不是平台内部 id。

GitHub 解析 `https://github.com/{owner}/{repo}/issues/{number}`，或 `owner/repo#number`。正式父子用这个 URL 调用 `gh issue edit <新 issue 编号或 URL> --parent <父 URL>`。REST 则要先把父 URL 解析成全局 `id`，再作为 `parent_issue_id`；当前 `gh` 路径不必自己拿 id。权限是两边仓库都要 triage。当前登录看不了父仓库时，不要报成「关联成功」，改为把父 URL 写进正文，让自动链接产生 backlink。[GitHub 创建 Issue](https://docs.github.com/en/rest/issues/issues#create-an-issue) [gh issue edit](https://cli.github.com/manual/gh_issue_edit) [自动链接](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/autolinked-references-and-urls)

`relates_to` 要的是全局 `issue_id`，不是 number。文档没有写它可以跨仓库。在有明确句子之前，不要用它实现「关联另一个仓库」。blocked-by 同样未写明跨仓库，尽管 CLI 接受 URL。

GitLab 解析 `https://<host>/<group>/<project>/-/issues/<iid>`。正式关联调用 Issue links API：源是刚创建的项目和 IID，`target_project_id` 用 `<group>/<project>` 的 URL-encoded path，`target_issue_iid` 用 URL 里的 IID，`link_type` 默认 `relates_to`。用户若说的是「被那个 Issue 堵住」，用 `is_blocked_by`；「堵住那个 Issue」用 `blocks`。必须能更新两边。`glab issue` 没有 link 子命令。失败时把完整 URL 写进描述，交叉引用会在对方活动里留一条提及，但这不是 link 资源。

不要用 closing keyword 冒充关联。那会在 PR 合并进默认分支时把对方 Issue 关掉。[GitHub PR 链接](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)

认证边界就是现有项目 Forge 连接：不另存 token，用当前 `gh` / `glab` 登录。另一个仓库不在这次登录的可见范围内，就只能降级成正文引用。

## 不建议

- 创建对话框里阻塞等待模型美化。
- 每个 turn 都覆盖远程正文。
- 用编码 agent 直接改远程正文，又不先比较原文。
- 把本地交付评论和远程正文美化收成同一个 `<issue-comment>`。
- 用 Issue forms、GitHub suggestions 或 Copilot 指派来代替正文写回。前两个不改 body，第三个把 Issue 当只读输入。
- 用 `Fixes owner/repo#n` 表示「这两条 Issue 有关」。
- 在 GitLab 完成评论里夹 quick action。
- 假设 `relates_to` 或 blocked-by 已经支持跨仓库。官方页没这么写。

## 未找到

- GitHub `PATCH` Issue 或 `POST` 评论的幂等键、`If-Match`。
- GitHub relates 与 blocked-by 的跨仓库明确语句。
- Issues REST 上创建 blocked-by 的端点。
- 官方 GraphQL mutation 页，故未引用 mutation 名。
- `glab issue link`，以及 linked items 搬家后的 UI 文档。
- Copilot、Claude Code、Linear、GitLab Duo、Devin、Codex、Cursor 中任何一份「执行中把远程 Issue 正文改成背景/需求/验证」的官方说明。Cursor 文档连接超时；Codex 开发者文档返回 403；Devin 的 GitHub 集成页返回 404。
