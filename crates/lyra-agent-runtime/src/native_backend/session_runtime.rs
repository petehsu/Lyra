use super::*;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy)]
struct TurnActivityState {
    last_progress_at: Instant,
    paused_at: Option<Instant>,
    pause_count: usize,
}

pub(crate) struct TurnActivityPauseGuard {
    turn_id: String,
}

impl Drop for TurnActivityPauseGuard {
    fn drop(&mut self) {
        resume_turn_activity(&self.turn_id);
    }
}

static TURN_CANCELLATIONS: OnceLock<Mutex<HashMap<String, CancellationToken>>> = OnceLock::new();
static CANCELLED_TURNS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static ACTIVE_TURNS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
static ACTIVE_UI_MESSAGES: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
static TURN_ACTIVITIES: OnceLock<Mutex<HashMap<String, TurnActivityState>>> = OnceLock::new();
static TURN_ACTIVITY_CHANGES: OnceLock<Mutex<HashMap<String, watch::Sender<u64>>>> =
    OnceLock::new();

fn turn_cancellations() -> &'static Mutex<HashMap<String, CancellationToken>> {
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

fn turn_activities() -> &'static Mutex<HashMap<String, TurnActivityState>> {
    TURN_ACTIVITIES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn turn_activity_changes() -> &'static Mutex<HashMap<String, watch::Sender<u64>>> {
    TURN_ACTIVITY_CHANGES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn turn_key(session_id: &str, turn_id: &str) -> String {
    format!("{session_id}:{turn_id}")
}

pub(crate) fn register_turn_cancellation(turn_id: &str, token: CancellationToken) {
    if let Ok(mut cancellations) = turn_cancellations().lock() {
        cancellations.insert(turn_id.to_string(), token);
    }
}

pub(crate) fn register_active_turn(session_id: &str, turn_id: &str, token: CancellationToken) {
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

/// Configurable idle-timeout for the turn watchdog. A turn that shows no
/// progress (no provider response, no tool completion) for this duration is
/// finalized as failed by the watchdog, unblocking the UI.
///
/// Default 120s. The watchdog pauses during user interaction waits
/// (permission/clarification), so this budget covers only active execution
/// stalls — a hung host dispatcher, a stuck tool join, a dead Oma worker.
/// Override with `LYRA_TURN_IDLE_TIMEOUT_SECS` env var.
pub(crate) fn idle_timeout() -> Duration {
    Duration::from_secs(
        std::env::var("LYRA_TURN_IDLE_TIMEOUT_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(120),
    )
}

/// Register a new turn for idle-watchdog tracking. The idle timer starts
/// ticking from `now`; subsequent `record_progress` calls reset it.
pub(crate) fn register_turn_activity(turn_id: &str) {
    if let Ok(mut activities) = turn_activities().lock() {
        activities.insert(
            turn_id.to_string(),
            TurnActivityState {
                last_progress_at: Instant::now(),
                paused_at: None,
                pause_count: 0,
            },
        );
    }
    if let Ok(mut changes) = turn_activity_changes().lock() {
        let (sender, _) = watch::channel(0);
        changes.insert(turn_id.to_string(), sender);
    }
}

/// Record that the turn made progress (provider response arrived, tool
/// completed, etc.). Resets the idle timer so the watchdog doesn't fire
/// while the turn is actively working.
///
/// No-op while the turn is paused (interaction wait) — the idle timer is
/// frozen during pauses and resumes on `resume_turn_activity`.
pub(crate) fn record_progress(turn_id: &str) {
    let now = Instant::now();
    let progressed = if let Ok(mut activities) = turn_activities().lock() {
        if let Some(state) = activities.get_mut(turn_id) {
            if state.pause_count == 0 {
                state.last_progress_at = now;
                true
            } else {
                false
            }
        } else {
            false
        }
    } else {
        false
    };
    if progressed {
        notify_turn_activity_changed(turn_id);
    }
}

/// Remaining idle time before the watchdog fires. Returns `None` if the
/// turn is not registered, `Duration::ZERO` if the idle budget is exhausted.
pub(crate) fn remaining_idle_time(turn_id: &str) -> Option<Duration> {
    turn_activities()
        .lock()
        .ok()
        .and_then(|activities| activities.get(turn_id).copied())
        .map(|state| {
            // When paused, freeze the elapsed calculation at `paused_at` so
            // the remaining time stays constant during interaction waits.
            let elapsed = state
                .paused_at
                .unwrap_or_else(Instant::now)
                .saturating_duration_since(state.last_progress_at);
            idle_timeout().saturating_sub(elapsed)
        })
}

pub(crate) fn turn_activity_is_paused(turn_id: &str) -> bool {
    turn_activities()
        .lock()
        .ok()
        .and_then(|activities| activities.get(turn_id).copied())
        .is_some_and(|state| state.pause_count > 0)
}

pub(crate) fn turn_activity_change_receiver(turn_id: &str) -> Option<watch::Receiver<u64>> {
    turn_activity_changes()
        .lock()
        .ok()
        .and_then(|changes| changes.get(turn_id).map(watch::Sender::subscribe))
}

pub(crate) fn pause_turn_activity(turn_id: &str) -> TurnActivityPauseGuard {
    if let Ok(mut activities) = turn_activities().lock()
        && let Some(state) = activities.get_mut(turn_id)
    {
        if state.pause_count == 0 {
            state.paused_at = Some(Instant::now());
        }
        state.pause_count += 1;
    }
    notify_turn_activity_changed(turn_id);
    TurnActivityPauseGuard {
        turn_id: turn_id.to_string(),
    }
}

fn resume_turn_activity(turn_id: &str) {
    let now = Instant::now();
    if let Ok(mut activities) = turn_activities().lock()
        && let Some(state) = activities.get_mut(turn_id)
    {
        state.pause_count = state.pause_count.saturating_sub(1);
        if state.pause_count == 0
            && let Some(paused_at) = state.paused_at.take()
        {
            // Shift last_progress_at forward by the paused duration so the
            // idle timer resumes from where it left off, not from the pause
            // start.
            state.last_progress_at += now.saturating_duration_since(paused_at);
        }
    }
    notify_turn_activity_changed(turn_id);
}

fn notify_turn_activity_changed(turn_id: &str) {
    if let Ok(changes) = turn_activity_changes().lock()
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
    if let Ok(mut activities) = turn_activities().lock() {
        activities.remove(turn_id);
    }
    if let Ok(mut changes) = turn_activity_changes().lock()
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
            token.cancel();
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
                .is_some_and(|token| token.is_cancelled())
        })
        .unwrap_or(true)
}

pub(crate) fn cancellation_token(turn_id: &str) -> Option<CancellationToken> {
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