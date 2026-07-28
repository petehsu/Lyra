use super::*;
use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    time::SystemTime,
};

pub(super) fn record_file_read_state(
    session_id: &str,
    relative_path: &str,
    absolute_path: &Path,
    bytes: &[u8],
    size: u64,
    mtime_ms: u64,
    start_line: Option<usize>,
    end_line: Option<usize>,
) -> Result<String, NativeToolFailure> {
    let content_hash = stable_text_hash(bytes);
    let read_version = format!("{mtime_ms}-{size}-{content_hash}");
    let mut state = state().lock().map_err(|_| {
        NativeToolFailure::new(
            "runtime_state_unavailable",
            "agent runtime state lock failed while recording file read state",
            "Retry the tool call.",
        )
    })?;
    let session = state.sessions.get_mut(session_id).ok_or_else(|| {
        NativeToolFailure::new(
            "session_not_found",
            format!("session not found: {session_id}"),
            "Start a valid Lyra runtime session and retry.",
        )
    })?;
    session.file_read_state.insert(
        relative_path.to_string(),
        FileReadStateEntry {
            path: relative_path.to_string(),
            absolute_path: absolute_path.display().to_string(),
            read_version: read_version.clone(),
            content_hash,
            mtime_ms,
            size,
            start_line,
            end_line,
            read_at: now(),
        },
    );
    session.dirty = true;
    state.save_state().map_err(|error| {
        NativeToolFailure::new(
            "runtime_state_unavailable",
            format!("failed to save file read state: {error}"),
            "Retry the tool call.",
        )
    })?;
    Ok(read_version)
}

pub(super) fn validate_file_read_state(
    session_id: &str,
    relative_path: &str,
    absolute_path: &Path,
    current_bytes: &[u8],
    current_size: u64,
    current_mtime_ms: u64,
    expected_read_version: Option<&str>,
) -> Result<(), NativeToolFailure> {
    let current_hash = stable_text_hash(current_bytes);
    let entry = state()
        .lock()
        .map_err(|_| {
            NativeToolFailure::new(
                "runtime_state_unavailable",
                "agent runtime state lock failed while checking file read state",
                "Retry the tool call.",
            )
        })?
        .sessions
        .get(session_id)
        .and_then(|session| session.file_read_state.get(relative_path).cloned())
        .ok_or_else(|| {
            NativeToolFailure::new(
                "must_read_first",
                format!("file must be read before strict editing: {relative_path}"),
                "Inspect the file with exec_command (for example sed or cat) and use apply_patch for edits.",
            )
        })?;
    if let Some(expected) = expected_read_version
        && expected != entry.read_version
    {
        return Err(NativeToolFailure::new(
            "file_modified_since_read",
            "expectedReadVersion does not match the latest recorded readVersion",
            "Read the file again and retry with the new readVersion.",
        ));
    }
    if entry.absolute_path != absolute_path.display().to_string()
        || entry.size != current_size
        || entry.mtime_ms != current_mtime_ms
        || entry.content_hash != current_hash
    {
        return Err(NativeToolFailure::new(
            "file_modified_since_read",
            format!("file changed since it was last read: {relative_path}"),
            "Read the current file contents again before editing.",
        ));
    }
    Ok(())
}

pub(super) fn stable_text_hash(bytes: &[u8]) -> String {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

pub(super) fn metadata_mtime_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or_default()
}
