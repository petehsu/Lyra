use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const AGENT_PROFILE_NOT_FOUND: &str = "AGENT_PROFILE_NOT_FOUND";
pub const AGENT_PROVIDER_UNSUPPORTED: &str = "AGENT_PROVIDER_UNSUPPORTED";
pub const AGENT_PROVIDER_INVALID_RESPONSE: &str = "AGENT_PROVIDER_INVALID_RESPONSE";
pub const AGENT_TOOL_READ_BLOCKED: &str = "AGENT_TOOL_READ_BLOCKED";
pub const AGENT_TOOL_EXEC_FAILED: &str = "AGENT_TOOL_EXEC_FAILED";
pub const AGENT_TOOL_APPROVAL_REQUIRED: &str = "AGENT_TOOL_APPROVAL_REQUIRED";
pub const AGENT_PLAN_QUESTION_REQUIRED: &str = "AGENT_PLAN_QUESTION_REQUIRED";
pub const AGENT_PLAN_APPROVAL_REQUIRED: &str = "AGENT_PLAN_APPROVAL_REQUIRED";
pub const AGENT_TURN_FAILED: &str = "AGENT_TURN_FAILED";
pub const AGENT_WAITING_INTERACTION: &str = "AGENT_WAITING_INTERACTION";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanState {
    pub status: AgentPlanStatus,
    pub version: i64,
    pub draft_markdown: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposed_markdown: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_markdown: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_submitted_version: Option<i64>,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentPendingInteractionKind {
    CommandApproval,
    UserQuestion,
    PlanApproval,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentPendingInteractionStatus {
    Pending,
    Resolved,
    Cancelled,
    Expired,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentPendingInteraction {
    pub id: String,
    pub session_id: String,
    pub turn_id: String,
    pub kind: AgentPendingInteractionKind,
    pub status: AgentPendingInteractionStatus,
    pub payload: Value,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentExecutionPhase {
    Idle,
    Running,
    WaitingInteraction,
    Resumable,
    Completed,
    Failed,
    Abandoned,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentExecutionCheckpointKind {
    TurnStarted,
    InteractionWait,
    InteractionResolved,
    TurnCompleted,
    TurnFailed,
    ManualResumeAnchor,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentGoalStatus {
    Pending,
    InProgress,
    Blocked,
    Completed,
    Failed,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentGoalNode {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    pub title: String,
    pub status: AgentGoalStatus,
    pub progress_percent: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocking_reason: Option<String>,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentExecutionState {
    pub id: String,
    pub run_id: String,
    pub thread_id: String,
    pub session_id: String,
    pub collaboration_mode: AgentCollaborationMode,
    pub phase: AgentExecutionPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub waiting_interaction_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub waiting_interaction_kind: Option<AgentPendingInteractionKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_goal_node_id: Option<String>,
    pub goal_tree_json: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_checkpoint_id: Option<String>,
    pub version: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentExecutionCheckpoint {
    pub id: String,
    pub execution_id: String,
    pub thread_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub kind: AgentExecutionCheckpointKind,
    pub phase_before: AgentExecutionPhase,
    pub phase_after: AgentExecutionPhase,
    pub goal_snapshot_json: Value,
    pub continuation_payload_json: Value,
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentExecutionCheckpointSummary {
    pub id: String,
    pub execution_id: String,
    pub thread_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub kind: AgentExecutionCheckpointKind,
    pub phase_before: AgentExecutionPhase,
    pub phase_after: AgentExecutionPhase,
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AgentCollaborationMode {
    #[default]
    Default,
    Plan,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentPlanStatus {
    Draft,
    Submitted,
    Approved,
    Rejected,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    pub collaboration_mode: AgentCollaborationMode,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AgentThreadLifecycleState {
    #[default]
    Active,
    Archived,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentThread {
    pub id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forked_from_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rollback_from_thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rollback_from_turn_id: Option<String>,
    pub lifecycle_state: AgentThreadLifecycleState,
    pub elicitation_counter: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurn {
    pub id: String,
    pub session_id: String,
    pub profile_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<AgentUsage>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_content: Option<String>,
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolCall {
    pub id: String,
    pub session_id: String,
    pub turn_id: String,
    pub tool_name: String,
    pub input: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<Value>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub started_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionDetail {
    pub session: AgentSession,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<AgentPlanState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_state: Option<AgentExecutionState>,
    #[serde(default)]
    pub execution_checkpoints: Vec<AgentExecutionCheckpointSummary>,
    pub pending_interactions: Vec<AgentPendingInteraction>,
    pub turns: Vec<AgentTurn>,
    pub messages: Vec<AgentMessage>,
    pub tool_calls: Vec<AgentToolCall>,
    pub runtime_events: Vec<AgentRuntimeEvent>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentListSessionsRequest {
    pub storage_root: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCreateSessionRequest {
    pub storage_root: String,
    pub title: Option<String>,
    pub profile_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentGetSessionRequest {
    pub storage_root: String,
    pub session_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEnsureThreadRequest {
    pub storage_root: String,
    pub session_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentGetThreadRequest {
    pub storage_root: String,
    pub thread_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentListThreadsRequest {
    pub storage_root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_archived: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentForkThreadRequest {
    pub storage_root: String,
    pub thread_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentArchiveThreadRequest {
    pub storage_root: String,
    pub thread_id: String,
}

pub type AgentUnarchiveThreadRequest = AgentArchiveThreadRequest;
pub type AgentResumeThreadRequest = AgentArchiveThreadRequest;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRollbackThreadRequest {
    pub storage_root: String,
    pub thread_id: String,
    pub turn_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDeleteSessionRequest {
    pub storage_root: String,
    pub session_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBindSessionProjectRequest {
    pub storage_root: String,
    pub session_id: String,
    pub project_root: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEnterPlanModeRequest {
    pub storage_root: String,
    pub session_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentGetPlanRequest {
    pub storage_root: String,
    pub session_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentGetPendingInteractionsRequest {
    pub storage_root: String,
    pub session_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAnswerQuestionRequest {
    pub storage_root: String,
    pub session_id: String,
    pub turn_id: String,
    pub request_id: String,
    pub answers: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

pub type AgentAnswerPlanQuestionRequest = AgentAnswerQuestionRequest;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResolvePlanApprovalRequest {
    pub storage_root: String,
    pub session_id: String,
    pub turn_id: String,
    pub request_id: String,
    pub decision: String, // "approve_and_implement" | "keep_planning" | "reject"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feedback: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResumeExecutionRequest {
    pub storage_root: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkpoint_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSendThreadTurnRequest {
    pub storage_root: String,
    pub thread_id: String,
    pub input: String,
    pub profile_id: Option<String>,
    pub model: Option<String>,
    pub project_root: Option<String>,
    pub max_steps: Option<u32>,
    #[serde(default = "default_true")]
    pub enable_planning: bool,
    pub planning_min_chars: Option<usize>,
    #[serde(default = "default_true")]
    pub enable_reflection: bool,
    pub reflection_min_tool_calls: Option<usize>,
    pub enable_context_collapse: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strategy_preset: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_user_input_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_style_profile: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_style_plugin: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_style_user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_style_project: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSendTurnRequest {
    pub storage_root: String,
    pub session_id: String,
    pub input: String,
    pub profile_id: Option<String>,
    pub model: Option<String>,
    pub project_root: Option<String>,
    pub max_steps: Option<u32>,
    /// Enable a planning step before the tool loop (default: true)
    #[serde(default = "default_true")]
    pub enable_planning: bool,
    /// Minimum input length (chars) to trigger planning (default: 100)
    pub planning_min_chars: Option<usize>,
    /// Enable a reflection step after the tool loop (default: true)
    #[serde(default = "default_true")]
    pub enable_reflection: bool,
    /// Minimum tool calls to trigger reflection (default: 3)
    pub reflection_min_tool_calls: Option<usize>,
    /// Enable context collapse for this turn (None = enabled by default)
    pub enable_context_collapse: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strategy_preset: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_user_input_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_style_profile: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_style_plugin: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_style_user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_style_project: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSendTurnResult {
    pub session: AgentSession,
    pub turn: AgentTurn,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assistant_message: Option<AgentMessage>,
    pub tool_calls: Vec<AgentToolCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<AgentUsage>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentThreadForkResult {
    pub thread: AgentThread,
    pub session: AgentSession,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeEvent {
    pub session_id: String,
    pub turn_id: String,
    pub phase: String,
    pub payload: Value,
    pub timestamp: i64,
}

/// Request from frontend when user approves/denies a command
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandApprovalSubmitRequest {
    pub storage_root: String,
    pub session_id: String,
    pub turn_id: String,
    pub tool_call_id: String,
    pub decision: String, // "allow_once", "allow_always", or "deny"
}

// ============================================================================
// Agent Configuration (AGENT_DESIGN.md §9.1)
// ============================================================================

/// Execution profile controlling agent behavior.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AgentExecutionProfile {
    #[default]
    Standard,
    Careful,
    Fast,
}

/// Approval policy for risky operations.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalPolicy {
    Allow,
    #[default]
    AskOnRisk,
    ExplicitApprove,
}

/// High-risk operation handling policy.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum HighRiskPolicy {
    #[default]
    DenyByDefault,
    ExplicitApprove,
}

/// Approval profile for different operation categories.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentApprovalProfile {
    pub file_write: ApprovalPolicy,
    pub terminal_exec: ApprovalPolicy,
    pub high_risk: HighRiskPolicy,
}

/// Complete agent configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub execution_profile: AgentExecutionProfile,
    pub approval_profile: AgentApprovalProfile,
    /// Model context window size in tokens.
    pub context_window: Option<usize>,
    /// Warning threshold fraction (default 0.75).
    pub warning_threshold: Option<f64>,
    /// Error threshold fraction (default 0.90).
    pub error_threshold: Option<f64>,
    /// Per-tool result character budget (default 30000).
    pub tool_result_budget: Option<usize>,
    /// Max concurrent read operations (default 5).
    pub max_concurrent_reads: Option<usize>,
    /// Max retries per operation (default 3).
    pub max_retries: Option<u32>,
    /// Retry backoff base in milliseconds (default 1000).
    pub retry_backoff_ms: Option<u64>,
    /// Output verbosity style.
    pub output_style: Option<AgentOutputStyle>,
    /// Output language (default "zh-CN").
    pub language: Option<String>,
}

/// Output verbosity style.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AgentOutputStyle {
    Concise,
    #[default]
    Detailed,
    Verbose,
}

// ============================================================================
// Token Monitoring (AGENT_DESIGN.md §3.3.1)
// ============================================================================

/// Token usage warning state checked before each turn.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenWarningState {
    /// Remaining context percentage.
    pub percent_left: f64,
    /// Whether usage exceeds warning threshold (75%).
    pub is_above_warning: bool,
    /// Whether usage exceeds error threshold (90%).
    pub is_above_error: bool,
    /// Whether auto-compact should be triggered.
    pub should_auto_compact: bool,
    /// Whether new requests should be blocked.
    pub is_blocking: bool,
}

// ============================================================================
// Error Recovery (AGENT_DESIGN.md §5)
// ============================================================================

/// Error severity classification.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorSeverityKind {
    /// Transient error — safe to retry.
    Transient,
    /// Recoverable error — requires strategy adjustment.
    Recoverable,
    /// Fatal error — requires user intervention.
    Fatal,
}

/// Error category for routing recovery logic.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCategoryKind {
    Network,
    Permission,
    Syntax,
    Semantic,
    Timeout,
    Resource,
    Unknown,
}

/// Structured error report for logging and analytics.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorReport {
    pub error_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub tool_name: String,
    pub error_category: ErrorCategoryKind,
    pub error_severity: ErrorSeverityKind,
    pub error_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack_trace: Option<String>,
    pub recovery_action: RecoveryAction,
    pub recovery_result: RecoveryResult,
    pub timestamp: String,
}

/// Action taken to recover from an error.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryAction {
    Retried,
    Degraded,
    Escalated,
    Aborted,
}

/// Outcome of the recovery attempt.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryResult {
    Success,
    Partial,
    Failure,
}
