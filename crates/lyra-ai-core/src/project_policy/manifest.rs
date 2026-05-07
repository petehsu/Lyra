use super::types::ProjectManifest;
use anyhow::{anyhow, Context, Result};
use std::fs;
use std::path::{Path, PathBuf};

pub fn find_manifest(root: &Path) -> Option<PathBuf> {
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

pub fn read_manifest(path: &Path) -> Result<ProjectManifest> {
    let content = fs::read_to_string(path)
        .with_context(|| format!("failed to read project manifest {}", path.display()))?;
    let manifest: ProjectManifest = serde_json::from_str(&content)
        .with_context(|| format!("failed to parse project manifest {}", path.display()))?;
    validate_schema_version(&manifest)?;
    Ok(manifest)
}

pub fn validate_schema_version(manifest: &ProjectManifest) -> Result<()> {
    let Some(value) = manifest.schema_version.as_ref() else {
        return Ok(());
    };
    let supported = match value {
        serde_json::Value::String(text) => {
            matches!(
                text.as_str(),
                "v1" | "1" | "lyra.project.manifest.v1" | "2026-05-07"
            )
        }
        serde_json::Value::Number(number) => number.as_i64() == Some(1),
        _ => false,
    };
    if supported {
        Ok(())
    } else {
        Err(anyhow!(
            "unsupported project manifest schemaVersion: {value}"
        ))
    }
}
