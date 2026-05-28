use serde::Serialize;
use std::path::{Path, PathBuf};

use super::PersistVectorMode;
use crate::storage;

#[cfg(any(test, feature = "legacy-session-json"))]
pub(crate) fn session_path_in_dir(base: &std::path::Path, session_id: &str) -> PathBuf {
    base.join("sessions").join(format!("{}.json", session_id))
}

pub(super) fn estimate_json_bytes<T: Serialize>(value: &T) -> usize {
    serde_json::to_vec(value)
        .map(|bytes| bytes.len())
        .unwrap_or(0)
}

pub(super) fn file_len_or_zero(path: &Path) -> u64 {
    std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

pub(super) fn persist_vector_mode_label(mode: PersistVectorMode) -> &'static str {
    match mode {
        PersistVectorMode::Clean => "clean",
        PersistVectorMode::Append => "append",
        PersistVectorMode::Full => "full",
    }
}

#[cfg(any(test, feature = "legacy-session-json"))]
pub fn session_path(session_id: &str) -> anyhow::Result<PathBuf> {
    let base = storage::jcode_dir()?;
    Ok(session_path_in_dir(&base, session_id))
}

#[cfg(any(test, feature = "legacy-session-json"))]
pub(crate) fn session_journal_path_from_snapshot(path: &Path) -> PathBuf {
    let mut name = path
        .file_stem()
        .map(|stem| stem.to_os_string())
        .unwrap_or_default();
    name.push(".journal.jsonl");
    path.with_file_name(name)
}

#[cfg(any(test, feature = "legacy-session-json"))]
pub fn session_journal_path(session_id: &str) -> anyhow::Result<PathBuf> {
    Ok(session_journal_path_from_snapshot(&session_path(
        session_id,
    )?))
}

#[cfg(any(test, feature = "legacy-session-json"))]
pub fn session_exists(session_id: &str) -> bool {
    session_path(session_id)
        .map(|path| path.exists())
        .unwrap_or(false)
}

#[cfg(not(any(test, feature = "legacy-session-json")))]
pub fn session_exists(session_id: &str) -> bool {
    crate::memory::agent_runtime::AgentMemoryStore::new_default()
        .ok()
        .and_then(|store| store.read_session(session_id).ok().flatten())
        .is_some()
}
