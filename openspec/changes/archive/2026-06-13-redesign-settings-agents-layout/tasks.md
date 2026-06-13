## 1. Settings 布局规范

- [x] 1.1 更新 `docs/standards/settings-page-layout.md`，将右侧内容容器规则改为右侧区域 80% 宽度并水平居中。
- [x] 1.2 调整 Settings 右侧通用 frame / CSS，使 General 和 Agents 复用同一 80% 居中内容容器。
- [x] 1.3 移除 General card 固定高度依赖，保证表单按内容自然撑开。

## 2. Agents 设置页

- [x] 2.1 将 Agents 右侧内容改为标题、action card、profiles table 的结构。
- [x] 2.2 合并 Project 与 Global profiles，table 列固定为 Type logo、Name、Command、Scope、Workflow Skill。
- [x] 2.3 复用 Agents Session 页面中的 Codex / Claude logo 资源或抽取共享 helper，避免重复资产路径逻辑。
- [x] 2.4 将新增入口统一为 action card 右上角 `+ New agent` 按钮，默认创建 scope 为 global。

## 3. New agent 弹窗

- [x] 3.1 将创建弹窗标题统一为 `New agent`。
- [x] 3.2 调整字段顺序为 Name、Type、Command、Scope、Workflow Skill。
- [x] 3.3 Type 默认 `codex`，另一个选项显示 `Claude Code` 并保存为现有 `claude` 值。
- [x] 3.4 创建时自动检测命令并只填入命令名；Command 输入右侧提供 `测试` 小按钮。
- [x] 3.5 Scope 默认 `global`，切换 scope 时按当前 Type + Scope 重新加载 Workflow Skill。
- [x] 3.6 Workflow Skill 选项展示名称和浅灰路径；Global 只显示全局缓存，Project 只显示当前项目 skill。
- [x] 3.7 隐藏 Usage Mode 和 Prompt Template；新增保存使用默认 mode、`dangerous: true`、空 prompt template，编辑保存不静默清空旧 prompt template。

## 4. 验证

- [x] 4.1 更新 Settings 前端测试，覆盖 80% 居中布局、Agents table 列和 `+ New agent` 入口。
- [x] 4.2 更新 AgentProfileForm 测试覆盖字段顺序、命令测试、scope 驱动 skill 加载和隐藏字段默认保存。
- [x] 4.3 运行 `pnpm lint`。
- [x] 4.4 运行 `pnpm typecheck`。
- [x] 4.5 运行 `pnpm test -- src/features/settings/project-settings-activity.test.tsx`。
