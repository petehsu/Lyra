#![cfg(test)]

use super::*;
use crate::native_backend::provider::ModelToolCall;

#[test]
fn omits_visible_text_when_model_returns_tool_calls_without_prose() {
    let visible = assistant_reply_visible_text(&crate::native_backend::provider::ModelReply {
        content: None,
        reasoning_content: None,
        tool_calls: vec![ModelToolCall {
            id: "call-1".to_string(),
            name: "tool_fs_run".to_string(),
            arguments: json!({ "path": "/tools/browser/map" }),
        }],
        ui_message_id: None,
        raw_stop_reason: None,
        provider_replay_protocol: None,
        provider_replay_items: Vec::new(),
        stop_signal: Default::default(),
        response_meta: Default::default(),
    });
    assert_eq!(visible, None);
}

#[test]
fn returns_model_prose_for_tool_rounds() {
    let visible = assistant_reply_visible_text(&crate::native_backend::provider::ModelReply {
        content: Some("Opening Google.".to_string()),
        reasoning_content: None,
        tool_calls: vec![ModelToolCall {
            id: "call-1".to_string(),
            name: "tool_fs_run".to_string(),
            arguments: json!({ "path": "/tools/browser/navigate" }),
        }],
        ui_message_id: None,
        raw_stop_reason: None,
        provider_replay_protocol: None,
        provider_replay_items: Vec::new(),
        stop_signal: Default::default(),
        response_meta: Default::default(),
    });
    assert_eq!(visible.as_deref(), Some("Opening Google."));
}

#[test]
fn finished_turn_status_releases_session_to_idle() {
    assert_eq!(session_turn_status_for_finish_status("finished"), "idle");
    assert_eq!(
        session_turn_status_for_finish_status("cancelled"),
        "cancelled"
    );
}

#[test]
fn reasoning_never_splits_visible_text() {
    let mut message = json!({
        "text": "先说一句。",
        "blocks": [{ "type": "text", "id": "text-0", "text": "先说一句。" }]
    });

    let thinking_id = append_reasoning_to_message(&mut message, "中间思考。", "thinking");
    let text_id = append_text_to_message(&mut message, "再说一句。");

    assert_eq!(thinking_id, "thinking-1");
    assert_eq!(text_id, "text-0");
    assert_eq!(
        message["blocks"],
        json!([
            { "type": "thinking", "id": "thinking-1", "text": "中间思考。", "status": "thinking" },
            { "type": "text", "id": "text-0", "text": "先说一句。再说一句。" }
        ])
    );
}

#[test]
fn reasoning_preserves_legacy_text_without_blocks() {
    let mut message = json!({
        "text": "先说一句。"
    });

    let thinking_id = append_reasoning_to_message(&mut message, "中间思考。", "thinking");

    assert_eq!(thinking_id, "thinking-1");
    assert_eq!(
        message["blocks"],
        json!([
            { "type": "thinking", "id": "thinking-1", "text": "中间思考。", "status": "thinking" },
            { "type": "text", "id": "text-0", "text": "先说一句。" }
        ])
    );
}

#[test]
fn reasoning_first_placeholder_keeps_reply_in_one_text_block() {
    let mut message = assistant_message_with_id("message-test".to_string(), String::new());

    let thinking_id = append_reasoning_to_message(&mut message, "先想一想。", "thinking");
    let first_text_id = append_text_to_message(&mut message, "你好！我可以直接在你");
    let second_text_id = append_text_to_message(&mut message, "这台电脑上干活。");

    assert_eq!(thinking_id, "thinking-1");
    assert_eq!(first_text_id, "text-0");
    assert_eq!(second_text_id, "text-0");
    assert_eq!(
        message["blocks"],
        json!([
            { "type": "thinking", "id": "thinking-1", "text": "先想一想。", "status": "thinking" },
            { "type": "text", "id": "text-0", "text": "你好！我可以直接在你这台电脑上干活。" }
        ])
    );
}

#[test]
fn interleaved_reasoning_accumulates_into_preceding_thinking_block() {
    let mut message = assistant_message_with_id("message-test".to_string(), String::new());

    append_text_to_message(&mut message, "开头一段。");
    append_reasoning_to_message(&mut message, "第一段思考。", "thinking");
    let first_text_id = append_text_to_message(&mut message, "继续正文。");
    append_reasoning_to_message(&mut message, "第二段思考。", "thinking");
    let second_text_id = append_text_to_message(&mut message, "结尾。");

    assert_eq!(first_text_id, "text-0");
    assert_eq!(second_text_id, "text-0");
    assert_eq!(
        message["blocks"],
        json!([
            { "type": "thinking", "id": "thinking-1", "text": "第一段思考。第二段思考。", "status": "thinking" },
            { "type": "text", "id": "text-0", "text": "开头一段。继续正文。结尾。" }
        ])
    );
}

#[test]
fn reasoning_after_tool_block_stays_with_tool_round() {
    let mut message = assistant_message_with_id("message-test".to_string(), String::new());

    append_text_to_message(&mut message, "先看下文件。");
    if let Some(blocks) = message.get_mut("blocks").and_then(Value::as_array_mut) {
        blocks.push(json!({ "type": "tool", "id": "tool-call-1", "toolId": "call-1" }));
    }
    let thinking_id = append_reasoning_to_message(&mut message, "工具结果想一想。", "thinking");
    let text_id = append_text_to_message(&mut message, "结论如下。");

    assert_eq!(thinking_id, "thinking-2");
    assert_eq!(text_id, "text-3");
    assert_eq!(
        message["blocks"],
        json!([
            { "type": "text", "id": "text-0", "text": "先看下文件。" },
            { "type": "tool", "id": "tool-call-1", "toolId": "call-1" },
            { "type": "thinking", "id": "thinking-2", "text": "工具结果想一想。", "status": "thinking" },
            { "type": "text", "id": "text-3", "text": "结论如下。" }
        ])
    );
}