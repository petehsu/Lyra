use crate::policy::*;
use crate::types::*;
use lyra_local_search::{LocalSearchIndexState, LocalSearchSkippedStats, LocalSearchStatus};
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

const LOCAL_SEARCH_SNAPSHOT_VERSION: u32 = 4;

pub(crate) fn to_index_status(
    status: LocalSearchStatus,
    index_running: bool,
    current_policy: Option<&ResolvedSearchPolicy>,
) -> SearchIndexStatusResponse {
    let last_built_at = status
        .roots
        .iter()
        .filter_map(|root| root.last_indexed_at)
        .max()
        .map(|value| value.to_string());
    let error = status.roots.iter().find_map(|root| root.error.clone());
    let policy_mismatch = current_policy
        .is_some_and(|policy| status.policy_hash.as_deref() != Some(policy.hash.as_str()));
    let mut policy_warnings = current_policy
        .map(|policy| policy.warnings.clone())
        .unwrap_or_else(|| status.policy_warnings.clone());
    if policy_mismatch {
        policy_warnings.push("local search index policy does not match active policy".to_string());
    }
    let state = if index_running {
        SearchIndexState::Building
    } else if policy_mismatch {
        SearchIndexState::Idle
    } else if status.indexed_file_count == 0
        && matches!(
            status.state,
            LocalSearchIndexState::Ready | LocalSearchIndexState::Partial
        )
    {
        SearchIndexState::Idle
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
            state: if policy_mismatch {
                SearchIndexState::Idle
            } else if root.indexed_file_count == 0
                && matches!(
                    root.state,
                    LocalSearchIndexState::Ready | LocalSearchIndexState::Partial
                )
            {
                SearchIndexState::Idle
            } else {
                to_search_index_state(root.state, false)
            },
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
        phase: if policy_mismatch && !index_running {
            "policy_mismatch".to_string()
        } else {
            status.phase
        },
        policy_hash: current_policy
            .map(|policy| policy.hash.clone())
            .or_else(|| status.policy_hash.clone()),
        policy_source: current_policy
            .map(|policy| policy.source.clone())
            .unwrap_or_else(|| status.policy_source.clone()),
        policy_warnings,
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
    #[serde(default, alias = "snapshotVersion")]
    snapshot_version: Option<u32>,
    #[serde(default)]
    phase: Option<String>,
    #[serde(default, alias = "policyHash")]
    policy_hash: Option<String>,
    #[serde(default, alias = "policySource")]
    policy_source: Vec<String>,
    #[serde(default, alias = "policyWarnings")]
    policy_warnings: Vec<String>,
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
    if roots.iter().any(|root| {
        root.indexed_file_count > 0 && disk_search_state(&root.state) == SearchIndexState::Ready
    }) {
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
        policy_hash: None,
        policy_source: Vec::new(),
        policy_warnings: Vec::new(),
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

pub(crate) fn read_disk_search_index_status(
    storage_root: Option<&str>,
) -> Option<SearchIndexStatusResponse> {
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
    if meta.snapshot_version != Some(LOCAL_SEARCH_SNAPSHOT_VERSION) {
        return Some(disk_status_error(
            storage_root,
            format!(
                "local search snapshot version is {:?}, expected {}",
                meta.snapshot_version, LOCAL_SEARCH_SNAPSHOT_VERSION
            ),
        ));
    }
    let current_policy = resolve_search_policy(
        &module_storage_root_for(storage_root),
        &home_directory().into_iter().collect::<Vec<_>>(),
        None,
    );
    let policy_mismatch = meta.policy_hash.as_deref() != Some(current_policy.hash.as_str());
    let mut policy_warnings = current_policy.warnings.clone();
    policy_warnings.extend(meta.policy_warnings.clone());
    if policy_mismatch {
        policy_warnings.push("local search index policy does not match active policy".to_string());
        if !meta.policy_source.is_empty() {
            policy_warnings.push(format!(
                "stored search policy source: {}",
                meta.policy_source.join(", ")
            ));
        }
    }
    let state = if policy_mismatch {
        SearchIndexState::Idle
    } else {
        aggregate_disk_search_state(&meta.roots)
    };
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
                state: if policy_mismatch {
                    SearchIndexState::Idle
                } else if root.indexed_file_count == 0
                    && disk_search_state(&root.state) == SearchIndexState::Ready
                {
                    SearchIndexState::Idle
                } else {
                    disk_search_state(&root.state)
                },
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
        phase: if policy_mismatch {
            "policy_mismatch".to_string()
        } else {
            meta.phase.unwrap_or_else(|| {
                match state {
                    SearchIndexState::Idle => "idle",
                    SearchIndexState::Building => "indexing",
                    SearchIndexState::Ready => "ready",
                    SearchIndexState::Failed => "failed",
                }
                .to_string()
            })
        },
        policy_hash: Some(current_policy.hash),
        policy_source: current_policy.source,
        policy_warnings,
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
