pub mod change_request_commands;
pub mod commands;
mod completion_defaults;
mod service;

#[cfg(test)]
mod completion_host_class_tests;
#[cfg(test)]
mod completion_settings_tests;

pub use service::ProjectService;
