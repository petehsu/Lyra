use lyra_runtime_protocol::RuntimeError;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostRpcRequestPayload {
    pub method: String,
    pub payload: Value,
}

pub type HostRpcResult = Result<Value, RuntimeError>;
