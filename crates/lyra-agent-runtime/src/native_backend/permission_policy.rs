use super::*;

const PERMISSION_POLICY_VERSION: u64 = 1;
const PERMISSION_POLICY_DIR: &str = ".lyra/agent";
const PERMISSION_POLICY_FILE: &str = "permission-policy.json";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PermissionPolicyDecision {
    Allow,
    Ask,
    Deny,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
struct PermissionPolicyRule {
    #[serde(skip_serializing_if = "Option::is_none")]
    tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    action: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    risk: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pattern: Option<String>,
    decision: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PermissionPolicyConfig {
    version: u64,
    mode: String,
    rules: Vec<PermissionPolicyRule>,
    #[serde(skip_serializing_if = "Option::is_none")]
    elevation_credential_ref: Option<Value>,
}

fn home_dir() -> AgentRuntimeResult<PathBuf> {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| {
            AgentRuntimeError::Core("Unable to resolve user home directory.".to_string())
        })
}

fn permission_policy_path() -> AgentRuntimeResult<PathBuf> {
    if cfg!(test) {
        return Ok(runtime_root()
            .join(PERMISSION_POLICY_DIR)
            .join(PERMISSION_POLICY_FILE));
    }
    Ok(home_dir()?
        .join(PERMISSION_POLICY_DIR)
        .join(PERMISSION_POLICY_FILE))
}

fn approval_preset(elevation_credential_ref: Option<Value>) -> PermissionPolicyConfig {
    PermissionPolicyConfig {
        version: PERMISSION_POLICY_VERSION,
        mode: "approval".to_string(),
        rules: vec![PermissionPolicyRule {
            tool: None,
            action: None,
            risk: None,
            pattern: None,
            decision: "ask".to_string(),
        }],
        elevation_credential_ref,
    }
}

fn full_auto_preset(elevation_credential_ref: Option<Value>) -> PermissionPolicyConfig {
    PermissionPolicyConfig {
        version: PERMISSION_POLICY_VERSION,
        mode: "full_auto".to_string(),
        rules: vec![PermissionPolicyRule {
            tool: None,
            action: None,
            risk: None,
            pattern: None,
            decision: "allow".to_string(),
        }],
        elevation_credential_ref,
    }
}

fn normalized_without_credential(config: &PermissionPolicyConfig) -> PermissionPolicyConfig {
    PermissionPolicyConfig {
        elevation_credential_ref: None,
        ..config.clone()
    }
}

fn validate_policy(config: PermissionPolicyConfig) -> AgentRuntimeResult<PermissionPolicyConfig> {
    if config.version != PERMISSION_POLICY_VERSION {
        return Err(AgentRuntimeError::Core(format!(
            "Unsupported permission policy version: {}",
            config.version
        )));
    }
    if !matches!(config.mode.as_str(), "approval" | "full_auto") {
        return Err(AgentRuntimeError::Core(format!(
            "Unsupported permission policy mode: {}",
            config.mode
        )));
    }
    for rule in &config.rules {
        if !matches!(rule.decision.as_str(), "allow" | "ask" | "deny") {
            return Err(AgentRuntimeError::Core(format!(
                "Unsupported permission policy decision: {}",
                rule.decision
            )));
        }
    }
    Ok(config)
}

fn read_policy_config() -> AgentRuntimeResult<(PermissionPolicyConfig, bool, Option<String>)> {
    let path = permission_policy_path()?;
    if !path.exists() {
        return Ok((approval_preset(None), false, None));
    }
    let raw = fs::read_to_string(&path).map_err(|error| {
        AgentRuntimeError::Core(format!("Failed to read permission policy: {error}"))
    })?;
    match serde_json::from_str::<PermissionPolicyConfig>(&raw)
        .map_err(|error| {
            AgentRuntimeError::Core(format!("Invalid permission policy JSON: {error}"))
        })
        .and_then(validate_policy)
    {
        Ok(config) => Ok((config, true, None)),
        Err(error) => Ok((approval_preset(None), true, Some(error.to_string()))),
    }
}

fn write_policy_config(config: &PermissionPolicyConfig) -> AgentRuntimeResult<()> {
    let path = permission_policy_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AgentRuntimeError::Core(format!(
                "Failed to create permission policy directory: {error}"
            ))
        })?;
    }
    let serialized = serde_json::to_string_pretty(config).map_err(|error| {
        AgentRuntimeError::Core(format!("Failed to serialize permission policy: {error}"))
    })?;
    fs::write(&path, format!("{serialized}\n")).map_err(|error| {
        AgentRuntimeError::Core(format!("Failed to write permission policy: {error}"))
    })
}

fn mode_label(config: &PermissionPolicyConfig, valid: bool) -> String {
    if !valid {
        return "custom".to_string();
    }
    let normalized = normalized_without_credential(config);
    if normalized == normalized_without_credential(&approval_preset(None)) {
        return "approval".to_string();
    }
    if normalized == normalized_without_credential(&full_auto_preset(None)) {
        return "full_auto".to_string();
    }
    "custom".to_string()
}

pub(crate) fn read_permission_policy() -> AgentRuntimeResult<Value> {
    let path = permission_policy_path()?;
    let (config, exists, warning) = read_policy_config()?;
    let valid = warning.is_none();
    Ok(json!({
        "mode": mode_label(&config, valid),
        "effectiveMode": config.mode,
        "valid": valid,
        "configPath": path.to_string_lossy(),
        "exists": exists,
        "warning": warning,
        "elevationCredentialRef": config.elevation_credential_ref,
    }))
}

pub(crate) fn set_permission_policy_mode(payload: Value) -> AgentRuntimeResult<Value> {
    let mode = string_opt(&payload, "mode")
        .ok_or_else(|| AgentRuntimeError::Core("mode is required".to_string()))?;
    let elevation_credential_ref = payload.get("elevationCredentialRef").cloned();
    let current_ref = read_policy_config()
        .ok()
        .and_then(|(config, _, _)| config.elevation_credential_ref);
    let credential_ref = elevation_credential_ref.or(current_ref);
    let config = match mode.as_str() {
        "approval" => approval_preset(credential_ref),
        "full_auto" => full_auto_preset(credential_ref),
        _ => {
            return Err(AgentRuntimeError::Core(format!(
                "Unsupported permission policy mode: {mode}"
            )));
        }
    };
    write_policy_config(&config)?;
    read_permission_policy()
}

fn rule_matches(
    rule: &PermissionPolicyRule,
    display_name: &str,
    action: &str,
    risk: Option<&str>,
    input: &Value,
) -> bool {
    if rule
        .tool
        .as_deref()
        .is_some_and(|tool| tool != display_name)
    {
        return false;
    }
    if rule
        .action
        .as_deref()
        .is_some_and(|rule_action| rule_action != action)
    {
        return false;
    }
    if rule
        .risk
        .as_deref()
        .is_some_and(|rule_risk| Some(rule_risk) != risk)
    {
        return false;
    }
    if let Some(pattern) = rule.pattern.as_deref() {
        let haystack = permission_summary(display_name, action, input);
        if !haystack.contains(pattern) {
            return false;
        }
    }
    true
}

pub(crate) fn evaluate_permission_policy(
    display_name: &str,
    action: &str,
    risk: Option<&str>,
    input: &Value,
) -> PermissionPolicyDecision {
    let Ok((config, _, warning)) = read_policy_config() else {
        return PermissionPolicyDecision::Ask;
    };
    if warning.is_some() {
        return PermissionPolicyDecision::Ask;
    }
    for rule in &config.rules {
        if !rule_matches(rule, display_name, action, risk, input) {
            continue;
        }
        return match rule.decision.as_str() {
            "allow" => PermissionPolicyDecision::Allow,
            "deny" => PermissionPolicyDecision::Deny,
            _ => PermissionPolicyDecision::Ask,
        };
    }
    if config.mode == "full_auto" {
        PermissionPolicyDecision::Allow
    } else {
        PermissionPolicyDecision::Ask
    }
}
