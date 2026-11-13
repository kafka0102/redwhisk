pub(crate) mod board;
mod cli;
mod create_cli;
mod forge_process;
mod gitlab;
mod parse;
mod port;
mod sync;

pub(crate) use cli::view_remote_issue;
pub(crate) use cli::ProjectIssueForge;
pub(crate) use cli::{close_remote_issue, comment_remote_issue};
pub(crate) use forge_process::capture_forge_stdout;
pub(crate) use port::RemoteIssueState;
pub(crate) use port::{
    ChangeRequestWriteError, ForgeIssueDraft, ForgeIssueError, ForgeIssuePort, RemoteChangeRequest,
    RemoteChangeRequestDetails, RemoteIssue,
};

#[cfg(test)]
pub(crate) use behavior::support::{ready_github_project, seed_remote_issue, set_auth, set_mode};
#[cfg(test)]
pub(crate) use forge_process::with_captured_forge_dirs;
#[cfg(test)]
pub(crate) use port::{open_issue, FixedForge};
#[cfg(test)]
pub(crate) use sync::sync_project_issues;

pub(crate) use board::load_issue_board;
pub(crate) use board::IssueBoardListResponse;
pub(crate) use sync::sync_connected_issues;

#[cfg(test)]
mod behavior;

#[cfg(test)]
mod tests {
    use super::behavior::support::ready_github_project;
    use super::behavior::support::seed_remote_issue;
    use super::behavior::support::set_mode;
    use super::board::list_board_issues;
    use super::board::list_board_page;
    use super::board::list_board_with_source_filter;
    use super::port::{open_issue, FixedForge};
    use super::sync::sync_project_issues;
    use crate::types::issue::IssueStatus;
    use rusqlite::params;
    use rusqlite::Connection;

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
        assert_eq!(listed[0].provider.as_deref(), Some("github"));
    }

    #[test]
    fn source_filter_local_returns_only_local_issue() {
        let harness = ready_github_project("all_open", None);
        harness
            .connection
            .execute(
                "INSERT INTO issues (
                    project_id, number, title, description, status, source, created_at, updated_at,
                    status_changed_at, del
                 ) VALUES (?1, 12, 'local-12', 'body', 'backlog', 'local', 10, 20, 20, 0)",
                params![harness.project_id],
            )
            .expect("local issue");
        seed_remote_issue(
            &harness.connection,
            harness.project_id,
            "backlog",
            "gh-128",
            128,
            "open",
            false,
        );
        seed_remote_issue(
            &harness.connection,
            harness.project_id,
            "running",
            "gh-130",
            130,
            "open",
            false,
        );

        let listed =
            list_board_with_source_filter(&harness.connection, harness.project_id, "local")
                .expect("list");

        assert_eq!(
            listed.issues.len(),
            1,
            "local filter keeps only the local issue"
        );
        assert_eq!(listed.issues[0].issue.number, 12);
        assert_eq!(listed.issues[0].source, "local");
        assert_eq!(listed.issues[0].issue.status, IssueStatus::Backlog);
        let totals = listed.status_totals.expect("filtered totals");
        assert_eq!(totals.backlog, 1);
        assert_eq!(totals.running, 0);
    }

    #[test]
    fn source_filter_remote_hides_local_issue() {
        let harness = mixed_board();
        let listed =
            list_board_with_source_filter(&harness.connection, harness.project_id, "remote")
                .expect("list");

        assert_eq!(listed.issues.len(), 2);
        assert!(listed.issues.iter().all(|issue| issue.source == "remote"));
        assert!(listed.issues.iter().all(|issue| issue.issue.number != 12));
        let totals = listed.status_totals.expect("totals");
        assert_eq!(totals.backlog, 1);
        assert_eq!(totals.running, 1);
    }

    #[test]
    fn source_filter_blank_and_all_keep_every_visible_issue() {
        let harness = mixed_board();
        let blank = list_board_page(
            &harness.connection,
            harness.project_id,
            Some(""),
            None,
            None,
            None,
            None,
        )
        .expect("blank");
        let absent = list_board_page(
            &harness.connection,
            harness.project_id,
            None,
            None,
            None,
            None,
            None,
        )
        .expect("absent");
        let all = list_board_with_source_filter(&harness.connection, harness.project_id, "all")
            .expect("all");

        assert_eq!(blank.issues.len(), 3);
        assert_eq!(absent.issues.len(), 3);
        assert_eq!(all.issues.len(), 3);
        let totals = blank.status_totals.expect("totals");
        assert_eq!(totals.backlog, 2);
        assert_eq!(totals.running, 1);
        assert_eq!(absent.status_totals, blank.status_totals);
        assert_eq!(all.status_totals, blank.status_totals);
    }

    #[test]
    fn source_filter_is_ignored_outside_mixed_mode() {
        let harness = mixed_board();
        set_mode(&harness.connection, harness.project_id, "local");
        let listed =
            list_board_with_source_filter(&harness.connection, harness.project_id, "remote")
                .expect("list");

        assert_eq!(listed.issues.len(), 1);
        assert_eq!(listed.issues[0].issue.number, 12);
        assert_eq!(listed.issues[0].source, "local");
    }

    #[test]
    fn source_filter_local_page_keeps_backlog_total() {
        let harness = ready_github_project("all_open", None);
        for number in 1..=6 {
            insert_local(
                &harness.connection,
                harness.project_id,
                number,
                "backlog",
                1,
            );
        }
        seed_remote_issue(
            &harness.connection,
            harness.project_id,
            "backlog",
            "gh-128",
            128,
            "open",
            false,
        );

        let listed = list_board_page(
            &harness.connection,
            harness.project_id,
            Some("local"),
            None,
            None,
            None,
            Some(5),
        )
        .expect("list");

        assert_eq!(listed.issues.len(), 5);
        assert!(listed.issues.iter().all(|issue| issue.source == "local"));
        let totals = listed.status_totals.expect("totals");
        assert_eq!(totals.backlog, 6);
        assert_eq!(totals.running, 0);
    }

    fn mixed_board() -> super::behavior::support::Harness {
        let harness = ready_github_project("all_open", None);
        insert_local(&harness.connection, harness.project_id, 12, "backlog", 20);
        seed_remote_issue(
            &harness.connection,
            harness.project_id,
            "backlog",
            "gh-128",
            128,
            "open",
            false,
        );
        seed_remote_issue(
            &harness.connection,
            harness.project_id,
            "running",
            "gh-130",
            130,
            "open",
            false,
        );
        harness
    }

    fn insert_local(
        connection: &Connection,
        project_id: i64,
        number: i64,
        status: &str,
        status_changed_at: i64,
    ) {
        connection
            .execute(
                "INSERT INTO issues (
                    project_id, number, title, description, status, source, created_at, updated_at,
                    status_changed_at, del
                 ) VALUES (?1, ?2, 'local', 'body', ?3, 'local', 10, 20, ?4, 0)",
                params![project_id, number, status, status_changed_at],
            )
            .expect("local issue");
    }
}
