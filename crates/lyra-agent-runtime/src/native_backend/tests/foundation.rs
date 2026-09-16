use super::*;

#[test]
fn native_backend_creates_and_reads_session() {
    // A session created without an explicit working directory defaults to the
    // user's home directory and is bound (projectBound=true, workingDirIsHome=true)
    // — there are no unbound sessions.
    let home = dirs::home_dir()
        .map(|path| path.display().to_string())
        .expect("home directory");
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method("agent.session.create", json!({ "title": "Test" }))
        .expect("create session");
    assert_eq!(created["workingDir"], home);
    assert_eq!(created["projectBound"], true);
    assert_eq!(created["workingDirIsHome"], true);
    let session_id = created["id"].as_str().expect("session id").to_string();
    let read = backend
        .call_agent_method("agent.session.read", json!({ "sessionId": session_id }))
        .expect("read session");
    assert_eq!(read["title"], "Test");
    assert_eq!(read["workingDir"], home);
    assert_eq!(read["projectBound"], true);
    assert_eq!(read["workingDirIsHome"], true);
}

#[test]
fn temporary_session_is_ephemeral_seeded_and_hidden() {
    let project = tempfile::tempdir().expect("project tempdir");
    let backend = LyraAgentBackend;
    let parent = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Parent", "workingDir": project.path().display().to_string() }),
        )
        .expect("create parent session");
    let parent_session_id = parent["id"].as_str().expect("parent id").to_string();

    // Seed an active plan on the parent so the temp session has plan context to embed.
    let parent_id = parent_session_id.clone();
    {
        let mut state = state().lock().expect("state lock");
        let session = state.sessions.get_mut(&parent_id).expect("parent session");
        session.snapshot["plan"] = json!({
            "activePlanId": "plan-temp-1",
            "activeVersionId": "plan-temp-1",
            "title": "Plan Mode Test",
            "markdown": "# Plan\n\n- step 1\n- step 2\n",
            "annotations": [],
            "phase": PLAN_PHASE_REVIEWING,
            "review": { "status": "pending", "summary": null }
        });
        state.save_state().expect("save state");
    }

    let temp = backend
        .call_agent_method(
            "agent.session.createTemporary",
            json!({ "parentSessionId": parent_session_id }),
        )
        .expect("create temporary session");
    assert_eq!(temp["sessionKind"], "temporary");
    assert_eq!(temp["ephemeral"], true);
    assert_eq!(temp["parentSessionId"], parent_session_id);
    // The seed message embeds the plan markdown.
    let messages = temp["messages"].as_array().expect("messages array");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["role"], "user");
    assert!(
        messages[0]["text"]
            .as_str()
            .is_some_and(|text| text.contains("# Plan") && text.contains("step 1"))
    );
    let temp_session_id = temp["id"].as_str().expect("temp id").to_string();

    // The active session must remain the parent, not the temp session.
    {
        let state = state().lock().expect("state lock");
        assert_eq!(state.active_session_id.as_deref(), Some(parent_id.as_str()));
        assert!(
            state
                .sessions
                .get(&temp_session_id)
                .map(|session| session.ephemeral)
                .unwrap_or(false)
        );
    }

    // Ephemeral sessions never appear in the session list.
    let listed = backend
        .call_agent_method("agent.session.list", json!({}))
        .expect("list sessions");
    let listed_ids = listed["sessions"]
        .as_array()
        .expect("sessions array")
        .iter()
        .filter_map(|value| value["sessionId"].as_str().or(value["id"].as_str()))
        .collect::<Vec<_>>();
    assert!(!listed_ids.contains(&temp_session_id.as_str()));

    // Deleting the temp session removes it from memory (best-effort, no disk file).
    let deleted = backend
        .call_agent_method(
            "agent.session.delete",
            json!({ "sessionId": temp_session_id }),
        )
        .expect("delete temp session");
    assert_eq!(deleted["deleted"], true);
    {
        let state = state().lock().expect("state lock");
        assert!(!state.sessions.contains_key(&temp_session_id));
    }

    // Cleanup parent.
    let _ = backend.call_agent_method("agent.session.delete", json!({ "sessionId": parent_id }));
}

#[test]
fn plan_mode_lifecycle_reaches_reviewing_phase() {
    let project = tempfile::tempdir().expect("project tempdir");
    let mut session = new_session(
        Some("Plan Mode Test".to_string()),
        Some(project.path().display().to_string()),
        "normal",
    );
    let session_id = session.id.clone();
    {
        let mut state = state().lock().expect("state lock");
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
    }
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = session_runtime::cancellation_token(&turn_id).expect("active cancellation");
    let started_at = now();
    record_test_investigation(&session_id, &turn_id, "tool-plan-investigation");

    let begin = execute_plan_tool_adapter_sync(
        &session_id,
        &turn_id,
        &cancellation,
        "tool-plan-begin",
        PLAN_BEGIN_MODEL_TOOL,
        "begin",
        json!({
            "title": "Implement plan mode",
            "reason": "Large cross-cutting feature",
            "scope": "Runtime first"
        }),
        &started_at,
    );
    assert_eq!(begin["raw"]["phase"], PLAN_PHASE_PLANNING);

    let write = execute_plan_tool_adapter_sync(
        &session_id,
        &turn_id,
        &cancellation,
        "tool-plan-write",
        PLAN_WRITE_MODEL_TOOL,
        "write",
        json!({
            "markdownDelta": "# Plan\n\nArchitecture: keep runtime behavior in the existing plan module boundary.\n\nVerification: run the focused runtime tests.\n",
            "replace": false
        }),
        &started_at,
    );
    assert_eq!(write["raw"]["activityKind"], "plan");
    assert!(
        write["raw"]["diff"]
            .as_str()
            .is_some_and(|diff| diff.contains("+# Plan"))
    );

    let finalized = execute_plan_tool_adapter_sync(
        &session_id,
        &turn_id,
        &cancellation,
        "tool-plan-finalize",
        PLAN_FINALIZE_MODEL_TOOL,
        "finalize",
        json!({
            "summary": "Runtime plan is ready for review.",
            "investigationEvidenceIds": ["tool-plan-investigation"]
        }),
        &started_at,
    );
    assert_eq!(finalized["raw"]["phase"], PLAN_PHASE_REVIEWING);

    let (phase, review_status, project_key) = {
        let state = state().lock().expect("state lock");
        let session = state.sessions.get(&session_id).expect("session");
        (
            session.snapshot["plan"]["phase"].clone(),
            session.snapshot["plan"]["review"]["status"].clone(),
            session.snapshot["plan"]["projectKey"]
                .as_str()
                .map(str::to_string),
        )
    };
    assert_eq!(phase, PLAN_PHASE_REVIEWING);
    assert_eq!(review_status, "pending");
    let project_key = project_key.expect("project key");
    let root = {
        let state = state().lock().expect("state lock");
        state.root.clone()
    };
    assert!(project_plan_db_path(&root, &project_key).exists());
}

#[test]
fn project_plan_store_lists_reads_revises_and_deletes_plan() {
    let project = tempfile::tempdir().expect("project tempdir");
    let working_dir = project.path().display().to_string();
    let mut session = new_session(
        Some("Project Plan Store Test".to_string()),
        Some(working_dir.clone()),
        "normal",
    );
    let session_id = session.id.clone();
    {
        let mut state = state().lock().expect("state lock");
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
    }
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = session_runtime::cancellation_token(&turn_id).expect("active cancellation");
    let started_at = now();
    record_test_investigation(&session_id, &turn_id, "tool-plan-store-investigation");

    execute_plan_tool_adapter_sync(
        &session_id,
        &turn_id,
        &cancellation,
        "tool-plan-begin-store",
        PLAN_BEGIN_MODEL_TOOL,
        "begin",
        json!({
            "title": "Stored plan",
            "reason": "Project visible plan",
            "scope": "Store API"
        }),
        &started_at,
    );
    execute_plan_tool_adapter_sync(
        &session_id,
        &turn_id,
        &cancellation,
        "tool-plan-write-store",
        PLAN_WRITE_MODEL_TOOL,
        "write",
        json!({
            "markdownDelta": "# Stored plan\n\nArchitecture: keep project-list persistence in its existing module boundary.\n\nVerification: run the focused plan-store tests.\n",
            "replace": false
        }),
        &started_at,
    );
    execute_plan_tool_adapter_sync(
        &session_id,
        &turn_id,
        &cancellation,
        "tool-plan-finalize-store",
        PLAN_FINALIZE_MODEL_TOOL,
        "finalize",
        json!({
            "summary": "Ready",
            "investigationEvidenceIds": ["tool-plan-store-investigation"]
        }),
        &started_at,
    );
    let (plan_id, version_id) = {
        let state = state().lock().expect("state lock");
        let session = state.sessions.get(&session_id).expect("session");
        (
            session.snapshot["plan"]["activePlanId"]
                .as_str()
                .expect("plan id")
                .to_string(),
            session.snapshot["plan"]["activeVersionId"]
                .as_str()
                .expect("version id")
                .to_string(),
        )
    };

    let listed = LyraAgentBackend
        .call_agent_method(
            "agent.plan.list",
            json!({
                "workingDir": working_dir
            }),
        )
        .expect("list project plans");
    assert_eq!(listed["plans"][0]["planId"], plan_id);

    let read = LyraAgentBackend
        .call_agent_method(
            "agent.plan.read",
            json!({
                "workingDir": working_dir,
                "planId": plan_id
            }),
        )
        .expect("read project plan");
    assert_eq!(read["currentVersion"]["versionId"], version_id);
    assert_eq!(read["currentVersion"]["source"], "agent");

    let revised = LyraAgentBackend
        .call_agent_method(
            "agent.plan.revise",
            json!({
                "sessionId": session_id,
                "planId": plan_id,
                "baseVersionId": version_id,
                "markdown": "# Stored plan\n\n- Build project list\n- Add review edits\n",
                "source": "user_edit",
                "annotations": [{
                    "id": "annotation-1",
                    "lineId": "line-3",
                    "line": 3,
                    "kind": "comment",
                    "text": "Please keep this visible."
                }],
                "summary": "User edited the plan"
            }),
        )
        .expect("revise project plan");
    assert_eq!(revised["plan"]["review"]["status"], "changed");
    assert_eq!(revised["plan"]["phase"], PLAN_PHASE_REVIEWING);
    let revised_version_id = revised["plan"]["activeVersionId"]
        .as_str()
        .expect("revised version id")
        .to_string();
    assert_ne!(revised_version_id, version_id);

    let reread = LyraAgentBackend
        .call_agent_method(
            "agent.plan.read",
            json!({
                "sessionId": session_id,
                "planId": plan_id
            }),
        )
        .expect("reread project plan");
    assert_eq!(reread["currentVersion"]["versionId"], revised_version_id);
    assert_eq!(reread["currentVersion"]["source"], "user_edit");
    assert_eq!(
        reread["currentVersion"]["parentVersionId"]
            .as_str()
            .expect("parent version id"),
        version_id
    );

    let deleted = LyraAgentBackend
        .call_agent_method(
            "agent.plan.delete",
            json!({
                "sessionId": session_id,
                "planId": plan_id
            }),
        )
        .expect("delete project plan");
    assert_eq!(deleted["deleted"], true);
}

#[test]
fn plan_mode_blocks_file_mutation_before_approval_and_todo() {
    let project = tempfile::tempdir().expect("project tempdir");
    let mut session = new_session(
        Some("Plan Gate Test".to_string()),
        Some(project.path().display().to_string()),
        "normal",
    );
    let session_id = session.id.clone();
    session.snapshot["plan"] = json!({
        "activePlanId": format!("plan-{}", Uuid::new_v4()),
        "activeVersionId": format!("plan-version-{}", Uuid::new_v4()),
        "projectKey": project_key_for_working_dir(&project.path().display().to_string()).expect("project key"),
        "title": "Blocked mutation",
        "phase": PLAN_PHASE_PLANNING,
        "markdown": "# Plan\n",
        "annotations": [],
        "review": { "status": "none", "summary": Value::Null }
    });
    {
        let mut state = state().lock().expect("state lock");
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
    }
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = session_runtime::cancellation_token(&turn_id).expect("active cancellation");

    let output = execute_model_tool_with_runtime_sync(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ToolExecutionRuntime::default(),
        ModelToolCall {
            id: "tool-blocked-write".to_string(),
            name: WRITE_FILE_MODEL_TOOL.to_string(),
            arguments: json!({
                "path": "index.html",
                "content": "<!doctype html>",
                "overwrite": true
            }),
        },
    );

    assert_eq!(output["error"]["code"], "plan_required_before_execution");
    assert!(!project.path().join("index.html").exists());
}

#[test]
fn plan_mode_blocks_mutation_without_in_progress_todo() {
    let project = tempfile::tempdir().expect("project tempdir");
    let mut session = new_session(
        Some("Plan Todo Gate Test".to_string()),
        Some(project.path().display().to_string()),
        "normal",
    );
    let session_id = session.id.clone();
    session.snapshot["plan"] = json!({
        "activePlanId": format!("plan-{}", Uuid::new_v4()),
        "activeVersionId": format!("plan-version-{}", Uuid::new_v4()),
        "projectKey": project_key_for_working_dir(&project.path().display().to_string()).expect("project key"),
        "title": "Todo gate",
        "phase": PLAN_PHASE_EXECUTING_TODO,
        "markdown": "# Plan\n",
        "annotations": [],
        "review": { "status": "approved", "summary": "Approved" }
    });
    session.snapshot["projectTodo"] = json!({
        "todoListId": format!("todo-list-{}", Uuid::new_v4()),
        "planId": session.snapshot["plan"]["activePlanId"].clone(),
        "versionId": session.snapshot["plan"]["activeVersionId"].clone(),
        "status": "running",
        "currentIndex": 0,
        "todos": [
            { "id": "runtime", "content": "Implement runtime support", "status": "pending" }
        ],
        "summary": Value::Null
    });
    session.snapshot["todos"] = session.snapshot["projectTodo"]["todos"].clone();
    {
        let mut state = state().lock().expect("state lock");
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
    }
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = session_runtime::cancellation_token(&turn_id).expect("active cancellation");

    let output = execute_model_tool_with_runtime_sync(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ToolExecutionRuntime::default(),
        ModelToolCall {
            id: "tool-blocked-without-active-todo".to_string(),
            name: WRITE_FILE_MODEL_TOOL.to_string(),
            arguments: json!({
                "path": "index.html",
                "content": "<!doctype html>",
                "overwrite": true
            }),
        },
    );

    assert_eq!(
        output["error"]["code"],
        "todo_in_progress_required_before_execution"
    );
    assert!(!project.path().join("index.html").exists());
}

#[test]
fn executing_todo_allows_inspection_shell_without_in_progress() {
    let project = tempfile::tempdir().expect("project tempdir");
    let mut session = new_session(
        Some("Plan Inspection Shell Test".to_string()),
        Some(project.path().display().to_string()),
        "normal",
    );
    let session_id = session.id.clone();
    session.snapshot["plan"] = json!({
        "activePlanId": format!("plan-{}", Uuid::new_v4()),
        "activeVersionId": format!("plan-version-{}", Uuid::new_v4()),
        "projectKey": project_key_for_working_dir(&project.path().display().to_string()).expect("project key"),
        "title": "Inspect without in_progress",
        "phase": PLAN_PHASE_EXECUTING_TODO,
        "markdown": "# Plan\n",
        "annotations": [],
        "review": { "status": "approved", "summary": "Approved" }
    });
    session.snapshot["projectTodo"] = json!({
        "todoListId": format!("todo-list-{}", Uuid::new_v4()),
        "planId": session.snapshot["plan"]["activePlanId"].clone(),
        "versionId": session.snapshot["plan"]["activeVersionId"].clone(),
        "status": "running",
        "currentIndex": 0,
        "todos": [
            { "id": "runtime", "content": "Implement runtime support", "status": "pending" }
        ],
        "summary": Value::Null
    });
    session.snapshot["todos"] = session.snapshot["projectTodo"]["todos"].clone();
    {
        let mut state = state().lock().expect("state lock");
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
    }
    let turn_id = start_test_runtime_turn(&session_id);

    let inspected = tool_shell_run(
        &session_id,
        &turn_id,
        "tool-inspect-python",
        &json!({
            "timeoutMs": 8000,
            "command": "python3 -c 'print(1)'",
            "permissionGranted": true
        }),
    )
    .expect("inspection python should not be plan-gated");
    assert_ne!(inspected.raw["commandKind"], "mutation");

    let blocked = tool_shell_run(
        &session_id,
        &turn_id,
        "tool-mutation-without-todo",
        &json!({
            "timeoutMs": 8000,
            "command": "printf changed > output.txt",
            "permissionGranted": true
        }),
    )
    .expect_err("mutating shell still requires in_progress");
    assert_eq!(blocked.code, "todo_in_progress_required_before_execution");
}

#[test]
fn plan_review_approve_sets_todo_required_phase() {
    let project = tempfile::tempdir().expect("project tempdir");
    let mut session = new_session(
        Some("Plan Approval Test".to_string()),
        Some(project.path().display().to_string()),
        "normal",
    );
    let session_id = session.id.clone();
    session.snapshot["plan"] = json!({
        "activePlanId": format!("plan-{}", Uuid::new_v4()),
        "activeVersionId": format!("plan-version-{}", Uuid::new_v4()),
        "projectKey": project_key_for_working_dir(&project.path().display().to_string()).expect("project key"),
        "title": "Approve plan",
        "phase": PLAN_PHASE_REVIEWING,
        "markdown": "# Plan\n\n- Build runtime support\n",
        "annotations": [],
        "review": { "status": "pending", "summary": "Ready" }
    });
    {
        let mut state = state().lock().expect("state lock");
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
    }

    let reviewed = LyraAgentBackend
        .call_agent_method(
            "agent.plan.review.respond",
            json!({
                "sessionId": session_id,
                "action": "approve",
                "feedback": "Ship it",
                "continue": false
            }),
        )
        .expect("approve plan");

    assert_eq!(reviewed["plan"]["phase"], PLAN_PHASE_TODO_REQUIRED);
    assert_eq!(reviewed["plan"]["review"]["status"], "approved");
}

#[test]
fn plan_review_set_aside_is_non_terminal_and_resumable() {
    let project = tempfile::tempdir().expect("project tempdir");
    let mut session = new_session(
        Some("Plan Set Aside Test".to_string()),
        Some(project.path().display().to_string()),
        "normal",
    );
    let session_id = session.id.clone();
    session.snapshot["plan"] = json!({
        "activePlanId": format!("plan-{}", Uuid::new_v4()),
        "activeVersionId": format!("plan-version-{}", Uuid::new_v4()),
        "projectKey": project_key_for_working_dir(&project.path().display().to_string()).expect("project key"),
        "title": "Set aside plan",
        "phase": PLAN_PHASE_REVIEWING,
        "markdown": "# Plan\n\n- Build runtime support\n",
        "annotations": [],
        "review": { "status": "pending", "summary": "Ready" }
    });
    {
        let mut state = state().lock().expect("state lock");
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
    }

    let set_aside = LyraAgentBackend
        .call_agent_method(
            "agent.plan.review.respond",
            json!({
                "sessionId": session_id,
                "action": "set_aside",
                "feedback": "Later",
                "continue": false
            }),
        )
        .expect("set plan aside");
    assert_eq!(set_aside["plan"]["phase"], PLAN_PHASE_SET_ASIDE);
    assert_eq!(set_aside["plan"]["review"]["status"], "set_aside");

    // The plan must remain resumable: bringing it back returns it to review.
    let resumed = LyraAgentBackend
        .call_agent_method(
            "agent.plan.review.respond",
            json!({
                "sessionId": session_id,
                "action": "resume",
                "continue": false
            }),
        )
        .expect("resume plan");
    assert_eq!(resumed["plan"]["phase"], PLAN_PHASE_REVIEWING);
    assert_eq!(resumed["plan"]["review"]["status"], "pending");
}

#[test]
fn plan_write_without_begin_creates_draft_plan() {
    let project = tempfile::tempdir().expect("project tempdir");
    let mut session = new_session(
        Some("Implicit Plan Draft Test".to_string()),
        Some(project.path().display().to_string()),
        "normal",
    );
    let session_id = session.id.clone();
    {
        let mut state = state().lock().expect("state lock");
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
    }
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = session_runtime::cancellation_token(&turn_id).expect("active cancellation");
    let started_at = now();

    let written = execute_plan_tool_adapter_sync(
        &session_id,
        &turn_id,
        &cancellation,
        "tool-plan-write-implicit",
        PLAN_WRITE_MODEL_TOOL,
        "write",
        json!({
            "markdownDelta": "# Implicit Plan\n\n- Draft from first write\n"
        }),
        &started_at,
    );

    assert_eq!(written["raw"]["activityKind"], "plan");
    assert_eq!(written["raw"]["phase"], PLAN_PHASE_PLANNING);
    assert!(
        written["raw"]["planId"]
            .as_str()
            .is_some_and(|plan_id| plan_id.starts_with("plan-"))
    );
    let state = state().lock().expect("state lock");
    let session = state.sessions.get(&session_id).expect("session");
    assert_eq!(session.snapshot["plan"]["title"], "Plan");
    assert_eq!(session.snapshot["plan"]["phase"], PLAN_PHASE_PLANNING);
}

#[test]
fn implicit_plan_can_finalize_without_investigation() {
    let project = tempfile::tempdir().expect("project tempdir");
    let mut session = new_session(
        Some("Implicit Plan Investigation Boundary".to_string()),
        Some(project.path().display().to_string()),
        "normal",
    );
    let session_id = session.id.clone();
    {
        let mut state = state().lock().expect("state lock");
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
    }
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = session_runtime::cancellation_token(&turn_id).expect("active cancellation");

    let written = execute_plan_tool_adapter_sync(
        &session_id,
        &turn_id,
        &cancellation,
        "implicit-plan-write",
        PLAN_WRITE_MODEL_TOOL,
        "write",
        json!({
            "markdownDelta": "# Plan\n\n- Inspect and implement\n",
            "replace": true
        }),
        &now(),
    );
    assert_eq!(written["raw"]["phase"], PLAN_PHASE_PLANNING);
    let finalized = tool_plan_finalize(&session_id, &turn_id, &json!({}))
        .expect("finalize plan without investigation");
    assert_eq!(finalized.raw["phase"], PLAN_PHASE_REVIEWING);
}

#[test]
fn repeated_plan_begin_preserves_active_draft() {
    let project = tempfile::tempdir().expect("project tempdir");
    let mut session = new_session(
        Some("Idempotent Plan Begin Test".to_string()),
        Some(project.path().display().to_string()),
        "normal",
    );
    let session_id = session.id.clone();
    {
        let mut state = state().lock().expect("state lock");
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
    }
    let turn_id = start_test_runtime_turn(&session_id);

    let first = tool_plan_begin(&session_id, &turn_id, &json!({ "title": "Original plan" }))
        .expect("begin plan");
    tool_plan_write(
        &session_id,
        &turn_id,
        &json!({ "markdownDelta": "# Plan\n\n- Keep this draft\n" }),
    )
    .expect("write plan");
    let repeated = tool_plan_begin(
        &session_id,
        &turn_id,
        &json!({ "title": "Replacement plan" }),
    )
    .expect("repeat begin");

    assert_eq!(repeated.raw["planId"], first.raw["planId"]);
    assert_eq!(repeated.raw["markdown"], "# Plan\n\n- Keep this draft\n");
    let state = state().lock().expect("state lock");
    let plan = &state.sessions.get(&session_id).expect("session").snapshot["plan"];
    assert_eq!(plan["title"], "Original plan");
    assert_eq!(plan["markdown"], "# Plan\n\n- Keep this draft\n");
}

#[test]
fn todo_write_after_plan_approval_creates_project_todo_and_executes_phase() {
    let project = tempfile::tempdir().expect("project tempdir");
    let plan_id = format!("plan-{}", Uuid::new_v4());
    let version_id = format!("plan-version-{}", Uuid::new_v4());
    let mut session = new_session(
        Some("Project Todo Test".to_string()),
        Some(project.path().display().to_string()),
        "normal",
    );
    let session_id = session.id.clone();
    session.snapshot["plan"] = json!({
        "activePlanId": plan_id,
        "activeVersionId": version_id,
        "projectKey": project_key_for_working_dir(&project.path().display().to_string()).expect("project key"),
        "title": "Approved plan",
        "phase": PLAN_PHASE_TODO_REQUIRED,
        "markdown": "# Plan\n\n- Build runtime support\n",
        "annotations": [],
        "review": { "status": "approved", "summary": "Approved" }
    });
    {
        let mut state = state().lock().expect("state lock");
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
    }
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = session_runtime::cancellation_token(&turn_id).expect("active cancellation");

    let output = execute_model_tool_with_runtime_sync(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ToolExecutionRuntime::default(),
        ModelToolCall {
            id: "tool-todo-write".to_string(),
            name: TODO_WRITE_MODEL_TOOL.to_string(),
            arguments: json!({
                "todos": [
                    { "id": "runtime", "content": "Implement runtime support", "status": "in_progress" },
                    { "id": "ui", "content": "Implement UI support", "status": "pending" }
                ]
            }),
        },
    );

    assert_eq!(
        output["raw"]["projectTodo"]["status"]
            .as_str()
            .expect("project todo status"),
        "running"
    );
    assert_eq!(
        output["raw"]["projectTodo"]["todos"]
            .as_array()
            .expect("project todo items")
            .len(),
        2
    );
    let state = state().lock().expect("state lock");
    let session = state.sessions.get(&session_id).expect("session");
    assert_eq!(session.snapshot["plan"]["phase"], PLAN_PHASE_EXECUTING_TODO);
    assert_eq!(session.snapshot["projectTodo"]["currentIndex"], 0);
}

#[test]
fn todo_write_during_plan_draft_updates_session_todos_without_project_todo() {
    let project = tempfile::tempdir().expect("project tempdir");
    let mut session = new_session(
        Some("Draft Todo Guard Test".to_string()),
        Some(project.path().display().to_string()),
        "normal",
    );
    let session_id = session.id.clone();
    session.snapshot["plan"] = json!({
        "activePlanId": format!("plan-{}", Uuid::new_v4()),
        "activeVersionId": format!("plan-version-{}", Uuid::new_v4()),
        "title": "Draft plan",
        "phase": PLAN_PHASE_PLANNING,
        "markdown": "# Draft",
    });
    session.snapshot["todos"] = json!([
        { "id": "existing", "content": "Keep existing todo", "status": "pending" }
    ]);
    session.snapshot["projectTodo"] = Value::Null;
    {
        let mut state = state().lock().expect("state lock");
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
    }
    let turn_id = start_test_runtime_turn(&session_id);

    tool_todo_write(
        &session_id,
        &turn_id,
        &json!({
            "todos": [
                { "id": "new", "content": "Draft checklist", "status": "in_progress" }
            ]
        }),
    )
    .expect("session todos can be written while the plan is still a draft");

    let state = state().lock().expect("state lock");
    let session = state.sessions.get(&session_id).expect("session");
    assert_eq!(session.snapshot["todos"][0]["id"], "new");
    assert!(session.snapshot["projectTodo"].is_null());
    assert_eq!(session.snapshot["plan"]["phase"], PLAN_PHASE_PLANNING);
}

#[test]
fn todo_write_rejects_empty_project_todo_list() {
    let project = tempfile::tempdir().expect("project tempdir");
    let plan_id = format!("plan-{}", Uuid::new_v4());
    let version_id = format!("plan-version-{}", Uuid::new_v4());
    let mut session = new_session(
        Some("Empty Project Todo Test".to_string()),
        Some(project.path().display().to_string()),
        "normal",
    );
    let session_id = session.id.clone();
    session.snapshot["plan"] = json!({
        "activePlanId": plan_id,
        "activeVersionId": version_id,
        "projectKey": project_key_for_working_dir(&project.path().display().to_string()).expect("project key"),
        "title": "Approved plan",
        "phase": PLAN_PHASE_TODO_REQUIRED,
        "markdown": "# Plan\n\n- Build runtime support\n",
        "annotations": [],
        "review": { "status": "approved", "summary": "Approved" }
    });
    {
        let mut state = state().lock().expect("state lock");
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
    }
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = session_runtime::cancellation_token(&turn_id).expect("active cancellation");

    let output = execute_model_tool_with_runtime_sync(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ToolExecutionRuntime::default(),
        ModelToolCall {
            id: "tool-empty-todo-write".to_string(),
            name: TODO_WRITE_MODEL_TOOL.to_string(),
            arguments: json!({
                "todos": []
            }),
        },
    );

    assert_eq!(output["error"]["code"], "empty_todo_list");
}

#[test]
fn todo_update_and_finish_update_project_todo() {
    let project = tempfile::tempdir().expect("project tempdir");
    let mut session = new_session(
        Some("Project Todo Update Test".to_string()),
        Some(project.path().display().to_string()),
        "normal",
    );
    let session_id = session.id.clone();
    session.snapshot["plan"] = json!({
        "activePlanId": format!("plan-{}", Uuid::new_v4()),
        "activeVersionId": format!("plan-version-{}", Uuid::new_v4()),
        "projectKey": project_key_for_working_dir(&project.path().display().to_string()).expect("project key"),
        "title": "Executing plan",
        "phase": PLAN_PHASE_EXECUTING_TODO,
        "markdown": "# Plan\n\n- Build runtime support\n",
        "annotations": [],
        "review": { "status": "approved", "summary": "Approved" }
    });
    session.snapshot["projectTodo"] = json!({
        "todoListId": format!("todo-list-{}", Uuid::new_v4()),
        "planId": session.snapshot["plan"]["activePlanId"].clone(),
        "versionId": session.snapshot["plan"]["activeVersionId"].clone(),
        "status": "running",
        "currentIndex": 0,
        "todos": [
            { "id": "runtime", "content": "Implement runtime support", "status": "in_progress", "priority": "normal", "blockedBy": [] },
            { "id": "ui", "content": "Implement UI support", "status": "pending", "priority": "normal", "blockedBy": [] }
        ],
        "summary": Value::Null
    });
    session.snapshot["todos"] = session.snapshot["projectTodo"]["todos"].clone();
    {
        let mut state = state().lock().expect("state lock");
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
    }
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = session_runtime::cancellation_token(&turn_id).expect("active cancellation");
    record_test_investigation(&session_id, &turn_id, "runtime-evidence");
    record_test_investigation(&session_id, &turn_id, "ui-evidence");

    let missing_update_status = tool_todo_update(
        &session_id,
        &turn_id,
        &json!({ "id": "runtime", "summary": "No status" }),
    )
    .expect_err("todo_update requires status");
    assert_eq!(missing_update_status.code, "bad_request");
    let invalid_update_status = tool_todo_update(
        &session_id,
        &turn_id,
        &json!({ "id": "runtime", "status": "finished" }),
    )
    .expect_err("todo_update rejects unsupported status");
    assert_eq!(invalid_update_status.code, "bad_request");
    let missing_finish_summary =
        tool_todo_finish(&session_id, &turn_id, &json!({ "status": "failed" }))
            .expect_err("todo_finish requires summary");
    assert_eq!(missing_finish_summary.code, "bad_request");
    let invalid_finish_status = tool_todo_finish(
        &session_id,
        &turn_id,
        &json!({ "status": "done", "summary": "Done" }),
    )
    .expect_err("todo_finish rejects unsupported status");
    assert_eq!(invalid_finish_status.code, "bad_request");

    let completed_without_evidence = execute_model_tool_with_runtime_sync(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ToolExecutionRuntime::default(),
        ModelToolCall {
            id: "tool-todo-update-without-evidence".to_string(),
            name: TODO_WRITE_MODEL_TOOL.to_string(),
            arguments: json!({
                "action": "update",
                "id": "runtime",
                "status": "completed",
                "summary": "Runtime done"
            }),
        },
    );
    assert_eq!(
        completed_without_evidence["raw"]["projectTodo"]["todos"][0]["status"],
        "completed"
    );
    {
        let state = state().lock().expect("state lock");
        let session = state.sessions.get(&session_id).expect("session");
        assert_eq!(
            session.snapshot["projectTodo"]["todos"][0]["status"],
            "completed"
        );
    }

    let updated = execute_model_tool_with_runtime_sync(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ToolExecutionRuntime::default(),
        ModelToolCall {
            id: "tool-todo-update".to_string(),
            name: TODO_UPDATE_MODEL_TOOL.to_string(),
            arguments: json!({
                "id": "runtime",
                "status": "completed",
                "summary": "Runtime done",
                "content": "This should not mutate todo content.",
                "evidence": "cargo test passed",
                "evidenceIds": ["runtime-evidence"]
            }),
        },
    );
    assert_eq!(updated["raw"]["projectTodo"]["currentIndex"], 1);
    assert_eq!(
        updated["raw"]["projectTodo"]["todos"][0]["content"],
        "Implement runtime support"
    );
    assert_eq!(
        updated["raw"]["projectTodo"]["todos"][0]["note"],
        "Runtime done"
    );
    assert_eq!(
        updated["raw"]["projectTodo"]["todos"][0]["evidence"],
        "cargo test passed"
    );

    let premature = execute_model_tool_with_runtime_sync(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ToolExecutionRuntime::default(),
        ModelToolCall {
            id: "tool-todo-finish".to_string(),
            name: TODO_FINISH_MODEL_TOOL.to_string(),
            arguments: json!({
                "status": "completed",
                "summary": "All planned work is complete"
            }),
        },
    );
    assert_eq!(premature["raw"]["projectTodo"]["status"], "completed");
    assert_eq!(premature["raw"]["todos"][1]["status"], "skipped");
    assert_eq!(
        premature["raw"]["todos"][1]["failureReason"],
        "Auto-skipped when the Goal was marked completed via todo_finish."
    );

    let ui_completed = execute_model_tool_with_runtime_sync(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ToolExecutionRuntime::default(),
        ModelToolCall {
            id: "tool-todo-update-ui".to_string(),
            name: TODO_UPDATE_MODEL_TOOL.to_string(),
            arguments: json!({
                "id": "ui",
                "status": "completed",
                "summary": "UI done",
                "evidence": "targeted UI test passed",
                "evidenceIds": ["ui-evidence"]
            }),
        },
    );
    assert_eq!(ui_completed["raw"]["projectTodo"]["status"], "running");
    {
        let state = state().lock().expect("state lock");
        let session = state.sessions.get(&session_id).expect("session");
        assert_eq!(session.snapshot["plan"]["phase"], PLAN_PHASE_EXECUTING_TODO);
    }
    assert_eq!(
        validate_final_response_for_session(&session_id, &turn_id)
            .expect("a stage-ending response may hand work to Goal continuation"),
        ()
    );

    let finished = execute_model_tool_with_runtime_sync(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ToolExecutionRuntime::default(),
        ModelToolCall {
            id: "tool-todo-finish-after-evidence".to_string(),
            name: TODO_WRITE_MODEL_TOOL.to_string(),
            arguments: json!({
                "action": "finish",
                "status": "completed",
                "summary": "All planned work is complete"
            }),
        },
    );
    assert_eq!(finished["raw"]["projectTodo"]["status"], "completed");
    {
        let state = state().lock().expect("state lock");
        let session = state.sessions.get(&session_id).expect("session");
        assert_eq!(session.snapshot["plan"]["phase"], PLAN_PHASE_EXECUTING_TODO);
    }
    validate_final_response_for_session(&session_id, &turn_id)
        .expect("independent completion gate");
    let state = state().lock().expect("state lock");
    let session = state.sessions.get(&session_id).expect("session");
    assert_eq!(session.snapshot["plan"]["phase"], PLAN_PHASE_COMPLETED);
    assert!(
        session
            .runtime_turns
            .iter()
            .find(|turn| turn.get("runtimeTurnId").and_then(Value::as_str) == Some(&turn_id))
            .and_then(|turn| turn.get("completionAuditRef"))
            .is_some_and(Value::is_string)
    );
}

#[test]
fn completion_gate_does_not_commit_session_when_project_plan_persistence_fails() {
    let project = tempfile::tempdir().expect("project tempdir");
    let working_dir = project.path().display().to_string();
    let project_key = project_key_for_working_dir(&working_dir).expect("project key");
    let mut session = new_session(
        Some("Completion Persistence Failure".to_string()),
        Some(working_dir),
        "normal",
    );
    let session_id = session.id.clone();
    session.snapshot["plan"] = json!({
        "activePlanId": format!("plan-{}", Uuid::new_v4()),
        "activeVersionId": format!("plan-version-{}", Uuid::new_v4()),
        "projectKey": project_key,
        "title": "Persist completion",
        "phase": PLAN_PHASE_EXECUTING_TODO,
        "markdown": "# Plan\n\n- Persist completion\n",
        "annotations": [],
        "review": { "status": "approved", "summary": "Approved" }
    });
    session.snapshot["projectTodo"] = json!({
        "todoListId": format!("todo-list-{}", Uuid::new_v4()),
        "planId": session.snapshot["plan"]["activePlanId"].clone(),
        "versionId": session.snapshot["plan"]["activeVersionId"].clone(),
        "status": "completed",
        "currentIndex": 1,
        "todos": [
            { "id": "persist", "content": "Persist completion", "status": "completed" }
        ],
        "summary": "Done"
    });
    session.snapshot["todos"] = session.snapshot["projectTodo"]["todos"].clone();
    let root = {
        let mut state = state().lock().expect("state lock");
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
        state.root.clone()
    };
    let turn_id = start_test_runtime_turn(&session_id);
    let project_store_parent = root.join("projects").join(
        project_key_for_working_dir(&project.path().display().to_string()).expect("project key"),
    );
    fs::create_dir_all(project_store_parent.parent().expect("projects directory"))
        .expect("create projects directory");
    fs::write(&project_store_parent, b"not a directory").expect("block project plan store");

    let error = validate_final_response_for_session(&session_id, &turn_id)
        .expect_err("project plan persistence should fail");
    assert_eq!(error.code, "completion_audit_store_failed");
    {
        let state = state().lock().expect("state lock");
        let session = state.sessions.get(&session_id).expect("session");
        assert_eq!(session.snapshot["plan"]["phase"], PLAN_PHASE_EXECUTING_TODO);
        assert!(session.snapshot.get("completionAudit").is_none());
        assert!(
            session
                .runtime_turns
                .iter()
                .find(|turn| turn.get("runtimeTurnId").and_then(Value::as_str) == Some(&turn_id))
                .and_then(|turn| turn.get("completionAuditRef"))
                .is_none_or(Value::is_null)
        );
    }

    fs::remove_file(&project_store_parent).expect("remove project store blocker");
    validate_final_response_for_session(&session_id, &turn_id)
        .expect("completion should succeed after persistence recovers");
    let state = state().lock().expect("state lock");
    assert_eq!(
        state.sessions[&session_id].snapshot["plan"]["phase"],
        PLAN_PHASE_COMPLETED
    );
}

#[test]
fn session_read_falls_back_to_disk_when_state_lock_is_busy() {
    let mut session = new_session(
        Some(format!("Lock Busy Read {}", Uuid::new_v4())),
        None,
        "normal",
    );
    let session_id = session.id.clone();
    let expected_title = session
        .snapshot
        .get("title")
        .and_then(Value::as_str)
        .expect("title")
        .to_string();

    let read = {
        let mut state = state().lock().expect("state lock");
        state.active_session_id = Some(session_id.clone());
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
        read_session(json!({ "sessionId": session_id.clone() })).expect("read session")
    };

    assert_eq!(read["id"], session_id);
    assert_eq!(read["title"], expected_title);
}

#[test]
fn list_sessions_falls_back_to_disk_when_state_lock_is_busy() {
    let (session_id, listed) = {
        let mut state = state().lock().expect("state lock");
        let mut session = new_session(
            Some(format!("Lock Busy List {}", Uuid::new_v4())),
            None,
            "normal",
        );
        let session_id = session.id.clone();
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
        let listed = list_sessions(json!({ "limit": 500 })).expect("list sessions");
        (session_id, listed)
    };

    assert!(
        listed["sessions"]
            .as_array()
            .expect("sessions")
            .iter()
            .any(|entry| entry["id"] == session_id),
        "disk fallback should include the persisted session"
    );
}

#[test]
fn list_session_summaries_from_meta_hides_subagents() {
    let temp = tempfile::tempdir().expect("tempdir");
    let mut parent = new_session(Some("Lead".to_string()), None, "normal");
    let parent_id = parent.id.clone();
    parent.snapshot["messages"] = json!([
        { "role": "user", "text": "hello" },
        { "role": "assistant", "text": "world" }
    ]);
    let mut child = new_session(Some("Hire".to_string()), None, SUBAGENT_SESSION_KIND);
    child.snapshot["parentSessionId"] = json!(parent_id);
    save_session(temp.path(), &parent).expect("save parent");
    save_session(temp.path(), &child).expect("save child");
    let listed = list_session_summaries_from_meta(temp.path());
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0]["id"], parent_id);
    assert_eq!(listed[0]["title"], "Lead");
    assert_eq!(listed[0]["messageCount"], 2);
}

#[test]
fn list_models_falls_back_to_state_file_when_state_lock_is_busy() {
    let provider_id = format!("test-local-{}", Uuid::new_v4());
    let model_id = format!("test-model-{}", Uuid::new_v4());
    let catalog = {
        let mut state = state().lock().expect("state lock");
        let original_config = state.config.clone();
        state.config.default_provider = Some(provider_id.clone());
        state.config.default_model = Some(model_id.clone());
        state.config.providers.insert(
            provider_id.clone(),
            NativeProviderProfile {
                id: provider_id.clone(),
                label: "Test Local".to_string(),
                route_id: providers::routes::local_openai_compatible::ROUTE_ID.to_string(),
                base_url: Some("http://127.0.0.1:8765/v1".to_string()),
                default_model: Some(model_id.clone()),
                api_key_ref: None,
                api_key: None,
                api_key_env: None,
                auth_header: None,
                embedding_model: Some("lyra-hash-embedding-v1".to_string()),
                models: vec![NativeProviderModel {
                    id: model_id.clone(),
                    label: Some("Test Model".to_string()),
                    context_window: Some(8_192),
                    supports_image_input: false,
                    supports_tool_calling: true,
                    supports_streaming: true,
                    supports_reasoning_effort: None,
                    reasoning_replay_field: ReasoningReplayField::Auto,
                    requires_reasoning_field_on_assistant_messages: None,
                    supports_tool_choice: None,
                    enabled: true,
                    api_npm: None,
                }],
            },
        );
        state.save_state().expect("save test config");
        let catalog = list_models(json!({ "sessionId": "test-session" })).expect("list models");
        state.config = original_config;
        state.save_state().expect("restore config");
        catalog
    };

    assert!(
        catalog["models"]
            .as_array()
            .expect("models")
            .iter()
            .any(|entry| {
                entry["provider"] == provider_id
                    && entry["model"] == model_id
                    && entry["selected"] == true
            }),
        "state-file fallback should preserve configured models"
    );
}

#[test]
fn cancel_turn_signals_session_runtime_when_state_lock_is_busy() {
    let session_id = format!("session-lock-busy-{}", Uuid::new_v4());
    let turn_id = format!("turn-lock-busy-{}", Uuid::new_v4());
    let cancellation = CancellationToken::new();
    crate::native_backend::session_runtime::register_active_turn(
        &session_id,
        &turn_id,
        cancellation.clone(),
    );

    let response = {
        let _state = state().lock().expect("state lock");
        cancel_turn(json!({ "sessionId": session_id.clone() })).expect("cancel turn")
    };
    let cancellation_requested = cancellation.is_cancelled();
    crate::native_backend::session_runtime::clear_active_turn(&session_id, &turn_id);

    assert_eq!(response["sessionId"], session_id);
    assert_eq!(response["status"], "cancelling");
    assert_eq!(response["deferred"], true);
    assert!(cancellation_requested);
}

#[test]
fn native_file_write_activity_uses_filesystem_edit_manifest() {
    let activity = tool_activity(
        "tool-file-write",
        "file",
        "Wrote file",
        "completed",
        json!({ "action": "write", "path": "index.html" }),
        Some(json!({
            "content": "Wrote index.html",
            "raw": {
                "changedFiles": [{
                    "path": "index.html",
                    "operation": "write",
                    "additions": 1,
                    "deletions": 0
                }],
                "diff": "--- index.html\n+++ index.html\n@@ -0,0 +1 @@\n+hello\n"
            }
        })),
        "2026-06-05T00:00:00.000Z",
        Some("2026-06-05T00:00:00.010Z".to_string()),
    );

    assert_eq!(activity["domain"].as_str(), Some("filesystem"));
    assert_eq!(
        activity["toolPath"].as_str(),
        Some("/tools/filesystem/write_file")
    );
    assert_eq!(activity["activityKind"].as_str(), Some("edit"));
    assert_eq!(activity["rendererHint"].as_str(), Some("edit"));
    assert_eq!(
        activity.pointer("/changes/0/path").and_then(Value::as_str),
        Some("index.html")
    );
    assert_eq!(
        activity
            .pointer("/changes/0/operation")
            .and_then(Value::as_str),
        Some("write")
    );
    assert_eq!(
        activity
            .pointer("/changes/0/detail/additions")
            .and_then(Value::as_u64),
        Some(1)
    );
}

#[test]
fn tool_activity_projects_trace_records_for_rebuild() {
    let activity = tool_activity(
        "tool-1",
        "git",
        "Git status",
        "completed",
        json!({
            "toolPath": "/tools/git/status",
            "operation": "status"
        }),
        Some(json!({
            "content": "clean",
            "toolPath": "/tools/git/status",
            "traceId": "trace-1",
            "trace": [{
                "schemaVersion": 1,
                "traceId": "trace-1",
                "phase": "completed",
                "status": "ok"
            }]
        })),
        "2026-06-05T00:00:00.000Z",
        Some("2026-06-05T00:00:00.010Z".to_string()),
    );
    assert_eq!(activity["traceId"], "trace-1");
    assert_eq!(
        activity.pointer("/trace/0/phase").and_then(Value::as_str),
        Some("completed")
    );
}

#[test]
fn tool_activity_persists_tool_record_with_message_block() {
    let mut session = new_session(
        Some(format!("Tool Persist {}", Uuid::new_v4())),
        None,
        "normal",
    );
    let session_id = session.id.clone();
    let turn_id = format!("turn-tool-persist-{}", Uuid::new_v4());
    let message_id = format!("message-tool-persist-{}", Uuid::new_v4());
    session.snapshot["turnStatus"] = Value::String("running".to_string());
    session.snapshot["activeTurnId"] = Value::String(turn_id.clone());
    session.snapshot["follow"] = json!({ "running": true, "activity": "waiting_for_tool" });
    session.runtime_turns.push(runtime_turn(
        &turn_id,
        &session_id,
        "waiting_for_tool",
        None,
        None,
    ));
    push_array(
        &mut session.snapshot,
        "messages",
        assistant_message_with_id(message_id.clone(), "Running tool".to_string()),
    );

    let root = {
        let mut state = state().lock().expect("state lock");
        let root = state.root.clone();
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
        root
    };
    crate::native_backend::turns::set_active_ui_message_id(&session_id, &turn_id, &message_id);

    record_tool_activity(
        &session_id,
        &turn_id,
        tool_activity(
            "call-persisted-tool",
            "shell",
            "Ran shell command",
            "running",
            json!({
                "toolOperation": {
                    "runtimeTurnId": turn_id,
                },
            }),
            None,
            &now(),
            None,
        ),
        "toolStarted",
    );

    let persisted = load_session(&root, &session_id)
        .expect("load session")
        .expect("persisted session");
    let tools = persisted
        .snapshot
        .get("tools")
        .and_then(Value::as_array)
        .expect("tools");
    assert!(tools.iter().any(|tool| {
        tool.get("id").and_then(Value::as_str) == Some("call-persisted-tool")
            && tool.get("status").and_then(Value::as_str) == Some("running")
    }));
    let message = persisted
        .snapshot
        .get("messages")
        .and_then(Value::as_array)
        .and_then(|messages| {
            messages.iter().find(|message| {
                message.get("id").and_then(Value::as_str) == Some(message_id.as_str())
            })
        })
        .expect("message");
    assert!(message
        .get("blocks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .any(|block| block.get("toolId").and_then(Value::as_str) == Some("call-persisted-tool")));

    crate::native_backend::turns::clear_active_ui_message_id(&session_id, &turn_id);
}

#[test]
fn tool_progress_does_not_reanchor_existing_tool_block_to_later_message() {
    let mut session = new_session(
        Some(format!("Tool Stable Anchor {}", Uuid::new_v4())),
        None,
        "normal",
    );
    let session_id = session.id.clone();
    let turn_id = format!("turn-tool-anchor-{}", Uuid::new_v4());
    let first_message_id = format!("message-tool-anchor-first-{}", Uuid::new_v4());
    let second_message_id = format!("message-tool-anchor-second-{}", Uuid::new_v4());
    session.snapshot["turnStatus"] = Value::String("running".to_string());
    session.snapshot["activeTurnId"] = Value::String(turn_id.clone());
    session.snapshot["follow"] = json!({ "running": true, "activity": "waiting_for_tool" });
    session.runtime_turns.push(runtime_turn(
        &turn_id,
        &session_id,
        "waiting_for_tool",
        None,
        None,
    ));
    push_array(
        &mut session.snapshot,
        "messages",
        assistant_message_with_id(first_message_id.clone(), "Preparing file.".to_string()),
    );

    let root = {
        let mut state = state().lock().expect("state lock");
        let root = state.root.clone();
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
        root
    };
    crate::native_backend::turns::set_active_ui_message_id(
        &session_id,
        &turn_id,
        &first_message_id,
    );

    record_tool_activity(
        &session_id,
        &turn_id,
        tool_activity(
            "call-stable-anchor-tool",
            "write_file",
            "Write file",
            "running",
            json!({ "path": "index.html" }),
            Some(json!({
                "raw": {
                    "diff": "--- index.html\n+++ index.html\n@@ -0,0 +1 @@\n+<html>",
                    "preview": true
                }
            })),
            &now(),
            None,
        ),
        "toolStarted",
    );
    record_tool_activity(
        &session_id,
        &turn_id,
        tool_activity(
            "call-stable-anchor-tool",
            "write_file",
            "Write file",
            "running",
            json!({ "path": "index.html" }),
            None,
            &now(),
            None,
        ),
        "toolStarted",
    );
    // Progress/tool-start frames stay in memory by design (durable saves happen
    // at tool boundaries), so observe them through the live state snapshot.
    let after_duplicate_start = load_session(&root, &session_id)
        .expect("load session after duplicate start")
        .expect("persisted session after duplicate start");
    let preview_tool = after_duplicate_start
        .snapshot
        .get("tools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|tool| tool.get("id").and_then(Value::as_str) == Some("call-stable-anchor-tool"))
        .expect("preview tool");
    assert!(
        preview_tool
            .pointer("/output/raw/diff")
            .and_then(Value::as_str)
            .is_some_and(|diff| diff.contains("+<html>"))
    );

    {
        let mut state = state().lock().expect("state lock");
        let session = state.sessions.get_mut(&session_id).expect("session");
        push_array(
            &mut session.snapshot,
            "messages",
            assistant_message_with_id(
                second_message_id.clone(),
                "Directory is empty, creating the file.".to_string(),
            ),
        );
        session.dirty = true;
        state.save_state().expect("save state");
    }
    crate::native_backend::turns::set_active_ui_message_id(
        &session_id,
        &turn_id,
        &second_message_id,
    );

    record_tool_progress(
        &session_id,
        &turn_id,
        tool_activity(
            "call-stable-anchor-tool",
            "write_file",
            "Write file",
            "running",
            json!({ "path": "index.html" }),
            Some(json!({
                "raw": {
                    "diff": "--- index.html\n+++ index.html\n@@ -0,0 +1,2 @@\n+<html>\n+<body>",
                    "preview": true
                }
            })),
            &now(),
            None,
        ),
    );

    let persisted = load_session(&root, &session_id)
        .expect("load session")
        .expect("persisted session");
    let messages = persisted
        .snapshot
        .get("messages")
        .and_then(Value::as_array)
        .expect("messages");
    let first_message = messages
        .iter()
        .find(|message| {
            message.get("id").and_then(Value::as_str) == Some(first_message_id.as_str())
        })
        .expect("first message");
    let second_message = messages
        .iter()
        .find(|message| {
            message.get("id").and_then(Value::as_str) == Some(second_message_id.as_str())
        })
        .expect("second message");
    let first_tool_count = first_message
        .get("blocks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|block| {
            block.get("toolId").and_then(Value::as_str) == Some("call-stable-anchor-tool")
        })
        .count();
    let second_tool_count = second_message
        .get("blocks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|block| {
            block.get("toolId").and_then(Value::as_str) == Some("call-stable-anchor-tool")
        })
        .count();
    assert_eq!(first_tool_count, 1);
    assert_eq!(second_tool_count, 0);
    // Progress frames are transient (never persisted), so read the latest tool
    // output from the live in-memory state instead of the on-disk session.
    let tool = {
        let state = state().lock().expect("state lock");
        state
            .sessions
            .get(&session_id)
            .expect("live session")
            .snapshot
            .get("tools")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .find(|tool| tool.get("id").and_then(Value::as_str) == Some("call-stable-anchor-tool"))
            .expect("live tool")
            .clone()
    };
    assert!(
        tool.pointer("/output/raw/diff")
            .and_then(Value::as_str)
            .is_some_and(|diff| diff.contains("+<body>"))
    );

    crate::native_backend::turns::clear_active_ui_message_id(&session_id, &turn_id);
}

#[test]
fn running_tool_without_active_anchor_reuses_message_for_later_assistant_text() {
    let mut session = new_session(
        Some(format!("Tool Anchor Before Text {}", Uuid::new_v4())),
        None,
        "normal",
    );
    let session_id = session.id.clone();
    let turn_id = format!("turn-tool-before-text-{}", Uuid::new_v4());
    session.snapshot["turnStatus"] = Value::String("running".to_string());
    session.snapshot["activeTurnId"] = Value::String(turn_id.clone());
    session.snapshot["follow"] = json!({ "running": true, "activity": "waiting_for_tool" });
    session.runtime_turns.push(runtime_turn(
        &turn_id,
        &session_id,
        "waiting_for_tool",
        None,
        None,
    ));

    let root = {
        let mut state = state().lock().expect("state lock");
        let root = state.root.clone();
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
        root
    };

    record_tool_activity(
        &session_id,
        &turn_id,
        tool_activity(
            "call-before-text-tool",
            "write_file",
            "Write file",
            "running",
            json!({ "path": "index.html" }),
            Some(json!({
                "raw": {
                    "diff": "--- index.html\n+++ index.html\n@@ -0,0 +1 @@\n+<html>",
                    "preview": true
                }
            })),
            &now(),
            None,
        ),
        "toolStarted",
    );

    let mut reply = ModelReply {
        content: Some("开始写代码。".to_string()),
        reasoning_content: None,
        tool_calls: vec![ModelToolCall {
            id: "call-before-text-tool".to_string(),
            name: "write_file".to_string(),
            arguments: json!({ "path": "index.html" }),
        }],
        ui_message_id: None,
        raw_stop_reason: None,
        provider_replay_protocol: None,
        provider_replay_items: Vec::new(),
        response_meta: Default::default(),
        stop_signal: TurnStopSignal::ToolUse,
    };
    assert!(
        crate::native_backend::turns::commit_visible_assistant_reply(
            &session_id,
            &turn_id,
            &mut reply,
            &None,
        )
    );

    let persisted = load_session(&root, &session_id)
        .expect("load session")
        .expect("persisted session");
    let messages = persisted
        .snapshot
        .get("messages")
        .and_then(Value::as_array)
        .expect("messages");
    assert_eq!(messages.len(), 1);
    let blocks = messages[0]
        .get("blocks")
        .and_then(Value::as_array)
        .expect("blocks");
    assert_eq!(blocks[0].get("type").and_then(Value::as_str), Some("text"));
    assert_eq!(
        blocks[0].get("text").and_then(Value::as_str),
        Some("开始写代码。")
    );
    assert_eq!(blocks[1].get("type").and_then(Value::as_str), Some("tool"));
    assert_eq!(
        blocks[1].get("toolId").and_then(Value::as_str),
        Some("call-before-text-tool")
    );
    assert_eq!(
        reply.ui_message_id.as_deref(),
        messages[0].get("id").and_then(Value::as_str)
    );

    crate::native_backend::turns::clear_active_ui_message_id(&session_id, &turn_id);
}

#[test]
fn commit_marks_streamed_reasoning_done_for_tool_call_only_reply() {
    // Providers that stream thinking deltas return reasoning_content: None at
    // commit time. A tool-call-only reply (no visible text) must still flip the
    // streamed reasoning from "thinking" to "done" — this used to stick forever.
    let mut session = new_session(
        Some(format!("Reasoning Done {}", Uuid::new_v4())),
        None,
        "normal",
    );
    let session_id = session.id.clone();
    let turn_id = format!("turn-reasoning-done-{}", Uuid::new_v4());
    let message_id = format!("message-reasoning-{}", Uuid::new_v4());
    session.snapshot["turnStatus"] = Value::String("running".to_string());
    session.snapshot["activeTurnId"] = Value::String(turn_id.clone());
    session.snapshot["follow"] = json!({ "running": true, "activity": "calling_model" });
    session.runtime_turns.push(runtime_turn(
        &turn_id,
        &session_id,
        "calling_model",
        None,
        None,
    ));
    let mut message = assistant_message_with_id(message_id.clone(), String::new());
    message["reasoningContent"] = json!("先想清楚页面布局。");
    message["reasoningStatus"] = json!("thinking");
    message["blocks"] = json!([
        { "type": "thinking", "id": "thinking-0", "text": "先想清楚页面布局。", "status": "thinking" }
    ]);
    push_array(&mut session.snapshot, "messages", message);
    {
        let mut state = state().lock().expect("state lock");
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
    }
    crate::native_backend::turns::set_active_ui_message_id(&session_id, &turn_id, &message_id);

    let mut reply = ModelReply {
        content: None,
        reasoning_content: None,
        tool_calls: vec![ModelToolCall {
            id: "call-reasoning-done-tool".to_string(),
            name: "write_file".to_string(),
            arguments: json!({ "path": "index.html" }),
        }],
        ui_message_id: None,
        raw_stop_reason: None,
        provider_replay_protocol: None,
        provider_replay_items: Vec::new(),
        response_meta: Default::default(),
        stop_signal: TurnStopSignal::ToolUse,
    };
    assert!(
        crate::native_backend::turns::commit_visible_assistant_reply(
            &session_id,
            &turn_id,
            &mut reply,
            &Some(message_id.clone()),
        )
    );

    let state = state().lock().expect("state lock");
    let session = state.sessions.get(&session_id).expect("session");
    let message = session
        .snapshot
        .get("messages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|message| message.get("id").and_then(Value::as_str) == Some(message_id.as_str()))
        .expect("assistant message");
    assert_eq!(
        message.get("reasoningStatus").and_then(Value::as_str),
        Some("done")
    );
    let thinking_status = message
        .get("blocks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|block| block.get("type").and_then(Value::as_str) == Some("thinking"))
        .and_then(|block| block.get("status").and_then(Value::as_str));
    assert_eq!(thinking_status, Some("done"));
    drop(state);

    crate::native_backend::turns::clear_active_ui_message_id(&session_id, &turn_id);
}

#[test]
fn running_tool_after_cleared_anchor_starts_a_new_message() {
    let mut session = new_session(
        Some(format!("Tool New Anchor {}", Uuid::new_v4())),
        None,
        "normal",
    );
    let session_id = session.id.clone();
    let turn_id = format!("turn-tool-new-anchor-{}", Uuid::new_v4());
    let previous_message_id = format!("message-tool-previous-{}", Uuid::new_v4());
    session.snapshot["turnStatus"] = Value::String("running".to_string());
    session.snapshot["activeTurnId"] = Value::String(turn_id.clone());
    session.snapshot["follow"] = json!({ "running": true, "activity": "waiting_for_tool" });
    session.runtime_turns.push(runtime_turn(
        &turn_id,
        &session_id,
        "waiting_for_tool",
        None,
        None,
    ));
    let mut previous_message =
        assistant_message_with_id(previous_message_id.clone(), "上一轮。".to_string());
    previous_message["blocks"] = json!([
        { "type": "text", "id": "text-0", "text": "上一轮。" },
        { "type": "tool", "id": "tool-previous-tool", "toolId": "previous-tool" }
    ]);
    push_array(&mut session.snapshot, "messages", previous_message);

    let root = {
        let mut state = state().lock().expect("state lock");
        let root = state.root.clone();
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
        root
    };
    crate::native_backend::turns::clear_active_ui_message_id(&session_id, &turn_id);

    record_tool_activity(
        &session_id,
        &turn_id,
        tool_activity(
            "new-tool",
            "write_file",
            "Write file",
            "running",
            json!({ "path": "next.html" }),
            Some(json!({
                "raw": {
                    "diff": "--- next.html\n+++ next.html\n@@ -0,0 +1 @@\n+<html>",
                    "preview": true
                }
            })),
            &now(),
            None,
        ),
        "toolStarted",
    );

    let persisted = load_session(&root, &session_id)
        .expect("load session")
        .expect("persisted session");
    let messages = persisted
        .snapshot
        .get("messages")
        .and_then(Value::as_array)
        .expect("messages");
    assert_eq!(messages.len(), 2);
    assert!(
        messages[0]
            .get("blocks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .all(|block| block.get("toolId").and_then(Value::as_str) != Some("new-tool"))
    );
    assert!(
        messages[1]
            .get("blocks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .any(|block| block.get("toolId").and_then(Value::as_str) == Some("new-tool"))
    );

    crate::native_backend::turns::clear_active_ui_message_id(&session_id, &turn_id);
}

#[test]
fn finish_running_tools_recognizes_tool_operation_runtime_turn_id() {
    let mut session = new_session(
        Some(format!("Finish Running Tool {}", Uuid::new_v4())),
        None,
        "normal",
    );
    let turn_id = "turn-tool-operation-id";
    session.snapshot["tools"] = json!([
        {
            "id": "tool-current",
            "status": "running",
            "input": {
                "toolOperation": {
                    "runtimeTurnId": turn_id,
                },
            },
        },
        {
            "id": "tool-other",
            "status": "running",
            "input": {
                "toolOperation": {
                    "runtimeTurnId": "turn-other",
                },
            },
        },
    ]);

    finish_running_tools_for_turn(
        &mut session,
        turn_id,
        "cancelled",
        json!({ "content": "cancelled" }),
    );

    let tools = session
        .snapshot
        .get("tools")
        .and_then(Value::as_array)
        .expect("tools");
    let current = tools
        .iter()
        .find(|tool| tool.get("id").and_then(Value::as_str) == Some("tool-current"))
        .expect("current tool");
    let other = tools
        .iter()
        .find(|tool| tool.get("id").and_then(Value::as_str) == Some("tool-other"))
        .expect("other tool");
    assert_eq!(current["status"], "cancelled");
    assert_eq!(other["status"], "running");
}

#[test]
fn orphan_running_tool_reconciliation_cancels_tools_for_idle_session() {
    let mut session = new_session(Some("Recover Tool".to_string()), None, "normal");
    session.snapshot["turnStatus"] = Value::String("idle".to_string());
    session.snapshot["activeTurnId"] = Value::Null;
    session.snapshot["tools"] = json!([{
        "id": "tool-orphan",
        "status": "running",
        "input": { "turnId": "turn-finished" },
        "finishedAt": Value::Null,
        "output": Value::Null,
    }]);

    assert!(reconcile_orphan_running_tools(&mut session));
    let tool = &session.snapshot["tools"][0];
    assert_eq!(tool["status"], "cancelled");
    assert!(tool["finishedAt"].as_str().is_some());
    assert!(
        tool.pointer("/output/content")
            .and_then(Value::as_str)
            .is_some_and(|content| content.contains("no longer active"))
    );
}

#[test]
fn finish_running_tools_keeps_background_subagent_tools_open() {
    let mut session = new_session(Some("Keep Background Agent".to_string()), None, "normal");
    let turn_id = "turn-keep-agent";
    session.snapshot["tools"] = json!([
        {
            "id": "agent-live",
            "name": AGENT_SPAWN_MODEL_TOOL,
            "status": "running",
            "input": { "turnId": turn_id },
            "output": {
                "content": "正在查看目录。",
                "raw": {
                    "subagentId": "child-live",
                    "status": "running",
                    "background": true
                }
            }
        },
        {
            "id": "other-live",
            "status": "running",
            "input": { "turnId": turn_id }
        }
    ]);

    finish_running_tools_for_turn(
        &mut session,
        turn_id,
        "cancelled",
        json!({ "content": "cancelled" }),
    );

    let tools = session
        .snapshot
        .get("tools")
        .and_then(Value::as_array)
        .expect("tools");
    let agent = tools
        .iter()
        .find(|tool| tool.get("id").and_then(Value::as_str) == Some("agent-live"))
        .expect("agent tool");
    let other = tools
        .iter()
        .find(|tool| tool.get("id").and_then(Value::as_str) == Some("other-live"))
        .expect("other tool");
    assert_eq!(agent["status"], "running");
    assert_eq!(
        agent.pointer("/output/content").and_then(Value::as_str),
        Some("正在查看目录。")
    );
    assert_eq!(other["status"], "cancelled");
}

#[test]
fn orphan_running_tool_reconciliation_keeps_background_subagent_tools() {
    let mut session = new_session(Some("Keep Background Orphan".to_string()), None, "normal");
    session.snapshot["turnStatus"] = Value::String("idle".to_string());
    session.snapshot["activeTurnId"] = Value::Null;
    session.snapshot["tools"] = json!([
        {
            "id": "agent-live",
            "status": "running",
            "input": { "turnId": "turn-finished" },
            "output": {
                "raw": {
                    "subagentId": "child-live",
                    "background": true
                }
            }
        },
        {
            "id": "tool-orphan",
            "status": "running",
            "input": { "turnId": "turn-finished" }
        }
    ]);

    assert!(reconcile_orphan_running_tools(&mut session));
    let tools = session
        .snapshot
        .get("tools")
        .and_then(Value::as_array)
        .expect("tools");
    let agent = tools
        .iter()
        .find(|tool| tool.get("id").and_then(Value::as_str) == Some("agent-live"))
        .expect("agent tool");
    let orphan = tools
        .iter()
        .find(|tool| tool.get("id").and_then(Value::as_str) == Some("tool-orphan"))
        .expect("orphan tool");
    assert_eq!(agent["status"], "running");
    assert_eq!(orphan["status"], "cancelled");
}

#[test]
fn finish_running_tools_settles_tools_with_missing_turn_id() {
    let mut session = new_session(Some("Missing Turn".to_string()), None, "normal");
    let turn_id = "turn-orphan";
    session.snapshot["tools"] = json!([
        {
            "id": "tool-missing-turn",
            "status": "running",
            "input": {}
        },
        {
            "id": "tool-other-turn",
            "status": "running",
            "input": { "turnId": "turn-other" }
        }
    ]);
    finish_running_tools_for_turn(
        &mut session,
        turn_id,
        "cancelled",
        json!({ "content": "cancelled" }),
    );
    let tools = session
        .snapshot
        .get("tools")
        .and_then(Value::as_array)
        .expect("tools");
    let missing = tools
        .iter()
        .find(|tool| tool.get("id").and_then(Value::as_str) == Some("tool-missing-turn"))
        .expect("missing");
    let other = tools
        .iter()
        .find(|tool| tool.get("id").and_then(Value::as_str) == Some("tool-other-turn"))
        .expect("other");
    assert_eq!(missing["status"], "cancelled");
    assert_eq!(other["status"], "running");
}

#[test]
fn load_from_root_reaps_dead_background_parent_cards() {
    let temp = tempfile::tempdir().expect("tempdir");
    let mut parent = new_session(Some("Lead".to_string()), None, "normal");
    let mut child = new_session(Some("Hire".to_string()), None, SUBAGENT_SESSION_KIND);
    let parent_id = parent.id.clone();
    let child_id = child.id.clone();
    child.snapshot["parentSessionId"] = json!(parent_id);
    child.snapshot["subagent"] = json!({
        "type": "generalPurpose",
        "origin": "spawn",
        "parentTurnId": "turn-parent",
        "parentToolCallId": "agent-live",
        "background": true,
        "description": "survey news"
    });
    child.snapshot["turnStatus"] = json!("running");
    child.snapshot["activeTurnId"] = json!("turn-child");
    parent.snapshot["turnStatus"] = json!("idle");
    parent.snapshot["activeTurnId"] = Value::Null;
    parent.snapshot["subagents"] = json!([{
        "id": child_id,
        "description": "survey news",
        "type": "generalPurpose",
        "origin": "spawn",
        "status": "running"
    }]);
    parent.snapshot["tools"] = json!([{
        "id": "agent-live",
        "name": AGENT_SPAWN_MODEL_TOOL,
        "status": "running",
        "output": {
            "raw": {
                "subagentId": child_id,
                "background": true
            }
        }
    }]);
    save_session(temp.path(), &parent).expect("save parent");
    save_session(temp.path(), &child).expect("save child");
    let loaded = NativeRuntimeState::load_from_root(temp.path().to_path_buf());
    let parent = loaded.sessions.get(&parent_id).expect("parent");
    let child = loaded.sessions.get(&child_id).expect("child");
    assert_eq!(child.snapshot["turnStatus"], "cancelled");
    assert_eq!(parent.snapshot["tools"][0]["status"], "cancelled");
    assert_eq!(parent.snapshot["subagents"][0]["status"], "interrupted");
}

#[test]
fn shell_run_rejects_long_lived_commands_without_a_host_terminal() {
    let session = new_session(
        Some(format!("Shell Background {}", Uuid::new_v4())),
        None,
        "normal",
    );
    let error = tool_shell_run(
        &session.id,
        "turn-shell-background",
        "call-shell-background",
        &json!({
            "command": "python3 -m http.server 8888",
            "background": true,
        }),
    )
    .expect_err("long-lived shell command should not block exec_command");

    assert_eq!(error.code, "use_background_terminal");
}

#[test]
fn shell_run_rejects_detected_dev_servers_without_a_host_terminal() {
    let session = new_session(
        Some(format!("Shell Dev Server {}", Uuid::new_v4())),
        None,
        "normal",
    );
    let error = tool_shell_run(
        &session.id,
        "turn-shell-dev",
        "call-shell-dev",
        &json!({ "timeoutMs": 8000, "command": "npm run dev" }),
    )
    .expect_err("dev servers should not run in the foreground");

    assert_eq!(error.code, "use_background_terminal");
}

#[test]
fn shell_run_handoffs_long_lived_command_to_host_terminal() {
    struct ResetHost;
    impl Drop for ResetHost {
        fn drop(&mut self) {
            set_host_dispatcher(None);
        }
    }
    let _reset = ResetHost;
    set_host_dispatcher(Some(Arc::new(|method, payload| {
        assert_eq!(method, "terminal.write");
        let value: Value = serde_json::from_str(&payload).expect("payload");
        assert_eq!(value["createNew"], true);
        assert_eq!(value["text"], "npm run dev");
        assert_eq!(value["appendNewline"], true);
        Ok(json!({
            "sessionId": "agent-terminal-1",
            "output": "compiled",
            "running": true
        })
        .to_string())
    })));
    let session = new_session(
        Some(format!("Shell Handoff {}", Uuid::new_v4())),
        None,
        "normal",
    );
    let result = tool_shell_run(
        &session.id,
        "turn-shell-handoff",
        "call-shell-handoff",
        &json!({ "timeoutMs": 8000, "command": "npm run dev" }),
    )
    .expect("long-lived command should start in a background terminal");
    assert_eq!(result.raw["background"], true);
    assert_eq!(result.raw["sessionId"], "agent-terminal-1");
    assert!(result.content.contains("background terminal"));
}

#[test]
fn native_backend_titles_default_sessions_from_first_user_message() {
    let mut session = new_session(None, None, "normal");
    assert_eq!(session.snapshot["title"], serde_json::Value::Null);
    maybe_title_session_from_first_user_message(&mut session, "  帮我检查会话标题生成  ", &[]);
    assert_eq!(session.snapshot["title"], "帮我检查会话标题生成");
    push_array(
        &mut session.snapshot,
        "messages",
        user_message("帮我检查会话标题生成".to_string(), Vec::new(), now()),
    );
    maybe_title_session_from_first_user_message(&mut session, "第二条消息不覆盖标题", &[]);
    assert_eq!(session.snapshot["title"], "帮我检查会话标题生成");
}

#[test]
fn native_backend_compacts_long_first_user_message_into_session_title() {
    let mut session = new_session(None, None, "normal");
    maybe_title_session_from_first_user_message(
        &mut session,
        &format!("  \n{}  extra\n第二行不应出现", "检查".repeat(40)),
        &[],
    );
    let title = session.snapshot["title"].as_str().expect("compact title");
    assert_eq!(title, format!("{}…", "检查".repeat(24)));
    assert!(!title.contains("第二行"));
    assert!(!title.contains("extra"));
}
#[test]
fn native_backend_keeps_explicit_or_manual_session_titles() {
    let mut explicit = new_session(Some("Pinned".to_string()), None, "normal");
    maybe_title_session_from_first_user_message(&mut explicit, "用户首条消息", &[]);
    assert_eq!(explicit.snapshot["title"], "Pinned");
    let mut manual = new_session(None, None, "normal");
    manual.custom_title = Some("Manual".to_string());
    manual.snapshot["title"] = Value::String("Manual".to_string());
    maybe_title_session_from_first_user_message(&mut manual, "用户首条消息", &[]);
    assert_eq!(manual.snapshot["title"], "Manual");
}

#[test]
fn native_backend_strips_page_cite_markers_from_auto_session_title() {
    let mut session = new_session(None, None, "normal");
    maybe_title_session_from_first_user_message(
        &mut session,
        "给你自己配置⟦page-cite:page-cite-1⟧",
        &[json!({
            "id": "page-cite-1",
            "preview": "Cloudflare Dashboard",
            "pageTitle": "Cloudflare | Web Performance & Security"
        })],
    );
    let title = session.snapshot["title"].as_str().expect("title");
    assert_eq!(title, "给你自己配置 Cloudflare Dashboard");
    assert!(!title.contains("⟦"));
}

#[test]
fn turn_failure_commits_api_error_message_and_releases_session() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Turn Error Message Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let events = Arc::new(Mutex::new(Vec::<Value>::new()));
    let events_for_callback = events.clone();
    backend.register_event_callback(Arc::new(move |event| {
        events_for_callback
            .lock()
            .expect("events lock")
            .push(serde_json::from_str(&event).expect("event json"));
    }));

    let failure_message = "provider returned diagnostic detail";
    emit_assistant_error_message(&session_id, &turn_id, failure_message)
        .expect("assistant error message");
    finish_turn_with_metadata(
        &session_id,
        &turn_id,
        "finished",
        None,
        Some(failure_message.to_string()),
        None,
        None,
    );

    let read = backend
        .call_agent_method("agent.session.read", json!({ "sessionId": session_id }))
        .expect("read session");
    assert_eq!(read["turnStatus"], "idle");
    assert_eq!(read["activeTurnId"], Value::Null);
    let messages = read["messages"].as_array().expect("messages");
    let error_message = messages
        .iter()
        .find(|message| {
            message.get("role").and_then(Value::as_str) == Some("assistant")
                && message.get("text").and_then(Value::as_str) == Some(failure_message)
        })
        .expect("api error message");
    assert_eq!(
        error_message.pointer("/metadata/isApiError"),
        Some(&Value::Bool(true))
    );
    assert_eq!(
        error_message.pointer("/metadata/kind"),
        Some(&Value::String("provider-error".to_string()))
    );
    assert_eq!(
        error_message.pointer("/metadata/excludeFromProviderContext"),
        Some(&Value::Bool(true))
    );
    assert_eq!(
        error_message.pointer("/metadata/excludeFromMemory"),
        Some(&Value::Bool(true))
    );
    assert_eq!(
        error_message
            .pointer("/blocks/0/text")
            .and_then(Value::as_str),
        Some(failure_message)
    );
    assert!(error_message.get("renderDocument").is_none());

    let turn_state = state()
        .lock()
        .expect("state lock")
        .sessions
        .get(&session_id)
        .expect("session")
        .runtime_turns
        .iter()
        .find(|turn| turn.get("runtimeTurnId").and_then(Value::as_str) == Some(turn_id.as_str()))
        .and_then(|turn| turn.get("state").and_then(Value::as_str))
        .map(str::to_string);
    assert_eq!(turn_state.as_deref(), Some("interrupted"));
    let failure_kind = state()
        .lock()
        .expect("state lock")
        .sessions
        .get(&session_id)
        .expect("session")
        .runtime_turns
        .iter()
        .find(|turn| turn.get("runtimeTurnId").and_then(Value::as_str) == Some(turn_id.as_str()))
        .and_then(|turn| turn.get("failureKind").and_then(Value::as_str))
        .map(str::to_string);
    assert_eq!(failure_kind.as_deref(), Some("runtime_error"));

    let event_kinds = events
        .lock()
        .expect("events lock")
        .iter()
        .map(|event| event["kind"].as_str().unwrap_or_default().to_string())
        .collect::<Vec<_>>();
    assert!(event_kinds.contains(&"turnFinished".to_string()));
    assert!(event_kinds.contains(&"turnInterrupted".to_string()));
    assert!(!event_kinds.contains(&"turnCompleted".to_string()));
    backend.clear_event_callback();
}

#[test]
fn finish_turn_uses_explicit_final_message_id_after_active_id_is_cleared() {
    let mut session = new_session(
        Some(format!("Explicit Final ID {}", Uuid::new_v4())),
        None,
        "normal",
    );
    let session_id = session.id.clone();
    let turn_id = format!("turn-explicit-final-{}", Uuid::new_v4());
    let message_id = format!("message-explicit-final-{}", Uuid::new_v4());
    session.snapshot["turnStatus"] = json!("running");
    session.snapshot["activeTurnId"] = json!(turn_id);
    session.snapshot["follow"] = json!({ "running": true, "activity": "calling_model" });
    session.runtime_turns.push(runtime_turn(
        &turn_id,
        &session_id,
        "calling_model",
        None,
        None,
    ));
    push_array(
        &mut session.snapshot,
        "messages",
        assistant_message_with_id(message_id.clone(), "Final answer".to_string()),
    );
    {
        let mut runtime = state().lock().expect("state lock");
        session.dirty = true;
        runtime.sessions.insert(session_id.clone(), session);
        runtime.save_state().expect("save state");
    }
    crate::native_backend::turns::set_active_ui_message_id(&session_id, &turn_id, &message_id);
    crate::native_backend::turns::clear_active_ui_message_id(&session_id, &turn_id);

    crate::native_backend::turns::finish_turn_with_metadata_for_message(
        &session_id,
        &turn_id,
        "finished",
        None,
        None,
        Some(json!({
            "providerProtocol": {
                "version": 2,
                "status": "complete"
            }
        })),
        None,
        Some(message_id.clone()),
    );

    let runtime = state().lock().expect("state lock");
    let message = runtime.sessions[&session_id].snapshot["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .find(|message| message.get("id").and_then(Value::as_str) == Some(message_id.as_str()))
        .expect("final assistant message");
    assert_eq!(
        message.pointer("/metadata/providerProtocol/version"),
        Some(&json!(2))
    );
    assert_eq!(
        message.pointer("/metadata/providerProtocol/status"),
        Some(&json!("complete"))
    );
}

#[test]
fn orphan_running_turn_reconciliation_cancels_without_live_worker() {
    let mut session = new_session(Some("Recover".to_string()), None, "normal");
    let session_id = session.id.clone();
    let turn_id = "turn-orphan";
    session.snapshot["turnStatus"] = Value::String("running".to_string());
    session.snapshot["activeTurnId"] = Value::String(turn_id.to_string());
    session.snapshot["follow"] = json!({ "running": true, "activity": "calling_model" });
    session.runtime_turns.push(runtime_turn(
        turn_id,
        &session_id,
        "calling_model",
        None,
        None,
    ));

    let changed = reconcile_orphan_running_turn(&mut session, false, "test_recovery");

    assert!(changed);
    assert_eq!(session.snapshot["turnStatus"], "cancelled");
    assert_eq!(session.snapshot["activeTurnId"], Value::Null);
    assert_eq!(
        session.snapshot.pointer("/follow/running"),
        Some(&Value::Bool(false))
    );
    assert_eq!(session.runtime_turns[0]["state"], "interrupted");
    assert_eq!(session.runtime_turns[0]["failureKind"], "test_recovery");
    assert!(
        session.runtime_turns[0]["completedAtIso"]
            .as_str()
            .is_some()
    );
}

#[test]
fn orphan_running_turn_reconciliation_recovers_stale_waiting_for_tool() {
    let mut session = new_session(Some("Recover Stale Tool Wait".to_string()), None, "normal");
    let session_id = session.id.clone();
    let turn_id = "turn-stale-tool-wait";
    session.snapshot["turnStatus"] = Value::String("running".to_string());
    session.snapshot["activeTurnId"] = Value::String(turn_id.to_string());
    session.snapshot["follow"] = json!({ "running": true, "activity": "waiting_for_tool" });
    let mut turn = runtime_turn(turn_id, &session_id, "waiting_for_tool", None, None);
    turn["updatedAtMs"] = json!(
        Utc::now()
            .timestamp_millis()
            .saturating_sub(STALE_WAITING_FOR_TOOL_WITHOUT_RUNNING_TOOL_MS + 1_000)
    );
    session.runtime_turns.push(turn);
    session.snapshot["tools"] = json!([{
        "id": "tool-completed",
        "status": "completed",
        "input": { "turnId": turn_id }
    }]);

    let changed = reconcile_orphan_running_turn(&mut session, true, "test_live_token");

    assert!(changed);
    assert_eq!(session.snapshot["turnStatus"], "cancelled");
    assert_eq!(session.snapshot["activeTurnId"], Value::Null);
    assert_eq!(session.runtime_turns[0]["state"], "interrupted");
    assert_eq!(
        session.runtime_turns[0]["failureKind"],
        "stale_waiting_for_tool_without_running_tools"
    );
}

#[test]
fn provider_catalog_reports_rust_owned_routes_and_protocols() {
    let backend = LyraAgentBackend;
    let catalog = backend
        .call_agent_method("agent.provider.catalog.read", json!({}))
        .expect("provider catalog");

    assert_eq!(catalog["schemaVersion"], "2026-06-14");
    assert!(
        catalog["protocols"]
            .as_array()
            .expect("protocol list")
            .iter()
            .any(|entry| entry["id"] == "openai_chat_completions")
    );
    assert!(
        catalog["protocols"]
            .as_array()
            .expect("protocol list")
            .iter()
            .any(|entry| {
                entry["id"] == "openai_responses"
                    && entry["runtimeSupported"] == true
                    && entry["streamingSupported"] == true
                    && entry["toolCallingSupported"] == true
            })
    );
    assert!(
        catalog["protocols"]
            .as_array()
            .expect("protocol list")
            .iter()
            .any(|entry| {
                entry["id"] == "aws_bedrock_converse"
                    && entry["runtimeSupported"] == true
                    && entry["streamingSupported"] == false
                    && entry["toolCallingSupported"] == true
            })
    );
    assert!(
        catalog["protocols"]
            .as_array()
            .expect("protocol list")
            .iter()
            .any(|entry| {
                entry["id"] == "gemini_generate_content"
                    && entry["runtimeSupported"] == true
                    && entry["streamingSupported"] == true
                    && entry["toolCallingSupported"] == true
            })
    );
    assert!(
        catalog["protocols"]
            .as_array()
            .expect("protocol list")
            .iter()
            .any(|entry| {
                entry["id"] == "anthropic_messages"
                    && entry["runtimeSupported"] == true
                    && entry["streamingSupported"] == true
                    && entry["toolCallingSupported"] == true
            })
    );
    assert!(
        catalog["routes"]
            .as_array()
            .expect("route list")
            .iter()
            .any(|entry| {
                entry["id"] == "openai"
                    && entry["protocolId"] == "openai_responses"
                    && entry["apiMethod"] == "responses"
                    && entry["catalogSection"] == "hosted"
                    && entry["quickSetupSupported"] == true
            })
    );
    assert!(
        catalog["routes"]
            .as_array()
            .expect("route list")
            .iter()
            .any(|entry| {
                entry["id"] == "opencode_zen"
                    && entry["providerId"] == "opencode_zen"
                    && entry["defaultBaseUrl"] == "https://opencode.ai/zen/v1"
                    && entry["apiMethod"] == "modelDependent"
                    && entry["authKind"] == "bearer"
                    && entry["quickSetupSupported"] == true
            })
    );
    assert!(
        catalog["routes"]
            .as_array()
            .expect("route list")
            .iter()
            .any(|entry| {
                entry["id"] == "opencode_go"
                    && entry["providerId"] == "opencode_go"
                    && entry["defaultBaseUrl"] == "https://opencode.ai/zen/go/v1"
                    && entry["apiMethod"] == "modelDependent"
                    && entry["authKind"] == "bearer"
                    && entry["quickSetupSupported"] == true
            })
    );
    assert!(
        catalog["routes"]
            .as_array()
            .expect("route list")
            .iter()
            .any(|entry| {
                entry["id"] == "aws_bedrock"
                    && entry["protocolId"] == "aws_bedrock_converse"
                    && entry["apiMethod"] == "converse"
                    && entry["authKind"] == "aws_sigv4_env"
                    && entry["catalogSection"] == "hosted"
                    && entry["quickSetupSupported"] == false
            })
    );
    assert!(
        catalog["routes"]
            .as_array()
            .expect("route list")
            .iter()
            .any(|entry| {
                entry["id"] == "google_gemini"
                    && entry["protocolId"] == "gemini_generate_content"
                    && entry["apiMethod"] == "generateContent"
                    && entry["authKind"] == "x-goog-api-key"
                    && entry["catalogSection"] == "hosted"
                    && entry["quickSetupSupported"] == true
            })
    );
    assert!(
        catalog["routes"]
            .as_array()
            .expect("route list")
            .iter()
            .any(|entry| {
                entry["id"] == "anthropic"
                    && entry["protocolId"] == "anthropic_messages"
                    && entry["apiMethod"] == "messages"
                    && entry["catalogSection"] == "hosted"
                    && entry["quickSetupSupported"] == true
            })
    );
    assert!(
        catalog["routes"]
            .as_array()
            .expect("route list")
            .iter()
            .any(|entry| {
                entry["id"] == "custom_anthropic_compatible"
                    && entry["protocolId"] == "anthropic_messages"
                    && entry["apiMethod"] == "messages"
                    && entry["catalogSection"] == "custom"
                    && entry["customHeadersSupported"] == true
                    && entry["quickSetupSupported"] == true
            })
    );
    assert!(
        catalog["profiles"]
            .as_array()
            .expect("profile list")
            .iter()
            .any(|entry| entry["id"] == "openai" && entry["routeId"] == "openai")
    );
    assert!(
        catalog["routes"]
            .as_array()
            .expect("route list")
            .iter()
            .all(|entry| entry.get("catalogSection").is_some())
    );
    assert!(
        catalog["routes"]
            .as_array()
            .expect("route list")
            .iter()
            .any(|entry| {
                entry["id"] == "mimo"
                    && entry["defaultBaseUrl"] == "https://api.xiaomimimo.com/v1"
                    && entry["authKind"] == "bearer_or_header"
            })
    );
    assert!(
        catalog["routes"]
            .as_array()
            .expect("route list")
            .iter()
            .all(|entry| entry["id"] != "mimo_token_plan")
    );
}
#[test]
fn session_store_roundtrips_messages_and_runtime_turns() {
    let temp = tempfile::tempdir().expect("tempdir");
    let mut session = new_session(Some("SQLite".to_string()), None, "normal");
    push_array(
        &mut session.snapshot,
        "messages",
        json!({
            "id": "message-1",
            "role": "user",
            "text": "remember this session store path",
            "createdAt": now(),
        }),
    );
    session.runtime_turns.push(json!({
        "turnId": "turn-1",
        "state": "completed",
    }));
    save_session(temp.path(), &session).expect("save session");
    let loaded = load_session(temp.path(), &session.id)
        .expect("load session")
        .expect("session exists");
    assert_eq!(
        loaded.snapshot["messages"][0]["text"],
        "remember this session store path"
    );
    assert_eq!(loaded.runtime_turns[0]["turnId"], "turn-1");
}

#[test]
fn session_store_appends_only_the_dirty_dialog_suffix() {
    let temp = tempfile::tempdir().expect("tempdir");
    let mut session = new_session(Some("SQLite Incremental".to_string()), None, "normal");
    push_session_message(
        &mut session,
        json!({
            "id": "message-1",
            "role": "user",
            "text": "first",
            "createdAt": now(),
        }),
    );
    push_session_message(
        &mut session,
        json!({
            "id": "message-2",
            "role": "assistant",
            "text": "second",
            "createdAt": now(),
        }),
    );
    save_session(temp.path(), &session).expect("seed session");
    session.dialog_dirty_from = None;
    session.persisted_dialog_len = 2;

    let conn = open_sqlite_connection(&session_db_path(temp.path(), &session.id))
        .expect("open session db");
    conn.execute_batch(
        "CREATE TABLE dialog_audit (operation TEXT NOT NULL);
         CREATE TRIGGER dialog_audit_insert AFTER INSERT ON session_dialog
         BEGIN INSERT INTO dialog_audit VALUES ('insert'); END;
         CREATE TRIGGER dialog_audit_update AFTER UPDATE ON session_dialog
         BEGIN INSERT INTO dialog_audit VALUES ('update'); END;
         CREATE TRIGGER dialog_audit_delete AFTER DELETE ON session_dialog
         BEGIN INSERT INTO dialog_audit VALUES ('delete'); END;",
    )
    .expect("install dialog audit triggers");
    drop(conn);

    push_session_message(
        &mut session,
        json!({
            "id": "message-3",
            "role": "user",
            "text": "third",
            "createdAt": now(),
        }),
    );
    save_session(temp.path(), &session).expect("append session");

    let conn = open_sqlite_connection(&session_db_path(temp.path(), &session.id))
        .expect("reopen session db");
    let audit = conn
        .prepare(
            "SELECT operation, COUNT(*)
             FROM dialog_audit
             GROUP BY operation
             ORDER BY operation",
        )
        .expect("prepare audit query")
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .expect("query audit")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect audit");
    assert_eq!(audit, vec![("insert".to_string(), 1)]);
}

#[test]
fn native_state_save_only_rewrites_dirty_sessions() {
    let temp = tempfile::tempdir().expect("tempdir");
    let mut dirty_session = new_session(Some("Dirty".to_string()), None, "normal");
    let dirty_id = dirty_session.id.clone();
    let mut clean_session = new_session(Some("Clean".to_string()), None, "normal");
    let clean_id = clean_session.id.clone();
    save_session(temp.path(), &clean_session).expect("seed clean session");
    let clean_path = session_db_path(temp.path(), &clean_id);
    let clean_bytes = fs::read(&clean_path).expect("read clean session db");
    dirty_session.dirty = true;
    clean_session.dirty = false;
    let mut state = NativeRuntimeState {
        root: temp.path().to_path_buf(),
        tool_runtime_schema_version: TOOL_RUNTIME_SCHEMA_VERSION,
        tool_runtime_migration_diagnostics: Vec::new(),
        tool_usage_cache: HashMap::new(),
        sessions: HashMap::from([
            (dirty_session.id.clone(), dirty_session),
            (clean_id.clone(), clean_session),
        ]),
        active_session_id: None,
        config: NativeConfig::default(),
        active_skills: HashSet::new(),
        pending_permissions: HashMap::new(),
        pending_clarifications: HashMap::new(),
        model_capabilities: HashMap::new(),
        media_model_defaults: HashMap::new(),
        suppressed_tool_usage_by_turn: HashMap::new(),
        inspected_tool_descriptors_by_session: HashMap::new(),
        active_compressions: HashSet::new(),
        legacy_plaintext_provider_keys: HashSet::new(),
        first_used_at: None,
        dirty: false,
    };
    state.save_state().expect("save state");
    assert_eq!(
        fs::read(&clean_path).expect("clean session untouched"),
        clean_bytes
    );
    assert!(session_db_path(temp.path(), &dirty_id).is_file());
    assert!(state.sessions.values().all(|session| !session.dirty));
}

#[test]
fn native_state_schema_upgrade_preserves_sessions_and_snapshots() {
    let temp = tempfile::tempdir().expect("tempdir");
    let sessions_dir = temp.path().join("sessions");
    fs::create_dir_all(&sessions_dir).expect("sessions dir");
    let mut legacy_session = new_session(Some("Legacy".to_string()), None, "normal");
    let legacy_session_id = legacy_session.id.clone();
    legacy_session.dirty = false;
    save_session(temp.path(), &legacy_session).expect("write legacy session");
    let legacy_json_path = sessions_dir.join("legacy-json-session.json");
    write_json(&legacy_json_path, &json!({ "legacy": true })).expect("write legacy json");
    let custom_provider = NativeProviderProfile {
        id: "custom-provider".to_string(),
        label: "Custom Provider".to_string(),
        route_id: "custom_openai_compatible".to_string(),
        base_url: Some("http://localhost:8787/v1".to_string()),
        default_model: Some("custom-model".to_string()),
        api_key_ref: None,
        api_key: Some("secret".to_string()),
        api_key_env: None,
        auth_header: None,
        embedding_model: Some("custom-embedding".to_string()),
        models: vec![NativeProviderModel {
            id: "custom-model".to_string(),
            label: Some("Custom Model".to_string()),
            context_window: Some(128_000),
            supports_image_input: true,
            supports_tool_calling: true,
            supports_streaming: true,
            supports_reasoning_effort: None,
            reasoning_replay_field: ReasoningReplayField::Auto,
            requires_reasoning_field_on_assistant_messages: None,
            supports_tool_choice: None,
            enabled: true,
            api_npm: None,
        }],
    };
    let mut config = NativeConfig {
        default_provider: Some(custom_provider.id.clone()),
        default_model: Some("custom-model".to_string()),
        ..NativeConfig::default()
    };
    config
        .providers
        .insert(custom_provider.id.clone(), custom_provider);
    let memory_marker = format!("schema upgrade memory {}", Uuid::new_v4());
    create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("global".to_string()),
            category: Some("project_context".to_string()),
            fact: Some(memory_marker.clone()),
            content: Some(json!({ "fact": memory_marker })),
            confidence: Some(0.91),
            source_type: Some("test".to_string()),
            ..MemoryMutation::default()
        },
    )
    .expect("create memory");
    let state_file = NativeStateFile {
        tool_runtime_schema_version: TOOL_RUNTIME_SCHEMA_VERSION - 1,
        tool_runtime_migration_diagnostics: Vec::new(),
        tool_usage_cache: HashMap::new(),
        active_session_id: Some(legacy_session_id.clone()),
        config,
        active_skills: HashSet::from(["test-skill".to_string()]),
        model_capabilities: HashMap::new(),
        media_model_defaults: HashMap::new(),
        pending_permissions: HashMap::from([(
            "permission-legacy".to_string(),
            PermissionRequest {
                id: "permission-legacy".to_string(),
                session_id: legacy_session_id.clone(),
                turn_id: "turn-legacy".to_string(),
                tool_call_id: "tool-legacy".to_string(),
                action: "write_file".to_string(),
                risk: "dangerous".to_string(),
                summary: "legacy permission".to_string(),
                why: "legacy".to_string(),
                title: "Legacy permission".to_string(),
                detail: "legacy".to_string(),
                status: "pending".to_string(),
                allowed: None,
                created_at: now(),
                responded_at: None,
            },
        )]),
        pending_clarifications: HashMap::from([(
            "clarification-legacy".to_string(),
            ClarificationRequest {
                id: "clarification-legacy".to_string(),
                session_id: legacy_session_id.clone(),
                turn_id: "turn-legacy".to_string(),
                tool_call_id: "tool-legacy".to_string(),
                question: "legacy clarification?".to_string(),
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
        )]),
        first_used_at: None,
    };
    write_json(&temp.path().join("state.json"), &state_file).expect("write state");

    let loaded = NativeRuntimeState::load_from_root(temp.path().to_path_buf());

    assert!(loaded.sessions.contains_key(&legacy_session_id));
    assert_eq!(
        loaded.tool_runtime_schema_version,
        TOOL_RUNTIME_SCHEMA_VERSION
    );
    assert!(loaded.tool_runtime_migration_diagnostics.is_empty());
    assert_eq!(
        loaded.active_session_id.as_deref(),
        Some(legacy_session_id.as_str())
    );
    assert!(loaded.pending_permissions.is_empty());
    assert!(loaded.pending_clarifications.is_empty());
    assert_eq!(
        loaded.config.default_provider.as_deref(),
        Some("custom-provider")
    );
    assert!(loaded.config.providers.contains_key("custom-provider"));
    assert!(loaded.active_skills.contains("test-skill"));
    let memory_records = list_long_term_memory(
        temp.path(),
        MemoryQuery {
            query: Some(memory_marker.clone()),
            limit: 10,
            ..MemoryQuery::default()
        },
    )
    .expect("read memory after schema upgrade");
    assert_eq!(memory_records.len(), 1);
    assert!(session_db_path(temp.path(), &legacy_session_id).is_file());
    assert!(legacy_json_path.is_file());
    let backup_root = temp.path().join("migration-backups");
    let backup_dir = fs::read_dir(&backup_root)
        .expect("backup root")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| path.is_dir())
        .expect("schema backup dir");
    assert!(backup_dir.join("manifest.json").is_file());
    assert!(
        backup_dir
            .join("sessions")
            .join(&legacy_session_id)
            .join("session.sqlite")
            .is_file()
    );
    assert!(
        backup_dir
            .join("sessions")
            .join("legacy-json-session.json")
            .is_file()
    );
    let persisted =
        read_json::<NativeStateFile>(&temp.path().join("state.json")).expect("persisted state");
    assert_eq!(
        persisted.tool_runtime_schema_version,
        TOOL_RUNTIME_SCHEMA_VERSION
    );
    assert!(persisted.tool_runtime_migration_diagnostics.is_empty());
    assert_eq!(
        persisted.config.default_provider.as_deref(),
        Some("custom-provider")
    );
    assert!(persisted.active_skills.contains("test-skill"));
}

#[test]
fn native_state_schema_upgrade_keeps_old_version_when_snapshot_fails() {
    let temp = tempfile::tempdir().expect("tempdir");
    let session = new_session(Some("Snapshot".to_string()), None, "normal");
    let session_id = session.id.clone();
    save_session(temp.path(), &session).expect("write session");
    fs::write(temp.path().join("migration-backups"), "not a directory").expect("block backup root");
    let state_file = NativeStateFile {
        tool_runtime_schema_version: TOOL_RUNTIME_SCHEMA_VERSION - 1,
        tool_runtime_migration_diagnostics: Vec::new(),
        tool_usage_cache: HashMap::new(),
        active_session_id: Some(session_id.clone()),
        config: NativeConfig::default(),
        active_skills: HashSet::new(),
        pending_permissions: HashMap::new(),
        pending_clarifications: HashMap::new(),
        model_capabilities: HashMap::new(),
        media_model_defaults: HashMap::new(),
        first_used_at: None,
    };
    write_json(&temp.path().join("state.json"), &state_file).expect("write state");

    let loaded = NativeRuntimeState::load_from_root(temp.path().to_path_buf());

    assert!(loaded.sessions.contains_key(&session_id));
    assert_eq!(
        loaded.tool_runtime_schema_version,
        TOOL_RUNTIME_SCHEMA_VERSION - 1
    );
    assert_eq!(loaded.tool_runtime_migration_diagnostics.len(), 1);
    assert_eq!(
        loaded.tool_runtime_migration_diagnostics[0]["code"],
        "tool_runtime_schema_snapshot_failed"
    );
    let persisted =
        read_json::<NativeStateFile>(&temp.path().join("state.json")).expect("persisted state");
    assert_eq!(
        persisted.tool_runtime_schema_version,
        TOOL_RUNTIME_SCHEMA_VERSION - 1
    );
    assert_eq!(persisted.tool_runtime_migration_diagnostics.len(), 1);
    assert_eq!(
        persisted.active_session_id.as_deref(),
        Some(session_id.as_str())
    );
    assert!(persisted.pending_permissions.is_empty());
    assert!(persisted.pending_clarifications.is_empty());
}

mod host_and_browser;
mod native_and_git;
mod permissions_and_flows;
mod runtime_and_tools;
mod tool_output_compaction;
