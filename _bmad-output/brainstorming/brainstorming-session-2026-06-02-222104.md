---
stepsCompleted: [1, 2]
inputDocuments: []
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
