use crate::catalog::common::{map, model, password_field, text_field, textarea_field, url_field};
use crate::profile::types::AiProviderPreset;

pub fn presets() -> Vec<AiProviderPreset> {
    vec![AiProviderPreset {
        id: "custom_openai_compatible".to_string(),
        provider_id: "custom_openai_compatible".to_string(),
        protocol_id: "openai_compatible".to_string(),
        label: "Custom OpenAI-Compatible".to_string(),
        description: "Bring any OpenAI-compatible endpoint with custom headers and model aliases."
            .to_string(),
        section: "custom".to_string(),
        icon_key: "custom_openai_compatible".to_string(),
        default_model: "".to_string(),
        discovery_mode: "mixed".to_string(),
        capability: "full".to_string(),
        model_discovery_supported: true,
        custom_headers_supported: true,
        custom_models_supported: true,
        connection_fields: vec![
            text_field(
                "providerLabel",
                "Provider Label",
                "connection",
                "My Gateway",
                true,
            ),
            url_field(
                "baseUrl",
                "Base URL",
                "connection",
                "https://example.com/v1",
                true,
            ),
            textarea_field(
                "modelAliases",
                "Model Aliases",
                "advanced",
                "model-id | Display Name",
                false,
            ),
        ],
        auth_fields: vec![password_field("apiKey", "API Key", "auth", "sk-...", false)],
        default_connection_config: map(&[
            ("providerLabel", ""),
            ("baseUrl", ""),
            ("modelAliases", ""),
        ]),
        default_auth_config: map(&[]),
        recommended_models: vec![
            model(
                "",
                "Custom Model",
                "You can fill a model id directly or add aliases.",
            ),
            model(
                "gpt-4.1",
                "GPT-4.1",
                "Common OpenAI-compatible model example.",
            ),
            model(
                "claude-sonnet-4.5",
                "Claude Sonnet 4.5",
                "Common gateway-routed Anthropic model example.",
            ),
        ],
    }]
}
