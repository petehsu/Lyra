use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

#[cfg(feature = "node-api")]
use napi_derive::napi;

use crate::attachments::{self, TerminalAttachmentAttachRequest, TerminalAttachmentSnapshot};

type TerminalAgentResult<T> = std::result::Result<T, String>;

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAgentRelation {
    pub relation_id: String,
    pub terminal_session_id: String,
    pub parent_agent_session_id: String,
    pub child_agent_session_id: String,
    pub attachment_id: String,
    pub permission_id: Option<String>,
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub status: String,
    pub created_at: String,
    pub reason: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAgentLaunchRequest {
    pub session_id: String,
    pub parent_agent_session_id: String,
    pub child_agent_session_id: Option<String>,
    pub runtime_turn_id: Option<String>,
    pub tool_call_id: Option<String>,
    pub permission_id: Option<String>,
    pub permission_scope: Option<String>,
    pub approved: Option<bool>,
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub reason: Option<String>,
    pub ttl_ms: Option<f64>,
    pub storage_root: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAgentLaunchResponse {
    pub session_id: String,
    pub relation: TerminalAgentRelation,
    pub attachment: TerminalAttachmentSnapshot,
    pub status: String,
    pub permission_id: Option<String>,
    pub memory: Option<String>,
    pub warning: Option<String>,
}

pub fn launch_terminal_agent(
    request: TerminalAgentLaunchRequest,
) -> TerminalAgentResult<TerminalAgentLaunchResponse> {
    let session_id = required("sessionId", &request.session_id)?;
    let parent_agent_session_id =
        required("parentAgentSessionId", &request.parent_agent_session_id)?;
    let child_agent_session_id = request
        .child_agent_session_id
        .clone()
        .map(|value| required("childAgentSessionId", &value))
        .transpose()?
        .unwrap_or_else(|| format!("terminal-child-agent-{}", Uuid::new_v4()));
    let reason = request
        .reason
        .clone()
        .unwrap_or_else(|| "terminal child agent launch".to_string());
    let attach_response = attachments::attach_agent(TerminalAttachmentAttachRequest {
        session_id: session_id.clone(),
        agent_session_id: child_agent_session_id.clone(),
        runtime_turn_id: request.runtime_turn_id.clone(),
        tool_call_id: request.tool_call_id.clone(),
        mode: "delegated".to_string(),
        reason: Some(reason.clone()),
        ttl_ms: request.ttl_ms,
        permission_id: request.permission_id.clone(),
        permission_scope: request.permission_scope.clone(),
        approved: request.approved,
        storage_root: request.storage_root.clone(),
        actor_json: request.actor_json.clone(),
        correlation_json: request.correlation_json.clone(),
    })?;
    let attachment = attachments::update_child_attachment_links(
        request.storage_root.as_deref(),
        &session_id,
        &attach_response.attachment.attachment_id,
        &parent_agent_session_id,
        &child_agent_session_id,
    )
    .unwrap_or_else(|_| {
        let mut snapshot = attach_response.attachment.clone();
        snapshot.parent_agent_session_id = Some(parent_agent_session_id.clone());
        snapshot.child_agent_session_id = Some(child_agent_session_id.clone());
        snapshot
    });
    let relation = TerminalAgentRelation {
        relation_id: format!("terminal-agent-relation-{}", Uuid::new_v4()),
        terminal_session_id: session_id.clone(),
        parent_agent_session_id: parent_agent_session_id.clone(),
        child_agent_session_id: child_agent_session_id.clone(),
        attachment_id: attachment.attachment_id.clone(),
        permission_id: attach_response.permission_id.clone(),
        command: request.command.clone(),
        cwd: request.cwd.clone(),
        status: attachment.status.clone(),
        created_at: now_iso(),
        reason: Some(reason.clone()),
    };
    attachments::append_child_agent_audit(
        request.storage_root.as_deref(),
        &session_id,
        &attachment,
        request.actor_json.as_deref(),
        request.correlation_json.as_deref(),
        json!({
            "relation": relation,
            "command": request.command,
            "cwd": request.cwd,
            "reason": reason,
            "permissionScope": request.permission_scope
        }),
    )?;

    Ok(TerminalAgentLaunchResponse {
        session_id,
        relation,
        attachment,
        status: attach_response
            .status
            .unwrap_or_else(|| attach_response.attachment.status.clone()),
        permission_id: attach_response.permission_id,
        memory: attach_response.memory,
        warning: attach_response.warning,
    })
}

fn required(field_name: &str, value: &str) -> TerminalAgentResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(format!("{field_name} is required"))
    } else {
        Ok(trimmed.to_string())
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
