use lyra_lsp_core::{
    change_document as lsp_change_document, close_document as lsp_close_document,
    completion as lsp_completion, find_references as lsp_find_references,
    goto_definition as lsp_goto_definition, hover as lsp_hover, open_document as lsp_open_document,
    save_document as lsp_save_document, LspCompletionRequest, LspDocumentRequest,
    LspPositionRequest,
};
use lyra_runtime_protocol::RuntimeError;
use lyra_terminal_core::{
    attach_agent as attach_terminal_agent,
    close_observer_session as close_terminal_observer_session,
    close_session as close_terminal_session,
    create_observer_session as create_terminal_observer_session,
    create_session as create_terminal_session, detach_agent as detach_terminal_agent,
    evaluate_permission as evaluate_terminal_permission, execute_act as execute_terminal_act,
    execute_input as execute_terminal_input, list_artifacts as list_terminal_artifacts,
    list_attachments as list_terminal_attachments,
    mark_output_policy as mark_terminal_output_policy,
    pause_attachment as pause_terminal_attachment,
    read_command_output as read_terminal_command_output,
    read_command_status as read_terminal_command_status, read_commands as read_terminal_commands,
    read_events as read_terminal_events, read_map as read_terminal_map,
    read_memory_timeline as read_terminal_memory_timeline,
    read_output_range as read_terminal_output_range, read_processes as read_terminal_processes,
    read_screen as read_terminal_screen, read_session as read_terminal_session,
    read_stored_sessions as read_terminal_stored_sessions,
    record_handoff_completed as record_terminal_handoff_completed,
    record_handoff_started as record_terminal_handoff_started,
    record_observer_exit as record_terminal_observer_exit,
    record_observer_input as record_terminal_observer_input,
    record_observer_output as record_terminal_observer_output,
    record_permission_denied as record_terminal_permission_denied,
    record_permission_expired as record_terminal_permission_expired,
    record_permission_granted as record_terminal_permission_granted,
    record_permission_requested as record_terminal_permission_requested,
    resize_observer_session as resize_terminal_observer_session,
    resize_session as resize_terminal_session, respond_permission as respond_terminal_permission,
    restore_sessions as restore_terminal_sessions, resume_attachment as resume_terminal_attachment,
    shell_launch_plan as terminal_shell_launch_plan, signal_process as signal_terminal_process,
    wait_command as wait_terminal_command, wait_until as wait_terminal_until,
    write_session as write_terminal_session, TerminalActExecuteRequest,
    TerminalArtifactsListRequest, TerminalAttachmentAttachRequest, TerminalAttachmentDetachRequest,
    TerminalAttachmentListRequest, TerminalAttachmentPauseRequest, TerminalAttachmentResumeRequest,
    TerminalCloseRequest, TerminalCommandOutputReadRequest, TerminalCommandStatusRequest,
    TerminalCommandWaitRequest, TerminalCommandsReadRequest, TerminalCreateRequest,
    TerminalEventsReadRequest, TerminalHandoffEventRequest, TerminalInputExecuteRequest,
    TerminalMapReadRequest, TerminalMemoryTimelineReadRequest, TerminalObserverCloseRequest,
    TerminalObserverCreateRequest, TerminalObserverExitRequest, TerminalObserverInputRequest,
    TerminalObserverOutputRequest, TerminalObserverResizeRequest,
    TerminalOutputPolicyMarkerRequest, TerminalOutputRangeReadRequest,
    TerminalPermissionEvaluateRequest, TerminalPermissionEventRequest,
    TerminalPermissionRespondRequest, TerminalProcessSignalRequest, TerminalProcessesReadRequest,
    TerminalReadRequest, TerminalResizeRequest, TerminalRestoreRequest, TerminalScreenReadRequest,
    TerminalShellLaunchEnvPair, TerminalShellLaunchPlanRequest, TerminalStoredSessionsReadRequest,
    TerminalWaitUntilRequest, TerminalWriteRequest,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

macro_rules! bridge_request {
    ($name:ident { $($field:ident : $ty:ty),+ $(,)? }) => {
        #[derive(Debug, Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct $name {
            $( $field: $ty, )+
        }
    };
}

pub(crate) fn handle_terminal_request(method: &str, payload: Value) -> Result<Value, RuntimeError> {
    match method {
        "terminal.sessions.create" => {
            let request: RuntimeTerminalCreateRequest = from_payload(payload)?;
            let snapshot = create_terminal_session(map_terminal_create_request(request))
                .map_err(map_runtime_error)?;
            to_value(&snapshot)
        }
        "terminal.shell.launchPlan" => {
            let request: RuntimeTerminalShellLaunchPlanRequest = from_payload(payload)?;
            let response = terminal_shell_launch_plan(TerminalShellLaunchPlanRequest {
                shell: request.shell,
            })
            .map_err(map_runtime_error)?;
            to_value(&response)
        }
        "terminal.sessions.restore" => {
            let request: RuntimeTerminalRestoreRequest = from_payload(payload)?;
            let snapshots = restore_terminal_sessions(TerminalRestoreRequest {
                sessions: request
                    .sessions
                    .into_iter()
                    .map(map_terminal_create_request)
                    .collect(),
            })
            .map_err(map_runtime_error)?;
            to_value(&snapshots)
        }
        "terminal.sessions.readStored" => {
            let request: RuntimeTerminalStoredSessionsReadRequest = from_payload(payload)?;
            let response = read_terminal_stored_sessions(TerminalStoredSessionsReadRequest {
                storage_root: request.storage_root,
            })
            .map_err(map_runtime_error)?;
            serde_json::from_str(&response)
                .map_err(|error| runtime_error("SERDE_DECODE_FAILED", error.to_string()))
        }
        "terminal.sessions.write" => {
            let request: RuntimeTerminalWriteRequest = from_payload(payload)?;
            write_terminal_session(TerminalWriteRequest {
                session_id: request.session_id,
                data: request.data,
                text: request.text,
                keys: request.keys,
                append_newline: request.append_newline,
                source: request.source,
                storage_root: request.storage_root,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "terminal.sessions.read" => {
            let request: RuntimeTerminalReadRequest = from_payload(payload)?;
            let response = read_terminal_session(TerminalReadRequest {
                session_id: request.session_id,
                cursor: request.cursor,
                max_bytes: request.max_bytes,
                wait_ms: request.wait_ms,
                storage_root: request.storage_root,
            })
            .map_err(map_runtime_error)?;
            terminal_read_response_to_value(&response)
        }
        "terminal.sessions.resize" => {
            let request: RuntimeTerminalResizeRequest = from_payload(payload)?;
            resize_terminal_session(TerminalResizeRequest {
                session_id: request.session_id,
                cols: request.cols,
                rows: request.rows,
                storage_root: request.storage_root,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "terminal.sessions.close" => {
            let request: RuntimeTerminalCloseRequest = from_payload(payload)?;
            close_terminal_session(TerminalCloseRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "terminal.observer.create" => {
            let request: RuntimeTerminalObserverCreateRequest = from_payload(payload)?;
            let snapshot = create_terminal_observer_session(TerminalObserverCreateRequest {
                session_id: request.session_id,
                title: request.title,
                cwd: request.cwd,
                shell: request.shell,
                cols: request.cols,
                rows: request.rows,
                source: request.source,
                mode: request.mode,
                command: request.command,
                persist: request.persist,
                storage_root: request.storage_root,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            to_value(&snapshot)
        }
        "terminal.observer.input" => {
            let request: RuntimeTerminalObserverInputRequest = from_payload(payload)?;
            record_terminal_observer_input(TerminalObserverInputRequest {
                session_id: request.session_id,
                data: request.data,
                text: request.text,
                keys: request.keys,
                append_newline: request.append_newline,
                source: request.source,
                storage_root: request.storage_root,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "terminal.observer.output" => {
            let request: RuntimeTerminalObserverOutputRequest = from_payload(payload)?;
            record_terminal_observer_output(TerminalObserverOutputRequest {
                session_id: request.session_id,
                data: request.data,
                storage_root: request.storage_root,
            })
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "terminal.observer.resize" => {
            let request: RuntimeTerminalObserverResizeRequest = from_payload(payload)?;
            resize_terminal_observer_session(TerminalObserverResizeRequest {
                session_id: request.session_id,
                cols: request.cols,
                rows: request.rows,
                storage_root: request.storage_root,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "terminal.observer.exit" => {
            let request: RuntimeTerminalObserverExitRequest = from_payload(payload)?;
            record_terminal_observer_exit(TerminalObserverExitRequest {
                session_id: request.session_id,
                exit_code: request.exit_code,
                storage_root: request.storage_root,
            })
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "terminal.observer.close" => {
            let request: RuntimeTerminalObserverCloseRequest = from_payload(payload)?;
            close_terminal_observer_session(TerminalObserverCloseRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "terminal.memory.readTimeline" => {
            let request: RuntimeTerminalMemoryTimelineReadRequest = from_payload(payload)?;
            let response = read_terminal_memory_timeline(TerminalMemoryTimelineReadRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                cursor: request.cursor,
                limit: request.limit,
                kinds: request.kinds,
                actors: request.actors,
                command_id: request.command_id,
                tool_call_id: request.tool_call_id,
                agent_session_id: request.agent_session_id,
                seq_start: request.seq_start,
                seq_end: request.seq_end,
                time_start_ms: request.time_start_ms,
                time_end_ms: request.time_end_ms,
                audit: request.audit,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            serde_json::from_str(&response)
                .map_err(|error| runtime_error("SERDE_DECODE_FAILED", error.to_string()))
        }
        "terminal.events.read" => {
            let request: RuntimeTerminalEventsReadRequest = from_payload(payload)?;
            let response = read_terminal_events(TerminalEventsReadRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                cursor: request.cursor,
                limit: request.limit,
                kinds: request.kinds,
                actors: request.actors,
                audit: request.audit,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            serde_json::from_str(&response)
                .map_err(|error| runtime_error("SERDE_DECODE_FAILED", error.to_string()))
        }
        "terminal.commands.read" => {
            let request: RuntimeTerminalCommandsReadRequest = from_payload(payload)?;
            let response = read_terminal_commands(TerminalCommandsReadRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                cursor: request.cursor,
                limit: request.limit,
                status: request.status,
                audit: request.audit,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            serde_json::from_str(&response)
                .map_err(|error| runtime_error("SERDE_DECODE_FAILED", error.to_string()))
        }
        "terminal.output.readRange" => {
            let request: RuntimeTerminalOutputRangeReadRequest = from_payload(payload)?;
            let response = read_terminal_output_range(TerminalOutputRangeReadRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                start: request.start,
                end: request.end,
                raw: request.raw,
                audit: request.audit,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            serde_json::from_str(&response)
                .map_err(|error| runtime_error("SERDE_DECODE_FAILED", error.to_string()))
        }
        "terminal.artifacts.list" => {
            let request: RuntimeTerminalArtifactsListRequest = from_payload(payload)?;
            let response = list_terminal_artifacts(TerminalArtifactsListRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                audit: request.audit,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            serde_json::from_str(&response)
                .map_err(|error| runtime_error("SERDE_DECODE_FAILED", error.to_string()))
        }
        "terminal.permissions.requested" => {
            let request: RuntimeTerminalPermissionEventRequest = from_payload(payload)?;
            record_terminal_permission_requested(map_terminal_permission_request(request))
                .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "terminal.permissions.granted" => {
            let request: RuntimeTerminalPermissionEventRequest = from_payload(payload)?;
            record_terminal_permission_granted(map_terminal_permission_request(request))
                .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "terminal.permissions.denied" => {
            let request: RuntimeTerminalPermissionEventRequest = from_payload(payload)?;
            record_terminal_permission_denied(map_terminal_permission_request(request))
                .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "terminal.permissions.expired" => {
            let request: RuntimeTerminalPermissionEventRequest = from_payload(payload)?;
            record_terminal_permission_expired(map_terminal_permission_request(request))
                .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "terminal.handoffs.started" => {
            let request: RuntimeTerminalHandoffEventRequest = from_payload(payload)?;
            record_terminal_handoff_started(map_terminal_handoff_request(request))
                .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "terminal.handoffs.completed" => {
            let request: RuntimeTerminalHandoffEventRequest = from_payload(payload)?;
            record_terminal_handoff_completed(map_terminal_handoff_request(request))
                .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "terminal.output.markPolicy" => {
            let request: RuntimeTerminalOutputPolicyMarkerRequest = from_payload(payload)?;
            mark_terminal_output_policy(TerminalOutputPolicyMarkerRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                start: request.start,
                end: request.end,
                policy: request.policy,
                reason: request.reason,
                encrypted_ref: request.encrypted_ref,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "terminal.screen.read" => {
            let request: RuntimeTerminalScreenReadRequest = from_payload(payload)?;
            let response = read_terminal_screen(TerminalScreenReadRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                cursor: request.cursor,
                include_scrollback: request.include_scrollback,
                max_rows: request.max_rows,
                max_bytes: request.max_bytes,
                selected_text: request.selected_text,
            })
            .map_err(map_runtime_error)?;
            terminal_screen_response_to_value(&response)
        }
        "terminal.map.read" => {
            let request: RuntimeTerminalMapReadRequest = from_payload(payload)?;
            let response = read_terminal_map(TerminalMapReadRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                screen_cursor: request.screen_cursor,
                max_regions: request.max_regions,
                include_text: request.include_text,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            terminal_map_response_to_value(&response)
        }
        "terminal.act.execute" => {
            let request: RuntimeTerminalActExecuteRequest = from_payload(payload)?;
            let response = execute_terminal_act(TerminalActExecuteRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                action: request.action,
                region_id: request.region_id,
                screen_cursor: request.screen_cursor,
                text: request.text,
                direction: request.direction,
                amount: request.amount,
                reason: request.reason,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            terminal_act_response_to_value(&response)
        }
        "terminal.attachments.attach" => {
            let request: RuntimeTerminalAttachmentAttachRequest = from_payload(payload)?;
            let response = attach_terminal_agent(TerminalAttachmentAttachRequest {
                session_id: request.session_id,
                agent_session_id: request.agent_session_id,
                runtime_turn_id: request.runtime_turn_id,
                tool_call_id: request.tool_call_id,
                mode: request.mode,
                reason: request.reason,
                ttl_ms: request.ttl_ms,
                permission_id: request.permission_id,
                permission_scope: request.permission_scope,
                approved: request.approved,
                storage_root: request.storage_root,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            terminal_attachment_response_to_value(&response)
        }
        "terminal.attachments.detach" => {
            let request: RuntimeTerminalAttachmentDetachRequest = from_payload(payload)?;
            let response = detach_terminal_agent(TerminalAttachmentDetachRequest {
                session_id: request.session_id,
                attachment_id: request.attachment_id,
                reason: request.reason,
                storage_root: request.storage_root,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            terminal_attachment_response_to_value(&response)
        }
        "terminal.attachments.list" => {
            let request: RuntimeTerminalAttachmentListRequest = from_payload(payload)?;
            let response = list_terminal_attachments(TerminalAttachmentListRequest {
                session_id: request.session_id,
                agent_session_id: request.agent_session_id,
                include_detached: request.include_detached,
                storage_root: request.storage_root,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            terminal_attachment_response_to_value(&response)
        }
        "terminal.attachments.pause" => {
            let request: RuntimeTerminalAttachmentPauseRequest = from_payload(payload)?;
            let response = pause_terminal_attachment(TerminalAttachmentPauseRequest {
                session_id: request.session_id,
                attachment_id: request.attachment_id,
                reason: request.reason,
                storage_root: request.storage_root,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            terminal_attachment_response_to_value(&response)
        }
        "terminal.attachments.resume" => {
            let request: RuntimeTerminalAttachmentResumeRequest = from_payload(payload)?;
            let response = resume_terminal_attachment(TerminalAttachmentResumeRequest {
                session_id: request.session_id,
                attachment_id: request.attachment_id,
                reason: request.reason,
                storage_root: request.storage_root,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            terminal_attachment_response_to_value(&response)
        }
        "terminal.waitUntil" => {
            let request: RuntimeTerminalWaitUntilRequest = from_payload(payload)?;
            let response = wait_terminal_until(TerminalWaitUntilRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                target: request.target,
                text: request.text,
                regex: request.regex,
                command_id: request.command_id,
                status: request.status,
                cursor: request.cursor,
                screen_cursor: request.screen_cursor,
                timeout_ms: request.timeout_ms,
                max_bytes: request.max_bytes,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            terminal_attachment_response_to_value(&response)
        }
        "terminal.input.execute" => {
            let request: RuntimeTerminalInputExecuteRequest = from_payload(payload)?;
            let response = execute_terminal_input(TerminalInputExecuteRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                action: request.action,
                command: request.command,
                text: request.text,
                keys: request.keys,
                append_newline: request.append_newline,
                bracketed_paste: request.bracketed_paste,
                sensitive_refs: request.sensitive_refs,
                cols: request.cols,
                rows: request.rows,
                signal: request.signal,
                reason: request.reason,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            terminal_attachment_response_to_value(&response)
        }
        "terminal.permissions.evaluate" => {
            let request: RuntimeTerminalPermissionEvaluateRequest = from_payload(payload)?;
            let response = evaluate_terminal_permission(TerminalPermissionEvaluateRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                action: request.action,
                input_id: request.input_id,
                command_id: request.command_id,
                risk: request.risk,
                title: request.title,
                summary: request.summary,
                detail: request.detail,
                redacted_preview: request.redacted_preview,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            terminal_attachment_response_to_value(&response)
        }
        "terminal.permissions.respond" => {
            let request: RuntimeTerminalPermissionRespondRequest = from_payload(payload)?;
            let response = respond_terminal_permission(TerminalPermissionRespondRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                permission_id: request.permission_id,
                decision: request.decision,
                reason: request.reason,
                expires_at: request.expires_at,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            terminal_attachment_response_to_value(&response)
        }
        "terminal.processes.read" => {
            let request: RuntimeTerminalProcessesReadRequest = from_payload(payload)?;
            let response = read_terminal_processes(TerminalProcessesReadRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                pid: request.pid,
                include_tree: request.include_tree,
                include_command: request.include_command,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            terminal_attachment_response_to_value(&response)
        }
        "terminal.processes.signal" => {
            let request: RuntimeTerminalProcessSignalRequest = from_payload(payload)?;
            let response = signal_terminal_process(TerminalProcessSignalRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                pid: request.pid,
                signal: request.signal,
                reason: request.reason,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            terminal_attachment_response_to_value(&response)
        }
        "terminal.command.status" => {
            let request: RuntimeTerminalCommandStatusRequest = from_payload(payload)?;
            let response = read_terminal_command_status(TerminalCommandStatusRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                command_id: request.command_id,
                include_output_summary: request.include_output_summary,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            terminal_attachment_response_to_value(&response)
        }
        "terminal.command.wait" => {
            let request: RuntimeTerminalCommandWaitRequest = from_payload(payload)?;
            let response = wait_terminal_command(TerminalCommandWaitRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                command_id: request.command_id,
                status: request.status,
                timeout_ms: request.timeout_ms,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            terminal_attachment_response_to_value(&response)
        }
        "terminal.command.readOutput" => {
            let request: RuntimeTerminalCommandOutputReadRequest = from_payload(payload)?;
            let response = read_terminal_command_output(TerminalCommandOutputReadRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                command_id: request.command_id,
                start: request.start,
                end: request.end,
                max_bytes: request.max_bytes,
                raw: request.raw,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            terminal_attachment_response_to_value(&response)
        }
        _ => unknown_method("terminal", method),
    }
}

pub(crate) fn handle_lsp_request(method: &str, payload: Value) -> Result<Value, RuntimeError> {
    match method {
        "lsp.documents.open"
        | "lsp.documents.change"
        | "lsp.documents.save"
        | "lsp.documents.close" => {
            let request: RuntimeLspDocumentRequest = from_payload(payload)?;
            let mapped = LspDocumentRequest {
                session_id: request.session_id,
                file_path: request.file_path,
                language_id: request.language_id,
                content: request.content,
                version: request.version,
                project_root: request.project_root,
            };
            match method {
                "lsp.documents.open" => lsp_open_document(mapped),
                "lsp.documents.change" => lsp_change_document(mapped),
                "lsp.documents.save" => lsp_save_document(mapped),
                _ => lsp_close_document(mapped),
            }
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "lsp.completion" => {
            let request: RuntimeLspCompletionRequest = from_payload(payload)?;
            let result = lsp_completion(LspCompletionRequest {
                session_id: request.session_id,
                file_path: request.file_path,
                language_id: request.language_id,
                line: request.line,
                column: request.column,
                version: request.version,
                project_root: request.project_root,
            })
            .map_err(map_runtime_error)?;
            to_value(&result)
        }
        "lsp.goto_definition" | "lsp.find_references" => {
            let request: RuntimeLspPositionRequest = from_payload(payload)?;
            let mapped = LspPositionRequest {
                file_path: request.file_path,
                language_id: request.language_id,
                line: request.line,
                column: request.column,
                project_root: request.project_root,
            };
            let result = match method {
                "lsp.goto_definition" => lsp_goto_definition(mapped),
                _ => lsp_find_references(mapped),
            }
            .map_err(map_runtime_error)?;
            to_value(&result)
        }
        "lsp.hover" => {
            let request: RuntimeLspPositionRequest = from_payload(payload)?;
            let result = lsp_hover(LspPositionRequest {
                file_path: request.file_path,
                language_id: request.language_id,
                line: request.line,
                column: request.column,
                project_root: request.project_root,
            })
            .map_err(map_runtime_error)?;
            to_value(&result)
        }
        _ => unknown_method("lsp", method),
    }
}

bridge_request!(RuntimeTerminalCreateRequest {
    session_id: Option<String>,
    title: Option<String>,
    cwd: Option<String>,
    shell: Option<String>,
    env: Option<Vec<TerminalShellLaunchEnvPair>>,
    cols: u16,
    rows: u16,
    source: Option<String>,
    mode: Option<String>,
    command: Option<String>,
    persist: Option<bool>,
    storage_root: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalShellLaunchPlanRequest { shell: String });

bridge_request!(RuntimeTerminalRestoreRequest {
    sessions: Vec<RuntimeTerminalCreateRequest>
});

bridge_request!(RuntimeTerminalStoredSessionsReadRequest {
    storage_root: String
});

bridge_request!(RuntimeTerminalWriteRequest {
    session_id: String,
    data: Option<String>,
    text: Option<String>,
    keys: Option<Vec<String>>,
    append_newline: Option<bool>,
    source: Option<String>,
    storage_root: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalReadRequest {
    session_id: String,
    cursor: Option<String>,
    max_bytes: Option<u32>,
    wait_ms: Option<u32>,
    storage_root: Option<String>
});

bridge_request!(RuntimeTerminalResizeRequest {
    session_id: String,
    cols: u16,
    rows: u16,
    storage_root: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalCloseRequest {
    session_id: String,
    storage_root: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalObserverCreateRequest {
    session_id: String,
    title: Option<String>,
    cwd: Option<String>,
    shell: Option<String>,
    cols: u16,
    rows: u16,
    source: Option<String>,
    mode: Option<String>,
    command: Option<String>,
    persist: Option<bool>,
    storage_root: String,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalObserverInputRequest {
    session_id: String,
    data: Option<String>,
    text: Option<String>,
    keys: Option<Vec<String>>,
    append_newline: Option<bool>,
    source: Option<String>,
    storage_root: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalObserverOutputRequest {
    session_id: String,
    data: String,
    storage_root: Option<String>
});

bridge_request!(RuntimeTerminalObserverResizeRequest {
    session_id: String,
    cols: u16,
    rows: u16,
    storage_root: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalObserverExitRequest {
    session_id: String,
    exit_code: i32,
    storage_root: Option<String>
});

bridge_request!(RuntimeTerminalObserverCloseRequest {
    session_id: String,
    storage_root: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalMemoryTimelineReadRequest {
    session_id: String,
    storage_root: String,
    cursor: Option<String>,
    limit: Option<u32>,
    kinds: Option<Vec<String>>,
    actors: Option<Vec<String>>,
    command_id: Option<String>,
    tool_call_id: Option<String>,
    agent_session_id: Option<String>,
    seq_start: Option<f64>,
    seq_end: Option<f64>,
    time_start_ms: Option<f64>,
    time_end_ms: Option<f64>,
    audit: Option<bool>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalEventsReadRequest {
    session_id: String,
    storage_root: String,
    cursor: Option<String>,
    limit: Option<u32>,
    kinds: Option<Vec<String>>,
    actors: Option<Vec<String>>,
    audit: Option<bool>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalCommandsReadRequest {
    session_id: String,
    storage_root: String,
    cursor: Option<String>,
    limit: Option<u32>,
    status: Option<String>,
    audit: Option<bool>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalOutputRangeReadRequest {
    session_id: String,
    storage_root: String,
    start: f64,
    end: f64,
    raw: Option<bool>,
    audit: Option<bool>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalArtifactsListRequest {
    session_id: String,
    storage_root: String,
    audit: Option<bool>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalPermissionEventRequest {
    session_id: String,
    storage_root: String,
    permission_id: String,
    action: Option<String>,
    risk: Option<String>,
    summary: Option<String>,
    title: Option<String>,
    detail: Option<String>,
    command_id: Option<String>,
    input_id: Option<String>,
    agent_session_id: Option<String>,
    runtime_turn_id: Option<String>,
    tool_call_id: Option<String>,
    decision: Option<String>,
    reason: Option<String>,
    expires_at: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalHandoffEventRequest {
    session_id: String,
    storage_root: String,
    handoff_id: Option<String>,
    from_actor: Option<Value>,
    to_actor: Option<Value>,
    reason: Option<String>,
    summary: Option<String>,
    status: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalOutputPolicyMarkerRequest {
    session_id: String,
    storage_root: String,
    start: f64,
    end: f64,
    policy: String,
    reason: Option<String>,
    encrypted_ref: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalScreenReadRequest {
    session_id: String,
    storage_root: Option<String>,
    cursor: Option<String>,
    include_scrollback: Option<bool>,
    max_rows: Option<u32>,
    max_bytes: Option<u32>,
    selected_text: Option<String>
});

bridge_request!(RuntimeTerminalMapReadRequest {
    session_id: String,
    storage_root: Option<String>,
    screen_cursor: Option<String>,
    max_regions: Option<u32>,
    include_text: Option<bool>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalActExecuteRequest {
    session_id: String,
    storage_root: Option<String>,
    action: String,
    region_id: Option<String>,
    screen_cursor: Option<String>,
    text: Option<String>,
    direction: Option<String>,
    amount: Option<u32>,
    reason: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalWaitUntilRequest {
    session_id: String,
    storage_root: String,
    target: String,
    text: Option<String>,
    regex: Option<String>,
    command_id: Option<String>,
    status: Option<String>,
    cursor: Option<String>,
    screen_cursor: Option<String>,
    timeout_ms: Option<u32>,
    max_bytes: Option<u32>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalInputExecuteRequest {
    session_id: String,
    storage_root: Option<String>,
    action: String,
    command: Option<String>,
    text: Option<String>,
    keys: Option<Vec<String>>,
    append_newline: Option<bool>,
    bracketed_paste: Option<bool>,
    sensitive_refs: Option<Vec<String>>,
    cols: Option<u16>,
    rows: Option<u16>,
    signal: Option<String>,
    reason: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalPermissionEvaluateRequest {
    session_id: String,
    storage_root: String,
    action: String,
    input_id: Option<String>,
    command_id: Option<String>,
    risk: Option<String>,
    title: Option<String>,
    summary: Option<String>,
    detail: Option<String>,
    redacted_preview: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalPermissionRespondRequest {
    session_id: String,
    storage_root: String,
    permission_id: String,
    decision: String,
    reason: Option<String>,
    expires_at: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalProcessesReadRequest {
    session_id: String,
    storage_root: String,
    pid: Option<u32>,
    include_tree: Option<bool>,
    include_command: Option<bool>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalProcessSignalRequest {
    session_id: String,
    storage_root: String,
    pid: Option<u32>,
    signal: String,
    reason: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalCommandStatusRequest {
    session_id: String,
    storage_root: String,
    command_id: Option<String>,
    include_output_summary: Option<bool>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalCommandWaitRequest {
    session_id: String,
    storage_root: String,
    command_id: Option<String>,
    status: Option<String>,
    timeout_ms: Option<u32>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalCommandOutputReadRequest {
    session_id: String,
    storage_root: String,
    command_id: String,
    start: Option<f64>,
    end: Option<f64>,
    max_bytes: Option<u32>,
    raw: Option<bool>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalAttachmentAttachRequest {
    session_id: String,
    agent_session_id: String,
    runtime_turn_id: Option<String>,
    tool_call_id: Option<String>,
    mode: String,
    reason: Option<String>,
    ttl_ms: Option<f64>,
    permission_id: Option<String>,
    permission_scope: Option<String>,
    approved: Option<bool>,
    storage_root: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalAttachmentDetachRequest {
    session_id: String,
    attachment_id: String,
    reason: Option<String>,
    storage_root: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalAttachmentListRequest {
    session_id: Option<String>,
    agent_session_id: Option<String>,
    include_detached: Option<bool>,
    storage_root: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalAttachmentPauseRequest {
    session_id: String,
    attachment_id: String,
    reason: Option<String>,
    storage_root: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalAttachmentResumeRequest {
    session_id: String,
    attachment_id: String,
    reason: Option<String>,
    storage_root: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeLspDocumentRequest {
    session_id: String,
    file_path: String,
    language_id: String,
    content: String,
    version: i32,
    project_root: Option<String>
});

bridge_request!(RuntimeLspCompletionRequest {
    session_id: String,
    file_path: String,
    language_id: String,
    line: u32,
    column: u32,
    version: i32,
    project_root: Option<String>
});

bridge_request!(RuntimeLspPositionRequest {
    file_path: String,
    language_id: String,
    line: u32,
    column: u32,
    project_root: Option<String>
});

fn map_terminal_create_request(request: RuntimeTerminalCreateRequest) -> TerminalCreateRequest {
    TerminalCreateRequest {
        session_id: request.session_id,
        title: request.title,
        cwd: request.cwd,
        shell: request.shell,
        env: request.env,
        cols: request.cols,
        rows: request.rows,
        source: request.source,
        mode: request.mode,
        command: request.command,
        persist: request.persist,
        storage_root: request.storage_root,
        actor_json: value_to_json_string(request.actor),
        correlation_json: value_to_json_string(request.correlation),
    }
}

fn map_terminal_permission_request(
    request: RuntimeTerminalPermissionEventRequest,
) -> TerminalPermissionEventRequest {
    TerminalPermissionEventRequest {
        session_id: request.session_id,
        storage_root: request.storage_root,
        permission_id: request.permission_id,
        action: request.action,
        risk: request.risk,
        summary: request.summary,
        title: request.title,
        detail: request.detail,
        command_id: request.command_id,
        input_id: request.input_id,
        agent_session_id: request.agent_session_id,
        runtime_turn_id: request.runtime_turn_id,
        tool_call_id: request.tool_call_id,
        decision: request.decision,
        reason: request.reason,
        expires_at: request.expires_at,
        actor_json: value_to_json_string(request.actor),
        correlation_json: value_to_json_string(request.correlation),
    }
}

fn map_terminal_handoff_request(
    request: RuntimeTerminalHandoffEventRequest,
) -> TerminalHandoffEventRequest {
    TerminalHandoffEventRequest {
        session_id: request.session_id,
        storage_root: request.storage_root,
        handoff_id: request.handoff_id,
        from_actor_json: value_to_json_string(request.from_actor),
        to_actor_json: value_to_json_string(request.to_actor),
        reason: request.reason,
        summary: request.summary,
        status: request.status,
        actor_json: value_to_json_string(request.actor),
        correlation_json: value_to_json_string(request.correlation),
    }
}

fn from_payload<T: for<'de> Deserialize<'de>>(payload: Value) -> Result<T, RuntimeError> {
    serde_json::from_value(payload).map_err(|error| runtime_error("BAD_REQUEST", error.to_string()))
}

fn to_value<T: Serialize>(value: &T) -> Result<Value, RuntimeError> {
    serde_json::to_value(value)
        .map_err(|error| runtime_error("SERDE_ENCODE_FAILED", error.to_string()))
}

fn value_to_json_string(value: Option<Value>) -> Option<String> {
    value.map(|item| item.to_string())
}

fn terminal_read_response_to_value(
    response: &lyra_terminal_core::TerminalReadResponse,
) -> Result<Value, RuntimeError> {
    let mut value = to_value(response)?;
    if let Some(memory_json) = value.get("memory").and_then(Value::as_str) {
        let memory_value = serde_json::from_str::<Value>(memory_json)
            .map_err(|error| runtime_error("SERDE_DECODE_FAILED", error.to_string()))?;
        if let Some(object) = value.as_object_mut() {
            object.insert("memory".to_string(), memory_value);
        }
    }
    Ok(value)
}

fn terminal_screen_response_to_value(
    response: &lyra_terminal_core::TerminalScreenReadResponse,
) -> Result<Value, RuntimeError> {
    let mut value = to_value(response)?;
    decode_memory_field(&mut value)?;
    Ok(value)
}

fn terminal_map_response_to_value(
    response: &lyra_terminal_core::TerminalMapReadResponse,
) -> Result<Value, RuntimeError> {
    let mut value = to_value(response)?;
    decode_memory_field(&mut value)?;
    if let Some(screen) = value.get_mut("screen") {
        decode_memory_field(screen)?;
    }
    Ok(value)
}

fn terminal_act_response_to_value(
    response: &lyra_terminal_core::TerminalActExecuteResponse,
) -> Result<Value, RuntimeError> {
    let mut value = to_value(response)?;
    decode_memory_field(&mut value)?;
    if let Some(map) = value.get_mut("map") {
        decode_memory_field(map)?;
        if let Some(screen) = map.get_mut("screen") {
            decode_memory_field(screen)?;
        }
    }
    Ok(value)
}

fn terminal_attachment_response_to_value<T: Serialize>(
    response: &T,
) -> Result<Value, RuntimeError> {
    let mut value = to_value(response)?;
    decode_memory_field(&mut value)?;
    Ok(value)
}

fn decode_memory_field(value: &mut Value) -> Result<(), RuntimeError> {
    let Some(memory_json) = value.get("memory").and_then(Value::as_str) else {
        return Ok(());
    };
    let memory_value = serde_json::from_str::<Value>(memory_json)
        .map_err(|error| runtime_error("SERDE_DECODE_FAILED", error.to_string()))?;
    if let Some(object) = value.as_object_mut() {
        object.insert("memory".to_string(), memory_value);
    }
    Ok(())
}

fn map_runtime_error(error: impl std::fmt::Display) -> RuntimeError {
    runtime_error("RUNTIME_ERROR", error.to_string())
}

fn unknown_method(scope: &str, method: &str) -> Result<Value, RuntimeError> {
    Err(runtime_error(
        "METHOD_NOT_FOUND",
        format!("unknown {scope} runtime method: {method}"),
    ))
}

fn runtime_error(code: &str, message: impl Into<String>) -> RuntimeError {
    RuntimeError::new(code, message.into())
}

#[cfg(test)]
mod tests {
    use super::handle_terminal_request;
    use serde_json::json;

    #[test]
    fn terminal_phase_methods_are_wired_to_core() {
        let storage_root = std::env::temp_dir()
            .join(format!("lyrad-terminal-wiring-{}", std::process::id()))
            .to_string_lossy()
            .to_string();
        let cases = [
            (
                "terminal.shell.launchPlan",
                json!({
                    "shell": "/bin/zsh"
                }),
            ),
            (
                "terminal.waitUntil",
                json!({
                    "sessionId": "terminal-session-1",
                    "storageRoot": storage_root,
                    "target": "event",
                    "cursor": "0",
                    "timeoutMs": 1
                }),
            ),
            (
                "terminal.input.execute",
                json!({
                    "sessionId": "terminal-session-1",
                    "storageRoot": storage_root,
                    "action": "pressKeys",
                    "keys": ["enter"]
                }),
            ),
            (
                "terminal.permissions.evaluate",
                json!({
                    "sessionId": "terminal-session-1",
                    "storageRoot": storage_root,
                    "action": "runCommand",
                    "risk": "shell"
                }),
            ),
            (
                "terminal.permissions.respond",
                json!({
                    "sessionId": "terminal-session-1",
                    "storageRoot": storage_root,
                    "permissionId": "permission-1",
                    "decision": "deny"
                }),
            ),
            (
                "terminal.processes.read",
                json!({
                    "sessionId": "terminal-session-1",
                    "storageRoot": storage_root
                }),
            ),
            (
                "terminal.processes.signal",
                json!({
                    "sessionId": "terminal-session-1",
                    "storageRoot": storage_root,
                    "signal": "SIGTERM"
                }),
            ),
            (
                "terminal.command.status",
                json!({
                    "sessionId": "terminal-session-1",
                    "storageRoot": storage_root
                }),
            ),
            (
                "terminal.command.wait",
                json!({
                    "sessionId": "terminal-session-1",
                    "storageRoot": storage_root,
                    "commandId": "command-1",
                    "timeoutMs": 1
                }),
            ),
            (
                "terminal.command.readOutput",
                json!({
                    "sessionId": "terminal-session-1",
                    "storageRoot": storage_root,
                    "commandId": "command-1"
                }),
            ),
        ];

        for (method, payload) in cases {
            if let Err(error) = handle_terminal_request(method, payload) {
                assert_ne!(error.code, "NOT_IMPLEMENTED", "{method} should be wired");
            }
        }
    }

    #[test]
    fn unknown_terminal_methods_still_return_method_not_found() {
        let error = handle_terminal_request("terminal.notReal", json!({}))
            .expect_err("unknown method should fail");

        assert_eq!(error.code, "METHOD_NOT_FOUND");
    }
}
