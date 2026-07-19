# ADR 0015：引入 AgentProviderDescriptor，下沉 provider 特性差异

## 状态

采纳（Accepted）。依赖 [ADR-0013](./0013-feature-first-module-organization.md) 的 feature 边界与 [ADR-0011](./0011-agent-session-provider-factory.md) 的构造侧抽象。

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

1. **新增 `AgentProviderDescriptor` trait**（`agent/provider_descriptor.rs`），方法：
   - `agent_type()` —— 对应枚举值；
   - `resolve_runtime_config(data_dir, requested_model, requested_effort) -> RuntimeConfig` —— model / effort 解析（覆盖 service 3 处启动路径）；
   - `build_command_snapshot_with_bypass(raw_command)` —— PTY 进程启动补 bypass（覆盖 `spawn_agent_process`）；
   - `build_launch_command_snapshot(raw_command)` —— issue launch 路径（Codex structured trim / Claude CLI bypass）；
   - `fallback_command_when_snapshot_empty()` —— resume 路径 `command_snapshot` 为空的兜底；
   - `list_models(home_dir)` / `is_model_list_read_only(home_dir)` —— 模型列表与只读判定（覆盖 `list_agent_models`）。

   草案列的 `capabilities()` **未引入**：所有能力差异（structured 选择、effort 支持、bypass 参数）已通过上述具体方法封装，调用方无需查询能力位（YAGNI）。
2. **Codex / Claude 各自实现 Descriptor**：把散在 `features/agent_session/command_snapshot.rs` 的 `ensure_codex_bypass_arg` / `ensure_claude_bypass_permission_args` / `append_missing_args` / `command_has_arg`、`commands.rs` 的 `claude_models_from_home` 搬进 `agent/provider_descriptor.rs`。`build_structured_command_snapshot`（纯 trim，无 type 差异）留在 `command_snapshot.rs`。
3. **service / command 通过 `descriptor_for(&agent_type)` 查表替代 `match`**；service / command 内不再出现按 provider 特性分支的 `match agent_type`。`list_agent_models` 的 home_dir 读取错误 reason 文案 match 保留——属 UI 本地化（`codexConfigReadFailed` / `claudeConfigReadFailed`），非特性差异。
4. **新增第 3 种 agent 时 service / command 零改动**：只加一个 Descriptor 实现 + `descriptor_for` 注册一行。
5. **`AgentSessionHandle` trait 不动**（设计良好）；`AgentSessionStartRequest` 的 `effort` / `mode_id` 字段差异是「中立请求参数化」的合理代价，保留。
6. **resume 兜底修正**：原 service resume 路径硬编码 `ensure_codex_bypass_arg("codex")`（对 Claude session 也会产出 codex 命令，潜在 bug）；下沉后按 `descriptor.fallback_command_when_snapshot_empty()` 取各自默认 binary + bypass。
7. **演进路径**：2 种用 `match` 查表 → 3–5 种仍可 `match`（编译期穷尽性是优点）→ 6+ 种或动态注册才换 `HashMap`。当前**不引入注册表**（YAGNI）。

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

- 新增：`src-tauri/src/agent/provider_descriptor.rs`（trait + `CodexDescriptor` / `ClaudeDescriptor` + `descriptor_for` 查表 + 单测）。
- 抽象基石：`src-tauri/src/agent/{session_handle.rs,provider_factory.rs}`（[ADR-0011](./0011-agent-session-provider-factory.md)），本 ADR 不动。
- 原 match 下沉点（feature-first 后路径）：`src-tauri/src/features/agent_session/{service.rs,launch.rs,command_snapshot.rs,commands.rs}`。
- 保留的 match：`src-tauri/src/agent/provider_factory.rs`（ADR-0011 构造路由）、`src-tauri/src/db/agent_profile_repository.rs`（DB 层），均属已良好抽象，不在本 ADR 范围。
- 枚举：`src-tauri/src/types/agent_profile.rs`（`AgentType { Codex, Claude }`）。
