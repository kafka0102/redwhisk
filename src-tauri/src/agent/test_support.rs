use std::sync::{Mutex, MutexGuard};

use super::pty_session_manager::PtySessionManager;

/// 串行化会启动 PTY 或修改进程级环境的测试。
///
/// PTY 启动会读取 `HOME`、`SHELL`、`ZDOTDIR` 和 `PATH`，跨模块并发测试可能读到
/// 另一项测试尚未来得及恢复的临时环境。
pub(crate) fn pty_test_lock() -> MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// 等待 PTY restore buffer 中出现指定 marker。
pub(crate) fn wait_for_pty_marker(manager: &PtySessionManager, session_id: i64, marker: &[u8]) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while std::time::Instant::now() < deadline {
        let snapshot = manager
            .restore_snapshot(session_id)
            .expect("restore snapshot");
        if snapshot
            .chunks
            .iter()
            .any(|chunk| chunk.windows(marker.len()).any(|window| window == marker))
        {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    panic!("session {session_id} did not emit marker");
}
