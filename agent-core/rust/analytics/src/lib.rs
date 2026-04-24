use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, Default)]
pub struct AnalyticsEventsClient;

impl AnalyticsEventsClient {
    pub fn new<T, U>(_auth_manager: Arc<T>, _enabled: U) -> Self
    where
        U: Into<Option<bool>>,
    {
        Self
    }

    pub fn track_initialize<T, U>(
        &self,
        _connection_id: u64,
        _params: T,
        _originator: U,
        _transport: AppServerRpcTransport,
    ) {
    }

    pub fn track_request<T, U>(&self, _connection_id: u64, _request_id: U, _request: T) {}

    pub fn track_response<T>(&self, _connection_id: u64, _response: T) {}

    pub fn track_error_response<T, U>(
        &self,
        _connection_id: u64,
        _request_id: U,
        _error: T,
        _error_type: Option<AnalyticsJsonRpcError>,
    ) {
    }

    pub fn track_notification<T>(&self, _notification: T) {}

    pub fn track_plugin_enabled<T>(&self, _metadata: T) {}

    pub fn track_plugin_disabled<T>(&self, _metadata: T) {}

    pub fn track_app_used<T>(&self, _tracking: TrackEventsContext, _invocation: T) {}

    pub fn track_compaction<T>(&self, _event: T) {}

    pub fn track_subagent_thread_started<T>(&self, _input: T) {}

    pub fn track_app_mentioned<T>(&self, _tracking: TrackEventsContext, _invocations: T) {}

    pub fn track_plugin_used<T>(&self, _tracking: TrackEventsContext, _plugin: T) {}

    pub fn track_turn_resolved_config<T>(&self, _fact: T) {}

    pub fn track_turn_token_usage<T>(&self, _fact: T) {}

    pub fn track_plugin_installed<T>(&self, _telemetry: T) {}

    pub fn track_plugin_uninstalled<T>(&self, _telemetry: T) {}

    pub fn track_skill_invocations<T>(&self, _tracking: TrackEventsContext, _invocations: T) {}

    pub fn track_hook_run<T>(&self, _tracking: TrackEventsContext, _hook: T) {}
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AppServerRpcTransport {
    Stdio,
    Websocket,
    InProcess,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InputError {
    TooLarge,
    Empty,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TurnSteerRequestError {
    NoActiveTurn,
    ExpectedTurnMismatch,
    NonSteerableReview,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AnalyticsJsonRpcError {
    Input(InputError),
    TurnSteer(TurnSteerRequestError),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InvocationType {
    Explicit,
    Implicit,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CompactionImplementation {
    Responses,
    ResponsesCompact,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CompactionPhase {
    PreTurn,
    MidTurn,
    StandaloneTurn,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CompactionReason {
    ContextLimit,
    ModelDownshift,
    UserRequested,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CompactionStatus {
    Completed,
    Failed,
    Interrupted,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CompactionStrategy {
    Memento,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CompactionTrigger {
    Auto,
    Manual,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct TrackEventsContext {
    pub model: String,
    pub thread_id: String,
    pub turn_id: String,
}

pub fn build_track_events_context(
    model: String,
    thread_id: String,
    turn_id: String,
) -> TrackEventsContext {
    TrackEventsContext {
        model,
        thread_id,
        turn_id,
    }
}

pub fn now_unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AppInvocation {
    pub connector_id: Option<String>,
    pub app_name: Option<String>,
    pub invocation_type: Option<InvocationType>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SkillInvocation<S = ()> {
    pub skill_name: String,
    pub skill_scope: S,
    pub skill_path: PathBuf,
    pub invocation_type: InvocationType,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubAgentThreadStartedInput<A = (), B = (), C = (), D = (), E = ()> {
    pub thread_id: String,
    pub parent_thread_id: Option<String>,
    pub product_client_id: A,
    pub client_name: B,
    pub client_version: C,
    pub model: D,
    pub ephemeral: bool,
    pub subagent_source: E,
    pub created_at: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TurnResolvedConfigFact<
    A = (),
    B = (),
    C = (),
    D = (),
    E = (),
    F = (),
    G = (),
    H = (),
    I = (),
> {
    pub turn_id: String,
    pub thread_id: String,
    pub num_input_images: usize,
    pub submission_type: Option<String>,
    pub ephemeral: bool,
    pub session_source: A,
    pub model: String,
    pub model_provider: String,
    pub sandbox_policy: B,
    pub reasoning_effort: C,
    pub reasoning_summary: Option<D>,
    pub service_tier: E,
    pub approval_policy: F,
    pub approvals_reviewer: G,
    pub sandbox_network_access: bool,
    pub collaboration_mode: H,
    pub personality: I,
    pub is_first_turn: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TurnTokenUsageFact<T = ()> {
    pub turn_id: String,
    pub thread_id: String,
    pub token_usage: T,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HookRunFact<A = (), B = (), C = ()> {
    pub event_name: A,
    pub hook_source: B,
    pub status: C,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CodexCompactionEvent<A = (), B = (), C = (), D = (), E = ()> {
    pub thread_id: String,
    pub turn_id: String,
    pub trigger: A,
    pub reason: B,
    pub implementation: C,
    pub phase: D,
    pub strategy: CompactionStrategy,
    pub status: E,
    pub error: Option<String>,
    pub active_context_tokens_before: i64,
    pub active_context_tokens_after: i64,
    pub started_at: u64,
    pub completed_at: u64,
    pub duration_ms: Option<u64>,
}
