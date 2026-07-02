use crate::{
    AgentRuntimeError, AgentRuntimeResult,
    native_backend::{
        NativeProviderProfile,
        providers::{protocol, registry},
    },
};

pub(crate) fn chat_completions_url(provider: &NativeProviderProfile) -> AgentRuntimeResult<String> {
    endpoint_url(provider, "chat/completions")
}

pub(crate) fn endpoint_url(
    provider: &NativeProviderProfile,
    path: &str,
) -> AgentRuntimeResult<String> {
    let base_url = provider
        .base_url
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            AgentRuntimeError::Core("provider base URL is not configured".to_string())
        })?;
    let base_url = normalized_base_url(provider, &base_url, path);
    Ok(format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    ))
}

fn normalized_base_url(provider: &NativeProviderProfile, base_url: &str, path: &str) -> String {
    let with_scheme = ensure_url_scheme(base_url.trim());
    if should_append_v1(provider, path, &with_scheme) {
        return format!("{}/v1", with_scheme.trim_end_matches('/'));
    }
    with_scheme
}

fn ensure_url_scheme(value: &str) -> String {
    if value.contains("://") {
        return value.to_string();
    }
    let lower = value.to_ascii_lowercase();
    let scheme = if lower.starts_with("localhost")
        || lower.starts_with("127.")
        || lower.starts_with("0.0.0.0")
        || lower.starts_with("[::1]")
    {
        "http"
    } else {
        "https"
    };
    format!("{scheme}://{value}")
}

fn should_append_v1(provider: &NativeProviderProfile, path: &str, base_url: &str) -> bool {
    if has_api_version_segment(base_url) {
        return false;
    }
    if !matches!(
        path,
        "models" | "chat/completions" | "responses" | "messages"
    ) {
        return false;
    }
    registry::route_descriptor(&provider.route_id).is_some_and(|route| {
        route.protocol_id == protocol::openai_chat_completions::PROTOCOL_ID
            || route.protocol_id == protocol::openai_responses::PROTOCOL_ID
            || route.protocol_id == protocol::anthropic_messages::PROTOCOL_ID
    })
}

fn has_api_version_segment(base_url: &str) -> bool {
    url::Url::parse(base_url)
        .ok()
        .and_then(|url| {
            url.path_segments().map(|segments| {
                segments
                    .filter(|segment| !segment.trim().is_empty())
                    .any(|segment| {
                        let lower = segment.to_ascii_lowercase();
                        lower == "v1"
                            || lower == "v1beta"
                            || lower.starts_with('v')
                                && lower[1..]
                                    .chars()
                                    .next()
                                    .is_some_and(|ch| ch.is_ascii_digit())
                    })
            })
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider(route_id: &str, base_url: &str) -> NativeProviderProfile {
        NativeProviderProfile {
            id: "test".to_string(),
            label: "Test".to_string(),
            route_id: route_id.to_string(),
            base_url: Some(base_url.to_string()),
            default_model: Some("model".to_string()),
            api_key: None,
            api_key_env: None,
            auth_header: None,
            embedding_model: None,
            models: Vec::new(),
        }
    }

    #[test]
    fn openai_compatible_urls_add_scheme_and_v1_when_missing() {
        let url = endpoint_url(
            &provider("custom_openai_compatible", "api.example.com"),
            "models",
        )
        .expect("endpoint url");

        assert_eq!(url, "https://api.example.com/v1/models");
    }

    #[test]
    fn openai_compatible_urls_keep_existing_api_version() {
        let url = endpoint_url(
            &provider(
                "custom_openai_compatible",
                "https://api.example.com/openai/v1",
            ),
            "chat/completions",
        )
        .expect("endpoint url");

        assert_eq!(url, "https://api.example.com/openai/v1/chat/completions");
    }

    #[test]
    fn localhost_without_scheme_uses_http() {
        let url = endpoint_url(
            &provider("local_openai_compatible", "localhost:8000"),
            "models",
        )
        .expect("endpoint url");

        assert_eq!(url, "http://localhost:8000/v1/models");
    }

    #[test]
    fn ollama_urls_do_not_add_v1() {
        let url =
            endpoint_url(&provider("ollama", "localhost:11434"), "api/tags").expect("endpoint url");

        assert_eq!(url, "http://localhost:11434/api/tags");
    }
}
