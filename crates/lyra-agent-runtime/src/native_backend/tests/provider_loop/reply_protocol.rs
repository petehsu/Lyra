use super::*;

#[test]
fn textual_tool_call_is_rejected_before_assistant_text_commit() {
    let mut reply = ModelReply {
        content: Some(
            "好的，我来帮你在工作区打开。\n\n[Tool call: software_invoke_capability({\"softwareId\":\"browser-search\",\"capabilityId\":\"browser-search.openUrl\",\"input\":{\"url\":\"https://vimeo.com/1148303712\"}})]"
                .to_string(),
        ),
        reasoning_content: None,
        tool_calls: Vec::new(),
        ui_message_id: None,
        raw_stop_reason: None,
        provider_replay_protocol: None,
        provider_replay_items: Vec::new(),
        response_meta: Default::default(),
        stop_signal: Default::default(),
    };

    let error = normalize_model_reply_protocol(&mut reply, &model_tools())
        .expect_err("textual tool calls must be rejected");
    assert!(error.to_string().contains("textual tool"));
}

#[test]
fn textual_tool_result_ref_is_rejected_before_assistant_text_commit() {
    let mut reply = ModelReply {
        content: Some(
            "让我搜索一下黑盒安全测试相关的开源项目。 [Tool result ref: call_2eddf41e08cf48b88bb7bc80]"
                .to_string(),
        ),
        reasoning_content: None,
        tool_calls: Vec::new(),
        ui_message_id: None,
        raw_stop_reason: None,
        provider_replay_protocol: None,
        provider_replay_items: Vec::new(),
        response_meta: Default::default(),
        stop_signal: Default::default(),
    };

    let error = normalize_model_reply_protocol(&mut reply, &model_tools())
        .expect_err("tool result ref placeholders must be rejected");
    assert!(error.to_string().contains("textual tool protocol leak"));
}

#[test]
fn visible_tool_preamble_without_native_tool_signal_is_not_reclassified() {
    let mut reply = ModelReply {
        content: Some("让我搜索一下黑盒安全测试相关的开源项目。".to_string()),
        reasoning_content: None,
        tool_calls: Vec::new(),
        ui_message_id: None,
        raw_stop_reason: None,
        provider_replay_protocol: None,
        provider_replay_items: Vec::new(),
        response_meta: Default::default(),
        stop_signal: Default::default(),
    };

    normalize_model_reply_protocol(&mut reply, &model_tools())
        .expect("visible prose alone must not infer provider tool intent");
    assert_eq!(
        reply.content.as_deref(),
        Some("让我搜索一下黑盒安全测试相关的开源项目。")
    );
}

#[test]
fn markdown_json_tool_call_snippet_is_rejected_as_protocol_error() {
    let mut reply = ModelReply {
        content: Some(
            r#"I will run this:

```json
{"path":"/tools/web/search","args":{"query":"Lyra"}}
```
"#
            .to_string(),
        ),
        reasoning_content: None,
        tool_calls: Vec::new(),
        ui_message_id: None,
        raw_stop_reason: None,
        provider_replay_protocol: None,
        provider_replay_items: Vec::new(),
        response_meta: Default::default(),
        stop_signal: Default::default(),
    };

    let error = normalize_model_reply_protocol(&mut reply, &model_tools())
        .expect_err("markdown JSON tool snippets must be rejected");
    assert!(error.to_string().contains("textual tool-call syntax"));
    assert!(reply.content.is_none());
}

#[test]
fn textual_provider_visible_function_call_is_rejected_as_protocol_error() {
    let mut reply = ModelReply {
        content: Some(
            "tool_fs_run({\"path\":\"/tools/workbench/list_tabs\",\"args\":{}})".to_string(),
        ),
        reasoning_content: None,
        tool_calls: Vec::new(),
        ui_message_id: None,
        raw_stop_reason: None,
        provider_replay_protocol: None,
        provider_replay_items: Vec::new(),
        response_meta: Default::default(),
        stop_signal: Default::default(),
    };

    let error = normalize_model_reply_protocol(&mut reply, &model_tools())
        .expect_err("function-like textual tool calls must be rejected");
    assert!(error.to_string().contains("textual tool-call syntax"));
    assert!(reply.content.is_none());
}

#[test]
fn leaked_xml_tool_calls_are_recovered_as_structured_calls() {
    let mut reply = ModelReply {
        content: Some(
            r#"好的，让我先看看目录。

<tool_calls>
<invoke name="exec_command">
<parameter name="command">ls -la /Users/petehsu/Documents/Lyra</parameter>
</invoke>
</tool_calls>
"#
            .to_string(),
        ),
        reasoning_content: None,
        tool_calls: Vec::new(),
        ui_message_id: None,
        raw_stop_reason: Some("stop".to_string()),
        provider_replay_protocol: None,
        provider_replay_items: Vec::new(),
        response_meta: Default::default(),
        stop_signal: TurnStopSignal::EndTurn,
    };

    normalize_model_reply_protocol(&mut reply, &model_tools())
        .expect("XML tool markup must be recovered, not shown");
    assert_eq!(reply.content.as_deref(), Some("好的，让我先看看目录。"));
    assert_eq!(reply.tool_calls.len(), 1);
    assert_eq!(reply.tool_calls[0].name, "exec_command");
    assert_eq!(
        reply.tool_calls[0].arguments["command"],
        "ls -la /Users/petehsu/Documents/Lyra"
    );
    assert_eq!(reply.stop_signal, TurnStopSignal::ToolUse);
}

#[test]
fn leaked_dsml_tool_calls_are_recovered_as_structured_calls() {
    let mut reply = ModelReply {
        content: Some(
            r#"先看看目录结构和关键文件。

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="exec_command">
<｜｜DSML｜｜parameter name="command">ls -la /Users/petehsu/Documents/Lyra</｜｜DSML｜｜parameter>
</｜｜DSML｜｜invoke>
<｜｜DSML｜｜invoke name="glob">
<｜｜DSML｜｜parameter name="pattern">*</｜｜DSML｜｜parameter>
<｜｜DSML｜｜parameter name="path">/Users/petehsu/Documents/Lyra</｜｜DSML｜｜parameter>
</｜｜DSML｜｜invoke>
</｜｜DSML｜｜tool_calls>
"#
            .to_string(),
        ),
        reasoning_content: None,
        tool_calls: Vec::new(),
        ui_message_id: None,
        raw_stop_reason: Some("stop".to_string()),
        provider_replay_protocol: None,
        provider_replay_items: Vec::new(),
        response_meta: Default::default(),
        stop_signal: TurnStopSignal::EndTurn,
    };

    normalize_model_reply_protocol(&mut reply, &[])
        .expect("DSML tool markup must be recovered even when tools were omitted");
    assert_eq!(reply.content.as_deref(), Some("先看看目录结构和关键文件。"));
    assert_eq!(reply.tool_calls.len(), 2);
    assert_eq!(reply.tool_calls[0].name, "exec_command");
    assert_eq!(reply.tool_calls[1].name, "glob");
    assert_eq!(reply.stop_signal, TurnStopSignal::ToolUse);
}

#[test]
fn textual_provider_visible_function_call_is_rejected_even_without_advertised_tools() {
    let mut reply = ModelReply {
        content: Some(
            "tool_fs_run({\"path\":\"/tools/workbench/list_tabs\",\"args\":{}})".to_string(),
        ),
        reasoning_content: None,
        tool_calls: Vec::new(),
        ui_message_id: None,
        raw_stop_reason: None,
        provider_replay_protocol: None,
        provider_replay_items: Vec::new(),
        response_meta: Default::default(),
        stop_signal: Default::default(),
    };

    let error = normalize_model_reply_protocol(&mut reply, &[])
        .expect_err("textual Tool-FS calls must be rejected without advertised tools");
    assert!(error.to_string().contains("textual tool-call syntax"));
    assert!(reply.content.is_none());
}
