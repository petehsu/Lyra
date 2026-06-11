use super::*;
pub(crate) fn needs_user_action_object(value: &Value) -> Option<&serde_json::Map<String, Value>> {
    value.get("needsUserAction").and_then(Value::as_object)
}

pub(crate) fn user_action_string<'a>(
    action: &'a serde_json::Map<String, Value>,
    key: &str,
) -> Option<&'a str> {
    action
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
}

pub(crate) fn user_action_tab_id(
    input: &Value,
    value: &Value,
    action: &serde_json::Map<String, Value>,
) -> String {
    user_action_string(action, "tabId")
        .or_else(|| value.get("tabId").and_then(Value::as_str))
        .or_else(|| input.get("tabId").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string()
}

pub(crate) fn wait_for_automatic_user_action(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    question: &str,
    options: Vec<Value>,
    detail: Option<String>,
) -> AgentRuntimeResult<ClarificationRequest> {
    wait_for_clarification(ClarificationRequest {
        id: format!("clarification-{}", Uuid::new_v4()),
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        tool_call_id: tool_call_id.to_string(),
        question: question.to_string(),
        options,
        allow_custom_answer: false,
        detail,
        status: "pending".to_string(),
        answer: None,
        selected_option: None,
        created_at: now(),
        responded_at: None,
    })
}

pub(crate) fn selected_answer_label(request: &ClarificationRequest) -> String {
    request
        .selected_option
        .clone()
        .or_else(|| request.answer.clone())
        .unwrap_or_default()
}

pub(crate) fn shared_control_decision(label: &str) -> &'static str {
    match label {
        "Continue Agent" => "continue_agent",
        "Use Isolated" => "use_isolated",
        "Cancel Task" => "cancel_task",
        _ => "user_takeover",
    }
}

pub(crate) fn permission_for_automatic_elevation(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    tab_id: &str,
    reason: &str,
) -> Result<Value, String> {
    let input = json!({
        "tabId": tab_id,
        "targetMode": "isolated",
        "reason": reason,
        "permissionRequired": true,
        "permissionRisk": "dangerous",
    });
    let Some(permission) = permission_request_for_tool(
        session_id,
        turn_id,
        tool_call_id,
        "lyra_lumen",
        "elevate",
        &input,
    ) else {
        return Ok(auto_approval_policy_decision(
            "lyra_lumen",
            "elevate",
            &input,
        ));
    };
    let permission_record = permission.clone();
    wait_for_permission(permission)
        .map(|allowed| {
            policy_decision_from_permission(
                &permission_record,
                if allowed { "approved" } else { "denied" },
            )
        })
        .map_err(|error| error.to_string())
}

pub(crate) fn invoke_optional_host(
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
    method: &str,
    payload: Value,
) -> Value {
    match dispatcher {
        Some(dispatcher) => match invoke_host_capability(dispatcher, method, payload) {
            Ok(value) => value,
            Err(error) => json!({
                "ok": false,
                "error": {
                    "code": "host_capability_failed",
                    "message": error,
                }
            }),
        },
        None => json!({
            "ok": false,
            "error": {
                "code": "host_capability_unavailable",
                "message": "Lyra host capability bridge is not available.",
            }
        }),
    }
}

pub(crate) fn resolve_shared_control_user_action(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
    value: &Value,
    action: &serde_json::Map<String, Value>,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Value {
    let tab_id = user_action_tab_id(input, value, action);
    let request = wait_for_automatic_user_action(
        session_id,
        turn_id,
        tool_call_id,
        "The user interrupted Lyra Agent control of the live browser tab. Who should control it now?",
        vec![
            json!({ "label": "Continue Agent", "description": "Resume Lyra Agent control from the latest browser recovery anchor." }),
            json!({ "label": "Take Over", "description": "Leave the visible tab under user control until the user explicitly authorizes Agent again." }),
            json!({ "label": "Use Isolated", "description": "Stop using the live tab and continue with isolated background browser state." }),
            json!({ "label": "Cancel Task", "description": "Cancel this browser task." }),
        ],
        Some("ControlHandoffEvent was emitted by live browser input arbitration.".to_string()),
    );
    match request {
        Ok(request) => {
            let label = selected_answer_label(&request);
            let decision = shared_control_decision(&label);
            let control_resolution = invoke_optional_host(
                dispatcher,
                "lyraLumen.resolveControlHandoff",
                json!({
                    "tabId": tab_id,
                    "targetMode": "live",
                    "decision": decision,
                }),
            );
            json!({
                "kind": "shared_control_decision",
                "clarificationId": request.id,
                "answer": request.answer,
                "selectedOption": request.selected_option,
                "decision": decision,
                "controlResolution": control_resolution,
            })
        }
        Err(error) => json!({
            "kind": "shared_control_decision_failed",
            "error": {
                "code": "clarification_failed",
                "message": error.to_string(),
            }
        }),
    }
}

pub(crate) fn resolve_auth_challenge_user_action(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
    value: &Value,
    action: &serde_json::Map<String, Value>,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Value {
    let tab_id = user_action_tab_id(input, value, action);
    let reason = user_action_string(action, "reason").unwrap_or("auth_challenge");
    let request = wait_for_automatic_user_action(
        session_id,
        turn_id,
        tool_call_id,
        "The isolated browser hit an authentication or verification challenge that requires user action.",
        vec![
            json!({ "label": "Open Visible Tab", "description": "Elevate this isolated browser task to a visible tab so the user can complete the challenge." }),
            json!({ "label": "Already Completed", "description": "The user already completed the challenge; verify and continue." }),
            json!({ "label": "Cancel Task", "description": "Cancel this browser task." }),
        ],
        Some(format!("AuthChallengeSignal: {reason}")),
    );
    let request = match request {
        Ok(request) => request,
        Err(error) => {
            return json!({
                "kind": "auth_challenge_resolution_failed",
                "error": {
                    "code": "clarification_failed",
                    "message": error.to_string(),
                }
            });
        }
    };
    let label = selected_answer_label(&request);
    if label == "Cancel Task" {
        return json!({
            "kind": "auth_challenge_resolution",
            "clarificationId": request.id,
            "answer": request.answer,
            "selectedOption": request.selected_option,
            "decision": "cancel_task",
        });
    }

    let mut elevation = Value::Null;
    let mut elevation_policy_decision = None;
    if label == "Open Visible Tab" {
        match permission_for_automatic_elevation(session_id, turn_id, tool_call_id, &tab_id, reason)
        {
            Ok(policy_decision)
                if policy_decision
                    .get("outcome")
                    .and_then(Value::as_str)
                    .is_some_and(|outcome| outcome == "approved") =>
            {
                elevation_policy_decision = Some(policy_decision);
                elevation = invoke_optional_host(
                    dispatcher,
                    "lyraLumen.elevate",
                    json!({
                        "tabId": tab_id,
                        "targetMode": "isolated",
                        "reason": reason,
                    }),
                );
            }
            Ok(policy_decision) => {
                return json!({
                    "kind": "auth_challenge_resolution",
                    "clarificationId": request.id,
                    "answer": request.answer,
                    "selectedOption": request.selected_option,
                    "decision": "permission_denied",
                    "policyDecision": policy_decision,
                });
            }
            Err(error) => {
                return json!({
                    "kind": "auth_challenge_resolution_failed",
                    "clarificationId": request.id,
                    "error": {
                        "code": "permission_failed",
                        "message": error,
                    }
                });
            }
        }
        let completion_request = wait_for_automatic_user_action(
            session_id,
            turn_id,
            tool_call_id,
            "Complete the browser challenge in the visible tab, then confirm Lyra can verify and continue.",
            vec![
                json!({ "label": "Done", "description": "Verify that the challenge is gone and continue in isolated mode." }),
                json!({ "label": "Cancel Task", "description": "Cancel this browser task." }),
            ],
            Some("Lyra will not solve CAPTCHA or MFA itself; it only resumes after user confirmation.".to_string()),
        );
        if let Ok(done) = completion_request {
            if selected_answer_label(&done) == "Cancel Task" {
                return json!({
                    "kind": "auth_challenge_resolution",
                    "clarificationId": done.id,
                    "answer": done.answer,
                    "selectedOption": done.selected_option,
                    "decision": "cancel_task",
                    "elevation": elevation,
                });
            }
        }
    }

    let live_tab_id = elevation
        .get("liveTabId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let elevation_session_id = elevation
        .pointer("/elevationSession/sessionId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let verification = invoke_optional_host(
        dispatcher,
        "lyraLumen.completeElevation",
        json!({
            "tabId": tab_id,
            "targetMode": "isolated",
            "liveTabId": live_tab_id,
            "elevationSessionId": elevation_session_id,
        }),
    );
    json!({
        "kind": "auth_challenge_resolution",
        "clarificationId": request.id,
        "answer": request.answer,
        "selectedOption": request.selected_option,
        "decision": if label == "Already Completed" { "verify" } else { "elevate_and_verify" },
        "elevation": elevation,
        "policyDecision": elevation_policy_decision,
        "verification": verification,
    })
}

pub(crate) fn resolve_host_needs_user_action(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    _display_name: &str,
    _tool_action: &str,
    input: &Value,
    value: &Value,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Option<Value> {
    let action = needs_user_action_object(value)?;
    let kind = user_action_string(action, "kind").unwrap_or("user_action");
    Some(match kind {
        "shared_control_interrupted" => resolve_shared_control_user_action(
            session_id,
            turn_id,
            tool_call_id,
            input,
            value,
            action,
            dispatcher,
        ),
        "auth_challenge" => resolve_auth_challenge_user_action(
            session_id,
            turn_id,
            tool_call_id,
            input,
            value,
            action,
            dispatcher,
        ),
        _ => json!({
            "kind": "user_action_unhandled",
            "needsUserActionKind": kind,
        }),
    })
}

pub(crate) fn format_user_action_resolution(resolution: &Value) -> String {
    let kind = resolution
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("user_action_resolution");
    let decision = resolution
        .get("decision")
        .and_then(Value::as_str)
        .unwrap_or("recorded");
    format!("User action resolution: {kind} ({decision}).")
}
