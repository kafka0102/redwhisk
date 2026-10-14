//! 工作区单文件读取：普通文本沿用 1MB 上限；图片与 PDF 在 20MB 内返回可预览字节。

use std::fs;
use std::path::Path;

use base64::Engine;

use crate::types::errors::CommandError;
use crate::types::session_workspace::{WorkspaceFileContent, WorkspacePreviewKind};

use super::workspace::{
    is_binary_bytes, language_from_path, modified_at_millis, resolve_workspace_file,
    workspace_io_error, MAX_TEXT_FILE_BYTES,
};

const MAX_PREVIEW_FILE_BYTES: u64 = 20 * 1024 * 1024;

pub(super) fn read_workspace_file(
    root: &Path,
    file_path: &str,
) -> Result<WorkspaceFileContent, CommandError> {
    let workspace_file = resolve_workspace_file(root, file_path)?;
    let size_bytes = workspace_file.metadata.len();
    let language = language_from_path(file_path);
    let modified_at = modified_at_millis(&workspace_file.metadata);
    let preview_kind = preview_kind_from_path(file_path);

    if preview_kind.is_some() {
        if size_bytes > MAX_PREVIEW_FILE_BYTES {
            return Ok(empty_file_content(
                file_path,
                language,
                modified_at,
                size_bytes,
                true,
                true,
                None,
                false,
                true,
            ));
        }

        let bytes = fs::read(&workspace_file.absolute_path).map_err(workspace_io_error)?;
        // 旧差异对比在读字节前按 1MB 短路，不把大图当二进制。
        if size_bytes > MAX_TEXT_FILE_BYTES {
            return Ok(WorkspaceFileContent {
                file_path: file_path.to_string(),
                language,
                content: String::new(),
                modified_at,
                size_bytes,
                is_binary: true,
                is_too_large: false,
                preview_kind,
                preview_bytes_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
                legacy_diff_binary: false,
                legacy_diff_too_large: true,
                legacy_diff_content: String::new(),
            });
        }

        let legacy_diff_binary = is_binary_bytes(&bytes);
        let legacy_diff_content = if legacy_diff_binary {
            String::new()
        } else {
            String::from_utf8_lossy(&bytes).into_owned()
        };
        let svg_text = svg_text_within_limit(file_path, size_bytes, &bytes);
        return Ok(WorkspaceFileContent {
            file_path: file_path.to_string(),
            language,
            content: svg_text.clone().unwrap_or_default(),
            modified_at,
            size_bytes,
            is_binary: svg_text.is_none(),
            is_too_large: false,
            preview_kind,
            preview_bytes_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
            legacy_diff_binary,
            legacy_diff_too_large: false,
            legacy_diff_content,
        });
    }

    if size_bytes > MAX_TEXT_FILE_BYTES {
        return Ok(empty_file_content(
            file_path,
            language,
            modified_at,
            size_bytes,
            false,
            true,
            None,
            false,
            true,
        ));
    }

    let bytes = fs::read(&workspace_file.absolute_path).map_err(workspace_io_error)?;
    if is_binary_bytes(&bytes) {
        return Ok(empty_file_content(
            file_path,
            language,
            modified_at,
            size_bytes,
            true,
            false,
            None,
            true,
            false,
        ));
    }

    Ok(WorkspaceFileContent {
        file_path: file_path.to_string(),
        language,
        content: String::from_utf8_lossy(&bytes).to_string(),
        modified_at,
        size_bytes,
        is_binary: false,
        is_too_large: false,
        preview_kind: None,
        preview_bytes_base64: String::new(),
        legacy_diff_binary: false,
        legacy_diff_too_large: false,
        legacy_diff_content: String::new(),
    })
}

fn preview_kind_from_path(path: &str) -> Option<WorkspacePreviewKind> {
    let extension = Path::new(path).extension()?.to_str()?;
    match extension.to_ascii_lowercase().as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "ico" | "avif" | "svg" => {
            Some(WorkspacePreviewKind::Image)
        }
        "pdf" => Some(WorkspacePreviewKind::Pdf),
        _ => None,
    }
}

fn svg_text_within_limit(path: &str, size_bytes: u64, bytes: &[u8]) -> Option<String> {
    let is_svg = Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("svg"));
    if is_svg && size_bytes <= MAX_TEXT_FILE_BYTES && !is_binary_bytes(bytes) {
        Some(String::from_utf8_lossy(bytes).to_string())
    } else {
        None
    }
}

fn empty_file_content(
    file_path: &str,
    language: Option<String>,
    modified_at: Option<i64>,
    size_bytes: u64,
    is_binary: bool,
    is_too_large: bool,
    preview_kind: Option<WorkspacePreviewKind>,
    legacy_diff_binary: bool,
    legacy_diff_too_large: bool,
) -> WorkspaceFileContent {
    WorkspaceFileContent {
        file_path: file_path.to_string(),
        language,
        content: String::new(),
        modified_at,
        size_bytes,
        is_binary,
        is_too_large,
        preview_kind,
        preview_bytes_base64: String::new(),
        legacy_diff_binary,
        legacy_diff_too_large,
        legacy_diff_content: String::new(),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use base64::Engine;

    use super::super::workspace::MAX_TEXT_FILE_BYTES;
    use super::{read_workspace_file, MAX_PREVIEW_FILE_BYTES};
    use crate::types::session_workspace::WorkspacePreviewKind;

    #[test]
    fn read_workspace_file_returns_preview_bytes_for_bitmap_within_limit() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        let bytes = b"\x89PNG\r\n\x1a\n\x00bitmap";
        fs::write(root.join("logo.PNG"), bytes).expect("write bitmap");

        let content = read_workspace_file(root, "logo.PNG").expect("read bitmap");

        assert_eq!(content.preview_kind, Some(WorkspacePreviewKind::Image));
        assert_eq!(
            content.preview_bytes_base64,
            base64::engine::general_purpose::STANDARD.encode(bytes)
        );
        assert!(content.content.is_empty());
        assert!(content.is_binary);
        assert!(!content.is_too_large);
        assert_eq!(content.size_bytes, bytes.len() as u64);
    }

    #[test]
    fn read_workspace_file_classifies_image_and_pdf_extensions() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        let cases = [
            ("photo.jpg", WorkspacePreviewKind::Image),
            ("photo.jpeg", WorkspacePreviewKind::Image),
            ("anim.GIF", WorkspacePreviewKind::Image),
            ("still.webp", WorkspacePreviewKind::Image),
            ("pixel.bmp", WorkspacePreviewKind::Image),
            ("favicon.ICO", WorkspacePreviewKind::Image),
            ("frame.avif", WorkspacePreviewKind::Image),
            ("mark.svg", WorkspacePreviewKind::Image),
            ("doc.PDF", WorkspacePreviewKind::Pdf),
        ];

        for (path, kind) in cases {
            fs::write(root.join(path), b"preview-bytes").expect("write preview file");
            let content = read_workspace_file(root, path).expect("read preview file");
            assert_eq!(content.preview_kind, Some(kind), "{path}");
            assert!(!content.preview_bytes_base64.is_empty(), "{path}");
            assert!(!content.is_too_large, "{path}");
        }
    }

    #[test]
    fn read_workspace_file_returns_pdf_preview_bytes() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        let bytes = b"%PDF-1.7\nbinary\x00page";
        fs::write(root.join("notes.Pdf"), bytes).expect("write pdf");

        let content = read_workspace_file(root, "notes.Pdf").expect("read pdf");

        assert_eq!(content.preview_kind, Some(WorkspacePreviewKind::Pdf));
        assert_eq!(
            content.preview_bytes_base64,
            base64::engine::general_purpose::STANDARD.encode(bytes)
        );
        assert!(content.content.is_empty());
        assert!(content.is_binary);
        assert!(!content.is_too_large);
    }

    #[test]
    fn read_workspace_file_hides_ascii_pdf_text_but_keeps_it_for_legacy_diff() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        let source = "%PDF-1.4\nascii page\n";
        fs::write(root.join("notes.pdf"), source).expect("write ascii pdf");

        let content = read_workspace_file(root, "notes.pdf").expect("read ascii pdf");

        assert_eq!(content.preview_kind, Some(WorkspacePreviewKind::Pdf));
        assert!(content.content.is_empty());
        assert!(content.is_binary);
        assert!(!content.is_too_large);
        assert_eq!(content.legacy_diff_content, source);
        assert!(!content.legacy_diff_binary);
        assert!(!content.legacy_diff_too_large);

        let json = serde_json::to_value(&content).expect("serialize file content");
        assert!(json.get("legacyDiffContent").is_none());
        assert!(json.get("legacy_diff_content").is_none());
        assert_eq!(json["content"], "");
        assert_eq!(json["previewKind"], "pdf");
        assert!(!json["previewBytesBase64"].as_str().unwrap_or("").is_empty());
    }

    #[test]
    fn read_workspace_file_returns_svg_text_and_preview_bytes_within_text_limit() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        let source = "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>\n";
        fs::write(root.join("icon.svg"), source).expect("write svg");

        let content = read_workspace_file(root, "icon.svg").expect("read svg");

        assert_eq!(content.preview_kind, Some(WorkspacePreviewKind::Image));
        assert_eq!(
            content.preview_bytes_base64,
            base64::engine::general_purpose::STANDARD.encode(source.as_bytes())
        );
        assert_eq!(content.content, source);
        assert!(!content.is_binary);
        assert!(!content.is_too_large);
    }

    #[test]
    fn read_workspace_file_returns_svg_preview_without_text_above_text_limit() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        let source = format!("<svg>{}</svg>", "a".repeat(MAX_TEXT_FILE_BYTES as usize));
        fs::write(root.join("large.svg"), &source).expect("write large svg");

        let content = read_workspace_file(root, "large.svg").expect("read large svg");

        assert_eq!(content.preview_kind, Some(WorkspacePreviewKind::Image));
        assert_eq!(
            content.preview_bytes_base64,
            base64::engine::general_purpose::STANDARD.encode(source.as_bytes())
        );
        assert!(content.content.is_empty());
        assert!(content.is_binary);
        assert!(!content.is_too_large);
        assert_eq!(content.size_bytes, source.len() as u64);
    }

    #[test]
    fn read_workspace_file_marks_oversized_image_and_pdf_without_bytes() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        let oversized = MAX_PREVIEW_FILE_BYTES + 1;
        write_sparse_file(&root.join("huge.png"), oversized);
        write_sparse_file(&root.join("huge.pdf"), oversized);

        for path in ["huge.png", "huge.pdf"] {
            let content = read_workspace_file(root, path).expect("read oversized preview");
            assert!(content.preview_kind.is_none(), "{path}");
            assert!(content.preview_bytes_base64.is_empty(), "{path}");
            assert!(content.content.is_empty(), "{path}");
            assert!(content.is_binary, "{path}");
            assert!(content.is_too_large, "{path}");
            assert_eq!(content.size_bytes, oversized, "{path}");
        }
    }

    #[test]
    fn read_workspace_file_keeps_text_limit_and_non_preview_binary() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        fs::write(root.join("note.txt"), "hello\n").expect("write text");
        fs::write(root.join("payload.bin"), b"hello\x00world").expect("write binary");
        fs::write(root.join("README"), b"no-ext\x00bin").expect("write extensionless");
        let oversized_text = "a".repeat((MAX_TEXT_FILE_BYTES + 1) as usize);
        fs::write(root.join("large.txt"), &oversized_text).expect("write large text");

        let text = read_workspace_file(root, "note.txt").expect("read text");
        assert_eq!(text.content, "hello\n");
        assert!(!text.is_binary);
        assert!(!text.is_too_large);
        assert!(text.preview_kind.is_none());
        assert!(text.preview_bytes_base64.is_empty());

        for path in ["payload.bin", "README"] {
            let binary = read_workspace_file(root, path).expect("read binary");
            assert!(binary.content.is_empty(), "{path}");
            assert!(binary.is_binary, "{path}");
            assert!(!binary.is_too_large, "{path}");
            assert!(binary.preview_kind.is_none(), "{path}");
            assert!(binary.preview_bytes_base64.is_empty(), "{path}");
        }

        let large = read_workspace_file(root, "large.txt").expect("read large text");
        assert!(large.content.is_empty());
        assert!(!large.is_binary);
        assert!(large.is_too_large);
        assert!(large.preview_kind.is_none());
        assert!(large.preview_bytes_base64.is_empty());
    }

    fn write_sparse_file(path: &Path, size: u64) {
        let file = fs::File::create(path).expect("create sparse file");
        file.set_len(size).expect("set sparse length");
    }
}
