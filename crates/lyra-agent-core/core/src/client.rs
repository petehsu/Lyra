//! Session- and turn-scoped helpers for talking to model provider APIs.
//!
//! `ModelClient` is intended to live for the lifetime of a Lyra session and holds the stable
//! configuration and state needed to talk to a provider (auth, provider selection, conversation id,
//! and transport fallback state).
//!
//! Per-turn settings (model selection, reasoning controls, telemetry context, and turn metadata)
//! are passed explicitly to streaming and unary methods so that the turn lifetime is visible at the
//! call site.
//!
//! A [`ModelClientSession`] is created per turn and is used to stream one or more Responses API
//! requests during that turn. It caches a Responses WebSocket connection (opened lazily) and stores
//! per-turn state such as the `x-lyra-turn-state` token used for sticky routing.
//!
//! WebSocket prewarm is a v2-only `response.create` with `generate=false`; it waits for completion
//! so the next request can reuse the same connection and `previous_response_id`.
//!
//! Turn execution performs prewarm as a best-effort step before the first stream request so the
//! subsequent request can reuse the same connection.
//!
//! ## Retry-Budget Tradeoff
//!
//! WebSocket prewarm is treated as the first websocket connection attempt for a turn. If it
//! fails, normal stream retry/fallback logic handles recovery on the same turn.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::sync::OnceLock;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;

use lyra_api::ApiError;
use lyra_api::AuthProvider;
use lyra_api::Compression;
use lyra_api::MemoriesClient as ApiMemoriesClient;
use lyra_api::MemorySummarizeInput as ApiMemorySummarizeInput;
use lyra_api::MemorySummarizeOutput as ApiMemorySummarizeOutput;
use lyra_api::Provider as ApiProvider;
use lyra_api::RawMemory as ApiRawMemory;
use lyra_api::Reasoning;
use lyra_api::RequestTelemetry;
use lyra_api::ReqwestTransport;
use lyra_api::ResponseCreateWsRequest;
use lyra_api::ResponsesApiRequest;
use lyra_api::ResponsesClient as ApiResponsesClient;
use lyra_api::ResponsesOptions as ApiResponsesOptions;
use lyra_api::ResponsesWebsocketClient as ApiWebSocketResponsesClient;
use lyra_api::ResponsesWebsocketConnection as ApiWebSocketConnection;
use lyra_api::ResponsesWsRequest;
use lyra_api::SharedAuthProvider;
use lyra_api::SseTelemetry;
use lyra_api::TransportError;
use lyra_api::WebsocketTelemetry;
use lyra_api::auth_header_telemetry;
use lyra_api::build_conversation_headers;
use lyra_api::create_text_param_for_request;
use lyra_api::response_create_client_metadata;
use lyra_app_server_protocol::AuthMode;
use lyra_login::AuthManager;
use lyra_login::LyraAuth;
use lyra_login::RefreshTokenError;
use lyra_login::UnauthorizedRecovery;
use lyra_login::default_client::build_reqwest_client;
use lyra_otel::SessionTelemetry;
use lyra_otel::current_span_w3c_trace_context;

use eventsource_stream::Event;
use eventsource_stream::EventStreamError;
use futures::StreamExt;
use http::HeaderMap as ApiHeaderMap;
use http::HeaderValue;
use http::StatusCode as HttpStatusCode;
use lyra_protocol::ThreadId;
use lyra_protocol::config_types::ReasoningSummary as ReasoningSummaryConfig;
use lyra_protocol::config_types::ServiceTier;
use lyra_protocol::config_types::Verbosity as VerbosityConfig;
use lyra_protocol::models::ContentItem;
use lyra_protocol::models::ReasoningItemContent;
use lyra_protocol::models::ResponseItem;
use lyra_protocol::openai_models::ModelInfo;
use lyra_protocol::openai_models::ReasoningEffort as ReasoningEffortConfig;
use lyra_protocol::protocol::SessionSource;
use lyra_protocol::protocol::SubAgentSource;
use lyra_protocol::protocol::TokenUsage;
use lyra_protocol::protocol::W3cTraceContext;
use lyra_tools::ResponsesApiNamespaceTool;
use lyra_tools::ToolSpec;
use lyra_tools::create_tools_json_for_responses_api;
use reqwest::StatusCode;
use serde_json::Value as JsonValue;
use serde_json::json;
use std::time::Duration;
use std::time::Instant;
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use tokio::sync::oneshot::error::TryRecvError;
use tokio_tungstenite::tungstenite::Error;
use tokio_tungstenite::tungstenite::Message;
use tracing::instrument;
use tracing::trace;
use tracing::warn;

use crate::client_common::Prompt;
use crate::client_common::ResponseEvent;
use crate::client_common::ResponseStream;
use crate::flags::LYRA_RS_SSE_FIXTURE;
use crate::util::emit_feedback_auth_recovery_tags;
use lyra_api::map_api_error;
use lyra_login::auth_env_telemetry::AuthEnvTelemetry;
use lyra_login::auth_env_telemetry::collect_auth_env_telemetry;
use lyra_model_provider::SharedModelProvider;
use lyra_model_provider::create_model_provider;
#[cfg(test)]
use lyra_model_provider_info::DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS;
use lyra_model_provider_info::ModelProviderInfo;
use lyra_model_provider_info::WireApi;
use lyra_protocol::error::LyraErr;
use lyra_protocol::error::Result;
use lyra_response_debug_context::extract_response_debug_context;
use lyra_response_debug_context::extract_response_debug_context_from_api_error;
use lyra_response_debug_context::telemetry_api_error_message;
use lyra_response_debug_context::telemetry_transport_error_message;
use lyra_rollout_trace::InferenceTraceAttempt;
use lyra_rollout_trace::InferenceTraceContext;

// Provider compatibility header required by Responses websocket beta endpoints.
pub const RESPONSES_PROVIDER_COMPAT_HEADER_NAME: &str = "OpenAI-Beta";
pub const X_LYRA_INSTALLATION_ID_HEADER: &str = "x-lyra-installation-id";
pub const X_LYRA_TURN_STATE_HEADER: &str = "x-lyra-turn-state";
pub const X_LYRA_TURN_METADATA_HEADER: &str = "x-lyra-turn-metadata";
pub const X_LYRA_PARENT_THREAD_ID_HEADER: &str = "x-lyra-parent-thread-id";
pub const X_LYRA_WINDOW_ID_HEADER: &str = "x-lyra-window-id";
pub const X_LYRA_SUBAGENT_HEADER: &str = "x-lyra-subagent";
pub const X_RESPONSESAPI_INCLUDE_TIMING_METRICS_HEADER: &str =
    "x-responsesapi-include-timing-metrics";
const RESPONSES_WEBSOCKETS_V2_BETA_HEADER_VALUE: &str = "responses_websockets=2026-02-06";
const RESPONSES_ENDPOINT: &str = "/responses";
const MEMORIES_SUMMARIZE_ENDPOINT: &str = "/memories/trace_summarize";
#[cfg(test)]
pub(crate) const WEBSOCKET_CONNECT_TIMEOUT: Duration =
    Duration::from_millis(DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS);

/// Session-scoped state shared by all [`ModelClient`] clones.
///
/// This is intentionally kept minimal so `ModelClient` does not need to hold a full `Config`. Most
/// configuration is per turn and is passed explicitly to streaming/unary methods.
#[derive(Debug)]
struct ModelClientState {
    conversation_id: ThreadId,
    window_generation: AtomicU64,
    installation_id: String,
    provider: SharedModelProvider,
    auth_env_telemetry: AuthEnvTelemetry,
    session_source: SessionSource,
    model_verbosity: Option<VerbosityConfig>,
    enable_request_compression: bool,
    include_timing_metrics: bool,
    disable_websockets: AtomicBool,
    cached_websocket_session: StdMutex<WebsocketSession>,
}

/// Resolved API client setup for a single request attempt.
///
/// Keeping this as a single bundle ensures prewarm and normal request paths
/// share the same auth/provider setup flow.
struct CurrentClientSetup {
    auth: Option<LyraAuth>,
    api_provider: ApiProvider,
    api_auth: SharedAuthProvider,
}

#[derive(Clone, Copy)]
struct RequestRouteTelemetry {
    endpoint: &'static str,
}

impl RequestRouteTelemetry {
    fn for_endpoint(endpoint: &'static str) -> Self {
        Self { endpoint }
    }
}

/// A session-scoped client for model-provider API calls.
///
/// This holds configuration and state that should be shared across turns within a Lyra session
/// (auth, provider selection, conversation id, and transport fallback state).
///
/// WebSocket fallback is session-scoped: once a turn activates the HTTP fallback, subsequent turns
/// will also use HTTP for the remainder of the session.
///
/// Turn-scoped settings (model selection, reasoning controls, telemetry context, and turn
/// metadata) are passed explicitly to the relevant methods to keep turn lifetime visible at the
/// call site.
#[derive(Debug, Clone)]
pub struct ModelClient {
    state: Arc<ModelClientState>,
}

/// A turn-scoped streaming session created from a [`ModelClient`].
///
/// The session establishes a Responses WebSocket connection lazily and reuses it across multiple
/// requests within the turn. It also caches per-turn state:
///
/// - The last full request, so subsequent calls can reuse incremental websocket request payloads
///   only when the current request is an incremental extension of the previous one.
/// - The `x-lyra-turn-state` sticky-routing token, which must be replayed for all requests within
///   the same turn.
///
/// Create a fresh `ModelClientSession` for each Lyra turn. Reusing it across turns would replay
/// the previous turn's sticky-routing token into the next turn, which violates the client/server
/// contract and can cause routing bugs.
pub struct ModelClientSession {
    client: ModelClient,
    websocket_session: WebsocketSession,
    /// Turn state for sticky routing.
    ///
    /// This is an `OnceLock` that stores the turn state value received from the server
    /// on turn start via the `x-lyra-turn-state` response header. Once set, this value
    /// should be sent back to the server in the `x-lyra-turn-state` request header for
    /// all subsequent requests within the same turn to maintain sticky routing.
    ///
    /// This is a contract between the client and server: we receive it at turn start,
    /// keep sending it unchanged between turn requests (e.g., for retries, incremental
    /// appends, or continuation requests), and must not send it between different turns.
    turn_state: Arc<OnceLock<String>>,
}

#[derive(Debug, Clone)]
struct LastResponse {
    response_id: String,
    items_added: Vec<ResponseItem>,
}

#[derive(Debug, Default)]
struct WebsocketSession {
    connection: Option<ApiWebSocketConnection>,
    last_request: Option<ResponsesApiRequest>,
    last_response_rx: Option<oneshot::Receiver<LastResponse>>,
    connection_reused: StdMutex<bool>,
}

impl WebsocketSession {
    fn set_connection_reused(&self, connection_reused: bool) {
        *self
            .connection_reused
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = connection_reused;
    }

    fn connection_reused(&self) -> bool {
        *self
            .connection_reused
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

enum WebsocketStreamOutcome {
    Stream(ResponseStream),
    FallbackToHttp,
}

const DEFAULT_ANTHROPIC_VERSION: &str = "2023-06-01";
const DEFAULT_ANTHROPIC_MAX_TOKENS: i64 = 4096;

#[derive(Debug, Clone)]
struct ProviderFunctionCall {
    call_id: String,
    name: String,
    namespace: Option<String>,
    input: JsonValue,
}

#[derive(Debug, Clone, Default)]
struct ProviderResponsePayload {
    assistant_text: String,
    reasoning_content: Option<String>,
    function_calls: Vec<ProviderFunctionCall>,
    token_usage: Option<TokenUsage>,
    response_id: String,
}

#[derive(Debug, Clone)]
struct ToolDescriptor {
    wire_name: String,
    canonical_name: String,
    namespace: Option<String>,
    description: String,
    input_schema: JsonValue,
}

#[derive(Debug, Default)]
struct ToolMappings {
    descriptors: Vec<ToolDescriptor>,
    canonical_to_wire: HashMap<String, String>,
    wire_to_descriptor: HashMap<String, ToolDescriptor>,
}

fn stream_error(message: impl Into<String>) -> LyraErr {
    LyraErr::Stream(message.into(), None)
}

fn assistant_message_item(text: String) -> ResponseItem {
    ResponseItem::Message {
        id: None,
        role: "assistant".to_string(),
        content: vec![ContentItem::OutputText { text }],
        end_turn: None,
        phase: None,
    }
}

fn response_stream_from_provider_payload(payload: ProviderResponsePayload) -> ResponseStream {
    let (tx, rx_event) = mpsc::channel::<Result<ResponseEvent>>(64);
    tokio::spawn(async move {
        if tx.send(Ok(ResponseEvent::Created)).await.is_err() {
            return;
        }

        if let Some(reasoning_content) = payload.reasoning_content
            && !reasoning_content.trim().is_empty()
            && tx
                .send(Ok(ResponseEvent::OutputItemDone(ResponseItem::Reasoning {
                    id: format!("{}-reasoning", payload.response_id),
                    summary: Vec::new(),
                    content: Some(vec![ReasoningItemContent::ReasoningText {
                        text: reasoning_content,
                    }]),
                    encrypted_content: None,
                })))
                .await
                .is_err()
        {
            return;
        }

        if !payload.assistant_text.trim().is_empty() {
            if tx
                .send(Ok(ResponseEvent::OutputItemAdded(assistant_message_item(
                    String::new(),
                ))))
                .await
                .is_err()
            {
                return;
            }
            if tx
                .send(Ok(ResponseEvent::OutputTextDelta(
                    payload.assistant_text.clone(),
                )))
                .await
                .is_err()
            {
                return;
            }
            if tx
                .send(Ok(ResponseEvent::OutputItemDone(assistant_message_item(
                    payload.assistant_text.clone(),
                ))))
                .await
                .is_err()
            {
                return;
            }
        }

        for call in payload.function_calls {
            let arguments = serde_json::to_string(&call.input).unwrap_or_else(|_| "{}".to_string());
            let item = ResponseItem::FunctionCall {
                id: None,
                name: call.name,
                namespace: call.namespace,
                arguments,
                call_id: call.call_id,
            };
            if tx
                .send(Ok(ResponseEvent::OutputItemDone(item)))
                .await
                .is_err()
            {
                return;
            }
        }

        let _ = tx
            .send(Ok(ResponseEvent::Completed {
                response_id: payload.response_id,
                token_usage: payload.token_usage,
            }))
            .await;
    });

    ResponseStream { rx_event }
}

fn canonical_tool_key(namespace: Option<&str>, name: &str) -> String {
    match namespace.map(str::trim).filter(|value| !value.is_empty()) {
        Some(namespace) => format!("{namespace}:{name}"),
        None => name.to_string(),
    }
}

fn sanitize_tool_name(name: &str) -> String {
    let mut sanitized = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    if sanitized.trim_matches('_').is_empty() {
        sanitized = "tool".to_string();
    }
    sanitized
}

fn default_tool_input_schema() -> JsonValue {
    json!({
        "type": "object",
        "properties": {},
        "additionalProperties": true
    })
}

fn freeform_tool_input_schema() -> JsonValue {
    json!({
        "type": "object",
        "properties": {
            "input": {
                "type": "string",
                "description": "Raw freeform tool input. For apply_patch this must be the complete patch text, starting with *** Begin Patch and ending with *** End Patch."
            }
        },
        "required": ["input"],
        "additionalProperties": false
    })
}

fn build_tool_mappings(tools: &[ToolSpec]) -> ToolMappings {
    let mut mappings = ToolMappings::default();
    let mut wire_name_counts: HashMap<String, usize> = HashMap::new();

    let mut register_descriptor = |canonical_name: String,
                                   namespace: Option<String>,
                                   description: String,
                                   input_schema: JsonValue| {
        let canonical_key = canonical_tool_key(namespace.as_deref(), canonical_name.as_str());
        let base_wire = sanitize_tool_name(canonical_key.replace(':', "_").as_str());
        let next_index = wire_name_counts.entry(base_wire.clone()).or_insert(0);
        *next_index += 1;
        let wire_name = if *next_index == 1 {
            base_wire
        } else {
            format!("{base_wire}_{}", next_index)
        };

        let descriptor = ToolDescriptor {
            wire_name: wire_name.clone(),
            canonical_name: canonical_name.clone(),
            namespace: namespace.clone(),
            description,
            input_schema,
        };
        mappings
            .canonical_to_wire
            .insert(canonical_key, wire_name.clone());
        mappings
            .wire_to_descriptor
            .insert(wire_name.clone(), descriptor.clone());
        mappings.descriptors.push(descriptor);
    };

    for tool in tools {
        match tool {
            ToolSpec::Function(function_tool) => {
                let input_schema = serde_json::to_value(&function_tool.parameters)
                    .unwrap_or_else(|_| default_tool_input_schema());
                register_descriptor(
                    function_tool.name.clone(),
                    None,
                    function_tool.description.clone(),
                    input_schema,
                );
            }
            ToolSpec::Namespace(namespace_tool) => {
                for nested_tool in &namespace_tool.tools {
                    let ResponsesApiNamespaceTool::Function(function_tool) = nested_tool;
                    let input_schema = serde_json::to_value(&function_tool.parameters)
                        .unwrap_or_else(|_| default_tool_input_schema());
                    register_descriptor(
                        function_tool.name.clone(),
                        Some(namespace_tool.name.clone()),
                        function_tool.description.clone(),
                        input_schema,
                    );
                }
            }
            ToolSpec::ToolSearch {
                description,
                parameters,
                ..
            } => {
                let input_schema = serde_json::to_value(parameters)
                    .unwrap_or_else(|_| default_tool_input_schema());
                register_descriptor(
                    "tool_search".to_string(),
                    None,
                    description.clone(),
                    input_schema,
                );
            }
            ToolSpec::LocalShell {} => {
                register_descriptor(
                    "local_shell".to_string(),
                    None,
                    "Local shell execution tool".to_string(),
                    default_tool_input_schema(),
                );
            }
            ToolSpec::ImageGeneration { .. } => {
                register_descriptor(
                    "image_generation".to_string(),
                    None,
                    "Image generation tool".to_string(),
                    default_tool_input_schema(),
                );
            }
            ToolSpec::WebSearch { .. } => {
                register_descriptor(
                    "web_search".to_string(),
                    None,
                    "Web search tool".to_string(),
                    default_tool_input_schema(),
                );
            }
            ToolSpec::Freeform(tool) => {
                register_descriptor(
                    tool.name.clone(),
                    None,
                    format!(
                        "{} For this Chat Completions provider, call it as a JSON function with exactly one string field: input.",
                        tool.description
                    ),
                    freeform_tool_input_schema(),
                );
            }
        }
    }

    mappings
}

fn resolve_wire_tool_name(mappings: &ToolMappings, name: &str, namespace: Option<&str>) -> String {
    let key = canonical_tool_key(namespace, name);
    mappings
        .canonical_to_wire
        .get(&key)
        .cloned()
        .unwrap_or_else(|| sanitize_tool_name(key.replace(':', "_").as_str()))
}

fn resolve_canonical_tool_name(
    mappings: &ToolMappings,
    wire_name: &str,
) -> (Option<String>, String) {
    match mappings.wire_to_descriptor.get(wire_name) {
        Some(descriptor) => (
            descriptor.namespace.clone(),
            descriptor.canonical_name.clone(),
        ),
        None => (None, wire_name.to_string()),
    }
}

fn add_system_fragment(fragments: &mut Vec<String>, value: &str) {
    let trimmed = value.trim();
    if !trimmed.is_empty() {
        fragments.push(trimmed.to_string());
    }
}

fn build_system_prompt(base_instructions: &str, input: &[ResponseItem]) -> Option<String> {
    let mut fragments = Vec::new();
    add_system_fragment(&mut fragments, base_instructions);
    for item in input {
        if let ResponseItem::Message { role, content, .. } = item
            && role == "system"
            && let Some(text) = crate::content_items::content_items_to_text(content)
        {
            add_system_fragment(&mut fragments, &text);
        }
    }
    if fragments.is_empty() {
        None
    } else {
        Some(fragments.join("\n\n"))
    }
}

fn parse_tool_input(input: &str) -> JsonValue {
    serde_json::from_str::<JsonValue>(input).unwrap_or_else(|_| json!({}))
}

fn function_output_text(output: &lyra_protocol::models::FunctionCallOutputPayload) -> String {
    output.text_content().unwrap_or_default().to_string()
}

fn parse_tool_response_text(text: &str) -> JsonValue {
    serde_json::from_str::<JsonValue>(text).unwrap_or_else(|_| {
        json!({
            "content": text
        })
    })
}

fn normalize_model_path(model: &str) -> String {
    let trimmed = model.trim().trim_start_matches('/');
    if trimmed.starts_with("models/") {
        trimmed.to_string()
    } else {
        format!("models/{trimmed}")
    }
}

fn as_i64(value: Option<&JsonValue>) -> Option<i64> {
    value.and_then(|value| {
        value
            .as_i64()
            .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
    })
}

fn token_usage_from_provider_counts(
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    total_tokens: Option<i64>,
) -> Option<TokenUsage> {
    if input_tokens.is_none() && output_tokens.is_none() && total_tokens.is_none() {
        return None;
    }

    let input_tokens = input_tokens.unwrap_or(0).max(0);
    let output_tokens = output_tokens.unwrap_or(0).max(0);
    let total_tokens = total_tokens.unwrap_or(input_tokens + output_tokens).max(0);
    Some(TokenUsage {
        input_tokens,
        cached_input_tokens: 0,
        output_tokens,
        reasoning_output_tokens: 0,
        total_tokens,
    })
}

fn reqwest_headers_from_api_provider(provider: &ApiProvider) -> reqwest::header::HeaderMap {
    let mut headers = reqwest::header::HeaderMap::new();
    for (name, value) in &provider.headers {
        headers.insert(name, value.clone());
    }
    headers
}

fn anthropic_messages_endpoint(base_url: &str) -> String {
    let base_url = base_url.trim_end_matches('/');
    if base_url.ends_with("/v1") {
        format!("{base_url}/messages")
    } else {
        format!("{base_url}/v1/messages")
    }
}

fn chat_completions_endpoint(base_url: &str) -> String {
    let base_url = base_url.trim_end_matches('/');
    if base_url.ends_with("/v1") {
        format!("{base_url}/chat/completions")
    } else {
        format!("{base_url}/v1/chat/completions")
    }
}

fn gemini_generate_content_endpoint(base_url: &str, model: &str) -> String {
    let base_url = base_url.trim_end_matches('/');
    let model_path = normalize_model_path(model);
    if base_url.ends_with("/v1beta") {
        format!("{base_url}/{model_path}:generateContent")
    } else {
        format!("{base_url}/v1beta/{model_path}:generateContent")
    }
}

fn reasoning_content_text(content: &[ReasoningItemContent]) -> Option<String> {
    let text = content
        .iter()
        .filter_map(|item| match item {
            ReasoningItemContent::ReasoningText { text } | ReasoningItemContent::Text { text } => {
                Some(text.trim())
            }
        })
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if text.is_empty() { None } else { Some(text) }
}

fn push_pending_reasoning_content(
    pending_reasoning_content: &mut Option<String>,
    content: &[ReasoningItemContent],
) {
    let Some(text) = reasoning_content_text(content) else {
        return;
    };
    match pending_reasoning_content {
        Some(existing) if !existing.trim().is_empty() => {
            existing.push('\n');
            existing.push_str(&text);
        }
        _ => *pending_reasoning_content = Some(text),
    }
}

fn chat_tool_call_item(item: &ResponseItem) -> Option<JsonValue> {
    match item {
        ResponseItem::FunctionCall {
            name,
            namespace,
            call_id,
            arguments,
            ..
        } => Some(json!({
            "id": call_id,
            "type": "function",
            "function": {
                "name": canonical_tool_key(namespace.as_deref(), name).replace(':', "_"),
                "arguments": arguments,
            },
        })),
        ResponseItem::CustomToolCall {
            call_id,
            name,
            input,
            ..
        } => Some(json!({
            "id": call_id,
            "type": "function",
            "function": {
                "name": sanitize_tool_name(name),
                "arguments": input,
            },
        })),
        _ => None,
    }
}

fn push_chat_assistant_message(
    messages: &mut Vec<JsonValue>,
    content: Option<String>,
    tool_calls: Vec<JsonValue>,
    pending_reasoning_content: &mut Option<String>,
) {
    let content_value = content
        .filter(|content| !content.trim().is_empty())
        .map(JsonValue::String)
        .unwrap_or(JsonValue::Null);
    let mut message = json!({
        "role": "assistant",
        "content": content_value,
    });
    if let Some(object) = message.as_object_mut() {
        if !tool_calls.is_empty() {
            object.insert("tool_calls".to_string(), JsonValue::Array(tool_calls));
        }
        if let Some(reasoning_content) = pending_reasoning_content
            .take()
            .filter(|value| !value.trim().is_empty())
        {
            object.insert(
                "reasoning_content".to_string(),
                JsonValue::String(reasoning_content),
            );
        }
    }
    messages.push(message);
}

fn build_chat_messages(input: &[ResponseItem]) -> Vec<JsonValue> {
    let mut messages = Vec::new();
    let mut pending_reasoning_content: Option<String> = None;
    let mut index = 0;

    while index < input.len() {
        match &input[index] {
            ResponseItem::Reasoning {
                content: Some(content),
                ..
            } => {
                push_pending_reasoning_content(&mut pending_reasoning_content, content);
                index += 1;
            }
            ResponseItem::Message { role, .. } if role == "system" => {
                index += 1;
            }
            ResponseItem::Message { role, content, .. } if role == "user" => {
                let text = crate::content_items::content_items_to_text(content).unwrap_or_default();
                messages.push(json!({
                    "role": role,
                    "content": text,
                }));
                index += 1;
            }
            ResponseItem::Message { role, content, .. } if role == "assistant" => {
                let text = crate::content_items::content_items_to_text(content).unwrap_or_default();
                let mut tool_calls = Vec::new();
                let mut cursor = index + 1;
                while cursor < input.len() {
                    if let Some(tool_call) = chat_tool_call_item(&input[cursor]) {
                        tool_calls.push(tool_call);
                        cursor += 1;
                    } else {
                        break;
                    }
                }
                push_chat_assistant_message(
                    &mut messages,
                    Some(text),
                    tool_calls,
                    &mut pending_reasoning_content,
                );
                index = cursor;
            }
            item if chat_tool_call_item(item).is_some() => {
                let mut tool_calls = Vec::new();
                while index < input.len() {
                    if let Some(tool_call) = chat_tool_call_item(&input[index]) {
                        tool_calls.push(tool_call);
                        index += 1;
                    } else {
                        break;
                    }
                }
                push_chat_assistant_message(
                    &mut messages,
                    None,
                    tool_calls,
                    &mut pending_reasoning_content,
                );
            }
            ResponseItem::FunctionCallOutput { call_id, output }
            | ResponseItem::CustomToolCallOutput {
                call_id, output, ..
            } => {
                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": function_output_text(output),
                }));
                index += 1;
            }
            _ => {
                index += 1;
            }
        }
    }

    messages
}

fn build_chat_tools(mappings: &ToolMappings) -> Vec<JsonValue> {
    mappings
        .descriptors
        .iter()
        .map(|descriptor| {
            json!({
                "type": "function",
                "function": {
                    "name": descriptor.wire_name,
                    "description": descriptor.description,
                    "parameters": descriptor.input_schema,
                }
            })
        })
        .collect()
}

fn parse_chat_completions_payload(
    payload: &JsonValue,
    mappings: &ToolMappings,
) -> ProviderResponsePayload {
    let message = payload.pointer("/choices/0/message");
    let assistant_text = message
        .and_then(|message| message.get("content"))
        .and_then(JsonValue::as_str)
        .unwrap_or_default()
        .to_string();
    let reasoning_content = message
        .and_then(|message| message.get("reasoning_content"))
        .and_then(JsonValue::as_str)
        .map(ToOwned::to_owned)
        .filter(|content| !content.trim().is_empty());
    let mut function_calls = Vec::new();

    if let Some(tool_calls) = message
        .and_then(|message| message.get("tool_calls"))
        .and_then(JsonValue::as_array)
    {
        for (index, call) in tool_calls.iter().enumerate() {
            let function = call.get("function").unwrap_or(&JsonValue::Null);
            let wire_name = function
                .get("name")
                .and_then(JsonValue::as_str)
                .unwrap_or("tool");
            let (namespace, name) = resolve_canonical_tool_name(mappings, wire_name);
            let call_id = call
                .get("id")
                .and_then(JsonValue::as_str)
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| format!("chat-tool-call-{}", index + 1));
            let input = function
                .get("arguments")
                .and_then(JsonValue::as_str)
                .map(parse_tool_input)
                .unwrap_or_else(|| json!({}));
            function_calls.push(ProviderFunctionCall {
                call_id,
                name,
                namespace,
                input,
            });
        }
    }

    let input_tokens = as_i64(payload.pointer("/usage/prompt_tokens"));
    let output_tokens = as_i64(payload.pointer("/usage/completion_tokens"));
    let total_tokens = as_i64(payload.pointer("/usage/total_tokens"));
    let token_usage = token_usage_from_provider_counts(input_tokens, output_tokens, total_tokens);
    let response_id = payload
        .get("id")
        .and_then(JsonValue::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "chat-completions-response".to_string());

    ProviderResponsePayload {
        assistant_text,
        reasoning_content,
        function_calls,
        token_usage,
        response_id,
    }
}

fn build_anthropic_messages(input: &[ResponseItem], mappings: &ToolMappings) -> Vec<JsonValue> {
    let mut messages = Vec::new();

    for item in input {
        match item {
            ResponseItem::Message { role, content, .. } if role == "system" => {}
            ResponseItem::Message { role, content, .. } if role == "user" => {
                let text = crate::content_items::content_items_to_text(content).unwrap_or_default();
                messages.push(json!({
                    "role": "user",
                    "content": [{
                        "type": "text",
                        "text": text,
                    }],
                }));
            }
            ResponseItem::Message { role, content, .. } if role == "assistant" => {
                let text = crate::content_items::content_items_to_text(content).unwrap_or_default();
                messages.push(json!({
                    "role": "assistant",
                    "content": [{
                        "type": "text",
                        "text": text,
                    }],
                }));
            }
            ResponseItem::FunctionCall {
                name,
                namespace,
                call_id,
                arguments,
                ..
            } => {
                let tool_name = resolve_wire_tool_name(mappings, name, namespace.as_deref());
                messages.push(json!({
                    "role": "assistant",
                    "content": [{
                        "type": "tool_use",
                        "id": call_id,
                        "name": tool_name,
                        "input": parse_tool_input(arguments),
                    }],
                }));
            }
            ResponseItem::CustomToolCall {
                call_id,
                name,
                input,
                ..
            } => {
                let tool_name = resolve_wire_tool_name(mappings, name, None);
                messages.push(json!({
                    "role": "assistant",
                    "content": [{
                        "type": "tool_use",
                        "id": call_id,
                        "name": tool_name,
                        "input": parse_tool_input(input),
                    }],
                }));
            }
            ResponseItem::FunctionCallOutput { call_id, output } => {
                messages.push(json!({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": call_id,
                        "content": [{
                            "type": "text",
                            "text": function_output_text(output),
                        }],
                    }],
                }));
            }
            ResponseItem::CustomToolCallOutput {
                call_id, output, ..
            } => {
                messages.push(json!({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": call_id,
                        "content": [{
                            "type": "text",
                            "text": function_output_text(output),
                        }],
                    }],
                }));
            }
            _ => {}
        }
    }

    messages
}

fn build_anthropic_tools(mappings: &ToolMappings) -> Vec<JsonValue> {
    mappings
        .descriptors
        .iter()
        .map(|descriptor| {
            json!({
                "name": descriptor.wire_name,
                "description": descriptor.description,
                "input_schema": descriptor.input_schema,
            })
        })
        .collect()
}

fn parse_anthropic_response_payload(
    payload: &JsonValue,
    mappings: &ToolMappings,
) -> ProviderResponsePayload {
    let mut assistant_text = String::new();
    let mut function_calls = Vec::new();

    if let Some(content_items) = payload.get("content").and_then(JsonValue::as_array) {
        for item in content_items {
            let item_type = item
                .get("type")
                .and_then(JsonValue::as_str)
                .unwrap_or_default();
            match item_type {
                "text" => {
                    if let Some(text) = item.get("text").and_then(JsonValue::as_str) {
                        if !assistant_text.is_empty() && !text.trim().is_empty() {
                            assistant_text.push('\n');
                        }
                        assistant_text.push_str(text);
                    }
                }
                "tool_use" => {
                    let call_id = item
                        .get("id")
                        .and_then(JsonValue::as_str)
                        .unwrap_or("anthropic_tool_call")
                        .to_string();
                    let wire_name = item
                        .get("name")
                        .and_then(JsonValue::as_str)
                        .unwrap_or("tool");
                    let (namespace, name) = resolve_canonical_tool_name(mappings, wire_name);
                    function_calls.push(ProviderFunctionCall {
                        call_id,
                        name,
                        namespace,
                        input: item.get("input").cloned().unwrap_or_else(|| json!({})),
                    });
                }
                _ => {}
            }
        }
    }

    let input_tokens = as_i64(payload.pointer("/usage/input_tokens"));
    let output_tokens = as_i64(payload.pointer("/usage/output_tokens"));
    let token_usage = token_usage_from_provider_counts(input_tokens, output_tokens, None);
    let response_id = payload
        .get("id")
        .and_then(JsonValue::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "anthropic-response".to_string());
    ProviderResponsePayload {
        assistant_text,
        reasoning_content: None,
        function_calls,
        token_usage,
        response_id,
    }
}

fn build_gemini_contents(input: &[ResponseItem], mappings: &ToolMappings) -> Vec<JsonValue> {
    let mut contents = Vec::new();
    let mut tool_name_by_call_id: HashMap<String, String> = HashMap::new();

    for item in input {
        match item {
            ResponseItem::Message { role, content, .. } if role == "system" => {}
            ResponseItem::Message { role, content, .. } if role == "user" => {
                let text = crate::content_items::content_items_to_text(content).unwrap_or_default();
                contents.push(json!({
                    "role": "user",
                    "parts": [{
                        "text": text,
                    }],
                }));
            }
            ResponseItem::Message { role, content, .. } if role == "assistant" => {
                let text = crate::content_items::content_items_to_text(content).unwrap_or_default();
                contents.push(json!({
                    "role": "model",
                    "parts": [{
                        "text": text,
                    }],
                }));
            }
            ResponseItem::FunctionCall {
                name,
                namespace,
                call_id,
                arguments,
                ..
            } => {
                let wire_name = resolve_wire_tool_name(mappings, name, namespace.as_deref());
                tool_name_by_call_id.insert(call_id.clone(), wire_name.clone());
                contents.push(json!({
                    "role": "model",
                    "parts": [{
                        "functionCall": {
                            "name": wire_name,
                            "args": parse_tool_input(arguments),
                            "id": call_id,
                        }
                    }],
                }));
            }
            ResponseItem::CustomToolCall {
                call_id,
                name,
                input,
                ..
            } => {
                let wire_name = resolve_wire_tool_name(mappings, name, None);
                tool_name_by_call_id.insert(call_id.clone(), wire_name.clone());
                contents.push(json!({
                    "role": "model",
                    "parts": [{
                        "functionCall": {
                            "name": wire_name,
                            "args": parse_tool_input(input),
                            "id": call_id,
                        }
                    }],
                }));
            }
            ResponseItem::FunctionCallOutput { call_id, output } => {
                let wire_name = tool_name_by_call_id
                    .get(call_id)
                    .cloned()
                    .unwrap_or_else(|| "tool".to_string());
                contents.push(json!({
                    "role": "user",
                    "parts": [{
                        "functionResponse": {
                            "name": wire_name,
                            "response": parse_tool_response_text(function_output_text(output).as_str()),
                        }
                    }],
                }));
            }
            ResponseItem::CustomToolCallOutput {
                call_id, output, ..
            } => {
                let wire_name = tool_name_by_call_id
                    .get(call_id)
                    .cloned()
                    .unwrap_or_else(|| "tool".to_string());
                contents.push(json!({
                    "role": "user",
                    "parts": [{
                        "functionResponse": {
                            "name": wire_name,
                            "response": parse_tool_response_text(function_output_text(output).as_str()),
                        }
                    }],
                }));
            }
            _ => {}
        }
    }

    contents
}

fn build_gemini_tools(mappings: &ToolMappings) -> JsonValue {
    if mappings.descriptors.is_empty() {
        return json!([]);
    }
    let declarations = mappings
        .descriptors
        .iter()
        .map(|descriptor| {
            json!({
                "name": descriptor.wire_name,
                "description": descriptor.description,
                "parameters": descriptor.input_schema,
            })
        })
        .collect::<Vec<_>>();
    json!([{
        "functionDeclarations": declarations,
    }])
}

fn parse_gemini_response_payload(
    payload: &JsonValue,
    mappings: &ToolMappings,
) -> ProviderResponsePayload {
    let mut assistant_text = String::new();
    let mut function_calls = Vec::new();

    if let Some(parts) = payload
        .pointer("/candidates/0/content/parts")
        .and_then(JsonValue::as_array)
    {
        for (index, part) in parts.iter().enumerate() {
            if let Some(text) = part.get("text").and_then(JsonValue::as_str) {
                if !assistant_text.is_empty() && !text.trim().is_empty() {
                    assistant_text.push('\n');
                }
                assistant_text.push_str(text);
            }

            if let Some(function_call) = part.get("functionCall").and_then(JsonValue::as_object) {
                let wire_name = function_call
                    .get("name")
                    .and_then(JsonValue::as_str)
                    .unwrap_or("tool");
                let (namespace, name) = resolve_canonical_tool_name(mappings, wire_name);
                let call_id = function_call
                    .get("id")
                    .and_then(JsonValue::as_str)
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| format!("gemini-tool-call-{}", index + 1));
                function_calls.push(ProviderFunctionCall {
                    call_id,
                    name,
                    namespace,
                    input: function_call
                        .get("args")
                        .cloned()
                        .unwrap_or_else(|| json!({})),
                });
            }
        }
    }

    let usage_metadata = payload.get("usageMetadata");
    let input_tokens = usage_metadata.and_then(|usage| as_i64(usage.get("promptTokenCount")));
    let output_tokens = usage_metadata.and_then(|usage| as_i64(usage.get("candidatesTokenCount")));
    let total_tokens = usage_metadata.and_then(|usage| as_i64(usage.get("totalTokenCount")));
    let token_usage = token_usage_from_provider_counts(input_tokens, output_tokens, total_tokens);
    let response_id = payload
        .pointer("/candidates/0/index")
        .and_then(JsonValue::as_i64)
        .map(|index| format!("gemini-response-{index}"))
        .unwrap_or_else(|| "gemini-response".to_string());
    ProviderResponsePayload {
        assistant_text,
        reasoning_content: None,
        function_calls,
        token_usage,
        response_id,
    }
}

impl ModelClient {
    #[allow(clippy::too_many_arguments)]
    /// Creates a new session-scoped `ModelClient`.
    ///
    /// All arguments are expected to be stable for the lifetime of a Lyra session. Per-turn values
    /// are passed to [`ModelClientSession::stream`] (and other turn-scoped methods) explicitly.
    pub fn new(
        auth_manager: Option<Arc<AuthManager>>,
        conversation_id: ThreadId,
        installation_id: String,
        provider_info: ModelProviderInfo,
        session_source: SessionSource,
        model_verbosity: Option<VerbosityConfig>,
        enable_request_compression: bool,
        include_timing_metrics: bool,
    ) -> Self {
        let model_provider = create_model_provider(provider_info, auth_manager);
        let lyra_api_key_env_enabled = model_provider
            .auth_manager()
            .as_ref()
            .is_some_and(|manager| manager.lyra_api_key_env_enabled());
        let auth_env_telemetry =
            collect_auth_env_telemetry(model_provider.info(), lyra_api_key_env_enabled);
        Self {
            state: Arc::new(ModelClientState {
                conversation_id,
                window_generation: AtomicU64::new(0),
                installation_id,
                provider: model_provider,
                auth_env_telemetry,
                session_source,
                model_verbosity,
                enable_request_compression,
                include_timing_metrics,
                disable_websockets: AtomicBool::new(false),
                cached_websocket_session: StdMutex::new(WebsocketSession::default()),
            }),
        }
    }

    /// Creates a fresh turn-scoped streaming session.
    ///
    /// This constructor does not perform network I/O itself; the session opens a websocket lazily
    /// when the first stream request is issued.
    pub fn new_session(&self) -> ModelClientSession {
        ModelClientSession {
            client: self.clone(),
            websocket_session: self.take_cached_websocket_session(),
            turn_state: Arc::new(OnceLock::new()),
        }
    }

    pub(crate) fn auth_manager(&self) -> Option<Arc<AuthManager>> {
        self.state.provider.auth_manager()
    }

    pub(crate) fn set_window_generation(&self, window_generation: u64) {
        self.state
            .window_generation
            .store(window_generation, Ordering::Relaxed);
        self.store_cached_websocket_session(WebsocketSession::default());
    }

    pub(crate) fn advance_window_generation(&self) {
        self.state.window_generation.fetch_add(1, Ordering::Relaxed);
        self.store_cached_websocket_session(WebsocketSession::default());
    }

    fn current_window_id(&self) -> String {
        let conversation_id = self.state.conversation_id;
        let window_generation = self.state.window_generation.load(Ordering::Relaxed);
        format!("{conversation_id}:{window_generation}")
    }

    fn take_cached_websocket_session(&self) -> WebsocketSession {
        let mut cached_websocket_session = self
            .state
            .cached_websocket_session
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        std::mem::take(&mut *cached_websocket_session)
    }

    fn store_cached_websocket_session(&self, websocket_session: WebsocketSession) {
        *self
            .state
            .cached_websocket_session
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = websocket_session;
    }

    pub(crate) fn force_http_fallback(
        &self,
        session_telemetry: &SessionTelemetry,
        _model_info: &ModelInfo,
    ) -> bool {
        let websocket_enabled = self.responses_websocket_enabled();
        let activated =
            websocket_enabled && !self.state.disable_websockets.swap(true, Ordering::Relaxed);
        if activated {
            warn!("falling back to HTTP");
            session_telemetry.counter(
                "lyra.transport.fallback_to_http",
                /*inc*/ 1,
                &[("from_wire_api", "responses_websocket")],
            );
        }

        self.store_cached_websocket_session(WebsocketSession::default());
        activated
    }

    /// Builds memory summaries for each provided normalized raw memory.
    ///
    /// This is a unary call (no streaming) to `/v1/memories/trace_summarize`.
    ///
    /// The model selection, reasoning effort, and telemetry context are passed explicitly to keep
    /// `ModelClient` session-scoped.
    pub async fn summarize_memories(
        &self,
        raw_memories: Vec<ApiRawMemory>,
        model_info: &ModelInfo,
        effort: Option<ReasoningEffortConfig>,
        session_telemetry: &SessionTelemetry,
    ) -> Result<Vec<ApiMemorySummarizeOutput>> {
        if raw_memories.is_empty() {
            return Ok(Vec::new());
        }

        let client_setup = self.current_client_setup().await?;
        let transport = ReqwestTransport::new(build_reqwest_client());
        let request_telemetry = Self::build_request_telemetry(
            session_telemetry,
            AuthRequestTelemetryContext::new(
                client_setup.auth.as_ref().map(LyraAuth::auth_mode),
                client_setup.api_auth.as_ref(),
                PendingUnauthorizedRetry::default(),
            ),
            RequestRouteTelemetry::for_endpoint(MEMORIES_SUMMARIZE_ENDPOINT),
            self.state.auth_env_telemetry.clone(),
        );
        let client =
            ApiMemoriesClient::new(transport, client_setup.api_provider, client_setup.api_auth)
                .with_telemetry(Some(request_telemetry));

        let payload = ApiMemorySummarizeInput {
            model: model_info.slug.clone(),
            raw_memories,
            reasoning: effort.map(|effort| Reasoning {
                effort: Some(effort),
                summary: None,
            }),
        };

        client
            .summarize_input(&payload, self.build_subagent_headers())
            .await
            .map_err(map_api_error)
    }

    fn build_subagent_headers(&self) -> ApiHeaderMap {
        let mut extra_headers = ApiHeaderMap::new();
        if let Some(subagent) = subagent_header_value(&self.state.session_source)
            && let Ok(val) = HeaderValue::from_str(&subagent)
        {
            extra_headers.insert(X_LYRA_SUBAGENT_HEADER, val);
        }
        extra_headers
    }

    fn build_responses_identity_headers(&self) -> ApiHeaderMap {
        let mut extra_headers = self.build_subagent_headers();
        if let Some(parent_thread_id) = parent_thread_id_header_value(&self.state.session_source)
            && let Ok(val) = HeaderValue::from_str(&parent_thread_id)
        {
            extra_headers.insert(X_LYRA_PARENT_THREAD_ID_HEADER, val);
        }
        if let Ok(val) = HeaderValue::from_str(&self.current_window_id()) {
            extra_headers.insert(X_LYRA_WINDOW_ID_HEADER, val);
        }
        extra_headers
    }

    fn build_ws_client_metadata(
        &self,
        turn_metadata_header: Option<&str>,
    ) -> HashMap<String, String> {
        let mut client_metadata = HashMap::new();
        client_metadata.insert(
            X_LYRA_INSTALLATION_ID_HEADER.to_string(),
            self.state.installation_id.clone(),
        );
        client_metadata.insert(
            X_LYRA_WINDOW_ID_HEADER.to_string(),
            self.current_window_id(),
        );
        if let Some(subagent) = subagent_header_value(&self.state.session_source) {
            client_metadata.insert(X_LYRA_SUBAGENT_HEADER.to_string(), subagent);
        }
        if let Some(parent_thread_id) = parent_thread_id_header_value(&self.state.session_source) {
            client_metadata.insert(X_LYRA_PARENT_THREAD_ID_HEADER.to_string(), parent_thread_id);
        }
        if let Some(turn_metadata_header) = parse_turn_metadata_header(turn_metadata_header)
            && let Ok(turn_metadata) = turn_metadata_header.to_str()
        {
            client_metadata.insert(
                X_LYRA_TURN_METADATA_HEADER.to_string(),
                turn_metadata.to_string(),
            );
        }
        client_metadata
    }

    /// Builds request telemetry for unary API calls.
    fn build_request_telemetry(
        session_telemetry: &SessionTelemetry,
        auth_context: AuthRequestTelemetryContext,
        request_route_telemetry: RequestRouteTelemetry,
        auth_env_telemetry: AuthEnvTelemetry,
    ) -> Arc<dyn RequestTelemetry> {
        let telemetry = Arc::new(ApiTelemetry::new(
            session_telemetry.clone(),
            auth_context,
            request_route_telemetry,
            auth_env_telemetry,
        ));
        let request_telemetry: Arc<dyn RequestTelemetry> = telemetry;
        request_telemetry
    }

    fn build_reasoning(
        model_info: &ModelInfo,
        effort: Option<ReasoningEffortConfig>,
        summary: ReasoningSummaryConfig,
    ) -> Option<Reasoning> {
        if model_info.supports_reasoning_summaries {
            Some(Reasoning {
                effort: effort.or(model_info.default_reasoning_level),
                summary: if summary == ReasoningSummaryConfig::None {
                    None
                } else {
                    Some(summary)
                },
            })
        } else {
            None
        }
    }

    /// Returns whether the Responses-over-WebSocket transport is active for this session.
    ///
    /// WebSocket use is controlled by provider capability and session-scoped fallback state.
    pub fn responses_websocket_enabled(&self) -> bool {
        if !self.state.provider.info().supports_websockets
            || self.state.disable_websockets.load(Ordering::Relaxed)
            || (*LYRA_RS_SSE_FIXTURE).is_some()
        {
            return false;
        }

        true
    }

    /// Returns auth + provider configuration resolved from the current session auth state.
    ///
    /// This centralizes setup used by both prewarm and normal request paths so they stay in
    /// lockstep when auth/provider resolution changes.
    async fn current_client_setup(&self) -> Result<CurrentClientSetup> {
        let auth = self.state.provider.auth().await;
        let api_provider = self.state.provider.api_provider().await?;
        let api_auth = self.state.provider.api_auth().await?;
        Ok(CurrentClientSetup {
            auth,
            api_provider,
            api_auth,
        })
    }

    /// Opens a websocket connection using the same header and telemetry wiring as normal turns.
    ///
    /// Both startup prewarm and in-turn `needs_new` reconnects call this path so handshake
    /// behavior remains consistent across both flows.
    #[allow(clippy::too_many_arguments)]
    async fn connect_websocket(
        &self,
        session_telemetry: &SessionTelemetry,
        api_provider: lyra_api::Provider,
        api_auth: SharedAuthProvider,
        turn_state: Option<Arc<OnceLock<String>>>,
        turn_metadata_header: Option<&str>,
        auth_context: AuthRequestTelemetryContext,
        request_route_telemetry: RequestRouteTelemetry,
    ) -> std::result::Result<ApiWebSocketConnection, ApiError> {
        let headers = self.build_websocket_headers(turn_state.as_ref(), turn_metadata_header);
        let websocket_telemetry = ModelClientSession::build_websocket_telemetry(
            session_telemetry,
            auth_context,
            request_route_telemetry,
            self.state.auth_env_telemetry.clone(),
        );
        let websocket_connect_timeout = self.state.provider.info().websocket_connect_timeout();
        let start = Instant::now();
        let result = match tokio::time::timeout(
            websocket_connect_timeout,
            ApiWebSocketResponsesClient::new(api_provider, api_auth).connect(
                headers,
                lyra_login::default_client::default_headers(),
                turn_state,
                Some(websocket_telemetry),
            ),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => Err(ApiError::Transport(TransportError::Timeout)),
        };
        let error_message = result.as_ref().err().map(telemetry_api_error_message);
        let response_debug = result
            .as_ref()
            .err()
            .map(extract_response_debug_context_from_api_error)
            .unwrap_or_default();
        let status = result.as_ref().err().and_then(api_error_http_status);
        session_telemetry.record_websocket_connect(
            start.elapsed(),
            status,
            error_message.as_deref(),
            auth_context.auth_header_attached,
            auth_context.auth_header_name,
            auth_context.retry_after_unauthorized,
            auth_context.recovery_mode,
            auth_context.recovery_phase,
            request_route_telemetry.endpoint,
            /*connection_reused*/ false,
            response_debug.request_id.as_deref(),
            response_debug.cf_ray.as_deref(),
            response_debug.auth_error.as_deref(),
            response_debug.auth_error_code.as_deref(),
        );
        result
    }

    /// Builds websocket handshake headers for both prewarm and turn-time reconnect.
    ///
    /// Callers should pass the current turn-state lock when available so sticky-routing state is
    /// replayed on reconnect within the same turn.
    fn build_websocket_headers(
        &self,
        turn_state: Option<&Arc<OnceLock<String>>>,
        turn_metadata_header: Option<&str>,
    ) -> ApiHeaderMap {
        let turn_metadata_header = parse_turn_metadata_header(turn_metadata_header);
        let conversation_id = self.state.conversation_id.to_string();
        let mut headers = build_responses_headers(turn_state, turn_metadata_header.as_ref());
        if let Ok(header_value) = HeaderValue::from_str(&conversation_id) {
            headers.insert("x-client-request-id", header_value);
        }
        headers.extend(build_conversation_headers(Some(conversation_id)));
        headers.extend(self.build_responses_identity_headers());
        headers.insert(
            RESPONSES_PROVIDER_COMPAT_HEADER_NAME,
            HeaderValue::from_static(RESPONSES_WEBSOCKETS_V2_BETA_HEADER_VALUE),
        );
        if self.state.include_timing_metrics {
            headers.insert(
                X_RESPONSESAPI_INCLUDE_TIMING_METRICS_HEADER,
                HeaderValue::from_static("true"),
            );
        }
        headers
    }
}

impl Drop for ModelClientSession {
    fn drop(&mut self) {
        let websocket_session = std::mem::take(&mut self.websocket_session);
        self.client
            .store_cached_websocket_session(websocket_session);
    }
}

impl ModelClientSession {
    pub(crate) fn reset_websocket_session(&mut self) {
        self.websocket_session.connection = None;
        self.websocket_session.last_request = None;
        self.websocket_session.last_response_rx = None;
        self.websocket_session
            .set_connection_reused(/*connection_reused*/ false);
    }

    fn build_responses_request(
        &self,
        provider: &lyra_api::Provider,
        prompt: &Prompt,
        model_info: &ModelInfo,
        effort: Option<ReasoningEffortConfig>,
        summary: ReasoningSummaryConfig,
        model_verbosity: Option<VerbosityConfig>,
        service_tier: Option<ServiceTier>,
    ) -> Result<ResponsesApiRequest> {
        let instructions = &prompt.base_instructions.text;
        let input = prompt.get_formatted_input();
        let tools = create_tools_json_for_responses_api(&prompt.tools)?;
        let default_reasoning_effort = model_info.default_reasoning_level;
        let reasoning = if model_info.supports_reasoning_summaries {
            Some(Reasoning {
                effort: effort.or(default_reasoning_effort),
                summary: if summary == ReasoningSummaryConfig::None {
                    None
                } else {
                    Some(summary)
                },
            })
        } else {
            None
        };
        let include = if reasoning.is_some() {
            vec!["reasoning.encrypted_content".to_string()]
        } else {
            Vec::new()
        };
        let verbosity = if model_info.support_verbosity {
            model_verbosity
                .or(self.client.state.model_verbosity)
                .or(model_info.default_verbosity)
        } else {
            if model_verbosity
                .or(self.client.state.model_verbosity)
                .is_some()
            {
                warn!(
                    "model_verbosity is set but ignored as the model does not support verbosity: {}",
                    model_info.slug
                );
            }
            None
        };
        let text = create_text_param_for_request(verbosity, &prompt.output_schema);
        let prompt_cache_key = Some(self.client.state.conversation_id.to_string());
        let request = ResponsesApiRequest {
            model: model_info.slug.clone(),
            instructions: instructions.clone(),
            input,
            tools,
            tool_choice: "auto".to_string(),
            parallel_tool_calls: prompt.parallel_tool_calls,
            reasoning,
            store: provider.is_azure_responses_endpoint(),
            stream: true,
            include,
            service_tier: service_tier.map(|service_tier| service_tier.to_string()),
            prompt_cache_key,
            text,
            client_metadata: Some(HashMap::from([(
                X_LYRA_INSTALLATION_ID_HEADER.to_string(),
                self.client.state.installation_id.clone(),
            )])),
        };
        Ok(request)
    }

    #[allow(clippy::too_many_arguments)]
    /// Builds shared Responses API transport options and request-body options.
    ///
    /// Keeping option construction in one place ensures request-scoped headers are consistent
    /// regardless of transport choice.
    fn build_responses_options(
        &self,
        turn_metadata_header: Option<&str>,
        compression: Compression,
    ) -> ApiResponsesOptions {
        let turn_metadata_header = parse_turn_metadata_header(turn_metadata_header);
        let conversation_id = self.client.state.conversation_id.to_string();
        ApiResponsesOptions {
            conversation_id: Some(conversation_id),
            session_source: Some(self.client.state.session_source.clone()),
            extra_headers: {
                let mut headers =
                    build_responses_headers(Some(&self.turn_state), turn_metadata_header.as_ref());
                headers.extend(self.client.build_responses_identity_headers());
                headers
            },
            compression,
            turn_state: Some(Arc::clone(&self.turn_state)),
        }
    }

    fn get_incremental_items(
        &self,
        request: &ResponsesApiRequest,
        last_response: Option<&LastResponse>,
        allow_empty_delta: bool,
    ) -> Option<Vec<ResponseItem>> {
        // Checks whether the current request is an incremental extension of the previous request.
        // We only reuse an incremental input delta when non-input request fields are unchanged and
        // `input` is a strict
        // extension of the previous known input. Server-returned output items are treated as part
        // of the baseline so we do not resend them.
        let previous_request = self.websocket_session.last_request.as_ref()?;
        let mut previous_without_input = previous_request.clone();
        previous_without_input.input.clear();
        let mut request_without_input = request.clone();
        request_without_input.input.clear();
        if previous_without_input != request_without_input {
            trace!(
                "incremental request failed, properties didn't match {previous_without_input:?} != {request_without_input:?}"
            );
            return None;
        }

        let mut baseline = previous_request.input.clone();
        if let Some(last_response) = last_response {
            baseline.extend(last_response.items_added.clone());
        }

        let baseline_len = baseline.len();
        if request.input.starts_with(&baseline)
            && (allow_empty_delta || baseline_len < request.input.len())
        {
            Some(request.input[baseline_len..].to_vec())
        } else {
            trace!("incremental request failed, items didn't match");
            None
        }
    }

    fn get_last_response(&mut self) -> Option<LastResponse> {
        self.websocket_session
            .last_response_rx
            .take()
            .and_then(|mut receiver| match receiver.try_recv() {
                Ok(last_response) => Some(last_response),
                Err(TryRecvError::Closed) | Err(TryRecvError::Empty) => None,
            })
    }

    fn prepare_websocket_request(
        &mut self,
        payload: ResponseCreateWsRequest,
        request: &ResponsesApiRequest,
    ) -> ResponsesWsRequest {
        let Some(last_response) = self.get_last_response() else {
            return ResponsesWsRequest::ResponseCreate(payload);
        };
        let Some(incremental_items) = self.get_incremental_items(
            request,
            Some(&last_response),
            /*allow_empty_delta*/ true,
        ) else {
            return ResponsesWsRequest::ResponseCreate(payload);
        };

        if last_response.response_id.is_empty() {
            trace!("incremental request failed, no previous response id");
            return ResponsesWsRequest::ResponseCreate(payload);
        }

        ResponsesWsRequest::ResponseCreate(ResponseCreateWsRequest {
            previous_response_id: Some(last_response.response_id),
            input: incremental_items,
            ..payload
        })
    }

    /// Opportunistically preconnects a websocket for this turn-scoped client session.
    ///
    /// This performs only connection setup; it never sends prompt payloads.
    pub async fn preconnect_websocket(
        &mut self,
        session_telemetry: &SessionTelemetry,
        _model_info: &ModelInfo,
    ) -> std::result::Result<(), ApiError> {
        if !self.client.responses_websocket_enabled() {
            return Ok(());
        }
        if self.websocket_session.connection.is_some() {
            return Ok(());
        }

        let client_setup = self.client.current_client_setup().await.map_err(|err| {
            ApiError::Stream(format!(
                "failed to build websocket prewarm client setup: {err}"
            ))
        })?;
        let auth_context = AuthRequestTelemetryContext::new(
            client_setup.auth.as_ref().map(LyraAuth::auth_mode),
            client_setup.api_auth.as_ref(),
            PendingUnauthorizedRetry::default(),
        );
        let connection = self
            .client
            .connect_websocket(
                session_telemetry,
                client_setup.api_provider,
                client_setup.api_auth,
                Some(Arc::clone(&self.turn_state)),
                /*turn_metadata_header*/ None,
                auth_context,
                RequestRouteTelemetry::for_endpoint(RESPONSES_ENDPOINT),
            )
            .await?;
        self.websocket_session.connection = Some(connection);
        self.websocket_session
            .set_connection_reused(/*connection_reused*/ false);
        Ok(())
    }
    /// Returns a websocket connection for this turn.
    #[instrument(
        name = "model_client.websocket_connection",
        level = "info",
        skip_all,
        fields(
            provider = %self.client.state.provider.info().name,
            wire_api = %self.client.state.provider.info().wire_api,
            transport = "responses_websocket",
            api.path = "responses",
            turn.has_metadata_header = params.turn_metadata_header.is_some()
        )
    )]
    async fn websocket_connection(
        &mut self,
        params: WebsocketConnectParams<'_>,
    ) -> std::result::Result<&ApiWebSocketConnection, ApiError> {
        let WebsocketConnectParams {
            session_telemetry,
            api_provider,
            api_auth,
            turn_metadata_header,
            options,
            auth_context,
            request_route_telemetry,
        } = params;
        let needs_new = match self.websocket_session.connection.as_ref() {
            Some(conn) => conn.is_closed().await,
            None => true,
        };

        if needs_new {
            self.websocket_session.last_request = None;
            self.websocket_session.last_response_rx = None;
            let turn_state = options
                .turn_state
                .clone()
                .unwrap_or_else(|| Arc::clone(&self.turn_state));
            let new_conn = match self
                .client
                .connect_websocket(
                    session_telemetry,
                    api_provider,
                    api_auth,
                    Some(turn_state),
                    turn_metadata_header,
                    auth_context,
                    request_route_telemetry,
                )
                .await
            {
                Ok(new_conn) => new_conn,
                Err(err) => {
                    if matches!(err, ApiError::Transport(TransportError::Timeout)) {
                        self.reset_websocket_session();
                    }
                    return Err(err);
                }
            };
            self.websocket_session.connection = Some(new_conn);
            self.websocket_session
                .set_connection_reused(/*connection_reused*/ false);
        } else {
            self.websocket_session
                .set_connection_reused(/*connection_reused*/ true);
        }

        self.websocket_session
            .connection
            .as_ref()
            .ok_or(ApiError::Stream(
                "websocket connection is unavailable".to_string(),
            ))
    }

    fn responses_request_compression(&self, auth: Option<&LyraAuth>) -> Compression {
        let _ = auth;
        Compression::None
    }

    /// Streams a turn via the OpenAI Responses API.
    ///
    /// Handles SSE fixtures, reasoning summaries, verbosity, and the
    /// `text` controls used for output schemas.
    #[allow(clippy::too_many_arguments)]
    #[instrument(
        name = "model_client.stream_responses_api",
        level = "info",
        skip_all,
        fields(
            model = %model_info.slug,
            wire_api = %self.client.state.provider.info().wire_api,
            transport = "responses_http",
            http.method = "POST",
            api.path = "responses",
            turn.has_metadata_header = turn_metadata_header.is_some()
        )
    )]
    async fn stream_responses_api(
        &self,
        prompt: &Prompt,
        model_info: &ModelInfo,
        session_telemetry: &SessionTelemetry,
        effort: Option<ReasoningEffortConfig>,
        summary: ReasoningSummaryConfig,
        model_verbosity: Option<VerbosityConfig>,
        service_tier: Option<ServiceTier>,
        turn_metadata_header: Option<&str>,
        inference_trace: &InferenceTraceContext,
    ) -> Result<ResponseStream> {
        if let Some(path) = &*LYRA_RS_SSE_FIXTURE {
            warn!(path, "Streaming from fixture");
            let stream = lyra_api::stream_from_fixture(
                path,
                self.client.state.provider.info().stream_idle_timeout(),
            )
            .map_err(map_api_error)?;
            let (stream, _last_request_rx) = map_response_stream(
                stream,
                session_telemetry.clone(),
                InferenceTraceAttempt::disabled(),
            );
            return Ok(stream);
        }

        let auth_manager = self.client.state.provider.auth_manager();
        let mut auth_recovery = auth_manager
            .as_ref()
            .map(AuthManager::unauthorized_recovery);
        let mut pending_retry = PendingUnauthorizedRetry::default();
        loop {
            let client_setup = self.client.current_client_setup().await?;
            let transport = ReqwestTransport::new(build_reqwest_client());
            let request_auth_context = AuthRequestTelemetryContext::new(
                client_setup.auth.as_ref().map(LyraAuth::auth_mode),
                client_setup.api_auth.as_ref(),
                pending_retry,
            );
            let (request_telemetry, sse_telemetry) = Self::build_streaming_telemetry(
                session_telemetry,
                request_auth_context,
                RequestRouteTelemetry::for_endpoint(RESPONSES_ENDPOINT),
                self.client.state.auth_env_telemetry.clone(),
            );
            let compression = self.responses_request_compression(client_setup.auth.as_ref());
            let options = self.build_responses_options(turn_metadata_header, compression);

            let request = self.build_responses_request(
                &client_setup.api_provider,
                prompt,
                model_info,
                effort,
                summary,
                model_verbosity,
                service_tier,
            )?;
            let inference_trace_attempt = inference_trace.start_attempt();
            inference_trace_attempt.record_started(&request);
            let client = ApiResponsesClient::new(
                transport,
                client_setup.api_provider,
                client_setup.api_auth,
            )
            .with_telemetry(Some(request_telemetry), Some(sse_telemetry));
            let stream_result = client.stream_request(request, options).await;

            match stream_result {
                Ok(stream) => {
                    let (stream, _) = map_response_stream(
                        stream,
                        session_telemetry.clone(),
                        inference_trace_attempt,
                    );
                    return Ok(stream);
                }
                Err(ApiError::Transport(
                    unauthorized_transport @ TransportError::Http { status, .. },
                )) if status == StatusCode::UNAUTHORIZED => {
                    inference_trace_attempt.record_failed(&unauthorized_transport);
                    pending_retry = PendingUnauthorizedRetry::from_recovery(
                        handle_unauthorized(
                            unauthorized_transport,
                            &mut auth_recovery,
                            session_telemetry,
                        )
                        .await?,
                    );
                    continue;
                }
                Err(err) => {
                    let mapped = map_api_error(err);
                    inference_trace_attempt.record_failed(&mapped);
                    return Err(mapped);
                }
            }
        }
    }

    /// Streams a turn via the Responses API over WebSocket transport.
    #[allow(clippy::too_many_arguments)]
    #[instrument(
        name = "model_client.stream_responses_websocket",
        level = "info",
        skip_all,
        fields(
            model = %model_info.slug,
            wire_api = %self.client.state.provider.info().wire_api,
            transport = "responses_websocket",
            api.path = "responses",
            turn.has_metadata_header = turn_metadata_header.is_some(),
            websocket.warmup = warmup
        )
    )]
    async fn stream_responses_websocket(
        &mut self,
        prompt: &Prompt,
        model_info: &ModelInfo,
        session_telemetry: &SessionTelemetry,
        effort: Option<ReasoningEffortConfig>,
        summary: ReasoningSummaryConfig,
        model_verbosity: Option<VerbosityConfig>,
        service_tier: Option<ServiceTier>,
        turn_metadata_header: Option<&str>,
        warmup: bool,
        request_trace: Option<W3cTraceContext>,
        inference_trace: &InferenceTraceContext,
    ) -> Result<WebsocketStreamOutcome> {
        let auth_manager = self.client.state.provider.auth_manager();

        let mut auth_recovery = auth_manager
            .as_ref()
            .map(AuthManager::unauthorized_recovery);
        let mut pending_retry = PendingUnauthorizedRetry::default();
        loop {
            let client_setup = self.client.current_client_setup().await?;
            let request_auth_context = AuthRequestTelemetryContext::new(
                client_setup.auth.as_ref().map(LyraAuth::auth_mode),
                client_setup.api_auth.as_ref(),
                pending_retry,
            );
            let compression = self.responses_request_compression(client_setup.auth.as_ref());

            let options = self.build_responses_options(turn_metadata_header, compression);
            let request = self.build_responses_request(
                &client_setup.api_provider,
                prompt,
                model_info,
                effort,
                summary,
                model_verbosity,
                service_tier,
            )?;
            let mut ws_payload = ResponseCreateWsRequest {
                client_metadata: response_create_client_metadata(
                    Some(self.client.build_ws_client_metadata(turn_metadata_header)),
                    request_trace.as_ref(),
                ),
                ..ResponseCreateWsRequest::from(&request)
            };
            if warmup {
                ws_payload.generate = Some(false);
            }

            match self
                .websocket_connection(WebsocketConnectParams {
                    session_telemetry,
                    api_provider: client_setup.api_provider,
                    api_auth: client_setup.api_auth,
                    turn_metadata_header,
                    options: &options,
                    auth_context: request_auth_context,
                    request_route_telemetry: RequestRouteTelemetry::for_endpoint(
                        RESPONSES_ENDPOINT,
                    ),
                })
                .await
            {
                Ok(_) => {}
                Err(ApiError::Transport(TransportError::Http { status, .. }))
                    if status == StatusCode::UPGRADE_REQUIRED =>
                {
                    return Ok(WebsocketStreamOutcome::FallbackToHttp);
                }
                Err(ApiError::Transport(
                    unauthorized_transport @ TransportError::Http { status, .. },
                )) if status == StatusCode::UNAUTHORIZED => {
                    pending_retry = PendingUnauthorizedRetry::from_recovery(
                        handle_unauthorized(
                            unauthorized_transport,
                            &mut auth_recovery,
                            session_telemetry,
                        )
                        .await?,
                    );
                    continue;
                }
                Err(err) => return Err(map_api_error(err)),
            }

            let ws_request = self.prepare_websocket_request(ws_payload, &request);
            self.websocket_session.last_request = Some(request);
            let inference_trace_attempt = if warmup {
                InferenceTraceAttempt::disabled()
            } else {
                inference_trace.start_attempt()
            };
            inference_trace_attempt.record_started(&ws_request);
            let stream_result = self.websocket_session.connection.as_ref().ok_or_else(|| {
                map_api_error(ApiError::Stream(
                    "websocket connection is unavailable".to_string(),
                ))
            })?;
            let stream_result = stream_result
                .stream_request(ws_request, self.websocket_session.connection_reused())
                .await
                .map_err(|err| {
                    let mapped = map_api_error(err);
                    inference_trace_attempt.record_failed(&mapped);
                    mapped
                })?;
            let (stream, last_request_rx) = map_response_stream(
                stream_result,
                session_telemetry.clone(),
                inference_trace_attempt,
            );
            self.websocket_session.last_response_rx = Some(last_request_rx);
            return Ok(WebsocketStreamOutcome::Stream(stream));
        }
    }

    /// Builds request and SSE telemetry for streaming API calls.
    fn build_streaming_telemetry(
        session_telemetry: &SessionTelemetry,
        auth_context: AuthRequestTelemetryContext,
        request_route_telemetry: RequestRouteTelemetry,
        auth_env_telemetry: AuthEnvTelemetry,
    ) -> (Arc<dyn RequestTelemetry>, Arc<dyn SseTelemetry>) {
        let telemetry = Arc::new(ApiTelemetry::new(
            session_telemetry.clone(),
            auth_context,
            request_route_telemetry,
            auth_env_telemetry,
        ));
        let request_telemetry: Arc<dyn RequestTelemetry> = telemetry.clone();
        let sse_telemetry: Arc<dyn SseTelemetry> = telemetry;
        (request_telemetry, sse_telemetry)
    }

    /// Builds telemetry for the Responses API WebSocket transport.
    fn build_websocket_telemetry(
        session_telemetry: &SessionTelemetry,
        auth_context: AuthRequestTelemetryContext,
        request_route_telemetry: RequestRouteTelemetry,
        auth_env_telemetry: AuthEnvTelemetry,
    ) -> Arc<dyn WebsocketTelemetry> {
        let telemetry = Arc::new(ApiTelemetry::new(
            session_telemetry.clone(),
            auth_context,
            request_route_telemetry,
            auth_env_telemetry,
        ));
        let websocket_telemetry: Arc<dyn WebsocketTelemetry> = telemetry;
        websocket_telemetry
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn prewarm_websocket(
        &mut self,
        prompt: &Prompt,
        model_info: &ModelInfo,
        session_telemetry: &SessionTelemetry,
        effort: Option<ReasoningEffortConfig>,
        summary: ReasoningSummaryConfig,
        model_verbosity: Option<VerbosityConfig>,
        service_tier: Option<ServiceTier>,
        turn_metadata_header: Option<&str>,
    ) -> Result<()> {
        if !self.client.responses_websocket_enabled() {
            return Ok(());
        }
        if self.websocket_session.last_request.is_some() {
            return Ok(());
        }

        match self
            .stream_responses_websocket(
                prompt,
                model_info,
                session_telemetry,
                effort,
                summary,
                model_verbosity,
                service_tier,
                turn_metadata_header,
                /*warmup*/ true,
                current_span_w3c_trace_context(),
                &InferenceTraceContext::disabled(),
            )
            .await
        {
            Ok(WebsocketStreamOutcome::Stream(mut stream)) => {
                // Wait for the v2 warmup request to complete before sending the first turn request.
                while let Some(event) = stream.next().await {
                    match event {
                        Ok(ResponseEvent::Completed { .. }) => break,
                        Err(err) => return Err(err),
                        _ => {}
                    }
                }
                Ok(())
            }
            Ok(WebsocketStreamOutcome::FallbackToHttp) => {
                self.try_switch_fallback_transport(session_telemetry, model_info);
                Ok(())
            }
            Err(err) => Err(err),
        }
    }

    #[allow(clippy::too_many_arguments)]
    /// Streams a single model request within the current turn.
    ///
    /// The caller is responsible for passing per-turn settings explicitly (model selection,
    /// reasoning settings, telemetry context, and turn metadata). This method will prefer the
    /// Responses WebSocket transport when the provider supports it and it remains healthy, and will
    /// fall back to the HTTP Responses API transport otherwise.
    pub async fn stream(
        &mut self,
        prompt: &Prompt,
        model_info: &ModelInfo,
        session_telemetry: &SessionTelemetry,
        effort: Option<ReasoningEffortConfig>,
        summary: ReasoningSummaryConfig,
        model_verbosity: Option<VerbosityConfig>,
        service_tier: Option<ServiceTier>,
        turn_metadata_header: Option<&str>,
        inference_trace: &InferenceTraceContext,
    ) -> Result<ResponseStream> {
        let wire_api = self.client.state.provider.info().wire_api;
        match wire_api {
            WireApi::Responses => {
                if self.client.responses_websocket_enabled() {
                    let request_trace = current_span_w3c_trace_context();
                    match self
                        .stream_responses_websocket(
                            prompt,
                            model_info,
                            session_telemetry,
                            effort,
                            summary,
                            model_verbosity,
                            service_tier,
                            turn_metadata_header,
                            /*warmup*/ false,
                            request_trace,
                            inference_trace,
                        )
                        .await?
                    {
                        WebsocketStreamOutcome::Stream(stream) => return Ok(stream),
                        WebsocketStreamOutcome::FallbackToHttp => {
                            self.try_switch_fallback_transport(session_telemetry, model_info);
                        }
                    }
                }

                self.stream_responses_api(
                    prompt,
                    model_info,
                    session_telemetry,
                    effort,
                    summary,
                    model_verbosity,
                    service_tier,
                    turn_metadata_header,
                    inference_trace,
                )
                .await
            }
            WireApi::ChatCompletions => {
                self.stream_chat_completions(
                    prompt,
                    model_info,
                    session_telemetry,
                    effort,
                    summary,
                    service_tier,
                    turn_metadata_header,
                )
                .await
            }
            WireApi::AnthropicMessages => {
                self.stream_anthropic_messages(
                    prompt,
                    model_info,
                    session_telemetry,
                    effort,
                    summary,
                    service_tier,
                    turn_metadata_header,
                )
                .await
            }
            WireApi::GeminiGenerateContent => {
                self.stream_gemini_generate_content(
                    prompt,
                    model_info,
                    session_telemetry,
                    effort,
                    summary,
                    service_tier,
                    turn_metadata_header,
                )
                .await
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn stream_chat_completions(
        &self,
        prompt: &Prompt,
        model_info: &ModelInfo,
        _session_telemetry: &SessionTelemetry,
        _effort: Option<ReasoningEffortConfig>,
        _summary: ReasoningSummaryConfig,
        _service_tier: Option<ServiceTier>,
        _turn_metadata_header: Option<&str>,
    ) -> Result<ResponseStream> {
        let client_setup = self.client.current_client_setup().await?;
        let provider = client_setup.api_provider;
        let base_url = provider.base_url.trim();
        if base_url.is_empty() {
            return Err(stream_error("Chat Completions base URL is not configured"));
        }

        let input = prompt.get_formatted_input();
        let tool_mappings = build_tool_mappings(&prompt.tools);
        let mut messages = Vec::new();
        if let Some(system) = build_system_prompt(&prompt.base_instructions.text, &input) {
            messages.push(json!({
                "role": "system",
                "content": system,
            }));
        }
        messages.extend(build_chat_messages(&input));

        let mut payload = json!({
            "model": model_info.slug,
            "messages": messages,
            "stream": false,
        });
        let tools = build_chat_tools(&tool_mappings);
        if !tools.is_empty()
            && let Some(object) = payload.as_object_mut()
        {
            object.insert("tools".to_string(), JsonValue::Array(tools));
            object.insert(
                "tool_choice".to_string(),
                JsonValue::String("auto".to_string()),
            );
        }

        let mut headers = reqwest_headers_from_api_provider(&provider);
        client_setup.api_auth.add_auth_headers(&mut headers);
        headers.insert(
            reqwest::header::CONTENT_TYPE,
            reqwest::header::HeaderValue::from_static("application/json"),
        );

        let client = reqwest::Client::builder()
            .timeout(self.client.state.provider.info().stream_idle_timeout())
            .build()
            .map_err(|error| {
                stream_error(format!(
                    "failed to construct Chat Completions client: {error}"
                ))
            })?;

        let mut request = client
            .post(chat_completions_endpoint(&provider.base_url))
            .headers(headers)
            .json(&payload);
        if let Some(query_params) = provider.query_params.as_ref() {
            request = request.query(query_params);
        }

        let response = request
            .send()
            .await
            .map_err(|error| stream_error(format!("Chat Completions request failed: {error}")))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(stream_error(format!(
                "Chat Completions request failed ({status}): {body}"
            )));
        }

        let payload = response.json::<JsonValue>().await.map_err(|error| {
            stream_error(format!(
                "failed to parse Chat Completions response: {error}"
            ))
        })?;
        let mapped = parse_chat_completions_payload(&payload, &tool_mappings);
        Ok(response_stream_from_provider_payload(mapped))
    }

    #[allow(clippy::too_many_arguments)]
    async fn stream_anthropic_messages(
        &self,
        prompt: &Prompt,
        model_info: &ModelInfo,
        _session_telemetry: &SessionTelemetry,
        _effort: Option<ReasoningEffortConfig>,
        _summary: ReasoningSummaryConfig,
        _service_tier: Option<ServiceTier>,
        _turn_metadata_header: Option<&str>,
    ) -> Result<ResponseStream> {
        let provider = self.client.state.provider.api_provider().await?;
        let base_url = provider.base_url.trim();
        if base_url.is_empty() {
            return Err(stream_error("Anthropic base URL is not configured"));
        }

        let api_key = self
            .client
            .state
            .provider
            .info()
            .api_key()?
            .ok_or_else(|| stream_error("Anthropic API key is missing"))?;

        let input = prompt.get_formatted_input();
        let tool_mappings = build_tool_mappings(&prompt.tools);
        let mut payload = json!({
            "model": model_info.slug,
            "max_tokens": DEFAULT_ANTHROPIC_MAX_TOKENS,
            "messages": build_anthropic_messages(&input, &tool_mappings),
            "stream": false,
            "tools": build_anthropic_tools(&tool_mappings),
        });

        if let Some(system) = build_system_prompt(&prompt.base_instructions.text, &input)
            && let Some(object) = payload.as_object_mut()
        {
            object.insert("system".to_string(), JsonValue::String(system));
        }

        let mut headers = reqwest_headers_from_api_provider(&provider);
        headers.insert(
            reqwest::header::HeaderName::from_static("x-api-key"),
            reqwest::header::HeaderValue::from_str(&api_key).map_err(|error| {
                stream_error(format!("invalid Anthropic API key header: {error}"))
            })?,
        );
        if !headers.contains_key("anthropic-version") {
            headers.insert(
                reqwest::header::HeaderName::from_static("anthropic-version"),
                reqwest::header::HeaderValue::from_static(DEFAULT_ANTHROPIC_VERSION),
            );
        }
        headers.insert(
            reqwest::header::CONTENT_TYPE,
            reqwest::header::HeaderValue::from_static("application/json"),
        );

        let client = reqwest::Client::builder()
            .timeout(self.client.state.provider.info().stream_idle_timeout())
            .build()
            .map_err(|error| {
                stream_error(format!("failed to construct Anthropic client: {error}"))
            })?;

        let mut request = client
            .post(anthropic_messages_endpoint(&provider.base_url))
            .headers(headers)
            .json(&payload);
        if let Some(query_params) = provider.query_params.as_ref() {
            request = request.query(query_params);
        }

        let response = request
            .send()
            .await
            .map_err(|error| stream_error(format!("Anthropic request failed: {error}")))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(stream_error(format!(
                "Anthropic request failed ({status}): {body}"
            )));
        }

        let payload = response.json::<JsonValue>().await.map_err(|error| {
            stream_error(format!("failed to parse Anthropic response: {error}"))
        })?;
        let mapped = parse_anthropic_response_payload(&payload, &tool_mappings);
        Ok(response_stream_from_provider_payload(mapped))
    }

    #[allow(clippy::too_many_arguments)]
    async fn stream_gemini_generate_content(
        &self,
        prompt: &Prompt,
        model_info: &ModelInfo,
        _session_telemetry: &SessionTelemetry,
        _effort: Option<ReasoningEffortConfig>,
        _summary: ReasoningSummaryConfig,
        _service_tier: Option<ServiceTier>,
        _turn_metadata_header: Option<&str>,
    ) -> Result<ResponseStream> {
        let provider = self.client.state.provider.api_provider().await?;
        let base_url = provider.base_url.trim();
        if base_url.is_empty() {
            return Err(stream_error("Gemini base URL is not configured"));
        }

        let api_key = self
            .client
            .state
            .provider
            .info()
            .api_key()?
            .ok_or_else(|| stream_error("Gemini API key is missing"))?;

        let input = prompt.get_formatted_input();
        let tool_mappings = build_tool_mappings(&prompt.tools);
        let mut payload = json!({
            "contents": build_gemini_contents(&input, &tool_mappings),
            "tools": build_gemini_tools(&tool_mappings),
        });
        if let Some(system) = build_system_prompt(&prompt.base_instructions.text, &input)
            && let Some(object) = payload.as_object_mut()
        {
            object.insert(
                "systemInstruction".to_string(),
                json!({
                    "parts": [{
                        "text": system,
                    }]
                }),
            );
        }

        let mut headers = reqwest_headers_from_api_provider(&provider);
        headers.insert(
            reqwest::header::CONTENT_TYPE,
            reqwest::header::HeaderValue::from_static("application/json"),
        );

        let client = reqwest::Client::builder()
            .timeout(self.client.state.provider.info().stream_idle_timeout())
            .build()
            .map_err(|error| stream_error(format!("failed to construct Gemini client: {error}")))?;

        let mut request = client
            .post(gemini_generate_content_endpoint(
                &provider.base_url,
                &model_info.slug,
            ))
            .headers(headers)
            .query(&[("key", api_key.as_str())])
            .json(&payload);
        if let Some(query_params) = provider.query_params.as_ref() {
            request = request.query(query_params);
        }

        let response = request
            .send()
            .await
            .map_err(|error| stream_error(format!("Gemini request failed: {error}")))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(stream_error(format!(
                "Gemini request failed ({status}): {body}"
            )));
        }

        let payload = response
            .json::<JsonValue>()
            .await
            .map_err(|error| stream_error(format!("failed to parse Gemini response: {error}")))?;
        let mapped = parse_gemini_response_payload(&payload, &tool_mappings);
        Ok(response_stream_from_provider_payload(mapped))
    }

    /// Permanently disables WebSockets for this Lyra session and resets WebSocket state.
    ///
    /// This is used after exhausting the provider retry budget, to force subsequent requests onto
    /// the HTTP transport.
    ///
    /// Returns `true` if this call activated fallback, or `false` if fallback was already active.
    pub(crate) fn try_switch_fallback_transport(
        &mut self,
        session_telemetry: &SessionTelemetry,
        model_info: &ModelInfo,
    ) -> bool {
        let activated = self
            .client
            .force_http_fallback(session_telemetry, model_info);
        self.websocket_session = WebsocketSession::default();
        activated
    }
}

/// Parses per-turn metadata into an HTTP header value.
///
/// Invalid values are treated as absent so callers can compare and propagate
/// metadata with the same sanitization path used when constructing headers.
fn parse_turn_metadata_header(turn_metadata_header: Option<&str>) -> Option<HeaderValue> {
    turn_metadata_header.and_then(|value| HeaderValue::from_str(value).ok())
}

/// Builds the extra headers attached to Responses API requests.
///
/// These headers implement Lyra-specific conventions:
///
/// - `x-lyra-turn-state`: sticky routing token captured earlier in the turn.
/// - `x-lyra-turn-metadata`: optional per-turn metadata for observability.
fn build_responses_headers(
    turn_state: Option<&Arc<OnceLock<String>>>,
    turn_metadata_header: Option<&HeaderValue>,
) -> ApiHeaderMap {
    let mut headers = ApiHeaderMap::new();
    if let Some(turn_state) = turn_state
        && let Some(state) = turn_state.get()
        && let Ok(header_value) = HeaderValue::from_str(state)
    {
        headers.insert(X_LYRA_TURN_STATE_HEADER, header_value);
    }
    if let Some(header_value) = turn_metadata_header {
        headers.insert(X_LYRA_TURN_METADATA_HEADER, header_value.clone());
    }
    headers
}

fn subagent_header_value(session_source: &SessionSource) -> Option<String> {
    let SessionSource::SubAgent(subagent_source) = session_source else {
        return None;
    };
    match subagent_source {
        SubAgentSource::Review => Some("review".to_string()),
        SubAgentSource::MemoryConsolidation => Some("memory_consolidation".to_string()),
        SubAgentSource::ThreadSpawn { .. } => Some("collab_spawn".to_string()),
        SubAgentSource::Other(label) => Some(label.clone()),
    }
}

fn parent_thread_id_header_value(session_source: &SessionSource) -> Option<String> {
    match session_source {
        SessionSource::SubAgent(SubAgentSource::ThreadSpawn {
            parent_thread_id, ..
        }) => Some(parent_thread_id.to_string()),
        SessionSource::Cli
        | SessionSource::VSCode
        | SessionSource::Exec
        | SessionSource::Mcp
        | SessionSource::Custom(_)
        | SessionSource::SubAgent(_)
        | SessionSource::Unknown => None,
    }
}

fn map_response_stream<S>(
    api_stream: S,
    session_telemetry: SessionTelemetry,
    inference_trace_attempt: InferenceTraceAttempt,
) -> (ResponseStream, oneshot::Receiver<LastResponse>)
where
    S: futures::Stream<Item = std::result::Result<ResponseEvent, ApiError>>
        + Unpin
        + Send
        + 'static,
{
    let (tx_event, rx_event) = mpsc::channel::<Result<ResponseEvent>>(1600);
    let (tx_last_response, rx_last_response) = oneshot::channel::<LastResponse>();

    tokio::spawn(async move {
        let mut logged_error = false;
        let mut tx_last_response = Some(tx_last_response);
        let mut items_added: Vec<ResponseItem> = Vec::new();
        let mut api_stream = api_stream;
        while let Some(event) = api_stream.next().await {
            match event {
                Ok(ResponseEvent::OutputItemDone(item)) => {
                    items_added.push(item.clone());
                    if tx_event
                        .send(Ok(ResponseEvent::OutputItemDone(item)))
                        .await
                        .is_err()
                    {
                        return;
                    }
                }
                Ok(ResponseEvent::Completed {
                    response_id,
                    token_usage,
                }) => {
                    if let Some(usage) = &token_usage {
                        session_telemetry.sse_event_completed(
                            usage.input_tokens,
                            usage.output_tokens,
                            Some(usage.cached_input_tokens),
                            Some(usage.reasoning_output_tokens),
                            usage.total_tokens,
                        );
                    }
                    inference_trace_attempt.record_completed(
                        &response_id,
                        &token_usage,
                        &items_added,
                    );
                    if let Some(sender) = tx_last_response.take() {
                        let _ = sender.send(LastResponse {
                            response_id: response_id.clone(),
                            items_added: std::mem::take(&mut items_added),
                        });
                    }
                    if tx_event
                        .send(Ok(ResponseEvent::Completed {
                            response_id,
                            token_usage,
                        }))
                        .await
                        .is_err()
                    {
                        return;
                    }
                }
                Ok(event) => {
                    if tx_event.send(Ok(event)).await.is_err() {
                        return;
                    }
                }
                Err(err) => {
                    let mapped = map_api_error(err);
                    inference_trace_attempt.record_failed(&mapped);
                    if !logged_error {
                        session_telemetry.see_event_completed_failed(&mapped);
                        logged_error = true;
                    }
                    if tx_event.send(Err(mapped)).await.is_err() {
                        return;
                    }
                }
            }
        }
    });

    (ResponseStream { rx_event }, rx_last_response)
}

/// Handles a 401 response by optionally refreshing external auth once.
///
/// When refresh succeeds, the caller should retry the API call; otherwise
/// the mapped `LyraErr` is returned to the caller.
#[derive(Clone, Copy, Debug)]
struct UnauthorizedRecoveryExecution {
    mode: &'static str,
    phase: &'static str,
}

#[derive(Clone, Copy, Debug, Default)]
struct PendingUnauthorizedRetry {
    retry_after_unauthorized: bool,
    recovery_mode: Option<&'static str>,
    recovery_phase: Option<&'static str>,
}

impl PendingUnauthorizedRetry {
    fn from_recovery(recovery: UnauthorizedRecoveryExecution) -> Self {
        Self {
            retry_after_unauthorized: true,
            recovery_mode: Some(recovery.mode),
            recovery_phase: Some(recovery.phase),
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct AuthRequestTelemetryContext {
    auth_mode: Option<&'static str>,
    auth_header_attached: bool,
    auth_header_name: Option<&'static str>,
    retry_after_unauthorized: bool,
    recovery_mode: Option<&'static str>,
    recovery_phase: Option<&'static str>,
}

impl AuthRequestTelemetryContext {
    fn new(
        auth_mode: Option<AuthMode>,
        api_auth: &dyn AuthProvider,
        retry: PendingUnauthorizedRetry,
    ) -> Self {
        let auth_telemetry = auth_header_telemetry(api_auth);
        Self {
            auth_mode: auth_mode.map(|_| "ApiKey"),
            auth_header_attached: auth_telemetry.attached,
            auth_header_name: auth_telemetry.name,
            retry_after_unauthorized: retry.retry_after_unauthorized,
            recovery_mode: retry.recovery_mode,
            recovery_phase: retry.recovery_phase,
        }
    }
}

struct WebsocketConnectParams<'a> {
    session_telemetry: &'a SessionTelemetry,
    api_provider: lyra_api::Provider,
    api_auth: SharedAuthProvider,
    turn_metadata_header: Option<&'a str>,
    options: &'a ApiResponsesOptions,
    auth_context: AuthRequestTelemetryContext,
    request_route_telemetry: RequestRouteTelemetry,
}

async fn handle_unauthorized(
    transport: TransportError,
    auth_recovery: &mut Option<UnauthorizedRecovery>,
    session_telemetry: &SessionTelemetry,
) -> Result<UnauthorizedRecoveryExecution> {
    let debug = extract_response_debug_context(&transport);
    if let Some(recovery) = auth_recovery
        && recovery.has_next()
    {
        let mode = recovery.mode_name();
        let phase = recovery.step_name();
        return match recovery.next().await {
            Ok(step_result) => {
                session_telemetry.record_auth_recovery(
                    mode,
                    phase,
                    "recovery_succeeded",
                    debug.request_id.as_deref(),
                    debug.cf_ray.as_deref(),
                    debug.auth_error.as_deref(),
                    debug.auth_error_code.as_deref(),
                    /*recovery_reason*/ None,
                    step_result.auth_state_changed(),
                );
                emit_feedback_auth_recovery_tags(
                    mode,
                    phase,
                    "recovery_succeeded",
                    debug.request_id.as_deref(),
                    debug.cf_ray.as_deref(),
                    debug.auth_error.as_deref(),
                    debug.auth_error_code.as_deref(),
                );
                Ok(UnauthorizedRecoveryExecution { mode, phase })
            }
            Err(RefreshTokenError::Permanent(failed)) => {
                session_telemetry.record_auth_recovery(
                    mode,
                    phase,
                    "recovery_failed_permanent",
                    debug.request_id.as_deref(),
                    debug.cf_ray.as_deref(),
                    debug.auth_error.as_deref(),
                    debug.auth_error_code.as_deref(),
                    /*recovery_reason*/ None,
                    /*auth_state_changed*/ None,
                );
                emit_feedback_auth_recovery_tags(
                    mode,
                    phase,
                    "recovery_failed_permanent",
                    debug.request_id.as_deref(),
                    debug.cf_ray.as_deref(),
                    debug.auth_error.as_deref(),
                    debug.auth_error_code.as_deref(),
                );
                Err(LyraErr::RefreshTokenFailed(failed))
            }
            Err(RefreshTokenError::Transient(other)) => {
                session_telemetry.record_auth_recovery(
                    mode,
                    phase,
                    "recovery_failed_transient",
                    debug.request_id.as_deref(),
                    debug.cf_ray.as_deref(),
                    debug.auth_error.as_deref(),
                    debug.auth_error_code.as_deref(),
                    /*recovery_reason*/ None,
                    /*auth_state_changed*/ None,
                );
                emit_feedback_auth_recovery_tags(
                    mode,
                    phase,
                    "recovery_failed_transient",
                    debug.request_id.as_deref(),
                    debug.cf_ray.as_deref(),
                    debug.auth_error.as_deref(),
                    debug.auth_error_code.as_deref(),
                );
                Err(LyraErr::Io(other))
            }
        };
    }

    let (mode, phase, recovery_reason) = match auth_recovery.as_ref() {
        Some(recovery) => (
            recovery.mode_name(),
            recovery.step_name(),
            Some(recovery.unavailable_reason()),
        ),
        None => ("none", "none", Some("auth_manager_missing")),
    };
    session_telemetry.record_auth_recovery(
        mode,
        phase,
        "recovery_not_run",
        debug.request_id.as_deref(),
        debug.cf_ray.as_deref(),
        debug.auth_error.as_deref(),
        debug.auth_error_code.as_deref(),
        recovery_reason,
        /*auth_state_changed*/ None,
    );
    emit_feedback_auth_recovery_tags(
        mode,
        phase,
        "recovery_not_run",
        debug.request_id.as_deref(),
        debug.cf_ray.as_deref(),
        debug.auth_error.as_deref(),
        debug.auth_error_code.as_deref(),
    );

    Err(map_api_error(ApiError::Transport(transport)))
}

fn api_error_http_status(error: &ApiError) -> Option<u16> {
    match error {
        ApiError::Transport(TransportError::Http { status, .. }) => Some(status.as_u16()),
        _ => None,
    }
}

struct ApiTelemetry {
    session_telemetry: SessionTelemetry,
    auth_context: AuthRequestTelemetryContext,
    request_route_telemetry: RequestRouteTelemetry,
    auth_env_telemetry: AuthEnvTelemetry,
}

impl ApiTelemetry {
    fn new(
        session_telemetry: SessionTelemetry,
        auth_context: AuthRequestTelemetryContext,
        request_route_telemetry: RequestRouteTelemetry,
        auth_env_telemetry: AuthEnvTelemetry,
    ) -> Self {
        Self {
            session_telemetry,
            auth_context,
            request_route_telemetry,
            auth_env_telemetry,
        }
    }
}

impl RequestTelemetry for ApiTelemetry {
    fn on_request(
        &self,
        attempt: u64,
        status: Option<HttpStatusCode>,
        error: Option<&TransportError>,
        duration: Duration,
    ) {
        let error_message = error.map(telemetry_transport_error_message);
        let status = status.map(|s| s.as_u16());
        let debug = error
            .map(extract_response_debug_context)
            .unwrap_or_default();
        self.session_telemetry.record_api_request(
            attempt,
            status,
            error_message.as_deref(),
            duration,
            self.auth_context.auth_header_attached,
            self.auth_context.auth_header_name,
            self.auth_context.retry_after_unauthorized,
            self.auth_context.recovery_mode,
            self.auth_context.recovery_phase,
            self.request_route_telemetry.endpoint,
            debug.request_id.as_deref(),
            debug.cf_ray.as_deref(),
            debug.auth_error.as_deref(),
            debug.auth_error_code.as_deref(),
        );
    }
}

impl SseTelemetry for ApiTelemetry {
    fn on_sse_poll(
        &self,
        result: &std::result::Result<
            Option<std::result::Result<Event, EventStreamError<TransportError>>>,
            tokio::time::error::Elapsed,
        >,
        duration: Duration,
    ) {
        self.session_telemetry.log_sse_event(result, duration);
    }
}

impl WebsocketTelemetry for ApiTelemetry {
    fn on_ws_request(&self, duration: Duration, error: Option<&ApiError>, connection_reused: bool) {
        let error_message = error.map(telemetry_api_error_message);
        let _status = error.and_then(api_error_http_status);
        let _debug = error
            .map(extract_response_debug_context_from_api_error)
            .unwrap_or_default();
        self.session_telemetry.record_websocket_request(
            duration,
            error_message.as_deref(),
            connection_reused,
        );
    }

    fn on_ws_event(
        &self,
        result: &std::result::Result<Option<std::result::Result<Message, Error>>, ApiError>,
        duration: Duration,
    ) {
        self.session_telemetry
            .record_websocket_event(result, duration);
    }
}

#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;
