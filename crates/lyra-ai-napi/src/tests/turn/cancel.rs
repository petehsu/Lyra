use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::turn::cancel::{
    cancel_turn, clear_turn, register_turn, session_has_active_turn, shutdown_all,
};

#[test]
fn cancels_only_matching_turns() {
    shutdown_all();
    let flag = Arc::new(AtomicBool::new(false));
    register_turn(
        "turn-1".to_string(),
        "session-1".to_string(),
        Arc::clone(&flag),
    );

    assert!(!cancel_turn("session-2", "turn-1"));
    assert!(cancel_turn("session-1", "turn-1"));
    assert!(flag.load(Ordering::Relaxed));

    clear_turn("turn-1");
    assert!(session_has_active_turn("session-1").is_none());
}

#[test]
fn shutdown_marks_all_turns_as_cancelled() {
    shutdown_all();
    let flag = Arc::new(AtomicBool::new(false));
    register_turn(
        "turn-2".to_string(),
        "session-2".to_string(),
        Arc::clone(&flag),
    );

    shutdown_all();

    assert!(flag.load(Ordering::Relaxed));
    assert!(session_has_active_turn("session-2").is_none());
}
