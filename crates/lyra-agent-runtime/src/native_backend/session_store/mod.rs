use super::*;

mod persist;
pub(crate) mod schema;

pub(crate) fn session_dir(root: &Path, session_id: &str) -> PathBuf {
    root.join("sessions").join(session_id)
}

pub(crate) fn session_db_path(root: &Path, session_id: &str) -> PathBuf {
    session_dir(root, session_id).join("session.sqlite")
}

pub(crate) fn load_session(
    root: &Path,
    session_id: &str,
) -> AgentRuntimeResult<Option<NativeSession>> {
    persist::load_session(root, session_id)
}

pub(crate) fn save_session(root: &Path, session: &NativeSession) -> AgentRuntimeResult<()> {
    persist::save_session(root, session)
}

pub(crate) fn delete_session_store(root: &Path, session_id: &str) -> AgentRuntimeResult<()> {
    let dir = session_dir(root, session_id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    }
    Ok(())
}

pub(crate) fn list_session_ids(root: &Path) -> AgentRuntimeResult<Vec<String>> {
    let sessions_root = root.join("sessions");
    if !sessions_root.is_dir() {
        return Ok(Vec::new());
    }
    let mut ids = Vec::new();
    for entry in
        fs::read_dir(&sessions_root).map_err(|error| AgentRuntimeError::Core(error.to_string()))?
    {
        let entry = entry.map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        if !entry
            .file_type()
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?
            .is_dir()
        {
            continue;
        }
        let session_id = entry.file_name().to_string_lossy().to_string();
        if session_db_path(root, &session_id).is_file() {
            ids.push(session_id);
        }
    }
    ids.sort();
    Ok(ids)
}
