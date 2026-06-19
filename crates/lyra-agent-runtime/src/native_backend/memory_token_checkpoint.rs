use super::*;
use crate::native_backend::token_estimate::estimate_messages_tokens;

pub(crate) const EVENT_TOKEN_CHECKPOINT: &str = "token_checkpoint";
const TOKEN_CHECKPOINT_THRESHOLD: usize = 12_000;

pub(crate) fn maybe_emit_token_checkpoint_trigger(
    root: &Path,
    session_id: &str,
    turn_id: &str,
    messages: &[Value],
) {
    let total_tokens = estimate_messages_tokens(messages);
    let Ok(Some(checkpoint)) = load_latest_token_checkpoint(root, session_id) else {
        let _ = record_token_checkpoint(root, session_id, turn_id, total_tokens, messages);
        return;
    };
    let delta = total_tokens.saturating_sub(checkpoint.token_total);
    if delta < TOKEN_CHECKPOINT_THRESHOLD {
        return;
    }
    let incremental = incremental_messages_since(messages, checkpoint.last_message_id.as_deref());
    let trigger_payloads =
        load_unprocessed_trigger_payloads_for_session(root, session_id).unwrap_or_default();
    if incremental.is_empty() && trigger_payloads.is_empty() {
        return;
    }
    let event = MemoryTriggerEvent {
        event_type: EVENT_TOKEN_CHECKPOINT.to_string(),
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        payload: json!({
            "tokenTotal": total_tokens,
            "tokenDelta": delta,
            "sinceMessageId": checkpoint.last_message_id,
            "incrementalMessages": incremental,
            "triggerMarks": trigger_payloads,
        }),
    };
    emit_memory_trigger(root, event);
    let _ = record_token_checkpoint(root, session_id, turn_id, total_tokens, messages);
}

#[derive(Clone, Debug)]
struct TokenCheckpointRecord {
    last_message_id: Option<String>,
    token_total: usize,
}

fn incremental_messages_since(messages: &[Value], since_message_id: Option<&str>) -> Vec<Value> {
    let Some(since_id) = since_message_id.filter(|value| !value.trim().is_empty()) else {
        return messages.to_vec();
    };
    let start = messages
        .iter()
        .position(|message| message_id(message).as_deref() == Some(since_id))
        .map(|index| index.saturating_add(1))
        .unwrap_or(0);
    messages[start..].to_vec()
}

fn message_id(message: &Value) -> Option<String> {
    message
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn record_token_checkpoint(
    root: &Path,
    session_id: &str,
    turn_id: &str,
    token_total: usize,
    messages: &[Value],
) -> AgentRuntimeResult<()> {
    let last_message_id = messages.iter().rev().find_map(message_id);
    record_session_token_checkpoint(root, session_id, turn_id, last_message_id, token_total)
}

fn load_latest_token_checkpoint(
    root: &Path,
    session_id: &str,
) -> AgentRuntimeResult<Option<TokenCheckpointRecord>> {
    Ok(load_latest_session_token_checkpoint(root, session_id)?.map(
        |(last_message_id, token_total)| TokenCheckpointRecord {
            last_message_id,
            token_total,
        },
    ))
}

pub(crate) fn run_token_checkpoint_memory_extraction(
    root: &Path,
    job: &MemoryJobRecord,
) -> AgentRuntimeResult<Value> {
    let incremental = job
        .payload
        .get("incrementalMessages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let trigger_marks = job
        .payload
        .get("triggerMarks")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if incremental.is_empty() && trigger_marks.is_empty() {
        return Ok(json!({
            "sessionId": job.session_id,
            "turnId": job.turn_id,
            "agent": "memory",
            "eventType": EVENT_TOKEN_CHECKPOINT,
            "skipped": true,
            "reason": "empty_incremental_window",
            "candidates": [],
        }));
    }
    let user_text = incremental
        .iter()
        .filter(|message| message.get("role").and_then(Value::as_str) == Some("user"))
        .filter_map(|message| message.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n");
    let assistant_text = incremental
        .iter()
        .filter(|message| message.get("role").and_then(Value::as_str) == Some("assistant"))
        .filter_map(|message| message.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n");
    let extraction = run_memory_agent_extraction(
        &job.session_id,
        &job.turn_id,
        &user_text,
        (!assistant_text.is_empty()).then_some(assistant_text.as_str()),
    );
    let mutations = match extraction {
        Ok(mutations) => mutations,
        Err(error) => {
            return Ok(json!({
                "sessionId": job.session_id,
                "turnId": job.turn_id,
                "agent": "memory",
                "eventType": EVENT_TOKEN_CHECKPOINT,
                "skipped": true,
                "reason": error.to_string(),
                "candidates": [],
            }));
        }
    };
    let mut created = Vec::new();
    for mutation in mutations {
        created.push(process_extracted_candidate(
            root,
            &job.session_id,
            &job.turn_id,
            mutation,
        )?);
    }
    Ok(json!({
        "sessionId": job.session_id,
        "turnId": job.turn_id,
        "agent": "memory",
        "eventType": EVENT_TOKEN_CHECKPOINT,
        "candidates": created,
    }))
}
