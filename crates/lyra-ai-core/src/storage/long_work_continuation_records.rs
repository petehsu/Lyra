use super::long_work_continuation_state::WorkRunRow;
use super::*;

pub(super) fn read_latest_continuation_summary(
    conn: &Connection,
    run_id: &str,
) -> Result<Option<AgentLongWorkContinuationSummary>> {
    conn.query_row(
        "SELECT continuation_id, status, recommended_action, previous_slice_id,
                next_slice_sequence, reason_summary, created_at_ms, updated_at_ms
         FROM long_work_continuation
         WHERE long_work_run_id = ?1
         ORDER BY updated_at_ms DESC, created_at_ms DESC
         LIMIT 1",
        params![run_id],
        |row| {
            Ok(AgentLongWorkContinuationSummary {
                continuation_id: row.get(0)?,
                status: row.get(1)?,
                recommended_action: row.get(2)?,
                previous_slice_id: row.get(3)?,
                next_slice_sequence: row.get(4)?,
                reason_summary: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    )
    .optional()
    .context("failed to read long work continuation summary")
}

pub(super) fn read_latest_premature_stop_summary(
    conn: &Connection,
    run_id: &str,
) -> Result<Option<AgentPrematureStopSummary>> {
    conn.query_row(
        "SELECT report_id, is_premature_stop, signals_json, open_todo_item_ids_json,
                missing_evidence_json, recommended_action, suppressed_message_id, created_at_ms
         FROM premature_stop_report
         WHERE long_work_run_id = ?1
         ORDER BY created_at_ms DESC
         LIMIT 1",
        params![run_id],
        |row| {
            let signals_json: String = row.get(2)?;
            let open_json: String = row.get(3)?;
            let missing_json: String = row.get(4)?;
            Ok(AgentPrematureStopSummary {
                report_id: row.get(0)?,
                is_premature_stop: row.get::<_, i64>(1)? != 0,
                signals: parse_json_vec_string(&signals_json),
                open_todo_item_ids: parse_json_vec_string(&open_json),
                missing_evidence: parse_json_vec_string(&missing_json),
                recommended_action: row.get(5)?,
                suppressed_message_id: row.get(6)?,
                created_at: row.get(7)?,
            })
        },
    )
    .optional()
    .context("failed to read premature stop summary")
}

pub(super) fn read_latest_stuck_summary(
    conn: &Connection,
    run_id: &str,
) -> Result<Option<AgentStuckSummary>> {
    conn.query_row(
        "SELECT stuck_report_id, repeated_failure_count, no_progress_slice_count,
                suspected_cause, recommended_action, evidence_refs_json, reason_summary,
                created_at_ms
         FROM stuck_report
         WHERE long_work_run_id = ?1
         ORDER BY created_at_ms DESC
         LIMIT 1",
        params![run_id],
        |row| {
            let evidence_json: String = row.get(5)?;
            Ok(AgentStuckSummary {
                stuck_report_id: row.get(0)?,
                repeated_failure_count: row.get(1)?,
                no_progress_slice_count: row.get(2)?,
                suspected_cause: row.get(3)?,
                recommended_action: row.get(4)?,
                evidence_refs: parse_json_vec_string(&evidence_json),
                reason_summary: row.get(6)?,
                created_at: row.get(7)?,
            })
        },
    )
    .optional()
    .context("failed to read stuck summary")
}

pub(super) fn insert_premature_stop_report(
    conn: &Connection,
    run: &WorkRunRow,
    turn_id: Option<&str>,
    signals: &[String],
    open_todo_item_ids: &[String],
    missing_evidence: &[String],
    recommended_action: &str,
    suppressed_message_id: Option<&str>,
    candidate_text: &str,
) -> Result<String> {
    let report_id = new_id("premature_stop");
    let now = now_ms();
    let now_iso = now_iso();
    let suppressed_output = if candidate_text.trim().is_empty() {
        None
    } else {
        Some(
            json!({
                "sha256": sha256_hex(candidate_text.as_bytes()),
                "preview": preview_text(candidate_text, 240),
            })
            .to_string(),
        )
    };
    conn.execute(
        "INSERT INTO premature_stop_report (
            report_id, session_id, long_work_run_id, work_slice_id, runtime_turn_id,
            is_premature_stop, signals_json, open_todo_item_ids_json, missing_evidence_json,
            recommended_action, suppressed_message_id, suppressed_output_json,
            created_at_ms, created_at_iso
         ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            report_id,
            run.session_id,
            run.run_id,
            run.current_slice_id,
            turn_id,
            serde_json::to_string(signals)?,
            serde_json::to_string(open_todo_item_ids)?,
            serde_json::to_string(missing_evidence)?,
            recommended_action,
            suppressed_message_id,
            suppressed_output,
            now,
            now_iso,
        ],
    )?;
    Ok(report_id)
}

pub(super) fn insert_continuation(
    conn: &Connection,
    run: &WorkRunRow,
    turn_id: Option<&str>,
    previous_slice_id: &str,
    next_slice_sequence: i64,
    recommended_action: &str,
    packet: &Value,
    reason_summary: &str,
) -> Result<String> {
    let continuation_id = packet
        .get("continuationId")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| new_id("continuation"));
    let now = now_ms();
    let now_iso = now_iso();
    conn.execute(
        "INSERT INTO long_work_continuation (
            continuation_id, session_id, long_work_run_id, previous_slice_id,
            next_slice_sequence, runtime_turn_id, status, recommended_action, packet_json,
            reason_summary, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued', ?7, ?8, ?9, ?10, ?11, ?10, ?11)",
        params![
            continuation_id,
            run.session_id,
            run.run_id,
            previous_slice_id,
            next_slice_sequence,
            turn_id,
            recommended_action,
            packet.to_string(),
            reason_summary,
            now,
            now_iso,
        ],
    )?;
    Ok(continuation_id)
}

pub(super) fn insert_stuck_report(
    conn: &Connection,
    run: &WorkRunRow,
    turn_id: Option<&str>,
    repeated_failure_count: i64,
    no_progress_slice_count: i64,
    suspected_cause: &str,
    recommended_action: &str,
    evidence_refs: &[String],
    reason_summary: &str,
) -> Result<String> {
    let stuck_report_id = new_id("stuck_report");
    let now = now_ms();
    let now_iso = now_iso();
    conn.execute(
        "INSERT INTO stuck_report (
            stuck_report_id, session_id, long_work_run_id, work_slice_id, runtime_turn_id,
            repeated_failure_count, no_progress_slice_count, suspected_cause,
            recommended_action, evidence_refs_json, reason_summary, created_at_ms,
            created_at_iso
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            stuck_report_id,
            run.session_id,
            run.run_id,
            run.current_slice_id,
            turn_id,
            repeated_failure_count,
            no_progress_slice_count,
            suspected_cause,
            recommended_action,
            serde_json::to_string(evidence_refs)?,
            reason_summary,
            now,
            now_iso,
        ],
    )?;
    Ok(stuck_report_id)
}
