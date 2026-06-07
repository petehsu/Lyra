use super::*;
use rusqlite::{Connection, OptionalExtension, params};
use std::{
    collections::{HashMap, HashSet},
    hash::{Hash, Hasher},
};

const MEMORY_SCHEMA_VERSION: i64 = 3;
const DEFAULT_MEMORY_LIMIT: usize = 24;
const MAX_MEMORY_LIMIT: usize = 500;
const EMBEDDING_PROVIDER: &str = "lyra-local";
const EMBEDDING_MODEL: &str = "lyra-hash-embedding-v1";
const EMBEDDING_DIMENSION: usize = 64;
const CLEANUP_DEFAULT_LIMIT: usize = 50;
const SYSTEM_RECALL_LIMIT: usize = 5;
const SYSTEM_RECALL_CANDIDATE_LIMIT: usize = 80;
const SYSTEM_RECALL_TOTAL_CHAR_BUDGET: usize = 4_000;
const SYSTEM_RECALL_ITEM_CHAR_BUDGET: usize = 720;
const SYSTEM_RECALL_DEADLINE_MS: u64 = 200;
static QUERY_EMBEDDING_CACHE: OnceLock<Mutex<HashMap<String, Vec<f32>>>> = OnceLock::new();

mod internal;
use internal::*;
pub(crate) use internal::{memory_candidate_json, proactive_event_json};

trait EmbeddingProvider {
    fn provider(&self) -> &'static str;
    fn model(&self) -> &'static str;
    fn dimension(&self) -> usize;
    fn embed(&self, text: &str) -> AgentRuntimeResult<Vec<f32>>;
}

struct LocalHashEmbeddingProvider;

impl EmbeddingProvider for LocalHashEmbeddingProvider {
    fn provider(&self) -> &'static str {
        EMBEDDING_PROVIDER
    }

    fn model(&self) -> &'static str {
        EMBEDDING_MODEL
    }

    fn dimension(&self) -> usize {
        EMBEDDING_DIMENSION
    }

    fn embed(&self, text: &str) -> AgentRuntimeResult<Vec<f32>> {
        Ok(local_hash_embedding(text, self.dimension()))
    }
}

pub(crate) fn memory_store_path(root: &Path) -> PathBuf {
    root.join("memory.sqlite")
}

pub(crate) fn ensure_memory_store(root: &Path) -> AgentRuntimeResult<()> {
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)
}

pub(crate) fn migrate_legacy_shared_memory(
    root: &Path,
    records: &[SharedMemoryRecord],
) -> AgentRuntimeResult<Value> {
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;
    let batch_id = format!("legacy-shared-memory-{}", Uuid::new_v4());
    let mut inserted = 0_usize;
    for record in records {
        let converted = legacy_shared_record_to_long_term(record);
        if insert_memory_record(&conn, &converted)? {
            inserted += 1;
            write_memory_event(
                &conn,
                Some(&converted.id),
                "migrated",
                json!({
                    "batchId": batch_id,
                    "from": "state.sharedMemory",
                    "recordId": converted.id,
                }),
            )?;
        }
    }
    if !records.is_empty() {
        write_memory_event(
            &conn,
            None,
            "migration_batch",
            json!({
                "batchId": batch_id,
                "from": "state.sharedMemory",
                "inputCount": records.len(),
                "inserted": inserted,
            }),
        )?;
    }
    Ok(json!({
        "batchId": batch_id,
        "inputCount": records.len(),
        "inserted": inserted,
    }))
}

pub(crate) fn create_long_term_memory(
    root: &Path,
    mutation: MemoryMutation,
) -> AgentRuntimeResult<LongTermMemoryRecord> {
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;
    let record = mutation_to_new_memory(mutation);
    insert_memory_record(&conn, &record)?;
    write_memory_event(
        &conn,
        Some(&record.id),
        "created",
        json!({
            "record": memory_summary_json(&record),
        }),
    )?;
    Ok(record)
}

pub(crate) fn search_long_term_memory(
    root: &Path,
    query: MemoryQuery,
) -> AgentRuntimeResult<Vec<LongTermMemoryRecord>> {
    Ok(search_ranked_long_term_memory(root, query)?
        .into_iter()
        .map(|ranked| ranked.record)
        .collect())
}

pub(crate) fn search_ranked_long_term_memory(
    root: &Path,
    query: MemoryQuery,
) -> AgentRuntimeResult<Vec<RankedMemoryRecord>> {
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;
    let mut ranked = rank_memory_records(&conn, &query)?;
    if let Some(min_score) = query.min_score {
        ranked.retain(|entry| entry.score >= min_score);
    }
    let limit = effective_limit(query.limit);
    ranked = ranked.into_iter().skip(query.offset).take(limit).collect();
    if query.touch_access {
        touch_memory_access_scores(
            &conn,
            ranked
                .iter()
                .map(|entry| (entry.record.id.as_str(), entry.score)),
            &query.access_type,
            query.query.as_deref(),
        )?;
        let timestamp = now();
        for entry in &mut ranked {
            entry.record.access_count = entry.record.access_count.saturating_add(1);
            entry.record.last_accessed_at = Some(timestamp.clone());
        }
    }
    Ok(ranked)
}

pub(crate) fn list_long_term_memory(
    root: &Path,
    query: MemoryQuery,
) -> AgentRuntimeResult<Vec<LongTermMemoryRecord>> {
    let mut query = query;
    query.touch_access = false;
    search_long_term_memory(root, query)
}

pub(crate) fn update_long_term_memory(
    root: &Path,
    mutation: MemoryMutation,
) -> AgentRuntimeResult<LongTermMemoryRecord> {
    let id = mutation
        .id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AgentRuntimeError::Core("memory id is required".to_string()))?
        .to_string();
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;
    let mut record = load_memory_record(&conn, &id)?
        .ok_or_else(|| AgentRuntimeError::Core(format!("memory not found: {id}")))?;
    apply_memory_mutation(&mut record, mutation);
    record.updated_at = now();
    replace_memory_record(&conn, &record)?;
    write_memory_event(
        &conn,
        Some(&record.id),
        "updated",
        json!({ "record": memory_summary_json(&record) }),
    )?;
    Ok(record)
}

pub(crate) fn forget_long_term_memory(
    root: &Path,
    id: &str,
    mode: &str,
    reason: Option<&str>,
) -> AgentRuntimeResult<Value> {
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;
    let record = load_memory_record(&conn, id)?
        .ok_or_else(|| AgentRuntimeError::Core(format!("memory not found: {id}")))?;
    let normalized_mode = match mode {
        "hard_delete" => "hard_delete",
        "tombstone" => "tombstone",
        _ => "archive",
    };
    match normalized_mode {
        "hard_delete" => {
            conn.execute("DELETE FROM memory_tags WHERE memory_id = ?1", params![id])
                .map_err(sql_error)?;
            conn.execute(
                "DELETE FROM memory_relations WHERE source_id = ?1 OR target_id = ?1",
                params![id],
            )
            .map_err(sql_error)?;
            delete_memory_indexes(&conn, id)?;
            conn.execute("DELETE FROM memories WHERE id = ?1", params![id])
                .map_err(sql_error)?;
            write_memory_event(
                &conn,
                Some(id),
                "hard_deleted",
                json!({
                    "id": id,
                    "reason": reason,
                    "redacted": true,
                }),
            )?;
        }
        "tombstone" => {
            let mut tombstone = record.clone();
            tombstone.status = "forgotten".to_string();
            tombstone.fact = "[forgotten]".to_string();
            tombstone.content = json!({
                "retention": "forgotten",
                "reason": reason,
            });
            tombstone.tags.clear();
            tombstone.updated_at = now();
            replace_memory_record(&conn, &tombstone)?;
            write_memory_event(
                &conn,
                Some(id),
                "forgotten",
                json!({ "mode": normalized_mode, "reason": reason }),
            )?;
        }
        _ => {
            let mut archived = record.clone();
            archived.status = "archived".to_string();
            archived.updated_at = now();
            replace_memory_record(&conn, &archived)?;
            write_memory_event(
                &conn,
                Some(id),
                "forgotten",
                json!({ "mode": normalized_mode, "reason": reason }),
            )?;
        }
    }
    Ok(json!({
        "id": id,
        "mode": normalized_mode,
        "reason": reason,
    }))
}

pub(crate) fn link_long_term_memory(
    root: &Path,
    source_id: &str,
    target_id: &str,
    relation: &str,
    confidence: f64,
) -> AgentRuntimeResult<MemoryRelation> {
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;
    let source_exists = load_memory_record(&conn, source_id)?.is_some();
    let target_exists = load_memory_record(&conn, target_id)?.is_some();
    if !source_exists {
        return Err(AgentRuntimeError::Core(format!(
            "memory not found: {source_id}"
        )));
    }
    if !target_exists {
        return Err(AgentRuntimeError::Core(format!(
            "memory not found: {target_id}"
        )));
    }
    let relation = MemoryRelation {
        source_id: source_id.to_string(),
        target_id: target_id.to_string(),
        relation: normalize_relation(relation),
        confidence: confidence.clamp(0.0, 1.0),
        created_at: now(),
    };
    upsert_memory_relation(&conn, &relation)?;
    write_memory_event(
        &conn,
        Some(source_id),
        "linked",
        json!({
            "sourceId": source_id,
            "targetId": target_id,
            "relation": relation.relation,
            "confidence": relation.confidence,
        }),
    )?;
    Ok(relation)
}

pub(crate) fn long_term_memory_audit(root: &Path) -> AgentRuntimeResult<Value> {
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM memories", [], |row| row.get(0))
        .map_err(sql_error)?;
    let active = count_memory_status(&conn, "active")?;
    let archived = count_memory_status(&conn, "archived")?;
    let superseded = count_memory_status(&conn, "superseded")?;
    let forgotten = count_memory_status(&conn, "forgotten")?;
    let low_confidence: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM memories WHERE confidence < 0.7 AND status = 'active'",
            [],
            |row| row.get(0),
        )
        .map_err(sql_error)?;
    let event_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM memory_events", [], |row| row.get(0))
        .map_err(sql_error)?;
    let relation_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM memory_relations", [], |row| {
            row.get(0)
        })
        .map_err(sql_error)?;
    let relation_summary = memory_relation_summary(&conn)?;
    let embedding_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM memory_embeddings", [], |row| {
            row.get(0)
        })
        .map_err(sql_error)?;
    let fts_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM memory_fts", [], |row| row.get(0))
        .map_err(sql_error)?;
    let cleanup_candidates = cleanup_long_term_memory_candidates(root, CLEANUP_DEFAULT_LIMIT)?;
    Ok(json!({
        "store": {
            "path": Value::Null,
            "schemaVersion": MEMORY_SCHEMA_VERSION,
            "fts": {
                "available": true,
                "indexedRecords": fts_count,
            },
            "embeddings": {
                "available": embedding_provider().is_some(),
                "provider": embedding_provider().map(|provider| provider.provider()).unwrap_or("disabled"),
                "model": embedding_provider().map(|provider| provider.model()).unwrap_or("none"),
                "dimension": embedding_provider().map(|provider| provider.dimension()).unwrap_or(0),
                "indexedRecords": embedding_count,
            },
        },
        "counts": {
            "total": total,
            "active": active,
            "archived": archived,
            "superseded": superseded,
            "forgotten": forgotten,
            "lowConfidence": low_confidence,
            "events": event_count,
            "relations": relation_count,
            "cleanupCandidates": cleanup_candidates.len(),
        },
        "relations": relation_summary,
    }))
}

pub(crate) fn rebuild_long_term_memory_index(root: &Path) -> AgentRuntimeResult<Value> {
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;
    conn.execute("DELETE FROM memory_fts", [])
        .map_err(sql_error)?;
    conn.execute("DELETE FROM memory_embeddings", [])
        .map_err(sql_error)?;
    conn.execute("DELETE FROM recall_fts WHERE recall_id IN (SELECT id FROM recall_items WHERE source_kind = 'long_term_memory')", [])
        .map_err(sql_error)?;
    conn.execute("DELETE FROM recall_embeddings WHERE recall_id IN (SELECT id FROM recall_items WHERE source_kind = 'long_term_memory')", [])
        .map_err(sql_error)?;
    conn.execute(
        "DELETE FROM recall_items WHERE source_kind = 'long_term_memory'",
        [],
    )
    .map_err(sql_error)?;
    let records = load_all_memory_records(&conn)?;
    let mut fts = 0_usize;
    let mut embeddings = 0_usize;
    let mut recall = 0_usize;
    for record in &records {
        upsert_memory_fts(&conn, record)?;
        sync_memory_record_to_recall(&conn, record)?;
        if try_upsert_memory_embedding(&conn, record)?.is_some() {
            embeddings += 1;
        }
        fts += 1;
        if record.status == "active" {
            recall += 1;
        }
    }
    write_memory_event(
        &conn,
        None,
        "index_rebuilt",
        json!({
            "ftsRecords": fts,
            "embeddingRecords": embeddings,
            "recallItems": recall,
        }),
    )?;
    Ok(json!({
        "ftsRecords": fts,
        "embeddingRecords": embeddings,
        "recallItems": recall,
    }))
}

pub(crate) fn index_session_messages_for_recall(
    root: &Path,
    session: &NativeSession,
) -> AgentRuntimeResult<Value> {
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;
    let session_id = session.id.clone();
    let session_path = root
        .join("sessions")
        .join(format!("{session_id}.json"))
        .display()
        .to_string();
    let messages = session
        .snapshot
        .get("messages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut indexed = 0_usize;
    for (index, message) in messages.iter().enumerate() {
        let role = message
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !matches!(role, "user" | "assistant") {
            continue;
        }
        let text = message
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();
        if text.chars().count() < 4 {
            continue;
        }
        let message_id = message
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("{session_id}:message-{index}"));
        let created_at = message
            .get("createdAt")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(now);
        let turn_id = message
            .get("turnId")
            .or_else(|| message.pointer("/metadata/turnId"))
            .and_then(Value::as_str)
            .map(str::to_string);
        let item = SystemRecallItem {
            id: format!("recall-session-{message_id}"),
            source_kind: "session_message".to_string(),
            source_id: message_id,
            session_id: Some(session_id.clone()),
            turn_id,
            role: Some(role.to_string()),
            text: text.to_string(),
            summary: None,
            content_hash: stable_hash(&normalized_recall_text(text)),
            source_path: Some(session_path.clone()),
            created_at: created_at.clone(),
            updated_at: created_at,
        };
        upsert_recall_item(&conn, &item)?;
        indexed += 1;
    }
    Ok(json!({ "sessionId": session_id, "indexed": indexed }))
}

pub(crate) fn rebuild_system_recall_index(
    root: &Path,
    sessions: &[NativeSession],
) -> AgentRuntimeResult<Value> {
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;
    conn.execute("DELETE FROM recall_fts", [])
        .map_err(sql_error)?;
    conn.execute("DELETE FROM recall_embeddings", [])
        .map_err(sql_error)?;
    conn.execute("DELETE FROM recall_items", [])
        .map_err(sql_error)?;
    let memories = load_all_memory_records(&conn)?;
    let mut memory_count = 0_usize;
    for record in &memories {
        sync_memory_record_to_recall(&conn, record)?;
        if record.status == "active" {
            memory_count += 1;
        }
    }
    let mut session_count = 0_usize;
    for session in sessions {
        session_count += index_session_messages_for_recall(root, session)?
            .get("indexed")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize;
    }
    Ok(json!({
        "memoryItems": memory_count,
        "sessionItems": session_count,
    }))
}

pub(crate) fn select_system_recall_for_injection(
    root: &Path,
    latest_user_text: &str,
    working_dir: Option<&str>,
    current_messages: &[Value],
) -> AgentRuntimeResult<Vec<RankedSystemRecallItem>> {
    let query = [Some(latest_user_text), working_dir]
        .into_iter()
        .flatten()
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if query.trim().chars().count() < 2 || search_terms(&query).is_empty() {
        return Ok(Vec::new());
    }
    let deadline = Instant::now() + Duration::from_millis(SYSTEM_RECALL_DEADLINE_MS);
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;
    if Instant::now() >= deadline {
        return Ok(Vec::new());
    }
    let fts_scores = recall_fts_score_map(&conn, &query, SYSTEM_RECALL_CANDIDATE_LIMIT)?;
    if fts_scores.is_empty() {
        return Ok(Vec::new());
    }
    let mut ids = fts_scores.keys().cloned().collect::<Vec<_>>();
    ids.sort();
    let items = load_recall_items(&conn, &ids)?;
    if Instant::now() >= deadline {
        return Ok(Vec::new());
    }
    let embeddings = load_recall_embedding_map(&conn, &ids)?;
    let query_vector = query_embedding(&query);
    let current_fingerprints = current_context_recall_fingerprints(current_messages);
    let mut ranked = Vec::new();
    for item in items {
        if Instant::now() >= deadline {
            return Ok(Vec::new());
        }
        if current_context_contains_recall(&current_fingerprints, &item) {
            continue;
        }
        let fts_score = fts_scores.get(&item.id).copied().unwrap_or(0.0);
        let vector_score = query_vector
            .as_ref()
            .and_then(|query_vector| {
                embeddings
                    .get(&item.id)
                    .map(|vector| cosine(query_vector, vector))
            })
            .unwrap_or(0.0);
        let metadata_boost = match item.source_kind.as_str() {
            "long_term_memory" => 0.18,
            "session_message" => 0.08,
            _ => 0.0,
        };
        let score = (fts_score * 0.45 + vector_score * 0.37 + metadata_boost).min(1.0);
        if score < 0.16 {
            continue;
        }
        let reason = if vector_score > fts_score {
            "local_hash_embedding_rerank"
        } else {
            "fts_bm25_match"
        }
        .to_string();
        ranked.push(RankedSystemRecallItem {
            item,
            score,
            reason,
        });
    }
    ranked.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                recall_source_priority(&left.item).cmp(&recall_source_priority(&right.item))
            })
            .then_with(|| right.item.updated_at.cmp(&left.item.updated_at))
    });
    Ok(dedupe_and_budget_recall(ranked))
}

pub(crate) fn system_recall_prompt(records: &[RankedSystemRecallItem]) -> String {
    if records.is_empty() {
        return String::new();
    }
    let mut lines = vec![
        "System-recalled Lyra context. These snippets were added by local deterministic retrieval from Lyra storage, not by the user in this turn. Treat them as source-marked evidence and prefer the latest user message if there is conflict.".to_string(),
    ];
    for (index, record) in records.iter().enumerate() {
        lines.push(format!(
            "{}. systemRecalled=true sourceKind={} sourceId={} sessionId={} turnId={} sourcePath={} score={:.3} reason={} content={}",
            index + 1,
            record.item.source_kind,
            record.item.source_id,
            record.item.session_id.as_deref().unwrap_or(""),
            record.item.turn_id.as_deref().unwrap_or(""),
            record.item.source_path.as_deref().unwrap_or(""),
            record.score,
            record.reason,
            truncate_recall_text(&record.item.text, SYSTEM_RECALL_ITEM_CHAR_BUDGET)
        ));
    }
    lines.join("\n")
}

pub(crate) fn system_recall_json(records: &[RankedSystemRecallItem]) -> Value {
    json!({
        "selectedCount": records.len(),
        "budget": {
            "maxItems": SYSTEM_RECALL_LIMIT,
            "totalCharBudget": SYSTEM_RECALL_TOTAL_CHAR_BUDGET,
            "perItemCharBudget": SYSTEM_RECALL_ITEM_CHAR_BUDGET,
            "deadlineMs": SYSTEM_RECALL_DEADLINE_MS,
        },
        "records": records.iter().map(|record| {
            json!({
                "systemRecalled": true,
                "sourceKind": record.item.source_kind,
                "sourceId": record.item.source_id,
                "sessionId": record.item.session_id,
                "turnId": record.item.turn_id,
                "role": record.item.role,
                "sourcePath": record.item.source_path,
                "score": record.score,
                "reason": record.reason,
                "content": truncate_recall_text(&record.item.text, SYSTEM_RECALL_ITEM_CHAR_BUDGET),
            })
        }).collect::<Vec<_>>()
    })
}

fn current_context_recall_fingerprints(messages: &[Value]) -> Vec<(String, HashSet<String>)> {
    messages
        .iter()
        .rev()
        .take(24)
        .filter_map(|message| message.get("text").and_then(Value::as_str))
        .filter(|text| !text.trim().is_empty())
        .map(|text| {
            let normalized = normalized_recall_text(text);
            let terms = search_terms(&normalized)
                .into_iter()
                .collect::<HashSet<_>>();
            (stable_hash(&normalized), terms)
        })
        .collect()
}

fn current_context_contains_recall(
    fingerprints: &[(String, HashSet<String>)],
    item: &SystemRecallItem,
) -> bool {
    let normalized = normalized_recall_text(&item.text);
    let hash = stable_hash(&normalized);
    if fingerprints
        .iter()
        .any(|(current_hash, _)| current_hash == &hash || current_hash == &item.content_hash)
    {
        return true;
    }
    let terms = search_terms(&normalized)
        .into_iter()
        .collect::<HashSet<_>>();
    if terms.len() < 4 {
        return false;
    }
    fingerprints
        .iter()
        .any(|(_, current_terms)| jaccard_overlap(&terms, current_terms) >= 0.82)
}

fn dedupe_and_budget_recall(ranked: Vec<RankedSystemRecallItem>) -> Vec<RankedSystemRecallItem> {
    let mut selected = Vec::new();
    let mut seen_content = HashSet::new();
    let mut seen_sources = HashSet::new();
    let mut total_chars = 0_usize;
    for mut record in ranked {
        let source_key = format!("{}:{}", record.item.source_kind, record.item.source_id);
        if !seen_content.insert(record.item.content_hash.clone())
            || !seen_sources.insert(source_key)
        {
            continue;
        }
        let snippet = truncate_recall_text(&record.item.text, SYSTEM_RECALL_ITEM_CHAR_BUDGET);
        let chars = snippet.chars().count();
        if total_chars + chars > SYSTEM_RECALL_TOTAL_CHAR_BUDGET {
            break;
        }
        record.item.text = snippet;
        total_chars += chars;
        selected.push(record);
        if selected.len() >= SYSTEM_RECALL_LIMIT {
            break;
        }
    }
    selected
}

fn recall_source_priority(item: &SystemRecallItem) -> usize {
    match item.source_kind.as_str() {
        "long_term_memory" => 0,
        "session_message" => 1,
        _ => 2,
    }
}

fn normalized_recall_text(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}

fn truncate_recall_text(text: &str, max_chars: usize) -> String {
    let mut output = text.trim().chars().take(max_chars).collect::<String>();
    if text.trim().chars().count() > max_chars {
        output.push_str("...");
    }
    output
}

fn jaccard_overlap(left: &HashSet<String>, right: &HashSet<String>) -> f64 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let intersection = left.intersection(right).count();
    let union = left.union(right).count();
    if union == 0 {
        0.0
    } else {
        intersection as f64 / union as f64
    }
}

pub(crate) fn cleanup_long_term_memory_candidates(
    root: &Path,
    limit: usize,
) -> AgentRuntimeResult<Vec<Value>> {
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;
    let records = load_all_memory_records(&conn)?;
    let mut candidates = records
        .into_iter()
        .filter_map(|record| cleanup_candidate_json(&record))
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        left.get("severity")
            .and_then(Value::as_f64)
            .partial_cmp(&right.get("severity").and_then(Value::as_f64))
            .unwrap_or(std::cmp::Ordering::Equal)
            .reverse()
    });
    Ok(candidates
        .into_iter()
        .take(effective_limit(limit))
        .collect())
}

pub(crate) fn create_memory_candidate(
    root: &Path,
    mutation: MemoryCandidateMutation,
) -> AgentRuntimeResult<MemoryCandidate> {
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;
    let candidate = mutation_to_memory_candidate(mutation);
    insert_memory_candidate(&conn, &candidate)?;
    write_memory_event(
        &conn,
        candidate.conflict_with.as_deref(),
        "candidate_created",
        json!({ "candidate": memory_candidate_json(&candidate) }),
    )?;
    Ok(candidate)
}

pub(crate) fn list_memory_candidates(
    root: &Path,
    status: Option<&str>,
    limit: usize,
) -> AgentRuntimeResult<Vec<MemoryCandidate>> {
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;
    expire_memory_candidates(&conn)?;
    let normalized_status = status
        .filter(|value| !value.trim().is_empty())
        .map(normalize_candidate_status);
    let mut statement = if normalized_status.is_some() {
        conn.prepare(
            "SELECT id FROM memory_candidates WHERE status = ?1 ORDER BY created_at DESC LIMIT ?2",
        )
        .map_err(sql_error)?
    } else {
        conn.prepare("SELECT id FROM memory_candidates ORDER BY created_at DESC LIMIT ?1")
            .map_err(sql_error)?
    };
    let ids = if let Some(status) = normalized_status {
        statement
            .query_map(params![status, effective_limit(limit) as i64], |row| {
                row.get::<_, String>(0)
            })
            .map_err(sql_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sql_error)?
    } else {
        statement
            .query_map(params![effective_limit(limit) as i64], |row| {
                row.get::<_, String>(0)
            })
            .map_err(sql_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sql_error)?
    };
    ids.into_iter()
        .filter_map(|id| load_memory_candidate(&conn, &id).transpose())
        .collect()
}

pub(crate) fn apply_memory_candidate(root: &Path, id: &str) -> AgentRuntimeResult<Value> {
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;
    expire_memory_candidates(&conn)?;
    let candidate = load_memory_candidate(&conn, id)?
        .ok_or_else(|| AgentRuntimeError::Core(format!("memory candidate not found: {id}")))?;
    if !matches!(
        candidate.status.as_str(),
        "pending" | "needs_user_confirmation" | "approved"
    ) {
        return Err(AgentRuntimeError::Core(format!(
            "memory candidate is not applicable: {}",
            candidate.status
        )));
    }
    let result = apply_memory_candidate_action(root, &candidate)?;
    mark_memory_candidate_status(&conn, id, "approved")?;
    write_memory_event(
        &conn,
        candidate.conflict_with.as_deref(),
        "candidate_applied",
        json!({
            "candidateId": id,
            "action": candidate.proposed_action,
            "result": result,
        }),
    )?;
    Ok(json!({ "candidate": memory_candidate_json(&candidate), "result": result }))
}

pub(crate) fn reject_memory_candidate(
    root: &Path,
    id: &str,
    reason: Option<&str>,
) -> AgentRuntimeResult<Value> {
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;
    let candidate = load_memory_candidate(&conn, id)?
        .ok_or_else(|| AgentRuntimeError::Core(format!("memory candidate not found: {id}")))?;
    mark_memory_candidate_status(&conn, id, "rejected")?;
    write_memory_event(
        &conn,
        candidate.conflict_with.as_deref(),
        "candidate_rejected",
        json!({ "candidateId": id, "reason": reason }),
    )?;
    Ok(json!({ "candidateId": id, "status": "rejected", "reason": reason }))
}

pub(crate) fn record_memory_injection(
    root: &Path,
    session_id: &str,
    turn_id: Option<&str>,
    query: Option<&str>,
    records: &[RankedMemoryRecord],
) -> AgentRuntimeResult<Value> {
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;
    let selected = records
        .iter()
        .map(|entry| {
            json!({
                "id": entry.record.id,
                "fact": entry.record.fact,
                "category": entry.record.category,
                "scope": entry.record.scope,
                "confidence": entry.record.confidence,
                "sourceType": entry.record.source_type,
                "score": entry.score,
                "scoreBreakdown": entry.breakdown,
            })
        })
        .collect::<Vec<_>>();
    let timestamp = now();
    conn.execute(
        "INSERT INTO memory_injection_events
          (id, session_id, turn_id, query, selected_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            format!("memory-injection-{}", Uuid::new_v4()),
            session_id,
            turn_id,
            query,
            serde_json::to_string(&selected)
                .map_err(|error| AgentRuntimeError::Serialization(error.to_string()))?,
            timestamp,
        ],
    )
    .map_err(sql_error)?;
    Ok(
        json!({ "sessionId": session_id, "turnId": turn_id, "selected": selected, "createdAt": timestamp }),
    )
}

pub(crate) fn explain_memory_injection(
    root: &Path,
    session_id: &str,
    turn_id: Option<&str>,
) -> AgentRuntimeResult<Value> {
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;
    let row = if let Some(turn_id) = turn_id {
        conn.query_row(
            "SELECT selected_json, query, created_at FROM memory_injection_events
             WHERE session_id = ?1 AND turn_id = ?2 ORDER BY created_at DESC LIMIT 1",
            params![session_id, turn_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(sql_error)?
    } else {
        conn.query_row(
            "SELECT selected_json, query, created_at FROM memory_injection_events
             WHERE session_id = ?1 ORDER BY created_at DESC LIMIT 1",
            params![session_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(sql_error)?
    };
    let Some((selected_json, query, created_at)) = row else {
        return Ok(json!({
            "sessionId": session_id,
            "turnId": turn_id,
            "selected": [],
            "reason": "no_memory_injection_recorded"
        }));
    };
    Ok(json!({
        "sessionId": session_id,
        "turnId": turn_id,
        "query": query,
        "selected": serde_json::from_str::<Value>(&selected_json).unwrap_or_else(|_| json!([])),
        "createdAt": created_at,
        "policy": {
            "workingMemory": "latest user intent and active turn outrank durable memory",
            "sessionMemory": "recent timeline and tool evidence are retained separately",
            "longTermMemory": "selected by hybrid ranker; contradictory records are excluded from injection"
        }
    }))
}

pub(crate) fn create_proactive_event(
    root: &Path,
    trigger_type: &str,
    title: &str,
    reason: &str,
    source: Value,
    mode: &str,
    session_id: Option<&str>,
) -> AgentRuntimeResult<ProactiveEvent> {
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;
    let event = ProactiveEvent {
        id: format!("proactive-{}", Uuid::new_v4()),
        trigger_type: trigger_type.to_string(),
        title: title.to_string(),
        reason: reason.to_string(),
        source,
        mode: normalize_proactive_mode(mode),
        status: "pending".to_string(),
        session_id: session_id.map(str::to_string),
        created_at: now(),
        dismissed_at: None,
        opened_session_id: None,
    };
    insert_proactive_event(&conn, &event)?;
    write_memory_event(
        &conn,
        None,
        "proactive_triggered",
        json!({ "event": proactive_event_json(&event) }),
    )?;
    Ok(event)
}

pub(crate) fn list_proactive_events(
    root: &Path,
    status: Option<&str>,
    limit: usize,
) -> AgentRuntimeResult<Vec<ProactiveEvent>> {
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;
    let normalized_status = status
        .filter(|value| !value.trim().is_empty())
        .map(normalize_proactive_status);
    let mut statement = if normalized_status.is_some() {
        conn.prepare(
            "SELECT id FROM proactive_events WHERE status = ?1 ORDER BY created_at DESC LIMIT ?2",
        )
        .map_err(sql_error)?
    } else {
        conn.prepare("SELECT id FROM proactive_events ORDER BY created_at DESC LIMIT ?1")
            .map_err(sql_error)?
    };
    let ids = if let Some(status) = normalized_status {
        statement
            .query_map(params![status, effective_limit(limit) as i64], |row| {
                row.get::<_, String>(0)
            })
            .map_err(sql_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sql_error)?
    } else {
        statement
            .query_map(params![effective_limit(limit) as i64], |row| {
                row.get::<_, String>(0)
            })
            .map_err(sql_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sql_error)?
    };
    ids.into_iter()
        .filter_map(|id| load_proactive_event(&conn, &id).transpose())
        .collect()
}

pub(crate) fn dismiss_proactive_event(
    root: &Path,
    id: &str,
    reason: Option<&str>,
) -> AgentRuntimeResult<Value> {
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;
    let event = load_proactive_event(&conn, id)?
        .ok_or_else(|| AgentRuntimeError::Core(format!("proactive event not found: {id}")))?;
    let timestamp = now();
    conn.execute(
        "UPDATE proactive_events SET status = 'dismissed', dismissed_at = ?2 WHERE id = ?1",
        params![id, timestamp],
    )
    .map_err(sql_error)?;
    write_memory_event(
        &conn,
        None,
        "proactive_dismissed",
        json!({ "eventId": id, "triggerType": event.trigger_type, "reason": reason }),
    )?;
    Ok(json!({ "eventId": id, "status": "dismissed", "dismissedAt": timestamp, "reason": reason }))
}

pub(crate) fn mark_proactive_event_opened(
    root: &Path,
    id: &str,
    opened_session_id: &str,
) -> AgentRuntimeResult<ProactiveEvent> {
    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;
    conn.execute(
        "UPDATE proactive_events SET status = 'opened', opened_session_id = ?2 WHERE id = ?1",
        params![id, opened_session_id],
    )
    .map_err(sql_error)?;
    load_proactive_event(&conn, id)?
        .ok_or_else(|| AgentRuntimeError::Core(format!("proactive event not found: {id}")))
}

pub(crate) fn memory_summary_json(record: &LongTermMemoryRecord) -> Value {
    json!({
        "id": record.id,
        "scope": record.scope,
        "category": record.category,
        "fact": record.fact,
        "confidence": record.confidence,
        "sourceType": record.source_type,
        "status": record.status,
        "updatedAt": record.updated_at,
        "lastAccessedAt": record.last_accessed_at,
        "accessCount": record.access_count,
        "tags": record.tags,
        "relatedTo": record.related_to,
        "relationCount": record.related_to.len(),
        "expiresAt": record.expires_at,
        "supersedes": record.supersedes,
        "supersededBy": record.superseded_by,
    })
}

pub(crate) fn ranked_memory_json(ranked: &RankedMemoryRecord, explain: bool) -> Value {
    let mut value = memory_record_json(&ranked.record);
    value["score"] = json!(ranked.score);
    value["scoreBreakdown"] = if explain {
        serde_json::to_value(&ranked.breakdown).unwrap_or(Value::Null)
    } else {
        json!({
            "finalScore": ranked.breakdown.final_score,
            "matchedBy": ranked.breakdown.matched_by,
        })
    };
    value
}

pub(crate) fn memory_record_json(record: &LongTermMemoryRecord) -> Value {
    json!({
        "id": record.id,
        "scope": record.scope,
        "category": record.category,
        "fact": record.fact,
        "content": record.content,
        "confidence": record.confidence,
        "sourceType": record.source_type,
        "sourceRef": record.source_ref,
        "status": record.status,
        "priority": record.priority,
        "createdAt": record.created_at,
        "updatedAt": record.updated_at,
        "lastAccessedAt": record.last_accessed_at,
        "accessCount": record.access_count,
        "tags": record.tags,
        "relatedTo": record.related_to,
        "expiresAt": record.expires_at,
        "supersedes": record.supersedes,
        "supersededBy": record.superseded_by,
    })
}
