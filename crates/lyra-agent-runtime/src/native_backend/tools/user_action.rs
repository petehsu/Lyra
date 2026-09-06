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

fn user_action_target_mode(
    input: &Value,
    value: &Value,
    action: &serde_json::Map<String, Value>,
) -> String {
    user_action_string(action, "targetMode")
        .or_else(|| value.get("targetMode").and_then(Value::as_str))
        .or_else(|| input.get("targetMode").and_then(Value::as_str))
        .unwrap_or("isolated")
        .to_string()
}

pub(crate) async fn wait_for_automatic_user_action(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    question: &str,
    question_i18n_key: &str,
    options: Vec<Value>,
    detail: Option<String>,
    detail_i18n_key: Option<&str>,
) -> AgentRuntimeResult<ClarificationRequest> {
    wait_for_clarification_async(ClarificationRequest {
        id: format!("clarification-{}", Uuid::new_v4()),
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        tool_call_id: tool_call_id.to_string(),
        question: question.to_string(),
        i18n_key: Some(question_i18n_key.to_string()),
        options,
        allow_custom_answer: false,
        detail,
        detail_i18n_key: detail_i18n_key.map(str::to_string),
        status: "pending".to_string(),
        answer: None,
        selected_option: None,
        created_at: now(),
        responded_at: None,
    })
    .await
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
        "continue_agent" | "Continue Agent" => "continue_agent",
        "use_isolated" | "Use Isolated" => "use_isolated",
        "cancel_task" | "Cancel Task" => "cancel_task",
        _ => "user_takeover",
    }
}

async fn shared_control_clarification(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
) -> AgentRuntimeResult<ClarificationRequest> {
    wait_for_clarification_async(ClarificationRequest {
        id: format!("clarification-{}", Uuid::new_v4()),
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        tool_call_id: tool_call_id.to_string(),
        question: "The user interrupted Lyra Agent control of the live browser tab. Who should control it now?".to_string(),
        i18n_key: Some("decision.sharedControl.question".to_string()),
        options: vec![
            json!({ "value": "continue_agent", "label": "Continue Agent", "i18nKey": "decision.sharedControl.continueAgent", "description": "Resume Lyra Agent control from the latest browser recovery anchor.", "descriptionI18nKey": "decision.sharedControl.continueAgent.description" }),
            json!({ "value": "user_takeover", "label": "Take Over", "i18nKey": "decision.sharedControl.takeOver", "description": "Leave the visible tab under user control until the user explicitly authorizes Agent again.", "descriptionI18nKey": "decision.sharedControl.takeOver.description" }),
            json!({ "value": "use_isolated", "label": "Use Isolated", "i18nKey": "decision.sharedControl.useIsolated", "description": "Stop using the live tab and continue with isolated background browser state.", "descriptionI18nKey": "decision.sharedControl.useIsolated.description" }),
            json!({ "value": "cancel_task", "label": "Cancel Task", "i18nKey": "decision.sharedControl.cancelTask", "description": "Cancel this browser task.", "descriptionI18nKey": "decision.sharedControl.cancelTask.description" }),
        ],
        allow_custom_answer: false,
        detail: Some("ControlHandoffEvent was emitted by live browser input arbitration.".to_string()),
        detail_i18n_key: Some("decision.sharedControl.detail".to_string()),
        status: "pending".to_string(),
        answer: None,
        selected_option: None,
        created_at: now(),
        responded_at: None,
    })
    .await
}

pub(crate) async fn permission_for_automatic_elevation(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    cancellation: &CancellationToken,
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
    wait_for_permission_with_cancellation_async(permission, cancellation)
        .await
        .map(|allowed| {
            policy_decision_from_permission(
                &permission_record,
                if allowed { "approved" } else { "denied" },
            )
        })
        .map_err(|error| error.to_string())
}

pub(crate) async fn invoke_optional_host(
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
    method: &str,
    payload: Value,
) -> Value {
    match dispatcher {
        Some(dispatcher) => match invoke_host_capability_with_timeout_async(
            dispatcher.clone(),
            method.to_string(),
            payload,
            DEFAULT_HOST_TOOL_TIMEOUT_MS,
        )
        .await
        {
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

pub(crate) async fn resolve_shared_control_user_action(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
    value: &Value,
    action: &serde_json::Map<String, Value>,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Value {
    let tab_id = user_action_tab_id(input, value, action);
    let request = shared_control_clarification(session_id, turn_id, tool_call_id).await;
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
            )
            .await;
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

pub(crate) async fn resolve_auth_challenge_user_action(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    cancellation: &CancellationToken,
    input: &Value,
    value: &Value,
    action: &serde_json::Map<String, Value>,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Value {
    let tab_id = user_action_tab_id(input, value, action);
    let target_mode = user_action_target_mode(input, value, action);
    let reason = user_action_string(action, "reason").unwrap_or("auth_challenge");
    let is_live = target_mode == "live";
    let request = wait_for_automatic_user_action(
        session_id,
        turn_id,
        tool_call_id,
        if is_live {
            "The visible browser page hit an authentication or verification challenge that may require user action."
        } else {
            "The isolated browser hit an authentication or verification challenge that requires user action."
        },
        if is_live {
            "decision.auth.visible.question"
        } else {
            "decision.auth.isolated.question"
        },
        if is_live {
            vec![
                json!({ "value": "resume_authentication", "label": "Resume after authentication", "i18nKey": "decision.auth.resume", "description": "Verify the visible page and continue automatically.", "descriptionI18nKey": "decision.auth.resume.description" }),
                json!({ "value": "cancel_task", "label": "Cancel Task", "i18nKey": "decision.auth.cancelTask", "description": "Cancel this browser task.", "descriptionI18nKey": "decision.auth.cancelTask.description" }),
            ]
        } else {
            vec![
                json!({ "value": "open_visible_tab", "label": "Open Visible Tab", "i18nKey": "decision.auth.openVisible", "description": "Open a visible tab for the identity step, then continue automatically.", "descriptionI18nKey": "decision.auth.openVisible.description" }),
                json!({ "value": "resume_authentication", "label": "Resume after authentication", "i18nKey": "decision.auth.resume", "description": "Verify the page and continue automatically.", "descriptionI18nKey": "decision.auth.resume.description" }),
                json!({ "value": "cancel_task", "label": "Cancel Task", "i18nKey": "decision.auth.cancelTask", "description": "Cancel this browser task.", "descriptionI18nKey": "decision.auth.cancelTask.description" }),
            ]
        },
        Some(format!("AuthChallengeSignal: {reason}")),
        Some("decision.auth.detail"),
    )
    .await;
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
    if label == "cancel_task" || label == "Cancel Task" {
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
    if label == "open_visible_tab" || label == "Open Visible Tab" {
        match permission_for_automatic_elevation(
            session_id,
            turn_id,
            tool_call_id,
            cancellation,
            &tab_id,
            reason,
        )
        .await
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
                )
                .await;
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
            "decision.auth.complete.question",
            vec![
                json!({ "value": "resume_authentication", "label": "Resume after authentication", "i18nKey": "decision.auth.resume", "description": "Verify that the challenge is gone and continue.", "descriptionI18nKey": "decision.auth.resume.description" }),
                json!({ "value": "cancel_task", "label": "Cancel Task", "i18nKey": "decision.auth.cancelTask", "description": "Cancel this browser task.", "descriptionI18nKey": "decision.auth.cancelTask.description" }),
            ],
            Some("Lyra will not solve CAPTCHA or MFA itself; it only resumes after user confirmation.".to_string()),
            Some("decision.auth.userBoundary.detail"),
        )
        .await;
        if let Ok(done) = completion_request {
            if matches!(
                selected_answer_label(&done).as_str(),
                "cancel_task" | "Cancel Task"
            ) {
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
            "targetMode": target_mode,
            "liveTabId": live_tab_id,
            "elevationSessionId": elevation_session_id,
        }),
    )
    .await;
    json!({
        "kind": "auth_challenge_resolution",
        "clarificationId": request.id,
        "answer": request.answer,
        "selectedOption": request.selected_option,
        "decision": if matches!(label.as_str(), "resume_authentication" | "Already Completed") { "verify" } else { "elevate_and_verify" },
        "elevation": elevation,
        "policyDecision": elevation_policy_decision,
        "verification": verification,
    })
}

pub(crate) async fn resolve_host_needs_user_action(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    cancellation: &CancellationToken,
    _display_name: &str,
    _tool_action: &str,
    input: &Value,
    value: &Value,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Option<Value> {
    let action = needs_user_action_object(value)?;
    let kind = user_action_string(action, "kind").unwrap_or("user_action");
    let reason = user_action_string(action, "reason");
    if kind == "auth_challenge"
        && reason != Some("active_file_chooser")
        && (user_action_string(action, "actionability") != Some("user_only")
            || user_action_string(action, "confidence") != Some("high")
            || action.get("taskBlocking").and_then(Value::as_bool) != Some(true)
            || action
                .get("stableObservationCount")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                < 3)
    {
        return None;
    }
    Some(match kind {
        "shared_control_interrupted" => {
            resolve_shared_control_user_action(
                session_id,
                turn_id,
                tool_call_id,
                input,
                value,
                action,
                dispatcher,
            )
            .await
        }
        "auth_challenge" => {
            resolve_auth_challenge_user_action(
                session_id,
                turn_id,
                tool_call_id,
                cancellation,
                input,
                value,
                action,
                dispatcher,
            )
            .await
        }
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
