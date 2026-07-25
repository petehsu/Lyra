use super::*;

pub(super) fn provider_protocol_id(request: &ModelRequest) -> String {
    providers::registry::require_route(&request.provider.route_id)
        .map(|route| route.protocol_id)
        .unwrap_or_else(|_| request.provider.route_id.clone())
}

pub(super) fn persist_tool_protocol_checkpoint(
    session_id: &str,
    turn_id: &str,
    message_id: Option<&str>,
    provider_protocol: &Value,
) -> AgentRuntimeResult<()> {
    if let Some(message_id) = message_id.filter(|id| !id.trim().is_empty()) {
        crate::native_backend::turns::persist_provider_protocol_step(
            session_id,
            turn_id,
            message_id,
            provider_protocol.clone(),
        )
    } else {
        crate::native_backend::turns::persist_oma_provider_protocol_checkpoint(
            session_id,
            turn_id,
            provider_protocol.clone(),
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum AttemptOutcome {
    VisibleText,
    ToolCalls,
    MaxTokensWithText,
    MaxTokensWithToolCalls,
    ToolUseWithoutCall,
    ReasoningOnly,
    TerminalEmpty,
    Refusal,
    ContentFilter,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum RecoveryAction {
    Accept,
    ContinueVisibleText,
    RetryReasoningOnly,
    RetryTerminalEmpty,
    RetryIncompleteToolCall,
    RetryMissingToolCall,
    Fail(ProviderProtocolFailureKind),
}

pub(super) fn classify_attempt_outcome(reply: &ModelReply) -> AttemptOutcome {
    match reply.stop_signal {
        TurnStopSignal::Refusal => return AttemptOutcome::Refusal,
        TurnStopSignal::ContentFilter => return AttemptOutcome::ContentFilter,
        _ => {}
    }
    if !reply.tool_calls.is_empty() {
        return if reply.stop_signal == TurnStopSignal::MaxTokens {
            AttemptOutcome::MaxTokensWithToolCalls
        } else {
            AttemptOutcome::ToolCalls
        };
    }
    if reply.stop_signal == TurnStopSignal::ToolUse {
        return AttemptOutcome::ToolUseWithoutCall;
    }
    let has_visible_text = reply
        .content
        .as_ref()
        .is_some_and(|text| !text.trim().is_empty());
    if !has_visible_text {
        return match reply.stop_signal {
            _ if reply
                .reasoning_content
                .as_ref()
                .is_some_and(|text| !text.trim().is_empty()) =>
            {
                AttemptOutcome::ReasoningOnly
            }
            _ => AttemptOutcome::TerminalEmpty,
        };
    }
    if reply.stop_signal == TurnStopSignal::MaxTokens {
        AttemptOutcome::MaxTokensWithText
    } else {
        AttemptOutcome::VisibleText
    }
}

pub(super) fn recovery_action_for_attempt(
    outcome: AttemptOutcome,
    reasoning_only_retries: u8,
    terminal_empty_retries: u8,
    truncated_tool_retries: u8,
    missing_tool_retries: u8,
    continuation_retries: u8,
) -> RecoveryAction {
    match outcome {
        AttemptOutcome::ReasoningOnly if reasoning_only_retries < 1 => {
            RecoveryAction::RetryReasoningOnly
        }
        AttemptOutcome::ReasoningOnly => {
            RecoveryAction::Fail(ProviderProtocolFailureKind::ReasoningOnlyResponse)
        }
        AttemptOutcome::TerminalEmpty if terminal_empty_retries < 1 => {
            RecoveryAction::RetryTerminalEmpty
        }
        AttemptOutcome::TerminalEmpty => {
            RecoveryAction::Fail(ProviderProtocolFailureKind::EmptyAssistantResponse)
        }
        AttemptOutcome::MaxTokensWithToolCalls if truncated_tool_retries < 1 => {
            RecoveryAction::RetryIncompleteToolCall
        }
        AttemptOutcome::MaxTokensWithToolCalls => {
            RecoveryAction::Fail(ProviderProtocolFailureKind::IncompleteToolCall)
        }
        AttemptOutcome::ToolUseWithoutCall if missing_tool_retries < max_missing_tool_retry() => {
            RecoveryAction::RetryMissingToolCall
        }
        AttemptOutcome::ToolUseWithoutCall => {
            RecoveryAction::Fail(ProviderProtocolFailureKind::IncompleteToolCall)
        }
        AttemptOutcome::MaxTokensWithText if continuation_retries < MAX_CONTINUATION_RETRIES => {
            RecoveryAction::ContinueVisibleText
        }
        AttemptOutcome::Refusal | AttemptOutcome::ContentFilter => {
            RecoveryAction::Fail(ProviderProtocolFailureKind::ContentBlocked)
        }
        AttemptOutcome::VisibleText
        | AttemptOutcome::ToolCalls
        | AttemptOutcome::MaxTokensWithText => RecoveryAction::Accept,
    }
}

#[cfg(test)]
mod attempt_recovery_tests {
    use super::*;

    fn reply(
        stop_signal: TurnStopSignal,
        content: Option<&str>,
        reasoning: Option<&str>,
        tool_calls: Vec<ModelToolCall>,
    ) -> ModelReply {
        ModelReply {
            content: content.map(str::to_string),
            reasoning_content: reasoning.map(str::to_string),
            tool_calls,
            ui_message_id: None,
            raw_stop_reason: None,
            provider_replay_protocol: None,
            provider_replay_items: Vec::new(),
            response_meta: ProviderResponseMeta::default(),
            stop_signal,
        }
    }

    #[test]
    fn stop_signals_take_priority_over_partial_payloads() {
        let tool_call = ModelToolCall {
            id: "call-1".to_string(),
            name: "read".to_string(),
            arguments: json!({}),
        };
        assert_eq!(
            classify_attempt_outcome(&reply(
                TurnStopSignal::ContentFilter,
                Some("partial"),
                None,
                vec![tool_call],
            )),
            AttemptOutcome::ContentFilter
        );
        assert_eq!(
            classify_attempt_outcome(&reply(
                TurnStopSignal::Refusal,
                Some("partial"),
                None,
                Vec::new(),
            )),
            AttemptOutcome::Refusal
        );
        assert_eq!(
            classify_attempt_outcome(&reply(
                TurnStopSignal::ToolUse,
                Some("I will call it"),
                None,
                Vec::new(),
            )),
            AttemptOutcome::ToolUseWithoutCall
        );
    }

    #[test]
    fn semantic_recovery_budgets_are_independent_and_bounded() {
        assert_eq!(
            recovery_action_for_attempt(AttemptOutcome::ReasoningOnly, 0, 1, 1, 1, 4),
            RecoveryAction::RetryReasoningOnly
        );
        assert_eq!(
            recovery_action_for_attempt(AttemptOutcome::ReasoningOnly, 1, 0, 0, 0, 0),
            RecoveryAction::Fail(ProviderProtocolFailureKind::ReasoningOnlyResponse)
        );
        assert_eq!(
            recovery_action_for_attempt(AttemptOutcome::TerminalEmpty, 1, 0, 1, 1, 4),
            RecoveryAction::RetryTerminalEmpty
        );
        assert_eq!(
            recovery_action_for_attempt(AttemptOutcome::MaxTokensWithToolCalls, 0, 0, 0, 0, 0),
            RecoveryAction::RetryIncompleteToolCall
        );
        assert_eq!(
            recovery_action_for_attempt(AttemptOutcome::MaxTokensWithToolCalls, 0, 0, 1, 0, 0),
            RecoveryAction::Fail(ProviderProtocolFailureKind::IncompleteToolCall)
        );
        assert_eq!(
            recovery_action_for_attempt(AttemptOutcome::MaxTokensWithText, 0, 0, 0, 0, 3),
            RecoveryAction::ContinueVisibleText
        );
        assert_eq!(
            recovery_action_for_attempt(AttemptOutcome::MaxTokensWithText, 0, 0, 0, 0, 4),
            RecoveryAction::Accept
        );
    }
}

pub(super) fn provider_protocol_step(
    request: &ModelRequest,
    turn_id: &str,
    reply: &ModelReply,
    tool_calls: &[ModelToolCall],
    status: &str,
    tool_results: Vec<Value>,
    auxiliary_messages_before_assistant: Vec<Value>,
) -> Value {
    let protocol_id = provider_protocol_id(request);
    let replay = (reply.provider_replay_protocol.as_deref() == Some(protocol_id.as_str())
        && !reply.provider_replay_items.is_empty())
    .then(|| {
        json!({
            "protocol": protocol_id,
            "items": reply.provider_replay_items,
        })
    })
    .unwrap_or(Value::Null);
    json!({
        "version": 2,
        "turnId": turn_id,
        "origin": {
            "providerId": request.provider.id,
            "routeId": request.provider.route_id,
            "protocolId": protocol_id,
            "model": request.model,
        },
        "status": status,
        "assistant": {
            "content": reply.content.clone().unwrap_or_default(),
            "toolCalls": tool_calls.iter().map(|call| json!({
                "id": call.id,
                "name": call.name,
                "arguments": call.arguments,
            })).collect::<Vec<_>>(),
            "rawStopReason": reply.raw_stop_reason,
            "stopSignal": reply.stop_signal.label(),
            "responseId": reply.response_meta.response_id,
        },
        "toolResults": tool_results,
        "auxiliaryMessagesBeforeAssistant": auxiliary_messages_before_assistant,
        "auxiliaryMessagesAfterToolResults": [],
        "replay": replay,
    })
}

pub(super) fn attach_prior_provider_protocol_steps(step: &mut Value, prior_steps: &[Value]) {
    if !prior_steps.is_empty() {
        step["priorSteps"] = Value::Array(prior_steps.to_vec());
    }
}

pub(super) fn combined_provider_protocol_steps(mut steps: Vec<Value>) -> Option<Value> {
    let mut final_step = steps.pop()?;
    attach_prior_provider_protocol_steps(&mut final_step, &steps);
    Some(final_step)
}

pub(super) fn take_provider_protocol_auxiliary_messages(
    provider_transcript: &[Value],
    cursor: &mut usize,
) -> Vec<Value> {
    let start = (*cursor).min(provider_transcript.len());
    *cursor = provider_transcript.len();
    provider_transcript[start..]
        .iter()
        .filter(|message| {
            matches!(
                message.get("role").and_then(Value::as_str),
                Some("user" | "system" | "developer")
            ) && message.get("content").is_some()
                && message.get("lyraAttemptLocal").and_then(Value::as_bool) != Some(true)
        })
        .map(|message| {
            json!({
                "role": message.get("role").cloned().unwrap_or_else(|| json!("user")),
                "content": message.get("content").cloned().unwrap_or(Value::Null),
            })
        })
        .collect()
}

pub(super) fn append_truncated_tool_call_recovery(
    messages: &mut Vec<Value>,
    overlay_start: &mut Option<usize>,
    reply: &ModelReply,
) {
    begin_attempt_local_overlay(messages, overlay_start);
    let response_replay_items =
        if reply.provider_replay_protocol.as_deref() == Some(openai_responses::PROTOCOL_ID) {
            retained_provider_replay_items(&reply.provider_replay_items, &reply.tool_calls)
        } else {
            Vec::new()
        };
    if !response_replay_items.is_empty() {
        messages.extend(response_replay_items);
    }
    let assistant_tool_calls = reply
        .tool_calls
        .iter()
        .map(|call| {
            json!({
                "id": call.id,
                "type": "function",
                "function": {
                    "name": call.name,
                    "arguments": serde_json::to_string(&call.arguments)
                        .unwrap_or_else(|_| "{}".to_string()),
                }
            })
        })
        .collect::<Vec<_>>();
    let mut assistant_message = json!({
        "role": "assistant",
        "content": reply.content.clone().unwrap_or_default(),
        "tool_calls": assistant_tool_calls,
        "lyraAttemptLocal": true,
    });
    if reply.provider_replay_protocol.as_deref() == Some(openai_responses::PROTOCOL_ID)
        && !reply.provider_replay_items.is_empty()
    {
        assistant_message["openaiResponsesShadow"] = Value::Bool(true);
    } else if let Some(protocol) = reply.provider_replay_protocol.as_ref()
        && !reply.provider_replay_items.is_empty()
    {
        assistant_message["lyraProviderReplay"] = json!({
            "protocol": protocol,
            "items": reply.provider_replay_items,
        });
    }
    messages.push(assistant_message);
    for call in &reply.tool_calls {
        let content = "This tool call was not executed because the provider ended at the output-token limit. Reissue the complete tool call with valid arguments.";
        let mut tool_message = json!({
            "role": "tool",
            "tool_call_id": call.id,
            "content": content,
            "lyraAttemptLocal": true,
        });
        if reply.provider_replay_protocol.as_deref() == Some(openai_responses::PROTOCOL_ID)
            && !reply.provider_replay_items.is_empty()
        {
            tool_message["openaiResponsesShadow"] = Value::Bool(true);
            messages.push(openai_responses::function_call_output_item(
                &call.id,
                content.to_string(),
            ));
        }
        messages.push(tool_message);
    }
    append_attempt_local_context_update(
        messages,
        overlay_start,
        "truncated-tool-call-recovery",
        "No tool from the truncated response was executed. Reissue the required tool call completely; do not continue or reference the truncated call.",
    );
}
