# issues-ui Specification Delta

## ADDED Requirements

### Requirement: Read-only Issue detail more-menu composition

只读 Issue 详情页的「更多」菜单 SHALL 仅保留编辑、删除等通用动作，不再包含「查看会话」「查看总结」入口；会话入口由右侧只读会话面板承担。

#### Scenario: More menu on read-only detail

- **WHEN** 用户打开非 backlog Issue 的只读详情页
- **AND** 用户展开头部「更多」菜单
- **THEN** 菜单不展示「查看会话」项
- **AND** 菜单不展示「查看总结」项
- **AND** 右侧只读会话面板仍提供「打开会话」入口

### Requirement: Read-only detail title vertical spacing

只读 Issue 详情页的标题 SHALL 与上方 header、下方描述保持相等的垂直间距，且标题与描述、标签之间不再依赖分隔线维持间距。

#### Scenario: Title centered between header and description

- **WHEN** 用户打开非 backlog Issue 的只读详情页
- **THEN** 标题文本距上方 header 的间距等于距下方描述的间距
- **AND** 标题与描述之间不渲染 `issue-detail__divider` 分隔线
- **AND** 描述与标签之间不渲染 `issue-detail__divider` 分隔线

### Requirement: Edit page back returns to read-only detail when entered from it

当编辑页是由只读详情页的「编辑 Issue」入口打开时，编辑页的「返回」SHALL 回到该只读详情页，而非关闭返回看板。

#### Scenario: Back from edit opened via read-only detail

- **WHEN** 用户在只读详情页点击「编辑 Issue」进入编辑页
- **AND** 用户点击编辑页的「返回」
- **THEN** 应用返回该 Issue 的只读详情页
- **AND** 表单被还原为该 Issue 的已保存内容，丢弃未保存编辑

#### Scenario: Back from edit opened for a backlog issue

- **WHEN** 用户打开 backlog Issue（直接以编辑态呈现）
- **AND** 用户点击编辑页的「返回」
- **THEN** 应用关闭详情并返回看板
