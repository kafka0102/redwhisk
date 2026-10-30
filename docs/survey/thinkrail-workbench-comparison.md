# Thinkrail 与 RedWhisk 工作台对比

调研日期：2026-10-30。

来源分三类，下文就近标注，不把二手转述当事实：

- **Thinkrail 源码**：`/Users/yujianjia/workspace/open/coding/thinkrail`，分支 `main`，HEAD `df7cb6d`（`feat(server): keep the survey invitation away for PostHog's wait period (#1034)`，2026-10-29 15:54:41 +0000）。下文路径写成 `thinkrail/<相对路径>`。
- **官网**：2026-10-30 抓取正文。独立文档站未找到（见 §8）。
- **RedWhisk**：本工作区 `issue-338-redwhisk`，HEAD `39650e62`。能力以 `CONTEXT.md`、`docs/` 与当前源码为准，不含路线图。

版本口径：Thinkrail 的 `apps/cli/package.json` 与根 `package.json` 版本字段是 `0.0.0`，不能当作对外发行号。线协议常量 `PROTOCOL_VERSION = 98`（`thinkrail/packages/contracts/src/wsProtocol.ts`）。内嵌引擎钉死 `@earendil-works/pi-coding-agent` **1.4.0**（`thinkrail/package.json` catalog）。官网博客 2026-10-18 称产品 **0.2.0** 已发布，并链到 GitHub tag `v0.2.0`；该文早于当前 HEAD，仓库清单里没有与 `df7cb6d` 对应的发行版本号。下文不把 0.2.0 写成当前 HEAD 的版本号。

---

## 1. 结论速览

1. Thinkrail 是 JetBrains 的 **agentic IDE**：给 `pi` coding agent 套一层可分屏的工作台，用 git worktree 隔离并行任务，用仓库旁的 spec 图留下意图。它不是多 harness 宿主，也不是 Issue 跟踪器。
2. 引擎只有进程内的 `pi`。模型、技能、压缩、费用和会话文件归 `pi`；Thinkrail 拥有工作区、编辑器壳和 host/UI 线协议，规格明确禁止自己拼 prompt、禁止第二套 agent runtime。
3. 对外形态是同一套 host 的两种启动器：Electrobun 桌面壳，或 `thinkrail` CLI 打开浏览器。业务状态在 `~/.thinkrail` 的 JSON 文件里，不是 SQLite。
4. 「IDE」在源码里是阅读器加 diff / 终端 / 评审，不是语言工作站：桌面 Monaco **只读**，不加载 TS/JS 语言服务。官网「real IDE」指的是这套工作台，不是可编辑的完整编辑器。
5. 相对 RedWhisk，Thinkrail 多出来的是：spec 图、可分屏工作台、行级评审意见、按 git tree 快照的 turn 回执、GitHub PR 上的 ready/merge/reopen、工作台内的 MCP 审批、可停止的子会话，以及进程内 `pi` 的模型/费用/压缩。RedWhisk 多出来的是：Issue 状态机与完成流程、五种外部 Agent harness、SQLite 事实源、可编辑代码页，以及限定的 TS/JS 诊断 / 定义 / 引用。
6. 调试器、多人实时共编、成品远程客户端、独立文档站：本次未找到实现。架构文里的 Tailscale / 手机客户端标成后续，不记入已交付能力。

---

## 2. 产品定位

Thinkrail 自述是 “the agentic IDE that gets better every time you use it”：今天用活的 spec 学会项目，明天再长出自己的工具。README、产品规格和官网标题一致。

来源：`thinkrail/README.md` 首段；`thinkrail/goal-and-requirements.md`「Goal」；https://thinkrail.ai/ （抓取标题同句）。

要解决的问题写在产品规格里，不是营销独有：`pi` 太瘦，新手难上手，熟手仍觉得终端不适合审 diff、写行评、把意见交回 agent；多个 agent 挤在同一工作树里会互相踩；聊天里的决定随会话消失。目标用户是在真实 git 仓库上用 `pi` 的人：要可视化入口的新手、不想丢掉 `pi` 深度的熟手、想快但要控住 agent 改动的人。

来源：`thinkrail/goal-and-requirements.md`「Problem」「Who it's for」。

和「AI 开发工作台 / AI IDE」的关系：

- 它把自己放在 **IDE 壳 + 单一 coding agent** 上，而不是「管理一堆 Issue、再派多个厂商 CLI」的工作台。价值四条：默认隔离、agent 旁边有编辑器/diff/终端/评审、spec 是事实、`pi` 的能力不藏起来。
- 非目标只有两条写死了：不引入第二套 agent runtime（点名不要 `claude-agent-sdk`）；不做 Thinkrail 账号或登录 UI。谁能连上 host，交给网络（规格写成 Tailscale ACL 与设备身份）。其余没写进能力、也没写进非目标的，规格说是开放的，不是禁止。
- 官网导航把 Docs 标成 Coming soon。`/docs` 与 `/docs/` 返回 404；`docs.thinkrail.ai` 无法解析。公开说明在落地页、博客和 GitHub 仓库文档，不在文档站。

来源：`thinkrail/goal-and-requirements.md`「Value」「Principles」「Non-goals」；https://thinkrail.ai/ 导航；https://thinkrail.ai/docs （404）；`thinkrail/apps/website/src/components/IdeShell.astro`（Docs / Coming soon）。

许可是 Apache-2.0。README 徽章把它标成 JetBrains incubator 项目，网站页脚是 JetBrains InnovationHub。

来源：`thinkrail/LICENSE`、`thinkrail/README.md` 文末；https://thinkrail.ai/ 。

---

## 3. 功能特点

只记有源码或官网正文的行为。博客与源码不一致时两边都写，产品现状以源码为准。

### 3.1 项目与工作区

一个本地 git 仓库是一个 project。Thinkrail 创建的 workspace 是独立 `git worktree`，分支和 cwd 分开，路径在 `dataDir()/worktrees/<project-slug>/<branch>`，默认数据目录是 `~/.thinkrail`（可用 `THINKRAIL_DATA_DIR` 覆盖）。另外两种用户拥有、Thinkrail 不改名也不回收的工作区：每个项目恰好一个 Default（cwd 就是项目目录，必须显式进入）；用户挂上的已有 worktree（`kind: "external"`），可以忘记，不能改。

来源：`thinkrail/architecture.md` Decision 6；`thinkrail/packages/server/src/workspaces/SPEC.md`；`thinkrail/packages/server/src/workspaces/workspaces.ts`；`thinkrail/packages/server/src/persistence/persistence.ts`（`dataDir()`）。

也可以克隆 Git URL 到本机新目录再打开，可选浅历史，可取消；空仓库可以现场建。detached HEAD 的 worktree 不能打开。

来源：`thinkrail/goal-and-requirements.md`「Projects → workspaces」；`thinkrail/packages/server/src/workspaces/workspaces.ts`（detached HEAD 报错）。

Settled 搁架：PR 合并或关闭，或安静若干天后，工作区自动搁到项目搁架上；设置允许 1 / 3 / 7 / 14 天或永不，活动指聊天回合、终端输入或 HEAD 移动，不是「看过」。官网 0.2.0 文与此一致。

来源：`thinkrail/README.md`「Isolated workspaces」；`thinkrail/packages/server/src/branch-review/SPEC.md`；https://thinkrail.ai/blog/thinkrail-0-2-0-review-the-turn/ 。

### 3.2 会话与 Agent

每个 workspace 可以有多条并发 `pi` 会话，每条自选模型，展示 `pi` 报出的 token 与费用。运行中可以 steer，或把 follow-up 排进另一条队列。自动运行要到 `agent_settled` 才算闲下来；`agent_end` 只是一次尝试的边界。

来源：`thinkrail/goal-and-requirements.md`「Chats」；`thinkrail/architecture.md` Decision 8；`thinkrail/packages/contracts/src/piProtocol.ts`（`QueueLane = "steering" | "followUp"`，`SessionStats.cost`，`ContextUsage`）。

子 agent 是独立 child session（`pi-delegation` / `pi-subagents`），不是同一条转录里的旁路。每个 chat 可看、可停、可拉 transcript；并发上限全局默认 4，合法值 1–16，workspace 可覆盖，超出 FIFO 排队。后台命令同样挂在会话上，结束后的记录和日志尾在工作区生命周期内保留，host 重启还在。

来源：`thinkrail/packages/pi-subagents/SPEC.md` 所在包与 `thinkrail/architecture.md` 包图；`thinkrail/packages/server/src/settings/SPEC.md`（默认 4，范围 1–16）；`thinkrail/packages/contracts/src/wsProtocol.ts`（`subagent.stop`、`subagent.getTranscript`、`backgroundCommand.stop`）。

聊天和 workspace 的名字由主 agent 的 `set_title` 起，且只在还没名字时写上；用户改过的名字不再被自动改。没名字的聊天用首条 prompt 的开头当只读标签，不写回存储。

来源：`thinkrail/architecture.md` Decision 8「Chat-title contract」。

上下文与压缩归 `pi`：事件里有 `compaction`（manual / threshold / overflow）。host 另暴露 `model.contextSettings` / `model.setContextWindow`，以及 `contextUsage`（tokens、窗口、百分比）。Thinkrail 规格写明不重做压缩算法。

来源：`thinkrail/packages/contracts/src/piProtocol.ts`；`thinkrail/packages/contracts/src/wsProtocol.ts`；`thinkrail/goal-and-requirements.md`「Principles」；https://thinkrail.ai/blog/thinkrail-pi-skills-and-desktop-apps/ （「how it manages context is ThinkRail's to reinvent」的否定句）。

### 3.3 编辑器、终端、变更与评审

工作台是每个窗口本地的、与资源无关的分屏框：中间可递归拆分，左右竖栈，底部横组。切 workspace 不改框的拓扑。终端可以在中间或辅助区，新 workspace 默认把一个终端放底部。布局不走线协议，不在客户端之间同步。

来源：`thinkrail/architecture.md` Decision 5、Decision 9。

文件区是 Monaco 0.57。只注册阅读向贡献：查找、折叠、括号匹配、复制、链接、hover、单词高亮、sticky scroll、跳行、只读提示、Unicode 高亮。语法着色用 Shiki + Oniguruma，按语言懒加载 grammar。`fileEditorOptions` 把 `readOnly: true` 写死。规格写明：不加载 TS/JS/JSON/CSS/HTML 的 language-service 贡献和 worker，因此这个查看器不会发出语言服务诊断。手机宽度改用 Pierre 渲染，不加载这块 Monaco。

来源：`thinkrail/packages/resource-renderers/package.json`（`monaco-editor` 0.57.0）；`thinkrail/packages/resource-renderers/src/support/monacoSetup.ts`；`thinkrail/packages/resource-renderers/SPEC.md`「The desktop Monaco surface is a reader, not a language workstation」。

线协议有 `fs.readDir`、`fs.readFile`，本次没有看到 `fs.writeFile`。面板规格写：可编辑文件的冲突处理要等 `fs.writeFile`，「the viewer is read-only today」。

来源：`thinkrail/packages/contracts/src/wsProtocol.ts`；`thinkrail/apps/web/src/panels/SPEC.md`。

终端是真 PTY：`bun-pty` 的 `spawn`，按 workspace 管生命周期，前端是 `@xterm/xterm` 6.0.0。

来源：`thinkrail/packages/server/src/terminal/terminalManager.ts`；`thinkrail/apps/web/package.json`。

变更与评审：

- 一轮 agent 改了什么，不信工具参数。`agent_start` 与 `agent_settled` 各把工作树打成 git tree object（复制 index 到临时 `GIT_INDEX_FILE`，不碰用户的 index 和 HEAD），树不同就记一条 `TurnChangeSet`。
- 分支 diff 的 hunk 有 Keep、Revert、Ask agent。Keep 按 hunk 内容做键，行号挪了还在，agent 再改这块就失效。提交范围的 diff 不挂这些动作。官网 0.2.0 文说单轮 Review turn 视图只读，Keep 只在分支 diff 上，和「commit scope 没有 hunkActions」同向。
- 文件和 diff 上可以留锚点草稿评论，不先启动 agent；发送时按文件收成结构化上下文，交给能处理它们的 chat。这是本地评审，不是 forge 评论同步。

来源：`thinkrail/packages/server/src/turns/SPEC.md`；`thinkrail/apps/web/src/panels/SPEC.md`「Hunk triage」；`thinkrail/apps/web/src/panels/DiffSurface.tsx`（`change.revert`、`askAgent`）；`thinkrail/packages/server/src/reviews/SPEC.md`；https://thinkrail.ai/blog/thinkrail-0-2-0-review-the-turn/ 。

已安装的外部编辑器可以打开 worktree：探测 PATH 上的 `code`、`emacs`、`vim`，以及一组 JetBrains 启动器里第一个存在的。

来源：`thinkrail/packages/server/src/editors/SPEC.md`。

### 3.4 Git 与 GitHub

顶栏展示当前分支相对 `origin` 和 PR 的下一步：publish、push、开 PR。开 PR 走用户自己的 `gh`，不存 token，不调厂商 REST。正文来自 plan、提交说明、仓库里的 PR 模板，或 agent 草稿；没有 `gh` / GitHub 时退回 compare URL。GitLab 只退到预填的 new-MR 页，不做对等的 MR 变更操作。

对已经打开的 GitHub PR，host 可以 mark ready、merge（带 `--match-head-commit`）、reopen、删远端分支。merge 是否真的合并完要再读一次 PR，排队中的不算已合并。线类型 `ReviewDetails` 带 `checks`（通过 / 进行中 / 失败计数与失败名）和 `reviewDecision`（`approved` / `changes_requested` / `review_required`，没有评审要求且无人决定时缺省）。README 的顶栏描述与此同向。

来源：`thinkrail/README.md`「Isolated workspaces」；`thinkrail/packages/server/src/pr/SPEC.md`；`thinkrail/packages/contracts/src/domain.ts`（`ReviewChecks`、`ReviewDecision`、`ReviewDetails`）；`thinkrail/packages/server/src/branch-review/SPEC.md`（`gh` / `glab` 查询 open，必要时再看 merged/closed）。

### 3.5 多 Agent、预览、调试、远程、协作

- **多 Agent**：同一 workspace 多条 `pi` 会话，加子会话。不是多个厂商 harness。规格把第二 runtime 列为非目标。
- **预览**：`visualize` 扩展在聊天里画 Mermaid、并排选项，以及文件预览和 UI 改动的 before/after mock，评论方式与 diff 评审相同。另有 `ask-user-question` 的选项级 markdown preview。未找到内嵌浏览器去预览正在跑的 dev server。
- **调试**：在源码与规格里未找到 DAP、debug adapter 或调试器模块。不据此推断「决定不做」。
- **远程**：CLI 默认绑 `localhost:24242`，`--host` / `THINKRAIL_HOST` 可以改绑定，规格把「绑到 localhost 以外」叫做 Tailscale seam。桌面规格写明当前 profile 只跑本地 host；「以后的 shared-client profile」才可以不带本地 host、去拨已有 host。`owner` 贯穿和持久化数据层标在 Later。因此：有绑定参数，没有已交付的手机客户端或 Tailscale 登录产品。
- **协作**：未找到多人光标、CRDT 或共享编辑会话。官网介绍文写 “integration with Git and GitHub also makes it easier to collaborate on projects in real time”，对应的是分支 / PR，不是实时共编。产品现状以源码的单 host、无账号为准。

来源：`thinkrail/goal-and-requirements.md`「Non-goals」；`thinkrail/thinkrail-extensions/visualize/server/index.ts`；`thinkrail/apps/cli/src/args.ts`；`thinkrail/architecture.md` Drivers 与 Decision 4、7；`thinkrail/packages/server/SPEC.md`「Later」；https://thinkrail.ai/blog/introducing-thinkrail/ 。

### 3.6 模型、权限、技能与工具

没有 Thinkrail 账号。模型走 `pi` 自己的 auth，或用户本机的 JetBrains `central` CLI（`provider.jbcentralConnect` 等）。设置里可以换 `pi` 配置目录（默认读 `~/.pi/agent`）和注入给 agent、终端、MCP 的额外环境变量；启动时已有的 `PI_CODING_AGENT_DIR` 优先。

来源：`thinkrail/README.md`「Your providers」「Your pi setup」；`thinkrail/packages/contracts/src/wsProtocol.ts`；`thinkrail/goal-and-requirements.md`「Providers」「Pi configuration」。

信任是显式的。仓库自带的 skill 别名、`.pi/` 设置 / 扩展 / 技能 / prompt / 子 agent 定义，以及仓库声明的 MCP，要等项目级信任；仓库 MCP 还要按条目批准，条目一变批准失效。未信任项目不加载这些。MCP 调用若工具未标 `readOnlyHint: true`，聊天里询问 Deny / Allow once / Allow in this chat / Always allow。Always allow 写在项目记录上，不写进 `.pi/mcp.json`。

来源：`thinkrail/goal-and-requirements.md`「Trust is explicit」；`thinkrail/packages/server/src/agent/mcp/SPEC.md`；`thinkrail/packages/server/src/agent/mcp/sessionHost.ts`；https://thinkrail.ai/blog/thinkrail-0-2-0-review-the-turn/ 。

技能：就地读其他 agent 已经放好的 Agent Skills。兼容目录包括项目内 `.claude/skills`、`.github/skills`、`.gemini/skills`，以及用户目录下 Claude / Codex / Copilot / Gemini 的 skills 路径（含 `CODEX_HOME`、`CLAUDE_CONFIG_DIR`）。`pi` 仍是解析和运行方。另外打包了 workflow：项目搭建、设计头脑风暴、发 PR。扩展可以在设置里逐个关掉。`pi-ask-user-question` 与 `pi-visualize` 同时以 npm 包形式给原版 `pi` 用。

来源：`thinkrail/packages/server/src/agent/skillSources.ts`；`thinkrail/README.md`「Skills and workflows」「Agent tools」；`thinkrail/packages/pi-thinkrail-workflow/`。

计划是共享 TODO：agent 改，用户也能改。一步的改动能证明是它自己的时候，可以单独提交，再交给独立 reviewer。

来源：`thinkrail/goal-and-requirements.md`「Plans with per-step review」；`thinkrail/packages/pi-todos/`。

界面语言内置英文、日文、简体中文、西班牙文（`packages/locales` 的 `en.json`、`ja.json`、`zh-CN.json`、`es.json`）。缺译回英语。用户可把翻译 JSON 放到 `~/.thinkrail/locales`，保存即生效。agent 输出不翻译。主题有 dark / light / minimal / high-contrast，用户主题放到 `~/.thinkrail/themes`。

来源：`thinkrail/README.md`「Your language」「Your themes」；`thinkrail/packages/locales/`。

### 3.7 分析与隐私（官网 + README，非产品能力）

应用收集启动、建聊天、发消息、连接 provider 等事件，绑随机安装 ID，不含 prompt、代码、文件、凭据。错误报告同样默认发送，不含错误消息、路径、URL。更多用量和「你从哪来」只在打开 Share additional usage data 时共享。问卷答案只在用户按 Send 后发送。分析后端是 PostHog。

来源：`thinkrail/README.md`「Analytics & privacy」；https://thinkrail.ai/ 页脚问卷说明。

---

## 4. 技术选型

| 层 | Thinkrail | 依据 |
| --- | --- | --- |
| 语言 / 运行时 | TypeScript。Host 与 CLI 跑在 Bun 1.4.4；进程内 `pi` 还要求 Node.js ≥ 22.19 | `thinkrail/package.json`；`thinkrail/README.md`「Developing ThinkRail」 |
| 仓库形态 | Bun workspaces + Turborepo。`apps/*`、`packages/*`、`pi-extensions/*`、`thinkrail-extensions/*` | `thinkrail/package.json`、`thinkrail/turbo.json` |
| UI | React 19.3、Zustand 5、Tailwind CSS 4、Vite 8 | `thinkrail/apps/web/package.json` |
| 桌面 | Electrobun 2.0.5，系统 webview，不是 Tauri，不是 Electron 这个名字 | `thinkrail/apps/desktop/package.json`；`thinkrail/architecture.md` Drivers |
| 浏览器形态 | `apps/cli` 拉起同一个 `packages/server`，再打开浏览器 | `thinkrail/architecture.md` Decision 2 |
| 官网 | Astro 站，Cloudflare Pages | `thinkrail/architecture.md` 包图 `apps/website` |
| 编辑器内核 | `monaco-editor` 0.57（只读、无语言服务）+ `@pierre/diffs` 1.5.1 + Shiki 4.5 | `thinkrail/packages/resource-renderers/package.json`；`thinkrail/package.json` `patchedDependencies` |
| 终端 | `bun-pty` + `@xterm/xterm` 6 | `thinkrail/packages/server/src/terminal/terminalManager.ts`；`thinkrail/apps/web/package.json` |
| Agent | 进程内 `createAgentSession`（`@earendil-works/pi-coding-agent` 1.4.0）。不是 ACP 客户端，也不是把 `pi` 当子进程 CLI | `thinkrail/packages/server/src/agent/agentSessionManager.ts`；`thinkrail/goal-and-requirements.md` Principles |
| 协议 | 自有版本化类型协议：HTTP + WebSocket，`packages/contracts`，`PROTOCOL_VERSION` 98。MCP 用的是 `pi` 自带 MCP，不是 Thinkrail 发明的工具协议。未找到 LSP 客户端。未找到 Thinkrail 自己对外提供 ACP | `thinkrail/packages/contracts/src/wsProtocol.ts`；`thinkrail/packages/resource-renderers/SPEC.md` |
| 存储 | `~/.thinkrail` 下 JSON：`projects.json`、`config.json`、`turns.json`、`session-lifecycle.json` 等。未找到 SQLite | `thinkrail/packages/server/src/persistence/persistence.ts`；`thinkrail/packages/server/src/persistence/SPEC.md` |
| 构建 / 质量 | `turbo`、Biome、`bun test`、Playwright e2e、changesets。桌面打包 `electrobun build` | `thinkrail/package.json` scripts |
| 许可 | Apache-2.0 | `thinkrail/LICENSE` |

RedWhisk 对照基线（便于看选型差，不在这里展开行为）：Tauri 2、React 19、Rust 2021、`rusqlite`、SQLite 文件 `~/.redwhisk/redwhisk.sqlite3`、前端经 Tauri command / event 访问后端。依据：`CONTEXT.md` 开篇；`docs/architecture-design/project-map.md`「运行时数据边界」；`src-tauri/tauri.conf.json`（`productName` 为 RedWhisk）。

---

## 5. 架构要点

三环，规格与 README 一致，源码目录对得上：

1. **Engine host**：`packages/server` + `packages/shared`。`Bun.serve` 提供 HTTP 与 WebSocket。`AgentSessionManager` 在进程里持有一条 chat 一个 `pi` session。`apps/cli` 与 `apps/desktop` 都是薄启动器，不各自实现引擎。
2. **Wire**：`packages/contracts`。类型加少量无依赖运行时。`server.welcome` 带协议版本，UI 可以独立发版并发现 host 版本漂移。
3. **UI**：`apps/web`。只依赖 contracts、locales、ui、extension-api 的 web 半、resource-renderers、扩展的 web 半。规格禁止依赖 `server` 或 `shared`。

来源：`thinkrail/architecture.md`「Topology」与 Decision 1–3；`thinkrail/README.md`「Under the hood」。

状态怎么放：

- **领域状态在 host**：项目、workspace、会话与转录、终端目录与 PTY、git。客户端连接时先读当前状态，再订增量（hydrate-then-stream）。刷新、第二个标签、host 重启都靠再读，不靠「刚才看见过事件」。
- **视图状态在前端本地**：分屏框、打开的 tab、滚动和焦点。不进线协议，别的窗口不跟随。
- 会话转录本身仍是 `pi` 的磁盘会话；host 用 `session.list` 把内存会话和 `pi` 磁盘会话并起来。
- 多 host 共用一个数据目录没有一般锁。规格接受：安装身份一类用窄的独占文件操作，其余共享 JSON 可能后写覆盖先写。一个 agent/provider 致命错误会拖垮整个 host，这是写明接受的代价。

来源：`thinkrail/architecture.md` Decision 8–9；`thinkrail/packages/server/SPEC.md`「Get right」。

扩展：

- 每个 Thinkrail 会话捆绑 `pi-spec-graph`、`pi-thinkrail-workflow`、`pi-todos`，以及扩展注册表里的 `visualize`、`ask-user-question`、`web-access`。
- `pi-extensions/*` 是可发布到 npm、原版 `pi` 也能用的包。`thinkrail-extensions/*` 是「`pi` 能力 + server 半 + web 半」，由每侧一个注册表组装。
- `packages/pi-dag` 是可移植的 DAG，规格写明不打进 Thinkrail、没有 workflow UI、不是第二套 `pi` runtime。

来源：`thinkrail/architecture.md` 包图与 Decision 1 附近的依赖列表；`thinkrail/packages/pi-dag` 在该包图中的说明。

---

## 6. 与 RedWhisk 的差异

RedWhisk 是本地 SQLite 桌面工作台：项目里的 Issue 驱动 Agent 会话，完成时走工作区检测、dirty 决策和 worktree 对账。代码页默认只读、可按文件改；TS/JS 有诊断、定义和引用，没有补全和类型悬停。变更、项目终端、五种 provider 都是现成能力。依据：`CONTEXT.md`；`docs/domain/state-machine.md`；`docs/architecture-design/project-map.md`；`docs/architecture-design/agent-provider-protocol.md`。

### 6.1 Thinkrail 有、RedWhisk 没有

「没有」指在本仓库的产品面和文档里未找到对等实现，不是「agent CLI 自己永远不能做」。

| 能力 | Thinkrail | RedWhisk | 来源 |
| --- | --- | --- | --- |
| 仓库旁的 spec 图，agent 用 `spec_*` 读写 | `SPEC.md` 连成图，Specs 工具只读渲染；agent 用专用工具维护 | `CONTEXT.md`、`docs/`、`src/` 未找到 spec 图或 `spec_*` 工具 | `thinkrail/goal-and-requirements.md`「Specs」；`thinkrail/packages/spec-graph/` |
| 可递归分屏的 IDE 框，布局留在每个窗口 | 中间递归拆分，左/右/底工具轨；切 workspace 不改框 | Activity 路由（Issue、会话、代码、变更、终端），代码页是侧栏加编辑器的 `WorkspaceShell`，不是多组 dock | `thinkrail/architecture.md` Decision 5、9；`src/app/app-shell.tsx`；`src/features/code/code-activity.tsx` |
| 行锚点评审意见，再作为结构化上下文发回 chat | 一个 workspace 一份 open review；不先启动 agent | 变更页和代码页未找到行锚点评论或「发给 agent 的评审包」 | `thinkrail/packages/server/src/reviews/SPEC.md` |
| 一轮改动的 git tree 回执 | `agent_start` / `agent_settled` 各写 tree，不信工具参数，不碰用户 index | 变更列表按工作区轮询 git 状态与提交历史，没有「这一轮的 tree 对」这种回执 | `thinkrail/packages/server/src/turns/SPEC.md`；`CONTEXT.md`「变更 Activity」 |
| 分支 diff 上的 Keep / Revert hunk / Ask agent | 可变 scope 的 hunk 工具条；Keep 按内容键 | 未找到 hunk 级 Keep 或 Revert。变更页有签出、拉取、推送、建分支、合并、删 worktree | `thinkrail/apps/web/src/panels/SPEC.md`；`CONTEXT.md`「变更 Activity」 |
| GitHub PR 的 ready、merge、reopen、删远端分支 | 用户的 `gh`，merge 核对 head commit | 有 push + `gh`/`glab` 创建草稿 PR/MR，Issue 摘要能看 checks。未找到 ready / merge / reopen / 删远端分支 | `thinkrail/packages/server/src/pr/SPEC.md`；`src-tauri/src/git/change_request.rs`；`src/features/changes/create-change-request-dialog.tsx`；`src/features/issues/issue-detail/issue-summary-change-request.tsx` |
| 工作台管 MCP：仓库条目批准、调用前确认、按项目 Always allow | `pi` 的 `mcp.json`；只读工具跳过询问 | 未找到 MCP 设置或调用审批 UI。Grok 适配层把 MCP elicitation 回成错误，不是审批卡 | `thinkrail/packages/server/src/agent/mcp/SPEC.md`；`docs/architecture-design/agent-development-rules.md`「ACP 反向请求」；`src-tauri/src/agent/grok_streaming/permission.rs` |
| 可停止、可看转录的子会话，以及并发上限 | child session；默认 4，范围 1–16 | 「子智能体」是同一条 json 会话流里的输出方（Codex json 与 Grok json），不是另一条会话，也没有 1–16 的宿主上限 | `thinkrail/packages/server/src/settings/SPEC.md`；`CONTEXT.md`「子智能体」 |
| 聊天内结构化提问、图和 before/after mock | `ask-user-question`、`visualize`（含 Mermaid） | 未找到对等工具卡。代码页 markdown 预览能画 Mermaid；领域文把 Agent 消息上的 Mermaid 明确排除。Grok 的 `x.ai/ask_user_question` 回错误 | `thinkrail/thinkrail-extensions/visualize/server/index.ts`；`CONTEXT.md`「代码工作区」Avoid；`src-tauri/src/agent/grok_streaming/permission.rs` |
| 进程内单一引擎的实时费用、压缩和按会话换模型 | `pi` 报 cost / compaction；每条 chat 自己的模型 | 五种外部 CLI。模型在启动时认定，会话中途改模型不改写「运行参数模型」。Token 是会话累计，不是 `pi` 那种进程内费用 | `thinkrail/packages/contracts/src/piProtocol.ts`；`CONTEXT.md`「启动期模型选择」「运行参数模型」「Session Token 消耗」 |
| 就地扫描 Claude / Codex / Copilot / Gemini / `pi` 技能，无需先「添加」 | `skillSources.ts` 列了这些根 | 「已添加技能」是用户按名称和范围写进 SQLite 的配置，不等于磁盘上扫到的每一条 | `thinkrail/packages/server/src/agent/skillSources.ts`；`CONTEXT.md`「已添加技能」 |
| 同一 host 的浏览器 UI，以及独立发版的静态客户端 | CLI 打开浏览器；UI 只依赖线协议 | 只有 Tauri 桌面。前端不能绕过 command 改业务状态，也没有第二套浏览器 host | `thinkrail/architecture.md` Decision 1–2；`docs/architecture-design/project-map.md` |
| 用户往目录里丢语言包和主题 | `~/.thinkrail/locales`、`~/.thinkrail/themes`；内置 en / ja / zh-CN / es | 内置 `en.json` 与 `zh.json`。主题是 Light / Dark / System，不是可丢文件的主题包 | `thinkrail/packages/locales/`；`src/shared/i18n/locales/`；`CONTEXT.md`「应用主题偏好」 |
| 打开 worktree 到本机已安装的 IDE | PATH 探测 `code` / `emacs` / `vim` / JetBrains 启动器 | 未找到对等的「用外部 IDE 打开当前 worktree」产品入口。macOS 文件树有「在 Finder 中打开」 | `thinkrail/packages/server/src/editors/SPEC.md`；`CONTEXT.md`「工作区路径上下文菜单」 |
| 工作区搁架（PR 合并/关闭或闲置后自动收起） | Settled shelf | worktree 生命周期绑在 Issue 完成流程和所有权上，没有这条闲置搁架 | `thinkrail/packages/server/src/branch-review/SPEC.md`；`CONTEXT.md`「Worktree 对账」「Worktree 所有权」 |

### 6.2 RedWhisk 有、Thinkrail 没有

| 能力 | RedWhisk | Thinkrail | 来源 |
| --- | --- | --- | --- |
| Issue 是一等对象：项目内编号、时间轴、评论、标签、附件、状态 | `backlog` / `running` / `review` / `completed`；动作进 `issue_actions` | 未找到 Issue、看板或时间轴实体。任务隔离单位是 workspace / chat / TODO plan | `CONTEXT.md` 开篇与「Issue 时间轴」；`docs/domain/state-machine.md`；`thinkrail/goal-and-requirements.md` 能力清单 |
| 完成流程状态机 | dirty 三选、自动提交、worktree 所有权、对账合入目标分支；phase 由纯状态机决定 | 收尾是开/更新 GitHub PR、merge PR、搁架。未找到「合入目标分支并清理托管 worktree」这套完成状态机 | `CONTEXT.md`「完成流程」；`docs/domain/state-machine.md`；`thinkrail/packages/server/src/pr/SPEC.md` |
| 多种外部 Agent harness，json 与 tui 分开 | Codex、Claude、OpenCode、Grok、DeepSeek。前四种 json + tui；DeepSeek 只有 json（ACP）。协议在 Rust `agent/` 归一 | 只有进程内 `pi`。第二 runtime 是非目标 | `docs/architecture-design/agent-provider-protocol.md`；`src-tauri/src/types/agent_profile.rs`；`thinkrail/goal-and-requirements.md`「Non-goals」 |
| SQLite 是业务事实源 | `~/.redwhisk/redwhisk.sqlite3`。会话事件、Issue、终端配置、技能配置都在库里 | `~/.thinkrail/*.json` + `pi` 自己的会话文件。无 SQLite | `docs/architecture-design/project-map.md`；`thinkrail/packages/server/src/persistence/SPEC.md` |
| 代码页可按文件编辑并保存 | 默认只读；显式进入可编辑后 Cmd/Ctrl+S 写盘；未保存有确认 | Monaco `readOnly: true`；线协议本次只有 `fs.readFile` / `fs.readDir` | `CONTEXT.md`「代码文件可编辑态」；`src/features/code/code-content.tsx`；`src-tauri/src/features/agent_session/workspace_commands.rs`（`write_project_worktree_file`）；`thinkrail/packages/resource-renderers/src/support/monacoSetup.ts` |
| TS/JS 语言智能（限定） | 当前代码根内诊断、跳定义、查引用；无补全、无悬停；不出现在会话查看器和变更 diff | 明确不加载语言服务，查看器不发诊断 | `CONTEXT.md`「TS/JS 语言智能」；`src-tauri/src/features/code_language/`；`thinkrail/packages/resource-renderers/SPEC.md` |
| 图片、PDF、SVG、HTML 的工作区预览规则 | 图片与 PDF 只读预览（20MB）；SVG 可临时当文本；`.html` 用系统应用打开磁盘现状 | 聊天与 diff 有 visualize / 文档渲染器。未找到这套「代码页面包屑上的系统浏览器打开 HTML」规则，也不把它算成 Thinkrail 缺失的全部预览 | `CONTEXT.md`「可视文件预览」「在浏览器中打开」 |
| 项目终端是可配置对象 | Shell 类与命令类分开；配置在 SQLite；live 输出按可见订阅推，磁盘上有界回放 | 终端是 workspace 上的 PTY tab，随 host 领域状态 hydrate。未找到「项目级终端配置表 + 快捷命令」 | `CONTEXT.md`「项目终端」；`docs/architecture-design/project-map.md`；`thinkrail/packages/server/src/terminal/terminalManager.ts` |
| 结构化会话的权限卡 | json 会话把 provider 的权限请求收成 `permission_requested`，UI 有 `PermissionCard`。tui 不走这张卡 | agent 本体的允许范围交给 `pi`，Thinkrail 不重做。Thinkrail 另做的是 MCP 与扩展对话框（见 §6.1），不是五种 harness 的权限卡 | `docs/architecture-design/agent-development-rules.md` 会话视图规则；`src/features/agents/message-stream/permission-card.tsx`；`thinkrail/goal-and-requirements.md` Principles |
| GitHub 与 GitLab 都能创建变更请求 | `gh` 创建 PR，`glab` 创建 MR | GitHub 是完整 push + PR 动作；GitLab 只给预填 new-MR URL | `src-tauri/src/git/change_request.rs`；`thinkrail/packages/server/src/pr/SPEC.md` |
| 应用内的 Issue 交付摘要与完成回看 | eligible turn 结束把交付说明落到 Issue 时间轴；会话正文仍在 Agent Session | 未找到 Issue 摘要。turn 回执是文件级 diff，不是写到某条工单上的交付评论 | `CONTEXT.md`「Issue 交付摘要」 |
| 版本提醒的产品语义不同 | 发现更新后顶栏提醒，打开发行说明；可冷却、可忽略某一版本。不在应用内安装 | 带更新源的桌面包装了应用内 Download → Install & Restart；CLI 是 `thinkrail update` 后手动重启 | `CONTEXT.md`「可用更新」「版本提醒」；`thinkrail/README.md` Desktop / Command line |

两边都有、但不该写成「谁没有」的：git worktree、变更 diff、项目级终端 PTY、子 agent 输出、创建 PR、在 diff 里看检查结果的一部分、会话进行中继续发消息（Thinkrail 的 steer / follow-up 队列；RedWhisk Codex json 的 Turn 插入）。差异在对象模型和深度，不在有无。

来源：`CONTEXT.md`「Turn 插入」「变更 Activity」；`thinkrail/packages/contracts/src/piProtocol.ts`。

### 6.3 Thinkrail 更具体的实现或交互优势

这里只写能指到机制的点。不写「更现代」。编辑器完整度不能算 Thinkrail 赢：它的 Monaco 更像阅读器，RedWhisk 反而能改文件并做限定的 TS/JS 智能。

| 点 | 具体差在哪 | 依据 |
| --- | --- | --- |
| 工作台信息架构 | 文件、diff、文档、聊天、终端、Specs、Review 投进同一个可分屏框，切 workspace 不拆布局。RedWhisk 要在 Activity 之间换页，代码与变更不同时出现在一个可拆框里 | `thinkrail/architecture.md` Decision 5、9；`src/app/app-shell.tsx` |
| host 与 UI 的协议边界 | 版本化的类型协议是唯一耦合；UI 可单独发版；重连先 hydrate 再订增量，第二个标签不靠自己见过的事件。RedWhisk 的边界是 Tauri command 加 SQLite，前端不是可换 host 的客户端 | `thinkrail/architecture.md` Decision 1–3、8；`docs/architecture-design/project-map.md` |
| 不在宿主里再实现一个 agent | 模型注册表、系统提示、技能、压缩、费用、会话文件都留在 `pi`。宿主只喂上下文和启动参数。RedWhisk 必须为每种 CLI 写适配、归一事件、处理各自的权限与续会话 | `thinkrail/goal-and-requirements.md` Principles；`docs/architecture-design/agent-provider-protocol.md` |
| 评审闭环 | 评论先积在本地锚点上，再整包送回 chat；一轮结束有不依赖工具自述的 tree diff；分支 diff 上可以按 hunk Keep 或退回。RedWhisk 的评审入口是变更页、提交菜单和 Issue 完成，没有这条「行评论 → 结构化上下文 → hunk 处置」 | `thinkrail/packages/server/src/reviews/SPEC.md`；`thinkrail/packages/server/src/turns/SPEC.md`；`thinkrail/apps/web/src/panels/SPEC.md` |
| MCP 与仓库注入的权限模型 | 仓库 MCP、`.pi` 资源和项目技能默认不加载；会改数据的 MCP 调用在工具卡上四级确认；批准不写回仓库文件。这比「信任整个项目目录里的 agent 配置」更细。RedWhisk 的权限卡管的是 harness 反向请求，不管 MCP 服务器清单 | `thinkrail/goal-and-requirements.md`「Trust is explicit」；`thinkrail/packages/server/src/agent/mcp/sessionHost.ts`；`src/features/agents/message-stream/permission-card.tsx` |
| 多会话与子会话的操作面 | 同一 worktree 上多条 chat，各自模型。平台修饰键 + `KeyK` 打开 session switcher，只收需要输入、失败未读、完成未读或仍在跑的会话，按项目分组，needs-input 优先。官网 0.2.0 文的 Cmd/Ctrl+K 与此同向，但少写了 error / unread。子会话有停止和转录 API。RedWhisk 一个活动 Issue 最多一条未软删除会话，子输出留在同一条流里 | `thinkrail/apps/web/src/shell/useGlobalHotkeys.ts`；`thinkrail/apps/web/src/store/selectSwitcherGroups.ts`；`thinkrail/packages/contracts/src/wsProtocol.ts`；`docs/domain/state-machine.md`；https://thinkrail.ai/blog/thinkrail-0-2-0-review-the-turn/ |
| 技能复用 | 直接读已经装给 Claude / Codex / Copilot / Gemini / `pi` 的技能目录，切换项目会变清单。RedWhisk 要先把技能配进 SQLite 再按 agentType 选用，多 harness 下这是合理的，但上手步数更多 | `thinkrail/packages/server/src/agent/skillSources.ts`；`CONTEXT.md`「已添加技能」 |

不成立的「优势」：

- **手写代码的编辑器**：Thinkrail 只读且无语言服务；RedWhisk 可保存，并有 TS/JS 诊断、定义、引用。官网「Monaco editor tabs / syntax everywhere」与只读实现不冲突，因为它没承诺可编辑；和「language workstation」则不是一回事。
- **多厂商模型自由**：Thinkrail 的模型自由在 `pi` 的 provider 列表里。RedWhisk 能跑 Codex、Claude、OpenCode、Grok、DeepSeek 的原厂 CLI，这是另一轴，不是 Thinkrail 更强。
- **远程与实时协作**：见 §3.5。绑定参数和 GitHub PR 不足以写成远程 IDE 或多人协作优势。

---

## 7. 对 RedWhisk 可借鉴的点

只保留和现有 Tauri + SQLite + Issue 模型不显然打架的几条。不是实施计划。

1. **一轮改动用 git tree 快照，不信工具自述。** Thinkrail 在回合开始和 `agent_settled` 各写一棵 tree，用户 index 不动。RedWhisk 已有按工作区轮询的未提交/已提交列表，缺的是「这一轮」的边界。这个回执可以挂在现有 Agent Session 上，不必改 Issue 状态机。依据：`thinkrail/packages/server/src/turns/SPEC.md`；`CONTEXT.md`「变更刷新」。
2. **行锚点评论先收集，再整包送回当前会话。** 评论不是新的工单类型，而是送进已有 composer / 上下文的结构化包。和 Issue 评论、完成流程可以并存。依据：`thinkrail/packages/server/src/reviews/SPEC.md`。
3. **仓库内 spec 图当作项目知识，而不是第二套 Issue。** spec 跟代码一起版本化，agent 用工具维护，人用只读树看。RedWhisk 的 Issue 仍管执行和完成；spec 管「意图跨会话还在」。依据：`thinkrail/goal-and-requirements.md`「Specs」；`thinkrail/packages/spec-graph/`。
4. **仓库自带的 agent 资源默认不加载。** 项目级信任，加上 MCP 按条批准、按工具的 Always allow 存在应用侧而不是写回仓库。RedWhisk 已有 json 权限卡，这条补的是「仓库文件本身会注入什么」，不替换 provider 权限协议。依据：`thinkrail/goal-and-requirements.md`「Trust is explicit」；`thinkrail/packages/contracts/src/domain.ts` 里 `mcpApprovals` / `mcpToolGrants` 的注释（批准不写进 `.pi/mcp.json`）。

不建议照搬、因为和现有架构冲突或收益不在本次事实里的：把多种 provider 收成进程内 `pi`（直接撞上非目标的反面，也会丢掉 Codex / Claude / Grok / DeepSeek 适配）；用 JSON 文件替换 SQLite；用可分屏 IDE 框换掉 Activity 路由；把 Monaco 改成 Thinkrail 那种只读阅读器。

---

## 8. 官网与源码的冲突、以及未找到

| 说法 | 另一边 | 产品现状取哪边 |
| --- | --- | --- |
| 官网与 README：agentic IDE，Monaco tabs，在 agent 旁边干活 | 源码：Monaco 只读，无语言服务，线协议无写文件 | 工作台壳是真的；手改源码不是已交付能力。取源码 |
| 介绍博客：Git/GitHub 让实时协作更容易 | 源码无多人共编；无账号 | 协作 = 分支与 PR。取源码 |
| 架构文：手机经 Tailscale 连上选定 host | 同文：桌面 profile 目前只本地；shared-client 与 `owner` 在 later。CLI 已有 `--host` | 已交付的是本机 host 加可选绑定地址。不把 Tailscale 客户端写成已有功能 |
| 博客 0.2.0 的功能清单（turn 回执、MCP 四级确认、Settled、子会话上限） | 当前 HEAD 源码能对上这些机制 | 博客当 0.2.0 的官方说明；机制以 `df7cb6d` 源码为准。不把 0.2.0 标成 HEAD 版本 |
| 官网落地页聊天示例里的模型名、token 与美元数 | 示例转录，不是测量 | 不当成指标 |

本次未找到，因此不推断：

- 用户量、留存、性能基准、与其他 IDE 的对比数字。
- 调试器或 DAP。
- 独立文档站（`/docs` 404，`docs.thinkrail.ai` 无 DNS，站内 Docs 为 Coming soon）。
- 应用内嵌的 dev-server 预览浏览器。
- 多人实时共编。
- 已打包的手机客户端，或桌面里可选的「连接远端 host」profile。
- 与 HEAD `df7cb6d` 对应的对外版本号。

官网实际打开的页面：

- https://thinkrail.ai/
- https://thinkrail.ai/blog/
- https://thinkrail.ai/blog/introducing-thinkrail/
- https://thinkrail.ai/blog/thinkrail-workspaces/
- https://thinkrail.ai/blog/thinkrail-sdd/
- https://thinkrail.ai/blog/thinkrail-pi-skills-and-desktop-apps/
- https://thinkrail.ai/blog/thinkrail-0-2-0-review-the-turn/
- https://thinkrail.ai/robots.txt
- https://thinkrail.ai/docs 与 https://thinkrail.ai/docs/ （均 404）
- https://docs.thinkrail.ai/ （DNS 失败）
- https://thinkrail.ai/sitemap.xml （404）
