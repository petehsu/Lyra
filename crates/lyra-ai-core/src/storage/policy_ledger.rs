use super::*;
use crate::project_policy::EffectivePolicy;

impl AiStore {
    pub fn create_effective_policy_snapshot(
        &self,
        input: CreateEffectivePolicySnapshotInput,
    ) -> Result<EffectivePolicySnapshot> {
        let now = now_ms();
        let now_iso = now_iso();
        let snapshot = EffectivePolicySnapshot {
            snapshot_id: new_id("policy_snapshot"),
            session_id: input.session_id,
            turn_id: input.turn_id,
            project_root: input.project_root,
            project_id: input.project_id,
            source: input.source,
            status: input.status,
            manifest_path: input.manifest_path,
            manifest_hash: input.manifest_hash,
            effective_json: input.effective_json,
            source_records: Vec::new(),
            created_at: now,
        };
        self.with_session_conn(&snapshot.session_id, |conn| {
            conn.execute(
                "INSERT INTO effective_policy_snapshot (
                    snapshot_id, session_id, turn_id, project_root, project_id, source,
                    status, manifest_path, manifest_hash, effective_json, source_records_json,
                    created_at_ms, created_at_iso, superseded_by_rollback_id
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, '[]', ?11, ?12, NULL)",
                params![
                    snapshot.snapshot_id,
                    snapshot.session_id,
                    snapshot.turn_id,
                    snapshot.project_root,
                    snapshot.project_id,
                    snapshot.source,
                    snapshot.status,
                    snapshot.manifest_path,
                    snapshot.manifest_hash,
                    snapshot.effective_json.to_string(),
                    now,
                    now_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(snapshot)
    }

    pub fn create_policy_source_record(
        &self,
        input: CreatePolicySourceRecordInput,
    ) -> Result<PolicySourceRecordRow> {
        let now = now_ms();
        let now_iso = now_iso();
        let record = PolicySourceRecordRow {
            source_record_id: new_id("policy_source"),
            snapshot_id: input.snapshot_id,
            layer: input.layer,
            source_ref: input.source_ref,
            status: input.status,
            hash: input.hash,
            warnings: input.warnings,
            created_at: now,
        };
        self.with_session_conn(&input.session_id, |conn| {
            conn.execute(
                "INSERT INTO policy_source_record (
                    source_record_id, snapshot_id, layer, source_ref, status, hash,
                    warnings_json, created_at_ms, created_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    record.source_record_id,
                    record.snapshot_id,
                    record.layer,
                    record.source_ref,
                    record.status,
                    record.hash,
                    json_string(&record.warnings)?,
                    now,
                    now_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(record)
    }

    pub fn read_policy_snapshot_for_turn(
        &self,
        session_id: &str,
        turn_id: &str,
    ) -> Result<Option<EffectivePolicySnapshot>> {
        self.with_session_conn(session_id, |conn| {
            conn.query_row(
                "SELECT snapshot_id, session_id, turn_id, project_root, project_id, source,
                        status, manifest_path, manifest_hash, effective_json, created_at_ms
                 FROM effective_policy_snapshot
                 WHERE session_id = ?1 AND turn_id = ?2
                   AND status NOT IN ('stale', 'superseded', 'superseded_by_rollback')
                 ORDER BY created_at_ms DESC LIMIT 1",
                params![session_id, turn_id],
                read_policy_snapshot_row,
            )
            .optional()
            .context("failed to read turn policy snapshot")
        })
    }

    pub fn read_effective_policy_for_turn(
        &self,
        session_id: &str,
        turn_id: &str,
    ) -> Result<Option<(String, EffectivePolicy)>> {
        let Some(snapshot) = self.read_policy_snapshot_for_turn(session_id, turn_id)? else {
            return Ok(None);
        };
        let policy = serde_json::from_value(snapshot.effective_json)
            .context("failed to parse effective policy snapshot")?;
        Ok(Some((snapshot.snapshot_id, policy)))
    }

    pub fn read_policy_summary(&self, session_id: &str) -> Result<Option<AgentPolicySummary>> {
        self.with_session_conn(session_id, |conn| {
            let snapshot = conn
                .query_row(
                    "SELECT snapshot_id, session_id, turn_id, project_root, project_id, source,
                            status, manifest_path, manifest_hash, effective_json, created_at_ms
                     FROM effective_policy_snapshot
                     WHERE session_id = ?1
                       AND status NOT IN ('stale', 'superseded', 'superseded_by_rollback')
                     ORDER BY created_at_ms DESC LIMIT 1",
                    params![session_id],
                    read_policy_snapshot_row,
                )
                .optional()?;
            let Some(snapshot) = snapshot else {
                return Ok(None);
            };
            let effective: EffectivePolicy =
                serde_json::from_value(snapshot.effective_json.clone()).unwrap_or_else(|_| {
                    crate::project_policy::load_policy_draft(None).effective_policy
                });
            let source_records = read_policy_source_records_from_conn(conn, &snapshot.snapshot_id)?;
            let warnings = effective
                .warnings
                .iter()
                .cloned()
                .chain(
                    source_records
                        .iter()
                        .flat_map(|record| record.warnings.clone()),
                )
                .collect::<Vec<_>>();
            Ok(Some(AgentPolicySummary {
                snapshot_id: snapshot.snapshot_id,
                source: snapshot.source,
                status: snapshot.status,
                permission_default: effective.permission_default,
                allowed_modes: effective.allowed_modes,
                default_execution_target: effective.permission.default_execution_target,
                allowed_execution_targets: effective.permission.allowed_execution_targets,
                tool_policy_summary: AgentPolicyToolSummary {
                    enabled_count: 6_i64.saturating_sub(effective.tools.disabled.len() as i64),
                    disabled_count: effective.tools.disabled.len() as i64,
                    command_policy: effective.tools.command_policy,
                    network_policy: effective.tools.network_policy,
                },
                manifest_path: snapshot.manifest_path,
                warnings,
            }))
        })
    }
}

fn read_policy_snapshot_row(row: &Row<'_>) -> rusqlite::Result<EffectivePolicySnapshot> {
    let effective_json: String = row.get(9)?;
    Ok(EffectivePolicySnapshot {
        snapshot_id: row.get(0)?,
        session_id: row.get(1)?,
        turn_id: row.get(2)?,
        project_root: row.get(3)?,
        project_id: row.get(4)?,
        source: row.get(5)?,
        status: row.get(6)?,
        manifest_path: row.get(7)?,
        manifest_hash: row.get(8)?,
        effective_json: serde_json::from_str(&effective_json).unwrap_or_else(|_| json!({})),
        source_records: Vec::new(),
        created_at: row.get(10)?,
    })
}

fn read_policy_source_records_from_conn(
    conn: &Connection,
    snapshot_id: &str,
) -> Result<Vec<PolicySourceRecordRow>> {
    let mut stmt = conn.prepare(
        "SELECT source_record_id, snapshot_id, layer, source_ref, status, hash,
                warnings_json, created_at_ms
         FROM policy_source_record
         WHERE snapshot_id = ?1
         ORDER BY created_at_ms ASC",
    )?;
    let rows = stmt.query_map(params![snapshot_id], |row| {
        let warnings_json: String = row.get(6)?;
        Ok(PolicySourceRecordRow {
            source_record_id: row.get(0)?,
            snapshot_id: row.get(1)?,
            layer: row.get(2)?,
            source_ref: row.get(3)?,
            status: row.get(4)?,
            hash: row.get(5)?,
            warnings: parse_json_vec_string(&warnings_json),
            created_at: row.get(7)?,
        })
    })?;
    let mut records = Vec::new();
    for row in rows {
        records.push(row?);
    }
    Ok(records)
}
