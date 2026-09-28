use crate::native_backend::browser_loop_detector::visual;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

pub(super) fn image_message(content: Value, args: &Value, output: &Value) -> Value {
    let mut message = json!({"role":"user", "content":content});
    if let Some(scene) = visual::scene(output) {
        let images = message["content"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|part| part["type"] == "image_url")
            .collect::<Vec<_>>();
        if !images.is_empty() {
            let digest = format!(
                "{:x}",
                Sha256::digest(serde_json::to_vec(&images).unwrap_or_default())
            );
            message["lyraVisualEvidence"] = json!({"scope":visual::scope(args, output, &scene),
                "captureId":scene["captureId"], "digest":digest});
        }
    }
    message
}

/// Bound only tool-generated browser images in the provider's working copy.
/// Full protocol/audit messages and user uploads remain intact and recoverable.
pub(super) fn compact(messages: &mut [Value]) {
    compact_scenes(messages);
    let mut counts = HashMap::<String, usize>::new();
    let mut seen = HashSet::new();
    let mut total = 0;
    for message in messages.iter_mut().rev() {
        let Some(meta) = message.get("lyraVisualEvidence") else {
            continue;
        };
        let Some(parts) = message["content"].as_array() else {
            continue;
        };
        if !parts.iter().any(|p| p["type"] == "image_url") {
            continue;
        }
        let (Some(scope), Some(digest)) = (meta["scope"].as_str(), meta["digest"].as_str()) else {
            continue;
        };
        let key = (scope.to_owned(), digest.to_owned());
        let count = counts.entry(scope.to_owned()).or_default();
        if total < 8 && *count < 2 && seen.insert(key) {
            *count += 1;
            total += 1;
            continue;
        }
        let capture = meta["captureId"].as_str().unwrap_or("unknown");
        let mut retained = parts
            .iter()
            .filter(|p| p["type"] != "image_url")
            .cloned()
            .collect::<Vec<_>>();
        retained.push(json!({"type":"text", "text":format!("Historical browser image {capture} omitted from working context; its tool result and saved image artifact remain available. Use the newest attached observation for current state.")}));
        message["content"] = Value::Array(retained);
    }
}

/// Keep recent complete observations in the working copy, with historical
/// receipts intact. Never edit provider reasoning or the persisted audit.
fn compact_scenes(messages: &mut [Value]) {
    let mut counts = HashMap::<String, usize>::new();
    for message in messages.iter_mut().rev() {
        if message["role"] != "tool" {
            continue;
        }
        let Some(content) = message["content"].as_str() else {
            continue;
        };
        let mut stream = serde_json::Deserializer::from_str(content).into_iter::<Value>();
        let Some(Ok(mut output)) = stream.next() else {
            continue;
        };
        let suffix = &content[stream.byte_offset()..];
        let Some(scene) = visual::scene(&output) else {
            continue;
        };
        if scene["historicalSummary"] == true {
            continue;
        }
        let key = format!(
            "{}|{}|{}",
            visual::scope(&json!({}), &output, &scene),
            scene["observationKind"],
            scene["view"]["region"]
        );
        let count = counts.entry(key).or_default();
        *count += 1;
        if *count <= 2 {
            continue;
        }
        let structures = scene.pointer("/rendered/structures").and_then(Value::as_array).map(|items| items.iter().map(|item| {
            json!({"mark":item["mark"],"rows":item["rows"],"columns":item["columns"],"changedCount":item["changedCount"],"counts":item["counts"]})
        }).collect::<Vec<_>>());
        let summary = json!({"historicalSummary":true,"captureId":scene["captureId"],"documentKey":scene["documentKey"],
            "observationKind":scene["observationKind"],"view":scene["view"],"pageText":scene["pageText"],"evidence":scene["evidence"],
            "lastInput":scene["lastInput"],"lastAction":scene["lastAction"],"structures":structures,
            "detail":"Historical full scene omitted from working context; original tool evidence remains saved. Use the latest full observation for current targets/state."});
        let mut replaced = false;
        for path in [
            "/raw/observation/scene",
            "/raw/scene",
            "/observation/scene",
            "/scene",
        ] {
            if let Some(value) = output.pointer_mut(path) {
                *value = summary.clone();
                replaced = true;
            }
        }
        if replaced {
            if output.get("mapAppendix").is_some() {
                output["mapAppendix"] = json!(
                    "Historical map details omitted; use the latest full scene/map for current controls. Original tool evidence remains saved."
                );
            }
            message["content"] = Value::String(format!("{output}{suffix}"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_complete_scenes_are_compacted_without_touching_receipts_reasoning_or_latest_state() {
        let mut messages=(0..5).map(|i|json!({"role":"tool","content":format!("{}\n\nEvidence activity ID: {i}",json!({"ok":true,"completed":1,"dispatched":true,"scene":{"captureId":i,"documentKey":"doc","observationKind":"structure","evidence":{"fingerprint":i.to_string()},"rendered":{"states":{"s1":{"layers":[{"text":"large original fact"}]}},"structures":[{"mark":"1","rows":15,"columns":15,"changedCount":2}]}}}))})).collect::<Vec<_>>();
        messages.push(
            json!({"role":"assistant","reasoning_content":"provider requires this","content":""}),
        );
        let audit = messages.clone();
        compact(&mut messages);
        assert!(
            messages[0]["content"]
                .as_str()
                .unwrap()
                .contains("historicalSummary")
        );
        let original = serde_json::Deserializer::from_str(messages[0]["content"].as_str().unwrap())
            .into_iter::<Value>()
            .next()
            .unwrap()
            .unwrap();
        assert_eq!(original["dispatched"], true);
        assert_eq!(original["completed"], 1);
        assert_eq!(&messages[3..], &audit[3..]);
        let once = messages.clone();
        compact(&mut messages);
        assert_eq!(messages, once);
        assert!(
            !audit[0]["content"]
                .as_str()
                .unwrap()
                .contains("historicalSummary")
        );
    }
    fn frame(scope: &str, capture: &str, digest: &str) -> Value {
        json!({"role":"user", "content":[{"type":"text","text":"Artifact: saved.png"},{"type":"image_url","image_url":{"url":digest}}],
            "lyraVisualEvidence":{"scope":scope,"captureId":capture,"digest":digest}})
    }
    fn has_image(value: &Value) -> bool {
        value["content"]
            .as_array()
            .is_some_and(|a| a.iter().any(|p| p["type"] == "image_url"))
    }
    #[test]
    fn keeps_latest_two_distinct_frames_and_all_user_uploads_without_mutating_audit() {
        let upload =
            json!({"role":"user","content":[{"type":"image_url","image_url":{"url":"user-file"}}]});
        let audit = vec![
            upload,
            frame("a", "1", "one"),
            frame("a", "2", "two"),
            frame("b", "3", "three"),
            frame("a", "4", "two"),
            frame("a", "5", "five"),
        ];
        let mut working = audit.clone();
        compact(&mut working);
        assert_eq!(
            working.iter().map(has_image).collect::<Vec<_>>(),
            vec![true, false, false, true, true, true]
        );
        assert!(audit.iter().all(has_image));
        assert!(
            working[1]["content"]
                .to_string()
                .contains("Artifact: saved.png")
        );
        let previous = working.clone();
        compact(&mut working);
        assert_eq!(working, previous);
    }
    #[test]
    fn bounds_many_documents_without_removing_tool_messages() {
        let mut messages = (0..12)
            .map(|i| frame(&i.to_string(), "c", "pixel"))
            .collect::<Vec<_>>();
        messages.insert(
            3,
            json!({"role":"tool","tool_call_id":"call","content":"receipt"}),
        );
        compact(&mut messages);
        assert_eq!(messages.iter().filter(|m| has_image(m)).count(), 8);
        assert_eq!(messages[3]["tool_call_id"], "call");
    }
    #[test]
    fn protocol_checkpoint_keeps_full_image_and_browser_provenance() {
        let original = frame("tab|doc", "capture", "pixels");
        let mut cursor = 0;
        let persisted = super::super::recovery::take_provider_protocol_auxiliary_messages(
            &[original.clone()],
            &mut cursor,
        );
        assert_eq!(persisted, vec![original]);
        assert_eq!(cursor, 1);
    }
    #[test]
    fn tags_only_browser_evidence_not_general_file_images() {
        let parts = json!([{"type":"image_url","image_url":{"url":"data:image/png;base64,abc"}}]);
        let scene =
            json!({"scene":{"captureId":"c","documentKey":"doc","evidence":{"fingerprint":"p"}}});
        assert!(
            image_message(parts.clone(), &json!({"tabId":"tab"}), &scene)
                .get("lyraVisualEvidence")
                .is_some()
        );
        assert!(
            image_message(parts, &json!({}), &json!({}))
                .get("lyraVisualEvidence")
                .is_none()
        );
    }
}
