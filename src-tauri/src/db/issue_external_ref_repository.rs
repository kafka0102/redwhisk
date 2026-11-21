use rusqlite::{params, Connection, OptionalExtension};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IssueMirrorProjection {
    pub source: String,
    pub provider: Option<String>,
    pub external_number: Option<i64>,
    pub remote_state: Option<String>,
    pub remote_labels_json: Option<String>,
    pub sync_status: Option<String>,
    pub remote_closed_while_running: bool,
    pub remote_reopened: bool,
    pub remote_assignees_json: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredIssueIdentity {
    pub issue_id: i64,
    pub deleted: bool,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewIssueExternalRef<'value> {
    pub issue_id: i64,
    pub project_id: i64,
    pub provider: &'value str,
    pub host: &'value str,
    pub repo: &'value str,
    pub external_id: &'value str,
    pub external_number: i64,
    pub external_url: &'value str,
    pub remote_state: &'value str,
    pub author_login: Option<&'value str>,
    pub assignees_json: &'value str,
    pub labels_json: &'value str,
    pub remote_updated_at: i64,
    pub synced_at: i64,
    pub sync_status: &'value str,
    pub remote_closed_while_running: bool,
    pub remote_reopened: bool,
}

pub struct IssueExternalRefRepository<'connection> {
    connection: &'connection Connection,
}

impl<'connection> IssueExternalRefRepository<'connection> {
    pub fn new(connection: &'connection Connection) -> Self {
        Self { connection }
    }

    pub fn sync_clock(&self, project_id: i64) -> rusqlite::Result<(Option<i64>, Option<String>)> {
        self.connection
            .query_row(
                "SELECT last_issue_synced_at, last_issue_sync_error FROM projects WHERE id = ?1",
                params![project_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map(|row| row.unwrap_or((None, None)))
    }

    pub fn mark_sync_success(&self, project_id: i64, synced_at: i64) -> rusqlite::Result<()> {
        self.connection.execute(
            "UPDATE projects
             SET last_issue_synced_at = ?1, last_issue_sync_error = NULL
             WHERE id = ?2",
            params![synced_at, project_id],
        )?;
        Ok(())
    }

    pub fn mark_sync_error(&self, project_id: i64, error_code: &str) -> rusqlite::Result<()> {
        self.connection.execute(
            "UPDATE projects SET last_issue_sync_error = ?1 WHERE id = ?2",
            params![error_code, project_id],
        )?;
        Ok(())
    }

    pub fn find_by_external_id(
        &self,
        provider: &str,
        host: &str,
        external_id: &str,
    ) -> rusqlite::Result<Option<i64>> {
        self.connection
            .query_row(
                "SELECT issue_id FROM issue_external_refs
                 WHERE provider = ?1 AND host = ?2 AND external_id = ?3",
                params![provider, host, external_id],
                |row| row.get(0),
            )
            .optional()
    }

    pub fn find_by_external_number(
        &self,
        project_id: i64,
        provider: &str,
        host: &str,
        repo: &str,
        external_number: i64,
    ) -> rusqlite::Result<Option<i64>> {
        self.connection
            .query_row(
                "SELECT issue_id FROM issue_external_refs
                 WHERE project_id = ?1 AND provider = ?2 AND host = ?3
                   AND repo = ?4 AND external_number = ?5",
                params![project_id, provider, host, repo, external_number],
                |row| row.get(0),
            )
            .optional()
    }

    pub fn issue_identity(&self, issue_id: i64) -> rusqlite::Result<Option<StoredIssueIdentity>> {
        self.connection
            .query_row(
                "SELECT id, del, status FROM issues WHERE id = ?1",
                params![issue_id],
                |row| {
                    Ok(StoredIssueIdentity {
                        issue_id: row.get(0)?,
                        deleted: row.get::<_, i64>(1)? != 0,
                        status: row.get(2)?,
                    })
                },
            )
            .optional()
    }

    pub fn issue_count(&self, project_id: i64) -> rusqlite::Result<i64> {
        self.connection.query_row(
            "SELECT COUNT(*) FROM issues WHERE project_id = ?1",
            params![project_id],
            |row| row.get(0),
        )
    }

    pub fn status_action_count(&self, issue_id: i64) -> rusqlite::Result<i64> {
        self.connection.query_row(
            "SELECT COUNT(*) FROM issue_actions
             WHERE issue_id = ?1 AND action_type = 'issue_status_changed'",
            params![issue_id],
            |row| row.get(0),
        )
    }

    pub fn remote_status_action_count(&self, issue_id: i64) -> rusqlite::Result<i64> {
        self.connection.query_row(
            "SELECT COUNT(*) FROM issue_actions
             WHERE issue_id = ?1
               AND action_type = 'issue_status_changed'
               AND actor_kind = 'remote'",
            params![issue_id],
            |row| row.get(0),
        )
    }

    pub fn set_source_remote(&self, issue_id: i64) -> rusqlite::Result<()> {
        self.connection.execute(
            "UPDATE issues SET source = 'remote' WHERE id = ?1",
            params![issue_id],
        )?;
        Ok(())
    }

    pub fn update_visible_text(
        &self,
        issue_id: i64,
        title: &str,
        description: &str,
    ) -> rusqlite::Result<()> {
        self.connection.execute(
            "UPDATE issues
             SET title = ?1,
                 description = ?2,
                 updated_at = MAX(
                   updated_at + 1,
                   CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
                 )
             WHERE id = ?3 AND del = 0",
            params![title, description, issue_id],
        )?;
        Ok(())
    }

    pub fn insert_ref(&self, row: &NewIssueExternalRef<'_>) -> rusqlite::Result<()> {
        self.connection.execute(
            "INSERT INTO issue_external_refs (
                issue_id, project_id, provider, host, repo, external_id, external_number,
                external_url, remote_state, remote_author_login, remote_assignees_json,
                remote_labels_json, remote_updated_at, synced_at, sync_status,
                remote_closed_while_running, remote_reopened
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            params![
                row.issue_id,
                row.project_id,
                row.provider,
                row.host,
                row.repo,
                row.external_id,
                row.external_number,
                row.external_url,
                row.remote_state,
                row.author_login,
                row.assignees_json,
                row.labels_json,
                row.remote_updated_at,
                row.synced_at,
                row.sync_status,
                bool_to_int(row.remote_closed_while_running),
                bool_to_int(row.remote_reopened),
            ],
        )?;
        Ok(())
    }

    pub fn update_ref(&self, row: &NewIssueExternalRef<'_>) -> rusqlite::Result<()> {
        self.connection.execute(
            "UPDATE issue_external_refs
             SET external_id = ?1,
                 external_number = ?2,
                 repo = ?3,
                 external_url = ?4,
                 remote_state = ?5,
                 remote_author_login = ?6,
                 remote_assignees_json = ?7,
                 remote_labels_json = ?8,
                 remote_updated_at = ?9,
                 synced_at = ?10,
                 sync_status = ?11,
                 remote_closed_while_running = ?12,
                 remote_reopened = ?13
             WHERE issue_id = ?14",
            params![
                row.external_id,
                row.external_number,
                row.repo,
                row.external_url,
                row.remote_state,
                row.author_login,
                row.assignees_json,
                row.labels_json,
                row.remote_updated_at,
                row.synced_at,
                row.sync_status,
                bool_to_int(row.remote_closed_while_running),
                bool_to_int(row.remote_reopened),
                row.issue_id,
            ],
        )?;
        Ok(())
    }

    pub fn mark_ref_error(&self, issue_id: i64) -> rusqlite::Result<()> {
        self.connection.execute(
            "UPDATE issue_external_refs SET sync_status = 'error' WHERE issue_id = ?1",
            params![issue_id],
        )?;
        Ok(())
    }

    pub fn insert_remote_status_action(
        &self,
        issue_id: i64,
        from_status: &str,
        to_status: &str,
        created_at: i64,
    ) -> rusqlite::Result<()> {
        let payload = format!(r#"{{"from":"{from_status}","to":"{to_status}"}}"#);
        self.connection.execute(
            "INSERT INTO issue_actions (
                issue_id, action_type, payload_json, created_at, actor_kind
             ) VALUES (?1, 'issue_status_changed', ?2, ?3, 'remote')",
            params![issue_id, payload, created_at],
        )?;
        Ok(())
    }

    pub fn linked_session_count(&self, project_id: i64, issue_id: i64) -> rusqlite::Result<i64> {
        self.connection.query_row(
            "SELECT COUNT(*) FROM agent_sessions
             WHERE issue_id = ?1 AND project_id = ?2 AND del = 0",
            params![issue_id, project_id],
            |row| row.get(0),
        )
    }
    pub fn projections_for_project(
        &self,
        project_id: i64,
    ) -> rusqlite::Result<Vec<(i64, IssueMirrorProjection)>> {
        let mut statement = self.connection.prepare(
            "SELECT issues.id, issues.source, refs.provider, refs.external_number, refs.remote_state,
                    refs.remote_labels_json, refs.sync_status, refs.remote_closed_while_running,
                    refs.remote_reopened, refs.remote_assignees_json
             FROM issues
             LEFT JOIN issue_external_refs AS refs ON refs.issue_id = issues.id
             WHERE issues.project_id = ?1",
        )?;
        let rows = statement.query_map(params![project_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                IssueMirrorProjection {
                    source: row.get(1)?,
                    provider: row.get(2)?,
                    external_number: row.get(3)?,
                    remote_state: row.get(4)?,
                    remote_labels_json: row.get(5)?,
                    sync_status: row.get(6)?,
                    remote_closed_while_running: row.get::<_, Option<i64>>(7)?.unwrap_or(0) != 0,
                    remote_reopened: row.get::<_, Option<i64>>(8)?.unwrap_or(0) != 0,
                    remote_assignees_json: row.get(9)?,
                },
            ))
        })?;
        rows.collect()
    }
}

fn bool_to_int(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

pub fn normalize_forge_host(host_url: &str) -> String {
    let trimmed = host_url.trim().trim_end_matches('/');
    let without_protocol = trimmed.split("://").nth(1).unwrap_or(trimmed);
    without_protocol
        .split('/')
        .next()
        .unwrap_or(without_protocol)
        .to_ascii_lowercase()
}
