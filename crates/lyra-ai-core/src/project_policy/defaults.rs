use super::types::{EffectivePolicy, SecurityPolicy, ToolPolicy, WorkspacePolicy};

pub fn product_default_policy() -> EffectivePolicy {
    EffectivePolicy {
        project_id: None,
        permission_default: "sandbox".to_string(),
        allowed_modes: vec!["sandbox".to_string()],
        workspace: WorkspacePolicy {
            trusted: false,
            writable: vec![".".to_string()],
            denied: vec![
                ".env".to_string(),
                ".env.*".to_string(),
                ".ssh".to_string(),
                ".aws".to_string(),
                "*.pem".to_string(),
                "*.key".to_string(),
            ],
            symlink_policy: "deny_escape".to_string(),
        },
        tools: ToolPolicy {
            disabled: Vec::new(),
            command_policy: "safe_default".to_string(),
            network_policy: "disabled".to_string(),
        },
        security: SecurityPolicy {
            redaction_profile: "strict".to_string(),
            sensitive_file_default: "allow_redacted".to_string(),
        },
        warnings: Vec::new(),
    }
}

pub fn fallback_safe_default_policy(warning: impl Into<String>) -> EffectivePolicy {
    let mut policy = product_default_policy();
    policy.warnings.push(warning.into());
    policy
}
