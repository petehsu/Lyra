use lyra_sandbox::permissions::{PermissionDecision, PermissionsStore};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AllowAlwaysPersistenceOutcome {
    Persisted { pattern: String },
    SkippedNoProjectRoot,
    SkippedMissingPattern,
    RejectedUnsafePattern { pattern: String, reason: String },
    PersistFailed { pattern: String, reason: String },
}

impl AllowAlwaysPersistenceOutcome {
    pub fn action(&self) -> &'static str {
        match self {
            Self::Persisted { .. } => "persisted",
            Self::SkippedNoProjectRoot => "skipped_no_project_root",
            Self::SkippedMissingPattern => "skipped_missing_pattern",
            Self::RejectedUnsafePattern { .. } => "rejected_unsafe_pattern",
            Self::PersistFailed { .. } => "persist_failed",
        }
    }

    pub fn pattern(&self) -> Option<&str> {
        match self {
            Self::Persisted { pattern }
            | Self::RejectedUnsafePattern { pattern, .. }
            | Self::PersistFailed { pattern, .. } => Some(pattern.as_str()),
            Self::SkippedNoProjectRoot | Self::SkippedMissingPattern => None,
        }
    }

    pub fn reason(&self) -> Option<&str> {
        match self {
            Self::RejectedUnsafePattern { reason, .. } | Self::PersistFailed { reason, .. } => {
                Some(reason.as_str())
            }
            Self::Persisted { .. } | Self::SkippedNoProjectRoot | Self::SkippedMissingPattern => {
                None
            }
        }
    }
}

fn metadata_pattern(metadata: &Value) -> Option<String> {
    metadata
        .get("approvalPattern")
        .and_then(Value::as_str)
        .or_else(|| metadata.get("command").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn validate_allow_always_pattern(pattern: &str) -> Result<(), String> {
    let normalized = pattern.trim();
    if normalized.is_empty() {
        return Err("pattern is empty".to_string());
    }
    if normalized.len() > 280 {
        return Err("pattern is too long".to_string());
    }
    if normalized.chars().any(char::is_control) {
        return Err("pattern contains control characters".to_string());
    }

    let wildcard_count = normalized.chars().filter(|ch| *ch == '*').count();
    if wildcard_count > 1 {
        return Err("pattern is overly broad".to_string());
    }
    if normalized == "*" || normalized == "**" {
        return Err("pattern is globally permissive".to_string());
    }
    if normalized.starts_with('*') {
        return Err("pattern cannot start with wildcard".to_string());
    }
    if normalized.ends_with('*') {
        let prefix = normalized.trim_end_matches('*').trim();
        if prefix.len() < 3 || !prefix.chars().any(|ch| ch.is_ascii_alphanumeric()) {
            return Err("pattern wildcard prefix is too short".to_string());
        }
    }

    Ok(())
}

pub fn persist_allow_always_rule(
    project_root: Option<&str>,
    metadata: &Value,
) -> AllowAlwaysPersistenceOutcome {
    let Some(project_root) = project_root else {
        return AllowAlwaysPersistenceOutcome::SkippedNoProjectRoot;
    };
    let Some(pattern) = metadata_pattern(metadata) else {
        return AllowAlwaysPersistenceOutcome::SkippedMissingPattern;
    };

    if let Err(reason) = validate_allow_always_pattern(&pattern) {
        return AllowAlwaysPersistenceOutcome::RejectedUnsafePattern { pattern, reason };
    }

    let mut store = PermissionsStore::load(project_root);
    match store.add_rule(project_root, &pattern, PermissionDecision::AllowAlways) {
        Ok(()) => AllowAlwaysPersistenceOutcome::Persisted { pattern },
        Err(error) => AllowAlwaysPersistenceOutcome::PersistFailed {
            pattern,
            reason: error.to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::tests::support::TempStorageRoot;

    use super::{persist_allow_always_rule, AllowAlwaysPersistenceOutcome};

    #[test]
    fn persists_safe_allow_always_pattern() {
        let temp = TempStorageRoot::new();
        let project_root = temp.as_string();
        let outcome = persist_allow_always_rule(
            Some(project_root.as_str()),
            &json!({ "approvalPattern": "cargo test -p lyra-ai-core" }),
        );
        match outcome {
            AllowAlwaysPersistenceOutcome::Persisted { pattern } => {
                assert_eq!(pattern, "cargo test -p lyra-ai-core");
            }
            other => panic!("unexpected outcome: {other:?}"),
        }
    }

    #[test]
    fn rejects_globally_permissive_pattern() {
        let temp = TempStorageRoot::new();
        let project_root = temp.as_string();
        let outcome = persist_allow_always_rule(
            Some(project_root.as_str()),
            &json!({ "approvalPattern": "*" }),
        );
        match outcome {
            AllowAlwaysPersistenceOutcome::RejectedUnsafePattern { pattern, reason } => {
                assert_eq!(pattern, "*");
                assert!(reason.contains("globally permissive"));
            }
            other => panic!("unexpected outcome: {other:?}"),
        }
    }

    #[test]
    fn rejects_leading_wildcard_pattern() {
        let temp = TempStorageRoot::new();
        let project_root = temp.as_string();
        let outcome = persist_allow_always_rule(
            Some(project_root.as_str()),
            &json!({ "approvalPattern": "* install" }),
        );
        match outcome {
            AllowAlwaysPersistenceOutcome::RejectedUnsafePattern { pattern, reason } => {
                assert_eq!(pattern, "* install");
                assert!(reason.contains("start with wildcard"));
            }
            other => panic!("unexpected outcome: {other:?}"),
        }
    }

    #[test]
    fn skips_when_project_root_is_missing() {
        let outcome = persist_allow_always_rule(None, &json!({ "approvalPattern": "npm run dev" }));
        assert_eq!(outcome, AllowAlwaysPersistenceOutcome::SkippedNoProjectRoot);
    }

    #[test]
    fn falls_back_to_command_when_pattern_is_missing() {
        let temp = TempStorageRoot::new();
        let project_root = temp.as_string();
        let outcome = persist_allow_always_rule(
            Some(project_root.as_str()),
            &json!({ "command": "npm run lint" }),
        );
        match outcome {
            AllowAlwaysPersistenceOutcome::Persisted { pattern } => {
                assert_eq!(pattern, "npm run lint");
            }
            other => panic!("unexpected outcome: {other:?}"),
        }
    }
}
