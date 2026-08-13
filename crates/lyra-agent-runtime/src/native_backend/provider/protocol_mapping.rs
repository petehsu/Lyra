use super::*;

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn parse_streaming_response<R: BufRead>(
    reader: R,
    session_id: &str,
    turn_id: &str,
    cancellation: &CancellationToken,
    tools: &[Value],
) -> AgentRuntimeResult<ModelReply> {
    let mut committed_any = false;
    parse_streaming_response_with_commit(
        reader,
        session_id,
        turn_id,
        cancellation,
        tools,
        true,
        &mut committed_any,
    )
}

pub(crate) fn build_openai_compatible_request(
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    tool_choice: &ModelToolChoice,
    streaming: bool,
) -> AgentRuntimeResult<reqwest::blocking::RequestBuilder> {
    if providers::routes::mimo::is_mimo_route(&provider.route_id) {
        providers::routes::mimo::validate_thinking_replay(messages, model, tools)?;
    }
    let effective_tools = effective_tools(tools, tool_choice);
    let capabilities =
        providers::model_capabilities::resolve_openai_chat_model_capabilities(provider, model);
    let wire_messages = openai_chat::wire_messages(
        messages,
        openai_chat::ReasoningReplayPolicy {
            field: capabilities.reasoning_replay_field,
            required_on_assistant_messages: capabilities
                .requires_reasoning_field_on_assistant_messages,
        },
    );
    let mut body =
        openai_chat::build_request_body(model, &wire_messages, effective_tools, streaming);
    apply_model_tool_choice(
        &mut body,
        tools,
        tool_choice,
        ToolChoiceProtocol::OpenAiChat,
    )?;
    let client = provider_http_client_builder(streaming)
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let route = providers::registry::require_route(&provider.route_id)?;
    if let Some(route_hook) = providers::registry::hosted_openai_route_hook(&provider.route_id) {
        let url = providers::transport::http::endpoint_url(provider, route_hook.endpoint_path())?;
        let mut body = route_hook.decorate_request_body(body, provider, model)?;
        openai_chat::enforce_tool_choice_support(&mut body, capabilities.supports_tool_choice);
        let request = route_hook.apply_request_headers(client.post(url), provider)?;
        return Ok(request.json(&body));
    }

    openai_chat::enforce_tool_choice_support(&mut body, capabilities.supports_tool_choice);
    let url = providers::transport::http::chat_completions_url(provider)?;
    let request = apply_route_model_auth(client.post(url), provider, &route)?;
    Ok(request.json(&body))
}

pub(crate) fn apply_route_model_auth(
    builder: reqwest::blocking::RequestBuilder,
    provider: &NativeProviderProfile,
    route: &providers::types::ProviderRouteDescriptor,
) -> AgentRuntimeResult<reqwest::blocking::RequestBuilder> {
    if providers::transport::auth::resolve_api_key(provider).is_none()
        && route.auth_kind.contains("none")
    {
        return Ok(builder);
    }
    providers::transport::auth::apply_model_auth(builder, provider)
}

pub(crate) fn apply_route_model_auth_async(
    builder: reqwest::RequestBuilder,
    provider: &NativeProviderProfile,
    route: &providers::types::ProviderRouteDescriptor,
) -> AgentRuntimeResult<reqwest::RequestBuilder> {
    if providers::transport::auth::resolve_api_key(provider).is_none()
        && route.auth_kind.contains("none")
    {
        return Ok(builder);
    }
    providers::transport::auth::apply_model_auth_async(builder, provider)
}

pub(crate) fn route_uses_openai_responses(
    provider: &NativeProviderProfile,
    model: &str,
) -> AgentRuntimeResult<bool> {
    if let Some(protocol_id) =
        providers::routes::opencode::effective_protocol_id(&provider.route_id, model)
    {
        return Ok(protocol_id == openai_responses::PROTOCOL_ID);
    }
    let route = providers::registry::require_route(&provider.route_id)?;
    Ok(route.protocol_id == openai_responses::PROTOCOL_ID)
}

pub(crate) fn route_uses_anthropic_messages(
    provider: &NativeProviderProfile,
    model: &str,
) -> AgentRuntimeResult<bool> {
    if let Some(protocol_id) =
        providers::routes::opencode::effective_protocol_id(&provider.route_id, model)
    {
        return Ok(protocol_id == anthropic_messages::PROTOCOL_ID);
    }
    let route = providers::registry::require_route(&provider.route_id)?;
    Ok(route.protocol_id == anthropic_messages::PROTOCOL_ID)
}

pub(crate) fn route_uses_gemini_generate_content(
    provider: &NativeProviderProfile,
    model: &str,
) -> AgentRuntimeResult<bool> {
    if let Some(protocol_id) =
        providers::routes::opencode::effective_protocol_id(&provider.route_id, model)
    {
        return Ok(protocol_id == gemini_generate_content::PROTOCOL_ID);
    }
    let route = providers::registry::require_route(&provider.route_id)?;
    Ok(route.protocol_id == gemini_generate_content::PROTOCOL_ID)
}

pub(crate) fn route_uses_aws_bedrock_converse(
    provider: &NativeProviderProfile,
) -> AgentRuntimeResult<bool> {
    let route = providers::registry::require_route(&provider.route_id)?;
    Ok(route.protocol_id == aws_bedrock_converse::PROTOCOL_ID)
}

pub(crate) fn route_uses_ollama_chat(provider: &NativeProviderProfile) -> AgentRuntimeResult<bool> {
    let route = providers::registry::require_route(&provider.route_id)?;
    Ok(route.protocol_id == ollama_chat::PROTOCOL_ID)
}

pub(crate) fn lyra_request_context(messages: &[Value]) -> Option<&Value> {
    messages
        .first()
        .and_then(|message| message.get("lyraRequestContext"))
}

pub(crate) fn request_prompt_cache_base_enabled(messages: &[Value]) -> bool {
    let Some(context) = lyra_request_context(messages) else {
        return false;
    };
    let rejected = (|| {
        let provider_id = context.get("providerId")?.as_str()?;
        let route_id = context.get("routeId")?.as_str()?;
        let model = context.get("model")?.as_str()?;
        rejected_prompt_cache_profiles()
            .lock()
            .ok()
            .map(|profiles| {
                profiles.contains(&prompt_cache_profile_key(provider_id, route_id, model))
            })
    })()
    .unwrap_or(false);
    !rejected
        && context
            .get("promptCacheEnabled")
            .and_then(Value::as_bool)
            .unwrap_or(false)
}

pub(crate) fn request_prompt_cache_enabled(messages: &[Value], dialect_key: &str) -> bool {
    let Some(context) = lyra_request_context(messages) else {
        return false;
    };
    request_prompt_cache_base_enabled(messages)
        && context
            .get(dialect_key)
            .and_then(Value::as_bool)
            .unwrap_or(false)
}

pub(crate) fn build_openai_responses_request(
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    tool_choice: &ModelToolChoice,
    streaming: bool,
) -> AgentRuntimeResult<reqwest::blocking::RequestBuilder> {
    let effective_tools = effective_tools(tools, tool_choice);
    let mut body = openai_responses::build_request_body(
        model,
        messages,
        effective_tools,
        streaming,
        openai_responses_request_options(messages)?,
    )?;
    apply_model_tool_choice(
        &mut body,
        tools,
        tool_choice,
        ToolChoiceProtocol::OpenAiResponses,
    )?;
    let client = provider_http_client_builder(streaming)
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let url = providers::transport::http::endpoint_url(provider, openai_responses::ENDPOINT_PATH)?;
    let request = providers::transport::auth::apply_model_auth(client.post(url), provider)?;
    Ok(request.json(&body))
}

pub(crate) fn build_anthropic_messages_request(
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    tool_choice: &ModelToolChoice,
    streaming: bool,
) -> AgentRuntimeResult<reqwest::blocking::RequestBuilder> {
    if providers::routes::mimo::is_mimo_route(&provider.route_id) {
        providers::routes::mimo::validate_thinking_replay(messages, model, tools)?;
    }
    let effective_tools = effective_tools(tools, tool_choice);
    let cache = request_prompt_cache_enabled(messages, "anthropicPromptCache");
    let mut body = anthropic_messages::build_request_body_with_options(
        model,
        messages,
        effective_tools,
        streaming,
        anthropic_messages::RequestOptions {
            cache_system: cache,
            cache_latest_user_text: cache,
        },
    )?;
    apply_model_tool_choice(&mut body, tools, tool_choice, ToolChoiceProtocol::Anthropic)?;
    if providers::routes::mimo::is_anthropic_route(&provider.route_id) {
        let tool_calling = !tools.is_empty();
        providers::routes::mimo::apply_mimo_model_parameters(&mut body, model, tool_calling);
    }
    let client = provider_http_client_builder(streaming)
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let url =
        providers::transport::http::endpoint_url(provider, anthropic_messages::ENDPOINT_PATH)?;
    let request = anthropic_messages::apply_headers(client.post(url), provider)?;
    Ok(request.json(&body))
}

pub(crate) fn build_gemini_generate_content_request(
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    tool_choice: &ModelToolChoice,
    streaming: bool,
) -> AgentRuntimeResult<reqwest::blocking::RequestBuilder> {
    let effective_tools = effective_tools(tools, tool_choice);
    let mut body = gemini_generate_content::build_request_body(messages, effective_tools)?;
    apply_model_tool_choice(&mut body, tools, tool_choice, ToolChoiceProtocol::Gemini)?;
    let client = provider_http_client_builder(streaming)
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let path = if streaming {
        gemini_generate_content::stream_generate_content_path(model)?
    } else {
        gemini_generate_content::generate_content_path(model)?
    };
    let url = providers::transport::http::endpoint_url(provider, &path)?;
    let request = gemini_generate_content::apply_headers(client.post(url), provider)?;
    Ok(request.json(&body))
}

pub(crate) fn build_aws_bedrock_converse_request(
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    tool_choice: &ModelToolChoice,
) -> AgentRuntimeResult<reqwest::blocking::RequestBuilder> {
    let effective_tools = effective_tools(tools, tool_choice);
    let cache = request_prompt_cache_enabled(messages, "bedrockPromptCache");
    let mut body = aws_bedrock_converse::build_request_body_with_options(
        messages,
        effective_tools,
        aws_bedrock_converse::RequestOptions {
            cache_system: cache,
            cache_latest_user: cache,
        },
    )?;
    apply_model_tool_choice(&mut body, tools, tool_choice, ToolChoiceProtocol::Bedrock)?;
    let client = provider_http_client_builder(false)
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let path = aws_bedrock_converse::converse_path(model)?;
    let url = providers::transport::http::endpoint_url(provider, &path)?;
    aws_bedrock_converse::build_signed_json_request(&client, provider, &url, &body)
}

pub(crate) fn build_ollama_chat_request(
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    tool_choice: &ModelToolChoice,
    streaming: bool,
) -> AgentRuntimeResult<reqwest::blocking::RequestBuilder> {
    let effective_tools = effective_tools(tools, tool_choice);
    let mut body = ollama_chat::build_request_body(model, messages, effective_tools, streaming)?;
    apply_model_tool_choice(&mut body, tools, tool_choice, ToolChoiceProtocol::Ollama)?;
    let client = provider_http_client_builder(streaming)
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let url = providers::transport::http::endpoint_url(provider, ollama_chat::CHAT_ENDPOINT_PATH)?;
    let request = ollama_chat::apply_headers(client.post(url), provider)?;
    Ok(request.json(&body))
}

// ---- Async request builders (streaming hot path) ----

pub(crate) fn build_openai_compatible_request_async(
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    tool_choice: &ModelToolChoice,
    streaming: bool,
) -> AgentRuntimeResult<reqwest::RequestBuilder> {
    if providers::routes::mimo::is_mimo_route(&provider.route_id) {
        providers::routes::mimo::validate_thinking_replay(messages, model, tools)?;
    }
    let effective_tools = effective_tools(tools, tool_choice);
    let capabilities =
        providers::model_capabilities::resolve_openai_chat_model_capabilities(provider, model);
    let wire_messages = openai_chat::wire_messages(
        messages,
        openai_chat::ReasoningReplayPolicy {
            field: capabilities.reasoning_replay_field,
            required_on_assistant_messages: capabilities
                .requires_reasoning_field_on_assistant_messages,
        },
    );
    let mut body =
        openai_chat::build_request_body(model, &wire_messages, effective_tools, streaming);
    apply_model_tool_choice(
        &mut body,
        tools,
        tool_choice,
        ToolChoiceProtocol::OpenAiChat,
    )?;
    let client = provider_http_client_builder_async(streaming)
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let route = providers::registry::require_route(&provider.route_id)?;
    if let Some(route_hook) = providers::registry::hosted_openai_route_hook(&provider.route_id) {
        let url = providers::transport::http::endpoint_url(provider, route_hook.endpoint_path())?;
        let mut body = route_hook.decorate_request_body(body, provider, model)?;
        openai_chat::enforce_tool_choice_support(&mut body, capabilities.supports_tool_choice);
        let request = route_hook.apply_request_headers_async(client.post(url), provider)?;
        return Ok(request.json(&body));
    }
    openai_chat::enforce_tool_choice_support(&mut body, capabilities.supports_tool_choice);
    let url = providers::transport::http::chat_completions_url(provider)?;
    let request = apply_route_model_auth_async(client.post(url), provider, &route)?;
    Ok(request.json(&body))
}

pub(crate) fn build_openai_responses_request_async(
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    tool_choice: &ModelToolChoice,
    streaming: bool,
) -> AgentRuntimeResult<reqwest::RequestBuilder> {
    let effective_tools = effective_tools(tools, tool_choice);
    let mut body = openai_responses::build_request_body(
        model,
        messages,
        effective_tools,
        streaming,
        openai_responses_request_options(messages)?,
    )?;
    apply_model_tool_choice(
        &mut body,
        tools,
        tool_choice,
        ToolChoiceProtocol::OpenAiResponses,
    )?;
    let client = provider_http_client_builder_async(streaming)
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let url = providers::transport::http::endpoint_url(provider, openai_responses::ENDPOINT_PATH)?;
    let request = providers::transport::auth::apply_model_auth_async(client.post(url), provider)?;
    Ok(request.json(&body))
}

pub(crate) fn build_anthropic_messages_request_async(
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    tool_choice: &ModelToolChoice,
    streaming: bool,
) -> AgentRuntimeResult<reqwest::RequestBuilder> {
    if providers::routes::mimo::is_mimo_route(&provider.route_id) {
        providers::routes::mimo::validate_thinking_replay(messages, model, tools)?;
    }
    let effective_tools = effective_tools(tools, tool_choice);
    let cache = request_prompt_cache_enabled(messages, "anthropicPromptCache");
    let mut body = anthropic_messages::build_request_body_with_options(
        model,
        messages,
        effective_tools,
        streaming,
        anthropic_messages::RequestOptions {
            cache_system: cache,
            cache_latest_user_text: cache,
        },
    )?;
    apply_model_tool_choice(&mut body, tools, tool_choice, ToolChoiceProtocol::Anthropic)?;
    if providers::routes::mimo::is_anthropic_route(&provider.route_id) {
        let tool_calling = !tools.is_empty();
        providers::routes::mimo::apply_mimo_model_parameters(&mut body, model, tool_calling);
    }
    let client = provider_http_client_builder_async(streaming)
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let url =
        providers::transport::http::endpoint_url(provider, anthropic_messages::ENDPOINT_PATH)?;
    let request = anthropic_messages::apply_headers_async(client.post(url), provider)?;
    Ok(request.json(&body))
}

pub(crate) fn build_gemini_generate_content_request_async(
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    tool_choice: &ModelToolChoice,
    streaming: bool,
) -> AgentRuntimeResult<reqwest::RequestBuilder> {
    let effective_tools = effective_tools(tools, tool_choice);
    let mut body = gemini_generate_content::build_request_body(messages, effective_tools)?;
    apply_model_tool_choice(&mut body, tools, tool_choice, ToolChoiceProtocol::Gemini)?;
    let client = provider_http_client_builder_async(streaming)
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let path = if streaming {
        gemini_generate_content::stream_generate_content_path(model)?
    } else {
        gemini_generate_content::generate_content_path(model)?
    };
    let url = providers::transport::http::endpoint_url(provider, &path)?;
    let request = gemini_generate_content::apply_headers_async(client.post(url), provider)?;
    Ok(request.json(&body))
}

pub(crate) fn build_ollama_chat_request_async(
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    tool_choice: &ModelToolChoice,
    streaming: bool,
) -> AgentRuntimeResult<reqwest::RequestBuilder> {
    let effective_tools = effective_tools(tools, tool_choice);
    let mut body = ollama_chat::build_request_body(model, messages, effective_tools, streaming)?;
    apply_model_tool_choice(&mut body, tools, tool_choice, ToolChoiceProtocol::Ollama)?;
    let client = provider_http_client_builder_async(streaming)
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let url = providers::transport::http::endpoint_url(provider, ollama_chat::CHAT_ENDPOINT_PATH)?;
    let request = ollama_chat::apply_headers_async(client.post(url), provider)?;
    Ok(request.json(&body))
}

#[derive(Clone, Copy)]
pub(crate) enum ToolChoiceProtocol {
    OpenAiChat,
    OpenAiResponses,
    Anthropic,
    Gemini,
    Bedrock,
    Ollama,
}

pub(crate) fn effective_tools<'a>(tools: &'a [Value], choice: &ModelToolChoice) -> &'a [Value] {
    if matches!(choice, ModelToolChoice::None) {
        &[]
    } else {
        tools
    }
}

pub(crate) fn apply_model_tool_choice(
    body: &mut Value,
    tools: &[Value],
    choice: &ModelToolChoice,
    protocol: ToolChoiceProtocol,
) -> AgentRuntimeResult<()> {
    let specific_name = match choice {
        ModelToolChoice::Specific { tool_name } => Some(tool_name.as_str()),
        _ => None,
    };
    if matches!(
        choice,
        ModelToolChoice::Required | ModelToolChoice::Specific { .. }
    ) && tools.is_empty()
    {
        return Err(AgentRuntimeError::Core(
            "provider tool choice requires at least one model tool".to_string(),
        ));
    }
    if let Some(name) = specific_name
        && !tools.iter().any(|tool| {
            tool.pointer("/function/name").and_then(Value::as_str) == Some(name)
                || tool.get("name").and_then(Value::as_str) == Some(name)
        })
    {
        return Err(AgentRuntimeError::Core(format!(
            "provider tool choice references an unavailable tool: {name}"
        )));
    }
    match protocol {
        ToolChoiceProtocol::OpenAiChat => {
            body["tool_choice"] = match choice {
                ModelToolChoice::Auto => json!("auto"),
                ModelToolChoice::Required => json!("required"),
                ModelToolChoice::Specific { tool_name } => {
                    json!({ "type": "function", "function": { "name": tool_name } })
                }
                ModelToolChoice::None => json!("none"),
            };
        }
        ToolChoiceProtocol::OpenAiResponses => {
            body["tool_choice"] = match choice {
                ModelToolChoice::Auto => json!("auto"),
                ModelToolChoice::Required => json!("required"),
                ModelToolChoice::Specific { tool_name } => {
                    json!({ "type": "function", "name": tool_name })
                }
                ModelToolChoice::None => json!("none"),
            };
        }
        ToolChoiceProtocol::Anthropic => match choice {
            ModelToolChoice::Auto => body["tool_choice"] = json!({ "type": "auto" }),
            ModelToolChoice::Required => body["tool_choice"] = json!({ "type": "any" }),
            ModelToolChoice::Specific { tool_name } => {
                body["tool_choice"] = json!({ "type": "tool", "name": tool_name })
            }
            ModelToolChoice::None => {
                body.as_object_mut()
                    .map(|object| object.remove("tool_choice"));
            }
        },
        ToolChoiceProtocol::Gemini => {
            let config = match choice {
                ModelToolChoice::Auto => json!({ "mode": "AUTO" }),
                ModelToolChoice::Required => json!({ "mode": "ANY" }),
                ModelToolChoice::Specific { tool_name } => {
                    json!({ "mode": "ANY", "allowedFunctionNames": [tool_name] })
                }
                ModelToolChoice::None => json!({ "mode": "NONE" }),
            };
            body["toolConfig"] = json!({ "functionCallingConfig": config });
        }
        ToolChoiceProtocol::Bedrock => {
            body["toolConfig"]["toolChoice"] = match choice {
                ModelToolChoice::Auto => json!({ "auto": {} }),
                ModelToolChoice::Required => json!({ "any": {} }),
                ModelToolChoice::Specific { tool_name } => {
                    json!({ "tool": { "name": tool_name } })
                }
                ModelToolChoice::None => Value::Null,
            };
            if matches!(choice, ModelToolChoice::None) {
                body.as_object_mut()
                    .map(|object| object.remove("toolConfig"));
            }
        }
        ToolChoiceProtocol::Ollama => {
            body["tool_choice"] = match choice {
                ModelToolChoice::Auto => json!("auto"),
                ModelToolChoice::Required => json!("required"),
                ModelToolChoice::Specific { tool_name } => {
                    json!({ "type": "function", "function": { "name": tool_name } })
                }
                ModelToolChoice::None => json!("none"),
            };
        }
    }
    Ok(())
}

pub(crate) fn openai_responses_request_options(
    messages: &[Value],
) -> AgentRuntimeResult<openai_responses::RequestOptions> {
    let state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let request_context = lyra_request_context(messages);
    let configured_stateful = crate::native_backend::turns::env_bool_override(
        "LYRA_OPENAI_RESPONSES_STATEFUL_PROMPT_CONTRACT",
    )
    .unwrap_or(state.config.openai_responses_stateful_prompt_contract);
    let stateful = request_context
        .and_then(|context| context.pointer("/stateful/enabled"))
        .and_then(Value::as_bool)
        .unwrap_or(configured_stateful);
    let previous_response_id = stateful
        .then(|| {
            request_context
                .and_then(|context| context.pointer("/stateful/previousResponseId"))
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| {
                    std::env::var("LYRA_OPENAI_RESPONSES_PREVIOUS_RESPONSE_ID")
                        .ok()
                        .map(|value| value.trim().to_string())
                        .filter(|value| !value.is_empty())
                })
        })
        .flatten();
    let prompt_cache_enabled = request_prompt_cache_base_enabled(messages);
    Ok(openai_responses::RequestOptions {
        reasoning_effort: state.config.reasoning_effort.clone(),
        verbosity: state.config.verbosity.clone(),
        service_tier: state.config.service_tier.clone(),
        prompt_cache_key: prompt_cache_enabled
            .then(|| {
                request_context
                    .and_then(|context| context.get("promptCacheKey"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .flatten(),
        explicit_prompt_cache: prompt_cache_enabled
            && request_context
                .and_then(|context| context.get("openaiExplicitPromptCache"))
                .and_then(Value::as_bool)
                .unwrap_or(false),
        store: stateful,
        previous_response_id,
        input_start: request_context
            .filter(|_| stateful)
            .and_then(|context| context.pointer("/stateful/inputStart"))
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .unwrap_or(0),
    })
}

pub(crate) fn parse_streaming_response_with_commit<R: BufRead>(
    reader: R,
    session_id: &str,
    turn_id: &str,
    cancellation: &CancellationToken,
    tools: &[Value],
    commit_assistant_text: bool,
    committed_any: &mut bool,
) -> AgentRuntimeResult<ModelReply> {
    let mut state = ProviderStreamState::default();
    let mut ui_message_id: Option<String> = None;
    let mut delta_batcher = StreamDeltaBatcher::default();
    let buffer_assistant_text = false;
    let allowed_tool_names = openai_chat::tool_name_set(tools);
    let started_at = Instant::now();
    let mut saw_done = false;

    for line in reader.lines() {
        if cancellation.is_cancelled()
            || (!session_id.is_empty()
                && !turn_id.is_empty()
                && turn_was_cancelled(session_id, turn_id))
        {
            *committed_any = state.committed_any;
            return Err(AgentRuntimeError::Cancelled);
        }
        if provider_streaming_total_deadline_exceeded(started_at) {
            *committed_any = state.committed_any;
            return Err(provider_streaming_total_timeout_error());
        }
        // A stall here (provider keeps the socket open but stops sending) is
        // bounded by the client's per-operation idle timeout configured in
        // `provider_http_client_builder`; it surfaces as a `reqwest::Error` whose
        // `is_timeout()` is true, classified below into a typed transport Timeout
        // that the caller's safe-retry / non-streaming fallback can recover from.
        let line = line.map_err(|error| {
            *committed_any = state.committed_any;
            streaming_body_read_error(error)
        })?;
        let Some(event) = openai_chat::parse_sse_line(&line)? else {
            continue;
        };
        let openai_chat::SseEvent::Data(value) = event else {
            saw_done = true;
            break;
        };
        if let Some(error) = value.get("error").filter(|error| !error.is_null()) {
            *committed_any = state.committed_any;
            return Err(AgentRuntimeError::Core(format!(
                "provider streaming error: {error}"
            )));
        }
        if let Err(error) = map_provider_stream_chunk(
            &value,
            &mut state,
            &mut ui_message_id,
            &mut delta_batcher,
            buffer_assistant_text,
            session_id,
            turn_id,
        ) {
            *committed_any = state.committed_any;
            return Err(error);
        }
    }
    if !saw_done {
        *committed_any = state.committed_any;
        return Err(AgentRuntimeError::ProviderTransport {
            kind: ProviderTransportKind::StreamInterrupted,
            detail: "provider SSE stream ended before the [DONE] terminal event".to_string(),
        });
    }
    // From here on every remaining failure (finalize/normalize/commit) happens
    // after all streaming increments have been applied, so the committed flag is
    // final for the rest of the function.
    *committed_any = state.committed_any;

    // Flush any held-back partial tag the scrubber kept across the final delta.
    // If it turned out not to be a real tag it surfaces as visible text; trailing
    // in-block reasoning is routed to the reasoning channel.
    let flushed = state.think_scrubber.flush();
    if !flushed.reasoning.is_empty() {
        state.reasoning_chars = state
            .reasoning_chars
            .saturating_add(flushed.reasoning.chars().count());
        state.reasoning_content.push_str(&flushed.reasoning);
        if delta_batcher.push_reasoning(
            &flushed.reasoning,
            &mut ui_message_id,
            session_id,
            turn_id,
        )? {
            state.committed_any = true;
        }
    }
    if !flushed.visible.is_empty() {
        if !buffer_assistant_text {
            if delta_batcher.push_visible(
                &flushed.visible,
                &mut ui_message_id,
                session_id,
                turn_id,
            )? {
                state.committed_any = true;
            }
        }
        state.content.push_str(&flushed.visible);
    }
    if delta_batcher.flush(&mut ui_message_id, session_id, turn_id)? {
        state.committed_any = true;
    }
    *committed_any = state.committed_any;

    let mut tool_calls =
        openai_chat::finalize_streaming_tool_calls(state.tool_calls, &allowed_tool_names)?;
    tool_calls.sort_by_key(|(index, _)| *index);
    let tool_calls = tool_calls
        .into_iter()
        .map(|(_, call)| call)
        .collect::<Vec<_>>();

    if state.content.trim().is_empty()
        && tool_calls.is_empty()
        && state.finish_reason.as_deref() == Some("tool_calls")
    {
        return Err(AgentRuntimeError::ProviderProtocol {
            kind: ProviderProtocolFailureKind::IncompleteToolCall,
            detail: "provider finished with tool_calls but returned no complete tool call"
                .to_string(),
        });
    }

    let streamed_message_id = ui_message_id.filter(|id| !id.is_empty());
    let raw_stop_reason = state.finish_reason.clone();
    let stop_signal = if state.saw_refusal {
        TurnStopSignal::Refusal
    } else {
        TurnStopSignal::from_raw(state.finish_reason.as_deref())
    };
    let provider_replay_items = state
        .reasoning_replay_field
        .zip(state.reasoning_replay_value)
        .map(|(field, value)| vec![json!({ "field": field, "value": value })])
        .unwrap_or_default();
    let mut reply = ModelReply {
        content: (!state.content.trim().is_empty()).then_some(state.content),
        reasoning_content: (!state.reasoning_content.trim().is_empty())
            .then_some(state.reasoning_content),
        tool_calls,
        ui_message_id: streamed_message_id.clone(),
        raw_stop_reason,
        provider_replay_protocol: Some(openai_chat::PROTOCOL_ID.to_string()),
        provider_replay_items,
        response_meta: state.response_meta,
        stop_signal,
    };
    normalize_model_reply_protocol(&mut reply, tools)?;
    if commit_assistant_text {
        crate::native_backend::turns::commit_visible_assistant_reply(
            session_id,
            turn_id,
            &mut reply,
            &streamed_message_id,
        );
    } else {
        reply.ui_message_id = streamed_message_id;
    }
    Ok(reply)
}

pub(crate) async fn parse_streaming_response_with_commit_async(
    response: reqwest::Response,
    session_id: &str,
    turn_id: &str,
    cancellation: &CancellationToken,
    tools: &[Value],
    commit_assistant_text: bool,
    committed_any: &mut bool,
) -> AgentRuntimeResult<ModelReply> {
    let mut state = ProviderStreamState::default();
    let mut ui_message_id: Option<String> = None;
    let mut delta_batcher = StreamDeltaBatcher::default();
    let buffer_assistant_text = false;
    let allowed_tool_names = openai_chat::tool_name_set(tools);
    let started_at = Instant::now();
    let mut saw_done = false;

    let mut reader =
        crate::native_backend::providers::protocol::async_line_reader::AsyncLineReader::new(
            response.bytes_stream(),
        );
    while let Some(line_result) = reader.next_line().await {
        if cancellation.is_cancelled()
            || (!session_id.is_empty()
                && !turn_id.is_empty()
                && turn_was_cancelled(session_id, turn_id))
        {
            *committed_any = state.committed_any;
            return Err(AgentRuntimeError::Cancelled);
        }
        if provider_streaming_total_deadline_exceeded(started_at) {
            *committed_any = state.committed_any;
            return Err(provider_streaming_total_timeout_error());
        }
        let line = line_result.map_err(|e| {
            *committed_any = state.committed_any;
            e
        })?;
        let Some(event) = openai_chat::parse_sse_line(&line)? else {
            continue;
        };
        let openai_chat::SseEvent::Data(value) = event else {
            saw_done = true;
            break;
        };
        if let Some(error) = value.get("error").filter(|error| !error.is_null()) {
            *committed_any = state.committed_any;
            return Err(AgentRuntimeError::Core(format!(
                "provider streaming error: {error}"
            )));
        }
        if let Err(error) = map_provider_stream_chunk(
            &value,
            &mut state,
            &mut ui_message_id,
            &mut delta_batcher,
            buffer_assistant_text,
            session_id,
            turn_id,
        ) {
            *committed_any = state.committed_any;
            return Err(error);
        }
    }
    if !saw_done {
        *committed_any = state.committed_any;
        return Err(AgentRuntimeError::ProviderTransport {
            kind: ProviderTransportKind::StreamInterrupted,
            detail: "provider SSE stream ended before the [DONE] terminal event".to_string(),
        });
    }
    *committed_any = state.committed_any;

    let flushed = state.think_scrubber.flush();
    if !flushed.reasoning.is_empty() {
        state.reasoning_chars = state
            .reasoning_chars
            .saturating_add(flushed.reasoning.chars().count());
        state.reasoning_content.push_str(&flushed.reasoning);
        if delta_batcher.push_reasoning(
            &flushed.reasoning,
            &mut ui_message_id,
            session_id,
            turn_id,
        )? {
            state.committed_any = true;
        }
    }
    if !flushed.visible.is_empty() {
        if !buffer_assistant_text {
            if delta_batcher.push_visible(
                &flushed.visible,
                &mut ui_message_id,
                session_id,
                turn_id,
            )? {
                state.committed_any = true;
            }
        }
        state.content.push_str(&flushed.visible);
    }
    if delta_batcher.flush(&mut ui_message_id, session_id, turn_id)? {
        state.committed_any = true;
    }
    *committed_any = state.committed_any;

    let mut tool_calls =
        openai_chat::finalize_streaming_tool_calls(state.tool_calls, &allowed_tool_names)?;
    tool_calls.sort_by_key(|(index, _)| *index);
    let tool_calls = tool_calls
        .into_iter()
        .map(|(_, call)| call)
        .collect::<Vec<_>>();

    if state.content.trim().is_empty()
        && tool_calls.is_empty()
        && state.finish_reason.as_deref() == Some("tool_calls")
    {
        return Err(AgentRuntimeError::ProviderProtocol {
            kind: ProviderProtocolFailureKind::IncompleteToolCall,
            detail: "provider finished with tool_calls but returned no complete tool call"
                .to_string(),
        });
    }

    let streamed_message_id = ui_message_id.filter(|id| !id.is_empty());
    let raw_stop_reason = state.finish_reason.clone();
    let stop_signal = if state.saw_refusal {
        TurnStopSignal::Refusal
    } else {
        TurnStopSignal::from_raw(state.finish_reason.as_deref())
    };
    let provider_replay_items = state
        .reasoning_replay_field
        .zip(state.reasoning_replay_value)
        .map(|(field, value)| vec![json!({ "field": field, "value": value })])
        .unwrap_or_default();
    let mut reply = ModelReply {
        content: (!state.content.trim().is_empty()).then_some(state.content),
        reasoning_content: (!state.reasoning_content.trim().is_empty())
            .then_some(state.reasoning_content),
        tool_calls,
        ui_message_id: streamed_message_id.clone(),
        raw_stop_reason,
        provider_replay_protocol: Some(openai_chat::PROTOCOL_ID.to_string()),
        provider_replay_items,
        response_meta: state.response_meta,
        stop_signal,
    };
    normalize_model_reply_protocol(&mut reply, tools)?;
    if commit_assistant_text {
        crate::native_backend::turns::commit_visible_assistant_reply(
            session_id,
            turn_id,
            &mut reply,
            &streamed_message_id,
        );
    } else {
        reply.ui_message_id = streamed_message_id;
    }
    Ok(reply)
}

pub(crate) fn provider_streaming_total_deadline_exceeded(started_at: Instant) -> bool {
    started_at.elapsed() > streaming_total_timeout()
}

pub(crate) fn provider_streaming_total_timeout_error() -> AgentRuntimeError {
    AgentRuntimeError::ProviderTransport {
        kind: ProviderTransportKind::Timeout,
        detail: format!(
            "provider streaming response exceeded total deadline of {} seconds",
            streaming_total_timeout().as_secs()
        ),
    }
}

pub(crate) fn map_provider_stream_chunk(
    value: &Value,
    state: &mut ProviderStreamState,
    ui_message_id: &mut Option<String>,
    delta_batcher: &mut StreamDeltaBatcher,
    buffer_assistant_text: bool,
    session_id: &str,
    turn_id: &str,
) -> AgentRuntimeResult<()> {
    state.response_meta.merge(openai_chat_response_meta(value));
    let Some(choices) = value.get("choices").and_then(Value::as_array) else {
        return Ok(());
    };
    let Some(first_choice) = choices.first() else {
        return Ok(());
    };
    let selected_index = first_choice.get("index").and_then(Value::as_u64);
    for (_, choice) in choices.iter().enumerate().filter(|(position, choice)| {
        *position == 0
            || selected_index
                .is_some_and(|index| choice.get("index").and_then(Value::as_u64) == Some(index))
    }) {
        state.saw_choice = true;
        if let Some(finish_reason) = choice.get("finish_reason").and_then(Value::as_str)
            && !finish_reason.trim().is_empty()
        {
            state.finish_reason = Some(finish_reason.to_string());
        }
        let delta = choice.get("delta").unwrap_or(&Value::Null);
        if delta
            .get("refusal")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
        {
            state.saw_refusal = true;
        }
        if let Some(raw_text) = openai_chat::message_content(delta.get("content"))
            && !raw_text.is_empty()
        {
            // Strip inline <think>…</think> reasoning before it can reach the visible
            // message. Reasoning-model providers (DeepSeek/Qwen/MiniMax/Kimi) inline
            // reasoning into `content`; without this it leaks into the chat and also
            // poisons the missing-tool-call heuristic downstream. The scrubber is
            // stateful so a tag split across stream chunks is handled correctly.
            let scrubbed = state.think_scrubber.feed(&raw_text);
            if !scrubbed.reasoning.is_empty() {
                state.reasoning_chars = state
                    .reasoning_chars
                    .saturating_add(scrubbed.reasoning.chars().count());
                state.reasoning_content.push_str(&scrubbed.reasoning);
                if delta_batcher.push_reasoning(
                    &scrubbed.reasoning,
                    ui_message_id,
                    session_id,
                    turn_id,
                )? {
                    state.committed_any = true;
                }
            }
            if !scrubbed.visible.is_empty() {
                let candidate = format!("{}{}", state.content, scrubbed.visible);
                if contains_leaked_internal_protocol_markers(&candidate) {
                    return Err(AgentRuntimeError::ProviderProtocol {
                        kind: ProviderProtocolFailureKind::TextualToolProtocolLeak,
                        detail:
                            "provider emitted textual tool protocol syntax instead of a structured tool call"
                                .to_string(),
                    });
                }
                if !buffer_assistant_text
                    && delta_batcher.push_visible(
                        &scrubbed.visible,
                        ui_message_id,
                        session_id,
                        turn_id,
                    )?
                {
                    state.committed_any = true;
                }
                state.content.push_str(&scrubbed.visible);
            }
        }
        if let Some((field, value)) = openai_chat::message_reasoning_field(delta) {
            merge_openai_reasoning_replay(state, field, value);
        }
        if let Some(reasoning) = openai_chat::message_reasoning_text(delta) {
            state.reasoning_chars = state
                .reasoning_chars
                .saturating_add(reasoning.chars().count());
            state.reasoning_content.push_str(&reasoning);
            if delta_batcher.push_reasoning(&reasoning, ui_message_id, session_id, turn_id)? {
                state.committed_any = true;
            }
        }
        if let Some(chunks) = delta.get("tool_calls").and_then(Value::as_array) {
            if delta_batcher.flush(ui_message_id, session_id, turn_id)? {
                state.committed_any = true;
            }
            for chunk in chunks {
                let index = chunk.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                let accumulator = state.tool_calls.entry(index).or_default();
                if let Some(id) = chunk.get("id").and_then(Value::as_str)
                    && openai_chat::is_valid_tool_call_id(id)
                {
                    accumulator.id = Some(id.trim().to_string());
                }
                if let Some(name) = chunk.pointer("/function/name").and_then(Value::as_str)
                    && !name.trim().is_empty()
                {
                    accumulator.name = Some(name.trim().to_string());
                }
                if let Some(arguments) =
                    chunk.pointer("/function/arguments").and_then(Value::as_str)
                {
                    accumulator.arguments.push_str(arguments);
                }
            }
            let preview_emitted =
                crate::native_backend::tools::maybe_emit_streaming_diff_previews_from_accumulators(
                    session_id,
                    turn_id,
                    &state.tool_calls,
                );
            // A streaming tool-call preview mutates session state (records a
            // preview activity), so a later transport failure is no longer safely
            // retryable. Only mark committed when a preview was actually emitted;
            // a throttled or skipped preview does not block safe retry / fallback.
            if preview_emitted {
                state.committed_any = true;
            }
        }
    }
    Ok(())
}

fn merge_openai_reasoning_replay(state: &mut ProviderStreamState, field: &str, incoming: Value) {
    if state.reasoning_replay_field.as_deref() != Some(field) {
        state.reasoning_replay_field = Some(field.to_string());
        state.reasoning_replay_value = Some(incoming);
        return;
    }
    match incoming {
        Value::String(delta) => {
            if let Some(Value::String(current)) = state.reasoning_replay_value.as_mut() {
                current.push_str(&delta);
            } else {
                state.reasoning_replay_value = Some(Value::String(delta));
            }
        }
        Value::Array(mut delta) => {
            if let Some(Value::Array(current)) = state.reasoning_replay_value.as_mut() {
                current.append(&mut delta);
            } else {
                state.reasoning_replay_value = Some(Value::Array(delta));
            }
        }
        value => state.reasoning_replay_value = Some(value),
    }
}

pub(crate) fn normalize_model_reply_protocol(
    reply: &mut ModelReply,
    tools: &[Value],
) -> AgentRuntimeResult<()> {
    let allowed_tool_names = openai_chat::tool_name_set(tools);
    for call in &mut reply.tool_calls {
        if let Some(name) = openai_chat::repair_tool_name(&call.name, &allowed_tool_names) {
            call.name = name;
        }
    }
    if reply.stop_signal != TurnStopSignal::MaxTokens {
        openai_chat::validate_tool_call_arguments(&reply.tool_calls)?;
    }
    let Some(content) = reply.content.take() else {
        if reply.tool_calls.is_empty() {
            return Ok(());
        }
        return Ok(());
    };
    if contains_leaked_internal_protocol_markers(&content) {
        return Err(AgentRuntimeError::ProviderProtocol {
            kind: ProviderProtocolFailureKind::TextualToolProtocolLeak,
            detail: "provider emitted an internal Lyra protocol marker in visible text".to_string(),
        });
    }
    if contains_textual_tool_call_marker(&content, &allowed_tool_names) {
        return Err(AgentRuntimeError::ProviderProtocol {
            kind: ProviderProtocolFailureKind::TextualToolProtocolLeak,
            detail: "provider emitted textual tool-call syntax instead of a structured tool call"
                .to_string(),
        });
    }
    tool_protocol::validate_visible_assistant_text_protocol(&content)?;
    let sanitized = if reply.stop_signal == TurnStopSignal::MaxTokens {
        tool_protocol::sanitize_truncated_assistant_text(&content)
    } else {
        sanitize_visible_assistant_text(&content)
    };
    reply.content = sanitized;
    Ok(())
}

pub(crate) fn normalize_visible_assistant_text(content: &str) -> Option<String> {
    sanitize_visible_assistant_text(content)
}

pub(crate) fn contains_textual_tool_call_marker(
    content: &str,
    allowed_tool_names: &HashSet<String>,
) -> bool {
    contains_textual_structured_tool_shape(content, allowed_tool_names)
}

pub(crate) fn clear_failed_assistant_draft(session_id: &str, turn_id: &str) {
    if let Some(message_id) = active_ui_message_id(session_id, turn_id) {
        let _ = remove_assistant_message(session_id, &message_id);
    }
    clear_active_ui_message_id(session_id, turn_id);
}

pub(crate) fn contains_textual_structured_tool_shape(
    content: &str,
    allowed_tool_names: &HashSet<String>,
) -> bool {
    let lower = content.to_ascii_lowercase();
    if lower.contains("```")
        && lower.contains("\"path\"")
        && lower.contains("\"/tools/")
        && lower.contains("\"args\"")
    {
        return true;
    }
    let tool_names = textual_tool_name_candidates(allowed_tool_names);
    tool_names.iter().any(|tool_name| {
        let tool = tool_name.to_ascii_lowercase();
        if lower.contains(&format!("{tool}(")) {
            return true;
        }
        let quoted = format!("\"{tool}\"");
        if !lower.contains(&quoted) {
            return false;
        }
        lower.contains("\"arguments\"")
            || lower.contains("\"args\"")
            || lower.contains("\"function\"")
            || lower.contains("\"tool_calls\"")
            || lower.contains("tool_call")
            || lower.contains("```")
    })
}

pub(crate) fn textual_tool_name_candidates(
    allowed_tool_names: &HashSet<String>,
) -> HashSet<String> {
    let mut names = allowed_tool_names.clone();
    for name in PROVIDER_VISIBLE_TOOL_NAMES {
        names.insert(name.to_string());
    }
    names.insert(LYRA_SESSION_READ_MESSAGE_TOOL.to_string());
    names
}

pub(crate) fn find_ascii_case_insensitive(
    haystack: &str,
    needle: &str,
    from: usize,
) -> Option<usize> {
    crate::native_backend::tool_protocol::find_ascii_case_insensitive(haystack, needle, from)
}

pub(crate) fn model_capabilities(
    provider: &NativeProviderProfile,
    model: &str,
) -> ModelCapabilityProfile {
    let openai_chat =
        providers::model_capabilities::resolve_openai_chat_model_capabilities(provider, model);
    let profile = provider
        .models
        .iter()
        .find(|candidate| candidate.id == model);
    if let Some(profile) = profile {
        return ModelCapabilityProfile {
            supports_image_input: providers::model_capabilities::effective_capability(
                profile,
                "image_input",
                profile.supports_image_input,
            ),
            supports_tool_calling: providers::model_capabilities::effective_capability(
                profile,
                "tool_calling",
                profile.supports_tool_calling,
            ),
            supports_streaming: providers::model_capabilities::effective_capability(
                profile,
                "streaming",
                profile.supports_streaming,
            ),
            reasoning_replay_field: openai_chat.reasoning_replay_field,
            requires_reasoning_field_on_assistant_messages: openai_chat
                .requires_reasoning_field_on_assistant_messages,
            supports_tool_choice: openai_chat.supports_tool_choice,
            context_window: profile.context_window,
        };
    }
    let route = providers::registry::require_route(&provider.route_id).ok();
    let discovered = providers::model_capabilities::discovered_model(
        model.to_string(),
        Some(model.to_string()),
        None,
        route.as_ref(),
        None,
    );
    ModelCapabilityProfile {
        supports_image_input: discovered.supports_image_input,
        supports_tool_calling: discovered.supports_tool_calling,
        supports_streaming: discovered.supports_streaming,
        reasoning_replay_field: openai_chat.reasoning_replay_field,
        requires_reasoning_field_on_assistant_messages: openai_chat
            .requires_reasoning_field_on_assistant_messages,
        supports_tool_choice: openai_chat.supports_tool_choice,
        context_window: discovered.context_window,
    }
}

pub(crate) fn observe_successful_provider_capabilities(
    session_id: &str,
    request: &ModelRequest,
    messages: &[Value],
    reply: &ModelReply,
) {
    if providers::model_capabilities::messages_contain_provider_images(messages) {
        let _ = providers::model_capabilities::record_probe_success_for_provider(
            session_id,
            &request.provider.id,
            &request.model,
            "image_input",
        );
    }
    if !request.tools.is_empty() && !reply.tool_calls.is_empty() {
        let _ = providers::model_capabilities::record_probe_success_for_provider(
            session_id,
            &request.provider.id,
            &request.model,
            "tool_calling",
        );
    }
    if request.capabilities.supports_streaming {
        let _ = providers::model_capabilities::record_probe_success_for_provider(
            session_id,
            &request.provider.id,
            &request.model,
            "streaming",
        );
    }
}
