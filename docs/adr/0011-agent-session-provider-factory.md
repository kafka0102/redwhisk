# ADR 0011：Agent Session 构造侧 Provider Factory 与共享启动后半段

## 状态

已采纳。落实 [ADR-0001](./0001-core-architecture-boundaries.md) 对结构化 provider 的边界：provider 私有协议不得越层；消费侧已有 `AgentSessionHandle`，本 ADR 补齐**构造侧** seam。

## 背景

结构化 Agent Session 的消费路径已统一为 `Arc<dyn AgentSessionHandle>`（Codex / Claude 两 adapter 已坐实）。但构造路径仍在 `AgentSessionService` 内硬 `match AgentType` 并直接 `CodexSessionHandle::start` / `ClaudeSessionHandle::start`：

- issue × Codex、issue × Claude、standalone（内嵌 Codex/Claude）、resume 四条近并行路径；
- 启动失败后的 `mark_starting` / `unmark` / rollback / worktree 清理重复且难单测；
- `CodexMode` 与具体 Config 类型泄漏进 service；
- `set_agent_model` / `set_agent_thinking` 在 command 层直接读写 provider 配置盘。

这使「启动时序与失败回滚」无法在 interface 层测试，也与 ADR-0001「私有协议不越层」不一致。

## 决定

1. **Provider 构造 seam**：引入 `AgentSessionProviderFactory` trait，入参为协议中立的启动请求（`agent_type`、binary/cwd、字符串 `mode_id`、model/effort、可选 resume thread id、broadcaster、home/config 路径等），出参为 `StartedSession`（`handle` + 可选 `thread_id` + 是否/如何回填 DB 的声明）。生产用默认 factory；service **不再** import 具体 Handle/Config/Mode 类型。
2. **共享启动后半段**：DB 事务提交之后的阶段统一为共享管线——`mark_starting` → `factory.start` → 按 `StartedSession` 回填 thread id → `register` / broadcast → 可选 initial `send_message` → 失败路径统一 unmark / shutdown / 调用方提供的 rollback。issue 与 standalone 的**前半段**校验与事务写入仍各自保留（领域规则不同，不强行合成一个 `start_session(intent)`）。
3. **resume 同源**：`resume_structured_agent_session` 的进程构造同样走 factory（resume 用请求字段表达），不另开 resume factory，也不再硬 match 具体类型。
4. **配置写盘归属 handle**：`set_model` / `set_effort` 的运行时切换与 provider 配置持久化收进各 adapter 实现；command 只取 registry handle 调用，不再 `match agent_type` 写盘。Claude 对 effort 等仍按既有能力返回不支持。
5. **可测注入**：service 方法接收 `&dyn AgentSessionProviderFactory`（或等价可替换默认实现），单测注入 fake（start 失败 / 无 thread_id / send_message 失败）覆盖启动回滚时序，不启真实 provider 进程。
6. **明确不做**：本决策不收敛 PTY 启动路径；不重命名 `codex_session_id` 列；不改变 issue/standalone 对外 command 契约与既有用户可见行为（除错误路径可测性与内部分层）。

## 后果

- 新增 provider 时只加 factory 分支 + adapter，不必再复制整条启动编排。
- service 与 command 对 Codex/Claude 私有类型依赖下降；`CodexMode` 解析留在 Codex adapter/factory 内。
- 启动失败 rollback 与 mark_starting 窗口可用 fake factory 单测。
- issue/standalone 前半段仍可能有部分事务骨架相似，属领域差异，允许保留；后续若再抽「会话落库」是独立决策。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 只包一层 match 的自由函数 factory，service 仍组装具体 Config | CodexMode/Config 仍泄漏；编排仍难测 |
| 一个 `start_session(intent)` 吞掉 issue+standalone 全部差异 | 前半段领域规则不同，易成巨型分支，与「外科手术」冲突 |
| 本轮只收新建、resume 后置 | 构造侧泄漏会在 resume 立刻复现 |
| 配置写盘下沉到并列 ProviderConfig port | 当前仅 model/effort 且绑定活跃 session，多一层 seam 收益低 |
| 同步重命名 `codex_session_id` / 收敛 PTY | 与 seam 正交，放大 migration 与行为面 |

## 代码事实来源

- 本决策：`docs/adr/0011-agent-session-provider-factory.md`
- 相关 ADR：[ADR-0001](./0001-core-architecture-boundaries.md)
- 消费侧 trait：`src-tauri/src/agent/session_handle.rs`
- 启动/ resume 复制路径：`src-tauri/src/core/agent_session_service.rs`（`start_structured_*`、`resume_structured_agent_session`）
- 配置写盘泄漏：`src-tauri/src/commands/agent_session_commands.rs`（`set_agent_model` / `set_agent_thinking`）
- adapter：`src-tauri/src/agent/codex_app_server/session.rs`、`src-tauri/src/agent/claude_streaming/session.rs`

> 注：上述 `core/`、`commands/` 路径已由 [ADR-0013](./0013-feature-first-module-organization.md) 迁移至 `features/`（`features/agent_session/service.rs`、`features/agent_session/commands.rs`）；按 ADR 规则不回写历史路径。
