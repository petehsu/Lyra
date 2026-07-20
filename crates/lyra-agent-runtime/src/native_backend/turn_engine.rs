//! Turn execution substrate: a shared tokio runtime plus supervised turn
//! spawning.
//!
//! Root cure for the "session hangs forever in `running`" family of bugs:
//! the legacy `thread::spawn(run_native_turn)` dropped the JoinHandle, so a
//! panic anywhere inside the turn body silently killed the worker and left
//! `turnStatus: "running"` + `activeTurnId` behind — the UI waited forever.
//! Every turn now runs under a supervisor that guarantees finalization: a
//! panic finalizes the turn with a visible failure event and returns the
//! session to idle.
//!
//! The turn body itself is still the synchronous legacy pipeline, so it runs
//! on the runtime's blocking pool. Async-native stages (provider streaming,
//! waiters) use this same runtime, which is what lets the event-driven waits
//! in `waiters.rs` park without polling.
//!
//! ## Idle watchdog layer
//!
//! The supervisor only catches panics. A turn body that **blocks** (host
//! dispatcher closure, tool thread join, Oma worker join) never returns, so
//! `catch_unwind` never fires and the turn stays `"running"` forever. This is
//! the third "session stuck" path, independent of the panic and polling paths
//! already fixed.
//!
//! All four reference projects (Codex, Zed, Claude Code, opencode) use async
//! execution + cancellation propagation + timeout to prevent this. Lyra's
//! turn pipeline is synchronous, so we supervise the `spawn_blocking` handle
//! with an **idle watchdog**: if no progress is recorded for `idle_timeout()`
//! (default 120s), the watchdog finalizes the turn as failed. Progress is
//! recorded by `record_progress(turn_id)` at key points — provider response
//! received, tool batch completed, Oma worker finished. Interaction waits
//! (permission/clarification) pause the idle timer so user think-time doesn't
//! count against the budget.
//!
//! Tool and Oma batches use `run_blocking_batch_for_turn`, which applies the
//! same pause-aware budget and returns without synchronously joining a blocked
//! worker.

use std::panic::AssertUnwindSafe;
use std::sync::{Arc, OnceLock, atomic::AtomicBool};
use std::time::{Duration, Instant};

use tokio::runtime::Runtime;
use tokio::task::JoinSet;

static RUNTIME: OnceLock<Runtime> = OnceLock::new();

pub(crate) fn runtime() -> &'static Runtime {
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .thread_name("lyra-turn-engine")
            .enable_all()
            .build()
            .expect("failed to build the Lyra turn engine tokio runtime")
    })
}

/// Block the current thread on a future using the engine runtime.
///
/// Only valid from synchronous worker threads (turn bodies on the blocking
/// pool, host RPC threads) — never from an async task.
pub(crate) fn block_on<F: std::future::Future>(future: F) -> F::Output {
    runtime().handle().clone().block_on(future)
}

/// Configurable Oma worker join deadline. A worker that blocks past this
/// duration is abandoned and the caller returns a timeout error.
///
/// Default 120s matches `MAX_TOOL_TIMEOUT_MS`. Override with
/// `LYRA_OMA_WORKER_TIMEOUT_SECS` env var.
pub(crate) fn oma_worker_timeout() -> Duration {
    Duration::from_secs(
        std::env::var("LYRA_OMA_WORKER_TIMEOUT_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(120),
    )
}

/// Spawn a supervised turn worker with an idle watchdog.
///
/// The supervisor contract: when the body returns — normally, by error, or
/// by panic — the turn MUST no longer be the session's active running turn.
/// Normal/error paths finalize inside `run_native_turn`; the panic path is
/// finalized in `supervise_turn`; the **blocking path** (body never returns)
/// is finalized by the idle watchdog task racing the handle against
/// `remaining_idle_time`. If no progress is recorded for `idle_timeout()`
/// (default 120s), the watchdog finalizes the turn so the UI recovers.
pub(crate) fn spawn_turn(session_id: String, turn_id: String, cancellation: Arc<AtomicBool>) {
    super::session_runtime::register_turn_activity(&turn_id);
    let idle = super::session_runtime::idle_timeout();
    let watchdog_session_id = session_id.clone();
    let watchdog_turn_id = turn_id.clone();
    let handle = runtime().spawn_blocking(move || {
        let sid = session_id.clone();
        let tid = turn_id.clone();
        supervise_turn(&session_id, &turn_id, move || {
            super::turns::run_native_turn(sid, tid, cancellation)
        });
    });
    // Idle watchdog: race the blocking handle against the idle timer. If
    // the turn body blocks forever (host dispatcher hang, tool join hang,
    // Oma worker hang) and no progress is recorded for `idle_timeout`, the
    // watchdog fires and finalizes the turn so the UI recovers. The blocking
    // thread is leaked — it will finish eventually or be cleaned up on
    // process exit. This is the synchronous equivalent of Codex's
    // `tokio::time::timeout` + `AbortOnDropHandle` pattern.
    runtime().spawn(async move {
        let session_id = watchdog_session_id;
        let turn_id = watchdog_turn_id;
        match wait_for_turn_worker(handle, &turn_id).await {
            Ok(Ok(())) => {}
            Ok(Err(_panic)) => {}
            Err(()) => {
                eprintln!(
                    "[lyra-agent-runtime] turn watchdog: idle {idle:?} exceeded for turn {turn_id}, finalizing as failed"
                );
                super::session_runtime::request_turn_cancellation(&turn_id);
                super::turns::finish_turn_with_metadata(
                    &session_id,
                    &turn_id,
                    "finished",
                    None,
                    Some(format!(
                        "Lyra runtime error: turn was idle for {idle:?} with no progress (watchdog)"
                    )),
                    None,
                    Some("watchdog_idle_timeout".to_string()),
                );
            }
        }
    });
}

async fn wait_for_turn_worker(
    mut handle: tokio::task::JoinHandle<()>,
    turn_id: &str,
) -> Result<Result<(), tokio::task::JoinError>, ()> {
    loop {
        let Some(mut activity_changes) =
            super::session_runtime::turn_activity_change_receiver(turn_id)
        else {
            return Ok(handle.await);
        };
        if super::session_runtime::turn_activity_is_paused(turn_id) {
            tokio::select! {
                result = &mut handle => return Ok(result),
                _ = activity_changes.changed() => continue,
            }
        }
        let remaining =
            super::session_runtime::remaining_idle_time(turn_id).unwrap_or(Duration::ZERO);
        if remaining.is_zero() {
            return Err(());
        }
        tokio::select! {
            result = &mut handle => return Ok(result),
            _ = activity_changes.changed() => continue,
            _ = tokio::time::sleep(remaining) => {
                if !super::session_runtime::turn_activity_is_paused(turn_id)
                    && super::session_runtime::remaining_idle_time(turn_id)
                        .is_some_and(|remaining| remaining.is_zero())
                {
                    return Err(());
                }
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum BlockingTaskFailure {
    Panic,
    Timeout,
}

enum BlockingBatchWait<T> {
    Joined(Option<Result<(usize, Result<T, BlockingTaskFailure>), tokio::task::JoinError>>),
    BudgetChanged,
    Timeout,
}

#[cfg(test)]
pub(crate) fn run_blocking_batch<T: Send + 'static>(
    tasks: Vec<Box<dyn FnOnce() -> T + Send>>,
    timeout: Duration,
) -> Vec<Result<T, BlockingTaskFailure>> {
    run_blocking_batch_inner(tasks, timeout, None)
}

pub(crate) async fn run_batch<T: Send + 'static>(
    tasks: Vec<Box<dyn FnOnce() -> T + Send>>,
    timeout: Duration,
) -> Vec<Result<T, BlockingTaskFailure>> {
    run_batch_inner_async(tasks, timeout, None).await
}

pub(crate) fn run_blocking_batch_for_turn<T: Send + 'static>(
    tasks: Vec<Box<dyn FnOnce() -> T + Send>>,
    timeout: Duration,
    turn_id: &str,
) -> Vec<Result<T, BlockingTaskFailure>> {
    run_blocking_batch_inner(tasks, timeout, Some(turn_id.to_string()))
}

pub(crate) async fn run_batch_for_turn<T: Send + 'static>(
    tasks: Vec<Box<dyn FnOnce() -> T + Send>>,
    timeout: Duration,
    turn_id: &str,
) -> Vec<Result<T, BlockingTaskFailure>> {
    run_batch_inner_async(tasks, timeout, Some(turn_id.to_string())).await
}

async fn run_batch_inner_async<T: Send + 'static>(
    tasks: Vec<Box<dyn FnOnce() -> T + Send>>,
    timeout: Duration,
    turn_id: Option<String>,
) -> Vec<Result<T, BlockingTaskFailure>> {
    let task_count = tasks.len();
    let mut remaining = timeout;
    let mut workers = JoinSet::new();
    for (index, task) in tasks.into_iter().enumerate() {
        workers.spawn_blocking(move || {
            (
                index,
                std::panic::catch_unwind(AssertUnwindSafe(task))
                    .map_err(|_| BlockingTaskFailure::Panic),
            )
        });
    }
    let mut results = std::iter::repeat_with(|| None)
        .take(task_count)
        .collect::<Vec<_>>();
    while !workers.is_empty() {
        let activity_changes = turn_id
            .as_deref()
            .and_then(super::session_runtime::turn_activity_change_receiver);
        let paused = activity_changes.is_some()
            && turn_id
                .as_deref()
                .is_some_and(super::session_runtime::turn_activity_is_paused);
        let wait = if paused {
            let mut activity_changes =
                activity_changes.expect("paused turn activity change receiver");
            tokio::select! {
                result = workers.join_next() => BlockingBatchWait::Joined(result),
                _ = activity_changes.changed() => BlockingBatchWait::BudgetChanged,
            }
        } else {
            if remaining.is_zero() {
                workers.abort_all();
                break;
            }
            let started = Instant::now();
            let wait = if let Some(mut activity_changes) = activity_changes {
                tokio::select! {
                    result = workers.join_next() => BlockingBatchWait::Joined(result),
                    _ = activity_changes.changed() => BlockingBatchWait::BudgetChanged,
                    _ = tokio::time::sleep(remaining) => BlockingBatchWait::Timeout,
                }
            } else {
                match tokio::time::timeout(remaining, workers.join_next()).await {
                    Ok(result) => BlockingBatchWait::Joined(result),
                    Err(_) => BlockingBatchWait::Timeout,
                }
            };
            remaining = remaining.saturating_sub(started.elapsed());
            wait
        };
        match wait {
            BlockingBatchWait::Joined(Some(Ok((index, result)))) => {
                results[index] = Some(result);
            }
            BlockingBatchWait::Joined(Some(Err(_)))
            | BlockingBatchWait::Joined(None)
            | BlockingBatchWait::Timeout => {
                workers.abort_all();
                break;
            }
            BlockingBatchWait::BudgetChanged => {}
        }
    }
    results
        .into_iter()
        .map(|result| result.unwrap_or(Err(BlockingTaskFailure::Timeout)))
        .collect()
}

fn run_blocking_batch_inner<T: Send + 'static>(
    tasks: Vec<Box<dyn FnOnce() -> T + Send>>,
    timeout: Duration,
    turn_id: Option<String>,
) -> Vec<Result<T, BlockingTaskFailure>> {
    block_on(run_batch_inner_async(tasks, timeout, turn_id))
}

/// Run a turn body and guarantee finalization on panic.
///
/// Split from `spawn_turn` so tests can drive the supervision contract
/// directly with a panicking body.
pub(crate) fn supervise_turn(session_id: &str, turn_id: &str, body: impl FnOnce()) {
    let result = std::panic::catch_unwind(AssertUnwindSafe(body));
    if let Err(panic) = result {
        let detail = panic_detail(panic.as_ref());
        eprintln!(
            "[lyra-agent-runtime] turn worker panicked: session={session_id} turn={turn_id} detail={detail}"
        );
        // Wake any waiter (permission/clarification) still parked for this
        // turn before finalizing, so nothing is left blocking on a channel
        // whose turn is being torn down.
        super::waiters::cancel_turn_waiters(turn_id);
        super::turns::finish_turn_with_metadata(
            session_id,
            turn_id,
            "finished",
            None,
            Some(format!(
                "Lyra runtime error: turn worker panicked: {detail}"
            )),
            None,
            Some("worker_panic".to_string()),
        );
    }
}

fn panic_detail(panic: &(dyn std::any::Any + Send)) -> String {
    if let Some(text) = panic.downcast_ref::<&str>() {
        (*text).to_string()
    } else if let Some(text) = panic.downcast_ref::<String>() {
        text.clone()
    } else {
        "unknown panic payload".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocking_batch_preserves_input_order_and_isolates_panics() {
        let tasks: Vec<Box<dyn FnOnce() -> usize + Send>> = vec![
            Box::new(|| {
                std::thread::sleep(Duration::from_millis(20));
                1
            }),
            Box::new(|| panic!("boom")),
            Box::new(|| 3),
        ];
        assert_eq!(
            run_blocking_batch(tasks, Duration::from_secs(1)),
            vec![Ok(1), Err(BlockingTaskFailure::Panic), Ok(3),]
        );
    }

    #[test]
    fn blocking_batch_uses_one_absolute_deadline() {
        let tasks: Vec<Box<dyn FnOnce() -> usize + Send>> = (0_usize..3)
            .map(|index| {
                Box::new(move || {
                    std::thread::sleep(Duration::from_millis(200));
                    index
                }) as Box<dyn FnOnce() -> usize + Send>
            })
            .collect();
        let started = Instant::now();
        let results = run_blocking_batch(tasks, Duration::from_millis(40));
        assert!(
            started.elapsed() < Duration::from_millis(150),
            "batch timeout was applied per worker instead of once"
        );
        assert_eq!(
            results,
            vec![
                Err(BlockingTaskFailure::Timeout),
                Err(BlockingTaskFailure::Timeout),
                Err(BlockingTaskFailure::Timeout),
            ]
        );
    }

    #[test]
    fn blocking_batch_pauses_timeout_during_user_interaction() {
        let turn_id = format!("turn-paused-batch-{}", uuid::Uuid::new_v4());
        super::super::session_runtime::register_turn_activity(&turn_id);
        let worker_turn_id = turn_id.clone();
        let tasks: Vec<Box<dyn FnOnce() -> usize + Send>> = vec![Box::new(move || {
            let _pause = super::super::session_runtime::pause_turn_activity(&worker_turn_id);
            std::thread::sleep(Duration::from_millis(250));
            1
        })];
        let started = Instant::now();
        assert_eq!(
            run_blocking_batch_for_turn(tasks, Duration::from_millis(100), &turn_id),
            vec![Ok(1)]
        );
        assert!(started.elapsed() >= Duration::from_millis(200));
        super::super::session_runtime::clear_active_turn("test-session", &turn_id);
    }

    #[test]
    fn paused_turn_activity_preserves_idle_budget() {
        let turn_id = format!("turn-paused-activity-{}", uuid::Uuid::new_v4());
        super::super::session_runtime::register_turn_activity(&turn_id);
        let first_pause = super::super::session_runtime::pause_turn_activity(&turn_id);
        let second_pause = super::super::session_runtime::pause_turn_activity(&turn_id);
        let (sender, receiver) = std::sync::mpsc::channel();
        let handle = runtime().spawn_blocking(move || {
            receiver.recv().expect("release worker");
        });

        block_on(async {
            let waiter = wait_for_turn_worker(handle, &turn_id);
            tokio::pin!(waiter);
            tokio::select! {
                result = &mut waiter => panic!("paused watchdog completed early: {result:?}"),
                _ = tokio::time::sleep(Duration::from_millis(80)) => {}
            }
            drop(first_pause);
            tokio::time::sleep(Duration::from_millis(20)).await;
            assert!(
                super::super::session_runtime::turn_activity_is_paused(&turn_id),
                "one remaining interaction must keep the watchdog paused"
            );
            drop(second_pause);
            sender.send(()).expect("release blocked worker");
            assert!(waiter.await.expect("idle should not expire").is_ok());
        });

        super::super::session_runtime::clear_active_turn("test-session", &turn_id);
    }
}
