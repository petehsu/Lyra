use crate::events::emit_event;
use crate::storage::{
    json_string, new_id, sha256_hex, trim_to_string, AiStore, DiffArtifactBlobRecord,
    PatchFileBackupRecord, PatchFileBackupRef, StorageRequest, TodoUpdateRecord,
};
use crate::tool_runtime::catalog::{
    parse_args, ApplyPatchArgs, RollbackPatchArgs, TOOL_FS_APPLY_PATCH, TOOL_FS_ROLLBACK_PATCH,
    TOOL_SHELL_RUN_COMMAND,
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
use crate::tool_runtime::shell;
use crate::tool_runtime::{tool_result_chat_message, ToolExecutionContext};
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

mod types;
use types::*;
pub use types::{
    normalize_permission_mode, AgentApplyPatchRequest, AgentApplyPatchResult,
    AgentResolveApprovalRequest, AgentResolveApprovalResult, ApprovalDecision, PermissionMode,
};

mod events;
use events::{
    append_result_and_emit_event, emit_apply_event, emit_approval_resolved_event,
    emit_completion_projection_events, emit_verification_projection_events, operation_payload,
    record_todo_from_patch_result, result_payload,
};

mod apply;
use apply::{
    applied_content, applied_metadata, apply_operation, execute_prepared_apply, prepare_patch_apply,
};
pub use apply::{apply_agent_patch, apply_patch_tool_result};

mod rollback;
pub use rollback::rollback_patch_tool_result;
use rollback::{
    execute_prepared_rollback, prepare_patch_rollback, rollback_content, rollback_metadata,
    rollback_operation_for_args,
};

mod approval;
pub use approval::resolve_agent_approval;

#[cfg(test)]
mod tests;
