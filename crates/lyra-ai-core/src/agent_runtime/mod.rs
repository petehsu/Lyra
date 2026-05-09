use crate::config::{resolve_profile_id, runtime_config_for_profile};
use crate::events::emit_event;
use crate::model_gateway::{
    stream_completion_with_tools_retrying, ChatMessage, ChatResponse, ProviderRuntimeConfig,
    ToolCall, ToolDefinition, Usage,
};
use crate::patch_apply::{
    apply_patch_tool_result, normalize_execution_target, normalize_permission_mode,
    rollback_patch_tool_result, ExecutionTarget, PermissionMode,
};
use crate::prompt::{compose_messages, PromptContext};
use crate::security_gate::{
    record_tool_decision, redact_model_messages_for_turn, redact_tool_result_if_needed,
    security_event_payload, SECURITY_RESOURCE_DENIED,
};
use crate::storage::{
    new_id, now_iso, now_ms, project_name_from_root, trim_to_string, AgentLongWorkSummary,
    AgentMessage, AgentMessageContentPart, AgentSession, AgentSessionDetail, AgentTurn, AiStore,
    CreateTodoItemInput, MemoryArchiveItem, StorageRequest, TodoUpdateRecord, ToolResultBlobMeta,
};
use crate::tool_runtime::catalog::{
    TOOL_FS_APPLY_PATCH, TOOL_FS_LIST_FILES, TOOL_FS_PROPOSE_PATCH, TOOL_FS_READ_FILE,
    TOOL_FS_READ_RANGE, TOOL_FS_ROLLBACK_PATCH, TOOL_FS_SEARCH_FILES, TOOL_FS_SEARCH_TEXT,
    TOOL_FS_STAT_PATH, TOOL_GIT_DIFF, TOOL_GIT_STATUS, TOOL_MEMORY_ASSEMBLE_CONTEXT,
    TOOL_MEMORY_AUDIT_MEMORY, TOOL_MEMORY_CREATE_CONFLICT_CANDIDATE,
    TOOL_MEMORY_GET_CONTEXT_SNAPSHOT, TOOL_MEMORY_PROPOSE_MEMORY, TOOL_MEMORY_SEARCH_FROZEN,
    TOOL_MEMORY_SEARCH_SESSION, TOOL_MEMORY_SEARCH_SHARED, TOOL_MEMORY_UPDATE_MEMORY, TOOL_SEARCH,
    TOOL_SHELL_RUN_COMMAND,
};
use crate::tool_runtime::shell;
use crate::tool_runtime::{
    execute_tool, inspect_required_result, normalized_tool_path, parse_tool_operation,
    tool_error_code, tool_event_metadata, tool_result_chat_message, ToolExecutionContext, ToolFsOp,
    ToolOperationEnvelope, ToolOperationParseError, ToolResultEnvelope, ToolResultStatus,
    TOOL_INVALID_ARGUMENT, TOOL_OPERATION_KIND, TOOL_SCHEMA_VERSION,
};
use crate::tools::{
    built_in_tool_definitions, mcp_tool_definitions, mcp_tool_operation_path, resolve_mcp_tool_ref,
    run_registered_tool, workspace_write_paths_for_tool, ToolContext, ToolPermissionDecision,
    ToolPermissionPolicy, ToolPermissionRuleSet, ALL_TOOL_NAMES,
};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;

mod types;
pub use types::*;

mod input;
use input::{
    input_parts, mini_todo_items_for_request, normalize_collaboration_mode, title_after_message,
    title_from_text,
};

mod events;
use events::{
    delivery_gate_response, emit_completion_projection_events, emit_runtime_state,
    emit_store_event, emit_tool_event, emit_verification_projection_events, tool_operation_payload,
    tool_result_payload,
};

mod todo_projection;
use todo_projection::record_todo_from_tool_result;

mod intent_classifier;
use intent_classifier::prepare_runtime_intake;
mod intent_projection;
use intent_projection::project_intake_prompt_value;
mod clarification_gate;
mod reference_resolution;
#[cfg(test)]
pub(crate) use clarification_gate::resolve_clarification;
pub use clarification_gate::submit_clarification_response;
mod clarification_projection;
use clarification_projection::{
    answered_clarification_tool_result_message, clarification_resume_context_message,
    has_answered_blocking_clarification_for_turn, project_clarification_prompt_value,
};
mod prompt_repetition;
use prompt_repetition::apply_prompt_repetition;
mod memory_pipeline;

mod follow_controller;
use follow_controller::{ensure_follow_for_long_work, ensure_follow_for_turn};
pub use follow_controller::{pause_follow, read_follow, resume_follow};
mod follow_live_edit;
pub use follow_live_edit::{
    append_follow_live_edit, commit_follow_live_edit, discard_follow_live_edit,
    start_follow_live_edit,
};
mod follow_projection;
pub(crate) use follow_projection::{
    project_follow_operation_finished, project_follow_operation_started,
};

mod recovery_controller;
pub(crate) use recovery_controller::ensure_recovery_anchor_for_write;
use recovery_controller::ensure_recovery_checkpoint_for_turn;
pub use recovery_controller::{preview_message_rollback, read_rollback_preview, rollback_to_turn};
mod recovery_execution;
pub use recovery_execution::execute_message_rollback;
mod recovery_projection;
use crate::security_gate::projection::project_security_prompt_value;
pub(crate) use recovery_projection::project_recovery_side_effect;

mod long_work_controller;
mod long_work_projection;
use long_work_projection::{create_mini_run_after_todo, create_plan_run_after_valid_coverage};
pub(crate) use long_work_projection::{
    project_work_after_completion, project_work_after_model_candidate,
    project_work_after_tool_result,
};
#[allow(unused_imports)]
pub(crate) use long_work_projection::{recover_work_continuation, resume_work_continuation};

mod session_ops;
use session_ops::ensure_session;
pub use session_ops::{
    create_plan, create_session, create_todo, list_sessions, read_session, resolve_plan_review,
    update_session,
};

mod turn_loop;
pub use turn_loop::{cancel_turn, send_turn};
#[cfg(test)]
mod policy_security_tests;
#[cfg(test)]
use turn_loop::{run_tool_operation, run_turn_worker_inner};

#[cfg(test)]
mod follow_live_edit_tests;
#[cfg(test)]
mod follow_tests;
#[cfg(test)]
mod intake_tests;
#[cfg(test)]
mod long_work_tests;
#[cfg(test)]
mod recovery_tests;
#[cfg(test)]
mod tests;
