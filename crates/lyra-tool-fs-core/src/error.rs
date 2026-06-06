use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

#[derive(Clone, Debug, Error, Serialize, Deserialize, PartialEq)]
#[error("{message}")]
#[serde(rename_all = "camelCase")]
pub struct ToolFsError {
    pub code: String,
    pub message: String,
    pub recommended_next_action: String,
    pub detail: Option<Value>,
}

impl ToolFsError {
    pub fn new(
        code: impl Into<String>,
        message: impl Into<String>,
        recommended_next_action: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            recommended_next_action: recommended_next_action.into(),
            detail: None,
        }
    }

    pub fn with_detail(mut self, detail: Value) -> Self {
        self.detail = Some(detail);
        self
    }
}
