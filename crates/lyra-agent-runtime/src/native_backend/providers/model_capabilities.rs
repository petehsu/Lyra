use std::collections::HashMap;

use serde_json::{Value, json};

use crate::{
    AgentRuntimeError, AgentRuntimeResult, ProviderFailureCategory,
    native_backend::{
        NativeProviderModel, NativeProviderProfile, ReasoningReplayField,
        activity::emit_context_trimmed, state,
    },
};

use super::{registry, types::ProviderRouteDescriptor};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ObservedCapability {
    ImageInput,
    ToolCalling,
    Streaming,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct OpenAiChatModelCapabilities {
    pub(crate) reasoning_replay_field: ReasoningReplayField,
    pub(crate) requires_reasoning_field_on_assistant_messages: bool,
    pub(crate) supports_tool_choice: bool,
}

impl Default for OpenAiChatModelCapabilities {
    fn default() -> Self {
        Self {
            reasoning_replay_field: ReasoningReplayField::None,
            requires_reasoning_field_on_assistant_messages: false,
            // Unknown OpenAI-compatible routes are not guaranteed to support
            // forced tool choice. Exact built-ins or explicit model settings
            // opt in below.
            supports_tool_choice: false,
        }
    }
}

pub(crate) fn discovered_model(
    id: impl Into<String>,
    label: Option<String>,
    context_window: Option<usize>,
    route: Option<&ProviderRouteDescriptor>,
) -> NativeProviderModel {
    let (supports_tool_calling, supports_streaming) = protocol_capability_defaults(route);
    NativeProviderModel {
        id: id.into(),
        label,
        context_window,
        supports_image_input: false,
        supports_tool_calling,
        supports_streaming,
        supports_reasoning_effort: None,
        reasoning_replay_field: ReasoningReplayField::Auto,
        requires_reasoning_field_on_assistant_messages: None,
        supports_tool_choice: None,
        enabled: true,
    }
}

pub(crate) fn merge_discovered_models(
    existing: &[NativeProviderModel],
    discovered: Vec<NativeProviderModel>,
) -> Vec<NativeProviderModel> {
    let existing_by_id = existing
        .iter()
        .map(|model| (model.id.as_str(), model))
        .collect::<HashMap<_, _>>();
    discovered
        .into_iter()
        .map(|mut model| {
            let Some(previous) = existing_by_id.get(model.id.as_str()) else {
                return model;
            };
            model.supports_image_input = previous.supports_image_input;
            model.supports_tool_calling = previous.supports_tool_calling;
            model.supports_streaming = previous.supports_streaming;
            model.supports_reasoning_effort = previous.supports_reasoning_effort;
            model.reasoning_replay_field = previous.reasoning_replay_field;
            model.requires_reasoning_field_on_assistant_messages =
                previous.requires_reasoning_field_on_assistant_messages;
            model.supports_tool_choice = previous.supports_tool_choice;
            model.context_window = model.context_window.or(previous.context_window);
            if model.label.as_deref().unwrap_or("").trim().is_empty() {
                model.label = previous.label.clone();
            }
            model.enabled = previous.enabled;
            model
        })
        .collect()
}

pub(crate) fn resolve_openai_chat_model_capabilities(
    provider: &NativeProviderProfile,
    model_id: &str,
) -> OpenAiChatModelCapabilities {
    let mut resolved = builtin_openai_chat_model_capabilities(provider, model_id);
    let Some(model) = provider.models.iter().find(|model| model.id == model_id) else {
        return resolved;
    };
    if model.reasoning_replay_field != ReasoningReplayField::Auto {
        resolved.reasoning_replay_field = model.reasoning_replay_field;
    }
    if let Some(required) = model.requires_reasoning_field_on_assistant_messages {
        resolved.requires_reasoning_field_on_assistant_messages = required;
    }
    if let Some(supported) = model.supports_tool_choice {
        resolved.supports_tool_choice = supported;
    }
    resolved
}

fn builtin_openai_chat_model_capabilities(
    provider: &NativeProviderProfile,
    model_id: &str,
) -> OpenAiChatModelCapabilities {
    let reasoning_content_required = OpenAiChatModelCapabilities {
        reasoning_replay_field: ReasoningReplayField::ReasoningContent,
        requires_reasoning_field_on_assistant_messages: true,
        supports_tool_choice: true,
    };
    if provider.id == "opencode-free"
        && matches!(model_id, "deepseek-v4-flash" | "deepseek-v4-flash-free")
    {
        return OpenAiChatModelCapabilities {
            supports_tool_choice: false,
            ..reasoning_content_required
        };
    }
    if provider.route_id == super::routes::deepseek::OPENAI_ROUTE_ID
        && matches!(
            model_id,
            "deepseek-reasoner" | "deepseek-v4-flash" | "deepseek-v4-pro"
        )
    {
        return OpenAiChatModelCapabilities {
            supports_tool_choice: !matches!(model_id, "deepseek-v4-flash" | "deepseek-v4-pro"),
            ..reasoning_content_required
        };
    }
    if super::routes::mimo::is_mimo_route(&provider.route_id)
        && matches!(
            model_id,
            "mimo-auto"
                | "mimo-v2.5"
                | "mimo-v2.5-free"
                | "mimo-v2.5-pro"
                | "mimo-v2.5-pro-free"
                | "mimo-v2-pro"
                | "mimo-v2-pro-free"
                | "mimo-v2-omni"
                | "mimo-v2-omni-free"
                | "mimo-v2-flash"
                | "mimo-v2-flash-free"
        )
    {
        return reasoning_content_required;
    }
    OpenAiChatModelCapabilities::default()
}

pub(crate) fn record_observed_model_capability(
    session_id: &str,
    provider_id: &str,
    model_id: &str,
    capability: ObservedCapability,
    supported: bool,
    evidence: &str,
) -> AgentRuntimeResult<()> {
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let route_id = state
        .config
        .providers
        .get(provider_id)
        .map(|profile| profile.route_id.clone());
    let Some(route_id) = route_id else {
        return Ok(());
    };
    let route = registry::require_route(&route_id)?;
    if let Some(model) = state
        .config
        .providers
        .get_mut(provider_id)
        .and_then(|profile| profile.models.iter_mut().find(|model| model.id == model_id))
    {
        apply_observed_capability(model, capability, supported);
    } else if let Some(profile) = state.config.providers.get_mut(provider_id) {
        let mut model = discovered_model(
            model_id.to_string(),
            Some(model_id.to_string()),
            None,
            Some(&route),
        );
        apply_observed_capability(&mut model, capability, supported);
        profile.models.push(model);
    }
    state.save_state()?;
    drop(state);
    emit_context_trimmed(
        session_id,
        json!({
            "reason": "model_capability_observed",
            "providerId": provider_id,
            "modelId": model_id,
            "capability": capability_label(capability),
            "supported": supported,
            "evidence": evidence,
        }),
    );
    Ok(())
}

pub(crate) fn is_image_input_unsupported_error(error: &AgentRuntimeError) -> bool {
    let AgentRuntimeError::ProviderFailure { failure } = error else {
        return false;
    };
    if failure.category != ProviderFailureCategory::Capability {
        return false;
    }
    let stable_id = failure
        .provider_code
        .as_deref()
        .or(failure.provider_type.as_deref())
        .map(|value| value.trim().to_ascii_lowercase());
    matches!(
        stable_id.as_deref(),
        Some(
            "image_input_unsupported"
                | "unsupported_image_input"
                | "unsupported_multimodal_input"
                | "vision_not_supported"
        )
    )
}

pub(crate) fn messages_contain_provider_images(messages: &[Value]) -> bool {
    messages.iter().any(message_contains_provider_image)
}

pub(crate) fn strip_images_from_provider_messages(
    messages: Vec<Value>,
) -> (Vec<Value>, Vec<Value>) {
    let mut downgrades = Vec::new();
    let stripped = messages
        .into_iter()
        .map(|message| strip_images_from_provider_message(message, &mut downgrades))
        .collect();
    (stripped, downgrades)
}

fn protocol_capability_defaults(route: Option<&ProviderRouteDescriptor>) -> (bool, bool) {
    let Some(route) = route else {
        return (false, false);
    };
    registry::protocol_catalog()
        .into_iter()
        .find(|entry| entry.id == route.protocol_id)
        .map(|entry| (entry.tool_calling_supported, entry.streaming_supported))
        .unwrap_or((false, false))
}

fn apply_observed_capability(
    model: &mut NativeProviderModel,
    capability: ObservedCapability,
    supported: bool,
) {
    match capability {
        ObservedCapability::ImageInput => model.supports_image_input = supported,
        ObservedCapability::ToolCalling => model.supports_tool_calling = supported,
        ObservedCapability::Streaming => model.supports_streaming = supported,
    }
}

fn capability_label(capability: ObservedCapability) -> &'static str {
    match capability {
        ObservedCapability::ImageInput => "supportsImageInput",
        ObservedCapability::ToolCalling => "supportsToolCalling",
        ObservedCapability::Streaming => "supportsStreaming",
    }
}

fn message_contains_provider_image(message: &Value) -> bool {
    match message.get("content") {
        Some(Value::Array(parts)) => parts
            .iter()
            .any(|part| part.get("type").and_then(Value::as_str) == Some("image_url")),
        _ => false,
    }
}

fn strip_images_from_provider_message(mut message: Value, downgrades: &mut Vec<Value>) -> Value {
    let message_id = message.get("id").cloned().unwrap_or(Value::Null);
    let Some(content) = message.get_mut("content") else {
        return message;
    };
    let Value::Array(parts) = content else {
        return message;
    };
    let mut next_parts = Vec::new();
    for part in parts.iter() {
        if part.get("type").and_then(Value::as_str) == Some("image_url") {
            downgrades.push(json!({
                "messageId": message_id,
                "reason": "provider_rejected_image_input",
                "source": "runtime_retry",
            }));
            next_parts.push(json!({
                "type": "text",
                "text": "[Image omitted: provider_rejected_image_input]",
            }));
            continue;
        }
        next_parts.push(part.clone());
    }
    message["content"] = Value::Array(next_parts);
    message
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ProviderFailure;

    #[test]
    fn image_input_error_detection_matches_provider_rejection() {
        let error = AgentRuntimeError::ProviderFailure {
            failure: ProviderFailure {
                provider_id: "test".to_string(),
                route_id: "test".to_string(),
                http_status: Some(400),
                provider_code: Some("image_input_unsupported".to_string()),
                provider_type: None,
                retry_after_ms: None,
                category: ProviderFailureCategory::Capability,
                message: "image input rejected".to_string(),
                body_preview: None,
            },
        };
        assert!(is_image_input_unsupported_error(&error));
    }

    #[test]
    fn unrelated_capability_errors_do_not_disable_image_input() {
        let error = AgentRuntimeError::ProviderFailure {
            failure: ProviderFailure {
                provider_id: "test".to_string(),
                route_id: "test".to_string(),
                http_status: Some(400),
                provider_code: Some("tool_calling_unsupported".to_string()),
                provider_type: None,
                retry_after_ms: None,
                category: ProviderFailureCategory::Capability,
                message: "tool calling rejected".to_string(),
                body_preview: None,
            },
        };
        assert!(!is_image_input_unsupported_error(&error));
    }

    #[test]
    fn merge_discovered_models_preserves_learned_capabilities() {
        let existing = vec![NativeProviderModel {
            id: "mimo-v2.5-pro".to_string(),
            label: Some("MiMo v2.5 Pro".to_string()),
            context_window: None,
            supports_image_input: false,
            supports_tool_calling: true,
            supports_streaming: true,
            supports_reasoning_effort: None,
            reasoning_replay_field: ReasoningReplayField::ReasoningContent,
            requires_reasoning_field_on_assistant_messages: Some(true),
            supports_tool_choice: Some(false),
            enabled: true,
        }];
        let discovered = vec![discovered_model(
            "mimo-v2.5-pro",
            Some("mimo-v2.5-pro".to_string()),
            None,
            None,
        )];
        let merged = merge_discovered_models(&existing, discovered);
        assert_eq!(merged.len(), 1);
        assert!(!merged[0].supports_image_input);
        assert!(merged[0].supports_tool_calling);
        assert_eq!(
            merged[0].reasoning_replay_field,
            ReasoningReplayField::ReasoningContent
        );
        assert_eq!(
            merged[0].requires_reasoning_field_on_assistant_messages,
            Some(true)
        );
        assert_eq!(merged[0].supports_tool_choice, Some(false));
    }

    #[test]
    fn opencode_deepseek_builtin_is_exact_and_explicit_model_fields_win() {
        let mut provider = NativeProviderProfile {
            id: "opencode-free".to_string(),
            label: "OpenCode Free".to_string(),
            route_id: super::super::routes::custom_openai_compatible::ROUTE_ID.to_string(),
            base_url: Some("https://opencode.ai/zen/v1".to_string()),
            default_model: Some("deepseek-v4-flash-free".to_string()),
            api_key: None,
            api_key_ref: None,
            api_key_env: None,
            auth_header: None,
            embedding_model: None,
            models: Vec::new(),
        };
        let builtin = resolve_openai_chat_model_capabilities(&provider, "deepseek-v4-flash-free");
        assert_eq!(
            builtin.reasoning_replay_field,
            ReasoningReplayField::ReasoningContent
        );
        assert!(builtin.requires_reasoning_field_on_assistant_messages);
        assert!(!builtin.supports_tool_choice);
        assert_eq!(
            resolve_openai_chat_model_capabilities(
                &provider,
                "vendor/deepseek-v4-flash-free-preview"
            ),
            OpenAiChatModelCapabilities::default()
        );

        let mut explicit = discovered_model(
            "deepseek-v4-flash-free",
            Some("DeepSeek V4 Flash Free".to_string()),
            None,
            None,
        );
        explicit.reasoning_replay_field = ReasoningReplayField::None;
        explicit.requires_reasoning_field_on_assistant_messages = Some(false);
        explicit.supports_tool_choice = Some(true);
        provider.models.push(explicit);
        let resolved = resolve_openai_chat_model_capabilities(&provider, "deepseek-v4-flash-free");
        assert_eq!(resolved.reasoning_replay_field, ReasoningReplayField::None);
        assert!(!resolved.requires_reasoning_field_on_assistant_messages);
        assert!(resolved.supports_tool_choice);
    }

    #[test]
    fn unknown_openai_compatible_model_does_not_assume_forced_tool_choice() {
        let provider = NativeProviderProfile {
            id: "custom".to_string(),
            label: "Custom".to_string(),
            route_id: super::super::routes::custom_openai_compatible::ROUTE_ID.to_string(),
            base_url: Some("https://example.invalid/v1".to_string()),
            default_model: Some("unknown-model".to_string()),
            api_key: None,
            api_key_ref: None,
            api_key_env: None,
            auth_header: None,
            embedding_model: None,
            models: Vec::new(),
        };

        assert!(
            !resolve_openai_chat_model_capabilities(&provider, "unknown-model")
                .supports_tool_choice
        );
    }

    #[test]
    fn legacy_model_json_defaults_new_protocol_capabilities() {
        let model: NativeProviderModel = serde_json::from_value(json!({
            "id": "legacy-model",
            "label": null,
            "contextWindow": null,
            "supportsImageInput": false,
            "supportsToolCalling": true,
            "supportsStreaming": true,
            "enabled": true
        }))
        .expect("legacy provider model");
        assert_eq!(model.reasoning_replay_field, ReasoningReplayField::Auto);
        assert_eq!(model.requires_reasoning_field_on_assistant_messages, None);
        assert_eq!(model.supports_tool_choice, None);
        let serialized = serde_json::to_value(model).expect("serialize model");
        assert_eq!(serialized["reasoningReplayField"], "auto");
    }

    #[test]
    fn strip_images_from_provider_messages_replaces_image_blocks() {
        let (messages, downgrades) = strip_images_from_provider_messages(vec![json!({
            "role": "user",
            "content": [
                { "type": "text", "text": "see this" },
                { "type": "image_url", "image_url": { "url": "data:image/png;base64,abc" } }
            ]
        })]);
        assert_eq!(downgrades.len(), 1);
        let parts = messages[0]["content"].as_array().unwrap();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[1]["type"], "text");
        assert!(
            parts[1]["text"]
                .as_str()
                .unwrap()
                .contains("provider_rejected_image_input")
        );
    }
}
