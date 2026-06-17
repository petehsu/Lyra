use super::*;

pub(crate) fn create_session(payload: Value) -> AgentRuntimeResult<Value> {
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

pub(crate) fn read_cli_follow(payload: Value) -> AgentRuntimeResult<Value> {
    let session_id = string_opt(&payload, "sessionId");
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let id = state.resolve_session_id(session_id)?;
    let session = state
        .sessions
        .get(&id)
        .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {id}")))?;
    Ok(session
        .snapshot
        .get("cli")
        .and_then(|cli| cli.get("follow"))
        .cloned()
        .unwrap_or_else(|| {
            json!({
                "sessionId": id,
                "enabled": false,
                "terminalSessionId": Value::Null,
                "terminalPaneId": Value::Null,
                "terminalTabId": Value::Null
            })
        }))
}

pub(crate) fn update_cli_follow(payload: Value) -> AgentRuntimeResult<Value> {
    let session_id = string_opt(&payload, "sessionId");
    let enabled = payload
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let terminal_session_id = string_opt(&payload, "terminalSessionId");
    let terminal_pane_id = string_opt(&payload, "terminalPaneId");
    let terminal_tab_id = string_opt(&payload, "terminalTabId");
    let (id, snapshot, callback) = {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let id = state.resolve_session_id(session_id)?;
        let session = state
            .sessions
            .get_mut(&id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {id}")))?;
        let follow = json!({
            "sessionId": id,
            "enabled": enabled,
            "terminalSessionId": terminal_session_id,
            "terminalPaneId": terminal_pane_id,
            "terminalTabId": terminal_tab_id
        });
        let snapshot = session.snapshot.as_object_mut().ok_or_else(|| {
            AgentRuntimeError::Core("session snapshot is not an object".to_string())
        })?;
        let cli = snapshot.entry("cli").or_insert_with(|| json!({}));
        if !cli.is_object() {
            *cli = json!({});
        }
        cli.as_object_mut()
            .expect("cli snapshot object")
            .insert("follow".to_string(), follow);
        touch_session(session);
        let snapshot = session.snapshot.clone();
        let callback = state.event_callback.clone();
        state.save_state()?;
        (id, snapshot, callback)
    };
    emit_with_callback(
        &callback,
        json!({ "kind": "sessionSnapshot", "snapshot": snapshot }),
    );
    read_cli_follow(json!({ "sessionId": id }))
}

pub(crate) fn new_session(
    title: Option<String>,
    working_dir: Option<String>,
    kind: &str,
) -> NativeSession {
    let id = format!("session-{}", Uuid::new_v4());
    let created_at = now();
    let title = title
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_SESSION_TITLE.to_string());
    // Every session is bound to a working directory. When the caller does not
    // specify one (the user sent a message without choosing a project), default
    // to the user's home directory rather than leaving the session unbound. The
    // `workingDirIsHome` flag lets the UI label the binding "Home" instead of
    // showing the home folder's basename (the OS username).
    let requested_dir = working_dir
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let working_dir_is_home = requested_dir.is_none();
    let working_dir = requested_dir.unwrap_or_else(home_working_dir);
    let project_bound = !working_dir.trim().is_empty();
    let snapshot = json!({
        "id": id,
        "title": title,
        "sessionKind": kind,
        "workingDir": working_dir,
        "projectBound": project_bound,
        "workingDirIsHome": working_dir_is_home,
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
        rollback_checkpoints: Vec::new(),
        file_read_state: HashMap::new(),
        dirty: true,
    }
}

// Resolve the user's home directory across platforms, falling back to the
// process working directory if the home directory cannot be determined.
pub(crate) fn home_working_dir() -> String {
    dirs::home_dir()
        .map(|path| path.display().to_string())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(current_working_dir)
}

pub(crate) fn current_working_dir() -> String {
    env::current_dir()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| ".".to_string())
}

pub(crate) fn read_session(payload: Value) -> AgentRuntimeResult<Value> {
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let root = state.root.clone();
    let active_before = state.active_session_id.clone();
    let id = state.resolve_session_id(string_opt(&payload, "sessionId"))?;
    let session = state
        .sessions
        .get_mut(&id)
        .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {id}")))?;
    let reconciled = reconcile_orphan_running_tools(session);
    if reconciled {
        touch_session(session);
    }
    let snapshot = session.snapshot.clone();
    let session_dirty = session.dirty;
    // A pure read changes nothing on disk, so skip the state-file write this path
    // used to perform on every UI poll. Persist only when there is something to
    // persist: this session is dirty (reconciliation, or unsaved prior writes), or
    // resolve_session_id switched the active session. save_state already skips
    // unchanged session files; this additionally skips the redundant state.json
    // write on idle reads while preserving every write the old code would make for
    // this session.
    if session_dirty || state.active_session_id != active_before {
        state.save_state()?;
    }
    drop(state);
    let mut snapshot = snapshot;
    snapshot["memoryCandidates"] = json!(
        list_memory_candidates(&root, Some("pending"), 20)?
            .iter()
            .map(memory_candidate_json)
            .collect::<Vec<_>>()
    );
    snapshot["proactiveEvents"] = json!(
        list_proactive_events(&root, Some("pending"), 20)?
            .iter()
            .filter(|event| event.session_id.as_deref().is_none_or(|value| value == id))
            .map(proactive_event_json)
            .collect::<Vec<_>>()
    );
    Ok(snapshot)
}

pub(crate) fn list_sessions(payload: Value) -> AgentRuntimeResult<Value> {
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

pub(crate) fn set_saved(payload: Value, saved: bool) -> AgentRuntimeResult<Value> {
    let id = required_session_id(&payload)?;
    mutate_session(&id, |session| {
        session.saved = saved;
        session.save_label = if saved {
            string_opt(&payload, "label").or_else(|| Some("Saved".to_string()))
        } else {
            None
        };
        session.archived = false;
        touch_session(session);
        Ok(session_summary(session))
    })
}

pub(crate) fn rename_session(payload: Value) -> AgentRuntimeResult<Value> {
    let id = required_session_id(&payload)?;
    let title = string_opt(&payload, "title").unwrap_or_else(|| DEFAULT_SESSION_TITLE.to_string());
    mutate_session(&id, |session| {
        session.custom_title = Some(title.clone());
        set_string(&mut session.snapshot, "title", title);
        touch_session(session);
        Ok(session_summary(session))
    })
}

pub(crate) fn archive_session(payload: Value) -> AgentRuntimeResult<Value> {
    let id = required_session_id(&payload)?;
    let archived = payload
        .get("archived")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    mutate_session(&id, |session| {
        session.archived = archived;
        touch_session(session);
        Ok(session_summary(session))
    })
}

pub(crate) fn delete_session(payload: Value) -> AgentRuntimeResult<Value> {
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

pub(crate) fn bind_project(payload: Value) -> AgentRuntimeResult<Value> {
    let id = payload
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let working_dir = string_opt(&payload, "workingDir")
        .ok_or_else(|| AgentRuntimeError::Core("workingDir is required".to_string()))?;
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let id = state.resolve_session_id(id)?;
    let session = state
        .sessions
        .get_mut(&id)
        .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {id}")))?;
    // Re-binding a session to a different project is intentionally not supported:
    // a session's accumulated tool history, file-read state, and rollback
    // checkpoints are all relative to its original root, so switching roots would
    // silently desynchronize them. Once a session is bound to a *real* project the
    // binding is permanent. A home-defaulted session (projectBound=true but
    // workingDirIsHome=true) may still be bound to a real project exactly once.
    // The UI removes the change-project affordance; this is the matching guard.
    let project_bound = session
        .snapshot
        .get("projectBound")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let is_home = session
        .snapshot
        .get("workingDirIsHome")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if project_bound && !is_home {
        return Err(AgentRuntimeError::Core(
            "session is already bound to a project and cannot be rebound".to_string(),
        ));
    }
    set_string(&mut session.snapshot, "workingDir", working_dir);
    set_bool(&mut session.snapshot, "projectBound", true);
    set_bool(&mut session.snapshot, "workingDirIsHome", false);
    touch_session(session);
    let snapshot = session.snapshot.clone();
    state.save_state()?;
    Ok(snapshot)
}

pub(crate) fn fork_session(payload: Value, label: &str) -> AgentRuntimeResult<Value> {
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
                .unwrap_or(DEFAULT_SESSION_TITLE)
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

pub(crate) fn compact_session(payload: Value) -> AgentRuntimeResult<Value> {
    let id = string_opt(&payload, "sessionId");
    let (callback, snapshot, projection, metrics) = {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let id = state.resolve_session_id(id)?;
        let long_term_memory = list_long_term_memory(
            &state.root,
            MemoryQuery {
                limit: 24,
                ..MemoryQuery::default()
            },
        )?;
        let session = state
            .sessions
            .get_mut(&id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {id}")))?;
        let projection = memory_projection_for_session(session, &long_term_memory, None);
        session.snapshot["memory"] = projection.clone();
        touch_session(session);
        let metrics = memory_projection_metrics(session, &projection);
        let snapshot = session.snapshot.clone();
        let callback = state.event_callback.clone();
        state.save_state()?;
        (callback, snapshot, projection, metrics)
    };
    let session_id = snapshot
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    emit_with_callback(
        &callback,
        json!({ "kind": "memoryUpdated", "sessionId": session_id, "snapshot": projection }),
    );
    emit_with_callback(
        &callback,
        json!({ "kind": "contextTrimmed", "sessionId": session_id, "detail": { "reason": "manual_compaction", "metrics": metrics.clone() } }),
    );
    emit_with_callback(
        &callback,
        json!({ "kind": "sessionSnapshot", "snapshot": snapshot }),
    );
    Ok(json!({
        "sessionId": session_id,
        "message": "Session context was compacted into structured Lyra memory without overwriting tail messages or latest user intent.",
        "success": true,
        "snapshot": snapshot,
        "memory": projection,
        "metrics": metrics,
    }))
}

pub(crate) fn update_automation(payload: Value) -> AgentRuntimeResult<Value> {
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
    touch_session(session);
    let snapshot = session.snapshot.clone();
    let automation = snapshot
        .get("automation")
        .cloned()
        .unwrap_or_else(|| json!({}));
    state.save_state()?;
    Ok(json!({ "sessionId": id, "automation": automation, "snapshot": snapshot }))
}
