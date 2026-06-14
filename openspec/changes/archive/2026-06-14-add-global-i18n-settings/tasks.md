## 1. 全局 Settings 入口

- [x] 1.1 调整 `AppShell` 左侧导航结构，将 Project Activity 与底部 Global Settings 图标分组渲染。
- [x] 1.2 为 Global Settings 图标提供可访问名称，点击后打开全局 Settings surface。
- [x] 1.3 保持 Project Activity 状态可恢复：从全局 Settings 返回 Issues / Agents / Project Settings 时不丢失原活动页选择。
- [x] 1.4 补充 App shell 测试，覆盖底部图标位置语义、点击切换和项目 Activity 不被误归类。

## 2. 全局 Preferences 页面

- [x] 2.1 新增全局 Settings / Preferences 组件，复用 Project Settings 的两栏、splitter 和右侧 80% 居中内容约束。
- [x] 2.2 左栏仅渲染 `Preferences`，右侧标题和内容同步显示 Preferences。
- [x] 2.3 实现 Language section：默认 `English`，支持切换 `中文`。
- [x] 2.4 实现 Theme section：默认 `Light`；Dark / System 不可选择，或在 MVP 中不展示。
- [x] 2.5 补充组件测试，覆盖默认值、切换语言、Light 默认选中和未实现主题不可选择。

## 3. i18n 运行时

- [x] 3.1 新增或扩展 `src/shared/i18n/**`，定义 `en` / `zh` locale、消息字典和统一读取入口。
- [x] 3.2 将新增 Preferences 文案全部接入 i18n，不新增散落硬编码文案。
- [x] 3.3 迁移 App shell、Project Settings、Issues / Agents 主路径中当前用户可见的核心文案到字典。
- [x] 3.4 实现 locale 持久化与启动回读；失败时回退 `en`。
- [x] 3.5 补充 i18n 单元测试或组件测试，覆盖默认英文、中文切换和持久化回读。

## 4. 主题偏好

- [x] 4.1 定义 theme 偏好类型，MVP 仅允许 `light`。
- [x] 4.2 主题 UI 视觉参考截图，Light 卡片处于选中态。
- [x] 4.3 确保 Dark / System 不触发未实现的 CSS theme 切换。
- [x] 4.4 补充测试覆盖不可用主题不会改变当前 theme。

## 5. 文档与验证

- [x] 5.1 更新 `docs/standards/agent-development-rules.md` 中 Project Settings 与 Global Settings 的边界说明。
- [x] 5.2 如有必要，更新 `docs/standards/settings-page-layout.md`，说明 Global Settings 复用相同两栏视觉但不属于 Project Settings 模块。
- [x] 5.3 运行 `pnpm lint`。
- [x] 5.4 运行 `pnpm typecheck`。
- [x] 5.5 运行 `pnpm test -- src/app`。
- [x] 5.6 运行 `pnpm test -- src/features/settings`。
- [x] 5.7 若迁移 Issues / Agents 文案，运行对应受影响测试。
