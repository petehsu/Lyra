use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

fn is_false(value: &bool) -> bool {
    !*value
}

pub type AgentSessionId = String;
pub type AgentTurnId = String;
pub type AgentMessageId = String;
pub type AgentToolCallId = String;
pub type AgentMemoryRecordId = String;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LyraAgentErrorCode {
    BadRequest,
    SessionNotFound,
    TurnNotRunning,
    ProviderFailed,
    PermissionDenied,
    CapabilityUnavailable,
    SerializationFailed,
    RuntimeUnavailable,
    InternalError,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Recoverability {
    Retryable,
    UserActionRequired,
    Terminal,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UserVisibleSeverity {
    Info,
    Warning,
    Error,
    Fatal,
}

#[derive(Clone, Debug, Error, Serialize, Deserialize, PartialEq)]
#[error("{code:?}: {message}")]
#[serde(rename_all = "camelCase")]
pub struct LyraAgentError {
    pub code: LyraAgentErrorCode,
    pub message: String,
    pub recoverability: Recoverability,
    pub severity: UserVisibleSeverity,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentSessionKind {
    Normal,
    Selfdev,
    Overnight,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentSessionStatus {
    Idle,
    Running,
    Saved,
    Archived,
    Failed,
    Deleted,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSummary {
    pub id: AgentSessionId,
    pub title: String,
    pub session_kind: AgentSessionKind,
    pub status: AgentSessionStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub message_count: usize,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
    #[serde(default)]
    pub saved: bool,
    #[serde(default)]
    pub archived: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentMessageRole {
    User,
    Assistant,
    System,
    Tool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AgentContentBlock {
    Text {
        id: String,
        text: String,
    },
    Image {
        id: String,
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
        tool_id: AgentToolCallId,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentAttachment {
    pub id: String,
    pub media_type: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentCitation {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_ref: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub id: AgentMessageId,
    pub role: AgentMessageRole,
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocks: Vec<AgentContentBlock>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<AgentAttachment>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub citations: Vec<AgentCitation>,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentToolStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolCapabilityRef {
    pub provider_id: String,
    pub tool_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capability_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolCall {
    pub id: AgentToolCallId,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capability: Option<AgentToolCapabilityRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolResult {
    pub tool_call_id: AgentToolCallId,
    pub status: AgentToolStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<LyraAgentError>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolActivity {
    pub id: AgentToolCallId,
    pub name: String,
    pub label: String,
    pub status: AgentToolStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<Value>,
    pub started_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentRuntimeTurnState {
    Queued,
    AssemblingContext,
    CallingModel,
    StreamingModel,
    WaitingForTool,
    WaitingForUser,
    RecoveringAfterReload,
    RecoveringAfterCrash,
    Interrupted,
    Completed,
    FailedRecoverable,
    FailedTerminal,
    CancelledByUser,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActiveTodo {
    pub id: String,
    pub content: String,
    pub status: String,
    pub priority: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocked_by: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assigned_to: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PinnedContext {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub items: Vec<Value>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionFacts {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub facts: Vec<Value>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SharedFacts {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub facts: Vec<Value>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_turn_id: Option<AgentTurnId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemoryProjection {
    pub pinned_context: PinnedContext,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub active_todos: Vec<ActiveTodo>,
    pub session_facts: SessionFacts,
    pub shared_facts: SharedFacts,
    pub recovery_state: RecoveryState,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub timeline: Vec<Value>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionAutomationSnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subagent_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub autoreview_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub autojudge_enabled: Option<bool>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentFollowState {
    pub running: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSnapshot {
    pub id: AgentSessionId,
    pub title: String,
    pub session_kind: AgentSessionKind,
    pub working_dir: String,
    pub project_bound: bool,
    #[serde(default)]
    pub messages: Vec<AgentMessage>,
    #[serde(default)]
    pub tools: Vec<AgentToolActivity>,
    #[serde(default)]
    pub todos: Vec<ActiveTodo>,
    pub automation: AgentSessionAutomationSnapshot,
    pub turn_status: AgentSessionStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_turn_id: Option<AgentTurnId>,
    pub follow: AgentFollowState,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory: Option<AgentMemoryProjection>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LyraSoftwareRef {
    pub id: String,
    pub label: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LyraSoftwareCapability {
    pub software: LyraSoftwareRef,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LyraSoftwareCommand {
    pub software: LyraSoftwareRef,
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LyraSoftwareEvent {
    pub software: LyraSoftwareRef,
    pub event: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRegisteredCommand {
    pub name: String,
    pub help: String,
    pub autocomplete: bool,
    pub remote_only: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigSnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_home: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_path: Option<String>,
    pub config: Value,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub commands: Vec<AgentRegisteredCommand>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderProfile {
    pub id: String,
    pub label: String,
    pub provider_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    #[serde(default)]
    pub supports_text: bool,
    #[serde(default)]
    pub supports_image_input: bool,
    #[serde(default)]
    pub supports_tool_calling: bool,
    #[serde(default)]
    pub supports_streaming: bool,
    #[serde(default)]
    pub supports_structured_output: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderOptionState {
    pub id: String,
    pub value: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub supported_values: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelEntry {
    pub id: String,
    pub label: String,
    pub provider_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<usize>,
    #[serde(default)]
    pub supports_image_input: bool,
    #[serde(default)]
    pub supports_tool_calling: bool,
    #[serde(default)]
    pub selected: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelRoute {
    pub route: String,
    pub provider_id: String,
    pub model_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelCatalogSnapshot {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub providers: Vec<AgentProviderProfile>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub models: Vec<AgentModelEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub routes: Vec<AgentModelRoute>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<AgentProviderOptionState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_tier: Option<AgentProviderOptionState>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentAccountSnapshot {
    pub id: String,
    pub provider_id: String,
    pub label: String,
    #[serde(default)]
    pub active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentLoginProviderSnapshot {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_kind: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentAccountsSnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub accounts: Vec<AgentAccountSnapshot>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub login_providers: Vec<AgentLoginProviderSnapshot>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentGitFileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentGitChangedFile {
    pub path: String,
    pub status: AgentGitFileStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_path: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentGitStatusSnapshot {
    pub branch: Option<String>,
    pub clean: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub changed_files: Vec<AgentGitChangedFile>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRollbackChangedFile {
    pub path: String,
    pub status: AgentGitFileStatus,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRollbackPreviewResponse {
    pub session_id: AgentSessionId,
    pub message_id: AgentMessageId,
    pub available: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub changed_files: Vec<AgentRollbackChangedFile>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRollbackRestoreResponse {
    pub session_id: AgentSessionId,
    pub message_id: AgentMessageId,
    pub removed_message_count: usize,
    pub restored_file_count: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgentRuntimeEvent {
    SessionSnapshot {
        snapshot: AgentSessionSnapshot,
    },
    TurnStarted {
        session_id: AgentSessionId,
        turn_id: AgentTurnId,
        state: AgentRuntimeTurnState,
    },
    TurnStateChanged {
        session_id: AgentSessionId,
        turn_id: AgentTurnId,
        state: AgentRuntimeTurnState,
        reason: String,
    },
    MessageDelta {
        session_id: AgentSessionId,
        message_id: AgentMessageId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        block_id: Option<String>,
        #[serde(default, skip_serializing_if = "is_false")]
        replace: bool,
        delta: String,
    },
    MessageCommitted {
        session_id: AgentSessionId,
        message: AgentMessage,
    },
    ToolStarted {
        session_id: AgentSessionId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message_id: Option<AgentMessageId>,
        tool: AgentToolActivity,
    },
    ToolUpdated {
        session_id: AgentSessionId,
        turn_id: AgentTurnId,
        tool: AgentToolActivity,
    },
    ToolFinished {
        session_id: AgentSessionId,
        tool: AgentToolActivity,
    },
    TodoUpdated {
        session_id: AgentSessionId,
        todos: Vec<ActiveTodo>,
    },
    MemoryUpdated {
        session_id: AgentSessionId,
        snapshot: AgentMemoryProjection,
    },
    BrowserActivityChanged {
        session_id: AgentSessionId,
        turn_id: AgentTurnId,
        target: Value,
    },
    ContextTrimmed {
        session_id: AgentSessionId,
        detail: Value,
    },
    TurnRecovered {
        session_id: AgentSessionId,
        turn_id: AgentTurnId,
    },
    PermissionRequested {
        session_id: AgentSessionId,
        permission_id: String,
        title: String,
        detail: String,
    },
    ClarificationRequested {
        session_id: AgentSessionId,
        clarification_id: String,
        question: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        options: Vec<Value>,
        allow_custom_answer: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },
    TurnFinished {
        session_id: AgentSessionId,
        turn_id: AgentTurnId,
        status: AgentSessionStatus,
    },
    TurnCompleted {
        session_id: AgentSessionId,
        turn_id: AgentTurnId,
    },
    TurnFailed {
        session_id: AgentSessionId,
        turn_id: AgentTurnId,
        error: LyraAgentError,
    },
    TurnInterrupted {
        session_id: AgentSessionId,
        turn_id: AgentTurnId,
        reason: String,
    },
    FollowStateChanged {
        session_id: AgentSessionId,
        follow: AgentFollowState,
    },
    RollbackStarted {
        session_id: AgentSessionId,
        message_id: AgentMessageId,
    },
    RollbackFinished {
        session_id: AgentSessionId,
        message_id: AgentMessageId,
        removed_message_count: usize,
        restored_file_count: usize,
    },
    RollbackFailed {
        session_id: AgentSessionId,
        message_id: AgentMessageId,
        message: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_snapshot() -> AgentSessionSnapshot {
        AgentSessionSnapshot {
            id: "session-1".to_string(),
            title: "Lyra Agent".to_string(),
            session_kind: AgentSessionKind::Normal,
            working_dir: "/tmp/project".to_string(),
            project_bound: true,
            messages: vec![AgentMessage {
                id: "msg-1".to_string(),
                role: AgentMessageRole::User,
                text: "hello".to_string(),
                blocks: vec![AgentContentBlock::Text {
                    id: "block-1".to_string(),
                    text: "hello".to_string(),
                }],
                attachments: Vec::new(),
                citations: Vec::new(),
                created_at: "2026-05-28T00:00:00Z".to_string(),
            }],
            tools: Vec::new(),
            todos: Vec::new(),
            automation: AgentSessionAutomationSnapshot::default(),
            turn_status: AgentSessionStatus::Idle,
            active_turn_id: None,
            follow: AgentFollowState::default(),
            updated_at: "2026-05-28T00:00:00Z".to_string(),
            memory: None,
        }
    }

    #[test]
    fn snapshot_serializes_camel_case() {
        let value = serde_json::to_value(sample_snapshot()).expect("snapshot json");
        assert_eq!(value["sessionKind"], "normal");
        assert_eq!(value["projectBound"], true);
        assert_eq!(value["messages"][0]["createdAt"], "2026-05-28T00:00:00Z");
        assert!(value.get("session_kind").is_none());
    }

    #[test]
    fn runtime_event_serializes_expected_kind() {
        let value = serde_json::to_value(AgentRuntimeEvent::ToolStarted {
            session_id: "session-1".to_string(),
            message_id: None,
            tool: AgentToolActivity {
                id: "tool-1".to_string(),
                name: "read".to_string(),
                label: "Read".to_string(),
                status: AgentToolStatus::Running,
                input: Some(json!({ "path": "README.md" })),
                output: None,
                started_at: "2026-05-28T00:00:00Z".to_string(),
                finished_at: None,
            },
        })
        .expect("event json");
        assert_eq!(value["kind"], "toolStarted");
        assert_eq!(value["sessionId"], "session-1");
        assert_eq!(value["tool"]["startedAt"], "2026-05-28T00:00:00Z");
    }

    #[test]
    fn memory_event_matches_desktop_snapshot_field() {
        let value = serde_json::to_value(AgentRuntimeEvent::MemoryUpdated {
            session_id: "session-1".to_string(),
            snapshot: AgentMemoryProjection::default(),
        })
        .expect("memory event json");
        assert_eq!(value["kind"], "memoryUpdated");
        assert!(value.get("snapshot").is_some());
        assert!(value.get("projection").is_none());
    }

    #[test]
    fn error_serializes_stable_code_and_severity() {
        let value = serde_json::to_value(LyraAgentError {
            code: LyraAgentErrorCode::SessionNotFound,
            message: "missing".to_string(),
            recoverability: Recoverability::UserActionRequired,
            severity: UserVisibleSeverity::Error,
            detail: None,
        })
        .expect("error json");
        assert_eq!(value["code"], "sessionNotFound");
        assert_eq!(value["recoverability"], "userActionRequired");
        assert_eq!(value["severity"], "error");
    }
}
