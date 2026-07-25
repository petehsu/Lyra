#![cfg(test)]

use super::*;

#[test]
fn maps_openai_finish_reasons() {
    assert_eq!(
        TurnStopSignal::from_raw(Some("tool_calls")),
        TurnStopSignal::ToolUse
    );
    assert_eq!(
        TurnStopSignal::from_raw(Some("stop")),
        TurnStopSignal::EndTurn
    );
    assert_eq!(
        TurnStopSignal::from_raw(Some("length")),
        TurnStopSignal::MaxTokens
    );
    assert_eq!(
        TurnStopSignal::from_raw(Some("max_output_tokens")),
        TurnStopSignal::MaxTokens
    );
}

#[test]
fn maps_anthropic_and_bedrock_stop_reasons() {
    assert_eq!(
        TurnStopSignal::from_raw(Some("tool_use")),
        TurnStopSignal::ToolUse
    );
    assert_eq!(
        TurnStopSignal::from_raw(Some("end_turn")),
        TurnStopSignal::EndTurn
    );
    assert_eq!(
        TurnStopSignal::from_raw(Some("max_tokens")),
        TurnStopSignal::MaxTokens
    );
}

#[test]
fn is_case_insensitive_and_trims() {
    // Gemini reports uppercase STOP.
    assert_eq!(
        TurnStopSignal::from_raw(Some(" STOP ")),
        TurnStopSignal::EndTurn
    );
    assert_eq!(
        TurnStopSignal::from_raw(Some("Tool_Use")),
        TurnStopSignal::ToolUse
    );
}

#[test]
fn unknown_or_missing_is_unknown_and_content_policy_is_typed() {
    assert_eq!(TurnStopSignal::from_raw(None), TurnStopSignal::Unknown);
    assert_eq!(TurnStopSignal::from_raw(Some("")), TurnStopSignal::Unknown);
    assert_eq!(
        TurnStopSignal::from_raw(Some("content_filter")),
        TurnStopSignal::ContentFilter
    );
}

#[test]
fn default_is_unknown() {
    assert_eq!(TurnStopSignal::default(), TurnStopSignal::Unknown);
}

#[test]
fn parses_openai_chat_response_metadata_and_usage() {
    let reply = parse_openai_chat_non_streaming_reply(
        &json!({
            "id": "chatcmpl-1",
            "choices": [{
                "message": { "role": "assistant", "content": "done" },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": 100,
                "prompt_tokens_details": {
                    "cached_tokens": 70,
                    "cache_write_tokens": 10
                },
                "completion_tokens": 20,
                "completion_tokens_details": { "reasoning_tokens": 5 }
            }
        }),
        &[],
    )
    .expect("chat reply");

    assert_eq!(
        reply.response_meta.response_id.as_deref(),
        Some("chatcmpl-1")
    );
    assert_eq!(reply.response_meta.usage.input_total_tokens, Some(100));
    assert_eq!(reply.response_meta.usage.input_uncached_tokens, Some(20));
    assert_eq!(reply.response_meta.usage.cache_write_input_tokens, Some(10));
    assert_eq!(reply.response_meta.usage.output_tokens, Some(20));
    assert_eq!(reply.response_meta.usage.reasoning_tokens, Some(5));
}

#[test]
fn parses_openai_chat_stream_usage_only_chunk() {
    let mut state = ProviderStreamState::default();
    let mut ui_message_id = None;
    let mut delta_batcher = StreamDeltaBatcher::default();

    map_provider_stream_chunk(
        &json!({
            "id": "chatcmpl-stream-1",
            "usage": {
                "prompt_tokens": 80,
                "prompt_tokens_details": { "cached_tokens": 50 },
                "completion_tokens": 12
            }
        }),
        &mut state,
        &mut ui_message_id,
        &mut delta_batcher,
        false,
        "",
        "",
    )
    .expect("usage chunk");

    assert_eq!(
        state.response_meta.response_id.as_deref(),
        Some("chatcmpl-stream-1")
    );
    assert_eq!(state.response_meta.usage.input_uncached_tokens, Some(30));
    assert_eq!(state.response_meta.usage.output_tokens, Some(12));
}

#[test]
fn openai_chat_terminal_empty_reaches_the_loop_after_normalization() {
    let mut reply = parse_openai_chat_non_streaming_reply(
        &json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "",
                    "reasoning_content": ""
                },
                "finish_reason": "stop"
            }]
        }),
        &[],
    )
    .expect("terminal empty reply");

    normalize_model_reply_protocol(&mut reply, &[]).expect("normalization");

    assert!(reply.content.is_none());
    assert!(reply.tool_calls.is_empty());
    assert_eq!(reply.stop_signal, TurnStopSignal::EndTurn);
}

#[test]
fn openai_chat_truncated_tool_arguments_are_protocol_errors() {
    let error = parse_openai_chat_non_streaming_reply(
        &json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "tool_fs_run",
                            "arguments": "{\"path\":"
                        }
                    }]
                },
                "finish_reason": "tool_calls"
            }]
        }),
        &[json!({
            "type": "function",
            "function": {
                "name": "tool_fs_run",
                "parameters": { "type": "object" }
            }
        })],
    )
    .expect_err("truncated arguments");

    assert!(matches!(
        error,
        AgentRuntimeError::ProviderProtocol {
            kind: ProviderProtocolFailureKind::IncompleteToolCall,
            ..
        }
    ));
}

#[test]
fn openai_chat_max_tokens_preserves_truncated_tool_call_for_loop_recovery() {
    let tools = [json!({
        "type": "function",
        "function": {
            "name": "tool_fs_run",
            "parameters": { "type": "object" }
        }
    })];
    let mut reply = parse_openai_chat_non_streaming_reply(
        &json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "tool_fs_run",
                            "arguments": "{\"path\":"
                        }
                    }]
                },
                "finish_reason": "length"
            }]
        }),
        &tools,
    )
    .expect("max_tokens reply reaches the loop");

    normalize_model_reply_protocol(&mut reply, &tools).expect("max_tokens normalization");
    assert_eq!(reply.stop_signal, TurnStopSignal::MaxTokens);
    assert_eq!(reply.tool_calls.len(), 1);
    assert!(reply.tool_calls[0].arguments.get("parseError").is_some());
}

#[test]
fn openai_chat_rejects_mixed_valid_and_malformed_tool_calls() {
    let error = parse_openai_chat_non_streaming_reply(
        &json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "call-good",
                            "type": "function",
                            "function": {
                                "name": "tool_fs_run",
                                "arguments": "{}"
                            }
                        },
                        {
                            "id": "call-bad",
                            "type": "function",
                            "function": {
                                "arguments": "{}"
                            }
                        }
                    ]
                },
                "finish_reason": "tool_calls"
            }]
        }),
        &[json!({
            "type": "function",
            "function": {
                "name": "tool_fs_run",
                "parameters": { "type": "object" }
            }
        })],
    )
    .expect_err("malformed sibling call must not be dropped");

    assert!(matches!(
        error,
        AgentRuntimeError::ProviderProtocol {
            kind: ProviderProtocolFailureKind::IncompleteToolCall,
            ..
        }
    ));
}

#[test]
fn openai_chat_refusal_is_typed_in_non_streaming_and_streaming_replies() {
    let non_streaming = parse_openai_chat_non_streaming_reply(
        &json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": null,
                    "refusal": "I cannot help with that."
                },
                "finish_reason": "stop"
            }]
        }),
        &[],
    )
    .expect("refusal reply");
    assert_eq!(non_streaming.stop_signal, TurnStopSignal::Refusal);

    let stream = [
        r#"data: {"choices":[{"delta":{"refusal":"I cannot help with that."}}]}"#,
        r#"data: {"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
        "data: [DONE]",
    ]
    .join("\n\n");
    let mut committed_any = false;
    let streaming = parse_streaming_response_with_commit(
        std::io::Cursor::new(stream),
        "",
        "",
        &CancellationToken::new(),
        &[],
        false,
        &mut committed_any,
    )
    .expect("streaming refusal reply");
    assert_eq!(streaming.stop_signal, TurnStopSignal::Refusal);
}

#[test]
fn aggregates_usage_across_every_successful_provider_call() {
    let mut aggregate = ProviderUsageAggregate::default();
    aggregate.observe(&ProviderTokenUsage {
        input_total_tokens: Some(100),
        cache_read_input_tokens: Some(70),
        cache_write_input_tokens: Some(10),
        output_tokens: Some(20),
        reasoning_tokens: Some(5),
        ..ProviderTokenUsage::default()
    });
    aggregate.observe(&ProviderTokenUsage {
        input_total_tokens: Some(50),
        input_uncached_tokens: Some(40),
        cache_read_input_tokens: Some(10),
        output_tokens: None,
        ..ProviderTokenUsage::default()
    });

    assert_eq!(
        aggregate.as_json(),
        json!({
            "callCount": 2,
            "inputTotal": 150,
            "inputUncached": 60,
            "cacheRead": 80,
            "cacheWrite": 10,
            "output": 20,
            "reasoning": 5,
            "hitRequestCount": 2,
            "cacheReadShare": 80.0 / 150.0,
            "telemetryIncomplete": true,
        })
    );
}

#[test]
fn native_replay_keeps_only_tool_calls_the_loop_will_execute() {
    let items = vec![
        json!({ "type": "reasoning", "id": "reasoning-1" }),
        json!({
            "type": "function_call",
            "id": "item-keep",
            "call_id": "call-keep",
            "name": "lookup"
        }),
        json!({
            "type": "function_call",
            "id": "item-drop",
            "call_id": "call-drop",
            "name": "unknown"
        }),
        json!({
            "type": "function_call_output",
            "call_id": "call-drop",
            "output": "orphan"
        }),
    ];
    let retained = retained_provider_replay_items(
        &items,
        &[ModelToolCall {
            id: "call-keep".to_string(),
            name: "lookup".to_string(),
            arguments: json!({}),
        }],
    );

    assert_eq!(retained.len(), 2);
    assert_eq!(retained[0]["type"], "reasoning");
    assert_eq!(retained[1]["call_id"], "call-keep");
}

#[test]
fn rejected_prompt_cache_profile_stays_disabled_for_later_turns() {
    let suffix = uuid::Uuid::new_v4().to_string();
    let provider_id = format!("provider-{suffix}");
    let route_id = format!("route-{suffix}");
    let model = format!("model-{suffix}");
    let messages = vec![json!({
        "role": "system",
        "content": "stable",
        "lyraRequestContext": {
            "providerId": provider_id,
            "routeId": route_id,
            "model": model,
            "promptCacheEnabled": true,
            "openaiExplicitPromptCache": true
        }
    })];

    assert!(request_prompt_cache_enabled(
        &messages,
        "openaiExplicitPromptCache"
    ));
    rejected_prompt_cache_profiles()
        .lock()
        .expect("rejected profiles")
        .insert(prompt_cache_profile_key(
            messages[0]["lyraRequestContext"]["providerId"]
                .as_str()
                .expect("provider id"),
            messages[0]["lyraRequestContext"]["routeId"]
                .as_str()
                .expect("route id"),
            messages[0]["lyraRequestContext"]["model"]
                .as_str()
                .expect("model"),
        ));
    assert!(!request_prompt_cache_enabled(
        &messages,
        "openaiExplicitPromptCache"
    ));
}

#[test]
fn rejected_provider_parameter_uses_structured_error_field() {
    let structured = AgentRuntimeError::ProviderFailure {
        failure: ProviderFailure {
            provider_id: "test".to_string(),
            route_id: "test".to_string(),
            http_status: Some(400),
            provider_code: Some("unknown_parameter".to_string()),
            provider_type: Some("invalid_request_error".to_string()),
            retry_after_ms: None,
            category: ProviderFailureCategory::InvalidRequest,
            message: "request rejected".to_string(),
            body_preview: Some(
                json!({ "error": { "param": "prompt_cache_options.mode" } }).to_string(),
            ),
        },
    };
    assert_eq!(
        rejected_provider_parameter(&structured, &["prompt_cache_key", "prompt_cache_options"]),
        Some("prompt_cache_options")
    );

    let natural_language_only = AgentRuntimeError::ProviderFailure {
        failure: ProviderFailure {
            provider_id: "test".to_string(),
            route_id: "test".to_string(),
            http_status: Some(400),
            provider_code: None,
            provider_type: None,
            retry_after_ms: None,
            category: ProviderFailureCategory::InvalidRequest,
            message: "Unknown parameter: prompt_cache_key".to_string(),
            body_preview: None,
        },
    };
    assert_eq!(
        rejected_provider_parameter(&natural_language_only, &["prompt_cache_key"]),
        None
    );
}

#[test]
fn stateful_cursor_and_cache_fallbacks_only_mutate_internal_request_context() {
    let mut messages = vec![
        json!({
            "role": "system",
            "content": "stable",
            "lyraRequestContext": {
                "promptCacheEnabled": true,
                "openaiExplicitPromptCache": true,
                "anthropicPromptCache": true,
                "bedrockPromptCache": true,
                "stateful": {
                    "enabled": true,
                    "previousResponseId": null,
                    "inputStart": 0
                }
            }
        }),
        json!({ "role": "user", "content": "current" }),
    ];

    advance_stateful_responses(&mut messages, Some("resp-1"), 1);
    assert_eq!(
        messages[0].pointer("/lyraRequestContext/stateful/previousResponseId"),
        Some(&json!("resp-1"))
    );
    assert_eq!(
        messages[0].pointer("/lyraRequestContext/stateful/inputStart"),
        Some(&json!(1))
    );

    reset_stateful_responses(&mut messages);
    disable_prompt_cache(&mut messages);
    assert_eq!(
        messages[0].pointer("/lyraRequestContext/stateful/previousResponseId"),
        Some(&Value::Null)
    );
    assert_eq!(
        messages[0].pointer("/lyraRequestContext/stateful/inputStart"),
        Some(&json!(0))
    );

    advance_stateful_responses(&mut messages, Some("resp-2"), 2);
    assert_eq!(
        messages[0].pointer("/lyraRequestContext/stateful/previousResponseId"),
        Some(&json!("resp-2"))
    );
    disable_stateful_responses(&mut messages);
    advance_stateful_responses(&mut messages, Some("resp-3"), 3);
    assert_eq!(
        messages[0].pointer("/lyraRequestContext/stateful/enabled"),
        Some(&json!(false))
    );
    assert_eq!(
        messages[0].pointer("/lyraRequestContext/stateful/previousResponseId"),
        Some(&Value::Null)
    );
    assert_eq!(
        messages[0].pointer("/lyraRequestContext/stateful/inputStart"),
        Some(&json!(0))
    );

    for key in [
        "promptCacheEnabled",
        "openaiExplicitPromptCache",
        "anthropicPromptCache",
        "bedrockPromptCache",
    ] {
        assert_eq!(
            messages[0].pointer(&format!("/lyraRequestContext/{key}")),
            Some(&json!(false))
        );
    }
}

#[test]
fn preserves_numeric_retry_after_for_the_shared_scheduler() {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::RETRY_AFTER,
        "3".parse().expect("header value"),
    );
    assert_eq!(retry_after_milliseconds(&headers), Some(3_000));
    assert_eq!(
        retry_after_from_error(&AgentRuntimeError::ProviderFailure {
            failure: ProviderFailure {
                provider_id: "test".to_string(),
                route_id: "test".to_string(),
                http_status: Some(429),
                provider_code: None,
                provider_type: None,
                retry_after_ms: Some(3_000),
                category: ProviderFailureCategory::RateLimit,
                message: String::new(),
                body_preview: None,
            }
        }),
        Some(Duration::from_millis(3_000))
    );
}
