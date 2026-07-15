use super::*;

#[test]
fn host_unavailable_failure_has_not_run_reason() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Host Unavailable Tool Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn_with_contract(&session_id, "control", &["browser"]);
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-host-unavailable",
            "/tools/workbench/list_tabs",
            json!({}),
        ),
    );
    assert_eq!(output["status"].as_str(), Some("failed"));
    assert_eq!(
        output.pointer("/error/code").and_then(Value::as_str),
        Some("host_unavailable")
    );
    assert_eq!(output["notRunReason"].as_str(), Some("host_unavailable"));
    assert!(
        output["trace"]
            .as_array()
            .expect("trace")
            .iter()
            .all(|record| {
                !matches!(
                    record.get("phase").and_then(Value::as_str),
                    Some("permission_checked" | "executing")
                )
            })
    );
    assert!(
        output["changes"]
            .as_array()
            .is_none_or(|changes| changes.is_empty())
    );
}

#[test]
fn browser_visual_tools_receive_model_image_capability() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Browser Visual Capability Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, payload| {
        let input: Value = serde_json::from_str(&payload).expect("payload json");
        assert_eq!(method, "lyraLumen.see");
        assert_eq!(input["action"], "see");
        assert_eq!(input["targetMode"], "live");
        assert_eq!(input["modelSupportsImageInput"], false);
        Ok(serde_json::to_string(&json!({
            "ok": true,
            "kind": "lyraLumenSeeFallback",
            "tabId": "browser-tab-1",
            "targetMode": "live",
            "content": "Visual capture skipped because the model cannot read images.",
            "nextRecommendedAction": "lyra_lumen.map"
        }))
        .expect("json"))
    });

    let output = execute_model_tool_with_runtime(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        ToolExecutionRuntime {
            supports_image_input: false,
            ..ToolExecutionRuntime::default()
        },
        tool_fs_run_call(
            "tool-see-no-image",
            "/tools/browser/see",
            json!({ "targetMode": "live" }),
        ),
    );
    assert_eq!(output["status"].as_str(), Some("completed"));
    assert_eq!(
        output.pointer("/raw/kind").and_then(Value::as_str),
        Some("lyraLumenSeeFallback")
    );
}

#[test]
fn pinned_tool_handle_model_calls_dispatch_through_tool_fs() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Pinned Handle Dispatch Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, payload| {
        let input: Value = serde_json::from_str(&payload).expect("payload json");
        assert_eq!(method, "lyraLumen.locate");
        assert_eq!(input["action"], "locate");
        assert_eq!(input["query"], "install");
        Ok(serde_json::to_string(&json!({
            "ok": true,
            "kind": "lyraLumenLocateResult",
            "tabId": "browser-tab-1",
            "targetMode": "live",
            "matches": []
        }))
        .expect("json"))
    });

    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        ModelToolCall {
            id: "direct-browser-locate".to_string(),
            name: "browser_locate".to_string(),
            arguments: json!({ "query": "install", "targetMode": "live" }),
        },
    );

    assert_eq!(output["status"].as_str(), Some("completed"));
    assert_eq!(output["toolPath"].as_str(), Some("/tools/browser/locate"));
}

#[test]
fn direct_web_search_model_call_is_not_unknown_provider_tool() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Direct Web Search Dispatch Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);

    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        ModelToolCall {
            id: "direct-web-search".to_string(),
            name: "web_search".to_string(),
            arguments: json!({}),
        },
    );

    assert_eq!(output["status"].as_str(), Some("failed"));
    assert_eq!(output["toolPath"].as_str(), Some("/tools/web/search"));
    assert_ne!(
        output.pointer("/error/code").and_then(Value::as_str),
        Some("tool_not_found")
    );
}

#[test]
fn browser_observation_does_not_require_contract_but_mutation_does() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Browser Action Effect Contract Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let observe_turn_id = start_test_runtime_turn(&session_id);
    bind_test_user_message(&session_id, &observe_turn_id);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, payload| {
        let input: Value = serde_json::from_str(&payload).expect("payload json");
        assert_eq!(method, "lyraAx.act");
        assert_eq!(input["effect"], "observe");
        Ok(serde_json::to_string(&json!({
            "ok": true,
            "kind": "browserAxActionResult",
            "tabId": "browser-tab-1",
            "targetMode": "live",
            "axRef": "ax:snapshot:hover",
            "interaction": "hover",
            "pageChanged": false,
            "navigationStarted": false
        }))
        .expect("json"))
    });
    let observed = execute_model_tool(
        &session_id,
        &observe_turn_id,
        &Some(dispatcher.clone()),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-browser-observe-no-contract",
            "/tools/browser_ax/act",
            json!({
                "tabId": "browser-tab-1",
                "targetMode": "live",
                "axRef": "ax:snapshot:hover",
                "interaction": "hover",
                "effect": "observe"
            }),
        ),
    );
    assert_eq!(observed["status"].as_str(), Some("completed"));

    let mutate_turn_id = start_test_runtime_turn(&session_id);
    bind_test_user_message(&session_id, &mutate_turn_id);
    let blocked = execute_model_tool(
        &session_id,
        &mutate_turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-browser-mutate-no-contract",
            "/tools/browser_ax/act",
            json!({
                "tabId": "browser-tab-1",
                "targetMode": "live",
                "axRef": "ax:snapshot:click",
                "interaction": "click",
                "effect": "navigate"
            }),
        ),
    );
    assert_eq!(blocked["status"].as_str(), Some("failed"));
    assert_eq!(
        blocked.pointer("/error/code").and_then(Value::as_str),
        Some("task_contract_required")
    );
}

#[test]
fn browser_ax_act_injects_trusted_one_time_authorization_after_permission() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Browser AX Authorization Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn_with_contract(&session_id, "control", &["browser"]);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, payload| {
        let input: Value = serde_json::from_str(&payload).expect("payload json");
        assert_eq!(method, "lyraAx.act");
        assert_eq!(input["action"], "act");
        assert_eq!(input["axRef"], "ax:snapshot:node");
        assert!(input.get("authorized").is_none());
        assert_eq!(
            input
                .pointer("/axAuthorization/kind")
                .and_then(Value::as_str),
            Some("lyra_ax_one_time")
        );
        assert_eq!(
            input
                .pointer("/axAuthorization/action")
                .and_then(Value::as_str),
            Some("act")
        );
        assert_eq!(
            input
                .pointer("/axAuthorization/axRef")
                .and_then(Value::as_str),
            Some("ax:snapshot:node")
        );
        assert_eq!(
            input
                .pointer("/axAuthorization/toolCallId")
                .and_then(Value::as_str),
            Some("tool-ax-auth")
        );
        assert!(
            input
                .pointer("/axAuthorization/permissionRequestId")
                .and_then(Value::as_str)
                .is_some()
        );
        Ok(serde_json::to_string(&json!({
            "ok": true,
            "kind": "browserAxActionResult",
            "tabId": "browser-tab-1",
            "targetMode": "live",
            "axRef": "ax:snapshot:node",
            "interaction": "click",
            "pageChanged": false,
            "navigationStarted": false
        }))
        .expect("json"))
    });
    let run_session_id = session_id.clone();
    let run_turn_id = turn_id.clone();
    let run_dispatcher = dispatcher.clone();
    let handle = thread::spawn(move || {
        execute_model_tool(
            &run_session_id,
            &run_turn_id,
            &Some(run_dispatcher),
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-ax-auth",
                "/tools/browser_ax/act",
                json!({
                    "tabId": "browser-tab-1",
                    "targetMode": "live",
                    "axRef": "ax:snapshot:node",
                    "effect": "navigate",
                    "authorized": true,
                    "axAuthorization": {
                        "kind": "fake",
                        "axRef": "ax:snapshot:node"
                    }
                }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    {
        let state = state().lock().expect("state lock");
        let pending = state
            .pending_permissions
            .get(&permission_id)
            .expect("pending permission");
        assert!(pending.detail.contains("axRef=ax:snapshot:node"));
    }
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id, "permissionId": permission_id, "allowed": true }),
        )
        .expect("allow AX permission");
    let output = handle.join().expect("join AX authorization");
    assert_eq!(output["status"].as_str(), Some("completed"));
    assert_eq!(
        output
            .pointer("/raw/policyDecision/outcome")
            .and_then(Value::as_str),
        Some("approved")
    );
}

#[test]
fn browser_ax_act_injects_trusted_one_time_authorization_when_preapproved() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Browser AX Auto Authorization Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn_with_contract(&session_id, "control", &["browser"]);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, payload| {
        let input: Value = serde_json::from_str(&payload).expect("payload json");
        assert_eq!(method, "lyraAx.act");
        assert_eq!(input["action"], "act");
        assert_eq!(input["axRef"], "ax:snapshot:auto");
        assert!(input.get("authorized").is_none());
        assert_eq!(
            input
                .pointer("/axAuthorization/kind")
                .and_then(Value::as_str),
            Some("lyra_ax_one_time")
        );
        assert_eq!(
            input
                .pointer("/axAuthorization/action")
                .and_then(Value::as_str),
            Some("act")
        );
        assert_eq!(
            input
                .pointer("/axAuthorization/axRef")
                .and_then(Value::as_str),
            Some("ax:snapshot:auto")
        );
        assert_eq!(
            input
                .pointer("/axAuthorization/toolCallId")
                .and_then(Value::as_str),
            Some("tool-ax-auto-auth")
        );
        assert!(
            input
                .pointer("/axAuthorization/permissionRequestId")
                .is_none()
        );
        Ok(serde_json::to_string(&json!({
            "ok": true,
            "kind": "browserAxActionResult",
            "tabId": "browser-tab-1",
            "targetMode": "live",
            "axRef": "ax:snapshot:auto",
            "interaction": "click",
            "pageChanged": false,
            "navigationStarted": false
        }))
        .expect("json"))
    });
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call_with_permission_mode(
            "tool-ax-auto-auth",
            "/tools/browser_ax/act",
            json!({
                "tabId": "browser-tab-1",
                "targetMode": "live",
                "axRef": "ax:snapshot:auto",
                "effect": "navigate",
                "authorized": true,
                "axAuthorization": {
                    "kind": "fake",
                    "axRef": "ax:snapshot:auto"
                }
            }),
            "full_access",
        ),
    );
    assert_eq!(output["status"].as_str(), Some("completed"));
    assert_eq!(
        output
            .pointer("/raw/policyDecision/mode")
            .and_then(Value::as_str),
        Some("full_access")
    );
    let state = state().lock().expect("state lock");
    assert!(!state.pending_permissions.values().any(|request| {
        request.session_id == session_id
            && request.tool_call_id == "tool-ax-auto-auth"
            && request.allowed.is_none()
    }));
}

#[test]
fn host_permission_denied_failure_has_not_run_reason_and_no_changes() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Host Permission Denied Tool Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn_with_contract(&session_id, "control", &["browser"]);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, _payload| {
        panic!("host dispatcher should not be called after permission denial: {method}")
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
                "tool-host-permission-denied",
                "/tools/browser/submit",
                json!({
                    "elementId": 9,
                    "targetMode": "live",
                    "effect": "submitExternal"
                }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id, "permissionId": permission_id, "allowed": false }),
        )
        .expect("deny host permission");
    let output = handle.join().expect("join host permission denied");
    assert_eq!(output["status"].as_str(), Some("failed"));
    assert_eq!(
        output.pointer("/error/code").and_then(Value::as_str),
        Some("permissionDenied")
    );
    assert_eq!(output["notRunReason"].as_str(), Some("permissionDenied"));
    assert!(
        output["changes"]
            .as_array()
            .is_none_or(|changes| changes.is_empty())
    );
}

#[test]
fn permission_wait_cancellation_returns_cancelled_envelope_and_clears_pending_request() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Permission Cancellation Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn_with_contract(&session_id, "control", &["browser"]);
    let cancellation = Arc::new(AtomicBool::new(false));
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, _payload| {
        panic!("host dispatcher should not be called after permission wait cancellation: {method}")
    });
    let run_session_id = session_id.clone();
    let run_turn_id = turn_id.clone();
    let run_cancellation = cancellation.clone();
    let handle = thread::spawn(move || {
        execute_model_tool(
            &run_session_id,
            &run_turn_id,
            &Some(dispatcher),
            &run_cancellation,
            tool_fs_run_call(
                "tool-permission-cancelled",
                "/tools/browser/submit",
                json!({
                    "elementId": 9,
                    "targetMode": "live",
                    "effect": "submitExternal"
                }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    cancellation.store(true, Ordering::SeqCst);
    let output = handle.join().expect("join cancelled permission wait");
    assert_eq!(output["status"].as_str(), Some("cancelled"));
    assert_eq!(output["notRunReason"].as_str(), Some("cancelled"));
    assert!(
        output["trace"]
            .as_array()
            .expect("trace")
            .iter()
            .any(|record| record.get("phase").and_then(Value::as_str) == Some("cancelled"))
    );
    assert!(
        state()
            .lock()
            .expect("state lock")
            .pending_permissions
            .get(&permission_id)
            .is_none()
    );
}

#[test]
fn permission_wait_timeout_returns_error_and_clears_pending_request() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Permission Timeout Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn_with_contract(&session_id, "control", &["browser"]);
    let request = PermissionRequest {
        id: format!("permission-test-{}", Uuid::new_v4()),
        session_id: session_id.clone(),
        turn_id,
        tool_call_id: "tool-permission-timeout".to_string(),
        action: "submit".to_string(),
        risk: "browser_interact".to_string(),
        summary: "Submit browser form".to_string(),
        why: "Testing timeout cleanup".to_string(),
        title: "Browser interaction".to_string(),
        detail: "targetMode=live".to_string(),
        status: "pending".to_string(),
        allowed: None,
        created_at: now(),
        responded_at: None,
    };
    let permission_id = request.id.clone();

    let error = wait_for_permission_with_timeout_for_tests(
        request,
        &Arc::new(AtomicBool::new(false)),
        Duration::from_millis(50),
    )
    .expect_err("permission wait should time out");

    assert!(error.to_string().contains("permission request timed out"));
    assert!(
        state()
            .lock()
            .expect("state lock")
            .pending_permissions
            .get(&permission_id)
            .is_none()
    );
}

#[test]
fn model_tool_execution_bridges_lumen_and_software_tools() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Browser Tool Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, payload| {
        let input: Value = serde_json::from_str(&payload).expect("payload json");
        match method.as_str() {
            "lyraLumen.see" => {
                assert_eq!(input["action"], "see");
                Ok(serde_json::to_string(&json!({
                    "ok": true,
                    "kind": "lyraLumenSee",
                    "tabId": "browser-tab-1",
                    "targetMode": "live",
                    "width": 800,
                    "height": 600,
                    "imageBase64": "large-inline-image",
                    "screenshot": {
                        "mediaType": "image/png",
                        "data": "large-inline-image"
                    },
                    "imageArtifact": {
                        "id": "artifact-1",
                        "path": "/tmp/artifact-1.png",
                        "width": 800,
                        "height": 600
                    }
                }))
                .expect("json"))
            }
            "lyraLumen.submit" => {
                assert_eq!(input["action"], "submit");
                assert_eq!(input["elementId"], 9);
                assert_eq!(input["targetMode"], "live");
                Ok(serde_json::to_string(&json!({
                    "ok": true,
                    "kind": "lyraLumenActionResult",
                    "tabId": "browser-tab-1",
                    "targetMode": "live",
                    "elementId": 9,
                    "submitted": true,
                    "message": "Submitted element 9 with Chromium virtual keyboard."
                }))
                .expect("json"))
            }
            "software.inspectCapability" => {
                assert_eq!(input["softwareId"], "image-viewer");
                assert_eq!(input["capabilityId"], "image-viewer.readMetadata");
                Ok(serde_json::to_string(&json!({
                    "software": {
                        "id": "image-viewer",
                        "title": "Image Viewer",
                        "actions": []
                    },
                    "action": {
                        "id": "image-viewer.readMetadata",
                        "title": "Read Image Metadata",
                        "risk": "read",
                        "inputSchema": { "type": "object" }
                    },
                    "handlerRegistered": true,
                    "readableState": { "available": true }
                }))
                .expect("json"))
            }
            other => panic!("unexpected method {other}"),
        }
    });
    let see_output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher.clone()),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-see",
            "/tools/browser/see",
            json!({ "targetMode": "live" }),
        ),
    );
    assert!(
        see_output["content"]
            .as_str()
            .expect("content")
            .contains("/tmp/artifact-1.png")
    );
    assert!(see_output["raw"].get("imageBase64").is_none());
    assert!(see_output["raw"]["screenshot"].get("data").is_none());
    let submit_turn_id =
        start_test_runtime_turn_with_contract(&session_id, "control", &["browser"]);
    let submit_session_id = session_id.clone();
    let submit_dispatcher = dispatcher.clone();
    let submit_handle = thread::spawn(move || {
        execute_model_tool(
            &submit_session_id,
            &submit_turn_id,
            &Some(submit_dispatcher),
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-submit",
                "/tools/browser/submit",
                json!({
                    "elementId": 9,
                    "targetMode": "live",
                    "effect": "submitExternal"
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
        .expect("allow submit permission");
    let submit_output = submit_handle.join().expect("join submit");
    assert!(
        submit_output["content"]
            .as_str()
            .expect("content")
            .contains("Submitted element 9")
    );
    assert_eq!(
        submit_output
            .pointer("/raw/policyDecision/mode")
            .and_then(Value::as_str),
        Some("user_prompt")
    );
    assert!(
        submit_output["changes"]
            .as_array()
            .is_some_and(|changes| changes.iter().any(|change| {
                change["kind"] == "browser"
                    && change["operation"] == "submit"
                    && change["reversible"] == false
            }))
    );
    let inspect_turn_id = start_test_runtime_turn(&session_id);
    let inspect_output = execute_model_tool(
        &session_id,
        &inspect_turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-inspect",
            "/tools/software/inspect_capability",
            json!({
                "softwareId": "image-viewer",
                "capabilityId": "image-viewer.readMetadata"
            }),
        ),
    );
    assert!(
        inspect_output["content"]
            .as_str()
            .expect("content")
            .contains("Read Image Metadata")
    );
}

#[test]
fn browser_inline_screenshot_is_materialized_as_artifact_ref() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Inline Browser Screenshot Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn_with_contract(&session_id, "control", &["browser"]);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, payload| {
        let input: Value = serde_json::from_str(&payload).expect("payload json");
        assert_eq!(method, "lyraLumen.see");
        assert_eq!(input["action"], "see");
        Ok(serde_json::to_string(&json!({
            "ok": true,
            "kind": "lyraLumenSee",
            "tabId": "browser-tab-1",
            "targetMode": "live",
            "width": 1,
            "height": 1,
            "imageBase64": "iVBORw0KGgo=",
            "screenshot": {
                "mediaType": "image/png",
                "data": "iVBORw0KGgo="
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
            "tool-inline-see",
            "/tools/browser/see",
            json!({ "targetMode": "live" }),
        ),
    );

    assert_eq!(output["status"].as_str(), Some("completed"));
    assert!(output["raw"].get("imageBase64").is_none());
    assert!(output["raw"]["screenshot"].get("data").is_none());
    assert_eq!(
        output
            .pointer("/raw/screenshotArtifactRef/kind")
            .and_then(Value::as_str),
        Some("browser_screenshot")
    );
    assert_eq!(
        output.pointer("/raw/providerImage/path"),
        output.pointer("/raw/imageArtifact/path")
    );
    assert!(
        output["artifactRefs"]
            .as_array()
            .is_some_and(|refs| refs.iter().any(|artifact| {
                artifact["kind"] == "browser_screenshot"
                    && artifact["mimeType"] == "image/png"
                    && artifact["path"]
                        .as_str()
                        .is_some_and(|path| path.ends_with(".png"))
            }))
    );
}

#[test]
fn workbench_capture_visual_evidence_materializes_provider_image() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Workbench Visual Evidence Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, payload| {
        let input: Value = serde_json::from_str(&payload).expect("payload json");
        assert_eq!(method, "workbench.captureVisualEvidence");
        assert_eq!(input["action"], "capture_visual_evidence");
        assert_eq!(input["scope"], "workspace_window");
        Ok(serde_json::to_string(&json!({
            "ok": true,
            "kind": "workbenchVisualEvidence",
            "scope": "workspace_window",
            "capture": {
                "tabId": "lyra-workspace-window",
                "mimeType": "image/png",
                "imageBase64": "iVBORw0KGgo=",
                "width": 1440,
                "height": 900,
                "visibleOnly": true
            },
            "mimeType": "image/png",
            "width": 1440,
            "height": 900,
            "visibleOnly": true
        }))
        .expect("json"))
    });

    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-workbench-visual-evidence",
            "/tools/workbench/capture_visual_evidence",
            json!({ "scope": "workspace_window" }),
        ),
    );

    assert_eq!(output["status"].as_str(), Some("completed"));
    assert!(output.pointer("/raw/capture/imageBase64").is_none());
    assert_eq!(
        output.pointer("/raw/imageEvidenceArtifactRef/kind"),
        Some(&json!("image_evidence"))
    );
    assert_eq!(
        output.pointer("/raw/providerImage/path"),
        output.pointer("/raw/imageArtifact/path")
    );
    assert_eq!(
        output.pointer("/raw/providerImage/mediaType"),
        Some(&json!("image/png"))
    );
    assert_eq!(
        output.pointer("/raw/imageArtifact/visibleOnly"),
        Some(&json!(true))
    );
}

#[test]
fn image_viewer_vision_fallback_materializes_local_image_as_provider_image() {
    let temp = tempfile::tempdir().expect("tempdir");
    let source_image = temp.path().join("viewer-source.png");
    fs::write(
        &source_image,
        b"\x89PNG\r\n\x1a\nlyra-image-viewer-evidence",
    )
    .expect("write source image");

    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Image Viewer Vision Fallback Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let source_image_text = source_image.display().to_string();
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, payload| {
        let input: Value = serde_json::from_str(&payload).expect("payload json");
        assert_eq!(method, "software.invokeCapability");
        assert_eq!(input["softwareId"], "image-viewer");
        assert_eq!(input["capabilityId"], "image-viewer.prepareVisionFallback");
        Ok(serde_json::to_string(&json!({
            "softwareId": "image-viewer",
            "actionId": "image-viewer.prepareVisionFallback",
            "output": {
                "available": true,
                "fallback": "model-vision",
                "imageArtifact": {
                    "id": "image-viewer-active",
                    "kind": "image",
                    "mediaType": "image/png",
                    "path": source_image_text,
                    "width": 320,
                    "height": 240
                },
                "nextRecommendedAction": "attach_image_to_model_vision_input"
            }
        }))
        .expect("json"))
    });
    let run_session_id = session_id.clone();
    let run_turn_id = turn_id.clone();
    let handle = thread::spawn(move || {
        execute_model_tool(
            &run_session_id,
            &run_turn_id,
            &Some(dispatcher),
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-image-viewer-vision-fallback",
                "/tools/software/invoke_capability",
                json!({
                    "softwareId": "image-viewer",
                    "capabilityId": "image-viewer.prepareVisionFallback",
                    "input": {}
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
        .expect("allow software invocation permission");
    let output = handle.join().expect("join software run");

    assert_eq!(output["status"], "completed");
    assert_eq!(
        output.pointer("/raw/imageEvidenceArtifactRef/kind"),
        Some(&json!("image_evidence"))
    );
    let provider_path = output
        .pointer("/raw/providerImage/path")
        .and_then(Value::as_str)
        .expect("provider image path");
    assert_ne!(provider_path, source_image.display().to_string());
    assert!(provider_path.contains("/artifacts/"));
    assert_eq!(
        output.pointer("/raw/providerImage/mediaType"),
        Some(&json!("image/png"))
    );
    assert_eq!(
        output.pointer("/raw/imageArtifact/path"),
        output.pointer("/raw/providerImage/path")
    );
    assert_eq!(
        output.pointer("/raw/imageArtifact/source/path"),
        Some(&json!(source_image.display().to_string()))
    );
    assert!(std::path::Path::new(provider_path).exists());
}

#[test]
fn browser_large_page_text_is_materialized_as_web_page_artifact_ref() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Large Browser Page Artifact Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let large_text = "Large browser page line.\n".repeat(1_000);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, payload| {
        let input: Value = serde_json::from_str(&payload).expect("payload json");
        assert_eq!(method, "lyraLumen.read");
        assert_eq!(input["action"], "read");
        Ok(serde_json::to_string(&json!({
            "ok": true,
            "kind": "lyraLumenRead",
            "tabId": "browser-tab-1",
            "targetMode": "live",
            "title": "Large Page",
            "url": "https://example.test/large",
            "content": large_text
        }))
        .expect("json"))
    });

    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-large-browser-read",
            "/tools/browser/read",
            json!({ "targetMode": "live" }),
        ),
    );

    assert_eq!(output["status"].as_str(), Some("completed"));
    assert_eq!(
        output
            .pointer("/raw/pageArtifactRef/kind")
            .and_then(Value::as_str),
        Some("web_page")
    );
    assert_eq!(
        output
            .pointer("/raw/pageTextTruncated")
            .and_then(Value::as_bool),
        Some(true)
    );
    assert!(
        output
            .pointer("/raw/content")
            .and_then(Value::as_str)
            .is_some_and(
                |content| content.contains("pageArtifactRef") && content.chars().count() < 13_000
            )
    );
    assert!(
        output["artifactRefs"]
            .as_array()
            .is_some_and(|refs| refs.iter().any(|artifact| {
                artifact["kind"] == "web_page"
                    && artifact["mimeType"] == "text/plain; charset=utf-8"
                    && artifact["path"]
                        .as_str()
                        .is_some_and(|path| path.ends_with(".txt"))
            }))
    );
}

#[test]
fn browser_tool_fs_task_chain_maps_types_submits_waits_and_reads() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Browser Chain Tool-FS Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn_with_contract(&session_id, "control", &["browser"]);
    let calls = Arc::new(Mutex::new(Vec::<String>::new()));
    let calls_for_dispatch = calls.clone();
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, payload| {
        let input: Value = serde_json::from_str(&payload).expect("payload json");
        calls_for_dispatch
            .lock()
            .expect("calls lock")
            .push(method.clone());
        match method.as_str() {
            "lyraLumen.map" => Ok(serde_json::to_string(&json!({
                "ok": true,
                "kind": "lyraLumenMap",
                "tabId": "browser-tab-1",
                "targetMode": "live",
                "observationId": "obs-1",
                "title": "Login",
                "url": "https://example.test/login",
                "elements": [{
                    "id": 1,
                    "role": "textbox",
                    "label": "Email",
                    "targetRef": "target-email"
                }, {
                    "id": 2,
                    "role": "button",
                    "label": "Continue",
                    "targetRef": "target-continue"
                }]
            }))
            .expect("json")),
            "lyraLumen.type" => {
                assert_eq!(input["targetRef"], "target-email");
                assert_eq!(input["text"], "lyra@example.test");
                Ok(serde_json::to_string(&json!({
                    "ok": true,
                    "kind": "lyraLumenActionResult",
                    "tabId": "browser-tab-1",
                    "targetMode": "live",
                    "targetRef": "target-email",
                    "typed": true,
                    "message": "typed email"
                }))
                .expect("json"))
            }
            "lyraLumen.submit" => {
                assert_eq!(input["targetRef"], "target-continue");
                Ok(serde_json::to_string(&json!({
                    "ok": true,
                    "kind": "lyraLumenActionResult",
                    "tabId": "browser-tab-1",
                    "targetMode": "live",
                    "targetRef": "target-continue",
                    "submitted": true,
                    "message": "submitted form"
                }))
                .expect("json"))
            }
            "lyraLumen.wait" => Ok(serde_json::to_string(&json!({
                "ok": true,
                "kind": "lyraLumenWait",
                "tabId": "browser-tab-1",
                "targetMode": "live",
                "content": "Dashboard loaded"
            }))
            .expect("json")),
            "lyraLumen.read" => Ok(serde_json::to_string(&json!({
                "ok": true,
                "kind": "lyraLumenRead",
                "tabId": "browser-tab-1",
                "targetMode": "live",
                "title": "Dashboard",
                "url": "https://example.test/app",
                "content": "Welcome to the dashboard"
            }))
            .expect("json")),
            other => panic!("unexpected browser host method {other}"),
        }
    });
    let cancellation = Arc::new(AtomicBool::new(false));

    let map = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher.clone()),
        &cancellation,
        tool_fs_run_call(
            "tool-browser-chain-map",
            "/tools/browser/map",
            json!({ "tabId": "browser-tab-1", "targetMode": "live" }),
        ),
    );
    assert_eq!(map["status"].as_str(), Some("completed"));
    assert_eq!(map["toolPath"].as_str(), Some("/tools/browser/map"));
    assert!(
        map["content"]
            .as_str()
            .is_some_and(|text| text.contains("target-email"))
    );

    let type_session_id = session_id.clone();
    let type_turn_id = turn_id.clone();
    let type_dispatcher = dispatcher.clone();
    let type_cancellation = cancellation.clone();
    let type_handle = thread::spawn(move || {
        execute_model_tool(
            &type_session_id,
            &type_turn_id,
            &Some(type_dispatcher),
            &type_cancellation,
            tool_fs_run_call(
                "tool-browser-chain-type",
                "/tools/browser/type",
                json!({
                    "tabId": "browser-tab-1",
                    "targetMode": "live",
                    "targetRef": "target-email",
                    "text": "lyra@example.test",
                    "effect": "editDraft"
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
        .expect("allow type permission");
    let typed = type_handle.join().expect("join type");
    assert_eq!(typed["status"].as_str(), Some("completed"));
    assert!(typed["changes"].as_array().is_some_and(|changes| {
        changes
            .iter()
            .any(|change| change["kind"] == "browser" && change["operation"] == "type")
    }));

    let submit_session_id = session_id.clone();
    let submit_turn_id = turn_id.clone();
    let submit_dispatcher = dispatcher.clone();
    let submit_cancellation = cancellation.clone();
    let submit_handle = thread::spawn(move || {
        execute_model_tool(
            &submit_session_id,
            &submit_turn_id,
            &Some(submit_dispatcher),
            &submit_cancellation,
            tool_fs_run_call(
                "tool-browser-chain-submit",
                "/tools/browser/submit",
                json!({
                    "tabId": "browser-tab-1",
                    "targetMode": "live",
                    "targetRef": "target-continue",
                    "effect": "submitExternal"
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
        .expect("allow submit permission");
    let submitted = submit_handle.join().expect("join submit");
    assert_eq!(submitted["status"].as_str(), Some("completed"));
    assert!(submitted["changes"].as_array().is_some_and(|changes| {
        changes
            .iter()
            .any(|change| change["kind"] == "browser" && change["operation"] == "submit")
    }));

    let waited = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher.clone()),
        &cancellation,
        tool_fs_run_call(
            "tool-browser-chain-wait",
            "/tools/browser/wait",
            json!({ "tabId": "browser-tab-1", "targetMode": "live", "timeoutMs": 1000 }),
        ),
    );
    assert_eq!(waited["status"].as_str(), Some("completed"));
    assert!(
        waited["content"]
            .as_str()
            .is_some_and(|text| text.contains("Dashboard loaded"))
    );

    let read = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &cancellation,
        tool_fs_run_call(
            "tool-browser-chain-read",
            "/tools/browser/read",
            json!({ "tabId": "browser-tab-1", "targetMode": "live" }),
        ),
    );
    assert_eq!(read["status"].as_str(), Some("completed"));
    assert!(
        read["content"]
            .as_str()
            .is_some_and(|text| text.contains("Welcome to the dashboard"))
    );
    assert_eq!(
        calls.lock().expect("calls lock").as_slice(),
        [
            "lyraLumen.map",
            "lyraLumen.type",
            "lyraLumen.submit",
            "lyraLumen.wait",
            "lyraLumen.read"
        ]
    );
}

#[test]
fn direct_software_capability_cannot_bypass_task_contract_with_full_access() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Direct Software Contract Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    bind_test_user_message(&session_id, &turn_id);
    let invoked = Arc::new(AtomicBool::new(false));
    let invoked_for_dispatch = invoked.clone();
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |_method, _payload| {
        invoked_for_dispatch.store(true, Ordering::SeqCst);
        Ok("{}".to_string())
    });

    let output = execute_software_capability_tool_adapter(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        "tool-direct-software",
        "image-viewer",
        "image-viewer.readMetadata",
        json!({
            "path": "photo.png",
            "permissionMode": "full_access"
        }),
        &now(),
    );

    assert_eq!(
        output.pointer("/error/code").and_then(Value::as_str),
        Some("task_contract_required")
    );
    assert!(!invoked.load(Ordering::SeqCst));
}

#[test]
fn tool_fs_dynamic_software_capabilities_are_discoverable_and_runnable() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Dynamic Software Tool Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let captured_invocation = Arc::new(Mutex::new(None::<Value>));
    let captured_for_dispatch = captured_invocation.clone();
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, payload| {
        let input: Value = serde_json::from_str(&payload).expect("payload json");
        match method.as_str() {
            "software.listCapabilities" => {
                assert_eq!(input["includeSchemas"], true);
                Ok(serde_json::to_string(&json!({
                    "software": [{
                        "id": "image-viewer",
                        "title": "Image Viewer",
                        "description": "Inspect local image files.",
                        "source": "builtin",
                        "actions": [{
                            "id": "image-viewer.readMetadata",
                            "title": "Read Image Metadata",
                            "description": "Read metadata for one image file.",
                            "risk": "read",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "path": { "type": "string" }
                                },
                                "required": ["path"]
                            }
                        }, {
                            "id": "image-viewer.applyFilter",
                            "title": "Apply Image Filter",
                            "description": "Apply a filter to the active image.",
                            "risk": "write",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "path": { "type": "string" },
                                    "filter": { "type": "string" }
                                },
                                "required": ["path", "filter"]
                            }
                        }]
                    }]
                }))
                .expect("json"))
            }
            "software.invokeCapability" => {
                *captured_for_dispatch
                    .lock()
                    .expect("captured invocation lock") = Some(input.clone());
                if input["actionId"] == "image-viewer.applyFilter" {
                    Ok(serde_json::to_string(&json!({
                        "softwareId": "image-viewer",
                        "actionId": "image-viewer.applyFilter",
                        "ok": true,
                        "output": {
                            "applied": true,
                            "filter": input["input"]["filter"].clone()
                        }
                    }))
                    .expect("json"))
                } else {
                    Ok(serde_json::to_string(&json!({
                        "softwareId": "image-viewer",
                        "actionId": "image-viewer.readMetadata",
                        "output": {
                            "width": 640,
                            "height": 480
                        }
                    }))
                    .expect("json"))
                }
            }
            other => panic!("unexpected method {other}"),
        }
    });
    let dynamic_path = "/tools/software/capability/image-viewer/image-viewer.readMetadata";
    let mutation_path = "/tools/software/capability/image-viewer/image-viewer.applyFilter";
    let list_output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher.clone()),
        &Arc::new(AtomicBool::new(false)),
        ModelToolCall {
            id: "tool-software-list".to_string(),
            name: "tool_fs_list".to_string(),
            arguments: json!({
                "path": "/tools/software/capability"
            }),
        },
    );
    assert!(
        list_output
            .pointer("/raw/tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| tools
                .iter()
                .any(|tool| tool.get("path").and_then(Value::as_str) == Some(dynamic_path)))
    );
    let inspect_output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher.clone()),
        &Arc::new(AtomicBool::new(false)),
        ModelToolCall {
            id: "tool-software-inspect".to_string(),
            name: "tool_fs_inspect".to_string(),
            arguments: json!({
                "path": dynamic_path
            }),
        },
    );
    assert_eq!(
        inspect_output.pointer("/raw/title").and_then(Value::as_str),
        Some("Read Image Metadata")
    );
    assert_eq!(
        inspect_output
            .pointer("/raw/inputSchema/$id")
            .and_then(Value::as_str),
        Some(
            "lyra-tool-fs://schema/tools/software/capability/image-viewer/image-viewer.readMetadata/input"
        )
    );
    let run_session_id = session_id.clone();
    let run_turn_id = turn_id.clone();
    let run_dispatcher = dispatcher.clone();
    let run_handle = thread::spawn(move || {
        execute_model_tool(
            &run_session_id,
            &run_turn_id,
            &Some(run_dispatcher),
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-software-run",
                dynamic_path,
                json!({ "path": "photo.png" }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id.clone(), "permissionId": permission_id, "allowed": true }),
        )
        .expect("allow software invocation permission");
    let run_output = run_handle.join().expect("join software run");
    assert_eq!(run_output["status"], "completed");
    assert_eq!(run_output["toolPath"], dynamic_path);
    assert_eq!(run_output["manifestTitle"], "Read Image Metadata");
    assert!(
        run_output["changes"]
            .as_array()
            .is_none_or(|changes| changes.is_empty())
    );
    let invocation = captured_invocation
        .lock()
        .expect("captured invocation lock")
        .clone()
        .expect("captured invocation");
    assert_eq!(invocation["softwareId"], "image-viewer");
    assert_eq!(invocation["actionId"], "image-viewer.readMetadata");
    assert_eq!(invocation["input"]["path"], "photo.png");
    assert!(invocation["input"].get("toolPath").is_none());

    let missing_contract_turn_id = start_test_runtime_turn(&session_id);
    bind_test_user_message(&session_id, &missing_contract_turn_id);
    let blocked_mutation = execute_model_tool(
        &session_id,
        &missing_contract_turn_id,
        &Some(dispatcher.clone()),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call_with_permission_mode(
            "tool-software-mutation-without-contract",
            mutation_path,
            json!({ "path": "photo.png", "filter": "sharpen" }),
            "full_access",
        ),
    );
    assert_eq!(blocked_mutation["status"], "failed");
    assert_eq!(
        blocked_mutation
            .pointer("/error/code")
            .and_then(Value::as_str),
        Some("task_contract_required")
    );

    let mutation_session_id = session_id.clone();
    let mutation_turn_id =
        start_test_runtime_turn_with_contract(&session_id, "control", &["other"]);
    let mutation_dispatcher = dispatcher.clone();
    let mutation_handle = thread::spawn(move || {
        execute_model_tool(
            &mutation_session_id,
            &mutation_turn_id,
            &Some(mutation_dispatcher),
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-software-mutation",
                mutation_path,
                json!({ "path": "photo.png", "filter": "sharpen" }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id, "permissionId": permission_id, "allowed": true }),
        )
        .expect("allow software mutation permission");
    let mutation_output = mutation_handle.join().expect("join software mutation");
    assert_eq!(mutation_output["status"], "completed");
    assert_eq!(mutation_output["toolPath"], mutation_path);
    assert_eq!(
        mutation_output
            .pointer("/raw/policyDecision/mode")
            .and_then(Value::as_str),
        Some("user_prompt")
    );
    assert!(
        mutation_output["changes"]
            .as_array()
            .is_some_and(|changes| changes.iter().any(|change| {
                change["kind"] == "external"
                    && change["operation"] == "invoke_capability"
                    && change["path"] == mutation_path
                    && change["reversible"] == false
            }))
    );
}

#[test]
fn tool_fs_dynamic_software_provider_failures_are_diagnostic_not_fatal() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Dynamic Software Provider Diagnostics Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let no_host = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        ModelToolCall {
            id: "tool-software-no-host".to_string(),
            name: "tool_fs_list".to_string(),
            arguments: json!({ "path": "/tools/software/capability" }),
        },
    );
    assert_eq!(no_host["status"].as_str(), Some("completed"));
    assert_eq!(no_host["raw"]["path"], "/tools/software/capability");
    assert_eq!(no_host["raw"]["tools"].as_array().map(Vec::len), Some(0));
    assert_eq!(
        no_host
            .pointer("/raw/diagnostics/0/code")
            .and_then(Value::as_str),
        Some("host_unavailable")
    );

    let failing_dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, _payload| {
        assert_eq!(method, "software.listCapabilities");
        Err("software registry offline".to_string())
    });
    let provider_failed = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(failing_dispatcher),
        &Arc::new(AtomicBool::new(false)),
        ModelToolCall {
            id: "tool-software-provider-failed".to_string(),
            name: "tool_fs_list".to_string(),
            arguments: json!({ "path": "/tools/software/capability" }),
        },
    );
    assert_eq!(provider_failed["status"].as_str(), Some("completed"));
    assert_eq!(
        provider_failed
            .pointer("/raw/diagnostics/0/code")
            .and_then(Value::as_str),
        Some("dynamic_provider_failed")
    );
    assert!(
        provider_failed
            .pointer("/raw/diagnostics/0/message")
            .and_then(Value::as_str)
            .is_some_and(|message| message.contains("software registry offline"))
    );

    let browser_no_host = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        ModelToolCall {
            id: "tool-browser-no-host".to_string(),
            name: "tool_fs_list".to_string(),
            arguments: json!({ "path": "/tools/browser" }),
        },
    );
    assert_eq!(browser_no_host["status"].as_str(), Some("completed"));
    assert!(
        browser_no_host
            .pointer("/raw/tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| !tools.is_empty())
    );
    assert_eq!(
        browser_no_host
            .pointer("/raw/diagnostics/0/code")
            .and_then(Value::as_str),
        Some("host_unavailable")
    );
    assert_eq!(
        browser_no_host
            .pointer("/raw/diagnostics/0/domain")
            .and_then(Value::as_str),
        Some("browser")
    );

    let workbench_no_host = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        ModelToolCall {
            id: "tool-workbench-no-host".to_string(),
            name: "tool_fs_list".to_string(),
            arguments: json!({ "path": "/tools/workbench" }),
        },
    );
    assert_eq!(workbench_no_host["status"].as_str(), Some("completed"));
    assert!(
        workbench_no_host
            .pointer("/raw/tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| !tools.is_empty())
    );
    assert_eq!(
        workbench_no_host
            .pointer("/raw/diagnostics/0/code")
            .and_then(Value::as_str),
        Some("host_unavailable")
    );
    assert_eq!(
        workbench_no_host
            .pointer("/raw/diagnostics/0/domain")
            .and_then(Value::as_str),
        Some("workbench")
    );
}

#[test]
fn registry_model_tools_have_dispatch_paths_and_unknown_tools_fail_structurally() {
    let service = ToolActivityService::default();
    assert_eq!(
        service.model_tool_names(),
        vec![
            "tool_fs_search".to_string(),
            "tool_fs_list".to_string(),
            "tool_fs_read_doc".to_string(),
            "tool_fs_inspect".to_string(),
            "tool_fs_run".to_string()
        ]
    );
    let names = service
        .model_tool_descriptors()
        .into_iter()
        .map(|descriptor| descriptor.name)
        .collect::<Vec<_>>();
    let provider_tool_names = expected_provider_tool_names();
    for required in [
        "file_read",
        "file_list",
        "file_glob",
        "file_write",
        "file_edit",
        "file_multiedit",
        "shell_run",
        "terminal_list",
        "terminal_read",
        "terminal_write",
        "code_grep_text",
        "lsp_query",
        "web_search",
        "web_fetch",
        "todo_read",
    ] {
        assert!(names.contains(&required.to_string()), "{required} exposed");
        assert!(
            service.can_dispatch_model_tool(required),
            "{required} dispatchable"
        );
        assert!(
            !provider_tool_names.iter().any(|name| name == required),
            "{required} must stay out of provider-visible schema"
        );
    }
    let registry = tool_fs::runtime_registry();
    let root_summary = registry.root_summary();
    let registry_domains = root_summary["domains"]
        .as_array()
        .expect("registry domains")
        .iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    for domain in [
        "terminal",
        "workbench",
        "browser",
        "browser_ax",
        "software",
        "web",
        "todo",
        "memory",
        "skills",
        "mcp",
    ] {
        assert!(
            registry_domains.contains(&domain),
            "/tools must expose {domain} as a public discovery domain"
        );
    }
    for manifest in registry.manifests() {
        assert!(
            manifest.path.starts_with("/tools/"),
            "{} path must stay under /tools",
            manifest.path
        );
        assert!(
            !manifest.title.trim().is_empty(),
            "{} title must be present",
            manifest.path
        );
        assert!(
            !manifest.summary.trim().is_empty(),
            "{} summary must be present",
            manifest.path
        );
        assert_eq!(
            manifest.input_schema.get("type").and_then(Value::as_str),
            Some("object"),
            "{} input schema must be an object",
            manifest.path
        );
        assert_eq!(
            manifest.input_schema.get("$id").and_then(Value::as_str),
            Some(lyra_tool_fs_core::schema_id_for_path(&manifest.path).as_str()),
            "{} input schema must expose stable Tool-FS schema id",
            manifest.path
        );
        assert!(
            tool_fs::runtime_target_for_manifest(manifest).is_some(),
            "Tool-FS manifest lacks runtime target: {}",
            manifest.path
        );
        assert!(
            !manifest.permission_policy.trim().is_empty(),
            "{} permission policy must be explicit",
            manifest.path
        );
        assert!(
            !manifest.risk_level.trim().is_empty(),
            "{} risk level must be explicit",
            manifest.path
        );
        assert!(
            !manifest.activity_kind.trim().is_empty() && !manifest.renderer_hint.trim().is_empty(),
            "{} activity projection hints must be explicit",
            manifest.path
        );
    }
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Unknown Tool Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        ModelToolCall {
            id: "tool-missing".to_string(),
            name: "missing_tool".to_string(),
            arguments: json!({}),
        },
    );
    assert_eq!(
        output.pointer("/error/code").and_then(Value::as_str),
        Some("tool_not_found")
    );
    assert_eq!(output["truncated"], false);
}

#[test]
fn browser_ax_tools_dispatch_to_ax_host_methods_with_expected_risk() {
    let registry = tools::tool_fs::runtime_registry();
    let by_path = |path: &str| {
        registry
            .manifests()
            .into_iter()
            .find(|manifest| manifest.path == path)
            .unwrap_or_else(|| panic!("missing browser_ax manifest {path}"))
    };

    for (path, host_method) in [
        ("/tools/browser_ax/map", "lyraAx.map"),
        ("/tools/browser_ax/query", "lyraAx.query"),
        ("/tools/browser_ax/act", "lyraAx.act"),
        ("/tools/browser_ax/focus", "lyraAx.focus"),
        ("/tools/browser_ax/press", "lyraAx.press"),
        ("/tools/browser_ax/explain", "lyraAx.explain"),
    ] {
        let manifest = by_path(path);
        assert_eq!(manifest.domain, "browser_ax", "{path} domain");
        let target = tools::tool_fs::runtime_target_for_manifest(&manifest)
            .unwrap_or_else(|| panic!("{path} has no runtime target"));
        match target {
            tools::tool_fs::RuntimeToolTarget::HostAdapter {
                host_method: actual,
                display_name,
                ..
            } => {
                assert_eq!(actual, host_method, "{path} host method");
                assert_eq!(display_name, "lyra_ax", "{path} display name");
            }
            _ => panic!("{path} must dispatch to a host adapter"),
        }
    }

    let act = by_path("/tools/browser_ax/act");
    assert_eq!(act.risk_level, "browser");
    assert_eq!(act.permission_policy, "ask_on_risk");
    let press = by_path("/tools/browser_ax/press");
    assert_eq!(press.permission_policy, "ask_on_risk");
    let map = by_path("/tools/browser_ax/map");
    assert_eq!(map.risk_level, "read");
    assert_eq!(map.permission_policy, "runtime_policy");
    assert_eq!(map.renderer_hint, "lumen");
    assert_eq!(map.activity_kind, "web");
}
