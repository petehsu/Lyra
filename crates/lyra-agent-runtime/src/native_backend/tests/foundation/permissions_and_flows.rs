use super::*;

#[test]
fn rollback_preview_and_restore_recover_messages_and_files() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    let file_path = temp.path().join("note.txt");
    fs::write(&file_path, "before").expect("write before");
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Rollback Test", "workingDir": temp.path().display().to_string() }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = "turn-rollback-test".to_string();
    let mut message = user_message("change note".to_string(), Vec::new(), now());
    let message_id = message["id"].as_str().expect("message id").to_string();
    {
        let mut state = state().lock().expect("state lock");
        let session = state.sessions.get_mut(&session_id).expect("session");
        let checkpoint = rollback_checkpoint(&session_id, &turn_id, &message_id, session);
        message["rollback"] = json!({
            "available": true,
            "anchorId": checkpoint.id,
            "checkpointAt": checkpoint.created_at,
        });
        session.rollback_checkpoints.push(checkpoint);
        push_array(&mut session.snapshot, "messages", message);
        session.runtime_turns.push(runtime_turn(
            &turn_id,
            &session_id,
            "waiting_for_tool",
            Some(message_id.clone()),
            None,
        ));
    }
    record_tool_activity(
        &session_id,
        &turn_id,
        tool_activity(
            "tool-write",
            "file",
            "Write file",
            "running",
            json!({ "action": "write", "path": "note.txt" }),
            None,
            &now(),
            None,
        ),
        "toolStarted",
    );
    fs::write(&file_path, "after").expect("write after");
    let preview = backend
        .call_agent_method(
            "agent.rollback.preview",
            json!({ "sessionId": session_id.clone(), "messageId": message_id.clone() }),
        )
        .expect("preview");
    assert_eq!(preview["available"], true);
    assert_eq!(preview["changedFiles"].as_array().expect("files").len(), 1);
    let restored = backend
        .call_agent_method(
            "agent.rollback.restore",
            json!({ "sessionId": session_id.clone(), "messageId": message_id.clone() }),
        )
        .expect("restore");
    assert_eq!(restored["restoredFileCount"], 1);
    assert_eq!(
        fs::read_to_string(file_path).expect("read restored"),
        "before"
    );
    assert_eq!(
        restored["snapshot"]["messages"]
            .as_array()
            .expect("messages")
            .len(),
        0
    );
}
#[test]
fn permission_request_denies_and_allows_native_file_write() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    let denied_path = temp.path().join("denied.txt");
    let allowed_path = temp.path().join("allowed.txt");
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Permission Test", "workingDir": temp.path().display().to_string() }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let denied_turn_id = start_test_runtime_turn(&session_id);
    let denied_session_id = session_id.clone();
    let denied_handle = thread::spawn(move || {
        execute_model_tool(
            &denied_session_id,
            &denied_turn_id,
            &None,
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-denied",
                "/tools/filesystem/write_file",
                json!({
                    "path": "denied.txt",
                    "content": "nope",
                    "overwrite": true
                }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id.clone(), "permissionId": permission_id, "allowed": false }),
        )
        .expect("deny permission");
    let denied_output = denied_handle.join().expect("join denied");
    assert_eq!(
        denied_output.pointer("/error/code").and_then(Value::as_str),
        Some("permission_denied")
    );
    assert_eq!(denied_output["schemaVersion"].as_u64(), Some(1));
    assert_eq!(denied_output["status"].as_str(), Some("failed"));
    assert_eq!(
        denied_output["notRunReason"].as_str(),
        Some("permission_denied")
    );
    assert_eq!(
        denied_output["toolPath"].as_str(),
        Some("/tools/filesystem/write_file")
    );
    assert_eq!(
        denied_output
            .pointer("/policyDecision/outcome")
            .and_then(Value::as_str),
        Some("denied")
    );
    assert!(
        denied_output["changes"]
            .as_array()
            .is_none_or(|changes| changes.is_empty())
    );
    assert!(!denied_path.exists());
    let allowed_turn_id = start_test_runtime_turn(&session_id);
    let allowed_session_id = session_id.clone();
    let allowed_handle = thread::spawn(move || {
        execute_model_tool(
            &allowed_session_id,
            &allowed_turn_id,
            &None,
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-allowed",
                "/tools/filesystem/write_file",
                json!({
                    "path": "allowed.txt",
                    "content": "yes",
                    "overwrite": true
                }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id.clone(), "permissionId": permission_id, "allowed": true }),
        )
        .expect("allow permission");
    let allowed_output = allowed_handle.join().expect("join allowed");
    assert!(
        allowed_output["content"]
            .as_str()
            .unwrap()
            .contains("allowed.txt")
    );
    assert_eq!(allowed_output["schemaVersion"].as_u64(), Some(1));
    assert_eq!(allowed_output["status"].as_str(), Some("completed"));
    assert_eq!(
        allowed_output["toolPath"].as_str(),
        Some("/tools/filesystem/write_file")
    );
    assert_eq!(
        allowed_output
            .pointer("/raw/policyDecision/mode")
            .and_then(Value::as_str),
        Some("user_prompt")
    );
    assert_eq!(
        allowed_output
            .pointer("/raw/policyDecision/outcome")
            .and_then(Value::as_str),
        Some("approved")
    );
    assert!(
        allowed_output["artifactRefs"]
            .as_array()
            .is_some_and(|artifacts| artifacts.iter().any(|artifact| artifact["id"].is_string()))
    );
    assert!(
        allowed_output["changes"]
            .as_array()
            .is_some_and(|changes| changes.iter().any(|change| {
                change["kind"] == "file"
                    && change["path"] == "allowed.txt"
                    && change["beforeRef"]["id"].is_string()
                    && change["afterRef"]["id"].is_string()
                    && change["diffRef"]["id"].is_string()
            }))
    );
    assert_eq!(
        fs::read_to_string(allowed_path).expect("read allowed"),
        "yes"
    );
    let denied_shell_path = temp.path().join("denied-shell.txt");
    fs::write(&denied_shell_path, "keep").expect("write denied shell file");
    let denied_shell_turn_id = start_test_runtime_turn(&session_id);
    let denied_shell_session_id = session_id.clone();
    let denied_shell_handle = thread::spawn(move || {
        execute_model_tool(
            &denied_shell_session_id,
            &denied_shell_turn_id,
            &None,
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-shell-denied",
                "/tools/shell/run_command",
                json!({
                    "command": "rm denied-shell.txt",
                    "cwd": "."
                }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id.clone(), "permissionId": permission_id, "allowed": false }),
        )
        .expect("deny shell permission");
    let denied_shell_output = denied_shell_handle.join().expect("join denied shell");
    assert_eq!(
        denied_shell_output
            .pointer("/error/code")
            .and_then(Value::as_str),
        Some("permission_denied")
    );
    assert!(denied_shell_path.exists());
    let allowed_shell_path = temp.path().join("allowed-shell.txt");
    fs::write(&allowed_shell_path, "remove").expect("write allowed shell file");
    let allowed_shell_turn_id = start_test_runtime_turn(&session_id);
    let allowed_shell_session_id = session_id.clone();
    let allowed_shell_handle = thread::spawn(move || {
        execute_model_tool(
            &allowed_shell_session_id,
            &allowed_shell_turn_id,
            &None,
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-shell-allowed",
                "/tools/shell/run_command",
                json!({
                    "command": "rm allowed-shell.txt",
                    "cwd": "."
                }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id.clone(), "permissionId": permission_id, "allowed": true }),
        )
        .expect("allow shell permission");
    let allowed_shell_output = allowed_shell_handle.join().expect("join allowed shell");
    assert_eq!(allowed_shell_output["raw"]["success"].as_bool(), Some(true));
    assert_eq!(
        allowed_shell_output
            .pointer("/raw/policyDecision/mode")
            .and_then(Value::as_str),
        Some("user_prompt")
    );
    assert!(!allowed_shell_path.exists());
    let unbound_shell_path = temp.path().join("unbound-shell.txt");
    fs::write(&unbound_shell_path, "keep").expect("write unbound shell file");
    let unbound = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Unbound Shell Permission" }),
        )
        .expect("create unbound shell session");
    let unbound_session_id = unbound["id"]
        .as_str()
        .expect("unbound session id")
        .to_string();
    let unbound_turn_id = start_test_runtime_turn(&unbound_session_id);
    let unbound_shell_session_id = unbound_session_id.clone();
    let unbound_cwd = temp.path().display().to_string();
    let unbound_shell_handle = thread::spawn(move || {
        execute_model_tool(
            &unbound_shell_session_id,
            &unbound_turn_id,
            &None,
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-shell-unbound-denied",
                "/tools/shell/run_command",
                json!({
                    "command": "rm unbound-shell.txt",
                    "cwd": unbound_cwd
                }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&unbound_session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": unbound_session_id, "permissionId": permission_id, "allowed": false }),
        )
        .expect("deny unbound shell permission");
    let unbound_shell_output = unbound_shell_handle
        .join()
        .expect("join unbound denied shell");
    assert_eq!(
        unbound_shell_output
            .pointer("/error/code")
            .and_then(Value::as_str),
        Some("permission_denied")
    );
    assert!(unbound_shell_path.exists());
}

#[test]
fn tool_fs_permission_modes_gate_before_adapter_execution() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("readable.txt"), "hello").expect("write readable");
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Permission Mode Test", "workingDir": temp.path().display().to_string() }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();

    let read_turn_id = start_test_runtime_turn(&session_id);
    let read_output = execute_model_tool(
        &session_id,
        &read_turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call_with_permission_mode(
            "tool-read-only-read",
            "/tools/filesystem/read_file",
            json!({ "path": "readable.txt" }),
            "read_only",
        ),
    );
    assert_eq!(read_output["status"].as_str(), Some("completed"));
    assert_eq!(
        read_output
            .pointer("/toolOperation/permissionMode")
            .and_then(Value::as_str),
        Some("read_only")
    );

    let denied_path = temp.path().join("read-only-denied.txt");
    let read_only_turn_id = start_test_runtime_turn(&session_id);
    let read_only_output = execute_model_tool(
        &session_id,
        &read_only_turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call_with_permission_mode(
            "tool-read-only-write",
            "/tools/filesystem/write_file",
            json!({ "path": "read-only-denied.txt", "content": "no", "overwrite": true }),
            "read_only",
        ),
    );
    assert_eq!(read_only_output["status"].as_str(), Some("failed"));
    assert_eq!(
        read_only_output["notRunReason"].as_str(),
        Some("permission_denied")
    );
    assert!(!denied_path.exists());

    let deny_turn_id = start_test_runtime_turn(&session_id);
    let deny_output = execute_model_tool(
        &session_id,
        &deny_turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call_with_permission_mode(
            "tool-deny-read",
            "/tools/filesystem/read_file",
            json!({ "path": "readable.txt" }),
            "deny",
        ),
    );
    assert_eq!(deny_output["status"].as_str(), Some("failed"));
    assert_eq!(
        deny_output["notRunReason"].as_str(),
        Some("permission_denied")
    );

    let full_access_path = temp.path().join("full-access.txt");
    let full_access_turn_id = start_test_runtime_turn(&session_id);
    let full_access_output = execute_model_tool(
        &session_id,
        &full_access_turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call_with_permission_mode(
            "tool-full-access-write",
            "/tools/filesystem/write_file",
            json!({ "path": "full-access.txt", "content": "yes", "overwrite": true }),
            "full_access",
        ),
    );
    assert_eq!(full_access_output["status"].as_str(), Some("completed"));
    assert_eq!(
        full_access_output
            .pointer("/raw/policyDecision/mode")
            .and_then(Value::as_str),
        Some("full_access")
    );
    assert_eq!(
        fs::read_to_string(full_access_path).expect("read full access file"),
        "yes"
    );
    assert!(
        state()
            .lock()
            .expect("state lock")
            .pending_permissions
            .is_empty()
    );
}

#[test]
fn lumen_live_login_state_requires_permission_even_for_read_tools() {
    assert_eq!(
        permission_risk(
            "lyra_lumen",
            "map",
            &json!({
                "targetMode": "isolated",
                "authState": "borrowLiveLogin"
            })
        ),
        Some("sensitive".to_string())
    );
    assert_eq!(
        permission_risk(
            "lyra_lumen",
            "read",
            &json!({
                "targetMode": "isolated",
                "useLiveLoginState": true
            })
        ),
        Some("sensitive".to_string())
    );
    assert_eq!(
        permission_risk("lyra_lumen", "map", &json!({ "targetMode": "isolated" })),
        None
    );
    assert_eq!(
        permission_risk("lyra_lumen", "locate", &json!({ "targetMode": "isolated" })),
        None
    );
    assert_eq!(
        permission_risk(
            "lyra_lumen",
            "find",
            &json!({
                "targetMode": "isolated",
                "useLiveLoginState": true
            })
        ),
        Some("sensitive".to_string())
    );
}
#[test]
fn terminal_host_tools_apply_read_and_write_permission_policy() {
    assert_eq!(permission_risk("terminal", "list", &json!({})), None);
    assert_eq!(
        permission_risk("terminal", "read", &json!({ "sessionId": "terminal-1" })),
        None
    );
    assert_eq!(
        permission_risk("terminal", "screen", &json!({ "sessionId": "terminal-1" })),
        None
    );
    assert_eq!(
        permission_risk("terminal", "wait", &json!({ "sessionId": "terminal-1" })),
        None
    );
    assert_eq!(
        permission_risk("terminal", "create", &json!({ "mode": "shell" })),
        None
    );
    assert_eq!(
        permission_risk("terminal", "create", &json!({ "command": "npm test" })),
        Some("shell".to_string())
    );
    assert_eq!(
        permission_risk("terminal", "write", &json!({ "text": "npm test" })),
        Some("shell".to_string())
    );
    assert_eq!(
        permission_risk("terminal", "close", &json!({ "sessionId": "terminal-1" })),
        Some("shell".to_string())
    );
}

#[test]
fn terminal_tool_fs_mutation_emits_change_record_and_log_artifact() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Terminal Mutation Change Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, payload| {
        assert_eq!(method, "terminal.write");
        let input: Value = serde_json::from_str(&payload).expect("terminal payload json");
        assert_eq!(input["action"], "write");
        assert_eq!(input["sessionId"], "terminal-session-1");
        assert_eq!(input["text"], "npm test\n");
        Ok(serde_json::to_string(&json!({
            "ok": true,
            "target": { "type": "private", "sessionId": "terminal-session-1" },
            "sessionId": "terminal-session-1",
            "output": "wrote 9 bytes to terminal-session-1",
            "running": true,
            "exitCode": null,
            "truncated": false
        }))
        .expect("json"))
    });
    let run_session_id = session_id.clone();
    let run_dispatcher = dispatcher.clone();
    let handle = thread::spawn(move || {
        execute_model_tool(
            &run_session_id,
            &turn_id,
            &Some(run_dispatcher),
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-terminal-write",
                "/tools/terminal/write",
                json!({
                    "sessionId": "terminal-session-1",
                    "text": "npm test\n"
                }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id, "permissionId": permission_id, "allowed": true }),
        )
        .expect("allow terminal write permission");
    let output = handle.join().expect("join terminal write");
    assert_eq!(output["status"].as_str(), Some("completed"));
    assert_eq!(output["toolPath"].as_str(), Some("/tools/terminal/write"));
    assert_eq!(
        output
            .pointer("/raw/logArtifactRef/kind")
            .and_then(Value::as_str),
        Some("log")
    );
    assert_eq!(
        output
            .pointer("/raw/policyDecision/mode")
            .and_then(Value::as_str),
        Some("user_prompt")
    );
    assert!(
        output["artifactRefs"]
            .as_array()
            .is_some_and(|artifacts| artifacts.iter().any(|artifact| artifact["kind"] == "log"))
    );
    assert!(
        output["changes"]
            .as_array()
            .is_some_and(|changes| changes.iter().any(|change| {
                change["kind"] == "terminal"
                    && change["operation"] == "write"
                    && change["diffRef"]["kind"] == "log"
                    && change["reversible"] == false
            }))
    );
}

#[test]
fn permission_policy_does_not_infer_risk_from_free_text_keywords() {
    assert_eq!(
        permission_risk(
            "unknown",
            "noop",
            &json!({
                "note": "please delete file and exec shell command",
                "description": "write patch terminal"
            })
        ),
        None
    );
    assert_eq!(
        permission_risk(
            "workbench",
            "read_tab",
            &json!({ "title": "delete file shell exec" })
        ),
        None
    );
    assert_eq!(
        permission_risk("lyra_lumen", "submit", &json!({ "label": "plain submit" })),
        Some("dangerous".to_string())
    );
}
#[test]
fn clarification_tool_resumes_same_turn_without_assistant_bubble() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Clarification Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let thread_session_id = session_id.clone();
    let first_turn_id = turn_id.clone();
    let handle = thread::spawn(move || {
        execute_model_tool(
            &thread_session_id,
            &first_turn_id,
            &None,
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-clarify",
                "/tools/clarification/ask",
                json!({
                    "question": "Which target?",
                    "options": ["A", "B"],
                    "allowCustomAnswer": true
                }),
            ),
        )
    });
    let clarification_id = wait_for_pending_clarification(&session_id);
    backend
        .call_agent_method(
            "agent.clarification.respond",
            json!({
                "sessionId": session_id.clone(),
                "clarificationId": clarification_id,
                "answer": "A",
                "selectedOption": "A"
            }),
        )
        .expect("respond clarification");
    let output = handle.join().expect("join clarification");
    assert_eq!(output["answer"], "A");
    let thread_session_id = session_id.clone();
    let second_turn_id = turn_id.clone();
    let handle = thread::spawn(move || {
        execute_model_tool(
            &thread_session_id,
            &second_turn_id,
            &None,
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-clarify-again",
                "/tools/clarification/ask",
                json!({
                    "question": "Which mode?",
                    "options": ["fast", "careful"],
                    "allowCustomAnswer": true
                }),
            ),
        )
    });
    let clarification_id = wait_for_pending_clarification(&session_id);
    backend
        .call_agent_method(
            "agent.clarification.respond",
            json!({
                "sessionId": session_id.clone(),
                "clarificationId": clarification_id,
                "answer": "careful",
                "selectedOption": "careful"
            }),
        )
        .expect("respond second clarification");
    let output = handle.join().expect("join second clarification");
    assert_eq!(output["answer"], "careful");
    let read = backend
        .call_agent_method(
            "agent.session.read",
            json!({ "sessionId": session_id.clone() }),
        )
        .expect("read");
    assert_eq!(read["messages"].as_array().expect("messages").len(), 0);
}
#[test]
fn browser_shared_control_interruption_requests_clarification_and_resolves_decision() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Shared Control Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, payload| {
        let input: Value = serde_json::from_str(&payload).expect("payload json");
        match method.as_str() {
            "lyraLumen.read" => Ok(serde_json::to_string(&json!({
                "ok": false,
                "kind": "lyraLumenControlHandoff",
                "tabId": "browser-tab-1",
                "targetMode": "live",
                "needsUserAction": {
                    "kind": "shared_control_interrupted",
                    "tabId": "browser-tab-1",
                    "targetMode": "live"
                }
            }))
            .expect("json")),
            "lyraLumen.resolveControlHandoff" => {
                assert_eq!(input["decision"], "continue_agent");
                Ok(serde_json::to_string(&json!({
                    "ok": true,
                    "kind": "lyraLumenControlDecision",
                    "tabId": "browser-tab-1",
                    "decision": "continue_agent"
                }))
                .expect("json"))
            }
            other => panic!("unexpected method {other}"),
        }
    });
    let thread_session_id = session_id.clone();
    let thread_turn_id = turn_id.clone();
    let handle = thread::spawn(move || {
        execute_model_tool(
            &thread_session_id,
            &thread_turn_id,
            &Some(dispatcher),
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-read-interrupted",
                "/tools/browser/read",
                json!({ "tabId": "browser-tab-1", "targetMode": "live" }),
            ),
        )
    });
    let clarification_id = wait_for_pending_clarification(&session_id);
    backend
        .call_agent_method(
            "agent.clarification.respond",
            json!({
                "sessionId": session_id,
                "clarificationId": clarification_id,
                "answer": "Continue Agent",
                "selectedOption": "Continue Agent"
            }),
        )
        .expect("respond clarification");
    let output = handle.join().expect("join interrupted read");
    assert_eq!(
        output
            .pointer("/raw/userActionResolution/decision")
            .and_then(Value::as_str),
        Some("continue_agent")
    );
    assert!(
        output["content"]
            .as_str()
            .unwrap_or_default()
            .contains("shared_control_decision")
    );
}
#[test]
fn auth_challenge_signal_triggers_elevation_clarification_and_verification() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Auth Elevation Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, payload| {
        let input: Value = serde_json::from_str(&payload).expect("payload json");
        match method.as_str() {
            "lyraLumen.map" => Ok(serde_json::to_string(&json!({
                "ok": true,
                "kind": "lyraLumenMap",
                "tabId": "browser-tab-1",
                "targetMode": "isolated",
                "observationId": "obs-auth",
                "title": "Login",
                "url": "https://example.com/login",
                "elements": [],
                "authChallengeSignals": [{
                    "kind": "captcha",
                    "confidence": "high",
                    "source": "frame",
                    "label": "recaptcha"
                }],
                "needsUserAction": {
                    "kind": "auth_challenge",
                    "reason": "captcha",
                    "tabId": "browser-tab-1",
                    "targetMode": "isolated",
                    "suggestedAction": "lyra_lumen_elevate"
                }
            }))
            .expect("json")),
            "lyraLumen.elevate" => {
                assert_eq!(input["reason"], "captcha");
                Ok(serde_json::to_string(&json!({
                    "ok": true,
                    "kind": "lyraLumenElevation",
                    "tabId": "browser-tab-1",
                    "targetMode": "isolated",
                    "liveTabId": "browser-elevated-1",
                    "address": "https://example.com/login",
                    "title": "Login",
                    "userActionRequired": true,
                    "elevationSession": {
                        "sessionId": "elevation-1"
                    }
                }))
                .expect("json"))
            }
            "lyraLumen.completeElevation" => {
                assert_eq!(input["liveTabId"], "browser-elevated-1");
                Ok(serde_json::to_string(&json!({
                    "ok": true,
                    "kind": "lyraLumenElevationCompletion",
                    "tabId": "browser-tab-1",
                    "targetMode": "isolated",
                    "liveTabId": "browser-elevated-1",
                    "address": "https://example.com/app",
                    "title": "App",
                    "verified": true,
                    "message": "verified"
                }))
                .expect("json"))
            }
            other => panic!("unexpected method {other}"),
        }
    });
    let thread_session_id = session_id.clone();
    let thread_turn_id = turn_id.clone();
    let handle = thread::spawn(move || {
        execute_model_tool(
            &thread_session_id,
            &thread_turn_id,
            &Some(dispatcher),
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-map-auth",
                "/tools/browser/map",
                json!({ "tabId": "browser-tab-1", "targetMode": "isolated" }),
            ),
        )
    });
    let clarification_id = wait_for_pending_clarification(&session_id);
    backend
        .call_agent_method(
            "agent.clarification.respond",
            json!({
                "sessionId": session_id.clone(),
                "clarificationId": clarification_id,
                "answer": "Open Visible Tab",
                "selectedOption": "Open Visible Tab"
            }),
        )
        .expect("respond elevation clarification");
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id.clone(), "permissionId": permission_id, "allowed": true }),
        )
        .expect("allow elevation");
    let completion_id = wait_for_pending_clarification(&session_id);
    backend
        .call_agent_method(
            "agent.clarification.respond",
            json!({
                "sessionId": session_id,
                "clarificationId": completion_id,
                "answer": "Done",
                "selectedOption": "Done"
            }),
        )
        .expect("respond completion clarification");
    let output = handle.join().expect("join auth map");
    assert_eq!(
        output
            .pointer("/raw/userActionResolution/decision")
            .and_then(Value::as_str),
        Some("elevate_and_verify")
    );
    assert_eq!(
        output
            .pointer("/raw/userActionResolution/verification/verified")
            .and_then(Value::as_bool),
        Some(true)
    );
    assert_eq!(
        output
            .pointer("/raw/userActionResolution/policyDecision/mode")
            .and_then(Value::as_str),
        Some("user_prompt")
    );
    assert_eq!(
        output
            .pointer("/raw/userActionResolution/policyDecision/outcome")
            .and_then(Value::as_str),
        Some("approved")
    );
    assert_eq!(
        output
            .pointer("/raw/userActionResolution/policyDecision/action")
            .and_then(Value::as_str),
        Some("elevate")
    );
}
#[test]
fn goals_btw_and_overnight_return_real_state() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method("agent.session.create", json!({ "title": "Workflow Test" }))
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let goals = backend
        .call_agent_method(
            "agent.goals.list",
            json!({ "sessionId": session_id.clone() }),
        )
        .expect("list goals");
    assert!(!goals["goals"].as_array().expect("goals").is_empty());
    let opened = backend
        .call_agent_method(
            "agent.goals.open",
            json!({ "sessionId": session_id.clone() }),
        )
        .expect("open goal");
    assert_eq!(
        opened["sidePanel"]["pages"]
            .as_array()
            .expect("pages")
            .len(),
        1
    );
    let btw = backend
        .call_agent_method(
            "agent.btw.run",
            json!({ "sessionId": session_id.clone(), "question": "What is the context?" }),
        )
        .expect("btw");
    assert!(
        btw["sidePanel"]["pages"][0]["content"]
            .as_str()
            .expect("btw content")
            .contains("**Answer:**")
    );
    let selfdev = backend
        .call_agent_method(
            "agent.selfdev.start",
            json!({
                "target": "validation",
                "inheritContext": false
            }),
        )
        .expect("selfdev start");
    let selfdev_session_id = selfdev["sessionId"]
        .as_str()
        .expect("selfdev session id")
        .to_string();
    assert_eq!(selfdev["snapshot"]["sessionKind"], "selfdev");
    assert_eq!(selfdev["selfdev"]["target"], "validation");
    let selfdev_turn = backend
        .call_agent_method(
            "agent.selfdev.sendTurn",
            json!({ "sessionId": selfdev_session_id.clone(), "text": "Check selfdev task state." }),
        )
        .expect("selfdev send turn");
    assert_eq!(selfdev_turn["sessionId"], selfdev_session_id);
    let selfdev_status = backend
        .call_agent_method(
            "agent.selfdev.status",
            json!({ "sessionId": selfdev_session_id }),
        )
        .expect("selfdev status");
    assert_eq!(selfdev_status["metadata"]["mode"], "selfdev");
    assert!(
        selfdev_status["metadata"]["capabilities"]
            .as_array()
            .expect("capabilities")
            .iter()
            .any(|capability| capability["id"] == "runtime_reload")
    );
    let overnight = backend
        .call_agent_method(
            "agent.overnight.start",
            json!({
                "sessionId": session_id.clone(),
                "durationMinutes": 1,
                "mission": "short test",
                "inheritContext": true
            }),
        )
        .expect("overnight start");
    let run_id = overnight["run"]["runId"]
        .as_str()
        .expect("run id")
        .to_string();
    let mut status = Value::Null;
    for _ in 0..100 {
        status = backend
            .call_agent_method("agent.overnight.status", json!({ "runId": run_id.clone() }))
            .expect("overnight status");
        if status["run"]["status"] == "completed" {
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(status["run"]["status"], "completed");
    assert!(
        status["run"]["reviewHtml"]
            .as_str()
            .expect("review")
            .contains("Overnight Review")
    );
    assert!(
        !status["run"]["events"]
            .as_array()
            .expect("events")
            .is_empty()
    );
    let cancellable = backend
        .call_agent_method(
            "agent.overnight.start",
            json!({
                "sessionId": session_id.clone(),
                "durationMinutes": 1,
                "mission": "cancel test"
            }),
        )
        .expect("overnight start for cancel");
    let cancel_run_id = cancellable["run"]["runId"]
        .as_str()
        .expect("cancel run id")
        .to_string();
    let cancelled = backend
        .call_agent_method(
            "agent.overnight.cancel",
            json!({ "runId": cancel_run_id.clone() }),
        )
        .expect("overnight cancel");
    assert_eq!(cancelled["run"]["status"], "cancelled");
    thread::sleep(Duration::from_millis(80));
    let cancelled_status = backend
        .call_agent_method("agent.overnight.status", json!({ "runId": cancel_run_id }))
        .expect("cancelled overnight status");
    assert_eq!(cancelled_status["run"]["status"], "cancelled");
}
