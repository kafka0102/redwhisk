use std::path::{Path, PathBuf};

use super::rpc::path_from_file_uri;
use crate::types::code_language::{CodeLanguageLocation, CodeLanguageRange};

pub fn filter_workspace_locations(
    workspace_path: &Path,
    locations: &[(String, CodeLanguageRange)],
) -> Vec<CodeLanguageLocation> {
    locations
        .iter()
        .filter_map(|(uri, range)| {
            let path = path_from_file_uri(uri)?;
            let file_path = relative_workspace_path(workspace_path, &path)?;
            if file_path.is_empty() {
                return None;
            }
            Some(CodeLanguageLocation {
                file_path,
                range: range.clone(),
            })
        })
        .collect()
}

fn relative_workspace_path(workspace_path: &Path, path: &Path) -> Option<String> {
    let workspace = canonicalize_or_owned(workspace_path);
    let candidate = canonicalize_or_owned(path);
    let relative = candidate.strip_prefix(&workspace).ok()?;
    Some(relative.to_string_lossy().replace('\\', "/"))
}

fn canonicalize_or_owned(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::code_language::rpc::file_uri;
    use crate::types::code_language::CodeLanguagePosition;
    use std::fs;
    use tempfile::tempdir;

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(path, contents).expect("write file");
    }

    fn range(line: u32, character: u32) -> CodeLanguageRange {
        CodeLanguageRange {
            start: CodeLanguagePosition { line, character },
            end: CodeLanguagePosition {
                line,
                character: character + 3,
            },
        }
    }

    #[test]
    fn keeps_in_root_locations_including_node_modules() {
        let temp_dir = tempdir().expect("temp dir");
        let workspace = temp_dir.path().join("repo");
        let lib = workspace.join("src/lib.ts");
        let dts = workspace.join("node_modules/foo/index.d.ts");
        write_file(&lib, "export const foo = 1;\n");
        write_file(&dts, "export const foo: number;\n");

        let locations = filter_workspace_locations(
            &workspace,
            &[
                (file_uri(&lib), range(0, 0)),
                (file_uri(&dts), range(0, 13)),
                (
                    "file:///tmp/redwhisk-outside-not-in-workspace/lib.ts".to_string(),
                    range(0, 0),
                ),
            ],
        );

        assert_eq!(
            locations
                .iter()
                .map(|location| location.file_path.as_str())
                .collect::<Vec<_>>(),
            vec!["src/lib.ts", "node_modules/foo/index.d.ts"]
        );
    }
}
