use super::*;
pub(crate) fn execute_model_tool(
    session_id: &str,
    turn_id: &str,
    dispatcher: &Option<Arc<HostCapabilityDispatcher>>,
    cancellation: &Arc<AtomicBool>,
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

pub(crate) fn execute_model_tool_with_runtime(
    session_id: &str,
    turn_id: &str,
    dispatcher: &Option<Arc<HostCapabilityDispatcher>>,
    cancellation: &Arc<AtomicBool>,
    runtime: ToolExecutionRuntime,
    call: ModelToolCall,
) -> Value {
    let started_at = now();
    if cancellation.load(Ordering::SeqCst) {
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
    if call.name == LYRA_TASK_CONTRACT_REPORT_TOOL {
        return execute_task_contract_report_model_tool(session_id, turn_id, call.arguments);
    }
    if call.name == LYRA_CLARIFICATION_ASK_TOOL {
        return execute_clarification_tool_adapter(
            session_id,
            turn_id,
            &call.id,
            call.arguments,
            &started_at,
        );
    }
    if let Some(output) = task_contract_gate_model_tool(
        session_id,
        turn_id,
        &call.id,
        &call.name,
        call.arguments.clone(),
        &started_at,
    ) {
        return output;
    }
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
        );
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
        );
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
        );
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
        );
    }
    if call.name == TODO_WRITE_MODEL_TOOL {
        return execute_todo_tool_adapter(
            session_id,
            turn_id,
            cancellation,
            &call.id,
            "todo_write",
            "todo",
            "write",
            call.arguments,
            &started_at,
        );
    }
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
        );
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
        );
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
        );
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
        );
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
        );
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
        );
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
        );
    }
    let output = tool_failure_output(
        "tool_not_found",
        &format!("Unknown Lyra provider-visible tool: {}", call.name),
        unknown_provider_tool_recommended_action(&call.name),
        None,
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

fn unknown_provider_tool_recommended_action(_tool_name: &str) -> &'static str {
    "For exact code inspection/validation use direct file/search/shell tools; for edits use edit_file/write_file. For indexed CodeGraph navigation use Tool-FS /tools/code/* through tool_fs_search/inspect/run."
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

pub(crate) struct ToolFsTargetExecution<'a> {
    pub(crate) session_id: &'a str,
    pub(crate) turn_id: &'a str,
    pub(crate) dispatcher: &'a Option<Arc<HostCapabilityDispatcher>>,
    pub(crate) cancellation: &'a Arc<AtomicBool>,
    pub(crate) runtime: ToolExecutionRuntime,
    pub(crate) tool_call_id: &'a str,
    pub(crate) manifest: &'a lyra_tool_fs_core::ToolManifest,
    pub(crate) arguments: Value,
}

pub(crate) fn execute_tool_fs_target(context: ToolFsTargetExecution<'_>) -> Value {
    let started_at = now();
    if context.cancellation.load(Ordering::SeqCst) {
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
                "workbench" => execute_workbench_tool_adapter(
                    context.session_id,
                    context.turn_id,
                    context.dispatcher,
                    context.cancellation,
                    context.tool_call_id,
                    host_method,
                    action,
                    context.arguments,
                    &started_at,
                ),
                "lyra_lumen" => execute_browser_tool_adapter(
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
                ),
                "software" => execute_software_tool_adapter(
                    context.session_id,
                    context.turn_id,
                    context.dispatcher,
                    context.cancellation,
                    context.tool_call_id,
                    host_method,
                    action,
                    context.arguments,
                    &started_at,
                ),
                "terminal" => execute_terminal_tool_adapter(
                    context.session_id,
                    context.turn_id,
                    context.dispatcher,
                    context.cancellation,
                    context.tool_call_id,
                    host_method,
                    action,
                    context.arguments,
                    &started_at,
                ),
                _ => execute_host_tool_adapter(
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
                ),
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
            );
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
            );
        }
        tool_fs::RuntimeToolTarget::Clarification => {
            return execute_clarification_tool_adapter(
                context.session_id,
                context.turn_id,
                context.tool_call_id,
                context.arguments,
                &started_at,
            );
        }
        tool_fs::RuntimeToolTarget::NativeAdapter {
            tool_name,
            display_name,
            action,
        } => {
            return match manifest.domain.as_str() {
                "filesystem" => execute_filesystem_tool_adapter(
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
                ),
                "code" => execute_code_tool_adapter(
                    context.session_id,
                    context.turn_id,
                    context.cancellation,
                    context.tool_call_id,
                    tool_name,
                    display_name,
                    action,
                    context.arguments,
                    &started_at,
                ),
                "shell" => execute_shell_tool_adapter(
                    context.session_id,
                    context.turn_id,
                    context.cancellation,
                    context.tool_call_id,
                    tool_name,
                    display_name,
                    action,
                    context.arguments,
                    &started_at,
                ),
                "web" => execute_web_tool_adapter(
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
                ),
                "todo" => execute_todo_tool_adapter(
                    context.session_id,
                    context.turn_id,
                    context.cancellation,
                    context.tool_call_id,
                    tool_name,
                    display_name,
                    action,
                    context.arguments,
                    &started_at,
                ),
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
                    );
                }
                _ => execute_native_tool_adapter(
                    context.session_id,
                    context.turn_id,
                    context.cancellation,
                    context.tool_call_id,
                    tool_name,
                    display_name,
                    action,
                    context.arguments,
                    &started_at,
                ),
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
            );
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
            );
        }
    }
}

fn execute_session_read_message_model_tool(
    session_id: &str,
    turn_id: &str,
    cancellation: &Arc<AtomicBool>,
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
