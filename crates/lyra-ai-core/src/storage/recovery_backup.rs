use super::*;

const MISSING_FILE_MARKER: &str = "__LYRA_RECOVERY_FILE_DID_NOT_EXIST__";
const DIRECTORY_MARKER: &str = "__LYRA_RECOVERY_DIRECTORY__";

struct RecoveryBackupRow {
    backup_id: String,
    file_path: String,
    original_content: Option<String>,
    original_hash: Option<String>,
    original_kind: String,
    post_hash: Option<String>,
    post_kind: String,
}

enum BackupPathState {
    File { content: String, hash: String },
    Directory,
    Missing,
}

impl AiStore {
    pub fn append_recovery_backup(
        &self,
        session_id: &str,
        turn_id: &str,
        workspace_root: &str,
        file_path: &str,
    ) -> Result<String> {
        let relative = safe_relative_backup_path(file_path)?;
        let state = read_backup_path_state(workspace_root, &relative)?;
        let (original_content, original_hash, original_kind) = match state {
            BackupPathState::File { content, hash } => (content, hash, "file"),
            BackupPathState::Directory => {
                (DIRECTORY_MARKER.to_string(), String::new(), "directory")
            }
            BackupPathState::Missing => (MISSING_FILE_MARKER.to_string(), String::new(), "missing"),
        };
        let backup_id = new_id("recovery_backup");
        let now = now_ms();
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "INSERT INTO recovery_backup (
                    backup_id, session_id, turn_id, file_path, original_content,
                    original_hash, original_kind, created_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    backup_id,
                    session_id,
                    turn_id,
                    relative,
                    original_content,
                    original_hash,
                    original_kind,
                    now
                ],
            )?;
            Ok(())
        })?;
        Ok(backup_id)
    }

    pub fn record_recovery_backup_post_state(
        &self,
        session_id: &str,
        turn_id: &str,
        workspace_root: &str,
        file_path: &str,
    ) -> Result<()> {
        let relative = safe_relative_backup_path(file_path)?;
        let state = read_backup_path_state(workspace_root, &relative)?;
        let (post_hash, post_kind) = match state {
            BackupPathState::File { hash, .. } => (Some(hash), "file"),
            BackupPathState::Directory => (None, "directory"),
            BackupPathState::Missing => (None, "missing"),
        };
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "UPDATE recovery_backup
                 SET post_hash = ?1, post_kind = ?2
                 WHERE session_id = ?3 AND turn_id = ?4 AND file_path = ?5
                   AND post_kind IS NULL",
                params![post_hash, post_kind, session_id, turn_id, relative],
            )?;
            Ok(())
        })
    }

    pub(super) fn restore_recovery_backups_after_checkpoint(
        &self,
        conn: &Connection,
        session_id: &str,
        rollback_id: &str,
        workspace_root: &str,
        checkpoint_created_at: i64,
    ) -> Result<Vec<String>> {
        let mut stmt = conn.prepare(
            "SELECT backup_id, file_path, original_content, original_hash, original_kind,
                    post_hash, post_kind
             FROM recovery_backup
             WHERE session_id = ?1
               AND created_at_ms >= ?2
               AND restore_status = 'pending'
               AND post_kind IS NOT NULL
             ORDER BY created_at_ms DESC, backup_id DESC",
        )?;
        let rows = stmt.query_map(params![session_id, checkpoint_created_at], |row| {
            Ok(RecoveryBackupRow {
                backup_id: row.get(0)?,
                file_path: row.get(1)?,
                original_content: row.get(2)?,
                original_hash: row.get(3)?,
                original_kind: row.get(4)?,
                post_hash: row.get(5)?,
                post_kind: row.get(6)?,
            })
        })?;
        let mut backups = Vec::new();
        for row in rows {
            backups.push(row?);
        }

        let mut restored_paths = Vec::new();
        for backup in backups {
            validate_post_state(workspace_root, &backup)?;
            restore_backup_state(workspace_root, &backup)?;
            conn.execute(
                "UPDATE recovery_backup
                 SET restore_status = 'restored',
                     rollback_id = ?1,
                     restored_at_ms = ?2
                 WHERE backup_id = ?3 AND restore_status = 'pending'",
                params![rollback_id, now_ms(), backup.backup_id],
            )?;
            push_unique(&mut restored_paths, backup.file_path);
        }
        Ok(restored_paths)
    }
}

pub(super) fn read_recovery_backup_post_hash(
    conn: &Connection,
    path: &str,
) -> Result<Option<String>> {
    conn.query_row(
        "SELECT post_hash
         FROM recovery_backup
         WHERE file_path = ?1 AND post_kind = 'file' AND post_hash IS NOT NULL
         ORDER BY created_at_ms DESC
         LIMIT 1",
        params![path],
        |row| row.get(0),
    )
    .optional()
    .context("failed to read recovery backup post hash")
}

pub(super) fn workspace_snapshot_has_path(
    conn: &Connection,
    workspace_snapshot_id: &str,
    path: &str,
) -> Result<bool> {
    Ok(conn
        .query_row(
            "SELECT 1
             FROM workspace_file_snapshot
             WHERE workspace_snapshot_id = ?1 AND path = ?2
             LIMIT 1",
            params![workspace_snapshot_id, path],
            |_| Ok(()),
        )
        .optional()
        .context("failed to read workspace snapshot path")?
        .is_some())
}

fn read_backup_path_state(workspace_root: &str, relative: &str) -> Result<BackupPathState> {
    let root = Path::new(workspace_root);
    let target = root.join(relative);
    if target.is_file() {
        let bytes = fs::read(&target)
            .with_context(|| format!("failed to read recovery backup {}", target.display()))?;
        return Ok(BackupPathState::File {
            content: hex_encode(&bytes),
            hash: sha256_hex(&bytes),
        });
    }
    if target.is_dir() {
        return Ok(BackupPathState::Directory);
    }
    Ok(BackupPathState::Missing)
}

fn validate_post_state(workspace_root: &str, backup: &RecoveryBackupRow) -> Result<()> {
    let state = read_backup_path_state(workspace_root, &backup.file_path)?;
    match (backup.post_kind.as_str(), state) {
        ("file", BackupPathState::File { hash, .. })
            if backup.post_hash.as_deref() == Some(hash.as_str()) =>
        {
            Ok(())
        }
        ("missing", BackupPathState::Missing) => Ok(()),
        ("directory", BackupPathState::Directory) => Ok(()),
        _ => Err(anyhow!(
            "TOOL_ROLLBACK_CONFLICT: workspace changed since recovery backup for {}",
            backup.file_path
        )),
    }
}

fn restore_backup_state(workspace_root: &str, backup: &RecoveryBackupRow) -> Result<()> {
    let target = Path::new(workspace_root).join(&backup.file_path);
    match backup.original_kind.as_str() {
        "file" => {
            let content = backup.original_content.as_deref().ok_or_else(|| {
                anyhow!("missing recovery backup content for {}", backup.file_path)
            })?;
            let content = hex_decode(content)?;
            if let Some(expected_hash) = backup.original_hash.as_deref().and_then(trim_to_string) {
                if sha256_hex(&content) != expected_hash {
                    return Err(anyhow!(
                        "TOOL_ROLLBACK_CONFLICT: recovery backup hash mismatch for {}",
                        backup.file_path
                    ));
                }
            }
            let parent = target
                .parent()
                .ok_or_else(|| anyhow!("TOOL_ROLLBACK_CONFLICT: restore target has no parent"))?;
            fs::create_dir_all(parent)?;
            fs::write(&target, content)
                .with_context(|| format!("failed to restore {}", target.display()))?;
        }
        "missing" => {
            if target.is_dir() {
                fs::remove_dir_all(&target)
                    .with_context(|| format!("failed to remove {}", target.display()))?;
            } else if target.exists() {
                fs::remove_file(&target)
                    .with_context(|| format!("failed to remove {}", target.display()))?;
            }
        }
        "directory" => {
            fs::create_dir_all(&target)
                .with_context(|| format!("failed to restore directory {}", target.display()))?;
        }
        other => {
            return Err(anyhow!(
                "TOOL_ROLLBACK_CONFLICT: unsupported recovery backup kind {other}"
            ));
        }
    }
    Ok(())
}

fn safe_relative_backup_path(file_path: &str) -> Result<String> {
    let trimmed = file_path.trim();
    let path = Path::new(trimmed);
    if trimmed.is_empty()
        || path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(anyhow!("recovery backup path must stay inside workspace"));
    }
    Ok(path.to_string_lossy().replace('\\', "/"))
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn hex_decode(value: &str) -> Result<Vec<u8>> {
    let trimmed = value.trim();
    if trimmed.len() % 2 != 0 {
        return Err(anyhow!("invalid recovery backup content encoding"));
    }
    let mut bytes = Vec::with_capacity(trimmed.len() / 2);
    let raw = trimmed.as_bytes();
    let mut index = 0;
    while index < raw.len() {
        let high = hex_value(raw[index])?;
        let low = hex_value(raw[index + 1])?;
        bytes.push((high << 4) | low);
        index += 2;
    }
    Ok(bytes)
}

fn hex_value(byte: u8) -> Result<u8> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        b'A'..=b'F' => Ok(byte - b'A' + 10),
        _ => Err(anyhow!("invalid recovery backup content encoding")),
    }
}

fn push_unique(values: &mut Vec<String>, value: String) {
    if value.trim().is_empty() == false && values.iter().any(|entry| entry == &value) == false {
        values.push(value);
    }
}
