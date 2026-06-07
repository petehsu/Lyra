use lyra_local_search::{
    LocalSearchContentMode, LocalSearchEngine, LocalSearchEngineConfig,
    LocalSearchIndexRootOptions, LocalSearchIndexState, LocalSearchKind, LocalSearchMatchKind,
    LocalSearchOptions, LocalSearchResult, LocalSearchSource, LocalSearchStatus,
    LocalSearchStorageMode,
};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, OnceLock, RwLock};
use std::thread;
use std::time::{Duration, Instant};
use uuid::Uuid;

const DEFAULT_RESULT_LIMIT: usize = 48;
const MAX_RESULT_LIMIT: usize = 300;
const STREAM_RESULT_LIMIT_DEFAULT: usize = 120;
const STREAM_MAX_ACTIVE: usize = 64;
const BACKGROUND_TEXT_SCAN_BYTES: u64 = 1_000_000;
const SYSTEM_PROVIDER_TIMEOUT: Duration = Duration::from_millis(700);
const CONTENT_PROVIDER_TIMEOUT: Duration = Duration::from_millis(2_400);
const PROVIDER_JOIN_TIMEOUT: Duration = Duration::from_millis(2_750);
const WATCHER_REINDEX_DEBOUNCE: Duration = Duration::from_secs(8);
const SEARCH_V2_STORAGE_DIR: &str = "search-v2";
const CONTENT_PROVIDER_MAX_LINES: usize = 240;
const CONTENT_PROVIDER_MAX_MATCHES_PER_FILE: usize = 4;

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
    pub include_hidden: Option<bool>,
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
    pub indexed_files: u64,
    pub indexed_dirs: u64,
    pub last_built_at: Option<String>,
    pub progress: Option<f64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRebuildIndexResponse {
    pub status: SearchIndexStatusResponse,
    pub scope_preset: SearchLocalScopePreset,
    pub roots: Vec<String>,
}

#[derive(Debug)]
struct SearchStreamState {
    snapshot: SearchLocalStreamReadResponse,
    cancel_flag: Arc<AtomicBool>,
}

struct SearchProviderOutput {
    results: Vec<SearchLocalResultItem>,
    stats: SearchLocalStats,
    elapsed_ms: u64,
}

struct SearchCoreService {
    engine: Arc<LocalSearchEngine>,
    home_root: PathBuf,
    engine_storage_root: PathBuf,
    background_started: AtomicBool,
    index_running: AtomicBool,
    watcher_started: AtomicBool,
}

static SEARCH_SERVICES: OnceLock<RwLock<HashMap<String, Arc<SearchCoreService>>>> = OnceLock::new();
static SEARCH_STREAMS: OnceLock<RwLock<HashMap<String, Arc<RwLock<SearchStreamState>>>>> =
    OnceLock::new();

fn service_store() -> &'static RwLock<HashMap<String, Arc<SearchCoreService>>> {
    SEARCH_SERVICES.get_or_init(|| RwLock::new(HashMap::new()))
}

fn stream_store() -> &'static RwLock<HashMap<String, Arc<RwLock<SearchStreamState>>>> {
    SEARCH_STREAMS.get_or_init(|| RwLock::new(HashMap::new()))
}

fn clamp_limit(value: Option<usize>) -> usize {
    value
        .unwrap_or(DEFAULT_RESULT_LIMIT)
        .max(1)
        .min(MAX_RESULT_LIMIT)
}

fn home_directory() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .or_else(|| {
                let drive = std::env::var_os("HOMEDRIVE")?;
                let path = std::env::var_os("HOMEPATH")?;
                let mut joined = PathBuf::from(drive);
                joined.push(path);
                Some(joined)
            })
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

fn normalize_storage_root(raw: Option<&str>) -> Option<PathBuf> {
    let raw = raw?.trim();
    if raw.is_empty() {
        return None;
    }
    let path = PathBuf::from(raw);
    let resolved = if path.is_absolute() {
        path
    } else {
        std::env::current_dir().ok()?.join(path)
    };
    Some(resolved.canonicalize().unwrap_or(resolved))
}

fn default_storage_root() -> PathBuf {
    home_directory()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join(".lyra")
}

fn normalize_path_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn normalize_path_key(path: &Path) -> String {
    #[cfg(target_os = "windows")]
    {
        normalize_path_string(path).to_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        normalize_path_string(path)
    }
}

fn service_for_request(storage_root: Option<&str>) -> Result<Arc<SearchCoreService>, String> {
    let home_root = home_directory().ok_or_else(|| "home directory is unavailable".to_string())?;
    let base_storage_root =
        normalize_storage_root(storage_root).unwrap_or_else(default_storage_root);
    let engine_storage_root = base_storage_root.join(SEARCH_V2_STORAGE_DIR);
    let key = normalize_path_string(&engine_storage_root);
    if let Ok(guard) = service_store().read() {
        if let Some(service) = guard.get(&key) {
            service.ensure_background_started();
            return Ok(service.clone());
        }
    }

    let engine = Arc::new(LocalSearchEngine::with_config(LocalSearchEngineConfig {
        storage_mode: LocalSearchStorageMode::Persistent {
            storage_root: engine_storage_root.clone(),
        },
    }));
    let service = Arc::new(SearchCoreService {
        engine,
        home_root,
        engine_storage_root,
        background_started: AtomicBool::new(false),
        index_running: AtomicBool::new(false),
        watcher_started: AtomicBool::new(false),
    });
    service.ensure_background_started();

    let mut guard = service_store()
        .write()
        .map_err(|_| "search service state lock poisoned".to_string())?;
    Ok(guard.entry(key).or_insert_with(|| service).clone())
}

impl SearchCoreService {
    fn ensure_background_started(self: &Arc<Self>) {
        if self
            .background_started
            .compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed)
            .is_err()
        {
            return;
        }

        if !self.root_is_ready() {
            self.spawn_index_job();
        }
        self.spawn_watcher();
    }

    fn root_is_ready(&self) -> bool {
        let root_key = normalize_path_key(&self.home_root);
        self.engine.status().roots.iter().any(|root| {
            normalize_path_key(&root.root) == root_key
                && matches!(
                    root.state,
                    LocalSearchIndexState::Ready | LocalSearchIndexState::Partial
                )
        })
    }

    fn spawn_index_job(self: &Arc<Self>) {
        if self
            .index_running
            .compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed)
            .is_err()
        {
            return;
        }
        let service = self.clone();
        thread::spawn(move || {
            let _ = fs::create_dir_all(&service.engine_storage_root);
            let _ = service.engine.index_root(
                LocalSearchIndexRootOptions {
                    root: service.home_root.clone(),
                    include_hidden: false,
                    include_vendor: false,
                    respect_gitignore: true,
                    content_mode: LocalSearchContentMode::Auto,
                    max_file_size_bytes: BACKGROUND_TEXT_SCAN_BYTES,
                },
                None,
            );
            service.index_running.store(false, Ordering::Relaxed);
        });
    }

    fn spawn_watcher(self: &Arc<Self>) {
        if self
            .watcher_started
            .compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed)
            .is_err()
        {
            return;
        }
        let service = self.clone();
        thread::spawn(move || {
            let (tx, rx) = std::sync::mpsc::channel();
            let mut watcher: RecommendedWatcher = match notify::recommended_watcher(move |event| {
                let _ = tx.send(event);
            }) {
                Ok(watcher) => watcher,
                Err(_) => return,
            };
            if watcher
                .watch(&service.home_root, RecursiveMode::Recursive)
                .is_err()
            {
                return;
            }

            while rx.recv().is_ok() {
                thread::sleep(WATCHER_REINDEX_DEBOUNCE);
                while rx.try_recv().is_ok() {}
                service.spawn_index_job();
            }
        });
    }

    fn search(&self, request: &SearchLocalRequest, limit: usize) -> SearchLocalResponse {
        self.search_with_updates(request, limit, |_| {})
    }

    fn search_with_updates(
        &self,
        request: &SearchLocalRequest,
        limit: usize,
        mut on_update: impl FnMut(SearchLocalResponse),
    ) -> SearchLocalResponse {
        let started_at = Instant::now();
        let query = request.query.trim().to_string();
        let scope_preset = request.scope_preset;
        let roots = vec![normalize_path_string(&self.home_root)];
        let mut all_results = Vec::<SearchLocalResultItem>::new();
        let mut merged_stats = empty_stats();
        let (tx, rx) = mpsc::channel::<SearchProviderOutput>();

        let immediate = SearchProviderOutput {
            results: search_lyra_objects(request, &query),
            stats: empty_stats(),
            elapsed_ms: 0,
        };
        let immediate_sent = !immediate.results.is_empty();
        let _ = tx.send(immediate);

        {
            let provider_tx = tx.clone();
            let home_root = self.home_root.clone();
            let query = query.clone();
            thread::spawn(move || {
                let provider_started = Instant::now();
                let results = search_system_files(&query, &home_root, limit);
                let mut stats = empty_stats();
                stats.matched_files = results.len() as u64;
                let _ = provider_tx.send(SearchProviderOutput {
                    results,
                    stats,
                    elapsed_ms: provider_started.elapsed().as_millis() as u64,
                });
            });
        }

        if self.root_is_ready() {
            let provider_tx = tx.clone();
            let engine = self.engine.clone();
            let home_root = self.home_root.clone();
            let query = query.clone();
            thread::spawn(move || {
                let provider_started = Instant::now();
                let output = search_home_index(engine, home_root, query, limit);
                let mut output = output;
                output.elapsed_ms = provider_started.elapsed().as_millis() as u64;
                let _ = provider_tx.send(output);
            });
        }

        {
            let provider_tx = tx.clone();
            let home_root = self.home_root.clone();
            let query = query.clone();
            thread::spawn(move || {
                let provider_started = Instant::now();
                let results = search_home_content(&query, &home_root, limit);
                let mut stats = empty_stats();
                stats.content_scanned_files = results.len() as u64;
                stats.matched_files = results.len() as u64;
                let _ = provider_tx.send(SearchProviderOutput {
                    results,
                    stats,
                    elapsed_ms: provider_started.elapsed().as_millis() as u64,
                });
            });
        }
        drop(tx);

        let deadline = started_at + PROVIDER_JOIN_TIMEOUT;
        let mut received_any = false;
        loop {
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            let wait = deadline.saturating_duration_since(now);
            match rx.recv_timeout(wait.min(Duration::from_millis(80))) {
                Ok(output) => {
                    received_any = true;
                    all_results.extend(output.results);
                    merge_stats(&mut merged_stats, output.stats);
                    let snapshot = build_search_response(
                        &query,
                        scope_preset,
                        &roots,
                        all_results.clone(),
                        merged_stats.clone(),
                        started_at.elapsed().as_millis() as u64,
                        limit,
                        false,
                    );
                    on_update(snapshot);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if received_any || immediate_sent {
                        continue;
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        build_search_response(
            &query,
            scope_preset,
            &roots,
            all_results,
            merged_stats,
            started_at.elapsed().as_millis() as u64,
            limit,
            true,
        )
    }

    fn index_status(&self) -> SearchIndexStatusResponse {
        to_index_status(
            self.engine.status(),
            self.index_running.load(Ordering::Relaxed),
        )
    }
}

fn search_lyra_objects(request: &SearchLocalRequest, query: &str) -> Vec<SearchLocalResultItem> {
    let mut candidates = Vec::new();
    let project_root = request
        .context
        .project_root
        .as_deref()
        .or(request.project_root.as_deref());
    if let Some(project_root) = project_root {
        let path = PathBuf::from(project_root);
        if let Some(score) = score_path(query, &path, 1_350_000.0) {
            candidates.push(item_from_path(
                path,
                SearchResultSourceKind::Workspace,
                SearchResultKind::Workspace,
                "workspace",
                score,
                query,
            ));
        }
    }
    candidates
}

fn search_system_files(query: &str, home_root: &Path, limit: usize) -> Vec<SearchLocalResultItem> {
    let mut paths = platform_system_search(query, home_root, limit);
    if paths.len() < limit {
        paths.extend(search_home_paths_by_file_name(query, home_root, limit));
    }
    paths
        .into_iter()
        .filter_map(|path| {
            let metadata = fs::metadata(&path).ok();
            let kind = if metadata.as_ref().is_some_and(fs::Metadata::is_dir) {
                SearchResultKind::Directory
            } else {
                SearchResultKind::File
            };
            let score = score_path(query, &path, 1_050_000.0)?;
            Some(item_from_path(
                path,
                SearchResultSourceKind::File,
                kind,
                "system",
                score,
                query,
            ))
        })
        .collect()
}

fn search_home_paths_by_file_name(query: &str, home_root: &Path, limit: usize) -> Vec<PathBuf> {
    if query.trim().is_empty() {
        return Vec::new();
    }
    let started_at = Instant::now();
    let mut results = Vec::new();
    let mut pending = VecDeque::from([home_root.to_path_buf()]);

    while let Some(dir) = pending.pop_front() {
        if results.len() >= limit || started_at.elapsed() >= CONTENT_PROVIDER_TIMEOUT {
            break;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if results.len() >= limit || started_at.elapsed() >= CONTENT_PROVIDER_TIMEOUT {
                break;
            }
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                if should_skip_file_name_walk_dir(&path) {
                    continue;
                }
                collect_file_name_match(query, &path, &mut results);
                pending.push_back(path);
            } else if file_type.is_file() || file_type.is_symlink() {
                collect_file_name_match(query, &path, &mut results);
            }
        }
    }
    results.truncate(limit);
    results
}

fn should_skip_file_name_walk_dir(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|value| value.to_str()),
        Some(
            ".git"
                | "node_modules"
                | "target"
                | "dist"
                | "build"
                | ".next"
                | "Library"
                | "Caches"
                | ".cache"
        )
    )
}

fn collect_file_name_match(query: &str, path: &Path, results: &mut Vec<PathBuf>) {
    if score_path(query, &path, 1_000_000.0).is_some() {
        results.push(path.to_path_buf());
    }
}

fn search_home_index(
    engine: Arc<LocalSearchEngine>,
    home_root: PathBuf,
    query: String,
    limit: usize,
) -> SearchProviderOutput {
    let status = engine.status();
    let mut stats = SearchLocalStats {
        scanned_files: status.indexed_file_count,
        scanned_dirs: status.indexed_dir_count,
        content_scanned_files: status.indexed_content_file_count,
        matched_files: 0,
        skipped_unreadable: 0,
        skipped_binary_or_too_large: 0,
        used_index: false,
    };
    let content_mode = if status.sqlite_fts_available && status.indexed_content_file_count > 0 {
        LocalSearchContentMode::Auto
    } else {
        LocalSearchContentMode::Disabled
    };
    let results = engine
        .search(
            LocalSearchOptions {
                query: query.clone(),
                roots: vec![home_root],
                kinds: vec![LocalSearchKind::File, LocalSearchKind::Directory],
                extensions: Vec::new(),
                limit: limit.saturating_mul(3).min(MAX_RESULT_LIMIT),
                include_hidden: false,
                include_vendor: false,
                respect_gitignore: true,
                content_mode,
                max_file_size_bytes: BACKGROUND_TEXT_SCAN_BYTES,
                enable_fuzzy: true,
                enable_extension_match: true,
            },
            None,
        )
        .map(|response| {
            stats.used_index = true;
            response
                .results
                .into_iter()
                .map(|result| item_from_index_result(result, &query))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    stats.matched_files = results.len() as u64;
    SearchProviderOutput {
        results,
        stats,
        elapsed_ms: 0,
    }
}

fn search_home_content(query: &str, home_root: &Path, limit: usize) -> Vec<SearchLocalResultItem> {
    if query.trim().is_empty() {
        return Vec::new();
    }
    let max_lines = limit
        .saturating_mul(CONTENT_PROVIDER_MAX_MATCHES_PER_FILE)
        .max(CONTENT_PROVIDER_MAX_LINES.min(limit.max(1)));
    run_command_lines_limited(
        "rg",
        &[
            "--color=never",
            "--line-number",
            "--column",
            "--no-heading",
            "--smart-case",
            "--fixed-strings",
            "--max-count",
            &CONTENT_PROVIDER_MAX_MATCHES_PER_FILE.to_string(),
            "--max-filesize",
            "1M",
            "--glob",
            "!**/.git/**",
            "--glob",
            "!**/node_modules/**",
            "--glob",
            "!**/target/**",
            "--glob",
            "!**/dist/**",
            "--glob",
            "!**/build/**",
            "--glob",
            "!**/.next/**",
            "--glob",
            "!**/Library/**",
            "--glob",
            "!**/Caches/**",
            "--glob",
            "!**/.cache/**",
            query,
            &normalize_path_string(home_root),
        ],
        CONTENT_PROVIDER_TIMEOUT,
        max_lines,
    )
    .into_iter()
    .filter_map(|line| item_from_rg_line(&line, home_root, query))
    .collect()
}

#[cfg(target_os = "macos")]
fn platform_system_search(query: &str, _home_root: &Path, limit: usize) -> Vec<PathBuf> {
    run_command_lines_limited(
        "mdfind",
        &[query],
        SYSTEM_PROVIDER_TIMEOUT,
        limit.saturating_mul(2).max(1),
    )
    .into_iter()
    .take(limit)
    .map(PathBuf::from)
    .collect()
}

#[cfg(target_os = "windows")]
fn platform_system_search(query: &str, _home_root: &Path, limit: usize) -> Vec<PathBuf> {
    let escaped_query = query.replace('\'', "''");
    let script = format!(
        "$c=New-Object -ComObject ADODB.Connection;\
         $c.Open('Provider=Search.CollatorDSO;Extended Properties=\"Application=Windows\";');\
         $sql=\"SELECT TOP {limit} System.ItemPathDisplay FROM SYSTEMINDEX \
         WHERE System.FileName LIKE '%{escaped_query}%'\";\
         $r=New-Object -ComObject ADODB.Recordset;\
         $r.Open($sql,$c);\
         while(-not $r.EOF){{ $r.Fields.Item('System.ItemPathDisplay').Value; $r.MoveNext() }};\
         $r.Close();$c.Close();"
    );
    run_command_lines_limited(
        "powershell.exe",
        &[
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ],
        SYSTEM_PROVIDER_TIMEOUT,
        limit.saturating_mul(2).max(1),
    )
    .into_iter()
    .take(limit)
    .map(PathBuf::from)
    .collect()
}

#[cfg(all(unix, not(target_os = "macos")))]
fn platform_system_search(query: &str, _home_root: &Path, limit: usize) -> Vec<PathBuf> {
    let tracker = run_command_lines_limited(
        "tracker3",
        &[
            "search",
            "--files",
            "--disable-snippets",
            "--limit",
            &limit.to_string(),
            query,
        ],
        SYSTEM_PROVIDER_TIMEOUT,
        limit.saturating_mul(2).max(1),
    )
    .into_iter()
    .map(|line| match line.strip_prefix("file://") {
        Some(path) => path.to_string(),
        None => line,
    })
    .map(PathBuf::from)
    .take(limit)
    .collect::<Vec<_>>();
    if !tracker.is_empty() {
        return tracker;
    }

    run_command_lines_limited(
        "locate",
        &["-i", "-l", &limit.to_string(), query],
        SYSTEM_PROVIDER_TIMEOUT,
        limit.saturating_mul(2).max(1),
    )
    .into_iter()
    .map(PathBuf::from)
    .take(limit)
    .collect()
}

#[cfg(not(any(unix, windows)))]
fn platform_system_search(_query: &str, _home_root: &Path, _limit: usize) -> Vec<PathBuf> {
    Vec::new()
}

fn run_command_lines_limited(
    program: &str,
    args: &[&str],
    timeout: Duration,
    max_lines: usize,
) -> Vec<String> {
    let mut child = match Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return Vec::new(),
    };

    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Vec::new();
    };
    let (line_tx, line_rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if line_tx.send(line).is_err() {
                break;
            }
        }
    });

    let started_at = Instant::now();
    let mut lines = Vec::new();
    loop {
        for line in line_rx.try_iter() {
            let line = line.trim().to_string();
            if !line.is_empty() {
                lines.push(line);
            }
            if lines.len() >= max_lines {
                let _ = child.kill();
                let _ = child.wait();
                return lines;
            }
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return Vec::new();
                }
                for line in line_rx.try_iter() {
                    let line = line.trim().to_string();
                    if !line.is_empty() {
                        lines.push(line);
                    }
                    if lines.len() >= max_lines {
                        break;
                    }
                }
                return lines;
            }
            Ok(None) if started_at.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                for line in line_rx.try_iter() {
                    let line = line.trim().to_string();
                    if !line.is_empty() {
                        lines.push(line);
                    }
                    if lines.len() >= max_lines {
                        break;
                    }
                }
                return lines;
            }
            Ok(None) => thread::sleep(Duration::from_millis(12)),
            Err(_) => return Vec::new(),
        }
    }
}

fn item_from_rg_line(line: &str, home_root: &Path, query: &str) -> Option<SearchLocalResultItem> {
    let mut parts = line.rsplitn(4, ':');
    let text = parts.next()?.trim().to_string();
    let column = parts.next()?.parse::<usize>().ok().unwrap_or(1);
    let line_number = parts.next()?.parse::<u64>().ok()?;
    let raw_path = parts.next()?.trim();
    if raw_path.is_empty() {
        return None;
    }
    let path = {
        let path = PathBuf::from(raw_path);
        if path.is_absolute() {
            path
        } else {
            home_root.join(path)
        }
    };
    let line_weight = line_number.clamp(1, 1_000) as u32;
    let score = score_path(query, &path, 880_000.0).unwrap_or(910_000.0)
        + (10_000.0 / f64::from(line_weight));
    let mut item = item_from_path(
        path,
        SearchResultSourceKind::File,
        SearchResultKind::File,
        "content",
        score,
        query,
    );
    item.match_kind = "content".to_string();
    item.snippet = Some(text.clone());
    item.line = Some(line_number);
    item.match_ranges = match_ranges_for_content(&item.title, &text, query, column);
    Some(item)
}

fn match_ranges_for_content(
    title: &str,
    snippet: &str,
    query: &str,
    column: usize,
) -> Vec<SearchMatchRange> {
    let mut ranges = match_ranges_for_title(title, query);
    let snippet_lower = snippet.to_lowercase();
    let query_lower = query.trim().to_lowercase();
    if !query_lower.is_empty() {
        let start = snippet_lower
            .find(&query_lower)
            .unwrap_or_else(|| column.saturating_sub(1).min(snippet.len()));
        ranges.push(SearchMatchRange {
            field: "snippet".to_string(),
            start,
            end: start.saturating_add(query_lower.len()).min(snippet.len()),
        });
    }
    ranges
}

fn item_from_index_result(result: LocalSearchResult, query: &str) -> SearchLocalResultItem {
    let kind = match result.kind {
        LocalSearchKind::File => SearchResultKind::File,
        LocalSearchKind::Directory => SearchResultKind::Directory,
    };
    let score = index_score(result.score, result.source, result.match_kind);
    let path = result.path.clone();
    let extension = result
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.extension.clone())
        .or_else(|| {
            path.extension()
                .and_then(|value| value.to_str())
                .map(str::to_string)
        });
    let modified_at = result
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.modified_at);
    let match_kind = match_kind_to_legacy(result.match_kind).to_string();
    let mut item = item_from_path(
        path,
        SearchResultSourceKind::File,
        kind,
        &match_kind,
        score,
        query,
    );
    item.extension = extension;
    item.match_kind = match_kind;
    item.snippet = result.snippet;
    item.modified_at = modified_at;
    item
}

fn item_from_path(
    path: PathBuf,
    source: SearchResultSourceKind,
    kind: SearchResultKind,
    match_kind: &str,
    score: f64,
    query: &str,
) -> SearchLocalResultItem {
    let path_string = normalize_path_string(&path);
    let file_name = file_name_from_path(&path);
    let subtitle = path
        .parent()
        .map(normalize_path_string)
        .unwrap_or_else(|| path_string.clone());
    SearchLocalResultItem {
        id: stable_result_id(source, &path_string),
        path: path_string.clone(),
        display_path: path_string,
        file_name: file_name.clone(),
        extension: path
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_string),
        match_kind: match_kind.to_string(),
        score,
        snippet: None,
        line: None,
        modified_at: fs::metadata(&path)
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs()),
        source,
        kind,
        title: file_name.clone(),
        subtitle,
        match_ranges: match_ranges_for_title(&file_name, query),
        actions: actions_for_kind(kind),
    }
}

fn file_name_from_path(path: &Path) -> String {
    path.file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| normalize_path_string(path))
}

fn stable_result_id(source: SearchResultSourceKind, key: &str) -> String {
    let mut hasher = DefaultHasher::new();
    source.hash(&mut hasher);
    key.hash(&mut hasher);
    format!("search-v2-{:x}", hasher.finish())
}

fn actions_for_kind(kind: SearchResultKind) -> Vec<SearchResultAction> {
    match kind {
        SearchResultKind::File | SearchResultKind::Directory | SearchResultKind::Workspace => vec![
            SearchResultAction {
                id: "open".to_string(),
                label: "Open".to_string(),
            },
            SearchResultAction {
                id: "reveal".to_string(),
                label: "Reveal".to_string(),
            },
        ],
        SearchResultKind::Page | SearchResultKind::Session => vec![SearchResultAction {
            id: "open".to_string(),
            label: "Open".to_string(),
        }],
    }
}

fn match_ranges_for_title(title: &str, query: &str) -> Vec<SearchMatchRange> {
    let title_lower = title.to_lowercase();
    let query_lower = query.trim().to_lowercase();
    if query_lower.is_empty() {
        return Vec::new();
    }
    title_lower
        .find(&query_lower)
        .map(|start| SearchMatchRange {
            field: "title".to_string(),
            start,
            end: start + query_lower.len(),
        })
        .into_iter()
        .collect()
}

fn score_path(query: &str, path: &Path, base: f64) -> Option<f64> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return None;
    }
    let file_name = file_name_from_path(path).to_lowercase();
    let path_text = normalize_path_string(path).to_lowercase();
    if file_name == query {
        Some(base + 180_000.0)
    } else if file_name.starts_with(&query) {
        Some(base + 130_000.0)
    } else if file_name.contains(&query) {
        Some(base + 95_000.0)
    } else if path_text.contains(&query) {
        Some(base + 35_000.0)
    } else if fuzzy_contains(&file_name, &query) {
        Some(base - 25_000.0)
    } else {
        None
    }
}

fn fuzzy_contains(haystack: &str, needle: &str) -> bool {
    let mut cursor = 0;
    let haystack_chars = haystack.chars().collect::<Vec<_>>();
    for needle_char in needle.chars() {
        let Some(next) = haystack_chars[cursor..]
            .iter()
            .position(|candidate| *candidate == needle_char)
        else {
            return false;
        };
        cursor += next + 1;
    }
    true
}

fn index_score(score: u32, source: LocalSearchSource, match_kind: LocalSearchMatchKind) -> f64 {
    let source_bonus = match source {
        LocalSearchSource::Index => 35_000.0,
        LocalSearchSource::Content => 20_000.0,
        LocalSearchSource::Symbol => 15_000.0,
        LocalSearchSource::Walker => 0.0,
    };
    let kind_bonus = match match_kind {
        LocalSearchMatchKind::FileName => 80_000.0,
        LocalSearchMatchKind::Extension => 45_000.0,
        LocalSearchMatchKind::Content => 30_000.0,
        LocalSearchMatchKind::Path => 22_000.0,
        LocalSearchMatchKind::Initial => 18_000.0,
        LocalSearchMatchKind::Metadata => 12_000.0,
        LocalSearchMatchKind::Fuzzy => 0.0,
    };
    f64::from(score) + source_bonus + kind_bonus
}

fn match_kind_to_legacy(kind: LocalSearchMatchKind) -> &'static str {
    match kind {
        LocalSearchMatchKind::Content => "content",
        LocalSearchMatchKind::FileName => "file_name",
        LocalSearchMatchKind::Extension => "extension",
        LocalSearchMatchKind::Fuzzy => "fuzzy",
        LocalSearchMatchKind::Initial
        | LocalSearchMatchKind::Metadata
        | LocalSearchMatchKind::Path => "path",
    }
}

fn dedupe_and_rank(
    results: Vec<SearchLocalResultItem>,
    limit: usize,
) -> Vec<SearchLocalResultItem> {
    let mut by_key = HashMap::<String, SearchLocalResultItem>::new();
    for result in results {
        let key = if result.path.is_empty() {
            result.id.clone()
        } else {
            normalize_dedupe_key(&result.path)
        };
        match by_key.get(&key) {
            Some(existing) if existing.score >= result.score => {}
            _ => {
                by_key.insert(key, result);
            }
        }
    }
    let mut ranked = by_key.into_values().collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.title.cmp(&right.title))
    });
    ranked.truncate(limit.saturating_mul(2).min(MAX_RESULT_LIMIT));
    ranked
}

fn build_search_response(
    query: &str,
    scope_preset: SearchLocalScopePreset,
    roots: &[String],
    results: Vec<SearchLocalResultItem>,
    mut stats: SearchLocalStats,
    elapsed_ms: u64,
    limit: usize,
    done: bool,
) -> SearchLocalResponse {
    let mut results = dedupe_and_rank(results, limit);
    let truncated = results.len() > limit;
    if truncated {
        results.truncate(limit);
    }
    stats.matched_files = stats.matched_files.max(
        results
            .iter()
            .filter(|result| {
                matches!(
                    result.kind,
                    SearchResultKind::File
                        | SearchResultKind::Directory
                        | SearchResultKind::Workspace
                )
            })
            .count() as u64,
    );
    SearchLocalResponse {
        query: query.to_string(),
        scope_preset,
        roots: roots.to_vec(),
        results,
        truncated: truncated || !done,
        elapsed_ms,
        stats,
    }
}

fn merge_stats(target: &mut SearchLocalStats, next: SearchLocalStats) {
    target.scanned_files = target.scanned_files.max(next.scanned_files);
    target.scanned_dirs = target.scanned_dirs.max(next.scanned_dirs);
    target.content_scanned_files = target
        .content_scanned_files
        .saturating_add(next.content_scanned_files);
    target.matched_files = target.matched_files.saturating_add(next.matched_files);
    target.skipped_unreadable = target
        .skipped_unreadable
        .saturating_add(next.skipped_unreadable);
    target.skipped_binary_or_too_large = target
        .skipped_binary_or_too_large
        .saturating_add(next.skipped_binary_or_too_large);
    target.used_index = target.used_index || next.used_index;
}

fn normalize_dedupe_key(path: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        path.replace('\\', "/").to_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.replace('\\', "/")
    }
}

fn to_index_status(status: LocalSearchStatus, index_running: bool) -> SearchIndexStatusResponse {
    let last_built_at = status
        .roots
        .iter()
        .filter_map(|root| root.last_indexed_at)
        .max()
        .map(|value| value.to_string());
    let error = status.roots.iter().find_map(|root| root.error.clone());
    let state = if index_running {
        SearchIndexState::Building
    } else {
        match status.state {
            LocalSearchIndexState::Ready | LocalSearchIndexState::Partial => {
                SearchIndexState::Ready
            }
            LocalSearchIndexState::Indexing => SearchIndexState::Building,
            LocalSearchIndexState::Failed => SearchIndexState::Failed,
            LocalSearchIndexState::Empty | LocalSearchIndexState::Walker => SearchIndexState::Idle,
        }
    };
    let progress = match state {
        SearchIndexState::Building => Some(0.0),
        SearchIndexState::Ready => Some(1.0),
        SearchIndexState::Idle | SearchIndexState::Failed => None,
    };
    SearchIndexStatusResponse {
        state,
        indexed_files: status.indexed_file_count,
        indexed_dirs: status.indexed_dir_count,
        last_built_at,
        progress,
        error,
    }
}

fn empty_stats() -> SearchLocalStats {
    SearchLocalStats {
        scanned_files: 0,
        scanned_dirs: 0,
        content_scanned_files: 0,
        matched_files: 0,
        skipped_unreadable: 0,
        skipped_binary_or_too_large: 0,
        used_index: false,
    }
}

fn stream_is_active(stream_id: &str) -> bool {
    stream_store()
        .read()
        .map(|streams| streams.contains_key(stream_id))
        .unwrap_or(false)
}

fn prune_stream_store(streams: &mut HashMap<String, Arc<RwLock<SearchStreamState>>>) {
    if streams.len() <= STREAM_MAX_ACTIVE {
        return;
    }
    let removable = streams
        .iter()
        .filter_map(|(stream_id, state)| {
            let snapshot = state.read().ok()?;
            if snapshot.snapshot.done {
                Some(stream_id.clone())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    for stream_id in removable {
        if streams.len() <= STREAM_MAX_ACTIVE {
            break;
        }
        streams.remove(&stream_id);
    }
}

pub fn search_local_json(request_json: String) -> Result<String, String> {
    let request: SearchLocalRequest =
        serde_json::from_str(&request_json).map_err(|error| format!("invalid request: {error}"))?;
    if request.query.trim().is_empty() {
        return Err("query is required".to_string());
    }
    let service = service_for_request(request.storage_root.as_deref())?;
    let response = service.search(&request, clamp_limit(request.limit));
    serde_json::to_string(&response).map_err(|error| format!("serialize response failed: {error}"))
}

fn run_stream_worker(
    stream_id: String,
    stream_state: Arc<RwLock<SearchStreamState>>,
    request: SearchLocalRequest,
    limit: usize,
    service: Arc<SearchCoreService>,
    cancel_flag: Arc<AtomicBool>,
) {
    if cancel_flag.load(Ordering::Relaxed) {
        return;
    }
    let update_stream_id = stream_id.clone();
    let update_state = stream_state.clone();
    let update_cancel_flag = cancel_flag.clone();
    let result = service.search_with_updates(&request, limit, move |payload| {
        if update_cancel_flag.load(Ordering::Relaxed) || !stream_is_active(&update_stream_id) {
            return;
        }
        if let Ok(mut guard) = update_state.write() {
            guard.snapshot.results = payload.results;
            guard.snapshot.truncated = payload.truncated;
            guard.snapshot.elapsed_ms = payload.elapsed_ms;
            guard.snapshot.stats = payload.stats;
            guard.snapshot.done = false;
            guard.snapshot.error = None;
        }
    });
    if cancel_flag.load(Ordering::Relaxed) || !stream_is_active(&stream_id) {
        return;
    }
    if let Ok(mut guard) = stream_state.write() {
        guard.snapshot.results = result.results;
        guard.snapshot.truncated = result.truncated;
        guard.snapshot.elapsed_ms = result.elapsed_ms;
        guard.snapshot.stats = result.stats;
        guard.snapshot.done = true;
        guard.snapshot.error = None;
    }
}

pub fn search_local_stream_start_json(request_json: String) -> Result<String, String> {
    let request: SearchLocalRequest =
        serde_json::from_str(&request_json).map_err(|error| format!("invalid request: {error}"))?;
    let query = request.query.trim().to_string();
    if query.is_empty() {
        return Err("query is required".to_string());
    }
    let limit = request
        .limit
        .unwrap_or(STREAM_RESULT_LIMIT_DEFAULT)
        .max(1)
        .min(MAX_RESULT_LIMIT);
    let service = service_for_request(request.storage_root.as_deref())?;
    let roots = vec![normalize_path_string(&service.home_root)];
    let scope_preset = request.scope_preset;
    let stream_id = format!("search-stream-{}", Uuid::new_v4());
    let cancel_flag = Arc::new(AtomicBool::new(false));
    let stream_state = Arc::new(RwLock::new(SearchStreamState {
        snapshot: SearchLocalStreamReadResponse {
            stream_id: stream_id.clone(),
            query: query.clone(),
            scope_preset,
            roots: roots.clone(),
            results: Vec::new(),
            truncated: false,
            elapsed_ms: 0,
            stats: empty_stats(),
            done: false,
            error: None,
        },
        cancel_flag: cancel_flag.clone(),
    }));
    {
        let mut streams = stream_store()
            .write()
            .map_err(|_| "search stream state lock poisoned".to_string())?;
        prune_stream_store(&mut streams);
        streams.insert(stream_id.clone(), stream_state.clone());
    }

    let worker_stream_id = stream_id.clone();
    thread::spawn(move || {
        run_stream_worker(
            worker_stream_id,
            stream_state,
            request,
            limit,
            service,
            cancel_flag,
        );
    });

    serde_json::to_string(&SearchLocalStreamStartResponse {
        stream_id,
        query,
        scope_preset,
        roots,
    })
    .map_err(|error| format!("serialize response failed: {error}"))
}

pub fn search_local_stream_read_json(request_json: String) -> Result<String, String> {
    let request: SearchLocalStreamReadRequest =
        serde_json::from_str(&request_json).map_err(|error| format!("invalid request: {error}"))?;
    if request.stream_id.trim().is_empty() {
        return Err("streamId is required".to_string());
    }

    let stream_state = {
        let streams = stream_store()
            .read()
            .map_err(|_| "search stream state lock poisoned".to_string())?;
        streams.get(request.stream_id.as_str()).cloned()
    };
    let Some(stream_state) = stream_state else {
        return Err("search stream not found".to_string());
    };

    let mut snapshot = stream_state
        .read()
        .map_err(|_| "search stream snapshot lock poisoned".to_string())?
        .snapshot
        .clone();
    if let Some(limit) = request.limit {
        let clamped = clamp_limit(Some(limit));
        if snapshot.results.len() > clamped {
            snapshot.results.truncate(clamped);
            snapshot.truncated = true;
        }
    }

    serde_json::to_string(&snapshot).map_err(|error| format!("serialize response failed: {error}"))
}

pub fn search_local_stream_cancel_json(request_json: String) -> Result<String, String> {
    let request: SearchLocalStreamCancelRequest =
        serde_json::from_str(&request_json).map_err(|error| format!("invalid request: {error}"))?;
    if request.stream_id.trim().is_empty() {
        return Err("streamId is required".to_string());
    }
    let removed = stream_store()
        .write()
        .map_err(|_| "search stream state lock poisoned".to_string())?
        .remove(request.stream_id.as_str());
    if let Some(stream_state) = &removed {
        if let Ok(guard) = stream_state.read() {
            guard.cancel_flag.store(true, Ordering::Relaxed);
        }
    }
    serde_json::to_string(&SearchLocalStreamCancelResponse {
        removed: removed.is_some(),
    })
    .map_err(|error| format!("serialize response failed: {error}"))
}

pub fn read_search_index_status_json(request_json: String) -> Result<String, String> {
    let request: SearchIndexStatusRequest = serde_json::from_str(&request_json)
        .unwrap_or(SearchIndexStatusRequest { storage_root: None });
    let service = service_for_request(request.storage_root.as_deref())?;
    serde_json::to_string(&service.index_status())
        .map_err(|error| format!("serialize response failed: {error}"))
}

pub fn rebuild_search_index_json(request_json: String) -> Result<String, String> {
    let request: SearchRebuildIndexRequest = serde_json::from_str(&request_json)
        .unwrap_or(SearchRebuildIndexRequest { storage_root: None });
    let service = service_for_request(request.storage_root.as_deref())?;
    service.spawn_index_job();
    let roots = vec![normalize_path_string(&service.home_root)];
    serde_json::to_string(&SearchRebuildIndexResponse {
        status: service.index_status(),
        scope_preset: SearchLocalScopePreset::Home,
        roots,
    })
    .map_err(|error| format!("serialize response failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranks_exact_file_name_above_path_match() {
        let exact = item_from_path(
            PathBuf::from("/tmp/report.md"),
            SearchResultSourceKind::File,
            SearchResultKind::File,
            "system",
            score_path("report", Path::new("/tmp/report.md"), 1_000_000.0).unwrap_or_default(),
            "report",
        );
        let path_only = item_from_path(
            PathBuf::from("/tmp/reporting/notes.md"),
            SearchResultSourceKind::File,
            SearchResultKind::File,
            "system",
            score_path("report", Path::new("/tmp/reporting/notes.md"), 1_000_000.0)
                .unwrap_or_default(),
            "report",
        );
        let ranked = dedupe_and_rank(vec![path_only, exact], 10);
        assert_eq!(
            ranked.first().map(|item| item.file_name.as_str()),
            Some("report.md")
        );
    }

    #[test]
    fn dedupes_by_path_and_keeps_higher_score() {
        let low = item_from_path(
            PathBuf::from("/tmp/index.ts"),
            SearchResultSourceKind::File,
            SearchResultKind::File,
            "system",
            1.0,
            "index",
        );
        let high = item_from_path(
            PathBuf::from("/tmp/index.ts"),
            SearchResultSourceKind::File,
            SearchResultKind::File,
            "file_name",
            2.0,
            "index",
        );
        let ranked = dedupe_and_rank(vec![low, high], 10);
        assert_eq!(ranked.len(), 1);
        assert_eq!(ranked[0].score, 2.0);
    }

    #[test]
    fn cancelled_stream_is_removed() {
        let stream_id = format!("test-{}", Uuid::new_v4());
        let state = Arc::new(RwLock::new(SearchStreamState {
            snapshot: SearchLocalStreamReadResponse {
                stream_id: stream_id.clone(),
                query: "index".to_string(),
                scope_preset: SearchLocalScopePreset::Home,
                roots: Vec::new(),
                results: Vec::new(),
                truncated: false,
                elapsed_ms: 0,
                stats: empty_stats(),
                done: false,
                error: None,
            },
            cancel_flag: Arc::new(AtomicBool::new(false)),
        }));
        {
            let mut streams = stream_store()
                .write()
                .unwrap_or_else(|error| error.into_inner());
            streams.insert(stream_id.clone(), state);
        }
        let response = search_local_stream_cancel_json(
            serde_json::json!({ "streamId": stream_id }).to_string(),
        )
        .unwrap_or_else(|error| panic!("{error}"));
        let parsed: SearchLocalStreamCancelResponse =
            serde_json::from_str(&response).unwrap_or_else(|error| panic!("{error}"));
        assert!(parsed.removed);
    }

    #[test]
    fn home_content_provider_finds_unicode_text_without_project_context() {
        if Command::new("rg").arg("--version").output().is_err() {
            return;
        }
        let dir = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let file_path = dir.path().join("session-tabs.ts");
        fs::write(&file_path, "const DEFAULT_SESSION_TITLE = \"新会话\";\n")
            .unwrap_or_else(|error| panic!("{error}"));

        let results = search_home_content("新会话", dir.path(), 20);

        assert!(
            results
                .iter()
                .any(|result| result.path == normalize_path_string(&file_path)
                    && result
                        .snippet
                        .as_deref()
                        .is_some_and(|snippet| snippet.contains("新会话"))),
            "expected rg-backed content provider to find 新会话 in {file_path:?}"
        );
    }

    #[test]
    fn home_file_name_provider_finds_path_matches_without_content_match() {
        let dir = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let file_path = dir.path().join("LyraNotes").join("empty.txt");
        fs::create_dir_all(file_path.parent().expect("parent"))
            .unwrap_or_else(|error| panic!("{error}"));
        fs::write(&file_path, "plain text without query\n")
            .unwrap_or_else(|error| panic!("{error}"));

        let results = search_home_paths_by_file_name("lyra", dir.path(), 20);

        assert!(
            results.iter().any(|result| result == &file_path),
            "expected file-name fallback to find {file_path:?}"
        );
    }

    #[test]
    fn build_search_response_marks_partial_snapshots_as_not_final() {
        let item = item_from_path(
            PathBuf::from("/tmp/session-tabs.ts"),
            SearchResultSourceKind::File,
            SearchResultKind::File,
            "content",
            1_000.0,
            "新会话",
        );

        let partial = build_search_response(
            "新会话",
            SearchLocalScopePreset::Home,
            &["/tmp".to_string()],
            vec![item],
            empty_stats(),
            12,
            10,
            false,
        );

        assert!(!partial.results.is_empty());
        assert!(partial.truncated);
    }

    #[test]
    fn build_search_response_preserves_requested_scope() {
        let response = build_search_response(
            "lyra",
            SearchLocalScopePreset::Home,
            &["/tmp".to_string()],
            Vec::new(),
            empty_stats(),
            1,
            10,
            true,
        );

        assert_eq!(response.scope_preset, SearchLocalScopePreset::Home);
    }
}
