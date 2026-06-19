use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::Instant,
};

const PREVIEW_KEY_SEP: &str = ":";

static PREVIEW_STATE: OnceLock<Mutex<HashMap<String, PreviewEntry>>> = OnceLock::new();

#[derive(Clone, Debug)]
pub(crate) struct PreviewEntry {
    pub(crate) started: bool,
    pub(crate) started_at: String,
    pub(crate) last_emitted_at: Instant,
    pub(crate) last_diff_hash: u64,
}

fn preview_state() -> &'static Mutex<HashMap<String, PreviewEntry>> {
    PREVIEW_STATE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn preview_key(session_id: &str, turn_id: &str, tool_call_id: &str) -> String {
    [session_id, turn_id, tool_call_id].join(PREVIEW_KEY_SEP)
}

pub(crate) fn with_preview_entry<R>(
    key: &str,
    f: impl FnOnce(&mut PreviewEntry) -> R,
    create: impl FnOnce() -> PreviewEntry,
) -> R {
    let mut state = preview_state()
        .lock()
        .expect("streaming diff preview state");
    let entry = state.entry(key.to_string()).or_insert_with(create);
    f(entry)
}

pub(crate) fn clear_streaming_diff_preview_state(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
) {
    let key = preview_key(session_id, turn_id, tool_call_id);
    if let Ok(mut state) = preview_state().lock() {
        state.remove(&key);
    }
}
