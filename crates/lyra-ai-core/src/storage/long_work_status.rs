use super::*;

const ACTIVE_WORK_STATUSES: &[&str] = &["created", "running", "blocked", "auto_resuming"];

pub(super) fn decide_status_from_conn(
    conn: &Connection,
    session_id: &str,
    run_id: &str,
    turn_id: Option<&str>,
) -> Result<Option<LongWorkStatusUpdate>> {
    let row = conn
        .query_row(
            "SELECT todo_list_id, execution_run_id, status, checkpoint_ids_json, blocker_ids_json
             FROM long_work_run
             WHERE session_id = ?1 AND long_work_run_id = ?2",
            params![session_id, run_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()?;
    let Some((todo_list_id, execution_run_id, current_status, checkpoint_json, blocker_json)) = row
    else {
        return Ok(None);
    };
    if ACTIVE_WORK_STATUSES
        .iter()
        .any(|status| *status == current_status)
        == false
    {
        return Ok(None);
    }
    let items = read_todo_items_for_list(conn, &todo_list_id)?;
    let audit = read_completion_audit_for_execution(conn, session_id, &execution_run_id, turn_id)?;
    let mut blocker_ids = blocker_ids_from_items(&items);
    if let Some(audit) = audit.as_ref() {
        blocker_ids = merge_string_refs(&blocker_ids, &audit.blocker_ids);
    }
    let pending_approval_ticket_ids = audit
        .as_ref()
        .map(|audit| value_string_array(&audit.summary, "pendingApprovalTicketIds"))
        .unwrap_or_default();
    let blocked_verification_run_ids = audit
        .as_ref()
        .map(|audit| value_string_array(&audit.summary, "blockedVerificationRunIds"))
        .unwrap_or_default();
    let status = if items.is_empty() {
        "blocked"
    } else if audit
        .as_ref()
        .map(|audit| audit.status.as_str() == "passed")
        .unwrap_or(false)
        && todo_items_are_done(&items)
    {
        "completed"
    } else if approval_related_blocker(&items)
        || pending_approval_ticket_ids.is_empty() == false
        || blocked_verification_run_ids.is_empty() == false
    {
        "blocked"
    } else if items.iter().any(|item| item.status == "blocked") {
        "blocked"
    } else {
        "running"
    };
    let checkpoint_ids = parse_json_vec_string(&checkpoint_json);
    let previous_blocker_ids = parse_json_vec_string(&blocker_json);
    if status == current_status && previous_blocker_ids == blocker_ids {
        return Ok(None);
    }
    Ok(Some(LongWorkStatusUpdate {
        status: status.to_string(),
        checkpoint_ids,
        blocker_ids,
    }))
}

pub(super) fn update_work_status_in_conn(
    conn: &Connection,
    run_id: &str,
    update: &LongWorkStatusUpdate,
    now: i64,
    now_iso: &str,
) -> Result<()> {
    let closed = matches!(
        update.status.as_str(),
        "blocked" | "completed" | "failed" | "cancelled" | "stuck"
    );
    conn.execute(
        "UPDATE long_work_run
         SET status = ?1, checkpoint_ids_json = ?2, blocker_ids_json = ?3,
             updated_at_ms = ?4, updated_at_iso = ?5
         WHERE long_work_run_id = ?6",
        params![
            update.status,
            json_string(&update.checkpoint_ids)?,
            json_string(&update.blocker_ids)?,
            now,
            now_iso,
            run_id,
        ],
    )?;
    conn.execute(
        "UPDATE native_long_work_goal
         SET status = ?1, updated_at_ms = ?2, updated_at_iso = ?3
         WHERE goal_id = (SELECT goal_id FROM long_work_run WHERE long_work_run_id = ?4)",
        params![update.status, now, now_iso, run_id],
    )?;
    conn.execute(
        "UPDATE work_slice
         SET status = ?1, checkpoint_ids_json = ?2, blocker_ids_json = ?3,
             updated_at_ms = ?4, updated_at_iso = ?5,
             closed_at_ms = CASE WHEN ?6 THEN COALESCE(closed_at_ms, ?4) ELSE closed_at_ms END,
             closed_at_iso = CASE WHEN ?6 THEN COALESCE(closed_at_iso, ?5) ELSE closed_at_iso END
         WHERE work_slice_id = (SELECT current_slice_id FROM long_work_run WHERE long_work_run_id = ?7)",
        params![
            update.status,
            json_string(&update.checkpoint_ids)?,
            json_string(&update.blocker_ids)?,
            now,
            now_iso,
            closed,
            run_id,
        ],
    )?;
    Ok(())
}

pub(super) struct LongWorkAuditStatus {
    pub status: String,
    pub blocker_ids: Vec<String>,
    pub summary: Value,
}

pub(super) fn read_completion_audit_for_execution(
    conn: &Connection,
    session_id: &str,
    execution_run_id: &str,
    turn_id: Option<&str>,
) -> Result<Option<LongWorkAuditStatus>> {
    let row = conn
        .query_row(
            "SELECT completion_audit_id, status, summary_json
             FROM completion_audit
             WHERE session_id = ?1
                AND execution_run_id = ?2
                AND (?3 IS NULL OR runtime_turn_id = ?3)
             ORDER BY updated_at_ms DESC, created_at_ms DESC
             LIMIT 1",
            params![session_id, execution_run_id, turn_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((audit_id, status, summary_json)) = row else {
        return Ok(None);
    };
    let summary: Value = serde_json::from_str(&summary_json).unwrap_or_else(|_| json!({}));
    let mut blocker_ids = Vec::new();
    for key in [
        "missingTodoItemIds",
        "failedTodoItemIds",
        "blockedTodoItemIds",
        "failedVerificationRunIds",
        "blockedVerificationRunIds",
        "notRunVerificationRunIds",
        "pendingApprovalTicketIds",
    ] {
        blocker_ids = merge_string_refs(&blocker_ids, &value_string_array(&summary, key));
    }
    if blocker_ids.is_empty() == false {
        blocker_ids.insert(0, audit_id);
    }
    Ok(Some(LongWorkAuditStatus {
        status,
        blocker_ids,
        summary,
    }))
}

pub(super) fn progress_from_items(items: &[AgentTodoItem]) -> AgentLongWorkTodoProgress {
    AgentLongWorkTodoProgress {
        total: items.len() as i64,
        completed: items
            .iter()
            .filter(|item| matches!(item.status.as_str(), "completed" | "skipped"))
            .count() as i64,
        blocked: items.iter().filter(|item| item.status == "blocked").count() as i64,
        failed: items.iter().filter(|item| item.status == "failed").count() as i64,
    }
}

pub(super) fn todo_items_are_done(items: &[AgentTodoItem]) -> bool {
    items
        .iter()
        .all(|item| matches!(item.status.as_str(), "completed" | "skipped"))
}

pub(super) fn blocker_ids_from_items(items: &[AgentTodoItem]) -> Vec<String> {
    items
        .iter()
        .filter(|item| matches!(item.status.as_str(), "blocked" | "failed"))
        .map(|item| item.todo_item_id.clone())
        .collect()
}

pub(super) fn approval_related_blocker(items: &[AgentTodoItem]) -> bool {
    items.iter().any(|item| {
        blocker_entries(&item.blockers)
            .iter()
            .any(is_approval_blocker)
    })
}

fn is_approval_blocker(blocker: &Value) -> bool {
    matches!(
        blocker.get("kind").and_then(Value::as_str),
        Some("approval_required" | "approval_denied")
    )
}

fn blocker_entries(value: &Value) -> Vec<Value> {
    if let Some(items) = value.as_array() {
        return items.clone();
    }
    if value.is_object() {
        return vec![value.clone()];
    }
    Vec::new()
}

pub(super) fn blocker_summary(
    status: &str,
    items: &[AgentTodoItem],
    blocker_ids: &[String],
) -> Option<String> {
    if status == "blocked" {
        if approval_related_blocker(items) {
            return Some("Waiting for approval decision".to_string());
        }
        if blocker_ids.is_empty() == false {
            return Some(format!(
                "{} blocker{}",
                blocker_ids.len(),
                plural(blocker_ids.len())
            ));
        }
        return Some("Blocked by incomplete execution state".to_string());
    }
    if status == "failed" {
        return Some("Failed tool or verification result".to_string());
    }
    if status == "stuck" {
        return Some("Stuck after repeated continuation attempts".to_string());
    }
    None
}

fn plural(count: usize) -> &'static str {
    if count == 1 {
        ""
    } else {
        "s"
    }
}
