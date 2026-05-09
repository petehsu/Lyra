use super::*;
use rusqlite::Transaction;

const CUT_PACK_SIZE_LIMIT_BYTES: u64 = 16 * 1024 * 1024;
const FIRST_CUT_PACK: i64 = 1;

#[derive(Clone, Debug)]
pub struct MemoryArchiveItem {
    pub source_kind: String,
    pub source_ref: Value,
    pub raw: Value,
    pub normalized: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryArchiveSummary {
    pub trim_journal_id: String,
    pub archived_count: usize,
    pub duplicate_count: usize,
    pub cut_ids: Vec<String>,
    pub pack_file: String,
}

#[cfg(not(test))]
#[derive(Clone, Debug)]
pub struct MemoryGatewayJob {
    pub job_id: String,
    pub target_ref: String,
    pub request: Value,
}

impl AiStore {
    pub fn ensure_memory_v2_layout(&self) -> Result<()> {
        fs::create_dir_all(self.root.join("sessions"))?;
        fs::create_dir_all(self.shared_dir())?;
        fs::create_dir_all(self.runtime_dir())?;
        self.with_memory_conn("shared", |_| Ok(()))?;
        self.with_memory_conn("frozen", |_| Ok(()))?;
        self.with_conflict_conn(|_| Ok(()))?;
        self.with_shared_index_conn(|_| Ok(()))?;
        self.with_trigger_marks_conn(|_| Ok(()))?;
        self.with_memory_jobs_conn(|_| Ok(()))?;
        self.with_prompt_cache_conn(|_| Ok(()))?;
        Ok(())
    }

    pub fn runtime_dir(&self) -> PathBuf {
        self.root.join("runtime")
    }

    pub fn archive_context_trim(
        &self,
        session_id: &str,
        turn_id: &str,
        reason: &str,
        items: Vec<MemoryArchiveItem>,
        assembly: Value,
    ) -> Result<Option<MemoryArchiveSummary>> {
        if items.is_empty() {
            return Ok(None);
        }
        self.recover_memory_trim_journal(session_id)?;
        let pack_number = self.active_cut_pack_number(session_id)?;
        let pack_file = cut_pack_filename(pack_number);
        let pack_path = self
            .session_dir(session_id)
            .join("cuts")
            .join(pack_file.as_str());
        fs::create_dir_all(self.session_dir(session_id).join("cuts"))?;
        fs::create_dir_all(self.session_dir(session_id).join("manifests"))?;
        let mut conn = Connection::open(&pack_path)?;
        configure_conn(&conn)?;
        migrate_cut_pack(&conn)?;
        let now = now_ms();
        let now_iso_value = now_iso();
        let trim_journal_id = new_id("trim_journal");
        let mut archived_count = 0_usize;
        let mut duplicate_count = 0_usize;
        let mut cut_ids = Vec::new();
        {
            let tx = conn.transaction()?;
            insert_trim_journal(
                &tx,
                &trim_journal_id,
                session_id,
                turn_id,
                reason,
                items.len(),
                now,
                &now_iso_value,
                &assembly,
            )?;
            for (index, item) in items.into_iter().enumerate() {
                let sanitized = sanitize_archive_item(item);
                let raw_json = json_string(&sanitized.raw)?;
                let raw_sha256 = sha256_hex(raw_json.as_bytes());
                let normalized_sha256 = sha256_hex(sanitized.normalized.as_bytes());
                let existing = self.find_cut_by_digest(session_id, &raw_sha256)?;
                let ref_id = new_id("cut_ref");
                if let Some(existing_cut_id) = existing {
                    tx.execute(
                        "INSERT INTO cut_refs (
                            ref_id, cut_id, session_id, runtime_turn_id, source_kind,
                            source_ref_json, duplicate_of_cut_id, created_at_ms, created_at_iso
                         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                        params![
                            ref_id,
                            existing_cut_id,
                            session_id,
                            turn_id,
                            sanitized.source_kind,
                            json_string(&sanitized.source_ref)?,
                            existing_cut_id,
                            now,
                            now_iso_value,
                        ],
                    )?;
                    duplicate_count += 1;
                    continue;
                }
                let cut_id = new_id("cut");
                tx.execute(
                    "INSERT INTO cut_payload (
                        cut_id, session_id, runtime_turn_id, payload_kind, raw_json,
                        normalized_text, raw_sha256, normalized_sha256, content_bytes,
                        created_at_ms, created_at_iso
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                    params![
                        cut_id,
                        session_id,
                        turn_id,
                        sanitized.source_kind,
                        raw_json,
                        sanitized.normalized,
                        raw_sha256,
                        normalized_sha256,
                        sanitized.normalized.len() as i64,
                        now,
                        now_iso_value,
                    ],
                )?;
                tx.execute(
                    "INSERT INTO cut_refs (
                        ref_id, cut_id, session_id, runtime_turn_id, source_kind,
                        source_ref_json, duplicate_of_cut_id, created_at_ms, created_at_iso
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8)",
                    params![
                        ref_id,
                        cut_id,
                        session_id,
                        turn_id,
                        sanitized.source_kind,
                        json_string(&sanitized.source_ref)?,
                        now,
                        now_iso_value,
                    ],
                )?;
                tx.execute(
                    "INSERT INTO cut_meta (
                        cut_id, trim_journal_id, reason, assembly_json, sequence_in_trim,
                        status, metadata_json, created_at_ms, created_at_iso,
                        updated_at_ms, updated_at_iso
                     ) VALUES (?1, ?2, ?3, ?4, ?5, 'archived', ?6, ?7, ?8, ?7, ?8)",
                    params![
                        cut_id,
                        trim_journal_id,
                        reason,
                        json_string(&assembly)?,
                        index as i64,
                        json!({ "sourceRef": sanitized.source_ref }).to_string(),
                        now,
                        now_iso_value,
                    ],
                )?;
                tx.execute(
                    "INSERT INTO cut_shard_map (
                        logical_shard_id, cut_id, pack_file, pack_index, status,
                        created_at_ms, created_at_iso
                     ) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6)",
                    params![
                        new_id("cut_shard"),
                        cut_id,
                        pack_file,
                        pack_number,
                        now,
                        now_iso_value,
                    ],
                )?;
                tx.execute(
                    "INSERT INTO cut_dedupe_index (
                        raw_sha256, cut_id, normalized_sha256, created_at_ms
                     ) VALUES (?1, ?2, ?3, ?4)",
                    params![raw_sha256, cut_id, normalized_sha256, now],
                )?;
                cut_ids.push(cut_id);
                archived_count += 1;
            }
            update_trim_journal_status(
                &tx,
                &trim_journal_id,
                "archived",
                archived_count,
                duplicate_count,
                now,
                &now_iso_value,
            )?;
            update_trim_journal_status(
                &tx,
                &trim_journal_id,
                "live_deleted",
                archived_count,
                duplicate_count,
                now,
                &now_iso_value,
            )?;
            tx.commit()?;
        }
        self.write_cut_manifest(session_id, pack_number)?;
        self.with_cut_pack_conn(session_id, pack_number, |conn| {
            conn.execute(
                "UPDATE trim_journal
                 SET status = 'manifest_committed',
                     archived_count = ?1,
                     duplicate_count = ?2,
                     updated_at_ms = ?3,
                     updated_at_iso = ?4
                 WHERE trim_journal_id = ?5",
                params![
                    archived_count as i64,
                    duplicate_count as i64,
                    now_ms(),
                    now_iso(),
                    trim_journal_id,
                ],
            )?;
            Ok(())
        })?;
        Ok(Some(MemoryArchiveSummary {
            trim_journal_id,
            archived_count,
            duplicate_count,
            cut_ids,
            pack_file,
        }))
    }

    pub fn recover_memory_trim_journal(&self, session_id: &str) -> Result<usize> {
        let mut recovered = 0_usize;
        for pack in self.cut_pack_paths(session_id)? {
            let conn = Connection::open(&pack)?;
            configure_conn(&conn)?;
            migrate_cut_pack(&conn)?;
            let mut stmt = conn.prepare(
                "SELECT trim_journal_id, status
                 FROM trim_journal
                 WHERE status IN ('pending_trim', 'archived', 'live_deleted', 'failed_recoverable')",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            for row in rows {
                let (journal_id, status) = row?;
                let next_status = if status == "live_deleted" {
                    "manifest_committed"
                } else {
                    "failed_recoverable"
                };
                conn.execute(
                    "UPDATE trim_journal
                     SET status = ?1, updated_at_ms = ?2, updated_at_iso = ?3
                     WHERE trim_journal_id = ?4",
                    params![next_status, now_ms(), now_iso(), journal_id],
                )?;
                recovered += 1;
            }
        }
        Ok(recovered)
    }

    pub fn memory_context_snapshot(&self, session_id: &str) -> Result<Value> {
        self.ensure_memory_v2_layout()?;
        let message_count = self.with_session_conn(session_id, |conn| {
            conn.query_row("SELECT COUNT(*) FROM session_dialog", [], |row| {
                row.get::<_, i64>(0)
            })
            .optional()
            .map(|value| value.unwrap_or(0))
            .context("failed to count session messages")
        })?;
        let cut_count = self.count_session_cut_payloads(session_id)?;
        let pending_jobs = self.count_memory_jobs("pending")?;
        Ok(json!({
            "schemaVersion": "v2",
            "sessionId": session_id,
            "messageCount": message_count,
            "cutPayloadCount": cut_count,
            "pendingMemoryJobs": pending_jobs,
            "manifestPath": self.session_dir(session_id).join("manifests").join("cuts.manifest.json").to_string_lossy(),
            "sharedTruthPath": self.shared_dir().join("shared_truth.sqlite").to_string_lossy(),
            "frozenTruthPath": self.shared_dir().join("frozen_truth.sqlite").to_string_lossy(),
            "dynamicPromptSnapshotPath": self.shared_dir().join("dynamic_prompt_cache.md").to_string_lossy(),
        }))
    }

    pub fn memory_search_session(
        &self,
        session_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<Value> {
        let needle = query.trim().to_ascii_lowercase();
        if needle.is_empty() {
            return Err(anyhow!("query is required"));
        }
        let limit = limit.clamp(1, 50);
        let mut results = self.with_session_conn(session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT msg_id, role, content_raw, created_at_ms, created_at_iso, turn_id
                 FROM session_dialog
                 ORDER BY created_at_ms DESC, turn_index DESC
                 LIMIT 500",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(json!({
                    "source": "session_dialog",
                    "messageId": row.get::<_, String>(0)?,
                    "role": row.get::<_, String>(1)?,
                    "preview": preview_text(&row.get::<_, String>(2)?, 240),
                    "createdAtMs": row.get::<_, i64>(3)?,
                    "createdAtIso": row.get::<_, String>(4)?,
                    "turnId": row.get::<_, Option<String>>(5)?,
                }))
            })?;
            let mut matches = Vec::new();
            for row in rows {
                let value = row?;
                if value.to_string().to_ascii_lowercase().contains(&needle) {
                    matches.push(value);
                    if matches.len() >= limit {
                        break;
                    }
                }
            }
            Ok(matches)
        })?;
        if results.len() < limit {
            for value in self.search_cut_payloads(session_id, &needle, limit - results.len())? {
                results.push(value);
            }
        }
        Ok(json!({
            "schemaVersion": "v2",
            "kind": "memorySearchSessionResult",
            "query": query,
            "sessionId": session_id,
            "results": results,
        }))
    }

    pub(super) fn with_cut_pack_conn<T>(
        &self,
        session_id: &str,
        pack_number: i64,
        f: impl FnOnce(&Connection) -> Result<T>,
    ) -> Result<T> {
        fs::create_dir_all(self.session_dir(session_id).join("cuts"))?;
        let path = self
            .session_dir(session_id)
            .join("cuts")
            .join(cut_pack_filename(pack_number));
        let conn = Connection::open(path)?;
        configure_conn(&conn)?;
        migrate_cut_pack(&conn)?;
        f(&conn)
    }

    pub(super) fn with_conflict_conn<T>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T>,
    ) -> Result<T> {
        fs::create_dir_all(self.shared_dir())?;
        let path = self.shared_dir().join("conflict_sets.sqlite");
        let conn = Connection::open(path)?;
        configure_conn(&conn)?;
        migrate_conflict_sets(&conn)?;
        f(&conn)
    }

    pub(super) fn with_shared_index_conn<T>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T>,
    ) -> Result<T> {
        fs::create_dir_all(self.shared_dir())?;
        let path = self.shared_dir().join("shared_index.sqlite");
        let conn = Connection::open(path)?;
        configure_conn(&conn)?;
        migrate_shared_index(&conn)?;
        f(&conn)
    }

    pub(super) fn with_trigger_marks_conn<T>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T>,
    ) -> Result<T> {
        fs::create_dir_all(self.runtime_dir())?;
        let path = self.runtime_dir().join("trigger_marks.sqlite");
        let conn = Connection::open(path)?;
        configure_conn(&conn)?;
        migrate_trigger_marks(&conn)?;
        f(&conn)
    }

    pub(super) fn with_memory_jobs_conn<T>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T>,
    ) -> Result<T> {
        fs::create_dir_all(self.runtime_dir())?;
        let path = self.runtime_dir().join("memory_jobs.sqlite");
        let conn = Connection::open(path)?;
        configure_conn(&conn)?;
        migrate_memory_jobs(&conn)?;
        f(&conn)
    }

    pub(super) fn with_prompt_cache_conn<T>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T>,
    ) -> Result<T> {
        fs::create_dir_all(self.runtime_dir())?;
        let path = self.runtime_dir().join("prompt_cache.sqlite");
        let conn = Connection::open(path)?;
        configure_conn(&conn)?;
        migrate_prompt_cache(&conn)?;
        f(&conn)
    }

    fn active_cut_pack_number(&self, session_id: &str) -> Result<i64> {
        let manifest_path = self
            .session_dir(session_id)
            .join("manifests")
            .join("cuts.manifest.json");
        fs::create_dir_all(
            manifest_path
                .parent()
                .ok_or_else(|| anyhow!("invalid cut manifest path"))?,
        )?;
        let active = fs::read_to_string(&manifest_path)
            .ok()
            .and_then(|content| serde_json::from_str::<Value>(&content).ok())
            .and_then(|value| value.get("activePack").and_then(Value::as_i64))
            .unwrap_or(FIRST_CUT_PACK);
        let active_path = self
            .session_dir(session_id)
            .join("cuts")
            .join(cut_pack_filename(active));
        let next = fs::metadata(active_path)
            .ok()
            .filter(|metadata| metadata.len() >= CUT_PACK_SIZE_LIMIT_BYTES)
            .map(|_| active + 1)
            .unwrap_or(active);
        if manifest_path.exists() == false || next != active {
            self.write_cut_manifest(session_id, next)?;
        }
        Ok(next)
    }

    fn write_cut_manifest(&self, session_id: &str, active_pack: i64) -> Result<()> {
        let cuts_dir = self.session_dir(session_id).join("cuts");
        let manifests_dir = self.session_dir(session_id).join("manifests");
        fs::create_dir_all(&cuts_dir)?;
        fs::create_dir_all(&manifests_dir)?;
        let mut packs = self
            .cut_pack_paths(session_id)?
            .into_iter()
            .filter_map(|path| {
                let file_name = path.file_name()?.to_string_lossy().to_string();
                Some(json!({
                    "packFile": file_name,
                    "bytes": fs::metadata(&path).ok().map(|metadata| metadata.len()).unwrap_or(0),
                }))
            })
            .collect::<Vec<_>>();
        if packs.iter().all(|pack| {
            pack.get("packFile")
                .and_then(Value::as_str)
                .is_some_and(|file| file != cut_pack_filename(active_pack))
        }) {
            packs.push(json!({
                "packFile": cut_pack_filename(active_pack),
                "bytes": 0,
            }));
        }
        let manifest = json!({
            "schemaVersion": "v2",
            "sessionId": session_id,
            "activePack": active_pack,
            "packs": packs,
            "updatedAtMs": now_ms(),
            "updatedAtIso": now_iso(),
        });
        fs::write(
            manifests_dir.join("cuts.manifest.json"),
            serde_json::to_string_pretty(&manifest)?,
        )?;
        Ok(())
    }

    fn cut_pack_paths(&self, session_id: &str) -> Result<Vec<PathBuf>> {
        let cuts_dir = self.session_dir(session_id).join("cuts");
        if cuts_dir.exists() == false {
            return Ok(Vec::new());
        }
        let mut paths = Vec::new();
        for entry in fs::read_dir(cuts_dir)? {
            let path = entry?.path();
            if path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("cut_pack_") && name.ends_with(".sqlite"))
            {
                paths.push(path);
            }
        }
        paths.sort();
        Ok(paths)
    }

    fn find_cut_by_digest(&self, session_id: &str, raw_sha256: &str) -> Result<Option<String>> {
        for pack in self.cut_pack_paths(session_id)? {
            let conn = Connection::open(pack)?;
            configure_conn(&conn)?;
            migrate_cut_pack(&conn)?;
            let found = conn
                .query_row(
                    "SELECT cut_id FROM cut_dedupe_index WHERE raw_sha256 = ?1 LIMIT 1",
                    params![raw_sha256],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if found.is_some() {
                return Ok(found);
            }
        }
        Ok(None)
    }

    fn count_session_cut_payloads(&self, session_id: &str) -> Result<i64> {
        let mut count = 0_i64;
        for pack in self.cut_pack_paths(session_id)? {
            let conn = Connection::open(pack)?;
            configure_conn(&conn)?;
            migrate_cut_pack(&conn)?;
            count += conn.query_row("SELECT COUNT(*) FROM cut_payload", [], |row| {
                row.get::<_, i64>(0)
            })?;
        }
        Ok(count)
    }

    fn search_cut_payloads(
        &self,
        session_id: &str,
        needle: &str,
        limit: usize,
    ) -> Result<Vec<Value>> {
        let mut results = Vec::new();
        for pack in self.cut_pack_paths(session_id)? {
            let pack_file = pack
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("cut_pack.sqlite")
                .to_string();
            let conn = Connection::open(pack)?;
            configure_conn(&conn)?;
            migrate_cut_pack(&conn)?;
            let mut stmt = conn.prepare(
                "SELECT cut_id, payload_kind, normalized_text, created_at_ms, created_at_iso
                 FROM cut_payload
                 ORDER BY created_at_ms DESC
                 LIMIT 500",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })?;
            for row in rows {
                let (cut_id, payload_kind, normalized, created_at_ms, created_at_iso) = row?;
                if normalized.to_ascii_lowercase().contains(needle) {
                    results.push(json!({
                        "source": "cut_payload",
                        "cutId": cut_id,
                        "payloadKind": payload_kind,
                        "packFile": pack_file,
                        "preview": preview_text(&normalized, 240),
                        "createdAtMs": created_at_ms,
                        "createdAtIso": created_at_iso,
                    }));
                    if results.len() >= limit {
                        return Ok(results);
                    }
                }
            }
        }
        Ok(results)
    }

    fn count_memory_jobs(&self, status: &str) -> Result<i64> {
        self.with_memory_jobs_conn(|conn| {
            conn.query_row(
                "SELECT COUNT(*) FROM memory_job WHERE status = ?1",
                params![status],
                |row| row.get(0),
            )
            .context("failed to count memory jobs")
        })
    }

    #[cfg(not(test))]
    pub fn claim_pending_memory_gateway_jobs(&self, limit: usize) -> Result<Vec<MemoryGatewayJob>> {
        let limit = limit.clamp(1, 8) as i64;
        self.with_memory_jobs_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT job_id, target_ref, request_json
                 FROM memory_job
                 WHERE status = 'pending'
                   AND job_kind = 'semantic_score_candidate'
                   AND budget_class = 'model_gateway_low'
                 ORDER BY created_at_ms ASC
                 LIMIT ?1",
            )?;
            let rows = stmt.query_map(params![limit], |row| {
                Ok(MemoryGatewayJob {
                    job_id: row.get(0)?,
                    target_ref: row.get(1)?,
                    request: parse_json_or(row.get::<_, String>(2)?, json!({})),
                })
            })?;
            let mut jobs = Vec::new();
            for row in rows {
                jobs.push(row?);
            }
            for job in &jobs {
                conn.execute(
                    "UPDATE memory_job
                     SET status = 'running',
                         attempts = attempts + 1,
                         updated_at_ms = ?1,
                         updated_at_iso = ?2
                     WHERE job_id = ?3 AND status = 'pending'",
                    params![now_ms(), now_iso(), job.job_id],
                )?;
            }
            Ok(jobs)
        })
    }

    #[cfg(not(test))]
    pub fn complete_memory_gateway_job(&self, job_id: &str, result: Value) -> Result<()> {
        self.with_memory_jobs_conn(|conn| {
            conn.execute(
                "UPDATE memory_job
                 SET status = 'completed',
                     result_json = ?1,
                     updated_at_ms = ?2,
                     updated_at_iso = ?3
                 WHERE job_id = ?4",
                params![json_string(&result)?, now_ms(), now_iso(), job_id],
            )?;
            Ok(())
        })
    }

    #[cfg(not(test))]
    pub fn fail_memory_gateway_job(&self, job_id: &str, error: &str) -> Result<()> {
        self.with_memory_jobs_conn(|conn| {
            conn.execute(
                "UPDATE memory_job
                 SET status = 'failed_recoverable',
                     result_json = ?1,
                     updated_at_ms = ?2,
                     updated_at_iso = ?3
                 WHERE job_id = ?4",
                params![
                    json!({ "error": preview_text(error, 500), "candidateRemains": true })
                        .to_string(),
                    now_ms(),
                    now_iso(),
                    job_id,
                ],
            )?;
            Ok(())
        })
    }
}

fn migrate_cut_pack(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS cut_payload (
            cut_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT NOT NULL,
            payload_kind TEXT NOT NULL,
            raw_json TEXT NOT NULL,
            normalized_text TEXT NOT NULL,
            raw_sha256 TEXT NOT NULL,
            normalized_sha256 TEXT NOT NULL,
            content_bytes INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cut_refs (
            ref_id TEXT PRIMARY KEY,
            cut_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT NOT NULL,
            source_kind TEXT NOT NULL,
            source_ref_json TEXT NOT NULL,
            duplicate_of_cut_id TEXT,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cut_meta (
            cut_id TEXT PRIMARY KEY,
            trim_journal_id TEXT NOT NULL,
            reason TEXT NOT NULL,
            assembly_json TEXT NOT NULL,
            sequence_in_trim INTEGER NOT NULL,
            status TEXT NOT NULL,
            metadata_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cut_shard_map (
            logical_shard_id TEXT PRIMARY KEY,
            cut_id TEXT NOT NULL,
            pack_file TEXT NOT NULL,
            pack_index INTEGER NOT NULL,
            status TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS trim_journal (
            trim_journal_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT NOT NULL,
            status TEXT NOT NULL,
            reason TEXT NOT NULL,
            requested_count INTEGER NOT NULL,
            archived_count INTEGER NOT NULL,
            duplicate_count INTEGER NOT NULL,
            assembly_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cut_dedupe_index (
            raw_sha256 TEXT PRIMARY KEY,
            cut_id TEXT NOT NULL,
            normalized_sha256 TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS cut_payload_turn_idx
            ON cut_payload(session_id, runtime_turn_id, created_at_ms);
        CREATE INDEX IF NOT EXISTS cut_refs_turn_idx
            ON cut_refs(session_id, runtime_turn_id, created_at_ms);
        CREATE INDEX IF NOT EXISTS trim_journal_status_idx
            ON trim_journal(session_id, status, updated_at_ms);
        ",
    )?;
    Ok(())
}

pub(super) fn migrate_conflict_sets(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS conflict_set (
            conflict_set_id TEXT PRIMARY KEY,
            namespace TEXT NOT NULL,
            status TEXT NOT NULL,
            summary TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS conflict_candidate (
            conflict_candidate_id TEXT PRIMARY KEY,
            conflict_set_id TEXT NOT NULL,
            memory_id TEXT NOT NULL UNIQUE,
            scope TEXT NOT NULL,
            stance TEXT NOT NULL,
            evidence_refs_json TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS conflict_candidate_set_idx
            ON conflict_candidate(conflict_set_id, created_at_ms);
        ",
    )?;
    Ok(())
}

pub(super) fn migrate_shared_index(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS shared_index_entry (
            entry_id TEXT PRIMARY KEY,
            memory_id TEXT NOT NULL,
            scope TEXT NOT NULL,
            namespace TEXT NOT NULL,
            normalized_text TEXT NOT NULL,
            normalized_sha256 TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS shared_index_lookup_idx
            ON shared_index_entry(scope, namespace, status, updated_at_ms);
        CREATE UNIQUE INDEX IF NOT EXISTS shared_index_memory_idx
            ON shared_index_entry(memory_id);
        ",
    )?;
    Ok(())
}

pub(super) fn migrate_trigger_marks(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS trigger_mark (
            trigger_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            trigger_kind TEXT NOT NULL,
            last_event_sequence INTEGER NOT NULL,
            last_runtime_turn_id TEXT,
            status TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS memory_event_candidate (
            candidate_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            event_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            status TEXT NOT NULL,
            memory_id TEXT,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS memory_event_candidate_event_idx
            ON memory_event_candidate(session_id, event_id);
        CREATE UNIQUE INDEX IF NOT EXISTS trigger_mark_session_idx
            ON trigger_mark(session_id, trigger_kind);
        ",
    )?;
    Ok(())
}

pub(super) fn migrate_memory_jobs(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS memory_job (
            job_id TEXT PRIMARY KEY,
            job_kind TEXT NOT NULL,
            status TEXT NOT NULL,
            budget_class TEXT NOT NULL,
            session_id TEXT,
            runtime_turn_id TEXT,
            target_ref TEXT,
            request_json TEXT NOT NULL,
            result_json TEXT,
            attempts INTEGER NOT NULL DEFAULT 0,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS memory_job_status_idx
            ON memory_job(status, budget_class, updated_at_ms);
        ",
    )?;
    Ok(())
}

pub(super) fn migrate_prompt_cache(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS prompt_cache_snapshot (
            snapshot_id TEXT PRIMARY KEY,
            session_id TEXT,
            target_space TEXT NOT NULL,
            content_sha256 TEXT NOT NULL,
            source_refs_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL
        );
        ",
    )?;
    Ok(())
}

fn insert_trim_journal(
    tx: &Transaction<'_>,
    trim_journal_id: &str,
    session_id: &str,
    turn_id: &str,
    reason: &str,
    requested_count: usize,
    now: i64,
    now_iso_value: &str,
    assembly: &Value,
) -> Result<()> {
    tx.execute(
        "INSERT INTO trim_journal (
            trim_journal_id, session_id, runtime_turn_id, status, reason,
            requested_count, archived_count, duplicate_count, assembly_json,
            created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
         ) VALUES (?1, ?2, ?3, 'pending_trim', ?4, ?5, 0, 0, ?6, ?7, ?8, ?7, ?8)",
        params![
            trim_journal_id,
            session_id,
            turn_id,
            reason,
            requested_count as i64,
            json_string(assembly)?,
            now,
            now_iso_value,
        ],
    )?;
    Ok(())
}

fn update_trim_journal_status(
    tx: &Transaction<'_>,
    trim_journal_id: &str,
    status: &str,
    archived_count: usize,
    duplicate_count: usize,
    now: i64,
    now_iso_value: &str,
) -> Result<()> {
    tx.execute(
        "UPDATE trim_journal
         SET status = ?1,
             archived_count = ?2,
             duplicate_count = ?3,
             updated_at_ms = ?4,
             updated_at_iso = ?5
         WHERE trim_journal_id = ?6",
        params![
            status,
            archived_count as i64,
            duplicate_count as i64,
            now,
            now_iso_value,
            trim_journal_id,
        ],
    )?;
    Ok(())
}

fn cut_pack_filename(pack_number: i64) -> String {
    format!("cut_pack_{pack_number:04}.sqlite")
}

fn sanitize_archive_item(item: MemoryArchiveItem) -> MemoryArchiveItem {
    let raw_text = item.raw.to_string();
    let normalized_text = item.normalized.clone();
    if contains_secret_like_text(&raw_text) || contains_secret_like_text(&normalized_text) {
        return MemoryArchiveItem {
            source_kind: item.source_kind,
            source_ref: item.source_ref,
            raw: json!({
                "redacted": true,
                "reason": "secret_like_content",
                "rawSha256": sha256_hex(raw_text.as_bytes()),
            }),
            normalized: "[redacted: secret-like memory archive payload]".to_string(),
        };
    }
    item
}

pub(crate) fn contains_secret_like_text(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [
        "api_key",
        "apikey",
        "authorization:",
        "bearer ",
        "password",
        "passwd",
        "secret",
        "cookie",
        "set-cookie",
        "ssh-rsa",
        "private key",
        "-----begin",
        "xoxb-",
        "ghp_",
        "sk-",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_store_creates_memory_v2_layout() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path().join("ai");
        let _store = AiStore::open(Some(root.to_string_lossy().as_ref())).expect("store");

        assert!(root.join("shared/shared_truth.sqlite").exists());
        assert!(root.join("shared/frozen_truth.sqlite").exists());
        assert!(root.join("shared/conflict_sets.sqlite").exists());
        assert!(root.join("shared/shared_index.sqlite").exists());
        assert!(root.join("runtime/trigger_marks.sqlite").exists());
        assert!(root.join("runtime/memory_jobs.sqlite").exists());
        assert!(root.join("runtime/prompt_cache.sqlite").exists());
    }

    #[test]
    fn context_trim_archive_writes_pack_manifest_and_dual_payload() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = AiStore::open(Some(temp.path().to_string_lossy().as_ref())).expect("store");
        let summary = store
            .archive_context_trim(
                "session-a",
                "turn-a",
                "test_trim",
                vec![MemoryArchiveItem {
                    source_kind: "message".to_string(),
                    source_ref: json!({ "messageId": "msg-a" }),
                    raw: json!({ "role": "user", "content": "remember this exact payload" }),
                    normalized: "user: remember this exact payload".to_string(),
                }],
                json!({ "layers": { "head": [], "pinned": [], "middle": [], "tail": [] } }),
            )
            .expect("archive")
            .expect("summary");

        assert_eq!(summary.archived_count, 1);
        assert!(store
            .session_dir("session-a")
            .join("manifests/cuts.manifest.json")
            .exists());
        store
            .with_cut_pack_conn("session-a", 1, |conn| {
                let row = conn.query_row(
                    "SELECT raw_json, normalized_text FROM cut_payload LIMIT 1",
                    [],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )?;
                assert!(row.0.contains("remember this exact payload"));
                assert!(row.1.contains("user: remember this exact payload"));
                Ok(())
            })
            .expect("pack rows");
    }
}
