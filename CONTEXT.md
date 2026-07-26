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
Agent 最终答复中由 `<issue-comment>` 包围的精简交付内容；它是唯一可自动创建 Issue 评论的 Agent 输出，完整答复仍属于 Agent Session。
_Avoid_: 原始最终答复、会话转录

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
Session 工作区中的固定代码浏览 Tab；以项目目录或一个已存在且附着本地分支的 Git worktree 为根目录，展示其文件树和只读文件内容。分支选择按项目在当前应用运行期间保留；已失效的 worktree 选择自动回退到项目目录分支，detached HEAD worktree 不列为候选项。文件树中的忽略项由 Git 忽略规则判定并灰显，但仍可浏览。文件树与变更徽标按「项目 + 工作区根」在应用运行期内存中做 SWR 缓存：切回代码页或切到曾访问过的根时先展示缓存数据且不闪加载态，同时后台静默检测；内容 signature 未变则不更新界面，变化则静默替换树与徽标；无缓存的首次访问才显示加载态。文件 Tab 以根目录隔离，切换根目录时关闭当前 Tab；每个根目录最多保留十个文件 Tab，超出时淘汰最久未激活的 Tab。当前激活的文件 Tab 在代码页与应用窗口均可见时，按与文件树相同的节奏做轻量元数据签名检测（体积与修改时间）；签名未变不重载正文，签名变化则静默重新读取并替换内容（不闪加载态，尽量保留阅读位置）；页面或窗口隐藏时暂停检测，切换到该 Tab 或由隐藏恢复可见时立即检测一次。检测失败（如文件已删除）按与切回代码页复检相同方式写入错误态；文件恢复可读后再自动读回。代码区路径面包屑中的文件夹层级可点击，弹出以该目录为根的树形菜单，子目录可在菜单内多级展开/收起；左侧文件树的文件夹则在常驻侧栏内展开或收起。当当前文件的语言为 markdown 时，面包屑行最右侧提供源码/渲染预览切换；默认源码视图，预览仅用当前打开期间的内存态，不跨 tab 关闭或文件切换记忆，也不持久化。预览态对 language 为 mermaid 的 fenced code block 客户端渲染为静态只读 SVG，主题跟随应用 light/dark；非法图源仅在该块显示错误态且不拖垮整页预览。
_Avoid_: Agent 会话工作目录、可编辑 IDE、持久化项目设置、markdown 预览分屏、仓库内相对资源解析、无签名的定时整文件刷新、后台未激活 Tab 的内容轮询、跨卸载强制清空已缓存文件树、变更 Activity / Agent 会话工作区的同等刷新（非本能力范围）、Agent 消息 / Issue 只读页的 Mermaid、缩放拖拽交互图、mermaid 围栏别名

**项目终端**：
归属某一项目的交互式 shell 会话；在 Workbench 中以终端视图呈现，与 Agent 结构化会话流分离。
_Avoid_: Agent Session 终端、Codex 原生视图、日志查看器

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
与「代码」Activity 同级的顶层工作台页面，位于左侧菜单 code 与终端之间。两栏布局：左栏为分支下拉（不设刷新按钮）与其右侧「更多」菜单 + 变更视图，右栏为 diff 主体（点单文件打开单文件 diff，或经提交上下文菜单「打开更改」进入提交全部更改视图）。「更多」仅属于变更 Activity：选中项目主 checkout 时提供拉取与推送；选中 linked worktree 时提供删除（确认文案为「确定要删除吗？」）。拉取执行当前分支 `git pull`；推送在已有 upstream 时 `git push`，无 upstream 时 `git push -u origin HEAD`；删除可针对任意 linked worktree（不限 RedWhisk 托管、不绑 Issue），强制移除目录并删除对应本地分支，但若该路径上存在 running turn 的 Agent session 则禁止删除。拉取/推送成功后立即刷新未提交与已提交数据。变更视图以当前选中根工作区为范围，分「未提交变更」「已提交变更」两个默认展开的折叠面板；未提交面板列出工作区改动文件（列表最大高度 300px，超出滚动），已提交面板以时间轴呈现该分支最近提交，已推送云端的记录圆点为紫色、本地为蓝色，第一条已推送记录右侧显示远端分支名 Tag；其渲染件与 Agent 会话页变更面板共用同一套共享实现。数据获取以选中根的 workspacePath 为键、按各自生命周期独立拉取；变更 Activity 采用条件轮询——页面可见且当前 worktree 上存在 running turn 的 Agent session 时每 4s 刷新一次，可见但无 running 时每 8s，页面隐藏时暂停，切换分支或由隐藏恢复可见时各补拉一次，遇 worktree 不可恢复错误停止轮询。「代码」Activity 不再保留「文件 / 变更」切换，仅提供文件树 + 编辑器，也不提供该「更多」菜单。
_Avoid_: 暂存 / 提交 / 编辑入口、跨根聚合、无差别持续轮询、在「代码」Activity 内保留变更入口或同样的拉取/推送/删除菜单、无 running turn 检查的 worktree 删除

**提交上下文菜单**：
在已提交变更时间轴中，对某一提交消息行右键打开的菜单；选项包括打开更改、在 GitHub 上打开（仅 github.com 远程可解析时显示）、复制提交 ID、复制提交消息。菜单入口与渲染挂在共享时间轴上，变更 Activity 与 Agent 会话变更面板行为一致。
_Avoid_: 左键菜单、仅单侧入口、提交文件行菜单

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
某 Agent profile 声明的输出呈现方式，取值 json 或 tui。判定以 RedWhisk 是否已接入该 agentType 的 JSON 解析器为准——已接入（codex/claude/opencode）默认 json 且可在 json/tui 间切换，未接入（grok）锁定 tui 且隐藏切换。启动会话时按该值分流：json 走结构化 provider（消息流 + composer），tui 走交互式 PTY（xterm 主区）。OpenCode 的 json 使用 `opencode run --format json`（每轮子进程 + `-s`/`--continue` 续会话）；TUI 使用交互式 `opencode` CLI。Grok 在具备可启动实现前仍不可真正启动会话。
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

**已添加技能**（Saved Agent Skill）：
用户在项目设置「技能」中按名称与范围（全局 / 当前项目）显式添加的一条技能配置；唯一键为 `name + scope`（项目范围另绑 `project_id`）。配置持久化在 SQLite，供 Issue 工作流等按 agentType 选用；不等于磁盘上所有可扫描到的本地 skill 目录条目。
_Avoid_: 本地 skill 索引条目、Agent profile、临时扫描结果

**技能路径条目**（skill path）：
已添加技能上、某一 `agentType` 对应的一条本地 `SKILL.md` 路径记录；同一技能可含多条（多 Agent、或同 Agent 多根目录）。由添加时的本地扫描或技能刷新对账写入，不由用户手工编辑路径文本。
_Avoid_: 用户手填路径、仅展示用假路径

**支持的智能体**：
已添加技能当前 `skill_paths` 所覆盖的 Agent 类型集合（Codex / Claude / OpenCode / Grok）；设置列表以图标 + 名称展示，悬停 Tooltip 展示该 Agent 下的路径。同一物理目录可归属多个 Agent（见 ADR 多 Agent 技能根映射）。
_Avoid_: 当前技能路径列、单一 Agent 独占路径列

**技能刷新同步**：
对本地 skill 目录重扫并更新内存索引后，按 `name + scope` 重算已添加技能的 `skill_paths` 写回数据库的过程。手动「刷新技能」覆盖全局 + 当前项目并提示结果；启动静默只处理全局；进入项目技能页静默处理当前项目。找不到同名 skill 时保留配置并将 `skill_paths` 置空，不软删。
_Avoid_: 仅刷新内存索引不对账 DB、刷新即删除配置、把扫描 loading 当成列表行内骨架
