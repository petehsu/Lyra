use super::*;

impl AiStore {
    pub fn create_planning_session(
        &self,
        session_id: &str,
        turn_id: Option<&str>,
        title: &str,
        objective_summary: &str,
        source: Value,
        version: Value,
    ) -> Result<CreatedPlanRefs> {
        let title = title.trim();
        let objective_summary = objective_summary.trim();
        if title.is_empty() {
            return Err(anyhow!("plan title is required"));
        }
        if objective_summary.is_empty() {
            return Err(anyhow!("plan objectiveSummary is required"));
        }
        let plan_id = new_id("plan");
        let version_id = new_id("plan_version");
        let panel_id = new_id("plan_panel");
        let now = now_ms();
        let now_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "UPDATE planning_session
                 SET status = 'superseded', updated_at_ms = ?1, updated_at_iso = ?2
                 WHERE session_id = ?3 AND status NOT IN ('superseded', 'rejected')",
                params![now, now_iso, session_id],
            )?;
            conn.execute(
                "UPDATE plan_review_panel
                 SET status = 'superseded', updated_at_ms = ?1, updated_at_iso = ?2
                 WHERE session_id = ?3 AND status = 'pending_review'",
                params![now, now_iso, session_id],
            )?;
            conn.execute(
                "INSERT INTO planning_session (
                    planning_session_id, session_id, runtime_turn_id, status, title,
                    objective_summary, source_json, active_version_id, created_at_ms,
                    created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, 'pending_review', ?4, ?5, ?6, ?7, ?8, ?9, ?8, ?9)",
                params![
                    plan_id,
                    session_id,
                    turn_id,
                    title,
                    objective_summary,
                    source.to_string(),
                    version_id,
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO plan_version (
                    plan_version_id, planning_session_id, session_id, runtime_turn_id,
                    version_number, status, version_json, created_at_ms, created_at_iso,
                    updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, 1, 'pending_review', ?5, ?6, ?7, ?6, ?7)",
                params![
                    version_id,
                    plan_id,
                    session_id,
                    turn_id,
                    version.to_string(),
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO plan_review_panel (
                    panel_id, planning_session_id, plan_version_id, session_id,
                    runtime_turn_id, status, created_at_ms, created_at_iso,
                    updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'pending_review', ?6, ?7, ?6, ?7)",
                params![panel_id, plan_id, version_id, session_id, turn_id, now, now_iso,],
            )?;
            Ok(())
        })?;
        Ok(CreatedPlanRefs {
            plan_id,
            version_id,
            panel_id,
        })
    }

    pub fn read_planning_summary(&self, session_id: &str) -> Result<Option<AgentPlanningSummary>> {
        self.with_session_conn(session_id, |conn| {
            let row = conn
                .query_row(
                    "SELECT ps.planning_session_id, ps.session_id, ps.runtime_turn_id,
                            ps.status, ps.title, ps.objective_summary, ps.source_json,
                            ps.active_version_id, pr.panel_id, pr.status, pv.version_number,
                            pv.version_json, ps.created_at_ms, ps.updated_at_ms
                     FROM planning_session ps
                     JOIN plan_version pv ON pv.plan_version_id = ps.active_version_id
                     JOIN plan_review_panel pr ON pr.plan_version_id = pv.plan_version_id
                     WHERE ps.session_id = ?1
                       AND ps.status NOT IN ('superseded', 'superseded_by_rollback')
                     ORDER BY ps.updated_at_ms DESC, ps.created_at_ms DESC
                     LIMIT 1",
                    params![session_id],
                    |row| {
                        let source_json: String = row.get(6)?;
                        let version_json: String = row.get(11)?;
                        Ok(AgentPlanningSummary {
                            plan_id: row.get(0)?,
                            session_id: row.get(1)?,
                            runtime_turn_id: row.get(2)?,
                            status: row.get(3)?,
                            title: row.get(4)?,
                            objective_summary: row.get(5)?,
                            source: serde_json::from_str(&source_json)
                                .unwrap_or_else(|_| json!({})),
                            active_version_id: row.get(7)?,
                            panel_id: row.get(8)?,
                            panel_status: row.get(9)?,
                            version_number: row.get(10)?,
                            version: serde_json::from_str(&version_json)
                                .unwrap_or_else(|_| json!({})),
                            annotations: Vec::new(),
                            created_at: row.get(12)?,
                            updated_at: row.get(13)?,
                        })
                    },
                )
                .optional()?;
            let Some(mut summary) = row else {
                return Ok(None);
            };
            summary.annotations =
                read_plan_annotations(conn, &summary.panel_id, &summary.active_version_id)?;
            Ok(Some(summary))
        })
    }

    pub fn read_plan_coverage_summary(
        &self,
        session_id: &str,
    ) -> Result<Option<AgentPlanCoverageSummary>> {
        self.with_session_conn(session_id, |conn| {
            conn.query_row(
                "SELECT coverage_id, session_id, runtime_turn_id, plan_id, approved_version_id,
                        todo_list_id, execution_run_id, status, covered_plan_step_ids_json,
                        missing_plan_step_ids_json, extra_todo_item_ids_json,
                        risk_mismatches_json, verification_gaps_json, missing_reference_ids_json,
                        mismatched_reference_ids_json, created_at_ms, updated_at_ms
                 FROM plan_coverage_report
                 WHERE session_id = ?1
                   AND status != 'superseded_by_rollback'
                 ORDER BY updated_at_ms DESC, created_at_ms DESC
                 LIMIT 1",
                params![session_id],
                read_plan_coverage_row,
            )
            .optional()
            .context("failed to read plan coverage summary")
        })
    }

    pub fn resolve_plan_review(
        &self,
        session_id: &str,
        plan_id: &str,
        version_id: &str,
        decision: &str,
        annotation_text: Option<&str>,
    ) -> Result<AgentPlanningSummary> {
        let normalized = normalize_plan_review_decision(decision)?;
        let updated_at = now_ms();
        let updated_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            let current = conn
                .query_row(
                    "SELECT ps.active_version_id, ps.status, pr.panel_id, pr.status,
                            ps.runtime_turn_id, pv.version_json, ps.title
                     FROM planning_session ps
                     JOIN plan_review_panel pr ON pr.planning_session_id = ps.planning_session_id
                        AND pr.plan_version_id = ps.active_version_id
                     JOIN plan_version pv ON pv.plan_version_id = ps.active_version_id
                     WHERE ps.session_id = ?1 AND ps.planning_session_id = ?2",
                    params![session_id, plan_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, Option<String>>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, String>(6)?,
                        ))
                    },
                )
                .optional()?;
            let Some((
                active_version_id,
                plan_status,
                panel_id,
                panel_status,
                runtime_turn_id,
                version_json,
                plan_title,
            )) = current
            else {
                return Err(anyhow!("plan not found: {plan_id}"));
            };
            if active_version_id != version_id {
                return Err(anyhow!("plan version is stale: {version_id}"));
            }
            if plan_status == "superseded" {
                return Err(anyhow!("plan is superseded: {plan_id}"));
            }
            if panel_status != "pending_review" && normalized != "annotated" {
                return Err(anyhow!("plan review is not pending: {panel_status}"));
            }
            if normalized == "annotated" {
                let note = annotation_text.and_then(trim_to_string);
                let Some(note) = note else {
                    return Err(anyhow!("annotationText is required"));
                };
                conn.execute(
                    "INSERT INTO plan_review_annotation (
                        annotation_id, panel_id, planning_session_id, plan_version_id,
                        session_id, block_id, anchor, note, created_at_ms, created_at_iso,
                        updated_at_ms, updated_at_iso
                     ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'plan', ?6, ?7, ?8, ?7, ?8)",
                    params![
                        new_id("plan_annotation"),
                        panel_id,
                        plan_id,
                        version_id,
                        session_id,
                        note,
                        updated_at,
                        updated_iso,
                    ],
                )?;
                conn.execute(
                    "UPDATE planning_session
                     SET updated_at_ms = ?1, updated_at_iso = ?2
                     WHERE planning_session_id = ?3",
                    params![updated_at, updated_iso, plan_id],
                )?;
                conn.execute(
                    "UPDATE plan_review_panel
                     SET updated_at_ms = ?1, updated_at_iso = ?2
                     WHERE panel_id = ?3",
                    params![updated_at, updated_iso, panel_id],
                )?;
                return Ok(());
            }
            conn.execute(
                "UPDATE planning_session
                 SET status = ?1, updated_at_ms = ?2, updated_at_iso = ?3
                 WHERE planning_session_id = ?4",
                params![normalized, updated_at, updated_iso, plan_id],
            )?;
            conn.execute(
                "UPDATE plan_version
                 SET status = ?1, updated_at_ms = ?2, updated_at_iso = ?3
                 WHERE plan_version_id = ?4",
                params![normalized, updated_at, updated_iso, version_id],
            )?;
            conn.execute(
                "UPDATE plan_review_panel
                 SET status = ?1, updated_at_ms = ?2, updated_at_iso = ?3
                 WHERE panel_id = ?4",
                params![normalized, updated_at, updated_iso, panel_id],
            )?;
            if normalized == "approved" {
                let version: Value =
                    serde_json::from_str(&version_json).unwrap_or_else(|_| json!({}));
                create_plan_bound_todo_and_coverage(
                    conn,
                    session_id,
                    runtime_turn_id.as_deref(),
                    plan_id,
                    version_id,
                    &plan_title,
                    &version,
                    updated_at,
                    &updated_iso,
                )?;
            }
            Ok(())
        })?;
        self.read_planning_summary(session_id)?
            .ok_or_else(|| anyhow!("plan summary not found after review update"))
    }
}

fn normalize_plan_review_decision(decision: &str) -> Result<&'static str> {
    match decision.trim() {
        "approve" => Ok("approved"),
        "reject" => Ok("rejected"),
        "annotate" => Ok("annotated"),
        other => Err(anyhow!("unsupported plan review decision: {other}")),
    }
}

#[derive(Clone, Debug)]
struct PlanStepSeed {
    id: String,
    title: String,
    detail: Option<String>,
    actions: Vec<String>,
    expected_tools: Vec<String>,
    risk_level: String,
    risk_mismatch: bool,
    completion_criteria: Vec<String>,
    source_reference_ids: Vec<String>,
    source_reference_required: bool,
}

#[derive(Clone, Debug, Default)]
struct ReferenceSeed {
    ids: Vec<String>,
    required: bool,
}

#[derive(Clone, Debug)]
struct PlanCoverageSeed {
    status: &'static str,
    covered_plan_step_ids: Vec<String>,
    missing_plan_step_ids: Vec<String>,
    risk_mismatches: Vec<Value>,
    verification_gaps: Vec<String>,
    missing_reference_ids: Vec<String>,
    mismatched_reference_ids: Vec<String>,
    plan_reference_ids: Vec<String>,
}

impl PlanCoverageSeed {
    fn is_valid(&self) -> bool {
        self.status == "valid"
    }
}

fn create_plan_bound_todo_and_coverage(
    conn: &Connection,
    session_id: &str,
    turn_id: Option<&str>,
    plan_id: &str,
    version_id: &str,
    plan_title: &str,
    version: &Value,
    created_at: i64,
    created_iso: &str,
) -> Result<()> {
    let coverage_id = new_id("plan_coverage");
    let (steps, missing_plan_step_ids) = extract_plan_steps(version);
    let coverage = validate_plan_coverage(version, &steps, missing_plan_step_ids);
    if coverage.is_valid() == false {
        insert_plan_coverage_report(
            conn,
            &coverage_id,
            session_id,
            turn_id,
            plan_id,
            version_id,
            None,
            None,
            coverage.status,
            &coverage.covered_plan_step_ids,
            &coverage.missing_plan_step_ids,
            &[],
            &coverage.risk_mismatches,
            &coverage.verification_gaps,
            &coverage.missing_reference_ids,
            &coverage.mismatched_reference_ids,
            created_at,
            created_iso,
        )?;
        return Ok(());
    }

    let todo_list_id = new_id("todo_list");
    let execution_run_id = new_id("execution_run");
    conn.execute(
        "UPDATE execution_todo_list
         SET status = 'superseded', updated_at_ms = ?1, updated_at_iso = ?2
         WHERE session_id = ?3 AND status != 'superseded'",
        params![created_at, created_iso, session_id],
    )?;
    conn.execute(
        "INSERT INTO execution_todo_list (
            todo_list_id, session_id, runtime_turn_id, kind, status, source_json,
            title, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
         ) VALUES (?1, ?2, ?3, 'plan_bound', 'active', ?4, ?5, ?6, ?7, ?6, ?7)",
        params![
            todo_list_id,
            session_id,
            turn_id,
            json!({
                "type": "approved_plan",
                "planId": plan_id,
                "approvedVersionId": version_id,
                "coverageId": coverage_id,
                "sourceReferenceIds": coverage.plan_reference_ids,
            })
            .to_string(),
            format!("Plan: {}", plan_title.trim()),
            created_at,
            created_iso,
        ],
    )?;
    for step in &steps {
        conn.execute(
            "INSERT INTO todo_item (
                todo_item_id, todo_list_id, status, title, actions_json,
                expected_tools_json, risk_level, completion_criteria_json,
                evidence_refs_json, blockers_json, source_json, created_at_ms,
                created_at_iso, updated_at_ms, updated_at_iso
             ) VALUES (?1, ?2, 'pending', ?3, ?4, ?5, ?6, ?7, '[]', '[]', ?8, ?9, ?10, ?9, ?10)",
            params![
                new_id("todo_item"),
                todo_list_id,
                step.title,
                json_string(&step.actions)?,
                json_string(&step.expected_tools)?,
                normalize_risk_level(&step.risk_level),
                json_string(&step.completion_criteria)?,
                json!({
                    "type": "plan_step",
                    "planId": plan_id,
                    "approvedVersionId": version_id,
                    "planStepId": step.id,
                    "detail": step.detail,
                    "sourceReferenceIds": step.source_reference_ids,
                })
                .to_string(),
                created_at,
                created_iso,
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
            created_at,
            created_iso,
        ],
    )?;
    insert_plan_coverage_report(
        conn,
        &coverage_id,
        session_id,
        turn_id,
        plan_id,
        version_id,
        Some(&todo_list_id),
        Some(&execution_run_id),
        "valid",
        &coverage.covered_plan_step_ids,
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        created_at,
        created_iso,
    )
}

#[allow(clippy::too_many_arguments)]
fn insert_plan_coverage_report(
    conn: &Connection,
    coverage_id: &str,
    session_id: &str,
    turn_id: Option<&str>,
    plan_id: &str,
    version_id: &str,
    todo_list_id: Option<&str>,
    execution_run_id: Option<&str>,
    status: &str,
    covered_plan_step_ids: &[String],
    missing_plan_step_ids: &[String],
    extra_todo_item_ids: &[String],
    risk_mismatches: &[Value],
    verification_gaps: &[String],
    missing_reference_ids: &[String],
    mismatched_reference_ids: &[String],
    created_at: i64,
    created_iso: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO plan_coverage_report (
            coverage_id, session_id, runtime_turn_id, plan_id, approved_version_id,
            todo_list_id, execution_run_id, status, covered_plan_step_ids_json,
            missing_plan_step_ids_json, extra_todo_item_ids_json, risk_mismatches_json,
            verification_gaps_json, missing_reference_ids_json, mismatched_reference_ids_json,
            created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?16, ?17)",
        params![
            coverage_id,
            session_id,
            turn_id,
            plan_id,
            version_id,
            todo_list_id,
            execution_run_id,
            status,
            json_string(&covered_plan_step_ids)?,
            json_string(&missing_plan_step_ids)?,
            json_string(&extra_todo_item_ids)?,
            json_string(&risk_mismatches)?,
            json_string(&verification_gaps)?,
            json_string(&missing_reference_ids)?,
            json_string(&mismatched_reference_ids)?,
            created_at,
            created_iso,
        ],
    )?;
    Ok(())
}

fn validate_plan_coverage(
    version: &Value,
    steps: &[PlanStepSeed],
    missing_plan_step_ids: Vec<String>,
) -> PlanCoverageSeed {
    let plan_refs = read_reference_seed(version);
    let covered_plan_step_ids = steps.iter().map(|step| step.id.clone()).collect::<Vec<_>>();
    let mut risk_mismatches = Vec::new();
    let mut verification_gaps = Vec::new();
    let mut missing_reference_ids = Vec::new();
    let mismatched_reference_ids = Vec::new();
    if plan_refs.required && plan_refs.ids.is_empty() {
        missing_reference_ids.push("__plan_source_reference__".to_string());
    }
    for step in steps {
        if step.completion_criteria.is_empty() {
            verification_gaps.push(step.id.clone());
        }
        if step.risk_mismatch {
            risk_mismatches.push(json!({
                "planStepId": step.id,
                "todoItemId": null,
                "planRisk": step.risk_level,
                "todoRisk": normalize_risk_level(&step.risk_level),
            }));
        }
        if step.source_reference_required && step.source_reference_ids.is_empty() {
            missing_reference_ids.push(step.id.clone());
        }
    }
    let status = if missing_plan_step_ids.is_empty() == false || steps.is_empty() {
        "missing_plan_step"
    } else if missing_reference_ids.is_empty() == false {
        "reference_missing"
    } else if mismatched_reference_ids.is_empty() == false {
        "reference_mismatch"
    } else if verification_gaps.is_empty() == false {
        "verification_missing"
    } else if risk_mismatches.is_empty() == false {
        "risk_mismatch"
    } else {
        "valid"
    };
    PlanCoverageSeed {
        status,
        covered_plan_step_ids,
        missing_plan_step_ids,
        risk_mismatches,
        verification_gaps,
        missing_reference_ids,
        mismatched_reference_ids,
        plan_reference_ids: plan_refs.ids,
    }
}

fn extract_plan_steps(version: &Value) -> (Vec<PlanStepSeed>, Vec<String>) {
    let Some(raw_steps) = version.get("steps").and_then(Value::as_array) else {
        return (Vec::new(), vec!["__no_plan_steps__".to_string()]);
    };
    if raw_steps.is_empty() {
        return (Vec::new(), vec!["__no_plan_steps__".to_string()]);
    }
    let mut steps = Vec::new();
    let mut missing = Vec::new();
    for (index, raw_step) in raw_steps.iter().enumerate() {
        let step_id = raw_step
            .get("id")
            .and_then(Value::as_str)
            .and_then(trim_to_string)
            .unwrap_or_else(|| format!("step_{}", index + 1));
        let Some(title) = read_first_string(raw_step, &["title", "summary", "name"]) else {
            missing.push(step_id);
            continue;
        };
        let (risk_level, risk_mismatch) = read_risk_level(raw_step);
        let reference_seed = read_reference_seed(raw_step);
        steps.push(PlanStepSeed {
            id: step_id,
            title,
            detail: read_first_string(raw_step, &["detail", "body", "description"]),
            actions: read_first_string_list(raw_step, &["actions"]),
            expected_tools: read_first_string_list(raw_step, &["expectedTools", "expected_tools"]),
            risk_level,
            risk_mismatch,
            completion_criteria: read_completion_criteria(raw_step),
            source_reference_ids: reference_seed.ids,
            source_reference_required: reference_seed.required,
        });
    }
    (steps, missing)
}

fn read_completion_criteria(value: &Value) -> Vec<String> {
    let mut result = Vec::new();
    let sources = [
        "completionCriteria",
        "completion_criteria",
        "acceptanceCriteria",
        "acceptance_criteria",
        "verification",
        "verificationSteps",
        "verification_steps",
    ];
    for key in sources {
        if let Some(raw) = value.get(key) {
            for item in string_list_from_value(raw) {
                if result.iter().any(|existing| existing == &item) == false {
                    result.push(item);
                }
            }
        }
    }
    result
}

fn read_risk_level(value: &Value) -> (String, bool) {
    let raw = read_first_string(value, &["riskLevel", "risk_level"]).or_else(|| {
        value
            .get("risk")
            .and_then(|risk| {
                if risk.is_object() {
                    risk.get("level").and_then(Value::as_str)
                } else {
                    risk.as_str()
                }
            })
            .and_then(trim_to_string)
    });
    let Some(raw) = raw else {
        return ("medium".to_string(), false);
    };
    let normalized = normalize_risk_level(&raw).to_string();
    (raw.clone(), normalized != raw.trim())
}

fn read_reference_seed(value: &Value) -> ReferenceSeed {
    let mut seed = ReferenceSeed::default();
    for key in ["sourceReferenceIds", "source_reference_ids", "referenceIds"] {
        if let Some(raw) = value.get(key) {
            seed.required = true;
            for item in string_list_from_value(raw) {
                if seed.ids.iter().any(|existing| existing == &item) == false {
                    seed.ids.push(item);
                }
            }
        }
    }
    seed
}

fn string_list_from_value(value: &Value) -> Vec<String> {
    if let Some(value) = value.as_str().and_then(trim_to_string) {
        return vec![value];
    }
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .filter_map(trim_to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn read_first_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(Value::as_str)
            .and_then(trim_to_string)
    })
}

fn read_first_string_list(value: &Value, keys: &[&str]) -> Vec<String> {
    keys.iter()
        .find_map(|key| value.get(*key).map(string_list_from_value))
        .unwrap_or_default()
}

fn read_plan_coverage_row(row: &Row<'_>) -> rusqlite::Result<AgentPlanCoverageSummary> {
    let covered_json: String = row.get(8)?;
    let missing_json: String = row.get(9)?;
    let extra_json: String = row.get(10)?;
    let risk_json: String = row.get(11)?;
    let verification_json: String = row.get(12)?;
    let missing_refs_json: String = row.get(13)?;
    let mismatched_refs_json: String = row.get(14)?;
    Ok(AgentPlanCoverageSummary {
        coverage_id: row.get(0)?,
        session_id: row.get(1)?,
        runtime_turn_id: row.get(2)?,
        plan_id: row.get(3)?,
        approved_version_id: row.get(4)?,
        todo_list_id: row.get(5)?,
        execution_run_id: row.get(6)?,
        status: row.get(7)?,
        covered_plan_step_ids: parse_json_vec_string(&covered_json),
        missing_plan_step_ids: parse_json_vec_string(&missing_json),
        extra_todo_item_ids: parse_json_vec_string(&extra_json),
        risk_mismatches: parse_json_vec_value(&risk_json),
        verification_gaps: parse_json_vec_string(&verification_json),
        missing_reference_ids: parse_json_vec_string(&missing_refs_json),
        mismatched_reference_ids: parse_json_vec_string(&mismatched_refs_json),
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
    })
}

fn read_plan_annotations(
    conn: &Connection,
    panel_id: &str,
    version_id: &str,
) -> Result<Vec<AgentPlanReviewAnnotation>> {
    let mut stmt = conn.prepare(
        "SELECT annotation_id, panel_id, block_id, anchor, note, created_at_ms, updated_at_ms
         FROM plan_review_annotation
         WHERE panel_id = ?1 AND plan_version_id = ?2
         ORDER BY created_at_ms ASC",
    )?;
    let rows = stmt.query_map(params![panel_id, version_id], |row| {
        Ok(AgentPlanReviewAnnotation {
            annotation_id: row.get(0)?,
            panel_id: row.get(1)?,
            block_id: row.get(2)?,
            anchor: row.get(3)?,
            note: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}
