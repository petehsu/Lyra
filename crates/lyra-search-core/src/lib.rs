mod policy;
mod query;
mod service;
mod status;
mod stream;
mod types;

pub use status::search_index_status_is_ready;
pub use stream::{
    search_local_stream_cancel_json, search_local_stream_read_json, search_local_stream_start_json,
};
pub use types::*;

use policy::*;
#[cfg(test)]
use query::*;
use service::*;
use status::*;
#[cfg(test)]
use stream::*;

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

pub fn search_local_blocking_json(request_json: String) -> Result<String, String> {
    let request: SearchLocalRequest =
        serde_json::from_str(&request_json).map_err(|error| format!("invalid request: {error}"))?;
    if request.query.trim().is_empty() {
        return Err("query is required".to_string());
    }
    let service = service_for_request_with_background(request.storage_root.as_deref(), false)?;
    let response = service.search_ready_only(&request, clamp_limit(request.limit))?;
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
        if status.snapshot_bytes > 0 && search_index_status_is_ready(&status) {
            spawn_service_warmup(request.storage_root.clone());
        }
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
    use lyra_local_search::{
        LocalSearchContentMode, LocalSearchEngine, LocalSearchIndexRootOptions,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::AtomicBool;
    use std::sync::{Arc, RwLock};
    use uuid::Uuid;

    fn test_policy() -> ResolvedSearchPolicy {
        let policy = default_policy();
        ResolvedSearchPolicy {
            hash: stable_policy_hash(&policy),
            policy,
            source: vec!["test".to_string()],
            warnings: Vec::new(),
        }
    }

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
        let policy_hash = stable_policy_hash(&default_policy());
        fs::write(
            native_dir.join("meta.json"),
            serde_json::json!({
                "engineVersion": "native-v3",
                "snapshotVersion": 4,
                "policyHash": policy_hash,
                "policySource": ["test"],
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
    fn disk_index_status_does_not_treat_empty_ready_meta_as_usable() {
        let dir = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let native_dir = dir.path().join("search-v3/native");
        fs::create_dir_all(&native_dir).unwrap_or_else(|error| panic!("{error}"));
        let policy_hash = stable_policy_hash(&default_policy());
        fs::write(
            native_dir.join("meta.json"),
            serde_json::json!({
                "engineVersion": "native-v3",
                "snapshotVersion": 4,
                "policyHash": policy_hash,
                "policySource": ["test"],
                "phase": "ready",
                "pendingChanges": 0,
                "roots": [{
                    "root": dir.path().to_string_lossy(),
                    "state": "ready",
                    "indexedFileCount": 0,
                    "indexedDirCount": 0,
                    "indexedContentFileCount": 0,
                    "contentBytesIndexed": 0,
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
        assert_eq!(parsed["state"], "idle");
        assert_eq!(parsed["roots"][0]["state"], "idle");
        assert!(!search_index_ready(Some(&dir.path().to_string_lossy())).unwrap());
    }

    #[test]
    fn search_policy_merges_global_project_and_request_overrides() {
        let storage = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let project = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let project_policy_dir = project.path().join(".lyra");
        fs::create_dir_all(&project_policy_dir).unwrap_or_else(|error| panic!("{error}"));
        fs::write(
            storage.path().join(SEARCH_POLICY_FILE_NAME),
            serde_json::json!({
                "index": {
                    "excludeDirs": ["node_modules", "dist"],
                    "maxContentFileBytes": 131072
                },
                "query": {
                    "mode": "fast",
                    "excludeGlobs": ["**/*.snap"]
                }
            })
            .to_string(),
        )
        .unwrap_or_else(|error| panic!("{error}"));
        fs::write(
            project_policy_dir.join("search-policy.json"),
            serde_json::json!({
                "index": { "textExtensions": ["rs", "mdx"] },
                "query": { "includeGlobs": ["src/**/*.rs"], "enableContent": true }
            })
            .to_string(),
        )
        .unwrap_or_else(|error| panic!("{error}"));

        let request = SearchLocalRequest {
            query: "needle".to_string(),
            limit: Some(20),
            context: SearchContext::default(),
            scope_preset: SearchLocalScopePreset::Custom,
            custom_roots: vec![project.path().to_string_lossy().to_string()],
            project_root: None,
            mode: Some(SearchLocalMode::Full),
            include_hidden: Some(true),
            include_vendor: None,
            respect_gitignore: None,
            follow_symlinks: None,
            include_globs: Vec::new(),
            exclude_globs: vec!["target/**".to_string()],
            exclude_dirs: Vec::new(),
            text_extensions: Vec::new(),
            max_content_file_bytes: None,
            content_budget_bytes: None,
            max_candidates: Some(777),
            enable_fuzzy: None,
            enable_content: None,
            enable_extension_match: None,
            storage_root: Some(storage.path().to_string_lossy().to_string()),
        };
        let policy = resolve_search_policy(
            storage.path(),
            &[project.path().to_path_buf()],
            Some(&request),
        );
        assert_eq!(
            policy.policy.index.exclude_dirs,
            vec!["node_modules", "dist"]
        );
        assert_eq!(policy.policy.index.text_extensions, vec!["rs", "mdx"]);
        assert!(policy.policy.index.include_hidden);
        assert_eq!(policy.policy.query.mode, SearchLocalMode::Full);
        assert_eq!(policy.policy.query.include_globs, vec!["src/**/*.rs"]);
        assert_eq!(
            policy.policy.query.exclude_globs,
            vec!["**/*.snap", "target/**"]
        );
        assert_eq!(policy.policy.query.max_candidates, Some(777));
        assert!(policy.source.iter().any(|source| source == "request"));
    }

    #[test]
    fn query_only_overrides_do_not_change_index_policy_hash() {
        let storage = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let project = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let baseline = resolve_search_policy(storage.path(), &[project.path().to_path_buf()], None);
        let query_request = SearchLocalRequest {
            query: "needle".to_string(),
            limit: Some(20),
            context: SearchContext::default(),
            scope_preset: SearchLocalScopePreset::Custom,
            custom_roots: vec![project.path().to_string_lossy().to_string()],
            project_root: None,
            mode: Some(SearchLocalMode::Full),
            include_hidden: None,
            include_vendor: None,
            respect_gitignore: None,
            follow_symlinks: None,
            include_globs: vec!["src/**/*.rs".to_string()],
            exclude_globs: vec!["target/**".to_string()],
            exclude_dirs: Vec::new(),
            text_extensions: Vec::new(),
            max_content_file_bytes: None,
            content_budget_bytes: None,
            max_candidates: Some(777),
            enable_fuzzy: Some(false),
            enable_content: Some(false),
            enable_extension_match: Some(false),
            storage_root: Some(storage.path().to_string_lossy().to_string()),
        };
        let query_policy = resolve_search_policy(
            storage.path(),
            &[project.path().to_path_buf()],
            Some(&query_request),
        );
        assert_eq!(query_policy.hash, baseline.hash);

        let index_request = SearchLocalRequest {
            include_hidden: Some(true),
            ..query_request
        };
        let index_policy = resolve_search_policy(
            storage.path(),
            &[project.path().to_path_buf()],
            Some(&index_request),
        );
        assert_ne!(index_policy.hash, baseline.hash);
    }

    #[test]
    fn disk_status_marks_policy_hash_mismatch_not_ready() {
        let dir = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let native_dir = dir.path().join("search-v3/native");
        fs::create_dir_all(&native_dir).unwrap_or_else(|error| panic!("{error}"));
        fs::write(
            native_dir.join("meta.json"),
            serde_json::json!({
                "engineVersion": "native-v3",
                "snapshotVersion": 4,
                "policyHash": "old-policy",
                "policySource": ["old"],
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
        assert_eq!(parsed["state"], "idle");
        assert_eq!(parsed["phase"], "policy_mismatch");
        assert!(!search_index_ready(Some(&dir.path().to_string_lossy())).unwrap());
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
                    max_file_size_bytes: DEFAULT_TEXT_LIMIT_BYTES,
                    ..Default::default()
                },
                None,
            )
            .unwrap_or_else(|error| panic!("{error}"));

        let policy = test_policy();
        let output = search_local_index(
            engine,
            vec![dir.path().to_path_buf()],
            &policy,
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
                    max_file_size_bytes: DEFAULT_TEXT_LIMIT_BYTES,
                    ..Default::default()
                },
                None,
            )
            .unwrap_or_else(|error| panic!("{error}"));

        let policy = test_policy();
        let output = search_local_index(
            engine,
            vec![dir.path().to_path_buf()],
            &policy,
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
            policy_hash: None,
            policy_source: Vec::new(),
            policy_warnings: Vec::new(),
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
