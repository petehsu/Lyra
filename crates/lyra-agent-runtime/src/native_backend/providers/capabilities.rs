use crate::native_backend::{NativeProviderModel, NativeProviderProfile};

use super::{
    transport,
    types::{ProviderCapabilitySummary, ProviderRouteDescriptor},
};

pub(crate) fn summarize_model_capabilities(
    provider: &NativeProviderProfile,
) -> ProviderCapabilitySummary {
    summarize_models(&provider.models)
}

pub(crate) fn provider_profile_available(
    provider: &NativeProviderProfile,
    route: &ProviderRouteDescriptor,
) -> bool {
    transport::auth::resolve_api_key(provider).is_some()
        || (route.auth_kind.contains("none") && provider_base_url_configured(provider))
}

pub(crate) fn provider_requires_api_key(
    provider: &NativeProviderProfile,
    route: &ProviderRouteDescriptor,
) -> bool {
    transport::auth::resolve_api_key(provider).is_none() && !route.auth_kind.contains("none")
}

fn provider_base_url_configured(provider: &NativeProviderProfile) -> bool {
    provider
        .base_url
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
}

fn summarize_models(models: &[NativeProviderModel]) -> ProviderCapabilitySummary {
    if models.is_empty() {
        return ProviderCapabilitySummary {
            supports_image_input: false,
            supports_tool_calling: false,
            supports_streaming: false,
        };
    }
    ProviderCapabilitySummary {
        supports_image_input: models.iter().any(|model| model.supports_image_input),
        supports_tool_calling: models.iter().any(|model| model.supports_tool_calling),
        supports_streaming: models.iter().any(|model| model.supports_streaming),
    }
}
