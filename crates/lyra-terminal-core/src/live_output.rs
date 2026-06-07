//! Live terminal output buffering and UTF-8 projection.
//!
//! This module owns the in-memory read buffer used while a terminal is running.
//! Durable terminal memory lives in `memory`; this is only the short-lived live
//! projection needed by `read_session` and waiters.

use std::sync::{Arc, Condvar, Mutex};

use once_cell::sync::Lazy;

use crate::MAX_SESSION_BUFFER_BYTES;

static LIVE_ANSI_CSI_RE: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]").expect("valid CSI regex"));
static LIVE_ANSI_OSC_RE: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r"\x1b\][^\x07]*(?:\x07|\x1b\\)").expect("valid OSC regex"));

pub(crate) type SessionStateHandle = Arc<(Mutex<SessionOutputState>, Condvar)>;

#[derive(Default)]
pub(crate) struct SessionOutputState {
    pub(crate) buffer: Vec<u8>,
    pub(crate) retained_start: u64,
    pub(crate) total_bytes: u64,
    pub(crate) text_buffer: Vec<u8>,
    pub(crate) text_retained_start: u64,
    pub(crate) total_text_bytes: u64,
    pub(crate) text_decoder: Utf8StreamDecoder,
    pub(crate) running: bool,
    pub(crate) exit_code: Option<i32>,
}

#[derive(Default)]
pub(crate) struct Utf8StreamDecoder {
    pending: Vec<u8>,
}

impl Utf8StreamDecoder {
    pub(crate) fn decode(&mut self, chunk: &[u8]) -> String {
        if self.pending.is_empty() {
            return decode_utf8_prefix(chunk, &mut self.pending);
        }
        let mut bytes = Vec::with_capacity(self.pending.len() + chunk.len());
        bytes.extend_from_slice(&self.pending);
        bytes.extend_from_slice(chunk);
        self.pending.clear();
        decode_utf8_prefix(&bytes, &mut self.pending)
    }

    pub(crate) fn finish(&mut self) -> String {
        if self.pending.is_empty() {
            return String::new();
        }
        let text = String::from_utf8_lossy(&self.pending).to_string();
        self.pending.clear();
        text
    }
}

fn decode_utf8_prefix(bytes: &[u8], pending: &mut Vec<u8>) -> String {
    let mut output = String::new();
    let mut cursor = 0;
    while cursor < bytes.len() {
        match std::str::from_utf8(&bytes[cursor..]) {
            Ok(valid) => {
                output.push_str(valid);
                break;
            }
            Err(error) => {
                let valid_end = cursor + error.valid_up_to();
                if valid_end > cursor {
                    output.push_str(
                        std::str::from_utf8(&bytes[cursor..valid_end])
                            .expect("valid prefix from UTF-8 error"),
                    );
                }
                match error.error_len() {
                    Some(invalid_len) => {
                        output.push('\u{FFFD}');
                        cursor = valid_end + invalid_len;
                    }
                    None => {
                        pending.extend_from_slice(&bytes[valid_end..]);
                        break;
                    }
                }
            }
        }
    }
    output
}

pub(crate) fn new_running_state() -> SessionStateHandle {
    Arc::new((
        Mutex::new(SessionOutputState {
            running: true,
            ..SessionOutputState::default()
        }),
        Condvar::new(),
    ))
}

pub(crate) fn append_output(state_handle: &SessionStateHandle, data: &[u8]) {
    let (lock, condvar) = &**state_handle;
    if let Ok(mut state) = lock.lock() {
        state.buffer.extend_from_slice(data);
        state.total_bytes = state.total_bytes.saturating_add(data.len() as u64);
        if state.buffer.len() > MAX_SESSION_BUFFER_BYTES {
            let excess = state.buffer.len() - MAX_SESSION_BUFFER_BYTES;
            state.buffer.drain(0..excess);
            state.retained_start = state.retained_start.saturating_add(excess as u64);
        }
        let decoded = state.text_decoder.decode(data);
        let text = strip_live_terminal_control_sequences(&decoded);
        state.text_buffer.extend_from_slice(text.as_bytes());
        state.total_text_bytes = state.total_text_bytes.saturating_add(text.len() as u64);
        if state.text_buffer.len() > MAX_SESSION_BUFFER_BYTES {
            let excess = state.text_buffer.len() - MAX_SESSION_BUFFER_BYTES;
            state.text_buffer.drain(0..excess);
            state.text_retained_start = state.text_retained_start.saturating_add(excess as u64);
        }
        condvar.notify_all();
    }
}

fn strip_live_terminal_control_sequences(text: &str) -> String {
    let without_osc = LIVE_ANSI_OSC_RE.replace_all(text, "");
    LIVE_ANSI_CSI_RE.replace_all(&without_osc, "").to_string()
}

pub(crate) fn live_output_projection(
    state: &SessionOutputState,
    requested_cursor: u64,
    max_bytes: usize,
) -> (u64, String, bool) {
    let available_start = requested_cursor.max(state.text_retained_start);
    let start_offset = available_start
        .saturating_sub(state.text_retained_start)
        .min(state.text_buffer.len() as u64) as usize;
    let end_offset = (start_offset + max_bytes).min(state.text_buffer.len());
    let output = String::from_utf8_lossy(&state.text_buffer[start_offset..end_offset]).to_string();
    let cursor = state.text_retained_start.saturating_add(end_offset as u64);
    let truncated = requested_cursor < state.text_retained_start || cursor < state.total_text_bytes;
    (cursor, output, truncated)
}

pub(crate) fn mark_session_exit(state_handle: &SessionStateHandle, exit_code: i32) {
    let (lock, condvar) = &**state_handle;
    if let Ok(mut state) = lock.lock() {
        state.running = false;
        state.exit_code = Some(exit_code);
        condvar.notify_all();
    }
}
