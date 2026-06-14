mod request;
mod response;
mod sigv4;

use reqwest::blocking::{Client, RequestBuilder};

use crate::{AgentRuntimeError, AgentRuntimeResult, native_backend::NativeProviderProfile};

use super::super::types::ProtocolCatalogEntry;

pub(crate) const PROTOCOL_ID: &str = "aws_bedrock_converse";
pub(crate) const PROTOCOL_FAMILY: &str = "aws_bedrock_converse";
pub(crate) const CONVERSE_METHOD: &str = "converse";
pub(crate) const SIGNING_SERVICE: &str = "bedrock";
pub(crate) const DEFAULT_REGION: &str = "us-east-1";

pub(crate) use request::build_request_body;
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
}
