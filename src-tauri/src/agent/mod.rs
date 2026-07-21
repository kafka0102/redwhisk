pub mod agent_event_broadcaster;
pub mod claude_config;
pub mod claude_streaming;
pub mod codex_app_server;
pub mod codex_config;
pub mod command_detector;
pub mod latest_output_writer;
pub mod pty_osc_color_reply;
pub mod pty_session_manager;
pub mod terminal_log_tail;
pub mod provider_descriptor;
pub mod provider_factory;
pub mod session_handle;
pub mod session_registry;

pub use provider_descriptor::{
    AgentProviderDescriptor, ClaudeDescriptor, CodexDescriptor, RuntimeConfig, descriptor_for,
};
pub use provider_factory::{
    AgentSessionProviderFactory, AgentSessionStartRequest, DefaultAgentSessionProviderFactory,
    StartedSession, ThreadIdBackfill,
};
pub use session_handle::{AgentSessionError, AgentSessionHandle};
pub use session_registry::AgentSessionRegistry;
