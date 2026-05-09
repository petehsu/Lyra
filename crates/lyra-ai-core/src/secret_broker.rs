use crate::secrets;
use crate::security_gate::redaction;
use crate::storage::{
    now_ms, trim_to_string, AiStore, CreateExfiltrationDecisionInput, CreateSecretAccessAuditInput,
    CreateSecretHandleInput, CreateSecretRecordInput,
};
use anyhow::{anyhow, bail, Result};
use serde::Deserialize;
use serde_json::{json, Value};

const DEFAULT_HANDLE_TTL_SECONDS: i64 = 600;
const MAX_HANDLE_TTL_SECONDS: i64 = 3600;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSecretRecordArgs {
    pub kind: String,
    pub label: String,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default, alias = "storage_ref")]
    pub storage_ref: Option<String>,
    #[serde(default)]
    pub scope: Option<Value>,
    #[serde(default, alias = "expires_at")]
    pub expires_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSecretHandleArgs {
    #[serde(alias = "secret_id")]
    pub secret_id: String,
    #[serde(alias = "granted_to_tool_path")]
    pub granted_to_tool_path: String,
    #[serde(alias = "granted_for_operation_id")]
    pub granted_for_operation_id: String,
    #[serde(alias = "allowed_target")]
    pub allowed_target: String,
    #[serde(default, alias = "reveal_mode")]
    pub reveal_mode: Option<String>,
    #[serde(default, alias = "ttl_seconds")]
    pub ttl_seconds: Option<i64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretIdArgs {
    #[serde(alias = "secret_id")]
    pub secret_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretHandleIdArgs {
    #[serde(alias = "handle_id")]
    pub handle_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditSecretAccessArgs {
    #[serde(default, alias = "secret_id")]
    pub secret_id: Option<String>,
    #[serde(default, alias = "handle_id")]
    pub handle_id: Option<String>,
    #[serde(default, alias = "operation_id")]
    pub operation_id: Option<String>,
    #[serde(alias = "access_kind")]
    pub access_kind: String,
    #[serde(alias = "target_ref")]
    pub target_ref: String,
    #[serde(default)]
    pub decision: Option<String>,
    #[serde(default, alias = "reason_codes")]
    pub reason_codes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckExfiltrationArgs {
    #[serde(default, alias = "operation_id")]
    pub operation_id: Option<String>,
    #[serde(alias = "target_kind")]
    pub target_kind: String,
    #[serde(alias = "target_ref")]
    pub target_ref: String,
    pub content: String,
}

#[derive(Clone, Debug)]
pub struct SecretMaterialization {
    pub value: String,
}

pub fn create_secret_record(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    args: CreateSecretRecordArgs,
) -> Result<Value> {
    let storage_ref = match (
        args.value,
        args.storage_ref.and_then(|value| trim_to_string(&value)),
    ) {
        (Some(value), _) => {
            let secret_ref = secrets::create_secret_ref();
            secrets::write_secret(&store.root, &secret_ref, &value)?;
            secret_ref
        }
        (None, Some(storage_ref)) => storage_ref,
        (None, None) => bail!("secret value or storageRef is required"),
    };
    let scope = args.scope.unwrap_or_else(default_scope);
    let record = store.create_secret_record(CreateSecretRecordInput {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        kind: normalize_secret_kind(&args.kind),
        provider: args.provider.and_then(|value| trim_to_string(&value)),
        label: trim_to_string(&args.label).ok_or_else(|| anyhow!("label is required"))?,
        storage_ref,
        scope,
        expires_at: args.expires_at,
    })?;
    store.record_secret_access(CreateSecretAccessAuditInput {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        secret_id: Some(record.secret_id.clone()),
        handle_id: None,
        operation_id: None,
        access_kind: "create_secret_record".to_string(),
        target_ref: record.label.clone(),
        decision: "allow".to_string(),
        reason_codes: vec!["security.secret_record_created".to_string()],
    })?;
    Ok(json!({
        "schemaVersion": "v1",
        "status": "created",
        "secret": public_secret_record(&record),
    }))
}

pub fn create_secret_handle(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    args: CreateSecretHandleArgs,
) -> Result<Value> {
    let record = store
        .read_secret_record(session_id, &args.secret_id)?
        .ok_or_else(|| anyhow!("SecretRecordNotFound"))?;
    if record.status != "active" {
        bail!("SecretHandleScopeDenied: secret is not active");
    }
    validate_scope(
        &record.scope,
        &args.granted_to_tool_path,
        &args.allowed_target,
        &args.reveal_mode,
    )?;
    let ttl_seconds = args
        .ttl_seconds
        .unwrap_or(DEFAULT_HANDLE_TTL_SECONDS)
        .clamp(1, MAX_HANDLE_TTL_SECONDS);
    let reveal_mode = normalize_reveal_mode(args.reveal_mode.as_deref())?;
    let handle = store.create_secret_handle(CreateSecretHandleInput {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        secret_id: args.secret_id,
        granted_to_tool_path: args.granted_to_tool_path,
        granted_for_operation_id: args.granted_for_operation_id,
        allowed_target: args.allowed_target,
        reveal_mode,
        expires_at: now_ms().saturating_add(ttl_seconds.saturating_mul(1000)),
    })?;
    store.record_secret_access(CreateSecretAccessAuditInput {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        secret_id: Some(handle.secret_id.clone()),
        handle_id: Some(handle.handle_id.clone()),
        operation_id: Some(handle.granted_for_operation_id.clone()),
        access_kind: "create_secret_handle".to_string(),
        target_ref: handle.allowed_target.clone(),
        decision: "allow".to_string(),
        reason_codes: vec!["security.secret_handle_created".to_string()],
    })?;
    Ok(json!({
        "schemaVersion": "v1",
        "status": "created",
        "handle": handle,
    }))
}

pub fn read_secret_metadata(
    store: &AiStore,
    session_id: &str,
    args: SecretIdArgs,
) -> Result<Value> {
    let record = store
        .read_secret_record(session_id, &args.secret_id)?
        .ok_or_else(|| anyhow!("SecretRecordNotFound"))?;
    Ok(json!({
        "schemaVersion": "v1",
        "secret": public_secret_record(&record),
    }))
}

pub fn revoke_secret_handle(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    args: SecretHandleIdArgs,
) -> Result<Value> {
    let handle = store
        .read_secret_handle(session_id, &args.handle_id)?
        .ok_or_else(|| anyhow!("SecretHandleNotFound"))?;
    store.revoke_secret_handle(session_id, &args.handle_id)?;
    store.record_secret_access(CreateSecretAccessAuditInput {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        secret_id: Some(handle.secret_id),
        handle_id: Some(args.handle_id.clone()),
        operation_id: Some(handle.granted_for_operation_id),
        access_kind: "revoke_secret_handle".to_string(),
        target_ref: handle.allowed_target,
        decision: "allow".to_string(),
        reason_codes: vec!["security.secret_handle_revoked".to_string()],
    })?;
    Ok(json!({
        "schemaVersion": "v1",
        "status": "revoked",
        "handleId": args.handle_id,
    }))
}

pub fn audit_secret_access(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    args: AuditSecretAccessArgs,
) -> Result<Value> {
    let record = store.record_secret_access(CreateSecretAccessAuditInput {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        secret_id: args.secret_id,
        handle_id: args.handle_id,
        operation_id: args.operation_id,
        access_kind: args.access_kind,
        target_ref: args.target_ref,
        decision: args.decision.unwrap_or_else(|| "allow".to_string()),
        reason_codes: if args.reason_codes.is_empty() {
            vec!["security.audit_secret_access".to_string()]
        } else {
            args.reason_codes
        },
    })?;
    Ok(json!({
        "schemaVersion": "v1",
        "status": "recorded",
        "audit": record,
    }))
}

pub fn check_exfiltration(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    args: CheckExfiltrationArgs,
) -> Result<Value> {
    let detection = redaction::detect_and_redact(&args.content);
    let contains_sensitive_data = detection.findings.is_empty() == false;
    let high_confidence = detection
        .findings
        .iter()
        .any(|finding| finding.confidence == "high");
    let (allowed, required_action, reason_codes) = if high_confidence {
        (
            false,
            "use_secret_handle".to_string(),
            vec!["high_confidence_secret_detected".to_string()],
        )
    } else if contains_sensitive_data {
        (
            true,
            "redact".to_string(),
            vec!["sensitive_data_requires_redaction".to_string()],
        )
    } else {
        (
            true,
            "allow".to_string(),
            vec!["no_sensitive_data_detected".to_string()],
        )
    };
    let record = store.create_exfiltration_decision(CreateExfiltrationDecisionInput {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        operation_id: args.operation_id,
        target_kind: args.target_kind,
        target_ref: args.target_ref,
        contains_sensitive_data,
        allowed,
        required_action,
        reason_codes,
        evidence_refs: Vec::new(),
    })?;
    Ok(json!({
        "schemaVersion": "v1",
        "decision": record,
        "redactedContent": if contains_sensitive_data { Some(detection.redacted) } else { None },
    }))
}

pub fn materialize_handle_for_process(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    handle_id: &str,
    operation_id: &str,
    tool_path: &str,
    target_ref: &str,
) -> Result<SecretMaterialization> {
    let handle = store
        .read_secret_handle(session_id, handle_id)?
        .ok_or_else(|| anyhow!("SecretHandleNotFound"))?;
    if handle.status != "active" {
        deny_secret_access(
            store,
            session_id,
            turn_id,
            Some(handle.secret_id.clone()),
            Some(handle.handle_id.clone()),
            Some(operation_id.to_string()),
            "inject_to_process",
            target_ref,
            "SecretHandleScopeDenied",
        )?;
        bail!("SecretHandleScopeDenied");
    }
    if handle.expires_at <= now_ms() {
        deny_secret_access(
            store,
            session_id,
            turn_id,
            Some(handle.secret_id.clone()),
            Some(handle.handle_id.clone()),
            Some(operation_id.to_string()),
            "inject_to_process",
            target_ref,
            "SecretHandleExpired",
        )?;
        bail!("SecretHandleExpired");
    }
    if handle.granted_to_tool_path != tool_path
        || handle.granted_for_operation_id != operation_id
        || handle.allowed_target != target_ref
    {
        deny_secret_access(
            store,
            session_id,
            turn_id,
            Some(handle.secret_id.clone()),
            Some(handle.handle_id.clone()),
            Some(operation_id.to_string()),
            "inject_to_process",
            target_ref,
            "SecretHandleScopeDenied",
        )?;
        bail!("SecretHandleScopeDenied");
    }
    if handle.reveal_mode != "inject_to_process" && handle.reveal_mode != "read_once" {
        bail!("SecretRawReadDenied");
    }
    let record = store
        .read_secret_record(session_id, &handle.secret_id)?
        .ok_or_else(|| anyhow!("SecretRecordNotFound"))?;
    let value = secrets::read_secret(&store.root, &record.storage_ref)?;
    store.record_secret_access(CreateSecretAccessAuditInput {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        secret_id: Some(handle.secret_id.clone()),
        handle_id: Some(handle.handle_id.clone()),
        operation_id: Some(operation_id.to_string()),
        access_kind: "inject_to_process".to_string(),
        target_ref: target_ref.to_string(),
        decision: "allow".to_string(),
        reason_codes: vec!["security.secret_handle_used".to_string()],
    })?;
    if handle.reveal_mode == "read_once" {
        store.revoke_secret_handle(session_id, &handle.handle_id)?;
    }
    Ok(SecretMaterialization { value })
}

fn deny_secret_access(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    secret_id: Option<String>,
    handle_id: Option<String>,
    operation_id: Option<String>,
    access_kind: &str,
    target_ref: &str,
    reason: &str,
) -> Result<()> {
    store.record_secret_access(CreateSecretAccessAuditInput {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        secret_id,
        handle_id,
        operation_id,
        access_kind: access_kind.to_string(),
        target_ref: target_ref.to_string(),
        decision: "deny".to_string(),
        reason_codes: vec![reason.to_string()],
    })?;
    Ok(())
}

fn validate_scope(
    scope: &Value,
    tool_path: &str,
    target: &str,
    reveal_mode: &Option<String>,
) -> Result<()> {
    let allowed_tools = string_array(
        scope
            .get("allowedTools")
            .or_else(|| scope.get("allowed_tools")),
    );
    if allowed_tools.is_empty() == false
        && !allowed_tools
            .iter()
            .any(|value| value == "*" || value == tool_path)
    {
        bail!("SecretHandleScopeDenied: tool not in scope");
    }
    let allowed_targets = string_array(
        scope
            .get("allowedDomains")
            .or_else(|| scope.get("allowed_domains")),
    );
    if allowed_targets.is_empty() == false
        && !allowed_targets
            .iter()
            .any(|value| value == "*" || target.contains(value))
    {
        bail!("SecretHandleScopeDenied: target not in scope");
    }
    if reveal_mode.as_deref() == Some("read_once")
        && scope
            .get("allowModelContext")
            .or_else(|| scope.get("allow_model_context"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        bail!("SecretRawReadDenied");
    }
    Ok(())
}

fn public_secret_record(record: &crate::storage::SecretRecord) -> Value {
    json!({
        "secretId": record.secret_id,
        "kind": record.kind,
        "provider": record.provider,
        "label": record.label,
        "scope": record.scope,
        "status": record.status,
        "expiresAt": record.expires_at,
        "createdAt": record.created_at,
        "updatedAt": record.updated_at,
    })
}

fn default_scope() -> Value {
    json!({
        "allowedTools": [],
        "allowedDomains": [],
        "allowedCommands": [],
        "allowedPurposes": [],
        "allowModelContext": false,
        "allowArtifactRaw": false,
        "allowCapsuleExposure": false,
    })
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn normalize_secret_kind(kind: &str) -> String {
    match kind.trim() {
        "api_key" | "oauth_token" | "jwt" | "ssh_private_key" | "ssh_agent" | "certificate"
        | "database_url" | "cloud_credential" | "env_secret" | "cookie" | "session_token"
        | "webhook_secret" | "password" | "private_config" => kind.trim().to_string(),
        _ => "unknown_secret".to_string(),
    }
}

fn normalize_reveal_mode(value: Option<&str>) -> Result<String> {
    match value
        .map(str::trim)
        .filter(|value| value.is_empty() == false)
    {
        None => Ok("never_reveal".to_string()),
        Some(mode @ ("never_reveal" | "inject_to_process" | "inject_to_request" | "read_once")) => {
            Ok(mode.to_string())
        }
        Some(_) => bail!("SecretHandleScopeDenied: invalid reveal mode"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool_runtime::catalog::TOOL_SHELL_RUN_COMMAND;

    #[test]
    fn secret_handle_materializes_only_for_matching_process_scope() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = AiStore::open(Some(temp.path().to_string_lossy().as_ref())).expect("store");
        let session_id = "session-secret";
        let turn_id = "turn-secret";
        store
            .with_session_conn(session_id, |_| Ok(()))
            .expect("session");

        let secret = create_secret_record(
            &store,
            session_id,
            turn_id,
            CreateSecretRecordArgs {
                kind: "api_key".to_string(),
                label: "OpenAI".to_string(),
                provider: Some("openai".to_string()),
                value: Some("sk-test-secret".to_string()),
                storage_ref: None,
                scope: Some(json!({
                    "allowedTools": [TOOL_SHELL_RUN_COMMAND],
                    "allowedDomains": ["OPENAI_API_KEY"],
                    "allowModelContext": false
                })),
                expires_at: None,
            },
        )
        .expect("secret record");
        let secret_id = secret["secret"]["secretId"]
            .as_str()
            .expect("secret id")
            .to_string();
        let handle = create_secret_handle(
            &store,
            session_id,
            turn_id,
            CreateSecretHandleArgs {
                secret_id,
                granted_to_tool_path: TOOL_SHELL_RUN_COMMAND.to_string(),
                granted_for_operation_id: "op-1".to_string(),
                allowed_target: "OPENAI_API_KEY".to_string(),
                reveal_mode: Some("inject_to_process".to_string()),
                ttl_seconds: Some(60),
            },
        )
        .expect("secret handle");
        let handle_id = handle["handle"]["handleId"]
            .as_str()
            .expect("handle id")
            .to_string();

        let materialized = materialize_handle_for_process(
            &store,
            session_id,
            turn_id,
            &handle_id,
            "op-1",
            TOOL_SHELL_RUN_COMMAND,
            "OPENAI_API_KEY",
        )
        .expect("materialized");
        assert_eq!(materialized.value, "sk-test-secret");
        assert!(materialize_handle_for_process(
            &store,
            session_id,
            turn_id,
            &handle_id,
            "op-2",
            TOOL_SHELL_RUN_COMMAND,
            "OPENAI_API_KEY",
        )
        .expect_err("wrong operation should fail")
        .to_string()
        .contains("SecretHandleScopeDenied"));
    }
}
