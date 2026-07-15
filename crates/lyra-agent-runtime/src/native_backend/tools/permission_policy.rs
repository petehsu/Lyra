use super::*;
pub(crate) fn policy_decision_from_permission(request: &PermissionRequest, outcome: &str) -> Value {
    json!({
        "recordType": "policy_decision",
        "mode": "user_prompt",
        "outcome": outcome,
        "permissionRequestId": request.id,
        "risk": request.risk,
        "action": request.action,
        "summary": request.summary,
        "recordedAt": now(),
    })
}

pub(crate) fn auto_approval_policy_decision(
    display_name: &str,
    action: &str,
    input: &Value,
) -> Value {
    json!({
        "recordType": "policy_decision",
        "mode": "auto_approved",
        "outcome": "approved",
        "risk": permission_risk(display_name, action, input).unwrap_or_else(|| "mutation".to_string()),
        "action": action,
        "summary": permission_summary(display_name, action, input),
        "recordedAt": now(),
    })
}

pub(crate) fn policy_denial_decision(
    display_name: &str,
    action: &str,
    input: &Value,
    risk: &str,
) -> Value {
    json!({
        "recordType": "policy_decision",
        "mode": "local_policy",
        "outcome": "denied",
        "risk": risk,
        "action": action,
        "summary": permission_summary(display_name, action, input),
        "recordedAt": now(),
    })
}

pub(crate) fn policy_record_required(display_name: &str, action: &str, input: &Value) -> bool {
    match (display_name, action) {
        ("file", "write" | "edit" | "multiedit" | "apply_patch") => true,
        ("shell", "run") => true,
        ("terminal", terminal_action) => terminal_action_requires_policy(terminal_action),
        ("hardware", "session_open" | "session_read" | "session_write" | "run_action") => true,
        ("git", "stage" | "unstage" | "discard") => true,
        (
            "lyra_lumen",
            "act" | "vact" | "type" | "press" | "submit" | "navigate" | "reload" | "elevate",
        ) => true,
        ("lyra_ax", "act" | "press") => true,
        ("software", "invoke_capability") => true,
        _ => false,
    }
}

pub(crate) fn attach_policy_decision_to_raw(
    mut raw: Value,
    policy_decision: Option<Value>,
) -> Value {
    let Some(policy_decision) = policy_decision else {
        return raw;
    };
    if let Some(object) = raw.as_object_mut() {
        object
            .entry("policyDecision".to_string())
            .or_insert(policy_decision);
    }
    raw
}

pub(crate) fn attach_policy_decision_to_output(
    mut output: Value,
    policy_decision: Option<Value>,
) -> Value {
    let Some(policy_decision) = policy_decision else {
        return output;
    };
    if let Some(raw) = output.get_mut("raw")
        && let Some(raw_object) = raw.as_object_mut()
    {
        raw_object
            .entry("policyDecision".to_string())
            .or_insert(policy_decision);
        return output;
    }
    if let Some(object) = output.as_object_mut() {
        object
            .entry("policyDecision".to_string())
            .or_insert(policy_decision);
    }
    output
}
pub(crate) fn permission_wait_was_cancelled(error: &AgentRuntimeError) -> bool {
    matches!(error, AgentRuntimeError::Cancelled)
}
