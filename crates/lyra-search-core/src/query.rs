use crate::policy::*;
use crate::service::MAX_RESULT_LIMIT;
use crate::types::*;
use lyra_local_search::{
    LocalSearchContentMode, LocalSearchEngine, LocalSearchKind, LocalSearchMatchKind,
    LocalSearchOptions, LocalSearchResult, LocalSearchSource,
};
use std::collections::HashMap;
use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub(crate) struct SearchProviderOutput {
    pub(crate) results: Vec<SearchLocalResultItem>,
    pub(crate) stats: SearchLocalStats,
    pub(crate) elapsed_ms: u64,
}

pub(crate) fn search_lyra_objects(
    request: &SearchLocalRequest,
    query: &str,
) -> Vec<SearchLocalResultItem> {
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

pub(crate) fn search_local_index(
    engine: Arc<LocalSearchEngine>,
    roots: Vec<PathBuf>,
    policy: &ResolvedSearchPolicy,
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
    let content_mode = if policy.policy.query.enable_content {
        LocalSearchContentMode::Auto
    } else {
        LocalSearchContentMode::Disabled
    };
    let query_mode = local_query_mode(policy.policy.query.mode);
    let results = engine
        .search(
            LocalSearchOptions {
                query: query.clone(),
                roots,
                kinds: vec![LocalSearchKind::File, LocalSearchKind::Directory],
                extensions: Vec::new(),
                limit: limit
                    .saturating_mul(search_mode_multiplier(policy.policy.query.mode))
                    .min(MAX_RESULT_LIMIT),
                include_hidden: policy.policy.index.include_hidden,
                include_vendor: policy.policy.index.include_vendor,
                respect_gitignore: policy.policy.index.respect_gitignore,
                include_globs: policy.policy.query.include_globs.clone(),
                exclude_globs: policy.policy.query.exclude_globs.clone(),
                content_mode,
                max_file_size_bytes: policy.policy.index.max_content_file_bytes,
                enable_fuzzy: policy.policy.query.enable_fuzzy,
                enable_extension_match: policy.policy.query.enable_extension_match,
                query_mode,
                max_candidates: policy.policy.query.max_candidates,
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

pub(crate) fn item_from_index_result(
    result: LocalSearchResult,
    query: &str,
) -> SearchLocalResultItem {
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

pub(crate) fn item_from_path(
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

pub(crate) fn file_name_from_path(path: &Path) -> String {
    path.file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| normalize_path_string(path))
}

pub(crate) fn stable_result_id(source: SearchResultSourceKind, key: &str) -> String {
    let mut hasher = DefaultHasher::new();
    source.hash(&mut hasher);
    key.hash(&mut hasher);
    format!("search-v3-{:x}", hasher.finish())
}

pub(crate) fn actions_for_kind(kind: SearchResultKind) -> Vec<SearchResultAction> {
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

pub(crate) fn match_ranges_for_title(title: &str, query: &str) -> Vec<SearchMatchRange> {
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

pub(crate) fn score_path(query: &str, path: &Path, base: f64) -> Option<f64> {
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

pub(crate) fn fuzzy_contains(haystack: &str, needle: &str) -> bool {
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

pub(crate) fn index_score(
    score: u32,
    source: LocalSearchSource,
    match_kind: LocalSearchMatchKind,
) -> f64 {
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

pub(crate) fn match_kind_to_legacy(kind: LocalSearchMatchKind) -> &'static str {
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

pub(crate) fn dedupe_and_rank(
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

pub(crate) fn build_search_response(
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

pub(crate) fn merge_stats(target: &mut SearchLocalStats, next: SearchLocalStats) {
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

pub(crate) fn normalize_dedupe_key(path: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        path.replace('\\', "/").to_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.replace('\\', "/")
    }
}

pub(crate) fn empty_stats() -> SearchLocalStats {
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
