use super::long_work_ledger::read_latest_work_summary_from_conn;
use super::long_work_status::{approval_related_blocker, update_work_status_in_conn};
use super::*;

impl AiStore {
    pub fn resume_long_work_continuation(
        &self,
        input: ResumeLongWorkContinuationInput,
    ) -> Result<Option<AgentLongWorkSummary>> {
        self.with_session_conn(&input.session_id, |conn| {
            let Some(row) =
                read_continuation_resume_row(conn, &input.session_id, &input.continuation_id)?
            else {
                return read_latest_work_summary_from_conn(conn, &input.session_id);
            };
            if row.status != "queued" && row.status != "resuming" {
                return read_latest_work_summary_from_conn(conn, &input.session_id);
            }
            if row.started_side_effect {
                block_continuation(conn, &row, "Started side effects require manual recovery")?;
                return read_latest_work_summary_from_conn(conn, &input.session_id);
            }
            let items = read_todo_items_for_list(conn, &row.todo_list_id)?;
            if approval_related_blocker(&items) || has_pending_approval(conn, &input.session_id)? {
                block_continuation(conn, &row, "Approval required before continuation")?;
                return read_latest_work_summary_from_conn(conn, &input.session_id);
            }
            let now = now_ms();
            let now_iso = now_iso();
            let next_slice_id = new_id("work_slice");
            let item_ids = items
                .iter()
                .map(|item| item.todo_item_id.clone())
                .take(9)
                .collect::<Vec<_>>();
            conn.execute(
                "UPDATE work_slice
                 SET status = 'superseded_by_continuation', updated_at_ms = ?1, updated_at_iso = ?2
                 WHERE work_slice_id = ?3",
                params![now, now_iso, row.previous_slice_id],
            )?;
            conn.execute(
                "INSERT INTO work_slice (
                    work_slice_id, long_work_run_id, session_id, runtime_turn_id, todo_list_id,
                    execution_run_id, status, sequence, item_ids_json, checkpoint_ids_json,
                    blocker_ids_json, created_at_ms, created_at_iso, updated_at_ms,
                    updated_at_iso, closed_at_ms, closed_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'running', ?7, ?8, ?9, '[]', ?10, ?11, ?10, ?11, NULL, NULL)",
                params![
                    next_slice_id,
                    row.run_id,
                    input.session_id,
                    row.runtime_turn_id,
                    row.todo_list_id,
                    row.execution_run_id,
                    row.next_slice_sequence,
                    json_string(&item_ids)?,
                    json_string(&row.checkpoint_ids)?,
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "UPDATE long_work_run
                 SET status = 'auto_resuming', current_slice_id = ?1,
                     updated_at_ms = ?2, updated_at_iso = ?3
                 WHERE long_work_run_id = ?4",
                params![next_slice_id, now, now_iso, row.run_id],
            )?;
            conn.execute(
                "UPDATE native_long_work_goal
                 SET status = 'auto_resuming', updated_at_ms = ?1, updated_at_iso = ?2
                 WHERE goal_id = ?3",
                params![now, now_iso, row.goal_id],
            )?;
            conn.execute(
                "UPDATE long_work_continuation
                 SET status = 'resuming', updated_at_ms = ?1, updated_at_iso = ?2,
                     consumed_at_ms = COALESCE(consumed_at_ms, ?1),
                     consumed_at_iso = COALESCE(consumed_at_iso, ?2)
                 WHERE continuation_id = ?3",
                params![now, now_iso, input.continuation_id],
            )?;
            read_latest_work_summary_from_conn(conn, &input.session_id)
        })
    }

    pub fn recover_long_work_continuation(
        &self,
        input: RecoverLongWorkContinuationInput,
    ) -> Result<Option<AgentLongWorkSummary>> {
        self.with_session_conn(&input.session_id, |conn| {
            let Some(row) = read_latest_resuming_continuation(conn, &input.session_id)? else {
                return read_latest_work_summary_from_conn(conn, &input.session_id);
            };
            let now = now_ms();
            let now_iso = now_iso();
            if row.started_side_effect {
                block_continuation(conn, &row, "Started side effects require manual recovery")?;
            } else {
                conn.execute(
                    "UPDATE long_work_continuation
                     SET status = 'queued', updated_at_ms = ?1, updated_at_iso = ?2
                     WHERE continuation_id = ?3",
                    params![now, now_iso, row.continuation_id],
                )?;
                conn.execute(
                    "UPDATE long_work_run
                     SET status = 'running', updated_at_ms = ?1, updated_at_iso = ?2
                     WHERE long_work_run_id = ?3",
                    params![now, now_iso, row.run_id],
                )?;
            }
            read_latest_work_summary_from_conn(conn, &input.session_id)
        })
    }

    #[cfg(test)]
    pub fn mark_long_work_continuation_started_side_effect_for_test(
        &self,
        session_id: &str,
        continuation_id: &str,
    ) -> Result<()> {
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "UPDATE long_work_continuation
                 SET started_side_effect = 1, status = 'resuming'
                 WHERE continuation_id = ?1",
                params![continuation_id],
            )?;
            Ok(())
        })
    }
}

struct ContinuationResumeRow {
    continuation_id: String,
    run_id: String,
    previous_slice_id: String,
    next_slice_sequence: i64,
    runtime_turn_id: Option<String>,
    status: String,
    started_side_effect: bool,
    todo_list_id: String,
    execution_run_id: String,
    goal_id: String,
    checkpoint_ids: Vec<String>,
}

fn read_continuation_resume_row(
    conn: &Connection,
    session_id: &str,
    continuation_id: &str,
) -> Result<Option<ContinuationResumeRow>> {
    conn.query_row(
        "SELECT c.continuation_id, c.long_work_run_id, c.previous_slice_id,
                c.next_slice_sequence, c.runtime_turn_id, c.status, c.started_side_effect,
                r.todo_list_id, r.execution_run_id, r.goal_id, r.checkpoint_ids_json
         FROM long_work_continuation c
         JOIN long_work_run r ON r.long_work_run_id = c.long_work_run_id
         WHERE c.session_id = ?1 AND c.continuation_id = ?2",
        params![session_id, continuation_id],
        read_continuation_resume_row_from_row,
    )
    .optional()
    .context("failed to read continuation resume row")
}

fn read_latest_resuming_continuation(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<ContinuationResumeRow>> {
    conn.query_row(
        "SELECT c.continuation_id, c.long_work_run_id, c.previous_slice_id,
                c.next_slice_sequence, c.runtime_turn_id, c.status, c.started_side_effect,
                r.todo_list_id, r.execution_run_id, r.goal_id, r.checkpoint_ids_json
         FROM long_work_continuation c
         JOIN long_work_run r ON r.long_work_run_id = c.long_work_run_id
         WHERE c.session_id = ?1 AND c.status = 'resuming'
         ORDER BY c.updated_at_ms DESC
         LIMIT 1",
        params![session_id],
        read_continuation_resume_row_from_row,
    )
    .optional()
    .context("failed to read resuming continuation")
}

fn read_continuation_resume_row_from_row(row: &Row<'_>) -> rusqlite::Result<ContinuationResumeRow> {
    let checkpoint_json: String = row.get(10)?;
    Ok(ContinuationResumeRow {
        continuation_id: row.get(0)?,
        run_id: row.get(1)?,
        previous_slice_id: row.get(2)?,
        next_slice_sequence: row.get(3)?,
        runtime_turn_id: row.get(4)?,
        status: row.get(5)?,
        started_side_effect: row.get::<_, i64>(6)? != 0,
        todo_list_id: row.get(7)?,
        execution_run_id: row.get(8)?,
        goal_id: row.get(9)?,
        checkpoint_ids: parse_json_vec_string(&checkpoint_json),
    })
}

fn block_continuation(conn: &Connection, row: &ContinuationResumeRow, reason: &str) -> Result<()> {
    let now = now_ms();
    let now_iso = now_iso();
    conn.execute(
        "UPDATE long_work_continuation
         SET status = 'blocked', reason_summary = ?1, updated_at_ms = ?2, updated_at_iso = ?3
         WHERE continuation_id = ?4",
        params![reason, now, now_iso, row.continuation_id],
    )?;
    update_work_status_in_conn(
        conn,
        &row.run_id,
        &LongWorkStatusUpdate {
            status: "blocked".to_string(),
            checkpoint_ids: row.checkpoint_ids.clone(),
            blocker_ids: vec![row.continuation_id.clone()],
        },
        now,
        &now_iso,
    )
}

fn has_pending_approval(conn: &Connection, session_id: &str) -> Result<bool> {
    let count = conn.query_row(
        "SELECT COUNT(*)
         FROM approval_ticket
         WHERE session_id = ?1 AND status = 'pending'",
        params![session_id],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(count > 0)
}
