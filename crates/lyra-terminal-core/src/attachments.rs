use chrono::{SecondsFormat, Utc};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use uuid::Uuid;

#[cfg(feature = "node-api")]
use napi_derive::napi;

type AttachmentResult<T> = std::result::Result<T, String>;

static ATTACHMENTS: Lazy<Mutex<AttachmentStore>> =
    Lazy::new(|| Mutex::new(AttachmentStore::default()));

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAttachmentSnapshot {
    pub attachment_id: String,
    pub terminal_session_id: String,
    pub agent_session_id: String,
    pub runtime_turn_id: Option<String>,
    pub tool_call_id: Option<String>,
    pub mode: String,
    pub status: String,
    pub permission_id: Option<String>,
    pub attached_at: Option<String>,
    pub detached_at: Option<String>,
    pub paused_at: Option<String>,
    pub reason: Option<String>,
    pub lease_expires_at: Option<String>,
    pub permission_scope: Option<String>,
    pub parent_agent_session_id: Option<String>,
    pub child_agent_session_id: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAttachmentAttachRequest {
    pub session_id: String,
    pub agent_session_id: String,
    pub runtime_turn_id: Option<String>,
    pub tool_call_id: Option<String>,
    pub mode: String,
    pub reason: Option<String>,
    pub ttl_ms: Option<f64>,
    pub permission_id: Option<String>,
    pub permission_scope: Option<String>,
    pub approved: Option<bool>,
    pub storage_root: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAttachmentAttachResponse {
    pub session_id: String,
    pub attachment: TerminalAttachmentSnapshot,
    pub permission_id: Option<String>,
    pub memory: Option<String>,
    pub status: Option<String>,
    pub needs_approval: Option<bool>,
    pub conflict_with_attachment_id: Option<String>,
    pub warning: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAttachmentDetachRequest {
    pub session_id: String,
    pub attachment_id: String,
    pub reason: Option<String>,
    pub storage_root: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAttachmentDetachResponse {
    pub session_id: String,
    pub attachment_id: String,
    pub status: String,
    pub memory: Option<String>,
    pub warning: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAttachmentListRequest {
    pub session_id: Option<String>,
    pub agent_session_id: Option<String>,
    pub include_detached: Option<bool>,
    pub storage_root: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAttachmentListResponse {
    pub session_id: Option<String>,
    pub items: Vec<TerminalAttachmentSnapshot>,
    pub memory: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAttachmentPauseRequest {
    pub session_id: String,
    pub attachment_id: String,
    pub reason: Option<String>,
    pub storage_root: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAttachmentResumeRequest {
    pub session_id: String,
    pub attachment_id: String,
    pub reason: Option<String>,
    pub storage_root: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAttachmentWriteRequest {
    pub session_id: String,
    pub attachment_id: Option<String>,
    pub agent_session_id: Option<String>,
    pub source: Option<String>,
    pub reason: Option<String>,
    pub storage_root: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAttachmentWriteResponse {
    pub session_id: String,
    pub attachment_id: Option<String>,
    pub allowed: bool,
    pub status: String,
    pub controller: Option<TerminalAttachmentSnapshot>,
    pub conflict_with_attachment_id: Option<String>,
    pub correlation_json: Option<String>,
    pub memory: Option<String>,
    pub warning: Option<String>,
}

#[derive(Default)]
struct AttachmentStore {
    sessions: HashMap<String, Vec<TerminalAttachmentSnapshot>>,
    hydrated: HashSet<String>,
}

#[derive(Clone)]
struct AttachmentAuditContext {
    storage_root: Option<String>,
    session_id: String,
    actor: Value,
    correlation: Value,
}

pub fn attach_agent(
    request: TerminalAttachmentAttachRequest,
) -> AttachmentResult<TerminalAttachmentAttachResponse> {
    let session_id = required("sessionId", &request.session_id)?;
    let agent_session_id = required("agentSessionId", &request.agent_session_id)?;
    let mode = normalize_mode(&request.mode)?;
    let now_ms = now_ms();
    let now = now_iso();
    let actor = parse_json_object(request.actor_json.as_deref())
        .unwrap_or_else(|| json!({ "kind": "agent", "agentSessionId": agent_session_id }));
    let correlation = parse_json_object(request.correlation_json.as_deref()).unwrap_or_else(|| {
        json!({
            "agentSessionId": agent_session_id,
            "terminalToolName": "terminal.attachments.attach"
        })
    });
    let context = AttachmentAuditContext {
        storage_root: request.storage_root.clone(),
        session_id: session_id.clone(),
        actor,
        correlation,
    };
    let permission_id = request
        .permission_id
        .clone()
        .or_else(|| string_field(&context.correlation, "permissionId"))
        .or_else(|| string_field(&context.correlation, "permission_id"))
        .or_else(|| string_field(&context.actor, "permissionId"))
        .or_else(|| string_field(&context.actor, "permission_id"));
    let permission_scope = request.permission_scope.clone().or_else(|| {
        context
            .correlation
            .get("permissionScope")
            .or_else(|| context.actor.get("permissionScope"))
            .map(Value::to_string)
    });
    let writer = is_write_mode(&mode);
    let approved = !writer
        || request.approved.unwrap_or(false)
        || permission_id.is_some()
        || permission_scope.is_some();
    let lease_expires_at_ms = ttl_to_expiry(now_ms, request.ttl_ms);

    let mut store = ATTACHMENTS
        .lock()
        .map_err(|_| "failed to lock terminal attachments".to_string())?;
    store.hydrate(request.storage_root.as_deref(), &session_id)?;
    store.sweep_expired(request.storage_root.as_deref(), &session_id, now_ms)?;
    let key = state_key(request.storage_root.as_deref(), &session_id);
    let items = store.sessions.entry(key).or_default();

    if writer && !approved {
        let pending_permission_id =
            permission_id.unwrap_or_else(|| format!("terminal-permission-{}", Uuid::new_v4()));
        let snapshot = TerminalAttachmentSnapshot {
            attachment_id: next_attachment_id(),
            terminal_session_id: session_id.clone(),
            agent_session_id,
            runtime_turn_id: request.runtime_turn_id,
            tool_call_id: request.tool_call_id,
            mode,
            status: "paused".to_string(),
            permission_id: Some(pending_permission_id.clone()),
            attached_at: Some(now.clone()),
            detached_at: None,
            paused_at: Some(now.clone()),
            reason: Some(
                request
                    .reason
                    .unwrap_or_else(|| "control attachment requires approval".to_string()),
            ),
            lease_expires_at: lease_expires_at_ms.map(ms_to_iso),
            permission_scope,
            parent_agent_session_id: None,
            child_agent_session_id: None,
        };
        items.push(snapshot.clone());
        append_attachment_audit(
            &context,
            "attachment_permission_requested",
            &snapshot,
            json!({
                "permissionId": pending_permission_id,
                "mode": snapshot.mode,
                "reason": snapshot.reason
            }),
        )?;
        return Ok(TerminalAttachmentAttachResponse {
            session_id: session_id.clone(),
            attachment: snapshot,
            permission_id: Some(pending_permission_id),
            memory: memory_metadata(request.storage_root.as_deref(), &session_id),
            status: Some("needsApproval".to_string()),
            needs_approval: Some(true),
            conflict_with_attachment_id: None,
            warning: Some("control attachment requires approval".to_string()),
        });
    }

    if writer {
        let current_controller = active_writer(items);
        if let Some(controller) = current_controller {
            if controller.agent_session_id == agent_session_id {
                return Ok(TerminalAttachmentAttachResponse {
                    session_id: session_id.clone(),
                    permission_id: controller.permission_id.clone(),
                    attachment: controller.clone(),
                    memory: memory_metadata(request.storage_root.as_deref(), &session_id),
                    status: Some("active".to_string()),
                    needs_approval: Some(false),
                    conflict_with_attachment_id: None,
                    warning: Some("agent already controls this terminal".to_string()),
                });
            }

            if mode != "takeover" {
                let snapshot = TerminalAttachmentSnapshot {
                    attachment_id: next_attachment_id(),
                    terminal_session_id: session_id.clone(),
                    agent_session_id,
                    runtime_turn_id: request.runtime_turn_id,
                    tool_call_id: request.tool_call_id,
                    mode,
                    status: "revoked".to_string(),
                    permission_id,
                    attached_at: Some(now.clone()),
                    detached_at: Some(now.clone()),
                    paused_at: None,
                    reason: Some(format!(
                        "terminal is already controlled by attachment {}",
                        controller.attachment_id
                    )),
                    lease_expires_at: lease_expires_at_ms.map(ms_to_iso),
                    permission_scope,
                    parent_agent_session_id: None,
                    child_agent_session_id: None,
                };
                items.push(snapshot.clone());
                append_attachment_audit(
                    &context,
                    "attachment_conflict",
                    &snapshot,
                    json!({ "conflictWithAttachmentId": controller.attachment_id }),
                )?;
                return Ok(TerminalAttachmentAttachResponse {
                    session_id: session_id.clone(),
                    permission_id: snapshot.permission_id.clone(),
                    attachment: snapshot,
                    memory: memory_metadata(request.storage_root.as_deref(), &session_id),
                    status: Some("conflict".to_string()),
                    needs_approval: Some(false),
                    conflict_with_attachment_id: Some(controller.attachment_id.clone()),
                    warning: Some("another agent already controls this terminal".to_string()),
                });
            }

            revoke_active_writers(
                items,
                &context,
                &now,
                &format!("takeover by {agent_session_id}"),
            )?;
        }
    }

    let snapshot = TerminalAttachmentSnapshot {
        attachment_id: next_attachment_id(),
        terminal_session_id: session_id.clone(),
        agent_session_id,
        runtime_turn_id: request.runtime_turn_id,
        tool_call_id: request.tool_call_id,
        mode,
        status: "active".to_string(),
        permission_id,
        attached_at: Some(now.clone()),
        detached_at: None,
        paused_at: None,
        reason: request.reason,
        lease_expires_at: lease_expires_at_ms.map(ms_to_iso),
        permission_scope,
        parent_agent_session_id: None,
        child_agent_session_id: None,
    };
    items.push(snapshot.clone());
    let event_kind = if snapshot.mode == "takeover" {
        "attachment_takeover"
    } else {
        "agent_attached"
    };
    append_attachment_audit(
        &context,
        event_kind,
        &snapshot,
        json!({
            "mode": snapshot.mode,
            "status": snapshot.status,
            "permissionId": snapshot.permission_id
        }),
    )?;

    Ok(TerminalAttachmentAttachResponse {
        session_id: session_id.clone(),
        permission_id: snapshot.permission_id.clone(),
        attachment: snapshot,
        memory: memory_metadata(request.storage_root.as_deref(), &session_id),
        status: Some("active".to_string()),
        needs_approval: Some(false),
        conflict_with_attachment_id: None,
        warning: None,
    })
}

pub fn detach_agent(
    request: TerminalAttachmentDetachRequest,
) -> AttachmentResult<TerminalAttachmentDetachResponse> {
    change_attachment_status(
        request.storage_root.as_deref(),
        &request.session_id,
        &request.attachment_id,
        "detached",
        request.reason.as_deref().unwrap_or("detached"),
        "agent_detached",
        request.actor_json.as_deref(),
        request.correlation_json.as_deref(),
    )
}

pub fn pause_attachment(
    request: TerminalAttachmentPauseRequest,
) -> AttachmentResult<TerminalAttachmentDetachResponse> {
    change_attachment_status(
        request.storage_root.as_deref(),
        &request.session_id,
        &request.attachment_id,
        "paused",
        request.reason.as_deref().unwrap_or("paused"),
        "attachment_paused",
        request.actor_json.as_deref(),
        request.correlation_json.as_deref(),
    )
}

pub fn resume_attachment(
    request: TerminalAttachmentResumeRequest,
) -> AttachmentResult<TerminalAttachmentDetachResponse> {
    let session_id = required("sessionId", &request.session_id)?;
    let now = now_iso();
    let actor = parse_json_object(request.actor_json.as_deref())
        .unwrap_or_else(|| json!({ "kind": "terminal_kernel" }));
    let correlation = parse_json_object(request.correlation_json.as_deref()).unwrap_or_default();
    let context = AttachmentAuditContext {
        storage_root: request.storage_root.clone(),
        session_id: session_id.clone(),
        actor,
        correlation,
    };

    let mut store = ATTACHMENTS
        .lock()
        .map_err(|_| "failed to lock terminal attachments".to_string())?;
    store.hydrate(request.storage_root.as_deref(), &session_id)?;
    store.sweep_expired(request.storage_root.as_deref(), &session_id, now_ms())?;
    let key = state_key(request.storage_root.as_deref(), &session_id);
    let items = store
        .sessions
        .get_mut(&key)
        .ok_or_else(|| "attachment not found".to_string())?;
    let index = attachment_index(items, &request.attachment_id)
        .ok_or_else(|| "attachment not found".to_string())?;
    if is_write_mode(&items[index].mode) {
        if let Some(conflict) = items
            .iter()
            .find(|item| {
                item.attachment_id != request.attachment_id
                    && item.status == "active"
                    && is_write_mode(&item.mode)
            })
            .cloned()
        {
            append_attachment_audit(
                &context,
                "attachment_resume_conflict",
                &items[index],
                json!({ "conflictWithAttachmentId": conflict.attachment_id }),
            )?;
            return Ok(TerminalAttachmentDetachResponse {
                session_id,
                attachment_id: request.attachment_id,
                status: "paused".to_string(),
                memory: memory_metadata(request.storage_root.as_deref(), &request.session_id),
                warning: Some("another agent already controls this terminal".to_string()),
            });
        }
    }
    if items[index].status == "detached" || items[index].status == "revoked" {
        return Ok(TerminalAttachmentDetachResponse {
            session_id,
            attachment_id: request.attachment_id,
            status: items[index].status.clone(),
            memory: memory_metadata(request.storage_root.as_deref(), &request.session_id),
            warning: Some("detached or revoked attachment cannot be resumed".to_string()),
        });
    }
    items[index].status = "active".to_string();
    items[index].paused_at = None;
    items[index].reason = request.reason.or_else(|| Some("resumed".to_string()));
    let snapshot = items[index].clone();
    append_attachment_audit(
        &context,
        "attachment_resumed",
        &snapshot,
        json!({ "resumedAt": now }),
    )?;
    Ok(TerminalAttachmentDetachResponse {
        session_id,
        attachment_id: request.attachment_id,
        status: "active".to_string(),
        memory: memory_metadata(request.storage_root.as_deref(), &request.session_id),
        warning: None,
    })
}

pub fn list_attachments(
    request: TerminalAttachmentListRequest,
) -> AttachmentResult<TerminalAttachmentListResponse> {
    let mut store = ATTACHMENTS
        .lock()
        .map_err(|_| "failed to lock terminal attachments".to_string())?;
    let now = now_ms();
    if let Some(session_id) = request.session_id.as_deref() {
        store.hydrate(request.storage_root.as_deref(), session_id)?;
        store.sweep_expired(request.storage_root.as_deref(), session_id, now)?;
    }

    let mut items = Vec::new();
    for (key, session_items) in &store.sessions {
        if let Some(session_id) = request.session_id.as_deref() {
            if key != &state_key(request.storage_root.as_deref(), session_id) {
                continue;
            }
        }
        for item in session_items {
            if !request.include_detached.unwrap_or(false)
                && matches!(item.status.as_str(), "detached" | "revoked")
            {
                continue;
            }
            if let Some(agent_session_id) = request.agent_session_id.as_deref() {
                if item.agent_session_id != agent_session_id
                    && item.child_agent_session_id.as_deref() != Some(agent_session_id)
                {
                    continue;
                }
            }
            items.push(item.clone());
        }
    }
    items.sort_by(|left, right| {
        left.attached_at
            .cmp(&right.attached_at)
            .then_with(|| left.attachment_id.cmp(&right.attachment_id))
    });

    Ok(TerminalAttachmentListResponse {
        session_id: request.session_id.clone(),
        items,
        memory: request
            .session_id
            .as_deref()
            .and_then(|session_id| memory_metadata(request.storage_root.as_deref(), session_id)),
    })
}

pub fn authorize_write(
    request: TerminalAttachmentWriteRequest,
) -> AttachmentResult<TerminalAttachmentWriteResponse> {
    let session_id = required("sessionId", &request.session_id)?;
    let actor = parse_json_object(request.actor_json.as_deref()).unwrap_or_default();
    let correlation = parse_json_object(request.correlation_json.as_deref()).unwrap_or_default();
    let actor_kind = string_field(&actor, "kind")
        .or_else(|| request.source.clone())
        .unwrap_or_else(|| "user".to_string());
    let agent_session_id = request
        .agent_session_id
        .clone()
        .or_else(|| string_field(&actor, "agentSessionId"))
        .or_else(|| string_field(&correlation, "agentSessionId"));
    let attachment_id = request
        .attachment_id
        .clone()
        .or_else(|| string_field(&correlation, "attachmentId"));
    let context = AttachmentAuditContext {
        storage_root: request.storage_root.clone(),
        session_id: session_id.clone(),
        actor,
        correlation: correlation.clone(),
    };

    let mut store = ATTACHMENTS
        .lock()
        .map_err(|_| "failed to lock terminal attachments".to_string())?;
    store.hydrate(request.storage_root.as_deref(), &session_id)?;
    store.sweep_expired(request.storage_root.as_deref(), &session_id, now_ms())?;
    let key = state_key(request.storage_root.as_deref(), &session_id);
    let items = store.sessions.entry(key).or_default();
    let controller = active_writer(items);

    if is_human_actor(&actor_kind, request.source.as_deref()) {
        if let Some(controller) = controller {
            let now = now_iso();
            if let Some(index) = attachment_index(items, &controller.attachment_id) {
                items[index].status = "paused".to_string();
                items[index].paused_at = Some(now.clone());
                items[index].reason = Some("human input interrupted agent control".to_string());
                let paused = items[index].clone();
                append_attachment_audit(
                    &context,
                    "human_input_conflict",
                    &paused,
                    json!({
                        "policy": "pause_agent_control",
                        "interruptedAt": now,
                        "reason": request.reason
                    }),
                )?;
                return Ok(TerminalAttachmentWriteResponse {
                    session_id,
                    attachment_id: Some(paused.attachment_id.clone()),
                    allowed: true,
                    status: "humanInterrupted".to_string(),
                    controller: Some(paused),
                    conflict_with_attachment_id: None,
                    correlation_json: Some(merge_correlation_attachment(
                        request.correlation_json.as_deref(),
                        None,
                    )),
                    memory: memory_metadata(request.storage_root.as_deref(), &request.session_id),
                    warning: Some("human input paused agent control".to_string()),
                });
            }
        }
        return Ok(TerminalAttachmentWriteResponse {
            session_id,
            attachment_id: None,
            allowed: true,
            status: "allowed".to_string(),
            controller: None,
            conflict_with_attachment_id: None,
            correlation_json: request.correlation_json,
            memory: None,
            warning: None,
        });
    }

    let Some(agent_session_id) = agent_session_id else {
        return Ok(TerminalAttachmentWriteResponse {
            session_id,
            attachment_id: None,
            allowed: true,
            status: "allowed".to_string(),
            controller: None,
            conflict_with_attachment_id: None,
            correlation_json: request.correlation_json,
            memory: memory_metadata(request.storage_root.as_deref(), &request.session_id),
            warning: None,
        });
    };

    if let Some(attachment_id) = attachment_id {
        let Some(attachment) = items
            .iter()
            .find(|item| item.attachment_id == attachment_id)
            .cloned()
        else {
            append_attachment_attempt(
                &context,
                "agent_input_rejected",
                None,
                "attachment not found",
            )?;
            return Ok(denied_write_response(
                session_id,
                Some(attachment_id),
                "missingAttachment",
                "attachment not found",
                request.storage_root.as_deref(),
            ));
        };
        if attachment.agent_session_id != agent_session_id
            && attachment.child_agent_session_id.as_deref() != Some(agent_session_id.as_str())
        {
            append_attachment_audit(
                &context,
                "agent_input_rejected",
                &attachment,
                json!({ "reason": "attachment belongs to a different agent" }),
            )?;
            return Ok(denied_write_response(
                session_id,
                Some(attachment.attachment_id),
                "wrongAgent",
                "attachment belongs to a different agent",
                request.storage_root.as_deref(),
            ));
        }
        if attachment.status != "active" {
            append_attachment_audit(
                &context,
                "agent_input_rejected",
                &attachment,
                json!({ "reason": format!("attachment status is {}", attachment.status) }),
            )?;
            return Ok(denied_write_response(
                session_id,
                Some(attachment.attachment_id),
                &attachment.status,
                "attachment is not active",
                request.storage_root.as_deref(),
            ));
        }
        if !is_write_mode(&attachment.mode) {
            append_attachment_audit(
                &context,
                "agent_input_rejected",
                &attachment,
                json!({ "reason": "read-only attachment cannot write" }),
            )?;
            return Ok(denied_write_response(
                session_id,
                Some(attachment.attachment_id),
                "readOnly",
                "read-only attachment cannot write",
                request.storage_root.as_deref(),
            ));
        }
        append_attachment_audit(
            &context,
            "agent_input_authorized",
            &attachment,
            json!({ "reason": request.reason }),
        )?;
        return Ok(TerminalAttachmentWriteResponse {
            session_id,
            attachment_id: Some(attachment.attachment_id.clone()),
            allowed: true,
            status: "allowed".to_string(),
            controller: Some(attachment.clone()),
            conflict_with_attachment_id: None,
            correlation_json: Some(merge_correlation_attachment(
                request.correlation_json.as_deref(),
                Some(&attachment.attachment_id),
            )),
            memory: memory_metadata(request.storage_root.as_deref(), &request.session_id),
            warning: None,
        });
    }

    if let Some(controller) = controller {
        if controller.agent_session_id == agent_session_id
            || controller.child_agent_session_id.as_deref() == Some(agent_session_id.as_str())
        {
            append_attachment_audit(
                &context,
                "agent_input_authorized",
                &controller,
                json!({ "inferredAttachmentId": controller.attachment_id }),
            )?;
            return Ok(TerminalAttachmentWriteResponse {
                session_id,
                attachment_id: Some(controller.attachment_id.clone()),
                allowed: true,
                status: "allowed".to_string(),
                controller: Some(controller.clone()),
                conflict_with_attachment_id: None,
                correlation_json: Some(merge_correlation_attachment(
                    request.correlation_json.as_deref(),
                    Some(&controller.attachment_id),
                )),
                memory: memory_metadata(request.storage_root.as_deref(), &request.session_id),
                warning: None,
            });
        }
        append_attachment_audit(
            &context,
            "agent_input_rejected",
            &controller,
            json!({ "reason": "another agent controls this terminal" }),
        )?;
        return Ok(TerminalAttachmentWriteResponse {
            session_id,
            attachment_id: None,
            allowed: false,
            status: "conflict".to_string(),
            controller: Some(controller.clone()),
            conflict_with_attachment_id: Some(controller.attachment_id.clone()),
            correlation_json: request.correlation_json,
            memory: memory_metadata(request.storage_root.as_deref(), &request.session_id),
            warning: Some("another agent controls this terminal".to_string()),
        });
    }

    Ok(TerminalAttachmentWriteResponse {
        session_id,
        attachment_id: None,
        allowed: true,
        status: "allowed".to_string(),
        controller: None,
        conflict_with_attachment_id: None,
        correlation_json: request.correlation_json,
        memory: memory_metadata(request.storage_root.as_deref(), &request.session_id),
        warning: None,
    })
}

fn change_attachment_status(
    storage_root: Option<&str>,
    session_id: &str,
    attachment_id: &str,
    status: &str,
    reason: &str,
    event_kind: &str,
    actor_json: Option<&str>,
    correlation_json: Option<&str>,
) -> AttachmentResult<TerminalAttachmentDetachResponse> {
    let session_id = required("sessionId", session_id)?;
    let actor =
        parse_json_object(actor_json).unwrap_or_else(|| json!({ "kind": "terminal_kernel" }));
    let correlation = parse_json_object(correlation_json).unwrap_or_default();
    let context = AttachmentAuditContext {
        storage_root: storage_root.map(str::to_string),
        session_id: session_id.clone(),
        actor,
        correlation,
    };
    let now = now_iso();
    let mut store = ATTACHMENTS
        .lock()
        .map_err(|_| "failed to lock terminal attachments".to_string())?;
    store.hydrate(storage_root, &session_id)?;
    store.sweep_expired(storage_root, &session_id, now_ms())?;
    let key = state_key(storage_root, &session_id);
    let items = store
        .sessions
        .get_mut(&key)
        .ok_or_else(|| "attachment not found".to_string())?;
    let index =
        attachment_index(items, attachment_id).ok_or_else(|| "attachment not found".to_string())?;
    items[index].status = status.to_string();
    items[index].reason = Some(reason.to_string());
    match status {
        "paused" => items[index].paused_at = Some(now.clone()),
        "detached" | "revoked" => items[index].detached_at = Some(now.clone()),
        _ => {}
    }
    let snapshot = items[index].clone();
    append_attachment_audit(
        &context,
        event_kind,
        &snapshot,
        json!({ "reason": reason, "recordedAt": now }),
    )?;
    Ok(TerminalAttachmentDetachResponse {
        session_id,
        attachment_id: attachment_id.to_string(),
        status: status.to_string(),
        memory: memory_metadata(storage_root, attachment_id_session(&snapshot)),
        warning: None,
    })
}

impl AttachmentStore {
    fn hydrate(&mut self, storage_root: Option<&str>, session_id: &str) -> AttachmentResult<()> {
        let Some(storage_root) = storage_root else {
            return Ok(());
        };
        let key = state_key(Some(storage_root), session_id);
        if self.hydrated.contains(&key) {
            return Ok(());
        }
        self.hydrated.insert(key.clone());
        let path = attachments_path(storage_root, session_id);
        if !path.exists() {
            return Ok(());
        }
        let file = OpenOptions::new()
            .read(true)
            .open(path)
            .map_err(|error| error.to_string())?;
        let reader = BufReader::new(file);
        let mut by_id = HashMap::<String, TerminalAttachmentSnapshot>::new();
        for line in reader.lines() {
            let line = line.map_err(|error| error.to_string())?;
            if line.trim().is_empty() {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let Some(attachment_value) = value.get("attachment").cloned() else {
                continue;
            };
            if let Ok(snapshot) =
                serde_json::from_value::<TerminalAttachmentSnapshot>(attachment_value)
            {
                by_id.insert(snapshot.attachment_id.clone(), snapshot);
            }
        }
        let mut items = by_id.into_values().collect::<Vec<_>>();
        items.sort_by(|left, right| left.attachment_id.cmp(&right.attachment_id));
        self.sessions.insert(key, items);
        Ok(())
    }

    fn sweep_expired(
        &mut self,
        storage_root: Option<&str>,
        session_id: &str,
        now_ms: i64,
    ) -> AttachmentResult<()> {
        let key = state_key(storage_root, session_id);
        let Some(items) = self.sessions.get_mut(&key) else {
            return Ok(());
        };
        let now = now_iso();
        let context = AttachmentAuditContext {
            storage_root: storage_root.map(str::to_string),
            session_id: session_id.to_string(),
            actor: json!({ "kind": "terminal_kernel" }),
            correlation: json!({ "terminalToolName": "terminal.attachments.lease" }),
        };
        for item in items.iter_mut() {
            if item.status != "active" {
                continue;
            }
            let Some(expires_at) = item.lease_expires_at.as_deref() else {
                continue;
            };
            if iso_to_ms(expires_at).is_some_and(|expires_ms| now_ms >= expires_ms) {
                item.status = "revoked".to_string();
                item.detached_at = Some(now.clone());
                item.reason = Some("control lease expired".to_string());
                append_attachment_audit(
                    &context,
                    "attachment_revoked",
                    item,
                    json!({ "reason": "control lease expired" }),
                )?;
            }
        }
        Ok(())
    }
}

fn revoke_active_writers(
    items: &mut [TerminalAttachmentSnapshot],
    context: &AttachmentAuditContext,
    now: &str,
    reason: &str,
) -> AttachmentResult<()> {
    for item in items.iter_mut() {
        if item.status == "active" && is_write_mode(&item.mode) {
            item.status = "revoked".to_string();
            item.detached_at = Some(now.to_string());
            item.reason = Some(reason.to_string());
            append_attachment_audit(
                context,
                "attachment_revoked",
                item,
                json!({ "reason": reason }),
            )?;
        }
    }
    Ok(())
}

fn active_writer(items: &[TerminalAttachmentSnapshot]) -> Option<TerminalAttachmentSnapshot> {
    items
        .iter()
        .find(|item| item.status == "active" && is_write_mode(&item.mode))
        .cloned()
}

fn attachment_index(items: &[TerminalAttachmentSnapshot], attachment_id: &str) -> Option<usize> {
    items
        .iter()
        .position(|item| item.attachment_id == attachment_id)
}

fn denied_write_response(
    session_id: String,
    attachment_id: Option<String>,
    status: &str,
    message: &str,
    storage_root: Option<&str>,
) -> TerminalAttachmentWriteResponse {
    TerminalAttachmentWriteResponse {
        session_id: session_id.clone(),
        attachment_id,
        allowed: false,
        status: status.to_string(),
        controller: None,
        conflict_with_attachment_id: None,
        correlation_json: None,
        memory: memory_metadata(storage_root, &session_id),
        warning: Some(message.to_string()),
    }
}

fn append_attachment_attempt(
    context: &AttachmentAuditContext,
    event_kind: &str,
    attachment: Option<&TerminalAttachmentSnapshot>,
    reason: &str,
) -> AttachmentResult<()> {
    if let Some(attachment) = attachment {
        return append_attachment_audit(
            context,
            event_kind,
            attachment,
            json!({ "reason": reason }),
        );
    }
    append_raw_attachment_record(
        context,
        json!({
            "attachmentRecordId": format!("terminal-attachment-record-{}", Uuid::new_v4()),
            "terminalSessionId": context.session_id,
            "kind": event_kind,
            "actor": context.actor,
            "correlation": context.correlation,
            "payload": { "reason": reason },
            "recordedAt": now_iso()
        }),
    )
}

pub(crate) fn append_child_agent_audit(
    storage_root: Option<&str>,
    session_id: &str,
    attachment: &TerminalAttachmentSnapshot,
    actor_json: Option<&str>,
    correlation_json: Option<&str>,
    payload: Value,
) -> AttachmentResult<()> {
    let context = AttachmentAuditContext {
        storage_root: storage_root.map(str::to_string),
        session_id: session_id.to_string(),
        actor: parse_json_object(actor_json).unwrap_or_else(|| json!({ "kind": "agent" })),
        correlation: parse_json_object(correlation_json).unwrap_or_default(),
    };
    append_attachment_audit(
        &context,
        "terminal_child_agent_launched",
        attachment,
        payload,
    )
}

fn append_attachment_audit(
    context: &AttachmentAuditContext,
    event_kind: &str,
    attachment: &TerminalAttachmentSnapshot,
    payload: Value,
) -> AttachmentResult<()> {
    append_raw_attachment_record(
        context,
        json!({
            "attachmentRecordId": format!("terminal-attachment-record-{}", Uuid::new_v4()),
            "terminalSessionId": context.session_id,
            "attachmentId": attachment.attachment_id,
            "agentSessionId": attachment.agent_session_id,
            "kind": event_kind,
            "mode": attachment.mode,
            "status": attachment.status,
            "permissionId": attachment.permission_id,
            "runtimeTurnId": attachment.runtime_turn_id,
            "toolCallId": attachment.tool_call_id,
            "actor": context.actor,
            "correlation": context.correlation,
            "payload": payload,
            "attachment": attachment,
            "recordedAt": now_iso()
        }),
    )
}

fn append_raw_attachment_record(
    context: &AttachmentAuditContext,
    value: Value,
) -> AttachmentResult<()> {
    let Some(storage_root) = context.storage_root.as_deref() else {
        return Ok(());
    };
    let path = attachments_path(storage_root, &context.session_id);
    append_json_line(&path, &value)?;
    append_agent_link_index(storage_root, &context.session_id, &value)
}

fn append_agent_link_index(
    storage_root: &str,
    session_id: &str,
    value: &Value,
) -> AttachmentResult<()> {
    let Some(agent_session_id) = value.get("agentSessionId").and_then(Value::as_str) else {
        return Ok(());
    };
    let path = agent_link_index_path(storage_root, session_id);
    let record = json!({
        "linkRecordId": format!("terminal-link-record-{}", Uuid::new_v4()),
        "linkId": format!(
            "agent-terminal-link-{}-{}",
            safe_segment(agent_session_id),
            safe_segment(session_id)
        ),
        "terminalSessionId": session_id,
        "agentSessionId": agent_session_id,
        "attachmentId": value.get("attachmentId").cloned().unwrap_or(Value::Null),
        "status": value.get("status").cloned().unwrap_or(Value::Null),
        "recordKind": value.get("kind").cloned().unwrap_or(Value::Null),
        "recordedAt": value.get("recordedAt").cloned().unwrap_or(Value::Null)
    });
    append_json_line(&path, &record)
}

fn append_json_line(path: &Path, value: &Value) -> AttachmentResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    serde_json::to_writer(&mut file, value).map_err(|error| error.to_string())?;
    file.write_all(b"\n").map_err(|error| error.to_string())
}

fn memory_metadata(storage_root: Option<&str>, session_id: &str) -> Option<String> {
    storage_root.and_then(|root| crate::memory::metadata_for_session(root, session_id, false).ok())
}

fn merge_correlation_attachment(
    correlation_json: Option<&str>,
    attachment_id: Option<&str>,
) -> String {
    let mut object = parse_json_object(correlation_json)
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    if let Some(attachment_id) = attachment_id {
        object.insert(
            "attachmentId".to_string(),
            Value::String(attachment_id.to_string()),
        );
    }
    Value::Object(object).to_string()
}

fn parse_json_object(input: Option<&str>) -> Option<Value> {
    input
        .and_then(|value| serde_json::from_str::<Value>(value).ok())
        .filter(Value::is_object)
}

fn string_field(value: &Value, field: &str) -> Option<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn normalize_mode(mode: &str) -> AttachmentResult<String> {
    let normalized = mode.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "observe" | "control" | "takeover" | "delegated" => Ok(normalized),
        _ => Err(format!("unsupported attachment mode: {mode}")),
    }
}

fn is_write_mode(mode: &str) -> bool {
    matches!(mode, "control" | "takeover" | "delegated")
}

fn is_human_actor(actor_kind: &str, source: Option<&str>) -> bool {
    let actor = actor_kind.to_ascii_lowercase();
    let source = source.unwrap_or_default().to_ascii_lowercase();
    actor == "human_user" || actor == "user" || source == "user"
}

fn required(field_name: &str, value: &str) -> AttachmentResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(format!("{field_name} is required"))
    } else {
        Ok(trimmed.to_string())
    }
}

fn next_attachment_id() -> String {
    format!("terminal-attachment-{}", Uuid::new_v4())
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn ttl_to_expiry(now_ms: i64, ttl_ms: Option<f64>) -> Option<i64> {
    ttl_ms.and_then(|value| {
        if value.is_finite() && value > 0.0 {
            Some(now_ms.saturating_add(value.round() as i64))
        } else {
            None
        }
    })
}

fn ms_to_iso(ms: i64) -> String {
    chrono::DateTime::<Utc>::from_timestamp_millis(ms)
        .unwrap_or_else(Utc::now)
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn iso_to_ms(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|datetime| datetime.timestamp_millis())
}

fn safe_segment(value: &str) -> String {
    let mut output = String::new();
    for character in value.trim().chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
            output.push(character);
        } else if !output.ends_with('_') {
            output.push('_');
        }
    }
    let trimmed = output.trim_matches('_');
    if trimmed.is_empty() {
        "terminal-session".to_string()
    } else {
        trimmed.chars().take(160).collect()
    }
}

fn state_key(storage_root: Option<&str>, session_id: &str) -> String {
    format!("{}\u{0}{session_id}", storage_root.unwrap_or_default())
}

fn terminal_memory_session_root(storage_root: &str, session_id: &str) -> PathBuf {
    Path::new(storage_root)
        .join("terminal-memory")
        .join("sessions")
        .join(safe_segment(session_id))
}

fn attachments_path(storage_root: &str, session_id: &str) -> PathBuf {
    terminal_memory_session_root(storage_root, session_id).join("attachments.jsonl")
}

fn agent_link_index_path(storage_root: &str, session_id: &str) -> PathBuf {
    terminal_memory_session_root(storage_root, session_id)
        .join("indexes")
        .join("agent_terminal_links.jsonl")
}

fn attachment_id_session(snapshot: &TerminalAttachmentSnapshot) -> &str {
    &snapshot.terminal_session_id
}

pub(crate) fn update_child_attachment_links(
    storage_root: Option<&str>,
    session_id: &str,
    attachment_id: &str,
    parent_agent_session_id: &str,
    child_agent_session_id: &str,
) -> AttachmentResult<TerminalAttachmentSnapshot> {
    let mut store = ATTACHMENTS
        .lock()
        .map_err(|_| "failed to lock terminal attachments".to_string())?;
    store.hydrate(storage_root, session_id)?;
    let key = state_key(storage_root, session_id);
    let items = store
        .sessions
        .get_mut(&key)
        .ok_or_else(|| "attachment not found".to_string())?;
    let index =
        attachment_index(items, attachment_id).ok_or_else(|| "attachment not found".to_string())?;
    items[index].parent_agent_session_id = Some(parent_agent_session_id.to_string());
    items[index].child_agent_session_id = Some(child_agent_session_id.to_string());
    Ok(items[index].clone())
}
