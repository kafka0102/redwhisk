# RedWhisk

RedWhisk 是以本地 SQLite 作为业务状态事实源的桌面工作台，用于管理项目 Issue 与 Agent 执行会话。

## Language

**Issue 时间轴**：
按发生时间呈现某一 Issue 的用户、Agent 与系统事实的审计视图；其唯一事件流是 `issue_actions`，评论正文不直接存入事件负载。
_Avoid_: 动态表、操作日志

**Issue 评论**：
由用户或 Agent 发表并归属到某一 Issue 的正文内容；评论是可被时间轴中的“评论已添加”事件引用的独立实体。
_Avoid_: 时间轴消息、动态正文

**用户档案**：
本地用户的身份与展示资料，使用稳定的全局用户 ID 关联 Issue 时间轴；当前首次用户的 ID 为 1，但不构成单用户约束。
_Avoid_: 固定用户、设置记录

**Agent 分配**：
用户为 Issue 启动 Agent 会话的事实；事件同时保留 Agent 配置 ID 和分配时的名称快照，确保配置被逻辑删除或改名后历史仍可读。
_Avoid_: 当前 Agent 名称、运行记录

**Issue 交付摘要**：
Eligible turn 结束后自动落到 Issue 时间轴的 Agent 交付说明；优先采用 Agent 标明的精简摘要标签（有标签时 follow*up 也发表），缺失时仅 initial/completion 采用本轮最终答复的整理版。完整会话正文仍属于 Agent Session。
\_Avoid*: 仅靠标签才可评论、会话转录全文、follow_up 无标签也刷屏

**完成流程**：
Issue 从待验收标记为已完成的多步状态机流程；以实际执行路径、未提交改动与 Worktree 所有权为决策依据，经检测、dirty 三选（自动提交 / 不提交 / 取消）、自动提交后确认、Worktree 对账等阶段推进。phase 迁移由纯状态机模块决定，副作用以 effect 枚举由 service 解释执行；`detecting_workspace` 与 `reconciling_worktree` 是单次 command 内穿越的瞬态逻辑态（不持久化）。
_Avoid_: completion policy、手动 / 自动提交二分

**完成流程 dirty 三选 · 不提交（Skip）**：
用户选择不把未提交改动做成新 commit 即继续完成；当后续需要 Worktree 对账合入时，系统在对账前丢弃 **Agent worktree** 上的未提交改动（含未跟踪临时文件），仅合入已提交内容；目标分支工作区 dirty 仍阻断；无需对账的当前分支路径则直接标记完成且不改写工作区文件。
_Avoid_: 跳过合入、stash 保留、忽略 ensure_clean、清扫目标主工作区

**Worktree 所有权**：
某一 Agent worktree 由谁负责自动清理：RedWhisk 托管，或外部 / 用户提供。仅 RedWhisk 托管的 worktree 在完成流程中可被自动对账清理；外部 worktree 需用户确认。
_Avoid_: workspace mode、session 工作目录归属

**Issue Worktree 名**：
为 Issue 创建 RedWhisk 托管 worktree 时使用的工作分支名与目录主名；形态为 `issue-{项目内编号}-{仓库名 slug}`，仓库名取自仓库路径最后一级目录，经小写、中文按字转拼音（无声调）、非 `[a-z0-9]` 剔除后按 `-` 连接，且不超过 20 字符（截断优先保留完整词）；仓库名 slug 为空时退回 `issue-{项目内编号}`。历史 session 已记录的路径与分支不改写。
_Avoid_: Issue 标题 slug、全局 issue id 命名、在线翻译名

**实际执行路径**：
Issue 完成时认定的 session 真实工作目录；用于未提交改动检测、Worktree 漂移判定与完成弹框预填。路径来源优先级由完成编排决定，不由 git 层决定。
_Avoid_: working_dir 快照、codex cwd 裸字段

**Worktree 漂移**：
实际执行路径相对 session 启动快照发生变化，且该路径位于附加 git worktree 上；漂移后按外部 worktree 处理所有权。
_Avoid_: 路径不同、branch mismatch

**Worktree 对账**：
将 worktree 工作分支合入目标分支并清理该 worktree 及其工作分支的收尾动作；不包含是否应对账的策略决策。
_Avoid_: 仅 rebase、仅 delete worktree、merge policy

**Issue 动作**：
构成 Issue 时间轴的一条不可变事实，具有明确操作者、可选评论关联、稳定动作类型及版本化展示参数。
_Avoid_: 无结构动态、纯日志

**状态进入时间**：
某一 Issue 进入其当前 `status`（`backlog` / `running` / `review` / `completed`）的时刻，持久化为 `issues.status_changed_at`；仅在状态迁移时刷新，与任意字段更新都会刷新的 `updated_at` 职责分离。看板四个甬道统一以它为降序排序键，分别表达完成 / 开始运行 / 开始 review / 进入 backlog 的语义。
_Avoid_: updated_at、最近活动时间

**动作渲染注册表**：
将稳定的 Issue 动作类型映射为国际化文案模板与展示组件的集中定义；模板不作为业务数据存储。
_Avoid_: 数据库存储模板、页面内分散分支

**代码工作区**：
Session 工作区中的固定代码浏览 Tab；以项目目录或一个已存在且附着本地分支的 Git worktree 为根目录，展示其文件树与文件内容。默认只读；用户可按文件 Tab 显式进入轻量可编辑态，经快捷键落盘保存。分支选择按项目在当前应用运行期间保留；已失效的 worktree 选择自动回退到项目目录分支，detached HEAD worktree 不列为候选项。文件树中的忽略项由 Git 忽略规则判定并灰显，但仍可浏览。文件树与变更徽标按「项目 + 工作区根」在应用运行期内存中做 SWR 缓存：切回代码页或切到曾访问过的根时先展示缓存数据且不闪加载态，同时后台静默检测；内容 signature 未变则不更新界面，变化则静默替换树与徽标；无缓存的首次访问才显示加载态。文件 Tab 以根目录隔离，切换根目录时关闭当前 Tab；每个根目录最多保留十个文件 Tab，超出时淘汰最久未激活的 Tab。当前激活的文件 Tab 在代码页与应用窗口均可见时，按与文件树相同的节奏做轻量元数据签名检测（体积与修改时间）；签名未变不重载正文，签名变化且该 Tab 无未保存改动时静默重新读取并替换内容（不闪加载态，尽量保留阅读位置），有未保存改动时提示冲突（用磁盘版 / 保留本地版）；页面或窗口隐藏时暂停检测，切换到该 Tab 或由隐藏恢复可见时立即检测一次。检测失败（如文件已删除）按与切回代码页复检相同方式写入错误态；文件恢复可读后再自动读回。代码区路径面包屑中的文件夹层级可点击，弹出以该目录为根的树形菜单，子目录可在菜单内多级展开/收起；左侧文件树的文件夹则在常驻侧栏内展开或收起。面包屑行最右侧提供文件编辑开关；默认只读，点击进入可编辑。当当前文件的语言为 markdown 时，同区另有源码/渲染预览切换；默认源码视图，预览仅用当前打开期间的内存态，不跨 tab 关闭或文件切换记忆，也不持久化。进入可编辑时若正处预览则自动切回源码；预览态始终只读且以当前缓冲（含未保存）渲染。预览态对 language 为 mermaid 的 fenced code block 客户端渲染为静态只读 SVG，主题跟随应用 light/dark；非法图源仅在该块显示错误态且不拖垮整页预览。
_Avoid_: Agent 会话工作目录、完整 IDE、多文件重构/诊断、持久化项目设置、markdown 预览分屏、仓库内相对资源解析、无签名的定时整文件刷新、后台未激活 Tab 的内容轮询、跨卸载强制清空已缓存文件树、变更 Activity / Agent 会话工作区的同等刷新（非本能力范围）、Agent 消息 / Issue 只读页的 Mermaid、缩放拖拽交互图、mermaid 围栏别名

**代码文件可编辑态**：
某一文件 Tab 上由用户显式开启的轻量编辑会话；按 Tab 独立记忆，默认关闭（只读）。开启后可改缓冲内容，经 Cmd/Ctrl+S 写回磁盘；同一按钮可切回只读。二进制、过大、加载失败或加载中的文件按钮禁用。关闭 Tab、退出可编辑、换根或 LRU 淘汰时，若有未保存改动则三键确认（保存 / 不保存 / 取消；多 dirty 场景为保存全部 / 全部不保存 / 取消）。
_Avoid_: 自动保存 IDE 会话、全局单文件锁、跨根编辑缓冲

**文件 Tab 未保存圆点**：
文件 Tab 关闭按钮左侧的视觉标记，表示该 Tab 相对上次成功落盘（或初始加载）的磁盘内容存在未保存改动。Light 为灰色，Dark 为浅灰偏白。
_Avoid_: 星号文件名、改动计数角标

**项目终端**：
归属某一项目的交互式 shell 会话；在 Workbench 中以终端视图呈现，与 Agent 结构化会话流分离。
_Avoid_: Agent Session 终端、Codex 原生视图、日志查看器

**Shell 类项目终端**：
启动命令为空，或等于用户默认 shell（如 `$SHELL` / `/bin/zsh`）的项目终端；语义上是交互 shell 会话本身，而非先跑再 keepalive 的业务命令。应用重启 / 打开项目后应自动以默认 shell 拉起，UI 不得长期停留在「该终端当前未运行」。
_Avoid_: 以 terminal-N 显示名判定、命令型项目终端、中途 exit 后强制再起

**命令型项目终端**：
启动命令为非默认 shell 的业务命令（如 `pnpm dev`）的项目终端；打开项目时仍可按现有 restore 路径尝试启动，但不在本能力中作为「必须自动可用」的保证对象。
_Avoid_: Shell 类项目终端、Agent Session 启动命令

**终端 live 输出**：
项目终端在具备可见订阅时的实时输出流；对该订阅保证字节不丢失，允许延迟，不允许静默丢弃。
_Avoid_: 尽力而为日志流、可丢采样输出

**终端可见订阅**：
某一终端会话在布局可见且应用窗口可见时的 live 输出订阅；同一会话可有多个订阅，至少一个存在时才需要向 UI 推送 live 输出。
_Avoid_: 仅挂载即推送、焦点窗口独占、后台静默杀进程

**终端会话日志**：
该终端 PTY 输出在磁盘上的有界记录；用于会话不可见后再次可见时的尾部回放，不是无限完整历史档案。
_Avoid_: 完整审计归档、SQLite 中的终端正文

**可用更新**：
已对外发布的、版本号按 SemVer 严格大于当前应用版本的最新正式发行；draft 与未达最新的历史发行不构成可用更新。
_Avoid_: 最新 tag、自动更新包、预发布通道

**版本提醒**：
Workbench 顶栏提示存在可用更新的非模态入口；用户可通过其打开发行说明页，或选择短期冷却与忽略某一版本。
_Avoid_: 强制更新对话框、应用内安装器、全屏横幅

**版本提醒冷却**：
用户选择在固定时长内不再展示版本提醒的偏好；冷却结束后若仍存在可用更新则恢复提醒。
_Avoid_: 忽略版本、关闭应用即失效的一次性状态

**忽略版本**：
用户明确不再为某一远端版本展示版本提醒的偏好；仅当出现更高的可用更新时提醒才恢复。
_Avoid_: 版本提醒冷却、卸载更新、降级

**变更 Activity**（原「代码工作区变更视图」）：
与「代码」Activity 同级的顶层工作台页面，位于左侧菜单 code 与终端之间。两栏布局：左栏为分支下拉（不设刷新按钮）与其右侧「更多」菜单 + 变更视图，右栏为 diff 主体（点单文件打开单文件 diff，或经提交上下文菜单「打开更改」进入提交全部更改视图）。「更多」仅属于变更 Activity：选中项目主 checkout 时提供签出、拉取、推送与创建分支（签出居首，创建分支居末）；选中 linked worktree 时提供删除（确认文案为「确定要删除吗？」）。签出打开居中 500px 可滚动分支选择弹窗，分本地分支与远程分支两段（隐藏已被其他 worktree 占用的本地分支，以及已删除 worktree 残留的 issue 工作分支；远程名显示完整 remote-tracking 名），点击分支切换当前主 checkout；有未提交改动时先确认再执行普通 checkout。弹窗打开只读本地 refs，标题栏右侧刷新执行 `git fetch --all --prune` 后重列。拉取执行当前分支 `git pull`；推送采用安全推送策略（有 upstream 时先 fetch，可快进落后则 pull --ff-only 再 push，无法快进则中止提示且不留下 merge/rebase 态；无 upstream 时 push -u origin HEAD）；创建分支打开 400px 对话框输入分支名（默认空、无前端校验），确定后基于当前 HEAD 创建并签出，未提交改动随迁，Git 拒绝则报错不丢弃改动；删除可针对任意 linked worktree（不限 RedWhisk 托管、不绑 Issue），强制移除目录并删除对应本地分支，但若该路径上存在 running turn 的 Agent session 则禁止删除。签出/创建分支/拉取/推送成功后立即刷新未提交与已提交数据（签出与创建分支并刷新分支根展示）。变更视图以当前选中根工作区为范围，分「未提交变更」「已提交变更」两个默认展开的折叠面板；未提交面板列出工作区改动文件（不设高度上限），与已提交时间轴共用同一纵向滚动；未提交标题在列表成功拿到时显示文件数（含 0，如「未提交变更 (23)」），出错不显示数字，已提交面板以时间轴呈现该分支最近提交，已推送云端的记录圆点为紫色、本地为蓝色，第一条已推送记录右侧显示远端分支名 Tag；其渲染件与 Agent 会话页变更面板共用同一套共享实现。当未提交文件为空、当前为项目主 checkout（非 linked worktree）、且本地相对 upstream 有 ahead 或 behind 时，未提交空态以「同步更改」按钮替换「暂无未提交变更」文案。数据获取以选中根的 workspacePath 为键、按各自生命周期独立拉取；变更 Activity 采用条件轮询——页面可见且当前 worktree 上存在 running turn 的 Agent session 时每 4s 刷新一次，可见但无 running 时每 8s，页面隐藏时暂停，切换分支或由隐藏恢复可见时各补拉一次，遇 worktree 不可恢复错误停止轮询。另：选中项目主 checkout 且页面可见时，激活即后台执行一次 `git fetch --all --prune`（经 `fetch_project_remotes`），之后每 60s 再拉，以更新本地 remote-tracking；成功后再 soft revalidate 未提交与已提交数据，使远端 push 能反映到 ahead/behind 与「同步更改」；fire-and-forget 不阻塞首屏、失败静默、不嵌套进 4s/8s 本地轮询；linked worktree 不做后台 fetch（与 remote ops 仅主 checkout 一致）。「代码」Activity 不再保留「文件 / 变更」切换，仅提供文件树 + 编辑器，也不提供该「更多」菜单。
_Avoid_: 暂存 / 提交 / 编辑入口、跨根聚合、无差别持续轮询、在「代码」Activity 内保留变更入口或同样的拉取/推送/删除菜单、无 running turn 检查的 worktree 删除、把 4s/8s 本地刷新改成每次都 fetch

**安全推送**：
变更 Activity 主 checkout 推送路径的远端同步策略：先 fetch；相对 upstream 可快进落后则静默 `pull --ff-only` 再 push；ahead-only 直接 push；分叉或无法快进则失败提示手动处理，不启动 merge/rebase，工作区保持干净。无 upstream 时仍 `push -u origin HEAD`。「更多 → 推送」与「同步更改」中的 push 共用此策略。
_Avoid_: force push、自动 rebase、自动 merge commit、污染性冲突落地

**同步更改**：
变更 Activity 在「未提交变更」空态下，针对项目主 checkout 相对其 upstream 的 ahead/behind 所提供的一键同步入口；文案按三种计数形态展示（仅 behind / 仅 ahead / 双向）。点击后按需先确认：仅 behind 执行 pull，仅 ahead 执行 push（安全推送），双向先 pull 后 push（其中 push 仍走安全推送）；失败即停。确认可「不再显示」并记入本机 localStorage 全局偏好。计数基于本地 tracking ref；4s/8s 本地刷新路径仍不隐式 `git fetch`，remote-tracking 由主 checkout 可见时的激活首拍 + 60s 后台 fetch（及签出弹窗刷新 / pull / 安全 push）更新。linked worktree 不提供此入口。
_Avoid_: 强制每次本地刷新都 fetch、worktree 同步按钮、与未提交文件列表并存的同步入口


**创建分支**：
变更 Activity 在项目主 checkout「更多」菜单末尾提供的、基于当前 HEAD 新建并签出本地分支的入口；对话框宽 400px，仅分支名输入（默认空、无前端校验）。未提交改动随签出带走；不自动设置 upstream、不自动推送。
_Avoid_: 远程创建、worktree 内建分支、force 切换

**分支签出**：
变更 Activity 在项目主 checkout 的「更多」菜单中提供的分支切换入口。居中 500px 可滚动弹窗列出本地分支与远程分支（按最后提交时间倒序）；列表超出弹窗高度时在弹窗内纵向滚动。本地用分支图标、远程用云朵图标；每段首条右上标注「本地分支」/「远程分支」。点击本地分支直接 checkout；点击远程分支时若已有同名本地分支则签出本地，否则创建跟踪分支。当前分支可展示，再次点击为 no-op 并关闭。有未提交改动时确认「当前有未提交代码，确定要切换分支吗？」后仍走普通 checkout，Git 拒绝则报错不丢弃改动。不检查 running turn。
_Avoid_: 新建分支/分离 HEAD 入口、打开时隐式 fetch、强制丢弃改动、linked worktree 上的签出菜单、展示其他 worktree 已占用分支、展示已删除 worktree 残留的 issue 工作分支

**提交上下文菜单**：
在已提交变更时间轴中，对某一提交消息行右键打开的菜单；选项包括打开更改、在 GitHub 上打开（仅 github.com 远程可解析时显示）、复制提交 ID、复制提交消息。菜单入口与渲染挂在共享时间轴上，变更 Activity 与 Agent 会话变更面板行为一致。
_Avoid_: 左键菜单、仅单侧入口、提交文件行菜单

**工作区路径上下文菜单**：
对工作区内某一路径身份（文件或目录）右键打开的菜单；选项为复制文件名、复制相对路径、复制绝对路径（无工作区根时不出现绝对路径项）。文件树、代码搜索文件分组头、未提交与已提交变更文件行共用同一套。
_Avoid_: 浏览器默认菜单、提交上下文菜单、搜索匹配行菜单、编辑器 Tab / 面包屑 / diff 头菜单

**提交全部更改视图**：
针对某一提交、在主体区从上到下叠放该提交全部文件 diff 的只读视图；每个变更文件是可折叠面板且默认展开，滚动时当前文件面板头吸顶替换；面板头为状态图标 + 较大字号文件名 + 浅灰完整相对路径（含文件名）。变更 Activity 中替换主体；会话中作为可关闭工作区 tab（标签为短 hash + 提交主题行）。与单文件 diff 互斥。
_Avoid_: 页头摘要条、多文件同时多层 sticky、与单文件 diff 并存的多个变更 tab

**Session 输入草稿**：
用户在 Agent Session 输入框中输入但尚未发送的文本；按所属 Session 隔离保留，跨工作台页面切换不丢失，发送成功或所属 Session 被删除后清除，关闭应用后不保留。
_Avoid_: 输入缓存、消息草稿、composer 缓存

**工作区内容搜索**：
在「代码」Activity 当前选中代码根内，按查询文本与匹配选项查找文件内容匹配的能力；结果按文件分组展示匹配行预览，作用于当前根而非全项目所有根。
_Avoid_: 全局搜索 Modal、Agent 工具搜索、项目名过滤、文件名模糊查找

**代码搜索侧栏**：
「代码」Activity 左侧栏在文件树与内容搜索面板之间的互斥展示模式；由分支栏右侧搜索按钮切换，搜索面板承载查询条件与结果列表。
_Avoid_: 搜索 Modal、独立搜索 Activity、覆盖主编辑区的搜索页

**文件后缀统计**：
某一代码根下按扩展名聚合的文件数量快照，用于搜索包含/排除下拉的常见后缀推荐；与代码根绑定、存于应用运行期内存，随文件树 signature 变化重算。
_Avoid_: 持久化后缀索引、全盘 watcher、gitignore 派生后缀表

**内置智能体自动播种**：
应用启动时异步检测本机是否安装 codex/claude/opencode/grok 命令，对已安装且库中该 agentType 无任何记录（含软删）的，自动插入一条默认开启的全局 Agent profile；软删后因记录留存不再重复播种。检测仅启动时执行，不提供手动刷新。
_Avoid_: 强制每次出现的播种、盲插未安装项、手动检测按钮

**Agent 展示形式**（displayMode）：
某 Agent profile 声明的输出呈现方式，取值 json 或 tui。判定以 RedWhisk 是否已接入该 agentType 的 JSON 解析器为准——已接入（codex/claude/opencode）默认 json 且可在 json/tui 间切换，未接入（grok）锁定 tui 且隐藏切换。启动会话时按该值分流：json 走结构化 provider（消息流 + composer），tui 走交互式 PTY（xterm 主区）。OpenCode 的 json 使用 `opencode run --format json`（每轮子进程 + `-s`/`--continue` 续会话）；TUI 使用交互式 `opencode` CLI。Grok 为 TUI-only：displayMode 锁定 tui，经交互式 PTY 启动（`dangerous` 或 `full-access` 时追加 `--always-approve`），不接结构化 json 路径。
_Avoid_: 纯 UI 别名、按 CLI 能力判定、运行中切换呈现方式

**Agent Session**：
在项目中运行 Agent 的执行会话；**新建**时必须关联某一 Issue，从 Issue 启动，一个 Issue 最多关联一个有效 Session。
_Avoid_: 自定义 Session、临时 Session、无 Issue 会话、standalone session（新建语义）

**历史独立 Session**：
既有数据中 `issue` 关联为空的 Agent Session 存量；可列表查看、恢复、收发、删除与改标题，但不可再新建。
_Avoid_: 自定义 Session 产品能力、临时会话功能

**Session 展示形式快照**：
Agent Session 启动瞬间从所属 Agent profile 拷贝并持久化的 displayMode；会话存续期间 UI 路由、恢复与重启语义只认该快照，不回读 profile 当前值。
_Avoid_: 实时跟随 profile、内存-only 运行时标记

**Issue Session 归档**：
Issue 完成时将关联 Agent Session 的 runtime 会话日志固化到 archive 路径后的只读产物；形态由 Session 展示形式快照决定——json 为过滤后的 timeline JSONL；tui 为写侧提取后的纯文本，只保留各用户输入及其对应结论性正文（过程性工具输出、中间思考与 TUI chrome 不入档），并按固定块间距排版。历史错误形态的 TUI 归档不自动迁移。
_Avoid_: 运行中 live log、完整审计仓、完整过程 transcript、SQLite 中的会话正文

**Agent TUI 会话视图**：
Agents 工作台右侧在 Session 展示形式快照为 tui 时使用的主区：交互式 xterm 终端 surface，输入直达 PTY，不使用结构化消息流与底部 composer。
_Avoid_: Project Terminal 配置实体、旁路只读 TUI 面板、双轨同显

**Provider 会话标识**（providerSessionId）：
各 Agent provider 用于跨进程续接同一对话上下文的外部会话 id（Codex thread、Claude session、OpenCode session 等），持久化在 Agent Session 上；json 与 tui 路径共用。字段名中立，不绑定某一厂商。
_Avoid_: 仅 Codex 语义的 id、前端伪造 id、与 RedWhisk session 主键混用

**Agent Session 续接**（resume）：
在既有 Agent Session 记录上重新拉起运行时，以继续同一外部对话上下文：json 走结构化 provider resume；tui 走交互式 PTY + 各 CLI 的续接命令。仅当关联 Issue 为 running 或 review 时可续接；无 Issue、backlog、completed 或 Session 已正常 closed 的不自动续接。应用重启后无活跃 PTY 时，Agents 工作台打开 tui 会话可自动尝试续接。
_Avoid_: 冷启动全新对话冒充续接、Issue 只读归档面板续接、无 providerSessionId 时静默新开会话

**Agent 启用状态**（enabled）：
某 Agent profile 是否处于可用状态的布尔标记，默认启用；禁用的 profile 在 Agent 表中以浅灰行底区分并排序置末，且在「启动 Agent 会话」的选择列表中隐藏。本期启用状态仅前端过滤、后端不做启动校验。
_Avoid_: 软删标记 del、dangerous 模式标记

**项目列表移除**（从列表中移除）：
将项目从启动列表与项目切换器中隐藏，但不删除业务数据；以 `removed_at` 逻辑标记实现。同一仓库路径再次创建项目时恢复原记录（保留 id 与历史数据），并可用创建表单覆盖名称与 worktree 设置。
_Avoid_: 硬删除、归档页、独立回收站

**删除项目**：
永久删除项目及其在 SQLite 中的全部关联业务数据；不删除磁盘上的 Git 仓库与 worktree 目录。仅对当前未打开窗口的项目提供入口。
_Avoid_: 仅隐藏列表、删除本地仓库文件

**项目窗口归属**：
运行期内「某一项目当前显示在哪个应用窗口」的映射；用于切换器与启动列表判断是否已开窗：已开窗则聚焦已有窗口且不展示「更多」菜单，未开窗才提供更多操作。
_Avoid_: 持久化窗口布局、多窗口同开同一项目

**应用主题偏好**：
全局 Settings 中的 Light / Dark / System 选择，本机持久化，语义上作用于所有应用窗口（含项目窗与会话监控窗）的 UI 与终端默认配色解析；不是项目级设置。
_Avoid_: 项目主题、终端独立配色表、强调色 / accent

**已解析应用主题**：
将应用主题偏好解析为 light 或 dark 后的结果（System 跟随操作系统）；驱动 `data-theme`、xterm 主题，以及 PTY 的 `COLORFGBG` 与 OSC 10/11/12 颜色应答。
_Avoid_: 未解析的 System 字面量、项目级覆盖

**已添加技能**（Saved Agent Skill）：
用户在项目设置「技能」中按名称与范围（全局 / 当前项目）显式添加的一条技能配置；唯一键为 `name + scope`（项目范围另绑 `project_id`）。配置持久化在 SQLite，供 Issue 工作流等按 agentType 选用；不等于磁盘上所有可扫描到的本地 skill 目录条目。
_Avoid_: 本地 skill 索引条目、Agent profile、临时扫描结果

**技能路径条目**（skill path）：
已添加技能上、某一 `agentType` 对应的一条本地 `SKILL.md` 路径记录；同一技能可含多条（多 Agent、或同 Agent 多根目录）。由添加时的本地扫描或技能刷新对账写入，不由用户手工编辑路径文本。
_Avoid_: 用户手填路径、仅展示用假路径

**支持的智能体**：
已添加技能当前 `skill_paths` 所覆盖的 Agent 类型集合（Codex / Claude / OpenCode / Grok）；设置列表以图标 + 名称展示，悬停 Tooltip / 表单只读区对每个 Agent **只展示一条 preferred 路径**（优先级：专属根 → `.agents/skills` → 其他共享根 → 其余；同级字典序）。存储仍可含同 Agent 多路径；同一物理目录可归属多个 Agent（见 [ADR-0025 多 Agent 技能根归属](docs/adr/0025-multi-agent-skill-root-ownership.md)）。
_Avoid_: 当前技能路径列、Tooltip 罗列该 Agent 全部路径、单一 Agent 独占路径列

**技能刷新同步**：
对本地 skill 目录重扫并更新内存索引后，按 `name + scope` 重算已添加技能的 `skill_paths` 写回数据库的过程。项目 scope 对账源为项目扫描 ∪ 全局扫描（同 `name + agentType` 项目优先）；全局 scope 仅用全局扫描。手动「刷新技能」覆盖全局 + 当前项目并提示结果；启动静默只处理全局；进入项目技能页静默处理当前项目。对账源中找不到同名 skill 时保留配置并将 `skill_paths` 置空，不软删。
_Avoid_: 仅刷新内存索引不对账 DB、项目对账只看项目目录、刷新即删除配置、把扫描 loading 当成列表行内骨架
