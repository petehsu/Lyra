use super::*;

const REMOVED_LOGIN_PROVIDERS: &[&str] = &["gmail"];

fn visible_default_provider(config: &NativeConfig) -> Option<&String> {
    config
        .default_provider
        .as_ref()
        .filter(|provider| !REMOVED_LOGIN_PROVIDERS.contains(&provider.as_str()))
}

pub(crate) fn user_message(text: String, images: Vec<Value>, created_at: String) -> Value {
    let mut blocks = Vec::new();
    if !text.trim().is_empty() {
        blocks.push(json!({ "type": "text", "id": "text-0", "text": text }));
    }
    for (index, image) in images.into_iter().enumerate() {
        blocks.push(json!({
            "type": "image",
            "id": format!("image-{index}"),
            "mediaType": image.get("mediaType").or_else(|| image.get("media_type")).cloned().unwrap_or_else(|| Value::String("image/png".to_string())),
            "data": image.get("data").cloned().unwrap_or(Value::Null),
            "label": image.get("label").cloned().unwrap_or(Value::Null),
            "source": image.get("source").cloned().unwrap_or(Value::Null),
            "width": image.get("width").cloned().unwrap_or(Value::Null),
            "height": image.get("height").cloned().unwrap_or(Value::Null),
        }));
    }
    let mut message = json!({
        "id": format!("message-{}", Uuid::new_v4()),
        "role": "user",
        "text": text,
        "blocks": blocks,
        "createdAt": created_at,
        "rollback": { "available": false, "unavailableReason": "No checkpoint was captured for this message." }
    });
    super::pinned_context::stamp_message_timestamps(&mut message, Some(created_at.as_str()));
    message
}

pub(crate) fn assistant_message(text: String) -> Value {
    assistant_message_with_id(format!("message-{}", Uuid::new_v4()), text)
}

pub(crate) fn assistant_message_with_id(id: String, text: String) -> Value {
    let timestamp = now();
    let mut message = json!({
        "id": id,
        "role": "assistant",
        "text": text,
        "blocks": [{ "type": "text", "id": "text-0", "text": text }],
        "createdAt": timestamp
    });
    super::pinned_context::stamp_message_timestamps(&mut message, Some(timestamp.as_str()));
    message
}

pub(crate) fn assistant_message_with_metadata(text: String, metadata: Option<Value>) -> Value {
    let mut message = assistant_message(text);
    if let Some(metadata) = metadata.filter(|value| !value.is_null()) {
        message["metadata"] = metadata;
    }
    message
}

pub(crate) fn session_summary(session: &NativeSession) -> Value {
    let snapshot = &session.snapshot;
    let title = snapshot
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or(DEFAULT_SESSION_TITLE);
    let updated = snapshot
        .get("updatedAt")
        .and_then(Value::as_str)
        .unwrap_or(&session.created_at);
    let status = if session.archived {
        "archived"
    } else {
        snapshot
            .get("turnStatus")
            .and_then(Value::as_str)
            .unwrap_or("idle")
    };
    json!({
        "id": session.id,
        "title": title,
        "sessionKind": snapshot.get("sessionKind").cloned().unwrap_or_else(|| Value::String("normal".to_string())),
        "customTitle": session.custom_title,
        "shortName": session.short_name,
        "status": status,
        "providerKey": Value::Null,
        "providerLabel": Value::Null,
        "model": Value::Null,
        "messageCount": snapshot.get("messages").and_then(Value::as_array).map(Vec::len).unwrap_or(0),
        "createdAt": session.created_at,
        "updatedAt": updated,
        "lastActiveAt": updated,
        "saved": session.saved,
        "saveLabel": session.save_label,
        "archived": session.archived,
        "workingDir": snapshot.get("workingDir").cloned().unwrap_or(Value::Null),
    })
}

pub(crate) fn runtime_turn(
    turn_id: &str,
    session_id: &str,
    state: &str,
    user_message_id: Option<String>,
    parent: Option<String>,
) -> Value {
    let timestamp = now();
    json!({
        "runtimeTurnId": turn_id,
        "sessionId": session_id,
        "parentRuntimeTurnId": parent,
        "userMessageId": user_message_id,
        "state": state,
        "startedAtMs": Utc::now().timestamp_millis(),
        "startedAtIso": timestamp,
        "updatedAtMs": Utc::now().timestamp_millis(),
        "updatedAtIso": timestamp,
        "completedAtMs": Value::Null,
        "completedAtIso": Value::Null,
        "failureKind": Value::Null,
        "failureDetailRef": Value::Null,
        "latestUserIntentRef": Value::Null,
        "activeTaskRef": Value::Null,
        "providerRequestRef": Value::Null,
        "contextSnapshotRef": Value::Null,
        "completionAuditRef": Value::Null
    })
}

pub(crate) fn config_json(config: &NativeConfig) -> Value {
    let providers = config
        .providers
        .iter()
        .map(|(id, provider)| {
            let route = providers::registry::require_route(&provider.route_id)
                .expect("default provider routes must be valid");
            (
                id.clone(),
                json!({
                    "label": provider.label,
                    "routeId": provider.route_id,
                    "protocolId": route.protocol_id,
                    "protocolFamily": route.protocol_family,
                    "baseUrl": provider.base_url,
                    "defaultModel": provider.default_model,
                    "embeddingModel": provider.embedding_model,
                    "requiresApiKey": providers::capabilities::provider_requires_api_key(provider, &route),
                    "models": provider.models
                }),
            )
        })
        .collect::<Map<_, _>>();
    json!({
        "provider": {
            "defaultProvider": config.default_provider,
            "defaultModel": config.default_model,
        },
        "providers": providers,
        "options": {
            "reasoningEffort": config.reasoning_effort,
            "serviceTier": config.service_tier,
            "verbosity": config.verbosity,
        },
        "promptDelivery": {
            "mode": config.prompt_delivery_mode.as_deref().unwrap_or("full"),
            "leanExperimental": config.prompt_delivery_mode.as_deref() == Some("lean-experimental"),
            "openaiResponsesStatefulPromptContract": config.openai_responses_stateful_prompt_contract,
        },
        "proactive": {
            "enabled": config.proactive_enabled,
            "disabledTriggers": config.proactive_disabled_triggers,
        },
    })
}

pub(crate) fn registered_commands() -> Vec<Value> {
    [
        ("/model", "Switch the active model"),
        ("/save", "Save the active session"),
        ("/rename", "Rename the active session"),
        ("/memory", "Search or update Lyra memory"),
        ("/review", "Review the current work"),
    ]
    .into_iter()
    .map(|(name, help)| {
        json!({
            "name": name,
            "help": help,
            "autocomplete": true,
            "remoteOnly": false
        })
    })
    .collect()
}

pub(crate) fn accounts_json(config: &NativeConfig) -> Value {
    let accounts = config
        .accounts
        .iter()
        .filter(|account| !REMOVED_LOGIN_PROVIDERS.contains(&account.provider.as_str()))
        .collect::<Vec<_>>();
    json!({
        "defaultProvider": visible_default_provider(config),
        "defaultModel": config.default_model,
        "authStatus": auth_status(config),
        "accounts": accounts,
    })
}

pub(crate) fn auth_status(config: &NativeConfig) -> Value {
    let configured = config
        .providers
        .values()
        .filter(|provider| {
            providers::registry::require_route(&provider.route_id)
                .map(|route| providers::capabilities::provider_profile_available(provider, &route))
                .unwrap_or(false)
        })
        .map(|provider| provider.id.clone())
        .collect::<Vec<_>>();
    json!({
        "configuredProviders": configured,
        "defaultProvider": visible_default_provider(config),
    })
}

pub(crate) fn login_provider(
    id: &str,
    display_name: &str,
    auth_kind: &str,
    requires_api_key: bool,
    requires_callback: bool,
    config: &NativeConfig,
) -> Value {
    let configured = config
        .accounts
        .iter()
        .any(|account| account.provider == id && account.configured)
        || config
            .providers
            .get(id)
            .and_then(provider_api_key)
            .is_some();
    json!({
        "id": id,
        "displayName": display_name,
        "authKind": auth_kind,
        "statusMethod": "lyra-native",
        "detail": if configured { "Configured" } else { "Not configured" },
        "recommended": id == "openai",
        "configured": configured,
        "state": if configured { "configured" } else { "available" },
        "requiresCallback": requires_callback,
        "requiresApiKey": requires_api_key,
    })
}

pub(crate) fn option_state(current: Option<String>, options: &[&str], supported: bool) -> Value {
    json!({
        "current": current,
        "options": options,
        "supported": supported,
    })
}

pub(crate) fn provider_label(config: &NativeConfig) -> Option<String> {
    let id = config.default_provider.as_ref()?;
    config
        .providers
        .get(id)
        .map(|provider| provider.label.clone())
}

pub(crate) fn provider_api_key(provider: &NativeProviderProfile) -> Option<String> {
    provider
        .api_key
        .clone()
        .or_else(|| {
            provider
                .api_key_env
                .as_ref()
                .and_then(|key| env::var(key).ok())
        })
        .filter(|value| !value.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accounts_json_hides_removed_login_providers() {
        let config = NativeConfig {
            default_provider: Some("gmail".to_string()),
            accounts: vec![NativeAccount {
                provider: "gmail".to_string(),
                label: "Removed provider".to_string(),
                kind: "oauth".to_string(),
                active: true,
                configured: true,
                detail: None,
            }],
            ..NativeConfig::default()
        };

        let value = accounts_json(&config);

        assert!(value["accounts"].as_array().expect("accounts").is_empty());
        assert!(value["defaultProvider"].is_null());
        assert!(value["authStatus"]["defaultProvider"].is_null());
    }
}
