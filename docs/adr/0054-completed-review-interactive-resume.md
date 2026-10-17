# 0054. 完成回看拉起只读的交互式 resume

## 状态

采纳（待执行）。

## 背景

ADR-0053 第 3 条把已完成 Issue 的 Session 回看定为不恢复进程：tui 回放终端尾部，json 显示结构化消息流。全屏 TUI 的终端快照只剩最后一屏，和归档看起来一样，看不到 CLI 自己画出的完整会话。

各 Agent 已有交互式 resume。Codex 是 `codex resume <provider_session_id>`，Grok 是 `grok --resume <provider_session_id>`。已完成 Issue 上的正式续接仍由 ADR-0050 负责，入口在 Issue 详情页，会把 Issue 改回运行中。

## 决定

1. **完成回看拉起交互式 resume**。Issue 已完成时，Session 主区默认仍是 Issue Session 归档。用户切到 Session 内容时，无论展示形式快照是 json 还是 tui，都在当前主区拉起该 Agent 的交互式 resume，展示 CLI 画出的完整会话。这次拉起不改展示形式快照。
2. **不改业务状态**。不把 Issue 改回运行中，不把 Agent Session 标成运行中，也不把退出写成 stopped 或 crashed。继续开发仍走 ADR-0050。
3. **不接收编辑输入**。滚轮和翻页键交给 CLI，由它翻自己的会话。字母、回车和其它输入丢弃。
4. **不保留这次查看的日志**。不改已落盘归档，不改原来的运行日志，也不更新 Session 的 `log_path`。离开后再次进入时重新 resume。
5. **启动目录**。工作区目录还在就在那里启动；已经不在就在项目主目录启动。不重建 worktree。
6. **不能启动时留在归档**。缺少 Provider 会话标识，或该 Agent 不支持交互式 resume 时，留在归档并说明原因。
7. **失败留在当前画面**。启动失败或进程中途退出时，留在这次切换后的画面，说明原因并提供重试，不自动退回归档。
8. **进程寿命**。切回归档、切到其他 Session 或离开 Session 页面时停掉。同一 Session 内切到终端、文件、变更或浏览器标签时保持，回到 Session 标签仍是同一次 resume。

## 后果

- ADR-0053 第 3 条和第 5 条里「只读终端尾部 / 结构化消息流」被本决定取代。归档仍是完成后的默认主区，归档提取规则不变。
- 完成回看与正式续接是两条门禁。前者不改状态，后者仍要求用户在 Issue 详情页确认并切回运行中。
- 查看进程退出不得改写 Agent Session 状态，因此不能直接复用会把退出记成 stopped 或 crashed 的正式运行时。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 继续回放终端尾部或消息流 | 看不到 CLI 画出的完整会话 |
| 查看时把 Issue 改回运行中 | 继续开发已有 ADR-0050 |
| 查看时把 Session 标成运行中 | 进程只用于查看，状态会和正式运行混淆 |
| 为回放保留临时日志 | 每次重新进入都重新 resume，不需要这份日志 |
| 工作区不在就重建 worktree | 只是查看，不恢复开发目录 |
| 启动失败自动退回归档 | 用户要留在当前画面并重试 |

## 代码事实来源

- 本决策：`docs/adr/0054-completed-review-interactive-resume.md`
- 被取代：`docs/adr/0053-session-display-mode-switch-and-completed-review.md` 第 3 条、第 5 条中的只读回放形态
- 沿用：`docs/adr/0050-reopen-completed-issue-by-resuming-session.md`
- 术语：`CONTEXT.md`（完成回看、Agent Session 续接、Provider 会话标识）
