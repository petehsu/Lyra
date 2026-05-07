mod defaults;
mod loader;
mod manifest;
mod merge;
pub mod types;

use crate::storage::{AiStore, CreateEffectivePolicySnapshotInput, CreatePolicySourceRecordInput};
use anyhow::{Context, Result};
pub use loader::load_policy_draft;
pub use types::{EffectivePolicy, LoadedPolicySnapshot};

pub fn load_for_turn(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    project_root: Option<&str>,
) -> Result<LoadedPolicySnapshot> {
    let draft = load_policy_draft(project_root);
    let effective_json = serde_json::to_value(&draft.effective_policy)
        .context("failed to serialize effective policy")?;
    let snapshot = store.create_effective_policy_snapshot(CreateEffectivePolicySnapshotInput {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        project_root: project_root.map(ToString::to_string),
        project_id: draft.effective_policy.project_id.clone(),
        source: draft.source.clone(),
        status: draft.status.clone(),
        manifest_path: draft.manifest_path.clone(),
        manifest_hash: draft.manifest_hash.clone(),
        effective_json,
    })?;
    for source in draft.source_records {
        store.create_policy_source_record(CreatePolicySourceRecordInput {
            session_id: session_id.to_string(),
            snapshot_id: snapshot.snapshot_id.clone(),
            layer: source.layer,
            source_ref: source.source_ref,
            status: source.status,
            hash: source.hash,
            warnings: source.warnings,
        })?;
    }
    Ok(LoadedPolicySnapshot {
        snapshot_id: snapshot.snapshot_id,
        source: snapshot.source,
        status: snapshot.status,
        effective_policy: draft.effective_policy,
    })
}
