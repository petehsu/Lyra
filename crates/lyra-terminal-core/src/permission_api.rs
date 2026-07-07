use crate::protocol::*;
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
        memory: None,
    })
}

pub(crate) fn respond_permission(
    request: TerminalPermissionRespondRequest,
) -> Result<TerminalPermissionRespondResponse> {
    let decision = request.decision.trim().to_ascii_lowercase();
    Ok(TerminalPermissionRespondResponse {
        session_id: request.session_id.clone(),
        permission_id: request.permission_id,
        decision,
        expires_at: request.expires_at,
        memory: None,
    })
}