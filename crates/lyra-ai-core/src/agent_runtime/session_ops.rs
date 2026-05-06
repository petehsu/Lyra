use super::*;

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

pub(super) fn ensure_session(
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
