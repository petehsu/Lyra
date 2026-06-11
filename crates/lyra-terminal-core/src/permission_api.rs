use crate::memory_api;
use crate::protocol::*;
use crate::query::memory_json;
use crate::Result;

pub(crate) fn evaluate_permission(
    request: TerminalPermissionEvaluateRequest,
) -> Result<TerminalPermissionEvaluateResponse> {
    let risk = request.risk.unwrap_or_else(|| "low".to_string());
    let permission_id = format!("terminal-permission-{}", uuid::Uuid::new_v4());
    let decision = if risk == "none" {
        "allow"
    } else {
        "needsApproval"
    };
    if decision == "needsApproval" {
        let _ = memory_api::record_permission_requested(TerminalPermissionEventRequest {
            session_id: request.session_id.clone(),
            storage_root: request.storage_root.clone(),
            permission_id: permission_id.clone(),
            action: Some(request.action.clone()),
            risk: Some(risk.clone()),
            summary: request.summary.clone().or(request.title.clone()),
            title: request.title.clone(),
            detail: request.detail.clone(),
            command_id: request.command_id.clone(),
            input_id: request.input_id.clone(),
            agent_session_id: None,
            runtime_turn_id: None,
            tool_call_id: None,
            decision: Some(decision.to_string()),
            reason: Some("semantic terminal action requires approval".to_string()),
            expires_at: None,
            actor_json: request.actor_json.clone(),
            correlation_json: request.correlation_json.clone(),
        });
    }
    Ok(TerminalPermissionEvaluateResponse {
        session_id: request.session_id.clone(),
        permission_id,
        decision: decision.to_string(),
        risk,
        reason: Some(if decision == "allow" {
            "risk does not require approval".to_string()
        } else {
            "semantic terminal action requires approval".to_string()
        }),
        memory: memory_json(&request.storage_root, &request.session_id, false),
    })
}

pub(crate) fn respond_permission(
    request: TerminalPermissionRespondRequest,
) -> Result<TerminalPermissionRespondResponse> {
    let decision = request.decision.trim().to_ascii_lowercase();
    let event = TerminalPermissionEventRequest {
        session_id: request.session_id.clone(),
        storage_root: request.storage_root.clone(),
        permission_id: request.permission_id.clone(),
        action: None,
        risk: None,
        summary: None,
        title: None,
        detail: None,
        command_id: None,
        input_id: None,
        agent_session_id: None,
        runtime_turn_id: None,
        tool_call_id: None,
        decision: Some(decision.clone()),
        reason: request.reason.clone(),
        expires_at: request.expires_at.clone(),
        actor_json: request.actor_json.clone(),
        correlation_json: request.correlation_json.clone(),
    };
    if decision == "allow" || decision == "granted" {
        memory_api::record_permission_granted(event)?;
    } else {
        memory_api::record_permission_denied(event)?;
    }
    Ok(TerminalPermissionRespondResponse {
        session_id: request.session_id.clone(),
        permission_id: request.permission_id,
        decision,
        expires_at: request.expires_at,
        memory: memory_json(&request.storage_root, &request.session_id, false),
    })
}
