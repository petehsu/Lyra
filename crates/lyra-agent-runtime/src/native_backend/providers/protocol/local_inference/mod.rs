use super::super::types::ProtocolCatalogEntry;

pub(crate) const PROTOCOL_ID: &str = "local_inference";

pub(crate) fn catalog_entry() -> ProtocolCatalogEntry {
    ProtocolCatalogEntry {
        id: PROTOCOL_ID.to_string(),
        family: PROTOCOL_ID.to_string(),
        label: "Local Inference".to_string(),
        transport: "native_ffi".to_string(),
        runtime_supported: false,
        streaming_supported: false,
        tool_calling_supported: false,
    }
}
