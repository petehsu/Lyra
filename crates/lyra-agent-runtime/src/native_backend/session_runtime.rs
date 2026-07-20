use super::*;
use tokio::sync::watch;

#[derive(Clone, Copy)]
struct TurnDeadlineState {
    deadline: Instant,
    paused_at: Option<Instant>,
    pause_count: usize,
}

pub(crate) struct TurnDeadlinePauseGuard {
    turn_id: String,
}

impl Drop for TurnDeadlinePauseGuard {
    fn drop(&mut self) {
        resume_turn_deadline(&self.turn_id);
    }
}

static TURN_CANCELLATIONS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
static CANCELLED_TURNS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static ACTIVE_TURNS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
static ACTIVE_UI_MESSAGES: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
static TURN_DEADLINES: OnceLock<Mutex<HashMap<String, TurnDeadlineState>>> = OnceLock::new();
static TURN_DEADLINE_CHANGES: OnceLock<Mutex<HashMap<String, watch::Sender<u64>>>> =
    OnceLock::new();

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

fn turn_deadlines() -> &'static Mutex<HashMap<String, TurnDeadlineState>> {
    TURN_DEADLINES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn turn_deadline_changes() -> &'static Mutex<HashMap<String, watch::Sender<u64>>> {
    TURN_DEADLINE_CHANGES.get_or_init(|| Mutex::new(HashMap::new()))
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

pub(crate) fn turn_is_active(session_id: &str, turn_id: &str) -> bool {
    if turn_cancellation_requested(turn_id) {
        return false;
    }
    if let Some(active_turn_id) = active_turn_id(session_id) {
        return active_turn_id == turn_id;
    }
    state()
        .lock()
        .map(|state| {
            state.sessions.get(session_id).is_some_and(|session| {
                session.snapshot.get("turnStatus").and_then(Value::as_str) == Some("running")
                    && session.snapshot.get("activeTurnId").and_then(Value::as_str) == Some(turn_id)
            })
        })
        .unwrap_or(false)
}

pub(crate) fn register_turn_deadline(turn_id: &str, deadline: Instant) {
    if let Ok(mut deadlines) = turn_deadlines().lock() {
        deadlines.insert(
            turn_id.to_string(),
            TurnDeadlineState {
                deadline,
                paused_at: None,
                pause_count: 0,
            },
        );
    }
    if let Ok(mut changes) = turn_deadline_changes().lock() {
        let (sender, _) = watch::channel(0);
        changes.insert(turn_id.to_string(), sender);
    }
}

pub(crate) fn remaining_turn_time(turn_id: &str) -> Option<Duration> {
    turn_deadlines()
        .lock()
        .ok()
        .and_then(|deadlines| deadlines.get(turn_id).copied())
        .map(|state| {
            state
                .deadline
                .saturating_duration_since(state.paused_at.unwrap_or_else(Instant::now))
        })
}

pub(crate) fn turn_deadline_is_paused(turn_id: &str) -> bool {
    turn_deadlines()
        .lock()
        .ok()
        .and_then(|deadlines| deadlines.get(turn_id).copied())
        .is_some_and(|state| state.pause_count > 0)
}

pub(crate) fn turn_deadline_change_receiver(turn_id: &str) -> Option<watch::Receiver<u64>> {
    turn_deadline_changes()
        .lock()
        .ok()
        .and_then(|changes| changes.get(turn_id).map(watch::Sender::subscribe))
}

pub(crate) fn pause_turn_deadline(turn_id: &str) -> TurnDeadlinePauseGuard {
    if let Ok(mut deadlines) = turn_deadlines().lock()
        && let Some(state) = deadlines.get_mut(turn_id)
    {
        if state.pause_count == 0 {
            state.paused_at = Some(Instant::now());
        }
        state.pause_count += 1;
    }
    notify_turn_deadline_changed(turn_id);
    TurnDeadlinePauseGuard {
        turn_id: turn_id.to_string(),
    }
}

fn resume_turn_deadline(turn_id: &str) {
    let now = Instant::now();
    if let Ok(mut deadlines) = turn_deadlines().lock()
        && let Some(state) = deadlines.get_mut(turn_id)
    {
        state.pause_count = state.pause_count.saturating_sub(1);
        if state.pause_count == 0
            && let Some(paused_at) = state.paused_at.take()
        {
            state.deadline += now.saturating_duration_since(paused_at);
        }
    }
    notify_turn_deadline_changed(turn_id);
}

fn notify_turn_deadline_changed(turn_id: &str) {
    if let Ok(changes) = turn_deadline_changes().lock()
        && let Some(sender) = changes.get(turn_id)
    {
        sender.send_modify(|version| *version = version.wrapping_add(1));
    }
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
    if let Ok(mut deadlines) = turn_deadlines().lock() {
        deadlines.remove(turn_id);
    }
    if let Ok(mut changes) = turn_deadline_changes().lock()
        && let Some(sender) = changes.remove(turn_id)
    {
        sender.send_modify(|version| *version = version.wrapping_add(1));
    }
    clear_turn_cancellation(turn_id);
    clear_active_ui_message_id(session_id, turn_id);
}

pub(crate) fn request_turn_cancellation(turn_id: &str) -> bool {
    if let Ok(mut cancelled) = cancelled_turns().lock() {
        cancelled.insert(turn_id.to_string());
    }
    // Wake any permission/clarification waiter parked for this turn so
    // cancellation interrupts the wait immediately instead of letting it
    // sit out its timeout.
    super::waiters::cancel_turn_waiters(turn_id);
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
