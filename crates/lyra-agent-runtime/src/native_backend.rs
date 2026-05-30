use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::Duration,
};

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use uuid::Uuid;

use crate::{
    AgentRuntimeBackend, AgentRuntimeError, AgentRuntimeResult, EventCallback,
    HostCapabilityDispatcher,
};

#[derive(Clone, Debug, Default)]
pub struct LyraAgentBackend;

struct NativeRuntimeState {
    root: PathBuf,
    sessions: HashMap<String, NativeSession>,
    active_session_id: Option<String>,
    config: NativeConfig,
    shared_memory: Vec<SharedMemoryRecord>,
    overnight_runs: HashMap<String, Value>,
    cancelled_turns: HashSet<String>,
    event_callback: Option<Arc<EventCallback>>,
    host_dispatcher: Option<Arc<HostCapabilityDispatcher>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeStateFile {
    active_session_id: Option<String>,
    config: NativeConfig,
    #[serde(default)]
    shared_memory: Vec<SharedMemoryRecord>,
    #[serde(default)]
    overnight_runs: HashMap<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeSession {
    id: String,
    snapshot: Value,
    created_at: String,
    saved: bool,
    save_label: Option<String>,
    archived: bool,
    custom_title: Option<String>,
    short_name: Option<String>,
    runtime_turns: Vec<Value>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeConfig {
    default_provider: Option<String>,
    default_model: Option<String>,
    reasoning_effort: Option<String>,
    service_tier: Option<String>,
    #[serde(default)]
    providers: HashMap<String, NativeProviderProfile>,
    #[serde(default)]
    roles: HashMap<String, String>,
    #[serde(default)]
    accounts: Vec<NativeAccount>,
    #[serde(default)]
    notifications: Map<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeProviderProfile {
    id: String,
    label: String,
    provider_type: String,
    base_url: Option<String>,
    default_model: Option<String>,
    api_key: Option<String>,
    api_key_env: Option<String>,
    auth_header: Option<String>,
    #[serde(default)]
    models: Vec<NativeProviderModel>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeProviderModel {
    id: String,
    label: Option<String>,
    context_window: Option<usize>,
    supports_image_input: bool,
    supports_tool_calling: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeAccount {
    provider: String,
    label: String,
    kind: String,
    active: bool,
    configured: bool,
    detail: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedMemoryRecord {
    id: String,
    scope: String,
    content: Value,
    created_at: String,
    updated_at: String,
    status: String,
}

static STATE: OnceLock<Mutex<NativeRuntimeState>> = OnceLock::new();

impl AgentRuntimeBackend for LyraAgentBackend {
    fn call_agent_method(&self, method: &str, payload: Value) -> AgentRuntimeResult<Value> {
        match method {
            "agent.session.create" => create_session(payload),
            "agent.session.read" => read_session(payload),
            "agent.session.list" => list_sessions(payload),
            "agent.session.save" => set_saved(payload, true),
            "agent.session.unsave" => set_saved(payload, false),
            "agent.session.rename" => rename_session(payload),
            "agent.session.archive" => archive_session(payload),
            "agent.session.delete" => delete_session(payload),
            "agent.session.bindProject" => bind_project(payload),
            "agent.session.split" => fork_session(payload, "Split Session"),
            "agent.session.transfer" => fork_session(payload, "Transferred Session"),
            "agent.session.compact" => compact_session(payload),
            "agent.session.automation.update" => update_automation(payload),
            "agent.turn.send" | "agent.turn.start" | "agent.turn.resume" | "agent.turn.retry" => {
                send_turn(payload)
            }
            "agent.turn.cancel" => cancel_turn(payload),
            "agent.selfdev.start" => start_selfdev(payload),
            "agent.selfdev.status" => selfdev_status(payload),
            "agent.selfdev.sendTurn" => send_turn(payload),
            "agent.memory.snapshot" => memory_snapshot(payload),
            "agent.memory.audit" => memory_audit(payload),
            "agent.memory.trim.run" => Ok(json!({ "trimmed": false, "reason": "noTrimNeeded" })),
            "agent.memory.recover.run" => Ok(json!({ "recovered": true })),
            "agent.memory.shared.search" => shared_memory_search(payload),
            "agent.memory.shared.update" => shared_memory_update(payload),
            "agent.rollback.preview" => rollback_preview(payload),
            "agent.rollback.restore" => rollback_restore(payload),
            "agent.permission.respond" => respond_permission(payload),
            "agent.clarification.respond" => respond_clarification(payload),
            "agent.config.read" => read_config(),
            "agent.config.update" => update_config(payload),
            "agent.provider.profile.save" => save_provider_profile(payload),
            "agent.provider.options.update" => update_provider_options(payload),
            "agent.models.list" => list_models(payload),
            "agent.models.switch" => switch_model(payload),
            "agent.models.refresh" => list_models(payload),
            "agent.roles.update" => update_roles(payload),
            "agent.accounts.list" => list_accounts(),
            "agent.accounts.login" => login_account(payload),
            "agent.accounts.loginProviders" => login_providers(),
            "agent.accounts.loginStart" => start_account_login(payload),
            "agent.accounts.loginComplete" => complete_account_login(payload),
            "agent.accounts.switch" => switch_account(payload),
            "agent.accounts.remove" => remove_account(payload),
            "agent.action.improve" => action_turn(payload, "Improve the current work."),
            "agent.action.refactor" => action_turn(payload, "Refactor the current work."),
            "agent.action.review" => action_turn(payload, "Review the current work."),
            "agent.action.judge" => action_turn(payload, "Judge the current result."),
            "agent.action.poke" => poke_session(payload),
            "agent.subagent.run" => run_subagent(payload),
            "agent.btw.run" => run_btw(payload),
            "agent.goals.list" | "agent.goals.open" | "agent.goals.resume" | "agent.goals.show" => {
                goals(payload)
            }
            "agent.overnight.start" => start_overnight(payload),
            "agent.overnight.list" => list_overnight(),
            "agent.overnight.status" | "agent.overnight.log" | "agent.overnight.review" => {
                read_overnight(payload)
            }
            "agent.overnight.cancel" => cancel_overnight(payload),
            _ => Err(AgentRuntimeError::UnknownMethod(method.to_string())),
        }
    }

    fn register_event_callback(&self, callback: Arc<EventCallback>) {
        if let Ok(mut state) = state().lock() {
            state.event_callback = Some(callback);
        }
    }

    fn clear_event_callback(&self) {
        if let Ok(mut state) = state().lock() {
            state.event_callback = None;
        }
    }

    fn register_host_capability_dispatcher(&self, dispatcher: Arc<HostCapabilityDispatcher>) {
        if let Ok(mut state) = state().lock() {
            state.host_dispatcher = Some(dispatcher);
        }
    }

    fn clear_host_capability_dispatcher(&self) {
        if let Ok(mut state) = state().lock() {
            state.host_dispatcher = None;
        }
    }

    fn call_host_capability(&self, method: &str, payload: Value) -> Result<Value, String> {
        let dispatcher = state()
            .lock()
            .ok()
            .and_then(|state| state.host_dispatcher.clone())
            .ok_or_else(|| "No host capability dispatcher registered".to_string())?;
        let payload = serde_json::to_string(&payload)
            .map_err(|error| format!("Failed to serialize host capability payload: {error}"))?;
        let output = dispatcher(method.to_string(), payload)?;
        serde_json::from_str(&output)
            .map_err(|error| format!("Failed to deserialize host capability output: {error}"))
    }
}

fn state() -> &'static Mutex<NativeRuntimeState> {
    STATE.get_or_init(|| Mutex::new(NativeRuntimeState::load()))
}

impl NativeRuntimeState {
    fn load() -> Self {
        let root = runtime_root();
        let sessions_dir = root.join("sessions");
        let _ = fs::create_dir_all(&sessions_dir);

        let state_file = read_json::<NativeStateFile>(&root.join("state.json"));
        let mut config = state_file
            .as_ref()
            .map(|state| state.config.clone())
            .unwrap_or_default();
        install_default_providers(&mut config);

        let mut sessions = HashMap::new();
        if let Ok(entries) = fs::read_dir(&sessions_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|value| value.to_str()) != Some("json") {
                    continue;
                }
                if let Some(session) = read_json::<NativeSession>(&path) {
                    sessions.insert(session.id.clone(), session);
                }
            }
        }

        Self {
            root,
            sessions,
            active_session_id: state_file
                .as_ref()
                .and_then(|state| state.active_session_id.clone()),
            config,
            shared_memory: state_file
                .as_ref()
                .map(|state| state.shared_memory.clone())
                .unwrap_or_default(),
            overnight_runs: state_file
                .map(|state| state.overnight_runs)
                .unwrap_or_default(),
            cancelled_turns: HashSet::new(),
            event_callback: None,
            host_dispatcher: None,
        }
    }

    fn save_state(&self) -> AgentRuntimeResult<()> {
        fs::create_dir_all(self.root.join("sessions"))
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        let state = NativeStateFile {
            active_session_id: self.active_session_id.clone(),
            config: self.config.clone(),
            shared_memory: self.shared_memory.clone(),
            overnight_runs: self.overnight_runs.clone(),
        };
        write_json(&self.root.join("state.json"), &state)?;
        for session in self.sessions.values() {
            write_json(&self.session_path(&session.id), session)?;
        }
        Ok(())
    }

    fn session_path(&self, session_id: &str) -> PathBuf {
        self.root
            .join("sessions")
            .join(format!("{session_id}.json"))
    }

    fn resolve_session_id(&mut self, requested: Option<String>) -> AgentRuntimeResult<String> {
        if let Some(id) = requested.filter(|value| !value.trim().is_empty()) {
            if id == "active" {
                return self.ensure_active_session();
            }
            if self.sessions.contains_key(&id) {
                self.active_session_id = Some(id.clone());
                return Ok(id);
            }
            return Err(AgentRuntimeError::Core(format!("session not found: {id}")));
        }
        self.ensure_active_session()
    }

    fn ensure_active_session(&mut self) -> AgentRuntimeResult<String> {
        if let Some(id) = self.active_session_id.clone()
            && self.sessions.contains_key(&id)
        {
            return Ok(id);
        }
        let session = new_session(None, None, "normal");
        let id = session.id.clone();
        self.sessions.insert(id.clone(), session);
        self.active_session_id = Some(id.clone());
        self.save_state()?;
        Ok(id)
    }
}

fn runtime_root() -> PathBuf {
    if let Some(path) = env::var_os("LYRA_AGENT_RUNTIME_HOME") {
        return PathBuf::from(path);
    }
    if cfg!(test) {
        return env::temp_dir()
            .join("lyra-agent-runtime-tests")
            .join(std::process::id().to_string());
    }
    if let Some(path) = env::var_os("LYRA_AGENT_HOME") {
        return PathBuf::from(path).join("agent-runtime");
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".lyra")
        .join("modules")
        .join("agent-runtime")
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> AgentRuntimeResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    }
    let data = serde_json::to_vec_pretty(value)
        .map_err(|error| AgentRuntimeError::Serialization(error.to_string()))?;
    fs::write(path, data).map_err(|error| AgentRuntimeError::Core(error.to_string()))
}

fn install_default_providers(config: &mut NativeConfig) {
    if config.default_provider.is_none() {
        config.default_provider = Some("openai".to_string());
    }
    if config.default_model.is_none() {
        config.default_model = env::var("OPENAI_MODEL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| Some("gpt-4.1-mini".to_string()));
    }
    let openai_key = env::var("OPENAI_API_KEY").ok();
    config
        .providers
        .entry("openai".to_string())
        .or_insert_with(|| NativeProviderProfile {
            id: "openai".to_string(),
            label: "OpenAI".to_string(),
            provider_type: "openai-compatible".to_string(),
            base_url: env::var("OPENAI_BASE_URL")
                .ok()
                .or_else(|| Some("https://api.openai.com/v1".to_string())),
            default_model: config.default_model.clone(),
            api_key: openai_key,
            api_key_env: Some("OPENAI_API_KEY".to_string()),
            auth_header: None,
            models: vec![NativeProviderModel {
                id: config
                    .default_model
                    .clone()
                    .unwrap_or_else(|| "gpt-4.1-mini".to_string()),
                label: None,
                context_window: None,
                supports_image_input: true,
                supports_tool_calling: true,
            }],
        });
    config
        .providers
        .entry("openrouter".to_string())
        .or_insert_with(|| NativeProviderProfile {
            id: "openrouter".to_string(),
            label: "OpenRouter".to_string(),
            provider_type: "openrouter".to_string(),
            base_url: env::var("OPENROUTER_BASE_URL")
                .ok()
                .or_else(|| Some("https://openrouter.ai/api/v1".to_string())),
            default_model: env::var("OPENROUTER_MODEL").ok(),
            api_key: env::var("OPENROUTER_API_KEY").ok(),
            api_key_env: Some("OPENROUTER_API_KEY".to_string()),
            auth_header: None,
            models: Vec::new(),
        });
    config
        .providers
        .entry("mimo-token-plan".to_string())
        .or_insert_with(|| NativeProviderProfile {
            id: "mimo-token-plan".to_string(),
            label: "MiMo Token Plan".to_string(),
            provider_type: "openai-compatible".to_string(),
            base_url: env::var("MIMO_BASE_URL").ok(),
            default_model: env::var("MIMO_MODEL")
                .ok()
                .or_else(|| Some("mimo-v2.5-pro".to_string())),
            api_key: env::var("MIMO_API_KEY").ok(),
            api_key_env: Some("MIMO_API_KEY".to_string()),
            auth_header: None,
            models: vec![NativeProviderModel {
                id: "mimo-v2.5-pro".to_string(),
                label: Some("MiMo v2.5 Pro".to_string()),
                context_window: None,
                supports_image_input: true,
                supports_tool_calling: true,
            }],
        });
}

fn create_session(payload: Value) -> AgentRuntimeResult<Value> {
    let title = string_opt(&payload, "title");
    let working_dir = string_opt(&payload, "workingDir");
    let session = new_session(title, working_dir, "normal");
    let snapshot = session.snapshot.clone();
    let callback = {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        state.active_session_id = Some(session.id.clone());
        state.sessions.insert(session.id.clone(), session);
        state.save_state()?;
        state.event_callback.clone()
    };
    emit_with_callback(
        &callback,
        json!({ "kind": "sessionSnapshot", "snapshot": snapshot }),
    );
    Ok(snapshot)
}

fn new_session(title: Option<String>, working_dir: Option<String>, kind: &str) -> NativeSession {
    let id = format!("session-{}", Uuid::new_v4());
    let created_at = now();
    let title = title
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Lyra Agent".to_string());
    let working_dir = working_dir.unwrap_or_else(current_working_dir);
    let snapshot = json!({
        "id": id,
        "title": title,
        "sessionKind": kind,
        "workingDir": working_dir,
        "projectBound": true,
        "messages": [],
        "tools": [],
        "todos": [],
        "automation": {
            "subagentModel": Value::Null,
            "autoreviewEnabled": Value::Null,
            "autojudgeEnabled": Value::Null
        },
        "sidePanel": empty_side_panel(),
        "turnStatus": "idle",
        "activeTurnId": Value::Null,
        "follow": { "running": false, "activity": Value::Null },
        "updatedAt": created_at,
        "memory": Value::Null
    });
    NativeSession {
        id,
        snapshot,
        created_at,
        saved: false,
        save_label: None,
        archived: false,
        custom_title: None,
        short_name: None,
        runtime_turns: Vec::new(),
    }
}

fn current_working_dir() -> String {
    env::current_dir()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| ".".to_string())
}

fn read_session(payload: Value) -> AgentRuntimeResult<Value> {
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let id = state.resolve_session_id(string_opt(&payload, "sessionId"))?;
    let snapshot = state
        .sessions
        .get(&id)
        .map(|session| session.snapshot.clone())
        .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {id}")))?;
    state.save_state()?;
    Ok(snapshot)
}

fn list_sessions(payload: Value) -> AgentRuntimeResult<Value> {
    let limit = payload
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(100)
        .min(500) as usize;
    let state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let mut sessions = state
        .sessions
        .values()
        .filter(|session| !is_deleted(&session.snapshot))
        .map(session_summary)
        .collect::<Vec<_>>();
    sessions.sort_by(|left, right| {
        right
            .get("updatedAt")
            .and_then(Value::as_str)
            .cmp(&left.get("updatedAt").and_then(Value::as_str))
    });
    sessions.truncate(limit);
    Ok(json!({
        "sessionsDir": state.root.join("sessions").display().to_string(),
        "sessions": sessions,
    }))
}

fn set_saved(payload: Value, saved: bool) -> AgentRuntimeResult<Value> {
    let id = required_session_id(&payload)?;
    mutate_session(&id, |session| {
        session.saved = saved;
        session.save_label = if saved {
            string_opt(&payload, "label").or_else(|| Some("Saved".to_string()))
        } else {
            None
        };
        session.archived = false;
        touch_snapshot(&mut session.snapshot);
        Ok(session_summary(session))
    })
}

fn rename_session(payload: Value) -> AgentRuntimeResult<Value> {
    let id = required_session_id(&payload)?;
    let title = string_opt(&payload, "title").unwrap_or_else(|| "Lyra Agent".to_string());
    mutate_session(&id, |session| {
        session.custom_title = Some(title.clone());
        set_string(&mut session.snapshot, "title", title);
        touch_snapshot(&mut session.snapshot);
        Ok(session_summary(session))
    })
}

fn archive_session(payload: Value) -> AgentRuntimeResult<Value> {
    let id = required_session_id(&payload)?;
    let archived = payload
        .get("archived")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    mutate_session(&id, |session| {
        session.archived = archived;
        touch_snapshot(&mut session.snapshot);
        Ok(session_summary(session))
    })
}

fn delete_session(payload: Value) -> AgentRuntimeResult<Value> {
    let id = required_session_id(&payload)?;
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    state.sessions.remove(&id);
    if state.active_session_id.as_deref() == Some(&id) {
        state.active_session_id = None;
    }
    let _ = fs::remove_file(state.session_path(&id));
    state.save_state()?;
    Ok(json!({ "sessionId": id, "deleted": true }))
}

fn bind_project(payload: Value) -> AgentRuntimeResult<Value> {
    let id = payload
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let working_dir = string_opt(&payload, "workingDir").unwrap_or_else(current_working_dir);
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let id = state.resolve_session_id(id)?;
    let session = state
        .sessions
        .get_mut(&id)
        .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {id}")))?;
    set_string(&mut session.snapshot, "workingDir", working_dir);
    set_bool(&mut session.snapshot, "projectBound", true);
    touch_snapshot(&mut session.snapshot);
    let snapshot = session.snapshot.clone();
    state.save_state()?;
    Ok(snapshot)
}

fn fork_session(payload: Value, label: &str) -> AgentRuntimeResult<Value> {
    let parent_id = string_opt(&payload, "sessionId");
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let parent_id = state.resolve_session_id(parent_id)?;
    let parent = state
        .sessions
        .get(&parent_id)
        .cloned()
        .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {parent_id}")))?;
    let mut child = new_session(
        Some(format!(
            "{} - {label}",
            parent
                .snapshot
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("Lyra Agent")
        )),
        parent
            .snapshot
            .get("workingDir")
            .and_then(Value::as_str)
            .map(str::to_string),
        parent
            .snapshot
            .get("sessionKind")
            .and_then(Value::as_str)
            .unwrap_or("normal"),
    );
    if let Some(messages) = parent.snapshot.get("messages").cloned() {
        child.snapshot["messages"] = messages;
    }
    let snapshot = child.snapshot.clone();
    let child_id = child.id.clone();
    state.active_session_id = Some(child_id.clone());
    state.sessions.insert(child_id.clone(), child);
    state.save_state()?;
    Ok(json!({
        "sessionId": child_id,
        "parentSessionId": parent_id,
        "snapshot": snapshot,
    }))
}

fn compact_session(payload: Value) -> AgentRuntimeResult<Value> {
    let id = string_opt(&payload, "sessionId");
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let id = state.resolve_session_id(id)?;
    let snapshot = state
        .sessions
        .get(&id)
        .map(|session| session.snapshot.clone())
        .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {id}")))?;
    Ok(json!({
        "sessionId": id,
        "message": "Session context is already represented by structured Lyra memory.",
        "success": true,
        "snapshot": snapshot,
    }))
}

fn update_automation(payload: Value) -> AgentRuntimeResult<Value> {
    let id = string_opt(&payload, "sessionId");
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let id = state.resolve_session_id(id)?;
    let session = state
        .sessions
        .get_mut(&id)
        .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {id}")))?;
    let automation = session
        .snapshot
        .get_mut("automation")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            AgentRuntimeError::Core("session automation state is invalid".to_string())
        })?;
    for key in ["subagentModel", "autoreviewEnabled", "autojudgeEnabled"] {
        if let Some(value) = payload.get(key) {
            automation.insert(key.to_string(), value.clone());
        }
    }
    touch_snapshot(&mut session.snapshot);
    let snapshot = session.snapshot.clone();
    let automation = snapshot
        .get("automation")
        .cloned()
        .unwrap_or_else(|| json!({}));
    state.save_state()?;
    Ok(json!({ "sessionId": id, "automation": automation, "snapshot": snapshot }))
}

fn send_turn(payload: Value) -> AgentRuntimeResult<Value> {
    let text = string_opt(&payload, "text")
        .or_else(|| string_opt(&payload, "prompt"))
        .unwrap_or_default();
    let images = payload
        .get("images")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let requested_session = string_opt(&payload, "sessionId");
    let now = now();
    let turn_id = format!("turn-{}", Uuid::new_v4());
    let user_message = user_message(text.clone(), images, now.clone());

    let (session_id, callback, snapshot) = {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let session_id = state.resolve_session_id(requested_session)?;
        let session = state
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {session_id}")))?;
        if session.snapshot["turnStatus"] == "running" {
            session.snapshot["turnStatus"] = Value::String("cancelled".to_string());
            session.snapshot["activeTurnId"] = Value::Null;
        }
        push_array(&mut session.snapshot, "messages", user_message.clone());
        session.snapshot["turnStatus"] = Value::String("running".to_string());
        session.snapshot["activeTurnId"] = Value::String(turn_id.clone());
        session.snapshot["follow"] = json!({ "running": true, "activity": "Calling model" });
        touch_snapshot(&mut session.snapshot);
        session
            .runtime_turns
            .push(runtime_turn(&turn_id, &session_id, "calling_model", None));
        let snapshot = session.snapshot.clone();
        let callback = state.event_callback.clone();
        state.save_state()?;
        (session_id, callback, snapshot)
    };

    emit_with_callback(
        &callback,
        json!({ "kind": "messageCommitted", "sessionId": session_id, "message": user_message }),
    );
    emit_with_callback(
        &callback,
        json!({ "kind": "turnStarted", "sessionId": session_id, "turnId": turn_id, "state": "calling_model" }),
    );
    emit_with_callback(
        &callback,
        json!({ "kind": "turnStateChanged", "sessionId": session_id, "turnId": turn_id, "state": "calling_model", "reason": "native_turn_started" }),
    );
    emit_with_callback(
        &callback,
        json!({ "kind": "sessionSnapshot", "snapshot": snapshot }),
    );

    let thread_session_id = session_id.clone();
    let thread_turn_id = turn_id.clone();
    thread::spawn(move || run_native_turn(thread_session_id, thread_turn_id));

    Ok(json!({ "sessionId": session_id, "turnId": turn_id, "status": "running" }))
}

fn run_native_turn(session_id: String, turn_id: String) {
    let model_result = build_model_request(&session_id).and_then(|request| {
        run_model_loop(&session_id, &turn_id, request).or_else(|error| Ok(fallback_response(error)))
    });
    thread::sleep(Duration::from_millis(25));

    if turn_was_cancelled(&session_id, &turn_id) {
        finish_turn(
            &session_id,
            &turn_id,
            "cancelled",
            None,
            Some("turn cancelled".to_string()),
        );
        return;
    }

    match model_result {
        Ok(text) => finish_turn(&session_id, &turn_id, "finished", Some(text), None),
        Err(error) => finish_turn(
            &session_id,
            &turn_id,
            "failed",
            None,
            Some(error.to_string()),
        ),
    }
}

fn build_model_request(session_id: &str) -> AgentRuntimeResult<ModelRequest> {
    let (provider, model, session_messages, host_dispatcher, memory_records) = {
        let state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let session = state
            .sessions
            .get(session_id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {session_id}")))?;
        let provider_id = state
            .config
            .default_provider
            .clone()
            .unwrap_or_else(|| "openai".to_string());
        let provider = state
            .config
            .providers
            .get(&provider_id)
            .cloned()
            .ok_or_else(|| {
                AgentRuntimeError::Core(format!("provider not configured: {provider_id}"))
            })?;
        let model = provider
            .default_model
            .clone()
            .or_else(|| state.config.default_model.clone())
            .unwrap_or_else(|| "gpt-4.1-mini".to_string());
        let session_messages = session
            .snapshot
            .get("messages")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        (
            provider,
            model,
            session_messages,
            state.host_dispatcher.clone(),
            state.shared_memory.clone(),
        )
    };
    let runtime_context = build_runtime_context(host_dispatcher.as_ref(), &memory_records);
    let mut messages = vec![json!({
        "role": "system",
        "content": build_system_prompt(&runtime_context),
    })];
    messages.extend(session_messages.iter().filter_map(|message| {
        let role = message.get("role").and_then(Value::as_str)?;
        let content = message.get("text").and_then(Value::as_str)?;
        if content.trim().is_empty() || role == "tool" {
            return None;
        }
        Some(json!({ "role": role, "content": content }))
    }));
    Ok(ModelRequest {
        provider,
        model,
        messages,
        tools: model_tools(),
        host_dispatcher,
    })
}

#[derive(Clone)]
struct ModelRequest {
    provider: NativeProviderProfile,
    model: String,
    messages: Vec<Value>,
    tools: Vec<Value>,
    host_dispatcher: Option<Arc<HostCapabilityDispatcher>>,
}

#[derive(Clone, Debug)]
struct ModelReply {
    content: Option<String>,
    tool_calls: Vec<ModelToolCall>,
}

#[derive(Clone, Debug)]
struct ModelToolCall {
    id: String,
    name: String,
    arguments: Value,
}

fn run_model_loop(
    session_id: &str,
    turn_id: &str,
    request: ModelRequest,
) -> AgentRuntimeResult<String> {
    let mut messages = request.messages;
    for _ in 0..5 {
        let reply = call_model_once(&request.provider, &request.model, &messages, &request.tools)?;
        if reply.tool_calls.is_empty() {
            return Ok(reply.content.unwrap_or_default());
        }

        let assistant_tool_calls = reply
            .tool_calls
            .iter()
            .map(|call| {
                json!({
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": call.name,
                        "arguments": serde_json::to_string(&call.arguments).unwrap_or_else(|_| "{}".to_string())
                    }
                })
            })
            .collect::<Vec<_>>();
        messages.push(json!({
            "role": "assistant",
            "content": reply.content.unwrap_or_default(),
            "tool_calls": assistant_tool_calls,
        }));

        for call in reply.tool_calls {
            if turn_was_cancelled(session_id, turn_id) {
                return Err(AgentRuntimeError::Core("turn cancelled".to_string()));
            }
            let output =
                execute_model_tool(session_id, turn_id, &request.host_dispatcher, call.clone());
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call.id,
                "content": tool_result_content(&output),
            }));
        }
    }

    Ok("我已经连续调用了多轮 Lyra 工具，但还没有得到可完成本轮任务的最终答案。请再发一句更具体的指令，我会继续基于当前工具结果处理。".to_string())
}

fn call_model_once(
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
) -> AgentRuntimeResult<ModelReply> {
    let base_url = provider
        .base_url
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            AgentRuntimeError::Core("provider base URL is not configured".to_string())
        })?;
    let api_key = provider
        .api_key
        .clone()
        .or_else(|| {
            provider
                .api_key_env
                .as_ref()
                .and_then(|key| env::var(key).ok())
        })
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            AgentRuntimeError::Core(format!(
                "API key is not configured for provider {}",
                provider.label
            ))
        })?;
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let mut body = json!({
        "model": model,
        "messages": messages,
        "stream": false,
    });
    if !tools.is_empty() {
        body["tools"] = Value::Array(tools.to_vec());
        body["tool_choice"] = Value::String("auto".to_string());
    }
    let response = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?
        .post(url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let status = response.status();
    let body: Value = response
        .json()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    if !status.is_success() {
        return Err(AgentRuntimeError::Core(format!(
            "provider request failed with status {status}: {body}"
        )));
    }
    let message = body.pointer("/choices/0/message").ok_or_else(|| {
        AgentRuntimeError::Core("provider returned no assistant message".to_string())
    })?;
    let content = model_message_content(message.get("content"));
    let tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(parse_model_tool_call)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if content.as_ref().is_none_or(|value| value.trim().is_empty()) && tool_calls.is_empty() {
        return Err(AgentRuntimeError::Core(
            "provider returned no assistant text or tool call".to_string(),
        ));
    }
    Ok(ModelReply {
        content,
        tool_calls,
    })
}

fn model_message_content(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(text)) => Some(text.clone()),
        Some(Value::Array(parts)) => {
            let text = parts
                .iter()
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("");
            (!text.trim().is_empty()).then_some(text)
        }
        _ => None,
    }
}

fn parse_model_tool_call(value: &Value) -> Option<ModelToolCall> {
    let function = value.get("function")?;
    let name = function.get("name").and_then(Value::as_str)?.to_string();
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("tool-{}", Uuid::new_v4()));
    let arguments = match function.get("arguments") {
        Some(Value::String(text)) => serde_json::from_str(text).unwrap_or_else(|_| json!({})),
        Some(value) => value.clone(),
        None => json!({}),
    };
    Some(ModelToolCall {
        id,
        name,
        arguments,
    })
}

fn build_runtime_context(
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
    memory_records: &[SharedMemoryRecord],
) -> Value {
    let workbench = dispatcher
        .and_then(|dispatcher| {
            invoke_host_capability(
                dispatcher,
                "workbench.listTabs",
                json!({ "scope": "all", "includeUnsupported": true }),
            )
            .ok()
        })
        .unwrap_or_else(|| {
            json!({
                "hostCapabilityAvailable": false,
                "message": "Workbench observation bridge is not available."
            })
        });
    let software = dispatcher
        .and_then(|dispatcher| {
            invoke_host_capability(
                dispatcher,
                "software.listCapabilities",
                json!({ "includeSchemas": false }),
            )
            .ok()
        })
        .unwrap_or_else(|| {
            json!({
                "hostCapabilityAvailable": false,
                "software": [],
                "message": "Software capability bridge is not available."
            })
        });
    let memory = memory_records
        .iter()
        .rev()
        .take(12)
        .map(|record| {
            json!({
                "scope": record.scope,
                "status": record.status,
                "content": record.content,
                "updatedAt": record.updated_at,
            })
        })
        .collect::<Vec<_>>();
    json!({
        "identity": "Lyra Agent",
        "workbench": workbench,
        "software": software,
        "memory": memory,
        "tools": model_tool_names(),
    })
}

fn build_system_prompt(runtime_context: &Value) -> String {
    format!(
        r#"You are Lyra Agent, the agent inside the Lyra desktop workbench.

Hard rules:
- Identify yourself as Lyra Agent. Never identify as the base model, MiMo, OpenAI, or any provider brand.
- You are not a plain text assistant. You can observe and operate Lyra workbench tabs, browser pages, files, terminal views, images, and installed Lyra software through tools.
- If the user asks about currently open tabs, the active page, visible workspace, browser contents, or Lyra software state, use the workbench or Lumen tools before answering unless the runtime context already contains the exact fact.
- If the user asks you to remember a stable preference, name, identity, project fact, or durable instruction, call memory_remember before confirming.
- If the user asks whether you remember something, use current memory from context and call memory_search when the context is insufficient.
- Do not say you cannot access the browser or screen when a Lyra tool can provide that state. If a host capability is unavailable, say which Lyra capability is unavailable and what you tried.
- Keep responses in the user's language. The user is currently using Chinese, so answer in Chinese by default.
- Use concise, factual answers. Do not expose raw JSON unless it helps debugging.
- Prior assistant messages in this session may have been generated before Lyra runtime capabilities were injected. Treat any claim that the assistant is only a pure text chatbot as stale and incorrect.

Current Lyra runtime context:
{}"#,
        serde_json::to_string_pretty(runtime_context).unwrap_or_else(|_| "{}".to_string())
    )
}

fn model_tools() -> Vec<Value> {
    vec![
        function_tool(
            "memory_search",
            "Search Lyra long-term shared memory.",
            json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string" }
                },
                "required": ["query"]
            }),
        ),
        function_tool(
            "memory_remember",
            "Write a durable fact, user preference, name, identity, or project instruction to Lyra long-term memory.",
            json!({
                "type": "object",
                "properties": {
                    "scope": { "type": "string", "default": "global" },
                    "fact": { "type": "string" },
                    "category": { "type": "string", "enum": ["user_profile", "preference", "project", "instruction", "other"], "default": "other" }
                },
                "required": ["fact"]
            }),
        ),
        function_tool(
            "workbench_list_tabs",
            "List Lyra workbench tabs, including browser, file, image, terminal, and other app tabs.",
            json!({
                "type": "object",
                "properties": {
                    "scope": { "type": "string", "enum": ["all", "visible", "active"], "default": "all" },
                    "includeUnsupported": { "type": "boolean", "default": true }
                }
            }),
        ),
        function_tool(
            "workbench_read_workspace",
            "Read the currently visible Lyra workspace state.",
            json!({
                "type": "object",
                "properties": {
                    "detail": { "type": "string", "enum": ["summary", "full"], "default": "summary" }
                }
            }),
        ),
        function_tool(
            "workbench_read_tab",
            "Read one Lyra workbench tab by id. Use this for non-browser app tabs or tab summaries.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "detail": { "type": "string", "enum": ["summary", "full"], "default": "summary" }
                },
                "required": ["tabId"]
            }),
        ),
        function_tool(
            "workbench_activate_tab",
            "Activate a Lyra workbench tab by id.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" }
                },
                "required": ["tabId"]
            }),
        ),
        function_tool(
            "software_list_capabilities",
            "List installed Lyra software adapters and their lightweight capabilities.",
            json!({
                "type": "object",
                "properties": {
                    "includeSchemas": { "type": "boolean", "default": false }
                }
            }),
        ),
        function_tool(
            "software_invoke_capability",
            "Invoke a Lyra software adapter capability when the task requires an installed app.",
            json!({
                "type": "object",
                "properties": {
                    "softwareId": { "type": "string" },
                    "capabilityId": { "type": "string" },
                    "input": { "type": "object" }
                },
                "required": ["softwareId", "capabilityId"]
            }),
        ),
        function_tool(
            "lyra_lumen_map",
            "Map actionable elements on a Lyra browser page using selectors, focus scan, and weak DOM.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" },
                    "strategy": { "type": "string", "enum": ["picker", "focus", "hybrid", "domFallback"], "default": "picker" },
                    "timeoutMs": { "type": "number" }
                }
            }),
        ),
        function_tool(
            "lyra_lumen_read",
            "Read text from a Lyra browser page without relying on screenshot OCR.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" },
                    "strategy": { "type": "string", "enum": ["focus", "hybrid", "domFallback"], "default": "focus" },
                    "maxChars": { "type": "number" }
                }
            }),
        ),
        function_tool(
            "lyra_lumen_act",
            "Click, double-click, right-click, or hover an element or point on a Lyra browser page.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" },
                    "elementId": { "type": "number" },
                    "point": {
                        "type": "object",
                        "properties": {
                            "x": { "type": "number" },
                            "y": { "type": "number" },
                            "reason": { "type": "string" }
                        }
                    },
                    "interaction": { "type": "string", "enum": ["click", "doubleClick", "rightClick", "hover"], "default": "click" },
                    "timeoutMs": { "type": "number" }
                }
            }),
        ),
        function_tool(
            "lyra_lumen_type",
            "Type text into the focused or selected browser element.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" },
                    "elementId": { "type": "number" },
                    "text": { "type": "string" },
                    "clear": { "type": "boolean", "default": false },
                    "timeoutMs": { "type": "number" }
                },
                "required": ["text"]
            }),
        ),
        function_tool(
            "lyra_lumen_press",
            "Press a keyboard key in the Lyra browser agent page.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" },
                    "elementId": { "type": "number" },
                    "key": { "type": "string" },
                    "timeoutMs": { "type": "number" }
                },
                "required": ["key"]
            }),
        ),
        function_tool(
            "lyra_lumen_wait",
            "Wait for browser page loading, text changes, text stability, or text containment.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" },
                    "until": { "type": "string", "enum": ["loadIdle", "textChanged", "textStable", "textContains"], "default": "textStable" },
                    "text": { "type": "string" },
                    "timeoutMs": { "type": "number" },
                    "idleMs": { "type": "number" },
                    "maxChars": { "type": "number" }
                }
            }),
        ),
        function_tool(
            "lyra_lumen_navigate",
            "Navigate a Lyra browser page.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "url": { "type": "string" },
                    "newTab": { "type": "boolean", "default": false },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" },
                    "timeoutMs": { "type": "number" }
                },
                "required": ["url"]
            }),
        ),
        function_tool(
            "lyra_lumen_reveal",
            "Hover or otherwise reveal hidden browser elements, then return newly exposed actions.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" },
                    "elementId": { "type": "number" },
                    "point": { "type": "object" },
                    "interaction": { "type": "string", "enum": ["hover", "click"], "default": "hover" },
                    "idleMs": { "type": "number" },
                    "timeoutMs": { "type": "number" }
                }
            }),
        ),
        function_tool(
            "lyra_lumen_focus_scan",
            "Use focus navigation to scan focusable elements on a Lyra browser page.",
            json!({
                "type": "object",
                "properties": {
                    "tabId": { "type": "string" },
                    "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" },
                    "direction": { "type": "string", "enum": ["scan", "next", "previous"], "default": "scan" },
                    "steps": { "type": "number" },
                    "restoreFocus": { "type": "boolean" },
                    "timeoutMs": { "type": "number" }
                }
            }),
        ),
    ]
}

fn function_tool(name: &str, description: &str, parameters: Value) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": with_additional_properties(parameters),
        }
    })
}

fn with_additional_properties(mut schema: Value) -> Value {
    if let Some(object) = schema.as_object_mut() {
        object
            .entry("additionalProperties")
            .or_insert(Value::Bool(false));
    }
    schema
}

fn model_tool_names() -> Vec<&'static str> {
    vec![
        "memory_search",
        "memory_remember",
        "workbench_list_tabs",
        "workbench_read_workspace",
        "workbench_read_tab",
        "workbench_activate_tab",
        "software_list_capabilities",
        "software_invoke_capability",
        "lyra_lumen_map",
        "lyra_lumen_read",
        "lyra_lumen_act",
        "lyra_lumen_type",
        "lyra_lumen_press",
        "lyra_lumen_wait",
        "lyra_lumen_navigate",
        "lyra_lumen_reveal",
        "lyra_lumen_focus_scan",
    ]
}

fn execute_model_tool(
    session_id: &str,
    turn_id: &str,
    dispatcher: &Option<Arc<HostCapabilityDispatcher>>,
    call: ModelToolCall,
) -> Value {
    let started_at = now();
    if matches!(call.name.as_str(), "memory_search" | "memory_remember") {
        return execute_memory_tool(session_id, turn_id, call, &started_at);
    }
    let (host_method, display_name, action, input) =
        match host_tool_mapping(&call.name, call.arguments.clone()) {
            Some(mapping) => mapping,
            None => {
                let output = json!({ "error": format!("Unknown Lyra tool: {}", call.name) });
                record_tool_activity(
                    session_id,
                    turn_id,
                    tool_activity(
                        &call.id,
                        &call.name,
                        &call.name,
                        "failed",
                        call.arguments,
                        Some(output.clone()),
                        &started_at,
                        Some(now()),
                    ),
                    "toolFinished",
                );
                return output;
            }
        };
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            &display_name,
            &tool_label(&display_name, &action),
            "running",
            input.clone(),
            None,
            &started_at,
            None,
        ),
        "toolStarted",
    );
    let raw_result = dispatcher
        .as_ref()
        .ok_or_else(|| "Lyra host capability bridge is not available".to_string())
        .and_then(|dispatcher| invoke_host_capability(dispatcher, &host_method, input.clone()));
    let (status, output) = match raw_result {
        Ok(value) => (
            "completed",
            json!({
                "content": format_tool_output(&display_name, &action, &value),
                "raw": value,
            }),
        ),
        Err(error) => (
            "failed",
            json!({
                "content": format!("Lyra tool failed: {error}"),
                "error": error,
            }),
        ),
    };
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            &display_name,
            &tool_label(&display_name, &action),
            status,
            input,
            Some(output.clone()),
            &started_at,
            Some(now()),
        ),
        "toolFinished",
    );
    output
}

fn execute_memory_tool(
    session_id: &str,
    turn_id: &str,
    call: ModelToolCall,
    started_at: &str,
) -> Value {
    let action = if call.name == "memory_remember" {
        "remember"
    } else {
        "search"
    };
    let input = memory_tool_input(&call.name, call.arguments.clone());
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            "memory",
            &tool_label("memory", action),
            "running",
            input.clone(),
            None,
            started_at,
            None,
        ),
        "toolStarted",
    );
    let raw_result = if call.name == "memory_remember" {
        let fact = input
            .get("fact")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        if fact.is_empty() {
            Err(AgentRuntimeError::Core(
                "memory fact is required".to_string(),
            ))
        } else {
            shared_memory_update(json!({
                "scope": input.get("scope").and_then(Value::as_str).unwrap_or("global"),
                "content": {
                    "fact": fact,
                    "category": input.get("category").and_then(Value::as_str).unwrap_or("other"),
                    "source": "agent_tool"
                }
            }))
        }
    } else {
        shared_memory_search(json!({
            "query": input.get("query").and_then(Value::as_str).unwrap_or_default()
        }))
    };
    let (status, output) = match raw_result {
        Ok(value) => (
            "completed",
            json!({
                "content": format_memory_output(action, &value),
                "raw": value,
            }),
        ),
        Err(error) => (
            "failed",
            json!({
                "content": format!("Lyra memory tool failed: {error}"),
                "error": error.to_string(),
            }),
        ),
    };
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            "memory",
            &tool_label("memory", action),
            status,
            input,
            Some(output.clone()),
            started_at,
            Some(now()),
        ),
        "toolFinished",
    );
    output
}

fn memory_tool_input(name: &str, arguments: Value) -> Value {
    let mut input = arguments.as_object().cloned().unwrap_or_default();
    if name == "memory_remember" {
        input
            .entry("scope".to_string())
            .or_insert_with(|| Value::String("global".to_string()));
        input
            .entry("category".to_string())
            .or_insert_with(|| Value::String("other".to_string()));
    }
    input.insert(
        "action".to_string(),
        Value::String(
            if name == "memory_remember" {
                "remember"
            } else {
                "search"
            }
            .to_string(),
        ),
    );
    Value::Object(input)
}

fn host_tool_mapping(name: &str, arguments: Value) -> Option<(String, String, String, Value)> {
    let mut input = arguments.as_object().cloned().unwrap_or_default();
    let mapping = match name {
        "workbench_list_tabs" => ("workbench.listTabs", "workbench", "list_tabs"),
        "workbench_read_workspace" => ("workbench.readWorkspace", "workbench", "read_workspace"),
        "workbench_read_tab" => ("workbench.readTab", "workbench", "read_tab"),
        "workbench_activate_tab" => ("workbench.activateTab", "workbench", "activate_tab"),
        "software_list_capabilities" => {
            ("software.listCapabilities", "software", "list_capabilities")
        }
        "software_invoke_capability" => {
            ("software.invokeCapability", "software", "invoke_capability")
        }
        "lyra_lumen_map" => ("lyraLumen.map", "lyra_lumen", "map"),
        "lyra_lumen_read" => ("lyraLumen.read", "lyra_lumen", "read"),
        "lyra_lumen_act" => ("lyraLumen.act", "lyra_lumen", "act"),
        "lyra_lumen_type" => ("lyraLumen.type", "lyra_lumen", "type"),
        "lyra_lumen_press" => ("lyraLumen.press", "lyra_lumen", "press"),
        "lyra_lumen_wait" => ("lyraLumen.wait", "lyra_lumen", "wait"),
        "lyra_lumen_navigate" => ("lyraLumen.navigate", "lyra_lumen", "navigate"),
        "lyra_lumen_reveal" => ("lyraLumen.reveal", "lyra_lumen", "reveal"),
        "lyra_lumen_focus_scan" => ("lyraLumen.focusScan", "lyra_lumen", "focus_scan"),
        _ => return None,
    };
    input.insert("action".to_string(), Value::String(mapping.2.to_string()));
    Some((
        mapping.0.to_string(),
        mapping.1.to_string(),
        mapping.2.to_string(),
        Value::Object(input),
    ))
}

fn invoke_host_capability(
    dispatcher: &Arc<HostCapabilityDispatcher>,
    method: &str,
    payload: Value,
) -> Result<Value, String> {
    let payload = serde_json::to_string(&payload)
        .map_err(|error| format!("Failed to serialize host capability payload: {error}"))?;
    let output = dispatcher(method.to_string(), payload)?;
    serde_json::from_str(&output)
        .map_err(|error| format!("Failed to deserialize host capability output: {error}"))
}

fn tool_activity(
    id: &str,
    name: &str,
    label: &str,
    status: &str,
    input: Value,
    output: Option<Value>,
    started_at: &str,
    finished_at: Option<String>,
) -> Value {
    json!({
        "id": id,
        "name": name,
        "label": label,
        "status": status,
        "input": input,
        "output": output,
        "startedAt": started_at,
        "finishedAt": finished_at,
    })
}

fn record_tool_activity(session_id: &str, turn_id: &str, tool: Value, event_kind: &str) {
    let callback = match state().lock() {
        Ok(mut state) => {
            let callback = state.event_callback.clone();
            if let Some(session) = state.sessions.get_mut(session_id) {
                upsert_tool(&mut session.snapshot, tool.clone());
                session.snapshot["follow"] = json!({
                    "running": true,
                    "activity": tool.get("label").and_then(Value::as_str).unwrap_or("Using Lyra tool")
                });
                touch_snapshot(&mut session.snapshot);
                let _ = state.save_state();
            }
            callback
        }
        Err(_) => return,
    };
    emit_with_callback(
        &callback,
        json!({
            "kind": event_kind,
            "sessionId": session_id,
            "turnId": turn_id,
            "tool": tool,
        }),
    );
    emit_with_callback(
        &callback,
        json!({
            "kind": "toolUpdated",
            "sessionId": session_id,
            "turnId": turn_id,
            "tool": tool,
        }),
    );
}

fn upsert_tool(snapshot: &mut Value, tool: Value) {
    if !snapshot.get("tools").is_some_and(Value::is_array) {
        snapshot["tools"] = Value::Array(Vec::new());
    }
    let Some(tools) = snapshot.get_mut("tools").and_then(Value::as_array_mut) else {
        return;
    };
    let id = tool.get("id").and_then(Value::as_str).unwrap_or_default();
    if let Some(existing) = tools
        .iter_mut()
        .find(|existing| existing.get("id").and_then(Value::as_str) == Some(id))
    {
        *existing = tool;
    } else {
        tools.push(tool);
    }
}

fn tool_label(name: &str, action: &str) -> String {
    match (name, action) {
        ("workbench", "list_tabs") => "Listed Workbench tabs",
        ("workbench", "read_workspace") => "Read Workbench workspace",
        ("workbench", "read_tab") => "Read Workbench tab",
        ("workbench", "activate_tab") => "Activated Workbench tab",
        ("memory", "remember") => "Updated memory",
        ("memory", "search") => "Searched memory",
        ("software", "list_capabilities") => "Listed Lyra software",
        ("software", "invoke_capability") => "Used Lyra software",
        ("lyra_lumen", "map") => "Mapped browser elements",
        ("lyra_lumen", "read") => "Read browser page",
        ("lyra_lumen", "act") => "Acted on browser",
        ("lyra_lumen", "type") => "Typed in browser",
        ("lyra_lumen", "press") => "Pressed browser key",
        ("lyra_lumen", "wait") => "Waited for browser",
        ("lyra_lumen", "navigate") => "Navigated browser",
        ("lyra_lumen", "reveal") => "Revealed browser controls",
        ("lyra_lumen", "focus_scan") => "Scanned browser focus",
        _ => "Used Lyra tool",
    }
    .to_string()
}

fn format_tool_output(name: &str, action: &str, value: &Value) -> String {
    if name == "workbench" {
        return format_workbench_output(action, value);
    }
    if name == "lyra_lumen" {
        return format_lumen_output(action, value);
    }
    if name == "memory" {
        return format_memory_output(action, value);
    }
    serde_json::to_string_pretty(value).unwrap_or_else(|_| String::new())
}

fn format_memory_output(action: &str, value: &Value) -> String {
    if action == "remember" {
        let fact = value
            .pointer("/record/content/fact")
            .and_then(Value::as_str)
            .unwrap_or("memory updated");
        return format!("Remembered: {fact}");
    }
    let records = value
        .get("records")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if records.is_empty() {
        return "No matching memory records.".to_string();
    }
    records
        .iter()
        .take(10)
        .map(|record| {
            record
                .pointer("/content/fact")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| serde_json::to_string(record).unwrap_or_default())
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_workbench_output(action: &str, value: &Value) -> String {
    match action {
        "list_tabs" => value
            .get("tabs")
            .and_then(Value::as_array)
            .map(|tabs| format_workbench_tabs(tabs))
            .filter(|text| !text.trim().is_empty())
            .unwrap_or_else(|| serde_json::to_string_pretty(value).unwrap_or_default()),
        "read_workspace" => value
            .get("visibleTabs")
            .and_then(Value::as_array)
            .map(|tabs| {
                tabs.iter()
                    .map(|entry| {
                        let tab = entry.get("tab").unwrap_or(&Value::Null);
                        let header = format_workbench_tab_header(tab);
                        let excerpt = workbench_observation_excerpt(entry);
                        if excerpt.is_empty() {
                            header
                        } else {
                            format!("{header}\n{excerpt}")
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("\n\n---\n\n")
            })
            .filter(|text| !text.trim().is_empty())
            .unwrap_or_else(|| serde_json::to_string_pretty(value).unwrap_or_default()),
        "read_tab" => {
            let tab = value.get("tab").unwrap_or(&Value::Null);
            let header = format_workbench_tab_header(tab);
            let excerpt = workbench_observation_excerpt(value);
            if excerpt.is_empty() {
                header
            } else {
                format!("{header}\n{excerpt}")
            }
        }
        _ => serde_json::to_string_pretty(value).unwrap_or_else(|_| String::new()),
    }
}

fn format_workbench_tabs(tabs: &[Value]) -> String {
    tabs.iter()
        .map(|tab| {
            let title = tab
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("Untitled");
            let tab_id = tab
                .get("tabId")
                .or_else(|| tab.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("-");
            let page_kind = tab.get("pageKind").and_then(Value::as_str).unwrap_or("tab");
            let observation_kind = tab
                .get("observationKind")
                .or_else(|| tab.get("appId"))
                .and_then(Value::as_str)
                .unwrap_or(page_kind);
            let flags = workbench_flags(tab);
            let url = tab.get("url").and_then(Value::as_str).unwrap_or("");
            if url.is_empty() {
                format!("- {title} [{tab_id}] {page_kind} ({observation_kind}) flags={flags}")
            } else {
                format!(
                    "- {title} [{tab_id}] {page_kind} ({observation_kind}) flags={flags} | {url}"
                )
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_workbench_tab_header(tab: &Value) -> String {
    let title = tab
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Untitled");
    let tab_id = tab
        .get("tabId")
        .or_else(|| tab.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("-");
    let kind = tab
        .get("observationKind")
        .or_else(|| tab.get("pageKind"))
        .or_else(|| tab.get("appId"))
        .and_then(Value::as_str)
        .unwrap_or("tab");
    format!("{title} [{tab_id}] ({kind})")
}

fn workbench_flags(tab: &Value) -> String {
    let mut flags = Vec::new();
    for (key, label) in [
        ("active", "active"),
        ("visible", "visible"),
        ("focusedPane", "focused"),
        ("observable", "observable"),
    ] {
        if tab.get(key).and_then(Value::as_bool).unwrap_or(false) {
            flags.push(label);
        }
    }
    if flags.is_empty() {
        "none".to_string()
    } else {
        flags.join(",")
    }
}

fn workbench_observation_excerpt(value: &Value) -> String {
    let observation = value.get("observation").unwrap_or(value);
    for path in [
        "/content",
        "/text",
        "/excerpt",
        "/preview",
        "/summary",
        "/body",
        "/terminalText",
    ] {
        if let Some(text) = observation.pointer(path).and_then(Value::as_str)
            && !text.trim().is_empty()
        {
            return text.trim().to_string();
        }
    }
    serde_json::to_string_pretty(observation).unwrap_or_else(|_| String::new())
}

fn format_lumen_output(action: &str, value: &Value) -> String {
    match action {
        "map" => {
            let observation_id = value
                .get("observationId")
                .and_then(Value::as_str)
                .unwrap_or("observation");
            let title = value.get("title").and_then(Value::as_str).unwrap_or("page");
            let url = value.get("url").and_then(Value::as_str).unwrap_or("");
            let mut lines = vec![if url.is_empty() {
                format!("Observation {observation_id} (map) for {title}")
            } else {
                format!("Observation {observation_id} (map) for {title} - {url}")
            }];
            if let Some(elements) = value.get("elements").and_then(Value::as_array) {
                for element in elements.iter().take(30) {
                    let id = element
                        .get("id")
                        .or_else(|| element.get("elementId"))
                        .and_then(Value::as_i64)
                        .unwrap_or(0);
                    let role = element
                        .get("role")
                        .and_then(Value::as_str)
                        .unwrap_or("element");
                    let label = element
                        .get("label")
                        .or_else(|| element.get("text"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let bounds = element.get("bounds").unwrap_or(&Value::Null);
                    let x = bounds.get("x").and_then(Value::as_i64).unwrap_or(0);
                    let y = bounds.get("y").and_then(Value::as_i64).unwrap_or(0);
                    let width = bounds.get("width").and_then(Value::as_i64).unwrap_or(0);
                    let height = bounds.get("height").and_then(Value::as_i64).unwrap_or(0);
                    lines.push(format!(
                        "[{id}] {role}: \"{label}\" at ({x},{y}) {width}x{height}"
                    ));
                }
            }
            lines.join("\n")
        }
        _ => value
            .get("content")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| serde_json::to_string_pretty(value).unwrap_or_default()),
    }
}

fn tool_result_content(output: &Value) -> String {
    output
        .get("content")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| serde_json::to_string_pretty(output).unwrap_or_default())
}

fn fallback_response(error: AgentRuntimeError) -> String {
    format!(
        "Lyra native agent runtime is active, but the model call could not run: {error}. Configure a provider profile or API key, then retry."
    )
}

fn finish_turn(
    session_id: &str,
    turn_id: &str,
    status: &str,
    assistant_text: Option<String>,
    failure: Option<String>,
) {
    let (callback, events) = match state().lock() {
        Ok(mut state) => {
            let callback = state.event_callback.clone();
            let mut events = Vec::new();
            if let Some(session) = state.sessions.get_mut(session_id) {
                if session.snapshot.get("activeTurnId").and_then(Value::as_str) == Some(turn_id) {
                    if let Some(text) = assistant_text.filter(|text| !text.trim().is_empty()) {
                        let message = assistant_message(text);
                        push_array(&mut session.snapshot, "messages", message.clone());
                        events.push(json!({
                            "kind": "messageCommitted",
                            "sessionId": session_id,
                            "message": message
                        }));
                    }
                    session.snapshot["turnStatus"] = Value::String(status.to_string());
                    session.snapshot["activeTurnId"] = Value::Null;
                    session.snapshot["follow"] =
                        json!({ "running": false, "activity": Value::Null });
                    update_runtime_turn(session, turn_id, status);
                    touch_snapshot(&mut session.snapshot);
                    events.push(json!({
                        "kind": "sessionSnapshot",
                        "snapshot": session.snapshot
                    }));
                    events.push(json!({
                        "kind": "turnFinished",
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "status": status
                    }));
                    match status {
                        "finished" => events.push(json!({
                            "kind": "turnCompleted",
                            "sessionId": session_id,
                            "turnId": turn_id
                        })),
                        "cancelled" => events.push(json!({
                            "kind": "turnInterrupted",
                            "sessionId": session_id,
                            "turnId": turn_id,
                            "reason": failure.unwrap_or_else(|| "turn cancelled".to_string())
                        })),
                        "failed" => events.push(json!({
                            "kind": "turnFailed",
                            "sessionId": session_id,
                            "turnId": turn_id,
                            "message": failure.unwrap_or_else(|| "turn failed".to_string())
                        })),
                        _ => {}
                    }
                    events.push(json!({
                        "kind": "followStateChanged",
                        "sessionId": session_id,
                        "follow": { "running": false, "activity": Value::Null }
                    }));
                }
            }
            let _ = state.save_state();
            (callback, events)
        }
        Err(_) => return,
    };
    for event in events {
        emit_with_callback(&callback, event);
    }
}

fn update_runtime_turn(session: &mut NativeSession, turn_id: &str, status: &str) {
    let state_name = match status {
        "finished" => "completed",
        "cancelled" => "cancelled_by_user",
        "failed" => "failed_recoverable",
        _ => "completed",
    };
    let timestamp = now();
    for turn in &mut session.runtime_turns {
        if turn.get("runtimeTurnId").and_then(Value::as_str) == Some(turn_id) {
            turn["state"] = Value::String(state_name.to_string());
            turn["updatedAtIso"] = Value::String(timestamp.clone());
            turn["completedAtIso"] = Value::String(timestamp.clone());
            turn["completedAtMs"] = Value::Number(Utc::now().timestamp_millis().into());
        }
    }
}

fn turn_was_cancelled(session_id: &str, turn_id: &str) -> bool {
    state()
        .lock()
        .map(|state| {
            state.cancelled_turns.contains(turn_id)
                || state
                    .sessions
                    .get(session_id)
                    .and_then(|session| session.snapshot.get("activeTurnId"))
                    .and_then(Value::as_str)
                    != Some(turn_id)
        })
        .unwrap_or(true)
}

fn cancel_turn(payload: Value) -> AgentRuntimeResult<Value> {
    let id = required_session_id(&payload)?;
    let (turn_id, callback, events) = {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let turn_id = state
            .sessions
            .get(&id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {id}")))?
            .snapshot
            .get("activeTurnId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| {
                AgentRuntimeError::Core(format!("turn not running for session: {id}"))
            })?;
        state.cancelled_turns.insert(turn_id.clone());
        let session = state
            .sessions
            .get_mut(&id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {id}")))?;
        session.snapshot["turnStatus"] = Value::String("cancelled".to_string());
        session.snapshot["activeTurnId"] = Value::Null;
        session.snapshot["follow"] = json!({ "running": false, "activity": Value::Null });
        update_runtime_turn(session, &turn_id, "cancelled");
        touch_snapshot(&mut session.snapshot);
        let snapshot = session.snapshot.clone();
        let callback = state.event_callback.clone();
        state.save_state()?;
        (
            turn_id.clone(),
            callback,
            vec![
                json!({ "kind": "sessionSnapshot", "snapshot": snapshot }),
                json!({ "kind": "turnInterrupted", "sessionId": id, "turnId": turn_id.clone(), "reason": "turn cancelled" }),
                json!({ "kind": "turnFinished", "sessionId": id, "turnId": turn_id.clone(), "status": "cancelled" }),
            ],
        )
    };
    for event in events {
        emit_with_callback(&callback, event);
    }
    Ok(json!({ "sessionId": id, "turnId": turn_id, "status": "cancelling" }))
}

fn start_selfdev(payload: Value) -> AgentRuntimeResult<Value> {
    let prompt = string_opt(&payload, "prompt");
    let parent = string_opt(&payload, "parentSessionId");
    let inherit_context = payload
        .get("inheritContext")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut session = new_session(Some("Lyra Self Development".to_string()), None, "selfdev");
    if inherit_context
        && let Some(parent_id) = parent
        && let Ok(state) = state().lock()
        && let Some(parent_session) = state.sessions.get(&parent_id)
        && let Some(messages) = parent_session.snapshot.get("messages").cloned()
    {
        session.snapshot["messages"] = messages;
    }
    let snapshot = session.snapshot.clone();
    let session_id = session.id.clone();
    {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        state.active_session_id = Some(session_id.clone());
        state.sessions.insert(session_id.clone(), session);
        state.save_state()?;
    }
    let mut response = json!({
        "sessionId": session_id,
        "repoDir": current_working_dir(),
        "snapshot": snapshot,
        "turnId": Value::Null,
        "status": "idle",
        "inheritedContext": inherit_context
    });
    if let Some(prompt) = prompt.filter(|value| !value.trim().is_empty()) {
        let turn = send_turn(json!({ "sessionId": session_id, "text": prompt }))?;
        response["turnId"] = turn.get("turnId").cloned().unwrap_or(Value::Null);
        response["status"] = Value::String("running".to_string());
    }
    Ok(response)
}

fn selfdev_status(payload: Value) -> AgentRuntimeResult<Value> {
    let id = string_opt(&payload, "sessionId");
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let id = state.resolve_session_id(id)?;
    let title = state
        .sessions
        .get(&id)
        .and_then(|session| session.snapshot.get("title"))
        .and_then(Value::as_str)
        .map(str::to_string);
    Ok(json!({
        "available": true,
        "repoDir": current_working_dir(),
        "sessionId": id,
        "output": "",
        "title": title,
        "metadata": { "runtime": "lyra-native" }
    }))
}

fn memory_snapshot(payload: Value) -> AgentRuntimeResult<Value> {
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let id = state.resolve_session_id(string_opt(&payload, "sessionId"))?;
    let session = state
        .sessions
        .get(&id)
        .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {id}")))?;
    Ok(memory_snapshot_for_session(session, &state.config))
}

fn memory_audit(payload: Value) -> AgentRuntimeResult<Value> {
    let snapshot = memory_snapshot(payload)?;
    Ok(json!({
        "sessionId": snapshot.pointer("/session/sessionId").cloned().unwrap_or(Value::Null),
        "events": snapshot.get("timelineProjection").cloned().unwrap_or_else(|| json!([])),
        "runtimeTurns": snapshot.get("runtimeTurns").cloned().unwrap_or_else(|| json!([])),
    }))
}

fn memory_snapshot_for_session(session: &NativeSession, config: &NativeConfig) -> Value {
    let snapshot = &session.snapshot;
    let updated = snapshot
        .get("updatedAt")
        .and_then(Value::as_str)
        .unwrap_or(&session.created_at);
    let messages = snapshot
        .get("messages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let timeline = messages
        .iter()
        .map(|message| {
            let role = message.get("role").and_then(Value::as_str).unwrap_or("runtime");
            json!({
                "eventId": message.get("id").cloned().unwrap_or_else(|| Value::String(format!("event-{}", Uuid::new_v4()))),
                "runtimeTurnId": Value::Null,
                "kind": format!("{role}_message"),
                "role": role,
                "payloadJson": message,
                "createdAtMs": iso_ms(message.get("createdAt").and_then(Value::as_str).unwrap_or(updated)),
                "createdAtIso": message.get("createdAt").and_then(Value::as_str).unwrap_or(updated),
            })
        })
        .collect::<Vec<_>>();
    json!({
        "session": {
            "sessionId": session.id,
            "title": snapshot.get("title").cloned().unwrap_or_else(|| Value::String("Lyra Agent".to_string())),
            "workingDir": snapshot.get("workingDir").cloned().unwrap_or(Value::Null),
            "providerKey": config.default_provider,
            "model": config.default_model,
            "status": snapshot.get("turnStatus").cloned().unwrap_or_else(|| Value::String("idle".to_string())),
            "schemaVersion": 1,
            "createdAtMs": iso_ms(&session.created_at),
            "createdAtIso": session.created_at,
            "updatedAtMs": iso_ms(updated),
            "updatedAtIso": updated,
        },
        "runtimeTurns": session.runtime_turns,
        "timelineProjection": timeline,
        "activeTodos": snapshot.get("todos").cloned().unwrap_or_else(|| json!([])),
        "activeBrowserTargets": [],
        "activeClarification": Value::Null,
        "status": snapshot.get("turnStatus").cloned().unwrap_or_else(|| Value::String("idle".to_string())),
        "providerLabel": provider_label(config),
        "modelLabel": config.default_model,
    })
}

fn shared_memory_search(payload: Value) -> AgentRuntimeResult<Value> {
    let query = string_opt(&payload, "query")
        .unwrap_or_default()
        .to_lowercase();
    let state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let records = state
        .shared_memory
        .iter()
        .filter(|record| {
            query.is_empty()
                || serde_json::to_string(record)
                    .unwrap_or_default()
                    .to_lowercase()
                    .contains(&query)
        })
        .cloned()
        .collect::<Vec<_>>();
    Ok(json!({ "records": records }))
}

fn shared_memory_update(payload: Value) -> AgentRuntimeResult<Value> {
    let scope = string_opt(&payload, "scope").unwrap_or_else(|| "global".to_string());
    let content = payload.get("content").cloned().unwrap_or(Value::Null);
    let timestamp = now();
    let record = SharedMemoryRecord {
        id: format!("memory-{}", Uuid::new_v4()),
        scope,
        content,
        created_at: timestamp.clone(),
        updated_at: timestamp,
        status: "active".to_string(),
    };
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    state.shared_memory.push(record.clone());
    state.save_state()?;
    Ok(json!({ "record": record, "records": state.shared_memory }))
}

fn rollback_preview(payload: Value) -> AgentRuntimeResult<Value> {
    let session_id = required_session_id(&payload)?;
    let message_id = string_opt(&payload, "messageId").unwrap_or_default();
    Ok(json!({
        "sessionId": session_id,
        "messageId": message_id,
        "available": false,
        "checkpointAt": Value::Null,
        "removedMessageCount": 0,
        "changedFiles": [],
        "unavailableReason": "No rollback checkpoint is available in the native runtime for this message."
    }))
}

fn rollback_restore(payload: Value) -> AgentRuntimeResult<Value> {
    let session_id = required_session_id(&payload)?;
    let message_id = string_opt(&payload, "messageId").unwrap_or_default();
    Err(AgentRuntimeError::Core(format!(
        "no rollback checkpoint is available for session {session_id} message {message_id}"
    )))
}

fn respond_permission(payload: Value) -> AgentRuntimeResult<Value> {
    Ok(json!({
        "sessionId": payload.get("sessionId").cloned().unwrap_or(Value::Null),
        "permissionId": payload.get("permissionId").cloned().unwrap_or(Value::Null),
        "allowed": payload.get("allowed").cloned().unwrap_or(Value::Bool(false)),
        "status": "recorded"
    }))
}

fn respond_clarification(payload: Value) -> AgentRuntimeResult<Value> {
    let callback = state()
        .lock()
        .ok()
        .and_then(|state| state.event_callback.clone());
    if let (Some(session_id), Some(clarification_id)) = (
        payload.get("sessionId").and_then(Value::as_str),
        payload.get("clarificationId").and_then(Value::as_str),
    ) {
        emit_with_callback(
            &callback,
            json!({
                "kind": "clarificationResolved",
                "sessionId": session_id,
                "clarificationId": clarification_id
            }),
        );
    }
    Ok(json!({ "status": "recorded" }))
}

fn read_config() -> AgentRuntimeResult<Value> {
    let state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    Ok(json!({
        "agentHome": state.root.display().to_string(),
        "configPath": state.root.join("state.json").display().to_string(),
        "config": config_json(&state.config),
        "commands": registered_commands(),
    }))
}

fn update_config(payload: Value) -> AgentRuntimeResult<Value> {
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    if let Some(provider) = string_opt(&payload, "defaultProvider") {
        state.config.default_provider = Some(provider);
    }
    if let Some(model) = string_opt(&payload, "defaultModel") {
        state.config.default_model = Some(model);
    }
    if let Some(value) = string_opt(&payload, "openaiReasoningEffort") {
        state.config.reasoning_effort = Some(value);
    }
    if let Some(value) = string_opt(&payload, "openaiServiceTier") {
        state.config.service_tier = Some(value);
    }
    for (key, value) in payload.as_object().into_iter().flatten() {
        if key.starts_with("email")
            || key.starts_with("telegram")
            || key.starts_with("discord")
            || key.starts_with("ntfy")
            || key == "desktopNotifications"
        {
            state
                .config
                .notifications
                .insert(key.clone(), value.clone());
        }
    }
    state.save_state()?;
    drop(state);
    read_config()
}

fn save_provider_profile(payload: Value) -> AgentRuntimeResult<Value> {
    let profile_name = string_opt(&payload, "profileName")
        .ok_or_else(|| AgentRuntimeError::Core("profileName is required".to_string()))?;
    let provider_type =
        string_opt(&payload, "providerType").unwrap_or_else(|| "openai-compatible".to_string());
    let base_url = string_opt(&payload, "baseUrl");
    let default_model = string_opt(&payload, "defaultModel");
    let models = payload
        .get("models")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let id = item.get("id").and_then(Value::as_str)?.to_string();
                    Some(NativeProviderModel {
                        id: id.clone(),
                        label: Some(id),
                        context_window: item
                            .get("contextWindow")
                            .and_then(Value::as_u64)
                            .map(|value| value as usize),
                        supports_image_input: true,
                        supports_tool_calling: true,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let profile = NativeProviderProfile {
        id: profile_name.clone(),
        label: string_opt(&payload, "label").unwrap_or_else(|| profile_name.clone()),
        provider_type,
        base_url,
        default_model: default_model.clone(),
        api_key: string_opt(&payload, "apiKey"),
        api_key_env: string_opt(&payload, "apiKeyEnv"),
        auth_header: string_opt(&payload, "authHeader"),
        models,
    };
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    state.config.providers.insert(profile_name.clone(), profile);
    if payload
        .get("setDefault")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        state.config.default_provider = Some(profile_name);
        if default_model.is_some() {
            state.config.default_model = default_model;
        }
    }
    state.save_state()?;
    drop(state);
    read_config()
}

fn update_provider_options(payload: Value) -> AgentRuntimeResult<Value> {
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    state.config.reasoning_effort = string_opt(&payload, "reasoningEffort");
    state.config.service_tier = string_opt(&payload, "serviceTier");
    state.save_state()?;
    drop(state);
    list_models(payload)
}

fn list_models(payload: Value) -> AgentRuntimeResult<Value> {
    let state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let current_provider = state
        .config
        .default_provider
        .clone()
        .unwrap_or_else(|| "openai".to_string());
    let current_model = state
        .config
        .default_model
        .clone()
        .or_else(|| {
            state
                .config
                .providers
                .get(&current_provider)
                .and_then(|provider| provider.default_model.clone())
        })
        .unwrap_or_else(|| "gpt-4.1-mini".to_string());
    let mut models = Vec::new();
    let mut routes = Vec::new();
    for provider in state.config.providers.values() {
        let provider_models = if provider.models.is_empty() {
            provider
                .default_model
                .clone()
                .or_else(|| state.config.default_model.clone())
                .map(|model| {
                    vec![NativeProviderModel {
                        id: model.clone(),
                        label: Some(model),
                        context_window: None,
                        supports_image_input: true,
                        supports_tool_calling: true,
                    }]
                })
                .unwrap_or_default()
        } else {
            provider.models.clone()
        };
        for model in provider_models {
            let selected = provider.id == current_provider && model.id == current_model;
            models.push(json!({
                "id": model.id,
                "label": model.label.clone().unwrap_or_else(|| model.id.clone()),
                "model": model.id,
                "provider": provider.id,
                "providerId": provider.id,
                "providerLabel": provider.label,
                "providerKey": provider.id,
                "apiMethod": "chatCompletions",
                "detail": provider.base_url,
                "contextWindow": model.context_window,
                "supportsImageInput": model.supports_image_input,
                "supportsToolCalling": model.supports_tool_calling,
                "available": provider_api_key(provider).is_some(),
                "selected": selected,
            }));
            routes.push(json!({
                "model": model.id,
                "provider": provider.id,
                "apiMethod": "chatCompletions",
                "available": provider_api_key(provider).is_some(),
                "detail": provider.base_url.clone().unwrap_or_else(|| "base URL not configured".to_string())
            }));
        }
    }
    Ok(json!({
        "sessionId": payload.get("sessionId").cloned().unwrap_or(Value::Null),
        "currentModel": current_model,
        "currentProvider": current_provider,
        "defaultModel": state.config.default_model,
        "defaultProvider": state.config.default_provider,
        "models": models,
        "routes": routes,
        "reasoningEffort": option_state(state.config.reasoning_effort.clone(), &["minimal", "low", "medium", "high"]),
        "serviceTier": option_state(state.config.service_tier.clone(), &["auto", "default", "flex"]),
    }))
}

fn switch_model(payload: Value) -> AgentRuntimeResult<Value> {
    let model = string_opt(&payload, "model")
        .ok_or_else(|| AgentRuntimeError::Core("model is required".to_string()))?;
    let provider = string_opt(&payload, "provider");
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    state.config.default_model = Some(model);
    if let Some(provider) = provider {
        state.config.default_provider = Some(provider);
    }
    state.save_state()?;
    drop(state);
    list_models(payload)
}

fn update_roles(payload: Value) -> AgentRuntimeResult<Value> {
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    for (key, value) in payload.as_object().into_iter().flatten() {
        if let Some(text) = value.as_str() {
            state.config.roles.insert(key.clone(), text.to_string());
        }
    }
    state.save_state()?;
    drop(state);
    read_config()
}

fn list_accounts() -> AgentRuntimeResult<Value> {
    let state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    Ok(accounts_json(&state.config))
}

fn login_account(payload: Value) -> AgentRuntimeResult<Value> {
    let provider = string_opt(&payload, "provider").unwrap_or_else(|| "openai".to_string());
    let label = string_opt(&payload, "label")
        .or_else(|| string_opt(&payload, "profileName"))
        .unwrap_or_else(|| provider.clone());
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    state
        .config
        .accounts
        .retain(|account| account.provider != provider);
    state.config.accounts.push(NativeAccount {
        provider: provider.clone(),
        label,
        kind: "apiKey".to_string(),
        active: true,
        configured: true,
        detail: Some("Configured in Lyra native runtime".to_string()),
    });
    state.config.default_provider = Some(provider);
    state.save_state()?;
    Ok(accounts_json(&state.config))
}

fn login_providers() -> AgentRuntimeResult<Value> {
    let state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let providers = vec![
        login_provider("openai", "OpenAI", "apiKey", true, false, &state.config),
        login_provider(
            "openrouter",
            "OpenRouter",
            "apiKey",
            true,
            false,
            &state.config,
        ),
        login_provider("gmail", "Gmail", "oauth", false, true, &state.config),
        login_provider(
            "mimo-token-plan",
            "MiMo Token Plan",
            "apiKey",
            true,
            false,
            &state.config,
        ),
    ];
    Ok(json!({ "providers": providers, "authStatus": auth_status(&state.config) }))
}

fn start_account_login(payload: Value) -> AgentRuntimeResult<Value> {
    let provider = string_opt(&payload, "provider").unwrap_or_else(|| "openai".to_string());
    let label = string_opt(&payload, "label");
    let auth_kind = if provider == "gmail" {
        "oauth"
    } else {
        "apiKey"
    };
    Ok(json!({
        "provider": provider,
        "label": label,
        "flowId": format!("login-{}", Uuid::new_v4()),
        "authUrl": if auth_kind == "oauth" { Some("Configure Google OAuth credentials in Lyra, then paste the callback code here.".to_string()) } else { None },
        "callbackHint": if auth_kind == "oauth" { Some("Paste the OAuth callback URL or authorization code.".to_string()) } else { None },
        "authKind": auth_kind,
        "instructions": if auth_kind == "oauth" { "Use the Gmail OAuth flow and complete it with the callback value." } else { "Paste an API key to complete provider setup." },
        "requiresCallback": auth_kind == "oauth",
        "requiresApiKey": auth_kind == "apiKey",
    }))
}

fn complete_account_login(payload: Value) -> AgentRuntimeResult<Value> {
    let provider = string_opt(&payload, "provider").unwrap_or_else(|| "openai".to_string());
    if provider != "gmail" {
        let _ = save_provider_profile(json!({
            "profileName": provider,
            "label": string_opt(&payload, "label").unwrap_or_else(|| provider.clone()),
            "baseUrl": string_opt(&payload, "baseUrl"),
            "defaultModel": string_opt(&payload, "defaultModel"),
            "apiKey": string_opt(&payload, "apiKey"),
            "authHeader": string_opt(&payload, "authHeader"),
            "setDefault": payload.get("setDefault").and_then(Value::as_bool).unwrap_or(true)
        }));
    }
    let accounts = login_account(json!({
        "provider": provider,
        "label": string_opt(&payload, "label").unwrap_or_else(|| provider.clone())
    }))?;
    Ok(json!({ "accounts": accounts, "message": "Account configured." }))
}

fn switch_account(payload: Value) -> AgentRuntimeResult<Value> {
    let provider = string_opt(&payload, "provider")
        .ok_or_else(|| AgentRuntimeError::Core("provider is required".to_string()))?;
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    for account in &mut state.config.accounts {
        account.active = account.provider == provider;
    }
    state.config.default_provider = Some(provider);
    state.save_state()?;
    Ok(accounts_json(&state.config))
}

fn remove_account(payload: Value) -> AgentRuntimeResult<Value> {
    let provider = string_opt(&payload, "provider")
        .ok_or_else(|| AgentRuntimeError::Core("provider is required".to_string()))?;
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    state
        .config
        .accounts
        .retain(|account| account.provider != provider);
    state.save_state()?;
    Ok(accounts_json(&state.config))
}

fn action_turn(payload: Value, instruction: &str) -> AgentRuntimeResult<Value> {
    let focus = string_opt(&payload, "focus").unwrap_or_default();
    send_turn(json!({
        "sessionId": payload.get("sessionId").cloned().unwrap_or(Value::Null),
        "text": if focus.is_empty() { instruction.to_string() } else { format!("{instruction}\n\nFocus: {focus}") }
    }))
}

fn poke_session(payload: Value) -> AgentRuntimeResult<Value> {
    let session_id = string_opt(&payload, "sessionId");
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let session_id = state.resolve_session_id(session_id)?;
    let incomplete = state
        .sessions
        .get(&session_id)
        .and_then(|session| session.snapshot.get("todos"))
        .and_then(Value::as_array)
        .map(|todos| todos.len())
        .unwrap_or(0);
    Ok(json!({
        "sessionId": session_id,
        "turnId": Value::Null,
        "status": "idle",
        "sent": false,
        "incompleteTodoCount": incomplete
    }))
}

fn run_subagent(payload: Value) -> AgentRuntimeResult<Value> {
    let parent_id = string_opt(&payload, "sessionId");
    let mut response = fork_session(json!({ "sessionId": parent_id }), "Subagent")?;
    let session_id = response
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let tool_id = format!("tool-{}", Uuid::new_v4());
    let _ = send_turn(json!({
        "sessionId": session_id,
        "text": string_opt(&payload, "prompt").unwrap_or_else(|| "Run subagent task.".to_string())
    }));
    response["toolId"] = Value::String(tool_id);
    Ok(response)
}

fn run_btw(payload: Value) -> AgentRuntimeResult<Value> {
    let session_id = string_opt(&payload, "sessionId");
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let session_id = state.resolve_session_id(session_id)?;
    let question = string_opt(&payload, "question").unwrap_or_default();
    let page = json!({
        "id": format!("side-panel-{}", Uuid::new_v4()),
        "title": "Background Note",
        "filePath": "",
        "format": "markdown",
        "source": "lyra-native",
        "content": question,
        "updatedAtMs": Utc::now().timestamp_millis()
    });
    let session = state
        .sessions
        .get_mut(&session_id)
        .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {session_id}")))?;
    session.snapshot["sidePanel"] = json!({
        "focusedPageId": page["id"],
        "pages": [page]
    });
    touch_snapshot(&mut session.snapshot);
    let side_panel = session.snapshot["sidePanel"].clone();
    state.save_state()?;
    Ok(json!({
        "sessionId": session_id,
        "turnId": Value::Null,
        "status": "idle",
        "sidePanel": side_panel
    }))
}

fn goals(payload: Value) -> AgentRuntimeResult<Value> {
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let session_id = state.resolve_session_id(string_opt(&payload, "sessionId"))?;
    Ok(json!({
        "sessionId": session_id,
        "goals": [],
        "focusedGoal": Value::Null,
        "sidePanel": empty_side_panel()
    }))
}

fn start_overnight(payload: Value) -> AgentRuntimeResult<Value> {
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let parent_session_id = state.resolve_session_id(string_opt(&payload, "sessionId"))?;
    let run_id = format!("overnight-{}", Uuid::new_v4());
    let started = now();
    let run = json!({
        "runId": run_id,
        "parentSessionId": parent_session_id,
        "coordinatorSessionId": parent_session_id,
        "coordinatorSessionName": "Lyra Agent",
        "status": "created",
        "mission": payload.get("mission").cloned().unwrap_or(Value::Null),
        "workingDir": current_working_dir(),
        "providerName": provider_label(&state.config),
        "model": state.config.default_model,
        "startedAt": started,
        "targetWakeAt": started,
        "handoffReadyAt": started,
        "postWakeGraceUntil": started,
        "lastActivityAt": started,
        "completedAt": Value::Null,
        "cancelRequestedAt": Value::Null,
        "runDir": state.root.join("overnight").join(&run_id).display().to_string(),
        "logPath": "",
        "reviewPath": "",
        "manifest": {},
        "progress": {},
        "events": [],
        "taskCards": [],
        "statusMarkdown": "Native overnight run record created.",
        "logMarkdown": "",
        "reviewHtml": Value::Null,
        "coordinatorSnapshot": Value::Null
    });
    state.overnight_runs.insert(run_id.clone(), run.clone());
    state.save_state()?;
    Ok(
        json!({ "run": run, "inheritedContext": payload.get("inheritContext").and_then(Value::as_bool).unwrap_or(false) }),
    )
}

fn list_overnight() -> AgentRuntimeResult<Value> {
    let state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let runs = state.overnight_runs.values().cloned().collect::<Vec<_>>();
    let latest_run_id = runs
        .last()
        .and_then(|run| run.get("runId"))
        .and_then(Value::as_str)
        .map(str::to_string);
    Ok(json!({ "runs": runs, "latestRunId": latest_run_id }))
}

fn read_overnight(payload: Value) -> AgentRuntimeResult<Value> {
    let state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let run_id = string_opt(&payload, "runId").or_else(|| {
        state
            .overnight_runs
            .keys()
            .last()
            .map(std::string::ToString::to_string)
    });
    let run = run_id.and_then(|id| state.overnight_runs.get(&id).cloned());
    Ok(json!({ "run": run }))
}

fn cancel_overnight(payload: Value) -> AgentRuntimeResult<Value> {
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let run_id = string_opt(&payload, "runId").or_else(|| {
        state
            .overnight_runs
            .keys()
            .last()
            .map(std::string::ToString::to_string)
    });
    let run = run_id.and_then(|id| {
        let run = state.overnight_runs.get_mut(&id)?;
        run["status"] = Value::String("cancelled".to_string());
        run["cancelRequestedAt"] = Value::String(now());
        Some(run.clone())
    });
    state.save_state()?;
    Ok(json!({ "run": run }))
}

fn mutate_session(
    id: &str,
    mutate: impl FnOnce(&mut NativeSession) -> AgentRuntimeResult<Value>,
) -> AgentRuntimeResult<Value> {
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let session = state
        .sessions
        .get_mut(id)
        .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {id}")))?;
    let value = mutate(session)?;
    state.save_state()?;
    Ok(value)
}

fn user_message(text: String, images: Vec<Value>, created_at: String) -> Value {
    let mut blocks = Vec::new();
    if !text.trim().is_empty() {
        blocks.push(json!({ "type": "text", "id": "text-0", "text": text }));
    }
    for (index, image) in images.into_iter().enumerate() {
        blocks.push(json!({
            "type": "image",
            "id": format!("image-{index}"),
            "mediaType": image.get("mediaType").or_else(|| image.get("media_type")).cloned().unwrap_or_else(|| Value::String("image/png".to_string())),
            "data": image.get("data").cloned().unwrap_or(Value::Null),
            "label": image.get("label").cloned().unwrap_or(Value::Null),
            "source": image.get("source").cloned().unwrap_or(Value::Null),
            "width": image.get("width").cloned().unwrap_or(Value::Null),
            "height": image.get("height").cloned().unwrap_or(Value::Null),
        }));
    }
    json!({
        "id": format!("message-{}", Uuid::new_v4()),
        "role": "user",
        "text": text,
        "blocks": blocks,
        "createdAt": created_at,
        "rollback": { "available": false, "unavailableReason": "No checkpoint was captured for this message." }
    })
}

fn assistant_message(text: String) -> Value {
    json!({
        "id": format!("message-{}", Uuid::new_v4()),
        "role": "assistant",
        "text": text,
        "blocks": [{ "type": "text", "id": "text-0", "text": text }],
        "createdAt": now()
    })
}

fn session_summary(session: &NativeSession) -> Value {
    let snapshot = &session.snapshot;
    let title = snapshot
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Lyra Agent");
    let updated = snapshot
        .get("updatedAt")
        .and_then(Value::as_str)
        .unwrap_or(&session.created_at);
    let status = if session.archived {
        "archived"
    } else {
        snapshot
            .get("turnStatus")
            .and_then(Value::as_str)
            .unwrap_or("idle")
    };
    json!({
        "id": session.id,
        "title": title,
        "sessionKind": snapshot.get("sessionKind").cloned().unwrap_or_else(|| Value::String("normal".to_string())),
        "customTitle": session.custom_title,
        "shortName": session.short_name,
        "status": status,
        "providerKey": Value::Null,
        "providerLabel": Value::Null,
        "model": Value::Null,
        "messageCount": snapshot.get("messages").and_then(Value::as_array).map(Vec::len).unwrap_or(0),
        "createdAt": session.created_at,
        "updatedAt": updated,
        "lastActiveAt": updated,
        "saved": session.saved,
        "saveLabel": session.save_label,
        "archived": session.archived,
        "workingDir": snapshot.get("workingDir").cloned().unwrap_or(Value::Null),
    })
}

fn runtime_turn(turn_id: &str, session_id: &str, state: &str, parent: Option<String>) -> Value {
    let timestamp = now();
    json!({
        "runtimeTurnId": turn_id,
        "sessionId": session_id,
        "parentRuntimeTurnId": parent,
        "userMessageId": Value::Null,
        "state": state,
        "startedAtMs": Utc::now().timestamp_millis(),
        "startedAtIso": timestamp,
        "updatedAtMs": Utc::now().timestamp_millis(),
        "updatedAtIso": timestamp,
        "completedAtMs": Value::Null,
        "completedAtIso": Value::Null,
        "failureKind": Value::Null,
        "failureDetailRef": Value::Null,
        "latestUserIntentRef": Value::Null,
        "activeTaskRef": Value::Null,
        "providerRequestRef": Value::Null,
        "contextSnapshotRef": Value::Null,
        "completionAuditRef": Value::Null
    })
}

fn config_json(config: &NativeConfig) -> Value {
    let providers = config
        .providers
        .iter()
        .map(|(id, provider)| {
            (
                id.clone(),
                json!({
                    "label": provider.label,
                    "providerType": provider.provider_type,
                    "baseUrl": provider.base_url,
                    "defaultModel": provider.default_model,
                    "requiresApiKey": provider_api_key(provider).is_none(),
                    "models": provider.models
                }),
            )
        })
        .collect::<Map<_, _>>();
    json!({
        "provider": {
            "defaultProvider": config.default_provider,
            "defaultModel": config.default_model,
        },
        "providers": providers,
        "roles": config.roles,
        "options": {
            "reasoningEffort": config.reasoning_effort,
            "serviceTier": config.service_tier,
        },
        "notifications": config.notifications,
    })
}

fn registered_commands() -> Vec<Value> {
    [
        ("/model", "Switch the active model"),
        ("/save", "Save the active session"),
        ("/rename", "Rename the active session"),
        ("/memory", "Search or update Lyra memory"),
        ("/review", "Review the current work"),
    ]
    .into_iter()
    .map(|(name, help)| {
        json!({
            "name": name,
            "help": help,
            "autocomplete": true,
            "remoteOnly": false
        })
    })
    .collect()
}

fn accounts_json(config: &NativeConfig) -> Value {
    json!({
        "defaultProvider": config.default_provider,
        "defaultModel": config.default_model,
        "authStatus": auth_status(config),
        "accounts": config.accounts,
    })
}

fn auth_status(config: &NativeConfig) -> Value {
    let configured = config
        .providers
        .values()
        .filter(|provider| provider_api_key(provider).is_some())
        .map(|provider| provider.id.clone())
        .collect::<Vec<_>>();
    json!({
        "configuredProviders": configured,
        "defaultProvider": config.default_provider,
    })
}

fn login_provider(
    id: &str,
    display_name: &str,
    auth_kind: &str,
    requires_api_key: bool,
    requires_callback: bool,
    config: &NativeConfig,
) -> Value {
    let configured = config
        .accounts
        .iter()
        .any(|account| account.provider == id && account.configured)
        || config
            .providers
            .get(id)
            .and_then(provider_api_key)
            .is_some();
    json!({
        "id": id,
        "displayName": display_name,
        "authKind": auth_kind,
        "statusMethod": "lyra-native",
        "detail": if configured { "Configured" } else { "Not configured" },
        "recommended": id == "openai",
        "configured": configured,
        "state": if configured { "configured" } else { "available" },
        "requiresCallback": requires_callback,
        "requiresApiKey": requires_api_key,
    })
}

fn option_state(current: Option<String>, options: &[&str]) -> Value {
    json!({
        "current": current,
        "options": options,
        "supported": true,
    })
}

fn provider_label(config: &NativeConfig) -> Option<String> {
    let id = config.default_provider.as_ref()?;
    config
        .providers
        .get(id)
        .map(|provider| provider.label.clone())
}

fn provider_api_key(provider: &NativeProviderProfile) -> Option<String> {
    provider
        .api_key
        .clone()
        .or_else(|| {
            provider
                .api_key_env
                .as_ref()
                .and_then(|key| env::var(key).ok())
        })
        .filter(|value| !value.trim().is_empty())
}

fn required_session_id(payload: &Value) -> AgentRuntimeResult<String> {
    payload
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| AgentRuntimeError::Core("sessionId is required".to_string()))
}

fn string_opt(payload: &Value, key: &str) -> Option<String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn empty_side_panel() -> Value {
    json!({ "focusedPageId": Value::Null, "pages": [] })
}

fn push_array(value: &mut Value, key: &str, item: Value) {
    if !value.get(key).is_some_and(Value::is_array) {
        value[key] = Value::Array(Vec::new());
    }
    if let Some(items) = value.get_mut(key).and_then(Value::as_array_mut) {
        items.push(item);
    }
}

fn set_string(value: &mut Value, key: &str, next: String) {
    if let Some(object) = value.as_object_mut() {
        object.insert(key.to_string(), Value::String(next));
    }
}

fn set_bool(value: &mut Value, key: &str, next: bool) {
    if let Some(object) = value.as_object_mut() {
        object.insert(key.to_string(), Value::Bool(next));
    }
}

fn touch_snapshot(snapshot: &mut Value) {
    set_string(snapshot, "updatedAt", now());
    let memory = snapshot
        .get("memory")
        .cloned()
        .filter(|value| !value.is_null())
        .unwrap_or(Value::Null);
    snapshot["memory"] = memory;
}

fn is_deleted(snapshot: &Value) -> bool {
    snapshot.get("turnStatus").and_then(Value::as_str) == Some("deleted")
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn iso_ms(value: &str) -> i64 {
    DateTime::parse_from_rfc3339(value)
        .map(|time| time.timestamp_millis())
        .unwrap_or_else(|_| Utc::now().timestamp_millis())
}

fn emit_with_callback(callback: &Option<Arc<EventCallback>>, event: Value) {
    if let Some(callback) = callback
        && let Ok(payload) = serde_json::to_string(&event)
    {
        callback(payload);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_backend_creates_and_reads_session() {
        let backend = LyraAgentBackend;
        let created = backend
            .call_agent_method("agent.session.create", json!({ "title": "Test" }))
            .expect("create session");
        let session_id = created["id"].as_str().expect("session id").to_string();
        let read = backend
            .call_agent_method("agent.session.read", json!({ "sessionId": session_id }))
            .expect("read session");
        assert_eq!(read["title"], "Test");
    }

    #[test]
    fn model_catalog_uses_structured_provider_capabilities() {
        let catalog = list_models(json!({})).expect("model catalog");
        assert!(catalog["models"].as_array().is_some());
        assert!(catalog["routes"].as_array().is_some());
    }

    #[test]
    fn model_request_injects_lyra_identity_and_tools() {
        let backend = LyraAgentBackend;
        let created = backend
            .call_agent_method("agent.session.create", json!({ "title": "Prompt Test" }))
            .expect("create session");
        let session_id = created["id"].as_str().expect("session id");
        let request = build_model_request(session_id).expect("model request");
        let system_prompt = request.messages[0]["content"]
            .as_str()
            .expect("system prompt");

        assert!(system_prompt.contains("You are Lyra Agent"));
        assert!(system_prompt.contains("not a plain text assistant"));
        assert!(request.tools.iter().any(|tool| {
            tool.pointer("/function/name").and_then(Value::as_str) == Some("workbench_list_tabs")
        }));
        assert!(request.tools.iter().any(|tool| {
            tool.pointer("/function/name").and_then(Value::as_str) == Some("lyra_lumen_map")
        }));
        assert!(request.tools.iter().any(|tool| {
            tool.pointer("/function/name").and_then(Value::as_str) == Some("memory_remember")
        }));
    }

    #[test]
    fn model_tool_execution_records_workbench_activity() {
        let backend = LyraAgentBackend;
        let created = backend
            .call_agent_method("agent.session.create", json!({ "title": "Tool Test" }))
            .expect("create session");
        let session_id = created["id"].as_str().expect("session id").to_string();
        let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, _payload| {
            assert_eq!(method, "workbench.listTabs");
            Ok(serde_json::to_string(&json!({
                "activeTabId": "browser-tab-1",
                "tabs": [
                    {
                        "tabId": "browser-tab-1",
                        "title": "Example",
                        "pageKind": "page",
                        "observationKind": "page",
                        "active": true,
                        "visible": true,
                        "focusedPane": true,
                        "observable": true,
                        "url": "https://example.com"
                    }
                ]
            }))
            .expect("json"))
        });
        let output = execute_model_tool(
            &session_id,
            "turn-test",
            &Some(dispatcher),
            ModelToolCall {
                id: "tool-test".to_string(),
                name: "workbench_list_tabs".to_string(),
                arguments: json!({ "scope": "all" }),
            },
        );

        assert!(
            output["content"]
                .as_str()
                .unwrap()
                .contains("browser-tab-1")
        );
        let read = backend
            .call_agent_method("agent.session.read", json!({ "sessionId": session_id }))
            .expect("read session");
        assert_eq!(read["tools"][0]["name"], "workbench");
        assert_eq!(read["tools"][0]["status"], "completed");
    }

    #[test]
    fn memory_tool_persists_shared_memory_for_future_turns() {
        let backend = LyraAgentBackend;
        let created = backend
            .call_agent_method("agent.session.create", json!({ "title": "Memory Test" }))
            .expect("create session");
        let session_id = created["id"].as_str().expect("session id").to_string();
        let output = execute_model_tool(
            &session_id,
            "turn-memory",
            &None,
            ModelToolCall {
                id: "tool-memory".to_string(),
                name: "memory_remember".to_string(),
                arguments: json!({
                    "scope": "global",
                    "category": "user_profile",
                    "fact": "The user prefers to be called Xu Yuanhao."
                }),
            },
        );

        assert!(output["content"].as_str().unwrap().contains("Xu Yuanhao"));
        let request = build_model_request(&session_id).expect("model request");
        let system_prompt = request.messages[0]["content"]
            .as_str()
            .expect("system prompt");
        assert!(system_prompt.contains("Xu Yuanhao"));
    }
}
