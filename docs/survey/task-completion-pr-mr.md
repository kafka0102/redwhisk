# 任务完成后的合入与 PR/MR 调研

调研日期：2026-10-25。只使用一手来源。未证实写「未找到」。

## 结论

1. GitHub PR 的本地前提是「已认证的 API 客户端 + 已推送的分支」，不是再装一套 Git。官方推荐路径是 GitHub CLI `gh`。
2. GitLab MR 对称物是 `glab`。官方没有「`gh` 也能操作 GitLab」的文档。
3. 丝滑创建路径：应用先自己 push，再非交互创建 PR/MR。
4. 同类产品把「本地合入」和「开 PR」当成两条工作流。编码 Agent 把 PR 当云端任务交付物。
5. 创建、查看检查、评论、整体批准、合并都可以不打开浏览器；登录、SSO、行内审阅仍会。
6. RedWhisk 建议：项目只存默认完成动作，完成弹窗可覆盖；检测宿主，不让用户手选 GitHub/GitLab。

## 1. GitHub：本地环境与创建 PR

### 1.1 官方推荐客户端

GitHub CLI `gh` 是命令行操作 GitHub 的官方工具，能从终端管理 issues、PRs、检查状态等（https://cli.github.com/manual/）。

安装渠道由官方手册列出：Windows 用 WinGet / scoop / Chocolatey；macOS 用 Homebrew / MacPorts / Conda；Linux 用 Debian/Ubuntu apt、Fedora dnf、官方 tarball 等（https://github.com/cli/cli#installation）。

认证：

- 交互：`gh auth login`。可指定 hostname（github.com 或 GitHub Enterprise）、协议（HTTPS 推荐，或 SSH）、认证方式（浏览器登录推荐，或 PAT）。浏览器流程走 OAuth app 授权（https://cli.github.com/manual/gh_auth_login）。
- 脚本：`--with-token` 从 stdin 读 classic PAT（https://cli.github.com/manual/gh_auth_login）。
- 状态：`gh auth status` 显示各主机的登录账号；`--hostname` 只查一台；`--show-token` 显示 token（https://cli.github.com/manual/gh_auth_status）。
- 环境变量：`GH_TOKEN`、`GITHUB_TOKEN`（备用）、`GH_ENTERPRISE_TOKEN`、`GITHUB_ENTERPRISE_TOKEN`。同时存在时 `GH_*` 优先于 `GITHUB_*`（https://cli.github.com/manual/gh_help_environment）。
- 企业主机：`GH_HOST` 指定 GitHub Enterprise hostname。若设了 `GH_HOST` 却没有对应 token，GitHub.com 的 token 不会回退使用（https://cli.github.com/manual/gh_help_environment）。

`gh auth refresh` 说明：gh 创建的 token 默认最小 scope 集合是 `repo`、`read:org`、`gist`，不能从已有 token 里删掉（https://cli.github.com/manual/gh_auth_refresh）。官方 `cli/cli` 维护者在 #9461 写明：classic PAT 最小 scope 为 `repo`、`read:org`、`gist`；fine-grained PAT 至少需要 Pull requests Read and write、Contents Read and write，以及按场景追加 Metadata / Workflows / Administration 等（https://github.com/cli/cli/issues/9461）。

### 1.2 仓库如何解析

多数 `gh` 命令在 git 仓库内运行，从 local git remotes 解析 GitHub 仓库（https://cli.github.com/manual/gh_help_environment）。

- `GH_REPO` 可覆盖，格式 `OWNER/REPO` 或完整 URL（https://cli.github.com/manual/gh_help_environment）。
- `gh pr create --repo` 可显式指定 `OWNER/REPO` 或 URL（https://cli.github.com/manual/gh_pr_create）。
- SSH 与 HTTPS 都可用于 `gh auth login` 的 git 协议；官方推荐 HTTPS（https://cli.github.com/manual/gh_auth_login）。

未找到「`gh` 在多个 remote 时精确选哪一个」的单独手册页。实践上应显式传 `--repo`，或保证 `origin` 指向目标宿主。

### 1.3 `gh pr create` 关键参数

来源：https://cli.github.com/manual/gh_pr_create

| 参数 | 作用 |
| --- | --- |
| `--base <branch>` | 要合入的分支。默认是仓库的默认分支 |
| `--head <branch>` | 含改动的分支。`[HOST/]OWNER:` 前缀表示跨 fork。使用 `--head` 会显式跳过 fork 或 push |
| `--title` / `--body` / `--body-file` | 标题与正文 |
| `--draft` | 草稿 PR |
| `--fill` | 用 commit info 填标题正文（单 commit 用信息，多 commit 用 branch 名 + log） |
| `--fill-verbose` / `--fill-first` | fill 变体 |
| `--template` | 指定 PR 模板 |
| `--editor` | 用配置的 git 编辑器改标题正文 |
| `--web` | 在浏览器打开比较视图 |
| `--repo` | 目标仓库 |
| `--reviewer` / `--assignee` / `--label` / `--milestone` / `--project` | 元数据 |

行为要点：

- 当前分支相对远端未完全推送时，会提示选择 push 目的地（https://cli.github.com/manual/gh_pr_create）。非交互场景必须先 push，或传 `--head` 跳过 push。
- head 在别人的仓库：`--head USERNAME:BRANCH`（https://cli.github.com/manual/gh_pr_create）。
- 同源仓库：`--head BRANCH`。

### 1.4 不用 `gh`：REST

创建 PR：`POST /repos/{owner}/{repo}/pulls`，JSON 字段 `title`、`head`、`base`，可选 `body`、`draft`、`maintainer_can_modify`。fine-grained token 需要 Pull requests 仓库权限（write）（https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#create-a-pull-request）。

`head` 跨 fork 时用 `username:branch`。GitHub 建议 `head` 与 `base` 不同；相同会 422。同一 `head` 已有打开的 PR 时也会失败（同上）。

Git 凭据（HTTPS credential helper / SSH key）只能 `git push`，不能创建 PR。PR 是宿主 API 对象，不是 git 引用。

未找到官方「禁止用 GitHub App 创建用户 PR」的禁令；GitHub App 安装 token 可以按安装权限调同一 REST。RedWhisk 若不以 GitHub App 安装到用户仓库，这条路径不适用。

### 1.5 开 PR 前的 git 前提

官方「创建 PR」文档：在 GitHub 上开 PR 前，改动要在与 base 不同的分支上，并 push 到 GitHub（https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-with-pull-requests/creating-a-pull-request）。

因此本地检测至少包括：

1. `git remote -v` 能解析出 github.com 或 GHES host。
2. `gh` 在 PATH，或应用自带 HTTP 客户端 + token。
3. `gh auth status`（或 REST `GET /user`）成功。
4. 工作分支已 push，且 ahead 的提交在远端。
5. `base` 与 `head` 不同。
6. 该 head 尚无打开的 PR（先 `GET` 列表或 `gh pr view`）。

## 2. GitLab：本地环境与创建 MR

### 2.1 官方 CLI

GitLab CLI `glab` 是 GitLab 官方命令行工具（https://docs.gitlab.com/cli/）。

认证（https://docs.gitlab.com/cli/authentication/）：

- 交互：`glab auth login`。可 `--hostname gitlab.example.com` 连自建实例。
- 环境变量：`GITLAB_TOKEN` / `GITLAB_ACCESS_TOKEN`；`GITLAB_HOST` / `GITLAB_URI` 指定 GitLab 源。

创建 MR（https://docs.gitlab.com/cli/mr/create/）：

| 参数 | 作用 |
| --- | --- |
| `--source-branch` / `-s` | 源分支；默认当前分支 |
| `--target-branch` / `-b` | 目标分支 |
| `--title` / `-t`、`--description` / `-d`、`--description-file` | 标题正文 |
| `--draft` / `--wip` | 草稿 |
| `--fill` / `-f` | 用 commit info 填 |
| `--fill-commit-body` | fill 时带上 commit body |
| `--yes` / `-y` | 跳过确认 |
| `--push` / `--no-push` | 创建前是否 push |
| `--web` / `-w` | 在浏览器打开 |
| `--create-source-branch` | 目标分支不存在时创建 |
| `--remove-source-branch` | 接受后删源分支 |
| `--squash-before-merge` | 合并前 squash |
| `--reviewer` / `--assignee` / `--label` / `--milestone` | 元数据 |

`glab` 文档写明：自动填充 MR 标题、描述、fork、源分支时，最多检查 10 个 commit（https://docs.gitlab.com/cli/mr/create/）。

未找到与 `gh auth status` 对等的单独手册页标题；`glab auth status` 在 CLI 中存在，但本调研未打开对应 man 页，标为「命令存在、手册页未核」。

### 2.2 不用 `glab`：REST

`POST /projects/:id/merge_requests`，必填 `source_branch`、`target_branch`、`title`。可选 `description`、`assignee_id`、`reviewer_ids`、`labels`、`milestone_id`、`remove_source_branch`、`squash`、`draft` 等（https://docs.gitlab.com/api/merge_requests/#create-mr）。

Personal Access Token 的具体 scope 未在本页列出。未找到「创建 MR 最小 PAT scope」的单独官方一句结论；实现时应查 GitLab PAT 权限表，而不是猜 `api`。

### 2.3 与 `gh` 的差异（仅官方已写明的）

- `glab` 原生支持 `--hostname` / `GITLAB_HOST` 指向自建 GitLab；`gh` 用 `GH_HOST` 指向 GHES。
- `glab mr create --yes --push` 把确认和 push 做成 flag；`gh pr create` 未推送时走交互 prompt，非交互要用事先 push 或 `--head`。
- 官方没有 `gh` 操作 GitLab 的文档。

## 3. 丝滑提交的命令路径

### 3.1 GitHub 非交互

```text
git push -u origin HEAD
gh pr create --repo OWNER/REPO --base <base> --head <branch> \
  --title "..." --body-file <file> [--draft]
```

或先 fill：

```text
gh pr create --base <base> --head <branch> --fill --draft
```

标题正文来源优先级（手册语义，不是源码）：显式 `--title`/`--body` > `--fill*` > `--template` / 编辑器。`--web` 会离开 CLI，不适合桌面应用内创建。

### 3.2 GitLab 非交互

```text
glab mr create --yes --no-push --source-branch <src> --target-branch <base> \
  --title "..." --description "..." [--draft]
```

若希望 CLI 代 push：`--push --yes --fill`。

### 3.3 失败形态

| 情况 | 官方依据 | 应用侧处理 |
| --- | --- | --- |
| 未登录 | `gh auth status` / `glab auth login` | 引导登录，不要静默失败 |
| 分支未 push | `gh pr create` 会交互询问 push 目的地 | 应用自己 push，或传 `--head` |
| `head == base` | REST 422 | 禁用「开 PR」 |
| 该 head 已有打开的 PR | REST create 文档：already exists 会失败 | 先 `gh pr view` / 列表，改为打开已有 PR |
| 无权限 | REST 权限字段；fine-grained 缺 Pull requests write | 展示宿主错误，提供浏览器打开 |
| 分支保护导致 merge 失败 | 保护分支规则由 GitHub 强制 | 创建仍可能成功；合并另算 |
| fork 的 head 格式错误 | `--head USER:BRANCH` | 检测 fork 后加 owner 前缀 |

未找到 `gh` 在「已存在 PR」时的官方错误字符串。不要依赖文案匹配，先查询再创建。

## 4. 同类产品怎么做

| 产品 | 默认做什么 | 用户能否改 | 应用内完成合并？还是只给链接？ |
| --- | --- | --- | --- |
| GitHub CLI | 命令驱动创建；`--base` 默认仓库 default branch | 每次命令传参 | 应用内：`gh pr merge` 支持 merge/squash/rebase、delete-branch、auto-merge；`--admin` 绕过失败的要求（https://cli.github.com/manual/gh_pr_merge） |
| GitHub Desktop | Preview Pull Request：选 base/对比分支，然后 Create pull request 打开浏览器完成标题与提交 | 可改 base；创建发生在 github.com | 未找到「Desktop 内合并 PR」的官方文档。官方明确：Create 会打开 GitHub.com（https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/creating-an-issue-or-pull-request-from-github-desktop） |
| VS Code GitHub Pull Requests | 扩展内浏览、检出、审阅、评论、合并 PR；设置项 `githubPullRequests.createOnPublishBranch` 可在 publish 分支时询问是否开 PR | 有设置，不是项目「完成任务默认动作」 | 应用内合并、审阅。官方扩展 README 把 merge pull requests 列为能力（https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-pull-request-github） |
| GitLab CLI `glab` | `glab mr create`；可 `--fill --yes --push` | 每次命令传参 | `glab mr merge` 可在 CLI 合并（https://docs.gitlab.com/cli/mr/merge/）；另有 `glab mr approve` 等子命令 |
| GitLab for VS Code | 官方扩展可查看 issue/MR、审阅、评论、批准、看流水线（https://docs.gitlab.com/editor_extensions/visual_studio_code/） | 未找到「项目默认开 MR 还是本地 merge」设置 | 审阅/批准在扩展内。未找到与 GitHub 扩展对等的「扩展内创建 MR」专节；创建仍以网页或 `glab` 为准 |
| JetBrains IDE | 可从 IDE 创建 GitHub PR；Share Project on GitHub 后可立即开第一个 PR（https://www.jetbrains.com/help/idea/create-pull-request-github.html） | 每次操作选 base/head | GitHub：可在 IDE 合并 PR（https://www.jetbrains.com/help/idea/work-with-github-pull-requests.html#manage-pull-requests）。GitLab：可在 IDE 创建、合并、关闭 MR（https://www.jetbrains.com/help/idea/merge-requests.html） |
| GitHub Copilot coding agent | 云端任务默认开 draft PR 作为交付；会话开在 PR 上 | 仓库级开关：可改成任务完成只提交到隐藏分支，由用户点 Create Pull Request 再公开（https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/creating-pull-requests） | PR 在 GitHub 上。用户可评论 `@copilot` 继续改。合并走 GitHub 普通 PR 合并，不是 Copilot 客户端内一键绕过保护 |
| Claude Code | 官方博客：Desktop 可用 GitHub CLI 开 PR，并监控 CI；通过后可自动 merge（https://claude.com/blog/claude-code-on-desktop）。CLI 可 `/install-github-app` 把 Claude Code 接到 PR 上做实现与 code review（https://code.claude.com/docs/en/github-actions） | 未找到「项目默认 merge vs PR」设置 | 创建/监控可走 `gh`；完整 review UI 仍在 GitHub。Desktop 文档写可自动 merge，细节以 GitHub 保护规则为准 |
| OpenAI Codex | Cloud 任务在独立环境跑，完成后 open a pull request（https://developers.openai.com/codex/cloud）。IDE 扩展可 Create PR 把本地任务的 diff 开成 PR（https://developers.openai.com/codex/ide） | 未找到项目级「完成后 merge 到 base」选项 | 创建是产品能力；合并未写成 Codex 内完成，PR 在 GitHub 上 |
| Cursor Cloud Agent | 完成后 automatically opens a pull request（https://cursor.com/docs/cloud-agent）。Agent 可在 PR 上运行，跟进评论（https://cursor.com/docs/cloud-agent/agent-best-practices） | 未找到「不要自动开 PR、改为本地 merge」的官方设置 | PR 在 GitHub；Cursor 跟进评论。未找到 Cursor 桌面内 merge 的官方说明 |
| GitKraken | Launchpad 可在客户端内 open、merge、close PR/MR，支持 GitHub/GitLab 等（https://help.gitkraken.com/gitkraken-desktop/launchpad/） | 托管类型按仓库/远端 | 应用内 merge，不只给链接 |

行业归纳（仅基于上表）：

1. 桌面 Git 客户端分两派。GitHub Desktop 把「填写并提交 PR」交给网站；GitKraken、JetBrains、VS Code GitHub 扩展把创建/审阅/合并留在应用内。
2. 编码 Agent 的云端任务几乎都把 PR 当交付物（Copilot、Codex Cloud、Cursor Cloud Agent），因为执行环境不在用户的本地 base 上。
3. 「先私有改、再公开成 PR」是 Copilot 后来补的产品开关，用来避免过早的 draft PR 噪音。这与 RedWhisk「完成时才决定 merge 还是开 PR」更接近。
4. 未找到任何官方产品把「Issue 完成后默认本地合入 base」和「默认开 PR」做成同一个项目设置里的互斥枚举。那是 RedWhisk 因 worktree 完成 flow 才有的问题，不是 GitHub/GitLab 客户端的标准设置项。

## 5. 应用内处理 PR/MR 的边界

### 5.1 GitHub CLI 已覆盖的操作

| 操作 | 命令 | 是否必须打开浏览器 |
| --- | --- | --- |
| 查看元数据 / 正文 | `gh pr view`，`--json` 可脚本化（https://cli.github.com/manual/gh_pr_view） | 否；`--web` 才会开浏览器 |
| diff | `gh pr diff` | 否 |
| 检查状态 | `gh pr checks` | 否 |
| 评论 | `gh pr comment` | 否 |
| 整体 review | `gh pr review --approve` / `--request-changes` / `--comment`（https://cli.github.com/manual/gh_pr_review） | 否 |
| 标为 ready | `gh pr ready` | 否 |
| 合并 | `gh pr merge`：`--merge` / `--squash` / `--rebase`、`--delete-branch`、`--auto`、`--admin`（https://cli.github.com/manual/gh_pr_merge） | 否 |
| 登录 / 刷新授权 | `gh auth login` / `refresh` | 浏览器登录是官方推荐路径 |

`gh pr review` 是整体 approve / request changes / comment，不是 GitHub 网页上的行内 conversation。行内 review 未找到 `gh` 等价命令。

### 5.2 GitLab CLI

- 创建：`glab mr create`（https://docs.gitlab.com/cli/mr/create/）
- 合并：`glab mr merge`（https://docs.gitlab.com/cli/mr/merge/）
- 批准：官方 CLI 索引含 `glab mr approve`（https://gitlab.com/gitlab-org/cli）

未在本次打开 `glab mr note` / discussions 的完整手册；应用内评论能力不要写成已核实。

### 5.3 远端仍然强制的规则

GitHub 保护分支可要求：status checks 通过、PR 在合入前必须是最新、linear history、required reviews 等。这些规则在 GitHub 上强制，API/CLI 合并会按规则失败（https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches）。

`gh pr merge --admin` 明确是管理员绕过失败的合并要求（https://cli.github.com/manual/gh_pr_merge）。RedWhisk 不应默认使用。

因此：

- 创建 PR/MR：可以 100% 在应用内完成（CLI 或 REST），不必跳网站。
- 看 CI、留评论、整体批准、在规则允许时合并：可以在应用内。
- 行内 review、冲突在网页上的可视化、SSO 授权、OAuth 登录：仍会用浏览器或需要 IDE 级 diff UI。
- 合并能否成功：由宿主规则决定，不是 RedWhisk 本地 rebase 能替代的。

### 5.4 编码 Agent 的实际做法

它们通常创建并跟踪 PR，不接管 GitHub 的合并治理：

- Copilot：交付 = draft PR；合并仍是 GitHub PR（https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/creating-pull-requests）。
- Cursor Cloud Agent：自动开 PR，后续在 PR 上跟评论（https://cursor.com/docs/cloud-agent）。
- Codex Cloud：完成后 open a pull request（https://developers.openai.com/codex/cloud）。
- Claude Code Desktop：用 `gh` 开 PR 并监视 CI，通过后可自动 merge（https://claude.com/blog/claude-code-on-desktop）。这是最接近「应用内处理到合并」的 Agent 产品，底层仍是 `gh` + GitHub 规则。

## 6. 给 RedWhisk 的方案

以下为建议，不是现状。

### 6.1 先分清三个动作

不要把它们做成一个下拉框里的两项。

| 动作 | 何时出现 | 做什么 | 不做什么 |
| --- | --- | --- | --- |
| A. 就地完成 | 当前就在目标分支上开发（无隔离 worktree，或 worktree 的工作分支 == base） | dirty 处理 → 标记 Issue 完成 | 不 merge 到自己；不开以自己为 head/base 的 PR |
| B. 合入 base | RedWhisk 托管 worktree，工作分支 ≠ base，且用户选择本地合入 | 现有 reconcile：干净检查 → rebase/ff → 删 worktree 与工作分支 | 不 push、不开 PR |
| C. 提交 PR/MR | 工作分支 ≠ 目标分支，且宿主是 GitHub/GitLab，且已认证 | push 工作分支 → 创建 PR/MR（base=用户选的目标）→ Issue 完成但保留远程分支 | 不本地 merge；默认不删远程分支 |

变更页「创建 PR/MR」是 C 的独立入口，不依赖 Issue 完成 flow。目标默认是远端 default branch（`gh repo view --json defaultBranchRef` 或 GitLab 项目 `default_branch`），不是 Issue 的 base。这覆盖「base 不是 main，但我想向上游默认分支开 PR」。

### 6.2 项目设置

建议存这些字段，而不是「GitHub 或 GitLab」单选项：

```text
forge: auto | github | gitlab | none     # 默认 auto
completionAction: stay | merge_to_base | open_pull_request
prTarget: issue_base | repo_default      # 仅当 completionAction=open_pull_request
prDraft: boolean                         # 默认 true 更安全
```

`forge=auto` 规则：

1. 读 `origin`（没有则第一个 GitHub/GitLab remote）。
2. host 为 `github.com` 或 `GH_HOST` / 已知 GHES → GitHub。
3. host 为 `gitlab.com` 或 `GITLAB_HOST` / URL 含 `gitlab.` → GitLab。
4. 都不匹配 → `none`，设置里禁用「提交 PR/MR」，说明原因。

不要让用户在设置里「检测是 GitLab 还是 GitHub」当主操作；显示检测结果，提供覆盖即可。自建实例误判才需要手选。

`completionAction` 是该项目完成 Issue 时弹窗的默认值，与行业里 Copilot 的「何时公开成 PR」开关同类：项目级默认，任务级可改。

推荐默认：

- 探测不到 forge → `merge_to_base`（保持今天行为）。
- 探测到 forge 且用户主要在隔离 worktree 开发 → 可默认 `open_pull_request`，但不要替用户改已有项目。
- 新项目第一次完成前，用探测结果填默认，允许改。

### 6.3 完成弹窗

带上项目默认值，允许本次覆盖。选项是否可点由运行时探测决定，不要只看设置。

探测分层（按顺序短路）：

1. 无 git remote → 只能 A/B。
2. 工作分支 == 目标分支 → 只有 A；隐藏 B/C。
3. forge=none → C 禁用，文案「未识别 GitHub/GitLab 远程」。
4. 无 `gh`/`glab` 且应用未内置 token → C 禁用，文案「未安装 GitHub CLI」或提供登录。
5. `gh auth status` / `glab auth status` 失败 → C 禁用，入口去登录（允许打开浏览器一次）。
6. 未 push / push 失败 → 先 push，失败则阻断 C。
7. 该 head 已有打开的 PR → C 变成「关联已有 PR 并完成」，不要再 create。
8. 其余：C 可选。

B 在「非 RedWhisk 托管 worktree」时保持今天的确认/禁止自动清理。C 成功后：

- 不执行本地 merge。
- 可以移除本地 worktree 目录以免占磁盘，但保留本地分支或至少保留远程分支。
- Issue 状态标完成，并记下 PR/MR URL。
- 不要自动 `gh pr merge`。

这与 Copilot/Cursor/Codex 一致：完成 = 把改动变成可审的 PR，而不是替用户合进保护分支。

### 6.4 变更页菜单

主 checkout「更多」在「合并分支」旁加「创建 Pull Request / Merge Request」：

- 源：当前分支。
- 目标：默认远端 default branch，可改。
- 当前分支 == default branch 时禁用，说明「没有对比分支」。
- 已有打开的 PR 则改为「查看 PR」。
- 不走 Issue 完成状态机。

这对应 GitHub Desktop 的 Preview Pull Request 和 JetBrains 的 Create Pull Request，是用户「base 不是 main、我主动要开 PR」的出口。

### 6.5 第一期 vs 第二期

| 期 | 做 | 不做 |
| --- | --- | --- |
| 一期 | 宿主检测；CLI 探测与登录引导；完成弹窗 A/B/C；push + 创建草稿 PR/MR；把 URL 写进完成结果；变更页创建入口；「查看」用 `gh pr view --json` / 等价 API 展示状态、检查、标题 | 行内 review；应用内讨论流；自动 merge；自研 OAuth App（先复用用户已登录的 `gh`/`glab`） |
| 二期 | 检查失败通知；`gh pr comment`；可选 auto-merge（仅用户显式打开，且尊重保护规则）；PR 合并后自动清理本地分支/worktree | 重建 GitHub 网页 |

实现选型：一期直接调用户机器上的 `gh` / `glab`，不要自己发 REST。

理由（对应官方能力，不是偏好）：

1. 认证、GHES/自建 host、SSH/HTTPS、fork 的 `owner:branch`、已有 PR 查询，CLI 已经做了。
2. Claude Code Desktop 官方就是「用 GitHub CLI 开 PR 并监视 CI」。
3. RedWhisk 已在本地跑 git 子进程，再跑 `gh`/`glab` 与现有模型一致。
4. 自己做 OAuth/GitHub App 才能在用户没装 CLI 时工作，但要维护 token、企业 host、SSO，超出一期。

探测不到 CLI 时：引导安装（Homebrew: `brew install gh` / `brew install glab`），或「在浏览器打开比较页」（`gh pr create --web` / GitHub compare URL）。不要静默降级成本地 merge。

### 6.6 与现有 reconcile 的关系

```text
detecting_workspace
  → dirty 三选
  → 选择完成动作（默认来自项目设置）
        ├ stay            → completed（不改 git refs）
        ├ merge_to_base   → reconciling_worktree → cleanup → completed
        └ open_pr         → push → create PR/MR → 可选移除本地 worktree
                            → completed（记录 URL；不 merge、不删远程分支）
```

`open_pr` 失败（未登录、push 拒绝、API 422）进入 `blocked`，保持 worktree，与今天 Git 失败路径一致。

### 6.7 对原设想的直接回答

- 「设置里检测 GitHub/GitLab + 两个默认动作」：可行，而且应该做。但检测结果是只读展示，动作才是设置；完成弹窗必须能覆盖。
- 「一个项目通常只有一种习惯」：对，所以默认值放项目设置。例外用弹窗和变更页菜单处理。
- 「已经在 base 上开发就不应开 PR」：对，运行时若 head==base，强制 A。
- 「base 不是 main 时还想开 PR」：对，但这是变更页动作，或 `prTarget=repo_default`，不要把 Issue 的 base 偷偷改成 main。
- 「能否不跳网站处理 PR」：创建、看状态、评论、整体批准、规则内合并都可以。登录和行内 review 不能。一期做到创建 + 状态即可，合并留给网站或二期显式按钮。

## 来源

- https://cli.github.com/manual/
- https://cli.github.com/manual/gh_auth_login
- https://cli.github.com/manual/gh_auth_status
- https://cli.github.com/manual/gh_auth_refresh
- https://cli.github.com/manual/gh_help_environment
- https://cli.github.com/manual/gh_pr_create
- https://cli.github.com/manual/gh_pr_view
- https://cli.github.com/manual/gh_pr_review
- https://cli.github.com/manual/gh_pr_merge
- https://github.com/cli/cli#installation
- https://github.com/cli/cli/issues/9461
- https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#create-a-pull-request
- https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-with-pull-requests/creating-a-pull-request
- https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/creating-an-issue-or-pull-request-from-github-desktop
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/creating-pull-requests
- https://docs.github.com/en/copilot/concepts/agents/about-copilot-coding-agent
- https://docs.gitlab.com/cli/
- https://docs.gitlab.com/cli/authentication/
- https://docs.gitlab.com/cli/mr/create/
- https://docs.gitlab.com/cli/mr/merge/
- https://docs.gitlab.com/api/merge_requests/#create-mr
- https://docs.gitlab.com/editor_extensions/visual_studio_code/
- https://gitlab.com/gitlab-org/cli
- https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-pull-request-github
- https://www.jetbrains.com/help/idea/create-pull-request-github.html
- https://www.jetbrains.com/help/idea/work-with-github-pull-requests.html
- https://www.jetbrains.com/help/idea/merge-requests.html
- https://help.gitkraken.com/gitkraken-desktop/launchpad/
- https://claude.com/blog/claude-code-on-desktop
- https://code.claude.com/docs/en/github-actions
- https://developers.openai.com/codex/cloud
- https://developers.openai.com/codex/ide
- https://cursor.com/docs/cloud-agent
- https://cursor.com/docs/cloud-agent/agent-best-practices
