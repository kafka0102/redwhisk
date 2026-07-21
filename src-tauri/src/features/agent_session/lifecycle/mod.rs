//! Agent Session 生命周期深 module：以 Session 展示形式快照选传输 adapter。
//! service 负责 DB 事务与业务规则；runtime 分流细节在此收口（架构候选 #3）。

mod display_mode;

// Task 1 先 re-export 面；Task 2–4 接入调用方前允许未使用。
#[allow(unused_imports)]
pub(crate) use display_mode::{
    parse_session_display_mode, runtime_transport, runtime_transport_from_raw, RuntimeTransport,
    SessionDisplayMode,
};
