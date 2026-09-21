//! 代码工作区路径的新建与删除：新建空文件、新建单层目录、删除文件或目录。
//!
//! 路径守卫复用 `workspace.rs` 的相对路径解析（非空、非绝对、无 `..`、不越出
//! 仓库根，含软链逃逸）；新建额外要求目标名字合法且父目录已存在，因此不会递归创建
//! 中间层。删除为永久删除，不进系统回收站、不提供撤销。

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use crate::types::errors::{CommandError, ErrorDetail};
use crate::types::session_workspace::ProjectWorkspacePathInput;

use super::workspace::{
    resolve_workspace_relative_path, workspace_validation_error, SessionWorkspaceService,
};

impl SessionWorkspaceService<'_> {
    /// 在目标相对路径新建空文件；目标已存在（文件或目录）时失败，不覆盖内容。
    pub fn create_file(&self, input: ProjectWorkspacePathInput) -> Result<(), CommandError> {
        let root = self.workspace_root_for(&input)?;
        create_workspace_file(&root, &input.file_path)
    }

    /// 在目标相对路径新建目录；父目录必须已存在，不递归创建中间层。
    pub fn create_directory(&self, input: ProjectWorkspacePathInput) -> Result<(), CommandError> {
        let root = self.workspace_root_for(&input)?;
        create_workspace_directory(&root, &input.file_path)
    }

    /// 删除目标路径：文件单文件删除，目录连同内容递归删除；永久删除，不可撤销。
    pub fn delete_path(&self, input: ProjectWorkspacePathInput) -> Result<(), CommandError> {
        let root = self.workspace_root_for(&input)?;
        delete_workspace_path(&root, &input.file_path)
    }

    fn workspace_root_for(
        &self,
        input: &ProjectWorkspacePathInput,
    ) -> Result<PathBuf, CommandError> {
        self.resolve_workspace_root(
            input.project_id,
            input.session_id,
            input.workspace_path.as_deref(),
        )
    }
}

fn create_workspace_file(root: &Path, file_path: &str) -> Result<(), CommandError> {
    let target = prepare_new_entry_path(root, file_path)?;
    // create_new 保证「已存在即失败」，不会截断既有文件内容。
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
    {
        Ok(_) => Ok(()),
        Err(error) => Err(creation_error(file_path, &error)),
    }
}

fn create_workspace_directory(root: &Path, file_path: &str) -> Result<(), CommandError> {
    let target = prepare_new_entry_path(root, file_path)?;
    // create_dir 只建一层：父目录不存在时直接失败，不做递归创建。
    match fs::create_dir(&target) {
        Ok(()) => Ok(()),
        Err(error) => Err(creation_error(file_path, &error)),
    }
}

fn delete_workspace_path(root: &Path, file_path: &str) -> Result<(), CommandError> {
    let target = resolve_workspace_relative_path(root, file_path)?;
    let metadata =
        fs::symlink_metadata(&target).map_err(|error| deletion_error(file_path, &error))?;
    let removed = if metadata.is_dir() {
        fs::remove_dir_all(&target)
    } else {
        fs::remove_file(&target)
    };
    removed.map_err(|error| deletion_error(file_path, &error))
}

/// 新建时的目标路径：先校验目标名字，再走既有工作区相对路径守卫。
fn prepare_new_entry_path(root: &Path, file_path: &str) -> Result<PathBuf, CommandError> {
    validate_new_entry_name(file_path)?;
    resolve_workspace_relative_path(root, file_path)
}

/// 新建只创建最后一层，所以「名字」必须是真实名字：不能为空、`.`、`..`，也不能以
/// 分隔符结尾（这些情况下 `file_name()` 拿不到名字）。
fn validate_new_entry_name(file_path: &str) -> Result<(), CommandError> {
    if file_path.ends_with('/') || Path::new(file_path).file_name().is_none() {
        return Err(
            workspace_validation_error("新建名称不合法，不能为空、. 或 ..。", file_path)
                .with_reason("fileNameInvalid"),
        );
    }
    Ok(())
}

fn creation_error(file_path: &str, error: &std::io::Error) -> CommandError {
    if error.kind() == ErrorKind::AlreadyExists {
        return workspace_validation_error("目标已存在。", file_path)
            .with_reason("pathAlreadyExists");
    }
    workspace_validation_error("新建路径失败。", file_path)
        .with_reason("pathCreateFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}

fn missing_path_error(file_path: &str) -> CommandError {
    workspace_validation_error("目标路径不存在。", file_path).with_reason("pathNotFound")
}

fn deletion_error(file_path: &str, error: &std::io::Error) -> CommandError {
    if error.kind() == ErrorKind::NotFound {
        return missing_path_error(file_path);
    }
    workspace_validation_error("删除路径失败。", file_path)
        .with_reason("pathDeleteFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn reason_of(result: Result<(), CommandError>) -> Option<String> {
        result.expect_err("expected command error").reason
    }

    #[test]
    fn create_workspace_file_creates_empty_file_in_target_directory() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        fs::create_dir(root.join("src")).expect("seed dir");

        create_workspace_file(root, "src/notes.md").expect("create file");

        let path = root.join("src/notes.md");
        assert!(path.is_file());
        assert_eq!(fs::read_to_string(&path).expect("read file"), "");
    }

    #[test]
    fn create_workspace_file_rejects_existing_path_without_overwriting() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        fs::write(root.join("notes.md"), "keep me\n").expect("seed file");
        fs::create_dir(root.join("src")).expect("seed dir");

        assert_eq!(
            reason_of(create_workspace_file(root, "notes.md")).as_deref(),
            Some("pathAlreadyExists")
        );
        assert_eq!(
            reason_of(create_workspace_file(root, "src")).as_deref(),
            Some("pathAlreadyExists")
        );
        assert_eq!(
            fs::read_to_string(root.join("notes.md")).expect("read file"),
            "keep me\n"
        );
    }

    #[test]
    fn create_workspace_directory_creates_single_level_inside_existing_directory() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        fs::create_dir(root.join("src")).expect("seed dir");

        create_workspace_directory(root, "src/components").expect("create directory");

        assert!(root.join("src/components").is_dir());
    }

    #[test]
    fn create_rejects_missing_parent_directory_without_creating_it() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();

        assert!(create_workspace_directory(root, "src/components").is_err());
        assert!(create_workspace_file(root, "src/notes.md").is_err());

        assert!(!root.join("src").exists());
    }

    #[test]
    fn create_workspace_directory_rejects_existing_target() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        fs::create_dir(root.join("components")).expect("seed dir");
        fs::write(root.join("notes.md"), "").expect("seed file");

        assert_eq!(
            reason_of(create_workspace_directory(root, "components")).as_deref(),
            Some("pathAlreadyExists")
        );
        assert_eq!(
            reason_of(create_workspace_directory(root, "notes.md")).as_deref(),
            Some("pathAlreadyExists")
        );
    }

    #[test]
    fn delete_workspace_file_removes_nested_file() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        fs::create_dir_all(root.join("src")).expect("seed dir");
        fs::write(root.join("src/main.rs"), "fn main() {}\n").expect("seed file");

        delete_workspace_path(root, "src/main.rs").expect("delete file");

        assert!(!root.join("src/main.rs").exists());
        assert!(root.join("src").is_dir());
    }

    #[test]
    fn delete_workspace_directory_removes_non_empty_tree() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        fs::create_dir_all(root.join("src/nested")).expect("seed dir");
        fs::write(root.join("src/nested/lib.rs"), "pub fn lib() {}\n").expect("seed file");

        delete_workspace_path(root, "src").expect("delete directory");

        assert!(!root.join("src").exists());
    }

    #[test]
    fn delete_workspace_path_rejects_missing_target() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();

        assert_eq!(
            reason_of(delete_workspace_path(root, "missing.txt")).as_deref(),
            Some("pathNotFound")
        );
    }

    #[test]
    fn new_entry_rejects_empty_dot_dotdot_and_trailing_separator_names() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        let invalid_names = ["", ".", "..", "src/", "notes.md/"];

        for name in invalid_names {
            assert_eq!(
                reason_of(create_workspace_file(root, name)).as_deref(),
                Some("fileNameInvalid"),
                "create_workspace_file({name:?})"
            );
            assert_eq!(
                reason_of(create_workspace_directory(root, name)).as_deref(),
                Some("fileNameInvalid"),
                "create_workspace_directory({name:?})"
            );
        }
        // 绝对路径由既有相对路径守卫拒绝，不是「名字」层的问题。
        assert!(create_workspace_file(root, "/etc/passwd").is_err());
    }

    #[test]
    fn new_entry_rejects_path_escaping_workspace() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path().join("workspace");
        fs::create_dir_all(&root).expect("seed root");

        assert!(create_workspace_file(&root, "../outside.txt").is_err());
        assert!(create_workspace_directory(&root, "../../outside").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn new_entry_rejects_creation_through_symlink_escape() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path().join("workspace");
        fs::create_dir_all(&root).expect("seed root");
        let outside = temp_dir.path().join("outside");
        fs::create_dir_all(&outside).expect("seed outside");
        std::os::unix::fs::symlink(&outside, root.join("linked")).expect("symlink");

        assert!(create_workspace_file(&root, "linked/secret.txt").is_err());
        assert!(create_workspace_directory(&root, "linked/nested").is_err());

        assert!(!outside.join("secret.txt").exists());
        assert!(!outside.join("nested").exists());
    }

    #[test]
    fn delete_workspace_path_rejects_path_escaping_workspace() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path().join("workspace");
        fs::create_dir_all(&root).expect("seed root");
        let outside = temp_dir.path().join("outside");
        fs::create_dir_all(&outside).expect("seed outside");
        fs::write(outside.join("secret.txt"), "secret\n").expect("seed outside file");

        assert!(delete_workspace_path(&root, "../outside/secret.txt").is_err());
        assert_eq!(
            reason_of(delete_workspace_path(&root, "..")).as_deref(),
            Some("pathMustBeRelative")
        );
        assert!(outside.join("secret.txt").is_file());
    }

    #[cfg(unix)]
    #[test]
    fn delete_workspace_path_rejects_symlink_escape() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path().join("workspace");
        fs::create_dir_all(&root).expect("seed root");
        let outside = temp_dir.path().join("outside");
        fs::create_dir_all(&outside).expect("seed outside");
        fs::write(outside.join("secret.txt"), "secret\n").expect("seed outside file");
        std::os::unix::fs::symlink(&outside, root.join("linked")).expect("symlink");

        assert!(delete_workspace_path(&root, "linked/secret.txt").is_err());
        assert!(outside.join("secret.txt").is_file());
    }

    #[test]
    fn delete_workspace_path_rejects_workspace_root_itself() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path().join("workspace");
        fs::create_dir_all(root.join("src")).expect("seed root");
        fs::write(root.join("src/main.rs"), "fn main() {}\n").expect("seed file");

        assert!(delete_workspace_path(&root, ".").is_err());
        assert!(delete_workspace_path(&root, "").is_err());
        assert!(root.join("src/main.rs").is_file());
    }
}
