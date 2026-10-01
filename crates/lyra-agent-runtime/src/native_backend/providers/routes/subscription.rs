use super::super::{protocol, types::ProviderRouteDescriptor};

pub(crate) const CLAUDE: &str = "claude_subscription";
pub(crate) const CHATGPT: &str = "chatgpt_codex";
pub(crate) const COPILOT: &str = "github_copilot";
pub(crate) const COPILOT_ACP: &str = "github_copilot_acp";
pub(crate) const GEMINI_CODE_ASSIST: &str = "gemini_code_assist";
pub(crate) const ANTIGRAVITY: &str = "antigravity";
pub(crate) const GROK_BUILD: &str = "grok_build";
pub(crate) const XAI_OAUTH: &str = "xai_oauth";
pub(crate) const CURSOR: &str = "cursor_subscription";
pub(crate) const AZURE: &str = "azure_openai";
pub(crate) const DIGITALOCEAN: &str = "digitalocean";
pub(crate) const SNOWFLAKE: &str = "snowflake_cortex";
pub(crate) const QWEN: &str = "qwen_portal";
pub(crate) const MINIMAX: &str = "minimax_oauth";

pub(crate) fn is_subscription_route(route_id: &str) -> bool {
    descriptors().iter().any(|route| route.id == route_id)
}

pub(crate) fn descriptors() -> Vec<ProviderRouteDescriptor> {
    vec![
        route(
            CLAUDE,
            "Claude Pro / Max",
            "Claude subscription via the Claude Code request contract.",
            "https://api.anthropic.com/v1",
            protocol::anthropic_messages::PROTOCOL_ID,
            protocol::anthropic_messages::PROTOCOL_FAMILY,
            "messages",
            "subscription",
        ),
        route(
            CHATGPT,
            "ChatGPT / Codex",
            "ChatGPT Plus or Pro subscription on the Codex backend.",
            "https://chatgpt.com/backend-api/codex",
            protocol::openai_responses::PROTOCOL_ID,
            protocol::openai_responses::PROTOCOL_FAMILY,
            "responses",
            "subscription",
        ),
        route(
            COPILOT,
            "GitHub Copilot",
            "Copilot subscription over the Copilot API.",
            "https://api.githubcopilot.com",
            protocol::openai_chat_completions::PROTOCOL_ID,
            protocol::openai_chat_completions::PROTOCOL_FAMILY,
            "chatCompletions",
            "subscription",
        ),
        route(
            COPILOT_ACP,
            "GitHub Copilot CLI",
            "Copilot subscription through the installed copilot CLI.",
            "acp://copilot",
            protocol::openai_chat_completions::PROTOCOL_ID,
            protocol::openai_chat_completions::PROTOCOL_FAMILY,
            "chatCompletions",
            "subscription",
        ),
        route(
            GEMINI_CODE_ASSIST,
            "Gemini Code Assist",
            "Google Code Assist subscription.",
            "https://cloudcode-pa.googleapis.com",
            protocol::gemini_generate_content::PROTOCOL_ID,
            protocol::gemini_generate_content::PROTOCOL_FAMILY,
            "generateContent",
            "subscription",
        ),
        route(
            ANTIGRAVITY,
            "Antigravity",
            "Antigravity subscription on the Cloud Code backend.",
            "https://daily-cloudcode-pa.googleapis.com",
            protocol::gemini_generate_content::PROTOCOL_ID,
            protocol::gemini_generate_content::PROTOCOL_FAMILY,
            "generateContent",
            "subscription",
        ),
        route(
            GROK_BUILD,
            "Grok Build",
            "Grok CLI subscription on the Grok chat proxy. Shares the xAI login.",
            "https://cli-chat-proxy.grok.com/v1",
            protocol::openai_chat_completions::PROTOCOL_ID,
            protocol::openai_chat_completions::PROTOCOL_FAMILY,
            "chatCompletions",
            "subscription",
        ),
        route(
            XAI_OAUTH,
            "xAI Grok",
            "SuperGrok or Premium+ subscription. Shares the Grok Build login.",
            "https://api.x.ai/v1",
            protocol::openai_chat_completions::PROTOCOL_ID,
            protocol::openai_chat_completions::PROTOCOL_FAMILY,
            "chatCompletions",
            "subscription",
        ),
        route(
            CURSOR,
            "Cursor",
            "Cursor account via the Agent service, an API key, or the local IDE login.",
            "https://agentn.global.api5.cursor.sh",
            protocol::openai_chat_completions::PROTOCOL_ID,
            protocol::openai_chat_completions::PROTOCOL_FAMILY,
            "chatCompletions",
            "subscription-or-key",
        ),
        route(
            AZURE,
            "Azure OpenAI",
            "Microsoft Entra login or an Azure OpenAI API key.",
            "https://YOUR_RESOURCE.openai.azure.com/openai/v1",
            protocol::openai_chat_completions::PROTOCOL_ID,
            protocol::openai_chat_completions::PROTOCOL_FAMILY,
            "chatCompletions",
            "subscription-or-key",
        ),
        route(
            DIGITALOCEAN,
            "DigitalOcean",
            "DigitalOcean account login for Gradient inference.",
            "https://inference.do-ai.run/v1",
            protocol::openai_chat_completions::PROTOCOL_ID,
            protocol::openai_chat_completions::PROTOCOL_FAMILY,
            "chatCompletions",
            "subscription-or-key",
        ),
        route(
            SNOWFLAKE,
            "Snowflake Cortex",
            "Snowflake account login. Put the account locator in the login account field.",
            "https://ACCOUNT.snowflakecomputing.com/api/v2/cortex/v1",
            protocol::openai_chat_completions::PROTOCOL_ID,
            protocol::openai_chat_completions::PROTOCOL_FAMILY,
            "chatCompletions",
            "subscription",
        ),
        route(
            QWEN,
            "Qwen",
            "Qwen portal subscription from the Qwen CLI login.",
            "https://portal.qwen.ai/v1",
            protocol::openai_chat_completions::PROTOCOL_ID,
            protocol::openai_chat_completions::PROTOCOL_FAMILY,
            "chatCompletions",
            "subscription",
        ),
        route(
            MINIMAX,
            "MiniMax",
            "MiniMax subscription over the Anthropic-compatible endpoint.",
            "https://api.minimax.io/anthropic/v1",
            protocol::anthropic_messages::PROTOCOL_ID,
            protocol::anthropic_messages::PROTOCOL_FAMILY,
            "messages",
            "subscription",
        ),
    ]
}

fn route(
    id: &str,
    label: &str,
    description: &str,
    base_url: &str,
    protocol_id: &str,
    protocol_family: &str,
    api_method: &str,
    auth_kind: &str,
) -> ProviderRouteDescriptor {
    ProviderRouteDescriptor {
        id: id.to_string(),
        provider_id: id.to_string(),
        protocol_id: protocol_id.to_string(),
        protocol_family: protocol_family.to_string(),
        label: label.to_string(),
        description: description.to_string(),
        default_base_url: Some(base_url.to_string()),
        api_method: api_method.to_string(),
        auth_kind: auth_kind.to_string(),
        runtime_supported: true,
        model_discovery_supported: true,
        custom_headers_supported: true,
        local_backend: None,
        catalog_section: "subscription".to_string(),
        quick_setup_supported: true,
        supports_stateful_prompt_contract: id == CHATGPT,
    }
}
