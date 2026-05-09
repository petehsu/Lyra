use super::shared_memory::MemoryRecordInput;
use super::*;

impl AiStore {
    pub fn promote_to_frozen(&self, memory_id: &str) -> Result<Option<String>> {
        let Some(record) = self.read_shared_memory_for_promotion(memory_id)? else {
            return Ok(None);
        };
        if record.status != "active"
            || record.confidence < 0.8
            || record.stability < 0.7
            || record.reference_count < 2
        {
            return Ok(None);
        }
        let frozen_id = self.upsert_memory_record(MemoryRecordInput {
            scope: "frozen",
            namespace: &record.namespace,
            kind: &record.kind,
            value: record.value,
            evidence_refs: record.evidence_refs,
            source_session_id: &record.source_session_id,
            source_turn_id: record.source_turn_id.as_deref(),
            confidence: record.confidence,
            stability: record.stability,
            status: "active",
            supersedes_memory_id: None,
            metadata: json!({
                "promotedFromMemoryId": memory_id,
                "referenceCount": record.reference_count,
                "sourceMetadata": record.metadata,
                "promotion": "stable_repeated_shared_memory",
            }),
        })?;
        self.mark_shared_memory_promoted(memory_id, &frozen_id)?;
        Ok(Some(frozen_id))
    }

    pub fn promote_eligible_frozen_memories(&self) -> Result<usize> {
        let candidates = self.read_frozen_promotion_candidates()?;
        let mut promoted = 0;
        for memory_id in candidates {
            if self.promote_to_frozen(&memory_id)?.is_some() {
                promoted += 1;
            }
        }
        self.write_frozen_memory_projection()?;
        Ok(promoted)
    }

    pub fn write_frozen_memory_projection(&self) -> Result<()> {
        self.with_memory_conn("frozen", |_| Ok(()))?;
        self.write_memory_markdown_projection("frozen")
    }

    fn read_frozen_promotion_candidates(&self) -> Result<Vec<String>> {
        self.with_memory_conn("shared", |conn| {
            let mut stmt = conn.prepare(
                "SELECT memory_id
                 FROM memory_record
                 WHERE status = 'active'
                   AND confidence >= 0.8
                   AND stability >= 0.7
                   AND reference_count >= 2
                 ORDER BY updated_at_ms ASC",
            )?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
    }

    fn read_shared_memory_for_promotion(
        &self,
        memory_id: &str,
    ) -> Result<Option<SharedPromotionRecord>> {
        self.with_memory_conn("shared", |conn| {
            conn.query_row(
                "SELECT namespace, kind, value_json, evidence_refs_json, confidence,
                        stability, status, source_session_id, source_turn_id,
                        metadata_json, reference_count
                 FROM memory_record
                 WHERE memory_id = ?1",
                params![memory_id],
                |row| {
                    Ok(SharedPromotionRecord {
                        namespace: row.get(0)?,
                        kind: row.get(1)?,
                        value: parse_json_or(row.get::<_, String>(2)?, json!({})),
                        evidence_refs: parse_json_or(
                            row.get::<_, String>(3)?,
                            Vec::<String>::new(),
                        ),
                        confidence: row.get(4)?,
                        stability: row.get(5)?,
                        status: row.get(6)?,
                        source_session_id: row.get(7)?,
                        source_turn_id: row.get(8)?,
                        metadata: parse_json_or(row.get::<_, String>(9)?, json!({})),
                        reference_count: row.get(10)?,
                    })
                },
            )
            .optional()
            .context("failed to read shared memory promotion candidate")
        })
    }

    fn mark_shared_memory_promoted(&self, memory_id: &str, frozen_id: &str) -> Result<()> {
        let now = now_ms();
        let now_iso_value = now_iso();
        self.with_memory_conn("shared", |conn| {
            conn.execute(
                "UPDATE memory_record
                 SET status = 'promoted',
                     metadata_json = json_set(metadata_json, '$.promotedToFrozenMemoryId', ?1),
                     updated_at_ms = ?2,
                     updated_at_iso = ?3
                 WHERE memory_id = ?4",
                params![frozen_id, now, now_iso_value, memory_id],
            )?;
            Ok(())
        })
    }
}

struct SharedPromotionRecord {
    namespace: String,
    kind: String,
    value: Value,
    evidence_refs: Vec<String>,
    confidence: f64,
    stability: f64,
    status: String,
    source_session_id: String,
    source_turn_id: Option<String>,
    metadata: Value,
    reference_count: i64,
}
