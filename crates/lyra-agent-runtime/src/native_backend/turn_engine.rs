//! Turn execution substrate: a shared tokio runtime plus supervised turn
//! spawning.
//!
//! Root cure for the "session hangs forever in `running`" family of bugs:
//! the legacy `thread::spawn(run_native_turn)` dropped the JoinHandle, so a
//! panic anywhere inside the turn body silently killed the worker and left
//! `turnStatus: "running"` + `activeTurnId` behind — the UI waited forever.
//! Every turn now runs as a `tokio::spawn` task. A panic (caught via
//! `JoinError`) finalizes the turn with a visible failure event and returns
//! the session to idle.
//!
//! The turn body runs as an async task (`run_native_turn_async`). All stages
//! (provider streaming, tool execution, Oma workers, waiters) are async and
//! `.await` directly, which is what lets the event-driven waits in
//! `waiters.rs` park without polling. Foreground commands wait on process
//! exit; long-lived processes are started in a background terminal instead of
//! holding the turn. There is no turn-idle watchdog: a quiet `git clone` is
//! progress, not a stall.
//!
//! Tool and Oma batches use `run_batch_for_turn` (async). Permission and
//! clarification waits pause that batch budget so user think-time does not
//! count against it.

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

/// Spawn a supervised turn worker.
///
/// The supervisor contract: when the body returns — normally, by error, or
/// by panic — the turn MUST no longer be the session's active running turn.
/// Normal/error paths finalize inside `run_native_turn_async`; the panic path
/// is finalized in the supervisor's `JoinError` arm. Foreground tools wait
/// for process exit instead of an idle timer.
pub(crate) fn spawn_turn(session_id: String, turn_id: String, cancellation: CancellationToken) {
    super::session_runtime::register_turn_activity(&turn_id);
    let supervisor_session_id = session_id.clone();
    let supervisor_turn_id = turn_id.clone();
    let handle = runtime().spawn(async move {
        super::turns::run_native_turn_async(session_id, turn_id, cancellation).await;
    });
    runtime().spawn(async move {
        let session_id = supervisor_session_id;
        let turn_id = supervisor_turn_id;
        if let Err(panic) = handle.await {
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
    });
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
    async fn nested_pauses_keep_turn_activity_paused_until_the_last_guard_drops() {
        let turn_id = format!("turn-paused-activity-{}", uuid::Uuid::new_v4());
        super::super::session_runtime::register_turn_activity(&turn_id);
        let first_pause = super::super::session_runtime::pause_turn_activity(&turn_id);
        let second_pause = super::super::session_runtime::pause_turn_activity(&turn_id);
        assert!(super::super::session_runtime::turn_activity_is_paused(
            &turn_id
        ));
        drop(first_pause);
        assert!(
            super::super::session_runtime::turn_activity_is_paused(&turn_id),
            "one remaining interaction must keep the turn paused"
        );
        drop(second_pause);
        assert!(!super::super::session_runtime::turn_activity_is_paused(
            &turn_id
        ));
        super::super::session_runtime::clear_active_turn("test-session", &turn_id);
    }
}
