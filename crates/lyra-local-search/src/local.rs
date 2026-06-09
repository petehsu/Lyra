use crate::native;
use anyhow::Context;
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::num::NonZero;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

const ENGINE_VERSION: &str = "native-v3";
const SNAPSHOT_MAGIC: &[u8; 8] = b"LYRAIDX3";
const SNAPSHOT_VERSION: u32 = 3;
const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 500;
const DEFAULT_TEXT_LIMIT_BYTES: u64 = 256 * 1024;
const READ_RESULT_MAX_BYTES: usize = 2_000_000;
const ROOT_CONTENT_BUDGET_BYTES: u64 = 1024 * 1024 * 1024;
const DELTA_COMPACT_BYTES: u64 = 128 * 1024 * 1024;
const SNIPPET_MAX_CHARS: usize = 240;
const SEARCH_CANDIDATE_MULTIPLIER_FAST: usize = 2;
const SEARCH_CANDIDATE_MULTIPLIER_NORMAL: usize = 3;
const SEARCH_CANDIDATE_MULTIPLIER_FULL: usize = 5;

const SKIPPED_DIRECTORY_NAMES: &[&str] = &[
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

const COMMON_PROJECT_ENTRY_NAMES: &[&str] = &[
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

const TEXT_EXTENSIONS: &[&str] = &[
    "bash", "c", "cc", "conf", "cpp", "cs", "css", "csv", "go", "h", "hpp", "html", "java", "js",
    "json", "jsx", "kt", "lock", "log", "md", "mjs", "py", "rb", "rs", "sh", "sql", "swift",
    "toml", "ts", "tsx", "txt", "xml", "yaml", "yml", "zsh",
];

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
    fn add(&mut self, next: &Self) {
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
    pub content_mode: LocalSearchContentMode,
    pub max_file_size_bytes: u64,
}

impl Default for LocalSearchIndexRootOptions {
    fn default() -> Self {
        Self {
            root: PathBuf::new(),
            include_hidden: false,
            include_vendor: false,
            respect_gitignore: true,
            content_mode: LocalSearchContentMode::Auto,
            max_file_size_bytes: DEFAULT_TEXT_LIMIT_BYTES,
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
    pub content_mode: LocalSearchContentMode,
    pub max_file_size_bytes: u64,
}

impl Default for LocalSearchApplyChangesOptions {
    fn default() -> Self {
        Self {
            root: PathBuf::new(),
            paths: Vec::new(),
            include_hidden: false,
            include_vendor: false,
            respect_gitignore: true,
            content_mode: LocalSearchContentMode::Auto,
            max_file_size_bytes: DEFAULT_TEXT_LIMIT_BYTES,
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
            content_mode: options.content_mode,
            max_file_size_bytes: options.max_file_size_bytes,
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
    pub content_mode: LocalSearchContentMode,
    pub max_file_size_bytes: u64,
    pub enable_fuzzy: bool,
    pub enable_extension_match: bool,
    pub query_mode: LocalSearchQueryMode,
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
            content_mode: LocalSearchContentMode::Auto,
            max_file_size_bytes: DEFAULT_TEXT_LIMIT_BYTES,
            enable_fuzzy: true,
            enable_extension_match: true,
            query_mode: LocalSearchQueryMode::Normal,
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
    state: Mutex<LocalSearchState>,
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
struct LocalSearchState {
    entries: Vec<IndexedEntry>,
    roots: BTreeMap<PathBuf, LocalSearchRootStatus>,
    storage: V3Storage,
    state: LocalSearchIndexState,
    phase: String,
    pending_changes: u64,
    load_error: Option<String>,
}

#[derive(Debug, Clone)]
struct V3Storage {
    native_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct V3Meta {
    engine_version: String,
    snapshot_version: u32,
    phase: String,
    roots: Vec<LocalSearchRootStatus>,
    pending_changes: u64,
    last_written_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotEntry {
    root: PathBuf,
    relative_path: PathBuf,
    full_path: PathBuf,
    display_path: String,
    kind: LocalSearchKind,
    extension: Option<String>,
    size_bytes: u64,
    modified_at: Option<u64>,
    created_at: Option<u64>,
    hidden: bool,
    vendor: bool,
    content_indexed: bool,
    content_text: Option<String>,
}

#[derive(Debug, Clone)]
struct IndexedEntry {
    root: PathBuf,
    relative_path: PathBuf,
    full_path: PathBuf,
    display_path: String,
    kind: LocalSearchKind,
    extension: Option<String>,
    lower_file_name: String,
    lower_path: String,
    size_bytes: u64,
    modified_at: Option<u64>,
    created_at: Option<u64>,
    hidden: bool,
    vendor: bool,
    content_indexed: bool,
    content_text: Option<String>,
}

#[derive(Debug)]
struct CollectedRoot {
    root: PathBuf,
    entries: Vec<IndexedEntry>,
    file_count: u64,
    dir_count: u64,
    content_file_count: u64,
    content_bytes_indexed: u64,
    skipped: LocalSearchSkippedStats,
    truncated: bool,
}

#[derive(Debug, Clone)]
struct Candidate {
    result: LocalSearchResult,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum DeltaRecord {
    Upsert { entry: SnapshotEntry },
    Delete { full_path: PathBuf },
    DeleteTree { full_path: PathBuf },
}

impl Default for LocalSearchEngine {
    fn default() -> Self {
        Self::with_config(LocalSearchEngineConfig::default())
    }
}

impl LocalSearchEngine {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_config(config: LocalSearchEngineConfig) -> Self {
        Self {
            state: Mutex::new(LocalSearchState::from_config(config)),
        }
    }

    pub fn status(&self) -> LocalSearchStatus {
        let state = match self.state.lock() {
            Ok(guard) => guard,
            Err(_) => return failed_status("local search state lock poisoned"),
        };
        status_from_state(&state)
    }

    pub fn index_root(
        &self,
        options: LocalSearchIndexRootOptions,
        cancel_flag: Option<Arc<AtomicBool>>,
    ) -> anyhow::Result<LocalSearchStatus> {
        let cancel_flag = cancel_flag.unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
        let root = normalize_existing_root(&options.root)?;
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| anyhow::anyhow!("local search state lock poisoned"))?;
            state.state = LocalSearchIndexState::Indexing;
            state.phase = "building".to_string();
            state
                .roots
                .insert(root.clone(), indexing_root_status(&root));
            write_meta(&state)?;
        }

        let collected = collect_root_entries(&root, &options, &cancel_flag)?;

        let mut state = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("local search state lock poisoned"))?;
        state.entries.retain(|entry| entry.root != collected.root);
        state.entries.extend(collected.entries);
        let root_state = if collected.truncated {
            LocalSearchIndexState::Partial
        } else {
            LocalSearchIndexState::Ready
        };
        state.roots.insert(
            collected.root.clone(),
            LocalSearchRootStatus {
                root: collected.root,
                state: root_state,
                indexed_file_count: collected.file_count,
                indexed_dir_count: collected.dir_count,
                indexed_content_file_count: collected.content_file_count,
                content_bytes_indexed: collected.content_bytes_indexed,
                skipped: collected.skipped,
                last_indexed_at: Some(unix_seconds_now()),
                error: None,
            },
        );
        state.state = aggregate_root_state(state.roots.values());
        state.phase = "ready".to_string();
        state.pending_changes = 0;
        write_snapshot(&state)?;
        clear_delta(&state.storage)?;
        write_meta(&state)?;
        Ok(status_from_state(&state))
    }

    pub fn apply_changes(
        &self,
        mut options: LocalSearchApplyChangesOptions,
        cancel_flag: Option<Arc<AtomicBool>>,
    ) -> anyhow::Result<LocalSearchStatus> {
        let cancel_flag = cancel_flag.unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
        let root = normalize_existing_root(&options.root)?;
        options.root = root.clone();
        let paths = normalize_change_paths(&root, &options.paths)?;
        if paths.is_empty() {
            return Ok(self.status());
        }

        let mut collected_entries = Vec::new();
        let mut delta_records = Vec::new();
        let mut skipped = LocalSearchSkippedStats::default();
        let mut content_bytes_indexed = 0_u64;
        let mut content_file_count = 0_u64;
        let mut file_count = 0_u64;
        let mut dir_count = 0_u64;

        for path in &paths {
            if cancel_flag.load(Ordering::Relaxed) {
                break;
            }
            if !path.exists() {
                delta_records.push(DeltaRecord::DeleteTree {
                    full_path: path.clone(),
                });
                continue;
            }
            let collected = collect_path_entries(
                &root,
                path,
                &LocalSearchIndexRootOptions {
                    root: root.clone(),
                    include_hidden: options.include_hidden,
                    include_vendor: options.include_vendor,
                    respect_gitignore: options.respect_gitignore,
                    content_mode: options.content_mode,
                    max_file_size_bytes: options.max_file_size_bytes,
                },
                &cancel_flag,
            )?;
            file_count = file_count.saturating_add(collected.file_count);
            dir_count = dir_count.saturating_add(collected.dir_count);
            content_file_count = content_file_count.saturating_add(collected.content_file_count);
            content_bytes_indexed =
                content_bytes_indexed.saturating_add(collected.content_bytes_indexed);
            skipped.add(&collected.skipped);
            delta_records.push(DeltaRecord::DeleteTree {
                full_path: path.clone(),
            });
            delta_records.extend(collected.entries.iter().cloned().map(|entry| {
                DeltaRecord::Upsert {
                    entry: SnapshotEntry::from(entry),
                }
            }));
            collected_entries.extend(collected.entries);
        }

        let mut state = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("local search state lock poisoned"))?;
        for path in &paths {
            remove_path_or_descendants(&mut state.entries, path);
        }
        state.entries.extend(collected_entries);
        append_delta(&state.storage, &delta_records)?;
        rebuild_root_status_from_entries(&mut state, &root);
        if let Some(status) = state.roots.get_mut(&root) {
            status.skipped.add(&skipped);
            status.content_bytes_indexed = status
                .content_bytes_indexed
                .saturating_add(content_bytes_indexed);
            status.indexed_content_file_count =
                status.indexed_content_file_count.max(content_file_count);
            status.indexed_file_count = status.indexed_file_count.max(file_count);
            status.indexed_dir_count = status.indexed_dir_count.max(dir_count);
            status.last_indexed_at = Some(unix_seconds_now());
            status.state = LocalSearchIndexState::Ready;
        }
        state.pending_changes = state
            .pending_changes
            .saturating_add(delta_records.len() as u64);
        state.state = aggregate_root_state(state.roots.values());
        state.phase = "ready".to_string();
        if should_compact_delta(&state.storage) {
            write_snapshot(&state)?;
            clear_delta(&state.storage)?;
            state.pending_changes = 0;
        }
        write_meta(&state)?;
        Ok(status_from_state(&state))
    }

    pub fn watch_roots(
        &self,
        roots: Vec<PathBuf>,
        mut options: LocalSearchIndexRootOptions,
        cancel_flag: Option<Arc<AtomicBool>>,
    ) -> anyhow::Result<LocalSearchStatus> {
        let cancel_flag = cancel_flag.unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
        for root in roots {
            if cancel_flag.load(Ordering::Relaxed) {
                break;
            }
            options.root = root;
            let _ = self.index_root(options.clone(), Some(cancel_flag.clone()))?;
        }
        Ok(self.status())
    }

    pub fn search(
        &self,
        mut options: LocalSearchOptions,
        cancel_flag: Option<Arc<AtomicBool>>,
    ) -> anyhow::Result<LocalSearchResponse> {
        options.limit = clamp_limit(options.limit);
        let cancel_flag = cancel_flag.unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
        let roots = normalize_search_roots(&options.roots)?;

        let (entries, indexed_roots, index_state) = {
            let state = self
                .state
                .lock()
                .map_err(|_| anyhow::anyhow!("local search state lock poisoned"))?;
            let indexed_roots = state.roots.keys().cloned().collect::<HashSet<_>>();
            let scoped_entries = scope_entries(&state.entries, &roots);
            (scoped_entries, indexed_roots, state.state)
        };

        let roots_for_response = if roots.is_empty() {
            indexed_roots.iter().cloned().collect::<Vec<_>>()
        } else {
            roots.clone()
        };

        let has_index_for_scope = if roots.is_empty() {
            !entries.is_empty()
        } else {
            roots.iter().all(|root| indexed_roots.contains(root))
        };
        if !has_index_for_scope {
            return Ok(LocalSearchResponse {
                query: options.query,
                roots: roots_for_response,
                results: Vec::new(),
                total_match_count: 0,
                truncated: false,
                index_state,
            });
        }

        let mut candidates = HashMap::<PathBuf, Candidate>::new();
        let max_candidates = options
            .limit
            .saturating_mul(candidate_multiplier(options.query_mode))
            .max(options.limit);
        let mut metadata_options = options.clone();
        metadata_options.content_mode = LocalSearchContentMode::Disabled;
        for entry in &entries {
            if cancel_flag.load(Ordering::Relaxed) {
                break;
            }
            if !entry_allowed(entry, &metadata_options) {
                continue;
            }
            if let Some((score, match_kind, source, snippet, line)) =
                score_v3_entry(entry, &metadata_options)
            {
                merge_candidate(
                    &mut candidates,
                    entry,
                    score,
                    source,
                    match_kind,
                    snippet,
                    line,
                    index_state,
                );
                if candidates.len() >= max_candidates
                    && options.query_mode == LocalSearchQueryMode::Fast
                {
                    break;
                }
            }
        }

        if candidates.len() < max_candidates
            && should_search_content(options.content_mode, options.query_mode)
        {
            for entry in &entries {
                if cancel_flag.load(Ordering::Relaxed) || candidates.len() >= max_candidates {
                    break;
                }
                if candidates.contains_key(&entry.full_path) || !entry_allowed(entry, &options) {
                    continue;
                }
                if let Some((score, match_kind, source, snippet, line)) =
                    score_v3_entry(entry, &options)
                {
                    merge_candidate(
                        &mut candidates,
                        entry,
                        score,
                        source,
                        match_kind,
                        snippet,
                        line,
                        index_state,
                    );
                }
            }
        }

        let total_match_count = candidates.len();
        let mut results = candidates
            .into_values()
            .map(|candidate| candidate.result)
            .collect::<Vec<_>>();
        results.sort_by(result_rank_order);
        let truncated = results.len() > options.limit;
        results.truncate(options.limit);
        Ok(LocalSearchResponse {
            query: options.query,
            roots: roots_for_response,
            results,
            total_match_count,
            truncated,
            index_state,
        })
    }

    pub fn read_result(
        &self,
        options: LocalSearchReadOptions,
    ) -> anyhow::Result<LocalSearchReadResponse> {
        let path = resolve_read_path(options.root.as_deref(), &options.path)?;
        let max_bytes = options.max_bytes.clamp(1, READ_RESULT_MAX_BYTES);
        let (contents, truncated, bytes_read) =
            read_text_at_offset(&path, options.offset, max_bytes)?;
        Ok(LocalSearchReadResponse {
            path,
            offset: options.offset,
            bytes_read,
            contents,
            truncated,
        })
    }

    pub fn extract_text(
        &self,
        options: LocalSearchExtractTextOptions,
    ) -> anyhow::Result<LocalSearchExtractTextResponse> {
        let max_bytes = options.max_bytes.clamp(1, READ_RESULT_MAX_BYTES);
        let (text, truncated) = read_text_file_with_limit(&options.path, max_bytes as u64)?
            .ok_or_else(|| anyhow::anyhow!("file is binary, unsupported, or not valid text"))?;
        Ok(LocalSearchExtractTextResponse {
            path: options.path,
            text,
            truncated,
            extraction_method: "plain-text".to_string(),
        })
    }
}

impl LocalSearchState {
    fn from_config(config: LocalSearchEngineConfig) -> Self {
        let storage = V3Storage::from_mode(&config.storage_mode);
        let mut state = Self {
            entries: Vec::new(),
            roots: BTreeMap::new(),
            storage,
            state: LocalSearchIndexState::Empty,
            phase: "idle".to_string(),
            pending_changes: 0,
            load_error: None,
        };
        if let Err(error) = load_v3_state(&mut state) {
            state.state = LocalSearchIndexState::Failed;
            state.phase = "failed".to_string();
            state.load_error = Some(format!("local search v3 load failed: {error}"));
        }
        state
    }
}

impl V3Storage {
    fn from_mode(mode: &LocalSearchStorageMode) -> Self {
        match mode {
            LocalSearchStorageMode::Memory => Self { native_dir: None },
            LocalSearchStorageMode::Persistent { storage_root } => Self {
                native_dir: Some(storage_root.join("native")),
            },
        }
    }

    fn snapshot_path(&self) -> Option<PathBuf> {
        self.native_dir
            .as_ref()
            .map(|dir| dir.join("snapshot.lyidx"))
    }

    fn delta_path(&self) -> Option<PathBuf> {
        self.native_dir.as_ref().map(|dir| dir.join("delta.lylog"))
    }

    fn meta_path(&self) -> Option<PathBuf> {
        self.native_dir.as_ref().map(|dir| dir.join("meta.json"))
    }
}

impl From<IndexedEntry> for SnapshotEntry {
    fn from(entry: IndexedEntry) -> Self {
        Self {
            root: entry.root,
            relative_path: entry.relative_path,
            full_path: entry.full_path,
            display_path: entry.display_path,
            kind: entry.kind,
            extension: entry.extension,
            size_bytes: entry.size_bytes,
            modified_at: entry.modified_at,
            created_at: entry.created_at,
            hidden: entry.hidden,
            vendor: entry.vendor,
            content_indexed: entry.content_indexed,
            content_text: entry.content_text,
        }
    }
}

impl From<SnapshotEntry> for IndexedEntry {
    fn from(entry: SnapshotEntry) -> Self {
        let lower_file_name = entry
            .full_path
            .file_name()
            .map(|name| name.to_string_lossy().to_lowercase())
            .unwrap_or_else(|| entry.display_path.to_lowercase());
        let lower_path = entry.display_path.to_lowercase();
        Self {
            root: entry.root,
            relative_path: entry.relative_path,
            full_path: entry.full_path,
            display_path: entry.display_path,
            kind: entry.kind,
            extension: entry.extension,
            lower_file_name,
            lower_path,
            size_bytes: entry.size_bytes,
            modified_at: entry.modified_at,
            created_at: entry.created_at,
            hidden: entry.hidden,
            vendor: entry.vendor,
            content_indexed: entry.content_indexed,
            content_text: entry.content_text,
        }
    }
}

fn load_v3_state(state: &mut LocalSearchState) -> anyhow::Result<()> {
    let Some(snapshot_path) = state.storage.snapshot_path() else {
        return Ok(());
    };
    if !snapshot_path.exists() {
        return Ok(());
    }
    state.entries = read_snapshot(&snapshot_path)?;
    if let Some(meta_path) = state.storage.meta_path() {
        if meta_path.exists() {
            if let Ok(text) = fs::read_to_string(&meta_path) {
                if let Ok(meta) = serde_json::from_str::<V3Meta>(&text) {
                    state.roots = meta
                        .roots
                        .into_iter()
                        .map(|root| (root.root.clone(), root))
                        .collect();
                    state.pending_changes = meta.pending_changes;
                    state.phase = meta.phase;
                }
            }
        }
    }
    replay_delta(state)?;
    if state.roots.is_empty() && !state.entries.is_empty() {
        rebuild_all_root_statuses(state);
    }
    state.state = aggregate_root_state(state.roots.values());
    if state.state == LocalSearchIndexState::Empty && !state.entries.is_empty() {
        state.state = LocalSearchIndexState::Ready;
    }
    Ok(())
}

fn read_snapshot(path: &Path) -> anyhow::Result<Vec<IndexedEntry>> {
    let mut file = fs::File::open(path)?;
    let mut magic = [0_u8; 8];
    file.read_exact(&mut magic)?;
    if &magic != SNAPSHOT_MAGIC {
        anyhow::bail!("invalid snapshot magic");
    }
    let version = read_u32(&mut file)?;
    if version != SNAPSHOT_VERSION {
        anyhow::bail!("unsupported snapshot version {version}");
    }
    let count = read_u64(&mut file)?;
    let mut entries = Vec::new();
    for _ in 0..count {
        let snapshot = SnapshotEntry {
            root: PathBuf::from(read_string(&mut file)?),
            relative_path: PathBuf::from(read_string(&mut file)?),
            full_path: PathBuf::from(read_string(&mut file)?),
            display_path: read_string(&mut file)?,
            kind: if read_u8(&mut file)? == 1 {
                LocalSearchKind::Directory
            } else {
                LocalSearchKind::File
            },
            extension: read_optional_string(&mut file)?,
            size_bytes: read_u64(&mut file)?,
            modified_at: read_optional_u64(&mut file)?,
            created_at: read_optional_u64(&mut file)?,
            hidden: read_u8(&mut file)? != 0,
            vendor: read_u8(&mut file)? != 0,
            content_indexed: read_u8(&mut file)? != 0,
            content_text: read_optional_string(&mut file)?,
        };
        entries.push(IndexedEntry::from(snapshot));
    }
    Ok(entries)
}

fn write_snapshot(state: &LocalSearchState) -> anyhow::Result<()> {
    let Some(snapshot_path) = state.storage.snapshot_path() else {
        return Ok(());
    };
    let native_dir = snapshot_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("snapshot path has no parent"))?;
    fs::create_dir_all(native_dir)?;
    let tmp_path = snapshot_path.with_extension("lyidx.tmp");
    let mut file = fs::File::create(&tmp_path)?;
    file.write_all(SNAPSHOT_MAGIC)?;
    write_u32(&mut file, SNAPSHOT_VERSION)?;
    write_u64(&mut file, state.entries.len() as u64)?;
    for entry in &state.entries {
        write_string(&mut file, &normalize_path_for_display(&entry.root))?;
        write_string(&mut file, &normalize_path_for_display(&entry.relative_path))?;
        write_string(&mut file, &normalize_path_for_display(&entry.full_path))?;
        write_string(&mut file, &entry.display_path)?;
        write_u8(
            &mut file,
            if entry.kind == LocalSearchKind::Directory {
                1
            } else {
                0
            },
        )?;
        write_optional_string(&mut file, entry.extension.as_deref())?;
        write_u64(&mut file, entry.size_bytes)?;
        write_optional_u64(&mut file, entry.modified_at)?;
        write_optional_u64(&mut file, entry.created_at)?;
        write_u8(&mut file, u8::from(entry.hidden))?;
        write_u8(&mut file, u8::from(entry.vendor))?;
        write_u8(&mut file, u8::from(entry.content_indexed))?;
        write_optional_string(&mut file, entry.content_text.as_deref())?;
    }
    file.flush()?;
    fs::rename(tmp_path, snapshot_path)?;
    Ok(())
}

fn write_meta(state: &LocalSearchState) -> anyhow::Result<()> {
    let Some(meta_path) = state.storage.meta_path() else {
        return Ok(());
    };
    let native_dir = meta_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("meta path has no parent"))?;
    fs::create_dir_all(native_dir)?;
    let tmp_path = meta_path.with_extension("json.tmp");
    let meta = V3Meta {
        engine_version: ENGINE_VERSION.to_string(),
        snapshot_version: SNAPSHOT_VERSION,
        phase: state.phase.clone(),
        roots: state.roots.values().cloned().collect(),
        pending_changes: state.pending_changes,
        last_written_at: Some(unix_seconds_now()),
    };
    fs::write(&tmp_path, serde_json::to_vec_pretty(&meta)?)?;
    fs::rename(tmp_path, meta_path)?;
    Ok(())
}

fn replay_delta(state: &mut LocalSearchState) -> anyhow::Result<()> {
    let Some(delta_path) = state.storage.delta_path() else {
        return Ok(());
    };
    if !delta_path.exists() {
        return Ok(());
    }
    let text = fs::read_to_string(&delta_path)?;
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let record: DeltaRecord = serde_json::from_str(line)?;
        apply_delta_record(&mut state.entries, record);
        state.pending_changes = state.pending_changes.saturating_add(1);
    }
    Ok(())
}

fn apply_delta_record(entries: &mut Vec<IndexedEntry>, record: DeltaRecord) {
    match record {
        DeltaRecord::Upsert { entry } => {
            let entry = IndexedEntry::from(entry);
            entries.retain(|existing| existing.full_path != entry.full_path);
            entries.push(entry);
        }
        DeltaRecord::Delete { full_path } => {
            entries.retain(|entry| entry.full_path != full_path);
        }
        DeltaRecord::DeleteTree { full_path } => {
            remove_path_or_descendants(entries, &full_path);
        }
    }
}

fn append_delta(storage: &V3Storage, records: &[DeltaRecord]) -> anyhow::Result<()> {
    if records.is_empty() {
        return Ok(());
    }
    let Some(delta_path) = storage.delta_path() else {
        return Ok(());
    };
    if let Some(native_dir) = delta_path.parent() {
        fs::create_dir_all(native_dir)?;
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(delta_path)?;
    for record in records {
        serde_json::to_writer(&mut file, record)?;
        file.write_all(b"\n")?;
    }
    Ok(())
}

fn clear_delta(storage: &V3Storage) -> anyhow::Result<()> {
    if let Some(delta_path) = storage.delta_path() {
        if let Some(parent) = delta_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(delta_path, [])?;
    }
    Ok(())
}

fn should_compact_delta(storage: &V3Storage) -> bool {
    let delta_bytes = storage
        .delta_path()
        .and_then(|path| file_len(&path))
        .unwrap_or(0);
    if delta_bytes >= DELTA_COMPACT_BYTES {
        return true;
    }
    let snapshot_bytes = storage
        .snapshot_path()
        .and_then(|path| file_len(&path))
        .unwrap_or(0);
    snapshot_bytes > 0 && delta_bytes > snapshot_bytes / 10
}

fn collect_root_entries(
    root: &Path,
    options: &LocalSearchIndexRootOptions,
    cancel_flag: &AtomicBool,
) -> anyhow::Result<CollectedRoot> {
    collect_path_entries(root, root, options, cancel_flag)
}

fn collect_path_entries(
    root: &Path,
    path: &Path,
    options: &LocalSearchIndexRootOptions,
    cancel_flag: &AtomicBool,
) -> anyhow::Result<CollectedRoot> {
    let root = normalize_existing_root(root)?;
    let path = if path.exists() {
        normalize_existing_root(path)?
    } else {
        path.to_path_buf()
    };
    let mut collected = CollectedRoot {
        root: root.clone(),
        entries: Vec::new(),
        file_count: 0,
        dir_count: 0,
        content_file_count: 0,
        content_bytes_indexed: 0,
        skipped: LocalSearchSkippedStats::default(),
        truncated: false,
    };
    let mut content_budget_remaining = ROOT_CONTENT_BUDGET_BYTES;

    if path.is_file() {
        collect_single_entry(
            &path,
            &root,
            options,
            &mut content_budget_remaining,
            &mut collected,
        )?;
        return Ok(collected);
    }

    if !path.is_dir() {
        return Ok(collected);
    }

    let mut builder = WalkBuilder::new(&path);
    builder
        .hidden(!options.include_hidden)
        .follow_links(false)
        .require_git(true);
    if !options.respect_gitignore {
        builder
            .git_ignore(false)
            .git_global(false)
            .git_exclude(false)
            .ignore(false)
            .parents(false);
    }
    for entry in builder.build() {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                collected.skipped.unreadable = collected.skipped.unreadable.saturating_add(1);
                continue;
            }
        };
        let entry_path = entry.path();
        if entry_path == root {
            continue;
        }
        let relative = relative_display_path(entry_path, &root);
        if !options.include_hidden && path_has_hidden_component(&relative) {
            collected.skipped.hidden = collected.skipped.hidden.saturating_add(1);
            continue;
        }
        if !options.include_vendor && path_has_vendor_component(&relative) {
            collected.skipped.vendor = collected.skipped.vendor.saturating_add(1);
            continue;
        }
        collect_single_entry(
            entry_path,
            &root,
            options,
            &mut content_budget_remaining,
            &mut collected,
        )?;
    }
    Ok(collected)
}

fn collect_single_entry(
    path: &Path,
    root: &Path,
    options: &LocalSearchIndexRootOptions,
    content_budget_remaining: &mut u64,
    collected: &mut CollectedRoot,
) -> anyhow::Result<()> {
    match indexed_entry_for_path(
        path,
        root,
        options,
        content_budget_remaining,
        &mut collected.skipped,
    ) {
        Ok(Some(entry)) => {
            match entry.kind {
                LocalSearchKind::File => collected.file_count += 1,
                LocalSearchKind::Directory => collected.dir_count += 1,
            }
            if entry.content_indexed {
                collected.content_file_count += 1;
                collected.content_bytes_indexed = collected.content_bytes_indexed.saturating_add(
                    entry
                        .content_text
                        .as_ref()
                        .map(|text| text.len() as u64)
                        .unwrap_or(0),
                );
            }
            collected.entries.push(entry);
        }
        Ok(None) => {}
        Err(_) => {
            collected.skipped.unreadable = collected.skipped.unreadable.saturating_add(1);
        }
    }
    Ok(())
}

fn indexed_entry_for_path(
    path: &Path,
    root: &Path,
    options: &LocalSearchIndexRootOptions,
    content_budget_remaining: &mut u64,
    skipped: &mut LocalSearchSkippedStats,
) -> anyhow::Result<Option<IndexedEntry>> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => {
            skipped.unreadable = skipped.unreadable.saturating_add(1);
            return Ok(None);
        }
    };
    let kind = if metadata.is_dir() {
        LocalSearchKind::Directory
    } else if metadata.is_file() {
        LocalSearchKind::File
    } else {
        return Ok(None);
    };
    let relative_path = relative_display_path(path, root);
    let display_path = normalize_path_for_display(&relative_path);
    if display_path.is_empty() {
        return Ok(None);
    }
    let hidden = path_has_hidden_component(&relative_path);
    if hidden && !options.include_hidden {
        skipped.hidden = skipped.hidden.saturating_add(1);
        return Ok(None);
    }
    let vendor = path_has_vendor_component(&relative_path);
    if vendor && !options.include_vendor {
        skipped.vendor = skipped.vendor.saturating_add(1);
        return Ok(None);
    }
    let extension = normalized_extension(path);
    let (content_indexed, content_text) = extract_indexable_text(
        path,
        kind,
        extension.as_deref(),
        metadata.len(),
        options.content_mode,
        options.max_file_size_bytes,
        content_budget_remaining,
        skipped,
    )?;
    let lower_path = display_path.to_lowercase();
    let lower_file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| lower_path.clone());
    Ok(Some(IndexedEntry {
        root: root.to_path_buf(),
        relative_path,
        full_path: path.to_path_buf(),
        display_path,
        kind,
        extension,
        lower_file_name,
        lower_path,
        size_bytes: metadata.len(),
        modified_at: metadata
            .modified()
            .ok()
            .and_then(system_time_to_unix_seconds),
        created_at: metadata
            .created()
            .ok()
            .and_then(system_time_to_unix_seconds),
        hidden,
        vendor,
        content_indexed,
        content_text,
    }))
}

fn extract_indexable_text(
    path: &Path,
    kind: LocalSearchKind,
    extension: Option<&str>,
    size_bytes: u64,
    mode: LocalSearchContentMode,
    max_file_size_bytes: u64,
    content_budget_remaining: &mut u64,
    skipped: &mut LocalSearchSkippedStats,
) -> anyhow::Result<(bool, Option<String>)> {
    if kind != LocalSearchKind::File || mode == LocalSearchContentMode::Disabled {
        return Ok((false, None));
    }
    if !extension
        .map(|extension| {
            TEXT_EXTENSIONS
                .iter()
                .any(|item| extension.eq_ignore_ascii_case(item))
        })
        .unwrap_or(false)
    {
        return Ok((false, None));
    }
    if size_bytes > max_file_size_bytes {
        skipped.binary_or_too_large = skipped.binary_or_too_large.saturating_add(1);
        return Ok((false, None));
    }
    if size_bytes > *content_budget_remaining {
        skipped.content_budget = skipped.content_budget.saturating_add(1);
        return Ok((false, None));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(max_file_size_bytes.saturating_add(1))
        .read_to_end(&mut bytes)?;
    if !native::is_probably_text(&bytes) {
        skipped.binary_or_too_large = skipped.binary_or_too_large.saturating_add(1);
        return Ok((false, None));
    }
    if bytes.len() as u64 > max_file_size_bytes {
        skipped.binary_or_too_large = skipped.binary_or_too_large.saturating_add(1);
        return Ok((false, None));
    }
    *content_budget_remaining = (*content_budget_remaining).saturating_sub(bytes.len() as u64);
    Ok((true, Some(String::from_utf8_lossy(&bytes).to_string())))
}

fn score_v3_entry(
    entry: &IndexedEntry,
    options: &LocalSearchOptions,
) -> Option<(
    u32,
    LocalSearchMatchKind,
    LocalSearchSource,
    Option<String>,
    Option<u64>,
)> {
    let query = options.query.trim().to_lowercase();
    if query.is_empty() {
        return initial_entry_score(entry).map(|score| {
            (
                score,
                LocalSearchMatchKind::Initial,
                LocalSearchSource::Index,
                None,
                None,
            )
        });
    }
    let native_score = native::v3_score_entry(native::V3ScoreInput {
        query: &query,
        lower_file_name: &entry.lower_file_name,
        lower_path: &entry.lower_path,
        extension: entry.extension.as_deref().unwrap_or(""),
        content_hit: false,
        is_directory: entry.kind == LocalSearchKind::Directory,
        vendor: entry.vendor,
        enable_fuzzy: options.enable_fuzzy,
        enable_extension_match: options.enable_extension_match,
    });
    if native_score.score > 0 {
        return Some(score_tuple(native_score, None));
    }

    let content_hit = if should_search_content(options.content_mode, options.query_mode)
        && entry.content_indexed
    {
        entry
            .content_text
            .as_deref()
            .and_then(|text| snippet_for_text(text, &query))
    } else {
        None
    }?;
    let content_score = native::v3_score_entry(native::V3ScoreInput {
        query: &query,
        lower_file_name: &entry.lower_file_name,
        lower_path: &entry.lower_path,
        extension: entry.extension.as_deref().unwrap_or(""),
        content_hit: true,
        is_directory: entry.kind == LocalSearchKind::Directory,
        vendor: entry.vendor,
        enable_fuzzy: false,
        enable_extension_match: false,
    });
    Some(score_tuple(content_score, Some(content_hit)))
}

fn score_tuple(
    native_score: native::V3NativeScore,
    content_hit: Option<TextHit>,
) -> (
    u32,
    LocalSearchMatchKind,
    LocalSearchSource,
    Option<String>,
    Option<u64>,
) {
    let match_kind = match native_score.match_kind {
        native::V3_MATCH_FILE_NAME => LocalSearchMatchKind::FileName,
        native::V3_MATCH_PATH => LocalSearchMatchKind::Path,
        native::V3_MATCH_EXTENSION => LocalSearchMatchKind::Extension,
        native::V3_MATCH_CONTENT => LocalSearchMatchKind::Content,
        native::V3_MATCH_FUZZY => LocalSearchMatchKind::Fuzzy,
        _ => LocalSearchMatchKind::Metadata,
    };
    let source = if native_score.source == native::V3_SOURCE_CONTENT {
        LocalSearchSource::Content
    } else {
        LocalSearchSource::Index
    };
    let (snippet, line) = if match_kind == LocalSearchMatchKind::Content {
        content_hit
            .map(|hit| (Some(hit.snippet), Some(hit.line)))
            .unwrap_or((None, None))
    } else {
        (None, None)
    };
    (native_score.score, match_kind, source, snippet, line)
}

fn initial_entry_score(entry: &IndexedEntry) -> Option<u32> {
    let depth = entry.relative_path.components().count();
    if depth == 0 {
        return None;
    }
    let file_name = entry
        .relative_path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    if COMMON_PROJECT_ENTRY_NAMES
        .iter()
        .any(|candidate| file_name.eq_ignore_ascii_case(candidate))
        || file_name.to_lowercase().starts_with("readme.")
    {
        return Some(1_000_000_u32.saturating_sub((depth as u32).saturating_mul(1_000)));
    }
    if depth == 1 {
        return Some(850_000);
    }
    if entry.kind == LocalSearchKind::File && depth <= 3 && entry.extension.is_some() {
        return Some(740_000_u32.saturating_sub((depth as u32).saturating_mul(1_000)));
    }
    None
}

#[derive(Debug)]
struct TextHit {
    line: u64,
    snippet: String,
}

fn snippet_for_text(text: &str, query_lower: &str) -> Option<TextHit> {
    for (index, line) in text.lines().enumerate() {
        if line.to_lowercase().contains(query_lower) {
            return Some(TextHit {
                line: index as u64 + 1,
                snippet: clip_snippet(line, SNIPPET_MAX_CHARS),
            });
        }
    }
    None
}

fn clip_snippet(line: &str, max_chars: usize) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let mut clipped = trimmed.chars().take(max_chars).collect::<String>();
    clipped.push_str("...");
    clipped
}

fn merge_candidate(
    candidates: &mut HashMap<PathBuf, Candidate>,
    entry: &IndexedEntry,
    score: u32,
    source: LocalSearchSource,
    match_kind: LocalSearchMatchKind,
    snippet: Option<String>,
    line: Option<u64>,
    index_state: LocalSearchIndexState,
) {
    let result = LocalSearchResult {
        path: entry.full_path.clone(),
        display_path: entry.display_path.clone(),
        root: entry.root.clone(),
        kind: entry.kind,
        score,
        source,
        match_kind,
        snippet,
        line,
        metadata: Some(LocalSearchMetadata {
            extension: entry.extension.clone(),
            size_bytes: entry.size_bytes,
            modified_at: entry.modified_at,
            created_at: entry.created_at,
            hidden: entry.hidden,
        }),
        index_state,
    };
    match candidates.get_mut(&entry.full_path) {
        Some(existing) if result.score > existing.result.score => {
            existing.result = result;
        }
        Some(existing) if existing.result.snippet.is_none() && result.snippet.is_some() => {
            existing.result.snippet = result.snippet;
            existing.result.line = result.line;
            if result.match_kind == LocalSearchMatchKind::Content {
                existing.result.match_kind = LocalSearchMatchKind::Content;
                existing.result.source = LocalSearchSource::Content;
            }
        }
        Some(_) => {}
        None => {
            candidates.insert(entry.full_path.clone(), Candidate { result });
        }
    }
}

fn entry_allowed(entry: &IndexedEntry, options: &LocalSearchOptions) -> bool {
    if entry.hidden && !options.include_hidden {
        return false;
    }
    if entry.vendor && !options.include_vendor {
        return false;
    }
    if !options.kinds.is_empty() && !options.kinds.contains(&entry.kind) {
        return false;
    }
    if !options.extensions.is_empty() && entry.kind == LocalSearchKind::File {
        let allowed = options
            .extensions
            .iter()
            .map(|value| normalize_extension_filter(value))
            .any(|extension| entry.extension.as_deref() == Some(extension.as_str()));
        if !allowed {
            return false;
        }
    }
    true
}

fn should_search_content(mode: LocalSearchContentMode, query_mode: LocalSearchQueryMode) -> bool {
    mode != LocalSearchContentMode::Disabled && query_mode != LocalSearchQueryMode::Fast
}

fn candidate_multiplier(mode: LocalSearchQueryMode) -> usize {
    match mode {
        LocalSearchQueryMode::Fast => SEARCH_CANDIDATE_MULTIPLIER_FAST,
        LocalSearchQueryMode::Normal => SEARCH_CANDIDATE_MULTIPLIER_NORMAL,
        LocalSearchQueryMode::Full => SEARCH_CANDIDATE_MULTIPLIER_FULL,
    }
}

fn read_text_at_offset(
    path: &Path,
    offset: u64,
    max_bytes: usize,
) -> anyhow::Result<(String, bool, usize)> {
    let mut file = fs::File::open(path)?;
    let metadata = file.metadata()?;
    use std::io::Seek;
    file.seek(std::io::SeekFrom::Start(offset))?;
    let mut bytes = Vec::new();
    let mut reader = file.take((max_bytes as u64).saturating_add(1));
    reader.read_to_end(&mut bytes)?;
    let truncated =
        bytes.len() > max_bytes || offset.saturating_add(bytes.len() as u64) < metadata.len();
    if bytes.len() > max_bytes {
        bytes.truncate(max_bytes);
    }
    let bytes_read = bytes.len();
    let contents = String::from_utf8_lossy(&bytes).to_string();
    Ok((contents, truncated, bytes_read))
}

fn read_text_file_with_limit(
    path: &Path,
    max_bytes: u64,
) -> anyhow::Result<Option<(String, bool)>> {
    let metadata = fs::metadata(path)?;
    if !metadata.is_file() {
        return Ok(None);
    }
    let limit = max_bytes.min(READ_RESULT_MAX_BYTES as u64);
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes)?;
    if !native::is_probably_text(&bytes) {
        return Ok(None);
    }
    let truncated = bytes.len() as u64 > limit || metadata.len() > limit;
    if bytes.len() as u64 > limit {
        bytes.truncate(limit as usize);
    }
    Ok(Some((
        String::from_utf8_lossy(&bytes).to_string(),
        truncated,
    )))
}

fn resolve_read_path(root: Option<&Path>, path: &Path) -> anyhow::Result<PathBuf> {
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else if let Some(root) = root {
        root.join(path)
    } else {
        path.to_path_buf()
    };
    if let Some(root) = root {
        let canonical_root = normalize_existing_root(root)?;
        let canonical_candidate = candidate.canonicalize()?;
        if !canonical_candidate.starts_with(&canonical_root) {
            anyhow::bail!("path is outside root");
        }
        return Ok(canonical_candidate);
    }
    Ok(candidate.canonicalize()?)
}

fn scope_entries(entries: &[IndexedEntry], roots: &[PathBuf]) -> Vec<IndexedEntry> {
    if roots.is_empty() {
        return entries.to_vec();
    }
    entries
        .iter()
        .filter(|entry| roots.iter().any(|root| &entry.root == root))
        .cloned()
        .collect()
}

fn normalize_search_roots(roots: &[PathBuf]) -> anyhow::Result<Vec<PathBuf>> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for root in roots {
        let candidate = normalize_existing_root(root)?;
        if seen.insert(normalize_path_for_display(&candidate)) {
            normalized.push(candidate);
        }
    }
    Ok(normalized)
}

fn normalize_change_paths(root: &Path, paths: &[PathBuf]) -> anyhow::Result<Vec<PathBuf>> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for path in paths {
        let candidate = if path.is_absolute() {
            path.clone()
        } else {
            root.join(path)
        };
        let normalized_path = normalize_existing_or_missing_path(&candidate);
        if !normalized_path.starts_with(root) {
            continue;
        }
        if seen.insert(normalize_path_for_display(&normalized_path)) {
            normalized.push(normalized_path);
        }
    }
    Ok(normalized)
}

fn normalize_existing_root(root: &Path) -> anyhow::Result<PathBuf> {
    let path = if root.as_os_str().is_empty() {
        std::env::current_dir()?
    } else if root.is_absolute() {
        root.to_path_buf()
    } else {
        std::env::current_dir()?.join(root)
    };
    Ok(path.canonicalize()?)
}

fn normalize_existing_or_missing_path(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return canonical;
    }
    let mut ancestor = path;
    let mut tail = Vec::new();
    while !ancestor.as_os_str().is_empty() && !ancestor.exists() {
        let Some(name) = ancestor.file_name() else {
            break;
        };
        tail.push(name.to_os_string());
        let Some(parent) = ancestor.parent() else {
            break;
        };
        ancestor = parent;
    }
    let mut normalized = ancestor
        .canonicalize()
        .unwrap_or_else(|_| ancestor.to_path_buf());
    for component in tail.into_iter().rev() {
        normalized.push(component);
    }
    normalized
}

fn normalize_path_for_display(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn normalized_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(normalize_extension_filter)
        .filter(|extension| !extension.is_empty())
}

fn normalize_extension_filter(value: &str) -> String {
    value.trim().trim_start_matches('.').to_lowercase()
}

fn relative_display_path(path: &Path, root: &Path) -> PathBuf {
    match path.strip_prefix(root) {
        Ok(relative) if !relative.as_os_str().is_empty() => relative.to_path_buf(),
        _ => path
            .file_name()
            .map(PathBuf::from)
            .unwrap_or_else(|| path.to_path_buf()),
    }
}

fn path_has_hidden_component(path: &Path) -> bool {
    path.components().any(|component| match component {
        Component::Normal(value) => value.to_str().is_some_and(|value| value.starts_with('.')),
        _ => false,
    })
}

fn path_has_vendor_component(path: &Path) -> bool {
    path.components().any(|component| match component {
        Component::Normal(value) => value
            .to_str()
            .is_some_and(|value| is_skipped_directory_name(value)),
        _ => false,
    })
}

fn is_skipped_directory_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    SKIPPED_DIRECTORY_NAMES
        .iter()
        .any(|candidate| *candidate == name)
}

fn remove_path_or_descendants(entries: &mut Vec<IndexedEntry>, path: &Path) {
    entries.retain(|entry| entry.full_path != path && !entry.full_path.starts_with(path));
}

fn rebuild_all_root_statuses(state: &mut LocalSearchState) {
    let roots = state
        .entries
        .iter()
        .map(|entry| entry.root.clone())
        .collect::<HashSet<_>>();
    for root in roots {
        rebuild_root_status_from_entries(state, &root);
    }
}

fn rebuild_root_status_from_entries(state: &mut LocalSearchState, root: &Path) {
    let mut indexed_file_count = 0_u64;
    let mut indexed_dir_count = 0_u64;
    let mut indexed_content_file_count = 0_u64;
    let mut content_bytes_indexed = 0_u64;
    for entry in state.entries.iter().filter(|entry| entry.root == root) {
        match entry.kind {
            LocalSearchKind::File => indexed_file_count += 1,
            LocalSearchKind::Directory => indexed_dir_count += 1,
        }
        if entry.content_indexed {
            indexed_content_file_count += 1;
            content_bytes_indexed = content_bytes_indexed.saturating_add(
                entry
                    .content_text
                    .as_ref()
                    .map(|text| text.len() as u64)
                    .unwrap_or(0),
            );
        }
    }
    let mut skipped = state
        .roots
        .get(root)
        .map(|status| status.skipped.clone())
        .unwrap_or_default();
    if indexed_file_count == 0 && indexed_dir_count == 0 {
        skipped = LocalSearchSkippedStats::default();
    }
    state.roots.insert(
        root.to_path_buf(),
        LocalSearchRootStatus {
            root: root.to_path_buf(),
            state: if indexed_file_count == 0 && indexed_dir_count == 0 {
                LocalSearchIndexState::Empty
            } else {
                LocalSearchIndexState::Ready
            },
            indexed_file_count,
            indexed_dir_count,
            indexed_content_file_count,
            content_bytes_indexed,
            skipped,
            last_indexed_at: Some(unix_seconds_now()),
            error: None,
        },
    );
}

fn indexing_root_status(root: &Path) -> LocalSearchRootStatus {
    LocalSearchRootStatus {
        root: root.to_path_buf(),
        state: LocalSearchIndexState::Indexing,
        indexed_file_count: 0,
        indexed_dir_count: 0,
        indexed_content_file_count: 0,
        content_bytes_indexed: 0,
        skipped: LocalSearchSkippedStats::default(),
        last_indexed_at: None,
        error: None,
    }
}

fn aggregate_root_state<'a>(
    roots: impl Iterator<Item = &'a LocalSearchRootStatus>,
) -> LocalSearchIndexState {
    let mut saw_partial = false;
    let mut saw_ready = false;
    let mut saw_indexing = false;
    let mut saw_failed = false;
    for root in roots {
        match root.state {
            LocalSearchIndexState::Indexing => saw_indexing = true,
            LocalSearchIndexState::Partial => saw_partial = true,
            LocalSearchIndexState::Ready => saw_ready = true,
            LocalSearchIndexState::Failed => saw_failed = true,
            LocalSearchIndexState::Empty | LocalSearchIndexState::Walker => {}
        }
    }
    if saw_indexing {
        LocalSearchIndexState::Indexing
    } else if saw_failed && !saw_ready && !saw_partial {
        LocalSearchIndexState::Failed
    } else if saw_partial || (saw_failed && saw_ready) {
        LocalSearchIndexState::Partial
    } else if saw_ready {
        LocalSearchIndexState::Ready
    } else {
        LocalSearchIndexState::Empty
    }
}

fn status_from_state(state: &LocalSearchState) -> LocalSearchStatus {
    let mut roots = state.roots.values().cloned().collect::<Vec<_>>();
    if roots.is_empty() {
        if let Some(load_error) = &state.load_error {
            roots.push(LocalSearchRootStatus {
                root: PathBuf::new(),
                state: LocalSearchIndexState::Failed,
                indexed_file_count: 0,
                indexed_dir_count: 0,
                indexed_content_file_count: 0,
                content_bytes_indexed: 0,
                skipped: LocalSearchSkippedStats::default(),
                last_indexed_at: None,
                error: Some(load_error.clone()),
            });
        }
    }
    let indexed_file_count = roots
        .iter()
        .map(|root| root.indexed_file_count)
        .sum::<u64>();
    let indexed_dir_count = roots.iter().map(|root| root.indexed_dir_count).sum::<u64>();
    let indexed_content_file_count = roots
        .iter()
        .map(|root| root.indexed_content_file_count)
        .sum::<u64>();
    let content_bytes_indexed = roots
        .iter()
        .map(|root| root.content_bytes_indexed)
        .sum::<u64>();
    let mut skipped = LocalSearchSkippedStats::default();
    for root in &roots {
        skipped.add(&root.skipped);
    }
    LocalSearchStatus {
        state: state.state,
        engine_version: ENGINE_VERSION.to_string(),
        phase: state.phase.clone(),
        roots,
        indexed_file_count,
        indexed_dir_count,
        indexed_content_file_count,
        content_bytes_indexed,
        storage_bytes: storage_size(&state.storage),
        snapshot_bytes: state
            .storage
            .snapshot_path()
            .and_then(|path| file_len(&path))
            .unwrap_or(0),
        delta_bytes: state
            .storage
            .delta_path()
            .and_then(|path| file_len(&path))
            .unwrap_or(0),
        pending_changes: state.pending_changes,
        skipped,
    }
}

fn failed_status(message: &str) -> LocalSearchStatus {
    LocalSearchStatus {
        state: LocalSearchIndexState::Failed,
        engine_version: ENGINE_VERSION.to_string(),
        phase: "failed".to_string(),
        roots: vec![LocalSearchRootStatus {
            root: PathBuf::new(),
            state: LocalSearchIndexState::Failed,
            indexed_file_count: 0,
            indexed_dir_count: 0,
            indexed_content_file_count: 0,
            content_bytes_indexed: 0,
            skipped: LocalSearchSkippedStats::default(),
            last_indexed_at: None,
            error: Some(message.to_string()),
        }],
        indexed_file_count: 0,
        indexed_dir_count: 0,
        indexed_content_file_count: 0,
        content_bytes_indexed: 0,
        storage_bytes: 0,
        snapshot_bytes: 0,
        delta_bytes: 0,
        pending_changes: 0,
        skipped: LocalSearchSkippedStats::default(),
    }
}

fn result_rank_order(left: &LocalSearchResult, right: &LocalSearchResult) -> std::cmp::Ordering {
    right
        .score
        .cmp(&left.score)
        .then_with(|| left.display_path.cmp(&right.display_path))
        .then_with(|| left.path.cmp(&right.path))
}

fn clamp_limit(limit: usize) -> usize {
    limit.clamp(1, MAX_LIMIT)
}

fn storage_size(storage: &V3Storage) -> u64 {
    let Some(native_dir) = &storage.native_dir else {
        return 0;
    };
    directory_size(native_dir)
}

fn directory_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            let path = entry.path();
            match entry.metadata() {
                Ok(metadata) if metadata.is_dir() => directory_size(&path),
                Ok(metadata) => metadata.len(),
                Err(_) => 0,
            }
        })
        .sum()
}

fn file_len(path: &Path) -> Option<u64> {
    fs::metadata(path).ok().map(|metadata| metadata.len())
}

fn system_time_to_unix_seconds(value: SystemTime) -> Option<u64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs())
}

fn unix_seconds_now() -> u64 {
    system_time_to_unix_seconds(SystemTime::now()).unwrap_or(0)
}

fn read_u8(reader: &mut impl Read) -> anyhow::Result<u8> {
    let mut bytes = [0_u8; 1];
    reader.read_exact(&mut bytes)?;
    Ok(bytes[0])
}

fn write_u8(writer: &mut impl Write, value: u8) -> anyhow::Result<()> {
    writer.write_all(&[value])?;
    Ok(())
}

fn read_u32(reader: &mut impl Read) -> anyhow::Result<u32> {
    let mut bytes = [0_u8; 4];
    reader.read_exact(&mut bytes)?;
    Ok(u32::from_le_bytes(bytes))
}

fn write_u32(writer: &mut impl Write, value: u32) -> anyhow::Result<()> {
    writer.write_all(&value.to_le_bytes())?;
    Ok(())
}

fn read_u64(reader: &mut impl Read) -> anyhow::Result<u64> {
    let mut bytes = [0_u8; 8];
    reader.read_exact(&mut bytes)?;
    Ok(u64::from_le_bytes(bytes))
}

fn write_u64(writer: &mut impl Write, value: u64) -> anyhow::Result<()> {
    writer.write_all(&value.to_le_bytes())?;
    Ok(())
}

fn read_optional_u64(reader: &mut impl Read) -> anyhow::Result<Option<u64>> {
    if read_u8(reader)? == 0 {
        Ok(None)
    } else {
        Ok(Some(read_u64(reader)?))
    }
}

fn write_optional_u64(writer: &mut impl Write, value: Option<u64>) -> anyhow::Result<()> {
    match value {
        Some(value) => {
            write_u8(writer, 1)?;
            write_u64(writer, value)?;
        }
        None => write_u8(writer, 0)?,
    }
    Ok(())
}

fn read_string(reader: &mut impl Read) -> anyhow::Result<String> {
    let len = read_u32(reader)? as usize;
    let mut bytes = vec![0_u8; len];
    reader.read_exact(&mut bytes)?;
    String::from_utf8(bytes).context("snapshot string is not utf-8")
}

fn write_string(writer: &mut impl Write, value: &str) -> anyhow::Result<()> {
    let bytes = value.as_bytes();
    let len = u32::try_from(bytes.len()).context("snapshot string too large")?;
    write_u32(writer, len)?;
    writer.write_all(bytes)?;
    Ok(())
}

fn read_optional_string(reader: &mut impl Read) -> anyhow::Result<Option<String>> {
    if read_u8(reader)? == 0 {
        Ok(None)
    } else {
        Ok(Some(read_string(reader)?))
    }
}

fn write_optional_string(writer: &mut impl Write, value: Option<&str>) -> anyhow::Result<()> {
    match value {
        Some(value) => {
            write_u8(writer, 1)?;
            write_string(writer, value)?;
        }
        None => write_u8(writer, 0)?,
    }
    Ok(())
}

#[allow(dead_code)]
fn nonzero(value: usize) -> NonZero<usize> {
    NonZero::new(value.max(1)).expect("value is forced non-zero")
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use pretty_assertions::assert_eq;
    use tempfile::tempdir;

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    fn index_options(root: &Path) -> LocalSearchIndexRootOptions {
        LocalSearchIndexRootOptions {
            root: root.to_path_buf(),
            include_hidden: false,
            include_vendor: false,
            respect_gitignore: true,
            content_mode: LocalSearchContentMode::Auto,
            max_file_size_bytes: DEFAULT_TEXT_LIMIT_BYTES,
        }
    }

    #[test]
    fn local_search_v3_indexes_path_and_content() {
        let dir = tempdir().expect("tempdir");
        write_file(
            &dir.path().join("src/main.rs"),
            "fn main() { println!(\"lyra\"); }\n",
        );
        write_file(&dir.path().join("README.md"), "Lyra native search\n");
        let engine = LocalSearchEngine::new();
        engine.index_root(index_options(dir.path()), None).unwrap();

        let by_name = engine
            .search(
                LocalSearchOptions {
                    query: "main".to_string(),
                    roots: vec![dir.path().to_path_buf()],
                    limit: 10,
                    ..Default::default()
                },
                None,
            )
            .unwrap();
        assert!(
            by_name
                .results
                .iter()
                .any(|result| result.display_path == "src/main.rs")
        );

        let by_content = engine
            .search(
                LocalSearchOptions {
                    query: "native search".to_string(),
                    roots: vec![dir.path().to_path_buf()],
                    limit: 10,
                    ..Default::default()
                },
                None,
            )
            .unwrap();
        assert_eq!(
            by_content.results[0].match_kind,
            LocalSearchMatchKind::Content
        );
        assert_eq!(by_content.results[0].line, Some(1));
    }

    #[test]
    fn local_search_v3_persists_snapshot_across_engine_instances() {
        let dir = tempdir().expect("tempdir");
        let storage = tempdir().expect("storage");
        write_file(&dir.path().join("Cargo.toml"), "[package]\nname='lyra'\n");

        let config = LocalSearchEngineConfig {
            storage_mode: LocalSearchStorageMode::Persistent {
                storage_root: storage.path().join("search-v3"),
            },
        };
        LocalSearchEngine::with_config(config.clone())
            .index_root(index_options(dir.path()), None)
            .unwrap();
        assert!(
            storage
                .path()
                .join("search-v3/native/snapshot.lyidx")
                .exists()
        );
        assert!(
            !storage
                .path()
                .join("search-v3/native/index.v1.sqlite")
                .exists()
        );

        let response = LocalSearchEngine::with_config(config)
            .search(
                LocalSearchOptions {
                    query: "cargo".to_string(),
                    roots: vec![dir.path().to_path_buf()],
                    limit: 10,
                    ..Default::default()
                },
                None,
            )
            .unwrap();
        assert_eq!(response.results.len(), 1);
    }

    #[test]
    fn local_search_v3_replays_delta_and_compacts() {
        let dir = tempdir().expect("tempdir");
        let storage = tempdir().expect("storage");
        let root = dir.path();
        write_file(&root.join("alpha.txt"), "alpha text\n");
        let config = LocalSearchEngineConfig {
            storage_mode: LocalSearchStorageMode::Persistent {
                storage_root: storage.path().join("search-v3"),
            },
        };
        let engine = LocalSearchEngine::with_config(config.clone());
        engine.index_root(index_options(root), None).unwrap();
        write_file(&root.join("beta.txt"), "beta text\n");
        engine
            .apply_changes(
                LocalSearchApplyChangesOptions {
                    root: root.to_path_buf(),
                    paths: vec![root.join("beta.txt")],
                    ..LocalSearchApplyChangesOptions::from(index_options(root))
                },
                None,
            )
            .unwrap();

        let delta_path = storage.path().join("search-v3/native/delta.lylog");
        assert!(delta_path.exists());
        let response = LocalSearchEngine::with_config(config)
            .search(
                LocalSearchOptions {
                    query: "beta".to_string(),
                    roots: vec![root.to_path_buf()],
                    limit: 10,
                    ..Default::default()
                },
                None,
            )
            .unwrap();
        assert_eq!(response.results.len(), 1);
    }

    #[test]
    fn local_search_v3_applies_delete_and_directory_subtree_delete() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path();
        write_file(&root.join("folder/a.txt"), "delete me\n");
        write_file(&root.join("folder/b.txt"), "delete me too\n");
        let engine = LocalSearchEngine::new();
        engine.index_root(index_options(root), None).unwrap();
        fs::remove_dir_all(root.join("folder")).unwrap();
        engine
            .apply_changes(
                LocalSearchApplyChangesOptions {
                    root: root.to_path_buf(),
                    paths: vec![root.join("folder")],
                    ..LocalSearchApplyChangesOptions::from(index_options(root))
                },
                None,
            )
            .unwrap();
        let response = engine
            .search(
                LocalSearchOptions {
                    query: "delete".to_string(),
                    roots: vec![root.to_path_buf()],
                    limit: 10,
                    ..Default::default()
                },
                None,
            )
            .unwrap();
        assert!(response.results.is_empty());
    }

    #[test]
    fn local_search_v3_skips_home_noise_and_large_binary_content() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path();
        write_file(&root.join("node_modules/pkg/index.js"), "needle\n");
        write_file(&root.join(".hidden.txt"), "needle\n");
        fs::write(
            root.join("large.txt"),
            vec![b'a'; (DEFAULT_TEXT_LIMIT_BYTES + 1) as usize],
        )
        .unwrap();
        write_file(&root.join("visible.txt"), "needle\n");
        let engine = LocalSearchEngine::new();
        let status = engine.index_root(index_options(root), None).unwrap();
        assert_eq!(status.indexed_content_file_count, 1);
        assert!(status.skipped.binary_or_too_large >= 1);
        let response = engine
            .search(
                LocalSearchOptions {
                    query: "needle".to_string(),
                    roots: vec![root.to_path_buf()],
                    limit: 20,
                    ..Default::default()
                },
                None,
            )
            .unwrap();
        assert_eq!(response.results.len(), 1);
        assert_eq!(response.results[0].display_path, "visible.txt");
    }

    #[test]
    fn local_search_v3_detects_corrupt_snapshot() {
        let storage = tempdir().expect("storage");
        let native_dir = storage.path().join("search-v3/native");
        fs::create_dir_all(&native_dir).unwrap();
        fs::write(native_dir.join("snapshot.lyidx"), b"not lyra").unwrap();
        let engine = LocalSearchEngine::with_config(LocalSearchEngineConfig {
            storage_mode: LocalSearchStorageMode::Persistent {
                storage_root: storage.path().join("search-v3"),
            },
        });
        let status = engine.status();
        assert_eq!(status.state, LocalSearchIndexState::Failed);
    }
}
