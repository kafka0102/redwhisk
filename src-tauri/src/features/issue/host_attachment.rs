use std::path::{Path, PathBuf};

use super::github_issue_mirror::capture_forge_stdout;
use super::github_issue_mirror::ForgeIssueError;
use super::host_attachment_body::{
    forget_host_upload, is_github_image, is_github_video, remember_host_upload, GITHUB_IMAGE_LIMIT,
    GITHUB_VIDEO_LIMIT,
};
use super::validation::issue_database_error;
use crate::db::project_issue_source_repository::ProjectIssueSourceRepository;
use crate::db::project_repository::ProjectRepository;
use crate::types::errors::{CommandError, CommandErrorCode};
use crate::types::host_attachment::{
    UploadIssueHostAttachmentInput, UploadIssueHostAttachmentResult,
};
use crate::types::project_issue_source::{
    ForgeAuthStatus, ForgeProvider, IssueCreateSource, IssueSourceMode, ProjectIssueSourceSettings,
};

#[tauri::command]
pub async fn upload_issue_host_attachment(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::app_state::AppState>,
    input: UploadIssueHostAttachmentInput,
) -> Result<UploadIssueHostAttachmentResult, CommandError> {
    let data_dir = super::commands::prepare_issue_data_dir(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        upload_issue_host_attachment_in_data_dir(&data_dir, input)
    })
    .await
    .map_err(|_| upload_failed())?
}

pub(crate) fn upload_issue_host_attachment_in_data_dir(
    data_dir: &Path,
    input: UploadIssueHostAttachmentInput,
) -> Result<UploadIssueHostAttachmentResult, CommandError> {
    let database = super::archive::open_issue_database(data_dir)?;
    let connection = &database.connection;
    let project = ProjectRepository::new(connection)
        .find_by_id(input.project_id)
        .map_err(issue_database_error)?
        .ok_or_else(|| {
            CommandError::new(CommandErrorCode::ProjectNotFound, "Project not found.")
        })?;
    let settings = ProjectIssueSourceRepository::new(connection)
        .get(input.project_id)
        .map_err(issue_database_error)?
        .ok_or_else(|| {
            CommandError::new(CommandErrorCode::ProjectNotFound, "Project not found.")
        })?;
    if !wants_remote(&settings) {
        return Err(not_remote());
    }
    if settings.connection.auth_status != ForgeAuthStatus::Ready {
        return Err(unavailable());
    }
    let provider = settings.connection.provider.ok_or_else(unavailable)?;
    let source = PathBuf::from(&input.source_path);
    let metadata = std::fs::metadata(&source).map_err(|_| upload_failed())?;
    if !metadata.is_file() {
        return Err(upload_failed());
    }
    let repo = settings
        .connection
        .repo_path
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    if repo.is_empty() {
        return Err(unavailable());
    }
    let markdown = match provider {
        ForgeProvider::Github => {
            if !is_github_image(&input.display_name) && !is_github_video(&input.display_name) {
                return Err(rejected());
            }
            let limit = if is_github_video(&input.display_name) {
                GITHUB_VIDEO_LIMIT
            } else {
                GITHUB_IMAGE_LIMIT
            };
            if metadata.len() > limit {
                return Err(too_large());
            }
            upload_github_asset(
                Path::new(&project.repo_path),
                &repo,
                &input.display_name,
                &source,
            )?
        }
        ForgeProvider::Gitlab => upload_gitlab(Path::new(&project.repo_path), &repo, &source)?,
    };
    forget_host_upload(input.project_id, &input.temp_token);
    remember_host_upload(input.project_id, &input.temp_token, &markdown);
    Ok(UploadIssueHostAttachmentResult { markdown })
}

fn upload_github_asset(
    repo_dir: &Path,
    repo: &str,
    display_name: &str,
    source: &Path,
) -> Result<String, CommandError> {
    let id_args = vec![
        "api".to_string(),
        format!("repos/{repo}"),
        "--jq".to_string(),
        ".id".to_string(),
    ];
    let id_stdout = capture_forge_stdout("gh", &id_args, repo_dir).map_err(forge_upload_error)?;
    let repository_id = id_stdout.trim();
    if repository_id.is_empty() || !repository_id.chars().all(|char| char.is_ascii_digit()) {
        return Err(upload_failed());
    }
    let url = format!(
        "https://uploads.github.com/user-attachments/assets?name={}&content_type={}&repository_id={repository_id}",
        encode_query(display_name),
        encode_query(content_type(display_name)),
    );
    let args = vec![
        "api".to_string(),
        "--method".to_string(),
        "POST".to_string(),
        "-H".to_string(),
        "Accept: application/vnd.github+json".to_string(),
        "-H".to_string(),
        "Content-Type: application/octet-stream".to_string(),
        "--input".to_string(),
        source.to_string_lossy().to_string(),
        url,
    ];
    let stdout = capture_forge_stdout("gh", &args, repo_dir).map_err(forge_upload_error)?;
    let parsed: serde_json::Value =
        serde_json::from_str(stdout.trim()).map_err(|_| upload_failed())?;
    let asset = parsed
        .get("url")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(upload_failed)?;
    if is_github_video(display_name) {
        Ok(asset.to_string())
    } else {
        Ok(format!("![{display_name}]({asset})"))
    }
}

fn upload_gitlab(repo_dir: &Path, repo: &str, source: &Path) -> Result<String, CommandError> {
    let args = vec![
        "api".to_string(),
        "--method".to_string(),
        "POST".to_string(),
        "-F".to_string(),
        format!("file=@{}", source.to_string_lossy()),
        format!("projects/{}/uploads", encode_query(repo)),
    ];
    let stdout = capture_forge_stdout("glab", &args, repo_dir).map_err(forge_upload_error)?;
    let parsed: serde_json::Value =
        serde_json::from_str(stdout.trim()).map_err(|_| upload_failed())?;
    parsed
        .get("markdown")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(upload_failed)
}

fn wants_remote(settings: &ProjectIssueSourceSettings) -> bool {
    match settings.issue_source_mode {
        IssueSourceMode::Local => false,
        IssueSourceMode::Remote => true,
        IssueSourceMode::Mixed => settings.issue_create_source == IssueCreateSource::Remote,
    }
}

fn content_type(display_name: &str) -> &'static str {
    let extension = Path::new(display_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        _ => "image/png",
    }
}

fn encode_query(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn forge_upload_error(error: ForgeIssueError) -> CommandError {
    match error {
        ForgeIssueError::Unauthenticated => CommandError::new(
            CommandErrorCode::ForgeUnavailable,
            "GitHub attachment upload failed authentication.",
        )
        .with_reason("hostAttachmentUnauthenticated"),
        ForgeIssueError::Forbidden => CommandError::new(
            CommandErrorCode::ForgeUnavailable,
            "GitHub attachment upload was denied.",
        )
        .with_reason("hostAttachmentForbidden"),
        ForgeIssueError::Offline => CommandError::new(
            CommandErrorCode::ForgeUnavailable,
            "GitHub attachment upload failed because the network is unavailable.",
        )
        .with_reason("hostAttachmentOffline"),
        ForgeIssueError::CliMissing => CommandError::new(
            CommandErrorCode::ForgeUnavailable,
            "GitHub CLI was not found.",
        )
        .with_reason("hostAttachmentCliMissing"),
        ForgeIssueError::CommandFailed
        | ForgeIssueError::Unparseable
        | ForgeIssueError::RateLimited
        | ForgeIssueError::NotFound
        | ForgeIssueError::Gone => upload_failed(),
    }
}

fn not_remote() -> CommandError {
    CommandError::new(
        CommandErrorCode::ForgeUnavailable,
        "Host attachment upload is only available when creating a remote issue.",
    )
    .with_reason("hostAttachmentNotRemote")
}

fn unavailable() -> CommandError {
    CommandError::new(
        CommandErrorCode::ForgeUnavailable,
        "GitHub attachment upload is unavailable.",
    )
    .with_reason("hostAttachmentUnavailable")
}

fn rejected() -> CommandError {
    CommandError::new(
        CommandErrorCode::ForgeUnavailable,
        "GitHub does not accept this file.",
    )
    .with_reason("hostAttachmentRejected")
}

fn too_large() -> CommandError {
    CommandError::new(
        CommandErrorCode::ForgeUnavailable,
        "The file is larger than GitHub accepts.",
    )
    .with_reason("hostAttachmentTooLarge")
}

fn upload_failed() -> CommandError {
    CommandError::new(
        CommandErrorCode::ForgeUnavailable,
        "GitHub attachment upload failed.",
    )
    .with_reason("hostAttachmentUploadFailed")
}
