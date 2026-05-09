use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretFinding {
    pub kind: String,
    pub confidence: String,
    pub preview: String,
}

#[derive(Clone, Debug)]
pub struct SecretDetectionReport {
    pub findings: Vec<SecretFinding>,
    pub redacted: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityGateOutcome {
    pub decision_id: Option<String>,
    pub decision: String,
    pub reason_codes: Vec<String>,
    pub risk_level: String,
    pub redaction_applied: bool,
    pub report_id: Option<String>,
    pub redacted_content: Option<String>,
}

impl SecretFinding {
    pub fn to_json(&self) -> Value {
        serde_json::json!({
            "kind": self.kind,
            "confidence": self.confidence,
            "preview": self.preview,
        })
    }
}
