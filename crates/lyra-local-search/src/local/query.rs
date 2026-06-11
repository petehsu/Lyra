use super::index::{
    compiled_glob_patterns, normalize_existing_root, normalize_extension_filter,
    path_matches_any_glob,
};
use super::model::*;
use crate::native;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

impl CompiledQueryFilters {
    pub(super) fn from_options(options: &LocalSearchOptions) -> Self {
        Self {
            include_globs: compiled_glob_patterns(&options.include_globs),
            exclude_globs: compiled_glob_patterns(&options.exclude_globs),
        }
    }
}

pub(super) fn score_v3_entry(
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

pub(super) fn score_v3_entry_content(
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

pub(super) fn initial_entry_score(entry: &IndexedEntry) -> Option<u32> {
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

pub(super) fn clip_snippet(line: &str, max_chars: usize) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let mut clipped = trimmed.chars().take(max_chars).collect::<String>();
    clipped.push_str("...");
    clipped
}

pub(super) fn merge_candidate(
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

pub(super) fn entry_allowed(
    entry: &IndexedEntry,
    options: &LocalSearchOptions,
    filters: &CompiledQueryFilters,
) -> bool {
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
    if !filters.include_globs.is_empty()
        && !path_matches_any_glob(&filters.include_globs, &entry.relative_path)
    {
        return false;
    }
    if path_matches_any_glob(&filters.exclude_globs, &entry.relative_path) {
        return false;
    }
    true
}

pub(super) fn should_search_content(
    mode: LocalSearchContentMode,
    query_mode: LocalSearchQueryMode,
) -> bool {
    mode != LocalSearchContentMode::Disabled && query_mode != LocalSearchQueryMode::Fast
}

pub(super) fn candidate_multiplier(mode: LocalSearchQueryMode) -> usize {
    match mode {
        LocalSearchQueryMode::Fast => SEARCH_CANDIDATE_MULTIPLIER_FAST,
        LocalSearchQueryMode::Normal => SEARCH_CANDIDATE_MULTIPLIER_NORMAL,
        LocalSearchQueryMode::Full => SEARCH_CANDIDATE_MULTIPLIER_FULL,
    }
}

pub(super) fn read_text_at_offset(
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

pub(super) fn read_text_file_with_limit(
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

pub(super) fn resolve_read_path(root: Option<&Path>, path: &Path) -> anyhow::Result<PathBuf> {
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

pub(super) fn scope_entries(entries: &[IndexedEntry], roots: &[PathBuf]) -> Vec<IndexedEntry> {
    if roots.is_empty() {
        return entries.to_vec();
    }
    entries
        .iter()
        .filter(|entry| {
            roots
                .iter()
                .any(|root| entry_is_in_requested_root(entry, root))
        })
        .cloned()
        .collect()
}

pub(super) fn entry_is_in_requested_root(entry: &IndexedEntry, root: &Path) -> bool {
    entry.root == root || entry.full_path.starts_with(root)
}

pub(super) fn rebuild_content_postings(state: &mut LocalSearchState) {
    state.content_postings = build_content_postings(&state.entries);
}

pub(super) fn build_content_postings(entries: &[IndexedEntry]) -> HashMap<String, Vec<usize>> {
    let mut postings = HashMap::<String, Vec<usize>>::new();
    for (index, entry) in entries.iter().enumerate() {
        if !entry.content_indexed {
            continue;
        }
        let Some(text) = entry.content_text.as_deref() else {
            continue;
        };
        for term in content_index_terms(text) {
            let list = postings.entry(term).or_default();
            if list.len() < CONTENT_MAX_POSTINGS_PER_TERM {
                list.push(index);
            }
        }
    }
    postings
}

pub(super) fn refresh_content_postings_after_changes(state: &mut LocalSearchState) {
    if state.entries.len() <= CONTENT_INLINE_REBUILD_ENTRY_LIMIT {
        rebuild_content_postings(state);
    }
    // Large Home indexes keep the last compacted postings until the next full
    // snapshot; snippets still verify content hits against the stored text.
}

pub(super) fn content_candidate_entries(
    state: &LocalSearchState,
    roots: &[PathBuf],
    query: &str,
    limit: usize,
) -> Vec<IndexedEntry> {
    let terms = content_query_terms(query);
    if terms.is_empty() {
        return Vec::new();
    }
    let mut lists = Vec::<&Vec<usize>>::new();
    for term in &terms {
        let Some(list) = state.content_postings.get(term) else {
            return Vec::new();
        };
        if list.is_empty() {
            return Vec::new();
        }
        if list.len() >= CONTENT_MAX_POSTINGS_PER_TERM {
            continue;
        }
        lists.push(list);
    }
    if lists.is_empty() {
        return scan_content_candidate_entries(state, roots, query, limit);
    }
    lists.sort_by_key(|list| list.len());

    let mut indices = lists[0].iter().copied().collect::<HashSet<_>>();
    for list in lists.iter().skip(1) {
        indices.retain(|index| list.binary_search(index).is_ok());
        if indices.is_empty() {
            return Vec::new();
        }
    }

    let mut indices = indices.into_iter().collect::<Vec<_>>();
    indices.sort_unstable();
    indices
        .into_iter()
        .filter_map(|index| state.entries.get(index))
        .filter(|entry| {
            roots.is_empty()
                || roots
                    .iter()
                    .any(|root| entry_is_in_requested_root(entry, root))
        })
        .take(limit)
        .cloned()
        .collect()
}

pub(super) fn scan_content_candidate_entries(
    state: &LocalSearchState,
    roots: &[PathBuf],
    query: &str,
    limit: usize,
) -> Vec<IndexedEntry> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Vec::new();
    }
    state
        .entries
        .iter()
        .filter(|entry| entry.content_indexed)
        .filter(|entry| {
            roots.is_empty()
                || roots
                    .iter()
                    .any(|root| entry_is_in_requested_root(entry, root))
        })
        .filter(|entry| {
            entry
                .content_text
                .as_deref()
                .is_some_and(|text| snippet_for_text(text, &query).is_some())
        })
        .take(limit)
        .cloned()
        .collect()
}

pub(super) fn content_index_terms(text: &str) -> HashSet<String> {
    collect_content_terms(text, CONTENT_MAX_TERMS_PER_FILE)
}

pub(super) fn content_query_terms(query: &str) -> Vec<String> {
    let mut terms = collect_content_terms(query, 64)
        .into_iter()
        .collect::<Vec<_>>();
    terms.sort_by_key(|term| term.chars().count());
    terms.dedup();
    terms
}

pub(super) fn collect_content_terms(text: &str, limit: usize) -> HashSet<String> {
    let mut terms = HashSet::new();
    let mut token = String::new();
    for ch in text.chars() {
        if is_content_token_char(ch) {
            token.extend(ch.to_lowercase());
            continue;
        }
        add_content_token_terms(&token, limit, &mut terms);
        token.clear();
        if terms.len() >= limit {
            return terms;
        }
    }
    add_content_token_terms(&token, limit, &mut terms);
    terms
}

pub(super) fn is_content_token_char(ch: char) -> bool {
    ch == '_' || ch.is_alphanumeric()
}

pub(super) fn add_content_token_terms(token: &str, limit: usize, terms: &mut HashSet<String>) {
    if token.is_empty() || terms.len() >= limit {
        return;
    }
    if token.chars().all(|ch| ch.is_ascii()) {
        add_ascii_content_terms(token, limit, terms);
    } else {
        add_unicode_content_terms(token, limit, terms);
    }
}

pub(super) fn add_ascii_content_terms(token: &str, limit: usize, terms: &mut HashSet<String>) {
    let chars = token.chars().collect::<Vec<_>>();
    if (2..CONTENT_ASCII_NGRAM_CHARS).contains(&chars.len()) {
        terms.insert(token.to_string());
    }
    if chars.len() < CONTENT_ASCII_NGRAM_CHARS {
        return;
    }
    for window in chars.windows(CONTENT_ASCII_NGRAM_CHARS) {
        if terms.len() >= limit {
            return;
        }
        terms.insert(window.iter().collect());
    }
}

pub(super) fn add_unicode_content_terms(token: &str, limit: usize, terms: &mut HashSet<String>) {
    let chars = token.chars().collect::<Vec<_>>();
    if chars.is_empty() {
        return;
    }
    if chars.len() < CONTENT_UNICODE_NGRAM_CHARS {
        terms.insert(token.to_string());
    }
    if chars.len() < CONTENT_UNICODE_NGRAM_CHARS {
        return;
    }
    for window in chars.windows(CONTENT_UNICODE_NGRAM_CHARS) {
        if terms.len() >= limit {
            return;
        }
        terms.insert(window.iter().collect());
    }
}

pub(super) fn result_rank_order(
    left: &LocalSearchResult,
    right: &LocalSearchResult,
) -> std::cmp::Ordering {
    right
        .score
        .cmp(&left.score)
        .then_with(|| left.display_path.cmp(&right.display_path))
        .then_with(|| left.path.cmp(&right.path))
}

pub(super) fn clamp_limit(limit: usize) -> usize {
    limit.clamp(1, MAX_LIMIT)
}
