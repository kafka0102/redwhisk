use rusqlite::{params, OptionalExtension};

use super::AgentSessionRepository;

/// hook 映射可读的最小行。只含 running + tui + codex/grok。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TuiHookTurnTarget {
    pub agent_type: String,
    pub is_turn_running: bool,
}

impl AgentSessionRepository<'_> {
    /// 仅 `display_mode=tui`、`status=running`、`agent_type` 为 codex 或 grok。
    /// json、已退出、其它 agent、已删除、不存在都是 `None`。
    pub fn find_tui_hook_turn_target(
        &self,
        session_id: i64,
    ) -> rusqlite::Result<Option<TuiHookTurnTarget>> {
        self.connection
            .query_row(
                "SELECT agent_profiles.agent_type, agent_sessions.is_turn_running
                 FROM agent_sessions
                 JOIN agent_profiles ON agent_profiles.id = agent_sessions.agent_profile_id
                 WHERE agent_sessions.id = ?1
                   AND agent_sessions.status = 'running'
                   AND agent_sessions.display_mode = 'tui'
                   AND agent_sessions.del = 0
                   AND agent_profiles.agent_type IN ('codex', 'grok')",
                params![session_id],
                |row| {
                    Ok(TuiHookTurnTarget {
                        agent_type: row.get(0)?,
                        is_turn_running: row.get::<_, i64>(1)? != 0,
                    })
                },
            )
            .optional()
    }

    /// 环境变量主路径：该 id 是 running tui，且 agent_type 与 kind 一致。
    pub fn tui_hook_session_matches_kind(
        &self,
        session_id: i64,
        agent_type: &str,
    ) -> rusqlite::Result<bool> {
        let matched: Option<i64> = self
            .connection
            .query_row(
                "SELECT agent_sessions.id
                 FROM agent_sessions
                 JOIN agent_profiles ON agent_profiles.id = agent_sessions.agent_profile_id
                 WHERE agent_sessions.id = ?1
                   AND agent_sessions.status = 'running'
                   AND agent_sessions.display_mode = 'tui'
                   AND agent_sessions.del = 0
                   AND agent_profiles.agent_type = ?2",
                params![session_id, agent_type],
                |row| row.get(0),
            )
            .optional()?;
        Ok(matched.is_some())
    }

    /// provider session id 回退。多条时取最近启动的一条。
    pub fn find_running_tui_session_by_provider_id(
        &self,
        provider_session_id: &str,
    ) -> rusqlite::Result<Option<i64>> {
        self.connection
            .query_row(
                "SELECT agent_sessions.id
                 FROM agent_sessions
                 JOIN agent_profiles ON agent_profiles.id = agent_sessions.agent_profile_id
                 WHERE agent_sessions.provider_session_id = ?1
                   AND agent_sessions.status = 'running'
                   AND agent_sessions.display_mode = 'tui'
                   AND agent_sessions.del = 0
                   AND agent_profiles.agent_type IN ('codex', 'grok')
                 ORDER BY agent_sessions.started_at DESC, agent_sessions.id DESC
                 LIMIT 1",
                params![provider_session_id],
                |row| row.get(0),
            )
            .optional()
    }

    /// 置 1：与 broadcaster 处理 `TurnStarted` 的三步一致，但每步都锁 `display_mode='tui'`。
    /// 不写 `current_turn_id`。json 行的 turn 标志仍只由 broadcaster 写。
    pub fn mark_tui_hook_turn_started(&self, session_id: i64, now: i64) -> rusqlite::Result<()> {
        self.connection.execute(
            "UPDATE agent_sessions
             SET is_turn_running = 1,
                 turn_ended_at = NULL,
                 turn_started_at = ?2,
                 last_active_at = MAX(last_active_at + 1, ?2)
             WHERE id = ?1
               AND status = 'running'
               AND display_mode = 'tui'
               AND del = 0",
            params![session_id, now],
        )?;
        Ok(())
    }

    pub fn find_session_project_id(&self, session_id: i64) -> rusqlite::Result<Option<i64>> {
        self.connection
            .query_row(
                "SELECT project_id FROM agent_sessions WHERE id = ?1 AND del = 0",
                params![session_id],
                |row| row.get(0),
            )
            .optional()
    }

    /// 置 0：立即结束，`turn_ended_at` 保持 NULL，不走 json grace。
    /// 当前已是 0 且没有 grace 时间戳时不改，返回 false。
    pub fn clear_tui_hook_turn(&self, session_id: i64, now: i64) -> rusqlite::Result<bool> {
        let changed = self.connection.execute(
            "UPDATE agent_sessions
             SET is_turn_running = 0,
                 turn_ended_at = NULL,
                 last_active_at = MAX(last_active_at + 1, ?2)
             WHERE id = ?1
               AND status = 'running'
               AND display_mode = 'tui'
               AND del = 0
               AND (is_turn_running = 1 OR turn_ended_at IS NOT NULL)",
            params![session_id, now],
        )?;
        Ok(changed > 0)
    }
}
