## 1. 后端 Skill 索引

- [ ] 1.1 扩展 Rust / TypeScript `AgentType` 为 `codex | claude`，并更新 Agent Profile 保存与测试用例。
- [ ] 1.2 新增 `agent_skill` 类型和内存索引，保存全局与项目缓存、加载状态和最近错误。
- [ ] 1.3 实现 Codex / Claude skill 目录扫描、`SKILL.md` frontmatter 名称解析、重复名称保留和路径 canonicalize。
- [ ] 1.4 在应用启动时异步刷新全局 skill，并在刷新完成后发送 `agent-skills-updated` event。
- [ ] 1.5 在 `create_project` / `open_project` 成功后异步刷新对应 Project skill，并在刷新完成后发送 `agent-skills-updated` event。
- [ ] 1.6 新增 `list_agent_skills` 和 `refresh_agent_skills` Tauri commands，并注册到 invoke handler。

## 2. 前端集成

- [ ] 2.1 在 `settings-commands.ts` 增加 skill 查询/刷新 DTO 与 command wrapper。
- [ ] 2.2 在 `AgentProfileForm` 增加 Agent Type 控件，新建默认 `codex`，编辑使用现有 profile 类型。
- [ ] 2.3 将 Skill 下拉接入 `listAgentSkills`，按 Agent 类型过滤并分组展示 Project / Global skill。
- [ ] 2.4 订阅 `agent-skills-updated` event，使已打开表单在后台刷新完成后更新下拉。

## 3. 验证

- [ ] 3.1 增加 Rust 单元测试覆盖全局/项目扫描、Codex/Claude 路径、frontmatter fallback、重复名称和错误状态。
- [ ] 3.2 增加前端测试覆盖 Agent Type 切换、skill 下拉加载、项目切换和空缓存状态。
- [ ] 3.3 运行 `pnpm lint`。
- [ ] 3.4 运行 `pnpm typecheck`。
- [ ] 3.5 运行 `pnpm test`。
- [ ] 3.6 运行 `cd src-tauri && cargo test`。
