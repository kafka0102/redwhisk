//! 代码工作区路径的复制与移动。
//!
//! 两条路径都走既有相对路径守卫。复制是深拷贝，软链按软链复制，不跟随到工作区外。
//! 中途失败会删掉本次已经写出的目标，源保持不动。移动不覆盖已有目标。

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use crate::types::errors::{CommandError, ErrorDetail};
use crate::types::session_workspace::ProjectWorkspaceTransferPathInput;

use super::workspace::{
    resolve_workspace_relative_path, workspace_validation_error, SessionWorkspaceService,
};

impl SessionWorkspaceService<'_> {
    pub fn copy_path(&self, input: ProjectWorkspaceTransferPathInput) -> Result<(), CommandError> {
        let root = workspace_root_for(self, &input)?;
        copy_workspace_path(&root, &input.source_path, &input.destination_path)
    }

    pub fn move_path(&self, input: ProjectWorkspaceTransferPathInput) -> Result<(), CommandError> {
        let root = workspace_root_for(self, &input)?;
        move_workspace_path(&root, &input.source_path, &input.destination_path)
    }
}

fn workspace_root_for(
    service: &SessionWorkspaceService<'_>,
    input: &ProjectWorkspaceTransferPathInput,
) -> Result<PathBuf, CommandError> {
    service.resolve_workspace_root(
        input.project_id,
        input.session_id,
        input.workspace_path.as_deref(),
    )
}

fn copy_workspace_path(
    root: &Path,
    source_rel: &str,
    destination_rel: &str,
) -> Result<(), CommandError> {
    let source = resolve_workspace_relative_path(root, source_rel)?;
    let metadata = source_metadata(&source, source_rel, "pathCopyFailed", "Copy failed.")?;
    if metadata.is_dir() && is_same_or_descendant(destination_rel, source_rel) {
        return Err(transfer_error(
            source_rel,
            "pathCopyIntoSelf",
            "Cannot paste a folder into itself.",
        ));
    }
    let destination = resolve_workspace_relative_path(root, destination_rel)?;
    if path_exists(&destination) {
        return Err(transfer_error(
            destination_rel,
            "pathAlreadyExists",
            "Target already exists.",
        ));
    }
    if let Err(error) = copy_entry(&source, &destination) {
        remove_copied(&destination);
        return Err(io_transfer_error(
            destination_rel,
            "pathCopyFailed",
            "Copy failed.",
            &error,
        ));
    }
    Ok(())
}

fn move_workspace_path(
    root: &Path,
    source_rel: &str,
    destination_rel: &str,
) -> Result<(), CommandError> {
    let source = resolve_workspace_relative_path(root, source_rel)?;
    let metadata = source_metadata(&source, source_rel, "pathMoveFailed", "Move failed.")?;
    if metadata.is_dir() && is_same_or_descendant(destination_rel, source_rel) {
        return Err(transfer_error(
            source_rel,
            "pathMoveIntoSelf",
            "Cannot move a folder into itself.",
        ));
    }
    let destination = resolve_workspace_relative_path(root, destination_rel)?;
    if path_exists(&destination) {
        return Err(transfer_error(
            destination_rel,
            "pathAlreadyExists",
            "Target already exists.",
        ));
    }
    fs::rename(&source, &destination).map_err(|error| {
        if error.kind() == ErrorKind::AlreadyExists {
            transfer_error(
                destination_rel,
                "pathAlreadyExists",
                "Target already exists.",
            )
        } else {
            io_transfer_error(destination_rel, "pathMoveFailed", "Move failed.", &error)
        }
    })
}

fn source_metadata(
    source: &Path,
    source_rel: &str,
    failure_reason: &str,
    failure_message: &str,
) -> Result<fs::Metadata, CommandError> {
    match fs::symlink_metadata(source) {
        Ok(metadata) => Ok(metadata),
        Err(error) if error.kind() == ErrorKind::NotFound => Err(transfer_error(
            source_rel,
            "pathNotFound",
            "Target path not found.",
        )),
        Err(error) => Err(io_transfer_error(
            source_rel,
            failure_reason,
            failure_message,
            &error,
        )),
    }
}

fn copy_entry(source: &Path, destination: &Path) -> Result<(), std::io::Error> {
    let metadata = fs::symlink_metadata(source)?;
    let file_type = metadata.file_type();
    if file_type.is_symlink() {
        return copy_symlink(source, destination);
    }
    if file_type.is_dir() {
        fs::create_dir(destination)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            copy_entry(&entry.path(), &destination.join(entry.file_name()))?;
        }
        return Ok(());
    }
    fs::copy(source, destination).map(|_| ())
}

fn copy_symlink(source: &Path, destination: &Path) -> Result<(), std::io::Error> {
    let target = fs::read_link(source)?;
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, destination)
    }
    #[cfg(not(unix))]
    {
        let _ = (target, destination);
        Err(std::io::Error::new(
            ErrorKind::Unsupported,
            "symlink copy is unsupported",
        ))
    }
}

fn remove_copied(path: &Path) {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return;
    };
    if metadata.is_dir() {
        let _ = fs::remove_dir_all(path);
    } else {
        let _ = fs::remove_file(path);
    }
}

fn path_exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

fn is_same_or_descendant(path: &str, directory: &str) -> bool {
    path == directory || path.starts_with(&format!("{directory}/"))
}

fn transfer_error(file_path: &str, reason: &str, message: &str) -> CommandError {
    workspace_validation_error(message, file_path).with_reason(reason)
}

fn io_transfer_error(
    file_path: &str,
    reason: &str,
    message: &str,
    error: &std::io::Error,
) -> CommandError {
    transfer_error(file_path, reason, message)
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reason_of(result: Result<(), CommandError>) -> Option<String> {
        result.expect_err("expected command error").reason
    }

    #[test]
    fn copy_workspace_path_keeps_file_bytes_and_source() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        fs::create_dir_all(root.join("src")).expect("seed dir");
        fs::write(root.join("src/app.tsx"), "keep\n").expect("seed file");
        fs::create_dir(root.join("components")).expect("seed dest");

        copy_workspace_path(root, "src/app.tsx", "components/app.tsx").expect("copy");

        assert_eq!(
            fs::read_to_string(root.join("components/app.tsx")).expect("read copy"),
            "keep\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("src/app.tsx")).expect("read source"),
            "keep\n"
        );
    }

    #[test]
    fn copy_workspace_path_copies_directory_bytes() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        fs::create_dir_all(root.join("src/components")).expect("seed dir");
        fs::write(root.join("src/components/button.tsx"), "ok").expect("seed file");
        fs::create_dir(root.join("lib")).expect("seed dest");

        copy_workspace_path(root, "src/components", "lib/components").expect("copy dir");

        assert_eq!(
            fs::read_to_string(root.join("lib/components/button.tsx")).expect("read copy"),
            "ok"
        );
        assert!(root.join("src/components/button.tsx").is_file());
    }

    #[test]
    fn copy_workspace_path_rejects_existing_target_without_overwrite() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        fs::create_dir_all(root.join("src")).expect("seed dir");
        fs::create_dir(root.join("components")).expect("seed dest");
        fs::write(root.join("src/app.tsx"), "source\n").expect("seed source");
        fs::write(root.join("components/app.tsx"), "dest\n").expect("seed dest");

        assert_eq!(
            reason_of(copy_workspace_path(
                root,
                "src/app.tsx",
                "components/app.tsx"
            ))
            .as_deref(),
            Some("pathAlreadyExists")
        );
        assert_eq!(
            fs::read_to_string(root.join("components/app.tsx")).expect("read dest"),
            "dest\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("src/app.tsx")).expect("read source"),
            "source\n"
        );
    }

    #[test]
    fn copy_workspace_path_rejects_paste_into_self() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        fs::create_dir_all(root.join("src/components/ui")).expect("seed dir");
        fs::write(root.join("src/components/button.tsx"), "ok").expect("seed file");

        assert_eq!(
            reason_of(copy_workspace_path(
                root,
                "src/components",
                "src/components"
            ))
            .as_deref(),
            Some("pathCopyIntoSelf")
        );
        assert_eq!(
            reason_of(copy_workspace_path(
                root,
                "src/components",
                "src/components/ui/components"
            ))
            .as_deref(),
            Some("pathCopyIntoSelf")
        );
        assert!(root.join("src/components/button.tsx").is_file());
        assert!(!root.join("src/components/ui/components").exists());
    }

    #[test]
    fn move_workspace_path_keeps_bytes_and_removes_source() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        fs::create_dir_all(root.join("src")).expect("seed dir");
        fs::create_dir(root.join("components")).expect("seed dest");
        fs::write(root.join("src/app.tsx"), "moved\n").expect("seed file");

        move_workspace_path(root, "src/app.tsx", "components/app.tsx").expect("move");

        assert!(!root.join("src/app.tsx").exists());
        assert_eq!(
            fs::read_to_string(root.join("components/app.tsx")).expect("read dest"),
            "moved\n"
        );
    }

    #[test]
    fn move_workspace_path_rejects_existing_target_and_keeps_source() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        fs::create_dir_all(root.join("src")).expect("seed dir");
        fs::create_dir(root.join("components")).expect("seed dest");
        fs::write(root.join("src/app.tsx"), "source\n").expect("seed source");
        fs::write(root.join("components/app.tsx"), "dest\n").expect("seed dest");

        assert_eq!(
            reason_of(move_workspace_path(
                root,
                "src/app.tsx",
                "components/app.tsx"
            ))
            .as_deref(),
            Some("pathAlreadyExists")
        );
        assert_eq!(
            fs::read_to_string(root.join("src/app.tsx")).expect("read source"),
            "source\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("components/app.tsx")).expect("read dest"),
            "dest\n"
        );
    }

    #[test]
    fn move_workspace_path_rejects_move_into_self() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        fs::create_dir_all(root.join("src/components/ui")).expect("seed dir");

        assert_eq!(
            reason_of(move_workspace_path(
                root,
                "src/components",
                "src/components/ui/components"
            ))
            .as_deref(),
            Some("pathMoveIntoSelf")
        );
        assert!(root.join("src/components/ui").is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn copy_project_worktree_path_rejects_symlink_escape() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path().join("workspace");
        fs::create_dir_all(&root).expect("seed root");
        let outside = temp_dir.path().join("outside");
        fs::create_dir_all(&outside).expect("seed outside");
        fs::write(outside.join("secret.txt"), "secret\n").expect("seed secret");
        std::os::unix::fs::symlink(&outside, root.join("linked")).expect("symlink");
        fs::create_dir(root.join("nested")).expect("seed nested");

        let error = copy_workspace_path(root.as_path(), "linked/secret.txt", "nested/secret.txt")
            .expect_err("copy_project_worktree_path");
        assert!(error.reason.is_some());
        assert_eq!(
            fs::read_to_string(outside.join("secret.txt")).expect("read outside"),
            "secret\n"
        );
        assert!(!root.join("nested/secret.txt").exists());
    }

    #[cfg(unix)]
    #[test]
    fn move_project_worktree_path_rejects_symlink_escape() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path().join("workspace");
        fs::create_dir_all(&root).expect("seed root");
        let outside = temp_dir.path().join("outside");
        fs::create_dir_all(&outside).expect("seed outside");
        fs::write(outside.join("secret.txt"), "secret\n").expect("seed secret");
        std::os::unix::fs::symlink(&outside, root.join("linked")).expect("symlink");
        fs::create_dir(root.join("nested")).expect("seed nested");

        let error = move_workspace_path(root.as_path(), "linked/secret.txt", "nested/secret.txt")
            .expect_err("move_project_worktree_path");
        assert!(error.reason.is_some());
        assert_eq!(
            fs::read_to_string(outside.join("secret.txt")).expect("read outside"),
            "secret\n"
        );
        assert!(outside.join("secret.txt").is_file());
        assert!(!root.join("nested/secret.txt").exists());
    }
}
