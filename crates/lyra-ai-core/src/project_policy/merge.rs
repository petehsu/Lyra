use super::defaults::product_default_policy;
use super::types::{EffectivePolicy, ProjectManifest};

pub fn merge_manifest(manifest: ProjectManifest) -> EffectivePolicy {
    let mut policy = product_default_policy();
    policy.project_id = manifest.project_id;

    if let Some(trusted) = manifest.workspace.trusted {
        policy.workspace.trusted = trusted;
    }
    if manifest.workspace.writable.is_empty() == false {
        policy.workspace.writable = clean_list(manifest.workspace.writable);
    }
    if manifest.workspace.denied.is_empty() == false {
        policy.workspace.denied = clean_list(manifest.workspace.denied);
    }
    if let Some(value) = clean_string(manifest.workspace.symlink_policy) {
        policy.workspace.symlink_policy = value;
    }

    if let Some(value) = normalize_permission_mode(manifest.permission.default.as_deref()) {
        policy.permission_default = value;
    }
    if manifest.permission.allowed_modes.is_empty() == false {
        let modes = manifest
            .permission
            .allowed_modes
            .iter()
            .filter_map(|mode| normalize_permission_mode(Some(mode)))
            .collect::<Vec<_>>();
        if modes.is_empty() == false {
            policy.allowed_modes = modes;
        }
    }
    if policy
        .allowed_modes
        .iter()
        .all(|mode| mode != &policy.permission_default)
    {
        policy.allowed_modes.push(policy.permission_default.clone());
    }

    if manifest.tools.disabled.is_empty() == false {
        policy.tools.disabled = clean_list(manifest.tools.disabled);
    }
    if let Some(value) = clean_string(manifest.tools.command_policy) {
        policy.tools.command_policy = normalize_command_policy(&value);
    }
    if let Some(value) = clean_string(manifest.tools.network_policy) {
        policy.tools.network_policy = normalize_network_policy(&value);
    }
    if let Some(value) = clean_string(manifest.security.redaction_profile) {
        policy.security.redaction_profile = normalize_redaction_profile(&value);
    }
    if let Some(value) = clean_string(manifest.security.sensitive_file_default) {
        policy.security.sensitive_file_default = normalize_sensitive_file_default(&value);
    }
    policy
}

fn clean_list(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .filter_map(|value| clean_string(Some(value)))
        .collect()
}

fn clean_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| value.is_empty() == false)
}

fn normalize_permission_mode(value: Option<&str>) -> Option<String> {
    match value.map(str::trim) {
        Some("sandbox") => Some("sandbox".to_string()),
        Some("full_access") => Some("full_access".to_string()),
        Some("capsule") => Some("capsule".to_string()),
        _ => None,
    }
}

fn normalize_command_policy(value: &str) -> String {
    match value {
        "project_configured" | "restricted" => value.to_string(),
        _ => "safe_default".to_string(),
    }
}

fn normalize_network_policy(value: &str) -> String {
    match value {
        "localhost_only" | "allowed_domains" | "full" => value.to_string(),
        _ => "disabled".to_string(),
    }
}

fn normalize_redaction_profile(value: &str) -> String {
    match value {
        "balanced" | "developer" => value.to_string(),
        _ => "strict".to_string(),
    }
}

fn normalize_sensitive_file_default(value: &str) -> String {
    match value {
        "deny" => "deny".to_string(),
        _ => "allow_redacted".to_string(),
    }
}
