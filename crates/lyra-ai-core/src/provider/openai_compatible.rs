use std::cell::Cell;
use std::collections::{BTreeMap, BTreeSet};
use std::io::{BufRead, BufReader};

use napi::Result;
use reqwest::blocking::RequestBuilder;
use serde_json::{json, Value};

use crate::agent::error_recovery::{classify_network_error, ExponentialBackoff};
use crate::error::{now_ms, to_error};
use crate::profile::types::{AiProfileValidationResult, AiProviderModelEntry, AiProviderProfile};
use crate::provider::types::{
    apply_custom_headers, build_client, fallback_models, required_connection_value, secret_value,
    AgentInferenceDeltaCallback, AgentInferenceMessage, AgentInferenceMessageRole,
    AgentInferenceResponse, AgentInferenceUsage, AgentReasoningDeltaCallback, AgentToolDefinition,
    AgentToolInvocation,
};

const OPENAI_AUTH_ISSUER: &str = "https://auth.openai.com";
const OPENAI_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_AUTH_MODE_CHATGPT_OAUTH: &str = "chatgpt_oauth";

#[derive(serde::Deserialize)]
struct OpenAiTokenResponse {
    access_token: String,
}

pub(crate) fn is_chatgpt_oauth_mode(profile: &AiProviderProfile) -> bool {
    profile
        .auth_config
        .get("authMode")
        .map(String::as_str)
        .unwrap_or("api_key")
        == OPENAI_AUTH_MODE_CHATGPT_OAUTH
}

fn refresh_chatgpt_access_token(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<String> {
    let refresh_token = secret_value(secrets, "refreshToken").ok_or_else(|| {
        if profile
            .configured_secret_fields
            .iter()
            .any(|field| field == "refreshToken")
        {
            return to_error(
                "ChatGPT refresh token is marked as configured, but secure storage could not provide it. Re-authorize ChatGPT or unlock macOS Keychain and retry.",
            );
        }
        to_error("ChatGPT OAuth mode requires a refresh token. Run ChatGPT authorization first.")
    })?;
    let client = build_client()?;
    let response = client
        .post(format!("{OPENAI_AUTH_ISSUER}/oauth/token"))
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", OPENAI_CLIENT_ID),
        ])
        .send()
        .map_err(|error| to_error(format!("failed to refresh ChatGPT access token: {error}")))?;
    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        if let Some(message) = usage_limit_error_message(status, &body) {
            return Err(to_error(message));
        }
        return Err(to_error(format!(
            "ChatGPT token refresh failed ({status}): {body}"
        )));
    }
    let payload = response
        .json::<OpenAiTokenResponse>()
        .map_err(|error| to_error(format!("failed to parse ChatGPT token response: {error}")))?;
    Ok(payload.access_token)
}

pub(crate) fn apply_auth_headers(
    builder: RequestBuilder,
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<RequestBuilder> {
    let builder = apply_custom_headers(builder, profile);
    if profile.provider_id == "openai" && is_chatgpt_oauth_mode(profile) {
        let access_token = refresh_chatgpt_access_token(profile, secrets)?;
        let mut builder = builder.bearer_auth(access_token);
        if let Some(account_id) = profile
            .auth_config
            .get("chatgptAccountId")
            .map(String::as_str)
        {
            if account_id.trim().is_empty() == false {
                builder = builder.header("ChatGPT-Account-Id", account_id);
            }
        }
        return Ok(builder);
    }
    if profile.provider_id == "azure_openai" {
        if let Some(api_key) = secret_value(secrets, "apiKey") {
            return Ok(builder.header("api-key", api_key));
        }
        return Ok(builder);
    }
    if let Some(api_key) = secret_value(secrets, "apiKey") {
        Ok(builder.bearer_auth(api_key))
    } else {
        Ok(builder)
    }
}

fn chat_completions_endpoint(profile: &AiProviderProfile) -> Result<String> {
    let base_url = required_connection_value(profile, "baseUrl")?;
    Ok(format!(
        "{}/chat/completions",
        base_url.trim_end_matches('/')
    ))
}

fn sanitize_openai_tool_name(name: &str) -> String {
    let mut sanitized = name
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() || char == '_' || char == '-' {
                char
            } else {
                '_'
            }
        })
        .collect::<String>();
    if sanitized.trim().is_empty() {
        sanitized = "tool".to_string();
    }
    sanitized
}

fn build_openai_tool_name_maps(
    tools: &[AgentToolDefinition],
) -> (BTreeMap<String, String>, BTreeMap<String, String>) {
    let mut canonical_to_wire = BTreeMap::new();
    let mut wire_to_canonical = BTreeMap::new();
    let mut used_wire_names = BTreeSet::new();

    for tool in tools {
        let canonical_name = tool.name.trim().to_string();
        let base_wire_name = sanitize_openai_tool_name(&canonical_name);
        let mut wire_name = base_wire_name.clone();
        let mut counter: usize = 2;
        while used_wire_names.contains(&wire_name) {
            wire_name = format!("{base_wire_name}_{counter}");
            counter += 1;
        }
        used_wire_names.insert(wire_name.clone());
        canonical_to_wire.insert(canonical_name.clone(), wire_name.clone());
        wire_to_canonical.insert(wire_name, canonical_name);
    }

    (canonical_to_wire, wire_to_canonical)
}

fn resolve_openai_wire_tool_name(
    canonical_name: &str,
    canonical_to_wire: &BTreeMap<String, String>,
) -> String {
    canonical_to_wire
        .get(canonical_name)
        .cloned()
        .unwrap_or_else(|| sanitize_openai_tool_name(canonical_name))
}

fn resolve_canonical_tool_name(
    wire_name: &str,
    wire_to_canonical: &BTreeMap<String, String>,
) -> String {
    wire_to_canonical
        .get(wire_name)
        .cloned()
        .unwrap_or_else(|| wire_name.to_string())
}

fn map_openai_messages_with_tool_map(
    messages: &[AgentInferenceMessage],
    canonical_to_wire: &BTreeMap<String, String>,
) -> Vec<Value> {
    messages
        .iter()
        .map(|message| match message.role {
            AgentInferenceMessageRole::System => json!({
                "role": "system",
                "content": message.content,
            }),
            AgentInferenceMessageRole::User => json!({
                "role": "user",
                "content": message.content,
            }),
            AgentInferenceMessageRole::Assistant => {
                if message.tool_calls.is_empty() {
                    json!({
                        "role": "assistant",
                        "content": message.content,
                    })
                } else {
                    let tool_calls = message
                        .tool_calls
                        .iter()
                        .map(|tool_call| {
                            json!({
                                "id": tool_call.id,
                                "type": "function",
                                "function": {
                                    "name": resolve_openai_wire_tool_name(&tool_call.name, canonical_to_wire),
                                    "arguments": serde_json::to_string(&tool_call.input).unwrap_or_else(|_| "{}".to_string()),
                                }
                            })
                        })
                        .collect::<Vec<_>>();
                    json!({
                        "role": "assistant",
                        "content": if message.content.trim().is_empty() { Value::Null } else { Value::String(message.content.clone()) },
                        "tool_calls": tool_calls,
                    })
                }
            }
            AgentInferenceMessageRole::Tool => json!({
                "role": "tool",
                "tool_call_id": message.tool_call_id,
                "content": message.content,
            }),
        })
        .collect()
}

fn parse_assistant_content(raw: &Value) -> String {
    if let Some(text) = raw.as_str() {
        return text.to_string();
    }
    raw.as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    item.get("text")
                        .and_then(Value::as_str)
                        .map(|entry| entry.trim().to_string())
                })
                .filter(|entry| !entry.is_empty())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

fn map_tool_definitions(
    tools: &[AgentToolDefinition],
    canonical_to_wire: &BTreeMap<String, String>,
) -> Vec<Value> {
    tools
        .iter()
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": resolve_openai_wire_tool_name(&tool.name, canonical_to_wire),
                    "description": tool.description,
                    "parameters": tool.input_schema.clone(),
                }
            })
        })
        .collect()
}

#[derive(Default)]
struct OpenAiPartialToolCall {
    id: Option<String>,
    name: Option<String>,
    arguments: String,
}

fn append_openai_delta_content(
    raw: &Value,
    assistant_text: &mut String,
    on_assistant_delta: &mut Option<&mut AgentInferenceDeltaCallback<'_>>,
) {
    let mut emit = |chunk: &str| {
        if chunk.is_empty() {
            return;
        }
        assistant_text.push_str(chunk);
        if let Some(callback) = on_assistant_delta.as_deref_mut() {
            callback(chunk);
        }
    };

    if let Some(text) = raw.as_str() {
        emit(text);
        return;
    }

    if let Some(items) = raw.as_array() {
        for item in items {
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                emit(text);
            }
        }
    }
}

fn process_openai_stream_event(
    raw_event: &str,
    assistant_text: &mut String,
    reasoning_content: &mut String,
    partial_tool_calls: &mut Vec<OpenAiPartialToolCall>,
    usage: &mut AgentInferenceUsage,
    on_assistant_delta: &mut Option<&mut AgentInferenceDeltaCallback<'_>>,
    on_reasoning_delta: &mut Option<&mut AgentReasoningDeltaCallback<'_>>,
) -> Result<bool> {
    let event_data = raw_event.trim();
    if event_data.is_empty() {
        return Ok(false);
    }
    if event_data == "[DONE]" {
        return Ok(true);
    }

    let payload = serde_json::from_str::<Value>(event_data).map_err(|error| {
        to_error(format!(
            "failed to parse openai compatible stream event payload: {error}"
        ))
    })?;

    if let Some(input_tokens) = payload
        .get("usage")
        .and_then(|usage| usage.get("prompt_tokens"))
        .and_then(Value::as_i64)
    {
        usage.input_tokens = Some(input_tokens);
    }
    if let Some(output_tokens) = payload
        .get("usage")
        .and_then(|usage| usage.get("completion_tokens"))
        .and_then(Value::as_i64)
    {
        usage.output_tokens = Some(output_tokens);
    }
    if let Some(total_tokens) = payload
        .get("usage")
        .and_then(|usage| usage.get("total_tokens"))
        .and_then(Value::as_i64)
    {
        usage.total_tokens = Some(total_tokens);
    }

    let delta = payload
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("delta"))
        .cloned()
        .unwrap_or(Value::Null);

    if let Some(content) = delta.get("content") {
        append_openai_delta_content(content, assistant_text, on_assistant_delta);
    }

    // Extract reasoning/reasoning_content from models that support it (o-series, etc.)
    if let Some(reasoning) = delta.get("reasoning_content").and_then(Value::as_str) {
        if !reasoning.is_empty() {
            reasoning_content.push_str(reasoning);
            if let Some(callback) = on_reasoning_delta.as_mut() {
                callback(reasoning);
            }
        }
    }
    // Also check for Anthropic-style thinking in delta
    if let Some(thinking) = delta.get("thinking").and_then(Value::as_str) {
        if !thinking.is_empty() {
            reasoning_content.push_str(thinking);
            if let Some(callback) = on_reasoning_delta.as_mut() {
                callback(thinking);
            }
        }
    }

    if let Some(calls) = delta.get("tool_calls").and_then(Value::as_array) {
        for call in calls {
            let index = call
                .get("index")
                .and_then(Value::as_u64)
                .map(|value| value as usize)
                .unwrap_or(partial_tool_calls.len());
            if partial_tool_calls.len() <= index {
                partial_tool_calls.resize_with(index + 1, OpenAiPartialToolCall::default);
            }
            let entry = &mut partial_tool_calls[index];

            if let Some(id) = call.get("id").and_then(Value::as_str).map(str::trim) {
                if !id.is_empty() {
                    entry.id = Some(id.to_string());
                }
            }

            let function = call.get("function").and_then(Value::as_object);
            if let Some(name) = function
                .and_then(|function| function.get("name"))
                .and_then(Value::as_str)
                .map(str::trim)
            {
                if !name.is_empty() {
                    entry.name = Some(name.to_string());
                }
            }
            if let Some(arguments) = function
                .and_then(|function| function.get("arguments"))
                .and_then(Value::as_str)
            {
                entry.arguments.push_str(arguments);
            }
        }
    }

    Ok(false)
}

fn run_agent_inference_stream(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
    messages: &[AgentInferenceMessage],
    tools: &[AgentToolDefinition],
    mut on_assistant_delta: Option<&mut AgentInferenceDeltaCallback<'_>>,
    mut on_reasoning_delta: Option<&mut AgentReasoningDeltaCallback<'_>>,
) -> Result<AgentInferenceResponse> {
    let endpoint = chat_completions_endpoint(profile)?;
    let client = build_client()?;
    let (canonical_to_wire, wire_to_canonical) = build_openai_tool_name_maps(tools);
    let request_payload = json!({
        "model": profile.model,
        "messages": map_openai_messages_with_tool_map(messages, &canonical_to_wire),
        "tool_choice": "auto",
        "tools": map_tool_definitions(tools, &canonical_to_wire),
        "stream": true,
        "stream_options": {
            "include_usage": true
        }
    });

    let response = apply_auth_headers(client.post(endpoint), profile, secrets)?
        .json(&request_payload)
        .send()
        .map_err(|error| {
            to_error(format!(
                "openai compatible inference request failed: {error}"
            ))
        })?;
    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(to_error(format!(
            "openai compatible inference failed ({status}): {body}"
        )));
    }

    let mut reader = BufReader::new(response);
    let mut assistant_text = String::new();
    let mut reasoning_content = String::new();
    let mut partial_tool_calls = Vec::<OpenAiPartialToolCall>::new();
    let mut usage = AgentInferenceUsage::default();
    let mut event_data = String::new();
    let mut line = String::new();

    loop {
        line.clear();
        let bytes = reader.read_line(&mut line).map_err(|error| {
            to_error(format!(
                "failed reading openai compatible stream response: {error}"
            ))
        })?;
        if bytes == 0 {
            if !event_data.is_empty() {
                let _ = process_openai_stream_event(
                    &event_data,
                    &mut assistant_text,
                    &mut reasoning_content,
                    &mut partial_tool_calls,
                    &mut usage,
                    &mut on_assistant_delta,
                    &mut on_reasoning_delta,
                )?;
                event_data.clear();
            }
            break;
        }

        let stripped = line.trim_end_matches(['\r', '\n']);
        if stripped.is_empty() {
            if !event_data.is_empty() {
                let should_stop = process_openai_stream_event(
                    &event_data,
                    &mut assistant_text,
                    &mut reasoning_content,
                    &mut partial_tool_calls,
                    &mut usage,
                    &mut on_assistant_delta,
                    &mut on_reasoning_delta,
                )?;
                event_data.clear();
                if should_stop {
                    break;
                }
            }
            continue;
        }

        if let Some(value) = stripped.strip_prefix("data:") {
            if !event_data.is_empty() {
                event_data.push('\n');
            }
            event_data.push_str(value.trim_start());
        }
    }

    let tool_calls = partial_tool_calls
        .into_iter()
        .filter_map(|entry| {
            let id = entry.id?;
            let wire_name = entry.name?;
            let input = if entry.arguments.trim().is_empty() {
                json!({})
            } else {
                serde_json::from_str::<Value>(&entry.arguments).unwrap_or_else(|_| json!({}))
            };
            Some(AgentToolInvocation {
                id,
                name: resolve_canonical_tool_name(&wire_name, &wire_to_canonical),
                input,
            })
        })
        .collect::<Vec<_>>();

    Ok(AgentInferenceResponse {
        assistant_text,
        reasoning_content,
        tool_calls,
        usage,
    })
}

fn run_agent_inference_non_stream(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
    messages: &[AgentInferenceMessage],
    tools: &[AgentToolDefinition],
) -> Result<AgentInferenceResponse> {
    let endpoint = chat_completions_endpoint(profile)?;
    let client = build_client()?;
    let (canonical_to_wire, wire_to_canonical) = build_openai_tool_name_maps(tools);
    let request_payload = json!({
        "model": profile.model,
        "messages": map_openai_messages_with_tool_map(messages, &canonical_to_wire),
        "tool_choice": "auto",
        "tools": map_tool_definitions(tools, &canonical_to_wire),
    });
    let response = apply_auth_headers(client.post(endpoint), profile, secrets)?
        .json(&request_payload)
        .send()
        .map_err(|error| {
            to_error(format!(
                "openai compatible inference request failed: {error}"
            ))
        })?;
    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(to_error(format!(
            "openai compatible inference failed ({status}): {body}"
        )));
    }
    let payload = response.json::<Value>().map_err(|error| {
        to_error(format!(
            "failed to parse openai compatible inference payload: {error}"
        ))
    })?;

    let message = payload
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .cloned()
        .ok_or_else(|| {
            to_error("openai compatible inference response missing choices[0].message")
        })?;

    let assistant_text = parse_assistant_content(message.get("content").unwrap_or(&Value::Null));
    let tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .map(|calls| {
            calls
                .iter()
                .filter_map(|call| {
                    let id = call.get("id").and_then(Value::as_str)?.trim().to_string();
                    let name = call
                        .get("function")
                        .and_then(|function| function.get("name"))
                        .and_then(Value::as_str)?
                        .trim()
                        .to_string();
                    let arguments = call
                        .get("function")
                        .and_then(|function| function.get("arguments"))
                        .and_then(Value::as_str)
                        .unwrap_or("{}");
                    let input = serde_json::from_str::<Value>(arguments).ok()?;
                    Some(AgentToolInvocation {
                        id,
                        name: resolve_canonical_tool_name(&name, &wire_to_canonical),
                        input,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let usage = AgentInferenceUsage {
        input_tokens: payload
            .get("usage")
            .and_then(|usage| usage.get("prompt_tokens"))
            .and_then(Value::as_i64),
        output_tokens: payload
            .get("usage")
            .and_then(|usage| usage.get("completion_tokens"))
            .and_then(Value::as_i64),
        total_tokens: payload
            .get("usage")
            .and_then(|usage| usage.get("total_tokens"))
            .and_then(Value::as_i64),
    };

    Ok(AgentInferenceResponse {
        assistant_text,
        reasoning_content: String::new(),
        tool_calls,
        usage,
    })
}

pub fn run_agent_inference(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
    messages: &[AgentInferenceMessage],
    tools: &[AgentToolDefinition],
    on_assistant_delta: Option<&mut AgentInferenceDeltaCallback<'_>>,
    on_reasoning_delta: Option<&mut AgentReasoningDeltaCallback<'_>>,
) -> Result<AgentInferenceResponse> {
    let mut on_assistant_delta = on_assistant_delta;
    let mut on_reasoning_delta = on_reasoning_delta;
    let has_delta_listener = on_assistant_delta.is_some();
    let emitted_delta = Cell::new(false);
    let mut bridge = |delta: &str| {
        if has_delta_listener {
            emitted_delta.set(true);
            if let Some(callback) = on_assistant_delta.as_deref_mut() {
                callback(delta);
            }
        }
    };

    // Retry with backoff: up to 2 attempts for recoverable errors
    let backoff = ExponentialBackoff::default();
    let max_retries = 2;

    for attempt in 0..=max_retries {
        match run_agent_inference_stream(
            profile,
            secrets,
            messages,
            tools,
            Some(&mut bridge),
            on_reasoning_delta.as_deref_mut(),
        ) {
            Ok(response) => return Ok(response),
            Err(error) if !emitted_delta.get() => {
                // Stream failed before emitting any content — try non-stream fallback
                return run_agent_inference_non_stream(profile, secrets, messages, tools).map(
                    |response| {
                        if !response.assistant_text.is_empty() {
                            if let Some(callback) = on_assistant_delta.as_deref_mut() {
                                callback(&response.assistant_text);
                            }
                        }
                        response
                    },
                );
            }
            Err(error) => {
                let error_msg = error.to_string();
                let severity = classify_network_error(&error_msg);

                if !severity.is_recoverable() || attempt >= max_retries {
                    return Err(error);
                }

                let delay = backoff.delay_ms(attempt).max(severity.retry_after_ms());
                std::thread::sleep(std::time::Duration::from_millis(delay));
            }
        }
    }

    run_agent_inference_stream(profile, secrets, messages, tools, Some(&mut bridge), None)
}

#[cfg(test)]
mod tests {
    use super::{build_openai_tool_name_maps, map_openai_messages_with_tool_map};
    use crate::provider::types::{
        AgentInferenceMessage, AgentInferenceMessageRole, AgentToolDefinition,
    };
    use serde_json::json;

    #[test]
    fn openai_tool_name_map_sanitizes_and_preserves_canonical_names() {
        let tools = vec![
            AgentToolDefinition {
                name: "filesystem.list".to_string(),
                description: "list".to_string(),
                input_schema: json!({"type":"object"}),
            },
            AgentToolDefinition {
                name: "filesystem/search".to_string(),
                description: "search".to_string(),
                input_schema: json!({"type":"object"}),
            },
            AgentToolDefinition {
                name: "filesystem_search".to_string(),
                description: "search2".to_string(),
                input_schema: json!({"type":"object"}),
            },
        ];

        let (canonical_to_wire, wire_to_canonical) = build_openai_tool_name_maps(&tools);

        assert_eq!(
            canonical_to_wire.get("filesystem.list").map(String::as_str),
            Some("filesystem_list")
        );
        assert_eq!(
            canonical_to_wire
                .get("filesystem/search")
                .map(String::as_str),
            Some("filesystem_search")
        );
        assert_eq!(
            canonical_to_wire
                .get("filesystem_search")
                .map(String::as_str),
            Some("filesystem_search_2")
        );

        assert_eq!(
            wire_to_canonical.get("filesystem_list").map(String::as_str),
            Some("filesystem.list")
        );
        assert_eq!(
            wire_to_canonical
                .get("filesystem_search")
                .map(String::as_str),
            Some("filesystem/search")
        );
        assert_eq!(
            wire_to_canonical
                .get("filesystem_search_2")
                .map(String::as_str),
            Some("filesystem_search")
        );
    }

    #[test]
    fn openai_message_mapping_includes_system_role() {
        let messages = vec![
            AgentInferenceMessage {
                role: AgentInferenceMessageRole::System,
                content: "You are Lyra.".to_string(),
                tool_call_id: None,
                tool_calls: Vec::new(),
            },
            AgentInferenceMessage {
                role: AgentInferenceMessageRole::User,
                content: "hello".to_string(),
                tool_call_id: None,
                tool_calls: Vec::new(),
            },
        ];
        let mapped = map_openai_messages_with_tool_map(&messages, &Default::default());
        assert_eq!(
            mapped
                .first()
                .and_then(|message| message.get("role"))
                .and_then(serde_json::Value::as_str),
            Some("system")
        );
        assert_eq!(
            mapped
                .first()
                .and_then(|message| message.get("content"))
                .and_then(serde_json::Value::as_str),
            Some("You are Lyra.")
        );
    }
}

fn usage_limit_error_message(status: reqwest::StatusCode, body: &str) -> Option<String> {
    if status != reqwest::StatusCode::TOO_MANY_REQUESTS {
        return None;
    }
    let payload: Value = serde_json::from_str(body).ok()?;
    let error = payload.get("error")?;
    let error_type = error
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if error_type != "usage_limit_reached" {
        return None;
    }
    let reset_at = error
        .get("resets_at")
        .and_then(Value::as_i64)
        .map(|value| value.to_string())
        .unwrap_or_else(|| "unknown".to_string());
    Some(format!(
        "ChatGPT usage limit reached for this account. Reset timestamp: {reset_at}. Switch account/plan or wait for reset."
    ))
}

fn models_endpoint(profile: &AiProviderProfile) -> Result<Option<String>> {
    if profile.provider_id == "openai" && is_chatgpt_oauth_mode(profile) {
        return Ok(None);
    }
    if profile.provider_id == "azure_openai" {
        return Ok(None);
    }
    let base_url = required_connection_value(profile, "baseUrl")?;
    Ok(Some(format!("{}/models", base_url.trim_end_matches('/'))))
}

pub fn validate_profile_connection(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<AiProfileValidationResult> {
    if profile.provider_id == "openai" && is_chatgpt_oauth_mode(profile) {
        let _ = refresh_chatgpt_access_token(profile, secrets)?;
        return Ok(AiProfileValidationResult {
            ok: true,
            message: "Connected to OpenAI via ChatGPT OAuth".to_string(),
            checked_at: now_ms(),
        });
    }

    if let Some(endpoint) = models_endpoint(profile)? {
        let client = build_client()?;
        let response = apply_auth_headers(client.get(endpoint), profile, secrets)?
            .send()
            .map_err(|error| to_error(format!("failed to connect to model provider: {error}")))?;
        if response.status().is_success() == false {
            let status = response.status();
            let body = response.text().unwrap_or_default();
            return Err(to_error(format!(
                "provider validation failed ({status}): {body}"
            )));
        }
    }

    Ok(AiProfileValidationResult {
        ok: true,
        message: format!("Connected to {}", profile.provider_id),
        checked_at: now_ms(),
    })
}

pub fn discover_models(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<Vec<AiProviderModelEntry>> {
    if profile.provider_id == "openai" && is_chatgpt_oauth_mode(profile) {
        return Ok(fallback_models(profile));
    }

    let Some(endpoint) = models_endpoint(profile)? else {
        return Ok(fallback_models(profile));
    };
    let client = build_client()?;
    let response = apply_auth_headers(client.get(endpoint), profile, secrets)?
        .send()
        .map_err(|error| to_error(format!("failed to discover models: {error}")))?;
    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(to_error(format!(
            "model discovery failed ({status}): {body}"
        )));
    }
    let payload = response
        .json::<Value>()
        .map_err(|error| to_error(format!("failed to parse model discovery payload: {error}")))?;
    let mut models = payload
        .get("data")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    let id = entry.get("id").and_then(Value::as_str)?.to_string();
                    let name = entry
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or(id.as_str())
                        .to_string();
                    Some(AiProviderModelEntry {
                        id,
                        name,
                        description: entry
                            .get("description")
                            .and_then(Value::as_str)
                            .map(|value| value.to_string()),
                        context_window: entry.get("context_window").and_then(Value::as_i64),
                        supports_images: None,
                        supports_tools: None,
                        source: "dynamic".to_string(),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if models.is_empty() {
        models = fallback_models(profile);
    }
    Ok(models)
}
