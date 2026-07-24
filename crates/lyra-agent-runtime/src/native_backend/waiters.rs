//! Event-driven wake-ups for turn-blocking user interactions (permission
//! approvals and clarification answers).
//!
//! Replaces the legacy 25ms polling loops (`permissions.rs`,
//! `clarifications.rs`) that re-acquired the global state lock up to 24,000
//! times per wait and could burn the full 10-minute budget when a response
//! was routed while the poller slept. The waiting turn now parks on a
//! oneshot channel; the responding side (`respond_permission`,
//! `respond_clarification`, turn cancellation) fires it directly, so wake
//! latency is scheduler-bound and cancellation interrupts a wait instantly.
//!
//! The pending request state in `NativeRuntimeState` remains the source of
//! truth (it survives restarts); the channel is only the wake-up. Waiters
//! double-check pending state after registering, so a response that lands
//! before registration is never lost.

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

use crate::recovering_mutex::RecoveringMutex as Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WaitSignal {
    /// `respond_permission` arrived with this decision.
    PermissionDecision(bool),
    /// `respond_clarification` arrived; the answer payload lives in pending
    /// clarification state.
    ClarificationAnswered,
    /// The owning turn was cancelled.
    Cancelled,
}

struct Waiter {
    turn_id: String,
    sender: oneshot::Sender<WaitSignal>,
}

static WAITERS: OnceLock<Mutex<HashMap<String, Waiter>>> = OnceLock::new();

fn waiters() -> &'static Mutex<HashMap<String, Waiter>> {
    WAITERS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Register a wake-up channel for a pending request owned by `turn_id`.
/// Call BEFORE exposing the pending request to responders.
pub(crate) fn register(request_id: &str, turn_id: &str) -> oneshot::Receiver<WaitSignal> {
    let (sender, receiver) = oneshot::channel();
    if let Ok(mut map) = waiters().lock() {
        map.insert(
            request_id.to_string(),
            Waiter {
                turn_id: turn_id.to_string(),
                sender,
            },
        );
    }
    receiver
}

/// Drop the waiter for a request without firing it (timeout/cancel cleanup).
pub(crate) fn unregister(request_id: &str) {
    if let Ok(mut map) = waiters().lock() {
        map.remove(request_id);
    }
}

/// Fire the waiter for a request. Returns false when no waiter was parked
/// (it timed out, was cancelled, or has not registered yet — pending state
/// still records the response for the double-check path).
pub(crate) fn resolve(request_id: &str, signal: WaitSignal) -> bool {
    let waiter = waiters()
        .lock()
        .ok()
        .and_then(|mut map| map.remove(request_id));
    match waiter {
        Some(waiter) => waiter.sender.send(signal).is_ok(),
        None => false,
    }
}

/// Fire `Cancelled` into every waiter owned by a turn. Hooked into turn
/// cancellation so a cancelled turn never sits out a wait timeout.
pub(crate) fn cancel_turn_waiters(turn_id: &str) {
    let fired = waiters()
        .lock()
        .map(|mut map| {
            let request_ids = map
                .iter()
                .filter(|(_, waiter)| waiter.turn_id == turn_id)
                .map(|(request_id, _)| request_id.clone())
                .collect::<Vec<_>>();
            request_ids
                .into_iter()
                .filter_map(|request_id| map.remove(&request_id))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for waiter in fired {
        let _ = waiter.sender.send(WaitSignal::Cancelled);
    }
}

/// Park until the signal arrives or the timeout elapses. `None` = timeout or
/// the runtime dropped the sender.
pub(crate) async fn wait_async(
    receiver: oneshot::Receiver<WaitSignal>,
    timeout: Option<Duration>,
) -> Option<WaitSignal> {
    match timeout {
        Some(timeout) => tokio::time::timeout(timeout, receiver)
            .await
            .ok()
            .and_then(Result::ok),
        None => receiver.await.ok(),
    }
}

/// Park until a waiter signal, timeout, or cancellation.
///
/// Production turn cancellation resolves the waiter directly. The token check
/// is still required for worker-local timeout paths that only cancel the shared
/// `CancellationToken`.
pub(crate) async fn wait_with_cancellation_async(
    mut receiver: oneshot::Receiver<WaitSignal>,
    timeout: Option<Duration>,
    cancellation: Option<CancellationToken>,
) -> Option<WaitSignal> {
    let Some(cancellation) = cancellation else {
        return wait_async(receiver, timeout).await;
    };
    let deadline = async move {
        match timeout {
            Some(timeout) => tokio::time::sleep(timeout).await,
            None => std::future::pending().await,
        }
    };
    tokio::pin!(deadline);
    let mut cancellation_check = tokio::time::interval(Duration::from_millis(10));
    loop {
        tokio::select! {
            signal = &mut receiver => return signal.ok(),
            _ = &mut deadline => return None,
            _ = cancellation_check.tick() => {
                if cancellation.is_cancelled() {
                    return Some(WaitSignal::Cancelled);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_backend::turn_engine;
    use std::time::Instant;

    #[test]
    fn resolve_wakes_waiter_immediately() {
        let receiver = register("request-wake", "turn-wake");
        let responder = std::thread::spawn(|| {
            assert!(resolve(
                "request-wake",
                WaitSignal::PermissionDecision(true)
            ));
        });
        let started = Instant::now();
        let signal = turn_engine::block_on(wait_async(receiver, Some(Duration::from_secs(5))));
        responder.join().expect("responder thread");
        assert_eq!(signal, Some(WaitSignal::PermissionDecision(true)));
        // Event-driven wake: far below the legacy 25ms poll interval.
        assert!(started.elapsed() < Duration::from_millis(250));
    }

    #[test]
    fn cancel_turn_waiters_fires_all_waiters_of_that_turn_only() {
        let mine = register("request-cancel-a", "turn-cancelled");
        let mine_too = register("request-cancel-b", "turn-cancelled");
        let other = register("request-other", "turn-alive");
        cancel_turn_waiters("turn-cancelled");
        assert_eq!(
            turn_engine::block_on(wait_async(mine, Some(Duration::from_secs(1)))),
            Some(WaitSignal::Cancelled)
        );
        assert_eq!(
            turn_engine::block_on(wait_async(mine_too, Some(Duration::from_secs(1)))),
            Some(WaitSignal::Cancelled)
        );
        // Unrelated waiter is untouched: it times out instead of firing.
        assert_eq!(
            turn_engine::block_on(wait_async(other, Some(Duration::from_millis(50)))),
            None
        );
    }

    #[test]
    fn wait_times_out_without_response() {
        let receiver = register("request-timeout", "turn-timeout");
        assert_eq!(
            turn_engine::block_on(wait_async(receiver, Some(Duration::from_millis(30)))),
            None
        );
        unregister("request-timeout");
    }

    #[test]
    fn atomic_cancellation_wakes_legacy_waiter() {
        let receiver = register("request-atomic-cancel", "turn-atomic-cancel");
        let cancellation = CancellationToken::new();
        let worker_cancellation = cancellation.clone();
        let worker = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            worker_cancellation.cancel();
        });
        assert_eq!(
            turn_engine::block_on(wait_with_cancellation_async(
                receiver,
                Some(Duration::from_secs(5)),
                Some(cancellation)
            )),
            Some(WaitSignal::Cancelled)
        );
        worker.join().expect("cancellation worker");
        unregister("request-atomic-cancel");
    }
}
