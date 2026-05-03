use crate::protocol::common::ServerRequest;
use crate::protocol::v2::CollabAgentToolCallStatus;
use crate::protocol::v2::CommandExecutionStatus;
use crate::protocol::v2::DynamicToolCallStatus;
use crate::protocol::v2::McpToolCallStatus;
use crate::protocol::v2::PatchApplyStatus;
use crate::protocol::v2::PlanArtifact;
use crate::protocol::v2::PlanArtifactStatus;
use crate::protocol::v2::Thread;
use crate::protocol::v2::ThreadAiPanelAttachmentKind;
use crate::protocol::v2::ThreadAiPanelMessage;
use crate::protocol::v2::ThreadAiPanelMessageContentPart;
use crate::protocol::v2::ThreadAiPanelMessageRole;
use crate::protocol::v2::ThreadAiPanelPendingInteraction;
use crate::protocol::v2::ThreadAiPanelPendingInteractionKind;
use crate::protocol::v2::ThreadAiPanelPendingInteractionStatus;
use crate::protocol::v2::ThreadAiPanelPlan;
use crate::protocol::v2::ThreadAiPanelTimelineEntry;
use crate::protocol::v2::ThreadAiPanelTimelineEntryKind;
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
use serde_json::Map;
use serde_json::Value;
use serde_json::json;
use std::path::Path;

pub fn build_thread_ai_panel_view_model(
    thread: &Thread,
    runtime_feed_limit: Option<u32>,
    pending_server_requests: &[ServerRequest],
) -> ThreadAiPanelViewModel {
    let session_id = thread.id.clone();
    let thread_created_at_ms = timestamp_to_epoch_ms(thread.created_at);
    let thread_updated_at_ms = timestamp_to_epoch_ms(thread.updated_at);
    let mut messages = Vec::new();
    let mut turns = Vec::new();
    let mut tool_calls = Vec::new();
    let mut plans = Vec::new();
    let mut pending_interactions = Vec::new();
    let mut timeline_entries = Vec::new();
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
                    timeline_entries.push(ai_panel_timeline_entry(
                        &session_id,
                        &turn.id,
                        ThreadAiPanelTimelineEntryKind::UserMessage,
                        id,
                        item_timestamp_ms,
                    ));
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
                    timeline_entries.push(ai_panel_timeline_entry(
                        &session_id,
                        &turn.id,
                        ThreadAiPanelTimelineEntryKind::AssistantMessage,
                        id,
                        item_timestamp_ms,
                    ));
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
                    timeline_entries.push(ai_panel_timeline_entry(
                        &session_id,
                        &turn.id,
                        ThreadAiPanelTimelineEntryKind::AssistantMessage,
                        id,
                        item_timestamp_ms,
                    ));
                }
                ThreadItem::Plan { artifact, .. } => {
                    plans.push(ThreadAiPanelPlan {
                        turn_id: turn.id.clone(),
                        artifact: artifact.clone(),
                        updated_at_ms: item_timestamp_ms,
                    });
                    timeline_entries.push(ai_panel_timeline_entry(
                        &session_id,
                        &turn.id,
                        ThreadAiPanelTimelineEntryKind::Plan,
                        &artifact.plan_id,
                        item_timestamp_ms,
                    ));
                    if matches!(turn.status, TurnStatus::Waiting)
                        && artifact.status == PlanArtifactStatus::Proposed
                    {
                        pending_interactions.push(plan_approval_pending_interaction(
                            &session_id,
                            &turn.id,
                            artifact,
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
                        timeline_entries.push(ai_panel_timeline_entry(
                            &session_id,
                            &turn.id,
                            ThreadAiPanelTimelineEntryKind::ToolCall,
                            &tool_calls.last().expect("tool call was just pushed").id,
                            item_timestamp_ms,
                        ));
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

    for request in pending_server_requests {
        if let Some(interaction) =
            pending_interaction_from_server_request(request, thread_updated_at_ms)
            && pending_interactions
                .iter()
                .all(|existing| existing.id != interaction.id)
        {
            timeline_entries.push(ai_panel_timeline_entry(
                &interaction.session_id,
                &interaction.turn_id,
                ThreadAiPanelTimelineEntryKind::PendingInteraction,
                &interaction.id,
                interaction.created_at_ms,
            ));
            pending_interactions.push(interaction);
        }
    }

    ThreadAiPanelViewModel {
        messages,
        turns,
        tool_calls,
        plans,
        pending_interactions,
        timeline_entries,
        turn_meta,
    }
}

fn ai_panel_timeline_entry(
    session_id: &str,
    turn_id: &str,
    kind: ThreadAiPanelTimelineEntryKind,
    ref_id: &str,
    created_at_ms: i64,
) -> ThreadAiPanelTimelineEntry {
    let kind_key = match kind {
        ThreadAiPanelTimelineEntryKind::UserMessage => "user",
        ThreadAiPanelTimelineEntryKind::AssistantMessage => "assistant",
        ThreadAiPanelTimelineEntryKind::ToolCall => "tool",
        ThreadAiPanelTimelineEntryKind::Plan => "plan",
        ThreadAiPanelTimelineEntryKind::PendingInteraction => "pending",
    };
    ThreadAiPanelTimelineEntry {
        id: format!("timeline:{turn_id}:{kind_key}:{ref_id}"),
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        kind,
        ref_id: ref_id.to_string(),
        created_at_ms,
    }
}

fn pending_interaction_from_server_request(
    request: &ServerRequest,
    timestamp_ms: i64,
) -> Option<ThreadAiPanelPendingInteraction> {
    match request {
        ServerRequest::CommandExecutionRequestApproval { request_id, params } => {
            let raw = normalized_command_approval_payload(params);
            Some(server_request_pending_interaction(
                request_id.clone(),
                params.thread_id.clone(),
                params.turn_id.clone(),
                ThreadAiPanelPendingInteractionKind::CommandExecutionApproval,
                "item/commandExecution/requestApproval",
                raw,
                timestamp_ms,
            ))
        }
        ServerRequest::FileChangeRequestApproval { request_id, params } => {
            let raw = normalized_file_change_approval_payload(params);
            Some(server_request_pending_interaction(
                request_id.clone(),
                params.thread_id.clone(),
                params.turn_id.clone(),
                ThreadAiPanelPendingInteractionKind::FileChangeApproval,
                "item/fileChange/requestApproval",
                raw,
                timestamp_ms,
            ))
        }
        ServerRequest::PermissionsRequestApproval { request_id, params } => {
            let raw = normalized_permissions_approval_payload(params);
            Some(server_request_pending_interaction(
                request_id.clone(),
                params.thread_id.clone(),
                params.turn_id.clone(),
                ThreadAiPanelPendingInteractionKind::PermissionsApproval,
                "item/permissions/requestApproval",
                raw,
                timestamp_ms,
            ))
        }
        ServerRequest::ToolRequestUserInput { request_id, params } => {
            Some(server_request_pending_interaction(
                request_id.clone(),
                params.thread_id.clone(),
                params.turn_id.clone(),
                ThreadAiPanelPendingInteractionKind::ToolUserInput,
                "item/tool/requestUserInput",
                serde_json::to_value(params).unwrap_or_else(|_| json!({})),
                timestamp_ms,
            ))
        }
        ServerRequest::McpServerElicitationRequest { request_id, params } => {
            Some(server_request_pending_interaction(
                request_id.clone(),
                params.thread_id.clone(),
                params
                    .turn_id
                    .clone()
                    .unwrap_or_else(|| "unknown-turn".to_string()),
                ThreadAiPanelPendingInteractionKind::McpElicitation,
                "mcpServer/elicitation/request",
                serde_json::to_value(params).unwrap_or_else(|_| json!({})),
                timestamp_ms,
            ))
        }
        ServerRequest::DynamicToolCall { .. }
        | ServerRequest::ApplyPatchApproval { .. }
        | ServerRequest::ExecCommandApproval { .. } => None,
    }
}

fn server_request_pending_interaction(
    request_id: crate::RequestId,
    session_id: String,
    turn_id: String,
    kind: ThreadAiPanelPendingInteractionKind,
    agent_core_method: &str,
    raw: Value,
    timestamp_ms: i64,
) -> ThreadAiPanelPendingInteraction {
    let interaction_id = request_id.to_string();
    ThreadAiPanelPendingInteraction {
        id: interaction_id,
        session_id,
        turn_id,
        kind,
        status: ThreadAiPanelPendingInteractionStatus::Pending,
        payload: json!({
            "requestId": request_id,
            "agentCoreMethod": agent_core_method,
            "raw": raw,
        }),
        created_at_ms: timestamp_ms,
        updated_at_ms: timestamp_ms,
    }
}

fn object_value(value: Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap_or_default()
}

fn normalized_command_approval_payload(
    params: &crate::protocol::v2::CommandExecutionRequestApprovalParams,
) -> Value {
    let mut raw = object_value(serde_json::to_value(params).unwrap_or_else(|_| json!({})));
    raw.insert("toolName".to_string(), json!("terminal.exec"));
    raw.insert(
        "input".to_string(),
        json!({
            "command": params.command.clone().unwrap_or_default(),
            "cwd": params.cwd.as_ref().map(|path| path.to_string_lossy().to_string()),
        }),
    );
    raw.insert(
        "metadata".to_string(),
        json!({
            "command": params.command.clone().unwrap_or_default(),
            "riskLevel": "medium",
        }),
    );
    Value::Object(raw)
}

fn normalized_file_change_approval_payload(
    params: &crate::protocol::v2::FileChangeRequestApprovalParams,
) -> Value {
    let mut raw = object_value(serde_json::to_value(params).unwrap_or_else(|_| json!({})));
    raw.insert("toolName".to_string(), json!("filesystem.write"));
    raw.insert(
        "input".to_string(),
        json!({
            "path": params.grant_root.as_ref().map(|path| path.to_string_lossy().to_string()).unwrap_or_default(),
        }),
    );
    raw.insert("metadata".to_string(), json!({ "riskLevel": "medium" }));
    Value::Object(raw)
}

fn normalized_permissions_approval_payload(
    params: &crate::protocol::v2::PermissionsRequestApprovalParams,
) -> Value {
    let mut raw = object_value(serde_json::to_value(params).unwrap_or_else(|_| json!({})));
    raw.insert("toolName".to_string(), json!("permissions.request"));
    raw.insert(
        "input".to_string(),
        json!({ "permissions": params.permissions.clone() }),
    );
    raw.insert("metadata".to_string(), json!({ "riskLevel": "medium" }));
    Value::Object(raw)
}

fn plan_approval_pending_interaction(
    session_id: &str,
    turn_id: &str,
    artifact: &PlanArtifact,
    timestamp_ms: i64,
) -> ThreadAiPanelPendingInteraction {
    let interaction_id = format!("plan:{turn_id}:{}", artifact.plan_id);
    ThreadAiPanelPendingInteraction {
        id: interaction_id,
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        kind: ThreadAiPanelPendingInteractionKind::PlanApproval,
        status: ThreadAiPanelPendingInteractionStatus::Pending,
        payload: json!({
            "agentCoreMethod": "turn/planApproval/resolve",
            "raw": {
                "planTurnId": turn_id,
                "planId": artifact.plan_id.clone(),
                "version": 2,
                "status": "proposed",
                "summary": artifact.summary.clone(),
                "artifact": artifact,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::RequestId;
    use crate::protocol::v2::CommandExecutionRequestApprovalParams;
    use crate::protocol::v2::SessionSource;
    use crate::protocol::v2::ThreadStatus;
    use lyra_utils_absolute_path::test_support::PathBufExt;
    use lyra_utils_absolute_path::test_support::test_path_buf;

    fn absolute_path(path: &str) -> lyra_utils_absolute_path::AbsolutePathBuf {
        let path = format!("/{}", path.trim_start_matches('/'));
        test_path_buf(&path).abs()
    }

    fn empty_thread() -> Thread {
        Thread {
            id: "thread-1".to_string(),
            forked_from_id: None,
            preview: String::new(),
            ephemeral: false,
            model_provider: "openai".to_string(),
            created_at: 100,
            updated_at: 120,
            status: ThreadStatus::Idle,
            path: None,
            cwd: absolute_path("tmp"),
            bound_project_root: None,
            cli_version: "test".to_string(),
            source: SessionSource::AppServer,
            agent_nickname: None,
            agent_role: None,
            git_info: None,
            name: None,
            turns: Vec::new(),
        }
    }

    #[test]
    fn pending_interaction_kind_serializes_all_desktop_restorable_variants() {
        assert_eq!(
            serde_json::to_value(ThreadAiPanelPendingInteractionKind::CommandExecutionApproval)
                .expect("serialize kind"),
            json!("commandExecutionApproval")
        );
        assert_eq!(
            serde_json::to_value(ThreadAiPanelPendingInteractionKind::McpElicitation)
                .expect("serialize kind"),
            json!("mcpElicitation")
        );
    }

    #[test]
    fn view_model_includes_live_command_approval_request() {
        let request = ServerRequest::CommandExecutionRequestApproval {
            request_id: RequestId::String("request-1".to_string()),
            params: CommandExecutionRequestApprovalParams {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "item-1".to_string(),
                approval_id: None,
                reason: Some("needs approval".to_string()),
                network_approval_context: None,
                command: Some("echo hi".to_string()),
                cwd: Some(absolute_path("tmp")),
                command_actions: None,
                additional_permissions: None,
                proposed_execpolicy_amendment: None,
                proposed_network_policy_amendments: None,
                available_decisions: None,
            },
        };

        let view_model = build_thread_ai_panel_view_model(&empty_thread(), None, &[request]);
        let interaction = view_model
            .pending_interactions
            .first()
            .expect("pending interaction");

        assert_eq!(interaction.id, "request-1");
        assert_eq!(
            interaction.kind,
            ThreadAiPanelPendingInteractionKind::CommandExecutionApproval
        );
        assert_eq!(
            interaction.payload["agentCoreMethod"],
            json!("item/commandExecution/requestApproval")
        );
        assert_eq!(interaction.payload["requestId"], json!("request-1"));
        assert_eq!(
            interaction.payload["raw"]["input"]["command"],
            json!("echo hi")
        );
    }

    #[test]
    fn view_model_preserves_numeric_server_request_id_in_payload() {
        let request = ServerRequest::CommandExecutionRequestApproval {
            request_id: RequestId::Integer(3),
            params: CommandExecutionRequestApprovalParams {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "item-1".to_string(),
                approval_id: None,
                reason: Some("needs approval".to_string()),
                network_approval_context: None,
                command: Some("echo hi".to_string()),
                cwd: Some(absolute_path("tmp")),
                command_actions: None,
                additional_permissions: None,
                proposed_execpolicy_amendment: None,
                proposed_network_policy_amendments: None,
                available_decisions: None,
            },
        };

        let view_model = build_thread_ai_panel_view_model(&empty_thread(), None, &[request]);
        let interaction = view_model
            .pending_interactions
            .first()
            .expect("pending interaction");

        assert_eq!(interaction.id, "3");
        assert_eq!(interaction.payload["requestId"], json!(3));
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
        UserInput::Mention { name, path, .. } => Some(
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
        UserInput::Mention { name, path, .. } => {
            Some(ThreadAiPanelMessageContentPart::Attachment {
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
            })
        }
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
