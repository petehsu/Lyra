use super::*;

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
    let output = execute_model_tool_sync(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &CancellationToken::new(),
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
    let artifact_read = execute_model_tool_sync(
        &session_id,
        &turn_id,
        &None,
        &CancellationToken::new(),
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
    let output = execute_model_tool_sync(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &CancellationToken::new(),
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
