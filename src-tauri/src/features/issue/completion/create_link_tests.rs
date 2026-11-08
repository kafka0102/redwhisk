use std::fs;
use std::path::Path;
use std::process::Command;

use rusqlite::{params, Connection};
use tempfile::TempDir;

use super::effect_interpreter::EffectContext;
use super::publish::publish_issue_change_request;
use super::state_machine::{CompletionState, CompletionWorld, Effect, FailurePolicy, Transition};
use super::use_case::CompletionFlow;
use crate::agent::session_registry::AgentSessionRegistry;
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::issue_repository::IssueRepository;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::features::issue::detail_read::read_issue_detail;
use crate::features::issue::service::IssueService;
use crate::git::command::with_interactive_path;
use crate::git::operation_state::GitOperationState;
use crate::git::status::GitSnapshot;
use crate::types::agent_session::{WorkspaceMode, WorktreeOwner};
use crate::types::completion_attempt::CompletionAttemptOption;
use crate::types::issue::IssueStatus;
use crate::types::issue_completion::{CloseoutAction, IssueCompletionPhase};
use crate::types::issue_detail::GetIssueDetailInput;
use crate::types::project::ProjectPrTarget;

const CREATED_PULL_REQUEST_URL: &str = "https://github.com/acme/redwhisk/pull/128";

#[test]
fn publish_links_current_issue_to_created_pull_request_once() {
    let fixture = PublishFixture::open();
    let published = fixture.publish_current_issue();
    assert!(
        published.is_ok(),
        "publish should return the created request, got {published:?}"
    );

    let detail = read_issue_detail(
        &fixture.connection,
        &GetIssueDetailInput {
            project_id: 1,
            issue_id: 16,
        },
    )
    .expect("issue detail");
    let matches = detail
        .linked_change_requests
        .iter()
        .filter(|request| request.url == CREATED_PULL_REQUEST_URL)
        .count();
    assert_eq!(matches, 1);
}

#[test]
fn republish_reuses_the_open_pull_request_without_another_create() {
    let fixture = PublishFixture::open();
    fixture.publish_current_issue().expect("first publish");
    let created = fixture.create_count();
    assert_eq!(created, 1);

    fixture.publish_current_issue().expect("reuse publish");

    assert_eq!(fixture.create_count(), created);
    assert_eq!(fixture.linked_count(), 1);
}

#[test]
fn failed_publish_keeps_review_and_does_not_merge_to_base() {
    let fixture = PublishFixture::failing_create();
    let issue = IssueRepository::new(&fixture.connection)
        .find_by_id(16)
        .expect("find issue")
        .expect("issue");
    let session = AgentSessionRepository::new(&fixture.connection)
        .find_by_issue_id(16)
        .expect("find session")
        .expect("session");
    let registry = AgentSessionRegistry::new();
    let world = publish_world();
    let service = IssueService::new(
        IssueRepository::new(&fixture.connection),
        ProjectRepository::new(&fixture.connection),
    );
    let repo_path = fixture.repo_path.clone();
    let command_path = fixture.command_path.clone();
    with_interactive_path(Some(command_path), || {
        let ctx = EffectContext {
            repo_path: repo_path.as_str(),
            issue: &issue,
            session: &session,
            world: &world,
            agent_registry: &registry,
        };
        CompletionFlow::new(&service)
            .interpret_effects(
                &ctx,
                Transition {
                    new_state: CompletionState {
                        phase: IssueCompletionPhase::Completed,
                        ..CompletionState::detecting()
                    },
                    effects: vec![
                        Effect::PublishPullRequest {
                            on_failure: FailurePolicy::Block,
                            base: "main".to_string(),
                            draft: false,
                        },
                        Effect::CommitCompletion {
                            snapshot: world.snapshot.clone(),
                            option: CompletionAttemptOption::CompleteManual,
                        },
                    ],
                },
            )
            .expect("blocked publish");
    });

    let status: String = fixture
        .connection
        .query_row("SELECT status FROM issues WHERE id = 16", [], |row| {
            row.get(0)
        })
        .expect("status");
    assert_eq!(status, "review");
    let merged = Command::new("git")
        .args(["merge-base", "--is-ancestor", &fixture.feature_sha, "main"])
        .current_dir(&fixture.repo_path)
        .status()
        .expect("merge-base");
    assert!(
        !merged.success(),
        "failed create must not merge the feature commit into main"
    );
}

struct PublishFixture {
    _temp: TempDir,
    connection: Connection,
    repo_path: String,
    feature_sha: String,
    command_path: std::ffi::OsString,
    creates: std::path::PathBuf,
}

impl PublishFixture {
    fn open() -> Self {
        Self::open_inner(false)
    }

    fn failing_create() -> Self {
        Self::open_inner(true)
    }

    fn open_inner(fail_create: bool) -> Self {
        let temp = TempDir::new().expect("temp dir");
        let repo = temp.path().join("repo");
        fs::create_dir_all(&repo).expect("repo dir");
        git(&repo, &["init", "-b", "main"]);
        git(&repo, &["config", "user.email", "redwhisk@example.test"]);
        git(&repo, &["config", "user.name", "RedWhisk Test"]);
        fs::write(repo.join("base.txt"), "base\n").expect("base file");
        git(&repo, &["add", "base.txt"]);
        git(&repo, &["commit", "-m", "initial"]);
        git(&repo, &["checkout", "-b", "feature"]);
        fs::write(repo.join("feature.txt"), "feature\n").expect("feature file");
        git(&repo, &["add", "feature.txt"]);
        git(&repo, &["commit", "-m", "feature"]);
        git(
            &repo,
            &[
                "remote",
                "add",
                "origin",
                "https://github.com/acme/redwhisk.git",
            ],
        );
        let feature_sha = git_stdout(&repo, &["rev-parse", "HEAD"]);
        let bin_dir = temp.path().join("bin");
        let creates = temp.path().join("gh-creates");
        fs::create_dir_all(&bin_dir).expect("bin dir");
        write_executable(
            &bin_dir.join("git"),
            "#!/bin/sh\nif [ \"$1\" = \"push\" ]; then\n  exit 0\nfi\nexec /usr/bin/git \"$@\"\n",
        );
        let create_arm = if fail_create {
            "echo 'create failed' >&2\nexit 1\n".to_string()
        } else {
            format!(
                "printf 'create\\n' >> '{creates}'\necho {url}\nexit 0\n",
                creates = creates.display(),
                url = CREATED_PULL_REQUEST_URL,
            )
        };
        let gh = format!(
            "#!/bin/sh\n\
             if [ \"$1\" = \"pr\" ] && [ \"$2\" = \"create\" ]; then\n\
               {create_arm}\
             fi\n\
             if [ \"$1\" = \"pr\" ] && [ \"$2\" = \"list\" ]; then\n\
               if [ -s '{creates}' ]; then\n\
                 printf '%s\\n' '[{{\"url\":\"{url}\"}}]'\n\
               else\n\
                 echo '[]'\n\
               fi\n\
               exit 0\n\
             fi\n\
             echo \"unexpected gh $*\" >&2\n\
             exit 1\n",
            create_arm = create_arm,
            creates = creates.display(),
            url = CREATED_PULL_REQUEST_URL,
        );
        write_executable(&bin_dir.join("gh"), &gh);
        let repo_path = repo.to_string_lossy().to_string();
        let connection = setup_database(&repo_path);
        let mut command_dirs = vec![bin_dir];
        if let Some(path) = std::env::var_os("PATH") {
            command_dirs.extend(std::env::split_paths(&path));
        }
        let command_path = std::env::join_paths(command_dirs).expect("command path");
        Self {
            _temp: temp,
            connection,
            repo_path,
            feature_sha,
            command_path,
            creates,
        }
    }

    fn create_count(&self) -> usize {
        match fs::read_to_string(&self.creates) {
            Ok(text) => text.lines().filter(|line| !line.is_empty()).count(),
            Err(_) => 0,
        }
    }

    fn linked_count(&self) -> usize {
        read_issue_detail(
            &self.connection,
            &GetIssueDetailInput {
                project_id: 1,
                issue_id: 16,
            },
        )
        .expect("issue detail")
        .linked_change_requests
        .iter()
        .filter(|request| request.url == CREATED_PULL_REQUEST_URL)
        .count()
    }

    fn publish_current_issue(&self) -> Result<(), String> {
        let issue = IssueRepository::new(&self.connection)
            .find_by_id(16)
            .expect("find issue")
            .expect("issue");
        let session = AgentSessionRepository::new(&self.connection)
            .find_by_issue_id(16)
            .expect("find session")
            .expect("session");
        let registry = AgentSessionRegistry::new();
        let world = publish_world();
        let repo_path = self.repo_path.clone();
        let command_path = self.command_path.clone();
        with_interactive_path(Some(command_path), || {
            let ctx = EffectContext {
                repo_path: repo_path.as_str(),
                issue: &issue,
                session: &session,
                world: &world,
                agent_registry: &registry,
            };
            publish_issue_change_request(&self.connection, &ctx, "main", false)
        })
    }
}

fn publish_world() -> CompletionWorld {
    CompletionWorld {
        issue_status: IssueStatus::Review,
        workspace_mode: WorkspaceMode::CurrentBranch,
        workspace_missing: false,
        owner: WorktreeOwner::External,
        target_branch: Some("main".to_string()),
        current_branch: Some("feature".to_string()),
        branch_mismatch: false,
        forge_known: true,
        actual_path: String::new(),
        drifted: false,
        session_closed_out: false,
        missing_worktree_error: None,
        snapshot: GitSnapshot {
            head: "abc123".to_string(),
            status_porcelain: String::new(),
            changed_files: vec![],
            operation_state: GitOperationState::None,
            is_clean: true,
        },
        attempt_option: CompletionAttemptOption::CompleteManual,
        confirm_completion_action: false,
        saved_closeout_action: CloseoutAction::OpenPullRequest,
        saved_pr_target: ProjectPrTarget::IssueBase,
        repo_default_branch: Some("main".to_string()),
        saved_closeout_draft: false,
    }
}

fn setup_database(repo_path: &str) -> Connection {
    let connection = Connection::open_in_memory().expect("open database");
    MigrationRunner::default()
        .run(&connection)
        .expect("run migrations");
    connection
        .execute(
            "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
             VALUES (1, 'RedWhisk', ?1, 1, 1)",
            params![repo_path],
        )
        .expect("insert project");
    connection
        .execute(
            "INSERT INTO agent_profiles (id, name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del)
             VALUES (101, 'Codex', 'codex', 'codex', 'project', 1, 'full-auto', 1, '', '', 0)",
            [],
        )
        .expect("insert profile");
    connection
        .execute(
            "INSERT INTO issues (id, project_id, number, title, description, status, label_ids, created_at, updated_at, del)
             VALUES (16, 1, 4, 'Issue 16', 'Ship the flow', 'review', '[]', 1, 1, 0)",
            [],
        )
        .expect("insert issue");
    connection
        .execute(
            "INSERT INTO agent_sessions (
               id, project_id, number, issue_id, title, agent_profile_id, provider_session_id,
               status, attention, working_dir, command_snapshot, prompt_snapshot,
               workspace_mode, target_branch, workspace_branch, workspace_path,
               origin_branch, worktree_owner, log_path,
               list_inserted_at, last_active_at, started_at, closed_at, del
             ) VALUES (
               30, 1, 7, 16, NULL, 101, 'thread-16',
               'stopped', 'none', ?1, 'codex', '',
               'current_branch', NULL, NULL, NULL,
               NULL, 'external', '',
               1, 2, 1, 2, 0
             )",
            params![repo_path],
        )
        .expect("insert session");
    connection
}

fn git(repo: &Path, args: &[&str]) {
    let _ = git_stdout(repo, args);
}

fn git_stdout(repo: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {} failed: {}",
        args.join(" "),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .expect("git stdout")
        .trim()
        .to_string()
}

fn write_executable(path: &Path, body: &str) {
    fs::write(path, body).expect("write executable");
    let mut permissions = fs::metadata(path).expect("metadata").permissions();
    use std::os::unix::fs::PermissionsExt;
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).expect("chmod");
}
