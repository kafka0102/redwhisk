use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use chrono::{DateTime, Utc};

use crate::db::app_update_repository::AppUpdateRepository;
use crate::db::connection::DatabaseConfig;
use crate::db::migrations::MigrationRunner;
use crate::types::app_update::{
    AppUpdateStateRecord, DismissUpdatePromptAction, DismissUpdatePromptInput,
    UpdateCheckErrorCode, UpdateStatus,
};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

use super::github::{
    GitHubLatestReleaseSource, LatestRelease, LatestReleaseFetchError, LatestReleaseSource,
};
use super::version::{is_newer_version, strip_version_prefix};

/// 检查结果缓存 TTL。
pub const UPDATE_CHECK_CACHE_TTL: Duration = Duration::from_secs(60 * 60);

const SNOOZE_DURATION: Duration = Duration::from_secs(60 * 60 * 24 * 7);

/// 进程内串行化远端检查：多窗口冷启动时合并为一次网络请求（持锁后二次读缓存）。
static UPDATE_NETWORK_FETCH_LOCK: Mutex<()> = Mutex::new(());

pub struct AppUpdateService<'connection, S> {
    repository: AppUpdateRepository<'connection>,
    release_source: S,
    current_version: String,
    now: DateTime<Utc>,
}

impl<'connection, S: LatestReleaseSource> AppUpdateService<'connection, S> {
    pub fn new(
        repository: AppUpdateRepository<'connection>,
        release_source: S,
        current_version: impl Into<String>,
        now: DateTime<Utc>,
    ) -> Self {
        Self {
            repository,
            release_source,
            current_version: strip_version_prefix(&current_version.into()).to_string(),
            now,
        }
    }

    pub fn get_status(&self, force_refresh: bool) -> Result<UpdateStatus, CommandError> {
        let state = self.repository.get_state().map_err(update_database_error)?;

        // 快路径：缓存仍新鲜且非强制刷新，无需抢全局锁。
        if !force_refresh && self.cache_is_fresh(&state) {
            return Ok(self.build_status_from_state(&state, None));
        }

        // 持锁合并 inflight：并发窗口在缓存过期时只打一次远端。
        let _fetch_guard = UPDATE_NETWORK_FETCH_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        // 持锁后二次读取：可能已被其它窗口写满新鲜缓存。
        let mut state = self.repository.get_state().map_err(update_database_error)?;
        if !force_refresh && self.cache_is_fresh(&state) {
            return Ok(self.build_status_from_state(&state, None));
        }

        match self.fetch_and_cache() {
            Ok(updated) => {
                state = updated;
            }
            Err(error_code) => {
                // 失败也刷新 last_checked_at（保留旧版本缓存），避免 Workbench 每次挂载
                // 在 TTL 内反复请求 GitHub。远端超时可达 HTTP_TIMEOUT（15s），且历史
                // 实现是同步 command，会放大项目打开/切换时的首屏卡顿。
                let checked_at = format_rfc3339(self.now);
                let _ = self.repository.save_cache(
                    &checked_at,
                    state.cached_latest_version.as_deref(),
                    state.cached_release_url.as_deref(),
                );
                state.last_checked_at = Some(checked_at);

                if force_refresh {
                    return Ok(self.build_status_from_state(&state, Some(error_code)));
                }
                // 启动/静默路径：网络失败不暴露 error，尽量用旧缓存判定。
                return Ok(self.build_status_from_state(&state, None));
            }
        }

        if force_refresh {
            // 手动检查成功后清除 snooze。
            self.repository
                .save_snooze_until(None)
                .map_err(update_database_error)?;
            state.snooze_until = None;
        }

        Ok(self.build_status_from_state(&state, None))
    }

    pub fn dismiss(&self, input: DismissUpdatePromptInput) -> Result<UpdateStatus, CommandError> {
        let state = self.repository.get_state().map_err(update_database_error)?;

        match input.action {
            DismissUpdatePromptAction::Snooze7Days => {
                let until = self.now + chrono::Duration::from_std(SNOOZE_DURATION).map_err(|e| {
                    CommandError::new(
                        CommandErrorCode::AppUpdatePersistenceFailed,
                        "无法计算冷却结束时间。",
                    )
                    .with_detail(ErrorDetail::new("Cause").with_value("message", e.to_string()))
                })?;
                let until_text = format_rfc3339(until);
                self.repository
                    .save_snooze_until(Some(&until_text))
                    .map_err(update_database_error)?;
            }
            DismissUpdatePromptAction::IgnoreVersion => {
                let version = state
                    .cached_latest_version
                    .as_deref()
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| {
                        CommandError::new(
                            CommandErrorCode::AppUpdateValidationFailed,
                            "当前没有可忽略的远端版本。",
                        )
                    })?;
                self.repository
                    .save_ignored_version(Some(version))
                    .map_err(update_database_error)?;
            }
        }

        let state = self.repository.get_state().map_err(update_database_error)?;
        Ok(self.build_status_from_state(&state, None))
    }

    fn fetch_and_cache(&self) -> Result<AppUpdateStateRecord, UpdateCheckErrorCode> {
        let latest = self
            .release_source
            .fetch_latest()
            .map_err(map_fetch_error)?;
        let checked_at = format_rfc3339(self.now);
        match latest {
            Some(LatestRelease {
                version,
                release_url,
            }) => {
                self.repository
                    .save_cache(&checked_at, Some(&version), Some(&release_url))
                    .map_err(|_| UpdateCheckErrorCode::Unknown)?;
            }
            None => {
                self.repository
                    .save_cache(&checked_at, None, None)
                    .map_err(|_| UpdateCheckErrorCode::Unknown)?;
            }
        }
        self.repository
            .get_state()
            .map_err(|_| UpdateCheckErrorCode::Unknown)
    }

    fn cache_is_fresh(&self, state: &AppUpdateStateRecord) -> bool {
        let Some(checked_at) = state.last_checked_at.as_deref() else {
            return false;
        };
        let Ok(checked_at) = DateTime::parse_from_rfc3339(checked_at) else {
            return false;
        };
        let checked_at = checked_at.with_timezone(&Utc);
        self.now
            .signed_duration_since(checked_at)
            .to_std()
            .map(|elapsed| elapsed < UPDATE_CHECK_CACHE_TTL)
            .unwrap_or(false)
    }

    fn build_status_from_state(
        &self,
        state: &AppUpdateStateRecord,
        force_error: Option<UpdateCheckErrorCode>,
    ) -> UpdateStatus {
        let latest_version = state.cached_latest_version.clone();
        let release_url = state.cached_release_url.clone();
        let has_update = latest_version
            .as_deref()
            .is_some_and(|latest| is_newer_version(latest, &self.current_version));

        let ignored = state
            .ignored_version
            .as_deref()
            .zip(latest_version.as_deref())
            .is_some_and(|(ignored, latest)| ignored == latest);

        let snoozed = state
            .snooze_until
            .as_deref()
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .map(|value| value.with_timezone(&Utc) > self.now)
            .unwrap_or(false);

        let should_show_prompt = has_update && !ignored && !snoozed;

        UpdateStatus {
            should_show_prompt,
            current_version: self.current_version.clone(),
            has_update,
            latest_version,
            release_url,
            ignored_version: state.ignored_version.clone(),
            snooze_until: state.snooze_until.clone(),
            checked_at: state.last_checked_at.clone(),
            error_code: force_error,
        }
    }
}

fn map_fetch_error(error: LatestReleaseFetchError) -> UpdateCheckErrorCode {
    match error {
        LatestReleaseFetchError::Network => UpdateCheckErrorCode::Network,
        LatestReleaseFetchError::InvalidResponse => UpdateCheckErrorCode::InvalidResponse,
    }
}

pub fn get_update_status_in_data_dir(
    data_dir: impl AsRef<Path>,
    current_version: impl Into<String>,
    force_refresh: bool,
) -> Result<UpdateStatus, CommandError> {
    with_service(data_dir, current_version, |service| {
        service.get_status(force_refresh)
    })
}

pub fn dismiss_update_prompt_in_data_dir(
    data_dir: impl AsRef<Path>,
    current_version: impl Into<String>,
    input: DismissUpdatePromptInput,
) -> Result<UpdateStatus, CommandError> {
    with_service(data_dir, current_version, |service| service.dismiss(input))
}

fn with_service<R>(
    data_dir: impl AsRef<Path>,
    current_version: impl Into<String>,
    f: impl FnOnce(&AppUpdateService<'_, GitHubLatestReleaseSource>) -> Result<R, CommandError>,
) -> Result<R, CommandError> {
    let data_dir = data_dir.as_ref().to_path_buf();
    let database = open_update_database(&data_dir)?;
    let service = AppUpdateService::new(
        AppUpdateRepository::new(&database.connection),
        GitHubLatestReleaseSource::default(),
        current_version,
        Utc::now(),
    );
    f(&service)
}

fn open_update_database(data_dir: &Path) -> Result<crate::db::connection::Database, CommandError> {
    let database = DatabaseConfig::new(data_dir)
        .open()
        .map_err(|error| {
            CommandError::new(
                CommandErrorCode::AppUpdatePersistenceFailed,
                "打开本地数据失败。",
            )
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;
    MigrationRunner::default()
        .run(&database.connection)
        .map_err(update_database_error)?;
    Ok(database)
}

fn format_rfc3339(value: DateTime<Utc>) -> String {
    value.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

fn update_database_error(error: impl ToString) -> CommandError {
    CommandError::new(
        CommandErrorCode::AppUpdatePersistenceFailed,
        "更新状态保存失败。",
    )
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::app_update::github::{LatestRelease, LatestReleaseFetchError};
    use crate::db::app_update_repository::AppUpdateRepository;
    use crate::db::migrations::MigrationRunner;
    use chrono::TimeZone;
    use rusqlite::Connection;
    use std::cell::Cell;
    use std::rc::Rc;

    #[derive(Clone)]
    struct MockSource {
        calls: Rc<Cell<u32>>,
        result: Result<Option<LatestRelease>, LatestReleaseFetchError>,
    }

    impl LatestReleaseSource for MockSource {
        fn fetch_latest(&self) -> Result<Option<LatestRelease>, LatestReleaseFetchError> {
            self.calls.set(self.calls.get() + 1);
            self.result.clone()
        }
    }

    fn open_db() -> Connection {
        let connection = Connection::open_in_memory().expect("db");
        MigrationRunner::default()
            .run(&connection)
            .expect("migrate");
        connection
    }

    fn fixed_now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 7, 14, 12, 0, 0).unwrap()
    }

    fn service<'a>(
        connection: &'a Connection,
        source: MockSource,
        current: &str,
    ) -> AppUpdateService<'a, MockSource> {
        AppUpdateService::new(
            AppUpdateRepository::new(connection),
            source,
            current,
            fixed_now(),
        )
    }

    fn ok_release(version: &str) -> Result<Option<LatestRelease>, LatestReleaseFetchError> {
        Ok(Some(LatestRelease {
            version: version.to_string(),
            release_url: format!("https://github.com/example/r/releases/tag/v{version}"),
        }))
    }

    #[test]
    fn detects_newer_release_and_shows_prompt() {
        let connection = open_db();
        let calls = Rc::new(Cell::new(0));
        let source = MockSource {
            calls: calls.clone(),
            result: ok_release("0.1.0"),
        };
        let status = service(&connection, source, "0.0.3")
            .get_status(false)
            .expect("status");
        assert!(status.has_update);
        assert!(status.should_show_prompt);
        assert_eq!(status.latest_version.as_deref(), Some("0.1.0"));
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn cache_hit_skips_network() {
        let connection = open_db();
        let calls = Rc::new(Cell::new(0));
        let source = MockSource {
            calls: calls.clone(),
            result: ok_release("0.1.0"),
        };
        let svc = service(&connection, source, "0.0.3");
        svc.get_status(false).expect("first");
        svc.get_status(false).expect("second");
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn force_refresh_bypasses_cache_and_clears_snooze() {
        let connection = open_db();
        let calls = Rc::new(Cell::new(0));
        let source = MockSource {
            calls: calls.clone(),
            result: ok_release("0.2.0"),
        };
        let svc = service(&connection, source, "0.0.3");
        svc.get_status(false).expect("warm");
        svc.dismiss(DismissUpdatePromptInput {
            action: DismissUpdatePromptAction::Snooze7Days,
        })
        .expect("snooze");
        let snoozed = svc.get_status(false).expect("snoozed status");
        assert!(!snoozed.should_show_prompt);
        assert!(snoozed.has_update);

        let forced = svc.get_status(true).expect("force");
        assert_eq!(calls.get(), 2);
        assert!(forced.should_show_prompt);
        assert!(forced.snooze_until.is_none());
    }

    #[test]
    fn ignore_version_hides_prompt_until_newer() {
        let connection = open_db();
        let source = MockSource {
            calls: Rc::new(Cell::new(0)),
            result: ok_release("0.1.0"),
        };
        let svc = service(&connection, source, "0.0.3");
        svc.get_status(false).expect("warm");
        let dismissed = svc
            .dismiss(DismissUpdatePromptInput {
                action: DismissUpdatePromptAction::IgnoreVersion,
            })
            .expect("ignore");
        assert!(!dismissed.should_show_prompt);
        assert!(dismissed.has_update);
        assert_eq!(dismissed.ignored_version.as_deref(), Some("0.1.0"));
    }

    #[test]
    fn no_published_release_is_not_update() {
        let connection = open_db();
        let source = MockSource {
            calls: Rc::new(Cell::new(0)),
            result: Ok(None),
        };
        let status = service(&connection, source, "0.0.3")
            .get_status(false)
            .expect("status");
        assert!(!status.has_update);
        assert!(!status.should_show_prompt);
        assert!(status.latest_version.is_none());
    }

    #[test]
    fn local_newer_is_not_update() {
        let connection = open_db();
        let source = MockSource {
            calls: Rc::new(Cell::new(0)),
            result: ok_release("0.0.3"),
        };
        let status = service(&connection, source, "0.1.0")
            .get_status(false)
            .expect("status");
        assert!(!status.has_update);
        assert!(!status.should_show_prompt);
    }

    #[test]
    fn silent_network_error_keeps_no_prompt() {
        let connection = open_db();
        let source = MockSource {
            calls: Rc::new(Cell::new(0)),
            result: Err(LatestReleaseFetchError::Network),
        };
        let status = service(&connection, source, "0.0.3")
            .get_status(false)
            .expect("status");
        assert!(!status.should_show_prompt);
        assert!(status.error_code.is_none());
    }


    #[test]
    fn silent_network_error_negative_caches_within_ttl() {
        let connection = open_db();
        let calls = Rc::new(Cell::new(0));
        let source = MockSource {
            calls: calls.clone(),
            result: Err(LatestReleaseFetchError::Network),
        };
        let svc = service(&connection, source, "0.0.3");
        let first = svc.get_status(false).expect("first");
        assert!(!first.should_show_prompt);
        assert!(first.error_code.is_none());
        // 失败后必须写入检查时间，避免切换项目时在 TTL 内反复打远端。
        let state = AppUpdateRepository::new(&connection)
            .get_state()
            .expect("state");
        assert!(
            state.last_checked_at.is_some(),
            "silent network failure must negative-cache last_checked_at"
        );
        svc.get_status(false).expect("second");
        assert_eq!(
            calls.get(),
            1,
            "second silent check within TTL must not hit network again"
        );
    }


    #[test]
    fn force_network_error_surfaces_stable_error_code() {
        let connection = open_db();
        let source = MockSource {
            calls: Rc::new(Cell::new(0)),
            result: Err(LatestReleaseFetchError::Network),
        };
        let status = service(&connection, source, "0.0.3")
            .get_status(true)
            .expect("status");
        assert_eq!(status.error_code, Some(UpdateCheckErrorCode::Network));
        assert!(!status.should_show_prompt);
    }

    /// 模拟多窗口冷启动：两个线程同时在空缓存下检查，应只触发一次网络请求。
    #[test]
    fn concurrent_stale_checks_share_single_network_fetch() {
        use std::sync::atomic::{AtomicU32, Ordering};
        use std::sync::{Arc, Barrier};
        use std::thread;
        use std::time::Duration;

        #[derive(Clone)]
        struct SlowCountingSource {
            calls: Arc<AtomicU32>,
        }

        impl LatestReleaseSource for SlowCountingSource {
            fn fetch_latest(&self) -> Result<Option<LatestRelease>, LatestReleaseFetchError> {
                let previous = self.calls.fetch_add(1, Ordering::SeqCst);
                // 首个请求稍慢，确保第二个线程在无合并时也会进入 fetch。
                if previous == 0 {
                    thread::sleep(Duration::from_millis(80));
                }
                Ok(Some(LatestRelease {
                    version: "0.2.0".to_string(),
                    release_url: "https://github.com/example/r/releases/tag/v0.2.0"
                        .to_string(),
                }))
            }
        }

        let temp_dir = tempfile::tempdir().expect("temp dir");
        let db_path = temp_dir.path().join("redwhisk.sqlite3");
        {
            let connection = Connection::open(&db_path).expect("open db");
            MigrationRunner::default()
                .run(&connection)
                .expect("migrate");
        }

        let calls = Arc::new(AtomicU32::new(0));
        let barrier = Arc::new(Barrier::new(3));
        let mut handles = Vec::new();

        for _ in 0..2 {
            let db_path = db_path.clone();
            let calls = calls.clone();
            let barrier = barrier.clone();
            handles.push(thread::spawn(move || {
                let connection = Connection::open(&db_path).expect("open db");
                let source = SlowCountingSource {
                    calls: calls.clone(),
                };
                let svc = AppUpdateService::new(
                    AppUpdateRepository::new(&connection),
                    source,
                    "0.0.3",
                    fixed_now(),
                );
                barrier.wait();
                svc.get_status(false).expect("status")
            }));
        }

        barrier.wait();
        let statuses: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().expect("join"))
            .collect();

        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "concurrent cold checks must coalesce into one network fetch"
        );
        for status in statuses {
            assert!(status.has_update);
            assert_eq!(status.latest_version.as_deref(), Some("0.2.0"));
        }
    }
}
