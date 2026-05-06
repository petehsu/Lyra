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
    TOOL_FS_ROLLBACK_PATCH, TOOL_FS_SEARCH_TEXT,
};
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

static ACTIVE_TURNS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
const MAX_TOOL_STEPS: usize = 6;

fn active_turns() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    ACTIVE_TURNS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSessionsRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub profile_id: Option<String>,
    #[serde(default)]
    pub project_root: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub collaboration_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadSessionRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    pub session_id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub project_root: Option<String>,
    #[serde(default)]
    pub collaboration_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendTurnRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    #[serde(default)]
    pub session_id: Option<String>,
    pub input: RuntimeTurnInput,
    #[serde(default)]
    pub options: RuntimeThreadOptions,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelTurnRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    pub session_id: String,
    pub turn_id: String,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeThreadOptions {
    #[serde(default)]
    pub profile_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub model_provider: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub collaboration_mode: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default)]
    pub verbosity: Option<String>,
    #[serde(default)]
    pub approval_policy: Option<String>,
    #[serde(default)]
    pub permission_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTurnInput {
    pub text: String,
    #[serde(default)]
    pub attachments: Vec<RuntimeTurnAttachment>,
    #[serde(default)]
    pub parts: Vec<RuntimeTurnInputPart>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTurnAttachment {
    pub name: String,
    pub path: String,
    pub kind: String,
    #[serde(default)]
    pub context_text: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RuntimeTurnInputPart {
    Text { text: String },
    Attachment { attachment: RuntimeTurnAttachment },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendTurnResult {
    pub session_id: String,
    pub turn_id: String,
    pub detail: AgentSessionDetail,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelTurnResult {
    pub session_id: String,
    pub turn_id: String,
    pub cancelled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCreateTodoRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    pub session_id: String,
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub source: Option<Value>,
    pub items: Vec<CreateTodoItemInput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCreateTodoResult {
    pub session_id: String,
    pub todo_list_id: String,
    pub execution_run_id: String,
    pub detail: AgentSessionDetail,
}

pub fn list_sessions(request: ListSessionsRequest) -> Result<Vec<AgentSession>> {
    AiStore::open(request.storage.storage_root.as_deref())?.list_sessions()
}

pub fn create_session(request: CreateSessionRequest) -> Result<AgentSessionDetail> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    let profile_id = resolve_profile_id(&store, request.profile_id.as_deref()).ok();
    let project_root = request
        .project_root
        .as_deref()
        .and_then(trim_to_string)
        .or_else(|| request.cwd.as_deref().and_then(trim_to_string));
    let now = now_ms();
    let session = AgentSession {
        id: new_id("session"),
        title: request
            .title
            .as_deref()
            .and_then(trim_to_string)
            .unwrap_or_else(|| "New thread".to_string()),
        profile_id,
        project_name: project_name_from_root(project_root.as_deref()),
        project_root,
        collaboration_mode: normalize_collaboration_mode(request.collaboration_mode.as_deref()),
        created_at: now,
        updated_at: now,
    };
    store.upsert_session_index(&session)?;
    store.with_session_conn(&session.id, |_| Ok(()))?;
    let detail = store
        .read_session_detail(&session.id)?
        .ok_or_else(|| anyhow!("created AI session could not be read"))?;
    emit_store_event(
        &store,
        &session.id,
        None,
        "session_updated",
        json!({ "detail": detail }),
    )?;
    store
        .read_session_detail(&session.id)?
        .ok_or_else(|| anyhow!("created AI session could not be read"))
}

pub fn read_session(request: ReadSessionRequest) -> Result<AgentSessionDetail> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    store
        .read_session_detail(&request.session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {}", request.session_id))
}

pub fn update_session(request: UpdateSessionRequest) -> Result<AgentSessionDetail> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    let mut session = store
        .read_session_index(&request.session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {}", request.session_id))?;
    if let Some(title) = request.title.as_deref().and_then(trim_to_string) {
        session.title = title;
    }
    if request.project_root.is_some() {
        session.project_root = request.project_root.as_deref().and_then(trim_to_string);
        session.project_name = project_name_from_root(session.project_root.as_deref());
    }
    if let Some(mode) = request.collaboration_mode.as_deref() {
        session.collaboration_mode = normalize_collaboration_mode(Some(mode));
    }
    session.updated_at = now_ms();
    store.upsert_session_index(&session)?;
    let detail = store
        .read_session_detail(&session.id)?
        .ok_or_else(|| anyhow!("AI session not found: {}", session.id))?;
    emit_store_event(
        &store,
        &session.id,
        None,
        "session_updated",
        json!({ "detail": detail }),
    )?;
    store
        .read_session_detail(&session.id)?
        .ok_or_else(|| anyhow!("AI session not found: {}", session.id))
}

pub fn create_todo(request: AgentCreateTodoRequest) -> Result<AgentCreateTodoResult> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    let session_id = request.session_id.trim().to_string();
    if session_id.is_empty() {
        return Err(anyhow!("sessionId is required"));
    }
    store
        .read_session_index(&session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {session_id}"))?;
    let title = request.title.trim();
    if title.is_empty() {
        return Err(anyhow!("todo title is required"));
    }
    let source = request
        .source
        .unwrap_or_else(|| json!({ "type": "manual" }));
    let refs = store.create_execution_todo_list(
        &session_id,
        None,
        &request.kind,
        title,
        source,
        &request.items,
    )?;
    emit_store_event(
        &store,
        &session_id,
        None,
        "todo_list_created",
        json!({
            "sessionId": session_id,
            "todoListId": refs.todo_list_id,
            "executionRunId": refs.execution_run_id,
            "kind": request.kind,
            "title": title
        }),
    )?;
    let detail = store
        .read_session_detail(&session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {session_id}"))?;
    emit_store_event(
        &store,
        &session_id,
        None,
        "session_updated",
        json!({ "detail": detail }),
    )?;
    let detail = store
        .read_session_detail(&session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {session_id}"))?;
    Ok(AgentCreateTodoResult {
        session_id,
        todo_list_id: refs.todo_list_id,
        execution_run_id: refs.execution_run_id,
        detail,
    })
}

pub fn send_turn(request: SendTurnRequest) -> Result<SendTurnResult> {
    let storage_root = request.storage.storage_root.clone();
    let store = AiStore::open(storage_root.as_deref())?;
    let session = ensure_session(
        &store,
        request.session_id.as_deref(),
        &request.options,
        &request.input,
    )?;
    let profile_id = resolve_profile_id(
        &store,
        request
            .options
            .profile_id
            .as_deref()
            .or(session.profile_id.as_deref()),
    )?;
    let now = now_ms();
    let user_message_id = new_id("msg");
    let turn_id = new_id("turn");
    let permission_mode = normalize_permission_mode(
        request.options.permission_mode.as_deref(),
        request.options.approval_policy.as_deref(),
    );
    let text = request.input.text.trim().to_string();
    let parts = input_parts(&request.input);
    let user_message = AgentMessage {
        id: user_message_id.clone(),
        session_id: session.id.clone(),
        turn_id: Some(turn_id.clone()),
        role: "user".to_string(),
        content: text.clone(),
        content_parts: if parts.is_empty() { None } else { Some(parts) },
        display_content: Some(text.clone()),
        created_at: now,
    };
    store.append_message(&user_message)?;
    let policy_snapshot = read_project_policy_snapshot(session.project_root.as_deref());
    let turn = AgentTurn {
        id: turn_id.clone(),
        session_id: session.id.clone(),
        profile_id: profile_id.clone(),
        status: "running".to_string(),
        collaboration_mode: Some(normalize_collaboration_mode(
            request.options.collaboration_mode.as_deref(),
        )),
        permission_mode: permission_mode.as_str().to_string(),
        error_code: None,
        error_message: None,
        usage: None,
        created_at: now,
        updated_at: now,
    };
    store.insert_turn(
        &turn,
        &user_message_id,
        policy_snapshot
            .as_ref()
            .map(|snapshot| snapshot.snapshot_id.as_str()),
    )?;
    let checkpoint_id =
        store.create_timeline_checkpoint(&session.id, &turn_id, &user_message_id)?;
    if let Some(items) = mini_todo_items_for_request(&text) {
        let refs = store.create_execution_todo_list(
            &session.id,
            Some(&turn_id),
            "mini",
            "Execution checklist",
            json!({
                "type": "mini_auto",
                "userMessageId": user_message_id,
                "runtimeTurnId": turn_id,
                "heuristic": "execution_request_v1"
            }),
            &items,
        )?;
        emit_store_event(
            &store,
            &session.id,
            Some(&turn_id),
            "todo_list_created",
            json!({
                "sessionId": session.id,
                "turnId": turn_id,
                "todoListId": refs.todo_list_id,
                "executionRunId": refs.execution_run_id,
                "kind": "mini",
                "title": "Execution checklist"
            }),
        )?;
    }
    let runtime_options_payload = json!({
        "model": request.options.model.as_deref(),
        "modelProvider": request.options.model_provider.as_deref(),
        "effort": request.options.effort.as_deref(),
        "verbosity": request.options.verbosity.as_deref(),
        "approvalPolicy": request.options.approval_policy.as_deref(),
        "permissionMode": permission_mode.as_str()
    });
    let mut updated_session = session.clone();
    updated_session.title = title_after_message(&updated_session.title, &text);
    updated_session.profile_id = Some(profile_id.clone());
    updated_session.updated_at = now;
    store.upsert_session_index(&updated_session)?;
    emit_store_event(
        &store,
        &updated_session.id,
        Some(&turn_id),
        "runtime_turn_created",
        json!({
            "turn": turn,
            "userMessage": user_message,
            "policySnapshot": policy_snapshot,
            "checkpointId": checkpoint_id,
            "runtimeOptions": runtime_options_payload
        }),
    )?;
    if let Some(detail) = store.read_session_detail(&updated_session.id)? {
        emit_store_event(
            &store,
            &updated_session.id,
            None,
            "session_updated",
            json!({ "detail": detail }),
        )?;
    }

    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut active) = active_turns().lock() {
        active.insert(turn_id.clone(), cancel.clone());
    }
    spawn_turn_worker(
        storage_root,
        updated_session.id.clone(),
        turn_id.clone(),
        profile_id,
        request.options.model.clone(),
        request.options.cwd.clone(),
        permission_mode,
        cancel,
    );
    let detail = store
        .read_session_detail(&updated_session.id)?
        .ok_or_else(|| anyhow!("AI session not found: {}", updated_session.id))?;
    Ok(SendTurnResult {
        session_id: updated_session.id,
        turn_id,
        detail,
    })
}

pub fn cancel_turn(request: CancelTurnRequest) -> Result<CancelTurnResult> {
    let cancelled = active_turns()
        .lock()
        .ok()
        .and_then(|active| active.get(&request.turn_id).cloned())
        .map(|flag| {
            flag.store(true, Ordering::Relaxed);
            true
        })
        .unwrap_or(false);
    if !cancelled {
        let store = AiStore::open(request.storage.storage_root.as_deref())?;
        store.update_turn_status(
            &request.session_id,
            &request.turn_id,
            "cancelled",
            "cancelled",
            None,
            None,
        )?;
        let detail = store.read_session_detail(&request.session_id)?;
        emit_store_event(
            &store,
            &request.session_id,
            Some(&request.turn_id),
            "runtime_turn_cancelled",
            json!({
                "turnId": request.turn_id,
                "detail": detail
            }),
        )?;
    }
    Ok(CancelTurnResult {
        session_id: request.session_id,
        turn_id: request.turn_id,
        cancelled,
    })
}

fn ensure_session(
    store: &AiStore,
    session_id: Option<&str>,
    options: &RuntimeThreadOptions,
    input: &RuntimeTurnInput,
) -> Result<AgentSession> {
    if let Some(session_id) = session_id.and_then(trim_to_string) {
        return store
            .read_session_index(&session_id)?
            .ok_or_else(|| anyhow!("AI session not found: {session_id}"));
    }
    let profile_id = resolve_profile_id(store, options.profile_id.as_deref()).ok();
    let now = now_ms();
    let project_root = options.cwd.as_deref().and_then(trim_to_string);
    let title = title_from_text(&input.text).unwrap_or_else(|| "New thread".to_string());
    let session = AgentSession {
        id: new_id("session"),
        title,
        profile_id,
        project_name: project_name_from_root(project_root.as_deref()),
        project_root,
        collaboration_mode: normalize_collaboration_mode(options.collaboration_mode.as_deref()),
        created_at: now,
        updated_at: now,
    };
    store.upsert_session_index(&session)?;
    store.with_session_conn(&session.id, |_| Ok(()))?;
    Ok(session)
}

fn spawn_turn_worker(
    storage_root: Option<String>,
    session_id: String,
    turn_id: String,
    profile_id: String,
    model_override: Option<String>,
    workspace_root_override: Option<String>,
    permission_mode: PermissionMode,
    cancel: Arc<AtomicBool>,
) {
    thread::spawn(move || {
        let result = run_turn_worker(
            storage_root.as_deref(),
            &session_id,
            &turn_id,
            &profile_id,
            model_override.as_deref(),
            workspace_root_override.as_deref(),
            permission_mode,
            cancel.clone(),
        );
        if let Err(error) = result {
            if let Ok(store) = AiStore::open(storage_root.as_deref()) {
                let is_cancelled = cancel.load(Ordering::Relaxed);
                let status = if is_cancelled { "cancelled" } else { "failed" };
                let event_type = if is_cancelled {
                    "runtime_turn_cancelled"
                } else {
                    "runtime_error"
                };
                let error_message = error.to_string();
                let _ = store.update_turn_status(
                    &session_id,
                    &turn_id,
                    status,
                    status,
                    if is_cancelled {
                        None
                    } else {
                        Some("MODEL_RUNTIME_FAILED")
                    },
                    if is_cancelled {
                        None
                    } else {
                        Some(error_message.as_str())
                    },
                );
                let detail = store.read_session_detail(&session_id).ok().flatten();
                let _ = emit_store_event(
                    &store,
                    &session_id,
                    Some(&turn_id),
                    event_type,
                    json!({
                        "turnId": turn_id,
                        "message": if is_cancelled { "Turn cancelled".to_string() } else { error_message },
                        "detail": detail
                    }),
                );
            }
        }
        if let Ok(mut active) = active_turns().lock() {
            active.remove(&turn_id);
        }
    });
}

fn run_turn_worker(
    storage_root: Option<&str>,
    session_id: &str,
    turn_id: &str,
    profile_id: &str,
    model_override: Option<&str>,
    workspace_root_override: Option<&str>,
    permission_mode: PermissionMode,
    cancel: Arc<AtomicBool>,
) -> Result<()> {
    let store = AiStore::open(storage_root)?;
    let config = runtime_config_for_profile(&store, profile_id, model_override)?;
    run_turn_worker_inner(
        &store,
        config,
        session_id,
        turn_id,
        workspace_root_override,
        permission_mode,
        cancel,
        invoke_model_buffered,
    )
}

fn run_turn_worker_inner(
    store: &AiStore,
    config: ProviderRuntimeConfig,
    session_id: &str,
    turn_id: &str,
    workspace_root_override: Option<&str>,
    permission_mode: PermissionMode,
    cancel: Arc<AtomicBool>,
    mut invoke_model: impl FnMut(
        ProviderRuntimeConfig,
        Vec<ChatMessage>,
        &AtomicBool,
    ) -> Result<ModelResponse>,
) -> Result<()> {
    let detail = store
        .read_session_detail(session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {session_id}"))?;
    let workspace_root = workspace_root_override
        .and_then(trim_to_string)
        .or_else(|| detail.session.project_root.clone());
    let history = detail
        .messages
        .iter()
        .filter(|message| message.role == "user" || message.role == "assistant")
        .map(|message| ChatMessage {
            role: message.role.clone(),
            content: message.content.clone(),
        })
        .collect::<Vec<_>>();
    let turn = detail.turns.iter().find(|turn| turn.id == turn_id);
    let collaboration_mode = turn
        .and_then(|turn| turn.collaboration_mode.as_deref())
        .map(|mode| normalize_collaboration_mode(Some(mode)))
        .unwrap_or_else(|| detail.session.collaboration_mode.clone());
    let project_policy_snapshot = read_project_policy_snapshot(workspace_root.as_deref());
    let denied_approval_summaries = store.read_recent_denied_approval_summaries(session_id, 5)?;
    let mut messages = compose_messages(
        PromptContext {
            collaboration_mode,
            workspace_root: workspace_root.clone(),
            project_policy_snapshot,
            read_only_tools_available: workspace_root.is_some(),
            permission_mode: permission_mode.as_str().to_string(),
            denied_approval_summaries,
        },
        history,
    );
    let mut assistant_text: String;
    let mut final_usage: Option<Usage>;
    let tool_context = ToolExecutionContext {
        workspace_root: workspace_root.clone(),
    };
    let mut inspected_tool_paths = HashSet::<String>::new();
    let mut tool_steps = 0_usize;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(anyhow!("turn cancelled"));
        }
        emit_runtime_state(store, session_id, turn_id, "model_invoking")?;
        let response = invoke_model(config.clone(), messages.clone(), &cancel)?;
        let model_text = response.text.trim().to_string();
        final_usage = response.usage;
        match parse_tool_operation(&model_text) {
            Ok(Some(operation)) => {
                if tool_steps >= MAX_TOOL_STEPS {
                    assistant_text = format!(
                        "I reached the read-only tool step limit ({MAX_TOOL_STEPS}) before producing a final answer. Please narrow the request or ask me to inspect fewer files."
                    );
                    break;
                }
                tool_steps += 1;
                run_tool_operation(
                    store,
                    session_id,
                    turn_id,
                    &tool_context,
                    &operation,
                    permission_mode,
                    &mut messages,
                    &mut inspected_tool_paths,
                )?;
            }
            Ok(None) | Err(_) => {
                assistant_text = model_text;
                break;
            }
        }
    }
    if cancel.load(Ordering::Relaxed) {
        return Err(anyhow!("turn cancelled"));
    }
    if assistant_text.trim().is_empty() {
        assistant_text =
            "I could not produce a final response from the model for this turn.".to_string();
    }
    emit_runtime_state(store, session_id, turn_id, "completion_evaluating")?;
    let text_event = store.append_event(
        session_id,
        Some(turn_id),
        "model_text_delta",
        json!({ "delta": assistant_text }),
    )?;
    emit_event(&text_event);
    let message_id =
        store.append_or_update_assistant_message(session_id, turn_id, &assistant_text)?;
    let assistant_message = AgentMessage {
        id: message_id,
        session_id: session_id.to_string(),
        turn_id: Some(turn_id.to_string()),
        role: "assistant".to_string(),
        content: assistant_text.clone(),
        content_parts: None,
        display_content: Some(assistant_text),
        created_at: now_ms(),
    };
    store.update_turn_status(session_id, turn_id, "completed", "completed", None, None)?;
    let detail = store.read_session_detail(session_id)?;
    emit_store_event(
        &store,
        session_id,
        Some(turn_id),
        "model_message_end",
        json!({
            "message": assistant_message,
            "usage": final_usage,
            "detail": detail
        }),
    )?;
    emit_store_event(
        &store,
        session_id,
        Some(turn_id),
        "runtime_turn_completed",
        json!({
            "turnId": turn_id,
            "detail": detail
        }),
    )?;
    if let Some(mut session) = store.read_session_index(session_id)? {
        session.updated_at = now_ms();
        store.upsert_session_index(&session)?;
    }
    if let Some(detail) = store.read_session_detail(session_id)? {
        emit_store_event(
            &store,
            session_id,
            None,
            "session_updated",
            json!({ "detail": detail }),
        )?;
    }
    Ok(())
}

fn invoke_model_buffered(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    cancel: &AtomicBool,
) -> Result<ModelResponse> {
    let mut streamed_text = String::new();
    let mut response = generate_response(config, messages, cancel, |delta| {
        streamed_text.push_str(delta);
        Ok(())
    })?;
    if streamed_text.is_empty() == false {
        response.text = streamed_text;
    }
    Ok(response)
}

fn run_tool_operation(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    permission_mode: PermissionMode,
    messages: &mut Vec<ChatMessage>,
    inspected_tool_paths: &mut HashSet<String>,
) -> Result<()> {
    emit_tool_event(
        store,
        session_id,
        turn_id,
        "tool_operation_requested",
        json!({
            "operation": tool_operation_payload(operation),
        }),
    )?;
    emit_runtime_state(store, session_id, turn_id, "tool_executing")?;
    emit_tool_event(
        store,
        session_id,
        turn_id,
        "tool_operation_started",
        json!({
            "operation": tool_operation_payload(operation),
        }),
    )?;
    let mut result = if operation.op == ToolFsOp::Run
        && inspected_tool_paths.contains(&normalized_tool_path(&operation.path)) == false
    {
        inspect_required_result(operation)
    } else if operation.op == ToolFsOp::Run
        && normalized_tool_path(&operation.path) == TOOL_FS_APPLY_PATCH
    {
        apply_patch_tool_result(
            store,
            session_id,
            turn_id,
            context,
            operation,
            permission_mode,
        )
    } else if operation.op == ToolFsOp::Run
        && normalized_tool_path(&operation.path) == TOOL_FS_ROLLBACK_PATCH
    {
        rollback_patch_tool_result(
            store,
            session_id,
            turn_id,
            context,
            operation,
            permission_mode,
        )
    } else {
        execute_tool(context, operation)
    };
    if operation.op == ToolFsOp::Inspect && result.status == ToolResultStatus::Completed {
        inspected_tool_paths.insert(normalized_tool_path(&operation.path));
    }
    let result_blob = store.append_tool_result_blob(
        session_id,
        turn_id,
        &result.op_id,
        &result.path,
        tool_result_status_str(&result.status),
        &result.content,
    )?;
    result.result_ref = Some(result_blob.result_ref.clone());
    enrich_tool_result_metadata(store, session_id, turn_id, &mut result, &result_blob)?;
    let event_type = if result.status == ToolResultStatus::Completed {
        "tool_operation_completed"
    } else {
        "tool_operation_failed"
    };
    emit_tool_event(
        store,
        session_id,
        turn_id,
        event_type,
        json!({
            "operation": tool_operation_payload(operation),
            "result": tool_result_payload(&result, &result_blob),
        }),
    )?;
    record_todo_from_tool_result(store, session_id, turn_id, operation, &result)?;
    messages.push(ChatMessage {
        role: "assistant".to_string(),
        content: serde_json::to_string(operation)?,
    });
    messages.push(ChatMessage {
        role: "user".to_string(),
        content: tool_result_chat_message(&result)?,
    });
    Ok(())
}

fn emit_runtime_state(store: &AiStore, session_id: &str, turn_id: &str, state: &str) -> Result<()> {
    store.update_turn_status(session_id, turn_id, "running", state, None, None)?;
    emit_store_event(
        store,
        session_id,
        Some(turn_id),
        "runtime_state_changed",
        json!({
            "turnId": turn_id,
            "state": state
        }),
    )
}

fn emit_tool_event(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    event_type: &str,
    payload: Value,
) -> Result<()> {
    emit_store_event(store, session_id, Some(turn_id), event_type, payload)
}

fn tool_operation_payload(operation: &ToolOperationEnvelope) -> Value {
    let mut payload = tool_event_metadata(operation);
    if let Some(object) = payload.as_object_mut() {
        object.insert(
            "schemaVersion".to_string(),
            Value::String(operation.schema_version.clone()),
        );
        object.insert("opId".to_string(), Value::String(operation.op_id.clone()));
    }
    payload
}

fn tool_result_payload(result: &ToolResultEnvelope, blob: &ToolResultBlobMeta) -> Value {
    let mut payload = json!({
        "schemaVersion": result.schema_version,
        "opId": result.op_id,
        "op": result.op,
        "path": result.path,
        "resultRef": blob.result_ref,
        "status": result.status,
        "summary": result.summary,
        "contentPreview": blob.content_preview,
        "contentBytes": blob.content_bytes,
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

fn record_todo_from_tool_result(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    operation: &ToolOperationEnvelope,
    result: &ToolResultEnvelope,
) -> Result<()> {
    let tool_path = normalized_tool_path(&operation.path);
    let Some((item_status, step_status, blocker)) =
        todo_status_from_tool_result(&tool_path, result)
    else {
        return Ok(());
    };
    let metadata = result.metadata.as_ref().unwrap_or(&Value::Null);
    let mut evidence_refs = collect_string_metadata_refs(metadata, &["evidenceId"]);
    let artifact_refs =
        collect_string_metadata_refs(metadata, &["artifactId", "rolledBackArtifactId"]);
    if let Some(evidence_id) = metadata.get("evidenceId").and_then(Value::as_str) {
        if evidence_refs.iter().any(|value| value == evidence_id) == false {
            evidence_refs.push(evidence_id.to_string());
        }
    }
    let Some(record) = store.record_tool_execution_step(
        session_id,
        turn_id,
        &tool_path,
        &operation.op_id,
        item_status,
        step_status,
        evidence_refs,
        artifact_refs,
        blocker,
    )?
    else {
        return Ok(());
    };
    emit_todo_update_events(store, session_id, Some(turn_id), &record)
}

fn todo_status_from_tool_result(
    tool_path: &str,
    result: &ToolResultEnvelope,
) -> Option<(&'static str, &'static str, Value)> {
    match result.status {
        ToolResultStatus::Completed => Some(("completed", "completed", Value::Null)),
        ToolResultStatus::Failed => match result.error_code.as_deref() {
            Some("TOOL_APPROVAL_REQUIRED") => Some((
                "blocked",
                "blocked",
                json!({
                    "kind": "approval_required",
                    "toolPath": tool_path,
                    "approvalTicketId": result
                        .metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("approvalTicketId"))
                        .cloned()
                        .unwrap_or(Value::Null),
                    "artifactId": result
                        .metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("artifactId"))
                        .cloned()
                        .unwrap_or(Value::Null),
                    "patchRef": result
                        .metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("patchRef"))
                        .cloned()
                        .unwrap_or(Value::Null),
                }),
            )),
            Some("TOOL_APPROVAL_DENIED") => Some((
                "failed",
                "failed",
                json!({
                    "kind": "approval_denied",
                    "toolPath": tool_path,
                    "approvalTicketId": result
                        .metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("approvalTicketId"))
                        .cloned()
                        .unwrap_or(Value::Null),
                    "artifactId": result
                        .metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("artifactId"))
                        .cloned()
                        .unwrap_or(Value::Null),
                    "patchRef": result
                        .metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("patchRef"))
                        .cloned()
                        .unwrap_or(Value::Null),
                }),
            )),
            _ if matches!(tool_path, TOOL_FS_APPLY_PATCH | TOOL_FS_ROLLBACK_PATCH) => Some((
                "failed",
                "failed",
                json!({
                    "kind": "tool_failed",
                    "toolPath": tool_path,
                    "errorCode": result.error_code,
                    "errorMessage": result.error_message,
                }),
            )),
            _ => None,
        },
    }
}

fn collect_string_metadata_refs(metadata: &Value, keys: &[&str]) -> Vec<String> {
    keys.iter()
        .filter_map(|key| metadata.get(*key).and_then(Value::as_str))
        .filter(|value| value.trim().is_empty() == false)
        .map(ToString::to_string)
        .collect()
}

fn emit_todo_update_events(
    store: &AiStore,
    session_id: &str,
    turn_id: Option<&str>,
    record: &TodoUpdateRecord,
) -> Result<()> {
    emit_store_event(
        store,
        session_id,
        turn_id,
        "todo_item_updated",
        json!({
            "sessionId": session_id,
            "turnId": turn_id,
            "todoListId": record.todo_list_id,
            "todoItemId": record.todo_item_id,
            "status": record.status,
            "title": record.title,
            "evidenceRefs": record.evidence_refs,
            "artifactRefs": record.artifact_refs,
            "blocker": record.blocker
        }),
    )?;
    emit_store_event(
        store,
        session_id,
        turn_id,
        "execution_step_updated",
        json!({
            "sessionId": session_id,
            "turnId": turn_id,
            "todoListId": record.todo_list_id,
            "todoItemId": record.todo_item_id,
            "executionRunId": record.execution_run_id,
            "executionStepId": record.execution_step_id,
            "status": record.step_status,
            "evidenceRefs": record.evidence_refs,
            "artifactRefs": record.artifact_refs,
            "blocker": record.blocker
        }),
    )
}

fn enrich_tool_result_metadata(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    result: &mut ToolResultEnvelope,
    blob: &ToolResultBlobMeta,
) -> Result<()> {
    if result.status != ToolResultStatus::Completed {
        return Ok(());
    }
    let Some(metadata) = result.metadata.as_mut().and_then(Value::as_object_mut) else {
        return Ok(());
    };
    if metadata.get("kind").and_then(Value::as_str) != Some("patch_proposal") {
        return Ok(());
    }
    let changed_files = metadata
        .get("changedFiles")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let title = metadata
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Patch proposal");
    let artifact_metadata = json!({
        "mimeType": "text/x-diff",
        "sizeBytes": blob.content_bytes,
        "contentHash": blob.content_sha256,
        "createdByTool": result.path,
        "redactionApplied": true,
        "sensitive": false,
        "changedFiles": changed_files,
        "approvalPreview": metadata.get("approvalPreview").cloned()
    });
    let refs = store.append_patch_artifact_and_evidence(
        session_id,
        turn_id,
        &result.op_id,
        title,
        &blob.result_ref,
        artifact_metadata,
        changed_files,
    )?;
    metadata.insert(
        "artifactId".to_string(),
        Value::String(refs.artifact_id.clone()),
    );
    metadata.insert("evidenceId".to_string(), Value::String(refs.evidence_id));
    metadata.insert(
        "patchRef".to_string(),
        Value::String(blob.result_ref.clone()),
    );
    Ok(())
}

fn tool_result_status_str(status: &ToolResultStatus) -> &'static str {
    match status {
        ToolResultStatus::Completed => "completed",
        ToolResultStatus::Failed => "failed",
    }
}

fn emit_store_event(
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

fn input_parts(input: &RuntimeTurnInput) -> Vec<AgentMessageContentPart> {
    if !input.parts.is_empty() {
        return input
            .parts
            .iter()
            .map(|part| match part {
                RuntimeTurnInputPart::Text { text } => AgentMessageContentPart {
                    r#type: "text".to_string(),
                    text: Some(text.clone()),
                    name: None,
                    path: None,
                    kind: None,
                },
                RuntimeTurnInputPart::Attachment { attachment } => part_from_attachment(attachment),
            })
            .collect();
    }
    input.attachments.iter().map(part_from_attachment).collect()
}

fn part_from_attachment(attachment: &RuntimeTurnAttachment) -> AgentMessageContentPart {
    AgentMessageContentPart {
        r#type: "attachment".to_string(),
        text: attachment.context_text.clone(),
        name: Some(attachment.name.clone()),
        path: Some(attachment.path.clone()),
        kind: Some(attachment.kind.clone()),
    }
}

fn normalize_collaboration_mode(value: Option<&str>) -> String {
    if value.and_then(trim_to_string).as_deref() == Some("plan") {
        "plan".to_string()
    } else {
        "default".to_string()
    }
}

fn title_from_text(text: &str) -> Option<String> {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return None;
    }
    let mut title = normalized.chars().take(48).collect::<String>();
    if normalized.chars().count() > 48 {
        title.push_str("...");
    }
    Some(title)
}

fn title_after_message(current: &str, text: &str) -> String {
    if current == "New thread" {
        title_from_text(text).unwrap_or_else(|| current.to_string())
    } else {
        current.to_string()
    }
}

fn mini_todo_items_for_request(text: &str) -> Option<Vec<CreateTodoItemInput>> {
    if is_execution_request(text) == false {
        return None;
    }
    Some(vec![
        CreateTodoItemInput {
            title: "Inspect relevant context".to_string(),
            actions: vec!["Read or search the workspace context needed for the change".to_string()],
            expected_tools: vec![
                TOOL_FS_LIST_FILES.to_string(),
                TOOL_FS_READ_FILE.to_string(),
                TOOL_FS_SEARCH_TEXT.to_string(),
            ],
            risk_level: "low".to_string(),
            completion_criteria: vec!["Relevant workspace evidence has been collected".to_string()],
            source: json!({ "type": "mini_auto", "slot": "inspect_context" }),
        },
        CreateTodoItemInput {
            title: "Prepare workspace changes".to_string(),
            actions: vec![
                "Produce a patch proposal for the requested workspace change".to_string(),
            ],
            expected_tools: vec![TOOL_FS_PROPOSE_PATCH.to_string()],
            risk_level: "medium".to_string(),
            completion_criteria: vec!["A patch proposal artifact is available".to_string()],
            source: json!({ "type": "mini_auto", "slot": "prepare_patch" }),
        },
        CreateTodoItemInput {
            title: "Apply approved workspace changes".to_string(),
            actions: vec!["Apply or roll back the approved patch through ToolFS".to_string()],
            expected_tools: vec![
                TOOL_FS_APPLY_PATCH.to_string(),
                TOOL_FS_ROLLBACK_PATCH.to_string(),
            ],
            risk_level: "medium".to_string(),
            completion_criteria: vec![
                "Workspace write action is completed or explicitly blocked".to_string()
            ],
            source: json!({ "type": "mini_auto", "slot": "workspace_write" }),
        },
        CreateTodoItemInput {
            title: "Record verification status".to_string(),
            actions: vec!["Capture what was or was not verified for this execution".to_string()],
            expected_tools: Vec::new(),
            risk_level: "low".to_string(),
            completion_criteria: vec![
                "Verification status is reflected in the final response".to_string()
            ],
            source: json!({ "type": "mini_auto", "slot": "verification_note" }),
        },
    ])
}

fn is_execution_request(text: &str) -> bool {
    let normalized = text.trim().to_lowercase();
    if normalized.is_empty() {
        return false;
    }
    let question_markers = [
        "what is",
        "why",
        "how do",
        "explain",
        "tell me",
        "介绍",
        "解释",
        "为什么",
        "是什么",
        "怎么",
    ];
    if normalized.chars().count() < 24
        && question_markers
            .iter()
            .any(|marker| normalized.contains(marker))
    {
        return false;
    }
    let greeting_markers = ["hi", "hello", "hey", "你好", "早上好", "晚上好"];
    if greeting_markers
        .iter()
        .any(|marker| normalized == *marker || normalized.starts_with(&format!("{marker} ")))
    {
        return false;
    }
    let execution_markers = [
        "implement",
        "fix",
        "refactor",
        "add ",
        "update",
        "build",
        "apply patch",
        "rollback",
        "make change",
        "做完",
        "实现",
        "修复",
        "重构",
        "添加",
        "新增",
        "更新",
        "先做",
        "执行",
        "改",
        "补",
    ];
    execution_markers
        .iter()
        .any(|marker| normalized.contains(marker))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{AgentSession, AgentTurn};
    use std::fs;

    fn test_config() -> ProviderRuntimeConfig {
        ProviderRuntimeConfig {
            provider_id: "openai".to_string(),
            protocol_id: "openai_chat_completions".to_string(),
            base_url: "https://example.invalid/v1".to_string(),
            api_key: None,
            auth_scheme: None,
            headers: HashMap::new(),
            connection_config: HashMap::new(),
            model_runtime_metadata: None,
            model: "test-model".to_string(),
        }
    }

    fn seed_turn(store: &AiStore, workspace_root: &str) -> (String, String) {
        let now = now_ms();
        let session = AgentSession {
            id: new_id("session"),
            title: "Test".to_string(),
            profile_id: Some("profile-test".to_string()),
            project_root: Some(workspace_root.to_string()),
            project_name: Some("workspace".to_string()),
            collaboration_mode: "default".to_string(),
            created_at: now,
            updated_at: now,
        };
        store.upsert_session_index(&session).expect("session");
        let turn = AgentTurn {
            id: new_id("turn"),
            session_id: session.id.clone(),
            profile_id: "profile-test".to_string(),
            status: "running".to_string(),
            collaboration_mode: Some("default".to_string()),
            permission_mode: "sandbox".to_string(),
            error_code: None,
            error_message: None,
            usage: None,
            created_at: now,
            updated_at: now,
        };
        let user_message = AgentMessage {
            id: new_id("msg"),
            session_id: session.id.clone(),
            turn_id: Some(turn.id.clone()),
            role: "user".to_string(),
            content: "inspect the project".to_string(),
            content_parts: None,
            display_content: Some("inspect the project".to_string()),
            created_at: now,
        };
        store.append_message(&user_message).expect("message");
        store
            .insert_turn(&turn, &user_message.id, None)
            .expect("turn");
        store
            .create_timeline_checkpoint(&session.id, &turn.id, &user_message.id)
            .expect("checkpoint");
        (session.id, turn.id)
    }

    fn seed_patch_artifact(
        store: &AiStore,
        session_id: &str,
        turn_id: &str,
        patch: &str,
        changed_files: Value,
    ) -> String {
        let blob = store
            .append_tool_result_blob(
                session_id,
                turn_id,
                "op-seed-propose",
                "/tools/filesystem/propose_patch",
                "completed",
                patch,
            )
            .expect("patch blob");
        let refs = store
            .append_patch_artifact_and_evidence(
                session_id,
                turn_id,
                "op-seed-propose",
                "Seed patch",
                &blob.result_ref,
                json!({
                    "changedFiles": changed_files.clone(),
                    "approvalPreview": {
                        "risk": { "level": "medium" }
                    }
                }),
                changed_files,
            )
            .expect("patch artifact");
        refs.artifact_id
    }

    #[test]
    fn mini_todo_heuristic_detects_execution_requests_only() {
        let execution_items = mini_todo_items_for_request("请先做 M5A，修复并实现 todo 账本")
            .expect("execution todo");
        assert_eq!(execution_items.len(), 4);
        assert!(execution_items.iter().any(|item| item
            .expected_tools
            .iter()
            .any(|tool| tool == TOOL_FS_APPLY_PATCH)));
        assert!(mini_todo_items_for_request("你好").is_none());
        assert!(mini_todo_items_for_request("what is the current architecture?").is_none());
    }

    #[test]
    fn create_todo_api_creates_plan_bound_list_and_execution_run() {
        let temp = tempfile::tempdir().expect("tempdir");
        let storage_root = temp.path().join("ai").to_string_lossy().to_string();
        let store = AiStore::open(Some(storage_root.as_str())).expect("store");
        let (session_id, _turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());

        let result = create_todo(AgentCreateTodoRequest {
            storage: StorageRequest {
                storage_root: Some(storage_root),
            },
            session_id: session_id.clone(),
            kind: "plan_bound".to_string(),
            title: "Plan execution".to_string(),
            source: Some(json!({ "type": "test_plan" })),
            items: vec![CreateTodoItemInput {
                title: "Apply patch".to_string(),
                actions: vec!["Apply approved patch".to_string()],
                expected_tools: vec![TOOL_FS_APPLY_PATCH.to_string()],
                risk_level: "medium".to_string(),
                completion_criteria: vec!["Patch applied".to_string()],
                source: json!({}),
            }],
        })
        .expect("create todo");

        assert_eq!(result.session_id, session_id);
        assert_eq!(
            result.detail.active_todo.as_ref().expect("todo").kind,
            "plan_bound"
        );
        assert_eq!(
            result
                .detail
                .execution_summary
                .as_ref()
                .expect("summary")
                .execution_run_id,
            result.execution_run_id
        );
        assert!(result
            .detail
            .runtime_events
            .iter()
            .any(|event| event.phase == "todo_list_created"));
    }

    #[test]
    fn sandbox_apply_tool_result_blocks_matching_todo_item() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(temp.path().join("README.md"), "old\n").expect("readme");
        let store =
            AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
        let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
        let artifact_id = seed_patch_artifact(
            &store,
            &session_id,
            &turn_id,
            "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n",
            json!([{
                "path": "README.md",
                "changeType": "modified",
                "additions": 1,
                "deletions": 1
            }]),
        );
        store
            .create_execution_todo_list(
                &session_id,
                Some(&turn_id),
                "mini",
                "Execution checklist",
                json!({ "type": "test" }),
                &[CreateTodoItemInput {
                    title: "Apply approved workspace changes".to_string(),
                    actions: Vec::new(),
                    expected_tools: vec![TOOL_FS_APPLY_PATCH.to_string()],
                    risk_level: "medium".to_string(),
                    completion_criteria: Vec::new(),
                    source: json!({}),
                }],
            )
            .expect("todo");
        let operation = ToolOperationEnvelope {
            schema_version: "v1".to_string(),
            kind: "tool_operation".to_string(),
            op_id: "op-apply".to_string(),
            op: ToolFsOp::Run,
            path: TOOL_FS_APPLY_PATCH.to_string(),
            args: json!({ "artifactId": artifact_id }),
        };
        let mut messages = Vec::new();
        let mut inspected = HashSet::from([TOOL_FS_APPLY_PATCH.to_string()]);

        run_tool_operation(
            &store,
            &session_id,
            &turn_id,
            &ToolExecutionContext {
                workspace_root: Some(temp.path().to_string_lossy().to_string()),
            },
            &operation,
            PermissionMode::Sandbox,
            &mut messages,
            &mut inspected,
        )
        .expect("tool operation");

        let detail = store
            .read_session_detail(&session_id)
            .expect("detail")
            .expect("session");
        let item = &detail.active_todo.as_ref().expect("todo").items[0];
        assert_eq!(item.status, "blocked");
        assert!(item
            .blockers
            .as_array()
            .expect("blockers")
            .iter()
            .any(|blocker| blocker["kind"] == "approval_required"));
        assert_eq!(
            detail
                .execution_summary
                .as_ref()
                .expect("summary")
                .blocked_step_count,
            1
        );
        assert!(detail
            .runtime_events
            .iter()
            .any(|event| event.phase == "todo_item_updated"));
    }

    #[test]
    fn tool_envelope_triggers_execution_second_model_call_and_persisted_events() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(
            temp.path().join("Cargo.toml"),
            "[package]\nname = \"demo\"\n",
        )
        .expect("cargo");
        let store =
            AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
        let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
        let mut responses = vec![
            r#"{"schemaVersion":"v1","kind":"tool_operation","opId":"op-list","op":"list","path":"/tools"}"#.to_string(),
            r#"{"schemaVersion":"v1","kind":"tool_operation","opId":"op-inspect","op":"inspect","path":"/tools/filesystem/list_files"}"#.to_string(),
            r#"{"schemaVersion":"v1","kind":"tool_operation","opId":"op-run","op":"run","path":"/tools/filesystem/list_files","args":{"path":"."}}"#.to_string(),
            "I found Cargo.toml in the workspace.".to_string(),
        ]
        .into_iter();
        let mut calls: Vec<Vec<ChatMessage>> = Vec::new();

        run_turn_worker_inner(
            &store,
            test_config(),
            &session_id,
            &turn_id,
            None,
            PermissionMode::Sandbox,
            Arc::new(AtomicBool::new(false)),
            |_config, messages, _cancel| {
                calls.push(messages);
                Ok(ModelResponse {
                    text: responses.next().expect("response"),
                    usage: None,
                })
            },
        )
        .expect("worker");

        assert_eq!(calls.len(), 4);
        assert!(calls[3]
            .iter()
            .any(|message| message.content.contains("Runtime ToolFS result")
                && message.content.contains("Cargo.toml")));
        let detail = store
            .read_session_detail(&session_id)
            .expect("detail")
            .expect("session");
        assert_eq!(
            detail
                .messages
                .iter()
                .filter(|message| message.role == "assistant")
                .map(|message| message.content.as_str())
                .collect::<Vec<_>>(),
            vec!["I found Cargo.toml in the workspace."]
        );
        let phases = detail
            .runtime_events
            .iter()
            .map(|event| event.phase.as_str())
            .collect::<Vec<_>>();
        assert!(phases.contains(&"tool_operation_started"));
        assert!(phases.contains(&"tool_operation_completed"));
        let completed_tool_event = detail
            .runtime_events
            .iter()
            .find(|event| {
                event.phase == "tool_operation_completed"
                    && event.payload["operation"]["path"] == "/tools/filesystem/list_files"
                    && event.payload["operation"]["op"] == "run"
            })
            .expect("completed tool event");
        let result_ref = completed_tool_event.payload["result"]["resultRef"]
            .as_str()
            .expect("result ref");
        assert!(completed_tool_event.payload["result"]["content"].is_null());
        assert!(completed_tool_event.payload["result"]["contentPreview"]
            .as_str()
            .unwrap_or_default()
            .contains("Cargo.toml"));
        let blob = store
            .read_tool_result_blob(&session_id, result_ref)
            .expect("blob")
            .expect("blob exists");
        assert_eq!(blob.runtime_turn_id, turn_id);
        assert_eq!(blob.tool_path, "/tools/filesystem/list_files");
        assert!(blob.content_json.contains("Cargo.toml"));
        assert!(blob.content_bytes > 0);
        assert_eq!(blob.content_sha256.len(), 64);
        let sequences = store
            .with_session_conn(&session_id, |conn| {
                let mut stmt =
                    conn.prepare("SELECT sequence FROM runtime_event ORDER BY sequence ASC")?;
                let rows = stmt.query_map([], |row| row.get::<_, i64>(0))?;
                let mut result = Vec::new();
                for row in rows {
                    result.push(row?);
                }
                Ok(result)
            })
            .expect("sequences");
        assert!(sequences.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn invalid_tool_envelope_is_final_text_and_not_executed() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store =
            AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
        let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());

        run_turn_worker_inner(
            &store,
            test_config(),
            &session_id,
            &turn_id,
            None,
            PermissionMode::Sandbox,
            Arc::new(AtomicBool::new(false)),
            |_config, _messages, _cancel| {
                Ok(ModelResponse {
                    text: r#"{"schemaVersion":"v1","kind":"tool_operation","operationId":"op-read","toolName":"filesystem.read_file","arguments":{"path":"Cargo.toml"}}"#.to_string(),
                    usage: None,
                })
            },
        )
        .expect("worker");

        let detail = store
            .read_session_detail(&session_id)
            .expect("detail")
            .expect("session");
        assert!(detail
            .runtime_events
            .iter()
            .all(|event| event.phase.starts_with("tool_operation_") == false));
        assert!(detail.messages.iter().any(|message| {
            message.role == "assistant"
                && message
                    .content
                    .contains(r#""toolName":"filesystem.read_file""#)
        }));
    }

    #[test]
    fn tool_failure_is_returned_to_model_as_tool_result() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store =
            AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
        let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
        let mut responses = vec![
            r#"{"schemaVersion":"v1","kind":"tool_operation","opId":"op-inspect","op":"inspect","path":"/tools/filesystem/read_file"}"#.to_string(),
            r#"{"schemaVersion":"v1","kind":"tool_operation","opId":"op-read","op":"run","path":"/tools/filesystem/read_file","args":{"path":"../secret.txt"}}"#.to_string(),
            "I cannot read outside the workspace.".to_string(),
        ]
        .into_iter();
        let mut calls: Vec<Vec<ChatMessage>> = Vec::new();

        run_turn_worker_inner(
            &store,
            test_config(),
            &session_id,
            &turn_id,
            None,
            PermissionMode::Sandbox,
            Arc::new(AtomicBool::new(false)),
            |_config, messages, _cancel| {
                calls.push(messages);
                Ok(ModelResponse {
                    text: responses.next().expect("response"),
                    usage: None,
                })
            },
        )
        .expect("worker");

        assert_eq!(calls.len(), 3);
        assert!(calls[2]
            .iter()
            .any(|message| message.content.contains("\"status\":\"failed\"")
                && message
                    .content
                    .contains("parent path segments are not allowed")));
        let detail = store
            .read_session_detail(&session_id)
            .expect("detail")
            .expect("session");
        assert!(detail
            .runtime_events
            .iter()
            .any(|event| event.phase == "tool_operation_failed"));
    }

    #[test]
    fn run_without_inspect_returns_inspect_required_without_executing_tool() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(temp.path().join("Cargo.toml"), "[package]\n").expect("cargo");
        let store =
            AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
        let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
        let mut responses = vec![
            r#"{"schemaVersion":"v1","kind":"tool_operation","opId":"op-run","op":"run","path":"/tools/filesystem/list_files","args":{"path":"."}}"#.to_string(),
            "I need to inspect the tool first.".to_string(),
        ]
        .into_iter();
        let mut calls: Vec<Vec<ChatMessage>> = Vec::new();

        run_turn_worker_inner(
            &store,
            test_config(),
            &session_id,
            &turn_id,
            None,
            PermissionMode::Sandbox,
            Arc::new(AtomicBool::new(false)),
            |_config, messages, _cancel| {
                calls.push(messages);
                Ok(ModelResponse {
                    text: responses.next().expect("response"),
                    usage: None,
                })
            },
        )
        .expect("worker");

        assert_eq!(calls.len(), 2);
        assert!(calls[1].iter().any(|message| {
            message
                .content
                .contains("\"errorCode\":\"TOOL_INSPECT_REQUIRED\"")
                && message.content.contains("Cargo.toml") == false
        }));
        let detail = store
            .read_session_detail(&session_id)
            .expect("detail")
            .expect("session");
        assert!(detail.runtime_events.iter().any(|event| {
            event.phase == "tool_operation_failed"
                && event.payload["result"]["errorCode"] == "TOOL_INSPECT_REQUIRED"
        }));
    }

    #[test]
    fn propose_patch_creates_preview_artifact_refs_without_modifying_workspace() {
        let temp = tempfile::tempdir().expect("tempdir");
        let readme_path = temp.path().join("README.md");
        fs::write(&readme_path, "# Demo\n").expect("readme");
        let store =
            AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
        let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
        let patch = "--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n # Demo\n+Preview line\n";
        let mut responses = vec![
            serde_json::json!({
                "schemaVersion": "v1",
                "kind": "tool_operation",
                "opId": "op-inspect-patch",
                "op": "inspect",
                "path": "/tools/filesystem/propose_patch"
            })
            .to_string(),
            serde_json::json!({
                "schemaVersion": "v1",
                "kind": "tool_operation",
                "opId": "op-propose",
                "op": "run",
                "path": "/tools/filesystem/propose_patch",
                "args": {
                    "title": "Update README",
                    "rationale": "Clarify the demo README.",
                    "patch": patch,
                    "expectedFiles": ["README.md"]
                }
            })
            .to_string(),
            "I prepared a patch preview artifact. It has not been applied or tested.".to_string(),
        ]
        .into_iter();

        run_turn_worker_inner(
            &store,
            test_config(),
            &session_id,
            &turn_id,
            None,
            PermissionMode::Sandbox,
            Arc::new(AtomicBool::new(false)),
            |_config, _messages, _cancel| {
                Ok(ModelResponse {
                    text: responses.next().expect("response"),
                    usage: None,
                })
            },
        )
        .expect("worker");

        assert_eq!(
            fs::read_to_string(&readme_path).expect("readme"),
            "# Demo\n"
        );
        assert_eq!(
            store
                .count_rows_for_test(&session_id, "timeline_checkpoint")
                .expect("checkpoint count"),
            1
        );
        assert_eq!(
            store
                .count_rows_for_test(&session_id, "artifact_record")
                .expect("artifact count"),
            1
        );
        assert_eq!(
            store
                .count_rows_for_test(&session_id, "evidence_record")
                .expect("evidence count"),
            1
        );
        assert_eq!(
            store
                .count_rows_for_test(&session_id, "approval_ticket")
                .expect("approval count"),
            0
        );

        let detail = store
            .read_session_detail(&session_id)
            .expect("detail")
            .expect("session");
        let completed_tool_event = detail
            .runtime_events
            .iter()
            .find(|event| {
                event.phase == "tool_operation_completed"
                    && event.payload["operation"]["path"] == "/tools/filesystem/propose_patch"
                    && event.payload["operation"]["op"] == "run"
            })
            .expect("completed patch event");
        let result = completed_tool_event.payload["result"]
            .as_object()
            .expect("result");
        assert!(result.get("content").is_none());
        let artifact_id = result
            .get("artifactId")
            .and_then(Value::as_str)
            .expect("artifact id");
        let evidence_id = result
            .get("evidenceId")
            .and_then(Value::as_str)
            .expect("evidence id");
        let patch_ref = result
            .get("patchRef")
            .and_then(Value::as_str)
            .expect("patch ref");
        assert!(artifact_id.starts_with("artifact_"));
        assert!(evidence_id.starts_with("evidence_"));
        assert_eq!(
            result.get("resultRef").and_then(Value::as_str),
            Some(patch_ref)
        );
        assert_eq!(result["changedFiles"][0]["path"], "README.md");
        assert_eq!(result["changedFiles"][0]["changeType"], "modified");
        assert!(result["contentPreview"]
            .as_str()
            .unwrap_or_default()
            .contains("Preview line"));

        let blob = store
            .read_tool_result_blob(&session_id, patch_ref)
            .expect("blob")
            .expect("blob exists");
        assert_eq!(blob.tool_path, "/tools/filesystem/propose_patch");
        assert!(blob.content_json.contains("+Preview line"));
    }

    #[test]
    fn apply_patch_in_sandbox_creates_pending_ticket_without_writing() {
        let temp = tempfile::tempdir().expect("tempdir");
        let readme_path = temp.path().join("README.md");
        fs::write(&readme_path, "old\n").expect("readme");
        let store =
            AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
        let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
        let artifact_id = seed_patch_artifact(
            &store,
            &session_id,
            &turn_id,
            "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n",
            json!([{
                "path": "README.md",
                "changeType": "modified",
                "additions": 1,
                "deletions": 1
            }]),
        );
        let mut responses = vec![
            serde_json::json!({
                "schemaVersion": "v1",
                "kind": "tool_operation",
                "opId": "op-inspect-apply",
                "op": "inspect",
                "path": "/tools/filesystem/apply_patch"
            })
            .to_string(),
            serde_json::json!({
                "schemaVersion": "v1",
                "kind": "tool_operation",
                "opId": "op-apply",
                "op": "run",
                "path": "/tools/filesystem/apply_patch",
                "args": { "artifactId": artifact_id }
            })
            .to_string(),
            "The patch needs approval before it can be applied.".to_string(),
        ]
        .into_iter();

        run_turn_worker_inner(
            &store,
            test_config(),
            &session_id,
            &turn_id,
            None,
            PermissionMode::Sandbox,
            Arc::new(AtomicBool::new(false)),
            |_config, _messages, _cancel| {
                Ok(ModelResponse {
                    text: responses.next().expect("response"),
                    usage: None,
                })
            },
        )
        .expect("worker");

        assert_eq!(fs::read_to_string(&readme_path).expect("readme"), "old\n");
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
            0
        );
        let detail = store
            .read_session_detail(&session_id)
            .expect("detail")
            .expect("session");
        assert!(detail.runtime_events.iter().any(|event| {
            event.phase == "tool_operation_failed"
                && event.payload["operation"]["path"] == "/tools/filesystem/apply_patch"
                && event.payload["result"]["errorCode"] == "TOOL_APPROVAL_REQUIRED"
        }));
    }

    #[test]
    fn apply_patch_in_full_access_auto_approves_and_writes_auditable_records() {
        let temp = tempfile::tempdir().expect("tempdir");
        let readme_path = temp.path().join("README.md");
        fs::write(&readme_path, "old\n").expect("readme");
        let store =
            AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
        let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
        let artifact_id = seed_patch_artifact(
            &store,
            &session_id,
            &turn_id,
            "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n",
            json!([{
                "path": "README.md",
                "changeType": "modified",
                "additions": 1,
                "deletions": 1
            }]),
        );
        let mut responses = vec![
            serde_json::json!({
                "schemaVersion": "v1",
                "kind": "tool_operation",
                "opId": "op-inspect-apply",
                "op": "inspect",
                "path": "/tools/filesystem/apply_patch"
            })
            .to_string(),
            serde_json::json!({
                "schemaVersion": "v1",
                "kind": "tool_operation",
                "opId": "op-apply",
                "op": "run",
                "path": "/tools/filesystem/apply_patch",
                "args": { "artifactId": artifact_id }
            })
            .to_string(),
            "Applied the patch.".to_string(),
        ]
        .into_iter();

        run_turn_worker_inner(
            &store,
            test_config(),
            &session_id,
            &turn_id,
            None,
            PermissionMode::FullAccess,
            Arc::new(AtomicBool::new(false)),
            |_config, _messages, _cancel| {
                Ok(ModelResponse {
                    text: responses.next().expect("response"),
                    usage: None,
                })
            },
        )
        .expect("worker");

        assert_eq!(fs::read_to_string(&readme_path).expect("readme"), "new\n");
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
                && event.payload["operation"]["path"] == "/tools/filesystem/apply_patch"
                && event.payload["result"]["approvalTicketId"]
                    .as_str()
                    .unwrap_or_default()
                    .starts_with("approval_")
        }));
    }
}
