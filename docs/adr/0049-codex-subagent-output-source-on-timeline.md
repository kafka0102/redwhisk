# 0049. Codex 子智能体的输出来源写入消息流

## 状态

采纳（已执行）。

## 背景

Codex app-server 的结构化会话里，子智能体使用另一条 thread。现在已能认出这条 thread：它的 turn 结束不会停掉主 Turn，它的 token 用量也不会覆盖父会话。但它的正文和工具调用仍写进同一条消息流，而且 timeline 上没有来源。关掉再打开后，历史只剩这条混合消息流。

用户要在 composer 的模型 / effort 右边用一个 select 切换「全部 / 主智能体 / 每个子智能体」。没有子智能体时不出现这个 select。

## 决定

1. 只覆盖 Codex app-server 的 json 会话。tui，以及其他 provider，不在本次范围。
2. 每条结构化输出记下输出来源：主智能体，或某一个子智能体。来源随该 Session 已保存的 timeline 日志一起落盘。
3. 重新打开会话时，按已保存的来源重建 select，并能筛历史输出。
4. 当前选中的那一档不落盘。重新打开固定回到「全部」。
5. 没有来源字段的旧日志保持混合，不出现 select。不回填。
6. 子智能体仍不是可单独停止的 Turn，也不是另一条 Agent Session。
7. select 只改变消息流展示。输入仍发给主智能体，停止仍停主 Turn。
8. 权限卡不随 select 隐藏，仍在输入框上方。筛选只作用于消息流里的输出。
9. 选中某个子智能体时，消息流只含它自己的正文、思考和工具调用。用户消息和主智能体的输出只出现在「全部」和「主智能体」。
10. select 里子智能体的名字用拉起时的任务描述。没有描述时叫「子智能体 N」。同名再出现，后一个加序号。选项上带「运行中」或「已结束」。

## 后果

- 筛选是读已保存消息流，不依赖本次进程还记不记得子线程。
- 旧会话不会突然多出一个 select。
- 切换查看档不影响已经写好的输出，也不改变停止按钮所作用的 Turn。
- 选中某个子智能体不会把后续消息发给它。
- 正在看某一路时，子智能体的权限请求仍然能批准。
- 子智能体再拉起的子智能体也是这个 select 里的平级一项，不嵌套。
- 完成归档若保存 timeline，保留来源字段，只读历史仍能筛。

## 代码事实来源

- `src-tauri/src/agent/codex_app_server/session.rs`：`is_session_user_thread` 已区分父 thread 与子 thread；子 thread 的 item 仍进入 timeline，且不带来源。
- `src-tauri/src/features/agent_session/timeline.rs`：重开会话时从 timeline 日志回放 `AgentStreamEvent::Timeline`。
- `src/features/agents/composer/composer-controls.tsx`：模型与 effort 已经是控制行左侧的 select，来源 select 排在 effort 右边。

## 替代方案

- 只在内存里记来源。当前这次运行能筛，关掉就丢。否决，因为用户确认重新打开后仍要能筛历史。
- 把选中档也写入 Session。否决，因为那是查看偏好，重新打开应回到混合的「全部」。
