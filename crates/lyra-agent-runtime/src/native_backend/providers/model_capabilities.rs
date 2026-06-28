use std::collections::HashMap;

use serde_json::{Value, json};

use crate::{
    AgentRuntimeError, AgentRuntimeResult,
    native_backend::{NativeProviderModel, activity::emit_context_trimmed, state},
};

use super::{registry, types::ProviderRouteDescriptor};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ObservedCapability {
    ImageInput,
    ToolCalling,
    Streaming,
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
            model.context_window = model.context_window.or(previous.context_window);
            if model.label.as_deref().unwrap_or("").trim().is_empty() {
                model.label = previous.label.clone();
            }
            model.enabled = previous.enabled;
            model
        })
        .collect()
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
    let message = error.to_string().to_ascii_lowercase();
    message.contains("support image input")
        || message.contains("image input")
            && (message.contains("not support")
                || message.contains("unsupported")
                || message.contains("does not support")
                || message.contains("no endpoints found"))
        || message.contains("vision")
            && (message.contains("not support") || message.contains("unsupported"))
        || message.contains("multimodal")
            && (message.contains("not support") || message.contains("unsupported"))
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

    #[test]
    fn image_input_error_detection_matches_provider_rejection() {
        let error = AgentRuntimeError::Core(
            "provider request failed with status 404 Not Found: {\"error\":{\"message\":\"No endpoints found that support image input\"}}".to_string(),
        );
        assert!(is_image_input_unsupported_error(&error));
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
