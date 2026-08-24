//! Turn execution substrate: a shared tokio runtime plus supervised turn
//! spawning.
//!
//! Root cure for the "session hangs forever in `running`" family of bugs:
//! the legacy `thread::spawn(run_native_turn)` dropped the JoinHandle, so a
//! panic anywhere inside the turn body silently killed the worker and left
//! `turnStatus: "running"` + `activeTurnId` behind — the UI waited forever.
//! Every turn now runs as a `tokio::spawn` task under an idle watchdog that
//! guarantees finalization: a panic (caught via `JoinError`) finalizes the
//! turn with a visible failure event and returns the session to idle.
//!
//! The turn body runs as an async task (`run_native_turn_async`). All stages
//! (provider streaming, tool execution, Oma workers, waiters) are async and
//! `.await` directly, which is what lets the event-driven waits in
//! `waiters.rs` park without polling.
//!
//! ## Idle watchdog layer
//!
//! The `JoinError` from `tokio::spawn` only catches panics. A turn body that
//! **blocks** never returns, so the handle never completes and the turn stays
//! `"running"` forever. This is the third "session stuck" path, independent
//! of the panic and polling paths already fixed.
//!
//! All four reference projects (Codex, Zed, Claude Code, opencode) use async
//! execution + cancellation propagation + timeout to prevent this. We
//! supervise the spawned task handle with an **idle watchdog**: if no
//! progress is recorded for `idle_timeout()` (default 120s), the watchdog
//! finalizes the turn as failed. Progress is recorded by
//! `record_progress(turn_id)` at key points — provider response
//! received, tool batch completed, Oma worker finished. Interaction waits
//! (permission/clarification) pause the idle timer so user think-time doesn't
//! count against the budget.
//!
//! Tool and Oma batches use `run_batch_for_turn` (async), which applies the
//! same pause-aware budget and returns without synchronously joining a blocked
//! worker.

use std::convert::Infallible;
use std::future::Future;
use std::pin::Pin;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use tokio::runtime::Runtime;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

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
/// Test-only bridge: production code is fully async. Tests use this to drive
/// async functions from synchronous `#[test]` functions.
#[cfg(test)]
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
/// Normal/error paths finalize inside `run_native_turn_async`; the panic path
/// is finalized in the watchdog's `JoinError` arm; the **blocking path** (body
/// never returns) is finalized by the idle watchdog task racing the handle
/// against `remaining_idle_time`. If no progress is recorded for
/// `idle_timeout()` (default 120s), the watchdog finalizes the turn so the UI
/// recovers.
pub(crate) fn spawn_turn(session_id: String, turn_id: String, cancellation: CancellationToken) {
    super::session_runtime::register_turn_activity(&turn_id);
    let idle = super::session_runtime::idle_timeout();
    let watchdog_session_id = session_id.clone();
    let watchdog_turn_id = turn_id.clone();
    let handle = runtime().spawn(async move {
        super::turns::run_native_turn_async(session_id, turn_id, cancellation).await;
    });
    // Idle watchdog: race the task handle against the idle timer. If
    // the turn body blocks forever (host dispatcher hang, tool join hang,
    // Oma worker hang) and no progress is recorded for `idle_timeout`, the
    // watchdog fires and finalizes the turn so the UI recovers.
    runtime().spawn(async move {
        let session_id = watchdog_session_id;
        let turn_id = watchdog_turn_id;
        match wait_for_turn_worker(handle, &turn_id).await {
            Ok(Ok(())) => {}
            Ok(Err(panic)) => {
                eprintln!(
                    "[lyra-agent-runtime] turn worker panicked: session={session_id} turn={turn_id} detail={panic}"
                );
                super::waiters::cancel_turn_waiters(&turn_id);
                let metadata =
                    super::session_runtime::take_turn_provider_metadata(&session_id, &turn_id);
                super::turns::finish_turn_with_metadata(
                    &session_id,
                    &turn_id,
                    "finished",
                    None,
                    Some(format!("Lyra runtime error: turn worker panicked: {panic}")),
                    metadata,
                    Some("worker_panic".to_string()),
                );
            }
            Err(()) => {
                eprintln!(
                    "[lyra-agent-runtime] turn watchdog: idle {idle:?} exceeded for turn {turn_id}, finalizing as failed"
                );
                super::session_runtime::request_turn_cancellation(&turn_id);
                let metadata =
                    super::session_runtime::take_turn_provider_metadata(&session_id, &turn_id);
                super::turns::finish_turn_with_metadata(
                    &session_id,
                    &turn_id,
                    "finished",
                    None,
                    Some(format!(
                        "Lyra runtime error: turn was idle for {idle:?} with no progress (watchdog)"
                    )),
                    metadata,
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
    Joined(Option<Result<(usize, T), tokio::task::JoinError>>),
    BudgetChanged,
    Timeout,
}

#[cfg(test)]
pub(crate) async fn run_batch<T: Send + 'static>(
    tasks: Vec<Pin<Box<dyn Future<Output = T> + Send + 'static>>>,
    timeout: Duration,
) -> Vec<Result<T, BlockingTaskFailure>> {
    run_batch_inner_async(tasks, timeout, None, |_, _| Ok::<_, Infallible>(()))
        .await
        .unwrap_or_else(|never| match never {})
}

pub(crate) async fn run_batch_for_turn<T: Send + 'static>(
    tasks: Vec<Pin<Box<dyn Future<Output = T> + Send + 'static>>>,
    timeout: Duration,
    turn_id: &str,
) -> Vec<Result<T, BlockingTaskFailure>> {
    run_batch_inner_async(tasks, timeout, Some(turn_id.to_string()), |_, _| {
        Ok::<_, Infallible>(())
    })
    .await
    .unwrap_or_else(|never| match never {})
}

pub(crate) async fn run_batch_for_turn_with_completion<T, E, F>(
    tasks: Vec<Pin<Box<dyn Future<Output = T> + Send + 'static>>>,
    timeout: Duration,
    turn_id: &str,
    on_complete: F,
) -> Result<Vec<Result<T, BlockingTaskFailure>>, E>
where
    T: Send + 'static,
    F: FnMut(usize, &T) -> Result<(), E>,
{
    run_batch_inner_async(tasks, timeout, Some(turn_id.to_string()), on_complete).await
}

async fn run_batch_inner_async<T, E, F>(
    tasks: Vec<Pin<Box<dyn Future<Output = T> + Send + 'static>>>,
    timeout: Duration,
    turn_id: Option<String>,
    mut on_complete: F,
) -> Result<Vec<Result<T, BlockingTaskFailure>>, E>
where
    T: Send + 'static,
    F: FnMut(usize, &T) -> Result<(), E>,
{
    let task_count = tasks.len();
    let mut remaining = timeout;
    let mut workers: JoinSet<(usize, T)> = JoinSet::new();
    let mut id_to_index: std::collections::HashMap<tokio::task::Id, usize> =
        std::collections::HashMap::new();
    for (index, task) in tasks.into_iter().enumerate() {
        let handle = workers.spawn(async move { (index, task.await) });
        id_to_index.insert(handle.id(), index);
    }
    let mut results: Vec<Option<Result<T, BlockingTaskFailure>>> = std::iter::repeat_with(|| None)
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
            BlockingBatchWait::Joined(Some(Ok((index, value)))) => {
                if let Err(error) = on_complete(index, &value) {
                    workers.abort_all();
                    return Err(error);
                }
                results[index] = Some(Ok(value));
            }
            BlockingBatchWait::Joined(Some(Err(join_error))) => {
                let index = id_to_index
                    .get(&join_error.id())
                    .copied()
                    .unwrap_or(usize::MAX);
                if index < task_count {
                    results[index] = Some(Err(BlockingTaskFailure::Panic));
                }
            }
            BlockingBatchWait::Joined(None) | BlockingBatchWait::Timeout => {
                workers.abort_all();
                break;
            }
            BlockingBatchWait::BudgetChanged => {}
        }
    }
    Ok(results
        .into_iter()
        .map(|result| result.unwrap_or(Err(BlockingTaskFailure::Timeout)))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn blocking_batch_preserves_input_order_and_isolates_panics() {
        let tasks: Vec<Pin<Box<dyn Future<Output = usize> + Send + 'static>>> = vec![
            Box::pin(async {
                tokio::time::sleep(Duration::from_millis(20)).await;
                1
            }),
            Box::pin(async { panic!("boom") }),
            Box::pin(async { 3 }),
        ];
        assert_eq!(
            run_batch(tasks, Duration::from_secs(1)).await,
            vec![Ok(1), Err(BlockingTaskFailure::Panic), Ok(3)]
        );
    }

    #[tokio::test]
    async fn blocking_batch_uses_one_absolute_deadline() {
        let tasks: Vec<Pin<Box<dyn Future<Output = usize> + Send + 'static>>> = (0_usize..3)
            .map(|index| {
                Box::pin(async move {
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    index
                }) as Pin<Box<dyn Future<Output = usize> + Send + 'static>>
            })
            .collect();
        let started = Instant::now();
        let results = run_batch(tasks, Duration::from_millis(40)).await;
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

    #[tokio::test]
    async fn blocking_batch_reports_each_result_as_it_completes() {
        let tasks: Vec<Pin<Box<dyn Future<Output = usize> + Send + 'static>>> = vec![
            Box::pin(async {
                tokio::time::sleep(Duration::from_millis(40)).await;
                10
            }),
            Box::pin(async {
                tokio::time::sleep(Duration::from_millis(5)).await;
                20
            }),
        ];
        let mut completion_order = Vec::new();
        let results = run_batch_for_turn_with_completion(
            tasks,
            Duration::from_secs(1),
            "turn-callback-test",
            |index, _| {
                completion_order.push(index);
                Ok::<_, ()>(())
            },
        )
        .await
        .expect("completion callback");

        assert_eq!(completion_order, vec![1, 0]);
        assert_eq!(results, vec![Ok(10), Ok(20)]);
    }

    #[tokio::test]
    async fn blocking_batch_pauses_timeout_during_user_interaction() {
        let turn_id = format!("turn-paused-batch-{}", uuid::Uuid::new_v4());
        super::super::session_runtime::register_turn_activity(&turn_id);
        let worker_turn_id = turn_id.clone();
        let tasks: Vec<Pin<Box<dyn Future<Output = usize> + Send + 'static>>> =
            vec![Box::pin(async move {
                let _pause = super::super::session_runtime::pause_turn_activity(&worker_turn_id);
                tokio::time::sleep(Duration::from_millis(250)).await;
                1
            })];
        let started = Instant::now();
        assert_eq!(
            run_batch_for_turn(tasks, Duration::from_millis(100), &turn_id).await,
            vec![Ok(1)]
        );
        assert!(started.elapsed() >= Duration::from_millis(200));
        super::super::session_runtime::clear_active_turn("test-session", &turn_id);
    }

    #[tokio::test]
    async fn paused_turn_activity_preserves_idle_budget() {
        let turn_id = format!("turn-paused-activity-{}", uuid::Uuid::new_v4());
        super::super::session_runtime::register_turn_activity(&turn_id);
        let first_pause = super::super::session_runtime::pause_turn_activity(&turn_id);
        let second_pause = super::super::session_runtime::pause_turn_activity(&turn_id);
        let (sender, receiver) = std::sync::mpsc::channel();
        let handle = runtime().spawn_blocking(move || {
            receiver.recv().expect("release worker");
        });

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

        super::super::session_runtime::clear_active_turn("test-session", &turn_id);
    }
}
