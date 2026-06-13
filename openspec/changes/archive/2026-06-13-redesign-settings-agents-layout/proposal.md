## Why

Settings 的右侧内容区域目前没有统一的 80% 居中布局规则，General 表单 card 也存在固定高度观感，不利于后续菜单项复用同一页面骨架。Agents 设置页当前按 Project / Global 分块展示，无法在一个视图中对比 agent 类型、名称、命令、范围和工作流 skill；新增 agent 弹窗也暴露了使用模式和提示词模板等非当前配置主路径字段。

## What Changes

- 调整 Settings 右侧通用内容模板：每个菜单页的主要内容宽度为右侧区域的 80%，并水平居中；General card 不再依赖固定高度。
- 将 Settings 的 Agents 页面改为标题下方一个 card 承载操作区，再用 table 展示所有 Project 与 Global agent profile。
- Agents table 展示 agent 类型 logo、名称、命令、范围和工作流 skill；类型 logo 复用 Agents Session 列表中的 Codex / Claude 图片资源。
- 将新增 agent 入口统一为 card 右上角的 `+ New agent` 按钮，打开统一标题为 `New agent` 的弹窗。
- 调整新增 agent 表单字段顺序为 Name、Type、Command、Scope、Workflow Skill；默认 Type 为 `codex`，默认 Scope 为 `global`。
- Command 字段自动检测命令并只填入命令名而非全路径，右侧提供 `测试` 按钮调用现有命令校验能力。
- Workflow Skill 根据 Scope 动态加载：Global 使用对应 agent 类型的全局缓存，Project 使用当前项目下对应 agent 类型的项目 skill；选项同时展示名称和浅灰路径。
- 隐藏 Usage Mode 和 Prompt Template 字段；保存时继续使用现有持久化字段，Usage Mode 使用默认模式并启用 dangerous 参数，Prompt Template 保存为空字符串。

## Capabilities

### New Capabilities

- `settings-ui`: 定义 Settings 页面右侧内容布局、Agents 设置列表和 New agent 弹窗行为。

### Modified Capabilities

- `agent-skill-index`: Agents 设置弹窗的 Workflow Skill 选择需要继续使用缓存 skill 查询能力，并按 agent 类型与 scope 过滤展示。

## Impact

- 前端：`src/features/settings/project-settings-activity.tsx`、`src/features/settings/agent-profile-form.tsx`、Settings 相关样式和测试。
- 前端资产复用：从 Agents Session 列表复用 Codex / Claude logo 解析逻辑或抽出共享 helper。
- 文档规范：更新 `docs/standards/settings-page-layout.md`，把 80% 居中内容布局写入后续 Settings 菜单页规则。
- 测试：覆盖 General 80% 居中布局、Agents table 列、`+ New agent` 弹窗字段顺序、scope 驱动 skill 查询、命令测试按钮和隐藏字段默认保存值。
- 数据模型：不新增 migration；继续使用 `agent_profiles` 的现有字段。
