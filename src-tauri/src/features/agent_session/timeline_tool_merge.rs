use crate::types::agent_session_stream::{AgentTimelineItem, ToolCallDetail, ToolCallStatus};

pub(super) fn merge_tool_call_timeline_item(
    previous: AgentTimelineItem,
    incoming: AgentTimelineItem,
) -> AgentTimelineItem {
    match (previous, incoming) {
        (
            AgentTimelineItem::ToolCall {
                call_id,
                name: previous_name,
                detail: previous_detail,
                status: previous_status,
                error: _,
                subagent_id,
            },
            AgentTimelineItem::ToolCall {
                name,
                detail,
                status,
                error,
                ..
            },
        ) => AgentTimelineItem::ToolCall {
            call_id,
            name: if should_preserve_existing_tool_name(&previous_name, &name) {
                previous_name
            } else {
                name
            },
            detail: merge_tool_call_detail(previous_detail, detail),
            status: preserve_terminal_tool_status(previous_status, status),
            error,
            subagent_id,
        },
        (_, incoming) => incoming,
    }
}

fn preserve_terminal_tool_status(
    previous: ToolCallStatus,
    incoming: ToolCallStatus,
) -> ToolCallStatus {
    if previous != ToolCallStatus::Running && incoming == ToolCallStatus::Running {
        previous
    } else {
        incoming
    }
}

fn should_preserve_existing_tool_name(previous: &str, incoming: &str) -> bool {
    !is_generic_tool_name(previous)
        && (incoming.trim().is_empty() || is_generic_tool_name(incoming))
}

fn is_generic_tool_name(name: &str) -> bool {
    name.trim().eq_ignore_ascii_case("tool")
}

fn merge_tool_call_detail(previous: ToolCallDetail, incoming: ToolCallDetail) -> ToolCallDetail {
    if std::mem::discriminant(&previous) != std::mem::discriminant(&incoming) {
        return incoming;
    }

    match (previous, incoming) {
        (
            ToolCallDetail::Shell {
                command: previous_command,
                output: previous_output,
                exit_code: previous_exit_code,
            },
            ToolCallDetail::Shell {
                command,
                output,
                exit_code,
            },
        ) => ToolCallDetail::Shell {
            command: if command.is_empty() {
                previous_command
            } else {
                command
            },
            output: output.or(previous_output),
            exit_code: exit_code.or(previous_exit_code),
        },
        (
            ToolCallDetail::Read {
                path: previous_path,
                content: previous_content,
            },
            ToolCallDetail::Read { path, content },
        ) => ToolCallDetail::Read {
            path: if path.is_empty() { previous_path } else { path },
            content: content.or(previous_content),
        },
        (
            ToolCallDetail::Edit {
                path: previous_path,
                diff: previous_diff,
            },
            ToolCallDetail::Edit { path, diff },
        ) => ToolCallDetail::Edit {
            path: if path.is_empty() { previous_path } else { path },
            diff: diff.or(previous_diff),
        },
        (
            ToolCallDetail::Write {
                path: previous_path,
                content: previous_content,
            },
            ToolCallDetail::Write { path, content },
        ) => ToolCallDetail::Write {
            path: if path.is_empty() { previous_path } else { path },
            content: content.or(previous_content),
        },
        (
            ToolCallDetail::Search {
                query: previous_query,
                mode: _previous_mode,
                matches: previous_matches,
            },
            ToolCallDetail::Search {
                query,
                mode,
                matches,
            },
        ) => ToolCallDetail::Search {
            query: if query.is_empty() {
                previous_query
            } else {
                query
            },
            mode,
            matches: if matches.is_empty() {
                previous_matches
            } else {
                matches
            },
        },
        (
            ToolCallDetail::SubAgent {
                child_session_id: previous_child_session_id,
            },
            ToolCallDetail::SubAgent { child_session_id },
        ) => ToolCallDetail::SubAgent {
            child_session_id: child_session_id.or(previous_child_session_id),
        },
        (
            ToolCallDetail::Plan {
                text: previous_text,
            },
            ToolCallDetail::Plan { text },
        ) => ToolCallDetail::Plan {
            text: if text.is_empty() { previous_text } else { text },
        },
        (
            ToolCallDetail::Unknown {
                raw_input: previous_raw_input,
                raw_output: previous_raw_output,
            },
            ToolCallDetail::Unknown {
                raw_input,
                raw_output,
            },
        ) => ToolCallDetail::Unknown {
            raw_input: raw_input.or(previous_raw_input),
            raw_output: raw_output.or(previous_raw_output),
        },
        (
            ToolCallDetail::CollabAgent {
                prompt: previous_prompt,
                receiver_thread_ids: previous_receivers,
                sender_thread_id: previous_sender,
            },
            ToolCallDetail::CollabAgent {
                prompt,
                receiver_thread_ids,
                sender_thread_id,
            },
        ) => ToolCallDetail::CollabAgent {
            prompt: prompt.or(previous_prompt),
            receiver_thread_ids: if receiver_thread_ids.is_empty() {
                previous_receivers
            } else {
                receiver_thread_ids
            },
            sender_thread_id: sender_thread_id.or(previous_sender),
        },
        (_, incoming) => incoming,
    }
}

#[cfg(test)]
mod tests {
    use super::merge_tool_call_timeline_item;
    use crate::types::agent_session_stream::{AgentTimelineItem, ToolCallDetail, ToolCallStatus};

    fn shell(status: ToolCallStatus) -> AgentTimelineItem {
        AgentTimelineItem::ToolCall {
            call_id: "call-shell".into(),
            name: "shell".into(),
            detail: ToolCallDetail::Shell {
                command: "find skills".into(),
                output: Some("done".into()),
                exit_code: None,
            },
            status,
            error: None,
            subagent_id: None,
        }
    }

    #[test]
    fn completed_tool_call_ignores_later_running_update() {
        let merged = merge_tool_call_timeline_item(
            shell(ToolCallStatus::Completed),
            shell(ToolCallStatus::Running),
        );
        match merged {
            AgentTimelineItem::ToolCall { status, .. } => {
                assert_eq!(status, ToolCallStatus::Completed);
            }
            other => panic!("unexpected {other:?}"),
        }
    }
}
