use super::*;

pub(crate) fn permission_request_for_tool(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    display_name: &str,
    action: &str,
    input: &Value,
) -> Option<PermissionRequest> {
    let risk = permission_risk(display_name, action, input)?;
    let summary = permission_summary(display_name, action, input);
    let title = match risk.as_str() {
        "shell" => "Run shell command",
        "file" => "Modify workspace files",
        "network" => "Use network or browser action",
        "sensitive" => "Use browser login state",
        _ => "Use high-risk Lyra capability",
    }
    .to_string();
    let why = if risk == "sensitive" {
        "The requested browser action would use the user's existing Lyra browser login state in an isolated background page."
    } else {
        "The requested tool can change external state or perform a high-risk action."
    };
    Some(PermissionRequest {
        id: format!("permission-{}", Uuid::new_v4()),
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        tool_call_id: tool_call_id.to_string(),
        action: action.to_string(),
        risk,
        summary: summary.clone(),
        why: why.to_string(),
        title,
        detail: summary,
        status: "pending".to_string(),
        allowed: None,
        created_at: now(),
        responded_at: None,
    })
}

fn requests_live_login_state(input: &Value) -> bool {
    input
        .get("useLiveLoginState")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || input
            .get("authState")
            .and_then(Value::as_str)
            .is_some_and(|value| value == "borrowLiveLogin")
}

pub(crate) fn permission_risk(display_name: &str, action: &str, input: &Value) -> Option<String> {
    if matches!(display_name, "lyra_lumen") && requests_live_login_state(input) {
        return Some("sensitive".to_string());
    }
    if input
        .get("permissionRequired")
        .or_else(|| input.get("requiresPermission"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Some(
            input
                .get("permissionRisk")
                .and_then(Value::as_str)
                .unwrap_or("dangerous")
                .to_string(),
        );
    }
    if matches!((display_name, action), ("terminal", "create"))
        && input
            .get("command")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
    {
        return Some("shell".to_string());
    }
    if matches!(
        (display_name, action),
        ("file", "read")
            | ("file", "list")
            | ("file", "glob")
            | ("search", "project")
            | ("code", "search_text")
            | ("code", "search_symbol")
            | ("code", "graph_expand")
            | ("lsp", "query")
            | ("todo", "read")
            | ("terminal", "list")
            | ("terminal", "read")
            | ("terminal", "wait")
            | ("terminal", "create")
            | ("workbench", "list_tabs")
            | ("workbench", "read_workspace")
            | ("workbench", "read_tab")
            | ("software", "list_capabilities")
            | ("software", "inspect_capability")
            | ("software", "read_state")
            | ("lyra_lumen", "map")
            | ("lyra_lumen", "read")
            | ("lyra_lumen", "see")
            | ("lyra_lumen", "wait")
            | ("lyra_lumen", "read_until")
            | ("lyra_lumen", "reveal")
            | ("lyra_lumen", "focus_scan")
            | ("lyra_lumen", "follow_audit")
            | ("lyra_lumen", "explain_target")
            | ("lyra_lumen", "audit")
    ) {
        return None;
    }
    let text = format!("{display_name} {action} {input}").to_lowercase();
    if text.contains("shell")
        || text.contains("terminal")
        || text.contains("command")
        || text.contains("exec")
    {
        return Some("shell".to_string());
    }
    if text.contains("write")
        || text.contains("delete")
        || text.contains("patch")
        || text.contains("edit")
        || text.contains("file")
    {
        return Some("file".to_string());
    }
    if matches!(
        (display_name, action),
        ("software", "invoke_capability")
            | ("lyra_lumen", "act")
            | ("lyra_lumen", "type")
            | ("lyra_lumen", "press")
            | ("lyra_lumen", "submit")
            | ("lyra_lumen", "navigate")
            | ("lyra_lumen", "elevate")
    ) {
        return Some(if action == "navigate" {
            "network".to_string()
        } else {
            "dangerous".to_string()
        });
    }
    None
}

pub(crate) fn permission_summary(display_name: &str, action: &str, input: &Value) -> String {
    let mut detail = format!("{display_name}.{action}");
    for key in [
        "path",
        "filePath",
        "command",
        "url",
        "softwareId",
        "capabilityId",
        "actionId",
        "tabId",
        "targetMode",
        "authState",
        "sessionId",
        "terminalTabId",
        "paneId",
        "target",
        "text",
    ] {
        if let Some(value) = input.get(key).and_then(Value::as_str)
            && !value.trim().is_empty()
        {
            detail.push_str(&format!(" {key}={value}"));
        }
    }
    detail
}

pub(crate) fn wait_for_permission(request: PermissionRequest) -> AgentRuntimeResult<bool> {
    let request_id = request.id.clone();
    let session_id = request.session_id.clone();
    let turn_id = request.turn_id.clone();
    let (callback, events) = {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let callback = state.event_callback.clone();
        if let Some(session) = state.sessions.get_mut(&session_id) {
            set_runtime_turn_state(
                session,
                &turn_id,
                "waiting_for_permission",
                Some("permission_request"),
            );
            session.snapshot["turnStatus"] = Value::String("running".to_string());
            session.snapshot["activeTurnId"] = Value::String(turn_id.clone());
            session.snapshot["follow"] =
                json!({ "running": true, "activity": "Waiting for permission" });
            touch_session(session);
        }
        state
            .pending_permissions
            .insert(request_id.clone(), request.clone());
        let snapshot = state
            .sessions
            .get(&session_id)
            .map(|session| session.snapshot.clone());
        state.save_state()?;
        let mut events = vec![
            json!({
                "kind": "permissionRequested",
                "sessionId": session_id,
                "permissionId": request_id,
                "title": request.title,
                "detail": request.detail,
                "action": request.action,
                "risk": request.risk,
                "summary": request.summary,
                "why": request.why,
                "toolCallId": request.tool_call_id,
                "turnId": turn_id,
            }),
            json!({
                "kind": "turnStateChanged",
                "sessionId": session_id,
                "turnId": turn_id,
                "state": "waiting_for_permission",
                "reason": "permission_request",
            }),
        ];
        if let Some(snapshot) = snapshot {
            events.push(json!({ "kind": "sessionSnapshot", "snapshot": snapshot }));
        }
        (callback, events)
    };
    for event in events {
        emit_with_callback(&callback, event);
    }

    wait_for_permission_decision(&session_id, &turn_id, &request_id)
}

pub(crate) fn wait_for_permission_decision(
    session_id: &str,
    turn_id: &str,
    request_id: &str,
) -> AgentRuntimeResult<bool> {
    for _ in 0..24_000 {
        if turn_was_cancelled(session_id, turn_id) {
            return Err(AgentRuntimeError::Core("turn cancelled".to_string()));
        }
        if let Ok(mut state) = state().lock()
            && let Some(allowed) = state
                .pending_permissions
                .get(request_id)
                .and_then(|request| request.allowed)
        {
            state.pending_permissions.remove(request_id);
            state.save_state()?;
            return Ok(allowed);
        }
        thread::sleep(Duration::from_millis(25));
    }
    Err(AgentRuntimeError::Core(
        "permission request timed out".to_string(),
    ))
}

pub(crate) fn respond_permission(payload: Value) -> AgentRuntimeResult<Value> {
    let session_id = required_session_id(&payload)?;
    let permission_id = string_opt(&payload, "permissionId")
        .ok_or_else(|| AgentRuntimeError::Core("permissionId is required".to_string()))?;
    let allowed = payload
        .get("allowed")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let (callback, events, response) = {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let callback = state.event_callback.clone();
        let request = state
            .pending_permissions
            .get_mut(&permission_id)
            .filter(|request| request.session_id == session_id)
            .ok_or_else(|| {
                AgentRuntimeError::Core(format!("permission request not found: {permission_id}"))
            })?;
        request.allowed = Some(allowed);
        request.status = if allowed { "allowed" } else { "denied" }.to_string();
        request.responded_at = Some(now());
        let turn_id = request.turn_id.clone();
        let tool_call_id = request.tool_call_id.clone();
        if let Some(session) = state.sessions.get_mut(&session_id) {
            set_runtime_turn_state(
                session,
                &turn_id,
                "waiting_for_tool",
                Some("permission_response"),
            );
            session.snapshot["turnStatus"] = Value::String("running".to_string());
            session.snapshot["activeTurnId"] = Value::String(turn_id.clone());
            session.snapshot["follow"] = json!({
                "running": true,
                "activity": if allowed { "Permission approved" } else { "Permission denied" }
            });
            touch_session(session);
        }
        let snapshot = state
            .sessions
            .get(&session_id)
            .map(|session| session.snapshot.clone());
        state.save_state()?;
        let mut events = vec![json!({
            "kind": "turnStateChanged",
            "sessionId": session_id,
            "turnId": turn_id,
            "state": "waiting_for_tool",
            "reason": if allowed { "permission_allowed" } else { "permission_denied" },
        })];
        if let Some(snapshot) = snapshot {
            events.push(json!({ "kind": "sessionSnapshot", "snapshot": snapshot }));
        }
        let response = json!({
            "sessionId": session_id,
            "permissionId": permission_id,
            "toolCallId": tool_call_id,
            "turnId": turn_id,
            "allowed": allowed,
            "status": if allowed { "resumed" } else { "denied" },
        });
        (callback, events, response)
    };
    for event in events {
        emit_with_callback(&callback, event);
    }
    Ok(response)
}
