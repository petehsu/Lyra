use super::*;

struct WorkspaceSnapshotFile {
    path: String,
    exists_at_snapshot: bool,
    content_ref: Option<String>,
    unavailable_reason: Option<String>,
}

enum WorkspaceRestoreAction {
    Write {
        path: String,
        target_path: PathBuf,
        content: Vec<u8>,
    },
    Remove {
        path: String,
        target_path: PathBuf,
    },
}

pub(super) fn restore_workspace_snapshot_changes(
    store: &AiStore,
    conn: &Connection,
    session_id: &str,
    workspace_snapshot_id: &str,
    changes: &[RestoreWorkspaceChange],
) -> Result<RestoreWorkspaceResult> {
    if changes.is_empty() {
        return Ok(RestoreWorkspaceResult {
            restored_workspace_snapshot_id: Some(workspace_snapshot_id.to_string()),
            restored_paths: Vec::new(),
        });
    }
    let workspace_root = conn
        .query_row(
            "SELECT workspace_root FROM workspace_snapshot WHERE workspace_snapshot_id = ?1",
            params![workspace_snapshot_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .context("failed to read workspace snapshot root")?
        .flatten()
        .and_then(|value| trim_to_string(&value))
        .ok_or_else(|| anyhow!("TOOL_ROLLBACK_CONFLICT: workspace snapshot root is unavailable"))?;
    let root = Path::new(&workspace_root);
    let canonical_root = root
        .canonicalize()
        .with_context(|| format!("failed to canonicalize workspace root {}", root.display()))?;
    let mut actions = Vec::new();
    for change in changes {
        let target_path = safe_workspace_path(root, &canonical_root, &change.path)?;
        validate_expected_workspace_state(&target_path, change.expected_hash.as_deref())?;
        let snapshot = read_workspace_snapshot_file(conn, workspace_snapshot_id, &change.path)?;
        if snapshot.exists_at_snapshot {
            let content = read_snapshot_content(store, session_id, &snapshot)?;
            actions.push(WorkspaceRestoreAction::Write {
                path: change.path.clone(),
                target_path,
                content,
            });
        } else {
            actions.push(WorkspaceRestoreAction::Remove {
                path: change.path.clone(),
                target_path,
            });
        }
    }
    let mut restored_paths = Vec::new();
    for action in actions {
        match action {
            WorkspaceRestoreAction::Write {
                path,
                target_path,
                content,
            } => {
                atomic_restore_file(&target_path, &content)?;
                restored_paths.push(path);
            }
            WorkspaceRestoreAction::Remove { path, target_path } => {
                if target_path.exists() {
                    fs::remove_file(&target_path).with_context(|| {
                        format!(
                            "failed to remove restored-created file {}",
                            target_path.display()
                        )
                    })?;
                }
                restored_paths.push(path);
            }
        }
    }
    Ok(RestoreWorkspaceResult {
        restored_workspace_snapshot_id: Some(workspace_snapshot_id.to_string()),
        restored_paths,
    })
}

fn atomic_restore_file(target_path: &Path, content: &[u8]) -> Result<()> {
    let parent = target_path.parent().ok_or_else(|| {
        anyhow!(
            "TOOL_ROLLBACK_CONFLICT: restore target has no parent: {}",
            target_path.display()
        )
    })?;
    fs::create_dir_all(parent)
        .with_context(|| format!("failed to create restore dir {}", parent.display()))?;
    let file_name = target_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            anyhow!(
                "TOOL_ROLLBACK_CONFLICT: restore target has invalid file name: {}",
                target_path.display()
            )
        })?;
    let temp_path = parent.join(format!(".{file_name}.lyra-rollback-{}.tmp", Uuid::new_v4()));
    fs::write(&temp_path, content).with_context(|| {
        format!(
            "failed to write rollback restore temp file {}",
            temp_path.display()
        )
    })?;
    fs::rename(&temp_path, target_path).with_context(|| {
        let _ = fs::remove_file(&temp_path);
        format!(
            "failed to atomically restore workspace file {}",
            target_path.display()
        )
    })?;
    Ok(())
}

fn read_workspace_snapshot_file(
    conn: &Connection,
    workspace_snapshot_id: &str,
    path: &str,
) -> Result<WorkspaceSnapshotFile> {
    conn.query_row(
        "SELECT path, exists_at_snapshot, content_ref, unavailable_reason
         FROM workspace_file_snapshot
         WHERE workspace_snapshot_id = ?1 AND path = ?2
         LIMIT 1",
        params![workspace_snapshot_id, path],
        |row| {
            Ok(WorkspaceSnapshotFile {
                path: row.get(0)?,
                exists_at_snapshot: row.get::<_, i64>(1)? != 0,
                content_ref: row.get(2)?,
                unavailable_reason: row.get(3)?,
            })
        },
    )
    .optional()
    .context("failed to read workspace snapshot file")?
    .ok_or_else(|| anyhow!("TOOL_ROLLBACK_CONFLICT: missing workspace snapshot for {path}"))
}

fn read_snapshot_content(
    store: &AiStore,
    session_id: &str,
    snapshot: &WorkspaceSnapshotFile,
) -> Result<Vec<u8>> {
    let Some(content_ref) = snapshot.content_ref.as_deref().and_then(trim_to_string) else {
        return Err(anyhow!(
            "TOOL_ROLLBACK_CONFLICT: snapshot content unavailable for {} ({})",
            snapshot.path,
            snapshot
                .unavailable_reason
                .as_deref()
                .unwrap_or("missing_content_ref")
        ));
    };
    let mut parts = content_ref.split('/');
    let Some(snapshot_dir) = parts.next().and_then(trim_to_string) else {
        return Err(anyhow!(
            "TOOL_ROLLBACK_CONFLICT: invalid snapshot content ref"
        ));
    };
    let Some(file_name) = parts.next().and_then(trim_to_string) else {
        return Err(anyhow!(
            "TOOL_ROLLBACK_CONFLICT: invalid snapshot content ref"
        ));
    };
    if parts.next().is_some() || file_name.contains('/') || snapshot_dir.contains('/') {
        return Err(anyhow!(
            "TOOL_ROLLBACK_CONFLICT: invalid snapshot content ref"
        ));
    }
    let path = store
        .session_dir(session_id)
        .join("workspace-snapshots")
        .join(snapshot_dir)
        .join(file_name);
    fs::read(&path).with_context(|| format!("failed to read snapshot content {}", path.display()))
}

fn safe_workspace_path(root: &Path, canonical_root: &Path, relative_path: &str) -> Result<PathBuf> {
    let relative = Path::new(relative_path);
    if relative.is_relative() == false
        || relative.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(anyhow!(
            "TOOL_ROLLBACK_CONFLICT: workspace restore path is outside workspace: {relative_path}"
        ));
    }
    let target_path = root.join(relative);
    if let Ok(canonical_path) = target_path.canonicalize() {
        if canonical_path.starts_with(canonical_root) == false {
            return Err(anyhow!(
                "TOOL_ROLLBACK_CONFLICT: workspace restore path is outside workspace: {relative_path}"
            ));
        }
    }
    Ok(target_path)
}

fn validate_expected_workspace_state(
    target_path: &Path,
    expected_hash: Option<&str>,
) -> Result<()> {
    let Some(expected_hash) = expected_hash.and_then(trim_to_string) else {
        return Err(anyhow!(
            "TOOL_ROLLBACK_CONFLICT: missing expected workspace hash for restore"
        ));
    };
    let bytes = fs::read(target_path).with_context(|| {
        format!(
            "TOOL_ROLLBACK_CONFLICT: workspace restore target is unavailable: {}",
            target_path.display()
        )
    })?;
    let current_hash = sha256_hex(&bytes);
    if current_hash != expected_hash {
        return Err(anyhow!(
            "TOOL_ROLLBACK_CONFLICT: workspace changed since rollback preview"
        ));
    }
    Ok(())
}
