use lyra_runtime_protocol::RuntimeError;
use serde_json::Value;

pub type HostRpcResult = Result<Value, RuntimeError>;
