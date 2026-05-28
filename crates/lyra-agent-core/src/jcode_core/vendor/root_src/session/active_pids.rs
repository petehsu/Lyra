use super::*;

pub(super) fn active_pids_dir() -> Option<std::path::PathBuf> {
    #[cfg(not(test))]
    {
        None
    }
    #[cfg(test)]
    {
        storage::jcode_dir().ok().map(|d| d.join("active_pids"))
    }
}

#[cfg(not(test))]
pub(super) fn register_active_pid(session_id: &str, pid: u32) {
    let Ok(store) = crate::memory::agent_runtime::AgentMemoryStore::new_default() else {
        return;
    };
    let _ = store.ensure_session_with_id(
        session_id,
        crate::memory::agent_runtime::CreateSessionInput {
            title: None,
            working_dir: None,
            provider_key: None,
            model: None,
        },
    );
    let _ = store.record_active_process(
        session_id,
        None,
        pid,
        "session",
        serde_json::json!({ "sessionId": session_id, "pid": pid }),
    );
}

#[cfg(test)]
pub(super) fn register_active_pid(session_id: &str, pid: u32) {
    let _ = (session_id, pid);
}

#[cfg(not(test))]
pub(super) fn unregister_active_pid(session_id: &str) {
    if let Ok(store) = crate::memory::agent_runtime::AgentMemoryStore::new_default() {
        let _ = store.mark_active_process_stopped(session_id, None);
    }
}

#[cfg(test)]
pub(super) fn unregister_active_pid(session_id: &str) {
    let _ = session_id;
}

#[cfg(not(test))]
/// Find the active session ID currently owned by the given process ID.
pub fn find_active_session_id_by_pid(pid: u32) -> Option<String> {
    crate::memory::agent_runtime::AgentMemoryStore::new_default()
        .ok()
        .and_then(|store| store.active_session_id_by_pid(pid).ok().flatten())
}

#[cfg(test)]
/// Find the active session ID currently owned by the given process ID.
pub fn find_active_session_id_by_pid(pid: u32) -> Option<String> {
    let _ = pid;
    None
}

#[cfg(not(test))]
/// List active session IDs currently tracked in structured memory.
pub fn active_session_ids() -> Vec<String> {
    crate::memory::agent_runtime::AgentMemoryStore::new_default()
        .ok()
        .and_then(|store| store.active_process_session_ids().ok())
        .unwrap_or_default()
}

#[cfg(test)]
/// List active session IDs currently tracked in ~/.jcode/active_pids.
pub fn active_session_ids() -> Vec<String> {
    Vec::new()
}
