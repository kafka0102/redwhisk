# 0050. 已完成 Issue 以原 Session 续接方式切回运行中

## 状态

采纳（待执行）。

## 背景

已完成 Issue 的状态菜单不能进入「运行中」，Agent Session 续接也拒绝 `completed`。用户需要在同一外部对话上继续，而不是新建一条 Session。完成时 runtime 日志已换成 Issue Session 归档，worktree 也可能已删除。

## 决定

1. **显式重开才放行续接**：仅当用户把已完成 Issue 切回「运行中」并在运行对话框确认时，才允许对原 Session 续接。无 Issue、backlog 仍拒绝。Review 不能从已完成直接进入。Session 是否 closed 仍不作为门禁。
2. **能力不足则不可选**：当前 Agent 的展示形式不支持续接，或缺少 Provider 会话标识时，「运行中」不可选并说明原因。TUI 以 `supports_tui_resume` 为准；json 以存在 Provider 会话标识为准。
3. **成功后才离开已完成**：确认后先准备目录并续接。失败则 Issue 保持已完成，对话框展示具体错误。成功后才改为运行中。
4. **归档成为新的 runtime 日志**：json 复制归档 JSONL；TUI 把归档纯文本写入新的 runtime 日志，作为终端初始内容。归档文件保留。
5. **Agent 锁定，目录可重建**：对话框中的 Agent 固定为该 Session 的 Agent。worktree 已删除时按对话框所选的已有分支重建，不新建同名分支。

## 后果

- 术语「Agent Session 续接」不再把 completed 一律排除；排除的是未经这次显式重开的自动续接。
- ADR-0044 里「completed 拒绝续接」被本决策取代；其余门禁继续有效。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 不支持续接时仍允许切状态，确认后报错 | 用户点进去才失败 |
| 续接失败后先改成运行中再改回 | 看板会出现跑不起来的运行中 Issue |
| TUI 不灌归档，终端从续接 CLI 的空画面开始 | 用户看不到此前结论 |
| worktree 已删除就禁止重开 | 用户已选择在对话框里重建 |
