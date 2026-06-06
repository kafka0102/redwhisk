---
baseline_commit: 5ed5828
---

# Story 1.9a: 将项目设置入口从 Activity Bar 移至顶部栏

Status: done

## Story

作为 RedWhisk 用户,
我希望项目设置按钮在窗口顶部（与项目选择器同行）最右侧,
以便 Activity Bar 底部的设置只用于全局设置,项目设置更贴近项目上下文.

## 背景

当前 Activity Bar 同时放了 Issues、Agents、Settings 三项。底部 gear 按钮是全局设置入口。用户明确要求：
- Activity Bar 的 Settings 菜单项必须移除
- 项目设置改由顶部 header（与 ProjectSwitcher 同行）最右侧的一个小图标按钮触发
- 点击后页面仍切换至 ProjectSettingsActivity（导航机制不变）

## Acceptance Criteria

1. 给定 Project 工作台已加载，当用户查看 Activity Bar，则只看到 Issues 和 Agents 两个菜单项，不再有 Settings。
2. 给定 Project 工作台已加载，当用户查看 header 栏（与 ProjectSwitcher 同行），则最右侧显示一个设置图标按钮。
3. 给定用户点击 header 中的设置按钮，当页面响应，则 workbench 内容区切换至 ProjectSettingsActivity。
4. 给定用户已在 ProjectSettingsActivity 页面，当用户点击 Activity Bar 的 Issues 或 Agents，则正常切回对应 Activity。

## Tasks / Subtasks

- [x] 从 ACTIVITIES 数组中移除 Settings 项 (AC: 1)
- [x] 在 header 中 ProjectSwitcher 右侧添加项目设置按钮 (AC: 2)
- [x] 按钮点击时设置 activeActivity 为 "settings" (AC: 3)
- [x] 验证 Activity 切换仍正常工作 (AC: 4)
- [x] 运行 `pnpm lint`
- [x] 运行 `pnpm typecheck`
- [x] 运行 `pnpm test`

## Dev Notes

### 涉及文件

- `src/app/app-shell.tsx` — 移除 Settings 从 ACTIVITIES，header 添加按钮
- `src/app/app.css` — header 布局调整（如需要）

### 范围边界

- 不涉及 Global Settings 入口变更（gear 按钮、native menu）
- 不涉及 i18n
- 不新增路由或页面，仅移动触发入口
