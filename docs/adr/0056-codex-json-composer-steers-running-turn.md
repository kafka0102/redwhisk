# Codex json 输入框把运行中的消息插入当前 Turn

Session 输入框在 Codex json 会话的当前 Turn 仍运行时，把消息插入这一轮，而不是排队到本轮结束再新开一轮。Claude、OpenCode、Grok、DeepSeek 没有对等的插入能力，仍用排队追问。Issue 完成提示与注入 prompt 继续新开一轮，避免系统消息插进用户正在看的这一轮。
