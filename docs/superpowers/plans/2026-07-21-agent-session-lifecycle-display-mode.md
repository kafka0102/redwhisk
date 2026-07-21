# Agent Session 生命周期按 displayMode 加深 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Agent Session 的 inject / timeline 观察 / 启动分流 / UI 能力声明收成以 **Session 展示形式快照**（`displayMode`）为唯一真相的 lifecycle 深 module，收窄 service 上的 json/tui 双轨散落分支，删除前端静态能力双表。

**Architecture:** 在 `features/agent_session/lifecycle/` 新增深 module（对齐 `features/issue/completion/use_case.rs` 与 ADR-0010 的「意图级 API」模式）。纯函数负责 `displayMode → RuntimeTransport`；inject/timeline 只认 session 快照，不再用 runtime membership 猜传输层。`AgentProviderDescriptor` 投影 UI 能力，经 `list_agent_models` 返回；前端删掉 `agent-capabilities.ts` 常量表。本轮 **不重开** ADR-0022 / 0011 / 0015 的传输与 factory 策略；**不搬迁** start 主体实现（PTY spawn / structured factory 仍在 service），只统一分流入口。

**Tech Stack:** Rust 2021（Tauri 2 / rusqlite）、Vitest、既有 `descriptor_for` / `AgentSessionRegistry` / `PtySessionManager`。

## Global Constraints

- 默认简体中文说明；代码标识符、路径、命令保持英文。
- 行为冻结：json/tui 产品语义以 ADR-0022 / 0023 / `docs/architecture-design/agent-provider-protocol.md` 为准；会话存续期只认 **Session 展示形式快照**，不回读 profile。
- 新建 `.rs` 文件 ≤ 500 行、禁止进 `scripts/rust-file-size-allowlist.txt`；改动 Rust 后跑 `bash scripts/check-rust-file-size.sh`。
- 改动 TS 后：`pnpm format` → `pnpm lint` → `pnpm typecheck` → 相关 `pnpm test` → `bash scripts/check-frontend-file-size.sh`；每步后 `git status --short`。
- 跨边界 DTO：`#[serde(rename_all = "camelCase")]` 与前端类型手动同步。
- 提交标题：`<type>: <简体中文描述>`；不 push / merge / rebase。
- 外科手术：不顺手拆 `service.rs` 全文件、不碰完成流程 / broadcaster SQL 候选。
- 本 plan **不做**：把 start 全量搬进 adapter、热切换 displayMode、opencode/grok 真启动、历史 TUI 坏归档迁移。

## File Structure

| 路径 | 职责 |
| --- | --- |
| `src-tauri/src/features/agent_session/lifecycle/mod.rs` | module 聚合与对外 `pub(crate)` 出口 |
| `src-tauri/src/features/agent_session/lifecycle/display_mode.rs` | `SessionDisplayMode` 解析、`RuntimeTransport` 映射、非法值错误 |
| `src-tauri/src/features/agent_session/lifecycle/inject.rs` | 按 displayMode 选择 PTY write 或 structured `send_message` |
| `src-tauri/src/features/agent_session/lifecycle/observe.rs` | 按 displayMode 读 timeline（json=structured；tui=空 structured / 不猜格式） |
| `src-tauri/src/features/agent_session/mod.rs` | `mod lifecycle;` |
| `src-tauri/src/features/agent_session/service.rs` | inject / read_timeline / start 分流改为调 lifecycle；删 membership-first inject |
| `src-tauri/src/features/agent_session/timeline.rs` | 可选：接受 `display_mode` 参数或由 observe 封装调用 |
| `src-tauri/src/agent/provider_descriptor.rs` | 新增 `ui_capabilities()` |
| `src-tauri/src/types/agent_session.rs` | `AgentUiCapabilities` + `ListAgentModelsResult.capabilities` |
| `src/features/agents/agent-stream-types.ts` | 同步 capabilities 类型 |
| `src/features/agents/composer/use-agent-models.ts` | 返回 capabilities |
| `src/features/agents/composer/agent-composer.tsx` / `agent-session-view.tsx` | 从 hook 取能力，删静态表依赖 |
| `src/features/agents/agent-capabilities.ts` | **删除**（或缩成类型 re-export，最终不得保留静态双表） |
| `docs/architecture-design/agent-provider-protocol.md` | 记录 lifecycle seam 与能力投影 |

---

### Task 1: SessionDisplayMode 与 RuntimeTransport 纯 module

**Files:**
- Create: `src-tauri/src/features/agent_session/lifecycle/mod.rs`
- Create: `src-tauri/src/features/agent_session/lifecycle/display_mode.rs`
- Modify: `src-tauri/src/features/agent_session/mod.rs`（增加 `mod lifecycle;`）
- Test: 同文件 `#[cfg(test)]` 模块

**Interfaces:**
- Produces:
  - `SessionDisplayMode { Json, Tui }`
  - `RuntimeTransport { StructuredJson, InteractiveTui }`
  - `fn parse_session_display_mode(raw: &str) -> Result<SessionDisplayMode, CommandError>`
  - `fn runtime_transport(mode: SessionDisplayMode) -> RuntimeTransport`
  - `fn runtime_transport_from_raw(raw: &str) -> Result<RuntimeTransport, CommandError>`

- [ ] **Step 1: 注册 module**

在 `src-tauri/src/features/agent_session/mod.rs` 的其它 `mod` 旁增加：

```rust
mod lifecycle;
```

- [ ] **Step 2: 写失败测试（尚无实现时编译失败即可，随后补实现）**

创建 `lifecycle/display_mode.rs`，先放测试再放实现（TDD）：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_json_and_tui() {
        assert_eq!(
            parse_session_display_mode("json").unwrap(),
            SessionDisplayMode::Json
        );
        assert_eq!(
            parse_session_display_mode("tui").unwrap(),
            SessionDisplayMode::Tui
        );
        assert_eq!(
            parse_session_display_mode(" JSON ").unwrap(),
            SessionDisplayMode::Json
        );
    }

    #[test]
    fn reject_unknown_display_mode() {
        let err = parse_session_display_mode("pty").unwrap_err();
        assert_eq!(err.reason.as_deref(), Some("invalidDisplayMode"));
    }

    #[test]
    fn transport_mapping() {
        assert_eq!(
            runtime_transport(SessionDisplayMode::Json),
            RuntimeTransport::StructuredJson
        );
        assert_eq!(
            runtime_transport(SessionDisplayMode::Tui),
            RuntimeTransport::InteractiveTui
        );
    }
}
```

- [ ] **Step 3: 实现纯类型与解析**

```rust
//! Session 展示形式快照 → 运行时传输选择（ADR-0022）。
//! 不回读 profile；调用方传入 session / launch 已持久化的 display_mode 字符串。

use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SessionDisplayMode {
    Json,
    Tui,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RuntimeTransport {
    StructuredJson,
    InteractiveTui,
}

pub(crate) fn parse_session_display_mode(raw: &str) -> Result<SessionDisplayMode, CommandError> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "json" => Ok(SessionDisplayMode::Json),
        "tui" => Ok(SessionDisplayMode::Tui),
        other => Err(CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "不支持的 Session 展示形式快照。",
        )
        .with_reason("invalidDisplayMode")
        .with_detail(ErrorDetail::new("Field").with_value("name", "displayMode"))
        .with_detail(ErrorDetail::new("Value").with_value("displayMode", other.to_string()))),
    }
}

pub(crate) fn runtime_transport(mode: SessionDisplayMode) -> RuntimeTransport {
    match mode {
        SessionDisplayMode::Json => RuntimeTransport::StructuredJson,
        SessionDisplayMode::Tui => RuntimeTransport::InteractiveTui,
    }
}

pub(crate) fn runtime_transport_from_raw(raw: &str) -> Result<RuntimeTransport, CommandError> {
    Ok(runtime_transport(parse_session_display_mode(raw)?))
}
```

`lifecycle/mod.rs`：

```rust
//! Agent Session 生命周期深 module：以 Session 展示形式快照选传输 adapter。
//! service 负责 DB 事务与业务规则；runtime 分流细节在此收口（架构候选 #3）。

mod display_mode;
mod inject;
mod observe;

pub(crate) use display_mode::{
    parse_session_display_mode, runtime_transport, runtime_transport_from_raw, RuntimeTransport,
    SessionDisplayMode,
};
pub(crate) use inject::{inject_prompt, InjectRuntimePorts};
pub(crate) use observe::read_timeline_for_session;
```

> 注：Step 3 写 `mod inject` / `mod observe` 时若尚未建文件，可先只 `mod display_mode;` 与 re-export，Task 2/3 再补；避免半截编译失败。

- [ ] **Step 4: 跑单测**

Run:

```bash
cd src-tauri && cargo test --lib features::agent_session::lifecycle::display_mode -- --nocapture
```

Expected: PASS（3 tests）。

- [ ] **Step 5: 行数门禁 + commit**

```bash
bash scripts/check-rust-file-size.sh --files src-tauri/src/features/agent_session/lifecycle/display_mode.rs src-tauri/src/features/agent_session/lifecycle/mod.rs
git add src-tauri/src/features/agent_session/lifecycle src-tauri/src/features/agent_session/mod.rs
git commit -m "$(cat <<'EOF'
refactor: 抽出 Session displayMode 传输映射 module

Refs: architecture-review-displayMode-lifecycle
EOF
)"
```

---

### Task 2: inject 按 displayMode 快照选 adapter

**Files:**
- Create: `src-tauri/src/features/agent_session/lifecycle/inject.rs`
- Modify: `src-tauri/src/features/agent_session/lifecycle/mod.rs`
- Modify: `src-tauri/src/features/agent_session/service.rs`（`inject_session_prompt` 主体）
- Test: `lifecycle/inject.rs` 内 mock ports 单测

**Interfaces:**
- Consumes: `SessionDisplayMode` / `runtime_transport`（Task 1）
- Produces:
  - `InjectRuntimePorts<'a>`（`pty: &PtySessionManager`, `registry: &AgentSessionRegistry`）
  - `fn inject_prompt(display_mode: &str, session_id: i64, prompt: &str, ports: InjectRuntimePorts<'_>) -> Result<(), CommandError>`
  - 语义：**tui → 仅 PTY**；**json → 仅 registry handle**；membership 只作「是否在跑」检查，不作传输选择。

- [ ] **Step 1: 写失败/行为单测（用假 registry 有困难时，测纯分支错误码）**

在 `inject.rs`：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::pty_session_manager::PtySessionManager;
    use crate::agent::session_registry::AgentSessionRegistry;

    #[test]
    fn tui_without_pty_is_not_running() {
        let pty = PtySessionManager::new_for_test(); // 若无此构造器，用 Default::default() 或项目既有 test helper
        let registry = AgentSessionRegistry::default();
        let err = inject_prompt(
            "tui",
            42,
            "hello\n",
            InjectRuntimePorts {
                pty: &pty,
                registry: &registry,
            },
        )
        .unwrap_err();
        assert_eq!(err.reason.as_deref(), Some("notRunningForInject"));
    }

    #[test]
    fn json_without_handle_is_not_running() {
        let pty = PtySessionManager::new_for_test();
        let registry = AgentSessionRegistry::default();
        let err = inject_prompt(
            "json",
            42,
            "hello",
            InjectRuntimePorts {
                pty: &pty,
                registry: &registry,
            },
        )
        .unwrap_err();
        assert_eq!(err.reason.as_deref(), Some("notRunningForInject"));
    }
}
```

> 实现时对齐仓库里 `PtySessionManager` / `AgentSessionRegistry` 的真实 test 构造方式（搜 `PtySessionManager::` 与现有 service 测试）；**禁止**为测试改生产语义。若 `new_for_test` 不存在，用现有 `#[cfg(test)]` helper 或最小 `Default`。

- [ ] **Step 2: 实现 inject**

```rust
//! 按 Session 展示形式快照注入 prompt（不按 runtime membership 猜通道）。

use crate::agent::pty_session_manager::PtySessionManager;
use crate::agent::session_registry::AgentSessionRegistry;
use crate::features::agent_session::lifecycle::display_mode::{
    runtime_transport_from_raw, RuntimeTransport,
};
use crate::features::agent_session::service::agent_session_error_to_command_error;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

pub(crate) struct InjectRuntimePorts<'a> {
    pub pty: &'a PtySessionManager,
    pub registry: &'a AgentSessionRegistry,
}

pub(crate) fn inject_prompt(
    display_mode: &str,
    session_id: i64,
    prompt: &str,
    ports: InjectRuntimePorts<'_>,
) -> Result<(), CommandError> {
    match runtime_transport_from_raw(display_mode)? {
        RuntimeTransport::InteractiveTui => {
            if !ports.pty.contains(session_id) {
                return Err(not_running(session_id));
            }
            ports
                .pty
                .write_input(session_id, prompt)
                .map_err(|message| inactive_terminal_error(message))?;
            Ok(())
        }
        RuntimeTransport::StructuredJson => {
            let Some(handle) = ports.registry.get(session_id) else {
                return Err(not_running(session_id));
            };
            handle
                .send_message(prompt.to_string(), Vec::new())
                .map_err(agent_session_error_to_command_error)?;
            Ok(())
        }
    }
}

fn not_running(session_id: i64) -> CommandError {
    CommandError::new(
        CommandErrorCode::AgentSessionNotRunning,
        "当前 Session 未运行，请先恢复会话后再注入。",
    )
    .with_reason("notRunningForInject")
    .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session_id))
}

fn inactive_terminal_error(message: String) -> CommandError {
    // 与 service 现有 inactive_terminal_error 文案/reason 对齐：实现时直接
    // 复用 `super::super::service::...` 的 pub(crate) helper，或复制同构映射，
    // 禁止静默改变错误码。
    CommandError::new(
        CommandErrorCode::AgentSessionNotRunning,
        "当前 Session 终端不可用。",
    )
    .with_reason("inactiveTerminal")
    .with_detail(ErrorDetail::new("Cause").with_value("message", message))
}
```

实现细节：**优先复用** `service.rs` 已有的 `inactive_terminal_error` / `agent_session_error_to_command_error`（若 private，改为 `pub(crate)` 或下沉到 `lifecycle` 旁的小 helper，不要复制分叉 reason 字符串）。

- [ ] **Step 3: 改 `AgentSessionService::inject_session_prompt`**

将 membership-first 块：

```rust
if pty_sessions.contains(input.session_id) {
    ...
} else if let Some(handle) = agent_registry.get(session.id) {
    ...
} else {
    return Err(...);
}
```

替换为：

```rust
crate::features::agent_session::lifecycle::inject_prompt(
    &session.display_mode,
    session.id,
    &submitted_prompt, // tui 路径用 normalize 后的；json 用 validate 后的 prompt
    crate::features::agent_session::lifecycle::InjectRuntimePorts {
        pty: pty_sessions,
        registry: agent_registry,
    },
)?;
```

注意：
- **json** 路径原先 `send_message(prompt.clone(), …)` 用的是 validate 后、**未**强制 `normalize_submitted_prompt` 的文本；**tui** 用 `normalize_submitted_prompt`。inject module 应接收两个可选策略，或由 service 按 mode 选好 `prompt_for_runtime` 再传入：

```rust
let runtime_prompt = match runtime_transport_from_raw(&session.display_mode)? {
    RuntimeTransport::InteractiveTui => submitted_prompt,
    RuntimeTransport::StructuredJson => prompt.clone(),
};
inject_prompt(&session.display_mode, session.id, &runtime_prompt, ports)?;
```

DB 事件写入、`clear_attention_after_successful_input` **留在 service**。

- [ ] **Step 4: 跑测**

```bash
cd src-tauri && cargo test --lib features::agent_session::lifecycle::inject -- --nocapture
cd src-tauri && cargo test --lib features::agent_session:: -- --nocapture
```

Expected: lifecycle inject 与既有 agent_session 测试 PASS。若有依赖「错误通道优先」的旧断言，按 displayMode 语义更新断言（json session 不得因误注册 pty 而写入 PTY）。

- [ ] **Step 5: 行数门禁 + commit**

```bash
bash scripts/check-rust-file-size.sh --files \
  src-tauri/src/features/agent_session/lifecycle/inject.rs \
  src-tauri/src/features/agent_session/lifecycle/mod.rs \
  src-tauri/src/features/agent_session/service.rs
git add src-tauri/src/features/agent_session/lifecycle src-tauri/src/features/agent_session/service.rs
git commit -m "$(cat <<'EOF'
refactor: inject 按 Session displayMode 快照选运行时通道

Refs: architecture-review-displayMode-lifecycle
EOF
)"
```

---

### Task 3: timeline 观察按 displayMode，停止猜格式

**Files:**
- Create: `src-tauri/src/features/agent_session/lifecycle/observe.rs`
- Modify: `src-tauri/src/features/agent_session/lifecycle/mod.rs`
- Modify: `src-tauri/src/features/agent_session/service.rs`（`read_agent_timeline`）
- Modify: `src-tauri/src/features/agent_session/timeline.rs`（若需 `read_structured_only` 导出）
- Test: `observe.rs` 单测 + 更新/补充 `service` 内 timeline 测试

**Interfaces:**
- Consumes: `SessionDisplayMode`、既有 `read_timeline_from_log_path` / structured readers
- Produces:
  - `fn read_timeline_for_session(session: &AgentSessionRecord, handle: Option<Arc<dyn AgentSessionHandle>>) -> Result<ReadAgentTimelineResult, CommandError>`
  - **json**：保持现逻辑——优先 persisted structured log，空则 handle.read_timeline()
  - **tui**：不把终端 log 嗅探成 structured timeline；返回空 items（TUI 回看走 `read_agent_session_terminal`，ADR-0023）；**不得**再走 `read_terminal_timeline_log` 猜格式

- [ ] **Step 1: 写单测**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    // 构造最小 AgentSessionRecord：display_mode=tui，log_path 指向含乱文本的临时文件
    // 断言 items 为空且不 panic。

    #[test]
    fn tui_snapshot_does_not_parse_terminal_log_as_timeline() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("tui.log");
        std::fs::write(&log, b"\x1b[32mhello\x1b[0m\nnot-json\n").unwrap();
        let session = sample_session("tui", log.to_string_lossy().as_ref());
        let result = read_timeline_for_session(&session, None).unwrap();
        assert!(result.items.is_empty());
        assert!(result.effort.is_none());
    }

    #[test]
    fn json_snapshot_reads_structured_log() {
        // 写一行合法 AgentStreamEventEnvelope JSONL（复制 timeline 现有测试 fixture 风格）
        // 断言 items 非空
    }
}
```

若 crate 无 `tempfile` 依赖，用 `std::env::temp_dir()` + 随机文件名，并在测试结束 `let _ = fs::remove_file`。

- [ ] **Step 2: 实现 observe**

```rust
use std::sync::Arc;

use crate::agent::session_handle::AgentSessionHandle;
use crate::features::agent_session::lifecycle::display_mode::{
    runtime_transport_from_raw, RuntimeTransport,
};
use crate::features::agent_session::service::agent_session_error_to_command_error;
use crate::features::agent_session::timeline::{
    latest_effort_from_session_log, read_timeline_from_log_path, StructuredTimelineHistory,
};
use crate::types::agent_session::{AgentSessionRecord, ReadAgentTimelineResult};
use crate::types::errors::CommandError;
use crate::agent::session_handle::AgentSessionError;

pub(crate) fn read_timeline_for_session(
    session: &AgentSessionRecord,
    handle: Option<Arc<dyn AgentSessionHandle>>,
) -> Result<ReadAgentTimelineResult, CommandError> {
    match runtime_transport_from_raw(&session.display_mode)? {
        RuntimeTransport::InteractiveTui => Ok(ReadAgentTimelineResult {
            items: Vec::new(),
            effort: None,
        }),
        RuntimeTransport::StructuredJson => read_json_timeline(session, handle),
    }
}

fn read_json_timeline(
    session: &AgentSessionRecord,
    handle: Option<Arc<dyn AgentSessionHandle>>,
) -> Result<ReadAgentTimelineResult, CommandError> {
    // 从 service::read_agent_timeline 原样搬迁 json 分支逻辑：
    // 1) read_timeline_from_log_path
    // 2) 非空或有 effort → 返回
    // 3) else handle.read_timeline()，保留 NotRunning / empty standalone 特例
    // 实现时复制现有代码，禁止改错误语义。
    let history = read_timeline_from_log_path(&session.log_path)?;
    if !history.items.is_empty() || history.effort.is_some() {
        return Ok(ReadAgentTimelineResult {
            items: history.items,
            effort: history.effort,
        });
    }
    if let Some(handle) = handle {
        match handle.read_timeline() {
            Ok(items) => {
                return Ok(ReadAgentTimelineResult {
                    items,
                    effort: latest_effort_from_session_log(session),
                });
            }
            Err(AgentSessionError::NotRunning(_)) => {}
            Err(AgentSessionError::Protocol(message))
                if session.issue_id.is_none()
                    && super::super::service::is_empty_standalone_thread_timeline_error(&message) =>
            {
                return Ok(ReadAgentTimelineResult {
                    items: Vec::new(),
                    effort: latest_effort_from_session_log(session),
                });
            }
            Err(error) => return Err(agent_session_error_to_command_error(error)),
        }
    }
    Ok(ReadAgentTimelineResult {
        items: history.items,
        effort: history.effort,
    })
}
```

若 `is_empty_standalone_thread_timeline_error` / `latest_effort_from_session_log` 可见性不够，改为 `pub(crate)` 或把 helper 移入 `timeline.rs`。

- [ ] **Step 3: service 薄封装**

`read_agent_timeline` 变为：

```rust
pub fn read_agent_timeline(
    &self,
    project_id: i64,
    session_id: i64,
    handle: Option<Arc<dyn AgentSessionHandle>>,
) -> Result<ReadAgentTimelineResult, CommandError> {
    let session = self.find_project_session(project_id, session_id)?;
    crate::features::agent_session::lifecycle::read_timeline_for_session(&session, handle)
}
```

- [ ] **Step 4: 跑测**

```bash
cd src-tauri && cargo test --lib features::agent_session::lifecycle::observe -- --nocapture
cd src-tauri && cargo test --lib read_agent_timeline -- --nocapture
```

Expected: PASS。更新任何「tui log 被读成单条 assistant_message」的旧期望为「空 timeline」。

- [ ] **Step 5: commit**

```bash
bash scripts/check-rust-file-size.sh --files \
  src-tauri/src/features/agent_session/lifecycle/observe.rs \
  src-tauri/src/features/agent_session/service.rs \
  src-tauri/src/features/agent_session/timeline.rs
git add src-tauri/src/features/agent_session
git commit -m "$(cat <<'EOF'
refactor: timeline 观察按 displayMode 快照分流

Refs: architecture-review-displayMode-lifecycle
EOF
)"
```

---

### Task 4: start 分流统一走 runtime_transport（不搬 start 主体）

**Files:**
- Modify: `src-tauri/src/features/agent_session/service.rs`（`start_agent_session_with_runtime`、`start_structured_agent_session` 等 `display_mode == "tui"` 字符串比较）
- Test: 既有 `tui_start_tests/*` 必须全绿

**Interfaces:**
- Consumes: `runtime_transport_from_raw` / `RuntimeTransport`
- Produces: service 内所有启动分流使用同一 helper；行为与现网一致

- [ ] **Step 1: 替换字符串比较**

将：

```rust
if launch.profile.display_mode == "tui" { ... }
if profile.display_mode == "tui" { ... }
```

改为：

```rust
use crate::features::agent_session::lifecycle::{runtime_transport_from_raw, RuntimeTransport};

match runtime_transport_from_raw(&launch.profile.display_mode)? {
    RuntimeTransport::InteractiveTui => { /* 原 tui 分支 */ }
    RuntimeTransport::StructuredJson => { /* 原 json 分支 */ }
}
```

非法 display_mode 从「默默当 json」变为 **显式校验失败**（与 Task 1 一致）。确认 DB/表单只写 `json|tui`；种子数据与 migration 默认 `json`。

- [ ] **Step 2: 跑 tui / structured 启动测试**

```bash
cd src-tauri && cargo test --lib features::agent_session::tui_start_tests -- --nocapture
cd src-tauri && cargo test --lib features::agent_session:: -- --nocapture
```

Expected: PASS。

- [ ] **Step 3: commit**

```bash
git add src-tauri/src/features/agent_session/service.rs
git commit -m "$(cat <<'EOF'
refactor: 启动分流统一经 displayMode runtime_transport

Refs: architecture-review-displayMode-lifecycle
EOF
)"
```

---

### Task 5: UI 能力从 descriptor 投影，删除前端静态双表

**Files:**
- Modify: `src-tauri/src/agent/provider_descriptor.rs`
- Modify: `src-tauri/src/agent/provider_descriptor_tests.rs`（或同文件 tests）
- Modify: `src-tauri/src/types/agent_session.rs`（`AgentUiCapabilities`、`ListAgentModelsResult`）
- Modify: `src-tauri/src/features/agent_session/commands.rs`（`list_agent_models`）
- Modify: `src/features/agents/agent-stream-types.ts`
- Modify: `src/features/agents/composer/use-agent-models.ts`
- Modify: `src/features/agents/composer/agent-composer.tsx` / `composer-types.ts` / `agent-session-view.tsx`
- Modify: 相关测试（`agent-composer.test.tsx` 等）
- Delete or gut: `src/features/agents/agent-capabilities.ts`

**Interfaces:**
- Produces:
  - Rust:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUiCapabilities {
    pub model_type_label: String,
    pub can_show_model: bool,
    pub supports_model_switching: bool,
    pub supports_reasoning_effort: bool,
    pub supports_modes: bool,
}
```

  - `AgentProviderDescriptor::ui_capabilities(&self) -> AgentUiCapabilities`
  - `ListAgentModelsResult { models, is_read_only, capabilities: AgentUiCapabilities }`
  - TS `ListAgentModelsResult.capabilities` 必填
  - `useAgentModels` 返回 `capabilities`
  - Composer 使用 hook 能力；删除 `getAgentCapabilities` 静态表

能力取值（与现表一致，写入 descriptor 实现，禁止前端再写一份）：

| agent | modelTypeLabel | canShowModel | supportsModelSwitching | supportsReasoningEffort | supportsModes |
| --- | --- | --- | --- | --- | --- |
| codex | Codex | true | true | true | true |
| claude | Claude | true | true | false | false |
| opencode | OpenCode | false | false | false | false |
| grok | Grok | false | false | false | false |

> `claude_code`：后端 `AgentType` 仅有 `Claude`；前端若仍有 `claude_code` 字面量，映射到与 Claude 相同能力（在 TS 消费侧或命令层归一），**不要**在 Rust 枚举发明新 variant。

- [ ] **Step 1: Rust 类型 + descriptor 方法 + 单测**

在 `provider_descriptor.rs` trait 增加：

```rust
fn ui_capabilities(&self) -> crate::types::agent_session::AgentUiCapabilities;
```

`CodexDescriptor` / `ClaudeDescriptor` / `StubDescriptor` 按上表实现。

测试：

```rust
#[test]
fn codex_ui_capabilities_match_product_table() {
    let caps = CodexDescriptor.ui_capabilities();
    assert!(caps.supports_reasoning_effort);
    assert!(caps.supports_modes);
}

#[test]
fn claude_ui_capabilities_disable_modes_and_effort() {
    let caps = ClaudeDescriptor.ui_capabilities();
    assert!(!caps.supports_reasoning_effort);
    assert!(!caps.supports_modes);
}
```

- [ ] **Step 2: list_agent_models 返回 capabilities**

```rust
let capabilities = descriptor.ui_capabilities();
Ok(ListAgentModelsResult {
    models,
    is_read_only: Some(is_read_only),
    capabilities,
})
```

同步 `src-tauri/src/types/agent_session.rs` 结构体字段。

- [ ] **Step 3: 前端类型与 hook**

`agent-stream-types.ts`：

```ts
export interface AgentUiCapabilities {
  modelTypeLabel: string;
  canShowModel: boolean;
  supportsModelSwitching: boolean;
  supportsReasoningEffort: boolean;
  supportsModes: boolean;
}

export interface ListAgentModelsResult {
  models: AgentModel[];
  isReadOnly?: boolean;
  capabilities: AgentUiCapabilities;
}
```

`use-agent-models.ts`：state + 返回 `capabilities`；加载失败时 `capabilities` 用安全默认（全 false，`modelTypeLabel: ""`）以免 composer 崩溃。

- [ ] **Step 4: 接线 composer，删除静态表**

- `AgentComposer` / `AgentSessionView`：不再 `import { getAgentCapabilities } from "../agent-capabilities"`。
- 从 `useAgentModels` 取 `capabilities` 传给 controls；在 models 未返回前用全 false 占位（与 loading 一致）。
- 删除 `agent-capabilities.ts`；全局 `rg getAgentCapabilities|agent-capabilities` 清零。
- 更新 `agent-composer.test.tsx`：`listAgentModels` mock 带上 `capabilities`。

- [ ] **Step 5: 验证**

```bash
cd src-tauri && cargo test --lib provider_descriptor -- --nocapture
pnpm format
pnpm lint
pnpm typecheck
pnpm test -- src/features/agents/composer
bash scripts/check-rust-file-size.sh
bash scripts/check-frontend-file-size.sh
git status --short
```

Expected: 全部通过；无残留 `agent-capabilities` 引用。

- [ ] **Step 6: commit**

```bash
git add src-tauri/src/agent/provider_descriptor.rs \
  src-tauri/src/agent/provider_descriptor_tests.rs \
  src-tauri/src/types/agent_session.rs \
  src-tauri/src/features/agent_session/commands.rs \
  src/features/agents
git commit -m "$(cat <<'EOF'
refactor: Agent UI 能力改由 descriptor 投影并下发

Refs: architecture-review-displayMode-lifecycle
EOF
)"
```

---

### Task 6: 文档收口

**Files:**
- Modify: `docs/architecture-design/agent-provider-protocol.md`
- Modify: `docs/architecture-design/agent-development-rules.md`（若有「前端常量表」表述）
- Optional short note in `docs/adr/README.md` 索引 **不**新建 superseding ADR（本轮是 0022/0015 的实现加深，不是决策翻转）

- [ ] **Step 1: 协议文档增加 lifecycle seam**

在 `agent-provider-protocol.md`「json / tui 分流」后追加一节：

```markdown
## Session 生命周期 seam（displayMode）

运行时传输选择集中在 `features/agent_session/lifecycle`：

| 意图 | 入口 | 真相来源 |
| --- | --- | --- |
| 启动分流 | service start* → `runtime_transport_from_raw(profile.display_mode)` 后持久化为 session 快照 | profile → session 快照 |
| inject | `lifecycle::inject_prompt(session.display_mode, …)` | **仅** session 快照 |
| timeline 观察 | `lifecycle::read_timeline_for_session` | **仅** session 快照；tui 不返回 structured timeline |
| archive | `build_issue_session_archive(..., display_mode)`（ADR-0023） | session 快照 |
| UI 能力 | `descriptor.ui_capabilities()` → `list_agent_models.capabilities` | provider descriptor，前端不维护静态双表 |

禁止：用 `pty_sessions.contains` / registry membership **选择**传输层；membership 只表示进程是否仍在。
```

- [ ] **Step 2: 链接自检**

```bash
rg -n "lifecycle|ui_capabilities|agent-capabilities" docs/architecture-design docs/adr
```

Expected: 文档描述与代码路径一致；无失效链接。

- [ ] **Step 3: commit**

```bash
git add docs/architecture-design/agent-provider-protocol.md docs/architecture-design/agent-development-rules.md
git commit -m "$(cat <<'EOF'
docs: 记录 Session lifecycle 与 displayMode seam

Refs: architecture-review-displayMode-lifecycle
EOF
)"
```

---

## Out of Scope / Follow-ups

- 将 `start_structured_*` / `start_*_tui_*` 方法体整块搬入 `lifecycle/adapters/{json,tui}.rs`（本轮只统一分流与 inject/observe）。
- shutdown 按 displayMode 精确杀进程（当前 delete 路径仍可 membership 双清，语义安全）。
- 完成流程前端 protocol 统一（架构候选 #2）、IssueService 完成用例（候选 #1）。
- 生成 TS 类型 codegen；本轮手动同步 DTO。

## Self-Review

1. **Spec coverage（架构候选 #3）**
   - interface 收窄 / displayMode locality → Task 1–4
   - 两个 runtime adapter 真 seam → inject + observe + start route（start 体 follow-up）
   - 能力单一来源 → Task 5
   - 不重开 ADR-0022/0011/0015 → Global Constraints + Task 6
2. **Placeholder scan**：测试里 `new_for_test` / helper 名要求实现者对齐仓库现名，不留 TBD 功能。
3. **类型一致**：`AgentUiCapabilities` / `RuntimeTransport` / `inject_prompt` 签名在 Task 间一致。

## 完成判定（执行终态）

- `cargo test --lib features::agent_session::` 与 `provider_descriptor` 相关测试通过
- `pnpm format && pnpm lint && pnpm typecheck && pnpm test -- src/features/agents` 通过
- `bash scripts/check-rust-file-size.sh` 与 `bash scripts/check-frontend-file-size.sh` 通过
- `rg getAgentCapabilities|AGENT_CAPABILITIES` 无业务引用
- `git status --short` 无本任务残留
