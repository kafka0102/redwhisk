pub mod change_request_commands;
pub mod commands;
mod completion_defaults;
mod create_issue_source;
mod issue_source;
pub mod issue_source_commands;
mod service;

#[cfg(test)]
mod completion_card_tests;
#[cfg(test)]
mod completion_host_class_tests;
#[cfg(test)]
mod completion_settings_tests;
#[cfg(test)]
mod completion_suggestion_tests;
#[cfg(test)]
mod create_project_issues_tests;
#[cfg(test)]
mod issue_source_count_tests;
#[cfg(test)]
mod issue_source_settings_tests;

pub use service::ProjectService;
