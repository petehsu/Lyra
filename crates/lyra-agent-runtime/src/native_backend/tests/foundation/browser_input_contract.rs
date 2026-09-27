use super::*;

#[test]
fn browser_effect_contract_reaches_host_without_escalation() {
    let created = LyraAgentBackend
        .call_agent_method(
            "agent.session.create",
            json!({"title":"Browser input contract"}),
        )
        .unwrap();
    let session_id = created["id"].as_str().unwrap();
    let payloads = Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
    let captured = payloads.clone();
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, payload| {
        assert_eq!(method, "lyraLumen.act");
        let input: Value = serde_json::from_str(&payload).unwrap();
        captured.lock().unwrap().push(input);
        Ok(json!({"ok":true,"kind":"lyraLumenActionResult","tabId":"native-fixture"}).to_string())
    });
    for (index, (effect, interaction, accepted)) in [
        ("observe", Some("hover"), true),
        ("editDraft", Some("click"), true),
        ("observe", None, false),
        ("editDraft", None, false),
        ("observe", Some("click"), false),
        ("delete", Some("hover"), false),
    ]
    .into_iter()
    .enumerate()
    {
        let turn_id = start_test_runtime_turn(session_id);
        bind_test_user_message(session_id, &turn_id);
        let mut args =
            json!({"tabId":"native-fixture","targetRef":"fixture-target","effect":effect});
        if let Some(interaction) = interaction {
            args["interaction"] = json!(interaction);
        }
        let output = execute_model_tool_sync(
            session_id,
            &turn_id,
            &Some(dispatcher.clone()),
            &CancellationToken::new(),
            tool_fs_run_call_with_permission_mode(
                &format!("contract-{index}"),
                "/tools/browser/act",
                args,
                "full_access",
            ),
        );
        assert_eq!(
            output["status"],
            if accepted { "completed" } else { "failed" },
            "{output}"
        );
    }
    let payloads = payloads.lock().unwrap();
    assert_eq!(
        payloads.len(),
        2,
        "contradictory actions must never reach input"
    );
    assert_eq!(payloads[0]["effect"], "observe");
    assert_eq!(payloads[0]["interaction"], "hover");
    assert_eq!(payloads[1]["effect"], "editDraft");
    assert_eq!(payloads[1]["interaction"], "click");
    // Optional handoff to the real Electron fixture, not a production endpoint.
    if let Ok(path) = std::env::var("LYRA_BROWSER_CONTRACT_FIXTURE") {
        std::fs::write(path, serde_json::to_vec(&*payloads).unwrap()).unwrap();
    }
}

#[test]
fn browser_read_provider_text_keeps_page_identity_and_extraction_contract() {
    let read = format_lumen_output(
        "read",
        &json!({
            "ok":true,"tabId":"account-picker","url":"https://example.test/device/account",
            "title":"Device Activation","content":"Device Activation", "truncated":false,
            "instruction":"Read the current step","schemaHint":{"type":"object"}
        }),
    );
    assert!(read.contains("https://example.test/device/account"));
    assert!(read.contains("account-picker"));
    assert!(read.contains("schemaHint"));
    assert!(read.ends_with("\nDevice Activation"));
}

#[test]
fn browser_upload_dispatches_only_with_upload_effect() {
    let created = LyraAgentBackend
        .call_agent_method("agent.session.create", json!({"title":"Upload contract"}))
        .unwrap();
    let session_id = created["id"].as_str().unwrap();
    let payloads = Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
    let captured = payloads.clone();
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, payload| {
        assert_eq!(method, "lyraLumen.upload");
        captured
            .lock()
            .unwrap()
            .push(serde_json::from_str(&payload).unwrap());
        Ok(json!({"ok":true,"status":"filesSelected","uploadCompletion":"notVerified","tabId":"upload-fixture"}).to_string())
    });
    for (index, effect) in ["observe", "editDraft", "upload"].into_iter().enumerate() {
        let turn_id = start_test_runtime_turn(session_id);
        bind_test_user_message(session_id, &turn_id);
        let output = execute_model_tool_sync(
            session_id,
            &turn_id,
            &Some(dispatcher.clone()),
            &CancellationToken::new(),
            tool_fs_run_call_with_permission_mode(
                &format!("upload-{index}"),
                "/tools/browser/upload",
                json!({"files":["/tmp/attachment.txt"],"targetRef":"lumen:attach","effect":effect}),
                "full_access",
            ),
        );
        assert_eq!(
            output["status"],
            if effect == "upload" {
                "completed"
            } else {
                "failed"
            },
            "{output}"
        );
    }
    let payloads = payloads.lock().unwrap();
    assert_eq!(payloads.len(), 1);
    assert_eq!(payloads[0]["files"], json!(["/tmp/attachment.txt"]));
    assert_eq!(payloads[0]["effect"], "upload");
    if let Ok(path) = std::env::var("LYRA_UPLOAD_CONTRACT_FIXTURE") {
        std::fs::write(path, serde_json::to_vec(&*payloads).unwrap()).unwrap();
    }
}

#[test]
fn pending_native_dialogs_keep_their_identity_in_every_provider_result() {
    let pending = json!({"ok":true,"status":"dialogPending","dialog":{"id":"dialog:opaque","type":"confirm","message":"Delete?"},"completion":"unknown","message":"A dialog is open"});
    for action in [
        "act", "type", "press", "map", "read", "wait", "drag", "dialog",
    ] {
        let decoded: Value = serde_json::from_str(&format_lumen_output(action, &pending)).unwrap();
        assert_eq!(decoded["dialog"]["id"], "dialog:opaque");
        assert_eq!(decoded["completion"], "unknown");
    }
}

#[test]
fn browser_new_gestures_route_through_the_effect_boundary() {
    let created = LyraAgentBackend
        .call_agent_method("agent.session.create", json!({"title":"Gesture contracts"}))
        .unwrap();
    let session_id = created["id"].as_str().unwrap();
    let calls = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let captured = calls.clone();
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, _| {
        captured.lock().unwrap().push(method.to_string());
        Ok(json!({"ok":true,"tabId":"fixture"}).to_string())
    });
    for (operation, args) in [
        ("reload", json!({"effect":"navigate"})),
        (
            "drag",
            json!({"targetRef":"lumen:source","toTargetRef":"lumen:dest","effect":"editDraft"}),
        ),
        (
            "dialog",
            json!({"dialogId":"dialog:opaque","accept":false,"effect":"editDraft"}),
        ),
    ] {
        let turn_id = start_test_runtime_turn(session_id);
        bind_test_user_message(session_id, &turn_id);
        let output = execute_model_tool_sync(
            session_id,
            &turn_id,
            &Some(dispatcher.clone()),
            &CancellationToken::new(),
            tool_fs_run_call_with_permission_mode(
                operation,
                &format!("/tools/browser/{operation}"),
                args,
                "full_access",
            ),
        );
        assert_eq!(output["status"], "completed", "{output}");
    }
    assert_eq!(
        *calls.lock().unwrap(),
        vec!["lyraLumen.reload", "lyraLumen.drag", "lyraLumen.dialog"]
    );
}
