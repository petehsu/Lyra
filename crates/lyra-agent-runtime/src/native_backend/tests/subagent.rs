use super::*;
use std::collections::HashMap;

#[test]
fn new_session_has_no_mode_or_oma_fields() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method("agent.session.create", json!({ "title": "Plain" }))
        .expect("create session");
    assert!(created.get("agentMode").is_none());
    assert!(created.get("oma").is_none());
    assert_eq!(created["sessionKind"], "normal");
}

#[test]
fn sanitize_session_snapshot_drops_legacy_oma_fields() {
    let mut snapshot = json!({
        "id": "session-1",
        "agentMode": "oma",
        "oma": { "activeChannelId": "group:default" },
        "modeContexts": { "solo": {} },
        "sessionKind": "normal"
    });
    sanitize_session_snapshot(&mut snapshot);
    assert!(snapshot.get("agentMode").is_none());
    assert!(snapshot.get("oma").is_none());
    assert!(snapshot.get("modeContexts").is_none());
}

#[test]
fn list_sessions_hides_subagent_children() {
    let backend = LyraAgentBackend;
    let parent = backend
        .call_agent_method("agent.session.create", json!({ "title": "Parent" }))
        .expect("create parent");
    let parent_id = parent["id"].as_str().expect("parent id").to_string();
    let child_id = {
        let mut state = state().lock().expect("state lock");
        let mut child = new_session(Some("worker".to_string()), None, SUBAGENT_SESSION_KIND);
        let child_id = child.id.clone();
        child.snapshot["parentSessionId"] = json!(parent_id);
        child.snapshot["subagent"] = json!({ "type": "explore", "origin": "spawn" });
        state.sessions.insert(child_id.clone(), child);
        child_id
    };
    let listed = backend
        .call_agent_method("agent.session.list", json!({}))
        .expect("list sessions");
    let ids = listed["sessions"]
        .as_array()
        .expect("sessions")
        .iter()
        .filter_map(|session| session.get("id").and_then(Value::as_str))
        .collect::<Vec<_>>();
    assert!(ids.contains(&parent_id.as_str()));
    assert!(!ids.contains(&child_id.as_str()));
}

#[test]
fn nested_agent_tool_is_denied() {
    let backend = LyraAgentBackend;
    let parent = backend
        .call_agent_method("agent.session.create", json!({ "title": "Host" }))
        .expect("create parent");
    let parent_id = parent["id"].as_str().expect("parent id").to_string();
    let child_id = {
        let mut state = state().lock().expect("state lock");
        let mut child = new_session(Some("nested".to_string()), None, SUBAGENT_SESSION_KIND);
        let child_id = child.id.clone();
        child.snapshot["parentSessionId"] = json!(parent_id);
        child.snapshot["subagent"] = json!({ "type": "generalPurpose", "origin": "spawn" });
        state.sessions.insert(child_id.clone(), child);
        child_id
    };
    let result = turn_engine::block_on(tool_agent(
        &child_id,
        "turn-test",
        "call-test",
        &json!({
            "description": "nested",
            "prompt": "Do not spawn."
        }),
    ));
    let error = result.expect_err("nested spawn denied");
    assert_eq!(error.code, "nested_agent_denied");
}

#[test]
fn goal_continuation_skips_numbered_todos_on_parent() {
    let snapshot = json!({ "sessionKind": "normal" });
    let todos = vec![
        json!({ "id": "a", "status": "pending", "content": "main" }),
        json!({ "id": "b", "status": "pending", "content": "worker", "agent": 1 }),
    ];
    let incomplete = goal_incomplete_for_session(&snapshot, &todos);
    assert_eq!(incomplete.len(), 1);
    assert_eq!(incomplete[0]["id"], "a");

    let worker = json!({
        "sessionKind": SUBAGENT_SESSION_KIND,
        "subagent": { "origin": "todo", "agent": 1 }
    });
    let worker_incomplete = goal_incomplete_for_session(&worker, &todos);
    assert_eq!(worker_incomplete.len(), 1);
    assert_eq!(worker_incomplete[0]["id"], "b");
}

#[test]
fn todo_write_dispatches_one_worker_per_agent_number() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method("agent.session.create", json!({ "title": "Dispatch" }))
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    {
        let mut state = state().lock().expect("state lock");
        let session = state.sessions.get_mut(&session_id).expect("session");
        session.snapshot["plan"] = json!({
            "activePlanId": "plan-1",
            "activeVersionId": "plan-1",
            "phase": PLAN_PHASE_EXECUTING_TODO,
            "markdown": "# Ship it"
        });
        session.snapshot["projectTodo"] = json!({
            "todoListId": "todo-list-1",
            "planId": "plan-1",
            "versionId": "plan-1",
            "status": "running",
            "todos": []
        });
    }
    tool_todo_write(
        &session_id,
        "turn-dispatch",
        &json!({
            "todos": [
                { "content": "unnumbered stays with parent" },
                { "content": "worker one a", "agent": 1 },
                { "content": "worker one b", "agent": 1 },
                { "content": "worker two", "agent": 2 }
            ]
        }),
    )
    .expect("todo write");
    let snapshot = {
        let state = state().lock().expect("state lock");
        state
            .sessions
            .get(&session_id)
            .expect("session")
            .snapshot
            .clone()
    };
    let children = snapshot["subagents"].as_array().expect("subagents");
    assert_eq!(children.len(), 2);
    let agents = children
        .iter()
        .filter_map(|child| child.get("agent").and_then(Value::as_u64))
        .collect::<Vec<_>>();
    assert!(agents.contains(&1));
    assert!(agents.contains(&2));
    let listed = backend
        .call_agent_method("agent.session.list", json!({}))
        .expect("list");
    let listed_ids = listed["sessions"]
        .as_array()
        .expect("sessions")
        .iter()
        .filter_map(|session| session.get("id").and_then(Value::as_str))
        .collect::<Vec<_>>();
    for child in children {
        let id = child["id"].as_str().expect("child id");
        assert!(!listed_ids.contains(&id));
        let child_session = {
            let state = state().lock().expect("state lock");
            state.sessions.get(id).expect("child").snapshot.clone()
        };
        assert_eq!(child_session["sessionKind"], SUBAGENT_SESSION_KIND);
        assert_eq!(child_session["parentSessionId"], session_id);
        assert_eq!(child_session["subagent"]["origin"], "todo");
    }
}

#[test]
fn explore_tools_exclude_mutations_and_spawn() {
    let snapshot = json!({
        "sessionKind": SUBAGENT_SESSION_KIND,
        "subagent": { "type": "explore", "origin": "spawn" }
    });
    let tools = filter_tools_for_session(
        &snapshot,
        vec![
            function_tool(AGENT_SPAWN_MODEL_TOOL, "spawn", json!({})),
            function_tool("read_file", "read", json!({})),
            function_tool("write_file", "write", json!({})),
            function_tool("grep", "grep", json!({})),
        ],
    );
    let names = tools
        .iter()
        .filter_map(|tool| tool.pointer("/function/name").and_then(Value::as_str))
        .collect::<Vec<_>>();
    assert_eq!(names, vec!["read_file", "grep"]);
}

#[test]
fn stop_on_idle_subagent_reports_idle() {
    let backend = LyraAgentBackend;
    let parent = backend
        .call_agent_method("agent.session.create", json!({ "title": "Host" }))
        .expect("create parent");
    let parent_id = parent["id"].as_str().expect("parent id").to_string();
    let child_id = {
        let mut state = state().lock().expect("state lock");
        let mut child = new_session(Some("idle-worker".to_string()), None, SUBAGENT_SESSION_KIND);
        let child_id = child.id.clone();
        child.snapshot["parentSessionId"] = json!(parent_id);
        child.snapshot["subagent"] = json!({ "type": "explore", "origin": "spawn" });
        state.sessions.insert(child_id.clone(), child);
        child_id
    };
    let result = turn_engine::block_on(tool_agent(
        &parent_id,
        "turn-stop",
        "call-stop",
        &json!({
            "stop": true,
            "subagent_id": child_id,
            "prompt": "unused"
        }),
    ));
    let error = result.expect_err("idle stop");
    assert_eq!(error.code, "subagent_idle");
}

#[test]
fn parent_index_marks_child_idle_after_finish() {
    let backend = LyraAgentBackend;
    let parent = backend
        .call_agent_method("agent.session.create", json!({ "title": "Host" }))
        .expect("create parent");
    let parent_id = parent["id"].as_str().expect("parent id").to_string();
    let child_id = {
        let mut state = state().lock().expect("state lock");
        let mut child = new_session(Some("worker".to_string()), None, SUBAGENT_SESSION_KIND);
        let child_id = child.id.clone();
        child.snapshot["parentSessionId"] = json!(parent_id);
        child.snapshot["subagent"] = json!({ "type": "explore", "origin": "spawn" });
        state.sessions.insert(child_id.clone(), child);
        remember_child(&mut state, &parent_id, &child_id, "Explore docs", "explore");
        child_id
    };
    {
        let state = state().lock().expect("state lock");
        let parent = state.sessions.get(&parent_id).expect("parent");
        assert_eq!(parent.snapshot["subagents"][0]["status"], "running");
    }
    mark_child_status(&parent_id, &child_id, "idle");
    let state = state().lock().expect("state lock");
    let parent = state.sessions.get(&parent_id).expect("parent");
    assert_eq!(parent.snapshot["subagents"][0]["status"], "idle");
}

#[test]
fn child_progress_mirrors_into_the_parent_agent_tool() {
    let backend = LyraAgentBackend;
    let parent = backend
        .call_agent_method("agent.session.create", json!({ "title": "Host" }))
        .expect("create parent");
    let parent_id = parent["id"].as_str().expect("parent id").to_string();
    let child_id = {
        let mut state = state().lock().expect("state lock");
        let mut child = new_session(Some("worker".to_string()), None, SUBAGENT_SESSION_KIND);
        let child_id = child.id.clone();
        child.snapshot["parentSessionId"] = json!(parent_id);
        child.snapshot["subagent"] = json!({
            "type": "explore",
            "origin": "spawn",
            "parentToolCallId": "call-explore",
            "parentTurnId": "turn-1",
            "background": true,
            "description": "Explore docs"
        });
        child.snapshot["messages"] = json!([
            { "id": "m1", "role": "user", "text": "brief" },
            { "id": "m2", "role": "assistant", "text": "正在查看目录。" }
        ]);
        if let Some(parent) = state.sessions.get_mut(&parent_id) {
            parent.snapshot["tools"] = json!([{
                "id": "call-explore",
                "name": AGENT_SPAWN_MODEL_TOOL,
                "label": "Explore docs",
                "status": "running",
                "input": { "description": "Explore docs", "prompt": "look around" },
                "output": {
                    "content": "",
                    "raw": {
                        "subagentId": child_id,
                        "status": "running",
                        "background": true
                    }
                }
            }]);
        }
        state.sessions.insert(child_id.clone(), child);
        child_id
    };
    mirror_child_progress(&child_id, "正在查看目录。");
    let state = state().lock().expect("state lock");
    let parent = state.sessions.get(&parent_id).expect("parent");
    let content = parent
        .snapshot
        .pointer("/tools/0/output/content")
        .and_then(Value::as_str)
        .unwrap_or_default();
    assert!(content.contains("正在查看目录。"), "{content}");
    assert_eq!(parent.snapshot["tools"][0]["status"], "running");
    assert_eq!(
        parent.snapshot["tools"][0]["input"]["prompt"], "look around",
        "progress updates must not clobber the spawn brief"
    );
}

#[test]
fn agent_spawn_defaults_to_background() {
    let schema = agent_spawn_model_tool(None);
    let description = schema
        .pointer("/function/parameters/properties/run_in_background/description")
        .and_then(Value::as_str)
        .unwrap_or_default();
    assert!(description.contains("Defaults to true"), "{description}");
}

#[test]
fn agent_spawn_tool_does_not_ritualize_one_hire_per_corpus() {
    let schema = agent_spawn_model_tool(None);
    let description = schema
        .pointer("/function/description")
        .and_then(Value::as_str)
        .unwrap_or_default();
    assert!(
        !description.contains("hire one explore worker per corpus"),
        "{description}"
    );
    assert!(
        description.contains("Two places in play does not force two workers"),
        "{description}"
    );
    assert!(!description.contains("/tools/agent/hire"), "{description}");
    assert!(
        description.contains("not a lead-session survey"),
        "{description}"
    );
}

#[test]
fn worker_completion_envelope_keeps_a_long_report_and_skips_user_role() {
    let report = format!("{}license MIT", "finding ".repeat(3_200));
    assert!(report.chars().count() > 25_000);
    assert!(report.chars().count() < WORKER_REPORT_MAX_CHARS);
    let envelope =
        format_worker_completion_envelope("session-child", "survey zcode", "idle", &report);
    assert!(envelope.contains("license MIT"));
    assert!(envelope.contains("<lyra-worker-result"));
    assert!(!envelope.contains("[Worker report truncated"));
    assert!(!envelope.contains("Background workers updated"));
    let clipped = clip_worker_report(&format!("{}tail-key", "x".repeat(WORKER_REPORT_MAX_CHARS)));
    assert!(clipped.contains("[Worker report truncated; middle omitted.]"));
    assert!(clipped.contains("tail-key"));
}

#[test]
fn worker_completion_envelope_is_system_not_latest_user() {
    let backend = LyraAgentBackend;
    let parent = backend
        .call_agent_method("agent.session.create", json!({ "title": "Host" }))
        .expect("create parent");
    let parent_id = parent["id"].as_str().expect("parent id").to_string();
    let first_ask = "zcode是不是开源了";
    let child_id = {
        let mut state = state().lock().expect("state lock");
        let parent = state.sessions.get_mut(&parent_id).expect("parent");
        push_session_message(
            parent,
            json!({
                "id": "first-ask",
                "role": "user",
                "text": first_ask,
            }),
        );
        remember_child(
            &mut state,
            &parent_id,
            "session-child",
            "survey zcode",
            "explore",
        );
        "session-child".to_string()
    };
    let report = format!("{}license MIT", "section ".repeat(3_200));
    append_worker_completion_envelope(&parent_id, &child_id, "survey zcode", "idle", &report);
    let state = state().lock().expect("state lock");
    let parent = state.sessions.get(&parent_id).expect("parent");
    let messages = parent
        .snapshot
        .get("messages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    assert_eq!(first_live_user_id(&messages).as_deref(), Some("first-ask"));
    let completion = messages
        .iter()
        .find(|message| {
            message.pointer("/metadata/kind").and_then(Value::as_str) == Some("subagent-completion")
        })
        .expect("completion envelope");
    assert_eq!(completion["role"], "system");
    assert_eq!(completion["metadata"]["uiHidden"], true);
    assert!(
        completion["text"]
            .as_str()
            .unwrap_or_default()
            .contains("license MIT")
    );
    assert!(
        messages
            .iter()
            .filter(|message| message.get("role").and_then(Value::as_str) == Some("user"))
            .all(|message| message.get("text").and_then(Value::as_str) == Some(first_ask))
    );
}

#[test]
fn resume_idle_turn_does_not_append_a_user_message() {
    let backend = LyraAgentBackend;
    let parent = backend
        .call_agent_method("agent.session.create", json!({ "title": "Host" }))
        .expect("create parent");
    let parent_id = parent["id"].as_str().expect("parent id").to_string();
    {
        let mut state = state().lock().expect("state lock");
        let parent = state.sessions.get_mut(&parent_id).expect("parent");
        push_session_message(
            parent,
            json!({
                "id": "first-ask",
                "role": "user",
                "text": "zcode是不是开源了",
            }),
        );
        parent.snapshot["turnStatus"] = json!("running");
    }
    let result = resume_idle_turn(&parent_id).expect("resume busy");
    assert_eq!(result["sent"], false);
    let state = state().lock().expect("state lock");
    let parent = state.sessions.get(&parent_id).expect("parent");
    let users = parent
        .snapshot
        .get("messages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|message| message.get("role").and_then(Value::as_str) == Some("user"))
        .count();
    assert_eq!(users, 1);
}

#[test]
fn reap_dead_background_workers_settles_parent_cards_and_queues_continue() {
    let mut parent = new_session(Some("Parent".to_string()), None, "normal");
    let mut child = new_session(Some("Worker".to_string()), None, SUBAGENT_SESSION_KIND);
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
    child.snapshot["turnStatus"] = json!("cancelled");
    child.snapshot["activeTurnId"] = Value::Null;
    child.snapshot["messages"] = json!([{
        "role": "assistant",
        "text": "已搜到三家模型新闻。"
    }]);
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
            "content": "已搜到三家模型新闻。",
            "raw": {
                "subagentId": child_id,
                "background": true,
                "status": "running"
            }
        }
    }]);
    let mut sessions = HashMap::from([(parent_id.clone(), parent), (child_id.clone(), child)]);
    let recovery = reap_dead_background_workers(&mut sessions, &[child_id.clone()]);
    assert_eq!(recovery.continue_child_ids, vec![child_id.clone()]);
    assert_eq!(recovery.poke_parent_ids, vec![parent_id.clone()]);
    let parent = sessions.get(&parent_id).expect("parent");
    let tool = &parent.snapshot["tools"][0];
    assert_eq!(tool["status"], "cancelled");
    assert!(
        tool.pointer("/output/content")
            .and_then(Value::as_str)
            .is_some_and(|content| content.contains("已搜到三家模型新闻。")
                && content.contains("continuing the assigned todos"))
    );
    assert_eq!(parent.snapshot["subagents"][0]["status"], "interrupted");
}

#[test]
fn reap_dead_background_workers_does_not_poke_finished_or_stale_parents() {
    let mut finished_parent = new_session(Some("Finished host".to_string()), None, "normal");
    let mut finished_child = new_session(Some("Done".to_string()), None, SUBAGENT_SESSION_KIND);
    let finished_parent_id = finished_parent.id.clone();
    let finished_child_id = finished_child.id.clone();
    finished_child.snapshot["parentSessionId"] = json!(finished_parent_id);
    finished_child.snapshot["subagent"] = json!({
        "type": "generalPurpose",
        "origin": "spawn",
        "parentTurnId": "turn-old",
        "parentToolCallId": "agent-done",
        "background": true,
        "description": "old survey"
    });
    finished_child.snapshot["turnStatus"] = json!("idle");
    finished_child.snapshot["activeTurnId"] = Value::Null;
    finished_parent.snapshot["turnStatus"] = json!("idle");
    finished_parent.snapshot["subagents"] = json!([{
        "id": finished_child_id,
        "description": "old survey",
        "type": "generalPurpose",
        "origin": "spawn",
        "status": "completed"
    }]);
    finished_parent.snapshot["tools"] = json!([{
        "id": "agent-done",
        "name": AGENT_SPAWN_MODEL_TOOL,
        "status": "completed",
        "output": {
            "raw": {
                "subagentId": finished_child_id,
                "background": true,
                "status": "completed"
            }
        }
    }]);

    let mut stale_parent = new_session(Some("Stale host".to_string()), None, "normal");
    let mut stale_child = new_session(Some("Leftover".to_string()), None, SUBAGENT_SESSION_KIND);
    let stale_parent_id = stale_parent.id.clone();
    let stale_child_id = stale_child.id.clone();
    stale_child.snapshot["parentSessionId"] = json!(stale_parent_id);
    stale_child.snapshot["subagent"] = json!({
        "type": "generalPurpose",
        "origin": "spawn",
        "parentTurnId": "turn-stale",
        "parentToolCallId": "agent-stale",
        "background": true,
        "description": "stale card"
    });
    stale_child.snapshot["turnStatus"] = json!("idle");
    stale_child.snapshot["activeTurnId"] = Value::Null;
    stale_parent.snapshot["turnStatus"] = json!("idle");
    stale_parent.snapshot["subagents"] = json!([{
        "id": stale_child_id,
        "description": "stale card",
        "type": "generalPurpose",
        "origin": "spawn",
        "status": "running"
    }]);
    stale_parent.snapshot["tools"] = json!([{
        "id": "agent-stale",
        "name": AGENT_SPAWN_MODEL_TOOL,
        "status": "running",
        "output": {
            "raw": {
                "subagentId": stale_child_id,
                "background": true,
                "status": "running"
            }
        }
    }]);

    let mut sessions = HashMap::from([
        (finished_parent_id.clone(), finished_parent),
        (finished_child_id.clone(), finished_child),
        (stale_parent_id.clone(), stale_parent),
        (stale_child_id.clone(), stale_child),
    ]);
    let recovery = reap_dead_background_workers(&mut sessions, &[]);
    assert!(recovery.continue_child_ids.is_empty());
    assert!(recovery.poke_parent_ids.is_empty());
    let finished_parent = sessions.get(&finished_parent_id).expect("finished parent");
    assert_eq!(
        finished_parent.snapshot["subagents"][0]["status"],
        "completed"
    );
    assert_eq!(finished_parent.snapshot["tools"][0]["status"], "completed");
    let stale_parent = sessions.get(&stale_parent_id).expect("stale parent");
    assert_eq!(stale_parent.snapshot["tools"][0]["status"], "cancelled");
    assert_eq!(stale_parent.snapshot["subagents"][0]["status"], "cancelled");
}

#[test]
fn spawn_workers_do_not_claim_unnumbered_todos() {
    let snapshot = json!({
        "sessionKind": "normal",
        "subagents": [{
            "id": "child-1",
            "status": "running",
            "origin": "spawn",
            "description": "调查OpenAI并写草稿"
        }]
    });
    let todos = vec![
        json!({ "id": "research-openai", "status": "pending", "content": "调查OpenAI" }),
        json!({ "id": "report-meta", "status": "pending", "content": "合成终稿" }),
        json!({ "id": "worker-slice", "status": "pending", "content": "系统工人切片", "agent": 1 }),
    ];
    let incomplete = goal_incomplete_for_session(&snapshot, &todos);
    let ids = incomplete
        .iter()
        .filter_map(|todo| todo.get("id").and_then(Value::as_str))
        .collect::<Vec<_>>();
    assert_eq!(ids, vec!["research-openai", "report-meta"]);
}

#[test]
fn harvest_does_not_complete_unnumbered_todos_for_spawn_workers() {
    let backend = LyraAgentBackend;
    let parent = backend
        .call_agent_method("agent.session.create", json!({ "title": "Harvest host" }))
        .expect("create parent");
    let parent_id = parent["id"].as_str().expect("parent id").to_string();
    let child_id = {
        let mut state = state().lock().expect("state lock");
        let session = state.sessions.get_mut(&parent_id).expect("parent");
        session.snapshot["plan"] = json!({
            "activePlanId": "plan-1",
            "activeVersionId": "plan-1",
            "phase": PLAN_PHASE_EXECUTING_TODO,
        });
        session.snapshot["projectTodo"] = json!({
            "todoListId": "todo-list-1",
            "planId": "plan-1",
            "versionId": "plan-1",
            "status": "running",
            "todos": [
                { "id": "research-openai", "status": "in_progress", "content": "调查OpenAI并写草稿" },
                { "id": "report-meta", "status": "pending", "content": "合成终稿" }
            ]
        });
        session.snapshot["todos"] = session.snapshot["projectTodo"]["todos"].clone();
        let mut child = new_session(Some("openai".to_string()), None, SUBAGENT_SESSION_KIND);
        let child_id = child.id.clone();
        child.snapshot["parentSessionId"] = json!(parent_id);
        child.snapshot["subagent"] = json!({
            "type": "generalPurpose",
            "origin": "spawn"
        });
        child.snapshot["turnStatus"] = json!("idle");
        state.sessions.insert(child_id.clone(), child);
        remember_child(
            &mut state,
            &parent_id,
            &child_id,
            "调查OpenAI并写草稿",
            "generalPurpose",
        );
        child_id
    };
    mark_child_status(&parent_id, &child_id, "idle");
    harvest_finished_worker_todos(&parent_id);
    let snapshot = {
        let state = state().lock().expect("state lock");
        state
            .sessions
            .get(&parent_id)
            .expect("parent")
            .snapshot
            .clone()
    };
    assert_eq!(snapshot["projectTodo"]["todos"][0]["status"], "in_progress");
    assert_eq!(snapshot["projectTodo"]["todos"][1]["status"], "pending");
}

#[test]
fn running_worker_owns_path_named_in_description() {
    let snapshot = json!({
        "sessionKind": "normal",
        "subagents": [{
            "id": "child-1",
            "status": "running",
            "description": "写 drafts/research-openai.md"
        }]
    });
    assert_eq!(
        owned_by_running_worker(&snapshot, "drafts/research-openai.md").as_deref(),
        Some("写 drafts/research-openai.md")
    );
    assert!(owned_by_running_worker(&snapshot, "AI公司调查报告.md").is_none());
}

#[test]
fn numbered_running_worker_owns_assigned_todo_path() {
    let snapshot = json!({
        "sessionKind": "normal",
        "projectTodo": {
            "todos": [{
                "id": "research-openai",
                "status": "in_progress",
                "agent": 1,
                "content": "调查OpenAI并写 drafts/research-openai.md"
            }]
        },
        "subagents": [{
            "id": "child-1",
            "status": "running",
            "origin": "todo",
            "agent": 1,
            "description": "agent 1"
        }]
    });
    assert_eq!(
        owned_by_running_worker(&snapshot, "drafts/research-openai.md").as_deref(),
        Some("agent 1")
    );
}
