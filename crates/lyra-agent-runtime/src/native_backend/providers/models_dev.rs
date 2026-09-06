use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    time::{Duration, SystemTime},
};

use serde_json::Value;

use crate::native_backend::{
    CapabilitySupport, NativeCapabilityEvidence, NativeModelCapabilityRecord, NativeProviderModel,
    ReasoningReplayField,
};

use super::model_capabilities::{
    FEATURE_REASONING, FEATURE_REASONING_EFFORT, FEATURE_STRUCTURED_OUTPUT, FEATURE_TEMPERATURE,
    FEATURE_TOOL_CALLING, INPUT_AUDIO, INPUT_IMAGE, INPUT_PDF, INPUT_TEXT, INPUT_VIDEO,
    OPERATION_IMAGE_GENERATION, OPERATION_LANGUAGE, OPERATION_SPEECH_GENERATION,
    OPERATION_TRANSCRIPTION, OPERATION_VIDEO_GENERATION, OUTPUT_AUDIO, OUTPUT_IMAGE, OUTPUT_TEXT,
    OUTPUT_VIDEO,
};

const MODELS_DEV_URL: &str = "https://models.dev/api.json";
const EMBEDDED_MODELS_DEV_SNAPSHOT: &str =
    include_str!("../../../assets/model-capabilities/models-dev-snapshot.v1.json");
const CATALOG_CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Clone, Debug, Default)]
pub(crate) struct ModelDevCapabilities {
    pub(crate) capabilities: HashMap<String, CapabilitySupport>,
    pub(crate) reasoning_replay_field: Option<ReasoningReplayField>,
    pub(crate) context_window: Option<usize>,
}

/// Fetch only the configured provider's section from models.dev's provider-aware
/// catalog. This is called exclusively from the explicit refresh flow.
pub(crate) fn fetch_capability_map(provider_id: &str) -> HashMap<String, ModelDevCapabilities> {
    if let Some(body) = read_cached_catalog(true) {
        return parse_provider_catalog(&body, provider_id);
    }
    let client =
        crate::native_backend::network::http_client_builder(std::time::Duration::from_secs(10))
            .build();
    let Ok(client) = client else {
        return stale_capability_map(provider_id);
    };
    let Ok(response) = client.get(MODELS_DEV_URL).send() else {
        return stale_capability_map(provider_id);
    };
    if !response.status().is_success() {
        return stale_capability_map(provider_id);
    }
    let body: Value = match response.json() {
        Ok(body) => body,
        Err(_) => return stale_capability_map(provider_id),
    };
    let _ = crate::native_backend::state::write_json(&catalog_cache_path(), &body);
    parse_provider_catalog(&body, provider_id)
}

fn stale_capability_map(provider_id: &str) -> HashMap<String, ModelDevCapabilities> {
    read_cached_catalog(false)
        .or_else(|| serde_json::from_str(EMBEDDED_MODELS_DEV_SNAPSHOT).ok())
        .map(|body| parse_provider_catalog(&body, provider_id))
        .unwrap_or_default()
}

fn catalog_cache_path() -> PathBuf {
    crate::native_backend::state::runtime_root()
        .join("cache")
        .join("model-capabilities")
        .join("models-dev-api.json")
}

fn read_cached_catalog(require_fresh: bool) -> Option<Value> {
    let path = catalog_cache_path();
    if require_fresh {
        let modified = fs::metadata(&path).ok()?.modified().ok()?;
        let age = SystemTime::now().duration_since(modified).ok()?;
        if age > CATALOG_CACHE_TTL {
            return None;
        }
    }
    crate::native_backend::state::read_json(&path)
}

fn parse_provider_catalog(
    body: &Value,
    provider_id: &str,
) -> HashMap<String, ModelDevCapabilities> {
    let Some(provider_key) = resolve_provider_key(body, provider_id) else {
        return HashMap::new();
    };
    let Some(models) = body
        .get(provider_key)
        .and_then(|provider| provider.get("models"))
        .and_then(Value::as_object)
    else {
        return HashMap::new();
    };
    models
        .iter()
        .map(|(model_id, metadata)| {
            (
                model_id.trim().to_ascii_lowercase(),
                capabilities_from_metadata(metadata),
            )
        })
        .collect()
}

// Route ids diverge from models.dev catalog keys: separators differ
// ("ollama_cloud_openai" vs "ollama-cloud"), some ids are renamed
// ("glm" -> "zhipuai"), and route ids can carry a transport suffix
// ("ollama-cloud-openai"). Resolution order: alias table, exact key,
// underscore-normalized key, then longest catalog key that prefixes the
// normalized id.
fn resolve_provider_key(body: &Value, provider_id: &str) -> Option<String> {
    let normalized = provider_id.trim().to_ascii_lowercase().replace('_', "-");
    let alias = match normalized.as_str() {
        "google" | "google-gemini" => "google",
        "amazon-bedrock" | "aws-bedrock" | "bedrock" => "amazon-bedrock",
        "moonshot" | "moonshotai" => "moonshotai",
        "zhipu" | "zhipuai" | "glm" => "zhipuai",
        other => other,
    };
    if body.get(alias).is_some() {
        return Some(alias.to_string());
    }
    let keys = body.as_object()?.keys();
    if let Some(exact) = keys.clone().find(|key| key.as_str() == normalized) {
        return Some(exact.clone());
    }
    keys.filter(|key| normalized.starts_with(&format!("{key}-")))
        .max_by_key(|key| key.len())
        .cloned()
}

fn capabilities_from_metadata(metadata: &Value) -> ModelDevCapabilities {
    let mut result = ModelDevCapabilities::default();
    insert_optional_bool(
        &mut result.capabilities,
        FEATURE_TOOL_CALLING,
        metadata.get("tool_call").and_then(Value::as_bool),
    );
    insert_optional_bool(
        &mut result.capabilities,
        FEATURE_REASONING,
        metadata.get("reasoning").and_then(Value::as_bool),
    );
    insert_optional_bool(
        &mut result.capabilities,
        FEATURE_REASONING_EFFORT,
        metadata.get("reasoning").and_then(Value::as_bool),
    );
    insert_optional_bool(
        &mut result.capabilities,
        FEATURE_STRUCTURED_OUTPUT,
        metadata.get("structured_output").and_then(Value::as_bool),
    );
    insert_optional_bool(
        &mut result.capabilities,
        FEATURE_TEMPERATURE,
        metadata.get("temperature").and_then(Value::as_bool),
    );
    if let Some(input_modalities) = metadata
        .pointer("/modalities/input")
        .and_then(Value::as_array)
    {
        for key in [INPUT_TEXT, INPUT_IMAGE, INPUT_AUDIO, INPUT_VIDEO, INPUT_PDF] {
            result
                .capabilities
                .insert(key.to_string(), CapabilitySupport::Unsupported);
        }
        for modality in input_modalities.iter().filter_map(Value::as_str) {
            if let Some(key) = input_modality_key(modality) {
                result
                    .capabilities
                    .insert(key.to_string(), CapabilitySupport::Supported);
            }
        }
    }
    if let Some(output_modalities) = metadata
        .pointer("/modalities/output")
        .and_then(Value::as_array)
    {
        for key in [OUTPUT_TEXT, OUTPUT_IMAGE, OUTPUT_AUDIO, OUTPUT_VIDEO] {
            result
                .capabilities
                .insert(key.to_string(), CapabilitySupport::Unsupported);
        }
        for modality in output_modalities.iter().filter_map(Value::as_str) {
            if let Some(key) = output_modality_key(modality) {
                result
                    .capabilities
                    .insert(key.to_string(), CapabilitySupport::Supported);
            }
        }
    }
    if metadata.pointer("/modalities/input").is_some()
        && metadata.pointer("/modalities/output").is_some()
    {
        for operation in [
            OPERATION_LANGUAGE,
            OPERATION_IMAGE_GENERATION,
            OPERATION_SPEECH_GENERATION,
            OPERATION_TRANSCRIPTION,
            OPERATION_VIDEO_GENERATION,
        ] {
            result
                .capabilities
                .insert(operation.to_string(), CapabilitySupport::Unsupported);
        }
    }
    derive_operations(&mut result.capabilities);
    result.context_window = metadata
        .pointer("/limit/context")
        .and_then(Value::as_u64)
        .map(|value| value as usize);
    result.reasoning_replay_field = metadata
        .pointer("/interleaved/field")
        .and_then(Value::as_str)
        .and_then(reasoning_replay_field);
    result
}

fn insert_optional_bool(
    capabilities: &mut HashMap<String, CapabilitySupport>,
    key: &str,
    value: Option<bool>,
) {
    let Some(value) = value else {
        return;
    };
    capabilities.insert(
        key.to_string(),
        if value {
            CapabilitySupport::Supported
        } else {
            CapabilitySupport::Unsupported
        },
    );
}

fn input_modality_key(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "text" => Some(INPUT_TEXT),
        "image" => Some(INPUT_IMAGE),
        "audio" => Some(INPUT_AUDIO),
        "video" => Some(INPUT_VIDEO),
        "pdf" | "document" => Some(INPUT_PDF),
        _ => None,
    }
}

fn output_modality_key(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "text" => Some(OUTPUT_TEXT),
        "image" => Some(OUTPUT_IMAGE),
        "audio" => Some(OUTPUT_AUDIO),
        "video" => Some(OUTPUT_VIDEO),
        _ => None,
    }
}

fn derive_operations(capabilities: &mut HashMap<String, CapabilitySupport>) {
    let supported =
        |key: &str| capabilities.get(key).copied() == Some(CapabilitySupport::Supported);
    let mut operations = Vec::new();
    if supported(INPUT_TEXT) && supported(OUTPUT_TEXT) {
        operations.push(OPERATION_LANGUAGE);
    }
    if supported(INPUT_TEXT) && supported(OUTPUT_IMAGE) {
        operations.push(OPERATION_IMAGE_GENERATION);
    }
    if supported(INPUT_TEXT) && supported(OUTPUT_AUDIO) {
        operations.push(OPERATION_SPEECH_GENERATION);
    }
    if supported(INPUT_AUDIO) && supported(OUTPUT_TEXT) {
        operations.push(OPERATION_TRANSCRIPTION);
    }
    if supported(INPUT_TEXT) && supported(OUTPUT_VIDEO) {
        operations.push(OPERATION_VIDEO_GENERATION);
    }
    for operation in operations {
        capabilities.insert(operation.to_string(), CapabilitySupport::Supported);
    }
}

// Provider APIs return ids with qualifiers the catalog omits (and vice versa:
// "deepseek-v4-flash:0731" vs "deepseek-v4-flash"). Match the exact id first,
// then fall back to comparing the part before ":" on either side.
fn capability_entry<'a>(
    capability_map: &'a HashMap<String, ModelDevCapabilities>,
    model_id: &str,
) -> Option<&'a ModelDevCapabilities> {
    let normalized = model_id.trim().to_ascii_lowercase();
    if let Some(capabilities) = capability_map.get(&normalized) {
        return Some(capabilities);
    }
    let base = normalized.split(':').next()?;
    capability_map
        .get(base)
        .or_else(|| {
            capability_map
                .keys()
                .find(|key| key.split(':').next() == Some(base))
                .and_then(|key| capability_map.get(key))
        })
}

pub(crate) fn enrich_models(
    models: &mut [NativeProviderModel],
    _provider_id: &str,
    capability_map: &HashMap<String, ModelDevCapabilities>,
) {
    for model in models {
        let Some(capabilities) = capability_entry(capability_map, &model.id) else {
            continue;
        };
        if let Some(value) = capabilities
            .capabilities
            .get(INPUT_IMAGE)
            .and_then(|value| value.as_bool())
        {
            model.supports_image_input = value;
        }
        if let Some(value) = capabilities
            .capabilities
            .get(FEATURE_TOOL_CALLING)
            .and_then(|value| value.as_bool())
        {
            model.supports_tool_calling = value;
        }
        if let Some(value) = capabilities
            .capabilities
            .get(FEATURE_REASONING_EFFORT)
            .and_then(|value| value.as_bool())
        {
            model.supports_reasoning_effort = Some(value);
        }
        if model.reasoning_replay_field == ReasoningReplayField::Auto {
            if let Some(field) = capabilities.reasoning_replay_field {
                model.reasoning_replay_field = field;
            }
        }
        model.context_window = capabilities.context_window.or(model.context_window);
    }
}

pub(crate) fn enrich_capability_record(
    record: &mut NativeModelCapabilityRecord,
    _provider_id: &str,
    model_id: &str,
    capability_map: &HashMap<String, ModelDevCapabilities>,
) {
    let Some(capabilities) = capability_entry(capability_map, model_id) else {
        return;
    };
    let observed_at = chrono::Utc::now().to_rfc3339();
    for (key, value) in &capabilities.capabilities {
        if let Some(detected) = record.detected.get(key).copied() {
            if detected != CapabilitySupport::Unknown
                && *value != CapabilitySupport::Unknown
                && detected != *value
            {
                let detail = format!(
                    "Provider discovery reported {detected:?}, while models.dev reported {value:?}. Provider discovery keeps priority."
                );
                if let Some(evidence) = record.evidence.get_mut(key) {
                    evidence.conflict = true;
                    evidence.detail = Some(match evidence.detail.take() {
                        Some(existing) => format!("{existing} {detail}"),
                        None => detail.clone(),
                    });
                }
                let summary = format!("Capability conflict for {key}: {detail}");
                record.runtime_conflict = Some(match record.runtime_conflict.take() {
                    Some(existing) => format!("{existing} {summary}"),
                    None => summary,
                });
            }
            continue;
        }
        record.detected.insert(key.clone(), *value);
        record.evidence.insert(
            key.clone(),
            NativeCapabilityEvidence {
                source: "models_dev".to_string(),
                conflict: false,
                source_url: Some(MODELS_DEV_URL.to_string()),
                observed_at: Some(observed_at.clone()),
                detail: None,
            },
        );
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_provider_scoped_tool_and_modality_capabilities() {
        let body = json!({
            "groq": {
                "models": {
                    "groq/compound": {
                        "tool_call": false,
                        "reasoning": true,
                        "structured_output": true,
                        "modalities": { "input": ["text"], "output": ["text"] },
                        "limit": { "context": 131072 }
                    }
                }
            }
        });
        let map = parse_provider_catalog(&body, "groq");
        let capability = map.get("groq/compound").expect("compound");
        assert_eq!(
            capability.capabilities.get(FEATURE_TOOL_CALLING),
            Some(&CapabilitySupport::Unsupported)
        );
        assert_eq!(
            capability.capabilities.get(OPERATION_LANGUAGE),
            Some(&CapabilitySupport::Supported)
        );
        assert_eq!(capability.context_window, Some(131072));
    }

    #[test]
    fn derives_specialized_operations_from_modalities() {
        let image = capabilities_from_metadata(&serde_json::json!({
            "modalities": { "input": ["text"], "output": ["image"] }
        }));
        assert_eq!(
            image.capabilities.get(OPERATION_IMAGE_GENERATION),
            Some(&CapabilitySupport::Supported)
        );
        let transcription = capabilities_from_metadata(&serde_json::json!({
            "modalities": { "input": ["audio"], "output": ["text"] }
        }));
        assert_eq!(
            transcription.capabilities.get(OPERATION_TRANSCRIPTION),
            Some(&CapabilitySupport::Supported)
        );
    }

    #[test]
    fn provider_discovery_keeps_priority_and_records_catalog_conflicts() {
        let body = json!({
            "groq": {
                "models": {
                    "conflicted": { "tool_call": false }
                }
            }
        });
        let map = parse_provider_catalog(&body, "groq");
        let mut record = NativeModelCapabilityRecord::default();
        record.detected.insert(
            FEATURE_TOOL_CALLING.to_string(),
            CapabilitySupport::Supported,
        );
        record.evidence.insert(
            FEATURE_TOOL_CALLING.to_string(),
            NativeCapabilityEvidence {
                source: "provider_api".to_string(),
                conflict: false,
                source_url: None,
                observed_at: None,
                detail: None,
            },
        );

        enrich_capability_record(&mut record, "groq", "conflicted", &map);

        assert_eq!(
            record.detected.get(FEATURE_TOOL_CALLING),
            Some(&CapabilitySupport::Supported)
        );
        assert_eq!(
            record
                .evidence
                .get(FEATURE_TOOL_CALLING)
                .map(|evidence| evidence.conflict),
            Some(true)
        );
        assert!(record.runtime_conflict.is_some());
    }

    #[test]
    fn maps_route_ids_to_provider_scoped_catalog_ids() {
        let body = json!({
            "google": { "models": { "gemini-test": { "tool_call": true } } },
            "amazon-bedrock": { "models": { "bedrock-test": { "tool_call": false } } },
            "moonshotai": { "models": { "kimi-test": { "tool_call": true } } },
            "zhipuai": { "models": { "glm-test": { "tool_call": true } } }
        });
        assert!(parse_provider_catalog(&body, "google_gemini").contains_key("gemini-test"));
        assert!(parse_provider_catalog(&body, "aws_bedrock").contains_key("bedrock-test"));
        assert!(parse_provider_catalog(&body, "moonshot").contains_key("kimi-test"));
        assert!(parse_provider_catalog(&body, "glm").contains_key("glm-test"));
    }

    #[test]
    fn embedded_offline_snapshot_disables_groq_compound_tools() {
        let body: Value = serde_json::from_str(EMBEDDED_MODELS_DEV_SNAPSHOT).expect("snapshot");
        let models = parse_provider_catalog(&body, "groq");
        assert_eq!(
            models["groq/compound"]
                .capabilities
                .get(FEATURE_TOOL_CALLING),
            Some(&CapabilitySupport::Unsupported)
        );
    }

    #[test]
    fn route_id_with_transport_suffix_matches_base_catalog_entry() {
        let body = json!({
            "ollama-cloud": { "models": { "glm-5.3-flash": { "tool_call": true } } }
        });
        let map = parse_provider_catalog(&body, "ollama_cloud_openai");
        assert!(map.contains_key("glm-5.3-flash"));
        assert_eq!(
            map["glm-5.3-flash"].capabilities.get(FEATURE_TOOL_CALLING),
            Some(&CapabilitySupport::Supported)
        );
    }

    #[test]
    fn capability_entry_matches_tagged_model_ids() {
        let mut map = HashMap::new();
        map.insert(
            "glm-5.3-flash".to_string(),
            ModelDevCapabilities::default(),
        );
        assert!(capability_entry(&map, "glm-5.3-flash:0731").is_some());

        map.insert(
            "deepseek-v4-pro:0813".to_string(),
            ModelDevCapabilities::default(),
        );
        assert!(capability_entry(&map, "deepseek-v4-pro").is_some());
        assert!(capability_entry(&map, "totally-unknown").is_none());
    }
}
