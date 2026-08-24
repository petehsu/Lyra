use std::collections::HashMap;

use serde_json::{Value, json};

use crate::{
    AgentRuntimeError, ProviderFailureCategory,
    native_backend::{NativeProviderModel, NativeProviderProfile, ReasoningReplayField},
};

use super::{registry, types::ProviderRouteDescriptor};

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

/// Heuristic: infer image/vision input support from model ID naming conventions.
/// Returns true for known multimodal model families. Conservative — only matches
/// well-documented naming patterns. Unknown models default to false.
///
/// Evidence:
/// - MiMo V2.5 base supports image/video/voice (official announcement 2026-04);
///   MiMo V2.5 Pro does NOT support vision yet.
/// - MiMo V2 Omni is full multimodal ("看得见、听得懂、能动手").
/// - MiMo Auto routes to best available model including vision.
/// - "-vl" / "-vision" / "-omni" suffixes are conventional multimodal labels.
pub(crate) fn infer_image_input_from_model_id(model_id: &str) -> bool {
    let id = model_id.trim().to_ascii_lowercase();
    if id.is_empty() {
        return false;
    }
    // Exclude audio-only and non-text variants
    if id.contains("-tts")
        || id.contains("-asr")
        || id.contains("embedding")
        || id.contains("moderation")
        || id.contains("rerank")
    {
        return false;
    }
    // MiMo Auto — routes to best model including vision
    if id == "mimo-auto" {
        return true;
    }
    // MiMo V2.5 base + free tier — multimodal (image/video/voice).
    // Pro variant does NOT support vision yet — excluded by the negative check.
    if id.starts_with("mimo-v2.5") && !id.starts_with("mimo-v2.5-pro") {
        return true;
    }
    // MiMo V2 Omni — full multimodal
    if id.starts_with("mimo-v2-omni") {
        return true;
    }
    // General multimodal naming conventions across providers
    if id.contains("-omni") || id.contains("-vl") || id.contains("-vision") {
        return true;
    }
    false
}

/// Restore tool calling / streaming on persisted models that were marked false
/// by missing-field defaults and stale catalog saves.
pub(crate) fn recover_optimistic_agent_capabilities(models: &mut [NativeProviderModel]) {
    for model in models.iter_mut() {
        if looks_like_non_agent_model(&model.id) {
            continue;
        }
        model.supports_tool_calling = true;
        model.supports_streaming = true;
    }
}

fn looks_like_non_agent_model(model_id: &str) -> bool {
    let id = model_id.trim().to_ascii_lowercase();
    id.contains("embedding")
        || id.contains("-tts")
        || id.contains("-asr")
        || id.contains("moderation")
        || id.contains("rerank")
}

pub(crate) fn discovered_model(
    id: impl Into<String>,
    label: Option<String>,
    context_window: Option<usize>,
    route: Option<&ProviderRouteDescriptor>,
    api_modalities: Option<&[String]>,
) -> NativeProviderModel {
    let (supports_tool_calling, supports_streaming) = protocol_capability_defaults(route);
    let id_string = id.into();
    // Layer 1: API modality 发现。Layer 2: ID 模式推断（fallback）。
    let supports_image_input = match api_modalities {
        Some(modalities) => modalities.iter().any(|m| m == "image"),
        None => infer_image_input_from_model_id(&id_string),
    };
    NativeProviderModel {
        id: id_string,
        label,
        context_window,
        supports_image_input,
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
            model.supports_image_input =
                previous.supports_image_input || model.supports_image_input;
            model.supports_tool_calling =
                previous.supports_tool_calling || model.supports_tool_calling;
            model.supports_streaming = previous.supports_streaming || model.supports_streaming;
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

/// Migration: upgrade `supports_image_input` from false to true for models whose
/// IDs match known multimodal patterns. Never downgrades true → false.
/// Called on state load to fix persisted models that were incorrectly marked.
pub(crate) fn upgrade_inferred_image_capabilities(models: &mut [NativeProviderModel]) {
    for model in models.iter_mut() {
        if !model.supports_image_input && infer_image_input_from_model_id(&model.id) {
            model.supports_image_input = true;
        }
    }
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

pub(crate) fn protocol_capability_defaults(
    route: Option<&ProviderRouteDescriptor>,
) -> (bool, bool) {
    let Some(route) = route else {
        return (false, false);
    };
    registry::protocol_catalog()
        .into_iter()
        .find(|entry| entry.id == route.protocol_id)
        .map(|entry| (entry.tool_calling_supported, entry.streaming_supported))
        .unwrap_or((false, false))
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
    fn merge_discovered_models_preserves_existing_capabilities() {
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
    fn omitted_tool_and_stream_flags_deserialize_as_true() {
        let model: NativeProviderModel = serde_json::from_value(json!({
            "id": "deepseek-v4-flash",
            "enabled": true
        }))
        .expect("model");
        assert!(model.supports_tool_calling);
        assert!(model.supports_streaming);
        assert!(!model.supports_image_input);
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

    #[test]
    fn infer_image_input_mimo_v2_5_base_and_free() {
        assert!(infer_image_input_from_model_id("mimo-v2.5"));
        assert!(infer_image_input_from_model_id("mimo-v2.5-free"));
        assert!(infer_image_input_from_model_id("MiMo-V2.5-Free"));
    }

    #[test]
    fn infer_image_input_mimo_v2_5_pro_excluded() {
        // Pro variant does NOT support vision yet per official announcement
        assert!(!infer_image_input_from_model_id("mimo-v2.5-pro"));
        assert!(!infer_image_input_from_model_id("mimo-v2.5-pro-free"));
    }

    #[test]
    fn infer_image_input_omni_and_auto() {
        assert!(infer_image_input_from_model_id("mimo-auto"));
        assert!(infer_image_input_from_model_id("mimo-v2-omni"));
        assert!(infer_image_input_from_model_id("mimo-v2-omni-free"));
    }

    #[test]
    fn infer_image_input_excludes_audio_and_unknown() {
        assert!(!infer_image_input_from_model_id("mimo-v2.5-tts"));
        assert!(!infer_image_input_from_model_id("mimo-v2.5-asr"));
        assert!(!infer_image_input_from_model_id("mimo-v2-flash"));
        assert!(!infer_image_input_from_model_id("mimo-v2-pro"));
        assert!(!infer_image_input_from_model_id("unknown-model"));
    }

    #[test]
    fn infer_image_input_conventional_multimodal_suffixes() {
        assert!(infer_image_input_from_model_id("some-model-vl"));
        assert!(infer_image_input_from_model_id("some-model-omni"));
        assert!(infer_image_input_from_model_id("some-model-vision"));
    }

    #[test]
    fn merge_upgrades_false_to_true_for_inferred_multimodal() {
        // Simulates persisted state with supports_image_input: false
        // being merged with a re-discovered model that infers true.
        let existing = vec![NativeProviderModel {
            id: "mimo-v2.5-free".to_string(),
            label: Some("MiMo-V2.5 Free".to_string()),
            context_window: None,
            supports_image_input: false,
            supports_tool_calling: true,
            supports_streaming: true,
            supports_reasoning_effort: None,
            reasoning_replay_field: ReasoningReplayField::Auto,
            requires_reasoning_field_on_assistant_messages: None,
            supports_tool_choice: None,
            enabled: true,
        }];
        let discovered = vec![discovered_model(
            "mimo-v2.5-free",
            Some("mimo-v2.5-free".to_string()),
            None,
            None,
            None,
        )];
        let merged = merge_discovered_models(&existing, discovered);
        assert_eq!(merged.len(), 1);
        // Discovered model infers true → merge upgrades false → true
        assert!(merged[0].supports_image_input);
    }

    #[test]
    fn merge_never_downgrades_true_to_false() {
        let existing = vec![NativeProviderModel {
            id: "mimo-v2-flash".to_string(),
            label: None,
            context_window: None,
            supports_image_input: true, // user confirmed it works
            supports_tool_calling: true,
            supports_streaming: true,
            supports_reasoning_effort: None,
            reasoning_replay_field: ReasoningReplayField::Auto,
            requires_reasoning_field_on_assistant_messages: None,
            supports_tool_choice: None,
            enabled: true,
        }];
        let discovered = vec![discovered_model(
            "mimo-v2-flash",
            Some("mimo-v2-flash".to_string()),
            None,
            None,
            None,
        )];
        let merged = merge_discovered_models(&existing, discovered);
        assert_eq!(merged.len(), 1);
        // Inferred false, but existing true → stays true
        assert!(merged[0].supports_image_input);
    }

    #[test]
    fn upgrade_inferred_image_capabilities_fixes_persisted_false() {
        let mut models = vec![
            NativeProviderModel {
                id: "mimo-v2.5-free".to_string(),
                label: None,
                context_window: None,
                supports_image_input: false,
                supports_tool_calling: true,
                supports_streaming: true,
                supports_reasoning_effort: None,
                reasoning_replay_field: ReasoningReplayField::Auto,
                requires_reasoning_field_on_assistant_messages: None,
                supports_tool_choice: None,
                enabled: true,
            },
            NativeProviderModel {
                id: "mimo-v2.5-pro".to_string(),
                label: None,
                context_window: None,
                supports_image_input: false,
                supports_tool_calling: true,
                supports_streaming: true,
                supports_reasoning_effort: None,
                reasoning_replay_field: ReasoningReplayField::Auto,
                requires_reasoning_field_on_assistant_messages: None,
                supports_tool_choice: None,
                enabled: true,
            },
        ];
        upgrade_inferred_image_capabilities(&mut models);
        assert!(models[0].supports_image_input); // v2.5-free upgraded
        assert!(!models[1].supports_image_input); // v2.5-pro stays false
    }

    #[test]
    fn discovered_model_with_api_image_modalities() {
        let modalities = vec!["text".to_string(), "image".to_string()];
        let model = discovered_model("unknown-model", None, None, None, Some(&modalities));
        assert!(model.supports_image_input);
    }

    #[test]
    fn discovered_model_with_api_text_only_modalities() {
        let modalities = vec!["text".to_string()];
        let model = discovered_model(
            "mimo-v2.5", // ID would infer true, but API says text-only
            None,
            None,
            None,
            Some(&modalities),
        );
        // API discovery (Layer 1) takes priority over ID inference (Layer 2)
        assert!(!model.supports_image_input);
    }

    #[test]
    fn discovered_model_without_modalities_falls_back_to_id_inference() {
        let model = discovered_model("mimo-v2.5", None, None, None, None);
        assert!(model.supports_image_input); // inferred from ID
    }

    #[test]
    fn merge_discovered_models_upgrades_stale_false_tool_flags() {
        let existing = vec![NativeProviderModel {
            id: "deepseek-v4-flash".to_string(),
            label: None,
            context_window: None,
            supports_image_input: false,
            supports_tool_calling: false,
            supports_streaming: false,
            supports_reasoning_effort: None,
            reasoning_replay_field: ReasoningReplayField::Auto,
            requires_reasoning_field_on_assistant_messages: None,
            supports_tool_choice: None,
            enabled: true,
        }];
        let mut discovered = discovered_model(
            "deepseek-v4-flash",
            Some("deepseek-v4-flash".to_string()),
            None,
            None,
            None,
        );
        discovered.supports_tool_calling = true;
        discovered.supports_streaming = true;
        let merged = merge_discovered_models(&existing, vec![discovered]);
        assert!(merged[0].supports_tool_calling);
        assert!(merged[0].supports_streaming);
    }

    #[test]
    fn recover_optimistic_agent_capabilities_restores_stale_false_flags() {
        let mut models = vec![NativeProviderModel {
            id: "deepseek-v4-flash".to_string(),
            label: None,
            context_window: None,
            supports_image_input: false,
            supports_tool_calling: false,
            supports_streaming: false,
            supports_reasoning_effort: None,
            reasoning_replay_field: ReasoningReplayField::Auto,
            requires_reasoning_field_on_assistant_messages: None,
            supports_tool_choice: None,
            enabled: true,
        }];
        recover_optimistic_agent_capabilities(&mut models);
        assert!(models[0].supports_tool_calling);
        assert!(models[0].supports_streaming);
    }

    #[test]
    fn recover_optimistic_agent_capabilities_skips_embedding_models() {
        let mut models = vec![NativeProviderModel {
            id: "text-embedding-3-small".to_string(),
            label: None,
            context_window: None,
            supports_image_input: false,
            supports_tool_calling: false,
            supports_streaming: false,
            supports_reasoning_effort: None,
            reasoning_replay_field: ReasoningReplayField::Auto,
            requires_reasoning_field_on_assistant_messages: None,
            supports_tool_choice: None,
            enabled: true,
        }];
        recover_optimistic_agent_capabilities(&mut models);
        assert!(!models[0].supports_tool_calling);
        assert!(!models[0].supports_streaming);
    }
}
