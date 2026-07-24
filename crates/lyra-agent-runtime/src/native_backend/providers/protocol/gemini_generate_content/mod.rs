mod request;
mod response;
mod stream;

use reqwest::{
    RequestBuilder as AsyncRequestBuilder, blocking::Client, blocking::RequestBuilder,
    header::HeaderName,
};

use crate::{
    AgentRuntimeError, AgentRuntimeResult,
    native_backend::{
        NativeProviderModel, NativeProviderProfile,
        providers::{
            errors, model_capabilities, registry, transport, types::ProviderRouteDescriptor,
        },
    },
};

use super::super::types::ProtocolCatalogEntry;

pub(crate) const PROTOCOL_ID: &str = "gemini_generate_content";
pub(crate) const PROTOCOL_FAMILY: &str = "gemini_generate_content";
pub(crate) const GENERATE_CONTENT_METHOD: &str = "generateContent";
pub(crate) const STREAM_GENERATE_CONTENT_METHOD: &str = "streamGenerateContent";
pub(crate) const API_KEY_HEADER: &str = "x-goog-api-key";

pub(crate) use request::build_request_body;
pub(crate) use response::parse_response_body;
pub(crate) use stream::parse_streaming_response;
pub(crate) use stream::parse_streaming_response_async;

pub(crate) fn catalog_entry() -> ProtocolCatalogEntry {
    ProtocolCatalogEntry {
        id: PROTOCOL_ID.to_string(),
        family: PROTOCOL_FAMILY.to_string(),
        label: "Gemini Generate Content".to_string(),
        transport: "http_json_stream".to_string(),
        runtime_supported: true,
        streaming_supported: true,
        tool_calling_supported: true,
    }
}

pub(crate) fn generate_content_path(model: &str) -> AgentRuntimeResult<String> {
    model_method_path(model, GENERATE_CONTENT_METHOD, false)
}

pub(crate) fn stream_generate_content_path(model: &str) -> AgentRuntimeResult<String> {
    model_method_path(model, STREAM_GENERATE_CONTENT_METHOD, true)
}

fn model_method_path(model: &str, method: &str, stream: bool) -> AgentRuntimeResult<String> {
    let model = model_id_for_path(model)?;
    let path = format!("models/{model}:{method}");
    if stream {
        Ok(format!("{path}?alt=sse"))
    } else {
        Ok(path)
    }
}

fn model_id_for_path(model: &str) -> AgentRuntimeResult<String> {
    let model = model
        .trim()
        .strip_prefix("models/")
        .unwrap_or_else(|| model.trim())
        .trim();
    if model.is_empty() {
        return Err(AgentRuntimeError::Core(
            "Gemini model id is not configured".to_string(),
        ));
    }
    Ok(urlencoding::encode(model).into_owned())
}

pub(crate) fn apply_headers(
    builder: RequestBuilder,
    provider: &NativeProviderProfile,
) -> AgentRuntimeResult<RequestBuilder> {
    let api_key = transport::auth::resolve_api_key(provider).ok_or_else(|| {
        errors::configuration_error(
            provider,
            format!("API key is not configured for provider {}", provider.label),
        )
    })?;
    let header_name = provider
        .auth_header
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(API_KEY_HEADER);
    let header_name = HeaderName::from_bytes(header_name.as_bytes()).map_err(|error| {
        AgentRuntimeError::Core(format!("invalid auth header `{header_name}`: {error}"))
    })?;
    Ok(builder.header(header_name, api_key))
}

/// Async counterpart of `apply_headers` for the streaming hot path.
pub(crate) fn apply_headers_async(
    builder: AsyncRequestBuilder,
    provider: &NativeProviderProfile,
) -> AgentRuntimeResult<AsyncRequestBuilder> {
    let api_key = transport::auth::resolve_api_key(provider).ok_or_else(|| {
        errors::configuration_error(
            provider,
            format!("API key is not configured for provider {}", provider.label),
        )
    })?;
    let header_name = provider
        .auth_header
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(API_KEY_HEADER);
    let header_name = HeaderName::from_bytes(header_name.as_bytes()).map_err(|error| {
        AgentRuntimeError::Core(format!("invalid auth header `{header_name}`: {error}"))
    })?;
    Ok(builder.header(header_name, api_key))
}

pub(crate) fn discover_models(
    client: &Client,
    provider: &NativeProviderProfile,
) -> AgentRuntimeResult<Vec<NativeProviderModel>> {
    let url = transport::http::endpoint_url(provider, "models")?;
    let response = apply_headers(client.get(url), provider)?
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
    let route = registry::require_route(&provider.route_id).ok();
    let mut models = body
        .get("models")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter(|item| model_supports_generate_content(item))
        .filter_map(|item| native_model_from_gemini_model(item, route.as_ref()))
        .collect::<Vec<_>>();
    models.sort_by(|left, right| left.id.cmp(&right.id));
    models.dedup_by(|left, right| left.id == right.id);
    Ok(models)
}

fn model_supports_generate_content(item: &serde_json::Value) -> bool {
    item.get("supportedGenerationMethods")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .any(|method| method == GENERATE_CONTENT_METHOD || method == STREAM_GENERATE_CONTENT_METHOD)
}

fn native_model_from_gemini_model(
    item: &serde_json::Value,
    route: Option<&ProviderRouteDescriptor>,
) -> Option<NativeProviderModel> {
    let raw_name = item.get("name").and_then(serde_json::Value::as_str)?;
    let id = raw_name.trim().strip_prefix("models/").unwrap_or(raw_name);
    let id = id.trim();
    if id.is_empty() {
        return None;
    }
    let label = item
        .get("displayName")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .or_else(|| Some(id.to_string()));
    let mut model = model_capabilities::discovered_model(id, label, None, route);
    model.context_window = item
        .get("inputTokenLimit")
        .and_then(serde_json::Value::as_u64)
        .map(|value| value as usize);
    model.supports_streaming = model_supports_stream_generate_content(item);
    Some(model)
}

fn model_supports_stream_generate_content(item: &serde_json::Value) -> bool {
    item.get("supportedGenerationMethods")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .any(|method| method == STREAM_GENERATE_CONTENT_METHOD)
}

#[cfg(test)]
mod tests {
    use reqwest::blocking::Client;

    use super::*;

    fn provider(auth_header: Option<&str>) -> NativeProviderProfile {
        NativeProviderProfile {
            id: "google-gemini".to_string(),
            label: "Google Gemini".to_string(),
            route_id: "google_gemini".to_string(),
            base_url: Some("https://generativelanguage.googleapis.com/v1beta".to_string()),
            default_model: Some("gemini-2.5-flash".to_string()),
            api_key_ref: None,
            api_key: Some("gemini-key".to_string()),
            api_key_env: None,
            auth_header: auth_header.map(str::to_string),
            embedding_model: None,
            models: Vec::new(),
        }
    }

    #[test]
    fn builds_model_method_paths() {
        assert_eq!(
            generate_content_path("models/gemini-2.5-flash").expect("path"),
            "models/gemini-2.5-flash:generateContent"
        );
        assert_eq!(
            stream_generate_content_path("gemini-2.5-flash").expect("path"),
            "models/gemini-2.5-flash:streamGenerateContent?alt=sse"
        );
    }

    #[test]
    fn applies_default_gemini_api_key_header() {
        let request = apply_headers(
            Client::new().post(
                "https://generativelanguage.googleapis.com/v1beta/models/test:generateContent",
            ),
            &provider(None),
        )
        .expect("headers")
        .build()
        .expect("request");

        assert_eq!(
            request
                .headers()
                .get(API_KEY_HEADER)
                .and_then(|value| value.to_str().ok()),
            Some("gemini-key")
        );
    }

    #[test]
    fn applies_custom_gemini_api_key_header() {
        let request = apply_headers(
            Client::new().post("https://example.com/v1beta/models/test:generateContent"),
            &provider(Some("api-key")),
        )
        .expect("headers")
        .build()
        .expect("request");

        assert_eq!(
            request
                .headers()
                .get("api-key")
                .and_then(|value| value.to_str().ok()),
            Some("gemini-key")
        );
        assert!(request.headers().get(API_KEY_HEADER).is_none());
    }
}
