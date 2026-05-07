use super::*;

pub(super) fn find_execution_run_for_turn(
    conn: &Connection,
    session_id: &str,
    turn_id: &str,
) -> Result<Option<(String, String)>> {
    let exact = conn
        .query_row(
            "SELECT r.execution_run_id, r.todo_list_id
         FROM execution_run r
         JOIN execution_todo_list t ON t.todo_list_id = r.todo_list_id
         WHERE r.session_id = ?1
           AND t.status != 'superseded'
           AND t.status != 'superseded_by_rollback'
           AND (r.runtime_turn_id = ?2 OR ?2 = '')
         ORDER BY r.updated_at_ms DESC, r.created_at_ms DESC
         LIMIT 1",
            params![session_id, turn_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .context("failed to find execution run for turn")?;
    if exact.is_some() {
        return Ok(exact);
    }
    conn.query_row(
        "SELECT r.execution_run_id, r.todo_list_id
         FROM execution_run r
         JOIN execution_todo_list t ON t.todo_list_id = r.todo_list_id
         WHERE r.session_id = ?1
           AND t.status NOT IN ('superseded', 'superseded_by_rollback')
         ORDER BY r.updated_at_ms DESC, r.created_at_ms DESC
         LIMIT 1",
        params![session_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .context("failed to find latest execution run")
}

pub(super) fn find_todo_item_for_tool(
    conn: &Connection,
    todo_list_id: &str,
    tool_path: &str,
) -> Result<Option<AgentTodoItem>> {
    let items = read_todo_items_for_list(conn, todo_list_id)?;
    let normalized_tool = tool_path.trim();
    Ok(items
        .into_iter()
        .filter(|item| {
            item.expected_tools
                .iter()
                .any(|tool| tool.trim() == normalized_tool)
        })
        .min_by_key(|item| todo_status_priority(&item.status)))
}

pub(super) fn find_execution_step_for_item(
    conn: &Connection,
    execution_run_id: &str,
    todo_item_id: &str,
) -> Result<Option<String>> {
    conn.query_row(
        "SELECT execution_step_id
         FROM execution_step
         WHERE execution_run_id = ?1 AND todo_item_id = ?2
         ORDER BY updated_at_ms DESC, created_at_ms DESC
         LIMIT 1",
        params![execution_run_id, todo_item_id],
        |row| row.get(0),
    )
    .optional()
    .context("failed to find execution step")
}

pub(super) fn step_exists(conn: &Connection, execution_step_id: &str) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM execution_step WHERE execution_step_id = ?1",
        params![execution_step_id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

pub(super) fn read_step_string_refs(
    conn: &Connection,
    execution_step_id: &str,
    column: &str,
) -> Result<Vec<String>> {
    let json_value: String = conn.query_row(
        &format!("SELECT {column} FROM execution_step WHERE execution_step_id = ?1"),
        params![execution_step_id],
        |row| row.get(0),
    )?;
    Ok(parse_json_vec_string(&json_value))
}

pub(super) fn read_step_string_refs_or_empty(
    conn: &Connection,
    execution_step_id: &str,
    column: &str,
) -> Result<Vec<String>> {
    if step_exists(conn, execution_step_id)? {
        read_step_string_refs(conn, execution_step_id, column)
    } else {
        Ok(Vec::new())
    }
}

pub(super) fn append_execution_run_step(
    conn: &Connection,
    execution_run_id: &str,
    execution_step_id: &str,
) -> Result<()> {
    let step_ids_json: String = conn.query_row(
        "SELECT step_ids_json FROM execution_run WHERE execution_run_id = ?1",
        params![execution_run_id],
        |row| row.get(0),
    )?;
    let mut step_ids = parse_json_vec_string(&step_ids_json);
    if step_ids.iter().any(|id| id == execution_step_id) == false {
        step_ids.push(execution_step_id.to_string());
    }
    conn.execute(
        "UPDATE execution_run SET step_ids_json = ?1 WHERE execution_run_id = ?2",
        params![json_string(&step_ids)?, execution_run_id],
    )?;
    Ok(())
}

pub(super) fn compute_todo_list_status(conn: &Connection, todo_list_id: &str) -> Result<String> {
    let mut stmt = conn.prepare("SELECT status FROM todo_item WHERE todo_list_id = ?1")?;
    let rows = stmt.query_map(params![todo_list_id], |row| row.get::<_, String>(0))?;
    let mut statuses = Vec::new();
    for row in rows {
        statuses.push(row?);
    }
    if statuses.iter().any(|status| status == "failed") {
        return Ok("failed".to_string());
    }
    if statuses.iter().any(|status| status == "blocked") {
        return Ok("blocked".to_string());
    }
    if statuses.is_empty() == false
        && statuses
            .iter()
            .all(|status| matches!(status.as_str(), "completed" | "skipped"))
    {
        return Ok("completed".to_string());
    }
    Ok("active".to_string())
}

pub(super) fn compute_execution_run_status(
    conn: &Connection,
    execution_run_id: &str,
) -> Result<String> {
    let mut stmt = conn.prepare("SELECT status FROM execution_step WHERE execution_run_id = ?1")?;
    let rows = stmt.query_map(params![execution_run_id], |row| row.get::<_, String>(0))?;
    let mut statuses = Vec::new();
    for row in rows {
        statuses.push(row?);
    }
    if statuses.iter().any(|status| status == "failed") {
        return Ok("failed".to_string());
    }
    if statuses.iter().any(|status| status == "blocked") {
        return Ok("blocked".to_string());
    }
    if statuses.is_empty() == false
        && statuses
            .iter()
            .all(|status| matches!(status.as_str(), "completed" | "skipped"))
    {
        return Ok("completed".to_string());
    }
    Ok("running".to_string())
}

pub(super) fn read_execution_step_counts(
    conn: &Connection,
    execution_run_id: &str,
) -> Result<(i64, i64, i64, i64)> {
    let mut stmt = conn.prepare(
        "SELECT status, COUNT(*)
         FROM execution_step
         WHERE execution_run_id = ?1
         GROUP BY status",
    )?;
    let rows = stmt.query_map(params![execution_run_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    let mut total = 0_i64;
    let mut completed = 0_i64;
    let mut failed = 0_i64;
    let mut blocked = 0_i64;
    for row in rows {
        let (status, count) = row?;
        total += count;
        match status.as_str() {
            "completed" => completed += count,
            "failed" => failed += count,
            "blocked" => blocked += count,
            _ => {}
        }
    }
    Ok((total, completed, failed, blocked))
}
