# ADR 0060：DeepSeek Agent Profile 配置入口暂隐且停止自动播种

## 状态

采纳（已执行）。

## 背景

DeepSeek Harness 的 ACP provider 已接入，但当前产品阶段不开放用户创建或选择 DeepSeek Agent。若继续展示设置列表、新建类型和任务运行选择，用户会看到当前不可管理的配置；本机安装 `dsh` 时还会自动生成一条页面不可见的 Profile。

## 决定

1. 增加集中式 Agent Profile 页面可见性纯函数，当前只隐藏 `deepseek`。设置列表、新建类型选项和任务运行选择消费同一口径。
2. 设置列表继续接收完整 Profile 集合用于容量统计和全量顺序保存，但只渲染可见行；仅 DeepSeek 时使用既有空态。
3. 可见行拖拽只在原可见槽位间重排，隐藏 Profile 保持其在完整顺序中的相对位置。例如完整顺序 `[Codex, DeepSeek, Grok]` 重排为 `[Grok, Codex]` 时，提交 `[Grok, DeepSeek, Codex]`。
4. 自动播种只探测并播种 Codex、Claude Code、OpenCode 与 Grok，不再探测或播种 DeepSeek。
5. 不删除、软删或迁移既有 DeepSeek Profile/Session；底层 provider、ACP 传输、时间线、权限、附件、Session 展示与续接路径保持不变。
6. 本决定只覆盖 [ADR-0048](./0048-deepseek-harness-acp-not-sdk.md) 第 6 条的 `dsh` 自动播种要求；ADR-0048 关于 ACP、权限、图片与展示形式的其余决定继续有效。

## 后果

- 全新环境或只安装 `dsh` 时不会出现用户无法管理的 DeepSeek Profile。
- 已存在的 DeepSeek Profile 仍保留在数据库中，存量 DeepSeek Session 仍可查看、交互和续接。
- 恢复入口时应删除或调整集中式隐藏类型集合并恢复播种，不重新实现 provider。
- 产品状态没变但恢复页面前不提供手动开关或“即将支持”提示。

## 代码事实来源

- 页面可见性：`src/shared/agents/agent-profile-visibility.ts`
- 设置入口：`src/features/settings/settings-agents-panel.tsx`、`src/features/settings/agent-profile-form.tsx`
- 任务运行入口：`src/features/agents/agent-launch-eligibility.ts`
- 自动播种：`src-tauri/src/features/settings/service.rs`
- 被收窄的旧决策：[ADR-0048](./0048-deepseek-harness-acp-not-sdk.md) 第 6 条

## 替代方案

- 删除 `AgentType::DeepSeek` 或 provider：被拒绝。底层能力已接入，后续需要恢复。
- 迁移或软删存量 DeepSeek Profile/Session：被拒绝。会破坏历史会话与恢复能力。
- 新增持久化功能开关：被拒绝。当前只是集中式产品可见性收缩，不需要用户配置或兼容层。
