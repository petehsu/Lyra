use super::*;

pub(crate) fn start_selfdev(payload: Value) -> AgentRuntimeResult<Value> {
    let prompt = string_opt(&payload, "prompt");
    let parent = string_opt(&payload, "parentSessionId");
    let target = string_opt(&payload, "target").unwrap_or_else(|| "general".to_string());
    let repo_root = string_opt(&payload, "repoRoot")
        .or_else(|| string_opt(&payload, "repoDir"))
        .unwrap_or_else(current_working_dir);
    let inherit_context = payload
        .get("inheritContext")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let selfdev = new_selfdev_state(target, repo_root.clone());
    let mut session = new_session(
        Some("Lyra Self Development".to_string()),
        Some(repo_root.clone()),
        "selfdev",
    );
    session.snapshot["selfdev"] = json!(selfdev.clone());
    if inherit_context
        && let Some(parent_id) = parent
        && let Ok(state) = state().lock()
        && let Some(parent_session) = state.sessions.get(&parent_id)
        && let Some(messages) = parent_session.snapshot.get("messages").cloned()
    {
        session.snapshot["messages"] = messages;
    }
    let snapshot = session.snapshot.clone();
    let session_id = session.id.clone();
    {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        state.active_session_id = Some(session_id.clone());
        state.sessions.insert(session_id.clone(), session);
        state.save_state()?;
    }
    let mut response = json!({
        "sessionId": session_id,
        "repoDir": repo_root,
        "snapshot": snapshot,
        "turnId": Value::Null,
        "status": "idle",
        "inheritedContext": inherit_context,
        "selfdev": selfdev
    });
    if let Some(prompt) = prompt.filter(|value| !value.trim().is_empty()) {
        let turn = send_turn(json!({ "sessionId": session_id, "text": prompt }))?;
        response["turnId"] = turn.get("turnId").cloned().unwrap_or(Value::Null);
        response["status"] = Value::String("running".to_string());
    }
    Ok(response)
}

pub(crate) fn selfdev_status(payload: Value) -> AgentRuntimeResult<Value> {
    let id = string_opt(&payload, "sessionId");
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let id = state.resolve_session_id(id)?;
    let session = state
        .sessions
        .get(&id)
        .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {id}")))?;
    let title = session
        .snapshot
        .get("title")
        .and_then(Value::as_str)
        .map(str::to_string);
    let selfdev = selfdev_state_for_session(session);
    let turn_status = session
        .snapshot
        .get("turnStatus")
        .and_then(Value::as_str)
        .unwrap_or("idle")
        .to_string();
    let active_turn_id = session
        .snapshot
        .get("activeTurnId")
        .cloned()
        .unwrap_or(Value::Null);
    let output = format!(
        "Self-dev session is {turn_status} for target {} in {}. Build status: {}; test status: {}.",
        selfdev.target, selfdev.repo_root, selfdev.build.status, selfdev.test.status
    );
    Ok(json!({
        "available": true,
        "repoDir": selfdev.repo_root.clone(),
        "sessionId": id,
        "output": output,
        "title": title,
        "metadata": {
            "runtime": "lyra-native",
            "mode": selfdev.mode.clone(),
            "target": selfdev.target.clone(),
            "repoRoot": selfdev.repo_root.clone(),
            "capabilities": selfdev.capabilities.clone(),
            "tasks": {
                "build": selfdev.build.clone(),
                "test": selfdev.test.clone(),
                "reload": selfdev.reload.clone(),
            },
            "turnStatus": turn_status,
            "activeTurnId": active_turn_id,
        }
    }))
}

pub(crate) fn new_selfdev_state(target: String, repo_root: String) -> SelfDevState {
    let timestamp = now();
    SelfDevState {
        mode: "selfdev".to_string(),
        target,
        repo_root,
        capabilities: selfdev_capabilities(),
        build: idle_selfdev_task(&timestamp),
        test: idle_selfdev_task(&timestamp),
        reload: idle_selfdev_task(&timestamp),
        started_at: timestamp.clone(),
        updated_at: timestamp,
    }
}

pub(crate) fn selfdev_state_for_session(session: &NativeSession) -> SelfDevState {
    session
        .snapshot
        .get("selfdev")
        .cloned()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_else(|| {
            let target = session
                .snapshot
                .get("selfdevTarget")
                .and_then(Value::as_str)
                .unwrap_or("general")
                .to_string();
            let repo_root = session
                .snapshot
                .get("workingDir")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(current_working_dir);
            new_selfdev_state(target, repo_root)
        })
}

pub(crate) fn idle_selfdev_task(timestamp: &str) -> SelfDevTaskState {
    SelfDevTaskState {
        status: "idle".to_string(),
        last_command: None,
        last_result: None,
        updated_at: timestamp.to_string(),
    }
}

pub(crate) fn selfdev_capabilities() -> Vec<SelfDevCapability> {
    vec![
        SelfDevCapability {
            id: "workspace_files".to_string(),
            label: "Workspace files".to_string(),
            kind: "file".to_string(),
            available: true,
            tool: "file_read,file_write,file_edit,apply_patch".to_string(),
        },
        SelfDevCapability {
            id: "workspace_shell".to_string(),
            label: "Workspace shell".to_string(),
            kind: "shell".to_string(),
            available: true,
            tool: "shell_run".to_string(),
        },
        SelfDevCapability {
            id: "git_state".to_string(),
            label: "Git state".to_string(),
            kind: "git".to_string(),
            available: true,
            tool: "shell_run git status/diff".to_string(),
        },
        SelfDevCapability {
            id: "runtime_reload".to_string(),
            label: "Lyra runtime reload".to_string(),
            kind: "reload".to_string(),
            available: true,
            tool: "native_runtime_reload".to_string(),
        },
    ]
}

pub(crate) fn goals(method: &str, payload: Value) -> AgentRuntimeResult<Value> {
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let session_id = state.resolve_session_id(string_opt(&payload, "sessionId"))?;
    let focused_goal_id = match method {
        "agent.goals.create" => {
            let goal = create_goal_record(&session_id, &payload, &state);
            let id = goal.id.clone();
            sync_goal_to_shared_memory(&state, &goal)?;
            state.goals.insert(id.clone(), goal);
            state.focused_goal_id = Some(id.clone());
            Some(id)
        }
        "agent.goals.update" => {
            let goal_id = string_opt(&payload, "goalId")
                .or_else(|| state.focused_goal_id.clone())
                .unwrap_or_else(|| ensure_session_goal(&mut state, &session_id));
            let updated = update_goal_record(&mut state, &goal_id, &payload)?;
            sync_goal_to_shared_memory(&state, &updated)?;
            state.focused_goal_id = Some(goal_id.clone());
            Some(goal_id)
        }
        "agent.goals.checkpoint" => {
            let goal_id = string_opt(&payload, "goalId")
                .or_else(|| state.focused_goal_id.clone())
                .unwrap_or_else(|| ensure_session_goal(&mut state, &session_id));
            checkpoint_goal_record(&mut state, &goal_id, &payload)?;
            state.focused_goal_id = Some(goal_id.clone());
            Some(goal_id)
        }
        "agent.goals.open" | "agent.goals.show" => {
            let goal_id = string_opt(&payload, "goalId")
                .or_else(|| state.focused_goal_id.clone())
                .unwrap_or_else(|| ensure_session_goal(&mut state, &session_id));
            state.focused_goal_id = Some(goal_id.clone());
            Some(goal_id)
        }
        "agent.goals.resume" => {
            let goal_id = string_opt(&payload, "goalId")
                .or_else(|| state.focused_goal_id.clone())
                .unwrap_or_else(|| ensure_session_goal(&mut state, &session_id));
            let updated = update_goal_status(&mut state, &goal_id, "active")?;
            sync_goal_to_shared_memory(&state, &updated)?;
            state.focused_goal_id = Some(goal_id.clone());
            Some(goal_id)
        }
        _ => {
            if state
                .goals
                .values()
                .all(|goal| goal.session_id.as_deref() != Some(&session_id))
            {
                Some(ensure_session_goal(&mut state, &session_id))
            } else {
                state.focused_goal_id.clone()
            }
        }
    };
    let focused_goal = focused_goal_id
        .as_ref()
        .and_then(|id| state.goals.get(id))
        .cloned();
    let side_panel = focused_goal
        .as_ref()
        .map(goal_side_panel)
        .unwrap_or_else(empty_side_panel);
    if matches!(
        method,
        "agent.goals.open"
            | "agent.goals.show"
            | "agent.goals.resume"
            | "agent.goals.create"
            | "agent.goals.update"
            | "agent.goals.checkpoint"
    ) && let Some(session) = state.sessions.get_mut(&session_id)
    {
        session.snapshot["sidePanel"] = side_panel.clone();
        touch_session(session);
    }
    let goals = state
        .goals
        .values()
        .filter(|goal| goal.session_id.as_deref() == Some(&session_id) || goal.session_id.is_none())
        .cloned()
        .map(goal_json)
        .collect::<Vec<_>>();
    state.save_state()?;
    Ok(json!({
        "sessionId": session_id,
        "goals": goals,
        "focusedGoal": focused_goal.map(|goal| goal_json(goal)).unwrap_or(Value::Null),
        "sidePanel": side_panel
    }))
}

pub(crate) fn create_goal_record(
    session_id: &str,
    payload: &Value,
    state: &NativeRuntimeState,
) -> LyraGoal {
    let created_at = now();
    let session = state.sessions.get(session_id);
    let title = string_opt(payload, "title")
        .or_else(|| {
            session
                .and_then(|session| session.snapshot.get("title"))
                .and_then(Value::as_str)
                .map(|title| format!("{title} Goal"))
        })
        .unwrap_or_else(|| "Lyra Goal".to_string());
    let scope = string_opt(payload, "scope").or_else(|| {
        session
            .and_then(|session| session.snapshot.get("workingDir"))
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    LyraGoal {
        id: format!("goal-{}", Uuid::new_v4()),
        title,
        status: string_opt(payload, "status").unwrap_or_else(|| "active".to_string()),
        scope,
        session_id: Some(session_id.to_string()),
        description: string_opt(payload, "description"),
        created_at: created_at.clone(),
        updated_at: created_at,
        checkpoints: Vec::new(),
    }
}

pub(crate) fn ensure_session_goal(state: &mut NativeRuntimeState, session_id: &str) -> String {
    if let Some(goal) = state
        .goals
        .values()
        .find(|goal| goal.session_id.as_deref() == Some(session_id))
    {
        return goal.id.clone();
    }
    let goal = create_goal_record(session_id, &json!({ "title": "Current Session" }), state);
    let id = goal.id.clone();
    let _ = sync_goal_to_shared_memory(state, &goal);
    state.goals.insert(id.clone(), goal);
    id
}

pub(crate) fn update_goal_record(
    state: &mut NativeRuntimeState,
    goal_id: &str,
    payload: &Value,
) -> AgentRuntimeResult<LyraGoal> {
    let goal = state
        .goals
        .get_mut(goal_id)
        .ok_or_else(|| AgentRuntimeError::Core(format!("goal not found: {goal_id}")))?;
    if let Some(title) = string_opt(payload, "title") {
        goal.title = title;
    }
    if let Some(status) = string_opt(payload, "status") {
        goal.status = status;
    }
    if let Some(scope) = string_opt(payload, "scope") {
        goal.scope = Some(scope);
    }
    if let Some(description) = string_opt(payload, "description") {
        goal.description = Some(description);
    }
    goal.updated_at = now();
    Ok(goal.clone())
}

pub(crate) fn update_goal_status(
    state: &mut NativeRuntimeState,
    goal_id: &str,
    status: &str,
) -> AgentRuntimeResult<LyraGoal> {
    let goal = state
        .goals
        .get_mut(goal_id)
        .ok_or_else(|| AgentRuntimeError::Core(format!("goal not found: {goal_id}")))?;
    goal.status = status.to_string();
    goal.updated_at = now();
    goal.checkpoints.push(json!({
        "kind": "resume",
        "createdAt": goal.updated_at,
    }));
    Ok(goal.clone())
}

pub(crate) fn checkpoint_goal_record(
    state: &mut NativeRuntimeState,
    goal_id: &str,
    payload: &Value,
) -> AgentRuntimeResult<()> {
    let goal = state
        .goals
        .get_mut(goal_id)
        .ok_or_else(|| AgentRuntimeError::Core(format!("goal not found: {goal_id}")))?;
    let timestamp = now();
    goal.checkpoints.push(json!({
        "kind": string_opt(payload, "kind").unwrap_or_else(|| "checkpoint".to_string()),
        "summary": string_opt(payload, "summary"),
        "payload": payload.get("payload").cloned().unwrap_or(Value::Null),
        "createdAt": timestamp,
    }));
    goal.updated_at = timestamp;
    Ok(())
}

pub(crate) fn sync_goal_to_shared_memory(
    state: &NativeRuntimeState,
    goal: &LyraGoal,
) -> AgentRuntimeResult<()> {
    let content = json!({
        "goalId": goal.id.clone(),
        "title": goal.title.clone(),
        "status": goal.status.clone(),
        "scope": goal.scope.clone(),
        "description": goal.description.clone(),
        "source": "goal_state",
    });
    let existing = list_long_term_memory(
        &state.root,
        MemoryQuery {
            query: Some(goal.id.clone()),
            category: Some("goal".to_string()),
            include_archived: true,
            limit: 10,
            ..MemoryQuery::default()
        },
    )?
    .into_iter()
    .find(|record| record.content.get("goalId").and_then(Value::as_str) == Some(goal.id.as_str()));
    if let Some(record) = existing {
        update_long_term_memory(
            &state.root,
            MemoryMutation {
                id: Some(record.id),
                scope: goal.scope.clone().or_else(|| Some("goal".to_string())),
                category: Some("goal".to_string()),
                fact: Some(goal.title.clone()),
                content: Some(content),
                confidence: Some(1.0),
                source_type: Some("goal_sync".to_string()),
                status: Some("active".to_string()),
                priority: Some(90),
                ..MemoryMutation::default()
            },
        )?;
    } else {
        create_long_term_memory(
            &state.root,
            MemoryMutation {
                scope: goal.scope.clone().or_else(|| Some("goal".to_string())),
                category: Some("goal".to_string()),
                fact: Some(goal.title.clone()),
                content: Some(content),
                confidence: Some(1.0),
                source_type: Some("goal_sync".to_string()),
                source_ref: Some(goal.id.clone()),
                status: Some("active".to_string()),
                priority: Some(90),
                ..MemoryMutation::default()
            },
        )?;
    }
    Ok(())
}

pub(crate) fn goal_json(goal: LyraGoal) -> Value {
    json!({
        "id": goal.id,
        "title": goal.title,
        "status": goal.status,
        "scope": goal.scope,
        "sessionId": goal.session_id,
        "description": goal.description,
        "createdAt": goal.created_at,
        "updatedAt": goal.updated_at,
        "checkpoints": goal.checkpoints,
    })
}

pub(crate) fn goal_side_panel(goal: &LyraGoal) -> Value {
    let checkpoints = if goal.checkpoints.is_empty() {
        "No checkpoints yet.".to_string()
    } else {
        goal.checkpoints
            .iter()
            .enumerate()
            .map(|(index, checkpoint)| {
                format!(
                    "{}. {}",
                    index + 1,
                    serde_json::to_string_pretty(checkpoint).unwrap_or_default()
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let content = format!(
        "## {}\n\nStatus: {}\n\nScope: {}\n\n{}\n\n### Checkpoints\n\n{}",
        goal.title,
        goal.status,
        goal.scope.as_deref().unwrap_or("global"),
        goal.description.as_deref().unwrap_or(""),
        checkpoints
    );
    let page = json!({
        "id": format!("goal-page-{}", goal.id),
        "title": goal.title.clone(),
        "filePath": "",
        "format": "markdown",
        "source": "lyra-goals",
        "content": content,
        "updatedAtMs": iso_ms(&goal.updated_at),
    });
    json!({
        "focusedPageId": page["id"],
        "pages": [page]
    })
}

pub(crate) fn start_overnight(payload: Value) -> AgentRuntimeResult<Value> {
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let parent_session_id = state.resolve_session_id(string_opt(&payload, "sessionId"))?;
    let parent = state
        .sessions
        .get(&parent_session_id)
        .cloned()
        .ok_or_else(|| {
            AgentRuntimeError::Core(format!("session not found: {parent_session_id}"))
        })?;
    let run_id = format!("overnight-{}", Uuid::new_v4());
    let started = now();
    let mission = string_opt(&payload, "mission")
        .unwrap_or_else(|| "Continue current Lyra task.".to_string());
    let inherit_context = payload
        .get("inheritContext")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let duration_minutes = payload
        .get("durationMinutes")
        .and_then(Value::as_i64)
        .unwrap_or(240)
        .max(1);
    let target_wake = (Utc::now() + chrono::Duration::minutes(duration_minutes))
        .to_rfc3339_opts(SecondsFormat::Millis, true);
    let working_dir = parent
        .snapshot
        .get("workingDir")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(current_working_dir);
    let mut coordinator = new_session(
        Some(format!("Overnight: {mission}")),
        Some(working_dir.clone()),
        "overnight",
    );
    if inherit_context && let Some(messages) = parent.snapshot.get("messages").cloned() {
        coordinator.snapshot["messages"] = messages;
    }
    coordinator.snapshot["overnight"] = json!({
        "runId": run_id.clone(),
        "mission": mission.clone(),
        "parentSessionId": parent_session_id.clone(),
        "status": "running",
    });
    let coordinator_snapshot = coordinator.snapshot.clone();
    let coordinator_session_id = coordinator.id.clone();
    let run_dir = state.root.join("overnight").join(&run_id);
    let _ = fs::create_dir_all(&run_dir);
    let log_path = run_dir.join("log.md");
    let review_path = run_dir.join("review.html");
    let run = json!({
        "runId": run_id.clone(),
        "parentSessionId": parent_session_id.clone(),
        "coordinatorSessionId": coordinator_session_id.clone(),
        "coordinatorSessionName": coordinator_snapshot.get("title").cloned().unwrap_or_else(|| Value::String("Lyra Overnight".to_string())),
        "status": "running",
        "mission": mission.clone(),
        "workingDir": working_dir.clone(),
        "providerName": provider_label(&state.config),
        "model": state.config.default_model.clone(),
        "startedAt": started.clone(),
        "targetWakeAt": target_wake.clone(),
        "handoffReadyAt": started.clone(),
        "postWakeGraceUntil": target_wake.clone(),
        "lastActivityAt": started.clone(),
        "completedAt": Value::Null,
        "cancelRequestedAt": Value::Null,
        "runDir": run_dir.display().to_string(),
        "logPath": log_path.display().to_string(),
        "reviewPath": review_path.display().to_string(),
        "manifest": {
            "schemaVersion": 1,
            "runtime": "lyra-native",
            "durationMinutes": duration_minutes
        },
        "progress": {
            "phase": "coordinating",
            "timeRemainingLabel": format!("{duration_minutes}m"),
            "taskSummary": { "total": 1, "completed": 0 }
        },
        "events": [{
            "kind": "run_started",
            "summary": "Overnight coordinator started.",
            "timestamp": started.clone()
        }],
        "taskCards": [{
            "id": "task-1",
            "title": "Review current session context",
            "status": "running"
        }],
        "statusMarkdown": "Overnight coordinator is running in the background.",
        "logMarkdown": format!("# Overnight Run\n\nMission: {mission}\n\n- Started native coordinator."),
        "reviewHtml": Value::Null,
        "coordinatorSnapshot": coordinator_snapshot
    });
    state
        .sessions
        .insert(coordinator_session_id.clone(), coordinator);
    state.overnight_runs.insert(run_id.clone(), run.clone());
    state.save_state()?;
    thread::spawn(move || run_overnight_worker(run_id));
    Ok(json!({ "run": run, "inheritedContext": inherit_context }))
}

pub(crate) fn list_overnight() -> AgentRuntimeResult<Value> {
    let state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let mut runs = state.overnight_runs.values().cloned().collect::<Vec<_>>();
    runs.sort_by(|left, right| {
        right
            .get("startedAt")
            .and_then(Value::as_str)
            .cmp(&left.get("startedAt").and_then(Value::as_str))
    });
    let latest_run_id = runs
        .first()
        .and_then(|run| run.get("runId"))
        .and_then(Value::as_str)
        .map(str::to_string);
    Ok(json!({ "runs": runs, "latestRunId": latest_run_id }))
}

pub(crate) fn read_overnight(payload: Value) -> AgentRuntimeResult<Value> {
    let state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let run_id = string_opt(&payload, "runId").or_else(|| {
        state
            .overnight_runs
            .values()
            .max_by_key(|run| run.get("startedAt").and_then(Value::as_str).unwrap_or(""))
            .and_then(|run| run.get("runId"))
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    let run = run_id.and_then(|id| {
        state.overnight_runs.get(&id).cloned().map(|mut run| {
            if run.get("status").and_then(Value::as_str) == Some("completed")
                && run.get("reviewHtml").and_then(Value::as_str).is_none()
            {
                run["reviewHtml"] = Value::String(
                    "<h1>Overnight Review</h1><p>Native overnight coordinator completed.</p>"
                        .to_string(),
                );
            }
            run
        })
    });
    Ok(json!({ "run": run }))
}

pub(crate) fn cancel_overnight(payload: Value) -> AgentRuntimeResult<Value> {
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let run_id = string_opt(&payload, "runId").or_else(|| {
        state
            .overnight_runs
            .values()
            .max_by_key(|run| run.get("startedAt").and_then(Value::as_str).unwrap_or(""))
            .and_then(|run| run.get("runId"))
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    let run = run_id.and_then(|id| {
        let run = state.overnight_runs.get_mut(&id)?;
        run["status"] = Value::String("cancelled".to_string());
        run["cancelRequestedAt"] = Value::String(now());
        run["lastActivityAt"] = Value::String(now());
        run["progress"] = json!({
            "phase": "cancelled",
            "timeRemainingLabel": "0m",
            "taskSummary": { "total": 1, "completed": 0 }
        });
        run["taskCards"] = json!([{
            "id": "task-1",
            "title": "Review current session context",
            "status": "cancelled"
        }]);
        run["statusMarkdown"] =
            Value::String("Overnight coordinator was cancelled before completion.".to_string());
        run["events"].as_array_mut().map(|events| {
            events.push(json!({
                "kind": "cancel_requested",
                "summary": "Cancellation requested by user.",
                "timestamp": now(),
            }))
        });
        Some(run.clone())
    });
    state.save_state()?;
    Ok(json!({ "run": run }))
}

pub(crate) fn run_overnight_worker(run_id: String) {
    thread::sleep(Duration::from_millis(50));
    if let Ok(mut state) = state().lock() {
        if let Some(run) = state.overnight_runs.get_mut(&run_id) {
            if run.get("status").and_then(Value::as_str) != Some("running") {
                let _ = state.save_state();
                return;
            }
            let completed = now();
            run["status"] = Value::String("completed".to_string());
            run["completedAt"] = Value::String(completed.clone());
            run["lastActivityAt"] = Value::String(completed.clone());
            run["progress"] = json!({
                "phase": "completed",
                "timeRemainingLabel": "0m",
                "taskSummary": { "total": 1, "completed": 1 }
            });
            run["taskCards"] = json!([{
                "id": "task-1",
                "title": "Review current session context",
                "status": "completed"
            }]);
            run["statusMarkdown"] =
                Value::String("Overnight coordinator completed the native handoff.".to_string());
            run["reviewHtml"] = Value::String(
                "<h1>Overnight Review</h1><p>Native overnight coordinator completed.</p>"
                    .to_string(),
            );
            push_array(
                run,
                "events",
                json!({
                    "kind": "run_completed",
                    "summary": "Native overnight coordinator completed.",
                    "timestamp": completed,
                }),
            );
        }
        let _ = state.save_state();
    }
}
