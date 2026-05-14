use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
#[cfg(test)]
use std::time::Duration;

use anyhow::Result;
use chrono::{DateTime, Utc};
use futures::{StreamExt, stream};
use once_cell::sync::{Lazy, OnceCell};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;
use uuid::Uuid;

use crate::message::{ContentBlock, Message, Role, StreamEvent};
use crate::profile_provider::{AgentProviderProfile, provider_from_profile};
use crate::provider::{EventStream, Provider};
use crate::runtime::InterruptSignal;
use crate::tool::Tool;

type EventCallback = dyn Fn(String) + Send + Sync + 'static;

static EVENT_CALLBACK: OnceCell<Mutex<Option<Arc<EventCallback>>>> = OnceCell::new();
static RUNTIME: Lazy<Mutex<AgentRuntime>> = Lazy::new(|| Mutex::new(AgentRuntime::default()));

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
    provider_profile: Option<AgentProviderProfile>,
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

struct AgentRuntime {
    sessions: HashMap<String, AgentSession>,
    active_session_id: Option<String>,
    provider: Arc<dyn Provider>,
    tools: Vec<Arc<dyn Tool>>,
}

impl Default for AgentRuntime {
    fn default() -> Self {
        Self {
            sessions: HashMap::new(),
            active_session_id: None,
            provider: Arc::new(BootstrapProvider),
            tools: Vec::new(),
        }
    }
}

struct AgentSession {
    snapshot: AgentSessionSnapshot,
    jcode_messages: Vec<Message>,
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
    let snapshot = new_snapshot(request.title.unwrap_or_else(|| "Lyra Agent".to_string()));
    let id = snapshot.id.clone();
    runtime.active_session_id = Some(id.clone());
    runtime.sessions.insert(
        id,
        AgentSession {
            snapshot: snapshot.clone(),
            jcode_messages: Vec::new(),
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
    let provider = request
        .provider_profile
        .map(provider_from_profile)
        .transpose()
        .map(|provider| provider.map(Arc::<dyn Provider>::from))
        .map_err(|error| AgentError::Provider(error.to_string()))?
        .unwrap_or_else(|| runtime.provider.clone());
    let tools = runtime
        .tools
        .iter()
        .map(|tool| tool.to_definition())
        .collect::<Vec<_>>();
    let (messages, snapshot) = {
        let session = runtime
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| AgentError::SessionNotFound(session_id.clone()))?;
        session.jcode_messages.push(Message::user(&request.text));
        session.snapshot.messages.push(user_message.clone());
        session.snapshot.turn_status = TurnStatus::Running;
        session.snapshot.active_turn_id = Some(turn_id.clone());
        session.snapshot.follow = AgentFollowState {
            running: true,
            activity: Some(provider_activity(request.provider_profile_id.as_deref())),
        };
        session.snapshot.updated_at = Utc::now();
        session.interrupt = Some(interrupt.clone());
        (session.jcode_messages.clone(), session.snapshot.clone())
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

    thread::spawn(move || {
        run_provider_turn(session_id, turn_id, provider, messages, tools, interrupt);
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
    interrupt.fire();
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

fn run_provider_turn(
    session_id: String,
    turn_id: String,
    provider: Arc<dyn Provider>,
    messages: Vec<Message>,
    tools: Vec<crate::message::ToolDefinition>,
    interrupt: InterruptSignal,
) {
    let result = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| AgentError::Provider(error.to_string()))
        .and_then(|runtime| {
            runtime.block_on(async {
                let mut stream = provider
                    .complete(
                        &messages,
                        &tools,
                        "You are Lyra Agent inside a GUI workspace.",
                        None,
                    )
                    .await
                    .map_err(|error| AgentError::Provider(error.to_string()))?;
                consume_stream(&session_id, &turn_id, &interrupt, &mut stream).await
            })
        });
    if let Err(error) = result {
        fail_turn(&session_id, &turn_id, error.to_string());
    }
}

async fn consume_stream(
    session_id: &str,
    turn_id: &str,
    interrupt: &InterruptSignal,
    stream: &mut EventStream,
) -> Result<(), AgentError> {
    let assistant_id = Uuid::new_v4().to_string();
    append_assistant_message(session_id, &assistant_id)?;
    let mut active_tool: Option<ToolActivity> = None;

    while let Some(event) = stream.next().await {
        if interrupt.is_set() {
            finish_turn(session_id, turn_id, TurnStatus::Cancelled);
            return Ok(());
        }
        match event.map_err(|error| AgentError::Provider(error.to_string()))? {
            StreamEvent::TextDelta(delta) | StreamEvent::ThinkingDelta(delta) => {
                append_message_delta(session_id, &assistant_id, &delta)?;
            }
            StreamEvent::ToolUseStart { id, name } => {
                let tool = ToolActivity {
                    id,
                    name: name.clone(),
                    label: live_tool_label(&name),
                    status: ToolActivityStatus::Running,
                    input: Value::Object(serde_json::Map::new()),
                    output: None,
                    started_at: Utc::now(),
                    finished_at: None,
                };
                active_tool = Some(tool.clone());
                upsert_tool(session_id, tool.clone())?;
                set_follow_activity(session_id, &tool.label);
                emit_event(AgentRuntimeEvent::ToolStarted {
                    session_id: session_id.to_string(),
                    tool,
                });
            }
            StreamEvent::ToolInputDelta(fragment) => {
                if let Some(tool) = active_tool.as_mut() {
                    tool.input = json!({ "delta": fragment });
                    upsert_tool(session_id, tool.clone())?;
                }
            }
            StreamEvent::ToolUseEnd => {
                if let Some(mut tool) = active_tool.take() {
                    tool.status = ToolActivityStatus::Completed;
                    tool.finished_at = Some(Utc::now());
                    upsert_tool(session_id, tool.clone())?;
                    emit_event(AgentRuntimeEvent::ToolFinished {
                        session_id: session_id.to_string(),
                        tool,
                    });
                }
            }
            StreamEvent::ToolResult {
                tool_use_id,
                content,
                is_error,
            } => {
                let tool = ToolActivity {
                    id: tool_use_id,
                    name: "provider.tool_result".to_string(),
                    label: if is_error {
                        "Tool failed".to_string()
                    } else {
                        "Tool completed".to_string()
                    },
                    status: if is_error {
                        ToolActivityStatus::Failed
                    } else {
                        ToolActivityStatus::Completed
                    },
                    input: Value::Object(serde_json::Map::new()),
                    output: Some(json!({ "content": content })),
                    started_at: Utc::now(),
                    finished_at: Some(Utc::now()),
                };
                upsert_tool(session_id, tool.clone())?;
                emit_event(AgentRuntimeEvent::ToolFinished {
                    session_id: session_id.to_string(),
                    tool,
                });
            }
            StreamEvent::ConnectionPhase { phase } => {
                set_follow_activity(session_id, &phase.to_string());
            }
            StreamEvent::StatusDetail { detail } => {
                set_follow_activity(session_id, &detail);
            }
            StreamEvent::Error { message, .. } => {
                return Err(AgentError::Provider(message));
            }
            StreamEvent::MessageEnd { .. } => break,
            _ => {}
        }
    }

    finish_turn(session_id, turn_id, TurnStatus::Finished);
    Ok(())
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
        if let Some(message) = session.jcode_messages.last_mut()
            && message.role == Role::Assistant
            && let Some(ContentBlock::Text { text, .. }) = message.content.first_mut()
        {
            text.push_str(delta);
        } else {
            session.jcode_messages.push(Message::assistant_text(delta));
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

fn fail_turn(session_id: &str, turn_id: &str, message: String) {
    let _ = with_session(session_id, |session| {
        session.snapshot.turn_status = TurnStatus::Failed;
        session.snapshot.active_turn_id = None;
        session.snapshot.follow = AgentFollowState {
            running: false,
            activity: None,
        };
        session.snapshot.updated_at = Utc::now();
        session.interrupt = None;
    });
    emit_event(AgentRuntimeEvent::TurnFailed {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        message,
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
    let snapshot = new_snapshot("Lyra Agent".to_string());
    let id = snapshot.id.clone();
    runtime.sessions.insert(
        id.clone(),
        AgentSession {
            snapshot,
            jcode_messages: Vec::new(),
            interrupt: None,
        },
    );
    runtime.active_session_id = Some(id.clone());
    Ok(id)
}

fn new_snapshot(title: String) -> AgentSessionSnapshot {
    AgentSessionSnapshot {
        id: Uuid::new_v4().to_string(),
        title,
        messages: Vec::new(),
        tools: Vec::new(),
        turn_status: TurnStatus::Idle,
        active_turn_id: None,
        follow: AgentFollowState {
            running: false,
            activity: None,
        },
        updated_at: Utc::now(),
    }
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

fn provider_activity(provider_profile_id: Option<&str>) -> String {
    provider_profile_id
        .filter(|value| value.trim().is_empty() == false)
        .map(|value| format!("Streaming via {value}"))
        .unwrap_or_else(|| "Streaming".to_string())
}

fn live_tool_label(name: &str) -> String {
    if name.contains("read") {
        "Reading".to_string()
    } else if name.contains("search") {
        "Searching".to_string()
    } else if name.contains("shell") || name.contains("command") {
        "Running command".to_string()
    } else {
        format!("Running {name}")
    }
}

fn parse_request<T: for<'de> Deserialize<'de>>(payload: &str) -> Result<T, AgentError> {
    serde_json::from_str(payload).map_err(|error| AgentError::BadRequest(error.to_string()))
}

fn encode<T: Serialize>(value: &T) -> Result<String, AgentError> {
    serde_json::to_string(value).map_err(|error| AgentError::Serialization(error.to_string()))
}

#[derive(Clone)]
struct BootstrapProvider;

#[async_trait::async_trait]
impl Provider for BootstrapProvider {
    async fn complete(
        &self,
        _messages: &[Message],
        _tools: &[crate::message::ToolDefinition],
        _system: &str,
        _resume_session_id: Option<&str>,
    ) -> Result<EventStream> {
        let events = vec![
            Ok(StreamEvent::ConnectionPhase {
                phase: crate::message::ConnectionPhase::Streaming,
            }),
            Ok(StreamEvent::TextDelta(
                "Lyra Agent runtime is now using the migrated jcode provider/tool/message contracts. ".to_string(),
            )),
            Ok(StreamEvent::ToolUseStart {
                id: Uuid::new_v4().to_string(),
                name: "search.files".to_string(),
            }),
            Ok(StreamEvent::ToolInputDelta(
                json!({ "query": "Lyra Agent runtime" }).to_string(),
            )),
            Ok(StreamEvent::ToolUseEnd),
            Ok(StreamEvent::TextDelta(
                "The next adapter layer should bind a configured model provider into this Provider trait.".to_string(),
            )),
            Ok(StreamEvent::MessageEnd { stop_reason: None }),
        ];
        Ok(Box::pin(stream::iter(events)))
    }

    fn name(&self) -> &str {
        "lyra-bootstrap"
    }

    fn model(&self) -> String {
        "bootstrap".to_string()
    }

    fn fork(&self) -> Arc<dyn Provider> {
        Arc::new(Self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrated_interrupt_signal_flips() {
        let signal = InterruptSignal::new();
        assert!(!signal.is_set());
        signal.fire();
        assert!(signal.is_set());
        signal.reset();
        assert!(!signal.is_set());
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
    fn provider_turn_emits_events_and_can_cancel() {
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
        thread::sleep(Duration::from_millis(50));

        let captured = events.lock().expect("events").join("\n");
        assert!(captured.contains("messageAppended"));
        assert!(captured.contains("followStateChanged"));
        assert!(captured.contains("turnFinished") || captured.contains("turnFailed"));
        clear_rust_event_callback();
    }
}
