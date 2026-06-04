# Sprint Change Proposal：Project Home 作为应用首屏

**Date:** 2026-06-04T17:30:23+0800
**Project:** redwhisk
**Mode:** Batch
**Status:** Applied

## 1. 问题摘要

用户明确补充：打开 RedWhisk 后不应直接看到 Activity Bar，而应先看到本机所有 Project 的 card 信息；最后一个 card 是 `+`，用于创建新的 Project。只有点击某个 Project 后，才进入带 Activity Bar 的 Project 工作台。

这修正了此前规划中“打开应用直接进入最近 Project / Activity Bar”的隐含假设。

## 2. 影响分析

受影响范围：

- PRD：关键用户旅程、术语表、产品形态、FR-1、FR-2、FR-3。
- PRD addendum：React Workbench 模块边界和 IA 冻结口径。
- UX Experience：Information Architecture、Component Patterns、State Patterns、Key Flows。
- Epics：FR inventory、UX-DR5、Story 1.1、Story 1.3、Story 1.4。
- Architecture：前端结构和实施顺序。
- Sprint status：Story 1.4 key 从 `open-recent-project` 同步为 `show-project-home`。

不改变范围：

- Project 仍绑定本地 Git Repository。
- `+` card 的 Git 校验、持久化和错误处理仍由 Story 1.3 / 1.4 负责。
- Story 1.1 只实现可运行应用骨架和首屏/工作台壳，不提前实现真实 Project 持久化。

## 3. 推荐方案

采用 Direct Adjustment。当前还未创建 story 文件，也未进入实现，直接修正文档和 sprint status key 成本最低。

入口 IA 决策：

- `Project Home` 是应用首屏。
- Project Home 展示本机 Project card 网格。
- 最后一个 card 固定为 `+` 创建 Project。
- 未选择 Project 前不显示 Activity Bar。
- 点击 Project card 后进入 Project 工作台，默认打开 Issues Activity。
- Activity Bar 只存在于 Project 工作台内，包含 `Issues`、`Agents`、`Settings`。

## 4. 实施交接

下一条 story `1.1` 应以此入口模型为准：

1. 初始化 Tauri + React + TypeScript 骨架。
2. 首屏渲染 Project Home，而不是 Activity Bar。
3. Project Home 至少包含空/占位 Project card 区域和最后一个 `+` card。
4. 可以用本地 mock/静态状态模拟“选择 Project 后进入工作台”，但不得提前实现 Git 校验和 Project 持久化。
5. 进入 Project 工作台后才显示 Activity Bar，并默认选中 `Issues`。
