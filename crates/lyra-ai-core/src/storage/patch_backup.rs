use super::*;

impl AiStore {
    pub fn append_patch_file_backup(
        &self,
        session_id: &str,
        turn_id: &str,
        approval_ticket_id: &str,
        source_artifact_id: &str,
        patch_ref: &str,
        path: &str,
        original_content: Option<&str>,
        post_apply_content: &str,
    ) -> Result<PatchFileBackupRef> {
        let backup_ref = new_id("backup");
        let backup_dir = self.session_dir(session_id).join("patch-backups");
        fs::create_dir_all(&backup_dir).with_context(|| {
            format!("failed to create patch backup dir {}", backup_dir.display())
        })?;
        let existed = original_content.is_some();
        let (content_ref, content_sha256, content_bytes) = if let Some(content) = original_content {
            let content_ref = format!("{backup_ref}.txt");
            let backup_path = backup_dir.join(&content_ref);
            fs::write(&backup_path, content).with_context(|| {
                format!("failed to write patch backup {}", backup_path.display())
            })?;
            (
                Some(content_ref),
                Some(sha256_hex(content.as_bytes())),
                content.len() as i64,
            )
        } else {
            (None, None, 0_i64)
        };
        let post_apply_sha256 = sha256_hex(post_apply_content.as_bytes());
        let post_apply_bytes = post_apply_content.len() as i64;
        let created_at = now_ms();
        let created_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "INSERT INTO file_backup_record (
                    backup_ref, session_id, runtime_turn_id, approval_ticket_id,
                    source_artifact_id, patch_ref, path, existed, content_ref,
                    content_sha256, content_bytes, post_apply_sha256, post_apply_bytes,
                    created_at_ms, created_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    backup_ref,
                    session_id,
                    turn_id,
                    approval_ticket_id,
                    source_artifact_id,
                    patch_ref,
                    path,
                    if existed { 1_i64 } else { 0_i64 },
                    content_ref,
                    content_sha256,
                    content_bytes,
                    post_apply_sha256,
                    post_apply_bytes,
                    created_at,
                    created_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(PatchFileBackupRef {
            backup_ref,
            path: path.to_string(),
            existed,
            content_sha256,
            content_bytes,
            post_apply_sha256: Some(post_apply_sha256),
            post_apply_bytes: Some(post_apply_bytes),
        })
    }

    pub fn read_patch_file_backup(
        &self,
        session_id: &str,
        backup_ref: &str,
    ) -> Result<Option<PatchFileBackupRecord>> {
        self.with_session_conn(session_id, |conn| {
            conn.query_row(
                "SELECT backup_ref, session_id, runtime_turn_id, approval_ticket_id,
                        source_artifact_id, patch_ref, path, existed, content_ref,
                        content_sha256, content_bytes, post_apply_sha256, post_apply_bytes
                 FROM file_backup_record
                 WHERE session_id = ?1 AND backup_ref = ?2",
                params![session_id, backup_ref],
                read_patch_file_backup_row,
            )
            .optional()
            .context("failed to read patch file backup")
        })
    }

    pub fn read_patch_backup_content(&self, session_id: &str, content_ref: &str) -> Result<String> {
        let content_file_name = Path::new(content_ref)
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| *value == content_ref)
            .ok_or_else(|| anyhow!("invalid backup content ref"))?;
        let path = self
            .session_dir(session_id)
            .join("patch-backups")
            .join(content_file_name);
        fs::read_to_string(&path)
            .with_context(|| format!("failed to read patch backup {}", path.display()))
    }
}
