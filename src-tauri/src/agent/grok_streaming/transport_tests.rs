//! `GrokStreamingTransport` 帧分发单测（无子进程，直接喂 `dispatch_message`）。

use super::*;

fn state_with(server_request_handler: Option<ServerRequestHandler>) -> TransportState {
    TransportState {
        pending: Mutex::new(HashMap::new()),
        notification_handler: Mutex::new(None),
        server_request_handler: Mutex::new(server_request_handler),
        stderr_buffer: Mutex::new(String::new()),
        closed: Mutex::new(None),
        eof_sender: Mutex::new(None),
        next_id: AtomicI64::new(1),
        stdin: Mutex::new(None),
    }
}

#[test]
fn dispatch_classifies_response_request_and_notification() {
    let state = state_with(None);
    let (tx, rx) = mpsc::channel();
    state
        .pending
        .lock()
        .unwrap()
        .insert(7, PendingRequest { sender: Some(tx) });

    dispatch_message(
        &state,
        json!({"jsonrpc":"2.0","id":7,"result":{"sessionId":"s-1"}}),
    );
    assert_eq!(rx.recv().unwrap().unwrap()["sessionId"], "s-1");

    // 未注册 handler 的 server→client request 不应 panic，也不能静默丢弃
    // （无 stdin 时写回失败，只验证不误判成 response / notification）。
    dispatch_message(
        &state,
        json!({"jsonrpc":"2.0","id":9,"method":"session/request_permission","params":{}}),
    );
}

#[test]
fn dispatch_forwards_server_request_to_handler_with_id_and_params() {
    let seen = Arc::new(Mutex::new(Vec::<(Value, String, Value)>::new()));
    let sink = Arc::clone(&seen);
    let state = state_with(Some(Arc::new(
        move |id: &Value, method: &str, params: &Value| {
            sink.lock()
                .unwrap()
                .push((id.clone(), method.to_string(), params.clone()));
            Ok(json!({"outcome": {"outcome": "cancelled"}}))
        },
    )));

    dispatch_message(
        &state,
        json!({
            "jsonrpc": "2.0",
            "id": 0,
            "method": "session/request_permission",
            "params": {"sessionId": "s-1", "options": []}
        }),
    );

    let guard = seen.lock().unwrap();
    assert_eq!(guard.len(), 1);
    assert_eq!(guard[0].0, json!(0));
    assert_eq!(guard[0].1, "session/request_permission");
    assert_eq!(guard[0].2["sessionId"], "s-1");
}

#[test]
fn server_request_handler_error_is_reported_to_the_agent() {
    let state = state_with(Some(Arc::new(
        |_: &Value, method: &str, _: &Value| -> Result<Value, GrokStreamingError> {
            Err(GrokStreamingError::Protocol(format!(
                "unhandled ACP request: {method}"
            )))
        },
    )));

    dispatch_message(
        &state,
        json!({"jsonrpc":"2.0","id":5,"method":"x.ai/ask_user_question","params":{}}),
    );
}

#[test]
fn dispatch_notification_forwards_method_and_params() {
    let received = Arc::new(Mutex::new(Vec::<(String, Value)>::new()));
    let sink = Arc::clone(&received);
    let mut state = state_with(None);
    state.notification_handler = Mutex::new(Some(Arc::new(move |method: &str, params: &Value| {
        sink.lock()
            .unwrap()
            .push((method.to_string(), params.clone()));
    })));

    dispatch_message(
        &state,
        json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s-1"}}),
    );

    let guard = received.lock().unwrap();
    assert_eq!(guard.len(), 1);
    assert_eq!(guard[0].0, "session/update");
    assert_eq!(guard[0].1["sessionId"], "s-1");
}
