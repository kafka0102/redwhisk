#[cfg(test)]
mod list_command_tests;

#[cfg(test)]
mod list_url_tests;

#[cfg(test)]
mod sync_command_tests;

#[cfg(test)]
mod link_command_tests;

#[cfg(test)]
mod detail_command_tests;

#[cfg(test)]
mod ready_review_close_tests;

#[cfg(test)]
mod merge_action_tests;

mod actions_cli;
pub mod commands;
mod detail;
mod detail_cli;
mod detail_parse;
mod detail_snapshot;
mod links;
mod list;
mod parse;
mod pull_request_url;
mod sync;

#[cfg(test)]
pub(crate) use crate::types::change_request::ChangeRequestSyncOutcome;
pub(crate) use actions_cli::merge_request;
pub(crate) use actions_cli::{close_request, mark_ready, request_review};
#[cfg(test)]
pub(crate) use detail::close_change_request;
#[cfg(test)]
pub(crate) use detail::get_project_change_request;
#[cfg(test)]
pub(crate) use detail::mark_change_request_ready;
#[cfg(test)]
pub(crate) use detail::merge_change_request;
#[cfg(test)]
pub(crate) use detail::request_change_request_review;
pub(crate) use detail_cli::{
    fetch_github_change_request_details, fetch_gitlab_change_request_details,
};
#[cfg(test)]
pub(crate) use detail_parse::{
    parse_github_change_request_details, parse_gitlab_change_request_details,
};
#[cfg(test)]
pub(crate) use links::link_change_request_issue;
#[cfg(test)]
pub(crate) use list::list_project_change_requests;
pub(crate) use parse::{parse_github_pull_request_list, parse_gitlab_merge_request_list};
#[cfg(test)]
pub(crate) use sync::sync_project_change_requests;
