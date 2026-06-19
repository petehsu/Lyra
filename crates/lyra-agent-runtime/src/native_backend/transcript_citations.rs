use super::*;

pub(crate) const TRANSCRIPT_CITATION_PREVIEW_CHARS: usize = 32;
pub(crate) const TRANSCRIPT_CITATION_QUOTED_CHARS: usize = 480;
pub(crate) const LYRA_SESSION_READ_MESSAGE_TOOL: &str = "lyra_session_read_message";

pub(crate) fn resolve_transcript_message(
    session_id: &str,
    message_id: &str,
    block_id: Option<&str>,
    start_offset: Option<usize>,
    end_offset: Option<usize>,
    include_tool_blocks: bool,
) -> Value {
    let state = match state().lock() {
        Ok(state) => state,
        Err(_) => {
            return json!({
                "found": false,
                "reason": "agent runtime state lock failed",
            });
        }
    };
    let session = match state.sessions.get(session_id) {
        Some(session) => session,
        None => {
            return json!({
                "found": false,
                "reason": format!("session not found: {session_id}"),
            });
        }
    };
    let messages = session
        .snapshot
        .get("messages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let (message_index, message) = match messages
        .iter()
        .enumerate()
        .find(|(_, message)| message.get("id").and_then(Value::as_str) == Some(message_id))
    {
        Some(found) => found,
        None => {
            return json!({
                "found": false,
                "reason": format!("message not found: {message_id}"),
            });
        }
    };
    let role = message
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or("user")
        .to_string();
    let created_at = message.get("createdAt").cloned().unwrap_or(Value::Null);
    let full_text = extract_message_text(message, include_tool_blocks);
    let block_text = block_id
        .and_then(|id| text_for_block(message, id))
        .unwrap_or_else(|| full_text.clone());
    let (text, truncated) = slice_text_range(&block_text, start_offset, end_offset);
    json!({
        "found": true,
        "sessionId": session_id,
        "messageId": message_id,
        "messageIndex": message_index,
        "role": role,
        "createdAt": created_at,
        "text": text,
        "fullText": full_text,
        "truncated": truncated,
        "blockId": block_id,
        "startOffset": start_offset,
        "endOffset": end_offset,
    })
}

pub(crate) fn resolve_message_from_payload(payload: &Value) -> AgentRuntimeResult<Value> {
    let session_id = required_session_id(payload)?;
    let message_id = string_opt(payload, "messageId")
        .ok_or_else(|| AgentRuntimeError::Core("messageId is required".to_string()))?;
    Ok(resolve_transcript_message(
        &session_id,
        &message_id,
        string_opt(payload, "blockId").as_deref(),
        usize_opt(payload, "startOffset"),
        usize_opt(payload, "endOffset"),
        payload
            .get("includeToolBlocks")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    ))
}

pub(crate) fn execute_session_read_message_tool(
    session_id: &str,
    arguments: &Value,
) -> NativeToolResult {
    let message_id = value_string(arguments, "messageId").ok_or_else(|| {
        NativeToolFailure::new(
            "bad_request",
            "messageId is required",
            "Provide the stable messageId from a lyra-transcript-cite block.",
        )
    })?;
    let response = resolve_transcript_message(
        session_id,
        &message_id,
        value_string(arguments, "blockId").as_deref(),
        usize_opt(arguments, "startOffset"),
        usize_opt(arguments, "endOffset"),
        arguments
            .get("includeToolBlocks")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    );
    if response.get("found").and_then(Value::as_bool) != Some(true) {
        return Err(NativeToolFailure::new(
            "not_found",
            response
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("message not found"),
            "Use a messageId from a lyra-transcript-cite block in the current session transcript.",
        ));
    }
    Ok(NativeToolSuccess {
        content: serde_json::to_string_pretty(&response).unwrap_or_else(|_| response.to_string()),
        raw: response,
        recommended_next_action: None,
    })
}

pub(crate) fn parse_transcript_citations(payload: &Value) -> Vec<Value> {
    payload
        .get("citations")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(normalize_transcript_citation)
        .collect()
}

pub(crate) fn validate_transcript_citations(
    messages: &[Value],
    citations: &[Value],
) -> (Vec<Value>, Vec<Value>) {
    let mut accepted = Vec::new();
    let mut rejected = Vec::new();
    for citation in citations {
        let message_id = citation
            .get("messageId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let exists = messages
            .iter()
            .any(|message| message.get("id").and_then(Value::as_str) == Some(message_id));
        if exists {
            accepted.push(citation.clone());
        } else {
            rejected.push(json!({
                "messageId": message_id,
                "reason": "message not found in session transcript",
            }));
        }
    }
    (accepted, rejected)
}

pub(crate) fn apply_transcript_citations_to_user_message(
    user_message: &mut Value,
    citations: &[Value],
    downgrades: &[Value],
) {
    if citations.is_empty() && downgrades.is_empty() {
        return;
    }
    let metadata = user_message
        .get_mut("metadata")
        .and_then(Value::as_object_mut);
    let metadata = match metadata {
        Some(object) => object,
        None => {
            user_message["metadata"] = json!({});
            user_message
                .get_mut("metadata")
                .and_then(Value::as_object_mut)
                .expect("metadata object")
        }
    };
    if !citations.is_empty() {
        metadata.insert("transcriptCitations".to_string(), json!(citations));
    }
    if !downgrades.is_empty() {
        metadata.insert(
            "transcriptCitationDowngrades".to_string(),
            json!(downgrades),
        );
    }
}

pub(crate) fn transcript_citation_provider_blocks(citations: &[Value]) -> String {
    citations
        .iter()
        .filter_map(format_transcript_cite_xml)
        .collect::<Vec<_>>()
        .join("\n")
}

fn normalize_transcript_citation(raw: Value) -> Option<Value> {
    let message_id = raw.get("messageId").and_then(Value::as_str)?;
    let id = raw
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("cite-{}", Uuid::new_v4()));
    let role = raw
        .get("role")
        .and_then(Value::as_str)
        .filter(|value| *value == "user" || *value == "assistant")
        .unwrap_or("assistant");
    let excerpt_kind = raw
        .get("excerptKind")
        .and_then(Value::as_str)
        .filter(|value| *value == "selection" || *value == "full_message")
        .unwrap_or("selection");
    let quoted_text = raw
        .get("quotedText")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let (quoted_text, truncated, preview) = truncate_quoted_text(&quoted_text);
    Some(json!({
        "id": id,
        "messageId": message_id,
        "role": role,
        "blockId": raw.get("blockId").cloned().unwrap_or(Value::Null),
        "startOffset": raw.get("startOffset").cloned().unwrap_or(Value::Null),
        "endOffset": raw.get("endOffset").cloned().unwrap_or(Value::Null),
        "excerptKind": excerpt_kind,
        "preview": raw.get("preview").and_then(Value::as_str).unwrap_or(&preview),
        "quotedText": quoted_text,
        "truncated": raw.get("truncated").and_then(Value::as_bool).unwrap_or(truncated),
        "sourceCreatedAt": raw.get("sourceCreatedAt").cloned().unwrap_or(Value::Null),
    }))
}

fn truncate_quoted_text(text: &str) -> (String, bool, String) {
    let chars: Vec<char> = text.chars().collect();
    let truncated = chars.len() > TRANSCRIPT_CITATION_QUOTED_CHARS;
    let quoted: String = chars
        .iter()
        .take(TRANSCRIPT_CITATION_QUOTED_CHARS)
        .collect();
    let preview: String = chars
        .iter()
        .take(TRANSCRIPT_CITATION_PREVIEW_CHARS)
        .collect();
    let preview = if chars.len() > TRANSCRIPT_CITATION_PREVIEW_CHARS {
        format!("{preview}…")
    } else {
        preview
    };
    (quoted, truncated, preview)
}

fn format_transcript_cite_xml(citation: &Value) -> Option<String> {
    let id = citation.get("id").and_then(Value::as_str)?;
    let message_id = citation.get("messageId").and_then(Value::as_str)?;
    let role = citation
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or("assistant");
    let truncated = citation
        .get("truncated")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let block_id = citation
        .get("blockId")
        .and_then(Value::as_str)
        .map(|value| format!(" blockId=\"{value}\""))
        .unwrap_or_default();
    let start = citation
        .get("startOffset")
        .and_then(Value::as_u64)
        .map(|value| format!(" start=\"{value}\""))
        .unwrap_or_default();
    let end = citation
        .get("endOffset")
        .and_then(Value::as_u64)
        .map(|value| format!(" end=\"{value}\""))
        .unwrap_or_default();
    let quoted = citation
        .get("quotedText")
        .and_then(Value::as_str)
        .unwrap_or_default();
    Some(format!(
        "<lyra-transcript-cite id=\"{id}\" messageId=\"{message_id}\" role=\"{role}\" authentic=\"true\" truncated=\"{truncated}\"{block_id}{start}{end}>\n{quoted}\n</lyra-transcript-cite>"
    ))
}

fn extract_message_text(message: &Value, include_tool_blocks: bool) -> String {
    let blocks = message
        .get("blocks")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if blocks.is_empty() {
        return message
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
    }
    let mut parts = Vec::new();
    for block in blocks {
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = block.get("text").and_then(Value::as_str) {
                    parts.push(text.to_string());
                }
            }
            Some("tool") if include_tool_blocks => {
                parts.push("[tool activity]".to_string());
            }
            _ => {}
        }
    }
    if parts.is_empty() {
        message
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    } else {
        parts.join("\n\n")
    }
}

fn text_for_block(message: &Value, block_id: &str) -> Option<String> {
    message
        .get("blocks")
        .and_then(Value::as_array)
        .and_then(|blocks| {
            blocks.iter().find_map(|block| {
                if block.get("id").and_then(Value::as_str) == Some(block_id)
                    && block.get("type").and_then(Value::as_str) == Some("text")
                {
                    block
                        .get("text")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                } else {
                    None
                }
            })
        })
}

fn slice_text_range(text: &str, start: Option<usize>, end: Option<usize>) -> (String, bool) {
    let chars: Vec<char> = text.chars().collect();
    let start = start.unwrap_or(0).min(chars.len());
    let end = end.unwrap_or(chars.len()).min(chars.len());
    if start >= end {
        return (String::new(), false);
    }
    let sliced: String = chars[start..end].iter().collect();
    (sliced, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_transcript_citation_truncates_long_quotes() {
        let citation = normalize_transcript_citation(json!({
            "id": "cite-1",
            "messageId": "message-1",
            "role": "assistant",
            "quotedText": "x".repeat(600),
            "excerptKind": "selection"
        }))
        .expect("citation");
        assert_eq!(
            citation.get("truncated").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            citation
                .get("quotedText")
                .and_then(Value::as_str)
                .map(str::chars)
                .map(Iterator::count),
            Some(TRANSCRIPT_CITATION_QUOTED_CHARS)
        );
    }
}

fn usize_opt(payload: &Value, key: &str) -> Option<usize> {
    payload.get(key).and_then(|value| {
        value
            .as_u64()
            .or_else(|| value.as_i64().and_then(|n| u64::try_from(n).ok()))
            .map(|n| n as usize)
    })
}
