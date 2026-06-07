use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const TOOL_FS_SEARCH: &str = "tool_fs_search";
pub const TOOL_FS_LIST: &str = "tool_fs_list";
pub const TOOL_FS_READ_DOC: &str = "tool_fs_read_doc";
pub const TOOL_FS_INSPECT: &str = "tool_fs_inspect";
pub const TOOL_FS_RUN: &str = "tool_fs_run";
pub const PROVIDER_VISIBLE_TOOL_NAMES: [&str; 5] = [
    TOOL_FS_SEARCH,
    TOOL_FS_LIST,
    TOOL_FS_READ_DOC,
    TOOL_FS_INSPECT,
    TOOL_FS_RUN,
];
pub const TOOL_FS_SCHEMA_VERSION: u32 = 1;
pub const DEFAULT_TOOL_TIMEOUT_MS: u64 = 30_000;
pub const MAX_TOOL_TIMEOUT_MS: u64 = 120_000;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolManifest {
    pub path: String,
    pub handle: Option<String>,
    pub domain: String,
    pub operation: String,
    pub title: String,
    pub summary: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub examples: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    pub risk_level: String,
    pub permission_policy: String,
    pub input_schema: Value,
    pub output_kind: String,
    pub activity_kind: String,
    pub renderer_hint: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolDirectory {
    pub kind: String,
    pub path: String,
    pub directories: Vec<ToolDirectoryEntry>,
    pub tools: Vec<ToolManifest>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
    pub has_more: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolDirectoryEntry {
    pub path: String,
    pub name: String,
    pub summary: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolSearchResponse {
    pub kind: String,
    pub query: String,
    pub scene: String,
    pub domain: Option<String>,
    pub results: Vec<ToolSearchResult>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
    pub has_more: bool,
    pub fallback_list_path: String,
    pub recommended_next_action: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolSearchResult {
    pub path: String,
    pub handle: Option<String>,
    pub title: String,
    pub domain: String,
    pub operation: String,
    pub summary: String,
    pub run_hint: String,
    pub mini_schema: Value,
    pub score: f64,
    pub matched_fields: Vec<String>,
    pub match_reason: String,
    pub recommended_next_action: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultEnvelope {
    pub schema_version: u32,
    pub status: String,
    pub runtime_turn_id: String,
    pub duration_ms: u64,
    pub trace_id: String,
    pub ok: bool,
    pub content: String,
    pub raw: Value,
    pub tool_path: String,
    pub domain: String,
    pub operation: String,
    pub artifacts: Vec<Value>,
    pub artifact_refs: Vec<Value>,
    pub projection_ref: Option<Value>,
    pub data_ref: Option<Value>,
    pub stdout_ref: Option<Value>,
    pub stderr_ref: Option<Value>,
    pub changes: Vec<ToolChangeRecord>,
    pub error: Option<Value>,
    pub not_run_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolChangeRecord {
    pub schema_version: u32,
    pub change_id: String,
    pub kind: String,
    pub operation: String,
    pub path: Option<String>,
    pub summary: String,
    pub detail: Value,
    pub reversible: bool,
    pub before_ref: Option<Value>,
    pub after_ref: Option<Value>,
    pub diff_ref: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PinnedToolHandle {
    pub handle: String,
    pub path: String,
    pub title: String,
    pub domain: String,
    pub operation: String,
}

pub trait ToolManifestProvider {
    fn tool_manifests(&self) -> Vec<ToolManifest>;
}

#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedToolRun {
    pub manifest: ToolManifest,
    pub args: Value,
    pub requested_path: Option<String>,
    pub requested_handle: Option<String>,
}

pub fn provider_tool_names() -> Vec<String> {
    PROVIDER_VISIBLE_TOOL_NAMES
        .into_iter()
        .map(str::to_string)
        .collect()
}
