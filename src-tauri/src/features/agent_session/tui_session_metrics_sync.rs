//! TUI + Codex 运行期用量与执行时长同步。
//!
//! 由后台活跃时长心跳按同一 tick 调用：对运行中 `display_mode=tui`、
//! `agent_type=codex` 且已捕获 `provider_session_id` 的会话，增量读取本机 Codex
//! session log，把累计 Token 用量与执行时长写回 Session 记录。写入责任按
//! `display_mode` 与活跃时长心跳互斥：心跳只累加 `json`（且 Turn 在跑），本模块
//! 只覆盖 `tui`。见 ADR-0046。

use std::collections::HashMap;
use std::path::Path;

use crate::agent::session_token_usage::SessionTokenUsage;
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::types::agent_profile::AgentType;

use super::codex_session_log::CodexSessionLogTail;

/// 单会话增量游标：session log 读取器 + 已写入值，避免每 tick 重复写库。
struct SessionCursor {
    tail: CodexSessionLogTail,
    written_token_usage: Option<SessionTokenUsage>,
    written_processing_ms: u64,
}

/// 运行中 TUI + Codex 会话的 session log 用量同步器；跨 tick 保有内存游标。
#[derive(Default)]
pub(crate) struct TuiSessionMetricsSync {
    cursors: HashMap<i64, SessionCursor>,
}

impl TuiSessionMetricsSync {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// 推进一轮增量同步；定位 / 解析 / IO 失败静默跳过，不中断调用方。
    pub(crate) fn sync_once(
        &mut self,
        repository: &AgentSessionRepository<'_>,
        codex_home: Option<&Path>,
    ) {
        let Some(codex_home) = codex_home else {
            return;
        };
        let Ok(sessions) = repository.list_running_tui_sessions() else {
            return;
        };

        // 只保留仍在运行集合中的游标，避免已结束会话的内存游标无限增长。
        self.cursors.retain(|session_id, _| {
            sessions
                .iter()
                .any(|session| session.session_id == *session_id)
        });

        for session in sessions {
            // 本期只覆盖 Codex；其它 Agent 的 TUI 用量保持既有行为（横线 / 墙钟差）。
            if session.agent_type != AgentType::Codex {
                continue;
            }
            let cursor = self
                .cursors
                .entry(session.session_id)
                .or_insert_with(|| SessionCursor {
                    tail: CodexSessionLogTail::new(),
                    written_token_usage: None,
                    written_processing_ms: 0,
                });
            cursor.tail.poll(codex_home, &session.provider_session_id);
            cursor.write_metrics(repository, session.session_id);
        }
    }
}

impl SessionCursor {
    /// 把当前累计值按变化覆盖写入 Session，并前移已写基线（值未变则不重复写库）。
    fn write_metrics(&mut self, repository: &AgentSessionRepository<'_>, session_id: i64) {
        // 线程累计用量按「有则覆盖」写入，不累加；值未变时不重复写库。
        let token_usage = self.tail.token_usage();
        if token_usage != self.written_token_usage {
            if let Some(usage) = token_usage {
                if repository
                    .overwrite_session_token_usage(
                        session_id,
                        to_i64(usage.input),
                        to_i64(usage.output),
                        to_i64(usage.cache),
                    )
                    .is_ok()
                {
                    self.written_token_usage = token_usage;
                }
            }
        }

        // 执行时长取 session log 各 turn 处理耗时之和（单调不减）；0 不回写以保留墙钟回退。
        let processing_ms = self.tail.processing_ms();
        if processing_ms > 0 && processing_ms != self.written_processing_ms {
            if repository
                .overwrite_tui_processing_ms(session_id, to_i64(processing_ms))
                .is_ok()
            {
                self.written_processing_ms = processing_ms;
            }
        }
    }
}

fn to_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

#[cfg(test)]
#[path = "tui_session_metrics_sync_tests.rs"]
mod tests;
