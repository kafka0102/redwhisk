# Agent Session JSON 模式的排版与链接交互调研

本文件只回答「用户看见的排版和点击交互」：代码块、命令、diff、文件路径与链接如何呈现、点下去去哪。结构化协议能力见 [agent-output-format-survey.md](./agent-output-format-survey.md)，timeline 归一化见 [agent-session-output-analysis.md](./agent-session-output-analysis.md)，这里不重复协议清单。

判定口径：

- **源码可证**：公开仓库里能定位到函数或组件。引用使用查阅时的 commit permalink。
- **官方文档可证**：产品文档写明了交互，但客户端闭源，看不到渲染实现。
- **产品界面观察**：文档配图或文档对界面的描述，不是源码。WorkBuddy 属于这一类。

查阅日期：2026-10-23。Codex `main` 为 `7d592f6dd9988e349e3164feaa21d0fc14bbac8a`；OpenCode `dev` 为 `24b5ed8bcc60aa9a20cf4e3edf1444470e0e6464`；Gemini CLI `main` 为 `a713410aba5d594594e20d5c822e3aab8f822089`。

## 结论摘要

1. 先按事件类型分卡，不要把命令、diff、计划都塞进同一段 Markdown。Codex app-server 的 `commandExecution` / `fileChange` / `plan` / `imageView` 和 OpenCode 的 `ToolRegistry` 都是「一种工具一种卡」。见 [Codex](#codex)、[OpenCode](#opencode)。
2. 文件引用用结构化字段或「反引号路径 + 存在性检查」，点击走宿主的 `openFile`，不要一律 `target="_blank"`。Codex 用 `:codex-file-citation{path=...}`；OpenCode 的 `inlineCodeKind` 把反引号路径标成可点，再交给 `openLocalFile`。见 [链接交互模式](#可借鉴的交互模式)。
3. 本地路径要单独解析：相对 cwd 显示、保留 `:line:col` / `#L12`，并且不在前端文件系统上解析符号链接。Codex `local_links.rs` 把这件事写成了明确边界。见 [Codex](#codex)。
4. 代码块高亮和复制按钮是桌面消息流的最低配。Codex TUI 用 syntect；OpenCode session UI 用流式高亮 worker，并给围栏代码加复制按钮。RedWhisk 的 assistant Markdown 仍是裸 `<pre><code>`。见 [RedWhisk 现状](#redwhisk-现状代码事实)、[OpenCode](#opencode)。
5. 命令卡展示「命令 + 运行中 + 退出码 + 截断输出」，不要把整段 stdout 铺开。Codex `ExecCell` 头尾截断并标省略行数；OpenCode `followShellOutput` 只保留最近 64 KiB。见 [命令输出](#命令输出折叠复制与状态)。
6. diff 用独立高亮块，路径可点进侧栏。OpenCode 的 edit/patch 卡内嵌 `DiffChanges`，文件头是手风琴。RedWhisk 已有 `HighlightedDiffBlock`，但路径仍是纯文本。见 [OpenCode](#opencode)。
7. 右侧面板按「产物 / 全部文件 / 变更 / 预览」分栏，比在消息流里再开一套预览更合适。WorkBuddy 官方文档就是这个分法；RedWhisk 的 `SessionFileViewer` 已覆盖文件与图片/PDF，缺的是消息里的入口。见 [WorkBuddy](#workbuddy)。
8. HTTP(S) 新标签页、本地文件侧栏预览、图片 lightbox 必须分开。OpenCode 对 URL 包一层 `target="_blank"`，对 `data-local-link` 则 `preventDefault` 后交给宿主。见 [链接交互模式](#可借鉴的交互模式)。

## RedWhisk 现状（代码事实）

- Assistant 文本走 `src/features/agents/message-stream/agent-markdown.tsx`：`react-markdown` + `remark-gfm`。`<a>` 固定 `target="_blank"` + `rel="noreferrer"`，不区分 URL 和本地路径。围栏代码是裸 `<pre><code>`，文件头注释写明「不引入语法高亮」。
- Diff 高亮在 `src/features/agents/message-stream/highlighted-diff-block.tsx`，按扩展名做简单 token，不是完整语法高亮器。
- 工具卡在 `src/features/agents/message-stream/agent-message-cards.tsx`。shell 有命令、退出码和截断输出；read/edit 的路径是 `<code>` 纯文本，不能点。未知工具把 `rawInput` / `rawOutput` 放进 `<pre>`。
- 右侧已能打开文件：`agents-activity.tsx` 把 `workspaceCache.openFile` 传给侧栏；`session-file-viewer.tsx` 用只读 Monaco，图片/PDF/SVG 走 `VisualFilePreview`。消息流没有接到这个 `openFile`。

## 竞品机制

### Codex

证据来自公开仓库 `openai/codex` 的 TUI 与配置，以及 app-server 官方文档。桌面 App 的 React 视图不在这个仓库里，App 里「点文件引用会打开右侧并滚到行号」只在 issue 里被当作已有行为描述，本文件不把它当成源码事实。

**Markdown 与代码块（源码可证）。** `codex-rs/tui/src/markdown_render.rs` 的 `Writer::start_codeblock` / `end_codeblock` 取 info string 的第一个 token 当语言，再调用 `highlight_code_to_lines`（syntect）。`mermaid` 围栏在设置开启且 fence 闭合时改画图，否则仍高亮。链接样式只加在能识别成网页目标的 destination 上（`web_destination`）；本地路径不走网页超链接样式。

**文件引用（源码可证）。** `markdown_render/inline_directives.rs` 扫描 assistant 文本里的 `:codex-file-citation{...}`。`path` 为空则丢弃。路径像本地路径（`is_local_path_like_link`）就原样当链接目标，否则相对 session cwd 拼接。行号后缀里的 `:` 先编码成 `%3A`，避免和路径解析打架。引用没有作者给的 label，渲染时只显示格式化后的路径。

**本地链接显示（源码可证）。** `markdown_render/local_links.rs` 接受 `file://`、绝对路径、`~/`、`./`、`../`、UNC 和 Windows 盘符路径，以及 `#L12` / `#L12C3` 和 `:line[:col]` 后缀。显示时把绝对路径收成相对 cwd，但不碰文件系统、不解析符号链接、不折叠 `.` / `..`。模块注释写明：普通 file destination 没有可信的导航能力，所以渲染器只把目标显示出来。

**点开方式（官方文档可证，URI 枚举源码可证）。** [Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference.md) 的 `file_opener` 类型是 `vscode | vscode-insiders | windsurf | cursor | none`，说明是 “URI scheme used to open citations from Codex output”，默认 `vscode`。`codex-rs/config/src/types.rs` 的 `UriBasedFileOpener` 与这五个值一致。本次在该 commit 的 Rust 代码搜索里，`file_opener` 只出现在配置加载，没有找到生成 `cursor://file/...` 的渲染函数；TUI 是否真的发出可点击 OSC 8 文件链接，**未在本 commit 的渲染路径核实**。GitHub issue [#13213](https://github.com/openai/codex/issues/13213) 仍在请求「为本地文件引用可选输出 OSC 8」，[#25934](https://github.com/openai/codex/issues/25934) 报告 0.136.0 上 Markdown 超链接在支持 OSC 8 的终端里点不了。因此：配置项承诺「用编辑器 URI 打开 citation」，TUI 里文件路径默认可点 **未核实**。

**命令与 diff（源码可证）。** `exec_cell/model.rs` 的 `ExecCell` 把一条或一组读/列/搜命令收成一个 cell；`CommandOutput` 同时保留流式 preview 和结束后的聚合输出，并带 `exit_code`。`exec_cell/render.rs` 的 `output_lines` 只画头尾各若干行，中间插入省略行数。`diff_render.rs` 的 `create_diff_summary_with_links` / `create_diff_preview_with_links` 给 diff 摘要和预览带链接；`display_path_for` 把路径显示成相对 cwd。

**协议给宿主的形状（官方文档可证）。** [Codex App Server](https://learn.chatgpt.com/docs/app-server.md) 的 `ThreadItem` 包括：

- `agentMessage`：`{id, text, phase?}`
- `plan`：`{id, text}`，以 `item/completed` 的最终 item 为准
- `commandExecution`：`{id, command, cwd, status, commandActions, aggregatedOutput?, exitCode?, durationMs?}`
- `fileChange`：`{id, changes, status}`，`changes` 为 `{path, kind, diff}`
- `mcpToolCall`、`webSearch`、`imageView`（`{id, path}`）
- `enteredReviewMode` / `exitedReviewMode`

文档写明 `turn/diff/updated` 和 `turn/plan/updated` 的 `items` 目前仍是空数组，turn 内的真源是 `item/*`。这和 RedWhisk「JSON 模式把事件渲成消息流」对齐：命令、改文件、看图、计划都应该是独立 item，而不是 assistant 文本里的一段 JSON。

IDE 扩展文档只承诺「在代码旁边看摘要和 focused diff」，没有写消息内 chip 的 DOM 结构：[Codex IDE extension](https://learn.chatgpt.com/docs/codex/ide.md)。

### WorkBuddy

**产品是哪一个。** 官方文档站 [workbuddy.ai/docs](https://www.workbuddy.ai/docs/zh/workbuddy/Conversation) 自称为「腾讯云代码助手推出的 AI Agent 办公工具」，英文站写 “Tencent WorkBuddy”。腾讯云另一产品 [CodeBuddy](https://intl.cloud.tencent.com/products/acc) 是 IDE / 插件 / CLI，文档站导航把 IDE、CLI、WorkBuddy 分成不同产品。本文件的 WorkBuddy 指桌面办公 Agent，不是 CodeBuddy 插件。

**无源码。** 未找到 WorkBuddy 桌面客户端的公开渲染仓库。下面全部是官方文档对界面的描述，配有截图，标为产品说明。

**对话区（产品界面观察）。** [任务对话](https://www.workbuddy.ai/docs/zh/workbuddy/Conversation) 写明中间区是持续对话：输入、追问、看回复和中间步骤。执行中展示阶段说明（文档举例「正在分析数据」「正在生成报告」）、结果摘要，以及可展开的中间步骤。顶部「显示详情面板」打开右侧栏。输入框在执行中提供停止入口。

**右侧结果区（产品界面观察）。** [结果查看](https://www.workbuddy.ai/docs/zh/workbuddy/Results) 与 [右侧边栏](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Right-Sidebar) 一致，四个标签：

| 标签 | 文档中的行为 |
| --- | --- |
| 产物 | 本轮新生成的文件（文档、表格、PPT、PDF），点开在同一面板预览；表格不必先下载 |
| 全部文件 | 工作目录树 |
| 变更 | AI 改过的文件，展开后做差异对比 |
| 预览 | 网页或可打开的结果页，文档写「内置浏览器 / 无需切换浏览器」 |

产物条目提供「在 Finder 中打开」。文档没有写「对话正文里的文件路径可点击」；能核实的点击面是右侧标签、产物列表和变更 diff，不是消息内联链接。英文 [Right-Sidebar](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Right-Sidebar) 与中文不是同一页：英文页描述的是左侧任务列表。以中文「右侧边栏」和「结果查看」为准。

英文 slug `/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/File-Browser` 在侧栏索引里存在，但 2026-10-23 打开返回 Not Found。文件浏览器的交互细节 **未核实**。

### Claude Code

CLI 与 VS Code 扩展闭源（`anthropics/claude-code` 无渲染源码）。以下来自官方文档。

**VS Code 里计划与权限（官方文档可证）。** [Use Claude Code in VS Code](https://code.claude.com/docs/en/vs-code) 写明：

- Plan 模式：VS Code 把计划打开成一份完整 Markdown 文档，用户可加行内评论后再让 Claude 动手。`/plan open` 在已处于 plan 模式时把计划文件打开到编辑器。要求 Claude Code v2.1.280+。
- 权限模式在输入框底部切换：Auto、Manual（改文件和多数 shell 前询问）、Plan、Edit automatically。
- `@` 引用当前选择，可带行范围。
- 多个对话用 tab 或窗口分开。

文档页描述（meta description）包含 “inline diffs”，正文核实到的是计划以编辑器文档打开、权限分档，以及用编辑器上下文。扩展内部 diff 卡的组件结构 **未核实**（闭源）。

**终端里的 diff（官方文档可证）。** [Interactive mode](https://code.claude.com/docs/en/interactive-mode) 的 “Review changes with `/diff`” 有 Diff panel 与 Diff dialog。`Ctrl+O` 打开 transcript，展开默认折叠的工具调用（例如多次 MCP 合成一行）。这是「工具步骤默认可折叠、需要时再看原文」，不是把 JSON 铺进对话。

**消息类型（官方文档可证，只限类型名）。** headless / Agent SDK 的 `assistant` / `user` 消息携带 `tool_use`，子代理用 `parent_tool_use_id` 区分。字段表见既有调研，不在这里展开。SDK 不规定桌面端怎么画这些 block。

### Cursor

Cursor 客户端闭源。官方文档没有单独的 “code reference chip” 页面；2026-10-23 在 [llms.txt](https://cursor.com/llms.txt) 中没有该标题。能核对的是下面几条。

**输入侧的文件芯片（官方文档可证）。** [Prompting agents](https://cursor.com/docs/agent/prompting.md) 的 `@` 菜单包括文件与文件夹、终端输出、历史对话、Git diff（working tree 或相对 main）、内置浏览器。这是用户发给 Agent 的上下文芯片，不是 assistant 回复里的路径渲染。

**回复里的文件路径（官方文档可证，仅 changelog）。** [Release notes](https://cursor.com/docs/release-notes)（Cursor IDE，2026-10 附近的修复列表）写有 “Windows file path links open the file”。同一节还写：Agents Window 打开 file link、切到 agent layout、或在没有编辑器打开时未保存文件发生变化，不再抛错。这说明回复或 transcript 里存在 file link，并且点击应打开文件；chip 的视觉和「右侧预览 vs 编辑器 tab」 **未在文档中写明**。

**审查（官方文档可证）。** [Agent Review](https://cursor.com/docs/agent/agent-review.md) 对本地改动做独立审查，可从 `/agent-review` 或 Source Control 触发，深度分 Quick / Deep。它不是消息流里的 inline diff 组件说明。

### 开源实现（OpenCode 等）

仓库是 [anomalyco/opencode](https://github.com/anomalyco/opencode)（`sst/opencode` 的现行树）。桌面/session UI 在 `packages/session-ui`，不是旧的 Go TUI。

#### OpenCode

**Markdown（源码可证）。** [`packages/session-ui/src/components/markdown.tsx`](https://github.com/anomalyco/opencode/blob/24b5ed8bcc60aa9a20cf4e3edf1444470e0e6464/packages/session-ui/src/components/markdown.tsx) 的 `Markdown`：

- `code()` 调用 `highlightStreamingCode`。worker 失败时 `console.error` 并退回未高亮文本。
- `codeUrl()` 把围栏外、看起来像 URL 的行内代码包进 `<a class="external-link" target="_blank">`。
- `markInlineCode()`：`inlineCodeKind(text) === "path"` 时，等宿主 `localFileExists` 返回真，才给该 `<code>` 打上 `data-inline-code-kind="path"`。流式未完成的 code span 不做存在性检查。
- `setupLocalLinks()`：点击 `a[data-local-link]` 或上述路径 `<code>` 时 `preventDefault`，调用 `openLocalFile(path)`。没有这个回调时不拦截。
- 围栏代码有复制按钮（`setupCodeCopy`），写入 `navigator.clipboard`。
- `markSessionLinks`（[`markdown-session-links.ts`](https://github.com/anomalyco/opencode/blob/24b5ed8bcc60aa9a20cf4e3edf1444470e0e6464/packages/session-ui/src/components/markdown-session-links.ts)）把 `ses_` 加 26 位 id 变成按钮，点击打开对应 session，而不是当文件路径。

路径判定在 [`markdown-inline-code-kind.ts`](https://github.com/anomalyco/opencode/blob/24b5ed8bcc60aa9a20cf4e3edf1444470e0e6464/packages/session-ui/src/components/markdown-inline-code-kind.ts) 的 `inlineCodeKind`：`http(s)` 是 `url`；含空白、含代码符号、或以 `\\` / `//` 开头的网络共享直接排除（注释写明避免为了检查存在性去连网）。无扩展名只允许 `Dockerfile`、`Makefile` 等白名单。注释写明：这只是廉价语法检查，真正变成链接要等宿主确认文件存在。

**工具卡（源码可证）。** [`message-part.tsx`](https://github.com/anomalyco/opencode/blob/24b5ed8bcc60aa9a20cf4e3edf1444470e0e6464/packages/session-ui/src/components/message-part.tsx) 只重导出 `ToolDisplay`。实现在 [`tool-renderer.tsx`](https://github.com/anomalyco/opencode/blob/24b5ed8bcc60aa9a20cf4e3edf1444470e0e6464/packages/session-ui/src/tools/tool-renderer.tsx) 的 `ToolRegistry.register`：

| 工具名 | 渲染 |
| --- | --- |
| `read` | `BasicTool`，标题 + 文件名；若结果是图片，用 `data-local-image` 的 `<img>`，再交给 markdown 的图片预览 |
| `list` / `glob` / `grep` | 折叠输出，内部仍用 `Markdown` |
| `webfetch` | 副标题是 `<a target="_blank">`，点击 `stopPropagation`，避免触发展开 |
| `shell` | 折叠标题是命令；展开后 `ConsoleOutput` 分 `bash-command` 与 `bash-result`。运行中用 `followShellOutput` 拉输出 |
| `edit` | 文件手风琴 + `DiffChanges`；宿主通过 `useFileComponent()` 提供 diff 视图 |
| `write` | 同一文件组件的 `mode="text"` |
| `patch` | 按文件分组，每文件一块 diff |
| `subagent` | 副标题链到子 session，`navigateToSession` |
| `todowrite` | `ToolDisplay` 直接 `return null`，计划不走通用工具壳 |

Shell 输出在 [`shell-output.ts`](https://github.com/anomalyco/opencode/blob/24b5ed8bcc60aa9a20cf4e3edf1444470e0e6464/packages/session-ui/src/tools/shell-output.ts)：`SHELL_OUTPUT_TAIL_BYTES = 64 * 1024`，按 cursor 分页，运行中每秒拉一次，退出后不再轮询。`SessionShellMessage` 在 timeout、killed 或非零 `exit` 时另渲染 `ToolErrorCard`，文案带退出码。

#### Gemini CLI（对照，不是第二套完整 UI）

[`MarkdownDisplay.tsx`](https://github.com/google-gemini/gemini-cli/blob/a713410aba5d594594e20d5c822e3aab8f822089/packages/cli/src/ui/utils/MarkdownDisplay.tsx) 把围栏交给代码着色组件；行内格式在 [`markdownParsingUtils.ts`](https://github.com/google-gemini/gemini-cli/blob/a713410aba5d594594e20d5c822e3aab8f822089/packages/cli/src/ui/utils/markdownParsingUtils.ts) 的 `parseMarkdownToANSI`：Markdown 链接渲染成 `文字 (url)` 并给 URL 上色，裸 `https://` 单独上色。没有本地文件点击。这是终端 ANSI，不是桌面侧栏。

[`ShellToolMessage.tsx`](https://github.com/google-gemini/gemini-cli/blob/a713410aba5d594594e20d5c822e3aab8f822089/packages/cli/src/ui/components/messages/ShellToolMessage.tsx) 在命令执行中把 PTY 嵌进工具卡（`ShellExecutionService.resizePty`），点击头部可把焦点交给内嵌 shell。运行中的命令是一块可聚焦的实时终端，不是等宽 JSON。

Cline、Continue、Goose、Crush 本轮没有读到与 OpenCode 同级的「路径可点 + 独立工具卡 + 代码高亮」组件，不引用。

## 可借鉴的交互模式

| 模式 | 谁在用 | 证据 | 对 RedWhisk 的落点 |
| --- | --- | --- | --- |
| HTTP(S) 新标签页，本地路径不走 `_blank` | OpenCode `codeUrl` + `setupLocalLinks`；RedWhisk 今天全部 `_blank` | [markdown.tsx](https://github.com/anomalyco/opencode/blob/24b5ed8bcc60aa9a20cf4e3edf1444470e0e6464/packages/session-ui/src/components/markdown.tsx) | `agent-markdown.tsx` 的 `a`：URL 维持新标签页；`file:`、绝对路径、workspace 相对路径改为调用已有 `openFile` |
| 反引号路径在确认存在后变成链接 | OpenCode `inlineCodeKind` + `localFileExists` | [markdown-inline-code-kind.ts](https://github.com/anomalyco/opencode/blob/24b5ed8bcc60aa9a20cf4e3edf1444470e0e6464/packages/session-ui/src/components/markdown-inline-code-kind.ts) | 只链 workspace 内真实文件。不存在的路径保持 `<code>`。排除 UNC，避免探测网络共享 |
| 模型输出结构化 file citation，而不是靠正则猜 | Codex `:codex-file-citation{path=...}`，行号后缀单独保留 | [inline_directives.rs](https://github.com/openai/codex/blob/7d592f6dd9988e349e3164feaa21d0fc14bbac8a/codex-rs/tui/src/markdown_render/inline_directives.rs)、[local_links.rs](https://github.com/openai/codex/blob/7d592f6dd9988e349e3164feaa21d0fc14bbac8a/codex-rs/tui/src/markdown_render/local_links.rs) | 若上游已经是 `fileChange.path` 或 citation，直接用字段。正则只做 assistant 纯文本的兜底，并保留 `:line:col` |
| 点击打开侧栏预览，而不是系统浏览器 | OpenCode `openLocalFile`；WorkBuddy 右侧产物/文件/变更/预览；RedWhisk 已有 `SessionFileViewer` | [Results](https://www.workbuddy.ai/docs/zh/workbuddy/Results)、`session-file-viewer.tsx` | 消息和工具卡里的路径调用 `workspaceCache.openFile`。图片/PDF 沿用现有预览，不必新做 lightbox |
| 编辑器 URI（vscode / cursor） | Codex 配置 `file_opener` | [config reference](https://learn.chatgpt.com/docs/config-file/config-reference.md)、[types.rs](https://github.com/openai/codex/blob/7d592f6dd9988e349e3164feaa21d0fc14bbac8a/codex-rs/config/src/types.rs) | RedWhisk 自己有侧栏，不必先做 `cursor://`。外部编辑器只能当可选次动作 |
| diff 卡内联，路径在卡头 | Codex `fileChange` + `diff_render`；OpenCode edit/patch 的 `DiffChanges` | [app-server Items](https://learn.chatgpt.com/docs/app-server.md)、[tool-renderer.tsx](https://github.com/anomalyco/opencode/blob/24b5ed8bcc60aa9a20cf4e3edf1444470e0e6464/packages/session-ui/src/tools/tool-renderer.tsx) | 继续用 `HighlightedDiffBlock`，给路径加按钮。卡头显示 `+n -m`，正文默认折叠 |
| 命令：状态、退出码、截断、复制，而不是整段 JSON | Codex `ExecCell`；OpenCode shell 64 KiB tail；Gemini 嵌 PTY | [exec_cell/render.rs](https://github.com/openai/codex/blob/7d592f6dd9988e349e3164feaa21d0fc14bbac8a/codex-rs/tui/src/exec_cell/render.rs)、[shell-output.ts](https://github.com/anomalyco/opencode/blob/24b5ed8bcc60aa9a20cf4e3edf1444470e0e6464/packages/session-ui/src/tools/shell-output.ts) | `ToolCallCard` 的 shell 分支已有退出码和截断。补运行中状态、复制命令、默认折叠大输出。未知工具不要把 raw JSON 当正文 |
| 代码块语法高亮 + 复制 | Codex syntect；OpenCode 流式高亮与复制按钮 | `end_codeblock`、`setupCodeCopy` | 只加在围栏代码。行内代码保持现在的样式。高亮失败时退回纯文本 |
| 计划 / 子任务单独成卡 | Codex `plan` item；Claude Code plan 打开成 Markdown；OpenCode `todowrite` 不进通用工具壳，`subagent` 可跳会话 | [app-server](https://learn.chatgpt.com/docs/app-server.md)、[VS Code plan](https://code.claude.com/docs/en/vs-code)、`ToolDisplay` | 计划用清单卡。子会话用 session 链接，不要渲成文件路径 |
| 图片走预览，不走文件编辑器 | Codex `imageView {path}`；OpenCode read 工具的 `data-local-image`；RedWhisk `VisualFilePreview` | app-server Items；`ReadImage` | 路径扩展名是图片时，`openFile` 后再切预览。消息里的 Markdown 图片同理 |

## 不建议照搬的部分

- **Codex TUI 的「链接只显示文字，不保证能点」。** `local_links.rs` 明确说普通 file destination 没有可信导航，只做显示。桌面应用已经有 `openFile`，停在「看起来像链接」不够。
- **`file_opener` 的编辑器 URI 作为唯一打开方式。** 枚举绑定 vscode / cursor / windsurf。RedWhisk 是自己的窗口，侧栏预览更贴近 WorkBuddy 和现有 `SessionFileViewer`。URI scheme 的实际跳转代码本次未在 TUI 渲染路径找到。
- **Gemini CLI 的 ANSI `文字 (url)`。** 那是终端宽度约束。桌面端重复贴出整段 URL 会更挤。
- **OpenCode 的 `todowrite` 直接不渲染。** 他们把计划放到别的表面。RedWhisk 若同样返回 null，用户会看不到计划。应单独画清单，而不是塞进工具 `<pre>`。
- **Gemini 执行中把 PTY 嵌进每条命令。** 实现成本高，且和 RedWhisk 已有终端 surface 重复。命令卡保留尾部输出和「在终端里看」即可。
- **WorkBuddy 的表格/PPT/内置浏览器预览。** 文档描述的是办公交付物。RedWhisk 的代码会话没有对应渲染器，不要为了「效果图」先做 Office 预览。图片和 PDF 已经有预览。
- **把 citation 指令原文显示出来。** Codex issue [#40514](https://github.com/openai/codex/issues/40514) 记录过 plan 输出把 `:codex-file-citation{...}` 原样打出。解析失败时应退回路径文本，不要把指令泄漏到 UI。
- **Claude Code / Cursor 的闭源交互细节。** 文档没写的 chip 尺寸、动画、权限卡布局不要当成可抄实现。

## 来源

源码（commit permalink）：

- Codex Markdown 渲染与代码高亮：<https://github.com/openai/codex/blob/7d592f6dd9988e349e3164feaa21d0fc14bbac8a/codex-rs/tui/src/markdown_render.rs>
- Codex 本地链接：<https://github.com/openai/codex/blob/7d592f6dd9988e349e3164feaa21d0fc14bbac8a/codex-rs/tui/src/markdown_render/local_links.rs>
- Codex file citation：<https://github.com/openai/codex/blob/7d592f6dd9988e349e3164feaa21d0fc14bbac8a/codex-rs/tui/src/markdown_render/inline_directives.rs>
- Codex `UriBasedFileOpener`：<https://github.com/openai/codex/blob/7d592f6dd9988e349e3164feaa21d0fc14bbac8a/codex-rs/config/src/types.rs>
- Codex 命令 cell：<https://github.com/openai/codex/blob/7d592f6dd9988e349e3164feaa21d0fc14bbac8a/codex-rs/tui/src/exec_cell/model.rs>、<https://github.com/openai/codex/blob/7d592f6dd9988e349e3164feaa21d0fc14bbac8a/codex-rs/tui/src/exec_cell/render.rs>
- Codex diff：<https://github.com/openai/codex/blob/7d592f6dd9988e349e3164feaa21d0fc14bbac8a/codex-rs/tui/src/diff_render.rs>
- OpenCode Markdown：<https://github.com/anomalyco/opencode/blob/24b5ed8bcc60aa9a20cf4e3edf1444470e0e6464/packages/session-ui/src/components/markdown.tsx>
- OpenCode 路径判定：<https://github.com/anomalyco/opencode/blob/24b5ed8bcc60aa9a20cf4e3edf1444470e0e6464/packages/session-ui/src/components/markdown-inline-code-kind.ts>
- OpenCode session 链接：<https://github.com/anomalyco/opencode/blob/24b5ed8bcc60aa9a20cf4e3edf1444470e0e6464/packages/session-ui/src/components/markdown-session-links.ts>
- OpenCode 工具卡：<https://github.com/anomalyco/opencode/blob/24b5ed8bcc60aa9a20cf4e3edf1444470e0e6464/packages/session-ui/src/tools/tool-renderer.tsx>
- OpenCode shell 尾部输出：<https://github.com/anomalyco/opencode/blob/24b5ed8bcc60aa9a20cf4e3edf1444470e0e6464/packages/session-ui/src/tools/shell-output.ts>
- Gemini CLI Markdown：<https://github.com/google-gemini/gemini-cli/blob/a713410aba5d594594e20d5c822e3aab8f822089/packages/cli/src/ui/utils/MarkdownDisplay.tsx>、<https://github.com/google-gemini/gemini-cli/blob/a713410aba5d594594e20d5c822e3aab8f822089/packages/cli/src/ui/utils/markdownParsingUtils.ts>
- Gemini CLI shell 卡：<https://github.com/google-gemini/gemini-cli/blob/a713410aba5d594594e20d5c822e3aab8f822089/packages/cli/src/ui/components/messages/ShellToolMessage.tsx>

官方文档：

- Codex 配置 `file_opener`：<https://learn.chatgpt.com/docs/config-file/config-reference.md>
- Codex App Server items：<https://learn.chatgpt.com/docs/app-server.md>
- Codex IDE 扩展：<https://learn.chatgpt.com/docs/codex/ide.md>
- WorkBuddy 任务对话：<https://www.workbuddy.ai/docs/zh/workbuddy/Conversation>
- WorkBuddy 结果查看：<https://www.workbuddy.ai/docs/zh/workbuddy/Results>
- WorkBuddy 右侧边栏：<https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Right-Sidebar>
- CodeBuddy 产品页（用于区分产品，不是 WorkBuddy 源码）：<https://intl.cloud.tencent.com/products/acc>
- Claude Code VS Code：<https://code.claude.com/docs/en/vs-code>
- Claude Code 交互模式 `/diff`：<https://code.claude.com/docs/en/interactive-mode>
- Cursor prompting `@`：<https://cursor.com/docs/agent/prompting.md>
- Cursor release notes（file path links）：<https://cursor.com/docs/release-notes>
- Cursor Agent Review：<https://cursor.com/docs/agent/agent-review.md>
- Cursor 文档索引：<https://cursor.com/llms.txt>

Issue（只说明行为缺口，不当成实现）：

- Codex 终端文件引用 OSC 8：<https://github.com/openai/codex/issues/13213>
- Codex TUI Markdown 超链接不可点：<https://github.com/openai/codex/issues/25934>
- Codex plan 泄漏 citation 指令：<https://github.com/openai/codex/issues/40514>

本仓库：

- `src/features/agents/message-stream/agent-markdown.tsx`
- `src/features/agents/message-stream/agent-message-cards.tsx`
- `src/features/agents/message-stream/highlighted-diff-block.tsx`
- `src/features/agents/session-workspace/session-file-viewer.tsx`
- `src/features/agents/agents-activity.tsx`
