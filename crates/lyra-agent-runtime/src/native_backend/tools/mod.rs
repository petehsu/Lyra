use super::*;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};

mod artifact;
mod browser_adapter;
mod clarification_adapter;
mod design_adapter;
mod file;
mod git_adapter;
mod hardware;
mod mcp_adapter;
mod memory_adapter;
mod native_helpers;
mod render;
mod search;
mod shell;
mod skill_adapter;
mod software_adapter;
mod terminal;
mod todo;
pub(crate) mod tool_fs;
mod web;
mod workbench_adapter;

pub(crate) use self::{
    artifact::*, browser_adapter::*, clarification_adapter::*, design_adapter::*, file::*,
    git_adapter::*, hardware::*, mcp_adapter::*, memory_adapter::*, native_helpers::*, render::*,
    search::*, shell::*, skill_adapter::*, software_adapter::*, terminal::*, todo::*, web::*,
    workbench_adapter::*,
};

const MIN_TOOL_TIMEOUT_MS: u64 = 250;
const DEFAULT_HOST_TOOL_TIMEOUT_MS: u64 = 15_000;
const DEFAULT_BROWSER_TOOL_TIMEOUT_MS: u64 = 8_000;
const DEFAULT_BROWSER_WAIT_TIMEOUT_MS: u64 = 30_000;
const DEFAULT_SOFTWARE_TOOL_TIMEOUT_MS: u64 = 30_000;
const MAX_TOOL_TIMEOUT_MS: u64 = 120_000;
const MAX_BROWSER_PAGE_INLINE_CHARS: usize = 12_000;
const MAX_IMAGE_EVIDENCE_TOOL_BYTES: u64 = 8 * 1024 * 1024;

fn needs_user_action_object(value: &Value) -> Option<&serde_json::Map<String, Value>> {
    value.get("needsUserAction").and_then(Value::as_object)
}

fn user_action_string<'a>(
    action: &'a serde_json::Map<String, Value>,
    key: &str,
) -> Option<&'a str> {
    action
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
}

fn user_action_tab_id(
    input: &Value,
    value: &Value,
    action: &serde_json::Map<String, Value>,
) -> String {
    user_action_string(action, "tabId")
        .or_else(|| value.get("tabId").and_then(Value::as_str))
        .or_else(|| input.get("tabId").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string()
}

fn wait_for_automatic_user_action(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    question: &str,
    options: Vec<Value>,
    detail: Option<String>,
) -> AgentRuntimeResult<ClarificationRequest> {
    wait_for_clarification(ClarificationRequest {
        id: format!("clarification-{}", Uuid::new_v4()),
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        tool_call_id: tool_call_id.to_string(),
        question: question.to_string(),
        options,
        allow_custom_answer: false,
        detail,
        status: "pending".to_string(),
        answer: None,
        selected_option: None,
        created_at: now(),
        responded_at: None,
    })
}

fn selected_answer_label(request: &ClarificationRequest) -> String {
    request
        .selected_option
        .clone()
        .or_else(|| request.answer.clone())
        .unwrap_or_default()
}

fn shared_control_decision(label: &str) -> &'static str {
    match label {
        "Continue Agent" => "continue_agent",
        "Use Isolated" => "use_isolated",
        "Cancel Task" => "cancel_task",
        _ => "user_takeover",
    }
}

fn permission_for_automatic_elevation(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    tab_id: &str,
    reason: &str,
) -> Result<Value, String> {
    let input = json!({
        "tabId": tab_id,
        "targetMode": "isolated",
        "reason": reason,
        "permissionRequired": true,
        "permissionRisk": "dangerous",
    });
    let Some(permission) = permission_request_for_tool(
        session_id,
        turn_id,
        tool_call_id,
        "lyra_lumen",
        "elevate",
        &input,
    ) else {
        return Ok(auto_approval_policy_decision(
            "lyra_lumen",
            "elevate",
            &input,
        ));
    };
    let permission_record = permission.clone();
    wait_for_permission(permission)
        .map(|allowed| {
            policy_decision_from_permission(
                &permission_record,
                if allowed { "approved" } else { "denied" },
            )
        })
        .map_err(|error| error.to_string())
}

fn invoke_optional_host(
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
    method: &str,
    payload: Value,
) -> Value {
    match dispatcher {
        Some(dispatcher) => match invoke_host_capability(dispatcher, method, payload) {
            Ok(value) => value,
            Err(error) => json!({
                "ok": false,
                "error": {
                    "code": "host_capability_failed",
                    "message": error,
                }
            }),
        },
        None => json!({
            "ok": false,
            "error": {
                "code": "host_capability_unavailable",
                "message": "Lyra host capability bridge is not available.",
            }
        }),
    }
}

fn resolve_shared_control_user_action(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
    value: &Value,
    action: &serde_json::Map<String, Value>,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Value {
    let tab_id = user_action_tab_id(input, value, action);
    let request = wait_for_automatic_user_action(
        session_id,
        turn_id,
        tool_call_id,
        "The user interrupted Lyra Agent control of the live browser tab. Who should control it now?",
        vec![
            json!({ "label": "Continue Agent", "description": "Resume Lyra Agent control from the latest browser recovery anchor." }),
            json!({ "label": "Take Over", "description": "Leave the visible tab under user control until the user explicitly authorizes Agent again." }),
            json!({ "label": "Use Isolated", "description": "Stop using the live tab and continue with isolated background browser state." }),
            json!({ "label": "Cancel Task", "description": "Cancel this browser task." }),
        ],
        Some("ControlHandoffEvent was emitted by live browser input arbitration.".to_string()),
    );
    match request {
        Ok(request) => {
            let label = selected_answer_label(&request);
            let decision = shared_control_decision(&label);
            let control_resolution = invoke_optional_host(
                dispatcher,
                "lyraLumen.resolveControlHandoff",
                json!({
                    "tabId": tab_id,
                    "targetMode": "live",
                    "decision": decision,
                }),
            );
            json!({
                "kind": "shared_control_decision",
                "clarificationId": request.id,
                "answer": request.answer,
                "selectedOption": request.selected_option,
                "decision": decision,
                "controlResolution": control_resolution,
            })
        }
        Err(error) => json!({
            "kind": "shared_control_decision_failed",
            "error": {
                "code": "clarification_failed",
                "message": error.to_string(),
            }
        }),
    }
}

fn resolve_auth_challenge_user_action(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
    value: &Value,
    action: &serde_json::Map<String, Value>,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Value {
    let tab_id = user_action_tab_id(input, value, action);
    let reason = user_action_string(action, "reason").unwrap_or("auth_challenge");
    let request = wait_for_automatic_user_action(
        session_id,
        turn_id,
        tool_call_id,
        "The isolated browser hit an authentication or verification challenge that requires user action.",
        vec![
            json!({ "label": "Open Visible Tab", "description": "Elevate this isolated browser task to a visible tab so the user can complete the challenge." }),
            json!({ "label": "Already Completed", "description": "The user already completed the challenge; verify and continue." }),
            json!({ "label": "Cancel Task", "description": "Cancel this browser task." }),
        ],
        Some(format!("AuthChallengeSignal: {reason}")),
    );
    let request = match request {
        Ok(request) => request,
        Err(error) => {
            return json!({
                "kind": "auth_challenge_resolution_failed",
                "error": {
                    "code": "clarification_failed",
                    "message": error.to_string(),
                }
            });
        }
    };
    let label = selected_answer_label(&request);
    if label == "Cancel Task" {
        return json!({
            "kind": "auth_challenge_resolution",
            "clarificationId": request.id,
            "answer": request.answer,
            "selectedOption": request.selected_option,
            "decision": "cancel_task",
        });
    }

    let mut elevation = Value::Null;
    let mut elevation_policy_decision = None;
    if label == "Open Visible Tab" {
        match permission_for_automatic_elevation(session_id, turn_id, tool_call_id, &tab_id, reason)
        {
            Ok(policy_decision)
                if policy_decision
                    .get("outcome")
                    .and_then(Value::as_str)
                    .is_some_and(|outcome| outcome == "approved") =>
            {
                elevation_policy_decision = Some(policy_decision);
                elevation = invoke_optional_host(
                    dispatcher,
                    "lyraLumen.elevate",
                    json!({
                        "tabId": tab_id,
                        "targetMode": "isolated",
                        "reason": reason,
                    }),
                );
            }
            Ok(policy_decision) => {
                return json!({
                    "kind": "auth_challenge_resolution",
                    "clarificationId": request.id,
                    "answer": request.answer,
                    "selectedOption": request.selected_option,
                    "decision": "permission_denied",
                    "policyDecision": policy_decision,
                });
            }
            Err(error) => {
                return json!({
                    "kind": "auth_challenge_resolution_failed",
                    "clarificationId": request.id,
                    "error": {
                        "code": "permission_failed",
                        "message": error,
                    }
                });
            }
        }
        let completion_request = wait_for_automatic_user_action(
            session_id,
            turn_id,
            tool_call_id,
            "Complete the browser challenge in the visible tab, then confirm Lyra can verify and continue.",
            vec![
                json!({ "label": "Done", "description": "Verify that the challenge is gone and continue in isolated mode." }),
                json!({ "label": "Cancel Task", "description": "Cancel this browser task." }),
            ],
            Some("Lyra will not solve CAPTCHA or MFA itself; it only resumes after user confirmation.".to_string()),
        );
        if let Ok(done) = completion_request {
            if selected_answer_label(&done) == "Cancel Task" {
                return json!({
                    "kind": "auth_challenge_resolution",
                    "clarificationId": done.id,
                    "answer": done.answer,
                    "selectedOption": done.selected_option,
                    "decision": "cancel_task",
                    "elevation": elevation,
                });
            }
        }
    }

    let live_tab_id = elevation
        .get("liveTabId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let elevation_session_id = elevation
        .pointer("/elevationSession/sessionId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let verification = invoke_optional_host(
        dispatcher,
        "lyraLumen.completeElevation",
        json!({
            "tabId": tab_id,
            "targetMode": "isolated",
            "liveTabId": live_tab_id,
            "elevationSessionId": elevation_session_id,
        }),
    );
    json!({
        "kind": "auth_challenge_resolution",
        "clarificationId": request.id,
        "answer": request.answer,
        "selectedOption": request.selected_option,
        "decision": if label == "Already Completed" { "verify" } else { "elevate_and_verify" },
        "elevation": elevation,
        "policyDecision": elevation_policy_decision,
        "verification": verification,
    })
}

fn resolve_host_needs_user_action(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    _display_name: &str,
    _tool_action: &str,
    input: &Value,
    value: &Value,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Option<Value> {
    let action = needs_user_action_object(value)?;
    let kind = user_action_string(action, "kind").unwrap_or("user_action");
    Some(match kind {
        "shared_control_interrupted" => resolve_shared_control_user_action(
            session_id,
            turn_id,
            tool_call_id,
            input,
            value,
            action,
            dispatcher,
        ),
        "auth_challenge" => resolve_auth_challenge_user_action(
            session_id,
            turn_id,
            tool_call_id,
            input,
            value,
            action,
            dispatcher,
        ),
        _ => json!({
            "kind": "user_action_unhandled",
            "needsUserActionKind": kind,
        }),
    })
}

fn format_user_action_resolution(resolution: &Value) -> String {
    let kind = resolution
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("user_action_resolution");
    let decision = resolution
        .get("decision")
        .and_then(Value::as_str)
        .unwrap_or("recorded");
    format!("User action resolution: {kind} ({decision}).")
}

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
    if tool_fs::is_tool_fs_model_tool(&call.name) {
        return tool_fs::execute_tool_fs_model_tool(
            session_id,
            turn_id,
            dispatcher,
            cancellation,
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

fn policy_decision_from_permission(request: &PermissionRequest, outcome: &str) -> Value {
    json!({
        "recordType": "policy_decision",
        "mode": "user_prompt",
        "outcome": outcome,
        "permissionRequestId": request.id,
        "risk": request.risk,
        "action": request.action,
        "summary": request.summary,
        "recordedAt": now(),
    })
}

pub(crate) fn auto_approval_policy_decision(
    display_name: &str,
    action: &str,
    input: &Value,
) -> Value {
    json!({
        "recordType": "policy_decision",
        "mode": "auto_approved",
        "outcome": "approved",
        "risk": permission_risk(display_name, action, input).unwrap_or_else(|| "mutation".to_string()),
        "action": action,
        "summary": permission_summary(display_name, action, input),
        "recordedAt": now(),
    })
}

fn policy_denial_decision(display_name: &str, action: &str, input: &Value, risk: &str) -> Value {
    json!({
        "recordType": "policy_decision",
        "mode": "local_policy",
        "outcome": "denied",
        "risk": risk,
        "action": action,
        "summary": permission_summary(display_name, action, input),
        "recordedAt": now(),
    })
}

pub(crate) fn policy_record_required(display_name: &str, action: &str, input: &Value) -> bool {
    match (display_name, action) {
        ("file", "write" | "edit" | "multiedit" | "apply_patch") => true,
        ("shell", "run") => true,
        ("terminal", "create") => input
            .get("command")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty()),
        ("terminal", terminal_action) => terminal_action_requires_policy(terminal_action),
        ("hardware", "session_open" | "session_read" | "session_write" | "run_action") => true,
        ("git", "stage" | "unstage" | "discard") => true,
        ("lyra_lumen", "act" | "type" | "press" | "submit" | "navigate" | "elevate") => true,
        ("software", "invoke_capability") => true,
        _ => false,
    }
}

fn attach_policy_decision_to_raw(mut raw: Value, policy_decision: Option<Value>) -> Value {
    let Some(policy_decision) = policy_decision else {
        return raw;
    };
    if let Some(object) = raw.as_object_mut() {
        object
            .entry("policyDecision".to_string())
            .or_insert(policy_decision);
    }
    raw
}

fn attach_policy_decision_to_output(mut output: Value, policy_decision: Option<Value>) -> Value {
    let Some(policy_decision) = policy_decision else {
        return output;
    };
    if let Some(raw) = output.get_mut("raw")
        && let Some(raw_object) = raw.as_object_mut()
    {
        raw_object
            .entry("policyDecision".to_string())
            .or_insert(policy_decision);
        return output;
    }
    if let Some(object) = output.as_object_mut() {
        object
            .entry("policyDecision".to_string())
            .or_insert(policy_decision);
    }
    output
}

fn execute_host_tool_adapter(
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

fn attach_lumen_page_artifact(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    display_name: &str,
    action: &str,
    value: &mut Value,
) {
    if display_name != "lyra_lumen"
        || !matches!(
            action,
            "map" | "read" | "read_until" | "wait" | "follow_audit"
        )
        || value.get("pageArtifactRef").is_some()
    {
        return;
    }
    let Some((field, text)) = lumen_page_text_field(value) else {
        return;
    };
    let original_chars = text.chars().count();
    if original_chars <= MAX_BROWSER_PAGE_INLINE_CHARS {
        return;
    }
    let Some(artifact_ref) = write_tool_artifact_with_kind(
        session_id,
        turn_id,
        &format!("{tool_call_id}-browser-page"),
        ToolArtifactKind::WebPage,
        &text,
    ) else {
        return;
    };
    let preview = format!(
        "{}\n\n[Full browser page text stored in pageArtifactRef.]",
        truncate_chars(&text, MAX_BROWSER_PAGE_INLINE_CHARS)
    );
    if let Some(object) = value.as_object_mut() {
        if let Some(field_value) = object.get_mut(field) {
            *field_value = Value::String(preview);
        }
        object.insert("pageArtifactRef".to_string(), artifact_ref);
        object.insert("pageTextTruncated".to_string(), Value::Bool(true));
        object.insert(
            "pageTextSourceField".to_string(),
            Value::String(field.to_string()),
        );
        object.insert(
            "pageTextOriginalChars".to_string(),
            Value::Number(serde_json::Number::from(original_chars as u64)),
        );
    }
}

fn lumen_page_text_field(value: &Value) -> Option<(&'static str, String)> {
    let mut best: Option<(&'static str, String, usize)> = None;
    for field in [
        "content",
        "text",
        "markdown",
        "pageText",
        "visibleText",
        "innerText",
        "compactText",
        "html",
    ] {
        let Some(text) = value
            .get(field)
            .and_then(Value::as_str)
            .filter(|text| !text.trim().is_empty())
        else {
            continue;
        };
        let chars = text.chars().count();
        if best
            .as_ref()
            .is_none_or(|(_, _, best_chars)| chars > *best_chars)
        {
            best = Some((field, text.to_string(), chars));
        }
    }
    best.map(|(field, text, _)| (field, text))
}

fn attach_host_log_artifact(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    display_name: &str,
    action: &str,
    mut raw: Value,
) -> Value {
    if display_name != "terminal" || raw.get("logArtifactRef").is_some() {
        return raw;
    }
    let log_text = raw
        .get("output")
        .and_then(Value::as_str)
        .or_else(|| raw.pointer("/screen/visibleText").and_then(Value::as_str))
        .or_else(|| raw.get("text").and_then(Value::as_str))
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string);
    let Some(log_text) = log_text else {
        return raw;
    };
    let Some(log_ref) = write_tool_artifact_with_kind(
        session_id,
        turn_id,
        &format!("{tool_call_id}-terminal-{action}-log"),
        ToolArtifactKind::Log,
        &log_text,
    ) else {
        return raw;
    };
    if let Some(object) = raw.as_object_mut() {
        object.insert("logArtifactRef".to_string(), log_ref);
    }
    raw
}

fn attach_lumen_screenshot_artifact(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    display_name: &str,
    action: &str,
    value: &mut Value,
) {
    if display_name != "lyra_lumen" || action != "see" {
        return;
    }
    if let Some(path) = value
        .pointer("/imageArtifact/path")
        .and_then(Value::as_str)
        .filter(|path| !path.trim().is_empty())
        .map(str::to_string)
    {
        attach_provider_image_for_existing_artifact(value, &path);
        return;
    }
    let Some(image_data) = value
        .get("imageBase64")
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/screenshot/data").and_then(Value::as_str))
        .filter(|data| !data.trim().is_empty())
    else {
        return;
    };
    let image_data = image_data
        .trim()
        .strip_prefix("data:")
        .and_then(|data_url| data_url.split_once(',').map(|(_, data)| data))
        .unwrap_or(image_data.trim());
    let Ok(bytes) = BASE64_STANDARD.decode(image_data) else {
        return;
    };
    if bytes.is_empty() {
        return;
    }
    let media_type = value
        .pointer("/screenshot/mediaType")
        .or_else(|| value.get("mediaType"))
        .and_then(Value::as_str)
        .unwrap_or("image/png")
        .to_string();
    let extension = image_extension_for_media_type(&media_type);
    let Some(artifact_ref) = write_tool_artifact_bytes_with_kind(
        session_id,
        turn_id,
        &format!("{tool_call_id}-browser-screenshot"),
        ToolArtifactKind::BrowserScreenshot,
        extension,
        &media_type,
        &bytes,
    ) else {
        return;
    };
    let width = value
        .get("width")
        .or_else(|| value.pointer("/screenshot/width"))
        .and_then(Value::as_u64);
    let height = value
        .get("height")
        .or_else(|| value.pointer("/screenshot/height"))
        .and_then(Value::as_u64);
    let path = artifact_ref
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let id = artifact_ref
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("browser_screenshot")
        .to_string();
    if let Some(object) = value.as_object_mut() {
        object.insert("screenshotArtifactRef".to_string(), artifact_ref.clone());
        object.insert(
            "providerImage".to_string(),
            json!({
                "path": path,
                "mediaType": media_type,
                "bytes": bytes.len(),
            }),
        );
        object.insert(
            "imageArtifact".to_string(),
            json!({
                "id": id,
                "kind": "image",
                "mediaType": media_type,
                "path": path,
                "width": width,
                "height": height,
                "openTarget": {
                    "kind": "file",
                    "path": path,
                    "mediaType": media_type,
                }
            }),
        );
    }
}

fn attach_workbench_visual_evidence_artifact(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    display_name: &str,
    action: &str,
    value: &mut Value,
) {
    if display_name != "workbench" || action != "capture_visual_evidence" {
        return;
    }
    if value
        .pointer("/providerImage/path")
        .and_then(Value::as_str)
        .is_some_and(|path| !path.trim().is_empty())
    {
        return;
    }
    let Some(image_data) = value
        .pointer("/capture/imageBase64")
        .and_then(Value::as_str)
        .or_else(|| value.get("imageBase64").and_then(Value::as_str))
        .filter(|data| !data.trim().is_empty())
    else {
        if let Some(path) = value
            .pointer("/imageArtifact/path")
            .and_then(Value::as_str)
            .filter(|path| !path.trim().is_empty())
            .map(str::to_string)
        {
            attach_provider_image_for_existing_artifact(value, &path);
        }
        return;
    };
    let image_data = image_data
        .trim()
        .strip_prefix("data:")
        .and_then(|data_url| data_url.split_once(',').map(|(_, data)| data))
        .unwrap_or(image_data.trim());
    let Ok(bytes) = BASE64_STANDARD.decode(image_data) else {
        return;
    };
    if bytes.is_empty() || bytes.len() as u64 > MAX_IMAGE_EVIDENCE_TOOL_BYTES {
        return;
    }
    let media_type = value
        .pointer("/capture/mimeType")
        .or_else(|| value.get("mimeType"))
        .and_then(Value::as_str)
        .unwrap_or("image/png")
        .to_string();
    if !media_type
        .split(';')
        .next()
        .unwrap_or(&media_type)
        .trim()
        .to_ascii_lowercase()
        .starts_with("image/")
    {
        return;
    }
    let extension = image_extension_for_media_type(&media_type);
    let Some(artifact_ref) = write_tool_artifact_bytes_with_kind(
        session_id,
        turn_id,
        &format!("{tool_call_id}-workspace-visual-evidence"),
        ToolArtifactKind::ImageEvidence,
        extension,
        &media_type,
        &bytes,
    ) else {
        return;
    };
    let width = value
        .get("width")
        .or_else(|| value.pointer("/capture/width"))
        .and_then(Value::as_u64);
    let height = value
        .get("height")
        .or_else(|| value.pointer("/capture/height"))
        .and_then(Value::as_u64);
    let visible_only = value
        .get("visibleOnly")
        .or_else(|| value.pointer("/capture/visibleOnly"))
        .and_then(Value::as_bool);
    let path = artifact_ref
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let id = artifact_ref
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("workspace_visual_evidence")
        .to_string();
    if let Some(object) = value.as_object_mut() {
        if let Some(capture) = object.get_mut("capture").and_then(Value::as_object_mut) {
            capture.remove("imageBase64");
        }
        object.remove("imageBase64");
        object.insert("imageEvidenceArtifactRef".to_string(), artifact_ref);
        object.insert(
            "providerImage".to_string(),
            json!({
                "path": path,
                "mediaType": media_type,
                "bytes": bytes.len(),
            }),
        );
        object.insert(
            "imageArtifact".to_string(),
            json!({
                "id": id,
                "kind": "image",
                "mediaType": media_type,
                "path": path,
                "width": width,
                "height": height,
                "visibleOnly": visible_only,
                "openTarget": {
                    "kind": "file",
                    "path": path,
                    "mediaType": media_type,
                },
            }),
        );
    }
}

fn attach_provider_image_for_existing_artifact(value: &mut Value, path: &str) {
    if value
        .pointer("/providerImage/path")
        .and_then(Value::as_str)
        .is_some_and(|path| !path.trim().is_empty())
    {
        return;
    }
    let Ok(Some(artifact)) = resolve_lyra_artifact_path(path) else {
        return;
    };
    let Ok(metadata) = fs::metadata(&artifact.absolute) else {
        return;
    };
    if metadata.len() == 0 || metadata.len() > MAX_IMAGE_EVIDENCE_TOOL_BYTES {
        return;
    }
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "providerImage".to_string(),
            json!({
                "path": path,
                "mediaType": artifact.media_type,
                "bytes": metadata.len(),
            }),
        );
    }
}

fn attach_software_image_evidence_artifact(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    display_name: &str,
    action: &str,
    input: &Value,
    value: &mut Value,
) {
    if display_name != "software"
        || action != "invoke_capability"
        || !software_image_viewer_vision_fallback(input, value)
        || value
            .pointer("/providerImage/path")
            .and_then(Value::as_str)
            .is_some_and(|path| !path.trim().is_empty())
    {
        return;
    }
    let Some(image_artifact) = value
        .pointer("/imageArtifact")
        .or_else(|| value.pointer("/output/imageArtifact"))
        .filter(|artifact| artifact.is_object())
    else {
        return;
    };
    let Some(source_path) = image_artifact
        .get("path")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|path| !path.is_empty())
    else {
        return;
    };
    let media_type = image_artifact
        .get("mediaType")
        .or_else(|| image_artifact.get("mimeType"))
        .and_then(Value::as_str)
        .unwrap_or("image/png")
        .trim()
        .to_string();
    if !media_type
        .split(';')
        .next()
        .unwrap_or(&media_type)
        .trim()
        .to_ascii_lowercase()
        .starts_with("image/")
    {
        return;
    }
    let source = PathBuf::from(source_path);
    let Ok(metadata) = fs::metadata(&source) else {
        return;
    };
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_IMAGE_EVIDENCE_TOOL_BYTES
    {
        return;
    }
    let Ok(bytes) = fs::read(&source) else {
        return;
    };
    if bytes.is_empty() {
        return;
    }
    let extension = image_extension_for_media_type(&media_type);
    let Some(artifact_ref) = write_tool_artifact_bytes_with_kind(
        session_id,
        turn_id,
        &format!("{tool_call_id}-image-evidence"),
        ToolArtifactKind::ImageEvidence,
        extension,
        &media_type,
        &bytes,
    ) else {
        return;
    };
    let path = artifact_ref
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let id = artifact_ref
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("image_evidence")
        .to_string();
    let width = image_artifact.get("width").and_then(Value::as_u64);
    let height = image_artifact.get("height").and_then(Value::as_u64);
    let source_artifact = image_artifact.clone();
    if let Some(object) = value.as_object_mut() {
        object.insert("imageEvidenceArtifactRef".to_string(), artifact_ref);
        object.insert(
            "providerImage".to_string(),
            json!({
                "path": path,
                "mediaType": media_type,
                "bytes": bytes.len(),
            }),
        );
        object.insert(
            "imageArtifact".to_string(),
            json!({
                "id": id,
                "kind": "image",
                "mediaType": media_type,
                "path": path,
                "width": width,
                "height": height,
                "openTarget": {
                    "kind": "file",
                    "path": path,
                    "mediaType": media_type,
                },
                "source": source_artifact,
            }),
        );
    }
}

fn software_image_viewer_vision_fallback(input: &Value, value: &Value) -> bool {
    let software_id = input
        .get("softwareId")
        .or_else(|| value.get("softwareId"))
        .and_then(Value::as_str);
    let action_id = input
        .get("actionId")
        .or_else(|| input.get("capabilityId"))
        .or_else(|| value.get("actionId"))
        .or_else(|| value.get("capabilityId"))
        .and_then(Value::as_str);
    software_id == Some("image-viewer") && action_id == Some("image-viewer.prepareVisionFallback")
}

fn image_extension_for_media_type(media_type: &str) -> &'static str {
    match media_type
        .split(';')
        .next()
        .unwrap_or(media_type)
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        _ => "png",
    }
}

fn host_adapter_error_code(error: &str) -> &'static str {
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

fn host_adapter_arguments(arguments: Value, action: &str) -> Value {
    let mut input = arguments.as_object().cloned().unwrap_or_default();
    input.insert("action".to_string(), Value::String(action.to_string()));
    Value::Object(input)
}

fn software_capability_adapter_arguments(
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

fn strip_tool_fs_metadata(arguments: Value) -> Value {
    let mut input = arguments.as_object().cloned().unwrap_or_default();
    for key in ["toolPath", "domain", "operation", "toolOperation", "action"] {
        input.remove(key);
    }
    Value::Object(input)
}

fn permission_wait_was_cancelled(error: &AgentRuntimeError) -> bool {
    error.to_string().contains("turn cancelled")
}

pub(crate) fn attach_runtime_cancellation(
    mut input: Value,
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
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
                "toolCallId": tool_call_id,
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
        ("terminal", "wait" | "read_until") => 35_000,
        ("terminal", _) => DEFAULT_HOST_TOOL_TIMEOUT_MS,
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

fn execute_native_tool_adapter(
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
fn execute_native_tool_adapter_with_dispatcher(
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

pub(crate) fn native_permission_request_for_tool(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    display_name: &str,
    action: &str,
    input: &Value,
) -> Option<PermissionRequest> {
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
    shell_command_requires_permission(command)
}

#[allow(dead_code)]
pub(crate) fn run_native_tool(
    session_id: &str,
    turn_id: &str,
    tool_name: &str,
    tool_call_id: &str,
    input: &Value,
) -> NativeToolResult {
    run_native_tool_with_dispatcher(session_id, turn_id, tool_name, tool_call_id, input, None)
}

pub(crate) fn run_native_tool_with_dispatcher(
    session_id: &str,
    turn_id: &str,
    tool_name: &str,
    tool_call_id: &str,
    input: &Value,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> NativeToolResult {
    match tool_name {
        "artifact_read" => tool_artifact_read(session_id, turn_id, tool_call_id, input),
        "file_read" => tool_file_read(session_id, turn_id, tool_call_id, input),
        "file_list" => tool_file_list(session_id, input),
        "file_glob" => tool_file_glob(session_id, input),
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
        "project_search" => tool_project_search(session_id, input),
        "code_search_text" => tool_code_search_text(session_id, input),
        "code_search_symbol" => tool_code_search_symbol(session_id, input),
        "code_graph_expand" => tool_code_graph_expand(session_id, input),
        "lsp_query" => tool_lsp_query(session_id, input),
        "network_status" => tool_network_status(),
        "web_search" => tool_web_search(input),
        "web_research" => tool_web_research(session_id, turn_id, input),
        "web_fetch" => tool_web_fetch_with_browser_for_session(
            session_id,
            turn_id,
            tool_call_id,
            input,
            dispatcher,
        ),
        "render_surface" => tool_render_surface(turn_id, tool_call_id, input),
        "todo_read" => tool_todo_read(session_id),
        "todo_write" => tool_todo_write(session_id, turn_id, input),
        _ => Err(NativeToolFailure::new(
            "tool_not_found",
            format!("Unknown Lyra native tool: {tool_name}"),
            "Call one of the tools listed in the current Lyra runtime context.",
        )),
    }
}
