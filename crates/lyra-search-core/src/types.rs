use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SearchLocalScopePreset {
    Home,
    FullSystem,
    Workspace,
    Custom,
}

impl Default for SearchLocalScopePreset {
    fn default() -> Self {
        Self::Home
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SearchLocalMode {
    Fast,
    Normal,
    Full,
}

impl Default for SearchLocalMode {
    fn default() -> Self {
        Self::Normal
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SearchIndexState {
    Idle,
    Building,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SearchResultSourceKind {
    File,
    Workspace,
    BrowserHistory,
    AgentSession,
    Recent,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SearchResultKind {
    File,
    Directory,
    Page,
    Session,
    Workspace,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchContext {
    #[serde(default)]
    pub project_root: Option<String>,
    #[serde(default)]
    pub active_tab_id: Option<String>,
    #[serde(default)]
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchLocalRequest {
    pub query: String,
    pub limit: Option<usize>,
    #[serde(default)]
    pub context: SearchContext,
    #[serde(default)]
    pub scope_preset: SearchLocalScopePreset,
    #[serde(default)]
    pub custom_roots: Vec<String>,
    #[serde(default)]
    pub project_root: Option<String>,
    #[serde(default)]
    pub mode: Option<SearchLocalMode>,
    #[serde(default)]
    pub include_hidden: Option<bool>,
    #[serde(default)]
    pub include_vendor: Option<bool>,
    #[serde(default)]
    pub respect_gitignore: Option<bool>,
    #[serde(default)]
    pub follow_symlinks: Option<bool>,
    #[serde(default)]
    pub include_globs: Vec<String>,
    #[serde(default)]
    pub exclude_globs: Vec<String>,
    #[serde(default)]
    pub exclude_dirs: Vec<String>,
    #[serde(default)]
    pub text_extensions: Vec<String>,
    #[serde(default)]
    pub max_content_file_bytes: Option<u64>,
    #[serde(default)]
    pub content_budget_bytes: Option<u64>,
    #[serde(default)]
    pub max_candidates: Option<usize>,
    #[serde(default)]
    pub enable_fuzzy: Option<bool>,
    #[serde(default)]
    pub enable_content: Option<bool>,
    #[serde(default)]
    pub enable_extension_match: Option<bool>,
    #[serde(default)]
    pub storage_root: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRebuildIndexRequest {
    #[serde(default)]
    pub storage_root: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexStatusRequest {
    #[serde(default)]
    pub storage_root: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatchRange {
    pub field: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultAction {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchLocalResultItem {
    pub id: String,
    pub path: String,
    pub display_path: String,
    pub file_name: String,
    pub extension: Option<String>,
    pub match_kind: String,
    pub score: f64,
    pub snippet: Option<String>,
    pub line: Option<u64>,
    pub modified_at: Option<u64>,
    pub source: SearchResultSourceKind,
    pub kind: SearchResultKind,
    pub title: String,
    pub subtitle: String,
    pub match_ranges: Vec<SearchMatchRange>,
    pub actions: Vec<SearchResultAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchLocalStats {
    pub scanned_files: u64,
    pub scanned_dirs: u64,
    pub content_scanned_files: u64,
    pub matched_files: u64,
    pub skipped_unreadable: u64,
    pub skipped_binary_or_too_large: u64,
    pub used_index: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchLocalResponse {
    pub query: String,
    pub scope_preset: SearchLocalScopePreset,
    pub roots: Vec<String>,
    pub results: Vec<SearchLocalResultItem>,
    pub truncated: bool,
    pub elapsed_ms: u64,
    pub stats: SearchLocalStats,
    pub index_status: SearchIndexStatusResponse,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchLocalStreamReadRequest {
    pub stream_id: String,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchLocalStreamCancelRequest {
    pub stream_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchLocalStreamStartResponse {
    pub stream_id: String,
    pub query: String,
    pub scope_preset: SearchLocalScopePreset,
    pub roots: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchLocalStreamReadResponse {
    pub stream_id: String,
    pub query: String,
    pub scope_preset: SearchLocalScopePreset,
    pub roots: Vec<String>,
    pub results: Vec<SearchLocalResultItem>,
    pub truncated: bool,
    pub elapsed_ms: u64,
    pub stats: SearchLocalStats,
    pub index_status: SearchIndexStatusResponse,
    pub done: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchLocalStreamCancelResponse {
    pub removed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexStatusResponse {
    pub state: SearchIndexState,
    pub engine_version: String,
    pub phase: String,
    pub policy_hash: Option<String>,
    pub policy_source: Vec<String>,
    pub policy_warnings: Vec<String>,
    pub indexed_files: u64,
    pub indexed_dirs: u64,
    pub indexed_content_files: u64,
    pub storage_bytes: u64,
    pub snapshot_bytes: u64,
    pub delta_bytes: u64,
    pub pending_changes: u64,
    pub skipped: SearchIndexSkippedStats,
    pub roots: Vec<SearchIndexRootStatus>,
    pub last_built_at: Option<String>,
    pub progress: Option<f64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexRootStatus {
    pub root: String,
    pub state: SearchIndexState,
    pub indexed_files: u64,
    pub indexed_dirs: u64,
    pub indexed_content_files: u64,
    pub content_bytes_indexed: u64,
    pub skipped: SearchIndexSkippedStats,
    pub last_built_at: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexSkippedStats {
    pub hidden: u64,
    pub vendor: u64,
    pub binary_or_too_large: u64,
    pub unreadable: u64,
    pub content_budget: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRebuildIndexResponse {
    pub status: SearchIndexStatusResponse,
    pub scope_preset: SearchLocalScopePreset,
    pub roots: Vec<String>,
}
