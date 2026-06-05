use std::path::Path;

pub fn is_git_repository(path: impl AsRef<Path>) -> bool {
    let path = path.as_ref();

    if !path.is_dir() {
        return false;
    }

    let git_metadata_path = path.join(".git");
    git_metadata_path.is_dir() || git_metadata_path.is_file()
}
