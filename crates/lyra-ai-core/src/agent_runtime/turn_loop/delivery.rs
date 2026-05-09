use super::*;

pub(super) fn complete_turn_without_visible_message(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    usage: Option<Usage>,
) -> Result<()> {
    store.update_turn_status(session_id, turn_id, "completed", "completed", None, None)?;
    let detail = store.read_session_detail(session_id)?;
    emit_store_event(
        store,
        session_id,
        Some(turn_id),
        "runtime_turn_completed",
        json!({
            "turnId": turn_id,
            "usage": usage,
            "outputSuppressed": true,
            "detail": detail
        }),
    )?;
    if let Some(mut session) = store.read_session_index(session_id)? {
        session.updated_at = now_ms();
        store.upsert_session_index(&session)?;
    }
    if let Some(detail) = store.read_session_detail(session_id)? {
        emit_store_event(
            store,
            session_id,
            None,
            "session_updated",
            json!({ "detail": detail }),
        )?;
    }
    Ok(())
}

pub(super) fn emit_security_summary_updated(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    detail: Option<&AgentSessionDetail>,
) -> Result<()> {
    let Some(summary) = detail.and_then(|detail| detail.security_summary.as_ref()) else {
        return Ok(());
    };
    let decision_ids = summary
        .recent_decisions
        .iter()
        .map(|decision| decision.decision_id.clone())
        .collect::<Vec<_>>();
    let reason_codes = summary
        .recent_decisions
        .iter()
        .flat_map(|decision| decision.reason_codes.clone())
        .collect::<Vec<_>>();
    emit_store_event(
        store,
        session_id,
        Some(turn_id),
        "security_summary_updated",
        json!({
            "sessionId": session_id,
            "turnId": turn_id,
            "snapshotId": summary.snapshot_id.clone(),
            "status": summary.status.clone(),
            "decisionIds": decision_ids,
            "reasonCodes": reason_codes,
            "secretFindings": summary.secret_findings.clone(),
        }),
    )
}
