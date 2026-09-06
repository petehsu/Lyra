use std::collections::HashMap;

use reqwest::blocking::Client;
use serde_json::Value;

use crate::{
    AgentRuntimeError, AgentRuntimeResult,
    native_backend::{
        CapabilitySupport, NativeCapabilityEvidence, NativeModelCapabilityRecord,
        NativeProviderModel, NativeProviderProfile,
        providers::{model_capabilities, registry, transport},
    },
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ModelDiscoveryScope {
    CompatibleText,
    All,
}

pub(crate) fn discover_models(
    client: &Client,
    provider: &NativeProviderProfile,
    require_auth: bool,
    scope: ModelDiscoveryScope,
) -> AgentRuntimeResult<Vec<NativeProviderModel>> {
    discover_models_with_capabilities(client, provider, require_auth, scope)
        .map(|(models, _)| models)
}

pub(crate) fn discover_models_with_capabilities(
    client: &Client,
    provider: &NativeProviderProfile,
    require_auth: bool,
    scope: ModelDiscoveryScope,
) -> AgentRuntimeResult<(
    Vec<NativeProviderModel>,
    HashMap<String, NativeModelCapabilityRecord>,
)> {
    let url = transport::http::endpoint_url(provider, "models")?;
    let request = client.get(&url);
    let request = if require_auth || transport::auth::resolve_api_key(provider).is_some() {
        transport::auth::apply_model_auth(request, provider)?
    } else {
        request
    };
    let response = request
        .send()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    if !status.is_success() {
        return Err(AgentRuntimeError::Core(format!(
            "provider model discovery failed with status {status}: {body}"
        )));
    }
    let discovered = body
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let id = item.get("id").and_then(Value::as_str)?;
            if !is_discoverable_model_id(id, scope) {
                return None;
            }
            let route = registry::require_route(&provider.route_id).ok();
            let modalities = extract_api_input_modalities(item);
            let mut model = model_capabilities::discovered_model(
                id,
                Some(id.to_string()),
                extract_context_window(item),
                route.as_ref(),
                modalities.as_deref(),
            );
            if let Some(value) = extract_capability_bool(
                item,
                &["tool_calling", "tools", "function_calling"],
                &["tools", "tool_choice"],
            ) {
                model.supports_tool_calling = value;
            }
            model.supports_tool_choice =
                extract_capability_bool(item, &["tool_choice"], &["tool_choice"]);
            model.supports_reasoning_effort = extract_capability_bool(
                item,
                &["reasoning", "reasoning_effort"],
                &["reasoning", "reasoning_effort"],
            );
            let record = capability_record_from_model_item(item, &url);
            Some((model, record))
        })
        .collect::<Vec<_>>();
    let mut models = discovered
        .iter()
        .map(|(model, _)| model.clone())
        .collect::<Vec<_>>();
    models.sort_by(|left, right| left.id.cmp(&right.id));
    models.dedup_by(|left, right| left.id == right.id);
    let records = discovered
        .into_iter()
        .map(|(model, record)| (model.id, record))
        .collect();
    Ok((models, records))
}

fn capability_record_from_model_item(
    item: &Value,
    source_url: &str,
) -> NativeModelCapabilityRecord {
    let mut record = NativeModelCapabilityRecord::default();
    let inputs = extract_api_input_modalities(item);
    let outputs = extract_api_output_modalities(item);
    if let Some(inputs) = inputs.as_ref() {
        for (key, name) in [
            (model_capabilities::INPUT_TEXT, "text"),
            (model_capabilities::INPUT_IMAGE, "image"),
            (model_capabilities::INPUT_AUDIO, "audio"),
            (model_capabilities::INPUT_VIDEO, "video"),
            (model_capabilities::INPUT_PDF, "pdf"),
        ] {
            insert_detected_bool(&mut record, key, contains_modality(inputs, name));
        }
    }
    if let Some(outputs) = outputs.as_ref() {
        for (key, name) in [
            (model_capabilities::OUTPUT_TEXT, "text"),
            (model_capabilities::OUTPUT_IMAGE, "image"),
            (model_capabilities::OUTPUT_AUDIO, "audio"),
            (model_capabilities::OUTPUT_VIDEO, "video"),
        ] {
            insert_detected_bool(&mut record, key, contains_modality(outputs, name));
        }
        insert_detected_bool(
            &mut record,
            model_capabilities::OPERATION_IMAGE_GENERATION,
            contains_modality(outputs, "image"),
        );
        insert_detected_bool(
            &mut record,
            model_capabilities::OPERATION_SPEECH_GENERATION,
            contains_modality(outputs, "audio"),
        );
        insert_detected_bool(
            &mut record,
            model_capabilities::OPERATION_VIDEO_GENERATION,
            contains_modality(outputs, "video"),
        );
    }
    if inputs.is_some() || outputs.is_some() {
        insert_detected_bool(
            &mut record,
            model_capabilities::OPERATION_LANGUAGE,
            inputs
                .as_ref()
                .is_some_and(|values| contains_modality(values, "text"))
                && outputs
                    .as_ref()
                    .is_some_and(|values| contains_modality(values, "text")),
        );
        insert_detected_bool(
            &mut record,
            model_capabilities::OPERATION_TRANSCRIPTION,
            inputs
                .as_ref()
                .is_some_and(|values| contains_modality(values, "audio"))
                && outputs
                    .as_ref()
                    .is_some_and(|values| contains_modality(values, "text")),
        );
    }
    for (key, capability_names, parameter_names) in [
        (
            model_capabilities::FEATURE_TOOL_CALLING,
            &["tool_calling", "tools", "function_calling"][..],
            &["tools"][..],
        ),
        (
            model_capabilities::FEATURE_TOOL_CHOICE,
            &["tool_choice"][..],
            &["tool_choice"][..],
        ),
        (
            model_capabilities::FEATURE_STRUCTURED_OUTPUT,
            &["structured_output", "json_schema"][..],
            &["response_format", "json_schema"][..],
        ),
        (
            model_capabilities::FEATURE_REASONING,
            &["reasoning"][..],
            &["reasoning"][..],
        ),
        (
            model_capabilities::FEATURE_REASONING_EFFORT,
            &["reasoning_effort"][..],
            &["reasoning_effort"][..],
        ),
        (
            model_capabilities::FEATURE_TEMPERATURE,
            &["temperature"][..],
            &["temperature"][..],
        ),
    ] {
        if let Some(value) = extract_capability_bool(item, capability_names, parameter_names) {
            insert_detected_bool(&mut record, key, value);
        }
    }
    if let Some(value) = item
        .get("streaming")
        .or_else(|| item.pointer("/capabilities/streaming"))
        .and_then(Value::as_bool)
    {
        insert_detected_bool(&mut record, model_capabilities::FEATURE_STREAMING, value);
    }
    let observed_at = chrono::Utc::now().to_rfc3339();
    for key in record.detected.keys().cloned().collect::<Vec<_>>() {
        record.evidence.insert(
            key,
            NativeCapabilityEvidence {
                source: "provider_api".to_string(),
                conflict: false,
                source_url: Some(source_url.to_string()),
                observed_at: Some(observed_at.clone()),
                detail: Some("OpenAI-compatible model metadata".to_string()),
            },
        );
    }
    record
}

fn insert_detected_bool(record: &mut NativeModelCapabilityRecord, key: &str, value: bool) {
    record.detected.insert(
        key.to_string(),
        if value {
            CapabilitySupport::Supported
        } else {
            CapabilitySupport::Unsupported
        },
    );
}

fn contains_modality(modalities: &[String], expected: &str) -> bool {
    modalities.iter().any(|value| {
        value.eq_ignore_ascii_case(expected)
            || (expected == "pdf" && value.eq_ignore_ascii_case("document"))
    })
}

/// 从 API /models 响应的单个 model item 中提取输入模态。
/// 检查多种字段格式（不同 provider 返回不同结构）：
/// - `input_modalities`: `["text", "image"]`           (OpenRouter)
/// - `architecture.input_modalities`: `["text","image"]`  (Vercel AI Gateway, llama.cpp)
/// - `capabilities.images`: `true`                       (部分 OpenAI-compatible)
/// - `supported_input_modalities`: `["text","image"]`    (部分 provider)
fn extract_api_input_modalities(item: &Value) -> Option<Vec<String>> {
    // input_modalities (top-level)
    if let Some(arr) = item.get("input_modalities").and_then(Value::as_array) {
        let modalities: Vec<String> = arr
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();
        if !modalities.is_empty() {
            return Some(modalities);
        }
    }
    // architecture.input_modalities (llama.cpp, Vercel AI Gateway)
    if let Some(arr) = item
        .get("architecture")
        .and_then(|arch| arch.get("input_modalities"))
        .and_then(Value::as_array)
    {
        let modalities: Vec<String> = arr
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();
        if !modalities.is_empty() {
            return Some(modalities);
        }
    }
    // supported_input_modalities (alternate field name)
    if let Some(arr) = item
        .get("supported_input_modalities")
        .and_then(Value::as_array)
    {
        let modalities: Vec<String> = arr
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();
        if !modalities.is_empty() {
            return Some(modalities);
        }
    }
    // capabilities.images: true (boolean shorthand)
    if let Some(true) = item
        .get("capabilities")
        .and_then(|cap| cap.get("images"))
        .and_then(Value::as_bool)
    {
        return Some(vec!["text".to_string(), "image".to_string()]);
    }
    None
}

fn extract_api_output_modalities(item: &Value) -> Option<Vec<String>> {
    for value in [
        item.get("output_modalities"),
        item.pointer("/architecture/output_modalities"),
        item.get("supported_output_modalities"),
    ] {
        if let Some(modalities) = value.and_then(Value::as_array) {
            let values = modalities
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>();
            if !values.is_empty() {
                return Some(values);
            }
        }
    }
    None
}

fn extract_capability_bool(
    item: &Value,
    capability_names: &[&str],
    supported_parameters: &[&str],
) -> Option<bool> {
    for name in capability_names {
        if let Some(value) = item.get("capabilities").and_then(|value| value.get(*name)) {
            if let Some(value) = value.as_bool() {
                return Some(value);
            }
        }
        if let Some(value) = item.get(*name).and_then(Value::as_bool) {
            return Some(value);
        }
    }
    let parameters = item
        .get("supported_parameters")
        .or_else(|| item.get("supportedParameters"))
        .and_then(Value::as_array)?;
    Some(
        parameters
            .iter()
            .filter_map(Value::as_str)
            .any(|parameter| {
                supported_parameters
                    .iter()
                    .any(|expected| parameter.eq_ignore_ascii_case(expected))
            }),
    )
}

fn extract_context_window(item: &Value) -> Option<usize> {
    item.get("context_window")
        .or_else(|| item.get("context_length"))
        .or_else(|| item.pointer("/limits/context"))
        .and_then(Value::as_u64)
        .map(|value| value as usize)
}

pub(crate) fn is_discoverable_model_id(id: &str, _scope: ModelDiscoveryScope) -> bool {
    // A bare OpenAI-compatible /models item proves only that the model exists.
    // Capability and operation type must come from provider metadata, a sourced
    // catalog, runtime evidence, or an explicit user override—not its name.
    !id.trim().is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compatible_discovery_does_not_guess_capabilities_from_model_ids() {
        assert!(is_discoverable_model_id(
            "anthropic/claude-sonnet-4",
            ModelDiscoveryScope::CompatibleText
        ));
        assert!(is_discoverable_model_id(
            "text-embedding-3-large",
            ModelDiscoveryScope::CompatibleText
        ));
        assert!(!is_discoverable_model_id(
            "   ",
            ModelDiscoveryScope::CompatibleText
        ));
    }

    use serde_json::json;

    #[test]
    fn extract_modalities_from_top_level_field() {
        let item = json!({
            "id": "test-model",
            "input_modalities": ["text", "image"]
        });
        let result = extract_api_input_modalities(&item);
        assert_eq!(result, Some(vec!["text".to_string(), "image".to_string()]));
    }

    #[test]
    fn extract_modalities_from_architecture_field() {
        let item = json!({
            "id": "test-model",
            "architecture": {
                "input_modalities": ["text", "image", "audio"]
            }
        });
        let result = extract_api_input_modalities(&item);
        assert_eq!(
            result,
            Some(vec![
                "text".to_string(),
                "image".to_string(),
                "audio".to_string()
            ])
        );
    }

    #[test]
    fn extract_modalities_from_capabilities_images_boolean() {
        let item = json!({
            "id": "test-model",
            "capabilities": {
                "images": true
            }
        });
        let result = extract_api_input_modalities(&item);
        assert!(result.is_some());
        assert!(result.unwrap().contains(&"image".to_string()));
    }

    #[test]
    fn extract_modalities_from_supported_input_modalities() {
        let item = json!({
            "id": "test-model",
            "supported_input_modalities": ["text", "image"]
        });
        let result = extract_api_input_modalities(&item);
        assert_eq!(result, Some(vec!["text".to_string(), "image".to_string()]));
    }

    #[test]
    fn machine_metadata_builds_complete_detected_capability_record() {
        let item = json!({
            "id": "media-model",
            "input_modalities": ["text", "audio", "document"],
            "output_modalities": ["text"],
            "capabilities": {
                "tool_calling": false,
                "reasoning": true
            },
            "supported_parameters": ["temperature"]
        });
        let record = capability_record_from_model_item(&item, "https://provider.test/v1/models");

        assert_eq!(
            record.detected.get(model_capabilities::INPUT_AUDIO),
            Some(&CapabilitySupport::Supported)
        );
        assert_eq!(
            record.detected.get(model_capabilities::INPUT_PDF),
            Some(&CapabilitySupport::Supported)
        );
        assert_eq!(
            record
                .detected
                .get(model_capabilities::OPERATION_TRANSCRIPTION),
            Some(&CapabilitySupport::Supported)
        );
        assert_eq!(
            record
                .detected
                .get(model_capabilities::FEATURE_TOOL_CALLING),
            Some(&CapabilitySupport::Unsupported)
        );
        assert_eq!(
            record.detected.get(model_capabilities::FEATURE_TEMPERATURE),
            Some(&CapabilitySupport::Supported)
        );
    }

    #[test]
    fn extract_modalities_none_when_no_modality_fields() {
        let item = json!({
            "id": "test-model",
            "owned_by": "test-org"
        });
        assert_eq!(extract_api_input_modalities(&item), None);
    }

    #[test]
    fn extract_modalities_none_when_capabilities_images_false() {
        let item = json!({
            "id": "test-model",
            "capabilities": {
                "images": false
            }
        });
        assert_eq!(extract_api_input_modalities(&item), None);
    }

    #[test]
    fn all_scope_keeps_specialist_media_models() {
        assert!(is_discoverable_model_id(
            "gpt-image-1",
            ModelDiscoveryScope::All
        ));
        assert!(is_discoverable_model_id(
            "whisper-1",
            ModelDiscoveryScope::All
        ));
    }

    #[test]
    fn parses_machine_readable_tool_and_context_metadata() {
        let item = json!({
            "capabilities": { "tool_calling": false },
            "supported_parameters": ["temperature", "response_format"],
            "context_window": 32768
        });
        assert_eq!(
            extract_capability_bool(&item, &["tool_calling"], &["tools"]),
            Some(false)
        );
        assert_eq!(extract_context_window(&item), Some(32768));
    }
}
