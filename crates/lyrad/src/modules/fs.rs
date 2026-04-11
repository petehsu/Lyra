use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const DEFAULT_RESULT_LIMIT: usize = 48;
const MAX_RESULT_LIMIT: usize = 300;
const DEFAULT_CONTENT_SCAN_ENABLED: bool = true;
const DEFAULT_FUZZY_ENABLED: bool = true;
const DEFAULT_EXTENSION_MATCH_ENABLED: bool = true;
const MAX_TEXT_SCAN_BYTES: u64 = 1_000_000;
const MAX_CONTENT_SCAN_FILES: usize = 4_000;
const INDEX_MAX_FILES: usize = 250_000;
const STREAM_RESULT_LIMIT_DEFAULT: usize = 120;
const STREAM_EMIT_BATCH_SIZE: usize = 160;
const STREAM_MAX_ACTIVE: usize = 64;
const STREAM_CONTENT_SCAN_TARGET_MULTIPLIER: u64 = 4;
const SKIP_DIRECTORY_NAMES: [&str; 8] = [
    ".git",
    "node_modules",
    "dist",
    "build",
    "target",
    ".cache",
    "coverage",
    ".turbo",
];

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

#[derive(Debug, Clone)]
struct SearchMetadataEntry {
    path: String,
    file_name: String,
    extension: Option<String>,
    lower_path: String,
    lower_file_name: String,
    lower_extension: Option<String>,
    modified_at: Option<u64>,
    size_bytes: u64,
}

#[derive(Debug, Clone)]
struct MetadataCollectionResult {
    entries: Vec<SearchMetadataEntry>,
    scanned_files: u64,
    scanned_dirs: u64,
    skipped_unreadable: u64,
    truncated: bool,
}

#[derive(Debug, Clone)]
struct SearchIndexStore {
    status: SearchIndexStatusResponse,
    scope_preset: SearchLocalScopePreset,
    include_hidden: bool,
    roots: Vec<String>,
    entries: Vec<SearchMetadataEntry>,
}

impl Default for SearchIndexStore {
    fn default() -> Self {
        Self {
            status: SearchIndexStatusResponse {
                state: SearchIndexState::Idle,
                indexed_files: 0,
                indexed_dirs: 0,
                last_built_at: None,
                progress: None,
                error: None,
            },
            scope_preset: SearchLocalScopePreset::Home,
            include_hidden: false,
            roots: Vec::new(),
            entries: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
struct SearchStreamState {
    snapshot: SearchLocalStreamReadResponse,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MatchKind {
    Content,
    FileName,
    Extension,
    Path,
    Fuzzy,
}

impl MatchKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Content => "content",
            Self::FileName => "file_name",
            Self::Extension => "extension",
            Self::Path => "path",
            Self::Fuzzy => "fuzzy",
        }
    }
}

#[derive(Debug, Clone)]
struct CandidateMatch {
    path: String,
    file_name: String,
    extension: Option<String>,
    modified_at: Option<u64>,
    match_kind: MatchKind,
    score: f64,
    snippet: Option<String>,
    line: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ContentScanOutcome {
    Hit,
    Miss,
    Unreadable,
    BinaryOrTooLarge,
}

static SEARCH_INDEX: OnceLock<RwLock<SearchIndexStore>> = OnceLock::new();
static SEARCH_STREAMS: OnceLock<RwLock<HashMap<String, Arc<RwLock<SearchStreamState>>>>> =
    OnceLock::new();

fn search_index_store() -> &'static RwLock<SearchIndexStore> {
    SEARCH_INDEX.get_or_init(|| RwLock::new(SearchIndexStore::default()))
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

fn unix_seconds_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
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

fn should_skip_directory(name: &str, include_hidden: bool) -> bool {
    if name.is_empty() {
        return true;
    }
    if include_hidden == false && name.starts_with('.') {
        return true;
    }
    SKIP_DIRECTORY_NAMES.contains(&name)
}

fn should_skip_file(name: &str, include_hidden: bool) -> bool {
    if name.is_empty() {
        return true;
    }
    if include_hidden == false && name.starts_with('.') {
        return true;
    }
    false
}

fn to_metadata_entry(path: &Path) -> Option<SearchMetadataEntry> {
    let metadata = fs::metadata(path).ok()?;
    if metadata.is_file() == false {
        return None;
    }
    let path_string = normalize_path_string(path);
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| path_string.clone());
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| value.is_empty() == false);
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_secs());

    Some(SearchMetadataEntry {
        path: path_string.clone(),
        file_name: file_name.clone(),
        extension: extension.clone(),
        lower_path: path_string.to_lowercase(),
        lower_file_name: file_name.to_lowercase(),
        lower_extension: extension.as_ref().map(|value| value.to_lowercase()),
        modified_at,
        size_bytes: metadata.len(),
    })
}

fn collect_metadata_entries(
    roots: &[PathBuf],
    include_hidden: bool,
    max_files: usize,
) -> MetadataCollectionResult {
    let mut entries = Vec::new();
    let mut stack = Vec::new();
    let mut scanned_files = 0_u64;
    let mut scanned_dirs = 0_u64;
    let mut skipped_unreadable = 0_u64;
    let mut truncated = false;

    for root in roots {
        let metadata = match fs::symlink_metadata(root) {
            Ok(metadata) => metadata,
            Err(_) => {
                skipped_unreadable += 1;
                continue;
            }
        };
        if metadata.is_file() {
            scanned_files += 1;
            if let Some(entry) = to_metadata_entry(root) {
                entries.push(entry);
            }
            if entries.len() >= max_files {
                truncated = true;
                break;
            }
            continue;
        }
        if metadata.is_dir() {
            stack.push(root.clone());
        }
    }

    while let Some(directory_path) = stack.pop() {
        scanned_dirs += 1;
        let directory = match fs::read_dir(&directory_path) {
            Ok(directory) => directory,
            Err(_) => {
                skipped_unreadable += 1;
                continue;
            }
        };

        for entry_result in directory {
            let entry = match entry_result {
                Ok(entry) => entry,
                Err(_) => {
                    skipped_unreadable += 1;
                    continue;
                }
            };
            let entry_path = entry.path();
            let file_name = entry.file_name().to_string_lossy().to_string();
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => {
                    skipped_unreadable += 1;
                    continue;
                }
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                if should_skip_directory(&file_name, include_hidden) {
                    continue;
                }
                stack.push(entry_path);
                continue;
            }
            if file_type.is_file() {
                if should_skip_file(&file_name, include_hidden) {
                    continue;
                }
                scanned_files += 1;
                if let Some(metadata_entry) = to_metadata_entry(&entry_path) {
                    entries.push(metadata_entry);
                }
                if entries.len() >= max_files {
                    truncated = true;
                    break;
                }
            }
        }

        if truncated {
            break;
        }
    }

    MetadataCollectionResult {
        entries,
        scanned_files,
        scanned_dirs,
        skipped_unreadable,
        truncated,
    }
}

fn parse_extension_query(query_lower: &str) -> Option<String> {
    if let Some(value) = query_lower.strip_prefix("ext:") {
        let normalized = value.trim().trim_start_matches('.');
        if normalized.is_empty() {
            return None;
        }
        return Some(normalized.to_string());
    }
    if query_lower.starts_with('.') && query_lower.contains(char::is_whitespace) == false {
        let normalized = query_lower.trim_start_matches('.');
        if normalized.is_empty() {
            return None;
        }
        return Some(normalized.to_string());
    }
    None
}

fn stable_local_result_id(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("local-{:x}", hasher.finish())
}

fn subsequence_fuzzy_score(haystack: &str, needle: &str) -> Option<f64> {
    if haystack.is_empty() || needle.is_empty() {
        return None;
    }
    let mut score = 0.0;
    let mut cursor = 0_usize;
    let haystack_chars = haystack.chars().collect::<Vec<_>>();
    let needle_chars = needle.chars().collect::<Vec<_>>();
    for needle_char in needle_chars.iter() {
        let mut matched = false;
        for index in cursor..haystack_chars.len() {
            if &haystack_chars[index] == needle_char {
                let gap = index.saturating_sub(cursor);
                score += if gap == 0 {
                    1.8
                } else {
                    1.0 / (gap as f64 + 1.0)
                };
                cursor = index + 1;
                matched = true;
                break;
            }
        }
        if matched == false {
            return None;
        }
    }
    Some(score / needle_chars.len() as f64)
}

fn update_candidate(
    map: &mut HashMap<String, CandidateMatch>,
    entry: &SearchMetadataEntry,
    match_kind: MatchKind,
    score: f64,
    snippet: Option<String>,
    line: Option<u64>,
) {
    let next = CandidateMatch {
        path: entry.path.clone(),
        file_name: entry.file_name.clone(),
        extension: entry.extension.clone(),
        modified_at: entry.modified_at,
        match_kind,
        score,
        snippet,
        line,
    };

    let key = entry.path.clone();
    if let Some(current) = map.get_mut(&key) {
        if score > current.score {
            *current = next;
            return;
        }
        if current.snippet.is_none() && next.snippet.is_some() {
            current.snippet = next.snippet;
            current.line = next.line;
            if match_kind == MatchKind::Content {
                current.match_kind = MatchKind::Content;
            }
        }
        return;
    }
    map.insert(key, next);
}

fn merge_candidate(map: &mut HashMap<String, CandidateMatch>, next: CandidateMatch) {
    let key = next.path.clone();
    if let Some(current) = map.get_mut(&key) {
        if next.score > current.score {
            *current = next;
            return;
        }
        if current.snippet.is_none() && next.snippet.is_some() {
            current.snippet = next.snippet;
            current.line = next.line;
            if next.match_kind == MatchKind::Content {
                current.match_kind = MatchKind::Content;
            }
        }
        return;
    }
    map.insert(key, next);
}

fn consider_best_candidate(best: &mut Option<CandidateMatch>, next: CandidateMatch) {
    if let Some(current) = best {
        if next.score > current.score {
            *current = next;
            return;
        }
        if current.snippet.is_none() && next.snippet.is_some() {
            current.snippet = next.snippet;
            current.line = next.line;
            if next.match_kind == MatchKind::Content {
                current.match_kind = MatchKind::Content;
            }
        }
        return;
    }
    *best = Some(next);
}

fn candidate_rank_order(left: &CandidateMatch, right: &CandidateMatch) -> Ordering {
    let score_order = right
        .score
        .partial_cmp(&left.score)
        .unwrap_or(Ordering::Equal);
    if score_order != Ordering::Equal {
        return score_order;
    }
    let name_order = left
        .file_name
        .to_lowercase()
        .cmp(&right.file_name.to_lowercase());
    if name_order != Ordering::Equal {
        return name_order;
    }
    left.path.to_lowercase().cmp(&right.path.to_lowercase())
}

fn clip_snippet(line: &str, max_chars: usize) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    trimmed.chars().take(max_chars).collect::<String>() + "..."
}

fn scan_content_for_query(
    file_path: &str,
    query_lower: &str,
) -> (ContentScanOutcome, Option<String>, Option<u64>) {
    let metadata = match fs::metadata(file_path) {
        Ok(metadata) => metadata,
        Err(_) => return (ContentScanOutcome::Unreadable, None, None),
    };
    if metadata.is_file() == false || metadata.len() > MAX_TEXT_SCAN_BYTES {
        return (ContentScanOutcome::BinaryOrTooLarge, None, None);
    }
    let bytes = match fs::read(file_path) {
        Ok(bytes) => bytes,
        Err(_) => return (ContentScanOutcome::Unreadable, None, None),
    };
    if bytes.iter().any(|byte| *byte == 0) {
        return (ContentScanOutcome::BinaryOrTooLarge, None, None);
    }
    let text = match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(_) => return (ContentScanOutcome::BinaryOrTooLarge, None, None),
    };
    for (index, line) in text.lines().enumerate() {
        if line.to_lowercase().contains(query_lower) {
            return (
                ContentScanOutcome::Hit,
                Some(clip_snippet(line, 220)),
                Some((index + 1) as u64),
            );
        }
    }
    (ContentScanOutcome::Miss, None, None)
}

fn apply_metadata_matching(
    candidates: &mut HashMap<String, CandidateMatch>,
    entries: &[SearchMetadataEntry],
    query_lower: &str,
    extension_query: Option<&str>,
    enable_fuzzy: bool,
    enable_extension_match: bool,
) {
    for entry in entries {
        if entry.lower_file_name.contains(query_lower) {
            let score = 120.0
                + (query_lower.len().min(entry.lower_file_name.len()) as f64
                    / entry.lower_file_name.len().max(1) as f64);
            update_candidate(candidates, entry, MatchKind::FileName, score, None, None);
        }
        if entry.lower_path.contains(query_lower) {
            let score = 85.0
                + (query_lower.len().min(entry.lower_path.len()) as f64
                    / entry.lower_path.len().max(1) as f64);
            update_candidate(candidates, entry, MatchKind::Path, score, None, None);
        }
        if enable_extension_match {
            if let Some(extension_query) = extension_query {
                if entry
                    .lower_extension
                    .as_ref()
                    .map(|value| value == extension_query)
                    .unwrap_or(false)
                {
                    update_candidate(candidates, entry, MatchKind::Extension, 102.0, None, None);
                }
            }
        }
        if enable_fuzzy {
            if let Some(score) = subsequence_fuzzy_score(&entry.lower_file_name, query_lower) {
                if score > 0.35 {
                    update_candidate(
                        candidates,
                        entry,
                        MatchKind::Fuzzy,
                        60.0 + score * 40.0,
                        None,
                        None,
                    );
                    continue;
                }
            }
            if let Some(score) = subsequence_fuzzy_score(&entry.lower_path, query_lower) {
                if score > 0.30 {
                    update_candidate(
                        candidates,
                        entry,
                        MatchKind::Fuzzy,
                        52.0 + score * 34.0,
                        None,
                        None,
                    );
                }
            }
        }
    }
}

fn apply_content_matching(
    candidates: &mut HashMap<String, CandidateMatch>,
    entries: &[SearchMetadataEntry],
    query_lower: &str,
    stats: &mut SearchLocalStats,
) {
    let mut scanned = 0_usize;
    for entry in entries {
        if scanned >= MAX_CONTENT_SCAN_FILES {
            break;
        }
        scanned += 1;
        if entry.size_bytes > MAX_TEXT_SCAN_BYTES {
            stats.skipped_binary_or_too_large += 1;
            continue;
        }
        stats.content_scanned_files += 1;
        let (outcome, snippet, line) = scan_content_for_query(&entry.path, query_lower);
        match outcome {
            ContentScanOutcome::Hit => {
                let bonus = if let Some(existing) = candidates.get(&entry.path) {
                    existing.score.max(130.0) + 25.0
                } else {
                    130.0
                };
                update_candidate(candidates, entry, MatchKind::Content, bonus, snippet, line);
            }
            ContentScanOutcome::Unreadable => {
                stats.skipped_unreadable += 1;
            }
            ContentScanOutcome::BinaryOrTooLarge => {
                stats.skipped_binary_or_too_large += 1;
            }
            ContentScanOutcome::Miss => {}
        }
    }
}

fn find_matches(
    entries: &[SearchMetadataEntry],
    query: &str,
    enable_fuzzy: bool,
    enable_content: bool,
    enable_extension_match: bool,
    stats: &mut SearchLocalStats,
) -> Vec<CandidateMatch> {
    let query_lower = query.to_lowercase();
    let extension_query = parse_extension_query(&query_lower);
    let mut candidates = HashMap::<String, CandidateMatch>::new();

    apply_metadata_matching(
        &mut candidates,
        entries,
        &query_lower,
        extension_query.as_deref(),
        enable_fuzzy,
        enable_extension_match,
    );

    if enable_content {
        apply_content_matching(&mut candidates, entries, &query_lower, stats);
    }

    let mut values = candidates.into_values().collect::<Vec<_>>();
    values.sort_by(candidate_rank_order);
    values
}

fn to_search_results(
    matches: Vec<CandidateMatch>,
    limit: usize,
) -> (Vec<SearchLocalResultItem>, bool) {
    let truncated = matches.len() > limit;
    let results = matches
        .into_iter()
        .take(limit)
        .map(|item| SearchLocalResultItem {
            id: stable_local_result_id(&item.path),
            path: item.path.clone(),
            display_path: item.path,
            file_name: item.file_name,
            extension: item.extension,
            match_kind: item.match_kind.as_str().to_string(),
            score: (item.score * 100.0).round() / 100.0,
            snippet: item.snippet,
            line: item.line,
            modified_at: item.modified_at,
        })
        .collect::<Vec<_>>();
    (results, truncated)
}

#[derive(Debug, Clone)]
struct ProcessedEntryResult {
    candidate: Option<CandidateMatch>,
    content_scanned_files: u64,
    skipped_unreadable: u64,
    skipped_binary_or_too_large: u64,
}

fn try_consume_content_budget(budget: &AtomicUsize) -> bool {
    let mut current = budget.load(AtomicOrdering::Relaxed);
    loop {
        if current == 0 {
            return false;
        }
        match budget.compare_exchange_weak(
            current,
            current - 1,
            AtomicOrdering::SeqCst,
            AtomicOrdering::Relaxed,
        ) {
            Ok(_) => return true,
            Err(next) => current = next,
        }
    }
}

fn evaluate_entry_for_query(
    entry: &SearchMetadataEntry,
    query_lower: &str,
    extension_query: Option<&str>,
    enable_fuzzy: bool,
    enable_content: bool,
    enable_extension_match: bool,
    content_budget: &AtomicUsize,
) -> ProcessedEntryResult {
    let mut best: Option<CandidateMatch> = None;

    if entry.lower_file_name.contains(query_lower) {
        let score = 120.0
            + (query_lower.len().min(entry.lower_file_name.len()) as f64
                / entry.lower_file_name.len().max(1) as f64);
        consider_best_candidate(
            &mut best,
            CandidateMatch {
                path: entry.path.clone(),
                file_name: entry.file_name.clone(),
                extension: entry.extension.clone(),
                modified_at: entry.modified_at,
                match_kind: MatchKind::FileName,
                score,
                snippet: None,
                line: None,
            },
        );
    }
    if entry.lower_path.contains(query_lower) {
        let score = 85.0
            + (query_lower.len().min(entry.lower_path.len()) as f64
                / entry.lower_path.len().max(1) as f64);
        consider_best_candidate(
            &mut best,
            CandidateMatch {
                path: entry.path.clone(),
                file_name: entry.file_name.clone(),
                extension: entry.extension.clone(),
                modified_at: entry.modified_at,
                match_kind: MatchKind::Path,
                score,
                snippet: None,
                line: None,
            },
        );
    }
    if enable_extension_match {
        if let Some(extension_query) = extension_query {
            if entry
                .lower_extension
                .as_ref()
                .map(|value| value == extension_query)
                .unwrap_or(false)
            {
                consider_best_candidate(
                    &mut best,
                    CandidateMatch {
                        path: entry.path.clone(),
                        file_name: entry.file_name.clone(),
                        extension: entry.extension.clone(),
                        modified_at: entry.modified_at,
                        match_kind: MatchKind::Extension,
                        score: 102.0,
                        snippet: None,
                        line: None,
                    },
                );
            }
        }
    }
    if enable_fuzzy {
        if let Some(score) = subsequence_fuzzy_score(&entry.lower_file_name, query_lower) {
            if score > 0.35 {
                consider_best_candidate(
                    &mut best,
                    CandidateMatch {
                        path: entry.path.clone(),
                        file_name: entry.file_name.clone(),
                        extension: entry.extension.clone(),
                        modified_at: entry.modified_at,
                        match_kind: MatchKind::Fuzzy,
                        score: 60.0 + score * 40.0,
                        snippet: None,
                        line: None,
                    },
                );
            }
        }
        if let Some(score) = subsequence_fuzzy_score(&entry.lower_path, query_lower) {
            if score > 0.30 {
                consider_best_candidate(
                    &mut best,
                    CandidateMatch {
                        path: entry.path.clone(),
                        file_name: entry.file_name.clone(),
                        extension: entry.extension.clone(),
                        modified_at: entry.modified_at,
                        match_kind: MatchKind::Fuzzy,
                        score: 52.0 + score * 34.0,
                        snippet: None,
                        line: None,
                    },
                );
            }
        }
    }

    let mut content_scanned_files = 0_u64;
    let mut skipped_unreadable = 0_u64;
    let mut skipped_binary_or_too_large = 0_u64;
    if enable_content {
        if entry.size_bytes > MAX_TEXT_SCAN_BYTES {
            skipped_binary_or_too_large += 1;
        } else if try_consume_content_budget(content_budget) {
            content_scanned_files += 1;
            let (outcome, snippet, line) = scan_content_for_query(&entry.path, query_lower);
            match outcome {
                ContentScanOutcome::Hit => {
                    let boosted = if let Some(existing) = &best {
                        existing.score.max(130.0) + 25.0
                    } else {
                        130.0
                    };
                    consider_best_candidate(
                        &mut best,
                        CandidateMatch {
                            path: entry.path.clone(),
                            file_name: entry.file_name.clone(),
                            extension: entry.extension.clone(),
                            modified_at: entry.modified_at,
                            match_kind: MatchKind::Content,
                            score: boosted,
                            snippet,
                            line,
                        },
                    );
                }
                ContentScanOutcome::Unreadable => {
                    skipped_unreadable += 1;
                }
                ContentScanOutcome::BinaryOrTooLarge => {
                    skipped_binary_or_too_large += 1;
                }
                ContentScanOutcome::Miss => {}
            }
        }
    }

    ProcessedEntryResult {
        candidate: best,
        content_scanned_files,
        skipped_unreadable,
        skipped_binary_or_too_large,
    }
}

fn process_entry_batch_parallel(
    entries: &[SearchMetadataEntry],
    query_lower: &str,
    extension_query: Option<&str>,
    enable_fuzzy: bool,
    enable_content: bool,
    enable_extension_match: bool,
    content_budget: &AtomicUsize,
) -> Vec<ProcessedEntryResult> {
    entries
        .par_iter()
        .map(|entry| {
            evaluate_entry_for_query(
                entry,
                query_lower,
                extension_query,
                enable_fuzzy,
                enable_content,
                enable_extension_match,
                content_budget,
            )
        })
        .collect::<Vec<_>>()
}

fn top_candidates(
    candidates: &HashMap<String, CandidateMatch>,
    limit: usize,
) -> (Vec<CandidateMatch>, bool, u64) {
    let mut values = candidates.values().cloned().collect::<Vec<_>>();
    let matched_files = values.len() as u64;
    if values.len() <= limit {
        values.sort_by(candidate_rank_order);
        return (values, false, matched_files);
    }
    values.select_nth_unstable_by(limit, candidate_rank_order);
    let mut top = values.into_iter().take(limit).collect::<Vec<_>>();
    top.sort_by(candidate_rank_order);
    (top, true, matched_files)
}

fn to_stream_snapshot_results(
    candidates: &HashMap<String, CandidateMatch>,
    limit: usize,
) -> (Vec<SearchLocalResultItem>, bool, u64) {
    let (top, truncated, matched_files) = top_candidates(candidates, limit);
    let (results, _ignored_truncated) = to_search_results(top, limit);
    (results, truncated, matched_files)
}

fn read_cached_entries(
    scope_preset: SearchLocalScopePreset,
    include_hidden: bool,
    roots: &[String],
) -> Option<(Vec<SearchMetadataEntry>, SearchIndexStatusResponse)> {
    let guard = search_index_store().read().ok()?;
    if guard.status.state == SearchIndexState::Ready
        && guard.scope_preset == scope_preset
        && guard.include_hidden == include_hidden
        && guard.roots == roots
    {
        return Some((guard.entries.clone(), guard.status.clone()));
    }
    None
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

fn apply_processed_entry_results(
    processed_entries: Vec<ProcessedEntryResult>,
    candidates: &mut HashMap<String, CandidateMatch>,
    stats: &mut SearchLocalStats,
) {
    for processed in processed_entries {
        stats.content_scanned_files += processed.content_scanned_files;
        stats.skipped_unreadable += processed.skipped_unreadable;
        stats.skipped_binary_or_too_large += processed.skipped_binary_or_too_large;
        if let Some(candidate) = processed.candidate {
            merge_candidate(candidates, candidate);
        }
    }
    stats.matched_files = candidates.len() as u64;
}

fn publish_stream_snapshot(
    stream_state: &Arc<RwLock<SearchStreamState>>,
    candidates: &HashMap<String, CandidateMatch>,
    stats: &SearchLocalStats,
    limit: usize,
    done: bool,
    error: Option<String>,
    elapsed_ms: u64,
) {
    let (results, truncated, matched_files) = to_stream_snapshot_results(candidates, limit);
    if let Ok(mut guard) = stream_state.write() {
        guard.snapshot.results = results;
        guard.snapshot.truncated = truncated;
        guard.snapshot.stats = SearchLocalStats {
            matched_files,
            ..stats.clone()
        };
        guard.snapshot.elapsed_ms = elapsed_ms;
        guard.snapshot.done = done;
        guard.snapshot.error = error;
    }
}

fn stream_is_active(stream_id: &str) -> bool {
    search_stream_store()
        .read()
        .map(|streams| streams.contains_key(stream_id))
        .unwrap_or(false)
}

fn process_stream_batch(
    batch: &mut Vec<SearchMetadataEntry>,
    query_lower: &str,
    extension_query: Option<&str>,
    enable_fuzzy: bool,
    enable_content: bool,
    enable_extension_match: bool,
    content_budget: &AtomicUsize,
    candidates: &mut HashMap<String, CandidateMatch>,
    stats: &mut SearchLocalStats,
    stream_state: &Arc<RwLock<SearchStreamState>>,
    limit: usize,
    started_at: &Instant,
    force_emit: bool,
) {
    if batch.is_empty() {
        return;
    }
    let snapshot = std::mem::take(batch);
    let content_scan_target = (limit as u64)
        .saturating_mul(STREAM_CONTENT_SCAN_TARGET_MULTIPLIER)
        .max(STREAM_EMIT_BATCH_SIZE as u64);
    let enable_content_for_batch = enable_content && stats.matched_files < content_scan_target;
    let processed = process_entry_batch_parallel(
        &snapshot,
        query_lower,
        extension_query,
        enable_fuzzy,
        enable_content_for_batch,
        enable_extension_match,
        content_budget,
    );
    apply_processed_entry_results(processed, candidates, stats);
    if force_emit || stats.scanned_files % STREAM_EMIT_BATCH_SIZE as u64 == 0 {
        publish_stream_snapshot(
            stream_state,
            candidates,
            stats,
            limit,
            false,
            None,
            started_at.elapsed().as_millis() as u64,
        );
    }
}

pub fn search_local_json(request_json: String) -> Result<String, String> {
    let started_at = Instant::now();
    let request: SearchLocalRequest =
        serde_json::from_str(&request_json).map_err(|error| format!("invalid request: {error}"))?;
    let query = request.query.trim().to_string();
    if query.is_empty() {
        return Err("query is required".to_string());
    }

    let limit = clamp_limit(request.limit);
    let include_hidden = request.include_hidden.unwrap_or(false);
    let enable_fuzzy = request.enable_fuzzy.unwrap_or(DEFAULT_FUZZY_ENABLED);
    let enable_content = request
        .enable_content
        .unwrap_or(DEFAULT_CONTENT_SCAN_ENABLED);
    let enable_extension_match = request
        .enable_extension_match
        .unwrap_or(DEFAULT_EXTENSION_MATCH_ENABLED);
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

    let mut stats = SearchLocalStats {
        scanned_files: 0,
        scanned_dirs: 0,
        content_scanned_files: 0,
        matched_files: 0,
        skipped_unreadable: 0,
        skipped_binary_or_too_large: 0,
        used_index: false,
    };

    let mut entries = Vec::<SearchMetadataEntry>::new();
    let mut collected_for_cache = false;
    {
        let guard = search_index_store()
            .read()
            .map_err(|_| "search index state lock poisoned".to_string())?;
        if guard.status.state == SearchIndexState::Ready
            && guard.scope_preset == request.scope_preset
            && guard.include_hidden == include_hidden
            && guard.roots == root_paths
        {
            entries = guard.entries.clone();
            stats.scanned_files = guard.status.indexed_files;
            stats.scanned_dirs = guard.status.indexed_dirs;
            stats.used_index = true;
        }
    }

    if entries.is_empty() {
        let collection = collect_metadata_entries(&roots, include_hidden, INDEX_MAX_FILES);
        stats.scanned_files = collection.scanned_files;
        stats.scanned_dirs = collection.scanned_dirs;
        stats.skipped_unreadable += collection.skipped_unreadable;
        entries = collection.entries;
        collected_for_cache = true;
    }

    if collected_for_cache {
        let status = SearchIndexStatusResponse {
            state: SearchIndexState::Ready,
            indexed_files: stats.scanned_files,
            indexed_dirs: stats.scanned_dirs,
            last_built_at: Some(unix_seconds_now().to_string()),
            progress: Some(1.0),
            error: None,
        };
        if let Ok(mut guard) = search_index_store().write() {
            guard.status = status;
            guard.scope_preset = request.scope_preset;
            guard.include_hidden = include_hidden;
            guard.roots = root_paths.clone();
            guard.entries = entries.clone();
        }
    }

    let matches = find_matches(
        &entries,
        &query,
        enable_fuzzy,
        enable_content,
        enable_extension_match,
        &mut stats,
    );
    stats.matched_files = matches.len() as u64;
    let (results, truncated) = to_search_results(matches, limit);
    let response = SearchLocalResponse {
        query,
        scope_preset: request.scope_preset,
        roots: root_paths,
        results,
        truncated,
        elapsed_ms: started_at.elapsed().as_millis() as u64,
        stats,
    };
    serde_json::to_string(&response).map_err(|error| format!("serialize response failed: {error}"))
}

fn run_search_local_stream_worker(
    stream_id: String,
    stream_state: Arc<RwLock<SearchStreamState>>,
    request: SearchLocalRequest,
    roots: Vec<PathBuf>,
    root_paths: Vec<String>,
    limit: usize,
) {
    let started_at = Instant::now();
    let include_hidden = request.include_hidden.unwrap_or(false);
    let enable_fuzzy = request.enable_fuzzy.unwrap_or(DEFAULT_FUZZY_ENABLED);
    let enable_content = request
        .enable_content
        .unwrap_or(DEFAULT_CONTENT_SCAN_ENABLED);
    let enable_extension_match = request
        .enable_extension_match
        .unwrap_or(DEFAULT_EXTENSION_MATCH_ENABLED);
    let query = request.query.trim().to_string();
    let query_lower = query.to_lowercase();
    let extension_query = parse_extension_query(&query_lower);
    let content_budget = Arc::new(AtomicUsize::new(MAX_CONTENT_SCAN_FILES));

    let mut stats = SearchLocalStats {
        scanned_files: 0,
        scanned_dirs: 0,
        content_scanned_files: 0,
        matched_files: 0,
        skipped_unreadable: 0,
        skipped_binary_or_too_large: 0,
        used_index: false,
    };
    let mut candidates = HashMap::<String, CandidateMatch>::new();

    if let Some((entries, status)) =
        read_cached_entries(request.scope_preset, include_hidden, &root_paths)
    {
        stats.used_index = true;
        stats.scanned_files = status.indexed_files;
        stats.scanned_dirs = status.indexed_dirs;

        for chunk in entries.chunks(STREAM_EMIT_BATCH_SIZE) {
            if stream_is_active(&stream_id) == false {
                return;
            }
            let processed = process_entry_batch_parallel(
                chunk,
                &query_lower,
                extension_query.as_deref(),
                enable_fuzzy,
                enable_content,
                enable_extension_match,
                content_budget.as_ref(),
            );
            apply_processed_entry_results(processed, &mut candidates, &mut stats);
            publish_stream_snapshot(
                &stream_state,
                &candidates,
                &stats,
                limit,
                false,
                None,
                started_at.elapsed().as_millis() as u64,
            );
        }

        publish_stream_snapshot(
            &stream_state,
            &candidates,
            &stats,
            limit,
            true,
            None,
            started_at.elapsed().as_millis() as u64,
        );
        return;
    }

    let mut all_entries = Vec::<SearchMetadataEntry>::new();
    let mut batch = Vec::<SearchMetadataEntry>::new();
    let mut stack = Vec::<PathBuf>::new();
    let mut index_truncated = false;

    for root in roots {
        if stream_is_active(&stream_id) == false {
            return;
        }
        let metadata = match fs::symlink_metadata(&root) {
            Ok(metadata) => metadata,
            Err(_) => {
                stats.skipped_unreadable += 1;
                continue;
            }
        };
        if metadata.is_file() {
            stats.scanned_files += 1;
            if let Some(entry) = to_metadata_entry(&root) {
                all_entries.push(entry.clone());
                batch.push(entry);
                if all_entries.len() >= INDEX_MAX_FILES {
                    index_truncated = true;
                    break;
                }
                if batch.len() >= STREAM_EMIT_BATCH_SIZE {
                    process_stream_batch(
                        &mut batch,
                        &query_lower,
                        extension_query.as_deref(),
                        enable_fuzzy,
                        enable_content,
                        enable_extension_match,
                        content_budget.as_ref(),
                        &mut candidates,
                        &mut stats,
                        &stream_state,
                        limit,
                        &started_at,
                        true,
                    );
                }
            }
            continue;
        }
        if metadata.is_dir() {
            stack.push(root);
        }
    }

    while let Some(directory_path) = stack.pop() {
        if stream_is_active(&stream_id) == false {
            return;
        }
        stats.scanned_dirs += 1;
        let directory = match fs::read_dir(&directory_path) {
            Ok(directory) => directory,
            Err(_) => {
                stats.skipped_unreadable += 1;
                continue;
            }
        };

        for entry_result in directory {
            if stream_is_active(&stream_id) == false {
                return;
            }
            let entry = match entry_result {
                Ok(entry) => entry,
                Err(_) => {
                    stats.skipped_unreadable += 1;
                    continue;
                }
            };
            let entry_path = entry.path();
            let file_name = entry.file_name().to_string_lossy().to_string();
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => {
                    stats.skipped_unreadable += 1;
                    continue;
                }
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                if should_skip_directory(&file_name, include_hidden) {
                    continue;
                }
                stack.push(entry_path);
                continue;
            }
            if file_type.is_file() {
                if should_skip_file(&file_name, include_hidden) {
                    continue;
                }
                stats.scanned_files += 1;
                if let Some(metadata_entry) = to_metadata_entry(&entry_path) {
                    all_entries.push(metadata_entry.clone());
                    batch.push(metadata_entry);
                    if all_entries.len() >= INDEX_MAX_FILES {
                        index_truncated = true;
                        break;
                    }
                    if batch.len() >= STREAM_EMIT_BATCH_SIZE {
                        process_stream_batch(
                            &mut batch,
                            &query_lower,
                            extension_query.as_deref(),
                            enable_fuzzy,
                            enable_content,
                            enable_extension_match,
                            content_budget.as_ref(),
                            &mut candidates,
                            &mut stats,
                            &stream_state,
                            limit,
                            &started_at,
                            true,
                        );
                    }
                }
            }
        }

        if index_truncated {
            break;
        }
    }

    process_stream_batch(
        &mut batch,
        &query_lower,
        extension_query.as_deref(),
        enable_fuzzy,
        enable_content,
        enable_extension_match,
        content_budget.as_ref(),
        &mut candidates,
        &mut stats,
        &stream_state,
        limit,
        &started_at,
        true,
    );

    let index_status = SearchIndexStatusResponse {
        state: SearchIndexState::Ready,
        indexed_files: stats.scanned_files,
        indexed_dirs: stats.scanned_dirs,
        last_built_at: Some(unix_seconds_now().to_string()),
        progress: Some(1.0),
        error: if index_truncated {
            Some("index truncated at file cap".to_string())
        } else {
            None
        },
    };
    if let Ok(mut guard) = search_index_store().write() {
        guard.status = index_status;
        guard.scope_preset = request.scope_preset;
        guard.include_hidden = include_hidden;
        guard.roots = root_paths;
        guard.entries = all_entries;
    }

    publish_stream_snapshot(
        &stream_state,
        &candidates,
        &stats,
        limit,
        true,
        if index_truncated {
            Some("stream completed with truncated index scope".to_string())
        } else {
            None
        },
        started_at.elapsed().as_millis() as u64,
    );
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

    let stream_id = format!("search-stream-{}", Uuid::new_v4());
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
    }));
    {
        let mut streams = search_stream_store()
            .write()
            .map_err(|_| "search stream state lock poisoned".to_string())?;
        prune_stream_store(&mut streams);
        streams.insert(stream_id.clone(), stream_state.clone());
    }

    let worker_request = request.clone();
    let worker_stream_id = stream_id.clone();
    let worker_root_paths = root_paths.clone();
    std::thread::spawn(move || {
        run_search_local_stream_worker(
            worker_stream_id,
            stream_state,
            worker_request,
            roots,
            worker_root_paths,
            limit,
        );
    });

    let response = SearchLocalStreamStartResponse {
        stream_id,
        query,
        scope_preset: request.scope_preset,
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
        .remove(request.stream_id.as_str())
        .is_some();
    let response = SearchLocalStreamCancelResponse { removed };
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

    if force_rebuild == false {
        if let Ok(guard) = search_index_store().read() {
            if guard.status.state == SearchIndexState::Ready
                && guard.scope_preset == request.scope_preset
                && guard.include_hidden == include_hidden
                && guard.roots == root_paths
            {
                let response = SearchRebuildIndexResponse {
                    status: guard.status.clone(),
                    scope_preset: request.scope_preset,
                    roots: root_paths,
                };
                return serde_json::to_string(&response)
                    .map_err(|error| format!("serialize response failed: {error}"));
            }
        }
    }

    {
        let mut guard = search_index_store()
            .write()
            .map_err(|_| "search index state lock poisoned".to_string())?;
        guard.status.state = SearchIndexState::Building;
        guard.status.progress = Some(0.0);
        guard.status.error = None;
    }

    let collection = collect_metadata_entries(&roots, include_hidden, INDEX_MAX_FILES);
    let status = SearchIndexStatusResponse {
        state: SearchIndexState::Ready,
        indexed_files: collection.scanned_files,
        indexed_dirs: collection.scanned_dirs,
        last_built_at: Some(unix_seconds_now().to_string()),
        progress: Some(1.0),
        error: if collection.truncated {
            Some("index truncated at file cap".to_string())
        } else {
            None
        },
    };

    {
        let mut guard = search_index_store()
            .write()
            .map_err(|_| "search index state lock poisoned".to_string())?;
        guard.status = status.clone();
        guard.scope_preset = request.scope_preset;
        guard.include_hidden = include_hidden;
        guard.roots = root_paths.clone();
        guard.entries = collection.entries;
    }

    let response = SearchRebuildIndexResponse {
        status,
        scope_preset: request.scope_preset,
        roots: root_paths,
    };
    serde_json::to_string(&response).map_err(|error| format!("serialize response failed: {error}"))
}

pub fn read_search_index_status_json(_request_json: String) -> Result<String, String> {
    let guard = search_index_store()
        .read()
        .map_err(|_| "search index state lock poisoned".to_string())?;
    serde_json::to_string(&guard.status)
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
