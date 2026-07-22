use super::*;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum BrowserActionEffect {
    Observe,
    Navigate,
    EditDraft,
    SubmitExternal,
    Authorize,
    Purchase,
    Delete,
    Upload,
    Download,
    Communicate,
}

#[derive(Clone, Debug)]
pub(crate) struct BrowserActionEffectFailure {
    pub(crate) code: &'static str,
    pub(crate) message: String,
    pub(crate) detail: Value,
}

fn browser_action_requires_effect(display_name: &str, action: &str) -> bool {
    matches!(
        (display_name, action),
        (
            "lyra_lumen",
            "act" | "vact" | "type" | "press" | "submit" | "navigate" | "reload" | "elevate"
        ) | ("lyra_ax", "act" | "press")
    )
}

fn parse_browser_action_effect(
    input: &Value,
) -> Result<BrowserActionEffect, BrowserActionEffectFailure> {
    let Some(effect) = input.get("effect").and_then(Value::as_str) else {
        return Err(BrowserActionEffectFailure {
            code: "missing_browser_action_effect",
            message: "State-changing browser actions require a declared effect.".to_string(),
            detail: json!({ "requiredField": "effect" }),
        });
    };
    let parsed = match effect {
        "observe" => BrowserActionEffect::Observe,
        "navigate" => BrowserActionEffect::Navigate,
        "editDraft" => BrowserActionEffect::EditDraft,
        "submitExternal" => BrowserActionEffect::SubmitExternal,
        "authorize" => BrowserActionEffect::Authorize,
        "purchase" => BrowserActionEffect::Purchase,
        "delete" => BrowserActionEffect::Delete,
        "upload" => BrowserActionEffect::Upload,
        "download" => BrowserActionEffect::Download,
        "communicate" => BrowserActionEffect::Communicate,
        "unknown" => {
            return Err(BrowserActionEffectFailure {
                code: "browser_action_effect_unknown",
                message: "Browser action effect is unknown; Lyra failed closed.".to_string(),
                detail: json!({ "effect": effect }),
            });
        }
        _ => {
            return Err(BrowserActionEffectFailure {
                code: "invalid_browser_action_effect",
                message: "Browser action effect is not part of the native action-effect contract."
                    .to_string(),
                detail: json!({ "effect": effect }),
            });
        }
    };
    Ok(parsed)
}

fn browser_press_is_observational(input: &Value) -> bool {
    matches!(
        input.get("key").and_then(Value::as_str),
        Some(
            "Tab"
                | "Shift+Tab"
                | "ArrowUp"
                | "ArrowDown"
                | "ArrowLeft"
                | "ArrowRight"
                | "Escape"
                | "Home"
                | "End"
                | "PageUp"
                | "PageDown"
        )
    )
}

pub(crate) fn validate_browser_action_effect(
    display_name: &str,
    action: &str,
    input: &Value,
) -> Result<Option<BrowserActionEffect>, BrowserActionEffectFailure> {
    if !browser_action_requires_effect(display_name, action) {
        return Ok(None);
    }
    let effect = parse_browser_action_effect(input)?;
    let interaction = input
        .get("interaction")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let valid = match (display_name, action) {
        ("lyra_lumen", "navigate" | "reload") => effect == BrowserActionEffect::Navigate,
        ("lyra_lumen", "type") => effect == BrowserActionEffect::EditDraft,
        ("lyra_lumen", "elevate") => effect == BrowserActionEffect::Authorize,
        ("lyra_lumen", "submit") => matches!(
            effect,
            BrowserActionEffect::SubmitExternal
                | BrowserActionEffect::Authorize
                | BrowserActionEffect::Purchase
                | BrowserActionEffect::Delete
                | BrowserActionEffect::Upload
                | BrowserActionEffect::Download
                | BrowserActionEffect::Communicate
        ),
        ("lyra_lumen", "act") => {
            (interaction == "hover") == (effect == BrowserActionEffect::Observe)
        }
        ("lyra_lumen", "vact") => {
            matches!(interaction, "hover" | "scroll") == (effect == BrowserActionEffect::Observe)
        }
        ("lyra_ax", "act") => {
            matches!(interaction, "hover" | "focus") == (effect == BrowserActionEffect::Observe)
        }
        ("lyra_lumen" | "lyra_ax", "press") => {
            browser_press_is_observational(input) == (effect == BrowserActionEffect::Observe)
        }
        _ => effect != BrowserActionEffect::Observe,
    };
    if valid {
        return Ok(Some(effect));
    }
    Err(BrowserActionEffectFailure {
        code: "browser_action_effect_conflict",
        message: "Declared browser action effect conflicts with the requested operation."
            .to_string(),
        detail: json!({
            "displayName": display_name,
            "action": action,
            "interaction": input.get("interaction").cloned().unwrap_or(Value::Null),
            "key": input.get("key").cloned().unwrap_or(Value::Null),
            "effect": input.get("effect").cloned().unwrap_or(Value::Null),
        }),
    })
}

pub(crate) async fn execute_host_tool_adapter(
    session_id: &str,
    turn_id: &str,
    dispatcher: &Option<Arc<HostCapabilityDispatcher>>,
    cancellation: &CancellationToken,
    tool_call_id: &str,
    host_method: &str,
    display_name: &str,
    action: &str,
    input: Value,
    started_at: &str,
) -> Value {
    let mut input = attach_runtime_cancellation(
        input,
        session_id,
        turn_id,
        tool_call_id,
        display_name,
        action,
    );
    strip_untrusted_ax_authorization(display_name, action, &mut input);
    let (mut input, timeout_ms) = apply_tool_timeout_policy(input, display_name, action);
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
    let browser_effect = match validate_browser_action_effect(display_name, action, &input) {
        Ok(effect) => effect,
        Err(failure) => {
            let output = json!({
                "content": failure.message,
                "error": {
                    "code": failure.code,
                    "message": failure.message,
                    "detail": failure.detail,
                },
            });
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
    };
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
        if cancellation.is_cancelled() {
            return json!({
                "content": "Lyra tool call was cancelled before permission was resolved.",
                "cancelled": true,
            });
        }
        match wait_for_permission_with_cancellation_async(permission, cancellation).await {
            Ok(true) => {
                policy_decision = Some(policy_decision_from_permission(
                    &permission_record,
                    "approved",
                ));
                inject_trusted_ax_authorization(
                    display_name,
                    action,
                    &mut input,
                    tool_call_id,
                    Some(&permission_record),
                );
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
        inject_trusted_ax_authorization(display_name, action, &mut input, tool_call_id, None);
    }
    if cancellation.is_cancelled() {
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
    let raw_result = async {
        let dispatcher = dispatcher
            .as_ref()
            .ok_or_else(|| "Lyra host capability bridge is not available".to_string())?;
        let _concurrency_guard = if display_name == "lyra_lumen" || display_name == "lyra_ax" {
            Some(BrowserConcurrencyGuard::try_acquire()?)
        } else {
            None
        };
        invoke_host_capability_with_timeout_async(
            dispatcher.clone(),
            host_method.to_string(),
            input.clone(),
            timeout_ms,
        )
        .await
    }
    .await;
    if cancellation.is_cancelled() {
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
                cancellation,
                display_name,
                action,
                &input,
                &value,
                dispatcher.as_ref(),
            )
            .await;
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
            let status = if value.get("status").and_then(Value::as_str) == Some("uncertain")
                || value.get("outcome").and_then(Value::as_str) == Some("uncertain")
            {
                "uncertain"
            } else if value.get("status").and_then(Value::as_str) == Some("blocked")
                || value.get("browserBlocked").and_then(Value::as_bool) == Some(true)
            {
                "failed"
            } else if value
                .pointer("/userActionResolution/decision")
                .and_then(Value::as_str)
                == Some("continue_agent")
            {
                "uncertain"
            } else if value.get("ok").and_then(Value::as_bool) == Some(false)
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
                    "code": "host_capability_failed",
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

pub(crate) fn host_adapter_arguments(arguments: Value, action: &str) -> Value {
    let mut input = arguments.as_object().cloned().unwrap_or_default();
    input.insert("action".to_string(), Value::String(action.to_string()));
    Value::Object(input)
}

fn strip_untrusted_ax_authorization(display_name: &str, action: &str, input: &mut Value) {
    if !matches!((display_name, action), ("lyra_ax", "act" | "press")) {
        return;
    }
    let Some(object) = input.as_object_mut() else {
        return;
    };
    object.remove("authorized");
    object.remove("axAuthorization");
}

fn inject_trusted_ax_authorization(
    display_name: &str,
    action: &str,
    input: &mut Value,
    tool_call_id: &str,
    permission: Option<&PermissionRequest>,
) {
    if !matches!((display_name, action), ("lyra_ax", "act" | "press")) {
        return;
    }
    let Some(object) = input.as_object_mut() else {
        return;
    };
    let Some(ax_ref) = object.get("axRef").and_then(Value::as_str) else {
        return;
    };
    let mut authorization = Map::new();
    authorization.insert(
        "kind".to_string(),
        Value::String("lyra_ax_one_time".to_string()),
    );
    authorization.insert("action".to_string(), Value::String(action.to_string()));
    authorization.insert("axRef".to_string(), Value::String(ax_ref.to_string()));
    authorization.insert(
        "toolCallId".to_string(),
        Value::String(tool_call_id.to_string()),
    );
    if let Some(permission) = permission {
        authorization.insert(
            "permissionRequestId".to_string(),
            Value::String(permission.id.clone()),
        );
    }
    authorization.insert("issuedAt".to_string(), Value::String(now()));
    authorization.insert(
        "expiresAt".to_string(),
        Value::Number((Utc::now().timestamp_millis() + 120_000).into()),
    );
    if let Some(tab_id) = object.get("tabId").and_then(Value::as_str) {
        authorization.insert("tabId".to_string(), Value::String(tab_id.to_string()));
    }
    if let Some(target_mode) = object.get("targetMode").and_then(Value::as_str)
        && matches!(target_mode, "live" | "isolated")
    {
        authorization.insert(
            "targetMode".to_string(),
            Value::String(target_mode.to_string()),
        );
    }
    object.insert("axAuthorization".to_string(), Value::Object(authorization));
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
