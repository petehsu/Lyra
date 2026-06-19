use super::*;

static TURN_CANCELLATIONS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
static CANCELLED_TURNS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static ACTIVE_TURNS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
static ACTIVE_UI_MESSAGES: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn turn_cancellations() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    TURN_CANCELLATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cancelled_turns() -> &'static Mutex<HashSet<String>> {
    CANCELLED_TURNS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn active_turns() -> &'static Mutex<HashMap<String, String>> {
    ACTIVE_TURNS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn active_ui_messages() -> &'static Mutex<HashMap<String, String>> {
    ACTIVE_UI_MESSAGES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn turn_key(session_id: &str, turn_id: &str) -> String {
    format!("{session_id}:{turn_id}")
}

pub(crate) fn register_turn_cancellation(turn_id: &str, token: Arc<AtomicBool>) {
    if let Ok(mut cancellations) = turn_cancellations().lock() {
        cancellations.insert(turn_id.to_string(), token);
    }
}

pub(crate) fn register_active_turn(session_id: &str, turn_id: &str, token: Arc<AtomicBool>) {
    register_turn_cancellation(turn_id, token);
    if let Ok(mut active) = active_turns().lock() {
        active.insert(session_id.to_string(), turn_id.to_string());
    }
}

pub(crate) fn active_turn_id(session_id: &str) -> Option<String> {
    active_turns()
        .lock()
        .ok()
        .and_then(|active| active.get(session_id).cloned())
}

pub(crate) fn unregister_turn_cancellation(turn_id: &str) {
    if let Ok(mut cancellations) = turn_cancellations().lock() {
        cancellations.remove(turn_id);
    }
}

pub(crate) fn clear_active_turn(session_id: &str, turn_id: &str) {
    if let Ok(mut active) = active_turns().lock()
        && active
            .get(session_id)
            .is_some_and(|active_turn| active_turn == turn_id)
    {
        active.remove(session_id);
    }
    clear_turn_cancellation(turn_id);
    clear_active_ui_message_id(session_id, turn_id);
}

pub(crate) fn request_turn_cancellation(turn_id: &str) -> bool {
    if let Ok(mut cancelled) = cancelled_turns().lock() {
        cancelled.insert(turn_id.to_string());
    }
    turn_cancellations()
        .lock()
        .ok()
        .and_then(|cancellations| cancellations.get(turn_id).cloned())
        .map(|token| {
            token.store(true, Ordering::SeqCst);
            true
        })
        .unwrap_or(false)
}

pub(crate) fn clear_turn_cancellation(turn_id: &str) {
    if let Ok(mut cancelled) = cancelled_turns().lock() {
        cancelled.remove(turn_id);
    }
    unregister_turn_cancellation(turn_id);
}

pub(crate) fn turn_cancellation_requested(turn_id: &str) -> bool {
    if cancelled_turns()
        .lock()
        .map(|cancelled| cancelled.contains(turn_id))
        .unwrap_or(true)
    {
        return true;
    }
    turn_cancellations()
        .lock()
        .map(|cancellations| {
            cancellations
                .get(turn_id)
                .map(|token| token.load(Ordering::SeqCst))
                .unwrap_or(false)
        })
        .unwrap_or(true)
}

pub(crate) fn cancellation_token(turn_id: &str) -> Option<Arc<AtomicBool>> {
    turn_cancellations()
        .lock()
        .ok()
        .and_then(|cancellations| cancellations.get(turn_id).cloned())
}

pub(crate) fn set_active_ui_message_id(session_id: &str, turn_id: &str, message_id: &str) {
    if let Ok(mut messages) = active_ui_messages().lock() {
        messages.insert(turn_key(session_id, turn_id), message_id.to_string());
    }
}

pub(crate) fn active_ui_message_id(session_id: &str, turn_id: &str) -> Option<String> {
    active_ui_messages()
        .lock()
        .ok()
        .and_then(|messages| messages.get(&turn_key(session_id, turn_id)).cloned())
}

pub(crate) fn clear_active_ui_message_id(session_id: &str, turn_id: &str) {
    if let Ok(mut messages) = active_ui_messages().lock() {
        messages.remove(&turn_key(session_id, turn_id));
    }
}
