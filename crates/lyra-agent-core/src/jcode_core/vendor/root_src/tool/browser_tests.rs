use super::*;

#[test]
fn press_script_uses_selector_when_present() {
    let script = build_press_script(Some("Enter"), Some("#email")).unwrap();
    assert!(script.contains("document.querySelector"));
    assert!(script.contains("Enter"));
}

#[test]
fn content_formatter_prefers_content_text() {
    let rendered = format_content_result(&json!({"content": "hello", "title": "x"}));
    assert_eq!(rendered, "hello");
}

#[test]
fn snapshot_maps_to_annotated_get_content() {
    let input = BrowserInput {
        action: "snapshot".into(),
        browser: None,
        provider_action: None,
        params: None,
        url: None,
        tab_id: Some(7),
        frame_id: Some(3),
        all_frames: Some(true),
        selector: None,
        text: None,
        contains: None,
        script: None,
        key: None,
        x: None,
        y: None,
        format: None,
        wait: None,
        new_tab: None,
        focus: None,
        clear: None,
        submit: None,
        page_world: None,
        position: None,
        behavior: None,
        timeout_ms: None,
        path: None,
        fields: None,
        scroll_to: None,
    };

    let (action, params, _) = bridge_request("snapshot", &input).unwrap();
    assert_eq!(action, "getContent");
    assert_eq!(params["format"], "annotated");
    assert_eq!(params["tabId"], 7);
    assert_eq!(params["frameId"], 3);
    assert_eq!(params["allFrames"], true);
}

#[test]
fn eval_maps_script_and_page_world() {
    let input = BrowserInput {
        action: "eval".into(),
        browser: None,
        provider_action: None,
        params: None,
        url: None,
        tab_id: None,
        frame_id: None,
        all_frames: None,
        selector: None,
        text: None,
        contains: None,
        script: Some("return document.title".into()),
        key: None,
        x: None,
        y: None,
        format: None,
        wait: None,
        new_tab: None,
        focus: None,
        clear: None,
        submit: None,
        page_world: Some(true),
        position: None,
        behavior: None,
        timeout_ms: None,
        path: None,
        fields: None,
        scroll_to: None,
    };

    let (action, params, _) = bridge_request("eval", &input).unwrap();
    assert_eq!(action, "evaluate");
    assert_eq!(params["script"], "return document.title");
    assert_eq!(params["pageWorld"], true);
}

#[test]
fn interactables_maps_to_bridge_action() {
    let input = BrowserInput {
        action: "interactables".into(),
        browser: None,
        provider_action: None,
        params: None,
        url: None,
        tab_id: Some(9),
        frame_id: None,
        all_frames: None,
        selector: Some("main".into()),
        text: None,
        contains: None,
        script: None,
        key: None,
        x: None,
        y: None,
        format: None,
        wait: None,
        new_tab: None,
        focus: None,
        clear: None,
        submit: None,
        page_world: None,
        position: None,
        behavior: None,
        timeout_ms: None,
        path: None,
        fields: None,
        scroll_to: None,
    };

    let (action, params, _) = bridge_request("interactables", &input).unwrap();
    assert_eq!(action, "getInteractables");
    assert_eq!(params["tabId"], 9);
    assert_eq!(params["selector"], "main");
}

#[test]
fn schema_exposes_advanced_browser_fields() {
    let schema = BrowserTool::new().parameters_schema();
    let props = schema["properties"]
        .as_object()
        .expect("browser schema should have properties");

    assert!(props.contains_key("action"));
    assert!(props.contains_key("browser"));
    assert!(props.contains_key("url"));
    assert!(props.contains_key("tab_id"));
    assert!(props.contains_key("frame_id"));
    assert!(props.contains_key("selector"));
    assert!(props.contains_key("text"));
    assert!(props.contains_key("contains"));
    assert!(props.contains_key("script"));
    assert!(props.contains_key("key"));
    assert!(props.contains_key("x"));
    assert!(props.contains_key("y"));
    assert!(props.contains_key("format"));
    assert!(props.contains_key("wait"));
    assert!(props.contains_key("new_tab"));
    assert!(props.contains_key("timeout_ms"));
    assert!(props.contains_key("path"));
    assert!(props.contains_key("fields"));
    assert!(props.contains_key("provider_action"));
    assert!(props.contains_key("params"));
    assert!(props.contains_key("all_frames"));
    assert!(props.contains_key("focus"));
    assert!(props.contains_key("clear"));
    assert!(props.contains_key("submit"));
    assert!(props.contains_key("page_world"));
    assert!(props.contains_key("position"));
    assert!(props.contains_key("behavior"));
    assert!(props.contains_key("scroll_to"));
}

#[test]
fn resolve_provider_accepts_auto_and_firefox() {
    assert!(resolve_provider(Some("auto")).is_ok());
    assert!(resolve_provider(Some("firefox")).is_ok());
}

#[test]
fn resolve_provider_rejects_unsupported_browser() {
    let err = resolve_provider(Some("opera"))
        .err()
        .expect("opera should not resolve yet");
    assert!(
        err.to_string()
            .contains("not wired into the built-in browser tool")
    );
}

#[tokio::test]
async fn lyra_provider_screenshot_extracts_base64() {
    use std::sync::Arc;
    let dispatcher = Arc::new(|method: String, _payload_json: String| {
        assert_eq!(method, "browser.screenshot");
        Ok(json!({ "data": "mock_base64_data_here" }).to_string())
    });
    crate::lyra_runtime::register_host_capability_dispatcher(dispatcher);

    let provider = &LYRA_PROVIDER;
    let input = BrowserInput {
        action: "screenshot".into(),
        browser: None,
        provider_action: None,
        params: None,
        url: None,
        tab_id: None,
        frame_id: None,
        all_frames: None,
        selector: None,
        text: None,
        contains: None,
        script: None,
        key: None,
        x: None,
        y: None,
        format: None,
        wait: None,
        new_tab: None,
        focus: None,
        clear: None,
        submit: None,
        page_world: None,
        position: None,
        behavior: None,
        timeout_ms: None,
        path: None,
        fields: None,
        scroll_to: None,
    };

    let ctx = ToolContext {
        session_id: "test-session".to_string(),
        message_id: "test-msg".to_string(),
        tool_call_id: "test-call".to_string(),
        working_dir: None,
        stdin_request_tx: None,
        graceful_shutdown_signal: None,
        execution_mode: crate::tool::ToolExecutionMode::Direct,
    };
    let output = provider.execute("screenshot", &input, &ctx).await.unwrap();

    assert_eq!(output.images.len(), 1);
    let img = &output.images[0];
    assert_eq!(img.media_type, "image/png");
    assert_eq!(img.data, "mock_base64_data_here");
    assert_eq!(img.label.as_deref(), Some("browser screenshot"));

    crate::lyra_runtime::clear_host_capability_dispatcher();
}

#[test]
fn prepend_setup_message_preserves_images_and_metadata() {
    let output = ToolOutput::new("done")
        .with_title("browser screenshot")
        .with_metadata(json!({"backend": "lyra_browser"}))
        .with_labeled_image("image/png", "abc", "shot");

    let output = prepend_setup_message(output, "setup log");
    assert!(output.output.starts_with("setup log\n\ndone"));
    assert_eq!(output.images.len(), 1);
    assert_eq!(output.title.as_deref(), Some("browser screenshot"));
    assert_eq!(output.metadata.as_ref().unwrap()["setup_ran"], true);
    assert_eq!(output.metadata.as_ref().unwrap()["backend"], "lyra_browser");
}

#[test]
fn description_tells_models_to_check_status_before_setup() {
    let tool = BrowserTool::new();
    let description = tool.description();
    assert!(description.contains("action='status'"));
    assert!(description.contains("action='setup' only"));
    assert!(description.contains("Do not run setup before every browser task"));
}
