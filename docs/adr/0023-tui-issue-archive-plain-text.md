# 0023. TUI Issue 完成归档写轻清理纯文本

**状态**：采纳（清理深度见 ADR-0025：结论向提取）

## 背景

Issue 完成时统一走 `build_issue_session_archive`：先把 runtime log 读成 timeline，再过滤为 user/assistant/error，写成 JSONL 信封。对 **Session 展示形式快照为 tui** 的会话，runtime 实际是 PTY 原始终端 log；读路径会把整段剥壳输出压成单条 `assistant_message`，归档后再被 Agent TUI 会话视图当终端快照读出，主区直接显示整包 JSON。

## 决定

1. 完成归档按 **Session 展示形式快照**（`agent_sessions.display_mode`）分流，不回读 profile，不按文件内容嗅探。
2. **`tui`**：将 runtime 终端 log 做控制序列剥离后，以**纯文本**写入既有 archive 路径；不写 `AgentStreamEventEnvelope` JSONL。清理深度与保留集合见 **ADR-0025**（结论向提取）；`latest_output` 取归档文本最后一条非空行。
3. **`json`**：保持既有 timeline 过滤 + JSONL 归档，不变。
4. **历史**已写成 JSON 信封的 TUI 归档**不迁移、不读侧兼容**；仅新完成的 TUI 归档享受纯文本回看。
5. 回看仍走 Agent TUI 会话视图 + xterm；验收为「可读纯文本、不再是整包 JSON」，不要求还原 live 最终一屏。

## 后果

- TUI 与 json 的 archive 文件扩展名可同为 `.log`，但内容形态分叉：纯文本 vs JSONL。
- `read_agent_timeline` 对 TUI 归档无 structured 语义；TUI 回看只依赖 `read_agent_session_terminal`。
- 清理策略演进见 ADR-0025：只保留用户输入与结论，不追求完整过程 transcript。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 归档保留 raw ANSI | 体积可达数 MiB～32 MiB，本期优先控盘与可读排版 |
| 仅读侧拆 JSON 信封 | 新归档仍丢格式契约，问题根因不除 |
| 历史坏归档读侧兼容/迁移 | 用户明确只要修新归档 |
