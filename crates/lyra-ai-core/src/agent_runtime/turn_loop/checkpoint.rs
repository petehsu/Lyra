use super::*;

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
        request
            .options
            .permission_mode
            .as_deref()
            .or(session.permission_mode.as_deref()),
        request.options.approval_policy.as_deref(),
    );
    let execution_target = normalize_execution_target(
        request
            .options
            .execution_target
            .as_deref()
            .or(session.execution_target.as_deref()),
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
    let turn = AgentTurn {
        id: turn_id.clone(),
        session_id: session.id.clone(),
        profile_id: profile_id.clone(),
        status: "running".to_string(),
        collaboration_mode: Some(normalize_collaboration_mode(
            request.options.collaboration_mode.as_deref(),
        )),
        permission_mode: permission_mode.as_str().to_string(),
        execution_target: execution_target.as_str().to_string(),
        error_code: None,
        error_message: None,
        usage: None,
        created_at: now,
        updated_at: now,
    };
    let loaded_policy = crate::project_policy::load_for_turn(
        &store,
        &session.id,
        &turn_id,
        session.project_root.as_deref(),
    )?;
    store.insert_turn(
        &turn,
        &user_message_id,
        Some(loaded_policy.snapshot_id.as_str()),
    )?;
    emit_store_event(
        &store,
        &session.id,
        Some(&turn_id),
        if loaded_policy.status == "fallback_safe_default" {
            "project_policy_snapshot_failed_safe_default"
        } else {
            "project_policy_snapshot_created"
        },
        json!({
            "sessionId": session.id,
            "turnId": turn_id,
            "snapshotId": loaded_policy.snapshot_id,
            "source": loaded_policy.source,
            "status": loaded_policy.status,
            "warnings": loaded_policy.effective_policy.warnings,
        }),
    )?;
    let checkpoint_id =
        store.create_timeline_checkpoint(&session.id, &turn_id, &user_message_id)?;
    let rollback_anchor = ensure_recovery_checkpoint_for_turn(
        &store,
        &session,
        &turn_id,
        &user_message_id,
        &checkpoint_id,
    )?;
    if request.options.follow_enabled.unwrap_or(false) {
        ensure_follow_for_turn(&store, &session.id, &turn_id, &user_message_id)?;
    }
    let runtime_options_payload = json!({
        "model": request.options.model.as_deref().or(session.model_id.as_deref()),
        "modelProvider": request.options.model_provider.as_deref(),
        "effort": request.options.effort.as_deref(),
        "verbosity": request.options.verbosity.as_deref(),
        "approvalPolicy": request.options.approval_policy.as_deref(),
        "permissionMode": permission_mode.as_str(),
        "executionTarget": execution_target.as_str()
    });
    let intake = prepare_runtime_intake(
        &store,
        &session,
        &turn_id,
        &user_message_id,
        &request.input,
        &request.options,
        Some(loaded_policy.snapshot_id.as_str()),
        Some(&loaded_policy.effective_policy),
    )?;
    if intake.hard_blocked {
        store.update_turn_status(
            &session.id,
            &turn_id,
            "paused",
            "clarification_required",
            None,
            None,
        )?;
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
                "policySnapshot": {
                    "snapshotId": loaded_policy.snapshot_id,
                    "source": loaded_policy.source,
                    "status": loaded_policy.status,
                },
                "checkpointId": checkpoint_id,
                "rollbackAnchorId": rollback_anchor.anchor_id,
                "runtimeOptions": runtime_options_payload.clone()
            }),
        )?;
        if let Some(detail) = store.read_session_detail(&session.id)? {
            delivery::emit_security_summary_updated(&store, &session.id, &turn_id, Some(&detail))?;
            emit_store_event(
                &store,
                &session.id,
                Some(&turn_id),
                "session_updated",
                json!({ "detail": detail }),
            )?;
        }
        let detail = store
            .read_session_detail(&updated_session.id)?
            .ok_or_else(|| anyhow!("AI session not found: {}", updated_session.id))?;
        return Ok(SendTurnResult {
            session_id: updated_session.id,
            turn_id,
            detail,
        });
    }
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
        create_mini_run_after_todo(
            &store,
            &session.id,
            &turn_id,
            &user_message_id,
            &text,
            &checkpoint_id,
            &refs,
        )?;
    }
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
            "policySnapshot": {
                "snapshotId": loaded_policy.snapshot_id,
                "source": loaded_policy.source,
                "status": loaded_policy.status,
            },
            "checkpointId": checkpoint_id,
            "rollbackAnchorId": rollback_anchor.anchor_id,
            "runtimeOptions": runtime_options_payload
        }),
    )?;
    if let Some(detail) = store.read_session_detail(&updated_session.id)? {
        delivery::emit_security_summary_updated(
            &store,
            &updated_session.id,
            &turn_id,
            Some(&detail),
        )?;
        emit_store_event(
            &store,
            &updated_session.id,
            None,
            "session_updated",
            json!({ "detail": detail }),
        )?;
    }

    super::worker::spawn_turn_worker(
        storage_root,
        updated_session.id.clone(),
        turn_id.clone(),
        profile_id,
        request
            .options
            .model
            .clone()
            .or_else(|| updated_session.model_id.clone()),
        request.options.cwd.clone(),
        permission_mode,
        execution_target,
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
