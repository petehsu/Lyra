use crate::{AgentRuntimeError, AgentRuntimeResult, native_backend::NativeProviderProfile};

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
    Ok(format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    ))
}
