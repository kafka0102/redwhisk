mod archive;
mod attachment;
pub mod commands;
pub mod completion;
mod completion_comment;
mod detail_read;
mod github_issue_mirror;
pub mod host_attachment;
mod host_attachment_body;
mod remote_create;
mod remote_label_attach;
mod remote_timeline;
mod service;
mod time;
pub mod unavailable_recovery;
mod validation;

#[cfg(test)]
mod attachment_same_name_tests;
#[cfg(test)]
mod host_attachment_fixture;
#[cfg(test)]
mod host_attachment_test;
#[cfg(test)]
mod host_attachment_upload_test;
#[cfg(test)]
mod remote_create_test;

#[cfg(test)]
mod closed_unmerged_reopen_tests;

pub(crate) use attachment::{analyze_attachment, sanitize_attachment_file_name};
#[cfg(test)]
pub(crate) use remote_create::create_in_data_dir_with_forge;
pub use service::IssueService;

pub(crate) use github_issue_mirror::capture_forge_stdout;
pub(crate) use github_issue_mirror::ChangeRequestWriteError;
pub(crate) use github_issue_mirror::ForgeIssueError;
pub(crate) use github_issue_mirror::ProjectIssueForge;
#[cfg(test)]
pub(crate) use github_issue_mirror::{open_issue, FixedForge};
pub(crate) use github_issue_mirror::{
    ForgeIssuePort, RemoteChangeRequest, RemoteChangeRequestDetails,
};

pub use completion_comment::handle_turn_completed;
pub use remote_timeline::{
    upsert_remote_comments, upsert_remote_events, RemoteCommentWrite, RemoteEventWrite,
};
