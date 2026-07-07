use super::*;

#[derive(Clone, Debug)]
pub(crate) struct NativeToolSuccess {
    pub(crate) content: String,
    pub(crate) raw: Value,
    pub(crate) recommended_next_action: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct NativeToolFailure {
    pub(crate) code: String,
    pub(crate) message: String,
    pub(crate) recommended_next_action: String,
    pub(crate) detail: Option<Value>,
}

impl NativeToolFailure {
    pub(crate) fn new(
        code: impl Into<String>,
        message: impl Into<String>,
        recommended_next_action: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            recommended_next_action: recommended_next_action.into(),
            detail: None,
        }
    }

    pub(crate) fn with_detail(mut self, detail: Value) -> Self {
        self.detail = Some(detail);
        self
    }
}

pub(crate) type NativeToolResult = Result<NativeToolSuccess, NativeToolFailure>;

#[derive(Clone, Debug)]
pub(crate) struct WorkspacePath {
    pub(crate) root: PathBuf,
    pub(crate) absolute: PathBuf,
    pub(crate) relative: String,
    pub(crate) outside_workspace: bool,
}

pub(crate) fn execute_native_tool_adapter(
    session_id: &str,
    turn_id: &str,
    cancellation: &Arc<AtomicBool>,
    tool_call_id: &str,
    tool_name: &str,
    display_name: &str,
    action: &str,
    arguments: Value,
    started_at: &str,
) -> Value {
    execute_native_tool_adapter_with_dispatcher(
        session_id,
        turn_id,
        cancellation,
        tool_call_id,
        tool_name,
        display_name,
        action,
        arguments,
        started_at,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn execute_native_tool_adapter_with_dispatcher(
    session_id: &str,
    turn_id: &str,
    cancellation: &Arc<AtomicBool>,
    tool_call_id: &str,
    tool_name: &str,
    display_name: &str,
    action: &str,
    arguments: Value,
    started_at: &str,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Value {
    execute_native_tool_adapter_with_runtime(
        session_id,
        turn_id,
        cancellation,
        tool_call_id,
        tool_name,
        display_name,
        action,
        arguments,
        started_at,
        dispatcher,
        ToolExecutionRuntime::default(),
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn execute_native_tool_adapter_with_runtime(
    session_id: &str,
    turn_id: &str,
    cancellation: &Arc<AtomicBool>,
    tool_call_id: &str,
    tool_name: &str,
    display_name: &str,
    action: &str,
    arguments: Value,
    started_at: &str,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
    runtime: ToolExecutionRuntime,
) -> Value {
    let mut input = native_tool_input(action, arguments);
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
    if cancellation.load(Ordering::SeqCst) || turn_was_cancelled(session_id, turn_id) {
        let output = tool_failure_output(
            "cancelled",
            "Lyra tool call was cancelled.",
            "Stop this tool call and continue only after a new user turn.",
            None,
        );
        record_tool_activity(
            session_id,
            turn_id,
            tool_activity(
                tool_call_id,
                display_name,
                &tool_label(display_name, action),
                "cancelled",
                input,
                Some(output.clone()),
                started_at,
                Some(now()),
            ),
            "toolFinished",
        );
        return output;
    }
    if let Some(risk) = permission_risk(display_name, action, &input)
        && evaluate_permission_policy(display_name, action, Some(&risk), &input)
            == PermissionPolicyDecision::Deny
    {
        let output = attach_policy_decision_to_output(
            tool_failure_output(
                "permission_policy_denied",
                "The local Lyra Agent permission policy denied this native tool request.",
                "Do not execute this tool call. Explain the limitation or choose a safer alternative.",
                None,
            ),
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
    let native_permission_policy_decision =
        native_permission_policy_decision_for_tool(session_id, display_name, action, &input);
    if let Some((risk, PermissionPolicyDecision::Deny)) = &native_permission_policy_decision {
        let output = attach_policy_decision_to_output(
            tool_failure_output(
                "permission_policy_denied",
                "The local Lyra Agent permission policy denied this native tool request.",
                "Do not execute this tool call. Explain the limitation or choose a safer alternative.",
                None,
            ),
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
    apply_native_permission_policy_auto_grant(&mut input, &native_permission_policy_decision);
    if let Some(permission) = native_permission_request_for_tool(
        session_id,
        turn_id,
        tool_call_id,
        display_name,
        action,
        &input,
    ) {
        let permission_record = permission.clone();
        match wait_for_permission_with_cancellation(permission, cancellation) {
            Ok(true) => {
                if let Some(object) = input.as_object_mut() {
                    object.insert("permissionGranted".to_string(), Value::Bool(true));
                }
                policy_decision = Some(policy_decision_from_permission(
                    &permission_record,
                    "approved",
                ));
            }
            Ok(false) => {
                let output = attach_policy_decision_to_output(
                    tool_failure_output(
                        "permission_denied",
                        "The user denied this native tool request.",
                        "Do not execute this tool call. Explain the limitation or choose a safer alternative.",
                        None,
                    ),
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
                    tool_failure_output(
                        "permission_request_failed",
                        &format!("Permission request failed: {error}"),
                        "Stop this tool call and wait for user input before retrying.",
                        None,
                    )
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

    let result = run_native_tool_with_dispatcher(
        session_id,
        turn_id,
        tool_name,
        tool_call_id,
        &input,
        dispatcher,
        cancellation,
        runtime,
    );
    let (status, output) = match result {
        Ok(success) => {
            let output = budgeted_tool_output(
                session_id,
                turn_id,
                tool_call_id,
                success.content,
                attach_policy_decision_to_raw(success.raw, policy_decision),
                success.recommended_next_action,
            );
            ("completed", output)
        }
        Err(error) => (
            "failed",
            attach_policy_decision_to_output(
                tool_failure_output(
                    &error.code,
                    &error.message,
                    &error.recommended_next_action,
                    error.detail,
                ),
                policy_decision,
            ),
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
            input,
            Some(output.clone()),
            started_at,
            Some(now()),
        ),
        "toolFinished",
    );
    output
}

pub(crate) fn native_tool_input(action: &str, arguments: Value) -> Value {
    let mut input = arguments.as_object().cloned().unwrap_or_default();
    input.insert("action".to_string(), Value::String(action.to_string()));
    Value::Object(input)
}

fn outside_workspace_permission_input(
    session_id: &str,
    display_name: &str,
    action: &str,
    input: &Value,
) -> Option<Value> {
    for (raw_path, allow_missing_leaf) in
        filesystem_path_permission_candidates(display_name, action, input)
    {
        if path_qualifies_for_lyra_artifact_access(&raw_path).unwrap_or(false) {
            continue;
        }
        let Ok(Some((workspace_root, absolute))) =
            path_escapes_session_workspace(session_id, &raw_path, allow_missing_leaf)
        else {
            continue;
        };
        let mut permission_input = input.clone();
        if let Some(object) = permission_input.as_object_mut() {
            object.insert("permissionRequired".to_string(), Value::Bool(true));
            object.insert(
                "permissionRisk".to_string(),
                Value::String("workspace_escape".to_string()),
            );
            object.insert(
                "workspaceRoot".to_string(),
                Value::String(workspace_root.display().to_string()),
            );
            object.insert(
                "outsideWorkspacePath".to_string(),
                Value::String(absolute.display().to_string()),
            );
            if object.get("path").is_none() {
                object.insert(
                    "path".to_string(),
                    Value::String(absolute.display().to_string()),
                );
            }
        }
        return Some(permission_input);
    }
    None
}

fn native_permission_input_for_tool(
    session_id: &str,
    display_name: &str,
    action: &str,
    input: &Value,
) -> Option<Value> {
    if let Some(permission_input) =
        outside_workspace_permission_input(session_id, display_name, action, input)
    {
        return Some(permission_input);
    }
    if display_name == "file"
        && matches!(
            action,
            "write" | "edit" | "strict_edit" | "multiedit" | "apply_patch"
        )
    {
        let mut permission_input = input.clone();
        if let Some(object) = permission_input.as_object_mut() {
            object.insert("permissionRequired".to_string(), Value::Bool(true));
            object.insert(
                "permissionRisk".to_string(),
                Value::String("file".to_string()),
            );
        }
        return Some(permission_input);
    }
    if display_name == "shell" && action == "run" && shell_input_requires_permission(input) {
        let mut permission_input = input.clone();
        if let Some(object) = permission_input.as_object_mut() {
            object.insert("permissionRequired".to_string(), Value::Bool(true));
            object.insert(
                "permissionRisk".to_string(),
                Value::String("shell".to_string()),
            );
        }
        return Some(permission_input);
    }
    None
}

fn native_permission_policy_decision_for_tool(
    session_id: &str,
    display_name: &str,
    action: &str,
    input: &Value,
) -> Option<(String, PermissionPolicyDecision)> {
    native_permission_policy_decision_for_tool_with_evaluator(
        session_id,
        display_name,
        action,
        input,
        evaluate_permission_policy,
    )
}

fn native_permission_policy_decision_for_tool_with_evaluator<F>(
    session_id: &str,
    display_name: &str,
    action: &str,
    input: &Value,
    evaluate: F,
) -> Option<(String, PermissionPolicyDecision)>
where
    F: Fn(&str, &str, Option<&str>, &Value) -> PermissionPolicyDecision,
{
    let Some(permission_input) =
        native_permission_input_for_tool(session_id, display_name, action, input)
    else {
        return None;
    };
    let Some(risk) = permission_risk(display_name, action, &permission_input) else {
        return None;
    };
    let decision = evaluate(display_name, action, Some(&risk), &permission_input);
    Some((risk, decision))
}

fn apply_native_permission_policy_auto_grant(
    input: &mut Value,
    decision: &Option<(String, PermissionPolicyDecision)>,
) {
    if matches!(decision, Some((_, PermissionPolicyDecision::Allow)))
        && let Some(object) = input.as_object_mut()
    {
        object.insert("permissionGranted".to_string(), Value::Bool(true));
    }
}

pub(crate) fn native_permission_request_for_tool(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    display_name: &str,
    action: &str,
    input: &Value,
) -> Option<PermissionRequest> {
    let permission_input =
        native_permission_input_for_tool(session_id, display_name, action, input)?;
    permission_request_for_tool(
        session_id,
        turn_id,
        tool_call_id,
        display_name,
        action,
        &permission_input,
    )
}

pub(crate) fn shell_input_requires_permission(input: &Value) -> bool {
    let Some(command) = input.get("command").and_then(Value::as_str) else {
        return false;
    };
    shell_command_requires_permission(command)
}

fn cancellation_for_turn(turn_id: &str) -> Arc<AtomicBool> {
    super::super::session_runtime::cancellation_token(turn_id)
        .unwrap_or_else(|| Arc::new(AtomicBool::new(false)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_for_turn_uses_session_runtime_token() {
        let turn_id = format!("turn-native-cancel-{}", Uuid::new_v4());
        let token = Arc::new(AtomicBool::new(false));
        crate::native_backend::session_runtime::register_turn_cancellation(&turn_id, token.clone());

        let observed = cancellation_for_turn(&turn_id);
        observed.store(true, Ordering::SeqCst);
        crate::native_backend::session_runtime::clear_turn_cancellation(&turn_id);

        assert!(token.load(Ordering::SeqCst));
    }

    #[test]
    fn policy_allow_marks_high_risk_shell_as_permission_granted() {
        let mut input = json!({ "action": "run", "command": "rm file.txt" });
        let decision = native_permission_policy_decision_for_tool_with_evaluator(
            "session-policy-test",
            "shell",
            "run",
            &input,
            |display_name, action, risk, permission_input| {
                assert_eq!(display_name, "shell");
                assert_eq!(action, "run");
                assert_eq!(risk, Some("shell"));
                assert_eq!(permission_input["permissionRequired"], true);
                assert_eq!(permission_input["permissionRisk"], "shell");
                PermissionPolicyDecision::Allow
            },
        );

        apply_native_permission_policy_auto_grant(&mut input, &decision);

        assert_eq!(input["permissionGranted"], true);
    }
}

#[allow(dead_code)]
pub(crate) fn run_native_tool(
    session_id: &str,
    turn_id: &str,
    tool_name: &str,
    tool_call_id: &str,
    input: &Value,
) -> NativeToolResult {
    let cancellation = cancellation_for_turn(turn_id);
    run_native_tool_with_dispatcher(
        session_id,
        turn_id,
        tool_name,
        tool_call_id,
        input,
        None,
        &cancellation,
        ToolExecutionRuntime::default(),
    )
}

pub(crate) fn run_native_tool_with_dispatcher(
    session_id: &str,
    turn_id: &str,
    tool_name: &str,
    tool_call_id: &str,
    input: &Value,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
    cancellation: &Arc<AtomicBool>,
    runtime: ToolExecutionRuntime,
) -> NativeToolResult {
    match tool_name {
        "artifact_read" => tool_artifact_read(session_id, turn_id, tool_call_id, input),
        "file_read" => tool_file_read(session_id, turn_id, tool_call_id, input),
        "file_list" => tool_file_list(session_id, input),
        "file_glob" => tool_file_glob(session_id, input),
        "file_grep" => tool_file_grep(session_id, input),
        "file_write" => tool_file_write(session_id, turn_id, tool_call_id, input),
        "file_edit" => tool_file_edit(session_id, turn_id, tool_call_id, input),
        "file_strict_edit" => tool_file_strict_edit(session_id, turn_id, tool_call_id, input),
        "file_multiedit" => tool_file_multiedit(session_id, turn_id, tool_call_id, input),
        "apply_patch" => tool_apply_patch(session_id, turn_id, tool_call_id, input),
        "shell_run" => tool_shell_run(session_id, turn_id, tool_call_id, input),
        "hardware_list" => tool_hardware_list(input),
        "hardware_inspect" => tool_hardware_inspect(input),
        "hardware_capabilities" => tool_hardware_capabilities(input),
        "hardware_os_status" => tool_hardware_os_status(input),
        "hardware_permissions_request" => tool_hardware_permissions_request(input),
        "hardware_session_open" => tool_hardware_session_open(input),
        "hardware_session_read" => tool_hardware_session_read(input),
        "hardware_session_write" => tool_hardware_session_write(input),
        "hardware_session_close" => tool_hardware_session_close(input),
        "hardware_invoke" => tool_hardware_invoke(input),
        "hardware_run_action" => tool_hardware_run_action(input),
        "code_grep_text" => tool_code_grep_text(session_id, input),
        "lsp_query" => tool_lsp_query(session_id, input),
        "network_status" => tool_network_status(),
        "web_search" => tool_web_search(input),
        "web_research" => tool_web_research(session_id, turn_id, input),
        "web_map" => tool_web_map(input),
        "web_batch" => tool_web_batch(
            session_id,
            turn_id,
            tool_call_id,
            input,
            dispatcher,
            cancellation,
        ),
        "web_fetch" => tool_web_fetch_with_browser_for_session(
            session_id,
            turn_id,
            tool_call_id,
            input,
            dispatcher,
        ),
        "todo_read" => tool_todo_read(session_id),
        "todo_write" => tool_todo_write(session_id, turn_id, input),
        "todo_update" => tool_todo_update(session_id, turn_id, input),
        "todo_finish" => tool_todo_finish(session_id, turn_id, input),
        "design_reference" => tool_design_reference(input),
        "codegraph_explore" => tool_codegraph_explore(session_id, input),
        "codegraph_callers" => tool_codegraph_callers(session_id, input),
        "codegraph_callees" => tool_codegraph_callees(session_id, input),
        "codegraph_impact" => tool_codegraph_impact(session_id, input),
        "codegraph_context" => tool_codegraph_context(session_id, input),
        "codegraph_server" => tool_codegraph_server(session_id, input),
        _ => Err(NativeToolFailure::new(
            "tool_not_found",
            format!("Unknown Lyra native tool: {tool_name}"),
            "Call one of the tools listed in the current Lyra runtime context.",
        )),
    }
}
