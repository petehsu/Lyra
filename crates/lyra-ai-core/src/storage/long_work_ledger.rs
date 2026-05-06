use super::long_work_continuation_records::{
    read_latest_continuation_summary, read_latest_premature_stop_summary, read_latest_stuck_summary,
};
use super::long_work_status::{
    blocker_summary, decide_status_from_conn, progress_from_items, update_work_status_in_conn,
};
use super::*;

impl AiStore {
    pub fn create_long_work_run(
        &self,
        input: CreateLongWorkRunInput,
    ) -> Result<CreatedLongWorkRun> {
        if input.session_id.trim().is_empty() {
            return Err(anyhow!("sessionId is required"));
        }
        if input.todo_list_id.trim().is_empty() {
            return Err(anyhow!("todoListId is required"));
        }
        if input.execution_run_id.trim().is_empty() {
            return Err(anyhow!("executionRunId is required"));
        }
        let goal_id = new_id("goal");
        let run_id = new_id("long_work_run");
        let slice_id = new_id("work_slice");
        let now = now_ms();
        let now_iso = now_iso();
        let objective_summary = input.objective_summary.trim().to_string();
        let objective_summary = if objective_summary.is_empty() {
            "Execute approved work".to_string()
        } else {
            objective_summary
        };
        let goal = NativeLongWorkGoal {
            goal_id: goal_id.clone(),
            session_id: input.session_id.clone(),
            status: "running".to_string(),
            objective_summary: objective_summary.clone(),
            completion_contract: input.completion_contract.clone(),
            budget: input.budget.clone(),
            created_at: now,
            updated_at: now,
        };
        self.with_session_conn(&input.session_id, |conn| {
            cancel_active_work(conn, &input.session_id, now, &now_iso)?;
            conn.execute(
                "INSERT INTO native_long_work_goal (
                    goal_id, session_id, status, objective_summary, completion_contract_json,
                    budget_json, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, 'running', ?3, ?4, ?5, ?6, ?7, ?6, ?7)",
                params![
                    goal.goal_id,
                    goal.session_id,
                    goal.objective_summary,
                    goal.completion_contract.to_string(),
                    goal.budget.to_string(),
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO long_work_run (
                    long_work_run_id, session_id, runtime_turn_id, user_message_id, plan_id,
                    todo_list_id, execution_run_id, goal_id, status, objective_summary,
                    completion_contract_json, budget_json, checkpoint_ids_json,
                    blocker_ids_json, current_slice_id, created_at_ms, created_at_iso,
                    updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'running', ?9, ?10, ?11, ?12, '[]', ?13, ?14, ?15, ?14, ?15)",
                params![
                    run_id,
                    input.session_id,
                    input.runtime_turn_id,
                    input.user_message_id,
                    input.plan_id,
                    input.todo_list_id,
                    input.execution_run_id,
                    goal_id,
                    objective_summary,
                    input.completion_contract.to_string(),
                    input.budget.to_string(),
                    json_string(&input.checkpoint_ids)?,
                    slice_id,
                    now,
                    now_iso,
                ],
            )?;
            let item_ids = read_todo_items_for_list(conn, &input.todo_list_id)?
                .into_iter()
                .map(|item| item.todo_item_id)
                .take(9)
                .collect::<Vec<_>>();
            conn.execute(
                "INSERT INTO work_slice (
                    work_slice_id, long_work_run_id, session_id, runtime_turn_id, todo_list_id,
                    execution_run_id, status, item_ids_json, checkpoint_ids_json,
                    blocker_ids_json, created_at_ms, created_at_iso, updated_at_ms,
                    updated_at_iso, closed_at_ms, closed_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'running', ?7, ?8, '[]', ?9, ?10, ?9, ?10, NULL, NULL)",
                params![
                    slice_id,
                    run_id,
                    input.session_id,
                    input.runtime_turn_id,
                    input.todo_list_id,
                    input.execution_run_id,
                    json_string(&item_ids)?,
                    json_string(&input.checkpoint_ids)?,
                    now,
                    now_iso,
                ],
            )?;
            Ok(())
        })?;
        let summary = self
            .read_active_work_summary(&input.session_id)?
            .ok_or_else(|| anyhow!("created work run could not be read"))?;
        Ok(CreatedLongWorkRun { summary })
    }

    pub fn read_active_work_summary(
        &self,
        session_id: &str,
    ) -> Result<Option<SessionTaskLedgerSummary>> {
        self.with_session_conn(session_id, |conn| {
            read_latest_work_summary_from_conn(conn, session_id)
        })
    }

    pub fn update_long_work_status(
        &self,
        session_id: &str,
        run_id: &str,
        update: LongWorkStatusUpdate,
    ) -> Result<Option<SessionTaskLedgerSummary>> {
        let now = now_ms();
        let now_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            update_work_status_in_conn(conn, run_id, &update, now, &now_iso)?;
            read_latest_work_summary_from_conn(conn, session_id)
        })
    }

    pub fn refresh_active_work_status(
        &self,
        session_id: &str,
        turn_id: Option<&str>,
    ) -> Result<Option<SessionTaskLedgerSummary>> {
        self.with_session_conn(session_id, |conn| {
            let Some(run_id) = read_latest_active_work_run_id_from_conn(conn, session_id)? else {
                return Ok(None);
            };
            let Some(decision) = decide_status_from_conn(conn, session_id, &run_id, turn_id)?
            else {
                return read_latest_work_summary_from_conn(conn, session_id);
            };
            let now = now_ms();
            let now_iso = now_iso();
            update_work_status_in_conn(conn, &run_id, &decision, now, &now_iso)?;
            read_latest_work_summary_from_conn(conn, session_id)
        })
    }
}

fn cancel_active_work(conn: &Connection, session_id: &str, now: i64, now_iso: &str) -> Result<()> {
    conn.execute(
        "UPDATE long_work_run
         SET status = 'cancelled', updated_at_ms = ?1, updated_at_iso = ?2
         WHERE session_id = ?3 AND status IN ('created', 'running', 'blocked', 'auto_resuming')",
        params![now, now_iso, session_id],
    )?;
    conn.execute(
        "UPDATE native_long_work_goal
         SET status = 'cancelled', updated_at_ms = ?1, updated_at_iso = ?2
         WHERE session_id = ?3 AND status IN ('created', 'running', 'blocked', 'auto_resuming')",
        params![now, now_iso, session_id],
    )?;
    conn.execute(
        "UPDATE work_slice
         SET status = 'cancelled', updated_at_ms = ?1, updated_at_iso = ?2,
             closed_at_ms = COALESCE(closed_at_ms, ?1), closed_at_iso = COALESCE(closed_at_iso, ?2)
         WHERE session_id = ?3 AND status IN ('created', 'running', 'blocked', 'auto_resuming')",
        params![now, now_iso, session_id],
    )?;
    Ok(())
}

fn read_latest_active_work_run_id_from_conn(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<String>> {
    conn.query_row(
        "SELECT long_work_run_id
         FROM long_work_run
         WHERE session_id = ?1 AND status IN ('created', 'running', 'blocked', 'auto_resuming')
         ORDER BY updated_at_ms DESC, created_at_ms DESC
         LIMIT 1",
        params![session_id],
        |row| row.get(0),
    )
    .optional()
    .context("failed to read active work run id")
}

pub(super) fn read_latest_work_summary_from_conn(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<SessionTaskLedgerSummary>> {
    let row = conn
        .query_row(
            "SELECT long_work_run_id, session_id, runtime_turn_id, user_message_id, plan_id,
                    todo_list_id, execution_run_id, goal_id, status, objective_summary,
                    blocker_ids_json, current_slice_id, created_at_ms, updated_at_ms
             FROM long_work_run
             WHERE session_id = ?1
             ORDER BY updated_at_ms DESC, created_at_ms DESC
             LIMIT 1",
            params![session_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, Option<String>>(11)?,
                    row.get::<_, i64>(12)?,
                    row.get::<_, i64>(13)?,
                ))
            },
        )
        .optional()
        .context("failed to read work run summary")?;
    let Some((
        run_id,
        session_id,
        runtime_turn_id,
        user_message_id,
        plan_id,
        todo_list_id,
        execution_run_id,
        goal_id,
        status,
        objective_summary,
        blocker_ids_json,
        current_slice_id,
        created_at,
        updated_at,
    )) = row
    else {
        return Ok(None);
    };
    let items = read_todo_items_for_list(conn, &todo_list_id).unwrap_or_default();
    let blocker_ids = parse_json_vec_string(&blocker_ids_json);
    let current_slice = match current_slice_id.as_deref() {
        Some(slice_id) => read_work_slice_summary(conn, slice_id)?,
        None => None,
    };
    let continuation = read_latest_continuation_summary(conn, &run_id)?;
    let premature_stop = read_latest_premature_stop_summary(conn, &run_id)?;
    let stuck = read_latest_stuck_summary(conn, &run_id)?;
    Ok(Some(AgentLongWorkSummary {
        long_work_run_id: run_id,
        goal_id,
        session_id,
        runtime_turn_id,
        user_message_id,
        plan_id,
        todo_list_id,
        execution_run_id,
        status: status.clone(),
        objective_summary,
        todo_progress: progress_from_items(&items),
        blocker_summary: blocker_summary(&status, &items, &blocker_ids),
        current_slice,
        continuation,
        premature_stop,
        stuck,
        created_at,
        updated_at,
    }))
}

fn read_work_slice_summary(
    conn: &Connection,
    slice_id: &str,
) -> Result<Option<AgentWorkSliceSummary>> {
    conn.query_row(
        "SELECT work_slice_id, status, sequence, todo_list_id, execution_run_id, stop_cause,
                checkpoint_ids_json, blocker_ids_json, progress_delta_json, created_at_ms,
                updated_at_ms, closed_at_ms
         FROM work_slice
         WHERE work_slice_id = ?1",
        params![slice_id],
        |row| {
            let checkpoint_ids_json: String = row.get(6)?;
            let blocker_ids_json: String = row.get(7)?;
            let progress_delta_json: String = row.get(8)?;
            let progress_delta = serde_json::from_str(&progress_delta_json).ok();
            Ok(AgentWorkSliceSummary {
                work_slice_id: row.get(0)?,
                status: row.get(1)?,
                sequence: row.get(2)?,
                todo_list_id: row.get(3)?,
                execution_run_id: row.get(4)?,
                stop_cause: row.get(5)?,
                checkpoint_ids: parse_json_vec_string(&checkpoint_ids_json),
                blocker_ids: parse_json_vec_string(&blocker_ids_json),
                progress_delta,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                closed_at: row.get(11)?,
            })
        },
    )
    .optional()
    .context("failed to read work slice summary")
}
