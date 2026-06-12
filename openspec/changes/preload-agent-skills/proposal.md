## Why

创建或编辑 Agent Profile 时，`default_skill` 目前没有可选数据源，前端只能展示空下拉。用户需要在程序运行期间快速选择 Codex 或 Claude Code 的全局 skill 与当前项目 skill，因此 skill 名称和路径必须在后台提前加载到内存，而不是在打开表单时临时扫描文件系统。

## What Changes

- 新增 Agent Skill Index 能力，用于发现、缓存和查询 Codex / Claude Code skill。
- 应用启动时异步加载全局 skill 到内存；打开或创建 Project 后异步加载该 Project 下的 skill 到内存。
- 新增 Tauri command / event，让前端能读取当前缓存状态，并在后台刷新完成后更新下拉列表。
- 扩展 Agent 类型支持 `codex` 与 `claude`，Agent Profile 表单按 Agent 类型过滤 skill 下拉。
- 保持 `agent_profiles.default_skill` 的现有持久化字段，不把 skill 路径写入 SQLite；路径只作为运行期缓存和下拉展示/消歧数据。

## Capabilities

### New Capabilities

- `agent-skill-index`: 发现 Codex / Claude Code 的全局与项目级 skill，并维护可供前端快速查询的运行期索引。

### Modified Capabilities

- 无。

## Impact

- Rust：`AppState`、新增 skill index service/type/command，`project_commands` 的 create/open 成功路径，`settings_commands` 的 skill 查询入口，`AgentType` 枚举扩展。
- 前端：`settings-commands.ts` DTO、`AgentProfileForm` 的 Agent 类型选择和 Skill 下拉，相关 Settings 测试。
- 测试：Rust service 单元测试覆盖目录扫描、frontmatter 解析、缓存刷新；前端测试覆盖下拉加载、按 Agent 类型过滤和项目切换。
- 外部依赖：不新增依赖；使用 Rust 标准库递归扫描和轻量 frontmatter 解析。
