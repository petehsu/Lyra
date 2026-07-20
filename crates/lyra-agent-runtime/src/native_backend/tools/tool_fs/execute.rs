use super::*;

pub(crate) fn execute_tool_fs_model_tool(
    session_id: &str,
    turn_id: &str,
    dispatcher: &Option<Arc<HostCapabilityDispatcher>>,
    cancellation: &Arc<AtomicBool>,
    runtime: ToolExecutionRuntime,
    call: ModelToolCall,
    started_at: &str,
) -> Value {
    match call.name.as_str() {
        TOOL_FS_SEARCH => {
            let registry = runtime_registry_for_tool_fs_call(
                TOOL_FS_SEARCH,
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
                    let scene = input
                        .get("scene")
                        .and_then(Value::as_str)
                        .map(ToolScene::parse)
                        .unwrap_or_else(|| scene_for_session(session_id));
                    let query = input
                        .get("query")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    let domain = input.get("domain").and_then(Value::as_str);
                    let page = input.get("page").and_then(Value::as_u64).unwrap_or(0) as usize;
                    let page_size = input
                        .get("pageSize")
                        .or_else(|| input.get("page_size"))
                        .and_then(Value::as_u64)
                        .unwrap_or(12) as usize;
                    let usage_boosts = tool_usage_search_boosts(scene.as_str(), turn_id);
                    registry
                        .search_with_boosts(query, domain, page, page_size, scene, &usage_boosts)
                        .map(|response| {
                            serde_json::to_value(response).unwrap_or_else(|_| json!({}))
                        })
                        .map_err(native_failure_from_tool_fs)
                },
            )
        }
        TOOL_FS_LIST => {
            let registry = runtime_registry_for_tool_fs_call(
                TOOL_FS_LIST,
                &call.arguments,
                dispatcher.as_ref(),
            );
            let host_dispatcher = dispatcher.as_ref().cloned();
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
                    match registry.list(path, page, page_size, scene) {
                        Ok(directory) => Ok(with_tool_directory_diagnostics(
                            serde_json::to_value(directory).unwrap_or_else(|_| json!({})),
                            path,
                            host_dispatcher.as_ref(),
                        )),
                        Err(error)
                            if software_capability_directory_requested(path)
                                && error.code == "tool_directory_not_found" =>
                        {
                            Ok(empty_software_capability_directory(
                                page,
                                page_size.clamp(1, 200),
                                software_capability_provider_diagnostics(host_dispatcher.as_ref()),
                            ))
                        }
                        Err(error) => Err(native_failure_from_tool_fs(error)),
                    }
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
            let inspect_session_id = session_id.to_string();
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
                            record_tool_descriptor_inspected(&inspect_session_id, &manifest);
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
            runtime,
            call,
            started_at,
        ),
        _ => tool_failure_output(
            "tool_not_found",
            "Unknown Tool Filesystem operation.",
            "Use tool_fs_search, tool_fs_list, tool_fs_read_doc, tool_fs_inspect, or tool_fs_run.",
            None,
        ),
    }
}

pub(super) fn execute_tool_fs_read_only(
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
        json!({
            "providerTool": call.name,
            "policySnapshotId": operation_envelope.policy_snapshot_id,
            "permissionMode": operation_envelope.permission_mode,
            "timeoutMs": operation_envelope.timeout_ms,
        }),
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
        json!({
            "policySnapshotId": operation_envelope.policy_snapshot_id,
            "permissionMode": operation_envelope.permission_mode,
        }),
    );
    push_trace(
        &mut trace,
        &operation_envelope,
        "permission_checked",
        "ok",
        None,
        json!({
            "policySnapshotId": operation_envelope.policy_snapshot_id,
            "permissionMode": operation_envelope.permission_mode,
        }),
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

pub(super) fn execute_tool_fs_run(
    session_id: &str,
    turn_id: &str,
    dispatcher: &Option<Arc<HostCapabilityDispatcher>>,
    cancellation: &Arc<AtomicBool>,
    runtime: ToolExecutionRuntime,
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
        json!({
            "providerTool": call.name,
            "policySnapshotId": operation_envelope.policy_snapshot_id,
            "permissionMode": operation_envelope.permission_mode,
            "timeoutMs": operation_envelope.timeout_ms,
        }),
    );
    let validation_result = operation_envelope.validate(&registry);
    let manifest = match validation_result {
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
            let target_manifest = registry.inspect_input(&call.arguments).ok();
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
                target_manifest.as_ref(),
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
    if manifest.domain == "filesystem" && risk_level_mutates(&manifest) {
        if let Err(failure) = validate_plan_mutation_for_session(session_id, &manifest.path) {
            push_trace(
                &mut trace,
                &operation_envelope,
                "failed",
                "failed",
                Some(failure.message.clone()),
                json!({ "code": failure.code, "toolPath": manifest.path }),
            );
            return target_failure_envelope(
                Some(&manifest),
                failure,
                &operation_envelope,
                trace,
                operation_duration_ms(started_at),
            );
        }
        if let Err(failure) = validate_artifact_mutation_for_session(session_id, turn_id) {
            push_trace(
                &mut trace,
                &operation_envelope,
                "failed",
                "failed",
                Some(failure.message.clone()),
                json!({ "code": failure.code, "toolPath": manifest.path }),
            );
            return target_failure_envelope(
                Some(&manifest),
                failure,
                &operation_envelope,
                trace,
                operation_duration_ms(started_at),
            );
        }
    }
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
    let target = match runtime_target_for_manifest(&manifest) {
        Some(target) => target,
        None => {
            let failure = NativeToolFailure::new(
                "tool_not_found",
                format!("No runtime adapter is registered for {}", manifest.path),
                "Use tool_fs_list or tool_fs_inspect to choose a supported Tool-FS target.",
            )
            .with_detail(json!({ "toolPath": manifest.path }));
            push_trace(
                &mut trace,
                &operation_envelope,
                "failed",
                "failed",
                Some(failure.message.clone()),
                json!({ "code": failure.code, "toolPath": manifest.path }),
            );
            return target_failure_envelope(
                Some(&manifest),
                failure,
                &operation_envelope,
                trace,
                operation_duration_ms(started_at),
            );
        }
    };
    if let Err(failure) =
        validate_runtime_target_availability(&manifest, &target, dispatcher.as_ref())
    {
        push_trace(
            &mut trace,
            &operation_envelope,
            "failed",
            "failed",
            Some(failure.message.clone()),
            json!({ "code": failure.code, "toolPath": manifest.path }),
        );
        return target_failure_envelope(
            Some(&manifest),
            failure,
            &operation_envelope,
            trace,
            operation_duration_ms(started_at),
        );
    }
    if let Err(failure) = validate_workspace_scope_for_manifest(session_id, &manifest) {
        push_trace(
            &mut trace,
            &operation_envelope,
            "failed",
            "failed",
            Some(failure.message.clone()),
            json!({ "code": failure.code, "toolPath": manifest.path }),
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
        json!({
            "toolPath": manifest.path,
            "toolHandle": manifest.handle,
            "policySnapshotId": operation_envelope.policy_snapshot_id,
            "permissionMode": operation_envelope.permission_mode,
        }),
    );
    let policy_decision = match policy_mode_gate(&manifest, &operation_envelope.permission_mode) {
        Ok(decision) => decision,
        Err(failure) => {
            push_trace(
                &mut trace,
                &operation_envelope,
                "permission_checked",
                "failed",
                Some(failure.message.clone()),
                json!({
                    "code": failure.code,
                    "toolPath": manifest.path,
                    "toolHandle": manifest.handle,
                    "policySnapshotId": operation_envelope.policy_snapshot_id,
                    "permissionMode": operation_envelope.permission_mode,
                    "permissionPolicy": manifest.permission_policy,
                    "riskLevel": manifest.risk_level,
                }),
            );
            return target_failure_envelope(
                Some(&manifest),
                failure,
                &operation_envelope,
                trace,
                operation_duration_ms(started_at),
            );
        }
    };
    push_trace(
        &mut trace,
        &operation_envelope,
        "permission_checked",
        "ok",
        None,
        json!({
            "toolPath": manifest.path,
            "toolHandle": manifest.handle,
            "policySnapshotId": operation_envelope.policy_snapshot_id,
            "permissionMode": operation_envelope.permission_mode,
            "permissionPolicy": manifest.permission_policy,
            "riskLevel": manifest.risk_level,
            "policyDecision": policy_decision,
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
    let raw_output = attach_policy_mode_decision(
        execute_tool_fs_target(ToolFsTargetExecution {
            session_id,
            turn_id,
            dispatcher,
            cancellation,
            runtime,
            tool_call_id: &call.id,
            manifest: &manifest,
            arguments: args.clone(),
        }),
        policy_decision.clone(),
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
