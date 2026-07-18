use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::db::connection::DatabaseConfig;
use crate::db::migrations::MigrationRunner;
use crate::db::user_profile_repository::UserProfileRepository;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::user_profile::{UpdateUserProfileInput, UserProfileRecord};

const AVATARS_DIRECTORY_NAME: &str = "avatars";
const MAX_NAME_LENGTH: usize = 20;

pub struct UserProfileService<'connection> {
    repository: UserProfileRepository<'connection>,
    data_dir: PathBuf,
}

impl<'connection> UserProfileService<'connection> {
    pub fn new(repository: UserProfileRepository<'connection>, data_dir: impl AsRef<Path>) -> Self {
        Self {
            repository,
            data_dir: data_dir.as_ref().to_path_buf(),
        }
    }

    pub fn get_profile(&self) -> Result<UserProfileRecord, CommandError> {
        self.repository
            .get_profile()
            .map_err(profile_database_error)
    }

    pub fn update_profile(
        &self,
        input: UpdateUserProfileInput,
    ) -> Result<UserProfileRecord, CommandError> {
        if let Some(name) = input.name {
            self.repository
                .save_name(&validate_name(&name)?)
                .map_err(profile_database_error)?;
        }

        if let Some(source_path) = input.avatar_source_path {
            let avatar_path = self.save_avatar(&source_path)?;
            self.repository
                .save_avatar_path(&avatar_path.to_string_lossy())
                .map_err(profile_database_error)?;
        }

        self.get_profile()
    }

    fn save_avatar(&self, source_path: &str) -> Result<PathBuf, CommandError> {
        let source_path = Path::new(source_path);
        let extension = image_extension(source_path)?;
        let avatars_dir = self.data_dir.join(AVATARS_DIRECTORY_NAME);
        fs::create_dir_all(&avatars_dir).map_err(profile_avatar_error)?;
        let avatar_path = avatars_dir.join(format!("profile.{extension}"));
        let (width, height) = read_image_dimensions(source_path)?;

        if width == height {
            fs::copy(source_path, &avatar_path).map_err(profile_avatar_error)?;
            return Ok(avatar_path);
        }

        let side = width.min(height).to_string();
        let source_path_string = source_path.to_string_lossy().to_string();
        let avatar_path_string = avatar_path.to_string_lossy().to_string();
        let output = Command::new("sips")
            .args([
                "--cropToHeightWidth",
                &side,
                &side,
                &source_path_string,
                "--out",
                &avatar_path_string,
            ])
            .output()
            .map_err(profile_avatar_error)?;
        if !output.status.success() {
            return Err(profile_avatar_error(String::from_utf8_lossy(
                &output.stderr,
            )));
        }
        Ok(avatar_path)
    }
}

impl UserProfileService<'_> {
    pub fn get_profile_in_data_dir(
        data_dir: impl AsRef<Path>,
    ) -> Result<UserProfileRecord, CommandError> {
        let database = open_user_profile_database(data_dir.as_ref())?;
        UserProfileService::new(UserProfileRepository::new(&database.connection), data_dir)
            .get_profile()
    }

    pub fn update_profile_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: UpdateUserProfileInput,
    ) -> Result<UserProfileRecord, CommandError> {
        let database = open_user_profile_database(data_dir.as_ref())?;
        UserProfileService::new(UserProfileRepository::new(&database.connection), data_dir)
            .update_profile(input)
    }
}

fn image_extension(path: &Path) -> Result<String, CommandError> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    match extension.as_deref() {
        Some("png" | "jpg" | "jpeg" | "webp") => Ok(extension.expect("checked")),
        _ => Err(CommandError::new(
            CommandErrorCode::UserProfileValidationFailed,
            "头像必须是 PNG、JPG 或 WebP 图片。",
        )
        .with_reason("avatarFormatInvalid")),
    }
}

fn read_image_dimensions(path: &Path) -> Result<(u32, u32), CommandError> {
    let path_string = path.to_string_lossy().to_string();
    let output = Command::new("sips")
        .args(["-g", "pixelWidth", "-g", "pixelHeight", &path_string])
        .output()
        .map_err(profile_avatar_error)?;
    if !output.status.success() {
        return Err(profile_avatar_error(String::from_utf8_lossy(
            &output.stderr,
        )));
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let width = sips_dimension(&text, "pixelWidth")?;
    let height = sips_dimension(&text, "pixelHeight")?;
    Ok((width, height))
}

fn sips_dimension(output: &str, key: &str) -> Result<u32, CommandError> {
    output
        .lines()
        .find_map(|line| line.trim().strip_prefix(key))
        .and_then(|line| line.trim().strip_prefix(':'))
        .and_then(|value| value.trim().parse().ok())
        .ok_or_else(|| profile_avatar_error("无法读取头像尺寸。"))
}

fn validate_name(name: &str) -> Result<String, CommandError> {
    if name.chars().count() <= MAX_NAME_LENGTH {
        return Ok(name.to_string());
    }

    Err(CommandError::new(
        CommandErrorCode::UserProfileValidationFailed,
        "用户名不能超过 20 个字符。",
    )
    .with_reason("nameTooLong")
    .with_detail(ErrorDetail::new("Field").with_value("name", "name")))
}

fn open_user_profile_database(
    data_dir: impl AsRef<Path>,
) -> Result<crate::db::connection::Database, CommandError> {
    let database = DatabaseConfig::new(data_dir)
        .open()
        .map_err(CommandError::from)?;
    MigrationRunner::default()
        .run(&database.connection)
        .map_err(profile_database_error)?;
    Ok(database)
}

fn profile_database_error(error: impl ToString) -> CommandError {
    CommandError::new(
        CommandErrorCode::UserProfilePersistenceFailed,
        "个人资料保存失败。",
    )
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}

fn profile_avatar_error(error: impl ToString) -> CommandError {
    CommandError::new(
        CommandErrorCode::UserProfilePersistenceFailed,
        "头像保存失败。",
    )
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}
