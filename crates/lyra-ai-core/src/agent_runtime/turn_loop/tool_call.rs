use super::*;

pub(in crate::agent_runtime) enum ToolCallRunOutcome {
    Continue,
    StopTurn,
}

pub(in crate::agent_runtime) fn run_tool_call(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    context: &ToolExecutionContext,
    tool_call: &ToolCall,
    permission_mode: PermissionMode,
    messages: &mut Vec<ChatMessage>,
    inspected_tool_paths: &mut HashSet<String>,
) -> Result<ToolCallRunOutcome> {
    if let Some(operation) = operation_from_tool_call(tool_call)? {
        inspected_tool_paths.insert(normalized_tool_path(&operation.path));
        tool_dispatch::run_tool_operation(
            store,
            session_id,
            turn_id,
            context,
            &operation,
            permission_mode,
            messages,
            inspected_tool_paths,
        )?;
        return Ok(ToolCallRunOutcome::Continue);
    }
    if tool_call.name == "update_plan" {
        plan_tool_call::run_update_plan_call(store, session_id, turn_id, tool_call, messages)?;
        return Ok(ToolCallRunOutcome::Continue);
    }
    if tool_call.name == "open_clarification_panel" {
        let outcome = clarification_gate::open_model_clarification_panel(
            store, session_id, turn_id, tool_call,
        )?;
        let detail = store.read_session_detail(session_id)?;
        emit_store_event(
            store,
            session_id,
            Some(turn_id),
            "session_updated",
            json!({ "detail": detail }),
        )?;
        if matches!(
            outcome,
            clarification_gate::ModelClarificationPanelOutcome::AlreadyAnswered
        ) {
            if let Some(detail) = store.read_session_detail(session_id)? {
                let mut model_messages = vec![
                    ChatMessage {
                        role: "assistant".to_string(),
                        content: serde_json::to_string(tool_call)?,
                    },
                    ChatMessage {
                        role: "user".to_string(),
                        content: answered_clarification_tool_result_message(&detail, turn_id),
                    },
                ];
                model_turn::redact_model_input_for_turn(
                    store,
                    session_id,
                    turn_id,
                    &mut model_messages,
                )?;
                messages.extend(model_messages);
            }
            return Ok(ToolCallRunOutcome::Continue);
        }
        return Ok(ToolCallRunOutcome::StopTurn);
    }
    run_registered_agent_tool_call(
        store,
        session_id,
        turn_id,
        context,
        tool_call,
        permission_mode,
        messages,
    )?;
    Ok(ToolCallRunOutcome::Continue)
}

fn operation_from_tool_call(tool_call: &ToolCall) -> Result<Option<ToolOperationEnvelope>> {
    let path = match tool_call.name.as_str() {
        "read_file" => TOOL_FS_READ_FILE,
        "list_directory" => TOOL_FS_LIST_FILES,
        "search_text" => TOOL_FS_SEARCH_TEXT,
        "find_path" => TOOL_FS_SEARCH_FILES,
        "git_status" => TOOL_GIT_STATUS,
        "git_diff" => TOOL_GIT_DIFF,
        "terminal" => TOOL_SHELL_RUN_COMMAND,
        "edit_file" => {
            let args = edit_file_toolfs_args(&tool_call.arguments)?;
            let path = if args.get("artifactId").is_some() || args.get("patchRef").is_some() {
                TOOL_FS_APPLY_PATCH
            } else {
                TOOL_FS_PROPOSE_PATCH
            };
            return Ok(Some(toolfs_operation(tool_call, path, args)));
        }
        _ => return Ok(None),
    };
    Ok(Some(toolfs_operation(
        tool_call,
        path,
        tool_call.arguments.clone(),
    )))
}

fn edit_file_toolfs_args(arguments: &Value) -> Result<Value> {
    let object = arguments
        .as_object()
        .ok_or_else(|| anyhow!("edit_file arguments must be an object"))?;
    if object.get("artifactId").is_some() || object.get("patchRef").is_some() {
        return Ok(json!({
            "artifactId": object.get("artifactId").cloned().unwrap_or(Value::Null),
            "patchRef": object.get("patchRef").cloned().unwrap_or(Value::Null),
        }));
    }
    Ok(json!({
        "title": object
            .get("title")
            .cloned()
            .unwrap_or_else(|| Value::String("Edit file".to_string())),
        "rationale": object.get("rationale").cloned().unwrap_or(Value::Null),
        "patch": object.get("patch").cloned().unwrap_or(Value::Null),
        "expectedFiles": object
            .get("expectedFiles")
            .cloned()
            .unwrap_or_else(|| json!([])),
    }))
}

fn run_registered_agent_tool_call(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    context: &ToolExecutionContext,
    tool_call: &ToolCall,
    permission_mode: PermissionMode,
    messages: &mut Vec<ChatMessage>,
) -> Result<()> {
    let mcp_tool_ref = resolve_mcp_tool_ref(
        &store.root,
        context.workspace_root.as_deref(),
        &tool_call.name,
    );
    let mut operation = agent_operation(tool_call);
    if let Some(tool_ref) = mcp_tool_ref.as_ref() {
        operation.path = mcp_tool_operation_path(tool_ref);
    }
    emit_tool_start(store, session_id, turn_id, &operation)?;
    if matches!(
        tool_call.name.as_str(),
        "write_file" | "delete_path" | "move_path" | "create_directory"
    ) {
        ensure_recovery_anchor_for_write(store, session_id, turn_id)?;
    }
    let policy = permission_policy_for_mode(permission_mode);
    if ALL_TOOL_NAMES
        .iter()
        .any(|registered| *registered == tool_call.name)
    {
        match crate::tools::decide_tool_permission(&tool_call.name, &tool_call.arguments, &policy) {
            ToolPermissionDecision::Allow => {}
            ToolPermissionDecision::Deny(reason) => {
                let result = ToolResultEnvelope::failed(
                    &operation,
                    crate::tool_runtime::operation::TOOL_EXECUTION_FAILED,
                    format!("AgentTool denied: {reason}"),
                );
                return finish_agent_tool_result(
                    store, session_id, turn_id, &operation, tool_call, result, messages,
                );
            }
            ToolPermissionDecision::Confirm => {
                let result = create_agent_tool_approval_result(
                    store, session_id, turn_id, &operation, tool_call,
                )?;
                return finish_agent_tool_result(
                    store, session_id, turn_id, &operation, tool_call, result, messages,
                );
            }
        }
    } else if mcp_tool_ref.is_some() {
        if let Some(result) =
            project_policy_blocked_agent_tool(store, session_id, turn_id, &operation)?
        {
            return finish_agent_tool_result(
                store, session_id, turn_id, &operation, tool_call, result, messages,
            );
        }
        let result =
            create_agent_tool_approval_result(store, session_id, turn_id, &operation, tool_call)?;
        return finish_agent_tool_result(
            store, session_id, turn_id, &operation, tool_call, result, messages,
        );
    }
    let tool_context = ToolContext::new(context.workspace_root.clone())
        .with_op_id_prefix(operation.op_id.clone())
        .with_permission_policy(policy);
    record_agent_tool_recovery_backups(
        store,
        session_id,
        turn_id,
        context.workspace_root.as_deref(),
        &tool_call.name,
        &tool_call.arguments,
    )?;
    let result =
        match run_registered_tool(&tool_call.name, tool_call.arguments.clone(), &tool_context) {
            Ok(output) => {
                record_agent_tool_recovery_post_state(
                    store,
                    session_id,
                    turn_id,
                    context.workspace_root.as_deref(),
                    &tool_call.name,
                    &tool_call.arguments,
                )?;
                let changed_files = agent_tool_changed_files(&tool_call.name, &output);
                let content = serde_json::to_string_pretty(&output)?;
                let mut result = ToolResultEnvelope::completed(
                    &operation,
                    format!("Ran AgentTool {}", tool_call.name),
                    content,
                    false,
                );
                result.metadata = Some(json!({
                    "kind": "agent_tool_call",
                    "toolCallId": tool_call.id,
                    "toolName": tool_call.name,
                    "changedFiles": changed_files,
                    "workspaceUri": agent_tool_workspace_uri(&output),
                }));
                result
            }
            Err(error) => {
                let message = error.to_string();
                let code = if message.contains("requires user confirmation") {
                    crate::tool_runtime::operation::TOOL_APPROVAL_REQUIRED
                } else {
                    tool_error_code(
                        &error,
                        crate::tool_runtime::operation::TOOL_EXECUTION_FAILED,
                    )
                };
                ToolResultEnvelope::failed(&operation, code, message)
            }
        };
    finish_agent_tool_result(
        store, session_id, turn_id, &operation, tool_call, result, messages,
    )
}

fn project_policy_blocked_agent_tool(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    operation: &ToolOperationEnvelope,
) -> Result<Option<ToolResultEnvelope>> {
    let Some((snapshot_id, policy)) = store.read_effective_policy_for_turn(session_id, turn_id)?
    else {
        return Ok(None);
    };
    let decision = record_tool_decision(
        store,
        session_id,
        turn_id,
        Some(&snapshot_id),
        &policy,
        operation,
    )?;
    emit_tool_event(
        store,
        session_id,
        turn_id,
        "security_decision_recorded",
        json!({
            "sessionId": session_id,
            "turnId": turn_id,
            "operationId": operation.op_id,
            "snapshotId": snapshot_id,
            "resourceKind": "tool",
            "resourceRef": operation.path,
            "security": security_event_payload(&decision),
        }),
    )?;
    if decision.decision != "deny" {
        return Ok(None);
    }
    emit_tool_event(
        store,
        session_id,
        turn_id,
        "security_resource_blocked",
        json!({
            "sessionId": session_id,
            "turnId": turn_id,
            "operationId": operation.op_id,
            "snapshotId": snapshot_id,
            "resourceKind": "tool",
            "resourceRef": operation.path,
            "security": security_event_payload(&decision),
        }),
    )?;
    let mut result = ToolResultEnvelope::failed(
        operation,
        SECURITY_RESOURCE_DENIED,
        "Tool operation was denied by project policy",
    );
    result.metadata = Some(json!({
        "kind": "security_resource_blocked",
        "securityDecisionId": decision.decision_id,
        "reasonCodes": decision.reason_codes,
    }));
    Ok(Some(result))
}

fn create_agent_tool_approval_result(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    operation: &ToolOperationEnvelope,
    tool_call: &ToolCall,
) -> Result<ToolResultEnvelope> {
    let title = agent_tool_approval_title(&tool_call.name);
    let requested_action = json!({
        "toolPath": operation.path,
        "toolName": tool_call.name,
        "toolOperationId": operation.op_id,
        "arguments": tool_call.arguments,
    });
    let ticket = store.append_approval_ticket(
        session_id,
        turn_id,
        "pending_user",
        "user",
        &title,
        json!({
            "level": "high",
            "kinds": ["workspace_write", "process"],
            "summary": title,
        }),
        json!({
            "workspace": "bound",
            "toolName": tool_call.name,
            "arguments": tool_call.arguments,
        }),
        requested_action,
    )?;
    let mut result = ToolResultEnvelope::failed(
        operation,
        crate::tool_runtime::operation::TOOL_APPROVAL_REQUIRED,
        "User approval is required before running this AgentTool",
    );
    result.metadata = Some(json!({
        "kind": "agent_tool_approval_required",
        "approvalTicketId": ticket.approval_ticket_id,
        "toolPath": operation.path,
        "toolName": tool_call.name,
    }));
    Ok(result)
}

fn agent_tool_approval_title(tool_name: &str) -> String {
    match tool_name {
        "write_file" => "Write workspace file",
        "delete_path" => "Delete workspace path",
        "move_path" => "Move workspace path",
        "create_directory" => "Create workspace directory",
        "terminal" => "Run shell command",
        _ => "Run AgentTool",
    }
    .to_string()
}

fn record_agent_tool_recovery_backups(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    workspace_root: Option<&str>,
    tool_name: &str,
    arguments: &Value,
) -> Result<()> {
    let Some(workspace_root) = workspace_root.and_then(trim_to_string) else {
        return Ok(());
    };
    for path in workspace_write_paths_for_tool(tool_name, arguments) {
        store.append_recovery_backup(session_id, turn_id, &workspace_root, &path)?;
    }
    Ok(())
}

fn record_agent_tool_recovery_post_state(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    workspace_root: Option<&str>,
    tool_name: &str,
    arguments: &Value,
) -> Result<()> {
    let Some(workspace_root) = workspace_root.and_then(trim_to_string) else {
        return Ok(());
    };
    for path in workspace_write_paths_for_tool(tool_name, arguments) {
        store.record_recovery_backup_post_state(session_id, turn_id, &workspace_root, &path)?;
    }
    Ok(())
}

pub(super) fn finish_agent_tool_result(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    operation: &ToolOperationEnvelope,
    tool_call: &ToolCall,
    mut result: ToolResultEnvelope,
    messages: &mut Vec<ChatMessage>,
) -> Result<()> {
    let mut metadata = result.metadata.take().unwrap_or_else(|| json!({}));
    if let Some(object) = metadata.as_object_mut() {
        object.insert("kind".to_string(), json!("agent_tool_call"));
        object.insert("toolCallId".to_string(), json!(tool_call.id));
        object.insert("toolName".to_string(), json!(tool_call.name));
    } else {
        metadata = json!({
            "kind": "agent_tool_call",
            "toolCallId": tool_call.id,
            "toolName": tool_call.name,
        });
    }
    result.metadata = Some(metadata);
    let result_blob = store.append_tool_result_blob(
        session_id,
        turn_id,
        &result.op_id,
        &result.path,
        verification::tool_result_status_str(&result.status),
        &result.content,
    )?;
    result.result_ref = Some(result_blob.result_ref.clone());
    verification::enrich_tool_result_metadata(
        store,
        session_id,
        turn_id,
        &mut result,
        &result_blob,
    )?;
    project_follow_operation_finished(
        store,
        session_id,
        turn_id,
        operation,
        &result,
        &result_blob,
    )?;
    project_recovery_side_effect(store, session_id, turn_id, operation, &result)?;
    let event_type = if result.status == ToolResultStatus::Completed {
        "tool_operation_completed"
    } else {
        "tool_operation_failed"
    };
    emit_tool_event(
        store,
        session_id,
        turn_id,
        event_type,
        json!({
            "operation": tool_operation_payload(operation),
            "result": tool_result_payload(&result, &result_blob),
        }),
    )?;
    emit_verification_projection_events(store, session_id, Some(turn_id), &result)?;
    record_todo_from_tool_result(store, session_id, turn_id, operation, &result)?;
    store.evaluate_completion_audit_and_delivery_proof(session_id, Some(turn_id))?;
    project_work_after_completion(store, session_id, Some(turn_id))?;
    let detail = store.read_session_detail(session_id)?;
    delivery::emit_security_summary_updated(store, session_id, turn_id, detail.as_ref())?;
    emit_completion_projection_events(store, session_id, Some(turn_id), detail.as_ref())?;
    if let Some(detail) = detail {
        emit_store_event(
            store,
            session_id,
            Some(turn_id),
            "session_updated",
            json!({ "detail": detail }),
        )?;
    }
    let mut model_messages = vec![
        ChatMessage {
            role: "assistant".into(),
            content: serde_json::to_string(tool_call)?,
        },
        ChatMessage {
            role: "user".into(),
            content: tool_result_chat_message(&result)?,
        },
    ];
    model_turn::redact_model_input_for_turn(store, session_id, turn_id, &mut model_messages)?;
    messages.extend(model_messages);
    Ok(())
}

pub(super) fn emit_tool_start(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    operation: &ToolOperationEnvelope,
) -> Result<()> {
    emit_tool_event(
        store,
        session_id,
        turn_id,
        "tool_operation_requested",
        json!({ "operation": tool_operation_payload(operation) }),
    )?;
    emit_runtime_state(store, session_id, turn_id, "tool_executing")?;
    emit_tool_event(
        store,
        session_id,
        turn_id,
        "tool_operation_started",
        json!({ "operation": tool_operation_payload(operation) }),
    )?;
    project_follow_operation_started(store, session_id, turn_id, operation)
}

fn toolfs_operation(tool_call: &ToolCall, path: &str, args: Value) -> ToolOperationEnvelope {
    ToolOperationEnvelope {
        schema_version: "v1".to_string(),
        kind: "tool_operation".to_string(),
        op_id: tool_call_op_id(tool_call),
        op: ToolFsOp::Run,
        path: path.to_string(),
        args,
    }
}

pub(super) fn agent_operation(tool_call: &ToolCall) -> ToolOperationEnvelope {
    toolfs_operation(
        tool_call,
        &format!("/tools/agent/{}", tool_call.name),
        tool_call.arguments.clone(),
    )
}

fn permission_policy_for_mode(permission_mode: PermissionMode) -> ToolPermissionPolicy {
    match permission_mode {
        PermissionMode::Sandbox => ToolPermissionPolicy::default(),
        PermissionMode::FullAccess => ToolPermissionPolicy {
            always_allow: ToolPermissionRuleSet::from_tools(ALL_TOOL_NAMES.iter().copied()),
            always_deny: ToolPermissionRuleSet::default(),
            always_confirm: ToolPermissionRuleSet::default(),
            default: ToolPermissionDecision::Allow,
        },
    }
}

fn tool_call_op_id(tool_call: &ToolCall) -> String {
    trim_to_string(&tool_call.id).unwrap_or_else(|| new_id("tool_call"))
}

fn agent_tool_changed_files(tool_name: &str, output: &Value) -> Vec<Value> {
    match tool_name {
        "write_file" => value_path(output, "path")
            .map(|path| vec![json!({ "path": path, "changeType": "modified" })])
            .unwrap_or_default(),
        "delete_path" => value_path(output, "path")
            .map(|path| vec![json!({ "path": path, "changeType": "deleted" })])
            .unwrap_or_default(),
        "move_path" => {
            let mut files = Vec::new();
            if let Some(path) = value_path(output, "fromPath") {
                files.push(json!({ "path": path, "changeType": "deleted" }));
            }
            if let Some(path) = value_path(output, "toPath") {
                files.push(json!({ "path": path, "changeType": "created" }));
            }
            files
        }
        "create_directory" => value_path(output, "path")
            .map(|path| vec![json!({ "path": path, "changeType": "created" })])
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn agent_tool_workspace_uri(output: &Value) -> Option<String> {
    value_path(output, "path").or_else(|| value_path(output, "toPath"))
}

fn value_path(output: &Value, key: &str) -> Option<String> {
    output
        .get(key)
        .and_then(Value::as_str)
        .and_then(trim_to_string)
}
