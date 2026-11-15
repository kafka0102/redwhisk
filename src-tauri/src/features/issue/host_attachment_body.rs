use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use crate::types::errors::{CommandError, CommandErrorCode};
use crate::types::issue::CreateIssueInput;
use crate::types::project_issue_source::ForgeProvider;

pub(crate) const GITHUB_IMAGE_LIMIT: u64 = 10_485_760;
pub(crate) const GITHUB_VIDEO_LIMIT: u64 = 104_857_600;

static HOST_UPLOADS: Mutex<Option<HashMap<(i64, String), String>>> = Mutex::new(None);

pub(crate) fn remember_host_upload(project_id: i64, temp_token: &str, markdown: &str) {
    let mut guard = HOST_UPLOADS.lock().expect("host uploads");
    guard
        .get_or_insert_with(HashMap::new)
        .insert((project_id, temp_token.to_string()), markdown.to_string());
}

pub(crate) fn forget_host_upload(project_id: i64, temp_token: &str) {
    let mut guard = HOST_UPLOADS.lock().expect("host uploads");
    if let Some(uploads) = guard.as_mut() {
        uploads.remove(&(project_id, temp_token.to_string()));
    }
}

pub(crate) fn host_upload_markdown(project_id: i64, temp_token: &str) -> Option<String> {
    HOST_UPLOADS
        .lock()
        .expect("host uploads")
        .as_ref()
        .and_then(|uploads| uploads.get(&(project_id, temp_token.to_string())).cloned())
}

pub(crate) fn is_github_image(display_name: &str) -> bool {
    matches!(
        extension(display_name).as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg"
    )
}

pub(crate) fn is_github_video(display_name: &str) -> bool {
    matches!(extension(display_name).as_str(), "mp4" | "mov" | "webm")
}

pub(crate) fn uses_host_body(input: &CreateIssueInput) -> bool {
    input.attachments.iter().any(|attachment| {
        attachment
            .temp_token
            .as_deref()
            .is_some_and(|token| !token.is_empty())
    })
}

pub(crate) fn remote_host_body(
    input: &CreateIssueInput,
    provider: ForgeProvider,
) -> Result<String, CommandError> {
    if !uses_host_body(input) {
        return Ok(input.description.trim().to_string());
    }
    match provider {
        ForgeProvider::Github => rewrite_github(input),
        ForgeProvider::Gitlab => rewrite_gitlab(input),
    }
}

pub(crate) fn saved_host_body<'body>(
    input: &CreateIssueInput,
    provider: ForgeProvider,
    body: &'body str,
) -> Option<&'body str> {
    (uses_host_body(input) && matches!(provider, ForgeProvider::Github | ForgeProvider::Gitlab))
        .then_some(body)
}

fn rewrite_github(input: &CreateIssueInput) -> Result<String, CommandError> {
    let mut body = input.description.clone();
    let mut trailing = Vec::new();
    for attachment in &input.attachments {
        let Some(token) = attachment
            .temp_token
            .as_deref()
            .filter(|token| !token.is_empty())
        else {
            continue;
        };
        if is_github_image(&attachment.display_name) {
            let len = file_len(attachment.source_path.as_deref().unwrap_or(""))?;
            if len > GITHUB_IMAGE_LIMIT {
                return Err(too_large());
            }
            let markdown = required_markdown(input.project_id, token)?;
            body = replace_accepted(&body, token, &markdown);
        } else if is_github_video(&attachment.display_name) {
            let len = file_len(attachment.source_path.as_deref().unwrap_or(""))?;
            if len > GITHUB_VIDEO_LIMIT {
                return Err(too_large());
            }
            let markdown = required_markdown(input.project_id, token)?;
            body = excise_marker(&body, token);
            trailing.push(markdown);
        } else {
            body = strip_unaccepted(&body, token);
        }
    }
    Ok(append_blocks(&body, &trailing))
}

fn rewrite_gitlab(input: &CreateIssueInput) -> Result<String, CommandError> {
    let mut body = input.description.clone();
    let mut trailing = Vec::new();
    for attachment in &input.attachments {
        let Some(token) = attachment
            .temp_token
            .as_deref()
            .filter(|token| !token.is_empty())
        else {
            continue;
        };
        let markdown = required_markdown(input.project_id, token)?;
        if marker_in_image(&body, token) {
            body = replace_accepted(&body, token, &markdown);
        } else {
            body = excise_marker(&body, token);
            trailing.push(markdown);
        }
    }
    Ok(append_blocks(&body, &trailing))
}

fn required_markdown(project_id: i64, token: &str) -> Result<String, CommandError> {
    host_upload_markdown(project_id, token)
        .filter(|value| !value.is_empty())
        .ok_or_else(upload_required)
}

fn file_len(path: &str) -> Result<u64, CommandError> {
    let metadata = std::fs::metadata(path).map_err(|_| upload_failed())?;
    if !metadata.is_file() {
        return Err(upload_failed());
    }
    Ok(metadata.len())
}

fn replace_accepted(body: &str, token: &str, markdown: &str) -> String {
    rewrite_marker(body, &marker(token), Some(markdown))
}

fn strip_unaccepted(body: &str, token: &str) -> String {
    let marker = marker(token);
    drop_marker(&rewrite_marker(body, &marker, None), &marker)
}

fn excise_marker(body: &str, token: &str) -> String {
    let marker = marker(token);
    let without_images = rewrite_marker(body, &marker, None);
    let mut result = String::new();
    let mut offset = 0;
    while offset < without_images.len() {
        let rest = &without_images[offset..];
        let (line, next, newline) = match rest.find('\n') {
            Some(position) => (&rest[..position], offset + position + 1, true),
            None => (rest, without_images.len(), false),
        };
        if line.trim() == marker {
            if result.ends_with("\n\n") || result == "\n" {
                result.pop();
            }
        } else {
            result.push_str(&line.replace(&marker, ""));
            if newline {
                result.push('\n');
            }
        }
        offset = next;
    }
    result
}

fn append_blocks(body: &str, blocks: &[String]) -> String {
    if blocks.is_empty() {
        return body.to_string();
    }
    let mut result = body.to_string();
    for block in blocks {
        if !result.is_empty() {
            if !result.ends_with('\n') {
                result.push('\n');
            }
            if !result.ends_with("\n\n") {
                result.push('\n');
            }
        }
        result.push_str(block);
        if !result.ends_with('\n') {
            result.push('\n');
        }
    }
    result
}

fn marker_in_image(body: &str, token: &str) -> bool {
    let marker = marker(token);
    let mut rest = body;
    while let Some(index) = rest.find(&marker) {
        if image_start(rest, index).is_some() {
            return true;
        }
        rest = &rest[index + marker.len()..];
    }
    false
}

fn marker(token: &str) -> String {
    format!("{{{{issue-attachment-temp:{token}}}}}")
}

fn rewrite_marker(body: &str, marker: &str, replacement: Option<&str>) -> String {
    let mut out = String::new();
    let mut rest = body;
    while let Some(index) = rest.find(marker) {
        if let Some(start) = image_start(rest, index) {
            out.push_str(&rest[..start]);
            if let Some(replacement) = replacement {
                out.push_str(replacement);
            }
            let mut after = index + marker.len();
            if rest[after..].starts_with(')') {
                after += 1;
            }
            rest = &rest[after..];
            continue;
        }
        out.push_str(&rest[..index]);
        if let Some(replacement) = replacement {
            out.push_str(replacement);
        } else {
            out.push_str(marker);
        }
        rest = &rest[index + marker.len()..];
    }
    out.push_str(rest);
    out
}

fn image_start(text: &str, marker_at: usize) -> Option<usize> {
    let start = text[..marker_at].rfind("![")?;
    let between = &text[start + 2..marker_at];
    if between.contains('\n') || !between.ends_with("](") {
        return None;
    }
    Some(start)
}

fn drop_marker(body: &str, marker: &str) -> String {
    let mut result = String::new();
    let mut offset = 0;
    while offset < body.len() {
        let rest = &body[offset..];
        let (line, next, newline) = match rest.find('\n') {
            Some(position) => (&rest[..position], offset + position + 1, true),
            None => (rest, body.len(), false),
        };
        if line.trim() != marker {
            result.push_str(&line.replace(marker, ""));
            if newline {
                result.push('\n');
            }
        }
        offset = next;
    }
    result
}

fn extension(display_name: &str) -> String {
    Path::new(display_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

#[rustfmt::skip]
fn too_large() -> CommandError {
    CommandError::new(CommandErrorCode::ForgeUnavailable, "The file is larger than GitHub accepts.").with_reason("hostAttachmentTooLarge")
}

#[rustfmt::skip]
fn upload_required() -> CommandError {
    CommandError::new(CommandErrorCode::ForgeUnavailable, "The host has not accepted this file yet.").with_reason("hostAttachmentUploadRequired")
}

#[rustfmt::skip]
fn upload_failed() -> CommandError {
    CommandError::new(CommandErrorCode::ForgeUnavailable, "GitHub attachment upload failed.").with_reason("hostAttachmentUploadFailed")
}
