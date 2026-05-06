use crate::storage::{policy_snapshot_ref, trim_to_string};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPolicySnapshot {
    pub snapshot_id: String,
    pub source: String,
    pub manifest_path: Option<String>,
}

pub fn read_project_policy_snapshot(project_root: Option<&str>) -> Option<ProjectPolicySnapshot> {
    let root = project_root.and_then(trim_to_string)?;
    let manifest = find_manifest(Path::new(&root));
    let snapshot_id = policy_snapshot_ref(Some(&root))?;
    Some(ProjectPolicySnapshot {
        snapshot_id,
        source: if manifest.is_some() {
            "project_manifest"
        } else {
            "product_default"
        }
        .to_string(),
        manifest_path: manifest.map(|path| path.to_string_lossy().to_string()),
    })
}

fn find_manifest(root: &Path) -> Option<PathBuf> {
    let mut current = Some(root);
    while let Some(path) = current {
        let candidate = path.join(".lyra").join("project.manifest.json");
        if fs::metadata(&candidate).is_ok() {
            return Some(candidate);
        }
        current = path.parent();
    }
    None
}
