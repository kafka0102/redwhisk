use crate::db::agent_session_repository::AgentSessionRepository;
use crate::types::agent_session_stream::AgentStreamEvent;

use super::SessionTokenUsage;

pub fn session_token_usage_from_event(event: &AgentStreamEvent) -> Option<SessionTokenUsage> {
    let usage = match event {
        AgentStreamEvent::UsageUpdated { usage } => usage,
        AgentStreamEvent::TurnCompleted {
            usage: Some(usage), ..
        } => usage,
        _ => return None,
    };
    Some(SessionTokenUsage {
        input: usage.session_token_input?,
        output: usage.session_token_output?,
        cache: usage.session_token_cache?,
    })
}

#[cfg(test)]
pub fn persist_session_token_usage(
    repository: &AgentSessionRepository<'_>,
    session_id: i64,
    event: &AgentStreamEvent,
) -> rusqlite::Result<bool> {
    persist_session_token_usage_with(
        repository,
        session_id,
        event,
        &mut SessionTokenAccumulator::default(),
    )
}

pub fn persist_session_token_usage_with(
    repository: &AgentSessionRepository<'_>,
    session_id: i64,
    event: &AgentStreamEvent,
    accumulator: &mut SessionTokenAccumulator,
) -> rusqlite::Result<bool> {
    let Some(usage) = session_token_usage_from_event(event) else {
        return Ok(false);
    };
    let merge = match event {
        AgentStreamEvent::UsageUpdated { usage } => usage.session_token_merge,
        AgentStreamEvent::TurnCompleted {
            usage: Some(usage), ..
        } => usage.session_token_merge,
        _ => crate::types::agent_session_stream::SessionTokenMerge::Overwrite,
    };
    let snapshot = match merge {
        crate::types::agent_session_stream::SessionTokenMerge::Overwrite => {
            accumulator.commit_overwrite(usage);
            usage
        }
        crate::types::agent_session_stream::SessionTokenMerge::TurnLatest => {
            accumulator.ensure_loaded(repository, session_id)?;
            accumulator.preview(usage)
        }
        crate::types::agent_session_stream::SessionTokenMerge::TurnCommit => {
            accumulator.ensure_loaded(repository, session_id)?;
            accumulator.commit(usage)
        }
    };
    repository.overwrite_session_token_usage(
        session_id,
        i64::try_from(snapshot.input).unwrap_or(i64::MAX),
        i64::try_from(snapshot.output).unwrap_or(i64::MAX),
        i64::try_from(snapshot.cache).unwrap_or(i64::MAX),
    )?;
    Ok(true)
}

/// 按 turn 合并 Session Token 消耗：本 turn 最新用量覆盖「本 turn 部分」。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SessionTokenAccumulator {
    committed: SessionTokenUsage,
    current_turn: Option<SessionTokenUsage>,
    loaded: bool,
}

impl SessionTokenAccumulator {
    fn commit_overwrite(&mut self, usage: SessionTokenUsage) {
        self.committed = usage;
        self.current_turn = None;
        self.loaded = true;
    }

    fn preview(&mut self, usage: SessionTokenUsage) -> SessionTokenUsage {
        self.current_turn = Some(usage);
        self.committed.saturating_add(usage)
    }

    fn commit(&mut self, usage: SessionTokenUsage) -> SessionTokenUsage {
        self.committed = self.committed.saturating_add(usage);
        self.current_turn = None;
        self.committed
    }

    fn ensure_loaded(
        &mut self,
        repository: &AgentSessionRepository<'_>,
        session_id: i64,
    ) -> rusqlite::Result<()> {
        if self.loaded {
            return Ok(());
        }
        self.loaded = true;
        let Some((input, output, cache)) = repository.read_session_token_usage(session_id)? else {
            return Ok(());
        };
        self.committed = SessionTokenUsage {
            input: u64_from_db(input),
            output: u64_from_db(output),
            cache: u64_from_db(cache),
        };
        Ok(())
    }
}

fn u64_from_db(value: Option<i64>) -> u64 {
    value
        .and_then(|number| u64::try_from(number).ok())
        .unwrap_or(0)
}
