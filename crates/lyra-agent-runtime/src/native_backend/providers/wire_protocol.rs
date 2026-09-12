use super::protocol::{
    anthropic_messages, gemini_generate_content, openai_chat_completions, openai_responses,
};
use super::routes::opencode::{GO_ROUTE_ID, ZEN_ROUTE_ID};
use crate::native_backend::{
    NativeModelCapabilityRecord, NativeProviderModel, NativeProviderProfile,
};

pub(crate) fn protocol_from_api_npm(npm: Option<&str>) -> &'static str {
    match npm.map(str::trim) {
        Some("@ai-sdk/openai" | "@ai-sdk/azure") => openai_responses::PROTOCOL_ID,
        Some("@ai-sdk/anthropic" | "@ai-sdk/google-vertex/anthropic") => {
            anthropic_messages::PROTOCOL_ID
        }
        Some("@ai-sdk/google" | "@ai-sdk/google-vertex") => gemini_generate_content::PROTOCOL_ID,
        _ => openai_chat_completions::PROTOCOL_ID,
    }
}

pub(crate) fn route_protocol_id(route_id: &str, api_npm: Option<&str>) -> Option<&'static str> {
    match route_id {
        ZEN_ROUTE_ID | GO_ROUTE_ID => Some(protocol_from_api_npm(api_npm)),
        _ => None,
    }
}

pub(crate) fn route_api_method(route_id: &str, api_npm: Option<&str>) -> Option<&'static str> {
    Some(api_method_for_protocol(route_protocol_id(
        route_id, api_npm,
    )?))
}

pub(crate) fn api_method_for_protocol(protocol_id: &str) -> &'static str {
    match protocol_id {
        openai_responses::PROTOCOL_ID => "responses",
        anthropic_messages::PROTOCOL_ID => "messages",
        gemini_generate_content::PROTOCOL_ID => "generateContent",
        _ => "chatCompletions",
    }
}

pub(crate) fn api_npm_from<'a>(
    model: Option<&'a NativeProviderModel>,
    record: Option<&'a NativeModelCapabilityRecord>,
) -> Option<&'a str> {
    model
        .and_then(|model| model.api_npm.as_deref())
        .or_else(|| record.and_then(|record| record.api_npm.as_deref()))
}

pub(crate) fn protocol_id_for(provider: &NativeProviderProfile, api_npm: Option<&str>) -> String {
    if let Some(protocol_id) = route_protocol_id(&provider.route_id, api_npm) {
        return protocol_id.to_string();
    }
    super::registry::require_route(&provider.route_id)
        .map(|route| route.protocol_id.clone())
        .unwrap_or_default()
}

/// Unlocked request path: model field, then capability record, then stale catalog cache.
pub(crate) fn api_npm_for(provider: &NativeProviderProfile, model: &str) -> Option<String> {
    if let Some(npm) = provider
        .models
        .iter()
        .find(|item| item.id == model)
        .and_then(|item| item.api_npm.clone())
    {
        return Some(npm);
    }
    if let Some(npm) = crate::native_backend::state()
        .try_lock()
        .ok()
        .and_then(|state| {
            state
                .model_capabilities
                .get(&provider.id)
                .and_then(|records| records.get(model))
                .and_then(|record| record.api_npm.clone())
        })
    {
        return Some(npm);
    }
    super::models_dev::cached_api_npm(&provider.route_id, model)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_known_sdk_packages_and_falls_back_to_chat() {
        let cases = [
            (Some("@ai-sdk/openai"), openai_responses::PROTOCOL_ID),
            (Some("@ai-sdk/azure"), openai_responses::PROTOCOL_ID),
            (Some("@ai-sdk/anthropic"), anthropic_messages::PROTOCOL_ID),
            (
                Some("@ai-sdk/google-vertex/anthropic"),
                anthropic_messages::PROTOCOL_ID,
            ),
            (Some("@ai-sdk/google"), gemini_generate_content::PROTOCOL_ID),
            (
                Some("@ai-sdk/google-vertex"),
                gemini_generate_content::PROTOCOL_ID,
            ),
            (None, openai_chat_completions::PROTOCOL_ID),
            (
                Some("@ai-sdk/openai-compatible"),
                openai_chat_completions::PROTOCOL_ID,
            ),
            (
                Some("@ai-sdk/mistral"),
                openai_chat_completions::PROTOCOL_ID,
            ),
            (Some("  @ai-sdk/openai  "), openai_responses::PROTOCOL_ID),
        ];
        for (npm, expected) in cases {
            assert_eq!(protocol_from_api_npm(npm), expected, "npm={npm:?}");
        }
    }

    #[test]
    fn only_opencode_routes_override_protocol_from_npm() {
        assert_eq!(
            route_protocol_id(ZEN_ROUTE_ID, Some("@ai-sdk/openai")),
            Some(openai_responses::PROTOCOL_ID)
        );
        assert_eq!(
            route_protocol_id(GO_ROUTE_ID, Some("@ai-sdk/anthropic")),
            Some(anthropic_messages::PROTOCOL_ID)
        );
        assert_eq!(
            route_protocol_id(ZEN_ROUTE_ID, None),
            Some(openai_chat_completions::PROTOCOL_ID)
        );
        assert_eq!(route_protocol_id("openai", Some("@ai-sdk/openai")), None);
        assert_eq!(
            route_api_method(ZEN_ROUTE_ID, Some("@ai-sdk/google")),
            Some("generateContent")
        );
        assert_eq!(
            route_api_method("anthropic", Some("@ai-sdk/anthropic")),
            None
        );
    }
}
