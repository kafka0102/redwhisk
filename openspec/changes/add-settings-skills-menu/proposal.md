## Why

目前 Settings 页面已有 General、Agents、Labels 三个菜单项，但缺少对 Skills 的管理入口。项目已经支持 agent skill 的扫描和列表能力（`list_agent_skills`），但用户无法：
1. 查看所有可用的 skills 并按名称、scope、agent type 分组展示
2. 将常用的 skills 配置成可重用的 skill profile（重命名、选择支持的 agent types）
3. 编辑或删除已配置的 skills

结果是 skills 的发现与配置能力缺失，用户无法在 Settings 中统一管理可用的 agent skills。

## What Changes

- 在 Settings 页面 Agents 菜单项下方新增 Skills 菜单项，使用与 Agents 类似的两栏布局。
- Skills 页面展示一个 table，包含：skill 名称、scope（global/project）、Skill 路径（agent 图标 + 路径列表）、操作列（编辑/删除）。
- 右上角有 "New skill" 按钮，点击打开新建 skill 的 modal。
- 新建/编辑 skill 时：
  - 第一行是 scope 选择（global/project），默认 global
  - 第二行是 skill 名称下拉搜索框，支持按名称搜索
  - 选择 scope 后，从当前支持的 agent types 中查询所有可用 skills，并按名称归一化分组（同名 skill 归为一组，可能对应多种 agent type）
  - 用户选择一个 skill 后，下方列出该 skill 对应的各 agent type paths，支持 checkbox 选择（默认全选）
  - 项目级 skill 使用相对路径保存
- 保存时验证：global 的 name 不重复，同一项目内 name 不重复。
- 后端新增 `saved_agent_skills` 数据库表，持久化用户配置的 skills。
- 新增相关 Tauri commands：`list_saved_agent_skills`、`save_saved_agent_skill`、`delete_saved_agent_skill`。

## Non-goals

- 不在本次改动中实现 skill 的执行逻辑或 workflow 集成。
- 不改动现有的 `list_agent_skills` 和 `refresh_agent_skills` 扫描逻辑。
- 不引入新的权限控制或访问控制机制。

## Capabilities

### New Capabilities

- `settings-skills-ui`: 定义 Settings Skills 页面的表格、新建/编辑 modal 交互、数据展示规则。
- `settings-skills-datamodel`: 定义 saved agent skills 的数据模型、migration、repository、service 和 Tauri commands。

## Impact

- 前端：`src/features/settings/**`（新增 `settings-skills-panel.tsx`、相关类型、i18n），修改 `project-settings-activity.tsx`。
- 后端：新增 migration、`saved_agent_skill` 类型、repository、service 新增 Tauri commands、测试。
- 验证：至少覆盖 skills 页面展示、新建/编辑/删除流程、名称唯一性验证、相对路径保存。
