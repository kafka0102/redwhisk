## Why

会话侧边栏「已提交」时间轴中，每条已推送到云端的提交记录都会显示带云图标的分支名 tag，存在两个问题：

1. 多条已推送记录重复显示分支名 tag，视觉嘈杂，并挤占侧边栏有限宽度。
2. tag 当前位于 commit message 与 author 之间，既不贴右，层级也与 author 同级，窄侧边栏下无法优先保证分支名可见，author 过长时还会把 tag 挤出可视区。

## What Changes

- 已推送分支名 tag 从 commit message 与 author 之间移出，改为绝对定位于行最右侧，距右边缘 4px，层级高于 author；author 过长时由 tag 覆盖 author 右侧，author 不溢出行外。
- 时间轴中已推送的提交仅保留紫色时间轴点；从上往下第一条已推送 commit 才显示分支名 tag，其余已推送 commit 不再显示 tag。
- 更新 `agents-ui` spec：将「Committed changes are not implemented yet」占位 scenario 替换为已提交时间轴与已推送 tag 的显示规则。

## Non-goals

- 不改变 commit message、author、时间轴点本身的其他样式与交互。
- 不改变 `isPushed` / `pushedTo` 数据来源与判定逻辑。
- 不调整未提交变更列表的任何布局。
