use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifest {
    #[serde(default, alias = "schema_version")]
    pub schema_version: Option<Value>,
    #[serde(default, alias = "project_id")]
    pub project_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub workspace: ManifestWorkspacePolicy,
    #[serde(default)]
    pub permission: ManifestPermissionPolicy,
    #[serde(default)]
    pub models: ManifestModelRoutingPolicy,
    #[serde(default)]
    pub tools: ManifestToolPolicy,
    #[serde(default, alias = "agent_defaults")]
    pub agent_defaults: Value,
    #[serde(default)]
    pub rollback: ManifestRollbackRetentionPolicy,
    #[serde(default, alias = "agent_vm")]
    pub agent_vm: Option<ManifestAgentVmProjectPolicy>,
    #[serde(default)]
    pub security: ManifestSecurityPolicy,
    #[serde(default)]
    pub artifacts: Value,
    #[serde(default)]
    pub references: Value,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestWorkspacePolicy {
    #[serde(default)]
    pub root: Option<String>,
    #[serde(default)]
    pub trusted: Option<bool>,
    #[serde(default, alias = "trusted_roots")]
    pub trusted_roots: Vec<String>,
    #[serde(default, alias = "writable_scopes")]
    pub writable: Vec<String>,
    #[serde(default, alias = "readonly_scopes")]
    pub readonly: Vec<String>,
    #[serde(default, alias = "denied_paths")]
    pub denied: Vec<String>,
    #[serde(default, alias = "include_globs")]
    pub include_globs: Vec<String>,
    #[serde(default, alias = "exclude_globs")]
    pub exclude_globs: Vec<String>,
    #[serde(default, alias = "max_file_read_bytes")]
    pub max_file_read_bytes: Option<usize>,
    #[serde(default, alias = "max_directory_walk_entries")]
    pub max_directory_walk_entries: Option<usize>,
    #[serde(default, alias = "symlink_policy")]
    pub symlink_policy: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestPermissionPolicy {
    #[serde(default, alias = "default_mode")]
    pub default: Option<String>,
    #[serde(default, alias = "allowed_modes")]
    pub allowed_modes: Vec<String>,
    #[serde(default, alias = "default_execution_target")]
    pub default_execution_target: Option<String>,
    #[serde(default, alias = "allowed_execution_targets")]
    pub allowed_execution_targets: Vec<String>,
    #[serde(default, alias = "allow_temporary_elevation")]
    pub allow_temporary_elevation: Option<bool>,
    #[serde(default, alias = "full_access_requires_user_enablement")]
    pub full_access_requires_user_enablement: Option<bool>,
    #[serde(default, alias = "agent_vm_requires_user_enablement")]
    pub agent_vm_requires_user_enablement: Option<bool>,
    #[serde(default, alias = "approval_timeout_seconds")]
    pub approval_timeout_seconds: Option<u64>,
    #[serde(default, alias = "auto_approval_audit_required")]
    pub auto_approval_audit_required: Option<bool>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestModelRoutingPolicy {
    #[serde(default, alias = "default_provider")]
    pub default_provider: Option<String>,
    #[serde(default, alias = "default_model")]
    pub default_model: Option<String>,
    #[serde(default, alias = "privacy_route")]
    pub privacy_route: Option<String>,
    #[serde(default, alias = "allowed_providers")]
    pub allowed_providers: Vec<String>,
    #[serde(default, alias = "denied_providers")]
    pub denied_providers: Vec<String>,
    #[serde(default, alias = "allowed_protocols")]
    pub allowed_protocols: Vec<String>,
    #[serde(default, alias = "require_native_adapter")]
    pub require_native_adapter: Option<bool>,
    #[serde(default)]
    pub fallback: Option<ModelFallbackPolicy>,
    #[serde(default)]
    pub purposes: Value,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestToolPolicy {
    #[serde(default, alias = "enabled_tools")]
    pub enabled: Vec<String>,
    #[serde(default, alias = "disabled_tools")]
    pub disabled: Vec<String>,
    #[serde(default, alias = "command_policy")]
    pub command_policy: Option<Value>,
    #[serde(default, alias = "network_policy")]
    pub network_policy: Option<Value>,
    #[serde(default, alias = "external_write_policy")]
    pub external_write_policy: Option<Value>,
    #[serde(default, alias = "risk_overrides")]
    pub risk_overrides: Vec<Value>,
    #[serde(default, alias = "package_policy")]
    pub package_policy: Option<Value>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestRollbackRetentionPolicy {
    #[serde(default, alias = "message_checkpoint_retention_days")]
    pub message_checkpoint_retention_days: Option<u64>,
    #[serde(default, alias = "workspace_snapshot_retention_days")]
    pub workspace_snapshot_retention_days: Option<u64>,
    #[serde(default, alias = "artifact_retention_days")]
    pub artifact_retention_days: Option<u64>,
    #[serde(default, alias = "max_snapshots_per_session")]
    pub max_snapshots_per_session: Option<u64>,
    #[serde(default, alias = "preserve_external_side_effect_ledger")]
    pub preserve_external_side_effect_ledger: Option<bool>,
    #[serde(default, alias = "preserve_delivery_proofs")]
    pub preserve_delivery_proofs: Option<bool>,
    #[serde(default, alias = "cleanup_policy")]
    pub cleanup_policy: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestAgentVmProjectPolicy {
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default, alias = "default_image_id")]
    pub default_image_id: Option<String>,
    #[serde(default, alias = "image_manifest_ref")]
    pub image_manifest_ref: Option<String>,
    #[serde(default, alias = "guest_workspace_path")]
    pub guest_workspace_path: Option<String>,
    #[serde(default)]
    pub mounts: Vec<CapsuleMountPolicy>,
    #[serde(default, alias = "network_mode")]
    pub network_mode: Option<String>,
    #[serde(default, alias = "allowed_domains")]
    pub allowed_domains: Vec<String>,
    #[serde(default, alias = "expose_secrets")]
    pub expose_secrets: Vec<String>,
    #[serde(default, alias = "expose_ssh_agent")]
    pub expose_ssh_agent: Option<bool>,
    #[serde(default, alias = "port_forwards")]
    pub port_forwards: Vec<CapsulePortForwardPolicy>,
    #[serde(default)]
    pub snapshot: Option<CapsuleSnapshotPolicy>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapsuleMountPolicy {
    #[serde(alias = "host_path")]
    pub host_path: String,
    #[serde(alias = "guest_path")]
    pub guest_path: String,
    pub mode: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapsulePortForwardPolicy {
    #[serde(alias = "host_port")]
    pub host_port: u16,
    #[serde(alias = "guest_port")]
    pub guest_port: u16,
    pub protocol: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapsuleSnapshotPolicy {
    #[serde(default, alias = "auto_snapshot_before_task")]
    pub auto_snapshot_before_task: bool,
    #[serde(default, alias = "retain_count")]
    pub retain_count: u64,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestSecurityPolicy {
    #[serde(default, alias = "policy_file")]
    pub policy_file: Option<String>,
    #[serde(default, alias = "secrets_policy_file")]
    pub secrets_policy_file: Option<String>,
    #[serde(default, alias = "redaction_profile")]
    pub redaction_profile: Option<String>,
    #[serde(default, alias = "sensitive_file_policy")]
    pub sensitive_file_default: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EffectivePolicy {
    pub project_id: Option<String>,
    pub name: Option<String>,
    pub permission_default: String,
    pub allowed_modes: Vec<String>,
    pub permission: PermissionPolicy,
    pub workspace: WorkspacePolicy,
    pub models: ModelRoutingPolicy,
    pub tools: ToolPolicy,
    pub agent_defaults: Value,
    pub rollback: RollbackRetentionPolicy,
    pub agent_vm: AgentVmProjectPolicy,
    pub security: SecurityPolicy,
    pub artifacts: Value,
    pub references: Value,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePolicy {
    pub root: String,
    pub trusted: bool,
    pub trusted_roots: Vec<String>,
    pub writable: Vec<String>,
    pub readonly: Vec<String>,
    pub denied: Vec<String>,
    pub include_globs: Vec<String>,
    pub exclude_globs: Vec<String>,
    pub max_file_read_bytes: Option<usize>,
    pub max_directory_walk_entries: Option<usize>,
    pub symlink_policy: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PermissionPolicy {
    pub default_mode: String,
    pub allowed_modes: Vec<String>,
    pub default_execution_target: String,
    pub allowed_execution_targets: Vec<String>,
    pub allow_temporary_elevation: bool,
    pub full_access_requires_user_enablement: bool,
    pub agent_vm_requires_user_enablement: bool,
    pub approval_timeout_seconds: u64,
    pub auto_approval_audit_required: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelRoutingPolicy {
    pub default_provider: Option<String>,
    pub default_model: Option<String>,
    pub privacy_route: String,
    pub allowed_providers: Vec<String>,
    pub denied_providers: Vec<String>,
    pub allowed_protocols: Vec<String>,
    pub require_native_adapter: bool,
    pub fallback: ModelFallbackPolicy,
    pub purposes: Value,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelFallbackPolicy {
    pub enabled: bool,
    pub require_same_capabilities: bool,
    pub require_same_privacy_route: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolPolicy {
    pub enabled: Vec<String>,
    pub disabled: Vec<String>,
    pub command_policy: String,
    pub command: CommandPolicy,
    pub network_policy: String,
    pub network: NetworkPolicy,
    pub external_write: ExternalWritePolicy,
    pub risk_overrides: Vec<Value>,
    pub package_policy: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandPolicy {
    pub allow_shell: bool,
    pub allowed_commands: Vec<String>,
    pub denied_commands: Vec<String>,
    pub require_approval_for_patterns: Vec<String>,
    pub max_timeout_ms: u64,
    pub max_output_bytes: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NetworkPolicy {
    pub mode: String,
    pub allowed_domains: Vec<String>,
    pub denied_domains: Vec<String>,
    pub allow_downloads: bool,
    pub allow_uploads: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalWritePolicy {
    pub default: String,
    pub targets: Vec<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RollbackRetentionPolicy {
    pub message_checkpoint_retention_days: u64,
    pub workspace_snapshot_retention_days: u64,
    pub artifact_retention_days: u64,
    pub max_snapshots_per_session: Option<u64>,
    pub preserve_external_side_effect_ledger: bool,
    pub preserve_delivery_proofs: bool,
    pub cleanup_policy: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentVmProjectPolicy {
    pub enabled: bool,
    pub default_image_id: Option<String>,
    pub image_manifest_ref: Option<String>,
    pub guest_workspace_path: String,
    pub mounts: Vec<CapsuleMountPolicy>,
    pub network_mode: String,
    pub allowed_domains: Vec<String>,
    pub expose_secrets: Vec<String>,
    pub expose_ssh_agent: bool,
    pub port_forwards: Vec<CapsulePortForwardPolicy>,
    pub snapshot: CapsuleSnapshotPolicy,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SecurityPolicy {
    pub policy_file: Option<String>,
    pub secrets_policy_file: Option<String>,
    pub redaction_profile: String,
    pub sensitive_file_default: String,
    pub allow_model_context_secrets: bool,
    pub allow_artifact_raw_secrets: bool,
    pub allow_agent_vm_secret_exposure: bool,
    pub env_list_visibility: String,
}

#[derive(Clone, Debug)]
pub struct PolicySourceRecord {
    pub layer: String,
    pub source_ref: String,
    pub status: String,
    pub hash: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct PolicyLoadDraft {
    pub source: String,
    pub status: String,
    pub manifest_path: Option<String>,
    pub manifest_hash: Option<String>,
    pub effective_policy: EffectivePolicy,
    pub source_records: Vec<PolicySourceRecord>,
}

#[derive(Clone, Debug)]
pub struct LoadedPolicySnapshot {
    pub snapshot_id: String,
    pub source: String,
    pub status: String,
    pub effective_policy: EffectivePolicy,
}
