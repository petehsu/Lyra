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
fn assistant_blocks_keep_text_after_reasoning_in_order() {
    let mut message = json!({
        "text": "先说一句。",
        "blocks": [{ "type": "text", "id": "text-0", "text": "先说一句。" }]
    });

    let thinking_id = append_reasoning_to_message(&mut message, "中间思考。", "thinking");
    let text_id = append_text_to_message(&mut message, "再说一句。");

    assert_eq!(thinking_id, "thinking-1");
    assert_eq!(text_id, "text-2");
    assert_eq!(
        message["blocks"],
        json!([
            { "type": "text", "id": "text-0", "text": "先说一句。" },
            { "type": "thinking", "id": "thinking-1", "text": "中间思考。", "status": "thinking" },
            { "type": "text", "id": "text-2", "text": "再说一句。" }
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
            { "type": "text", "id": "text-0", "text": "先说一句。" },
            { "type": "thinking", "id": "thinking-1", "text": "中间思考。", "status": "thinking" }
        ])
    );
}
