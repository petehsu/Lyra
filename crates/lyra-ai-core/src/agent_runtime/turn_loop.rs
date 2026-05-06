use super::*;

static ACTIVE_TURNS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
const MAX_TOOL_STEPS: usize = 6;

fn active_turns() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    ACTIVE_TURNS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn send_turn(request: SendTurnRequest) -> Result<SendTurnResult> {
    let storage_root = request.storage.storage_root.clone();
    let store = AiStore::open(storage_root.as_deref())?;
    let session = ensure_session(
        &store,
        request.session_id.as_deref(),
        &request.options,
        &request.input,
    )?;
    let profile_id = resolve_profile_id(
        &store,
        request
            .options
            .profile_id
            .as_deref()
            .or(session.profile_id.as_deref()),
    )?;
    let now = now_ms();
    let user_message_id = new_id("msg");
    let turn_id = new_id("turn");
    let permission_mode = normalize_permission_mode(
        request.options.permission_mode.as_deref(),
        request.options.approval_policy.as_deref(),
    );
    let text = request.input.text.trim().to_string();
    let parts = input_parts(&request.input);
    let user_message = AgentMessage {
        id: user_message_id.clone(),
        session_id: session.id.clone(),
        turn_id: Some(turn_id.clone()),
        role: "user".to_string(),
        content: text.clone(),
        content_parts: if parts.is_empty() { None } else { Some(parts) },
        display_content: Some(text.clone()),
        created_at: now,
    };
    store.append_message(&user_message)?;
    let policy_snapshot = read_project_policy_snapshot(session.project_root.as_deref());
    let turn = AgentTurn {
        id: turn_id.clone(),
        session_id: session.id.clone(),
        profile_id: profile_id.clone(),
        status: "running".to_string(),
        collaboration_mode: Some(normalize_collaboration_mode(
            request.options.collaboration_mode.as_deref(),
        )),
        permission_mode: permission_mode.as_str().to_string(),
        error_code: None,
        error_message: None,
        usage: None,
        created_at: now,
        updated_at: now,
    };
    store.insert_turn(
        &turn,
        &user_message_id,
        policy_snapshot
            .as_ref()
            .map(|snapshot| snapshot.snapshot_id.as_str()),
    )?;
    let checkpoint_id =
        store.create_timeline_checkpoint(&session.id, &turn_id, &user_message_id)?;
    if let Some(items) = mini_todo_items_for_request(&text) {
        let refs = store.create_execution_todo_list(
            &session.id,
            Some(&turn_id),
            "mini",
            "Execution checklist",
            json!({
                "type": "mini_auto",
                "userMessageId": user_message_id,
                "runtimeTurnId": turn_id,
                "heuristic": "execution_request_v1"
            }),
            &items,
        )?;
        emit_store_event(
            &store,
            &session.id,
            Some(&turn_id),
            "todo_list_created",
            json!({
                "sessionId": session.id,
                "turnId": turn_id,
                "todoListId": refs.todo_list_id,
                "executionRunId": refs.execution_run_id,
                "kind": "mini",
                "title": "Execution checklist"
            }),
        )?;
    }
    let runtime_options_payload = json!({
        "model": request.options.model.as_deref(),
        "modelProvider": request.options.model_provider.as_deref(),
        "effort": request.options.effort.as_deref(),
        "verbosity": request.options.verbosity.as_deref(),
        "approvalPolicy": request.options.approval_policy.as_deref(),
        "permissionMode": permission_mode.as_str()
    });
    let mut updated_session = session.clone();
    updated_session.title = title_after_message(&updated_session.title, &text);
    updated_session.profile_id = Some(profile_id.clone());
    updated_session.updated_at = now;
    store.upsert_session_index(&updated_session)?;
    emit_store_event(
        &store,
        &updated_session.id,
        Some(&turn_id),
        "runtime_turn_created",
        json!({
            "turn": turn,
            "userMessage": user_message,
            "policySnapshot": policy_snapshot,
            "checkpointId": checkpoint_id,
            "runtimeOptions": runtime_options_payload
        }),
    )?;
    if let Some(detail) = store.read_session_detail(&updated_session.id)? {
        emit_store_event(
            &store,
            &updated_session.id,
            None,
            "session_updated",
            json!({ "detail": detail }),
        )?;
    }

    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut active) = active_turns().lock() {
        active.insert(turn_id.clone(), cancel.clone());
    }
    spawn_turn_worker(
        storage_root,
        updated_session.id.clone(),
        turn_id.clone(),
        profile_id,
        request.options.model.clone(),
        request.options.cwd.clone(),
        permission_mode,
        cancel,
    );
    let detail = store
        .read_session_detail(&updated_session.id)?
        .ok_or_else(|| anyhow!("AI session not found: {}", updated_session.id))?;
    Ok(SendTurnResult {
        session_id: updated_session.id,
        turn_id,
        detail,
    })
}

pub fn cancel_turn(request: CancelTurnRequest) -> Result<CancelTurnResult> {
    let cancelled = active_turns()
        .lock()
        .ok()
        .and_then(|active| active.get(&request.turn_id).cloned())
        .map(|flag| {
            flag.store(true, Ordering::Relaxed);
            true
        })
        .unwrap_or(false);
    if !cancelled {
        let store = AiStore::open(request.storage.storage_root.as_deref())?;
        store.update_turn_status(
            &request.session_id,
            &request.turn_id,
            "cancelled",
            "cancelled",
            None,
            None,
        )?;
        let detail = store.read_session_detail(&request.session_id)?;
        emit_store_event(
            &store,
            &request.session_id,
            Some(&request.turn_id),
            "runtime_turn_cancelled",
            json!({
                "turnId": request.turn_id,
                "detail": detail
            }),
        )?;
    }
    Ok(CancelTurnResult {
        session_id: request.session_id,
        turn_id: request.turn_id,
        cancelled,
    })
}

fn spawn_turn_worker(
    storage_root: Option<String>,
    session_id: String,
    turn_id: String,
    profile_id: String,
    model_override: Option<String>,
    workspace_root_override: Option<String>,
    permission_mode: PermissionMode,
    cancel: Arc<AtomicBool>,
) {
    thread::spawn(move || {
        let result = run_turn_worker(
            storage_root.as_deref(),
            &session_id,
            &turn_id,
            &profile_id,
            model_override.as_deref(),
            workspace_root_override.as_deref(),
            permission_mode,
            cancel.clone(),
        );
        if let Err(error) = result {
            if let Ok(store) = AiStore::open(storage_root.as_deref()) {
                let is_cancelled = cancel.load(Ordering::Relaxed);
                let status = if is_cancelled { "cancelled" } else { "failed" };
                let event_type = if is_cancelled {
                    "runtime_turn_cancelled"
                } else {
                    "runtime_error"
                };
                let error_message = error.to_string();
                let _ = store.update_turn_status(
                    &session_id,
                    &turn_id,
                    status,
                    status,
                    if is_cancelled {
                        None
                    } else {
                        Some("MODEL_RUNTIME_FAILED")
                    },
                    if is_cancelled {
                        None
                    } else {
                        Some(error_message.as_str())
                    },
                );
                let detail = store.read_session_detail(&session_id).ok().flatten();
                let _ = emit_store_event(
                    &store,
                    &session_id,
                    Some(&turn_id),
                    event_type,
                    json!({
                        "turnId": turn_id,
                        "message": if is_cancelled { "Turn cancelled".to_string() } else { error_message },
                        "detail": detail
                    }),
                );
            }
        }
        if let Ok(mut active) = active_turns().lock() {
            active.remove(&turn_id);
        }
    });
}

fn run_turn_worker(
    storage_root: Option<&str>,
    session_id: &str,
    turn_id: &str,
    profile_id: &str,
    model_override: Option<&str>,
    workspace_root_override: Option<&str>,
    permission_mode: PermissionMode,
    cancel: Arc<AtomicBool>,
) -> Result<()> {
    let store = AiStore::open(storage_root)?;
    let config = runtime_config_for_profile(&store, profile_id, model_override)?;
    run_turn_worker_inner(
        &store,
        config,
        session_id,
        turn_id,
        workspace_root_override,
        permission_mode,
        cancel,
        invoke_model_buffered,
    )
}

pub(super) fn run_turn_worker_inner(
    store: &AiStore,
    config: ProviderRuntimeConfig,
    session_id: &str,
    turn_id: &str,
    workspace_root_override: Option<&str>,
    permission_mode: PermissionMode,
    cancel: Arc<AtomicBool>,
    mut invoke_model: impl FnMut(
        ProviderRuntimeConfig,
        Vec<ChatMessage>,
        &AtomicBool,
    ) -> Result<ModelResponse>,
) -> Result<()> {
    let detail = store
        .read_session_detail(session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {session_id}"))?;
    let workspace_root = workspace_root_override
        .and_then(trim_to_string)
        .or_else(|| detail.session.project_root.clone());
    let history = detail
        .messages
        .iter()
        .filter(|message| message.role == "user" || message.role == "assistant")
        .map(|message| ChatMessage {
            role: message.role.clone(),
            content: message.content.clone(),
        })
        .collect::<Vec<_>>();
    let turn = detail.turns.iter().find(|turn| turn.id == turn_id);
    let collaboration_mode = turn
        .and_then(|turn| turn.collaboration_mode.as_deref())
        .map(|mode| normalize_collaboration_mode(Some(mode)))
        .unwrap_or_else(|| detail.session.collaboration_mode.clone());
    let project_policy_snapshot = read_project_policy_snapshot(workspace_root.as_deref());
    let denied_approval_summaries = store.read_recent_denied_approval_summaries(session_id, 5)?;
    let mut messages = compose_messages(
        PromptContext {
            collaboration_mode,
            workspace_root: workspace_root.clone(),
            project_policy_snapshot,
            read_only_tools_available: workspace_root.is_some(),
            permission_mode: permission_mode.as_str().to_string(),
            denied_approval_summaries,
        },
        history,
    );
    let mut assistant_text: String;
    let mut final_usage: Option<Usage>;
    let tool_context = ToolExecutionContext {
        workspace_root: workspace_root.clone(),
    };
    let mut inspected_tool_paths = HashSet::<String>::new();
    let mut tool_steps = 0_usize;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(anyhow!("turn cancelled"));
        }
        emit_runtime_state(store, session_id, turn_id, "model_invoking")?;
        let response = invoke_model(config.clone(), messages.clone(), &cancel)?;
        let model_text = response.text.trim().to_string();
        final_usage = response.usage;
        match parse_tool_operation(&model_text) {
            Ok(Some(operation)) => {
                if tool_steps >= MAX_TOOL_STEPS {
                    assistant_text = format!(
                        "I reached the read-only tool step limit ({MAX_TOOL_STEPS}) before producing a final answer. Please narrow the request or ask me to inspect fewer files."
                    );
                    break;
                }
                tool_steps += 1;
                run_tool_operation(
                    store,
                    session_id,
                    turn_id,
                    &tool_context,
                    &operation,
                    permission_mode,
                    &mut messages,
                    &mut inspected_tool_paths,
                )?;
            }
            Ok(None) | Err(_) => {
                assistant_text = model_text;
                break;
            }
        }
    }
    if cancel.load(Ordering::Relaxed) {
        return Err(anyhow!("turn cancelled"));
    }
    if assistant_text.trim().is_empty() {
        assistant_text =
            "I could not produce a final response from the model for this turn.".to_string();
    }
    emit_runtime_state(store, session_id, turn_id, "completion_evaluating")?;
    if let Some(audit) =
        store.evaluate_completion_audit_and_delivery_proof(session_id, Some(turn_id))?
    {
        let detail = store.read_session_detail(session_id)?;
        emit_completion_projection_events(store, session_id, Some(turn_id), detail.as_ref())?;
        if let Some(projected) = detail
            .as_ref()
            .and_then(|detail| delivery_gate_response(&audit, detail.delivery_proof.as_ref()))
        {
            assistant_text = projected;
        }
    }
    let text_event = store.append_event(
        session_id,
        Some(turn_id),
        "model_text_delta",
        json!({ "delta": assistant_text }),
    )?;
    emit_event(&text_event);
    let message_id =
        store.append_or_update_assistant_message(session_id, turn_id, &assistant_text)?;
    let assistant_message = AgentMessage {
        id: message_id,
        session_id: session_id.to_string(),
        turn_id: Some(turn_id.to_string()),
        role: "assistant".to_string(),
        content: assistant_text.clone(),
        content_parts: None,
        display_content: Some(assistant_text),
        created_at: now_ms(),
    };
    store.update_turn_status(session_id, turn_id, "completed", "completed", None, None)?;
    let detail = store.read_session_detail(session_id)?;
    emit_store_event(
        &store,
        session_id,
        Some(turn_id),
        "model_message_end",
        json!({
            "message": assistant_message,
            "usage": final_usage,
            "detail": detail
        }),
    )?;
    emit_store_event(
        &store,
        session_id,
        Some(turn_id),
        "runtime_turn_completed",
        json!({
            "turnId": turn_id,
            "detail": detail
        }),
    )?;
    if let Some(mut session) = store.read_session_index(session_id)? {
        session.updated_at = now_ms();
        store.upsert_session_index(&session)?;
    }
    if let Some(detail) = store.read_session_detail(session_id)? {
        emit_store_event(
            &store,
            session_id,
            None,
            "session_updated",
            json!({ "detail": detail }),
        )?;
    }
    Ok(())
}

fn invoke_model_buffered(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    cancel: &AtomicBool,
) -> Result<ModelResponse> {
    let mut streamed_text = String::new();
    let mut response = generate_response(config, messages, cancel, |delta| {
        streamed_text.push_str(delta);
        Ok(())
    })?;
    if streamed_text.is_empty() == false {
        response.text = streamed_text;
    }
    Ok(response)
}

pub(super) fn run_tool_operation(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    permission_mode: PermissionMode,
    messages: &mut Vec<ChatMessage>,
    inspected_tool_paths: &mut HashSet<String>,
) -> Result<()> {
    emit_tool_event(
        store,
        session_id,
        turn_id,
        "tool_operation_requested",
        json!({
            "operation": tool_operation_payload(operation),
        }),
    )?;
    emit_runtime_state(store, session_id, turn_id, "tool_executing")?;
    emit_tool_event(
        store,
        session_id,
        turn_id,
        "tool_operation_started",
        json!({
            "operation": tool_operation_payload(operation),
        }),
    )?;
    let mut result = if operation.op == ToolFsOp::Run
        && inspected_tool_paths.contains(&normalized_tool_path(&operation.path)) == false
    {
        inspect_required_result(operation)
    } else if operation.op == ToolFsOp::Run
        && normalized_tool_path(&operation.path) == TOOL_FS_APPLY_PATCH
    {
        apply_patch_tool_result(
            store,
            session_id,
            turn_id,
            context,
            operation,
            permission_mode,
        )
    } else if operation.op == ToolFsOp::Run
        && normalized_tool_path(&operation.path) == TOOL_FS_ROLLBACK_PATCH
    {
        rollback_patch_tool_result(
            store,
            session_id,
            turn_id,
            context,
            operation,
            permission_mode,
        )
    } else if operation.op == ToolFsOp::Run
        && normalized_tool_path(&operation.path) == TOOL_SHELL_RUN_COMMAND
    {
        shell::run_command_tool_result(
            store,
            session_id,
            turn_id,
            context,
            operation,
            permission_mode,
        )
    } else {
        execute_tool(context, operation)
    };
    if operation.op == ToolFsOp::Inspect && result.status == ToolResultStatus::Completed {
        inspected_tool_paths.insert(normalized_tool_path(&operation.path));
    }
    let result_blob = store.append_tool_result_blob(
        session_id,
        turn_id,
        &result.op_id,
        &result.path,
        tool_result_status_str(&result.status),
        &result.content,
    )?;
    result.result_ref = Some(result_blob.result_ref.clone());
    enrich_tool_result_metadata(store, session_id, turn_id, &mut result, &result_blob)?;
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
    let detail = store.read_session_detail(session_id)?;
    emit_completion_projection_events(store, session_id, Some(turn_id), detail.as_ref())?;
    messages.push(ChatMessage {
        role: "assistant".to_string(),
        content: serde_json::to_string(operation)?,
    });
    messages.push(ChatMessage {
        role: "user".to_string(),
        content: tool_result_chat_message(&result)?,
    });
    Ok(())
}

fn enrich_tool_result_metadata(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    result: &mut ToolResultEnvelope,
    blob: &ToolResultBlobMeta,
) -> Result<()> {
    if let Some(metadata) = result.metadata.as_mut().and_then(Value::as_object_mut) {
        if metadata.get("kind").and_then(Value::as_str) == Some("command_log") {
            let command = metadata
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or("command");
            let cwd = metadata.get("cwd").and_then(Value::as_str).unwrap_or(".");
            let status = metadata
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or_else(|| {
                    if result.status == ToolResultStatus::Completed {
                        "passed"
                    } else {
                        "failed"
                    }
                });
            let refs = store.append_command_log_artifact_and_evidence(
                session_id,
                turn_id,
                &result.op_id,
                &blob.result_ref,
                status,
                command,
                cwd,
                metadata.get("exitCode").and_then(Value::as_i64),
                metadata
                    .get("outputBytes")
                    .and_then(Value::as_i64)
                    .unwrap_or(blob.content_bytes),
                Value::Object(metadata.clone()),
            )?;
            metadata.insert("artifactId".to_string(), Value::String(refs.artifact_id));
            metadata.insert("evidenceId".to_string(), Value::String(refs.evidence_id));
            metadata.insert(
                "verificationPlanId".to_string(),
                Value::String(refs.verification_plan_id),
            );
            metadata.insert(
                "verificationRunId".to_string(),
                Value::String(refs.verification_run_id),
            );
            return Ok(());
        }
    }
    if result.status != ToolResultStatus::Completed {
        return Ok(());
    }
    let Some(metadata) = result.metadata.as_mut().and_then(Value::as_object_mut) else {
        return Ok(());
    };
    if metadata.get("kind").and_then(Value::as_str) != Some("patch_proposal") {
        return Ok(());
    }
    let changed_files = metadata
        .get("changedFiles")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let title = metadata
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Patch proposal");
    let artifact_metadata = json!({
        "mimeType": "text/x-diff",
        "sizeBytes": blob.content_bytes,
        "contentHash": blob.content_sha256,
        "createdByTool": result.path,
        "redactionApplied": true,
        "sensitive": false,
        "changedFiles": changed_files,
        "approvalPreview": metadata.get("approvalPreview").cloned()
    });
    let refs = store.append_patch_artifact_and_evidence(
        session_id,
        turn_id,
        &result.op_id,
        title,
        &blob.result_ref,
        artifact_metadata,
        changed_files,
    )?;
    metadata.insert(
        "artifactId".to_string(),
        Value::String(refs.artifact_id.clone()),
    );
    metadata.insert("evidenceId".to_string(), Value::String(refs.evidence_id));
    metadata.insert(
        "patchRef".to_string(),
        Value::String(blob.result_ref.clone()),
    );
    Ok(())
}

fn tool_result_status_str(status: &ToolResultStatus) -> &'static str {
    match status {
        ToolResultStatus::Completed => "completed",
        ToolResultStatus::Failed => "failed",
    }
}
