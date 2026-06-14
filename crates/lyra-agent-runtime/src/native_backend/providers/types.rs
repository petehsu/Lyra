use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProtocolCatalogEntry {
    pub(crate) id: String,
    pub(crate) family: String,
    pub(crate) label: String,
    pub(crate) transport: String,
    pub(crate) runtime_supported: bool,
    pub(crate) streaming_supported: bool,
    pub(crate) tool_calling_supported: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderRouteDescriptor {
    pub(crate) id: String,
    pub(crate) provider_id: String,
    pub(crate) protocol_id: String,
    pub(crate) protocol_family: String,
    pub(crate) label: String,
    pub(crate) description: String,
    pub(crate) default_base_url: Option<String>,
    pub(crate) api_method: String,
    pub(crate) auth_kind: String,
    pub(crate) runtime_supported: bool,
    pub(crate) model_discovery_supported: bool,
    pub(crate) custom_headers_supported: bool,
    pub(crate) local_backend: Option<String>,
    pub(crate) catalog_section: String,
    pub(crate) quick_setup_supported: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderCapabilitySummary {
    pub(crate) supports_image_input: bool,
    pub(crate) supports_tool_calling: bool,
    pub(crate) supports_streaming: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderCatalogProfile {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) route_id: String,
    pub(crate) protocol_id: String,
    pub(crate) protocol_family: String,
    pub(crate) base_url: Option<String>,
    pub(crate) default_model: Option<String>,
    pub(crate) configured: bool,
    pub(crate) auth_header: Option<String>,
    pub(crate) model_count: usize,
    pub(crate) capabilities: ProviderCapabilitySummary,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderCatalogSnapshot {
    pub(crate) schema_version: String,
    pub(crate) default_provider: Option<String>,
    pub(crate) default_model: Option<String>,
    pub(crate) protocols: Vec<ProtocolCatalogEntry>,
    pub(crate) routes: Vec<ProviderRouteDescriptor>,
    pub(crate) profiles: Vec<ProviderCatalogProfile>,
}
