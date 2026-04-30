use lyra_local_search as core_search;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::Instant;
use uuid::Uuid;

const DEFAULT_RESULT_LIMIT: usize = 48;
const MAX_RESULT_LIMIT: usize = 300;
const DEFAULT_CONTENT_SCAN_ENABLED: bool = true;
const DEFAULT_FUZZY_ENABLED: bool = true;
const DEFAULT_EXTENSION_MATCH_ENABLED: bool = true;
const DEFAULT_TEXT_SCAN_BYTES: u64 = 1_000_000;
const STREAM_RESULT_LIMIT_DEFAULT: usize = 120;
const STREAM_MAX_ACTIVE: usize = 64;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SearchIndexState {
    Idle,
    Building,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchLocalRequest {
    pub query: String,
    pub limit: Option<usize>,
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
    pub scope_preset: SearchLocalScopePreset,
    #[serde(default)]
    pub custom_roots: Vec<String>,
    #[serde(default)]
    pub project_root: Option<String>,
    #[serde(default)]
    pub include_hidden: Option<bool>,
    #[serde(default)]
    pub force: Option<bool>,
    #[serde(default)]
    pub storage_root: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchIndexStatusRequest {
    #[serde(default)]
    storage_root: Option<String>,
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
}

#[derive(Debug, Clone, Serialize)]
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

#[derive(Debug, Clone, Serialize)]
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

static SEARCH_ENGINES: OnceLock<RwLock<HashMap<String, Arc<core_search::LocalSearchEngine>>>> =
    OnceLock::new();
static SEARCH_STREAMS: OnceLock<RwLock<HashMap<String, Arc<RwLock<SearchStreamState>>>>> =
    OnceLock::new();

fn search_engine_store() -> &'static RwLock<HashMap<String, Arc<core_search::LocalSearchEngine>>> {
    SEARCH_ENGINES.get_or_init(|| RwLock::new(HashMap::new()))
}

fn search_stream_store() -> &'static RwLock<HashMap<String, Arc<RwLock<SearchStreamState>>>> {
    SEARCH_STREAMS.get_or_init(|| RwLock::new(HashMap::new()))
}

fn clamp_limit(value: Option<usize>) -> usize {
    value
        .unwrap_or(DEFAULT_RESULT_LIMIT)
        .max(1)
        .min(MAX_RESULT_LIMIT)
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

fn full_system_roots() -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let mut roots = Vec::new();
        for drive in b'A'..=b'Z' {
            let candidate = PathBuf::from(format!("{}:\\", drive as char));
            if candidate.exists() {
                roots.push(candidate);
            }
        }
        if roots.is_empty() {
            if let Some(home) = home_directory() {
                roots.push(home);
            }
        }
        roots
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![PathBuf::from("/")]
    }
}

fn expand_tilde_prefix(raw: &str) -> PathBuf {
    if raw == "~" {
        return home_directory().unwrap_or_else(|| PathBuf::from(raw));
    }
    if let Some(rest) = raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\")) {
        if let Some(home) = home_directory() {
            return home.join(rest);
        }
    }
    PathBuf::from(raw)
}

fn normalize_root_path(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = expand_tilde_prefix(trimmed);
    let resolved = if path.is_absolute() {
        path
    } else {
        std::env::current_dir().ok()?.join(path)
    };
    if resolved.exists() {
        Some(resolved.canonicalize().unwrap_or(resolved))
    } else {
        None
    }
}

fn normalize_storage_root(raw: Option<&str>) -> Option<PathBuf> {
    let raw = raw?.trim();
    if raw.is_empty() {
        return None;
    }
    let path = expand_tilde_prefix(raw);
    let resolved = if path.is_absolute() {
        path
    } else {
        std::env::current_dir().ok()?.join(path)
    };
    Some(resolved.canonicalize().unwrap_or(resolved))
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    let mut deduped = Vec::new();
    for path in paths {
        let key = normalize_path_key(&path);
        if seen.insert(key) {
            deduped.push(path);
        }
    }
    deduped
}

fn resolve_scope_roots(
    scope_preset: SearchLocalScopePreset,
    custom_roots: &[String],
    project_root: Option<&str>,
) -> Vec<PathBuf> {
    let roots = match scope_preset {
        SearchLocalScopePreset::Home => home_directory().into_iter().collect(),
        SearchLocalScopePreset::FullSystem => full_system_roots(),
        SearchLocalScopePreset::Workspace => {
            if let Some(project_root) = project_root.and_then(normalize_root_path) {
                vec![project_root]
            } else {
                std::env::current_dir()
                    .ok()
                    .map(|value| vec![value])
                    .unwrap_or_default()
            }
        }
        SearchLocalScopePreset::Custom => {
            let mut resolved = custom_roots
                .iter()
                .filter_map(|path| normalize_root_path(path))
                .collect::<Vec<_>>();
            if resolved.is_empty() {
                if let Some(home) = home_directory() {
                    resolved.push(home);
                }
            }
            resolved
        }
    };
    dedupe_paths(roots)
}

fn should_use_persistent_storage(
    scope_preset: SearchLocalScopePreset,
    storage_root: Option<&str>,
) -> Option<PathBuf> {
    if scope_preset != SearchLocalScopePreset::Workspace {
        return None;
    }
    normalize_storage_root(storage_root)
}

fn engine_for_storage(
    storage_root: Option<PathBuf>,
) -> Result<Arc<core_search::LocalSearchEngine>, String> {
    let key = storage_root
        .as_ref()
        .map(|root| format!("persistent:{}", normalize_path_string(root)))
        .unwrap_or_else(|| "memory".to_string());
    if let Ok(guard) = search_engine_store().read() {
        if let Some(engine) = guard.get(&key) {
            return Ok(engine.clone());
        }
    }

    let engine = Arc::new(match storage_root {
        Some(storage_root) => {
            core_search::LocalSearchEngine::with_config(core_search::LocalSearchEngineConfig {
                storage_mode: core_search::LocalSearchStorageMode::Persistent { storage_root },
            })
        }
        None => core_search::LocalSearchEngine::new(),
    });
    let mut guard = search_engine_store()
        .write()
        .map_err(|_| "search engine state lock poisoned".to_string())?;
    Ok(guard.entry(key).or_insert_with(|| engine).clone())
}

fn engine_for_request(
    scope_preset: SearchLocalScopePreset,
    storage_root: Option<&str>,
) -> Result<Arc<core_search::LocalSearchEngine>, String> {
    engine_for_storage(should_use_persistent_storage(scope_preset, storage_root))
}

fn engine_for_status(
    storage_root: Option<&str>,
) -> Result<Arc<core_search::LocalSearchEngine>, String> {
    engine_for_storage(normalize_storage_root(storage_root))
}

fn stable_local_result_id(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("local-{:x}", hasher.finish())
}

fn file_name_from_path(path: &Path) -> String {
    path.file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| normalize_path_string(path))
}

fn extension_from_result(result: &core_search::LocalSearchResult) -> Option<String> {
    result
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.extension.clone())
        .or_else(|| {
            result
                .path
                .extension()
                .and_then(|value| value.to_str())
                .map(str::to_string)
        })
}

fn match_kind_to_legacy(kind: core_search::LocalSearchMatchKind) -> &'static str {
    match kind {
        core_search::LocalSearchMatchKind::Content => "content",
        core_search::LocalSearchMatchKind::FileName => "file_name",
        core_search::LocalSearchMatchKind::Extension => "extension",
        core_search::LocalSearchMatchKind::Fuzzy => "fuzzy",
        core_search::LocalSearchMatchKind::Initial
        | core_search::LocalSearchMatchKind::Metadata
        | core_search::LocalSearchMatchKind::Path => "path",
    }
}

fn line_for_query(path: &Path, query: &str) -> Option<u64> {
    if query.trim().is_empty() {
        return None;
    }
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > DEFAULT_TEXT_SCAN_BYTES {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    if bytes.contains(&0) {
        return None;
    }
    let text = String::from_utf8(bytes).ok()?;
    let query = query.to_lowercase();
    text.lines()
        .position(|line| line.to_lowercase().contains(&query))
        .map(|index| (index + 1) as u64)
}

fn to_search_result_item(
    result: core_search::LocalSearchResult,
    query: &str,
) -> SearchLocalResultItem {
    let path = normalize_path_string(&result.path);
    let file_name = file_name_from_path(&result.path);
    let line = if result.match_kind == core_search::LocalSearchMatchKind::Content {
        line_for_query(&result.path, query)
    } else {
        None
    };
    SearchLocalResultItem {
        id: stable_local_result_id(&path),
        path: path.clone(),
        display_path: path,
        file_name,
        extension: extension_from_result(&result),
        match_kind: match_kind_to_legacy(result.match_kind).to_string(),
        score: f64::from(result.score) / 10_000.0,
        snippet: result.snippet,
        line,
        modified_at: result.metadata.and_then(|metadata| metadata.modified_at),
    }
}

fn core_content_mode(enabled: bool) -> core_search::LocalSearchContentMode {
    if enabled {
        core_search::LocalSearchContentMode::Auto
    } else {
        core_search::LocalSearchContentMode::Disabled
    }
}

fn to_core_search_options(
    request: &SearchLocalRequest,
    roots: Vec<PathBuf>,
    limit: usize,
) -> core_search::LocalSearchOptions {
    core_search::LocalSearchOptions {
        query: request.query.trim().to_string(),
        roots,
        kinds: vec![core_search::LocalSearchKind::File],
        extensions: Vec::new(),
        limit,
        include_hidden: request.include_hidden.unwrap_or(false),
        include_vendor: false,
        respect_gitignore: true,
        content_mode: core_content_mode(
            request
                .enable_content
                .unwrap_or(DEFAULT_CONTENT_SCAN_ENABLED),
        ),
        max_file_size_bytes: DEFAULT_TEXT_SCAN_BYTES,
        enable_fuzzy: request.enable_fuzzy.unwrap_or(DEFAULT_FUZZY_ENABLED),
        enable_extension_match: request
            .enable_extension_match
            .unwrap_or(DEFAULT_EXTENSION_MATCH_ENABLED),
    }
}

fn indexed_root_statuses_for_response(
    status: core_search::LocalSearchStatus,
    roots: &[String],
) -> Vec<core_search::LocalSearchRootStatus> {
    let requested = roots
        .iter()
        .cloned()
        .collect::<std::collections::HashSet<_>>();
    let matching = status
        .roots
        .iter()
        .filter(|root| requested.contains(&normalize_path_string(&root.root)))
        .cloned()
        .collect::<Vec<_>>();
    if matching.is_empty() {
        status.roots
    } else {
        matching
    }
}

fn stats_from_core(
    engine: &core_search::LocalSearchEngine,
    response: &core_search::LocalSearchResponse,
    roots: &[String],
) -> SearchLocalStats {
    let status_roots = indexed_root_statuses_for_response(engine.status(), roots);
    let used_index = !matches!(
        response.index_state,
        core_search::LocalSearchIndexState::Empty | core_search::LocalSearchIndexState::Walker
    );
    SearchLocalStats {
        scanned_files: status_roots
            .iter()
            .map(|root| root.indexed_file_count)
            .sum::<u64>(),
        scanned_dirs: status_roots
            .iter()
            .map(|root| root.indexed_dir_count)
            .sum::<u64>(),
        content_scanned_files: status_roots
            .iter()
            .map(|root| root.indexed_content_file_count)
            .sum::<u64>(),
        matched_files: response.total_match_count as u64,
        skipped_unreadable: 0,
        skipped_binary_or_too_large: 0,
        used_index,
    }
}

fn to_search_local_response(
    request: &SearchLocalRequest,
    engine: &core_search::LocalSearchEngine,
    response: core_search::LocalSearchResponse,
    elapsed_ms: u64,
) -> SearchLocalResponse {
    let roots = response
        .roots
        .iter()
        .map(|root| normalize_path_string(root))
        .collect::<Vec<_>>();
    let stats = stats_from_core(engine, &response, &roots);
    SearchLocalResponse {
        query: response.query.clone(),
        scope_preset: request.scope_preset,
        roots,
        results: response
            .results
            .into_iter()
            .map(|result| to_search_result_item(result, &request.query))
            .collect(),
        truncated: response.truncated,
        elapsed_ms,
        stats,
    }
}

fn index_state_to_legacy(state: core_search::LocalSearchIndexState) -> SearchIndexState {
    match state {
        core_search::LocalSearchIndexState::Empty | core_search::LocalSearchIndexState::Walker => {
            SearchIndexState::Idle
        }
        core_search::LocalSearchIndexState::Indexing => SearchIndexState::Building,
        core_search::LocalSearchIndexState::Ready | core_search::LocalSearchIndexState::Partial => {
            SearchIndexState::Ready
        }
        core_search::LocalSearchIndexState::Failed => SearchIndexState::Failed,
    }
}

fn to_index_status(status: core_search::LocalSearchStatus) -> SearchIndexStatusResponse {
    let last_built_at = status
        .roots
        .iter()
        .filter_map(|root| root.last_indexed_at)
        .max()
        .map(|value| value.to_string());
    let error = status.roots.iter().find_map(|root| root.error.clone());
    let state = index_state_to_legacy(status.state);
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

fn roots_ready(status: &core_search::LocalSearchStatus, roots: &[String]) -> bool {
    if roots.is_empty() {
        return false;
    }
    let ready_roots = status
        .roots
        .iter()
        .filter(|root| {
            root.state == core_search::LocalSearchIndexState::Ready
                || root.state == core_search::LocalSearchIndexState::Partial
        })
        .map(|root| normalize_path_string(&root.root))
        .collect::<std::collections::HashSet<_>>();
    roots.iter().all(|root| ready_roots.contains(root))
}

fn prune_stream_store(streams: &mut HashMap<String, Arc<RwLock<SearchStreamState>>>) {
    if streams.len() <= STREAM_MAX_ACTIVE {
        return;
    }
    let mut removable = streams
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
    removable.sort();
    for stream_id in removable {
        if streams.len() <= STREAM_MAX_ACTIVE {
            break;
        }
        streams.remove(&stream_id);
    }
}

fn stream_is_active(stream_id: &str) -> bool {
    search_stream_store()
        .read()
        .map(|streams| streams.contains_key(stream_id))
        .unwrap_or(false)
}

pub fn search_local_json(request_json: String) -> Result<String, String> {
    let started_at = Instant::now();
    let request: SearchLocalRequest =
        serde_json::from_str(&request_json).map_err(|error| format!("invalid request: {error}"))?;
    if request.query.trim().is_empty() {
        return Err("query is required".to_string());
    }
    let roots = resolve_scope_roots(
        request.scope_preset,
        &request.custom_roots,
        request.project_root.as_deref(),
    );
    if roots.is_empty() {
        return Err("resolved search roots are empty".to_string());
    }
    let engine = engine_for_request(request.scope_preset, request.storage_root.as_deref())?;
    let options = to_core_search_options(&request, roots, clamp_limit(request.limit));
    let response = engine
        .search(options, None)
        .map_err(|error| format!("local search failed: {error}"))?;
    let response = to_search_local_response(
        &request,
        &engine,
        response,
        started_at.elapsed().as_millis() as u64,
    );
    serde_json::to_string(&response).map_err(|error| format!("serialize response failed: {error}"))
}

fn run_search_local_stream_worker(
    stream_id: String,
    stream_state: Arc<RwLock<SearchStreamState>>,
    request: SearchLocalRequest,
    roots: Vec<PathBuf>,
    limit: usize,
    engine: Arc<core_search::LocalSearchEngine>,
    cancel_flag: Arc<AtomicBool>,
) {
    let started_at = Instant::now();
    let options = to_core_search_options(&request, roots, limit);
    let result = engine.search(options, Some(cancel_flag.clone()));
    if cancel_flag.load(Ordering::Relaxed) || !stream_is_active(&stream_id) {
        return;
    }

    let (payload, error) = match result {
        Ok(response) => (
            to_search_local_response(
                &request,
                &engine,
                response,
                started_at.elapsed().as_millis() as u64,
            ),
            None,
        ),
        Err(error) => {
            let roots = resolve_scope_roots(
                request.scope_preset,
                &request.custom_roots,
                request.project_root.as_deref(),
            )
            .iter()
            .map(|root| normalize_path_string(root))
            .collect::<Vec<_>>();
            (
                SearchLocalResponse {
                    query: request.query.clone(),
                    scope_preset: request.scope_preset,
                    roots,
                    results: Vec::new(),
                    truncated: false,
                    elapsed_ms: started_at.elapsed().as_millis() as u64,
                    stats: SearchLocalStats {
                        scanned_files: 0,
                        scanned_dirs: 0,
                        content_scanned_files: 0,
                        matched_files: 0,
                        skipped_unreadable: 0,
                        skipped_binary_or_too_large: 0,
                        used_index: false,
                    },
                },
                Some(error.to_string()),
            )
        }
    };

    if let Ok(mut guard) = stream_state.write() {
        guard.snapshot.results = payload.results;
        guard.snapshot.truncated = payload.truncated;
        guard.snapshot.elapsed_ms = payload.elapsed_ms;
        guard.snapshot.stats = payload.stats;
        guard.snapshot.done = true;
        guard.snapshot.error = error;
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
    let roots = resolve_scope_roots(
        request.scope_preset,
        &request.custom_roots,
        request.project_root.as_deref(),
    );
    let root_paths = roots
        .iter()
        .map(|value| normalize_path_string(value))
        .collect::<Vec<_>>();
    if root_paths.is_empty() {
        return Err("resolved search roots are empty".to_string());
    }
    let engine = engine_for_request(request.scope_preset, request.storage_root.as_deref())?;
    let stream_id = format!("search-stream-{}", Uuid::new_v4());
    let cancel_flag = Arc::new(AtomicBool::new(false));
    let stream_state = Arc::new(RwLock::new(SearchStreamState {
        snapshot: SearchLocalStreamReadResponse {
            stream_id: stream_id.clone(),
            query: query.clone(),
            scope_preset: request.scope_preset,
            roots: root_paths.clone(),
            results: Vec::new(),
            truncated: false,
            elapsed_ms: 0,
            stats: SearchLocalStats {
                scanned_files: 0,
                scanned_dirs: 0,
                content_scanned_files: 0,
                matched_files: 0,
                skipped_unreadable: 0,
                skipped_binary_or_too_large: 0,
                used_index: false,
            },
            done: false,
            error: None,
        },
        cancel_flag: cancel_flag.clone(),
    }));
    {
        let mut streams = search_stream_store()
            .write()
            .map_err(|_| "search stream state lock poisoned".to_string())?;
        prune_stream_store(&mut streams);
        streams.insert(stream_id.clone(), stream_state.clone());
    }

    let worker_stream_id = stream_id.clone();
    let scope_preset = request.scope_preset;
    std::thread::spawn(move || {
        run_search_local_stream_worker(
            worker_stream_id,
            stream_state,
            request,
            roots,
            limit,
            engine,
            cancel_flag,
        );
    });

    let response = SearchLocalStreamStartResponse {
        stream_id,
        query,
        scope_preset,
        roots: root_paths,
    };
    serde_json::to_string(&response).map_err(|error| format!("serialize response failed: {error}"))
}

pub fn search_local_stream_read_json(request_json: String) -> Result<String, String> {
    let request: SearchLocalStreamReadRequest =
        serde_json::from_str(&request_json).map_err(|error| format!("invalid request: {error}"))?;
    if request.stream_id.trim().is_empty() {
        return Err("streamId is required".to_string());
    }

    let stream_state = {
        let streams = search_stream_store()
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

    let removed = search_stream_store()
        .write()
        .map_err(|_| "search stream state lock poisoned".to_string())?
        .remove(request.stream_id.as_str());
    if let Some(stream_state) = &removed {
        if let Ok(guard) = stream_state.read() {
            guard.cancel_flag.store(true, Ordering::Relaxed);
        }
    }
    let response = SearchLocalStreamCancelResponse {
        removed: removed.is_some(),
    };
    serde_json::to_string(&response).map_err(|error| format!("serialize response failed: {error}"))
}

pub fn rebuild_search_index_json(request_json: String) -> Result<String, String> {
    let request: SearchRebuildIndexRequest =
        serde_json::from_str(&request_json).map_err(|error| format!("invalid request: {error}"))?;
    let include_hidden = request.include_hidden.unwrap_or(false);
    let force_rebuild = request.force.unwrap_or(false);
    let roots = resolve_scope_roots(
        request.scope_preset,
        &request.custom_roots,
        request.project_root.as_deref(),
    );
    let root_paths = roots
        .iter()
        .map(|value| normalize_path_string(value))
        .collect::<Vec<_>>();
    if root_paths.is_empty() {
        return Err("resolved index roots are empty".to_string());
    }
    let engine = engine_for_request(request.scope_preset, request.storage_root.as_deref())?;
    if !force_rebuild {
        let status = engine.status();
        if roots_ready(&status, &root_paths) {
            let response = SearchRebuildIndexResponse {
                status: to_index_status(status),
                scope_preset: request.scope_preset,
                roots: root_paths,
            };
            return serde_json::to_string(&response)
                .map_err(|error| format!("serialize response failed: {error}"));
        }
    }

    for root in roots {
        engine
            .index_root(
                core_search::LocalSearchIndexRootOptions {
                    root,
                    include_hidden,
                    include_vendor: false,
                    respect_gitignore: true,
                    content_mode: core_search::LocalSearchContentMode::Auto,
                    max_file_size_bytes: DEFAULT_TEXT_SCAN_BYTES,
                },
                None,
            )
            .map_err(|error| format!("search index rebuild failed: {error}"))?;
    }
    let response = SearchRebuildIndexResponse {
        status: to_index_status(engine.status()),
        scope_preset: request.scope_preset,
        roots: root_paths,
    };
    serde_json::to_string(&response).map_err(|error| format!("serialize response failed: {error}"))
}

pub fn read_search_index_status_json(request_json: String) -> Result<String, String> {
    let request: SearchIndexStatusRequest = serde_json::from_str(&request_json)
        .unwrap_or(SearchIndexStatusRequest { storage_root: None });
    let engine = engine_for_status(request.storage_root.as_deref())?;
    serde_json::to_string(&to_index_status(engine.status()))
        .map_err(|error| format!("serialize response failed: {error}"))
}

#[allow(dead_code)]
pub fn read_status() -> &'static str {
    "fs:ok"
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::fs::{self, File};
    use std::io::Write;
    use uuid::Uuid;

    fn create_temp_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!("lyrad-search-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    fn write_text_file(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        let mut file = File::create(path).expect("create file");
        file.write_all(content.as_bytes()).expect("write file");
    }

    fn parse_json_object(payload: &str) -> serde_json::Map<String, Value> {
        serde_json::from_str::<Value>(payload)
            .expect("valid json")
            .as_object()
            .cloned()
            .expect("json object")
    }

    #[test]
    fn search_local_matches_file_name_extension_and_content() {
        let root = create_temp_root();
        let alpha_path = root.join("alpha.txt");
        let ts_path = root.join("src/app.ts");
        let notes_path = root.join("notes.md");
        write_text_file(&alpha_path, "Hello Lyra Search\nSecond line");
        write_text_file(&ts_path, "export const app = 1;");
        write_text_file(&notes_path, "misc text");

        let file_name_request = serde_json::json!({
            "query": "alpha",
            "limit": 10,
            "scopePreset": "custom",
            "customRoots": [normalize_path_string(&root)],
            "enableContent": false
        });
        let file_name_response =
            search_local_json(file_name_request.to_string()).expect("search file name");
        let file_name_object = parse_json_object(&file_name_response);
        let file_name_results = file_name_object
            .get("results")
            .and_then(Value::as_array)
            .expect("results array");
        assert!(file_name_results.iter().any(|entry| {
            entry
                .get("fileName")
                .and_then(Value::as_str)
                .map(|value| value == "alpha.txt")
                .unwrap_or(false)
        }));

        let extension_request = serde_json::json!({
            "query": "ext:ts",
            "limit": 10,
            "scopePreset": "custom",
            "customRoots": [normalize_path_string(&root)],
            "enableContent": false
        });
        let extension_response =
            search_local_json(extension_request.to_string()).expect("search extension");
        let extension_object = parse_json_object(&extension_response);
        let extension_results = extension_object
            .get("results")
            .and_then(Value::as_array)
            .expect("results array");
        assert!(extension_results.iter().any(|entry| {
            let file_name_matches = entry
                .get("fileName")
                .and_then(Value::as_str)
                .map(|value| value == "app.ts")
                .unwrap_or(false);
            let match_kind_is_extension = entry
                .get("matchKind")
                .and_then(Value::as_str)
                .map(|value| value == "extension")
                .unwrap_or(false);
            file_name_matches && match_kind_is_extension
        }));

        let content_request = serde_json::json!({
            "query": "lyra search",
            "limit": 10,
            "scopePreset": "custom",
            "customRoots": [normalize_path_string(&root)],
            "enableContent": true
        });
        let content_response =
            search_local_json(content_request.to_string()).expect("search content");
        let content_object = parse_json_object(&content_response);
        let content_results = content_object
            .get("results")
            .and_then(Value::as_array)
            .expect("results array");
        assert!(content_results.iter().any(|entry| {
            let file_name_matches = entry
                .get("fileName")
                .and_then(Value::as_str)
                .map(|value| value == "alpha.txt")
                .unwrap_or(false);
            let snippet_matches = entry
                .get("snippet")
                .and_then(Value::as_str)
                .map(|value| value.to_lowercase().contains("lyra search"))
                .unwrap_or(false);
            file_name_matches && snippet_matches
        }));

        fs::remove_dir_all(root).expect("cleanup temp root");
    }

    #[test]
    fn rebuild_index_updates_status() {
        let root = create_temp_root();
        write_text_file(&root.join("indexable.txt"), "index me");

        let rebuild_request = serde_json::json!({
            "scopePreset": "custom",
            "customRoots": [normalize_path_string(&root)]
        });
        let rebuild_response =
            rebuild_search_index_json(rebuild_request.to_string()).expect("rebuild index");
        let rebuild_object = parse_json_object(&rebuild_response);
        let status = rebuild_object
            .get("status")
            .and_then(Value::as_object)
            .expect("status object");
        assert_eq!(status.get("state").and_then(Value::as_str), Some("ready"));
        assert!(
            status
                .get("indexedFiles")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                >= 1
        );

        let status_response = read_search_index_status_json("{}".to_string()).expect("read status");
        let status_object = parse_json_object(&status_response);
        assert_eq!(
            status_object.get("state").and_then(Value::as_str),
            Some("ready")
        );

        fs::remove_dir_all(root).expect("cleanup temp root");
    }

    #[test]
    fn workspace_index_uses_persistent_storage_root() {
        let root = create_temp_root();
        let storage_root = create_temp_root();
        write_text_file(&root.join("persisted.txt"), "index me");

        let rebuild_request = serde_json::json!({
            "scopePreset": "workspace",
            "projectRoot": normalize_path_string(&root),
            "storageRoot": normalize_path_string(&storage_root),
            "force": true
        });
        rebuild_search_index_json(rebuild_request.to_string()).expect("rebuild index");

        assert!(storage_root.join("local-search/index.v1.sqlite").exists());

        let search_request = serde_json::json!({
            "query": "persisted",
            "limit": 10,
            "scopePreset": "workspace",
            "projectRoot": normalize_path_string(&root),
            "storageRoot": normalize_path_string(&storage_root),
            "enableContent": false
        });
        let search_response =
            search_local_json(search_request.to_string()).expect("search persistent index");
        let search_object = parse_json_object(&search_response);
        let stats = search_object
            .get("stats")
            .and_then(Value::as_object)
            .expect("stats object");
        assert_eq!(stats.get("usedIndex").and_then(Value::as_bool), Some(true));

        fs::remove_dir_all(root).expect("cleanup temp root");
        fs::remove_dir_all(storage_root).expect("cleanup storage root");
    }

    #[test]
    fn local_search_stream_returns_incremental_snapshot_and_can_cancel() {
        let root = create_temp_root();
        write_text_file(&root.join("alpha.txt"), "alpha local stream");
        write_text_file(&root.join("beta.txt"), "beta content");

        let start_request = serde_json::json!({
            "query": "alpha",
            "limit": 20,
            "scopePreset": "custom",
            "customRoots": [normalize_path_string(&root)],
            "enableContent": false
        });
        let start_response =
            search_local_stream_start_json(start_request.to_string()).expect("start stream");
        let start_object = parse_json_object(&start_response);
        let stream_id = start_object
            .get("streamId")
            .and_then(Value::as_str)
            .expect("stream id")
            .to_string();

        let mut reached_done = false;
        let mut saw_alpha = false;
        for _ in 0..120 {
            let read_request = serde_json::json!({
                "streamId": stream_id,
                "limit": 20
            });
            let read_response = search_local_stream_read_json(read_request.to_string())
                .expect("read stream snapshot");
            let read_object = parse_json_object(&read_response);
            let results = read_object
                .get("results")
                .and_then(Value::as_array)
                .expect("results array");
            if results.iter().any(|entry| {
                entry
                    .get("fileName")
                    .and_then(Value::as_str)
                    .map(|value| value == "alpha.txt")
                    .unwrap_or(false)
            }) {
                saw_alpha = true;
            }
            reached_done = read_object
                .get("done")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if reached_done {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(saw_alpha, "stream snapshots should include alpha.txt");
        assert!(reached_done, "stream should finish within polling window");

        let cancel_request = serde_json::json!({
            "streamId": stream_id
        });
        let cancel_response =
            search_local_stream_cancel_json(cancel_request.to_string()).expect("cancel stream");
        let cancel_object = parse_json_object(&cancel_response);
        assert_eq!(
            cancel_object.get("removed").and_then(Value::as_bool),
            Some(true)
        );

        let read_after_cancel = search_local_stream_read_json(cancel_request.to_string());
        assert!(
            read_after_cancel.is_err(),
            "cancelled stream should no longer be readable"
        );

        fs::remove_dir_all(root).expect("cleanup temp root");
    }
}
