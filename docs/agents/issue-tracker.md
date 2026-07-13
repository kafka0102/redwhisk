# Issue Tracker：本地 Markdown（`.scratch/`）

本文件配置的是 **AI 开发技能（`to-tickets` / `triage` / `to-spec` / `qa` / `wayfinder` 等）使用的 issue tracker 后端**。Issue 与 spec（即 PRD）以本地 markdown 文件形式存储在仓库 `.scratch/` 目录下，不使用 GitHub / GitLab 等外部 tracker。

## ⚠️ 范围声明（务必先读，防止概念混淆）

本文件中所有「issue / ticket」**仅指 AI 开发技能用于跟踪开发工作的本地 markdown 文件**，存储在仓库 `.scratch/` 下。

它与下列概念**完全无关、互不引用、互不操作**：

- **RedWhisk 产品自身的业务 Issue**（`src/features/issues/` 模块）：那是产品的核心业务实体，存于 SQLite（`issue_actions` 等表），由应用 UI（看板、时间轴）管理，含评论、Agent 会话、交付摘要等；定义见 `CONTEXT.md`。

因此，当任何技能指令说「创建 / 读取 / 评论 / 关闭一个 issue」时：

- **一律只在 `.scratch/` 本地文件层面操作**；
- **禁止**调用 `src/features/issues` 的 Tauri command、读写其 SQLite 表，或把业务 Issue 当作开发 ticket（反之亦然）。

简言之：技能的 issue = `.scratch/` 下的开发任务文件；产品的 Issue = 应用里用户管理的业务数据。两者仅因同名而需在此显式隔离。

## 约定

- 每个特性一个目录：`.scratch/<feature-slug>/`
- spec：`.scratch/<feature-slug>/spec.md`
- 实现 ticket：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 起编号；**一个 ticket 一个文件**，绝不合并成单个 tickets 文件
- triage 状态记录在文件顶部附近的 `Status:` 行（角色字符串见 `triage-labels.md`）
- 评论与对话历史追加到文件底部 `## Comments` 标题下

## 技能操作映射

- 技能要求「发布到 issue tracker」时：在 `.scratch/<feature-slug>/` 下新建文件（必要时创建目录）。
- 技能要求「获取相关 ticket」时：读取被引用路径的文件；用户通常会直接传入路径或编号。

## Wayfinder 操作

`/wayfinder` 使用一个地图文件 + 若干子 ticket 文件：

- **地图**：`.scratch/<effort>/map.md` —— 正文为 Notes / Decisions-so-far / Fog。
- **子 ticket**：`.scratch/<effort>/issues/NN-<slug>.md`，从 `01` 起编号，正文为问题。`Type:` 行记录类型（`research` / `prototype` / `grilling` / `task`）；`Status:` 行记录 `claimed` / `resolved`。
- **阻塞**：顶部附近的 `Blocked by: NN, NN` 行；当所列文件全部 `resolved` 时，该 ticket 才解除阻塞。
- **Frontier**：扫描 `.scratch/<effort>/issues/`，找出 open、unblocked、unclaimed 的文件；编号最小者优先。
- **领取**：开干前先设 `Status: claimed` 并保存。
- **完成**：在 `## Answer` 标题下追加答案，设 `Status: resolved`，再把上下文指针（gist + 链接）追加到 `map.md` 的 Decisions-so-far。
