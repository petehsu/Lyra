use std::env;

use reqwest::{blocking::RequestBuilder, header::HeaderName};

use crate::{AgentRuntimeError, AgentRuntimeResult, native_backend::NativeProviderProfile};

pub(crate) fn resolve_api_key(provider: &NativeProviderProfile) -> Option<String> {
    provider
        .api_key
        .clone()
        .or_else(|| {
            provider
                .api_key_env
                .as_ref()
                .and_then(|key| env::var(key).ok())
        })
        .filter(|value| !value.trim().is_empty())
}

pub(crate) fn apply_model_auth(
    builder: RequestBuilder,
    provider: &NativeProviderProfile,
) -> AgentRuntimeResult<RequestBuilder> {
    let api_key = resolve_api_key(provider).ok_or_else(|| {
        AgentRuntimeError::Core(format!(
            "API key is not configured for provider {}",
            provider.label
        ))
    })?;
    let Some(header_name) = provider
        .auth_header
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(builder.bearer_auth(api_key));
    };
    let header_name = HeaderName::from_bytes(header_name.as_bytes()).map_err(|error| {
        AgentRuntimeError::Core(format!("invalid auth header `{header_name}`: {error}"))
    })?;
    Ok(builder.header(header_name, api_key))
}

#[cfg(test)]
mod tests {
    use reqwest::{blocking::Client, header::AUTHORIZATION};

    use super::*;

    fn provider(auth_header: Option<&str>) -> NativeProviderProfile {
        NativeProviderProfile {
            id: "test".to_string(),
            label: "Test".to_string(),
            route_id: "custom_openai_compatible".to_string(),
            base_url: Some("https://example.com/v1".to_string()),
            default_model: Some("gpt-test".to_string()),
            api_key: Some("sk-test".to_string()),
            api_key_env: None,
            auth_header: auth_header.map(str::to_string),
            embedding_model: None,
            models: Vec::new(),
        }
    }

    #[test]
    fn bearer_auth_is_used_when_no_custom_header_is_present() {
        let request = apply_model_auth(
            Client::new().post("https://example.com/v1/chat/completions"),
            &provider(None),
        )
        .expect("apply auth")
        .build()
        .expect("build request");

        assert_eq!(
            request
                .headers()
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
            Some("Bearer sk-test")
        );
    }

    #[test]
    fn custom_header_auth_uses_raw_api_key_without_bearer_prefix() {
        let request = apply_model_auth(
            Client::new().post("https://example.com/v1/chat/completions"),
            &provider(Some("api-key")),
        )
        .expect("apply auth")
        .build()
        .expect("build request");

        assert_eq!(
            request
                .headers()
                .get("api-key")
                .and_then(|value| value.to_str().ok()),
            Some("sk-test")
        );
        assert!(request.headers().get(AUTHORIZATION).is_none());
    }
}
