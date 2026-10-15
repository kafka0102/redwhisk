# 0052. Grok TUI 归档取自本机会话存储的已提交结论

## 状态

采纳（待执行）。

## 背景

Grok TUI 的 Issue Session 归档目前只从终端快照做结论向提取。全屏重绘会把输入框里未写完、被截断的残句当成结论，已提交的各轮助手正文则进不了归档。Issue 293 的归档因此只剩一次用户输入和半句输入框文字。

Grok TUI 与结构化会话共用本机 `~/.grok/sessions`。其中已提交的用户消息和助手正文可以按轮还原。ADR-0047 第 9 条禁止结构化模式读这份存储做归档或补数；该限制不覆盖 TUI 完成归档。

## 决定

1. **分派条件**：仅 `display_mode=tui` 且 `agent_type=grok` 时读取本机会话存储。Codex TUI 仍按 ADR-0045。其它 TUI 与全部 json 归档保持既有行为。
2. **事实源**：`~/.grok/sessions` 中该会话已提交的用户消息与助手正文。用户轮是非合成 `user` 记录，且正文含 `<user_query>`；没有 `prompt_index` 的真实输入仍算一轮。没有 `<user_query>` 的 user 记录是内部提示，不单独成轮，其后的助手正文也不算上一轮结论。不写入工具调用、工具输出、推理过程、合成消息和 TUI chrome。
3. **每轮正文**：保留该轮用户输入，以及其后最后一条已写完、且后面不再调工具的助手正文。没有这种正文时，该轮只留用户输入。
4. **输入框残句**：未提交的输入框文字不是结论，不入档。回退到终端提取时同样丢掉这类残句。
5. **降级**：定位或解析失败时静默回退既有终端提取，不让完成事务失败。
6. **不改存量**：已落盘归档不重写，也不在再次完成时自动覆盖。新规则只作用于之后新写的归档。
7. **收窄 ADR-0047 第 9 条**：仅允许 Grok TUI 的 Issue 完成归档读取 `~/.grok/sessions`。结构化模式仍不读它做归档或补数。

## 后果

- 新完成的 Grok TUI 归档能按轮回放已提交的用户输入和该轮最终结论。
- 会话存储是本机闭源格式。解析失败时归档仍可能偏短，但不再把输入框残句当结论。
- Issue 293 的现有归档保持原样。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 只改终端提取、不读会话存储 | 全屏重绘下已提交正文仍会丢失 |
| 读不到会话存储就写空归档 | 完成回看会比今天更空 |
| 重写已落盘的过短归档 | 用户明确只修之后新写的归档 |
| 所有 TUI 都改读各自的本机会话存储 | 本次只处理已确认的 Grok 缺口 |

## 代码事实来源

- 本决策：`docs/adr/0052-grok-tui-archive-from-session-store.md`
- 被收窄：`docs/adr/0047-grok-structured-json-mode.md` 第 9 条（仅 TUI 完成归档）
- 相关：`docs/adr/0025-tui-issue-archive-conclusion-only.md`、`docs/adr/0045-tui-codex-archive-and-usage-from-session-log.md`
- 归档接线：`src-tauri/src/features/agent_session/log_path.rs`、`src-tauri/src/features/agent_session/terminal_archive_clean.rs`
- 术语：`CONTEXT.md`（Issue Session 归档）
