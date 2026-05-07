use crate::project_policy::EffectivePolicy;

pub fn is_sensitive_path(path: &str, policy: &EffectivePolicy) -> bool {
    let normalized = path.replace('\\', "/").to_ascii_lowercase();
    if normalized.contains("/.env")
        || normalized.ends_with(".env")
        || normalized.contains("/.ssh/")
        || normalized.contains("/.aws/")
        || normalized.contains("id_rsa")
        || normalized.contains("id_ed25519")
        || normalized.ends_with(".pem")
        || normalized.ends_with(".key")
        || normalized.contains("browser/profile")
        || normalized.contains("production")
            && (normalized.ends_with(".json") || normalized.ends_with(".toml"))
    {
        return true;
    }
    policy
        .workspace
        .denied
        .iter()
        .any(|pattern| path_matches_pattern(&normalized, &pattern.to_ascii_lowercase()))
}

pub fn tool_is_disabled(tool_path: &str, policy: &EffectivePolicy) -> bool {
    let normalized = tool_path.trim();
    policy
        .tools
        .disabled
        .iter()
        .any(|tool| tool.trim() == normalized)
}

pub fn path_matches_pattern(path: &str, pattern: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if let Some(suffix) = pattern.strip_prefix("*.") {
        return path.ends_with(&format!(".{suffix}"));
    }
    if let Some(prefix) = pattern.strip_suffix(".*") {
        return path == prefix || path.starts_with(&format!("{prefix}."));
    }
    path == pattern
        || path.ends_with(&format!("/{pattern}"))
        || path.contains(&format!("/{pattern}/"))
}
