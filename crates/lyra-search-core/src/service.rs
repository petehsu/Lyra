use crate::policy::*;
use crate::query::*;
use crate::status::to_index_status;
use crate::types::*;
use lyra_local_search::{
    LocalSearchApplyChangesOptions, LocalSearchContentMode, LocalSearchEngine,
    LocalSearchEngineConfig, LocalSearchIndexRootOptions, LocalSearchIndexState,
    LocalSearchStorageMode,
};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, OnceLock, RwLock};
use std::thread;
use std::time::{Duration, Instant};

pub(crate) const DEFAULT_RESULT_LIMIT: usize = 48;

pub(crate) const MAX_RESULT_LIMIT: usize = 300;

const PROVIDER_JOIN_TIMEOUT: Duration = Duration::from_millis(2_750);

const WATCHER_APPLY_DEBOUNCE: Duration = Duration::from_secs(2);

const WATCHER_REBUILD_EVENT_THRESHOLD: usize = 1_000;

pub(crate) struct SearchCoreService {
    pub(crate) engine: Arc<LocalSearchEngine>,
    pub(crate) home_root: PathBuf,
    pub(crate) storage_root: PathBuf,
    pub(crate) engine_storage_root: PathBuf,
    pub(crate) background_started: AtomicBool,
    pub(crate) index_running: AtomicBool,
    pub(crate) watcher_started: AtomicBool,
}

pub(crate) static SEARCH_SERVICES: OnceLock<RwLock<HashMap<String, Arc<SearchCoreService>>>> =
    OnceLock::new();

static SEARCH_WARMUPS: OnceLock<RwLock<HashSet<String>>> = OnceLock::new();

pub(crate) fn service_store() -> &'static RwLock<HashMap<String, Arc<SearchCoreService>>> {
    SEARCH_SERVICES.get_or_init(|| RwLock::new(HashMap::new()))
}

pub(crate) fn warmup_store() -> &'static RwLock<HashSet<String>> {
    SEARCH_WARMUPS.get_or_init(|| RwLock::new(HashSet::new()))
}

pub(crate) fn clamp_limit(value: Option<usize>) -> usize {
    value
        .unwrap_or(DEFAULT_RESULT_LIMIT)
        .max(1)
        .min(MAX_RESULT_LIMIT)
}

pub(crate) fn service_for_request(
    storage_root: Option<&str>,
) -> Result<Arc<SearchCoreService>, String> {
    service_for_request_with_background(storage_root, true)
}

pub(crate) fn service_for_request_with_background(
    storage_root: Option<&str>,
    start_background: bool,
) -> Result<Arc<SearchCoreService>, String> {
    let home_root = home_directory().ok_or_else(|| "home directory is unavailable".to_string())?;
    let module_storage_root = module_storage_root_for(storage_root);
    let engine_storage_root = module_storage_root.join(SEARCH_V3_STORAGE_DIR);
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
        storage_root: module_storage_root,
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

pub(crate) fn existing_service_for_request(
    storage_root: Option<&str>,
) -> Option<Arc<SearchCoreService>> {
    let key = normalize_path_string(&engine_storage_root_for(storage_root));
    service_store()
        .read()
        .ok()
        .and_then(|guard| guard.get(&key).cloned())
}

pub(crate) fn spawn_service_warmup(storage_root: Option<String>) {
    let key = normalize_path_string(&engine_storage_root_for(storage_root.as_deref()));
    if existing_service_for_request(storage_root.as_deref()).is_some() {
        return;
    }
    {
        let Ok(mut warmups) = warmup_store().write() else {
            return;
        };
        if !warmups.insert(key.clone()) {
            return;
        }
    }
    thread::spawn(move || {
        let _ = service_for_request_with_background(storage_root.as_deref(), true);
        if let Ok(mut warmups) = warmup_store().write() {
            warmups.remove(&key);
        }
    });
}

impl SearchCoreService {
    pub(crate) fn policy_for_roots(
        &self,
        roots: &[PathBuf],
        request: Option<&SearchLocalRequest>,
    ) -> ResolvedSearchPolicy {
        resolve_search_policy(&self.storage_root, roots, request)
    }

    pub(crate) fn home_policy(&self) -> ResolvedSearchPolicy {
        self.policy_for_roots(std::slice::from_ref(&self.home_root), None)
    }

    pub(crate) fn index_options_for_root(
        &self,
        root: PathBuf,
        policy: &ResolvedSearchPolicy,
        content_mode: LocalSearchContentMode,
    ) -> LocalSearchIndexRootOptions {
        LocalSearchIndexRootOptions {
            root,
            include_hidden: policy.policy.index.include_hidden,
            include_vendor: policy.policy.index.include_vendor,
            respect_gitignore: policy.policy.index.respect_gitignore,
            follow_symlinks: policy.policy.index.follow_symlinks,
            exclude_dirs: policy.policy.index.exclude_dirs.clone(),
            exclude_globs: policy.policy.index.exclude_globs.clone(),
            text_extensions: policy.policy.index.text_extensions.clone(),
            content_mode,
            max_file_size_bytes: policy.policy.index.max_content_file_bytes,
            content_budget_bytes: policy.policy.index.content_budget_bytes,
            policy_hash: Some(policy.hash.clone()),
            policy_source: policy.source.clone(),
            policy_warnings: policy.warnings.clone(),
        }
    }

    pub(crate) fn ensure_background_started(self: &Arc<Self>) {
        if self
            .background_started
            .compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed)
            .is_err()
        {
            return;
        }

        let policy = self.home_policy();
        if !self.root_is_ready_for_policy(&self.home_root, &policy, true) {
            self.spawn_index_job_for_root_with_policy(self.home_root.clone(), policy);
        }
        self.spawn_watcher();
    }

    pub(crate) fn root_is_ready_for_policy(
        &self,
        root: &Path,
        policy: &ResolvedSearchPolicy,
        require_content: bool,
    ) -> bool {
        self.root_status_covering(root).is_some_and(|root_status| {
            if root_status.indexed_file_count == 0 {
                return false;
            }
            let engine_status = self.engine.status();
            if engine_status.policy_hash.as_deref() != Some(policy.hash.as_str()) {
                return false;
            }
            matches!(
                root_status.state,
                LocalSearchIndexState::Ready | LocalSearchIndexState::Partial
            ) && (!require_content
                || root_status.indexed_file_count == 0
                || root_status.indexed_content_file_count > 0)
        })
    }

    pub(crate) fn root_is_ready_for_request(
        &self,
        root: &Path,
        _request: &SearchLocalRequest,
        policy: &ResolvedSearchPolicy,
    ) -> bool {
        let Some(status) = self.root_status_covering(root) else {
            return false;
        };
        if self.engine.status().policy_hash.as_deref() != Some(policy.hash.as_str()) {
            return false;
        }
        if !matches!(
            status.state,
            LocalSearchIndexState::Ready | LocalSearchIndexState::Partial
        ) {
            return false;
        }
        if status.indexed_file_count == 0 {
            return false;
        }
        if policy.policy.query.enable_content
            && status.indexed_file_count > 0
            && status.indexed_content_file_count == 0
        {
            return false;
        }
        true
    }

    pub(crate) fn root_status_covering(
        &self,
        root: &Path,
    ) -> Option<lyra_local_search::LocalSearchRootStatus> {
        self.engine
            .status()
            .roots
            .into_iter()
            .find(|status| path_covers(root, &status.root))
    }

    pub(crate) fn spawn_index_job(self: &Arc<Self>) {
        self.spawn_index_job_for_root_with_policy(self.home_root.clone(), self.home_policy());
    }

    pub(crate) fn spawn_index_job_for_root_with_policy(
        self: &Arc<Self>,
        root: PathBuf,
        policy: ResolvedSearchPolicy,
    ) {
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
                service.index_options_for_root(root, &policy, LocalSearchContentMode::Auto),
                None,
            );
            service.index_running.store(false, Ordering::Relaxed);
        });
    }

    pub(crate) fn ensure_roots_ready_for_request(
        &self,
        roots: &[PathBuf],
        request: &SearchLocalRequest,
        policy: &ResolvedSearchPolicy,
    ) -> Result<(), String> {
        for root in roots {
            if self.root_is_ready_for_request(root, request, policy) {
                continue;
            }
            return Err(format!(
                "local_search_root_not_indexed: {} is not indexed with the active search policy",
                normalize_path_string(root)
            ));
        }
        Ok(())
    }

    pub(crate) fn spawn_watcher(self: &Arc<Self>) {
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
                let policy = service.home_policy();
                let _ = service.engine.apply_changes(
                    LocalSearchApplyChangesOptions {
                        paths,
                        ..LocalSearchApplyChangesOptions::from(service.index_options_for_root(
                            service.home_root.clone(),
                            &policy,
                            LocalSearchContentMode::Auto,
                        ))
                    },
                    None,
                );
            }
        });
    }

    pub(crate) fn search(
        self: &Arc<Self>,
        request: &SearchLocalRequest,
        limit: usize,
    ) -> SearchLocalResponse {
        self.search_with_updates(request, limit, |_| {})
    }

    pub(crate) fn search_with_updates(
        self: &Arc<Self>,
        request: &SearchLocalRequest,
        limit: usize,
        mut on_update: impl FnMut(SearchLocalResponse),
    ) -> SearchLocalResponse {
        self.search_with_updates_internal(request, limit, true, &mut on_update)
    }

    pub(crate) fn search_ready_only(
        self: &Arc<Self>,
        request: &SearchLocalRequest,
        limit: usize,
    ) -> Result<SearchLocalResponse, String> {
        let search_roots = self.roots_for_request(request);
        let policy = self.policy_for_roots(&search_roots, Some(request));
        self.ensure_roots_ready_for_request(&search_roots, request, &policy)?;
        let mut noop = |_| {};
        Ok(self.search_with_updates_internal(request, limit, false, &mut noop))
    }

    pub(crate) fn search_with_updates_internal(
        self: &Arc<Self>,
        request: &SearchLocalRequest,
        limit: usize,
        allow_background_index: bool,
        on_update: &mut impl FnMut(SearchLocalResponse),
    ) -> SearchLocalResponse {
        let started_at = Instant::now();
        let query = request.query.trim().to_string();
        let scope_preset = request.scope_preset;
        let search_roots = self.roots_for_request(request);
        let policy = self.policy_for_roots(&search_roots, Some(request));
        for root in &search_roots {
            if allow_background_index && !self.root_is_ready_for_request(root, request, &policy) {
                self.spawn_index_job_for_root_with_policy(root.clone(), policy.clone());
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
            let query = query.clone();
            let policy = policy.clone();
            thread::spawn(move || {
                let provider_started = Instant::now();
                let output = search_local_index(engine, roots, &policy, query, limit);
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

    pub(crate) fn roots_for_request(&self, request: &SearchLocalRequest) -> Vec<PathBuf> {
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

    pub(crate) fn index_status(&self) -> SearchIndexStatusResponse {
        let policy = self.home_policy();
        to_index_status(
            self.engine.status(),
            self.index_running.load(Ordering::Relaxed),
            Some(&policy),
        )
    }
}
