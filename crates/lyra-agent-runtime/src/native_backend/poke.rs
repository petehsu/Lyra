use super::*;

pub(crate) fn poke_session(payload: Value) -> AgentRuntimeResult<Value> {
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
