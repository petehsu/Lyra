//! Process-global snapshot store for the Computer Tree (D2).
//!
//! `computer.map` remembers its node list under a `snapshotId` so the Agent can
//! later ask `computer.diff` for the *observation diff* between an earlier
//! snapshot and a fresh read (§3.2) — added / removed / changed controls — not
//! just a single node re-read. The store is TTL'd and bounded, mirroring the
//! browser-side `ax-snapshot-store`.
//!
//! N-API exposes stateless free functions, so the store lives behind a global
//! `Mutex`. It holds only normalized [`ComputerNode`] data (no native handles),
//! and `os_ref` remains the cross-snapshot re-resolution token — snapshots are
//! for comparison, not for addressing.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::backend::diff_nodes;
use crate::model::ComputerNode;

/// How long a snapshot stays comparable. Matches the browser AX snapshot TTL.
const SNAPSHOT_TTL: Duration = Duration::from_secs(60);
/// Upper bound on retained snapshots; oldest are evicted past this.
const MAX_SNAPSHOTS: usize = 16;

struct StoredSnapshot {
    created_at: Instant,
    nodes: Vec<ComputerNode>,
}

struct SnapshotStore {
    snapshots: HashMap<String, StoredSnapshot>,
}

impl SnapshotStore {
    fn new() -> Self {
        Self {
            snapshots: HashMap::new(),
        }
    }

    fn evict(&mut self, now: Instant) {
        self.snapshots
            .retain(|_, snapshot| now.duration_since(snapshot.created_at) <= SNAPSHOT_TTL);
        // Bound retained count by dropping the oldest snapshots.
        while self.snapshots.len() > MAX_SNAPSHOTS {
            let Some(oldest) = self
                .snapshots
                .iter()
                .min_by_key(|(_, snapshot)| snapshot.created_at)
                .map(|(id, _)| id.clone())
            else {
                break;
            };
            self.snapshots.remove(&oldest);
        }
    }

    fn remember(&mut self, snapshot_id: String, nodes: Vec<ComputerNode>) {
        let now = Instant::now();
        self.evict(now);
        self.snapshots.insert(
            snapshot_id,
            StoredSnapshot {
                created_at: now,
                nodes,
            },
        );
    }

    fn get(&self, snapshot_id: &str) -> Option<Vec<ComputerNode>> {
        let snapshot = self.snapshots.get(snapshot_id)?;
        if Instant::now().duration_since(snapshot.created_at) > SNAPSHOT_TTL {
            return None;
        }
        Some(snapshot.nodes.clone())
    }
}

fn store() -> &'static Mutex<SnapshotStore> {
    static STORE: OnceLock<Mutex<SnapshotStore>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(SnapshotStore::new()))
}

fn next_snapshot_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    let id = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("cs-{id}")
}

/// Stores `nodes` as a new snapshot and returns its id. A poisoned lock simply
/// yields a fresh id without persisting (diff degrades, map still works).
pub fn remember_snapshot(nodes: &[ComputerNode]) -> String {
    let snapshot_id = next_snapshot_id();
    if let Ok(mut guard) = store().lock() {
        guard.remember(snapshot_id.clone(), nodes.to_vec());
    }
    snapshot_id
}

/// Retrieves a stored snapshot's nodes, or `None` if missing/expired.
pub fn get_snapshot(snapshot_id: &str) -> Option<Vec<ComputerNode>> {
    store().lock().ok().and_then(|guard| guard.get(snapshot_id))
}

/// A node present in both snapshots whose observable fields changed.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeChange {
    pub os_ref: String,
    pub changes: Vec<String>,
    pub before: ComputerNode,
    pub after: ComputerNode,
}

/// The observation diff between an earlier snapshot and a fresh read (§3.2).
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservationDiff {
    /// Nodes present now but absent in the baseline.
    pub added: Vec<ComputerNode>,
    /// Nodes present in the baseline but absent now.
    pub removed: Vec<ComputerNode>,
    /// Nodes present in both whose state/value/name changed.
    pub changed: Vec<NodeChange>,
}

impl ObservationDiff {
    pub fn is_empty(&self) -> bool {
        self.added.is_empty() && self.removed.is_empty() && self.changed.is_empty()
    }
}

/// Computes the observation diff between `baseline` and `fresh`, keyed by
/// `os_ref`. Reuses [`diff_nodes`] for the per-node change summary so the
/// closed-loop vocabulary is identical to single-node act verification.
pub fn observation_diff(baseline: &[ComputerNode], fresh: &[ComputerNode]) -> ObservationDiff {
    let baseline_by_ref: HashMap<&str, &ComputerNode> = baseline
        .iter()
        .map(|node| (node.os_ref.as_str(), node))
        .collect();
    let fresh_by_ref: HashMap<&str, &ComputerNode> = fresh
        .iter()
        .map(|node| (node.os_ref.as_str(), node))
        .collect();

    let mut diff = ObservationDiff::default();

    for node in fresh {
        match baseline_by_ref.get(node.os_ref.as_str()) {
            None => diff.added.push(node.clone()),
            Some(before) => {
                let changes = diff_nodes(before, node);
                if !changes.is_empty() {
                    diff.changed.push(NodeChange {
                        os_ref: node.os_ref.clone(),
                        changes,
                        before: (*before).clone(),
                        after: node.clone(),
                    });
                }
            }
        }
    }

    for node in baseline {
        if !fresh_by_ref.contains_key(node.os_ref.as_str()) {
            diff.removed.push(node.clone());
        }
    }

    diff
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ComputerAction, ComputerNodeSource, ComputerNodeState, Platform};

    fn node(os_ref: &str, name: &str, checked: Option<bool>) -> ComputerNode {
        ComputerNode {
            os_ref: os_ref.to_string(),
            platform: Platform::Darwin,
            app: None,
            window: None,
            role: "checkbox".to_string(),
            name: name.to_string(),
            value: None,
            bounds: None,
            state: ComputerNodeState {
                checked,
                ..Default::default()
            },
            actions: vec![ComputerAction::Toggle],
            source: ComputerNodeSource::OsAx,
            secure: false,
            os_path: String::new(),
        }
    }

    #[test]
    fn observation_diff_reports_added_removed_changed() {
        let baseline = vec![
            node("osax:0/1", "Keep", Some(false)),
            node("osax:0/2", "Gone", Some(false)),
        ];
        let fresh = vec![
            node("osax:0/1", "Keep", Some(true)), // checked changed
            node("osax:0/3", "New", Some(false)), // added
        ];
        let diff = observation_diff(&baseline, &fresh);
        assert_eq!(diff.added.len(), 1);
        assert_eq!(diff.added[0].os_ref, "osax:0/3");
        assert_eq!(diff.removed.len(), 1);
        assert_eq!(diff.removed[0].os_ref, "osax:0/2");
        assert_eq!(diff.changed.len(), 1);
        assert_eq!(diff.changed[0].os_ref, "osax:0/1");
        assert!(!diff.is_empty());
    }

    #[test]
    fn store_round_trips_a_snapshot() {
        let nodes = vec![node("osax:0/1", "A", None)];
        let id = remember_snapshot(&nodes);
        let restored = get_snapshot(&id).expect("snapshot present");
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].os_ref, "osax:0/1");
        assert!(get_snapshot("cs-does-not-exist").is_none());
    }
}
