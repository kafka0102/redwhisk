use rusqlite::{params, Connection, OptionalExtension};
use serde_json;

use crate::types::agent_skill::AgentSkillScope;
use crate::types::saved_agent_skill::SavedAgentSkillPath;

pub struct SavedAgentSkillRepository<'connection> {
    connection: &'connection Connection,
}

impl<'connection> SavedAgentSkillRepository<'connection> {
    pub fn new(connection: &'connection Connection) -> Self {
        Self { connection }
    }

    pub fn list_skills(
        &self,
        scope_filter: Option<&AgentSkillScope>,
        project_id_filter: Option<i64>,
    ) -> rusqlite::Result<Vec<SavedAgentSkillRow>> {
        let mut sql = "SELECT id, name, scope, project_id, skill_paths_json, del
                       FROM saved_agent_skills
                       WHERE del = 0".to_string();
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        let mut param_idx = 1;

        if let Some(scope) = scope_filter {
            sql.push_str(&format!(" AND scope = ?{}", param_idx));
            params_vec.push(Box::new(scope_to_str(scope)));
            param_idx += 1;
        }

        if let Some(project_id) = project_id_filter {
            if scope_filter.is_none() || scope_filter == Some(&AgentSkillScope::Project) {
                sql.push_str(&format!(" AND (scope != 'project' OR project_id = ?{})", param_idx));
                params_vec.push(Box::new(project_id));
            }
        }

        sql.push_str(" ORDER BY id ASC");

        let mut statement = self.connection.prepare(&sql)?;
        let params_slice = params_vec.iter().map(|p| p.as_ref() as &dyn rusqlite::ToSql).collect::<Vec<_>>();
        let rows = statement
            .query_map(params_slice.as_slice(), saved_agent_skill_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn find_skill_by_id(&self, id: i64) -> rusqlite::Result<Option<SavedAgentSkillRow>> {
        self.connection
            .query_row(
                "SELECT id, name, scope, project_id, skill_paths_json, del
                 FROM saved_agent_skills
                 WHERE id = ?1",
                params![id],
                saved_agent_skill_from_row,
            )
            .optional()
    }

    pub fn find_duplicate_name(
        &self,
        name: &str,
        scope: &AgentSkillScope,
        project_id: Option<i64>,
        excluding_id: Option<i64>,
    ) -> rusqlite::Result<Option<SavedAgentSkillRow>> {
        match scope {
            AgentSkillScope::Project => self
                .connection
                .query_row(
                    "SELECT id, name, scope, project_id, skill_paths_json, del
                     FROM saved_agent_skills
                     WHERE del = 0
                       AND scope = 'project'
                       AND project_id = ?2
                       AND lower(name) = lower(?1)
                       AND (?3 IS NULL OR id != ?3)
                     LIMIT 1",
                    params![name, project_id, excluding_id],
                    saved_agent_skill_from_row,
                )
                .optional(),
            AgentSkillScope::Global => self
                .connection
                .query_row(
                    "SELECT id, name, scope, project_id, skill_paths_json, del
                     FROM saved_agent_skills
                     WHERE del = 0
                       AND scope = 'global'
                       AND lower(name) = lower(?1)
                       AND (?2 IS NULL OR id != ?2)
                     LIMIT 1",
                    params![name, excluding_id],
                    saved_agent_skill_from_row,
                )
                .optional(),
        }
    }

    pub fn save_skill(
        &self,
        id: Option<i64>,
        name: &str,
        scope: &AgentSkillScope,
        project_id: Option<i64>,
        skill_paths: &[SavedAgentSkillPath],
    ) -> rusqlite::Result<SavedAgentSkillRow> {
        let scope_str = scope_to_str(scope);
        let skill_paths_json = serde_json::to_string(skill_paths)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        match id {
            Some(id) => {
                self.connection.execute(
                    "UPDATE saved_agent_skills
                     SET name = ?1,
                         scope = ?2,
                         project_id = ?3,
                         skill_paths_json = ?4,
                         del = 0,
                         updated_at = strftime('%s', 'now') * 1000
                     WHERE id = ?5",
                    params![
                        name,
                        scope_str,
                        project_id,
                        skill_paths_json,
                        id
                    ],
                )?;
                self.find_skill_by_id(id)?
                    .ok_or(rusqlite::Error::QueryReturnedNoRows)
            }
            None => {
                self.connection.execute(
                    "INSERT INTO saved_agent_skills (
                        name,
                        scope,
                        project_id,
                        skill_paths_json,
                        del,
                        created_at,
                        updated_at
                     ) VALUES (?1, ?2, ?3, ?4, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000)",
                    params![
                        name,
                        scope_str,
                        project_id,
                        skill_paths_json
                    ],
                )?;
                self.find_skill_by_id(self.connection.last_insert_rowid())?
                    .ok_or(rusqlite::Error::QueryReturnedNoRows)
            }
        }
    }

    pub fn soft_delete_skill(&self, id: i64) -> rusqlite::Result<bool> {
        let affected = self.connection.execute(
            "UPDATE saved_agent_skills SET del = 1 WHERE id = ?1 AND del = 0",
            params![id],
        )?;
        Ok(affected > 0)
    }
}

#[derive(Debug, Clone)]
pub struct SavedAgentSkillRow {
    pub id: i64,
    pub name: String,
    pub scope: AgentSkillScope,
    pub project_id: Option<i64>,
    pub skill_paths: Vec<SavedAgentSkillPath>,
    pub del: i64,
}

fn saved_agent_skill_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SavedAgentSkillRow> {
    let skill_paths_json: String = row.get(4)?;
    let skill_paths: Vec<SavedAgentSkillPath> = serde_json::from_str(&skill_paths_json)
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(
            4,
            rusqlite::types::Type::Text,
            Box::new(e)
        ))?;

    Ok(SavedAgentSkillRow {
        id: row.get(0)?,
        name: row.get(1)?,
        scope: scope_from_str(&row.get::<_, String>(2)?)?,
        project_id: row.get(3)?,
        skill_paths,
        del: row.get(5)?,
    })
}

fn scope_to_str(scope: &AgentSkillScope) -> &'static str {
    match scope {
        AgentSkillScope::Project => "project",
        AgentSkillScope::Global => "global",
    }
}

fn scope_from_str(value: &str) -> rusqlite::Result<AgentSkillScope> {
    match value {
        "project" => Ok(AgentSkillScope::Project),
        "global" => Ok(AgentSkillScope::Global),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}
