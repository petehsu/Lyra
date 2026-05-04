use super::AuthRequestTelemetryContext;
use super::ModelClient;
use super::PendingUnauthorizedRetry;
use super::UnauthorizedRecoveryExecution;
use super::X_LYRA_INSTALLATION_ID_HEADER;
use super::X_LYRA_PARENT_THREAD_ID_HEADER;
use super::X_LYRA_SUBAGENT_HEADER;
use super::X_LYRA_TURN_METADATA_HEADER;
use super::X_LYRA_WINDOW_ID_HEADER;
use crate::client_common::ResponseEvent;
use lyra_model_provider::BearerAuthProvider;
use lyra_model_provider_info::WireApi;
use lyra_model_provider_info::create_oss_provider_with_base_url;
use lyra_otel::SessionTelemetry;
use lyra_protocol::ThreadId;
use lyra_protocol::config_types::ReasoningSummary;
use lyra_protocol::models::ContentItem;
use lyra_protocol::models::FunctionCallOutputPayload;
use lyra_protocol::models::ReasoningItemContent;
use lyra_protocol::models::ReasoningProviderReplay;
use lyra_protocol::models::ResponseItem;
use lyra_protocol::openai_models::ModelInfo;
use lyra_protocol::openai_models::ReasoningEffort;
use lyra_protocol::protocol::SessionSource;
use lyra_protocol::protocol::SubAgentSource;
use lyra_tools::FreeformTool;
use lyra_tools::FreeformToolFormat;
use lyra_tools::ToolSpec;
use pretty_assertions::assert_eq;
use serde_json::json;

fn test_model_client(session_source: SessionSource) -> ModelClient {
    let provider = create_oss_provider_with_base_url("https://example.com/v1", WireApi::Responses);
    ModelClient::new(
        /*auth_manager*/ None,
        ThreadId::new(),
        /*installation_id*/ "11111111-1111-4111-8111-111111111111".to_string(),
        provider,
        session_source,
        /*model_verbosity*/ None,
        /*include_timing_metrics*/ false,
    )
}

fn test_model_info() -> ModelInfo {
    serde_json::from_value(json!({
        "slug": "gpt-test",
        "display_name": "gpt-test",
        "description": "desc",
        "default_reasoning_level": "medium",
        "supported_reasoning_levels": [
            {"effort": "medium", "description": "medium"}
        ],
        "shell_type": "shell_command",
        "visibility": "list",
        "supported_in_api": true,
        "priority": 1,
        "upgrade": null,
        "base_instructions": "base instructions",
        "supports_reasoning_summaries": false,
        "support_verbosity": false,
        "default_verbosity": null,
        "apply_patch_tool_type": null,
        "truncation_policy": {"mode": "bytes", "limit": 10000},
        "supports_parallel_tool_calls": false,
        "supports_image_detail_original": false,
        "context_window": 272000,
        "supported_tools": []
    }))
    .expect("deserialize test model info")
}

#[test]
fn build_reasoning_honors_effort_without_summary_support() {
    let model_info = test_model_info();

    let reasoning = ModelClient::build_reasoning(&model_info, None, ReasoningSummary::Auto)
        .expect("declared reasoning effort should build reasoning payload");

    assert_eq!(reasoning.effort, Some(ReasoningEffort::Medium));
    assert_eq!(reasoning.summary, None);
}

#[test]
fn build_reasoning_ignores_effort_without_declared_support() {
    let mut model_info = test_model_info();
    model_info.default_reasoning_level = None;
    model_info.supported_reasoning_levels = Vec::new();

    let reasoning = ModelClient::build_reasoning(
        &model_info,
        Some(ReasoningEffort::High),
        ReasoningSummary::None,
    );

    assert_eq!(reasoning, None);
}

fn deepseek_chat_behavior() -> super::ProviderProtocolBehavior {
    let provider =
        create_oss_provider_with_base_url("https://api.deepseek.com/v1", WireApi::ChatCompletions);
    let mut model = test_model_info();
    model.slug = "deepseek-v4-pro".to_string();
    super::ProviderProtocolBehavior::for_provider(&provider, &model)
}

fn chat_behavior_for(base_url: &str, model_slug: &str) -> super::ProviderProtocolBehavior {
    let provider = create_oss_provider_with_base_url(base_url, WireApi::ChatCompletions);
    let mut model = test_model_info();
    model.slug = model_slug.to_string();
    super::ProviderProtocolBehavior::for_provider(&provider, &model)
}

fn test_session_telemetry() -> SessionTelemetry {
    SessionTelemetry::new(
        ThreadId::new(),
        "gpt-test",
        "gpt-test",
        /*account_id*/ None,
        /*account_email*/ None,
        /*auth_mode*/ None,
        "test-originator".to_string(),
        /*log_user_prompts*/ false,
        "test-terminal".to_string(),
        SessionSource::Cli,
    )
}

#[test]
fn chat_completions_system_prompt_includes_developer_instructions() {
    let input = vec![
        ResponseItem::Message {
            id: None,
            role: "developer".to_string(),
            content: vec![ContentItem::InputText {
                text: "<collaboration_mode>Plan Mode rules</collaboration_mode>".to_string(),
            }],
            end_turn: None,
            phase: None,
        },
        ResponseItem::Message {
            id: None,
            role: "user".to_string(),
            content: vec![ContentItem::InputText {
                text: "Build a website".to_string(),
            }],
            end_turn: None,
            phase: None,
        },
    ];

    let system = super::build_system_prompt("base instructions", &input)
        .expect("system prompt should include base and developer instructions");
    assert!(system.contains("base instructions"));
    assert!(system.contains("<collaboration_mode>Plan Mode rules</collaboration_mode>"));

    let messages = super::build_chat_messages(&input, &deepseek_chat_behavior());
    assert_eq!(
        messages,
        vec![json!({
            "role": "user",
            "content": "Build a website",
        })]
    );
}

#[test]
fn parse_chat_completions_payload_preserves_reasoning_content() {
    let payload = json!({
        "id": "chatcmpl-test",
        "choices": [{
            "message": {
                "role": "assistant",
                "content": "I will inspect that.",
                "reasoning_content": "Need inspect before answering.",
                "tool_calls": [{
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "exec_command",
                        "arguments": "{\"cmd\":\"ls\"}"
                    }
                }]
            }
        }]
    });

    let behavior = deepseek_chat_behavior();
    let mapped =
        super::parse_chat_completions_payload(&payload, &super::ToolMappings::default(), &behavior);

    assert_eq!(mapped.assistant_text, "I will inspect that.");
    assert_eq!(
        mapped
            .reasoning
            .as_ref()
            .and_then(|value| value.visible_text.as_deref()),
        Some("Need inspect before answering.")
    );
    assert_eq!(
        mapped
            .reasoning
            .as_ref()
            .and_then(|value| value.provider_replay.as_ref())
            .and_then(|replay| replay.fields.get("reasoning_content"))
            .and_then(serde_json::Value::as_str),
        Some("Need inspect before answering.")
    );
    assert_eq!(mapped.function_calls.len(), 1);
}

#[test]
fn parse_chat_completions_payload_preserves_empty_deepseek_reasoning_content() {
    let payload = json!({
        "id": "chatcmpl-empty-reasoning",
        "choices": [{
            "message": {
                "role": "assistant",
                "content": "",
                "reasoning_content": "",
                "tool_calls": [{
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "exec_command",
                        "arguments": "{\"cmd\":\"pwd\"}"
                    }
                }]
            }
        }]
    });

    let behavior = deepseek_chat_behavior();
    let mapped =
        super::parse_chat_completions_payload(&payload, &super::ToolMappings::default(), &behavior);
    let replay = mapped
        .reasoning
        .as_ref()
        .and_then(|reasoning| reasoning.provider_replay.as_ref())
        .expect("empty reasoning should still have replay metadata");

    assert_eq!(
        replay.fields.get("reasoning_content"),
        Some(&serde_json::Value::String(String::new()))
    );
    assert_eq!(mapped.function_calls.len(), 1);
}

#[test]
fn parse_chat_completions_payload_reads_cached_prompt_tokens() {
    let payload = json!({
        "id": "chatcmpl-cache-usage",
        "choices": [{
            "message": {
                "role": "assistant",
                "content": "Done."
            }
        }],
        "usage": {
            "prompt_tokens": 100,
            "completion_tokens": 5,
            "total_tokens": 105,
            "prompt_tokens_details": {
                "cached_tokens": 80
            }
        }
    });

    let behavior = chat_behavior_for("https://example.com/v1", "gpt-test");
    let mapped =
        super::parse_chat_completions_payload(&payload, &super::ToolMappings::default(), &behavior);

    let usage = mapped.token_usage.expect("chat usage should parse");
    assert_eq!(usage.input_tokens, 100);
    assert_eq!(usage.cached_input_tokens, 80);
    assert_eq!(usage.output_tokens, 5);
    assert_eq!(usage.total_tokens, 105);
}

#[test]
fn streaming_chat_completions_accumulates_reasoning_text_and_tool_calls() {
    let behavior = deepseek_chat_behavior();
    let mut state = super::StreamingChatCompletionsState::default();

    let update = super::apply_streaming_chat_completions_chunk(
        &mut state,
        &json!({
            "id": "chatcmpl-stream",
            "choices": [{
                "delta": {
                    "reasoning_content": "Need "
                }
            }]
        }),
        &behavior,
    );
    assert_eq!(update.reasoning_delta.as_deref(), Some("Need "));

    let update = super::apply_streaming_chat_completions_chunk(
        &mut state,
        &json!({
            "id": "chatcmpl-stream",
            "choices": [{
                "delta": {
                    "reasoning_content": "a tool.",
                    "content": "Working"
                }
            }]
        }),
        &behavior,
    );
    assert_eq!(update.reasoning_delta.as_deref(), Some("a tool."));
    assert_eq!(update.text_delta.as_deref(), Some("Working"));

    super::apply_streaming_chat_completions_chunk(
        &mut state,
        &json!({
            "id": "chatcmpl-stream",
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": "exec_command",
                            "arguments": "{\"cmd\":"
                        }
                    }]
                }
            }]
        }),
        &behavior,
    );
    super::apply_streaming_chat_completions_chunk(
        &mut state,
        &json!({
            "id": "chatcmpl-stream",
            "usage": {"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5},
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "function": {
                            "arguments": "\"pwd\"}"
                        }
                    }]
                }
            }]
        }),
        &behavior,
    );

    let mapped = super::provider_payload_from_streaming_chat_state(
        state,
        &super::ToolMappings::default(),
        &behavior,
    );
    assert_eq!(mapped.response_id, "chatcmpl-stream");
    assert_eq!(mapped.assistant_text, "Working");
    assert_eq!(
        mapped
            .reasoning
            .as_ref()
            .and_then(|reasoning| reasoning.visible_text.as_deref()),
        Some("Need a tool.")
    );
    assert_eq!(
        mapped
            .reasoning
            .as_ref()
            .and_then(|reasoning| reasoning.provider_replay.as_ref())
            .and_then(|replay| replay.fields.get("reasoning_content"))
            .and_then(serde_json::Value::as_str),
        Some("Need a tool.")
    );
    assert_eq!(mapped.function_calls.len(), 1);
    assert_eq!(mapped.function_calls[0].call_id, "call_1");
    assert_eq!(mapped.function_calls[0].name, "exec_command");
    assert_eq!(mapped.function_calls[0].input, json!({"cmd": "pwd"}));
    assert_eq!(
        mapped.token_usage.as_ref().map(|usage| usage.total_tokens),
        Some(5)
    );
}

#[test]
fn streaming_chat_completions_emits_tool_argument_deltas() {
    let behavior = deepseek_chat_behavior();
    let mappings = super::ToolMappings::default();
    let mut state = super::StreamingChatCompletionsState::default();

    let update = super::apply_streaming_chat_completions_chunk(
        &mut state,
        &json!({
            "id": "chatcmpl-stream",
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": "exec_command",
                            "arguments": "{\"cmd\":"
                        }
                    }]
                }
            }]
        }),
        &behavior,
    );
    let events = super::collect_streaming_chat_tool_call_events(
        &mut state,
        &mappings,
        &update.tool_call_indexes,
    );
    assert_eq!(events.len(), 2);
    match &events[0] {
        ResponseEvent::OutputItemAdded(ResponseItem::FunctionCall {
            name,
            namespace,
            arguments,
            call_id,
            ..
        }) => {
            assert_eq!(name, "exec_command");
            assert_eq!(namespace, &None);
            assert_eq!(arguments, "");
            assert_eq!(call_id, "call_1");
        }
        other => panic!("expected function call item start, got {other:?}"),
    }
    match &events[1] {
        ResponseEvent::ToolCallInputDelta {
            item_id,
            call_id,
            delta,
        } => {
            assert_eq!(item_id, "call_1");
            assert_eq!(call_id.as_deref(), Some("call_1"));
            assert_eq!(delta, "{\"cmd\":");
        }
        other => panic!("expected tool input delta, got {other:?}"),
    }

    let update = super::apply_streaming_chat_completions_chunk(
        &mut state,
        &json!({
            "id": "chatcmpl-stream",
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "function": {
                            "arguments": "\"pwd\"}"
                        }
                    }]
                }
            }]
        }),
        &behavior,
    );
    let events = super::collect_streaming_chat_tool_call_events(
        &mut state,
        &mappings,
        &update.tool_call_indexes,
    );
    assert_eq!(events.len(), 1);
    match &events[0] {
        ResponseEvent::ToolCallInputDelta { delta, .. } => assert_eq!(delta, "\"pwd\"}"),
        other => panic!("expected second tool input delta, got {other:?}"),
    }
}

#[test]
fn streaming_chat_completions_reads_cached_prompt_tokens() {
    let behavior = chat_behavior_for("https://example.com/v1", "gpt-test");
    let mut state = super::StreamingChatCompletionsState::default();

    super::apply_streaming_chat_completions_chunk(
        &mut state,
        &json!({
            "id": "chatcmpl-stream-cache-usage",
            "usage": {
                "prompt_tokens": 200,
                "completion_tokens": 10,
                "total_tokens": 210,
                "input_tokens_details": {
                    "cached_tokens": 150
                }
            },
            "choices": []
        }),
        &behavior,
    );

    let usage = state
        .token_usage
        .expect("streaming chat usage should parse");
    assert_eq!(usage.input_tokens, 200);
    assert_eq!(usage.cached_input_tokens, 150);
    assert_eq!(usage.output_tokens, 10);
    assert_eq!(usage.total_tokens, 210);
}

#[test]
fn chat_prompt_cache_key_helpers_apply_disable_and_remove() {
    let behavior = chat_behavior_for("https://example.com/v1", "gpt-test");
    let mut payload = json!({
        "model": "gpt-test",
        "messages": [],
        "stream": true
    });

    assert!(super::apply_chat_prompt_cache_key(
        &mut payload,
        &behavior,
        "thread-cache-key"
    ));
    assert_eq!(payload["prompt_cache_key"], json!("thread-cache-key"));
    assert!(super::remove_chat_prompt_cache_key(&mut payload));
    assert!(payload.get("prompt_cache_key").is_none());

    let mut disabled_behavior = behavior.clone();
    disabled_behavior.prompt_cache_key = false;
    assert!(!super::apply_chat_prompt_cache_key(
        &mut payload,
        &disabled_behavior,
        "thread-cache-key"
    ));
    assert!(payload.get("prompt_cache_key").is_none());
}

#[test]
fn chat_prompt_cache_key_unsupported_detects_provider_rejections() {
    assert!(super::chat_prompt_cache_key_unsupported(
        reqwest::StatusCode::BAD_REQUEST,
        "Unknown parameter: prompt_cache_key"
    ));
    assert!(super::chat_prompt_cache_key_unsupported(
        reqwest::StatusCode::UNPROCESSABLE_ENTITY,
        "prompt_cache_retention is not allowed"
    ));
    assert!(!super::chat_prompt_cache_key_unsupported(
        reqwest::StatusCode::UNAUTHORIZED,
        "prompt_cache_key is invalid"
    ));
    assert!(!super::chat_prompt_cache_key_unsupported(
        reqwest::StatusCode::BAD_REQUEST,
        "stream is not supported"
    ));
}

#[test]
fn streaming_chat_completions_injects_empty_deepseek_reasoning_for_tool_only() {
    let behavior = deepseek_chat_behavior();
    let mut state = super::StreamingChatCompletionsState::default();

    super::apply_streaming_chat_completions_chunk(
        &mut state,
        &json!({
            "id": "chatcmpl-tool-only",
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": "exec_command",
                            "arguments": "{\"cmd\":\"pwd\"}"
                        }
                    }]
                }
            }]
        }),
        &behavior,
    );

    let mapped = super::provider_payload_from_streaming_chat_state(
        state,
        &super::ToolMappings::default(),
        &behavior,
    );
    let replay = mapped
        .reasoning
        .as_ref()
        .and_then(|reasoning| reasoning.provider_replay.as_ref())
        .expect("DeepSeek tool-only streaming result should keep replay metadata");
    assert_eq!(
        replay.fields.get("reasoning_content"),
        Some(&serde_json::Value::String(String::new()))
    );
}

#[test]
fn build_chat_messages_replays_empty_deepseek_reasoning_content() {
    let behavior = deepseek_chat_behavior();
    let messages = super::build_chat_messages(
        &[
            ResponseItem::Reasoning {
                id: "reasoning-empty".to_string(),
                summary: Vec::new(),
                content: None,
                encrypted_content: None,
                provider_replay: Some(ReasoningProviderReplay {
                    provider: "deepseek".to_string(),
                    protocol: "chat_completions".to_string(),
                    fields: std::collections::HashMap::from([(
                        "reasoning_content".to_string(),
                        serde_json::Value::String(String::new()),
                    )]),
                }),
            },
            ResponseItem::FunctionCall {
                id: None,
                name: "exec_command".to_string(),
                namespace: None,
                arguments: "{\"cmd\":\"pwd\"}".to_string(),
                call_id: "call_1".to_string(),
            },
        ],
        &behavior,
    );

    assert_eq!(
        messages,
        vec![json!({
            "role": "assistant",
            "content": null,
            "reasoning_content": "",
            "tool_calls": [{
                "id": "call_1",
                "type": "function",
                "function": {
                    "name": "exec_command",
                    "arguments": "{\"cmd\":\"pwd\"}",
                },
            }],
        })]
    );
}

#[test]
fn build_chat_messages_adds_empty_reasoning_for_deepseek_tool_call_when_missing() {
    let behavior = deepseek_chat_behavior();
    let messages = super::build_chat_messages(
        &[ResponseItem::FunctionCall {
            id: None,
            name: "exec_command".to_string(),
            namespace: None,
            arguments: "{\"cmd\":\"pwd\"}".to_string(),
            call_id: "call_1".to_string(),
        }],
        &behavior,
    );

    assert_eq!(messages[0]["reasoning_content"], "");
}

#[test]
fn chat_messages_do_not_synthesize_reasoning_for_mistral() {
    let behavior = chat_behavior_for("https://api.mistral.ai/v1", "mistral-large-latest");
    let messages = super::build_chat_messages(
        &[
            ResponseItem::Reasoning {
                id: "reasoning-1".to_string(),
                summary: Vec::new(),
                content: Some(vec![ReasoningItemContent::ReasoningText {
                    text: "provider-visible reasoning".to_string(),
                }]),
                encrypted_content: None,
                provider_replay: None,
            },
            ResponseItem::FunctionCall {
                id: None,
                name: "exec_command".to_string(),
                namespace: None,
                arguments: "{\"cmd\":\"pwd\"}".to_string(),
                call_id: "call_1".to_string(),
            },
        ],
        &behavior,
    );

    assert!(messages[0].get("reasoning_content").is_none());
    assert!(messages[0].get("reasoning").is_none());
    assert!(messages[0].get("reasoning_details").is_none());
}

#[test]
fn openrouter_reasoning_details_round_trips_raw_shape() {
    let behavior = chat_behavior_for("https://openrouter.ai/api/v1", "openai/gpt-oss-120b");
    let payload = json!({
        "id": "openrouter-response",
        "choices": [{
            "message": {
                "role": "assistant",
                "content": "",
                "reasoning_details": [{
                    "type": "reasoning.text",
                    "text": "Need a tool."
                }],
                "tool_calls": [{
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "exec_command",
                        "arguments": "{\"cmd\":\"pwd\"}"
                    }
                }]
            }
        }]
    });

    let mapped =
        super::parse_chat_completions_payload(&payload, &super::ToolMappings::default(), &behavior);
    let replay = mapped
        .reasoning
        .as_ref()
        .and_then(|reasoning| reasoning.provider_replay.as_ref())
        .expect("reasoning_details should be replayed");
    assert_eq!(
        replay.fields.get("reasoning_details"),
        payload.pointer("/choices/0/message/reasoning_details")
    );

    let messages = super::build_chat_messages(
        &[
            ResponseItem::Reasoning {
                id: "reasoning-openrouter".to_string(),
                summary: Vec::new(),
                content: None,
                encrypted_content: None,
                provider_replay: Some(replay.clone()),
            },
            ResponseItem::FunctionCall {
                id: None,
                name: "exec_command".to_string(),
                namespace: None,
                arguments: "{\"cmd\":\"pwd\"}".to_string(),
                call_id: "call_1".to_string(),
            },
        ],
        &behavior,
    );
    assert_eq!(
        messages[0].get("reasoning_details"),
        payload.pointer("/choices/0/message/reasoning_details")
    );
}

#[test]
fn build_chat_messages_replays_reasoning_content_with_tool_call() {
    let behavior = deepseek_chat_behavior();
    let messages = super::build_chat_messages(
        &[
            ResponseItem::Reasoning {
                id: "reasoning-1".to_string(),
                summary: Vec::new(),
                content: Some(vec![ReasoningItemContent::ReasoningText {
                    text: "Need inspect before answering.".to_string(),
                }]),
                encrypted_content: None,
                provider_replay: None,
            },
            ResponseItem::Message {
                id: None,
                role: "assistant".to_string(),
                content: vec![ContentItem::OutputText {
                    text: "I will inspect that.".to_string(),
                }],
                end_turn: None,
                phase: None,
            },
            ResponseItem::FunctionCall {
                id: None,
                name: "exec_command".to_string(),
                namespace: None,
                arguments: "{\"cmd\":\"ls\"}".to_string(),
                call_id: "call_1".to_string(),
            },
            ResponseItem::FunctionCallOutput {
                call_id: "call_1".to_string(),
                output: FunctionCallOutputPayload::from_text("ok".to_string()),
            },
        ],
        &behavior,
    );

    assert_eq!(
        messages,
        vec![
            json!({
                "role": "assistant",
                "content": "I will inspect that.",
                "reasoning_content": "Need inspect before answering.",
                "tool_calls": [{
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "exec_command",
                        "arguments": "{\"cmd\":\"ls\"}",
                    },
                }],
            }),
            json!({
                "role": "tool",
                "tool_call_id": "call_1",
                "content": "ok",
            }),
        ]
    );
}

#[test]
fn build_chat_messages_accumulates_contiguous_reasoning_content() {
    let behavior = deepseek_chat_behavior();
    let messages = super::build_chat_messages(
        &[
            ResponseItem::Reasoning {
                id: "reasoning-1".to_string(),
                summary: Vec::new(),
                content: Some(vec![ReasoningItemContent::ReasoningText {
                    text: "First thought.".to_string(),
                }]),
                encrypted_content: None,
                provider_replay: None,
            },
            ResponseItem::Reasoning {
                id: "reasoning-2".to_string(),
                summary: Vec::new(),
                content: Some(vec![ReasoningItemContent::ReasoningText {
                    text: "Second thought.".to_string(),
                }]),
                encrypted_content: None,
                provider_replay: None,
            },
            ResponseItem::Message {
                id: None,
                role: "assistant".to_string(),
                content: vec![ContentItem::OutputText {
                    text: "Done.".to_string(),
                }],
                end_turn: None,
                phase: None,
            },
        ],
        &behavior,
    );

    assert_eq!(
        messages,
        vec![json!({
            "role": "assistant",
            "content": "Done.",
            "reasoning_content": "First thought.\nSecond thought.",
        })]
    );
}

#[test]
fn build_tool_mappings_wraps_freeform_tools_for_chat_completions() {
    let mappings = super::build_tool_mappings(&[ToolSpec::Freeform(FreeformTool {
        name: "apply_patch".to_string(),
        description: "Use raw patch text.".to_string(),
        format: FreeformToolFormat {
            r#type: "grammar".to_string(),
            syntax: "lark".to_string(),
            definition: "start: /.+/".to_string(),
        },
    })]);

    let tools = super::build_chat_tools(&mappings);

    assert_eq!(
        tools,
        vec![json!({
            "type": "function",
            "function": {
                "name": "apply_patch",
                "description": "Use raw patch text. For this Chat Completions provider, call it as a JSON function with exactly one string field: input.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "input": {
                            "type": "string",
                            "description": "Raw freeform tool input. For apply_patch this must be the complete patch text, starting with *** Begin Patch and ending with *** End Patch."
                        }
                    },
                    "required": ["input"],
                    "additionalProperties": false
                }
            }
        })]
    );
}

#[test]
fn anthropic_signed_and_redacted_thinking_replays_unsigned_does_not() {
    let payload = json!({
        "id": "msg_1",
        "content": [
            {
                "type": "thinking",
                "thinking": "Unsigned interim thought"
            },
            {
                "type": "thinking",
                "thinking": "Signed completed thought",
                "signature": "sig_123"
            },
            {
                "type": "redacted_thinking",
                "data": "opaque"
            },
            {
                "type": "tool_use",
                "id": "toolu_1",
                "name": "exec_command",
                "input": {"cmd": "pwd"}
            }
        ],
        "usage": {"input_tokens": 1, "output_tokens": 2}
    });

    let mapped = super::parse_anthropic_response_payload(&payload, &super::ToolMappings::default());
    assert_eq!(
        mapped
            .reasoning
            .as_ref()
            .and_then(|value| value.visible_text.as_deref()),
        Some("Unsigned interim thought\nSigned completed thought")
    );
    let replay_blocks = mapped
        .reasoning
        .as_ref()
        .and_then(|reasoning| reasoning.provider_replay.as_ref())
        .and_then(|replay| replay.fields.get("content_blocks"))
        .and_then(serde_json::Value::as_array)
        .expect("signed/redacted thinking should be replayed");
    assert_eq!(replay_blocks.len(), 2);
    assert_eq!(replay_blocks[0]["signature"], "sig_123");
    assert_eq!(replay_blocks[1]["type"], "redacted_thinking");

    let messages = super::build_anthropic_messages(
        &[
            ResponseItem::Reasoning {
                id: "reasoning-anthropic".to_string(),
                summary: Vec::new(),
                content: None,
                encrypted_content: None,
                provider_replay: mapped
                    .reasoning
                    .as_ref()
                    .and_then(|reasoning| reasoning.provider_replay.clone()),
            },
            ResponseItem::FunctionCall {
                id: None,
                name: "exec_command".to_string(),
                namespace: None,
                arguments: "{\"cmd\":\"pwd\"}".to_string(),
                call_id: "toolu_1".to_string(),
            },
        ],
        &super::ToolMappings::default(),
    );

    let content = messages[0]["content"]
        .as_array()
        .expect("assistant content");
    assert_eq!(content.len(), 3);
    assert_eq!(content[0]["thinking"], "Signed completed thought");
    assert_eq!(content[1]["type"], "redacted_thinking");
    assert_eq!(content[2]["type"], "tool_use");
}

#[test]
fn gemini_thought_parts_parse_as_reasoning_not_assistant_text() {
    let payload = json!({
        "candidates": [{
            "index": 0,
            "content": {
                "parts": [
                    {"text": "Need a function.", "thought": true},
                    {"text": "Visible answer."}
                ]
            }
        }]
    });

    let mapped = super::parse_gemini_response_payload(&payload, &super::ToolMappings::default());

    assert_eq!(mapped.assistant_text, "Visible answer.");
    assert_eq!(
        mapped
            .reasoning
            .as_ref()
            .and_then(|value| value.visible_text.as_deref()),
        Some("Need a function.")
    );
}

#[test]
fn reasoning_effort_maps_to_provider_specific_thinking_controls() {
    assert_eq!(
        super::deepseek_reasoning_effort(Some(lyra_protocol::openai_models::ReasoningEffort::Low)),
        "high"
    );
    assert_eq!(
        super::deepseek_reasoning_effort(Some(
            lyra_protocol::openai_models::ReasoningEffort::XHigh
        )),
        "max"
    );
    assert_eq!(
        super::gemini_thinking_budget(Some(lyra_protocol::openai_models::ReasoningEffort::High)),
        Some(16_000)
    );
    assert_eq!(
        super::anthropic_thinking_budget(Some(lyra_protocol::openai_models::ReasoningEffort::None)),
        None
    );
}

#[test]
fn anthropic_thinking_budget_stays_below_max_tokens() {
    for effort in [
        ReasoningEffort::Minimal,
        ReasoningEffort::Low,
        ReasoningEffort::Medium,
        ReasoningEffort::High,
        ReasoningEffort::XHigh,
    ] {
        let budget = super::anthropic_thinking_budget(Some(effort)).expect("thinking budget");
        assert!(
            budget < super::anthropic_max_tokens(Some(budget)),
            "{effort:?} budget must be lower than max_tokens"
        );
    }
    assert_eq!(
        super::anthropic_max_tokens(None),
        super::DEFAULT_ANTHROPIC_MAX_TOKENS
    );
}

#[test]
fn build_subagent_headers_sets_other_subagent_label() {
    let client = test_model_client(SessionSource::SubAgent(SubAgentSource::Other(
        "memory_consolidation".to_string(),
    )));
    let headers = client.build_subagent_headers();
    let value = headers
        .get(X_LYRA_SUBAGENT_HEADER)
        .and_then(|value| value.to_str().ok());
    assert_eq!(value, Some("memory_consolidation"));
}

#[test]
fn build_ws_client_metadata_includes_window_lineage_and_turn_metadata() {
    let parent_thread_id = ThreadId::new();
    let client = test_model_client(SessionSource::SubAgent(SubAgentSource::ThreadSpawn {
        parent_thread_id,
        depth: 2,
        agent_path: None,
        agent_nickname: None,
        agent_role: None,
    }));

    client.advance_window_generation();

    let client_metadata = client.build_ws_client_metadata(Some(r#"{"turn_id":"turn-123"}"#));
    let conversation_id = client.state.conversation_id;
    assert_eq!(
        client_metadata,
        std::collections::HashMap::from([
            (
                X_LYRA_INSTALLATION_ID_HEADER.to_string(),
                "11111111-1111-4111-8111-111111111111".to_string(),
            ),
            (
                X_LYRA_WINDOW_ID_HEADER.to_string(),
                format!("{conversation_id}:1"),
            ),
            (
                X_LYRA_SUBAGENT_HEADER.to_string(),
                "collab_spawn".to_string(),
            ),
            (
                X_LYRA_PARENT_THREAD_ID_HEADER.to_string(),
                parent_thread_id.to_string(),
            ),
            (
                X_LYRA_TURN_METADATA_HEADER.to_string(),
                r#"{"turn_id":"turn-123"}"#.to_string(),
            ),
        ])
    );
}

#[tokio::test]
async fn summarize_memories_returns_empty_for_empty_input() {
    let client = test_model_client(SessionSource::Cli);
    let model_info = test_model_info();
    let session_telemetry = test_session_telemetry();

    let output = client
        .summarize_memories(
            Vec::new(),
            &model_info,
            /*effort*/ None,
            &session_telemetry,
        )
        .await
        .expect("empty summarize request should succeed");
    assert_eq!(output.len(), 0);
}

#[test]
fn auth_request_telemetry_context_tracks_attached_auth_and_retry_phase() {
    let auth_context = AuthRequestTelemetryContext::new(
        &BearerAuthProvider::for_test(Some("access-token")),
        PendingUnauthorizedRetry::from_recovery(UnauthorizedRecoveryExecution {
            mode: "managed",
            phase: "refresh_token",
        }),
    );

    assert!(auth_context.auth_header_attached);
    assert_eq!(auth_context.auth_header_name, Some("authorization"));
    assert!(auth_context.retry_after_unauthorized);
    assert_eq!(auth_context.recovery_mode, Some("managed"));
    assert_eq!(auth_context.recovery_phase, Some("refresh_token"));
}
