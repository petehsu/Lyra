use super::*;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use lyra_tool_fs_core::PROVIDER_VISIBLE_TOOL_NAMES;

const REPEATED_TOOL_ROUND_SOFT_OCCURRENCES: usize = 3;
const REPEATED_TOOL_ROUND_HARD_OCCURRENCES: usize = 5;
const MAX_PROVIDER_IMAGE_TOOL_BYTES: u64 = 8 * 1024 * 1024;
const PROGRESS_GUARD_WARNING_PROMPT: &str = "Lyra's dynamic progress guard detected repeated identical tool calls with identical provider-visible results. Do not repeat the exact same tool call again unless the page, file, or external state has actually changed. Change strategy, inspect different evidence, use a more specific wait/read_until condition, or produce the final answer/blocker summary from the evidence already gathered.";
const PROGRESS_GUARD_FINAL_SYNTHESIS_PROMPT: &str = "Lyra's dynamic progress guard detected repeated identical tool calls with no new provider-visible evidence. Do not call more tools in this response. Produce the best possible final answer from the gathered evidence. If the task is incomplete, state what was attempted, the exact blocker, and one concrete next action. Do not ask the user to restate the same request. If completion truly depends on a missing user decision, ask one precise clarification question.";
const STRUCTURED_FINISH_RETRY_PROMPT: &str = "The previous assistant response was plain text, so Lyra did not commit it as the final answer for this tool-capable turn. Continue the same user request now. If a Lyra capability is needed, call the appropriate tool. If the task is complete, blocked, or waiting on user input, call lyra_turn_finish alone with the correct status and finalText. Do not repeat the same plain text response.";
const STRUCTURED_FINISH_REPAIR_LIMIT: u8 = 3;

pub(crate) struct ModelRequest {
    pub(crate) provider: NativeProviderProfile,
    pub(crate) model: String,
    pub(crate) messages: Vec<Value>,
    pub(crate) tools: Vec<Value>,
    pub(crate) host_dispatcher: Option<Arc<HostCapabilityDispatcher>>,
    pub(crate) capabilities: ModelCapabilityProfile,
    pub(crate) input_downgrades: Vec<Value>,
    pub(crate) evidence_refs: Vec<Value>,
    pub(crate) token_estimate: usize,
    pub(crate) context_trimmed: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct ModelReply {
    pub(crate) content: Option<String>,
    pub(crate) tool_calls: Vec<ModelToolCall>,
    pub(crate) ui_message_id: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct ModelToolCall {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) arguments: Value,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct ProviderStreamState {
    pub(crate) content: String,
    pub(crate) reasoning_chars: usize,
    pub(crate) tool_calls: HashMap<usize, StreamingToolCallAccumulator>,
    pub(crate) saw_choice: bool,
    pub(crate) finish_reason: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct ModelLoopResult {
    pub(crate) final_text: Option<String>,
    pub(crate) metadata: Option<Value>,
}

impl ModelLoopResult {
    pub(crate) fn final_text(text: String) -> Self {
        Self {
            final_text: Some(text),
            metadata: None,
        }
    }

    fn final_text_with_metadata(text: String, metadata: Value) -> Self {
        Self {
            final_text: Some(text),
            metadata: Some(metadata),
        }
    }
}

#[derive(Debug, Default)]
struct ModelLoopProgressGuard {
    last_fingerprint: Option<String>,
    repeated_occurrences: usize,
}

#[derive(Debug)]
enum ModelLoopProgressAction {
    Continue,
    Warn {
        reason: &'static str,
        observed_occurrences: usize,
    },
    Synthesize {
        reason: &'static str,
        observed_occurrences: usize,
    },
}

impl ModelLoopProgressGuard {
    fn observe_tool_round(
        &mut self,
        calls: &[ModelToolCall],
        provider_results: &[String],
    ) -> ModelLoopProgressAction {
        if calls.is_empty() {
            self.last_fingerprint = None;
            self.repeated_occurrences = 0;
            return ModelLoopProgressAction::Continue;
        }

        let fingerprint = tool_round_progress_fingerprint(calls, provider_results);
        if self.last_fingerprint.as_deref() == Some(fingerprint.as_str()) {
            self.repeated_occurrences = self.repeated_occurrences.saturating_add(1);
        } else {
            self.last_fingerprint = Some(fingerprint);
            self.repeated_occurrences = 1;
        }

        let reason = "repeated_identical_tool_round_without_new_evidence";
        if self.repeated_occurrences >= REPEATED_TOOL_ROUND_HARD_OCCURRENCES {
            return ModelLoopProgressAction::Synthesize {
                reason,
                observed_occurrences: self.repeated_occurrences,
            };
        }
        if self.repeated_occurrences == REPEATED_TOOL_ROUND_SOFT_OCCURRENCES {
            return ModelLoopProgressAction::Warn {
                reason,
                observed_occurrences: self.repeated_occurrences,
            };
        }
        ModelLoopProgressAction::Continue
    }
}

fn tool_round_progress_fingerprint(calls: &[ModelToolCall], provider_results: &[String]) -> String {
    let calls = calls
        .iter()
        .map(|call| {
            format!(
                "{}:{}",
                call.name,
                serde_json::to_string(&call.arguments).unwrap_or_else(|_| "{}".to_string())
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let results = provider_results
        .iter()
        .map(|content| format!("{}:{content}", content.chars().count()))
        .collect::<Vec<_>>()
        .join("\n");
    format!("calls:\n{calls}\nresults:\n{results}")
}

#[derive(Clone, Debug)]
pub(crate) struct ModelCapabilityProfile {
    pub(crate) supports_image_input: bool,
    pub(crate) supports_tool_calling: bool,
    pub(crate) supports_streaming: bool,
    pub(crate) context_window: Option<usize>,
}

pub(crate) fn run_model_loop(
    session_id: &str,
    turn_id: &str,
    request: ModelRequest,
    cancellation: &Arc<AtomicBool>,
) -> AgentRuntimeResult<ModelLoopResult> {
    let mut messages = request.messages.clone();
    if request.context_trimmed
        || !request.evidence_refs.is_empty()
        || !request.input_downgrades.is_empty()
    {
        emit_context_trimmed(
            session_id,
            json!({
                "reason": "provider_context_prepared",
                "estimatedTokens": request.token_estimate,
                "trimmed": request.context_trimmed,
                "inputDowngrades": request.input_downgrades,
                "evidenceRefs": request.evidence_refs,
            }),
        );
    }
    let mut retried_after_context_error = false;
    let mut retried_after_empty_reply = false;
    let mut structured_finish_repairs = 0_u8;
    let mut transient_provider_retries = 0_u8;
    let mut progress_guard = ModelLoopProgressGuard::default();
    let requires_structured_finish = request_requires_structured_finish(&request);
    loop {
        if cancellation.load(Ordering::SeqCst) || turn_was_cancelled(session_id, turn_id) {
            return Err(AgentRuntimeError::Core("turn cancelled".to_string()));
        }
        emit_turn_state(
            session_id,
            turn_id,
            if request.capabilities.supports_streaming {
                "streaming_model"
            } else {
                "calling_model"
            },
            "provider_request_started",
        );
        let reply = match call_model_once_for_loop(
            session_id,
            turn_id,
            &request.provider,
            &request.model,
            &messages,
            &request.tools,
            &request.capabilities,
            cancellation,
        ) {
            Ok(reply) => reply,
            Err(error)
                if !retried_after_context_error && is_context_length_error(&error.to_string()) =>
            {
                retried_after_context_error = true;
                messages = compact_messages_for_retry(messages);
                emit_context_trimmed(
                    session_id,
                    json!({
                        "reason": "provider_context_length_error_retry",
                        "retry": true,
                    }),
                );
                call_model_once_for_loop(
                    session_id,
                    turn_id,
                    &request.provider,
                    &request.model,
                    &messages,
                    &request.tools,
                    &request.capabilities,
                    cancellation,
                )?
            }
            Err(error) if !retried_after_empty_reply && is_empty_model_reply_error(&error) => {
                retried_after_empty_reply = true;
                messages.push(json!({
                    "role": "system",
                    "content": "The previous provider response was empty and could not be committed to Lyra's factual timeline. Continue the same user request now. If a capability is needed, emit a structured tool_call. Otherwise answer with normal assistant text. Do not return an empty assistant message."
                }));
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_empty_reply_retry",
                    1,
                    &error.to_string(),
                );
                continue;
            }
            Err(error) if transient_provider_retries < 2 && is_retryable_provider_error(&error) => {
                transient_provider_retries += 1;
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_transient_error_retry",
                    transient_provider_retries,
                    &error.to_string(),
                );
                sleep_before_provider_retry(transient_provider_retries, cancellation)?;
                continue;
            }
            Err(error) => return Err(error),
        };
        if reply.tool_calls.is_empty() {
            let final_text = reply.content.unwrap_or_default();
            if requires_structured_finish {
                if structured_finish_repairs >= STRUCTURED_FINISH_REPAIR_LIMIT {
                    emit_structured_finish_event(session_id, turn_id, "structuredFinishRejected");
                    return Err(AgentRuntimeError::Core(
                        "provider did not produce a structured Lyra turn finish after repeated protocol repair prompts".to_string(),
                    ));
                }
                structured_finish_repairs += 1;
                messages.push(json!({
                    "role": "assistant",
                    "content": final_text,
                }));
                messages.push(json!({
                    "role": "system",
                    "content": STRUCTURED_FINISH_RETRY_PROMPT,
                }));
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "structured_finish_protocol_retry",
                    structured_finish_repairs,
                    "plain assistant text cannot finish a tool-capable Lyra turn",
                );
                emit_structured_finish_event(session_id, turn_id, "structuredFinishProtocolRetry");
                continue;
            }
            return Ok(ModelLoopResult::final_text(final_text));
        }

        let tool_calls = reply.tool_calls;
        if let Some(result) = try_finish_from_turn_finish_tool(&tool_calls)? {
            return Ok(result);
        }
        let assistant_content = reply.content.unwrap_or_default();
        if !assistant_content.trim().is_empty() {
            emit_assistant_text(session_id, turn_id, &assistant_content);
        }
        let assistant_tool_calls = tool_calls
            .iter()
            .map(|call| {
                json!({
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": call.name,
                        "arguments": serde_json::to_string(&call.arguments).unwrap_or_else(|_| "{}".to_string())
                    }
                })
            })
            .collect::<Vec<_>>();
        messages.push(json!({
            "role": "assistant",
            "content": assistant_content,
            "tool_calls": assistant_tool_calls,
        }));

        let mut provider_tool_results = Vec::new();
        for call in &tool_calls {
            if cancellation.load(Ordering::SeqCst) || turn_was_cancelled(session_id, turn_id) {
                return Err(AgentRuntimeError::Core("turn cancelled".to_string()));
            }
            emit_turn_state(session_id, turn_id, "waiting_for_tool", "tool_call_started");
            let output = execute_model_tool_with_runtime(
                session_id,
                turn_id,
                &request.host_dispatcher,
                cancellation,
                ToolExecutionRuntime::from_model_capabilities(&request.capabilities),
                call.clone(),
            );
            let (content, evidence_ref) = guarded_tool_result_content(&output, 24_000);
            provider_tool_results.push(content.clone());
            if let Some(evidence_ref) = evidence_ref {
                emit_context_trimmed(
                    session_id,
                    json!({
                        "reason": "tool_output_truncated_for_provider",
                        "evidenceRef": evidence_ref,
                    }),
                );
            }
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call.id,
                "content": content,
            }));
            if let Some(content) =
                provider_image_message_from_tool_output(&output, &request.capabilities)
            {
                messages.push(json!({
                    "role": "user",
                    "content": content,
                }));
            }
        }

        match progress_guard.observe_tool_round(&tool_calls, &provider_tool_results) {
            ModelLoopProgressAction::Continue => {}
            ModelLoopProgressAction::Warn {
                reason,
                observed_occurrences,
            } => {
                emit_tool_progress_guard_event(
                    session_id,
                    turn_id,
                    "toolProgressGuardWarning",
                    reason,
                    observed_occurrences,
                );
                messages.push(json!({
                    "role": "system",
                    "content": PROGRESS_GUARD_WARNING_PROMPT,
                }));
            }
            ModelLoopProgressAction::Synthesize {
                reason,
                observed_occurrences,
            } => {
                return synthesize_after_progress_guard(
                    session_id,
                    turn_id,
                    &request,
                    messages,
                    cancellation,
                    reason,
                    observed_occurrences,
                );
            }
        }
    }
}

fn request_requires_structured_finish(request: &ModelRequest) -> bool {
    request.capabilities.supports_tool_calling
        && request.tools.iter().any(|tool| {
            tool.pointer("/function/name").and_then(Value::as_str) == Some(LYRA_TURN_FINISH_TOOL)
        })
}

pub(crate) fn synthesize_after_progress_guard(
    session_id: &str,
    turn_id: &str,
    request: &ModelRequest,
    mut messages: Vec<Value>,
    cancellation: &Arc<AtomicBool>,
    reason: &str,
    observed_occurrences: usize,
) -> AgentRuntimeResult<ModelLoopResult> {
    emit_tool_progress_guard_event(
        session_id,
        turn_id,
        "toolProgressGuardTriggered",
        reason,
        observed_occurrences,
    );
    messages.push(json!({
        "role": "system",
        "content": PROGRESS_GUARD_FINAL_SYNTHESIS_PROMPT,
    }));
    emit_turn_state(
        session_id,
        turn_id,
        if request.capabilities.supports_streaming {
            "streaming_model"
        } else {
            "calling_model"
        },
        "tool_progress_guard_final_synthesis",
    );
    let no_tools = Vec::new();
    let reply = call_model_once_for_loop(
        session_id,
        turn_id,
        &request.provider,
        &request.model,
        &messages,
        &no_tools,
        &request.capabilities,
        cancellation,
    )?;
    if !reply.tool_calls.is_empty() {
        return Err(AgentRuntimeError::Core(
            "provider requested additional tools after Lyra disabled tools for progress-guard synthesis".to_string(),
        ));
    }
    Ok(ModelLoopResult::final_text(
        reply.content.unwrap_or_default(),
    ))
}

fn emit_structured_finish_event(session_id: &str, turn_id: &str, event_type: &str) {
    emit_provider_protocol_event(
        session_id,
        turn_id,
        json!({
            "type": event_type,
            "reason": "assistant_plain_text_without_structured_finish",
        }),
    );
}

fn try_finish_from_turn_finish_tool(
    tool_calls: &[ModelToolCall],
) -> AgentRuntimeResult<Option<ModelLoopResult>> {
    let finish_calls = tool_calls
        .iter()
        .filter(|call| call.name == LYRA_TURN_FINISH_TOOL)
        .collect::<Vec<_>>();
    if finish_calls.is_empty() {
        return Ok(None);
    }
    if finish_calls.len() != 1 || tool_calls.len() != 1 {
        return Err(AgentRuntimeError::Core(
            "lyra_turn_finish must be called alone after any required Lyra tools have finished"
                .to_string(),
        ));
    }
    let call = finish_calls[0];
    let status = call
        .arguments
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("answered");
    let final_text = call
        .arguments
        .get("finalText")
        .or_else(|| call.arguments.get("message"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let metadata = turn_finish_metadata(&call.arguments);
    if !final_text.is_empty() {
        return Ok(Some(ModelLoopResult::final_text_with_metadata(
            final_text.to_string(),
            metadata,
        )));
    }
    let fallback = match status {
        "blocked" => call
            .arguments
            .get("blocker")
            .and_then(Value::as_str)
            .unwrap_or("这个任务被阻塞了，但模型没有提供阻塞详情。"),
        "needs_user_input" => call
            .arguments
            .get("question")
            .and_then(Value::as_str)
            .unwrap_or("我需要更多信息才能继续。"),
        _ => "任务已结束，但模型没有提供可显示的最终文本。",
    };
    Ok(Some(ModelLoopResult::final_text_with_metadata(
        fallback.to_string(),
        metadata,
    )))
}

fn turn_finish_metadata(arguments: &Value) -> Value {
    let evidence_summary = arguments
        .get("evidenceSummary")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let provided_records = arguments
        .get("verificationRecords")
        .or_else(|| arguments.get("verification"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let verification_records = normalized_verification_records(provided_records);
    json!({
        "schemaVersion": 1,
        "kind": "lyra_turn_finish",
        "status": arguments
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("answered"),
        "evidenceSummary": evidence_summary,
        "verificationRecords": verification_records,
    })
}

fn normalized_verification_records(records: Vec<Value>) -> Vec<Value> {
    let mut normalized = records
        .into_iter()
        .filter_map(normalize_verification_record)
        .collect::<Vec<_>>();
    for kind in ["test", "lint", "typecheck"] {
        if !normalized
            .iter()
            .any(|record| record.get("kind").and_then(Value::as_str) == Some(kind))
        {
            normalized.push(json!({
                "schemaVersion": 1,
                "kind": kind,
                "status": "not_run",
                "notRunReason": "not_reported_by_model",
                "summary": format!("{kind} was not reported by lyra_turn_finish."),
            }));
        }
    }
    normalized
}

fn normalize_verification_record(record: Value) -> Option<Value> {
    let object = record.as_object()?;
    let kind = object
        .get("kind")
        .or_else(|| object.get("type"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_ascii_lowercase();
    let kind = match kind.as_str() {
        "tests" | "test" => "test",
        "lint" | "lints" => "lint",
        "typecheck" | "type_check" | "type-check" | "tsc" => "typecheck",
        other => other,
    };
    let status = object
        .get("status")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("not_run")
        .to_ascii_lowercase();
    let status = match status.as_str() {
        "passed" | "pass" | "success" | "ok" => "passed",
        "failed" | "fail" | "error" => "failed",
        "skipped" | "skip" => "skipped",
        "not-run" | "not_run" | "notrun" => "not_run",
        other => other,
    };
    let mut output = serde_json::Map::new();
    output.insert(
        "schemaVersion".to_string(),
        Value::Number(serde_json::Number::from(1)),
    );
    output.insert("kind".to_string(), Value::String(kind.to_string()));
    output.insert("status".to_string(), Value::String(status.to_string()));
    if let Some(command) = object
        .get("command")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        output.insert("command".to_string(), Value::String(command.to_string()));
    }
    if let Some(summary) = object
        .get("summary")
        .or_else(|| object.get("message"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        output.insert("summary".to_string(), Value::String(summary.to_string()));
    }
    if let Some(reason) = object
        .get("notRunReason")
        .or_else(|| object.get("not_run_reason"))
        .or_else(|| object.get("reason"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        output.insert(
            "notRunReason".to_string(),
            Value::String(reason.to_string()),
        );
    } else if status == "not_run" {
        output.insert(
            "notRunReason".to_string(),
            Value::String("not_reported_by_model".to_string()),
        );
    }
    if let Some(artifact_ref) = object.get("artifactRef").filter(|value| value.is_object()) {
        output.insert("artifactRef".to_string(), artifact_ref.clone());
    }
    Some(Value::Object(output))
}

fn provider_image_message_from_tool_output(
    output: &Value,
    capabilities: &ModelCapabilityProfile,
) -> Option<Value> {
    if !capabilities.supports_image_input {
        return None;
    }
    let image = output.pointer("/raw/providerImage")?;
    let path = image.get("path").and_then(Value::as_str)?;
    let artifact = resolve_lyra_artifact_path(path).ok().flatten()?;
    let metadata = fs::metadata(&artifact.absolute).ok()?;
    if metadata.len() == 0 || metadata.len() > MAX_PROVIDER_IMAGE_TOOL_BYTES {
        return None;
    }
    let bytes = fs::read(&artifact.absolute).ok()?;
    let data_url = format!(
        "data:{};base64,{}",
        artifact.media_type,
        BASE64_STANDARD.encode(bytes)
    );
    Some(json!([
        {
            "type": "text",
            "text": format!(
                "Lyra attached artifact image {} ({}, {} bytes) as model vision evidence for the previous tool result.",
                artifact.artifact_id,
                artifact.media_type,
                metadata.len()
            )
        },
        {
            "type": "image_url",
            "image_url": { "url": data_url }
        }
    ]))
}

fn emit_tool_progress_guard_event(
    session_id: &str,
    turn_id: &str,
    event_type: &str,
    reason: &str,
    observed_occurrences: usize,
) {
    emit_provider_protocol_event(
        session_id,
        turn_id,
        json!({
            "type": event_type,
            "reason": reason,
            "observedOccurrences": observed_occurrences,
        }),
    );
}

pub(crate) fn emit_provider_retry(
    session_id: &str,
    turn_id: &str,
    reason: &str,
    attempt: u8,
    message: &str,
) {
    emit_turn_state(session_id, turn_id, "retrying_provider", reason);
    emit_provider_protocol_event(
        session_id,
        turn_id,
        json!({
            "type": "retry",
            "reason": reason,
            "attempt": attempt,
            "message": message,
        }),
    );
    emit_context_trimmed(
        session_id,
        json!({
            "reason": reason,
            "attempt": attempt,
            "message": message,
            "retry": true,
        }),
    );
}

pub(crate) fn sleep_before_provider_retry(
    attempt: u8,
    cancellation: &Arc<AtomicBool>,
) -> AgentRuntimeResult<()> {
    let wait_ms = 250_u64.saturating_mul(2_u64.saturating_pow(attempt.saturating_sub(1).into()));
    let deadline = Instant::now() + Duration::from_millis(wait_ms);
    while Instant::now() < deadline {
        if cancellation.load(Ordering::SeqCst) {
            return Err(AgentRuntimeError::Core("turn cancelled".to_string()));
        }
        thread::sleep(Duration::from_millis(25));
    }
    Ok(())
}

pub(crate) fn is_retryable_provider_error(error: &AgentRuntimeError) -> bool {
    let message = error.to_string().to_lowercase();
    message.contains("status 429")
        || message.contains("status 500")
        || message.contains("status 502")
        || message.contains("status 503")
        || message.contains("status 504")
        || message.contains("rate limit")
        || message.contains("too many requests")
        || message.contains("overloaded")
        || message.contains("temporarily unavailable")
        || message.contains("connection reset")
        || message.contains("timed out")
        || is_provider_transport_error(error)
}

pub(crate) fn is_provider_transport_error(error: &AgentRuntimeError) -> bool {
    let message = error.to_string().to_lowercase();
    message.contains("request or response body error")
        || message.contains("error sending request")
        || message.contains("failed to read response body")
        || message.contains("response body error")
        || message.contains("body error")
        || message.contains("connection closed before message completed")
        || message.contains("unexpected eof")
        || message.contains("incomplete message")
        || message.contains("stream error")
        || message.contains("broken pipe")
        || message.contains("connection reset")
        || message.contains("connection refused")
        || message.contains("dns error")
        || message.contains("operation timed out")
}

pub(crate) fn is_provider_configuration_error(error: &AgentRuntimeError) -> bool {
    let message = error.to_string().to_lowercase();
    message.contains("api key is not configured")
        || message.contains("provider base url is not configured")
        || message.contains("status 401")
        || message.contains("status 403")
        || message.contains("unauthorized")
        || message.contains("invalid api key")
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn call_model_once(
    session_id: &str,
    turn_id: &str,
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    capabilities: &ModelCapabilityProfile,
    cancellation: &Arc<AtomicBool>,
) -> AgentRuntimeResult<ModelReply> {
    call_model_once_inner(
        session_id,
        turn_id,
        provider,
        model,
        messages,
        tools,
        capabilities,
        cancellation,
        true,
    )
}

fn call_model_once_for_loop(
    session_id: &str,
    turn_id: &str,
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    capabilities: &ModelCapabilityProfile,
    cancellation: &Arc<AtomicBool>,
) -> AgentRuntimeResult<ModelReply> {
    call_model_once_inner(
        session_id,
        turn_id,
        provider,
        model,
        messages,
        tools,
        capabilities,
        cancellation,
        false,
    )
}

fn call_model_once_inner(
    session_id: &str,
    turn_id: &str,
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    capabilities: &ModelCapabilityProfile,
    cancellation: &Arc<AtomicBool>,
    commit_assistant_text: bool,
) -> AgentRuntimeResult<ModelReply> {
    if capabilities.supports_streaming {
        match call_model_once_streaming_inner(
            session_id,
            turn_id,
            provider,
            model,
            messages,
            tools,
            cancellation,
            commit_assistant_text,
        ) {
            Ok(reply) => return Ok(reply),
            Err(error) if is_empty_model_reply_error(&error) => {}
            Err(error) if is_provider_transport_error(&error) => {
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_stream_transport_non_streaming_fallback",
                    1,
                    &error.to_string(),
                );
            }
            Err(error) => return Err(error),
        }
    }
    let mut reply = call_model_once_non_streaming(provider, model, messages, tools)?;
    normalize_model_reply_protocol(&mut reply, tools)?;
    if commit_assistant_text
        && let Some(content) = reply
            .content
            .as_ref()
            .filter(|content| !content.trim().is_empty())
    {
        reply.ui_message_id = emit_assistant_text(session_id, turn_id, content);
    }
    Ok(reply)
}

pub(crate) fn call_model_once_non_streaming(
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
) -> AgentRuntimeResult<ModelReply> {
    let base_url = provider
        .base_url
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            AgentRuntimeError::Core("provider base URL is not configured".to_string())
        })?;
    let api_key = provider
        .api_key
        .clone()
        .or_else(|| {
            provider
                .api_key_env
                .as_ref()
                .and_then(|key| env::var(key).ok())
        })
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            AgentRuntimeError::Core(format!(
                "API key is not configured for provider {}",
                provider.label
            ))
        })?;
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = model_request_body(model, messages, tools, false);
    let response = http_client_builder(Duration::from_secs(120))
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?
        .post(url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let status = response.status();
    let body: Value = response
        .json()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    if !status.is_success() {
        return Err(AgentRuntimeError::Core(format!(
            "provider request failed with status {status}: {body}"
        )));
    }
    let message = body.pointer("/choices/0/message").ok_or_else(|| {
        AgentRuntimeError::Core("provider returned no assistant message".to_string())
    })?;
    let content = model_message_content(message.get("content"));
    let reasoning = model_message_reasoning_text(message);
    let allowed_tool_names = model_tool_name_set(tools);
    let tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| parse_model_tool_call(item, &allowed_tool_names))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if content.as_ref().is_none_or(|value| value.trim().is_empty()) && tool_calls.is_empty() {
        if reasoning
            .as_ref()
            .is_some_and(|value| !value.trim().is_empty())
        {
            return Err(AgentRuntimeError::Core(
                "provider returned reasoning without final assistant text or tool call".to_string(),
            ));
        }
        return Err(AgentRuntimeError::Core(
            "provider returned no assistant text or tool call".to_string(),
        ));
    }
    Ok(ModelReply {
        content,
        tool_calls,
        ui_message_id: None,
    })
}

#[allow(dead_code)]
pub(crate) fn call_model_once_streaming(
    session_id: &str,
    turn_id: &str,
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    cancellation: &Arc<AtomicBool>,
) -> AgentRuntimeResult<ModelReply> {
    call_model_once_streaming_inner(
        session_id,
        turn_id,
        provider,
        model,
        messages,
        tools,
        cancellation,
        true,
    )
}

fn call_model_once_streaming_inner(
    session_id: &str,
    turn_id: &str,
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    cancellation: &Arc<AtomicBool>,
    commit_assistant_text: bool,
) -> AgentRuntimeResult<ModelReply> {
    let base_url = provider
        .base_url
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            AgentRuntimeError::Core("provider base URL is not configured".to_string())
        })?;
    let api_key = provider_api_key(provider).ok_or_else(|| {
        AgentRuntimeError::Core(format!(
            "API key is not configured for provider {}",
            provider.label
        ))
    })?;
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = model_request_body(model, messages, tools, true);
    let response = http_client_builder(Duration::from_secs(120))
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?
        .post(url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .unwrap_or_else(|error| format!("failed to read provider error body: {error}"));
        return Err(AgentRuntimeError::Core(format!(
            "provider request failed with status {status}: {body}"
        )));
    }
    parse_streaming_response_with_commit(
        BufReader::new(response),
        session_id,
        turn_id,
        cancellation,
        tools,
        commit_assistant_text,
    )
}

pub(crate) fn model_request_body(
    model: &str,
    messages: &[Value],
    tools: &[Value],
    stream: bool,
) -> Value {
    let mut body = json!({
        "model": model,
        "messages": messages,
        "stream": stream,
    });
    if !tools.is_empty() {
        body["tools"] = Value::Array(tools.to_vec());
        body["tool_choice"] = Value::String("auto".to_string());
    }
    body
}

#[derive(Clone, Debug, Default)]
pub(crate) struct StreamingToolCallAccumulator {
    pub(crate) id: Option<String>,
    pub(crate) name: Option<String>,
    pub(crate) arguments: String,
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn parse_streaming_response<R: BufRead>(
    reader: R,
    session_id: &str,
    turn_id: &str,
    cancellation: &Arc<AtomicBool>,
    tools: &[Value],
) -> AgentRuntimeResult<ModelReply> {
    parse_streaming_response_with_commit(reader, session_id, turn_id, cancellation, tools, true)
}

fn parse_streaming_response_with_commit<R: BufRead>(
    reader: R,
    session_id: &str,
    turn_id: &str,
    cancellation: &Arc<AtomicBool>,
    tools: &[Value],
    commit_assistant_text: bool,
) -> AgentRuntimeResult<ModelReply> {
    let mut state = ProviderStreamState::default();
    let mut ui_message_id: Option<String> = None;
    let buffer_assistant_text = !commit_assistant_text || !tools.is_empty();
    let allowed_tool_names = model_tool_name_set(tools);

    for line in reader.lines() {
        if cancellation.load(Ordering::SeqCst) || turn_was_cancelled(session_id, turn_id) {
            return Err(AgentRuntimeError::Core("turn cancelled".to_string()));
        }
        let line = line.map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        let Some(data) = line.trim().strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data == "[DONE]" {
            break;
        }
        if data.is_empty() {
            continue;
        }
        let value: Value = serde_json::from_str(data)
            .map_err(|error| AgentRuntimeError::Serialization(error.to_string()))?;
        if let Some(error) = value.get("error") {
            return Err(AgentRuntimeError::Core(format!(
                "provider streaming error: {error}"
            )));
        }
        map_provider_stream_chunk(
            &value,
            &mut state,
            &mut ui_message_id,
            buffer_assistant_text,
            session_id,
            turn_id,
        )?;
    }

    let mut tool_calls = finalize_streaming_tool_calls(state.tool_calls, &allowed_tool_names)?;
    tool_calls.sort_by_key(|(index, _)| *index);
    let tool_calls = tool_calls
        .into_iter()
        .map(|(_, call)| call)
        .collect::<Vec<_>>();

    if state.content.trim().is_empty() && tool_calls.is_empty() {
        if state.reasoning_chars > 0 {
            return Err(AgentRuntimeError::Core(
                "provider returned reasoning without final assistant text or tool call".to_string(),
            ));
        }
        if state.finish_reason.as_deref() == Some("tool_calls") {
            return Err(AgentRuntimeError::Core(
                "provider finished with tool_calls but returned no complete tool call".to_string(),
            ));
        }
        return Err(AgentRuntimeError::Core(
            "provider returned no assistant text or tool call".to_string(),
        ));
    }

    let mut reply = ModelReply {
        content: (!state.content.trim().is_empty()).then_some(state.content),
        tool_calls,
        ui_message_id: ui_message_id.filter(|id| !id.is_empty()),
    };
    normalize_model_reply_protocol(&mut reply, tools)?;
    if commit_assistant_text
        && buffer_assistant_text
        && let Some(content) = reply
            .content
            .as_ref()
            .filter(|content| !content.trim().is_empty())
    {
        reply.ui_message_id = emit_assistant_text(session_id, turn_id, content);
    }
    Ok(reply)
}

pub(crate) fn map_provider_stream_chunk(
    value: &Value,
    state: &mut ProviderStreamState,
    ui_message_id: &mut Option<String>,
    buffer_assistant_text: bool,
    session_id: &str,
    turn_id: &str,
) -> AgentRuntimeResult<()> {
    let Some(choices) = value.get("choices").and_then(Value::as_array) else {
        return Ok(());
    };
    let Some(choice) = choices.first() else {
        return Ok(());
    };
    state.saw_choice = true;
    if let Some(finish_reason) = choice.get("finish_reason").and_then(Value::as_str)
        && !finish_reason.trim().is_empty()
    {
        state.finish_reason = Some(finish_reason.to_string());
    }
    let delta = choice.get("delta").unwrap_or(&Value::Null);
    if let Some(text) = model_message_content(delta.get("content"))
        && !text.is_empty()
    {
        if !buffer_assistant_text {
            let message_id = ui_message_id
                .get_or_insert_with(|| {
                    emit_assistant_message_placeholder(session_id, turn_id).unwrap_or_default()
                })
                .clone();
            if !message_id.is_empty() {
                append_assistant_delta(session_id, turn_id, &message_id, &text)?;
            }
        }
        state.content.push_str(&text);
    }
    if let Some(reasoning) = model_message_reasoning_text(delta) {
        state.reasoning_chars = state
            .reasoning_chars
            .saturating_add(reasoning.chars().count());
    }
    if let Some(chunks) = delta.get("tool_calls").and_then(Value::as_array) {
        for chunk in chunks {
            let index = chunk.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            let accumulator = state.tool_calls.entry(index).or_default();
            if let Some(id) = chunk.get("id").and_then(Value::as_str)
                && is_valid_tool_call_id(id)
            {
                accumulator.id = Some(id.trim().to_string());
            }
            if let Some(name) = chunk.pointer("/function/name").and_then(Value::as_str)
                && !name.trim().is_empty()
            {
                accumulator.name = Some(name.trim().to_string());
            }
            if let Some(arguments) = chunk.pointer("/function/arguments").and_then(Value::as_str) {
                accumulator.arguments.push_str(arguments);
            }
        }
    }
    Ok(())
}

pub(crate) fn finalize_streaming_tool_calls(
    tool_calls: HashMap<usize, StreamingToolCallAccumulator>,
    allowed_tool_names: &HashSet<String>,
) -> AgentRuntimeResult<Vec<(usize, ModelToolCall)>> {
    let mut finalized = Vec::new();
    for (index, accumulator) in tool_calls {
        let has_tool_payload = accumulator.id.is_some()
            || accumulator.name.is_some()
            || !accumulator.arguments.trim().is_empty();
        if !has_tool_payload {
            continue;
        }
        let Some(name) = accumulator
            .name
            .as_deref()
            .and_then(|name| repair_model_tool_name(name, allowed_tool_names))
        else {
            return Err(AgentRuntimeError::Core(
                "provider returned incomplete tool call: missing function name".to_string(),
            ));
        };
        finalized.push((
            index,
            ModelToolCall {
                id: accumulator
                    .id
                    .filter(|id| is_valid_tool_call_id(id))
                    .unwrap_or_else(|| format!("tool-{}", Uuid::new_v4())),
                name,
                arguments: parse_model_tool_arguments(&accumulator.arguments),
            },
        ));
    }
    Ok(finalized)
}

pub(crate) const TEXTUAL_TOOL_CALL_MARKER: &str = "[Tool call:";

pub(crate) fn normalize_model_reply_protocol(
    reply: &mut ModelReply,
    tools: &[Value],
) -> AgentRuntimeResult<()> {
    let allowed_tool_names = model_tool_name_set(tools);
    for call in &mut reply.tool_calls {
        if let Some(name) = repair_model_tool_name(&call.name, &allowed_tool_names) {
            call.name = name;
        }
    }
    let Some(content) = reply.content.take() else {
        return Ok(());
    };
    if contains_textual_tool_call_marker(&content, &allowed_tool_names) {
        return Err(AgentRuntimeError::Core(
            "provider emitted textual tool-call syntax instead of a structured Lyra tool call"
                .to_string(),
        ));
    }
    reply.content = normalize_visible_assistant_text(&content);
    Ok(())
}

pub(crate) fn normalize_visible_assistant_text(content: &str) -> Option<String> {
    let text = content.trim();
    (!text.is_empty()).then(|| text.to_string())
}

pub(crate) fn model_tool_name_set(tools: &[Value]) -> HashSet<String> {
    tools
        .iter()
        .filter_map(|tool| tool.pointer("/function/name").and_then(Value::as_str))
        .map(str::to_string)
        .collect()
}

pub(crate) fn contains_textual_tool_call_marker(
    content: &str,
    allowed_tool_names: &HashSet<String>,
) -> bool {
    if find_ascii_case_insensitive(content, TEXTUAL_TOOL_CALL_MARKER, 0).is_some() {
        return true;
    }
    contains_textual_structured_tool_shape(content, allowed_tool_names)
}

fn contains_textual_structured_tool_shape(
    content: &str,
    allowed_tool_names: &HashSet<String>,
) -> bool {
    let lower = content.to_ascii_lowercase();
    if lower.contains("```")
        && lower.contains("\"path\"")
        && lower.contains("\"/tools/")
        && lower.contains("\"args\"")
    {
        return true;
    }
    let tool_names = textual_tool_name_candidates(allowed_tool_names);
    tool_names.iter().any(|tool_name| {
        let tool = tool_name.to_ascii_lowercase();
        if lower.contains(&format!("{tool}(")) {
            return true;
        }
        let quoted = format!("\"{tool}\"");
        if !lower.contains(&quoted) {
            return false;
        }
        lower.contains("\"arguments\"")
            || lower.contains("\"args\"")
            || lower.contains("\"function\"")
            || lower.contains("\"tool_calls\"")
            || lower.contains("tool_call")
            || lower.contains("```")
    })
}

fn textual_tool_name_candidates(allowed_tool_names: &HashSet<String>) -> HashSet<String> {
    let mut names = allowed_tool_names.clone();
    for name in PROVIDER_VISIBLE_TOOL_NAMES {
        names.insert(name.to_string());
    }
    names.insert(LYRA_TURN_FINISH_TOOL.to_string());
    names
}

pub(crate) fn find_ascii_case_insensitive(
    haystack: &str,
    needle: &str,
    from: usize,
) -> Option<usize> {
    if from >= haystack.len() {
        return None;
    }
    let haystack_lower = haystack[from..].to_ascii_lowercase();
    let needle_lower = needle.to_ascii_lowercase();
    haystack_lower
        .find(&needle_lower)
        .map(|offset| from + offset)
}

pub(crate) fn model_message_content(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(text)) => Some(text.clone()),
        Some(Value::Array(parts)) => {
            let text = parts
                .iter()
                .filter_map(|part| {
                    part.get("text")
                        .and_then(Value::as_str)
                        .or_else(|| part.get("content").and_then(Value::as_str))
                })
                .collect::<Vec<_>>()
                .join("");
            (!text.trim().is_empty()).then_some(text)
        }
        _ => None,
    }
}

pub(crate) fn model_message_reasoning_text(message: &Value) -> Option<String> {
    [
        "reasoning",
        "reasoning_content",
        "thinking",
        "reasoning_text",
    ]
    .iter()
    .find_map(|field| message.get(*field).and_then(Value::as_str))
    .filter(|value| !value.trim().is_empty())
    .map(str::to_string)
    .or_else(|| {
        message
            .get("reasoning_details")
            .filter(|value| !value.is_null())
            .map(|value| serde_json::to_string(value).unwrap_or_default())
            .filter(|value| !value.trim().is_empty())
    })
}

pub(crate) fn parse_model_tool_call(
    value: &Value,
    allowed_tool_names: &HashSet<String>,
) -> Option<ModelToolCall> {
    let function = value.get("function")?;
    let name = function
        .get("name")
        .and_then(Value::as_str)
        .and_then(|name| repair_model_tool_name(name, allowed_tool_names))?;
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| is_valid_tool_call_id(id))
        .map(|id| id.trim().to_string())
        .unwrap_or_else(|| format!("tool-{}", Uuid::new_v4()));
    let arguments = match function.get("arguments") {
        Some(Value::String(text)) => parse_model_tool_arguments(text),
        Some(value) => value.clone(),
        None => json!({}),
    };
    Some(ModelToolCall {
        id,
        name,
        arguments,
    })
}

pub(crate) fn repair_model_tool_name(
    name: &str,
    allowed_tool_names: &HashSet<String>,
) -> Option<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return None;
    }
    if allowed_tool_names.is_empty() {
        return None;
    }
    if allowed_tool_names.contains(trimmed) {
        return Some(trimmed.to_string());
    }
    let lowercase = trimmed.to_ascii_lowercase();
    if allowed_tool_names.contains(&lowercase) {
        return Some(lowercase);
    }
    Some(trimmed.to_string())
}

pub(crate) fn is_valid_tool_call_id(id: &str) -> bool {
    let value = id.trim();
    !value.is_empty() && value != "null"
}

pub(crate) fn parse_model_tool_arguments(arguments: &str) -> Value {
    let text = arguments.trim();
    if text.is_empty() {
        return json!({});
    }
    serde_json::from_str(text).unwrap_or_else(
        |error| json!({ "rawArguments": arguments, "parseError": error.to_string() }),
    )
}

pub(crate) fn model_capabilities(
    provider: &NativeProviderProfile,
    model: &str,
) -> ModelCapabilityProfile {
    let profile = provider
        .models
        .iter()
        .find(|candidate| candidate.id == model);
    ModelCapabilityProfile {
        supports_image_input: profile
            .map(|candidate| candidate.supports_image_input)
            .unwrap_or(true),
        supports_tool_calling: profile
            .map(|candidate| candidate.supports_tool_calling)
            .unwrap_or(true),
        supports_streaming: profile
            .map(|candidate| candidate.supports_streaming)
            .unwrap_or(true),
        context_window: profile.and_then(|candidate| candidate.context_window),
    }
}
