mod index;
mod model;
mod query;
mod storage;

pub use model::*;

use index::*;
use query::*;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use storage::*;

#[cfg(test)]
use std::collections::BTreeMap;
#[cfg(test)]
use std::fs;
#[cfg(test)]
use std::path::Path;

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
            state.policy_hash = options.policy_hash.clone();
            state.policy_source = options.policy_source.clone();
            state.policy_warnings = options.policy_warnings.clone();
            state
                .roots
                .insert(root.clone(), indexing_root_status(&root));
            write_meta(&state)?;
        }

        let collected = collect_root_entries(&root, &options, &cancel_flag)?;
        let (storage, mut entries, mut roots) = {
            let state = self
                .state
                .lock()
                .map_err(|_| anyhow::anyhow!("local search state lock poisoned"))?;
            (
                state.storage.clone(),
                state
                    .entries
                    .iter()
                    .filter(|entry| entry.root != collected.root)
                    .cloned()
                    .collect::<Vec<_>>(),
                state.roots.clone(),
            )
        };
        entries.extend(collected.entries);
        let content_postings = build_content_postings(&entries);
        let root_state = if collected.truncated {
            LocalSearchIndexState::Partial
        } else {
            LocalSearchIndexState::Ready
        };
        roots.insert(
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
        write_snapshot_parts(&storage, &entries, &content_postings)?;
        clear_delta(&storage)?;
        write_meta_parts(
            &storage,
            &roots,
            &options.policy_hash,
            &options.policy_source,
            &options.policy_warnings,
            0,
            "ready",
        )?;

        let mut state = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("local search state lock poisoned"))?;
        state.entries = entries;
        state.content_postings = content_postings;
        state.roots = roots;
        state.state = aggregate_root_state(state.roots.values());
        state.phase = "ready".to_string();
        state.policy_hash = options.policy_hash;
        state.policy_source = options.policy_source;
        state.policy_warnings = options.policy_warnings;
        state.pending_changes = 0;
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
                    follow_symlinks: options.follow_symlinks,
                    exclude_dirs: options.exclude_dirs.clone(),
                    exclude_globs: options.exclude_globs.clone(),
                    text_extensions: options.text_extensions.clone(),
                    content_mode: options.content_mode,
                    max_file_size_bytes: options.max_file_size_bytes,
                    content_budget_bytes: options.content_budget_bytes,
                    policy_hash: options.policy_hash.clone(),
                    policy_source: options.policy_source.clone(),
                    policy_warnings: options.policy_warnings.clone(),
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
        refresh_content_postings_after_changes(&mut state);
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
        state.policy_hash = options.policy_hash;
        state.policy_source = options.policy_source;
        state.policy_warnings = options.policy_warnings;
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

        let (entries, content_entries, indexed_roots, index_state) = {
            let state = self
                .state
                .lock()
                .map_err(|_| anyhow::anyhow!("local search state lock poisoned"))?;
            let indexed_roots = state.roots.keys().cloned().collect::<Vec<_>>();
            let scoped_entries = scope_entries(&state.entries, &roots);
            let content_entries = if should_search_content(options.content_mode, options.query_mode)
            {
                content_candidate_entries(
                    &state,
                    &roots,
                    &options.query,
                    CONTENT_CANDIDATE_SCAN_LIMIT,
                )
            } else {
                Vec::new()
            };
            (scoped_entries, content_entries, indexed_roots, state.state)
        };

        let roots_for_response = if roots.is_empty() {
            indexed_roots.iter().cloned().collect::<Vec<_>>()
        } else {
            roots.clone()
        };

        let has_index_for_scope = if roots.is_empty() {
            !entries.is_empty()
        } else {
            roots.iter().all(|root| {
                indexed_roots
                    .iter()
                    .any(|indexed_root| root == indexed_root || root.starts_with(indexed_root))
            })
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
        let query_filters = CompiledQueryFilters::from_options(&options);
        let default_max_candidates = options
            .limit
            .saturating_mul(candidate_multiplier(options.query_mode))
            .max(options.limit);
        let max_candidates = options
            .max_candidates
            .unwrap_or(default_max_candidates)
            .max(options.limit)
            .min(
                MAX_LIMIT
                    .saturating_mul(candidate_multiplier(options.query_mode))
                    .max(MAX_LIMIT),
            );
        let mut metadata_options = options.clone();
        metadata_options.content_mode = LocalSearchContentMode::Disabled;
        for entry in &entries {
            if cancel_flag.load(Ordering::Relaxed) {
                break;
            }
            if !entry_allowed(entry, &metadata_options, &query_filters) {
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
            for entry in &content_entries {
                if cancel_flag.load(Ordering::Relaxed) || candidates.len() >= max_candidates {
                    break;
                }
                if !entry_allowed(entry, &options, &query_filters) {
                    continue;
                }
                if let Some((score, match_kind, source, snippet, line)) =
                    score_v3_entry_content(entry, &options)
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
        policy_hash: state.policy_hash.clone(),
        policy_source: state.policy_source.clone(),
        policy_warnings: state.policy_warnings.clone(),
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
        policy_hash: None,
        policy_source: Vec::new(),
        policy_warnings: Vec::new(),
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
            ..Default::default()
        }
    }

    fn test_indexed_entry(root: &Path, relative: &str, content: Option<&str>) -> IndexedEntry {
        let relative_path = PathBuf::from(relative);
        let full_path = root.join(&relative_path);
        let display_path = normalize_path_for_display(&relative_path);
        let lower_file_name = relative_path
            .file_name()
            .map(|name| name.to_string_lossy().to_lowercase())
            .unwrap_or_else(|| display_path.clone());
        IndexedEntry {
            root: root.to_path_buf(),
            relative_path,
            full_path,
            display_path: display_path.clone(),
            kind: LocalSearchKind::File,
            extension: Some("tsx".to_string()),
            lower_file_name,
            lower_path: display_path.to_lowercase(),
            size_bytes: content.map_or(0, |value| value.len()) as u64,
            modified_at: None,
            created_at: None,
            hidden: false,
            vendor: false,
            content_indexed: content.is_some(),
            content_text: content.map(str::to_string),
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
    fn local_search_v3_uses_content_postings_for_unicode_and_prefix_queries() {
        let dir = tempdir().expect("tempdir");
        write_file(
            &dir.path().join("notes/reader.md"),
            "默认用于本地可信调用。\nconst localIndexBuildStartedTitle = true;\n",
        );
        write_file(&dir.path().join("notes/noise.md"), "unrelated content\n");
        let engine = LocalSearchEngine::new();
        engine.index_root(index_options(dir.path()), None).unwrap();

        let unicode = engine
            .search(
                LocalSearchOptions {
                    query: "本地".to_string(),
                    roots: vec![dir.path().to_path_buf()],
                    limit: 10,
                    ..Default::default()
                },
                None,
            )
            .unwrap();
        assert_eq!(unicode.results.len(), 1);
        assert_eq!(unicode.results[0].match_kind, LocalSearchMatchKind::Content);
        assert_eq!(unicode.results[0].line, Some(1));

        let prefix = engine
            .search(
                LocalSearchOptions {
                    query: "localIndex".to_string(),
                    roots: vec![dir.path().to_path_buf()],
                    limit: 10,
                    ..Default::default()
                },
                None,
            )
            .unwrap();
        assert_eq!(prefix.results.len(), 1);
        assert_eq!(prefix.results[0].match_kind, LocalSearchMatchKind::Content);
        assert_eq!(prefix.results[0].line, Some(2));
    }

    #[test]
    fn local_search_v3_ignores_saturated_content_postings_when_selecting_candidates() {
        let root = PathBuf::from("/tmp/lyra-search-root");
        let target_content = "const searchIndexRebuilding = true;\n";
        let mut entries = (0..CONTENT_MAX_POSTINGS_PER_TERM)
            .map(|index| test_indexed_entry(&root, &format!("noise/{index}.tsx"), None))
            .collect::<Vec<_>>();
        let target_index = entries.len();
        entries.push(test_indexed_entry(
            &root,
            "src/surface-sidebar.tsx",
            Some(target_content),
        ));

        let mut content_postings = HashMap::<String, Vec<usize>>::new();
        for term in content_query_terms("searchIndexRebuilding") {
            if term == "sea" {
                content_postings.insert(term, (0..CONTENT_MAX_POSTINGS_PER_TERM).collect());
            } else {
                content_postings.insert(term, vec![target_index]);
            }
        }

        let state = LocalSearchState {
            entries,
            content_postings,
            roots: BTreeMap::new(),
            storage: V3Storage { native_dir: None },
            state: LocalSearchIndexState::Ready,
            phase: "ready".to_string(),
            policy_hash: None,
            policy_source: Vec::new(),
            policy_warnings: Vec::new(),
            pending_changes: 0,
            load_error: None,
        };

        let candidates = content_candidate_entries(
            &state,
            std::slice::from_ref(&root),
            "searchIndexRebuilding",
            10,
        );

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].display_path, "src/surface-sidebar.tsx");
    }

    #[test]
    fn local_search_v3_content_can_augment_filename_candidates() {
        let dir = tempdir().expect("tempdir");
        write_file(
            &dir.path().join("src/localIndex.ts"),
            "export const localIndexBuildStartedTitle = 'ready';\n",
        );
        let engine = LocalSearchEngine::new();
        engine.index_root(index_options(dir.path()), None).unwrap();

        let response = engine
            .search(
                LocalSearchOptions {
                    query: "localIndex".to_string(),
                    roots: vec![dir.path().to_path_buf()],
                    limit: 10,
                    ..Default::default()
                },
                None,
            )
            .unwrap();
        assert_eq!(response.results.len(), 1);
        assert_eq!(
            response.results[0].match_kind,
            LocalSearchMatchKind::Content
        );
        assert_eq!(response.results[0].line, Some(1));
        assert!(
            response.results[0]
                .snippet
                .as_deref()
                .is_some_and(|snippet| snippet.contains("localIndexBuildStartedTitle"))
        );
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
    fn local_search_v3_query_globs_filter_candidates_inside_engine() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path();
        write_file(&root.join("src/main.rs"), "fn needle() {}\n");
        write_file(&root.join("docs/main.md"), "needle docs\n");
        let engine = LocalSearchEngine::new();
        engine.index_root(index_options(root), None).unwrap();

        let response = engine
            .search(
                LocalSearchOptions {
                    query: "needle".to_string(),
                    roots: vec![root.to_path_buf()],
                    limit: 10,
                    include_globs: vec!["src/**/*.rs".to_string()],
                    ..Default::default()
                },
                None,
            )
            .unwrap();
        assert_eq!(response.results.len(), 1);
        assert_eq!(response.results[0].display_path, "src/main.rs");
    }

    #[test]
    fn local_search_v3_searches_subdir_from_indexed_parent_root() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path();
        write_file(&root.join("project/src/main.rs"), "project needle\n");
        write_file(&root.join("other/src/main.rs"), "other needle\n");
        let engine = LocalSearchEngine::new();
        engine.index_root(index_options(root), None).unwrap();

        let response = engine
            .search(
                LocalSearchOptions {
                    query: "needle".to_string(),
                    roots: vec![root.join("project")],
                    limit: 10,
                    ..Default::default()
                },
                None,
            )
            .unwrap();
        assert_eq!(response.results.len(), 1);
        assert_eq!(response.results[0].display_path, "project/src/main.rs");
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
