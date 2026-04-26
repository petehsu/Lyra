use super::AuthRequestTelemetryContext;
use super::ModelClient;
use super::PendingUnauthorizedRetry;
use super::UnauthorizedRecoveryExecution;
use super::X_LYRA_INSTALLATION_ID_HEADER;
use super::X_LYRA_PARENT_THREAD_ID_HEADER;
use super::X_LYRA_SUBAGENT_HEADER;
use super::X_LYRA_TURN_METADATA_HEADER;
use super::X_LYRA_WINDOW_ID_HEADER;
use lyra_app_server_protocol::AuthMode;
use lyra_model_provider::BearerAuthProvider;
use lyra_model_provider_info::WireApi;
use lyra_model_provider_info::create_oss_provider_with_base_url;
use lyra_otel::SessionTelemetry;
use lyra_protocol::ThreadId;
use lyra_protocol::models::ContentItem;
use lyra_protocol::models::FunctionCallOutputPayload;
use lyra_protocol::models::ReasoningItemContent;
use lyra_protocol::models::ResponseItem;
use lyra_protocol::openai_models::ModelInfo;
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
        /*enable_request_compression*/ false,
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

    let mapped = super::parse_chat_completions_payload(&payload, &super::ToolMappings::default());

    assert_eq!(mapped.assistant_text, "I will inspect that.");
    assert_eq!(
        mapped.reasoning_content.as_deref(),
        Some("Need inspect before answering.")
    );
    assert_eq!(mapped.function_calls.len(), 1);
}

#[test]
fn build_chat_messages_replays_reasoning_content_with_tool_call() {
    let messages = super::build_chat_messages(&[
        ResponseItem::Reasoning {
            id: "reasoning-1".to_string(),
            summary: Vec::new(),
            content: Some(vec![ReasoningItemContent::ReasoningText {
                text: "Need inspect before answering.".to_string(),
            }]),
            encrypted_content: None,
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
    ]);

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
    let messages = super::build_chat_messages(&[
        ResponseItem::Reasoning {
            id: "reasoning-1".to_string(),
            summary: Vec::new(),
            content: Some(vec![ReasoningItemContent::ReasoningText {
                text: "First thought.".to_string(),
            }]),
            encrypted_content: None,
        },
        ResponseItem::Reasoning {
            id: "reasoning-2".to_string(),
            summary: Vec::new(),
            content: Some(vec![ReasoningItemContent::ReasoningText {
                text: "Second thought.".to_string(),
            }]),
            encrypted_content: None,
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
    ]);

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
        Some(AuthMode::ApiKey),
        &BearerAuthProvider::for_test(Some("access-token")),
        PendingUnauthorizedRetry::from_recovery(UnauthorizedRecoveryExecution {
            mode: "managed",
            phase: "refresh_token",
        }),
    );

    assert_eq!(auth_context.auth_mode, Some("ApiKey"));
    assert!(auth_context.auth_header_attached);
    assert_eq!(auth_context.auth_header_name, Some("authorization"));
    assert!(auth_context.retry_after_unauthorized);
    assert_eq!(auth_context.recovery_mode, Some("managed"));
    assert_eq!(auth_context.recovery_phase, Some("refresh_token"));
}
