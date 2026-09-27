use super::{
    super::{protocol, types::ProviderRouteDescriptor},
    HostedOpenAiRouteHook, RouteModelDiscoveryHook,
};
use crate::{
    AgentRuntimeError, AgentRuntimeResult,
    native_backend::providers::{
        model_capabilities, protocol::openai_common::ModelDiscoveryScope, registry, transport,
    },
    native_backend::{NativeProviderModel, NativeProviderProfile, ReasoningReplayField},
};
use reqwest::{blocking::RequestBuilder, header::HeaderName};
use serde_json::{Value, json};

pub(crate) mod routing;

pub(crate) const PAY_AS_YOU_GO_ROUTE_ID: &str = "mimo";
pub(crate) const TOKEN_PLAN_CN_ROUTE_ID: &str = "mimo_token_plan_cn";
pub(crate) const TOKEN_PLAN_SGP_ROUTE_ID: &str = "mimo_token_plan_sgp";
pub(crate) const TOKEN_PLAN_AMS_ROUTE_ID: &str = "mimo_token_plan_ams";
pub(crate) const ANTHROPIC_PAY_AS_YOU_GO_ROUTE_ID: &str = "mimo_anthropic";
pub(crate) const ANTHROPIC_TOKEN_PLAN_CN_ROUTE_ID: &str = "mimo_anthropic_token_plan_cn";
pub(crate) const ANTHROPIC_TOKEN_PLAN_SGP_ROUTE_ID: &str = "mimo_anthropic_token_plan_sgp";
pub(crate) const ANTHROPIC_TOKEN_PLAN_AMS_ROUTE_ID: &str = "mimo_anthropic_token_plan_ams";
pub(crate) const PAY_AS_YOU_GO_BASE_URL: &str = "https://api.xiaomimimo.com/v1";
pub(crate) const TOKEN_PLAN_CN_BASE_URL: &str = "https://token-plan-cn.xiaomimimo.com/v1";
pub(crate) const TOKEN_PLAN_SGP_BASE_URL: &str = "https://token-plan-sgp.xiaomimimo.com/v1";
pub(crate) const TOKEN_PLAN_AMS_BASE_URL: &str = "https://token-plan-ams.xiaomimimo.com/v1";
pub(crate) const ANTHROPIC_PAY_AS_YOU_GO_BASE_URL: &str = "https://api.xiaomimimo.com/anthropic/v1";
pub(crate) const ANTHROPIC_TOKEN_PLAN_CN_BASE_URL: &str =
    "https://token-plan-cn.xiaomimimo.com/anthropic/v1";
pub(crate) const ANTHROPIC_TOKEN_PLAN_SGP_BASE_URL: &str =
    "https://token-plan-sgp.xiaomimimo.com/anthropic/v1";
pub(crate) const ANTHROPIC_TOKEN_PLAN_AMS_BASE_URL: &str =
    "https://token-plan-ams.xiaomimimo.com/anthropic/v1";

static PAY_AS_YOU_GO_HOOK: MimoRouteHook = MimoRouteHook {
    route_id: PAY_AS_YOU_GO_ROUTE_ID,
};
static TOKEN_PLAN_CN_HOOK: MimoRouteHook = MimoRouteHook {
    route_id: TOKEN_PLAN_CN_ROUTE_ID,
};
static TOKEN_PLAN_SGP_HOOK: MimoRouteHook = MimoRouteHook {
    route_id: TOKEN_PLAN_SGP_ROUTE_ID,
};
static TOKEN_PLAN_AMS_HOOK: MimoRouteHook = MimoRouteHook {
    route_id: TOKEN_PLAN_AMS_ROUTE_ID,
};
static MODEL_DISCOVERY_HOOK: MimoModelDiscoveryHook = MimoModelDiscoveryHook;

pub(crate) fn route_descriptors() -> Vec<ProviderRouteDescriptor> {
    [
        PAY_AS_YOU_GO_ROUTE_ID,
        TOKEN_PLAN_CN_ROUTE_ID,
        TOKEN_PLAN_SGP_ROUTE_ID,
        TOKEN_PLAN_AMS_ROUTE_ID,
        ANTHROPIC_PAY_AS_YOU_GO_ROUTE_ID,
        ANTHROPIC_TOKEN_PLAN_CN_ROUTE_ID,
        ANTHROPIC_TOKEN_PLAN_SGP_ROUTE_ID,
        ANTHROPIC_TOKEN_PLAN_AMS_ROUTE_ID,
    ]
    .into_iter()
    .map(descriptor_for)
    .collect()
}

fn is_official_base_url(base: &str) -> bool {
    let base = base.trim().trim_end_matches('/');
    route_descriptors().iter().any(|route| {
        route.default_base_url.as_deref().is_some_and(|url| {
            base == url || (is_anthropic_route(&route.id) && Some(base) == url.strip_suffix("/v1"))
        })
    })
}

pub(crate) fn hook(route_id: &str) -> Option<&'static dyn HostedOpenAiRouteHook> {
    match route_id {
        PAY_AS_YOU_GO_ROUTE_ID => Some(&PAY_AS_YOU_GO_HOOK),
        TOKEN_PLAN_CN_ROUTE_ID => Some(&TOKEN_PLAN_CN_HOOK),
        TOKEN_PLAN_SGP_ROUTE_ID => Some(&TOKEN_PLAN_SGP_HOOK),
        TOKEN_PLAN_AMS_ROUTE_ID => Some(&TOKEN_PLAN_AMS_HOOK),
        _ => None,
    }
}

pub(crate) fn model_discovery_hook() -> &'static dyn RouteModelDiscoveryHook {
    &MODEL_DISCOVERY_HOOK
}

pub(crate) fn is_anthropic_route(route_id: &str) -> bool {
    matches!(
        route_id,
        ANTHROPIC_PAY_AS_YOU_GO_ROUTE_ID
            | ANTHROPIC_TOKEN_PLAN_CN_ROUTE_ID
            | ANTHROPIC_TOKEN_PLAN_SGP_ROUTE_ID
            | ANTHROPIC_TOKEN_PLAN_AMS_ROUTE_ID
    )
}

pub(crate) fn is_mimo_route(route_id: &str) -> bool {
    is_anthropic_route(route_id)
        || matches!(
            route_id,
            PAY_AS_YOU_GO_ROUTE_ID
                | TOKEN_PLAN_CN_ROUTE_ID
                | TOKEN_PLAN_SGP_ROUTE_ID
                | TOKEN_PLAN_AMS_ROUTE_ID
        )
}

// MiMo OpenAI-compatible endpoints stream reasoning as `reasoning_content` on
// every chat model. models.dev keys the vendor as `xiaomi` / `xiaomi-token-plan-*`
// while Lyra route ids stay `mimo*`; catalog lookup remaps those ids. This
// route-level replay fallback only applies when neither the model record nor a
// user override names a replay field.
pub(crate) fn default_reasoning_replay_field(route_id: &str) -> Option<ReasoningReplayField> {
    matches!(
        route_id,
        PAY_AS_YOU_GO_ROUTE_ID
            | TOKEN_PLAN_CN_ROUTE_ID
            | TOKEN_PLAN_SGP_ROUTE_ID
            | TOKEN_PLAN_AMS_ROUTE_ID
    )
    .then_some(ReasoningReplayField::ReasoningContent)
}

pub(crate) fn apply_mimo_model_parameters(body: &mut Value, model: &str, tool_calling: bool) {
    let model_family = classify_model(model);
    if tool_calling && body.get("tool_choice").is_none() {
        if body.get("tools").and_then(Value::as_array).is_some() {
            body["tool_choice"] = Value::String("auto".to_string());
        } else {
            body["tool_choice"] = json!({ "type": "auto" });
        }
    }
    if let Some(thinking_type) = default_thinking_type(model_family, tool_calling) {
        body["thinking"] = json!({ "type": thinking_type });
    }
    if let Some((temperature, top_p)) = default_sampling_params(model_family) {
        insert_default_number(body, "temperature", temperature);
        insert_default_number(body, "top_p", top_p);
    }
}

pub(crate) fn validate_thinking_replay(
    messages: &[Value],
    model: &str,
    tools: &[Value],
) -> AgentRuntimeResult<()> {
    let model_family = classify_model(model);
    let tool_calling = !tools.is_empty();
    if default_thinking_type(model_family, tool_calling) != Some("enabled") {
        return Ok(());
    }
    let history_has_tool_calls = messages.iter().any(|message| {
        message.get("role").and_then(Value::as_str) == Some("tool")
            || message.get("role").and_then(Value::as_str) == Some("assistant")
                && message
                    .get("tool_calls")
                    .and_then(Value::as_array)
                    .is_some_and(|tool_calls| !tool_calls.is_empty())
    });
    if !history_has_tool_calls {
        return Ok(());
    }
    // Older transcript entries and tool-failure recovery paths can lack
    // provider-specific reasoning replay fields. Let the request continue; the
    // provider response, if any, will be surfaced as a normal assistant error
    // message instead of collapsing the whole turn state machine.
    Ok(())
}

fn descriptor_for(route_id: &str) -> ProviderRouteDescriptor {
    let (label, description, default_base_url, protocol_id, protocol_family, api_method, auth_kind) =
        match route_id {
            PAY_AS_YOU_GO_ROUTE_ID => (
                "MiMo OpenAI",
                "MiMo pay-as-you-go OpenAI-compatible endpoint.",
                PAY_AS_YOU_GO_BASE_URL,
                protocol::openai_chat_completions::PROTOCOL_ID,
                protocol::openai_chat_completions::PROTOCOL_FAMILY,
                "chatCompletions",
                "bearer_or_header",
            ),
            TOKEN_PLAN_CN_ROUTE_ID => (
                "MiMo Token Plan (CN, OpenAI)",
                "MiMo Token Plan China OpenAI-compatible endpoint.",
                TOKEN_PLAN_CN_BASE_URL,
                protocol::openai_chat_completions::PROTOCOL_ID,
                protocol::openai_chat_completions::PROTOCOL_FAMILY,
                "chatCompletions",
                "bearer_or_header",
            ),
            TOKEN_PLAN_SGP_ROUTE_ID => (
                "MiMo Token Plan (SGP, OpenAI)",
                "MiMo Token Plan Singapore OpenAI-compatible endpoint.",
                TOKEN_PLAN_SGP_BASE_URL,
                protocol::openai_chat_completions::PROTOCOL_ID,
                protocol::openai_chat_completions::PROTOCOL_FAMILY,
                "chatCompletions",
                "bearer_or_header",
            ),
            TOKEN_PLAN_AMS_ROUTE_ID => (
                "MiMo Token Plan (AMS, OpenAI)",
                "MiMo Token Plan Europe OpenAI-compatible endpoint.",
                TOKEN_PLAN_AMS_BASE_URL,
                protocol::openai_chat_completions::PROTOCOL_ID,
                protocol::openai_chat_completions::PROTOCOL_FAMILY,
                "chatCompletions",
                "bearer_or_header",
            ),
            ANTHROPIC_PAY_AS_YOU_GO_ROUTE_ID => (
                "MiMo Anthropic",
                "MiMo pay-as-you-go Anthropic-compatible endpoint.",
                ANTHROPIC_PAY_AS_YOU_GO_BASE_URL,
                protocol::anthropic_messages::PROTOCOL_ID,
                protocol::anthropic_messages::PROTOCOL_FAMILY,
                "messages",
                "api-key",
            ),
            ANTHROPIC_TOKEN_PLAN_CN_ROUTE_ID => (
                "MiMo Token Plan (CN, Anthropic)",
                "MiMo Token Plan China Anthropic-compatible endpoint.",
                ANTHROPIC_TOKEN_PLAN_CN_BASE_URL,
                protocol::anthropic_messages::PROTOCOL_ID,
                protocol::anthropic_messages::PROTOCOL_FAMILY,
                "messages",
                "api-key",
            ),
            ANTHROPIC_TOKEN_PLAN_SGP_ROUTE_ID => (
                "MiMo Token Plan (SGP, Anthropic)",
                "MiMo Token Plan Singapore Anthropic-compatible endpoint.",
                ANTHROPIC_TOKEN_PLAN_SGP_BASE_URL,
                protocol::anthropic_messages::PROTOCOL_ID,
                protocol::anthropic_messages::PROTOCOL_FAMILY,
                "messages",
                "api-key",
            ),
            ANTHROPIC_TOKEN_PLAN_AMS_ROUTE_ID => (
                "MiMo Token Plan (AMS, Anthropic)",
                "MiMo Token Plan Europe Anthropic-compatible endpoint.",
                ANTHROPIC_TOKEN_PLAN_AMS_BASE_URL,
                protocol::anthropic_messages::PROTOCOL_ID,
                protocol::anthropic_messages::PROTOCOL_FAMILY,
                "messages",
                "api-key",
            ),
            _ => unreachable!("unsupported MiMo route id"),
        };

    ProviderRouteDescriptor {
        id: route_id.to_string(),
        provider_id: "mimo".to_string(),
        protocol_id: protocol_id.to_string(),
        protocol_family: protocol_family.to_string(),
        label: label.to_string(),
        description: description.to_string(),
        default_base_url: Some(default_base_url.to_string()),
        api_method: api_method.to_string(),
        auth_kind: auth_kind.to_string(),
        runtime_supported: true,
        model_discovery_supported: true,
        custom_headers_supported: true,
        local_backend: None,
        catalog_section: "hosted".to_string(),
        quick_setup_supported: matches!(
            route_id,
            PAY_AS_YOU_GO_ROUTE_ID | ANTHROPIC_PAY_AS_YOU_GO_ROUTE_ID
        ),
        supports_stateful_prompt_contract: false,
    }
}

struct MimoModelDiscoveryHook;

impl RouteModelDiscoveryHook for MimoModelDiscoveryHook {
    fn descriptor(&self) -> ProviderRouteDescriptor {
        descriptor_for(PAY_AS_YOU_GO_ROUTE_ID)
    }

    fn discover_models(
        &self,
        provider: &NativeProviderProfile,
    ) -> AgentRuntimeResult<Vec<NativeProviderModel>> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        let discovered = if is_anthropic_route(&provider.route_id) {
            discover_anthropic_models_with_mimo_auth(&client, provider)
        } else {
            discover_openai_models_with_mimo_auth(&client, provider)
        };
        discovered
    }
}

fn discover_anthropic_models_with_mimo_auth(
    client: &reqwest::blocking::Client,
    provider: &NativeProviderProfile,
) -> AgentRuntimeResult<Vec<NativeProviderModel>> {
    let provider = openai_model_discovery_profile(provider);
    discover_openai_models_with_mimo_auth(client, &provider)
}

fn discover_openai_models_with_mimo_auth(
    client: &reqwest::blocking::Client,
    provider: &NativeProviderProfile,
) -> AgentRuntimeResult<Vec<NativeProviderModel>> {
    let url = transport::http::endpoint_url(provider, "models")?;
    let request = hook(&provider.route_id)
        .ok_or_else(|| {
            AgentRuntimeError::Core(format!(
                "model discovery is not implemented for route {}",
                provider.route_id
            ))
        })?
        .apply_request_headers(client.get(url), provider)?;
    let response = request
        .send()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let status = response.status();
    let body_text = response
        .text()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    if !status.is_success() {
        return Err(
            crate::native_backend::provider::provider_response_error_text(
                provider, status, &body_text, None,
            ),
        );
    }
    let body: Value = serde_json::from_str(&body_text)
        .map_err(|error| AgentRuntimeError::Core(format!("Invalid MiMo model list: {error}")))?;
    if !body.get("data").is_some_and(Value::is_array) {
        return Err(AgentRuntimeError::Core(
            "MiMo model list is missing data".to_string(),
        ));
    }
    Ok(body
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("id").and_then(Value::as_str))
        .filter(|id| {
            protocol::openai_common::is_discoverable_model_id(
                id,
                ModelDiscoveryScope::CompatibleText,
            )
        })
        .map(|id| {
            let route = registry::require_route(&provider.route_id).ok();
            model_capabilities::discovered_model(
                id,
                Some(id.to_string()),
                None,
                route.as_ref(),
                None,
            )
        })
        .collect())
}

fn openai_model_discovery_profile(provider: &NativeProviderProfile) -> NativeProviderProfile {
    let (route_id, base_url) = match provider.route_id.as_str() {
        ANTHROPIC_PAY_AS_YOU_GO_ROUTE_ID => (PAY_AS_YOU_GO_ROUTE_ID, PAY_AS_YOU_GO_BASE_URL),
        ANTHROPIC_TOKEN_PLAN_CN_ROUTE_ID => (TOKEN_PLAN_CN_ROUTE_ID, TOKEN_PLAN_CN_BASE_URL),
        ANTHROPIC_TOKEN_PLAN_SGP_ROUTE_ID => (TOKEN_PLAN_SGP_ROUTE_ID, TOKEN_PLAN_SGP_BASE_URL),
        ANTHROPIC_TOKEN_PLAN_AMS_ROUTE_ID => (TOKEN_PLAN_AMS_ROUTE_ID, TOKEN_PLAN_AMS_BASE_URL),
        PAY_AS_YOU_GO_ROUTE_ID => (PAY_AS_YOU_GO_ROUTE_ID, PAY_AS_YOU_GO_BASE_URL),
        TOKEN_PLAN_CN_ROUTE_ID => (TOKEN_PLAN_CN_ROUTE_ID, TOKEN_PLAN_CN_BASE_URL),
        TOKEN_PLAN_SGP_ROUTE_ID => (TOKEN_PLAN_SGP_ROUTE_ID, TOKEN_PLAN_SGP_BASE_URL),
        TOKEN_PLAN_AMS_ROUTE_ID => (TOKEN_PLAN_AMS_ROUTE_ID, TOKEN_PLAN_AMS_BASE_URL),
        _ => (
            provider.route_id.as_str(),
            provider.base_url.as_deref().unwrap_or(""),
        ),
    };
    // A manually supplied gateway must never be replaced by an official host.
    let base_url = provider
        .base_url
        .as_deref()
        .filter(|base| !is_official_base_url(base))
        .map(|base| {
            let base = base.trim_end_matches('/');
            base.strip_suffix("/anthropic/v1")
                .or_else(|| base.strip_suffix("/anthropic"))
                .map(|root| format!("{root}/v1"))
                .unwrap_or_else(|| base.to_string())
        })
        .unwrap_or_else(|| base_url.to_string());
    NativeProviderProfile {
        route_id: route_id.to_string(),
        base_url: Some(base_url),
        auth_header: provider
            .auth_header
            .clone()
            .or_else(|| Some("api-key".to_string())),
        ..provider.clone()
    }
}

struct MimoRouteHook {
    route_id: &'static str,
}

impl HostedOpenAiRouteHook for MimoRouteHook {
    fn descriptor(&self) -> ProviderRouteDescriptor {
        descriptor_for(self.route_id)
    }

    fn decorate_request_body(
        &self,
        mut body: Value,
        _provider: &NativeProviderProfile,
        model: &str,
    ) -> AgentRuntimeResult<Value> {
        let tool_calling = body
            .get("tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| !tools.is_empty());
        apply_mimo_model_parameters(&mut body, model, tool_calling);
        Ok(body)
    }

    fn apply_request_headers(
        &self,
        builder: RequestBuilder,
        provider: &NativeProviderProfile,
    ) -> AgentRuntimeResult<RequestBuilder> {
        let api_key =
            super::super::transport::auth::resolve_api_key(provider).ok_or_else(|| {
                super::super::errors::configuration_error(
                    provider,
                    format!("API key is not configured for provider {}", provider.label),
                )
            })?;
        let header_name = provider
            .auth_header
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("api-key");

        if header_name.eq_ignore_ascii_case("authorization") {
            return Ok(builder.bearer_auth(api_key));
        }

        let header_name = HeaderName::from_bytes(header_name.as_bytes()).map_err(|error| {
            AgentRuntimeError::Core(format!("invalid auth header `{header_name}`: {error}"))
        })?;
        Ok(builder.header(header_name, api_key))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MimoModelFamily {
    Pro,
    Omni,
    Flash,
    Tts,
    Asr,
    Unknown,
}

fn classify_model(model: &str) -> MimoModelFamily {
    let normalized = model.trim().to_ascii_lowercase();
    if normalized.starts_with("mimo-v2.5-pro") || normalized.starts_with("mimo-v2-pro") {
        return MimoModelFamily::Pro;
    }
    if normalized.starts_with("mimo-v2-flash") {
        return MimoModelFamily::Flash;
    }
    if normalized.starts_with("mimo-v2.5-tts") || normalized.starts_with("mimo-v2-tts") {
        return MimoModelFamily::Tts;
    }
    if normalized.starts_with("mimo-v2.5-asr") {
        return MimoModelFamily::Asr;
    }
    if normalized == "mimo-v2.5" || normalized.starts_with("mimo-v2-omni") {
        return MimoModelFamily::Omni;
    }
    MimoModelFamily::Unknown
}

fn default_thinking_type(
    model_family: MimoModelFamily,
    _tool_calling: bool,
) -> Option<&'static str> {
    match model_family {
        MimoModelFamily::Pro | MimoModelFamily::Omni => Some("enabled"),
        MimoModelFamily::Flash => Some("disabled"),
        MimoModelFamily::Tts | MimoModelFamily::Asr | MimoModelFamily::Unknown => None,
    }
}

fn default_sampling_params(model_family: MimoModelFamily) -> Option<(f64, f64)> {
    match model_family {
        MimoModelFamily::Pro | MimoModelFamily::Omni => Some((1.0, 0.95)),
        MimoModelFamily::Flash => Some((0.3, 0.95)),
        MimoModelFamily::Tts => Some((0.6, 0.95)),
        MimoModelFamily::Asr | MimoModelFamily::Unknown => None,
    }
}

fn insert_default_number(body: &mut Value, key: &str, value: f64) {
    if body.get(key).is_none() {
        body[key] = Value::from(value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider(route_id: &str, base_url: &str) -> NativeProviderProfile {
        NativeProviderProfile {
            id: "mimo-test".to_string(),
            label: "MiMo Test".to_string(),
            route_id: route_id.to_string(),
            base_url: Some(base_url.to_string()),
            default_model: None,
            api_key_ref: None,
            api_key: Some("tp-test".to_string()),
            api_key_env: None,
            auth_header: None,
            embedding_model: None,
            models: Vec::new(),
        }
    }

    #[test]
    fn validate_thinking_replay_allows_missing_reasoning_on_tool_call_assistants() {
        let messages = vec![
            json!({
                "role": "assistant",
                "content": "",
                "tool_calls": [{
                    "id": "call-tabs",
                    "type": "function",
                    "function": { "name": "tool_fs_run", "arguments": "{}" }
                }]
            }),
            json!({ "role": "tool", "tool_call_id": "call-tabs", "content": "ok" }),
        ];
        let tools = vec![json!({ "type": "function", "function": { "name": "tool_fs_run" } })];
        validate_thinking_replay(&messages, "mimo-v2.5-pro", &tools)
            .expect("missing reasoning should be tolerated");
    }

    #[test]
    fn anthropic_sgp_discovery_uses_matching_openai_models_endpoint() {
        let discovery = openai_model_discovery_profile(&provider(
            ANTHROPIC_TOKEN_PLAN_SGP_ROUTE_ID,
            ANTHROPIC_TOKEN_PLAN_SGP_BASE_URL,
        ));

        assert_eq!(discovery.route_id, TOKEN_PLAN_SGP_ROUTE_ID);
        assert_eq!(discovery.base_url.as_deref(), Some(TOKEN_PLAN_SGP_BASE_URL));
        assert_eq!(discovery.auth_header.as_deref(), Some("api-key"));
    }

    #[test]
    fn anthropic_custom_gateway_discovery_stays_on_the_configured_host() {
        let discovery = openai_model_discovery_profile(&provider(
            ANTHROPIC_TOKEN_PLAN_SGP_ROUTE_ID,
            "https://my-gateway.example/anthropic/v1",
        ));
        assert_eq!(
            discovery.base_url.as_deref(),
            Some("https://my-gateway.example/v1")
        );
    }

    #[test]
    fn model_discovery_checks_http_status_before_parsing_models() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        for (status, body) in [
            (200, r#"{"data":[{"id":"mimo-v2.5-pro"}]}"#),
            (401, r#"{"error":{"message":"Invalid API Key"}}"#),
            (502, "Bad gateway"),
            (200, r#"{"error":"not a model list"}"#),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let base_url = format!("http://{}/v1", listener.local_addr().unwrap());
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                    .unwrap();
                let mut bytes = [0; 4096];
                let size = stream.read(&mut bytes).unwrap();
                let request = String::from_utf8_lossy(&bytes[..size]).to_ascii_lowercase();
                assert!(request.starts_with("get /v1/models http/1.1"));
                assert!(request.contains("api-key: tp-test"));
                write!(stream, "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            });
            let client = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(2))
                .no_proxy()
                .build()
                .unwrap();
            let result = discover_openai_models_with_mimo_auth(
                &client,
                &provider(TOKEN_PLAN_SGP_ROUTE_ID, &base_url),
            );
            server.join().unwrap();
            if status != 200 {
                assert!(
                    matches!(result, Err(AgentRuntimeError::ProviderFailure { failure }) if failure.http_status == Some(status))
                );
            } else if body.contains("data") {
                assert_eq!(result.unwrap()[0].id, "mimo-v2.5-pro");
            } else {
                assert!(result.is_err());
            }
        }
    }

    #[test]
    fn default_reasoning_replay_field_applies_only_to_openai_routes() {
        assert_eq!(
            default_reasoning_replay_field(PAY_AS_YOU_GO_ROUTE_ID),
            Some(ReasoningReplayField::ReasoningContent)
        );
        assert_eq!(
            default_reasoning_replay_field(TOKEN_PLAN_AMS_ROUTE_ID),
            Some(ReasoningReplayField::ReasoningContent)
        );
        assert_eq!(
            default_reasoning_replay_field(ANTHROPIC_PAY_AS_YOU_GO_ROUTE_ID),
            None
        );
        assert_eq!(default_reasoning_replay_field("openai"), None);
    }
}
