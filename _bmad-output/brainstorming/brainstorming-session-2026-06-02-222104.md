---
stepsCompleted: [1, 2]
inputDocuments: []
session_continued: true
continuation_date: '2026-06-03'
session_topic: '跨平台桌面开发工作台：以 Git 仓库 Workspace 为入口，整合任务看板、本地 AI Agent 执行、Worktree 隔离、代码浏览、Git 历史查看、可恢复终端和插件扩展'
session_goals: '逐步分析市场情况、可参考开源项目、技术栈与技术选型；随后拆解功能需求文档为用户故事，并规划分阶段开发路线'
selected_approach: 'Progressive Technique Flow'
techniques_used: ['Question Storming', 'Analogical Thinking', 'Six Thinking Hats', 'Morphological Analysis', 'Solution Matrix', 'Decision Tree Mapping', 'SCAMPER Method']
ideas_generated: []
context_file: ''
---

# Brainstorming Session Results

**Facilitator:** kafka0102
**Date:** 2026-06-02

## Session Overview

**Topic:** 跨平台桌面开发工作台：以 Git 仓库 Workspace 为入口，整合任务看板、本地 AI Agent 执行、Worktree 隔离、代码浏览、Git 历史查看、可恢复终端和插件扩展。

**Goals:** 逐步分析市场情况、可参考开源项目、技术栈与技术选型；随后拆解功能需求文档为用户故事，并规划分阶段开发路线。

### Context Guidance

暂无外部上下文文件。本次会话基于用户提供的产品设想推进。

### Session Setup

用户希望开发一款 Mac 桌面应用，并尽量支持 Windows 和 Linux，实现跨操作系统。产品以 Workspace 为入口，每个 Workspace 关联一个 Git 仓库。围绕该仓库，用户可以创建 Issue 或 Task，并调用本地 AI Agent（如 Codex、Claude Code）执行任务；执行过程中需要像 Codex Client 一样实时查看输出并进行交互。

产品需要支持 Git Worktree，以便同一仓库中的多个 Agent 任务互不干扰。它还需要提供类似 VS Code 的代码浏览体验、Git 历史记录查看能力，以及通过插件机制扩展周边能力。

新增的关键能力是 Workspace 级终端管理：用户可以为当前 Workspace 配置多个终端任务，例如启动 dev server、运行测试 watcher、启动后端服务或进入特定目录。配置保存后，下次打开 Workspace 时，软件应能恢复终端布局，并按配置自动启动相应命令。

## Technique Selection

**Approach:** Progressive Technique Flow

**Journey Design:** 从市场和问题空间的广域探索开始，逐步收敛到产品定位、技术选型、用户故事和阶段化开发计划。

**Progressive Techniques:**

- **Phase 1 - Exploration:** Question Storming + Analogical Thinking，用于提出关键问题、识别市场假设，并从 IDE、Issue 看板、终端复用、Git GUI、Agent Runner、DevOps Dashboard 等领域寻找类比。
- **Phase 2 - Pattern Recognition:** Six Thinking Hats，用于整理事实、用户情绪、机会、风险、创新点和流程控制。
- **Phase 3 - Development:** Morphological Analysis + Solution Matrix，用于拆解技术维度并比较桌面框架、编辑器内核、终端内核、Git 能力、Agent 执行协议、Worktree 管理、插件系统、数据存储、安全模型等技术组合。
- **Phase 4 - Action Planning:** Decision Tree Mapping + SCAMPER Method，用于拆解用户故事、定义 MVP 边界，并规划分阶段开发路线。

**Journey Rationale:** 用户的目标同时包含产品机会判断、竞品/开源项目参考、技术栈选择和需求拆解，因此采用先发散后收敛的流程，避免过早锁定实现方案。

## Technique Execution Notes

### Phase 1 - Question Storming + Analogical Thinking

**Interactive Focus:** 先围绕产品最核心的痛点提问，不直接进入实现选型。

**[Market #1]：Agent 任务不是聊天，而是可管理的开发工作流**  
_Concept_: 现有 Codex、Claude Code、Cursor、Continue 等工具更像一次会话或 IDE 内辅助，但当用户同时有多个任务、多个分支、多个本地服务、多个 Agent 执行流时，缺少一个“任务级控制台”来管理它们。这个产品可以把 Issue、Worktree、Agent 输出、终端、Git 变化统一到一个 Workspace 里。  
_Novelty_: 它不是再做一个 AI Editor，而是把 AI 编程从“对话交互”提升为“多任务开发调度”。

**[Workflow #2]：Issue 驱动的一窗口开发闭环**  
_Concept_: 用户当前工作分散在 VS Code、终端和网页 Issue 工具之间，期望在一个类似 VS Code 的单窗口里，通过左侧竖向菜单切换看板、Agent Session、代码浏览、Diff、终端和 Git 历史。Issue 是工作流源头，从 backlog 到运行中、review、完成，期间 Agent 可能请求确认、执行完成后提醒用户 review 和验证，验证通过后合并代码或关闭 Issue。  
_Novelty_: 产品价值不只是“能调用 Agent”，而是把创建 Issue、分配 Agent、交互确认、查看 diff、启动 server 验证、合并提交这些分散步骤串成连续流程。

**[Product #3]：三阶段协作演进路径**  
_Concept_: 第一阶段做本地版本，用本地数据库串联 Issue、Agent Session、Worktree、终端、Diff 和 Git 状态，服务 AI Coding 重度用户、独立开发者和一两人小团队。第二阶段接入 GitHub/GitLab，把云端 Issue、评论、Agent 结论、Commit-Issue 绑定、PR/MR 纳入流程，用代码托管平台承载多人协作。第三阶段引入软件自身云端服务，支持用户登录、数据同步和平台内多人协作。  
_Novelty_: 这不是一开始就做 SaaS 协作平台，而是先用本地数据库验证个人工作流，再借 GitHub/GitLab 作为协作桥梁，最后在确认需求后建设自有云。

**[MVP #4]：第一阶段聚焦 Issue 到 Agent Session 的最短闭环**  
_Concept_: 第一阶段必须包含创建本地 Issue、分配 Agent、在 Agent Session 中执行和交互、提醒用户输入、提醒执行完成、将 Issue 标记为完成，以及对 Agent 产出的改动执行合并或保留。自动创建 Worktree 是可选能力；查看代码、查看 Diff、打开终端验证不是第一阶段闭环的必要条件，可以作为用户在完成时按需操作的辅助能力。  
_Novelty_: MVP 不以“类 VS Code 全功能工作台”为目标，而是先证明 Issue 能驱动 Agent 执行流程，形成可追踪、可交互、可结束的本地任务生命周期。

**[Agent #5]：第一阶段采用结构化事件型 Agent Session**  
_Concept_: 第一阶段的 Agent Session 不只是嵌入终端输出，而是需要识别并记录 running、waiting_for_input、completed、failed 等状态，以支撑用户提醒和 Issue 状态流转。底层可以使用 PTY 启动 Codex、Claude Code 等本地 Agent，但上层需要一个 Session 状态机和事件识别层。  
_Novelty_: 产品把不透明的命令行 Agent 会话提升为可观察、可提醒、可追踪的任务执行过程。

**[Agent #6]：AgentAdapter 统一抽象层，MVP 首先支持 Codex**  
_Concept_: 产品定义统一的 AgentAdapter 接口，用来启动 Agent、发送用户输入、读取输出事件、识别状态、处理完成/失败、记录总结。不同本地 Agent 如 Codex、Claude Code 分别实现自己的 adapter。MVP 首先实现 Codex Adapter，后续再扩展 Claude Code 等其他 Agent。  
_Novelty_: 这让产品不是某个 Agent CLI 的简单外壳，而是一个可演进的本地 Agent 执行平台。

**[Reference #7]：Issue Kanban + Agent Runner 是已被验证的竞争方向**  
_Concept_: 重点参考方向收敛到 Issue 看板和 Agent Runner / AI Coding CLI。可参考项目包括 cline/kanban、BloopAI/vibe-kanban 和 multica-ai/multica。cline/kanban 强调本地 Web App、每张任务卡对应终端和 Worktree、并行运行 CLI agents、查看 diff、auto-commit 和 PR；vibe-kanban 强调 Kanban issues、agent workspace、diff review、内置预览、多个 coding agent 切换和 PR/merge，但项目 README 标明正在 sunset；Multica 强调把 coding agents 当作团队成员，支持 issue assignment、progress tracking、comments/blockers、local daemon runtime、cloud/self-host server 和多 Agent runtime。  
_Novelty_: 这些项目证明“Issue/看板 + Agent 执行”已经成为真实市场方向，但也意味着新产品需要明确差异化，不能只复刻 Agent Kanban。

**Sources:** cline/kanban GitHub README, BloopAI/vibe-kanban GitHub README, multica-ai/multica GitHub README, Multica Docs.

**[Positioning #8]：VS Code 形态的 Agent 工作台，而不是桌面版 Agent Kanban**  
_Concept_: 用户确认产品更像“VS Code 形态的 Agent 工作台”，而不是桌面版 vibe-kanban/Multica。看板是入口和状态视图，但产品体验重心应是一窗口工作台：左侧 Activity Bar、Workspace、Issue 生命周期、Agent Session、提醒、代码/Diff/Git/终端等开发上下文在同一窗口内顺滑切换。  
_Novelty_: 差异化不在“也能跑 Agent 卡片”，而在把 AI Agent 开发过程嵌入类似 IDE 的连续工作流中，让 Issue 从任务描述自然演进成可交互、可验证、可合并的开发过程。

**[Tech #9]：技术方向暂定 Tauri + React + Rust Core + SQLite**  
_Concept_: 用户倾向 Tauri 和 React，核心理由是多 Agent、多终端、多面板并发时需要控制内存占用。技术方向暂定为 Tauri 桌面壳、React 前端、Rust 后端核心、SQLite 本地数据库。Rust Core 负责进程/PTY 管理、AgentAdapter、Session 状态机、Git 操作和本地持久化；React 负责 VS Code 式 Activity Bar、Issue 看板、Agent Session UI、提醒和工作台布局。  
_Novelty_: 这套技术栈把 UI 复杂度留给 React，把高并发本地执行、状态识别、Git/Worktree/PTY 这些系统能力放在 Rust，契合本地 Agent 工作台而不是普通 Web Kanban。

**White Hat Fact:** VS Code 本身基于 Electron，但其内存表现来自长期工程优化；Electron 官方文档显示每个 BrowserWindow 会有独立 renderer 进程。Tauri 使用系统 WebView 和 Rust 后端，不打包完整 Chromium，因此更适合作为低内存优先的起点，但仍需实测多终端、多 Agent 并发下 WebView、PTY 和日志缓冲的实际占用。

**Sources:** Tauri Architecture Docs, Electron Process Model Docs, Electron Performance Docs, Microsoft VS Code shipping/build discussion.

**[Risk #10]：Codex 状态识别优先走 JSONL 事件，而不是 TUI 文本解析**  
_Concept_: 本机 Codex CLI 显示 `codex exec --json` 支持将事件以 JSONL 输出到 stdout，这为 MVP 的结构化事件型 Agent Session 提供了更稳定的基础。风险在于 `codex exec` 是非交互式模式，是否能完整覆盖用户期望的“中途请求确认、用户输入后继续执行”还需要原型验证；如果不能覆盖，需要在 Adapter 中区分 `exec-json` 模式和 `interactive-pty` 模式。  
_Novelty_: 关键架构策略不是从彩色终端文本里猜状态，而是优先使用 Codex 已暴露的结构化事件流；只有交互能力不足时，才退回 PTY/TUI 并把状态识别降级为启发式规则。

**[UX #11]：Agent Session 保留 Codex CLI 原生体验，结构化状态在后台驱动**  
_Concept_: 用户希望 Agent Session 的前台体验尽量像 Codex CLI，而不是被改造成过度结构化的时间线。MVP 应以嵌入式终端/PTY 体验为主，让用户获得原生 Codex 交互感；同时在后台通过 JSONL、进程状态、退出码或适配器规则提取结构化状态，用于 Issue 流转、提醒、完成判定和日志索引。  
_Novelty_: 产品不是替代 Codex CLI 的交互方式，而是把 Codex CLI 放进 Issue 驱动的工作台，并为它补上任务管理、状态追踪和提醒能力。

**[Constraint #12]：第一阶段必须内嵌终端，不接受外部终端作为主路径**  
_Concept_: 用户明确选择第一阶段必须内嵌终端，坚持一窗口体验。MVP 需要攻克 Tauri 后端 PTY 管理与前端 xterm.js 渲染，确保 Codex CLI 在内嵌终端中的交互体验足够接近原生终端。外部终端不作为第一阶段主路径。  
_Novelty_: 这把“像 VS Code 一样在一个窗口内完成 Agent 开发闭环”从设计愿景提升为 MVP 的硬约束。

**[IA #13]：Issue 与 Agent Session 分离，通过导航联动形成闭环**  
_Concept_: Issue 看板和 Agent Session 是两个独立的一等实体。左侧第一个菜单是 Issue 看板；点击 Issue 后打开详情弹窗，可查看和编辑 Issue 信息、当前阶段以及操作按钮。如果 Issue 正在运行，详情中提供链接跳转到第二个菜单 Agent。Agent 菜单显示当前正在运行和已完成的 Session 列表，并自动切换到当前 Issue 对应的 Session。Agent 页面中间是 Session 信息/内嵌 Codex 终端，左侧小区域展示 Issue 与 Session 基本信息卡片，右侧预留可伸缩区域用于未来展示变更代码或 Diff。  
_Novelty_: 产品不把 Issue 直接变成 Session 容器，而是保留 Issue 管理与 Agent 执行的边界；通过状态、链接和自动切换实现顺滑联动，既符合看板习惯，也符合 Agent 会话管理需求。

**[IA #14]：MVP 采用一 Issue 一 Session，Session 列表默认按状态组织**  
_Concept_: Agent 菜单中的 Session 列表默认按状态组织，例如 Running、Waiting、Completed、Failed；另一个视图可按 Agent 类型组织，并在同一 Agent 类型下按历史会话时间排序。MVP 中一个 Issue 只挂载一个 Session；若当前 Session 已关闭但执行出错，优先通过 Codex resume 在同一上下文中继续，而不是为同一 Issue 创建多个并列 Session。后续可在确有需要时引入 Session Attempt 或 Session Run 概念。  
_Novelty_: 这保持了第一阶段的数据模型简单性，同时保留恢复上下文和失败后继续执行的能力。

**Research Note:** 本机 Codex CLI 支持 `codex resume [SESSION_ID] [PROMPT]` 继续历史交互会话，支持 `codex fork [SESSION_ID] [PROMPT]` 分叉历史会话，也支持 `codex exec resume --json` 以 JSONL 方式继续非交互会话。外部参考中，Vibe Kanban 文档提到可创建多个 sessions，以绕开 conversation token limits 或并行运行不同 agents；Multica 文档中 task 是每次 agent run 的执行单元，并记录 session ID；Cline Kanban 文档强调每个 task card 有自己的 worktree 和 terminal。由此判断，“一 Issue 多 Session”是存在的高级需求，但不应进入 MVP 主模型。

**[State #15]：Session 生命周期与 Issue 阶段分离**  
_Concept_: MVP 中 Session 主状态只有 `running` 和 `completed` 两种。等待用户输入不作为 Session 主状态，而是 `running` 期间的事件或提醒。Session 结束后进入 `completed`，并记录结果 `success`、`failed`、`cancelled` 或 `unknown`；失败也算 Session completed，但不代表 Issue completed。Issue 阶段保持 `backlog`、`running`、`review`、`completed`：只要 Session 结束，Issue 进入 review，并在 review 中展示 Session result，由用户决定 resume、重跑、放弃或确认完成。  
_Novelty_: 这避免了执行生命周期和业务完成状态混淆，尤其避免“Agent 失败但 Issue 被误判完成”的问题。

### Phase 3 - Morphological Analysis + Solution Matrix

**[Tech #16]：MVP 技术矩阵与 PTY 方向**  
_Concept_: MVP 技术方向为 Tauri v2、React + TypeScript、VS Code-like Activity Bar、xterm.js、Rust Core、SQLite、本地 CodexAdapter、内嵌 PTY 运行 Codex CLI。PTY 方案先采用 `portable-pty` 做 Embedded Codex Terminal Spike；若 Codex TUI 体验、resize、输入、退出、跨平台兼容性不足，再评估 macOS/Linux Unix PTY 与 Windows ConPTY 的平台级实现。  
_Novelty_: 先用成熟跨平台 PTY 库验证最关键体验，把“内嵌 Codex 原生 CLI”这个最大风险前置，而不是先构建完整产品外壳。

**[Data #17]：MVP 本地数据模型保存关键事件与原始日志路径**  
_Concept_: MVP 核心实体包括 Workspace、Issue、AgentSession、SessionEvent 和 IssueAction/AuditLog。AgentSession 保存 `agent_type`、`codex_session_id`、`status`、`result`、`working_dir`、`command`、`started_at`、`completed_at` 等信息。SessionEvent 只保存关键事件，例如 process_started、process_exited、user_attention_requested、result_detected、input/output 摘要等；完整终端输出不逐字符写入 SQLite，而是写入原始日志文件，数据库保存日志文件路径。  
_Novelty_: 这避免高频终端输出拖垮本地数据库，同时保留可查询事件、状态流转和复盘能力。

**[Git #18]：通过 Completion Policy 让 Agent 自主提交自己的改动**  
_Concept_: 当 Issue 进入完成操作时，如果配置启用 `agent_auto_commit`，应用向 Codex 注入 completion prompt / skill / hook，要求它检查当前工作区改动，识别哪些改动属于本次 Issue/Session，只提交这些改动，并生成符合规范的 commit message。非本次 Agent 修改的内容不得提交。应用负责触发、记录和校验结果，不直接默认执行 `git add .`。配置命名为 `completion_policy = manual | agent_auto_commit`，并支持全局级、Workspace 级、项目级覆盖。  
_Novelty_: 自动提交不是应用层 Git 脚本，而是 Agent 工作流的一部分，利用 Agent 对上下文和文件改动的理解降低误提交概率。

**Validation:** 应用在 completion 前后记录 `git status`，检测是否产生新 commit，并把 commit hash 写入 IssueAction。若 Agent 未提交成功，Issue 保持在 review 或提示用户处理。

## Checkpoint - 2026-06-02

### 已确认产品定位

- 产品定位为 **VS Code 形态的 Agent 工作台**，不是桌面版 Agent Kanban。
- 核心工作流是 **Issue 驱动的一窗口开发闭环**。
- 第一阶段目标用户是 AI Coding 重度用户、独立开发者、一两人协作小团队。
- 第一阶段为本地版本，第二阶段接入 GitHub/GitLab，第三阶段引入自有云服务。

### 已确认 MVP 边界

- MVP 必须支持本地 Issue 创建、分配 Codex Agent、内嵌 Agent Session 执行交互、Session 完成提醒、Issue review、Issue 完成。
- 第一阶段不要求完整代码浏览、Diff 查看、Git 历史、插件系统、终端恢复。
- Worktree 第一阶段可选，但 auto commit / 合并策略后续最好与 Worktree 结合。
- 第一阶段必须内嵌终端，不接受外部终端作为主路径。

### 已确认信息架构

- 左侧 Activity Bar 至少包含 `Issues` 和 `Agents`。
- Issue 与 Agent Session 是分离实体，通过关联关系和跳转联动。
- Issue 看板中点击 Issue 打开详情弹窗，可查看/编辑 Issue、查看状态和操作按钮。
- 如果 Issue 正在运行，详情中提供链接跳转到 Agent 菜单。
- Agent 菜单显示 Session 列表，默认按状态组织，也可按 Agent 类型组织并按历史排序。
- Agent 页面中间为 Session 信息/内嵌 Codex 终端，左侧为 Issue/Session 信息卡片，右侧预留可伸缩区域用于未来展示代码变更/Diff。

### 已确认状态模型

- 一个 Issue 对应一个 Agent Session。
- 如果 Session 关闭但执行失败，优先通过 Codex `resume` 在同一上下文中继续。
- Session 主状态只有 `running` 和 `completed`。
- 等待用户输入属于 `running` 期间的事件/提醒，不作为 Session 主状态。
- Session 结果为 `success`、`failed`、`cancelled` 或 `unknown`。
- Issue 状态为 `backlog`、`running`、`review`、`completed`。
- Session 结束后 Issue 进入 `review`，由用户决定 resume、放弃、或确认完成。

### 已确认技术方向

- 桌面框架：Tauri v2。
- 前端：React + TypeScript。
- 后端核心：Rust。
- 本地数据库：SQLite。
- 终端前端：xterm.js。
- PTY 方向：先用 `portable-pty` 做 Embedded Codex Terminal Spike。
- 首个 Agent：Codex。
- Agent 架构：定义统一 `AgentAdapter`，MVP 先实现 CodexAdapter。
- Codex 状态识别优先调研/利用 JSONL 事件；前台体验保持 Codex CLI 原生感。

### 已确认数据与日志策略

- 核心实体包括 Workspace、Issue、AgentSession、SessionEvent、IssueAction/AuditLog。
- 数据库保存关键事件和原始日志文件路径。
- 不把完整终端逐字符输出写入 SQLite，避免高频输出拖垮数据库。
- 保存 Codex session id，以支持 resume。

### 已确认 Completion Policy

- 配置项命名为 `completion_policy = manual | agent_auto_commit`。
- 支持全局级、Workspace 级、项目级覆盖。
- `agent_auto_commit` 不是应用直接执行 `git add .`。
- 当 Issue 完成时，应用向 Codex 注入 completion prompt / skill / hook，让 Agent 检查改动，只提交本次 Issue/Session 相关改动，并生成规范 commit message。
- 应用负责记录提交前后状态、commit hash 和 IssueAction。

### 下一步建议

1. 细化 MVP 用户故事和验收标准。
2. 设计第一阶段技术架构图和模块边界。
3. 拆出 Spike 任务：Embedded Codex Terminal、Codex Session State、Issue-Session Binding。
4. 形成第一版开发计划。

## Continuation - 2026-06-03

### Phase 4 - Action Planning

**[Story #19]：Workspace 必须绑定 Git 仓库**
_Concept_: MVP 创建 Workspace 时必须选择本地 Git 仓库目录。系统校验目录是否为 Git 仓库；非 Git 目录不允许创建 Workspace。创建成功后保存 `workspace_id`、`name`、`repo_path`、`created_at`、`last_opened_at`，进入 Workspace 后默认显示 Issue 看板。
_Novelty_: 这让 Completion Policy、Codex 执行、后续 GitHub/GitLab 同步都拥有明确 Git 上下文。

**[Story #20]：MVP Issue 字段保持极简**
_Concept_: 本地 Issue 只包含 `title`、`description`、`status`、`created_at`、`updated_at` 等必要字段。新 Issue 默认进入 `backlog`。暂不做 priority、label、assignee、milestone，避免第一阶段滑向完整项目管理工具。
_Novelty_: Issue 的目标是驱动 Agent 工作流，而不是复刻 Jira/Linear。

**[Story #21]：Issue 详情弹窗与基础国际化**
_Concept_: 点击 Issue 卡片打开详情弹窗，支持查看和编辑 `title`、`description`、`status`、`updated_at`，显示关联 Session 信息和操作按钮。`backlog` 状态显示 `Run`，`running/review` 且存在 Session 时显示 `Open Session`，`running` 状态显示 `Mark Review`，`review` 状态按 completion policy 显示 `Complete Manually` 或 `Complete with Agent Commit`。MVP 不实现 `Reopen`。应用 UI 支持 `zh-CN` 与 `en-US`，中文状态文案为：`backlog=待办`、`running=运行中`、`review=待验收`、`completed=已完成`。
_Novelty_: UI 命令不把 Codex 写死，保留多 Agent 语义；从 MVP 开始建立 i18n 约束，避免后续大规模替换硬编码文案。

**[Story #22]：Agent Profile 管理与 Run Prompt 编排**
_Concept_: 用户可以创建 Agent Profile，例如 Codex Agent。Profile 包含 `name`、`agent_type`、`command`、`default_skill`、`default_args`、`prompt_template`。点击 Issue 的 `Run` 后，用户选择 Agent Profile，系统基于 Issue 内容、默认 skill、prompt template 和应用补充说明生成最终 prompt，并在 Run Dialog 中展示一个可编辑的最终 prompt 文本框。组成来源通过可展开区域展示。
_Novelty_: `Run` 不直接硬编码 Codex，而是通过可管理 Agent 配置驱动；用户始终能看到并修改真正发送给 Agent 的 prompt。

**[Prompt #23]：prompt_template 用于生成初始 prompt，并保存来源快照**
_Concept_: `prompt_template` 是 Agent Profile 的默认任务包装器，用模板变量组合 `{{skill}}`、`{{issue.title}}`、`{{issue.description}}`、`{{workspace.name}}`、`{{workspace.repo_path}}`、`{{app.instructions}}` 等内容。若 `default_skill = openspec-proposal`，模板可生成 `$openspec-proposal <issue内容>` 形式的 prompt。Run Dialog 显示一个最终 prompt 文本框，用户确认后保存最终 prompt、Agent Profile ID、启动命令和来源快照。
_Novelty_: 历史 Session 不只引用当前 Agent Profile，而是保存当时的 prompt 快照，保证可追溯性。

**[Story #24]：Agent Profile 支持全局配置与 Workspace 覆盖**
_Concept_: Agent 配置分为全局 AgentProfile 和 WorkspaceAgentOverride。全局配置保存 `name`、`agent_type`、`command`、`default_args`、`default_skill`、`prompt_template`、`enabled`；Workspace 可覆盖 `default_args`、`default_skill`、`prompt_template`、`enabled`。Run Dialog 使用 Workspace 覆盖后的生效配置，并可展开展示配置来源。
_Novelty_: 用户可以复用同一个本地 Codex 命令，同时让不同仓库使用不同默认 skill 和 prompt 模板。

**[Story #25]：Agent command 自动检测与手动路径兜底**
_Concept_: 创建 Codex Agent Profile 时，系统通过用户 login shell 检测 `codex`，例如执行 `command -v codex`，以贴近用户真实终端环境。若自动检测失败，用户可以手动填写 command path，并通过 Test 验证命令可执行。保存时 command 不可用则阻止保存或提示错误。
_Novelty_: 这解决 macOS GUI App 的 PATH 与用户终端 PATH 不一致问题，兼容 nvm、brew、私有安装路径等环境。

**[Story #26]：Run Dialog 在进程成功启动后才切换 Issue 状态**
_Concept_: 点击 Issue 的 `Run` 后打开 Run Dialog，用户选择 Agent Profile 并确认最终 prompt。默认 prompt 不包含 Issue title，只使用 Issue description、skill 和 app instructions；只有 `prompt_template` 显式引用 `{{issue.title}}` 时，title 才进入 prompt。用户点击 Start 后，系统尝试启动 Agent 进程；只有进程成功启动后，才创建/激活 Session 并将 Issue 状态改为 `running`。启动失败时 Issue 保持 `backlog`。
_Novelty_: 这避免启动失败导致 Issue 错误进入运行中状态，同时保持 prompt 对用户透明。

**[Story #27]：Agent Session 三栏工作区与 Codex Native Session View**
_Concept_: Agent 页面采用三栏布局：左侧 Issue Panel，中间 Session Panel，右侧可折叠 Diff Panel。左侧显示当前 Session 关联 Issue 的基本信息和状态操作；中间是 Codex Native Session View，通过嵌入式 PTY 运行 Codex CLI，呈现 Codex 原生 TUI，不额外实现底部输入框；右侧预留未来展示 changed files、diff preview 和 commit 信息。
_Novelty_: 应用做 Codex 原生 TUI 的容器和工作流外壳，而不是重做 Codex 的聊天/终端 UI；Issue 操作、Agent 交互、代码变更各自有清晰区域。

**[State #28]：Session completed 只由进程结束决定，等待用户输入用 attention 标记**
_Concept_: Session 主状态保持 `running | completed`。只要 Codex 进程仍在运行，即使它停下来等待用户确认设计、审批命令或继续输入，Session 仍为 `running`。运行期增加 `attention = none | requested` 标记，用于表达需要用户关注。`completed` 的硬条件是 Codex 进程结束；Session result 只有在 completed 后才记录为 `success`、`failed`、`cancelled` 或 `unknown`。Agents 列表可提供 `Needs Attention` 分组或过滤，但它不是 Session 主状态。
_Novelty_: 这同时保持状态模型简单，并能表达 Codex 中途需要用户交互的真实场景，避免把“等待确认”误判为完成。

**Implementation Note:** MVP 的 attention 识别可先采用用户手动标记 + 启发式输出识别，后续通过 CodexAdapter Spike 验证是否可从 Codex JSONL 或结构化事件中稳定识别。

**[State #29]：修订 - Session 不因 Codex 告一段落而关闭，Issue 完成后才关闭 Session**
_Concept_: 对内嵌 Codex 原生 TUI 来说，Codex 执行“告一段落”不等于 Session 关闭。Session 应持续存在，方便用户在 review 后继续回到同一个 Codex TUI 中交互。Session 状态修订为 `running`、`closed`、`crashed`，可选 `stopped`；只要 Codex 进程仍然活着，Session 就是 `running`。Issue 状态仍为 `backlog`、`running`、`review`、`completed`。`review` 表示 Codex 当前结果等待用户验收，但 Session 仍可保持 running。只有用户点击完成 Issue，系统执行 completion policy 后，才关闭 Session 并将 Issue 标记为 completed。
_Novelty_: 这把“Agent 执行过程”和“Issue 验收完成”彻底分离，避免用户 review 发现问题后丢失原有 Codex 上下文。

**Flow Update:** MVP 中 Issue 从 `running` 进入 `review` 优先由用户手动点击 `Mark Review` 触发。后续可通过 Codex 输出或结构化事件提示“可能可以验收”，但不自动关闭 Session。若用户在 `review` 状态继续向 Codex 输入修正需求，Issue 保持 `review`，不自动回到 `running`。

**[Review #30]：review 阶段允许继续让 Codex 修正，不退回 running**
_Concept_: `review` 表示 Issue 已进入验收阶段，不表示禁止继续修改。用户在 review 中发现问题时，可以继续在当前 Codex Session 中要求修正，Issue 仍保持 `review`，不自动退回 `running`，也不要求用户再次点击 `Mark Review`。`running` 只表示首次开发阶段；`completed` 只在用户确认验收通过并完成收尾后进入。
_Novelty_: 这匹配真实验收流程：验收、修正、再验收都属于 review 阶段，避免反复切换状态造成额外操作。

**[Completion #31]：Complete with Agent Commit 使用轻量确认面板，确认后直接交给 Codex 执行**
_Concept_: 当 `completion_policy = agent_auto_commit` 时，review 状态显示 `Complete with Agent Commit`。用户点击后，应用自动检测当前 Issue、Session、Workspace、Git status、HEAD commit、changed files 和策略配置，弹出轻量确认面板让用户选择：让 Agent 只提交本 Issue 相关改动、不提交直接完成、或取消保持待验收。若有未提交改动，默认选中“让 Agent 只提交本 Issue 相关改动”；若无未提交改动，显示“直接完成”。发送给 Codex 的 completion prompt 默认隐藏，可展开查看，但不要求用户编辑。用户确认后，应用直接把整理好的指令发送给当前 Codex Session。
_Novelty_: 完成动作保持顺滑：用户做策略选择，应用整理上下文和提示词，Codex 执行实际提交，应用负责检测 commit hash 并决定是否关闭 Issue。

**Completion Result:** 若检测到新 commit，记录 commit hash，关闭 Codex Session，Issue 进入 `completed`，AgentSession 进入 `closed`。若未检测到新 commit 且用户选择 Agent 提交，Issue 保持 `review` 并提示未检测到提交；若用户选择不提交直接完成，则跳过提交检测并关闭 Issue/Session。

**[UI #32]：左侧 Issue Panel 是当前 Session 的任务控制面板**
_Concept_: Agent 页面左侧 Issue Panel 不承担完整看板职责，而是围绕当前 Agent Session 展示关联 Issue 的最小控制面板：Issue 标题、状态、更新时间、Session 状态、attention 标记、Completion Policy、Git 摘要和当前可执行按钮。全量 Issue 管理仍在 Issues Activity 中完成。
_Novelty_: 左侧面板不是又一个详情页，而是 Agent 工作区中的任务驾驶舱，让用户在不离开 Codex Native Session View 的情况下完成状态切换、验收和完成收尾。

**Issue Panel Button State Table - MVP**

| Issue 状态 | Session 状态 | 条件 | 主按钮 | 次按钮 | 禁用/提示规则 | 状态变化 |
| --- | --- | --- | --- | --- | --- | --- |
| `backlog` | 无 Session | 至少有一个 enabled Agent Profile | `Run` | `Edit Issue` | 若无可用 Agent Profile，`Run` 禁用并提示先配置 Agent | 启动成功后 Issue -> `running`，Session -> `running` |
| `backlog` | 无 Session | Agent command 检测失败 | `Run` 禁用 | `Configure Agent` | 显示 command 不可用原因和 Test 入口 | 无状态变化 |
| `backlog` | 已有关联 Session | 异常历史数据或恢复场景 | `Open Session` | `Run` 禁用 | 提示该 Issue 已有关联 Session，MVP 不允许创建第二个 Session | 无状态变化 |
| `running` | `running` | Codex 进程仍活着，attention=`none` | `Open Session` | `Mark Review` | `Open Session` 在当前 Agent 页时可显示为当前态；`Mark Review` 需要用户手动判断可验收 | 点击 `Mark Review` 后 Issue -> `review`，Session 保持 `running` |
| `running` | `running` | attention=`requested` | `Open Session` | `Mark Review` | 面板显示 `Needs Attention` 标记；不改变主按钮排序 | 用户处理 Codex 交互后 attention -> `none` |
| `running` | `crashed` | Codex 进程异常退出 | `Resume Session` | `Mark Review` | `Resume Session` 使用 Codex resume 同一 session id；若用户不继续，可手动编辑 Issue 或保留当前状态 | resume 成功后 Session -> `running`；`Mark Review` 后 Issue -> `review` |
| `review` | `running` | `completion_policy=manual` | `Complete Manually` | `Open Session` | `Complete Manually` 弹确认面板，不要求 commit 检测 | 确认后关闭 Session，Issue -> `completed`，Session -> `closed` |
| `review` | `running` | `completion_policy=agent_auto_commit` 且有未提交改动 | `Complete with Agent Commit` | `Complete without Commit`、`Open Session` | 默认建议 Agent Commit；completion prompt 默认隐藏，可展开查看 | 检测到新 commit 后 Issue -> `completed`，Session -> `closed`；未检测到 commit 则 Issue 保持 `review` |
| `review` | `running` | `completion_policy=agent_auto_commit` 且无未提交改动 | `Complete` | `Open Session` | 说明当前无未提交改动，将直接完成并关闭 Session | Issue -> `completed`，Session -> `closed` |
| `review` | `crashed` | Codex 异常退出但 Issue 待验收 | `Resume Session` | `Complete Manually` | 若选择完成，需提示 Session 已异常退出且可能无法继续 Agent Commit | resume 成功后 Session -> `running`，Issue 保持 `review`；手动完成后 Issue -> `completed` |
| `completed` | `closed` | 正常完成 | `View Summary` | `Open Log` | MVP 不提供 `Reopen`；所有编辑和运行按钮禁用 | 无状态变化 |
| `completed` | `crashed` 或 `running` | 异常数据不一致 | `View Summary` | `Open Log` | 显示状态不一致警告，提供诊断信息，不在 MVP 中自动修复 | 无状态变化 |

**Button Copy - zh-CN / en-US**

| 命令语义 | zh-CN | en-US |
| --- | --- | --- |
| run_issue | 运行 | Run |
| open_session | 打开会话 | Open Session |
| mark_review | 标记待验收 | Mark Review |
| resume_session | 继续会话 | Resume Session |
| complete_manual | 手动完成 | Complete Manually |
| complete_agent_commit | Agent 提交并完成 | Complete with Agent Commit |
| complete_without_commit | 不提交直接完成 | Complete without Commit |
| view_summary | 查看总结 | View Summary |
| open_log | 打开日志 | Open Log |
| configure_agent | 配置 Agent | Configure Agent |

**Interaction Rules**

1. Issue Panel 中同一时间最多突出一个主按钮，避免用户在 Agent 工作区里被多个完成路径干扰。
2. `Open Session` 在当前 Session 已经打开时不是跳转按钮，而是当前态提示；仍保留在表中是为了 Issue 详情弹窗和 Agents 列表复用同一命令模型。
3. `review` 阶段继续向 Codex 输入修正需求时，Issue 不退回 `running`；左侧面板仍显示完成类按钮。
4. `Complete with Agent Commit` 不直接执行 Git 命令，只向当前 Codex Session 发送 completion prompt，并由应用在前后检测 `git status`、HEAD 和新 commit。
5. MVP 不实现 `Reopen`、多 Session Attempt、PR/MR 创建和完整 Diff 操作；这些能力只作为后续阶段入口保留。

**[Stories #33]：MVP 用户故事按 Issue 到 Session 闭环组织**
_Concept_: MVP 用户故事不按技术模块拆，而按用户完成一次 Agent 开发任务的路径拆：打开 Git Workspace、配置 Agent、创建 Issue、运行 Agent、在内嵌 Codex 中交互、进入 review、继续修正、完成并关闭。每个故事都必须能被本地应用状态、SQLite 记录、进程状态或 Git 状态验证。
_Novelty_: 用户故事直接服务最短闭环，避免把第一阶段扩散成“做一个 IDE”。

### MVP 用户故事与验收标准

**US-01：创建并打开 Git Workspace**
作为用户，我希望选择一个本地 Git 仓库创建 Workspace，以便所有 Issue、Agent Session 和完成策略都有明确仓库上下文。

**验收标准：**

- 用户选择目录后，系统校验该目录是 Git 仓库。
- 非 Git 目录不能创建 Workspace，并显示明确错误。
- 创建成功后保存 `workspace_id`、`name`、`repo_path`、`created_at`、`last_opened_at`。
- 打开 Workspace 后默认进入 Issues Activity。

**US-02：配置 Codex Agent Profile**
作为用户，我希望应用能检测本机 `codex` 命令并保存 Agent Profile，以便后续 Issue 可以选择 Codex 执行。

**验收标准：**

- 系统通过 login shell 检测 `command -v codex`。
- 检测失败时允许用户手动填写 command path 并执行 Test。
- command 不可执行时不能保存 enabled Profile。
- Profile 至少保存 `name`、`agent_type`、`command`、`default_args`、`default_skill`、`prompt_template`、`enabled`。

**US-03：创建和编辑本地 Issue**
作为用户，我希望在 Workspace 内创建极简 Issue，以便把待完成工作交给 Agent。

**验收标准：**

- Issue 至少包含 `title`、`description`、`status`、`created_at`、`updated_at`。
- 新 Issue 默认状态为 `backlog`。
- 用户可以在 Issue 详情弹窗中编辑 `title` 和 `description`。
- MVP 不提供 priority、label、assignee、milestone。

**US-04：从 Issue 运行 Agent**
作为用户，我希望从 backlog Issue 点击 `Run`，选择 Agent Profile，并确认最终 prompt 后启动 Codex。

**验收标准：**

- 点击 `Run` 打开 Run Dialog。
- Run Dialog 显示生效 Agent Profile、prompt 来源和可编辑最终 prompt。
- 默认 prompt 不包含 Issue title，除非 `prompt_template` 显式引用 `{{issue.title}}`。
- 只有 Agent 进程成功启动后，才创建/激活 AgentSession 并把 Issue 改为 `running`。
- 启动失败时 Issue 保持 `backlog`，并记录失败原因。

**US-05：在内嵌 Codex Native Session View 中交互**
作为用户，我希望在 Agent 页面中看到接近原生 Codex CLI 的内嵌终端，以便不中断 Codex 的原有交互体验。

**验收标准：**

- Agent 页面采用左 Issue Panel、中 Session Panel、右可折叠 Diff Panel 的布局。
- Session Panel 使用 xterm.js 承载 PTY 输出和输入。
- Codex 进程由 Rust Core 通过 PTY 启动，工作目录为 Workspace repo path 或后续 worktree path。
- 用户输入直接进入 Codex TUI，不额外实现独立聊天输入框。
- Session 保存 `codex_session_id`、启动命令、最终 prompt 快照、日志文件路径和关键事件。

**US-06：识别需要用户关注的运行中 Session**
作为用户，我希望当 Codex 需要确认或输入时能被提醒，以便及时回到对应 Session。

**验收标准：**

- Session 主状态保持 `running`，不因等待输入而变成 completed。
- 系统支持 `attention = none | requested`。
- MVP 可以通过手动标记和启发式输出识别设置 attention。
- Issues、Agents 列表和 Issue Panel 能显示 Needs Attention。

**US-07：手动将 Issue 标记为 review**
作为用户，我希望在认为 Codex 已经产出可验收结果时手动点击 `Mark Review`，以便进入验收阶段但保留当前 Codex 上下文。

**验收标准：**

- 只有 `running` Issue 且存在关联 Session 时显示 `Mark Review`。
- 点击后 Issue 状态变为 `review`。
- AgentSession 仍保持 `running`，Codex 进程不关闭。
- 系统记录 IssueAction，包含触发时间和操作者。

**US-08：review 阶段继续修正**
作为用户，我希望在 review 中发现问题后继续让 Codex 修正，以便无需重新创建 Session 或回退状态。

**验收标准：**

- `review` Issue 仍可打开当前 Codex Session。
- 用户继续输入修正请求后，Issue 仍保持 `review`。
- 左侧 Issue Panel 仍显示完成类按钮。
- 所有修正交互继续写入同一个 Session 日志和事件流。

**US-09：使用 Agent Commit 完成 Issue**
作为用户，我希望在 review 通过后点击 `Complete with Agent Commit`，让当前 Codex 只提交本 Issue 相关改动并完成 Issue。

**验收标准：**

- 仅当 Issue 为 `review`、Session 为 `running`、`completion_policy=agent_auto_commit` 时显示。
- 点击后应用检测 Git status、HEAD、changed files、Issue 和 Session 上下文。
- 应用弹出轻量确认面板，默认隐藏 completion prompt，但允许展开查看。
- 用户确认后，completion prompt 发送给当前 Codex Session。
- 应用检测到新 commit 后记录 commit hash，关闭 Session，并将 Issue 改为 `completed`。
- 若未检测到新 commit，Issue 保持 `review` 并提示用户处理。

**US-10：无提交或手动策略下完成 Issue**
作为用户，我希望在没有未提交改动或选择手动完成时，也能关闭 Issue 和 Session。

**验收标准：**

- `completion_policy=manual` 时 review 状态显示 `Complete Manually`。
- `agent_auto_commit` 且无未提交改动时显示 `Complete`。
- 用户确认后关闭 Codex Session，将 AgentSession 标记为 `closed`，Issue 标记为 `completed`。
- 完成动作写入 IssueAction/AuditLog。

**US-11：查看已完成 Issue 的摘要和日志**
作为用户，我希望完成后还能查看 Issue 摘要、关联 Session 和日志，以便复盘 Agent 做了什么。

**验收标准：**

- completed Issue 不显示 Run、Mark Review、Complete 类按钮。
- Issue Panel 或详情弹窗显示 `View Summary` 和 `Open Log`。
- Summary 至少展示 Issue 信息、Session 时间、result、commit hash 和日志路径。
- MVP 不支持 Reopen。

**US-12：本地持久化和恢复基础状态**
作为用户，我希望关闭并重新打开应用后能恢复 Workspace、Issue、Session 元数据和日志索引。

**验收标准：**

- SQLite 保存 Workspace、Issue、AgentSession、SessionEvent、IssueAction/AuditLog。
- 原始终端日志保存为文件，数据库只保存路径和摘要事件。
- 应用重启后能打开最近 Workspace 并展示 Issue 看板。
- 对仍在运行的 PTY 进程，MVP 可以标记为 `crashed` 或 `stopped`，不要求跨应用重启恢复活进程。

### MVP 开发切片建议

1. **Slice A - Workspace + Issue 基础闭环**：Git Workspace 校验、Issue CRUD、Issues Activity、Issue 详情弹窗。
2. **Slice B - Agent Profile + Run Dialog**：Codex command 检测、Profile 保存、prompt_template 渲染、启动前确认。
3. **Slice C - Embedded Codex Session Spike**：Tauri/Rust PTY、xterm.js、resize/input/output、日志文件写入。
4. **Slice D - Issue-Session 状态联动**：Run 成功后进入 running、Issue Panel、Mark Review、attention 标记。
5. **Slice E - Completion Policy**：manual 完成、agent_auto_commit 确认面板、completion prompt 注入、commit hash 检测、Session 关闭。
6. **Slice F - 恢复与复盘**：应用重启后的 Workspace/Issue/Session 元数据恢复、completed Summary、Open Log。

## Continuation - 2026-06-03 - Architecture and Spike Planning

### Phase 4 - Action Planning Continued

**[Architecture #34]：MVP 模块边界按“桌面壳、前端工作台、Rust Core、SQLite、文件日志”分层**
_Concept_: MVP 不先设计插件平台或完整 IDE 内核，而是把第一阶段拆成五个稳定边界：Tauri 桌面壳负责窗口、权限和系统集成；React Workbench 负责 Activity Bar、Issues、Agents、Run Dialog 和 Issue Panel；Rust Core 负责 PTY、进程、AgentAdapter、Git 查询和命令检测；SQLite 负责结构化状态；文件日志负责高频终端输出。
_Novelty_: 这让复杂度集中在真正的风险点：内嵌 Codex Session 和 Issue-Session 状态联动，而不是过早把产品做成通用平台。

**MVP 模块职责表**

| 模块 | MVP 职责 | 明确不做 |
| --- | --- | --- |
| Desktop Shell | Tauri v2 app、窗口生命周期、文件夹选择、基础设置入口 | 多窗口工作区、插件宿主、云同步 |
| React Workbench | Activity Bar、Issues Activity、Agents Activity、Run Dialog、Issue Panel、xterm 容器 | 完整代码编辑器、完整 Git GUI、复杂看板字段 |
| Rust Core | Workspace 校验、Agent command 检测、PTY 进程管理、AgentAdapter、Git status/HEAD 检测、SQLite 命令接口 | 直接自动提交、复杂 merge/rebase、长期后台 daemon |
| SQLite Store | Workspace、Issue、AgentProfile、AgentSession、SessionEvent、IssueAction/AuditLog | 逐字符终端日志、跨设备同步 |
| Log Files | 保存原始终端输出、按 session_id 组织日志路径 | 结构化查询、富文本渲染 |
| CodexAdapter | 启动 Codex、写入 prompt、resume、注入 completion prompt、解析基础事件 | 重写 Codex UI、完全可靠理解 TUI 所有状态 |

**[Architecture #35]：前端状态不直接等于数据库状态，使用 Command/Event 同步模型**
_Concept_: React UI 不应直接拼装业务状态并写库，而是调用 Tauri command，例如 `create_issue`、`start_agent_session`、`mark_issue_review`、`complete_issue_with_policy`。Rust Core 执行动作后写 SQLite，并通过事件通知前端刷新。前端可以做乐观 loading，但最终以 Core 返回状态和订阅事件为准。
_Novelty_: 这避免前端、PTY 进程和数据库三方各自维护状态，尤其降低 Agent 进程启动失败但 Issue 已变 running 的风险。

**Command/Event 草案**

| UI 动作 | Tauri command | Core 输出事件 | 持久化记录 |
| --- | --- | --- | --- |
| 创建 Workspace | `create_workspace(repo_path)` | `workspace_created` | Workspace |
| 创建 Issue | `create_issue(workspace_id, input)` | `issue_created` | Issue、IssueAction |
| 保存 Agent Profile | `save_agent_profile(input)` | `agent_profile_saved` | AgentProfile |
| 测试 command | `test_agent_command(command)` | `agent_command_tested` | 可选 AuditLog |
| 启动 Session | `start_agent_session(issue_id, profile_id, prompt)` | `session_started` / `session_start_failed` | AgentSession、SessionEvent、IssueAction |
| 标记 review | `mark_issue_review(issue_id)` | `issue_review_marked` | Issue、IssueAction |
| 注入完成 prompt | `complete_issue_with_policy(issue_id, option)` | `completion_prompt_sent` / `issue_completed` / `completion_failed` | SessionEvent、IssueAction |
| 关闭 Session | `close_agent_session(session_id)` | `session_closed` | AgentSession、SessionEvent |

**[Architecture #36]：数据模型增加 WorkspaceSettings 与 CompletionAttempt**
_Concept_: 前面已确认核心实体，但 completion policy 的可追溯性需要单独记录每次完成尝试。MVP 可以增加 `WorkspaceSettings` 保存 workspace 级 completion_policy、默认 AgentProfile、语言等设置；增加 `CompletionAttempt` 或用 IssueAction 子类型记录完成前 HEAD、完成后 HEAD、changed files 摘要、用户选择、是否检测到新 commit、commit hash 和失败原因。
_Novelty_: 自动完成最容易造成“到底提交了什么”的信任问题；把每次 completion attempt 结构化保存，比只在日志里留下 Codex 输出更可审计。

**MVP 数据表草案**

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `workspaces` | `id`、`name`、`repo_path`、`created_at`、`last_opened_at` | Git 仓库入口 |
| `workspace_settings` | `workspace_id`、`completion_policy`、`default_agent_profile_id`、`locale` | Workspace 级覆盖 |
| `issues` | `id`、`workspace_id`、`title`、`description`、`status`、`created_at`、`updated_at` | 极简本地 Issue |
| `agent_profiles` | `id`、`name`、`agent_type`、`command`、`default_args`、`default_skill`、`prompt_template`、`enabled` | 全局 Agent 配置 |
| `workspace_agent_overrides` | `workspace_id`、`agent_profile_id`、覆盖字段 | Workspace Profile 覆盖 |
| `agent_sessions` | `id`、`issue_id`、`agent_profile_id`、`codex_session_id`、`status`、`attention`、`working_dir`、`command_snapshot`、`prompt_snapshot`、`log_path`、`started_at`、`closed_at` | 一 Issue 一 Session |
| `session_events` | `id`、`session_id`、`event_type`、`payload_json`、`created_at` | 关键事件 |
| `issue_actions` | `id`、`issue_id`、`action_type`、`payload_json`、`created_at` | 状态流转和审计 |
| `completion_attempts` | `id`、`issue_id`、`session_id`、`option`、`head_before`、`head_after`、`changed_files_json`、`commit_hash`、`result`、`error`、`created_at` | 完成策略审计 |

**[Spike #37]：第一优先级是 Embedded Codex Terminal Spike**
_Concept_: 最大未知不是 React 布局，也不是 SQLite，而是 Codex CLI 在 Tauri + xterm.js + Rust PTY 中是否有足够接近原生终端的体验。因此第一 Spike 只做一个可丢弃原型：打开一个窗口、启动 `codex`、xterm 输入输出、resize、Ctrl+C、退出检测、日志写入。
_Novelty_: 先验证产品体验的“硬核地基”，避免先写大量业务 UI 后发现内嵌 Codex TUI 无法接受。

**Spike 验收清单：**

- 能从 GUI 启动 `codex`，并继承用户 login shell 下可用的 PATH。
- xterm.js 能显示 Codex TUI 的主要界面、颜色和交互。
- 键盘输入、Enter、方向键、Ctrl+C、粘贴可用。
- 窗口 resize 后 PTY size 同步，Codex TUI 不严重错位。
- Codex 退出后 Rust Core 能获得 exit code。
- 原始输出能写入 session log 文件。
- macOS 先通过；Windows/Linux 记录兼容性风险，不阻塞 MVP 设计。

**[Spike #38]：第二优先级是 Codex Session Resume 与 completion prompt 注入 Spike**
_Concept_: MVP 的核心承诺是 review 后继续修正和完成时交给当前 Codex 执行，因此必须验证两件事：当前内嵌 TUI 中能否持续写入新 prompt；如果进程异常退出，能否用 `codex resume` 回到同一上下文。这个 Spike 不做 UI，只在 Rust Core 或脚本层验证命令、session id 捕获和 prompt 注入路径。
_Novelty_: 它验证“Session 不随 Codex 告一段落关闭”的技术可行性，而不是只验证 Codex 能跑一次。

**Spike 验收清单：**

- 能捕获或推断 Codex session id，并保存到 AgentSession。
- 在同一个 PTY 进程中能向 Codex 发送后续修正 prompt。
- 能向当前 Session 注入 completion prompt，而不是启动一个无上下文的新进程。
- Codex 异常退出后，能通过 `codex resume <session_id>` 或等价方式恢复上下文。
- 无法稳定恢复时，明确降级策略：保留日志、提示用户手动 resume、Issue 保持 review/running。

**[Spike #39]：第三优先级是 Git Commit Detection Spike**
_Concept_: 因为应用不直接 `git add .`，所以完成策略的可靠性来自提交前后检测。Spike 需要验证在普通仓库中读取 HEAD、changed files、untracked files、新 commit hash 的方式，并定义“检测到新 commit”的准确条件。
_Novelty_: 这把 Agent Commit 从“信任 Agent 说已提交”改成“应用用 Git 状态验证结果”，形成用户可相信的完成闭环。

**Spike 验收清单：**

- completion 前记录 `HEAD`、`git status --porcelain`、changed files。
- completion 后重新读取 `HEAD` 和 status。
- 若 `HEAD` 改变，记录新 commit hash。
- 若 `HEAD` 未变但用户选择 Agent Commit，Issue 保持 `review` 并记录 `no_commit_detected`。
- 若出现 merge/rebase/cherry-pick 进行中状态，MVP 提示用户手动处理，不自动完成。

**[Roadmap #40]：第一阶段开发路线按“先可跑，再可追踪，再可完成”推进**
_Concept_: MVP 不应该先把所有页面都画完，而应先做最短可运行路径：Workspace -> Issue -> Run -> Codex TUI。之后补状态追踪、review、completion policy、恢复与复盘。每个里程碑都要求有可演示的用户路径。
_Novelty_: 这条路线用可运行 Agent Session 作为中轴，避免开发前几周产出很多静态 UI 但没有产品核心体验。

**Milestone 建议**

| Milestone | 用户可见结果 | 必须完成 | 暂不包含 |
| --- | --- | --- | --- |
| M0 - Shell Spike | Tauri 窗口里能跑 Codex TUI | xterm、PTY、resize、输入输出、日志 | Issue、数据库、completion |
| M1 - Local Workspace Issues | 能创建 Git Workspace 和本地 Issue | SQLite、Workspace 校验、Issue CRUD、Issues Activity | Agent Profile 覆盖、review |
| M2 - Run Issue with Codex | 能从 Issue 启动 Codex Session | Agent Profile、Run Dialog、Session 创建、Issue -> running | completion、resume |
| M3 - Review Loop | 能 Mark Review 并继续在同一 Codex 修正 | Issue Panel、attention、review 保持、Session 日志 | auto commit |
| M4 - Complete Loop | 能通过 manual 或 agent_auto_commit 完成 Issue | completion prompt、Git 检测、commit hash、Session closed | PR/MR、完整 Diff |
| M5 - Recovery Polish | 重启后能复盘已完成任务和异常 Session | Summary、Open Log、crashed/stopped 标记 | 活进程跨重启恢复 |

**[Risk #41]：MVP 最大风险不是功能缺失，而是用户信任断裂**
_Concept_: 这个产品的核心信任链是：用户相信 Issue 对应的 Session 是同一上下文；相信 completion 只处理本 Issue；相信应用没有误关 Session；相信日志和 commit hash 可追溯。任何一个环节不清楚，用户都会退回裸终端和手动 Git。
_Novelty_: 风险管理不只是技术 Spike，也要把 UI 文案、审计记录、禁用状态和失败路径当作产品能力设计。

**Trust Checklist**

- 所有会改变 Issue 状态的动作都写入 IssueAction。
- 所有 Agent 启动和关闭都写入 SessionEvent。
- Run Dialog 展示最终 prompt，completion prompt 至少可展开查看。
- Complete with Agent Commit 前展示 Git 摘要和 changed files 数量。
- 未检测到 commit 时绝不自动 completed。
- Session crashed 时不伪装成 completed。
- completed 后提供 Summary 和 Open Log。

### 下一轮可继续细化的问题

1. CodexAdapter 的接口定义和 Rust Core 内部状态机。
2. SQLite schema 的字段类型、索引和迁移策略。
3. React 页面信息架构：Issues Activity、Agents Activity、Settings 的最小界面。
4. Completion prompt 的具体模板和失败兜底文案。
5. Worktree 是否进入 MVP，或作为 M6 独立能力。

## Interactive Confirmation Log - 2026-06-03

**Confirmed #34：MVP 五层模块边界**

用户已确认认可 MVP 五层模块边界：

1. `Tauri Shell`：桌面应用外壳，负责窗口、系统能力、文件夹选择和前后端连接。
2. `React Workbench`：用户可见工作台，负责 Activity Bar、Issues、Agents、Run Dialog、Issue Panel 和 xterm 容器。
3. `Rust Core`：本地执行和业务状态核心，负责 Workspace 校验、Codex command 检测、PTY、AgentAdapter、Git 检测、状态变化和 SQLite 写入。
4. `SQLite Store`：结构化事实存储，保存 Workspace、Issue、AgentProfile、AgentSession、SessionEvent、IssueAction、CompletionAttempt 等。
5. `Log Files`：原始终端日志存储，按 Session 保存 Codex TUI 输出，SQLite 仅保存路径和摘要事件。

**确认后的解释口径：** `React Workbench` 负责展示和交互，`Rust Core` 负责真实动作和状态变化，`SQLite Store` 负责结构化事实，`Log Files` 负责大文本日志，`Tauri Shell` 负责将这些能力包成桌面应用。

**Confirmed #35：Command/Event 同步模型**

用户已确认认可：React 前端不直接把 Issue 或 Session 写成 `running`、`review`、`completed`、`closed` 等核心状态，而是通过 Tauri command 请求 `Rust Core` 执行动作。`Rust Core` 负责校验条件、执行本地动作、写入 SQLite，并通过事件通知前端刷新。

**确认后的设计口径：**

- 前端负责展示、输入收集、loading 状态和用户反馈。
- 核心状态变化必须经过 Rust Core。
- 进程启动失败、Git 检测失败、completion 未检测到 commit 等失败路径由 Rust Core 返回明确结果。
- 前端可以做临时 loading，但最终状态以 Rust Core 返回值和 Core 事件为准。

**Confirmed #36：WorkspaceSettings 与 CompletionAttempt 数据模型**

用户已确认认可：MVP 数据模型中保留 `WorkspaceSettings` 与 `CompletionAttempt`。

**确认后的设计口径：**

- `WorkspaceSettings` 保存 workspace 级配置，例如 `completion_policy`、默认 AgentProfile、语言等。
- `CompletionAttempt` 单独记录每次完成尝试，包含完成前 HEAD、完成后 HEAD、changed files 摘要、用户选择、是否检测到新 commit、commit hash、失败原因。
- `Complete with Agent Commit` 属于高信任动作，不能只依赖 Codex 输出文本，必须有应用侧结构化审计记录。
- 如果 Agent 未创建 commit，CompletionAttempt 应记录 `no_commit_detected`，Issue 保持 `review`。

**Confirmed #37：Embedded Codex Terminal Spike 作为第一优先级**

用户已确认认可：第一优先级先做 Embedded Codex Terminal Spike，而不是先做完整业务 UI。

**确认后的设计口径：**

- MVP 的最大早期风险是 Codex CLI 能否在 Tauri + Rust PTY + xterm.js 中提供接近原生终端的体验。
- 第一 Spike 只验证可丢弃原型：启动 `codex`、显示 TUI、输入输出、resize、Ctrl+C、粘贴、退出检测和日志写入。
- 该 Spike 先以 macOS 通过为主，Windows/Linux 兼容性风险记录下来，但不阻塞 MVP 主路径设计。
- 如果内嵌 Codex TUI 体验不成立，需要优先调整 Agent Session 方案，再继续 Issue/Review/Completion 的业务闭环。

**Confirmed #38：Codex Session Resume 与 completion prompt 注入 Spike**

用户已确认认可：第二优先级验证 Codex Session 的继续交互、completion prompt 注入和异常退出后的 resume 能力。

**确认后的设计口径：**

- review 阶段继续修正必须优先复用同一个 Codex Session 上下文。
- `Complete with Agent Commit` 应向当前 Codex Session 注入 completion prompt，而不是启动一个无上下文的新 Codex 进程。
- AgentSession 需要保存可用于恢复的 `codex_session_id` 或等价上下文标识。
- Codex 进程异常退出后，优先通过 `codex resume <session_id>` 或等价方式恢复；若无法稳定恢复，则保留日志、提示用户手动处理，Issue 保持 `review` 或 `running`，不自动完成。

**Confirmed #39：Git Commit Detection Spike**

用户已确认认可：第三优先级验证 Git commit detection，作为 `Complete with Agent Commit` 的可信收尾机制。

**确认后的设计口径：**

- completion 前记录 `HEAD`、`git status --porcelain` 和 changed files 摘要。
- completion 后重新读取 `HEAD` 和 status。
- 若 `HEAD` 改变，记录新 commit hash，并把该 hash 写入 CompletionAttempt / IssueAction。
- 若用户选择 Agent Commit 但 `HEAD` 未改变，Issue 保持 `review`，记录 `no_commit_detected`，不自动 completed。
- 若仓库处于 merge、rebase、cherry-pick 等中间态，MVP 不自动完成，提示用户手动处理。

**Confirmed #40：第一阶段开发路线按“先可跑，再可追踪，再可完成”推进**

用户已确认认可第一阶段开发路线：

1. `M0 - Shell Spike`：Tauri 窗口里能跑 Codex TUI。
2. `M1 - Local Workspace Issues`：能创建 Git Workspace 和本地 Issue。
3. `M2 - Run Issue with Codex`：能从 Issue 启动 Codex Session。
4. `M3 - Review Loop`：能 Mark Review 并继续在同一 Codex 修正。
5. `M4 - Complete Loop`：能通过 manual 或 agent_auto_commit 完成 Issue。
6. `M5 - Recovery Polish`：重启后能复盘已完成任务和异常 Session。

**确认后的设计口径：** 第一阶段先证明 Codex 能在内嵌终端中稳定运行，再补 Issue 驱动、Review Loop 和 Completion Loop；不先投入完整代码浏览、完整 Diff、PR/MR、插件系统或多窗口工作区。

**Confirmed #41：MVP 最大风险是用户信任断裂**

用户已确认认可：MVP 最大风险不是功能缺失，而是用户对 Issue、Session、Agent Commit 和完成状态的信任断裂。

**确认后的设计口径：**

- Issue 与 AgentSession 的绑定关系必须清晰可见且可追溯。
- `Complete with Agent Commit` 必须通过 CompletionAttempt、Git HEAD 前后检测、commit hash 和日志建立信任。
- 未检测到 commit 时不能自动 completed。
- Session crashed 不能伪装成 completed。
- 所有改变 Issue 状态的动作都必须写入 IssueAction。
- 所有 Agent 启动、退出、关闭和 completion prompt 注入都必须写入 SessionEvent 或 CompletionAttempt。
- completed 后必须提供 Summary 和 Open Log，帮助用户复盘。
- 禁用状态、失败提示和确认面板属于 MVP 核心体验，不是后期 polish。

**Confirmation Complete：** #34-#41 已完成逐条交互确认。后续可以继续细化 CodexAdapter 接口、Rust Core 状态机、SQLite schema、React 信息架构、completion prompt 模板或 Worktree 是否进入 MVP。

## React Information Architecture - 2026-06-03

### Confirmed IA #42：MVP Activity Bar 只保留 Issues / Agents / Settings

用户已确认认可：MVP 左侧 Activity Bar 只保留三个一级入口：

1. `Issues`：本地 Issue 看板和 Issue 详情入口。
2. `Agents`：Agent Session 列表和 Codex Native Session View。
3. `Settings`：Workspace 设置、Agent Profile、Completion Policy、语言等配置。

**确认后的设计口径：**

- MVP 不把 `Code`、`Diff`、`Git History`、`Terminal` 做成 Activity Bar 一级入口。
- 右侧 Diff Panel 可以在 Agent 页面中预留，但不作为独立一级页面。
- 第一阶段一级导航只服务核心闭环：`Issue -> Run -> Agent Session -> Review -> Complete`。
- 后续代码浏览、完整 Diff、Git 历史、Workspace 终端恢复可以作为 M6+ 能力或插件化方向再进入导航。

### Confirmed IA #43：Issues Activity 使用四泳道看板

用户已确认并修订：MVP 的 `Issues Activity` 使用四个泳道展示 Issue：

1. `Backlog`
2. `Running`
3. `Review`
4. `Completed`

**确认后的设计口径：**

- `Completed` 需要作为常驻泳道展示，而不是仅放在过滤器或历史列表中。
- 四个泳道直接对应 MVP Issue 状态：`backlog`、`running`、`review`、`completed`。
- Issue 卡片字段保持极简：`title`、`status`、`updated_at`。
- 若有关联 AgentSession，卡片显示小型 Agent / Session 标记。
- 若 Session 需要用户关注，卡片显示 attention 标记。
- 点击 Issue 卡片打开 Issue 详情弹窗；看板卡片本身不展开复杂内容。

### Confirmed IA #44：Issue 详情页采用左右两栏布局

用户已确认并修订：Issue 详情页不是三块式信息面板，而是左右两栏布局。

**左侧主要区域：**

- 显示 `title`。
- 显示 `description`。
- `title` 和 `description` 均支持随时编辑。
- 修改后即刻保存至数据库。

**右侧辅助区域：**

- Session 关联区。
- 当前 Issue 可执行操作按钮。

**确认后的设计口径：**

- Issue 详情页不展示 `status` 字段。
- Issue 详情页不展示 `updated_at` 字段。
- 状态信息可以通过右侧操作按钮、Session 关联区或看板泳道间接表达，不作为详情页主要字段。
- MVP 不在详情页中展示完整日志、完整 Diff 或 Git 历史。
- 即刻保存需要由前端调用 Rust Core command 写入 SQLite，遵守已确认的 Command/Event 同步模型。

### Confirmed IA #45：Agents Activity 采用左右两栏，Session 与 Review 无关

用户已确认并修订：`Agents Activity` 采用左右两栏布局。

**左侧 Session 列表栏：**

- 左侧栏顶部有一行小 icon，用于切换不同的 Session 展示形态。
- MVP 默认固定提供按状态展示的形态。
- 状态展示至少包含 `Running` 和 `Completed`。
- 顶部 icon 区域包含一个小按钮，用于新建不与任何 Issue 关联的 Session。
- 不关联 Issue 的 Session 可以设置默认标题，供用户临时输入问题或手动操作。
- 不关联 Issue 的 Session 仍在左侧栏可见，并展示其运行状态：`Running` 或 `Completed`。
- Session 列表项展示信息包括 Issue title、类型、Session 标记等。
- 若 Session 不关联 Issue，则展示该 Session 的默认标题。

**右侧 Session 工作区：**

- 展示当前选中的 Codex Native Session View。
- 保留当前 Session 的上下文信息。
- 后续可在右侧或可折叠区域扩展 Diff / changed files 信息，但不进入 MVP 主路径。

**确认后的设计口径：**

- Session 与 review 无关；`review` 是 Issue 状态，不是 Session 状态或 Session 分组。
- Agents Activity 不按 `Review` 分组。
- Session 列表的 `Running` / `Completed` 是 Session 展示分组。
- 通过 Issue 启动的 Session 与 Issue 关联；通过顶部小按钮创建的 Session 不关联 Issue。
- 不关联 Issue 的临时 Session 不参与 Issue completion policy，也不触发 Issue 状态流转。

### Confirmed IA #46：Settings 分为 Workspace Settings 与 Global Settings

用户已确认并修订：MVP 存在两个设置层级，不能混在同一个入口里。

**Workspace Settings：**

- 位于左侧 Activity Bar，与 `Issues`、`Agents` 同级。
- 只影响当前打开的 Workspace。
- 包含 Workspace 名称、`repo_path`、Workspace 级 `completion_policy`。
- 包含当前 Workspace 默认 Agent Profile。
- 包含当前 Workspace 对全局 Agent Profile 的覆盖，例如 `default_args`、`default_skill`、`prompt_template`、enabled。
- 包含当前 Workspace 的项目级 instructions / prompt 补充说明。
- 包含当前 Workspace 的日志 / Session 存储信息。

**Global Settings：**

- 不放在当前 Workspace 的 Activity Bar 主入口中。
- 通过左下角 gear 打开。
- 原生顶部菜单也可以提供 `Settings...`，打开同一个 Global Settings 窗口。
- 包含 UI language，例如 `zh-CN` / `en-US`。
- 包含全局 Agent Profiles，例如 Codex command、default args、default skill、prompt template。
- 包含全局默认 `completion_policy`。
- 包含全局数据目录 / 日志目录。
- 包含 About / Diagnostics，例如版本、诊断信息、打开日志目录。

**确认后的设计口径：**

- Activity Bar 中的 Settings 应理解为 `Workspace Settings`，不是全局应用设置。
- 左下角 gear 与顶部菜单中的 Settings 打开 `Global Settings`。
- Workspace Settings 通过 `Inherit global default` / `Override for this workspace` 与 Global Settings 连接。
- UI language 是全局设置，不属于 Workspace Settings。
- 若未来需要 Workspace 级语言偏好，应命名为 `Agent response language` 或 `Prompt language preference`，避免与 UI language 混淆；MVP 暂不加入。

### Confirmed IA #47：Run Dialog 保持轻量，不展示配置来源和 command 可用性

用户已确认并修订：Run Dialog 是从 Issue 启动 Agent Session 的轻量确认弹窗，不承担 Agent 配置诊断职责。

**Run Dialog 结构：**

1. Agent 选择区
   - 选择 Agent Profile。

2. Prompt 预览 / 编辑区
   - 显示最终 prompt。
   - 最终 prompt 默认可编辑。
   - prompt 来源可以折叠查看，例如 issue description、default skill、prompt template、app instructions。

3. 启动选项区
   - working directory 默认当前 Workspace repo path。
   - default args 可展示。
   - MVP 不放复杂高级参数。

4. 底部操作区
   - `Cancel`
   - `Start`

**确认后的设计口径：**

- Run Dialog 不显示 command 是否可用。
- Run Dialog 不显示当前配置是继承全局配置还是 Workspace 覆盖配置。
- command 可用性和配置继承/覆盖关系属于 Settings / Agent Profile 配置层，不进入运行时弹窗。
- 本确认修订并覆盖早期 #24 中“Run Dialog 展示配置来源”的说法；最终 Run Dialog 只展示运行所需内容。
- 点击 `Start` 后，只有 Rust Core 成功启动 Agent 进程，Issue 才从 `backlog` 变成 `running`。
- 启动失败时 Issue 保持 `backlog`，Run Dialog 显示错误。
- 最终 prompt、Agent Profile、command snapshot、default args snapshot 保存到 AgentSession。

### Confirmed IA #48：Agent Session 右侧 Header 显示 Issue 上下文，Issue 详情用 Inspector

用户已确认并修订：Agent 界面仍为左右两栏。左侧展示当前 Agent 仓库工作区相关的最近 Session；点击某个 Session 后，左侧栏保留显示该 Session 的标题、Agent 类型和运行状态，因此右侧无需重复展示这些 Session 信息。

**右侧 Header：**

- 右侧 Header 展示与当前 Session 关联的 Issue 信息。
- 若有关联 Issue，Header 显示关联 Issue 标题。
- 若无关联 Issue，Header 隐藏 Issue 区。
- `Mark Review`、`Complete...` 等 Issue 操作可以放置在 Header 上。
- 点击 Issue 标题不跳转页面，而是打开 Issue 详情面板。

**Issue Inspector / Details Panel：**

- 该面板更接近桌面端 Inspector / Details Panel，不按移动端页面 Drawer 理解。
- 不改变当前页面路由。
- 不需要返回按钮。
- 可通过 `X`、`Esc`、再次点击 Issue 标题或点击面板外关闭。
- 打开和关闭 Inspector 不影响当前 Codex Session，不卸载 xterm。
- 内容可复用 Issue 详情页的信息原则：标题和描述可编辑，Session 关联和操作放在辅助区域。

**确认后的设计口径：**

- Agents 页面一直保持当前上下文；Issue Inspector 只是当前 Session 上的临时详情层。
- 不通过左侧 Activity Bar 或 icon 菜单来“返回”关闭 Inspector。
- 右侧不重复显示 Session 标题、Agent 类型和运行状态；这些信息属于左侧 Session 列表。
- 本确认修订 #45 中“右侧保留当前 Session 上下文信息”的泛化说法：右侧 Header 优先承载 Issue 上下文，Session 基本信息保留在左侧栏。

### Confirmed IA #49：新建不关联 Issue 的 Session 先打开 Session Dialog

用户已确认：Agents 左侧 Session 列表顶部的小按钮不直接创建临时 Session，而是先打开 `Session Dialog`。

**确认后的设计口径：**

- `Session Dialog` 用于创建不与任何 Issue 关联的临时 Session。
- 用户在 Dialog 中确认后，Rust Core 才启动 Agent 进程并创建 AgentSession。
- 创建成功后，该 Session 出现在 Agents 左侧列表中。
- 不关联 Issue 的 Session 仍展示运行状态：`Running` 或 `Completed`。
- 不关联 Issue 的 Session 不触发 Issue 状态流转，不参与 completion policy。
- `Session Dialog` 的具体字段和交互另行确认。

### Confirmed IA #50：Session Dialog 字段保持极简，不展示 working directory

用户已确认并修订：`Session Dialog` 用于创建不关联 Issue 的临时 Session，字段保持极简。

**Session Dialog 字段：**

- `title`：默认生成，例如 `Untitled Session`，用户可修改。
- `agent_profile`：选择 Agent Profile。
- `prompt`：用户初始输入。
- 底部操作：`Cancel` / `Start`。

**确认后的设计口径：**

- Session Dialog 不展示 `working_directory`。
- 不关联 Issue 的临时 Session 默认使用当前 Workspace repo path 作为 working directory。
- Session Dialog 不显示 command 是否可用。
- Session Dialog 不显示配置来源或继承/覆盖关系。
- 点击 `Start` 后，只有 Rust Core 成功启动 Agent 进程，才创建 AgentSession 并加入左侧列表。
- 启动失败时不创建 AgentSession，Dialog 显示错误。

### Confirmed IA #51：左侧 Completed Session 只显示最近 20 条

用户已确认：Agents 左侧 Session 列表中的 `Completed` 分组只显示最近 20 条 Session。

**确认后的设计口径：**

- `Running` 分组显示当前仍在运行的 Session。
- `Completed` 分组按最近完成时间排序。
- `Completed` 分组默认只展示最近 20 条。
- 该规则同时适用于关联 Issue 的 Session 和不关联 Issue 的临时 Session。
- MVP 暂不扩展搜索、归档或完整历史列表；后续如需要再单独设计。

### Confirmed IA #52：Running Session 按最近活跃时间排序

用户已确认：Agents 左侧 Session 列表中的 `Running` 分组按最近活跃时间排序。

**确认后的设计口径：**

- 最近有输出或用户输入的 Running Session 排在最上方。
- `last_active_at` 可由用户输入、Agent 输出或关键 SessionEvent 更新。
- 该规则同时适用于关联 Issue 的 Session 和不关联 Issue 的临时 Session。
- `Completed` 分组仍按最近完成时间排序，并只显示最近 20 条。

### Confirmed IA #53：Agent 右侧 Header 的 Issue 操作按钮按 Issue 状态显示

用户已确认并修订：Agent 右侧 Header 只在当前 Session 关联 Issue 时显示 Issue 信息和操作。无关联 Issue 时，Header 不显示 Issue 区域，也不显示 `No linked issue`。

**有关联 Issue 时：**

- Issue 为 `running`：
  - 显示 Issue 标题。
  - 主按钮显示 `Mark Review`。
  - 可打开 `Issue Inspector`。

- Issue 为 `review`：
  - 显示 Issue 标题。
  - 若 `completion_policy = agent_auto_commit`，主按钮显示 `Complete with Agent Commit`。
  - 若 `completion_policy = manual`，主按钮显示 `Complete Manually`。
  - 可打开 `Issue Inspector`。
  - 用户仍可继续在 Codex TUI 中输入修正，Issue 保持 `review`。

- Issue 为 `completed`：
  - 显示 Issue 标题。
  - 不显示完成类主按钮。
  - 可显示 `View Summary`、`Open Log` 或打开 `Issue Inspector`。

**无关联 Issue 时：**

- Header 不显示 Issue 标题。
- Header 不显示 `No linked issue`。
- Header 不显示 `Mark Review`、`Complete...`、`View Summary`、`Open Log` 等 Issue 操作。

**确认后的设计口径：**

- Header 不放 `Run`，因为进入 Agent 页面时 Session 已经存在；`Run` 属于 Issue 详情或 Issues 看板。
- Header 的 Issue 操作不改变 Session 分组规则；Session 仍按 Running / Completed 展示。

### Scope Freeze #54：当前 MVP 功能已具备设计和开发条件

用户已确认：目前已确认的功能范围已经具备进入设计和开发的条件，后续功能可以延后。

**确认后的设计口径：**

- 不继续向 MVP 增加新的一级功能。
- 当前 MVP 范围以已确认的 Workspace、Issues、Agents、Workspace Settings、Global Settings、Run Dialog、Session Dialog、Issue Inspector、Completion Policy、Session 展示规则为准。
- 后续代码浏览、完整 Diff、Git History、Workspace 终端恢复、插件系统、PR/MR、多 Session Attempt、搜索/归档、完整历史列表等能力进入后续 backlog。
- 下一步应从头脑风暴转入设计规格、技术设计或开发计划，而不是继续扩大功能范围。
