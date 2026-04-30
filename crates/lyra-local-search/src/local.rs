use crate::FileSearchOptions;
use crate::native;
use crate::run;
use ignore::WalkBuilder;
use rusqlite::Connection;
use rusqlite::params;
use serde::Serialize;
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::io::Seek;
use std::io::SeekFrom;
use std::num::NonZero;
use std::path::Component;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 500;
const DEFAULT_TEXT_LIMIT_BYTES: u64 = 1_000_000;
const READ_RESULT_MAX_BYTES: usize = 2_000_000;
const SNIPPET_MAX_CHARS: usize = 240;
const FTS_CONTENT_SCORE: u32 = 950_000;
const CONTENT_SCAN_SCORE: u32 = 900_000;
const EXTENSION_SCORE: u32 = 860_000;
const FILENAME_EXACT_SCORE: u32 = 1_200_000;
const FILENAME_PREFIX_SCORE: u32 = 1_080_000;
const FILENAME_SUBSTRING_SCORE: u32 = 1_000_000;
const PATH_SUBSTRING_SCORE: u32 = 760_000;
const FUZZY_SCORE_BASE: u32 = 420_000;
const VENDOR_PENALTY: u32 = 220_000;
const DIRECTORY_PENALTY: u32 = 40_000;

const VENDOR_DIRECTORY_NAMES: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    ".cache",
    ".turbo",
    "build",
    "coverage",
    "dist",
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LocalSearchKind {
    File,
    Directory,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LocalSearchSource {
    Index,
    Walker,
    Content,
    Symbol,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LocalSearchIndexState {
    Empty,
    Indexing,
    Ready,
    Partial,
    Failed,
    Walker,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LocalSearchContentMode {
    Disabled,
    #[default]
    Auto,
    Required,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSearchRootStatus {
    pub root: PathBuf,
    pub state: LocalSearchIndexState,
    pub indexed_file_count: u64,
    pub indexed_dir_count: u64,
    pub indexed_content_file_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_indexed_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSearchStatus {
    pub state: LocalSearchIndexState,
    pub roots: Vec<LocalSearchRootStatus>,
    pub indexed_file_count: u64,
    pub indexed_dir_count: u64,
    pub indexed_content_file_count: u64,
    pub sqlite_fts_available: bool,
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

struct LocalSearchState {
    entries: Vec<IndexedEntry>,
    roots: BTreeMap<PathBuf, LocalSearchRootStatus>,
    sqlite: Option<SqliteIndex>,
    state: LocalSearchIndexState,
}

impl Default for LocalSearchEngine {
    fn default() -> Self {
        Self::with_config(LocalSearchEngineConfig::default())
    }
}

struct SqliteIndex {
    conn: Connection,
    fts_available: bool,
    persistent: bool,
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
}

#[derive(Debug)]
struct CollectedRoot {
    root: PathBuf,
    entries: Vec<IndexedEntry>,
    file_count: u64,
    dir_count: u64,
    content_file_count: u64,
    truncated: bool,
}

#[derive(Debug, Clone)]
struct Candidate {
    result: LocalSearchResult,
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
            state.roots.insert(
                root.clone(),
                LocalSearchRootStatus {
                    root: root.clone(),
                    state: LocalSearchIndexState::Indexing,
                    indexed_file_count: 0,
                    indexed_dir_count: 0,
                    indexed_content_file_count: 0,
                    last_indexed_at: None,
                    error: None,
                },
            );
        }

        let collected = collect_root_entries(&root, &options, &cancel_flag)?;

        let mut state = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("local search state lock poisoned"))?;
        state.entries.retain(|entry| entry.root != collected.root);
        state.entries.extend(collected.entries.clone());
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
                last_indexed_at: Some(unix_seconds_now()),
                error: None,
            },
        );
        state.state = aggregate_root_state(state.roots.values());
        let entries = state.entries.clone();
        rebuild_sqlite(&mut state, &entries);
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
        let limit = clamp_limit(options.limit);
        options.limit = limit;
        let cancel_flag = cancel_flag.unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
        let roots = normalize_search_roots(&options.roots)?;

        let (entries, indexed_roots, index_state, content_hits, sqlite_fts_available) = {
            let state = self
                .state
                .lock()
                .map_err(|_| anyhow::anyhow!("local search state lock poisoned"))?;
            let indexed_roots = state.roots.keys().cloned().collect::<HashSet<_>>();
            let scoped_entries = scope_entries(&state.entries, &roots);
            let content_hits = if should_search_content(options.content_mode)
                && !options.query.trim().is_empty()
            {
                query_fts(&state, &options.query)?
            } else {
                Vec::new()
            };
            (
                scoped_entries,
                indexed_roots,
                state.state,
                content_hits,
                state
                    .sqlite
                    .as_ref()
                    .map(|sqlite| sqlite.fts_available)
                    .unwrap_or(false),
            )
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
            return fallback_search(options, roots, cancel_flag);
        }

        let mut candidates = HashMap::<PathBuf, Candidate>::new();
        let content_hit_set = content_hits.into_iter().collect::<HashSet<_>>();
        for entry in &entries {
            if cancel_flag.load(Ordering::Relaxed) {
                break;
            }
            if !entry_allowed(entry, &options) {
                continue;
            }
            if let Some((score, match_kind, source, snippet)) =
                score_indexed_entry(entry, &options, &content_hit_set, sqlite_fts_available)
            {
                merge_candidate(
                    &mut candidates,
                    entry,
                    score,
                    source,
                    match_kind,
                    snippet,
                    index_state,
                );
            }
        }

        if should_scan_content(options.content_mode, sqlite_fts_available)
            && !options.query.trim().is_empty()
        {
            scan_content_candidates(&entries, &options, &cancel_flag, &mut candidates);
        }

        let total_match_count = candidates.len();
        let mut results = candidates
            .into_values()
            .map(|candidate| candidate.result)
            .collect::<Vec<_>>();
        results.sort_by(result_rank_order);
        let truncated = results.len() > limit;
        results.truncate(limit);

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
        let sqlite = match open_sqlite_index(&config.storage_mode) {
            Ok(sqlite) => sqlite,
            Err(error) => {
                let message = format!("local search sqlite open failed: {error}");
                return Self {
                    entries: Vec::new(),
                    roots: BTreeMap::new(),
                    sqlite: None,
                    state: LocalSearchIndexState::Failed,
                }
                .with_error(message);
            }
        };
        let mut state = Self {
            entries: Vec::new(),
            roots: BTreeMap::new(),
            sqlite,
            state: LocalSearchIndexState::Empty,
        };
        load_sqlite_state(&mut state);
        state
    }

    fn with_error(mut self, message: String) -> Self {
        self.roots.insert(
            PathBuf::new(),
            LocalSearchRootStatus {
                root: PathBuf::new(),
                state: LocalSearchIndexState::Failed,
                indexed_file_count: 0,
                indexed_dir_count: 0,
                indexed_content_file_count: 0,
                last_indexed_at: None,
                error: Some(message),
            },
        );
        self
    }
}

fn open_sqlite_index(storage_mode: &LocalSearchStorageMode) -> anyhow::Result<Option<SqliteIndex>> {
    let (conn, persistent) = match storage_mode {
        LocalSearchStorageMode::Memory => (Connection::open_in_memory()?, false),
        LocalSearchStorageMode::Persistent { storage_root } => {
            let index_dir = storage_root.join("local-search");
            fs::create_dir_all(&index_dir)?;
            (Connection::open(index_dir.join("index.v1.sqlite"))?, true)
        }
    };
    if persistent {
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA temp_store=MEMORY;",
        )?;
    } else {
        conn.execute_batch("PRAGMA temp_store=MEMORY;")?;
    }
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS roots (
            root TEXT PRIMARY KEY,
            state TEXT NOT NULL,
            indexed_file_count INTEGER NOT NULL,
            indexed_dir_count INTEGER NOT NULL,
            indexed_content_file_count INTEGER NOT NULL,
            last_indexed_at INTEGER,
            error TEXT
        );
        CREATE TABLE IF NOT EXISTS files (
            full_path TEXT PRIMARY KEY,
            root TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            kind TEXT NOT NULL,
            extension TEXT,
            size_bytes INTEGER NOT NULL,
            modified_at INTEGER,
            created_at INTEGER,
            hidden INTEGER NOT NULL,
            vendor INTEGER NOT NULL DEFAULT 0,
            content_indexed INTEGER NOT NULL DEFAULT 0
        );",
    )?;
    let _ = conn.execute_batch("ALTER TABLE files ADD COLUMN vendor INTEGER NOT NULL DEFAULT 0;");
    let _ = conn
        .execute_batch("ALTER TABLE files ADD COLUMN content_indexed INTEGER NOT NULL DEFAULT 0;");
    let fts_available = conn
        .execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(full_path UNINDEXED, body);",
        )
        .is_ok();
    Ok(Some(SqliteIndex {
        conn,
        fts_available,
        persistent,
    }))
}

fn load_sqlite_state(state: &mut LocalSearchState) {
    let Some(sqlite) = state.sqlite.as_ref() else {
        return;
    };
    if !sqlite.persistent {
        return;
    }

    if let Ok(mut stmt) = sqlite.conn.prepare(
        "SELECT root, relative_path, full_path, kind, extension, size_bytes, modified_at,
                created_at, hidden, vendor, content_indexed
         FROM files",
    ) && let Ok(rows) = stmt.query_map([], |row| {
        let root = PathBuf::from(row.get::<_, String>(0)?);
        let relative_path = PathBuf::from(row.get::<_, String>(1)?);
        let full_path = PathBuf::from(row.get::<_, String>(2)?);
        let kind_value = row.get::<_, String>(3)?;
        let kind = if kind_value == "directory" {
            LocalSearchKind::Directory
        } else {
            LocalSearchKind::File
        };
        let extension = row.get::<_, Option<String>>(4)?;
        let size_bytes = i64_to_u64(row.get::<_, i64>(5)?);
        let modified_at = row.get::<_, Option<i64>>(6)?.map(i64_to_u64);
        let created_at = row.get::<_, Option<i64>>(7)?.map(i64_to_u64);
        let hidden = row.get::<_, i64>(8)? != 0;
        let vendor = row.get::<_, i64>(9)? != 0;
        let content_indexed = row.get::<_, i64>(10)? != 0;
        let display_path = normalize_path_for_display(&relative_path);
        Ok(IndexedEntry {
            root,
            relative_path,
            full_path,
            display_path: display_path.clone(),
            kind,
            extension,
            lower_file_name: display_path
                .rsplit('/')
                .next()
                .unwrap_or(display_path.as_str())
                .to_lowercase(),
            lower_path: display_path.to_lowercase(),
            size_bytes,
            modified_at,
            created_at,
            hidden,
            vendor,
            content_indexed,
        })
    }) {
        state.entries = rows.flatten().collect();
    }

    if let Ok(mut stmt) = sqlite.conn.prepare(
        "SELECT root, state, indexed_file_count, indexed_dir_count,
                indexed_content_file_count, last_indexed_at, error
         FROM roots",
    ) && let Ok(rows) = stmt.query_map([], |row| {
        let root = PathBuf::from(row.get::<_, String>(0)?);
        let state_value = row.get::<_, String>(1)?;
        Ok(LocalSearchRootStatus {
            root,
            state: index_state_from_storage(&state_value),
            indexed_file_count: i64_to_u64(row.get::<_, i64>(2)?),
            indexed_dir_count: i64_to_u64(row.get::<_, i64>(3)?),
            indexed_content_file_count: i64_to_u64(row.get::<_, i64>(4)?),
            last_indexed_at: row.get::<_, Option<i64>>(5)?.map(i64_to_u64),
            error: row.get::<_, Option<String>>(6)?,
        })
    }) {
        state.roots = rows
            .flatten()
            .map(|status| (status.root.clone(), status))
            .collect();
    }

    if state.roots.is_empty() && !state.entries.is_empty() {
        rebuild_root_statuses_from_entries(state);
    }
    state.state = aggregate_root_state(state.roots.values());
}

fn rebuild_root_statuses_from_entries(state: &mut LocalSearchState) {
    let mut counts = BTreeMap::<PathBuf, (u64, u64, u64)>::new();
    for entry in &state.entries {
        let root_counts = counts.entry(entry.root.clone()).or_default();
        match entry.kind {
            LocalSearchKind::File => root_counts.0 += 1,
            LocalSearchKind::Directory => root_counts.1 += 1,
        }
        if entry.content_indexed {
            root_counts.2 += 1;
        }
    }
    state.roots = counts
        .into_iter()
        .map(
            |(root, (indexed_file_count, indexed_dir_count, indexed_content_file_count))| {
                (
                    root.clone(),
                    LocalSearchRootStatus {
                        root,
                        state: LocalSearchIndexState::Ready,
                        indexed_file_count,
                        indexed_dir_count,
                        indexed_content_file_count,
                        last_indexed_at: None,
                        error: None,
                    },
                )
            },
        )
        .collect();
}

fn rebuild_sqlite(state: &mut LocalSearchState, entries: &[IndexedEntry]) {
    let root_statuses = state.roots.values().cloned().collect::<Vec<_>>();
    let Some(sqlite) = state.sqlite.as_mut() else {
        return;
    };
    let Ok(tx) = sqlite.conn.transaction() else {
        return;
    };
    let _ = tx.execute_batch("DELETE FROM files; DELETE FROM roots;");
    if sqlite.fts_available {
        let _ = tx.execute_batch("DELETE FROM content_fts;");
    }
    for root in root_statuses {
        let _ = tx.execute(
            "INSERT OR REPLACE INTO roots
             (root, state, indexed_file_count, indexed_dir_count, indexed_content_file_count,
              last_indexed_at, error)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                root.root.to_string_lossy(),
                index_state_to_storage(root.state),
                u64_to_i64_saturating(root.indexed_file_count),
                u64_to_i64_saturating(root.indexed_dir_count),
                u64_to_i64_saturating(root.indexed_content_file_count),
                root.last_indexed_at.and_then(u64_to_i64),
                root.error,
            ],
        );
    }
    for entry in entries {
        let kind = match entry.kind {
            LocalSearchKind::File => "file",
            LocalSearchKind::Directory => "directory",
        };
        let modified_at = entry.modified_at.and_then(u64_to_i64);
        let created_at = entry.created_at.and_then(u64_to_i64);
        let _ = tx.execute(
            "INSERT OR REPLACE INTO files
             (full_path, root, relative_path, kind, extension, size_bytes, modified_at,
              created_at, hidden, vendor, content_indexed)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                entry.full_path.to_string_lossy(),
                entry.root.to_string_lossy(),
                entry.relative_path.to_string_lossy(),
                kind,
                entry.extension,
                u64_to_i64_saturating(entry.size_bytes),
                modified_at,
                created_at,
                if entry.hidden { 1_i64 } else { 0_i64 },
                if entry.vendor { 1_i64 } else { 0_i64 },
                if entry.content_indexed { 1_i64 } else { 0_i64 },
            ],
        );
        if sqlite.fts_available
            && entry.content_indexed
            && let Ok(Some((text, _truncated))) =
                read_text_file_with_limit(&entry.full_path, DEFAULT_TEXT_LIMIT_BYTES)
        {
            let _ = tx.execute(
                "INSERT INTO content_fts (full_path, body) VALUES (?1, ?2)",
                params![entry.full_path.to_string_lossy(), text],
            );
        }
    }
    let _ = tx.commit();
}

fn query_fts(state: &LocalSearchState, query: &str) -> anyhow::Result<Vec<PathBuf>> {
    let Some(sqlite) = state.sqlite.as_ref() else {
        return Ok(Vec::new());
    };
    if !sqlite.fts_available {
        return Ok(Vec::new());
    }
    let Some(fts_query) = build_fts_query(query) else {
        return Ok(Vec::new());
    };
    let mut stmt = sqlite
        .conn
        .prepare("SELECT full_path FROM content_fts WHERE content_fts MATCH ?1 LIMIT 500")?;
    let rows = match stmt.query_map(params![fts_query], |row| row.get::<_, String>(0)) {
        Ok(rows) => rows,
        Err(_) => return Ok(Vec::new()),
    };
    let mut paths = Vec::new();
    for path in rows.flatten() {
        paths.push(PathBuf::from(path));
    }
    Ok(paths)
}

fn build_fts_query(query: &str) -> Option<String> {
    let tokens = native::query_token_spans(query, 8)
        .into_iter()
        .filter(|token| !token.is_empty())
        .map(|token| format!("{}*", token.to_lowercase()))
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" AND "))
    }
}

fn collect_root_entries(
    root: &Path,
    options: &LocalSearchIndexRootOptions,
    cancel_flag: &AtomicBool,
) -> anyhow::Result<CollectedRoot> {
    let mut file_count = 0_u64;
    let mut dir_count = 0_u64;
    let mut content_file_count = 0_u64;
    let mut entries = Vec::new();
    let root = root.to_path_buf();

    if root.is_file() {
        if let Some(entry) = indexed_entry_for_path(&root, &root, options)? {
            file_count += 1;
            content_file_count += u64::from(entry.content_indexed);
            entries.push(entry);
        }
        return Ok(CollectedRoot {
            root,
            entries,
            file_count,
            dir_count,
            content_file_count,
            truncated: false,
        });
    }

    let mut builder = WalkBuilder::new(&root);
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
    if !options.include_vendor {
        builder.filter_entry(|entry| {
            entry
                .file_name()
                .to_str()
                .map(|name| !is_vendor_directory_name(name))
                .unwrap_or(true)
        });
    }

    for entry in builder.build() {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();
        if path == root {
            continue;
        }
        let file_type = match entry.file_type() {
            Some(file_type) => file_type,
            None => continue,
        };
        if file_type.is_dir() {
            dir_count += 1;
        } else if file_type.is_file() {
            file_count += 1;
        } else {
            continue;
        }
        if let Some(indexed) = indexed_entry_for_path(path, &root, options)? {
            content_file_count += u64::from(indexed.content_indexed);
            entries.push(indexed);
        }
    }

    Ok(CollectedRoot {
        root,
        entries,
        file_count,
        dir_count,
        content_file_count,
        truncated: false,
    })
}

fn indexed_entry_for_path(
    path: &Path,
    root: &Path,
    options: &LocalSearchIndexRootOptions,
) -> anyhow::Result<Option<IndexedEntry>> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => return Ok(None),
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
    let extension = normalized_extension(path);
    let hidden = path_has_hidden_component(&relative_path);
    if hidden && !options.include_hidden {
        return Ok(None);
    }
    let vendor = path_has_vendor_component(&relative_path);
    if vendor && !options.include_vendor {
        return Ok(None);
    }
    let content_indexed = should_extract_entry_text(
        kind,
        extension.as_deref(),
        metadata.len(),
        options.content_mode,
        options.max_file_size_bytes,
    );
    let full_path = path.to_path_buf();
    let lower_path = display_path.to_lowercase();
    let lower_file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| display_path.to_lowercase());
    Ok(Some(IndexedEntry {
        root: root.to_path_buf(),
        relative_path,
        full_path,
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
    }))
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

fn score_indexed_entry(
    entry: &IndexedEntry,
    options: &LocalSearchOptions,
    content_hit_set: &HashSet<PathBuf>,
    sqlite_fts_available: bool,
) -> Option<(u32, LocalSearchMatchKind, LocalSearchSource, Option<String>)> {
    let query = options.query.trim().to_lowercase();
    if query.is_empty() {
        return initial_entry_score(entry).map(|score| {
            (
                apply_entry_penalties(score, entry),
                LocalSearchMatchKind::Initial,
                LocalSearchSource::Index,
                None,
            )
        });
    }
    if should_search_content(options.content_mode)
        && sqlite_fts_available
        && content_hit_set.contains(&entry.full_path)
    {
        return Some((
            apply_entry_penalties(FTS_CONTENT_SCORE, entry),
            LocalSearchMatchKind::Content,
            LocalSearchSource::Content,
            snippet_for_file(&entry.full_path, &query, options.max_file_size_bytes),
        ));
    }
    if options.enable_extension_match
        && let Some(extension_query) = extension_query(&query, &options.extensions)
        && entry
            .extension
            .as_deref()
            .map(|extension| extension == extension_query)
            .unwrap_or(false)
    {
        return Some((
            apply_entry_penalties(EXTENSION_SCORE, entry),
            LocalSearchMatchKind::Extension,
            LocalSearchSource::Index,
            None,
        ));
    }
    if entry.lower_file_name == query {
        return Some((
            apply_entry_penalties(FILENAME_EXACT_SCORE, entry),
            LocalSearchMatchKind::FileName,
            LocalSearchSource::Index,
            None,
        ));
    }
    if entry.lower_file_name.starts_with(&query) {
        return Some((
            apply_entry_penalties(FILENAME_PREFIX_SCORE, entry),
            LocalSearchMatchKind::FileName,
            LocalSearchSource::Index,
            None,
        ));
    }
    if entry.lower_file_name.contains(&query) {
        return Some((
            apply_entry_penalties(FILENAME_SUBSTRING_SCORE, entry),
            LocalSearchMatchKind::FileName,
            LocalSearchSource::Index,
            None,
        ));
    }
    if entry.lower_path.contains(&query) {
        return Some((
            apply_entry_penalties(PATH_SUBSTRING_SCORE, entry),
            LocalSearchMatchKind::Path,
            LocalSearchSource::Index,
            None,
        ));
    }
    if options.enable_fuzzy {
        let basename_fuzzy = native::subsequence_score(&entry.lower_file_name, &query);
        let path_fuzzy = native::subsequence_score(&entry.lower_path, &query);
        let fuzzy = basename_fuzzy.max(path_fuzzy / 2);
        if fuzzy > 900 {
            return Some((
                apply_entry_penalties(FUZZY_SCORE_BASE.saturating_add(fuzzy), entry),
                LocalSearchMatchKind::Fuzzy,
                LocalSearchSource::Index,
                None,
            ));
        }
    }
    None
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

fn scan_content_candidates(
    entries: &[IndexedEntry],
    options: &LocalSearchOptions,
    cancel_flag: &AtomicBool,
    candidates: &mut HashMap<PathBuf, Candidate>,
) {
    let query = options.query.trim().to_lowercase();
    for entry in entries {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }
        if !entry_allowed(entry, options) || entry.kind != LocalSearchKind::File {
            continue;
        }
        if let Some(snippet) =
            snippet_for_file(&entry.full_path, &query, options.max_file_size_bytes)
        {
            merge_candidate(
                candidates,
                entry,
                apply_entry_penalties(CONTENT_SCAN_SCORE, entry),
                LocalSearchSource::Content,
                LocalSearchMatchKind::Content,
                Some(snippet),
                LocalSearchIndexState::Ready,
            );
        }
    }
}

fn fallback_search(
    options: LocalSearchOptions,
    roots: Vec<PathBuf>,
    cancel_flag: Arc<AtomicBool>,
) -> anyhow::Result<LocalSearchResponse> {
    let search_roots = if roots.is_empty() {
        match std::env::current_dir() {
            Ok(current_dir) => vec![current_dir],
            Err(_) => Vec::new(),
        }
    } else {
        roots
    };
    if search_roots.is_empty() {
        return Ok(LocalSearchResponse {
            query: options.query,
            roots: Vec::new(),
            results: Vec::new(),
            total_match_count: 0,
            truncated: false,
            index_state: LocalSearchIndexState::Empty,
        });
    }

    let limit = clamp_limit(options.limit);
    let search_limit =
        NonZero::new(limit).ok_or_else(|| anyhow::anyhow!("limit must be non-zero"))?;
    let threads = std::thread::available_parallelism()
        .map(NonZero::get)
        .unwrap_or(1)
        .max(1);
    let threads =
        NonZero::new(threads).ok_or_else(|| anyhow::anyhow!("threads must be non-zero"))?;
    let mut candidates = HashMap::<PathBuf, Candidate>::new();
    if options.content_mode != LocalSearchContentMode::Required {
        let result = run(
            &options.query,
            search_roots.clone(),
            FileSearchOptions {
                limit: search_limit,
                threads,
                compute_indices: false,
                respect_gitignore: options.respect_gitignore,
                ..Default::default()
            },
            Some(cancel_flag.clone()),
        )?;
        for file_match in result.matches {
            let full_path = file_match.root.join(&file_match.path);
            if let Some(entry) = fallback_entry_from_path(&full_path, &file_match.root, &options) {
                let score = apply_entry_penalties(file_match.score, &entry);
                merge_candidate(
                    &mut candidates,
                    &entry,
                    score,
                    LocalSearchSource::Walker,
                    LocalSearchMatchKind::Path,
                    None,
                    LocalSearchIndexState::Walker,
                );
            }
        }
    }

    if options.enable_extension_match
        && extension_query(&options.query.trim().to_lowercase(), &options.extensions).is_some()
    {
        let extension_entries =
            collect_fallback_content_entries(&search_roots, &options, cancel_flag.as_ref())?;
        let empty_content_hits = HashSet::new();
        for entry in &extension_entries {
            if cancel_flag.load(Ordering::Relaxed) {
                break;
            }
            if !entry_allowed(entry, &options) {
                continue;
            }
            if let Some((score, match_kind, source, snippet)) =
                score_indexed_entry(entry, &options, &empty_content_hits, false)
            {
                merge_candidate(
                    &mut candidates,
                    entry,
                    score,
                    source,
                    match_kind,
                    snippet,
                    LocalSearchIndexState::Walker,
                );
            }
        }
    }

    if should_search_content(options.content_mode) && !options.query.trim().is_empty() {
        let content_entries =
            collect_fallback_content_entries(&search_roots, &options, cancel_flag.as_ref())?;
        scan_content_candidates(
            &content_entries,
            &options,
            cancel_flag.as_ref(),
            &mut candidates,
        );
    }

    let total_match_count = candidates.len();
    let mut results = candidates
        .into_values()
        .map(|candidate| candidate.result)
        .collect::<Vec<_>>();
    results.sort_by(result_rank_order);
    let truncated = results.len() > limit;
    results.truncate(limit);
    Ok(LocalSearchResponse {
        query: options.query,
        roots: search_roots,
        results,
        total_match_count,
        truncated,
        index_state: LocalSearchIndexState::Walker,
    })
}

fn collect_fallback_content_entries(
    roots: &[PathBuf],
    options: &LocalSearchOptions,
    cancel_flag: &AtomicBool,
) -> anyhow::Result<Vec<IndexedEntry>> {
    let mut entries = Vec::new();
    for root in roots {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }
        let mut root_options = LocalSearchIndexRootOptions {
            root: root.clone(),
            include_hidden: options.include_hidden,
            include_vendor: options.include_vendor,
            respect_gitignore: options.respect_gitignore,
            content_mode: options.content_mode,
            max_file_size_bytes: options.max_file_size_bytes,
        };
        root_options.root = root.clone();
        let collected = collect_root_entries(root, &root_options, cancel_flag)?;
        entries.extend(collected.entries);
        if entries.len() >= MAX_LIMIT {
            break;
        }
    }
    Ok(entries)
}

fn fallback_entry_from_path(
    full_path: &Path,
    root: &Path,
    options: &LocalSearchOptions,
) -> Option<IndexedEntry> {
    let root_options = LocalSearchIndexRootOptions {
        root: root.to_path_buf(),
        include_hidden: options.include_hidden,
        include_vendor: options.include_vendor,
        respect_gitignore: options.respect_gitignore,
        content_mode: options.content_mode,
        max_file_size_bytes: options.max_file_size_bytes,
    };
    indexed_entry_for_path(full_path, root, &root_options)
        .ok()
        .flatten()
}

fn merge_candidate(
    candidates: &mut HashMap<PathBuf, Candidate>,
    entry: &IndexedEntry,
    score: u32,
    source: LocalSearchSource,
    match_kind: LocalSearchMatchKind,
    snippet: Option<String>,
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

fn apply_entry_penalties(score: u32, entry: &IndexedEntry) -> u32 {
    let vendor_adjusted = if entry.vendor {
        score.saturating_sub(VENDOR_PENALTY)
    } else {
        score
    };
    if entry.kind == LocalSearchKind::Directory {
        vendor_adjusted.saturating_sub(DIRECTORY_PENALTY)
    } else {
        vendor_adjusted
    }
}

fn should_search_content(mode: LocalSearchContentMode) -> bool {
    mode != LocalSearchContentMode::Disabled
}

fn should_scan_content(mode: LocalSearchContentMode, sqlite_fts_available: bool) -> bool {
    mode == LocalSearchContentMode::Required
        || (mode == LocalSearchContentMode::Auto && !sqlite_fts_available)
}

fn should_extract_entry_text(
    kind: LocalSearchKind,
    extension: Option<&str>,
    size_bytes: u64,
    mode: LocalSearchContentMode,
    max_file_size_bytes: u64,
) -> bool {
    if kind != LocalSearchKind::File || mode == LocalSearchContentMode::Disabled {
        return false;
    }
    if size_bytes > max_file_size_bytes {
        return false;
    }
    extension
        .map(|extension| {
            TEXT_EXTENSIONS
                .iter()
                .any(|candidate| extension.eq_ignore_ascii_case(candidate))
        })
        .unwrap_or(false)
}

fn snippet_for_file(path: &Path, query_lower: &str, max_bytes: u64) -> Option<String> {
    let (text, _truncated) = read_text_file_with_limit(path, max_bytes).ok()??;
    snippet_for_text(&text, query_lower)
}

fn snippet_for_text(text: &str, query_lower: &str) -> Option<String> {
    for line in text.lines() {
        if line.to_lowercase().contains(query_lower) {
            return Some(clip_snippet(line, SNIPPET_MAX_CHARS));
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

fn read_text_at_offset(
    path: &Path,
    offset: u64,
    max_bytes: usize,
) -> anyhow::Result<(String, bool, usize)> {
    let mut file = fs::File::open(path)?;
    let metadata = file.metadata()?;
    file.seek(SeekFrom::Start(offset))?;
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
    let file = fs::File::open(path)?;
    let mut bytes = Vec::new();
    file.take(limit.saturating_add(1)).read_to_end(&mut bytes)?;
    if bytes.contains(&0) {
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

fn extension_query<'a>(query_lower: &'a str, extensions: &'a [String]) -> Option<&'a str> {
    if !extensions.is_empty() {
        return None;
    }
    if let Some(value) = query_lower.strip_prefix("ext:") {
        let normalized = value.trim().trim_start_matches('.');
        if !normalized.is_empty() {
            return Some(normalized);
        }
    }
    if query_lower.starts_with('.') && !query_lower.contains(char::is_whitespace) {
        let normalized = query_lower.trim_start_matches('.');
        if !normalized.is_empty() {
            return Some(normalized);
        }
    }
    None
}

fn path_has_hidden_component(path: &Path) -> bool {
    path.components().any(|component| match component {
        Component::Normal(value) => value.to_str().is_some_and(|value| value.starts_with('.')),
        _ => false,
    })
}

fn path_has_vendor_component(path: &Path) -> bool {
    path.components().any(|component| match component {
        Component::Normal(value) => value.to_str().is_some_and(is_vendor_directory_name),
        _ => false,
    })
}

fn is_vendor_directory_name(name: &str) -> bool {
    VENDOR_DIRECTORY_NAMES
        .iter()
        .any(|candidate| name.eq_ignore_ascii_case(candidate))
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

fn u64_to_i64(value: u64) -> Option<i64> {
    i64::try_from(value).ok()
}

fn u64_to_i64_saturating(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn i64_to_u64(value: i64) -> u64 {
    u64::try_from(value).unwrap_or(0)
}

fn index_state_to_storage(state: LocalSearchIndexState) -> &'static str {
    match state {
        LocalSearchIndexState::Empty => "empty",
        LocalSearchIndexState::Indexing => "indexing",
        LocalSearchIndexState::Ready => "ready",
        LocalSearchIndexState::Partial => "partial",
        LocalSearchIndexState::Failed => "failed",
        LocalSearchIndexState::Walker => "walker",
    }
}

fn index_state_from_storage(value: &str) -> LocalSearchIndexState {
    match value {
        "indexing" => LocalSearchIndexState::Indexing,
        "ready" => LocalSearchIndexState::Ready,
        "partial" => LocalSearchIndexState::Partial,
        "failed" => LocalSearchIndexState::Failed,
        "walker" => LocalSearchIndexState::Walker,
        _ => LocalSearchIndexState::Empty,
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
    let roots = state.roots.values().cloned().collect::<Vec<_>>();
    let indexed_file_count = roots
        .iter()
        .map(|root| root.indexed_file_count)
        .sum::<u64>();
    let indexed_dir_count = roots.iter().map(|root| root.indexed_dir_count).sum::<u64>();
    let indexed_content_file_count = roots
        .iter()
        .map(|root| root.indexed_content_file_count)
        .sum::<u64>();
    LocalSearchStatus {
        state: state.state,
        roots,
        indexed_file_count,
        indexed_dir_count,
        indexed_content_file_count,
        sqlite_fts_available: state
            .sqlite
            .as_ref()
            .map(|sqlite| sqlite.fts_available)
            .unwrap_or(false),
    }
}

fn failed_status(message: &str) -> LocalSearchStatus {
    LocalSearchStatus {
        state: LocalSearchIndexState::Failed,
        roots: vec![LocalSearchRootStatus {
            root: PathBuf::new(),
            state: LocalSearchIndexState::Failed,
            indexed_file_count: 0,
            indexed_dir_count: 0,
            indexed_content_file_count: 0,
            last_indexed_at: None,
            error: Some(message.to_string()),
        }],
        indexed_file_count: 0,
        indexed_dir_count: 0,
        indexed_content_file_count: 0,
        sqlite_fts_available: false,
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

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use pretty_assertions::assert_eq;
    use tempfile::tempdir;

    #[test]
    fn local_search_indexes_path_and_content() {
        let dir = tempdir().expect("tempdir");
        fs::create_dir_all(dir.path().join("src")).expect("src");
        fs::write(dir.path().join("README.md"), "hello lyra search").expect("readme");
        fs::write(dir.path().join("src/main.rs"), "fn main() {}").expect("main");

        let engine = LocalSearchEngine::new();
        let status = engine
            .index_root(
                LocalSearchIndexRootOptions {
                    root: dir.path().to_path_buf(),
                    include_hidden: true,
                    include_vendor: true,
                    ..Default::default()
                },
                None,
            )
            .expect("index");

        assert_eq!(status.state, LocalSearchIndexState::Ready);
        assert!(status.indexed_file_count >= 2);

        let path_results = engine
            .search(
                LocalSearchOptions {
                    query: "main".to_string(),
                    roots: vec![dir.path().to_path_buf()],
                    ..Default::default()
                },
                None,
            )
            .expect("search");
        assert!(
            path_results
                .results
                .iter()
                .any(|result| result.display_path == "src/main.rs")
        );

        let content_results = engine
            .search(
                LocalSearchOptions {
                    query: "lyra search".to_string(),
                    roots: vec![dir.path().to_path_buf()],
                    content_mode: LocalSearchContentMode::Required,
                    ..Default::default()
                },
                None,
            )
            .expect("content search");
        assert!(
            content_results
                .results
                .iter()
                .any(|result| result.display_path == "README.md"
                    && result.match_kind == LocalSearchMatchKind::Content)
        );
    }

    #[test]
    fn local_search_falls_back_to_walker_without_index() {
        let dir = tempdir().expect("tempdir");
        fs::write(dir.path().join("package.json"), "{}").expect("package");

        let engine = LocalSearchEngine::new();
        let results = engine
            .search(
                LocalSearchOptions {
                    query: "package".to_string(),
                    roots: vec![dir.path().to_path_buf()],
                    ..Default::default()
                },
                None,
            )
            .expect("search");

        assert_eq!(results.index_state, LocalSearchIndexState::Walker);
        assert!(
            results
                .results
                .iter()
                .any(|result| result.display_path == "package.json")
        );
    }

    #[test]
    fn local_search_fallback_matches_extension_query_without_index() {
        let dir = tempdir().expect("tempdir");
        fs::create_dir_all(dir.path().join("src")).expect("src");
        fs::write(dir.path().join("src/app.ts"), "export {};").expect("app");

        let engine = LocalSearchEngine::new();
        let results = engine
            .search(
                LocalSearchOptions {
                    query: "ext:ts".to_string(),
                    roots: vec![dir.path().to_path_buf()],
                    content_mode: LocalSearchContentMode::Disabled,
                    ..Default::default()
                },
                None,
            )
            .expect("search");

        assert_eq!(results.index_state, LocalSearchIndexState::Walker);
        assert!(results.results.iter().any(|result| {
            result.display_path == "src/app.ts"
                && result.match_kind == LocalSearchMatchKind::Extension
        }));
    }

    #[test]
    fn read_result_rejects_path_outside_root() {
        let dir = tempdir().expect("tempdir");
        let outside = tempdir().expect("outside");
        fs::write(outside.path().join("secret.txt"), "secret").expect("secret");
        let engine = LocalSearchEngine::new();

        let result = engine.read_result(LocalSearchReadOptions {
            root: Some(dir.path().to_path_buf()),
            path: outside.path().join("secret.txt"),
            offset: 0,
            max_bytes: 100,
        });

        assert!(result.is_err());
    }

    #[test]
    fn read_result_reads_from_offset_and_reports_truncation() {
        let dir = tempdir().expect("tempdir");
        fs::write(dir.path().join("sample.txt"), "0123456789").expect("sample");
        let engine = LocalSearchEngine::new();

        let result = engine
            .read_result(LocalSearchReadOptions {
                root: Some(dir.path().to_path_buf()),
                path: PathBuf::from("sample.txt"),
                offset: 2,
                max_bytes: 3,
            })
            .expect("read");

        assert_eq!(result.contents, "234");
        assert_eq!(result.bytes_read, 3);
        assert!(result.truncated);
    }

    #[test]
    fn persistent_storage_reuses_index_across_engine_instances() {
        let dir = tempdir().expect("tempdir");
        let storage = tempdir().expect("storage");
        fs::write(dir.path().join("persisted.txt"), "needle contents").expect("sample");

        let config = LocalSearchEngineConfig {
            storage_mode: LocalSearchStorageMode::Persistent {
                storage_root: storage.path().to_path_buf(),
            },
        };
        let first_engine = LocalSearchEngine::with_config(config.clone());
        first_engine
            .index_root(
                LocalSearchIndexRootOptions {
                    root: dir.path().to_path_buf(),
                    include_hidden: true,
                    include_vendor: true,
                    content_mode: LocalSearchContentMode::Auto,
                    ..Default::default()
                },
                None,
            )
            .expect("index");

        let second_engine = LocalSearchEngine::with_config(config);
        let status = second_engine.status();
        assert_eq!(status.state, LocalSearchIndexState::Ready);
        assert!(storage.path().join("local-search/index.v1.sqlite").exists());

        let results = second_engine
            .search(
                LocalSearchOptions {
                    query: "persisted".to_string(),
                    roots: vec![dir.path().to_path_buf()],
                    content_mode: LocalSearchContentMode::Disabled,
                    ..Default::default()
                },
                None,
            )
            .expect("search");
        assert_eq!(results.index_state, LocalSearchIndexState::Ready);
        assert!(
            results
                .results
                .iter()
                .any(|result| result.display_path == "persisted.txt")
        );
    }
}
