# Agent Provider 协议

RedWhisk 当前正式支持 `codex` 和 `claude` 两种结构化 Agent provider。前端只消费统一的 session command 与 `AgentStreamEvent`；provider 私有协议必须在 Rust `agent/` 层归一化。

## 统一边界

`AgentSessionHandle` 是会话运行时抽象。Core service 负责持久化 session、启动/恢复、turn 状态和审计；provider 负责子进程协议、消息发送、取消及把私有输出映射为统一事件。

```text
Composer / session UI
  → send_agent_message / cancel_agent_turn / respond_agent_permission
  → AgentSessionHandle
  → Codex app-server 或 Claude CLI
  → AgentStreamEventEnvelope
  → message-stream reducer / timeline
```

`agent_sessions` 保存跨重启所需的业务快照；运行中的 handle、pending permission、事件序号属于内存运行时状态，不能由前端伪造或直接更新。

## Provider 差异

| 项目      | Codex                                                         | Claude                                                  |
| --------- | ------------------------------------------------------------- | ------------------------------------------------------- |
| 进程协议  | `codex app-server`，stdio 上 NDJSON JSON-RPC                  | `claude -p --output-format stream-json`，NDJSON 单向流  |
| 会话模型  | 持久 app-server session，维护 `threadId` / 当前 turn          | 单轮子进程；后续消息用 `--resume <session_id>` 续接     |
| 权限      | server→client request；前端经 `respond_agent_permission` 回复 | stream-json 没有等价 request/response 审批通道          |
| 模型/模式 | 通过 provider 请求与通知同步                                  | 由 Claude provider 能力与配置决定；第三方模型列表可只读 |
| 输出      | JSON-RPC notification 映射 timeline                           | SDKMessage 流映射 timeline                              |

因此，不能把 Codex 的 JSON-RPC、权限卡片、thread 字段或 effort 假定为所有 provider 都具备；也不能为 Claude 回退重建 xterm/TUI 渲染链路。

## 生命周期规则

1. 启动 provider 成功后再创建可用 Agent Session，并更新关联 Issue 状态。
2. `send_agent_message` 开始 turn；`is_turn_running` 仅由 Rust 后端维护。
3. 正常结束、失败和取消都通过统一 stream event 通知前端，并更新持久化 session 事实。
4. `crashed` 表示 provider 进程异常；`stopped` 表示重启后无法恢复原运行中会话；两者均不自动完成 Issue。
5. timeline 历史使用 `read_agent_timeline`；不能将截断 ANSI 日志作为结构化会话恢复方式。

## 附件与安全

- Agent 附件先由 `save_agent_attachment` 落盘，后续消息仅传路径、展示名与种类。
- Issue 附件与 Agent 附件有各自 DTO；不要直接把浏览器文件对象穿透 Rust 边界。
- provider 新能力必须明确：持久化字段、事件映射、取消语义、权限语义、恢复语义及 unsupported 情形。

## 修改检查清单

- 更新 `AgentSessionHandle`、provider 实现、`AgentStreamEvent` 映射与前端 reducer 是否同步？
- 新增或变更 event 是否具备 `sessionId`、`projectId`、`seq`、`epoch` 语义？
- provider 失败、取消、应用重启、附件与不支持操作是否有测试？
- 是否避免将 provider 私有协议泄露到 feature UI？
