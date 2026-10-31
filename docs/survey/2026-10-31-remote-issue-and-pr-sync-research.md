# GitHub/GitLab 远程 Issue 与 PR/MR 同步调研

> 调研日期：2026-10-31。仅采用官方文档、官方 API reference、官方 CLI 手册与官方仓库资料。
> 状态：已完成；未获一手证据的产品能力在正文标为“未找到”。

## 结论摘要

1. GitHub 的 Issues REST API 与 Pull Requests REST API 必须分开建模；Issues 列表会混入 PR，需用 `pull_request` 字段区分，且 Issue 的 `id` 与 PR 的 `id` 不是同一标识。[GitHub Issues API](https://docs.github.com/en/rest/issues/issues)
2. GitHub Issue 的增量拉取可用 `since` + `sort=updated`，仓库级 Issue 列表和 Issue 评论列表都支持 `since`；但 `sort=updated` 会因对象移动导致翻页漂移，官方建议轮询时使用稳定排序。[GitHub Issues API](https://docs.github.com/en/rest/issues/issues) [GitHub REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
3. GitHub REST 分页以 `Link` header 为准，大多数端点 `per_page` 最大 100；不要自行拼分页 URL。[GitHub pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api)
4. GitHub 认证后主限流通常为 5,000 请求/小时，未认证为 60 请求/小时/IP；GraphQL 为 5,000 points/小时/用户。次级限流还限制并发、单端点 points、内容创建与 OAuth token 申请。[GitHub REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) [GitHub GraphQL limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api)
5. 桌面端不应内置 OAuth client secret；GitHub 官方明确禁止把 client secret 放入客户端代码或用户设备代码。GitHub App 文档进一步建议桌面应用使用 device flow。[GitHub OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) [GitHub App user token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
6. GitHub OAuth web flow 当前支持 PKCE 与 native app loopback redirect；device flow 不需要 client secret。若采用 GitHub App，安装 token 默认 1 小时过期，user token 默认 8 小时过期、refresh token 6 个月过期。[GitHub OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) [GitHub installation token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)
7. GitHub PR 的合并能力不止一个 merge 接口：需同时读取 `mergeable`、`mergeable_state`、`draft`、`requested_reviewers`、reviews、review comments、checks/statuses，并支持 `merge`/`squash`/`rebase`。[GitHub Pulls API](https://docs.github.com/en/rest/pulls/pulls) [GitHub reviews](https://docs.github.com/en/rest/pulls/reviews)
8. GitHub 的 PR↔Issue 强关联来自默认分支上的 closing keyword；一个 PR 可关联多个 Issue，且 timeline 的 `cross-referenced` 事件能反查引用来源。[GitHub linking PR to issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue) [GitHub issue event types](https://docs.github.com/en/rest/using-the-rest-api/issue-event-types)
9. GitLab Issue 原生支持 `updated_after`/`updated_before`，且项目级 Issue 从 18.3 起支持 keyset pagination；keyset 必须显式传 `pagination=keyset`、`order_by`、`sort`，并只跟随 `Link rel="next"`。[GitLab Issues API](https://docs.gitlab.com/api/issues/) [GitLab REST pagination](https://docs.gitlab.com/api/rest/#pagination)
10. GitLab OAuth 支持 authorization code + PKCE，PKCE 流程无需 client secret；OAuth access token 有效 2 小时，可用 refresh token 续期。GitLab 亦提供 device authorization grant。[GitLab OAuth 2.0](https://docs.gitlab.com/api/oauth2/) [GitLab REST authentication](https://docs.gitlab.com/api/rest/authentication/)
11. GitLab MR 的 `merge_status` 已废弃，应使用 `detailed_merge_status`；合并接口支持 `auto_merge`、`sha` 校验与 `squash`，并可通过 `closes_issues` 查询合并后会关闭的 Issue。[GitLab MR API](https://docs.gitlab.com/api/merge_requests/)
12. GitLab 的评论与系统事件共用 notes 资源，`system=true` 区分系统 note；MR 代码评论还涉及 discussion 与 diff position，不能只按普通评论建模。[GitLab Notes API](https://docs.gitlab.com/api/notes/) [GitLab Discussions API](https://docs.gitlab.com/api/discussions/)
13. 桌面应用没有稳定公网入口，GitHub/GitLab 的 webhook 都要求平台主动 POST 到一个可接收的 payload/endpoint URL，因此 RedWhisk 的首要方案应是可恢复的 polling；webhook 只适合可选的自建 relay。[GitHub webhooks](https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks) [GitLab webhooks](https://docs.gitlab.com/user/project/integrations/webhooks/)
14. GitHub 与 GitLab 都能用资源自身的更新时间做增量筛选，但删除、权限撤销、重命名等“消失”状态不会由普通增量列表完整表达，必须辅以周期全量对账与软删除。[GitHub Issues API](https://docs.github.com/en/rest/issues/issues) [GitLab Issues API](https://docs.gitlab.com/api/issues/)
15. 已核产品普遍把“Issue/任务”作为输入、把“会话/工作区”作为执行单元、把 PR/MR 作为交付物；Linear 进一步把远程 GitHub Issue 作为可双向同步的镜像，而 GitLab Issue 同步未获官方支持证据。[Linear GitHub](https://linear.app/docs/github) [Linear GitLab](https://linear.app/docs/gitlab)

## A. GitHub

### A.1 Issues REST API

仓库级 Issue 列表为 `GET /repos/{owner}/{repo}/issues`，支持 `state=open|closed|all`、`labels`、`assignee`、`milestone`、`sort=created|updated|comments`、`direction=asc|desc`、`since`、`per_page`、`page`。[GitHub Issues API](https://docs.github.com/en/rest/issues/issues)

| 能力 | 官方端点/字段 | 对同步的关键含义 |
| --- | --- | --- |
| 列表 | `GET /repos/{owner}/{repo}/issues` | `state` 默认 `open`；要增量同步需显式合并 `state=all` 与 `since` |
| 单条 | `GET /repos/{owner}/{repo}/issues/{issue_number}` | 以仓库内 `number` 定位；响应同时含 `id`/`node_id` |
| 创建 | `POST /repos/{owner}/{repo}/issues` | 支持 title、body、labels、assignees、milestone |
| 更新 | `PATCH /repos/{owner}/{repo}/issues/{issue_number}` | `state` 为 `open/closed`；`state_reason` 为 `completed/not_planned/duplicate/reopened/null` |
| 标签 | Issue 响应内 `labels[]`，更新时传 labels | 更新是“整体替换”，空数组会清空 |
| 指派人 | Issue 响应内 `assignees[]`，更新时传 assignees | 更新同样是“整体替换” |
| 里程碑 | Issue 响应内 `milestone`，更新时传编号或 null | `null` 移除里程碑 |
| 评论 | `GET /repos/{owner}/{repo}/issues/{issue_number}/comments` | 评论是独立资源；仓库级评论列表支持 `since` |

官方特别说明：Issues API 把每个 PR 也视为 Issue，因此列表可能同时返回 Issue 与 PR；以 `pull_request` 键判断，且从 Issues 端点拿到的 PR `id` 是 issue id，不是 pull request id。[GitHub Issues API](https://docs.github.com/en/rest/issues/issues)

分页使用响应 `Link` header 的 `prev/next/first/last`；大多数端点 `per_page` 默认 30、最大 100，超过上限会被静默降到上限。[GitHub pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api)

增量同步的可用字段：

| 数据 | 增量参数 | 风险 |
| --- | --- | --- |
| 仓库 Issue | `since=<ISO8601>` | 只表达“最后更新晚于”，不含删除 |
| 仓库 Issue 评论 | `since=<ISO8601>` | 可单独增量；仍需处理删除与编辑 |
| PR 列表 | `sort=updated&direction=desc` | 官方 PR 列表没有 `since` 参数，只能按 updated 排序后本地截断 |
| Issue/PR 时间线 | `GET .../issues/{number}/timeline` | 含 `cross-referenced` 等事件，适合解析关联 |

GitHub 官方建议轮询时避免用 `sort=updated` 做跨页游标，因为对象更新会改变排序位置，导致已抓取页重复或漏项；应使用稳定排序，或缩小查询窗口并做全量对账。[GitHub REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)

### A.2 限流

| 认证/API | 主限流 | 备注 |
| --- | --- | --- |
| REST 未认证 | 60 请求/小时/IP | 只适合公开数据 |
| REST PAT/OAuth 用户 | 5,000 请求/小时/用户 | GitHub App/OAuth App 代用户请求也计入个人额度 |
| GitHub App installation token | 最低 5,000 请求/小时/installation | 按仓库数和组织用户数增加，上限 12,500 |
| `GITHUB_TOKEN`（Actions） | 1,000 请求/小时/仓库 | 不适用于桌面应用 |
| GraphQL 用户 | 5,000 points/小时/用户 | 按查询连接数折算 points |

次级限流包括：REST/GraphQL 合计最多 100 个并发请求；REST 单端点最多 900 points/分钟；GraphQL 单端点最多 2,000 points/分钟；内容创建通常最多 80 次/分钟、500 次/小时；OAuth token 申请最多 2,000 次/小时。[GitHub REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) [GitHub GraphQL limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api)

触发限流时返回 `403` 或 `429`：优先遵循 `retry-after`；否则若 `x-ratelimit-remaining=0`，等到 `x-ratelimit-reset`；其余情况至少等待一分钟并指数退避。[GitHub REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

### A.3 认证方式

| 方式 | 最小权限/生命周期 | 适用性 |
| --- | --- | --- |
| Classic PAT | 私有仓库通常需 `repo`；范围过宽 | 最快接入，不适合作为长期产品授权 |
| Fine-grained PAT | Issues `read/write`；Pull requests `read/write`；Metadata 只读通常随仓库访问隐含 | 适合单用户自填 token，但用户配置成本高 |
| GitHub App installation token | Issues / Pull requests `read/write`（按 App 权限与安装仓库授权）；默认 1 小时过期 | 适合组织级集成；需要 App 注册、私钥与服务端签发 |
| GitHub App user token | 默认 8 小时过期，refresh token 6 个月 | 适合“以用户身份”执行；桌面端可走 device flow |
| OAuth App | 用户授权；web flow 需 client secret，device flow 不需要 | 需要谨慎处理客户端密钥 |

依据：[PAT 权限](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)、[installation token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)、[GitHub App user token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)。

桌面应用 OAuth 的官方约束：

- web application flow 需要 `client_secret`；官方明确“不得把 client secret 放进客户端代码或运行在用户设备上的代码”。[GitHub OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- 当前 GitHub OAuth web flow 支持 PKCE，`code_challenge_method` 必须为 `S256`；但 token 交换仍要求 `client_secret`（OAuth App 场景）。[GitHub OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- GitHub 支持 native desktop app 的 loopback redirect，推荐 `127.0.0.1` 或 `::1`，不要用 `localhost`；回调的 host/port 规则见官方文档。[GitHub OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- GitHub App 文档直接写明：CLI、树莓派和桌面应用应使用 device flow；device flow 只传 client ID，不需要 client secret。[GitHub App user token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)

因此 RedWhisk 的 GitHub 默认建议是 **GitHub App + device flow + user token 自动刷新**；若用 OAuth App，则不要分发 client secret，优先 device flow。loopback + PKCE 只有在后端代为兑换 token、或明确接受“公共客户端”安全模型时才成立。

### A.4 Pull Requests REST API

| 能力 | 官方端点/字段 |
| --- | --- |
| 列表 | `GET /repos/{owner}/{repo}/pulls`，`state=open|closed|all` |
| 详情 | `GET /repos/{owner}/{repo}/pulls/{pull_number}` |
| 文件 | `GET .../pulls/{pull_number}/files`，最多返回 3000 个文件，默认 30/页 |
| 提交 | `GET .../pulls/{pull_number}/commits`，最多 250 个 commit |
| Reviews | `GET .../pulls/{pull_number}/reviews`，状态含 `APPROVED/CHANGES_REQUESTED/COMMENTED/PENDING/DISMISSED` |
| Review comments | `GET .../pulls/{pull_number}/comments`，含 path/line/side/in_reply_to_id |
| Checks | check suites/check runs 可读；写 check run 仅 GitHub App 可用 |
| Commit statuses | `GET /repos/{owner}/{repo}/commits/{ref}/statuses`，state 为 `error/failure/pending/success` |
| 合并 | `PUT .../pulls/{pull_number}/merge`，`merge_method=merge|squash|rebase` |

依据：[Pulls API](https://docs.github.com/en/rest/pulls/pulls)、[Reviews](https://docs.github.com/en/rest/pulls/reviews)、[Review comments](https://docs.github.com/en/rest/pulls/comments)、[Check runs](https://docs.github.com/en/rest/checks/runs)、[Commit statuses](https://docs.github.com/en/rest/commits/statuses)。

补充语义：

- `draft` 表示草稿；`requested_reviewers` 与 `requested_teams` 在 PR 响应中。
- `mergeable` 可能是 `true/false/null`；`null` 表示 GitHub 正在后台计算，不能当成“不可合并”。[Pulls API](https://docs.github.com/en/rest/pulls/pulls)
- `mergeable_state` 是预计算状态，和 branch protection/rules 相关；UI 必须结合 `mergeable` 与合并接口的实际错误处理。
- review 是“带状态的评论组”，review comment 是文件/行级评论，两者不是同一资源。[GitHub Reviews](https://docs.github.com/en/rest/pulls/reviews)
- checks 与 commit statuses 是两套 CI 表达，PR 展示层需要合并读取，不能只取其中一套。

### A.5 PR 与 Issue 关联

GitHub 的 closing keyword 只在 PR 指向仓库默认分支时生效；支持 `close/closes/closed`、`fix/fixes/fixed`、`resolve/resolves/resolved`。同一 PR 可写多个 Issue，如 `Resolves #10, resolves #123, resolves octo-org/octo-repo#100`。[GitHub linking PR to issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)

timeline 的 `cross-referenced` 事件表示“该 Issue/PR 被另一个 Issue/PR 引用”，事件带 `source.issue`，若 source 是 PR，则 `source.issue.pull_request` 存在。[GitHub issue event types](https://docs.github.com/en/rest/using-the-rest-api/issue-event-types)

### A.6 Webhook 与 polling

GitHub webhook 的模型是配置一个 payload URL，由 GitHub 主动发送 HTTP POST；因此没有公网可达入口的桌面应用不能直接作为 webhook 接收端。[GitHub webhooks](https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks)

官方在 REST 最佳实践中明确：能订阅 webhook 就不要轮询；不能使用 webhook 时，应按固定频率、串行、条件请求轮询。[GitHub REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)

条件请求要点：

- 保存 `etag`，下次带 `if-none-match`；或保存 `last-modified`，带 `if-modified-since`。
- 正确认证的 `304 Not Modified` 不计入 REST 主限流。
- 同一个轮询请求必须保持稳定参数，否则 ETag 会变化。
- 不要并发请求；写操作之间至少间隔 1 秒。[GitHub REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)

### A.7 GitHub CLI 覆盖

`gh issue` 覆盖 `create/list/view/edit/close/reopen/comment/delete/transfer/develop/pin/lock/status` 等；`gh issue list --json` 可输出 `assignees/author/body/closed/closedAt/closedByPullRequestsReferences/comments/createdAt/id/isPinned/labels/milestone/number/projectItems/reactionGroups/state/stateReason/title/updatedAt/url`。[gh issue](https://cli.github.com/manual/gh_issue) [gh issue list](https://cli.github.com/manual/gh_issue_list)

`gh pr` 覆盖 `create/list/view/edit/close/reopen/comment/review/merge/checks/diff/checkout/ready/update-branch/revert/status` 等；`gh pr view --json` 字段包含 `additions/assignees/author/autoMergeRequest/baseRefName/body/changedFiles/closingIssuesReferences/comments/commits/createdAt/deletions/files/headRefName/isDraft/labels/latestReviews/mergeCommit/mergeStateStatus/mergeable/mergedAt/mergedBy/milestone/number/reviewDecision/reviewRequests/reviews/state/statusCheckRollup/title/updatedAt/url`。[gh pr](https://cli.github.com/manual/gh_pr) [gh pr view](https://cli.github.com/manual/gh_pr_view)

结论：`gh` 可覆盖常见读写与 CI/合并状态，但字段和命令受 CLI 版本影响；作为产品数据源会把“CLI 输出兼容性”引入核心链路。

## B. GitLab

### B.1 Issues API

GitLab Issue 列表支持 instance/group/project 三个层级；项目级端点为 `GET /projects/:id/issues`，支持 `state=opened|closed|all`、`labels`、`assignee_ids`、`assignee_username`、`milestone_id`、`order_by`、`sort`、`updated_after`、`updated_before`、`per_page`、`page`/`cursor`。[GitLab Issues API](https://docs.gitlab.com/api/issues/)

| 能力 | 官方端点/字段 | 同步含义 |
| --- | --- | --- |
| 列表 | `GET /projects/:id/issues` | 默认 20 条；`state` 默认 `opened` |
| 单条 | `GET /projects/:id/issues/:issue_iid` | 项目内用 `iid`；全局用 `id` |
| 创建 | `POST /projects/:id/issues` | 支持 title/description/labels/assignee_ids/milestone_id |
| 更新 | `PUT /projects/:id/issues/:issue_iid` | `state_event=close|reopen` |
| 标签 | `labels`、`add_labels`、`remove_labels` | 与 GitHub 的整体替换语义不同 |
| 指派人 | `assignee_ids` | 多指派人能力受版本/套餐限制 |
| 里程碑 | `milestone_id` | 传 0 或空值可移除 |
| 评论 | `POST/GET /projects/:id/issues/:issue_iid/notes` | 普通评论与系统 note 混在同一列表 |

`updated_after` 确实存在，且项目/群组/全局 Issue 列表均支持；这是 GitLab 相对 GitHub Issues 更直接的增量入口。[GitLab Issues API](https://docs.gitlab.com/api/issues/)

Issue notes 列表支持 `order_by=created_at|updated_at` 与 `sort`，但官方列出的过滤参数中没有 `updated_after`；评论增量不能照搬 Issue 的增量方式，需按更新时间排序后维护水位，或做周期全量对账。[GitLab Notes API](https://docs.gitlab.com/api/notes/)

### B.2 分页与增量

GitLab 默认 offset pagination，`per_page` 默认 20、最大 100，响应带 `Link` header；GitLab.com 的部分分页 header 可能不返回。[GitLab REST pagination](https://docs.gitlab.com/api/rest/#pagination)

项目级 Issue 从 GitLab 18.3 起支持 keyset pagination。官方要求：

```text
GET /projects/:id/issues?pagination=keyset&order_by=id&sort=asc&per_page=100
```

随后只跟随响应 `Link: <...>; rel="next"`，下一页会带 `id_after` 或 `cursor`；不要自行构造。keyset 的 `order_by` 与 `sort` 都是必填。[GitLab REST pagination](https://docs.gitlab.com/api/rest/#keyset-based-pagination) [GitLab Issues API](https://docs.gitlab.com/api/issues/)

重要版本边界：GitLab 官方 keyset 支持表中只列出 **Project issues**；不能假定 group/instance Issue 列表也已支持。18.3 之前的实例应回退 offset 分页，并用 `updated_after` 缩小窗口。

### B.3 认证

| 方式 | 权限/生命周期 | 适用性 |
| --- | --- | --- |
| PAT `api` | 读写 API | 可覆盖 Issue/MR；权限仍可能受角色限制 |
| PAT `read_api` | 主要允许 GET/HEAD | 只读同步可用，不能写回 |
| OAuth authorization code + PKCE | 无需 client secret；access token 2 小时 | 最适合桌面应用 |
| Device authorization grant | GitLab 17.9 GA | 无浏览器/输入受限设备可用 |

依据：[GitLab PAT](https://docs.gitlab.com/user/profile/personal_access_tokens/)、[GitLab OAuth 2.0](https://docs.gitlab.com/api/oauth2/)、[GitLab REST authentication](https://docs.gitlab.com/api/rest/authentication/)。

GitLab PAT 默认 365 天过期；管理员可调整最大生命周期。OAuth token 过期后可用 refresh token 续期；官方明确 PKCE 让 native/mobile client 不需要持有 client secret。[GitLab PAT](https://docs.gitlab.com/user/profile/personal_access_tokens/) [GitLab OAuth 2.0](https://docs.gitlab.com/api/oauth2/)

### B.4 Merge Requests API

| 能力 | 官方端点/字段 |
| --- | --- |
| 列表 | `GET /projects/:id/merge_requests` |
| 详情 | `GET /projects/:id/merge_requests/:merge_request_iid` |
| changes | `GET .../changes` |
| diffs | `GET .../diffs`，支持分页、`unidiff` |
| commits | `GET .../commits` |
| notes | `GET .../notes` |
| discussions | `GET .../discussions` |
| approvals | `GET .../approvals`、`GET .../approval_state` |
| pipelines | `GET .../pipelines`；详情含 `head_pipeline` |
| 合并 | `PUT .../merge`，支持 `auto_merge`、`sha`、`squash` |
| 关联 Issue | `GET .../closes_issues` |

依据：[GitLab MR API](https://docs.gitlab.com/api/merge_requests/)、[Discussions](https://docs.gitlab.com/api/discussions/)、[Approvals](https://docs.gitlab.com/api/merge_request_approvals/)、[Pipelines](https://docs.gitlab.com/api/pipelines/)。

关键语义：

- `merge_status` 自 GitLab 15.6 起弃用，改用 `detailed_merge_status`；可能值包括 `mergeable`、`not_approved`、`draft_status`、`discussions_not_resolved`、`commits_status` 等。[GitLab MR API](https://docs.gitlab.com/api/merge_requests/)
- `draft` 是布尔字段；MR 标题中的 Draft/WIP 语义在展示层仍需兼容。
- 合并接口的 `sha` 可防止合并未审核的新提交；若实例/群组要求 SHA，缺失会返回 400。[GitLab MR API](https://docs.gitlab.com/api/merge_requests/)
- `squash` 受项目设置覆盖；读取时应同时看 `squash_on_merge`。[GitLab MR API](https://docs.gitlab.com/api/merge_requests/)
- approval 规则细节在 CE 与 EE/Premium 间不同；CE 只稳定返回 `approved`、`approved_by`、`user_can_approve` 等基础字段，完整规则需按套餐处理。[GitLab approvals](https://docs.gitlab.com/api/merge_request_approvals/)

### B.5 Issue↔MR 关联

GitLab 使用 closing pattern，可识别本地 Issue、跨项目 Issue、完整 URL 与 work item URL；关键词包括 close/fix/resolve/implement 的多种时态。一个 MR 描述可写 `Closes #4, #6, Related to #5`，合并后关闭 #4/#6，#5 仅标记 related。[GitLab managing issues](https://docs.gitlab.com/user/project/issues/managing_issues/)

除 closing pattern 外，也可通过 GraphQL 或 MR 的 Work items 组件手工关联；自动关闭仅对默认分支生效，且合并者权限会被校验。[GitLab managing issues](https://docs.gitlab.com/user/project/issues/managing_issues/)

### B.6 Rate limits 与 polling

| GitLab.com 当前限流 | 数值 |
| --- | --- |
| 已认证 API 请求/用户 | 2,000 次/分钟 |
| 未认证请求/IP | 500 次/分钟 |
| 已认证非 API HTTP/用户 | 1,000 次/分钟 |
| 已认证 Git HTTPS/用户 | 10,000 次/分钟 |

GitLab 官方另列出按套餐分层的拟议限流（Free/Premium/Ultimate 的每小时与每分钟额度），但该节明确写明“尚未生效”，当前仍以现有 2,000/500 等额度为准。触发限流返回 `429`，应遵循 `Retry-After`。[GitLab.com rate limits](https://docs.gitlab.com/user/gitlab_com/rate_limits/)

GitLab 的 offset 分页在结果超过 10,000 条时可能省略部分分页 header，因此不能依赖本地计算总页数。[GitLab.com rate limits](https://docs.gitlab.com/user/gitlab_com/rate_limits/)

GitLab 官方 REST 文档未记录通用 ETag / `If-None-Match` 语义；未找到可类比 GitHub“304 不计主限流”的官方承诺。实现不能默认 GitLab 支持条件请求，必须按 host/版本探测并以实际响应为准。[GitLab REST API](https://docs.gitlab.com/api/rest/)

GitLab webhook 同样要求配置接收端 URL，由 GitLab 主动投递；桌面端无公网入口时不能直接接收。[GitLab webhooks](https://docs.gitlab.com/user/project/integrations/webhooks/)

轮询建议：优先 webhook；无法 webhook 时使用 `updated_after` 缩小窗口、固定页大小、串行请求并按 `429`/`Retry-After` 退避。GitLab Self-Managed 还需读取实例管理员配置的限流。

### B.7 GitLab CLI 覆盖

`glab issue` 覆盖 `list/view/create/update/close/reopen/note/delete/subscribe/unsubscribe/board`；`glab mr` 覆盖 `list/view/create/update/close/reopen/merge/approve/revoke/note/diff/checkout/rebase/for/issues/approvers/todo` 等。[glab issue 官方手册](https://gitlab.com/gitlab-org/cli/-/blob/main/docs/source/issue/_index.md) [glab mr 官方手册](https://gitlab.com/gitlab-org/cli/-/blob/main/docs/source/mr/_index.md)

`glab mr issues` 可直接查询 MR 合并时会关闭的 Issue，`glab mr for` 可从 Issue 创建 MR；这两项适合作为产品动作的参考，但不应成为数据同步的唯一来源。[glab mr issues](https://gitlab.com/gitlab-org/cli/-/blob/main/docs/source/mr/issues.md)

## C. 同类产品做法

1. **Linear 的 GitHub 集成是“Issue 镜像 + PR 附件”**。可单向或双向同步 title、description、status、assignee、labels、sub-issues、comments、priority；评论只同步 synced thread。PR 不替代 Issue，而作为附件驱动状态自动化，一个 Issue 可挂多个 PR。[Linear GitHub](https://linear.app/docs/github)

2. **Linear 的 GitLab 集成只覆盖 MR，不覆盖 GitLab Issue 同步**。官方 FAQ 明确不支持导入或同步 GitLab Issues；MR 只通过标题/描述中的 magic word 关联，并回写 linkback 与状态。[Linear GitLab](https://linear.app/docs/gitlab)

3. **GitHub Copilot 把“分配 Issue”定义为一次快照式启动**。分配时读取 Issue 标题、正文和当时评论，立即创建 draft PR；之后的 Issue 评论不会进入会话，后续上下文应写到 PR。Copilot Workspace 当前独立官方文档：未找到。[Copilot kick off](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/kick-off-a-task)

4. **OpenAI Codex 把任务与 PR 分层**。官方模型 `TaskResponse` 持有多条 `external_pull_requests`，每条 PR 绑定 `assistant_turn_id`；官方 CLI 创建任务只暴露 prompt、环境与分支。从 GitHub/GitLab Issue 创建 Codex 任务的官方说明：未找到。[Codex task model](https://github.com/openai/codex/blob/main/codex-rs/codex-backend-openapi-models/src/models/task_response.rs) [Codex PR model](https://github.com/openai/codex/blob/main/codex-rs/codex-backend-openapi-models/src/models/external_pull_request_response.rs)

5. **Cursor 以 agent run 为中心，PR 是交付物**。可从 Slack、Linear、GitHub Issue/PR 评论、API 或 Web/IDE 启动；Cloud Agent 产出 merge-ready PR，一个多仓任务可分别向多个仓库开 PR。[Cursor Cloud Agents](https://cursor.com/docs/cloud-agent)

6. **Devin 的工单入口是 Linear/Jira，GitHub 入口是 PR 评论**。Linear/Jira 可分配或 @mention 启动 session，并回写 PR/session 链接；GitHub 官方明确 `/devin` 在 Issue 评论被忽略，只有开放 PR 可用。[Devin Linear](https://docs.devin.ai/integrations/linear) [Devin Jira](https://docs.devin.ai/integrations/jira) [Devin GitHub](https://docs.devin.ai/integrations/gh)

7. **OpenHands 已实现完整的 Issue→PR 自动化，SWE-agent 只承诺补丁**。OpenHands 支持 GitHub/GitLab/Jira/Linear Issue，默认 15 分钟轮询、持久去重、回写进度与 PR；SWE-agent 官方教程是 issue URL → patch，未找到自动开 PR 的官方承诺。[OpenHands Issue to PR](https://docs.openhands.dev/openhands/usage/agent-canvas/prebuilt/issue-to-pr) [SWE-agent](https://swe-agent.com/latest/usage/hello_world/)

8. **本地工作台与桌面审阅工具的边界**。Vibe Kanban 是本地 Issue → workspace → PR，支持一个 Issue 多 workspace，但未找到远程 Issue 同步；GitKraken、VS Code、JetBrains 均支持应用内创建/审阅/合并 PR，边界受 provider 权限与仓库规则约束。Crystal 已由 Nimbalyst 替代，Terragon 已关停，二者未找到 Issue/PR 同步证据。[Vibe Kanban](https://vibekanban.com/docs/issue-management) [GitKraken](https://help.gitkraken.com/gitkraken-desktop/pull-requests/) [VS Code](https://code.visualstudio.com/docs/sourcecontrol/github) [JetBrains](https://www.jetbrains.com/help/idea/create-and-merge-github-pull-requests.html) [Crystal](https://github.com/stravu/crystal) [Terragon](https://www.terragonlabs.com/)

未找到或无法核实：

- Conductor 官方产品文档：站点返回 403，未获一手内容。
- Notion、Height 对 GitHub/GitLab Issue 的本地/远程混合同步：未找到。

## D. 数据模型与同步语义

### D.1 远程对象缓存

以下字段是最低安全集，具体以各 API 返回为准：

| 字段 | GitHub | GitLab | 用途 |
| --- | --- | --- | --- |
| 平台对象 ID | `id` | `id` | 稳定内部主键 |
| 人类编号 | `number` | `iid` | URL/用户输入定位 |
| 全局节点 ID | `node_id` | 无同名等价物 | GraphQL/跨系统映射 |
| 更新时间 | `updated_at` | `updated_at` | 增量筛选与冲突检测 |
| ETag | 响应 `etag` | 官方 REST 文档未记录通用 ETag | 条件 GET；GitLab 需按版本探测 |
| 状态 | `state` + `state_reason` | `state` | 状态映射 |
| 仓库/项目 | `repository_url` | `project_id` | 作用域隔离 |

GitHub 官方明确不要解析响应中的 URL 来猜 ID，应直接读 `id`/`number` 等字段。[GitHub REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)

### D.2 冲突与双向写回

官方 API 只提供资源语义，不定义产品冲突策略。可据官方语义确定：

- GitHub Issue 更新中的 `labels`、`assignees` 是整体替换；GitLab 则同时提供整体替换与 add/remove。双向同步时必须记录字段级基线，否则会把对方新增值覆盖掉。[GitHub Issues API](https://docs.github.com/en/rest/issues/issues) [GitLab Issues API](https://docs.gitlab.com/api/issues/)
- GitLab MR 合并可用 `sha` 做乐观并发校验；GitHub 合并接口也可传 head SHA，防止合并未审阅提交。[GitLab MR API](https://docs.gitlab.com/api/merge_requests/) [GitHub Pulls API](https://docs.github.com/en/rest/pulls/pulls)
- `updated_at` 冲突只能判断“对方变过”，不能判断字段级冲突；需要保存最后同步快照或字段版本。
- 删除/无权限在 GitHub 可能表现为 404；官方提醒不能把 404 一律当“不存在”。[GitHub REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
- GitHub ETag 应按“端点 + 查询参数 + 身份”保存，而不是按对象保存；同一对象在不同列表/过滤条件下有不同表示。
- GitLab Self-Managed 的 closing pattern 允许管理员配置，不能硬编码默认正则；自动关联结果应以 MR 的 `closes_issues` 为准。[GitLab closing pattern](https://docs.gitlab.com/user/project/issues/managing_issues/)

### D.3 评论与时间线

GitHub：

- Issue comments 是独立可分页资源，支持 `since`。[GitHub issue comments](https://docs.github.com/en/rest/issues/comments)
- timeline events 是另一资源，包含 assigned/closed/connected/cross-referenced 等系统事件。[GitHub timeline](https://docs.github.com/en/rest/issues/timeline)
- 因此“用户评论”和“系统事件”必须分表或至少用 `kind` 强区分。

GitLab：

- notes 同时返回用户评论和系统 note，以 `system` 布尔值区分。[GitLab Notes API](https://docs.gitlab.com/api/notes/)
- MR 还有 discussion/thread 与 diff note；thread 可 resolvable/resolved，普通 note 不具备同等语义。[GitLab Discussions API](https://docs.gitlab.com/api/discussions/)
- 系统 note 不是普通评论，不能回复系统 note。[GitLab Discussions API](https://docs.gitlab.com/api/discussions/)

## E. RedWhisk 自研 HTTP 客户端的最低能力与风险

### E.1 最低能力清单

| 能力 | 必须实现 |
| --- | --- |
| 认证 | GitHub App device flow / GitLab OAuth PKCE；PAT 仅作兜底 |
| Token 存储 | macOS Keychain / Windows Credential Manager / Linux Secret Service；不得明文 SQLite |
| 刷新 | 过期前刷新；refresh 失败进入重新授权态；并发刷新互斥 |
| Host/TLS | 可配置 GitHub Enterprise Server / GitLab Self-Managed base URL；支持代理与自定义 CA；限制 redirect 目标 |
| API 版本 | GitHub 固定 `Accept` 与 `X-GitHub-Api-Version`；GitLab 固定 `/api/v4` 并做版本能力探测 |
| 分页 | GitHub `Link`；GitLab offset `Link` 与 keyset `Link`；禁止手拼 |
| 增量 | GitHub Issue `since`、评论 `since`；GitLab `updated_after`；PR/MR 按 updated 排序 |
| 条件请求 | ETag/If-None-Match、304 处理；GitLab 支持范围需按版本探测 |
| 限流 | 读取 rate limit headers；`retry-after`/reset/指数退避；串行写请求 |
| 错误映射 | 401 重新认证、403 权限/限流、404 不存在/不可见、409 冲突、422 校验失败、5xx 重试 |
| 关联 | closing keyword 解析 + timeline/`closes_issues` 权威校验；不以文本解析作为唯一事实 |
| 对账 | 周期全量扫描，软删除/恢复，检测权限撤销与仓库迁移 |

### E.2 风险点

1. **认证产品化成本**：GitHub App 需要注册、私钥与 installation token 签发；GitLab OAuth 需要应用注册。若 RedWhisk 不分发自有 OAuth App，用户自建 App 的配置成本会很高。
2. **企业自建 host**：GitHub Enterprise Server 与 GitLab Self-Managed 的版本差异大；keyset、device flow、字段可用性都必须做 capability detection。
3. **限流与多仓库扇出**：一个会话可能关联多个仓库；按仓库串行轮询仍会放大请求量，必须有全局调度与预算。
4. **删除不可见**：增量接口只给“更新”，不给“删除”；需要全量对账与软删除，不能直接把本地缺失当删除。
5. **字段覆盖**：GitHub labels/assignees 整体替换，GitLab 支持增量增删；统一抽象若只做“set”会破坏 GitLab 语义。
6. **评论模型不等价**：GitHub review comment 与 GitLab diff discussion 的定位、回复、解决状态不同；统一展示可以，统一写入接口不合适。
7. **PR/MR 合并不可完全前置判断**：`mergeable` 可能为 null，`detailed_merge_status` 可能异步变化；最终必须以合并接口返回为准。
8. **CLI 依赖风险**：`gh`/`glab` 版本、认证状态、JSON 字段与退出码都会变化；自研 HTTP 可降低外部进程依赖，但要自行承担上述全部能力。
9. **GitHub App 私钥不能下发桌面端**：installation token 需要可信后端签发；桌面端只应持有 user token/refresh token，或走 device flow。
10. **自定义 host 是攻击面**：用户可填 base URL，必须校验 scheme/host、限制跨域 redirect、防 SSRF 与错误证书绕过；所有日志需脱敏 token。
11. **远程 Issue 内容不可信**：Issue 标题/正文/评论可能含 prompt injection；送进 Agent 前必须与系统指令隔离，并保留人工确认。
12. **GitLab 条件请求不确定**：官方未记录通用 ETag 语义，不能把 GitHub 的 304 优化直接复制到 GitLab。

## 对 RedWhisk 的直接含义

1. 远程 Issue 与 PR/MR 应建立独立实体，PR/MR 不进入本地 Issue 状态机；通过关联表表达 `issue ↔ PR/MR`，通过会话关联表表达 `issue/task ↔ agent session`。
2. 同步层先做只读镜像与显式写回，不做无感双向同步；字段级基线与冲突提示是必需能力。
3. 桌面端默认 device flow（GitHub）与 OAuth PKCE（GitLab）；token 进系统 Keychain，不入 SQLite。
4. 轮询必须支持 GitHub ETag、GitLab 能力探测、增量过滤、分页 Link、限流退避与周期全量对账；webhook 仅作为可选云端增强。
5. GitHub 需要同时读取 Issues、PR、timeline、checks、statuses；GitLab 需要同时读取 Issues、MR、notes、discussions、approvals、pipelines。
6. 评论展示应区分“用户评论”与“系统事件”；GitLab `system`、GitHub timeline event 是产品层的核心边界。
7. PR/MR 关联 Issue 的权威来源应是 GitHub timeline `cross-referenced` 与 GitLab `closes_issues`；closing keyword 只用于解释，不作为唯一同步依据。
8. 自研 reqwest 客户端的成本主要在认证、企业 host 兼容、限流调度、删除对账与评论模型，而不是 HTTP 请求本身。
