use glob::Pattern;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::Mutex;

pub(super) const ENGINE_VERSION: &str = "native-v3";
pub(super) const SNAPSHOT_MAGIC: &[u8; 8] = b"LYRAIDX3";
pub(super) const SNAPSHOT_VERSION: u32 = 4;
pub(super) const DEFAULT_LIMIT: usize = 50;
pub(super) const MAX_LIMIT: usize = 500;
pub(super) const DEFAULT_TEXT_LIMIT_BYTES: u64 = 256 * 1024;
pub(super) const READ_RESULT_MAX_BYTES: usize = 2_000_000;
pub(super) const ROOT_CONTENT_BUDGET_BYTES: u64 = 1024 * 1024 * 1024;
pub(super) const DELTA_COMPACT_BYTES: u64 = 128 * 1024 * 1024;
pub(super) const DELTA_REPLAY_RECORD_LIMIT: usize = 256;
pub(super) const SNIPPET_MAX_CHARS: usize = 240;
pub(super) const SEARCH_CANDIDATE_MULTIPLIER_FAST: usize = 2;
pub(super) const SEARCH_CANDIDATE_MULTIPLIER_NORMAL: usize = 3;
pub(super) const SEARCH_CANDIDATE_MULTIPLIER_FULL: usize = 5;
pub(super) const CONTENT_MAX_TERMS_PER_FILE: usize = 4_096;
pub(super) const CONTENT_MAX_POSTINGS_PER_TERM: usize = 16_384;
pub(super) const CONTENT_CANDIDATE_SCAN_LIMIT: usize = 4_096;
pub(super) const CONTENT_INLINE_REBUILD_ENTRY_LIMIT: usize = 10_000;
pub(super) const CONTENT_ASCII_NGRAM_CHARS: usize = 3;
pub(super) const CONTENT_UNICODE_NGRAM_CHARS: usize = 2;

pub(super) const SKIPPED_DIRECTORY_NAMES: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    ".cache",
    ".next",
    ".trash",
    ".turbo",
    ".venv",
    "__pycache__",
    "build",
    "caches",
    "coverage",
    "deriveddata",
    "dist",
    "library",
    "node_modules",
    "target",
    "vendor",
];

pub(super) const COMMON_PROJECT_ENTRY_NAMES: &[&str] = &[
    ".env",
    ".env.example",
    ".gitignore",
    "Cargo.toml",
    "Makefile",
    "README",
    "README.md",
    "go.mod",
    "package.json",
    "pnpm-workspace.yaml",
    "pyproject.toml",
    "requirements.txt",
    "tsconfig.json",
];

pub(super) const TEXT_EXTENSIONS: &[&str] = &[
    "bash", "c", "cc", "conf", "cpp", "cs", "css", "csv", "go", "h", "hpp", "html", "java", "js",
    "json", "jsx", "kt", "lock", "log", "md", "mjs", "py", "rb", "rs", "sh", "sql", "swift",
    "toml", "ts", "tsx", "txt", "xml", "yaml", "yml", "zsh",
];

pub(super) fn default_skipped_directory_names() -> Vec<String> {
    SKIPPED_DIRECTORY_NAMES
        .iter()
        .map(|value| (*value).to_string())
        .collect()
}

pub(super) fn default_text_extensions() -> Vec<String> {
    TEXT_EXTENSIONS
        .iter()
        .map(|value| (*value).to_string())
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LocalSearchKind {
    File,
    Directory,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LocalSearchSource {
    Index,
    Walker,
    Content,
    Symbol,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LocalSearchMatchKind {
    Initial,
    FileName,
    Path,
    Extension,
    Content,
    Metadata,
    Fuzzy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LocalSearchIndexState {
    Empty,
    Indexing,
    Ready,
    Partial,
    Failed,
    Walker,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LocalSearchContentMode {
    Disabled,
    #[default]
    Auto,
    Required,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LocalSearchQueryMode {
    Fast,
    #[default]
    Normal,
    Full,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSearchSkippedStats {
    pub hidden: u64,
    pub vendor: u64,
    pub binary_or_too_large: u64,
    pub unreadable: u64,
    pub content_budget: u64,
}

impl LocalSearchSkippedStats {
    pub(super) fn add(&mut self, next: &Self) {
        self.hidden = self.hidden.saturating_add(next.hidden);
        self.vendor = self.vendor.saturating_add(next.vendor);
        self.binary_or_too_large = self
            .binary_or_too_large
            .saturating_add(next.binary_or_too_large);
        self.unreadable = self.unreadable.saturating_add(next.unreadable);
        self.content_budget = self.content_budget.saturating_add(next.content_budget);
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSearchMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
    pub size_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u64>,
    pub hidden: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSearchResult {
    pub path: PathBuf,
    pub display_path: String,
    pub root: PathBuf,
    pub kind: LocalSearchKind,
    pub score: u32,
    pub source: LocalSearchSource,
    pub match_kind: LocalSearchMatchKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<LocalSearchMetadata>,
    pub index_state: LocalSearchIndexState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSearchResponse {
    pub query: String,
    pub roots: Vec<PathBuf>,
    pub results: Vec<LocalSearchResult>,
    pub total_match_count: usize,
    pub truncated: bool,
    pub index_state: LocalSearchIndexState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSearchRootStatus {
    pub root: PathBuf,
    pub state: LocalSearchIndexState,
    pub indexed_file_count: u64,
    pub indexed_dir_count: u64,
    pub indexed_content_file_count: u64,
    pub content_bytes_indexed: u64,
    pub skipped: LocalSearchSkippedStats,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_indexed_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSearchStatus {
    pub state: LocalSearchIndexState,
    pub engine_version: String,
    pub phase: String,
    pub policy_hash: Option<String>,
    pub policy_source: Vec<String>,
    pub policy_warnings: Vec<String>,
    pub roots: Vec<LocalSearchRootStatus>,
    pub indexed_file_count: u64,
    pub indexed_dir_count: u64,
    pub indexed_content_file_count: u64,
    pub content_bytes_indexed: u64,
    pub storage_bytes: u64,
    pub snapshot_bytes: u64,
    pub delta_bytes: u64,
    pub pending_changes: u64,
    pub skipped: LocalSearchSkippedStats,
}

#[derive(Debug, Clone)]
pub struct LocalSearchIndexRootOptions {
    pub root: PathBuf,
    pub include_hidden: bool,
    pub include_vendor: bool,
    pub respect_gitignore: bool,
    pub follow_symlinks: bool,
    pub exclude_dirs: Vec<String>,
    pub exclude_globs: Vec<String>,
    pub text_extensions: Vec<String>,
    pub content_mode: LocalSearchContentMode,
    pub max_file_size_bytes: u64,
    pub content_budget_bytes: u64,
    pub policy_hash: Option<String>,
    pub policy_source: Vec<String>,
    pub policy_warnings: Vec<String>,
}

impl Default for LocalSearchIndexRootOptions {
    fn default() -> Self {
        Self {
            root: PathBuf::new(),
            include_hidden: false,
            include_vendor: false,
            respect_gitignore: true,
            follow_symlinks: false,
            exclude_dirs: default_skipped_directory_names(),
            exclude_globs: Vec::new(),
            text_extensions: default_text_extensions(),
            content_mode: LocalSearchContentMode::Auto,
            max_file_size_bytes: DEFAULT_TEXT_LIMIT_BYTES,
            content_budget_bytes: ROOT_CONTENT_BUDGET_BYTES,
            policy_hash: None,
            policy_source: Vec::new(),
            policy_warnings: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct LocalSearchApplyChangesOptions {
    pub root: PathBuf,
    pub paths: Vec<PathBuf>,
    pub include_hidden: bool,
    pub include_vendor: bool,
    pub respect_gitignore: bool,
    pub follow_symlinks: bool,
    pub exclude_dirs: Vec<String>,
    pub exclude_globs: Vec<String>,
    pub text_extensions: Vec<String>,
    pub content_mode: LocalSearchContentMode,
    pub max_file_size_bytes: u64,
    pub content_budget_bytes: u64,
    pub policy_hash: Option<String>,
    pub policy_source: Vec<String>,
    pub policy_warnings: Vec<String>,
}

impl Default for LocalSearchApplyChangesOptions {
    fn default() -> Self {
        Self {
            root: PathBuf::new(),
            paths: Vec::new(),
            include_hidden: false,
            include_vendor: false,
            respect_gitignore: true,
            follow_symlinks: false,
            exclude_dirs: default_skipped_directory_names(),
            exclude_globs: Vec::new(),
            text_extensions: default_text_extensions(),
            content_mode: LocalSearchContentMode::Auto,
            max_file_size_bytes: DEFAULT_TEXT_LIMIT_BYTES,
            content_budget_bytes: ROOT_CONTENT_BUDGET_BYTES,
            policy_hash: None,
            policy_source: Vec::new(),
            policy_warnings: Vec::new(),
        }
    }
}

impl From<LocalSearchIndexRootOptions> for LocalSearchApplyChangesOptions {
    fn from(options: LocalSearchIndexRootOptions) -> Self {
        Self {
            root: options.root,
            paths: Vec::new(),
            include_hidden: options.include_hidden,
            include_vendor: options.include_vendor,
            respect_gitignore: options.respect_gitignore,
            follow_symlinks: options.follow_symlinks,
            exclude_dirs: options.exclude_dirs,
            exclude_globs: options.exclude_globs,
            text_extensions: options.text_extensions,
            content_mode: options.content_mode,
            max_file_size_bytes: options.max_file_size_bytes,
            content_budget_bytes: options.content_budget_bytes,
            policy_hash: options.policy_hash,
            policy_source: options.policy_source,
            policy_warnings: options.policy_warnings,
        }
    }
}

#[derive(Debug, Clone)]
pub struct LocalSearchOptions {
    pub query: String,
    pub roots: Vec<PathBuf>,
    pub kinds: Vec<LocalSearchKind>,
    pub extensions: Vec<String>,
    pub limit: usize,
    pub include_hidden: bool,
    pub include_vendor: bool,
    pub respect_gitignore: bool,
    pub include_globs: Vec<String>,
    pub exclude_globs: Vec<String>,
    pub content_mode: LocalSearchContentMode,
    pub max_file_size_bytes: u64,
    pub enable_fuzzy: bool,
    pub enable_extension_match: bool,
    pub query_mode: LocalSearchQueryMode,
    pub max_candidates: Option<usize>,
}

impl Default for LocalSearchOptions {
    fn default() -> Self {
        Self {
            query: String::new(),
            roots: Vec::new(),
            kinds: Vec::new(),
            extensions: Vec::new(),
            limit: DEFAULT_LIMIT,
            include_hidden: false,
            include_vendor: false,
            respect_gitignore: true,
            include_globs: Vec::new(),
            exclude_globs: Vec::new(),
            content_mode: LocalSearchContentMode::Auto,
            max_file_size_bytes: DEFAULT_TEXT_LIMIT_BYTES,
            enable_fuzzy: true,
            enable_extension_match: true,
            query_mode: LocalSearchQueryMode::Normal,
            max_candidates: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct LocalSearchReadOptions {
    pub root: Option<PathBuf>,
    pub path: PathBuf,
    pub offset: u64,
    pub max_bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSearchReadResponse {
    pub path: PathBuf,
    pub offset: u64,
    pub bytes_read: usize,
    pub contents: String,
    pub truncated: bool,
}

#[derive(Debug, Clone)]
pub struct LocalSearchExtractTextOptions {
    pub path: PathBuf,
    pub max_bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSearchExtractTextResponse {
    pub path: PathBuf,
    pub text: String,
    pub truncated: bool,
    pub extraction_method: String,
}

pub struct LocalSearchEngine {
    pub(super) state: Mutex<LocalSearchState>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalSearchEngineConfig {
    pub storage_mode: LocalSearchStorageMode,
}

impl Default for LocalSearchEngineConfig {
    fn default() -> Self {
        Self {
            storage_mode: LocalSearchStorageMode::Memory,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocalSearchStorageMode {
    Memory,
    Persistent { storage_root: PathBuf },
}

#[derive(Debug)]
pub(super) struct LocalSearchState {
    pub(super) entries: Vec<IndexedEntry>,
    pub(super) content_postings: HashMap<String, Vec<usize>>,
    pub(super) roots: BTreeMap<PathBuf, LocalSearchRootStatus>,
    pub(super) storage: V3Storage,
    pub(super) state: LocalSearchIndexState,
    pub(super) phase: String,
    pub(super) policy_hash: Option<String>,
    pub(super) policy_source: Vec<String>,
    pub(super) policy_warnings: Vec<String>,
    pub(super) pending_changes: u64,
    pub(super) load_error: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct V3Storage {
    pub(super) native_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct V3Meta {
    pub(super) engine_version: String,
    pub(super) snapshot_version: u32,
    pub(super) phase: String,
    #[serde(default)]
    pub(super) policy_hash: Option<String>,
    #[serde(default)]
    pub(super) policy_source: Vec<String>,
    #[serde(default)]
    pub(super) policy_warnings: Vec<String>,
    pub(super) roots: Vec<LocalSearchRootStatus>,
    pub(super) pending_changes: u64,
    pub(super) last_written_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SnapshotEntry {
    pub(super) root: PathBuf,
    pub(super) relative_path: PathBuf,
    pub(super) full_path: PathBuf,
    pub(super) display_path: String,
    pub(super) kind: LocalSearchKind,
    pub(super) extension: Option<String>,
    pub(super) size_bytes: u64,
    pub(super) modified_at: Option<u64>,
    pub(super) created_at: Option<u64>,
    pub(super) hidden: bool,
    pub(super) vendor: bool,
    pub(super) content_indexed: bool,
    pub(super) content_text: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct IndexedEntry {
    pub(super) root: PathBuf,
    pub(super) relative_path: PathBuf,
    pub(super) full_path: PathBuf,
    pub(super) display_path: String,
    pub(super) kind: LocalSearchKind,
    pub(super) extension: Option<String>,
    pub(super) lower_file_name: String,
    pub(super) lower_path: String,
    pub(super) size_bytes: u64,
    pub(super) modified_at: Option<u64>,
    pub(super) created_at: Option<u64>,
    pub(super) hidden: bool,
    pub(super) vendor: bool,
    pub(super) content_indexed: bool,
    pub(super) content_text: Option<String>,
}

#[derive(Debug)]
pub(super) struct CollectedRoot {
    pub(super) root: PathBuf,
    pub(super) entries: Vec<IndexedEntry>,
    pub(super) file_count: u64,
    pub(super) dir_count: u64,
    pub(super) content_file_count: u64,
    pub(super) content_bytes_indexed: u64,
    pub(super) skipped: LocalSearchSkippedStats,
    pub(super) truncated: bool,
}

#[derive(Debug, Clone)]
pub(super) struct Candidate {
    pub(super) result: LocalSearchResult,
}

#[derive(Debug)]
pub(super) struct CompiledQueryFilters {
    pub(super) include_globs: Vec<Pattern>,
    pub(super) exclude_globs: Vec<Pattern>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub(super) enum DeltaRecord {
    Upsert { entry: SnapshotEntry },
    Delete { full_path: PathBuf },
    DeleteTree { full_path: PathBuf },
}
