use crate::{
    AgentRuntimeError, ProviderFailure, ProviderFailureCategory, ProviderProtocolFailureKind,
    native_backend::NativeProviderProfile,
};

pub(crate) fn unknown_route_error(route_id: &str) -> AgentRuntimeError {
    AgentRuntimeError::Core(format!("unknown provider route `{route_id}`"))
}

pub(crate) fn protocol_error(
    kind: ProviderProtocolFailureKind,
    detail: impl Into<String>,
) -> AgentRuntimeError {
    AgentRuntimeError::ProviderProtocol {
        kind,
        detail: detail.into(),
    }
}

pub(crate) fn empty_response(detail: impl Into<String>) -> AgentRuntimeError {
    protocol_error(ProviderProtocolFailureKind::EmptyAssistantResponse, detail)
}

pub(crate) fn configuration_error(
    provider: &NativeProviderProfile,
    message: impl Into<String>,
) -> AgentRuntimeError {
    AgentRuntimeError::ProviderFailure {
        failure: ProviderFailure {
            provider_id: provider.id.clone(),
            route_id: provider.route_id.clone(),
            http_status: None,
            provider_code: Some("provider_not_configured".to_string()),
            provider_type: None,
            retry_after_ms: None,
            category: ProviderFailureCategory::Configuration,
            message: message.into(),
            body_preview: None,
        },
    }
}
