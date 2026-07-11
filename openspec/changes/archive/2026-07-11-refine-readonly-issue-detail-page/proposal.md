# Proposal: refine-readonly-issue-detail-page

## Summary

对只读 Issue 详情页做三项收口式调整：精简「更多」菜单、修正标题垂直间距、修复从只读详情进入编辑后的返回目的地。

## Motivation

- 「更多」菜单中的「查看会话」「查看总结」与右侧会话面板或其它入口功能重复或已无入口需求，造成菜单冗余。
- 只读详情页的标题与上方 header、下方描述间距不一致（上方 22px、下方仅靠 divider 的 4px margin），视觉上标题偏上。
- 从只读详情页点击「编辑 Issue」进入编辑页后，点击「返回」会直接跳回看板，而非回到只读详情页，破坏浏览上下文。

## Scope

- `src/features/issues/issue-read-only-page.tsx`
- `src/features/issues/issues-activity.tsx`
- `src/app/app.css`

## Changes

- 移除只读详情页「更多」菜单中的「查看会话」「查看总结」两个菜单项，并清理只为这两个菜单项存在的 props / handler / 导入。
- 移除只读详情 article 下的 `issue-detail__divider`，通过 content-shell 顶部 padding 与 article gap 使标题距上方 header 与距下方描述的间距一致。
- 为编辑页的「返回」提供新的取消处理：当编辑态是由只读详情页发起时，返回只读详情页而非关闭回看板。

## Non-goals

- 不删除 `issue-summary-dialog.tsx` 组件文件本身，仅移除其在 `issues-activity.tsx` 中已失去入口的接线。
- 不调整右侧只读会话面板（其自身仍保留「打开会话」入口）。
- 不改变活动栏 Issue 图标的既有「按当前详情态返回看板」行为。
- 不改动 i18n key（`viewSession` 仍被会话面板使用；`viewSummary` 保留为无害冗余 key）。
