use super::*;

pub(crate) fn read_config() -> AgentRuntimeResult<Value> {
    let state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    Ok(json!({
        "agentHome": state.root.display().to_string(),
        "configPath": state.root.join("state.json").display().to_string(),
        "config": config_json(&state.config),
        "commands": registered_commands(),
    }))
}

pub(crate) fn update_config(payload: Value) -> AgentRuntimeResult<Value> {
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    if let Some(provider) = string_opt(&payload, "defaultProvider") {
        state.config.default_provider = Some(provider);
    }
    if let Some(model) = string_opt(&payload, "defaultModel") {
        state.config.default_model = Some(model);
    }
    if let Some(value) = string_opt(&payload, "openaiReasoningEffort") {
        state.config.reasoning_effort = Some(value);
    }
    if let Some(value) = string_opt(&payload, "openaiServiceTier") {
        state.config.service_tier = Some(value);
    }
    if let Some(value) = string_opt(&payload, "openaiVerbosity") {
        state.config.verbosity = Some(value);
    }
    if let Some(value) = payload.get("proactiveEnabled").and_then(Value::as_bool) {
        state.config.proactive_enabled = value;
    }
    if let Some(items) = payload
        .get("proactiveDisabledTriggers")
        .and_then(Value::as_array)
    {
        state.config.proactive_disabled_triggers = items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
    }
    for (key, value) in payload.as_object().into_iter().flatten() {
        if key.starts_with("email")
            || key.starts_with("telegram")
            || key.starts_with("discord")
            || key.starts_with("ntfy")
            || key == "desktopNotifications"
        {
            state
                .config
                .notifications
                .insert(key.clone(), value.clone());
        }
    }
    state.save_state()?;
    drop(state);
    read_config()
}

pub(crate) fn save_provider_profile(payload: Value) -> AgentRuntimeResult<Value> {
    let profile_name = string_opt(&payload, "profileName")
        .ok_or_else(|| AgentRuntimeError::Core("profileName is required".to_string()))?;
    let route_id = string_opt(&payload, "routeId")
        .ok_or_else(|| AgentRuntimeError::Core("routeId is required".to_string()))?;
    let route = providers::registry::require_route(&route_id)?;
    let base_url = string_opt(&payload, "baseUrl").or_else(|| route.default_base_url.clone());
    let default_model = string_opt(&payload, "defaultModel");
    let existing_profile = {
        let state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        state.config.providers.get(&profile_name).cloned()
    };
    let models = payload
        .get("models")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let id = item.get("id").and_then(Value::as_str)?.to_string();
                    Some(NativeProviderModel {
                        id: id.clone(),
                        label: Some(id),
                        context_window: item
                            .get("contextWindow")
                            .and_then(Value::as_u64)
                            .map(|value| value as usize),
                        supports_image_input: item
                            .get("supportsImageInput")
                            .or_else(|| item.get("supports_image_input"))
                            .and_then(Value::as_bool)
                            .unwrap_or(true),
                        supports_tool_calling: item
                            .get("supportsToolCalling")
                            .or_else(|| item.get("supports_tool_calling"))
                            .and_then(Value::as_bool)
                            .unwrap_or(true),
                        supports_streaming: item
                            .get("supportsStreaming")
                            .or_else(|| item.get("supports_streaming"))
                            .and_then(Value::as_bool)
                            .unwrap_or(true),
                        enabled: item.get("enabled").and_then(Value::as_bool).unwrap_or(true),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| {
            existing_profile
                .as_ref()
                .map(|profile| profile.models.clone())
                .unwrap_or_default()
        });
    let default_auth_header = default_auth_header_for_route(&route);
    let profile = NativeProviderProfile {
        id: profile_name.clone(),
        label: string_opt(&payload, "label").unwrap_or_else(|| route.label.clone()),
        route_id,
        base_url,
        default_model: default_model.clone().or_else(|| {
            existing_profile
                .as_ref()
                .and_then(|profile| profile.default_model.clone())
        }),
        api_key: if payload.get("apiKey").is_some() {
            string_opt(&payload, "apiKey")
        } else {
            existing_profile
                .as_ref()
                .and_then(|profile| profile.api_key.clone())
        },
        api_key_env: if payload.get("apiKeyEnv").is_some() {
            string_opt(&payload, "apiKeyEnv")
        } else {
            existing_profile
                .as_ref()
                .and_then(|profile| profile.api_key_env.clone())
        },
        auth_header: if payload.get("authHeader").is_some() {
            string_opt(&payload, "authHeader").or(default_auth_header)
        } else {
            existing_profile
                .as_ref()
                .and_then(|profile| profile.auth_header.clone())
                .or(default_auth_header)
        },
        embedding_model: string_opt(&payload, "embeddingModel")
            .or_else(|| string_opt(&payload, "embedding_model"))
            .or_else(|| {
                existing_profile
                    .as_ref()
                    .and_then(|profile| profile.embedding_model.clone())
            }),
        models,
    };
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    state.config.providers.insert(profile_name.clone(), profile);
    if payload
        .get("setDefault")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        state.config.default_provider = Some(profile_name);
        if default_model.is_some() {
            state.config.default_model = default_model;
        }
    }
    state.save_state()?;
    drop(state);
    read_config()
}

fn default_auth_header_for_route(
    route: &providers::types::ProviderRouteDescriptor,
) -> Option<String> {
    match route.auth_kind.as_str() {
        "api-key" => Some("api-key".to_string()),
        _ => None,
    }
}

pub(crate) fn update_provider_options(payload: Value) -> AgentRuntimeResult<Value> {
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    if payload.get("reasoningEffort").is_some() {
        state.config.reasoning_effort = string_opt(&payload, "reasoningEffort");
    }
    if payload.get("serviceTier").is_some() {
        state.config.service_tier = string_opt(&payload, "serviceTier");
    }
    if payload.get("verbosity").is_some() {
        state.config.verbosity = string_opt(&payload, "verbosity");
    }
    state.save_state()?;
    drop(state);
    list_models(payload)
}

pub(crate) fn list_models(payload: Value) -> AgentRuntimeResult<Value> {
    let state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    model_catalog_for_config(&state.config, payload)
}

pub(crate) fn model_catalog_for_config(
    config: &NativeConfig,
    payload: Value,
) -> AgentRuntimeResult<Value> {
    let current_provider = config.default_provider.clone().unwrap_or_default();
    let current_model = config
        .default_model
        .clone()
        .or_else(|| {
            if current_provider.is_empty() {
                None
            } else {
                config
                    .providers
                    .get(&current_provider)
                    .and_then(|provider| provider.default_model.clone())
            }
        })
        .unwrap_or_default();
    let mut models = Vec::new();
    let mut routes = Vec::new();
    for provider in config.providers.values() {
        let route = providers::registry::require_route(&provider.route_id)?;
        let available = providers::capabilities::provider_profile_available(provider, &route);
        if !available || provider.models.is_empty() {
            continue;
        }
        for model in provider.models.clone() {
            let selected = provider.id == current_provider && model.id == current_model;
            models.push(json!({
                "id": model.id,
                "label": model.label.clone().unwrap_or_else(|| model.id.clone()),
                "model": model.id,
                "provider": provider.id,
                "providerId": provider.id,
                "providerLabel": provider.label,
                "providerKey": provider.id,
                "routeId": provider.route_id,
                "protocolId": route.protocol_id,
                "protocolFamily": route.protocol_family,
                "apiMethod": route.api_method,
                "detail": provider.base_url,
                "contextWindow": model.context_window,
                "supportsImageInput": model.supports_image_input,
                "supportsToolCalling": model.supports_tool_calling,
                "supportsStreaming": model.supports_streaming,
                "embeddingModel": provider.embedding_model,
                "available": available,
                "enabled": model.enabled,
                "selected": selected,
            }));
            if model.enabled {
                routes.push(json!({
                    "model": model.id,
                    "provider": provider.id,
                    "routeId": provider.route_id,
                    "protocolId": route.protocol_id,
                    "protocolFamily": route.protocol_family,
                    "apiMethod": route.api_method,
                    "embeddingModel": provider.embedding_model,
                    "available": available,
                    "detail": provider.base_url.clone().unwrap_or_else(|| "base URL not configured".to_string())
                }));
            }
        }
    }
    Ok(json!({
        "sessionId": payload.get("sessionId").cloned().unwrap_or(Value::Null),
        "currentModel": current_model,
        "currentProvider": current_provider,
        "defaultModel": config.default_model,
        "defaultProvider": config.default_provider,
        "models": models,
        "routes": routes,
        "reasoningEffort": option_state(config.reasoning_effort.clone(), &["none", "low", "medium", "high", "xhigh"]),
        "verbosity": option_state(config.verbosity.clone(), &["low", "medium", "high"]),
        "serviceTier": option_state(config.service_tier.clone(), &["auto", "default", "flex"]),
    }))
}

pub(crate) fn switch_model(payload: Value) -> AgentRuntimeResult<Value> {
    let model = string_opt(&payload, "model")
        .ok_or_else(|| AgentRuntimeError::Core("model is required".to_string()))?;
    let provider = string_opt(&payload, "provider");
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    state.config.default_model = Some(model);
    if let Some(provider) = provider {
        state.config.default_provider = Some(provider);
    }
    state.save_state()?;
    drop(state);
    list_models(payload)
}

pub(crate) fn set_model_enabled(payload: Value) -> AgentRuntimeResult<Value> {
    let provider_id = string_opt(&payload, "provider")
        .ok_or_else(|| AgentRuntimeError::Core("provider is required".to_string()))?;
    let model_id = string_opt(&payload, "model")
        .ok_or_else(|| AgentRuntimeError::Core("model is required".to_string()))?;
    let enabled = payload
        .get("enabled")
        .and_then(Value::as_bool)
        .ok_or_else(|| AgentRuntimeError::Core("enabled is required".to_string()))?;
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let provider = state
        .config
        .providers
        .get_mut(&provider_id)
        .ok_or_else(|| {
            AgentRuntimeError::Core(format!("provider {provider_id} is not configured"))
        })?;
    let model = provider
        .models
        .iter_mut()
        .find(|entry| entry.id == model_id)
        .ok_or_else(|| AgentRuntimeError::Core(format!("model {model_id} is not configured")))?;
    model.enabled = enabled;
    state.save_state()?;
    drop(state);
    list_models(payload)
}

pub(crate) fn delete_model(payload: Value) -> AgentRuntimeResult<Value> {
    let provider_id = string_opt(&payload, "provider")
        .ok_or_else(|| AgentRuntimeError::Core("provider is required".to_string()))?;
    let model_id = string_opt(&payload, "model")
        .ok_or_else(|| AgentRuntimeError::Core("model is required".to_string()))?;
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let provider = state
        .config
        .providers
        .get_mut(&provider_id)
        .ok_or_else(|| {
            AgentRuntimeError::Core(format!("provider {provider_id} is not configured"))
        })?;
    let previous_len = provider.models.len();
    provider.models.retain(|entry| entry.id != model_id);
    if provider.models.len() == previous_len {
        return Err(AgentRuntimeError::Core(format!(
            "model {model_id} is not configured"
        )));
    }
    if provider.default_model.as_deref() == Some(model_id.as_str()) {
        provider.default_model = provider.models.first().map(|entry| entry.id.clone());
    }
    let next_provider_default = provider.default_model.clone();
    if state.config.default_provider.as_deref() == Some(provider_id.as_str())
        && state.config.default_model.as_deref() == Some(model_id.as_str())
    {
        state.config.default_model = next_provider_default;
    }
    state.save_state()?;
    drop(state);
    list_models(payload)
}

pub(crate) fn refresh_models(payload: Value) -> AgentRuntimeResult<Value> {
    let provider_id = string_opt(&payload, "provider").or_else(|| {
        state()
            .lock()
            .ok()
            .and_then(|state| state.config.default_provider.clone())
    });
    let Some(provider_id) = provider_id else {
        return list_models(payload);
    };
    let provider = {
        let state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        state.config.providers.get(&provider_id).cloned()
    };
    let Some(provider) = provider else {
        return list_models(payload);
    };
    let route = providers::registry::require_route(&provider.route_id)?;
    if !route.model_discovery_supported {
        return list_models(payload);
    }
    if let Some(hook) = providers::registry::route_model_discovery_hook(&provider.route_id) {
        let models = hook.discover_models(&provider)?;
        return save_refreshed_models(payload, &provider_id, models);
    }
    let client = http_client_builder(Duration::from_secs(30))
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let models = if route.protocol_id == providers::protocol::openai_responses::PROTOCOL_ID {
        providers::protocol::openai_responses::discover_models(&client, &provider)?
    } else if route.protocol_id == providers::protocol::anthropic_messages::PROTOCOL_ID {
        providers::protocol::anthropic_messages::discover_models(&client, &provider)?
    } else if route.protocol_id == providers::protocol::gemini_generate_content::PROTOCOL_ID {
        providers::protocol::gemini_generate_content::discover_models(&client, &provider)?
    } else if route.protocol_id == providers::protocol::aws_bedrock_converse::PROTOCOL_ID {
        providers::protocol::aws_bedrock_converse::discover_models(&client, &provider)?
    } else if route.protocol_id == providers::protocol::openai_chat_completions::PROTOCOL_ID {
        let require_auth = !route.auth_kind.contains("none");
        providers::protocol::openai_common::discover_models(
            &client,
            &provider,
            require_auth,
            providers::protocol::openai_common::ModelDiscoveryScope::CompatibleText,
        )?
    } else if route.protocol_id == providers::protocol::ollama_chat::PROTOCOL_ID {
        providers::protocol::ollama_chat::discover_models(&client, &provider)?
    } else {
        return list_models(payload);
    };
    save_refreshed_models(payload, &provider_id, models)
}

fn save_refreshed_models(
    payload: Value,
    provider_id: &str,
    models: Vec<NativeProviderModel>,
) -> AgentRuntimeResult<Value> {
    if models.is_empty() {
        return list_models(payload);
    }
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    if let Some(profile) = state.config.providers.get_mut(provider_id) {
        profile.models = models;
    }
    state.save_state()?;
    drop(state);
    list_models(payload)
}

pub(crate) fn update_roles(payload: Value) -> AgentRuntimeResult<Value> {
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    for (key, value) in payload.as_object().into_iter().flatten() {
        if let Some(text) = value.as_str() {
            state.config.roles.insert(key.clone(), text.to_string());
        }
    }
    state.save_state()?;
    drop(state);
    read_config()
}

pub(crate) fn list_accounts() -> AgentRuntimeResult<Value> {
    let state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    Ok(accounts_json(&state.config))
}

pub(crate) fn login_account(payload: Value) -> AgentRuntimeResult<Value> {
    let provider = string_opt(&payload, "provider").unwrap_or_else(|| "openai".to_string());
    let label = string_opt(&payload, "label")
        .or_else(|| string_opt(&payload, "profileName"))
        .unwrap_or_else(|| provider.clone());
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    state
        .config
        .accounts
        .retain(|account| account.provider != provider);
    state.config.accounts.push(NativeAccount {
        provider: provider.clone(),
        label,
        kind: "apiKey".to_string(),
        active: true,
        configured: true,
        detail: Some("Configured in Lyra native runtime".to_string()),
    });
    state.config.default_provider = Some(provider);
    state.save_state()?;
    Ok(accounts_json(&state.config))
}

pub(crate) fn login_providers() -> AgentRuntimeResult<Value> {
    let state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let providers = vec![
        login_provider("openai", "OpenAI", "apiKey", true, false, &state.config),
        login_provider(
            "openrouter",
            "OpenRouter",
            "apiKey",
            true,
            false,
            &state.config,
        ),
        login_provider("gmail", "Gmail", "oauth", false, true, &state.config),
        login_provider("mimo", "MiMo", "apiKey", true, false, &state.config),
    ];
    Ok(json!({ "providers": providers, "authStatus": auth_status(&state.config) }))
}

pub(crate) fn start_account_login(payload: Value) -> AgentRuntimeResult<Value> {
    let provider = string_opt(&payload, "provider").unwrap_or_else(|| "openai".to_string());
    let label = string_opt(&payload, "label");
    let auth_kind = if provider == "gmail" {
        "oauth"
    } else {
        "apiKey"
    };
    Ok(json!({
        "provider": provider,
        "label": label,
        "flowId": format!("login-{}", Uuid::new_v4()),
        "authUrl": if auth_kind == "oauth" { Some("Configure Google OAuth credentials in Lyra, then paste the callback code here.".to_string()) } else { None },
        "callbackHint": if auth_kind == "oauth" { Some("Paste the OAuth callback URL or authorization code.".to_string()) } else { None },
        "authKind": auth_kind,
        "instructions": if auth_kind == "oauth" { "Use the Gmail OAuth flow and complete it with the callback value." } else { "Paste an API key to complete provider setup." },
        "requiresCallback": auth_kind == "oauth",
        "requiresApiKey": auth_kind == "apiKey",
    }))
}

pub(crate) fn complete_account_login(payload: Value) -> AgentRuntimeResult<Value> {
    let provider = string_opt(&payload, "provider").unwrap_or_else(|| "openai".to_string());
    if provider != "gmail" {
        let route_id =
            providers::registry::route_id_for_login_provider(&provider).ok_or_else(|| {
                AgentRuntimeError::Core(format!(
                    "provider {provider} does not have a configured login route"
                ))
            })?;
        let _ = save_provider_profile(json!({
            "profileName": provider,
            "routeId": route_id,
            "label": string_opt(&payload, "label").unwrap_or_else(|| provider.clone()),
            "baseUrl": string_opt(&payload, "baseUrl"),
            "defaultModel": string_opt(&payload, "defaultModel"),
            "apiKey": string_opt(&payload, "apiKey"),
            "authHeader": string_opt(&payload, "authHeader"),
            "setDefault": payload.get("setDefault").and_then(Value::as_bool).unwrap_or(true)
        }));
    }
    let accounts = login_account(json!({
        "provider": provider,
        "label": string_opt(&payload, "label").unwrap_or_else(|| provider.clone())
    }))?;
    Ok(json!({ "accounts": accounts, "message": "Account configured." }))
}

pub(crate) fn switch_account(payload: Value) -> AgentRuntimeResult<Value> {
    let provider = string_opt(&payload, "provider")
        .ok_or_else(|| AgentRuntimeError::Core("provider is required".to_string()))?;
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    for account in &mut state.config.accounts {
        account.active = account.provider == provider;
    }
    state.config.default_provider = Some(provider);
    state.save_state()?;
    Ok(accounts_json(&state.config))
}

pub(crate) fn remove_account(payload: Value) -> AgentRuntimeResult<Value> {
    let provider = string_opt(&payload, "provider")
        .ok_or_else(|| AgentRuntimeError::Core("provider is required".to_string()))?;
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    state
        .config
        .accounts
        .retain(|account| account.provider != provider);
    state.save_state()?;
    Ok(accounts_json(&state.config))
}
