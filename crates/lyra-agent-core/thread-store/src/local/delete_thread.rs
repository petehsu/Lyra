use std::io::ErrorKind;
use std::path::PathBuf;

use lyra_rollout::find_archived_thread_path_by_id_str;
use lyra_rollout::find_thread_path_by_id_str;

use super::LocalThreadStore;
use super::helpers::matching_rollout_file_name;
use super::helpers::scoped_rollout_path;
use crate::ArchiveThreadParams;
use crate::ThreadStoreError;
use crate::ThreadStoreResult;

pub(super) async fn delete_thread(
    store: &LocalThreadStore,
    params: ArchiveThreadParams,
) -> ThreadStoreResult<()> {
    let thread_id = params.thread_id;
    let thread_id_str = thread_id.to_string();
    let active_root = store.config.lyra_home.join(lyra_rollout::SESSIONS_SUBDIR);
    let archived_root = store
        .config
        .lyra_home
        .join(lyra_rollout::ARCHIVED_SESSIONS_SUBDIR);

    let (rollout_path, root, root_label) =
        match find_thread_path_by_id_str(store.config.lyra_home.as_path(), thread_id_str.as_str())
            .await
            .map_err(|err| ThreadStoreError::InvalidRequest {
                message: format!("failed to locate thread id {thread_id}: {err}"),
            })? {
            Some(path) => (path, active_root, "sessions"),
            None => match find_archived_thread_path_by_id_str(
                store.config.lyra_home.as_path(),
                thread_id_str.as_str(),
            )
            .await
            .map_err(|err| ThreadStoreError::InvalidRequest {
                message: format!("failed to locate archived thread id {thread_id}: {err}"),
            })? {
                Some(path) => (path, archived_root, "archived_sessions"),
                None => {
                    return Err(ThreadStoreError::InvalidRequest {
                        message: format!("no rollout found for thread id {thread_id}"),
                    });
                }
            },
        };

    let canonical_rollout_path = scoped_rollout_path(root, rollout_path.as_path(), root_label)?;
    let file_name = matching_rollout_file_name(
        canonical_rollout_path.as_path(),
        thread_id,
        rollout_path.as_path(),
    )?;
    let delete_path = canonical_rollout_path
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| store.config.lyra_home.clone())
        .join(file_name);

    std::fs::remove_file(&delete_path).map_err(|err| ThreadStoreError::Internal {
        message: format!("failed to delete thread rollout: {err}"),
    })?;

    if let Some(ctx) = lyra_rollout::state_db::get_state_db(&store.config).await {
        let _ = ctx.delete_thread(thread_id).await;
    }

    let ai_session_dir = store
        .config
        .lyra_home
        .join("modules")
        .join("ai")
        .join("sessions")
        .join(thread_id_str);
    match std::fs::remove_dir_all(ai_session_dir.as_path()) {
        Ok(()) => {}
        Err(err) if err.kind() == ErrorKind::NotFound => {}
        Err(err) => {
            return Err(ThreadStoreError::Internal {
                message: format!("failed to delete thread AI session storage: {err}"),
            });
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use lyra_protocol::ThreadId;
    use lyra_rollout::ARCHIVED_SESSIONS_SUBDIR;
    use tempfile::TempDir;
    use uuid::Uuid;

    use super::*;
    use crate::ListThreadsParams;
    use crate::ThreadSortKey;
    use crate::ThreadStore;
    use crate::local::LocalThreadStore;
    use crate::local::test_support::test_config;
    use crate::local::test_support::write_session_file;

    #[tokio::test]
    async fn delete_thread_removes_active_rollout_and_ai_session_storage() {
        let home = TempDir::new().expect("temp dir");
        let store = LocalThreadStore::new(test_config(home.path()));
        let uuid = Uuid::from_u128(301);
        let thread_id = ThreadId::from_string(&uuid.to_string()).expect("valid thread id");
        let active_path =
            write_session_file(home.path(), "2025-01-03T12-00-00", uuid).expect("session file");
        let ai_session_dir = home
            .path()
            .join("modules")
            .join("ai")
            .join("sessions")
            .join(thread_id.to_string());
        std::fs::create_dir_all(ai_session_dir.as_path()).expect("ai session dir");

        store
            .delete_thread(ArchiveThreadParams { thread_id })
            .await
            .expect("delete thread");

        assert!(!active_path.exists());
        assert!(!ai_session_dir.exists());
    }

    #[tokio::test]
    async fn delete_thread_removes_archived_rollout() {
        let home = TempDir::new().expect("temp dir");
        let store = LocalThreadStore::new(test_config(home.path()));
        let uuid = Uuid::from_u128(302);
        let thread_id = ThreadId::from_string(&uuid.to_string()).expect("valid thread id");
        let active_path =
            write_session_file(home.path(), "2025-01-03T12-00-00", uuid).expect("session file");
        store
            .archive_thread(ArchiveThreadParams { thread_id })
            .await
            .expect("archive thread");
        let archived_path = home
            .path()
            .join(ARCHIVED_SESSIONS_SUBDIR)
            .join(active_path.file_name().expect("file name"));

        store
            .delete_thread(ArchiveThreadParams { thread_id })
            .await
            .expect("delete archived thread");

        assert!(!active_path.exists());
        assert!(!archived_path.exists());
        let archived = store
            .list_threads(ListThreadsParams {
                page_size: 10,
                cursor: None,
                sort_key: ThreadSortKey::CreatedAt,
                sort_direction: crate::SortDirection::Desc,
                allowed_sources: Vec::new(),
                model_providers: None,
                archived: true,
                search_term: None,
            })
            .await
            .expect("archived listing");
        assert!(archived.items.is_empty());
    }
}
