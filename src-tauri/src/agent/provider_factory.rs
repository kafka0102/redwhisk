//! 结构化 Agent Session 构造侧 seam。
//!
//! 消费侧已有 `AgentSessionHandle`；本模块补齐构造：协议中立启动请求经
//! `AgentSessionProviderFactory` 产出 `StartedSession`（handle + thread_id
//! 回填声明）。生产用 `DefaultAgentSessionProviderFactory`；单测注入 fake，
//! 不启真实 codex/claude 进程。
//!
//! 见 ADR-0011。

use std::path::PathBuf;
use std::sync::Arc;

use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::agent::claude_streaming::{ClaudeSessionConfig, ClaudeSessionHandle};
use crate::agent::opencode_streaming::{OpenCodeSessionConfig, OpenCodeSessionHandle};
use crate::agent::codex_app_server::session::CodexMode;
use crate::agent::codex_app_server::{CodexSessionConfig, CodexSessionHandle};
use crate::agent::session_handle::{AgentSessionError, AgentSessionHandle};
use crate::types::agent_profile::AgentType;

/// 启动后如何把 provider thread/session id 写回 DB。
///
/// service 只按本声明写库，不再按 `agent_type` 硬分支 thread_id 规则。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThreadIdBackfill {
    /// 启动结果必须立刻带回 thread_id，service 同步写库；缺失视为启动失败。
    Required,
    /// 有 thread_id 时写库；没有则跳过（例如 Claude 新建会话待流事件回填）。
    WhenPresent,
    /// 不从启动结果写库（完全 defer 到 stream 事件）。
    DeferToStream,
}

/// 协议中立的结构化会话启动请求。
///
/// 调用方（service）只填中立字段；不得 import 具体 Config/Mode/Handle。
#[derive(Clone)]
pub struct AgentSessionStartRequest {
    pub agent_type: AgentType,
    pub project_id: i64,
    pub session_id: i64,
    /// provider 可执行路径（可带已拼装参数的命令行前缀）。
    pub binary: String,
    pub cwd: String,
    /// 协作模式 id 字符串（如 `auto` / `full-access` / profile 别名）；Claude 忽略。
    pub mode_id: Option<String>,
    /// profile.dangerous：mode_id 无法识别时是否回退 FullAccess（仅 Codex）。
    pub dangerous: bool,
    pub model: Option<String>,
    /// reasoning effort；Claude 忽略。
    pub effort: Option<String>,
    /// 续接已有 provider thread/session id；None 表示新建。
    pub resume_thread_id: Option<String>,
    pub broadcaster: AgentEventBroadcaster,
    /// RedWhisk home / config 根路径，供后续 adapter 配置持久化（票 04）。
    pub config_home: Option<PathBuf>,
}

/// factory 启动成功后的产物。
pub struct StartedSession {
    pub handle: Arc<dyn AgentSessionHandle>,
    pub thread_id: Option<String>,
    pub backfill: ThreadIdBackfill,
}

/// 可注入的 provider 构造 seam。
pub trait AgentSessionProviderFactory: Send + Sync {
    fn start(&self, request: AgentSessionStartRequest) -> Result<StartedSession, AgentSessionError>;
}

/// 生产默认 factory：内部分发 Codex / Claude，解析 mode_id 等私有细节。
#[derive(Debug, Default, Clone, Copy)]
pub struct DefaultAgentSessionProviderFactory;

impl AgentSessionProviderFactory for DefaultAgentSessionProviderFactory {
    fn start(&self, request: AgentSessionStartRequest) -> Result<StartedSession, AgentSessionError> {
        let plan = plan_provider_start(&request)?;
        match plan {
            ProviderStartPlan::Codex { mode, backfill } => {
                start_codex_session(request, mode, backfill)
            }
            ProviderStartPlan::Claude { backfill } => start_claude_session(request, backfill),
            ProviderStartPlan::OpenCode { backfill } => start_opencode_session(request, backfill),
        }
    }
}

/// 规范化后的 provider 启动计划（纯函数，可单测）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderStartPlan {
    Codex {
        mode: PlannedCodexMode,
        backfill: ThreadIdBackfill,
    },
    Claude {
        backfill: ThreadIdBackfill,
    },
    OpenCode {
        backfill: ThreadIdBackfill,
    },
}

/// 协议中立的 Codex mode 标识（测试不依赖 adapter 类型也可断言）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlannedCodexMode {
    Auto,
    FullAccess,
    ReadOnly,
}

impl PlannedCodexMode {
    fn to_codex_mode(self) -> CodexMode {
        match self {
            PlannedCodexMode::Auto => CodexMode::Auto,
            PlannedCodexMode::FullAccess => CodexMode::FullAccess,
            PlannedCodexMode::ReadOnly => CodexMode::ReadOnly,
        }
    }
}

const CODEX_DEFAULT_MODE_ID: &str = "full-access";

/// 解析请求并产出路由 / mode / 回填声明；非法 mode 在此失败。
pub fn plan_provider_start(
    request: &AgentSessionStartRequest,
) -> Result<ProviderStartPlan, AgentSessionError> {
    match request.agent_type {
        AgentType::Codex => {
            let mode = resolve_codex_mode(request.mode_id.as_deref(), request.dangerous)?;
            // Codex 新建与 resume 均在 start 后同步拿到 thread_id。
            Ok(ProviderStartPlan::Codex {
                mode,
                backfill: ThreadIdBackfill::Required,
            })
        }
        AgentType::Claude => {
            // 新建：session_id 由首轮流事件异步产生 → DeferToStream；
            // resume：请求已带 thread_id，handle 会持有它 → WhenPresent。
            let backfill = if request.resume_thread_id.is_some() {
                ThreadIdBackfill::WhenPresent
            } else {
                ThreadIdBackfill::DeferToStream
            };
            Ok(ProviderStartPlan::Claude { backfill })
        }
        AgentType::OpenCode => {
            // 与 Claude 同构：新建 defer 到首事件；resume 时 WhenPresent。
            let backfill = if request.resume_thread_id.is_some() {
                ThreadIdBackfill::WhenPresent
            } else {
                ThreadIdBackfill::DeferToStream
            };
            Ok(ProviderStartPlan::OpenCode { backfill })
        }
        AgentType::Grok => Err(AgentSessionError::Other(
            "暂不支持启动 Grok 类型的 Agent 会话。".to_string(),
        )),
    }
}

/// 解析 Codex mode 字符串（含 profile 别名）；调用方无需 import `CodexMode`。
pub fn resolve_codex_mode(
    mode_id: Option<&str>,
    dangerous: bool,
) -> Result<PlannedCodexMode, AgentSessionError> {
    let raw = mode_id.unwrap_or(CODEX_DEFAULT_MODE_ID);
    let normalized = raw.trim();

    if let Some(mode) = planned_codex_mode_from_id(normalized) {
        return Ok(mode);
    }

    match normalized {
        "" | "default" => Ok(PlannedCodexMode::FullAccess),
        "auto" => Ok(PlannedCodexMode::Auto),
        "full-auto" | "danger-full-access" | "dangerous" => Ok(PlannedCodexMode::FullAccess),
        "read_only" => Ok(PlannedCodexMode::ReadOnly),
        _ if dangerous => Ok(PlannedCodexMode::FullAccess),
        _ => Err(AgentSessionError::UnsupportedMode(normalized.to_string())),
    }
}

fn planned_codex_mode_from_id(id: &str) -> Option<PlannedCodexMode> {
    match id {
        "auto" => Some(PlannedCodexMode::Auto),
        "full-access" => Some(PlannedCodexMode::FullAccess),
        "read-only" => Some(PlannedCodexMode::ReadOnly),
        _ => None,
    }
}

fn start_codex_session(
    request: AgentSessionStartRequest,
    mode: PlannedCodexMode,
    backfill: ThreadIdBackfill,
) -> Result<StartedSession, AgentSessionError> {
    let config = CodexSessionConfig {
        project_id: request.project_id,
        session_id: request.session_id,
        binary: request.binary,
        cwd: request.cwd,
        mode: mode.to_codex_mode(),
        broadcaster: request.broadcaster,
        resume_thread_id: request.resume_thread_id,
        model: request.model,
        effort: request.effort,
        config_home: request.config_home,
    };

    let handle = CodexSessionHandle::start(config).map_err(AgentSessionError::from)?;
    let thread_id = handle.thread_id();
    Ok(StartedSession {
        handle: Arc::new(handle),
        thread_id,
        backfill,
    })
}

fn start_claude_session(
    request: AgentSessionStartRequest,
    backfill: ThreadIdBackfill,
) -> Result<StartedSession, AgentSessionError> {
    let config = ClaudeSessionConfig {
        project_id: request.project_id,
        session_id: request.session_id,
        binary: request.binary,
        cwd: request.cwd,
        model: request.model,
        broadcaster: request.broadcaster,
        resume_session_id: request.resume_thread_id,
        config_home: request.config_home,
    };
    let _ = request.effort;
    let _ = request.mode_id;
    let _ = request.dangerous;

    let handle = ClaudeSessionHandle::start(config).map_err(AgentSessionError::from)?;
    let thread_id = handle.thread_id();
    Ok(StartedSession {
        handle: Arc::new(handle),
        thread_id,
        backfill,
    })
}

fn start_opencode_session(
    request: AgentSessionStartRequest,
    backfill: ThreadIdBackfill,
) -> Result<StartedSession, AgentSessionError> {
    let config = OpenCodeSessionConfig {
        project_id: request.project_id,
        session_id: request.session_id,
        binary: request.binary,
        cwd: request.cwd,
        model: request.model,
        dangerous: request.dangerous,
        mode_id: request.mode_id,
        broadcaster: request.broadcaster,
        resume_session_id: request.resume_thread_id,
    };
    let _ = request.effort;
    let _ = request.config_home;

    let handle = OpenCodeSessionHandle::start(config).map_err(AgentSessionError::from)?;
    let thread_id = handle.thread_id();
    Ok(StartedSession {
        handle: Arc::new(handle),
        thread_id,
        backfill,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::agent_session::{AgentMessageAttachment, AgentPermissionDecision};
    use crate::types::agent_session_stream::{AgentMode, AgentModel, AgentTimelineItem};
    use std::sync::Mutex;

    fn base_request(agent_type: AgentType) -> AgentSessionStartRequest {
        AgentSessionStartRequest {
            agent_type,
            project_id: 1,
            session_id: 42,
            binary: "fake-binary".into(),
            cwd: "/tmp".into(),
            mode_id: None,
            dangerous: false,
            model: None,
            effort: None,
            resume_thread_id: None,
            broadcaster: AgentEventBroadcaster::new(),
            config_home: None,
        }
    }

    #[test]
    fn plan_routes_codex_with_required_backfill() {
        let request = base_request(AgentType::Codex);
        let plan = plan_provider_start(&request).expect("plan");
        assert_eq!(
            plan,
            ProviderStartPlan::Codex {
                mode: PlannedCodexMode::FullAccess,
                backfill: ThreadIdBackfill::Required,
            }
        );
    }

    #[test]
    fn plan_routes_claude_new_with_defer_backfill() {
        let request = base_request(AgentType::Claude);
        let plan = plan_provider_start(&request).expect("plan");
        assert_eq!(
            plan,
            ProviderStartPlan::Claude {
                backfill: ThreadIdBackfill::DeferToStream,
            }
        );
    }

    #[test]
    fn plan_routes_claude_resume_with_when_present_backfill() {
        let mut request = base_request(AgentType::Claude);
        request.resume_thread_id = Some("claude-sess-1".into());
        let plan = plan_provider_start(&request).expect("plan");
        assert_eq!(
            plan,
            ProviderStartPlan::Claude {
                backfill: ThreadIdBackfill::WhenPresent,
            }
        );
    }

    #[test]
    fn resolve_codex_mode_accepts_canonical_and_aliases() {
        assert_eq!(
            resolve_codex_mode(Some("auto"), false).unwrap(),
            PlannedCodexMode::Auto
        );
        assert_eq!(
            resolve_codex_mode(Some("full-access"), false).unwrap(),
            PlannedCodexMode::FullAccess
        );
        assert_eq!(
            resolve_codex_mode(Some("read-only"), false).unwrap(),
            PlannedCodexMode::ReadOnly
        );
        assert_eq!(
            resolve_codex_mode(Some("default"), false).unwrap(),
            PlannedCodexMode::FullAccess
        );
        assert_eq!(
            resolve_codex_mode(Some(""), false).unwrap(),
            PlannedCodexMode::FullAccess
        );
        assert_eq!(
            resolve_codex_mode(Some("read_only"), false).unwrap(),
            PlannedCodexMode::ReadOnly
        );
        assert_eq!(
            resolve_codex_mode(Some("danger-full-access"), false).unwrap(),
            PlannedCodexMode::FullAccess
        );
        assert_eq!(
            resolve_codex_mode(None, false).unwrap(),
            PlannedCodexMode::FullAccess
        );
    }

    #[test]
    fn resolve_codex_mode_rejects_unknown_unless_dangerous() {
        let err = resolve_codex_mode(Some("nope"), false).expect_err("unknown mode");
        assert!(matches!(err, AgentSessionError::UnsupportedMode(ref m) if m == "nope"));

        assert_eq!(
            resolve_codex_mode(Some("nope"), true).unwrap(),
            PlannedCodexMode::FullAccess
        );
    }

    #[test]
    fn plan_rejects_illegal_codex_mode() {
        let mut request = base_request(AgentType::Codex);
        request.mode_id = Some("invalid-mode".into());
        let err = plan_provider_start(&request).expect_err("illegal mode");
        assert!(matches!(
            err,
            AgentSessionError::UnsupportedMode(ref m) if m == "invalid-mode"
        ));
    }

    #[test]
    fn plan_maps_resume_field_without_changing_codex_backfill() {
        let mut request = base_request(AgentType::Codex);
        request.resume_thread_id = Some("thread-abc".into());
        request.mode_id = Some("read-only".into());
        let plan = plan_provider_start(&request).expect("plan");
        assert_eq!(
            plan,
            ProviderStartPlan::Codex {
                mode: PlannedCodexMode::ReadOnly,
                backfill: ThreadIdBackfill::Required,
            }
        );
    }

    /// 纯 fake factory：证明 trait 可注入，不依赖真实 provider 进程。
    struct FakeProviderFactory {
        result: Mutex<Option<Result<StartedSession, AgentSessionError>>>,
        last_request: Mutex<Option<AgentSessionStartRequest>>,
    }

    struct FakeHandle {
        thread_id: Option<String>,
    }

    impl AgentSessionHandle for FakeHandle {
        fn send_message(
            &self,
            _text: String,
            _attachments: Vec<AgentMessageAttachment>,
        ) -> Result<(), AgentSessionError> {
            Ok(())
        }

        fn cancel_turn(&self) -> Result<(), AgentSessionError> {
            Ok(())
        }

        fn respond_permission(
            &self,
            _request_id: &str,
            _decision: AgentPermissionDecision,
        ) -> Result<(), AgentSessionError> {
            Ok(())
        }

        fn set_model(&self, _model_id: String) -> Result<(), AgentSessionError> {
            Ok(())
        }

        fn set_effort(&self, _effort: Option<String>) -> Result<(), AgentSessionError> {
            Ok(())
        }

        fn set_mode(&self, _mode_id: &str) -> Result<(), AgentSessionError> {
            Ok(())
        }

        fn list_models(&self) -> Result<Vec<AgentModel>, AgentSessionError> {
            Ok(Vec::new())
        }

        fn list_modes(&self) -> Vec<AgentMode> {
            Vec::new()
        }

        fn read_timeline(&self) -> Result<Vec<AgentTimelineItem>, AgentSessionError> {
            Ok(Vec::new())
        }

        fn shutdown(&self) {}

        fn thread_id(&self) -> Option<String> {
            self.thread_id.clone()
        }
    }

    impl AgentSessionProviderFactory for FakeProviderFactory {
        fn start(
            &self,
            request: AgentSessionStartRequest,
        ) -> Result<StartedSession, AgentSessionError> {
            *self.last_request.lock().expect("lock") = Some(request);
            self.result
                .lock()
                .expect("lock")
                .take()
                .unwrap_or_else(|| Err(AgentSessionError::Other("fake 未配置结果".into())))
        }
    }

    #[test]
    fn fake_factory_is_injectable_and_returns_configured_session() {
        let factory = FakeProviderFactory {
            result: Mutex::new(Some(Ok(StartedSession {
                handle: Arc::new(FakeHandle {
                    thread_id: Some("t-1".into()),
                }),
                thread_id: Some("t-1".into()),
                backfill: ThreadIdBackfill::Required,
            }))),
            last_request: Mutex::new(None),
        };

        let request = base_request(AgentType::Codex);
        let started = factory.start(request).expect("fake start");
        assert_eq!(started.thread_id.as_deref(), Some("t-1"));
        assert_eq!(started.backfill, ThreadIdBackfill::Required);
        assert_eq!(started.handle.thread_id().as_deref(), Some("t-1"));

        let captured = factory.last_request.lock().expect("lock").take();
        assert!(captured.is_some());
    }

    #[test]
    fn fake_factory_can_simulate_start_failure() {
        let factory = FakeProviderFactory {
            result: Mutex::new(Some(Err(AgentSessionError::NotRunning(
                "spawn failed".into(),
            )))),
            last_request: Mutex::new(None),
        };
        let result = factory.start(base_request(AgentType::Codex));
        assert!(
            matches!(result, Err(AgentSessionError::NotRunning(_))),
            "expected NotRunning from fake factory"
        );
    }

    #[test]
    fn default_factory_starts_claude_without_spawning_process() {
        // ClaudeSessionHandle::start 仅初始化状态，不启真实 claude 进程。
        let factory = DefaultAgentSessionProviderFactory;
        let mut request = base_request(AgentType::Claude);
        request.resume_thread_id = Some("resume-sess".into());
        let started = factory.start(request).expect("claude start");
        assert_eq!(started.thread_id.as_deref(), Some("resume-sess"));
        assert_eq!(started.backfill, ThreadIdBackfill::WhenPresent);
        assert_eq!(started.handle.thread_id().as_deref(), Some("resume-sess"));
    }

    #[test]
    fn default_factory_claude_handle_persists_model_to_config_home() {
        let temp = tempfile::tempdir().expect("temp");
        let factory = DefaultAgentSessionProviderFactory;
        let mut request = base_request(AgentType::Claude);
        request.config_home = Some(temp.path().to_path_buf());
        let started = factory.start(request).expect("start");
        started
            .handle
            .set_model("sonnet".into())
            .expect("set model");
        let settings = crate::agent::claude_config::read_settings_from_home(temp.path())
            .expect("settings");
        assert_eq!(settings.model.as_deref(), Some("sonnet"));
    }

    #[test]
    fn claude_handle_rejects_effort_via_trait() {
        let factory = DefaultAgentSessionProviderFactory;
        let started = factory
            .start(base_request(AgentType::Claude))
            .expect("start");
        let err = started
            .handle
            .set_effort(Some("high".into()))
            .expect_err("unsupported");
        assert!(matches!(err, AgentSessionError::UnsupportedMode(_)));
    }

    #[test]
    fn plan_routes_opencode_new_with_defer_backfill() {
        let request = base_request(AgentType::OpenCode);
        let plan = plan_provider_start(&request).expect("plan");
        assert_eq!(
            plan,
            ProviderStartPlan::OpenCode {
                backfill: ThreadIdBackfill::DeferToStream,
            }
        );
    }

    #[test]
    fn plan_routes_opencode_resume_with_when_present_backfill() {
        let mut request = base_request(AgentType::OpenCode);
        request.resume_thread_id = Some("ses_resume".into());
        let plan = plan_provider_start(&request).expect("plan");
        assert_eq!(
            plan,
            ProviderStartPlan::OpenCode {
                backfill: ThreadIdBackfill::WhenPresent,
            }
        );
    }

    #[test]
    fn plan_still_rejects_grok() {
        let request = base_request(AgentType::Grok);
        let err = plan_provider_start(&request).expect_err("grok");
        assert!(matches!(err, AgentSessionError::Other(ref m) if m.contains("Grok")));
    }

    #[test]
    fn default_factory_starts_opencode_without_spawning_process() {
        let factory = DefaultAgentSessionProviderFactory;
        let mut request = base_request(AgentType::OpenCode);
        request.resume_thread_id = Some("ses_resume".into());
        request.dangerous = true;
        request.mode_id = Some("full-access".into());
        request.model = Some("openai/gpt-5".into());
        let started = factory.start(request).expect("opencode start");
        assert_eq!(started.thread_id.as_deref(), Some("ses_resume"));
        assert_eq!(started.backfill, ThreadIdBackfill::WhenPresent);
        assert_eq!(started.handle.thread_id().as_deref(), Some("ses_resume"));
    }

}
