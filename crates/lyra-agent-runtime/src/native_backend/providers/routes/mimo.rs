use super::{
    super::{protocol, types::ProviderRouteDescriptor},
    HostedOpenAiRouteHook,
};
use crate::{AgentRuntimeError, AgentRuntimeResult, native_backend::NativeProviderProfile};
use reqwest::{blocking::RequestBuilder, header::HeaderName};
use serde_json::{Value, json};

pub(crate) const PAY_AS_YOU_GO_ROUTE_ID: &str = "mimo";
pub(crate) const TOKEN_PLAN_CN_ROUTE_ID: &str = "mimo_token_plan_cn";
pub(crate) const TOKEN_PLAN_SGP_ROUTE_ID: &str = "mimo_token_plan_sgp";
pub(crate) const TOKEN_PLAN_AMS_ROUTE_ID: &str = "mimo_token_plan_ams";
pub(crate) const PAY_AS_YOU_GO_BASE_URL: &str = "https://api.xiaomimimo.com/v1";
pub(crate) const TOKEN_PLAN_CN_BASE_URL: &str = "https://token-plan-cn.xiaomimimo.com/v1";
pub(crate) const TOKEN_PLAN_SGP_BASE_URL: &str = "https://token-plan-sgp.xiaomimimo.com/v1";
pub(crate) const TOKEN_PLAN_AMS_BASE_URL: &str = "https://token-plan-ams.xiaomimimo.com/v1";

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

pub(crate) fn route_descriptors() -> Vec<ProviderRouteDescriptor> {
    [
        PAY_AS_YOU_GO_ROUTE_ID,
        TOKEN_PLAN_CN_ROUTE_ID,
        TOKEN_PLAN_SGP_ROUTE_ID,
        TOKEN_PLAN_AMS_ROUTE_ID,
    ]
    .into_iter()
    .map(descriptor_for)
    .collect()
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

fn descriptor_for(route_id: &str) -> ProviderRouteDescriptor {
    let (label, description, default_base_url) = match route_id {
        PAY_AS_YOU_GO_ROUTE_ID => (
            "MiMo",
            "MiMo pay-as-you-go OpenAI-compatible endpoint.",
            PAY_AS_YOU_GO_BASE_URL,
        ),
        TOKEN_PLAN_CN_ROUTE_ID => (
            "MiMo Token Plan (CN)",
            "MiMo Token Plan China region endpoint.",
            TOKEN_PLAN_CN_BASE_URL,
        ),
        TOKEN_PLAN_SGP_ROUTE_ID => (
            "MiMo Token Plan (SGP)",
            "MiMo Token Plan Singapore region endpoint.",
            TOKEN_PLAN_SGP_BASE_URL,
        ),
        TOKEN_PLAN_AMS_ROUTE_ID => (
            "MiMo Token Plan (AMS)",
            "MiMo Token Plan Europe region endpoint.",
            TOKEN_PLAN_AMS_BASE_URL,
        ),
        _ => unreachable!("unsupported MiMo route id"),
    };

    ProviderRouteDescriptor {
        id: route_id.to_string(),
        provider_id: "mimo".to_string(),
        protocol_id: protocol::openai_chat_completions::PROTOCOL_ID.to_string(),
        protocol_family: protocol::openai_chat_completions::PROTOCOL_FAMILY.to_string(),
        label: label.to_string(),
        description: description.to_string(),
        default_base_url: Some(default_base_url.to_string()),
        api_method: "chatCompletions".to_string(),
        auth_kind: "bearer_or_header".to_string(),
        runtime_supported: true,
        model_discovery_supported: false,
        custom_headers_supported: true,
        local_backend: None,
        catalog_section: "hosted".to_string(),
        quick_setup_supported: true,
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
        let model_family = classify_model(model);
        let tool_calling = body
            .get("tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| !tools.is_empty());

        if tool_calling {
            body["tool_choice"] = Value::String("auto".to_string());
        }

        if let Some(thinking_type) = default_thinking_type(model_family, tool_calling) {
            body["thinking"] = json!({ "type": thinking_type });
        }

        if let Some((temperature, top_p)) = default_sampling_params(model_family) {
            insert_default_number(&mut body, "temperature", temperature);
            insert_default_number(&mut body, "top_p", top_p);
        }

        Ok(body)
    }

    fn apply_request_headers(
        &self,
        builder: RequestBuilder,
        provider: &NativeProviderProfile,
    ) -> AgentRuntimeResult<RequestBuilder> {
        let api_key =
            super::super::transport::auth::resolve_api_key(provider).ok_or_else(|| {
                AgentRuntimeError::Core(format!(
                    "API key is not configured for provider {}",
                    provider.label
                ))
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
