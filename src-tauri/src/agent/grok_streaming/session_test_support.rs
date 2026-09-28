//! Grok 结构化会话测试的共享夹具。
//!
//! 仅测试编译；被 `session_tests` 与 `session_failure_tests` 复用，避免各写一份
//! 「落盘假 `grok` 脚本 + 握手」的样板。不启真实 grok、不依赖网络与凭据。

use super::*;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// 写入可执行脚本并置 0o755（POSIX）。
pub(super) fn write_script(script_path: &Path, script: &str) {
    fs::write(script_path, script).expect("write fake grok");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(script_path).expect("meta").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(script_path, permissions).expect("chmod");
    }
}

/// 回放假服务端模板并替换 `__LOG__`，返回 (脚本路径, 日志路径)。
pub(super) fn write_fake_template(
    dir: &Path,
    log_name: &str,
    template: &str,
) -> (PathBuf, PathBuf) {
    let log_path = dir.join(log_name);
    let script_path = dir.join(format!("fake-{log_name}.sh"));
    write_script(
        &script_path,
        &template.replace("__LOG__", &log_path.to_string_lossy()),
    );
    (script_path, log_path)
}

/// spawn 假服务端并完成 `initialize` + `session/new` 握手。
pub(super) fn spawn_fake_transport(binary: &Path, cwd: &Path) -> GrokStreamingTransport {
    let transport = GrokStreamingTransport::spawn(
        &binary.to_string_lossy(),
        &["agent".into(), "stdio".into()],
        Some(&cwd.to_string_lossy()),
    )
    .expect("spawn fake grok");
    transport
        .request(INITIALIZE_METHOD, json!({"protocolVersion": 1}))
        .expect("initialize");
    transport
        .request(
            SESSION_NEW_METHOD,
            json!({"cwd": cwd.to_string_lossy(), "mcpServers": []}),
        )
        .expect("session/new");
    transport
}

/// 轮询等待 stderr 尾巴出现指定内容（规避与 stderr 读线程的竞态）。
pub(super) fn wait_for_stderr(transport: &GrokStreamingTransport, needle: &str) -> String {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let tail = transport.stderr_tail();
        if tail.contains(needle) {
            return tail;
        }
        if Instant::now() >= deadline {
            panic!("stderr tail never contained {needle:?}: {tail:?}");
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}
