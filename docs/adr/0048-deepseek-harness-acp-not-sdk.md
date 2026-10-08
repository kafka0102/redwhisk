# 0048. DeepSeek Harness 结构化接入走 ACP 而非 SDK

## 状态

采纳（待执行）。

## 背景

需要在 RedWhisk 里支持 DeepSeek Harness，并让结构化会话达到与 Codex App Server 同档的产品效果：消息流、composer、轮次起止/失败/取消、工具卡、权限卡、跨重启续接、图片。最初考虑的是 DeepSeek Harness SDK（`dsh --profile sdk` 的换行分帧 JSON-RPC）。

SDK 只有 `initialize`、`session/prompt`、`shutdown`。它不提供取消、会话关闭、权限反向请求，也不把助手消息归到某一次 prompt。官方写明协议版本 `0.0.1`、开发者预览、会破坏兼容。因此 SDK 达不到这档效果。

同仓库的 `dsh --profile acp` 才是标准 ACP：可 `session/new`、`session/prompt`、`session/cancel`、`session/list`、`session/resume`、`session/close`，并用 `session/request_permission` 做一次性允许/拒绝。`session/update` 只在事实提交后发出 `agent_thought_chunk`、`agent_message_chunk`、`tool_call`、`tool_call_update` 与 `usage_update`。这里的 chunk 是已提交块，不是生成过程中的逐字增量。`usage_update` 的 `used` / `size` 是上下文窗口占用，不是 Session Token 消耗的输入/输出/缓存。

## 决定

1. DeepSeek Harness 作为新的 agentType `deepseek` 接入。结构化传输只用 `dsh --profile acp`。不实现、不依赖 SDK 协议。
2. 展示形式只有 json，不能切到 tui。不接 `dsh web`，也不做交互式 PTY。
3. 产品效果对齐 Codex 的结构化会话，但明确两处不做：没有逐字增量；没有 mode / plan。
4. `usage_update` 不写入 Session Token 消耗。协议没有输入/输出/缓存三分量时，该三项保持空，不用上下文窗口占用冒充。
5. 权限按 ACP 一次性允许/拒绝回复。profile 为 dangerous 或 mode 为 full-access 时自动允许，否则出示权限卡。
6. 本机装有 `dsh` 且该 agentType 无任何记录时，自动播种一条默认开启、displayMode 为 json 的全局 profile。
7. 不把 DeepSeek Harness 纳入技能根。无本机模型目录，也不提供内置模型回退列表。

## 后果

- 消息在步骤提交后整段出现，不会像 Codex 那样边生成边出字。
- Session Token 消耗在只有上下文窗口占用时保持横线。
- 续接靠 `session/resume`；ACP 不回放旧更新，历史仍来自 RedWhisk 已保存的 timeline。
- 图片只把 PNG、JPEG、WebP、GIF 作为 ACP 内联图片；其余附件仍是文本路径。
- 以后若 SDK 补上取消、权限和轮次归属，也不把已落地的 ACP 会话迁过去。

## 代码事实来源

- DeepSeek Harness `packages/sdk/protocol`：SDK 方法面与「无取消、无反向请求」限制。
- DeepSeek Harness `packages/acp/acp`：ACP 方法面，以及 `updates.ts` 只从已提交会话事件生成标准更新。
- RedWhisk 现有 Grok json 路径已经用 ACP 长驻进程接入结构化会话，但是否回复权限、是否锁定 tui，按本 ADR 而不是按 Grok 的取舍。

## 替代方案

- 走 SDK：被拒绝。缺少取消、权限和轮次归属，无法达到约定的产品同档。
- 嵌入 TypeScript SDK：被拒绝。RedWhisk 的 provider 都是 Rust 拉起本机 CLI 并讲协议。
- 只做 TUI / `dsh web`：被拒绝。对不齐现有 json 消息流与 composer。
- 把 `usage_update.used` 记成 Session Token 消耗：被拒绝。那是上下文窗口占用，和既有术语冲突。
