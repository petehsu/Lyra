use crate::agent::service::{
    archive_thread, create_session, ensure_thread, fork_thread, resume_thread, rollback_thread,
};
use crate::agent::types::{
    AgentArchiveThreadRequest, AgentCreateSessionRequest, AgentEnsureThreadRequest,
    AgentForkThreadRequest, AgentResumeThreadRequest, AgentRollbackThreadRequest,
};
use crate::storage::registry_db;
use crate::tests::support::TempStorageRoot;

#[test]
fn ensure_thread_creates_root_thread_for_session() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("thread root".to_string()),
        profile_id: None,
    })
    .expect("create session");

    let thread = ensure_thread(AgentEnsureThreadRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
    })
    .expect("ensure thread");

    assert_eq!(thread.session_id, session.id);
    assert_eq!(thread.parent_thread_id, None);
    assert_eq!(thread.rollback_from_thread_id, None);
    assert_eq!(thread.rollback_from_turn_id, None);

    let persisted = registry_db::read_agent_thread_by_session(&storage_root, &session.id)
        .expect("read thread by session")
        .expect("thread exists");
    assert_eq!(persisted.id, thread.id);
}

#[test]
fn archive_and_resume_round_trip() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("thread archive".to_string()),
        profile_id: None,
    })
    .expect("create session");
    let thread = ensure_thread(AgentEnsureThreadRequest {
        storage_root: storage_root.clone(),
        session_id: session.id,
    })
    .expect("ensure thread");

    let archived = archive_thread(AgentArchiveThreadRequest {
        storage_root: storage_root.clone(),
        thread_id: thread.id.clone(),
    })
    .expect("archive thread");
    assert_eq!(
        archived.lifecycle_state,
        crate::agent::types::AgentThreadLifecycleState::Archived
    );

    let resumed = resume_thread(AgentResumeThreadRequest {
        storage_root,
        thread_id: thread.id,
    })
    .expect("resume thread");
    assert_eq!(
        resumed.lifecycle_state,
        crate::agent::types::AgentThreadLifecycleState::Active
    );
}

#[test]
fn fork_and_rollback_create_branch_threads() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let source_session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("thread source".to_string()),
        profile_id: None,
    })
    .expect("create source session");
    let source_thread = ensure_thread(AgentEnsureThreadRequest {
        storage_root: storage_root.clone(),
        session_id: source_session.id.clone(),
    })
    .expect("ensure source thread");
    let source_turn =
        registry_db::create_agent_turn(&storage_root, &source_session.id, "profile-test")
            .expect("create source turn");

    let forked = fork_thread(AgentForkThreadRequest {
        storage_root: storage_root.clone(),
        thread_id: source_thread.id.clone(),
        source_turn_id: Some(source_turn.id.clone()),
        title: Some("forked branch".to_string()),
    })
    .expect("fork thread");
    assert_eq!(
        forked.thread.parent_thread_id.as_deref(),
        Some(source_thread.id.as_str())
    );
    assert_eq!(
        forked.thread.forked_from_turn_id.as_deref(),
        Some(source_turn.id.as_str())
    );

    let rolled_back = rollback_thread(AgentRollbackThreadRequest {
        storage_root: storage_root.clone(),
        thread_id: source_thread.id.clone(),
        turn_id: source_turn.id.clone(),
        title: Some("rollback branch".to_string()),
    })
    .expect("rollback thread");
    assert_eq!(
        rolled_back.thread.parent_thread_id.as_deref(),
        Some(source_thread.id.as_str())
    );
    assert_eq!(
        rolled_back.thread.rollback_from_thread_id.as_deref(),
        Some(source_thread.id.as_str())
    );
    assert_eq!(
        rolled_back.thread.rollback_from_turn_id.as_deref(),
        Some(source_turn.id.as_str())
    );
}

#[test]
fn elicitation_counter_update_is_persisted() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("thread counter".to_string()),
        profile_id: None,
    })
    .expect("create session");
    let thread = ensure_thread(AgentEnsureThreadRequest {
        storage_root: storage_root.clone(),
        session_id: session.id,
    })
    .expect("ensure thread");
    let updated = registry_db::bump_agent_thread_elicitation_counter(&storage_root, &thread.id, 2)
        .expect("bump counter");
    assert_eq!(updated.elicitation_counter, 2);
}
