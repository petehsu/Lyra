use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use once_cell::sync::{Lazy, OnceCell};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;
use uuid::Uuid;

type EventCallback = dyn Fn(String) + Send + Sync + 'static;

static EVENT_CALLBACK: OnceCell<Mutex<Option<Arc<EventCallback>>>> = OnceCell::new();
static RUNTIME: Lazy<Mutex<AgentRuntime>> = Lazy::new(|| Mutex::new(AgentRuntime::default()));

#[derive(Clone, Default)]
pub struct InterruptSignal {
    interrupted: Arc<AtomicBool>,
}

impl InterruptSignal {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn interrupt(&self) {
        self.interrupted.store(true, Ordering::SeqCst);
    }

    pub fn is_interrupted(&self) -> bool {
        self.interrupted.load(Ordering::SeqCst)
    }
}

#[derive(Debug, Error)]
pub enum AgentError {
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("session not found: {0}")]
    SessionNotFound(String),
    #[error("turn not running for session: {0}")]
    TurnNotRunning(String),
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
    pub created_at: DateTime<Utc>,
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

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSnapshot {
    pub id: String,
    pub title: String,
    pub messages: Vec<AgentMessage>,
    pub tools: Vec<ToolActivity>,
    pub turn_status: TurnStatus,
    pub active_turn_id: Option<String>,
    pub follow: AgentFollowState,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentFollowState {
    pub running: bool,
    pub activity: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolContext {
    pub session_id: String,
    pub turn_id: String,
    pub interrupt: InterruptSignalView,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterruptSignalView {
    pub interrupted: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolOutput {
    pub content: String,
    pub metadata: Value,
}

#[async_trait]
pub trait Tool: Send + Sync {
    fn definition(&self) -> ToolDefinition;
    async fn run(&self, context: ToolContext, input: Value) -> Result<ToolOutput, AgentError>;
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSessionRequest {
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionRequest {
    session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendTurnRequest {
    session_id: Option<String>,
    text: String,
    provider_profile_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelTurnRequest {
    session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecisionSubmitRequest {
    session_id: String,
    decision_id: String,
    accepted: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PermissionRespondRequest {
    session_id: String,
    permission_id: String,
    allowed: bool,
}

#[derive(Default)]
struct AgentRuntime {
    sessions: HashMap<String, AgentSession>,
    active_session_id: Option<String>,
}

struct AgentSession {
    snapshot: AgentSessionSnapshot,
    interrupt: Option<InterruptSignal>,
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

pub fn create_session_json(payload: String) -> Result<String, AgentError> {
    let request: CreateSessionRequest = parse_request(&payload)?;
    let mut runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now();
    let snapshot = AgentSessionSnapshot {
        id: id.clone(),
        title: request.title.unwrap_or_else(|| "Lyra Agent".to_string()),
        messages: Vec::new(),
        tools: Vec::new(),
        turn_status: TurnStatus::Idle,
        active_turn_id: None,
        follow: AgentFollowState {
            running: false,
            activity: None,
        },
        updated_at: now,
    };
    runtime.active_session_id = Some(id.clone());
    runtime.sessions.insert(
        id,
        AgentSession {
            snapshot: snapshot.clone(),
            interrupt: None,
        },
    );
    drop(runtime);
    emit_event(AgentRuntimeEvent::SessionSnapshot {
        snapshot: snapshot.clone(),
    });
    encode(&snapshot)
}

pub fn read_session_json(payload: String) -> Result<String, AgentError> {
    let request: SessionRequest = parse_request(&payload)?;
    let runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
    let session_id = request
        .session_id
        .or_else(|| runtime.active_session_id.clone())
        .ok_or_else(|| AgentError::SessionNotFound("active".to_string()))?;
    let snapshot = runtime
        .sessions
        .get(&session_id)
        .ok_or_else(|| AgentError::SessionNotFound(session_id.clone()))?
        .snapshot
        .clone();
    encode(&snapshot)
}

pub fn send_turn_json(payload: String) -> Result<String, AgentError> {
    let request: SendTurnRequest = parse_request(&payload)?;
    let mut runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
    let session_id = match request.session_id {
        Some(id) => id,
        None => ensure_session(&mut runtime)?,
    };
    let turn_id = Uuid::new_v4().to_string();
    let user_message = AgentMessage {
        id: Uuid::new_v4().to_string(),
        role: AgentRole::User,
        text: request.text.trim().to_string(),
        created_at: Utc::now(),
    };
    let interrupt = InterruptSignal::new();
    let snapshot = {
        let session = runtime
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| AgentError::SessionNotFound(session_id.clone()))?;
        session.snapshot.messages.push(user_message.clone());
        session.snapshot.turn_status = TurnStatus::Running;
        session.snapshot.active_turn_id = Some(turn_id.clone());
        session.snapshot.follow = AgentFollowState {
            running: true,
            activity: Some("Thinking".to_string()),
        };
        session.snapshot.updated_at = Utc::now();
        session.interrupt = Some(interrupt.clone());
        session.snapshot.clone()
    };
    runtime.active_session_id = Some(session_id.clone());
    drop(runtime);

    emit_event(AgentRuntimeEvent::SessionSnapshot {
        snapshot: snapshot.clone(),
    });
    emit_event(AgentRuntimeEvent::MessageAppended {
        session_id: session_id.clone(),
        message: user_message,
    });
    emit_event(AgentRuntimeEvent::FollowStateChanged {
        session_id: session_id.clone(),
        follow: snapshot.follow.clone(),
    });

    let provider_profile_id = request.provider_profile_id;
    thread::spawn(move || {
        run_mock_turn(session_id, turn_id, interrupt, provider_profile_id);
    });

    encode(&json!({
        "sessionId": snapshot.id,
        "turnId": snapshot.active_turn_id,
        "status": "running"
    }))
}

pub fn cancel_turn_json(payload: String) -> Result<String, AgentError> {
    let request: CancelTurnRequest = parse_request(&payload)?;
    let mut runtime = RUNTIME.lock().map_err(|_| AgentError::RuntimeLock)?;
    let session = runtime
        .sessions
        .get_mut(&request.session_id)
        .ok_or_else(|| AgentError::SessionNotFound(request.session_id.clone()))?;
    let Some(interrupt) = session.interrupt.clone() else {
        return Err(AgentError::TurnNotRunning(request.session_id));
    };
    interrupt.interrupt();
    session.snapshot.follow.activity = Some("Cancelling".to_string());
    session.snapshot.updated_at = Utc::now();
    let snapshot = session.snapshot.clone();
    drop(runtime);
    emit_event(AgentRuntimeEvent::FollowStateChanged {
        session_id: snapshot.id.clone(),
        follow: snapshot.follow.clone(),
    });
    encode(&json!({ "sessionId": snapshot.id, "status": "cancelling" }))
}

pub fn submit_decision_json(payload: String) -> Result<String, AgentError> {
    let request: DecisionSubmitRequest = parse_request(&payload)?;
    encode(&json!({
        "sessionId": request.session_id,
        "decisionId": request.decision_id,
        "accepted": request.accepted
    }))
}

pub fn respond_permission_json(payload: String) -> Result<String, AgentError> {
    let request: PermissionRespondRequest = parse_request(&payload)?;
    encode(&json!({
        "sessionId": request.session_id,
        "permissionId": request.permission_id,
        "allowed": request.allowed
    }))
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentRuntimeEvent {
    SessionSnapshot {
        snapshot: AgentSessionSnapshot,
    },
    MessageAppended {
        session_id: String,
        message: AgentMessage,
    },
    MessageDelta {
        session_id: String,
        message_id: String,
        delta: String,
    },
    ToolStarted {
        session_id: String,
        tool: ToolActivity,
    },
    ToolFinished {
        session_id: String,
        tool: ToolActivity,
    },
    DecisionRequired {
        session_id: String,
        decision_id: String,
        title: String,
        detail: String,
    },
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
}

fn run_mock_turn(
    session_id: String,
    turn_id: String,
    interrupt: InterruptSignal,
    provider_profile_id: Option<String>,
) {
    let assistant_id = Uuid::new_v4().to_string();
    if append_assistant_message(&session_id, &assistant_id).is_err() {
        return;
    }

    let chunks = [
        "I am running inside Lyra's Rust agent runtime. ",
        "This vertical slice keeps the turn alive outside the panel. ",
        "Next I will show a live tool activity. ",
    ];
    for chunk in chunks {
        if check_cancelled(&session_id, &turn_id, &interrupt) {
            return;
        }
        thread::sleep(Duration::from_millis(120));
        if append_message_delta(&session_id, &assistant_id, chunk).is_err() {
            return;
        }
    }

    let tool_id = Uuid::new_v4().to_string();
    let tool = ToolActivity {
        id: tool_id.clone(),
        name: "search.files".to_string(),
        label: "Searching workspace".to_string(),
        status: ToolActivityStatus::Running,
        input: json!({ "query": "Lyra Agent runtime" }),
        output: None,
        started_at: Utc::now(),
        finished_at: None,
    };
    if upsert_tool(&session_id, tool.clone()).is_err() {
        return;
    }
    emit_event(AgentRuntimeEvent::ToolStarted {
        session_id: session_id.clone(),
        tool: tool.clone(),
    });
    set_follow_activity(&session_id, "Searching");
    thread::sleep(Duration::from_millis(180));
    if check_cancelled(&session_id, &turn_id, &interrupt) {
        return;
    }

    let completed_tool = ToolActivity {
        status: ToolActivityStatus::Completed,
        output: Some(json!({
            "summary": "Found Lyra Agent shell, runtime router, and desktop bridge entrypoints."
        })),
        finished_at: Some(Utc::now()),
        ..tool
    };
    if upsert_tool(&session_id, completed_tool.clone()).is_err() {
        return;
    }
    emit_event(AgentRuntimeEvent::ToolFinished {
        session_id: session_id.clone(),
        tool: completed_tool,
    });

    let provider = provider_profile_id.unwrap_or_else(|| "local mock profile".to_string());
    let final_text = format!(
        "Provider profile: {provider}. The next migration step can replace this deterministic streamer with the real provider adapter."
    );
    let _ = append_message_delta(&session_id, &assistant_id, &final_text);
    finish_turn(&session_id, &turn_id, TurnStatus::Finished);
}

fn append_assistant_message(session_id: &str, message_id: &str) -> Result<(), AgentError> {
    let message = AgentMessage {
        id: message_id.to_string(),
        role: AgentRole::Assistant,
        text: String::new(),
        created_at: Utc::now(),
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
    with_session(session_id, |session| {
        if let Some(message) = session
            .snapshot
            .messages
            .iter_mut()
            .find(|message| message.id == message_id)
        {
            message.text.push_str(delta);
        }
        session.snapshot.updated_at = Utc::now();
    })?;
    emit_event(AgentRuntimeEvent::MessageDelta {
        session_id: session_id.to_string(),
        message_id: message_id.to_string(),
        delta: delta.to_string(),
    });
    Ok(())
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

fn set_follow_activity(session_id: &str, activity: &str) {
    if let Ok(snapshot) = with_session_snapshot(session_id, |session| {
        session.snapshot.follow = AgentFollowState {
            running: true,
            activity: Some(activity.to_string()),
        };
        session.snapshot.updated_at = Utc::now();
        session.snapshot.follow.clone()
    }) {
        emit_event(AgentRuntimeEvent::FollowStateChanged {
            session_id: session_id.to_string(),
            follow: snapshot,
        });
    }
}

fn check_cancelled(session_id: &str, turn_id: &str, interrupt: &InterruptSignal) -> bool {
    if interrupt.is_interrupted() {
        finish_turn(session_id, turn_id, TurnStatus::Cancelled);
        true
    } else {
        false
    }
}

fn finish_turn(session_id: &str, turn_id: &str, status: TurnStatus) {
    let _ = with_session(session_id, |session| {
        session.snapshot.turn_status = status.clone();
        session.snapshot.active_turn_id = None;
        session.snapshot.follow = AgentFollowState {
            running: false,
            activity: None,
        };
        session.snapshot.updated_at = Utc::now();
        session.interrupt = None;
    });
    emit_event(AgentRuntimeEvent::TurnFinished {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        status,
    });
    emit_event(AgentRuntimeEvent::FollowStateChanged {
        session_id: session_id.to_string(),
        follow: AgentFollowState {
            running: false,
            activity: None,
        },
    });
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

fn ensure_session(runtime: &mut AgentRuntime) -> Result<String, AgentError> {
    if let Some(session_id) = runtime.active_session_id.clone() {
        return Ok(session_id);
    }
    let id = Uuid::new_v4().to_string();
    let now = Utc::now();
    runtime.sessions.insert(
        id.clone(),
        AgentSession {
            snapshot: AgentSessionSnapshot {
                id: id.clone(),
                title: "Lyra Agent".to_string(),
                messages: Vec::new(),
                tools: Vec::new(),
                turn_status: TurnStatus::Idle,
                active_turn_id: None,
                follow: AgentFollowState {
                    running: false,
                    activity: None,
                },
                updated_at: now,
            },
            interrupt: None,
        },
    );
    runtime.active_session_id = Some(id.clone());
    Ok(id)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interrupt_signal_flips() {
        let signal = InterruptSignal::new();
        assert!(!signal.is_interrupted());
        signal.interrupt();
        assert!(signal.is_interrupted());
    }

    #[test]
    fn session_create_and_read_roundtrip() {
        let created =
            create_session_json(r#"{"title":"Test Agent"}"#.to_string()).expect("create session");
        let snapshot: AgentSessionSnapshot = serde_json::from_str(&created).expect("snapshot");
        assert_eq!(snapshot.title, "Test Agent");

        let read = read_session_json(format!(r#"{{"sessionId":"{}"}}"#, snapshot.id))
            .expect("read session");
        let read_snapshot: AgentSessionSnapshot =
            serde_json::from_str(&read).expect("read snapshot");
        assert_eq!(read_snapshot.id, snapshot.id);
    }

    #[test]
    fn send_turn_emits_events_and_can_cancel() {
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
        thread::sleep(Duration::from_millis(260));

        let captured = events.lock().expect("events").join("\n");
        assert!(captured.contains("messageAppended"));
        assert!(captured.contains("followStateChanged"));
        assert!(captured.contains("turnFinished"));
        clear_rust_event_callback();
    }
}
