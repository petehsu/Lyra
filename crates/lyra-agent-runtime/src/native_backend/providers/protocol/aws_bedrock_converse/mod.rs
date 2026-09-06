mod request;
mod response;
mod sigv4;

use std::collections::{HashMap, HashSet};

use reqwest::blocking::{Client, RequestBuilder};
use serde_json::Value;

use crate::{
    AgentRuntimeError, AgentRuntimeResult,
    native_backend::{
        CapabilitySupport, NativeCapabilityEvidence, NativeModelCapabilityRecord,
        NativeProviderModel, NativeProviderProfile, ReasoningReplayField,
    },
};

use super::super::model_capabilities;
use super::super::types::ProtocolCatalogEntry;

pub(crate) const PROTOCOL_ID: &str = "aws_bedrock_converse";
pub(crate) const PROTOCOL_FAMILY: &str = "aws_bedrock_converse";
pub(crate) const CONVERSE_METHOD: &str = "converse";
pub(crate) const SIGNING_SERVICE: &str = "bedrock";
pub(crate) const DEFAULT_REGION: &str = "us-east-1";

pub(crate) use request::{RequestOptions, build_request_body_with_options};
pub(crate) use response::parse_response_body;

pub(crate) fn catalog_entry() -> ProtocolCatalogEntry {
    ProtocolCatalogEntry {
        id: PROTOCOL_ID.to_string(),
        family: PROTOCOL_FAMILY.to_string(),
        label: "AWS Bedrock Converse".to_string(),
        transport: "aws_sigv4_http_json".to_string(),
        runtime_supported: true,
        streaming_supported: false,
        tool_calling_supported: true,
    }
}

pub(crate) fn converse_path(model: &str) -> AgentRuntimeResult<String> {
    let model = model
        .trim()
        .strip_prefix("models/")
        .unwrap_or_else(|| model.trim())
        .trim();
    if model.is_empty() {
        return Err(AgentRuntimeError::Core(
            "Bedrock model id is not configured".to_string(),
        ));
    }
    Ok(format!(
        "model/{}/{}",
        urlencoding::encode(model),
        CONVERSE_METHOD
    ))
}

pub(crate) fn region_for_provider(provider: &NativeProviderProfile) -> AgentRuntimeResult<String> {
    std::env::var("AWS_REGION")
        .ok()
        .or_else(|| std::env::var("AWS_DEFAULT_REGION").ok())
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().to_string())
        .or_else(|| region_from_base_url(provider.base_url.as_deref()))
        .ok_or_else(|| {
            AgentRuntimeError::Core(
                "AWS region is not configured; set AWS_REGION or use a regional Bedrock Runtime base URL".to_string(),
            )
        })
}

fn region_from_base_url(base_url: Option<&str>) -> Option<String> {
    let host = base_url
        .and_then(|value| url::Url::parse(value).ok())
        .and_then(|url| url.host_str().map(str::to_string))?;
    let rest = host.strip_prefix("bedrock-runtime.")?;
    rest.strip_suffix(".amazonaws.com")
        .or_else(|| rest.strip_suffix(".amazonaws.com.cn"))
        .map(str::to_string)
}

pub(crate) fn build_signed_json_request(
    client: &Client,
    provider: &NativeProviderProfile,
    url: &str,
    body: &serde_json::Value,
) -> AgentRuntimeResult<RequestBuilder> {
    let body = serde_json::to_string(body)
        .map_err(|error| AgentRuntimeError::Serialization(error.to_string()))?;
    let credentials = sigv4::credentials_for_provider(provider)?;
    let region = region_for_provider(provider)?;
    sigv4::signed_json_request(
        client,
        "POST",
        url,
        &body,
        &credentials,
        &region,
        SIGNING_SERVICE,
    )
}

pub(crate) fn discover_models(
    client: &Client,
    provider: &NativeProviderProfile,
) -> AgentRuntimeResult<(
    Vec<NativeProviderModel>,
    HashMap<String, NativeModelCapabilityRecord>,
)> {
    let url = bedrock_control_url(provider, "foundation-models")?;
    let body = "{}";
    let credentials = sigv4::credentials_for_provider(provider)?;
    let region = region_for_provider(provider)?;
    let request =
        sigv4::signed_json_request(client, "GET", &url, body, &credentials, &region, "bedrock")?;
    let response = request
        .send()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let status = response.status();
    let body: Value = response
        .json()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    if !status.is_success() {
        return Err(AgentRuntimeError::Core(format!(
            "AWS Bedrock model discovery failed with status {status}: {body}"
        )));
    }
    Ok((
        parse_foundation_models(&body),
        parse_foundation_model_capability_records(&body),
    ))
}

fn bedrock_control_url(provider: &NativeProviderProfile, path: &str) -> AgentRuntimeResult<String> {
    let region = region_for_provider(provider)?;
    let base_url = provider
        .base_url
        .as_deref()
        .and_then(runtime_url_to_control_url)
        .unwrap_or_else(|| format!("https://bedrock.{region}.amazonaws.com"));
    Ok(format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    ))
}

fn runtime_url_to_control_url(value: &str) -> Option<String> {
    let mut url = url::Url::parse(value).ok()?;
    let host = url.host_str()?.to_string();
    let control_host = host.strip_prefix("bedrock-runtime.")?;
    url.set_host(Some(&format!("bedrock.{control_host}")))
        .ok()?;
    url.set_path("");
    url.set_query(None);
    Some(url.to_string().trim_end_matches('/').to_string())
}

fn parse_foundation_models(body: &Value) -> Vec<NativeProviderModel> {
    let mut models = body
        .get("modelSummaries")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            item.get("modelId")
                .and_then(Value::as_str)
                .map(|id| (id, item))
        })
        .filter(|(id, _)| !id.trim().is_empty())
        .map(|(id, item)| NativeProviderModel {
            id: id.to_string(),
            label: item
                .get("modelName")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| Some(id.to_string())),
            context_window: None,
            supports_image_input: item
                .get("inputModalities")
                .and_then(Value::as_array)
                .is_some_and(|modalities| {
                    modalities
                        .iter()
                        .filter_map(Value::as_str)
                        .any(|value| value.eq_ignore_ascii_case("IMAGE"))
                }),
            supports_tool_calling: false,
            supports_streaming: item
                .get("responseStreamingSupported")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            supports_reasoning_effort: None,
            reasoning_replay_field: ReasoningReplayField::Auto,
            requires_reasoning_field_on_assistant_messages: None,
            supports_tool_choice: None,
            enabled: true,
        })
        .collect::<Vec<_>>();
    models.sort_by(|left, right| left.id.cmp(&right.id));
    models.dedup_by(|left, right| left.id == right.id);
    models
}

fn parse_foundation_model_capability_records(
    body: &Value,
) -> HashMap<String, NativeModelCapabilityRecord> {
    const SOURCE_URL: &str =
        "https://docs.aws.amazon.com/bedrock/latest/APIReference/API_ListFoundationModels.html";
    let observed_at = chrono::Utc::now().to_rfc3339();
    body.get("modelSummaries")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let model_id = item.get("modelId").and_then(Value::as_str)?.trim();
            if model_id.is_empty() {
                return None;
            }
            let inputs = bedrock_modalities(item.get("inputModalities"));
            let outputs = bedrock_modalities(item.get("outputModalities"));
            let mut record = NativeModelCapabilityRecord::default();
            if inputs.is_some() {
                for (key, names) in [
                    (model_capabilities::INPUT_TEXT, &["TEXT"][..]),
                    (model_capabilities::INPUT_IMAGE, &["IMAGE"][..]),
                    (model_capabilities::INPUT_AUDIO, &["AUDIO"][..]),
                    (model_capabilities::INPUT_VIDEO, &["VIDEO"][..]),
                    (model_capabilities::INPUT_PDF, &["DOCUMENT", "PDF"][..]),
                ] {
                    record
                        .detected
                        .insert(key.to_string(), support_for_names(inputs.as_ref(), names));
                }
            }
            if outputs.is_some() {
                for (key, names) in [
                    (model_capabilities::OUTPUT_TEXT, &["TEXT"][..]),
                    (model_capabilities::OUTPUT_IMAGE, &["IMAGE"][..]),
                    (model_capabilities::OUTPUT_AUDIO, &["AUDIO"][..]),
                    (model_capabilities::OUTPUT_VIDEO, &["VIDEO"][..]),
                ] {
                    record
                        .detected
                        .insert(key.to_string(), support_for_names(outputs.as_ref(), names));
                }
            }
            let supported =
                |key: &str| record.detected.get(key) == Some(&CapabilitySupport::Supported);
            for (key, value) in [
                (
                    model_capabilities::OPERATION_LANGUAGE,
                    supported(model_capabilities::INPUT_TEXT)
                        && supported(model_capabilities::OUTPUT_TEXT),
                ),
                (
                    model_capabilities::OPERATION_IMAGE_GENERATION,
                    supported(model_capabilities::OUTPUT_IMAGE),
                ),
                (
                    model_capabilities::OPERATION_SPEECH_GENERATION,
                    supported(model_capabilities::OUTPUT_AUDIO),
                ),
                (
                    model_capabilities::OPERATION_TRANSCRIPTION,
                    supported(model_capabilities::INPUT_AUDIO)
                        && supported(model_capabilities::OUTPUT_TEXT),
                ),
                (
                    model_capabilities::OPERATION_VIDEO_GENERATION,
                    supported(model_capabilities::OUTPUT_VIDEO),
                ),
            ] {
                if inputs.is_some() || outputs.is_some() {
                    record.detected.insert(
                        key.to_string(),
                        if value {
                            CapabilitySupport::Supported
                        } else {
                            CapabilitySupport::Unsupported
                        },
                    );
                }
            }
            if let Some(streaming) = item
                .get("responseStreamingSupported")
                .and_then(Value::as_bool)
            {
                record.detected.insert(
                    model_capabilities::FEATURE_STREAMING.to_string(),
                    if streaming {
                        CapabilitySupport::Supported
                    } else {
                        CapabilitySupport::Unsupported
                    },
                );
            }
            for key in record.detected.keys().cloned().collect::<Vec<_>>() {
                record.evidence.insert(
                    key,
                    NativeCapabilityEvidence {
                        source: "provider_api".to_string(),
                        conflict: false,
                        source_url: Some(SOURCE_URL.to_string()),
                        observed_at: Some(observed_at.clone()),
                        detail: Some("AWS Bedrock foundation model metadata".to_string()),
                    },
                );
            }
            Some((model_id.to_string(), record))
        })
        .collect()
}

fn bedrock_modalities(value: Option<&Value>) -> Option<HashSet<String>> {
    Some(
        value?
            .as_array()?
            .iter()
            .filter_map(Value::as_str)
            .map(|value| value.trim().to_ascii_uppercase())
            .collect(),
    )
}

fn support_for_names(modalities: Option<&HashSet<String>>, names: &[&str]) -> CapabilitySupport {
    if modalities.is_some_and(|modalities| names.iter().any(|name| modalities.contains(*name))) {
        CapabilitySupport::Supported
    } else {
        CapabilitySupport::Unsupported
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider(base_url: &str) -> NativeProviderProfile {
        NativeProviderProfile {
            id: "aws-bedrock".to_string(),
            label: "AWS Bedrock".to_string(),
            route_id: "aws_bedrock".to_string(),
            base_url: Some(base_url.to_string()),
            default_model: Some("anthropic.claude-3-5-sonnet-20241022-v2:0".to_string()),
            api_key_ref: None,
            api_key: Some("AKIATEST".to_string()),
            api_key_env: None,
            auth_header: None,
            embedding_model: None,
            models: Vec::new(),
        }
    }

    #[test]
    fn builds_converse_path_with_encoded_model_id() {
        assert_eq!(
            converse_path("anthropic.claude-3-5-sonnet-20241022-v2:0").expect("path"),
            "model/anthropic.claude-3-5-sonnet-20241022-v2%3A0/converse"
        );
    }

    #[test]
    fn derives_region_from_bedrock_runtime_base_url() {
        assert_eq!(
            region_for_provider(&provider("https://bedrock-runtime.us-west-2.amazonaws.com"))
                .expect("region"),
            "us-west-2"
        );
    }

    #[test]
    fn foundation_model_metadata_preserves_media_modalities_and_specialist_models() {
        let body = serde_json::json!({
            "modelSummaries": [
                {
                    "modelId": "language-video-model",
                    "modelName": "Language Video",
                    "inputModalities": ["TEXT", "VIDEO", "DOCUMENT"],
                    "outputModalities": ["TEXT"],
                    "responseStreamingSupported": true
                },
                {
                    "modelId": "image-generator",
                    "inputModalities": ["TEXT"],
                    "outputModalities": ["IMAGE"]
                }
            ]
        });

        let models = parse_foundation_models(&body);
        assert_eq!(models.len(), 2);
        let records = parse_foundation_model_capability_records(&body);
        let language = records.get("language-video-model").expect("language model");
        assert_eq!(
            language.detected.get(model_capabilities::INPUT_VIDEO),
            Some(&CapabilitySupport::Supported)
        );
        assert_eq!(
            language.detected.get(model_capabilities::INPUT_PDF),
            Some(&CapabilitySupport::Supported)
        );
        assert_eq!(
            language
                .detected
                .get(model_capabilities::OPERATION_LANGUAGE),
            Some(&CapabilitySupport::Supported)
        );
        let image = records.get("image-generator").expect("image model");
        assert_eq!(
            image
                .detected
                .get(model_capabilities::OPERATION_IMAGE_GENERATION),
            Some(&CapabilitySupport::Supported)
        );
        assert_eq!(
            image.detected.get(model_capabilities::OPERATION_LANGUAGE),
            Some(&CapabilitySupport::Unsupported)
        );
    }
}
