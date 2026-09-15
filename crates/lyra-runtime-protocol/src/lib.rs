use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_MIN_VERSION: u32 = 2;
pub const PROTOCOL_MAX_VERSION: u32 = 2;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RuntimeEnvelope {
    Request {
        id: String,
        method: String,
        payload: Value,
    },
    Response {
        id: String,
        ok: bool,
        result: Option<Value>,
        error: Option<RuntimeError>,
    },
    Event {
        event: String,
        payload: Value,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeConnectionRole {
    PrimaryHost,
    AuxiliaryClient,
}

pub type RuntimeDataSchemas = BTreeMap<String, u32>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHelloV2Request {
    pub protocol_min_version: u32,
    pub protocol_max_version: u32,
    pub client_name: String,
    pub component_version: String,
    pub build_id: String,
    pub host_api_version: String,
    pub capabilities: Vec<String>,
    pub data_schemas: RuntimeDataSchemas,
    pub connection_role: RuntimeConnectionRole,
    pub connection_lease_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHelloV2Response {
    pub protocol_min_version: u32,
    pub protocol_max_version: u32,
    pub negotiated_protocol_version: u32,
    pub server_name: String,
    pub component_version: String,
    pub build_id: String,
    pub host_api_version: String,
    pub capabilities: Vec<String>,
    pub data_schemas: RuntimeDataSchemas,
    pub connection_role: RuntimeConnectionRole,
    pub connection_lease_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityBridgePayload {
    pub request_json: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityBridgeResult {
    pub response_json: String,
}

impl RuntimeError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(
        code: impl Into<String>,
        message: impl Into<String>,
        details: Value,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: Some(details),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn runtime_error_serializes_optional_details() {
        let error = RuntimeError::with_details(
            "cancelled",
            "turn cancelled",
            json!({ "sessionId": "session-1" }),
        );
        let value = serde_json::to_value(error).expect("serialize");
        assert_eq!(value["code"], "cancelled");
        assert_eq!(value["details"]["sessionId"], "session-1");
    }
}
