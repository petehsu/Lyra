use rusqlite::Connection;
use serde_json::json;

use super::*;

fn temp_store() -> (tempfile::TempDir, AgentMemoryStore) {
    let dir = tempfile::tempdir().expect("tempdir");
    let store = AgentMemoryStore::new(dir.path().join("agent-memory")).expect("store");
    (dir, store)
}

#[test]
fn creates_full_session_layout_and_serializable_dtos() {
    let (_dir, store) = temp_store();
    let session = store
        .create_session(CreateSessionInput {
            title: Some("Memory Runtime".to_string()),
            working_dir: Some("/tmp/project".to_string()),
            provider_key: Some("openai".to_string()),
            model: Some("gpt-test".to_string()),
        })
        .expect("create session");

    let session_dir = store.root().join("sessions").join(&session.session_id);
    for file in [
        "session.sqlite",
        "event_log.sqlite",
        "runtime.sqlite",
        "context.sqlite",
        "cuts/cut_pack_0001.sqlite",
    ] {
        assert!(session_dir.join(file).exists(), "{file} exists");
    }
    for file in [
        "shared/shared_truth.sqlite",
        "shared/frozen_truth.sqlite",
        "shared/conflict_sets.sqlite",
    ] {
        assert!(store.root().join(file).exists(), "{file} exists");
    }

    let encoded = serde_json::to_string(&session).expect("serialize session");
    let decoded: SessionRecord = serde_json::from_str(&encoded).expect("deserialize session");
    assert_eq!(decoded.session_id, session.session_id);
    assert_eq!(decoded.schema_version, SCHEMA_VERSION);
}

#[test]
fn visibility_projection_keeps_literal_user_tags_but_hides_internal_events() {
    let (_dir, store) = temp_store();
    let session = store
        .create_session(CreateSessionInput::default())
        .expect("create session");
    let literal = "<system-reminder>\nliteral user text\n</system-reminder>";
    store
        .append_event(&session.session_id, NewSessionEvent::user_message(literal))
        .expect("literal user event");
    store
        .append_event(
            &session.session_id,
            NewSessionEvent::runtime_event(
                "server_reloading",
                None,
                json!({ "detail": "typed runtime state" }),
            ),
        )
        .expect("internal runtime event");

    let timeline = store
        .timeline_projection(&session.session_id, 50)
        .expect("timeline");
    assert_eq!(timeline.len(), 1);
    assert_eq!(timeline[0].role, EventRole::User);
    assert_eq!(timeline[0].payload_json["text"], literal);

    let internal = store
        .read_events_by_visibility(&session.session_id, Visibility::Internal)
        .expect("internal events");
    assert_eq!(internal.len(), 1);
    assert_eq!(internal[0].kind, "server_reloading");
}

#[test]
fn rejects_internal_timeline_events_and_keeps_event_log_append_only() {
    let (_dir, store) = temp_store();
    let session = store
        .create_session(CreateSessionInput::default())
        .expect("create session");
    let rejected = store.append_event(
        &session.session_id,
        NewSessionEvent {
            kind: "bad_internal".to_string(),
            role: EventRole::Runtime,
            payload: json!({}),
            visibility: Visibility::Internal,
            model_context_policy: ModelContextPolicy::Exclude,
            ui_policy: UiPolicy::ShowInTimeline,
            runtime_turn_id: None,
            lineage_json: json!({}),
        },
    );
    assert!(matches!(
        rejected,
        Err(AgentMemoryError::InvariantViolation(_))
    ));

    let event = store
        .append_event(
            &session.session_id,
            NewSessionEvent::assistant_message("visible", None),
        )
        .expect("append event");
    let conn = Connection::open(
        store
            .root()
            .join("sessions")
            .join(&session.session_id)
            .join("event_log.sqlite"),
    )
    .expect("event db");
    let update_result = conn.execute(
        "UPDATE session_event SET kind = 'mutated' WHERE event_id = ?1",
        [&event.event_id],
    );
    assert!(update_result.is_err());
}

#[test]
fn runtime_turn_reload_recovery_and_context_use_typed_state() {
    let (_dir, store) = temp_store();
    let session = store
        .create_session(CreateSessionInput::default())
        .expect("create session");
    let user_event = store
        .append_event(
            &session.session_id,
            NewSessionEvent::user_message("latest real user intent"),
        )
        .expect("user event");
    let turn = store
        .start_runtime_turn(&session.session_id, Some(&user_event.event_id), None)
        .expect("runtime turn");
    store
        .transition_runtime_turn(
            &session.session_id,
            &turn.runtime_turn_id,
            RuntimeTurnState::CallingModel,
            "provider_request",
        )
        .expect("calling model");

    let interrupted = store
        .mark_active_turns_interrupted_by_reload(&session.session_id)
        .expect("interrupt active turns");
    assert_eq!(interrupted, vec![turn.runtime_turn_id.clone()]);
    assert_eq!(
        store
            .read_runtime_turn(&session.session_id, &turn.runtime_turn_id)
            .expect("read turn")
            .expect("turn")
            .state,
        RuntimeTurnState::Interrupted
    );

    let recovered = store
        .recover_interrupted_turns_after_reload(&session.session_id)
        .expect("recover");
    assert_eq!(recovered, vec![turn.runtime_turn_id.clone()]);
    let recovery_events = store
        .read_events_by_session(&session.session_id)
        .expect("recovery events");
    assert!(
        recovery_events
            .iter()
            .any(|event| event.kind == "server_reloading")
    );
    assert!(
        recovery_events
            .iter()
            .any(|event| event.kind == "turn_interrupted")
    );
    assert!(
        recovery_events
            .iter()
            .any(|event| event.kind == "server_reloaded")
    );
    assert!(
        recovery_events
            .iter()
            .any(|event| event.kind == "turn_recovered")
    );
    assert_eq!(
        store
            .read_runtime_turn(&session.session_id, &turn.runtime_turn_id)
            .expect("read recovered turn")
            .expect("turn")
            .state,
        RuntimeTurnState::RecoveringAfterReload
    );

    let context = store
        .build_context(&session.session_id, &turn.runtime_turn_id, 12_000)
        .expect("context");
    let layer_kinds = context
        .layers
        .iter()
        .map(|layer| layer.kind.clone())
        .collect::<Vec<_>>();
    for kind in [
        context::ContextLayerKind::SystemContract,
        context::ContextLayerKind::RuntimeState,
        context::ContextLayerKind::LatestUserIntent,
        context::ContextLayerKind::Pinned,
        context::ContextLayerKind::Tail,
        context::ContextLayerKind::ToolCapabilitySnapshot,
        context::ContextLayerKind::MiddleAnchors,
        context::ContextLayerKind::Head,
        context::ContextLayerKind::RetrievedArchives,
        context::ContextLayerKind::SharedFrozenMemory,
    ] {
        assert!(
            layer_kinds.contains(&kind),
            "missing context layer {kind:?}"
        );
    }
    assert!(context.layers.iter().any(|layer| {
        layer.kind == context::ContextLayerKind::LatestUserIntent
            && layer
                .payload_json
                .to_string()
                .contains("latest real user intent")
    }));
    assert!(context.layers.iter().any(|layer| {
        layer.kind == context::ContextLayerKind::RuntimeState
            && layer
                .payload_json
                .to_string()
                .contains("assembling_context")
    }));
}

#[test]
fn typed_tool_timeout_partial_does_not_become_assistant_text() {
    let (_dir, store) = temp_store();
    let session = store
        .create_session(CreateSessionInput::default())
        .expect("create session");
    let user_event = store
        .append_event(
            &session.session_id,
            NewSessionEvent::user_message("wait for page"),
        )
        .expect("user event");
    let turn = store
        .start_runtime_turn(&session.session_id, Some(&user_event.event_id), None)
        .expect("runtime turn");
    let result_id = store
        .append_tool_result(
            &session.session_id,
            &turn.runtime_turn_id,
            "lyra_lumen.wait",
            ToolResultStatus::TimedOutPartial,
            json!({ "until": "loadIdle" }),
            json!({ "elapsedMs": 30000 }),
            vec!["continue_with_available_page_state".to_string()],
        )
        .expect("tool result");
    assert!(result_id.starts_with("tool_result_"));

    let timeline = store
        .timeline_projection(&session.session_id, 20)
        .expect("timeline");
    assert_eq!(timeline.len(), 2);
    assert_eq!(timeline[0].role, EventRole::User);
    assert_eq!(timeline[1].role, EventRole::Tool);
    assert_eq!(timeline[1].kind, "tool_result");

    let turn_events = store
        .read_events_by_runtime_turn(&session.session_id, &turn.runtime_turn_id)
        .expect("turn events");
    assert!(turn_events.iter().any(|event| {
        event.kind == "tool_result"
            && event.model_context_policy == ModelContextPolicy::IncludeAsRuntimeState
            && event.visibility == Visibility::UserVisible
    }));

    store
        .append_tool_result(
            &session.session_id,
            &turn.runtime_turn_id,
            "runtime.reload",
            ToolResultStatus::UnknownAfterRecovery,
            json!({ "operation": "pending" }),
            json!({ "error": "runtime_reload_interrupted" }),
            vec!["inspect_runtime_state_before_retry".to_string()],
        )
        .expect("unknown after recovery");
    let audit_events = store
        .read_events_by_session(&session.session_id)
        .expect("audit events");
    assert!(
        audit_events
            .iter()
            .any(|event| event.kind == "pending_tool_unknown_after_recovery")
    );
}

#[test]
fn provider_request_clarification_browser_and_follow_are_typed_projection() {
    let (_dir, store) = temp_store();
    let session = store
        .create_session(CreateSessionInput::default())
        .expect("create session");
    let user_event = store
        .append_event(
            &session.session_id,
            NewSessionEvent::user_message("open a browser page"),
        )
        .expect("user event");
    let turn = store
        .start_runtime_turn(&session.session_id, Some(&user_event.event_id), None)
        .expect("runtime turn");
    let context = store
        .build_context(&session.session_id, &turn.runtime_turn_id, 8_000)
        .expect("context");
    store
        .bind_provider_request(
            &session.session_id,
            &turn.runtime_turn_id,
            "provider_request:test",
            Some(&context.context_snapshot_id),
        )
        .expect("bind provider request");
    store
        .record_clarification_request(
            &session.session_id,
            &turn.runtime_turn_id,
            "clar-test",
            json!({ "clarificationId": "clar-test", "question": "Which page?" }),
        )
        .expect("clarification request");
    store
        .record_browser_action(
            &session.session_id,
            &turn.runtime_turn_id,
            Some("tab-1"),
            Some("element-2"),
            "hover",
            json!({ "action": "hover" }),
        )
        .expect("browser action");
    let follow_session = store
        .record_follow_session(
            &session.session_id,
            &turn.runtime_turn_id,
            json!({ "mode": "live" }),
            "running",
        )
        .expect("follow session");
    store
        .record_follow_action(
            &session.session_id,
            &follow_session,
            "read_until",
            json!({ "condition": "textStable" }),
        )
        .expect("follow action");
    store
        .record_follow_frame(&session.session_id, &follow_session, json!({ "frame": 1 }))
        .expect("follow frame");

    let snapshot = store.snapshot(&session.session_id).expect("snapshot");
    assert!(snapshot.active_clarification.is_some());
    assert_eq!(snapshot.active_browser_targets.len(), 1);
    let turn = store
        .read_runtime_turn(&session.session_id, &turn.runtime_turn_id)
        .expect("read turn")
        .expect("turn");
    assert_eq!(
        turn.provider_request_ref.as_deref(),
        Some("provider_request:test")
    );
    assert_eq!(
        turn.context_snapshot_ref.as_deref(),
        Some(context.context_snapshot_id.as_str())
    );

    store
        .resolve_clarification(
            &session.session_id,
            &turn.runtime_turn_id,
            "clar-test",
            json!({ "answer": "Use the active tab." }),
        )
        .expect("resolve clarification");
    assert!(
        store
            .snapshot(&session.session_id)
            .expect("snapshot")
            .active_clarification
            .is_none()
    );
}

#[test]
fn active_process_and_rollback_marker_use_runtime_tables() {
    let (_dir, store) = temp_store();
    let session = store
        .create_session(CreateSessionInput::default())
        .expect("create session");
    let user_event = store
        .append_event(
            &session.session_id,
            NewSessionEvent::user_message("make a change"),
        )
        .expect("user event");
    let turn = store
        .start_runtime_turn(&session.session_id, Some(&user_event.event_id), None)
        .expect("turn");

    store
        .record_active_process(
            &session.session_id,
            Some(&turn.runtime_turn_id),
            4242,
            "session",
            json!({ "sessionId": session.session_id, "pid": 4242 }),
        )
        .expect("active process");
    assert_eq!(
        store.active_session_id_by_pid(4242).expect("by pid"),
        Some(session.session_id.clone())
    );
    assert_eq!(
        store.active_process_session_ids().expect("active ids"),
        vec![session.session_id.clone()]
    );
    store
        .mark_active_process_stopped(&session.session_id, Some(4242))
        .expect("stop process");
    assert_eq!(store.active_session_id_by_pid(4242).expect("by pid"), None);

    store
        .record_rollback_marker_for_message(
            &session.session_id,
            Some(&turn.runtime_turn_id),
            &user_event.event_id,
            json!({
                "id": "rollback-test",
                "sessionId": session.session_id,
                "messageId": user_event.event_id,
                "pending": false,
                "userText": "make a change",
                "checkpointHash": "abc123",
                "checkpointAt": "2026-01-01T00:00:00Z",
                "workingDir": "/tmp/project"
            }),
        )
        .expect("rollback marker");
    let marker = store
        .rollback_marker_for_message(&session.session_id, &user_event.event_id)
        .expect("marker")
        .expect("marker exists");
    assert_eq!(marker["id"], "rollback-test");
}

#[test]
fn context_pinned_layers_are_query_backed() {
    let (_dir, store) = temp_store();
    let session = store
        .create_session(CreateSessionInput::default())
        .expect("create session");
    let user_event = store
        .append_event(
            &session.session_id,
            NewSessionEvent::user_message("ship the patch"),
        )
        .expect("user event");
    let turn = store
        .start_runtime_turn(&session.session_id, Some(&user_event.event_id), None)
        .expect("turn");
    store
        .record_active_todos(
            &session.session_id,
            &turn.runtime_turn_id,
            &[json!({ "id": "todo-1", "content": "finish tests", "status": "pending" })],
        )
        .expect("todos");
    store
        .record_pinned_state(
            &session.session_id,
            "unresolved_commitments",
            json!({ "commitmentId": "commitment-1", "text": "report verification" }),
            Some(&turn.runtime_turn_id),
            vec!["commitment-1".to_string()],
        )
        .expect("commitment");
    store
        .record_policy_ref(
            &session.session_id,
            Some(&turn.runtime_turn_id),
            json!({ "policy": "project-security", "scope": "workspace" }),
            "active",
        )
        .expect("policy ref");
    store
        .record_delivery_obligation(
            &session.session_id,
            Some(&turn.runtime_turn_id),
            json!({ "obligation": "summarize changed files" }),
            "open",
        )
        .expect("delivery obligation");

    let context = store
        .build_context(&session.session_id, &turn.runtime_turn_id, 8_000)
        .expect("context");
    let pinned = context
        .layers
        .iter()
        .find(|layer| layer.kind == context::ContextLayerKind::Pinned)
        .expect("pinned layer");
    assert_eq!(pinned.payload_json["activeTodos"][0]["id"], "todo-1");
    assert_eq!(
        pinned.payload_json["unresolvedCommitments"][0]["commitmentId"],
        "commitment-1"
    );
    assert_eq!(
        pinned.payload_json["securityProjectPolicyRefs"][0]["payload"]["policy"],
        "project-security"
    );
    assert_eq!(
        pinned.payload_json["deliveryObligations"][0]["payload"]["obligation"],
        "summarize changed files"
    );
}

#[test]
fn context_head_budget_decays_with_turn_count() {
    let (_dir, store) = temp_store();
    let session = store
        .create_session(CreateSessionInput::default())
        .expect("create session");
    let user_event = store
        .append_event(
            &session.session_id,
            NewSessionEvent::user_message("initial request"),
        )
        .expect("user event");
    let turn = store
        .start_runtime_turn(&session.session_id, Some(&user_event.event_id), None)
        .expect("turn");

    let first_context = store
        .build_context(&session.session_id, &turn.runtime_turn_id, 20_000)
        .expect("first context");
    let first_budget = first_context
        .layers
        .iter()
        .find(|layer| layer.kind == context::ContextLayerKind::Head)
        .expect("head layer")
        .token_budget;

    for _ in 0..40 {
        store
            .start_runtime_turn(&session.session_id, Some(&user_event.event_id), None)
            .expect("extra turn");
    }

    let later_context = store
        .build_context(&session.session_id, &turn.runtime_turn_id, 20_000)
        .expect("later context");
    let later_budget = later_context
        .layers
        .iter()
        .find(|layer| layer.kind == context::ContextLayerKind::Head)
        .expect("head layer")
        .token_budget;

    assert!(later_budget < first_budget);
    assert!(later_budget >= 1);
}

#[test]
fn trim_archives_before_live_compaction_and_shared_memory_requires_evidence() {
    let (_dir, store) = temp_store();
    let session = store
        .create_session(CreateSessionInput::default())
        .expect("create session");
    for index in 0..32 {
        store
            .append_event(
                &session.session_id,
                NewSessionEvent::user_message(format!("message {index}")),
            )
            .expect("append event");
    }
    let decision = store
        .run_adaptive_trim(&session.session_id, Some(10_000), Some(40_000))
        .expect("trim");
    assert_eq!(decision.state, trim::TrimJournalState::Archived);
    let manifest_path = store
        .root()
        .join("sessions")
        .join(&session.session_id)
        .join("manifests")
        .join("cuts.manifest.json");
    assert!(manifest_path.exists());
    let cut_conn = Connection::open(
        store
            .root()
            .join("sessions")
            .join(&session.session_id)
            .join("cuts")
            .join("cut_pack_0001.sqlite"),
    )
    .expect("cut db");
    let archived_count: i64 = cut_conn
        .query_row("SELECT COUNT(*) FROM cut_payload", [], |row| row.get(0))
        .expect("cut count");
    assert!(archived_count > 0);

    let shared = store
        .update_shared_memory(
            "global",
            json!({ "fact": "prefers structured memory" }),
            Vec::new(),
            SharedMemoryStatus::Candidate,
            true,
        )
        .expect("shared memory");
    assert_eq!(shared.status, SharedMemoryStatus::Candidate);
    assert!(shared.negative);
    assert!(!shared.evidence_refs.is_empty());
}

#[test]
fn shared_memory_auto_promotion_uses_structured_signals() {
    let (_dir, store) = temp_store();
    let promoted = store
        .infer_shared_memory_status(
            "global",
            &json!({
                "preference": "structured runtime state",
                "source": { "kind": "tool_result", "count": 3 }
            }),
            &[
                "event:one".to_string(),
                "event:two".to_string(),
                "tool:three".to_string(),
            ],
            false,
        )
        .expect("infer status");
    assert_eq!(promoted, SharedMemoryStatus::DelayedPromotion);

    store
        .update_shared_memory(
            "project",
            json!({ "policy": "existing active policy" }),
            vec!["event:active".to_string()],
            SharedMemoryStatus::Active,
            false,
        )
        .expect("active memory");
    let conflict = store
        .infer_shared_memory_status(
            "project",
            &json!({ "policy": "conflicting policy" }),
            &[
                "event:a".to_string(),
                "event:b".to_string(),
                "event:c".to_string(),
            ],
            false,
        )
        .expect("infer conflict");
    assert_eq!(conflict, SharedMemoryStatus::ConflictCandidate);
}

#[test]
fn summary_projection_is_lineage_metadata_not_primary_truth() {
    let (_dir, store) = temp_store();
    let session = store
        .create_session(CreateSessionInput::default())
        .expect("create session");
    let first = store
        .append_event(
            &session.session_id,
            NewSessionEvent::user_message("old request"),
        )
        .expect("first event");
    let latest = store
        .append_event(
            &session.session_id,
            NewSessionEvent::user_message("new request"),
        )
        .expect("latest event");
    let summary_id = store
        .create_summary_projection(
            &session.session_id,
            Some((first.event_id.clone(), first.event_id)),
            Vec::new(),
            "test",
            0.4,
            vec!["new request omitted".to_string()],
            Some(latest.event_id.clone()),
        )
        .expect("summary");
    assert!(summary_id.starts_with("summary_"));
    let turn = store
        .start_runtime_turn(&session.session_id, Some(&latest.event_id), None)
        .expect("turn");
    let context = store
        .build_context(&session.session_id, &turn.runtime_turn_id, 4_000)
        .expect("context");
    let latest_layer = context
        .layers
        .iter()
        .find(|layer| layer.kind == context::ContextLayerKind::LatestUserIntent)
        .expect("latest user intent layer");
    assert!(
        latest_layer
            .payload_json
            .to_string()
            .contains("new request")
    );
    assert!(!context.layers.iter().any(|layer| {
        layer
            .payload_json
            .to_string()
            .contains("new request omitted")
            && layer.kind != context::ContextLayerKind::LatestUserIntent
    }));
}

#[test]
fn old_journal_importer_is_optional_and_never_promotes_legacy_truth() {
    let importer = migration::DisabledOldJournalImporter;
    let plan = migration::OldJournalImporter::plan(
        &importer,
        "/tmp/legacy/session.journal.jsonl",
        "session-new",
    );
    assert!(!plan.enabled_for_startup);

    let marker = plan.classify_entry(migration::OldJournalEntryDraft {
        kind: migration::OldJournalEntryKind::ReloadMarker,
        payload: json!({ "text": "[generation interrupted - server reloading]" }),
        has_lineage: false,
    });
    assert_eq!(
        marker.disposition,
        migration::OldJournalImportDisposition::AuditOnlyRuntimeEvent
    );
    assert_eq!(marker.visibility, Visibility::AuditOnly);
    assert_eq!(marker.model_context_policy, ModelContextPolicy::Exclude);
    assert!(!marker.becomes_primary_truth);

    let summary = plan.classify_entry(migration::OldJournalEntryDraft {
        kind: migration::OldJournalEntryKind::Summary,
        payload: json!({ "summary": "old task" }),
        has_lineage: true,
    });
    assert_eq!(
        summary.disposition,
        migration::OldJournalImportDisposition::LowConfidenceSummaryProjection
    );
    assert_eq!(
        summary.model_context_policy,
        ModelContextPolicy::IncludeSummarized
    );
    assert!(!summary.becomes_primary_truth);

    let missing_lineage = plan.classify_entry(migration::OldJournalEntryDraft {
        kind: migration::OldJournalEntryKind::Summary,
        payload: json!({ "summary": "untrusted old task" }),
        has_lineage: false,
    });
    assert_eq!(
        missing_lineage.disposition,
        migration::OldJournalImportDisposition::IgnoredMissingLineage
    );
    assert_eq!(
        missing_lineage.model_context_policy,
        ModelContextPolicy::Exclude
    );
    assert_eq!(missing_lineage.ui_policy, UiPolicy::HideFromUser);

    let visible = plan.classify_entry(migration::OldJournalEntryDraft {
        kind: migration::OldJournalEntryKind::VisibleAssistantText,
        payload: json!({ "text": "visible assistant reply" }),
        has_lineage: false,
    });
    assert_eq!(
        visible.disposition,
        migration::OldJournalImportDisposition::VisibleTimelineMessage
    );
    assert_eq!(visible.visibility, Visibility::UserVisible);
    assert_eq!(visible.ui_policy, UiPolicy::ShowInTimeline);
}
