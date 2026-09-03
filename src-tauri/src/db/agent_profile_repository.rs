use rusqlite::{params, Connection, OptionalExtension};

use crate::types::agent_profile::{AgentScope, AgentType};

pub struct AgentProfileRepository<'connection> {
    connection: &'connection Connection,
}

impl<'connection> AgentProfileRepository<'connection> {
    pub fn new(connection: &'connection Connection) -> Self {
        Self { connection }
    }

    pub fn list_profiles_by_scope(
        &self,
        scope: &AgentScope,
        project_id: Option<i64>,
    ) -> rusqlite::Result<Vec<AgentProfileRow>> {
        match scope {
            AgentScope::Global => {
                let mut statement = self.connection.prepare(
                    "SELECT id, name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del, display_mode, enabled
                     FROM agent_profiles
                     WHERE scope = 'global' AND del = 0
                     ORDER BY id ASC",
                )?;
                let rows = statement
                    .query_map([], agent_profile_from_row)?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            }
            AgentScope::Project => {
                let mut statement = self.connection.prepare(
                    "SELECT id, name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del, display_mode, enabled
                     FROM agent_profiles
                     WHERE scope = 'project' AND project_id = ?1 AND del = 0
                     ORDER BY id ASC",
                )?;
                let rows = statement
                    .query_map(params![project_id], agent_profile_from_row)?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            }
        }
    }

    pub fn find_profile_by_id(&self, id: i64) -> rusqlite::Result<Option<AgentProfileRow>> {
        self.connection
            .query_row(
                "SELECT id, name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del, display_mode, enabled
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
        scope: &AgentScope,
        project_id: Option<i64>,
        mode: &str,
        dangerous: bool,
        default_skill: &str,
        prompt_template: &str,
        display_mode: &str,
        enabled: bool,
    ) -> rusqlite::Result<AgentProfileRow> {
        let agent_type_str = agent_type.as_db_str();
        let scope_str = scope_to_str(scope);
        let dangerous_int = bool_to_sqlite(dangerous);
        let enabled_int = bool_to_sqlite(enabled);

        match id {
            Some(id) => {
                self.connection.execute(
                    "UPDATE agent_profiles
                     SET name = ?1,
                         agent_type = ?2,
                         command = ?3,
                         scope = ?4,
                         project_id = ?5,
                         mode = ?6,
                         dangerous = ?7,
                         default_skill = ?8,
                         prompt_template = ?9,
                         del = 0,
                         display_mode = ?10,
                         enabled = ?11
                     WHERE id = ?12",
                    params![
                        name,
                        agent_type_str,
                        command,
                        scope_str,
                        project_id,
                        mode,
                        dangerous_int,
                        default_skill,
                        prompt_template,
                        display_mode,
                        enabled_int,
                        id
                    ],
                )?;

                self.find_profile_by_id(id)?
                    .ok_or(rusqlite::Error::QueryReturnedNoRows)
            }
            None => {
                self.connection.execute(
                    "INSERT INTO agent_profiles (
                       name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del, display_mode, enabled
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?11)",
                    params![
                        name,
                        agent_type_str,
                        command,
                        scope_str,
                        project_id,
                        mode,
                        dangerous_int,
                        default_skill,
                        prompt_template,
                        display_mode,
                        enabled_int
                    ],
                )?;

                let id = self.connection.last_insert_rowid();
                self.find_profile_by_id(id)?
                    .ok_or(rusqlite::Error::QueryReturnedNoRows)
            }
        }
    }

    pub fn soft_delete_profile(&self, id: i64) -> rusqlite::Result<bool> {
        let affected = self.connection.execute(
            "UPDATE agent_profiles SET del = 1 WHERE id = ?1 AND del = 0",
            params![id],
        )?;

        Ok(affected > 0)
    }

    /// 按 `agent_type` 是否存在任意记录（含软删 `del=1`），用于内置 agent 播种幂等判定。
    ///
    /// 见 ADR-0020：库中已有该类型记录（含软删）则不再自动播种，软删后重启不冒回。
    pub fn exists_profile_by_agent_type(&self, agent_type: AgentType) -> rusqlite::Result<bool> {
        let agent_type_str = agent_type.as_db_str();
        let count: i64 = self.connection.query_row(
            "SELECT COUNT(*) FROM agent_profiles WHERE agent_type = ?1",
            params![agent_type_str],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentProfileRow {
    pub id: i64,
    pub name: String,
    pub agent_type: AgentType,
    pub command: String,
    pub scope: AgentScope,
    pub project_id: Option<i64>,
    pub mode: String,
    pub dangerous: bool,
    pub default_skill: String,
    pub prompt_template: String,
    pub del: i64,
    pub display_mode: String,
    pub enabled: bool,
}

fn agent_profile_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentProfileRow> {
    Ok(AgentProfileRow {
        id: row.get(0)?,
        name: row.get(1)?,
        agent_type: AgentType::from_db_str(&row.get::<_, String>(2)?)
            .ok_or(rusqlite::Error::InvalidQuery)?,
        command: row.get(3)?,
        scope: scope_from_str(&row.get::<_, String>(4)?)?,
        project_id: row.get(5)?,
        mode: row.get(6)?,
        dangerous: sqlite_to_bool(row.get(7)?),
        default_skill: row.get(8)?,
        prompt_template: row.get(9)?,
        del: row.get(10)?,
        display_mode: row.get(11)?,
        enabled: sqlite_to_bool(row.get(12)?),
    })
}

fn scope_to_str(scope: &AgentScope) -> &'static str {
    match scope {
        AgentScope::Project => "project",
        AgentScope::Global => "global",
    }
}

fn scope_from_str(value: &str) -> rusqlite::Result<AgentScope> {
    match value {
        "project" => Ok(AgentScope::Project),
        "global" => Ok(AgentScope::Global),
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

#[cfg(test)]
#[path = "agent_profile_repository_tests.rs"]
mod tests;
