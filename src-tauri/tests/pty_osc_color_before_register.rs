//! 反馈环：Agent Session spawn→register 窗口内必须应答 Codex OSC 11。
//!
//! Codex TUI 启动约 100ms 内探测默认背景；若等到 DB register 后才启动 PTY reader，
//! 底部 composer 退回默认背景，与输出区同色。终端页手动跑 codex 时 reader 已就绪，
//! 故只有 Agent TUI 路径会中招。

use redwhisk_lib::agent::pty_session_manager::{
    PtyCommandMode, PtySessionManager, PtySpawnRequest,
};
use std::thread;
use std::time::{Duration, Instant};

#[test]
fn answers_osc_11_before_register_within_codex_probe_budget() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let log_path = temp_dir.path().join("osc-probe.log");
    let probe_path = temp_dir.path().join("osc_probe.py");
    // 独立脚本 + setraw：规范模式下无换行的 OSC 应答不会从 stdin 可读。
    std::fs::write(
        &probe_path,
        concat!(
            "import sys, select, os, tty, termios\n",
            "fd = sys.stdin.fileno()\n",
            "old = termios.tcgetattr(fd)\n",
            "tty.setraw(fd)\n",
            "try:\n",
            "    sys.stdout.buffer.write(bytes([0x1B]) + b']11;?' + bytes([0x1B]) + b'\\\\')\n",
            "    sys.stdout.buffer.flush()\n",
            "    ready, _, _ = select.select([sys.stdin], [], [], 0.1)\n",
            "    if not ready:\n",
            "        sys.stdout.buffer.write(b'OSC_TIMEOUT\\n')\n",
            "        sys.stdout.buffer.flush()\n",
            "        raise SystemExit(0)\n",
            "    data = os.read(fd, 256)\n",
            "    sys.stdout.buffer.write(b'OSC_OK\\n' if b'rgb:' in data else b'OSC_BAD\\n')\n",
            "    sys.stdout.buffer.flush()\n",
            "finally:\n",
            "    termios.tcsetattr(fd, termios.TCSADRAIN, old)\n",
        ),
    )
    .expect("write probe script");

    let manager = PtySessionManager::new();
    let pending = manager
        .spawn_pending(&PtySpawnRequest {
            mode: PtyCommandMode::ExecReplace,
            command: format!("python3 '{}'", probe_path.display()),
            working_dir: temp_dir.path().to_string_lossy().to_string(),
            log_path: log_path.to_string_lossy().to_string(),
            initial_prompt: None,
            rows: 24,
            cols: 80,
            startup_check_total_ms: 0,
            startup_check_interval_ms: 1,
        })
        .expect("spawn probe");

    // 故意拖延 register，模拟 Agent Session DB 事务窗口。
    thread::sleep(Duration::from_millis(200));

    manager
        .register_for_project(1, 9001, pending, |_| {})
        .expect("register probe");

    let deadline = Instant::now() + Duration::from_secs(3);
    let mut content = String::new();
    while Instant::now() < deadline {
        content = std::fs::read_to_string(&log_path).unwrap_or_default();
        if content.contains("OSC_OK")
            || content.contains("OSC_TIMEOUT")
            || content.contains("OSC_BAD")
        {
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }

    assert!(
        content.contains("OSC_OK"),
        "expected OSC 11 reply before delayed register; log was: {content:?}"
    );
}
