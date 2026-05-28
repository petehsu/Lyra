use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
#[cfg(test)]
use std::time::Duration;

use anyhow::Result;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use once_cell::sync::{Lazy, OnceCell};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::agent::{Agent, AssembledProviderContext};
use crate::jcode_core::bridge::{
    JcodeRegisteredCommand, finished_tool_label, live_tool_label,
    registered_commands_from_vendored_tui,
};
use crate::jcode_gui_actions::{
    BTW_PAGE_ID, JcodeFeedbackActionKind, JcodeGuiActionKind, build_btw_loading_markdown,
    build_btw_system_reminder, build_improve_prompt, build_judge_startup_message,
    build_poke_message, build_refactor_prompt, build_review_startup_message,
    build_selfdev_start_prompt, incomplete_poke_todos, session_improve_mode_for,
};
use crate::memory::agent_runtime::{
    AgentMemorySnapshot, AgentMemoryStore, CreateSessionInput, EventRole as MemoryEventRole,
    ModelContextPolicy, NewSessionEvent, RuntimeTurnState, SessionRecord as MemorySessionRecord,
    SessionStatus as MemorySessionStatus, SharedMemoryStatus, TimelineProjectionItem,
    ToolResultStatus, UiPolicy, Visibility,
};
use crate::message::{ContentBlock, Message as JcodeMessage, Role};
use crate::protocol::ServerEvent;
use crate::provider::{MultiProvider, Provider};
use crate::rollback;
use crate::runtime::InterruptSignal;
use crate::session::Session;
#[cfg(test)]
use crate::session::{session_journal_path, session_path};
use crate::tool::{Registry, ToolContext, ToolExecutionMode};

type EventCallback = dyn Fn(String) + Send + Sync + 'static;

pub type HostCapabilityDispatcher =
    dyn Fn(String, String) -> Result<String, String> + Send + Sync + 'static;

static EVENT_CALLBACK: OnceCell<Mutex<Option<Arc<EventCallback>>>> = OnceCell::new();
static HOST_CAPABILITY_DISPATCHER: OnceCell<Mutex<Option<Arc<HostCapabilityDispatcher>>>> =
    OnceCell::new();
static RUNTIME: Lazy<Mutex<AgentRuntime>> = Lazy::new(|| Mutex::new(AgentRuntime::default()));
const STALLED_TURN_TIMEOUT_SECS: i64 = 120;
static PENDING_PERMISSIONS: Lazy<Mutex<HashMap<String, tokio::sync::oneshot::Sender<bool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static PENDING_CLARIFICATIONS: Lazy<Mutex<HashMap<String, PendingClarification>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

struct PendingClarification {
    session_id: String,
    tx: tokio::sync::oneshot::Sender<ClarificationAnswer>,
}

#[derive(Debug, Error)]
pub enum AgentError {
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("session not found: {0}")]
    SessionNotFound(String),
    #[error("turn not running for session: {0}")]
    TurnNotRunning(String),
    #[error("provider failed: {0}")]
    Provider(String),
    #[error("serialization failed: {0}")]
    Serialization(String),
    #[error("runtime lock failed")]
    RuntimeLock,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentRole {
    User,
    Assistant,
    System,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TurnStatus {
    Idle,
    Running,
    Cancelled,
    Finished,
    Failed,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub id: String,
    pub role: AgentRole,
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocks: Vec<AgentMessageBlock>,
    pub created_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rollback: Option<AgentMessageRollback>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AgentMessageBlock {
    Text {
        id: String,
        text: String,
    },
    Image {
        id: String,
        #[serde(rename = "mediaType", alias = "media_type")]
        media_type: String,
        data: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        label: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        width: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        height: Option<u32>,
    },
    Tool {
        id: String,
        #[serde(rename = "toolId", alias = "tool_id")]
        tool_id: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentImageInput {
    pub media_type: String,
    pub data: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessageRollback {
    pub available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolActivity {
    pub id: String,
    pub name: String,
    pub label: String,
    pub status: ToolActivityStatus,
    pub input: Value,
    pub output: Option<Value>,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ToolActivityStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentTodoItem {
    pub id: String,
    pub content: String,
    pub status: String,
    pub priority: String,
    pub blocked_by: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned_to: Option<String>,
}

impl From<crate::todo::TodoItem> for AgentTodoItem {
    fn from(todo: crate::todo::TodoItem) -> Self {
        Self {
            id: todo.id,
            content: todo.content,
            status: todo.status,
            priority: todo.priority,
            blocked_by: todo.blocked_by,
            assigned_to: todo.assigned_to,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSnapshot {
    pub id: String,
    pub title: String,
    pub session_kind: AgentSessionKind,
    pub working_dir: String,
    pub project_bound: bool,
    pub messages: Vec<AgentMessage>,
    pub tools: Vec<ToolActivity>,
    pub todos: Vec<AgentTodoItem>,
    pub automation: AgentSessionAutomationSnapshot,
    pub side_panel: AgentSidePanelSnapshot,
    pub turn_status: TurnStatus,
    pub active_turn_id: Option<String>,
    pub follow: AgentFollowState,
    pub updated_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory: Option<AgentMemorySnapshot>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentSessionKind {
    Normal,
    Selfdev,
    Overnight,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionAutomationSnapshot {
    pub subagent_model: Option<String>,
    pub autoreview_enabled: Option<bool>,
    pub autojudge_enabled: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentSidePanelSnapshot {
    pub focused_page_id: Option<String>,
    pub pages: Vec<AgentSidePanelPageSnapshot>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSidePanelPageSnapshot {
    pub id: String,
    pub title: String,
    pub file_path: String,
    pub format: String,
    pub source: String,
    pub content: String,
    pub updated_at_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentFollowState {
    pub running: bool,
    pub activity: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSessionRequest {
    title: Option<String>,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelfDevStartRequest {
    prompt: Option<String>,
    target: Option<String>,
    inherit_context: Option<bool>,
    parent_session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelfDevStatusRequest {
    session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OvernightStartRequest {
    session_id: Option<String>,
    duration_minutes: u32,
    mission: Option<String>,
    inherit_context: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OvernightRunRequest {
    run_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionRequest {
    session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionSaveRequest {
    session_id: String,
    label: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionRenameRequest {
    session_id: String,
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionArchiveRequest {
    session_id: String,
    archived: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionDeleteRequest {
    session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BindProjectRequest {
    session_id: Option<String>,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendTurnRequest {
    session_id: Option<String>,
    text: String,
    #[serde(default)]
    images: Vec<AgentImageInput>,
    /// Compatibility-only: old Lyra renderer builds used to pass a private
    /// provider profile. Lyra Agent owns provider selection now, so this is ignored.
    provider_profile_id: Option<String>,
    provider_profile: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JcodeActionRunRequest {
    session_id: Option<String>,
    plan_only: Option<bool>,
    focus: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JcodePokeRequest {
    session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JcodeSubagentRunRequest {
    session_id: Option<String>,
    prompt: String,
    subagent_type: Option<String>,
    model: Option<String>,
    continue_session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JcodeBtwRunRequest {
    session_id: Option<String>,
    question: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JcodeSessionActionRequest {
    session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JcodeGoalsActionRequest {
    session_id: Option<String>,
    goal_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JcodeAccountRequest {
    provider: Option<String>,
    label: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JcodeAccountLoginRequest {
    provider: Option<String>,
    profile_name: Option<String>,
    label: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    default_model: Option<String>,
    set_default: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JcodeAccountLoginStartRequest {
    provider: String,
    label: Option<String>,
    google_client_id: Option<String>,
    google_client_secret: Option<String>,
    gmail_access_tier: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JcodeAccountLoginCompleteRequest {
    provider: String,
    flow_id: Option<String>,
    label: Option<String>,
    callback_input: Option<String>,
    api_key: Option<String>,
    profile_name: Option<String>,
    base_url: Option<String>,
    default_model: Option<String>,
    auth_header: Option<String>,
    set_default: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JcodeAccountLoginFlow {
    provider: String,
    label: Option<String>,
    verifier: Option<String>,
    state: Option<String>,
    redirect_uri: Option<String>,
    auth_kind: String,
    gmail_access_tier: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentTurnStartResponse {
    session_id: String,
    turn_id: Option<String>,
    status: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SelfDevStartResponse {
    session_id: String,
    repo_dir: String,
    snapshot: AgentSessionSnapshot,
    turn_id: Option<String>,
    status: &'static str,
    inherited_context: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SelfDevStatusResponse {
    available: bool,
    repo_dir: Option<String>,
    session_id: Option<String>,
    output: String,
    title: Option<String>,
    metadata: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JcodeOvernightRunSnapshot {
    run_id: String,
    parent_session_id: String,
    coordinator_session_id: String,
    coordinator_session_name: String,
    status: String,
    mission: Option<String>,
    working_dir: Option<String>,
    provider_name: String,
    model: String,
    started_at: DateTime<Utc>,
    target_wake_at: DateTime<Utc>,
    handoff_ready_at: DateTime<Utc>,
    post_wake_grace_until: DateTime<Utc>,
    last_activity_at: DateTime<Utc>,
    completed_at: Option<DateTime<Utc>>,
    cancel_requested_at: Option<DateTime<Utc>>,
    run_dir: String,
    log_path: String,
    review_path: String,
    manifest: Value,
    progress: Value,
    events: Vec<Value>,
    task_cards: Vec<Value>,
    status_markdown: String,
    log_markdown: String,
    review_html: Option<String>,
    coordinator_snapshot: Option<AgentSessionSnapshot>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JcodeOvernightStartResponse {
    run: JcodeOvernightRunSnapshot,
    inherited_context: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JcodeOvernightListResponse {
    runs: Vec<JcodeOvernightRunSnapshot>,
    latest_run_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JcodeOvernightRunResponse {
    run: Option<JcodeOvernightRunSnapshot>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JcodePokeResponse {
    session_id: String,
    turn_id: Option<String>,
    status: &'static str,
    sent: bool,
    incomplete_todo_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JcodeSubagentRunResponse {
    session_id: String,
    tool_id: String,
    snapshot: AgentSessionSnapshot,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JcodeSessionForkResponse {
    session_id: String,
    parent_session_id: String,
    snapshot: AgentSessionSnapshot,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JcodeCompactResponse {
    session_id: String,
    message: String,
    success: bool,
    snapshot: AgentSessionSnapshot,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JcodeSidePanelActionResponse {
    session_id: String,
    turn_id: Option<String>,
    status: &'static str,
    side_panel: AgentSidePanelSnapshot,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JcodeAutomationUpdateResponse {
    session_id: String,
    automation: AgentSessionAutomationSnapshot,
    snapshot: AgentSessionSnapshot,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JcodeGoalsResponse {
    session_id: String,
    goals: Vec<Value>,
    focused_goal: Option<Value>,
    side_panel: AgentSidePanelSnapshot,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JcodeAccountSnapshot {
    provider: String,
    label: String,
    kind: String,
    active: bool,
    configured: bool,
    detail: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JcodeAccountsResponse {
    default_provider: Option<String>,
    default_model: Option<String>,
    auth_status: Value,
    accounts: Vec<JcodeAccountSnapshot>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JcodeLoginProviderSnapshot {
    id: String,
    display_name: String,
    auth_kind: String,
    status_method: String,
    detail: String,
    recommended: bool,
    configured: bool,
    state: String,
    requires_callback: bool,
    requires_api_key: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JcodeLoginProvidersResponse {
    providers: Vec<JcodeLoginProviderSnapshot>,
    auth_status: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JcodeAccountLoginStartResponse {
    provider: String,
    label: Option<String>,
    flow_id: String,
    auth_url: Option<String>,
    callback_hint: Option<String>,
    auth_kind: String,
    instructions: String,
    requires_callback: bool,
    requires_api_key: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JcodeAccountLoginCompleteResponse {
    accounts: JcodeAccountsResponse,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelTurnRequest {
    session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RollbackRequest {
    session_id: String,
    message_id: String,
    mode: Option<String>,
}

pub type RollbackChangedFile = rollback::RollbackChangedFile;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackPreviewResponse {
    session_id: String,
    message_id: String,
    available: bool,
    checkpoint_at: Option<DateTime<Utc>>,
    removed_message_count: usize,
    changed_files: Vec<RollbackChangedFile>,
    unavailable_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackRestoreResponse {
    session_id: String,
    message_id: String,
    snapshot: AgentSessionSnapshot,
    removed_message_count: usize,
    restored_file_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PermissionRespondRequest {
    session_id: String,
    permission_id: String,
    allowed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClarificationRespondRequest {
    session_id: String,
    clarification_id: String,
    answer: String,
    selected_option: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClarificationOption {
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClarificationAnswer {
    pub answer: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_option: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JcodeProviderProfileSaveRequest {
    profile_name: String,
    base_url: String,
    default_model: Option<String>,
    api_key: Option<String>,
    api_key_env: Option<String>,
    env_file: Option<String>,
    auth: Option<String>,
    auth_header: Option<String>,
    provider_type: Option<String>,
    set_default: Option<bool>,
    models: Option<Vec<JcodeProviderProfileModelRequest>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JcodeProviderProfileModelRequest {
    id: String,
    context_window: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JcodeModelsListRequest {
    session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JcodeModelSwitchRequest {
    session_id: Option<String>,
    model: String,
    provider: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JcodeModelRefreshRequest {
    session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JcodeProviderOptionsUpdateRequest {
    session_id: Option<String>,
    reasoning_effort: Option<String>,
    service_tier: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JcodeAgentRolesUpdateRequest {
    swarm_model: Option<String>,
    review_model: Option<String>,
    judge_model: Option<String>,
    memory_model: Option<String>,
    ambient_model: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JcodeModelRouteSnapshot {
    model: String,
    provider: String,
    api_method: String,
    available: bool,
    detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JcodeModelEntrySnapshot {
    id: String,
    label: String,
    model: String,
    provider: Option<String>,
    provider_key: Option<String>,
    api_method: Option<String>,
    detail: Option<String>,
    available: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JcodeProviderOptionState {
    current: Option<String>,
    options: Vec<String>,
    supported: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JcodeModelsListResponse {
    session_id: Option<String>,
    current_model: String,
    current_provider: String,
    default_model: Option<String>,
    default_provider: Option<String>,
    models: Vec<JcodeModelEntrySnapshot>,
    routes: Vec<JcodeModelRouteSnapshot>,
    reasoning_effort: JcodeProviderOptionState,
    service_tier: JcodeProviderOptionState,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JcodeSessionSummary {
    id: String,
    title: String,
    session_kind: AgentSessionKind,
    custom_title: Option<String>,
    short_name: Option<String>,
    status: String,
    provider_key: Option<String>,
    model: Option<String>,
    message_count: usize,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    last_active_at: Option<DateTime<Utc>>,
    saved: bool,
    save_label: Option<String>,
    archived: bool,
    working_dir: Option<String>,
}

struct AgentRuntime {
    sessions: HashMap<String, AgentSession>,
    active_session_id: Option<String>,
}

impl Default for AgentRuntime {
    fn default() -> Self {
        Self {
            sessions: HashMap::new(),
            active_session_id: None,
        }
    }
}

struct AgentSession {
    snapshot: AgentSessionSnapshot,
    agent: Arc<tokio::sync::Mutex<Agent>>,
    shutdown_signal: Option<InterruptSignal>,
}

pub fn register_rust_event_callback(callback: Arc<EventCallback>) {
    let callbacks = EVENT_CALLBACK.get_or_init(|| Mutex::new(None));
    if let Ok(mut slot) = callbacks.lock() {
        *slot = Some(callback);
    }
}

pub fn clear_rust_event_callback() {
    let callbacks = EVENT_CALLBACK.get_or_init(|| Mutex::new(None));
    if let Ok(mut slot) = callbacks.lock() {
        *slot = None;
    }
}

pub fn register_host_capability_dispatcher(dispatcher: Arc<HostCapabilityDispatcher>) {
    let slot = HOST_CAPABILITY_DISPATCHER.get_or_init(|| Mutex::new(None));
    if let Ok(mut guard) = slot.lock() {
        *guard = Some(dispatcher);
    }
}

pub fn clear_host_capability_dispatcher() {
    let slot = HOST_CAPABILITY_DISPATCHER.get_or_init(|| Mutex::new(None));
    if let Ok(mut guard) = slot.lock() {
        *guard = None;
    }
}

pub fn call_host_capability(method: &str, payload: Value) -> Result<Value, String> {
    let dispatcher = HOST_CAPABILITY_DISPATCHER
        .get()
        .and_then(|slot| slot.lock().ok())
        .and_then(|guard| guard.clone());

    let Some(dispatcher) = dispatcher else {
        return Err("No host capability dispatcher registered".to_string());
    };

    let payload_str =
        serde_json::to_string(&payload).map_err(|e| format!("Failed to serialize payload: {e}"))?;

    let result_str = dispatcher(method.to_string(), payload_str)?;

    let result_val = serde_json::from_str(&result_str)
        .map_err(|e| format!("Failed to deserialize result: {e}"))?;

    Ok(result_val)
}

fn agent_memory_store() -> Result<AgentMemoryStore, AgentError> {
    AgentMemoryStore::new_default()
        .map_err(|error| AgentError::Provider(format!("agent memory store failed: {error}")))
}

fn agent_memory_input_from_jcode_session(session: &Session) -> CreateSessionInput {
    CreateSessionInput {
        title: Some(session.display_title_or_name().to_string()),
        working_dir: Some(session_working_dir(session)),
        provider_key: session.provider_key.clone(),
        model: session.model.clone(),
    }
}

fn ensure_agent_memory_session_from_jcode(
    session: &Session,
) -> Result<MemorySessionRecord, AgentError> {
    agent_memory_store()?
        .ensure_session_with_id(&session.id, agent_memory_input_from_jcode_session(session))
        .map_err(|error| AgentError::Provider(format!("agent memory session failed: {error}")))
}

fn sync_agent_memory_session_metadata(session: &Session) -> Result<(), AgentError> {
    let store = agent_memory_store()?;
    store
        .ensure_session_with_id(&session.id, agent_memory_input_from_jcode_session(session))
        .map_err(|error| AgentError::Provider(format!("agent memory session failed: {error}")))?;
    store
        .update_session_title(&session.id, session.display_title_or_name())
        .and_then(|()| {
            store.update_session_model_snapshot(
                &session.id,
                Some(session_working_dir(session).as_str()),
                session.provider_key.as_deref(),
                session.model.as_deref(),
            )
        })
        .and_then(|()| {
            let status = if session.archived {
                MemorySessionStatus::Archived
            } else {
                MemorySessionStatus::Idle
            };
            store.update_session_status(&session.id, status)
        })
        .map_err(|error| AgentError::Provider(format!("agent memory metadata failed: {error}")))
}

fn memory_turn_state_for_turn_status(status: &TurnStatus) -> RuntimeTurnState {
    match status {
        TurnStatus::Idle | TurnStatus::Finished => RuntimeTurnState::Completed,
        TurnStatus::Running => RuntimeTurnState::StreamingModel,
        TurnStatus::Cancelled => RuntimeTurnState::CancelledByUser,
        TurnStatus::Failed => RuntimeTurnState::FailedRecoverable,
    }
}

fn memory_session_status_for_turn_status(status: &TurnStatus) -> MemorySessionStatus {
    match status {
        TurnStatus::Idle | TurnStatus::Finished => MemorySessionStatus::Idle,
        TurnStatus::Running => MemorySessionStatus::Running,
        TurnStatus::Cancelled => MemorySessionStatus::Interrupted,
        TurnStatus::Failed => MemorySessionStatus::Failed,
    }
}

fn memory_snapshot_for_session(session_id: &str) -> Option<AgentMemorySnapshot> {
    agent_memory_store().ok()?.snapshot(session_id).ok()
}

fn active_memory_turn_id(snapshot: &AgentMemorySnapshot) -> Option<String> {
    snapshot
        .runtime_turns
        .iter()
        .rev()
        .find(|turn| !turn.state.is_terminal())
        .map(|turn| turn.runtime_turn_id.clone())
}

fn turn_status_from_memory_snapshot(snapshot: &AgentMemorySnapshot) -> TurnStatus {
    if let Some(turn) = snapshot
        .runtime_turns
        .iter()
        .rev()
        .find(|turn| !turn.state.is_terminal())
    {
        return match turn.state {
            RuntimeTurnState::FailedRecoverable | RuntimeTurnState::FailedTerminal => {
                TurnStatus::Failed
            }
            RuntimeTurnState::CancelledByUser | RuntimeTurnState::Interrupted => {
                TurnStatus::Cancelled
            }
            RuntimeTurnState::Completed => TurnStatus::Finished,
            _ => TurnStatus::Running,
        };
    }
    match snapshot.session.as_ref().map(|session| &session.status) {
        Some(MemorySessionStatus::Running) => TurnStatus::Running,
        Some(MemorySessionStatus::Failed) => TurnStatus::Failed,
        Some(MemorySessionStatus::Interrupted) => TurnStatus::Cancelled,
        _ => TurnStatus::Idle,
    }
}

fn parse_memory_time(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .map(|timestamp| timestamp.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

fn memory_payload_text(item: &TimelineProjectionItem) -> String {
    item.payload_json
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn agent_role_from_memory(role: MemoryEventRole) -> Option<AgentRole> {
    match role {
        MemoryEventRole::User => Some(AgentRole::User),
        MemoryEventRole::Assistant => Some(AgentRole::Assistant),
        MemoryEventRole::System => Some(AgentRole::System),
        MemoryEventRole::Tool | MemoryEventRole::Runtime => None,
    }
}

fn agent_message_from_memory_item(item: &TimelineProjectionItem) -> Option<AgentMessage> {
    let role = agent_role_from_memory(item.role)?;
    let text = memory_payload_text(item);
    let blocks = if text.trim().is_empty() {
        Vec::new()
    } else {
        vec![AgentMessageBlock::Text {
            id: format!("{}-text", item.event_id),
            text: text.clone(),
        }]
    };
    Some(AgentMessage {
        id: item.event_id.clone(),
        role,
        text,
        blocks,
        created_at: parse_memory_time(&item.created_at_iso),
        rollback: None,
    })
}

fn tool_activity_from_memory_item(item: &TimelineProjectionItem) -> Option<ToolActivity> {
    if item.kind != "tool_result" {
        return None;
    }
    let payload = &item.payload_json;
    let name = payload
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("tool")
        .to_string();
    let status = match payload.get("status").and_then(Value::as_str) {
        Some("failed_retryable" | "failed_terminal" | "timed_out_partial") => {
            ToolActivityStatus::Failed
        }
        Some("cancelled") => ToolActivityStatus::Cancelled,
        Some("running") => ToolActivityStatus::Running,
        _ => ToolActivityStatus::Completed,
    };
    let failed = status == ToolActivityStatus::Failed;
    Some(ToolActivity {
        id: payload
            .get("toolCallId")
            .and_then(Value::as_str)
            .unwrap_or(item.event_id.as_str())
            .to_string(),
        name: name.clone(),
        label: finished_tool_label(&name, failed),
        status,
        input: Value::Object(serde_json::Map::new()),
        output: payload.get("output").cloned(),
        started_at: parse_memory_time(&item.created_at_iso),
        finished_at: Some(parse_memory_time(&item.created_at_iso)),
    })
}

fn provider_message_from_memory_item(item: &TimelineProjectionItem) -> Option<JcodeMessage> {
    match item.kind.as_str() {
        "user_message" if item.role == MemoryEventRole::User => Some(JcodeMessage {
            role: Role::User,
            content: vec![ContentBlock::Text {
                text: memory_payload_text(item),
                cache_control: None,
            }],
            timestamp: Some(parse_memory_time(&item.created_at_iso)),
            tool_duration_ms: None,
        }),
        "user_context_message" if item.role == MemoryEventRole::User => {
            let content = item
                .payload_json
                .get("contentBlocks")
                .cloned()
                .and_then(|value| serde_json::from_value::<Vec<ContentBlock>>(value).ok())?;
            Some(JcodeMessage {
                role: Role::User,
                content,
                timestamp: Some(parse_memory_time(&item.created_at_iso)),
                tool_duration_ms: None,
            })
        }
        "assistant_message" if item.role == MemoryEventRole::Assistant => {
            let mut content = Vec::new();
            let text = memory_payload_text(item);
            if !text.trim().is_empty() {
                content.push(ContentBlock::Text {
                    text,
                    cache_control: None,
                });
            }
            if let Some(tool_calls) = item.payload_json.get("toolCalls").and_then(Value::as_array) {
                for tool in tool_calls {
                    let Some(id) = tool.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    let Some(name) = tool.get("name").and_then(Value::as_str) else {
                        continue;
                    };
                    content.push(ContentBlock::ToolUse {
                        id: id.to_string(),
                        name: name.to_string(),
                        input: tool.get("input").cloned().unwrap_or(Value::Null),
                    });
                }
            }
            if content.is_empty() {
                return None;
            }
            Some(JcodeMessage {
                role: Role::Assistant,
                content,
                timestamp: Some(parse_memory_time(&item.created_at_iso)),
                tool_duration_ms: None,
            })
        }
        "tool_result" => {
            let payload = &item.payload_json;
            let tool_call_id = payload
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or(item.event_id.as_str())
                .to_string();
            let content = payload
                .get("output")
                .map(|output| {
                    output
                        .get("content")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned)
                        .unwrap_or_else(|| output.to_string())
                })
                .unwrap_or_default();
            Some(JcodeMessage {
                role: Role::User,
                content: vec![ContentBlock::ToolResult {
                    tool_use_id: tool_call_id,
                    content,
                    is_error: payload
                        .get("status")
                        .and_then(Value::as_str)
                        .is_some_and(|status| status.contains("failed"))
                        .then_some(true),
                }],
                timestamp: Some(parse_memory_time(&item.created_at_iso)),
                tool_duration_ms: None,
            })
        }
        _ => None,
    }
}

fn current_user_provider_message(text: &str, images: &[(String, String)]) -> JcodeMessage {
    let mut content = images
        .iter()
        .map(|(media_type, data)| ContentBlock::Image {
            media_type: media_type.clone(),
            data: data.clone(),
        })
        .collect::<Vec<_>>();
    if !text.trim().is_empty() || content.is_empty() {
        content.push(ContentBlock::Text {
            text: text.to_string(),
            cache_control: None,
        });
    }
    JcodeMessage {
        role: Role::User,
        content,
        timestamp: Some(Utc::now()),
        tool_duration_ms: None,
    }
}

fn assembled_provider_context_from_snapshot(
    snapshot: &crate::memory::agent_runtime::ContextSnapshot,
    text: &str,
    images: &[(String, String)],
) -> AssembledProviderContext {
    let latest_user_event_id = snapshot
        .layers
        .iter()
        .find(|layer| {
            matches!(
                layer.kind,
                crate::memory::agent_runtime::ContextLayerKind::LatestUserIntent
            )
        })
        .and_then(|layer| layer.payload_json.get("event"))
        .and_then(|event| event.get("eventId"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let current_user = current_user_provider_message(text, images);
    let mut inserted_current_user = false;
    let mut messages = snapshot
        .layers
        .iter()
        .find(|layer| {
            matches!(
                layer.kind,
                crate::memory::agent_runtime::ContextLayerKind::Tail
            )
        })
        .and_then(|layer| layer.payload_json.get("timeline"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| serde_json::from_value::<TimelineProjectionItem>(value.clone()).ok())
        .filter_map(|item| {
            if latest_user_event_id.as_deref() == Some(item.event_id.as_str()) {
                inserted_current_user = true;
                Some(current_user.clone())
            } else {
                provider_message_from_memory_item(&item)
            }
        })
        .collect::<Vec<_>>();
    if !inserted_current_user {
        messages.push(current_user);
    }
    let dynamic_layers = snapshot
        .layers
        .iter()
        .filter(|layer| {
            !matches!(
                layer.kind,
                crate::memory::agent_runtime::ContextLayerKind::Tail
                    | crate::memory::agent_runtime::ContextLayerKind::LatestUserIntent
            )
        })
        .cloned()
        .collect::<Vec<_>>();
    let dynamic_system_context = serde_json::to_string(&json!({
        "lyraContextSnapshotId": snapshot.context_snapshot_id,
        "runtimeTurnId": snapshot.runtime_turn_id,
        "layers": dynamic_layers
    }))
    .ok();
    AssembledProviderContext {
        session_id: snapshot.session_id.clone(),
        runtime_turn_id: snapshot.runtime_turn_id.clone(),
        context_snapshot_id: snapshot.context_snapshot_id.clone(),
        messages,
        dynamic_system_context,
    }
}

fn todo_item_from_memory_value(value: &Value, index: usize) -> Option<AgentTodoItem> {
    let object = value.as_object()?;
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("todo-{index}"));
    let content = object
        .get("content")
        .or_else(|| object.get("title"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if content.trim().is_empty() {
        return None;
    }
    Some(AgentTodoItem {
        id,
        content,
        status: object
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("pending")
            .to_string(),
        priority: object
            .get("priority")
            .and_then(Value::as_str)
            .unwrap_or("normal")
            .to_string(),
        blocked_by: object
            .get("blockedBy")
            .or_else(|| object.get("blocked_by"))
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToOwned::to_owned)
                    .collect()
            })
            .unwrap_or_default(),
        assigned_to: object
            .get("assignedTo")
            .or_else(|| object.get("assigned_to"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    })
}

fn snapshot_from_agent_memory_snapshot(snapshot: AgentMemorySnapshot) -> AgentSessionSnapshot {
    let session = snapshot.session.clone();
    let working_dir = session
        .as_ref()
        .and_then(|session| session.working_dir.clone())
        .unwrap_or_else(default_unbound_working_dir);
    let messages = snapshot
        .timeline_projection
        .iter()
        .filter_map(agent_message_from_memory_item)
        .collect::<Vec<_>>();
    let tools = snapshot
        .timeline_projection
        .iter()
        .filter_map(tool_activity_from_memory_item)
        .collect::<Vec<_>>();
    let todos = snapshot
        .active_todos
        .iter()
        .enumerate()
        .filter_map(|(index, value)| todo_item_from_memory_value(value, index))
        .collect::<Vec<_>>();
    let turn_status = turn_status_from_memory_snapshot(&snapshot);
    let active_turn_id = active_memory_turn_id(&snapshot);
    let updated_at = session
        .as_ref()
        .map(|session| parse_memory_time(&session.updated_at_iso))
        .unwrap_or_else(Utc::now);
    let running = matches!(turn_status, TurnStatus::Running);
    AgentSessionSnapshot {
        id: session
            .as_ref()
            .map(|session| session.session_id.clone())
            .unwrap_or_default(),
        title: session
            .as_ref()
            .map(|session| session.title.clone())
            .unwrap_or_else(|| "Lyra Agent".to_string()),
        session_kind: AgentSessionKind::Normal,
        project_bound: is_project_bound(&working_dir),
        working_dir,
        messages,
        tools,
        todos,
        automation: AgentSessionAutomationSnapshot {
            subagent_model: None,
            autoreview_enabled: None,
            autojudge_enabled: None,
        },
        side_panel: AgentSidePanelSnapshot::default(),
        turn_status,
        active_turn_id,
        follow: AgentFollowState {
            running,
            activity: running.then(|| "Running via structured Agent memory".to_string()),
        },
        updated_at,
        memory: Some(snapshot),
    }
}

fn summary_from_agent_memory_session(session: &MemorySessionRecord) -> JcodeSessionSummary {
    JcodeSessionSummary {
        id: session.session_id.clone(),
        title: session.title.clone(),
        session_kind: AgentSessionKind::Normal,
        custom_title: Some(session.title.clone()),
        short_name: None,
        status: session.status.as_storage_str().to_string(),
        provider_key: session.provider_key.clone(),
        model: session.model.clone(),
        message_count: 0,
        created_at: parse_memory_time(&session.created_at_iso),
        updated_at: parse_memory_time(&session.updated_at_iso),
        last_active_at: Some(parse_memory_time(&session.updated_at_iso)),
        saved: false,
        save_label: None,
        archived: matches!(session.status, MemorySessionStatus::Archived),
        working_dir: session.working_dir.clone(),
    }
}

fn jcode_session_from_agent_memory(
    record: &MemorySessionRecord,
    snapshot: Option<&AgentMemorySnapshot>,
) -> Session {
    let mut session =
        Session::create_with_id(record.session_id.clone(), None, Some(record.title.clone()));
    session.working_dir = record.working_dir.clone();
    session.provider_key = record.provider_key.clone();
    session.model = record.model.clone();
    session.created_at = parse_memory_time(&record.created_at_iso);
    session.updated_at = parse_memory_time(&record.updated_at_iso);
    session.archived = matches!(record.status, MemorySessionStatus::Archived);
    if let Some(snapshot) = snapshot {
        for item in &snapshot.timeline_projection {
            if let Some(message) = provider_message_from_memory_item(item) {
                session.add_message(message.role, message.content);
            }
        }
    }
    session
}

fn read_memory_session_record(session_id: &str) -> Result<MemorySessionRecord, AgentError> {
    agent_memory_store()?
        .read_session(session_id)
        .map_err(|error| {
            AgentError::Provider(format!("agent memory session read failed: {error}"))
        })?
        .ok_or_else(|| AgentError::SessionNotFound(session_id.to_string()))
}

fn jcode_session_for_memory_session(session_id: &str) -> Result<Session, AgentError> {
    let store = agent_memory_store()?;
    let memory_snapshot = store
        .snapshot(session_id)
        .map_err(|error| AgentError::Provider(format!("agent memory snapshot failed: {error}")))?;
    let record = memory_snapshot
        .session
        .as_ref()
        .ok_or_else(|| AgentError::SessionNotFound(session_id.to_string()))?;
    Ok(jcode_session_from_agent_memory(
        record,
        Some(&memory_snapshot),
    ))
}

fn stored_message_text(message: &crate::session::StoredMessage) -> String {
    message
        .content
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .filter(|text| !text.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn stored_message_to_memory_event(
    message: &crate::session::StoredMessage,
) -> Option<NewSessionEvent> {
    if let Some(tool_result) = message.content.iter().find_map(|block| match block {
        ContentBlock::ToolResult {
            tool_use_id,
            content,
            is_error,
        } => Some((tool_use_id, content, is_error)),
        _ => None,
    }) {
        return Some(NewSessionEvent {
            kind: "tool_result".to_string(),
            role: MemoryEventRole::Tool,
            payload: json!({
                "toolCallId": tool_result.0,
                "output": { "content": tool_result.1 },
                "status": if tool_result.2.unwrap_or(false) { "failed_terminal" } else { "completed" },
            }),
            visibility: Visibility::UserVisible,
            model_context_policy: ModelContextPolicy::Include,
            ui_policy: UiPolicy::ShowInTimeline,
            runtime_turn_id: None,
            lineage_json: json!({ "sourceStoredMessageId": message.id }),
        });
    }

    let text = stored_message_text(message);
    if text.trim().is_empty() {
        return None;
    }
    match message.role {
        Role::User => Some(NewSessionEvent::user_message(text)),
        Role::Assistant => Some(NewSessionEvent::assistant_message(text, None)),
    }
}

fn todo_items_for_session(session_id: &str) -> Result<Vec<crate::todo::TodoItem>, AgentError> {
    Ok(agent_memory_store()?
        .active_todos_for_session(session_id)
        .map_err(|error| AgentError::Provider(format!("agent memory todos read failed: {error}")))?
        .into_iter()
        .filter_map(|value| serde_json::from_value::<crate::todo::TodoItem>(value).ok())
        .collect())
}

fn copy_active_todos(parent_session_id: &str, child_session_id: &str) -> Result<(), AgentError> {
    let store = agent_memory_store()?;
    let todos = store
        .active_todos_for_session(parent_session_id)
        .map_err(|error| {
            AgentError::Provider(format!("agent memory todos read failed: {error}"))
        })?;
    store
        .record_active_todos_for_session(child_session_id, None, &todos)
        .map_err(|error| AgentError::Provider(format!("agent memory todos copy failed: {error}")))
}

fn persist_jcode_session_adapter(session: &Session) -> Result<(), AgentError> {
    let store = agent_memory_store()?;
    store
        .ensure_session_with_id(&session.id, agent_memory_input_from_jcode_session(session))
        .and_then(|_| store.update_session_title(&session.id, session.display_title_or_name()))
        .and_then(|_| {
            store.update_session_model_snapshot(
                &session.id,
                session.working_dir.as_deref(),
                session.provider_key.as_deref(),
                session.model.as_deref(),
            )
        })
        .and_then(|_| {
            store.update_session_status(
                &session.id,
                if session.archived {
                    MemorySessionStatus::Archived
                } else {
                    MemorySessionStatus::Idle
                },
            )
        })
        .map_err(|error| {
            AgentError::Provider(format!("agent memory session persist failed: {error}"))
        })?;

    if store
        .read_events_by_session(&session.id)
        .map_err(|error| AgentError::Provider(format!("agent memory events read failed: {error}")))?
        .is_empty()
    {
        for message in &session.messages {
            if let Some(event) = stored_message_to_memory_event(message) {
                store.append_event(&session.id, event).map_err(|error| {
                    AgentError::Provider(format!("agent memory event clone failed: {error}"))
                })?;
            }
        }
    }
    Ok(())
}

pub fn create_session_json(payload: String) -> Result<String, AgentError> {
    let request: CreateSessionRequest = parse_request(&payload)?;
    let title = request.title.unwrap_or_else(|| "Lyra Agent".to_string());
    let working_dir = resolve_create_working_dir(request.working_dir.as_deref())?;
    let store = agent_memory_store()?;
    let record = store
        .create_session(CreateSessionInput {
            title: Some(title),
            working_dir: Some(working_dir),
            provider_key: None,
            model: None,
        })
        .map_err(|error| {
            AgentError::Provider(format!("agent memory session create failed: {error}"))
        })?;
    let memory_snapshot = store
        .snapshot(&record.session_id)
        .map_err(|error| AgentError::Provider(format!("agent memory snapshot failed: {error}")))?;
    let snapshot = snapshot_from_agent_memory_snapshot(memory_snapshot.clone());
    let agent = build_agent_blocking(jcode_session_from_agent_memory(
        &record,
        Some(&memory_snapshot),
    ))?;

    let mut runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
    runtime.active_session_id = Some(snapshot.id.clone());
    runtime.sessions.insert(
        snapshot.id.clone(),
        AgentSession {
            snapshot: snapshot.clone(),
            agent,
            shutdown_signal: None,
        },
    );
    drop(runtime);

    emit_event(AgentRuntimeEvent::SessionSnapshot {
        snapshot: snapshot.clone(),
    });
    encode(&snapshot)
}

pub fn bind_project_session_json(payload: String) -> Result<String, AgentError> {
    let request: BindProjectRequest = parse_request(&payload)?;
    let session_id = resolve_agent_session_id(request.session_id)?;
    if is_session_running(&session_id)? {
        return Err(AgentError::BadRequest(format!(
            "cannot bind project while the agent is running: {session_id}"
        )));
    }
    let working_dir = normalize_working_dir(request.working_dir.as_deref())?;

    let store = agent_memory_store()?;
    let session_record = store
        .read_session(&session_id)
        .map_err(|error| {
            AgentError::Provider(format!("agent memory session read failed: {error}"))
        })?
        .ok_or_else(|| AgentError::SessionNotFound(session_id.clone()))?;
    let current_working_dir = session_record
        .working_dir
        .clone()
        .unwrap_or_else(default_unbound_working_dir);
    if is_project_bound(&current_working_dir)
        && Path::new(&current_working_dir) != Path::new(&working_dir)
    {
        return Err(AgentError::BadRequest(
            "cannot change project binding after a project is already bound".to_string(),
        ));
    }
    store
        .update_session_model_snapshot(
            &session_id,
            Some(&working_dir),
            session_record.provider_key.as_deref(),
            session_record.model.as_deref(),
        )
        .map_err(|error| AgentError::Provider(format!("agent memory bind failed: {error}")))?;

    let loaded_agent = {
        let runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
        runtime
            .sessions
            .get(&session_id)
            .map(|session| session.agent.clone())
    };
    if let Some(agent) = loaded_agent {
        block_on(async {
            let mut guard = agent.lock().await;
            guard.set_working_dir(&working_dir);
        })?;
    }

    let snapshot = {
        let mut runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
        runtime.active_session_id = Some(session_id.clone());
        if let Some(loaded) = runtime.sessions.get_mut(&session_id) {
            loaded.snapshot.working_dir = working_dir.clone();
            loaded.snapshot.project_bound = is_project_bound(&working_dir);
            loaded.snapshot.updated_at = Utc::now();
            let snapshot = loaded.snapshot.clone();
            loaded.snapshot = snapshot.clone();
            snapshot
        } else {
            snapshot_from_agent_memory_snapshot(store.snapshot(&session_id).map_err(|error| {
                AgentError::Provider(format!("agent memory snapshot failed: {error}"))
            })?)
        }
    };

    emit_event(AgentRuntimeEvent::SessionSnapshot {
        snapshot: snapshot.clone(),
    });
    encode(&snapshot)
}

pub fn read_session_json(payload: String) -> Result<String, AgentError> {
    let request: SessionRequest = parse_request(&payload)?;
    let session_id = {
        let runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
        request
            .session_id
            .or_else(|| runtime.active_session_id.clone())
            .ok_or_else(|| AgentError::SessionNotFound("active".to_string()))?
    };
    let (snapshot, recovered_turn_id) = {
        let mut runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
        runtime.sessions.get_mut(&session_id).map(|session| {
            let recovered_turn_id = recover_stalled_turn_if_needed(session);
            session.snapshot.todos = agent_todos_for_session(&session_id);
            (session.snapshot.clone(), recovered_turn_id)
        })
    }
    .or_else(|| {
        agent_memory_store()
            .ok()
            .and_then(|store| store.snapshot(&session_id).ok())
            .map(snapshot_from_agent_memory_snapshot)
            .map(|snapshot| (snapshot, None))
    })
    .ok_or_else(|| AgentError::SessionNotFound(session_id.clone()))?;
    if let Some(turn_id) = recovered_turn_id {
        transition_memory_turn(
            &session_id,
            &turn_id,
            RuntimeTurnState::Interrupted,
            "stalled_turn_recovered",
        );
        emit_event(AgentRuntimeEvent::SessionSnapshot {
            snapshot: snapshot.clone(),
        });
        emit_event(AgentRuntimeEvent::TurnFinished {
            session_id: session_id.clone(),
            turn_id,
            status: TurnStatus::Cancelled,
        });
        emit_event(AgentRuntimeEvent::FollowStateChanged {
            session_id: session_id.clone(),
            follow: snapshot.follow.clone(),
        });
    }
    encode(&snapshot)
}

fn resolve_memory_session_id(requested: Option<String>) -> Result<String, AgentError> {
    if let Some(session_id) = requested
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
    {
        return Ok(session_id);
    }
    let runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
    runtime
        .active_session_id
        .clone()
        .ok_or_else(|| AgentError::SessionNotFound("active".to_string()))
}

pub fn agent_memory_snapshot_json(payload: String) -> Result<String, AgentError> {
    let request: SessionRequest = parse_request(&payload)?;
    let session_id = resolve_memory_session_id(request.session_id)?;
    let snapshot = agent_memory_store()?
        .snapshot(&session_id)
        .map_err(|error| AgentError::Provider(format!("agent memory snapshot failed: {error}")))?;
    encode(&snapshot)
}

pub fn agent_memory_audit_json(payload: String) -> Result<String, AgentError> {
    let request: SessionRequest = parse_request(&payload)?;
    let session_id = resolve_memory_session_id(request.session_id)?;
    let store = agent_memory_store()?;
    let events = store
        .read_events_by_session(&session_id)
        .map_err(|error| AgentError::Provider(format!("agent memory audit failed: {error}")))?;
    let runtime_turns = store
        .read_runtime_turns(&session_id)
        .map_err(|error| AgentError::Provider(format!("agent memory audit failed: {error}")))?;
    encode(&json!({
        "sessionId": session_id,
        "events": events,
        "runtimeTurns": runtime_turns,
    }))
}

pub fn agent_memory_trim_run_json(payload: String) -> Result<String, AgentError> {
    let request: Value = parse_request(&payload)?;
    let session_id = resolve_memory_session_id(
        request
            .get("sessionId")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    )?;
    let token_budget = request.get("tokenBudget").and_then(Value::as_i64);
    let char_budget = request.get("charBudget").and_then(Value::as_i64);
    let decision = agent_memory_store()?
        .run_adaptive_trim(&session_id, token_budget, char_budget)
        .map_err(|error| AgentError::Provider(format!("agent memory trim failed: {error}")))?;
    emit_event(AgentRuntimeEvent::ContextTrimmed {
        session_id,
        detail: serde_json::to_value(&decision).unwrap_or_else(|_| json!({})),
    });
    encode(&decision)
}

pub fn agent_memory_recover_run_json(payload: String) -> Result<String, AgentError> {
    let request: SessionRequest = parse_request(&payload)?;
    let session_id = resolve_memory_session_id(request.session_id)?;
    let recovered = agent_memory_store()?
        .recover_interrupted_turns_after_reload(&session_id)
        .map_err(|error| AgentError::Provider(format!("agent memory recover failed: {error}")))?;
    for turn_id in &recovered {
        emit_event(AgentRuntimeEvent::TurnRecovered {
            session_id: session_id.clone(),
            turn_id: turn_id.clone(),
        });
    }
    encode(&json!({
        "sessionId": session_id,
        "recoveredTurnIds": recovered,
    }))
}

pub fn agent_memory_shared_search_json(payload: String) -> Result<String, AgentError> {
    let request: Value = parse_request(&payload)?;
    let query = request.get("query").and_then(Value::as_str);
    let records = agent_memory_store()?
        .search_shared_memory(query)
        .map_err(|error| {
            AgentError::Provider(format!("agent memory shared search failed: {error}"))
        })?;
    encode(&json!({ "records": records }))
}

pub fn agent_memory_shared_update_json(payload: String) -> Result<String, AgentError> {
    let request: Value = parse_request(&payload)?;
    let scope = request
        .get("scope")
        .and_then(Value::as_str)
        .unwrap_or("global");
    let content = request.get("content").cloned().unwrap_or_else(|| json!({}));
    let evidence_refs = request
        .get("evidenceRefs")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let negative = request
        .get("negative")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let store = agent_memory_store()?;
    let status = match request.get("status").and_then(Value::as_str) {
        Some("active") => SharedMemoryStatus::Active,
        Some("delayed_promotion") => SharedMemoryStatus::DelayedPromotion,
        Some("conflict_candidate") => SharedMemoryStatus::ConflictCandidate,
        Some("deprecated") => SharedMemoryStatus::Deprecated,
        Some("rejected") => SharedMemoryStatus::Rejected,
        Some(_) => SharedMemoryStatus::Candidate,
        None => store
            .infer_shared_memory_status(scope, &content, &evidence_refs, negative)
            .map_err(|error| {
                AgentError::Provider(format!("agent memory shared scoring failed: {error}"))
            })?,
    };
    let record = store
        .update_shared_memory(scope, content, evidence_refs, status, negative)
        .map_err(|error| {
            AgentError::Provider(format!("agent memory shared update failed: {error}"))
        })?;
    encode(&record)
}

fn recover_stalled_turn_if_needed(session: &mut AgentSession) -> Option<String> {
    if session.snapshot.turn_status != TurnStatus::Running {
        return None;
    }
    let stale_after = ChronoDuration::seconds(STALLED_TURN_TIMEOUT_SECS);
    if Utc::now().signed_duration_since(session.snapshot.updated_at) <= stale_after {
        return None;
    }

    if let Some(signal) = session.shutdown_signal.take() {
        signal.fire();
    }

    let now = Utc::now();
    let turn_id = session.snapshot.active_turn_id.take();
    for tool in &mut session.snapshot.tools {
        if tool.status == ToolActivityStatus::Running {
            tool.status = ToolActivityStatus::Failed;
            tool.label = finished_tool_label(&tool.name, true);
            tool.finished_at = Some(now);
            if tool.output.is_none() {
                tool.output = Some(json!({
                    "content": "Lyra recovered this tool after the agent turn stopped producing runtime events.",
                    "error": "stalled turn recovered"
                }));
            }
        }
    }
    session.snapshot.turn_status = TurnStatus::Cancelled;
    session.snapshot.follow = AgentFollowState {
        running: false,
        activity: None,
    };
    session.snapshot.updated_at = now;
    turn_id
}

pub fn save_session_json(payload: String) -> Result<String, AgentError> {
    let request: SessionSaveRequest = parse_request(&payload)?;
    let label = normalize_optional_owned(request.label);
    let persisted_label = label.clone();
    mutate_session_metadata(
        &request.session_id,
        move |session| {
            session.mark_saved(persisted_label);
        },
        move |agent| agent.mark_session_saved(label),
    )
}

pub fn unsave_session_json(payload: String) -> Result<String, AgentError> {
    let request: SessionDeleteRequest = parse_request(&payload)?;
    let session_id = required_trimmed(Some(&request.session_id), "sessionId")?;
    mutate_session_metadata(
        &session_id,
        |session| {
            session.unmark_saved();
        },
        |agent| agent.unmark_session_saved(),
    )
}

pub fn rename_session_json(payload: String) -> Result<String, AgentError> {
    let request: SessionRenameRequest = parse_request(&payload)?;
    let title = normalize_optional_owned(request.title);
    let persisted_title = title.clone();
    mutate_session_metadata(
        &request.session_id,
        move |session| {
            session.rename_title(persisted_title);
        },
        move |agent| agent.rename_session_title(title).map(|_| ()),
    )
}

pub fn archive_session_json(payload: String) -> Result<String, AgentError> {
    let request: SessionArchiveRequest = parse_request(&payload)?;
    mutate_session_metadata(
        &request.session_id,
        |session| {
            session.set_archived(request.archived);
        },
        |agent| agent.set_session_archived(request.archived),
    )
}

pub fn delete_session_json(payload: String) -> Result<String, AgentError> {
    let request: SessionDeleteRequest = parse_request(&payload)?;
    let session_id = required_trimmed(Some(&request.session_id), "sessionId")?;
    {
        let runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
        if let Some(session) = runtime.sessions.get(&session_id)
            && (session.snapshot.follow.running || session.shutdown_signal.is_some())
        {
            return Err(AgentError::BadRequest(format!(
                "cannot delete running session: {}",
                session_id
            )));
        }
    }

    let store = agent_memory_store()?;
    let existed_in_memory = store
        .read_session(&session_id)
        .map_err(|error| AgentError::Provider(format!("agent memory read failed: {error}")))?
        .is_some();
    if !existed_in_memory {
        return Err(AgentError::SessionNotFound(session_id));
    }
    store
        .delete_session(&session_id)
        .map_err(|error| AgentError::Provider(format!("agent memory delete failed: {error}")))?;

    {
        let mut runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
        runtime.sessions.remove(&session_id);
        if runtime.active_session_id.as_deref() == Some(session_id.as_str()) {
            runtime.active_session_id = None;
        }
    }
    cancel_pending_clarifications_for_session(&session_id);

    encode(&json!({
        "sessionId": session_id,
        "deleted": true
    }))
}

pub fn send_turn_json(payload: String) -> Result<String, AgentError> {
    let request: SendTurnRequest = parse_request(&payload)?;
    let _compat_profile_id = request.provider_profile_id.as_deref();
    let _compat_profile = request.provider_profile.as_ref();
    let response = start_jcode_turn(request.session_id, request.text, request.images)?;
    encode(&response)
}

pub fn start_selfdev_session_json(payload: String) -> Result<String, AgentError> {
    let request: SelfDevStartRequest = parse_request(&payload)?;
    let repo_dir = resolve_lyra_repo_dir()?;
    let parent_session_id = request
        .parent_session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let inherit_context = request.inherit_context.unwrap_or(false);
    let mut inherited_context = false;
    let mut session = if inherit_context {
        if let Some(parent_id) = parent_session_id.as_deref() {
            match jcode_session_for_memory_session(parent_id) {
                Ok(parent) => {
                    let mut child = Session::create(
                        Some(parent_id.to_string()),
                        Some("Self-Dev Lab".to_string()),
                    );
                    child.replace_messages(parent.messages.clone());
                    child.compaction = parent.compaction.clone();
                    child.model = parent.model.clone();
                    child.provider_key = parent.provider_key.clone();
                    child.subagent_model = parent.subagent_model.clone();
                    child.improve_mode = parent.improve_mode;
                    child.autoreview_enabled = parent.autoreview_enabled;
                    child.autojudge_enabled = parent.autojudge_enabled;
                    child.memory_injections = parent.memory_injections.clone();
                    child.replay_events = parent.replay_events.clone();
                    inherited_context = true;
                    child
                }
                Err(_) => Session::create(None, Some("Self-Dev Lab".to_string())),
            }
        } else {
            Session::create(None, Some("Self-Dev Lab".to_string()))
        }
    } else {
        Session::create(None, Some("Self-Dev Lab".to_string()))
    };
    session.set_canary("self-dev");
    apply_session_working_dir(&mut session, repo_dir.to_string_lossy().as_ref());
    session.mark_active();
    persist_jcode_session_adapter(&session)?;

    let snapshot = snapshot_from_jcode_session(
        &session,
        TurnStatus::Idle,
        None,
        AgentFollowState {
            running: false,
            activity: None,
        },
        Vec::new(),
    );
    let agent = build_agent_blocking(session)?;
    {
        let mut runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
        runtime.sessions.insert(
            snapshot.id.clone(),
            AgentSession {
                snapshot: snapshot.clone(),
                agent,
                shutdown_signal: None,
            },
        );
    }
    emit_event(AgentRuntimeEvent::SessionSnapshot {
        snapshot: snapshot.clone(),
    });

    let prompt = build_selfdev_start_prompt(
        request.prompt.as_deref(),
        request.target.as_deref(),
        repo_dir.to_string_lossy().as_ref(),
    );
    let turn = if prompt.trim().is_empty() {
        None
    } else {
        Some(start_jcode_turn_scoped(
            Some(snapshot.id.clone()),
            prompt,
            Vec::new(),
            None,
            false,
        )?)
    };
    let latest_snapshot = RUNTIME
        .lock()
        .ok()
        .and_then(|runtime| {
            runtime
                .sessions
                .get(&snapshot.id)
                .map(|session| session.snapshot.clone())
        })
        .unwrap_or_else(|| snapshot.clone());
    encode(&SelfDevStartResponse {
        session_id: snapshot.id,
        repo_dir: repo_dir.display().to_string(),
        snapshot: latest_snapshot,
        turn_id: turn.as_ref().and_then(|response| response.turn_id.clone()),
        status: turn
            .as_ref()
            .map(|response| response.status)
            .unwrap_or("idle"),
        inherited_context,
    })
}

pub fn selfdev_status_json(payload: String) -> Result<String, AgentError> {
    let request: SelfDevStatusRequest = parse_request(&payload)?;
    let repo_dir = resolve_lyra_repo_dir().ok();
    let output = crate::tool::selfdev::selfdev_status_output()
        .map_err(|error| AgentError::Provider(error.to_string()))?;
    encode(&SelfDevStatusResponse {
        available: repo_dir.is_some(),
        repo_dir: repo_dir.map(|path| path.display().to_string()),
        session_id: request.session_id,
        output: output.output,
        title: output.title,
        metadata: output.metadata,
    })
}

pub fn start_jcode_overnight_json(payload: String) -> Result<String, AgentError> {
    let request: OvernightStartRequest = parse_request(&payload)?;
    let duration = crate::overnight::parse_duration(&format!("{}m", request.duration_minutes))
        .map_err(AgentError::BadRequest)?;
    let parent_session_id = resolve_existing_session_id(request.session_id)?;
    reject_loaded_running_action(&parent_session_id, "overnight")?;
    let parent = jcode_session_for_memory_session(&parent_session_id)?;
    let inherit_context = request.inherit_context.unwrap_or(true);
    let mut parent_for_launch = parent.clone();
    if !inherit_context {
        parent_for_launch.replace_messages(Vec::new());
        parent_for_launch.compaction = None;
    }

    let provider: Arc<dyn Provider> = Arc::new(MultiProvider::new());
    if let Some(model) = parent
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        crate::provider::set_model_with_auth_refresh(provider.as_ref(), model)
            .map_err(|error| AgentError::Provider(error.to_string()))?;
    }
    let registry = block_on(async { Registry::new(provider.clone()).await })?;
    let working_dir = PathBuf::from(session_working_dir(&parent));
    let launch = crate::overnight::start_overnight_run(crate::overnight::OvernightStartOptions {
        duration,
        mission: normalized_nonempty(request.mission.as_deref()),
        parent_session: parent_for_launch,
        provider,
        registry,
        working_dir: Some(working_dir),
        use_current_session: false,
    })
    .map_err(|error| AgentError::Provider(error.to_string()))?;
    let run = overnight_run_snapshot(&launch.manifest, true)?;
    encode(&JcodeOvernightStartResponse {
        run,
        inherited_context: inherit_context,
    })
}

pub fn list_jcode_overnight_json(_payload: String) -> Result<String, AgentError> {
    let manifests = overnight_manifests()?;
    let latest_run_id = manifests.last().map(|manifest| manifest.run_id.clone());
    let runs = manifests
        .iter()
        .rev()
        .map(|manifest| overnight_run_snapshot(manifest, false))
        .collect::<Result<Vec<_>, _>>()?;
    encode(&JcodeOvernightListResponse {
        runs,
        latest_run_id,
    })
}

pub fn status_jcode_overnight_json(payload: String) -> Result<String, AgentError> {
    let request: OvernightRunRequest = parse_request(&payload)?;
    let run = requested_overnight_manifest(request.run_id)?
        .map(|manifest| overnight_run_snapshot(&manifest, false))
        .transpose()?;
    encode(&JcodeOvernightRunResponse { run })
}

pub fn log_jcode_overnight_json(payload: String) -> Result<String, AgentError> {
    let request: OvernightRunRequest = parse_request(&payload)?;
    let run = requested_overnight_manifest(request.run_id)?
        .map(|manifest| overnight_run_snapshot(&manifest, false))
        .transpose()?;
    encode(&JcodeOvernightRunResponse { run })
}

pub fn review_jcode_overnight_json(payload: String) -> Result<String, AgentError> {
    let request: OvernightRunRequest = parse_request(&payload)?;
    let run = requested_overnight_manifest(request.run_id)?
        .map(|manifest| overnight_run_snapshot(&manifest, true))
        .transpose()?;
    encode(&JcodeOvernightRunResponse { run })
}

pub fn cancel_jcode_overnight_json(payload: String) -> Result<String, AgentError> {
    let request: OvernightRunRequest = parse_request(&payload)?;
    let manifest = requested_overnight_manifest(request.run_id)?
        .ok_or_else(|| AgentError::SessionNotFound("overnight latest run".to_string()))?;
    let manifest = request_overnight_cancel(manifest)?;
    let run = overnight_run_snapshot(&manifest, true)?;
    encode(&JcodeOvernightRunResponse { run: Some(run) })
}

pub fn send_selfdev_turn_json(payload: String) -> Result<String, AgentError> {
    let request: SendTurnRequest = parse_request(&payload)?;
    let session_id = request
        .session_id
        .clone()
        .ok_or_else(|| AgentError::BadRequest("selfdev sessionId is required".to_string()))?;
    let session = jcode_session_for_memory_session(&session_id)?;
    if session_kind(&session) != AgentSessionKind::Selfdev {
        return Err(AgentError::BadRequest(format!(
            "session is not a self-dev session: {session_id}"
        )));
    }
    let response =
        start_jcode_turn_scoped(Some(session_id), request.text, request.images, None, false)?;
    encode(&response)
}

pub fn run_improve_session_json(payload: String) -> Result<String, AgentError> {
    let request: JcodeActionRunRequest = parse_request(&payload)?;
    let session_id = resolve_agent_session_id(request.session_id)?;
    reject_running_action(&session_id, "improve")?;
    let plan_only = request.plan_only.unwrap_or(false);
    persist_session_improve_mode(
        &session_id,
        session_improve_mode_for(JcodeGuiActionKind::Improve, plan_only),
    )?;
    let prompt = build_improve_prompt(plan_only, request.focus.as_deref());
    let response = start_jcode_turn(Some(session_id), prompt, Vec::new())?;
    encode(&response)
}

pub fn refactor_session_json(payload: String) -> Result<String, AgentError> {
    let request: JcodeActionRunRequest = parse_request(&payload)?;
    let session_id = resolve_agent_session_id(request.session_id)?;
    reject_running_action(&session_id, "refactor")?;
    let plan_only = request.plan_only.unwrap_or(false);
    persist_session_improve_mode(
        &session_id,
        session_improve_mode_for(JcodeGuiActionKind::Refactor, plan_only),
    )?;
    let prompt = build_refactor_prompt(plan_only, request.focus.as_deref());
    let response = start_jcode_turn(Some(session_id), prompt, Vec::new())?;
    encode(&response)
}

pub fn trigger_poke_session_json(payload: String) -> Result<String, AgentError> {
    let request: JcodePokeRequest = parse_request(&payload)?;
    let session_id = resolve_agent_session_id(request.session_id)?;
    reject_running_action(&session_id, "poke")?;
    let incomplete = incomplete_poke_todos(todo_items_for_session(&session_id)?);
    if incomplete.is_empty() {
        return encode(&JcodePokeResponse {
            session_id,
            turn_id: None,
            status: "idle",
            sent: false,
            incomplete_todo_count: 0,
        });
    }
    let incomplete_todo_count = incomplete.len();
    let prompt = build_poke_message(&incomplete);
    let response = start_jcode_turn(Some(session_id), prompt, Vec::new())?;
    encode(&JcodePokeResponse {
        session_id: response.session_id,
        turn_id: response.turn_id,
        status: response.status,
        sent: true,
        incomplete_todo_count,
    })
}

pub fn run_review_session_json(payload: String) -> Result<String, AgentError> {
    start_feedback_session_json(payload, JcodeFeedbackActionKind::Review)
}

pub fn run_judge_session_json(payload: String) -> Result<String, AgentError> {
    start_feedback_session_json(payload, JcodeFeedbackActionKind::Judge)
}

pub fn run_jcode_subagent_json(payload: String) -> Result<String, AgentError> {
    let request: JcodeSubagentRunRequest = parse_request(&payload)?;
    let prompt = request.prompt.trim().to_string();
    if prompt.is_empty() {
        return Err(AgentError::BadRequest(
            "subagent prompt is required".to_string(),
        ));
    }
    let session_id = resolve_agent_session_id(request.session_id)?;
    reject_running_action(&session_id, "subagent")?;
    let subagent_type = request
        .subagent_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("general")
        .to_string();
    let model = normalize_optional_owned(request.model);
    let continue_session_id = normalize_optional_owned(request.continue_session_id);
    let agent = agent_for_session(&session_id)?;
    let tool_id = run_manual_subagent_tool(
        &session_id,
        agent,
        prompt,
        subagent_type,
        model,
        continue_session_id,
    )?;
    let snapshot = refresh_runtime_snapshot_for_session(&session_id, TurnStatus::Idle, None)?;
    encode(&JcodeSubagentRunResponse {
        session_id,
        tool_id,
        snapshot,
    })
}

pub fn run_jcode_btw_json(payload: String) -> Result<String, AgentError> {
    let request: JcodeBtwRunRequest = parse_request(&payload)?;
    let question = request.question.trim().to_string();
    if question.is_empty() {
        return Err(AgentError::BadRequest(
            "side question is required".to_string(),
        ));
    }
    let session_id = resolve_agent_session_id(request.session_id)?;
    reject_running_action(&session_id, "btw")?;
    let side_panel = crate::side_panel::write_markdown_page(
        &session_id,
        BTW_PAGE_ID,
        Some("`/btw`"),
        &build_btw_loading_markdown(&question),
        true,
    )
    .map_err(|error| AgentError::Provider(error.to_string()))?;
    refresh_runtime_snapshot_for_session(&session_id, TurnStatus::Idle, None)?;
    let response = start_jcode_turn_with_system_reminder(
        Some(session_id.clone()),
        question.clone(),
        Vec::new(),
        Some(build_btw_system_reminder(&question)),
    )?;
    encode(&JcodeSidePanelActionResponse {
        session_id,
        turn_id: response.turn_id,
        status: response.status,
        side_panel: side_panel_snapshot(side_panel),
    })
}

pub fn split_jcode_session_json(payload: String) -> Result<String, AgentError> {
    let request: JcodeSessionActionRequest = parse_request(&payload)?;
    let parent_session_id = resolve_agent_session_id(request.session_id)?;
    reject_running_action(&parent_session_id, "split")?;
    let child = clone_split_session_for_gui(&parent_session_id)?;
    activate_child_session(parent_session_id, child)
}

pub fn transfer_jcode_session_json(payload: String) -> Result<String, AgentError> {
    let request: JcodeSessionActionRequest = parse_request(&payload)?;
    let parent_session_id = resolve_agent_session_id(request.session_id)?;
    reject_running_action(&parent_session_id, "transfer")?;
    let parent = jcode_session_for_memory_session(&parent_session_id)?;
    let provider = {
        let agent = agent_for_session(&parent_session_id)?;
        block_on(async move {
            let guard = agent.lock().await;
            guard.provider_fork()
        })?
    };
    let compaction = block_on(async {
        crate::compaction::build_transfer_compaction_state(
            provider,
            transfer_active_messages(&parent),
            parent.compaction.clone(),
        )
        .await
        .map_err(|error| AgentError::Provider(error.to_string()))
    })??;
    let child = create_transfer_child_session_for_gui(&parent_session_id, &parent, compaction)?;
    activate_child_session(parent_session_id, child)
}

pub fn compact_jcode_session_json(payload: String) -> Result<String, AgentError> {
    let request: JcodeSessionActionRequest = parse_request(&payload)?;
    let session_id = resolve_agent_session_id(request.session_id)?;
    reject_running_action(&session_id, "compact")?;
    let agent = agent_for_session(&session_id)?;
    let (message, success) = block_on(async move {
        let mut guard = agent.lock().await;
        guard.request_manual_compaction()
    })?;
    let snapshot = refresh_runtime_snapshot_for_session(&session_id, TurnStatus::Idle, None)?;
    encode(&JcodeCompactResponse {
        session_id,
        message,
        success,
        snapshot,
    })
}

pub fn update_jcode_session_automation_json(payload: String) -> Result<String, AgentError> {
    let patch: Value = parse_request(&payload)?;
    let request_session_id = patch
        .get("sessionId")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let session_id = resolve_agent_session_id(request_session_id)?;
    reject_running_action(&session_id, "automation update")?;

    let subagent_model_patch = patch
        .get("subagentModel")
        .map(|value| optional_string(value));
    let autoreview_patch = patch.get("autoreviewEnabled").map(bool_from_value);
    let autojudge_patch = patch.get("autojudgeEnabled").map(bool_from_value);

    let agent = agent_for_session(&session_id)?;
    block_on(async {
        let mut guard = agent.lock().await;
        if let Some(model) = subagent_model_patch {
            guard
                .set_subagent_model(model)
                .map_err(|error| AgentError::Provider(error.to_string()))?;
        }
        if let Some(enabled) = autoreview_patch {
            guard
                .set_autoreview_enabled(enabled?)
                .map_err(|error| AgentError::Provider(error.to_string()))?;
        }
        if let Some(enabled) = autojudge_patch {
            guard
                .set_autojudge_enabled(enabled?)
                .map_err(|error| AgentError::Provider(error.to_string()))?;
        }
        Ok::<_, AgentError>(())
    })??;
    let snapshot = refresh_runtime_snapshot_for_session(&session_id, TurnStatus::Idle, None)?;
    encode(&JcodeAutomationUpdateResponse {
        session_id,
        automation: snapshot.automation.clone(),
        snapshot,
    })
}

pub fn list_jcode_goals_json(payload: String) -> Result<String, AgentError> {
    let request: JcodeGoalsActionRequest = parse_request(&payload)?;
    let session_id = resolve_agent_session_id(request.session_id)?;
    let goals = goals_for_session(&session_id)?;
    let side_panel = side_panel_snapshot_for_session(&session_id);
    encode(&JcodeGoalsResponse {
        session_id,
        goals,
        focused_goal: None,
        side_panel,
    })
}

pub fn open_jcode_goals_json(payload: String) -> Result<String, AgentError> {
    let request: JcodeGoalsActionRequest = parse_request(&payload)?;
    let session_id = resolve_agent_session_id(request.session_id)?;
    let working_dir = session_working_dir(&jcode_session_for_memory_session(&session_id)?);
    let snapshot = crate::goal::open_goals_overview_for_session(
        &session_id,
        Some(Path::new(&working_dir)),
        true,
    )
    .map_err(|error| AgentError::Provider(error.to_string()))?;
    let goals = goals_for_session(&session_id)?;
    refresh_runtime_snapshot_for_session(&session_id, TurnStatus::Idle, None)?;
    encode(&JcodeGoalsResponse {
        session_id,
        goals,
        focused_goal: None,
        side_panel: side_panel_snapshot(snapshot),
    })
}

pub fn resume_jcode_goal_json(payload: String) -> Result<String, AgentError> {
    let request: JcodeGoalsActionRequest = parse_request(&payload)?;
    let session_id = resolve_agent_session_id(request.session_id)?;
    let working_dir = session_working_dir(&jcode_session_for_memory_session(&session_id)?);
    let result =
        crate::goal::resume_goal_for_session(&session_id, Some(Path::new(&working_dir)), true)
            .map_err(|error| AgentError::Provider(error.to_string()))?;
    let side_panel = result
        .as_ref()
        .map(|result| side_panel_snapshot(result.snapshot.clone()))
        .unwrap_or_else(|| side_panel_snapshot_for_session(&session_id));
    let focused_goal = result
        .as_ref()
        .map(|result| serde_json::to_value(&result.goal))
        .transpose()
        .map_err(|error| AgentError::Serialization(error.to_string()))?;
    refresh_runtime_snapshot_for_session(&session_id, TurnStatus::Idle, None)?;
    let goals = goals_for_session(&session_id)?;
    encode(&JcodeGoalsResponse {
        session_id,
        goals,
        focused_goal,
        side_panel,
    })
}

pub fn show_jcode_goal_json(payload: String) -> Result<String, AgentError> {
    let request: JcodeGoalsActionRequest = parse_request(&payload)?;
    let goal_id = request
        .goal_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AgentError::BadRequest("goalId is required".to_string()))?;
    let session_id = resolve_agent_session_id(request.session_id)?;
    let working_dir = session_working_dir(&jcode_session_for_memory_session(&session_id)?);
    let result = crate::goal::open_goal_for_session(
        &session_id,
        Some(Path::new(&working_dir)),
        goal_id,
        true,
    )
    .map_err(|error| AgentError::Provider(error.to_string()))?;
    let result = result.ok_or_else(|| AgentError::SessionNotFound(goal_id.to_string()))?;
    let side_panel = side_panel_snapshot(result.snapshot.clone());
    let focused_goal = serde_json::to_value(&result.goal)
        .map_err(|error| AgentError::Serialization(error.to_string()))?;
    refresh_runtime_snapshot_for_session(&session_id, TurnStatus::Idle, None)?;
    let goals = goals_for_session(&session_id)?;
    encode(&JcodeGoalsResponse {
        session_id,
        goals,
        focused_goal: Some(focused_goal),
        side_panel,
    })
}

pub fn list_jcode_accounts_json(_payload: String) -> Result<String, AgentError> {
    encode(&jcode_accounts_response())
}

pub fn list_jcode_login_providers_json(_payload: String) -> Result<String, AgentError> {
    let status = crate::auth::AuthStatus::check_fast();
    let providers = gui_login_providers()
        .into_iter()
        .map(|provider| {
            let state = status.state_for_provider(provider);
            JcodeLoginProviderSnapshot {
                id: provider.id.to_string(),
                display_name: provider.display_name.to_string(),
                auth_kind: provider.auth_kind.label().to_string(),
                status_method: provider.auth_status_method.to_string(),
                detail: provider.menu_detail.to_string(),
                recommended: provider.recommended,
                configured: state != crate::auth::AuthState::NotConfigured,
                state: auth_state_string(state).to_string(),
                requires_callback: login_provider_requires_callback(provider),
                requires_api_key: login_provider_requires_api_key(provider),
            }
        })
        .collect();
    encode(&JcodeLoginProvidersResponse {
        providers,
        auth_status: auth_status_snapshot_value(),
    })
}

pub fn start_jcode_account_login_json(payload: String) -> Result<String, AgentError> {
    let request: JcodeAccountLoginStartRequest = parse_request(&payload)?;
    let provider = resolve_gui_login_provider(&request.provider)?;
    let label = request
        .label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let response = match provider.target {
        crate::provider_catalog::LoginProviderTarget::Claude => {
            let (verifier, challenge) = crate::auth::oauth::generate_pkce_public();
            let account_label = crate::auth::claude::login_target_label(label.as_deref())
                .unwrap_or_else(|_| crate::auth::claude::primary_account_label());
            let redirect_uri = crate::auth::oauth::claude::REDIRECT_URI.to_string();
            let auth_url =
                crate::auth::oauth::claude_auth_url(&redirect_uri, &challenge, &verifier);
            login_start_response(
                provider.id,
                Some(account_label.clone()),
                JcodeAccountLoginFlow {
                    provider: provider.id.to_string(),
                    label: Some(account_label),
                    verifier: Some(verifier),
                    state: None,
                    redirect_uri: Some(redirect_uri),
                    auth_kind: provider.auth_kind.label().to_string(),
                    gmail_access_tier: None,
                },
                Some(auth_url),
                Some("Paste the Claude callback URL or authorization code.".to_string()),
                "Open Claude OAuth in the browser, then paste the callback URL or code here.",
                true,
                false,
            )?
        }
        crate::provider_catalog::LoginProviderTarget::OpenAi => {
            let (verifier, challenge) = crate::auth::oauth::generate_pkce_public();
            let state = crate::auth::oauth::generate_state_public();
            let account_label = crate::auth::codex::login_target_label(label.as_deref())
                .unwrap_or_else(|_| "openai-1".to_string());
            let redirect_uri =
                crate::auth::oauth::openai::redirect_uri(crate::auth::oauth::openai::DEFAULT_PORT);
            let auth_url = crate::auth::oauth::openai_auth_url_with_prompt(
                &redirect_uri,
                &challenge,
                &state,
                Some("login"),
            );
            login_start_response(
                provider.id,
                Some(account_label.clone()),
                JcodeAccountLoginFlow {
                    provider: provider.id.to_string(),
                    label: Some(account_label),
                    verifier: Some(verifier),
                    state: Some(state),
                    redirect_uri: Some(redirect_uri),
                    auth_kind: provider.auth_kind.label().to_string(),
                    gmail_access_tier: None,
                },
                Some(auth_url),
                Some(
                    "Paste the full OpenAI callback URL so Lyra Agent can verify state."
                        .to_string(),
                ),
                "Open OpenAI OAuth in the browser, then paste the full callback URL.",
                true,
                false,
            )?
        }
        crate::provider_catalog::LoginProviderTarget::Gemini => {
            let (verifier, challenge) = crate::auth::oauth::generate_pkce_public();
            let state = crate::auth::oauth::generate_state_public();
            let redirect_uri = "https://codeassist.google.com/authcode".to_string();
            let auth_url =
                crate::auth::gemini::build_manual_auth_url(&redirect_uri, &challenge, &state)
                    .map_err(|error| AgentError::Provider(error.to_string()))?;
            login_start_response(
                provider.id,
                Some(label.unwrap_or_else(|| "gemini".to_string())),
                JcodeAccountLoginFlow {
                    provider: provider.id.to_string(),
                    label: Some("gemini".to_string()),
                    verifier: Some(verifier),
                    state: Some(state),
                    redirect_uri: Some(redirect_uri),
                    auth_kind: provider.auth_kind.label().to_string(),
                    gmail_access_tier: None,
                },
                Some(auth_url),
                Some("Paste the Gemini authorization code.".to_string()),
                "Open Google Gemini authorization, then paste the authorization code.",
                true,
                false,
            )?
        }
        crate::provider_catalog::LoginProviderTarget::Antigravity => {
            let (verifier, challenge) = crate::auth::oauth::generate_pkce_public();
            let state = crate::auth::oauth::generate_state_public();
            let redirect_uri =
                crate::auth::antigravity::redirect_uri(crate::auth::antigravity::DEFAULT_PORT);
            let auth_url =
                crate::auth::antigravity::build_auth_url(&redirect_uri, &challenge, &state)
                    .map_err(|error| AgentError::Provider(error.to_string()))?;
            login_start_response(
                provider.id,
                Some(label.unwrap_or_else(|| "antigravity".to_string())),
                JcodeAccountLoginFlow {
                    provider: provider.id.to_string(),
                    label: Some("antigravity".to_string()),
                    verifier: Some(verifier),
                    state: Some(state),
                    redirect_uri: Some(redirect_uri),
                    auth_kind: provider.auth_kind.label().to_string(),
                    gmail_access_tier: None,
                },
                Some(auth_url),
                Some("Paste the full Antigravity callback URL.".to_string()),
                "Open Antigravity OAuth in the browser, then paste the full callback URL.",
                true,
                false,
            )?
        }
        crate::provider_catalog::LoginProviderTarget::Google => {
            let tier = parse_gmail_access_tier(request.gmail_access_tier.as_deref())?;
            let creds = google_credentials_for_login(
                request.google_client_id.as_deref(),
                request.google_client_secret.as_deref(),
            )?;
            let (verifier, challenge) = crate::auth::oauth::generate_pkce_public();
            let state = crate::auth::oauth::generate_state_public();
            let redirect_uri = format!("http://127.0.0.1:{}", crate::auth::google::DEFAULT_PORT);
            let auth_url = crate::auth::google::build_auth_url(
                &creds,
                tier,
                &redirect_uri,
                &challenge,
                &state,
            );
            let account_label = label.unwrap_or_else(|| "gmail".to_string());
            login_start_response(
                provider.id,
                Some(account_label.clone()),
                JcodeAccountLoginFlow {
                    provider: provider.id.to_string(),
                    label: Some(account_label),
                    verifier: Some(verifier),
                    state: Some(state),
                    redirect_uri: Some(redirect_uri),
                    auth_kind: provider.auth_kind.label().to_string(),
                    gmail_access_tier: Some(gmail_access_tier_id(tier).to_string()),
                },
                Some(auth_url),
                Some("Paste the full Google/Gmail callback URL.".to_string()),
                "Open Google/Gmail authorization, then paste the full callback URL.",
                true,
                false,
            )?
        }
        target if login_target_is_api_key(target) => {
            let flow = JcodeAccountLoginFlow {
                provider: provider.id.to_string(),
                label,
                verifier: None,
                state: None,
                redirect_uri: None,
                auth_kind: provider.auth_kind.label().to_string(),
                gmail_access_tier: None,
            };
            login_start_response(
                provider.id,
                flow.label.clone(),
                flow,
                None,
                Some("Enter an API key and model details below.".to_string()),
                "Enter the provider API key and save it to Lyra Agent config.",
                false,
                true,
            )?
        }
        _ => {
            return Err(AgentError::BadRequest(format!(
                "{} login is not available in Lyra Agent settings yet",
                provider.display_name
            )));
        }
    };

    encode(&response)
}

pub fn complete_jcode_account_login_json(payload: String) -> Result<String, AgentError> {
    let request: JcodeAccountLoginCompleteRequest = parse_request(&payload)?;
    let provider = resolve_gui_login_provider(&request.provider)?;

    let message = match provider.target {
        crate::provider_catalog::LoginProviderTarget::Claude => {
            let flow = decode_login_flow(request.flow_id.as_deref())?;
            ensure_flow_provider(&flow, provider.id)?;
            let verifier = required_trimmed(flow.verifier.as_deref(), "flow verifier")?;
            let redirect_uri = required_trimmed(flow.redirect_uri.as_deref(), "redirect URI")?;
            let input = required_trimmed(request.callback_input.as_deref(), "callback input")?;
            let selected_redirect_uri =
                crate::auth::oauth::claude_redirect_uri_for_input(&input, &redirect_uri);
            let tokens = block_on(crate::auth::oauth::exchange_claude_code(
                &verifier,
                &input,
                &selected_redirect_uri,
            ))?
            .map_err(|error| AgentError::Provider(error.to_string()))?;
            let label = request
                .label
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .or(flow.label)
                .unwrap_or_else(|| crate::auth::claude::primary_account_label());
            crate::auth::oauth::save_claude_tokens_for_account(&tokens, &label)
                .map_err(|error| AgentError::Provider(error.to_string()))?;
            crate::config::Config::set_default_model(None, Some("anthropic"))
                .map_err(|error| AgentError::Provider(error.to_string()))?;
            format!("Signed in to Claude as {label}.")
        }
        crate::provider_catalog::LoginProviderTarget::OpenAi => {
            let flow = decode_login_flow(request.flow_id.as_deref())?;
            ensure_flow_provider(&flow, provider.id)?;
            let verifier = required_trimmed(flow.verifier.as_deref(), "flow verifier")?;
            let state = required_trimmed(flow.state.as_deref(), "OAuth state")?;
            let redirect_uri = required_trimmed(flow.redirect_uri.as_deref(), "redirect URI")?;
            let input = required_trimmed(request.callback_input.as_deref(), "callback input")?;
            let tokens = block_on(crate::auth::oauth::exchange_openai_callback_input(
                &verifier,
                &input,
                &state,
                &redirect_uri,
            ))?
            .map_err(|error| AgentError::Provider(error.to_string()))?;
            let label = request
                .label
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .or(flow.label)
                .unwrap_or_else(|| "openai-1".to_string());
            crate::auth::oauth::save_openai_tokens_for_account(&tokens, &label)
                .map_err(|error| AgentError::Provider(error.to_string()))?;
            crate::config::Config::set_default_model(None, Some("openai"))
                .map_err(|error| AgentError::Provider(error.to_string()))?;
            format!("Signed in to OpenAI as {label}.")
        }
        crate::provider_catalog::LoginProviderTarget::Gemini => {
            let flow = decode_login_flow(request.flow_id.as_deref())?;
            ensure_flow_provider(&flow, provider.id)?;
            let verifier = required_trimmed(flow.verifier.as_deref(), "flow verifier")?;
            let state = required_trimmed(flow.state.as_deref(), "OAuth state")?;
            let redirect_uri = required_trimmed(flow.redirect_uri.as_deref(), "redirect URI")?;
            let input = required_trimmed(request.callback_input.as_deref(), "callback input")?;
            let tokens = block_on(crate::auth::gemini::exchange_callback_input(
                &verifier,
                &input,
                Some(&state),
                &redirect_uri,
            ))?
            .map_err(|error| AgentError::Provider(error.to_string()))?;
            if request.set_default.unwrap_or(true) {
                crate::config::Config::set_default_model(None, Some("gemini"))
                    .map_err(|error| AgentError::Provider(error.to_string()))?;
            }
            format!(
                "Signed in to Gemini{}.",
                tokens
                    .email
                    .as_deref()
                    .map(|email| format!(" as {email}"))
                    .unwrap_or_default()
            )
        }
        crate::provider_catalog::LoginProviderTarget::Antigravity => {
            let flow = decode_login_flow(request.flow_id.as_deref())?;
            ensure_flow_provider(&flow, provider.id)?;
            let verifier = required_trimmed(flow.verifier.as_deref(), "flow verifier")?;
            let state = required_trimmed(flow.state.as_deref(), "OAuth state")?;
            let redirect_uri = required_trimmed(flow.redirect_uri.as_deref(), "redirect URI")?;
            let input = required_trimmed(request.callback_input.as_deref(), "callback input")?;
            let tokens = block_on(crate::auth::antigravity::exchange_callback_input(
                &verifier,
                &input,
                Some(&state),
                &redirect_uri,
            ))?
            .map_err(|error| AgentError::Provider(error.to_string()))?;
            if request.set_default.unwrap_or(true) {
                crate::config::Config::set_default_model(None, Some("antigravity"))
                    .map_err(|error| AgentError::Provider(error.to_string()))?;
            }
            format!(
                "Signed in to Antigravity{}.",
                tokens
                    .email
                    .as_deref()
                    .map(|email| format!(" as {email}"))
                    .unwrap_or_default()
            )
        }
        crate::provider_catalog::LoginProviderTarget::Google => {
            let flow = decode_login_flow(request.flow_id.as_deref())?;
            ensure_flow_provider(&flow, provider.id)?;
            let verifier = required_trimmed(flow.verifier.as_deref(), "flow verifier")?;
            let state = required_trimmed(flow.state.as_deref(), "OAuth state")?;
            let redirect_uri = required_trimmed(flow.redirect_uri.as_deref(), "redirect URI")?;
            let input = required_trimmed(request.callback_input.as_deref(), "callback input")?;
            let tier = parse_gmail_access_tier(flow.gmail_access_tier.as_deref())?;
            let creds = crate::auth::google::load_credentials()
                .map_err(|error| AgentError::Provider(error.to_string()))?;
            let tokens = block_on(crate::auth::google::exchange_callback_input(
                &creds,
                &verifier,
                &input,
                &state,
                &redirect_uri,
                tier,
            ))?
            .map_err(|error| AgentError::Provider(error.to_string()))?;
            format!(
                "Signed in to Google/Gmail{} with {}.",
                tokens
                    .email
                    .as_deref()
                    .map(|email| format!(" as {email}"))
                    .unwrap_or_default(),
                tokens.tier.label()
            )
        }
        target if login_target_is_api_key(target) => {
            let api_key = required_trimmed(request.api_key.as_deref(), "API key")?;
            let (profile_name, base_url, default_model, provider_type) =
                api_key_profile_defaults(provider, &request)?;
            let custom_auth_header = request
                .auth_header
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned);
            let save_request = JcodeProviderProfileSaveRequest {
                profile_name: profile_name.clone(),
                base_url,
                default_model: default_model.clone(),
                api_key: Some(api_key),
                api_key_env: None,
                env_file: None,
                auth: Some(if custom_auth_header.is_some() {
                    "header".to_string()
                } else {
                    "bearer".to_string()
                }),
                auth_header: custom_auth_header,
                provider_type: Some(provider_type),
                set_default: Some(request.set_default.unwrap_or(true)),
                models: default_model.as_ref().map(|id| {
                    vec![JcodeProviderProfileModelRequest {
                        id: id.clone(),
                        context_window: None,
                    }]
                }),
            };
            save_jcode_provider_profile_json(
                serde_json::to_string(&save_request)
                    .map_err(|error| AgentError::Serialization(error.to_string()))?,
            )?;
            format!("Saved API key provider {profile_name}.")
        }
        _ => {
            return Err(AgentError::BadRequest(format!(
                "{} login cannot be completed from Lyra Agent settings yet",
                provider.display_name
            )));
        }
    };

    crate::auth::AuthStatus::invalidate_cache();
    apply_default_provider_runtime_env(&crate::config::Config::load());
    refresh_runtime_agents_after_provider_config_change();

    encode(&JcodeAccountLoginCompleteResponse {
        accounts: jcode_accounts_response(),
        message,
    })
}

pub fn login_jcode_account_json(payload: String) -> Result<String, AgentError> {
    let request: JcodeAccountLoginRequest = parse_request(&payload)?;
    let provider = request
        .provider
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("openai-compatible");
    let profile_name = request
        .profile_name
        .or(request.label)
        .unwrap_or_else(|| provider.replace([' ', '/'], "-"));
    let base_url = request
        .base_url
        .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
    let save_request = JcodeProviderProfileSaveRequest {
        profile_name,
        base_url,
        default_model: request.default_model,
        api_key: request.api_key,
        api_key_env: None,
        env_file: None,
        auth: Some("bearer".to_string()),
        auth_header: None,
        provider_type: Some(provider.to_string()),
        set_default: request.set_default,
        models: None,
    };
    save_jcode_provider_profile_json(
        serde_json::to_string(&save_request)
            .map_err(|error| AgentError::Serialization(error.to_string()))?,
    )?;
    list_jcode_accounts_json("{}".to_string())
}

pub fn switch_jcode_account_json(payload: String) -> Result<String, AgentError> {
    let request: JcodeAccountRequest = parse_request(&payload)?;
    let provider = required_trimmed(request.provider.as_deref(), "provider")?;
    let label = required_trimmed(request.label.as_deref(), "label")?;
    match provider.as_str() {
        "openai" => {
            crate::auth::codex::set_active_account(&label)
                .map_err(|error| AgentError::Provider(error.to_string()))?;
            crate::config::Config::set_default_model(None, Some("openai"))
                .map_err(|error| AgentError::Provider(error.to_string()))?;
        }
        "anthropic" | "claude" => {
            crate::auth::claude::set_active_account(&label)
                .map_err(|error| AgentError::Provider(error.to_string()))?;
            crate::config::Config::set_default_model(None, Some("anthropic"))
                .map_err(|error| AgentError::Provider(error.to_string()))?;
        }
        "gemini" => {
            if crate::auth::gemini::load_tokens().is_err() {
                return Err(AgentError::SessionNotFound(label));
            }
            crate::config::Config::set_default_model(None, Some("gemini"))
                .map_err(|error| AgentError::Provider(error.to_string()))?;
        }
        "antigravity" => {
            if crate::auth::antigravity::load_tokens().is_err() {
                return Err(AgentError::SessionNotFound(label));
            }
            crate::config::Config::set_default_model(None, Some("antigravity"))
                .map_err(|error| AgentError::Provider(error.to_string()))?;
        }
        "google" => {
            if crate::auth::google::load_tokens().is_err() {
                return Err(AgentError::SessionNotFound(label));
            }
        }
        _ => {
            let mut config = crate::config::Config::load();
            if !config.providers.contains_key(&label) {
                return Err(AgentError::SessionNotFound(label));
            }
            config.provider.default_provider = Some(label);
            config
                .save()
                .map_err(|error| AgentError::Provider(error.to_string()))?;
        }
    }
    crate::auth::AuthStatus::invalidate_cache();
    apply_default_provider_runtime_env(&crate::config::Config::load());
    refresh_runtime_agents_after_provider_config_change();
    list_jcode_accounts_json("{}".to_string())
}

pub fn remove_jcode_account_json(payload: String) -> Result<String, AgentError> {
    let request: JcodeAccountRequest = parse_request(&payload)?;
    let provider = required_trimmed(request.provider.as_deref(), "provider")?;
    let label = required_trimmed(request.label.as_deref(), "label")?;
    match provider.as_str() {
        "openai" => crate::auth::codex::remove_account(&label)
            .map_err(|error| AgentError::Provider(error.to_string()))?,
        "anthropic" | "claude" => crate::auth::claude::remove_account(&label)
            .map_err(|error| AgentError::Provider(error.to_string()))?,
        "gemini" => {
            crate::auth::gemini::clear_tokens()
                .map_err(|error| AgentError::Provider(error.to_string()))?;
            let mut config = crate::config::Config::load();
            if config.provider.default_provider.as_deref() == Some("gemini") {
                config.provider.default_provider = None;
                config
                    .save()
                    .map_err(|error| AgentError::Provider(error.to_string()))?;
            }
        }
        "antigravity" => {
            let path = crate::auth::antigravity::tokens_path()
                .map_err(|error| AgentError::Provider(error.to_string()))?;
            if path.exists() {
                std::fs::remove_file(&path)
                    .map_err(|error| AgentError::Provider(error.to_string()))?;
            }
            let mut config = crate::config::Config::load();
            if config.provider.default_provider.as_deref() == Some("antigravity") {
                config.provider.default_provider = None;
                config
                    .save()
                    .map_err(|error| AgentError::Provider(error.to_string()))?;
            }
        }
        "google" => {
            let path = crate::auth::google::tokens_path()
                .map_err(|error| AgentError::Provider(error.to_string()))?;
            if path.exists() {
                std::fs::remove_file(&path)
                    .map_err(|error| AgentError::Provider(error.to_string()))?;
            }
        }
        _ => {
            let mut config = crate::config::Config::load();
            if config.providers.remove(&label).is_none() {
                return Err(AgentError::SessionNotFound(label));
            }
            if config.provider.default_provider.as_deref() == Some(label.as_str()) {
                config.provider.default_provider = None;
            }
            config
                .save()
                .map_err(|error| AgentError::Provider(error.to_string()))?;
        }
    }
    crate::auth::AuthStatus::invalidate_cache();
    apply_default_provider_runtime_env(&crate::config::Config::load());
    refresh_runtime_agents_after_provider_config_change();
    list_jcode_accounts_json("{}".to_string())
}

fn start_feedback_session_json(
    payload: String,
    kind: JcodeFeedbackActionKind,
) -> Result<String, AgentError> {
    let request: JcodePokeRequest = parse_request(&payload)?;
    let selected_session_id = resolve_agent_session_id(request.session_id)?;
    let parent_session_id = resolve_feedback_target_session_id(&selected_session_id);
    ensure_loaded_session(&parent_session_id)?;

    let action_label = match kind {
        JcodeFeedbackActionKind::Review => "review",
        JcodeFeedbackActionKind::Judge => "judge",
    };
    reject_running_action(&parent_session_id, action_label)?;

    let child_session_id = create_feedback_child_session(&parent_session_id, kind)?;
    let prompt = match kind {
        JcodeFeedbackActionKind::Review => build_review_startup_message(&parent_session_id),
        JcodeFeedbackActionKind::Judge => build_judge_startup_message(&parent_session_id),
    };
    let response = start_jcode_turn(Some(child_session_id), prompt, Vec::new())?;
    encode(&response)
}

fn start_jcode_turn(
    request_session_id: Option<String>,
    text: String,
    images: Vec<AgentImageInput>,
) -> Result<AgentTurnStartResponse, AgentError> {
    start_jcode_turn_scoped(request_session_id, text, images, None, true)
}

fn start_jcode_turn_with_system_reminder(
    request_session_id: Option<String>,
    text: String,
    images: Vec<AgentImageInput>,
    system_reminder: Option<String>,
) -> Result<AgentTurnStartResponse, AgentError> {
    start_jcode_turn_scoped(request_session_id, text, images, system_reminder, true)
}

fn start_jcode_turn_scoped(
    request_session_id: Option<String>,
    text: String,
    images: Vec<AgentImageInput>,
    system_reminder: Option<String>,
    make_active: bool,
) -> Result<AgentTurnStartResponse, AgentError> {
    let session_id = {
        let mut runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
        match request_session_id.clone() {
            Some(id) => id,
            None => ensure_session(&mut runtime)?,
        }
    };
    ensure_loaded_session_with_activation(&session_id, make_active)?;
    cancel_running_turn_for_task_switch(&session_id)?;
    let current_agent = build_agent_for_session_id(&session_id)?;

    let turn_id = Uuid::new_v4().to_string();
    let user_text = text.trim().to_string();
    let mut user_blocks: Vec<AgentMessageBlock> = images
        .iter()
        .enumerate()
        .map(|(index, image)| AgentMessageBlock::Image {
            id: format!("image-{index}"),
            media_type: image.media_type.clone(),
            data: image.data.clone(),
            label: image.label.clone(),
            source: image.source.clone(),
            width: image.width,
            height: image.height,
        })
        .collect();
    if !user_text.is_empty() || user_blocks.is_empty() {
        user_blocks.push(AgentMessageBlock::Text {
            id: "text-0".to_string(),
            text: user_text.clone(),
        });
    }
    let jcode_images: Vec<(String, String)> = images
        .iter()
        .map(|image| (image.media_type.clone(), image.data.clone()))
        .collect();
    let user_message = AgentMessage {
        id: Uuid::new_v4().to_string(),
        role: AgentRole::User,
        text: user_text.clone(),
        blocks: user_blocks,
        created_at: Utc::now(),
        rollback: None,
    };
    let mut user_message = user_message;
    let visible_user_message = !user_text.is_empty() || !images.is_empty();
    let store = agent_memory_store()?;
    let memory_user_event_id = if visible_user_message {
        let mut event = NewSessionEvent::user_message(user_text.clone());
        event.runtime_turn_id = Some(turn_id.clone());
        event.payload = json!({
            "text": user_text,
            "imageCount": images.len(),
            "messageId": user_message.id.clone(),
        });
        Some(
            store
                .append_event(&session_id, event)
                .map_err(|error| {
                    AgentError::Provider(format!("agent memory user event failed: {error}"))
                })?
                .event_id,
        )
    } else {
        None
    };
    if let Some(event_id) = memory_user_event_id.as_ref() {
        user_message.id = event_id.clone();
    }
    let rollback_anchor = if visible_user_message {
        rollback::create_anchor_for_user_message(&session_id, &user_message.id, &user_message.text)
            .ok()
    } else {
        None
    };
    if let Some(anchor) = rollback_anchor.as_ref() {
        user_message.rollback = Some(AgentMessageRollback {
            available: true,
            anchor_id: Some(anchor.id.clone()),
            checkpoint_at: Some(anchor.checkpoint_at),
            unavailable_reason: None,
        });
    }
    store
        .start_runtime_turn_with_id(
            &session_id,
            turn_id.clone(),
            memory_user_event_id.as_deref(),
            None,
        )
        .map_err(|error| AgentError::Provider(format!("agent memory turn failed: {error}")))?;
    let context_snapshot = store
        .build_context(&session_id, &turn_id, 128_000)
        .map_err(|error| AgentError::Provider(format!("agent memory context failed: {error}")))?;
    let assembled_provider_context =
        assembled_provider_context_from_snapshot(&context_snapshot, &user_text, &jcode_images);
    store
        .transition_runtime_turn(
            &session_id,
            &turn_id,
            RuntimeTurnState::CallingModel,
            "provider_request",
        )
        .and_then(|()| store.update_session_status(&session_id, MemorySessionStatus::Running))
        .map_err(|error| {
            AgentError::Provider(format!("agent memory turn start failed: {error}"))
        })?;
    emit_event(AgentRuntimeEvent::TurnStarted {
        session_id: session_id.clone(),
        turn_id: turn_id.clone(),
        state: RuntimeTurnState::CallingModel,
    });
    block_on(async {
        let mut guard = current_agent.lock().await;
        guard.set_assembled_provider_context(assembled_provider_context);
        Ok::<_, AgentError>(())
    })??;
    let (agent, shutdown_signal, snapshot) = {
        let mut runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
        let session = runtime
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| AgentError::SessionNotFound(session_id.clone()))?;
        session.agent = current_agent;
        if visible_user_message {
            session.snapshot.messages.push(user_message.clone());
        }
        session.snapshot.turn_status = TurnStatus::Running;
        session.snapshot.active_turn_id = Some(turn_id.clone());
        session.snapshot.follow = AgentFollowState {
            running: true,
            activity: Some("Streaming via Lyra Agent provider".to_string()),
        };
        session.snapshot.updated_at = Utc::now();
        let agent = session.agent.clone();
        let shutdown_signal = block_on(async {
            let guard = agent.lock().await;
            guard.graceful_shutdown_signal()
        })?;
        session.shutdown_signal = Some(shutdown_signal.clone());
        let snapshot = session.snapshot.clone();
        if make_active {
            runtime.active_session_id = Some(session_id.clone());
        }
        (agent, shutdown_signal, snapshot)
    };

    emit_event(AgentRuntimeEvent::SessionSnapshot {
        snapshot: snapshot.clone(),
    });
    if visible_user_message {
        emit_event(AgentRuntimeEvent::MessageAppended {
            session_id: session_id.clone(),
            message: user_message,
        });
    }
    emit_event(AgentRuntimeEvent::FollowStateChanged {
        session_id: session_id.clone(),
        follow: snapshot.follow.clone(),
    });

    thread::spawn(move || {
        run_jcode_turn(
            session_id,
            turn_id,
            text,
            jcode_images,
            system_reminder,
            agent,
            shutdown_signal,
        );
    });

    Ok(AgentTurnStartResponse {
        session_id: snapshot.id,
        turn_id: snapshot.active_turn_id,
        status: "running",
    })
}

pub fn cancel_turn_json(payload: String) -> Result<String, AgentError> {
    let request: CancelTurnRequest = parse_request(&payload)?;
    let mut runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
    let session = runtime
        .sessions
        .get_mut(&request.session_id)
        .ok_or_else(|| AgentError::SessionNotFound(request.session_id.clone()))?;
    let Some(signal) = session.shutdown_signal.clone() else {
        return Err(AgentError::TurnNotRunning(request.session_id));
    };
    let turn_id = session.snapshot.active_turn_id.clone();
    signal.fire();
    session.snapshot.turn_status = TurnStatus::Cancelled;
    session.snapshot.active_turn_id = None;
    session.snapshot.follow = AgentFollowState {
        running: false,
        activity: None,
    };
    session.snapshot.updated_at = Utc::now();
    session.shutdown_signal = None;
    let snapshot = session.snapshot.clone();
    drop(runtime);
    cancel_pending_clarifications_for_session(&snapshot.id);
    if let Some(turn_id) = turn_id.as_deref() {
        transition_memory_turn(
            &snapshot.id,
            turn_id,
            RuntimeTurnState::CancelledByUser,
            "user_cancelled",
        );
        if let Ok(store) = agent_memory_store() {
            let _ = store.update_session_status(&snapshot.id, MemorySessionStatus::Interrupted);
        }
    }
    emit_event(AgentRuntimeEvent::SessionSnapshot {
        snapshot: snapshot.clone(),
    });
    if let Some(turn_id) = turn_id {
        emit_event(AgentRuntimeEvent::TurnFinished {
            session_id: snapshot.id.clone(),
            turn_id,
            status: TurnStatus::Cancelled,
        });
    }
    emit_event(AgentRuntimeEvent::FollowStateChanged {
        session_id: snapshot.id.clone(),
        follow: snapshot.follow.clone(),
    });
    encode(&json!({ "sessionId": snapshot.id, "status": "cancelled" }))
}

fn cancel_running_turn_for_task_switch(session_id: &str) -> Result<bool, AgentError> {
    let cancellation = {
        let mut runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
        let session = runtime
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| AgentError::SessionNotFound(session_id.to_string()))?;
        if session.snapshot.turn_status != TurnStatus::Running
            && session.snapshot.active_turn_id.is_none()
            && session.shutdown_signal.is_none()
        {
            return Ok(false);
        }

        if let Some(signal) = session.shutdown_signal.take() {
            signal.fire();
        }

        let now = Utc::now();
        let turn_id = session.snapshot.active_turn_id.take();
        for tool in &mut session.snapshot.tools {
            if tool.status == ToolActivityStatus::Running {
                tool.status = ToolActivityStatus::Failed;
                tool.label = finished_tool_label(&tool.name, true);
                tool.finished_at = Some(now);
                if tool.output.is_none() {
                    tool.output = Some(json!({
                        "content": "Interrupted by a newer user request.",
                        "error": "interrupted by new user request"
                    }));
                }
            }
        }
        session.snapshot.turn_status = TurnStatus::Cancelled;
        session.snapshot.active_turn_id = None;
        session.snapshot.follow = AgentFollowState {
            running: false,
            activity: None,
        };
        session.snapshot.updated_at = now;
        Some((turn_id, session.snapshot.clone()))
    };

    let Some((turn_id, snapshot)) = cancellation else {
        return Ok(false);
    };

    cancel_pending_clarifications_for_session(&snapshot.id);
    emit_event(AgentRuntimeEvent::SessionSnapshot {
        snapshot: snapshot.clone(),
    });
    if let Some(turn_id) = turn_id {
        transition_memory_turn(
            &snapshot.id,
            &turn_id,
            RuntimeTurnState::CancelledByUser,
            "task_switch_cancelled",
        );
        emit_event(AgentRuntimeEvent::TurnFinished {
            session_id: snapshot.id.clone(),
            turn_id,
            status: TurnStatus::Cancelled,
        });
    }
    emit_event(AgentRuntimeEvent::FollowStateChanged {
        session_id: snapshot.id,
        follow: snapshot.follow,
    });

    Ok(true)
}

pub fn preview_rollback_json(payload: String) -> Result<String, AgentError> {
    let request: RollbackRequest = parse_request(&payload)?;
    ensure_loaded_session(&request.session_id)?;
    if is_session_running(&request.session_id)? {
        let response = RollbackPreviewResponse {
            session_id: request.session_id,
            message_id: request.message_id,
            available: false,
            checkpoint_at: None,
            removed_message_count: 0,
            changed_files: Vec::new(),
            unavailable_reason: Some("Cannot rollback while the agent is running.".to_string()),
        };
        return encode(&response);
    }
    let preview = rollback::preview_rollback(&request.session_id, &request.message_id)
        .map_err(|error| AgentError::Provider(error.to_string()))?;
    encode(&RollbackPreviewResponse {
        session_id: preview.session_id,
        message_id: preview.message_id,
        available: preview.available,
        checkpoint_at: preview.checkpoint_at,
        removed_message_count: preview.removed_message_count,
        changed_files: preview.changed_files,
        unavailable_reason: preview.unavailable_reason,
    })
}

pub fn restore_rollback_json(payload: String) -> Result<String, AgentError> {
    let request: RollbackRequest = parse_request(&payload)?;
    if let Some(mode) = request.mode.as_deref()
        && mode != "taskAndWorkspace"
    {
        return Err(AgentError::BadRequest(format!(
            "unsupported rollback mode: {mode}"
        )));
    }
    ensure_loaded_session(&request.session_id)?;
    if is_session_running(&request.session_id)? {
        return Err(AgentError::BadRequest(
            "cannot rollback while the agent is running".to_string(),
        ));
    }
    let anchor = rollback::anchor_for_message(&request.session_id, &request.message_id)
        .map_err(|error| AgentError::Provider(error.to_string()))?
        .ok_or_else(|| {
            AgentError::BadRequest("No rollback checkpoint exists for this message.".to_string())
        })?;

    emit_event(AgentRuntimeEvent::RollbackStarted {
        session_id: request.session_id.clone(),
        message_id: request.message_id.clone(),
    });

    let result = (|| {
        let restored_file_count = rollback::restore_workspace(&anchor)
            .map_err(|error| AgentError::Provider(error.to_string()))?;
        let (session, removed_message_count) =
            rollback::truncate_session_before_message(&request.session_id, &request.message_id)
                .map_err(|error| AgentError::Provider(error.to_string()))?;
        let snapshot = snapshot_from_jcode_session(
            &session,
            TurnStatus::Idle,
            None,
            AgentFollowState {
                running: false,
                activity: None,
            },
            Vec::new(),
        );
        let agent = build_agent_blocking(session)?;
        {
            let mut runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
            runtime.active_session_id = Some(snapshot.id.clone());
            runtime.sessions.insert(
                snapshot.id.clone(),
                AgentSession {
                    snapshot: snapshot.clone(),
                    agent,
                    shutdown_signal: None,
                },
            );
        }
        Ok::<_, AgentError>(RollbackRestoreResponse {
            session_id: request.session_id.clone(),
            message_id: request.message_id.clone(),
            snapshot,
            removed_message_count,
            restored_file_count,
        })
    })();

    match result {
        Ok(response) => {
            emit_event(AgentRuntimeEvent::SessionSnapshot {
                snapshot: response.snapshot.clone(),
            });
            emit_event(AgentRuntimeEvent::RollbackFinished {
                session_id: response.session_id.clone(),
                message_id: response.message_id.clone(),
                removed_message_count: response.removed_message_count,
                restored_file_count: response.restored_file_count,
            });
            encode(&response)
        }
        Err(error) => {
            emit_event(AgentRuntimeEvent::RollbackFailed {
                session_id: request.session_id,
                message_id: request.message_id,
                message: error.to_string(),
            });
            Err(error)
        }
    }
}

pub fn respond_permission_json(payload: String) -> Result<String, AgentError> {
    let request: PermissionRespondRequest = parse_request(&payload)?;
    if let Ok(mut pending) = PENDING_PERMISSIONS.lock() {
        if let Some(tx) = pending.remove(&request.permission_id) {
            let _ = tx.send(request.allowed);
        }
    }
    encode(&json!({
        "sessionId": request.session_id,
        "permissionId": request.permission_id,
        "allowed": request.allowed
    }))
}

pub fn respond_clarification_json(payload: String) -> Result<String, AgentError> {
    let request: ClarificationRespondRequest = parse_request(&payload)?;
    let answer = required_trimmed(Some(&request.answer), "answer")?;
    let selected_option = normalize_optional_owned(request.selected_option);
    let pending = {
        let mut pending = PENDING_CLARIFICATIONS
            .lock()
            .map_err(|_| AgentError::RuntimeLock)?;
        let Some(existing) = pending.get(&request.clarification_id) else {
            return Err(AgentError::BadRequest(format!(
                "clarification request is no longer pending: {}",
                request.clarification_id
            )));
        };
        if existing.session_id != request.session_id {
            return Err(AgentError::BadRequest(format!(
                "clarification {} belongs to session {}, not {}",
                request.clarification_id, existing.session_id, request.session_id
            )));
        }
        pending
            .remove(&request.clarification_id)
            .expect("pending clarification checked before removal")
    };
    let response = ClarificationAnswer {
        answer: answer.clone(),
        selected_option: selected_option.clone(),
    };
    let _ = pending.tx.send(response);
    let active_turn_id = RUNTIME.lock().ok().and_then(|runtime| {
        runtime
            .sessions
            .get(&request.session_id)
            .and_then(|session| session.snapshot.active_turn_id.clone())
    });
    if let Some(turn_id) = active_turn_id.as_deref() {
        transition_memory_turn(
            &request.session_id,
            turn_id,
            RuntimeTurnState::StreamingModel,
            "clarification_resolved",
        );
        if let Ok(store) = agent_memory_store() {
            let _ = store.resolve_clarification(
                &request.session_id,
                turn_id,
                &request.clarification_id,
                json!({
                    "clarificationId": request.clarification_id.clone(),
                    "answer": answer.clone(),
                    "selectedOption": selected_option.clone(),
                }),
            );
        }
    }
    emit_event(AgentRuntimeEvent::ClarificationResolved {
        session_id: request.session_id.clone(),
        clarification_id: request.clarification_id.clone(),
    });
    encode(&json!({
        "sessionId": request.session_id,
        "clarificationId": request.clarification_id,
        "answer": answer,
        "selectedOption": selected_option
    }))
}

pub fn ask_user_permission(session_id: &str, action: &str, description: &str) -> bool {
    let permission_id = format!("perm-{}", Uuid::new_v4());
    let (tx, rx) = tokio::sync::oneshot::channel();

    if let Ok(mut pending) = PENDING_PERMISSIONS.lock() {
        pending.insert(permission_id.clone(), tx);
    }

    emit_event(AgentRuntimeEvent::PermissionRequired {
        session_id: session_id.to_string(),
        permission_id: permission_id.clone(),
        title: action.to_string(),
        detail: description.to_string(),
    });

    match futures::executor::block_on(rx) {
        Ok(allowed) => allowed,
        Err(_) => false,
    }
}

pub fn ask_user_clarification(
    session_id: &str,
    question: &str,
    options: Vec<ClarificationOption>,
    allow_custom_answer: bool,
    detail: Option<String>,
) -> Result<ClarificationAnswer, AgentError> {
    let session_id = required_trimmed(Some(session_id), "sessionId")?;
    let question = required_trimmed(Some(question), "question")?;
    ensure_loaded_session_with_activation(&session_id, false)?;
    let normalized = normalize_clarification_request(
        question,
        options,
        allow_custom_answer,
        detail.and_then(|value| normalize_optional_owned(Some(value))),
    );
    let clarification_id = format!("clar-{}", Uuid::new_v4());
    let (tx, rx) = tokio::sync::oneshot::channel();

    {
        let mut pending = PENDING_CLARIFICATIONS
            .lock()
            .map_err(|_| AgentError::RuntimeLock)?;
        pending.insert(
            clarification_id.clone(),
            PendingClarification {
                session_id: session_id.clone(),
                tx,
            },
        );
    }

    let active_turn_id = RUNTIME.lock().ok().and_then(|runtime| {
        runtime
            .sessions
            .get(&session_id)
            .and_then(|session| session.snapshot.active_turn_id.clone())
    });
    if let Some(turn_id) = active_turn_id.as_deref() {
        transition_memory_turn(
            &session_id,
            turn_id,
            RuntimeTurnState::WaitingForUser,
            "clarification_required",
        );
        if let Ok(store) = agent_memory_store() {
            let _ = store.record_clarification_request(
                &session_id,
                turn_id,
                &clarification_id,
                json!({
                    "clarificationId": clarification_id.clone(),
                    "question": normalized.question.clone(),
                    "options": normalized.options.clone(),
                    "allowCustomAnswer": normalized.allow_custom_answer,
                    "detail": normalized.detail.clone(),
                }),
            );
        }
    }

    emit_event(AgentRuntimeEvent::ClarificationRequired {
        session_id: session_id.clone(),
        clarification_id: clarification_id.clone(),
        question: normalized.question.clone(),
        options: normalized.options.clone(),
        allow_custom_answer: normalized.allow_custom_answer,
        detail: normalized.detail.clone(),
    });

    match futures::executor::block_on(rx) {
        Ok(answer) => Ok(answer),
        Err(_) => Err(AgentError::BadRequest(format!(
            "clarification request was cancelled: {clarification_id}"
        ))),
    }
}

fn cancel_pending_clarifications_for_session(session_id: &str) {
    if let Ok(mut pending) = PENDING_CLARIFICATIONS.lock() {
        pending.retain(|_, request| request.session_id != session_id);
    }
}

#[derive(Debug)]
struct NormalizedClarificationRequest {
    question: String,
    options: Vec<ClarificationOption>,
    allow_custom_answer: bool,
    detail: Option<String>,
}

fn normalize_clarification_request(
    question: String,
    options: Vec<ClarificationOption>,
    allow_custom_answer: bool,
    detail: Option<String>,
) -> NormalizedClarificationRequest {
    let original_question = clean_clarification_text(&question);
    let mut options = normalize_clarification_options(options);
    let numbered_question = first_numbered_item_question(&original_question);
    let mut normalized_question = preferred_clarification_question(&original_question);

    if numbered_question.is_none()
        && options.is_empty()
        && let Some(extracted) = extract_inline_clarification_options(&original_question)
    {
        normalized_question = extracted.question;
        options = extracted.options;
    }

    let normalized_question = if normalized_question.is_empty() {
        original_question
    } else {
        normalized_question
    };

    NormalizedClarificationRequest {
        question: normalized_question,
        allow_custom_answer: allow_custom_answer || options.is_empty(),
        options,
        detail,
    }
}

#[derive(Debug)]
struct ExtractedClarificationOptions {
    question: String,
    options: Vec<ClarificationOption>,
}

fn preferred_clarification_question(text: &str) -> String {
    if let Some(question) = first_numbered_item_question(text) {
        return question;
    }
    if let Some(question) = first_question_sentence(text) {
        return question;
    }
    first_numbered_item(text)
        .map(clean_clarification_text)
        .unwrap_or_else(|| clean_clarification_text(text))
}

fn first_question_sentence(text: &str) -> Option<String> {
    let mut best: Option<(usize, usize)> = None;
    for marker in ['？', '?'] {
        if let Some(index) = text.find(marker) {
            let end = index + marker.len_utf8();
            best = Some(best.map_or((index, end), |current| {
                if index < current.0 {
                    (index, end)
                } else {
                    current
                }
            }));
        }
    }
    let (_, end) = best?;
    let sentence = clean_clarification_text(&text[..end]);
    (sentence.chars().count() >= 4).then_some(sentence)
}

fn extract_inline_clarification_options(text: &str) -> Option<ExtractedClarificationOptions> {
    let question = first_question_sentence(text)?;
    let first_item = first_numbered_item(text)?;
    let choices = choices_from_inline_choice_text(first_item);
    if choices.len() < 2 {
        return None;
    }
    Some(ExtractedClarificationOptions {
        question,
        options: choices
            .into_iter()
            .take(4)
            .map(|label| ClarificationOption {
                label,
                description: None,
            })
            .collect(),
    })
}

fn choices_from_inline_choice_text(text: &str) -> Vec<String> {
    if has_explanatory_separator(text) {
        return Vec::new();
    }
    let cleaned = clean_clarification_text(text);
    cleaned
        .split(['/', '／', '|', '、'])
        .filter_map(|part| {
            let label = clean_option_label(part);
            (!label.is_empty()).then_some(label)
        })
        .fold(Vec::<String>::new(), |mut acc, label| {
            if !acc.iter().any(|existing| existing == &label) {
                acc.push(label);
            }
            acc
        })
}

fn has_explanatory_separator(text: &str) -> bool {
    [" -- ", "--", " - ", "——", "：", ":"]
        .iter()
        .any(|separator| text.contains(separator))
}

fn clean_option_label(raw: &str) -> String {
    raw.replace("**", "")
        .trim_matches(|ch: char| {
            ch.is_whitespace()
                || ch == '?'
                || ch == '？'
                || ch == '.'
                || ch == '。'
                || ch == '-'
                || ch == ':'
                || ch == '：'
        })
        .trim()
        .to_string()
}

fn normalize_clarification_options(options: Vec<ClarificationOption>) -> Vec<ClarificationOption> {
    let mut normalized: Vec<ClarificationOption> = Vec::new();
    for option in options {
        let label = option.label.trim();
        let description = option
            .description
            .and_then(|value| normalize_optional_owned(Some(value)));
        if label.is_empty()
            || is_custom_clarification_option_label(label)
            || normalized
                .iter()
                .any(|existing| existing.label.as_str() == label)
        {
            continue;
        }
        normalized.push(ClarificationOption {
            label: label.to_string(),
            description,
        });
    }
    normalized
}

fn is_custom_clarification_option_label(label: &str) -> bool {
    let label = label.trim();
    matches!(
        label.to_ascii_lowercase().as_str(),
        "other" | "custom" | "something else"
    ) || matches!(label, "其他" | "其它" | "自定义")
}

fn ensure_jcode_config_file() -> Result<(), AgentError> {
    let Some(path) = crate::config::Config::path() else {
        return Err(AgentError::Provider(
            "No Lyra Agent config path".to_string(),
        ));
    };
    if path.exists() {
        return Ok(());
    }
    crate::config::Config::create_default_config_file()
        .map(|_| ())
        .map_err(|error| AgentError::Provider(error.to_string()))
}

pub fn read_jcode_config_json(_payload: String) -> Result<String, AgentError> {
    ensure_jcode_config_file()?;
    let config = crate::config::Config::load();
    encode(&json!({
        "jcodeHome": crate::storage::jcode_dir().ok().map(|path| path.display().to_string()),
        "configPath": crate::config::Config::path().map(|path| path.display().to_string()),
        "config": config,
        "commands": gui_visible_jcode_commands(),
    }))
}

pub fn update_jcode_config_json(payload: String) -> Result<String, AgentError> {
    let patch: Value = parse_request(&payload)?;
    let mut config = crate::config::Config::load();
    if let Some(value) = patch.get("defaultModel") {
        config.provider.default_model = optional_string(value);
    }
    if let Some(value) = patch.get("defaultProvider") {
        config.provider.default_provider = optional_string(value);
    }
    if let Some(value) = patch.get("openaiReasoningEffort") {
        config.provider.openai_reasoning_effort = optional_string(value);
    }
    if let Some(value) = patch.get("openaiServiceTier") {
        config.provider.openai_service_tier = optional_string(value);
    }
    if let Some(value) = patch.get("ntfyServer") {
        config.safety.ntfy_server = optional_string(value)
            .unwrap_or_else(|| crate::config::SafetyConfig::default().ntfy_server);
    }
    patch_optional_string(&mut config.safety.ntfy_topic, &patch, "ntfyTopic");
    patch_bool(
        &mut config.safety.desktop_notifications,
        &patch,
        "desktopNotifications",
    )?;
    patch_bool(&mut config.safety.email_enabled, &patch, "emailEnabled")?;
    patch_optional_string(&mut config.safety.email_to, &patch, "emailTo");
    patch_optional_string(&mut config.safety.email_smtp_host, &patch, "emailSmtpHost");
    patch_u16(&mut config.safety.email_smtp_port, &patch, "emailSmtpPort")?;
    patch_optional_string(&mut config.safety.email_from, &patch, "emailFrom");
    patch_optional_string(&mut config.safety.email_password, &patch, "emailPassword");
    patch_optional_string(&mut config.safety.email_imap_host, &patch, "emailImapHost");
    patch_u16(&mut config.safety.email_imap_port, &patch, "emailImapPort")?;
    patch_bool(
        &mut config.safety.email_reply_enabled,
        &patch,
        "emailReplyEnabled",
    )?;
    patch_bool(
        &mut config.safety.telegram_enabled,
        &patch,
        "telegramEnabled",
    )?;
    patch_optional_string(
        &mut config.safety.telegram_bot_token,
        &patch,
        "telegramBotToken",
    );
    patch_optional_string(
        &mut config.safety.telegram_chat_id,
        &patch,
        "telegramChatId",
    );
    patch_bool(
        &mut config.safety.telegram_reply_enabled,
        &patch,
        "telegramReplyEnabled",
    )?;
    patch_bool(&mut config.safety.discord_enabled, &patch, "discordEnabled")?;
    patch_optional_string(
        &mut config.safety.discord_bot_token,
        &patch,
        "discordBotToken",
    );
    patch_optional_string(
        &mut config.safety.discord_channel_id,
        &patch,
        "discordChannelId",
    );
    patch_optional_string(
        &mut config.safety.discord_bot_user_id,
        &patch,
        "discordBotUserId",
    );
    patch_bool(
        &mut config.safety.discord_reply_enabled,
        &patch,
        "discordReplyEnabled",
    )?;
    config
        .save()
        .map_err(|error| AgentError::Provider(error.to_string()))?;
    apply_default_provider_runtime_env(&config);
    refresh_runtime_agents_after_provider_config_change();
    read_jcode_config_json("{}".to_string())
}

pub fn save_jcode_provider_profile_json(payload: String) -> Result<String, AgentError> {
    let request: JcodeProviderProfileSaveRequest = parse_request(&payload)?;
    let profile_name = sanitize_profile_name(&request.profile_name)?;
    let mut config = crate::config::Config::load();
    let api_key_env = request
        .api_key_env
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| default_env_key_for_profile(&profile_name));
    let env_file = request
        .env_file
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| default_env_file_for_profile(&profile_name));

    if request
        .api_key
        .as_ref()
        .is_some_and(|value| !value.is_empty())
    {
        crate::provider_catalog::save_env_value_to_env_file(
            &api_key_env,
            &env_file,
            request.api_key.as_deref(),
        )
        .map_err(|error| AgentError::Provider(error.to_string()))?;
    }

    let default_model = request
        .default_model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let profile = crate::config::NamedProviderConfig {
        provider_type: parse_named_provider_type(request.provider_type.as_deref())?,
        base_url: request.base_url.trim().to_string(),
        api: None,
        auth: parse_named_provider_auth(request.auth.as_deref())?,
        auth_header: request
            .auth_header
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned),
        api_key_env: Some(api_key_env.clone()),
        api_key: None,
        env_file: Some(env_file.clone()),
        default_model: default_model.clone(),
        requires_api_key: Some(true),
        provider_routing: false,
        model_catalog: false,
        allow_provider_pinning: false,
        models: request
            .models
            .unwrap_or_default()
            .into_iter()
            .filter(|model| !model.id.trim().is_empty())
            .map(|model| crate::config::NamedProviderModelConfig {
                id: model.id.trim().to_string(),
                context_window: model.context_window,
                input: Vec::new(),
            })
            .collect(),
    };
    config.providers.insert(profile_name.clone(), profile);
    if request.set_default.unwrap_or(false) {
        config.provider.default_provider = Some(profile_name.clone());
        if default_model.is_some() {
            config.provider.default_model = default_model;
        }
    }
    config
        .save()
        .map_err(|error| AgentError::Provider(error.to_string()))?;
    if request.set_default.unwrap_or(false) {
        apply_default_provider_runtime_env(&config);
        refresh_runtime_agents_after_provider_config_change();
    }
    read_jcode_config_json("{}".to_string())
}

pub fn list_jcode_models_json(payload: String) -> Result<String, AgentError> {
    let request: JcodeModelsListRequest = parse_request(&payload)?;
    let session_id = resolve_agent_session_id(request.session_id)?;
    let models = jcode_models_for_session(&session_id)?;
    encode(&models)
}

pub fn switch_jcode_model_json(payload: String) -> Result<String, AgentError> {
    let request: JcodeModelSwitchRequest = parse_request(&payload)?;
    let model = request.model.trim().to_string();
    if model.is_empty() {
        return Err(AgentError::BadRequest("model is required".to_string()));
    }
    let session_id = resolve_agent_session_id(request.session_id)?;
    let agent = agent_for_session(&session_id)?;
    let (current_model, current_provider, provider_key) = block_on(async {
        let mut guard = agent.lock().await;
        guard
            .set_model(&model)
            .map_err(|error| AgentError::Provider(error.to_string()))?;
        Ok::<_, AgentError>((
            guard.provider_model(),
            guard.provider_name(),
            guard.session_provider_key(),
        ))
    })??;
    let derived_provider_key = crate::session::derive_session_provider_key(&current_provider);
    let requested_provider_key = request
        .provider
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let provider_key_to_save = requested_provider_key
        .or(provider_key.as_deref())
        .or(derived_provider_key.as_deref());
    persist_session_provider_state(
        &session_id,
        Some(current_model.as_str()),
        provider_key_to_save,
        None,
    )?;
    persist_default_model(&model, requested_provider_key)?;
    let models = jcode_models_for_session(&session_id)?;
    encode(&models)
}

pub fn refresh_jcode_models_json(payload: String) -> Result<String, AgentError> {
    let request: JcodeModelRefreshRequest = parse_request(&payload)?;
    let session_id = resolve_agent_session_id(request.session_id)?;
    let agent = agent_for_session(&session_id)?;
    block_on(async {
        let provider = {
            let guard = agent.lock().await;
            guard.provider_handle()
        };
        provider
            .refresh_model_catalog()
            .await
            .map_err(|error| AgentError::Provider(error.to_string()))?;
        Ok::<_, AgentError>(())
    })??;
    let models = jcode_models_for_session(&session_id)?;
    encode(&models)
}

pub fn update_jcode_provider_options_json(payload: String) -> Result<String, AgentError> {
    let request: JcodeProviderOptionsUpdateRequest = parse_request(&payload)?;
    let session_id = resolve_agent_session_id(request.session_id)?;
    let agent = agent_for_session(&session_id)?;
    let mut persisted_reasoning_effort: Option<Option<String>> = None;
    let mut persisted_service_tier: Option<Option<String>> = None;

    block_on(async {
        let mut guard = agent.lock().await;
        if let Some(effort) = normalized_nonempty(request.reasoning_effort.as_deref()) {
            let current = guard
                .set_reasoning_effort(&effort)
                .map_err(|error| AgentError::Provider(error.to_string()))?;
            persisted_reasoning_effort = Some(provider_option_config_value(&effort));
            let current_model = guard.provider_model();
            let current_provider = guard.provider_name();
            let derived_provider_key =
                crate::session::derive_session_provider_key(&current_provider);
            let provider_key = guard.session_provider_key();
            persist_session_provider_state(
                &session_id,
                Some(current_model.as_str()),
                provider_key.as_deref().or(derived_provider_key.as_deref()),
                current.as_deref(),
            )?;
        }
        if let Some(service_tier) = normalized_nonempty(request.service_tier.as_deref()) {
            let provider = guard.provider_handle();
            provider
                .set_service_tier(&service_tier)
                .map_err(|error| AgentError::Provider(error.to_string()))?;
            persisted_service_tier = Some(provider_option_config_value(&service_tier));
        }
        Ok::<_, AgentError>(())
    })??;

    if let Some(value) = persisted_reasoning_effort {
        crate::config::Config::set_openai_reasoning_effort(value.as_deref())
            .map_err(|error| AgentError::Provider(error.to_string()))?;
    }
    if let Some(value) = persisted_service_tier {
        crate::config::Config::set_openai_service_tier(value.as_deref())
            .map_err(|error| AgentError::Provider(error.to_string()))?;
    }

    let models = jcode_models_for_session(&session_id)?;
    encode(&models)
}

pub fn update_jcode_agent_roles_json(payload: String) -> Result<String, AgentError> {
    let request: JcodeAgentRolesUpdateRequest = parse_request(&payload)?;
    let mut config = crate::config::Config::load();
    config.agents.swarm_model = normalize_optional_owned(request.swarm_model);
    config.autoreview.model = normalize_optional_owned(request.review_model);
    config.autojudge.model = normalize_optional_owned(request.judge_model);
    config.agents.memory_model = normalize_optional_owned(request.memory_model);
    config.ambient.model = normalize_optional_owned(request.ambient_model);
    config
        .save()
        .map_err(|error| AgentError::Provider(error.to_string()))?;
    read_jcode_config_json("{}".to_string())
}

fn run_manual_subagent_tool(
    session_id: &str,
    agent: Arc<tokio::sync::Mutex<Agent>>,
    prompt: String,
    subagent_type: String,
    model: Option<String>,
    continue_session_id: Option<String>,
) -> Result<String, AgentError> {
    let tool_call_id = crate::id::new_id("call");
    let tool_name = "subagent".to_string();
    let description = derive_subagent_description(&prompt);
    let tool_input = json!({
        "description": description,
        "prompt": prompt,
        "subagent_type": subagent_type,
        "model": model,
        "session_id": continue_session_id,
        "command": "gui.subagent.run",
    });

    let tool_activity = ToolActivity {
        id: tool_call_id.clone(),
        name: tool_name.clone(),
        label: live_tool_label(&tool_name),
        status: ToolActivityStatus::Running,
        input: tool_input.clone(),
        output: None,
        started_at: Utc::now(),
        finished_at: None,
    };
    upsert_tool(session_id, tool_activity.clone())?;
    emit_event(AgentRuntimeEvent::ToolStarted {
        session_id: session_id.to_string(),
        message_id: None,
        tool: tool_activity,
    });

    let tool_call_id_for_result = tool_call_id.clone();
    let tool_name_for_execution = tool_name.clone();
    let result = block_on(async move {
        let message_id = {
            let mut guard = agent.lock().await;
            guard
                .add_manual_tool_use(
                    tool_call_id.clone(),
                    tool_name_for_execution.clone(),
                    tool_input.clone(),
                )
                .map_err(|error| AgentError::Provider(error.to_string()))?
        };
        let (registry, agent_session_id, working_dir) = {
            let guard = agent.lock().await;
            (
                guard.registry(),
                guard.session_id().to_string(),
                guard.working_dir().map(PathBuf::from),
            )
        };
        let ctx = ToolContext {
            session_id: agent_session_id,
            message_id,
            tool_call_id: tool_call_id.clone(),
            working_dir,
            stdin_request_tx: None,
            graceful_shutdown_signal: None,
            execution_mode: ToolExecutionMode::Direct,
        };
        let started = std::time::Instant::now();
        let output = registry
            .execute(&tool_name_for_execution, tool_input, ctx)
            .await
            .map_err(|error| AgentError::Provider(error.to_string()));
        let duration_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
        match output {
            Ok(output) => {
                let output_text = output.output.clone();
                let mut guard = agent.lock().await;
                guard
                    .add_manual_tool_result(tool_call_id, output, duration_ms)
                    .map_err(|error| AgentError::Provider(error.to_string()))?;
                Ok::<_, AgentError>((output_text, None))
            }
            Err(error) => {
                let error_text = error.to_string();
                let mut guard = agent.lock().await;
                guard
                    .add_manual_tool_error(tool_call_id, error_text.clone(), duration_ms)
                    .map_err(|persist_error| AgentError::Provider(persist_error.to_string()))?;
                Ok((error_text.clone(), Some(error_text)))
            }
        }
    })??;

    let (output, error) = result;
    let failed = error.is_some();
    let finished_tool = ToolActivity {
        id: tool_call_id_for_result.clone(),
        name: tool_name.clone(),
        label: finished_tool_label(&tool_name, failed),
        status: if failed {
            ToolActivityStatus::Failed
        } else {
            ToolActivityStatus::Completed
        },
        input: Value::Object(serde_json::Map::new()),
        output: Some(json!({ "content": output, "error": error })),
        started_at: Utc::now(),
        finished_at: Some(Utc::now()),
    };
    upsert_tool(session_id, finished_tool.clone())?;
    emit_event(AgentRuntimeEvent::ToolFinished {
        session_id: session_id.to_string(),
        tool: finished_tool,
    });
    Ok(tool_call_id_for_result)
}

fn derive_subagent_description(prompt: &str) -> String {
    let words: Vec<&str> = prompt.split_whitespace().take(4).collect();
    if words.is_empty() {
        "Manual subagent".to_string()
    } else {
        words.join(" ")
    }
}

fn refresh_runtime_snapshot_for_session(
    session_id: &str,
    turn_status: TurnStatus,
    active_turn_id: Option<String>,
) -> Result<AgentSessionSnapshot, AgentError> {
    let snapshot = persisted_snapshot(session_id, turn_status, active_turn_id, None)?;
    if let Ok(mut runtime) = RUNTIME.lock()
        && let Some(loaded) = runtime.sessions.get_mut(session_id)
    {
        loaded.snapshot = snapshot.clone();
    }
    emit_event(AgentRuntimeEvent::SessionSnapshot {
        snapshot: snapshot.clone(),
    });
    Ok(snapshot)
}

fn clone_split_session_for_gui(parent_session_id: &str) -> Result<Session, AgentError> {
    let parent = jcode_session_for_memory_session(parent_session_id)?;
    let mut child = Session::create(Some(parent_session_id.to_string()), None);
    child.replace_messages(parent.messages.clone());
    child.compaction = parent.compaction.clone();
    child.working_dir = parent.working_dir.clone();
    child.model = parent.model.clone();
    child.provider_key = parent.provider_key.clone();
    child.subagent_model = parent.subagent_model.clone();
    child.improve_mode = parent.improve_mode;
    child.autoreview_enabled = parent.autoreview_enabled;
    child.autojudge_enabled = parent.autojudge_enabled;
    child.is_canary = parent.is_canary;
    child.testing_build = parent.testing_build.clone();
    child.status = crate::session::SessionStatus::Closed;
    child.provider_session_id = None;
    persist_jcode_session_adapter(&child)?;
    copy_active_todos(parent_session_id, &child.id)?;
    Ok(child)
}

fn transfer_active_messages(session: &Session) -> Vec<JcodeMessage> {
    let start = session
        .compaction
        .as_ref()
        .map(|state| state.compacted_count.min(session.messages.len()))
        .unwrap_or(0);
    session.messages[start..]
        .iter()
        .map(crate::session::StoredMessage::to_message)
        .collect()
}

fn create_transfer_child_session_for_gui(
    parent_session_id: &str,
    parent: &Session,
    compaction: Option<crate::session::StoredCompactionState>,
) -> Result<Session, AgentError> {
    let mut child = Session::create(Some(parent_session_id.to_string()), None);
    child.messages.clear();
    child.compaction = compaction;
    child.working_dir = parent.working_dir.clone();
    child.model = parent.model.clone();
    child.provider_key = parent.provider_key.clone();
    child.subagent_model = parent.subagent_model.clone();
    child.improve_mode = parent.improve_mode;
    child.autoreview_enabled = parent.autoreview_enabled;
    child.autojudge_enabled = parent.autojudge_enabled;
    child.is_canary = parent.is_canary;
    child.testing_build = parent.testing_build.clone();
    child.status = crate::session::SessionStatus::Closed;
    child.provider_session_id = None;
    persist_jcode_session_adapter(&child)?;
    copy_active_todos(parent_session_id, &child.id)?;
    Ok(child)
}

fn activate_child_session(parent_session_id: String, child: Session) -> Result<String, AgentError> {
    let snapshot = snapshot_from_jcode_session(
        &child,
        TurnStatus::Idle,
        None,
        AgentFollowState {
            running: false,
            activity: None,
        },
        Vec::new(),
    );
    let agent = build_agent_blocking(child)?;
    {
        let mut runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
        runtime.active_session_id = Some(snapshot.id.clone());
        runtime.sessions.insert(
            snapshot.id.clone(),
            AgentSession {
                snapshot: snapshot.clone(),
                agent,
                shutdown_signal: None,
            },
        );
    }
    emit_event(AgentRuntimeEvent::SessionSnapshot {
        snapshot: snapshot.clone(),
    });
    encode(&JcodeSessionForkResponse {
        session_id: snapshot.id.clone(),
        parent_session_id,
        snapshot,
    })
}

fn goals_for_session(session_id: &str) -> Result<Vec<Value>, AgentError> {
    let session = jcode_session_for_memory_session(session_id)?;
    let working_dir = session_working_dir(&session);
    crate::goal::list_relevant_goals(Some(Path::new(&working_dir)))
        .map_err(|error| AgentError::Provider(error.to_string()))?
        .into_iter()
        .map(|goal| {
            serde_json::to_value(goal).map_err(|error| AgentError::Serialization(error.to_string()))
        })
        .collect()
}

fn side_panel_snapshot_for_session(session_id: &str) -> AgentSidePanelSnapshot {
    crate::side_panel::snapshot_for_session(session_id)
        .map(side_panel_snapshot)
        .unwrap_or_default()
}

fn side_panel_snapshot(snapshot: crate::side_panel::SidePanelSnapshot) -> AgentSidePanelSnapshot {
    AgentSidePanelSnapshot {
        focused_page_id: snapshot.focused_page_id,
        pages: snapshot
            .pages
            .into_iter()
            .map(|page| AgentSidePanelPageSnapshot {
                id: page.id,
                title: page.title,
                file_path: page.file_path,
                format: page.format.as_str().to_string(),
                source: page.source.as_str().to_string(),
                content: page.content,
                updated_at_ms: page.updated_at_ms,
            })
            .collect(),
    }
}

fn bool_from_value(value: &Value) -> Result<bool, AgentError> {
    value
        .as_bool()
        .ok_or_else(|| AgentError::BadRequest("expected boolean value".to_string()))
}

fn u16_from_value(value: &Value, name: &str) -> Result<u16, AgentError> {
    let number = value.as_u64().ok_or_else(|| {
        AgentError::BadRequest(format!("{name} must be an integer between 0 and 65535"))
    })?;
    u16::try_from(number).map_err(|_| {
        AgentError::BadRequest(format!("{name} must be an integer between 0 and 65535"))
    })
}

fn patch_optional_string(target: &mut Option<String>, patch: &Value, key: &str) {
    if let Some(value) = patch.get(key) {
        *target = optional_string(value);
    }
}

fn patch_bool(target: &mut bool, patch: &Value, key: &str) -> Result<(), AgentError> {
    if let Some(value) = patch.get(key) {
        *target = bool_from_value(value)?;
    }
    Ok(())
}

fn patch_u16(target: &mut u16, patch: &Value, key: &str) -> Result<(), AgentError> {
    if let Some(value) = patch.get(key) {
        *target = u16_from_value(value, key)?;
    }
    Ok(())
}

fn required_trimmed(value: Option<&str>, name: &str) -> Result<String, AgentError> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| AgentError::BadRequest(format!("{name} is required")))
}

fn parse_gmail_access_tier(
    raw: Option<&str>,
) -> Result<crate::auth::google::GmailAccessTier, AgentError> {
    match raw
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("readonly")
        .to_ascii_lowercase()
        .as_str()
    {
        "readonly" | "read-only" | "read_only" => {
            Ok(crate::auth::google::GmailAccessTier::ReadOnly)
        }
        "full" | "full-access" | "full_access" => Ok(crate::auth::google::GmailAccessTier::Full),
        value => Err(AgentError::BadRequest(format!(
            "unsupported Gmail access tier: {value}"
        ))),
    }
}

fn gmail_access_tier_id(tier: crate::auth::google::GmailAccessTier) -> &'static str {
    match tier {
        crate::auth::google::GmailAccessTier::Full => "full",
        crate::auth::google::GmailAccessTier::ReadOnly => "readonly",
    }
}

fn google_credentials_for_login(
    client_id: Option<&str>,
    client_secret: Option<&str>,
) -> Result<crate::auth::google::GoogleCredentials, AgentError> {
    let client_id = client_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let client_secret = client_secret
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    match (client_id, client_secret) {
        (Some(client_id), Some(client_secret)) => {
            let creds = crate::auth::google::GoogleCredentials {
                client_id,
                client_secret,
            };
            crate::auth::google::save_credentials(&creds)
                .map_err(|error| AgentError::Provider(error.to_string()))?;
            Ok(creds)
        }
        (None, None) => crate::auth::google::load_credentials().map_err(|_| {
            AgentError::BadRequest(
                "Google OAuth client ID and client secret are required before Gmail login"
                    .to_string(),
            )
        }),
        _ => Err(AgentError::BadRequest(
            "Google OAuth client ID and client secret must be saved together".to_string(),
        )),
    }
}

fn gui_login_providers() -> Vec<crate::provider_catalog::LoginProviderDescriptor> {
    crate::provider_catalog::login_providers()
        .iter()
        .copied()
        .filter(|provider| match provider.target {
            crate::provider_catalog::LoginProviderTarget::Claude
            | crate::provider_catalog::LoginProviderTarget::OpenAi
            | crate::provider_catalog::LoginProviderTarget::Gemini
            | crate::provider_catalog::LoginProviderTarget::Antigravity
            | crate::provider_catalog::LoginProviderTarget::Google
            | crate::provider_catalog::LoginProviderTarget::OpenAiApiKey
            | crate::provider_catalog::LoginProviderTarget::OpenRouter
            | crate::provider_catalog::LoginProviderTarget::OpenAiCompatible(_) => true,
            _ => false,
        })
        .collect()
}

fn resolve_gui_login_provider(
    provider: &str,
) -> Result<crate::provider_catalog::LoginProviderDescriptor, AgentError> {
    let resolved = crate::provider_catalog::resolve_login_provider(provider).ok_or_else(|| {
        AgentError::BadRequest(format!("unknown Lyra Agent login provider: {provider}"))
    })?;
    gui_login_providers()
        .into_iter()
        .find(|entry| entry.id == resolved.id)
        .ok_or_else(|| {
            AgentError::BadRequest(format!(
                "{} login is not available in Lyra Agent settings",
                resolved.display_name
            ))
        })
}

fn login_provider_requires_callback(
    provider: crate::provider_catalog::LoginProviderDescriptor,
) -> bool {
    matches!(
        provider.target,
        crate::provider_catalog::LoginProviderTarget::Claude
            | crate::provider_catalog::LoginProviderTarget::OpenAi
            | crate::provider_catalog::LoginProviderTarget::Gemini
            | crate::provider_catalog::LoginProviderTarget::Antigravity
            | crate::provider_catalog::LoginProviderTarget::Google
    )
}

fn login_provider_requires_api_key(
    provider: crate::provider_catalog::LoginProviderDescriptor,
) -> bool {
    login_target_is_api_key(provider.target)
}

fn login_target_is_api_key(target: crate::provider_catalog::LoginProviderTarget) -> bool {
    matches!(
        target,
        crate::provider_catalog::LoginProviderTarget::OpenAiApiKey
            | crate::provider_catalog::LoginProviderTarget::OpenRouter
            | crate::provider_catalog::LoginProviderTarget::OpenAiCompatible(_)
    )
}

fn auth_state_string(state: crate::auth::AuthState) -> &'static str {
    match state {
        crate::auth::AuthState::Available => "available",
        crate::auth::AuthState::Expired => "expired",
        crate::auth::AuthState::NotConfigured => "notConfigured",
    }
}

#[allow(clippy::too_many_arguments)]
fn login_start_response(
    provider: &str,
    label: Option<String>,
    flow: JcodeAccountLoginFlow,
    auth_url: Option<String>,
    callback_hint: Option<String>,
    instructions: &str,
    requires_callback: bool,
    requires_api_key: bool,
) -> Result<JcodeAccountLoginStartResponse, AgentError> {
    let flow_id = encode_login_flow(&flow)?;
    Ok(JcodeAccountLoginStartResponse {
        provider: provider.to_string(),
        label,
        flow_id,
        auth_url,
        callback_hint,
        auth_kind: flow.auth_kind,
        instructions: instructions.to_string(),
        requires_callback,
        requires_api_key,
    })
}

fn encode_login_flow(flow: &JcodeAccountLoginFlow) -> Result<String, AgentError> {
    let bytes =
        serde_json::to_vec(flow).map_err(|error| AgentError::Serialization(error.to_string()))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn decode_login_flow(flow_id: Option<&str>) -> Result<JcodeAccountLoginFlow, AgentError> {
    let encoded = required_trimmed(flow_id, "login flow")?;
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded.as_bytes())
        .map_err(|_| AgentError::BadRequest("invalid login flow".to_string()))?;
    serde_json::from_slice(&bytes)
        .map_err(|_| AgentError::BadRequest("invalid login flow".to_string()))
}

fn ensure_flow_provider(flow: &JcodeAccountLoginFlow, provider: &str) -> Result<(), AgentError> {
    if flow.provider == provider {
        Ok(())
    } else {
        Err(AgentError::BadRequest(
            "login flow provider mismatch; start login again".to_string(),
        ))
    }
}

fn api_key_profile_defaults(
    provider: crate::provider_catalog::LoginProviderDescriptor,
    request: &JcodeAccountLoginCompleteRequest,
) -> Result<(String, String, Option<String>, String), AgentError> {
    match provider.target {
        crate::provider_catalog::LoginProviderTarget::OpenAiApiKey => {
            let profile_name = request
                .profile_name
                .as_deref()
                .or(request.label.as_deref())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("openai-api")
                .to_string();
            Ok((
                sanitize_profile_name(&profile_name)?,
                request
                    .base_url
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("https://api.openai.com/v1")
                    .to_string(),
                request
                    .default_model
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned),
                "openai-compatible".to_string(),
            ))
        }
        crate::provider_catalog::LoginProviderTarget::OpenRouter => {
            let profile_name = request
                .profile_name
                .as_deref()
                .or(request.label.as_deref())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("openrouter")
                .to_string();
            Ok((
                sanitize_profile_name(&profile_name)?,
                request
                    .base_url
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("https://openrouter.ai/api/v1")
                    .to_string(),
                request
                    .default_model
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned),
                "openrouter".to_string(),
            ))
        }
        crate::provider_catalog::LoginProviderTarget::OpenAiCompatible(profile) => {
            let resolved = crate::provider_catalog::resolve_openai_compatible_profile(profile);
            let profile_name = request
                .profile_name
                .as_deref()
                .or(request.label.as_deref())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(resolved.id.as_str())
                .to_string();
            Ok((
                sanitize_profile_name(&profile_name)?,
                request
                    .base_url
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(resolved.api_base.as_str())
                    .to_string(),
                request
                    .default_model
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned)
                    .or(resolved.default_model),
                "openai-compatible".to_string(),
            ))
        }
        _ => Err(AgentError::BadRequest(
            "provider does not support API key login".to_string(),
        )),
    }
}

fn jcode_accounts_response() -> JcodeAccountsResponse {
    let config = crate::config::Config::load();
    let mut accounts = Vec::new();

    if let Ok(openai_accounts) = crate::auth::codex::list_accounts() {
        let active = crate::auth::codex::active_account_label();
        for account in openai_accounts {
            accounts.push(JcodeAccountSnapshot {
                provider: "openai".to_string(),
                label: account.label.clone(),
                kind: "oauth".to_string(),
                active: active.as_deref() == Some(account.label.as_str()),
                configured: true,
                detail: account.email.or(account.account_id),
            });
        }
    }

    if let Ok(claude_accounts) = crate::auth::claude::list_accounts() {
        let active = crate::auth::claude::active_account_label();
        for account in claude_accounts {
            accounts.push(JcodeAccountSnapshot {
                provider: "anthropic".to_string(),
                label: account.label.clone(),
                kind: "oauth".to_string(),
                active: active.as_deref() == Some(account.label.as_str()),
                configured: true,
                detail: account.email.or(account.subscription_type),
            });
        }
    }

    if let Ok(tokens) = crate::auth::gemini::load_tokens() {
        accounts.push(JcodeAccountSnapshot {
            provider: "gemini".to_string(),
            label: tokens.email.unwrap_or_else(|| "gemini".to_string()),
            kind: "oauth".to_string(),
            active: config.provider.default_provider.as_deref() == Some("gemini"),
            configured: true,
            detail: Some(auth_state_string(configure_token_state(tokens.expires_at)).to_string()),
        });
    }

    if let Ok(tokens) = crate::auth::antigravity::load_tokens() {
        accounts.push(JcodeAccountSnapshot {
            provider: "antigravity".to_string(),
            label: tokens.email.unwrap_or_else(|| "antigravity".to_string()),
            kind: "oauth".to_string(),
            active: config.provider.default_provider.as_deref() == Some("antigravity"),
            configured: true,
            detail: tokens.project_id,
        });
    }

    if let Ok(tokens) = crate::auth::google::load_tokens() {
        let state = auth_state_string(configure_token_state(tokens.expires_at));
        accounts.push(JcodeAccountSnapshot {
            provider: "google".to_string(),
            label: tokens.email.unwrap_or_else(|| "gmail".to_string()),
            kind: "oauth".to_string(),
            active: false,
            configured: true,
            detail: Some(format!("{} · {}", tokens.tier.label(), state)),
        });
    }

    for (label, profile) in &config.providers {
        accounts.push(JcodeAccountSnapshot {
            provider: match &profile.provider_type {
                crate::config::NamedProviderType::OpenRouter => "openrouter".to_string(),
                crate::config::NamedProviderType::OpenAiCompatible => {
                    "openai-compatible".to_string()
                }
            },
            label: label.clone(),
            kind: "api-key".to_string(),
            active: config.provider.default_provider.as_deref() == Some(label.as_str()),
            configured: named_provider_profile_is_configured(label, profile),
            detail: Some(profile.base_url.clone()),
        });
    }

    JcodeAccountsResponse {
        default_provider: config.provider.default_provider,
        default_model: config.provider.default_model,
        auth_status: auth_status_snapshot_value(),
        accounts,
    }
}

fn configure_token_state(expires_at: i64) -> crate::auth::AuthState {
    if expires_at <= chrono::Utc::now().timestamp_millis() {
        crate::auth::AuthState::Expired
    } else {
        crate::auth::AuthState::Available
    }
}

fn named_provider_profile_is_configured(
    profile_name: &str,
    profile: &crate::config::NamedProviderConfig,
) -> bool {
    let has_inline_key = profile
        .api_key
        .as_deref()
        .is_some_and(|key| !key.trim().is_empty());
    let env_key = profile
        .api_key_env
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| default_env_key_for_profile(profile_name));
    let env_file = profile
        .env_file
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| default_env_file_for_profile(profile_name));
    let has_stored_key =
        crate::provider_catalog::load_api_key_from_env_or_config(&env_key, &env_file).is_some();
    let has_key = has_inline_key || has_stored_key;
    if profile.requires_api_key.unwrap_or(true) {
        return has_key;
    }
    has_key || !profile.base_url.trim().is_empty()
}

fn auth_status_snapshot_value() -> Value {
    let status = crate::auth::AuthStatus::check_fast();
    json!({
        "anthropic": {
            "state": status.anthropic.state,
            "hasOAuth": status.anthropic.has_oauth,
            "hasApiKey": status.anthropic.has_api_key,
        },
        "openrouter": status.openrouter,
        "azure": {
            "state": status.azure,
            "hasApiKey": status.azure_has_api_key,
            "usesEntra": status.azure_uses_entra,
        },
        "bedrock": status.bedrock,
        "openai": {
            "state": status.openai,
            "hasOAuth": status.openai_has_oauth,
            "hasApiKey": status.openai_has_api_key,
        },
        "copilot": {
            "state": status.copilot,
            "hasApiToken": status.copilot_has_api_token,
        },
        "antigravity": status.antigravity,
        "gemini": status.gemini,
        "cursor": status.cursor,
        "google": {
            "state": status.google,
            "canSend": status.google_can_send,
        },
    })
}

fn summary_from_jcode_session(session: &Session) -> JcodeSessionSummary {
    JcodeSessionSummary {
        id: session.id.clone(),
        title: session.display_title_or_name().to_string(),
        session_kind: session_kind(session),
        custom_title: session.custom_title.clone(),
        short_name: session.short_name.clone(),
        status: session.status.display().to_string(),
        provider_key: session.provider_key.clone(),
        model: session.model.clone(),
        message_count: session.messages.len(),
        created_at: session.created_at,
        updated_at: session.updated_at,
        last_active_at: session.last_active_at,
        saved: session.saved,
        save_label: session.save_label.clone(),
        archived: session.archived,
        working_dir: Some(session_working_dir(session)),
    }
}

fn resolve_create_working_dir(requested: Option<&str>) -> Result<String, AgentError> {
    if requested
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
    {
        return normalize_working_dir(requested);
    }

    let inherited = {
        let runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
        runtime
            .active_session_id
            .as_ref()
            .and_then(|session_id| runtime.sessions.get(session_id))
            .and_then(|session| {
                session
                    .snapshot
                    .project_bound
                    .then(|| session.snapshot.working_dir.clone())
            })
    };

    match inherited {
        Some(working_dir) => normalize_working_dir(Some(&working_dir)),
        None => normalize_working_dir(None),
    }
}

fn default_unbound_working_dir_path() -> PathBuf {
    #[cfg(windows)]
    {
        return std::env::current_dir()
            .ok()
            .and_then(|path| path.ancestors().last().map(Path::to_path_buf))
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or_else(|| PathBuf::from(r"C:\"));
    }

    #[cfg(not(windows))]
    {
        PathBuf::from("/")
    }
}

fn default_unbound_working_dir() -> String {
    let root = default_unbound_working_dir_path();
    root.canonicalize()
        .unwrap_or(root)
        .to_string_lossy()
        .to_string()
}

fn resolve_lyra_repo_dir() -> Result<PathBuf, AgentError> {
    let compile_time = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(root) = find_lyra_repo_in_ancestors(&compile_time) {
        return Ok(root);
    }
    if let Ok(cwd) = std::env::current_dir()
        && let Some(root) = find_lyra_repo_in_ancestors(&cwd)
    {
        return Ok(root);
    }
    Err(AgentError::Provider(
        "Could not find the Lyra source repository for self-dev mode.".to_string(),
    ))
}

fn find_lyra_repo_in_ancestors(start: &Path) -> Option<PathBuf> {
    start
        .ancestors()
        .find(|dir| is_lyra_repo_root(dir))
        .map(Path::to_path_buf)
}

fn is_lyra_repo_root(dir: &Path) -> bool {
    let cargo_toml = dir.join("Cargo.toml");
    if !cargo_toml.is_file() || !dir.join(".git").exists() {
        return false;
    }
    if !dir
        .join("apps")
        .join("desktop")
        .join("package.json")
        .is_file()
    {
        return false;
    }
    if !dir.join("crates").join("lyra-agent-core").is_dir() {
        return false;
    }
    std::fs::read_to_string(cargo_toml)
        .map(|content| content.contains("[workspace]"))
        .unwrap_or(false)
}

fn normalize_working_dir(requested: Option<&str>) -> Result<String, AgentError> {
    let trimmed = requested.map(str::trim).filter(|value| !value.is_empty());
    let raw_path = trimmed
        .map(PathBuf::from)
        .unwrap_or_else(default_unbound_working_dir_path);
    let canonical = raw_path.canonicalize().map_err(|error| {
        AgentError::BadRequest(format!(
            "working directory does not exist: {} ({error})",
            raw_path.display()
        ))
    })?;
    if !canonical.is_dir() {
        return Err(AgentError::BadRequest(format!(
            "working directory is not a directory: {}",
            canonical.display()
        )));
    }
    Ok(canonical.to_string_lossy().to_string())
}

fn session_working_dir(session: &Session) -> String {
    session
        .working_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(default_unbound_working_dir)
}

fn is_project_bound(working_dir: &str) -> bool {
    Path::new(working_dir) != Path::new(&default_unbound_working_dir())
}

fn apply_session_working_dir(session: &mut Session, working_dir: &str) {
    session.working_dir = Some(working_dir.to_string());
    session.updated_at = Utc::now();
    session.refresh_initial_session_context_message();
}

fn session_kind(session: &Session) -> AgentSessionKind {
    if is_overnight_coordinator_session(&session.id) {
        AgentSessionKind::Overnight
    } else if session.is_canary && session.testing_build.as_deref() == Some("self-dev") {
        AgentSessionKind::Selfdev
    } else {
        AgentSessionKind::Normal
    }
}

fn is_overnight_coordinator_session(session_id: &str) -> bool {
    overnight_manifests()
        .map(|manifests| {
            manifests
                .iter()
                .any(|manifest| manifest.coordinator_session_id == session_id)
        })
        .unwrap_or(false)
}

fn resolve_existing_session_id(session_id: Option<String>) -> Result<String, AgentError> {
    if let Some(session_id) = normalized_nonempty(session_id.as_deref()) {
        read_memory_session_record(&session_id)?;
        return Ok(session_id);
    }
    let runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
    runtime
        .active_session_id
        .clone()
        .ok_or_else(|| AgentError::BadRequest("agent sessionId is required".to_string()))
}

fn reject_loaded_running_action(session_id: &str, action: &str) -> Result<(), AgentError> {
    let runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
    if let Some(session) = runtime.sessions.get(session_id)
        && (session.snapshot.follow.running || session.shutdown_signal.is_some())
    {
        return Err(AgentError::BadRequest(format!(
            "cannot start {action} while the agent is running"
        )));
    }
    Ok(())
}

fn overnight_manifests() -> Result<Vec<crate::overnight::OvernightManifest>, AgentError> {
    let dir =
        crate::overnight::runs_dir().map_err(|error| AgentError::Provider(error.to_string()))?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut manifests = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|error| AgentError::Provider(error.to_string()))? {
        let entry = entry.map_err(|error| AgentError::Provider(error.to_string()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| AgentError::Provider(error.to_string()))?;
        if !file_type.is_dir() {
            continue;
        }
        let path = entry.path().join("manifest.json");
        if !path.exists() {
            continue;
        }
        match crate::storage::read_json::<crate::overnight::OvernightManifest>(&path) {
            Ok(manifest) => manifests.push(manifest),
            Err(error) => crate::logging::warn(&format!(
                "Failed to read overnight manifest {}: {}",
                path.display(),
                error
            )),
        }
    }
    manifests.sort_by_key(|manifest| manifest.started_at);
    Ok(manifests)
}

fn requested_overnight_manifest(
    run_id: Option<String>,
) -> Result<Option<crate::overnight::OvernightManifest>, AgentError> {
    if let Some(run_id) = normalized_nonempty(run_id.as_deref()) {
        let manifest = crate::overnight::load_manifest(&run_id)
            .map_err(|error| AgentError::Provider(error.to_string()))?;
        return Ok(Some(manifest));
    }
    Ok(overnight_manifests()?.pop())
}

fn request_overnight_cancel(
    mut manifest: crate::overnight::OvernightManifest,
) -> Result<crate::overnight::OvernightManifest, AgentError> {
    if matches!(
        manifest.status,
        crate::overnight::OvernightRunStatus::Completed
            | crate::overnight::OvernightRunStatus::Failed
    ) {
        return Ok(manifest);
    }
    manifest.status = crate::overnight::OvernightRunStatus::CancelRequested;
    manifest.cancel_requested_at = Some(Utc::now());
    crate::overnight::save_manifest(&manifest)
        .map_err(|error| AgentError::Provider(error.to_string()))?;
    crate::overnight::record_event(
        &manifest,
        "cancel_requested",
        "User requested overnight cancellation".to_string(),
        json!({}),
        true,
    )
    .map_err(|error| AgentError::Provider(error.to_string()))?;
    crate::overnight::render_review_html(&manifest)
        .map_err(|error| AgentError::Provider(error.to_string()))?;
    Ok(manifest)
}

fn overnight_run_snapshot(
    manifest: &crate::overnight::OvernightManifest,
    include_review: bool,
) -> Result<JcodeOvernightRunSnapshot, AgentError> {
    let events = crate::overnight::read_events(manifest)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|event| serde_json::to_value(event).ok())
        .collect::<Vec<_>>();
    let task_cards = crate::overnight::read_task_cards(manifest)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|card| serde_json::to_value(card).ok())
        .collect::<Vec<_>>();
    let progress = serde_json::to_value(crate::overnight::build_progress_card(manifest))
        .unwrap_or_else(|_| json!({}));
    let manifest_value = serde_json::to_value(manifest).unwrap_or_else(|_| json!({}));
    let review_html = if include_review {
        crate::overnight::render_review_html(manifest)
            .map_err(|error| AgentError::Provider(error.to_string()))?;
        std::fs::read_to_string(&manifest.review_path).ok()
    } else {
        None
    };
    let coordinator_snapshot = jcode_session_for_memory_session(&manifest.coordinator_session_id)
        .ok()
        .map(|session| {
            snapshot_from_jcode_session(
                &session,
                TurnStatus::Idle,
                None,
                AgentFollowState {
                    running: matches!(
                        manifest.status,
                        crate::overnight::OvernightRunStatus::Running
                            | crate::overnight::OvernightRunStatus::CancelRequested
                    ),
                    activity: Some(manifest.status.label().to_string()),
                },
                Vec::new(),
            )
        });

    Ok(JcodeOvernightRunSnapshot {
        run_id: manifest.run_id.clone(),
        parent_session_id: manifest.parent_session_id.clone(),
        coordinator_session_id: manifest.coordinator_session_id.clone(),
        coordinator_session_name: manifest.coordinator_session_name.clone(),
        status: manifest.status.label().to_string(),
        mission: manifest.mission.clone(),
        working_dir: manifest.working_dir.clone(),
        provider_name: manifest.provider_name.clone(),
        model: manifest.model.clone(),
        started_at: manifest.started_at,
        target_wake_at: manifest.target_wake_at,
        handoff_ready_at: manifest.handoff_ready_at,
        post_wake_grace_until: manifest.post_wake_grace_until,
        last_activity_at: manifest.last_activity_at,
        completed_at: manifest.completed_at,
        cancel_requested_at: manifest.cancel_requested_at,
        run_dir: manifest.run_dir.display().to_string(),
        log_path: manifest.human_log_path.display().to_string(),
        review_path: manifest.review_path.display().to_string(),
        manifest: manifest_value,
        progress,
        events,
        task_cards,
        status_markdown: crate::overnight::format_status_markdown(manifest),
        log_markdown: crate::overnight::format_log_markdown(manifest, 80),
        review_html,
        coordinator_snapshot,
    })
}

fn mutate_session_metadata(
    session_id: &str,
    mutate_persisted: impl FnOnce(&mut Session),
    mutate_loaded_agent: impl FnOnce(&mut Agent) -> Result<()>,
) -> Result<String, AgentError> {
    let loaded_agent = {
        let runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
        runtime
            .sessions
            .get(session_id)
            .map(|session| session.agent.clone())
    };

    if let Some(agent) = loaded_agent {
        let mutation_result = block_on(async {
            let mut guard = agent.lock().await;
            mutate_loaded_agent(&mut guard)
        })?;
        mutation_result.map_err(|error| AgentError::Provider(error.to_string()))?;
    } else {
        let store = agent_memory_store()?;
        let memory_snapshot = store.snapshot(session_id).map_err(|error| {
            AgentError::Provider(format!("agent memory snapshot failed: {error}"))
        })?;
        let record = memory_snapshot
            .session
            .as_ref()
            .ok_or_else(|| AgentError::SessionNotFound(session_id.to_string()))?;
        let mut session = jcode_session_from_agent_memory(record, Some(&memory_snapshot));
        mutate_persisted(&mut session);
        store
            .update_session_title(&session.id, session.display_title_or_name())
            .and_then(|()| {
                store.update_session_model_snapshot(
                    &session.id,
                    session.working_dir.as_deref(),
                    session.provider_key.as_deref(),
                    session.model.as_deref(),
                )
            })
            .and_then(|()| {
                store.update_session_status(
                    &session.id,
                    if session.archived {
                        MemorySessionStatus::Archived
                    } else {
                        MemorySessionStatus::Idle
                    },
                )
            })
            .map_err(|error| {
                AgentError::Provider(format!("agent memory metadata failed: {error}"))
            })?;
    }

    let record = read_memory_session_record(session_id)?;
    let summary = summary_from_agent_memory_session(&record);
    if let Ok(mut runtime) = RUNTIME.lock()
        && let Some(loaded) = runtime.sessions.get_mut(session_id)
    {
        loaded.snapshot.title = record.title.clone();
        loaded.snapshot.updated_at = parse_memory_time(&record.updated_at_iso);
        emit_event(AgentRuntimeEvent::SessionSnapshot {
            snapshot: loaded.snapshot.clone(),
        });
    }
    encode(&summary)
}

pub fn list_jcode_sessions_json(payload: String) -> Result<String, AgentError> {
    let request: Value = parse_request(&payload)?;
    let limit = request
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(100)
        .min(500) as usize;
    let store = agent_memory_store()?;
    let sessions_dir = store.root().join("sessions");
    let mut sessions = store
        .list_sessions()
        .map_err(|error| AgentError::Provider(format!("agent memory list failed: {error}")))?
        .into_iter()
        .map(|session| summary_from_agent_memory_session(&session))
        .collect::<Vec<_>>();
    sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    sessions.truncate(limit);
    encode(&json!({
        "sessionsDir": sessions_dir.display().to_string(),
        "sessions": sessions,
    }))
}

#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgentRuntimeEvent {
    SessionSnapshot {
        snapshot: AgentSessionSnapshot,
    },
    #[serde(rename = "messageCommitted")]
    MessageAppended {
        session_id: String,
        message: AgentMessage,
    },
    MessageDelta {
        session_id: String,
        message_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        block_id: Option<String>,
        #[serde(skip_serializing_if = "is_false")]
        replace: bool,
        delta: String,
    },
    ToolStarted {
        session_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        message_id: Option<String>,
        tool: ToolActivity,
    },
    ToolFinished {
        session_id: String,
        tool: ToolActivity,
    },
    #[serde(rename = "memoryUpdated")]
    MemorySnapshot {
        session_id: String,
        snapshot: AgentMemorySnapshot,
    },
    TurnStarted {
        session_id: String,
        turn_id: String,
        state: RuntimeTurnState,
    },
    TurnStateChanged {
        session_id: String,
        turn_id: String,
        state: RuntimeTurnState,
        reason: String,
    },
    ToolUpdated {
        session_id: String,
        turn_id: String,
        tool: ToolActivity,
    },
    ContextTrimmed {
        session_id: String,
        detail: Value,
    },
    TurnRecovered {
        session_id: String,
        turn_id: String,
    },
    TurnCompleted {
        session_id: String,
        turn_id: String,
    },
    TodoUpdated {
        session_id: String,
        todos: Vec<AgentTodoItem>,
    },
    #[serde(rename = "clarificationRequested")]
    ClarificationRequired {
        session_id: String,
        clarification_id: String,
        question: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        options: Vec<ClarificationOption>,
        allow_custom_answer: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },
    ClarificationResolved {
        session_id: String,
        clarification_id: String,
    },
    #[serde(rename = "browserActivityChanged")]
    BrowserTargetUpdated {
        session_id: String,
        turn_id: String,
        target: Value,
    },
    #[serde(rename = "permissionRequested")]
    PermissionRequired {
        session_id: String,
        permission_id: String,
        title: String,
        detail: String,
    },
    TurnFinished {
        session_id: String,
        turn_id: String,
        status: TurnStatus,
    },
    TurnFailed {
        session_id: String,
        turn_id: String,
        message: String,
    },
    FollowStateChanged {
        session_id: String,
        follow: AgentFollowState,
    },
    RollbackStarted {
        session_id: String,
        message_id: String,
    },
    RollbackFinished {
        session_id: String,
        message_id: String,
        removed_message_count: usize,
        restored_file_count: usize,
    },
    RollbackFailed {
        session_id: String,
        message_id: String,
        message: String,
    },
}

fn run_jcode_turn(
    session_id: String,
    turn_id: String,
    text: String,
    images: Vec<(String, String)>,
    system_reminder: Option<String>,
    agent: Arc<tokio::sync::Mutex<Agent>>,
    shutdown_signal: InterruptSignal,
) {
    let event_session_id = session_id.clone();
    let event_turn_id = turn_id.clone();
    let result = block_on(async move {
        let (event_tx, event_rx) = mpsc::unbounded_channel();
        let event_task = tokio::spawn(async move {
            consume_jcode_events(event_session_id, event_turn_id, event_rx).await;
        });

        let run_result = {
            let mut guard = agent.lock().await;
            let recovery_reminder = system_reminder
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            if text.trim().is_empty() && images.is_empty() {
                if let Some(reminder) = recovery_reminder {
                    guard
                        .continue_streaming_mpsc_with_system_reminder(reminder, event_tx)
                        .await
                } else {
                    guard
                        .run_once_streaming_mpsc(&text, images, system_reminder, event_tx)
                        .await
                }
            } else {
                guard
                    .run_once_streaming_mpsc(&text, images, system_reminder, event_tx)
                    .await
            }
        };
        let _ = event_task.await;
        run_result.map_err(|error| AgentError::Provider(error.to_string()))
    });

    match result.and_then(|inner| inner) {
        Ok(()) if shutdown_signal.is_set() => {
            finish_turn(&session_id, &turn_id, TurnStatus::Cancelled)
        }
        Ok(()) => {
            finish_turn(&session_id, &turn_id, TurnStatus::Finished);
        }
        Err(error) if shutdown_signal.is_set() => {
            finish_turn(&session_id, &turn_id, TurnStatus::Cancelled);
            emit_event(AgentRuntimeEvent::TurnFailed {
                session_id,
                turn_id,
                message: error.to_string(),
            });
        }
        Err(error) => fail_turn(&session_id, &turn_id, error.to_string()),
    }
}

async fn consume_jcode_events(
    session_id: String,
    turn_id: String,
    mut event_rx: mpsc::UnboundedReceiver<ServerEvent>,
) {
    let mut assistant_id: Option<String> = None;
    while let Some(event) = event_rx.recv().await {
        if !turn_is_active(&session_id, &turn_id) {
            continue;
        }
        match event {
            ServerEvent::TextDelta { text } => {
                transition_memory_turn(
                    &session_id,
                    &turn_id,
                    RuntimeTurnState::StreamingModel,
                    "text_delta",
                );
                let message_id = ensure_assistant_message(&session_id, &mut assistant_id);
                if let Some(message_id) = message_id {
                    let _ = append_message_delta(&session_id, &message_id, &text);
                }
            }
            ServerEvent::TextReplace { text } => {
                transition_memory_turn(
                    &session_id,
                    &turn_id,
                    RuntimeTurnState::StreamingModel,
                    "text_replace",
                );
                let message_id = ensure_assistant_message(&session_id, &mut assistant_id);
                if let Some(message_id) = message_id {
                    let _ = replace_message_text(&session_id, &message_id, text);
                }
            }
            ServerEvent::ToolStart { id, name } | ServerEvent::ToolExec { id, name } => {
                transition_memory_turn(
                    &session_id,
                    &turn_id,
                    RuntimeTurnState::WaitingForTool,
                    "tool_started",
                );
                let message_id = ensure_assistant_message(&session_id, &mut assistant_id);
                let tool = ToolActivity {
                    id: id.clone(),
                    name: name.clone(),
                    label: live_tool_label(&name),
                    status: ToolActivityStatus::Running,
                    input: Value::Object(serde_json::Map::new()),
                    output: None,
                    started_at: Utc::now(),
                    finished_at: None,
                };
                if let Some(message_id) = message_id.as_deref() {
                    let _ = append_tool_block(&session_id, message_id, &id);
                }
                let _ = upsert_tool(&session_id, tool.clone());
                set_follow_activity(&session_id, &tool.label);
                emit_event(AgentRuntimeEvent::ToolStarted {
                    session_id: session_id.clone(),
                    message_id,
                    tool,
                });
            }
            ServerEvent::ToolInput { delta } => {
                update_last_running_tool_input(&session_id, delta);
            }
            ServerEvent::ToolDone {
                id,
                name,
                output,
                error,
            } => {
                let failed = error.is_some();
                let input = current_tool_input(&session_id, &id);
                let tool = ToolActivity {
                    id: id.clone(),
                    name: name.clone(),
                    label: finished_tool_label(&name, failed),
                    status: if failed {
                        ToolActivityStatus::Failed
                    } else {
                        ToolActivityStatus::Completed
                    },
                    input: input.clone(),
                    output: Some(json!({ "content": output.clone(), "error": error.clone() })),
                    started_at: Utc::now(),
                    finished_at: Some(Utc::now()),
                };
                let _ = upsert_tool(&session_id, tool.clone());
                if let Ok(store) = agent_memory_store() {
                    if let Some(target) = record_browser_memory_for_tool(
                        &store,
                        &session_id,
                        &turn_id,
                        &id,
                        &name,
                        &input,
                        tool.output.as_ref().cloned().unwrap_or_else(|| json!({})),
                    ) {
                        emit_event(AgentRuntimeEvent::BrowserTargetUpdated {
                            session_id: session_id.clone(),
                            turn_id: turn_id.clone(),
                            target,
                        });
                    }
                }
                emit_event(AgentRuntimeEvent::ToolFinished {
                    session_id: session_id.clone(),
                    tool: tool.clone(),
                });
                emit_event(AgentRuntimeEvent::ToolUpdated {
                    session_id: session_id.clone(),
                    turn_id: turn_id.clone(),
                    tool,
                });
                if !failed && name == "todo" {
                    emit_todo_updated(&session_id);
                }
            }
            ServerEvent::ConnectionPhase { phase } => {
                set_follow_activity(&session_id, &phase);
            }
            ServerEvent::StatusDetail { detail } => {
                set_follow_activity(&session_id, &detail);
            }
            ServerEvent::Pong { .. } => {
                emit_follow_heartbeat(&session_id);
            }
            ServerEvent::MessageEnd => {}
            ServerEvent::Interrupted => {
                set_follow_activity(&session_id, "Interrupted");
                transition_memory_turn(
                    &session_id,
                    &turn_id,
                    RuntimeTurnState::Interrupted,
                    "server_interrupted",
                );
            }
            ServerEvent::Error { message, .. } => {
                set_follow_activity(&session_id, &message);
            }
            _ => {}
        }
    }
}

fn current_tool_input(session_id: &str, tool_id: &str) -> Value {
    let raw = RUNTIME
        .lock()
        .ok()
        .and_then(|runtime| {
            runtime.sessions.get(session_id).and_then(|session| {
                session
                    .snapshot
                    .tools
                    .iter()
                    .rev()
                    .find(|tool| tool.id == tool_id)
                    .map(|tool| tool.input.clone())
            })
        })
        .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
    normalize_tool_input(raw)
}

fn normalize_tool_input(input: Value) -> Value {
    let Some(delta) = input.get("delta").and_then(Value::as_str) else {
        return input;
    };
    serde_json::from_str(delta).unwrap_or(input)
}

fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(text) = value.get(*key).and_then(Value::as_str) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
        if let Some(number) = value.get(*key).and_then(Value::as_i64) {
            return Some(number.to_string());
        }
    }
    None
}

fn typed_tool_result_status(
    name: &str,
    input: &Value,
    output: &str,
    error: Option<&str>,
) -> ToolResultStatus {
    if error == Some("runtime_reload_interrupted") {
        return ToolResultStatus::UnknownAfterRecovery;
    }
    if is_lumen_load_idle_timeout(name, input, output) {
        return ToolResultStatus::TimedOutPartial;
    }
    if error.is_some() {
        return ToolResultStatus::FailedRetryable;
    }
    ToolResultStatus::Success
}

fn is_lumen_load_idle_timeout(name: &str, input: &Value, output: &str) -> bool {
    if name != "lyra_lumen" {
        return false;
    }
    let action = string_field(input, &["action"]);
    let until = string_field(input, &["until"]);
    action.as_deref() == Some("wait")
        && until.as_deref() == Some("loadIdle")
        && output.to_ascii_lowercase().contains("timed out")
}

fn record_browser_memory_for_tool(
    store: &AgentMemoryStore,
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    name: &str,
    input: &Value,
    output: Value,
) -> Option<Value> {
    if name != "lyra_lumen" {
        return None;
    }
    let action = string_field(input, &["action"]).unwrap_or_else(|| "browser".to_string());
    let workbench_tab_id = string_field(input, &["tabId", "tab_id"]);
    let lumen_target_id = string_field(input, &["elementId", "element_id"]);
    let payload = json!({
        "toolCallId": tool_call_id,
        "action": action.clone(),
        "workbenchTabId": workbench_tab_id.clone(),
        "lumenTargetId": lumen_target_id.clone(),
        "input": input,
        "output": output
    });
    store
        .record_browser_action(
            session_id,
            turn_id,
            workbench_tab_id.as_deref(),
            lumen_target_id.as_deref(),
            &action,
            payload.clone(),
        )
        .ok()?;
    Some(payload)
}

fn turn_is_active(session_id: &str, turn_id: &str) -> bool {
    RUNTIME
        .lock()
        .ok()
        .and_then(|runtime| {
            runtime.sessions.get(session_id).and_then(|session| {
                session
                    .snapshot
                    .active_turn_id
                    .as_deref()
                    .map(str::to_owned)
            })
        })
        .as_deref()
        == Some(turn_id)
}

fn transition_memory_turn(session_id: &str, turn_id: &str, state: RuntimeTurnState, reason: &str) {
    if let Ok(store) = agent_memory_store()
        && store
            .transition_runtime_turn(session_id, turn_id, state.clone(), reason)
            .is_ok()
    {
        emit_event(AgentRuntimeEvent::TurnStateChanged {
            session_id: session_id.to_string(),
            turn_id: turn_id.to_string(),
            state,
            reason: reason.to_string(),
        });
    }
}

fn ensure_assistant_message(session_id: &str, assistant_id: &mut Option<String>) -> Option<String> {
    if let Some(id) = assistant_id.clone() {
        return Some(id);
    }
    let id = Uuid::new_v4().to_string();
    if append_assistant_message(session_id, &id).is_ok() {
        *assistant_id = Some(id.clone());
        Some(id)
    } else {
        None
    }
}

fn append_assistant_message(session_id: &str, message_id: &str) -> Result<(), AgentError> {
    let message = AgentMessage {
        id: message_id.to_string(),
        role: AgentRole::Assistant,
        text: String::new(),
        blocks: Vec::new(),
        created_at: Utc::now(),
        rollback: None,
    };
    with_session(session_id, |session| {
        session.snapshot.messages.push(message.clone());
        session.snapshot.updated_at = Utc::now();
    })?;
    emit_event(AgentRuntimeEvent::MessageAppended {
        session_id: session_id.to_string(),
        message,
    });
    Ok(())
}

fn append_message_delta(session_id: &str, message_id: &str, delta: &str) -> Result<(), AgentError> {
    let mut block_id = None;
    with_session(session_id, |session| {
        if let Some(message) = session
            .snapshot
            .messages
            .iter_mut()
            .find(|message| message.id == message_id)
        {
            message.text.push_str(delta);
            let next_block_index = message.blocks.len();
            let current_block_id = match message.blocks.last_mut() {
                Some(AgentMessageBlock::Text { id, text }) => {
                    text.push_str(delta);
                    id.clone()
                }
                _ => {
                    let id = format!("text-{next_block_index}");
                    message.blocks.push(AgentMessageBlock::Text {
                        id: id.clone(),
                        text: delta.to_string(),
                    });
                    id
                }
            };
            block_id = Some(current_block_id);
        }
        session.snapshot.updated_at = Utc::now();
    })?;
    emit_event(AgentRuntimeEvent::MessageDelta {
        session_id: session_id.to_string(),
        message_id: message_id.to_string(),
        block_id,
        replace: false,
        delta: delta.to_string(),
    });
    Ok(())
}

fn replace_message_text(
    session_id: &str,
    message_id: &str,
    text: String,
) -> Result<(), AgentError> {
    with_session(session_id, |session| {
        if let Some(message) = session
            .snapshot
            .messages
            .iter_mut()
            .find(|message| message.id == message_id)
        {
            message.text = text.clone();
            message.blocks = vec![AgentMessageBlock::Text {
                id: "text-0".to_string(),
                text: text.clone(),
            }];
        }
        session.snapshot.updated_at = Utc::now();
    })?;
    emit_event(AgentRuntimeEvent::MessageDelta {
        session_id: session_id.to_string(),
        message_id: message_id.to_string(),
        block_id: Some("text-0".to_string()),
        replace: true,
        delta: text,
    });
    Ok(())
}

fn append_tool_block(session_id: &str, message_id: &str, tool_id: &str) -> Result<(), AgentError> {
    with_session(session_id, |session| {
        if let Some(message) = session
            .snapshot
            .messages
            .iter_mut()
            .find(|message| message.id == message_id)
        {
            if !message.blocks.iter().any(|block| {
                matches!(block, AgentMessageBlock::Tool { tool_id: existing, .. } if existing == tool_id)
            }) {
                message.blocks.push(AgentMessageBlock::Tool {
                    id: format!("tool-{tool_id}"),
                    tool_id: tool_id.to_string(),
                });
            }
        }
        session.snapshot.updated_at = Utc::now();
    })
}

fn upsert_tool(session_id: &str, tool: ToolActivity) -> Result<(), AgentError> {
    with_session(session_id, |session| {
        session
            .snapshot
            .tools
            .retain(|existing| existing.id != tool.id);
        session.snapshot.tools.push(tool);
        session.snapshot.updated_at = Utc::now();
    })
}

fn update_last_running_tool_input(session_id: &str, delta: String) {
    let _ = with_session(session_id, |session| {
        if let Some(tool) = session
            .snapshot
            .tools
            .iter_mut()
            .rev()
            .find(|tool| tool.status == ToolActivityStatus::Running)
        {
            tool.input = json!({ "delta": delta });
        }
        session.snapshot.updated_at = Utc::now();
    });
}

fn set_follow_activity(session_id: &str, activity: &str) {
    if let Ok(follow) = with_session_snapshot(session_id, |session| {
        session.snapshot.follow = AgentFollowState {
            running: true,
            activity: Some(activity.to_string()),
        };
        session.snapshot.updated_at = Utc::now();
        session.snapshot.follow.clone()
    }) {
        emit_event(AgentRuntimeEvent::FollowStateChanged {
            session_id: session_id.to_string(),
            follow,
        });
    }
}

fn emit_follow_heartbeat(session_id: &str) {
    if let Ok(follow) = with_session_snapshot(session_id, |session| session.snapshot.follow.clone())
    {
        if follow.running {
            emit_event(AgentRuntimeEvent::FollowStateChanged {
                session_id: session_id.to_string(),
                follow,
            });
        }
    }
}

fn finish_turn(session_id: &str, turn_id: &str, status: TurnStatus) {
    let mut should_emit = false;
    let mut final_assistant_text: Option<String> = None;
    let snapshot = with_session_snapshot(session_id, |session| {
        if session.snapshot.active_turn_id.as_deref() != Some(turn_id) {
            return session.snapshot.clone();
        }
        should_emit = true;
        final_assistant_text = session
            .snapshot
            .messages
            .iter()
            .rev()
            .find(|message| message.role == AgentRole::Assistant)
            .map(|message| message.text.clone())
            .filter(|text| !text.trim().is_empty());
        let tools = session.snapshot.tools.clone();
        bind_pending_rollback_anchors(session_id);
        let mut snapshot = persisted_snapshot(session_id, status.clone(), None, Some(tools))
            .unwrap_or_else(|_| {
                session.snapshot.turn_status = status.clone();
                session.snapshot.active_turn_id = None;
                session.snapshot.follow = AgentFollowState {
                    running: false,
                    activity: None,
                };
                session.snapshot.updated_at = Utc::now();
                session.snapshot.clone()
            });
        snapshot.follow = AgentFollowState {
            running: false,
            activity: None,
        };
        session.snapshot = snapshot.clone();
        session.shutdown_signal = None;
        snapshot
    });
    if !should_emit {
        return;
    }
    if let Ok(store) = agent_memory_store() {
        if let Some(text) = final_assistant_text {
            let has_assistant_event = store
                .read_events_by_runtime_turn(session_id, turn_id)
                .map(|events| events.iter().any(|event| event.kind == "assistant_message"))
                .unwrap_or(false);
            if !has_assistant_event {
                let _ = store.append_event(
                    session_id,
                    NewSessionEvent::assistant_message(text, Some(turn_id.to_string())),
                );
            }
        }
        let _ =
            store.update_session_status(session_id, memory_session_status_for_turn_status(&status));
    }
    transition_memory_turn(
        session_id,
        turn_id,
        memory_turn_state_for_turn_status(&status),
        "turn_finished",
    );
    cancel_pending_clarifications_for_session(session_id);
    if let Ok(snapshot) = snapshot {
        emit_event(AgentRuntimeEvent::SessionSnapshot { snapshot });
    }
    emit_event(AgentRuntimeEvent::TurnFinished {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        status: status.clone(),
    });
    if status == TurnStatus::Finished {
        emit_event(AgentRuntimeEvent::TurnCompleted {
            session_id: session_id.to_string(),
            turn_id: turn_id.to_string(),
        });
    }
    emit_event(AgentRuntimeEvent::FollowStateChanged {
        session_id: session_id.to_string(),
        follow: AgentFollowState {
            running: false,
            activity: None,
        },
    });
}

fn first_numbered_item(text: &str) -> Option<&str> {
    first_numbered_item_with_start(text).map(|(_, item)| item)
}

fn first_numbered_item_with_start(text: &str) -> Option<(usize, &str)> {
    let marker_start = ["1.", "1、"]
        .iter()
        .filter_map(|marker| text.find(marker).map(|index| (index, marker.len())))
        .min_by_key(|(index, _)| *index)?;
    let start = marker_start.0 + marker_start.1;
    let rest = &text[start..];
    let end = ["\n2.", "\n2、", " 2.", " 2、"]
        .iter()
        .filter_map(|marker| rest.find(marker))
        .min()
        .unwrap_or(rest.len());
    Some((marker_start.0, &rest[..end]))
}

fn first_numbered_item_question(text: &str) -> Option<String> {
    let (numbered_start, numbered) = first_numbered_item_with_start(text)?;
    let first_question_end = ['？', '?']
        .iter()
        .filter_map(|marker| text.find(*marker))
        .min()?;
    (numbered_start < first_question_end).then(|| clean_clarification_text(numbered))
}

fn clean_clarification_text(raw: &str) -> String {
    raw.replace("**", "")
        .replace("——", "-")
        .replace("--", "-")
        .trim_matches(|ch: char| ch.is_whitespace() || ch == '-' || ch == ':' || ch == '：')
        .trim()
        .to_string()
}

fn fail_turn(session_id: &str, turn_id: &str, message: String) {
    let mut should_emit = false;
    let snapshot = with_session_snapshot(session_id, |session| {
        if session.snapshot.active_turn_id.as_deref() != Some(turn_id) {
            return session.snapshot.clone();
        }
        should_emit = true;
        let tools = session.snapshot.tools.clone();
        bind_pending_rollback_anchors(session_id);
        let mut snapshot = persisted_snapshot(session_id, TurnStatus::Failed, None, Some(tools))
            .unwrap_or_else(|_| {
                session.snapshot.turn_status = TurnStatus::Failed;
                session.snapshot.active_turn_id = None;
                session.snapshot.follow = AgentFollowState {
                    running: false,
                    activity: None,
                };
                session.snapshot.updated_at = Utc::now();
                session.snapshot.clone()
            });
        snapshot.follow = AgentFollowState {
            running: false,
            activity: None,
        };
        session.snapshot = snapshot.clone();
        session.shutdown_signal = None;
        snapshot
    });
    if !should_emit {
        return;
    }
    if let Ok(store) = agent_memory_store() {
        let _ = store.update_session_status(session_id, MemorySessionStatus::Failed);
        let _ = store.append_event(
            session_id,
            NewSessionEvent::runtime_event(
                "turn_failed",
                Some(turn_id.to_string()),
                json!({ "message": message.clone() }),
            ),
        );
    }
    transition_memory_turn(
        session_id,
        turn_id,
        RuntimeTurnState::FailedRecoverable,
        "turn_failed",
    );
    cancel_pending_clarifications_for_session(session_id);
    if let Ok(snapshot) = snapshot {
        emit_event(AgentRuntimeEvent::SessionSnapshot { snapshot });
    }
    emit_event(AgentRuntimeEvent::TurnFailed {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        message,
    });
}

fn persisted_snapshot(
    session_id: &str,
    turn_status: TurnStatus,
    active_turn_id: Option<String>,
    tools: Option<Vec<ToolActivity>>,
) -> Result<AgentSessionSnapshot, AgentError> {
    let session = jcode_session_for_memory_session(session_id)?;
    Ok(snapshot_from_jcode_session(
        &session,
        turn_status,
        active_turn_id,
        AgentFollowState {
            running: false,
            activity: None,
        },
        tools.unwrap_or_default(),
    ))
}

fn bind_pending_rollback_anchors(session_id: &str) {
    if let Ok(session) = jcode_session_for_memory_session(session_id) {
        let _ = rollback::bind_pending_anchors(&session);
    }
}

fn snapshot_from_jcode_session(
    session: &Session,
    turn_status: TurnStatus,
    active_turn_id: Option<String>,
    follow: AgentFollowState,
    live_tools: Vec<ToolActivity>,
) -> AgentSessionSnapshot {
    let working_dir = session_working_dir(session);
    AgentSessionSnapshot {
        id: session.id.clone(),
        title: session.display_title_or_name().to_string(),
        session_kind: session_kind(session),
        project_bound: is_project_bound(&working_dir),
        working_dir,
        messages: session
            .messages
            .iter()
            .filter(|message| is_visible_chat_message(message))
            .map(|message| agent_message_from_jcode_message(&session.id, message))
            .collect(),
        tools: tools_from_jcode_session(session, live_tools),
        todos: agent_todos_for_session(&session.id),
        automation: AgentSessionAutomationSnapshot {
            subagent_model: session.subagent_model.clone(),
            autoreview_enabled: session.autoreview_enabled,
            autojudge_enabled: session.autojudge_enabled,
        },
        side_panel: side_panel_snapshot_for_session(&session.id),
        turn_status,
        active_turn_id,
        follow,
        updated_at: session.updated_at,
        memory: memory_snapshot_for_session(&session.id),
    }
}

fn agent_todos_for_session(session_id: &str) -> Vec<AgentTodoItem> {
    todo_items_for_session(session_id)
        .unwrap_or_default()
        .into_iter()
        .map(AgentTodoItem::from)
        .collect()
}

fn emit_todo_updated(session_id: &str) {
    let todos = agent_todos_for_session(session_id);
    let active_turn_id = RUNTIME.lock().ok().and_then(|runtime| {
        runtime
            .sessions
            .get(session_id)
            .and_then(|session| session.snapshot.active_turn_id.clone())
    });
    if let Ok(mut runtime) = RUNTIME.lock() {
        if let Some(session) = runtime.sessions.get_mut(session_id) {
            session.snapshot.todos = todos.clone();
        }
    }
    if let Some(turn_id) = active_turn_id.as_deref()
        && let Ok(store) = agent_memory_store()
    {
        let values = todos
            .iter()
            .filter_map(|todo| serde_json::to_value(todo).ok())
            .collect::<Vec<_>>();
        let _ = store.record_active_todos(session_id, turn_id, &values);
    }
    emit_event(AgentRuntimeEvent::TodoUpdated {
        session_id: session_id.to_string(),
        todos,
    });
}

fn agent_message_from_jcode_message(
    session_id: &str,
    message: &crate::session::StoredMessage,
) -> AgentMessage {
    let role = match message.role {
        Role::Assistant => AgentRole::Assistant,
        Role::User => AgentRole::User,
    };
    AgentMessage {
        id: message.id.clone(),
        role,
        text: message_content_text(message),
        blocks: message_blocks_from_jcode_message(message),
        created_at: message.timestamp.unwrap_or_else(Utc::now),
        rollback: rollback_info_for_message(session_id, message),
    }
}

fn message_blocks_from_jcode_message(
    message: &crate::session::StoredMessage,
) -> Vec<AgentMessageBlock> {
    let mut blocks = Vec::new();
    let mut seen_tools = std::collections::HashSet::new();
    let mut text_index = 0usize;
    for block in &message.content {
        match block {
            ContentBlock::Text { text, .. } => {
                if text.trim().is_empty() {
                    continue;
                }
                blocks.push(AgentMessageBlock::Text {
                    id: format!("text-{text_index}"),
                    text: text.clone(),
                });
                text_index += 1;
            }
            ContentBlock::Image { media_type, data } => {
                blocks.push(AgentMessageBlock::Image {
                    id: format!("image-{text_index}"),
                    media_type: media_type.clone(),
                    data: data.clone(),
                    label: None,
                    source: None,
                    width: None,
                    height: None,
                });
                text_index += 1;
            }
            ContentBlock::ToolUse { id, .. } => {
                if seen_tools.insert(id.clone()) {
                    blocks.push(AgentMessageBlock::Tool {
                        id: format!("tool-{id}"),
                        tool_id: id.clone(),
                    });
                }
            }
            ContentBlock::ToolResult { tool_use_id, .. } => {
                if seen_tools.insert(tool_use_id.clone()) {
                    blocks.push(AgentMessageBlock::Tool {
                        id: format!("tool-{tool_use_id}"),
                        tool_id: tool_use_id.clone(),
                    });
                }
            }
            ContentBlock::Reasoning { .. } => {}
            ContentBlock::OpenAICompaction { .. } => {}
        }
    }
    blocks
}

fn rollback_info_for_message(
    session_id: &str,
    message: &crate::session::StoredMessage,
) -> Option<AgentMessageRollback> {
    if message.role != Role::User {
        return None;
    }
    match rollback::anchor_for_message(session_id, &message.id) {
        Ok(Some(anchor)) => Some(AgentMessageRollback {
            available: true,
            anchor_id: Some(anchor.id),
            checkpoint_at: Some(anchor.checkpoint_at),
            unavailable_reason: None,
        }),
        _ => None,
    }
}

fn is_internal_system_message(message: &crate::session::StoredMessage) -> bool {
    message.display_role.is_some()
}

fn is_visible_chat_message(message: &crate::session::StoredMessage) -> bool {
    message.display_role.is_none()
        && !is_internal_system_message(message)
        && (!message_content_text(message).trim().is_empty()
            || (message.role == Role::Assistant
                && message
                    .content
                    .iter()
                    .any(|block| matches!(block, ContentBlock::ToolUse { .. }))))
}

fn message_content_text(message: &crate::session::StoredMessage) -> String {
    message
        .content
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text { text, .. } => Some(text.clone()),
            ContentBlock::Image { .. } => Some("[image]".to_string()),
            ContentBlock::Reasoning { .. }
            | ContentBlock::ToolUse { .. }
            | ContentBlock::ToolResult { .. }
            | ContentBlock::OpenAICompaction { .. } => None,
        })
        .filter(|text| !text.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn tools_from_jcode_session(session: &Session, live_tools: Vec<ToolActivity>) -> Vec<ToolActivity> {
    let mut order: Vec<String> = Vec::new();
    let mut tools_by_id: HashMap<String, ToolActivity> = HashMap::new();

    for message in &session.messages {
        let timestamp = message.timestamp.unwrap_or(session.updated_at);
        for block in &message.content {
            match block {
                ContentBlock::ToolUse { id, name, input } => {
                    if !tools_by_id.contains_key(id) {
                        order.push(id.clone());
                    }
                    let tool = tools_by_id
                        .entry(id.clone())
                        .or_insert_with(|| ToolActivity {
                            id: id.clone(),
                            name: name.clone(),
                            label: live_tool_label(name),
                            status: ToolActivityStatus::Running,
                            input: input.clone(),
                            output: None,
                            started_at: timestamp,
                            finished_at: None,
                        });
                    tool.name = name.clone();
                    tool.input = input.clone();
                    tool.started_at = timestamp;
                    tool.label = tool_label_for_status(&tool.name, &tool.status);
                }
                ContentBlock::ToolResult {
                    tool_use_id,
                    content,
                    is_error,
                } => {
                    if !tools_by_id.contains_key(tool_use_id) {
                        order.push(tool_use_id.clone());
                    }
                    let failed = is_error.unwrap_or(false);

                    let mut screenshot = None;
                    for other_block in &message.content {
                        if let ContentBlock::Image { media_type, data } = other_block {
                            screenshot = Some(json!({
                                "mediaType": media_type,
                                "data": data,
                            }));
                            break;
                        }
                    }

                    let tool =
                        tools_by_id
                            .entry(tool_use_id.clone())
                            .or_insert_with(|| ToolActivity {
                                id: tool_use_id.clone(),
                                name: "tool".to_string(),
                                label: finished_tool_label("tool", failed),
                                status: if failed {
                                    ToolActivityStatus::Failed
                                } else {
                                    ToolActivityStatus::Completed
                                },
                                input: Value::Object(serde_json::Map::new()),
                                output: None,
                                started_at: timestamp,
                                finished_at: Some(timestamp),
                            });
                    tool.status = if failed {
                        ToolActivityStatus::Failed
                    } else {
                        ToolActivityStatus::Completed
                    };
                    tool.label = finished_tool_label(&tool.name, failed);
                    tool.output = Some(json!({
                        "content": content,
                        "error": if failed { Value::String(content.clone()) } else { Value::Null },
                        "screenshot": screenshot,
                    }));
                    tool.finished_at = Some(timestamp);
                }
                _ => {}
            }
        }
    }

    for live_tool in live_tools {
        if tools_by_id.contains_key(&live_tool.id) {
            let id = live_tool.id.clone();
            if let Some(existing) = tools_by_id.get_mut(&id) {
                *existing = merge_live_tool_activity(existing.clone(), live_tool);
            }
        } else {
            order.push(live_tool.id.clone());
            tools_by_id.insert(live_tool.id.clone(), live_tool);
        }
    }

    order
        .into_iter()
        .filter_map(|id| tools_by_id.remove(&id))
        .collect()
}

fn tool_label_for_status(name: &str, status: &ToolActivityStatus) -> String {
    match status {
        ToolActivityStatus::Running => live_tool_label(name),
        ToolActivityStatus::Completed => finished_tool_label(name, false),
        ToolActivityStatus::Failed => finished_tool_label(name, true),
        ToolActivityStatus::Cancelled => "Cancelled".to_string(),
    }
}

fn merge_live_tool_activity(persisted: ToolActivity, live: ToolActivity) -> ToolActivity {
    let empty_object = Value::Object(serde_json::Map::new());
    ToolActivity {
        id: live.id,
        name: live.name,
        label: live.label,
        status: live.status,
        input: if live.input == empty_object && persisted.input != empty_object {
            persisted.input
        } else {
            live.input
        },
        output: live.output.or(persisted.output),
        started_at: persisted.started_at,
        finished_at: live.finished_at.or(persisted.finished_at),
    }
}

const GUI_HANDLED_OR_DEPRECATED_COMMANDS: &[&str] = &[
    "/help",
    "/model",
    "/refresh-model-list",
    "/agents",
    "/effort",
    "/fast",
    "/alignment",
    "/config",
    "/observe",
    "/todos",
    "/git",
    "/splitview",
    "/version",
    "/resume",
    "/clear",
    "/rewind",
    "/save",
    "/unsave",
    "/rename",
    "/improve",
    "/refactor",
    "/poke",
    "/review",
    "/judge",
    "/subagent",
    "/subagent-model",
    "/autoreview",
    "/autojudge",
    "/btw",
    "/compact",
    "/split",
    "/transfer",
    "/goals",
    "/auth",
    "/login",
    "/account",
    "/selfdev",
    "/overnight",
];

fn gui_visible_jcode_commands() -> Vec<JcodeRegisteredCommand> {
    registered_commands_from_vendored_tui()
        .into_iter()
        .filter(|command| !GUI_HANDLED_OR_DEPRECATED_COMMANDS.contains(&command.name.as_str()))
        .collect()
}

fn resolve_agent_session_id(session_id: Option<String>) -> Result<String, AgentError> {
    if let Some(session_id) = session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
    {
        ensure_loaded_session(&session_id)?;
        let mut runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
        runtime.active_session_id = Some(session_id.clone());
        return Ok(session_id);
    }

    let mut runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
    ensure_session(&mut runtime)
}

fn resolve_feedback_target_session_id(session_id: &str) -> String {
    let mut current_id = session_id.to_string();

    for _ in 0..16 {
        let Ok(session) = jcode_session_for_memory_session(&current_id) else {
            break;
        };

        if !is_analysis_feedback_session_title(session.title.as_deref()) {
            return current_id;
        }

        let Some(parent_id) = session.parent_id.clone() else {
            return current_id;
        };

        if parent_id == current_id {
            return current_id;
        }

        current_id = parent_id;
    }

    current_id
}

fn is_analysis_feedback_session_title(title: Option<&str>) -> bool {
    matches!(title, Some("review" | "autoreview" | "judge" | "autojudge"))
}

fn create_feedback_child_session(
    parent_session_id: &str,
    kind: JcodeFeedbackActionKind,
) -> Result<String, AgentError> {
    let parent = jcode_session_for_memory_session(parent_session_id)?;
    let title = match kind {
        JcodeFeedbackActionKind::Review => "review",
        JcodeFeedbackActionKind::Judge => "judge",
    };
    let mut child = Session::create(Some(parent_session_id.to_string()), Some(title.to_string()));
    child.replace_messages(parent.messages.clone());
    child.compaction = parent.compaction.clone();
    child.working_dir = parent.working_dir.clone();
    child.model = feedback_model_override(kind).or(parent.model.clone());
    child.provider_key = parent.provider_key.clone();
    child.subagent_model = parent.subagent_model.clone();
    child.autoreview_enabled = Some(false);
    child.autojudge_enabled = Some(false);
    persist_jcode_session_adapter(&child)?;
    Ok(child.id)
}

fn feedback_model_override(kind: JcodeFeedbackActionKind) -> Option<String> {
    let config = crate::config::config();
    match kind {
        JcodeFeedbackActionKind::Review => config.autoreview.model.clone(),
        JcodeFeedbackActionKind::Judge => config.autojudge.model.clone(),
    }
}

fn reject_running_action(session_id: &str, action: &str) -> Result<(), AgentError> {
    if is_session_running(session_id)? {
        return Err(AgentError::BadRequest(format!(
            "cannot start {action} while the agent is running"
        )));
    }
    Ok(())
}

fn persist_session_improve_mode(
    session_id: &str,
    mode: crate::session::SessionImproveMode,
) -> Result<(), AgentError> {
    let store = agent_memory_store()?;
    let mode_value =
        serde_json::to_value(mode).map_err(|error| AgentError::Serialization(error.to_string()))?;
    store
        .record_pinned_state(
            session_id,
            "session_improve_mode",
            json!({ "improveMode": mode_value }),
            None,
            Vec::new(),
        )
        .map_err(|error| AgentError::Provider(format!("agent memory improve mode failed: {error}")))
}

fn agent_for_session(session_id: &str) -> Result<Arc<tokio::sync::Mutex<Agent>>, AgentError> {
    ensure_loaded_session(session_id)?;
    let runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
    runtime
        .sessions
        .get(session_id)
        .map(|session| session.agent.clone())
        .ok_or_else(|| AgentError::SessionNotFound(session_id.to_string()))
}

fn jcode_models_for_session(session_id: &str) -> Result<JcodeModelsListResponse, AgentError> {
    let agent = agent_for_session(session_id)?;
    let config = crate::config::Config::load();
    block_on(async {
        let guard = agent.lock().await;
        let provider = guard.provider_handle();
        let routes = guard.model_routes();
        let route_snapshots = routes
            .iter()
            .map(|route| JcodeModelRouteSnapshot {
                model: route.model.clone(),
                provider: route.provider.clone(),
                api_method: route.api_method.clone(),
                available: route.available,
                detail: route.detail.clone(),
            })
            .collect::<Vec<_>>();
        let models = model_entries_for_routes(&routes, &config);
        let reasoning_options = provider
            .available_efforts()
            .into_iter()
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        let service_tier_options = provider
            .available_service_tiers()
            .into_iter()
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        Ok::<_, AgentError>(JcodeModelsListResponse {
            session_id: Some(session_id.to_string()),
            current_model: guard.provider_model(),
            current_provider: guard.provider_name(),
            default_model: config.provider.default_model.clone(),
            default_provider: config.provider.default_provider.clone(),
            models,
            routes: route_snapshots,
            reasoning_effort: JcodeProviderOptionState {
                current: provider.reasoning_effort(),
                supported: !reasoning_options.is_empty(),
                options: reasoning_options,
            },
            service_tier: JcodeProviderOptionState {
                current: provider.service_tier(),
                supported: !service_tier_options.is_empty(),
                options: service_tier_options,
            },
        })
    })?
}

fn model_entries_for_routes(
    routes: &[crate::provider::ModelRoute],
    config: &crate::config::Config,
) -> Vec<JcodeModelEntrySnapshot> {
    let mut entries = Vec::new();
    for route in routes {
        if !route.available {
            continue;
        }
        let id = model_spec_for_route(route, config);
        push_model_entry(
            &mut entries,
            JcodeModelEntrySnapshot {
                id,
                label: model_entry_label(&route.model, Some(&route.provider)),
                model: route.model.clone(),
                provider: Some(route.provider.clone()),
                provider_key: provider_key_for_route(route, config),
                api_method: Some(route.api_method.clone()),
                detail: Some(route.detail.clone()).filter(|detail| !detail.trim().is_empty()),
                available: route.available,
            },
        );
    }
    entries
}

fn push_model_entry(entries: &mut Vec<JcodeModelEntrySnapshot>, entry: JcodeModelEntrySnapshot) {
    if entries.iter().any(|existing| existing.id == entry.id) {
        return;
    }
    entries.push(entry);
}

fn model_entry_label(model: &str, provider: Option<&str>) -> String {
    provider
        .map(str::trim)
        .filter(|provider| !provider.is_empty() && *provider != "auto")
        .map(|provider| format!("{model} · {provider}"))
        .unwrap_or_else(|| model.to_string())
}

fn model_spec_for_route(
    route: &crate::provider::ModelRoute,
    config: &crate::config::Config,
) -> String {
    let model = route.model.trim();
    match route.api_method.as_str() {
        "copilot" => format!("copilot:{model}"),
        "cursor" => format!("cursor:{model}"),
        "bedrock" => format!("bedrock:{model}"),
        "openrouter" if route.provider != "auto" => {
            let model = crate::provider::openrouter_catalog_model_id(model)
                .unwrap_or_else(|| model.to_string());
            format!("{model}@{}", route.provider)
        }
        _ if route.provider == "Antigravity" => format!("antigravity:{model}"),
        _ if named_provider_profile_key_for_route(route, config).is_some() => model.to_string(),
        _ => openai_compatible_profile_id_for_route(route, config)
            .map(|profile| format!("{profile}:{model}"))
            .unwrap_or_else(|| model.to_string()),
    }
}

fn openai_compatible_profile_id_for_route(
    route: &crate::provider::ModelRoute,
    config: &crate::config::Config,
) -> Option<String> {
    if let Some(("openai-compatible", profile_id)) = route.api_method.split_once(':') {
        let profile_id = profile_id.trim();
        if !profile_id.is_empty() {
            return Some(profile_id.to_string());
        }
    }
    if route.api_method == "openai-compatible" {
        if config.providers.contains_key(route.provider.trim()) {
            return Some(route.provider.trim().to_string());
        }
        if let Some(profile) = named_provider_profile_key_for_route(route, config) {
            return Some(profile);
        }
        return crate::provider_catalog::openai_compatible_profile_id_for_display_name(
            &route.provider,
        )
        .map(ToOwned::to_owned);
    }
    None
}

fn provider_key_for_route(
    route: &crate::provider::ModelRoute,
    config: &crate::config::Config,
) -> Option<String> {
    match route.api_method.as_str() {
        "copilot" | "cursor" | "bedrock" | "openrouter" => Some(route.api_method.clone()),
        "openai" | "anthropic" | "gemini" => Some(route.api_method.clone()),
        _ if route.provider == "Antigravity" => Some("antigravity".to_string()),
        _ => named_provider_profile_key_for_route(route, config)
            .or_else(|| openai_compatible_profile_id_for_route(route, config)),
    }
}

fn named_provider_profile_key_for_route(
    route: &crate::provider::ModelRoute,
    config: &crate::config::Config,
) -> Option<String> {
    if !route.api_method.starts_with("openai-compatible") {
        return None;
    }

    if let Some(default_provider) = config
        .provider
        .default_provider
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        && let Some(profile) = config.providers.get(default_provider)
        && named_provider_profile_matches_route(route, profile)
    {
        return Some(default_provider.to_string());
    }

    config.providers.iter().find_map(|(profile_name, profile)| {
        named_provider_profile_matches_route(route, profile).then(|| profile_name.clone())
    })
}

fn named_provider_profile_matches_route(
    route: &crate::provider::ModelRoute,
    profile: &crate::config::NamedProviderConfig,
) -> bool {
    let route_api_base = route.detail.trim().trim_end_matches('/');
    let profile_api_base = profile.base_url.trim().trim_end_matches('/');
    if route_api_base.is_empty()
        || profile_api_base.is_empty()
        || route_api_base != profile_api_base
    {
        return false;
    }

    let route_model = route.model.trim();
    profile
        .default_model
        .as_deref()
        .map(str::trim)
        .is_some_and(|model| model == route_model)
        || profile
            .models
            .iter()
            .any(|model| model.id.trim() == route_model)
        || profile.models.is_empty()
}

fn persist_session_provider_state(
    session_id: &str,
    model: Option<&str>,
    provider_key: Option<&str>,
    reasoning_effort: Option<&str>,
) -> Result<(), AgentError> {
    let store = agent_memory_store()?;
    let record = store
        .read_session(session_id)
        .map_err(|error| {
            AgentError::Provider(format!("agent memory session read failed: {error}"))
        })?
        .ok_or_else(|| AgentError::SessionNotFound(session_id.to_string()))?;
    store
        .update_session_model_snapshot(
            session_id,
            record.working_dir.as_deref(),
            provider_key.or(record.provider_key.as_deref()),
            model.or(record.model.as_deref()),
        )
        .map_err(|error| {
            AgentError::Provider(format!("agent memory provider state failed: {error}"))
        })?;
    if let Some(reasoning_effort) = reasoning_effort {
        store
            .record_pinned_state(
                session_id,
                "provider_options",
                json!({ "reasoningEffort": provider_option_config_value(reasoning_effort) }),
                None,
                Vec::new(),
            )
            .map_err(|error| {
                AgentError::Provider(format!("agent memory provider options failed: {error}"))
            })?;
    }
    Ok(())
}

fn persist_default_model(model: &str, provider: Option<&str>) -> Result<(), AgentError> {
    match provider {
        Some(provider) => crate::config::Config::set_default_model(Some(model), Some(provider)),
        None => crate::config::Config::set_default_model_only(Some(model)),
    }
    .map_err(|error| AgentError::Provider(error.to_string()))
}

fn apply_default_provider_runtime_env(config: &crate::config::Config) {
    let Some(default_provider) = config
        .provider
        .default_provider
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        crate::provider_catalog::force_apply_openai_compatible_profile_env(None);
        return;
    };

    if let Some(profile) =
        crate::provider_catalog::resolve_openai_compatible_profile_selection(default_provider)
    {
        crate::provider_catalog::force_apply_openai_compatible_profile_env(Some(profile));
        return;
    }

    if config.providers.contains_key(default_provider) {
        match crate::provider_catalog::apply_named_provider_profile_env_from_config(
            default_provider,
            config,
        ) {
            Ok(profile_name) => {
                crate::env::set_var("JCODE_PROVIDER_PROFILE_NAME", &profile_name);
                crate::env::set_var("JCODE_PROVIDER_PROFILE_ACTIVE", "1");
            }
            Err(error) => crate::logging::warn(&format!(
                "Failed to apply default provider profile '{}': {}",
                default_provider, error
            )),
        }
        return;
    }

    crate::provider_catalog::force_apply_openai_compatible_profile_env(None);
}

fn provider_option_config_value(raw: &str) -> Option<String> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "" | "none" | "off" | "auto" | "default" => None,
        _ => Some(raw.trim().to_string()),
    }
}

fn normalized_nonempty(raw: Option<&str>) -> Option<String> {
    raw.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn normalize_optional_owned(raw: Option<String>) -> Option<String> {
    raw.as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn optional_string(value: &Value) -> Option<String> {
    if value.is_null() {
        return None;
    }
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn sanitize_profile_name(raw: &str) -> Result<String, AgentError> {
    let profile_name = raw.trim();
    if profile_name.is_empty() {
        return Err(AgentError::BadRequest(
            "provider profile name is required".to_string(),
        ));
    }
    if !profile_name
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
    {
        return Err(AgentError::BadRequest(
            "provider profile name may only contain letters, numbers, '-' and '_'".to_string(),
        ));
    }
    Ok(profile_name.to_string())
}

fn default_env_key_for_profile(profile_name: &str) -> String {
    let mut key = profile_name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect::<String>();
    if key.is_empty() {
        key = "CUSTOM".to_string();
    }
    format!("LYRA_AGENT_{}_API_KEY", key)
}

fn default_env_file_for_profile(profile_name: &str) -> String {
    let file = profile_name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    format!("{file}.env")
}

fn parse_named_provider_type(
    raw: Option<&str>,
) -> Result<crate::config::NamedProviderType, AgentError> {
    match raw
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("openai-compatible")
    {
        "openrouter" => Ok(crate::config::NamedProviderType::OpenRouter),
        "openai-compatible" | "openai_compatible" => {
            Ok(crate::config::NamedProviderType::OpenAiCompatible)
        }
        other => Err(AgentError::BadRequest(format!(
            "unsupported Lyra Agent provider type: {other}"
        ))),
    }
}

fn parse_named_provider_auth(
    raw: Option<&str>,
) -> Result<crate::config::NamedProviderAuth, AgentError> {
    match raw
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("bearer")
    {
        "bearer" => Ok(crate::config::NamedProviderAuth::Bearer),
        "header" => Ok(crate::config::NamedProviderAuth::Header),
        "none" => Ok(crate::config::NamedProviderAuth::None),
        other => Err(AgentError::BadRequest(format!(
            "unsupported Lyra Agent provider auth mode: {other}"
        ))),
    }
}

fn with_session(session_id: &str, f: impl FnOnce(&mut AgentSession)) -> Result<(), AgentError> {
    with_session_snapshot(session_id, |session| {
        f(session);
    })
}

fn with_session_snapshot<T>(
    session_id: &str,
    f: impl FnOnce(&mut AgentSession) -> T,
) -> Result<T, AgentError> {
    let mut runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
    let session = runtime
        .sessions
        .get_mut(session_id)
        .ok_or_else(|| AgentError::SessionNotFound(session_id.to_string()))?;
    Ok(f(session))
}

fn is_session_running(session_id: &str) -> Result<bool, AgentError> {
    let runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
    let session = runtime
        .sessions
        .get(session_id)
        .ok_or_else(|| AgentError::SessionNotFound(session_id.to_string()))?;
    Ok(session.snapshot.follow.running || session.shutdown_signal.is_some())
}

fn ensure_session(runtime: &mut AgentRuntime) -> Result<String, AgentError> {
    if let Some(session_id) = runtime.active_session_id.clone() {
        return Ok(session_id);
    }
    let mut session = Session::create(None, Some("Lyra Agent".to_string()));
    let working_dir = default_unbound_working_dir();
    apply_session_working_dir(&mut session, &working_dir);
    session.mark_active();
    persist_jcode_session_adapter(&session)?;
    let snapshot = snapshot_from_jcode_session(
        &session,
        TurnStatus::Idle,
        None,
        AgentFollowState {
            running: false,
            activity: None,
        },
        Vec::new(),
    );
    let agent = build_agent_blocking(session)?;
    let id = snapshot.id.clone();
    runtime.sessions.insert(
        id.clone(),
        AgentSession {
            snapshot,
            agent,
            shutdown_signal: None,
        },
    );
    runtime.active_session_id = Some(id.clone());
    Ok(id)
}

fn ensure_loaded_session(session_id: &str) -> Result<(), AgentError> {
    ensure_loaded_session_with_activation(session_id, true)
}

fn ensure_loaded_session_with_activation(
    session_id: &str,
    make_active: bool,
) -> Result<(), AgentError> {
    {
        let runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
        if runtime.sessions.contains_key(session_id) {
            return Ok(());
        }
    }
    let store = agent_memory_store()?;
    let memory_snapshot = store
        .snapshot(session_id)
        .map_err(|error| AgentError::Provider(format!("agent memory snapshot failed: {error}")))?;
    let record = memory_snapshot
        .session
        .as_ref()
        .ok_or_else(|| AgentError::SessionNotFound(session_id.to_string()))?;
    let snapshot = snapshot_from_agent_memory_snapshot(memory_snapshot.clone());
    let agent = build_agent_blocking(jcode_session_from_agent_memory(
        record,
        Some(&memory_snapshot),
    ))?;
    let mut runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
    if make_active {
        runtime.active_session_id = Some(session_id.to_string());
    }
    runtime.sessions.insert(
        session_id.to_string(),
        AgentSession {
            snapshot,
            agent,
            shutdown_signal: None,
        },
    );
    Ok(())
}

fn build_agent_blocking(session: Session) -> Result<Arc<tokio::sync::Mutex<Agent>>, AgentError> {
    let working_dir = session_working_dir(&session);
    block_on(async move {
        let provider: Arc<dyn Provider> = Arc::new(MultiProvider::new());
        let registry = Registry::new(provider.clone()).await;
        if session_kind(&session) == AgentSessionKind::Selfdev {
            registry.register_selfdev_tools().await;
        }
        let mut agent = Agent::new_with_session(provider, registry, session, None);
        agent.set_working_dir(&working_dir);
        Arc::new(tokio::sync::Mutex::new(agent))
    })
}

fn build_agent_for_session_id(
    session_id: &str,
) -> Result<Arc<tokio::sync::Mutex<Agent>>, AgentError> {
    let store = agent_memory_store()?;
    let memory_snapshot = store
        .snapshot(session_id)
        .map_err(|error| AgentError::Provider(format!("agent memory snapshot failed: {error}")))?;
    let record = memory_snapshot
        .session
        .as_ref()
        .ok_or_else(|| AgentError::SessionNotFound(session_id.to_string()))?;
    build_agent_blocking(jcode_session_from_agent_memory(
        record,
        Some(&memory_snapshot),
    ))
}

fn refresh_runtime_agents_after_provider_config_change() {
    let session_ids = match RUNTIME.lock() {
        Ok(runtime) => runtime
            .sessions
            .iter()
            .filter(|(_, session)| {
                !session.snapshot.follow.running && session.shutdown_signal.is_none()
            })
            .map(|(session_id, _)| session_id.clone())
            .collect::<Vec<_>>(),
        Err(_) => return,
    };

    let mut rebuilt = Vec::new();
    for session_id in session_ids {
        match build_agent_for_session_id(&session_id) {
            Ok(agent) => rebuilt.push((session_id, agent)),
            Err(error) => crate::logging::warn(&format!(
                "Failed to refresh Lyra Agent provider state for session '{}': {}",
                session_id, error
            )),
        }
    }

    if rebuilt.is_empty() {
        return;
    }

    if let Ok(mut runtime) = RUNTIME.lock() {
        for (session_id, agent) in rebuilt {
            if let Some(session) = runtime.sessions.get_mut(&session_id)
                && !session.snapshot.follow.running
                && session.shutdown_signal.is_none()
            {
                session.agent = agent;
            }
        }
    }
}

fn block_on<T>(future: impl std::future::Future<Output = T>) -> Result<T, AgentError> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| AgentError::Provider(error.to_string()))
        .map(|runtime| runtime.block_on(future))
}

fn emit_event(event: AgentRuntimeEvent) {
    let Ok(payload) = serde_json::to_string(&event) else {
        return;
    };
    let callbacks = EVENT_CALLBACK.get_or_init(|| Mutex::new(None));
    let callback = callbacks.lock().ok().and_then(|slot| slot.clone());
    if let Some(callback) = callback {
        callback(payload);
    }
}

fn parse_request<T: for<'de> Deserialize<'de>>(payload: &str) -> Result<T, AgentError> {
    serde_json::from_str(payload).map_err(|error| AgentError::BadRequest(error.to_string()))
}

fn encode<T: Serialize>(value: &T) -> Result<String, AgentError> {
    serde_json::to_string(value).map_err(|error| AgentError::Serialization(error.to_string()))
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    struct RuntimeTestEnv {
        _lock: std::sync::MutexGuard<'static, ()>,
        _home: tempfile::TempDir,
        previous_env: Vec<(OsString, Option<OsString>)>,
    }

    impl RuntimeTestEnv {
        fn new() -> Self {
            let lock = crate::storage::lock_test_env();
            let home = tempfile::tempdir().expect("temp jcode home");
            let runtime_dir = home.path().join("runtime");
            let mut keys = std::env::vars_os()
                .filter_map(|(key, _)| key.to_string_lossy().starts_with("JCODE_").then_some(key))
                .collect::<Vec<_>>();
            keys.extend(std::env::vars_os().filter_map(|(key, _)| {
                key.to_string_lossy()
                    .starts_with("LYRA_AGENT_")
                    .then_some(key)
            }));
            keys.push(OsString::from("OPENAI_API_KEY"));
            keys.sort();
            keys.dedup();
            let previous_env = keys
                .iter()
                .map(|key| (key.clone(), std::env::var_os(key)))
                .collect::<Vec<_>>();
            for key in &keys {
                crate::env::remove_var(key);
            }
            crate::env::set_var("JCODE_HOME", home.path());
            crate::env::set_var("JCODE_RUNTIME_DIR", &runtime_dir);
            crate::env::set_var("LYRA_AGENT_HOME", home.path());
            crate::env::set_var("LYRA_AGENT_RUNTIME_DIR", &runtime_dir);
            crate::env::set_var("JCODE_TEST_SESSION", "1");
            reset_runtime_for_tests();
            Self {
                _lock: lock,
                _home: home,
                previous_env,
            }
        }

        fn use_openai(&self) {
            crate::env::set_var("OPENAI_API_KEY", "sk-test-lyra-agent-core");
            crate::env::set_var("JCODE_FORCE_PROVIDER", "1");
            crate::env::set_var("JCODE_ACTIVE_PROVIDER", "openai");
            crate::config::Config::set_default_model(Some("gpt-5.5"), Some("openai"))
                .expect("set default openai model");
        }
    }

    impl Drop for RuntimeTestEnv {
        fn drop(&mut self) {
            reset_runtime_for_tests();
            for (key, value) in &self.previous_env {
                if let Some(value) = value {
                    crate::env::set_var(key, value);
                } else {
                    crate::env::remove_var(key);
                }
            }
            crate::config::Config::invalidate_cache();
        }
    }

    fn reset_runtime_for_tests() {
        clear_rust_event_callback();
        if let Ok(mut runtime) = RUNTIME.lock() {
            *runtime = AgentRuntime::default();
        }
        if let Ok(mut pending) = PENDING_CLARIFICATIONS.lock() {
            pending.clear();
        }
        if let Ok(mut pending) = PENDING_PERMISSIONS.lock() {
            pending.clear();
        }
        crate::config::Config::invalidate_cache();
    }

    #[test]
    fn agent_message_tool_block_serializes_camel_case_tool_id() {
        let block = AgentMessageBlock::Tool {
            id: "tool-call-1".to_string(),
            tool_id: "call_1".to_string(),
        };
        let value = serde_json::to_value(block).expect("serialize tool block");
        assert_eq!(
            value,
            json!({
                "type": "tool",
                "id": "tool-call-1",
                "toolId": "call_1"
            })
        );
        assert!(value.get("tool_id").is_none());

        let legacy: AgentMessageBlock = serde_json::from_value(json!({
            "type": "tool",
            "id": "tool-call-legacy",
            "tool_id": "call_legacy"
        }))
        .expect("deserialize legacy tool block");
        match legacy {
            AgentMessageBlock::Tool { id, tool_id } => {
                assert_eq!(id, "tool-call-legacy");
                assert_eq!(tool_id, "call_legacy");
            }
            AgentMessageBlock::Text { .. } | AgentMessageBlock::Image { .. } => {
                panic!("expected tool block")
            }
        }
    }

    #[test]
    fn clarification_normalization_collapses_to_first_question() {
        let text = "你想做一个什么类型的官网？请告诉我以下信息：\n\
1. **网站主题/公司名称** -- 这个官网是给什么产品做的？\n\
2. **主要内容板块** -- 需要哪些页面或模块？\n\
3. **风格偏好** -- 有没有喜欢的设计风格？";

        let clarification =
            normalize_clarification_request(text.to_string(), Vec::new(), true, None);

        assert_eq!(clarification.question, "你想做一个什么类型的官网？");
        assert!(clarification.options.is_empty());
        assert!(clarification.detail.is_none());
    }

    #[test]
    fn clarification_normalization_keeps_explicit_inline_choices() {
        let text = "你想做什么类型的官网？请提供一些信息，比如：\n\
1. 企业官网/个人作品集/产品官网/博客？\n\
2. 主要功能或页面？\n\
3. 设计风格偏好？";

        let clarification =
            normalize_clarification_request(text.to_string(), Vec::new(), true, None);

        assert_eq!(clarification.question, "你想做什么类型的官网？");
        let labels = clarification
            .options
            .iter()
            .map(|option| option.label.as_str())
            .collect::<Vec<_>>();
        assert_eq!(labels, vec!["企业官网", "个人作品集", "产品官网", "博客"]);
    }

    #[test]
    fn clarification_normalization_prefers_first_numbered_question_after_intro() {
        let text = "好的，制作一个公司/产品介绍官网！在开始之前，我需要了解几个关键信息：\n\n\
**1. 公司/产品名称是什么？**\n\n\
**2. 主要业务/产品是什么？**\n\n\
**3. 有什么特别想要展示的内容？**\n\n\
**4. 有偏好的颜色风格或设计参考吗？**";

        let clarification =
            normalize_clarification_request(text.to_string(), Vec::new(), true, None);

        assert_eq!(clarification.question, "公司/产品名称是什么？");
        assert!(clarification.options.is_empty());
    }

    #[test]
    fn clarification_normalization_does_not_invent_keyword_options() {
        let normalized = normalize_clarification_request(
            "你想做什么类型的官网？".to_string(),
            Vec::new(),
            true,
            None,
        );

        assert_eq!(normalized.question, "你想做什么类型的官网？");
        assert!(normalized.options.is_empty());
    }

    #[test]
    fn clarification_normalization_keeps_single_followup_question() {
        let normalized = normalize_clarification_request(
            "我已经完成了初稿。你要我继续吗？".to_string(),
            Vec::new(),
            true,
            None,
        );
        assert_eq!(normalized.question, "我已经完成了初稿。你要我继续吗？");
    }

    #[test]
    fn assistant_plain_text_multi_question_remains_message_after_turn_finish() {
        let _env = RuntimeTestEnv::new();
        let created =
            create_session_json(r#"{"title":"Plain Clarification"}"#.to_string()).expect("create");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");
        let text = "好的，制作一个公司/产品介绍官网！在开始之前，我需要了解几个关键信息：\n\n\
**1. 公司/产品名称是什么？**\n\n\
**2. 主要业务/产品是什么？**";

        let mut persisted = Session::load(&snapshot.id).expect("load session");
        let message_id = persisted.add_message(
            Role::Assistant,
            vec![ContentBlock::Text {
                text: text.to_string(),
                cache_control: None,
            }],
        );
        persisted.save().expect("save assistant message");
        let turn_id = "turn-plain-question";
        {
            let mut runtime = RUNTIME.lock().expect("runtime lock");
            let session = runtime
                .sessions
                .get_mut(&snapshot.id)
                .expect("runtime session");
            session.snapshot.turn_status = TurnStatus::Running;
            session.snapshot.active_turn_id = Some(turn_id.to_string());
        }

        let events = Arc::new(Mutex::new(Vec::<String>::new()));
        let events_for_callback = Arc::clone(&events);
        register_rust_event_callback(Arc::new(move |event| {
            events_for_callback.lock().expect("events").push(event);
        }));

        finish_turn(&snapshot.id, turn_id, TurnStatus::Finished);

        let runtime_snapshot =
            with_session_snapshot(&snapshot.id, |session| session.snapshot.clone())
                .expect("runtime snapshot");
        let assistant_message = runtime_snapshot
            .messages
            .iter()
            .find(|message| message.id == message_id)
            .expect("assistant question remains visible");
        assert_eq!(assistant_message.text, text);

        let captured = events.lock().expect("events").clone();
        assert!(
            captured
                .iter()
                .any(|event| event.contains(r#""kind":"sessionSnapshot""#))
        );
        assert!(
            !captured.iter().any(|event| {
                serde_json::from_str::<Value>(event)
                    .ok()
                    .is_some_and(|value| value["kind"] == "clarificationRequested")
            }),
            "assistant text must not synthesize a clarificationRequested event"
        );
        let pending = PENDING_CLARIFICATIONS.lock().expect("pending");
        assert!(!pending.values().any(|item| item.session_id == snapshot.id));
        clear_rust_event_callback();
    }

    #[test]
    fn migrated_interrupt_signal_flips() {
        let _env = RuntimeTestEnv::new();
        let signal = InterruptSignal::new();
        assert!(!signal.is_set());
        signal.fire();
        assert!(signal.is_set());
        signal.reset();
        assert!(!signal.is_set());
    }

    #[test]
    fn task_switch_cancels_previous_running_turn() {
        let _env = RuntimeTestEnv::new();
        let created =
            create_session_json(r#"{"title":"Task Switch"}"#.to_string()).expect("create");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");
        let old_turn_id = "turn-old-task";
        let signal = InterruptSignal::new();
        {
            let mut runtime = RUNTIME.lock().expect("runtime lock");
            let session = runtime
                .sessions
                .get_mut(&snapshot.id)
                .expect("runtime session");
            session.snapshot.turn_status = TurnStatus::Running;
            session.snapshot.active_turn_id = Some(old_turn_id.to_string());
            session.snapshot.follow = AgentFollowState {
                running: true,
                activity: Some("Editing webpage".to_string()),
            };
            session.snapshot.tools.push(ToolActivity {
                id: "tool-old".to_string(),
                name: "bash".to_string(),
                label: live_tool_label("bash"),
                status: ToolActivityStatus::Running,
                input: json!({ "command": "long old task" }),
                output: None,
                started_at: Utc::now(),
                finished_at: None,
            });
            session.shutdown_signal = Some(signal.clone());
        }

        let events = Arc::new(Mutex::new(Vec::<String>::new()));
        let events_for_callback = Arc::clone(&events);
        register_rust_event_callback(Arc::new(move |event| {
            events_for_callback.lock().expect("events").push(event);
        }));

        assert!(cancel_running_turn_for_task_switch(&snapshot.id).expect("cancel old turn"));
        assert!(signal.is_set());

        let runtime_snapshot =
            with_session_snapshot(&snapshot.id, |session| session.snapshot.clone())
                .expect("runtime snapshot");
        assert_eq!(runtime_snapshot.turn_status, TurnStatus::Cancelled);
        assert_eq!(runtime_snapshot.active_turn_id, None);
        assert!(!runtime_snapshot.follow.running);
        assert_eq!(runtime_snapshot.tools[0].status, ToolActivityStatus::Failed);
        assert_eq!(
            runtime_snapshot.tools[0]
                .output
                .as_ref()
                .and_then(|value| value.get("error")),
            Some(&json!("interrupted by new user request"))
        );
        {
            let runtime = RUNTIME.lock().expect("runtime lock");
            let session = runtime.sessions.get(&snapshot.id).expect("runtime session");
            assert!(session.shutdown_signal.is_none());
        }

        let captured = events.lock().expect("events").clone();
        assert!(captured.iter().any(|event| {
            serde_json::from_str::<Value>(event)
                .ok()
                .is_some_and(|value| {
                    value["kind"] == "turnFinished"
                        && value["turnId"] == old_turn_id
                        && value["status"] == "cancelled"
                })
        }));
        clear_rust_event_callback();
    }

    #[test]
    fn stale_turn_events_do_not_append_after_task_switch() {
        let _env = RuntimeTestEnv::new();
        let created = create_session_json(r#"{"title":"Event Gate"}"#.to_string()).expect("create");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");
        {
            let mut runtime = RUNTIME.lock().expect("runtime lock");
            let session = runtime
                .sessions
                .get_mut(&snapshot.id)
                .expect("runtime session");
            session.snapshot.turn_status = TurnStatus::Running;
            session.snapshot.active_turn_id = Some("turn-new-task".to_string());
            session.snapshot.follow = AgentFollowState {
                running: true,
                activity: Some("New task".to_string()),
            };
        }

        let (tx, rx) = mpsc::unbounded_channel();
        tx.send(ServerEvent::TextDelta {
            text: "old webpage task output".to_string(),
        })
        .expect("send stale event");
        drop(tx);

        block_on(consume_jcode_events(
            snapshot.id.clone(),
            "turn-old-task".to_string(),
            rx,
        ))
        .expect("consume stale events");

        let runtime_snapshot =
            with_session_snapshot(&snapshot.id, |session| session.snapshot.clone())
                .expect("runtime snapshot");
        assert!(!runtime_snapshot.messages.iter().any(|message| {
            message.role == AgentRole::Assistant && message.text.contains("old webpage task")
        }));
    }

    #[test]
    fn session_create_and_read_roundtrip() {
        let _env = RuntimeTestEnv::new();
        let created =
            create_session_json(r#"{"title":"Test Agent"}"#.to_string()).expect("create session");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");
        assert_eq!(snapshot.title, "Test Agent");
        assert_eq!(snapshot.working_dir, default_unbound_working_dir());
        assert!(!snapshot.project_bound);
        assert!(snapshot.todos.is_empty());
        let cwd = std::env::current_dir()
            .expect("current dir")
            .canonicalize()
            .expect("canonical cwd")
            .to_string_lossy()
            .to_string();
        if cwd != default_unbound_working_dir() {
            assert_ne!(snapshot.working_dir, cwd);
        }

        let read = read_session_json(format!(r#"{{"sessionId":"{}"}}"#, snapshot.id))
            .expect("read session");
        let read_snapshot: AgentSessionSnapshot =
            serde_json::from_str(&read).expect("read snapshot");
        assert_eq!(read_snapshot.id, snapshot.id);
        assert_eq!(read_snapshot.working_dir, default_unbound_working_dir());
    }

    #[test]
    fn read_session_recovers_stalled_running_turn() {
        let _env = RuntimeTestEnv::new();
        let created =
            create_session_json(r#"{"title":"Stall Guard"}"#.to_string()).expect("create session");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");
        let turn_id = "turn-stalled";
        {
            let mut runtime = RUNTIME.lock().expect("runtime lock");
            let session = runtime
                .sessions
                .get_mut(&snapshot.id)
                .expect("runtime session");
            let stale_at = Utc::now() - ChronoDuration::seconds(STALLED_TURN_TIMEOUT_SECS + 1);
            session.snapshot.turn_status = TurnStatus::Running;
            session.snapshot.active_turn_id = Some(turn_id.to_string());
            session.snapshot.follow = AgentFollowState {
                running: true,
                activity: Some("Running tool".to_string()),
            };
            session.snapshot.updated_at = stale_at;
            session.snapshot.tools.push(ToolActivity {
                id: "tool-1".to_string(),
                name: "lyra_search".to_string(),
                label: live_tool_label("lyra_search"),
                status: ToolActivityStatus::Running,
                input: json!({ "query": "ChatGPT Image" }),
                output: None,
                started_at: stale_at,
                finished_at: None,
            });
        }

        let read = read_session_json(format!(r#"{{"sessionId":"{}"}}"#, snapshot.id))
            .expect("read session");
        let recovered: AgentSessionSnapshot = serde_json::from_str(&read).expect("snapshot");

        assert_eq!(recovered.turn_status, TurnStatus::Cancelled);
        assert_eq!(recovered.active_turn_id, None);
        assert!(!recovered.follow.running);
        assert_eq!(recovered.tools[0].status, ToolActivityStatus::Failed);
        assert_eq!(
            recovered.tools[0]
                .output
                .as_ref()
                .and_then(|value| value.get("error")),
            Some(&json!("stalled turn recovered"))
        );
    }

    #[test]
    fn session_snapshot_reads_core_todo_storage() {
        let _env = RuntimeTestEnv::new();
        let created =
            create_session_json(r#"{"title":"Todo Snapshot"}"#.to_string()).expect("create");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");
        crate::todo::save_todos(
            &snapshot.id,
            &[crate::todo::TodoItem {
                content: "finish core todo bridge".to_string(),
                status: "completed".to_string(),
                priority: "high".to_string(),
                id: "todo-core-1".to_string(),
                blocked_by: vec!["todo-core-0".to_string()],
                assigned_to: Some("lyra-agent".to_string()),
            }],
        )
        .expect("save todos");

        let read = read_session_json(format!(r#"{{"sessionId":"{}"}}"#, snapshot.id))
            .expect("read session");
        let read_snapshot: AgentSessionSnapshot =
            serde_json::from_str(&read).expect("read snapshot");

        assert_eq!(read_snapshot.todos.len(), 1);
        let todo = &read_snapshot.todos[0];
        assert_eq!(todo.id, "todo-core-1");
        assert_eq!(todo.content, "finish core todo bridge");
        assert_eq!(todo.status, "completed");
        assert_eq!(todo.priority, "high");
        assert_eq!(todo.blocked_by, vec!["todo-core-0".to_string()]);
        assert_eq!(todo.assigned_to.as_deref(), Some("lyra-agent"));
    }

    #[test]
    fn todo_updated_runtime_event_serializes_camel_case() {
        let event = AgentRuntimeEvent::TodoUpdated {
            session_id: "session-1".to_string(),
            todos: vec![AgentTodoItem {
                id: "todo-1".to_string(),
                content: "update panel".to_string(),
                status: "pending".to_string(),
                priority: "medium".to_string(),
                blocked_by: vec!["todo-0".to_string()],
                assigned_to: Some("agent".to_string()),
            }],
        };
        let value = serde_json::to_value(event).expect("serialize event");

        assert_eq!(
            value,
            json!({
                "kind": "todoUpdated",
                "sessionId": "session-1",
                "todos": [{
                    "id": "todo-1",
                    "content": "update panel",
                    "status": "pending",
                    "priority": "medium",
                    "blockedBy": ["todo-0"],
                    "assignedTo": "agent"
                }]
            })
        );
    }

    #[test]
    fn session_create_and_bind_project_persist_working_dir() {
        let _env = RuntimeTestEnv::new();
        let work = tempfile::tempdir().expect("work dir");
        let created =
            create_session_json(r#"{"title":"Unbound Agent"}"#.to_string()).expect("create");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");
        assert_eq!(snapshot.working_dir, default_unbound_working_dir());
        assert!(!snapshot.project_bound);

        let mut session = Session::load(&snapshot.id).expect("load session");
        session.add_message(
            Role::User,
            vec![ContentBlock::Text {
                text: "start work before binding".to_string(),
                cache_control: None,
            }],
        );
        session.save().expect("save user message");

        let work_dir = work
            .path()
            .canonicalize()
            .expect("canonical work dir")
            .to_string_lossy()
            .to_string();
        let bound = bind_project_session_json(
            json!({
                "sessionId": snapshot.id,
                "workingDir": work_dir
            })
            .to_string(),
        )
        .expect("bind project");
        let bound_snapshot: AgentSessionSnapshot =
            serde_json::from_str(&bound).expect("bound snapshot");
        assert_eq!(bound_snapshot.working_dir, work_dir);
        assert!(bound_snapshot.project_bound);
        let persisted = Session::load(&bound_snapshot.id).expect("load bound session");
        assert_eq!(persisted.working_dir.as_deref(), Some(work_dir.as_str()));
        let agent = agent_for_session(&bound_snapshot.id).expect("agent");
        let agent_working_dir = block_on(async {
            let guard = agent.lock().await;
            guard.working_dir().map(ToOwned::to_owned)
        })
        .expect("agent working dir");
        assert_eq!(agent_working_dir.as_deref(), Some(work_dir.as_str()));
    }

    #[test]
    fn bind_project_rejects_rebinding_after_project_is_bound() {
        let _env = RuntimeTestEnv::new();
        let work = tempfile::tempdir().expect("work dir");
        let next_work = tempfile::tempdir().expect("next work dir");
        let work_dir = work
            .path()
            .canonicalize()
            .expect("canonical work dir")
            .to_string_lossy()
            .to_string();
        let next_dir = next_work
            .path()
            .canonicalize()
            .expect("canonical next dir")
            .to_string_lossy()
            .to_string();
        let created = create_session_json(
            json!({
                "title": "Locked Project",
                "workingDir": work_dir
            })
            .to_string(),
        )
        .expect("create bound session");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");
        assert!(snapshot.project_bound);

        let error = bind_project_session_json(
            json!({
                "sessionId": snapshot.id,
                "workingDir": next_dir
            })
            .to_string(),
        )
        .expect_err("rebinding an already-bound project should fail");
        assert!(
            error
                .to_string()
                .contains("cannot change project binding after a project is already bound")
        );
    }

    #[test]
    fn bind_project_rejects_invalid_paths_and_running_sessions() {
        let _env = RuntimeTestEnv::new();
        let created =
            create_session_json(r#"{"title":"Bind Validation"}"#.to_string()).expect("create");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");

        let missing = tempfile::tempdir()
            .expect("temp")
            .path()
            .join("missing")
            .to_string_lossy()
            .to_string();
        let missing_error = bind_project_session_json(
            json!({
                "sessionId": snapshot.id,
                "workingDir": missing
            })
            .to_string(),
        )
        .expect_err("missing dir rejected");
        assert!(matches!(missing_error, AgentError::BadRequest(_)));

        let file_dir = tempfile::tempdir().expect("file dir");
        let file_path = file_dir.path().join("file.txt");
        std::fs::write(&file_path, "not a directory").expect("write file");
        let file_error = bind_project_session_json(
            json!({
                "sessionId": snapshot.id,
                "workingDir": file_path.to_string_lossy()
            })
            .to_string(),
        )
        .expect_err("file path rejected");
        assert!(matches!(file_error, AgentError::BadRequest(_)));

        with_session(&snapshot.id, |session| {
            session.snapshot.follow = AgentFollowState {
                running: true,
                activity: Some("Streaming".to_string()),
            };
        })
        .expect("mark running");
        let running_error = bind_project_session_json(
            json!({
                "sessionId": snapshot.id,
                "workingDir": default_unbound_working_dir()
            })
            .to_string(),
        )
        .expect_err("running session rejected");
        assert!(matches!(running_error, AgentError::BadRequest(_)));
    }

    #[test]
    fn rollback_preview_and_restore_revert_workspace_and_session() {
        let _env = RuntimeTestEnv::new();
        let work = tempfile::tempdir().expect("work dir");
        std::fs::write(work.path().join("tracked.txt"), "before").expect("write tracked");

        let created =
            create_session_json(r#"{"title":"Rollback Test"}"#.to_string()).expect("create");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");
        let mut session = Session::load(&snapshot.id).expect("load session");
        session.working_dir = Some(work.path().to_string_lossy().to_string());
        session.save().expect("save working dir");

        rollback::create_anchor_for_user_message(&snapshot.id, "temporary-message", "change files")
            .expect("create checkpoint");

        let mut session = Session::load(&snapshot.id).expect("load session");
        session.add_message(
            Role::User,
            vec![ContentBlock::Text {
                text: "keep this context".to_string(),
                cache_control: None,
            }],
        );
        let target_message_id = session.add_message(
            Role::User,
            vec![ContentBlock::Text {
                text: "change files".to_string(),
                cache_control: None,
            }],
        );
        session.add_message(
            Role::Assistant,
            vec![ContentBlock::Text {
                text: "changed".to_string(),
                cache_control: None,
            }],
        );
        session.save().expect("save transcript");
        rollback::bind_pending_anchors(&session).expect("bind anchor");

        std::fs::write(work.path().join("tracked.txt"), "after").expect("modify tracked");
        std::fs::write(work.path().join("created.txt"), "new").expect("create new");

        let preview = preview_rollback_json(format!(
            r#"{{"sessionId":"{}","messageId":"{}"}}"#,
            snapshot.id, target_message_id
        ))
        .expect("preview rollback");
        let preview: Value = serde_json::from_str(&preview).expect("preview json");
        assert_eq!(preview["available"], true);
        assert_eq!(preview["removedMessageCount"], 2);
        assert_eq!(
            preview["changedFiles"]
                .as_array()
                .expect("changed files")
                .len(),
            2
        );

        let restored = restore_rollback_json(format!(
            r#"{{"sessionId":"{}","messageId":"{}","mode":"taskAndWorkspace"}}"#,
            snapshot.id, target_message_id
        ))
        .expect("restore rollback");
        let restored: Value = serde_json::from_str(&restored).expect("restore json");
        assert_eq!(restored["removedMessageCount"], 2);
        assert_eq!(restored["restoredFileCount"], 2);
        assert_eq!(
            restored["snapshot"]["messages"].as_array().unwrap().len(),
            1
        );
        assert_eq!(
            restored["snapshot"]["messages"][0]["text"],
            "keep this context"
        );
        assert_eq!(
            std::fs::read_to_string(work.path().join("tracked.txt")).expect("tracked content"),
            "before"
        );
        assert!(!work.path().join("created.txt").exists());
    }

    #[test]
    fn session_metadata_actions_persist_to_jcode_storage() {
        let _env = RuntimeTestEnv::new();
        let created =
            create_session_json(r#"{"title":"Manage Me"}"#.to_string()).expect("create session");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");

        let saved = save_session_json(format!(
            r#"{{"sessionId":"{}","label":"important"}}"#,
            snapshot.id
        ))
        .expect("save session");
        let saved: Value = serde_json::from_str(&saved).expect("saved summary");
        assert_eq!(saved["saved"], true);
        assert_eq!(saved["saveLabel"], "important");
        assert_eq!(
            Session::load(&snapshot.id)
                .expect("load saved session")
                .save_label
                .as_deref(),
            Some("important")
        );

        let renamed = rename_session_json(format!(
            r#"{{"sessionId":"{}","title":"Renamed GUI Session"}}"#,
            snapshot.id
        ))
        .expect("rename session");
        let renamed: Value = serde_json::from_str(&renamed).expect("renamed summary");
        assert_eq!(renamed["title"], "Renamed GUI Session");
        assert_eq!(renamed["customTitle"], "Renamed GUI Session");

        let archived = archive_session_json(format!(
            r#"{{"sessionId":"{}","archived":true}}"#,
            snapshot.id
        ))
        .expect("archive session");
        let archived: Value = serde_json::from_str(&archived).expect("archived summary");
        assert_eq!(archived["archived"], true);
        assert!(Session::load(&snapshot.id).expect("load archived").archived);

        let unsaved = unsave_session_json(format!(r#"{{"sessionId":"{}"}}"#, snapshot.id))
            .expect("unsave session");
        let unsaved: Value = serde_json::from_str(&unsaved).expect("unsaved summary");
        assert_eq!(unsaved["saved"], false);
        assert_eq!(unsaved["saveLabel"], Value::Null);

        let listed = list_jcode_sessions_json(r#"{"limit":500}"#.to_string()).expect("list");
        let listed: Value = serde_json::from_str(&listed).expect("list json");
        let session = listed["sessions"]
            .as_array()
            .expect("sessions")
            .iter()
            .find(|entry| entry["id"] == snapshot.id)
            .expect("listed session");
        assert_eq!(session["archived"], true);
        assert_eq!(session["customTitle"], "Renamed GUI Session");
    }

    #[test]
    fn unsave_session_does_not_activate_history_session() {
        let _env = RuntimeTestEnv::new();
        let active =
            create_session_json(r#"{"title":"Active Session"}"#.to_string()).expect("create");
        let active_snapshot: AgentSessionSnapshot =
            serde_json::from_str(&active).expect("active snapshot");
        let history =
            create_session_json(r#"{"title":"History Session"}"#.to_string()).expect("create");
        let history_snapshot: AgentSessionSnapshot =
            serde_json::from_str(&history).expect("history snapshot");
        save_session_json(format!(
            r#"{{"sessionId":"{}","label":"favorite"}}"#,
            history_snapshot.id
        ))
        .expect("save history session");

        {
            let mut runtime = RUNTIME.lock().expect("runtime lock");
            runtime.active_session_id = Some(active_snapshot.id.clone());
        }

        unsave_session_json(format!(r#"{{"sessionId":"{}"}}"#, history_snapshot.id))
            .expect("unsave history session");

        let runtime = RUNTIME.lock().expect("runtime lock");
        assert_eq!(
            runtime.active_session_id.as_deref(),
            Some(active_snapshot.id.as_str())
        );
    }

    #[test]
    fn session_delete_physically_removes_idle_session_files() {
        let _env = RuntimeTestEnv::new();
        let created =
            create_session_json(r#"{"title":"Delete Me"}"#.to_string()).expect("create session");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");
        let path = session_path(&snapshot.id).expect("session path");
        let journal_path = session_journal_path(&snapshot.id).expect("journal path");
        assert!(path.exists());

        let deleted = delete_session_json(format!(r#"{{"sessionId":"{}"}}"#, snapshot.id))
            .expect("delete session");
        let deleted: Value = serde_json::from_str(&deleted).expect("delete json");
        assert_eq!(deleted["deleted"], true);
        assert!(!path.exists());
        assert!(!journal_path.exists());
        assert!(read_session_json(format!(r#"{{"sessionId":"{}"}}"#, snapshot.id)).is_err());
    }

    #[test]
    fn session_delete_failure_keeps_runtime_session_active() {
        let _env = RuntimeTestEnv::new();
        let created =
            create_session_json(r#"{"title":"Delete Failure"}"#.to_string()).expect("create");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");
        let path = session_path(&snapshot.id).expect("session path");
        std::fs::remove_file(&path).expect("remove persisted session first");

        let error = delete_session_json(format!(r#"{{"sessionId":"{}"}}"#, snapshot.id))
            .expect_err("delete should fail when the session file is gone");
        assert!(error.to_string().contains("session not found"));

        let runtime = RUNTIME.lock().expect("runtime lock");
        assert!(runtime.sessions.contains_key(&snapshot.id));
        assert_eq!(
            runtime.active_session_id.as_deref(),
            Some(snapshot.id.as_str())
        );
    }

    #[test]
    fn session_delete_rejects_running_session() {
        let _env = RuntimeTestEnv::new();
        let created =
            create_session_json(r#"{"title":"Running Delete"}"#.to_string()).expect("create");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");
        send_turn_json(format!(
            r#"{{"sessionId":"{}","text":"hello"}}"#,
            snapshot.id
        ))
        .expect("send");

        let error = delete_session_json(format!(r#"{{"sessionId":"{}"}}"#, snapshot.id))
            .expect_err("running delete should fail");
        assert!(error.to_string().contains("cannot delete running session"));
        let _ = cancel_turn_json(format!(r#"{{"sessionId":"{}"}}"#, snapshot.id));
    }

    #[test]
    fn selfdev_start_creates_canary_session_without_switching_active_session() {
        let _env = RuntimeTestEnv::new();
        let parent =
            create_session_json(r#"{"title":"Parent Agent Session"}"#.to_string()).expect("create");
        let parent_snapshot: AgentSessionSnapshot =
            serde_json::from_str(&parent).expect("parent snapshot");
        let repo_dir = resolve_lyra_repo_dir().expect("lyra repo");

        let response = start_selfdev_session_json(format!(
            r#"{{"parentSessionId":"{}","inheritContext":true,"target":"agent-core"}}"#,
            parent_snapshot.id
        ))
        .expect("start selfdev");
        let response: Value = serde_json::from_str(&response).expect("selfdev response");

        assert_eq!(response["status"], "idle");
        assert_eq!(response["inheritedContext"], true);
        assert_eq!(response["snapshot"]["sessionKind"], "selfdev");
        assert_eq!(
            response["snapshot"]["workingDir"],
            repo_dir.display().to_string()
        );
        let session_id = response["sessionId"].as_str().expect("session id");
        let session = Session::load(session_id).expect("load selfdev session");
        assert!(session.is_canary);
        assert_eq!(session.testing_build.as_deref(), Some("self-dev"));
        assert_eq!(session.working_dir.as_deref(), response["repoDir"].as_str());

        let runtime = RUNTIME.lock().expect("runtime lock");
        assert_eq!(
            runtime.active_session_id.as_deref(),
            Some(parent_snapshot.id.as_str())
        );
    }

    #[test]
    fn improve_and_refactor_actions_persist_jcode_modes() {
        let _env = RuntimeTestEnv::new();
        let improve =
            create_session_json(r#"{"title":"Improve Mode"}"#.to_string()).expect("create");
        let improve_snapshot: AgentSessionSnapshot =
            serde_json::from_str(&improve).expect("improve snapshot");
        let improve_response = run_improve_session_json(format!(
            r#"{{"sessionId":"{}","planOnly":true,"focus":"tests"}}"#,
            improve_snapshot.id
        ))
        .expect("run improve");
        let improve_response: Value =
            serde_json::from_str(&improve_response).expect("improve response");
        assert_eq!(improve_response["status"], "running");
        assert_eq!(
            Session::load(&improve_snapshot.id)
                .expect("load improve")
                .improve_mode,
            Some(crate::session::SessionImproveMode::ImprovePlan)
        );
        let _ = cancel_turn_json(format!(r#"{{"sessionId":"{}"}}"#, improve_snapshot.id));

        let refactor =
            create_session_json(r#"{"title":"Refactor Mode"}"#.to_string()).expect("create");
        let refactor_snapshot: AgentSessionSnapshot =
            serde_json::from_str(&refactor).expect("refactor snapshot");
        let refactor_response = refactor_session_json(format!(
            r#"{{"sessionId":"{}","planOnly":false}}"#,
            refactor_snapshot.id
        ))
        .expect("run refactor");
        let refactor_response: Value =
            serde_json::from_str(&refactor_response).expect("refactor response");
        assert_eq!(refactor_response["status"], "running");
        assert_eq!(
            Session::load(&refactor_snapshot.id)
                .expect("load refactor")
                .improve_mode,
            Some(crate::session::SessionImproveMode::RefactorRun)
        );
        let _ = cancel_turn_json(format!(r#"{{"sessionId":"{}"}}"#, refactor_snapshot.id));
    }

    #[test]
    fn review_and_judge_actions_spawn_child_sessions() {
        let _env = RuntimeTestEnv::new();
        let created =
            create_session_json(r#"{"title":"Parent Work"}"#.to_string()).expect("create");
        let parent_snapshot: AgentSessionSnapshot =
            serde_json::from_str(&created).expect("parent snapshot");

        let review_response =
            run_review_session_json(format!(r#"{{"sessionId":"{}"}}"#, parent_snapshot.id))
                .expect("run review");
        let review_response: Value =
            serde_json::from_str(&review_response).expect("review response");
        let review_session_id = review_response["sessionId"].as_str().expect("review id");
        assert_ne!(review_session_id, parent_snapshot.id);
        let review_session = Session::load(review_session_id).expect("load review");
        assert_eq!(
            review_session.parent_id.as_deref(),
            Some(parent_snapshot.id.as_str())
        );
        assert_eq!(review_session.title.as_deref(), Some("review"));
        assert_eq!(review_session.autoreview_enabled, Some(false));
        assert_eq!(review_session.autojudge_enabled, Some(false));
        let _ = cancel_turn_json(format!(r#"{{"sessionId":"{}"}}"#, review_session_id));

        let judge_response =
            run_judge_session_json(format!(r#"{{"sessionId":"{}"}}"#, parent_snapshot.id))
                .expect("run judge");
        let judge_response: Value = serde_json::from_str(&judge_response).expect("judge response");
        let judge_session_id = judge_response["sessionId"].as_str().expect("judge id");
        assert_ne!(judge_session_id, parent_snapshot.id);
        let judge_session = Session::load(judge_session_id).expect("load judge");
        assert_eq!(
            judge_session.parent_id.as_deref(),
            Some(parent_snapshot.id.as_str())
        );
        assert_eq!(judge_session.title.as_deref(), Some("judge"));
        assert_eq!(judge_session.autoreview_enabled, Some(false));
        assert_eq!(judge_session.autojudge_enabled, Some(false));
        let _ = cancel_turn_json(format!(r#"{{"sessionId":"{}"}}"#, judge_session_id));
    }

    #[test]
    fn poke_action_uses_jcode_todo_storage() {
        let _env = RuntimeTestEnv::new();
        let created = create_session_json(r#"{"title":"Poke Todos"}"#.to_string()).expect("create");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");

        let empty = trigger_poke_session_json(format!(r#"{{"sessionId":"{}"}}"#, snapshot.id))
            .expect("empty poke");
        let empty: Value = serde_json::from_str(&empty).expect("empty poke json");
        assert_eq!(empty["sent"], false);
        assert_eq!(empty["incompleteTodoCount"], 0);

        crate::todo::save_todos(
            &snapshot.id,
            &[crate::todo::TodoItem {
                content: "finish GUI poke".to_string(),
                status: "pending".to_string(),
                priority: "high".to_string(),
                id: "todo-1".to_string(),
                blocked_by: Vec::new(),
                assigned_to: None,
            }],
        )
        .expect("save todos");

        let triggered = trigger_poke_session_json(format!(r#"{{"sessionId":"{}"}}"#, snapshot.id))
            .expect("trigger poke");
        let triggered: Value = serde_json::from_str(&triggered).expect("triggered poke json");
        assert_eq!(triggered["sent"], true);
        assert_eq!(triggered["incompleteTodoCount"], 1);
        assert_eq!(triggered["status"], "running");
        let _ = cancel_turn_json(format!(r#"{{"sessionId":"{}"}}"#, snapshot.id));
    }

    #[test]
    fn snapshot_maps_jcode_tool_transcript_to_tool_activity() {
        let _env = RuntimeTestEnv::new();
        let timestamp = Utc::now();
        let mut session = Session::create(None, Some("Tool Transcript".to_string()));
        session.messages = vec![
            crate::session::StoredMessage {
                id: "user-1".to_string(),
                role: Role::User,
                content: vec![ContentBlock::Text {
                    text: "show my desktop".to_string(),
                    cache_control: None,
                }],
                display_role: None,
                timestamp: Some(timestamp),
                tool_duration_ms: None,
                token_usage: None,
            },
            crate::session::StoredMessage {
                id: "assistant-tool".to_string(),
                role: Role::Assistant,
                content: vec![ContentBlock::ToolUse {
                    id: "tool-1".to_string(),
                    name: "ls".to_string(),
                    input: json!({ "path": "/Users/petehsu/Desktop" }),
                }],
                display_role: None,
                timestamp: Some(timestamp),
                tool_duration_ms: None,
                token_usage: None,
            },
            crate::session::StoredMessage {
                id: "tool-result".to_string(),
                role: Role::User,
                content: vec![ContentBlock::ToolResult {
                    tool_use_id: "tool-1".to_string(),
                    content: "file-a\nfile-b".to_string(),
                    is_error: Some(false),
                }],
                display_role: None,
                timestamp: Some(timestamp),
                tool_duration_ms: None,
                token_usage: None,
            },
            crate::session::StoredMessage {
                id: "assistant-1".to_string(),
                role: Role::Assistant,
                content: vec![ContentBlock::Text {
                    text: "I found two files.".to_string(),
                    cache_control: None,
                }],
                display_role: None,
                timestamp: Some(timestamp),
                tool_duration_ms: None,
                token_usage: None,
            },
        ];

        let snapshot = snapshot_from_jcode_session(
            &session,
            TurnStatus::Finished,
            None,
            AgentFollowState {
                running: false,
                activity: None,
            },
            Vec::new(),
        );

        assert_eq!(snapshot.messages.len(), 2);
        assert_eq!(snapshot.messages[0].text, "show my desktop");
        assert_eq!(snapshot.messages[1].text, "I found two files.");
        assert!(snapshot.messages.iter().all(|message| {
            !message.text.contains("[tool:") && !message.text.contains("[result:")
        }));
        assert_eq!(snapshot.tools.len(), 1);
        assert_eq!(snapshot.tools[0].name, "ls");
        assert_eq!(snapshot.tools[0].label, "Read");
        assert_eq!(snapshot.tools[0].status, ToolActivityStatus::Completed);
        assert_eq!(
            snapshot.tools[0].input,
            json!({ "path": "/Users/petehsu/Desktop" })
        );
        assert_eq!(
            snapshot.tools[0].output,
            Some(json!({ "content": "file-a\nfile-b", "error": null }))
        );
    }

    #[test]
    fn snapshot_uses_display_role_not_text_to_hide_internal_messages() {
        let _env = RuntimeTestEnv::new();
        let timestamp = Utc::now();
        let mut session = Session::create(None, Some("Internal Reminder".to_string()));
        session.messages = vec![
            crate::session::StoredMessage {
                id: "user-1".to_string(),
                role: Role::User,
                content: vec![ContentBlock::Text {
                    text: "use the tool".to_string(),
                    cache_control: None,
                }],
                display_role: None,
                timestamp: Some(timestamp),
                tool_duration_ms: None,
                token_usage: None,
            },
            crate::session::StoredMessage {
                id: "literal-user-text".to_string(),
                role: Role::User,
                content: vec![ContentBlock::Text {
                    text: "# Session Context\nThis is literal user text, not an internal message.\n[System note: user wrote this literally]".to_string(),
                    cache_control: None,
                }],
                display_role: None,
                timestamp: Some(timestamp),
                tool_duration_ms: None,
                token_usage: None,
            },
            crate::session::StoredMessage {
                id: "internal-runtime-note".to_string(),
                role: Role::User,
                content: vec![ContentBlock::Text {
                    text: "Internal runtime state is stored structurally, not as a visible chat message.".to_string(),
                    cache_control: None,
                }],
                display_role: Some(crate::session::StoredDisplayRole::System),
                timestamp: Some(timestamp),
                tool_duration_ms: None,
                token_usage: None,
            },
            crate::session::StoredMessage {
                id: "assistant-1".to_string(),
                role: Role::Assistant,
                content: vec![ContentBlock::Text {
                    text: "Done.".to_string(),
                    cache_control: None,
                }],
                display_role: None,
                timestamp: Some(timestamp),
                tool_duration_ms: None,
                token_usage: None,
            },
        ];

        let snapshot = snapshot_from_jcode_session(
            &session,
            TurnStatus::Finished,
            None,
            AgentFollowState {
                running: false,
                activity: None,
            },
            Vec::new(),
        );

        assert_eq!(snapshot.messages.len(), 3);
        assert_eq!(snapshot.messages[0].text, "use the tool");
        assert!(snapshot.messages[1].text.contains("literal user text"));
        assert!(
            snapshot.messages[1]
                .text
                .contains("[System note: user wrote this literally]")
        );
        assert_eq!(snapshot.messages[2].text, "Done.");
        assert!(snapshot.messages.iter().all(|message| {
            !message
                .text
                .contains("Internal runtime state is stored structurally")
        }));
    }

    #[test]
    fn lyra_lumen_load_idle_timeout_is_typed_partial() {
        assert_eq!(
            typed_tool_result_status(
                "lyra_lumen",
                &json!({ "action": "wait", "until": "loadIdle" }),
                "Wait condition 'loadIdle' timed out after 30000ms.",
                None,
            ),
            ToolResultStatus::TimedOutPartial
        );
    }

    #[test]
    fn jcode_turn_emits_events_and_can_cancel() {
        let _env = RuntimeTestEnv::new();
        let events = Arc::new(Mutex::new(Vec::<String>::new()));
        let events_for_callback = events.clone();
        register_rust_event_callback(Arc::new(move |event| {
            if let Ok(mut events) = events_for_callback.lock() {
                events.push(event);
            }
        }));

        let created =
            create_session_json(r#"{"title":"Cancel Test"}"#.to_string()).expect("create session");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");
        let sent = send_turn_json(format!(
            r#"{{"sessionId":"{}","text":"hello"}}"#,
            snapshot.id
        ))
        .expect("send turn");
        assert!(sent.contains("running"));

        let _ =
            cancel_turn_json(format!(r#"{{"sessionId":"{}"}}"#, snapshot.id)).expect("cancel turn");
        let mut captured = String::new();
        for _ in 0..50 {
            thread::sleep(Duration::from_millis(100));
            captured = events.lock().expect("events").join("\n");
            if captured.contains("turnFinished") || captured.contains("turnFailed") {
                break;
            }
        }
        assert!(captured.contains("messageCommitted"));
        assert!(captured.contains("followStateChanged"));
        assert!(captured.contains("turnFinished") || captured.contains("turnFailed"));
        clear_rust_event_callback();
    }

    #[test]
    fn clarification_request_emits_event_and_waits_for_response() {
        let _env = RuntimeTestEnv::new();
        let events = Arc::new(Mutex::new(Vec::<String>::new()));
        let events_for_callback = events.clone();
        register_rust_event_callback(Arc::new(move |event| {
            if let Ok(mut events) = events_for_callback.lock() {
                events.push(event);
            }
        }));

        let created =
            create_session_json(r#"{"title":"Clarification Test"}"#.to_string()).expect("create");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");
        let session_id = snapshot.id.clone();
        let worker = thread::spawn(move || {
            ask_user_clarification(
                &session_id,
                "Which direction should I take?",
                vec![
                    ClarificationOption {
                        label: "A".to_string(),
                        description: Some("Use the first path".to_string()),
                    },
                    ClarificationOption {
                        label: "B".to_string(),
                        description: None,
                    },
                ],
                true,
                Some("Needed before changing files".to_string()),
            )
            .expect("clarification answer")
        });

        let mut clarification_id = None;
        for _ in 0..50 {
            thread::sleep(Duration::from_millis(20));
            let captured = events.lock().expect("events").clone();
            for event in captured {
                let value: Value = serde_json::from_str(&event).expect("event json");
                if value["kind"] == "clarificationRequested" {
                    clarification_id = value["clarificationId"].as_str().map(ToOwned::to_owned);
                    assert_eq!(value["sessionId"], snapshot.id);
                    assert_eq!(value["question"], "Which direction should I take?");
                    assert_eq!(
                        value["options"],
                        json!([
                            { "label": "A", "description": "Use the first path" },
                            { "label": "B" }
                        ])
                    );
                    assert_eq!(value["allowCustomAnswer"], true);
                    assert_eq!(value["detail"], "Needed before changing files");
                    break;
                }
            }
            if clarification_id.is_some() {
                break;
            }
        }

        let clarification_id = clarification_id.expect("clarification event");
        let response = respond_clarification_json(
            json!({
                "sessionId": snapshot.id,
                "clarificationId": clarification_id,
                "answer": "A",
                "selectedOption": "A"
            })
            .to_string(),
        )
        .expect("respond clarification");
        let response: Value = serde_json::from_str(&response).expect("response json");
        assert_eq!(response["answer"], "A");
        assert_eq!(response["selectedOption"], "A");

        let answer = worker.join().expect("worker join");
        assert_eq!(answer.answer, "A");
        assert_eq!(answer.selected_option.as_deref(), Some("A"));
        clear_rust_event_callback();
    }

    #[test]
    fn clarification_cancel_drops_pending_request() {
        let _env = RuntimeTestEnv::new();
        let events = Arc::new(Mutex::new(Vec::<String>::new()));
        let events_for_callback = events.clone();
        register_rust_event_callback(Arc::new(move |event| {
            if let Ok(mut events) = events_for_callback.lock() {
                events.push(event);
            }
        }));

        let created =
            create_session_json(r#"{"title":"Clarification Cancel"}"#.to_string()).expect("create");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");
        let session_id = snapshot.id.clone();
        let worker = thread::spawn(move || {
            ask_user_clarification(&session_id, "Need input?", Vec::new(), true, None)
        });

        let mut clarification_id = None;
        for _ in 0..50 {
            thread::sleep(Duration::from_millis(20));
            let captured = events.lock().expect("events").clone();
            clarification_id = captured.iter().find_map(|event| {
                let value: Value = serde_json::from_str(event).ok()?;
                (value["kind"] == "clarificationRequested")
                    .then(|| value["clarificationId"].as_str().map(ToOwned::to_owned))
                    .flatten()
            });
            if clarification_id.is_some() {
                break;
            }
        }

        let clarification_id = clarification_id.expect("clarification event");
        cancel_pending_clarifications_for_session(&snapshot.id);
        let error = worker
            .join()
            .expect("worker join")
            .expect_err("clarification should be cancelled");
        assert!(
            error
                .to_string()
                .contains("clarification request was cancelled")
        );

        let duplicate = respond_clarification_json(
            json!({
                "sessionId": snapshot.id,
                "clarificationId": clarification_id,
                "answer": "Too late"
            })
            .to_string(),
        )
        .expect_err("cancelled clarification should not accept answers");
        assert!(duplicate.to_string().contains("no longer pending"));
        clear_rust_event_callback();
    }

    #[test]
    fn gui_visible_commands_filter_gui_handled_entries() {
        let _env = RuntimeTestEnv::new();
        let commands = gui_visible_jcode_commands();
        let command_names = commands
            .iter()
            .map(|command| command.name.as_str())
            .collect::<Vec<_>>();

        for filtered in GUI_HANDLED_OR_DEPRECATED_COMMANDS {
            assert!(
                !command_names.contains(filtered),
                "{filtered} should be handled by GUI, not slash command list"
            );
        }
        assert!(!command_names.contains(&"/config"));
        assert!(!command_names.contains(&"/resume"));
        assert!(!command_names.contains(&"/?"));
        assert!(!command_names.contains(&"/commands"));
        assert!(!command_names.contains(&"/models"));
        assert!(!command_names.contains(&"/sessions"));
        assert!(!command_names.contains(&"/split-view"));
        assert!(!command_names.contains(&"/splitview"));
        assert!(!command_names.contains(&"/git"));
        assert!(!command_names.contains(&"/accounts"));
        assert!(!command_names.contains(&"/clear"));
        assert!(!command_names.contains(&"/save"));
        assert!(!command_names.contains(&"/unsave"));
        assert!(!command_names.contains(&"/rename"));
        assert!(!command_names.contains(&"/review"));
        assert!(!command_names.contains(&"/judge"));
        assert!(!command_names.contains(&"/subagent"));
        assert!(!command_names.contains(&"/subagent-model"));
        assert!(!command_names.contains(&"/autoreview"));
        assert!(!command_names.contains(&"/autojudge"));
        assert!(!command_names.contains(&"/btw"));
        assert!(!command_names.contains(&"/compact"));
        assert!(!command_names.contains(&"/split"));
        assert!(!command_names.contains(&"/transfer"));
        assert!(!command_names.contains(&"/goals"));
        assert!(!command_names.contains(&"/auth"));
        assert!(!command_names.contains(&"/login"));
        assert!(!command_names.contains(&"/account"));
        assert!(!command_names.contains(&"/selfdev"));
        assert!(!command_names.contains(&"/overnight"));
        assert!(!command_names.contains(&"/memory"));
        assert!(!command_names.contains(&"/swarm"));
        assert!(!command_names.contains(&"/transcript"));
        assert!(!command_names.contains(&"/context"));
        assert!(!command_names.contains(&"/info"));
        assert!(!command_names.contains(&"/usage"));
        for removed in [
            "/transport",
            "/cache",
            "/fix",
            "/catchup",
            "/back",
            "/workspace",
            "/transcript",
            "/changelog",
            "/reload",
            "/restart",
            "/rebuild",
            "/update",
            "/quit",
            "/debug-visual",
            "/screenshot-mode",
            "/screenshot",
            "/record",
            "/client-reload",
            "/server-reload",
            "/context",
            "/info",
            "/usage",
            "/z",
            "/zz",
            "/zzz",
            "/zstatus",
        ] {
            assert!(
                !command_names.contains(&removed),
                "{removed} should be deleted from GUI slash commands"
            );
        }
    }

    #[test]
    fn memory_is_effectively_enabled_even_when_legacy_config_disables_it() {
        let _env = RuntimeTestEnv::new();
        let path = crate::config::Config::path().expect("config path");
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("config dir");
        }
        std::fs::write(&path, "[features]\nmemory = false\n").expect("write legacy config");
        crate::config::Config::invalidate_cache();

        let created =
            create_session_json(r#"{"title":"Memory Default Test"}"#.to_string()).expect("create");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");
        let agent = {
            let runtime = RUNTIME.lock().expect("runtime lock");
            runtime
                .sessions
                .get(&snapshot.id)
                .expect("runtime session")
                .agent
                .clone()
        };
        let memory_enabled =
            block_on(async move { agent.lock().await.memory_enabled() }).expect("agent lock");

        assert!(memory_enabled);
    }

    #[test]
    fn jcode_config_update_ignores_memory_and_swarm_enabled_patches() {
        let _env = RuntimeTestEnv::new();
        update_jcode_config_json(r#"{"memoryEnabled":false,"swarmEnabled":false}"#.to_string())
            .expect("update config");

        let config = crate::config::Config::load();
        assert!(config.features.memory);
        assert!(config.features.swarm);
        let config_path = crate::config::Config::path().expect("config path");
        let config_text = std::fs::read_to_string(config_path).expect("read config");
        assert!(!config_text.contains("memory ="));
        assert!(!config_text.contains("swarm ="));
    }

    #[test]
    fn jcode_config_update_persists_notification_fields() {
        let _env = RuntimeTestEnv::new();
        update_jcode_config_json(
            r#"{
                "desktopNotifications":false,
                "ntfyTopic":"agent-topic",
                "ntfyServer":"https://ntfy.example.com",
                "emailEnabled":true,
                "emailTo":"ops@example.com",
                "emailSmtpHost":"smtp.example.com",
                "emailSmtpPort":2525,
                "emailFrom":"agent@example.com",
                "emailPassword":"smtp-secret",
                "emailImapHost":"imap.example.com",
                "emailImapPort":1993,
                "emailReplyEnabled":true,
                "telegramEnabled":true,
                "telegramBotToken":"telegram-secret",
                "telegramChatId":"12345",
                "telegramReplyEnabled":true,
                "discordEnabled":true,
                "discordBotToken":"discord-secret",
                "discordChannelId":"67890",
                "discordBotUserId":"24680",
                "discordReplyEnabled":true
            }"#
            .to_string(),
        )
        .expect("update config");

        let safety = crate::config::Config::load().safety;
        assert!(!safety.desktop_notifications);
        assert_eq!(safety.ntfy_topic.as_deref(), Some("agent-topic"));
        assert_eq!(safety.ntfy_server, "https://ntfy.example.com");
        assert!(safety.email_enabled);
        assert_eq!(safety.email_to.as_deref(), Some("ops@example.com"));
        assert_eq!(safety.email_smtp_host.as_deref(), Some("smtp.example.com"));
        assert_eq!(safety.email_smtp_port, 2525);
        assert_eq!(safety.email_from.as_deref(), Some("agent@example.com"));
        assert_eq!(safety.email_password.as_deref(), Some("smtp-secret"));
        assert_eq!(safety.email_imap_host.as_deref(), Some("imap.example.com"));
        assert_eq!(safety.email_imap_port, 1993);
        assert!(safety.email_reply_enabled);
        assert!(safety.telegram_enabled);
        assert_eq!(
            safety.telegram_bot_token.as_deref(),
            Some("telegram-secret")
        );
        assert_eq!(safety.telegram_chat_id.as_deref(), Some("12345"));
        assert!(safety.telegram_reply_enabled);
        assert!(safety.discord_enabled);
        assert_eq!(safety.discord_bot_token.as_deref(), Some("discord-secret"));
        assert_eq!(safety.discord_channel_id.as_deref(), Some("67890"));
        assert_eq!(safety.discord_bot_user_id.as_deref(), Some("24680"));
        assert!(safety.discord_reply_enabled);
    }

    #[test]
    fn read_jcode_config_creates_default_config_file() {
        let _env = RuntimeTestEnv::new();
        let path = crate::config::Config::path().expect("config path");
        assert!(!path.exists());

        let payload = read_jcode_config_json("{}".to_string()).expect("read jcode config");
        let snapshot: Value = serde_json::from_str(&payload).expect("json snapshot");
        let expected_path = path.display().to_string();

        assert_eq!(
            snapshot.get("configPath").and_then(Value::as_str),
            Some(expected_path.as_str())
        );
        assert!(path.exists());
        let content = std::fs::read_to_string(path).expect("config content");
        assert!(content.contains("# Lyra Agent configuration file"));
    }

    #[test]
    fn jcode_model_switch_and_provider_options_persist_to_jcode_state() {
        let env = RuntimeTestEnv::new();
        env.use_openai();

        let created =
            create_session_json(r#"{"title":"Model Test"}"#.to_string()).expect("create session");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");

        let listed = list_jcode_models_json(format!(r#"{{"sessionId":"{}"}}"#, snapshot.id))
            .expect("list models");
        let listed: Value = serde_json::from_str(&listed).expect("models json");
        assert_eq!(listed["currentProvider"], "OpenAI");
        assert_eq!(listed["currentModel"], "gpt-5.5");
        assert_eq!(listed["reasoningEffort"]["supported"], true);
        assert_eq!(listed["serviceTier"]["supported"], true);

        let switched = switch_jcode_model_json(format!(
            r#"{{"sessionId":"{}","model":"gpt-5.4","provider":"openai"}}"#,
            snapshot.id
        ))
        .expect("switch model");
        let switched: Value = serde_json::from_str(&switched).expect("switched json");
        assert_eq!(switched["currentModel"], "gpt-5.4");
        assert_eq!(
            crate::config::Config::load()
                .provider
                .default_model
                .as_deref(),
            Some("gpt-5.4")
        );
        assert_eq!(
            crate::config::Config::load()
                .provider
                .default_provider
                .as_deref(),
            Some("openai")
        );
        let persisted_session = Session::load(&snapshot.id).expect("persisted session");
        assert_eq!(persisted_session.model.as_deref(), Some("gpt-5.4"));
        assert_eq!(persisted_session.provider_key.as_deref(), Some("openai"));

        let updated = update_jcode_provider_options_json(format!(
            r#"{{"sessionId":"{}","reasoningEffort":"high","serviceTier":"priority"}}"#,
            snapshot.id
        ))
        .expect("update provider options");
        let updated: Value = serde_json::from_str(&updated).expect("updated json");
        assert_eq!(updated["reasoningEffort"]["current"], "high");
        assert_eq!(updated["serviceTier"]["current"], "priority");
        let config = crate::config::Config::load();
        assert_eq!(
            config.provider.openai_reasoning_effort.as_deref(),
            Some("high")
        );
        assert_eq!(
            config.provider.openai_service_tier.as_deref(),
            Some("priority")
        );
        let persisted_session = Session::load(&snapshot.id).expect("persisted session");
        assert_eq!(persisted_session.reasoning_effort.as_deref(), Some("high"));
    }

    #[test]
    fn jcode_model_refresh_is_a_jcode_provider_catalog_call() {
        let _env = RuntimeTestEnv::new();
        let created =
            create_session_json(r#"{"title":"Refresh Test"}"#.to_string()).expect("create session");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");

        let refreshed = refresh_jcode_models_json(format!(r#"{{"sessionId":"{}"}}"#, snapshot.id))
            .expect("refresh model catalog");
        let refreshed: Value = serde_json::from_str(&refreshed).expect("refreshed json");
        assert_eq!(refreshed["sessionId"], snapshot.id);
        assert!(refreshed["models"].is_array());
        assert!(refreshed["routes"].is_array());
    }

    #[test]
    fn jcode_model_list_does_not_expose_unconfigured_provider_fallback_model() {
        let _env = RuntimeTestEnv::new();
        let created = create_session_json(r#"{"title":"Unconfigured Model Test"}"#.to_string())
            .expect("create session");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");

        let listed = list_jcode_models_json(format!(r#"{{"sessionId":"{}"}}"#, snapshot.id))
            .expect("list models");
        let listed: Value = serde_json::from_str(&listed).expect("models json");

        assert_eq!(listed["models"].as_array().map(Vec::len), Some(0));
        let routes = listed["routes"].as_array().expect("routes");
        assert!(routes.iter().all(|route| route["available"] == false));
    }

    #[test]
    fn jcode_accounts_require_a_secret_for_required_custom_provider() {
        let _env = RuntimeTestEnv::new();
        save_jcode_provider_profile_json(
            r#"{
                "profileName":"mimo-token-plan",
                "baseUrl":"https://token-plan-sgp.xiaomimimo.com/v1",
                "defaultModel":"mimo-v2.5-pro",
                "apiKey":null,
                "auth":"header",
                "authHeader":"api-key",
                "setDefault":true,
                "models":[{"id":"mimo-v2.5-pro"}]
            }"#
            .to_string(),
        )
        .expect("save provider profile");

        let accounts = list_jcode_accounts_json("{}".to_string()).expect("list accounts");
        let accounts: Value = serde_json::from_str(&accounts).expect("accounts json");
        let account = accounts["accounts"]
            .as_array()
            .expect("accounts")
            .iter()
            .find(|account| account["label"] == "mimo-token-plan")
            .expect("mimo account");
        assert_eq!(account["configured"], false);

        let created = create_session_json(r#"{"title":"Missing Secret Model Test"}"#.to_string())
            .expect("create session");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");
        let listed = list_jcode_models_json(format!(r#"{{"sessionId":"{}"}}"#, snapshot.id))
            .expect("list models");
        let listed: Value = serde_json::from_str(&listed).expect("models json");
        assert_eq!(listed["models"].as_array().map(Vec::len), Some(0));
    }

    #[test]
    fn jcode_account_login_providers_include_oauth_and_api_key_entries() {
        let _env = RuntimeTestEnv::new();
        let response = list_jcode_login_providers_json("{}".to_string()).expect("providers");
        let response: Value = serde_json::from_str(&response).expect("providers json");
        let providers = response["providers"].as_array().expect("providers array");
        let ids = providers
            .iter()
            .filter_map(|provider| provider["id"].as_str())
            .collect::<Vec<_>>();
        assert!(ids.contains(&"claude"));
        assert!(ids.contains(&"openai"));
        assert!(ids.contains(&"gemini"));
        assert!(ids.contains(&"antigravity"));
        assert!(ids.contains(&"google"));
        assert!(ids.contains(&"openai-compatible"));
        assert!(providers.iter().any(|provider| {
            provider["id"] == "claude" && provider["requiresCallback"] == true
        }));
        assert!(providers.iter().any(|provider| {
            provider["id"] == "google" && provider["requiresCallback"] == true
        }));
        assert!(providers.iter().any(|provider| {
            provider["id"] == "openai-compatible" && provider["requiresApiKey"] == true
        }));
    }

    #[test]
    fn jcode_account_login_start_returns_stateless_oauth_flow() {
        let _env = RuntimeTestEnv::new();
        let response = start_jcode_account_login_json(r#"{"provider":"openai"}"#.to_string())
            .expect("start login");
        let response: Value = serde_json::from_str(&response).expect("start json");
        assert_eq!(response["provider"], "openai");
        assert_eq!(response["requiresCallback"], true);
        assert!(
            response["authUrl"]
                .as_str()
                .expect("auth url")
                .contains("https://auth.openai.com/oauth/authorize")
        );
        assert!(response["flowId"].as_str().unwrap_or_default().len() > 32);
    }

    #[test]
    fn jcode_google_login_start_saves_credentials_and_returns_oauth_flow() {
        let _env = RuntimeTestEnv::new();
        let response = start_jcode_account_login_json(
            r#"{
                "provider":"google",
                "googleClientId":"client-id.apps.googleusercontent.com",
                "googleClientSecret":"client-secret",
                "gmailAccessTier":"full"
            }"#
            .to_string(),
        )
        .expect("start google login");
        let response: Value = serde_json::from_str(&response).expect("start json");
        assert_eq!(response["provider"], "google");
        assert_eq!(response["requiresCallback"], true);
        assert!(
            response["authUrl"]
                .as_str()
                .expect("auth url")
                .contains("https://accounts.google.com/o/oauth2/v2/auth")
        );
        let flow = decode_login_flow(response["flowId"].as_str()).expect("flow");
        assert_eq!(flow.provider, "google");
        assert_eq!(flow.gmail_access_tier.as_deref(), Some("full"));
        let creds = crate::auth::google::load_credentials().expect("google credentials");
        assert_eq!(creds.client_id, "client-id.apps.googleusercontent.com");
        assert_eq!(creds.client_secret, "client-secret");
    }

    #[test]
    fn jcode_accounts_include_google_gmail_tokens() {
        let _env = RuntimeTestEnv::new();
        crate::auth::google::save_tokens(&crate::auth::google::GoogleTokens {
            access_token: "access".to_string(),
            refresh_token: "refresh".to_string(),
            expires_at: chrono::Utc::now().timestamp_millis() + 60_000,
            tier: crate::auth::google::GmailAccessTier::Full,
            email: Some("agent@example.com".to_string()),
        })
        .expect("save google tokens");

        let accounts = list_jcode_accounts_json("{}".to_string()).expect("list accounts");
        let accounts: Value = serde_json::from_str(&accounts).expect("accounts json");
        assert!(
            accounts["accounts"]
                .as_array()
                .expect("accounts array")
                .iter()
                .any(|account| {
                    account["provider"] == "google"
                        && account["label"] == "agent@example.com"
                        && account["kind"] == "oauth"
                        && account["configured"] == true
                })
        );
    }

    #[test]
    fn jcode_account_login_complete_saves_api_key_provider_profile() {
        let _env = RuntimeTestEnv::new();
        let response = complete_jcode_account_login_json(
            r#"{
                "provider":"openai-compatible",
                "profileName":"team-api",
                "baseUrl":"https://api.example.com/v1",
                "apiKey":"sk-test",
                "defaultModel":"model-a",
                "setDefault":true
            }"#
            .to_string(),
        )
        .expect("complete api key login");
        let response: Value = serde_json::from_str(&response).expect("complete json");
        assert_eq!(response["accounts"]["defaultProvider"], "team-api");
        assert!(
            response["accounts"]["accounts"]
                .as_array()
                .expect("accounts array")
                .iter()
                .any(|account| {
                    account["label"] == "team-api"
                        && account["kind"] == "api-key"
                        && account["configured"] == true
                })
        );
        let config = crate::config::Config::load();
        let profile = config.providers.get("team-api").expect("profile");
        assert_eq!(profile.base_url, "https://api.example.com/v1");
        assert_eq!(profile.default_model.as_deref(), Some("model-a"));
    }

    #[test]
    fn jcode_model_list_reflects_provider_profile_saved_after_session_load() {
        let _env = RuntimeTestEnv::new();
        let created = create_session_json(r#"{"title":"Late Provider Config Test"}"#.to_string())
            .expect("create session");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");
        let listed_before = list_jcode_models_json(format!(r#"{{"sessionId":"{}"}}"#, snapshot.id))
            .expect("list models before provider save");
        let listed_before: Value = serde_json::from_str(&listed_before).expect("models json");
        assert_eq!(listed_before["models"].as_array().map(Vec::len), Some(0));

        save_jcode_provider_profile_json(
            r#"{
                "profileName":"mimo-token-plan",
                "baseUrl":"https://token-plan-sgp.xiaomimimo.com/v1",
                "defaultModel":"mimo-v2.5-pro",
                "apiKey":"sk-test-mimo",
                "auth":"header",
                "authHeader":"api-key",
                "setDefault":true,
                "models":[{"id":"mimo-v2.5-pro"}]
            }"#
            .to_string(),
        )
        .expect("save provider profile");

        let accounts = list_jcode_accounts_json("{}".to_string()).expect("list accounts");
        let accounts: Value = serde_json::from_str(&accounts).expect("accounts json");
        let account = accounts["accounts"]
            .as_array()
            .expect("accounts")
            .iter()
            .find(|account| account["label"] == "mimo-token-plan")
            .expect("mimo account");
        assert_eq!(account["configured"], true);

        let listed_after = list_jcode_models_json(format!(r#"{{"sessionId":"{}"}}"#, snapshot.id))
            .expect("list models after provider save");
        let listed_after: Value = serde_json::from_str(&listed_after).expect("models json");
        let models = listed_after["models"].as_array().expect("models");
        assert!(
            models.iter().any(|model| {
                model["model"] == "mimo-v2.5-pro"
                    && model["providerKey"] == "mimo-token-plan"
                    && model["available"] == true
            }),
            "listed models: {listed_after}"
        );
    }

    #[test]
    fn jcode_agent_role_models_persist_to_native_config() {
        let _env = RuntimeTestEnv::new();
        update_jcode_agent_roles_json(
            r#"{
                "swarmModel":"gpt-5.5",
                "reviewModel":"claude-opus-4-6",
                "judgeModel":"gpt-5.4",
                "memoryModel":"  ",
                "ambientModel":"gemini-2.5-pro"
            }"#
            .to_string(),
        )
        .expect("update agent roles");

        let config = crate::config::Config::load();
        assert_eq!(config.agents.swarm_model.as_deref(), Some("gpt-5.5"));
        assert_eq!(config.autoreview.model.as_deref(), Some("claude-opus-4-6"));
        assert_eq!(config.autojudge.model.as_deref(), Some("gpt-5.4"));
        assert_eq!(config.agents.memory_model, None);
        assert_eq!(config.ambient.model.as_deref(), Some("gemini-2.5-pro"));
    }
}
