use super::*;

pub(super) fn web_fetch_raw_summary(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    full_raw: &Value,
) -> Value {
    let raw_text = serde_json::to_string_pretty(full_raw)
        .or_else(|_| serde_json::to_string(full_raw))
        .unwrap_or_else(|_| "null".to_string());
    let original_raw_chars = raw_text.chars().count();
    let raw_artifact_ref = write_tool_artifact_with_kind(
        session_id,
        turn_id,
        &format!("{tool_call_id}-raw"),
        ToolArtifactKind::RawData,
        &raw_text,
    );
    json!({
        "kind": "web_fetch_summary",
        "retention": {
            "policy": "artifact_only_raw",
            "reason": "full web_fetch raw is stored as an artifact; session/model context keeps only compact summary fields",
            "originalRawChars": original_raw_chars,
        },
        "rawArtifactRef": raw_artifact_ref,
        "url": full_raw.get("url").cloned().unwrap_or(Value::Null),
        "engineUsed": full_raw.get("engineUsed").cloned().unwrap_or(Value::Null),
        "engineAttempts": full_raw.get("engineAttempts").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
        "outputLayers": full_raw.get("outputLayers").cloned().unwrap_or(Value::Null),
        "tokenBudget": full_raw.get("tokenBudget").cloned().unwrap_or(Value::Null),
        "finalUrl": full_raw.get("finalUrl").cloned().unwrap_or(Value::Null),
        "status": full_raw.get("status").cloned().unwrap_or(Value::Null),
        "contentType": full_raw.get("contentType").cloned().unwrap_or(Value::Null),
        "mimeType": full_raw.get("mimeType").cloned().unwrap_or(Value::Null),
        "format": full_raw.get("format").cloned().unwrap_or(Value::Null),
        "title": full_raw.get("title").cloned().unwrap_or(Value::Null),
        "compactText": truncate_summary_string(full_raw.get("compactText").and_then(Value::as_str).unwrap_or(""), 4_000),
        "counts": {
            "links": value_array_len(full_raw.get("links")),
            "images": value_array_len(full_raw.get("images")),
            "media": value_array_len(full_raw.get("media")),
            "chunks": value_array_len(full_raw.get("chunks")),
            "fitChunks": value_array_len(full_raw.get("fitChunks")),
            "warnings": value_array_len(full_raw.get("warnings")),
        },
        "links": value_array_sample(full_raw.get("links"), 20),
        "images": value_array_sample(full_raw.get("images"), 20),
        "media": value_array_sample(full_raw.get("media"), 20),
        "warnings": full_raw.get("warnings").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
        "filteredOutSummary": full_raw.get("filteredOutSummary").cloned().unwrap_or(Value::Null),
        "browser": browser_raw_summary(full_raw.get("browser").unwrap_or(&Value::Null)),
        "browserWarnings": full_raw.get("browserWarnings").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
        "browserDebug": full_raw.get("browserDebug").cloned().unwrap_or(Value::Null),
        "screenshotArtifactRef": full_raw.get("screenshotArtifactRef").cloned().unwrap_or(Value::Null),
        "pageshotArtifactRef": full_raw.get("pageshotArtifactRef").cloned().unwrap_or(Value::Null),
        "timing": full_raw.get("timing").cloned().unwrap_or(Value::Null),
        "frontmatter": full_raw.get("frontmatter").cloned().unwrap_or(Value::Null),
        "extraction": full_raw.get("extraction").cloned().unwrap_or(Value::Null),
        "truncated": full_raw.get("truncated").cloned().unwrap_or(Value::Null),
        "totalChars": full_raw.get("totalChars").cloned().unwrap_or(Value::Null),
        "hasMore": full_raw.get("hasMore").cloned().unwrap_or(Value::Null),
        "nextCursor": full_raw.get("nextCursor").cloned().unwrap_or(Value::Null),
        "recommendedNextAction": full_raw.get("recommendedNextAction").cloned().unwrap_or(Value::Null),
        "artifactRef": full_raw.get("artifactRef").cloned().unwrap_or(Value::Null),
        "indexResult": full_raw.get("indexResult").cloned().unwrap_or(Value::Null),
    })
}

fn browser_raw_summary(raw: &Value) -> Value {
    let Some(object) = raw.as_object() else {
        return Value::Null;
    };
    let mut summary = Map::new();
    for key in [
        "ok",
        "kind",
        "tabId",
        "finalUrl",
        "title",
        "viewport",
        "warnings",
        "screenshotArtifactRef",
        "pageshotArtifactRef",
    ] {
        if let Some(value) = object.get(key) {
            summary.insert(key.to_string(), value.clone());
        }
    }
    if let Some(selected) = object.get("selectedElement").and_then(Value::as_object) {
        let mut selected_summary = Map::new();
        for key in ["selector", "text", "bounds"] {
            if let Some(value) = selected.get(key) {
                selected_summary.insert(
                    key.to_string(),
                    if key == "text" {
                        Value::String(truncate_summary_string(value.as_str().unwrap_or(""), 1_000))
                    } else {
                        value.clone()
                    },
                );
            }
        }
        if let Some(html) = selected.get("html").and_then(Value::as_str) {
            selected_summary.insert("htmlChars".to_string(), json!(html.chars().count()));
        }
        summary.insert(
            "selectedElement".to_string(),
            Value::Object(selected_summary),
        );
    }
    for key in ["frames", "shadowRoots", "media"] {
        if let Some(value) = object.get(key) {
            summary.insert(format!("{key}Count"), json!(value_array_len(Some(value))));
            summary.insert(key.to_string(), value_array_sample(Some(value), 10));
        }
    }
    if let Some(ax_elements) = object.get("axElements") {
        let count = value_array_len(Some(ax_elements));
        let interactive = ax_elements
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter(|item| {
                        item.get("isInteractive")
                            .and_then(Value::as_bool)
                            .unwrap_or(false)
                    })
                    .count()
            })
            .unwrap_or(0);
        summary.insert("axElementCount".to_string(), json!(count));
        summary.insert("axInteractiveCount".to_string(), json!(interactive));
        summary.insert(
            "axElements".to_string(),
            value_array_sample(Some(ax_elements), 20),
        );
    }
    Value::Object(summary)
}

fn value_array_len(value: Option<&Value>) -> usize {
    value.and_then(Value::as_array).map(Vec::len).unwrap_or(0)
}

fn value_array_sample(value: Option<&Value>, max_items: usize) -> Value {
    let Some(items) = value.and_then(Value::as_array) else {
        return Value::Array(Vec::new());
    };
    Value::Array(items.iter().take(max_items).cloned().collect())
}

fn truncate_summary_string(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut output = text.chars().take(max_chars).collect::<String>();
    output.push_str("\n[truncated]");
    output
}
