mod classifier;
mod decision;
pub mod projection;
pub mod redaction;
pub mod types;

use crate::model_gateway::ChatMessage;
use crate::project_policy::EffectivePolicy;
use crate::storage::{
    sha256_hex, AiStore, CreateRedactedProjectionRecordInput, CreateSecretDetectionReportInput,
    CreateSecurityDecisionRecordInput,
};
use crate::tool_runtime::operation::{ToolFsOp, ToolOperationEnvelope, ToolResultEnvelope};
use anyhow::Result;
use serde_json::json;
use types::SecurityGateOutcome;

#[allow(dead_code)]
pub const PROJECT_MANIFEST_INVALID: &str = "PROJECT_MANIFEST_INVALID";
#[allow(dead_code)]
pub const PROJECT_POLICY_DENIED: &str = "PROJECT_POLICY_DENIED";
#[allow(dead_code)]
pub const PROJECT_POLICY_UNSUPPORTED: &str = "PROJECT_POLICY_UNSUPPORTED";
pub const SECURITY_RESOURCE_DENIED: &str = "SECURITY_RESOURCE_DENIED";
pub const SECURITY_REDACTION_REQUIRED: &str = "SECURITY_REDACTION_REQUIRED";
pub const SECURITY_SECRET_DETECTED: &str = "SECURITY_SECRET_DETECTED";
#[allow(dead_code)]
pub const SECURITY_MODEL_INPUT_BLOCKED: &str = "SECURITY_MODEL_INPUT_BLOCKED";
#[allow(dead_code)]
pub const SECURITY_EXFILTRATION_DENIED: &str = "SECURITY_EXFILTRATION_DENIED";

pub fn record_path_decision(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    snapshot_id: Option<&str>,
    policy: &EffectivePolicy,
    resource_ref: &str,
) -> Result<Option<SecurityGateOutcome>> {
    let Some((decision, reason_codes, risk_level)) =
        decision::sensitive_path_decision(resource_ref, policy)
    else {
        return Ok(None);
    };
    let redaction_applied = decision == "allow_redacted";
    let record = store.create_security_decision_record(CreateSecurityDecisionRecordInput {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        operation_id: None,
        snapshot_id: snapshot_id.map(ToString::to_string),
        resource_kind: "file".to_string(),
        resource_ref: resource_ref.to_string(),
        decision,
        reason_codes,
        risk_level,
        redaction_applied,
        approval_ticket_id: None,
        evidence_refs: Vec::new(),
    })?;
    Ok(Some(SecurityGateOutcome {
        decision_id: Some(record.decision_id),
        decision: record.decision,
        reason_codes: record.reason_codes,
        risk_level: record.risk_level,
        redaction_applied,
        report_id: None,
        redacted_content: None,
    }))
}

pub fn record_tool_decision(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    snapshot_id: Option<&str>,
    policy: &EffectivePolicy,
    operation: &ToolOperationEnvelope,
) -> Result<SecurityGateOutcome> {
    let normalized_path = operation.path.trim().to_string();
    let (decision, reason_codes, risk_level) = decision::tool_decision(&normalized_path, policy)
        .unwrap_or_else(|| {
            if operation.op == ToolFsOp::Run {
                (
                    "allow".to_string(),
                    vec!["tool_allowed_by_effective_policy".to_string()],
                    "low".to_string(),
                )
            } else {
                (
                    "allow".to_string(),
                    vec!["tool_metadata_operation".to_string()],
                    "low".to_string(),
                )
            }
        });
    let record = store.create_security_decision_record(CreateSecurityDecisionRecordInput {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        operation_id: Some(operation.op_id.clone()),
        snapshot_id: snapshot_id.map(ToString::to_string),
        resource_kind: "tool".to_string(),
        resource_ref: normalized_path,
        decision,
        reason_codes,
        risk_level,
        redaction_applied: false,
        approval_ticket_id: None,
        evidence_refs: Vec::new(),
    })?;
    Ok(SecurityGateOutcome {
        decision_id: Some(record.decision_id),
        decision: record.decision,
        reason_codes: record.reason_codes,
        risk_level: record.risk_level,
        redaction_applied: false,
        report_id: None,
        redacted_content: None,
    })
}

pub fn scan_and_record_text(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    snapshot_id: Option<&str>,
    resource_kind: &str,
    resource_ref: &str,
    content: &str,
    redaction_profile: &str,
) -> Result<SecurityGateOutcome> {
    let report = redaction::detect_and_redact(content);
    if report.findings.is_empty() {
        let record = store.create_security_decision_record(CreateSecurityDecisionRecordInput {
            session_id: session_id.to_string(),
            turn_id: turn_id.to_string(),
            operation_id: None,
            snapshot_id: snapshot_id.map(ToString::to_string),
            resource_kind: resource_kind.to_string(),
            resource_ref: resource_ref.to_string(),
            decision: "allow".to_string(),
            reason_codes: vec!["no_secret_findings".to_string()],
            risk_level: "low".to_string(),
            redaction_applied: false,
            approval_ticket_id: None,
            evidence_refs: Vec::new(),
        })?;
        return Ok(SecurityGateOutcome {
            decision_id: Some(record.decision_id),
            decision: record.decision,
            reason_codes: record.reason_codes,
            risk_level: record.risk_level,
            redaction_applied: false,
            report_id: None,
            redacted_content: None,
        });
    }
    let findings_json = report
        .findings
        .iter()
        .map(|finding| finding.to_json())
        .collect::<Vec<_>>();
    let detection = store.create_secret_detection_report(CreateSecretDetectionReportInput {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        resource_kind: resource_kind.to_string(),
        resource_ref: resource_ref.to_string(),
        status: "active".to_string(),
        findings: findings_json,
        redacted_preview: Some(report.redacted.chars().take(240).collect()),
    })?;
    let record = store.create_security_decision_record(CreateSecurityDecisionRecordInput {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        operation_id: None,
        snapshot_id: snapshot_id.map(ToString::to_string),
        resource_kind: resource_kind.to_string(),
        resource_ref: resource_ref.to_string(),
        decision: "allow_redacted".to_string(),
        reason_codes: vec![
            SECURITY_SECRET_DETECTED.to_string(),
            SECURITY_REDACTION_REQUIRED.to_string(),
        ],
        risk_level: "high".to_string(),
        redaction_applied: true,
        approval_ticket_id: None,
        evidence_refs: vec![detection.report_id.clone()],
    })?;
    store.create_redacted_projection_record(CreateRedactedProjectionRecordInput {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        source_kind: resource_kind.to_string(),
        source_ref: resource_ref.to_string(),
        projection_kind: "model_input".to_string(),
        redaction_profile: redaction_profile.to_string(),
        content_hash: sha256_hex(content.as_bytes()),
        redacted_ref: detection.report_id.clone(),
        decision_id: Some(record.decision_id.clone()),
    })?;
    Ok(SecurityGateOutcome {
        decision_id: Some(record.decision_id),
        decision: record.decision,
        reason_codes: record.reason_codes,
        risk_level: record.risk_level,
        redaction_applied: true,
        report_id: Some(detection.report_id),
        redacted_content: Some(report.redacted),
    })
}

pub fn redact_tool_result_if_needed(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    snapshot_id: Option<&str>,
    result: &mut ToolResultEnvelope,
    redaction_profile: &str,
) -> Result<Option<SecurityGateOutcome>> {
    let outcome = scan_and_record_text(
        store,
        session_id,
        turn_id,
        snapshot_id,
        "tool_result",
        &result.op_id,
        &result.content,
        redaction_profile,
    )?;
    if let Some(redacted) = outcome.redacted_content.as_ref() {
        result.content = redacted.clone();
        result.metadata.get_or_insert_with(|| json!({}));
        if let Some(metadata) = result
            .metadata
            .as_mut()
            .and_then(|value| value.as_object_mut())
        {
            metadata.insert("redactionApplied".to_string(), json!(true));
            if let Some(decision_id) = outcome.decision_id.as_ref() {
                metadata.insert("securityDecisionId".to_string(), json!(decision_id));
            }
            if let Some(report_id) = outcome.report_id.as_ref() {
                metadata.insert("secretDetectionReportId".to_string(), json!(report_id));
            }
        }
        return Ok(Some(outcome));
    }
    Ok(None)
}

pub fn redact_model_messages_for_turn(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    snapshot_id: Option<&str>,
    messages: &mut [ChatMessage],
    redaction_profile: &str,
) -> Result<Vec<SecurityGateOutcome>> {
    let mut outcomes = Vec::new();
    for (index, message) in messages.iter_mut().enumerate() {
        let probe = redaction::detect_and_redact(&message.content);
        if probe.findings.is_empty() {
            continue;
        }
        let outcome = scan_and_record_text(
            store,
            session_id,
            turn_id,
            snapshot_id,
            "model_input",
            &format!("message:{index}:{}", message.role),
            &message.content,
            redaction_profile,
        )?;
        if let Some(redacted) = outcome.redacted_content.clone() {
            message.content = redacted;
        }
        if outcome.redaction_applied {
            outcomes.push(outcome);
        }
    }
    Ok(outcomes)
}

pub fn security_event_payload(outcome: &SecurityGateOutcome) -> serde_json::Value {
    json!({
        "decisionId": outcome.decision_id,
        "decision": outcome.decision,
        "reasonCodes": outcome.reason_codes,
        "riskLevel": outcome.risk_level,
        "redactionApplied": outcome.redaction_applied,
        "reportId": outcome.report_id,
    })
}
