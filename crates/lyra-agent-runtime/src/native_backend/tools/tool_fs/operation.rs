use super::*;

pub(super) fn operation_context(session_id: &str, turn_id: &str) -> ToolOperationContext {
    let mut context = ToolOperationContext {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        ..ToolOperationContext::default()
    };
    if let Some(snapshot) = state().lock().ok().and_then(|state| {
        state
            .sessions
            .get(session_id)
            .map(|session| session.snapshot.clone())
    }) {
        context.working_dir = snapshot
            .get("workingDir")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string);
        context.active_tab_id = snapshot
            .get("activeTabId")
            .or_else(|| snapshot.get("focusedTabId"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string);
        context.workspace_id = snapshot
            .get("workspaceId")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string);
    }
    context
}

pub(super) fn run_operation_envelope(
    session_id: &str,
    turn_id: &str,
    input: &Value,
    cancellation: &CancellationToken,
) -> ToolOperationEnvelope {
    runtime_operation_envelope(
        session_id,
        turn_id,
        "run",
        input
            .get("path")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string),
        input
            .get("toolHandle")
            .or_else(|| input.get("tool_handle"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string),
        input.get("args").cloned().unwrap_or_else(|| json!({})),
        None,
        Some(cancellation),
        None,
        permission_mode_from_input(input),
    )
}

pub(super) fn meta_operation_envelope(
    session_id: &str,
    turn_id: &str,
    op: &str,
    input: &Value,
    cancellation: Option<&CancellationToken>,
) -> ToolOperationEnvelope {
    let default_path = matches!(op, "list" | "read_doc").then_some("/tools");
    runtime_operation_envelope(
        session_id,
        turn_id,
        op,
        input
            .get("path")
            .and_then(Value::as_str)
            .or(default_path)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string),
        input
            .get("toolHandle")
            .or_else(|| input.get("tool_handle"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string),
        input.clone(),
        None,
        cancellation,
        None,
        permission_mode_from_input(input),
    )
}

pub(super) fn runtime_operation_envelope(
    session_id: &str,
    turn_id: &str,
    op: &str,
    path: Option<String>,
    tool_handle: Option<String>,
    args: Value,
    timeout_ms: Option<u64>,
    cancellation: Option<&CancellationToken>,
    manifest: Option<&ToolManifest>,
    permission_mode: Option<String>,
) -> ToolOperationEnvelope {
    let context = operation_context(session_id, turn_id);
    let op_id = format!("tool-op-{}", Uuid::new_v4());
    ToolOperationEnvelope {
        schema_version: TOOL_FS_SCHEMA_VERSION,
        op_id: op_id.clone(),
        session_id: session_id.to_string(),
        runtime_turn_id: turn_id.to_string(),
        op: op.to_string(),
        path,
        args,
        tool_handle,
        policy_snapshot_id: Some(policy_snapshot_id(session_id, turn_id)),
        permission_mode: permission_mode.unwrap_or_else(|| "runtime_policy".to_string()),
        trace_id: format!("trace-{}", Uuid::new_v4()),
        timeout_ms: Some(timeout_ms.unwrap_or(DEFAULT_TOOL_TIMEOUT_MS)),
        risk_context: json!({
            "workingDir": context.working_dir,
            "activeTabId": context.active_tab_id,
            "workspaceId": context.workspace_id,
            "cancellationRequested": cancellation.is_some_and(|value| value.is_cancelled()),
        }),
        output_contract: output_contract_for_manifest(manifest),
        created_at: now(),
    }
}

pub(super) fn permission_mode_from_input(input: &Value) -> Option<String> {
    input
        .get("permissionMode")
        .or_else(|| input.get("permission_mode"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(super) fn normalized_permission_mode(value: &str) -> String {
    value.trim().replace('-', "_")
}

pub(super) fn policy_mode_gate(
    manifest: &ToolManifest,
    permission_mode: &str,
) -> Result<Option<Value>, NativeToolFailure> {
    match normalized_permission_mode(permission_mode) {
        mode if mode == "deny" => Err(NativeToolFailure::new(
            "permission_denied",
            "Tool-FS permission mode denied this operation before execution.",
            "Do not execute this tool call. Explain the limitation or choose a read-only alternative.",
        )
        .with_detail(json!({
            "toolPath": manifest.path,
            "permissionMode": "deny",
        }))),
        mode if mode == "read_only" && risk_level_mutates(manifest) => {
            Err(NativeToolFailure::new(
                "permission_denied",
                "Tool-FS read-only permission mode blocked this mutating operation.",
                "Use a read-only tool or ask the user to allow mutations before retrying.",
            )
            .with_detail(json!({
                "toolPath": manifest.path,
                "permissionMode": "read_only",
                "riskLevel": manifest.risk_level,
            })))
        }
        mode if mode == "full_access" => Ok(Some(json!({
            "recordType": "policy_decision",
            "mode": "full_access",
            "outcome": "approved",
            "risk": manifest.risk_level,
            "action": manifest.operation,
            "summary": format!("{} {}", manifest.domain, manifest.path),
            "recordedAt": now(),
        }))),
        _ => Ok(None),
    }
}

pub(super) fn attach_policy_mode_decision(mut output: Value, decision: Option<Value>) -> Value {
    let Some(decision) = decision else {
        return output;
    };
    if let Some(object) = output.as_object_mut() {
        object.insert("policyDecision".to_string(), decision.clone());
        if let Some(raw) = object.get_mut("raw").and_then(Value::as_object_mut) {
            raw.insert("policyDecision".to_string(), decision.clone());
        }
    }
    output
}

pub(super) fn policy_snapshot_id(session_id: &str, turn_id: &str) -> String {
    format!("tool-policy-{session_id}-{turn_id}")
}

pub(super) fn output_contract_for_manifest(manifest: Option<&ToolManifest>) -> Value {
    match manifest {
        Some(manifest) => json!({
            "outputKind": manifest.output_kind,
            "activityKind": manifest.activity_kind,
            "rendererHint": manifest.renderer_hint,
            "title": manifest.title,
        }),
        None => json!({
            "outputKind": "json",
            "activityKind": "task",
            "rendererHint": "task",
        }),
    }
}

pub(super) fn push_trace(
    trace: &mut Vec<ToolTraceRecord>,
    operation: &ToolOperationEnvelope,
    phase: &str,
    status: &str,
    message: Option<String>,
    detail: Value,
) {
    trace.push(ToolTraceRecord::new(
        operation.trace_id.clone(),
        operation.op_id.clone(),
        operation.runtime_turn_id.clone(),
        operation.path.clone(),
        phase,
        status,
        message,
        detail,
        now(),
    ));
}

pub(super) fn operation_duration_ms(started_at: &str) -> u64 {
    (iso_ms(&now()) - iso_ms(started_at)).max(0) as u64
}

pub(super) fn scene_for_session(session_id: &str) -> ToolScene {
    let (session_kind, project_bound, working_dir, active_kind, active_skills) = state()
        .lock()
        .ok()
        .map(|state| {
            let snapshot = state
                .sessions
                .get(session_id)
                .map(|session| session.snapshot.clone())
                .unwrap_or(Value::Null);
            let active_kind = [
                "kind",
                "type",
                "tabKind",
                "surfaceKind",
                "appId",
                "softwareId",
            ]
            .into_iter()
            .filter_map(|field| snapshot.get(field).and_then(Value::as_str))
            .filter(|value| !value.trim().is_empty())
            .collect::<Vec<_>>()
            .join(" ");
            (
                snapshot
                    .get("sessionKind")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
                    .map(str::to_string),
                snapshot
                    .get("projectBound")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                snapshot
                    .get("workingDir")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
                    .map(str::to_string),
                (!active_kind.is_empty()).then_some(active_kind),
                state.active_skills.iter().cloned().collect::<Vec<_>>(),
            )
        })
        .unwrap_or((None, false, None, None, Vec::new()));
    let git_repo = working_dir.as_deref().is_some_and(|working_dir| {
        Command::new("git")
            .args(["rev-parse", "--is-inside-work-tree"])
            .current_dir(working_dir)
            .output()
            .ok()
            .is_some_and(|output| output.status.success())
    });
    lyra_tool_fs_core::infer_scene(&lyra_tool_fs_core::ToolSceneSignals {
        session_kind,
        project_bound: project_bound || working_dir.is_some(),
        working_dir,
        git_repo,
        active_tab_kind: active_kind.clone(),
        focused_tab_kind: active_kind,
        active_skills,
        ..lyra_tool_fs_core::ToolSceneSignals::default()
    })
}
