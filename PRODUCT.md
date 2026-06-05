# Product

## Register

product

## Users

RedWhisk 面向本地 AI Coding 重度用户和独立开发者，他们在多个 Git 仓库中同时推进 Codex 任务，需要把 Issue、Agent Session、终端交互、验收状态、日志和完成审计放在同一个桌面工作台中管理。

用户处在开发工具上下文里，通常会长时间盯着界面、频繁切换 Project、检查 Agent 输出、继续修正任务，并在完成前确认 Git 结果。界面必须支持键盘优先操作，但所有关键动作都要有可见入口。

## Product Purpose

RedWhisk 是一个以 Git Project 为入口的跨平台桌面 Agent 开发工作台。它不是完整 AI 编辑器，也不是独立项目管理系统；它验证一条本地闭环：Git Project -> 本地 Issue -> Run Codex -> 内嵌 Codex Session -> Mark Review -> 继续修正或完成 -> Summary / Log。

成功标准是用户能信任每个任务的状态和结果：Agent 是否启动、Issue 为什么进入 review、是否产生 commit、commit hash 是什么、日志在哪里、异常是否被明确保留。

## Brand Personality

安静、紧凑、可靠。

RedWhisk 的语气像认真打磨过的本地开发工具：短、直接、可审计。它应让 Codex 原生交互不中断，让状态和完成判断足够清楚，避免用庆祝、拟人或绩效管理式文案干扰用户判断。

## Anti-references

不要做成营销页面、Web SaaS dashboard、项目管理后台、彩色阶段柱看板、KPI 式统计页面或过度设计的 AI Chat UI。

不要用大圆角卡片墙、渐变装饰、网页 section、hero 文案、彩色状态胶囊墙、hover-only 关键操作、拖拽作为主路径、庆祝动画或把 Codex CLI 重做成单独聊天框。

## Design Principles

1. 状态可信优先：所有改变 Issue 状态、Agent Session 状态和完成结果的动作都要能解释、能复盘、能审计。
2. 保护原生交互：Codex Native Session View 是核心工作区，Inspector、Dialog 和 Header 操作不能卸载或中断终端。
3. 桌面工具密度：界面应像本地工作台，依靠面板、边线、对齐、稳定尺寸和键盘路径组织信息，而不是网页式大区块。
4. 克制表达：黑白灰建立结构，颜色只用于 focus、attention、success、danger 等必要状态。
5. 明确边界：Project、Issue、Agent Session、Project Settings 和 Global Settings 的边界要清楚，避免把本地开发闭环扩展成通用项目管理工具。

## Accessibility & Inclusion

最低目标是桌面产品可访问性基线：所有操作按钮可键盘聚焦，Dialog 打开后焦点进入 Dialog 并在关闭后回到触发控件，`Esc` 关闭最上层 Dialog 或 Inspector，不影响 Codex Session。

状态不能只靠颜色表达；attention、crashed、stopped、no commit detected、completed 等状态必须有文本或可访问标签。控件 hit target 不小于 28px，Activity Bar 常用图标 hit target 不小于 40px。支持 reduced motion，面板和 Dialog 在 Reduce Motion 下直接出现或使用极短淡入。

UI 文案需要支持 `zh-CN` 和 `en-US`，状态与命令文案不应长期硬编码在组件内部。
