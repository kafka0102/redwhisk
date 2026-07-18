# ADR 0015：引入 AgentProviderDescriptor，下沉 provider 特性差异

## 状态

草案（Draft）。依赖 [ADR-0013](./0013-feature-first-module-organization.md) 的 feature 边界；service 内 `match agent_type` 下沉在 P1 落地后推进。

## 背景

后端重构方案 P3。[ADR-0011](./0011-agent-session-provider-factory.md) 已建立良好的 provider 抽象，**本草案不推翻它**：

- 消费侧 `AgentSessionHandle` trait（13 方法，协议中立，`src-tauri/src/agent/session_handle.rs`）。
- 构造侧 `AgentSessionProviderFactory` + 中立 `AgentSessionStartRequest` + `ProviderStartPlan`（`src-tauri/src/agent/provider_factory.rs`）。

但 service 层仍直接 `match agent_type` 处理 **provider 特性差异**，`agent_session_service` 有 8+ 处：

| 行号 | 差异点 | 当前分支 |
| --- | --- | --- |
| 790 / 2074 | model 读取 | Codex 从 data_dir 读 / Claude 返 `None` |
| 794 / 2078 | effort 读取 | 同上 |
| 954 | command_snapshot | Codex 走 structured 版本 / Claude 走普通版本 |
| 1869 / 1876 | 启动入参 | Codex 用 input.model / Claude 用 input.model.clone + None |
| 3159 | bypass 参数 | `ensure_codex_bypass_arg` / `ensure_claude_bypass_permission_args` |

这些是 **provider 能力差异**，本应由 provider 自己回答，现在漏给 service。每新增一种 agent，service 要改 8 处——违反开闭原则。

## 决定

1. **新增轻量 `AgentProviderDescriptor` trait**（`agent/` 层）：`agent_type()` / `capabilities()` / `resolve_runtime_config()` / `build_command_snapshot()`。
2. **Codex / Claude 各自实现 Descriptor**，把现在散在 service 的 `read_codex_model_from_data_dir`、`ensure_claude_bypass_permission_args`、`build_structured_command_snapshot` 等搬进去。
3. **service 通过 `descriptor_for(agent_type)` 查表替代 `match`**，service 内不再出现 `match agent_type`。
4. **新增第 3 种 agent 时 service 零改动**：只加一个 `Descriptor` 实现 + 注册一行。
5. **`AgentSessionHandle` trait 不动**（设计良好）；`AgentSessionStartRequest` 的 `effort` / `mode_id` 字段差异是「中立请求参数化」的合理代价，保留。
6. **演进路径**：2 种用 `match` 查表 → 3–5 种仍可 `match`（编译期穷尽性是优点）→ 6+ 种或动态注册才换 `HashMap`。当前**不引入注册表**（YAGNI）。

## 后果

- service 的 `agent_type` 分支归零；新增 agent 的改动面从「改 service 8 处」降到「加 1 个 `Descriptor` + 注册一行」。
- provider 特性差异就近放在 provider 实现，符合 deep module（与 [ADR-0010](./0010-worktree-lifecycle-deep-module.md) / [ADR-0012](./0012-completion-effect-interpreter-deep-module.md) 同向）。
- 代价：新增 trait + 2 个实现，迁移 8 处 `match`；行为不变，靠现有 factory 单测（`provider_factory.rs` 内 13 个）与 e2e 守底。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 现在就上 `HashMap<AgentType, Box<dyn Descriptor>>` 注册表 | 2 种 provider 时过度设计；`match` 编译期穷尽性更安全；待第 3 种落地再换 |
| 把特性差异塞进 `AgentSessionHandle` | trait 膨胀；Handle 是运行时会话契约，启动期能力描述不该混入 |
| 扩展 `AgentSessionStartRequest` 用 `extra: HashMap` 承载差异字段 | 失去类型安全；当前中立字段已够，差异应下沉而非参数化 |
| 不抽象，新增 agent 时复制粘贴 service 分支 | 违反 OCP；分支数随 agent 数线性增长 |

## 事实来源

- 抽象：`src-tauri/src/agent/{session_handle.rs,provider_factory.rs}`（[ADR-0011](./0011-agent-session-provider-factory.md)）。
- 散落：`src-tauri/src/core/agent_session_service.rs:790,794,954,1869,1876,2074,2078,3159`。
- 枚举：`src-tauri/src/types/agent_profile.rs:5`（`AgentType { Codex, Claude }`）。
