use crate::storage::{trim_to_string, AiStore, StorageRequest};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadArtifactRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    pub session_id: String,
    #[serde(default)]
    pub artifact_id: Option<String>,
    #[serde(default)]
    pub patch_ref: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentPatchChangedFile {
    pub path: String,
    pub change_type: String,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentArtifactContent {
    pub kind: String,
    pub artifact_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_id: Option<String>,
    pub patch_ref: String,
    pub title: String,
    pub content: String,
    pub content_sha256: String,
    pub content_bytes: i64,
    pub changed_files: Vec<AgentPatchChangedFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_preview: Option<Value>,
    pub created_at: i64,
}

pub fn read_artifact(request: ReadArtifactRequest) -> Result<AgentArtifactContent> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    let session_id = request.session_id.as_str().trim().to_string();
    if session_id.is_empty() {
        return Err(anyhow!("sessionId is required"));
    }
    let artifact_id = request.artifact_id.as_deref().and_then(trim_to_string);
    let patch_ref = request.patch_ref.as_deref().and_then(trim_to_string);
    if artifact_id.is_some() == patch_ref.is_some() {
        return Err(anyhow!("Provide exactly one of artifactId or patchRef"));
    }
    let record = store
        .read_diff_artifact_blob(&session_id, artifact_id.as_deref(), patch_ref.as_deref())?
        .ok_or_else(|| anyhow!("AI diff artifact not found"))?;
    let changed_files = record
        .metadata
        .get("changedFiles")
        .cloned()
        .map(serde_json::from_value)
        .transpose()?
        .unwrap_or_default();
    let approval_preview = record.metadata.get("approvalPreview").cloned();
    Ok(AgentArtifactContent {
        kind: "diff".to_string(),
        artifact_id: record.artifact_id,
        evidence_id: record.evidence_id,
        patch_ref: record.content_ref,
        title: record.title,
        content: record.content,
        content_sha256: record.content_sha256,
        content_bytes: record.content_bytes,
        changed_files,
        approval_preview,
        created_at: record.created_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{new_id, now_ms, AgentSession};
    use serde_json::json;

    fn seed_session(store: &AiStore) -> String {
        let session_id = new_id("session");
        let now = now_ms();
        store
            .upsert_session_index(&AgentSession {
                id: session_id.clone(),
                title: "Artifact test".to_string(),
                profile_id: None,
                project_root: None,
                project_name: None,
                collaboration_mode: "default".to_string(),
                created_at: now,
                updated_at: now,
            })
            .expect("session");
        store
            .with_session_conn(&session_id, |_| Ok(()))
            .expect("db");
        session_id
    }

    fn seed_diff_artifact(store: &AiStore, session_id: &str) -> (String, String, String) {
        let patch = "--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n # Demo\n+Preview line\n";
        let blob = store
            .append_tool_result_blob(
                session_id,
                "turn-test",
                "op-propose",
                "/tools/filesystem/propose_patch",
                "completed",
                patch,
            )
            .expect("blob");
        let refs = store
            .append_patch_artifact_and_evidence(
                session_id,
                "turn-test",
                "op-propose",
                "Update README",
                &blob.result_ref,
                json!({
                    "changedFiles": [{
                        "path": "README.md",
                        "changeType": "modified",
                        "additions": 1,
                        "deletions": 0
                    }],
                    "approvalPreview": {
                        "risk": { "level": "medium" }
                    }
                }),
                json!([{
                    "path": "README.md",
                    "changeType": "modified",
                    "additions": 1,
                    "deletions": 0
                }]),
            )
            .expect("artifact");
        (refs.artifact_id, refs.evidence_id, blob.result_ref)
    }

    #[test]
    fn reads_diff_artifact_by_artifact_id_and_patch_ref() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = AiStore::open(Some(temp.path().to_string_lossy().as_ref())).expect("store");
        let session_id = seed_session(&store);
        let (artifact_id, evidence_id, patch_ref) = seed_diff_artifact(&store, &session_id);

        let by_artifact = read_artifact(ReadArtifactRequest {
            storage: StorageRequest {
                storage_root: Some(temp.path().to_string_lossy().to_string()),
            },
            session_id: session_id.clone(),
            artifact_id: Some(artifact_id.clone()),
            patch_ref: None,
        })
        .expect("read by artifact");
        assert_eq!(by_artifact.kind, "diff");
        assert_eq!(by_artifact.artifact_id, artifact_id);
        assert_eq!(
            by_artifact.evidence_id.as_deref(),
            Some(evidence_id.as_str())
        );
        assert_eq!(by_artifact.patch_ref, patch_ref);
        assert!(by_artifact.content.contains("+Preview line"));
        assert_eq!(by_artifact.changed_files[0].path, "README.md");
        assert_eq!(
            by_artifact.approval_preview.as_ref().unwrap()["risk"]["level"],
            "medium"
        );

        let by_ref = read_artifact(ReadArtifactRequest {
            storage: StorageRequest {
                storage_root: Some(temp.path().to_string_lossy().to_string()),
            },
            session_id,
            artifact_id: None,
            patch_ref: Some(by_artifact.patch_ref),
        })
        .expect("read by ref");
        assert_eq!(by_ref.artifact_id, by_artifact.artifact_id);
    }

    #[test]
    fn rejects_invalid_or_unsafe_artifact_reads() {
        let temp = tempfile::tempdir().expect("tempdir");
        let storage_root = temp.path().to_string_lossy().to_string();
        let store = AiStore::open(Some(storage_root.as_str())).expect("store");
        let session_id = seed_session(&store);
        let other_session_id = seed_session(&store);
        let (artifact_id, _, patch_ref) = seed_diff_artifact(&store, &session_id);

        assert!(read_artifact(ReadArtifactRequest {
            storage: StorageRequest {
                storage_root: Some(storage_root.clone()),
            },
            session_id: session_id.clone(),
            artifact_id: Some(artifact_id.clone()),
            patch_ref: Some(patch_ref.clone()),
        })
        .is_err());
        assert!(read_artifact(ReadArtifactRequest {
            storage: StorageRequest {
                storage_root: Some(storage_root.clone()),
            },
            session_id: other_session_id,
            artifact_id: None,
            patch_ref: Some(patch_ref.clone()),
        })
        .is_err());
        assert!(read_artifact(ReadArtifactRequest {
            storage: StorageRequest {
                storage_root: Some(storage_root.clone()),
            },
            session_id: session_id.clone(),
            artifact_id: None,
            patch_ref: Some("tool_result_missing".to_string()),
        })
        .is_err());

        let orphan = store
            .append_tool_result_blob(
                &session_id,
                "turn-test",
                "op-orphan",
                "/tools/filesystem/propose_patch",
                "completed",
                "--- a/README.md\n+++ b/README.md\n",
            )
            .expect("orphan");
        assert!(read_artifact(ReadArtifactRequest {
            storage: StorageRequest {
                storage_root: Some(storage_root),
            },
            session_id,
            artifact_id: None,
            patch_ref: Some(orphan.result_ref),
        })
        .is_err());
    }
}
