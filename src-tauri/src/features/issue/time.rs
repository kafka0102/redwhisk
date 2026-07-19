use std::time::{SystemTime, UNIX_EPOCH};

use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

pub(crate) fn current_epoch_millis_for_db() -> rusqlite::Result<i64> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| rusqlite::Error::InvalidQuery)?;

    i64::try_from(duration.as_millis()).map_err(|_| rusqlite::Error::InvalidQuery)
}

pub(crate) fn current_epoch_millis() -> Result<i64, CommandError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| {
            CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 保存失败。")
                .with_reason("saveFailed")
                .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;

    i64::try_from(duration.as_millis()).map_err(|error| {
        CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 保存失败。")
            .with_reason("saveFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })
}
