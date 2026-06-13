use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::types::issue::{IssueAttachmentKind, IssueAttachmentRecord};

pub struct IssueAttachmentRepository<'connection> {
    connection: &'connection Connection,
}

impl<'connection> IssueAttachmentRepository<'connection> {
    pub fn new(connection: &'connection Connection) -> Self {
        Self { connection }
    }

    pub fn list_by_issue_id(&self, issue_id: i64) -> rusqlite::Result<Vec<IssueAttachmentRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT
                id,
                issue_id,
                display_name,
                stored_name,
                relative_path,
                absolute_path,
                mime_type,
                file_size,
                kind,
                is_previewable,
                created_at
             FROM issue_attachments
             WHERE issue_id = ?1
             ORDER BY created_at ASC, id ASC",
        )?;

        let attachments = statement
            .query_map(params![issue_id], issue_attachment_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(attachments)
    }

    pub fn find_by_id(
        &self,
        attachment_id: i64,
    ) -> rusqlite::Result<Option<IssueAttachmentRecord>> {
        self.connection
            .query_row(
                "SELECT
                    id,
                    issue_id,
                    display_name,
                    stored_name,
                    relative_path,
                    absolute_path,
                    mime_type,
                    file_size,
                    kind,
                    is_previewable,
                    created_at
                 FROM issue_attachments
                 WHERE id = ?1",
                params![attachment_id],
                issue_attachment_from_row,
            )
            .optional()
    }

    pub fn insert_in_transaction(
        transaction: &Transaction<'_>,
        issue_id: i64,
        display_name: &str,
        stored_name: &str,
        relative_path: &str,
        absolute_path: &str,
        mime_type: Option<&str>,
        file_size: i64,
        kind: IssueAttachmentKind,
        is_previewable: bool,
        created_at: i64,
    ) -> rusqlite::Result<IssueAttachmentRecord> {
        transaction.execute(
            "INSERT INTO issue_attachments (
                issue_id,
                display_name,
                stored_name,
                relative_path,
                absolute_path,
                mime_type,
                file_size,
                kind,
                is_previewable,
                created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                issue_id,
                display_name,
                stored_name,
                relative_path,
                absolute_path,
                mime_type,
                file_size,
                issue_attachment_kind_to_str(&kind),
                if is_previewable { 1 } else { 0 },
                created_at,
            ],
        )?;

        let attachment_id = transaction.last_insert_rowid();
        find_by_id_on_connection(transaction, attachment_id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn delete_by_ids_in_transaction(
        transaction: &Transaction<'_>,
        attachment_ids: &[i64],
    ) -> rusqlite::Result<()> {
        let mut statement = transaction.prepare("DELETE FROM issue_attachments WHERE id = ?1")?;
        for attachment_id in attachment_ids {
            statement.execute(params![attachment_id])?;
        }
        Ok(())
    }
}

fn find_by_id_on_connection(
    connection: &Connection,
    attachment_id: i64,
) -> rusqlite::Result<Option<IssueAttachmentRecord>> {
    connection
        .query_row(
            "SELECT
                id,
                issue_id,
                display_name,
                stored_name,
                relative_path,
                absolute_path,
                mime_type,
                file_size,
                kind,
                is_previewable,
                created_at
             FROM issue_attachments
             WHERE id = ?1",
            params![attachment_id],
            issue_attachment_from_row,
        )
        .optional()
}

fn issue_attachment_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<IssueAttachmentRecord> {
    Ok(IssueAttachmentRecord {
        id: row.get(0)?,
        issue_id: row.get(1)?,
        display_name: row.get(2)?,
        stored_name: row.get(3)?,
        relative_path: row.get(4)?,
        absolute_path: row.get(5)?,
        mime_type: row.get(6)?,
        file_size: row.get(7)?,
        kind: issue_attachment_kind_from_str(&row.get::<_, String>(8)?)?,
        is_previewable: row.get::<_, i64>(9)? != 0,
        created_at: row.get(10)?,
    })
}

fn issue_attachment_kind_from_str(value: &str) -> rusqlite::Result<IssueAttachmentKind> {
    match value {
        "image" => Ok(IssueAttachmentKind::Image),
        "pdf" => Ok(IssueAttachmentKind::Pdf),
        "word" => Ok(IssueAttachmentKind::Word),
        "text" => Ok(IssueAttachmentKind::Text),
        "generic" => Ok(IssueAttachmentKind::Generic),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn issue_attachment_kind_to_str(value: &IssueAttachmentKind) -> &'static str {
    match value {
        IssueAttachmentKind::Image => "image",
        IssueAttachmentKind::Pdf => "pdf",
        IssueAttachmentKind::Word => "word",
        IssueAttachmentKind::Text => "text",
        IssueAttachmentKind::Generic => "generic",
    }
}
