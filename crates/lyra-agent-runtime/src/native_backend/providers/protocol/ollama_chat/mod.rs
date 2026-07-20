mod discovery;
mod request;
mod response;
mod stream;

use reqwest::{blocking::RequestBuilder, RequestBuilder as AsyncRequestBuilder};

use crate::{
    AgentRuntimeResult,
    native_backend::{NativeProviderProfile, providers::transport},
};

use super::super::types::ProtocolCatalogEntry;

pub(crate) const PROTOCOL_ID: &str = "ollama_chat";
pub(crate) const PROTOCOL_FAMILY: &str = "ollama_chat";
pub(crate) const CHAT_ENDPOINT_PATH: &str = "api/chat";
pub(crate) const TAGS_ENDPOINT_PATH: &str = "api/tags";

pub(crate) use discovery::discover_models;
pub(crate) use request::build_request_body;
pub(crate) use response::parse_response_body;
pub(crate) use stream::parse_streaming_response;
pub(crate) use stream::parse_streaming_response_async;

pub(crate) fn catalog_entry() -> ProtocolCatalogEntry {
    ProtocolCatalogEntry {
        id: PROTOCOL_ID.to_string(),
        family: PROTOCOL_FAMILY.to_string(),
        label: "Ollama Chat".to_string(),
        transport: "http_jsonl_stream".to_string(),
        runtime_supported: true,
        streaming_supported: true,
        tool_calling_supported: true,
    }
}

pub(crate) fn apply_headers(
    builder: RequestBuilder,
    provider: &NativeProviderProfile,
) -> AgentRuntimeResult<RequestBuilder> {
    if transport::auth::resolve_api_key(provider).is_some() {
        transport::auth::apply_model_auth(builder, provider)
    } else {
        Ok(builder)
    }
}

/// Async counterpart of `apply_headers` for the streaming hot path.
pub(crate) fn apply_headers_async(
    builder: AsyncRequestBuilder,
    provider: &NativeProviderProfile,
) -> AgentRuntimeResult<AsyncRequestBuilder> {
    if transport::auth::resolve_api_key(provider).is_some() {
        transport::auth::apply_model_auth_async(builder, provider)
    } else {
        Ok(builder)
    }
}
