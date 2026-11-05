pub(crate) mod board;
mod cli;
mod parse;
mod port;
mod sync;

pub(crate) use board::enrich_issue_list;
pub(crate) use board::IssueBoardListResponse;
pub(crate) use cli::GithubCliForge;
pub(crate) use sync::sync_project_issues as sync_github_issues;

#[cfg(test)]
mod behavior;

#[cfg(test)]
mod tests {
    use super::behavior::support::ready_github_project;
    use super::board::list_board_issues;
    use super::port::{open_issue, FixedForge};
    use super::sync_github_issues as sync_project_issues;

    #[test]
    fn import_open_github_issue_creates_one_backlog_issue() {
        let harness = ready_github_project("all_open", None);
        let forge = FixedForge::new(vec![open_issue(17, "Imported from GitHub")]);
        sync_project_issues(&harness.connection, harness.project_id, &forge, 1_000).expect("sync");

        let listed = list_board_issues(&harness.connection, harness.project_id).expect("list");
        assert_eq!(listed.len(), 1, "sync creates exactly one issue");
        assert_eq!(listed[0].source, "remote");
        assert_eq!(listed[0].status, crate::types::issue::IssueStatus::Backlog);
        assert_eq!(listed[0].external_number, Some(17));
    }
}
