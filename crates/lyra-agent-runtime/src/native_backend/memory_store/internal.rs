use super::*;

pub(super) fn open_memory_connection(root: &Path) -> AgentRuntimeResult<Connection> {
    fs::create_dir_all(root).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    Connection::open(memory_store_path(root)).map_err(sql_error)
}

pub(super) fn init_memory_schema(conn: &Connection) -> AgentRuntimeResult<()> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL,
          category TEXT NOT NULL,
          fact TEXT NOT NULL,
          content_json TEXT NOT NULL,
          confidence REAL NOT NULL,
          source_type TEXT NOT NULL,
          source_ref TEXT,
          status TEXT NOT NULL,
          priority INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_accessed_at TEXT,
          access_count INTEGER NOT NULL DEFAULT 0,
          expires_at TEXT,
          supersedes TEXT,
          superseded_by TEXT
        );

        CREATE TABLE IF NOT EXISTS memory_tags (
          memory_id TEXT NOT NULL,
          tag TEXT NOT NULL,
          PRIMARY KEY (memory_id, tag),
          FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS memory_relations (
          source_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          relation TEXT NOT NULL,
          confidence REAL NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (source_id, target_id, relation),
          FOREIGN KEY (source_id) REFERENCES memories(id) ON DELETE CASCADE,
          FOREIGN KEY (target_id) REFERENCES memories(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS memory_events (
          id TEXT PRIMARY KEY,
          memory_id TEXT,
          event_type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
          memory_id UNINDEXED,
          fact,
          content,
          tags,
          category,
          scope
        );

        CREATE TABLE IF NOT EXISTS memory_embeddings (
          memory_id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          dimension INTEGER NOT NULL,
          vector BLOB NOT NULL,
          content_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS memory_access_events (
          id TEXT PRIMARY KEY,
          memory_id TEXT NOT NULL,
          access_type TEXT NOT NULL,
          query TEXT,
          score REAL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS memory_candidates (
          id TEXT PRIMARY KEY,
          fact TEXT NOT NULL,
          content_json TEXT NOT NULL,
          category TEXT NOT NULL,
          scope TEXT NOT NULL,
          confidence REAL NOT NULL,
          source_type TEXT NOT NULL,
          source_ref TEXT,
          proposed_action TEXT NOT NULL,
          conflict_with TEXT,
          target_id TEXT,
          relation_type TEXT,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          reviewed_at TEXT,
          expires_at TEXT
        );

        CREATE TABLE IF NOT EXISTS memory_injection_events (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          turn_id TEXT,
          query TEXT,
          selected_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS proactive_events (
          id TEXT PRIMARY KEY,
          trigger_type TEXT NOT NULL,
          title TEXT NOT NULL,
          reason TEXT NOT NULL,
          source_json TEXT NOT NULL,
          mode TEXT NOT NULL,
          status TEXT NOT NULL,
          session_id TEXT,
          created_at TEXT NOT NULL,
          dismissed_at TEXT,
          opened_session_id TEXT
        );
        "#,
    )
    .map_err(sql_error)?;
    conn.execute(
        "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
        params![MEMORY_SCHEMA_VERSION, now()],
    )
    .map_err(sql_error)?;
    Ok(())
}

pub(super) fn rank_memory_records(
    conn: &Connection,
    query: &MemoryQuery,
) -> AgentRuntimeResult<Vec<RankedMemoryRecord>> {
    let query_text = query
        .query
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let fts_scores = query_text
        .map(|text| fts_score_map(conn, text))
        .transpose()?
        .unwrap_or_default();
    let query_embedding = query_text.and_then(query_embedding);
    let embeddings = if query_embedding.is_some() {
        load_embedding_map(conn)?
    } else {
        HashMap::new()
    };
    let relation_counts = relation_degree_map(conn)?;
    let contradiction_ids = contradiction_id_set(conn)?;
    let mut ranked = Vec::new();
    for record in load_all_memory_records(conn)? {
        if !memory_passes_filters(&record, query) {
            continue;
        }
        let fts_score = fts_scores.get(&record.id).copied().unwrap_or(0.0);
        let vector_score = query_embedding
            .as_ref()
            .map(|query_vector| {
                let record_vector = embeddings.get(&record.id).cloned().or_else(|| {
                    try_upsert_memory_embedding(conn, &record).ok().flatten()?;
                    load_memory_embedding(conn, &record.id).ok().flatten()
                });
                record_vector
                    .as_ref()
                    .map(|vector| cosine(query_vector, vector))
                    .unwrap_or(0.0)
            })
            .unwrap_or(0.0);
        let metadata_relevance = metadata_relevance(&record, query_text, query);
        let confidence_boost = record.confidence.clamp(0.0, 1.0);
        let access_frequency_boost = access_frequency_boost(record.access_count);
        let graph_degree = relation_counts.get(&record.id).copied().unwrap_or(0);
        let (half_life_days, age_days, retention, decay_penalty) =
            decay_metrics(&record, graph_degree);
        let recency_boost = retention.clamp(0.0, 1.0);
        let contradiction_penalty = if contradiction_ids.contains(&record.id) {
            0.4
        } else {
            0.0
        };
        let mut matched_by = Vec::new();
        if fts_score > 0.0 {
            matched_by.push("fts".to_string());
        }
        if vector_score > 0.12 {
            matched_by.push("vector".to_string());
        }
        if metadata_relevance > 0.0 {
            matched_by.push("metadata".to_string());
        }
        let mut breakdown = MemoryScoreBreakdown {
            fts_score,
            vector_score,
            metadata_relevance,
            confidence_boost,
            access_frequency_boost,
            graph_boost: 0.0,
            recency_boost,
            decay_penalty,
            contradiction_penalty,
            half_life_days,
            age_days,
            retention,
            matched_by,
            ..MemoryScoreBreakdown::default()
        };
        breakdown.final_score = final_memory_score(&breakdown);
        ranked.push(RankedMemoryRecord {
            record,
            score: breakdown.final_score,
            breakdown,
        });
    }

    if query.include_related {
        let seed_ids = ranked
            .iter()
            .filter(|entry| {
                entry.breakdown.fts_score > 0.0
                    || entry.breakdown.vector_score > 0.45
                    || entry.breakdown.metadata_relevance > 0.0
            })
            .take(12)
            .map(|entry| entry.record.id.clone())
            .collect::<Vec<_>>();
        let boosts = graph_expansion_boosts(conn, &seed_ids)?;
        for entry in &mut ranked {
            if let Some(boost) = boosts.get(&entry.record.id) {
                entry.breakdown.graph_boost = (*boost).min(1.0);
                if !entry
                    .breakdown
                    .matched_by
                    .iter()
                    .any(|source| source == "graph")
                {
                    entry.breakdown.matched_by.push("graph".to_string());
                }
                entry.breakdown.final_score = final_memory_score(&entry.breakdown);
                entry.score = entry.breakdown.final_score;
            }
        }
    }

    if query_text.is_some() {
        ranked.retain(|entry| {
            entry.breakdown.fts_score > 0.0
                || entry.breakdown.vector_score > 0.12
                || entry.breakdown.metadata_relevance > 0.0
                || entry.breakdown.graph_boost > 0.0
        });
    }

    ranked.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| right.record.updated_at.cmp(&left.record.updated_at))
    });
    Ok(ranked)
}

pub(super) fn load_all_memory_records(
    conn: &Connection,
) -> AgentRuntimeResult<Vec<LongTermMemoryRecord>> {
    let mut statement = conn
        .prepare("SELECT id FROM memories ORDER BY priority DESC, updated_at DESC, created_at DESC")
        .map_err(sql_error)?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    ids.into_iter()
        .filter_map(|id| load_memory_record(conn, &id).transpose())
        .collect()
}

pub(super) fn memory_passes_filters(record: &LongTermMemoryRecord, query: &MemoryQuery) -> bool {
    if !query.include_archived && record.status != "active" {
        return false;
    }
    if let Some(status) = query.status.as_deref()
        && record.status != status
    {
        return false;
    }
    if let Some(scope) = query.scope.as_deref()
        && record.scope != scope
    {
        return false;
    }
    if let Some(category) = query.category.as_deref()
        && record.category != category
    {
        return false;
    }
    if is_expired(record) && record.status == "active" && query.status.is_none() {
        return false;
    }
    true
}

pub(super) fn final_memory_score(breakdown: &MemoryScoreBreakdown) -> f64 {
    (breakdown.fts_score * 0.34
        + breakdown.vector_score * 0.34
        + breakdown.metadata_relevance * 0.08
        + breakdown.confidence_boost * 0.08
        + breakdown.access_frequency_boost * 0.08
        + breakdown.graph_boost * 0.05
        + breakdown.recency_boost * 0.03
        - breakdown.decay_penalty
        - breakdown.contradiction_penalty)
        .max(0.0)
}

pub(super) fn fts_score_map(
    conn: &Connection,
    query: &str,
) -> AgentRuntimeResult<HashMap<String, f64>> {
    let Some(fts_query) = fts_query(query) else {
        return Ok(HashMap::new());
    };
    let mut statement = conn
        .prepare(
            "SELECT memory_id, bm25(memory_fts) AS rank
             FROM memory_fts
             WHERE memory_fts MATCH ?1",
        )
        .map_err(sql_error)?;
    let rows = statement
        .query_map(params![fts_query], |row| {
            let id: String = row.get(0)?;
            let rank: f64 = row.get(1)?;
            Ok((id, 1.0 / (1.0 + rank.abs())))
        })
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    Ok(rows.into_iter().collect())
}

pub(super) fn fts_query(query: &str) -> Option<String> {
    let terms = search_terms(query);
    if terms.is_empty() {
        return None;
    }
    Some(
        terms
            .into_iter()
            .take(12)
            .map(|term| {
                if term.is_ascii() {
                    format!("{term}*")
                } else {
                    format!("\"{}\"", term.replace('"', ""))
                }
            })
            .collect::<Vec<_>>()
            .join(" OR "),
    )
}

pub(super) fn metadata_relevance(
    record: &LongTermMemoryRecord,
    query_text: Option<&str>,
    query: &MemoryQuery,
) -> f64 {
    let mut score = 0.0_f64;
    if query.scope.as_deref() == Some(record.scope.as_str()) {
        score += 0.35;
    }
    if query.category.as_deref() == Some(record.category.as_str()) {
        score += 0.35;
    }
    if let Some(query_text) = query_text {
        let terms = search_terms(query_text);
        let searchable = memory_embedding_text(record).to_lowercase();
        let matched = terms
            .iter()
            .filter(|term| searchable.contains(term.as_str()))
            .count();
        if !terms.is_empty() {
            score += (matched as f64 / terms.len() as f64).min(1.0) * 0.7;
        }
    }
    score.min(1.0)
}

pub(super) fn decay_metrics(
    record: &LongTermMemoryRecord,
    relation_degree: usize,
) -> (f64, f64, f64, f64) {
    let age_days = age_days(record.updated_at.as_str());
    let base_half_life = base_half_life_days(record);
    let access_multiplier = (1.0 + (record.access_count as f64 + 1.0).ln() / 3.0).min(4.0);
    let relation_multiplier = (1.0 + relation_degree as f64 * 0.08).min(2.0);
    let half_life_days = base_half_life * access_multiplier * relation_multiplier;
    let retention = (-age_days / half_life_days.max(1.0)).exp();
    let decay_penalty = if record.source_type == "user_declaration" && record.confidence >= 0.95 {
        (1.0 - retention) * 0.04
    } else {
        (1.0 - retention) * 0.22
    };
    (half_life_days, age_days, retention, decay_penalty)
}

pub(super) fn base_half_life_days(record: &LongTermMemoryRecord) -> f64 {
    let base: f64 = match record.source_type.as_str() {
        "agent_inference" => 14.0,
        "tool_observation" => 7.0,
        _ => match record.category.as_str() {
            "user_profile" => 365.0,
            "preference" => 180.0,
            "project" => 90.0,
            "instruction" => 180.0,
            "goal" => 30.0,
            _ => 30.0,
        },
    };
    base.max(1.0)
}

pub(super) fn access_frequency_boost(access_count: u64) -> f64 {
    ((access_count as f64 + 1.0).ln() / 4.0).min(1.0)
}

pub(super) fn age_days(value: &str) -> f64 {
    DateTime::parse_from_rfc3339(value)
        .map(|time| {
            let duration = Utc::now().signed_duration_since(time.with_timezone(&Utc));
            duration.num_seconds().max(0) as f64 / 86_400.0
        })
        .unwrap_or(0.0)
}

pub(super) fn is_expired(record: &LongTermMemoryRecord) -> bool {
    record
        .expires_at
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|time| time.with_timezone(&Utc) <= Utc::now())
        .unwrap_or(false)
}

pub(super) fn insert_memory_record(
    conn: &Connection,
    record: &LongTermMemoryRecord,
) -> AgentRuntimeResult<bool> {
    let changed = conn
        .execute(
            "INSERT OR IGNORE INTO memories (
                id, scope, category, fact, content_json, confidence, source_type, source_ref,
                status, priority, created_at, updated_at, last_accessed_at, access_count,
                expires_at, supersedes, superseded_by
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            params![
                record.id,
                record.scope,
                record.category,
                record.fact,
                serde_json::to_string(&record.content)
                    .map_err(|error| AgentRuntimeError::Serialization(error.to_string()))?,
                record.confidence,
                record.source_type,
                record.source_ref,
                record.status,
                record.priority,
                record.created_at,
                record.updated_at,
                record.last_accessed_at,
                record.access_count,
                record.expires_at,
                record.supersedes,
                record.superseded_by,
            ],
        )
        .map_err(sql_error)?;
    if changed > 0 {
        replace_memory_tags(conn, &record.id, &record.tags)?;
        replace_memory_relations(conn, &record.related_to)?;
        upsert_memory_fts(conn, record)?;
        if let Err(error) = try_upsert_memory_embedding(conn, record) {
            write_memory_event(
                conn,
                Some(&record.id),
                "embedding_failed",
                json!({ "message": error.to_string() }),
            )?;
        }
    }
    Ok(changed > 0)
}

pub(super) fn replace_memory_record(
    conn: &Connection,
    record: &LongTermMemoryRecord,
) -> AgentRuntimeResult<()> {
    conn.execute(
        "UPDATE memories SET
            scope = ?2,
            category = ?3,
            fact = ?4,
            content_json = ?5,
            confidence = ?6,
            source_type = ?7,
            source_ref = ?8,
            status = ?9,
            priority = ?10,
            updated_at = ?11,
            last_accessed_at = ?12,
            access_count = ?13,
            expires_at = ?14,
            supersedes = ?15,
            superseded_by = ?16
         WHERE id = ?1",
        params![
            record.id,
            record.scope,
            record.category,
            record.fact,
            serde_json::to_string(&record.content)
                .map_err(|error| AgentRuntimeError::Serialization(error.to_string()))?,
            record.confidence,
            record.source_type,
            record.source_ref,
            record.status,
            record.priority,
            record.updated_at,
            record.last_accessed_at,
            record.access_count,
            record.expires_at,
            record.supersedes,
            record.superseded_by,
        ],
    )
    .map_err(sql_error)?;
    replace_memory_tags(conn, &record.id, &record.tags)?;
    conn.execute(
        "DELETE FROM memory_relations WHERE source_id = ?1",
        params![record.id],
    )
    .map_err(sql_error)?;
    for relation in &record.related_to {
        upsert_memory_relation(conn, relation)?;
    }
    upsert_memory_fts(conn, record)?;
    if let Err(error) = try_upsert_memory_embedding(conn, record) {
        write_memory_event(
            conn,
            Some(&record.id),
            "embedding_failed",
            json!({ "message": error.to_string() }),
        )?;
    }
    Ok(())
}

pub(super) fn load_memory_record(
    conn: &Connection,
    id: &str,
) -> AgentRuntimeResult<Option<LongTermMemoryRecord>> {
    let row = conn
        .query_row(
            "SELECT id, scope, category, fact, content_json, confidence, source_type, source_ref,
                    status, priority, created_at, updated_at, last_accessed_at, access_count,
                    expires_at, supersedes, superseded_by
             FROM memories WHERE id = ?1",
            params![id],
            |row| {
                let content_json: String = row.get(4)?;
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    content_json,
                    row.get::<_, f64>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, String>(11)?,
                    row.get::<_, Option<String>>(12)?,
                    row.get::<_, u64>(13)?,
                    row.get::<_, Option<String>>(14)?,
                    row.get::<_, Option<String>>(15)?,
                    row.get::<_, Option<String>>(16)?,
                ))
            },
        )
        .optional()
        .map_err(sql_error)?;
    let Some((
        id,
        scope,
        category,
        fact,
        content_json,
        confidence,
        source_type,
        source_ref,
        status,
        priority,
        created_at,
        updated_at,
        last_accessed_at,
        access_count,
        expires_at,
        supersedes,
        superseded_by,
    )) = row
    else {
        return Ok(None);
    };
    let content = serde_json::from_str(&content_json).unwrap_or(Value::Null);
    let tags = load_memory_tags(conn, &id)?;
    let related_to = load_memory_relations(conn, &id)?;
    Ok(Some(LongTermMemoryRecord {
        id,
        scope,
        category,
        fact,
        content,
        confidence,
        source_type,
        source_ref,
        status,
        priority,
        created_at,
        updated_at,
        last_accessed_at,
        access_count,
        tags,
        related_to,
        expires_at,
        supersedes,
        superseded_by,
    }))
}

pub(super) fn insert_memory_candidate(
    conn: &Connection,
    candidate: &MemoryCandidate,
) -> AgentRuntimeResult<()> {
    conn.execute(
        "INSERT INTO memory_candidates (
            id, fact, content_json, category, scope, confidence, source_type, source_ref,
            proposed_action, conflict_with, target_id, relation_type, status, created_at,
            reviewed_at, expires_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![
            candidate.id,
            candidate.fact,
            serde_json::to_string(&candidate.content)
                .map_err(|error| AgentRuntimeError::Serialization(error.to_string()))?,
            candidate.category,
            candidate.scope,
            candidate.confidence,
            candidate.source_type,
            candidate.source_ref,
            candidate.proposed_action,
            candidate.conflict_with,
            candidate.target_id,
            candidate.relation_type,
            candidate.status,
            candidate.created_at,
            candidate.reviewed_at,
            candidate.expires_at,
        ],
    )
    .map_err(sql_error)?;
    Ok(())
}

pub(super) fn load_memory_candidate(
    conn: &Connection,
    id: &str,
) -> AgentRuntimeResult<Option<MemoryCandidate>> {
    conn.query_row(
        "SELECT id, fact, content_json, category, scope, confidence, source_type, source_ref,
                proposed_action, conflict_with, target_id, relation_type, status, created_at,
                reviewed_at, expires_at
         FROM memory_candidates WHERE id = ?1",
        params![id],
        |row| {
            let content_json: String = row.get(2)?;
            Ok(MemoryCandidate {
                id: row.get(0)?,
                fact: row.get(1)?,
                content: serde_json::from_str(&content_json).unwrap_or(Value::Null),
                category: row.get(3)?,
                scope: row.get(4)?,
                confidence: row.get(5)?,
                source_type: row.get(6)?,
                source_ref: row.get(7)?,
                proposed_action: row.get(8)?,
                conflict_with: row.get(9)?,
                target_id: row.get(10)?,
                relation_type: row.get(11)?,
                status: row.get(12)?,
                created_at: row.get(13)?,
                reviewed_at: row.get(14)?,
                expires_at: row.get(15)?,
            })
        },
    )
    .optional()
    .map_err(sql_error)
}

pub(super) fn mark_memory_candidate_status(
    conn: &Connection,
    id: &str,
    status: &str,
) -> AgentRuntimeResult<()> {
    conn.execute(
        "UPDATE memory_candidates SET status = ?2, reviewed_at = ?3 WHERE id = ?1",
        params![id, normalize_candidate_status(status), now()],
    )
    .map_err(sql_error)?;
    Ok(())
}

pub(super) fn expire_memory_candidates(conn: &Connection) -> AgentRuntimeResult<()> {
    conn.execute(
        "UPDATE memory_candidates
         SET status = 'expired', reviewed_at = ?1
         WHERE status IN ('pending', 'needs_user_confirmation')
           AND expires_at IS NOT NULL
           AND expires_at <= ?1",
        params![now()],
    )
    .map_err(sql_error)?;
    Ok(())
}

pub(super) fn apply_memory_candidate_action(
    root: &Path,
    candidate: &MemoryCandidate,
) -> AgentRuntimeResult<Value> {
    match candidate.proposed_action.as_str() {
        "create" => {
            let record = create_long_term_memory(root, candidate_to_memory_mutation(candidate))?;
            Ok(json!({ "action": "create", "record": memory_record_json(&record) }))
        }
        "update" => {
            let target_id = candidate_target_id(candidate)?;
            let mut mutation = candidate_to_memory_mutation(candidate);
            mutation.id = Some(target_id);
            let record = update_long_term_memory(root, mutation)?;
            Ok(json!({ "action": "update", "record": memory_record_json(&record) }))
        }
        "supersede" => {
            let target_id = candidate_target_id(candidate)?;
            let mut mutation = candidate_to_memory_mutation(candidate);
            mutation.supersedes = Some(target_id.clone());
            let record = create_long_term_memory(root, mutation)?;
            let old = update_long_term_memory(
                root,
                MemoryMutation {
                    id: Some(target_id.clone()),
                    status: Some("superseded".to_string()),
                    superseded_by: Some(record.id.clone()),
                    ..MemoryMutation::default()
                },
            )?;
            link_long_term_memory(
                root,
                &record.id,
                &old.id,
                "supersedes",
                candidate.confidence,
            )?;
            Ok(json!({
                "action": "supersede",
                "record": memory_record_json(&record),
                "superseded": memory_summary_json(&old)
            }))
        }
        "forget" => {
            let target_id = candidate_target_id(candidate)?;
            let result =
                forget_long_term_memory(root, &target_id, "archive", Some("memory candidate"))?;
            Ok(json!({ "action": "forget", "result": result }))
        }
        "link" => {
            let target_id = candidate_target_id(candidate)?;
            let source_id = candidate
                .conflict_with
                .clone()
                .or_else(|| candidate.source_ref.clone())
                .ok_or_else(|| {
                    AgentRuntimeError::Core("memory link candidate source is required".to_string())
                })?;
            let relation = link_long_term_memory(
                root,
                &source_id,
                &target_id,
                candidate.relation_type.as_deref().unwrap_or("related_to"),
                candidate.confidence,
            )?;
            Ok(json!({ "action": "link", "relation": relation }))
        }
        action => Err(AgentRuntimeError::Core(format!(
            "unsupported memory candidate action: {action}"
        ))),
    }
}

pub(super) fn candidate_target_id(candidate: &MemoryCandidate) -> AgentRuntimeResult<String> {
    candidate
        .target_id
        .clone()
        .or_else(|| candidate.conflict_with.clone())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AgentRuntimeError::Core("memory candidate target is required".to_string()))
}

pub(super) fn candidate_to_memory_mutation(candidate: &MemoryCandidate) -> MemoryMutation {
    MemoryMutation {
        scope: Some(candidate.scope.clone()),
        category: Some(candidate.category.clone()),
        fact: Some(candidate.fact.clone()),
        content: Some(candidate.content.clone()),
        confidence: Some(candidate.confidence),
        source_type: Some(candidate.source_type.clone()),
        source_ref: candidate.source_ref.clone(),
        status: Some("active".to_string()),
        tags: Some(vec!["auto_extracted".to_string()]),
        ..MemoryMutation::default()
    }
}

pub(crate) fn memory_candidate_json(candidate: &MemoryCandidate) -> Value {
    json!({
        "id": candidate.id,
        "fact": candidate.fact,
        "content": candidate.content,
        "category": candidate.category,
        "scope": candidate.scope,
        "confidence": candidate.confidence,
        "sourceType": candidate.source_type,
        "sourceRef": candidate.source_ref,
        "proposedAction": candidate.proposed_action,
        "conflictWith": candidate.conflict_with,
        "targetId": candidate.target_id,
        "relationType": candidate.relation_type,
        "status": candidate.status,
        "createdAt": candidate.created_at,
        "reviewedAt": candidate.reviewed_at,
        "expiresAt": candidate.expires_at,
    })
}

pub(super) fn insert_proactive_event(
    conn: &Connection,
    event: &ProactiveEvent,
) -> AgentRuntimeResult<()> {
    conn.execute(
        "INSERT INTO proactive_events (
            id, trigger_type, title, reason, source_json, mode, status, session_id,
            created_at, dismissed_at, opened_session_id
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            event.id,
            event.trigger_type,
            event.title,
            event.reason,
            serde_json::to_string(&event.source)
                .map_err(|error| AgentRuntimeError::Serialization(error.to_string()))?,
            event.mode,
            event.status,
            event.session_id,
            event.created_at,
            event.dismissed_at,
            event.opened_session_id,
        ],
    )
    .map_err(sql_error)?;
    Ok(())
}

pub(super) fn load_proactive_event(
    conn: &Connection,
    id: &str,
) -> AgentRuntimeResult<Option<ProactiveEvent>> {
    conn.query_row(
        "SELECT id, trigger_type, title, reason, source_json, mode, status, session_id,
                created_at, dismissed_at, opened_session_id
         FROM proactive_events WHERE id = ?1",
        params![id],
        |row| {
            let source_json: String = row.get(4)?;
            Ok(ProactiveEvent {
                id: row.get(0)?,
                trigger_type: row.get(1)?,
                title: row.get(2)?,
                reason: row.get(3)?,
                source: serde_json::from_str(&source_json).unwrap_or(Value::Null),
                mode: row.get(5)?,
                status: row.get(6)?,
                session_id: row.get(7)?,
                created_at: row.get(8)?,
                dismissed_at: row.get(9)?,
                opened_session_id: row.get(10)?,
            })
        },
    )
    .optional()
    .map_err(sql_error)
}

pub(crate) fn proactive_event_json(event: &ProactiveEvent) -> Value {
    json!({
        "id": event.id,
        "triggerType": event.trigger_type,
        "title": event.title,
        "reason": event.reason,
        "source": event.source,
        "mode": event.mode,
        "status": event.status,
        "sessionId": event.session_id,
        "createdAt": event.created_at,
        "dismissedAt": event.dismissed_at,
        "openedSessionId": event.opened_session_id,
        "role": "proactive",
    })
}

pub(super) fn replace_memory_tags(
    conn: &Connection,
    memory_id: &str,
    tags: &[String],
) -> AgentRuntimeResult<()> {
    conn.execute(
        "DELETE FROM memory_tags WHERE memory_id = ?1",
        params![memory_id],
    )
    .map_err(sql_error)?;
    for tag in tags
        .iter()
        .map(|tag| tag.trim())
        .filter(|tag| !tag.is_empty())
    {
        conn.execute(
            "INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?1, ?2)",
            params![memory_id, tag],
        )
        .map_err(sql_error)?;
    }
    Ok(())
}

pub(super) fn replace_memory_relations(
    conn: &Connection,
    relations: &[MemoryRelation],
) -> AgentRuntimeResult<()> {
    if let Some(source_id) = relations
        .first()
        .map(|relation| relation.source_id.as_str())
    {
        conn.execute(
            "DELETE FROM memory_relations WHERE source_id = ?1",
            params![source_id],
        )
        .map_err(sql_error)?;
    }
    for relation in relations {
        upsert_memory_relation(conn, relation)?;
    }
    Ok(())
}

pub(super) fn upsert_memory_relation(
    conn: &Connection,
    relation: &MemoryRelation,
) -> AgentRuntimeResult<()> {
    conn.execute(
        "INSERT INTO memory_relations (source_id, target_id, relation, confidence, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(source_id, target_id, relation) DO UPDATE SET
           confidence = excluded.confidence",
        params![
            relation.source_id,
            relation.target_id,
            relation.relation,
            relation.confidence,
            relation.created_at,
        ],
    )
    .map_err(sql_error)?;
    Ok(())
}

pub(super) fn load_memory_tags(
    conn: &Connection,
    memory_id: &str,
) -> AgentRuntimeResult<Vec<String>> {
    let mut statement = conn
        .prepare("SELECT tag FROM memory_tags WHERE memory_id = ?1 ORDER BY tag")
        .map_err(sql_error)?;
    statement
        .query_map(params![memory_id], |row| row.get::<_, String>(0))
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)
}

pub(super) fn load_memory_relations(
    conn: &Connection,
    memory_id: &str,
) -> AgentRuntimeResult<Vec<MemoryRelation>> {
    let mut statement = conn
        .prepare(
            "SELECT source_id, target_id, relation, confidence, created_at
             FROM memory_relations WHERE source_id = ?1
             ORDER BY created_at DESC",
        )
        .map_err(sql_error)?;
    statement
        .query_map(params![memory_id], |row| {
            Ok(MemoryRelation {
                source_id: row.get(0)?,
                target_id: row.get(1)?,
                relation: row.get(2)?,
                confidence: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)
}

pub(super) fn upsert_memory_fts(
    conn: &Connection,
    record: &LongTermMemoryRecord,
) -> AgentRuntimeResult<()> {
    conn.execute(
        "DELETE FROM memory_fts WHERE memory_id = ?1",
        params![record.id],
    )
    .map_err(sql_error)?;
    if record.status != "active" || is_expired(record) {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO memory_fts (memory_id, fact, content, tags, category, scope)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            record.id,
            record.fact,
            serde_json::to_string(&record.content)
                .map_err(|error| AgentRuntimeError::Serialization(error.to_string()))?,
            record.tags.join(" "),
            record.category,
            record.scope,
        ],
    )
    .map_err(sql_error)?;
    Ok(())
}

pub(super) fn delete_memory_indexes(conn: &Connection, memory_id: &str) -> AgentRuntimeResult<()> {
    conn.execute(
        "DELETE FROM memory_fts WHERE memory_id = ?1",
        params![memory_id],
    )
    .map_err(sql_error)?;
    conn.execute(
        "DELETE FROM memory_embeddings WHERE memory_id = ?1",
        params![memory_id],
    )
    .map_err(sql_error)?;
    Ok(())
}

pub(super) fn try_upsert_memory_embedding(
    conn: &Connection,
    record: &LongTermMemoryRecord,
) -> AgentRuntimeResult<Option<()>> {
    let Some(provider) = embedding_provider() else {
        return Ok(None);
    };
    if record.status != "active" || is_expired(record) {
        conn.execute(
            "DELETE FROM memory_embeddings WHERE memory_id = ?1",
            params![record.id],
        )
        .map_err(sql_error)?;
        return Ok(None);
    }
    let text = memory_embedding_text(record);
    let content_hash = stable_hash(&text);
    let existing_hash = conn
        .query_row(
            "SELECT content_hash FROM memory_embeddings WHERE memory_id = ?1",
            params![record.id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(sql_error)?;
    if existing_hash.as_deref() == Some(content_hash.as_str()) {
        return Ok(Some(()));
    }
    let vector = provider.embed(&text)?;
    let timestamp = now();
    conn.execute(
        "INSERT INTO memory_embeddings
          (memory_id, provider, model, dimension, vector, content_hash, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(memory_id) DO UPDATE SET
           provider = excluded.provider,
           model = excluded.model,
           dimension = excluded.dimension,
           vector = excluded.vector,
           content_hash = excluded.content_hash,
           updated_at = excluded.updated_at",
        params![
            record.id,
            provider.provider(),
            provider.model(),
            provider.dimension() as i64,
            vector_to_blob(&vector),
            content_hash,
            timestamp,
        ],
    )
    .map_err(sql_error)?;
    Ok(Some(()))
}

pub(super) fn load_embedding_map(
    conn: &Connection,
) -> AgentRuntimeResult<HashMap<String, Vec<f32>>> {
    let mut statement = conn
        .prepare("SELECT memory_id, vector FROM memory_embeddings")
        .map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let blob: Vec<u8> = row.get(1)?;
            Ok((id, blob_to_vector(&blob)))
        })
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    Ok(rows.into_iter().collect())
}

pub(super) fn load_memory_embedding(
    conn: &Connection,
    memory_id: &str,
) -> AgentRuntimeResult<Option<Vec<f32>>> {
    conn.query_row(
        "SELECT vector FROM memory_embeddings WHERE memory_id = ?1",
        params![memory_id],
        |row| row.get::<_, Vec<u8>>(0),
    )
    .optional()
    .map(|blob| blob.map(|value| blob_to_vector(&value)))
    .map_err(sql_error)
}

pub(super) fn query_embedding(query: &str) -> Option<Vec<f32>> {
    let provider = embedding_provider()?;
    let key = format!(
        "{}:{}:{}",
        provider.provider(),
        provider.model(),
        stable_hash(query)
    );
    let cache = QUERY_EMBEDDING_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(cache) = cache.lock()
        && let Some(vector) = cache.get(&key)
    {
        return Some(vector.clone());
    }
    let vector = provider.embed(query).ok()?;
    if let Ok(mut cache) = cache.lock() {
        if cache.len() >= 64
            && let Some(first_key) = cache.keys().next().cloned()
        {
            cache.remove(&first_key);
        }
        cache.insert(key, vector.clone());
    }
    Some(vector)
}

pub(super) fn embedding_provider() -> Option<LocalHashEmbeddingProvider> {
    env::var_os("LYRA_MEMORY_DISABLE_EMBEDDINGS")
        .is_none()
        .then_some(LocalHashEmbeddingProvider)
}

pub(super) fn memory_embedding_text(record: &LongTermMemoryRecord) -> String {
    format!(
        "scope: {}\ncategory: {}\nfact: {}\ncontent: {}\ntags: {}",
        record.scope,
        record.category,
        record.fact,
        serde_json::to_string(&record.content).unwrap_or_default(),
        record.tags.join(" ")
    )
}

pub(super) fn local_hash_embedding(text: &str, dimension: usize) -> Vec<f32> {
    let mut vector = vec![0.0_f32; dimension];
    for term in search_terms(text) {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        term.hash(&mut hasher);
        let hash = hasher.finish();
        let index = (hash as usize) % dimension;
        let sign = if hash & 1 == 0 { 1.0 } else { -1.0 };
        vector[index] += sign;
    }
    normalize_vector(&mut vector);
    vector
}

pub(super) fn vector_to_blob(vector: &[f32]) -> Vec<u8> {
    let mut output = Vec::with_capacity(vector.len() * 4);
    for value in vector {
        output.extend_from_slice(&value.to_le_bytes());
    }
    output
}

pub(super) fn blob_to_vector(blob: &[u8]) -> Vec<f32> {
    blob.chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

pub(super) fn normalize_vector(vector: &mut [f32]) {
    let norm = vector
        .iter()
        .map(|value| (*value as f64) * (*value as f64))
        .sum::<f64>()
        .sqrt();
    if norm <= f64::EPSILON {
        return;
    }
    for value in vector {
        *value = (*value as f64 / norm) as f32;
    }
}

pub(super) fn cosine(left: &[f32], right: &[f32]) -> f64 {
    if left.is_empty() || right.is_empty() || left.len() != right.len() {
        return 0.0;
    }
    left.iter()
        .zip(right.iter())
        .map(|(left, right)| (*left as f64) * (*right as f64))
        .sum::<f64>()
        .max(0.0)
        .min(1.0)
}

pub(super) fn search_terms(text: &str) -> Vec<String> {
    let lower = text.to_lowercase();
    let mut terms = lower
        .split(|character: char| !character.is_alphanumeric())
        .map(str::trim)
        .filter(|term| term.chars().count() >= 2)
        .map(str::to_string)
        .collect::<Vec<_>>();
    if terms.is_empty() && lower.chars().count() >= 2 {
        terms.push(lower);
    }
    terms.sort();
    terms.dedup();
    terms
}

pub(super) fn stable_hash(text: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

pub(super) fn relation_degree_map(conn: &Connection) -> AgentRuntimeResult<HashMap<String, usize>> {
    let mut degree = HashMap::<String, usize>::new();
    let mut statement = conn
        .prepare("SELECT source_id, target_id FROM memory_relations")
        .map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    for (source, target) in rows {
        *degree.entry(source).or_default() += 1;
        *degree.entry(target).or_default() += 1;
    }
    Ok(degree)
}

pub(super) fn memory_relation_summary(conn: &Connection) -> AgentRuntimeResult<Value> {
    let mut statement = conn
        .prepare(
            "SELECT relation, COUNT(*) FROM memory_relations GROUP BY relation ORDER BY relation",
        )
        .map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    let mut by_type = Map::new();
    let mut total = 0_i64;
    for (relation, count) in rows {
        total += count;
        by_type.insert(relation, json!(count));
    }
    Ok(json!({
        "total": total,
        "byType": by_type,
        "defaultDepth": 1,
    }))
}

pub(super) fn contradiction_id_set(conn: &Connection) -> AgentRuntimeResult<HashSet<String>> {
    let mut ids = HashSet::new();
    let mut statement = conn
        .prepare("SELECT source_id, target_id FROM memory_relations WHERE relation = 'contradicts'")
        .map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    for (source, target) in rows {
        ids.insert(source);
        ids.insert(target);
    }
    Ok(ids)
}

pub(super) fn graph_expansion_boosts(
    conn: &Connection,
    seed_ids: &[String],
) -> AgentRuntimeResult<HashMap<String, f64>> {
    if seed_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let seed_set = seed_ids.iter().cloned().collect::<HashSet<_>>();
    let mut boosts = HashMap::new();
    let mut statement = conn
        .prepare(
            "SELECT source_id, target_id, relation, confidence
             FROM memory_relations
             WHERE confidence >= 0.5",
        )
        .map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, f64>(3)?,
            ))
        })
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    for (source, target, relation, confidence) in rows {
        if relation == "contradicts" {
            continue;
        }
        if seed_set.contains(&source) && !seed_set.contains(&target) {
            *boosts.entry(target.clone()).or_insert(0.0_f64) += confidence * 0.75;
        }
        if seed_set.contains(&target) && !seed_set.contains(&source) {
            *boosts.entry(source).or_insert(0.0_f64) += confidence * 0.55;
        }
    }
    Ok(boosts)
}

pub(super) fn touch_memory_access_scores<'a>(
    conn: &Connection,
    ids: impl Iterator<Item = (&'a str, f64)>,
    access_type: &str,
    query: Option<&str>,
) -> AgentRuntimeResult<()> {
    let timestamp = now();
    for (id, score) in ids {
        conn.execute(
            "UPDATE memories
             SET access_count = access_count + 1, last_accessed_at = ?2
             WHERE id = ?1",
            params![id, timestamp],
        )
        .map_err(sql_error)?;
        conn.execute(
            "INSERT INTO memory_access_events (id, memory_id, access_type, query, score, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                format!("memory-access-{}", Uuid::new_v4()),
                id,
                access_type,
                query,
                score,
                timestamp,
            ],
        )
        .map_err(sql_error)?;
        write_memory_event(
            conn,
            Some(id),
            "accessed",
            json!({
                "accessType": access_type,
                "query": query,
                "score": score,
            }),
        )?;
    }
    Ok(())
}

pub(super) fn cleanup_candidate_json(record: &LongTermMemoryRecord) -> Option<Value> {
    let relation_degree = record.related_to.len();
    let (half_life_days, age_days, retention, decay_penalty) =
        decay_metrics(record, relation_degree);
    let expired = is_expired(record);
    let stale = retention < 0.35 && record.access_count <= 2;
    let low_confidence = record.confidence < 0.7;
    let superseded = record.status == "superseded";
    if !(expired || stale || low_confidence || superseded) {
        return None;
    }
    let mut reasons = Vec::new();
    if expired {
        reasons.push("expired");
    }
    if stale {
        reasons.push("stale");
    }
    if low_confidence {
        reasons.push("low_confidence");
    }
    if superseded {
        reasons.push("superseded");
    }
    let severity = (if expired { 1.0 } else { 0.0 })
        + (if superseded { 0.9 } else { 0.0 })
        + (if low_confidence { 0.55 } else { 0.0 })
        + decay_penalty;
    Some(json!({
        "record": memory_summary_json(record),
        "reasons": reasons,
        "severity": severity,
        "retention": retention,
        "halfLifeDays": half_life_days,
        "ageDays": age_days,
        "recommendedAction": if superseded || expired { "archive" } else { "review" },
    }))
}

pub(super) fn effective_limit(limit: usize) -> usize {
    if limit == 0 {
        DEFAULT_MEMORY_LIMIT
    } else {
        limit
    }
    .min(MAX_MEMORY_LIMIT)
}

pub(super) fn write_memory_event(
    conn: &Connection,
    memory_id: Option<&str>,
    event_type: &str,
    payload: Value,
) -> AgentRuntimeResult<()> {
    conn.execute(
        "INSERT INTO memory_events (id, memory_id, event_type, payload_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            format!("memory-event-{}", Uuid::new_v4()),
            memory_id,
            event_type,
            serde_json::to_string(&payload)
                .map_err(|error| AgentRuntimeError::Serialization(error.to_string()))?,
            now(),
        ],
    )
    .map_err(sql_error)?;
    Ok(())
}

pub(super) fn legacy_shared_record_to_long_term(
    record: &SharedMemoryRecord,
) -> LongTermMemoryRecord {
    let category = record
        .category
        .clone()
        .or_else(|| {
            record
                .content
                .get("category")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| "other".to_string());
    let fact = record
        .content
        .get("fact")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            record
                .content
                .get("title")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| serde_json::to_string(&record.content).unwrap_or_default());
    LongTermMemoryRecord {
        id: if record.id.trim().is_empty() {
            format!("memory-{}", Uuid::new_v4())
        } else {
            record.id.clone()
        },
        scope: normalize_scope(&record.scope),
        category: normalize_category(&category),
        fact,
        content: record.content.clone(),
        confidence: record.confidence.unwrap_or(0.8).clamp(0.0, 1.0),
        source_type: legacy_source_to_source_type(record.source.as_deref()),
        source_ref: record.source.clone(),
        status: normalize_status(&record.status),
        priority: record.priority,
        created_at: record.created_at.clone(),
        updated_at: record.updated_at.clone(),
        last_accessed_at: record.last_injected_at.clone(),
        access_count: record.injection_count,
        tags: Vec::new(),
        related_to: Vec::new(),
        expires_at: None,
        supersedes: None,
        superseded_by: None,
    }
}

pub(super) fn mutation_to_new_memory(mutation: MemoryMutation) -> LongTermMemoryRecord {
    let timestamp = now();
    let scope = mutation
        .scope
        .as_deref()
        .map(normalize_scope)
        .unwrap_or_else(|| "global".to_string());
    let category = mutation
        .category
        .as_deref()
        .map(normalize_category)
        .unwrap_or_else(|| "other".to_string());
    let source_type = mutation
        .source_type
        .as_deref()
        .map(normalize_source_type)
        .unwrap_or_else(|| "agent_inference".to_string());
    let confidence = mutation
        .confidence
        .unwrap_or_else(|| default_confidence(&source_type))
        .clamp(0.0, 1.0);
    let fact = mutation
        .fact
        .clone()
        .unwrap_or_else(|| {
            mutation
                .content
                .as_ref()
                .and_then(|content| content.get("fact").and_then(Value::as_str))
                .unwrap_or_default()
                .to_string()
        })
        .trim()
        .to_string();
    let content = mutation.content.unwrap_or_else(|| {
        json!({
            "fact": fact,
            "category": category,
            "sourceType": source_type,
        })
    });
    let id = mutation
        .id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("memory-{}", Uuid::new_v4()));
    let mut related_to = mutation.related_to.unwrap_or_default();
    for relation in &mut related_to {
        if relation.source_id.trim().is_empty() {
            relation.source_id = id.clone();
        }
    }
    LongTermMemoryRecord {
        id,
        scope: scope.clone(),
        category: category.clone(),
        fact,
        content,
        confidence,
        source_type: source_type.clone(),
        source_ref: mutation.source_ref,
        status: mutation
            .status
            .as_deref()
            .map(normalize_status)
            .unwrap_or_else(|| "active".to_string()),
        priority: mutation
            .priority
            .unwrap_or_else(|| memory_priority_for_record(&scope, &category)),
        created_at: timestamp.clone(),
        updated_at: timestamp,
        last_accessed_at: None,
        access_count: 0,
        tags: mutation.tags.unwrap_or_default(),
        related_to,
        expires_at: mutation.expires_at,
        supersedes: mutation.supersedes,
        superseded_by: mutation.superseded_by,
    }
}

pub(super) fn mutation_to_memory_candidate(mutation: MemoryCandidateMutation) -> MemoryCandidate {
    let timestamp = now();
    let fact = mutation.fact.trim().to_string();
    let default_expires_at = if mutation.expires_at.is_none() {
        let days = if mutation.source_type == "agent_inference" || mutation.confidence < 0.7 {
            30
        } else {
            180
        };
        Some((Utc::now() + chrono::Duration::days(days)).to_rfc3339_opts(SecondsFormat::Secs, true))
    } else {
        mutation.expires_at.clone()
    };
    MemoryCandidate {
        id: format!("memory-candidate-{}", Uuid::new_v4()),
        fact: fact.clone(),
        content: if mutation.content.is_null() {
            json!({ "fact": fact })
        } else {
            mutation.content
        },
        category: normalize_category(&mutation.category),
        scope: normalize_scope(&mutation.scope),
        confidence: mutation.confidence.clamp(0.0, 1.0),
        source_type: normalize_source_type(&mutation.source_type),
        source_ref: mutation.source_ref,
        proposed_action: normalize_candidate_action(&mutation.proposed_action),
        conflict_with: mutation.conflict_with,
        target_id: mutation.target_id,
        relation_type: mutation
            .relation_type
            .map(|value| normalize_relation(&value)),
        status: mutation
            .status
            .as_deref()
            .map(normalize_candidate_status)
            .unwrap_or_else(|| "pending".to_string()),
        created_at: timestamp,
        reviewed_at: None,
        expires_at: default_expires_at,
    }
}

pub(super) fn apply_memory_mutation(record: &mut LongTermMemoryRecord, mutation: MemoryMutation) {
    if let Some(scope) = mutation.scope.as_deref() {
        record.scope = normalize_scope(scope);
    }
    if let Some(category) = mutation.category.as_deref() {
        record.category = normalize_category(category);
    }
    if let Some(fact) = mutation.fact {
        record.fact = fact;
    }
    if let Some(content) = mutation.content {
        record.content = content;
    }
    if let Some(confidence) = mutation.confidence {
        record.confidence = confidence.clamp(0.0, 1.0);
    }
    if let Some(source_type) = mutation.source_type.as_deref() {
        record.source_type = normalize_source_type(source_type);
    }
    if mutation.source_ref.is_some() {
        record.source_ref = mutation.source_ref;
    }
    if let Some(status) = mutation.status.as_deref() {
        record.status = normalize_status(status);
    }
    if let Some(priority) = mutation.priority {
        record.priority = priority;
    } else {
        record.priority = memory_priority_for_record(&record.scope, &record.category);
    }
    if let Some(tags) = mutation.tags {
        record.tags = tags;
    }
    if let Some(related_to) = mutation.related_to {
        record.related_to = related_to
            .into_iter()
            .map(|mut relation| {
                if relation.source_id.trim().is_empty() {
                    relation.source_id = record.id.clone();
                }
                relation
            })
            .collect();
    }
    if mutation.expires_at.is_some() {
        record.expires_at = mutation.expires_at;
    }
    if mutation.supersedes.is_some() {
        record.supersedes = mutation.supersedes;
    }
    if mutation.superseded_by.is_some() {
        record.superseded_by = mutation.superseded_by;
    }
}

pub(super) fn count_memory_status(conn: &Connection, status: &str) -> AgentRuntimeResult<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM memories WHERE status = ?1",
        params![status],
        |row| row.get(0),
    )
    .map_err(sql_error)
}

pub(super) fn normalize_scope(value: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        "global".to_string()
    } else {
        value.to_string()
    }
}

pub(super) fn normalize_category(value: &str) -> String {
    match value.trim() {
        "user_profile" | "preference" | "project" | "instruction" | "goal" | "other" => {
            value.trim().to_string()
        }
        _ => "other".to_string(),
    }
}

pub(super) fn normalize_source_type(value: &str) -> String {
    match value.trim() {
        "user_declaration" | "agent_inference" | "tool_observation" | "project_fact"
        | "goal_sync" | "imported" => value.trim().to_string(),
        _ => "agent_inference".to_string(),
    }
}

pub(super) fn legacy_source_to_source_type(value: Option<&str>) -> String {
    match value {
        Some("goal_state") => "goal_sync".to_string(),
        Some("user_declaration") => "user_declaration".to_string(),
        Some("project_fact") => "project_fact".to_string(),
        Some("tool_observation") => "tool_observation".to_string(),
        Some("imported") => "imported".to_string(),
        _ => "agent_inference".to_string(),
    }
}

pub(super) fn normalize_status(value: &str) -> String {
    match value.trim() {
        "active" | "archived" | "superseded" | "forgotten" => value.trim().to_string(),
        _ => "active".to_string(),
    }
}

pub(super) fn normalize_candidate_status(value: &str) -> String {
    match value.trim() {
        "pending"
        | "auto_applied"
        | "needs_user_confirmation"
        | "approved"
        | "rejected"
        | "expired" => value.trim().to_string(),
        _ => "pending".to_string(),
    }
}

pub(super) fn normalize_candidate_action(value: &str) -> String {
    match value.trim() {
        "create" | "update" | "supersede" | "forget" | "link" => value.trim().to_string(),
        _ => "create".to_string(),
    }
}

pub(super) fn normalize_proactive_status(value: &str) -> String {
    match value.trim() {
        "pending" | "dismissed" | "opened" | "expired" => value.trim().to_string(),
        _ => "pending".to_string(),
    }
}

pub(super) fn normalize_proactive_mode(value: &str) -> String {
    match value.trim() {
        "notification_only" | "draft_message" | "open_session" | "continue_existing_session" => {
            value.trim().to_string()
        }
        _ => "notification_only".to_string(),
    }
}

pub(super) fn normalize_relation(value: &str) -> String {
    match value.trim() {
        "related_to"
        | "supports"
        | "contradicts"
        | "supersedes"
        | "belongs_to_project"
        | "same_user_preference"
        | "derived_from" => value.trim().to_string(),
        _ => "related_to".to_string(),
    }
}

pub(super) fn default_confidence(source_type: &str) -> f64 {
    match source_type {
        "user_declaration" => 1.0,
        "project_fact" => 0.9,
        "tool_observation" => 0.85,
        "goal_sync" => 1.0,
        "imported" => 0.75,
        _ => 0.65,
    }
}

pub(super) fn memory_priority_for_record(scope: &str, category: &str) -> i64 {
    match category {
        "instruction" => 100,
        "preference" => 88,
        "user_profile" => 82,
        "project" => 76,
        "goal" => 90,
        _ if scope == "project" => 70,
        _ if scope == "global" => 48,
        _ => 40,
    }
}

pub(super) fn sql_error(error: rusqlite::Error) -> AgentRuntimeError {
    AgentRuntimeError::Core(format!("memory sqlite failed: {error}"))
}
