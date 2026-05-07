use super::*;

pub(super) struct RecoverySupersedeResult {
    pub superseded_message_ids: Vec<String>,
    pub unresolved_side_effect_ids: Vec<String>,
}

pub(super) fn supersede_records_after_checkpoint(
    conn: &Connection,
    session_id: &str,
    rollback_id: &str,
    target_user_message_id: &str,
    target_runtime_turn_id: &str,
    checkpoint_created_at: i64,
) -> Result<RecoverySupersedeResult> {
    let now = now_ms();
    let now_iso = now_iso();
    let superseded_message_ids = supersede_messages_after_checkpoint(
        conn,
        rollback_id,
        target_user_message_id,
        now,
        &now_iso,
    )?;
    supersede_runtime_turns_after_checkpoint(
        conn,
        session_id,
        target_runtime_turn_id,
        checkpoint_created_at,
        now,
    )?;
    supersede_artifacts_after_checkpoint(conn, session_id, checkpoint_created_at, now, &now_iso)?;
    supersede_evidence_after_checkpoint(conn, session_id, checkpoint_created_at, now)?;
    supersede_plan_state_after_checkpoint(conn, session_id, checkpoint_created_at, now, &now_iso)?;
    supersede_approval_state_after_checkpoint(
        conn,
        session_id,
        checkpoint_created_at,
        now,
        &now_iso,
    )?;
    supersede_todo_execution_after_checkpoint(
        conn,
        session_id,
        checkpoint_created_at,
        now,
        &now_iso,
    )?;
    supersede_verification_delivery_after_checkpoint(
        conn,
        session_id,
        checkpoint_created_at,
        now,
        &now_iso,
    )?;
    supersede_long_work_after_checkpoint(conn, session_id, checkpoint_created_at, now, &now_iso)?;
    supersede_follow_after_checkpoint(conn, session_id, checkpoint_created_at, now, &now_iso)?;
    discard_live_drafts_after_checkpoint(conn, session_id, checkpoint_created_at, now, &now_iso)?;
    supersede_intake_after_checkpoint(
        conn,
        session_id,
        rollback_id,
        checkpoint_created_at,
        now,
        &now_iso,
    )?;
    let unresolved_side_effect_ids =
        mark_side_effects_after_checkpoint(conn, session_id, checkpoint_created_at, now)?;
    reopen_message_for_rerun(
        conn,
        session_id,
        target_user_message_id,
        rollback_id,
        now,
        &now_iso,
    )?;
    Ok(RecoverySupersedeResult {
        superseded_message_ids,
        unresolved_side_effect_ids,
    })
}

fn supersede_intake_after_checkpoint(
    conn: &Connection,
    session_id: &str,
    rollback_id: &str,
    checkpoint_created_at: i64,
    now: i64,
    now_iso: &str,
) -> Result<()> {
    for table in [
        "user_intent_envelope",
        "intent_target_binding",
        "runtime_decision_record",
        "inline_reference",
        "reference_resolution",
    ] {
        conn.execute(
            &format!(
                "UPDATE {table}
                 SET status = 'superseded_by_rollback'
                 WHERE session_id = ?1 AND created_at_ms >= ?2
                   AND status != 'superseded_by_rollback'"
            ),
            params![session_id, checkpoint_created_at],
        )?;
    }
    conn.execute(
        "UPDATE question_ticket
         SET status = 'superseded_by_rollback',
             updated_at_ms = ?1,
             updated_at_iso = ?2,
             superseded_by_rollback_id = ?3
         WHERE session_id = ?4 AND created_at_ms >= ?5
           AND status != 'superseded_by_rollback'",
        params![now, now_iso, rollback_id, session_id, checkpoint_created_at],
    )?;
    conn.execute(
        "UPDATE assumption_record
         SET status = 'superseded_by_rollback',
             updated_at_ms = ?1,
             updated_at_iso = ?2,
             superseded_by_rollback_id = ?3
         WHERE session_id = ?4 AND created_at_ms >= ?5
           AND status != 'superseded_by_rollback'",
        params![now, now_iso, rollback_id, session_id, checkpoint_created_at],
    )?;
    Ok(())
}

pub(super) fn supersede_messages_after_checkpoint(
    conn: &Connection,
    rollback_id: &str,
    target_user_message_id: &str,
    now: i64,
    now_iso: &str,
) -> Result<Vec<String>> {
    let target_index: i64 = conn
        .query_row(
            "SELECT turn_index FROM session_dialog WHERE msg_id = ?1",
            params![target_user_message_id],
            |row| row.get(0),
        )
        .context("failed to read rollback target message index")?;
    let mut stmt = conn.prepare(
        "SELECT msg_id
         FROM session_dialog
         WHERE turn_index > ?1
           AND COALESCE(status, 'active') != 'superseded_by_rollback'
         ORDER BY turn_index ASC",
    )?;
    let rows = stmt.query_map(params![target_index], |row| row.get::<_, String>(0))?;
    let mut ids = Vec::new();
    for row in rows {
        ids.push(row?);
    }
    conn.execute(
        "UPDATE session_dialog
         SET status = 'superseded_by_rollback',
             superseded_by_rollback_id = ?1,
             updated_at_ms = ?2
         WHERE turn_index > ?3",
        params![rollback_id, now, target_index],
    )?;
    let _ = now_iso;
    Ok(ids)
}

pub(super) fn supersede_artifacts_after_checkpoint(
    conn: &Connection,
    session_id: &str,
    checkpoint_created_at: i64,
    now: i64,
    now_iso: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE artifact_record
         SET status = 'superseded_by_rollback', updated_at_ms = ?1, updated_at_iso = ?2
         WHERE session_id = ?3 AND created_at_ms >= ?4
           AND status != 'superseded_by_rollback'",
        params![now, now_iso, session_id, checkpoint_created_at],
    )?;
    Ok(())
}

pub(super) fn supersede_evidence_after_checkpoint(
    conn: &Connection,
    session_id: &str,
    checkpoint_created_at: i64,
    now: i64,
) -> Result<()> {
    conn.execute(
        "UPDATE evidence_record
         SET status = 'superseded_by_rollback', stale_reason = 'message_rollback'
         WHERE session_id = ?1 AND created_at_ms >= ?2
           AND status != 'superseded_by_rollback'",
        params![session_id, checkpoint_created_at],
    )?;
    let _ = now;
    Ok(())
}

pub(super) fn supersede_plan_state_after_checkpoint(
    conn: &Connection,
    session_id: &str,
    checkpoint_created_at: i64,
    now: i64,
    now_iso: &str,
) -> Result<()> {
    for table in [
        "planning_session",
        "plan_version",
        "plan_review_panel",
        "plan_coverage_report",
    ] {
        conn.execute(
            &format!(
                "UPDATE {table}
                 SET status = 'superseded_by_rollback', updated_at_ms = ?1, updated_at_iso = ?2
                 WHERE session_id = ?3 AND created_at_ms >= ?4
                   AND status != 'superseded_by_rollback'"
            ),
            params![now, now_iso, session_id, checkpoint_created_at],
        )?;
    }
    Ok(())
}

pub(super) fn supersede_approval_state_after_checkpoint(
    conn: &Connection,
    session_id: &str,
    checkpoint_created_at: i64,
    now: i64,
    now_iso: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE approval_ticket
         SET status = 'superseded_by_rollback', updated_at_ms = ?1, updated_at_iso = ?2
         WHERE session_id = ?3 AND created_at_ms >= ?4
           AND status = 'pending_user'",
        params![now, now_iso, session_id, checkpoint_created_at],
    )?;
    Ok(())
}

pub(super) fn supersede_todo_execution_after_checkpoint(
    conn: &Connection,
    session_id: &str,
    checkpoint_created_at: i64,
    now: i64,
    now_iso: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE execution_todo_list
         SET status = 'superseded_by_rollback', updated_at_ms = ?1, updated_at_iso = ?2
         WHERE session_id = ?3 AND created_at_ms >= ?4
           AND status != 'superseded_by_rollback'",
        params![now, now_iso, session_id, checkpoint_created_at],
    )?;
    conn.execute(
        "UPDATE todo_item
         SET status = 'superseded_by_rollback', updated_at_ms = ?1, updated_at_iso = ?2
         WHERE todo_list_id IN (
            SELECT todo_list_id FROM execution_todo_list
            WHERE session_id = ?3 AND created_at_ms >= ?4
         )",
        params![now, now_iso, session_id, checkpoint_created_at],
    )?;
    conn.execute(
        "UPDATE execution_run
         SET status = 'superseded_by_rollback', updated_at_ms = ?1, updated_at_iso = ?2
         WHERE session_id = ?3 AND created_at_ms >= ?4
           AND status != 'superseded_by_rollback'",
        params![now, now_iso, session_id, checkpoint_created_at],
    )?;
    conn.execute(
        "UPDATE execution_step
         SET status = 'superseded_by_rollback', updated_at_ms = ?1, updated_at_iso = ?2
         WHERE execution_run_id IN (
            SELECT execution_run_id FROM execution_run
            WHERE session_id = ?3 AND created_at_ms >= ?4
         )",
        params![now, now_iso, session_id, checkpoint_created_at],
    )?;
    Ok(())
}

pub(super) fn supersede_verification_delivery_after_checkpoint(
    conn: &Connection,
    session_id: &str,
    checkpoint_created_at: i64,
    now: i64,
    now_iso: &str,
) -> Result<()> {
    for table in [
        "verification_plan",
        "verification_run",
        "completion_audit",
        "delivery_proof",
    ] {
        conn.execute(
            &format!(
                "UPDATE {table}
                 SET status = 'superseded_by_rollback', updated_at_ms = ?1, updated_at_iso = ?2
                 WHERE session_id = ?3 AND created_at_ms >= ?4
                   AND status != 'superseded_by_rollback'"
            ),
            params![now, now_iso, session_id, checkpoint_created_at],
        )?;
    }
    Ok(())
}

pub(super) fn supersede_long_work_after_checkpoint(
    conn: &Connection,
    session_id: &str,
    checkpoint_created_at: i64,
    now: i64,
    now_iso: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE long_work_run
         SET status = 'superseded_by_rollback', updated_at_ms = ?1, updated_at_iso = ?2
         WHERE session_id = ?3 AND created_at_ms >= ?4
           AND status != 'superseded_by_rollback'",
        params![now, now_iso, session_id, checkpoint_created_at],
    )?;
    conn.execute(
        "UPDATE native_long_work_goal
         SET status = 'superseded_by_rollback', updated_at_ms = ?1, updated_at_iso = ?2
         WHERE session_id = ?3 AND created_at_ms >= ?4
           AND status != 'superseded_by_rollback'",
        params![now, now_iso, session_id, checkpoint_created_at],
    )?;
    conn.execute(
        "UPDATE work_slice
         SET status = 'superseded_by_rollback', updated_at_ms = ?1, updated_at_iso = ?2,
             closed_at_ms = COALESCE(closed_at_ms, ?1), closed_at_iso = COALESCE(closed_at_iso, ?2)
         WHERE session_id = ?3 AND created_at_ms >= ?4
           AND status != 'superseded_by_rollback'",
        params![now, now_iso, session_id, checkpoint_created_at],
    )?;
    conn.execute(
        "UPDATE long_work_continuation
         SET status = 'superseded_by_rollback', updated_at_ms = ?1, updated_at_iso = ?2,
             consumed_at_ms = COALESCE(consumed_at_ms, ?1), consumed_at_iso = COALESCE(consumed_at_iso, ?2)
         WHERE session_id = ?3 AND created_at_ms >= ?4
           AND status != 'superseded_by_rollback'",
        params![now, now_iso, session_id, checkpoint_created_at],
    )?;
    Ok(())
}

pub(super) fn supersede_follow_after_checkpoint(
    conn: &Connection,
    session_id: &str,
    checkpoint_created_at: i64,
    now: i64,
    now_iso: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE follow_session
         SET status = 'superseded_by_rollback', updated_at_ms = ?1, updated_at_iso = ?2
         WHERE session_id = ?3 AND created_at_ms >= ?4
           AND status != 'superseded_by_rollback'",
        params![now, now_iso, session_id, checkpoint_created_at],
    )?;
    conn.execute(
        "UPDATE follow_target
         SET status = 'superseded_by_rollback', updated_at_ms = ?1, updated_at_iso = ?2
         WHERE session_id = ?3 AND created_at_ms >= ?4
           AND status != 'superseded_by_rollback'",
        params![now, now_iso, session_id, checkpoint_created_at],
    )?;
    conn.execute(
        "UPDATE follow_event
         SET status = 'superseded_by_rollback'
         WHERE session_id = ?1 AND created_at_ms >= ?2
           AND status != 'superseded_by_rollback'",
        params![session_id, checkpoint_created_at],
    )?;
    conn.execute(
        "UPDATE workspace_commit
         SET status = 'superseded_by_rollback', updated_at_ms = ?1, updated_at_iso = ?2
         WHERE follow_session_id IN (
            SELECT follow_session_id FROM follow_session
            WHERE session_id = ?3
         )
           AND created_at_ms >= ?4
           AND status != 'superseded_by_rollback'",
        params![now, now_iso, session_id, checkpoint_created_at],
    )?;
    Ok(())
}

pub(super) fn discard_live_drafts_after_checkpoint(
    conn: &Connection,
    session_id: &str,
    checkpoint_created_at: i64,
    now: i64,
    now_iso: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE live_edit_stream
         SET status = 'discarded', updated_at_ms = ?1, updated_at_iso = ?2
         WHERE follow_session_id IN (
            SELECT follow_session_id FROM follow_session
            WHERE session_id = ?3
         )
           AND created_at_ms >= ?4
           AND status NOT IN ('committed', 'discarded')",
        params![now, now_iso, session_id, checkpoint_created_at],
    )?;
    Ok(())
}

fn supersede_runtime_turns_after_checkpoint(
    conn: &Connection,
    session_id: &str,
    target_runtime_turn_id: &str,
    checkpoint_created_at: i64,
    now: i64,
) -> Result<()> {
    conn.execute(
        "UPDATE runtime_turn
         SET status = 'superseded_by_rollback', current_state = 'superseded_by_rollback',
             updated_at_ms = ?1
         WHERE session_id = ?2
           AND (runtime_turn_id = ?3 OR created_at_ms >= ?4)
           AND status != 'superseded_by_rollback'",
        params![
            now,
            session_id,
            target_runtime_turn_id,
            checkpoint_created_at
        ],
    )?;
    Ok(())
}

fn mark_side_effects_after_checkpoint(
    conn: &Connection,
    session_id: &str,
    checkpoint_created_at: i64,
    now: i64,
) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT side_effect_id, rollback_status
         FROM side_effect_record
         WHERE session_id = ?1 AND created_at_ms >= ?2
         ORDER BY created_at_ms ASC",
    )?;
    let rows = stmt.query_map(params![session_id, checkpoint_created_at], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut reversible = Vec::new();
    let mut unresolved = Vec::new();
    for row in rows {
        let (side_effect_id, status) = row?;
        if status == "reversible" {
            reversible.push(side_effect_id);
        } else if status != "restored" {
            unresolved.push(side_effect_id);
        }
    }
    for side_effect_id in reversible {
        conn.execute(
            "UPDATE side_effect_record
             SET rollback_status = 'restored'
             WHERE side_effect_id = ?1",
            params![side_effect_id],
        )?;
    }
    let _ = now;
    Ok(unresolved)
}

fn reopen_message_for_rerun(
    conn: &Connection,
    session_id: &str,
    target_user_message_id: &str,
    rollback_id: &str,
    now: i64,
    now_iso: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE session_dialog
         SET status = 'reopened', reopened_by_rollback_id = ?1, updated_at_ms = ?2
         WHERE msg_id = ?3",
        params![rollback_id, now, target_user_message_id],
    )?;
    conn.execute(
        "INSERT INTO message_reopen (
            message_reopen_id, session_id, user_message_id, rollback_id, status,
            created_at_ms, created_at_iso
         ) VALUES (?1, ?2, ?3, ?4, 'reopened', ?5, ?6)",
        params![
            new_id("message_reopen"),
            session_id,
            target_user_message_id,
            rollback_id,
            now,
            now_iso,
        ],
    )?;
    Ok(())
}
