use super::*;

mod file;
mod search;
mod shell;
mod todo;
mod web;

pub(crate) use self::{file::*, search::*, shell::*, todo::*, web::*};

const MIN_TOOL_TIMEOUT_MS: u64 = 250;
const DEFAULT_HOST_TOOL_TIMEOUT_MS: u64 = 15_000;
const DEFAULT_BROWSER_TOOL_TIMEOUT_MS: u64 = 8_000;
const DEFAULT_BROWSER_WAIT_TIMEOUT_MS: u64 = 30_000;
const DEFAULT_SOFTWARE_TOOL_TIMEOUT_MS: u64 = 30_000;
const MAX_TOOL_TIMEOUT_MS: u64 = 120_000;

pub(crate) fn execute_model_tool(
    session_id: &str,
    turn_id: &str,
    dispatcher: &Option<Arc<HostCapabilityDispatcher>>,
    cancellation: &Arc<AtomicBool>,
    call: ModelToolCall,
) -> Value {
    let started_at = now();
    if cancellation.load(Ordering::SeqCst) {
        return json!({
            "content": "Lyra tool call was cancelled before execution.",
            "cancelled": true,
        });
    }
    if matches!(
        call.name.as_str(),
        "memory_search"
            | "memory_remember"
            | "memory_update"
            | "memory_forget"
            | "memory_list"
            | "memory_link"
            | "memory_review_candidates"
            | "memory_apply_candidate"
            | "memory_reject_candidate"
            | "memory_explain_injection"
    ) {
        return execute_memory_tool(session_id, turn_id, call, &started_at);
    }
    if matches!(call.name.as_str(), "ask_user" | "request_clarification") {
        return execute_clarification_tool(session_id, turn_id, call, &started_at);
    }
    if design_tools::design_tool_names().contains(&call.name.as_str()) {
        return execute_design_model_tool(session_id, turn_id, call, &started_at);
    }
    if matches!(
        call.name.as_str(),
        "skill_list" | "skill_inspect" | "skill_activate" | "skill_deactivate"
    ) {
        return execute_skill_model_tool(session_id, turn_id, call, &started_at);
    }
    if call.name.starts_with("mcp_") {
        return execute_mcp_model_tool(session_id, turn_id, call, &started_at);
    }
    if let Some((display_name, action)) = native_tool_mapping(&call.name) {
        return execute_native_model_tool(
            session_id,
            turn_id,
            cancellation,
            call,
            display_name,
            action,
            &started_at,
        );
    }
    let (host_method, display_name, action, input) =
        match host_tool_mapping(&call.name, call.arguments.clone()) {
            Some(mapping) => mapping,
            None => {
                if let Some(output) =
                    execute_registry_model_tool(session_id, turn_id, &call, &started_at)
                {
                    return output;
                }
                let output = tool_failure_output(
                    "tool_not_found",
                    &format!("Unknown Lyra tool: {}", call.name),
                    "Call one of the tools listed in the current Lyra runtime context.",
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
                return output;
            }
        };
    let input = attach_runtime_cancellation(input, session_id, turn_id, &display_name, &action);
    let (input, timeout_ms) = apply_tool_timeout_policy(input, &display_name, &action);
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            &display_name,
            &tool_label(&display_name, &action),
            "running",
            input.clone(),
            None,
            &started_at,
            None,
        ),
        "toolStarted",
    );
    if let Some(permission) = permission_request_for_tool(
        session_id,
        turn_id,
        &call.id,
        &display_name,
        &action,
        &input,
    ) {
        if cancellation.load(Ordering::SeqCst) {
            return json!({
                "content": "Lyra tool call was cancelled before permission was resolved.",
                "cancelled": true,
            });
        }
        match wait_for_permission(permission) {
            Ok(true) => {}
            Ok(false) => {
                let output = json!({
                    "content": "Permission denied by the user. Do not execute this tool call; choose a safer alternative or explain what cannot proceed.",
                    "error": {
                        "code": "permissionDenied",
                        "message": "The user denied this tool request.",
                    }
                });
                record_tool_activity(
                    session_id,
                    turn_id,
                    tool_activity(
                        &call.id,
                        &display_name,
                        &tool_label(&display_name, &action),
                        "failed",
                        input,
                        Some(output.clone()),
                        &started_at,
                        Some(now()),
                    ),
                    "toolFinished",
                );
                return output;
            }
            Err(error) => {
                let output = json!({
                    "content": format!("Permission request failed: {error}"),
                    "error": {
                        "code": "permissionRequestFailed",
                        "message": error.to_string(),
                    }
                });
                record_tool_activity(
                    session_id,
                    turn_id,
                    tool_activity(
                        &call.id,
                        &display_name,
                        &tool_label(&display_name, &action),
                        "failed",
                        input,
                        Some(output.clone()),
                        &started_at,
                        Some(now()),
                    ),
                    "toolFinished",
                );
                return output;
            }
        }
    }
    if cancellation.load(Ordering::SeqCst) {
        record_tool_activity(
            session_id,
            turn_id,
            tool_activity(
                &call.id,
                &display_name,
                &tool_label(&display_name, &action),
                "cancelled",
                input.clone(),
                Some(json!({ "content": "Lyra tool call was cancelled." })),
                &started_at,
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
                host_method.clone(),
                input.clone(),
                timeout_ms,
            )
        });
    if cancellation.load(Ordering::SeqCst) {
        record_tool_activity(
            session_id,
            turn_id,
            tool_activity(
                &call.id,
                &display_name,
                &tool_label(&display_name, &action),
                "cancelled",
                input.clone(),
                Some(json!({ "content": "Lyra tool call was cancelled." })),
                &started_at,
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
        Ok(value) => {
            let activity_input = resolved_tool_activity_input(input.clone(), &value);
            let raw = redacted_tool_raw_output(&display_name, &action, value.clone());
            let status = if value.get("ok").and_then(Value::as_bool) == Some(false)
                || value.get("error").is_some_and(|value| !value.is_null())
            {
                "failed"
            } else {
                "completed"
            };
            (
                status,
                json!({
                    "content": format_tool_output(&display_name, &action, &value),
                    "raw": raw,
                }),
                activity_input,
            )
        }
        Err(error) => (
            "failed",
            json!({
                "content": format!("Lyra tool failed: {error}"),
                "error": error,
            }),
            input.clone(),
        ),
    };
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            &display_name,
            &tool_label(&display_name, &action),
            status,
            finished_input,
            Some(output.clone()),
            &started_at,
            Some(now()),
        ),
        "toolFinished",
    );
    output
}

pub(crate) fn execute_design_model_tool(
    session_id: &str,
    turn_id: &str,
    call: ModelToolCall,
    started_at: &str,
) -> Value {
    let action = match call.name.as_str() {
        "lyra_design_search_styles" => "search_styles",
        "lyra_design_get_style_details" => "get_style_details",
        _ => "design",
    };
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            "lyra_design",
            &tool_label("lyra_design", action),
            "running",
            call.arguments.clone(),
            None,
            started_at,
            None,
        ),
        "toolStarted",
    );
    let raw = design_tools::execute_design_tool(&call.name, &call.arguments);
    let output = json!({
        "content": format_design_output(action, &raw),
        "raw": raw,
    });
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            "lyra_design",
            &tool_label("lyra_design", action),
            "completed",
            call.arguments,
            Some(output.clone()),
            started_at,
            Some(now()),
        ),
        "toolFinished",
    );
    output
}

pub(crate) fn execute_skill_model_tool(
    session_id: &str,
    turn_id: &str,
    call: ModelToolCall,
    started_at: &str,
) -> Value {
    let action = call.name.trim_start_matches("skill_");
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            "skills",
            &tool_label("skills", action),
            "running",
            call.arguments.clone(),
            None,
            started_at,
            None,
        ),
        "toolStarted",
    );
    let raw_result = execute_skill_state_change(&call.name, &call.arguments);
    let (status, output) = match raw_result {
        Ok(value) => (
            "completed",
            json!({
                "content": format_skill_output(action, &value),
                "raw": value,
            }),
        ),
        Err(error) => (
            "failed",
            json!({
                "content": error.clone(),
                "error": {
                    "code": "skillToolFailed",
                    "message": error,
                }
            }),
        ),
    };
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            "skills",
            &tool_label("skills", action),
            status,
            call.arguments,
            Some(output.clone()),
            started_at,
            Some(now()),
        ),
        "toolFinished",
    );
    output
}

pub(crate) fn execute_mcp_model_tool(
    session_id: &str,
    turn_id: &str,
    call: ModelToolCall,
    started_at: &str,
) -> Value {
    let action = call.name.trim_start_matches("mcp_");
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            "mcp",
            &tool_label("mcp", action),
            "running",
            call.arguments.clone(),
            None,
            started_at,
            None,
        ),
        "toolStarted",
    );
    let output = json!({
        "content": "No Lyra MCP servers are configured in this native runtime instance. Use mcp_server_list to verify server availability, then connect or configure a server before execution.",
        "raw": {
            "servers": [],
            "tools": [],
            "available": false,
            "reason": "no_configured_mcp_servers",
            "requestedTool": call.name,
        }
    });
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            "mcp",
            &tool_label("mcp", action),
            "failed",
            call.arguments,
            Some(output.clone()),
            started_at,
            Some(now()),
        ),
        "toolFinished",
    );
    output
}

pub(crate) fn attach_runtime_cancellation(
    mut input: Value,
    session_id: &str,
    turn_id: &str,
    display_name: &str,
    action: &str,
) -> Value {
    if let Some(object) = input.as_object_mut() {
        object.insert(
            "runtimeCancellation".to_string(),
            json!({
                "kind": "lyra_runtime_turn",
                "sessionId": session_id,
                "turnId": turn_id,
                "cancellable": matches!(
                    (display_name, action),
                    ("lyra_lumen", _)
                        | ("software", "invoke_capability")
                        | ("software", "read_state")
                ),
            }),
        );
    }
    input
}

pub(crate) fn apply_tool_timeout_policy(
    mut input: Value,
    display_name: &str,
    action: &str,
) -> (Value, u64) {
    let timeout_ms = requested_timeout_ms(&input)
        .unwrap_or_else(|| default_tool_timeout_ms(display_name, action))
        .clamp(MIN_TOOL_TIMEOUT_MS, MAX_TOOL_TIMEOUT_MS);
    if let Some(object) = input.as_object_mut() {
        object
            .entry("timeoutMs".to_string())
            .or_insert_with(|| Value::Number(timeout_ms.into()));
        if let Some(runtime_cancellation) = object
            .get_mut("runtimeCancellation")
            .and_then(Value::as_object_mut)
        {
            runtime_cancellation
                .entry("timeoutMs".to_string())
                .or_insert_with(|| Value::Number(timeout_ms.into()));
        }
    }
    (input, timeout_ms)
}

fn requested_timeout_ms(input: &Value) -> Option<u64> {
    input
        .get("timeoutMs")
        .or_else(|| input.pointer("/runtimeCancellation/timeoutMs"))
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.round() as u64)
}

fn default_tool_timeout_ms(display_name: &str, action: &str) -> u64 {
    match (display_name, action) {
        ("lyra_lumen", "wait" | "read_until") => DEFAULT_BROWSER_WAIT_TIMEOUT_MS,
        ("lyra_lumen", _) => DEFAULT_BROWSER_TOOL_TIMEOUT_MS,
        ("software", "invoke_capability" | "read_state") => DEFAULT_SOFTWARE_TOOL_TIMEOUT_MS,
        ("software", _) => DEFAULT_HOST_TOOL_TIMEOUT_MS,
        ("workbench", _) => 5_000,
        _ => DEFAULT_HOST_TOOL_TIMEOUT_MS,
    }
}

pub(crate) fn invoke_host_capability_with_timeout(
    dispatcher: Arc<HostCapabilityDispatcher>,
    method: String,
    payload: Value,
    timeout_ms: u64,
) -> Result<Value, String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    let thread_method = method.clone();
    std::thread::spawn(move || {
        let result = invoke_host_capability(&dispatcher, &thread_method, payload);
        let _ = sender.send(result);
    });
    match receiver.recv_timeout(Duration::from_millis(timeout_ms)) {
        Ok(result) => result,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Err(format!(
            "Lyra tool host capability {method} timed out after {timeout_ms}ms"
        )),
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => Err(format!(
            "Lyra tool host capability {method} reply channel closed before completion"
        )),
    }
}

pub(crate) fn execute_clarification_tool(
    session_id: &str,
    turn_id: &str,
    call: ModelToolCall,
    started_at: &str,
) -> Value {
    let question = call
        .arguments
        .get("question")
        .and_then(Value::as_str)
        .unwrap_or("What should Lyra Agent do next?")
        .trim()
        .to_string();
    let options = call
        .arguments
        .get("options")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let allow_custom_answer = call
        .arguments
        .get("allowCustomAnswer")
        .or_else(|| call.arguments.get("allow_custom_answer"))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let detail = string_opt(&call.arguments, "detail");
    let input = json!({
        "question": question,
        "options": options,
        "allowCustomAnswer": allow_custom_answer,
        "detail": detail,
    });
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            "clarification",
            &tool_label("clarification", "ask"),
            "running",
            input.clone(),
            None,
            started_at,
            None,
        ),
        "toolStarted",
    );
    let request = ClarificationRequest {
        id: format!("clarification-{}", Uuid::new_v4()),
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        tool_call_id: call.id.clone(),
        question,
        options,
        allow_custom_answer,
        detail,
        status: "pending".to_string(),
        answer: None,
        selected_option: None,
        created_at: now(),
        responded_at: None,
    };
    let wait_result = wait_for_clarification(request);
    let (status, output) = match wait_result {
        Ok(request) => (
            "completed",
            json!({
                "content": format!(
                    "User answered clarification: {}",
                    request.answer.clone().unwrap_or_default()
                ),
                "answer": request.answer,
                "selectedOption": request.selected_option,
                "clarificationId": request.id,
            }),
        ),
        Err(error) => (
            "failed",
            json!({
                "content": format!("Clarification failed: {error}"),
                "error": {
                    "code": "clarificationFailed",
                    "message": error.to_string(),
                }
            }),
        ),
    };
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            "clarification",
            &tool_label("clarification", "ask"),
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

pub(crate) fn execute_memory_tool(
    session_id: &str,
    turn_id: &str,
    call: ModelToolCall,
    started_at: &str,
) -> Value {
    let action = memory_action_name(&call.name);
    let input = memory_tool_input(&call.name, call.arguments.clone());
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            "memory",
            &tool_label("memory", action),
            "running",
            input.clone(),
            None,
            started_at,
            None,
        ),
        "toolStarted",
    );
    let raw_result = match call.name.as_str() {
        "memory_remember" => long_term_memory_create(input.clone()),
        "memory_search" => long_term_memory_search(input.clone()),
        "memory_update" => long_term_memory_update(input.clone()),
        "memory_forget" => long_term_memory_forget(input.clone()),
        "memory_list" => long_term_memory_list(input.clone()),
        "memory_link" => long_term_memory_link(input.clone()),
        "memory_review_candidates" => memory_review_candidates(input.clone()),
        "memory_apply_candidate" => memory_apply_candidate(input.clone()),
        "memory_reject_candidate" => memory_reject_candidate(input.clone()),
        "memory_explain_injection" => memory_explain_injection(input.clone()),
        _ => Err(AgentRuntimeError::Core(format!(
            "unknown memory tool: {}",
            call.name
        ))),
    };
    let (status, output) = match raw_result {
        Ok(value) => (
            "completed",
            json!({
                "content": format_memory_output(action, &value),
                "raw": value,
            }),
        ),
        Err(error) => (
            "failed",
            json!({
                "content": format!("Lyra memory tool failed: {error}"),
                "error": error.to_string(),
            }),
        ),
    };
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            "memory",
            &tool_label("memory", action),
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

pub(crate) fn memory_tool_input(name: &str, arguments: Value) -> Value {
    let mut input = arguments.as_object().cloned().unwrap_or_default();
    if name == "memory_remember" {
        input
            .entry("scope".to_string())
            .or_insert_with(|| Value::String("global".to_string()));
        input
            .entry("category".to_string())
            .or_insert_with(|| Value::String("other".to_string()));
        input
            .entry("sourceType".to_string())
            .or_insert_with(|| Value::String("agent_inference".to_string()));
    }
    input.insert(
        "action".to_string(),
        Value::String(memory_action_name(name).to_string()),
    );
    Value::Object(input)
}

fn memory_action_name(name: &str) -> &'static str {
    match name {
        "memory_remember" => "remember",
        "memory_update" => "update",
        "memory_forget" => "forget",
        "memory_list" => "list",
        "memory_link" => "link",
        "memory_review_candidates" => "review_candidates",
        "memory_apply_candidate" => "apply_candidate",
        "memory_reject_candidate" => "reject_candidate",
        "memory_explain_injection" => "explain_injection",
        _ => "search",
    }
}

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
}

pub(crate) fn native_tool_mapping(name: &str) -> Option<(&'static str, &'static str)> {
    match name {
        "artifact_read" => Some(("artifact", "read")),
        "file_read" => Some(("file", "read")),
        "file_list" => Some(("file", "list")),
        "file_glob" => Some(("file", "glob")),
        "file_write" => Some(("file", "write")),
        "file_edit" => Some(("file", "edit")),
        "file_multiedit" => Some(("file", "multiedit")),
        "apply_patch" => Some(("file", "apply_patch")),
        "shell_run" => Some(("shell", "run")),
        "project_search" => Some(("search", "project")),
        "code_search_text" => Some(("code", "search_text")),
        "code_search_symbol" => Some(("code", "search_symbol")),
        "code_graph_expand" => Some(("code", "graph_expand")),
        "lsp_query" => Some(("lsp", "query")),
        "network_status" => Some(("network", "status")),
        "web_search" => Some(("web", "search")),
        "web_fetch" => Some(("web", "fetch")),
        "todo_read" => Some(("todo", "read")),
        "todo_write" => Some(("todo", "write")),
        _ => None,
    }
}

pub(crate) fn execute_native_model_tool(
    session_id: &str,
    turn_id: &str,
    cancellation: &Arc<AtomicBool>,
    call: ModelToolCall,
    display_name: &str,
    action: &str,
    started_at: &str,
) -> Value {
    let mut input = native_tool_input(action, call.arguments.clone());
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
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
                &call.id,
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
    if let Some(permission) = native_permission_request_for_tool(
        session_id,
        turn_id,
        &call.id,
        display_name,
        action,
        &input,
    ) {
        match wait_for_permission(permission) {
            Ok(true) => {
                if let Some(object) = input.as_object_mut() {
                    object.insert("permissionGranted".to_string(), Value::Bool(true));
                }
            }
            Ok(false) => {
                let output = tool_failure_output(
                    "permission_denied",
                    "The user denied this native tool request.",
                    "Do not execute this tool call. Explain the limitation or choose a safer alternative.",
                    None,
                );
                record_tool_activity(
                    session_id,
                    turn_id,
                    tool_activity(
                        &call.id,
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
                let output = tool_failure_output(
                    "permission_request_failed",
                    &format!("Permission request failed: {error}"),
                    "Stop this tool call and wait for user input before retrying.",
                    None,
                );
                record_tool_activity(
                    session_id,
                    turn_id,
                    tool_activity(
                        &call.id,
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
        }
    }

    let result = run_native_tool(session_id, turn_id, &call.name, &call.id, &input);
    let (status, output) = match result {
        Ok(success) => (
            "completed",
            budgeted_tool_output(
                session_id,
                turn_id,
                &call.id,
                success.content,
                success.raw,
                success.recommended_next_action,
            ),
        ),
        Err(error) => (
            "failed",
            tool_failure_output(
                &error.code,
                &error.message,
                &error.recommended_next_action,
                error.detail,
            ),
        ),
    };
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
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

pub(crate) fn native_permission_request_for_tool(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    display_name: &str,
    action: &str,
    input: &Value,
) -> Option<PermissionRequest> {
    if display_name == "file" && matches!(action, "write" | "edit" | "multiedit" | "apply_patch") {
        let mut permission_input = input.clone();
        if let Some(object) = permission_input.as_object_mut() {
            object.insert("permissionRequired".to_string(), Value::Bool(true));
            object.insert(
                "permissionRisk".to_string(),
                Value::String("file".to_string()),
            );
        }
        return permission_request_for_tool(
            session_id,
            turn_id,
            tool_call_id,
            display_name,
            action,
            &permission_input,
        );
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
        return permission_request_for_tool(
            session_id,
            turn_id,
            tool_call_id,
            display_name,
            action,
            &permission_input,
        );
    }
    None
}

pub(crate) fn shell_input_requires_permission(input: &Value) -> bool {
    let Some(command) = input.get("command").and_then(Value::as_str) else {
        return false;
    };
    if shell_command_has_control_operator(command) {
        return false;
    }
    shlex::split(command)
        .filter(|tokens| !tokens.is_empty())
        .is_some_and(|tokens| command_requires_permission(&tokens))
}

pub(crate) fn execute_registry_model_tool(
    session_id: &str,
    turn_id: &str,
    call: &ModelToolCall,
    started_at: &str,
) -> Option<Value> {
    let service = ToolActivityService::default();
    let capability = service.capability_ref_for_model_tool(&call.name)?;
    let display_name = capability.provider_id.clone();
    let action = capability.tool_name.clone();
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            &display_name,
            &tool_label(&display_name, &action),
            "running",
            call.arguments.clone(),
            None,
            started_at,
            None,
        ),
        "toolStarted",
    );
    let result = service.execute_model_tool_blocking(&call.name, call.arguments.clone())?;
    let (status, output) = match result.status {
        lyra_agent_api::AgentToolStatus::Completed => {
            let raw = result.output.unwrap_or(Value::Null);
            let content = raw
                .get("content")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| serde_json::to_string_pretty(&raw).unwrap_or_default());
            (
                "completed",
                budgeted_tool_output(session_id, turn_id, &call.id, content, raw, None),
            )
        }
        lyra_agent_api::AgentToolStatus::Running => (
            "running",
            budgeted_tool_output(
                session_id,
                turn_id,
                &call.id,
                "Registry tool is still running.".to_string(),
                result.output.unwrap_or(Value::Null),
                Some(
                    "Wait for the registry tool to finish before relying on its result."
                        .to_string(),
                ),
            ),
        ),
        lyra_agent_api::AgentToolStatus::Cancelled => (
            "cancelled",
            tool_failure_output(
                "cancelled",
                "Registry tool was cancelled.",
                "Retry only if the user still wants this tool call.",
                result.output,
            ),
        ),
        lyra_agent_api::AgentToolStatus::Failed => {
            let detail = result
                .error
                .as_ref()
                .and_then(|error| serde_json::to_value(error).ok())
                .or(result.output);
            let message = result
                .error
                .as_ref()
                .map(|error| error.message.clone())
                .unwrap_or_else(|| "Registry tool failed.".to_string());
            (
                "failed",
                tool_failure_output(
                    "registry_tool_failed",
                    &message,
                    "Inspect the structured error and retry with valid tool input.",
                    detail,
                ),
            )
        }
    };
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            &call.id,
            &display_name,
            &tool_label(&display_name, &action),
            status,
            call.arguments.clone(),
            Some(output.clone()),
            started_at,
            Some(now()),
        ),
        "toolFinished",
    );
    Some(output)
}

pub(crate) fn run_native_tool(
    session_id: &str,
    turn_id: &str,
    tool_name: &str,
    tool_call_id: &str,
    input: &Value,
) -> NativeToolResult {
    match tool_name {
        "artifact_read" => tool_artifact_read(session_id, turn_id, tool_call_id, input),
        "file_read" => tool_file_read(session_id, turn_id, tool_call_id, input),
        "file_list" => tool_file_list(session_id, input),
        "file_glob" => tool_file_glob(session_id, input),
        "file_write" => tool_file_write(session_id, turn_id, tool_call_id, input),
        "file_edit" => tool_file_edit(session_id, turn_id, tool_call_id, input),
        "file_multiedit" => tool_file_multiedit(session_id, turn_id, tool_call_id, input),
        "apply_patch" => tool_apply_patch(session_id, turn_id, tool_call_id, input),
        "shell_run" => tool_shell_run(session_id, input),
        "project_search" => tool_project_search(session_id, input),
        "code_search_text" => tool_code_search_text(session_id, input),
        "code_search_symbol" => tool_code_search_symbol(session_id, input),
        "code_graph_expand" => tool_code_graph_expand(session_id, input),
        "lsp_query" => tool_lsp_query(session_id, input),
        "network_status" => tool_network_status(),
        "web_search" => tool_web_search(input),
        "web_fetch" => tool_web_fetch(turn_id, tool_call_id, input),
        "todo_read" => tool_todo_read(session_id),
        "todo_write" => tool_todo_write(session_id, turn_id, input),
        _ => Err(NativeToolFailure::new(
            "tool_not_found",
            format!("Unknown Lyra native tool: {tool_name}"),
            "Call one of the tools listed in the current Lyra runtime context.",
        )),
    }
}

pub(crate) fn budgeted_tool_output(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    content: String,
    raw: Value,
    recommended_next_action: Option<String>,
) -> Value {
    let content_char_count = content.chars().count();
    let (content, truncated, artifact_ref, truncated_reason) =
        if content_char_count > DEFAULT_TOOL_CONTENT_CHARS {
            let artifact_ref = write_tool_artifact(session_id, turn_id, tool_call_id, &content);
            (
                truncate_chars(&content, DEFAULT_TOOL_CONTENT_CHARS),
                true,
                artifact_ref,
                Some(format!(
                    "tool output exceeded {DEFAULT_TOOL_CONTENT_CHARS} characters"
                )),
            )
        } else {
            (content, false, None, None)
        };
    json!({
        "content": content,
        "raw": raw,
        "truncated": truncated,
        "artifactRef": artifact_ref,
        "truncatedReason": truncated_reason,
        "recommendedNextAction": recommended_next_action,
    })
}

pub(crate) fn tool_failure_output(
    code: &str,
    message: &str,
    recommended_next_action: &str,
    detail: Option<Value>,
) -> Value {
    json!({
        "content": format!("Lyra tool failed: {message}"),
        "error": {
            "code": code,
            "message": message,
            "detail": detail,
        },
        "truncated": false,
        "artifactRef": Value::Null,
        "recommendedNextAction": recommended_next_action,
    })
}

pub(crate) fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut output = value.chars().take(max_chars).collect::<String>();
    output.push_str("\n\n[truncated]");
    output
}

pub(crate) fn write_tool_artifact(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    content: &str,
) -> Option<Value> {
    let root = state().lock().ok().map(|state| state.root.clone())?;
    let artifact_id = format!(
        "artifact-{}-{}",
        sanitize_component(tool_call_id),
        Uuid::new_v4()
    );
    let dir = root
        .join("artifacts")
        .join(sanitize_component(session_id))
        .join(sanitize_component(turn_id));
    fs::create_dir_all(&dir).ok()?;
    let path = dir.join(format!("{artifact_id}.txt"));
    fs::write(&path, content).ok()?;
    Some(json!({
        "id": artifact_id,
        "kind": "tool_output",
        "mimeType": "text/plain; charset=utf-8",
        "path": path.display().to_string(),
        "uri": format!(
            "lyra-agent://artifact/{}/{}/{}",
            sanitize_component(session_id),
            sanitize_component(turn_id),
            sanitize_component(tool_call_id)
        ),
    }))
}

pub(crate) fn sanitize_component(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

pub(crate) fn value_string(input: &Value, key: &str) -> Option<String> {
    input
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(crate) fn required_value_string(input: &Value, key: &str) -> Result<String, NativeToolFailure> {
    value_string(input, key).ok_or_else(|| {
        NativeToolFailure::new(
            "bad_request",
            format!("{key} is required"),
            "Retry the tool call with the required input field.",
        )
    })
}

pub(crate) fn value_bool(input: &Value, key: &str, default: bool) -> bool {
    input.get(key).and_then(Value::as_bool).unwrap_or(default)
}

pub(crate) fn value_usize(input: &Value, key: &str, default: usize, max: usize) -> usize {
    input
        .get(key)
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(default)
        .max(1)
        .min(max)
}

pub(crate) fn value_u64(input: &Value, key: &str, default: u64, max: u64) -> u64 {
    input
        .get(key)
        .and_then(Value::as_u64)
        .unwrap_or(default)
        .max(1)
        .min(max)
}

pub(crate) fn session_workspace_root(session_id: &str) -> Result<PathBuf, NativeToolFailure> {
    let (project_bound, working_dir) = state()
        .lock()
        .map_err(|_| {
            NativeToolFailure::new(
                "runtime_state_unavailable",
                "agent runtime state lock failed",
                "Retry the tool call.",
            )
        })?
        .sessions
        .get(session_id)
        .map(|session| {
            let project_bound = session
                .snapshot
                .get("projectBound")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let working_dir = session
                .snapshot
                .get("workingDir")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();
            (project_bound, working_dir)
        })
        .unwrap_or((false, String::new()));
    if !project_bound || working_dir.is_empty() {
        return Err(NativeToolFailure::new(
            "workspace_unbound",
            "session is not bound to a project",
            "Bind the session to an existing project root and retry.",
        ));
    }
    let root = PathBuf::from(working_dir);
    let root = if root.exists() {
        root.canonicalize().map_err(|error| {
            NativeToolFailure::new(
                "workspace_root_unavailable",
                format!("failed to canonicalize workspace root: {error}"),
                "Bind the session to an existing project root and retry.",
            )
        })?
    } else {
        return Err(NativeToolFailure::new(
            "workspace_root_unavailable",
            format!("workspace root does not exist: {}", root.display()),
            "Bind the session to an existing project root and retry.",
        ));
    };
    Ok(root)
}

pub(crate) fn resolve_workspace_path(
    session_id: &str,
    raw_path: &str,
    allow_missing_leaf: bool,
) -> Result<WorkspacePath, NativeToolFailure> {
    if raw_path.contains('\0') {
        return Err(NativeToolFailure::new(
            "permission_denied",
            "path contains a NUL byte",
            "Retry with a normal workspace-relative path.",
        ));
    }
    let root = session_workspace_root(session_id)?;
    let candidate = PathBuf::from(raw_path);
    let candidate = if candidate.is_absolute() {
        candidate
    } else {
        root.join(candidate)
    };
    let absolute = if candidate.exists() {
        candidate.canonicalize().map_err(|error| {
            NativeToolFailure::new(
                "path_unavailable",
                format!("failed to canonicalize path: {error}"),
                "Retry with a readable workspace path.",
            )
        })?
    } else if allow_missing_leaf {
        let parent = candidate.parent().ok_or_else(|| {
            NativeToolFailure::new(
                "bad_request",
                "path has no parent directory",
                "Retry with a file path inside the workspace.",
            )
        })?;
        let parent = parent.canonicalize().map_err(|error| {
            NativeToolFailure::new(
                "path_unavailable",
                format!("failed to canonicalize parent directory: {error}"),
                "Create the parent directory first or choose an existing parent.",
            )
        })?;
        let file_name = candidate.file_name().ok_or_else(|| {
            NativeToolFailure::new(
                "bad_request",
                "path has no file name",
                "Retry with a file path inside the workspace.",
            )
        })?;
        parent.join(file_name)
    } else {
        return Err(NativeToolFailure::new(
            "path_not_found",
            format!("path does not exist: {}", candidate.display()),
            "Retry with an existing workspace path.",
        ));
    };
    if !absolute.starts_with(&root) {
        return Err(NativeToolFailure::new(
            "permission_denied",
            format!(
                "path is outside the session workspace: {}",
                absolute.display()
            ),
            "Use a path inside the bound project workspace.",
        )
        .with_detail(json!({
            "workspaceRoot": root.display().to_string(),
            "path": absolute.display().to_string(),
        })));
    }
    let relative = absolute
        .strip_prefix(&root)
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| absolute.display().to_string());
    Ok(WorkspacePath {
        root,
        absolute,
        relative: if relative.is_empty() {
            ".".to_string()
        } else {
            relative
        },
    })
}
