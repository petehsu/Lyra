use super::*;

const MEMORY_PROMPT_LIMIT: usize = 200;

impl AiStore {
    pub fn read_memory_prompt_context(&self, session_id: &str, limit: usize) -> Result<Value> {
        self.ensure_memory_v2_layout()?;
        let limit = limit.clamp(1, MEMORY_PROMPT_LIMIT);
        let pinned = self.read_pinned_memory_context(session_id, limit)?;
        let frozen = self.read_memory_records("frozen", session_id, limit)?;
        let shared = self.read_memory_records("shared", session_id, limit)?;
        let context = json!({
            "schemaVersion": "v2",
            "levels": {
                "L0": "session_pinned_context",
                "L1": "structured_shared_frozen_truth",
                "L2": "dynamic_prompt_snapshot_observable_only"
            },
            "pinned": pinned,
            "frozen": frozen,
            "shared": shared,
            "rules": [
                "Use memory as structured context, not as unquestionable truth.",
                "Current requester message and current workspace evidence override stale memory.",
                "Never write, expose, or repeat secrets from memory.",
                "dynamic_prompt_cache.md is an observable snapshot, not source of truth."
            ]
        });
        self.write_dynamic_prompt_snapshot(session_id, &context)?;
        Ok(context)
    }

    pub fn extract_shared_memory_after_turn(
        &self,
        session_id: &str,
        turn_id: Option<&str>,
    ) -> Result<usize> {
        self.ensure_memory_v2_layout()?;
        let Some(turn_id) = turn_id else {
            return Ok(0);
        };
        let events = self.read_memory_trigger_events(session_id, turn_id)?;
        let mut inserted = 0_usize;
        for event in events {
            let payload_text = event.payload.to_string();
            if contains_secret_like_text(&payload_text) {
                self.record_memory_event_candidate(
                    session_id,
                    turn_id,
                    &event.event_id,
                    &event.event_type,
                    "rejected_secret_like",
                    None,
                )?;
                continue;
            }
            let value = memory_value_from_event(&event);
            let memory_id = self.upsert_memory_record(MemoryRecordInput {
                scope: "shared",
                namespace: event_namespace(&event.event_type),
                kind: event_memory_kind(&event.event_type),
                value,
                evidence_refs: vec![
                    format!("runtime_event:{}", event.event_id),
                    format!("runtime_turn:{turn_id}"),
                ],
                source_session_id: session_id,
                source_turn_id: Some(turn_id),
                confidence: 0.35,
                stability: 0.25,
                status: "candidate",
                supersedes_memory_id: None,
                metadata: json!({
                    "extraction": "structured_runtime_event",
                    "eventType": event.event_type,
                    "semanticScoring": "queued_model_gateway",
                    "promotion": "blocked_until_model_gateway_score",
                }),
            })?;
            self.record_memory_event_candidate(
                session_id,
                turn_id,
                &event.event_id,
                &event.event_type,
                "candidate",
                Some(&memory_id),
            )?;
            self.enqueue_memory_gateway_job(
                session_id,
                turn_id,
                &memory_id,
                "semantic_score_candidate",
                json!({
                    "schemaVersion": "v2",
                    "gateway": "model_gateway",
                    "task": "score_memory_candidate",
                    "safety": {
                        "redacted": true,
                        "noRawSecrets": true,
                        "candidateOnlyOnFailure": true
                    },
                    "memoryId": memory_id,
                    "eventType": event.event_type,
                    "candidate": self.read_memory_record_by_id("shared", &memory_id)?,
                }),
            )?;
            inserted += 1;
        }
        self.update_trigger_mark(session_id, turn_id)?;
        self.write_memory_markdown_projection("shared")?;
        self.promote_eligible_frozen_memories()?;
        Ok(inserted)
    }

    pub(super) fn read_memory_records(
        &self,
        scope: &str,
        session_id: &str,
        limit: usize,
    ) -> Result<Vec<Value>> {
        let limit = limit.clamp(1, MEMORY_PROMPT_LIMIT) as i64;
        self.with_memory_conn(scope, |conn| {
            let mut stmt = conn.prepare(
                "SELECT memory_id, scope, namespace, kind, value_json, evidence_refs_json,
                        confidence, stability, revision, supersedes_memory_id, status,
                        reference_count, source_session_id, source_turn_id, metadata_json,
                        created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 FROM memory_record
                 WHERE status = 'active'
                   AND (?1 = '' OR source_session_id = ?1 OR scope = ?2)
                 ORDER BY stability DESC, confidence DESC, updated_at_ms DESC
                 LIMIT ?3",
            )?;
            let rows = stmt.query_map(params![session_id, scope, limit], read_memory_record_row)?;
            let mut records = Vec::new();
            for row in rows {
                records.push(row?);
            }
            Ok(records)
        })
    }

    pub(super) fn read_memory_record_by_id(&self, scope: &str, memory_id: &str) -> Result<Value> {
        self.with_memory_conn(scope, |conn| {
            conn.query_row(
                "SELECT memory_id, scope, namespace, kind, value_json, evidence_refs_json,
                        confidence, stability, revision, supersedes_memory_id, status,
                        reference_count, source_session_id, source_turn_id, metadata_json,
                        created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 FROM memory_record
                 WHERE memory_id = ?1",
                params![memory_id],
                read_memory_record_row,
            )
            .optional()?
            .ok_or_else(|| anyhow!("memory record not found: {memory_id}"))
        })
    }

    pub(super) fn with_memory_conn<T>(
        &self,
        scope: &str,
        f: impl FnOnce(&Connection) -> Result<T>,
    ) -> Result<T> {
        fs::create_dir_all(self.shared_dir())?;
        let path = match scope {
            "frozen" => self.shared_dir().join("frozen_truth.sqlite"),
            "shared" => self.shared_dir().join("shared_truth.sqlite"),
            other => return Err(anyhow!("unsupported memory scope: {other}")),
        };
        let conn = Connection::open(path)?;
        configure_conn(&conn)?;
        migrate_memory_truth_v2(&conn)?;
        f(&conn)
    }

    pub(super) fn upsert_memory_record(&self, input: MemoryRecordInput<'_>) -> Result<String> {
        validate_memory_scope(input.scope)?;
        let now = now_ms();
        let now_iso_value = now_iso();
        let value_json = json_string(&input.value)?;
        let value_digest = sha256_hex(value_json.as_bytes());
        let evidence_refs_json = json_string(&input.evidence_refs)?;
        let metadata_json = json_string(&input.metadata)?;
        let normalized_text = normalize_memory_value(&input.value);
        let normalized_sha256 = sha256_hex(normalized_text.as_bytes());
        self.with_memory_conn(input.scope, |conn| {
            let existing: Option<(String, f64, f64, i64, i64)> = conn
                .query_row(
                    "SELECT memory_id, confidence, stability, revision, reference_count
                     FROM memory_record
                     WHERE scope = ?1 AND namespace = ?2 AND kind = ?3 AND value_digest = ?4",
                    params![input.scope, input.namespace, input.kind, value_digest],
                    |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                        ))
                    },
                )
                .optional()?;
            let (memory_id, confidence, stability, revision, reference_count) = existing
                .map(
                    |(memory_id, current_confidence, current_stability, revision, refs)| {
                        (
                            memory_id,
                            current_confidence.max(input.confidence),
                            current_stability.max(input.stability),
                            revision + 1,
                            refs + 1,
                        )
                    },
                )
                .unwrap_or_else(|| {
                    (
                        new_id("memory"),
                        input.confidence,
                        input.stability,
                        1_i64,
                        1_i64,
                    )
                });
            conn.execute(
                "INSERT INTO memory_record (
                    memory_id, scope, namespace, kind, value_json, value_digest,
                    normalized_text, normalized_sha256, evidence_refs_json, confidence,
                    stability, revision, supersedes_memory_id, source_session_id,
                    source_turn_id, source_event_id, metadata_json, status,
                    reference_count, created_at_ms, created_at_iso, updated_at_ms,
                    updated_at_iso, last_verified_at_ms, last_verified_at_iso
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                    ?11, ?12, ?13, ?14, ?15, NULL, ?16, ?17,
                    ?18, ?19, ?20, ?19, ?20, NULL, NULL
                 )
                 ON CONFLICT(memory_id) DO UPDATE SET
                    evidence_refs_json = excluded.evidence_refs_json,
                    confidence = excluded.confidence,
                    stability = excluded.stability,
                    revision = excluded.revision,
                    supersedes_memory_id = excluded.supersedes_memory_id,
                    metadata_json = excluded.metadata_json,
                    status = excluded.status,
                    reference_count = excluded.reference_count,
                    updated_at_ms = excluded.updated_at_ms,
                    updated_at_iso = excluded.updated_at_iso",
                params![
                    memory_id,
                    input.scope,
                    input.namespace,
                    input.kind,
                    value_json,
                    value_digest,
                    normalized_text,
                    normalized_sha256,
                    evidence_refs_json,
                    confidence,
                    stability,
                    revision,
                    input.supersedes_memory_id,
                    input.source_session_id,
                    input.source_turn_id,
                    metadata_json,
                    input.status,
                    reference_count,
                    now,
                    now_iso_value,
                ],
            )?;
            self.upsert_shared_index_entry(
                input.scope,
                &memory_id,
                input.namespace,
                &normalized_text,
                &normalized_sha256,
                input.status,
            )?;
            append_memory_audit(
                &self.shared_dir(),
                audit_filename(input.scope),
                &json!({
                    "schemaVersion": "v2",
                    "event": "memory_record_upserted",
                    "memoryId": memory_id,
                    "scope": input.scope,
                    "namespace": input.namespace,
                    "kind": input.kind,
                    "status": input.status,
                    "revision": revision,
                    "sourceSessionId": input.source_session_id,
                    "sourceTurnId": input.source_turn_id,
                    "createdAtMs": now,
                    "createdAtIso": now_iso_value,
                }),
            )?;
            Ok(memory_id)
        })
    }

    pub(super) fn shared_dir(&self) -> PathBuf {
        self.root.join("shared")
    }

    pub(super) fn write_memory_markdown_projection(&self, scope: &str) -> Result<()> {
        validate_memory_scope(scope)?;
        let filename = if scope == "frozen" {
            "frozen_memory.md"
        } else {
            "shared_memory.md"
        };
        let records = self.read_memory_records(scope, "", 200)?;
        let mut markdown = format!(
            "# {} Memory\n\nThis is a human-readable projection. Primary truth is `{}`.\n\n",
            if scope == "frozen" {
                "Frozen"
            } else {
                "Shared"
            },
            if scope == "frozen" {
                "frozen_truth.sqlite"
            } else {
                "shared_truth.sqlite"
            }
        );
        for record in records {
            markdown.push_str(&format!(
                "- `{}` [{}:{} rev {} confidence {:.2} stability {:.2}] {}\n",
                record["memoryId"].as_str().unwrap_or("memory"),
                record["namespace"].as_str().unwrap_or("project"),
                record["kind"].as_str().unwrap_or("unknown"),
                record["revision"].as_i64().unwrap_or(1),
                record["confidence"].as_f64().unwrap_or(0.0),
                record["stability"].as_f64().unwrap_or(0.0),
                preview_text(&record["value"].to_string(), 240),
            ));
        }
        fs::create_dir_all(self.shared_dir())?;
        fs::write(self.shared_dir().join(filename), markdown)?;
        Ok(())
    }

    pub fn memory_search_truth(&self, scope: &str, query: &str, limit: usize) -> Result<Value> {
        validate_memory_scope(scope)?;
        let needle = query.trim().to_ascii_lowercase();
        if needle.is_empty() {
            return Err(anyhow!("query is required"));
        }
        let limit = limit.clamp(1, 50) as i64;
        self.with_memory_conn(scope, |conn| {
            let pattern = format!("%{needle}%");
            let mut stmt = conn.prepare(
                "SELECT memory_id, scope, namespace, kind, value_json, evidence_refs_json,
                        confidence, stability, revision, supersedes_memory_id, status,
                        reference_count, source_session_id, source_turn_id, metadata_json,
                        created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 FROM memory_record
                 WHERE lower(normalized_text) LIKE ?1
                    OR lower(value_json) LIKE ?1
                    OR lower(kind) LIKE ?1
                 ORDER BY stability DESC, confidence DESC, updated_at_ms DESC
                 LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![pattern, limit], read_memory_record_row)?;
            let mut results = Vec::new();
            for row in rows {
                results.push(row?);
            }
            Ok(json!({
                "schemaVersion": "v2",
                "kind": "memorySearchTruthResult",
                "scope": scope,
                "query": query,
                "results": results,
            }))
        })
    }

    pub fn propose_memory_record(
        &self,
        scope: &str,
        namespace: &str,
        kind: &str,
        value: Value,
        evidence_refs: Vec<String>,
        source_session_id: &str,
        source_turn_id: Option<&str>,
    ) -> Result<Value> {
        let memory_id = self.upsert_memory_record(MemoryRecordInput {
            scope,
            namespace,
            kind,
            value,
            evidence_refs,
            source_session_id,
            source_turn_id,
            confidence: 0.4,
            stability: 0.3,
            status: "candidate",
            supersedes_memory_id: None,
            metadata: json!({
                "source": "tools_memory_propose_memory",
                "semanticScoring": "queued_model_gateway",
            }),
        })?;
        self.enqueue_memory_gateway_job(
            source_session_id,
            source_turn_id.unwrap_or_default(),
            &memory_id,
            "semantic_score_candidate",
            json!({
                "schemaVersion": "v2",
                "gateway": "model_gateway",
                "task": "score_memory_candidate",
                "memoryId": memory_id,
                "candidate": self.read_memory_record_by_id(scope, &memory_id)?,
            }),
        )?;
        Ok(json!({ "memoryId": memory_id, "status": "candidate" }))
    }

    pub fn update_memory_record_status_or_value(
        &self,
        scope: &str,
        memory_id: &str,
        status: Option<&str>,
        value: Option<Value>,
        evidence_refs: Vec<String>,
    ) -> Result<Value> {
        validate_memory_scope(scope)?;
        let now = now_ms();
        let now_iso_value = now_iso();
        self.with_memory_conn(scope, |conn| {
            let before = self.read_memory_record_by_id(scope, memory_id)?;
            let next_status = status
                .and_then(trim_to_string)
                .unwrap_or_else(|| before["status"].as_str().unwrap_or("candidate").to_string());
            let next_value = value.unwrap_or_else(|| before["value"].clone());
            if contains_secret_like_text(&next_value.to_string()) {
                return Err(anyhow!("memory value contains secret-like text"));
            }
            let next_revision = before["revision"].as_i64().unwrap_or(1) + 1;
            let evidence = if evidence_refs.is_empty() {
                before["evidenceRefs"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
            } else {
                evidence_refs.into_iter().map(Value::String).collect()
            };
            let value_json = json_string(&next_value)?;
            let normalized = normalize_memory_value(&next_value);
            conn.execute(
                "UPDATE memory_record
                 SET value_json = ?1,
                     value_digest = ?2,
                     normalized_text = ?3,
                     normalized_sha256 = ?4,
                     evidence_refs_json = ?5,
                     status = ?6,
                     revision = ?7,
                     updated_at_ms = ?8,
                     updated_at_iso = ?9
                 WHERE memory_id = ?10",
                params![
                    value_json,
                    sha256_hex(value_json.as_bytes()),
                    normalized,
                    sha256_hex(normalized.as_bytes()),
                    json_string(&evidence)?,
                    next_status,
                    next_revision,
                    now,
                    now_iso_value,
                    memory_id,
                ],
            )?;
            append_memory_audit(
                &self.shared_dir(),
                audit_filename(scope),
                &json!({
                    "schemaVersion": "v2",
                    "event": "memory_record_updated",
                    "scope": scope,
                    "memoryId": memory_id,
                    "status": next_status,
                    "revision": next_revision,
                    "createdAtMs": now,
                    "createdAtIso": now_iso_value,
                }),
            )?;
            self.read_memory_record_by_id(scope, memory_id)
        })
    }

    #[cfg(not(test))]
    pub fn apply_memory_gateway_score(
        &self,
        scope: &str,
        memory_id: &str,
        confidence: f64,
        stability: f64,
        accepted: bool,
        score_result: Value,
    ) -> Result<Value> {
        validate_memory_scope(scope)?;
        let confidence = confidence.clamp(0.0, 1.0);
        let stability = stability.clamp(0.0, 1.0);
        let status = if accepted && confidence >= 0.65 {
            "active"
        } else {
            "candidate"
        };
        let now = now_ms();
        let now_iso_value = now_iso();
        self.with_memory_conn(scope, |conn| {
            conn.execute(
                "UPDATE memory_record
                 SET confidence = ?1,
                     stability = ?2,
                     status = ?3,
                     metadata_json = json_set(
                        metadata_json,
                        '$.semanticScoring',
                        'model_gateway_completed',
                        '$.modelGatewayScore',
                        json(?4)
                     ),
                     updated_at_ms = ?5,
                     updated_at_iso = ?6,
                     last_verified_at_ms = ?5,
                     last_verified_at_iso = ?6
                 WHERE memory_id = ?7",
                params![
                    confidence,
                    stability,
                    status,
                    json_string(&score_result)?,
                    now,
                    now_iso_value,
                    memory_id,
                ],
            )?;
            Ok(())
        })?;
        append_memory_audit(
            &self.shared_dir(),
            audit_filename(scope),
            &json!({
                "schemaVersion": "v2",
                "event": "memory_gateway_score_applied",
                "scope": scope,
                "memoryId": memory_id,
                "status": status,
                "confidence": confidence,
                "stability": stability,
                "createdAtMs": now,
                "createdAtIso": now_iso_value,
            }),
        )?;
        self.read_memory_record_by_id(scope, memory_id)
    }

    pub fn create_memory_conflict_candidate(
        &self,
        scope: &str,
        namespace: &str,
        kind: &str,
        value: Value,
        conflicts_with: Vec<String>,
        evidence_refs: Vec<String>,
        source_session_id: &str,
        source_turn_id: Option<&str>,
    ) -> Result<Value> {
        validate_memory_scope(scope)?;
        let memory_id = self.upsert_memory_record(MemoryRecordInput {
            scope,
            namespace,
            kind,
            value,
            evidence_refs: evidence_refs.clone(),
            source_session_id,
            source_turn_id,
            confidence: 0.35,
            stability: 0.2,
            status: "conflict_candidate",
            supersedes_memory_id: None,
            metadata: json!({
                "source": "tools_memory_create_conflict_candidate",
                "conflictsWith": conflicts_with,
            }),
        })?;
        let conflict_set_id = new_id("conflict_set");
        let now = now_ms();
        let now_iso_value = now_iso();
        self.with_conflict_conn(|conn| {
            conn.execute(
                "INSERT INTO conflict_set (
                    conflict_set_id, namespace, status, summary, created_at_ms,
                    created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, 'open', ?3, ?4, ?5, ?4, ?5)",
                params![
                    conflict_set_id,
                    namespace,
                    format!("Conflict candidate for {scope}:{kind}"),
                    now,
                    now_iso_value,
                ],
            )?;
            conn.execute(
                "INSERT INTO conflict_candidate (
                    conflict_candidate_id, conflict_set_id, memory_id, scope, stance,
                    evidence_refs_json, status, created_at_ms, created_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, 'candidate', ?5, 'open', ?6, ?7)",
                params![
                    new_id("conflict_candidate"),
                    conflict_set_id,
                    memory_id,
                    scope,
                    json_string(&evidence_refs)?,
                    now,
                    now_iso_value,
                ],
            )?;
            Ok(())
        })?;
        Ok(json!({
            "memoryId": memory_id,
            "conflictSetId": conflict_set_id,
            "status": "conflict_candidate",
        }))
    }

    pub fn audit_memory_records(&self, scope: &str, limit: usize) -> Result<Value> {
        validate_memory_scope(scope)?;
        let filename = self.shared_dir().join(audit_filename(scope));
        let limit = limit.clamp(1, 100);
        let lines = fs::read_to_string(filename)
            .unwrap_or_default()
            .lines()
            .rev()
            .take(limit)
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .collect::<Vec<_>>();
        Ok(json!({
            "schemaVersion": "v2",
            "kind": "memoryAudit",
            "scope": scope,
            "entries": lines,
        }))
    }

    pub fn assemble_memory_context_tool(
        &self,
        session_id: &str,
        max_chars: usize,
    ) -> Result<Value> {
        let max_chars = max_chars.clamp(512, 64_000);
        let messages = self.with_session_conn(session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT msg_id, role, content_raw, created_at_ms
                 FROM session_dialog
                 ORDER BY created_at_ms ASC, turn_index ASC",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(json!({
                    "messageId": row.get::<_, String>(0)?,
                    "role": row.get::<_, String>(1)?,
                    "content": row.get::<_, String>(2)?,
                    "createdAtMs": row.get::<_, i64>(3)?,
                }))
            })?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })?;
        let tail_budget = max_chars / 2;
        let middle_budget = max_chars / 4;
        let head_budget = max_chars / 8;
        let pinned = self.read_pinned_memory_context(session_id, 12)?;
        Ok(json!({
            "schemaVersion": "v2",
            "kind": "assembledContext",
            "sessionId": session_id,
            "budget": {
                "maxChars": max_chars,
                "headChars": head_budget,
                "pinnedChars": max_chars.saturating_sub(tail_budget + middle_budget + head_budget),
                "middleChars": middle_budget,
                "tailChars": tail_budget,
            },
            "head": select_head(&messages, head_budget),
            "pinned": pinned,
            "middle": select_middle(&messages, middle_budget),
            "tail": select_tail(&messages, tail_budget),
        }))
    }

    fn read_pinned_memory_context(&self, session_id: &str, limit: usize) -> Result<Value> {
        let limit = limit.clamp(1, 20) as i64;
        self.with_session_conn(session_id, |conn| {
            let unresolved_commitments = read_json_rows(
                conn,
                "SELECT todo_item_id, title, status, risk_level, evidence_refs_json
                 FROM todo_item
                 WHERE status NOT IN ('completed', 'cancelled')
                 ORDER BY updated_at_ms DESC
                 LIMIT ?1",
                limit,
                |row| {
                    Ok(json!({
                        "todoItemId": row.get::<_, String>(0)?,
                        "title": row.get::<_, String>(1)?,
                        "status": row.get::<_, String>(2)?,
                        "riskLevel": row.get::<_, String>(3)?,
                        "evidenceRefs": parse_json_or(row.get::<_, String>(4)?, Vec::<String>::new()),
                    }))
                },
            )?;
            let policy_refs = read_json_rows(
                conn,
                "SELECT snapshot_id, source, status, created_at_ms
                 FROM effective_policy_snapshot
                 ORDER BY created_at_ms DESC
                 LIMIT ?1",
                limit,
                |row| {
                    Ok(json!({
                        "snapshotId": row.get::<_, String>(0)?,
                        "source": row.get::<_, String>(1)?,
                        "status": row.get::<_, String>(2)?,
                        "createdAtMs": row.get::<_, i64>(3)?,
                    }))
                },
            )?;
            let recovery_anchors = read_json_rows(
                conn,
                "SELECT anchor_id, runtime_turn_id, checkpoint_id, status, created_at_ms
                 FROM message_rollback_anchor
                 WHERE status = 'active'
                 ORDER BY created_at_ms DESC
                 LIMIT ?1",
                limit,
                |row| {
                    Ok(json!({
                        "anchorId": row.get::<_, String>(0)?,
                        "runtimeTurnId": row.get::<_, String>(1)?,
                        "checkpointId": row.get::<_, String>(2)?,
                        "status": row.get::<_, String>(3)?,
                        "createdAtMs": row.get::<_, i64>(4)?,
                    }))
                },
            )?;
            let active_follow = read_json_rows(
                conn,
                "SELECT follow_session_id, runtime_turn_id, status, event_stream_ref, updated_at_ms
                 FROM follow_session
                 WHERE status NOT IN ('completed', 'cancelled', 'failed')
                 ORDER BY updated_at_ms DESC
                 LIMIT ?1",
                limit,
                |row| {
                    Ok(json!({
                        "followSessionId": row.get::<_, String>(0)?,
                        "runtimeTurnId": row.get::<_, Option<String>>(1)?,
                        "status": row.get::<_, String>(2)?,
                        "eventStreamRef": row.get::<_, Option<String>>(3)?,
                        "updatedAtMs": row.get::<_, i64>(4)?,
                    }))
                },
            )?;
            Ok(json!({
                "pinnedFacts": policy_refs,
                "pinnedSpans": recovery_anchors,
                "unresolvedCommitments": unresolved_commitments,
                "activeFollow": active_follow,
            }))
        })
    }

    fn read_memory_trigger_events(
        &self,
        session_id: &str,
        turn_id: &str,
    ) -> Result<Vec<MemoryTriggerEvent>> {
        self.with_session_conn(session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT event_id, sequence, event_type, payload_json, created_at_ms, created_at_iso
                 FROM runtime_event
                 WHERE runtime_turn_id = ?1
                 ORDER BY sequence ASC",
            )?;
            let rows = stmt.query_map(params![turn_id], |row| {
                let event_type: String = row.get(2)?;
                let payload_json: String = row.get(3)?;
                Ok(MemoryTriggerEvent {
                    event_id: row.get(0)?,
                    sequence: row.get(1)?,
                    event_type,
                    payload: parse_json_or(payload_json, json!({})),
                    created_at_ms: row.get(4)?,
                    created_at_iso: row.get(5)?,
                })
            })?;
            let mut events = Vec::new();
            for row in rows {
                let event = row?;
                if is_memory_trigger_event(&event.event_type) {
                    events.push(event);
                }
            }
            Ok(events)
        })
    }

    fn record_memory_event_candidate(
        &self,
        session_id: &str,
        turn_id: &str,
        event_id: &str,
        event_type: &str,
        status: &str,
        memory_id: Option<&str>,
    ) -> Result<()> {
        let now = now_ms();
        let now_iso_value = now_iso();
        self.with_trigger_marks_conn(|conn| {
            conn.execute(
                "INSERT INTO memory_event_candidate (
                    candidate_id, session_id, runtime_turn_id, event_id, event_type,
                    status, memory_id, created_at_ms, created_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(session_id, event_id) DO UPDATE SET
                    status = excluded.status,
                    memory_id = excluded.memory_id",
                params![
                    new_id("memory_candidate"),
                    session_id,
                    turn_id,
                    event_id,
                    event_type,
                    status,
                    memory_id,
                    now,
                    now_iso_value,
                ],
            )?;
            Ok(())
        })
    }

    fn enqueue_memory_gateway_job(
        &self,
        session_id: &str,
        turn_id: &str,
        target_ref: &str,
        job_kind: &str,
        request: Value,
    ) -> Result<()> {
        let now = now_ms();
        let now_iso_value = now_iso();
        self.with_memory_jobs_conn(|conn| {
            conn.execute(
                "INSERT INTO memory_job (
                    job_id, job_kind, status, budget_class, session_id, runtime_turn_id,
                    target_ref, request_json, result_json, attempts, created_at_ms,
                    created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, 'pending', 'model_gateway_low', ?3, ?4, ?5, ?6, NULL, 0, ?7, ?8, ?7, ?8)",
                params![
                    new_id("memory_job"),
                    job_kind,
                    session_id,
                    turn_id,
                    target_ref,
                    json_string(&request)?,
                    now,
                    now_iso_value,
                ],
            )?;
            Ok(())
        })
    }

    fn update_trigger_mark(&self, session_id: &str, turn_id: &str) -> Result<()> {
        let max_sequence = self.with_session_conn(session_id, |conn| {
            Ok(conn.query_row(
                "SELECT COALESCE(MAX(sequence), 0) FROM runtime_event WHERE runtime_turn_id = ?1",
                params![turn_id],
                |row| row.get::<_, i64>(0),
            )?)
        })?;
        let now = now_ms();
        self.with_trigger_marks_conn(|conn| {
            conn.execute(
                "INSERT INTO trigger_mark (
                    trigger_id, session_id, trigger_kind, last_event_sequence,
                    last_runtime_turn_id, status, created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, 'agent_memory_v2', ?3, ?4, 'active', ?5, ?5)
                 ON CONFLICT(session_id, trigger_kind) DO UPDATE SET
                    last_event_sequence = excluded.last_event_sequence,
                    last_runtime_turn_id = excluded.last_runtime_turn_id,
                    status = 'active',
                    updated_at_ms = excluded.updated_at_ms",
                params![new_id("trigger"), session_id, max_sequence, turn_id, now,],
            )?;
            Ok(())
        })
    }

    fn write_dynamic_prompt_snapshot(&self, session_id: &str, context: &Value) -> Result<()> {
        let snapshot = render_dynamic_prompt_snapshot(session_id, context);
        if contains_secret_like_text(&snapshot) {
            return Ok(());
        }
        fs::create_dir_all(self.shared_dir())?;
        fs::write(self.shared_dir().join("dynamic_prompt_cache.md"), &snapshot)?;
        let now = now_ms();
        let now_iso_value = now_iso();
        self.with_prompt_cache_conn(|conn| {
            conn.execute(
                "INSERT INTO prompt_cache_snapshot (
                    snapshot_id, session_id, target_space, content_sha256,
                    source_refs_json, created_at_ms, created_at_iso
                 ) VALUES (?1, ?2, 'dynamic', ?3, ?4, ?5, ?6)",
                params![
                    new_id("prompt_snapshot"),
                    session_id,
                    sha256_hex(snapshot.as_bytes()),
                    json!({
                        "sharedTruth": "shared/shared_truth.sqlite",
                        "frozenTruth": "shared/frozen_truth.sqlite",
                    })
                    .to_string(),
                    now,
                    now_iso_value,
                ],
            )?;
            Ok(())
        })
    }

    fn upsert_shared_index_entry(
        &self,
        scope: &str,
        memory_id: &str,
        namespace: &str,
        normalized_text: &str,
        normalized_sha256: &str,
        status: &str,
    ) -> Result<()> {
        let now = now_ms();
        self.with_shared_index_conn(|conn| {
            conn.execute(
                "INSERT INTO shared_index_entry (
                    entry_id, memory_id, scope, namespace, normalized_text,
                    normalized_sha256, status, created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
                 ON CONFLICT(memory_id) DO UPDATE SET
                    normalized_text = excluded.normalized_text,
                    normalized_sha256 = excluded.normalized_sha256,
                    status = excluded.status,
                    updated_at_ms = excluded.updated_at_ms",
                params![
                    new_id("shared_index"),
                    memory_id,
                    scope,
                    namespace,
                    normalized_text,
                    normalized_sha256,
                    status,
                    now,
                ],
            )?;
            Ok(())
        })
    }
}

pub(super) struct MemoryRecordInput<'a> {
    pub scope: &'a str,
    pub namespace: &'a str,
    pub kind: &'a str,
    pub value: Value,
    pub evidence_refs: Vec<String>,
    pub source_session_id: &'a str,
    pub source_turn_id: Option<&'a str>,
    pub confidence: f64,
    pub stability: f64,
    pub status: &'a str,
    pub supersedes_memory_id: Option<&'a str>,
    pub metadata: Value,
}

#[derive(Clone, Debug)]
struct MemoryTriggerEvent {
    event_id: String,
    sequence: i64,
    event_type: String,
    payload: Value,
    created_at_ms: i64,
    created_at_iso: String,
}

fn migrate_memory_truth_v2(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA journal_mode = WAL;")?;
    if !memory_table_is_v2(conn)? {
        return Err(anyhow!(
            "AI memory truth database is not V2. Delete ~/.lyra/modules/ai before using Agent Memory V2."
        ));
    }
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS memory_record (
            memory_id TEXT PRIMARY KEY,
            scope TEXT NOT NULL,
            namespace TEXT NOT NULL,
            kind TEXT NOT NULL,
            value_json TEXT NOT NULL,
            value_digest TEXT NOT NULL,
            normalized_text TEXT NOT NULL,
            normalized_sha256 TEXT NOT NULL,
            evidence_refs_json TEXT NOT NULL,
            confidence REAL NOT NULL,
            stability REAL NOT NULL,
            revision INTEGER NOT NULL,
            supersedes_memory_id TEXT,
            source_session_id TEXT NOT NULL,
            source_turn_id TEXT,
            source_event_id TEXT,
            metadata_json TEXT NOT NULL,
            status TEXT NOT NULL,
            reference_count INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL,
            last_verified_at_ms INTEGER,
            last_verified_at_iso TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS memory_record_exact_idx
            ON memory_record(scope, namespace, kind, value_digest);
        CREATE INDEX IF NOT EXISTS memory_record_lookup_idx
            ON memory_record(scope, namespace, status, updated_at_ms);
        PRAGMA user_version = 2;
        ",
    )?;
    Ok(())
}

fn memory_table_is_v2(conn: &Connection) -> Result<bool> {
    let exists = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_record'",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !exists {
        return Ok(true);
    }
    let mut stmt = conn.prepare("PRAGMA table_info(memory_record)")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for row in rows {
        if row? == "value_json" {
            return Ok(true);
        }
    }
    Ok(false)
}

fn validate_memory_scope(scope: &str) -> Result<()> {
    match scope {
        "shared" | "frozen" => Ok(()),
        other => Err(anyhow!("unsupported memory scope: {other}")),
    }
}

fn read_memory_record_row(row: &Row<'_>) -> rusqlite::Result<Value> {
    let value_json: String = row.get(4)?;
    let evidence_refs_json: String = row.get(5)?;
    let metadata_json: String = row.get(14)?;
    Ok(json!({
        "memoryId": row.get::<_, String>(0)?,
        "scope": row.get::<_, String>(1)?,
        "namespace": row.get::<_, String>(2)?,
        "kind": row.get::<_, String>(3)?,
        "value": serde_json::from_str::<Value>(&value_json).unwrap_or(Value::Null),
        "evidenceRefs": serde_json::from_str::<Value>(&evidence_refs_json).unwrap_or_else(|_| json!([])),
        "confidence": row.get::<_, f64>(6)?,
        "stability": row.get::<_, f64>(7)?,
        "revision": row.get::<_, i64>(8)?,
        "supersedesMemoryId": row.get::<_, Option<String>>(9)?,
        "status": row.get::<_, String>(10)?,
        "referenceCount": row.get::<_, i64>(11)?,
        "sourceSessionId": row.get::<_, String>(12)?,
        "sourceTurnId": row.get::<_, Option<String>>(13)?,
        "metadata": serde_json::from_str::<Value>(&metadata_json).unwrap_or_else(|_| json!({})),
        "createdAtMs": row.get::<_, i64>(15)?,
        "createdAtIso": row.get::<_, String>(16)?,
        "updatedAtMs": row.get::<_, i64>(17)?,
        "updatedAtIso": row.get::<_, String>(18)?,
    }))
}

fn append_memory_audit(dir: &Path, filename: &str, value: &Value) -> Result<()> {
    fs::create_dir_all(dir)?;
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(filename))?;
    writeln!(file, "{}", serde_json::to_string(value)?)?;
    Ok(())
}

fn audit_filename(scope: &str) -> &'static str {
    if scope == "frozen" {
        "frozen_memory.audit.jsonl"
    } else {
        "shared_memory.audit.jsonl"
    }
}

fn normalize_memory_value(value: &Value) -> String {
    match value {
        Value::String(text) => text.trim().to_string(),
        _ => value.to_string(),
    }
}

fn is_memory_trigger_event(event_type: &str) -> bool {
    matches!(
        event_type,
        "runtime_turn_completed"
            | "tool_operation_completed"
            | "file_change_recorded"
            | "test_result_changed"
            | "decision_applied_or_rolled_back"
    )
}

fn event_namespace(event_type: &str) -> &'static str {
    match event_type {
        "tool_operation_completed" => "tool",
        "file_change_recorded" => "workspace",
        "test_result_changed" => "verification",
        "decision_applied_or_rolled_back" => "decision",
        _ => "session",
    }
}

fn event_memory_kind(event_type: &str) -> &'static str {
    match event_type {
        "tool_operation_completed" => "tool_outcome",
        "file_change_recorded" => "workspace_change",
        "test_result_changed" => "verification_signal",
        "decision_applied_or_rolled_back" => "runtime_decision",
        _ => "turn_summary",
    }
}

fn memory_value_from_event(event: &MemoryTriggerEvent) -> Value {
    json!({
        "eventType": event.event_type,
        "eventId": event.event_id,
        "sequence": event.sequence,
        "summary": event_summary(&event.event_type, &event.payload),
        "payloadPreview": preview_text(&event.payload.to_string(), 500),
        "createdAtMs": event.created_at_ms,
        "createdAtIso": event.created_at_iso,
    })
}

fn event_summary(event_type: &str, payload: &Value) -> String {
    match event_type {
        "tool_operation_completed" => {
            let path = payload
                .get("operation")
                .and_then(|operation| operation.get("path"))
                .and_then(Value::as_str)
                .unwrap_or("tool");
            format!("Tool operation completed: {path}")
        }
        "runtime_turn_completed" => "Runtime turn completed".to_string(),
        "file_change_recorded" => "Workspace file change recorded".to_string(),
        "test_result_changed" => "Verification result changed".to_string(),
        "decision_applied_or_rolled_back" => "Runtime decision changed".to_string(),
        _ => event_type.to_string(),
    }
}

fn render_dynamic_prompt_snapshot(session_id: &str, context: &Value) -> String {
    format!(
        "# Dynamic Prompt Snapshot\n\nSession: `{session_id}`\n\nThis file is observable only. It is not source of truth.\n\n```json\n{}\n```\n",
        serde_json::to_string_pretty(context).unwrap_or_else(|_| "{}".to_string())
    )
}

fn read_json_rows(
    conn: &Connection,
    sql: &str,
    limit: i64,
    mut read: impl FnMut(&Row<'_>) -> rusqlite::Result<Value>,
) -> Result<Vec<Value>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![limit], |row| read(row))?;
    let mut values = Vec::new();
    for row in rows {
        values.push(row?);
    }
    Ok(values)
}

fn select_head(messages: &[Value], budget: usize) -> Vec<Value> {
    select_from_start(messages, budget)
}

fn select_middle(messages: &[Value], budget: usize) -> Vec<Value> {
    if messages.len() <= 4 {
        return Vec::new();
    }
    let middle = &messages[2..messages.len().saturating_sub(2)];
    select_from_start(middle, budget)
}

fn select_tail(messages: &[Value], budget: usize) -> Vec<Value> {
    let mut used = 0_usize;
    let mut selected = Vec::new();
    for message in messages.iter().rev() {
        let chars = message.to_string().chars().count();
        if selected.is_empty() || used.saturating_add(chars) <= budget {
            used = used.saturating_add(chars);
            selected.push(message.clone());
        } else {
            break;
        }
    }
    selected.reverse();
    selected
}

fn select_from_start(messages: &[Value], budget: usize) -> Vec<Value> {
    let mut used = 0_usize;
    let mut selected = Vec::new();
    for message in messages {
        let chars = message.to_string().chars().count();
        if selected.is_empty() || used.saturating_add(chars) <= budget {
            used = used.saturating_add(chars);
            selected.push(message.clone());
        } else {
            break;
        }
    }
    selected
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v2_memory_candidate_is_queued_for_model_gateway_scoring() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = AiStore::open(Some(temp.path().to_string_lossy().as_ref())).expect("store");
        store
            .upsert_memory_record(MemoryRecordInput {
                scope: "shared",
                namespace: "project",
                kind: "project_convention",
                value: json!({ "text": "Keep runtime state in Rust native core." }),
                evidence_refs: vec!["runtime_turn:turn-a".to_string()],
                source_session_id: "session-a",
                source_turn_id: Some("turn-a"),
                confidence: 0.4,
                stability: 0.3,
                status: "candidate",
                supersedes_memory_id: None,
                metadata: json!({ "basis": "test" }),
            })
            .expect("upsert");

        let context = store
            .read_memory_prompt_context("session-a", 8)
            .expect("memory context");

        assert_eq!(context["schemaVersion"], "v2");
        assert!(context["rules"]
            .as_array()
            .expect("rules")
            .iter()
            .any(|rule| {
                rule.as_str()
                    .unwrap_or_default()
                    .contains("dynamic_prompt_cache.md")
            }));
    }
}
