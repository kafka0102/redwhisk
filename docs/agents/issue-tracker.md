# Issue Tracker：GitHub

本仓库的 Issue 与 PRD 统一存储在 GitHub Issues 中。所有操作使用 `gh` CLI。

## 操作约定

- 创建 Issue：`gh issue create --title "..." --body "..."`；多行正文使用 heredoc。
- 读取 Issue：`gh issue view <number> --comments`；筛选评论时同时获取标签。
- 列出 Issue：`gh issue list --state open --json number,title,body,labels,comments`，按需添加 `--label` 与 `--state` 过滤。
- 评论 Issue：`gh issue comment <number> --body "..."`。
- 添加或移除标签：`gh issue edit <number> --add-label "..."` 或 `--remove-label "..."`。
- 关闭 Issue：`gh issue close <number> --comment "..."`。

在仓库克隆目录中运行时，`gh` 会根据 Git remote 自动识别仓库。

## Pull Request 作为 triage 入口

**Pull Request 作为请求入口：否。** 如需将外部 Pull Request 纳入 triage，可将此项改为“是”。

## 技能操作映射

- 技能要求“发布到 issue tracker”时，创建 GitHub Issue。
- 技能要求“获取相关 ticket”时，执行 `gh issue view <number> --comments`。

## Wayfinder 操作

`/wayfinder` 使用一个地图 Issue 与若干子 Issue：

- 地图：一个带 `wayfinder:map` 标签的 Issue，记录 Notes、Decisions-so-far 与 Fog。
- 子 ticket：作为地图 Issue 的 GitHub sub-issue；不支持时在地图正文维护任务列表，并在子 Issue 顶部标记 `Part of #<map>`。标签使用 `wayfinder:<type>`，其中 type 为 `research`、`prototype`、`grilling` 或 `task`。
- 阻塞关系：优先使用 GitHub 原生 Issue dependency；不可用时，在子 Issue 顶部写 `Blocked by: #<n>, #<n>`。全部阻塞 Issue 关闭后，子 ticket 才解除阻塞。
- 领取：执行 `gh issue edit <n> --add-assignee @me`。
- 完成：先执行 `gh issue comment <n> --body "<answer>"`，再关闭 Issue，并将上下文指针追加到地图的 Decisions-so-far。
