use std::path::{Path, PathBuf};

use tauri::Manager;

pub const REDWHISK_DATA_DIR_NAME: &str = ".redwhisk";

pub fn redwhisk_data_dir(app: &tauri::AppHandle) -> tauri::Result<PathBuf> {
    Ok(redwhisk_data_dir_from_home(app.path().home_dir()?))
}

pub fn redwhisk_data_dir_from_home(home_dir: impl AsRef<Path>) -> PathBuf {
    home_dir.as_ref().join(REDWHISK_DATA_DIR_NAME)
}

/// 从 RedWhisk `data_dir` 解析用户 home（provider 配置根：`~/.codex` / `~/.claude`）。
///
/// 生产路径通常为 `$HOME/.redwhisk`，此时 parent 即用户 home。
/// 测试或自定义 `data_dir` 文件名不是 `.redwhisk` 时，不取 parent，回退 `$HOME`。
pub fn user_home_from_data_dir(data_dir: &Path) -> Option<PathBuf> {
    if data_dir
        .file_name()
        .and_then(|name| name.to_str())
        == Some(REDWHISK_DATA_DIR_NAME)
    {
        return data_dir.parent().map(|path| path.to_path_buf());
    }

    std::env::var_os("HOME").map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{redwhisk_data_dir_from_home, user_home_from_data_dir, REDWHISK_DATA_DIR_NAME};

    #[test]
    fn redwhisk_data_dir_uses_hidden_directory_under_home() {
        let data_dir = redwhisk_data_dir_from_home(PathBuf::from("/Users/alice"));

        assert_eq!(data_dir, PathBuf::from("/Users/alice/.redwhisk"));
    }

    #[test]
    fn user_home_from_redwhisk_data_dir_uses_parent() {
        let data_dir = PathBuf::from("/Users/alice").join(REDWHISK_DATA_DIR_NAME);

        assert_eq!(
            user_home_from_data_dir(&data_dir),
            Some(PathBuf::from("/Users/alice"))
        );
    }

    #[test]
    fn user_home_from_custom_data_dir_does_not_use_parent() {
        let data_dir = PathBuf::from("/tmp/custom-redwhisk-data");
        let home = user_home_from_data_dir(&data_dir);

        assert_ne!(home, data_dir.parent().map(|path| path.to_path_buf()));
        assert_eq!(home, std::env::var_os("HOME").map(PathBuf::from));
    }
}
