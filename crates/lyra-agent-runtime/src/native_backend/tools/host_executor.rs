use super::*;
pub(crate) fn execute_host_tool_adapter(
    session_id: &str,
    turn_id: &str,
    dispatcher: &Option<Arc<HostCapabilityDispatcher>>,
    cancellation: &Arc<AtomicBool>,
    tool_call_id: &str,
    host_method: &str,
    display_name: &str,
    action: &str,
    input: Value,
    started_at: &str,
) -> Value {
    let input = attach_runtime_cancellation(
        input,
        session_id,
        turn_id,
        tool_call_id,
        display_name,
        action,
    );
    let (input, timeout_ms) = apply_tool_timeout_policy(input, display_name, action);
    let mut policy_decision = None;
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            tool_call_id,
            display_name,
            &tool_label(display_name, action),
            "running",
            input.clone(),
            None,
            started_at,
            None,
        ),
        "toolStarted",
    );
    if let Some(risk) = permission_risk(display_name, action, &input)
        && evaluate_permission_policy(display_name, action, Some(&risk), &input)
            == PermissionPolicyDecision::Deny
    {
        let output = attach_policy_decision_to_output(
            json!({
                "content": "This tool call was denied by the local Lyra Agent permission policy.",
                "error": {
                    "code": "permissionPolicyDenied",
                    "message": "The local permission policy denied this tool request.",
                }
            }),
            Some(policy_denial_decision(display_name, action, &input, &risk)),
        );
        record_tool_activity(
            session_id,
            turn_id,
            tool_activity(
                tool_call_id,
                display_name,
                &tool_label(display_name, action),
                "failed",
                input,
                Some(output.clone()),
                started_at,
                Some(now()),
            ),
            "toolFinished",
        );
        return output;
    }
    if let Some(permission) = permission_request_for_tool(
        session_id,
        turn_id,
        tool_call_id,
        display_name,
        action,
        &input,
    ) {
        let permission_record = permission.clone();
        if cancellation.load(Ordering::SeqCst) {
            return json!({
                "content": "Lyra tool call was cancelled before permission was resolved.",
                "cancelled": true,
            });
        }
        match wait_for_permission_with_cancellation(permission, cancellation) {
            Ok(true) => {
                policy_decision = Some(policy_decision_from_permission(
                    &permission_record,
                    "approved",
                ));
            }
            Ok(false) => {
                let output = attach_policy_decision_to_output(
                    json!({
                        "content": "Permission denied by the user. Do not execute this tool call; choose a safer alternative or explain what cannot proceed.",
                        "error": {
                            "code": "permissionDenied",
                            "message": "The user denied this tool request.",
                        }
                    }),
                    Some(policy_decision_from_permission(
                        &permission_record,
                        "denied",
                    )),
                );
                record_tool_activity(
                    session_id,
                    turn_id,
                    tool_activity(
                        tool_call_id,
                        display_name,
                        &tool_label(display_name, action),
                        "failed",
                        input,
                        Some(output.clone()),
                        started_at,
                        Some(now()),
                    ),
                    "toolFinished",
                );
                return output;
            }
            Err(error) => {
                let cancelled = permission_wait_was_cancelled(&error);
                let output = if cancelled {
                    json!({
                        "content": "Lyra tool call was cancelled before permission was resolved.",
                        "cancelled": true,
                    })
                } else {
                    json!({
                        "content": format!("Permission request failed: {error}"),
                        "error": {
                            "code": "permissionRequestFailed",
                            "message": error.to_string(),
                        }
                    })
                };
                record_tool_activity(
                    session_id,
                    turn_id,
                    tool_activity(
                        tool_call_id,
                        display_name,
                        &tool_label(display_name, action),
                        if cancelled { "cancelled" } else { "failed" },
                        input,
                        Some(output.clone()),
                        started_at,
                        Some(now()),
                    ),
                    "toolFinished",
                );
                return output;
            }
        }
    } else if policy_record_required(display_name, action, &input) {
        policy_decision = Some(auto_approval_policy_decision(display_name, action, &input));
    }
    if cancellation.load(Ordering::SeqCst) {
        record_tool_activity(
            session_id,
            turn_id,
            tool_activity(
                tool_call_id,
                display_name,
                &tool_label(display_name, action),
                "cancelled",
                input.clone(),
                Some(json!({ "content": "Lyra tool call was cancelled." })),
                started_at,
                Some(now()),
            ),
            "toolFinished",
        );
        return json!({
            "content": "Lyra tool call was cancelled.",
            "cancelled": true,
        });
    }
    let raw_result = dispatcher
        .as_ref()
        .ok_or_else(|| "Lyra host capability bridge is not available".to_string())
        .and_then(|dispatcher| {
            invoke_host_capability_with_timeout(
                dispatcher.clone(),
                host_method.to_string(),
                input.clone(),
                timeout_ms,
            )
        });
    if cancellation.load(Ordering::SeqCst) {
        record_tool_activity(
            session_id,
            turn_id,
            tool_activity(
                tool_call_id,
                display_name,
                &tool_label(display_name, action),
                "cancelled",
                input.clone(),
                Some(json!({ "content": "Lyra tool call was cancelled." })),
                started_at,
                Some(now()),
            ),
            "toolFinished",
        );
        return json!({
            "content": "Lyra tool call was cancelled.",
            "cancelled": true,
        });
    }
    let (status, output, finished_input) = match raw_result {
        Ok(mut value) => {
            let user_action_resolution = resolve_host_needs_user_action(
                session_id,
                turn_id,
                tool_call_id,
                display_name,
                action,
                &input,
                &value,
                dispatcher.as_ref(),
            );
            if let Some(resolution) = user_action_resolution.as_ref()
                && let Some(object) = value.as_object_mut()
            {
                object.insert("userActionResolution".to_string(), resolution.clone());
            }
            attach_lumen_screenshot_artifact(
                session_id,
                turn_id,
                tool_call_id,
                display_name,
                action,
                &mut value,
            );
            attach_workbench_visual_evidence_artifact(
                session_id,
                turn_id,
                tool_call_id,
                display_name,
                action,
                &mut value,
            );
            attach_lumen_page_artifact(
                session_id,
                turn_id,
                tool_call_id,
                display_name,
                action,
                &mut value,
            );
            attach_software_image_evidence_artifact(
                session_id,
                turn_id,
                tool_call_id,
                display_name,
                action,
                &input,
                &mut value,
            );
            let activity_input = resolved_tool_activity_input(input.clone(), &value);
            let raw = attach_host_log_artifact(
                session_id,
                turn_id,
                tool_call_id,
                display_name,
                action,
                redacted_tool_raw_output(display_name, action, value.clone()),
            );
            let raw = attach_policy_decision_to_raw(raw, policy_decision.clone());
            let status = if value.get("ok").and_then(Value::as_bool) == Some(false)
                || value.get("error").is_some_and(|value| !value.is_null())
            {
                "failed"
            } else {
                "completed"
            };
            let mut content = format_tool_output(display_name, action, &value);
            if let Some(resolution) = user_action_resolution.as_ref() {
                content.push_str("\n\n");
                content.push_str(&format_user_action_resolution(resolution));
            }
            (
                status,
                json!({
                    "content": content,
                    "raw": raw,
                }),
                activity_input,
            )
        }
        Err(error) => (
            "failed",
            json!({
                "content": format!("Lyra tool failed: {error}"),
                "error": {
                    "code": host_adapter_error_code(&error),
                    "message": error,
                },
            }),
            input.clone(),
        ),
    };
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            tool_call_id,
            display_name,
            &tool_label(display_name, action),
            status,
            finished_input,
            Some(output.clone()),
            started_at,
            Some(now()),
        ),
        "toolFinished",
    );
    output
}
pub(crate) fn host_adapter_error_code(error: &str) -> &'static str {
    let lower = error.to_ascii_lowercase();
    if lower.contains("timed out") || lower.contains("timeout") {
        "timeout"
    } else if lower.contains("host capability bridge is not available") {
        "host_unavailable"
    } else if lower.contains("reply channel closed") {
        "host_channel_closed"
    } else {
        "host_capability_failed"
    }
}

pub(crate) fn host_adapter_arguments(arguments: Value, action: &str) -> Value {
    let mut input = arguments.as_object().cloned().unwrap_or_default();
    input.insert("action".to_string(), Value::String(action.to_string()));
    Value::Object(input)
}

pub(crate) fn browser_host_adapter_arguments(
    arguments: Value,
    action: &str,
    runtime: ToolExecutionRuntime,
) -> Value {
    let mut input = host_adapter_arguments(arguments, action);
    if matches!(action, "see" | "vact")
        && let Some(object) = input.as_object_mut()
    {
        object
            .entry("modelSupportsImageInput".to_string())
            .or_insert(Value::Bool(runtime.supports_image_input));
    }
    input
}

pub(crate) fn software_capability_adapter_arguments(
    arguments: Value,
    software_id: &str,
    action_id: &str,
) -> Value {
    let original_args = arguments
        .pointer("/toolOperation/args")
        .cloned()
        .unwrap_or_else(|| strip_tool_fs_metadata(arguments.clone()));
    let reason = original_args
        .get("reason")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string);
    let mut payload = serde_json::Map::new();
    payload.insert(
        "softwareId".to_string(),
        Value::String(software_id.to_string()),
    );
    payload.insert("actionId".to_string(), Value::String(action_id.to_string()));
    payload.insert(
        "capabilityId".to_string(),
        Value::String(action_id.to_string()),
    );
    payload.insert("input".to_string(), original_args);
    if let Some(reason) = reason {
        payload.insert("reason".to_string(), Value::String(reason));
    }
    for key in ["toolPath", "domain", "operation", "toolOperation"] {
        if let Some(value) = arguments.get(key).cloned() {
            payload.insert(key.to_string(), value);
        }
    }
    Value::Object(payload)
}

pub(crate) fn strip_tool_fs_metadata(arguments: Value) -> Value {
    let mut input = arguments.as_object().cloned().unwrap_or_default();
    for key in ["toolPath", "domain", "operation", "toolOperation", "action"] {
        input.remove(key);
    }
    Value::Object(input)
}
