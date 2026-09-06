mod request;
mod response;
mod stream;

use std::collections::HashMap;

use reqwest::blocking::Client;

use crate::{
    AgentRuntimeResult,
    native_backend::{NativeModelCapabilityRecord, NativeProviderModel, NativeProviderProfile},
};

use super::super::types::ProtocolCatalogEntry;
use super::openai_common::{self, ModelDiscoveryScope};

pub(crate) const PROTOCOL_ID: &str = "openai_responses";
pub(crate) const PROTOCOL_FAMILY: &str = "openai_responses";
pub(crate) const ENDPOINT_PATH: &str = "responses";

pub(crate) use request::{RequestOptions, build_request_body, function_call_output_item};
pub(crate) use response::parse_response_body;
pub(crate) use stream::parse_streaming_response;
pub(crate) use stream::parse_streaming_response_async;

pub(crate) fn catalog_entry() -> ProtocolCatalogEntry {
    ProtocolCatalogEntry {
        id: PROTOCOL_ID.to_string(),
        family: PROTOCOL_FAMILY.to_string(),
        label: "OpenAI Responses".to_string(),
        transport: "http_json_stream".to_string(),
        runtime_supported: true,
        streaming_supported: true,
        tool_calling_supported: true,
    }
}

pub(crate) fn discover_models(
    client: &Client,
    provider: &NativeProviderProfile,
) -> AgentRuntimeResult<(
    Vec<NativeProviderModel>,
    HashMap<String, NativeModelCapabilityRecord>,
)> {
    openai_common::discover_models_with_capabilities(
        client,
        provider,
        true,
        ModelDiscoveryScope::All,
    )
}
