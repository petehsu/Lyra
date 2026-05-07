use super::*;

impl AiStore {
    pub fn create_execution_todo_list(
        &self,
        session_id: &str,
        turn_id: Option<&str>,
        kind: &str,
        title: &str,
        source: Value,
        items: &[CreateTodoItemInput],
    ) -> Result<CreatedTodoRefs> {
        if items.is_empty() {
            return Err(anyhow!("todo items are required"));
        }
        let todo_list_id = new_id("todo_list");
        let execution_run_id = new_id("execution_run");
        let now = now_ms();
        let now_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "UPDATE execution_todo_list
                 SET status = 'superseded', updated_at_ms = ?1, updated_at_iso = ?2
                 WHERE session_id = ?3 AND status != 'superseded'",
                params![now, now_iso, session_id],
            )?;
            conn.execute(
                "INSERT INTO execution_todo_list (
                    todo_list_id, session_id, runtime_turn_id, kind, status, source_json,
                    title, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6, ?7, ?8, ?7, ?8)",
                params![
                    todo_list_id,
                    session_id,
                    turn_id,
                    normalize_todo_kind(kind),
                    source.to_string(),
                    title.trim(),
                    now,
                    now_iso,
                ],
            )?;
            for item in items {
                let todo_item_id = new_id("todo_item");
                conn.execute(
                    "INSERT INTO todo_item (
                        todo_item_id, todo_list_id, status, title, actions_json,
                        expected_tools_json, risk_level, completion_criteria_json,
                        evidence_refs_json, blockers_json, source_json, created_at_ms,
                        created_at_iso, updated_at_ms, updated_at_iso
                     ) VALUES (?1, ?2, 'pending', ?3, ?4, ?5, ?6, ?7, '[]', '[]', ?8, ?9, ?10, ?9, ?10)",
                    params![
                        todo_item_id,
                        todo_list_id,
                        item.title.trim(),
                        json_string(&item.actions)?,
                        json_string(&item.expected_tools)?,
                        normalize_risk_level(&item.risk_level),
                        json_string(&item.completion_criteria)?,
                        item.source.to_string(),
                        now,
                        now_iso,
                    ],
                )?;
            }
            conn.execute(
                "INSERT INTO execution_run (
                    execution_run_id, session_id, runtime_turn_id, todo_list_id, status,
                    step_ids_json, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, 'running', '[]', ?5, ?6, ?5, ?6)",
                params![
                    execution_run_id,
                    session_id,
                    turn_id,
                    todo_list_id,
                    now,
                    now_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(CreatedTodoRefs {
            todo_list_id,
            execution_run_id,
        })
    }

    pub fn read_active_todo_list(
        &self,
        session_id: &str,
    ) -> Result<Option<AgentExecutionTodoList>> {
        self.with_session_conn(session_id, |conn| {
            let row = conn
                .query_row(
                    "SELECT todo_list_id, session_id, runtime_turn_id, kind, status,
                            title, source_json, created_at_ms, updated_at_ms
                     FROM execution_todo_list
                     WHERE session_id = ?1 AND status NOT IN ('superseded', 'superseded_by_rollback')
                     ORDER BY updated_at_ms DESC, created_at_ms DESC
                     LIMIT 1",
                    params![session_id],
                    read_todo_list_row,
                )
                .optional()?;
            let Some(mut todo) = row else {
                return Ok(None);
            };
            todo.items = read_todo_items_for_list(conn, &todo.todo_list_id)?;
            Ok(Some(todo))
        })
    }

    pub fn read_execution_summary(
        &self,
        session_id: &str,
    ) -> Result<Option<AgentExecutionSummary>> {
        self.with_session_conn(session_id, |conn| {
            let row = conn
                .query_row(
                    "SELECT execution_run_id, session_id, runtime_turn_id, todo_list_id,
                        status, updated_at_ms
                 FROM execution_run
                 WHERE session_id = ?1
                   AND status != 'superseded_by_rollback'
                 ORDER BY updated_at_ms DESC, created_at_ms DESC
                 LIMIT 1",
                    params![session_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, i64>(5)?,
                        ))
                    },
                )
                .optional()
                .context("failed to read execution summary")?;
            let Some((
                execution_run_id,
                session_id,
                runtime_turn_id,
                todo_list_id,
                status,
                updated_at,
            )) = row
            else {
                return Ok(None);
            };
            let counts = read_execution_step_counts(conn, &execution_run_id)?;
            Ok(Some(AgentExecutionSummary {
                execution_run_id,
                session_id,
                runtime_turn_id,
                todo_list_id,
                status,
                step_count: counts.0,
                completed_step_count: counts.1,
                failed_step_count: counts.2,
                blocked_step_count: counts.3,
                updated_at,
            }))
        })
    }

    pub fn record_tool_execution_step(
        &self,
        session_id: &str,
        turn_id: &str,
        tool_path: &str,
        op_id: &str,
        item_status: &str,
        step_status: &str,
        evidence_refs: Vec<String>,
        artifact_refs: Vec<String>,
        blocker: Value,
    ) -> Result<Option<TodoUpdateRecord>> {
        let updated_at = now_ms();
        let updated_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            let Some((execution_run_id, todo_list_id)) =
                find_execution_run_for_turn(conn, session_id, turn_id)?
            else {
                return Ok(None);
            };
            let Some(mut item) = find_todo_item_for_tool(conn, &todo_list_id, tool_path)? else {
                return Ok(None);
            };
            let merged_evidence_refs = merge_string_refs(&item.evidence_refs, &evidence_refs);
            let merged_blockers = merge_todo_blocker_json(&item.blockers, &blocker);
            conn.execute(
                "UPDATE todo_item
                 SET status = ?1, evidence_refs_json = ?2, blockers_json = ?3,
                     updated_at_ms = ?4, updated_at_iso = ?5
                 WHERE todo_item_id = ?6",
                params![
                    normalize_todo_status(item_status),
                    json_string(&merged_evidence_refs)?,
                    merged_blockers.to_string(),
                    updated_at,
                    updated_iso,
                    item.todo_item_id,
                ],
            )?;
            item.status = normalize_todo_status(item_status).to_string();
            item.evidence_refs = merged_evidence_refs;
            item.blockers = merged_blockers.clone();

            let existing_step =
                find_execution_step_for_item(conn, &execution_run_id, &item.todo_item_id)?;
            let execution_step_id = existing_step.unwrap_or_else(|| new_id("execution_step"));
            let mut tool_operation_ids = if step_exists(conn, &execution_step_id)? {
                read_step_string_refs(conn, &execution_step_id, "tool_operation_ids_json")?
            } else {
                Vec::new()
            };
            if tool_operation_ids.iter().any(|id| id == op_id) == false {
                tool_operation_ids.push(op_id.to_string());
            }
            let step_evidence_refs = merge_string_refs(
                &read_step_string_refs_or_empty(conn, &execution_step_id, "evidence_refs_json")?,
                &evidence_refs,
            );
            let step_artifact_refs = merge_string_refs(
                &read_step_string_refs_or_empty(conn, &execution_step_id, "artifact_refs_json")?,
                &artifact_refs,
            );
            if step_exists(conn, &execution_step_id)? {
                conn.execute(
                    "UPDATE execution_step
                     SET status = ?1, tool_operation_ids_json = ?2, evidence_refs_json = ?3,
                         artifact_refs_json = ?4, blocker_json = ?5,
                         updated_at_ms = ?6, updated_at_iso = ?7
                     WHERE execution_step_id = ?8",
                    params![
                        normalize_todo_status(step_status),
                        json_string(&tool_operation_ids)?,
                        json_string(&step_evidence_refs)?,
                        json_string(&step_artifact_refs)?,
                        if blocker.is_null() {
                            None::<String>
                        } else {
                            Some(blocker.to_string())
                        },
                        updated_at,
                        updated_iso,
                        execution_step_id,
                    ],
                )?;
            } else {
                conn.execute(
                    "INSERT INTO execution_step (
                        execution_step_id, execution_run_id, todo_item_id, kind, status,
                        tool_operation_ids_json, evidence_refs_json, artifact_refs_json,
                        skip_reason, blocker_json, created_at_ms, created_at_iso,
                        updated_at_ms, updated_at_iso
                     ) VALUES (?1, ?2, ?3, 'tool', ?4, ?5, ?6, ?7, NULL, ?8, ?9, ?10, ?9, ?10)",
                    params![
                        execution_step_id,
                        execution_run_id,
                        item.todo_item_id,
                        normalize_todo_status(step_status),
                        json_string(&tool_operation_ids)?,
                        json_string(&step_evidence_refs)?,
                        json_string(&step_artifact_refs)?,
                        if blocker.is_null() {
                            None::<String>
                        } else {
                            Some(blocker.to_string())
                        },
                        updated_at,
                        updated_iso,
                    ],
                )?;
                append_execution_run_step(conn, &execution_run_id, &execution_step_id)?;
            }

            let list_status = compute_todo_list_status(conn, &todo_list_id)?;
            let run_status = compute_execution_run_status(conn, &execution_run_id)?;
            conn.execute(
                "UPDATE execution_todo_list
                 SET status = ?1, updated_at_ms = ?2, updated_at_iso = ?3
                 WHERE todo_list_id = ?4",
                params![list_status, updated_at, updated_iso, todo_list_id],
            )?;
            conn.execute(
                "UPDATE execution_run
                 SET status = ?1, updated_at_ms = ?2, updated_at_iso = ?3
                 WHERE execution_run_id = ?4",
                params![run_status, updated_at, updated_iso, execution_run_id],
            )?;

            Ok(Some(TodoUpdateRecord {
                todo_list_id,
                todo_item_id: Some(item.todo_item_id),
                execution_run_id,
                execution_step_id,
                status: normalize_todo_status(item_status).to_string(),
                step_status: normalize_todo_status(step_status).to_string(),
                title: Some(item.title),
                evidence_refs: step_evidence_refs,
                artifact_refs: step_artifact_refs,
                blocker,
            }))
        })
    }
}
