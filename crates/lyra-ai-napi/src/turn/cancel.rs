use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use once_cell::sync::Lazy;

#[derive(Clone)]
struct ActiveTurnHandle {
    session_id: String,
    cancel_flag: Arc<AtomicBool>,
}

static ACTIVE_TURNS: Lazy<Mutex<HashMap<String, ActiveTurnHandle>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn register_turn(turn_id: String, session_id: String, cancel_flag: Arc<AtomicBool>) {
    if let Ok(mut guard) = ACTIVE_TURNS.lock() {
        guard.insert(
            turn_id,
            ActiveTurnHandle {
                session_id,
                cancel_flag,
            },
        );
    }
}

pub fn clear_turn(turn_id: &str) {
    if let Ok(mut guard) = ACTIVE_TURNS.lock() {
        guard.remove(turn_id);
    }
}

pub fn session_has_active_turn(session_id: &str) -> Option<String> {
    ACTIVE_TURNS.lock().ok().and_then(|guard| {
        guard
            .iter()
            .find(|(_, handle)| handle.session_id == session_id)
            .map(|(turn_id, _)| turn_id.clone())
    })
}

pub fn cancel_turn(session_id: &str, turn_id: &str) -> bool {
    let Ok(guard) = ACTIVE_TURNS.lock() else {
        return false;
    };
    let Some(handle) = guard.get(turn_id) else {
        return false;
    };
    if handle.session_id != session_id {
        return false;
    }
    handle
        .cancel_flag
        .store(true, std::sync::atomic::Ordering::Relaxed);
    true
}

pub fn shutdown_all() {
    if let Ok(mut guard) = ACTIVE_TURNS.lock() {
        for handle in guard.values() {
            handle
                .cancel_flag
                .store(true, std::sync::atomic::Ordering::Relaxed);
        }
        guard.clear();
    }
}
