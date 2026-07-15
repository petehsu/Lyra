use super::*;

pub(crate) fn wait_for_clarification(
    request: ClarificationRequest,
) -> AgentRuntimeResult<ClarificationRequest> {
    let mut request = request;
    let request_id = request.id.clone();
    let turn_id = request.turn_id.clone();
    let (callback, events, session_id) = {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let callback = state.event_callback.clone();
        // Oma workers run in short-lived execution sessions. Interactive
        // requests must target the durable parent session, which is the one
        // the desktop UI subscribes to and the user can answer against.
        let oma_source = state
            .sessions
            .get(&request.session_id)
            .and_then(|session| oma_interaction_source(&session.snapshot));
        let session_id = state
            .sessions
            .get(&request.session_id)
            .and_then(|session| oma_parent_session_id(&session.snapshot))
            .filter(|parent_session_id| state.sessions.contains_key(parent_session_id))
            .unwrap_or_else(|| request.session_id.clone());
        request.session_id = session_id.clone();
        if let Some(session) = state.sessions.get_mut(&session_id) {
            set_runtime_turn_state(
                session,
                &turn_id,
                "waiting_for_user",
                Some("clarification_request"),
            );
            session.snapshot["turnStatus"] = Value::String("running".to_string());
            session.snapshot["activeTurnId"] = Value::String(turn_id.clone());
            session.snapshot["follow"] = json!({ "running": true, "activity": "Waiting for user" });
            touch_session(session);
        }
        state
            .pending_clarifications
            .insert(request_id.clone(), request.clone());
        let snapshot = state
            .sessions
            .get(&session_id)
            .map(|session| session.snapshot.clone());
        state.save_state()?;
        let mut events = vec![
            json!({
                "kind": "clarificationRequested",
                "sessionId": session_id,
                "clarificationId": request_id,
                "question": request.question,
                "i18nKey": request.i18n_key,
                "options": request.options,
                "allowCustomAnswer": request.allow_custom_answer,
                "detail": request.detail,
                "detailI18nKey": request.detail_i18n_key,
                "toolCallId": request.tool_call_id,
                "turnId": turn_id,
                "omaSource": oma_source,
            }),
            json!({
                "kind": "turnStateChanged",
                "sessionId": session_id,
                "turnId": turn_id,
                "state": "waiting_for_user",
                "reason": "clarification_request",
            }),
        ];
        if let Some(snapshot) = snapshot {
            events.push(json!({ "kind": "sessionSnapshot", "snapshot": snapshot }));
        }
        (callback, events, session_id)
    };
    for event in events {
        emit_with_callback(&callback, event);
    }

    for _ in 0..24_000 {
        if turn_was_cancelled(&session_id, &turn_id) {
            return Err(AgentRuntimeError::Cancelled);
        }
        if let Ok(mut state) = state().lock()
            && let Some(request) = state
                .pending_clarifications
                .get(&request_id)
                .filter(|request| request.answer.is_some())
                .cloned()
        {
            state.pending_clarifications.remove(&request_id);
            state.save_state()?;
            return Ok(request);
        }
        thread::sleep(Duration::from_millis(25));
    }
    Err(AgentRuntimeError::Core(
        "clarification request timed out".to_string(),
    ))
}

pub(crate) fn respond_clarification(payload: Value) -> AgentRuntimeResult<Value> {
    let session_id = required_session_id(&payload)?;
    let clarification_id = string_opt(&payload, "clarificationId")
        .ok_or_else(|| AgentRuntimeError::Core("clarificationId is required".to_string()))?;
    let answer = string_opt(&payload, "answer")
        .ok_or_else(|| AgentRuntimeError::Core("answer is required".to_string()))?;
    let selected_option = string_opt(&payload, "selectedOption");
    let (callback, events, response) = {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let callback = state.event_callback.clone();
        let request = state
            .pending_clarifications
            .get_mut(&clarification_id)
            .filter(|request| request.session_id == session_id)
            .ok_or_else(|| {
                AgentRuntimeError::Core(format!(
                    "clarification request not found: {clarification_id}"
                ))
            })?;
        request.answer = Some(answer.clone());
        request.selected_option = selected_option.clone();
        request.status = "answered".to_string();
        request.responded_at = Some(now());
        let turn_id = request.turn_id.clone();
        if let Some(session) = state.sessions.get_mut(&session_id) {
            set_runtime_turn_state(
                session,
                &turn_id,
                "waiting_for_tool",
                Some("clarification_response"),
            );
            session.snapshot["turnStatus"] = Value::String("running".to_string());
            session.snapshot["activeTurnId"] = Value::String(turn_id.clone());
            session.snapshot["follow"] =
                json!({ "running": true, "activity": "Clarification answered" });
            touch_session(session);
        }
        let snapshot = state
            .sessions
            .get(&session_id)
            .map(|session| session.snapshot.clone());
        state.save_state()?;
        let mut events = vec![
            json!({
                "kind": "clarificationResolved",
                "sessionId": session_id,
                "clarificationId": clarification_id
            }),
            json!({
                "kind": "turnStateChanged",
                "sessionId": session_id,
                "turnId": turn_id,
                "state": "waiting_for_tool",
                "reason": "clarification_answered",
            }),
        ];
        if let Some(snapshot) = snapshot {
            events.push(json!({ "kind": "sessionSnapshot", "snapshot": snapshot }));
        }
        let response = json!({
            "sessionId": session_id,
            "clarificationId": clarification_id,
            "turnId": turn_id,
            "answer": answer,
            "selectedOption": selected_option,
            "status": "resumed",
        });
        (callback, events, response)
    };
    for event in events {
        emit_with_callback(&callback, event);
    }
    Ok(response)
}
