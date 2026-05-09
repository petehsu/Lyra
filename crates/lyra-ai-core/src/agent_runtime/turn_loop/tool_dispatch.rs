use super::*;
pub(in crate::agent_runtime) fn run_tool_operation(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    permission_mode: PermissionMode,
    messages: &mut Vec<ChatMessage>,
    inspected_tool_paths: &mut HashSet<String>,
) -> Result<()> {
    emit_tool_event(
        store,
        session_id,
        turn_id,
        "tool_operation_requested",
        json!({ "operation": tool_operation_payload(operation) }),
    )?;
    emit_runtime_state(store, session_id, turn_id, "tool_executing")?;
    emit_tool_event(
        store,
        session_id,
        turn_id,
        "tool_operation_started",
        json!({ "operation": tool_operation_payload(operation) }),
    )?;
    project_follow_operation_started(store, session_id, turn_id, operation)?;
    let normalized_operation_path = normalized_tool_path(&operation.path);
    let policy_for_turn = store.read_effective_policy_for_turn(session_id, turn_id)?;
    let mut blocked_result = None;
    if let Some((snapshot_id, policy)) = policy_for_turn.as_ref() {
        let decision = record_tool_decision(
            store,
            session_id,
            turn_id,
            Some(snapshot_id),
            policy,
            operation,
        )?;
        emit_tool_event(
            store,
            session_id,
            turn_id,
            "security_decision_recorded",
            json!({
                "sessionId": session_id,
                "turnId": turn_id,
                "operationId": operation.op_id,
                "snapshotId": snapshot_id,
                "resourceKind": "tool",
                "resourceRef": operation.path,
                "security": security_event_payload(&decision),
            }),
        )?;
        if decision.decision == "deny" {
            emit_tool_event(
                store,
                session_id,
                turn_id,
                "security_resource_blocked",
                json!({
                    "sessionId": session_id,
                    "turnId": turn_id,
                    "operationId": operation.op_id,
                    "snapshotId": snapshot_id,
                    "resourceKind": "tool",
                    "resourceRef": operation.path,
                    "security": security_event_payload(&decision),
                }),
            )?;
            let mut result = ToolResultEnvelope::failed(
                operation,
                SECURITY_RESOURCE_DENIED,
                "Tool operation was denied by project policy",
            );
            result.metadata = Some(json!({
                "kind": "security_resource_blocked",
                "securityDecisionId": decision.decision_id,
                "reasonCodes": decision.reason_codes,
            }));
            blocked_result = Some(result);
        }
    }
    if operation.op == ToolFsOp::Run
        && (normalized_operation_path == TOOL_FS_APPLY_PATCH
            || normalized_operation_path == TOOL_FS_ROLLBACK_PATCH)
    {
        ensure_recovery_anchor_for_write(store, session_id, turn_id)?;
    }
    let mut result = if let Some(result) = blocked_result {
        result
    } else if operation.op == ToolFsOp::Run
        && normalized_tool_path(&operation.path) != TOOL_SEARCH
        && !inspected_tool_paths.contains(&normalized_tool_path(&operation.path))
    {
        inspect_required_result(operation)
    } else if operation.op == ToolFsOp::Run
        && normalized_tool_path(&operation.path) == TOOL_FS_APPLY_PATCH
    {
        apply_patch_tool_result(
            store,
            session_id,
            turn_id,
            context,
            operation,
            permission_mode,
        )
    } else if operation.op == ToolFsOp::Run
        && normalized_tool_path(&operation.path) == TOOL_FS_ROLLBACK_PATCH
    {
        rollback_patch_tool_result(
            store,
            session_id,
            turn_id,
            context,
            operation,
            permission_mode,
        )
    } else if operation.op == ToolFsOp::Run
        && normalized_tool_path(&operation.path) == TOOL_SHELL_RUN_COMMAND
    {
        shell::run_command_tool_result(
            store,
            session_id,
            turn_id,
            context,
            operation,
            permission_mode,
        )
    } else if operation.op == ToolFsOp::Run && is_security_tool(&normalized_operation_path) {
        security_tool_result(store, session_id, turn_id, context, operation)
    } else if operation.op == ToolFsOp::Run && is_capsule_tool(&normalized_operation_path) {
        capsule_tool_result(store, session_id, turn_id, context, operation)
    } else if operation.op == ToolFsOp::Run && is_memory_tool(&normalized_operation_path) {
        memory_tool_result(store, session_id, turn_id, operation)
    } else {
        execute_tool(context, operation)
    };
    if operation.op == ToolFsOp::Inspect && result.status == ToolResultStatus::Completed {
        inspected_tool_paths.insert(normalized_tool_path(&operation.path));
    }
    if let Some((snapshot_id, policy)) = policy_for_turn.as_ref() {
        if let Some(outcome) = redact_tool_result_if_needed(
            store,
            session_id,
            turn_id,
            Some(snapshot_id),
            &mut result,
            policy.security.redaction_profile.as_str(),
        )? {
            emit_tool_event(
                store,
                session_id,
                turn_id,
                "security_redaction_applied",
                json!({
                    "sessionId": session_id,
                    "turnId": turn_id,
                    "snapshotId": snapshot_id,
                    "resourceKind": "tool_result",
                    "operationId": operation.op_id,
                    "security": security_event_payload(&outcome),
                }),
            )?;
        }
    }
    let result_blob = store.append_tool_result_blob(
        session_id,
        turn_id,
        &result.op_id,
        &result.path,
        verification::tool_result_status_str(&result.status),
        &result.content,
    )?;
    result.result_ref = Some(result_blob.result_ref.clone());
    verification::enrich_tool_result_metadata(
        store,
        session_id,
        turn_id,
        &mut result,
        &result_blob,
    )?;
    project_follow_operation_finished(
        store,
        session_id,
        turn_id,
        operation,
        &result,
        &result_blob,
    )?;
    project_recovery_side_effect(store, session_id, turn_id, operation, &result)?;
    let event_type = if result.status == ToolResultStatus::Completed {
        "tool_operation_completed"
    } else {
        "tool_operation_failed"
    };
    emit_tool_event(
        store,
        session_id,
        turn_id,
        event_type,
        json!({
            "operation": tool_operation_payload(operation),
            "result": tool_result_payload(&result, &result_blob),
        }),
    )?;
    emit_verification_projection_events(store, session_id, Some(turn_id), &result)?;
    record_todo_from_tool_result(store, session_id, turn_id, operation, &result)?;
    store.evaluate_completion_audit_and_delivery_proof(session_id, Some(turn_id))?;
    project_work_after_completion(store, session_id, Some(turn_id))?;
    let detail = store.read_session_detail(session_id)?;
    delivery::emit_security_summary_updated(store, session_id, turn_id, detail.as_ref())?;
    emit_completion_projection_events(store, session_id, Some(turn_id), detail.as_ref())?;
    if let Some(detail) = detail {
        emit_store_event(
            store,
            session_id,
            Some(turn_id),
            "session_updated",
            json!({ "detail": detail }),
        )?;
    }
    let mut model_messages = vec![
        ChatMessage {
            role: "assistant".to_string(),
            content: serde_json::to_string(operation)?,
        },
        ChatMessage {
            role: "user".to_string(),
            content: tool_result_chat_message(&result)?,
        },
    ];
    model_turn::redact_model_input_for_turn(store, session_id, turn_id, &mut model_messages)?;
    messages.extend(model_messages);
    Ok(())
}

fn is_security_tool(path: &str) -> bool {
    path.starts_with("/tools/security/")
}

fn is_capsule_tool(path: &str) -> bool {
    path.starts_with("/tools/capsule/")
}

fn is_memory_tool(path: &str) -> bool {
    matches!(
        path,
        TOOL_MEMORY_SEARCH_SESSION
            | TOOL_MEMORY_SEARCH_SHARED
            | TOOL_MEMORY_SEARCH_FROZEN
            | TOOL_MEMORY_GET_CONTEXT_SNAPSHOT
            | TOOL_MEMORY_ASSEMBLE_CONTEXT
            | TOOL_MEMORY_PROPOSE_MEMORY
            | TOOL_MEMORY_UPDATE_MEMORY
            | TOOL_MEMORY_CREATE_CONFLICT_CANDIDATE
            | TOOL_MEMORY_AUDIT_MEMORY
    )
}

fn security_tool_result(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
) -> ToolResultEnvelope {
    let result = match security_tool_value(store, session_id, turn_id, context, operation) {
        Ok(value) => ToolResultEnvelope::completed(
            operation,
            format!("Ran {}", operation.path),
            serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_string()),
            false,
        ),
        Err(error) => ToolResultEnvelope::failed(
            operation,
            crate::tool_runtime::operation::TOOL_EXECUTION_FAILED,
            error.to_string(),
        ),
    };
    result
}

fn capsule_tool_result(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
) -> ToolResultEnvelope {
    let result = match capsule_tool_value(store, session_id, turn_id, context, operation) {
        Ok(value) => ToolResultEnvelope::completed(
            operation,
            format!("Ran {}", operation.path),
            serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_string()),
            false,
        ),
        Err(error) => ToolResultEnvelope::failed(
            operation,
            crate::tool_runtime::operation::TOOL_EXECUTION_FAILED,
            error.to_string(),
        ),
    };
    result
}

fn security_tool_value(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
) -> Result<Value> {
    let path = normalized_tool_path(&operation.path);
    match path.as_str() {
        crate::tool_runtime::catalog::TOOL_SECURITY_CLASSIFY_RESOURCE => {
            let resource_kind = operation
                .args
                .get("resourceKind")
                .and_then(Value::as_str)
                .unwrap_or("resource");
            let resource_ref = operation
                .args
                .get("resourceRef")
                .and_then(Value::as_str)
                .unwrap_or("");
            let policy_for_turn = store.read_effective_policy_for_turn(session_id, turn_id)?;
            let decision = if resource_kind == "file" {
                if let Some((snapshot_id, policy)) = policy_for_turn.as_ref() {
                    crate::security_gate::record_path_decision(
                        store,
                        session_id,
                        turn_id,
                        Some(snapshot_id),
                        policy,
                        resource_ref,
                    )?
                } else {
                    None
                }
            } else {
                None
            };
            let detection = crate::security_gate::redaction::detect_and_redact(resource_ref);
            Ok(json!({
                "schemaVersion": "v1",
                "resourceKind": resource_kind,
                "resourceRef": resource_ref,
                "sensitive": decision.is_some() || detection.findings.is_empty() == false,
                "decision": decision,
                "findings": detection.findings,
            }))
        }
        crate::tool_runtime::catalog::TOOL_SECURITY_SCAN_TEXT => {
            let content = operation
                .args
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or("");
            let resource_kind = operation
                .args
                .get("resourceKind")
                .and_then(Value::as_str)
                .unwrap_or("text");
            let resource_ref = operation
                .args
                .get("resourceRef")
                .and_then(Value::as_str)
                .unwrap_or(&operation.op_id);
            scan_text_tool_value(
                store,
                session_id,
                turn_id,
                resource_kind,
                resource_ref,
                content,
            )
        }
        crate::tool_runtime::catalog::TOOL_SECURITY_SCAN_FILE => {
            let security = crate::tool_runtime::security::WorkspaceSecurity::new(
                context.workspace_root.as_deref(),
            )?;
            let path = operation
                .args
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("path is required"))?;
            let target = security.resolve_existing_path(Some(path))?;
            let max_bytes = operation
                .args
                .get("maxBytes")
                .and_then(Value::as_u64)
                .and_then(|value| usize::try_from(value).ok())
                .unwrap_or(256 * 1024);
            let bytes = std::fs::read(&target)?;
            let text = String::from_utf8_lossy(&bytes[..bytes.len().min(max_bytes)]).to_string();
            scan_text_tool_value(store, session_id, turn_id, "file", path, &text)
        }
        crate::tool_runtime::catalog::TOOL_SECURITY_SCAN_ARTIFACT => {
            let content = operation
                .args
                .get("content")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("content is required for scan_artifact v1"))?;
            let resource_ref = operation
                .args
                .get("artifactId")
                .and_then(Value::as_str)
                .unwrap_or(&operation.op_id);
            scan_text_tool_value(
                store,
                session_id,
                turn_id,
                "artifact",
                resource_ref,
                content,
            )
        }
        crate::tool_runtime::catalog::TOOL_SECURITY_REDACT_TEXT => {
            let text = operation
                .args
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or("");
            let report = crate::security_gate::redaction::detect_and_redact(text);
            Ok(json!({
                "schemaVersion": "v1",
                "redacted": report.redacted,
                "findings": report.findings,
            }))
        }
        crate::tool_runtime::catalog::TOOL_SECURITY_CREATE_SECRET_RECORD => {
            crate::secret_broker::create_secret_record(
                store,
                session_id,
                turn_id,
                serde_json::from_value(operation.args.clone())?,
            )
        }
        crate::tool_runtime::catalog::TOOL_SECURITY_CREATE_SECRET_HANDLE => {
            crate::secret_broker::create_secret_handle(
                store,
                session_id,
                turn_id,
                serde_json::from_value(operation.args.clone())?,
            )
        }
        crate::tool_runtime::catalog::TOOL_SECURITY_READ_SECRET_METADATA => {
            crate::secret_broker::read_secret_metadata(
                store,
                session_id,
                serde_json::from_value(operation.args.clone())?,
            )
        }
        crate::tool_runtime::catalog::TOOL_SECURITY_REVOKE_SECRET_HANDLE => {
            crate::secret_broker::revoke_secret_handle(
                store,
                session_id,
                turn_id,
                serde_json::from_value(operation.args.clone())?,
            )
        }
        crate::tool_runtime::catalog::TOOL_SECURITY_CHECK_EXFILTRATION => {
            crate::secret_broker::check_exfiltration(
                store,
                session_id,
                turn_id,
                serde_json::from_value(operation.args.clone())?,
            )
        }
        crate::tool_runtime::catalog::TOOL_SECURITY_VALIDATE_ENV_ACCESS => {
            validate_env_access_tool_value(store, session_id, turn_id, operation)
        }
        crate::tool_runtime::catalog::TOOL_SECURITY_VALIDATE_SENSITIVE_FILE_ACCESS => {
            validate_sensitive_file_tool_value(store, session_id, turn_id, operation)
        }
        crate::tool_runtime::catalog::TOOL_SECURITY_VALIDATE_CAPSULE_BRIDGE => {
            validate_capsule_bridge_tool_value(store, session_id, turn_id, operation)
        }
        crate::tool_runtime::catalog::TOOL_SECURITY_AUDIT_SECRET_ACCESS => {
            crate::secret_broker::audit_secret_access(
                store,
                session_id,
                turn_id,
                serde_json::from_value(operation.args.clone())?,
            )
        }
        _ => Err(anyhow!("security tool not found: {}", operation.path)),
    }
}

fn scan_text_tool_value(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    resource_kind: &str,
    resource_ref: &str,
    content: &str,
) -> Result<Value> {
    let policy_for_turn = store.read_effective_policy_for_turn(session_id, turn_id)?;
    let (snapshot_id, profile) = policy_for_turn
        .as_ref()
        .map(|(snapshot_id, policy)| {
            (
                Some(snapshot_id.as_str()),
                policy.security.redaction_profile.as_str(),
            )
        })
        .unwrap_or((None, "strict"));
    let outcome = crate::security_gate::scan_and_record_text(
        store,
        session_id,
        turn_id,
        snapshot_id,
        resource_kind,
        resource_ref,
        content,
        profile,
    )?;
    Ok(json!({
        "schemaVersion": "v1",
        "security": crate::security_gate::security_event_payload(&outcome),
        "redactedContent": outcome.redacted_content,
    }))
}

fn validate_env_access_tool_value(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    operation: &ToolOperationEnvelope,
) -> Result<Value> {
    let env = operation
        .args
        .get("env")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let names = operation
        .args
        .get("names")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let sensitive_names = env
        .keys()
        .map(String::as_str)
        .chain(names.iter().filter_map(Value::as_str))
        .filter(|name| is_secret_env_name(name))
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let decision = if sensitive_names.is_empty() {
        "allow"
    } else {
        "deny"
    };
    store.create_security_decision_record(crate::storage::CreateSecurityDecisionRecordInput {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        operation_id: Some(operation.op_id.clone()),
        snapshot_id: None,
        resource_kind: "env".to_string(),
        resource_ref: sensitive_names.join(", "),
        decision: decision.to_string(),
        reason_codes: if sensitive_names.is_empty() {
            vec!["env_access_allowed".to_string()]
        } else {
            vec!["EnvSecretReadDenied".to_string()]
        },
        risk_level: if sensitive_names.is_empty() {
            "low".to_string()
        } else {
            "high".to_string()
        },
        redaction_applied: sensitive_names.is_empty() == false,
        approval_ticket_id: None,
        evidence_refs: Vec::new(),
    })?;
    Ok(json!({
        "schemaVersion": "v1",
        "decision": decision,
        "sensitiveNames": sensitive_names,
    }))
}

fn validate_sensitive_file_tool_value(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    operation: &ToolOperationEnvelope,
) -> Result<Value> {
    let path = operation
        .args
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("path is required"))?;
    let policy_for_turn = store.read_effective_policy_for_turn(session_id, turn_id)?;
    let outcome = if let Some((snapshot_id, policy)) = policy_for_turn.as_ref() {
        crate::security_gate::record_path_decision(
            store,
            session_id,
            turn_id,
            Some(snapshot_id),
            policy,
            path,
        )?
    } else {
        None
    };
    Ok(json!({
        "schemaVersion": "v1",
        "path": path,
        "decision": outcome,
    }))
}

fn validate_capsule_bridge_tool_value(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    operation: &ToolOperationEnvelope,
) -> Result<Value> {
    let policy = operation
        .args
        .get("bridgePolicy")
        .cloned()
        .ok_or_else(|| anyhow!("bridgePolicy is required"))?;
    let capsule_id = operation
        .args
        .get("capsuleId")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let reasons = capsule_bridge_denial_reasons(&policy);
    let decision = if reasons.is_empty() { "allow" } else { "deny" };
    let record =
        store.create_capsule_bridge_audit(crate::storage::CreateCapsuleBridgeAuditInput {
            session_id: session_id.to_string(),
            turn_id: turn_id.to_string(),
            capsule_id,
            operation_id: Some(operation.op_id.clone()),
            decision: decision.to_string(),
            bridge_policy: policy,
            reason_codes: if reasons.is_empty() {
                vec!["capsule_bridge_policy_valid".to_string()]
            } else {
                reasons
            },
            approval_ticket_id: None,
        })?;
    Ok(json!({
        "schemaVersion": "v1",
        "decision": decision,
        "audit": record,
    }))
}

fn capsule_bridge_denial_reasons(policy: &Value) -> Vec<String> {
    let mut reasons = Vec::new();
    let secrets = policy.get("secrets").unwrap_or(&Value::Null);
    if secrets
        .get("exposeSshAgent")
        .or_else(|| secrets.get("expose_ssh_agent"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        reasons.push("SSHAgentBridgeDenied".to_string());
    }
    if secrets
        .get("exposeKeychain")
        .or_else(|| secrets.get("expose_keychain"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        reasons.push("CapsuleSecretBridgeDenied".to_string());
    }
    if let Some(paths) = policy
        .get("mountedPaths")
        .or_else(|| policy.get("mounted_paths"))
        .and_then(Value::as_array)
    {
        for mount in paths {
            if mount
                .get("hostPath")
                .or_else(|| mount.get("host_path"))
                .and_then(Value::as_str)
                .is_some_and(|path| path == "/" || is_sensitive_path_text(path))
            {
                reasons.push("CapsuleBridgeDenied".to_string());
            }
        }
    }
    reasons.sort();
    reasons.dedup();
    reasons
}

fn is_secret_env_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("token")
        || lower.contains("secret")
        || lower.contains("password")
        || lower.contains("cookie")
        || lower.contains("key")
}

fn is_sensitive_path_text(path: &str) -> bool {
    let lower = path.replace('\\', "/").to_ascii_lowercase();
    lower.contains("/.ssh")
        || lower.contains("/.aws")
        || lower.contains("/.gcp")
        || lower.contains("/.azure")
        || lower.contains("keychain")
        || lower.ends_with(".pem")
        || lower.ends_with(".key")
        || lower.ends_with(".env")
}

fn capsule_tool_value(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
) -> Result<Value> {
    let path = normalized_tool_path(&operation.path);
    let payload = capsule_payload(store, session_id, context, operation)?;
    if path == crate::tool_runtime::catalog::TOOL_CAPSULE_UPDATE_BRIDGE_POLICY {
        let validation = validate_capsule_bridge_tool_value(store, session_id, turn_id, operation)?;
        if validation.get("decision").and_then(Value::as_str) == Some("deny") {
            return Ok(validation);
        }
    }
    let response = match path.as_str() {
        crate::tool_runtime::catalog::TOOL_CAPSULE_READ_IMAGE_MANIFEST => {
            lyra_capsule_core::read_image_manifest_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_LIST_IMAGES => {
            lyra_capsule_core::list_images_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_DOWNLOAD_IMAGE => {
            lyra_capsule_core::download_image_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_VERIFY_IMAGE => {
            lyra_capsule_core::verify_image_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_IMPORT_IMAGE => {
            lyra_capsule_core::import_image_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_CREATE => {
            lyra_capsule_core::create_capsule_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_START => {
            lyra_capsule_core::start_capsule_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_STOP => {
            lyra_capsule_core::stop_capsule_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_DESTROY => {
            lyra_capsule_core::destroy_capsule_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_STATUS => {
            lyra_capsule_core::capsule_status_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_EXEC => {
            lyra_capsule_core::exec_capsule_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_CREATE_SNAPSHOT => {
            lyra_capsule_core::create_snapshot_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_RESTORE_SNAPSHOT => {
            lyra_capsule_core::restore_snapshot_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_UPDATE_BRIDGE_POLICY => {
            lyra_capsule_core::update_bridge_policy_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_READ_GUEST_LOGS => {
            lyra_capsule_core::read_guest_logs_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_EXPORT_ARTIFACT => {
            lyra_capsule_core::export_artifact_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_LIST_SESSION_BINDINGS => {
            lyra_capsule_core::list_session_bindings_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_READ_SESSION_BINDING => {
            lyra_capsule_core::read_session_binding_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_ATTACH_SESSION_VM => {
            lyra_capsule_core::attach_session_vm_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_TAKEOVER_SESSION_VM => {
            lyra_capsule_core::takeover_session_vm_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_FORK_SESSION_VM => {
            lyra_capsule_core::fork_session_vm_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_CREATE_INHERITANCE_PROFILE => {
            lyra_capsule_core::create_inheritance_profile_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_APPLY_INHERITANCE_PROFILE => {
            lyra_capsule_core::apply_inheritance_profile_json(payload)
        }
        crate::tool_runtime::catalog::TOOL_CAPSULE_REVOKE_SESSION_BINDING => {
            lyra_capsule_core::revoke_session_binding_json(payload)
        }
        _ => Err(anyhow!("capsule tool not found: {}", operation.path)),
    }?;
    let mut value = serde_json::from_str::<Value>(&response)?;
    if path == crate::tool_runtime::catalog::TOOL_CAPSULE_EXPORT_ARTIFACT {
        if let Some(host_path) = value.get("hostPath").and_then(Value::as_str) {
            if let Ok(content) = std::fs::read_to_string(host_path) {
                let scan = scan_text_tool_value(
                    store, session_id, turn_id, "artifact", host_path, &content,
                )?;
                if let Some(object) = value.as_object_mut() {
                    object.insert("securityScan".to_string(), scan);
                }
            }
        }
    }
    Ok(value)
}

fn capsule_payload(
    store: &AiStore,
    session_id: &str,
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
) -> Result<String> {
    let mut value = operation.args.clone();
    if !value.is_object() {
        value = json!({});
    }
    let object = value
        .as_object_mut()
        .ok_or_else(|| anyhow!("capsule args must be an object"))?;
    object
        .entry("storageRoot".to_string())
        .or_insert_with(|| Value::String(capsule_storage_root(store)));
    if is_agent_vm_binding_tool(&normalized_tool_path(&operation.path)) {
        object
            .entry("sessionId".to_string())
            .or_insert_with(|| Value::String(session_id.to_string()));
    }
    if normalized_tool_path(&operation.path) == crate::tool_runtime::catalog::TOOL_CAPSULE_CREATE {
        if let Some(workspace_root) = context.workspace_root.as_ref() {
            object
                .entry("workspaceRoot".to_string())
                .or_insert_with(|| Value::String(workspace_root.clone()));
        }
    }
    Ok(value.to_string())
}

fn is_agent_vm_binding_tool(path: &str) -> bool {
    matches!(
        path,
        crate::tool_runtime::catalog::TOOL_CAPSULE_LIST_SESSION_BINDINGS
            | crate::tool_runtime::catalog::TOOL_CAPSULE_READ_SESSION_BINDING
            | crate::tool_runtime::catalog::TOOL_CAPSULE_ATTACH_SESSION_VM
            | crate::tool_runtime::catalog::TOOL_CAPSULE_TAKEOVER_SESSION_VM
            | crate::tool_runtime::catalog::TOOL_CAPSULE_FORK_SESSION_VM
            | crate::tool_runtime::catalog::TOOL_CAPSULE_CREATE_INHERITANCE_PROFILE
            | crate::tool_runtime::catalog::TOOL_CAPSULE_APPLY_INHERITANCE_PROFILE
            | crate::tool_runtime::catalog::TOOL_CAPSULE_REVOKE_SESSION_BINDING
    )
}

fn capsule_storage_root(store: &AiStore) -> String {
    store
        .root
        .parent()
        .map(|parent| parent.join("capsule"))
        .unwrap_or_else(|| store.root.join("capsule"))
        .to_string_lossy()
        .to_string()
}

fn memory_tool_result(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    operation: &ToolOperationEnvelope,
) -> ToolResultEnvelope {
    let result = match memory_tool_value(store, session_id, turn_id, operation) {
        Ok(value) => ToolResultEnvelope::completed(
            operation,
            format!("Ran {}", operation.path),
            serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_string()),
            false,
        ),
        Err(error) => ToolResultEnvelope::failed(
            operation,
            crate::tool_runtime::operation::TOOL_EXECUTION_FAILED,
            error.to_string(),
        ),
    };
    result
}

fn memory_tool_value(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    operation: &ToolOperationEnvelope,
) -> Result<Value> {
    match normalized_tool_path(&operation.path).as_str() {
        TOOL_MEMORY_SEARCH_SESSION => {
            let args = crate::tool_runtime::catalog::parse_args::<
                crate::tool_runtime::catalog::MemorySearchArgs,
            >(&operation.args)?;
            store.memory_search_session(session_id, &args.query, args.limit.unwrap_or(20))
        }
        TOOL_MEMORY_SEARCH_SHARED => {
            let args = crate::tool_runtime::catalog::parse_args::<
                crate::tool_runtime::catalog::MemorySearchArgs,
            >(&operation.args)?;
            store.memory_search_truth("shared", &args.query, args.limit.unwrap_or(20))
        }
        TOOL_MEMORY_SEARCH_FROZEN => {
            let args = crate::tool_runtime::catalog::parse_args::<
                crate::tool_runtime::catalog::MemorySearchArgs,
            >(&operation.args)?;
            store.memory_search_truth("frozen", &args.query, args.limit.unwrap_or(20))
        }
        TOOL_MEMORY_GET_CONTEXT_SNAPSHOT => {
            let args = crate::tool_runtime::catalog::parse_args::<
                crate::tool_runtime::catalog::MemoryContextSnapshotArgs,
            >(&operation.args)?;
            let mut snapshot = store.memory_context_snapshot(session_id)?;
            if args.include_pinned == Some(false) {
                if let Some(object) = snapshot.as_object_mut() {
                    object.remove("pinned");
                }
            }
            Ok(snapshot)
        }
        TOOL_MEMORY_ASSEMBLE_CONTEXT => {
            let args = crate::tool_runtime::catalog::parse_args::<
                crate::tool_runtime::catalog::MemoryAssembleContextArgs,
            >(&operation.args)?;
            store.assemble_memory_context_tool(session_id, args.max_chars.unwrap_or(16_000))
        }
        TOOL_MEMORY_PROPOSE_MEMORY => {
            let args = crate::tool_runtime::catalog::parse_args::<
                crate::tool_runtime::catalog::MemoryProposeArgs,
            >(&operation.args)?;
            store.propose_memory_record(
                args.scope.as_deref().unwrap_or("shared"),
                args.namespace.as_deref().unwrap_or("project"),
                &args.kind,
                args.value,
                args.evidence_refs,
                session_id,
                Some(turn_id),
            )
        }
        TOOL_MEMORY_UPDATE_MEMORY => {
            let args = crate::tool_runtime::catalog::parse_args::<
                crate::tool_runtime::catalog::MemoryUpdateArgs,
            >(&operation.args)?;
            store.update_memory_record_status_or_value(
                &args.scope,
                &args.memory_id,
                args.status.as_deref(),
                args.value,
                args.evidence_refs,
            )
        }
        TOOL_MEMORY_CREATE_CONFLICT_CANDIDATE => {
            let args = crate::tool_runtime::catalog::parse_args::<
                crate::tool_runtime::catalog::MemoryConflictArgs,
            >(&operation.args)?;
            store.create_memory_conflict_candidate(
                args.scope.as_deref().unwrap_or("shared"),
                args.namespace.as_deref().unwrap_or("project"),
                &args.kind,
                args.value,
                args.conflicts_with,
                args.evidence_refs,
                session_id,
                Some(turn_id),
            )
        }
        TOOL_MEMORY_AUDIT_MEMORY => {
            let args = crate::tool_runtime::catalog::parse_args::<
                crate::tool_runtime::catalog::MemoryAuditArgs,
            >(&operation.args)?;
            store.audit_memory_records(
                args.scope.as_deref().unwrap_or("shared"),
                args.limit.unwrap_or(20),
            )
        }
        _ => Err(anyhow!("memory tool not found: {}", operation.path)),
    }
}
