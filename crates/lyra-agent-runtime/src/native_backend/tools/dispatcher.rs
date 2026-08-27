use super::*;
#[cfg(test)]
pub(crate) async fn execute_model_tool(
    session_id: &str,
    turn_id: &str,
    dispatcher: &Option<Arc<HostCapabilityDispatcher>>,
    cancellation: &CancellationToken,
    call: ModelToolCall,
) -> Value {
    execute_model_tool_with_runtime(
        session_id,
        turn_id,
        dispatcher,
        cancellation,
        ToolExecutionRuntime::default(),
        call,
    )
    .await
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct ToolExecutionRuntime {
    pub(crate) supports_image_input: bool,
}

impl ToolExecutionRuntime {
    pub(crate) fn from_model_capabilities(capabilities: &ModelCapabilityProfile) -> Self {
        Self {
            supports_image_input: capabilities.supports_image_input,
        }
    }
}

impl Default for ToolExecutionRuntime {
    fn default() -> Self {
        Self {
            supports_image_input: false,
        }
    }
}

pub(crate) async fn execute_model_tool_with_runtime(
    session_id: &str,
    turn_id: &str,
    dispatcher: &Option<Arc<HostCapabilityDispatcher>>,
    cancellation: &CancellationToken,
    runtime: ToolExecutionRuntime,
    call: ModelToolCall,
) -> Value {
    let started_at = now();
    if cancellation.is_cancelled() {
        return json!({
            "content": "Lyra tool call was cancelled before execution.",
            "cancelled": true,
        });
    }
    if call.name == LYRA_SESSION_READ_MESSAGE_TOOL {
        return execute_session_read_message_model_tool(
            session_id,
            turn_id,
            cancellation,
            &call,
            &started_at,
        );
    }
    if call.name == LYRA_CLARIFICATION_ASK_TOOL {
        return execute_clarification_tool_adapter(
            session_id,
            turn_id,
            &call.id,
            call.arguments,
            &started_at,
        )
        .await;
    }
    if call.name == UPDATE_PLAN_MODEL_TOOL {
        let action = call
            .arguments
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or("begin")
            .to_string();
        return execute_plan_tool_adapter(
            session_id,
            turn_id,
            cancellation,
            &call.id,
            UPDATE_PLAN_MODEL_TOOL,
            &action,
            call.arguments,
            &started_at,
        )
        .await;
    }
    // Atomic plan tools used by new sessions. The overloaded update_plan
    // branch above remains for historical replay.
    if call.name == PLAN_BEGIN_MODEL_TOOL {
        return execute_plan_tool_adapter(
            session_id,
            turn_id,
            cancellation,
            &call.id,
            PLAN_BEGIN_MODEL_TOOL,
            "begin",
            call.arguments,
            &started_at,
        )
        .await;
    }
    if call.name == PLAN_WRITE_MODEL_TOOL {
        return execute_plan_tool_adapter(
            session_id,
            turn_id,
            cancellation,
            &call.id,
            PLAN_WRITE_MODEL_TOOL,
            "write",
            call.arguments,
            &started_at,
        )
        .await;
    }
    if call.name == PLAN_FINALIZE_MODEL_TOOL {
        return execute_plan_tool_adapter(
            session_id,
            turn_id,
            cancellation,
            &call.id,
            PLAN_FINALIZE_MODEL_TOOL,
            "finalize",
            call.arguments,
            &started_at,
        )
        .await;
    }
    if call.name == PLAN_REVISE_MODEL_TOOL {
        return execute_plan_tool_adapter(
            session_id,
            turn_id,
            cancellation,
            &call.id,
            PLAN_REVISE_MODEL_TOOL,
            "revise",
            call.arguments,
            &started_at,
        )
        .await;
    }
    if call.name == TODO_WRITE_MODEL_TOOL {
        let action = call
            .arguments
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or("write")
            .to_string();
        let display_name = match action.as_str() {
            "update" => "todo_update",
            "finish" => "todo_finish",
            _ => "todo_write",
        };
        return execute_todo_tool_adapter(
            session_id,
            turn_id,
            cancellation,
            &call.id,
            display_name,
            "todo",
            &action,
            call.arguments,
            &started_at,
        )
        .await;
    }
    // Atomic todo tools used by new sessions. The overloaded todo_write
    // branch above still accepts action=update|finish for historical replay.
    if call.name == TODO_UPDATE_MODEL_TOOL {
        return execute_todo_tool_adapter(
            session_id,
            turn_id,
            cancellation,
            &call.id,
            "todo_update",
            "todo",
            "update",
            call.arguments,
            &started_at,
        )
        .await;
    }
    if call.name == TODO_FINISH_MODEL_TOOL {
        return execute_todo_tool_adapter(
            session_id,
            turn_id,
            cancellation,
            &call.id,
            "todo_finish",
            "todo",
            "finish",
            call.arguments,
            &started_at,
        )
        .await;
    }
    if let Some(output) = plan_gate_model_tool(
        session_id,
        turn_id,
        &call.id,
        &call.name,
        call.arguments.clone(),
        &started_at,
    ) {
        return output;
    }
    if let Some(output) = mutation_quality_gate_model_tool(
        session_id,
        turn_id,
        &call.id,
        &call.name,
        call.arguments.clone(),
        &started_at,
    ) {
        return output;
    }
    if call.name == APPLY_PATCH_MODEL_TOOL {
        return execute_filesystem_tool_adapter(
            session_id,
            turn_id,
            cancellation,
            runtime,
            &call.id,
            APPLY_PATCH_MODEL_TOOL,
            "file",
            "apply_patch",
            call.arguments,
            &started_at,
        )
        .await;
    }
    if call.name == READ_FILE_MODEL_TOOL {
        return execute_filesystem_tool_adapter(
            session_id,
            turn_id,
            cancellation,
            runtime,
            &call.id,
            "file_read",
            "file",
            "read",
            call.arguments,
            &started_at,
        )
        .await;
    }
    if call.name == GLOB_MODEL_TOOL {
        return execute_filesystem_tool_adapter(
            session_id,
            turn_id,
            cancellation,
            runtime,
            &call.id,
            "file_glob",
            "file",
            "glob",
            call.arguments,
            &started_at,
        )
        .await;
    }
    if call.name == GREP_MODEL_TOOL {
        return execute_filesystem_tool_adapter(
            session_id,
            turn_id,
            cancellation,
            runtime,
            &call.id,
            "file_grep",
            "file",
            "grep",
            call.arguments,
            &started_at,
        )
        .await;
    }
    if call.name == WRITE_FILE_MODEL_TOOL {
        // write_file → native file.write. The model-facing schema already uses
        // {path, content, overwrite}, matching tool_file_write.
        return execute_filesystem_tool_adapter(
            session_id,
            turn_id,
            cancellation,
            runtime,
            &call.id,
            "file_write",
            "file",
            "write",
            call.arguments,
            &started_at,
        )
        .await;
    }
    if call.name == EXEC_COMMAND_MODEL_TOOL {
        return execute_shell_tool_adapter(
            session_id,
            turn_id,
            cancellation,
            &call.id,
            "shell_run",
            "shell",
            "run",
            exec_command_arguments(call.arguments),
            &started_at,
        )
        .await;
    }
    if call.name == WRITE_STDIN_MODEL_TOOL {
        return execute_terminal_tool_adapter(
            session_id,
            turn_id,
            dispatcher,
            cancellation,
            &call.id,
            "terminal.write",
            "write",
            write_stdin_arguments(call.arguments),
            &started_at,
        )
        .await;
    }
    if call.name == EDIT_FILE_MODEL_TOOL {
        // edit_file → native file.multiedit. Maps the public old_text/new_text/
        // replace_all edit shape onto the internal oldString/newString/replaceAll
        // multiedit contract. Same call.id flows through so the preview activity
        // and the real execution render as a single tool card.
        return execute_filesystem_tool_adapter(
            session_id,
            turn_id,
            cancellation,
            runtime,
            &call.id,
            "file_multiedit",
            "file",
            "multiedit",
            edit_file_arguments(call.arguments),
            &started_at,
        )
        .await;
    }
    if tool_fs::is_tool_fs_model_tool(&call.name) {
        return tool_fs::execute_tool_fs_model_tool(
            session_id,
            turn_id,
            dispatcher,
            cancellation,
            runtime,
            call,
            &started_at,
        )
        .await;
    }
    if tool_fs::runtime_registry()
        .inspect_handle(&call.name)
        .is_ok()
    {
        let tool_handle = call.name.clone();
        let args = call.arguments.clone();
        return tool_fs::execute_tool_fs_model_tool(
            session_id,
            turn_id,
            dispatcher,
            cancellation,
            runtime,
            ModelToolCall {
                id: call.id,
                name: lyra_tool_fs_core::TOOL_FS_RUN.to_string(),
                arguments: json!({
                    "toolHandle": tool_handle,
                    "args": args,
                }),
            },
            &started_at,
        )
        .await;
    }
    let (recommended_action, detail) = unknown_provider_tool_diagnostic(&call.name);
    let output = tool_failure_output(
        "tool_not_found",
        &format!("Unknown Lyra provider-visible tool: {}", call.name),
        recommended_action,
        Some(detail),
    );
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            &call.name,
            &call.name,
            "failed",
            call.arguments,
            Some(output.clone()),
            &started_at,
            Some(now()),
        ),
        "toolFinished",
    );
    output
}

fn unknown_provider_tool_diagnostic(tool_name: &str) -> (&'static str, Value) {
    match tool_name {
        "shell" => (
            "Use exec_command with {cmd, workdir?, timeout_ms?}.",
            json!({
                "requestedTool": tool_name,
                "suggestedTools": ["exec_command"],
                "schemaPaths": ["/provider/tools/exec_command", "/tools/shell/run"],
            }),
        ),
        "terminal.sendControlledInput" => (
            "Use write_stdin with an active sessionId returned by a terminal tool result.",
            json!({
                "requestedTool": tool_name,
                "suggestedTools": ["write_stdin"],
                "schemaPaths": ["/provider/tools/write_stdin", "/tools/terminal/write"],
            }),
        ),
        _ => (
            "Use read_file/glob/grep/exec_command for direct inspection, edit_file/write_file for mutations, or tool_fs_search for other capabilities.",
            json!({
                "requestedTool": tool_name,
                "suggestedTools": [
                    "read_file",
                    "glob",
                    "grep",
                    "exec_command",
                    "edit_file",
                    "write_file",
                    "tool_fs_search"
                ],
                "schemaPaths": ["/provider/tools", "/tools"],
            }),
        ),
    }
}

/// Translate the public `edit_file` arguments ({path, edits:[{old_text,
/// new_text, replace_all}]}) into the internal multiedit shape
/// ({path, edits:[{oldString, newString, replaceAll}]}).
fn edit_file_arguments(arguments: Value) -> Value {
    let mut input = arguments.as_object().cloned().unwrap_or_default();
    if let Some(Value::Array(edits)) = input.remove("edits") {
        let mapped = edits
            .into_iter()
            .map(|edit| {
                let mut object = edit.as_object().cloned().unwrap_or_default();
                if let Some(old) = object.remove("old_text") {
                    object.entry("oldString".to_string()).or_insert(old);
                }
                if let Some(new) = object.remove("new_text") {
                    object.entry("newString".to_string()).or_insert(new);
                }
                if let Some(all) = object.remove("replace_all") {
                    object.entry("replaceAll".to_string()).or_insert(all);
                }
                Value::Object(object)
            })
            .collect();
        input.insert("edits".to_string(), Value::Array(mapped));
    }
    Value::Object(input)
}

fn exec_command_arguments(arguments: Value) -> Value {
    let mut input = arguments.as_object().cloned().unwrap_or_default();
    if let Some(cmd) = input.remove("cmd") {
        input.entry("command".to_string()).or_insert(cmd);
    }
    if let Some(workdir) = input.remove("workdir") {
        input.entry("cwd".to_string()).or_insert(workdir);
    }
    if let Some(timeout_ms) = input.remove("timeout_ms") {
        input.entry("timeoutMs".to_string()).or_insert(timeout_ms);
    }
    if let Some(max_output_tokens) = input.remove("max_output_tokens")
        && let Some(tokens) = max_output_tokens.as_u64()
    {
        input
            .entry("maxOutputBytes".to_string())
            .or_insert(json!(tokens.saturating_mul(4).min(1_000_000)));
    }
    Value::Object(input)
}

fn write_stdin_arguments(arguments: Value) -> Value {
    let mut input = arguments.as_object().cloned().unwrap_or_default();
    if let Some(chars) = input.remove("chars") {
        input.entry("data".to_string()).or_insert(chars);
    }
    Value::Object(input)
}

pub(crate) struct ToolFsTargetExecution<'a> {
    pub(crate) session_id: &'a str,
    pub(crate) turn_id: &'a str,
    pub(crate) dispatcher: &'a Option<Arc<HostCapabilityDispatcher>>,
    pub(crate) cancellation: &'a CancellationToken,
    pub(crate) runtime: ToolExecutionRuntime,
    pub(crate) tool_call_id: &'a str,
    pub(crate) manifest: &'a lyra_tool_fs_core::ToolManifest,
    pub(crate) arguments: Value,
}

pub(crate) async fn execute_tool_fs_target(context: ToolFsTargetExecution<'_>) -> Value {
    let started_at = now();
    if context.cancellation.is_cancelled() {
        return json!({
            "content": "Lyra tool call was cancelled before execution.",
            "cancelled": true,
        });
    }
    let manifest = context.manifest;
    let Some(target) = tool_fs::runtime_target_for_manifest(manifest) else {
        let output = tool_failure_output(
            "tool_not_found",
            &format!("No runtime adapter is registered for {}", manifest.path),
            "Use tool_fs_list or tool_fs_inspect to choose a supported Tool-FS target.",
            Some(json!({ "toolPath": manifest.path })),
        );
        record_tool_activity(
            context.session_id,
            context.turn_id,
            tool_activity(
                context.tool_call_id,
                &manifest.domain,
                &manifest.title,
                "failed",
                context.arguments,
                Some(output.clone()),
                &started_at,
                Some(now()),
            ),
            "toolFinished",
        );
        return output;
    };
    match &target {
        tool_fs::RuntimeToolTarget::HostAdapter {
            host_method,
            display_name,
            action,
        } => {
            return match *display_name {
                "workbench" => {
                    execute_workbench_tool_adapter(
                        context.session_id,
                        context.turn_id,
                        context.dispatcher,
                        context.cancellation,
                        context.tool_call_id,
                        host_method,
                        action,
                        context.arguments,
                        &started_at,
                    )
                    .await
                }
                "lyra_lumen" => {
                    execute_browser_tool_adapter(
                        context.session_id,
                        context.turn_id,
                        context.dispatcher,
                        context.cancellation,
                        context.runtime,
                        context.tool_call_id,
                        host_method,
                        action,
                        context.arguments,
                        &started_at,
                    )
                    .await
                }
                "software" => {
                    execute_software_tool_adapter(
                        context.session_id,
                        context.turn_id,
                        context.dispatcher,
                        context.cancellation,
                        context.tool_call_id,
                        host_method,
                        action,
                        context.arguments,
                        &started_at,
                    )
                    .await
                }
                "terminal" => {
                    execute_terminal_tool_adapter(
                        context.session_id,
                        context.turn_id,
                        context.dispatcher,
                        context.cancellation,
                        context.tool_call_id,
                        host_method,
                        action,
                        context.arguments,
                        &started_at,
                    )
                    .await
                }
                _ => {
                    execute_host_tool_adapter(
                        context.session_id,
                        context.turn_id,
                        context.dispatcher,
                        context.cancellation,
                        context.tool_call_id,
                        host_method,
                        display_name,
                        action,
                        host_adapter_arguments(context.arguments, action),
                        &started_at,
                    )
                    .await
                }
            };
        }
        tool_fs::RuntimeToolTarget::SoftwareCapability {
            software_id,
            action_id,
        } => {
            return execute_software_capability_tool_adapter(
                context.session_id,
                context.turn_id,
                context.dispatcher,
                context.cancellation,
                context.tool_call_id,
                software_id,
                action_id,
                context.arguments,
                &started_at,
            )
            .await;
        }
        tool_fs::RuntimeToolTarget::McpCapability {
            server_id,
            tool_name,
        } => {
            return execute_mcp_capability_tool_adapter(
                context.session_id,
                context.turn_id,
                context.tool_call_id,
                server_id.clone(),
                tool_name.clone(),
                context.arguments,
                &started_at,
            )
            .await;
        }
        tool_fs::RuntimeToolTarget::SkillCapability { skill_id } => {
            // Invoking a skill capability surfaces the skill's full manifest
            // (prompt excerpt + tool paths) — the skill's capability surface.
            let mut arguments = context.arguments;
            if let Some(object) = arguments.as_object_mut() {
                object.insert("skillId".to_string(), json!(skill_id.clone()));
            }
            return execute_skill_tool_adapter(
                context.session_id,
                context.turn_id,
                context.tool_call_id,
                "skill_inspect",
                "inspect",
                arguments,
                &started_at,
            )
            .await;
        }
        tool_fs::RuntimeToolTarget::MemoryAdapter { tool_name, action } => {
            return execute_memory_tool_adapter(
                context.session_id,
                context.turn_id,
                context.tool_call_id,
                tool_name,
                action,
                context.arguments,
                &started_at,
            )
            .await;
        }
        tool_fs::RuntimeToolTarget::Clarification => {
            return execute_clarification_tool_adapter(
                context.session_id,
                context.turn_id,
                context.tool_call_id,
                context.arguments,
                &started_at,
            )
            .await;
        }
        tool_fs::RuntimeToolTarget::NativeAdapter {
            tool_name,
            display_name,
            action,
        } => {
            return match manifest.domain.as_str() {
                "filesystem" => {
                    execute_filesystem_tool_adapter(
                        context.session_id,
                        context.turn_id,
                        context.cancellation,
                        context.runtime,
                        context.tool_call_id,
                        tool_name,
                        display_name,
                        action,
                        context.arguments,
                        &started_at,
                    )
                    .await
                }
                "code" => {
                    execute_code_tool_adapter(
                        context.session_id,
                        context.turn_id,
                        context.cancellation,
                        context.tool_call_id,
                        tool_name,
                        display_name,
                        action,
                        context.arguments,
                        &started_at,
                    )
                    .await
                }
                "shell" => {
                    execute_shell_tool_adapter(
                        context.session_id,
                        context.turn_id,
                        context.cancellation,
                        context.tool_call_id,
                        tool_name,
                        display_name,
                        action,
                        context.arguments,
                        &started_at,
                    )
                    .await
                }
                "web" => {
                    execute_web_tool_adapter(
                        context.session_id,
                        context.turn_id,
                        context.dispatcher,
                        context.cancellation,
                        context.tool_call_id,
                        tool_name,
                        display_name,
                        action,
                        context.arguments,
                        &started_at,
                    )
                    .await
                }
                "todo" => {
                    execute_todo_tool_adapter(
                        context.session_id,
                        context.turn_id,
                        context.cancellation,
                        context.tool_call_id,
                        tool_name,
                        display_name,
                        action,
                        context.arguments,
                        &started_at,
                    )
                    .await
                }
                "browser" if *tool_name == "browser_interact" => {
                    return execute_browser_interact_tool_adapter(
                        context.session_id,
                        context.turn_id,
                        context.dispatcher,
                        context.cancellation,
                        context.runtime,
                        context.tool_call_id,
                        context.arguments,
                        &started_at,
                    )
                    .await;
                }
                _ => {
                    execute_native_tool_adapter_with_runtime(
                        context.session_id,
                        context.turn_id,
                        context.cancellation,
                        context.tool_call_id,
                        tool_name,
                        display_name,
                        action,
                        context.arguments,
                        &started_at,
                        context.dispatcher.as_ref(),
                        context.runtime,
                    )
                    .await
                }
            };
        }
        tool_fs::RuntimeToolTarget::SkillAdapter { tool_name, action } => {
            return execute_skill_tool_adapter(
                context.session_id,
                context.turn_id,
                context.tool_call_id,
                tool_name,
                action,
                context.arguments,
                &started_at,
            )
            .await;
        }
        tool_fs::RuntimeToolTarget::McpAdapter { tool_name, action } => {
            return execute_mcp_tool_adapter(
                context.session_id,
                context.turn_id,
                context.tool_call_id,
                tool_name,
                action,
                context.arguments,
                &started_at,
            )
            .await;
        }
    }
}

fn execute_session_read_message_model_tool(
    session_id: &str,
    turn_id: &str,
    cancellation: &CancellationToken,
    call: &ModelToolCall,
    started_at: &str,
) -> Value {
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            LYRA_SESSION_READ_MESSAGE_TOOL,
            "Read session message",
            "running",
            call.arguments.clone(),
            None,
            started_at,
            None,
        ),
        "toolStarted",
    );
    if cancellation.is_cancelled() || turn_was_cancelled(session_id, turn_id) {
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
                &call.id,
                LYRA_SESSION_READ_MESSAGE_TOOL,
                "Read session message",
                "cancelled",
                call.arguments.clone(),
                Some(output.clone()),
                started_at,
                Some(now()),
            ),
            "toolFinished",
        );
        return output;
    }
    let output = match execute_session_read_message_tool(session_id, &call.arguments) {
        Ok(success) => budgeted_tool_output(
            session_id,
            turn_id,
            &call.id,
            success.content,
            success.raw,
            success.recommended_next_action,
        ),
        Err(failure) => tool_failure_output(
            &failure.code,
            &failure.message,
            &failure.recommended_next_action,
            failure.detail,
        ),
    };
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            LYRA_SESSION_READ_MESSAGE_TOOL,
            "Read session message",
            if output.get("error").is_some() {
                "failed"
            } else {
                "completed"
            },
            call.arguments.clone(),
            Some(output.clone()),
            started_at,
            Some(now()),
        ),
        "toolFinished",
    );
    output
}

#[cfg(test)]
mod contract_tests {
    use super::*;

    #[test]
    fn unknown_shell_names_return_exact_provider_tool_diagnostics() {
        let (_, shell) = unknown_provider_tool_diagnostic("shell");
        assert_eq!(shell["requestedTool"], "shell");
        assert_eq!(shell["suggestedTools"], json!(["exec_command"]));
        assert_eq!(shell["schemaPaths"][0], "/provider/tools/exec_command");

        let (_, controlled_input) =
            unknown_provider_tool_diagnostic("terminal.sendControlledInput");
        assert_eq!(
            controlled_input["requestedTool"],
            "terminal.sendControlledInput"
        );
        assert_eq!(controlled_input["suggestedTools"], json!(["write_stdin"]));
        assert_eq!(
            controlled_input["schemaPaths"][0],
            "/provider/tools/write_stdin"
        );
    }
}
