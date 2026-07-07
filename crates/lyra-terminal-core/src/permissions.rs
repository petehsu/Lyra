use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalPermissionRisk {
    None,
    Low,
    Shell,
    Dangerous,
    Sensitive,
}

impl TerminalPermissionRisk {
    pub fn requires_approval(self) -> bool {
        !matches!(self, TerminalPermissionRisk::None)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalPermissionDecision {
    Allow,
    Deny,
    NeedsApproval,
    Expired,
    Revoked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalPermissionScopeKind {
    OneShot,
    Session,
    TimeLimited,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalPermissionScope {
    pub kind: TerminalPermissionScopeKind,
    pub session_id: Option<String>,
    pub expires_at_ms: Option<i64>,
    pub summary: Option<String>,
}

impl TerminalPermissionScope {
    pub fn one_shot(session_id: impl Into<String>) -> Self {
        Self {
            kind: TerminalPermissionScopeKind::OneShot,
            session_id: Some(session_id.into()),
            expires_at_ms: None,
            summary: Some("one-shot approval".to_string()),
        }
    }

    pub fn session(session_id: impl Into<String>) -> Self {
        Self {
            kind: TerminalPermissionScopeKind::Session,
            session_id: Some(session_id.into()),
            expires_at_ms: None,
            summary: Some("terminal session approval".to_string()),
        }
    }

    pub fn time_limited(session_id: impl Into<String>, expires_at_ms: i64) -> Self {
        Self {
            kind: TerminalPermissionScopeKind::TimeLimited,
            session_id: Some(session_id.into()),
            expires_at_ms: Some(expires_at_ms),
            summary: Some("time-limited approval".to_string()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionEvaluationRequest {
    pub session_id: String,
    pub input_id: String,
    pub action: String,
    pub risk: TerminalPermissionRisk,
    pub redacted_preview: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
    pub now_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionResponse {
    pub permission_id: String,
    pub session_id: String,
    pub input_id: String,
    pub action: String,
    pub decision: TerminalPermissionDecision,
    pub risk: TerminalPermissionRisk,
    pub scope: TerminalPermissionScope,
    pub reason: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
    pub now_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRecord {
    pub permission_id: String,
    pub session_id: String,
    pub input_id: String,
    pub action: String,
    pub decision: TerminalPermissionDecision,
    pub risk: TerminalPermissionRisk,
    pub scope: TerminalPermissionScope,
    pub reason: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
    pub created_at_ms: i64,
    pub consumed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionEventKind {
    PermissionRequested,
    PermissionGranted,
    PermissionDenied,
    PermissionExpired,
    PermissionRevoked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionEvent {
    pub kind: PermissionEventKind,
    pub permission_id: String,
    pub input_id: String,
    pub terminal_session_id: String,
    pub action: String,
    pub decision: TerminalPermissionDecision,
    pub risk: TerminalPermissionRisk,
    pub reason: Option<String>,
    pub scope_summary: Option<String>,
    pub redacted_preview: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionEvaluation {
    pub permission_id: Option<String>,
    pub decision: TerminalPermissionDecision,
    pub risk: TerminalPermissionRisk,
    pub scope: Option<TerminalPermissionScope>,
    pub reason: Option<String>,
    pub recoverable: bool,
    pub event: Option<PermissionEvent>,
}

#[derive(Debug, Default, Clone)]
pub struct PermissionPolicyEngine {
    records: Vec<PermissionRecord>,
}

impl PermissionPolicyEngine {
    pub fn new() -> Self {
        Self { records: Vec::new() }
    }

    pub fn records(&self) -> &[PermissionRecord] {
        &self.records
    }

    pub fn evaluate(&mut self, request: &PermissionEvaluationRequest) -> PermissionEvaluation {
        if !request.risk.requires_approval() {
            return PermissionEvaluation {
                permission_id: None,
                decision: TerminalPermissionDecision::Allow,
                risk: request.risk,
                scope: None,
                reason: Some("risk does not require approval".to_string()),
                recoverable: false,
                event: None,
            };
        }

        let mut expired: Option<PermissionRecord> = None;
        for index in (0..self.records.len()).rev() {
            let record = self.records[index].clone();
            if !record_matches(&record, request) {
                continue;
            }
            if is_expired(&record, request.now_ms) {
                expired = Some(record);
                continue;
            }
            match record.decision {
                TerminalPermissionDecision::Allow => {
                    if record.scope.kind == TerminalPermissionScopeKind::OneShot {
                        self.records[index].consumed = true;
                    }
                    return PermissionEvaluation {
                        permission_id: Some(record.permission_id.clone()),
                        decision: TerminalPermissionDecision::Allow,
                        risk: record.risk,
                        scope: Some(record.scope.clone()),
                        reason: record.reason.clone(),
                        recoverable: false,
                        event: None,
                    };
                }
                TerminalPermissionDecision::Deny => {
                    return self.denial_evaluation(
                        request,
                        record,
                        TerminalPermissionDecision::Deny,
                        "matching deny scope",
                    );
                }
                TerminalPermissionDecision::Revoked => {
                    return self.denial_evaluation(
                        request,
                        record,
                        TerminalPermissionDecision::Revoked,
                        "matching revoked scope",
                    );
                }
                TerminalPermissionDecision::NeedsApproval | TerminalPermissionDecision::Expired => {}
            }
        }

        if let Some(record) = expired {
            return PermissionEvaluation {
                permission_id: Some(record.permission_id.clone()),
                decision: TerminalPermissionDecision::Expired,
                risk: request.risk,
                scope: Some(record.scope.clone()),
                reason: Some("matching approval expired".to_string()),
                recoverable: true,
                event: Some(permission_event(
                    PermissionEventKind::PermissionExpired,
                    &record.permission_id,
                    request,
                    TerminalPermissionDecision::Expired,
                    record.scope.summary.clone(),
                    Some("matching approval expired".to_string()),
                )),
            };
        }

        let permission_id = next_permission_id();
        let scope = TerminalPermissionScope::one_shot(request.session_id.clone());
        PermissionEvaluation {
            permission_id: Some(permission_id.clone()),
            decision: TerminalPermissionDecision::NeedsApproval,
            risk: request.risk,
            scope: Some(scope.clone()),
            reason: Some("semantic terminal action requires approval".to_string()),
            recoverable: true,
            event: Some(permission_event(
                PermissionEventKind::PermissionRequested,
                &permission_id,
                request,
                TerminalPermissionDecision::NeedsApproval,
                scope.summary,
                Some("semantic terminal action requires approval".to_string()),
            )),
        }
    }

    pub fn respond(&mut self, response: PermissionResponse) -> PermissionEvent {
        let event_kind = match response.decision {
            TerminalPermissionDecision::Allow => PermissionEventKind::PermissionGranted,
            TerminalPermissionDecision::Deny => PermissionEventKind::PermissionDenied,
            TerminalPermissionDecision::Revoked => PermissionEventKind::PermissionRevoked,
            TerminalPermissionDecision::Expired => PermissionEventKind::PermissionExpired,
            TerminalPermissionDecision::NeedsApproval => PermissionEventKind::PermissionRequested,
        };
        let record = PermissionRecord {
            permission_id: response.permission_id.clone(),
            session_id: response.session_id.clone(),
            input_id: response.input_id.clone(),
            action: response.action.clone(),
            decision: response.decision,
            risk: response.risk,
            scope: response.scope.clone(),
            reason: response.reason.clone(),
            actor_json: response.actor_json.clone(),
            correlation_json: response.correlation_json.clone(),
            created_at_ms: response.now_ms,
            consumed: false,
        };
        self.records.push(record);
        PermissionEvent {
            kind: event_kind,
            permission_id: response.permission_id,
            input_id: response.input_id,
            terminal_session_id: response.session_id,
            action: response.action,
            decision: response.decision,
            risk: response.risk,
            reason: response.reason,
            scope_summary: response.scope.summary,
            redacted_preview: None,
            actor_json: response.actor_json,
            correlation_json: response.correlation_json,
            created_at_ms: response.now_ms,
        }
    }

    pub fn grant(
        &mut self,
        evaluation: &PermissionEvaluation,
        request: &PermissionEvaluationRequest,
        scope: TerminalPermissionScope,
    ) -> PermissionEvent {
        self.respond(PermissionResponse {
            permission_id: evaluation.permission_id.clone().unwrap_or_else(next_permission_id),
            session_id: request.session_id.clone(),
            input_id: request.input_id.clone(),
            action: request.action.clone(),
            decision: TerminalPermissionDecision::Allow,
            risk: request.risk,
            scope,
            reason: Some("approved".to_string()),
            actor_json: request.actor_json.clone(),
            correlation_json: request.correlation_json.clone(),
            now_ms: request.now_ms,
        })
    }

    pub fn deny(
        &mut self,
        evaluation: &PermissionEvaluation,
        request: &PermissionEvaluationRequest,
        scope: TerminalPermissionScope,
    ) -> PermissionEvent {
        self.respond(PermissionResponse {
            permission_id: evaluation.permission_id.clone().unwrap_or_else(next_permission_id),
            session_id: request.session_id.clone(),
            input_id: request.input_id.clone(),
            action: request.action.clone(),
            decision: TerminalPermissionDecision::Deny,
            risk: request.risk,
            scope,
            reason: Some("denied".to_string()),
            actor_json: request.actor_json.clone(),
            correlation_json: request.correlation_json.clone(),
            now_ms: request.now_ms,
        })
    }

    pub fn revoke(
        &mut self,
        request: &PermissionEvaluationRequest,
        permission_id: impl Into<String>,
        scope: TerminalPermissionScope,
    ) -> PermissionEvent {
        self.respond(PermissionResponse {
            permission_id: permission_id.into(),
            session_id: request.session_id.clone(),
            input_id: request.input_id.clone(),
            action: request.action.clone(),
            decision: TerminalPermissionDecision::Revoked,
            risk: request.risk,
            scope,
            reason: Some("revoked".to_string()),
            actor_json: request.actor_json.clone(),
            correlation_json: request.correlation_json.clone(),
            now_ms: request.now_ms,
        })
    }

    fn denial_evaluation(
        &self,
        request: &PermissionEvaluationRequest,
        record: PermissionRecord,
        decision: TerminalPermissionDecision,
        reason: &str,
    ) -> PermissionEvaluation {
        let event_kind = if decision == TerminalPermissionDecision::Revoked {
            PermissionEventKind::PermissionRevoked
        } else {
            PermissionEventKind::PermissionDenied
        };
        PermissionEvaluation {
            permission_id: Some(record.permission_id.clone()),
            decision,
            risk: record.risk,
            scope: Some(record.scope.clone()),
            reason: Some(reason.to_string()),
            recoverable: true,
            event: Some(permission_event(
                event_kind,
                &record.permission_id,
                request,
                decision,
                record.scope.summary.clone(),
                Some(reason.to_string()),
            )),
        }
    }
}

pub fn next_permission_id() -> String {
    format!("terminal-permission-{}", Uuid::new_v4())
}

fn permission_event(
    kind: PermissionEventKind,
    permission_id: &str,
    request: &PermissionEvaluationRequest,
    decision: TerminalPermissionDecision,
    scope_summary: Option<String>,
    reason: Option<String>,
) -> PermissionEvent {
    PermissionEvent {
        kind,
        permission_id: permission_id.to_string(),
        input_id: request.input_id.clone(),
        terminal_session_id: request.session_id.clone(),
        action: request.action.clone(),
        decision,
        risk: request.risk,
        reason,
        scope_summary,
        redacted_preview: request.redacted_preview.clone(),
        actor_json: request.actor_json.clone(),
        correlation_json: request.correlation_json.clone(),
        created_at_ms: request.now_ms,
    }
}

fn record_matches(record: &PermissionRecord, request: &PermissionEvaluationRequest) -> bool {
    if record.action != request.action {
        return false;
    }
    if let Some(session_id) = record.scope.session_id.as_deref() {
        if session_id != request.session_id {
            return false;
        }
    }
    if record.scope.kind == TerminalPermissionScopeKind::OneShot
        && (record.input_id != request.input_id || record.consumed)
    {
        return false;
    }
    matches!(
        record.scope.kind,
        TerminalPermissionScopeKind::OneShot | TerminalPermissionScopeKind::Session | TerminalPermissionScopeKind::TimeLimited
    )
}

fn is_expired(record: &PermissionRecord, now_ms: i64) -> bool {
    record
        .scope
        .expires_at_ms
        .is_some_and(|expires_at_ms| now_ms >= expires_at_ms)
}