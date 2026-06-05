use super::*;
use anyhow::Context;
use lyra_tool_fs_core::{
    DEFAULT_TOOL_TIMEOUT_MS, PROVIDER_VISIBLE_TOOL_NAMES, TOOL_FS_INSPECT, TOOL_FS_LIST,
    TOOL_FS_READ_DOC, TOOL_FS_RUN, TOOL_FS_SCHEMA_VERSION, ToolChangeRecord, ToolFsError,
    ToolFsRegistry, ToolManifest, ToolManifestProvider, ToolOperationContext,
    ToolOperationEnvelope, ToolResultEnvelope, ToolScene, ToolTraceRecord, provider_tool_names,
};

#[derive(Clone)]
pub(crate) enum RuntimeToolTarget {
    MemoryAdapter {
        tool_name: &'static str,
        action: &'static str,
    },
    Clarification,
    NativeAdapter {
        tool_name: &'static str,
        display_name: &'static str,
        action: &'static str,
    },
    DesignAdapter {
        tool_name: &'static str,
        action: &'static str,
    },
    SkillAdapter {
        tool_name: &'static str,
        action: &'static str,
    },
    McpAdapter {
        tool_name: &'static str,
        action: &'static str,
    },
    HostAdapter {
        host_method: &'static str,
        display_name: &'static str,
        action: &'static str,
    },
    SoftwareCapability {
        software_id: String,
        action_id: String,
    },
    Git,
}

pub(crate) struct RuntimeToolManifestProvider {
    manifests: Vec<ToolManifest>,
}

impl RuntimeToolManifestProvider {
    fn from_runtime(dispatcher: Option<&Arc<HostCapabilityDispatcher>>) -> Self {
        let mut manifests = Vec::new();
        manifests.extend(software_manifests(dispatcher));
        Self { manifests }
    }
}

impl ToolManifestProvider for RuntimeToolManifestProvider {
    fn tool_manifests(&self) -> Vec<ToolManifest> {
        self.manifests.clone()
    }
}

pub(crate) fn runtime_registry() -> ToolFsRegistry {
    runtime_registry_with_dispatcher(None)
}

pub(crate) fn runtime_registry_with_dispatcher(
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> ToolFsRegistry {
    let provider = RuntimeToolManifestProvider::from_runtime(dispatcher);
    ToolFsRegistry::with_providers(&[&provider])
}

fn runtime_registry_for_tool_fs_call(
    tool_name: &str,
    input: &Value,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> ToolFsRegistry {
    if tool_fs_call_needs_dynamic_software(tool_name, input) {
        runtime_registry_with_dispatcher(dispatcher)
    } else {
        runtime_registry()
    }
}

fn tool_fs_call_needs_dynamic_software(tool_name: &str, input: &Value) -> bool {
    let path = input
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .trim_end_matches('/');
    match tool_name {
        TOOL_FS_LIST => {
            path == "/tools/software"
                || path == "/tools/software/capability"
                || path.starts_with("/tools/software/capability/")
        }
        TOOL_FS_READ_DOC | TOOL_FS_INSPECT | TOOL_FS_RUN => {
            path == "/tools/software/capability" || path.starts_with("/tools/software/capability/")
        }
        _ => false,
    }
}

pub(crate) fn is_tool_fs_model_tool(name: &str) -> bool {
    PROVIDER_VISIBLE_TOOL_NAMES.contains(&name)
}

pub(crate) fn model_tool_names() -> Vec<String> {
    provider_tool_names()
}

pub(crate) fn model_provider_tools() -> Vec<Value> {
    vec![
        function_tool(
            TOOL_FS_LIST,
            "List Lyra Tool Filesystem directories and tool manifests. Use /tools first, then list a concrete /tools/<domain> directory.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "default": "/tools" },
                    "page": { "type": "integer", "minimum": 0, "default": 0 },
                    "pageSize": { "type": "integer", "minimum": 1, "maximum": 200, "default": 80 }
                }
            }),
        ),
        function_tool(
            TOOL_FS_READ_DOC,
            "Read concise documentation for a Lyra Tool Filesystem path such as /tools or /tools/filesystem.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "default": "/tools" }
                },
                "required": ["path"]
            }),
        ),
        function_tool(
            TOOL_FS_INSPECT,
            "Inspect one Lyra Tool Filesystem target and get its argument schema. Provide either path or toolHandle.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "toolHandle": { "type": "string" }
                }
            }),
        ),
        function_tool(
            TOOL_FS_RUN,
            "Run one Lyra Tool Filesystem target. Provide path or pinned toolHandle plus args matching the inspected inputSchema.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "toolHandle": { "type": "string" },
                    "args": { "type": "object", "additionalProperties": true, "default": {} }
                },
                "required": ["args"]
            }),
        ),
    ]
}

pub(crate) fn root_summary() -> Value {
    runtime_registry().root_summary()
}

pub(crate) fn pinned_handles_for_scene(scene: &str) -> Value {
    serde_json::to_value(runtime_registry().pinned_handles(ToolScene::parse(scene)))
        .unwrap_or_else(|_| json!([]))
}

fn software_manifests(dispatcher: Option<&Arc<HostCapabilityDispatcher>>) -> Vec<ToolManifest> {
    let Some(dispatcher) = dispatcher else {
        return Vec::new();
    };
    let Ok(value) = invoke_host_capability(
        dispatcher,
        "software.listCapabilities",
        json!({ "includeSchemas": true }),
    ) else {
        return Vec::new();
    };
    value
        .get("software")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(software_action_manifests)
        .collect()
}

fn software_action_manifests(software: &Value) -> Vec<ToolManifest> {
    let software_id = software
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("software");
    let software_title = software
        .get("title")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(software_id);
    software
        .get("actions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|action| {
            let action_id = action
                .get("id")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())?;
            let action_title = action
                .get("title")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(action_id);
            let summary = action
                .get("description")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("Invoke {action_title} in {software_title}."));
            let risk = action
                .get("risk")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("external");
            Some(ToolManifest {
                path: software_capability_path(software_id, action_id),
                handle: None,
                domain: "software".to_string(),
                operation: "invoke_capability".to_string(),
                title: action_title.to_string(),
                summary,
                risk_level: format!("software_{risk}"),
                permission_policy: "host_policy".to_string(),
                input_schema: software_action_input_schema(action),
                output_kind: "json".to_string(),
                activity_kind: "task".to_string(),
                renderer_hint: "software".to_string(),
            })
        })
        .collect()
}

fn software_action_input_schema(action: &Value) -> Value {
    action
        .get("inputSchema")
        .filter(|schema| schema.is_object())
        .cloned()
        .unwrap_or_else(|| json!({ "type": "object", "additionalProperties": true }))
}

fn software_capability_path(software_id: &str, action_id: &str) -> String {
    format!(
        "/tools/software/capability/{}/{}",
        urlencoding::encode(software_id),
        urlencoding::encode(action_id)
    )
}

fn parse_software_capability_path(path: &str) -> Option<(String, String)> {
    let rest = path.strip_prefix("/tools/software/capability/")?;
    let mut parts = rest.split('/');
    let software_id = parts.next().filter(|value| !value.trim().is_empty())?;
    let action_id = parts.next().filter(|value| !value.trim().is_empty())?;
    if parts.next().is_some() {
        return None;
    }
    let software_id = urlencoding::decode(software_id).ok()?.into_owned();
    let action_id = urlencoding::decode(action_id).ok()?.into_owned();
    (!software_id.trim().is_empty() && !action_id.trim().is_empty())
        .then_some((software_id, action_id))
}

pub(crate) fn execute_tool_fs_model_tool(
    session_id: &str,
    turn_id: &str,
    dispatcher: &Option<Arc<HostCapabilityDispatcher>>,
    cancellation: &Arc<AtomicBool>,
    call: ModelToolCall,
    started_at: &str,
) -> Value {
    match call.name.as_str() {
        TOOL_FS_LIST => {
            let registry = runtime_registry_for_tool_fs_call(
                TOOL_FS_LIST,
                &call.arguments,
                dispatcher.as_ref(),
            );
            execute_tool_fs_read_only(
                session_id,
                turn_id,
                call,
                started_at,
                registry,
                |registry, input| {
                    let scene = scene_for_session(session_id);
                    let path = input
                        .get("path")
                        .and_then(Value::as_str)
                        .unwrap_or("/tools");
                    let page = input.get("page").and_then(Value::as_u64).unwrap_or(0) as usize;
                    let page_size = input
                        .get("pageSize")
                        .or_else(|| input.get("page_size"))
                        .and_then(Value::as_u64)
                        .unwrap_or(80) as usize;
                    registry
                        .list(path, page, page_size, scene)
                        .map(|directory| {
                            serde_json::to_value(directory).unwrap_or_else(|_| json!({}))
                        })
                        .map_err(native_failure_from_tool_fs)
                },
            )
        }
        TOOL_FS_READ_DOC => {
            let registry = runtime_registry_for_tool_fs_call(
                TOOL_FS_READ_DOC,
                &call.arguments,
                dispatcher.as_ref(),
            );
            execute_tool_fs_read_only(
                session_id,
                turn_id,
                call,
                started_at,
                registry,
                |registry, input| {
                    registry
                        .read_doc(
                            input
                                .get("path")
                                .and_then(Value::as_str)
                                .unwrap_or("/tools"),
                        )
                        .map_err(native_failure_from_tool_fs)
                },
            )
        }
        TOOL_FS_INSPECT => {
            let registry = runtime_registry_for_tool_fs_call(
                TOOL_FS_INSPECT,
                &call.arguments,
                dispatcher.as_ref(),
            );
            execute_tool_fs_read_only(
                session_id,
                turn_id,
                call,
                started_at,
                registry,
                |registry, input| {
                    registry
                        .inspect_input(input)
                        .map(|manifest| {
                            serde_json::to_value(manifest).unwrap_or_else(|_| json!({}))
                        })
                        .map_err(native_failure_from_tool_fs)
                },
            )
        }
        TOOL_FS_RUN => execute_tool_fs_run(
            session_id,
            turn_id,
            dispatcher,
            cancellation,
            call,
            started_at,
        ),
        _ => tool_failure_output(
            "tool_not_found",
            "Unknown Tool Filesystem operation.",
            "Use tool_fs_list, tool_fs_read_doc, tool_fs_inspect, or tool_fs_run.",
            None,
        ),
    }
}

fn execute_tool_fs_read_only(
    session_id: &str,
    turn_id: &str,
    call: ModelToolCall,
    started_at: &str,
    registry: ToolFsRegistry,
    operation: impl FnOnce(&ToolFsRegistry, &Value) -> Result<Value, NativeToolFailure>,
) -> Value {
    let operation_name = meta_action(&call.name);
    let operation_envelope =
        meta_operation_envelope(session_id, turn_id, operation_name, &call.arguments, None);
    let mut trace = Vec::new();
    push_trace(
        &mut trace,
        &operation_envelope,
        "received",
        "ok",
        None,
        json!({ "providerTool": call.name }),
    );
    if let Err(error) = operation_envelope.validate(&registry) {
        push_trace(
            &mut trace,
            &operation_envelope,
            "failed",
            "failed",
            Some(error.message.clone()),
            json!({ "code": error.code }),
        );
        let output = meta_failure_envelope(
            operation_name,
            native_failure_from_tool_fs(error),
            &operation_envelope,
            trace,
            operation_duration_ms(started_at),
        );
        record_tool_activity(
            session_id,
            turn_id,
            tool_activity(
                &call.id,
                "tool_fs",
                &tool_label("tool_fs", operation_name),
                "failed",
                tool_fs_meta_input(&call.name, call.arguments),
                Some(output.clone()),
                started_at,
                Some(now()),
            ),
            "toolFinished",
        );
        return output;
    }
    if let Err(error) = validate_runtime_turn_for_operation(session_id, turn_id) {
        push_trace(
            &mut trace,
            &operation_envelope,
            "failed",
            "failed",
            Some(error.message.clone()),
            json!({ "code": error.code }),
        );
        let output = meta_failure_envelope(
            operation_name,
            error,
            &operation_envelope,
            trace,
            operation_duration_ms(started_at),
        );
        record_tool_activity(
            session_id,
            turn_id,
            tool_activity(
                &call.id,
                "tool_fs",
                &tool_label("tool_fs", operation_name),
                "failed",
                tool_fs_meta_input(&call.name, call.arguments),
                Some(output.clone()),
                started_at,
                Some(now()),
            ),
            "toolFinished",
        );
        return output;
    }
    push_trace(
        &mut trace,
        &operation_envelope,
        "validated",
        "ok",
        None,
        json!({}),
    );
    push_trace(
        &mut trace,
        &operation_envelope,
        "permission_checked",
        "ok",
        None,
        json!({ "permissionMode": operation_envelope.permission_mode }),
    );
    let input = tool_fs_meta_input(&call.name, call.arguments.clone());
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            "tool_fs",
            &tool_label("tool_fs", meta_action(&call.name)),
            "running",
            input.clone(),
            None,
            started_at,
            None,
        ),
        "toolStarted",
    );
    push_trace(
        &mut trace,
        &operation_envelope,
        "executing",
        "ok",
        None,
        json!({}),
    );
    let (status, output) = match operation(&registry, &call.arguments) {
        Ok(raw) => {
            push_trace(
                &mut trace,
                &operation_envelope,
                "completed",
                "completed",
                None,
                json!({}),
            );
            (
                "completed",
                meta_result_envelope(
                    operation_name,
                    tool_fs_content(&raw),
                    raw,
                    &operation_envelope,
                    trace,
                    operation_duration_ms(started_at),
                ),
            )
        }
        Err(error) => {
            push_trace(
                &mut trace,
                &operation_envelope,
                "failed",
                "failed",
                Some(error.message.clone()),
                json!({ "code": error.code }),
            );
            (
                "failed",
                meta_failure_envelope(
                    operation_name,
                    error,
                    &operation_envelope,
                    trace,
                    operation_duration_ms(started_at),
                ),
            )
        }
    };
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            "tool_fs",
            &tool_label("tool_fs", meta_action(&call.name)),
            status,
            input,
            Some(output.clone()),
            started_at,
            Some(now()),
        ),
        "toolFinished",
    );
    output
}

fn execute_tool_fs_run(
    session_id: &str,
    turn_id: &str,
    dispatcher: &Option<Arc<HostCapabilityDispatcher>>,
    cancellation: &Arc<AtomicBool>,
    call: ModelToolCall,
    started_at: &str,
) -> Value {
    let registry =
        runtime_registry_for_tool_fs_call(TOOL_FS_RUN, &call.arguments, dispatcher.as_ref());
    let mut operation_envelope =
        run_operation_envelope(session_id, turn_id, &call.arguments, cancellation);
    let mut trace = Vec::new();
    push_trace(
        &mut trace,
        &operation_envelope,
        "received",
        "ok",
        None,
        json!({ "providerTool": call.name }),
    );
    let manifest = match operation_envelope.validate(&registry) {
        Ok(Some(manifest)) => manifest,
        Ok(None) => {
            let error = NativeToolFailure::new(
                "tool_target_required",
                "tool_fs_run did not resolve to a target manifest.",
                "Provide a concrete /tools path or pinned handle.",
            );
            push_trace(
                &mut trace,
                &operation_envelope,
                "failed",
                "failed",
                Some(error.message.clone()),
                json!({ "code": error.code }),
            );
            return target_failure_envelope(
                None,
                error,
                &operation_envelope,
                trace,
                operation_duration_ms(started_at),
            );
        }
        Err(error) => {
            let failure = native_failure_from_tool_fs(error);
            push_trace(
                &mut trace,
                &operation_envelope,
                "failed",
                "failed",
                Some(failure.message.clone()),
                json!({ "code": failure.code }),
            );
            return target_failure_envelope(
                None,
                failure,
                &operation_envelope,
                trace,
                operation_duration_ms(started_at),
            );
        }
    };
    operation_envelope.path = Some(manifest.path.clone());
    if operation_envelope.tool_handle.is_none() {
        operation_envelope.tool_handle = manifest.handle.clone();
    }
    operation_envelope.output_contract = output_contract_for_manifest(Some(&manifest));
    if let Err(failure) = validate_runtime_turn_for_operation(session_id, turn_id) {
        push_trace(
            &mut trace,
            &operation_envelope,
            "failed",
            "failed",
            Some(failure.message.clone()),
            json!({ "code": failure.code }),
        );
        return target_failure_envelope(
            Some(&manifest),
            failure,
            &operation_envelope,
            trace,
            operation_duration_ms(started_at),
        );
    }
    push_trace(
        &mut trace,
        &operation_envelope,
        "validated",
        "ok",
        None,
        json!({ "toolPath": manifest.path }),
    );
    push_trace(
        &mut trace,
        &operation_envelope,
        "permission_checked",
        "ok",
        None,
        json!({
            "permissionMode": operation_envelope.permission_mode,
            "permissionPolicy": manifest.permission_policy,
            "riskLevel": manifest.risk_level,
        }),
    );
    if cancellation.load(Ordering::SeqCst) {
        let failure = NativeToolFailure::new(
            "operation_cancelled",
            "Tool-FS operation was cancelled before execution.",
            "Stop this tool call and wait for a new user turn.",
        );
        push_trace(
            &mut trace,
            &operation_envelope,
            "cancelled",
            "cancelled",
            Some(failure.message.clone()),
            json!({ "code": failure.code }),
        );
        return target_failure_envelope(
            Some(&manifest),
            failure,
            &operation_envelope,
            trace,
            operation_duration_ms(started_at),
        );
    }
    push_trace(
        &mut trace,
        &operation_envelope,
        "executing",
        "ok",
        None,
        json!({ "toolPath": manifest.path }),
    );
    let args = inject_manifest_metadata(
        operation_envelope.args.clone(),
        &manifest,
        &operation_envelope,
    );
    let raw_output = execute_tool_fs_target(
        session_id,
        turn_id,
        dispatcher,
        cancellation,
        &call.id,
        &manifest,
        args.clone(),
    );
    let artifacts = collect_artifacts(&raw_output);
    if !artifacts.is_empty() {
        push_trace(
            &mut trace,
            &operation_envelope,
            "artifact_recorded",
            "ok",
            None,
            json!({ "artifactCount": artifacts.len() }),
        );
    }
    let result_status = result_status(&raw_output);
    let terminal_phase = if result_status == "cancelled" {
        "cancelled"
    } else if result_status == "completed" {
        "completed"
    } else {
        "failed"
    };
    push_trace(
        &mut trace,
        &operation_envelope,
        terminal_phase,
        result_status,
        raw_output
            .pointer("/error/message")
            .and_then(Value::as_str)
            .map(str::to_string),
        json!({}),
    );
    result_envelope(
        &manifest,
        &args,
        raw_output,
        &operation_envelope,
        trace,
        operation_duration_ms(started_at),
    )
}

fn operation_context(session_id: &str, turn_id: &str) -> ToolOperationContext {
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

fn run_operation_envelope(
    session_id: &str,
    turn_id: &str,
    input: &Value,
    cancellation: &Arc<AtomicBool>,
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
    )
}

fn meta_operation_envelope(
    session_id: &str,
    turn_id: &str,
    op: &str,
    input: &Value,
    cancellation: Option<&Arc<AtomicBool>>,
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
    )
}

fn runtime_operation_envelope(
    session_id: &str,
    turn_id: &str,
    op: &str,
    path: Option<String>,
    tool_handle: Option<String>,
    args: Value,
    timeout_ms: Option<u64>,
    cancellation: Option<&Arc<AtomicBool>>,
    manifest: Option<&ToolManifest>,
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
        permission_mode: "runtime_policy".to_string(),
        trace_id: format!("trace-{}", Uuid::new_v4()),
        timeout_ms: Some(timeout_ms.unwrap_or(DEFAULT_TOOL_TIMEOUT_MS)),
        risk_context: json!({
            "workingDir": context.working_dir,
            "activeTabId": context.active_tab_id,
            "workspaceId": context.workspace_id,
            "cancellationRequested": cancellation.is_some_and(|value| value.load(Ordering::SeqCst)),
        }),
        output_contract: output_contract_for_manifest(manifest),
        created_at: now(),
    }
}

fn policy_snapshot_id(session_id: &str, turn_id: &str) -> String {
    format!("tool-policy-{session_id}-{turn_id}")
}

fn output_contract_for_manifest(manifest: Option<&ToolManifest>) -> Value {
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

fn push_trace(
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

fn operation_duration_ms(started_at: &str) -> u64 {
    (iso_ms(&now()) - iso_ms(started_at)).max(0) as u64
}

fn scene_for_session(session_id: &str) -> ToolScene {
    let (working_dir, active_kind, active_skills) = state()
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
                    .get("workingDir")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
                    .map(str::to_string),
                (!active_kind.is_empty()).then_some(active_kind),
                state.active_skills.iter().cloned().collect::<Vec<_>>(),
            )
        })
        .unwrap_or((None, None, Vec::new()));
    let git_repo = working_dir.as_deref().is_some_and(|working_dir| {
        Command::new("git")
            .args(["rev-parse", "--is-inside-work-tree"])
            .current_dir(working_dir)
            .output()
            .ok()
            .is_some_and(|output| output.status.success())
    });
    lyra_tool_fs_core::infer_scene(&lyra_tool_fs_core::ToolSceneSignals {
        project_bound: working_dir.is_some(),
        working_dir,
        git_repo,
        active_tab_kind: active_kind.clone(),
        focused_tab_kind: active_kind,
        active_skills,
        ..lyra_tool_fs_core::ToolSceneSignals::default()
    })
}

pub(crate) fn runtime_target_for_manifest(manifest: &ToolManifest) -> Option<RuntimeToolTarget> {
    if let Some((software_id, action_id)) = parse_software_capability_path(&manifest.path) {
        return Some(RuntimeToolTarget::SoftwareCapability {
            software_id,
            action_id,
        });
    }
    if manifest.domain == "terminal"
        && let Some(spec) = terminal_action_spec(&manifest.operation)
    {
        return Some(RuntimeToolTarget::HostAdapter {
            host_method: spec.host_method,
            display_name: "terminal",
            action: spec.action,
        });
    }
    let host = |host_method, display_name, action| RuntimeToolTarget::HostAdapter {
        host_method,
        display_name,
        action,
    };
    let memory = |tool_name, action| RuntimeToolTarget::MemoryAdapter { tool_name, action };
    let native = |tool_name, display_name, action| RuntimeToolTarget::NativeAdapter {
        tool_name,
        display_name,
        action,
    };
    let design = |tool_name, action| RuntimeToolTarget::DesignAdapter { tool_name, action };
    let skill = |tool_name, action| RuntimeToolTarget::SkillAdapter { tool_name, action };
    let mcp = |tool_name, action| RuntimeToolTarget::McpAdapter { tool_name, action };
    let git = RuntimeToolTarget::Git;
    Some(match manifest.path.as_str() {
        "/tools/runtime/artifact_read" => native("artifact_read", "artifact", "read"),
        "/tools/memory/search" => memory("memory_search", "search"),
        "/tools/memory/remember" => memory("memory_remember", "remember"),
        "/tools/memory/update" => memory("memory_update", "update"),
        "/tools/memory/forget" => memory("memory_forget", "forget"),
        "/tools/memory/list" => memory("memory_list", "list"),
        "/tools/memory/link" => memory("memory_link", "link"),
        "/tools/memory/review_candidates" => {
            memory("memory_review_candidates", "review_candidates")
        }
        "/tools/memory/apply_candidate" => memory("memory_apply_candidate", "apply_candidate"),
        "/tools/memory/reject_candidate" => memory("memory_reject_candidate", "reject_candidate"),
        "/tools/memory/explain_injection" => {
            memory("memory_explain_injection", "explain_injection")
        }
        "/tools/clarification/ask" => RuntimeToolTarget::Clarification,
        "/tools/workbench/list_tabs" => host("workbench.listTabs", "workbench", "list_tabs"),
        "/tools/workbench/read_workspace" => {
            host("workbench.readWorkspace", "workbench", "read_workspace")
        }
        "/tools/workbench/read_tab" => host("workbench.readTab", "workbench", "read_tab"),
        "/tools/workbench/activate_tab" => {
            host("workbench.activateTab", "workbench", "activate_tab")
        }
        "/tools/software/list_capabilities" => {
            host("software.listCapabilities", "software", "list_capabilities")
        }
        "/tools/software/inspect_capability" => host(
            "software.inspectCapability",
            "software",
            "inspect_capability",
        ),
        "/tools/software/read_state" => host("software.readState", "software", "read_state"),
        "/tools/software/invoke_capability" => {
            host("software.invokeCapability", "software", "invoke_capability")
        }
        "/tools/browser/map" => host("lyraLumen.map", "lyra_lumen", "map"),
        "/tools/browser/read" => host("lyraLumen.read", "lyra_lumen", "read"),
        "/tools/browser/see" => host("lyraLumen.see", "lyra_lumen", "see"),
        "/tools/browser/act" => host("lyraLumen.act", "lyra_lumen", "act"),
        "/tools/browser/type" => host("lyraLumen.type", "lyra_lumen", "type"),
        "/tools/browser/press" => host("lyraLumen.press", "lyra_lumen", "press"),
        "/tools/browser/submit" => host("lyraLumen.submit", "lyra_lumen", "submit"),
        "/tools/browser/wait" => host("lyraLumen.wait", "lyra_lumen", "wait"),
        "/tools/browser/read_until" => host("lyraLumen.wait", "lyra_lumen", "read_until"),
        "/tools/browser/navigate" => host("lyraLumen.navigate", "lyra_lumen", "navigate"),
        "/tools/browser/reveal" => host("lyraLumen.reveal", "lyra_lumen", "reveal"),
        "/tools/browser/focus_scan" => host("lyraLumen.focusScan", "lyra_lumen", "focus_scan"),
        "/tools/browser/follow_audit" => {
            host("lyraLumen.followAudit", "lyra_lumen", "follow_audit")
        }
        "/tools/browser/explain_target" => {
            host("lyraLumen.explainTarget", "lyra_lumen", "explain_target")
        }
        "/tools/browser/audit" => host("lyraLumen.audit", "lyra_lumen", "audit"),
        "/tools/browser/elevate" => host("lyraLumen.elevate", "lyra_lumen", "elevate"),
        "/tools/filesystem/list_files" => native("file_list", "file", "list"),
        "/tools/filesystem/read_file" | "/tools/filesystem/read_range" => {
            native("file_read", "file", "read")
        }
        "/tools/filesystem/glob" => native("file_glob", "file", "glob"),
        "/tools/filesystem/write_file" => native("file_write", "file", "write"),
        "/tools/filesystem/edit_file" => native("file_edit", "file", "edit"),
        "/tools/filesystem/multi_edit" => native("file_multiedit", "file", "multiedit"),
        "/tools/filesystem/apply_patch" => native("apply_patch", "file", "apply_patch"),
        "/tools/code/search_project" => native("project_search", "search", "project"),
        "/tools/code/search_code" => native("code_search_text", "code", "search_text"),
        "/tools/code/search_symbol" => native("code_search_symbol", "code", "search_symbol"),
        "/tools/code/graph_expand" => native("code_graph_expand", "code", "graph_expand"),
        "/tools/code/lsp_query" => native("lsp_query", "lsp", "query"),
        "/tools/shell/run_command" => native("shell_run", "shell", "run"),
        "/tools/git/status" | "/tools/git/diff" | "/tools/git/stage" | "/tools/git/unstage"
        | "/tools/git/discard" | "/tools/git/log" | "/tools/git/show" | "/tools/git/branch" => git,
        "/tools/network/status" => native("network_status", "network", "status"),
        "/tools/web/search" => native("web_search", "web", "search"),
        "/tools/web/fetch" => native("web_fetch", "web", "fetch"),
        "/tools/render/surface" => native("render_surface", "render", "surface"),
        "/tools/todo/read" => native("todo_read", "todo", "read"),
        "/tools/todo/write" => native("todo_write", "todo", "write"),
        "/tools/design/search_styles" => design("lyra_design_search_styles", "search_styles"),
        "/tools/design/get_style_details" => {
            design("lyra_design_get_style_details", "get_style_details")
        }
        "/tools/skills/list" => skill("skill_list", "list"),
        "/tools/skills/inspect" => skill("skill_inspect", "inspect"),
        "/tools/skills/activate" => skill("skill_activate", "activate"),
        "/tools/skills/deactivate" => skill("skill_deactivate", "deactivate"),
        "/tools/mcp/server_list" => mcp("mcp_server_list", "server_list"),
        "/tools/mcp/server_connect" => mcp("mcp_server_connect", "server_connect"),
        "/tools/mcp/server_disconnect" => mcp("mcp_server_disconnect", "server_disconnect"),
        "/tools/mcp/server_reload" => mcp("mcp_server_reload", "server_reload"),
        "/tools/mcp/tool_discover" => mcp("mcp_tool_discover", "tool_discover"),
        "/tools/mcp/tool_inspect" => mcp("mcp_tool_inspect", "tool_inspect"),
        "/tools/mcp/tool_execute" => mcp("mcp_tool_execute", "tool_execute"),
        _ => return None,
    })
}

pub(crate) fn execute_git_tool_fs_tool(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    manifest: &ToolManifest,
    args: Value,
    started_at: &str,
) -> Value {
    let input = with_session_working_dir(session_id, args);
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            tool_call_id,
            "git",
            &tool_label("git", &manifest.operation),
            "running",
            input.clone(),
            None,
            started_at,
            None,
        ),
        "toolStarted",
    );
    let payload = serde_json::to_string(&input).unwrap_or_else(|_| "{}".to_string());
    let raw_result = match manifest.operation.as_str() {
        "status" => crate::git_runtime::git_status_json(payload),
        "diff" => crate::git_runtime::git_diff_json(payload),
        "stage" => crate::git_runtime::git_stage_json(payload),
        "unstage" => crate::git_runtime::git_unstage_json(payload),
        "discard" => crate::git_runtime::git_discard_json(payload),
        "log" => crate::git_runtime::git_log_json(payload),
        "show" => crate::git_runtime::git_show_json(payload),
        "branch" => crate::git_runtime::git_branch_json(payload),
        _ => Err(anyhow::anyhow!("unknown git operation")),
    }
    .and_then(|text| serde_json::from_str::<Value>(&text).context("decode git tool output"));
    let (status, output) = match raw_result {
        Ok(raw) => (
            "completed",
            json!({
                "content": format_git_output(&manifest.operation, &raw),
                "raw": raw,
            }),
        ),
        Err(error) => (
            "failed",
            tool_failure_output(
                "git_tool_failed",
                &format!("Git tool failed: {error}"),
                "Inspect the Git tool input and retry with a valid workingDir/path/ref.",
                Some(json!({ "operation": manifest.operation })),
            ),
        ),
    };
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            tool_call_id,
            "git",
            &tool_label("git", &manifest.operation),
            status,
            input,
            Some(output.clone()),
            started_at,
            Some(now()),
        ),
        "toolFinished",
    );
    output
}

fn validate_runtime_turn_for_operation(
    session_id: &str,
    turn_id: &str,
) -> Result<(), NativeToolFailure> {
    let state = state().lock().map_err(|_| {
        NativeToolFailure::new(
            "runtime_state_unavailable",
            "agent runtime state lock failed",
            "Retry the tool call.",
        )
    })?;
    let session = state.sessions.get(session_id).ok_or_else(|| {
        NativeToolFailure::new(
            "session_not_found",
            format!("Agent session was not found: {session_id}"),
            "Create or restore an Agent session before running tools.",
        )
    })?;
    let active_turn = session
        .snapshot
        .get("activeTurnId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let status = session
        .snapshot
        .get("turnStatus")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if status != "running" || active_turn != turn_id {
        return Err(NativeToolFailure::new(
            "runtime_turn_not_active",
            format!("Runtime turn {turn_id} is not active for session {session_id}."),
            "Stop this tool call and wait for the active Agent turn.",
        )
        .with_detail(json!({
            "turnStatus": status,
            "activeTurnId": active_turn,
        })));
    }
    let turn_exists = session.runtime_turns.iter().any(|turn| {
        turn.get("runtimeTurnId").and_then(Value::as_str) == Some(turn_id)
            && turn.get("sessionId").and_then(Value::as_str) == Some(session_id)
    });
    if !turn_exists {
        return Err(NativeToolFailure::new(
            "missing_runtime_turn",
            format!("Runtime turn record was not found: {turn_id}"),
            "Retry inside a valid Agent runtime turn.",
        ));
    }
    if state.cancelled_turns.contains(turn_id) {
        return Err(NativeToolFailure::new(
            "operation_cancelled",
            "Tool-FS operation was cancelled before execution.",
            "Stop this tool call and wait for a new user turn.",
        ));
    }
    Ok(())
}

pub(crate) fn path_for_activity(name: &str, action: &str) -> Option<String> {
    let registry = runtime_registry();
    registry
        .manifests()
        .iter()
        .find(|manifest| {
            if manifest.domain == name && manifest.operation == action {
                return true;
            }
            if name == "lyra_lumen" && manifest.domain == "browser" && manifest.operation == action
            {
                return true;
            }
            if name == "file" && manifest.domain == "filesystem" && manifest.operation == action {
                return true;
            }
            if name == "search" && manifest.path == "/tools/code/search_project" {
                return true;
            }
            if name == "code" && manifest.domain == "code" && manifest.operation == action {
                return true;
            }
            if name == "lsp" && manifest.path == "/tools/code/lsp_query" && action == "query" {
                return true;
            }
            if name == "artifact" && manifest.path == "/tools/runtime/artifact_read" {
                return true;
            }
            if name == "lyra_design" && manifest.domain == "design" && manifest.operation == action
            {
                return true;
            }
            false
        })
        .map(|manifest| manifest.path.clone())
}

fn native_failure_from_tool_fs(error: ToolFsError) -> NativeToolFailure {
    NativeToolFailure {
        code: error.code,
        message: error.message,
        recommended_next_action: error.recommended_next_action,
        detail: error.detail,
    }
}

fn tool_fs_content(raw: &Value) -> String {
    match raw.get("kind").and_then(Value::as_str) {
        Some("tool_fs_directory") => {
            let path = raw.get("path").and_then(Value::as_str).unwrap_or("/tools");
            let directories = raw
                .get("directories")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0);
            let tools = raw
                .get("tools")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0);
            format!("Listed {path}: {directories} directories, {tools} tools.")
        }
        Some("tool_manifest") => format!(
            "Inspected {}.",
            raw.get("path").and_then(Value::as_str).unwrap_or("tool")
        ),
        Some("tool_fs_doc") => raw
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("Tool documentation.")
            .to_string(),
        _ => serde_json::to_string_pretty(raw).unwrap_or_default(),
    }
}

fn tool_fs_meta_input(name: &str, arguments: Value) -> Value {
    let mut input = arguments.as_object().cloned().unwrap_or_default();
    input.insert(
        "action".to_string(),
        Value::String(meta_action(name).to_string()),
    );
    input.insert(
        "toolPath".to_string(),
        Value::String(format!("/tools/runtime/{name}")),
    );
    input.insert("domain".to_string(), Value::String("runtime".to_string()));
    input.insert(
        "operation".to_string(),
        Value::String(meta_action(name).to_string()),
    );
    Value::Object(input)
}

fn meta_action(name: &str) -> &'static str {
    match name {
        TOOL_FS_LIST => "list",
        TOOL_FS_READ_DOC => "read_doc",
        TOOL_FS_INSPECT => "inspect",
        TOOL_FS_RUN => "run",
        _ => "tool_fs",
    }
}

fn meta_result_envelope(
    operation: &str,
    content: String,
    raw: Value,
    operation_envelope: &ToolOperationEnvelope,
    trace: Vec<ToolTraceRecord>,
    duration_ms: u64,
) -> Value {
    result_envelope_value(
        ToolResultEnvelope {
            schema_version: TOOL_FS_SCHEMA_VERSION,
            status: "completed".to_string(),
            runtime_turn_id: operation_envelope.runtime_turn_id.clone(),
            duration_ms,
            trace_id: operation_envelope.trace_id.clone(),
            ok: true,
            content,
            raw,
            tool_path: format!("/tools/runtime/tool_fs_{operation}"),
            domain: "runtime".to_string(),
            operation: operation.to_string(),
            artifacts: Vec::new(),
            artifact_refs: Vec::new(),
            projection_ref: None,
            data_ref: None,
            stdout_ref: None,
            stderr_ref: None,
            changes: Vec::new(),
            error: None,
            not_run_reason: None,
        },
        operation_envelope,
        trace,
        None,
    )
}

fn meta_failure_envelope(
    operation: &str,
    error: NativeToolFailure,
    operation_envelope: &ToolOperationEnvelope,
    trace: Vec<ToolTraceRecord>,
    duration_ms: u64,
) -> Value {
    let error_value = native_failure_value(&error);
    result_envelope_value(
        ToolResultEnvelope {
            schema_version: TOOL_FS_SCHEMA_VERSION,
            status: "failed".to_string(),
            runtime_turn_id: operation_envelope.runtime_turn_id.clone(),
            duration_ms,
            trace_id: operation_envelope.trace_id.clone(),
            ok: false,
            content: format!("Lyra tool failed: {}", error.message),
            raw: json!({}),
            tool_path: format!("/tools/runtime/tool_fs_{operation}"),
            domain: "runtime".to_string(),
            operation: operation.to_string(),
            artifacts: Vec::new(),
            artifact_refs: Vec::new(),
            projection_ref: None,
            data_ref: None,
            stdout_ref: None,
            stderr_ref: None,
            changes: Vec::new(),
            error: Some(error_value),
            not_run_reason: Some(error.code),
        },
        operation_envelope,
        trace,
        None,
    )
}

fn inject_manifest_metadata(
    args: Value,
    manifest: &ToolManifest,
    operation_envelope: &lyra_tool_fs_core::ToolOperationEnvelope,
) -> Value {
    let mut input = args.as_object().cloned().unwrap_or_default();
    input.insert("toolPath".to_string(), Value::String(manifest.path.clone()));
    input.insert("domain".to_string(), Value::String(manifest.domain.clone()));
    input.insert(
        "operation".to_string(),
        Value::String(manifest.operation.clone()),
    );
    input.insert(
        "toolOperation".to_string(),
        serde_json::to_value(operation_envelope).unwrap_or_else(|_| Value::Null),
    );
    Value::Object(input)
}

fn target_failure_envelope(
    manifest: Option<&ToolManifest>,
    error: NativeToolFailure,
    operation_envelope: &ToolOperationEnvelope,
    trace: Vec<ToolTraceRecord>,
    duration_ms: u64,
) -> Value {
    let tool_path = manifest
        .map(|manifest| manifest.path.clone())
        .or_else(|| operation_envelope.path.clone())
        .unwrap_or_else(|| "/tools/runtime/tool_fs_run".to_string());
    let domain = manifest
        .map(|manifest| manifest.domain.clone())
        .or_else(|| {
            tool_path
                .trim_start_matches("/tools/")
                .split('/')
                .next()
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "runtime".to_string());
    let operation = manifest
        .map(|manifest| manifest.operation.clone())
        .unwrap_or_else(|| "run".to_string());
    let error_value = native_failure_value(&error);
    result_envelope_value(
        ToolResultEnvelope {
            schema_version: TOOL_FS_SCHEMA_VERSION,
            status: if error.code == "operation_cancelled" {
                "cancelled".to_string()
            } else {
                "failed".to_string()
            },
            runtime_turn_id: operation_envelope.runtime_turn_id.clone(),
            duration_ms,
            trace_id: operation_envelope.trace_id.clone(),
            ok: false,
            content: format!("Lyra tool failed: {}", error.message),
            raw: json!({}),
            tool_path,
            domain,
            operation,
            artifacts: Vec::new(),
            artifact_refs: Vec::new(),
            projection_ref: None,
            data_ref: None,
            stdout_ref: None,
            stderr_ref: None,
            changes: Vec::new(),
            error: Some(error_value),
            not_run_reason: Some(error.code),
        },
        operation_envelope,
        trace,
        manifest,
    )
}

fn result_envelope(
    manifest: &ToolManifest,
    args: &Value,
    output: Value,
    operation_envelope: &ToolOperationEnvelope,
    trace: Vec<ToolTraceRecord>,
    duration_ms: u64,
) -> Value {
    let error = output
        .get("error")
        .filter(|value| !value.is_null())
        .cloned();
    let status = result_status(&output);
    let ok = status == "completed";
    let content = output
        .get("content")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| serde_json::to_string_pretty(&output).unwrap_or_default());
    let raw = output.get("raw").cloned().unwrap_or_else(|| output.clone());
    let artifacts = collect_artifacts(&output);
    let data_ref = first_artifact_like(&output, &["artifactRef", "dataRef"]);
    let projection_ref = first_artifact_like(&output, &["projectionRef"]);
    let stdout_ref = first_artifact_like(&output, &["stdoutRef", "stdoutArtifactRef"]);
    let stderr_ref = first_artifact_like(&output, &["stderrRef", "stderrArtifactRef"]);
    let changes = infer_changes(manifest, args, &output);
    let envelope = ToolResultEnvelope {
        schema_version: TOOL_FS_SCHEMA_VERSION,
        status: status.to_string(),
        runtime_turn_id: operation_envelope.runtime_turn_id.clone(),
        duration_ms,
        trace_id: operation_envelope.trace_id.clone(),
        ok,
        content,
        raw,
        tool_path: manifest.path.clone(),
        domain: manifest.domain.clone(),
        operation: manifest.operation.clone(),
        artifacts: artifacts.clone(),
        artifact_refs: artifacts,
        projection_ref,
        data_ref,
        stdout_ref,
        stderr_ref,
        changes,
        error,
        not_run_reason: not_run_reason(&output),
    };
    let mut envelope = result_envelope_value(envelope, operation_envelope, trace, Some(manifest));
    preserve_output_fields(&mut envelope, &output);
    envelope
}

fn result_envelope_value(
    envelope: ToolResultEnvelope,
    operation_envelope: &ToolOperationEnvelope,
    trace: Vec<ToolTraceRecord>,
    manifest: Option<&ToolManifest>,
) -> Value {
    let mut value = serde_json::to_value(envelope).unwrap_or_else(|_| json!({}));
    let Some(object) = value.as_object_mut() else {
        return value;
    };
    object.insert(
        "toolOperation".to_string(),
        serde_json::to_value(operation_envelope).unwrap_or_else(|_| Value::Null),
    );
    object.insert(
        "trace".to_string(),
        serde_json::to_value(trace).unwrap_or_else(|_| json!([])),
    );
    if let Some(manifest) = manifest {
        object.insert(
            "manifestTitle".to_string(),
            Value::String(manifest.title.clone()),
        );
        object.insert(
            "activityKind".to_string(),
            Value::String(manifest.activity_kind.clone()),
        );
        object.insert(
            "rendererHint".to_string(),
            Value::String(manifest.renderer_hint.clone()),
        );
    }
    value
}

fn preserve_output_fields(envelope: &mut Value, output: &Value) {
    let Some(envelope_object) = envelope.as_object_mut() else {
        return;
    };
    if let Some(output_object) = output.as_object() {
        for (key, value) in output_object {
            envelope_object
                .entry(key.to_string())
                .or_insert_with(|| value.clone());
        }
    }
}

fn result_status(output: &Value) -> &'static str {
    if output.get("cancelled").and_then(Value::as_bool) == Some(true) {
        return "cancelled";
    }
    if output.get("error").is_some_and(|value| !value.is_null())
        || output
            .get("raw")
            .and_then(|raw| raw.get("ok"))
            .and_then(Value::as_bool)
            == Some(false)
        || output
            .get("raw")
            .and_then(|raw| raw.get("success"))
            .and_then(Value::as_bool)
            == Some(false)
    {
        return "failed";
    }
    "completed"
}

fn native_failure_value(error: &NativeToolFailure) -> Value {
    json!({
        "code": error.code,
        "message": error.message,
        "detail": error.detail,
        "recommendedNextAction": error.recommended_next_action,
    })
}

fn not_run_reason(output: &Value) -> Option<String> {
    if output.get("cancelled").and_then(Value::as_bool) == Some(true) {
        return Some("cancelled".to_string());
    }
    output
        .pointer("/error/code")
        .and_then(Value::as_str)
        .filter(|value| {
            matches!(
                *value,
                "permission_denied"
                    | "permissionDenied"
                    | "permission_required"
                    | "operation_cancelled"
                    | "cancelled"
            )
        })
        .map(str::to_string)
}

fn collect_artifacts(output: &Value) -> Vec<Value> {
    let mut artifacts = Vec::new();
    for source in [Some(output), output.get("raw")] {
        let Some(source) = source else {
            continue;
        };
        for key in [
            "artifactRef",
            "diffArtifactRef",
            "projectionRef",
            "dataRef",
            "stdoutRef",
            "stderrRef",
            "stdoutArtifactRef",
            "stderrArtifactRef",
            "logArtifactRef",
        ] {
            if let Some(artifact) = source.get(key).filter(|value| value.is_object()) {
                artifacts.push(artifact.clone());
            }
        }
        if let Some(raw_artifacts) = source.get("artifacts").and_then(Value::as_array) {
            artifacts.extend(
                raw_artifacts
                    .iter()
                    .filter(|value| value.is_object())
                    .cloned(),
            );
        }
    }
    dedupe_values(artifacts)
}

fn first_artifact_like(output: &Value, keys: &[&str]) -> Option<Value> {
    for source in [Some(output), output.get("raw")] {
        let Some(source) = source else {
            continue;
        };
        for key in keys {
            if let Some(value) = source.get(*key).filter(|value| value.is_object()) {
                return Some(value.clone());
            }
        }
    }
    None
}

fn dedupe_values(values: Vec<Value>) -> Vec<Value> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .filter(|value| {
            serde_json::to_string(value)
                .ok()
                .is_none_or(|key| seen.insert(key))
        })
        .collect()
}

fn infer_changes(manifest: &ToolManifest, args: &Value, output: &Value) -> Vec<ToolChangeRecord> {
    let path = args
        .get("path")
        .or_else(|| args.get("file"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let diff_ref = first_artifact_like(output, &["diffArtifactRef"]);
    let change = |kind: &str,
                  operation: &str,
                  path: Option<String>,
                  summary: &str,
                  detail: Value,
                  reversible: bool,
                  diff_ref: Option<Value>|
     -> ToolChangeRecord {
        ToolChangeRecord {
            schema_version: TOOL_FS_SCHEMA_VERSION,
            change_id: format!("change-{}", Uuid::new_v4()),
            kind: kind.to_string(),
            operation: operation.to_string(),
            path,
            summary: summary.to_string(),
            detail,
            reversible,
            before_ref: None,
            after_ref: None,
            diff_ref,
        }
    };
    match (manifest.domain.as_str(), manifest.operation.as_str()) {
        ("filesystem", "write" | "edit" | "multiedit" | "apply_patch") => {
            let changed_files = output
                .pointer("/raw/changedFiles")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if changed_files.is_empty() {
                return vec![change(
                    "file",
                    &manifest.operation,
                    path,
                    "Filesystem mutation executed.",
                    args.clone(),
                    true,
                    diff_ref,
                )];
            }
            changed_files
                .into_iter()
                .map(|file| {
                    let operation = file
                        .get("operation")
                        .and_then(Value::as_str)
                        .unwrap_or(&manifest.operation)
                        .to_string();
                    let path = file.get("path").and_then(Value::as_str).map(str::to_string);
                    change(
                        "file",
                        &operation,
                        path,
                        "Filesystem mutation executed.",
                        file,
                        true,
                        diff_ref.clone(),
                    )
                })
                .collect()
        }
        ("shell", "run") => vec![change(
            "process",
            "run",
            None,
            "Shell command executed.",
            json!({
                "command": output.pointer("/raw/command").cloned().unwrap_or_else(|| args.get("command").cloned().unwrap_or(Value::Null)),
                "cwd": output.pointer("/raw/cwd").cloned().unwrap_or_else(|| args.get("cwd").cloned().unwrap_or(Value::Null)),
                "exitCode": output.pointer("/raw/exitCode").cloned().unwrap_or(Value::Null),
                "success": output.pointer("/raw/success").cloned().unwrap_or(Value::Null),
                "timedOut": output.pointer("/raw/timedOut").cloned().unwrap_or(Value::Null),
                "stdoutRef": first_artifact_like(output, &["stdoutRef", "stdoutArtifactRef"]),
                "stderrRef": first_artifact_like(output, &["stderrRef", "stderrArtifactRef"]),
            }),
            false,
            None,
        )],
        ("terminal", operation)
            if matches!(
                operation,
                "create"
                    | "close"
                    | "write"
                    | "run"
                    | "input"
                    | "keys"
                    | "resize"
                    | "signal"
                    | "act"
                    | "attach_agent"
                    | "detach_agent"
            ) =>
        {
            vec![change(
                "terminal",
                operation,
                None,
                "Terminal state changed.",
                args.clone(),
                false,
                first_artifact_like(output, &["logArtifactRef", "artifactRef"]),
            )]
        }
        ("git", "stage" | "unstage" | "discard") => vec![change(
            "git",
            &manifest.operation,
            path,
            "Git working tree mutation executed.",
            args.clone(),
            manifest.operation != "discard",
            diff_ref,
        )],
        _ => Vec::new(),
    }
}

fn with_session_working_dir(session_id: &str, args: Value) -> Value {
    let mut input = args.as_object().cloned().unwrap_or_default();
    let has_working_dir = input
        .get("workingDir")
        .or_else(|| input.get("working_dir"))
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty());
    if !has_working_dir && let Some(working_dir) = session_working_dir(session_id) {
        input.insert("workingDir".to_string(), Value::String(working_dir));
    }
    Value::Object(input)
}

fn session_working_dir(session_id: &str) -> Option<String> {
    state().lock().ok().and_then(|state| {
        state
            .sessions
            .get(session_id)
            .and_then(|session| session.snapshot.get("workingDir"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
    })
}

fn format_git_output(operation: &str, raw: &Value) -> String {
    match operation {
        "status" => {
            let branch = raw
                .get("branch")
                .and_then(Value::as_str)
                .unwrap_or("detached");
            let changed = raw
                .pointer("/summary/changed")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            format!("Git status on {branch}: {changed} changed files.")
        }
        "diff" => format!(
            "Git diff for {}.",
            raw.get("path").and_then(Value::as_str).unwrap_or("path")
        ),
        "log" => format!(
            "Git log: {} commits.",
            raw.get("commits")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0)
        ),
        "show" => format!(
            "Git show {}.",
            raw.get("ref").and_then(Value::as_str).unwrap_or("ref")
        ),
        "branch" => format!(
            "Git branch: {}.",
            raw.get("current")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
        ),
        "stage" | "unstage" | "discard" => "Git mutation completed.".to_string(),
        _ => serde_json::to_string_pretty(raw).unwrap_or_default(),
    }
}
