use std::path::{Path, PathBuf};

use tauri::Manager;

pub const REDWHISK_DATA_DIR_NAME: &str = ".redwhisk";

pub fn redwhisk_data_dir(app: &tauri::AppHandle) -> tauri::Result<PathBuf> {
    Ok(redwhisk_data_dir_from_home(app.path().home_dir()?))
}

pub fn redwhisk_data_dir_from_home(home_dir: impl AsRef<Path>) -> PathBuf {
    home_dir.as_ref().join(REDWHISK_DATA_DIR_NAME)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::redwhisk_data_dir_from_home;

    #[test]
    fn redwhisk_data_dir_uses_hidden_directory_under_home() {
        let data_dir = redwhisk_data_dir_from_home(PathBuf::from("/Users/alice"));

        assert_eq!(data_dir, PathBuf::from("/Users/alice/.redwhisk"));
    }
}
