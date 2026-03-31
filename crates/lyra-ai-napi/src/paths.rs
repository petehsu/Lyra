use std::fs::create_dir_all;
use std::path::PathBuf;

use napi::Result;

use crate::error::{normalize_required_text, to_error};

#[derive(Clone, Debug)]
pub struct AiPaths {
    pub storage_root: PathBuf,
    pub db_root: PathBuf,
    pub registry_db_path: PathBuf,
    pub sessions_root: PathBuf,
    pub shared_root: PathBuf,
    pub runtime_root: PathBuf,
    pub metrics_root: PathBuf,
}

pub fn resolve_ai_paths(storage_root: &str) -> Result<AiPaths> {
    let normalized = normalize_required_text(storage_root, "storageRoot")?;
    let root = PathBuf::from(normalized);
    let db_root = root.join("db");
    Ok(AiPaths {
        storage_root: root.clone(),
        db_root: db_root.clone(),
        registry_db_path: db_root.join("ai.v1.sqlite"),
        sessions_root: root.join("sessions"),
        shared_root: root.join("shared"),
        runtime_root: root.join("runtime"),
        metrics_root: root.join("metrics"),
    })
}

pub fn ensure_ai_dirs(paths: &AiPaths) -> Result<()> {
    for directory in [
        &paths.storage_root,
        &paths.db_root,
        &paths.sessions_root,
        &paths.shared_root,
        &paths.runtime_root,
        &paths.metrics_root,
    ] {
        create_dir_all(directory).map_err(|error| {
            to_error(format!(
                "failed to create ai storage directory {}: {error}",
                directory.display()
            ))
        })?;
    }
    Ok(())
}

pub fn resolve_session_dir(paths: &AiPaths, session_id: &str) -> PathBuf {
    paths.sessions_root.join(session_id)
}

pub fn resolve_session_db_path(paths: &AiPaths, session_id: &str) -> PathBuf {
    resolve_session_dir(paths, session_id).join("session.sqlite")
}

pub fn ensure_session_dir(paths: &AiPaths, session_id: &str) -> Result<PathBuf> {
    let directory = resolve_session_dir(paths, session_id);
    create_dir_all(&directory).map_err(|error| {
        to_error(format!(
            "failed to create ai session directory {}: {error}",
            directory.display()
        ))
    })?;
    Ok(directory)
}
