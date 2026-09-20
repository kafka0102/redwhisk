//! Session Token 消耗：把各 provider 原始用量收成同一组输入 / 输出 / 缓存。

use serde_json::Value;

use crate::db::agent_session_repository::AgentSessionRepository;
use crate::types::agent_session_stream::AgentStreamEvent;

/// 规范化后的 Session Token 消耗三项累计值。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionTokenUsage {
    pub input: u64,
    pub output: u64,
    pub cache: u64,
}

/// 从 Codex `thread/tokenUsage/updated` 载荷取线程累计快照。
///
/// 优先 `total`，禁止把 `last` 再加一遍。
pub fn normalize_codex_token_usage(token_usage: &Value) -> Option<SessionTokenUsage> {
    let snapshot = token_usage
        .get("total")
        .or_else(|| token_usage.get("totalTokenUsage"))
        .or_else(|| token_usage.get("total_token_usage"))
        .or_else(|| token_usage.get("last"))
        .or_else(|| token_usage.get("lastTokenUsage"))
        .or_else(|| token_usage.get("last_token_usage"))
        .and_then(Value::as_object)?;
    let input_tokens = u64_field(snapshot, "input_tokens", "inputTokens")?;
    let cache = u64_field(snapshot, "cached_input_tokens", "cachedInputTokens").unwrap_or(0);
    let cache_write = u64_field(
        snapshot,
        "cache_creation_input_tokens",
        "cacheCreationInputTokens",
    )
    .or_else(|| {
        u64_field(
            snapshot,
            "cache_write_input_tokens",
            "cacheWriteInputTokens",
        )
    })
    .unwrap_or(0);
    let output = u64_field(snapshot, "output_tokens", "outputTokens")?;
    Some(SessionTokenUsage {
        input: input_tokens
            .saturating_sub(cache)
            .saturating_add(cache_write),
        output,
        cache,
    })
}

fn u64_field(object: &serde_json::Map<String, Value>, snake: &str, camel: &str) -> Option<u64> {
    object
        .get(snake)
        .or_else(|| object.get(camel))
        .and_then(json_u64)
}

fn json_u64(value: &Value) -> Option<u64> {
    match value {
        Value::Number(number) => number.as_u64().or_else(|| {
            number.as_f64().and_then(|float| {
                if float.is_finite() && float >= 0.0 && float.fract() == 0.0 {
                    Some(float as u64)
                } else {
                    None
                }
            })
        }),
        _ => None,
    }
}

pub fn session_token_usage_from_event(event: &AgentStreamEvent) -> Option<SessionTokenUsage> {
    let AgentStreamEvent::UsageUpdated { usage } = event else {
        return None;
    };
    Some(SessionTokenUsage {
        input: usage.session_token_input?,
        output: usage.session_token_output?,
        cache: usage.session_token_cache?,
    })
}

pub fn persist_session_token_usage(
    repository: &AgentSessionRepository<'_>,
    session_id: i64,
    event: &AgentStreamEvent,
) -> rusqlite::Result<bool> {
    let Some(usage) = session_token_usage_from_event(event) else {
        return Ok(false);
    };
    repository.overwrite_session_token_usage(
        session_id,
        i64::try_from(usage.input).unwrap_or(i64::MAX),
        i64::try_from(usage.output).unwrap_or(i64::MAX),
        i64::try_from(usage.cache).unwrap_or(i64::MAX),
    )?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn prefers_codex_total_and_maps_uncached_input_output_and_cache() {
        let usage = normalize_codex_token_usage(&json!({
            "model_context_window": 200_000,
            "last": {
                "input_tokens": 100,
                "cached_input_tokens": 20,
                "output_tokens": 30,
                "reasoning_output_tokens": 10,
            },
            "total": {
                "input_tokens": 1_500,
                "cached_input_tokens": 400,
                "output_tokens": 300,
                "reasoning_output_tokens": 80,
            },
        }));

        assert_eq!(
            usage,
            Some(SessionTokenUsage {
                input: 1_100,
                output: 300,
                cache: 400,
            })
        );
    }

    #[test]
    fn counts_codex_cache_write_as_input() {
        let usage = normalize_codex_token_usage(&json!({
            "total": {
                "input_tokens": 1_500,
                "cached_input_tokens": 400,
                "cache_creation_input_tokens": 50,
                "output_tokens": 300,
            },
        }));
        assert_eq!(
            usage,
            Some(SessionTokenUsage {
                input: 1_150,
                output: 300,
                cache: 400,
            })
        );
    }

    #[test]
    fn uses_codex_last_as_overwrite_snapshot_when_total_is_absent() {
        let usage = normalize_codex_token_usage(&json!({
            "last": {
                "input_tokens": 1_500,
                "cached_input_tokens": 400,
                "output_tokens": 300,
            },
        }));
        assert_eq!(
            usage,
            Some(SessionTokenUsage {
                input: 1_100,
                output: 300,
                cache: 400,
            })
        );
    }
}

#[cfg(test)]
mod persist_tests {
    use crate::db::agent_profile_repository::AgentProfileRepository;
    use crate::db::agent_session_repository::AgentSessionRepository;
    use crate::db::issue_repository::IssueRepository;
    use crate::db::migrations::MigrationRunner;
    use crate::db::project_repository::ProjectRepository;
    use crate::features::agent_session::AgentSessionService;
    use rusqlite::{params, Connection};

    fn setup() -> Connection {
        let connection = Connection::open_in_memory().expect("open database");
        MigrationRunner::default()
            .run(&connection)
            .expect("run migrations");
        connection
            .execute(
                "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
                 VALUES (1, 'RedWhisk', ?1, 1, 1)",
                params![std::env::temp_dir().to_string_lossy().to_string()],
            )
            .expect("insert project");
        connection
            .execute(
                "INSERT INTO agent_profiles (id, name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del)
                 VALUES (101, 'Codex', 'codex', 'codex', 'project', 1, 'full-auto', 1, '', '', 0)",
                [],
            )
            .expect("insert profile");
        connection
            .execute(
                "INSERT INTO agent_sessions (
                   id, project_id, number, issue_id, title, agent_profile_id, status, attention,
                   working_dir, command_snapshot, prompt_snapshot, workspace_mode,
                   target_branch, workspace_branch, workspace_path,
                   worktree_root_path, log_path, list_inserted_at, last_active_at, started_at,
                   closed_at, del
                 ) VALUES (
                   410, 1, 1, NULL, NULL, 101, 'running', 'none',
                   '/tmp', '', '', 'current_branch',
                   NULL, NULL, '/tmp',
                   NULL, '/tmp/session.jsonl', 1, 1, 1,
                   NULL, 0
                 )",
                [],
            )
            .expect("insert session");
        connection
    }

    fn service(connection: &Connection) -> AgentSessionService<'_> {
        AgentSessionService::new(
            IssueRepository::new(connection),
            ProjectRepository::new(connection),
            AgentProfileRepository::new(connection),
            AgentSessionRepository::new(connection),
        )
    }

    #[test]
    fn list_item_has_no_session_token_usage_before_any_event() {
        let connection = setup();
        let listed = service(&connection)
            .list_agent_sessions(1)
            .expect("list sessions");
        assert_eq!(listed.sessions[0].token_input, None);
        assert_eq!(listed.sessions[0].token_output, None);
        assert_eq!(listed.sessions[0].token_cache, None);
    }

    #[test]
    fn received_zero_usage_is_distinct_from_missing_usage() {
        let connection = setup();
        AgentSessionRepository::new(&connection)
            .overwrite_session_token_usage(410, 0, 0, 0)
            .expect("overwrite zeros");

        let listed = service(&connection)
            .list_agent_sessions(1)
            .expect("list sessions");
        assert_eq!(listed.sessions[0].token_input, Some(0));
        assert_eq!(listed.sessions[0].token_output, Some(0));
        assert_eq!(listed.sessions[0].token_cache, Some(0));
    }

    #[test]
    fn codex_total_overwrite_replaces_list_item_totals_instead_of_adding() {
        let connection = setup();
        let repository = AgentSessionRepository::new(&connection);
        repository
            .overwrite_session_token_usage(410, 1_100, 300, 400)
            .expect("first overwrite");
        repository
            .overwrite_session_token_usage(410, 2_000, 500, 100)
            .expect("second overwrite");

        let listed = service(&connection)
            .list_agent_sessions(1)
            .expect("list sessions");
        assert_eq!(listed.sessions[0].token_input, Some(2_000));
        assert_eq!(listed.sessions[0].token_output, Some(500));
        assert_eq!(listed.sessions[0].token_cache, Some(100));
    }

    #[test]
    fn usage_updated_event_overwrites_list_item_session_tokens() {
        let connection = setup();
        let persisted = super::persist_session_token_usage(
            &AgentSessionRepository::new(&connection),
            410,
            &crate::types::agent_session_stream::AgentStreamEvent::UsageUpdated {
                usage: crate::types::agent_session_stream::AgentUsage {
                    input_tokens: Some(100),
                    output_tokens: Some(20),
                    context_window_max_tokens: Some(200_000),
                    context_window_used_tokens: Some(120),
                    session_token_input: Some(1_100),
                    session_token_output: Some(300),
                    session_token_cache: Some(400),
                },
            },
        )
        .expect("persist usage event");
        assert!(persisted);

        let listed = service(&connection)
            .list_agent_sessions(1)
            .expect("list sessions");
        assert_eq!(listed.sessions[0].token_input, Some(1_100));
        assert_eq!(listed.sessions[0].token_output, Some(300));
        assert_eq!(listed.sessions[0].token_cache, Some(400));
    }

    #[test]
    fn codex_total_payload_persists_onto_list_item() {
        let connection = setup();
        let snapshot =
            crate::agent::session_token_usage::normalize_codex_token_usage(&serde_json::json!({
                "last": {
                    "input_tokens": 100,
                    "cached_input_tokens": 20,
                    "output_tokens": 30,
                },
                "total": {
                    "input_tokens": 1_500,
                    "cached_input_tokens": 400,
                    "output_tokens": 300,
                },
            }))
            .expect("normalize total");
        let persisted = crate::agent::session_token_usage::persist_session_token_usage(
            &AgentSessionRepository::new(&connection),
            410,
            &crate::types::agent_session_stream::AgentStreamEvent::UsageUpdated {
                usage: crate::types::agent_session_stream::AgentUsage {
                    input_tokens: Some(100),
                    output_tokens: Some(30),
                    context_window_max_tokens: Some(200_000),
                    context_window_used_tokens: Some(130),
                    session_token_input: Some(snapshot.input),
                    session_token_output: Some(snapshot.output),
                    session_token_cache: Some(snapshot.cache),
                },
            },
        )
        .expect("persist normalized usage");
        assert!(persisted);

        let listed = service(&connection)
            .list_agent_sessions(1)
            .expect("list sessions");
        assert_eq!(listed.sessions[0].token_input, Some(1_100));
        assert_eq!(listed.sessions[0].token_output, Some(300));
        assert_eq!(listed.sessions[0].token_cache, Some(400));
    }
}
