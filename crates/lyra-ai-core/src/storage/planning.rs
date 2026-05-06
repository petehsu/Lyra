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
                     WHERE ps.session_id = ?1 AND ps.status != 'superseded'
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
                    "SELECT ps.active_version_id, ps.status, pr.panel_id, pr.status
                     FROM planning_session ps
                     JOIN plan_review_panel pr ON pr.planning_session_id = ps.planning_session_id
                        AND pr.plan_version_id = ps.active_version_id
                     WHERE ps.session_id = ?1 AND ps.planning_session_id = ?2",
                    params![session_id, plan_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                        ))
                    },
                )
                .optional()?;
            let Some((active_version_id, plan_status, panel_id, panel_status)) = current else {
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
