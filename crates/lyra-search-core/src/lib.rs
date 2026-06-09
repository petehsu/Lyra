use lyra_local_search::{
    LocalSearchApplyChangesOptions, LocalSearchContentMode, LocalSearchEngine,
    LocalSearchEngineConfig, LocalSearchIndexRootOptions, LocalSearchIndexState, LocalSearchKind,
    LocalSearchMatchKind, LocalSearchOptions, LocalSearchQueryMode, LocalSearchResult,
    LocalSearchSkippedStats, LocalSearchSource, LocalSearchStatus, LocalSearchStorageMode,
};
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
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
const BACKGROUND_TEXT_SCAN_BYTES: u64 = 256 * 1024;
const PROVIDER_JOIN_TIMEOUT: Duration = Duration::from_millis(2_750);
const WATCHER_APPLY_DEBOUNCE: Duration = Duration::from_secs(2);
const WATCHER_REBUILD_EVENT_THRESHOLD: usize = 1_000;
const SEARCH_V3_STORAGE_DIR: &str = "search-v3";

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
    pub mode: SearchLocalMode,
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
        .join("modules")
        .join("search")
}

fn engine_storage_root_for(storage_root: Option<&str>) -> PathBuf {
    normalize_storage_root(storage_root)
        .unwrap_or_else(default_storage_root)
        .join(SEARCH_V3_STORAGE_DIR)
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

fn normalize_existing_path(raw: &str) -> Option<PathBuf> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let path = PathBuf::from(raw);
    let candidate = if path.is_absolute() {
        path
    } else {
        std::env::current_dir().ok()?.join(path)
    };
    candidate.canonicalize().ok()
}

fn system_search_roots(_home_root: &Path) -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        vec![
            _home_root
                .components()
                .next()
                .map(|component| PathBuf::from(component.as_os_str()))
                .unwrap_or_else(|| _home_root.to_path_buf()),
        ]
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![PathBuf::from("/")]
    }
}

fn event_paths(event: notify::Result<Event>) -> Vec<PathBuf> {
    event.map(|event| event.paths).unwrap_or_default()
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut deduped = Vec::new();
    for path in paths {
        let key = normalize_path_key(&path);
        if seen.insert(key) {
            deduped.push(path);
        }
    }
    deduped
}

fn local_query_mode(mode: SearchLocalMode) -> LocalSearchQueryMode {
    match mode {
        SearchLocalMode::Fast => LocalSearchQueryMode::Fast,
        SearchLocalMode::Normal => LocalSearchQueryMode::Normal,
        SearchLocalMode::Full => LocalSearchQueryMode::Full,
    }
}

fn search_mode_multiplier(mode: SearchLocalMode) -> usize {
    match mode {
        SearchLocalMode::Fast => 2,
        SearchLocalMode::Normal => 3,
        SearchLocalMode::Full => 5,
    }
}

fn service_for_request(storage_root: Option<&str>) -> Result<Arc<SearchCoreService>, String> {
    service_for_request_with_background(storage_root, true)
}

fn service_for_request_with_background(
    storage_root: Option<&str>,
    start_background: bool,
) -> Result<Arc<SearchCoreService>, String> {
    let home_root = home_directory().ok_or_else(|| "home directory is unavailable".to_string())?;
    let engine_storage_root = engine_storage_root_for(storage_root);
    let key = normalize_path_string(&engine_storage_root);
    if let Ok(guard) = service_store().read() {
        if let Some(service) = guard.get(&key) {
            if start_background {
                service.ensure_background_started();
            }
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
    if start_background {
        service.ensure_background_started();
    }

    let mut guard = service_store()
        .write()
        .map_err(|_| "search service state lock poisoned".to_string())?;
    let service = guard.entry(key).or_insert_with(|| service).clone();
    if start_background {
        service.ensure_background_started();
    }
    Ok(service)
}

fn existing_service_for_request(storage_root: Option<&str>) -> Option<Arc<SearchCoreService>> {
    let key = normalize_path_string(&engine_storage_root_for(storage_root));
    service_store()
        .read()
        .ok()
        .and_then(|guard| guard.get(&key).cloned())
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
            self.spawn_index_job_for_root(self.home_root.clone());
        }
        self.spawn_watcher();
    }

    fn root_is_ready(&self) -> bool {
        self.root_is_ready_for(&self.home_root)
    }

    fn root_is_ready_for(&self, root: &Path) -> bool {
        self.root_status_for(root).is_some_and(|root| {
            matches!(
                root.state,
                LocalSearchIndexState::Ready | LocalSearchIndexState::Partial
            )
        })
    }

    fn root_is_ready_for_request(&self, root: &Path, request: &SearchLocalRequest) -> bool {
        let Some(status) = self.root_status_for(root) else {
            return false;
        };
        if !matches!(
            status.state,
            LocalSearchIndexState::Ready | LocalSearchIndexState::Partial
        ) {
            return false;
        }
        if request.enable_content.unwrap_or(true)
            && status.indexed_file_count > 0
            && status.indexed_content_file_count == 0
        {
            return false;
        }
        true
    }

    fn root_status_for(&self, root: &Path) -> Option<lyra_local_search::LocalSearchRootStatus> {
        let root_key = normalize_path_key(root);
        self.engine
            .status()
            .roots
            .into_iter()
            .find(|root| normalize_path_key(&root.root) == root_key)
    }

    fn spawn_index_job(self: &Arc<Self>) {
        self.spawn_index_job_for_root(self.home_root.clone());
    }

    fn spawn_index_job_for_root(self: &Arc<Self>, root: PathBuf) {
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
                    root,
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

    fn index_roots_blocking(
        &self,
        roots: &[PathBuf],
        request: &SearchLocalRequest,
    ) -> Result<(), String> {
        for root in roots {
            if self.root_is_ready_for_request(root, request) {
                continue;
            }
            let owns_running_flag = self
                .index_running
                .compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok();
            let result = self.engine.index_root(
                LocalSearchIndexRootOptions {
                    root: root.clone(),
                    include_hidden: request.include_hidden.unwrap_or(false),
                    include_vendor: false,
                    respect_gitignore: true,
                    content_mode: if request.enable_content.unwrap_or(true) {
                        LocalSearchContentMode::Auto
                    } else {
                        LocalSearchContentMode::Disabled
                    },
                    max_file_size_bytes: BACKGROUND_TEXT_SCAN_BYTES,
                },
                None,
            );
            if owns_running_flag {
                self.index_running.store(false, Ordering::Relaxed);
            }
            result.map_err(|error| format!("native search index failed: {error}"))?;
        }
        Ok(())
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

            while let Ok(first) = rx.recv() {
                let mut paths = event_paths(first);
                thread::sleep(WATCHER_APPLY_DEBOUNCE);
                while let Ok(event) = rx.try_recv() {
                    paths.extend(event_paths(event));
                }
                paths = dedupe_paths(paths);
                if paths.is_empty() {
                    continue;
                }
                if paths.len() >= WATCHER_REBUILD_EVENT_THRESHOLD {
                    service.spawn_index_job();
                    continue;
                }
                let _ = service.engine.apply_changes(
                    LocalSearchApplyChangesOptions {
                        root: service.home_root.clone(),
                        paths,
                        include_hidden: false,
                        include_vendor: false,
                        respect_gitignore: true,
                        content_mode: LocalSearchContentMode::Auto,
                        max_file_size_bytes: BACKGROUND_TEXT_SCAN_BYTES,
                    },
                    None,
                );
            }
        });
    }

    fn search(self: &Arc<Self>, request: &SearchLocalRequest, limit: usize) -> SearchLocalResponse {
        self.search_with_updates(request, limit, |_| {})
    }

    fn search_with_updates(
        self: &Arc<Self>,
        request: &SearchLocalRequest,
        limit: usize,
        mut on_update: impl FnMut(SearchLocalResponse),
    ) -> SearchLocalResponse {
        let started_at = Instant::now();
        let query = request.query.trim().to_string();
        let scope_preset = request.scope_preset;
        let search_roots = self.roots_for_request(request);
        for root in &search_roots {
            if !self.root_is_ready_for_request(root, request) {
                self.spawn_index_job_for_root(root.clone());
            }
        }
        let roots = search_roots
            .iter()
            .map(|root| normalize_path_string(root))
            .collect::<Vec<_>>();
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
            let engine = self.engine.clone();
            let roots = search_roots.clone();
            let request = request.clone();
            let query = query.clone();
            thread::spawn(move || {
                let provider_started = Instant::now();
                let output = search_local_index(engine, roots, &request, query, limit);
                let mut output = output;
                output.elapsed_ms = provider_started.elapsed().as_millis() as u64;
                let _ = provider_tx.send(output);
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
                        self.index_status(),
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
            self.index_status(),
        )
    }

    fn roots_for_request(&self, request: &SearchLocalRequest) -> Vec<PathBuf> {
        let roots = match request.scope_preset {
            SearchLocalScopePreset::Home => vec![self.home_root.clone()],
            SearchLocalScopePreset::Workspace => request
                .context
                .project_root
                .as_deref()
                .or(request.project_root.as_deref())
                .map(|root| vec![PathBuf::from(root)])
                .unwrap_or_else(|| vec![self.home_root.clone()]),
            SearchLocalScopePreset::Custom => request
                .custom_roots
                .iter()
                .filter_map(|root| normalize_existing_path(root))
                .collect::<Vec<_>>(),
            SearchLocalScopePreset::FullSystem => system_search_roots(&self.home_root),
        };
        if roots.is_empty() {
            vec![self.home_root.clone()]
        } else {
            roots
        }
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

fn search_local_index(
    engine: Arc<LocalSearchEngine>,
    roots: Vec<PathBuf>,
    request: &SearchLocalRequest,
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
    let content_mode = if request.enable_content.unwrap_or(true) {
        LocalSearchContentMode::Auto
    } else {
        LocalSearchContentMode::Disabled
    };
    let results = engine
        .search(
            LocalSearchOptions {
                query: query.clone(),
                roots,
                kinds: vec![LocalSearchKind::File, LocalSearchKind::Directory],
                extensions: Vec::new(),
                limit: limit
                    .saturating_mul(search_mode_multiplier(request.mode))
                    .min(MAX_RESULT_LIMIT),
                include_hidden: request.include_hidden.unwrap_or(false),
                include_vendor: false,
                respect_gitignore: true,
                content_mode,
                max_file_size_bytes: BACKGROUND_TEXT_SCAN_BYTES,
                enable_fuzzy: request.enable_fuzzy.unwrap_or(true),
                enable_extension_match: request.enable_extension_match.unwrap_or(true),
                query_mode: local_query_mode(request.mode),
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
    item.line = result.line;
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
    format!("search-v3-{:x}", hasher.finish())
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
    index_status: SearchIndexStatusResponse,
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
        index_status,
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
    let roots = status
        .roots
        .iter()
        .map(|root| SearchIndexRootStatus {
            root: normalize_path_string(&root.root),
            state: to_search_index_state(root.state, false),
            indexed_files: root.indexed_file_count,
            indexed_dirs: root.indexed_dir_count,
            indexed_content_files: root.indexed_content_file_count,
            content_bytes_indexed: root.content_bytes_indexed,
            skipped: to_search_skipped(&root.skipped),
            last_built_at: root.last_indexed_at.map(|value| value.to_string()),
            error: root.error.clone(),
        })
        .collect();
    SearchIndexStatusResponse {
        state,
        engine_version: status.engine_version,
        phase: status.phase,
        indexed_files: status.indexed_file_count,
        indexed_dirs: status.indexed_dir_count,
        indexed_content_files: status.indexed_content_file_count,
        storage_bytes: status.storage_bytes,
        snapshot_bytes: status.snapshot_bytes,
        delta_bytes: status.delta_bytes,
        pending_changes: status.pending_changes,
        skipped: to_search_skipped(&status.skipped),
        roots,
        last_built_at,
        progress,
        error,
    }
}

fn to_search_index_state(state: LocalSearchIndexState, index_running: bool) -> SearchIndexState {
    if index_running {
        return SearchIndexState::Building;
    }
    match state {
        LocalSearchIndexState::Ready | LocalSearchIndexState::Partial => SearchIndexState::Ready,
        LocalSearchIndexState::Indexing => SearchIndexState::Building,
        LocalSearchIndexState::Failed => SearchIndexState::Failed,
        LocalSearchIndexState::Empty | LocalSearchIndexState::Walker => SearchIndexState::Idle,
    }
}

fn to_search_skipped(skipped: &LocalSearchSkippedStats) -> SearchIndexSkippedStats {
    SearchIndexSkippedStats {
        hidden: skipped.hidden,
        vendor: skipped.vendor,
        binary_or_too_large: skipped.binary_or_too_large,
        unreadable: skipped.unreadable,
        content_budget: skipped.content_budget,
    }
}

#[derive(Debug, Deserialize)]
struct DiskSearchIndexMeta {
    #[serde(default, alias = "engineVersion")]
    engine_version: Option<String>,
    #[serde(default)]
    phase: Option<String>,
    #[serde(default)]
    roots: Vec<DiskSearchIndexRootStatus>,
    #[serde(default, alias = "pendingChanges")]
    pending_changes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiskSearchIndexRootStatus {
    root: PathBuf,
    state: String,
    #[serde(default)]
    indexed_file_count: u64,
    #[serde(default)]
    indexed_dir_count: u64,
    #[serde(default)]
    indexed_content_file_count: u64,
    #[serde(default)]
    content_bytes_indexed: u64,
    #[serde(default)]
    skipped: DiskSearchIndexSkippedStats,
    #[serde(default)]
    last_indexed_at: Option<u64>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiskSearchIndexSkippedStats {
    #[serde(default)]
    hidden: u64,
    #[serde(default)]
    vendor: u64,
    #[serde(default)]
    binary_or_too_large: u64,
    #[serde(default)]
    unreadable: u64,
    #[serde(default)]
    content_budget: u64,
}

fn disk_search_state(state: &str) -> SearchIndexState {
    match state {
        "ready" | "partial" => SearchIndexState::Ready,
        "indexing" => SearchIndexState::Building,
        "failed" => SearchIndexState::Failed,
        _ => SearchIndexState::Idle,
    }
}

fn aggregate_disk_search_state(roots: &[DiskSearchIndexRootStatus]) -> SearchIndexState {
    if roots
        .iter()
        .any(|root| disk_search_state(&root.state) == SearchIndexState::Building)
    {
        return SearchIndexState::Building;
    }
    if roots
        .iter()
        .any(|root| disk_search_state(&root.state) == SearchIndexState::Ready)
    {
        return SearchIndexState::Ready;
    }
    if roots
        .iter()
        .any(|root| disk_search_state(&root.state) == SearchIndexState::Failed)
    {
        return SearchIndexState::Failed;
    }
    SearchIndexState::Idle
}

fn empty_search_skipped_stats() -> SearchIndexSkippedStats {
    SearchIndexSkippedStats {
        hidden: 0,
        vendor: 0,
        binary_or_too_large: 0,
        unreadable: 0,
        content_budget: 0,
    }
}

fn add_disk_skipped_stats(
    target: &mut SearchIndexSkippedStats,
    next: &DiskSearchIndexSkippedStats,
) {
    target.hidden = target.hidden.saturating_add(next.hidden);
    target.vendor = target.vendor.saturating_add(next.vendor);
    target.binary_or_too_large = target
        .binary_or_too_large
        .saturating_add(next.binary_or_too_large);
    target.unreadable = target.unreadable.saturating_add(next.unreadable);
    target.content_budget = target.content_budget.saturating_add(next.content_budget);
}

fn disk_file_bytes(path: &Path) -> u64 {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

fn disk_storage_bytes(native_dir: &Path) -> u64 {
    fs::read_dir(native_dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| entry.metadata().ok())
        .filter(|metadata| metadata.is_file())
        .map(|metadata| metadata.len())
        .sum()
}

fn disk_status_error(storage_root: Option<&str>, error: String) -> SearchIndexStatusResponse {
    let native_dir = engine_storage_root_for(storage_root).join("native");
    let snapshot_bytes = disk_file_bytes(&native_dir.join("snapshot.lyidx"));
    let delta_bytes = disk_file_bytes(&native_dir.join("delta.lylog"));
    SearchIndexStatusResponse {
        state: SearchIndexState::Failed,
        engine_version: "native-v3".to_string(),
        phase: "failed".to_string(),
        indexed_files: 0,
        indexed_dirs: 0,
        indexed_content_files: 0,
        storage_bytes: disk_storage_bytes(&native_dir),
        snapshot_bytes,
        delta_bytes,
        pending_changes: 0,
        skipped: empty_search_skipped_stats(),
        roots: Vec::new(),
        last_built_at: None,
        progress: None,
        error: Some(error),
    }
}

fn read_disk_search_index_status(storage_root: Option<&str>) -> Option<SearchIndexStatusResponse> {
    let native_dir = engine_storage_root_for(storage_root).join("native");
    let meta_path = native_dir.join("meta.json");
    if !meta_path.exists() {
        return None;
    }
    let text = match fs::read_to_string(&meta_path) {
        Ok(text) => text,
        Err(error) => {
            return Some(disk_status_error(
                storage_root,
                format!("local search v3 meta read failed: {error}"),
            ));
        }
    };
    let meta: DiskSearchIndexMeta = match serde_json::from_str(&text) {
        Ok(meta) => meta,
        Err(error) => {
            return Some(disk_status_error(
                storage_root,
                format!("local search v3 meta parse failed: {error}"),
            ));
        }
    };
    let state = aggregate_disk_search_state(&meta.roots);
    let progress = match state {
        SearchIndexState::Building => Some(0.0),
        SearchIndexState::Ready => Some(1.0),
        SearchIndexState::Idle | SearchIndexState::Failed => None,
    };
    let mut skipped = empty_search_skipped_stats();
    let indexed_files = meta
        .roots
        .iter()
        .map(|root| root.indexed_file_count)
        .sum::<u64>();
    let indexed_dirs = meta
        .roots
        .iter()
        .map(|root| root.indexed_dir_count)
        .sum::<u64>();
    let indexed_content_files = meta
        .roots
        .iter()
        .map(|root| root.indexed_content_file_count)
        .sum::<u64>();
    let last_built_at = meta
        .roots
        .iter()
        .filter_map(|root| root.last_indexed_at)
        .max()
        .map(|value| value.to_string());
    let error = meta.roots.iter().find_map(|root| root.error.clone());
    let roots = meta
        .roots
        .iter()
        .map(|root| {
            add_disk_skipped_stats(&mut skipped, &root.skipped);
            SearchIndexRootStatus {
                root: normalize_path_string(&root.root),
                state: disk_search_state(&root.state),
                indexed_files: root.indexed_file_count,
                indexed_dirs: root.indexed_dir_count,
                indexed_content_files: root.indexed_content_file_count,
                content_bytes_indexed: root.content_bytes_indexed,
                skipped: SearchIndexSkippedStats {
                    hidden: root.skipped.hidden,
                    vendor: root.skipped.vendor,
                    binary_or_too_large: root.skipped.binary_or_too_large,
                    unreadable: root.skipped.unreadable,
                    content_budget: root.skipped.content_budget,
                },
                last_built_at: root.last_indexed_at.map(|value| value.to_string()),
                error: root.error.clone(),
            }
        })
        .collect();
    let snapshot_bytes = disk_file_bytes(&native_dir.join("snapshot.lyidx"));
    let delta_bytes = disk_file_bytes(&native_dir.join("delta.lylog"));
    Some(SearchIndexStatusResponse {
        state,
        engine_version: meta
            .engine_version
            .unwrap_or_else(|| "native-v3".to_string()),
        phase: meta.phase.unwrap_or_else(|| {
            match state {
                SearchIndexState::Idle => "idle",
                SearchIndexState::Building => "indexing",
                SearchIndexState::Ready => "ready",
                SearchIndexState::Failed => "failed",
            }
            .to_string()
        }),
        indexed_files,
        indexed_dirs,
        indexed_content_files,
        storage_bytes: disk_storage_bytes(&native_dir),
        snapshot_bytes,
        delta_bytes,
        pending_changes: meta.pending_changes,
        skipped,
        roots,
        last_built_at,
        progress,
        error,
    })
}

pub fn search_index_status_is_ready(status: &SearchIndexStatusResponse) -> bool {
    status.state == SearchIndexState::Ready
        && status.indexed_files > 0
        && status
            .roots
            .iter()
            .any(|root| root.state == SearchIndexState::Ready && root.indexed_files > 0)
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
            guard.snapshot.index_status = payload.index_status;
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
        guard.snapshot.index_status = result.index_status;
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
    let service = service_for_request_with_background(request.storage_root.as_deref(), false)?;
    let roots = service
        .roots_for_request(&request)
        .iter()
        .map(|root| normalize_path_string(root))
        .collect::<Vec<_>>();
    let scope_preset = request.scope_preset;
    let stream_id = format!("search-stream-{}", Uuid::new_v4());
    let cancel_flag = Arc::new(AtomicBool::new(false));
    let index_status = service.index_status();
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
            index_status,
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

pub fn search_local_blocking_json(request_json: String) -> Result<String, String> {
    let request: SearchLocalRequest =
        serde_json::from_str(&request_json).map_err(|error| format!("invalid request: {error}"))?;
    if request.query.trim().is_empty() {
        return Err("query is required".to_string());
    }
    let service = service_for_request_with_background(request.storage_root.as_deref(), false)?;
    let roots = service.roots_for_request(&request);
    service.index_roots_blocking(&roots, &request)?;
    let response = service.search(&request, clamp_limit(request.limit));
    serde_json::to_string(&response).map_err(|error| format!("serialize response failed: {error}"))
}

pub fn read_search_index_status_json(request_json: String) -> Result<String, String> {
    let request: SearchIndexStatusRequest = serde_json::from_str(&request_json)
        .unwrap_or(SearchIndexStatusRequest { storage_root: None });
    if let Some(service) = existing_service_for_request(request.storage_root.as_deref()) {
        return serde_json::to_string(&service.index_status())
            .map_err(|error| format!("serialize response failed: {error}"));
    }
    if let Some(status) = read_disk_search_index_status(request.storage_root.as_deref())
        && (status.state != SearchIndexState::Idle
            || status.snapshot_bytes > 0
            || !status.roots.is_empty())
    {
        return serde_json::to_string(&status)
            .map_err(|error| format!("serialize response failed: {error}"));
    }
    let service = service_for_request(request.storage_root.as_deref())?;
    serde_json::to_string(&service.index_status())
        .map_err(|error| format!("serialize response failed: {error}"))
}

pub fn search_index_ready(storage_root: Option<&str>) -> Result<bool, String> {
    if let Some(service) = existing_service_for_request(storage_root) {
        return Ok(search_index_status_is_ready(&service.index_status()));
    }
    Ok(read_disk_search_index_status(storage_root)
        .as_ref()
        .is_some_and(search_index_status_is_ready))
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
                index_status: empty_index_status(),
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
    fn disk_index_status_reads_v3_meta_without_snapshot() {
        let dir = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let native_dir = dir.path().join("search-v3/native");
        fs::create_dir_all(&native_dir).unwrap_or_else(|error| panic!("{error}"));
        fs::write(
            native_dir.join("meta.json"),
            serde_json::json!({
                "engineVersion": "native-v3",
                "snapshotVersion": 3,
                "phase": "ready",
                "pendingChanges": 0,
                "roots": [{
                    "root": dir.path().to_string_lossy(),
                    "state": "ready",
                    "indexedFileCount": 3,
                    "indexedDirCount": 1,
                    "indexedContentFileCount": 2,
                    "contentBytesIndexed": 42,
                    "skipped": {},
                    "lastIndexedAt": 1234
                }]
            })
            .to_string(),
        )
        .unwrap_or_else(|error| panic!("{error}"));

        let status = read_search_index_status_json(
            serde_json::json!({ "storageRoot": dir.path().to_string_lossy() }).to_string(),
        )
        .unwrap_or_else(|error| panic!("{error}"));
        let parsed: serde_json::Value =
            serde_json::from_str(&status).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(parsed["state"], "ready");
        assert_eq!(parsed["indexedFiles"], 3);
        assert_eq!(parsed["snapshotBytes"], 0);
        assert!(search_index_ready(Some(&dir.path().to_string_lossy())).unwrap());
    }

    #[test]
    fn v3_index_provider_finds_unicode_content() {
        let dir = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let file_path = dir.path().join("session-tabs.ts");
        fs::write(&file_path, "const DEFAULT_SESSION_TITLE = \"新会话\";\n")
            .unwrap_or_else(|error| panic!("{error}"));
        let engine = Arc::new(LocalSearchEngine::new());
        engine
            .index_root(
                LocalSearchIndexRootOptions {
                    root: dir.path().to_path_buf(),
                    include_hidden: false,
                    include_vendor: false,
                    respect_gitignore: true,
                    content_mode: LocalSearchContentMode::Auto,
                    max_file_size_bytes: BACKGROUND_TEXT_SCAN_BYTES,
                },
                None,
            )
            .unwrap_or_else(|error| panic!("{error}"));

        let output = search_local_index(
            engine,
            vec![dir.path().to_path_buf()],
            &SearchLocalRequest {
                query: "新会话".to_string(),
                limit: Some(20),
                context: SearchContext::default(),
                scope_preset: SearchLocalScopePreset::Home,
                custom_roots: Vec::new(),
                project_root: None,
                mode: SearchLocalMode::Normal,
                include_hidden: None,
                enable_fuzzy: None,
                enable_content: None,
                enable_extension_match: None,
                storage_root: None,
            },
            "新会话".to_string(),
            20,
        );
        let expected_path = normalize_path_string(
            &file_path
                .canonicalize()
                .unwrap_or_else(|_| file_path.clone()),
        );

        assert!(
            output
                .results
                .iter()
                .any(|result| result.path == expected_path
                    && result
                        .snippet
                        .as_deref()
                        .is_some_and(|snippet| snippet.contains("新会话"))),
            "expected V3 content index to find 新会话 in {file_path:?}"
        );
    }

    #[test]
    fn v3_index_provider_finds_path_matches_without_content_match() {
        let dir = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let file_path = dir.path().join("LyraNotes").join("empty.txt");
        fs::create_dir_all(file_path.parent().expect("parent"))
            .unwrap_or_else(|error| panic!("{error}"));
        fs::write(&file_path, "plain text without query\n")
            .unwrap_or_else(|error| panic!("{error}"));
        let engine = Arc::new(LocalSearchEngine::new());
        engine
            .index_root(
                LocalSearchIndexRootOptions {
                    root: dir.path().to_path_buf(),
                    include_hidden: false,
                    include_vendor: false,
                    respect_gitignore: true,
                    content_mode: LocalSearchContentMode::Auto,
                    max_file_size_bytes: BACKGROUND_TEXT_SCAN_BYTES,
                },
                None,
            )
            .unwrap_or_else(|error| panic!("{error}"));

        let output = search_local_index(
            engine,
            vec![dir.path().to_path_buf()],
            &SearchLocalRequest {
                query: "lyra".to_string(),
                limit: Some(20),
                context: SearchContext::default(),
                scope_preset: SearchLocalScopePreset::Home,
                custom_roots: Vec::new(),
                project_root: None,
                mode: SearchLocalMode::Fast,
                include_hidden: None,
                enable_fuzzy: None,
                enable_content: Some(false),
                enable_extension_match: None,
                storage_root: None,
            },
            "lyra".to_string(),
            20,
        );
        let expected_path = normalize_path_string(
            &file_path
                .canonicalize()
                .unwrap_or_else(|_| file_path.clone()),
        );

        assert!(
            output
                .results
                .iter()
                .any(|result| result.path == expected_path),
            "expected V3 path index to find {file_path:?}"
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
            empty_index_status(),
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
            empty_index_status(),
        );

        assert_eq!(response.scope_preset, SearchLocalScopePreset::Home);
    }

    fn empty_index_status() -> SearchIndexStatusResponse {
        SearchIndexStatusResponse {
            state: SearchIndexState::Idle,
            engine_version: "native-v3".to_string(),
            phase: "idle".to_string(),
            indexed_files: 0,
            indexed_dirs: 0,
            indexed_content_files: 0,
            storage_bytes: 0,
            snapshot_bytes: 0,
            delta_bytes: 0,
            pending_changes: 0,
            skipped: SearchIndexSkippedStats {
                hidden: 0,
                vendor: 0,
                binary_or_too_large: 0,
                unreadable: 0,
                content_budget: 0,
            },
            roots: Vec::new(),
            last_built_at: None,
            progress: None,
            error: None,
        }
    }
}
