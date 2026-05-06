use crate::events::emit_event;
use crate::storage::{
    json_string, new_id, sha256_hex, trim_to_string, AiStore, DiffArtifactBlobRecord,
    PatchFileBackupRecord, PatchFileBackupRef, StorageRequest,
};
use crate::tool_runtime::catalog::{
    parse_args, ApplyPatchArgs, RollbackPatchArgs, TOOL_FS_APPLY_PATCH, TOOL_FS_ROLLBACK_PATCH,
};
use crate::tool_runtime::operation::{
    tool_error, tool_error_code, ToolFsOp, ToolOperationEnvelope, ToolResultEnvelope,
    ToolResultStatus, TOOL_APPROVAL_DENIED, TOOL_APPROVAL_NOT_PENDING, TOOL_APPROVAL_REQUIRED,
    TOOL_APPROVAL_UNSUPPORTED, TOOL_PATCH_ALREADY_APPLIED, TOOL_PATCH_ALREADY_ROLLED_BACK,
    TOOL_PATCH_INVALID, TOOL_ROLLBACK_UNSAFE, TOOL_SCHEMA_VERSION,
};
use crate::tool_runtime::patch::{
    plan_patch_apply, write_atomic_text, write_patch_apply_plan, PatchApplyPlan, PatchChangedFile,
};
use crate::tool_runtime::security::WorkspaceSecurity;
use crate::tool_runtime::{tool_result_chat_message, ToolExecutionContext};
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PermissionMode {
    Sandbox,
    FullAccess,
}

impl PermissionMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sandbox => "sandbox",
            Self::FullAccess => "full_access",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApplyPatchRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    pub session_id: String,
    #[serde(default)]
    pub artifact_id: Option<String>,
    #[serde(default)]
    pub patch_ref: Option<String>,
    #[serde(default)]
    pub permission_mode: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApplyPatchResult {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    pub status: String,
    pub detail: String,
    pub approval_ticket_id: String,
    pub artifact_id: String,
    pub evidence_id: String,
    pub patch_ref: String,
    pub changed_files: Vec<PatchChangedFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResolveApprovalRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    pub session_id: String,
    pub approval_ticket_id: String,
    pub decision: ApprovalDecision,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalDecision {
    Approve,
    Deny,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResolveApprovalResult {
    pub session_id: String,
    pub approval_ticket_id: String,
    pub status: String,
    pub detail: String,
    pub tool_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub patch_ref: Option<String>,
    #[serde(default)]
    pub changed_files: Vec<PatchChangedFile>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum ApprovalSource {
    Model(PermissionMode),
    UserApproved,
    UserApprovedTicket(String),
}

struct PreparedPatchApply {
    record: DiffArtifactBlobRecord,
    plan: PatchApplyPlan,
}

struct AppliedPatch {
    approval_ticket_id: String,
    artifact_id: String,
    evidence_id: String,
    patch_ref: String,
    source_artifact_id: String,
    changed_files: Vec<PatchChangedFile>,
    backup_refs: Vec<PatchFileBackupRef>,
}

struct PreparedPatchRollback {
    applied_record: DiffArtifactBlobRecord,
    source_artifact_id: String,
    patch_ref: String,
    changed_files: Vec<PatchChangedFile>,
    backup_refs: Vec<PatchFileBackupRef>,
    backups: Vec<PatchFileBackupRecord>,
}

struct RollbackPatch {
    approval_ticket_id: String,
    artifact_id: String,
    evidence_id: String,
    rolled_back_artifact_id: String,
    patch_ref: String,
    changed_files: Vec<PatchChangedFile>,
}

pub fn normalize_permission_mode(
    permission_mode: Option<&str>,
    approval_policy: Option<&str>,
) -> PermissionMode {
    if permission_mode.and_then(trim_to_string).as_deref() == Some("full_access")
        || approval_policy.and_then(trim_to_string).as_deref() == Some("never")
    {
        PermissionMode::FullAccess
    } else {
        PermissionMode::Sandbox
    }
}

pub fn apply_agent_patch(request: AgentApplyPatchRequest) -> Result<AgentApplyPatchResult> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    let session_id = request.session_id.as_str().trim().to_string();
    if session_id.is_empty() {
        return Err(anyhow!("sessionId is required"));
    }
    let _permission_mode = normalize_permission_mode(request.permission_mode.as_deref(), None);
    let session = store
        .read_session_index(&session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {session_id}"))?;
    let workspace_root = session
        .project_root
        .as_deref()
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("session has no bound workspace root"))?;
    let args = normalize_apply_args(request.artifact_id.as_deref(), request.patch_ref.as_deref())?;
    let operation = apply_operation(new_id("op").as_str(), &args);
    ensure_apply_args_not_denied(&store, &session_id, &args)?;
    let prepared = prepare_patch_apply(
        &store,
        &session_id,
        &ToolExecutionContext {
            workspace_root: Some(workspace_root),
        },
        &args,
    )?;
    ensure_patch_source_not_denied(&store, &session_id, &prepared)?;
    let turn_id = prepared.record.runtime_turn_id.clone();
    emit_apply_event(
        &store,
        &session_id,
        turn_id.as_deref(),
        "tool_operation_started",
        json!({ "operation": operation_payload(&operation) }),
    )?;
    match execute_prepared_apply(
        &store,
        &session_id,
        turn_id.as_deref().unwrap_or_default(),
        &operation.op_id,
        prepared,
        ApprovalSource::UserApproved,
    ) {
        Ok(applied) => {
            let content = applied_content("applied", "Patch applied", &applied)?;
            let mut result = ToolResultEnvelope::completed(
                &operation,
                "Applied patch to workspace",
                content,
                false,
            );
            result.metadata = Some(applied_metadata(&applied));
            let blob = store.append_tool_result_blob(
                &session_id,
                turn_id.as_deref().unwrap_or_default(),
                &operation.op_id,
                TOOL_FS_APPLY_PATCH,
                "completed",
                &result.content,
            )?;
            result.result_ref = Some(blob.result_ref.clone());
            emit_apply_event(
                &store,
                &session_id,
                turn_id.as_deref(),
                "tool_operation_completed",
                json!({
                    "operation": operation_payload(&operation),
                    "result": result_payload(&result, &blob.result_ref, blob.content_bytes, &blob.content_preview),
                }),
            )?;
            Ok(AgentApplyPatchResult {
                session_id,
                turn_id,
                status: "applied".to_string(),
                detail: "Patch applied".to_string(),
                approval_ticket_id: applied.approval_ticket_id,
                artifact_id: applied.artifact_id,
                evidence_id: applied.evidence_id,
                patch_ref: applied.patch_ref,
                changed_files: applied.changed_files,
            })
        }
        Err(error) => {
            let error_code = tool_error_code(&error, TOOL_PATCH_INVALID);
            let result = ToolResultEnvelope::failed(&operation, error_code, error.to_string());
            let blob = store.append_tool_result_blob(
                &session_id,
                turn_id.as_deref().unwrap_or_default(),
                &operation.op_id,
                TOOL_FS_APPLY_PATCH,
                "failed",
                "",
            )?;
            emit_apply_event(
                &store,
                &session_id,
                turn_id.as_deref(),
                "tool_operation_failed",
                json!({
                    "operation": operation_payload(&operation),
                    "result": result_payload(&result, &blob.result_ref, blob.content_bytes, &blob.content_preview),
                }),
            )?;
            Err(error)
        }
    }
}

pub fn resolve_agent_approval(
    request: AgentResolveApprovalRequest,
) -> Result<AgentResolveApprovalResult> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    let session_id = request.session_id.as_str().trim().to_string();
    if session_id.is_empty() {
        return Err(anyhow!("sessionId is required"));
    }
    let approval_ticket_id = request.approval_ticket_id.as_str().trim().to_string();
    if approval_ticket_id.is_empty() {
        return Err(anyhow!("approvalTicketId is required"));
    }
    let ticket = store
        .read_approval_ticket_detail(&session_id, &approval_ticket_id)?
        .ok_or_else(|| anyhow!("approval ticket not found: {approval_ticket_id}"))?;
    if ticket.status != "pending_user" {
        return Err(tool_error(
            TOOL_APPROVAL_NOT_PENDING,
            format!("approval ticket is not pending: {}", ticket.status),
        ));
    }

    match request.decision {
        ApprovalDecision::Approve => approve_approval(&store, &session_id, ticket),
        ApprovalDecision::Deny => deny_approval(&store, &session_id, ticket),
    }
}

fn approve_approval(
    store: &AiStore,
    session_id: &str,
    ticket: crate::storage::ApprovalTicketDetailRecord,
) -> Result<AgentResolveApprovalResult> {
    let tool_path = approval_tool_path(&ticket)?;
    match tool_path.as_str() {
        TOOL_FS_APPLY_PATCH => approve_apply_approval(store, session_id, ticket),
        TOOL_FS_ROLLBACK_PATCH => approve_rollback_approval(store, session_id, ticket),
        _ => Err(tool_error(
            TOOL_APPROVAL_UNSUPPORTED,
            format!("approval is not supported for {tool_path}"),
        )),
    }
}

fn approve_apply_approval(
    store: &AiStore,
    session_id: &str,
    ticket: crate::storage::ApprovalTicketDetailRecord,
) -> Result<AgentResolveApprovalResult> {
    let context = workspace_context_for_session(store, session_id)?;
    let args = apply_args_from_requested_action(&ticket.requested_action)?;
    let op_id = approval_operation_id(&ticket);
    let operation = apply_operation(&op_id, &args);
    let prepared = prepare_patch_apply(store, session_id, &context, &args)?;
    let turn_id = ticket.runtime_turn_id.clone();
    emit_apply_event(
        store,
        session_id,
        Some(turn_id.as_str()),
        "tool_operation_started",
        json!({ "operation": operation_payload(&operation) }),
    )?;
    match execute_prepared_apply(
        store,
        session_id,
        &turn_id,
        &operation.op_id,
        prepared,
        ApprovalSource::UserApprovedTicket(ticket.approval_ticket_id.clone()),
    ) {
        Ok(applied) => {
            let content = applied_content("applied", "Patch applied", &applied)?;
            let mut result = ToolResultEnvelope::completed(
                &operation,
                "Applied patch to workspace",
                content,
                false,
            );
            result.metadata = Some(applied_metadata(&applied));
            let result = append_result_and_emit_event(
                store,
                session_id,
                Some(turn_id.as_str()),
                &operation,
                TOOL_FS_APPLY_PATCH,
                result,
                "tool_operation_completed",
            )?;
            emit_approval_resolved_event(
                store,
                session_id,
                Some(turn_id.as_str()),
                "approve",
                "approved",
                &operation.path,
                result
                    .metadata
                    .as_ref()
                    .cloned()
                    .unwrap_or_else(|| json!({})),
            )?;
            Ok(AgentResolveApprovalResult {
                session_id: session_id.to_string(),
                approval_ticket_id: applied.approval_ticket_id,
                status: "approved".to_string(),
                detail: "Patch applied".to_string(),
                tool_path: TOOL_FS_APPLY_PATCH.to_string(),
                artifact_id: Some(applied.artifact_id),
                evidence_id: Some(applied.evidence_id),
                patch_ref: Some(applied.patch_ref),
                changed_files: applied.changed_files,
            })
        }
        Err(error) => {
            let error_code = tool_error_code(&error, TOOL_PATCH_INVALID);
            let result = ToolResultEnvelope::failed(&operation, error_code, error.to_string());
            append_result_and_emit_event(
                store,
                session_id,
                Some(turn_id.as_str()),
                &operation,
                TOOL_FS_APPLY_PATCH,
                result,
                "tool_operation_failed",
            )?;
            Err(error)
        }
    }
}

fn approve_rollback_approval(
    store: &AiStore,
    session_id: &str,
    ticket: crate::storage::ApprovalTicketDetailRecord,
) -> Result<AgentResolveApprovalResult> {
    let context = workspace_context_for_session(store, session_id)?;
    let args = rollback_args_from_requested_action(&ticket.requested_action)?;
    let op_id = approval_operation_id(&ticket);
    let operation = rollback_operation_for_args(&op_id, &args);
    let prepared = prepare_patch_rollback(store, session_id, &args)?;
    let turn_id = ticket.runtime_turn_id.clone();
    emit_apply_event(
        store,
        session_id,
        Some(turn_id.as_str()),
        "tool_operation_started",
        json!({ "operation": operation_payload(&operation) }),
    )?;
    match execute_prepared_rollback(
        store,
        session_id,
        &turn_id,
        &operation.op_id,
        &context,
        prepared,
        ApprovalSource::UserApprovedTicket(ticket.approval_ticket_id.clone()),
    ) {
        Ok(rolled_back) => {
            let content = rollback_content("rolled_back", "Patch rolled back", &rolled_back)?;
            let mut result = ToolResultEnvelope::completed(
                &operation,
                "Rolled back patch from workspace",
                content,
                false,
            );
            result.metadata = Some(rollback_metadata(&rolled_back));
            let result = append_result_and_emit_event(
                store,
                session_id,
                Some(turn_id.as_str()),
                &operation,
                TOOL_FS_ROLLBACK_PATCH,
                result,
                "tool_operation_completed",
            )?;
            emit_approval_resolved_event(
                store,
                session_id,
                Some(turn_id.as_str()),
                "approve",
                "approved",
                &operation.path,
                result
                    .metadata
                    .as_ref()
                    .cloned()
                    .unwrap_or_else(|| json!({})),
            )?;
            Ok(AgentResolveApprovalResult {
                session_id: session_id.to_string(),
                approval_ticket_id: rolled_back.approval_ticket_id,
                status: "approved".to_string(),
                detail: "Patch rolled back".to_string(),
                tool_path: TOOL_FS_ROLLBACK_PATCH.to_string(),
                artifact_id: Some(rolled_back.artifact_id),
                evidence_id: Some(rolled_back.evidence_id),
                patch_ref: Some(rolled_back.patch_ref),
                changed_files: rolled_back.changed_files,
            })
        }
        Err(error) => {
            let error_code = tool_error_code(&error, TOOL_PATCH_INVALID);
            let result = ToolResultEnvelope::failed(&operation, error_code, error.to_string());
            append_result_and_emit_event(
                store,
                session_id,
                Some(turn_id.as_str()),
                &operation,
                TOOL_FS_ROLLBACK_PATCH,
                result,
                "tool_operation_failed",
            )?;
            Err(error)
        }
    }
}

fn deny_approval(
    store: &AiStore,
    session_id: &str,
    ticket: crate::storage::ApprovalTicketDetailRecord,
) -> Result<AgentResolveApprovalResult> {
    let tool_path = approval_tool_path(&ticket)?;
    let operation = approval_operation_from_ticket(&ticket, &tool_path)?;
    let turn_id = ticket.runtime_turn_id.clone();
    store.update_approval_ticket_status(
        session_id,
        &ticket.approval_ticket_id,
        "denied",
        "user_denied",
    )?;
    let content = json_string(&json!({
        "status": "denied",
        "detail": "User denied tool approval",
        "approvalTicketId": ticket.approval_ticket_id.clone(),
        "toolPath": tool_path.clone(),
        "artifactId": approval_artifact_id(&ticket),
        "patchRef": approval_patch_ref(&ticket),
    }))?;
    let mut result = ToolResultEnvelope::failed(
        &operation,
        TOOL_APPROVAL_DENIED,
        "User denied tool approval",
    );
    result.content = content;
    result.metadata = Some(json!({
        "kind": "approval_denied",
        "approvalTicketId": ticket.approval_ticket_id.clone(),
        "toolPath": tool_path.clone(),
        "artifactId": approval_artifact_id(&ticket),
        "patchRef": approval_patch_ref(&ticket),
    }));
    let result = append_result_and_emit_event(
        store,
        session_id,
        Some(turn_id.as_str()),
        &operation,
        &tool_path,
        result,
        "tool_operation_failed",
    )?;
    emit_approval_resolved_event(
        store,
        session_id,
        Some(turn_id.as_str()),
        "deny",
        "denied",
        &tool_path,
        result
            .metadata
            .as_ref()
            .cloned()
            .unwrap_or_else(|| json!({})),
    )?;
    Ok(AgentResolveApprovalResult {
        session_id: session_id.to_string(),
        approval_ticket_id: ticket.approval_ticket_id.clone(),
        status: "denied".to_string(),
        detail: "User denied tool approval".to_string(),
        tool_path,
        artifact_id: approval_artifact_id(&ticket),
        evidence_id: None,
        patch_ref: approval_patch_ref(&ticket),
        changed_files: Vec::new(),
    })
}

pub fn apply_patch_tool_result(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    permission_mode: PermissionMode,
) -> ToolResultEnvelope {
    match apply_patch_tool_result_inner(
        store,
        session_id,
        turn_id,
        context,
        operation,
        permission_mode,
    ) {
        Ok(result) => result,
        Err(error) => ToolResultEnvelope::failed(
            operation,
            tool_error_code(&error, TOOL_PATCH_INVALID),
            error.to_string(),
        ),
    }
}

fn apply_patch_tool_result_inner(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    permission_mode: PermissionMode,
) -> Result<ToolResultEnvelope> {
    let args = parse_args::<ApplyPatchArgs>(&operation.args)?;
    let args = normalize_apply_args(args.artifact_id.as_deref(), args.patch_ref.as_deref())?;
    ensure_apply_args_not_denied(store, session_id, &args)?;
    let prepared = prepare_patch_apply(store, session_id, context, &args)?;
    ensure_patch_source_not_applied(store, session_id, &prepared)?;
    ensure_patch_source_not_denied(store, session_id, &prepared)?;
    if permission_mode == PermissionMode::Sandbox {
        let ticket = match pending_apply_ticket(store, session_id, &prepared)? {
            Some(ticket) => ticket,
            None => create_approval_ticket(
                store,
                session_id,
                turn_id,
                &operation.op_id,
                &prepared,
                "pending_user",
                "user",
            )?,
        };
        let mut result = ToolResultEnvelope::failed(
            operation,
            TOOL_APPROVAL_REQUIRED,
            "User approval is required before applying this patch",
        );
        result.metadata = Some(json!({
            "kind": "patch_apply_approval_required",
            "approvalTicketId": ticket.approval_ticket_id,
            "artifactId": prepared.record.artifact_id,
            "patchRef": prepared.record.content_ref,
            "changedFiles": prepared.plan.changed_files,
        }));
        return Ok(result);
    }
    let applied = execute_prepared_apply(
        store,
        session_id,
        turn_id,
        &operation.op_id,
        prepared,
        ApprovalSource::Model(permission_mode),
    )?;
    let mut result = ToolResultEnvelope::completed(
        operation,
        "Applied patch to workspace",
        applied_content("applied", "Patch applied", &applied)?,
        false,
    );
    result.metadata = Some(applied_metadata(&applied));
    Ok(result)
}

pub fn rollback_patch_tool_result(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    permission_mode: PermissionMode,
) -> ToolResultEnvelope {
    match rollback_patch_tool_result_inner(
        store,
        session_id,
        turn_id,
        context,
        operation,
        permission_mode,
    ) {
        Ok(result) => result,
        Err(error) => ToolResultEnvelope::failed(
            operation,
            tool_error_code(&error, TOOL_PATCH_INVALID),
            error.to_string(),
        ),
    }
}

fn rollback_patch_tool_result_inner(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    permission_mode: PermissionMode,
) -> Result<ToolResultEnvelope> {
    let args = parse_args::<RollbackPatchArgs>(&operation.args)?;
    let applied_artifact_id = normalize_rollback_args(&args)?;
    ensure_rollback_args_not_denied(store, session_id, &applied_artifact_id)?;
    let prepared = prepare_patch_rollback(store, session_id, &args)?;
    ensure_rollback_source_not_denied(store, session_id, &prepared)?;
    if permission_mode == PermissionMode::Sandbox {
        let ticket = match pending_rollback_ticket(store, session_id, &prepared)? {
            Some(ticket) => ticket,
            None => create_rollback_approval_ticket(
                store,
                session_id,
                turn_id,
                &operation.op_id,
                &prepared,
                "pending_user",
                "user",
            )?,
        };
        let mut result = ToolResultEnvelope::failed(
            operation,
            TOOL_APPROVAL_REQUIRED,
            "User approval is required before rolling back this patch",
        );
        result.metadata = Some(json!({
            "kind": "patch_rollback_approval_required",
            "approvalTicketId": ticket.approval_ticket_id,
            "appliedArtifactId": prepared.applied_record.artifact_id,
            "artifactId": prepared.applied_record.artifact_id,
            "patchRef": prepared.patch_ref,
            "changedFiles": prepared.changed_files,
        }));
        return Ok(result);
    }

    let rolled_back = execute_prepared_rollback(
        store,
        session_id,
        turn_id,
        &operation.op_id,
        context,
        prepared,
        ApprovalSource::Model(permission_mode),
    )?;
    let mut result = ToolResultEnvelope::completed(
        operation,
        "Rolled back patch from workspace",
        rollback_content("rolled_back", "Patch rolled back", &rolled_back)?,
        false,
    );
    result.metadata = Some(rollback_metadata(&rolled_back));
    Ok(result)
}

fn normalize_apply_args(
    artifact_id: Option<&str>,
    patch_ref: Option<&str>,
) -> Result<ApplyPatchArgs> {
    let artifact_id = artifact_id.and_then(trim_to_string);
    let patch_ref = patch_ref.and_then(trim_to_string);
    if artifact_id.is_some() == patch_ref.is_some() {
        return Err(anyhow!("Provide exactly one of artifactId or patchRef"));
    }
    Ok(ApplyPatchArgs {
        artifact_id,
        patch_ref,
    })
}

fn normalize_rollback_args(args: &RollbackPatchArgs) -> Result<String> {
    trim_to_string(&args.applied_artifact_id)
        .ok_or_else(|| anyhow!("appliedArtifactId is required"))
}

fn ensure_apply_args_not_denied(
    store: &AiStore,
    session_id: &str,
    args: &ApplyPatchArgs,
) -> Result<()> {
    if store
        .find_denied_approval_for_tool_source(
            session_id,
            TOOL_FS_APPLY_PATCH,
            args.artifact_id.as_deref(),
            args.patch_ref.as_deref(),
        )?
        .is_some()
    {
        return Err(tool_error(
            TOOL_APPROVAL_DENIED,
            "user denied this patch application",
        ));
    }
    Ok(())
}

fn ensure_rollback_args_not_denied(
    store: &AiStore,
    session_id: &str,
    applied_artifact_id: &str,
) -> Result<()> {
    if store
        .find_denied_approval_for_tool_source(
            session_id,
            TOOL_FS_ROLLBACK_PATCH,
            Some(applied_artifact_id),
            None,
        )?
        .is_some()
    {
        return Err(tool_error(
            TOOL_APPROVAL_DENIED,
            "user denied this patch rollback",
        ));
    }
    Ok(())
}

fn workspace_context_for_session(
    store: &AiStore,
    session_id: &str,
) -> Result<ToolExecutionContext> {
    let session = store
        .read_session_index(session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {session_id}"))?;
    let workspace_root = session
        .project_root
        .as_deref()
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("session has no bound workspace root"))?;
    Ok(ToolExecutionContext {
        workspace_root: Some(workspace_root),
    })
}

fn approval_tool_path(ticket: &crate::storage::ApprovalTicketDetailRecord) -> Result<String> {
    ticket
        .requested_action
        .get("toolPath")
        .and_then(Value::as_str)
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("approval ticket requestedAction is missing toolPath"))
}

fn approval_operation_id(ticket: &crate::storage::ApprovalTicketDetailRecord) -> String {
    ticket
        .requested_action
        .get("toolOperationId")
        .and_then(Value::as_str)
        .and_then(trim_to_string)
        .unwrap_or_else(|| new_id("op"))
}

fn approval_artifact_id(ticket: &crate::storage::ApprovalTicketDetailRecord) -> Option<String> {
    ticket
        .requested_action
        .get("artifactId")
        .or_else(|| ticket.requested_action.get("appliedArtifactId"))
        .and_then(Value::as_str)
        .and_then(trim_to_string)
}

fn approval_patch_ref(ticket: &crate::storage::ApprovalTicketDetailRecord) -> Option<String> {
    ticket
        .requested_action
        .get("patchRef")
        .and_then(Value::as_str)
        .and_then(trim_to_string)
}

fn apply_args_from_requested_action(requested_action: &Value) -> Result<ApplyPatchArgs> {
    let artifact_id = requested_action
        .get("artifactId")
        .and_then(Value::as_str)
        .and_then(trim_to_string);
    if artifact_id.is_some() {
        return Ok(ApplyPatchArgs {
            artifact_id,
            patch_ref: None,
        });
    }
    let patch_ref = requested_action
        .get("patchRef")
        .and_then(Value::as_str)
        .and_then(trim_to_string);
    if patch_ref.is_some() {
        return Ok(ApplyPatchArgs {
            artifact_id: None,
            patch_ref,
        });
    }
    Err(anyhow!(
        "apply_patch approval is missing artifactId or patchRef"
    ))
}

fn rollback_args_from_requested_action(requested_action: &Value) -> Result<RollbackPatchArgs> {
    let applied_artifact_id = requested_action
        .get("appliedArtifactId")
        .or_else(|| requested_action.get("artifactId"))
        .and_then(Value::as_str)
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("rollback_patch approval is missing appliedArtifactId"))?;
    Ok(RollbackPatchArgs {
        applied_artifact_id,
    })
}

fn approval_operation_from_ticket(
    ticket: &crate::storage::ApprovalTicketDetailRecord,
    tool_path: &str,
) -> Result<ToolOperationEnvelope> {
    let op_id = approval_operation_id(ticket);
    let args = if tool_path == TOOL_FS_APPLY_PATCH {
        let args = apply_args_from_requested_action(&ticket.requested_action)?;
        json!({
            "artifactId": args.artifact_id,
            "patchRef": args.patch_ref,
        })
    } else if tool_path == TOOL_FS_ROLLBACK_PATCH {
        let args = rollback_args_from_requested_action(&ticket.requested_action)?;
        json!({
            "appliedArtifactId": args.applied_artifact_id,
        })
    } else {
        ticket.requested_action.clone()
    };
    Ok(ToolOperationEnvelope {
        schema_version: TOOL_SCHEMA_VERSION.to_string(),
        kind: "tool_operation".to_string(),
        op_id,
        op: ToolFsOp::Run,
        path: tool_path.to_string(),
        args,
    })
}

fn prepare_patch_apply(
    store: &AiStore,
    session_id: &str,
    context: &ToolExecutionContext,
    args: &ApplyPatchArgs,
) -> Result<PreparedPatchApply> {
    let record = store
        .read_diff_artifact_blob(
            session_id,
            args.artifact_id.as_deref(),
            args.patch_ref.as_deref(),
        )?
        .ok_or_else(|| anyhow!("AI diff artifact not found"))?;
    if record.status != "created" {
        return Err(tool_error(
            TOOL_PATCH_INVALID,
            "apply_patch requires a patch proposal artifact",
        ));
    }
    ensure_patch_record_not_applied(store, session_id, &record)?;
    let expected_changed_files: Vec<PatchChangedFile> = record
        .metadata
        .get("changedFiles")
        .cloned()
        .map(serde_json::from_value)
        .transpose()?
        .unwrap_or_default();
    let plan = plan_patch_apply(context, &record.content, &expected_changed_files)?;
    Ok(PreparedPatchApply { record, plan })
}

fn ensure_patch_source_not_applied(
    store: &AiStore,
    session_id: &str,
    prepared: &PreparedPatchApply,
) -> Result<()> {
    ensure_patch_record_not_applied(store, session_id, &prepared.record)
}

fn ensure_patch_source_not_denied(
    store: &AiStore,
    session_id: &str,
    prepared: &PreparedPatchApply,
) -> Result<()> {
    if store
        .find_denied_approval_for_tool_source(
            session_id,
            TOOL_FS_APPLY_PATCH,
            Some(&prepared.record.artifact_id),
            Some(&prepared.record.content_ref),
        )?
        .is_some()
    {
        return Err(tool_error(
            TOOL_APPROVAL_DENIED,
            "user denied this patch application",
        ));
    }
    Ok(())
}

fn ensure_patch_record_not_applied(
    store: &AiStore,
    session_id: &str,
    record: &DiffArtifactBlobRecord,
) -> Result<()> {
    if store
        .find_applied_patch_artifact(session_id, &record.artifact_id, &record.content_ref)?
        .is_some()
    {
        return Err(tool_error(
            TOOL_PATCH_ALREADY_APPLIED,
            "patch proposal has already been applied",
        ));
    }
    Ok(())
}

fn pending_apply_ticket(
    store: &AiStore,
    session_id: &str,
    prepared: &PreparedPatchApply,
) -> Result<Option<crate::storage::ApprovalTicketRecord>> {
    store.find_pending_approval_for_tool_source(
        session_id,
        TOOL_FS_APPLY_PATCH,
        Some(&prepared.record.artifact_id),
        Some(&prepared.record.content_ref),
    )
}

fn prepare_patch_rollback(
    store: &AiStore,
    session_id: &str,
    args: &RollbackPatchArgs,
) -> Result<PreparedPatchRollback> {
    let applied_artifact_id = normalize_rollback_args(args)?;
    let applied_record = store
        .read_patch_artifact_record(session_id, &applied_artifact_id)?
        .ok_or_else(|| anyhow!("applied patch artifact not found"))?;
    if applied_record.status == "rolled_back" {
        return Err(tool_error(
            TOOL_PATCH_ALREADY_ROLLED_BACK,
            "patch has already been rolled back",
        ));
    }
    if applied_record.status != "applied" {
        return Err(tool_error(
            TOOL_PATCH_INVALID,
            "rollback_patch requires an applied patch artifact",
        ));
    }
    let source_artifact_id = applied_record
        .metadata
        .get("appliedFromArtifactId")
        .and_then(Value::as_str)
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("applied patch metadata is missing appliedFromArtifactId"))?;
    let patch_ref = applied_record
        .metadata
        .get("patchRef")
        .and_then(Value::as_str)
        .and_then(trim_to_string)
        .unwrap_or_else(|| applied_record.content_ref.clone());
    let changed_files: Vec<PatchChangedFile> = applied_record
        .metadata
        .get("changedFiles")
        .cloned()
        .map(serde_json::from_value)
        .transpose()?
        .unwrap_or_default();
    if changed_files.is_empty() {
        return Err(tool_error(
            TOOL_PATCH_INVALID,
            "applied patch metadata is missing changedFiles",
        ));
    }
    let backup_refs: Vec<PatchFileBackupRef> = applied_record
        .metadata
        .get("backupRefs")
        .cloned()
        .map(serde_json::from_value)
        .transpose()?
        .unwrap_or_default();
    if backup_refs.is_empty() {
        return Err(tool_error(
            TOOL_PATCH_INVALID,
            "applied patch metadata is missing backupRefs",
        ));
    }
    let mut backups = Vec::with_capacity(backup_refs.len());
    for backup_ref in &backup_refs {
        let backup = store
            .read_patch_file_backup(session_id, &backup_ref.backup_ref)?
            .ok_or_else(|| anyhow!("patch backup not found: {}", backup_ref.backup_ref))?;
        if backup.source_artifact_id != source_artifact_id
            || backup.patch_ref != patch_ref
            || backup.path != backup_ref.path
        {
            return Err(tool_error(
                TOOL_PATCH_INVALID,
                "patch backup does not match applied artifact metadata",
            ));
        }
        backups.push(backup);
    }
    Ok(PreparedPatchRollback {
        applied_record,
        source_artifact_id,
        patch_ref,
        changed_files,
        backup_refs,
        backups,
    })
}

fn pending_rollback_ticket(
    store: &AiStore,
    session_id: &str,
    prepared: &PreparedPatchRollback,
) -> Result<Option<crate::storage::ApprovalTicketRecord>> {
    store.find_pending_approval_for_tool_source(
        session_id,
        TOOL_FS_ROLLBACK_PATCH,
        Some(&prepared.applied_record.artifact_id),
        Some(&prepared.patch_ref),
    )
}

fn ensure_rollback_source_not_denied(
    store: &AiStore,
    session_id: &str,
    prepared: &PreparedPatchRollback,
) -> Result<()> {
    if store
        .find_denied_approval_for_tool_source(
            session_id,
            TOOL_FS_ROLLBACK_PATCH,
            Some(&prepared.applied_record.artifact_id),
            Some(&prepared.patch_ref),
        )?
        .is_some()
    {
        return Err(tool_error(
            TOOL_APPROVAL_DENIED,
            "user denied this patch rollback",
        ));
    }
    Ok(())
}

#[derive(Clone)]
struct RollbackFileAction {
    path: String,
    target_path: PathBuf,
    existed: bool,
    backup_content: Option<String>,
}

fn execute_prepared_rollback(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    op_id: &str,
    context: &ToolExecutionContext,
    prepared: PreparedPatchRollback,
    source: ApprovalSource,
) -> Result<RollbackPatch> {
    let (ticket_status, approval_mode, preferred_ticket_id) = match source {
        ApprovalSource::UserApproved => ("approved", "user_approved", None),
        ApprovalSource::UserApprovedTicket(ticket_id) => {
            ("approved", "user_approved", Some(ticket_id))
        }
        ApprovalSource::Model(PermissionMode::FullAccess) => {
            ("auto_approved_by_full_access", "full_access", None)
        }
        ApprovalSource::Model(PermissionMode::Sandbox) => ("pending_user", "user", None),
    };
    if ticket_status == "pending_user" {
        return Err(anyhow!("rollback_patch execution requires full_access"));
    }
    let actions = preflight_rollback(store, session_id, context, &prepared)?;
    let ticket = if let Some(ticket_id) = preferred_ticket_id {
        store.update_approval_ticket_status(session_id, &ticket_id, ticket_status, approval_mode)?
    } else {
        match pending_rollback_ticket(store, session_id, &prepared)? {
            Some(ticket) => store.update_approval_ticket_status(
                session_id,
                &ticket.approval_ticket_id,
                ticket_status,
                approval_mode,
            )?,
            None => create_rollback_approval_ticket(
                store,
                session_id,
                turn_id,
                op_id,
                &prepared,
                ticket_status,
                approval_mode,
            )?,
        }
    };

    let mut write_records = Vec::with_capacity(actions.len());
    for action in &actions {
        if action.existed {
            let content = action
                .backup_content
                .as_deref()
                .ok_or_else(|| anyhow!("rollback backup content missing"))?;
            write_atomic_text(&action.target_path, content)?;
            write_records.push(json!({
                "path": action.path,
                "action": "restored",
                "bytes": content.len(),
            }));
        } else {
            fs::remove_file(&action.target_path)
                .with_context(|| format!("failed to remove {}", action.target_path.display()))?;
            write_records.push(json!({
                "path": action.path,
                "action": "removed_created_file",
                "bytes": 0,
            }));
        }
    }

    let changed_files_json = serde_json::to_value(&prepared.changed_files)?;
    let metadata = json!({
        "mimeType": "application/json",
        "createdByTool": TOOL_FS_ROLLBACK_PATCH,
        "rolledBackArtifactId": prepared.applied_record.artifact_id,
        "appliedFromArtifactId": prepared.source_artifact_id,
        "patchRef": prepared.patch_ref,
        "approvalTicketId": ticket.approval_ticket_id,
        "changedFiles": prepared.changed_files,
        "backupRefs": prepared.backup_refs,
        "writeRecords": write_records,
    });
    let refs = store.append_rollback_patch_artifact_and_evidence(
        session_id,
        turn_id,
        op_id,
        &format!("Rolled back {}", prepared.applied_record.title),
        &prepared.patch_ref,
        metadata,
        changed_files_json,
    )?;
    store.update_artifact_status(
        session_id,
        &prepared.applied_record.artifact_id,
        "rolled_back",
    )?;
    Ok(RollbackPatch {
        approval_ticket_id: ticket.approval_ticket_id,
        artifact_id: refs.artifact_id,
        evidence_id: refs.evidence_id,
        rolled_back_artifact_id: prepared.applied_record.artifact_id,
        patch_ref: prepared.patch_ref,
        changed_files: prepared.changed_files,
    })
}

fn preflight_rollback(
    store: &AiStore,
    session_id: &str,
    context: &ToolExecutionContext,
    prepared: &PreparedPatchRollback,
) -> Result<Vec<RollbackFileAction>> {
    let security = WorkspaceSecurity::new(context.workspace_root.as_deref())?;
    let mut actions = Vec::with_capacity(prepared.backups.len());
    for backup in &prepared.backups {
        let relative_path = security.validate_relative_path_for_write_preview(&backup.path)?;
        let target_path = security.root().join(&relative_path);
        let expected_hash = backup.post_apply_sha256.as_deref().ok_or_else(|| {
            tool_error(
                TOOL_ROLLBACK_UNSAFE,
                format!("missing post-apply hash for {}", backup.path),
            )
        })?;
        let current_bytes = fs::read(&target_path).map_err(|error| {
            tool_error(
                TOOL_ROLLBACK_UNSAFE,
                format!("rollback target is unavailable: {} ({error})", backup.path),
            )
        })?;
        let current_hash = sha256_hex(&current_bytes);
        if current_hash != expected_hash {
            return Err(tool_error(
                TOOL_ROLLBACK_UNSAFE,
                format!("rollback target changed after apply: {}", backup.path),
            ));
        }
        let backup_content = if backup.existed {
            let content_ref = backup.content_ref.as_deref().ok_or_else(|| {
                tool_error(
                    TOOL_ROLLBACK_UNSAFE,
                    format!("missing backup content for {}", backup.path),
                )
            })?;
            Some(store.read_patch_backup_content(session_id, content_ref)?)
        } else {
            None
        };
        actions.push(RollbackFileAction {
            path: relative_path,
            target_path,
            existed: backup.existed,
            backup_content,
        });
    }
    Ok(actions)
}

fn execute_prepared_apply(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    op_id: &str,
    prepared: PreparedPatchApply,
    source: ApprovalSource,
) -> Result<AppliedPatch> {
    let (ticket_status, approval_mode, preferred_ticket_id) = match source {
        ApprovalSource::UserApproved => ("approved", "user_approved", None),
        ApprovalSource::UserApprovedTicket(ticket_id) => {
            ("approved", "user_approved", Some(ticket_id))
        }
        ApprovalSource::Model(PermissionMode::FullAccess) => {
            ("auto_approved_by_full_access", "full_access", None)
        }
        ApprovalSource::Model(PermissionMode::Sandbox) => ("pending_user", "user", None),
    };
    if ticket_status == "pending_user" {
        return Err(anyhow!("pending approvals cannot execute apply_patch"));
    }
    ensure_patch_source_not_applied(store, session_id, &prepared)?;
    let ticket = if let Some(ticket_id) = preferred_ticket_id {
        store.update_approval_ticket_status(session_id, &ticket_id, ticket_status, approval_mode)?
    } else {
        match pending_apply_ticket(store, session_id, &prepared)? {
            Some(ticket) => store.update_approval_ticket_status(
                session_id,
                &ticket.approval_ticket_id,
                ticket_status,
                approval_mode,
            )?,
            None => create_approval_ticket(
                store,
                session_id,
                turn_id,
                op_id,
                &prepared,
                ticket_status,
                approval_mode,
            )?,
        }
    };
    let backup_refs = prepared
        .plan
        .files
        .iter()
        .map(|file| {
            store.append_patch_file_backup(
                session_id,
                turn_id,
                &ticket.approval_ticket_id,
                &prepared.record.artifact_id,
                &prepared.record.content_ref,
                &file.path,
                file.original_content.as_deref(),
                &file.new_content,
            )
        })
        .collect::<Result<Vec<_>>>()?;
    let write_records = write_patch_apply_plan(&prepared.plan)?;
    let changed_files_json = serde_json::to_value(&prepared.plan.changed_files)?;
    let metadata = json!({
        "mimeType": "text/x-diff",
        "sizeBytes": prepared.record.content_bytes,
        "contentHash": prepared.record.content_sha256,
        "createdByTool": TOOL_FS_APPLY_PATCH,
        "appliedFromArtifactId": prepared.record.artifact_id,
        "patchRef": prepared.record.content_ref,
        "approvalTicketId": ticket.approval_ticket_id,
        "changedFiles": prepared.plan.changed_files,
        "backupRefs": backup_refs,
        "writeRecords": write_records,
    });
    let refs = store.append_applied_patch_artifact_and_evidence(
        session_id,
        turn_id,
        op_id,
        &format!("Applied {}", prepared.record.title),
        &prepared.record.content_ref,
        metadata,
        changed_files_json,
    )?;
    Ok(AppliedPatch {
        approval_ticket_id: ticket.approval_ticket_id,
        artifact_id: refs.artifact_id,
        evidence_id: refs.evidence_id,
        patch_ref: prepared.record.content_ref,
        source_artifact_id: prepared.record.artifact_id,
        changed_files: prepared.plan.changed_files,
        backup_refs,
    })
}

fn create_approval_ticket(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    op_id: &str,
    prepared: &PreparedPatchApply,
    status: &str,
    approval_mode: &str,
) -> Result<crate::storage::ApprovalTicketRecord> {
    store.append_approval_ticket(
        session_id,
        turn_id,
        status,
        approval_mode,
        "Apply workspace patch",
        json!({
            "level": "medium",
            "kinds": ["workspace_write"],
            "reversible": "backup_ref",
            "summary": format!(
                "Apply patch to {} workspace file{}.",
                prepared.plan.changed_files.len(),
                if prepared.plan.changed_files.len() == 1 { "" } else { "s" }
            )
        }),
        json!({
            "workspace": "bound",
            "files": prepared.plan.changed_files.iter().map(|file| file.path.clone()).collect::<Vec<_>>(),
        }),
        json!({
            "toolPath": TOOL_FS_APPLY_PATCH,
            "toolOperationId": op_id,
            "artifactId": prepared.record.artifact_id,
            "patchRef": prepared.record.content_ref,
        }),
    )
}

fn create_rollback_approval_ticket(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    op_id: &str,
    prepared: &PreparedPatchRollback,
    status: &str,
    approval_mode: &str,
) -> Result<crate::storage::ApprovalTicketRecord> {
    store.append_approval_ticket(
        session_id,
        turn_id,
        status,
        approval_mode,
        "Rollback workspace patch",
        json!({
            "level": "medium",
            "kinds": ["workspace_write"],
            "reversible": "drift_checked_backup_restore",
            "summary": format!(
                "Rollback patch touching {} workspace file{}.",
                prepared.changed_files.len(),
                if prepared.changed_files.len() == 1 { "" } else { "s" }
            )
        }),
        json!({
            "workspace": "bound",
            "files": prepared.changed_files.iter().map(|file| file.path.clone()).collect::<Vec<_>>(),
        }),
        json!({
            "toolPath": TOOL_FS_ROLLBACK_PATCH,
            "toolOperationId": op_id,
            "appliedArtifactId": prepared.applied_record.artifact_id,
            "artifactId": prepared.applied_record.artifact_id,
            "patchRef": prepared.patch_ref,
        }),
    )
}

fn applied_content(status: &str, detail: &str, applied: &AppliedPatch) -> Result<String> {
    json_string(&json!({
        "status": status,
        "detail": detail,
        "approvalTicketId": applied.approval_ticket_id,
        "artifactId": applied.artifact_id,
        "evidenceId": applied.evidence_id,
        "patchRef": applied.patch_ref,
        "appliedFromArtifactId": applied.source_artifact_id,
        "changedFiles": applied.changed_files,
        "backupRefs": applied.backup_refs,
    }))
}

fn applied_metadata(applied: &AppliedPatch) -> Value {
    json!({
        "kind": "patch_apply",
        "status": "applied",
        "approvalTicketId": applied.approval_ticket_id,
        "artifactId": applied.artifact_id,
        "evidenceId": applied.evidence_id,
        "patchRef": applied.patch_ref,
        "appliedFromArtifactId": applied.source_artifact_id,
        "changedFiles": applied.changed_files,
        "backupRefs": applied.backup_refs,
    })
}

fn rollback_content(status: &str, detail: &str, rolled_back: &RollbackPatch) -> Result<String> {
    json_string(&json!({
        "status": status,
        "detail": detail,
        "approvalTicketId": rolled_back.approval_ticket_id,
        "artifactId": rolled_back.artifact_id,
        "evidenceId": rolled_back.evidence_id,
        "rolledBackArtifactId": rolled_back.rolled_back_artifact_id,
        "patchRef": rolled_back.patch_ref,
        "changedFiles": rolled_back.changed_files,
    }))
}

fn rollback_metadata(rolled_back: &RollbackPatch) -> Value {
    json!({
        "kind": "patch_rollback",
        "status": "rolled_back",
        "approvalTicketId": rolled_back.approval_ticket_id,
        "artifactId": rolled_back.artifact_id,
        "evidenceId": rolled_back.evidence_id,
        "rolledBackArtifactId": rolled_back.rolled_back_artifact_id,
        "patchRef": rolled_back.patch_ref,
        "changedFiles": rolled_back.changed_files,
    })
}

fn apply_operation(op_id: &str, args: &ApplyPatchArgs) -> ToolOperationEnvelope {
    ToolOperationEnvelope {
        schema_version: TOOL_SCHEMA_VERSION.to_string(),
        kind: "tool_operation".to_string(),
        op_id: op_id.to_string(),
        op: ToolFsOp::Run,
        path: TOOL_FS_APPLY_PATCH.to_string(),
        args: json!({
            "artifactId": args.artifact_id,
            "patchRef": args.patch_ref,
        }),
    }
}

fn rollback_operation_for_args(op_id: &str, args: &RollbackPatchArgs) -> ToolOperationEnvelope {
    ToolOperationEnvelope {
        schema_version: TOOL_SCHEMA_VERSION.to_string(),
        kind: "tool_operation".to_string(),
        op_id: op_id.to_string(),
        op: ToolFsOp::Run,
        path: TOOL_FS_ROLLBACK_PATCH.to_string(),
        args: json!({
            "appliedArtifactId": args.applied_artifact_id,
        }),
    }
}

fn operation_payload(operation: &ToolOperationEnvelope) -> Value {
    json!({
        "schemaVersion": operation.schema_version,
        "opId": operation.op_id,
        "op": operation.op,
        "path": operation.path,
        "toolPath": operation.path,
        "riskLevel": "medium",
        "summary": format!("Run {}", operation.path),
    })
}

fn result_payload(
    result: &ToolResultEnvelope,
    result_ref: &str,
    content_bytes: i64,
    content_preview: &str,
) -> Value {
    let mut payload = json!({
        "schemaVersion": result.schema_version,
        "opId": result.op_id,
        "op": result.op,
        "path": result.path,
        "resultRef": result_ref,
        "status": result.status,
        "summary": result.summary,
        "contentPreview": content_preview,
        "contentBytes": content_bytes,
        "truncated": result.truncated,
        "errorCode": result.error_code,
        "errorMessage": result.error_message,
    });
    if let (Some(payload), Some(metadata)) = (payload.as_object_mut(), result.metadata.as_ref()) {
        if let Some(metadata) = metadata.as_object() {
            for (key, value) in metadata {
                payload.insert(key.clone(), value.clone());
            }
        }
    }
    payload
}

fn append_result_and_emit_event(
    store: &AiStore,
    session_id: &str,
    turn_id: Option<&str>,
    operation: &ToolOperationEnvelope,
    tool_path: &str,
    mut result: ToolResultEnvelope,
    event_type: &str,
) -> Result<ToolResultEnvelope> {
    let status = match &result.status {
        ToolResultStatus::Completed => "completed",
        ToolResultStatus::Failed => "failed",
    };
    let blob = store.append_tool_result_blob(
        session_id,
        turn_id.unwrap_or_default(),
        &operation.op_id,
        tool_path,
        status,
        &result.content,
    )?;
    result.result_ref = Some(blob.result_ref.clone());
    emit_apply_event(
        store,
        session_id,
        turn_id,
        event_type,
        json!({
            "operation": operation_payload(operation),
            "result": result_payload(&result, &blob.result_ref, blob.content_bytes, &blob.content_preview),
        }),
    )?;
    Ok(result)
}

fn emit_approval_resolved_event(
    store: &AiStore,
    session_id: &str,
    turn_id: Option<&str>,
    decision: &str,
    status: &str,
    tool_path: &str,
    metadata: Value,
) -> Result<()> {
    emit_apply_event(
        store,
        session_id,
        turn_id,
        "approval_ticket_resolved",
        json!({
            "decision": decision,
            "status": status,
            "toolPath": tool_path,
            "approvalTicketId": metadata.get("approvalTicketId").cloned().unwrap_or(Value::Null),
            "artifactId": metadata.get("artifactId").cloned().unwrap_or(Value::Null),
            "evidenceId": metadata.get("evidenceId").cloned().unwrap_or(Value::Null),
            "patchRef": metadata.get("patchRef").cloned().unwrap_or(Value::Null),
            "changedFiles": metadata.get("changedFiles").cloned().unwrap_or_else(|| json!([])),
        }),
    )
}

fn emit_apply_event(
    store: &AiStore,
    session_id: &str,
    turn_id: Option<&str>,
    event_type: &str,
    payload: Value,
) -> Result<()> {
    let event = store.append_event(session_id, turn_id, event_type, payload)?;
    emit_event(&event);
    Ok(())
}

#[allow(dead_code)]
fn _tool_result_message_for_debug(result: &ToolResultEnvelope) -> Result<String> {
    tool_result_chat_message(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{now_ms, AgentSession};
    use crate::tool_runtime::operation::{
        tool_error_code, ToolResultStatus, TOOL_PATH_OUTSIDE_WORKSPACE, TOOL_UNSUPPORTED_ENCODING,
    };
    use std::fs;

    fn seed_session(store: &AiStore, workspace_root: &str) -> String {
        let session_id = new_id("session");
        let now = now_ms();
        store
            .upsert_session_index(&AgentSession {
                id: session_id.clone(),
                title: "Apply patch".to_string(),
                profile_id: None,
                project_root: Some(workspace_root.to_string()),
                project_name: Some("workspace".to_string()),
                collaboration_mode: "default".to_string(),
                created_at: now,
                updated_at: now,
            })
            .expect("session");
        store
            .with_session_conn(&session_id, |_| Ok(()))
            .expect("session db");
        session_id
    }

    fn seed_diff_artifact_with_patch(
        store: &AiStore,
        session_id: &str,
        patch: &str,
        changed_files: Value,
    ) -> String {
        let blob = store
            .append_tool_result_blob(
                session_id,
                "turn-ui",
                "op-propose",
                "/tools/filesystem/propose_patch",
                "completed",
                patch,
            )
            .expect("blob");
        store
            .append_patch_artifact_and_evidence(
                session_id,
                "turn-ui",
                "op-propose",
                "Update README",
                &blob.result_ref,
                json!({
                    "changedFiles": changed_files.clone(),
                    "approvalPreview": { "risk": { "level": "medium" } }
                }),
                changed_files,
            )
            .expect("artifact")
            .artifact_id
    }

    fn seed_diff_artifact(store: &AiStore, session_id: &str) -> String {
        seed_diff_artifact_with_patch(
            store,
            session_id,
            "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n",
            json!([{
                "path": "README.md",
                "changeType": "modified",
                "additions": 1,
                "deletions": 1
            }]),
        )
    }

    fn storage_request(storage_root: &str) -> StorageRequest {
        StorageRequest {
            storage_root: Some(storage_root.to_string()),
        }
    }

    fn tool_context(temp: &tempfile::TempDir) -> ToolExecutionContext {
        ToolExecutionContext {
            workspace_root: Some(temp.path().to_string_lossy().to_string()),
        }
    }

    fn rollback_operation(applied_artifact_id: &str) -> ToolOperationEnvelope {
        ToolOperationEnvelope {
            schema_version: TOOL_SCHEMA_VERSION.to_string(),
            kind: "tool_operation".to_string(),
            op_id: new_id("op"),
            op: ToolFsOp::Run,
            path: TOOL_FS_ROLLBACK_PATCH.to_string(),
            args: json!({ "appliedArtifactId": applied_artifact_id }),
        }
    }

    #[test]
    fn ui_apply_patch_creates_backup_artifact_evidence_ticket_and_event() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(temp.path().join("README.md"), "old\n").expect("readme");
        let storage_root = temp.path().join("ai").to_string_lossy().to_string();
        let store = AiStore::open(Some(storage_root.as_str())).expect("store");
        let session_id = seed_session(&store, temp.path().to_string_lossy().as_ref());
        let artifact_id = seed_diff_artifact(&store, &session_id);

        let result = apply_agent_patch(AgentApplyPatchRequest {
            storage: StorageRequest {
                storage_root: Some(storage_root),
            },
            session_id: session_id.clone(),
            artifact_id: Some(artifact_id),
            patch_ref: None,
            permission_mode: None,
        })
        .expect("apply");

        assert_eq!(
            fs::read_to_string(temp.path().join("README.md")).unwrap(),
            "new\n"
        );
        assert_eq!(result.status, "applied");
        assert_eq!(result.changed_files[0].path, "README.md");
        assert_eq!(
            store
                .count_rows_for_test(&session_id, "approval_ticket")
                .expect("approval count"),
            1
        );
        assert_eq!(
            store
                .count_rows_for_test(&session_id, "file_backup_record")
                .expect("backup count"),
            1
        );
        assert_eq!(
            store
                .count_rows_for_test(&session_id, "artifact_record")
                .expect("artifact count"),
            2
        );
        assert_eq!(
            store
                .count_rows_for_test(&session_id, "evidence_record")
                .expect("evidence count"),
            2
        );
        let detail = store
            .read_session_detail(&session_id)
            .expect("detail")
            .expect("session");
        assert!(detail.runtime_events.iter().any(|event| {
            event.phase == "tool_operation_completed"
                && event.payload["operation"]["path"] == TOOL_FS_APPLY_PATCH
        }));
    }

    #[test]
    fn duplicate_apply_by_artifact_or_patch_ref_is_rejected_without_extra_audit_rows() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(temp.path().join("README.md"), "old\n").expect("readme");
        let storage_root = temp.path().join("ai").to_string_lossy().to_string();
        let store = AiStore::open(Some(storage_root.as_str())).expect("store");
        let session_id = seed_session(&store, temp.path().to_string_lossy().as_ref());
        let artifact_id = seed_diff_artifact(&store, &session_id);

        let result = apply_agent_patch(AgentApplyPatchRequest {
            storage: storage_request(&storage_root),
            session_id: session_id.clone(),
            artifact_id: Some(artifact_id.clone()),
            patch_ref: None,
            permission_mode: None,
        })
        .expect("apply");
        let backup_count = store
            .count_rows_for_test(&session_id, "file_backup_record")
            .expect("backup count");
        let approval_count = store
            .count_rows_for_test(&session_id, "approval_ticket")
            .expect("approval count");
        let artifact_count = store
            .count_rows_for_test(&session_id, "artifact_record")
            .expect("artifact count");

        let duplicate_by_artifact = apply_agent_patch(AgentApplyPatchRequest {
            storage: storage_request(&storage_root),
            session_id: session_id.clone(),
            artifact_id: Some(artifact_id),
            patch_ref: None,
            permission_mode: None,
        })
        .expect_err("duplicate artifact apply should fail");
        assert_eq!(
            tool_error_code(&duplicate_by_artifact, TOOL_PATCH_INVALID),
            TOOL_PATCH_ALREADY_APPLIED
        );

        let duplicate_by_ref = apply_agent_patch(AgentApplyPatchRequest {
            storage: storage_request(&storage_root),
            session_id: session_id.clone(),
            artifact_id: None,
            patch_ref: Some(result.patch_ref),
            permission_mode: None,
        })
        .expect_err("duplicate patchRef apply should fail");
        assert_eq!(
            tool_error_code(&duplicate_by_ref, TOOL_PATCH_INVALID),
            TOOL_PATCH_ALREADY_APPLIED
        );
        assert_eq!(
            store
                .count_rows_for_test(&session_id, "file_backup_record")
                .expect("backup count"),
            backup_count
        );
        assert_eq!(
            store
                .count_rows_for_test(&session_id, "approval_ticket")
                .expect("approval count"),
            approval_count
        );
        assert_eq!(
            store
                .count_rows_for_test(&session_id, "artifact_record")
                .expect("artifact count"),
            artifact_count
        );
    }

    #[test]
    fn sandbox_apply_reuses_pending_ticket_and_session_detail_exposes_it() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(temp.path().join("README.md"), "old\n").expect("readme");
        let storage_root = temp.path().join("ai").to_string_lossy().to_string();
        let store = AiStore::open(Some(storage_root.as_str())).expect("store");
        let session_id = seed_session(&store, temp.path().to_string_lossy().as_ref());
        let artifact_id = seed_diff_artifact(&store, &session_id);
        let context = tool_context(&temp);
        let args = ApplyPatchArgs {
            artifact_id: Some(artifact_id),
            patch_ref: None,
        };
        let operation_a = apply_operation("op-apply-a", &args);
        let operation_b = apply_operation("op-apply-b", &args);

        let first = apply_patch_tool_result(
            &store,
            &session_id,
            "turn-model",
            &context,
            &operation_a,
            PermissionMode::Sandbox,
        );
        let second = apply_patch_tool_result(
            &store,
            &session_id,
            "turn-model",
            &context,
            &operation_b,
            PermissionMode::Sandbox,
        );

        assert_eq!(first.status, ToolResultStatus::Failed);
        assert_eq!(first.error_code.as_deref(), Some(TOOL_APPROVAL_REQUIRED));
        assert_eq!(second.error_code.as_deref(), Some(TOOL_APPROVAL_REQUIRED));
        assert_eq!(
            first.metadata.as_ref().unwrap()["approvalTicketId"],
            second.metadata.as_ref().unwrap()["approvalTicketId"]
        );
        assert_eq!(
            fs::read_to_string(temp.path().join("README.md")).unwrap(),
            "old\n"
        );
        assert_eq!(
            store
                .count_rows_for_test(&session_id, "approval_ticket")
                .expect("approval count"),
            1
        );
        let detail = store
            .read_session_detail(&session_id)
            .expect("detail")
            .expect("session");
        assert_eq!(detail.pending_interactions.len(), 1);
        assert_eq!(detail.pending_interactions[0]["kind"], "tool_approval");
        assert_eq!(
            detail.pending_interactions[0]["payload"]["toolPath"],
            TOOL_FS_APPLY_PATCH
        );
    }

    #[test]
    fn resolve_approval_approve_pending_apply_reuses_ticket_and_writes() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(temp.path().join("README.md"), "old\n").expect("readme");
        let storage_root = temp.path().join("ai").to_string_lossy().to_string();
        let store = AiStore::open(Some(storage_root.as_str())).expect("store");
        let session_id = seed_session(&store, temp.path().to_string_lossy().as_ref());
        let artifact_id = seed_diff_artifact(&store, &session_id);
        let operation = apply_operation(
            "op-apply",
            &ApplyPatchArgs {
                artifact_id: Some(artifact_id),
                patch_ref: None,
            },
        );
        let pending = apply_patch_tool_result(
            &store,
            &session_id,
            "turn-model",
            &tool_context(&temp),
            &operation,
            PermissionMode::Sandbox,
        );
        let approval_ticket_id = pending.metadata.as_ref().unwrap()["approvalTicketId"]
            .as_str()
            .unwrap()
            .to_string();

        let result = resolve_agent_approval(AgentResolveApprovalRequest {
            storage: storage_request(&storage_root),
            session_id: session_id.clone(),
            approval_ticket_id: approval_ticket_id.clone(),
            decision: ApprovalDecision::Approve,
        })
        .expect("approve");

        assert_eq!(result.status, "approved");
        assert_eq!(result.approval_ticket_id, approval_ticket_id);
        assert_eq!(
            fs::read_to_string(temp.path().join("README.md")).unwrap(),
            "new\n"
        );
        assert_eq!(
            store
                .read_session_detail(&session_id)
                .expect("detail")
                .expect("detail")
                .pending_interactions
                .len(),
            0
        );
        assert_eq!(
            store
                .count_rows_for_test(&session_id, "approval_ticket")
                .expect("approval count"),
            1
        );
    }

    #[test]
    fn resolve_approval_deny_pending_apply_blocks_same_source_retry() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(temp.path().join("README.md"), "old\n").expect("readme");
        let storage_root = temp.path().join("ai").to_string_lossy().to_string();
        let store = AiStore::open(Some(storage_root.as_str())).expect("store");
        let session_id = seed_session(&store, temp.path().to_string_lossy().as_ref());
        let artifact_id = seed_diff_artifact(&store, &session_id);
        let operation = apply_operation(
            "op-apply",
            &ApplyPatchArgs {
                artifact_id: Some(artifact_id),
                patch_ref: None,
            },
        );
        let pending = apply_patch_tool_result(
            &store,
            &session_id,
            "turn-model",
            &tool_context(&temp),
            &operation,
            PermissionMode::Sandbox,
        );
        let approval_ticket_id = pending.metadata.as_ref().unwrap()["approvalTicketId"]
            .as_str()
            .unwrap()
            .to_string();

        let result = resolve_agent_approval(AgentResolveApprovalRequest {
            storage: storage_request(&storage_root),
            session_id: session_id.clone(),
            approval_ticket_id: approval_ticket_id.clone(),
            decision: ApprovalDecision::Deny,
        })
        .expect("deny");

        assert_eq!(result.status, "denied");
        assert_eq!(
            fs::read_to_string(temp.path().join("README.md")).unwrap(),
            "old\n"
        );
        let ticket = store
            .read_approval_ticket_detail(&session_id, &approval_ticket_id)
            .expect("ticket")
            .expect("ticket");
        assert_eq!(ticket.status, "denied");
        assert_eq!(ticket.approval_mode, "user_denied");
        let detail = store
            .read_session_detail(&session_id)
            .expect("detail")
            .expect("detail");
        assert_eq!(detail.pending_interactions.len(), 0);
        assert!(detail.runtime_events.iter().any(|event| {
            event.phase == "tool_operation_failed"
                && event.payload["result"]["errorCode"] == TOOL_APPROVAL_DENIED
        }));
        assert!(detail.runtime_events.iter().any(|event| {
            event.phase == "approval_ticket_resolved"
                && event.payload["status"] == "denied"
                && event.payload["approvalTicketId"] == approval_ticket_id
        }));

        let retry = apply_patch_tool_result(
            &store,
            &session_id,
            "turn-model",
            &tool_context(&temp),
            &operation,
            PermissionMode::Sandbox,
        );
        assert_eq!(retry.error_code.as_deref(), Some(TOOL_APPROVAL_DENIED));
        assert_eq!(
            store
                .count_rows_for_test(&session_id, "approval_ticket")
                .expect("approval count"),
            1
        );
    }

    #[test]
    fn resolving_non_pending_ticket_is_rejected() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(temp.path().join("README.md"), "old\n").expect("readme");
        let storage_root = temp.path().join("ai").to_string_lossy().to_string();
        let store = AiStore::open(Some(storage_root.as_str())).expect("store");
        let session_id = seed_session(&store, temp.path().to_string_lossy().as_ref());
        let artifact_id = seed_diff_artifact(&store, &session_id);
        let operation = apply_operation(
            "op-apply",
            &ApplyPatchArgs {
                artifact_id: Some(artifact_id),
                patch_ref: None,
            },
        );
        let pending = apply_patch_tool_result(
            &store,
            &session_id,
            "turn-model",
            &tool_context(&temp),
            &operation,
            PermissionMode::Sandbox,
        );
        let approval_ticket_id = pending.metadata.as_ref().unwrap()["approvalTicketId"]
            .as_str()
            .unwrap()
            .to_string();
        resolve_agent_approval(AgentResolveApprovalRequest {
            storage: storage_request(&storage_root),
            session_id: session_id.clone(),
            approval_ticket_id: approval_ticket_id.clone(),
            decision: ApprovalDecision::Deny,
        })
        .expect("deny");

        let repeated = resolve_agent_approval(AgentResolveApprovalRequest {
            storage: storage_request(&storage_root),
            session_id,
            approval_ticket_id,
            decision: ApprovalDecision::Approve,
        })
        .expect_err("non-pending");
        assert_eq!(
            tool_error_code(&repeated, TOOL_PATCH_INVALID),
            TOOL_APPROVAL_NOT_PENDING
        );
    }

    #[test]
    fn rollback_restores_modified_file_and_rejects_repeated_rollback() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(temp.path().join("README.md"), "old\n").expect("readme");
        let storage_root = temp.path().join("ai").to_string_lossy().to_string();
        let store = AiStore::open(Some(storage_root.as_str())).expect("store");
        let session_id = seed_session(&store, temp.path().to_string_lossy().as_ref());
        let artifact_id = seed_diff_artifact(&store, &session_id);
        let applied = apply_agent_patch(AgentApplyPatchRequest {
            storage: storage_request(&storage_root),
            session_id: session_id.clone(),
            artifact_id: Some(artifact_id),
            patch_ref: None,
            permission_mode: None,
        })
        .expect("apply");

        let rollback = rollback_patch_tool_result(
            &store,
            &session_id,
            "turn-rollback",
            &tool_context(&temp),
            &rollback_operation(&applied.artifact_id),
            PermissionMode::FullAccess,
        );

        assert_eq!(rollback.status, ToolResultStatus::Completed);
        assert_eq!(
            fs::read_to_string(temp.path().join("README.md")).unwrap(),
            "old\n"
        );
        assert_eq!(
            store
                .read_patch_artifact_record(&session_id, &applied.artifact_id)
                .expect("artifact")
                .expect("artifact")
                .status,
            "rolled_back"
        );
        let repeated = rollback_patch_tool_result(
            &store,
            &session_id,
            "turn-rollback",
            &tool_context(&temp),
            &rollback_operation(&applied.artifact_id),
            PermissionMode::FullAccess,
        );
        assert_eq!(
            repeated.error_code.as_deref(),
            Some(TOOL_PATCH_ALREADY_ROLLED_BACK)
        );
    }

    #[test]
    fn rollback_removes_created_file_and_rejects_drift() {
        let temp = tempfile::tempdir().expect("tempdir");
        let storage_root = temp.path().join("ai").to_string_lossy().to_string();
        let store = AiStore::open(Some(storage_root.as_str())).expect("store");
        let session_id = seed_session(&store, temp.path().to_string_lossy().as_ref());
        let created_artifact = seed_diff_artifact_with_patch(
            &store,
            &session_id,
            "--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+hello\n",
            json!([{
                "path": "new.txt",
                "changeType": "created",
                "additions": 1,
                "deletions": 0
            }]),
        );
        let created = apply_agent_patch(AgentApplyPatchRequest {
            storage: storage_request(&storage_root),
            session_id: session_id.clone(),
            artifact_id: Some(created_artifact),
            patch_ref: None,
            permission_mode: None,
        })
        .expect("apply created");
        assert!(temp.path().join("new.txt").exists());
        let rollback_created = rollback_patch_tool_result(
            &store,
            &session_id,
            "turn-rollback",
            &tool_context(&temp),
            &rollback_operation(&created.artifact_id),
            PermissionMode::FullAccess,
        );
        assert_eq!(rollback_created.status, ToolResultStatus::Completed);
        assert!(temp.path().join("new.txt").exists() == false);

        fs::write(temp.path().join("README.md"), "old\n").expect("readme");
        let drift_artifact = seed_diff_artifact(&store, &session_id);
        let drift_applied = apply_agent_patch(AgentApplyPatchRequest {
            storage: storage_request(&storage_root),
            session_id: session_id.clone(),
            artifact_id: Some(drift_artifact),
            patch_ref: None,
            permission_mode: None,
        })
        .expect("apply drift");
        fs::write(temp.path().join("README.md"), "drift\n").expect("drift");
        let drift = rollback_patch_tool_result(
            &store,
            &session_id,
            "turn-rollback",
            &tool_context(&temp),
            &rollback_operation(&drift_applied.artifact_id),
            PermissionMode::FullAccess,
        );
        assert_eq!(drift.status, ToolResultStatus::Failed);
        assert_eq!(drift.error_code.as_deref(), Some(TOOL_ROLLBACK_UNSAFE));
        assert_eq!(
            fs::read_to_string(temp.path().join("README.md")).unwrap(),
            "drift\n"
        );
    }

    #[test]
    fn resolve_approval_approve_pending_rollback_reuses_ticket_and_restores() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(temp.path().join("README.md"), "old\n").expect("readme");
        let storage_root = temp.path().join("ai").to_string_lossy().to_string();
        let store = AiStore::open(Some(storage_root.as_str())).expect("store");
        let session_id = seed_session(&store, temp.path().to_string_lossy().as_ref());
        let artifact_id = seed_diff_artifact(&store, &session_id);
        let applied = apply_agent_patch(AgentApplyPatchRequest {
            storage: storage_request(&storage_root),
            session_id: session_id.clone(),
            artifact_id: Some(artifact_id),
            patch_ref: None,
            permission_mode: None,
        })
        .expect("apply");
        let operation = rollback_operation(&applied.artifact_id);
        let pending = rollback_patch_tool_result(
            &store,
            &session_id,
            "turn-model",
            &tool_context(&temp),
            &operation,
            PermissionMode::Sandbox,
        );
        let approval_ticket_id = pending.metadata.as_ref().unwrap()["approvalTicketId"]
            .as_str()
            .unwrap()
            .to_string();

        let result = resolve_agent_approval(AgentResolveApprovalRequest {
            storage: storage_request(&storage_root),
            session_id: session_id.clone(),
            approval_ticket_id: approval_ticket_id.clone(),
            decision: ApprovalDecision::Approve,
        })
        .expect("approve rollback");

        assert_eq!(result.status, "approved");
        assert_eq!(result.approval_ticket_id, approval_ticket_id);
        assert_eq!(
            fs::read_to_string(temp.path().join("README.md")).unwrap(),
            "old\n"
        );
        assert_eq!(
            store
                .read_patch_artifact_record(&session_id, &applied.artifact_id)
                .expect("artifact")
                .expect("artifact")
                .status,
            "rolled_back"
        );
    }

    #[test]
    fn resolve_approval_deny_pending_rollback_blocks_same_source_retry() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(temp.path().join("README.md"), "old\n").expect("readme");
        let storage_root = temp.path().join("ai").to_string_lossy().to_string();
        let store = AiStore::open(Some(storage_root.as_str())).expect("store");
        let session_id = seed_session(&store, temp.path().to_string_lossy().as_ref());
        let artifact_id = seed_diff_artifact(&store, &session_id);
        let applied = apply_agent_patch(AgentApplyPatchRequest {
            storage: storage_request(&storage_root),
            session_id: session_id.clone(),
            artifact_id: Some(artifact_id),
            patch_ref: None,
            permission_mode: None,
        })
        .expect("apply");
        let operation = rollback_operation(&applied.artifact_id);
        let pending = rollback_patch_tool_result(
            &store,
            &session_id,
            "turn-model",
            &tool_context(&temp),
            &operation,
            PermissionMode::Sandbox,
        );
        let approval_ticket_id = pending.metadata.as_ref().unwrap()["approvalTicketId"]
            .as_str()
            .unwrap()
            .to_string();
        resolve_agent_approval(AgentResolveApprovalRequest {
            storage: storage_request(&storage_root),
            session_id: session_id.clone(),
            approval_ticket_id,
            decision: ApprovalDecision::Deny,
        })
        .expect("deny rollback");

        assert_eq!(
            fs::read_to_string(temp.path().join("README.md")).unwrap(),
            "new\n"
        );
        let retry = rollback_patch_tool_result(
            &store,
            &session_id,
            "turn-model",
            &tool_context(&temp),
            &operation,
            PermissionMode::Sandbox,
        );
        assert_eq!(retry.error_code.as_deref(), Some(TOOL_APPROVAL_DENIED));
    }

    #[test]
    fn apply_patch_rejects_boundary_and_patch_integrity_failures() {
        let temp = tempfile::tempdir().expect("tempdir");
        let storage_root = temp.path().join("ai").to_string_lossy().to_string();
        let store = AiStore::open(Some(storage_root.as_str())).expect("store");
        let session_id = seed_session(&store, temp.path().to_string_lossy().as_ref());

        let outside = seed_diff_artifact_with_patch(
            &store,
            &session_id,
            "--- /dev/null\n+++ b/../outside.txt\n@@ -0,0 +1 @@\n+outside\n",
            json!([{
                "path": "../outside.txt",
                "changeType": "created",
                "additions": 1,
                "deletions": 0
            }]),
        );
        let error = apply_agent_patch(AgentApplyPatchRequest {
            storage: storage_request(&storage_root),
            session_id: session_id.clone(),
            artifact_id: Some(outside),
            patch_ref: None,
            permission_mode: None,
        })
        .expect_err("outside path should fail");
        assert_eq!(
            tool_error_code(&error, TOOL_PATCH_INVALID),
            TOOL_PATH_OUTSIDE_WORKSPACE
        );

        fs::write(temp.path().join("README.md"), "old\n").expect("readme");
        let deleted = seed_diff_artifact_with_patch(
            &store,
            &session_id,
            "--- a/README.md\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n",
            json!([{
                "path": "README.md",
                "changeType": "deleted",
                "additions": 0,
                "deletions": 1
            }]),
        );
        let error = apply_agent_patch(AgentApplyPatchRequest {
            storage: storage_request(&storage_root),
            session_id: session_id.clone(),
            artifact_id: Some(deleted),
            patch_ref: None,
            permission_mode: None,
        })
        .expect_err("delete patch should fail");
        assert_eq!(
            tool_error_code(&error, TOOL_PATCH_INVALID),
            TOOL_PATCH_INVALID
        );

        let created_existing = seed_diff_artifact_with_patch(
            &store,
            &session_id,
            "--- /dev/null\n+++ b/README.md\n@@ -0,0 +1 @@\n+new\n",
            json!([{
                "path": "README.md",
                "changeType": "created",
                "additions": 1,
                "deletions": 0
            }]),
        );
        assert!(apply_agent_patch(AgentApplyPatchRequest {
            storage: storage_request(&storage_root),
            session_id: session_id.clone(),
            artifact_id: Some(created_existing),
            patch_ref: None,
            permission_mode: None,
        })
        .expect_err("created existing should fail")
        .to_string()
        .contains("created file already exists"));

        let mismatch = seed_diff_artifact_with_patch(
            &store,
            &session_id,
            "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-missing\n+new\n",
            json!([{
                "path": "README.md",
                "changeType": "modified",
                "additions": 1,
                "deletions": 1
            }]),
        );
        assert!(apply_agent_patch(AgentApplyPatchRequest {
            storage: storage_request(&storage_root),
            session_id: session_id.clone(),
            artifact_id: Some(mismatch),
            patch_ref: None,
            permission_mode: None,
        })
        .expect_err("hunk mismatch should fail")
        .to_string()
        .contains("patch hunk does not match"));

        fs::write(temp.path().join("binary.txt"), [0xff, 0xfe]).expect("binary");
        let binary = seed_diff_artifact_with_patch(
            &store,
            &session_id,
            "--- a/binary.txt\n+++ b/binary.txt\n@@ -1 +1 @@\n-old\n+new\n",
            json!([{
                "path": "binary.txt",
                "changeType": "modified",
                "additions": 1,
                "deletions": 1
            }]),
        );
        let error = apply_agent_patch(AgentApplyPatchRequest {
            storage: storage_request(&storage_root),
            session_id: session_id.clone(),
            artifact_id: Some(binary),
            patch_ref: None,
            permission_mode: None,
        })
        .expect_err("non UTF-8 should fail");
        assert_eq!(
            tool_error_code(&error, TOOL_PATCH_INVALID),
            TOOL_UNSUPPORTED_ENCODING
        );

        assert!(apply_agent_patch(AgentApplyPatchRequest {
            storage: storage_request(&storage_root),
            session_id: session_id.clone(),
            artifact_id: Some("artifact_missing".to_string()),
            patch_ref: None,
            permission_mode: None,
        })
        .expect_err("missing artifact should fail")
        .to_string()
        .contains("AI diff artifact not found"));
        assert!(apply_agent_patch(AgentApplyPatchRequest {
            storage: storage_request(&storage_root),
            session_id: session_id.clone(),
            artifact_id: None,
            patch_ref: Some("tool_result_missing".to_string()),
            permission_mode: None,
        })
        .expect_err("orphan patchRef should fail")
        .to_string()
        .contains("AI diff artifact not found"));

        let other_session = seed_session(&store, temp.path().to_string_lossy().as_ref());
        let cross_session_artifact = seed_diff_artifact(&store, &other_session);
        assert!(apply_agent_patch(AgentApplyPatchRequest {
            storage: storage_request(&storage_root),
            session_id,
            artifact_id: Some(cross_session_artifact),
            patch_ref: None,
            permission_mode: None,
        })
        .expect_err("cross-session artifact should fail")
        .to_string()
        .contains("AI diff artifact not found"));
    }
}
