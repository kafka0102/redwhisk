//! 差异对比的图片 / PDF 预览字节：工作区与提交两侧共用同一套组装。

use std::path::Path;

use base64::Engine;

use crate::types::errors::CommandError;
use crate::types::session_workspace::{
    WorkspaceChangeKind, WorkspaceDiffContent, WorkspaceFileContent, WorkspacePreviewKind,
};

use super::workspace::{language_from_path, HeadFileRead};
use super::workspace_preview::preview_kind_from_path;

pub(super) struct DiffSide {
    text: String,
    preview_base64: String,
    /// 该侧按 1MB 文本规则不可作为文本 diff。
    blocks_text: bool,
    is_too_large: bool,
}

pub(super) fn read_diff_side_from_git(
    read: HeadFileRead,
    path: &str,
) -> Result<DiffSide, CommandError> {
    match read {
        HeadFileRead::Content(text) => Ok(text_side(text)),
        HeadFileRead::Binary => Ok(DiffSide {
            text: String::new(),
            preview_base64: String::new(),
            blocks_text: true,
            is_too_large: false,
        }),
        HeadFileRead::TooLarge => Ok(DiffSide {
            text: String::new(),
            preview_base64: String::new(),
            blocks_text: false,
            is_too_large: true,
        }),
        HeadFileRead::Preview { bytes, text } => Ok(preview_side(path, &bytes, text)),
    }
}

pub(super) fn read_diff_side_from_workspace(content: WorkspaceFileContent) -> DiffSide {
    if content.preview_kind.is_some() {
        if content.legacy_diff_too_large && content.preview_bytes_base64.is_empty() {
            return DiffSide {
                text: String::new(),
                preview_base64: String::new(),
                blocks_text: false,
                is_too_large: true,
            };
        }
        let text = if content.legacy_diff_binary {
            String::new()
        } else if !content.legacy_diff_content.is_empty() {
            content.legacy_diff_content
        } else {
            content.content
        };
        return DiffSide {
            text,
            preview_base64: content.preview_bytes_base64,
            blocks_text: content.legacy_diff_binary || content.legacy_diff_too_large,
            is_too_large: false,
        };
    }

    if content.legacy_diff_binary || content.is_binary {
        return DiffSide {
            text: String::new(),
            preview_base64: String::new(),
            blocks_text: true,
            is_too_large: false,
        };
    }
    if content.legacy_diff_too_large || content.is_too_large {
        return DiffSide {
            text: String::new(),
            preview_base64: String::new(),
            blocks_text: false,
            is_too_large: true,
        };
    }
    text_side(content.content)
}

pub(super) fn absent_side() -> DiffSide {
    text_side(String::new())
}

pub(super) fn assemble_diff(
    file_path: &str,
    old_path: Option<String>,
    kind: WorkspaceChangeKind,
    original: DiffSide,
    modified: DiffSide,
) -> WorkspaceDiffContent {
    let preview_kind = preview_kind_for_diff(file_path, old_path.as_deref());
    let is_too_large = original.is_too_large || modified.is_too_large;
    if is_too_large {
        return WorkspaceDiffContent {
            file_path: file_path.to_string(),
            old_path,
            kind,
            language: language_from_path(file_path),
            original_content: String::new(),
            modified_content: String::new(),
            is_binary: false,
            is_too_large: true,
            preview_kind: None,
            original_preview_bytes_base64: String::new(),
            modified_preview_bytes_base64: String::new(),
        };
    }

    let side_blocks_text = original.blocks_text || modified.blocks_text;
    let is_binary = preview_kind.is_none() && side_blocks_text;
    WorkspaceDiffContent {
        file_path: file_path.to_string(),
        old_path,
        kind: if is_binary {
            WorkspaceChangeKind::Binary
        } else {
            kind
        },
        language: language_from_path(file_path),
        original_content: if is_binary {
            String::new()
        } else {
            original.text
        },
        modified_content: if is_binary {
            String::new()
        } else {
            modified.text
        },
        is_binary: side_blocks_text,
        is_too_large: false,
        preview_kind,
        original_preview_bytes_base64: if preview_kind.is_some() {
            original.preview_base64
        } else {
            String::new()
        },
        modified_preview_bytes_base64: if preview_kind.is_some() {
            modified.preview_base64
        } else {
            String::new()
        },
    }
}

fn preview_kind_for_diff(file_path: &str, old_path: Option<&str>) -> Option<WorkspacePreviewKind> {
    match (
        preview_kind_from_path(file_path),
        old_path.and_then(preview_kind_from_path),
    ) {
        (Some(kind), Some(other)) if kind == other => Some(kind),
        (Some(kind), None) => Some(kind),
        (None, Some(kind)) => Some(kind),
        _ => None,
    }
}

fn preview_side(path: &str, bytes: &[u8], text: Option<String>) -> DiffSide {
    let is_svg = Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("svg"));
    DiffSide {
        text: text.unwrap_or_default(),
        preview_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        blocks_text: !is_svg,
        is_too_large: false,
    }
}

fn text_side(text: String) -> DiffSide {
    DiffSide {
        text,
        preview_base64: String::new(),
        blocks_text: false,
        is_too_large: false,
    }
}
