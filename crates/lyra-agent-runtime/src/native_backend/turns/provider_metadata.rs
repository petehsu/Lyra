use super::provider_request::provider_history_fingerprint;
use super::*;

pub(super) fn finalize_openai_response_state_fingerprint(
    session: &NativeSession,
    assistant_text: Option<&str>,
    streamed_message_id: Option<&str>,
    metadata: &mut Option<Value>,
) {
    if metadata
        .as_ref()
        .and_then(|value| value.pointer("/openaiResponsesState/responseId"))
        .and_then(Value::as_str)
        .is_none()
    {
        return;
    }
    let mut messages = session
        .snapshot
        .get("messages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if let Some(text) = assistant_text.filter(|text| !text.trim().is_empty()) {
        messages.push(assistant_message_with_metadata(
            text.to_string(),
            metadata.clone(),
        ));
    } else if let Some(message_id) = streamed_message_id
        && let Some(message) = messages
            .iter_mut()
            .rev()
            .find(|message| message.get("id").and_then(Value::as_str) == Some(message_id))
    {
        message["metadata"] = metadata.clone().unwrap_or_else(|| json!({}));
    } else {
        return;
    }
    if let Some(metadata) = metadata.as_mut() {
        metadata["openaiResponsesState"]["providerContextFingerprint"] =
            Value::String(provider_history_fingerprint(&messages));
    }
}

pub(super) fn set_runtime_turn_provider_metadata(
    session: &mut NativeSession,
    turn_id: &str,
    metadata: Option<&Value>,
) {
    let Some(metadata) = metadata else {
        return;
    };
    let Some(provider_metadata) = super::oma_provider::provider_observability_metadata(metadata)
    else {
        return;
    };
    if let Some(turn) = session
        .runtime_turns
        .iter_mut()
        .find(|turn| turn.get("runtimeTurnId").and_then(Value::as_str) == Some(turn_id))
    {
        turn["providerMetadata"] = provider_metadata;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_metadata_is_persisted_on_runtime_turn_without_a_top_level_reply() {
        let mut session = new_session(None, None, "oma");
        session.runtime_turns.push(runtime_turn(
            "turn-1",
            &session.id,
            "running_model",
            None,
            None,
        ));
        let metadata = json!({
            "providerUsage": { "cacheRead": 80 },
            "omaProviderWorkers": [{ "sessionAgentId": "agent-1" }],
            "providerTranscript": [{ "role": "tool", "content": "private result" }],
            "openaiResponsesReplay": [{ "type": "reasoning", "content": "private" }],
            "openaiResponsesState": { "responseId": "private-cursor" },
            "providerProtocol": { "version": 2, "replay": { "items": ["private"] } },
            "providerAttempts": [{ "outcome": "visible_final" }],
        });

        set_runtime_turn_provider_metadata(&mut session, "turn-1", Some(&metadata));

        assert_eq!(
            session.runtime_turns[0]["providerMetadata"]["providerUsage"]["cacheRead"],
            80
        );
        assert_eq!(
            session.runtime_turns[0]["providerMetadata"]["omaProviderWorkers"][0]["sessionAgentId"],
            "agent-1"
        );
        assert_eq!(
            session.runtime_turns[0]["providerMetadata"]["providerAttempts"][0]["outcome"],
            "visible_final"
        );
        for private_key in [
            "providerTranscript",
            "openaiResponsesReplay",
            "openaiResponsesState",
            "providerProtocol",
        ] {
            assert!(
                session.runtime_turns[0]["providerMetadata"]
                    .get(private_key)
                    .is_none()
            );
        }
    }
}
