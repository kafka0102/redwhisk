use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project_terminal_shortcut_command::ProjectTerminalShortcutCommandRecord;

const PROJECT_TERMINAL_SHORTCUT_COMMAND_MAX_LENGTH: usize = 500;

pub(super) fn shortcut_command_record_from_row(
    row: crate::db::project_terminal_shortcut_command_repository::ProjectTerminalShortcutCommandRow,
) -> ProjectTerminalShortcutCommandRecord {
    ProjectTerminalShortcutCommandRecord {
        id: row.id,
        project_id: row.project_id,
        command: row.command,
        sort_order: row.sort_order,
    }
}

pub(super) fn validate_shortcut_command(command: &str) -> Result<String, CommandError> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::ProjectTerminalValidationFailed,
            "常用命令不能为空。",
        )
        .with_reason("shortcutRequired")
        .with_detail(ErrorDetail::new("Field").with_value("name", "command")));
    }
    if trimmed.chars().count() > PROJECT_TERMINAL_SHORTCUT_COMMAND_MAX_LENGTH {
        return Err(CommandError::new(
            CommandErrorCode::ProjectTerminalValidationFailed,
            "常用命令过长。",
        )
        .with_reason("shortcutTooLong")
        .with_detail(
            ErrorDetail::new("Field")
                .with_value("name", "command")
                .with_value("limit", PROJECT_TERMINAL_SHORTCUT_COMMAND_MAX_LENGTH),
        ));
    }
    Ok(trimmed.to_string())
}
