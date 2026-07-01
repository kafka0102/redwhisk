use rusqlite::{params, Connection, OptionalExtension};

use crate::types::project_label::ProjectLabelScope;

pub struct ProjectLabelRepository<'connection> {
    connection: &'connection Connection,
}

impl<'connection> ProjectLabelRepository<'connection> {
    pub fn new(connection: &'connection Connection) -> Self {
        Self { connection }
    }

    pub fn list_labels_by_scope(
        &self,
        scope: &ProjectLabelScope,
        project_id: Option<i64>,
    ) -> rusqlite::Result<Vec<ProjectLabelRow>> {
        match scope {
            ProjectLabelScope::Global => {
                let mut statement = self.connection.prepare(
                    "SELECT project_labels.id,
                            project_labels.name,
                            project_labels.scope,
                            project_labels.project_id,
                            project_labels.color,
                            project_labels.workflow_skill,
                            project_labels.del
                     FROM project_labels
                     WHERE project_labels.scope = 'global'
                       AND project_labels.del = 0
                     ORDER BY project_labels.id ASC",
                )?;
                let rows = statement
                    .query_map([], project_label_from_row)?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            }
            ProjectLabelScope::Project => {
                let mut statement = self.connection.prepare(
                    "SELECT project_labels.id,
                            project_labels.name,
                            project_labels.scope,
                            project_labels.project_id,
                            project_labels.color,
                            project_labels.workflow_skill,
                            project_labels.del
                     FROM project_labels
                     WHERE project_labels.scope = 'project'
                       AND project_labels.project_id = ?1
                       AND project_labels.del = 0
                     ORDER BY project_labels.id ASC",
                )?;
                let rows = statement
                    .query_map(params![project_id], project_label_from_row)?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            }
        }
    }

    pub fn find_label_by_id(&self, id: i64) -> rusqlite::Result<Option<ProjectLabelRow>> {
        self.connection
            .query_row(
                "SELECT project_labels.id,
                        project_labels.name,
                        project_labels.scope,
                        project_labels.project_id,
                        project_labels.color,
                        project_labels.workflow_skill,
                        project_labels.del
                 FROM project_labels
                 WHERE project_labels.id = ?1",
                params![id],
                project_label_from_row,
            )
            .optional()
    }

    pub fn find_duplicate_name(
        &self,
        name: &str,
        scope: &ProjectLabelScope,
        project_id: Option<i64>,
        excluding_id: Option<i64>,
    ) -> rusqlite::Result<Option<ProjectLabelRow>> {
        match scope {
            ProjectLabelScope::Project => self
                .connection
                .query_row(
                    "SELECT project_labels.id,
                            project_labels.name,
                            project_labels.scope,
                            project_labels.project_id,
                            project_labels.color,
                            project_labels.workflow_skill,
                            project_labels.del
                     FROM project_labels
                     WHERE project_labels.del = 0
                       AND project_labels.scope = 'project'
                       AND project_labels.project_id = ?2
                       AND lower(project_labels.name) = lower(?1)
                       AND (?3 IS NULL OR project_labels.id != ?3)
                     LIMIT 1",
                    params![name, project_id, excluding_id],
                    project_label_from_row,
                )
                .optional(),
            ProjectLabelScope::Global => self
                .connection
                .query_row(
                    "SELECT project_labels.id,
                            project_labels.name,
                            project_labels.scope,
                            project_labels.project_id,
                            project_labels.color,
                            project_labels.workflow_skill,
                            project_labels.del
                     FROM project_labels
                     WHERE project_labels.del = 0
                       AND lower(project_labels.name) = lower(?1)
                       AND (?2 IS NULL OR project_labels.id != ?2)
                     LIMIT 1",
                    params![name, excluding_id],
                    project_label_from_row,
                )
                .optional(),
        }
    }

    pub fn save_label(
        &self,
        id: Option<i64>,
        name: &str,
        scope: &ProjectLabelScope,
        project_id: Option<i64>,
        color: &str,
        workflow_skill: Option<&str>,
    ) -> rusqlite::Result<ProjectLabelRow> {
        let scope_str = scope_to_str(scope);

        match id {
            Some(id) => {
                self.connection.execute(
                    "UPDATE project_labels
                     SET name = ?1,
                         scope = ?2,
                         project_id = ?3,
                         color = ?4,
                         workflow_skill = ?5,
                         del = 0,
                         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                     WHERE id = ?6",
                    params![name, scope_str, project_id, color, workflow_skill, id],
                )?;
                self.find_label_by_id(id)?
                    .ok_or(rusqlite::Error::QueryReturnedNoRows)
            }
            None => {
                self.connection.execute(
                    "INSERT INTO project_labels (
                        name,
                        scope,
                        project_id,
                        color,
                        workflow_skill,
                        del
                     ) VALUES (?1, ?2, ?3, ?4, ?5, 0)",
                    params![name, scope_str, project_id, color, workflow_skill],
                )?;
                self.find_label_by_id(self.connection.last_insert_rowid())?
                    .ok_or(rusqlite::Error::QueryReturnedNoRows)
            }
        }
    }

    pub fn soft_delete_label(&self, id: i64) -> rusqlite::Result<bool> {
        let affected = self.connection.execute(
            "UPDATE project_labels SET del = 1 WHERE id = ?1 AND del = 0",
            params![id],
        )?;
        Ok(affected > 0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectLabelRow {
    pub id: i64,
    pub name: String,
    pub scope: ProjectLabelScope,
    pub project_id: Option<i64>,
    pub color: String,
    pub workflow_skill: Option<String>,
    pub del: i64,
}

fn project_label_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectLabelRow> {
    Ok(ProjectLabelRow {
        id: row.get(0)?,
        name: row.get(1)?,
        scope: scope_from_str(&row.get::<_, String>(2)?)?,
        project_id: row.get(3)?,
        color: row.get(4)?,
        workflow_skill: row.get(5)?,
        del: row.get(6)?,
    })
}

fn scope_to_str(scope: &ProjectLabelScope) -> &'static str {
    match scope {
        ProjectLabelScope::Project => "project",
        ProjectLabelScope::Global => "global",
    }
}

fn scope_from_str(value: &str) -> rusqlite::Result<ProjectLabelScope> {
    match value {
        "project" => Ok(ProjectLabelScope::Project),
        "global" => Ok(ProjectLabelScope::Global),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}
