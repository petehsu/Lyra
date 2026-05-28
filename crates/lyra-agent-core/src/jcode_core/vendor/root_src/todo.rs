use anyhow::Result;

pub use jcode_task_types::TodoItem;

pub fn load_todos(session_id: &str) -> Result<Vec<TodoItem>> {
    let store = crate::memory::agent_runtime::AgentMemoryStore::new_default()?;
    let todos = store
        .active_todos_for_session(session_id)?
        .into_iter()
        .filter_map(|value| serde_json::from_value::<TodoItem>(value).ok())
        .collect();
    Ok(todos)
}

pub fn save_todos(session_id: &str, todos: &[TodoItem]) -> Result<()> {
    let store = crate::memory::agent_runtime::AgentMemoryStore::new_default()?;
    let values = todos
        .iter()
        .map(serde_json::to_value)
        .collect::<Result<Vec<_>, _>>()?;
    let runtime_turn_id = store.latest_open_runtime_turn_id(session_id)?;
    store.record_active_todos_for_session(session_id, runtime_turn_id.as_deref(), &values)?;
    Ok(())
}
