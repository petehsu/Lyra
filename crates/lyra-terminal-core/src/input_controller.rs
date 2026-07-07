use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::permissions::{
    PermissionEvaluationRequest, PermissionEvent, PermissionEventKind, PermissionPolicyEngine,
    TerminalPermissionDecision, TerminalPermissionRisk,
};
use crate::sensitive_input::{
    bracketed_paste_payload, redacted_preview, secret_ref_preview, SecretRef, SensitiveText,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SemanticInputAction {
    RunCommand,
    SubmitInput,
    PasteText,
    PressKeys,
    SendSignal,
    Resize,
}

impl SemanticInputAction {
    pub fn as_contract_name(self) -> &'static str {
        match self {
            SemanticInputAction::RunCommand => "runCommand",
            SemanticInputAction::SubmitInput => "submitInput",
            SemanticInputAction::PasteText => "pasteText",
            SemanticInputAction::PressKeys => "pressKeys",
            SemanticInputAction::SendSignal => "sendSignal",
            SemanticInputAction::Resize => "resize",
        }
    }

    pub fn default_risk(self, has_sensitive_input: bool) -> TerminalPermissionRisk {
        if has_sensitive_input {
            return TerminalPermissionRisk::Sensitive;
        }
        match self {
            SemanticInputAction::RunCommand => TerminalPermissionRisk::Shell,
            SemanticInputAction::SubmitInput
            | SemanticInputAction::PasteText
            | SemanticInputAction::PressKeys
            | SemanticInputAction::Resize => TerminalPermissionRisk::Low,
            SemanticInputAction::SendSignal => TerminalPermissionRisk::Dangerous,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStroke {
    pub key: String,
    pub repeat: u16,
    pub delay_ms: Option<u64>,
}

impl KeyStroke {
    pub fn new(key: impl Into<String>) -> Self {
        Self { key: key.into(), repeat: 1, delay_ms: None }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticInputRequest {
    pub session_id: String,
    pub input_id: Option<String>,
    pub action: SemanticInputAction,
    pub command: Option<String>,
    pub text: Option<String>,
    pub keys: Vec<KeyStroke>,
    pub secret_refs: Vec<SecretRef>,
    pub bracketed_paste: bool,
    pub signal: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub reason: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
    pub now_ms: i64,
}

impl SemanticInputRequest {
    pub fn run_command(
        session_id: impl Into<String>,
        command: impl Into<String>,
        now_ms: i64,
    ) -> Self {
        Self {
            session_id: session_id.into(),
            input_id: None,
            action: SemanticInputAction::RunCommand,
            command: Some(command.into()),
            text: None,
            keys: Vec::new(),
            secret_refs: Vec::new(),
            bracketed_paste: false,
            signal: None,
            cols: None,
            rows: None,
            reason: None,
            actor_json: None,
            correlation_json: None,
            now_ms,
        }
    }

    pub fn press_keys(session_id: impl Into<String>, keys: Vec<KeyStroke>, now_ms: i64) -> Self {
        Self {
            session_id: session_id.into(),
            input_id: None,
            action: SemanticInputAction::PressKeys,
            command: None,
            text: None,
            keys,
            secret_refs: Vec::new(),
            bracketed_paste: false,
            signal: None,
            cols: None,
            rows: None,
            reason: None,
            actor_json: None,
            correlation_json: None,
            now_ms,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlannedTerminalOperation {
    WriteBytes { bytes: Vec<u8>, redacted_preview: String },
    PasteSecretRefs { secret_refs: Vec<SecretRef>, bracketed_paste: bool, redacted_preview: String },
    SendSignal { signal: String, reason: Option<String> },
    Resize { cols: u16, rows: u16 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InputExecutionStatus {
    NeedsApproval,
    Expanded,
    Denied,
    Expired,
    Revoked,
    InvalidRequest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInputEvent {
    pub kind: String,
    pub input_id: String,
    pub permission_id: Option<String>,
    pub terminal_session_id: String,
    pub action: SemanticInputAction,
    pub risk: TerminalPermissionRisk,
    pub redacted_preview: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
    pub payload: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputExecutionResult {
    pub session_id: String,
    pub input_id: String,
    pub permission_id: Option<String>,
    pub action: SemanticInputAction,
    pub status: InputExecutionStatus,
    pub risk: TerminalPermissionRisk,
    pub operations: Vec<PlannedTerminalOperation>,
    pub events: Vec<TerminalInputEvent>,
    pub permission_event: Option<PermissionEvent>,
}

#[derive(Debug, Default)]
pub struct InputController {
    permissions: PermissionPolicyEngine,
}

impl InputController {
    pub fn new() -> Self {
        Self { permissions: PermissionPolicyEngine::new() }
    }

    pub fn permissions_mut(&mut self) -> &mut PermissionPolicyEngine {
        &mut self.permissions
    }

    pub fn plan(&mut self, request: SemanticInputRequest) -> InputExecutionResult {
        let input_id = request
            .input_id
            .clone()
            .unwrap_or_else(|| format!("terminal-input-{}", Uuid::new_v4()));
        let sensitive = SensitiveText {
            plaintext: request.text.clone().or_else(|| request.command.clone()),
            secret_refs: request.secret_refs.clone(),
        };
        let preview = action_preview(&request, &sensitive);
        let risk = request.action.default_risk(!request.secret_refs.is_empty());
        let mut events = vec![input_event(
            "input_intent",
            &input_id,
            None,
            &request,
            risk,
            Some(preview.clone()),
            json!({ "reason": request.reason }),
        )];

        let permission_request = PermissionEvaluationRequest {
            session_id: request.session_id.clone(),
            input_id: input_id.clone(),
            action: request.action.as_contract_name().to_string(),
            risk,
            redacted_preview: Some(preview.clone()),
            actor_json: request.actor_json.clone(),
            correlation_json: request.correlation_json.clone(),
            now_ms: request.now_ms,
        };
        let evaluation = self.permissions.evaluate(&permission_request);
        if let Some(permission_event) = evaluation.event.clone() {
            events.push(permission_event_to_input_event(&permission_event, &request));
        }

        match evaluation.decision {
            TerminalPermissionDecision::Allow => match expand_request(&request, &preview) {
                Ok(operations) => {
                    events.push(input_event(
                        "input_expanded",
                        &input_id,
                        evaluation.permission_id.as_deref(),
                        &request,
                        risk,
                        Some(preview.clone()),
                        json!({
                            "operationCount": operations.len(),
                            "secretRefCount": request.secret_refs.len()
                        }),
                    ));
                    InputExecutionResult {
                        session_id: request.session_id,
                        input_id,
                        permission_id: evaluation.permission_id,
                        action: request.action,
                        status: InputExecutionStatus::Expanded,
                        risk,
                        operations,
                        events,
                        permission_event: evaluation.event,
                    }
                }
                Err(reason) => rejected_result(
                    request, input_id, evaluation.permission_id, risk,
                    InputExecutionStatus::InvalidRequest, preview, reason, events, evaluation.event,
                ),
            },
            TerminalPermissionDecision::NeedsApproval => InputExecutionResult {
                session_id: request.session_id,
                input_id,
                permission_id: evaluation.permission_id,
                action: request.action,
                status: InputExecutionStatus::NeedsApproval,
                risk,
                operations: Vec::new(),
                events,
                permission_event: evaluation.event,
            },
            TerminalPermissionDecision::Deny => rejected_result(
                request, input_id, evaluation.permission_id, risk,
                InputExecutionStatus::Denied, preview,
                evaluation.reason.unwrap_or_else(|| "denied".to_string()),
                events, evaluation.event,
            ),
            TerminalPermissionDecision::Expired => rejected_result(
                request, input_id, evaluation.permission_id, risk,
                InputExecutionStatus::Expired, preview,
                evaluation.reason.unwrap_or_else(|| "approval expired".to_string()),
                events, evaluation.event,
            ),
            TerminalPermissionDecision::Revoked => rejected_result(
                request, input_id, evaluation.permission_id, risk,
                InputExecutionStatus::Revoked, preview,
                evaluation.reason.unwrap_or_else(|| "approval revoked".to_string()),
                events, evaluation.event,
            ),
        }
    }
}

pub fn expand_key_stroke(stroke: &KeyStroke) -> Result<Vec<u8>, String> {
    let repeat = stroke.repeat.max(1);
    let bytes = key_bytes(&stroke.key)?;
    let mut output = Vec::with_capacity(bytes.len() * usize::from(repeat));
    for _ in 0..repeat {
        output.extend_from_slice(&bytes);
    }
    Ok(output)
}

fn rejected_result(
    request: SemanticInputRequest,
    input_id: String,
    permission_id: Option<String>,
    risk: TerminalPermissionRisk,
    status: InputExecutionStatus,
    preview: String,
    reason: String,
    mut events: Vec<TerminalInputEvent>,
    permission_event: Option<PermissionEvent>,
) -> InputExecutionResult {
    events.push(input_event(
        "input_rejected", &input_id, permission_id.as_deref(),
        &request, risk, Some(preview), json!({ "reason": reason }),
    ));
    InputExecutionResult {
        session_id: request.session_id, input_id, permission_id,
        action: request.action, status, risk, operations: Vec::new(),
        events, permission_event,
    }
}

fn expand_request(
    request: &SemanticInputRequest,
    preview: &str,
) -> Result<Vec<PlannedTerminalOperation>, String> {
    match request.action {
        SemanticInputAction::RunCommand => {
            let command = required_text(request.command.as_deref(), "runCommand requires command")?;
            Ok(vec![PlannedTerminalOperation::WriteBytes {
                bytes: format!("{command}\n").into_bytes(),
                redacted_preview: preview.to_string(),
            }])
        }
        SemanticInputAction::SubmitInput => {
            let text = required_text(request.text.as_deref(), "submitInput requires text")?;
            Ok(vec![PlannedTerminalOperation::WriteBytes {
                bytes: format!("{text}\n").into_bytes(),
                redacted_preview: preview.to_string(),
            }])
        }
        SemanticInputAction::PasteText => {
            if !request.secret_refs.is_empty() && request.text.is_none() {
                return Ok(vec![PlannedTerminalOperation::PasteSecretRefs {
                    secret_refs: request.secret_refs.clone(),
                    bracketed_paste: request.bracketed_paste,
                    redacted_preview: preview.to_string(),
                }]);
            }
            let text = required_text(request.text.as_deref(), "pasteText requires text or secret refs")?;
            let payload = if request.bracketed_paste {
                bracketed_paste_payload(text)
            } else {
                text.to_string()
            };
            Ok(vec![PlannedTerminalOperation::WriteBytes {
                bytes: payload.into_bytes(),
                redacted_preview: preview.to_string(),
            }])
        }
        SemanticInputAction::PressKeys => {
            if request.keys.is_empty() {
                return Err("pressKeys requires at least one key".to_string());
            }
            let mut bytes = Vec::new();
            for key in &request.keys {
                bytes.extend_from_slice(&expand_key_stroke(key)?);
            }
            Ok(vec![PlannedTerminalOperation::WriteBytes {
                bytes,
                redacted_preview: preview.to_string(),
            }])
        }
        SemanticInputAction::SendSignal => Ok(vec![PlannedTerminalOperation::SendSignal {
            signal: required_text(request.signal.as_deref(), "sendSignal requires signal")?.to_string(),
            reason: request.reason.clone(),
        }]),
        SemanticInputAction::Resize => Ok(vec![PlannedTerminalOperation::Resize {
            cols: request.cols.ok_or_else(|| "resize requires cols".to_string())?,
            rows: request.rows.ok_or_else(|| "resize requires rows".to_string())?,
        }]),
    }
}

fn action_preview(request: &SemanticInputRequest, sensitive: &SensitiveText) -> String {
    if !request.secret_refs.is_empty() {
        return secret_ref_preview(&request.secret_refs);
    }
    match request.action {
        SemanticInputAction::RunCommand => request.command.clone().unwrap_or_default(),
        SemanticInputAction::SubmitInput | SemanticInputAction::PasteText => {
            if request.action == SemanticInputAction::PasteText {
                redacted_preview(sensitive)
            } else {
                request.text.clone().unwrap_or_default()
            }
        }
        SemanticInputAction::PressKeys => request
            .keys
            .iter()
            .map(|key| key.key.clone())
            .collect::<Vec<_>>()
            .join(" "),
        SemanticInputAction::SendSignal => request.signal.clone().unwrap_or_default(),
        SemanticInputAction::Resize => format!(
            "{}x{}",
            request.cols.unwrap_or_default(),
            request.rows.unwrap_or_default()
        ),
    }
}

fn input_event(
    kind: &str,
    input_id: &str,
    permission_id: Option<&str>,
    request: &SemanticInputRequest,
    risk: TerminalPermissionRisk,
    redacted_preview: Option<String>,
    payload: Value,
) -> TerminalInputEvent {
    TerminalInputEvent {
        kind: kind.to_string(),
        input_id: input_id.to_string(),
        permission_id: permission_id.map(str::to_string),
        terminal_session_id: request.session_id.clone(),
        action: request.action,
        risk,
        redacted_preview,
        actor_json: request.actor_json.clone(),
        correlation_json: request.correlation_json.clone(),
        payload,
    }
}

fn permission_event_to_input_event(
    event: &PermissionEvent,
    request: &SemanticInputRequest,
) -> TerminalInputEvent {
    let kind = match event.kind {
        PermissionEventKind::PermissionRequested => "permission_requested",
        PermissionEventKind::PermissionGranted => "permission_granted",
        PermissionEventKind::PermissionDenied => "permission_denied",
        PermissionEventKind::PermissionExpired => "permission_expired",
        PermissionEventKind::PermissionRevoked => "permission_revoked",
    };
    TerminalInputEvent {
        kind: kind.to_string(),
        input_id: event.input_id.clone(),
        permission_id: Some(event.permission_id.clone()),
        terminal_session_id: event.terminal_session_id.clone(),
        action: request.action,
        risk: event.risk,
        redacted_preview: event.redacted_preview.clone(),
        actor_json: event.actor_json.clone(),
        correlation_json: event.correlation_json.clone(),
        payload: json!({
            "decision": event.decision,
            "reason": event.reason,
            "scopeSummary": event.scope_summary
        }),
    }
}

fn required_text<'a>(value: Option<&'a str>, message: &str) -> Result<&'a str, String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| message.to_string())
}

fn key_bytes(key: &str) -> Result<Vec<u8>, String> {
    let normalized = key.trim().to_ascii_lowercase();
    if normalized.len() == 1 {
        return Ok(normalized.into_bytes());
    }
    if let Some(rest) = normalized.strip_prefix("ctrl_").or_else(|| normalized.strip_prefix("ctrl+")) {
        return ctrl_key(rest);
    }
    if let Some(rest) = normalized.strip_prefix("alt_").or_else(|| normalized.strip_prefix("alt+")) {
        let mut bytes = vec![0x1b];
        bytes.extend_from_slice(&key_bytes(rest)?);
        return Ok(bytes);
    }
    if let Some(rest) = normalized.strip_prefix("meta_").or_else(|| normalized.strip_prefix("meta+")) {
        let mut bytes = vec![0x1b];
        bytes.extend_from_slice(&key_bytes(rest)?);
        return Ok(bytes);
    }
    match normalized.as_str() {
        "enter" | "return" => Ok(b"\r".to_vec()),
        "escape" | "esc" => Ok(vec![0x1b]),
        "tab" => Ok(b"\t".to_vec()),
        "backspace" => Ok(vec![0x7f]),
        "delete" => Ok(b"\x1b[3~".to_vec()),
        "up" => Ok(b"\x1b[A".to_vec()),
        "down" => Ok(b"\x1b[B".to_vec()),
        "right" => Ok(b"\x1b[C".to_vec()),
        "left" => Ok(b"\x1b[D".to_vec()),
        "home" => Ok(b"\x1b[H".to_vec()),
        "end" => Ok(b"\x1b[F".to_vec()),
        "page_up" | "pageup" => Ok(b"\x1b[5~".to_vec()),
        "page_down" | "pagedown" => Ok(b"\x1b[6~".to_vec()),
        "f1" => Ok(b"\x1bOP".to_vec()),
        "f2" => Ok(b"\x1bOQ".to_vec()),
        "f3" => Ok(b"\x1bOR".to_vec()),
        "f4" => Ok(b"\x1bOS".to_vec()),
        "f5" => Ok(b"\x1b[15~".to_vec()),
        "f6" => Ok(b"\x1b[17~".to_vec()),
        "f7" => Ok(b"\x1b[18~".to_vec()),
        "f8" => Ok(b"\x1b[19~".to_vec()),
        "f9" => Ok(b"\x1b[20~".to_vec()),
        "f10" => Ok(b"\x1b[21~".to_vec()),
        "f11" => Ok(b"\x1b[23~".to_vec()),
        "f12" => Ok(b"\x1b[24~".to_vec()),
        other => Err(format!("unsupported key: {other}")),
    }
}

fn ctrl_key(key: &str) -> Result<Vec<u8>, String> {
    match key {
        "@" | "space" => Ok(vec![0x00]),
        "[" | "escape" | "esc" => Ok(vec![0x1b]),
        "\\" => Ok(vec![0x1c]),
        "]" => Ok(vec![0x1d]),
        "^" => Ok(vec![0x1e]),
        "_" => Ok(vec![0x1f]),
        "?" => Ok(vec![0x7f]),
        value if value.len() == 1 => {
            let byte = value.as_bytes()[0];
            if byte.is_ascii_alphabetic() {
                Ok(vec![byte.to_ascii_lowercase() - b'a' + 1])
            } else {
                Err(format!("unsupported ctrl key: {value}"))
            }
        }
        other => Err(format!("unsupported ctrl key: {other}")),
    }
}