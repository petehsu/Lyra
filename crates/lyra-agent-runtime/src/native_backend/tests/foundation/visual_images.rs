use super::*;

#[test]
fn browser_visual_action_returns_image_to_model_without_an_extra_see() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Visual Action Image Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn_with_contract(&session_id, "control", &["browser"]);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, payload| {
        let input: Value = serde_json::from_str(&payload).expect("payload json");
        assert_eq!(method, "lyraLumen.vact");
        assert_eq!(input["action"], "vact");
        assert_eq!(input["cell"], json!({"row":8,"column":9}));
        assert_eq!(input["settleTimeoutMs"], 700);
        Ok(serde_json::to_string(&json!({
            "ok": true,
            "kind": "lyraLumenVisualActionResult",
            "tabId": "browser-tab-1",
            "targetMode": "live",
            "completed": 1,
            "dispatched": true,
            "observation": { "scene": { "captureId": "scene-after-action", "marks": [
                {"mark":"b", "kind":"region", "role":"canvas", "bounds":{"x":0,"y":0,"width":400,"height":400},
                "grid":{"rows":15,"columns":15,"points":225,"source":"image-lines"}}
            ] } },
            "largeMap": "x".repeat(40000),
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

    let output = execute_model_tool_sync(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &CancellationToken::new(),
        tool_fs_run_call(
            "tool-inline-see",
            "/tools/browser/vact",
            json!({ "targetMode": "live", "captureId":"scene-1", "mark":"1", "cell":{"row":8,"column":9}, "settleTimeoutMs":700, "interaction":"hover", "effect":"observe" }),
        ),
    );

    assert_eq!(output["status"].as_str(), Some("completed"));
    assert!(output["raw"].get("imageBase64").is_none());
    assert!(output["raw"]["screenshot"].get("data").is_none());
    let content: Value = serde_json::from_str(output["content"].as_str().unwrap()).unwrap();
    assert_eq!(content["scene"]["captureId"], "scene-after-action");
    assert_eq!(content["scene"]["regions"][0]["mark"], "b");
    assert_eq!(content["scene"]["regions"][0]["grid"]["points"], 225);
    assert_eq!(content["completed"], 1);
    assert_eq!(output["raw"]["kind"], "tool_fs_raw_ref");
    let mut expanded = output["raw"].clone();
    expanded["largeMap"] = json!("x".repeat(40000));
    let budgeted = budgeted_tool_output(
        &session_id,
        &turn_id,
        "large-visual-result",
        output["content"].as_str().unwrap().to_string(),
        expanded,
        None,
    );
    assert!(
        budgeted["rawArtifactRef"].is_object(),
        "large raw maps should spill, not the image"
    );
    assert_eq!(
        budgeted.pointer("/raw/providerImage/path"),
        output.pointer("/raw/providerImage/path")
    );
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
fn visual_scene_format_preserves_dense_marks_and_partial_failure() {
    let marks: Vec<Value> = (0..160)
        .map(|i| {
            json!({"mark":i.to_string(),"kind":"control",
        "role":"button","bounds":{"x":1,"y":2,"width":100,"height":40}})
        })
        .collect();
    let scene = json!({"captureId":"new-frame","marks":marks,"totalVisible":200,"nextOffset":160,"documentKey":"doc","evidence":{"fingerprint":"pixels","regions":[]},"pageText":"Your turn","view":{"magnification":4},"lastAction":{"targetPixelsChanged":true}});
    let see: Value = serde_json::from_str(&format_lumen_output(
        "see",
        &json!({"ok":true,"scene":scene}),
    ))
    .unwrap();
    assert_eq!(see["scene"]["controls"].as_array().unwrap().len(), 160);
    assert_eq!(see["scene"]["captureId"], "new-frame");
    assert_eq!(see["scene"]["evidence"]["fingerprint"], "pixels");
    assert_eq!(see["scene"]["pageText"], "Your turn");
    assert_eq!(see["scene"]["view"]["magnification"], 4);
    assert_eq!(see["scene"]["lastAction"]["targetPixelsChanged"], true);
    let text = format_lumen_output(
        "vact",
        &json!({"ok":false,"completed":1,"dispatched":true,
        "reason":"target_changed_or_detached","observation":{"scene":scene},
        "results":[{"ok":true,"mapAppendix":"x".repeat(50000)}]}),
    );
    assert!(text.len() < 8000);
    let failed: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(failed["ok"], false);
    assert_eq!(failed["completed"], 1);
    assert_eq!(failed["scene"]["nextOffset"], 160);
}

#[test]
fn structured_scene_survives_map_and_action_formatting_without_image_or_capture_id() {
    let rendered = json!({"structures":[{"mark":"a","rows":9,"columns":11,"baseline":"s1","exceptions":[{"row":5,"column":6,"state":"s2"}]}],"states":{"s1":{"layers":[]},"s2":{"attributes":{"pressed":"true"}}}});
    let scene = json!({"captureId":"observed","documentKey":"doc","observationKind":"structure","rendered":rendered,"evidence":{"fingerprint":"render-sample"},"marks":[{"mark":"a","kind":"region","grid":{"rows":9,"columns":11}}]});
    let map =
        json!({"ok":true,"tabId":"tab","mapAppendix":"Remaining controls: Save","scene":scene});
    let formatted: Value = serde_json::from_str(&format_lumen_output("map", &map)).unwrap();
    assert_eq!(formatted["scene"]["rendered"], rendered);
    assert_eq!(formatted["mapAppendix"], "Remaining controls: Save");
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method("agent.session.create", json!({"title":"Structured scene"}))
        .unwrap();
    let id = created["id"].as_str().unwrap().to_owned();
    let turn = start_test_runtime_turn_with_contract(&id, "control", &["browser"]);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, payload| {
        assert_eq!(method, "lyraLumen.vact");
        let args: Value = serde_json::from_str(&payload).unwrap();
        assert!(args.get("captureId").is_none());
        assert_eq!(args["at"]["anchor"], "center");
        Ok(json!({"ok":true,"tabId":"tab","completed":1,"dispatched":true,"observation":{"scene":scene}}).to_string())
    });
    let output = execute_model_tool_sync(
        &id,
        &turn,
        &Some(dispatcher),
        &CancellationToken::new(),
        tool_fs_run_call(
            "marked-center",
            "/tools/browser/vact",
            json!({"mark":"a","at":{"anchor":"center"},"effect":"observe","interaction":"hover"}),
        ),
    );
    assert_eq!(output["status"], "completed", "{output}");
    let content: Value = serde_json::from_str(output["content"].as_str().unwrap()).unwrap();
    assert_eq!(content["scene"]["rendered"], rendered);
    assert!(content.get("imageArtifact").is_none());
}

#[test]
fn structured_wait_keeps_its_condition_and_new_text_in_provider_output() {
    let value = json!({"ok":true,"until":"textContains","matched":true,"completion":"conditionMet","content":"Completed","scene":{"captureId":"c","documentKey":"d","marks":[{"mark":"a","kind":"region","interactionEvidence":"occluding-hit-surface"}],"evidence":{"fingerprint":"fresh"}}});
    let formatted: Value = serde_json::from_str(&format_lumen_output("wait", &value)).unwrap();
    assert_eq!(formatted["matched"], true);
    assert_eq!(formatted["completion"], "conditionMet");
    assert_eq!(formatted["content"], "Completed");
    assert_eq!(
        formatted["scene"]["regions"][0]["interactionEvidence"],
        "occluding-hit-surface"
    );
}
