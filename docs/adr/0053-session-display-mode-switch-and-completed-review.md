# 0053. Session 展示形式切换与完成后的只读回看

## 状态

采纳（待执行）。

## 背景

ADR-0022 把 `displayMode` 定在 Session 启动时：json 走结构化消息流，tui 走交互式 PTY。快照在存续期内不改。用户要在同一 Session 上对调这两种形式。同一进程不能同时跑两套传输。

Issue 完成后，json 主区仍是消息流，tui 主区整页换成归档富文本。用户要两种模式都先看归档，再按需以只读方式回到 Session。已完成 Issue 重新开发走 ADR-0050，入口在 Issue 详情页，不在这次切换里。

TUI 归档从终端字节流提取时，全屏重绘会把多轮正文压成末尾一段，标题和代码块也排不好。ADR-0045、ADR-0052 已让 Codex、Grok 改读各自的本机会话记录。Claude Code 与 OpenCode 的 TUI 仍走终端提取。旁路监听 PTY 再重写成 JSONL 拿不回被重绘盖掉的正文，业界宿主读的是 CLI 自己落盘的会话记录。

## 决定

1. **展示形式切换**：Issue 未完成、且该 Agent 同时支持 json 与 tui 时，Session Tab 行最右侧提供切换。Codex、Claude Code、OpenCode、Grok 可以；DeepSeek Harness 只有 json，不显示。进程已停也可以切。进程仍在跑时先确认：同一 Session 不能并行两个任务，确认后终止当前进程，再用同一 `provider_session_id` 按新展示形式拉起，并改写 Session 展示形式快照。不改 profile 的默认展示形式。切换后用户自行输入「继续」一类指令恢复执行。
2. **切到 json 的回填**：从该 Agent 本机会话记录读出切换前已完成的轮次，写入消息流。工具调用、思考过程不回填。这条路径收窄 ADR-0047 第 9 条：结构化模式仍不用 `~/.grok/sessions` 做归档；展示形式切到 json 时允许用它回填已完成轮次。
3. **完成回看**：只在 Issue 已完成时出现。主区默认展示已落盘的 Issue Session 归档，json 与 tui 相同。按钮可切到只读 Session 再切回。只读不恢复进程、不接收输入：tui 回放已保存的终端内容，json 显示消息流。切换前说明这是只读；继续开发要在 Issue 详情页把状态改为运行中。一轮结束但 Issue 仍在进行中时不写临时归档。
4. **TUI 归档事实源**：Codex、Claude Code、OpenCode、Grok 的 TUI 完成归档都从该 Agent 自己的本机会话记录逐轮提取用户输入与最终结论，不写入工具调用与思考。定位或解析失败时回退终端提取。归档文件仍是纯文本。回看排版与 JSON 归档共用标题与代码块。不在运行中监听 PTY 重写 JSONL。已落盘归档不重写。
5. **JSON 完成后的默认主区**：完成回看默认看归档文件，不再把消息流当作完成后的默认画面。只读 Session 才回到消息流。

## 后果

- 切换替换快照，ADR-0022「存续期只认快照、不跟随 profile」仍然成立；被取代的是「快照只能在启动时写入」。
- 切到 json 后能看见切换前已提交的轮次。各 CLI 会话记录格式变化时，回填与 TUI 归档一起降级，不让切换或完成事务失败。
- Claude Code、OpenCode 需要新增本机会话记录读取。读不到时 TUI 归档仍可能只剩终端末尾。
- 完成后的只读终端回放依赖完成前留下的终端快照。完成事务若删掉 runtime 终端日志，只读 TUI 会空。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 同一 Session 内不终止进程热切换 | 两套传输不能并行 |
| 只改 profile 默认值，当前运行不动 | 用户要的是这一次 Session |
| 运行中监听 TUI 输出并写成 JSONL | 全屏重绘会丢掉早期正文，正是归档变差的原因 |
| 完成时把 TUI 转成 JSON 归档文件 | 改掉现有纯文本归档契约，收益只在渲染层 |
| Agent 一轮结束就生成临时归档 | 归档只在 Issue 完成时落盘 |
| 只读回看时把 Issue 拉回运行中 | 继续开发已有 ADR-0050 |

## 代码事实来源

- 本决策：`docs/adr/0053-session-display-mode-switch-and-completed-review.md`
- 被收窄：`docs/adr/0022-display-mode-runtime-transport.md`（快照可被显式切换替换）、`docs/adr/0047-grok-structured-json-mode.md` 第 9 条（切到 json 时允许回填）
- 沿用：`docs/adr/0045-tui-codex-archive-and-usage-from-session-log.md`、`docs/adr/0050-reopen-completed-issue-by-resuming-session.md`、`docs/adr/0052-grok-tui-archive-from-session-store.md`
- 术语：`CONTEXT.md`（展示形式切换、完成回看、Issue Session 归档）
