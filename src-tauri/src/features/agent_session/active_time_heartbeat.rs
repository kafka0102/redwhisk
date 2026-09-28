//! 活跃时长心跳：应用运行期按固定间隔把可信的活跃毫秒累加到会话累计处理时长，
//! 并在同一循环内推进 TUI + Codex 会话的 session log 用量同步。
//!
//! 间隔判定见 [`super::active_time`]；写入范围与 Turn 边界夹取见
//! [`AgentSessionRepository::accumulate_active_time_ms`]。口径见
//! `docs/adr/0043-session-duration-active-time.md`；TUI session log 同步见
//! `docs/adr/0046-tui-session-log-usage-from-heartbeat.md`。

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::AppHandle;

use super::active_time::{active_ms_between, ActiveTimeSample};
use super::resolve_codex_home;
use super::tui_session_metrics_sync::TuiSessionMetricsSync;
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::connection::DatabaseConfig;
use crate::local_data_path::redwhisk_data_dir;

/// 心跳间隔：每 5 秒推进一次活跃时长。
const ACTIVE_TIME_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);

/// 启动活跃时长心跳后台线程；应用 setup 阶段调用一次。
pub fn spawn_active_time_heartbeat(app_handle: AppHandle) {
    std::thread::spawn(move || run_active_time_heartbeat(app_handle));
}

fn run_active_time_heartbeat(app_handle: AppHandle) {
    let Ok(data_dir) = redwhisk_data_dir(&app_handle) else {
        return;
    };
    // 统一开库配置（WAL + busy_timeout），与其他窗口的连接并发写时不再互斥失败。
    let Ok(database) = DatabaseConfig::new(&data_dir).open() else {
        return;
    };
    let repository = AgentSessionRepository::new(&database.connection);
    let codex_home = resolve_codex_home();
    let mut tui_metrics_sync = TuiSessionMetricsSync::new();
    let mut previous = current_sample();
    loop {
        std::thread::sleep(ACTIVE_TIME_HEARTBEAT_INTERVAL);
        let current = current_sample();
        let active_ms = active_ms_between(previous, current);
        previous = current;
        // 挂起 / 墙钟跳变的间隔零写入：json 活跃时长只对「运行中且 Turn 在跑」的会话累加。
        if active_ms > 0 {
            if let Err(error) =
                repository.accumulate_active_time_ms(active_ms, current.wall_clock_ms)
            {
                eprintln!("[agent_session] 活跃时长心跳写入失败：{error:?}");
            }
        }
        // 同一循环内推进 TUI + Codex session log 用量同步；与 json 活跃时长按
        // `display_mode` 互斥（本路径只覆盖 tui）。失败静默跳过、不中断线程。
        tui_metrics_sync.sync_once(&repository, codex_home.as_deref());
    }
}

fn current_sample() -> ActiveTimeSample {
    ActiveTimeSample {
        wall_clock_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_millis() as i64)
            .unwrap_or_default(),
        monotonic: Instant::now(),
    }
}
