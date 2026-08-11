use std::collections::HashMap;

use serde_json::Value;

use crate::native_backend::{NativeProviderModel, ReasoningReplayField};

const MODELS_DEV_URL: &str = "https://models.dev/models.json";

/// ponytail: 从 models.dev 获取的与 provider 无关的模型能力元数据。
/// reasoning = 该模型是否支持 reasoning / chain-of-thought。
#[derive(Clone, Copy, Debug)]
pub(crate) struct ModelDevCapabilities {
    pub reasoning: bool,
    pub reasoning_replay_field: Option<ReasoningReplayField>,
}

/// ponytail: 从 models.dev 获取模型能力映射。
/// 返回 HashMap<model_id_lowercase, ModelDevCapabilities>。
/// 键格式为 "provider/model-id"（如 "openai/o3"），全小写。
/// 失败时返回空 map —— best-effort，不阻塞模型刷新流程。
pub(crate) fn fetch_capability_map() -> HashMap<String, ModelDevCapabilities> {
    let client =
        crate::native_backend::network::http_client_builder(std::time::Duration::from_secs(10))
            .build();
    let Ok(client) = client else {
        return HashMap::new();
    };
    let response = client.get(MODELS_DEV_URL).send();
    let Ok(response) = response else {
        return HashMap::new();
    };
    if !response.status().is_success() {
        return HashMap::new();
    }
    let body: Value = match response.json() {
        Ok(body) => body,
        Err(_) => return HashMap::new(),
    };
    let Some(entries) = body.as_object() else {
        return HashMap::new();
    };
    entries
        .iter()
        .filter_map(|(id, metadata)| {
            let reasoning = metadata
                .get("reasoning")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let reasoning_replay_field = metadata
                .pointer("/interleaved/field")
                .and_then(Value::as_str)
                .and_then(reasoning_replay_field);
            Some((
                id.to_ascii_lowercase(),
                ModelDevCapabilities {
                    reasoning,
                    reasoning_replay_field,
                },
            ))
        })
        .collect()
}

/// ponytail: 用 models.dev 的能力数据富化一个 provider 的模型列表。
/// 匹配策略：
/// 1. 精确匹配 "provider/model-id" 全小写
/// 2. 后缀匹配：models.dev 键的 "/" 后部分与模型 ID 匹配
/// 只设置 supports_reasoning_effort，不覆盖已有值（Some(x) 表示用户或发现流程已设定）。
pub(crate) fn enrich_models(
    models: &mut [NativeProviderModel],
    provider_id: &str,
    capability_map: &HashMap<String, ModelDevCapabilities>,
) {
    if capability_map.is_empty() {
        return;
    }
    for model in models.iter_mut() {
        if model.reasoning_replay_field == ReasoningReplayField::Auto
            && let Some(field) = resolve_exact_capabilities(&model.id, provider_id, capability_map)
                .and_then(|capabilities| capabilities.reasoning_replay_field)
        {
            model.reasoning_replay_field = field;
        }
        // 只在 None（未知）时写入 —— 已有值不覆盖
        if model.supports_reasoning_effort.is_some() {
            continue;
        }
        model.supports_reasoning_effort = Some(resolve_reasoning_capability(
            &model.id,
            provider_id,
            capability_map,
        ));
    }
}

fn reasoning_replay_field(value: &str) -> Option<ReasoningReplayField> {
    match value {
        "reasoning" => Some(ReasoningReplayField::Reasoning),
        "reasoning_content" => Some(ReasoningReplayField::ReasoningContent),
        "reasoning_details" => Some(ReasoningReplayField::ReasoningDetails),
        _ => None,
    }
}

fn resolve_exact_capabilities<'a>(
    model_id: &str,
    provider_id: &str,
    capability_map: &'a HashMap<String, ModelDevCapabilities>,
) -> Option<&'a ModelDevCapabilities> {
    let model = model_id.trim().to_ascii_lowercase();
    let provider = provider_id.trim().to_ascii_lowercase();
    if model.is_empty() {
        return None;
    }
    capability_map.get(&format!("{provider}/{model}"))
}

fn resolve_reasoning_capability(
    model_id: &str,
    provider_id: &str,
    capability_map: &HashMap<String, ModelDevCapabilities>,
) -> bool {
    let model_lower = model_id.trim().to_ascii_lowercase();
    if model_lower.is_empty() {
        return false;
    }
    // 策略 1: 精确匹配 "provider/model-id"
    let qualified = format!("{provider_id}/{model_lower}");
    if let Some(cap) = capability_map.get(&qualified) {
        return cap.reasoning;
    }
    // 策略 2: 后缀匹配 —— models.dev 键的 "/" 后部分与模型 ID 匹配
    for (key, cap) in capability_map {
        if let Some(base) = key.split('/').nth(1) {
            if base == model_lower {
                return cap.reasoning;
            }
        }
    }
    // 策略 3: 无匹配 —— 默认 false（保守，不显示 reasoning_effort 选项）
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cap_map(entries: &[(&str, bool)]) -> HashMap<String, ModelDevCapabilities> {
        entries
            .iter()
            .map(|(id, reasoning)| {
                (
                    id.to_string(),
                    ModelDevCapabilities {
                        reasoning: *reasoning,
                        reasoning_replay_field: None,
                    },
                )
            })
            .collect()
    }

    #[test]
    fn resolve_qualified_match() {
        let map = cap_map(&[("openai/o3", true), ("openai/gpt-4o", false)]);
        assert!(resolve_reasoning_capability("o3", "openai", &map));
        assert!(!resolve_reasoning_capability("gpt-4o", "openai", &map));
    }

    #[test]
    fn resolve_suffix_match_across_providers() {
        let map = cap_map(&[("openai/o3", true), ("anthropic/claude-sonnet-4", true)]);
        // 模型 ID "o3" 在 openai provider 下精确匹配
        assert!(resolve_reasoning_capability("o3", "openai", &map));
        // 模型 ID "o3" 通过后缀匹配也能在非 openai provider 下找到
        assert!(resolve_reasoning_capability("o3", "custom-provider", &map));
    }

    #[test]
    fn resolve_unknown_model_defaults_false() {
        let map = cap_map(&[("openai/o3", true)]);
        assert!(!resolve_reasoning_capability(
            "unknown-model",
            "openai",
            &map
        ));
    }

    #[test]
    fn resolve_empty_model_id() {
        let map = cap_map(&[("openai/o3", true)]);
        assert!(!resolve_reasoning_capability("", "openai", &map));
        assert!(!resolve_reasoning_capability("   ", "openai", &map));
    }

    #[test]
    fn enrich_models_sets_reasoning_for_known_models() {
        let map = cap_map(&[("openai/o3", true), ("openai/gpt-4o", false)]);
        let mut models = vec![
            NativeProviderModel {
                id: "o3".to_string(),
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
            NativeProviderModel {
                id: "gpt-4o".to_string(),
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
        enrich_models(&mut models, "openai", &map);
        assert_eq!(models[0].supports_reasoning_effort, Some(true));
        assert_eq!(models[1].supports_reasoning_effort, Some(false));
    }

    #[test]
    fn enrich_models_preserves_existing_capability() {
        let map = cap_map(&[("openai/o3", true)]);
        let mut models = vec![NativeProviderModel {
            id: "o3".to_string(),
            label: None,
            context_window: None,
            supports_image_input: false,
            supports_tool_calling: false,
            supports_streaming: false,
            supports_reasoning_effort: Some(false),
            reasoning_replay_field: ReasoningReplayField::Auto,
            requires_reasoning_field_on_assistant_messages: None,
            supports_tool_choice: None,
            enabled: true,
            capability_probes: HashMap::new(),
        }];
        enrich_models(&mut models, "openai", &map);
        // 已有 Some(false) 不被覆盖
        assert_eq!(models[0].supports_reasoning_effort, Some(false));
    }

    #[test]
    fn enrich_models_skips_when_map_empty() {
        let map = HashMap::new();
        let mut models = vec![NativeProviderModel {
            id: "o3".to_string(),
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
        }];
        enrich_models(&mut models, "openai", &map);
        // 空 map 不做任何修改
        assert_eq!(models[0].supports_reasoning_effort, None);
    }

    #[test]
    fn enrich_models_uses_only_exact_models_dev_interleaved_metadata() {
        let map = HashMap::from([
            (
                "cerebras/gpt-oss-120b".to_string(),
                ModelDevCapabilities {
                    reasoning: true,
                    reasoning_replay_field: Some(ReasoningReplayField::Reasoning),
                },
            ),
            (
                "openrouter/deepseek/deepseek-v4-pro".to_string(),
                ModelDevCapabilities {
                    reasoning: true,
                    reasoning_replay_field: Some(ReasoningReplayField::ReasoningDetails),
                },
            ),
        ]);
        let mut exact = vec![NativeProviderModel {
            id: "gpt-oss-120b".to_string(),
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
        }];
        enrich_models(&mut exact, "cerebras", &map);
        assert_eq!(
            exact[0].reasoning_replay_field,
            ReasoningReplayField::Reasoning
        );

        let mut aggregator_lookalike = exact.clone();
        aggregator_lookalike[0].reasoning_replay_field = ReasoningReplayField::Auto;
        enrich_models(&mut aggregator_lookalike, "custom-provider", &map);
        assert_eq!(
            aggregator_lookalike[0].reasoning_replay_field,
            ReasoningReplayField::Auto
        );
    }
}
