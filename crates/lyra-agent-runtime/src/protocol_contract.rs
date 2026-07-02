use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolContract {
    pub protocol_version: u32,
}

impl Default for ProtocolContract {
    fn default() -> Self {
        current_protocol_contract()
    }
}

pub fn current_protocol_contract() -> ProtocolContract {
    ProtocolContract {
        protocol_version: PROTOCOL_VERSION,
    }
}

pub fn current_protocol_contract_json() -> Value {
    serde_json::to_value(current_protocol_contract()).unwrap_or_else(|_| json!({}))
}
