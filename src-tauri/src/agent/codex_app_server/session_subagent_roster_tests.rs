use std::sync::{Arc, Mutex};

use serde_json::json;

#[test]
fn build_events_collab_launch_pairs_prompt_with_each_receiver_thread() {
    let state = Arc::new(Mutex::new(super::tests::empty_state()));
    state.lock().unwrap().thread_id = Some("thr_parent".into());

    let events = super::build_events(
        &state,
        super::CodexNotification::ItemCompleted {
            item: json!({
                "id": "call_spawn",
                "type": "collabAgentToolCall",
                "tool": "spawn_agent",
                "senderThreadId": "thr_parent",
                "receiverThreadIds": ["thr_child", "thr_child", "thr_sibling"],
                "prompt": "  检查日志  ",
            }),
            thread_id: Some("thr_parent".into()),
        },
    );

    let json = serde_json::to_value(&events).expect("events");
    let item = &json[0]["item"];
    assert_eq!(item["type"], "tool_call");
    assert!(
        item.get("subagentId").is_none(),
        "拉起记录本身仍属于主智能体"
    );
    assert_eq!(item["detail"]["type"], "collab_agent");
    assert_eq!(item["detail"]["prompt"], "检查日志");
    assert_eq!(item["detail"]["senderThreadId"], "thr_parent");
    assert_eq!(
        item["detail"]["receiverThreadIds"],
        json!(["thr_child", "thr_sibling"]),
        "每个子 thread id 都留下，重复的只记一次"
    );
    assert_eq!(
        state.lock().unwrap().current_turn_id,
        None,
        "拉起记录不改当前可停止的 Turn"
    );
}

#[test]
fn build_events_collab_launch_accepts_snake_case_item_fields() {
    let state = Arc::new(Mutex::new(super::tests::empty_state()));
    state.lock().unwrap().thread_id = Some("thr_parent".into());

    let events = super::build_events(
        &state,
        super::CodexNotification::ItemCompleted {
            item: json!({
                "id": "call_spawn_snake",
                "type": "CollabAgentToolCall",
                "tool": "spawn_agent",
                "sender_thread_id": "thr_parent",
                "receiver_thread_ids": ["thr_child"],
                "prompt": "核对花名册",
            }),
            thread_id: Some("thr_parent".into()),
        },
    );

    let json = serde_json::to_value(&events).expect("events");
    let detail = &json[0]["item"]["detail"];
    assert_eq!(detail["type"], "collab_agent");
    assert_eq!(detail["prompt"], "核对花名册");
    assert_eq!(detail["senderThreadId"], "thr_parent");
    assert_eq!(detail["receiverThreadIds"], json!(["thr_child"]));
}

#[test]
fn build_events_nested_collab_launch_stays_on_launcher_thread() {
    let state = Arc::new(Mutex::new(super::tests::empty_state()));
    state.lock().unwrap().thread_id = Some("thr_parent".into());

    let events = super::build_events(
        &state,
        super::CodexNotification::ItemCompleted {
            item: json!({
                "id": "call_nested",
                "type": "collabAgentToolCall",
                "senderThreadId": "thr_child",
                "receiverThreadIds": ["thr_grand"],
                "prompt": "再往下查",
            }),
            thread_id: Some("thr_child".into()),
        },
    );

    let json = serde_json::to_value(&events).expect("events");
    let item = &json[0]["item"];
    assert!(
        item.get("subagentId").is_none(),
        "拉起记录本身属于主智能体，不进入子智能体那一路"
    );
    assert_eq!(item["detail"]["receiverThreadIds"], json!(["thr_grand"]));
    assert_eq!(item["detail"]["prompt"], "再往下查");
}

#[test]
fn build_events_subagent_turn_end_records_roster_without_ending_parent_turn() {
    let state = Arc::new(Mutex::new(super::tests::empty_state()));
    {
        let mut guard = state.lock().unwrap();
        guard.thread_id = Some("thr_parent".into());
        guard.current_turn_id = Some("turn_parent".into());
    }

    let started = super::build_events(
        &state,
        super::CodexNotification::TurnStarted {
            turn_id: "turn_child".into(),
            thread_id: Some("thr_child".into()),
        },
    );
    let started_json = serde_json::to_value(&started).expect("started");
    assert_eq!(started_json[0]["type"], "timeline");
    assert_eq!(started_json[0]["item"]["type"], "subagent_roster");
    assert_eq!(started_json[0]["item"]["subagentId"], "thr_child");
    assert_eq!(started_json[0]["item"]["status"], "running");
    assert!(
        started
            .iter()
            .all(|event| !matches!(event, super::AgentStreamEvent::TurnStarted { .. })),
        "子 thread 开始不得发出主 Turn 开始"
    );
    assert_eq!(
        state.lock().unwrap().current_turn_id.as_deref(),
        Some("turn_parent")
    );

    let ended = super::build_events(
        &state,
        super::CodexNotification::TurnCompleted {
            turn_id: Some("turn_child".into()),
            thread_id: Some("thr_child".into()),
            status: "completed".into(),
            error_message: None,
        },
    );
    let ended_json = serde_json::to_value(&ended).expect("ended");
    assert_eq!(ended_json[0]["item"]["type"], "subagent_roster");
    assert_eq!(ended_json[0]["item"]["subagentId"], "thr_child");
    assert_eq!(ended_json[0]["item"]["status"], "ended");
    assert!(
        ended.iter().all(|event| !matches!(
            event,
            super::AgentStreamEvent::TurnCompleted { .. }
                | super::AgentStreamEvent::TurnFailed { .. }
                | super::AgentStreamEvent::TurnCanceled { .. }
        )),
        "子 thread 结束不得结束、失败或取消主 Turn"
    );
    assert_eq!(
        state.lock().unwrap().current_turn_id.as_deref(),
        Some("turn_parent")
    );
}

#[test]
fn subagent_activity_started_is_a_main_timeline_launch_and_roster_running() {
    let state = Arc::new(Mutex::new(super::tests::empty_state()));
    state.lock().unwrap().thread_id = Some("thr_parent".into());
    state.lock().unwrap().current_turn_id = Some("turn_parent".into());

    let started = super::build_events(
        &state,
        super::CodexNotification::ItemCompleted {
            item: json!({
                "type": "SubAgentActivity",
                "id": "call_spawn",
                "kind": "started",
                "agent_thread_id": "thr_child",
                "agent_path": "/root/fact_automation_ref"
            }),
            thread_id: Some("thr_parent".into()),
        },
    );
    let started_json = serde_json::to_value(&started).expect("started");
    assert_eq!(started_json[0]["item"]["type"], "tool_call");
    assert!(started_json[0]["item"].get("subagentId").is_none());
    assert_eq!(started_json[0]["item"]["detail"]["type"], "collab_agent");
    assert_eq!(
        started_json[0]["item"]["detail"]["prompt"],
        "/root/fact_automation_ref"
    );
    assert_eq!(
        started_json[0]["item"]["detail"]["receiverThreadIds"],
        json!(["thr_child"])
    );
    assert_eq!(started_json[0]["item"]["status"], "running");
    assert_eq!(started_json[1]["item"]["type"], "subagent_roster");
    assert_eq!(started_json[1]["item"]["status"], "running");
    assert_eq!(
        state.lock().unwrap().current_turn_id.as_deref(),
        Some("turn_parent")
    );

    let completed = super::build_events(
        &state,
        super::CodexNotification::ItemCompleted {
            item: json!({
                "type": "subAgentActivity",
                "id": "subagent-completed-other",
                "kind": "completed",
                "agentThreadId": "thr_child",
                "agentPath": "/root/fact_automation_ref"
            }),
            thread_id: Some("thr_parent".into()),
        },
    );
    let completed_json = serde_json::to_value(&completed).expect("completed");
    assert_eq!(completed_json[0]["item"]["callId"], "call_spawn");
    assert_eq!(completed_json[0]["item"]["status"], "completed");
    assert_eq!(completed_json[1]["item"]["status"], "ended");
}

#[test]
fn empty_collab_wait_is_not_a_launch() {
    let state = Arc::new(Mutex::new(super::tests::empty_state()));
    state.lock().unwrap().thread_id = Some("thr_parent".into());
    let events = super::build_events(
        &state,
        super::CodexNotification::ItemCompleted {
            item: json!({
                "type": "CollabAgentToolCall",
                "id": "call_wait",
                "tool": "wait",
                "sender_thread_id": "thr_parent",
                "receiver_thread_ids": []
            }),
            thread_id: Some("thr_parent".into()),
        },
    );
    assert!(
        events.iter().all(|event| !matches!(
            event,
            super::AgentStreamEvent::Timeline {
                item: super::AgentTimelineItem::ToolCall { .. },
                ..
            }
        )),
        "没有 prompt、也没有子 thread 的 wait 不是拉起"
    );
}

#[test]
fn child_turn_stays_interruptible_after_parent_turn_completes() {
    let state = Arc::new(Mutex::new(super::tests::empty_state()));
    {
        let mut guard = state.lock().unwrap();
        guard.thread_id = Some("thr_parent".into());
    }
    super::build_events(
        &state,
        super::CodexNotification::TurnStarted {
            turn_id: "turn_parent".into(),
            thread_id: Some("thr_parent".into()),
        },
    );
    super::build_events(
        &state,
        super::CodexNotification::TurnStarted {
            turn_id: "turn_child".into(),
            thread_id: Some("thr_child".into()),
        },
    );
    super::build_events(
        &state,
        super::CodexNotification::TurnCompleted {
            turn_id: Some("turn_parent".into()),
            thread_id: Some("thr_parent".into()),
            status: "completed".into(),
            error_message: None,
        },
    );

    let guard = state.lock().unwrap();
    assert_eq!(guard.current_turn_id, None);
    assert_eq!(
        guard
            .active_child_turns
            .get("thr_child")
            .map(String::as_str),
        Some("turn_child")
    );
}
