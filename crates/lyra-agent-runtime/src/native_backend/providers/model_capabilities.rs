use std::collections::HashMap;

use chrono::Utc;
use serde_json::{Value, json};

use crate::{
    AgentRuntimeError, AgentRuntimeResult, ProviderFailureCategory,
    native_backend::{
        CapabilityProbe, NativeProviderModel, NativeProviderProfile, ReasoningReplayField,
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

// ── 运行时能力探测：常量与辅助 ──────────────────────────────────

/// 连续 Capability 错误达此阈值后标记 confirmed_unsupported。
const PROBE_FAILURE_THRESHOLD: u32 = 2;

/// confirmed_unsupported 后经过此时间（毫秒）重新乐观尝试。
/// 7 天 — 服务商可能更新模型添加能力。
const PROBE_RECOVERY_MS: u64 = 7 * 24 * 3600 * 1000;

fn now_ms() -> u64 {
    Utc::now().timestamp_millis() as u64
}

// ── 运行时能力探测：核心逻辑 ────────────────────────────────────

/// 解析有效能力。优先级：Probe 数据 > legacy bool 字段。
///
/// - 有 probe 且 confirmed_unsupported 且未过冷却 → false
/// - 有 probe 且 confirmed_unsupported 且已过冷却 → true（重新探测）
/// - 有 probe 且未 confirmed → true（乐观）
/// - 无 probe → legacy_field（API 发现或 ID 推断的值）
pub(crate) fn effective_capability(
    model: &NativeProviderModel,
    probe_key: &str,
    legacy_field: bool,
) -> bool {
    if let Some(probe) = model.capability_probes.get(probe_key) {
        if probe.confirmed_unsupported {
            if let Some(last_fail) = probe.last_failure_at {
                if now_ms().saturating_sub(last_fail) > PROBE_RECOVERY_MS {
                    return true; // 冷却到期，重新探测
                }
            }
            return false;
        }
        return true; // 未确认不支持 → 乐观
    }
    legacy_field
}

/// 记录能力失败。仅 Capability 类错误计数，临时错误不计数、不创建条目。
pub(crate) fn record_probe_failure(
    model: &mut NativeProviderModel,
    probe_key: &str,
    category: &ProviderFailureCategory,
) {
    match category {
        ProviderFailureCategory::Capability => {
            let probe = model
                .capability_probes
                .entry(probe_key.to_string())
                .or_default();
            probe.consecutive_failures += 1;
            probe.last_failure_at = Some(now_ms());
            probe.last_error_category = Some("capability".into());
            if probe.consecutive_failures >= PROBE_FAILURE_THRESHOLD {
                probe.confirmed_unsupported = true;
            }
        }
        ProviderFailureCategory::RateLimit | ProviderFailureCategory::Server => {
            // 临时错误 — 不影响能力判断，不创建 probe 条目
        }
        _ => {}
    }
}

/// 记录能力成功。重置失败计数，清除 confirmed。
pub(crate) fn record_probe_success(model: &mut NativeProviderModel, probe_key: &str) {
    let probe = model
        .capability_probes
        .entry(probe_key.to_string())
        .or_default();
    probe.consecutive_failures = 0;
    probe.last_success_at = Some(now_ms());
    probe.confirmed_unsupported = false;
}

// ── 运行时能力探测：持久化封装 ──────────────────────────────────

/// 加锁 state → 找到 model → record_probe_failure → save_state。
/// 供 model_loop.rs 错误路径调用。
pub(crate) fn record_probe_failure_for_provider(
    session_id: &str,
    provider_id: &str,
    model_id: &str,
    probe_key: &str,
    category: &ProviderFailureCategory,
) -> AgentRuntimeResult<()> {
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let model = state
        .config
        .providers
        .get_mut(provider_id)
        .and_then(|profile| profile.models.iter_mut().find(|m| m.id == model_id));
    if let Some(model) = model {
        record_probe_failure(model, probe_key, category);
    }
    state.save_state()?;
    drop(state);
    emit_context_trimmed(
        session_id,
        json!({
            "reason": "model_capability_probe_failure",
            "providerId": provider_id,
            "modelId": model_id,
            "probeKey": probe_key,
            "category": format!("{:?}", category),
        }),
    );
    Ok(())
}

/// 加锁 state → 找到 model → record_probe_success → save_state。
/// 供 protocol_mapping.rs observe_successful 路径调用。
pub(crate) fn record_probe_success_for_provider(
    session_id: &str,
    provider_id: &str,
    model_id: &str,
    probe_key: &str,
) -> AgentRuntimeResult<()> {
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let model = state
        .config
        .providers
        .get_mut(provider_id)
        .and_then(|profile| profile.models.iter_mut().find(|m| m.id == model_id));
    if let Some(model) = model {
        record_probe_success(model, probe_key);
    }
    state.save_state()?;
    drop(state);
    emit_context_trimmed(
        session_id,
        json!({
            "reason": "model_capability_probe_success",
            "providerId": provider_id,
            "modelId": model_id,
            "probeKey": probe_key,
        }),
    );
    Ok(())
}

/// 为已有 supports_*=false 但无 probe 数据的模型创建初始 probe。
/// confirmed_unsupported = true（尊重现有值），last_failure_at = now（启动冷却计时）。
/// 仅在无现有 probe 时插入，不覆盖运行时学到的数据。
pub(crate) fn migrate_capability_probes(models: &mut [NativeProviderModel]) {
    let now = now_ms();
    for model in models.iter_mut() {
        if !model.supports_image_input && !model.capability_probes.contains_key("image_input") {
            model.capability_probes.insert(
                "image_input".into(),
                CapabilityProbe {
                    confirmed_unsupported: true,
                    last_failure_at: Some(now),
                    ..Default::default()
                },
            );
        }
        if !model.supports_tool_calling && !model.capability_probes.contains_key("tool_calling") {
            model.capability_probes.insert(
                "tool_calling".into(),
                CapabilityProbe {
                    confirmed_unsupported: true,
                    last_failure_at: Some(now),
                    ..Default::default()
                },
            );
        }
        if !model.supports_streaming && !model.capability_probes.contains_key("streaming") {
            model.capability_probes.insert(
                "streaming".into(),
                CapabilityProbe {
                    confirmed_unsupported: true,
                    last_failure_at: Some(now),
                    ..Default::default()
                },
            );
        }
    }
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
        capability_probes: HashMap::new(),
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
            None,
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
            capability_probes: HashMap::new(),
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
            capability_probes: HashMap::new(),
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
            capability_probes: HashMap::new(),
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
                capability_probes: HashMap::new(),
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
                capability_probes: HashMap::new(),
            },
        ];
        upgrade_inferred_image_capabilities(&mut models);
        assert!(models[0].supports_image_input); // v2.5-free upgraded
        assert!(!models[1].supports_image_input); // v2.5-pro stays false
    }

    // ── 运行时能力探测测试 ───────────────────────────────────────

    fn model_with_probe(
        id: &str,
        legacy_image: bool,
        probe: Option<CapabilityProbe>,
    ) -> NativeProviderModel {
        let mut probes = HashMap::new();
        if let Some(p) = probe {
            probes.insert("image_input".to_string(), p);
        }
        NativeProviderModel {
            id: id.to_string(),
            label: None,
            context_window: None,
            supports_image_input: legacy_image,
            supports_tool_calling: true,
            supports_streaming: true,
            supports_reasoning_effort: None,
            reasoning_replay_field: ReasoningReplayField::Auto,
            requires_reasoning_field_on_assistant_messages: None,
            supports_tool_choice: None,
            enabled: true,
            capability_probes: probes,
        }
    }

    #[test]
    fn effective_capability_no_probe_returns_legacy() {
        let model = model_with_probe("test-model", false, None);
        assert!(!effective_capability(&model, "image_input", false));
        let model = model_with_probe("test-model", true, None);
        assert!(effective_capability(&model, "image_input", true));
    }

    #[test]
    fn effective_capability_unconfirmed_probe_is_optimistic() {
        let probe = CapabilityProbe {
            consecutive_failures: 1,
            confirmed_unsupported: false,
            ..Default::default()
        };
        let model = model_with_probe("test-model", false, Some(probe));
        // Even though legacy is false, unconfirmed probe → optimistic true
        assert!(effective_capability(&model, "image_input", false));
    }

    #[test]
    fn effective_capability_confirmed_within_cooldown_returns_false() {
        let probe = CapabilityProbe {
            consecutive_failures: 2,
            confirmed_unsupported: true,
            last_failure_at: Some(now_ms()),
            ..Default::default()
        };
        let model = model_with_probe("test-model", true, Some(probe));
        // Even though legacy is true, confirmed unsupported → false
        assert!(!effective_capability(&model, "image_input", true));
    }

    #[test]
    fn effective_capability_confirmed_past_cooldown_returns_true() {
        let recovery = 7 * 24 * 3600 * 1000; // PROBE_RECOVERY_MS
        let probe = CapabilityProbe {
            consecutive_failures: 2,
            confirmed_unsupported: true,
            last_failure_at: Some(now_ms().saturating_sub(recovery + 1000)),
            ..Default::default()
        };
        let model = model_with_probe("test-model", false, Some(probe));
        // Cooldown expired → re-probe optimistically
        assert!(effective_capability(&model, "image_input", false));
    }

    #[test]
    fn record_probe_failure_capability_increments_count() {
        let mut model = model_with_probe("test-model", true, None);
        record_probe_failure(
            &mut model,
            "image_input",
            &ProviderFailureCategory::Capability,
        );
        let probe = &model.capability_probes["image_input"];
        assert_eq!(probe.consecutive_failures, 1);
        assert!(!probe.confirmed_unsupported); // 1 failure, threshold is 2
    }

    #[test]
    fn record_probe_failure_two_capability_errors_confirms() {
        let mut model = model_with_probe("test-model", true, None);
        record_probe_failure(
            &mut model,
            "image_input",
            &ProviderFailureCategory::Capability,
        );
        record_probe_failure(
            &mut model,
            "image_input",
            &ProviderFailureCategory::Capability,
        );
        let probe = &model.capability_probes["image_input"];
        assert_eq!(probe.consecutive_failures, 2);
        assert!(probe.confirmed_unsupported);
    }

    #[test]
    fn record_probe_failure_rate_limit_does_not_count() {
        let mut model = model_with_probe("test-model", true, None);
        record_probe_failure(
            &mut model,
            "image_input",
            &ProviderFailureCategory::RateLimit,
        );
        assert!(model.capability_probes.is_empty()); // No probe created for temp errors
    }

    #[test]
    fn record_probe_failure_server_error_does_not_count() {
        let mut model = model_with_probe("test-model", true, None);
        record_probe_failure(&mut model, "image_input", &ProviderFailureCategory::Server);
        assert!(model.capability_probes.is_empty());
    }

    #[test]
    fn record_probe_success_resets_failures() {
        let mut model = model_with_probe("test-model", true, None);
        // Accumulate 2 failures → confirmed
        record_probe_failure(
            &mut model,
            "image_input",
            &ProviderFailureCategory::Capability,
        );
        record_probe_failure(
            &mut model,
            "image_input",
            &ProviderFailureCategory::Capability,
        );
        assert!(model.capability_probes["image_input"].confirmed_unsupported);
        // Success resets
        record_probe_success(&mut model, "image_input");
        let probe = &model.capability_probes["image_input"];
        assert_eq!(probe.consecutive_failures, 0);
        assert!(!probe.confirmed_unsupported);
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
    fn migrate_capability_probes_creates_probes_for_false_models() {
        let mut models = vec![
            NativeProviderModel {
                id: "vision-model".to_string(),
                label: None,
                context_window: None,
                supports_image_input: true,
                supports_tool_calling: true,
                supports_streaming: true,
                supports_reasoning_effort: None,
                reasoning_replay_field: ReasoningReplayField::Auto,
                requires_reasoning_field_on_assistant_messages: None,
                supports_tool_choice: None,
                enabled: true,
                capability_probes: HashMap::new(),
            },
            NativeProviderModel {
                id: "text-only-model".to_string(),
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
                capability_probes: HashMap::new(),
            },
        ];
        migrate_capability_probes(&mut models);
        // Vision model: no probes created (all true)
        assert!(!models[0].capability_probes.contains_key("image_input"));
        // Text-only model: probes created for all false capabilities
        assert!(models[1].capability_probes["image_input"].confirmed_unsupported);
        assert!(models[1].capability_probes["tool_calling"].confirmed_unsupported);
        assert!(models[1].capability_probes["streaming"].confirmed_unsupported);
    }

    #[test]
    fn migrate_capability_probes_does_not_overwrite_existing_probes() {
        let mut models = vec![NativeProviderModel {
            id: "test-model".to_string(),
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
            capability_probes: {
                let mut m = HashMap::new();
                m.insert(
                    "image_input".to_string(),
                    CapabilityProbe {
                        consecutive_failures: 0,
                        confirmed_unsupported: false, // runtime learned it's supported
                        ..Default::default()
                    },
                );
                m
            },
        }];
        migrate_capability_probes(&mut models);
        // Existing probe not overwritten
        assert!(!models[0].capability_probes["image_input"].confirmed_unsupported);
    }
}
