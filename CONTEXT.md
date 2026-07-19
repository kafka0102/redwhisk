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

**Worktree 所有权**：
某一 Agent worktree 由谁负责自动清理：RedWhisk 托管，或外部 / 用户提供。仅 RedWhisk 托管的 worktree 在完成流程中可被自动对账清理；外部 worktree 需用户确认。
_Avoid_: workspace mode、session 工作目录归属

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
Session 工作区中的固定代码浏览 Tab；以项目目录或一个已存在且附着本地分支的 Git worktree 为根目录，展示其文件树和只读文件内容。分支选择按项目在当前应用运行期间保留；已失效的 worktree 选择自动回退到项目目录分支，detached HEAD worktree 不列为候选项。文件树中的忽略项由 Git 忽略规则判定并灰显，但仍可浏览。文件 Tab 以根目录隔离，切换根目录时关闭当前 Tab；每个根目录最多保留十个文件 Tab，超出时淘汰最久未激活的 Tab。代码区路径面包屑中的文件夹层级可点击，弹出以该目录为根的树形菜单，子目录可在菜单内多级展开/收起；左侧文件树的文件夹则在常驻侧栏内展开或收起。
_Avoid_: Agent 会话工作目录、可编辑 IDE、持久化项目设置

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
与「代码」Activity 同级的顶层工作台页面，位于左侧菜单 code 与终端之间。两栏布局：左栏为分支下拉（不设刷新按钮）+ 变更视图，右栏为只读编辑器（点击变更文件后以 Monaco 打开）。变更视图以当前选中根工作区为范围，分「未提交变更」「已提交变更」两个默认展开的折叠面板；未提交面板列出工作区改动文件（列表最大高度 300px，超出滚动），已提交面板以时间轴呈现该分支最近提交，已推送云端的记录圆点为紫色、本地为蓝色，第一条已推送记录右侧显示远端分支名 Tag；其渲染件与 Agent 会话页变更面板共用同一套共享实现。数据获取以选中根的 workspacePath 为键、按各自生命周期独立拉取；变更 Activity 采用条件轮询——页面可见且当前 worktree 上存在 running turn 的 Agent session 时每 4s 刷新一次，可见但无 running 时每 8s，页面隐藏时暂停，切换分支或由隐藏恢复可见时各补拉一次，遇 worktree 不可恢复错误停止轮询。「代码」Activity 不再保留「文件 / 变更」切换，仅提供文件树 + 编辑器。
_Avoid_: 暂存 / 提交 / 编辑入口、diff 内容查看、跨根聚合、无差别持续轮询、在「代码」Activity 内保留变更入口

**Session 输入草稿**：
用户在 Agent Session 输入框中输入但尚未发送的文本；按所属 Session 隔离保留，跨工作台页面切换不丢失，发送成功或所属 Session 被删除后清除，关闭应用后不保留。
_Avoid_: 输入缓存、消息草稿、composer 缓存

**内置智能体自动播种**：
应用启动时异步检测本机是否安装 codex/claude/opencode/grok 命令，对已安装且库中该 agentType 无任何记录（含软删）的，自动插入一条默认开启的全局 Agent profile；软删后因记录留存不再重复播种。检测仅启动时执行，不提供手动刷新。
_Avoid_: 强制每次出现的播种、盲插未安装项、手动检测按钮

**Agent 展示形式**（displayMode）：
某 Agent profile 的输出在 UI 上的呈现方式，取值 json 或 tui；判定以 RedWhisk 当前是否已接入该 agentType 的 JSON 解析器为准——已接入（codex/claude）默认 json 且可在 json/tui 间切换，未接入（opencode/grok）锁定 tui 且隐藏切换。本期仅作数据记录与表单/表格展示，不驱动后端渲染切换；TUI 渲染与 opencode/grok 解析器留后续。
_Avoid_: 纯 UI 别名、按 CLI 能力判定

**Agent 启用状态**（enabled）：
某 Agent profile 是否处于可用状态的布尔标记，默认启用；禁用的 profile 在 Agent 表中以浅灰行底区分并排序置末，且在「启动 Agent 会话」的选择列表中隐藏。本期启用状态仅前端过滤、后端不做启动校验。
_Avoid_: 软删标记 del、dangerous 模式标记
