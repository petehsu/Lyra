use super::*;

static ACTIVE_TURNS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

fn active_turns() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    ACTIVE_TURNS.get_or_init(|| Mutex::new(HashMap::new()))
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

pub(super) fn spawn_turn_worker(
    storage_root: Option<String>,
    session_id: String,
    turn_id: String,
    profile_id: String,
    model_override: Option<String>,
    workspace_root_override: Option<String>,
    permission_mode: PermissionMode,
    execution_target: ExecutionTarget,
) {
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut active) = active_turns().lock() {
        active.insert(turn_id.clone(), cancel.clone());
    }
    thread::spawn(move || {
        let result = run_turn_worker(
            storage_root.as_deref(),
            &session_id,
            &turn_id,
            &profile_id,
            model_override.as_deref(),
            workspace_root_override.as_deref(),
            permission_mode,
            execution_target,
            cancel.clone(),
        );
        if let Err(error) = result {
            record_worker_error(
                storage_root.as_deref(),
                &session_id,
                &turn_id,
                cancel.load(Ordering::Relaxed),
                error,
            );
        }
        if let Ok(mut active) = active_turns().lock() {
            active.remove(&turn_id);
        }
    });
}

pub(in crate::agent_runtime) fn resume_paused_turn(
    storage_root: Option<String>,
    session_id: &str,
    turn_id: &str,
) -> Result<bool> {
    let store = AiStore::open(storage_root.as_deref())?;
    let detail = store
        .read_session_detail(session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {session_id}"))?;
    let turn = detail
        .turns
        .iter()
        .find(|turn| turn.id == turn_id)
        .ok_or_else(|| anyhow!("AI turn not found: {turn_id}"))?;
    if turn.status != "paused" {
        return Ok(false);
    }
    store.update_turn_status(session_id, turn_id, "running", "model_queued", None, None)?;
    emit_store_event(
        &store,
        session_id,
        Some(turn_id),
        "runtime_turn_resumed",
        json!({ "turnId": turn_id, "reason": "clarification_answered" }),
    )?;
    spawn_turn_worker(
        storage_root,
        session_id.to_string(),
        turn_id.to_string(),
        turn.profile_id.clone(),
        None,
        detail.session.project_root.clone(),
        normalize_permission_mode(Some(&turn.permission_mode), None),
        normalize_execution_target(Some(&turn.execution_target)),
    );
    Ok(true)
}

fn run_turn_worker(
    storage_root: Option<&str>,
    session_id: &str,
    turn_id: &str,
    profile_id: &str,
    model_override: Option<&str>,
    workspace_root_override: Option<&str>,
    permission_mode: PermissionMode,
    execution_target: ExecutionTarget,
    cancel: Arc<AtomicBool>,
) -> Result<()> {
    let store = AiStore::open(storage_root)?;
    let config = runtime_config_for_profile(&store, profile_id, model_override)?;
    model_turn::run_turn_worker_inner(
        &store,
        config,
        session_id,
        turn_id,
        workspace_root_override,
        permission_mode,
        execution_target,
        cancel,
        model_turn::invoke_model_buffered,
    )
}

fn record_worker_error(
    storage_root: Option<&str>,
    session_id: &str,
    turn_id: &str,
    is_cancelled: bool,
    error: anyhow::Error,
) {
    let Ok(store) = AiStore::open(storage_root) else {
        return;
    };
    let status = if is_cancelled { "cancelled" } else { "failed" };
    let event_type = if is_cancelled {
        "runtime_turn_cancelled"
    } else {
        "runtime_error"
    };
    let error_message = error.to_string();
    let _ = store.update_turn_status(
        session_id,
        turn_id,
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
    let detail = store.read_session_detail(session_id).ok().flatten();
    let _ = emit_store_event(
        &store,
        session_id,
        Some(turn_id),
        event_type,
        json!({
            "turnId": turn_id,
            "message": if is_cancelled { "Turn cancelled".to_string() } else { error_message },
            "detail": detail
        }),
    );
}
