use rusqlite::{params, Connection, OptionalExtension};

use crate::types::agent_profile::AgentType;

pub struct AgentProfileRepository<'connection> {
    connection: &'connection Connection,
}

impl<'connection> AgentProfileRepository<'connection> {
    pub fn new(connection: &'connection Connection) -> Self {
        Self { connection }
    }

    pub fn list_profiles(&self) -> rusqlite::Result<Vec<AgentProfileRow>> {
        let mut statement = self.connection.prepare(
            "SELECT id, name, agent_type, command, default_args, default_skill, prompt_template, enabled
             FROM agent_profiles
             ORDER BY id ASC",
        )?;
        let rows = statement
            .query_map([], agent_profile_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(rows)
    }

    pub fn find_profile_by_id(&self, id: i64) -> rusqlite::Result<Option<AgentProfileRow>> {
        self.connection
            .query_row(
                "SELECT id, name, agent_type, command, default_args, default_skill, prompt_template, enabled
                 FROM agent_profiles
                 WHERE id = ?1",
                params![id],
                agent_profile_from_row,
            )
            .optional()
    }

    pub fn save_profile(
        &self,
        id: Option<i64>,
        name: &str,
        agent_type: AgentType,
        command: &str,
        default_args: &str,
        default_skill: &str,
        prompt_template: &str,
        enabled: bool,
    ) -> rusqlite::Result<AgentProfileRow> {
        let agent_type = agent_type_to_str(&agent_type);
        let enabled = bool_to_sqlite(enabled);

        match id {
            Some(id) => {
                self.connection.execute(
                    "UPDATE agent_profiles
                     SET name = ?1,
                         agent_type = ?2,
                         command = ?3,
                         default_args = ?4,
                         default_skill = ?5,
                         prompt_template = ?6,
                         enabled = ?7
                     WHERE id = ?8",
                    params![
                        name,
                        agent_type,
                        command,
                        default_args,
                        default_skill,
                        prompt_template,
                        enabled,
                        id
                    ],
                )?;

                self.find_profile_by_id(id)?
                    .ok_or(rusqlite::Error::QueryReturnedNoRows)
            }
            None => {
                self.connection.execute(
                    "INSERT INTO agent_profiles (
                       name,
                       agent_type,
                       command,
                       default_args,
                       default_skill,
                       prompt_template,
                       enabled
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        name,
                        agent_type,
                        command,
                        default_args,
                        default_skill,
                        prompt_template,
                        enabled
                    ],
                )?;

                let id = self.connection.last_insert_rowid();
                self.find_profile_by_id(id)?
                    .ok_or(rusqlite::Error::QueryReturnedNoRows)
            }
        }
    }

    pub fn list_project_agent_overrides(
        &self,
        project_id: i64,
    ) -> rusqlite::Result<Vec<ProjectAgentOverrideRow>> {
        let mut statement = self.connection.prepare(
            "SELECT id, project_id, agent_profile_id, default_args, default_skill, prompt_template, enabled
             FROM project_agent_overrides
             WHERE project_id = ?1
             ORDER BY agent_profile_id ASC, id ASC",
        )?;
        let rows = statement
            .query_map(params![project_id], project_override_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(rows)
    }

    pub fn find_project_agent_override(
        &self,
        project_id: i64,
        agent_profile_id: i64,
    ) -> rusqlite::Result<Option<ProjectAgentOverrideRow>> {
        self.connection
            .query_row(
                "SELECT id, project_id, agent_profile_id, default_args, default_skill, prompt_template, enabled
                 FROM project_agent_overrides
                 WHERE project_id = ?1 AND agent_profile_id = ?2",
                params![project_id, agent_profile_id],
                project_override_from_row,
            )
            .optional()
    }

    pub fn save_project_agent_override(
        &self,
        project_id: i64,
        agent_profile_id: i64,
        default_args: &str,
        default_skill: &str,
        prompt_template: &str,
        enabled: bool,
    ) -> rusqlite::Result<ProjectAgentOverrideRow> {
        let enabled = bool_to_sqlite(enabled);

        if let Some(existing) = self.find_project_agent_override(project_id, agent_profile_id)? {
            self.connection.execute(
                "UPDATE project_agent_overrides
                 SET default_args = ?1,
                     default_skill = ?2,
                     prompt_template = ?3,
                     enabled = ?4
                 WHERE id = ?5",
                params![
                    default_args,
                    default_skill,
                    prompt_template,
                    enabled,
                    existing.id
                ],
            )?;
        } else {
            self.connection.execute(
                "INSERT INTO project_agent_overrides (
                   project_id,
                   agent_profile_id,
                   default_args,
                   default_skill,
                   prompt_template,
                   enabled
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    project_id,
                    agent_profile_id,
                    default_args,
                    default_skill,
                    prompt_template,
                    enabled
                ],
            )?;
        }

        self.find_project_agent_override(project_id, agent_profile_id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentProfileRow {
    pub id: i64,
    pub name: String,
    pub agent_type: AgentType,
    pub command: String,
    pub default_args: String,
    pub default_skill: String,
    pub prompt_template: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectAgentOverrideRow {
    pub id: i64,
    pub project_id: i64,
    pub agent_profile_id: i64,
    pub default_args: String,
    pub default_skill: String,
    pub prompt_template: String,
    pub enabled: bool,
}

fn agent_profile_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentProfileRow> {
    Ok(AgentProfileRow {
        id: row.get(0)?,
        name: row.get(1)?,
        agent_type: agent_type_from_str(&row.get::<_, String>(2)?)?,
        command: row.get(3)?,
        default_args: row.get(4)?,
        default_skill: row.get(5)?,
        prompt_template: row.get(6)?,
        enabled: sqlite_to_bool(row.get(7)?),
    })
}

fn project_override_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectAgentOverrideRow> {
    Ok(ProjectAgentOverrideRow {
        id: row.get(0)?,
        project_id: row.get(1)?,
        agent_profile_id: row.get(2)?,
        default_args: row.get(3)?,
        default_skill: row.get(4)?,
        prompt_template: row.get(5)?,
        enabled: sqlite_to_bool(row.get(6)?),
    })
}

fn agent_type_to_str(agent_type: &AgentType) -> &'static str {
    match agent_type {
        AgentType::Codex => "codex",
    }
}

fn agent_type_from_str(value: &str) -> rusqlite::Result<AgentType> {
    match value {
        "codex" => Ok(AgentType::Codex),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn bool_to_sqlite(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn sqlite_to_bool(value: i64) -> bool {
    value != 0
}
