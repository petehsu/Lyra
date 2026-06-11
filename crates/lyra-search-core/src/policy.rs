use crate::types::*;
use glob::Pattern;
use lyra_local_search::LocalSearchQueryMode;
use notify::Event;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

pub(crate) const SEARCH_V3_STORAGE_DIR: &str = "search-v3";
pub(crate) const SEARCH_POLICY_FILE_NAME: &str = "policy.json";
pub(crate) const PROJECT_SEARCH_POLICY_PATH: &str = ".lyra/search-policy.json";
pub(crate) const DEFAULT_TEXT_LIMIT_BYTES: u64 = 256 * 1024;
pub(crate) const DEFAULT_CONTENT_BUDGET_BYTES: u64 = 1024 * 1024 * 1024;
pub(crate) const MAX_POLICY_CONTENT_FILE_BYTES: u64 = 16 * 1024 * 1024;
pub(crate) const MAX_POLICY_CONTENT_BUDGET_BYTES: u64 = 16 * 1024 * 1024 * 1024;
pub(crate) const MAX_POLICY_CANDIDATES: usize = 5_000;

pub(crate) const DEFAULT_EXCLUDE_DIRS: &[&str] = &[
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

pub(crate) const DEFAULT_TEXT_EXTENSIONS: &[&str] = &[
    "bash", "c", "cc", "conf", "cpp", "cs", "css", "csv", "go", "h", "hpp", "html", "java", "js",
    "json", "jsx", "kt", "lock", "log", "md", "mjs", "py", "rb", "rs", "sh", "sql", "swift",
    "toml", "ts", "tsx", "txt", "xml", "yaml", "yml", "zsh",
];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchPolicy {
    pub(crate) index: SearchIndexPolicy,
    pub(crate) query: SearchQueryPolicy,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchIndexPolicy {
    pub(crate) exclude_dirs: Vec<String>,
    pub(crate) exclude_globs: Vec<String>,
    pub(crate) include_hidden: bool,
    pub(crate) include_vendor: bool,
    pub(crate) respect_gitignore: bool,
    pub(crate) follow_symlinks: bool,
    pub(crate) text_extensions: Vec<String>,
    pub(crate) max_content_file_bytes: u64,
    pub(crate) content_budget_bytes: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchQueryPolicy {
    pub(crate) include_globs: Vec<String>,
    pub(crate) exclude_globs: Vec<String>,
    pub(crate) mode: SearchLocalMode,
    pub(crate) enable_content: bool,
    pub(crate) enable_fuzzy: bool,
    pub(crate) enable_extension_match: bool,
    pub(crate) max_candidates: Option<usize>,
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedSearchPolicy {
    pub(crate) policy: SearchPolicy,
    pub(crate) hash: String,
    pub(crate) source: Vec<String>,
    pub(crate) warnings: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchPolicyPatch {
    #[serde(default)]
    pub(crate) index: Option<SearchIndexPolicyPatch>,
    #[serde(default)]
    pub(crate) query: Option<SearchQueryPolicyPatch>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchIndexPolicyPatch {
    #[serde(default)]
    pub(crate) exclude_dirs: Option<Vec<String>>,
    #[serde(default)]
    pub(crate) exclude_globs: Option<Vec<String>>,
    #[serde(default)]
    pub(crate) include_hidden: Option<bool>,
    #[serde(default)]
    pub(crate) include_vendor: Option<bool>,
    #[serde(default)]
    pub(crate) respect_gitignore: Option<bool>,
    #[serde(default)]
    pub(crate) follow_symlinks: Option<bool>,
    #[serde(default)]
    pub(crate) text_extensions: Option<Vec<String>>,
    #[serde(default)]
    pub(crate) max_content_file_bytes: Option<u64>,
    #[serde(default)]
    pub(crate) content_budget_bytes: Option<u64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchQueryPolicyPatch {
    #[serde(default)]
    pub(crate) include_globs: Option<Vec<String>>,
    #[serde(default)]
    pub(crate) exclude_globs: Option<Vec<String>>,
    #[serde(default)]
    pub(crate) mode: Option<SearchLocalMode>,
    #[serde(default)]
    pub(crate) enable_content: Option<bool>,
    #[serde(default)]
    pub(crate) enable_fuzzy: Option<bool>,
    #[serde(default)]
    pub(crate) enable_extension_match: Option<bool>,
    #[serde(default)]
    pub(crate) max_candidates: Option<usize>,
}

pub(crate) fn home_directory() -> Option<PathBuf> {
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

pub(crate) fn normalize_storage_root(raw: Option<&str>) -> Option<PathBuf> {
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

pub(crate) fn default_storage_root() -> PathBuf {
    if let Some(root) = std::env::var_os("LYRA_SEARCH_STORAGE_ROOT")
        && !root.is_empty()
    {
        return PathBuf::from(root);
    }
    home_directory()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join(".lyra")
        .join("modules")
        .join("search")
}

pub(crate) fn module_storage_root_for(storage_root: Option<&str>) -> PathBuf {
    normalize_storage_root(storage_root).unwrap_or_else(default_storage_root)
}

pub(crate) fn engine_storage_root_for(storage_root: Option<&str>) -> PathBuf {
    module_storage_root_for(storage_root).join(SEARCH_V3_STORAGE_DIR)
}

pub(crate) fn default_string_list(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

pub(crate) fn default_policy() -> SearchPolicy {
    SearchPolicy {
        index: SearchIndexPolicy {
            exclude_dirs: default_string_list(DEFAULT_EXCLUDE_DIRS),
            exclude_globs: Vec::new(),
            include_hidden: false,
            include_vendor: false,
            respect_gitignore: true,
            follow_symlinks: false,
            text_extensions: default_string_list(DEFAULT_TEXT_EXTENSIONS),
            max_content_file_bytes: DEFAULT_TEXT_LIMIT_BYTES,
            content_budget_bytes: DEFAULT_CONTENT_BUDGET_BYTES,
        },
        query: SearchQueryPolicy {
            include_globs: Vec::new(),
            exclude_globs: Vec::new(),
            mode: SearchLocalMode::Normal,
            enable_content: true,
            enable_fuzzy: true,
            enable_extension_match: true,
            max_candidates: None,
        },
    }
}

pub(crate) fn normalize_policy_strings(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for value in values {
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        let key = value.to_lowercase();
        if seen.insert(key) {
            normalized.push(value.to_string());
        }
    }
    normalized
}

pub(crate) fn apply_policy_patch(policy: &mut SearchPolicy, patch: SearchPolicyPatch) {
    if let Some(index) = patch.index {
        if let Some(value) = index.exclude_dirs {
            policy.index.exclude_dirs = normalize_policy_strings(value);
        }
        if let Some(value) = index.exclude_globs {
            policy.index.exclude_globs = normalize_policy_strings(value);
        }
        if let Some(value) = index.include_hidden {
            policy.index.include_hidden = value;
        }
        if let Some(value) = index.include_vendor {
            policy.index.include_vendor = value;
        }
        if let Some(value) = index.respect_gitignore {
            policy.index.respect_gitignore = value;
        }
        if let Some(value) = index.follow_symlinks {
            policy.index.follow_symlinks = value;
        }
        if let Some(value) = index.text_extensions {
            let normalized = normalize_policy_strings(
                value
                    .into_iter()
                    .map(|value| value.trim().trim_start_matches('.').to_lowercase())
                    .collect(),
            );
            if !normalized.is_empty() {
                policy.index.text_extensions = normalized;
            }
        }
        if let Some(value) = index.max_content_file_bytes {
            policy.index.max_content_file_bytes = value.clamp(1, MAX_POLICY_CONTENT_FILE_BYTES);
        }
        if let Some(value) = index.content_budget_bytes {
            policy.index.content_budget_bytes = value.clamp(1, MAX_POLICY_CONTENT_BUDGET_BYTES);
        }
    }
    if let Some(query) = patch.query {
        if let Some(value) = query.include_globs {
            policy.query.include_globs = normalize_policy_strings(value);
        }
        if let Some(value) = query.exclude_globs {
            policy.query.exclude_globs = normalize_policy_strings(value);
        }
        if let Some(value) = query.mode {
            policy.query.mode = value;
        }
        if let Some(value) = query.enable_content {
            policy.query.enable_content = value;
        }
        if let Some(value) = query.enable_fuzzy {
            policy.query.enable_fuzzy = value;
        }
        if let Some(value) = query.enable_extension_match {
            policy.query.enable_extension_match = value;
        }
        if let Some(value) = query.max_candidates {
            policy.query.max_candidates = Some(value.clamp(1, MAX_POLICY_CANDIDATES));
        }
    }
}

pub(crate) fn load_policy_patch(
    path: &Path,
    source: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Option<SearchPolicyPatch> {
    if !path.exists() {
        return None;
    }
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) => {
            warnings.push(format!(
                "search policy read failed at {}: {error}",
                normalize_path_string(path)
            ));
            return None;
        }
    };
    match serde_json::from_str::<SearchPolicyPatch>(&text) {
        Ok(patch) => {
            source.push(normalize_path_string(path));
            Some(patch)
        }
        Err(error) => {
            warnings.push(format!(
                "search policy parse failed at {}: {error}",
                normalize_path_string(path)
            ));
            None
        }
    }
}

pub(crate) fn validate_policy_globs(policy: &SearchPolicy, warnings: &mut Vec<String>) {
    for (field, patterns) in [
        ("index.excludeGlobs", &policy.index.exclude_globs),
        ("query.includeGlobs", &policy.query.include_globs),
        ("query.excludeGlobs", &policy.query.exclude_globs),
    ] {
        for pattern in patterns {
            if let Err(error) = Pattern::new(pattern) {
                warnings.push(format!("invalid {field} pattern `{pattern}`: {error}"));
            }
        }
    }
}

pub(crate) fn stable_json_hash(value: &impl Serialize) -> String {
    let json = serde_json::to_string(value).unwrap_or_default();
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in json.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

pub(crate) fn stable_policy_hash(policy: &SearchPolicy) -> String {
    // Only index-shaping policy belongs in the persisted hash. Query policy is
    // applied at search time and must not make an otherwise ready index stale.
    stable_json_hash(&policy.index)
}

pub(crate) fn project_policy_path_for_root(root: &Path) -> PathBuf {
    root.join(PROJECT_SEARCH_POLICY_PATH)
}

pub(crate) fn apply_request_policy_overrides(
    policy: &mut SearchPolicy,
    request: Option<&SearchLocalRequest>,
) {
    let Some(request) = request else {
        return;
    };
    if let Some(value) = request.include_hidden {
        policy.index.include_hidden = value;
    }
    if let Some(value) = request.include_vendor {
        policy.index.include_vendor = value;
    }
    if let Some(value) = request.respect_gitignore {
        policy.index.respect_gitignore = value;
    }
    if let Some(value) = request.follow_symlinks {
        policy.index.follow_symlinks = value;
    }
    if !request.exclude_dirs.is_empty() {
        policy.index.exclude_dirs = normalize_policy_strings(request.exclude_dirs.clone());
    }
    if !request.text_extensions.is_empty() {
        policy.index.text_extensions = normalize_policy_strings(
            request
                .text_extensions
                .iter()
                .map(|value| value.trim().trim_start_matches('.').to_lowercase())
                .collect(),
        );
    }
    if let Some(value) = request.max_content_file_bytes {
        policy.index.max_content_file_bytes = value.clamp(1, MAX_POLICY_CONTENT_FILE_BYTES);
    }
    if let Some(value) = request.content_budget_bytes {
        policy.index.content_budget_bytes = value.clamp(1, MAX_POLICY_CONTENT_BUDGET_BYTES);
    }
    if !request.include_globs.is_empty() {
        policy.query.include_globs = normalize_policy_strings(request.include_globs.clone());
    }
    if !request.exclude_globs.is_empty() {
        let mut globs = policy.query.exclude_globs.clone();
        globs.extend(request.exclude_globs.clone());
        policy.query.exclude_globs = normalize_policy_strings(globs);
    }
    if let Some(value) = request.mode {
        policy.query.mode = value;
    }
    if let Some(value) = request.enable_content {
        policy.query.enable_content = value;
    }
    if let Some(value) = request.enable_fuzzy {
        policy.query.enable_fuzzy = value;
    }
    if let Some(value) = request.enable_extension_match {
        policy.query.enable_extension_match = value;
    }
    if let Some(value) = request.max_candidates {
        policy.query.max_candidates = Some(value.clamp(1, MAX_POLICY_CANDIDATES));
    }
}

pub(crate) fn resolve_search_policy(
    storage_root: &Path,
    roots: &[PathBuf],
    request: Option<&SearchLocalRequest>,
) -> ResolvedSearchPolicy {
    let mut policy = default_policy();
    let mut source = vec!["builtin".to_string()];
    let mut warnings = Vec::new();
    if let Some(patch) = load_policy_patch(
        &storage_root.join(SEARCH_POLICY_FILE_NAME),
        &mut source,
        &mut warnings,
    ) {
        apply_policy_patch(&mut policy, patch);
    }
    let mut project_policy_count = 0_usize;
    for root in roots {
        let path = project_policy_path_for_root(root);
        if let Some(patch) = load_policy_patch(&path, &mut source, &mut warnings) {
            project_policy_count += 1;
            apply_policy_patch(&mut policy, patch);
        }
    }
    if project_policy_count > 1 {
        warnings.push("multiple project search policies were merged in root order".to_string());
    }
    if request.is_some() {
        apply_request_policy_overrides(&mut policy, request);
        source.push("request".to_string());
    }
    validate_policy_globs(&policy, &mut warnings);
    let hash = stable_policy_hash(&policy);
    ResolvedSearchPolicy {
        policy,
        hash,
        source,
        warnings,
    }
}

pub(crate) fn normalize_path_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub(crate) fn normalize_path_key(path: &Path) -> String {
    #[cfg(target_os = "windows")]
    {
        normalize_path_string(path).to_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        normalize_path_string(path)
    }
}

pub(crate) fn path_covers(candidate: &Path, indexed_root: &Path) -> bool {
    if normalize_path_key(candidate) == normalize_path_key(indexed_root)
        || candidate.starts_with(indexed_root)
    {
        return true;
    }
    let candidate = candidate
        .canonicalize()
        .unwrap_or_else(|_| candidate.to_path_buf());
    let indexed_root = indexed_root
        .canonicalize()
        .unwrap_or_else(|_| indexed_root.to_path_buf());
    normalize_path_key(&candidate) == normalize_path_key(&indexed_root)
        || candidate.starts_with(indexed_root)
}

pub(crate) fn normalize_existing_path(raw: &str) -> Option<PathBuf> {
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

pub(crate) fn system_search_roots(_home_root: &Path) -> Vec<PathBuf> {
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

pub(crate) fn event_paths(event: notify::Result<Event>) -> Vec<PathBuf> {
    event.map(|event| event.paths).unwrap_or_default()
}

pub(crate) fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
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

pub(crate) fn local_query_mode(mode: SearchLocalMode) -> LocalSearchQueryMode {
    match mode {
        SearchLocalMode::Fast => LocalSearchQueryMode::Fast,
        SearchLocalMode::Normal => LocalSearchQueryMode::Normal,
        SearchLocalMode::Full => LocalSearchQueryMode::Full,
    }
}

pub(crate) fn search_mode_multiplier(mode: SearchLocalMode) -> usize {
    match mode {
        SearchLocalMode::Fast => 2,
        SearchLocalMode::Normal => 3,
        SearchLocalMode::Full => 5,
    }
}
