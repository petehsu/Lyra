use crate::types::IndexSnapshot;
use std::fs;
use std::path::{Path, PathBuf};

pub fn snapshot_file(storage_root: &Path) -> PathBuf {
    storage_root.join("code-intel").join("index.v2.json")
}

pub fn load_snapshot(path: &Path) -> Result<Option<IndexSnapshot>, String> {
    if path.exists() == false {
        return Ok(None);
    }
    let bytes = fs::read(path)
        .map_err(|error| format!("failed to read index snapshot {}: {error}", path.display()))?;
    let snapshot: IndexSnapshot = serde_json::from_slice(&bytes).map_err(|error| {
        format!(
            "failed to decode index snapshot {}: {error}",
            path.display()
        )
    })?;
    Ok(Some(snapshot))
}

pub fn save_snapshot(path: &Path, snapshot: &IndexSnapshot) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create index directory {}: {error}",
                parent.display()
            )
        })?;
    }
    let bytes = serde_json::to_vec(snapshot)
        .map_err(|error| format!("failed to encode index snapshot: {error}"))?;
    fs::write(path, bytes)
        .map_err(|error| format!("failed to write index snapshot {}: {error}", path.display()))?;
    Ok(())
}
