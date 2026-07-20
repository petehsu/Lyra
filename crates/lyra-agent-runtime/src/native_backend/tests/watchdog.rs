//! Watchdog / deadline layer integration tests.
//!
//! These tests verify that when a turn body blocks past its deadline, the
//! session state is correctly finalized — `turnStatus` transitions from
//! `"running"` to `"finished"`, `activeTurnId` is cleared, and a failure
//! detail is recorded. This is the synchronous equivalent of Codex's
//! `tokio::time::timeout` + `AbortOnDropHandle` pattern.

use super::*;

#[test]
fn snapshot_only_active_turn_is_accepted_until_switched_or_cancelled() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Snapshot Active Turn Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = format!("turn-{}", Uuid::new_v4());
    {
        let mut state = state().lock().expect("state lock");
        let session = state.sessions.get_mut(&session_id).expect("session");
        session.snapshot["turnStatus"] = json!("running");
        session.snapshot["activeTurnId"] = json!(turn_id);
    }

    assert!(session_runtime::turn_is_active(&session_id, &turn_id));
    record_tool_activity(
        &session_id,
        &turn_id,
        tool_activity(
            "tool-snapshot-active",
            "read_file",
            "Read workspace",
            "completed",
            json!({ "path": "Cargo.toml" }),
            Some(json!({ "content": "workspace inspected" })),
            &now(),
            Some(now()),
        ),
        "toolFinished",
    );
    assert!(
        state()
            .lock()
            .expect("state lock")
            .sessions
            .get(&session_id)
            .and_then(|session| session.snapshot["tools"].as_array())
            .is_some_and(|tools| tools
                .iter()
                .any(|tool| tool["id"] == "tool-snapshot-active"))
    );

    {
        let mut state = state().lock().expect("state lock");
        let session = state.sessions.get_mut(&session_id).expect("session");
        session.snapshot["activeTurnId"] = json!(format!("turn-{}", Uuid::new_v4()));
    }
    assert!(!session_runtime::turn_is_active(&session_id, &turn_id));
    record_tool_activity(
        &session_id,
        &turn_id,
        tool_activity(
            "tool-late-after-switch",
            "read_file",
            "Late read",
            "completed",
            json!({ "path": "late.txt" }),
            Some(json!({ "content": "must not commit" })),
            &now(),
            Some(now()),
        ),
        "toolFinished",
    );
    assert!(
        state()
            .lock()
            .expect("state lock")
            .sessions
            .get(&session_id)
            .and_then(|session| session.snapshot["tools"].as_array())
            .is_some_and(|tools| tools
                .iter()
                .all(|tool| tool["id"] != "tool-late-after-switch"))
    );

    {
        let mut state = state().lock().expect("state lock");
        let session = state.sessions.get_mut(&session_id).expect("session");
        session.snapshot["activeTurnId"] = json!(turn_id);
        session.snapshot["turnStatus"] = json!("idle");
    }
    assert!(!session_runtime::turn_is_active(&session_id, &turn_id));

    {
        let mut state = state().lock().expect("state lock");
        let session = state.sessions.get_mut(&session_id).expect("session");
        session.snapshot["turnStatus"] = json!("running");
    }
    session_runtime::request_turn_cancellation(&turn_id);
    assert!(!session_runtime::turn_is_active(&session_id, &turn_id));
    session_runtime::clear_turn_cancellation(&turn_id);
}

/// Verify that the turn watchdog finalizes a blocked turn as failed.
///
/// Sets up a session with a running turn, spawns a blocking body that sleeps
/// past a short deadline, and verifies that `finish_turn` (called by the
/// watchdog's `Err(_elapsed)` branch) transitions the session back to idle.
#[test]
fn turn_watchdog_finalizes_blocked_turn_as_failed() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method("agent.session.create", json!({ "title": "Watchdog Test" }))
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = format!("turn-{}", Uuid::new_v4());
    let cancellation = Arc::new(AtomicBool::new(false));

    let tool_id = "call-watchdog-clarification";
    let clarification_id = "clarification-watchdog";
    {
        let mut state = state().lock().expect("state lock");
        {
            let session = state.sessions.get_mut(&session_id).expect("session");
            session.snapshot["turnStatus"] = Value::String("running".to_string());
            session.snapshot["activeTurnId"] = Value::String(turn_id.clone());
            session.snapshot["tools"] = json!([{
                "id": tool_id,
                "name": "clarification",
                "status": "running",
                "input": { "turnId": turn_id },
                "startedAt": now(),
                "finishedAt": Value::Null,
                "output": Value::Null,
            }]);
            session
                .runtime_turns
                .push(runtime_turn(&turn_id, &session_id, "running", None, None));
        }
        state.pending_clarifications.insert(
            clarification_id.to_string(),
            ClarificationRequest {
                id: clarification_id.to_string(),
                session_id: session_id.clone(),
                turn_id: turn_id.clone(),
                tool_call_id: tool_id.to_string(),
                question: "Continue?".to_string(),
                i18n_key: None,
                options: Vec::new(),
                allow_custom_answer: true,
                detail: None,
                detail_i18n_key: None,
                status: "pending".to_string(),
                answer: None,
                selected_option: None,
                created_at: now(),
                responded_at: None,
            },
        );
    }
    session_runtime::register_active_turn(&session_id, &turn_id, cancellation.clone());

    // Simulate the watchdog pattern: race spawn_blocking against a short deadline.
    // The body sleeps for 5s — longer than the 1s deadline — so the watchdog
    // fires and finalizes the turn.
    let deadline = Duration::from_millis(40);
    let watchdog_session_id = session_id.clone();
    let watchdog_turn_id = turn_id.clone();
    let handle = turn_engine::runtime().spawn_blocking(move || {
        std::thread::sleep(Duration::from_millis(250));
    });

    // Drive the watchdog from the test thread using block_on.
    turn_engine::block_on(async move {
        match tokio::time::timeout(deadline, handle).await {
            Ok(Ok(())) => panic!("blocking body completed before deadline — test invalid"),
            Ok(Err(_panic)) => panic!("blocking body panicked — test invalid"),
            Err(_elapsed) => {
                // Deadline elapsed — finalize the turn, exactly as spawn_turn does.
                waiters::cancel_turn_waiters(&watchdog_turn_id);
                turns::finish_turn_with_metadata(
                    &watchdog_session_id,
                    &watchdog_turn_id,
                    "finished",
                    None,
                    Some(format!(
                        "Lyra runtime error: turn exceeded {deadline:?} deadline (watchdog)"
                    )),
                    None,
                    Some("watchdog_timeout".to_string()),
                );
            }
        }
    });

    // Give finish_turn a moment to propagate state changes.
    std::thread::sleep(Duration::from_millis(100));

    // Verify the session is back to idle and the turn is finalized.
    // `finish_turn("finished", ...)` maps to `turnStatus: "idle"` via
    // `session_turn_status_for_finish_status` — the session returns to idle,
    // which is the whole point: the UI recovers from the blocked "running" state.
    let runtime_state = state().lock().expect("state lock");
    let session = runtime_state
        .sessions
        .get(&session_id)
        .expect("session exists");
    let turn_status = session
        .snapshot
        .get("turnStatus")
        .and_then(Value::as_str)
        .expect("turnStatus");
    assert_eq!(
        turn_status, "idle",
        "turn should be finalized back to idle, got: {turn_status}"
    );
    assert!(
        session.snapshot.get("activeTurnId").is_none()
            || session.snapshot["activeTurnId"].is_null(),
        "activeTurnId should be cleared after watchdog finalization"
    );
    let runtime_turn = session
        .runtime_turns
        .iter()
        .find(|rt| rt.get("runtimeTurnId").and_then(Value::as_str) == Some(&turn_id))
        .expect("runtime turn exists");
    assert_eq!(
        runtime_turn.get("state").and_then(Value::as_str),
        Some("interrupted"),
        "watchdog failures must not look completed"
    );
    assert_eq!(runtime_turn["failureKind"], "watchdog_timeout");
    assert!(
        !runtime_state
            .pending_clarifications
            .contains_key(clarification_id)
    );
    let tool = session.snapshot["tools"]
        .as_array()
        .expect("tools")
        .iter()
        .find(|tool| tool["id"] == tool_id)
        .expect("clarification tool");
    assert_eq!(tool["status"], "failed");
    assert!(tool["finishedAt"].as_str().is_some());
    assert!(
        tool.pointer("/output/content")
            .and_then(Value::as_str)
            .is_some_and(|content| content.contains("watchdog"))
    );
    drop(runtime_state);

    record_tool_activity(
        &session_id,
        &turn_id,
        tool_activity(
            tool_id,
            "clarification",
            "Late clarification result",
            "completed",
            json!({ "turnId": turn_id }),
            Some(json!({ "content": "late result" })),
            &now(),
            Some(now()),
        ),
        "toolFinished",
    );
    let state = state().lock().expect("state lock");
    let tool = state.sessions[&session_id].snapshot["tools"]
        .as_array()
        .expect("tools")
        .iter()
        .find(|tool| tool["id"] == tool_id)
        .expect("clarification tool");
    assert_eq!(tool["status"], "failed");
}

#[test]
fn cancelled_turn_rejects_late_tool_activity_and_progress() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Late Tool Commit Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = format!("turn-{}", Uuid::new_v4());
    let cancellation = Arc::new(AtomicBool::new(false));
    {
        let mut state = state().lock().expect("state lock");
        let session = state.sessions.get_mut(&session_id).expect("session");
        session.snapshot["turnStatus"] = Value::String("running".to_string());
        session.snapshot["activeTurnId"] = Value::String(turn_id.clone());
        session.snapshot["follow"] = json!({ "running": true, "activity": "waiting" });
        session
            .runtime_turns
            .push(runtime_turn(&turn_id, &session_id, "running", None, None));
    }
    session_runtime::register_active_turn(&session_id, &turn_id, cancellation.clone());
    session_runtime::request_turn_cancellation(&turn_id);

    let before = state()
        .lock()
        .expect("state lock")
        .sessions
        .get(&session_id)
        .expect("session")
        .snapshot
        .clone();
    let late_tool = tool_activity(
        "call-late",
        "write_file",
        "Late write",
        "completed",
        json!({ "path": "late.txt" }),
        Some(json!({ "content": "must not commit" })),
        &now(),
        Some(now()),
    );
    record_tool_activity(&session_id, &turn_id, late_tool.clone(), "toolFinished");
    record_tool_progress(&session_id, &turn_id, late_tool);

    let after = state()
        .lock()
        .expect("state lock")
        .sessions
        .get(&session_id)
        .expect("session")
        .snapshot
        .clone();
    assert_eq!(after, before);
    assert!(cancellation.load(Ordering::SeqCst));
    session_runtime::clear_active_turn(&session_id, &turn_id);
}
