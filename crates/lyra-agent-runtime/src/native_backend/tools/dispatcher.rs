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
    if call.name == LYRA_CLARIFICATION_ASK_TOOL {
        return execute_clarification_tool_adapter(
            session_id,
            turn_id,
            &call.id,
            call.arguments,
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
    let output = tool_failure_output(
        "tool_not_found",
        &format!("Unknown Lyra provider-visible tool: {}", call.name),
        "Use tool_fs_search first, then tool_fs_list as a fallback, tool_fs_inspect for schemas, and tool_fs_run to execute Lyra tools.",
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

pub(crate) struct ToolFsTargetExecution<'a> {
    pub(crate) session_id: &'a str,
    pub(crate) turn_id: &'a str,
    pub(crate) dispatcher: &'a Option<Arc<HostCapabilityDispatcher>>,
    pub(crate) cancellation: &'a Arc<AtomicBool>,
    pub(crate) runtime: ToolExecutionRuntime,
    pub(crate) tool_call_id: &'a str,
    pub(crate) manifest: &'a lyra_tool_fs_core::ToolManifest,
    pub(crate) operation: &'a lyra_tool_fs_core::ToolOperationEnvelope,
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
    if matches!(target, tool_fs::RuntimeToolTarget::Git) {
        return execute_git_tool_fs_tool(
            context.session_id,
            context.turn_id,
            context.tool_call_id,
            manifest,
            context.operation,
            context.arguments,
            &started_at,
        );
    }
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
                "render" => execute_render_tool_adapter(
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
        tool_fs::RuntimeToolTarget::DesignAdapter { tool_name, action } => {
            return execute_design_tool_adapter(
                context.session_id,
                context.turn_id,
                context.tool_call_id,
                tool_name,
                action,
                context.arguments,
                &started_at,
            );
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
        tool_fs::RuntimeToolTarget::Git => {}
    }
    let output = tool_failure_output(
        "tool_not_found",
        &format!("No Tool-FS runtime adapter completed {}", manifest.path),
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
    output
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
