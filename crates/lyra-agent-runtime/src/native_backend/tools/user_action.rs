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

pub(crate) async fn resolve_host_needs_user_action(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    _cancellation: &CancellationToken,
    _display_name: &str,
    _tool_action: &str,
    input: &Value,
    value: &Value,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Option<Value> {
    let action = needs_user_action_object(value)?;
    let kind = user_action_string(action, "kind").unwrap_or("user_action");
    if kind == "auth_challenge" {
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
