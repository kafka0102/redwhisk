mod archive;
mod attachment;
pub mod commands;
pub mod completion;
mod completion_comment;
mod detail_read;
mod github_issue_mirror;
mod remote_create;
mod remote_timeline;
mod service;
mod time;
mod validation;

#[cfg(test)]
mod remote_create_test;

pub(crate) use attachment::{analyze_attachment, sanitize_attachment_file_name};
#[cfg(test)]
pub(crate) use remote_create::create_in_data_dir_with_forge;
pub use service::IssueService;

#[cfg(test)]
pub(crate) use github_issue_mirror::{open_issue, FixedForge};

pub use completion_comment::handle_turn_completed;
pub use remote_timeline::{
    upsert_remote_comments, upsert_remote_events, RemoteCommentWrite, RemoteEventWrite,
};
