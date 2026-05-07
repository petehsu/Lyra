use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifest {
    #[serde(default)]
    pub schema_version: Option<serde_json::Value>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub workspace: ManifestWorkspacePolicy,
    #[serde(default)]
    pub permission: ManifestPermissionPolicy,
    #[serde(default)]
    pub tools: ManifestToolPolicy,
    #[serde(rename = "agent", default)]
    pub _agent: serde_json::Value,
    #[serde(default)]
    pub security: ManifestSecurityPolicy,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestWorkspacePolicy {
    #[serde(default)]
    pub trusted: Option<bool>,
    #[serde(default)]
    pub writable: Vec<String>,
    #[serde(default)]
    pub denied: Vec<String>,
    #[serde(default)]
    pub symlink_policy: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestPermissionPolicy {
    #[serde(default)]
    pub default: Option<String>,
    #[serde(default)]
    pub allowed_modes: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestToolPolicy {
    #[serde(default)]
    pub disabled: Vec<String>,
    #[serde(default)]
    pub command_policy: Option<String>,
    #[serde(default)]
    pub network_policy: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestSecurityPolicy {
    #[serde(default)]
    pub redaction_profile: Option<String>,
    #[serde(default)]
    pub sensitive_file_default: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EffectivePolicy {
    pub project_id: Option<String>,
    pub permission_default: String,
    pub allowed_modes: Vec<String>,
    pub workspace: WorkspacePolicy,
    pub tools: ToolPolicy,
    pub security: SecurityPolicy,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePolicy {
    pub trusted: bool,
    pub writable: Vec<String>,
    pub denied: Vec<String>,
    pub symlink_policy: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolPolicy {
    pub disabled: Vec<String>,
    pub command_policy: String,
    pub network_policy: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SecurityPolicy {
    pub redaction_profile: String,
    pub sensitive_file_default: String,
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
