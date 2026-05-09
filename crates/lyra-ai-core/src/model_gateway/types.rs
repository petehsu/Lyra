use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct ProviderRuntimeConfig {
    pub provider_id: String,
    pub protocol_id: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub auth_scheme: Option<String>,
    pub headers: HashMap<String, String>,
    pub connection_config: HashMap<String, String>,
    pub model_runtime_metadata: Option<Value>,
    pub model: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MimoRouteCandidate {
    pub protocol_id: String,
    pub base_url: String,
    pub route_mode: String,
    pub region: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Clone, Debug)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct ModelResponse {
    pub text: String,
    pub usage: Option<Usage>,
}

#[derive(Clone, Debug)]
pub struct ChatResponse {
    pub text: String,
    pub usage: Option<Usage>,
    pub tool_calls: Vec<ToolCall>,
}

#[cfg(test)]
impl ChatResponse {
    pub fn text(text: String, usage: Option<Usage>) -> Self {
        Self {
            text,
            usage,
            tool_calls: Vec::new(),
        }
    }
}
