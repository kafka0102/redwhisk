use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use super::time::current_epoch_millis;
use super::validation::issue_database_error;
use crate::db::issue_attachment_repository::IssueAttachmentRepository;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::{
    IssueAttachmentInput, IssueAttachmentKind, IssueAttachmentRecord,
    SaveIssueAttachmentDraftInput, SaveIssueAttachmentDraftResult,
};

pub(super) struct NewAttachmentPersistence {
    pub(super) temp_token: String,
    pub(super) attachment_id: i64,
}

pub(crate) struct AttachmentAnalysis {
    pub(crate) kind: IssueAttachmentKind,
    pub(crate) is_previewable: bool,
}

pub(super) struct ResolvedAttachmentSource {
    pub(super) attachment_id: Option<i64>,
    pub(super) display_name: String,
    pub(super) absolute_path: String,
    pub(super) kind: IssueAttachmentKind,
    pub(super) is_previewable: bool,
}

pub(super) fn persist_new_attachments(
    transaction: &rusqlite::Transaction<'_>,
    data_dir: &Path,
    issue_id: i64,
    issue_number: i64,
    attachments: &[IssueAttachmentInput],
) -> Result<(Vec<NewAttachmentPersistence>, Vec<PathBuf>), CommandError> {
    let mut persisted = Vec::new();
    let mut created_files = Vec::new();

    for attachment in attachments {
        let Some(source_path) = attachment.source_path.as_ref() else {
            continue;
        };
        let Some(temp_token) = attachment.temp_token.as_ref() else {
            continue;
        };

        let source = PathBuf::from(source_path);
        let metadata = fs::metadata(&source).map_err(|error| {
            cleanup_created_files(&created_files);
            issue_io_error(error)
        })?;
        if !metadata.is_file() {
            cleanup_created_files(&created_files);
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "附件源文件不存在。",
            )
            .with_reason("attachmentSourceNotFound"));
        }

        let display_name = attachment.display_name.trim();
        let display_name = if display_name.is_empty() {
            infer_display_name(&source)
        } else {
            display_name.to_string()
        };
        let created_at = current_epoch_millis()?;
        let placeholder_name = format!(
            "pending-{}-{}",
            created_at,
            sanitize_attachment_file_name(&display_name)
        );
        let relative_path =
            format!(".redwhisk/issues/{issue_number}/attachments/{placeholder_name}");
        let absolute_path = data_dir
            .join("issues")
            .join(issue_number.to_string())
            .join("attachments")
            .join(&placeholder_name);
        if let Some(parent) = absolute_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                cleanup_created_files(&created_files);
                issue_io_error(error)
            })?;
        }
        fs::copy(&source, &absolute_path).map_err(|error| {
            cleanup_created_files(&created_files);
            issue_io_error(error)
        })?;
        created_files.push(absolute_path.clone());

        let analysis = analyze_attachment(&display_name, attachment.mime_type.as_deref());
        let inserted = IssueAttachmentRepository::insert_in_transaction(
            transaction,
            issue_id,
            &display_name,
            &placeholder_name,
            &relative_path,
            &absolute_path.to_string_lossy(),
            attachment.mime_type.as_deref(),
            i64::try_from(metadata.len()).map_err(|_| {
                cleanup_created_files(&created_files);
                CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 保存失败。")
                    .with_reason("saveFailed")
            })?,
            analysis.kind,
            analysis.is_previewable,
            created_at,
        )
        .map_err(|error| {
            cleanup_created_files(&created_files);
            issue_database_error(error)
        })?;

        persisted.push(NewAttachmentPersistence {
            temp_token: temp_token.clone(),
            attachment_id: inserted.id,
        });
    }

    Ok((persisted, created_files))
}

pub(super) fn save_issue_attachment_draft_in_data_dir(
    data_dir: &Path,
    input: SaveIssueAttachmentDraftInput,
) -> Result<SaveIssueAttachmentDraftResult, CommandError> {
    let source = PathBuf::from(&input.source_path);
    let metadata = fs::metadata(&source).map_err(issue_io_error)?;
    if !metadata.is_file() {
        return Err(CommandError::new(
            CommandErrorCode::IssueValidationFailed,
            "附件源文件不存在。",
        )
        .with_reason("attachmentSourceNotFound"));
    }

    let display_name = input.display_name.trim();
    let display_name = if display_name.is_empty() {
        infer_display_name(&source)
    } else {
        display_name.to_string()
    };
    let stored_name = format!(
        "{}-{}",
        current_epoch_millis()?,
        sanitize_attachment_file_name(&display_name)
    );
    let draft_dir = data_dir.join("issue-attachment-drafts");
    fs::create_dir_all(&draft_dir).map_err(issue_io_error)?;
    let destination = draft_dir.join(stored_name);
    fs::copy(&source, &destination).map_err(issue_io_error)?;

    let analysis = analyze_attachment(&display_name, None);
    Ok(SaveIssueAttachmentDraftResult {
        path: destination.to_string_lossy().to_string(),
        display_name,
        kind: analysis.kind,
        is_previewable: analysis.is_previewable,
    })
}

pub(super) fn rewrite_attachment_tokens(
    description: &str,
    attachments: &[NewAttachmentPersistence],
) -> Result<String, CommandError> {
    let mut rewritten = description.to_string();
    for attachment in attachments {
        let from = format!("{{{{issue-attachment-temp:{}}}}}", attachment.temp_token);
        let to = format!("{{{{issue-attachment:{}}}}}", attachment.attachment_id);
        if !rewritten.contains(&from) {
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "Issue description 缺少附件标记。",
            )
            .with_reason("descriptionMissingAttachmentMarker"));
        }
        rewritten = rewritten.replace(&from, &to);
    }
    Ok(rewritten)
}

pub(super) fn parse_attachment_ids(description: &str) -> HashSet<i64> {
    let mut result = HashSet::new();
    let needle = "{{issue-attachment:";
    let mut remaining = description;

    while let Some(start) = remaining.find(needle) {
        let token = &remaining[start + needle.len()..];
        let Some(end) = token.find("}}") else {
            break;
        };
        if let Ok(id) = token[..end].parse::<i64>() {
            result.insert(id);
        }
        remaining = &token[end + 2..];
    }

    result
}

pub(crate) fn analyze_attachment(
    display_name: &str,
    mime_type: Option<&str>,
) -> AttachmentAnalysis {
    let extension = Path::new(display_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mime_type = mime_type.unwrap_or_default().to_ascii_lowercase();

    if matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg"
    ) || mime_type.starts_with("image/")
    {
        return AttachmentAnalysis {
            kind: IssueAttachmentKind::Image,
            is_previewable: true,
        };
    }

    if extension == "pdf" || mime_type == "application/pdf" {
        return AttachmentAnalysis {
            kind: IssueAttachmentKind::Pdf,
            is_previewable: false,
        };
    }

    if matches!(extension.as_str(), "doc" | "docx") {
        return AttachmentAnalysis {
            kind: IssueAttachmentKind::Word,
            is_previewable: false,
        };
    }

    if matches!(
        extension.as_str(),
        "txt"
            | "md"
            | "markdown"
            | "json"
            | "yaml"
            | "yml"
            | "toml"
            | "rs"
            | "ts"
            | "tsx"
            | "js"
            | "jsx"
            | "css"
            | "html"
            | "xml"
            | "sh"
            | "sql"
    ) || mime_type.starts_with("text/")
        || mime_type.contains("json")
        || mime_type.contains("xml")
    {
        return AttachmentAnalysis {
            kind: IssueAttachmentKind::Text,
            is_previewable: true,
        };
    }

    AttachmentAnalysis {
        kind: IssueAttachmentKind::Generic,
        is_previewable: false,
    }
}

pub(super) fn infer_display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment")
        .to_string()
}

pub(crate) fn sanitize_attachment_file_name(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() || matches!(char, '.' | '-' | '_') {
                char
            } else {
                '-'
            }
        })
        .collect::<String>();
    let trimmed = sanitized.trim_matches('-');
    if trimmed.is_empty() {
        "attachment".to_string()
    } else {
        trimmed.to_string()
    }
}

pub(super) fn cleanup_created_files(paths: &[PathBuf]) {
    for path in paths {
        let _ = fs::remove_file(path);
    }
}

pub(super) fn delete_attachment_files(
    attachments: &[IssueAttachmentRecord],
) -> Result<(), CommandError> {
    for attachment in attachments {
        let path = Path::new(&attachment.absolute_path);
        if path.exists() {
            fs::remove_file(path).map_err(issue_io_error)?;
        }
    }
    Ok(())
}

pub(super) fn read_previewable_text_file(path: &str) -> Result<String, CommandError> {
    const MAX_PREVIEW_BYTES: u64 = 256 * 1024;
    let metadata = fs::metadata(path).map_err(issue_io_error)?;
    if metadata.len() > MAX_PREVIEW_BYTES {
        return Err(CommandError::new(
            CommandErrorCode::IssueValidationFailed,
            "附件过大，暂不支持预览。",
        )
        .with_reason("attachmentTooLarge"));
    }

    fs::read_to_string(path).map_err(issue_io_error)
}

pub(super) fn issue_io_error(error: std::io::Error) -> CommandError {
    CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 保存失败。")
        .with_reason("saveFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}
