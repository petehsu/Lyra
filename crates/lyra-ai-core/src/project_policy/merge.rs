use super::defaults::product_default_policy;
use super::types::{
    AgentVmProjectPolicy, EffectivePolicy, ExternalWritePolicy, ModelFallbackPolicy,
    ModelRoutingPolicy, NetworkPolicy, ProjectManifest,
};
use serde_json::Value;

pub fn merge_manifest(manifest: ProjectManifest) -> EffectivePolicy {
    let mut policy = product_default_policy();
    policy.project_id = manifest.project_id;
    policy.name = manifest.name;

    if let Some(value) = clean_string(manifest.workspace.root) {
        policy.workspace.root = value;
    }
    if let Some(trusted) = manifest.workspace.trusted {
        policy.workspace.trusted = trusted;
    }
    if manifest.workspace.trusted_roots.is_empty() == false {
        policy.workspace.trusted_roots = clean_list(manifest.workspace.trusted_roots);
    }
    if manifest.workspace.writable.is_empty() == false {
        policy.workspace.writable = clean_list(manifest.workspace.writable);
    }
    if manifest.workspace.readonly.is_empty() == false {
        policy.workspace.readonly = clean_list(manifest.workspace.readonly);
    }
    if manifest.workspace.denied.is_empty() == false {
        policy.workspace.denied = clean_list(manifest.workspace.denied);
    }
    if manifest.workspace.include_globs.is_empty() == false {
        policy.workspace.include_globs = clean_list(manifest.workspace.include_globs);
    }
    if manifest.workspace.exclude_globs.is_empty() == false {
        policy.workspace.exclude_globs = clean_list(manifest.workspace.exclude_globs);
    }
    if manifest.workspace.max_file_read_bytes.is_some() {
        policy.workspace.max_file_read_bytes = manifest.workspace.max_file_read_bytes;
    }
    if manifest.workspace.max_directory_walk_entries.is_some() {
        policy.workspace.max_directory_walk_entries = manifest.workspace.max_directory_walk_entries;
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
    policy.permission.default_mode = policy.permission_default.clone();
    policy.permission.allowed_modes = policy.allowed_modes.clone();
    if let Some(value) =
        normalize_execution_target(manifest.permission.default_execution_target.as_deref())
    {
        policy.permission.default_execution_target = value;
    }
    if manifest.permission.allowed_execution_targets.is_empty() == false {
        let targets = manifest
            .permission
            .allowed_execution_targets
            .iter()
            .filter_map(|target| normalize_execution_target(Some(target)))
            .collect::<Vec<_>>();
        if targets.is_empty() == false {
            policy.permission.allowed_execution_targets = targets;
        }
    }
    if policy
        .permission
        .allowed_execution_targets
        .iter()
        .all(|target| target != &policy.permission.default_execution_target)
    {
        policy
            .permission
            .allowed_execution_targets
            .push(policy.permission.default_execution_target.clone());
    }
    if let Some(value) = manifest.permission.allow_temporary_elevation {
        policy.permission.allow_temporary_elevation = value;
    }
    if let Some(value) = manifest.permission.full_access_requires_user_enablement {
        policy.permission.full_access_requires_user_enablement = value;
    }
    if let Some(value) = manifest.permission.agent_vm_requires_user_enablement {
        policy.permission.agent_vm_requires_user_enablement = value;
    }
    if let Some(value) = manifest.permission.approval_timeout_seconds {
        policy.permission.approval_timeout_seconds = value;
    }
    if let Some(value) = manifest.permission.auto_approval_audit_required {
        policy.permission.auto_approval_audit_required = value;
    }

    merge_model_policy(&mut policy.models, manifest.models);

    if manifest.tools.enabled.is_empty() == false {
        policy.tools.enabled = clean_list(manifest.tools.enabled);
    }
    if manifest.tools.disabled.is_empty() == false {
        policy.tools.disabled = clean_list(manifest.tools.disabled);
    }
    if let Some(value) = manifest.tools.command_policy {
        merge_command_policy(&mut policy, value);
    }
    if let Some(value) = manifest.tools.network_policy {
        merge_network_policy(&mut policy.tools.network, value);
        policy.tools.network_policy = policy.tools.network.mode.clone();
    }
    if let Some(value) = manifest.tools.external_write_policy {
        policy.tools.external_write =
            parse_external_write_policy(value, &policy.tools.external_write);
    }
    policy.tools.risk_overrides = manifest.tools.risk_overrides;
    policy.tools.package_policy = manifest.tools.package_policy;
    policy.agent_defaults = manifest.agent_defaults;
    merge_rollback_policy(&mut policy, manifest.rollback);
    if let Some(agent_vm) = manifest.agent_vm {
        policy.agent_vm = AgentVmProjectPolicy {
            enabled: agent_vm.enabled.unwrap_or(policy.agent_vm.enabled),
            default_image_id: clean_string(agent_vm.default_image_id)
                .or(policy.agent_vm.default_image_id),
            image_manifest_ref: clean_string(agent_vm.image_manifest_ref)
                .or(policy.agent_vm.image_manifest_ref),
            guest_workspace_path: clean_string(agent_vm.guest_workspace_path)
                .unwrap_or(policy.agent_vm.guest_workspace_path),
            mounts: agent_vm.mounts,
            network_mode: agent_vm
                .network_mode
                .as_deref()
                .map(normalize_network_policy)
                .unwrap_or(policy.agent_vm.network_mode),
            allowed_domains: clean_list(agent_vm.allowed_domains),
            expose_secrets: clean_list(agent_vm.expose_secrets),
            expose_ssh_agent: agent_vm
                .expose_ssh_agent
                .unwrap_or(policy.agent_vm.expose_ssh_agent),
            port_forwards: agent_vm.port_forwards,
            snapshot: agent_vm.snapshot.unwrap_or(policy.agent_vm.snapshot),
        };
    }
    policy.security.policy_file = clean_string(manifest.security.policy_file);
    policy.security.secrets_policy_file = clean_string(manifest.security.secrets_policy_file);
    if let Some(value) = clean_string(manifest.security.redaction_profile) {
        policy.security.redaction_profile = normalize_redaction_profile(&value);
    }
    if let Some(value) = clean_string(manifest.security.sensitive_file_default) {
        policy.security.sensitive_file_default = normalize_sensitive_file_default(&value);
    }
    policy.security.allow_model_context_secrets = false;
    policy.security.allow_artifact_raw_secrets = false;
    policy.security.allow_agent_vm_secret_exposure =
        policy.agent_vm.expose_secrets.is_empty() == false;
    policy.artifacts = manifest.artifacts;
    policy.references = manifest.references;
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
        _ => None,
    }
}

fn normalize_execution_target(value: Option<&str>) -> Option<String> {
    match value.map(str::trim) {
        Some("host") => Some("host".to_string()),
        Some("agent_vm") => Some("agent_vm".to_string()),
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
        "ask" => "ask".to_string(),
        _ => "allow_redacted".to_string(),
    }
}

fn merge_model_policy(
    policy: &mut ModelRoutingPolicy,
    manifest: super::types::ManifestModelRoutingPolicy,
) {
    policy.default_provider =
        clean_string(manifest.default_provider).or(policy.default_provider.take());
    policy.default_model = clean_string(manifest.default_model).or(policy.default_model.take());
    if let Some(value) = clean_string(manifest.privacy_route) {
        policy.privacy_route = normalize_privacy_route(&value);
    }
    if manifest.allowed_providers.is_empty() == false {
        policy.allowed_providers = clean_list(manifest.allowed_providers);
    }
    if manifest.denied_providers.is_empty() == false {
        policy.denied_providers = clean_list(manifest.denied_providers);
    }
    if manifest.allowed_protocols.is_empty() == false {
        policy.allowed_protocols = clean_list(manifest.allowed_protocols);
    }
    if let Some(value) = manifest.require_native_adapter {
        policy.require_native_adapter = value;
    }
    if let Some(fallback) = manifest.fallback {
        policy.fallback = ModelFallbackPolicy {
            enabled: fallback.enabled,
            require_same_capabilities: fallback.require_same_capabilities,
            require_same_privacy_route: fallback.require_same_privacy_route,
        };
    }
    policy.purposes = manifest.purposes;
}

fn merge_command_policy(policy: &mut EffectivePolicy, value: Value) {
    if let Some(text) = value.as_str() {
        policy.tools.command_policy = normalize_command_policy(text);
        return;
    }
    let Some(object) = value.as_object() else {
        return;
    };
    policy.tools.command_policy = "project_configured".to_string();
    if let Some(value) = object
        .get("allowShell")
        .or_else(|| object.get("allow_shell"))
    {
        policy.tools.command.allow_shell =
            value.as_bool().unwrap_or(policy.tools.command.allow_shell);
    }
    if let Some(values) = value_string_list(
        object
            .get("allowedCommands")
            .or_else(|| object.get("allowed_commands")),
    ) {
        policy.tools.command.allowed_commands = values;
    }
    if let Some(values) = value_string_list(
        object
            .get("deniedCommands")
            .or_else(|| object.get("denied_commands")),
    ) {
        policy.tools.command.denied_commands = values;
    }
    if let Some(values) = value_string_list(
        object
            .get("requireApprovalForPatterns")
            .or_else(|| object.get("require_approval_for_patterns")),
    ) {
        policy.tools.command.require_approval_for_patterns = values;
    }
    if let Some(value) = object
        .get("maxTimeoutMs")
        .or_else(|| object.get("max_timeout_ms"))
    {
        if let Some(value) = value.as_u64() {
            policy.tools.command.max_timeout_ms = value;
        }
    }
    if let Some(value) = object
        .get("maxOutputBytes")
        .or_else(|| object.get("max_output_bytes"))
    {
        if let Some(value) = value.as_u64().and_then(|value| usize::try_from(value).ok()) {
            policy.tools.command.max_output_bytes = value;
        }
    }
}

fn merge_network_policy(policy: &mut NetworkPolicy, value: Value) {
    if let Some(text) = value.as_str() {
        policy.mode = normalize_network_policy(text);
        return;
    }
    let Some(object) = value.as_object() else {
        return;
    };
    if let Some(mode) = object.get("mode").and_then(Value::as_str) {
        policy.mode = normalize_network_policy(mode);
    }
    if let Some(values) = value_string_list(
        object
            .get("allowedDomains")
            .or_else(|| object.get("allowed_domains")),
    ) {
        policy.allowed_domains = values;
    }
    if let Some(values) = value_string_list(
        object
            .get("deniedDomains")
            .or_else(|| object.get("denied_domains")),
    ) {
        policy.denied_domains = values;
    }
    if let Some(value) = object
        .get("allowDownloads")
        .or_else(|| object.get("allow_downloads"))
    {
        policy.allow_downloads = value.as_bool().unwrap_or(policy.allow_downloads);
    }
    if let Some(value) = object
        .get("allowUploads")
        .or_else(|| object.get("allow_uploads"))
    {
        policy.allow_uploads = value.as_bool().unwrap_or(policy.allow_uploads);
    }
}

fn parse_external_write_policy(
    value: Value,
    fallback: &ExternalWritePolicy,
) -> ExternalWritePolicy {
    let Some(object) = value.as_object() else {
        return fallback.clone();
    };
    ExternalWritePolicy {
        default: object
            .get("default")
            .and_then(Value::as_str)
            .map(normalize_external_write_policy)
            .unwrap_or_else(|| fallback.default.clone()),
        targets: object
            .get("targets")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_else(|| fallback.targets.clone()),
    }
}

fn merge_rollback_policy(
    policy: &mut EffectivePolicy,
    manifest: super::types::ManifestRollbackRetentionPolicy,
) {
    if let Some(value) = manifest.message_checkpoint_retention_days {
        policy.rollback.message_checkpoint_retention_days = value;
    }
    if let Some(value) = manifest.workspace_snapshot_retention_days {
        policy.rollback.workspace_snapshot_retention_days = value;
    }
    if let Some(value) = manifest.artifact_retention_days {
        policy.rollback.artifact_retention_days = value;
    }
    if manifest.max_snapshots_per_session.is_some() {
        policy.rollback.max_snapshots_per_session = manifest.max_snapshots_per_session;
    }
    if let Some(value) = manifest.preserve_external_side_effect_ledger {
        policy.rollback.preserve_external_side_effect_ledger = value;
    }
    if let Some(value) = manifest.preserve_delivery_proofs {
        policy.rollback.preserve_delivery_proofs = value;
    }
    if let Some(value) = clean_string(manifest.cleanup_policy) {
        policy.rollback.cleanup_policy = value;
    }
}

fn value_string_list(value: Option<&Value>) -> Option<Vec<String>> {
    let values = value?.as_array()?;
    Some(
        values
            .iter()
            .filter_map(Value::as_str)
            .map(ToString::to_string)
            .collect(),
    )
}

fn normalize_privacy_route(value: &str) -> String {
    match value {
        "local_only" | "cloud_allowed" | "provider_allowlist" | "policy_controlled" => {
            value.to_string()
        }
        _ => "policy_controlled".to_string(),
    }
}

fn normalize_external_write_policy(value: &str) -> String {
    match value {
        "deny" | "approval_required" | "allow_with_audit" => value.to_string(),
        _ => "approval_required".to_string(),
    }
}
