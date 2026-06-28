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
    let mut session = new_session(
        Some("Parent".to_string()),
        Some(project.path().display().to_string()),
        "normal",
    );
    session.snapshot["plan"] = json!({
        "activePlanId": "plan-temp-1",
        "activeVersionId": "plan-temp-1",
        "title": "Plan Mode Test",
        "markdown": "# Plan\n\n- step 1\n- step 2\n",
        "annotations": [],
        "phase": PLAN_PHASE_REVIEWING,
        "review": { "status": "pending", "summary": null }
    });
    let parent_id = session.id.clone();
    {
        let mut state = state().lock().expect("state lock");
        state.sessions.insert(parent_id.clone(), session);
        state.active_session_id = Some(parent_id.clone());
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
        assert!(state
            .sessions
            .get(&temp_session_id)
            .map(|session| session.ephemeral)
            .unwrap_or(false));
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
    let _ = backend.call_agent_method(
        "agent.session.delete",
        json!({ "sessionId": parent_id }),
    );
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
    let cancellation = {
        let state = state().lock().expect("state lock");
        state
            .active_cancellations
            .get(&turn_id)
            .expect("active cancellation")
            .clone()
    };
    let started_at = now();

    let begin = execute_plan_tool_adapter(
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

    let write = execute_plan_tool_adapter(
        &session_id,
        &turn_id,
        &cancellation,
        "tool-plan-write",
        PLAN_WRITE_MODEL_TOOL,
        "write",
        json!({
            "markdownDelta": "# Plan\n\n- Build runtime support\n",
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

    let finalized = execute_plan_tool_adapter(
        &session_id,
        &turn_id,
        &cancellation,
        "tool-plan-finalize",
        PLAN_FINALIZE_MODEL_TOOL,
        "finalize",
        json!({ "summary": "Runtime plan is ready for review." }),
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
    let cancellation = {
        let state = state().lock().expect("state lock");
        state
            .active_cancellations
            .get(&turn_id)
            .expect("active cancellation")
            .clone()
    };
    let started_at = now();

    execute_plan_tool_adapter(
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
    execute_plan_tool_adapter(
        &session_id,
        &turn_id,
        &cancellation,
        "tool-plan-write-store",
        PLAN_WRITE_MODEL_TOOL,
        "write",
        json!({
            "markdownDelta": "# Stored plan\n\n- Build project list\n",
            "replace": false
        }),
        &started_at,
    );
    execute_plan_tool_adapter(
        &session_id,
        &turn_id,
        &cancellation,
        "tool-plan-finalize-store",
        PLAN_FINALIZE_MODEL_TOOL,
        "finalize",
        json!({ "summary": "Ready" }),
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
    let cancellation = {
        let state = state().lock().expect("state lock");
        state
            .active_cancellations
            .get(&turn_id)
            .expect("active cancellation")
            .clone()
    };

    let output = execute_model_tool_with_runtime(
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
    let cancellation = {
        let state = state().lock().expect("state lock");
        state
            .active_cancellations
            .get(&turn_id)
            .expect("active cancellation")
            .clone()
    };

    let output = execute_model_tool_with_runtime(
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
    let cancellation = {
        let state = state().lock().expect("state lock");
        state
            .active_cancellations
            .get(&turn_id)
            .expect("active cancellation")
            .clone()
    };
    let started_at = now();

    let written = execute_plan_tool_adapter(
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
    let cancellation = {
        let state = state().lock().expect("state lock");
        state
            .active_cancellations
            .get(&turn_id)
            .expect("active cancellation")
            .clone()
    };

    let output = execute_model_tool_with_runtime(
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
    let cancellation = {
        let state = state().lock().expect("state lock");
        state
            .active_cancellations
            .get(&turn_id)
            .expect("active cancellation")
            .clone()
    };

    let output = execute_model_tool_with_runtime(
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
            { "id": "runtime", "content": "Implement runtime support", "status": "in_progress", "priority": "normal", "blockedBy": [], "assignedTo": Value::Null },
            { "id": "ui", "content": "Implement UI support", "status": "pending", "priority": "normal", "blockedBy": [], "assignedTo": Value::Null }
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
    let cancellation = {
        let state = state().lock().expect("state lock");
        state
            .active_cancellations
            .get(&turn_id)
            .expect("active cancellation")
            .clone()
    };

    let updated = execute_model_tool_with_runtime(
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
                "evidence": "cargo test passed"
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

    let finished = execute_model_tool_with_runtime(
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

    assert_eq!(finished["raw"]["projectTodo"]["status"], "completed");
    let state = state().lock().expect("state lock");
    let session = state.sessions.get(&session_id).expect("session");
    assert_eq!(session.snapshot["plan"]["phase"], PLAN_PHASE_COMPLETED);
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
                    enabled: true,
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
    let cancellation = Arc::new(AtomicBool::new(false));
    crate::native_backend::session_runtime::register_active_turn(
        &session_id,
        &turn_id,
        cancellation.clone(),
    );

    let response = {
        let _state = state().lock().expect("state lock");
        cancel_turn(json!({ "sessionId": session_id.clone() })).expect("cancel turn")
    };
    let cancellation_requested = cancellation.load(Ordering::SeqCst);
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
    assert!(
        message
            .get("blocks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .any(|block| block.get("toolId").and_then(Value::as_str)
                == Some("call-persisted-tool"))
    );

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
    let tool = persisted
        .snapshot
        .get("tools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|tool| tool.get("id").and_then(Value::as_str) == Some("call-stable-anchor-tool"))
        .expect("tool");
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
        provider_replay_items: Vec::new(),
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
fn shell_run_rejects_legacy_background_flag() {
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
    .expect_err("background shell command should be rejected");

    assert_eq!(error.code, "background_not_supported");
}

#[test]
fn native_backend_titles_default_sessions_from_first_user_message() {
    let mut session = new_session(None, None, "normal");
    assert_eq!(session.snapshot["title"], DEFAULT_SESSION_TITLE);
    maybe_title_session_from_first_user_message(&mut session, "  帮我检查会话标题生成  ");
    assert_eq!(session.snapshot["title"], "帮我检查会话标题生成");
    push_array(
        &mut session.snapshot,
        "messages",
        user_message("帮我检查会话标题生成".to_string(), Vec::new(), now()),
    );
    maybe_title_session_from_first_user_message(&mut session, "第二条消息不覆盖标题");
    assert_eq!(session.snapshot["title"], "帮我检查会话标题生成");
}
#[test]
fn native_backend_keeps_explicit_or_manual_session_titles() {
    let mut explicit = new_session(Some("Pinned".to_string()), None, "normal");
    maybe_title_session_from_first_user_message(&mut explicit, "用户首条消息");
    assert_eq!(explicit.snapshot["title"], "Pinned");
    let mut manual = new_session(None, None, "normal");
    manual.custom_title = Some("Manual".to_string());
    manual.snapshot["title"] = Value::String("Manual".to_string());
    maybe_title_session_from_first_user_message(&mut manual, "用户首条消息");
    assert_eq!(manual.snapshot["title"], "Manual");
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
    assert_eq!(turn_state.as_deref(), Some("completed"));

    let event_kinds = events
        .lock()
        .expect("events lock")
        .iter()
        .map(|event| event["kind"].as_str().unwrap_or_default().to_string())
        .collect::<Vec<_>>();
    assert!(event_kinds.contains(&"turnFinished".to_string()));
    assert!(event_kinds.contains(&"turnCompleted".to_string()));
    assert!(!event_kinds.contains(&"turnFailed".to_string()));
    backend.clear_event_callback();
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
        cancelled_turns: HashSet::new(),
        active_cancellations: HashMap::new(),
        suppressed_tool_usage_by_turn: HashMap::new(),
        inspected_tool_descriptors_by_session: HashMap::new(),
        active_ui_message_by_turn: HashMap::new(),
        active_compressions: HashSet::new(),
        event_callback: None,
        host_dispatcher: None,
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
fn native_state_schema_upgrade_clears_legacy_tool_sessions() {
    let temp = tempfile::tempdir().expect("tempdir");
    let sessions_dir = temp.path().join("sessions");
    fs::create_dir_all(&sessions_dir).expect("sessions dir");
    let legacy_session = new_session(Some("Legacy".to_string()), None, "normal");
    let legacy_session_id = legacy_session.id.clone();
    write_json(
        &sessions_dir.join(format!("{legacy_session_id}.json")),
        &legacy_session,
    )
    .expect("write legacy session");
    let custom_provider = NativeProviderProfile {
        id: "custom-provider".to_string(),
        label: "Custom Provider".to_string(),
        route_id: "custom_openai_compatible".to_string(),
        base_url: Some("http://localhost:8787/v1".to_string()),
        default_model: Some("custom-model".to_string()),
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
            enabled: true,
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
                options: Vec::new(),
                allow_custom_answer: true,
                detail: None,
                status: "pending".to_string(),
                answer: None,
                selected_option: None,
                created_at: now(),
                responded_at: None,
            },
        )]),
    };
    write_json(&temp.path().join("state.json"), &state_file).expect("write state");

    let loaded = NativeRuntimeState::load_from_root(temp.path().to_path_buf());

    assert!(loaded.sessions.is_empty());
    assert_eq!(
        loaded.tool_runtime_schema_version,
        TOOL_RUNTIME_SCHEMA_VERSION
    );
    assert!(loaded.tool_runtime_migration_diagnostics.is_empty());
    assert_eq!(loaded.active_session_id, None);
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
    assert!(!session_dir(&temp.path(), &legacy_session_id).exists());
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
fn native_state_schema_upgrade_keeps_old_version_when_session_delete_fails() {
    use std::os::unix::fs::PermissionsExt;

    let temp = tempfile::tempdir().expect("tempdir");
    let sessions_dir = temp.path().join("sessions");
    fs::create_dir_all(&sessions_dir).expect("sessions dir");
    let blocked_path = sessions_dir.join("blocked");
    fs::create_dir_all(&blocked_path).expect("blocked dir");
    fs::set_permissions(&blocked_path, fs::Permissions::from_mode(0o000))
        .expect("lock blocked dir");
    let state_file = NativeStateFile {
        tool_runtime_schema_version: TOOL_RUNTIME_SCHEMA_VERSION - 1,
        tool_runtime_migration_diagnostics: Vec::new(),
        tool_usage_cache: HashMap::new(),
        active_session_id: Some("blocked".to_string()),
        config: NativeConfig::default(),
        active_skills: HashSet::new(),
        pending_permissions: HashMap::new(),
        pending_clarifications: HashMap::new(),
    };
    write_json(&temp.path().join("state.json"), &state_file).expect("write state");

    let loaded = NativeRuntimeState::load_from_root(temp.path().to_path_buf());

    assert!(loaded.sessions.is_empty());
    assert_eq!(
        loaded.tool_runtime_schema_version,
        TOOL_RUNTIME_SCHEMA_VERSION - 1
    );
    assert_eq!(loaded.tool_runtime_migration_diagnostics.len(), 1);
    assert_eq!(
        loaded.tool_runtime_migration_diagnostics[0]["code"],
        "tool_runtime_session_delete_failed"
    );
    assert!(blocked_path.exists());
    let persisted =
        read_json::<NativeStateFile>(&temp.path().join("state.json")).expect("persisted state");
    assert_eq!(
        persisted.tool_runtime_schema_version,
        TOOL_RUNTIME_SCHEMA_VERSION - 1
    );
    assert_eq!(persisted.tool_runtime_migration_diagnostics.len(), 1);
    assert_eq!(persisted.active_session_id, None);
    assert!(persisted.pending_permissions.is_empty());
    assert!(persisted.pending_clarifications.is_empty());
}

#[test]
fn native_state_persists_only_live_pending_requests() {
    let temp = tempfile::tempdir().expect("tempdir");
    let mut session = new_session(Some("Pending".to_string()), None, "normal");
    let session_id = session.id.clone();
    let live_turn_id = "turn-live".to_string();
    session.snapshot["turnStatus"] = Value::String("running".to_string());
    session.snapshot["activeTurnId"] = Value::String(live_turn_id.clone());
    let stale_turn_id = "turn-stale".to_string();
    let now = now();
    let permission =
        |id: &str, turn_id: &str, status: &str, allowed: Option<bool>| PermissionRequest {
            id: id.to_string(),
            session_id: session_id.clone(),
            turn_id: turn_id.to_string(),
            tool_call_id: "tool".to_string(),
            action: "act".to_string(),
            risk: "dangerous".to_string(),
            summary: "summary".to_string(),
            why: "why".to_string(),
            title: "title".to_string(),
            detail: "detail".to_string(),
            status: status.to_string(),
            allowed,
            created_at: now.clone(),
            responded_at: allowed.map(|_| now.clone()),
        };
    let clarification =
        |id: &str, turn_id: &str, status: &str, answer: Option<String>| ClarificationRequest {
            id: id.to_string(),
            session_id: session_id.clone(),
            turn_id: turn_id.to_string(),
            tool_call_id: "tool".to_string(),
            question: "question".to_string(),
            options: Vec::new(),
            allow_custom_answer: true,
            detail: None,
            status: status.to_string(),
            answer: answer.clone(),
            selected_option: answer.clone(),
            created_at: now.clone(),
            responded_at: answer.map(|_| now.clone()),
        };
    let mut state = NativeRuntimeState {
        root: temp.path().to_path_buf(),
        tool_runtime_schema_version: TOOL_RUNTIME_SCHEMA_VERSION,
        tool_runtime_migration_diagnostics: Vec::new(),
        tool_usage_cache: HashMap::new(),
        sessions: HashMap::from([(session_id.clone(), session)]),
        active_session_id: Some(session_id.clone()),
        config: NativeConfig::default(),
        active_skills: HashSet::new(),
        pending_permissions: HashMap::from([
            (
                "permission-live".to_string(),
                permission("permission-live", &live_turn_id, "pending", None),
            ),
            (
                "permission-complete".to_string(),
                permission("permission-complete", &live_turn_id, "allowed", Some(true)),
            ),
            (
                "permission-stale".to_string(),
                permission("permission-stale", &stale_turn_id, "pending", None),
            ),
        ]),
        pending_clarifications: HashMap::from([
            (
                "clarification-live".to_string(),
                clarification("clarification-live", &live_turn_id, "pending", None),
            ),
            (
                "clarification-complete".to_string(),
                clarification(
                    "clarification-complete",
                    &live_turn_id,
                    "answered",
                    Some("A".to_string()),
                ),
            ),
            (
                "clarification-stale".to_string(),
                clarification("clarification-stale", &stale_turn_id, "pending", None),
            ),
        ]),
        cancelled_turns: HashSet::new(),
        active_cancellations: HashMap::new(),
        suppressed_tool_usage_by_turn: HashMap::new(),
        inspected_tool_descriptors_by_session: HashMap::new(),
        active_ui_message_by_turn: HashMap::new(),
        active_compressions: HashSet::new(),
        event_callback: None,
        host_dispatcher: None,
    };
    assert!(state.prune_non_live_pending());
    state.save_state().expect("save state");
    let persisted =
        read_json::<NativeStateFile>(&temp.path().join("state.json")).expect("persisted state");
    assert_eq!(
        persisted
            .pending_permissions
            .keys()
            .cloned()
            .collect::<Vec<_>>(),
        vec!["permission-live".to_string()]
    );
    assert_eq!(
        persisted
            .pending_clarifications
            .keys()
            .cloned()
            .collect::<Vec<_>>(),
        vec!["clarification-live".to_string()]
    );
}
#[test]
fn native_backend_defaults_unbound_workspace_tools_to_home_directory() {
    // An unbound session (the user sent a message without choosing a project)
    // defaults both shell and filesystem tools to the user's home directory
    // instead of rejecting filesystem work. This keeps the two tool families
    // operating in the same place and lets users start chatting without first
    // binding a project.
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method("agent.session.create", json!({ "title": "Unbound Test" }))
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let legacy_list = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-list",
            "/tools/filesystem/list_files",
            json!({ "path": "." }),
        ),
    );
    assert_eq!(legacy_list["status"].as_str(), Some("failed"));
    assert_eq!(
        legacy_list.pointer("/error/code").and_then(Value::as_str),
        Some("tool_not_found")
    );
    assert_ne!(
        legacy_list.pointer("/error/code").and_then(Value::as_str),
        Some("workspace_unbound")
    );

    let shell = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-shell-unbound".to_string(),
            name: EXEC_COMMAND_MODEL_TOOL.to_string(),
            arguments: json!({ "cmd": "printf shell-ok" }),
        },
    );
    assert_eq!(shell["raw"]["success"].as_bool(), Some(true));
    assert_eq!(shell["raw"]["stdout"].as_str(), Some("shell-ok"));
    assert_ne!(
        shell.pointer("/error/code").and_then(Value::as_str),
        Some("workspace_unbound")
    );
}

#[test]
fn native_backend_rejects_rebinding_a_session_already_bound_to_a_project() {
    // Once a session is bound to a real project the binding is permanent:
    // re-binding to a different root would desynchronize the session's tool
    // history, file-read state, and rollback checkpoints from the new root.
    let backend = LyraAgentBackend;
    let first = tempfile::tempdir().expect("first tempdir");
    let second = tempfile::tempdir().expect("second tempdir");
    let created = backend
        .call_agent_method("agent.session.create", json!({ "title": "Rebind Test" }))
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();

    // First bind succeeds (session starts home-bound, which may be rebound once).
    let bound = backend
        .call_agent_method(
            "agent.session.bindProject",
            json!({
                "sessionId": session_id,
                "workingDir": first.path().display().to_string()
            }),
        )
        .expect("first bind");
    assert_eq!(bound["projectBound"], true);

    // Second bind to a different root is rejected.
    let rebind = backend.call_agent_method(
        "agent.session.bindProject",
        json!({
            "sessionId": session_id,
            "workingDir": second.path().display().to_string()
        }),
    );
    assert!(rebind.is_err(), "rebinding a bound session must fail");

    // The original binding is preserved.
    let read = backend
        .call_agent_method("agent.session.read", json!({ "sessionId": session_id }))
        .expect("read session");
    assert_eq!(
        read["workingDir"].as_str(),
        Some(first.path().display().to_string().as_str())
    );
}

#[test]
fn tool_fs_run_always_returns_tool_result_envelope_for_adapter_outputs() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("note.txt"), "adapter envelope").expect("write note");
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({
                "title": "Adapter Envelope Test",
                "workingDir": temp.path().display().to_string()
            }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let cancellation = Arc::new(AtomicBool::new(false));
    for (index, (path, args, expected_domain, expected_operation)) in
        [("/tools/memory/search", json!({}), "memory", "search")]
            .into_iter()
            .enumerate()
    {
        let turn_id = start_test_runtime_turn(&session_id);
        let output = execute_model_tool(
            &session_id,
            &turn_id,
            &None,
            &cancellation,
            tool_fs_run_call(&format!("tool-envelope-{index}"), path, args),
        );
        assert_eq!(output["schemaVersion"].as_u64(), Some(1), "{path}");
        assert_eq!(output["status"].as_str(), Some("completed"), "{path}");
        assert_eq!(output["ok"].as_bool(), Some(true), "{path}");
        assert_eq!(
            output["runtimeTurnId"].as_str(),
            Some(turn_id.as_str()),
            "{path}"
        );
        assert_eq!(output["toolPath"].as_str(), Some(path), "{path}");
        assert_eq!(output["domain"].as_str(), Some(expected_domain), "{path}");
        assert_eq!(
            output["operation"].as_str(),
            Some(expected_operation),
            "{path}"
        );
        assert!(output["traceId"].as_str().is_some(), "{path}");
        assert!(
            output["trace"].as_array().is_some_and(|trace| {
                trace.iter().any(|record| record["phase"] == "executing")
                    && trace.iter().any(|record| record["phase"] == "completed")
            }),
            "{path}"
        );
        assert!(output["toolOperation"].is_object(), "{path}");
        assert!(output["manifestTitle"].as_str().is_some(), "{path}");
        assert!(output["raw"].is_object(), "{path}");
    }
}

#[test]
fn tool_fs_hard_cut_hides_legacy_names_and_validates_run_envelope() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Tool-FS Hard Cut Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));

    let legacy = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "legacy-file-read".to_string(),
            name: "file_read".to_string(),
            arguments: json!({ "path": "README.md" }),
        },
    );
    assert_eq!(
        legacy.pointer("/error/code").and_then(Value::as_str),
        Some("tool_not_found")
    );

    let inspect = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "inspect-read-file".to_string(),
            name: "tool_fs_inspect".to_string(),
            arguments: json!({ "path": "/tools/filesystem/read_file" }),
        },
    );
    assert_eq!(
        inspect.pointer("/error/code").and_then(Value::as_str),
        Some("tool_not_found")
    );

    let legacy_run = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "run-legacy-read-file",
            "/tools/filesystem/read_file",
            json!({ "path": "README.md" }),
        ),
    );
    assert_eq!(
        legacy_run.pointer("/error/code").and_then(Value::as_str),
        Some("tool_not_found")
    );

    let invalid_args = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "invalid-tool-fs-args".to_string(),
            name: "tool_fs_run".to_string(),
            arguments: json!({
                "path": "/tools/memory/search",
                "args": []
            }),
        },
    );
    assert_eq!(
        invalid_args.pointer("/error/code").and_then(Value::as_str),
        Some("invalid_tool_args")
    );
    assert_eq!(invalid_args["schemaVersion"].as_u64(), Some(1));
    assert_eq!(invalid_args["status"].as_str(), Some("failed"));
    assert_eq!(
        invalid_args["runtimeTurnId"].as_str(),
        Some(turn_id.as_str())
    );
    assert!(invalid_args["traceId"].as_str().is_some());

    let inactive_turn = execute_model_tool(
        &session_id,
        "turn-not-active",
        &None,
        &cancellation,
        ModelToolCall {
            id: "inactive-turn-tool-fs-run".to_string(),
            name: "tool_fs_run".to_string(),
            arguments: json!({
                "path": "/tools/memory/search",
                "args": {}
            }),
        },
    );
    assert_eq!(
        inactive_turn.pointer("/error/code").and_then(Value::as_str),
        Some("runtime_turn_not_active")
    );
    assert_eq!(inactive_turn["status"].as_str(), Some("failed"));
    let inactive_list = execute_model_tool(
        &session_id,
        "turn-not-active",
        &None,
        &cancellation,
        ModelToolCall {
            id: "inactive-turn-tool-fs-list".to_string(),
            name: "tool_fs_list".to_string(),
            arguments: json!({ "path": "/tools" }),
        },
    );
    assert_eq!(
        inactive_list.pointer("/error/code").and_then(Value::as_str),
        Some("runtime_turn_not_active")
    );
    assert_eq!(inactive_list["status"].as_str(), Some("failed"));
    assert!(
        inactive_list["trace"]
            .as_array()
            .expect("trace")
            .iter()
            .all(|record| {
                !matches!(
                    record.get("phase").and_then(Value::as_str),
                    Some("executing" | "completed")
                )
            })
    );

    let traced = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call("traced-memory-search", "/tools/memory/search", json!({})),
    );
    assert_eq!(traced["status"].as_str(), Some("completed"));
    let policy_snapshot_id = traced
        .pointer("/toolOperation/policySnapshotId")
        .and_then(Value::as_str)
        .expect("policy snapshot id");
    assert!(policy_snapshot_id.contains(&session_id));
    assert!(policy_snapshot_id.contains(&turn_id));
    let trace = traced["trace"].as_array().expect("trace");
    let phases = trace
        .iter()
        .filter_map(|entry| entry["phase"].as_str())
        .collect::<Vec<_>>();
    let validated_index = phases
        .iter()
        .position(|phase| *phase == "validated")
        .expect("validated trace");
    let permission_index = phases
        .iter()
        .position(|phase| *phase == "permission_checked")
        .expect("permission trace");
    let executing_index = phases
        .iter()
        .position(|phase| *phase == "executing")
        .expect("executing trace");
    assert!(validated_index < permission_index);
    assert!(permission_index < executing_index);
    let permission_trace = &trace[permission_index];
    assert_eq!(
        permission_trace.pointer("/detail/policySnapshotId"),
        traced.pointer("/toolOperation/policySnapshotId")
    );
    assert_eq!(
        permission_trace
            .pointer("/detail/permissionMode")
            .and_then(Value::as_str),
        Some("runtime_policy")
    );
    assert_eq!(
        permission_trace
            .pointer("/detail/permissionPolicy")
            .and_then(Value::as_str),
        Some("runtime_policy")
    );
    assert_eq!(
        permission_trace
            .pointer("/detail/toolPath")
            .and_then(Value::as_str),
        Some("/tools/memory/search")
    );
}

#[test]
fn tool_fs_search_is_provider_visible_and_returns_ranked_results() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Tool Search Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-fs-search-command".to_string(),
            name: "tool_fs_search".to_string(),
            arguments: json!({
                "query": "打开网页 navigate browser",
                "scene": "browser",
                "pageSize": 8
            }),
        },
    );

    assert_eq!(output["status"].as_str(), Some("completed"));
    assert_eq!(
        output["toolPath"].as_str(),
        Some("/tools/runtime/tool_fs_search")
    );
    assert_eq!(output["raw"]["kind"].as_str(), Some("tool_fs_search"));
    assert!(
        output["raw"]["results"]
            .as_array()
            .expect("search results")
            .iter()
            .any(|result| result["path"] == "/tools/browser/navigate")
    );
    let top_result = output["raw"]["results"]
        .as_array()
        .expect("search results")
        .first()
        .expect("top search result");
    assert!(
        top_result
            .get("runHint")
            .and_then(Value::as_str)
            .is_some_and(|hint| hint.contains("tool_fs_run"))
    );
    assert!(
        top_result
            .pointer("/miniSchema/parameters")
            .and_then(Value::as_array)
            .is_some_and(|parameters| !parameters.is_empty())
    );
    assert!(
        output["content"]
            .as_str()
            .is_some_and(|content| content.contains("miniSchema/runHint"))
    );
    assert!(
        output["trace"]
            .as_array()
            .is_some_and(|trace| trace.iter().any(|record| record["phase"] == "completed"))
    );

    let invalid = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-fs-search-empty".to_string(),
            name: "tool_fs_search".to_string(),
            arguments: json!({ "query": "" }),
        },
    );
    assert_eq!(
        invalid.pointer("/error/code").and_then(Value::as_str),
        Some("invalid_tool_search_query")
    );
}

#[test]
fn tool_fs_search_does_not_guide_generated_file_writes_to_removed_code_tools() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Generated File Write Search Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-fs-search-generated-html".to_string(),
            name: "tool_fs_search".to_string(),
            arguments: json!({
                "query": "write file create html file",
                "scene": "project-code",
                "pageSize": 5
            }),
        },
    );

    assert_eq!(output["status"].as_str(), Some("completed"));
    let content = output["content"].as_str().expect("search content");
    assert!(!content.contains("lyra-write-file"));
    let results = output["raw"]["results"].as_array().expect("search results");
    assert!(results.iter().all(|result| {
        let path = result["path"].as_str().unwrap_or_default();
        !path.starts_with("/tools/filesystem/")
            && !path.starts_with("/tools/code/")
            && !path.starts_with("/tools/shell/")
            && !path.starts_with("/tools/git/")
    }));
}

#[test]
fn tool_fs_inspect_populates_session_descriptor_cache_context() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Tool Descriptor Cache Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    {
        let mut state = state().lock().expect("state lock");
        state.inspected_tool_descriptors_by_session.clear();
    }
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "inspect-browser-map".to_string(),
            name: "tool_fs_inspect".to_string(),
            arguments: json!({ "path": "/tools/browser/map" }),
        },
    );
    assert_eq!(output["status"].as_str(), Some("completed"));

    let context = tool_filesystem_runtime_context("browser", Some(&session_id), None);
    let descriptors = context["inspectedDescriptors"]
        .as_array()
        .expect("inspected descriptors");
    let browser_map = descriptors
        .iter()
        .find(|entry| entry["path"] == "/tools/browser/map")
        .expect("browser map descriptor cache entry");
    assert!(
        browser_map["runHint"]
            .as_str()
            .is_some_and(|hint| hint.contains("tool_fs_run"))
    );
    assert!(
        browser_map
            .pointer("/miniSchema/parameters")
            .and_then(Value::as_array)
            .is_some_and(|parameters| !parameters.is_empty())
    );
}

#[test]
fn tool_fs_presearch_hints_use_latest_user_message() {
    let hints = tools::tool_fs::presearch_hints_for_message(
        "打开网页 https://www.google.com",
        "browser",
        None,
        None,
    );
    let hints = hints.as_array().expect("presearch hints");
    let navigate = hints
        .iter()
        .find(|hint| hint["path"] == "/tools/browser/navigate")
        .expect("navigate hint");
    assert!(
        navigate["runHint"]
            .as_str()
            .is_some_and(|hint| hint.contains("tool_fs_run"))
    );
    assert!(
        navigate
            .pointer("/miniSchema/parameters")
            .and_then(Value::as_array)
            .is_some_and(|parameters| !parameters.is_empty())
    );
    assert_eq!(
        navigate["source"].as_str(),
        Some("latestUserMessagePresearch")
    );
}

#[test]
fn tool_usage_cache_records_success_failure_and_context_handles() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("note.txt"), "cached tool note").expect("write note");
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({
                "title": "Tool Usage Cache Test",
                "workingDir": temp.path().display().to_string()
            }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    {
        let mut state = state().lock().expect("state lock");
        state.tool_usage_cache.clear();
        state.suppressed_tool_usage_by_turn.clear();
    }
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));

    let success = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-cache-memory-success",
            "/tools/memory/search",
            json!({ "query": "cached tool note" }),
        ),
    );
    assert_eq!(success["ok"].as_bool(), Some(true));
    {
        let state = state().lock().expect("state lock");
        let entry = state
            .tool_usage_cache
            .get("/tools/memory/search")
            .expect("usage cache entry");
        assert_eq!(entry.successes, 1);
        assert_eq!(entry.failures, 0);
        assert_eq!(entry.consecutive_failures, 0);
        assert_eq!(entry.handle.as_deref(), Some("memory_search"));
    }

    let context = tool_filesystem_runtime_context("project-code", None, None);
    assert!(
        context["cachedHandles"]
            .as_array()
            .expect("cached handles")
            .iter()
            .any(|handle| handle["path"] == "/tools/memory/search"
                && handle["source"] == "toolUsageCache")
    );
    assert!(
        context["cachedHandles"]
            .as_array()
            .expect("cached handles")
            .iter()
            .all(|handle| handle["path"] != "/tools/filesystem/read_file")
    );

    let failed = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-cache-memory-failed",
            "/tools/memory/update",
            json!({}),
        ),
    );
    assert_eq!(failed["ok"].as_bool(), Some(false));
    assert_eq!(failed["cacheSuppressedForTurn"].as_bool(), Some(true));
    assert!(
        failed["recommendedNextAction"]
            .as_str()
            .is_some_and(|action| action.contains("tool_fs_search"))
    );
    {
        let state = state().lock().expect("state lock");
        let entry = state
            .tool_usage_cache
            .get("/tools/memory/update")
            .expect("usage cache entry");
        assert_eq!(entry.successes, 0);
        assert_eq!(entry.failures, 1);
        assert_eq!(entry.consecutive_failures, 1);
        assert!(
            state
                .suppressed_tool_usage_by_turn
                .get(&turn_id)
                .is_some_and(|paths| paths.contains("/tools/memory/update"))
        );
    }
}

#[test]
fn model_catalog_uses_structured_provider_capabilities() {
    let mut config = NativeConfig {
        default_provider: Some("custom".to_string()),
        default_model: Some("custom-model".to_string()),
        ..NativeConfig::default()
    };
    config.providers.insert(
        "custom".to_string(),
        NativeProviderProfile {
            id: "custom".to_string(),
            label: "Custom".to_string(),
            route_id: "custom_openai_compatible".to_string(),
            base_url: Some("http://localhost:8787/v1".to_string()),
            default_model: Some("custom-model".to_string()),
            api_key: Some("sk-test".to_string()),
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
                enabled: true,
            }],
        },
    );
    let catalog = model_catalog_for_config(&config, json!({})).expect("model catalog");

    assert!(catalog["models"].as_array().is_some());
    assert!(catalog["routes"].as_array().is_some());
    assert!(catalog["models"].as_array().is_some_and(|models| {
        models.iter().any(|model| {
            model
                .get("embeddingModel")
                .and_then(Value::as_str)
                .is_some()
        })
    }));
}

#[test]
fn model_catalog_does_not_synthesize_models_without_configured_providers() {
    let catalog =
        model_catalog_for_config(&NativeConfig::default(), json!({})).expect("model catalog");

    assert_eq!(catalog["currentProvider"], "");
    assert_eq!(catalog["currentModel"], "");
    assert!(catalog["models"].as_array().is_some_and(Vec::is_empty));
    assert!(catalog["routes"].as_array().is_some_and(Vec::is_empty));
}

#[test]
fn config_json_projects_prompt_delivery_settings() {
    let config = NativeConfig {
        prompt_delivery_mode: Some("lean-experimental".to_string()),
        openai_responses_stateful_prompt_contract: true,
        ..NativeConfig::default()
    };
    let projection = config_json(&config);

    assert_eq!(
        projection
            .pointer("/promptDelivery/mode")
            .and_then(Value::as_str),
        Some("lean-experimental")
    );
    assert_eq!(
        projection
            .pointer("/promptDelivery/leanExperimental")
            .and_then(Value::as_bool),
        Some(true)
    );
    assert_eq!(
        projection
            .pointer("/promptDelivery/openaiResponsesStatefulPromptContract")
            .and_then(Value::as_bool),
        Some(true)
    );
}

#[test]
fn default_provider_install_does_not_seed_hardcoded_models() {
    let mut config = NativeConfig::default();
    install_default_providers(&mut config);

    assert!(
        config
            .providers
            .values()
            .all(|provider| provider.models.is_empty())
    );
    let catalog = model_catalog_for_config(&config, json!({})).expect("model catalog");
    assert!(catalog["models"].as_array().is_some_and(Vec::is_empty));
    assert!(catalog["routes"].as_array().is_some_and(Vec::is_empty));
}

#[test]
fn save_provider_profile_preserves_omitted_secret_and_models() {
    let backend = LyraAgentBackend;
    let profile_name = format!("preserve-profile-{}", Uuid::new_v4());
    let original_model = format!("preserve-model-{}", Uuid::new_v4());
    {
        let mut state = state().lock().expect("state lock");
        state.config.providers.insert(
            profile_name.clone(),
            NativeProviderProfile {
                id: profile_name.clone(),
                label: "Preserve Profile".to_string(),
                route_id: "custom_openai_compatible".to_string(),
                base_url: Some("https://old.example.com/v1".to_string()),
                default_model: Some(original_model.clone()),
                api_key: Some("sk-preserve".to_string()),
                api_key_env: Some("LYRA_PRESERVE_API_KEY".to_string()),
                auth_header: Some("api-key".to_string()),
                embedding_model: Some("embedding-preserve".to_string()),
                models: vec![NativeProviderModel {
                    id: original_model.clone(),
                    label: Some("Preserve Model".to_string()),
                    context_window: Some(42_000),
                    supports_image_input: true,
                    supports_tool_calling: true,
                    supports_streaming: true,
                    supports_reasoning_effort: None,
                    enabled: true,
                }],
            },
        );
    }

    backend
        .call_agent_method(
            "agent.provider.profile.save",
            json!({
                "profileName": profile_name,
                "routeId": "custom_openai_compatible",
                "baseUrl": "https://new.example.com/v1",
            }),
        )
        .expect("save provider profile");

    let state = state().lock().expect("state lock");
    let profile = state
        .config
        .providers
        .get(&profile_name)
        .expect("profile preserved");
    assert_eq!(
        profile.base_url.as_deref(),
        Some("https://new.example.com/v1")
    );
    assert_eq!(
        profile.default_model.as_deref(),
        Some(original_model.as_str())
    );
    assert_eq!(profile.api_key.as_deref(), Some("sk-preserve"));
    assert_eq!(
        profile.api_key_env.as_deref(),
        Some("LYRA_PRESERVE_API_KEY")
    );
    assert_eq!(profile.auth_header.as_deref(), Some("api-key"));
    assert_eq!(
        profile.embedding_model.as_deref(),
        Some("embedding-preserve")
    );
    assert_eq!(profile.models.len(), 1);
    assert_eq!(profile.models[0].id, original_model);
}

#[test]
fn save_mimo_anthropic_profile_uses_api_key_header_by_default() {
    let backend = LyraAgentBackend;
    let profile_name = format!("mimo-anthropic-profile-{}", Uuid::new_v4());

    backend
        .call_agent_method(
            "agent.provider.profile.save",
            json!({
                "profileName": profile_name,
                "routeId": providers::routes::mimo::ANTHROPIC_TOKEN_PLAN_SGP_ROUTE_ID,
                "apiKey": "tp-secret",
                "authHeader": null,
            }),
        )
        .expect("save mimo anthropic provider profile");

    let state = state().lock().expect("state lock");
    let profile = state
        .config
        .providers
        .get(&profile_name)
        .expect("profile saved");
    assert_eq!(
        profile.route_id,
        providers::routes::mimo::ANTHROPIC_TOKEN_PLAN_SGP_ROUTE_ID
    );
    assert_eq!(
        profile.base_url.as_deref(),
        Some(providers::routes::mimo::ANTHROPIC_TOKEN_PLAN_SGP_BASE_URL)
    );
    assert_eq!(profile.api_key.as_deref(), Some("tp-secret"));
    assert_eq!(profile.auth_header.as_deref(), Some("api-key"));
}

#[test]
fn model_catalog_keeps_disabled_models_out_of_routes() {
    let mut config = NativeConfig {
        default_provider: Some("custom".to_string()),
        default_model: Some("enabled-model".to_string()),
        ..NativeConfig::default()
    };
    config.providers.insert(
        "custom".to_string(),
        NativeProviderProfile {
            id: "custom".to_string(),
            label: "Custom".to_string(),
            route_id: "custom_openai_compatible".to_string(),
            base_url: Some("http://localhost:8787/v1".to_string()),
            default_model: Some("enabled-model".to_string()),
            api_key: Some("sk-test".to_string()),
            api_key_env: None,
            auth_header: None,
            embedding_model: None,
            models: vec![
                NativeProviderModel {
                    id: "enabled-model".to_string(),
                    label: None,
                    context_window: None,
                    supports_image_input: true,
                    supports_tool_calling: true,
                    supports_streaming: true,
                    supports_reasoning_effort: None,
                    enabled: true,
                },
                NativeProviderModel {
                    id: "disabled-model".to_string(),
                    label: None,
                    context_window: None,
                    supports_image_input: true,
                    supports_tool_calling: true,
                    supports_streaming: true,
                    supports_reasoning_effort: None,
                    enabled: false,
                },
            ],
        },
    );

    let catalog = model_catalog_for_config(&config, json!({})).expect("model catalog");
    let model_ids = catalog["models"]
        .as_array()
        .expect("models")
        .iter()
        .filter_map(|model| model["model"].as_str())
        .collect::<Vec<_>>();
    let route_models = catalog["routes"]
        .as_array()
        .expect("routes")
        .iter()
        .filter_map(|route| route["model"].as_str())
        .collect::<Vec<_>>();
    let disabled = catalog["models"]
        .as_array()
        .expect("models")
        .iter()
        .find(|model| model["model"].as_str() == Some("disabled-model"))
        .expect("disabled model");

    assert!(model_ids.contains(&"enabled-model"));
    assert!(model_ids.contains(&"disabled-model"));
    assert!(route_models.contains(&"enabled-model"));
    assert!(!route_models.contains(&"disabled-model"));
    assert_eq!(disabled["enabled"], false);
}

#[test]
fn model_request_injects_lyra_identity_and_tools() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method("agent.session.create", json!({ "title": "Prompt Test" }))
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id");
    state().lock().expect("state lock").active_skills.clear();
    let request = build_model_request(session_id).expect("model request");
    let system_prompt = request.messages[0]["content"]
        .as_str()
        .expect("system prompt");
    assert!(system_prompt.contains("U r Lyra"));
    assert!(system_prompt.contains("company computer w discoverable caps"));
    assert!(system_prompt.contains("Interaction contract"));
    assert!(system_prompt.contains("Plain assistant questions r final/non-blocking text"));
    let names = request
        .tools
        .iter()
        .filter_map(|tool| tool.pointer("/function/name").and_then(Value::as_str))
        .collect::<Vec<_>>();
    assert_eq!(
        names,
        expected_provider_tool_names()
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
    );
    assert!(system_prompt.contains("toolFilesystem"));
    assert!(system_prompt.contains("\"interactionContract\""));
    assert!(system_prompt.contains("\"clarificationTool\""));
    assert!(system_prompt.contains("pinnedHandles"));
    {
        let state = state().lock().expect("state lock");
        let session = state.sessions.get(session_id).expect("session");
        assert!(session.snapshot.get("promptRuntimeContract").is_some());
        assert_eq!(
            session
                .snapshot
                .pointer("/promptDelivery/promptMode")
                .and_then(Value::as_str),
            Some("full")
        );
        assert_eq!(
            session
                .snapshot
                .pointer("/promptDelivery/refreshReason")
                .and_then(Value::as_str),
            Some("fullModeDefault")
        );
        assert!(
            session
                .snapshot
                .pointer("/promptDelivery/sceneModules")
                .and_then(Value::as_array)
                .is_some()
        );
        assert!(
            session
                .snapshot
                .pointer("/promptDelivery/prefixCacheEligibleTokens")
                .and_then(Value::as_u64)
                .is_some_and(|tokens| tokens > 0)
        );
        assert!(
            session
                .snapshot
                .pointer("/promptDelivery/missedModuleRecovery")
                .is_some()
        );
    }
}

#[test]
fn model_request_keeps_tool_fs_visible_while_presearch_adds_hints() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Tool Presearch Prompt Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    state().lock().expect("state lock").active_skills.clear();
    {
        let mut state = state().lock().expect("state lock");
        let session = state.sessions.get_mut(&session_id).expect("session");
        session.snapshot["messages"]
            .as_array_mut()
            .expect("messages")
            .push(user_message(
                "打开网页 https://www.google.com".to_string(),
                Vec::new(),
                now(),
            ));
    }

    let request = build_model_request(&session_id).expect("model request");
    let names = request
        .tools
        .iter()
        .filter_map(|tool| tool.pointer("/function/name").and_then(Value::as_str))
        .map(str::to_string)
        .collect::<Vec<_>>();
    assert_eq!(names, expected_provider_tool_names());
    let system_prompt = request.messages[0]["content"]
        .as_str()
        .expect("system prompt");
    assert!(system_prompt.contains("\"presearchHints\""));
    assert!(system_prompt.contains("/tools/browser/navigate"));
    assert!(!system_prompt.contains("\"toolDiscoverySuppressed\": true"));
}

#[test]
fn runtime_context_does_not_expose_tools_to_non_tool_calling_models() {
    let context = build_runtime_context(
        None,
        &[],
        &ModelCapabilityProfile {
            supports_image_input: false,
            supports_tool_calling: false,
            supports_streaming: false,
            context_window: Some(8_192),
        },
    );
    assert_eq!(context["tools"], json!([]));
    assert_eq!(
        context
            .pointer("/capabilities/supportsToolCalling")
            .and_then(Value::as_bool),
        Some(false)
    );
}

#[test]
fn provider_visible_tool_schema_snapshot_is_curated_runtime_surface() {
    for tools in [model_tools()] {
        let names = tools
            .iter()
            .filter_map(|tool| tool.pointer("/function/name").and_then(Value::as_str))
            .map(str::to_string)
            .collect::<Vec<_>>();
        assert_eq!(names, expected_provider_tool_names());
        assert_eq!(
            names.first().map(String::as_str),
            Some(LYRA_CLARIFICATION_ASK_TOOL)
        );
        let clarification = tools
            .iter()
            .find(|tool| {
                tool.pointer("/function/name").and_then(Value::as_str)
                    == Some(LYRA_CLARIFICATION_ASK_TOOL)
            })
            .expect("clarification tool");
        let description = clarification
            .pointer("/function/description")
            .and_then(Value::as_str)
            .expect("clarification description");
        assert!(description.contains("decision panel"));
        assert!(description.contains("Plain assistant text questions are non-blocking"));
        assert!(
            clarification
                .pointer("/function/parameters/properties/question/description")
                .and_then(Value::as_str)
                .is_some_and(|description| description.contains("blocking decision panel"))
        );
        assert!(tools.iter().all(|tool| {
            tool.pointer("/function/name")
                .and_then(Value::as_str)
                .is_some_and(|name| {
                    name.starts_with("tool_fs_")
                        || name == LYRA_CLARIFICATION_ASK_TOOL
                        || name == EDIT_FILE_MODEL_TOOL
                        || name == WRITE_FILE_MODEL_TOOL
                        || name == APPLY_PATCH_MODEL_TOOL
                        || name == EXEC_COMMAND_MODEL_TOOL
                        || name == WRITE_STDIN_MODEL_TOOL
                        || name == LYRA_SESSION_READ_MESSAGE_TOOL
                        || name == PLAN_BEGIN_MODEL_TOOL
                        || name == PLAN_WRITE_MODEL_TOOL
                        || name == PLAN_FINALIZE_MODEL_TOOL
                        || name == PLAN_REVISE_MODEL_TOOL
                        || name == TODO_WRITE_MODEL_TOOL
                        || name == TODO_UPDATE_MODEL_TOOL
                        || name == TODO_FINISH_MODEL_TOOL
                })
        }));
        assert!(!tools.iter().any(|tool| {
            tool.pointer("/function/name")
                .and_then(Value::as_str)
                .is_some_and(|name| {
                    matches!(
                        name,
                        "file_read"
                            | "shell_run"
                            | "terminal_read"
                            | "lyra_lumen_read"
                            | "software_invoke_capability"
                    )
                })
        }));
    }
}

#[test]
fn tool_filesystem_runtime_context_uses_dynamic_registry_without_expanding_provider_tools() {
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, _payload| {
        assert_eq!(method, "software.listCapabilities");
        Ok(serde_json::to_string(&json!({
            "software": [{
                "id": "notes",
                "title": "Notes",
                "actions": [{
                    "id": "open",
                    "title": "Open note",
                    "summary": "Open a note in the Notes adapter.",
                    "risk": "read",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "noteId": { "type": "string" }
                        },
                        "required": ["noteId"],
                        "additionalProperties": false
                    }
                }]
            }]
        }))
        .expect("json"))
    });
    let static_count = tools::tool_fs::runtime_registry()
        .root_summary_for_scene(lyra_tool_fs_core::ToolScene::Automation)["toolCount"]
        .as_u64()
        .expect("static tool count");
    let context = tool_filesystem_runtime_context("automation", None, Some(&dispatcher));
    let mut actual_provider_tools = context["policy"]["providerVisibleTools"]
        .as_array()
        .expect("provider-visible tools")
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<Vec<_>>();
    actual_provider_tools.sort();
    let mut expected_provider_tools = expected_provider_tool_names();
    expected_provider_tools.sort();
    assert_eq!(actual_provider_tools, expected_provider_tools);
    assert!(
        context["rootSummary"]["toolCount"]
            .as_u64()
            .expect("dynamic tool count")
            > static_count
    );
    let sources = context["manifestSources"]
        .as_array()
        .expect("manifest source summary");
    for expected in [
        "core_builtin",
        "terminal_action_specs",
        "skill_registry",
        "mcp_current_state",
        "software_host_capabilities",
    ] {
        assert!(
            sources
                .iter()
                .any(|source| source["name"].as_str() == Some(expected)),
            "missing manifest source {expected}"
        );
    }
    assert!(sources.iter().any(|source| {
        source["name"].as_str() == Some("software_host_capabilities")
            && source["kind"].as_str() == Some("dynamic")
            && source["manifestCount"].as_u64().unwrap_or(0) == 1
    }));
}

#[test]
fn tool_filesystem_scene_uses_runtime_state_signals() {
    assert_eq!(
        infer_tool_filesystem_scene(
            Some("project-code"),
            None,
            &HashSet::new(),
            &json!({})
        ),
        "project-code"
    );
    assert_eq!(
        infer_tool_filesystem_scene(
            None,
            None,
            &HashSet::new(),
            &json!({ "activeTab": { "kind": "terminal" } }),
        ),
        "terminal"
    );
    assert_eq!(
        infer_tool_filesystem_scene(
            None,
            None,
            &HashSet::new(),
            &json!({ "activeTab": { "kind": "browser" } }),
        ),
        "browser"
    );
    assert_eq!(
        infer_tool_filesystem_scene(
            None,
            None,
            &HashSet::new(),
            &json!({
                "activeTabId": "term-1",
                "tabs": [{
                    "tabId": "term-1",
                    "pageKind": "terminal",
                    "focusedPane": true
                }]
            }),
        ),
        "terminal"
    );
    assert_eq!(
        infer_tool_filesystem_scene(
            None,
            None,
            &HashSet::new(),
            &json!({
                "focusedTabId": "page-1",
                "tabs": [{
                    "id": "page-1",
                    "pageKind": "page",
                    "observationKind": "page",
                    "displayAddress": "https://example.com"
                }]
            }),
        ),
        "browser"
    );
    assert_eq!(
        infer_tool_filesystem_scene(
            None,
            None,
            &HashSet::new(),
            &json!({ "activeTab": { "kind": "software" } }),
        ),
        "automation"
    );
}
#[test]
fn model_tool_execution_records_workbench_activity() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method("agent.session.create", json!({ "title": "Tool Test" }))
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, _payload| {
        assert_eq!(method, "workbench.listTabs");
        Ok(serde_json::to_string(&json!({
            "activeTabId": "browser-tab-1",
            "tabs": [
                {
                    "tabId": "browser-tab-1",
                    "title": "Example",
                    "pageKind": "page",
                    "observationKind": "page",
                    "active": true,
                    "visible": true,
                    "focusedPane": true,
                    "observable": true,
                    "url": "https://example.com"
                }
            ]
        }))
        .expect("json"))
    });
    let turn_id = start_test_runtime_turn(&session_id);
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-test",
            "/tools/workbench/list_tabs",
            json!({ "scope": "all" }),
        ),
    );
    assert!(
        output["content"]
            .as_str()
            .unwrap()
            .contains("browser-tab-1")
    );
    let read = backend
        .call_agent_method("agent.session.read", json!({ "sessionId": session_id }))
        .expect("read session");
    assert_eq!(read["tools"][0]["name"], "workbench");
    assert_eq!(read["tools"][0]["status"], "completed");
}
#[test]
fn terminal_host_tool_runtime_cancellation_includes_tool_call_id() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Terminal Tool Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let captured_payload = Arc::new(Mutex::new(None::<Value>));
    let captured_for_dispatch = captured_payload.clone();
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, payload| {
        assert_eq!(method, "terminal.read");
        let payload_value: Value = serde_json::from_str(&payload).expect("host payload json");
        *captured_for_dispatch.lock().expect("captured payload lock") = Some(payload_value);
        Ok(serde_json::to_string(&json!({
            "target": { "type": "private", "sessionId": "terminal-session-1" },
            "sessionId": "terminal-session-1",
            "cursor": "1",
            "output": "hello from terminal",
            "running": true,
            "exitCode": null,
            "truncated": false
        }))
        .expect("json"))
    });
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-terminal-read",
            "/tools/terminal/read",
            json!({ "sessionId": "terminal-session-1" }),
        ),
    );
    assert!(
        output["content"]
            .as_str()
            .expect("content")
            .contains("terminal-session-1")
    );
    assert_eq!(
        output
            .pointer("/raw/logArtifactRef/kind")
            .and_then(Value::as_str),
        Some("log")
    );
    assert!(
        output["artifactRefs"]
            .as_array()
            .is_some_and(|refs| refs.iter().any(|artifact| artifact["kind"] == "log"))
    );
    let captured = captured_payload
        .lock()
        .expect("captured payload lock")
        .clone()
        .expect("captured payload");
    assert_eq!(
        captured
            .pointer("/runtimeCancellation/sessionId")
            .and_then(Value::as_str),
        Some(session_id.as_str())
    );
    assert_eq!(
        captured
            .pointer("/runtimeCancellation/turnId")
            .and_then(Value::as_str),
        Some(turn_id.as_str())
    );
    assert_eq!(
        captured
            .pointer("/runtimeCancellation/toolCallId")
            .and_then(Value::as_str),
        Some("tool-terminal-read")
    );
}
#[test]
fn terminal_activity_summary_includes_full_output_path_for_projected_memory() {
    let summary = format_terminal_output(
        "read",
        &json!({
            "target": { "type": "private", "sessionId": "terminal-session-1" },
            "sessionId": "terminal-session-1",
            "cursor": "20000",
            "output": "projected output",
            "running": true,
            "exitCode": null,
            "truncated": true,
            "memory": {
                "outputTextPath": "/tmp/lyra/terminal-memory/sessions/terminal-session-1/outputs/session-output.txt",
                "truncatedByProjection": true
            }
        }),
    );
    assert!(summary.contains("private terminal terminal-session-1"));
    assert!(summary.contains(
        "fullOutputPath=/tmp/lyra/terminal-memory/sessions/terminal-session-1/outputs/session-output.txt"
    ));
    assert!(summary.contains("projected output"));
}

#[test]
fn terminal_activity_summary_includes_lifecycle_projection() {
    let summary = format_terminal_output(
        "wait",
        &json!({
            "target": { "type": "private", "sessionId": "terminal-session-1" },
            "sessionId": "terminal-session-1",
            "output": "",
            "running": true,
            "exitCode": null,
            "reason": "timeout",
            "lifecycle": {
                "sessionId": "terminal-session-1",
                "state": "waiting",
                "phase": "command_wait",
                "reason": "timeout",
                "terminalRunning": true,
                "commandId": "command-1",
                "commandStatus": "running",
                "exitCode": null,
                "waiting": true,
                "background": false
            }
        }),
    );

    assert!(summary.contains("lifecycle state=waiting phase=command_wait"));
    assert!(summary.contains("commandStatus=running"));
    assert!(summary.contains("commandId=command-1"));
}
#[test]
fn host_tool_ok_false_records_failed_activity() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Failed Tool Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, _payload| {
        assert_eq!(method, "lyraLumen.read");
        Ok(serde_json::to_string(&json!({
            "ok": false,
            "kind": "lyraLumenResult",
            "error": {
                "kind": "lyraLumenRuntimeError",
                "message": "frame script timed out after 8000ms"
            }
        }))
        .expect("json"))
    });
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-timeout",
            "/tools/browser/read",
            json!({ "tabId": "browser-tab-1" }),
        ),
    );
    assert_eq!(output["raw"]["ok"], false);
    let read = backend
        .call_agent_method("agent.session.read", json!({ "sessionId": session_id }))
        .expect("read session");
    assert_eq!(read["tools"][0]["name"], "lyra_lumen");
    assert_eq!(read["tools"][0]["status"], "failed");
}
#[test]
fn host_tool_timeout_finishes_activity() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Host Timeout Tool Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|_method, _payload| {
        std::thread::sleep(Duration::from_millis(2_000));
        Ok(serde_json::to_string(&json!({ "ok": true })).expect("json"))
    });
    let started = Instant::now();
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-timeout-hard-boundary",
            "/tools/workbench/list_tabs",
            json!({ "timeoutMs": 250 }),
        ),
    );
    assert!(started.elapsed() < Duration::from_secs(1));
    assert!(
        output["content"]
            .as_str()
            .unwrap_or_default()
            .contains("timed out")
    );
    assert_eq!(output["status"].as_str(), Some("failed"));
    assert_eq!(output["notRunReason"].as_str(), Some("timeout"));
    assert_eq!(
        output.pointer("/error/code").and_then(Value::as_str),
        Some("timeout")
    );
    assert!(
        output["changes"]
            .as_array()
            .is_none_or(|changes| changes.is_empty())
    );
    let read = backend
        .call_agent_method("agent.session.read", json!({ "sessionId": session_id }))
        .expect("read session");
    assert_eq!(read["tools"][0]["name"], "workbench");
    assert_eq!(read["tools"][0]["status"], "failed");
    assert!(read["tools"][0]["finishedAt"].is_string());
}

#[test]
fn tool_fs_large_raw_output_is_compacted_into_artifact_ref() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Large Raw Tool Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let large_blob = "x".repeat(40_000);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, _payload| {
        assert_eq!(method, "workbench.readTab");
        Ok(serde_json::to_string(&json!({
            "tab": {
                "tabId": "tab-1",
                "title": "Large Raw",
                "pageKind": "editor",
                "observationKind": "file"
            },
            "text": "Small model projection.",
            "largeBlob": large_blob
        }))
        .expect("json"))
    });
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-large-raw",
            "/tools/workbench/read_tab",
            json!({ "tabId": "tab-1" }),
        ),
    );
    assert_eq!(output["status"], "completed");
    assert_eq!(output["raw"]["kind"], "tool_fs_raw_ref");
    assert_eq!(output["raw"]["truncated"], true);
    assert_eq!(
        output.pointer("/dataRef/id").and_then(Value::as_str),
        output
            .pointer("/raw/artifactRef/id")
            .and_then(Value::as_str)
    );
    assert!(output["artifactRefs"].as_array().is_some_and(|refs| {
        refs.iter()
            .any(|artifact| artifact.get("id") == output.pointer("/dataRef/id"))
    }));
    assert!(
        output["content"]
            .as_str()
            .expect("content")
            .contains("Small model projection")
    );
    let data_ref_path = output
        .pointer("/dataRef/path")
        .and_then(Value::as_str)
        .expect("data ref path")
        .to_string();
    let data_ref_id = output
        .pointer("/dataRef/id")
        .and_then(Value::as_str)
        .expect("data ref id")
        .to_string();
    let artifact_read = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-large-raw-artifact-read",
            "/tools/runtime/artifact_read",
            json!({ "path": data_ref_path, "maxBytes": 128_000 }),
        ),
    );
    assert_eq!(artifact_read["status"], "completed");
    assert_eq!(
        artifact_read["toolPath"].as_str(),
        Some("/tools/runtime/artifact_read")
    );
    assert_eq!(
        artifact_read
            .pointer("/raw/artifactId")
            .and_then(Value::as_str),
        Some(data_ref_id.as_str())
    );
    assert!(
        artifact_read["content"]
            .as_str()
            .expect("artifact content")
            .contains("largeBlob")
    );
    assert!(
        artifact_read
            .pointer("/raw/bytesReturned")
            .and_then(Value::as_u64)
            .is_some_and(|bytes| bytes > 32_000)
    );
}

#[test]
fn tool_fs_large_content_projection_is_compacted_into_projection_ref() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Large Projection Tool Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let large_text = "projection ".repeat(4_000);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, _payload| {
        assert_eq!(method, "workbench.readTab");
        Ok(serde_json::to_string(&json!({
            "tab": {
                "tabId": "tab-1",
                "title": "Large Projection",
                "pageKind": "editor",
                "observationKind": "file"
            },
            "text": large_text
        }))
        .expect("json"))
    });
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-large-projection",
            "/tools/workbench/read_tab",
            json!({ "tabId": "tab-1" }),
        ),
    );
    assert_eq!(output["status"], "completed");
    assert!(
        output["content"]
            .as_str()
            .expect("content")
            .ends_with("[truncated]")
    );
    assert!(
        output
            .pointer("/projectionRef/id")
            .and_then(Value::as_str)
            .is_some()
    );
    assert!(output["artifactRefs"].as_array().is_some_and(|refs| {
        refs.iter()
            .any(|artifact| artifact.get("id") == output.pointer("/projectionRef/id"))
    }));
}

mod host_and_browser;
mod native_and_git;
mod permissions_and_flows;
