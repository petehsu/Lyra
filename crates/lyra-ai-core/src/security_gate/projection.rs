use crate::storage::AgentSessionDetail;
use serde_json::{json, Value};

pub(crate) fn project_security_prompt_value(detail: &AgentSessionDetail) -> Value {
    json!({
        "policy": detail.policy_summary,
        "security": detail.security_summary,
    })
}
