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

#[test]
fn schema_exposes_browser_agent_actions_and_removes_legacy_actions() {
    let schema = BrowserTool::new().parameters_schema();
    let actions = action_enum(&schema);

    assert_eq!(
        actions,
        vec![
            "observe",
            "act",
            "type",
            "press",
            "focus",
            "navigate",
            "read",
            "screenshot",
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
    for legacy_field in ["selector", "script", "x", "y", "fields", "provider_action", "params"] {
        assert!(
            !props.contains_key(legacy_field),
            "legacy field should not be exposed: {legacy_field}"
        );
    }
}

#[test]
fn observe_maps_to_browser_agent_observe_with_hybrid_default() {
    let input = BrowserInput {
        action: "observe".into(),
        tab_id: Some(json!("browser-tab-1")),
        url: None,
        element_id: None,
        interaction: None,
        text: None,
        key: None,
        direction: None,
        target: None,
        strategy: None,
        steps: None,
        restore_focus: None,
        timeout_ms: Some(2_000),
        max_chars: None,
        clear: None,
        new_tab: None,
    };

    let (method, payload, title) = browser_agent_request(&input).unwrap();
    assert_eq!(method, "browserAgent.observe");
    assert_eq!(title, "browser observe");
    assert_eq!(payload["tabId"], "browser-tab-1");
    assert_eq!(payload["strategy"], "hybrid");
    assert_eq!(payload["timeoutMs"], 2_000);
}

#[test]
fn act_maps_element_id_and_interaction() {
    let input = BrowserInput {
        action: "act".into(),
        tab_id: None,
        url: None,
        element_id: Some(json!(7)),
        interaction: Some("hover".into()),
        text: None,
        key: None,
        direction: None,
        target: None,
        strategy: None,
        steps: None,
        restore_focus: None,
        timeout_ms: None,
        max_chars: None,
        clear: None,
        new_tab: None,
    };

    let (method, payload, _) = browser_agent_request(&input).unwrap();
    assert_eq!(method, "browserAgent.act");
    assert_eq!(payload["elementId"], 7);
    assert_eq!(payload["interaction"], "hover");
}

#[test]
fn type_requires_element_id_and_text() {
    let missing_text = BrowserInput {
        action: "type".into(),
        tab_id: None,
        url: None,
        element_id: Some(json!(2)),
        interaction: None,
        text: None,
        key: None,
        direction: None,
        target: None,
        strategy: None,
        steps: None,
        restore_focus: None,
        timeout_ms: None,
        max_chars: None,
        clear: None,
        new_tab: None,
    };
    assert!(browser_agent_request(&missing_text).is_err());

    let input = BrowserInput {
        text: Some("hello".into()),
        clear: Some(true),
        ..missing_text
    };
    let (method, payload, _) = browser_agent_request(&input).unwrap();
    assert_eq!(method, "browserAgent.type");
    assert_eq!(payload["elementId"], 2);
    assert_eq!(payload["text"], "hello");
    assert_eq!(payload["clear"], true);
}

#[test]
fn focus_maps_direction_steps_and_restore_focus() {
    let input = BrowserInput {
        action: "focus".into(),
        tab_id: None,
        url: None,
        element_id: None,
        interaction: None,
        text: None,
        key: None,
        direction: Some("scan".into()),
        target: Some("isolated".into()),
        strategy: None,
        steps: Some(8),
        restore_focus: Some(true),
        timeout_ms: None,
        max_chars: None,
        clear: None,
        new_tab: None,
    };

    let (method, payload, _) = browser_agent_request(&input).unwrap();
    assert_eq!(method, "browserAgent.focus");
    assert_eq!(payload["direction"], "scan");
    assert_eq!(payload["target"], "isolated");
    assert_eq!(payload["steps"], 8);
    assert_eq!(payload["restoreFocus"], true);
}

#[test]
fn navigate_requires_url_and_preserves_new_tab() {
    let input = BrowserInput {
        action: "navigate".into(),
        tab_id: None,
        url: Some("https://example.com".into()),
        element_id: None,
        interaction: None,
        text: None,
        key: None,
        direction: None,
        target: None,
        strategy: None,
        steps: None,
        restore_focus: None,
        timeout_ms: None,
        max_chars: None,
        clear: None,
        new_tab: Some(true),
    };

    let (method, payload, _) = browser_agent_request(&input).unwrap();
    assert_eq!(method, "browserAgent.navigate");
    assert_eq!(payload["url"], "https://example.com");
    assert_eq!(payload["newTab"], true);
}

#[tokio::test]
async fn screenshot_attaches_browser_agent_image() {
    use std::sync::Arc;

    let _guard = HOST_CAPABILITY_TEST_LOCK.lock().await;
    crate::lyra_runtime::clear_host_capability_dispatcher();
    let dispatcher = Arc::new(|method: String, _payload_json: String| {
        assert_eq!(method, "browserAgent.capture");
        Ok(json!({
            "ok": true,
            "kind": "browserAgentCapture",
            "imageBase64": "mock_base64_data_here"
        })
        .to_string())
    });
    crate::lyra_runtime::register_host_capability_dispatcher(dispatcher);

    let output = BrowserTool::new()
        .execute(json!({ "action": "screenshot" }), test_context())
        .await
        .unwrap();

    assert_eq!(output.images.len(), 1);
    assert_eq!(output.images[0].media_type, "image/png");
    assert_eq!(output.images[0].data, "mock_base64_data_here");
    assert_eq!(output.images[0].label.as_deref(), Some("browser screenshot"));
    assert_eq!(
        output.metadata.as_ref().unwrap()["backend"],
        "lyra_browser_agent"
    );

    crate::lyra_runtime::clear_host_capability_dispatcher();
}

#[tokio::test]
async fn host_capability_failure_is_structured_not_bubbled_as_tool_error() {
    use std::sync::Arc;

    let _guard = HOST_CAPABILITY_TEST_LOCK.lock().await;
    crate::lyra_runtime::clear_host_capability_dispatcher();
    let dispatcher = Arc::new(|method: String, _payload_json: String| {
        assert_eq!(method, "browserAgent.observe");
        Err("renderer bridge unavailable".to_string())
    });
    crate::lyra_runtime::register_host_capability_dispatcher(dispatcher);

    let output = BrowserTool::new()
        .execute(json!({ "action": "observe" }), test_context())
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
fn description_points_models_to_observe_first_and_no_setup() {
    let tool = BrowserTool::new();
    let description = tool.description();
    assert!(description.contains("action='observe'"));
    assert!(description.contains("element_id"));
    assert!(!description.contains("setup"));
}
