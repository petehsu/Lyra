use super::*;

pub(super) fn run_memory_remember(
    input: &Value,
    project_root: Option<&str>,
    storage_root: Option<&str>,
) -> Result<Value, AgentToolError> {
    let obj = as_object(input)?;
    let value = required_string(obj, "value")?;
    let scope = obj.get("scope").and_then(Value::as_str).unwrap_or("global");
    let layer = obj.get("layer").and_then(Value::as_str).unwrap_or("shared");

    if !matches!(scope, "project" | "global" | "user") {
        return Err(AgentToolError::exec_failed(
            "scope must be 'project', 'global', or 'user'",
        ));
    }
    if !matches!(layer, "shared" | "frozen") {
        return Err(AgentToolError::exec_failed(
            "layer must be 'shared' or 'frozen'",
        ));
    }

    // We need a storage root to write memory. Derive from project_root or fallback.
    let storage_root = resolve_memory_storage_root(storage_root, project_root)?;
    let effective_project = if scope == "project" {
        project_root
    } else {
        None
    };

    crate::memory::upsert_shared_entry_public(
        &storage_root,
        layer,
        scope,
        effective_project,
        &value,
        None,
        None,
        true,
        0.95,
    )
    .map_err(|e| AgentToolError::exec_failed(format!("failed to save memory: {e}")))?;

    Ok(json!({
        "kind": "remembered",
        "layer": layer,
        "scope": scope,
        "content": value,
    }))
}

pub(super) fn run_memory_recall(
    input: &Value,
    project_root: Option<&str>,
    storage_root: Option<&str>,
) -> Result<Value, AgentToolError> {
    let obj = as_object(input)?;
    let query = required_string(obj, "query")?;
    let scope_filter = obj.get("scope").and_then(Value::as_str);
    let limit = obj
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(5)
        .min(20) as usize;

    let storage_root = resolve_memory_storage_root(storage_root, project_root)?;

    let results = crate::memory::recall_shared_entries(
        &storage_root,
        &query,
        scope_filter,
        project_root,
        limit,
    )
    .map_err(|e| AgentToolError::exec_failed(format!("failed to recall memory: {e}")))?;

    Ok(json!({
        "kind": "recalled",
        "count": results.len(),
        "entries": results,
    }))
}

fn resolve_memory_storage_root(
    explicit_storage_root: Option<&str>,
    _project_root: Option<&str>,
) -> Result<String, AgentToolError> {
    if let Some(storage_root) = explicit_storage_root {
        let trimmed = storage_root.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    // Resolve the storage root from the home directory's .lyra path
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| AgentToolError::exec_failed("cannot determine home directory"))?;
    Ok(format!("{home}/.lyra"))
}
