## Context

当前项目是 Tauri + React 桌面应用，业务状态由 Rust Core 管理，前端通过 Tauri command 调用。`agent_profiles` 已有 `default_skill` 字段，但前端 `AgentProfileForm` 的 Skill `<select>` 只有空选项，且 `AgentType` 目前只有 `codex`。

调研结果：

- Codex skill 是包含 `SKILL.md` 的目录，`SKILL.md` 需要 `name` 和 `description`。官方文档说明 Codex 会从 repo、user、admin/system 位置读取 skill，其中 repo 位置是 `.agents/skills`，user 位置是 `$HOME/.agents/skills`，admin 位置是 `/etc/codex/skills`。
- Claude Code skill 同样以 `SKILL.md` 为入口。官方文档说明 personal skill 位于 `~/.claude/skills/<skill-name>/SKILL.md`，project skill 位于 `.claude/skills/<skill-name>/SKILL.md`，并会从父目录和部分嵌套目录发现 project skill。
- 当前运行环境还存在 Codex 兼容路径，如 `~/.codex/skills`、`~/.codex/superpowers/skills`，以及本仓库下的 `.agents/skills`、`.claude/skills`。本次实现需要把官方路径作为主路径，同时兼容这些已存在路径，避免 RedWhisk 的下拉漏掉当前可用 skill。

## Goals / Non-Goals

**Goals:**

- 在应用启动时异步扫描并缓存 Codex / Claude 的全局 skill。
- 在创建或打开 Project 后异步扫描并缓存该 Project 的 skill。
- 通过 Tauri command 返回缓存中的 skill 列表，包含 `name`、`path`、`agentType`、`scope`、`projectId`、`sourceRoot` 和加载状态。
- 前端创建或编辑 Agent Profile 时可以按 Agent 类型选择 skill；后台刷新完成后下拉能更新。
- 兼容重复 skill 名称：不合并记录，展示路径用于消歧。

**Non-Goals:**

- 不在本次实现中执行 skill、解析 skill 的全部 Markdown 指令或校验 allowed tools。
- 不把 skill 列表持久化到 SQLite；缓存只存在于当前进程内。
- 不实现 plugin 管理 UI，也不修改 Codex / Claude 的真实 skill 装载行为。
- 不为每个嵌套目录推导 Codex/Claude 在特定工作目录下的精确可见性；RedWhisk 的项目索引目标是“当前项目下可选 skill 列表”。

## Decisions

### 1. 在 Rust Core 建立运行期内存索引

新增 `agent_skill` 模块，提供：

- `AgentSkillRecord`：跨边界 DTO，字段包含 `name`、`path`、`agent_type`、`scope`、`project_id`、`source_root`。
- `AgentSkillIndex`：保存在 `AppState` 的 `Arc<RwLock<...>>` 或等价并发容器中。
- `AgentSkillService`：负责扫描目录、解析 `SKILL.md` frontmatter、刷新全局或项目缓存。

理由：skill 发现是文件系统能力，且需要在 app 启动和项目打开时由后端触发。放在 Rust Core 可避免 React 直接访问本机路径，也符合现有 Tauri command 边界。

备选：前端打开表单时调用一个同步扫描 command。该方案简单，但大 skill 集合会卡住表单打开路径，也不满足“启动/打开项目时异步加载到内存”的首要要求。

### 2. 使用文件系统扫描，不依赖 Codex/Claude CLI 列表命令

扫描规则：

- Codex global：`$HOME/.agents/skills`、`$HOME/.codex/skills`、`$HOME/.codex/superpowers/skills`、`/etc/codex/skills`，存在才扫描。
- Codex project：选中项目下的 `.agents/skills` 和兼容 `.codex/skills`，并扫描项目内嵌套的 `.agents/skills`。
- Claude global：`$HOME/.claude/skills`。
- Claude project：选中项目下的 `.claude/skills`，并扫描项目内嵌套的 `.claude/skills`。

扫描只识别 `<skills-root>/<skill-name>/SKILL.md`。解析优先使用 frontmatter `name`；如果缺失，则用目录名作为 fallback。路径使用 canonical path；无法 canonicalize 的记录跳过并记录刷新错误。

理由：Codex 和 Claude Code 的交互式菜单不适合作为桌面应用的数据源，文件系统规则更稳定，也能覆盖当前环境中已安装但 CLI 不一定能列出的 skill。

备选：启动 `codex` / `claude` 并读取 `/skills` 输出。该方案依赖 TUI/CLI 格式，难以测试，也会引入启动成本和授权状态问题。

### 3. 刷新异步触发，查询只读缓存

在 Tauri `.setup` 阶段 spawn 全局刷新任务；`create_project` 和 `open_project` 成功拿到 `ProjectSummary` 后 spawn 项目刷新任务。新增 command：

- `list_agent_skills({ agentType?: AgentType, projectId?: number | null })`
- `refresh_agent_skills({ projectId?: number | null })`

`list_agent_skills` 只读内存缓存，不做扫描。返回加载状态：`idle | loading | ready | failed`，以及最近错误消息。刷新完成后发送 `agent-skills-updated` event，payload 包含 `agentType`、`scope`、`projectId`。

理由：列表查询必须快；刷新任务与 UI 交互解耦。事件让已打开的 Agent Profile 表单在后台加载完成时更新。

### 4. 前端按 Agent 类型过滤 skill

`AgentProfileForm` 新增 Agent Type 控件，初始值为当前 profile 的 `agentType`，新建时默认 `codex`。Skill 下拉调用 `listAgentSkills`，显示当前 Agent 类型的 global + 当前 project skill，分组展示 Project / Global。保存仍写入 `defaultSkill` 字符串；选项值使用 skill `name`，重复名称的 label 增加相对/绝对路径提示。

理由：当前数据库只有 `default_skill` 字符串，保持持久化兼容。路径用于展示和选择时消歧，但不改变已有 Agent Profile schema。

## Risks / Trade-offs

- [Risk] 嵌套扫描在大型仓库中耗时较长 -> 限制只匹配目录名为 `.agents/skills`、`.codex/skills`、`.claude/skills` 的路径，并跳过 `.git`、`node_modules`、`target`、`dist`、`build` 等常见大目录。
- [Risk] Codex/Claude 未来调整 skill 搜索路径 -> 将路径规则集中在 Rust service，后续只改一处；本次保留官方路径和当前环境兼容路径。
- [Risk] 同名 skill 的真实优先级与 RedWhisk 下拉顺序不完全一致 -> 不合并同名记录，展示路径；保存仍保持现有名称语义。
- [Risk] 前端打开表单时全局或项目缓存尚未完成 -> 下拉展示 loading/empty 状态，订阅 `agent-skills-updated` 后自动刷新。

## Migration Plan

1. 扩展 Rust `AgentType` 为 `codex | claude`，无需数据库 migration，因为 SQLite 已存字符串枚举。
2. 新增内存索引和 commands，不迁移历史 `agent_profiles.default_skill`。
3. 前端表单默认仍创建 Codex profile，避免改变现有用户默认行为。
4. 回滚时移除新增 commands/UI 即可；已有 profile 数据不受影响。

## Open Questions

- 是否需要在后续变更中把 `default_skill` 从名称升级为结构化字段，以区分同名 skill 的路径和 scope？本次先保持兼容，不做 schema 迁移。
