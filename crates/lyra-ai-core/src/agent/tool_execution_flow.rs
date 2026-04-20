use napi::Result;
use serde_json::{json, Value};

use crate::agent::error_recovery::{classify_tool_error, ErrorWithholdingBuffer};
use crate::agent::file_state_cache::FileStateCache;
use crate::agent::interaction_manager::create_pending_interaction;
use crate::agent::project_scope::apply_project_scope_to_tool_input;
use crate::agent::runtime_events::{
    emit_event, emit_interaction_pending_event, emit_interaction_queue_updated,
    emit_tool_failure_diagnosed_event,
};
use crate::agent::terminal_policy::TerminalInteractionPolicy;
use crate::agent::tool_budget::ToolResultBudgetState;
use crate::agent::tool_diagnostics::build_tool_error_payload;
use crate::agent::tool_execution_utils::{maybe_build_uncertain_input_error, run_concurrent_tools};
use crate::agent::tools::{
    execute_tool_with_progress, tool_executes_serially, ToolExecutionContext,
};
use crate::agent::types::{
    AgentPendingInteractionKind, AgentToolCall, AGENT_PLAN_APPROVAL_REQUIRED,
    AGENT_PLAN_QUESTION_REQUIRED, AGENT_TOOL_APPROVAL_REQUIRED, AGENT_TOOL_EXEC_FAILED,
    AGENT_WAITING_INTERACTION,
};
use crate::error::to_error;
use crate::provider::types::{
    AgentInferenceMessage, AgentInferenceMessageRole, AgentToolInvocation,
};
use crate::storage::registry_db;

const AGENT_ERROR_PREFIX: &str = "AGENT_ERROR::";

fn agent_error(code: &str, message: impl Into<String>) -> napi::Error {
    to_error(format!("{AGENT_ERROR_PREFIX}{code}::{}", message.into()))
}

pub fn execute_tool_calls(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    tool_calls: &[AgentToolInvocation],
    project_root: Option<&str>,
    terminal_policy: &TerminalInteractionPolicy,
    plan_mode: bool,
    provider_messages: &mut Vec<AgentInferenceMessage>,
    budget: &mut ToolResultBudgetState,
    file_cache: &mut FileStateCache,
    error_withholding: &mut ErrorWithholdingBuffer,
) -> Result<Vec<AgentToolCall>> {
    // Partition tools into read-only (concurrent) and write (serial) batches.
    // Mirrors Claude Code's StreamingToolExecutor: read-only tools execute
    // concurrently in batches, write tools execute serially for safety.
    let mut results = Vec::new();
    let mut i = 0;

    while i < tool_calls.len() {
        if tool_executes_serially(&tool_calls[i].name) {
            // Serial execution for write tools
            let finished = execute_single_tool(
                storage_root,
                session_id,
                turn_id,
                &tool_calls[i],
                project_root,
                terminal_policy,
                plan_mode,
                provider_messages,
                budget,
                file_cache,
                error_withholding,
            )?;
            results.push(finished);
            i += 1;
        } else {
            // Collect consecutive read-only tools into a batch
            let batch_start = i;
            while i < tool_calls.len() && !tool_executes_serially(&tool_calls[i].name) {
                i += 1;
            }
            let batch = &tool_calls[batch_start..i];

            // Execute read-only batch concurrently
            let batch_results =
                execute_readonly_batch(storage_root, session_id, turn_id, batch, project_root)?;

            // Push results in order with budget enforcement
            for (idx, (finished_call, tool_content)) in batch_results.into_iter().enumerate() {
                let inv = &batch[idx];
                let budgeted_content = budget.enforce(&inv.id, &inv.name, &tool_content);
                provider_messages.push(AgentInferenceMessage {
                    role: AgentInferenceMessageRole::Tool,
                    content: budgeted_content,
                    tool_call_id: Some(inv.id.clone()),
                    tool_calls: Vec::new(),
                });
                results.push(finished_call);
            }
        }
    }

    Ok(results)
}

fn complete_tool_call_and_push_result(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    invocation: &AgentToolInvocation,
    started_call_id: &str,
    tool_result: &Value,
    provider_messages: &mut Vec<AgentInferenceMessage>,
    budget: &mut ToolResultBudgetState,
) -> Result<AgentToolCall> {
    let finished_call =
        registry_db::complete_agent_tool_call(storage_root, started_call_id, tool_result)?;
    emit_event(
        storage_root,
        session_id,
        turn_id,
        "tool_finished",
        json!({
            "toolCallId": finished_call.id,
            "toolName": finished_call.tool_name,
            "status": "completed",
            "output": finished_call.output,
        }),
    )?;
    let tool_content = serde_json::to_string(tool_result).unwrap_or_else(|_| "{}".to_string());
    let budgeted_content = budget.enforce(&invocation.id, &invocation.name, &tool_content);
    provider_messages.push(AgentInferenceMessage {
        role: AgentInferenceMessageRole::Tool,
        content: budgeted_content,
        tool_call_id: Some(invocation.id.clone()),
        tool_calls: Vec::new(),
    });
    Ok(finished_call)
}

/// Execute a single tool call with full lifecycle management.
fn execute_single_tool(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    invocation: &AgentToolInvocation,
    project_root: Option<&str>,
    terminal_policy: &TerminalInteractionPolicy,
    plan_mode: bool,
    provider_messages: &mut Vec<AgentInferenceMessage>,
    budget: &mut ToolResultBudgetState,
    file_cache: &mut FileStateCache,
    error_withholding: &mut ErrorWithholdingBuffer,
) -> Result<AgentToolCall> {
    let effective_input =
        apply_project_scope_to_tool_input(&invocation.name, &invocation.input, project_root);
    let started_call = registry_db::create_agent_tool_call(
        storage_root,
        session_id,
        turn_id,
        &invocation.name,
        &effective_input,
    )?;
    emit_event(
        storage_root,
        session_id,
        turn_id,
        "tool_started",
        json!({
            "toolCallId": started_call.id,
            "toolName": invocation.name,
            "input": effective_input.clone(),
        }),
    )?;

    let mut progress_emit_error: Option<napi::Error> = None;
    let execution_result = if let Some(error) =
        maybe_build_uncertain_input_error(&invocation.name, &effective_input)
    {
        Err(error)
    } else {
        execute_tool_with_progress(
            &invocation.name,
            &effective_input,
            ToolExecutionContext {
                storage_root: Some(storage_root),
                project_root,
                agent_session_id: Some(session_id),
                agent_turn_id: Some(turn_id),
                tool_call_id: Some(&started_call.id),
                terminal_policy: Some(terminal_policy),
                plan_mode,
            },
            |progress_payload| {
                if progress_emit_error.is_some() {
                    return;
                }
                if let Err(error) = emit_event(
                    storage_root,
                    session_id,
                    turn_id,
                    "tool_progress",
                    json!({
                        "toolCallId": started_call.id,
                        "toolName": invocation.name,
                        "status": "running",
                        "input": effective_input.clone(),
                        "progress": progress_payload,
                    }),
                ) {
                    progress_emit_error = Some(error);
                }
            },
        )
    };
    let tool_result = match execution_result {
        Ok(value) => value,
        Err(error) => {
            // Check if this is an approval-required error
            if error.code == AGENT_TOOL_APPROVAL_REQUIRED {
                let approval_metadata = error.metadata.clone().unwrap_or_else(|| json!({}));
                let tool_call_id = started_call.id.clone();
                let interaction = create_pending_interaction(
                    storage_root,
                    session_id,
                    turn_id,
                    &tool_call_id,
                    AgentPendingInteractionKind::CommandApproval,
                    json!({
                        "requestId": tool_call_id,
                        "toolCallId": started_call.id,
                        "toolName": invocation.name,
                        "input": effective_input.clone(),
                        "metadata": approval_metadata.clone(),
                        "message": error.message,
                    }),
                )?;
                emit_interaction_pending_event(storage_root, &interaction)?;
                emit_interaction_queue_updated(storage_root, session_id, turn_id)?;

                // Emit approval request event to frontend
                emit_event(
                    storage_root,
                    session_id,
                    turn_id,
                    "command_approval_request",
                    json!({
                        "toolCallId": tool_call_id,
                        "toolName": invocation.name,
                        "input": effective_input.clone(),
                        "metadata": approval_metadata.clone(),
                        "message": error.message,
                    }),
                )?;
                let waiting_call = registry_db::fail_agent_tool_call(
                    storage_root,
                    &started_call.id,
                    AGENT_TOOL_APPROVAL_REQUIRED,
                    &error.message,
                )?;
                emit_event(
                    storage_root,
                    session_id,
                    turn_id,
                    "tool_finished",
                    json!({
                        "toolCallId": waiting_call.id,
                        "toolName": waiting_call.tool_name,
                        "status": "waiting_interaction",
                        "error": {
                            "code": AGENT_TOOL_APPROVAL_REQUIRED,
                            "message": error.message,
                            "metadata": approval_metadata,
                        },
                    }),
                )?;
                return Err(agent_error(
                    AGENT_WAITING_INTERACTION,
                    format!("waiting for command approval: {}", invocation.name),
                ));
            } else if error.code == AGENT_PLAN_QUESTION_REQUIRED {
                let question_metadata = error.metadata.clone().unwrap_or_else(|| json!({}));
                let request_id = started_call.id.clone();
                let interaction = create_pending_interaction(
                    storage_root,
                    session_id,
                    turn_id,
                    &request_id,
                    AgentPendingInteractionKind::UserQuestion,
                    json!({
                        "requestId": request_id,
                        "toolCallId": started_call.id,
                        "toolName": invocation.name,
                        "questions": question_metadata.get("questions").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
                        "allowNote": question_metadata.get("allowNote").and_then(Value::as_bool).unwrap_or(false),
                    }),
                )?;
                emit_interaction_pending_event(storage_root, &interaction)?;
                emit_interaction_queue_updated(storage_root, session_id, turn_id)?;
                emit_event(
                    storage_root,
                    session_id,
                    turn_id,
                    "plan_question_requested",
                    json!({
                        "requestId": request_id,
                        "toolCallId": started_call.id,
                        "toolName": invocation.name,
                        "questions": question_metadata.get("questions").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
                        "allowNote": question_metadata.get("allowNote").and_then(Value::as_bool).unwrap_or(false),
                    }),
                )?;
                let waiting_call = registry_db::fail_agent_tool_call(
                    storage_root,
                    &started_call.id,
                    AGENT_PLAN_QUESTION_REQUIRED,
                    &error.message,
                )?;
                emit_event(
                    storage_root,
                    session_id,
                    turn_id,
                    "tool_finished",
                    json!({
                        "toolCallId": waiting_call.id,
                        "toolName": waiting_call.tool_name,
                        "status": "waiting_interaction",
                        "error": {
                            "code": AGENT_PLAN_QUESTION_REQUIRED,
                            "message": error.message,
                            "metadata": question_metadata,
                        },
                    }),
                )?;
                return Err(agent_error(
                    AGENT_WAITING_INTERACTION,
                    format!("waiting for plan question answer: {}", invocation.name),
                ));
            } else if error.code == AGENT_PLAN_APPROVAL_REQUIRED {
                let approval_metadata = error.metadata.clone().unwrap_or_else(|| json!({}));
                let request_id = started_call.id.clone();
                let interaction = create_pending_interaction(
                    storage_root,
                    session_id,
                    turn_id,
                    &request_id,
                    AgentPendingInteractionKind::PlanApproval,
                    json!({
                        "requestId": request_id,
                        "toolCallId": started_call.id,
                        "toolName": invocation.name,
                        "version": approval_metadata.get("version").cloned().unwrap_or(Value::Null),
                        "status": approval_metadata.get("status").cloned().unwrap_or(Value::String("submitted".to_string())),
                        "summary": approval_metadata.get("summary").cloned().unwrap_or(Value::String("Proposed plan".to_string())),
                        "proposedMarkdown": approval_metadata.get("proposedMarkdown").cloned().unwrap_or(Value::String(String::new())),
                        "draftMarkdown": approval_metadata.get("draftMarkdown").cloned().unwrap_or(Value::String(String::new())),
                    }),
                )?;
                emit_interaction_pending_event(storage_root, &interaction)?;
                emit_interaction_queue_updated(storage_root, session_id, turn_id)?;
                emit_event(
                    storage_root,
                    session_id,
                    turn_id,
                    "plan_approval_requested",
                    json!({
                        "requestId": request_id,
                        "toolCallId": started_call.id,
                        "toolName": invocation.name,
                        "version": approval_metadata.get("version").cloned().unwrap_or(Value::Null),
                        "status": approval_metadata.get("status").cloned().unwrap_or(Value::String("submitted".to_string())),
                        "summary": approval_metadata.get("summary").cloned().unwrap_or(Value::String("Proposed plan".to_string())),
                        "proposedMarkdown": approval_metadata.get("proposedMarkdown").cloned().unwrap_or(Value::String(String::new())),
                        "draftMarkdown": approval_metadata.get("draftMarkdown").cloned().unwrap_or(Value::String(String::new())),
                    }),
                )?;
                let waiting_call = registry_db::fail_agent_tool_call(
                    storage_root,
                    &started_call.id,
                    AGENT_PLAN_APPROVAL_REQUIRED,
                    &error.message,
                )?;
                emit_event(
                    storage_root,
                    session_id,
                    turn_id,
                    "tool_finished",
                    json!({
                        "toolCallId": waiting_call.id,
                        "toolName": waiting_call.tool_name,
                        "status": "waiting_interaction",
                        "error": {
                            "code": AGENT_PLAN_APPROVAL_REQUIRED,
                            "message": error.message,
                            "metadata": approval_metadata,
                        },
                    }),
                )?;
                return Err(agent_error(
                    AGENT_WAITING_INTERACTION,
                    format!("waiting for plan approval: {}", invocation.name),
                ));
            } else {
                // Original non-approval error handling
                let failed_call = registry_db::fail_agent_tool_call(
                    storage_root,
                    &started_call.id,
                    &error.code,
                    &error.message,
                )?;
                let error_metadata = error.metadata.clone();

                // Classify the tool error for recovery strategy
                let severity = classify_tool_error(
                    &invocation.name,
                    failed_call.error_code.as_deref(),
                    failed_call
                        .error_message
                        .as_deref()
                        .unwrap_or(&error.message),
                );

                // Emit runtime event with withholding — suppress transient errors
                let withheld = error_withholding.process(severity.clone(), 0);
                if let Some(user_msg) = withheld {
                    let error_payload = build_tool_error_payload(
                        &invocation.name,
                        &error.code,
                        &error.message,
                        error_metadata.clone(),
                    );
                    emit_event(
                        storage_root,
                        session_id,
                        turn_id,
                        "tool_finished",
                        json!({
                            "toolCallId": failed_call.id,
                            "toolName": failed_call.tool_name,
                            "status": "failed",
                            "user_message": user_msg,
                            "error": error_payload,
                        }),
                    )?;
                } else {
                    // Error withheld — emit minimal event for diagnostics only
                    emit_event(
                        storage_root,
                        session_id,
                        turn_id,
                        "tool_finished",
                        json!({
                            "toolCallId": failed_call.id,
                            "toolName": failed_call.tool_name,
                            "status": "failed",
                            "suppressed": true,
                        }),
                    )?;
                }

                let code = failed_call
                    .error_code
                    .as_deref()
                    .unwrap_or(AGENT_TOOL_EXEC_FAILED)
                    .to_string();
                let message = failed_call
                    .error_message
                    .clone()
                    .unwrap_or_else(|| "tool execution failed".to_string());
                let error_payload = build_tool_error_payload(
                    &invocation.name,
                    &code,
                    &message,
                    error_metadata.clone(),
                );

                // Build agent-facing error message — include recovery hints for recoverable errors
                let agent_error_result = if severity.is_recoverable() {
                    json!({
                        "ok": false,
                        "recoverable": true,
                        "error": error_payload.clone(),
                        "hint": format!("This error is recoverable. Consider reading the latest state and retrying with adjusted parameters."),
                    })
                } else {
                    json!({
                        "ok": false,
                        "recoverable": false,
                        "error": error_payload.clone(),
                    })
                };
                emit_tool_failure_diagnosed_event(
                    storage_root,
                    session_id,
                    turn_id,
                    &failed_call.id,
                    &failed_call.tool_name,
                    &error_payload,
                )?;

                provider_messages.push(AgentInferenceMessage {
                    role: AgentInferenceMessageRole::Tool,
                    content: serde_json::to_string(&agent_error_result)
                        .unwrap_or_else(|_| "{}".to_string()),
                    tool_call_id: Some(invocation.id.clone()),
                    tool_calls: Vec::new(),
                });
                return Ok(failed_call);
            }
        }
    };
    if let Some(error) = progress_emit_error {
        return Err(error);
    }

    let finished_call =
        registry_db::complete_agent_tool_call(storage_root, &started_call.id, &tool_result)?;
    emit_event(
        storage_root,
        session_id,
        turn_id,
        "tool_finished",
        json!({
            "toolCallId": finished_call.id,
            "toolName": finished_call.tool_name,
            "status": "completed",
            "output": finished_call.output,
        }),
    )?;
    if invocation.name == "plan.update_draft" {
        emit_event(
            storage_root,
            session_id,
            turn_id,
            "plan_draft_updated",
            json!({
                "toolCallId": finished_call.id,
                "output": finished_call.output,
            }),
        )?;
    }

    // Record read in file state cache for read tools
    let tool_content = serde_json::to_string(&tool_result).unwrap_or_else(|_| "{}".to_string());
    if invocation.name == "filesystem.read_range" {
        if let Some(path) = effective_input.get("path").and_then(Value::as_str) {
            file_cache.record_read(path, &tool_content);
        }
    }

    // Apply tool result budget enforcement
    let budgeted_content = budget.enforce(&invocation.id, &invocation.name, &tool_content);

    provider_messages.push(AgentInferenceMessage {
        role: AgentInferenceMessageRole::Tool,
        content: budgeted_content,
        tool_call_id: Some(invocation.id.clone()),
        tool_calls: Vec::new(),
    });

    Ok(finished_call)
}

/// Execute a batch of read-only tools concurrently using thread scopes.
/// Returns (AgentToolCall, serialized_tool_result) pairs in original order.
fn execute_readonly_batch(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    invocations: &[AgentToolInvocation],
    project_root: Option<&str>,
) -> napi::Result<Vec<(AgentToolCall, String)>> {
    if invocations.len() == 1 {
        let inv = &invocations[0];
        let effective_input =
            apply_project_scope_to_tool_input(&inv.name, &inv.input, project_root);
        let started_call = registry_db::create_agent_tool_call(
            storage_root,
            session_id,
            turn_id,
            &inv.name,
            &effective_input,
        )?;
        let _ = emit_event(
            storage_root,
            session_id,
            turn_id,
            "tool_started",
            json!({"toolCallId": started_call.id, "toolName": inv.name, "input": effective_input.clone()}),
        );

        let tool_result = execute_tool_with_progress(
            &inv.name,
            &effective_input,
            ToolExecutionContext::readonly(project_root),
            |_| {},
        )
        .map_err(|e| agent_error(&e.code, &e.message))?;
        let finished_call =
            registry_db::complete_agent_tool_call(storage_root, &started_call.id, &tool_result)?;
        let tool_content = serde_json::to_string(&tool_result).unwrap_or_else(|_| "{}".to_string());
        let _ = emit_event(
            storage_root,
            session_id,
            turn_id,
            "tool_finished",
            json!({"toolCallId": finished_call.id, "toolName": finished_call.tool_name, "status": "completed", "output": finished_call.output}),
        );

        return Ok(vec![(finished_call, tool_content)]);
    }

    // Prepare inputs for concurrent execution
    let mut started_calls = Vec::new();
    let mut tool_inputs = Vec::new();
    for inv in invocations {
        let effective_input =
            apply_project_scope_to_tool_input(&inv.name, &inv.input, project_root);
        let started_call = registry_db::create_agent_tool_call(
            storage_root,
            session_id,
            turn_id,
            &inv.name,
            &effective_input,
        )?;
        let _ = emit_event(
            storage_root,
            session_id,
            turn_id,
            "tool_started",
            json!({"toolCallId": started_call.id, "toolName": inv.name, "input": effective_input.clone()}),
        );
        started_calls.push(started_call);
        tool_inputs.push((
            inv.name.clone(),
            effective_input,
            project_root.map(String::from),
        ));
    }

    // Execute concurrently in a separate function that avoids napi types
    let exec_results = run_concurrent_tools(tool_inputs);

    // Collect results
    let mut results = Vec::new();
    for (idx, raw) in exec_results.into_iter().enumerate() {
        let started_id = &started_calls[idx].id;
        if let Some(tool_result) = raw.tool_result {
            let finished_call =
                registry_db::complete_agent_tool_call(storage_root, started_id, &tool_result)?;
            let tool_content =
                serde_json::to_string(&tool_result).unwrap_or_else(|_| "{}".to_string());
            let _ = emit_event(
                storage_root,
                session_id,
                turn_id,
                "tool_finished",
                json!({"toolCallId": finished_call.id, "toolName": finished_call.tool_name, "status": "completed", "output": finished_call.output}),
            );
            results.push((finished_call, tool_content));
        } else {
            let error_code = raw
                .error_code
                .unwrap_or_else(|| "AGENT_TOOL_EXEC_FAILED".to_string());
            let error_msg = raw
                .error_message
                .unwrap_or_else(|| "tool execution failed".to_string());
            let error_metadata = raw.error_metadata;
            let error_payload = build_tool_error_payload(
                &invocations[idx].name,
                &error_code,
                &error_msg,
                error_metadata.clone(),
            );
            let failed_call = registry_db::fail_agent_tool_call(
                storage_root,
                started_id,
                &error_code,
                &error_msg,
            )?;
            let _ = emit_event(
                storage_root,
                session_id,
                turn_id,
                "tool_finished",
                json!({"toolCallId": failed_call.id, "toolName": failed_call.tool_name, "status": "failed",
                    "error": error_payload.clone()}),
            );
            let _ = emit_tool_failure_diagnosed_event(
                storage_root,
                session_id,
                turn_id,
                &failed_call.id,
                &failed_call.tool_name,
                &error_payload,
            );
            let error_result = json!({
                "ok": false,
                "error": error_payload
            });
            let error_content =
                serde_json::to_string(&error_result).unwrap_or_else(|_| "{}".to_string());
            results.push((failed_call, error_content));
        }
    }

    Ok(results)
}
