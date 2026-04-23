use crate::config::Config;
use crate::session::session::Session;
use lyra_features::Feature;
use lyra_protocol::protocol::SessionSource;
use std::sync::Arc;
use tracing::warn;

/// Initializes Lyra memory truth for an eligible root session.
///
/// The legacy Lyra phase-1/phase-2 startup memory pipeline is intentionally
/// bypassed here so session startup no longer writes to a second memory truth.
pub(crate) fn start_memories_startup_task(
    session: &Arc<Session>,
    config: Arc<Config>,
    source: &SessionSource,
) {
    if config.ephemeral
        || !config.features.enabled(Feature::MemoryTool)
        || matches!(source, SessionSource::SubAgent(_))
    {
        return;
    }

    let weak_session = Arc::downgrade(session);
    tokio::spawn(async move {
        let Some(session) = weak_session.upgrade() else {
            return;
        };
        let lyra_home = config.lyra_home.clone();
        let thread_id = session.conversation_id.to_string();
        let thread_id_for_init = thread_id.clone();
        let init_result = tokio::task::spawn_blocking(move || {
            super::lyra_truth::initialize_thread_memory_truth(
                lyra_home.as_ref(),
                &thread_id_for_init,
            )
        })
        .await;

        match init_result {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                warn!("failed to initialize Lyra memory truth for thread {thread_id}: {error}");
            }
            Err(error) => {
                warn!(
                    "failed to join Lyra memory truth initialization task for thread {thread_id}: {error}"
                );
            }
        }
    });
}
