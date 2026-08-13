use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SignedChannelCatalogV1 {
    pub schema_version: u8,
    pub keyring: SignedReleaseKeyringV1,
    pub payload: ChannelCatalogPayloadV1,
    pub signature: SignatureV1,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SignedReleaseKeyringV1 {
    pub schema_version: u8,
    pub payload: ReleaseKeyringPayloadV1,
    pub signature: SignatureV1,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReleaseKeyringPayloadV1 {
    pub sequence: u64,
    pub generated_at: String,
    pub expires_at: String,
    pub keys: Vec<ReleaseKeyV1>,
    pub revoked_key_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReleaseKeyV1 {
    pub key_id: String,
    pub public_key: String,
    pub publisher: String,
    pub channels: Vec<String>,
    pub component_kinds: Vec<String>,
    pub component_id_prefixes: Vec<String>,
    pub execution_classes: Vec<String>,
    pub valid_from: String,
    pub valid_until: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ChannelCatalogPayloadV1 {
    pub sequence: u64,
    pub channel: String,
    pub generated_at: String,
    pub expires_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minimum_safe_core_version: Option<String>,
    pub revocations: Vec<ComponentRevocationV1>,
    pub releases: Vec<CatalogReleaseV1>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ComponentRevocationV1 {
    pub component_id: String,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CatalogReleaseV1 {
    pub version: String,
    pub bom_url: String,
    pub bom_sha256: String,
    pub bom_signature: String,
    pub key_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseCheckReportV1 {
    pub release_version: String,
    pub catalog_sequence: u64,
    pub target: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SignatureV1 {
    pub algorithm: String,
    pub key_id: String,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReleaseBomV1 {
    pub schema_version: u8,
    pub release_version: String,
    pub channel: String,
    pub target: String,
    pub core_version: String,
    pub host_api_version: String,
    pub components: Vec<ReleaseBomComponentV1>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReleaseBomComponentV1 {
    pub component_id: String,
    pub kind: String,
    pub version: String,
    pub target: String,
    pub url: String,
    pub size: u64,
    pub sha256: String,
    pub signature: String,
    pub key_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_class: Option<String>,
    pub activation: String,
    pub delivery: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ComponentManifestV1 {
    pub schema_version: u8,
    pub component_id: String,
    pub kind: String,
    pub version: String,
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_class: Option<String>,
    pub activation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_api_range: Option<SemanticVersionRangeV1>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_protocol_range: Option<RuntimeProtocolRangeV1>,
    pub data_schema: ComponentDataSchemaV1,
    pub permissions: Vec<String>,
    pub publisher: String,
    pub files: Vec<ComponentFileV1>,
    pub key_id: String,
    pub signature: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SemanticVersionRangeV1 {
    pub min_inclusive: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_exclusive: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RuntimeProtocolRangeV1 {
    pub min: u32,
    pub max: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ComponentDataSchemaV1 {
    pub reader_min: u32,
    pub reader_max: u32,
    pub writer: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ComponentFileV1 {
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ResumeMetadataV1 {
    pub schema_version: u8,
    pub url: String,
    pub sha256: String,
    pub expected_size: u64,
    pub downloaded_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ComponentActivationStateV1 {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ActivationRegistryV1 {
    pub schema_version: u8,
    pub revision: u64,
    pub keyring_sequence: u64,
    pub catalog_sequence: u64,
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_release_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_release_version: Option<String>,
    pub components: BTreeMap<String, ComponentActivationStateV1>,
}

impl ActivationRegistryV1 {
    pub(crate) fn empty(target: String) -> Self {
        Self {
            schema_version: 1,
            revision: 0,
            keyring_sequence: 0,
            catalog_sequence: 0,
            target,
            active_release_version: None,
            pending_release_version: None,
            components: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InstalledFileV1 {
    pub path: String,
    pub size: u64,
    pub sha256: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unix_mode: Option<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InstalledComponentV1 {
    pub schema_version: u8,
    pub component_id: String,
    pub version: String,
    pub target: String,
    pub archive_sha256: String,
    pub files: Vec<InstalledFileV1>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallReport {
    pub release_version: String,
    pub catalog_sequence: u64,
    pub target: String,
    pub installed_components: Vec<String>,
    pub repaired_components: Vec<String>,
    pub staged_components: Vec<String>,
    pub deferred_components: Vec<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallProgressPhase {
    Catalog,
    Bom,
    Download,
    Verify,
    Install,
    Complete,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgressV1 {
    pub phase: InstallProgressPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_id: Option<String>,
    pub completed: u64,
    pub total: u64,
    pub completed_components: usize,
    pub total_components: usize,
}
