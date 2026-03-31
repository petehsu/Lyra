use crate::catalog::common::{map, model, password_field, text_field, url_field};
use crate::profile::types::AiProviderPreset;

fn openai_like_preset(
    id: &str,
    provider_id: &str,
    label: &str,
    description: &str,
    icon_key: &str,
    base_url: &str,
    default_model: &str,
    recommended: Vec<crate::profile::types::AiProviderModelEntry>,
    recommended_section: bool,
) -> AiProviderPreset {
    AiProviderPreset {
        id: id.to_string(),
        provider_id: provider_id.to_string(),
        protocol_id: if provider_id == "lmstudio" {
            "lmstudio_openai".to_string()
        } else {
            "openai_compatible".to_string()
        },
        label: label.to_string(),
        description: description.to_string(),
        section: if provider_id == "custom_openai_compatible" {
            "custom".to_string()
        } else if recommended_section {
            "recommended".to_string()
        } else {
            "all".to_string()
        },
        icon_key: icon_key.to_string(),
        default_model: default_model.to_string(),
        discovery_mode: if provider_id == "azure_openai" {
            "static".to_string()
        } else {
            "mixed".to_string()
        },
        capability: if provider_id == "azure_openai" {
            "static".to_string()
        } else {
            "full".to_string()
        },
        model_discovery_supported: provider_id != "azure_openai",
        custom_headers_supported: true,
        custom_models_supported: provider_id == "custom_openai_compatible",
        connection_fields: if provider_id == "azure_openai" {
            vec![
                url_field(
                    "baseUrl",
                    "Endpoint",
                    "connection",
                    "https://example.openai.azure.com",
                    true,
                ),
                text_field(
                    "apiVersion",
                    "API Version",
                    "connection",
                    "2024-10-21",
                    true,
                ),
                text_field("deployment", "Deployment", "connection", "gpt-4o", true),
            ]
        } else {
            vec![url_field(
                "baseUrl",
                "Base URL",
                "connection",
                base_url,
                true,
            )]
        },
        auth_fields: vec![password_field("apiKey", "API Key", "auth", "sk-...", true)],
        default_connection_config: if provider_id == "azure_openai" {
            map(&[
                ("baseUrl", base_url),
                ("apiVersion", "2024-10-21"),
                ("deployment", default_model),
            ])
        } else {
            map(&[("baseUrl", base_url)])
        },
        default_auth_config: map(&[]),
        recommended_models: recommended,
    }
}

pub fn presets() -> Vec<AiProviderPreset> {
    vec![
        openai_like_preset(
            "openai",
            "openai",
            "OpenAI",
            "OpenAI platform with GPT and Codex models.",
            "openai",
            "https://api.openai.com/v1",
            "gpt-5.4-mini",
            vec![
                model("gpt-5.4", "GPT-5.4", "Flagship GPT-5.4 model."),
                model("gpt-5.4-mini", "GPT-5.4 Mini", "Fast GPT-5.4 model."),
                model(
                    "gpt-5.3-codex",
                    "GPT-5.3 Codex",
                    "Coding-optimized GPT-5 model.",
                ),
            ],
            true,
        ),
        openai_like_preset(
            "azure_openai",
            "azure_openai",
            "Azure OpenAI",
            "Azure-hosted OpenAI deployments.",
            "azure_openai",
            "https://example.openai.azure.com",
            "gpt-4o",
            vec![
                model("gpt-4o", "GPT-4o", "Azure deployment example for GPT-4o."),
                model(
                    "gpt-4.1",
                    "GPT-4.1",
                    "Azure deployment example for GPT-4.1.",
                ),
            ],
            false,
        ),
        openai_like_preset(
            "openrouter",
            "openrouter",
            "OpenRouter",
            "Unified model routing across multiple providers.",
            "openrouter",
            "https://openrouter.ai/api/v1",
            "anthropic/claude-sonnet-4.5",
            vec![
                model(
                    "anthropic/claude-sonnet-4.5",
                    "Claude Sonnet 4.5",
                    "Popular coding choice on OpenRouter.",
                ),
                model(
                    "openai/gpt-5.4",
                    "GPT-5.4",
                    "OpenAI flagship via OpenRouter.",
                ),
                model(
                    "google/gemini-3.1-pro-preview",
                    "Gemini 3.1 Pro Preview",
                    "Gemini via OpenRouter.",
                ),
            ],
            true,
        ),
        openai_like_preset(
            "deepseek",
            "deepseek",
            "DeepSeek",
            "DeepSeek API using OpenAI-compatible endpoints.",
            "deepseek",
            "https://api.deepseek.com/v1",
            "deepseek-chat",
            vec![
                model("deepseek-chat", "DeepSeek Chat", "General chat model."),
                model("deepseek-reasoner", "DeepSeek Reasoner", "Reasoning model."),
            ],
            true,
        ),
        openai_like_preset(
            "xai",
            "xai",
            "xAI",
            "xAI API with Grok models.",
            "xai",
            "https://api.x.ai/v1",
            "grok-4-fast",
            vec![
                model("grok-4", "Grok 4", "xAI flagship model."),
                model("grok-4-fast", "Grok 4 Fast", "Fast Grok variant."),
            ],
            false,
        ),
        openai_like_preset(
            "mistral",
            "mistral",
            "Mistral",
            "Mistral cloud API.",
            "mistral",
            "https://api.mistral.ai/v1",
            "mistral-large-latest",
            vec![
                model(
                    "mistral-large-latest",
                    "Mistral Large",
                    "Mistral flagship model.",
                ),
                model(
                    "codestral-latest",
                    "Codestral",
                    "Coding-optimized Mistral model.",
                ),
            ],
            false,
        ),
        openai_like_preset(
            "moonshot",
            "moonshot",
            "Moonshot",
            "Moonshot / Kimi API.",
            "moonshot",
            "https://api.moonshot.cn/v1",
            "kimi-k2-0905-preview",
            vec![
                model(
                    "kimi-k2-0905-preview",
                    "Kimi K2",
                    "Moonshot reasoning model.",
                ),
                model(
                    "moonshot-v1-8k",
                    "Moonshot v1 8k",
                    "Short context Moonshot model.",
                ),
            ],
            false,
        ),
        openai_like_preset(
            "groq",
            "groq",
            "Groq",
            "Groq API with low-latency inference.",
            "groq",
            "https://api.groq.com/openai/v1",
            "llama-3.3-70b-versatile",
            vec![
                model(
                    "llama-3.3-70b-versatile",
                    "Llama 3.3 70B",
                    "Groq hosted Llama 3.3.",
                ),
                model(
                    "deepseek-r1-distill-llama-70b",
                    "DeepSeek R1 Distill",
                    "Groq reasoning model.",
                ),
            ],
            false,
        ),
        openai_like_preset(
            "together",
            "together",
            "Together",
            "Together AI unified inference API.",
            "together",
            "https://api.together.xyz/v1",
            "meta-llama/Llama-3.3-70B-Instruct-Turbo",
            vec![
                model(
                    "meta-llama/Llama-3.3-70B-Instruct-Turbo",
                    "Llama 3.3 70B Turbo",
                    "Together hosted Llama.",
                ),
                model(
                    "Qwen/Qwen2.5-Coder-32B-Instruct",
                    "Qwen2.5 Coder",
                    "Coding-oriented open model.",
                ),
            ],
            false,
        ),
        openai_like_preset(
            "fireworks",
            "fireworks",
            "Fireworks",
            "Fireworks inference platform.",
            "fireworks",
            "https://api.fireworks.ai/inference/v1",
            "accounts/fireworks/models/deepseek-v3",
            vec![
                model(
                    "accounts/fireworks/models/deepseek-v3",
                    "DeepSeek V3",
                    "Fireworks DeepSeek V3.",
                ),
                model(
                    "accounts/fireworks/models/llama-v3p3-70b-instruct",
                    "Llama 3.3 70B",
                    "Fireworks hosted Llama.",
                ),
            ],
            false,
        ),
        openai_like_preset(
            "siliconflow",
            "siliconflow",
            "SiliconFlow",
            "SiliconFlow hosted inference.",
            "siliconflow",
            "https://api.siliconflow.cn/v1",
            "Qwen/Qwen3-Coder-30B-A3B-Instruct",
            vec![
                model(
                    "Qwen/Qwen3-Coder-30B-A3B-Instruct",
                    "Qwen3 Coder 30B",
                    "SiliconFlow coding preset.",
                ),
                model(
                    "deepseek-ai/DeepSeek-V3",
                    "DeepSeek V3",
                    "SiliconFlow DeepSeek preset.",
                ),
            ],
            false,
        ),
        openai_like_preset(
            "nebius",
            "nebius",
            "Nebius",
            "Nebius AI Studio OpenAI-compatible API.",
            "nebius",
            "https://api.studio.nebius.com/v1",
            "deepseek-ai/DeepSeek-V3",
            vec![
                model(
                    "deepseek-ai/DeepSeek-V3",
                    "DeepSeek V3",
                    "Nebius DeepSeek preset.",
                ),
                model(
                    "Qwen/Qwen2.5-Coder-32B-Instruct",
                    "Qwen2.5 Coder",
                    "Nebius coding preset.",
                ),
            ],
            false,
        ),
        openai_like_preset(
            "cerebras",
            "cerebras",
            "Cerebras",
            "Cerebras inference API.",
            "cerebras",
            "https://api.cerebras.ai/v1",
            "llama-3.3-70b",
            vec![
                model("llama-3.3-70b", "Llama 3.3 70B", "Cerebras hosted Llama."),
                model(
                    "qwen-3-coder-32b",
                    "Qwen 3 Coder",
                    "Cerebras coding preset.",
                ),
            ],
            false,
        ),
        openai_like_preset(
            "vercel_ai_gateway",
            "vercel_ai_gateway",
            "Vercel AI Gateway",
            "Vercel AI Gateway OpenAI-compatible endpoint.",
            "vercel_ai_gateway",
            "https://ai-gateway.vercel.sh/v1",
            "openai/gpt-5.4-mini",
            vec![
                model(
                    "openai/gpt-5.4-mini",
                    "GPT-5.4 Mini",
                    "OpenAI via Vercel AI Gateway.",
                ),
                model(
                    "anthropic/claude-sonnet-4.5",
                    "Claude Sonnet 4.5",
                    "Anthropic via Vercel AI Gateway.",
                ),
            ],
            false,
        ),
    ]
}
