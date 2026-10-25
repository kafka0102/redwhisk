# Issue 完成后的合入与 PR/MR

> 状态：待产品 review 静态稿，未实现
> 日期：2026-10-25
> 调研原文：[task-completion-pr-mr.md](../../survey/task-completion-pr-mr.md)
> 相关：[Worktree 与 Git 生命周期](../../architecture-design/worktree-git-lifecycle.md)、[Settings 页面布局](../../architecture-design/settings-page-layout.md)、[设计系统指南](../../architecture-design/design-guide.md)

本文是产品方案。实现前必须先出静态页面给产品 review，通过后再写代码。

## 1. 背景

RedWhisk 今天把 Issue 做完后的 Git 收尾，固定成「本地合入」。

当前完成 flow（`IssueCompletionPhase`）：

```text
detecting_workspace
  → prompting_dirty_decision → auto_committing → confirming_continue_after_commit
  → reconciling_worktree → confirming_worktree_cleanup → completed
```

- 未提交改动：自动提交 / 不提交 / 取消。
- 若是 RedWhisk 托管 worktree：把工作分支 rebase/ff 合入目标分支（base），再删 worktree 与工作分支。
- 人已经在当前分支（base）上开发：没有合入，也没有远程 PR。
- 变更 Activity 主 checkout「更多」：签出、拉取、推送、创建分支、合并分支。没有「创建 PR/MR」。

项目设置（Settings → General）只有名称、仓库路径、worktree 位置、创建后命令。没有宿主检测，也没有「完成后默认做什么」。

问题：

1. 有的项目习惯本地合入 base；有的习惯开 GitHub PR / GitLab MR。现在只能走前者。
2. 隔离 worktree 完成后，代码只进了本地 base，没有变成可审的远程请求。
3. 人已经在 base 上开发时，再「合入自己」或「用自己当 head/base 开 PR」都没有意义。
4. base 不一定是 `main`/`master`。用户可能在 `release/x` 上做完 Issue，仍想向仓库默认分支开 PR。这不该偷偷改 Issue 的 base。

## 2. 调研结论（压缩）

细节与 URL 见调研原文。产品上只需要记住这些：

1. **PR/MR 是宿主 API 对象，不是 git 操作。** 本地 Git 凭据只能 push。GitHub 官方路径是 `gh`；GitLab 是 `glab`。没有 CLI 也可以走 REST，但认证、企业主机、fork 的 `owner:branch` 都要自己做。
2. **丝滑创建 = 应用自己 push + 非交互创建。** `gh pr create` 在未推送时会交互询问；`--head` 会跳过 push。`glab mr create` 有 `--yes --fill --push`。已有打开的 PR 时不要再 create。
3. **同类产品没有「完成后默认本地 merge 还是开 PR」这个项目级互斥枚举。** 那是 RedWhisk 因 worktree 完成 flow 才有的问题。
   - GitHub Desktop：Preview PR，点创建跳到网站。
   - VS Code / JetBrains / GitKraken：应用内创建、审阅、合并。
   - Copilot / Cursor Cloud / Codex Cloud：云端任务的交付物就是 PR。Copilot 后来加了「先私有迭代，用户点 Create Pull Request 再公开」。
   - Claude Code Desktop：用 `gh` 开 PR，监视 CI，通过后可自动 merge。
4. **创建、看 CI、评论、整体批准、规则内合并都可以不打开浏览器。** 登录/SSO、行内 review 仍会。保护分支规则由远端强制。一期不要在应用里替用户合进保护分支。

## 3. 产品原则

- 一个项目通常只有一种习惯，所以默认值放项目设置。
- 每一次完成都可以覆盖默认值。
- 运行时能不能做，比设置里勾了什么更优先。没登录、没 CLI、已经在 base 上，就要禁用或改成另一条路，不要硬跑。
- 「合入 base」和「开 PR/MR」互斥：开 PR 时不本地 merge，也不删远程分支。
- 变更页「创建 PR/MR」独立于 Issue 完成，解决「base 不是默认分支，但我要向上游开 PR」。

## 4. 三个完成动作

不要做成下拉框里的两项。完成时只会出现这些动作中合理的子集。

| ID | 动作 | 何时出现 | 做什么 | 不做什么 |
| --- | --- | --- | --- | --- |
| A | 就地完成 | 当前就在目标分支上（无隔离 worktree，或工作分支 == base） | dirty 处理完，标记 Issue 完成 | 不 merge 到自己；不开 head=base 的 PR |
| B | 合入 base | RedWhisk 托管 worktree，工作分支 ≠ base | 现有 reconcile：干净检查 → rebase/ff → 删 worktree 与工作分支 | 不 push，不开 PR |
| C | 提交 PR/MR | 工作分支 ≠ 所选目标，且宿主是 GitHub/GitLab，且已认证 | push 工作分支 → 创建草稿 PR/MR → 记下 URL → Issue 完成 | 不本地 merge；默认不删远程分支；不自动 merge PR |

文案（产品口径，实现时走 i18n）：

- A：就地完成
- B：合并到 base 分支
- C：提交 Pull Request / 提交 Merge Request（随宿主切换）

完成弹窗里，B 与 C 是互斥单选，带项目默认值。A 不是用户「选出来」的：当运行时判定已经在 base 上，弹窗不出现 B/C，只走现有 dirty/确认。

## 5. 项目设置

放在 Project Settings → General，沿用现有 80% 居中 card，不新开 Settings 菜单。

字段：

```text
forge: auto | github | gitlab | none     # 默认 auto，界面以检测结果为主
completionAction: stay | merge_to_base | open_pull_request
prTarget: issue_base | repo_default      # 仅 open_pull_request 时有意义
prDraft: boolean                         # 默认 true
```

界面要长这样（静态稿必须画出）：

1. **远程宿主**：只读摘要 + 可选覆盖。
   - auto 成功：`已识别为 GitHub（github.com/org/repo）` 或 `已识别为 GitLab（gitlab.example.com/group/proj）`
   - 识别失败：`未识别 GitHub / GitLab 远程`，此时「提交 PR/MR」禁用，并说明原因。
   - 覆盖：GitHub / GitLab / 不使用。自建实例误判才需要手选。
2. **任务完成后的默认动作**：单选
   - 合并到 base 分支
   - 提交 Pull Request / Merge Request（文案随宿主）
   - 「就地完成」不是设置项。已经在 base 上时运行时自动走 A，忽略这条默认值。
3. **PR/MR 目标**（仅当默认动作是提交 PR/MR 时显示）
   - Issue 的 base 分支
   - 仓库默认分支（`main` / `master` / 远端 default）
4. **创建为草稿**（仅当默认动作是提交 PR/MR 时显示），默认开。
5. **环境状态**：`gh` / `glab` 是否安装、是否已登录。未就绪时给「安装 / 登录」说明，不要假装能创建。

探测不到宿主时，默认动作只保留「合并到 base 分支」，与今天行为一致。不要给已有项目偷偷改成开 PR。

## 6. 完成弹窗

接在现有 dirty 三选、自动提交确认之后，对账之前。

当需要在 B/C 之间选择时，弹窗包含：

- 工作分支、base 分支（只读）。
- 单选：合并到 base / 提交 PR 或 MR。默认选中项目设置。
- 若选 C：可改目标分支（Issue base 或仓库默认分支），显示草稿开关。
- 主按钮随选项变化：`合并并完成` / `创建 PR 并完成`。
- 取消：中止完成 flow，与今天一致。

运行时覆盖设置：

| 探测结果 | 弹窗行为 |
| --- | --- |
| 工作分支 == base | 不出现 B/C，走 A |
| 无 git remote | 只有 B（若有 worktree）或 A |
| 未识别宿主 | C 禁用，说明「未识别 GitHub/GitLab 远程」 |
| 未安装 `gh`/`glab` | C 禁用，说明未安装 |
| 未登录 | C 禁用，提供登录（允许打开浏览器一次） |
| push 失败 | 阻断，保持 worktree，进入 blocked |
| 该 head 已有打开的 PR/MR | C 变成「关联已有 PR/MR 并完成」，不再 create |
| 外部 worktree | B 保持今天的确认/禁止自动清理；C 仍可 push 当前分支开 PR，但不自动删用户目录 |

C 成功后：

- Issue 标为 completed，记录 PR/MR URL（完成结果、Issue 详情能看到链接）。
- 不执行本地 merge。
- 可以移除本地 worktree 目录，但保留远程分支。
- 不要自动 `gh pr merge` / `glab mr merge`。

C 失败：进入 `blocked`，保持 worktree，与今天 Git 失败路径一致。

## 7. 变更页入口

主 checkout「更多」菜单，放在「创建分支」之后、「合并分支」之前：

- GitHub：创建 Pull Request
- GitLab：创建 Merge Request
- 未识别宿主：菜单项禁用，或隐藏

点开后的对话框（形态对齐现有合并分支弹窗的克制程度，不要做成网站）：

- 源分支：当前分支，只读
- 目标分支：默认仓库默认分支，可改
- 标题、正文：可预填（fill 自 commit），可改
- 草稿开关，默认跟随项目设置
- 当前分支 == 默认分支：禁用，说明没有对比分支
- 已有打开的 PR/MR：按钮改为「查看」，展示 URL

这条路径 **不** 走 Issue 完成状态机，也 **不** 改 Issue 状态。

linked worktree 的「更多」仍只有删除，不加创建 PR。用户要开 PR，先在主 checkout 操作，或走 Issue 完成。

## 8. 环境探测

按顺序短路：

1. `git remote -v` → 解析 `origin`（没有则第一个 GitHub/GitLab remote）
2. host 为 `github.com` 或已知 GHES → GitHub；`gitlab.com` / `GITLAB_HOST` / host 含 `gitlab.` → GitLab；否则 none
3. 对应 CLI 是否在 PATH（`gh` 或 `glab`）
4. `gh auth status` / `glab auth status`
5. 当前分支是否已 push
6. 是否已有打开的 PR/MR（先查再 create）

一期 **直接调用户机器上的 `gh` / `glab`**，不自研 OAuth、不内置 token。没装 CLI 就引导安装或打开 compare 页，不要静默降级成本地 merge。

非交互创建示例：

```text
git push -u origin HEAD
gh pr create --base <base> --head <branch> --title "..." --body-file <file> --draft
glab mr create --yes --no-push --source-branch <src> --target-branch <base> --title "..." --draft
```

## 9. 与现有完成 flow 的衔接

```text
detecting_workspace
  → dirty 三选（不变）
  → 若需要在 B/C 间选择：prompting_closeout_action（新阶段）
        ├ stay            → completed
        ├ merge_to_base   → reconciling_worktree → cleanup → completed
        └ open_pr         → push → create PR/MR → 可选移除本地 worktree
                            → completed（记录 URL）
```

新阶段名字实现时可调整，产品语义不变：在对账之前做出关闭方式选择。

## 10. 一期 / 非目标

一期做：

- 宿主检测与 CLI 探测、登录引导
- 项目设置默认动作
- 完成弹窗 A/B/C
- push + 创建草稿 PR/MR，写入 URL
- 变更页创建入口
- 用 `gh pr view --json` / 等价命令展示状态、检查、标题（只读）

一期不做：

- 应用内行内 review、讨论流
- 自动 merge、admin 绕过保护规则
- 自研 GitHub App / OAuth
- Bitbucket / Gitea / 其他宿主
- 在 linked worktree 的「更多」里开 PR
- 把「就地完成」做成设置项

二期（本文不实现）：检查失败通知、评论、可选 auto-merge、PR 合入后清理本地分支。

## 11. 静态稿要求

实现代码之前，先交一页可双击打开的静态 HTML，供产品点选 review。

约定对齐现有 `src/features/settings/agent-reorder.prototype.html`：

- 路径：`src/features/issues/issue-completion/completion-closeout.prototype.html`
- 单文件，无构建，无后端
- 视觉跟设计系统：黑白灰、13px、紧凑、无渐变重阴影
- 用顶部或侧栏切换场景，每个场景展示完整界面，不要只放线框

必须覆盖的场景：

1. Settings → General：识别为 GitHub，默认「提交 PR」，草稿开，目标是 Issue base
2. Settings → General：未识别宿主，「提交 PR」禁用
3. Settings → General：识别为 GitLab，未安装/未登录 `glab`
4. 完成弹窗：worktree 分支 `issue-12-redwhisk` → base `main`，默认选中「提交 PR」，可改成「合并到 base」
5. 完成弹窗：已在 base `main` 上，不出现 B/C
6. 完成弹窗：C 因未安装 `gh` 而禁用
7. 完成弹窗：已有打开的 PR，主按钮为「关联已有 PR 并完成」
8. 变更页「更多」菜单展开，含「创建 Pull Request」
9. 创建 PR 对话框：源/目标/标题/草稿
10. 创建 PR 对话框：当前即默认分支，禁用
11. Issue 完成后的只读结果：显示 PR 链接

每个场景旁用一小段说明：这是什么状态、用户下一步会做什么。场景切换时把当前选择打印出来，方便 review 时对照。

静态稿只回答「看起来对不对、流程是否说得清」，不接 `gh`，不改 SQLite。

产品通过后（用户明确说「通过」或「go」），再按本文实现。未通过则只改静态稿和本文，不动生产代码。

## 12. 新 session 提示词

把下面围栏里的全文贴进新 session。不要改口径。

```text
默认简体中文。不要输出思考过程。先做静态稿给产品 review，未经我说「通过」或「go」之前，禁止改生产代码、禁止 migration、禁止接 gh/glab。

任务：按 docs/superpowers/specs/2026-10-25-task-completion-pr-mr-design.md 做「Issue 完成后合入 base 或提交 GitHub PR / GitLab MR」。调研原文是 docs/survey/task-completion-pr-mr.md，冲突时以 spec 为准。

必读：
- AGENTS.md
- docs/superpowers/specs/2026-10-25-task-completion-pr-mr-design.md（全文）
- docs/architecture-design/design-guide.md
- docs/architecture-design/settings-page-layout.md
- docs/architecture-design/worktree-git-lifecycle.md
- 现有完成 flow：src-tauri/src/types/issue_completion.rs、src/features/issues/issue-completion/、src/features/issues/use-issue-completion-flow.ts
- 现有设置：src/features/settings/settings-general-panel.tsx、src/features/project/project-details-form.tsx
- 现有变更菜单：src/features/changes/changes-branch-more-menu.tsx
- 静态稿范例：src/features/settings/agent-reorder.prototype.html

—— 第一阶段：静态稿 ——

做一个可双击打开的单文件 HTML：
src/features/issues/issue-completion/completion-closeout.prototype.html

要求：
- 无构建、无后端、无框架
- 视觉跟 RedWhisk 设计系统：黑白灰、13px、紧凑、安静，不要营销页、不要渐变重阴影
- 用场景切换器覆盖 spec §11 列出的全部 11 个场景，每个场景是完整界面，不是线框
- 每个场景旁边写一句：当前状态 + 用户下一步
- 切换场景时在页面上打印当前选择（宿主、默认动作、弹窗选项、目标分支、草稿）
- 文案用简体中文，按钮/菜单对齐现有产品口气
- 画完后 git commit（仅该 HTML，或 HTML + 你对 spec 的必要勘误）。然后停下来等我 review

不要同时出多套风格。就一套，贴近现有 Settings / Dialog / 变更页。

—— 第二阶段：实现（仅在我回复「通过」或「go」之后）——

按 spec 做一期，最小改动：
1. 项目设置 General：宿主检测摘要、默认完成动作、PR 目标、草稿开关、CLI 登录状态
2. 完成 flow：在 dirty 处理之后、对账之前增加 B/C 选择；已在 base 上强制 A
3. 动作 C：push + gh/glab 非交互创建草稿 PR/MR，记录 URL；不本地 merge，不自动合 PR
4. 变更页主 checkout「更多」：创建 PR/MR 对话框，独立于 Issue 完成
5. 运行时探测决定选项是否可点，不要只信设置
6. 全部用户可见文案走 i18n，所有 locale 补齐
7. 按 AGENTS.md §5 跑门禁并提交

禁止：
- 应用内行内 review、讨论流、自动 merge、自研 OAuth
- 把「就地完成」做成设置项
- 静默把开 PR 失败降级成本地 merge
- 顺手重构无关文件

若 spec 有缺口，先写在静态稿说明或问我，不要猜成新功能。
```
