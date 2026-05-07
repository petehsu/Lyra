use super::classifier::{is_sensitive_path, tool_is_disabled};
use crate::project_policy::EffectivePolicy;

pub fn sensitive_path_decision(
    path: &str,
    policy: &EffectivePolicy,
) -> Option<(String, Vec<String>, String)> {
    if is_sensitive_path(path, policy) == false {
        return None;
    }
    if policy.security.sensitive_file_default == "deny" {
        Some((
            "deny".to_string(),
            vec!["sensitive_file_policy_denied".to_string()],
            "high".to_string(),
        ))
    } else {
        Some((
            "allow_redacted".to_string(),
            vec!["sensitive_file_requires_redaction".to_string()],
            "medium".to_string(),
        ))
    }
}

pub fn tool_decision(
    tool_path: &str,
    policy: &EffectivePolicy,
) -> Option<(String, Vec<String>, String)> {
    if tool_is_disabled(tool_path, policy) {
        return Some((
            "deny".to_string(),
            vec!["tool_disabled_by_policy".to_string()],
            "high".to_string(),
        ));
    }
    None
}
