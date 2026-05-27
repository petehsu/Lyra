use super::*;
use serde_json::json;

static HOST_CAPABILITY_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn test_context() -> ToolContext {
    ToolContext {
        session_id: "test-session".to_string(),
        message_id: "test-message".to_string(),
        tool_call_id: "test-call".to_string(),
        working_dir: None,
        stdin_request_tx: None,
        graceful_shutdown_signal: None,
        execution_mode: crate::tool::ToolExecutionMode::Direct,
    }
}

fn action_enum(schema: &Value) -> Vec<String> {
    schema["properties"]["action"]["enum"]
        .as_array()
        .expect("action enum")
        .iter()
        .map(|value| value.as_str().expect("string enum").to_string())
        .collect()
}

fn base_input(action: &str) -> LyraLumenInput {
    LyraLumenInput {
        action: action.into(),
        tab_id: None,
        url: None,
        element_id: None,
        interaction: None,
        text: None,
        key: None,
        direction: None,
        target: None,
        strategy: None,
        vision: None,
        point: None,
        steps: None,
        restore_focus: None,
        timeout_ms: None,
        max_chars: None,
        clear: None,
        new_tab: None,
    }
}

#[test]
fn schema_exposes_lyra_lumen_actions_and_removes_legacy_browser_actions() {
    let schema = LyraLumenTool::new().parameters_schema();
    let actions = action_enum(&schema);

    assert_eq!(
        actions,
        vec![
            "map",
            "focus_scan",
            "act",
            "type",
            "press",
            "submit",
            "navigate",
            "read",
            "see",
            "wait"
        ]
    );
    for legacy in [
        "status",
        "setup",
        "list_tabs",
        "new_tab",
        "snapshot",
        "get_content",
        "interactables",
        "click",
        "fill_form",
        "eval",
        "scroll",
        "observe",
        "focus",
        "screenshot",
        "map_elements",
        "virtual_interact",
        "virtual_type",
    ] {
        assert!(
            !actions.iter().any(|action| action == legacy),
            "legacy action should not be exposed: {legacy}"
        );
    }

    let props = schema["properties"].as_object().expect("properties");
    for legacy_field in [
        "selector",
        "script",
        "x",
        "y",
        "fields",
        "provider_action",
        "params",
    ] {
        assert!(
            !props.contains_key(legacy_field),
            "legacy field should not be exposed: {legacy_field}"
        );
    }
}

#[test]
fn map_routes_to_lyra_lumen_map_with_picker_default() {
    let input = LyraLumenInput {
        action: "map".into(),
        tab_id: Some(json!("browser-tab-1")),
        timeout_ms: Some(2_000),
        ..base_input("map")
    };

    let (method, payload, title) = lyra_lumen_request(&input).unwrap();
    assert_eq!(method, "lyraLumen.map");
    assert_eq!(title, "lyra_lumen map");
    assert_eq!(payload["tabId"], "browser-tab-1");
    assert_eq!(payload["strategy"], "picker");
    assert_eq!(payload["vision"], "auto");
    assert_eq!(payload["timeoutMs"], 2_000);
}

#[test]
fn act_maps_element_id_and_interaction() {
    let input = LyraLumenInput {
        element_id: Some(json!(7)),
        interaction: Some("hover".into()),
        ..base_input("act")
    };

    let (method, payload, _) = lyra_lumen_request(&input).unwrap();
    assert_eq!(method, "lyraLumen.act");
    assert_eq!(payload["elementId"], 7);
    assert_eq!(payload["interaction"], "hover");
}

#[test]
fn act_accepts_vision_point_when_element_id_is_unavailable() {
    let input = LyraLumenInput {
        point: Some(json!({ "x": 42, "y": 64, "reason": "vision fallback" })),
        interaction: Some("click".into()),
        vision: Some("force".into()),
        ..base_input("act")
    };

    let (method, payload, _) = lyra_lumen_request(&input).unwrap();
    assert_eq!(method, "lyraLumen.act");
    assert_eq!(payload["point"]["x"], 42.0);
    assert_eq!(payload["point"]["y"], 64.0);
    assert_eq!(payload["vision"], "force");
}

#[test]
fn type_accepts_focused_target_without_element_id_and_requires_text() {
    let missing_text = LyraLumenInput {
        element_id: Some(json!(2)),
        ..base_input("type")
    };
    assert!(lyra_lumen_request(&missing_text).is_err());

    let focused_input = LyraLumenInput {
        text: Some("focused hello".into()),
        ..base_input("type")
    };
    let (method, payload, _) = lyra_lumen_request(&focused_input).unwrap();
    assert_eq!(method, "lyraLumen.type");
    assert!(payload.get("elementId").is_none());
    assert_eq!(payload["text"], "focused hello");

    let input = LyraLumenInput {
        text: Some("hello".into()),
        clear: Some(true),
        ..missing_text
    };
    let (method, payload, _) = lyra_lumen_request(&input).unwrap();
    assert_eq!(method, "lyraLumen.type");
    assert_eq!(payload["elementId"], 2);
    assert_eq!(payload["text"], "hello");
    assert_eq!(payload["clear"], true);
}

#[test]
fn submit_defaults_to_enter_and_accepts_optional_element_id() {
    let focused = LyraLumenInput {
        ..base_input("submit")
    };
    let (method, payload, _) = lyra_lumen_request(&focused).unwrap();
    assert_eq!(method, "lyraLumen.submit");
    assert!(payload.get("elementId").is_none());
    assert_eq!(payload["key"], "Enter");

    let input = LyraLumenInput {
        element_id: Some(json!(41)),
        key: Some("Meta+Enter".into()),
        ..base_input("submit")
    };
    let (method, payload, _) = lyra_lumen_request(&input).unwrap();
    assert_eq!(method, "lyraLumen.submit");
    assert_eq!(payload["elementId"], 41);
    assert_eq!(payload["key"], "Meta+Enter");
}

#[test]
fn read_defaults_to_lightweight_focus_strategy() {
    let input = LyraLumenInput {
        max_chars: Some(4_000),
        ..base_input("read")
    };

    let (method, payload, _) = lyra_lumen_request(&input).unwrap();
    assert_eq!(method, "lyraLumen.read");
    assert_eq!(payload["strategy"], "focus");
    assert_eq!(payload["maxChars"], 4_000);
}

#[test]
fn focus_scan_maps_direction_steps_and_restore_focus() {
    let input = LyraLumenInput {
        direction: Some("scan".into()),
        target: Some("isolated".into()),
        steps: Some(8),
        restore_focus: Some(true),
        ..base_input("focus_scan")
    };

    let (method, payload, _) = lyra_lumen_request(&input).unwrap();
    assert_eq!(method, "lyraLumen.focusScan");
    assert_eq!(payload["direction"], "scan");
    assert_eq!(payload["target"], "isolated");
    assert_eq!(payload["steps"], 8);
    assert_eq!(payload["restoreFocus"], true);
}

#[test]
fn navigate_requires_url_and_preserves_new_tab() {
    let input = LyraLumenInput {
        url: Some("https://example.com".into()),
        new_tab: Some(true),
        ..base_input("navigate")
    };

    let (method, payload, _) = lyra_lumen_request(&input).unwrap();
    assert_eq!(method, "lyraLumen.navigate");
    assert_eq!(payload["url"], "https://example.com");
    assert_eq!(payload["newTab"], true);
}

#[tokio::test]
async fn see_attaches_lumen_vision_image() {
    use std::sync::Arc;

    let _guard = HOST_CAPABILITY_TEST_LOCK.lock().await;
    crate::lyra_runtime::clear_host_capability_dispatcher();
    let dispatcher = Arc::new(|method: String, _payload_json: String| {
        assert_eq!(method, "lyraLumen.see");
        Ok(json!({
            "ok": true,
            "kind": "lyraLumenSee",
            "imageBase64": "mock_base64_data_here"
        })
        .to_string())
    });
    crate::lyra_runtime::register_host_capability_dispatcher(dispatcher);

    let output = LyraLumenTool::new()
        .execute(json!({ "action": "see" }), test_context())
        .await
        .unwrap();

    assert_eq!(output.images.len(), 1);
    assert_eq!(output.images[0].media_type, "image/png");
    assert_eq!(output.images[0].data, "mock_base64_data_here");
    assert_eq!(
        output.images[0].label.as_deref(),
        Some("lyra lumen visual fallback")
    );
    assert_eq!(output.metadata.as_ref().unwrap()["backend"], "lyra_lumen");

    crate::lyra_runtime::clear_host_capability_dispatcher();
}

#[tokio::test]
async fn host_capability_failure_is_structured_not_bubbled_as_tool_error() {
    use std::sync::Arc;

    let _guard = HOST_CAPABILITY_TEST_LOCK.lock().await;
    crate::lyra_runtime::clear_host_capability_dispatcher();
    let dispatcher = Arc::new(|method: String, _payload_json: String| {
        assert_eq!(method, "lyraLumen.map");
        Err("renderer bridge unavailable".to_string())
    });
    crate::lyra_runtime::register_host_capability_dispatcher(dispatcher);

    let output = LyraLumenTool::new()
        .execute(json!({ "action": "map" }), test_context())
        .await
        .unwrap();

    assert!(output.output.contains("renderer bridge unavailable"));
    assert_eq!(output.metadata.as_ref().unwrap()["ok"], false);
    assert_eq!(
        output.metadata.as_ref().unwrap()["error"]["kind"],
        "hostCapabilityFailed"
    );

    crate::lyra_runtime::clear_host_capability_dispatcher();
}

#[test]
fn description_points_models_to_map_first_and_no_setup() {
    let tool = LyraLumenTool::new();
    let description = tool.description();
    assert!(description.contains("action='map'"));
    assert!(description.contains("element_id"));
    assert!(!description.contains("setup"));
}
