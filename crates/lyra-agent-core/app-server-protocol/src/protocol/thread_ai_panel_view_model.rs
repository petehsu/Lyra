use crate::protocol::v2::CollabAgentToolCallStatus;
use crate::protocol::v2::CommandExecutionStatus;
use crate::protocol::v2::DynamicToolCallStatus;
use crate::protocol::v2::McpToolCallStatus;
use crate::protocol::v2::PatchApplyStatus;
use crate::protocol::v2::Thread;
use crate::protocol::v2::ThreadAiPanelAttachmentKind;
use crate::protocol::v2::ThreadAiPanelMessage;
use crate::protocol::v2::ThreadAiPanelMessageContentPart;
use crate::protocol::v2::ThreadAiPanelMessageRole;
use crate::protocol::v2::ThreadAiPanelPendingInteraction;
use crate::protocol::v2::ThreadAiPanelPendingInteractionKind;
use crate::protocol::v2::ThreadAiPanelPendingInteractionStatus;
use crate::protocol::v2::ThreadAiPanelPlan;
use crate::protocol::v2::ThreadAiPanelToolCall;
use crate::protocol::v2::ThreadAiPanelToolCallStatus;
use crate::protocol::v2::ThreadAiPanelTurn;
use crate::protocol::v2::ThreadAiPanelTurnMeta;
use crate::protocol::v2::ThreadAiPanelTurnStatus;
use crate::protocol::v2::ThreadAiPanelViewModel;
use crate::protocol::v2::ThreadItem;
use crate::protocol::v2::Turn;
use crate::protocol::v2::TurnStatus;
use crate::protocol::v2::UserInput;
use serde_json::json;
use std::path::Path;

pub fn build_thread_ai_panel_view_model(
    thread: &Thread,
    runtime_feed_limit: Option<u32>,
) -> ThreadAiPanelViewModel {
    let session_id = thread.id.clone();
    let thread_created_at_ms = timestamp_to_epoch_ms(thread.created_at);
    let thread_updated_at_ms = timestamp_to_epoch_ms(thread.updated_at);
    let mut messages = Vec::new();
    let mut turns = Vec::new();
    let mut tool_calls = Vec::new();
    let mut plans = Vec::new();
    let mut pending_interactions = Vec::new();
    let mut turn_meta = Vec::new();
    let mut assistant_order = 0_u32;

    for (turn_index, turn) in thread.turns.iter().enumerate() {
        let turn_created_at_ms = turn
            .started_at
            .map(timestamp_to_epoch_ms)
            .unwrap_or_else(|| thread_created_at_ms.saturating_add(turn_index as i64));
        let turn_updated_at_ms =
            turn.completed_at
                .map(timestamp_to_epoch_ms)
                .unwrap_or_else(|| {
                    if matches!(turn.status, TurnStatus::InProgress) {
                        thread_updated_at_ms.max(turn_created_at_ms)
                    } else {
                        turn_created_at_ms
                    }
                });
        let duration_ms = turn.duration_ms.or_else(|| {
            if matches!(turn.status, TurnStatus::InProgress) {
                None
            } else {
                Some(turn_updated_at_ms.saturating_sub(turn_created_at_ms))
            }
        });
        turns.push(ThreadAiPanelTurn {
            id: turn.id.clone(),
            session_id: session_id.clone(),
            status: ai_panel_turn_status(&turn.status),
            created_at_ms: turn_created_at_ms,
            updated_at_ms: turn_updated_at_ms,
            duration_ms,
            error_code: None,
            error_message: turn.error.as_ref().map(|error| error.message.clone()),
        });

        let mut first_assistant_message_id = None;
        let mut last_assistant_message_id = None;
        let mut meta_assistant_order = None;
        let mut has_assistant_display = false;

        for (item_index, item) in turn.items.iter().enumerate() {
            let item_timestamp_ms = turn_created_at_ms.saturating_add(item_index as i64);
            match item {
                ThreadItem::UserMessage { id, content } => {
                    let message_content = render_user_inputs(content);
                    if message_content.trim().is_empty() {
                        continue;
                    }
                    messages.push(ThreadAiPanelMessage {
                        id: id.clone(),
                        session_id: session_id.clone(),
                        turn_id: Some(turn.id.clone()),
                        role: ThreadAiPanelMessageRole::User,
                        content: message_content,
                        display_content: None,
                        content_parts: user_input_content_parts(content),
                        created_at_ms: item_timestamp_ms,
                    });
                }
                ThreadItem::AgentMessage { id, text, .. } => {
                    let content = text.trim().to_string();
                    if content.is_empty() {
                        continue;
                    }
                    if first_assistant_message_id.is_none() {
                        assistant_order = assistant_order.saturating_add(1);
                        meta_assistant_order = Some(assistant_order);
                        first_assistant_message_id = Some(id.clone());
                    }
                    last_assistant_message_id = Some(id.clone());
                    has_assistant_display = true;
                    messages.push(ThreadAiPanelMessage {
                        id: id.clone(),
                        session_id: session_id.clone(),
                        turn_id: Some(turn.id.clone()),
                        role: ThreadAiPanelMessageRole::Assistant,
                        content: content.clone(),
                        display_content: Some(content),
                        content_parts: Vec::new(),
                        created_at_ms: item_timestamp_ms,
                    });
                }
                ThreadItem::Reasoning {
                    id,
                    summary,
                    content,
                } => {
                    let display = render_reasoning_content(summary, content);
                    if display.is_empty() {
                        continue;
                    }
                    if first_assistant_message_id.is_none() {
                        assistant_order = assistant_order.saturating_add(1);
                        meta_assistant_order = Some(assistant_order);
                        first_assistant_message_id = Some(id.clone());
                    }
                    last_assistant_message_id = Some(id.clone());
                    has_assistant_display = true;
                    messages.push(ThreadAiPanelMessage {
                        id: id.clone(),
                        session_id: session_id.clone(),
                        turn_id: Some(turn.id.clone()),
                        role: ThreadAiPanelMessageRole::Assistant,
                        content: display.clone(),
                        display_content: Some(display),
                        content_parts: Vec::new(),
                        created_at_ms: item_timestamp_ms,
                    });
                }
                ThreadItem::Plan { text, .. } => {
                    let final_text = text.trim();
                    if final_text.is_empty() {
                        continue;
                    }
                    plans.push(ThreadAiPanelPlan {
                        turn_id: turn.id.clone(),
                        draft_text: String::new(),
                        final_text: Some(final_text.to_string()),
                        explanation: None,
                        steps: Vec::new(),
                        updated_at_ms: item_timestamp_ms,
                    });
                    if matches!(turn.status, TurnStatus::Waiting) {
                        pending_interactions.push(plan_approval_pending_interaction(
                            &session_id,
                            &turn.id,
                            final_text,
                            item_timestamp_ms,
                        ));
                    }
                }
                _ => {
                    if let Some(tool_call) = ai_panel_tool_call_from_item(
                        &session_id,
                        &turn.id,
                        turn,
                        item,
                        item_index,
                        turn_created_at_ms,
                        turn_updated_at_ms,
                    ) {
                        tool_calls.push(tool_call);
                    }
                }
            }
        }

        turn_meta.push(ThreadAiPanelTurnMeta {
            turn_id: turn.id.clone(),
            session_id: session_id.clone(),
            first_assistant_message_id,
            last_assistant_message_id,
            assistant_order: meta_assistant_order,
            has_assistant_display,
        });
    }

    if let Some(limit) = runtime_feed_limit.and_then(|limit| usize::try_from(limit).ok())
        && limit > 0
        && tool_calls.len() > limit
    {
        tool_calls = tool_calls.split_off(tool_calls.len() - limit);
    }

    ThreadAiPanelViewModel {
        messages,
        turns,
        tool_calls,
        plans,
        pending_interactions,
        turn_meta,
    }
}

fn plan_approval_pending_interaction(
    session_id: &str,
    turn_id: &str,
    plan_text: &str,
    timestamp_ms: i64,
) -> ThreadAiPanelPendingInteraction {
    let request_id = format!("plan:{turn_id}");
    let summary = plan_text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("Proposed plan");
    ThreadAiPanelPendingInteraction {
        id: request_id.clone(),
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        kind: ThreadAiPanelPendingInteractionKind::PlanApproval,
        status: ThreadAiPanelPendingInteractionStatus::Pending,
        payload: json!({
            "requestId": request_id.clone(),
            "agentCoreMethod": "turn/planApproval/resolve",
            "raw": {
                "requestId": request_id,
                "version": 0,
                "status": "submitted",
                "summary": summary,
                "proposedMarkdown": plan_text,
            },
        }),
        created_at_ms: timestamp_ms,
        updated_at_ms: timestamp_ms,
    }
}

fn timestamp_to_epoch_ms(value: i64) -> i64 {
    if value <= 0 {
        return 0;
    }
    if value >= 10_000_000_000 {
        value
    } else {
        value.saturating_mul(1000)
    }
}

fn ai_panel_turn_status(status: &TurnStatus) -> ThreadAiPanelTurnStatus {
    match status {
        TurnStatus::InProgress => ThreadAiPanelTurnStatus::Running,
        TurnStatus::Completed => ThreadAiPanelTurnStatus::Completed,
        TurnStatus::Failed => ThreadAiPanelTurnStatus::Failed,
        TurnStatus::Interrupted | TurnStatus::Waiting => ThreadAiPanelTurnStatus::Paused,
    }
}

fn ai_panel_tool_status_from_turn(turn: &Turn) -> ThreadAiPanelToolCallStatus {
    match turn.status {
        TurnStatus::InProgress => ThreadAiPanelToolCallStatus::Running,
        TurnStatus::Failed => ThreadAiPanelToolCallStatus::Failed,
        TurnStatus::Completed | TurnStatus::Interrupted | TurnStatus::Waiting => {
            ThreadAiPanelToolCallStatus::Completed
        }
    }
}

fn ai_panel_command_status(status: &CommandExecutionStatus) -> ThreadAiPanelToolCallStatus {
    match status {
        CommandExecutionStatus::InProgress => ThreadAiPanelToolCallStatus::Running,
        CommandExecutionStatus::Completed => ThreadAiPanelToolCallStatus::Completed,
        CommandExecutionStatus::Failed | CommandExecutionStatus::Declined => {
            ThreadAiPanelToolCallStatus::Failed
        }
    }
}

fn ai_panel_patch_status(status: &PatchApplyStatus) -> ThreadAiPanelToolCallStatus {
    match status {
        PatchApplyStatus::InProgress => ThreadAiPanelToolCallStatus::Running,
        PatchApplyStatus::Completed => ThreadAiPanelToolCallStatus::Completed,
        PatchApplyStatus::Failed | PatchApplyStatus::Declined => {
            ThreadAiPanelToolCallStatus::Failed
        }
    }
}

fn ai_panel_mcp_status(status: &McpToolCallStatus) -> ThreadAiPanelToolCallStatus {
    match status {
        McpToolCallStatus::InProgress => ThreadAiPanelToolCallStatus::Running,
        McpToolCallStatus::Completed => ThreadAiPanelToolCallStatus::Completed,
        McpToolCallStatus::Failed => ThreadAiPanelToolCallStatus::Failed,
    }
}

fn ai_panel_dynamic_status(status: &DynamicToolCallStatus) -> ThreadAiPanelToolCallStatus {
    match status {
        DynamicToolCallStatus::InProgress => ThreadAiPanelToolCallStatus::Running,
        DynamicToolCallStatus::Completed => ThreadAiPanelToolCallStatus::Completed,
        DynamicToolCallStatus::Failed => ThreadAiPanelToolCallStatus::Failed,
    }
}

fn ai_panel_collab_status(status: &CollabAgentToolCallStatus) -> ThreadAiPanelToolCallStatus {
    match status {
        CollabAgentToolCallStatus::InProgress => ThreadAiPanelToolCallStatus::Running,
        CollabAgentToolCallStatus::Completed => ThreadAiPanelToolCallStatus::Completed,
        CollabAgentToolCallStatus::Failed => ThreadAiPanelToolCallStatus::Failed,
    }
}

fn ai_panel_finish_time(
    status: ThreadAiPanelToolCallStatus,
    started_at_ms: i64,
    turn_updated_at_ms: i64,
    duration_ms: Option<i64>,
) -> Option<i64> {
    if status == ThreadAiPanelToolCallStatus::Running {
        return None;
    }
    Some(
        duration_ms
            .map(|duration| started_at_ms.saturating_add(duration.max(0)))
            .unwrap_or_else(|| turn_updated_at_ms.max(started_at_ms)),
    )
}

fn ai_panel_tool_call_from_item(
    session_id: &str,
    turn_id: &str,
    turn: &Turn,
    item: &ThreadItem,
    index: usize,
    turn_created_at_ms: i64,
    turn_updated_at_ms: i64,
) -> Option<ThreadAiPanelToolCall> {
    let started_at_ms = turn_created_at_ms.saturating_add(index as i64);
    let fallback_status = ai_panel_tool_status_from_turn(turn);
    let (id, tool_name, input, output, status, duration_ms, error_message) = match item {
        ThreadItem::CommandExecution {
            id,
            command,
            cwd,
            process_id,
            status,
            command_actions,
            aggregated_output,
            exit_code,
            duration_ms,
            ..
        } => (
            id.clone(),
            "terminal.exec".to_string(),
            json!({
                "command": command,
                "cwd": cwd,
                "processId": process_id,
                "commandActions": command_actions,
            }),
            Some(json!({
                "aggregatedOutput": aggregated_output,
                "exitCode": exit_code,
                "durationMs": duration_ms,
            })),
            ai_panel_command_status(status),
            *duration_ms,
            None,
        ),
        ThreadItem::FileChange {
            id,
            changes,
            status,
        } => (
            id.clone(),
            "filesystem.write".to_string(),
            json!({
                "path": changes.first().map(|change| change.path.as_str()).unwrap_or(""),
                "changes": changes,
            }),
            Some(json!({
                "status": status,
                "changes": changes,
            })),
            ai_panel_patch_status(status),
            None,
            None,
        ),
        ThreadItem::DynamicToolCall {
            id,
            tool,
            arguments,
            status,
            content_items,
            success,
            duration_ms,
        } => (
            id.clone(),
            tool.clone(),
            arguments.clone(),
            Some(json!({
                "contentItems": content_items,
                "success": success,
                "durationMs": duration_ms,
            })),
            ai_panel_dynamic_status(status),
            *duration_ms,
            None,
        ),
        ThreadItem::McpToolCall {
            id,
            server,
            tool,
            status,
            arguments,
            result,
            error,
            duration_ms,
            ..
        } => (
            id.clone(),
            format!("mcp.{server}.{tool}"),
            json!({
                "server": server,
                "tool": tool,
                "arguments": arguments,
            }),
            Some(match error {
                Some(error) => json!(error),
                None => json!(result),
            }),
            ai_panel_mcp_status(status),
            *duration_ms,
            error.as_ref().map(|error| error.message.clone()),
        ),
        ThreadItem::CollabAgentToolCall {
            id,
            tool,
            status,
            sender_thread_id,
            receiver_thread_ids,
            prompt,
            model,
            reasoning_effort,
            agents_states,
        } => {
            let tool = serde_json::to_value(tool)
                .ok()
                .and_then(|value| value.as_str().map(str::to_string))
                .unwrap_or_else(|| "agent".to_string());
            (
                id.clone(),
                format!("collab.{tool}"),
                json!({
                    "senderThreadId": sender_thread_id,
                    "receiverThreadIds": receiver_thread_ids,
                    "prompt": prompt,
                    "model": model,
                    "reasoningEffort": reasoning_effort,
                }),
                Some(json!({
                    "receiverThreadIds": receiver_thread_ids,
                    "agentsStates": agents_states,
                })),
                ai_panel_collab_status(status),
                None,
                None,
            )
        }
        ThreadItem::WebSearch { id, query, action } => (
            id.clone(),
            "filesystem.search".to_string(),
            json!({ "query": query }),
            Some(json!({ "action": action })),
            ThreadAiPanelToolCallStatus::Completed,
            None,
            None,
        ),
        ThreadItem::ImageView { id, path } => (
            id.clone(),
            "image.view".to_string(),
            json!({ "path": path }),
            Some(json!({ "path": path })),
            fallback_status,
            None,
            None,
        ),
        ThreadItem::ImageGeneration {
            id,
            status,
            revised_prompt,
            result,
            saved_path,
        } => (
            id.clone(),
            "image.generate".to_string(),
            json!({ "prompt": revised_prompt }),
            Some(json!({
                "status": status,
                "result": result,
                "savedPath": saved_path,
            })),
            if status.eq_ignore_ascii_case("failed") {
                ThreadAiPanelToolCallStatus::Failed
            } else {
                fallback_status
            },
            None,
            None,
        ),
        _ => return None,
    };

    Some(ThreadAiPanelToolCall {
        id,
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        tool_name,
        input,
        output,
        status,
        started_at_ms,
        finished_at_ms: ai_panel_finish_time(
            status,
            started_at_ms,
            turn_updated_at_ms,
            duration_ms,
        ),
        error_code: None,
        error_message,
    })
}

fn render_user_inputs(inputs: &[UserInput]) -> String {
    inputs
        .iter()
        .filter_map(render_user_input)
        .collect::<Vec<_>>()
        .join("")
        .trim()
        .to_string()
}

fn render_user_input(input: &UserInput) -> Option<String> {
    match input {
        UserInput::Text { text, .. } if !text.is_empty() => Some(text.clone()),
        UserInput::Text { .. } => None,
        UserInput::Image { url } => Some(format!("[image] {url}").trim().to_string()),
        UserInput::LocalImage { path } => Some(
            format!("[local image] {}", path.display())
                .trim()
                .to_string(),
        ),
        UserInput::Skill { name, path } => Some(
            format!(
                "[skill] {}",
                if name.is_empty() {
                    path.display().to_string()
                } else {
                    name.clone()
                }
            )
            .trim()
            .to_string(),
        ),
        UserInput::Mention { name, path } => Some(
            format!(
                "[mention] {}",
                if name.is_empty() {
                    path.clone()
                } else {
                    name.clone()
                }
            )
            .trim()
            .to_string(),
        ),
    }
}

fn user_input_content_parts(inputs: &[UserInput]) -> Vec<ThreadAiPanelMessageContentPart> {
    inputs.iter().filter_map(user_input_content_part).collect()
}

fn user_input_content_part(input: &UserInput) -> Option<ThreadAiPanelMessageContentPart> {
    match input {
        UserInput::Text { text, .. } if !text.is_empty() => {
            Some(ThreadAiPanelMessageContentPart::Text { text: text.clone() })
        }
        UserInput::Text { .. } => None,
        UserInput::Image { url } => Some(ThreadAiPanelMessageContentPart::Attachment {
            name: basename(url).unwrap_or_else(|| "image".to_string()),
            path: url.clone(),
            kind: Some(ThreadAiPanelAttachmentKind::Image),
        }),
        UserInput::LocalImage { path } => {
            let path_string = path.display().to_string();
            Some(ThreadAiPanelMessageContentPart::Attachment {
                name: basename(&path_string).unwrap_or_else(|| path_string.clone()),
                path: path_string,
                kind: Some(ThreadAiPanelAttachmentKind::LocalImage),
            })
        }
        UserInput::Skill { name, path } => {
            let path_string = path.display().to_string();
            Some(ThreadAiPanelMessageContentPart::Attachment {
                name: if name.is_empty() {
                    basename(&path_string).unwrap_or_else(|| path_string.clone())
                } else {
                    name.clone()
                },
                path: path_string,
                kind: Some(ThreadAiPanelAttachmentKind::File),
            })
        }
        UserInput::Mention { name, path } => Some(ThreadAiPanelMessageContentPart::Attachment {
            name: if name.is_empty() {
                basename(path).unwrap_or_else(|| path.clone())
            } else {
                name.clone()
            },
            path: path.clone(),
            kind: Some(if path.ends_with('/') {
                ThreadAiPanelAttachmentKind::Directory
            } else {
                ThreadAiPanelAttachmentKind::File
            }),
        }),
    }
}

fn render_reasoning_content(summary: &[String], content: &[String]) -> String {
    let rendered = if summary.is_empty() { content } else { summary };
    rendered
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn basename(value: &str) -> Option<String> {
    if value.starts_with("data:image/") {
        return Some("image".to_string());
    }
    Path::new(value)
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .filter(|name| !name.is_empty())
}
