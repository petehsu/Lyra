use crate::config::{resolve_profile_id, runtime_config_for_profile};
use crate::events::emit_event;
use crate::model_gateway::{
    generate_response, ChatMessage, ModelResponse, ProviderRuntimeConfig, Usage,
};
use crate::patch_apply::{
    apply_patch_tool_result, normalize_permission_mode, rollback_patch_tool_result, PermissionMode,
};
use crate::project_manifest::read_project_policy_snapshot;
use crate::prompt::{compose_messages, PromptContext};
use crate::storage::{
    new_id, now_ms, project_name_from_root, trim_to_string, AgentMessage, AgentMessageContentPart,
    AgentSession, AgentSessionDetail, AgentTurn, AiStore, CreateTodoItemInput, StorageRequest,
    TodoUpdateRecord, ToolResultBlobMeta,
};
use crate::tool_runtime::catalog::{
    TOOL_FS_APPLY_PATCH, TOOL_FS_LIST_FILES, TOOL_FS_PROPOSE_PATCH, TOOL_FS_READ_FILE,
    TOOL_FS_ROLLBACK_PATCH, TOOL_FS_SEARCH_TEXT, TOOL_SHELL_RUN_COMMAND,
};
use crate::tool_runtime::shell;
use crate::tool_runtime::{
    execute_tool, inspect_required_result, normalized_tool_path, parse_tool_operation,
    tool_event_metadata, tool_result_chat_message, ToolExecutionContext, ToolFsOp,
    ToolOperationEnvelope, ToolResultEnvelope, ToolResultStatus,
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
use turn_loop::{run_tool_operation, run_turn_worker_inner};

#[cfg(test)]
mod long_work_tests;
#[cfg(test)]
mod tests;
