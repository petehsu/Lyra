use lyra_render_core::{RenderDocumentMode, RenderDocumentOptions, render_document};
use serde_json::{Value, json};

const RENDER_SNAPSHOT_VERSION: u64 = 2;

pub(crate) fn render_assistant_markdown(text: &str, streaming: bool) -> Value {
    if text.is_empty() {
        return json!({ "blocks": [] });
    }
    let mut options = RenderDocumentOptions::default();
    options.mode = if streaming {
        RenderDocumentMode::Fragment
    } else {
        RenderDocumentMode::Document
    };
    let document = render_document(text, &options);
    serde_json::to_value(document).unwrap_or_else(|_| json!({ "blocks": [] }))
}

fn next_render_revision(message: &mut Value) -> u64 {
    let next = message
        .get("renderRevision")
        .and_then(Value::as_u64)
        .unwrap_or(0)
        .saturating_add(1);
    message["renderRevision"] = json!(next);
    next
}

pub(crate) fn enrich_assistant_message_render(
    message: &mut Value,
    streaming: bool,
) -> (Value, u64) {
    let text = message
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let revision = next_render_revision(message);
    let render_document = render_assistant_markdown(&text, streaming);
    message["renderDocument"] = render_document.clone();
    message["renderSnapshotVersion"] = json!(RENDER_SNAPSHOT_VERSION);

    if let Some(blocks) = message.get_mut("blocks").and_then(Value::as_array_mut) {
        for block in blocks.iter_mut() {
            if block.get("type").and_then(Value::as_str) != Some("text") {
                continue;
            }
            let block_id = block.get("id").and_then(Value::as_str).unwrap_or("text-0");
            if block_id == "text-0" {
                block["renderDocument"] = render_document.clone();
                block["renderRevision"] = json!(revision);
                block["renderSnapshotVersion"] = json!(RENDER_SNAPSHOT_VERSION);
            }
        }
    }

    (render_document, revision)
}

fn assistant_message_needs_render_enrichment(message: &Value) -> bool {
    if message.get("role").and_then(Value::as_str) != Some("assistant") {
        return false;
    }
    let has_text = message
        .get("text")
        .and_then(Value::as_str)
        .is_some_and(|text| !text.is_empty());
    if !has_text {
        return false;
    }
    message.get("renderDocument").is_none()
        || message.get("renderSnapshotVersion").and_then(Value::as_u64)
            != Some(RENDER_SNAPSHOT_VERSION)
}

/// Backfill render snapshots for assistant messages persisted before agent-side AST.
pub(crate) fn enrich_session_messages_render(snapshot: &mut Value) -> bool {
    let Some(messages) = snapshot.get_mut("messages").and_then(Value::as_array_mut) else {
        return false;
    };
    let mut changed = false;
    for message in messages.iter_mut() {
        if !assistant_message_needs_render_enrichment(message) {
            continue;
        }
        enrich_assistant_message_render(message, false);
        changed = true;
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn enrich_assistant_message_sets_render_snapshot_on_message_and_block() {
        let mut message = json!({
            "id": "message-1",
            "role": "assistant",
            "text": "**hello**",
            "blocks": [{ "type": "text", "id": "text-0", "text": "**hello**" }]
        });
        let (document, revision) = enrich_assistant_message_render(&mut message, false);
        assert_eq!(revision, 1);
        assert_eq!(message["renderDocument"], document);
        assert_eq!(message["renderSnapshotVersion"], RENDER_SNAPSHOT_VERSION);
        assert_eq!(message["blocks"][0]["renderDocument"], document);
        assert_eq!(message["blocks"][0]["renderRevision"], 1);
        assert_eq!(
            message["blocks"][0]["renderSnapshotVersion"],
            RENDER_SNAPSHOT_VERSION
        );
    }

    #[test]
    fn enrich_session_messages_render_backfills_missing_snapshots_only() {
        let mut snapshot = json!({
            "messages": [
                {
                    "id": "message-1",
                    "role": "assistant",
                    "text": "Hi",
                    "blocks": [{ "type": "text", "id": "text-0", "text": "Hi" }]
                },
                {
                    "id": "message-2",
                    "role": "user",
                    "text": "Question",
                    "blocks": [{ "type": "text", "id": "text-0", "text": "Question" }]
                }
            ]
        });
        assert!(enrich_session_messages_render(&mut snapshot));
        assert!(snapshot["messages"][0]["renderDocument"].is_object());
        assert!(snapshot["messages"][1].get("renderDocument").is_none());
    }

    #[test]
    fn enrich_session_messages_render_refreshes_old_render_snapshots() {
        let mut snapshot = json!({
            "messages": [{
                "id": "message-1",
                "role": "assistant",
                "text": "**hello**world",
                "renderDocument": { "blocks": [] },
                "renderSnapshotVersion": 1,
                "blocks": [{
                    "type": "text",
                    "id": "text-0",
                    "text": "**hello**world",
                    "renderDocument": { "blocks": [] },
                    "renderSnapshotVersion": 1
                }]
            }]
        });
        assert!(enrich_session_messages_render(&mut snapshot));
        assert_eq!(
            snapshot["messages"][0]["renderSnapshotVersion"],
            RENDER_SNAPSHOT_VERSION
        );
        assert!(
            snapshot["messages"][0]["renderDocument"]["blocks"]
                .as_array()
                .is_some_and(|blocks| !blocks.is_empty())
        );
    }
}
