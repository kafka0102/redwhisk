//! 语言智能就绪时序的宿主行为测试。
//!
//! seam：`CodeLanguageHostRegistry` 的既有公开方法 + LSP 线协议 fake 脚本。
//! fake 脚本模拟「项目加载完成前返回本文件 import 子句位置，`$/progress` end 之后返回跨文件位置」。

mod harness;
mod scripted_lsp;

use std::time::{Duration, Instant};

use tempfile::tempdir;

use super::readiness::ReadinessConfig;
use super::registry::CodeLanguageHostRegistry;
use super::rpc::file_uri;
use crate::types::code_language::CodeLanguageHostStatusKind;
use harness::{
    did_open_payload, ensure_scripted, file_paths, loading_scripted, position, prepare_workspace,
    waiting_config, PROJECT_ID,
};
use scripted_lsp::ScriptedLsp;

#[test]
fn definition_request_waits_for_project_load_after_document_opened() {
    let temp_dir = tempdir().expect("temp dir");
    let (root, bundled) = prepare_workspace(temp_dir.path(), "repo");
    let registry = CodeLanguageHostRegistry::new();
    let status = ensure_scripted(
        &registry,
        PROJECT_ID,
        &root,
        &bundled,
        &loading_scripted(&root),
        waiting_config(),
    );
    assert_eq!(status.status, CodeLanguageHostStatusKind::Ready);

    let workspace = root.to_str().expect("utf8").to_string();
    assert!(registry.notify_document(PROJECT_ID, &workspace, &did_open_payload(&root)));

    let started = Instant::now();
    let locations = registry.request_definition(
        PROJECT_ID,
        &workspace,
        &file_uri(&root.join("src/file.ts")),
        &position(),
    );
    let elapsed = started.elapsed();

    assert_eq!(file_paths(&locations), vec!["src/lib.ts".to_string()]);
    assert!(
        elapsed >= Duration::from_millis(600),
        "定义请求应等待项目加载完成，实际 {elapsed:?}"
    );
    registry.stop(PROJECT_ID, &workspace);
}

#[test]
fn references_request_waits_for_project_load_after_document_opened() {
    let temp_dir = tempdir().expect("temp dir");
    let (root, bundled) = prepare_workspace(temp_dir.path(), "repo");
    let registry = CodeLanguageHostRegistry::new();
    let status = ensure_scripted(
        &registry,
        PROJECT_ID,
        &root,
        &bundled,
        &loading_scripted(&root),
        waiting_config(),
    );
    assert_eq!(status.status, CodeLanguageHostStatusKind::Ready);

    let workspace = root.to_str().expect("utf8").to_string();
    assert!(registry.notify_document(PROJECT_ID, &workspace, &did_open_payload(&root)));

    let locations = registry.request_references(
        PROJECT_ID,
        &workspace,
        &file_uri(&root.join("src/file.ts")),
        &position(),
    );

    assert_eq!(file_paths(&locations), vec!["src/lib.ts".to_string()]);
    registry.stop(PROJECT_ID, &workspace);
}

#[test]
fn definition_request_is_not_delayed_when_project_is_not_loading() {
    let temp_dir = tempdir().expect("temp dir");
    let (root, bundled) = prepare_workspace(temp_dir.path(), "repo");
    let registry = CodeLanguageHostRegistry::new();
    let status = ensure_scripted(
        &registry,
        PROJECT_ID,
        &root,
        &bundled,
        &loading_scripted(&root),
        waiting_config(),
    );
    assert_eq!(status.status, CodeLanguageHostStatusKind::Ready);

    let workspace = root.to_str().expect("utf8").to_string();
    let started = Instant::now();
    let locations = registry.request_definition(
        PROJECT_ID,
        &workspace,
        &file_uri(&root.join("src/file.ts")),
        &position(),
    );
    let elapsed = started.elapsed();

    assert_eq!(file_paths(&locations), vec!["src/lib.ts".to_string()]);
    assert!(
        elapsed < Duration::from_millis(250),
        "未处于加载中的请求不应被等待拖慢，实际 {elapsed:?}"
    );
    registry.stop(PROJECT_ID, &workspace);
}

#[test]
fn definition_request_sent_right_after_did_open_does_not_use_pre_load_answer() {
    let temp_dir = tempdir().expect("temp dir");
    let (root, bundled) = prepare_workspace(temp_dir.path(), "repo");
    let registry = CodeLanguageHostRegistry::new();
    let status = ensure_scripted(
        &registry,
        PROJECT_ID,
        &root,
        &bundled,
        &ScriptedLsp {
            early_uri: Some(file_uri(&root.join("src/early.ts"))),
            begin_after: Duration::from_millis(200),
            finish_after: Some(Duration::from_millis(600)),
            ..loading_scripted(&root)
        },
        waiting_config(),
    );
    assert_eq!(status.status, CodeLanguageHostStatusKind::Ready);

    let workspace = root.to_str().expect("utf8").to_string();
    assert!(registry.notify_document(PROJECT_ID, &workspace, &did_open_payload(&root)));

    let locations = registry.request_definition(
        PROJECT_ID,
        &workspace,
        &file_uri(&root.join("src/file.ts")),
        &position(),
    );

    assert_eq!(file_paths(&locations), vec!["src/lib.ts".to_string()]);
    registry.stop(PROJECT_ID, &workspace);
}

#[test]
fn definition_request_falls_back_to_not_ready_when_project_load_never_finishes() {
    let temp_dir = tempdir().expect("temp dir");
    let (root, bundled) = prepare_workspace(temp_dir.path(), "repo");
    let registry = CodeLanguageHostRegistry::new();
    let status = ensure_scripted(
        &registry,
        PROJECT_ID,
        &root,
        &bundled,
        &ScriptedLsp {
            begin_after: Duration::from_millis(50),
            finish_after: None,
            ..loading_scripted(&root)
        },
        // 上限调小，避免测试真的等满生产上限。
        ReadinessConfig {
            wait_limit: Duration::from_millis(300),
            grace_window: Duration::from_secs(2),
        },
    );
    assert_eq!(status.status, CodeLanguageHostStatusKind::Ready);

    let workspace = root.to_str().expect("utf8").to_string();
    assert!(registry.notify_document(PROJECT_ID, &workspace, &did_open_payload(&root)));

    let started = Instant::now();
    let locations = registry.request_definition(
        PROJECT_ID,
        &workspace,
        &file_uri(&root.join("src/file.ts")),
        &position(),
    );
    let elapsed = started.elapsed();

    assert!(
        locations.is_empty(),
        "等待超限应按未就绪兜底返回，实际 {:?}",
        file_paths(&locations)
    );
    assert!(
        elapsed >= Duration::from_millis(250),
        "加载未完成时应先等待，实际 {elapsed:?}"
    );
    assert!(
        elapsed < Duration::from_secs(3),
        "等待必须有上限，实际 {elapsed:?}"
    );
    registry.stop(PROJECT_ID, &workspace);
}

#[test]
fn waiting_request_does_not_block_other_workspace_requests() {
    let temp_dir = tempdir().expect("temp dir");
    let (root_a, bundled) = prepare_workspace(temp_dir.path(), "repo-a");
    let (root_b, _) = prepare_workspace(temp_dir.path(), "repo-b");
    let registry = CodeLanguageHostRegistry::new();
    let status_a = ensure_scripted(
        &registry,
        71,
        &root_a,
        &bundled,
        &ScriptedLsp {
            begin_after: Duration::from_millis(0),
            finish_after: Some(Duration::from_secs(6)),
            ..loading_scripted(&root_a)
        },
        ReadinessConfig {
            wait_limit: Duration::from_secs(8),
            grace_window: Duration::from_secs(2),
        },
    );
    assert_eq!(status_a.status, CodeLanguageHostStatusKind::Ready);
    let status_b = ensure_scripted(
        &registry,
        72,
        &root_b,
        &bundled,
        &ScriptedLsp {
            begin_after: Duration::from_millis(0),
            finish_after: Some(Duration::from_millis(0)),
            ..loading_scripted(&root_b)
        },
        waiting_config(),
    );
    assert_eq!(status_b.status, CodeLanguageHostStatusKind::Ready);

    let workspace_a = root_a.to_str().expect("utf8").to_string();
    let workspace_b = root_b.to_str().expect("utf8").to_string();
    assert!(registry.notify_document(71, &workspace_a, &did_open_payload(&root_a)));

    let request_registry = registry.clone();
    let request_workspace = workspace_a.clone();
    let request_uri = file_uri(&root_a.join("src/file.ts"));
    let waiting = std::thread::spawn(move || {
        request_registry.request_definition(71, &request_workspace, &request_uri, &position())
    });
    std::thread::sleep(Duration::from_millis(150));

    let started = Instant::now();
    let locations = registry.request_definition(
        72,
        &workspace_b,
        &file_uri(&root_b.join("src/file.ts")),
        &position(),
    );
    let other_workspace_elapsed = started.elapsed();

    let started = Instant::now();
    registry.stop(71, &workspace_a);
    let stop_elapsed = started.elapsed();

    let waiting_locations = waiting.join().expect("join waiting request");

    assert_eq!(file_paths(&locations), vec!["src/lib.ts".to_string()]);
    assert!(
        other_workspace_elapsed < Duration::from_secs(2),
        "等待中的请求不应阻塞其他代码根，实际 {other_workspace_elapsed:?}"
    );
    assert!(
        stop_elapsed < Duration::from_secs(2),
        "等待中的请求不应持有宿主注册表锁，实际 {stop_elapsed:?}"
    );
    assert!(
        waiting_locations.is_empty(),
        "宿主停止后等待中的请求应返回未就绪结果，实际 {:?}",
        file_paths(&waiting_locations)
    );
    registry.stop(72, &workspace_b);
}

#[test]
fn definition_request_proceeds_after_grace_window_without_load_signal() {
    let temp_dir = tempdir().expect("temp dir");
    let (root, bundled) = prepare_workspace(temp_dir.path(), "repo");
    let registry = CodeLanguageHostRegistry::new();
    let status = ensure_scripted(
        &registry,
        PROJECT_ID,
        &root,
        &bundled,
        &ScriptedLsp {
            // 语言服务始终不发加载 begin：宽限窗到期即判定「无加载」，不再等待。
            begin_after: Duration::from_secs(30),
            finish_after: None,
            ..loading_scripted(&root)
        },
        ReadinessConfig {
            wait_limit: Duration::from_secs(5),
            grace_window: Duration::from_millis(400),
        },
    );
    assert_eq!(status.status, CodeLanguageHostStatusKind::Ready);

    let workspace = root.to_str().expect("utf8").to_string();
    assert!(registry.notify_document(PROJECT_ID, &workspace, &did_open_payload(&root)));

    let started = Instant::now();
    let locations = registry.request_definition(
        PROJECT_ID,
        &workspace,
        &file_uri(&root.join("src/file.ts")),
        &position(),
    );
    let elapsed = started.elapsed();

    assert_eq!(file_paths(&locations), vec!["src/file.ts".to_string()]);
    assert!(
        elapsed >= Duration::from_millis(300),
        "宽限窗内应先等待 begin，实际 {elapsed:?}"
    );
    assert!(
        elapsed < Duration::from_secs(3),
        "宽限窗到期后不应继续阻塞，实际 {elapsed:?}"
    );
    registry.stop(PROJECT_ID, &workspace);
}

#[test]
fn definition_request_returns_not_ready_when_language_service_exits_during_load() {
    let temp_dir = tempdir().expect("temp dir");
    let (root, bundled) = prepare_workspace(temp_dir.path(), "repo");
    let registry = CodeLanguageHostRegistry::new();
    let status = ensure_scripted(
        &registry,
        PROJECT_ID,
        &root,
        &bundled,
        &ScriptedLsp {
            // 加载 begin 之后语言服务直接退出（模拟崩溃），没有加载 end。
            begin_after: Duration::from_millis(0),
            finish_after: None,
            exit_after: Some(Duration::from_millis(300)),
            ..loading_scripted(&root)
        },
        waiting_config(),
    );
    assert_eq!(status.status, CodeLanguageHostStatusKind::Ready);

    let workspace = root.to_str().expect("utf8").to_string();
    assert!(registry.notify_document(PROJECT_ID, &workspace, &did_open_payload(&root)));

    let started = Instant::now();
    let locations = registry.request_definition(
        PROJECT_ID,
        &workspace,
        &file_uri(&root.join("src/file.ts")),
        &position(),
    );
    let elapsed = started.elapsed();

    assert!(
        locations.is_empty(),
        "语言服务退出后应按未就绪返回，实际 {:?}",
        file_paths(&locations)
    );
    assert!(
        elapsed >= Duration::from_millis(200),
        "语言服务退出前应先等待加载，实际 {elapsed:?}"
    );
    assert!(
        elapsed < Duration::from_secs(3),
        "语言服务退出应唤醒等待者而不是等满上限，实际 {elapsed:?}"
    );
    registry.stop(PROJECT_ID, &workspace);
}
