use crate::catalog::common::{map, model, password_field, url_field};
use crate::profile::types::AiProviderPreset;

pub fn presets() -> Vec<AiProviderPreset> {
    vec![
        AiProviderPreset {
            id: "ollama".to_string(),
            provider_id: "ollama".to_string(),
            protocol_id: "ollama_chat".to_string(),
            label: "Ollama".to_string(),
            description: "Local Ollama server.".to_string(),
            section: "recommended".to_string(),
            icon_key: "ollama".to_string(),
            default_model: "qwen2.5-coder:latest".to_string(),
            discovery_mode: "mixed".to_string(),
            capability: "full".to_string(),
            model_discovery_supported: true,
            custom_headers_supported: false,
            custom_models_supported: false,
            connection_fields: vec![url_field(
                "baseUrl",
                "Base URL",
                "connection",
                "http://localhost:11434",
                true,
            )],
            auth_fields: vec![password_field(
                "apiKey", "API Key", "auth", "optional", false,
            )],
            default_connection_config: map(&[("baseUrl", "http://localhost:11434")]),
            default_auth_config: map(&[]),
            recommended_models: vec![
                model(
                    "qwen2.5-coder:latest",
                    "Qwen2.5 Coder",
                    "Common local coding model.",
                ),
                model(
                    "deepseek-r1:latest",
                    "DeepSeek R1",
                    "Common local reasoning model.",
                ),
            ],
        },
        AiProviderPreset {
            id: "lmstudio".to_string(),
            provider_id: "lmstudio".to_string(),
            protocol_id: "lmstudio_openai".to_string(),
            label: "LM Studio".to_string(),
            description: "LM Studio local OpenAI-compatible server.".to_string(),
            section: "recommended".to_string(),
            icon_key: "lmstudio".to_string(),
            default_model: "local-model".to_string(),
            discovery_mode: "mixed".to_string(),
            capability: "full".to_string(),
            model_discovery_supported: true,
            custom_headers_supported: false,
            custom_models_supported: false,
            connection_fields: vec![url_field(
                "baseUrl",
                "Base URL",
                "connection",
                "http://localhost:1234/v1",
                true,
            )],
            auth_fields: vec![password_field(
                "apiKey", "API Key", "auth", "optional", false,
            )],
            default_connection_config: map(&[("baseUrl", "http://localhost:1234/v1")]),
            default_auth_config: map(&[]),
            recommended_models: vec![
                model(
                    "local-model",
                    "Local Model",
                    "Use the models currently loaded in LM Studio.",
                ),
                model(
                    "qwen2.5-coder",
                    "Qwen2.5 Coder",
                    "Common local coding model example.",
                ),
                model(
                    "deepseek-r1-distill",
                    "DeepSeek R1 Distill",
                    "Common local reasoning model example.",
                ),
            ],
        },
    ]
}
