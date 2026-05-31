use super::*;

pub(crate) fn required_session_id(payload: &Value) -> AgentRuntimeResult<String> {
    payload
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| AgentRuntimeError::Core("sessionId is required".to_string()))
}

pub(crate) fn string_opt(payload: &Value, key: &str) -> Option<String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(crate) fn empty_side_panel() -> Value {
    json!({ "focusedPageId": Value::Null, "pages": [] })
}

pub(crate) fn push_array(value: &mut Value, key: &str, item: Value) {
    if !value.get(key).is_some_and(Value::is_array) {
        value[key] = Value::Array(Vec::new());
    }
    if let Some(items) = value.get_mut(key).and_then(Value::as_array_mut) {
        items.push(item);
    }
}

pub(crate) fn set_string(value: &mut Value, key: &str, next: String) {
    if let Some(object) = value.as_object_mut() {
        object.insert(key.to_string(), Value::String(next));
    }
}

pub(crate) fn set_bool(value: &mut Value, key: &str, next: bool) {
    if let Some(object) = value.as_object_mut() {
        object.insert(key.to_string(), Value::Bool(next));
    }
}

pub(crate) fn touch_snapshot(snapshot: &mut Value) {
    set_string(snapshot, "updatedAt", now());
    let memory = snapshot
        .get("memory")
        .cloned()
        .filter(|value| !value.is_null())
        .unwrap_or(Value::Null);
    snapshot["memory"] = memory;
}

pub(crate) fn touch_session(session: &mut NativeSession) {
    touch_snapshot(&mut session.snapshot);
    session.dirty = true;
}

pub(crate) fn is_deleted(snapshot: &Value) -> bool {
    snapshot.get("turnStatus").and_then(Value::as_str) == Some("deleted")
}

pub(crate) fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub(crate) fn iso_ms(value: &str) -> i64 {
    DateTime::parse_from_rfc3339(value)
        .map(|time| time.timestamp_millis())
        .unwrap_or_else(|_| Utc::now().timestamp_millis())
}

pub(crate) fn emit_with_callback(callback: &Option<Arc<EventCallback>>, event: Value) {
    if let Some(callback) = callback
        && let Ok(payload) = serde_json::to_string(&event)
    {
        callback(payload);
    }
}
