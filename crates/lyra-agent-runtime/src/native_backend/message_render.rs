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

/// A cheap fingerprint of the inputs that determine the rendered AST: the text
/// itself plus the streaming flag (streaming uses `Fragment` mode, which skips
/// unclosed-marker auto-close, so the same text renders differently).
fn render_fingerprint(text: &str, streaming: bool) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    streaming.hash(&mut hasher);
    text.hash(&mut hasher);
    hasher.finish()
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

    // Skip the (expensive) re-render when neither the text nor the streaming
    // mode has changed since the last enrich. This is the common streaming case
    // where a delta re-emits identical text (e.g. a whitespace-only or repeated
    // token). We return the existing snapshot and revision without bumping it,
    // so the frontend treats the delta as render-unchanged.
    let fingerprint = render_fingerprint(&text, streaming);
    let unchanged = message
        .get("renderedTextHash")
        .and_then(Value::as_u64)
        .is_some_and(|previous| previous == fingerprint)
        && message.get("renderDocument").is_some()
        && message.get("renderSnapshotVersion").and_then(Value::as_u64)
            == Some(RENDER_SNAPSHOT_VERSION);
    if unchanged {
        let existing_document = message
            .get("renderDocument")
            .cloned()
            .unwrap_or_else(|| json!({ "blocks": [] }));
        let existing_revision = message
            .get("renderRevision")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        return (existing_document, existing_revision);
    }

    let revision = next_render_revision(message);
    let render_document = render_assistant_markdown(&text, streaming);
    message["renderDocument"] = render_document.clone();
    message["renderSnapshotVersion"] = json!(RENDER_SNAPSHOT_VERSION);
    message["renderedTextHash"] = json!(fingerprint);

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
    fn repeated_identical_text_does_not_bump_revision() {
        let mut message = json!({
            "id": "message-1",
            "role": "assistant",
            "text": "**hello**",
            "blocks": [{ "type": "text", "id": "text-0", "text": "**hello**" }]
        });
        let (_, first) = enrich_assistant_message_render(&mut message, true);
        // Same text + same streaming mode: dedup should return the same revision
        // without re-rendering.
        let (_, second) = enrich_assistant_message_render(&mut message, true);
        assert_eq!(first, second, "revision must not change for identical input");
    }

    #[test]
    fn changed_text_bumps_revision() {
        let mut message = json!({
            "id": "message-1",
            "role": "assistant",
            "text": "**hel",
            "blocks": [{ "type": "text", "id": "text-0", "text": "**hel" }]
        });
        let (_, first) = enrich_assistant_message_render(&mut message, true);
        message["text"] = json!("**hello**");
        let (_, second) = enrich_assistant_message_render(&mut message, true);
        assert_eq!(second, first + 1, "new text must bump the revision");
    }

    #[test]
    fn finalize_after_streaming_forces_rerender() {
        // Streaming pass leaves a fingerprint for (text, streaming=true).
        let mut message = json!({
            "id": "message-1",
            "role": "assistant",
            "text": "Hello **world",
            "blocks": [{ "type": "text", "id": "text-0", "text": "Hello **world" }]
        });
        let (streamed, first) = enrich_assistant_message_render(&mut message, true);
        // Finalize with the SAME text but streaming=false must re-render, because
        // Document mode auto-closes the dangling bold marker → different AST.
        let (finalized, second) = enrich_assistant_message_render(&mut message, false);
        assert_eq!(second, first + 1, "finalize must bump the revision");
        assert_ne!(
            streamed, finalized,
            "finalized AST should differ from the streamed fragment"
        );
    }

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
