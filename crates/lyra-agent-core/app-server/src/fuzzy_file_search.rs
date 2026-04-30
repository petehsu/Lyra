use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;

use lyra_app_server_protocol::FuzzyFileSearchMatchType;
use lyra_app_server_protocol::FuzzyFileSearchResult;
use lyra_app_server_protocol::FuzzyFileSearchSessionCompletedNotification;
use lyra_app_server_protocol::FuzzyFileSearchSessionUpdatedNotification;
use lyra_app_server_protocol::ServerNotification;
use lyra_local_search as file_search;
use tracing::warn;

use crate::outgoing_message::OutgoingMessageSender;

const MATCH_LIMIT: usize = 50;

pub(crate) async fn run_fuzzy_file_search(
    query: String,
    roots: Vec<String>,
    engine: Arc<file_search::LocalSearchEngine>,
    cancellation_flag: Arc<AtomicBool>,
) -> Vec<FuzzyFileSearchResult> {
    if roots.is_empty() {
        return Vec::new();
    }

    let search_dirs: Vec<PathBuf> = roots.iter().map(PathBuf::from).collect();
    let search_query = query.clone();

    let mut files = match tokio::task::spawn_blocking(move || {
        engine.search(
            file_search::LocalSearchOptions {
                query: search_query,
                roots: search_dirs,
                limit: MATCH_LIMIT,
                include_hidden: true,
                include_vendor: true,
                content_mode: file_search::LocalSearchContentMode::Disabled,
                ..Default::default()
            },
            Some(cancellation_flag),
        )
    })
    .await
    {
        Ok(Ok(response)) => to_fuzzy_results(&query, response.results),
        Ok(Err(err)) => {
            warn!("fuzzy-file-search failed: {err}");
            Vec::new()
        }
        Err(err) => {
            warn!("fuzzy-file-search join failed: {err}");
            Vec::new()
        }
    };

    sort_fuzzy_results(&mut files);

    files
}

pub(crate) struct FuzzyFileSearchSession {
    engine: Arc<file_search::LocalSearchEngine>,
    roots: Vec<String>,
    shared: Arc<SessionShared>,
}

impl FuzzyFileSearchSession {
    pub(crate) fn update_query(&self, query: String) {
        if self.shared.canceled.load(Ordering::Relaxed) {
            return;
        }
        run_session_search(
            self.engine.clone(),
            self.roots.clone(),
            self.shared.clone(),
            query,
        );
    }
}

impl Drop for FuzzyFileSearchSession {
    fn drop(&mut self) {
        self.shared.canceled.store(true, Ordering::Relaxed);
        if let Ok(mut current_search) = self.shared.current_search.lock()
            && let Some(flag) = current_search.take()
        {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

pub(crate) fn start_fuzzy_file_search_session(
    session_id: String,
    roots: Vec<String>,
    outgoing: Arc<OutgoingMessageSender>,
    engine: Arc<file_search::LocalSearchEngine>,
) -> anyhow::Result<FuzzyFileSearchSession> {
    let canceled = Arc::new(AtomicBool::new(false));

    let shared = Arc::new(SessionShared {
        session_id,
        latest_query: Mutex::new(String::new()),
        current_search: Mutex::new(None),
        outgoing,
        runtime: tokio::runtime::Handle::current(),
        canceled: canceled.clone(),
    });

    Ok(FuzzyFileSearchSession {
        engine,
        roots,
        shared,
    })
}

struct SessionShared {
    session_id: String,
    latest_query: Mutex<String>,
    current_search: Mutex<Option<Arc<AtomicBool>>>,
    outgoing: Arc<OutgoingMessageSender>,
    runtime: tokio::runtime::Handle,
    canceled: Arc<AtomicBool>,
}

fn run_session_search(
    engine: Arc<file_search::LocalSearchEngine>,
    roots: Vec<String>,
    shared: Arc<SessionShared>,
    query: String,
) {
    if let Ok(mut latest_query) = shared.latest_query.lock() {
        *latest_query = query.clone();
    } else {
        warn!("fuzzy-file-search session latest query lock poisoned");
        return;
    }

    let cancel_flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut current_search) = shared.current_search.lock() {
        if let Some(previous) = current_search.replace(cancel_flag.clone()) {
            previous.store(true, Ordering::Relaxed);
        }
    } else {
        warn!("fuzzy-file-search session search lock poisoned");
        return;
    }

    let runtime = shared.runtime.clone();
    runtime.spawn(async move {
        let files = run_fuzzy_file_search(query.clone(), roots, engine, cancel_flag.clone()).await;

        if !session_search_is_current(&shared, &query, &cancel_flag) {
            return;
        }
        clear_current_session_search(&shared, &cancel_flag);

        let notification = ServerNotification::FuzzyFileSearchSessionUpdated(
            FuzzyFileSearchSessionUpdatedNotification {
                session_id: shared.session_id.clone(),
                query,
                files,
            },
        );
        shared.outgoing.send_server_notification(notification).await;

        if shared.canceled.load(Ordering::Relaxed) {
            return;
        }
        let notification = ServerNotification::FuzzyFileSearchSessionCompleted(
            FuzzyFileSearchSessionCompletedNotification {
                session_id: shared.session_id.clone(),
            },
        );
        shared.outgoing.send_server_notification(notification).await;
    });
}

fn session_search_is_current(
    shared: &SessionShared,
    query: &str,
    cancel_flag: &Arc<AtomicBool>,
) -> bool {
    if shared.canceled.load(Ordering::Relaxed) || cancel_flag.load(Ordering::Relaxed) {
        return false;
    }
    let latest_query_matches = shared
        .latest_query
        .lock()
        .map(|latest_query| latest_query.as_str() == query)
        .unwrap_or(false);
    if !latest_query_matches {
        return false;
    }
    shared
        .current_search
        .lock()
        .map(|current_search| {
            current_search
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, cancel_flag))
        })
        .unwrap_or(false)
}

fn clear_current_session_search(shared: &SessionShared, cancel_flag: &Arc<AtomicBool>) {
    if let Ok(mut current_search) = shared.current_search.lock()
        && current_search
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, cancel_flag))
    {
        current_search.take();
    }
}

fn to_fuzzy_results(
    query: &str,
    results: Vec<file_search::LocalSearchResult>,
) -> Vec<FuzzyFileSearchResult> {
    let mut files = results
        .into_iter()
        .map(|result| to_fuzzy_result(query, result))
        .collect::<Vec<_>>();
    sort_fuzzy_results(&mut files);
    files
}

fn to_fuzzy_result(query: &str, result: file_search::LocalSearchResult) -> FuzzyFileSearchResult {
    let display_path = result.display_path;
    let file_name = display_path
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(display_path.as_str())
        .to_string();
    let indices = fuzzy_match_indices(&display_path, query);
    FuzzyFileSearchResult {
        root: result.root.to_string_lossy().to_string(),
        path: display_path,
        match_type: match result.kind {
            file_search::LocalSearchKind::File => FuzzyFileSearchMatchType::File,
            file_search::LocalSearchKind::Directory => FuzzyFileSearchMatchType::Directory,
        },
        file_name,
        score: result.score,
        indices,
    }
}

fn fuzzy_match_indices(path: &str, query: &str) -> Option<Vec<u32>> {
    let needle = query
        .trim()
        .chars()
        .map(|ch| ch.to_lowercase().next().unwrap_or(ch))
        .collect::<Vec<_>>();
    if needle.is_empty() {
        return None;
    }

    let mut indices = Vec::with_capacity(needle.len());
    let mut needle_index = 0;
    for (path_index, ch) in path.chars().enumerate() {
        let path_ch = ch.to_lowercase().next().unwrap_or(ch);
        if path_ch != needle[needle_index] {
            continue;
        }
        let Ok(path_index) = u32::try_from(path_index) else {
            return None;
        };
        indices.push(path_index);
        needle_index += 1;
        if needle_index == needle.len() {
            return Some(indices);
        }
    }
    None
}

fn sort_fuzzy_results(files: &mut [FuzzyFileSearchResult]) {
    files.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.path.cmp(&right.path))
    });
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::Arc;
    use std::sync::atomic::AtomicBool;
    use std::time::Duration;

    use lyra_app_server_protocol::ServerNotification;
    use tempfile::tempdir;
    use tokio::sync::mpsc;

    use super::*;
    use crate::outgoing_message::OutgoingEnvelope;
    use crate::outgoing_message::OutgoingMessage;

    #[tokio::test]
    async fn one_shot_empty_query_returns_initial_candidates() {
        let dir = tempdir().expect("tempdir");
        fs::create_dir_all(dir.path().join("src")).expect("src");
        fs::write(dir.path().join("README.md"), "readme").expect("readme");
        fs::write(dir.path().join("src/main.rs"), "fn main() {}").expect("main");

        let results = run_fuzzy_file_search(
            String::new(),
            vec![dir.path().display().to_string()],
            Arc::new(file_search::LocalSearchEngine::new()),
            Arc::new(AtomicBool::new(false)),
        )
        .await;

        assert!(results.iter().all(|result| !result.path.is_empty()));
        assert!(results.iter().any(|result| result.path == "README.md"));
        assert!(results.iter().any(|result| {
            result.path == "src" && result.match_type == FuzzyFileSearchMatchType::Directory
        }));
    }

    #[tokio::test]
    async fn session_empty_and_non_empty_updates_send_notifications() {
        let dir = tempdir().expect("tempdir");
        fs::create_dir_all(dir.path().join("src")).expect("src");
        fs::write(dir.path().join("package.json"), "{}").expect("package");
        fs::write(dir.path().join("src/main.ts"), "export {}").expect("main");
        let (tx, mut rx) = mpsc::channel(16);
        let outgoing = Arc::new(OutgoingMessageSender::new(tx));
        let session = start_fuzzy_file_search_session(
            "session-a".to_string(),
            vec![dir.path().display().to_string()],
            outgoing,
            Arc::new(file_search::LocalSearchEngine::new()),
        )
        .expect("session");

        session.update_query(String::new());
        let empty_update = recv_session_update_matching(&mut rx, "session-a", "", |update| {
            update
                .files
                .iter()
                .any(|result| result.path == "package.json")
        })
        .await;
        assert!(!empty_update.files.is_empty());

        session.update_query("main".to_string());
        let main_update = recv_session_update_matching(&mut rx, "session-a", "main", |update| {
            update
                .files
                .iter()
                .any(|result| result.path.ends_with("main.ts"))
        })
        .await;
        assert!(!main_update.files.is_empty());
    }

    async fn recv_session_update_matching(
        rx: &mut mpsc::Receiver<OutgoingEnvelope>,
        session_id: &str,
        query: &str,
        matches: impl Fn(&FuzzyFileSearchSessionUpdatedNotification) -> bool,
    ) -> FuzzyFileSearchSessionUpdatedNotification {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            assert!(
                !remaining.is_zero(),
                "timed out waiting for fuzzy search update"
            );
            let envelope = tokio::time::timeout(remaining, rx.recv())
                .await
                .expect("receive timeout")
                .expect("envelope");
            let notification = match envelope {
                OutgoingEnvelope::Broadcast {
                    message: OutgoingMessage::AppServerNotification(notification),
                } => notification,
                _ => continue,
            };
            if let ServerNotification::FuzzyFileSearchSessionUpdated(update) = notification
                && update.session_id == session_id
                && update.query == query
                && matches(&update)
            {
                return update;
            }
        }
    }
}
