use super::{
    providers::protocol::{
        anthropic_messages, aws_bedrock_converse, gemini_generate_content, ollama_chat,
        openai_chat_completions as openai_chat, openai_responses,
    },
    *,
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use lyra_tool_fs_core::PROVIDER_VISIBLE_TOOL_NAMES;
use std::collections::VecDeque;
use std::sync::{Condvar, Mutex as StdMutex};

const REPEATED_TOOL_ROUND_SOFT_OCCURRENCES: usize = 3;
const REPEATED_TOOL_ROUND_HARD_OCCURRENCES: usize = 5;
const MAX_CONTINUATION_RETRIES: u8 = 4;
/// How many times a streaming turn is replayed after a transport failure that
/// struck before any increment was committed to the session (e.g. the provider
/// dropped the connection before the first usable SSE event). Replay is only
/// attempted when the route's parser confirms nothing was committed; a
/// mid-stream failure after a committed delta is never replayed.
const MAX_STREAM_TRANSPORT_RETRIES: u8 = 2;
const MAX_PROVIDER_IMAGE_TOOL_BYTES: u64 = 8 * 1024 * 1024;
const MAX_TOKENS_CONTINUATION_PROMPT: &str = "Previous response was cut off by output token limit, not finished. Continue the same response exactly where it stopped. Do not repeat, restart, apologize, or re-introduce. Output only continuation.";
const MAX_TOKENS_EXHAUSTED_VISIBLE_NOTE: &str =
    "[Auto continuation limit reached. Reply \"continue\" for remaining output.]";
const PROGRESS_GUARD_WARNING_PROMPT: &str = "Lyra's dynamic progress guard detected repeated identical tool calls with identical provider-visible results. Do not repeat the exact same tool call again unless the page, file, or external state has actually changed. Change strategy, inspect different evidence, use a more specific wait/read_until condition, or produce the final answer/blocker summary from the evidence already gathered.";
const PROGRESS_GUARD_FINAL_SYNTHESIS_PROMPT: &str = "Lyra's dynamic progress guard detected repeated identical tool calls with no new provider-visible evidence. Do not call more task tools in this response. Produce the best possible final answer from gathered evidence. If task is incomplete, state attempted work, exact blocker, and one next action. Do not ask member to restate the same request. Only exception: if completion truly needs missing member decision, call lyra_clarification_ask. Plain assistant questions r non-blocking and must not be used to wait.";

const PROVIDER_MIN_CONCURRENCY: usize = 1;
const PROVIDER_INITIAL_CONCURRENCY: usize = 2;
const PROVIDER_MAX_CONCURRENCY: usize = 4;
const PROVIDER_SUCCESSES_TO_GROW: u8 = 2;

struct ProviderRequestScheduler {
    state: StdMutex<HashMap<String, ProviderRequestLane>>,
    wake: Condvar,
}

#[derive(Default)]
struct ProviderRequestLane {
    in_flight: usize,
    capacity: usize,
    consecutive_successes: u8,
    next_ticket: u64,
    waiting: VecDeque<u64>,
    cooldown_until: Option<Instant>,
    backoff_attempt: u8,
}

struct ProviderRequestPermit {
    key: String,
}

static PROVIDER_REQUEST_SCHEDULER: OnceLock<ProviderRequestScheduler> = OnceLock::new();

fn provider_request_scheduler() -> &'static ProviderRequestScheduler {
    PROVIDER_REQUEST_SCHEDULER.get_or_init(|| ProviderRequestScheduler {
        state: StdMutex::new(HashMap::new()),
        wake: Condvar::new(),
    })
}

fn provider_lane_key(provider: &NativeProviderProfile, model: &str) -> String {
    format!(
        "{}\u{1f}{}\u{1f}{}\u{1f}{}",
        provider.route_id,
        provider.id,
        provider.base_url.as_deref().unwrap_or_default(),
        model
    )
}

fn acquire_provider_request_permit(
    provider: &NativeProviderProfile,
    model: &str,
    cancellation: &Arc<AtomicBool>,
) -> AgentRuntimeResult<ProviderRequestPermit> {
    let scheduler = provider_request_scheduler();
    let key = provider_lane_key(provider, model);
    let mut state = scheduler
        .state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let lane = state
        .entry(key.clone())
        .or_insert_with(|| ProviderRequestLane {
            capacity: PROVIDER_INITIAL_CONCURRENCY,
            ..ProviderRequestLane::default()
        });
    let ticket = lane.next_ticket;
    lane.next_ticket = lane.next_ticket.wrapping_add(1);
    lane.waiting.push_back(ticket);
    loop {
        if cancellation.load(Ordering::SeqCst) {
            if let Some(lane) = state.get_mut(&key) {
                lane.waiting.retain(|queued| *queued != ticket);
            }
            scheduler.wake.notify_all();
            return Err(AgentRuntimeError::Core("turn cancelled".to_string()));
        }
        let now = Instant::now();
        let lane = state.get_mut(&key).expect("provider lane exists");
        let cooling_down = lane.cooldown_until.is_some_and(|deadline| deadline > now);
        let is_next = lane.waiting.front().copied() == Some(ticket);
        if is_next && !cooling_down && lane.in_flight < lane.capacity {
            lane.waiting.pop_front();
            lane.in_flight += 1;
            return Ok(ProviderRequestPermit { key });
        }
        let wait_for = lane
            .cooldown_until
            .and_then(|deadline| deadline.checked_duration_since(now))
            .map(|duration| duration.min(Duration::from_millis(100)))
            .unwrap_or(Duration::from_millis(50));
        let (next, _) = scheduler
            .wake
            .wait_timeout(state, wait_for)
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state = next;
    }
}

fn release_provider_request_permit(
    permit: ProviderRequestPermit,
    result: &AgentRuntimeResult<ModelReply>,
) {
    let scheduler = provider_request_scheduler();
    let mut state = scheduler
        .state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let lane = state
        .get_mut(&permit.key)
        .expect("provider lane exists while its permit is held");
    lane.in_flight = lane.in_flight.saturating_sub(1);
    if result.is_ok() {
        lane.consecutive_successes = lane.consecutive_successes.saturating_add(1);
        if lane.consecutive_successes >= PROVIDER_SUCCESSES_TO_GROW
            && lane.capacity < PROVIDER_MAX_CONCURRENCY
        {
            lane.capacity += 1;
            lane.consecutive_successes = 0;
            lane.backoff_attempt = 0;
        }
    } else if result
        .as_ref()
        .err()
        .is_some_and(is_provider_rate_limited_error)
    {
        lane.capacity = (lane.capacity / 2).max(PROVIDER_MIN_CONCURRENCY);
        lane.consecutive_successes = 0;
        lane.backoff_attempt = lane.backoff_attempt.saturating_add(1).min(6);
        let cooldown = retry_after_from_error(result.as_ref().err().expect("checked above"))
            .unwrap_or_else(|| {
                let base =
                    250_u64.saturating_mul(2_u64.saturating_pow(lane.backoff_attempt.into()));
                Duration::from_millis(base.min(8_000) + (lane.backoff_attempt as u64 * 31 % 97))
            });
        lane.cooldown_until = Some(Instant::now() + cooldown);
    }
    scheduler.wake.notify_all();
}

fn is_provider_rate_limited_error(error: &AgentRuntimeError) -> bool {
    let message = error.to_string().to_ascii_lowercase();
    message.contains("status 429")
        || message.contains("rate limit")
        || message.contains("too many requests")
        || message.contains("overloaded")
        || message.contains("capacity")
}

fn retry_after_from_error(error: &AgentRuntimeError) -> Option<Duration> {
    let marker = "retry-after-ms:";
    let message = error.to_string().to_ascii_lowercase();
    let offset = message.find(marker)? + marker.len();
    let milliseconds = message[offset..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>()
        .parse::<u64>()
        .ok()?;
    Some(Duration::from_millis(milliseconds.min(60_000)))
}
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
    pub(crate) reasoning_content: Option<String>,
    pub(crate) tool_calls: Vec<ModelToolCall>,
    pub(crate) ui_message_id: Option<String>,
    pub(crate) provider_replay_items: Vec<Value>,
    /// The provider's normalized stop signal for this reply. Used by the turn
    /// loop to tell "model wanted to call a tool but emitted none" (=> retry)
    /// apart from "model is done" (=> end turn), instead of guessing from prose.
    /// `None` when the provider did not report one (older/odd endpoints).
    pub(crate) stop_signal: TurnStopSignal,
}

/// Provider-agnostic stop reason. Each protocol maps its native field
/// (OpenAI `finish_reason`, Anthropic/Bedrock `stop_reason`/`stopReason`,
/// Gemini `finishReason`) onto this so the turn loop reasons about one vocabulary.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum TurnStopSignal {
    /// The model finished a normal text answer (OpenAI `stop`, Anthropic
    /// `end_turn`, Gemini `STOP`). No tool was requested.
    EndTurn,
    /// The model signalled it wants to use a tool (OpenAI `tool_calls`,
    /// Anthropic `tool_use`). If no structured tool_call was parsed, this is the
    /// reliable "forgot to emit the tool_call" signal.
    ToolUse,
    /// Length/token cap (OpenAI `length`, Anthropic `max_tokens`).
    MaxTokens,
    /// Provider reported nothing usable, or an unrecognized value.
    #[default]
    Unknown,
}

impl TurnStopSignal {
    /// Map a raw provider stop string (any protocol) onto the unified vocabulary.
    pub(crate) fn from_raw(raw: Option<&str>) -> Self {
        match raw.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            Some("stop" | "end_turn" | "endturn") => Self::EndTurn,
            Some("tool_calls" | "tool_use" | "tooluse" | "function_call") => Self::ToolUse,
            Some("length" | "max_tokens" | "max_token" | "max_output_tokens" | "model_length") => {
                Self::MaxTokens
            }
            _ => Self::Unknown,
        }
    }
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
    pub(crate) reasoning_content: String,
    pub(crate) reasoning_chars: usize,
    pub(crate) tool_calls: HashMap<usize, openai_chat::StreamingToolCallAccumulator>,
    pub(crate) saw_choice: bool,
    pub(crate) finish_reason: Option<String>,
    /// True once this stream has committed any increment to session state — an
    /// assistant delta or a streaming tool-call preview
    /// (`maybe_emit_streaming_diff_previews_from_accumulators`).
    /// A transport failure before this point is safe to retry (replaying the
    /// turn duplicates nothing); a failure after it is not, because the
    /// partial assistant text / tool activity is already in the timeline.
    pub(crate) committed_any: bool,
    /// Strips inline `<think>…</think>` reasoning from OpenAI-compatible content
    /// deltas so it never leaks into the visible message; routed to
    /// `reasoning_content` instead. Stateful across deltas (handles tags split
    /// across stream chunks).
    pub(crate) think_scrubber: openai_chat::StreamingThinkScrubber,
}

#[derive(Clone, Debug)]
pub(crate) struct ModelLoopResult {
    pub(crate) final_text: Option<String>,
    pub(crate) metadata: Option<Value>,
    pub(crate) provider_transcript: Vec<Value>,
    pub(crate) provider_replay_items: Vec<Value>,
    pub(crate) ui_text_committed: bool,
}

impl ModelLoopResult {
    pub(crate) fn final_text(text: String) -> Self {
        Self {
            final_text: Some(text),
            metadata: None,
            provider_transcript: Vec::new(),
            provider_replay_items: Vec::new(),
            ui_text_committed: false,
        }
    }

    fn with_ui_text_committed(mut self, ui_text_committed: bool) -> Self {
        self.ui_text_committed = ui_text_committed;
        self
    }

    fn with_provider_transcript(mut self, provider_transcript: Vec<Value>) -> Self {
        self.provider_transcript = provider_transcript;
        self
    }

    fn with_provider_replay_items(mut self, provider_replay_items: Vec<Value>) -> Self {
        self.provider_replay_items = provider_replay_items;
        self
    }

    fn with_metadata(mut self, metadata: Value) -> Self {
        self.metadata = Some(metadata);
        self
    }

    pub(crate) fn session_metadata(&self) -> Option<Value> {
        let mut metadata = self.metadata.clone().unwrap_or_else(|| json!({}));
        if !metadata.is_object() {
            metadata = json!({ "value": metadata });
        }
        if !self.provider_transcript.is_empty()
            && let Some(object) = metadata.as_object_mut()
        {
            object.insert(
                "providerTranscript".to_string(),
                Value::Array(self.provider_transcript.clone()),
            );
        }
        if !self.provider_replay_items.is_empty()
            && let Some(object) = metadata.as_object_mut()
        {
            object.insert(
                "openaiResponsesReplay".to_string(),
                Value::Array(self.provider_replay_items.clone()),
            );
        }
        (!metadata.as_object().is_some_and(Map::is_empty)).then_some(metadata)
    }
}

#[derive(Debug, Default)]
struct ModelLoopProgressGuard {
    last_fingerprint: Option<String>,
    repeated_occurrences: usize,
    browser_loop_detector: browser_loop_detector::BrowserLoopDetector,
    browser_automation_paused: bool,
    browser_tools_used_this_turn: usize,
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
    run_model_loop_with_ui_commit(session_id, turn_id, request, cancellation, true)
}

pub(crate) fn run_model_loop_without_ui_commit(
    session_id: &str,
    turn_id: &str,
    request: ModelRequest,
    cancellation: &Arc<AtomicBool>,
) -> AgentRuntimeResult<ModelLoopResult> {
    run_model_loop_with_ui_commit(session_id, turn_id, request, cancellation, false)
}

fn run_model_loop_with_ui_commit(
    session_id: &str,
    turn_id: &str,
    mut request: ModelRequest,
    cancellation: &Arc<AtomicBool>,
    commit_assistant_text: bool,
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
    let mut retried_after_image_input_error = false;
    let mut retried_after_empty_reply = false;
    let mut protocol_leak_retries = 0_u8;
    let mut missing_tool_retries = 0_u8;
    let mut transient_provider_retries = 0_u8;
    let mut continuation_retries = 0_u8;
    let mut truncated_prefix: Option<String> = None;
    let mut progress_guard = ModelLoopProgressGuard::default();
    let mut provider_transcript = Vec::new();
    let mut provider_replay_items = Vec::new();
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
            commit_assistant_text,
        ) {
            Ok(reply) => {
                observe_successful_provider_capabilities(session_id, &request, &messages, &reply);
                reply
            }
            Err(error)
                if !retried_after_image_input_error
                    && providers::model_capabilities::is_image_input_unsupported_error(&error) =>
            {
                retried_after_image_input_error = true;
                let evidence = error.to_string();
                let _ = providers::model_capabilities::record_observed_model_capability(
                    session_id,
                    &request.provider.id,
                    &request.model,
                    providers::model_capabilities::ObservedCapability::ImageInput,
                    false,
                    &evidence,
                );
                request.capabilities.supports_image_input = false;
                let (stripped, downgrades) =
                    providers::model_capabilities::strip_images_from_provider_messages(messages);
                messages = stripped;
                if !downgrades.is_empty() {
                    messages.insert(
                        1,
                        json!({
                            "role": "system",
                            "content": format!(
                                "Structured input downgrade report: {}\nThis input was dropped before reaching U, not lost for good. Judge if it's worth recovering through Lyra — browser can open an online AI/tool that views or processes what U can't here. Decide, don't silently skip.",
                                serde_json::to_string(&downgrades)
                                    .unwrap_or_else(|_| "[]".to_string())
                            ),
                        }),
                    );
                }
                messages.push(json!({
                    "role": "system",
                    "content": "The active model/provider endpoint rejected image input. Lyra marked this model as non-vision for the current provider profile and retried without images. Prefer lyra_lumen.map and lyra_lumen.act with targetRef instead of visual capture for this model on this provider.",
                }));
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_image_input_downgrade_retry",
                    1,
                    &evidence,
                );
                continue;
            }
            Err(error)
                if !retried_after_context_error && is_context_length_error(&error.to_string()) =>
            {
                retried_after_context_error = true;
                messages =
                    compact_messages_for_retry(messages, request.capabilities.context_window);
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
                    commit_assistant_text,
                )?
            }
            Err(error) if !retried_after_empty_reply && is_empty_model_reply_error(&error) => {
                retried_after_empty_reply = true;
                clear_failed_assistant_draft(session_id, turn_id);
                let signals = crate::retention_policy::retention_signals_from_provider_messages(
                    &messages,
                    request.capabilities.context_window,
                );
                messages = crate::retention_policy::compact_provider_messages_for_retry(
                    messages,
                    &signals,
                    crate::retention_policy::TrimAggressiveness::Elevated,
                );
                emit_context_trimmed(
                    session_id,
                    json!({
                        "reason": "provider_empty_reply_retry",
                        "retry": true,
                    }),
                );
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
            Err(error)
                if protocol_leak_retries < max_protocol_leak_retry()
                    && is_textual_protocol_leak_error(&error) =>
            {
                protocol_leak_retries += 1;
                clear_failed_assistant_draft(session_id, turn_id);
                messages.push(json!({
                    "role": "system",
                    "content": protocol_leak_corrective_prompt(),
                }));
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_textual_protocol_leak_retry",
                    protocol_leak_retries,
                    &error.to_string(),
                );
                continue;
            }
            Err(error)
                if protocol_leak_retries < max_protocol_leak_retry()
                    && is_tool_payload_leak_error(&error) =>
            {
                protocol_leak_retries += 1;
                clear_failed_assistant_draft(session_id, turn_id);
                messages.push(json!({
                    "role": "system",
                    "content": tool_protocol::TOOL_OUTPUT_ECHO_CORRECTIVE_PROMPT,
                }));
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_tool_payload_leak_retry",
                    protocol_leak_retries,
                    &error.to_string(),
                );
                continue;
            }
            Err(error)
                if missing_tool_retries < max_missing_tool_retry()
                    && is_browser_anchor_without_tools_error(&error) =>
            {
                missing_tool_retries += 1;
                clear_failed_assistant_draft(session_id, turn_id);
                messages.push(json!({
                    "role": "system",
                    "content": tool_protocol::ACTION_TASK_WITHOUT_TOOLS_CORRECTIVE_PROMPT,
                }));
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_browser_anchor_without_tools_retry",
                    missing_tool_retries,
                    &error.to_string(),
                );
                continue;
            }
            Err(error)
                if missing_tool_retries < max_missing_tool_retry()
                    && is_missing_tool_call_reply_error(&error) =>
            {
                missing_tool_retries += 1;
                clear_failed_assistant_draft(session_id, turn_id);
                messages.push(json!({
                    "role": "system",
                    "content": no_tools_used_corrective_prompt(!request.tools.is_empty()),
                }));
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_missing_tool_call_retry",
                    missing_tool_retries,
                    &error.to_string(),
                );
                continue;
            }
            Err(error)
                if providers::routes::mimo::is_mimo_route(&request.provider.route_id)
                    && providers::mimo_faults::parse_mimo_fault_from_error(&error).is_some_and(
                        |fault| providers::mimo_faults::is_mimo_notify_and_fail_fault(&fault),
                    ) =>
            {
                let fault =
                    providers::mimo_faults::parse_mimo_fault_from_error(&error).expect("fault");
                emit_provider_fault(
                    session_id,
                    turn_id,
                    &request.provider.id,
                    &request.model,
                    &fault,
                );
                return Err(error);
            }
            Err(error)
                if providers::routes::mimo::is_mimo_route(&request.provider.route_id)
                    && transient_provider_retries
                        < providers::mimo_faults::MIMO_TRANSIENT_RETRY_LIMIT
                    && providers::mimo_faults::parse_mimo_fault_from_error(&error).is_some_and(
                        |fault| providers::mimo_faults::is_mimo_backoff_fault(&fault),
                    ) =>
            {
                transient_provider_retries += 1;
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "mimo_provider_backoff_retry",
                    transient_provider_retries,
                    &error.to_string(),
                );
                sleep_before_provider_retry(transient_provider_retries, cancellation)?;
                continue;
            }
            Err(error)
                if providers::routes::mimo::is_mimo_route(&request.provider.route_id)
                    && providers::mimo_faults::parse_mimo_fault_from_error(&error).is_some_and(
                        |fault| providers::mimo_faults::should_notify_for_mimo_fault(&fault, true),
                    ) =>
            {
                let fault =
                    providers::mimo_faults::parse_mimo_fault_from_error(&error).expect("fault");
                emit_provider_fault(
                    session_id,
                    turn_id,
                    &request.provider.id,
                    &request.model,
                    &fault,
                );
                return Err(error);
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
            // Decide whether the model *meant* to call a tool but emitted none.
            // Primary signal is the provider's structured stop reason
            // (finish_reason == tool_calls / stop_reason == tool_use): reliable,
            // language-agnostic, and not fooled by reasoning prose. The legacy
            // internal-marker heuristic stays as a fallback for endpoints that
            // report no usable stop signal. EndTurn ends the turn; MaxTokens is
            // provider truncation and is handled by the continuation branch.
            let wants_tool_retry = !request.tools.is_empty()
                && (reply.stop_signal == TurnStopSignal::ToolUse
                    || should_retry_missing_tool_call(
                        reply.content.as_deref(),
                        &request.tools,
                        true,
                    ));
            if wants_tool_retry && missing_tool_retries < max_missing_tool_retry() {
                missing_tool_retries += 1;
                if let Some(message_id) = reply.ui_message_id.as_ref().filter(|id| !id.is_empty()) {
                    let _ = remove_assistant_message(session_id, message_id);
                } else {
                    clear_failed_assistant_draft(session_id, turn_id);
                }
                messages.push(json!({
                    "role": "system",
                    "content": no_tools_used_corrective_prompt(!request.tools.is_empty()),
                }));
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_missing_tool_call_retry",
                    missing_tool_retries,
                    "assistant promised tool use without structured tool_call",
                );
                continue;
            }
            if reply
                .content
                .as_ref()
                .is_none_or(|text| text.trim().is_empty())
            {
                if let Some(message_id) = reply.ui_message_id.as_ref().filter(|id| !id.is_empty()) {
                    let _ = remove_assistant_message(session_id, message_id);
                } else {
                    clear_failed_assistant_draft(session_id, turn_id);
                }
                if !retried_after_empty_reply {
                    retried_after_empty_reply = true;
                    messages.push(json!({
                        "role": "system",
                        "content": "The previous provider response produced no visible assistant text and could not be committed to Lyra's factual timeline. Continue the same user request now. If a capability is needed, emit a structured tool_call. Otherwise answer with normal assistant text. Do not return an empty assistant message or internal placeholders."
                    }));
                    emit_provider_retry(
                        session_id,
                        turn_id,
                        "provider_empty_visible_reply_retry",
                        1,
                        "assistant reply contained no visible text",
                    );
                    continue;
                }
                return Err(AgentRuntimeError::Core(
                    "provider returned no assistant text or tool call".to_string(),
                ));
            }
            if tool_protocol::should_reject_browser_anchor_without_browser_tools(
                &messages,
                &request.tools,
                progress_guard.browser_tools_used_this_turn,
                true,
            ) {
                if let Some(message_id) = reply.ui_message_id.as_ref().filter(|id| !id.is_empty()) {
                    let _ = remove_assistant_message(session_id, message_id);
                } else {
                    clear_failed_assistant_draft(session_id, turn_id);
                }
                return Err(AgentRuntimeError::Core(
                    "assistant completed a browser-anchored request without structured browser tool_call"
                        .to_string(),
                ));
            }
            let this_segment = reply.content.clone().unwrap_or_default();
            if !reply.provider_replay_items.is_empty() {
                provider_replay_items.extend(reply.provider_replay_items.clone());
            }
            if reply.stop_signal == TurnStopSignal::MaxTokens
                && continuation_retries < MAX_CONTINUATION_RETRIES
                && !this_segment.trim().is_empty()
            {
                continuation_retries += 1;
                let mut accumulated = truncated_prefix.take().unwrap_or_default();
                accumulated.push_str(&this_segment);
                truncated_prefix = Some(accumulated);
                let segment_assistant = json!({
                    "role": "assistant",
                    "content": this_segment,
                });
                messages.push(segment_assistant.clone());
                provider_transcript.push(segment_assistant);
                if let Some(message_id) = reply.ui_message_id.as_ref().filter(|id| !id.is_empty()) {
                    let _ = remove_assistant_message(session_id, message_id);
                } else {
                    clear_failed_assistant_draft(session_id, turn_id);
                }
                messages.push(json!({
                    "role": "system",
                    "content": MAX_TOKENS_CONTINUATION_PROMPT,
                }));
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_max_tokens_continuation_retry",
                    continuation_retries,
                    "model output truncated by max_tokens; continuing",
                );
                continue;
            }
            let had_truncated_prefix = truncated_prefix.is_some();
            let mut final_text = match truncated_prefix.take() {
                Some(mut prefix) => {
                    prefix.push_str(&this_segment);
                    prefix
                }
                None => this_segment,
            };
            let continuation_exhausted =
                reply.stop_signal == TurnStopSignal::MaxTokens && had_truncated_prefix;
            if continuation_exhausted {
                if !final_text.ends_with('\n') {
                    final_text.push_str("\n\n");
                }
                final_text.push_str(MAX_TOKENS_EXHAUSTED_VISIBLE_NOTE);
            }
            if had_truncated_prefix
                && let Some(message_id) = reply.ui_message_id.as_ref().filter(|id| !id.is_empty())
            {
                let _ = remove_assistant_message(session_id, message_id);
            }
            let mut final_assistant = json!({
                "role": "assistant",
                "content": final_text,
            });
            if let Some(reasoning_content) = reply
                .reasoning_content
                .as_ref()
                .filter(|value| !value.trim().is_empty())
            {
                final_assistant["reasoning_content"] = Value::String(reasoning_content.clone());
                provider_transcript.push(final_assistant);
            }
            let mut result = ModelLoopResult::final_text(final_text)
                .with_ui_text_committed(reply.ui_message_id.is_some() && !had_truncated_prefix)
                .with_provider_transcript(provider_transcript)
                .with_provider_replay_items(provider_replay_items);
            if continuation_exhausted {
                result = result.with_metadata(json!({
                    "providerContinuation": {
                        "truncated": true,
                        "continuationExhausted": true,
                        "continuationRetries": continuation_retries,
                        "maxContinuationRetries": MAX_CONTINUATION_RETRIES,
                    }
                }));
            }
            return Ok(result);
        }

        let response_replay_items = reply.provider_replay_items.clone();
        if !response_replay_items.is_empty() {
            provider_replay_items.extend(response_replay_items.clone());
            messages.extend(response_replay_items);
        }
        let mut tool_calls = reply.tool_calls;
        let stop_after_plan_finalize = tool_calls
            .iter()
            .position(|call| call.name == PLAN_FINALIZE_MODEL_TOOL);
        if let Some(index) = stop_after_plan_finalize {
            tool_calls.truncate(index + 1);
        }
        let assistant_content = reply.content.unwrap_or_default();
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
        let mut assistant_message = json!({
            "role": "assistant",
            "content": assistant_content,
            "tool_calls": assistant_tool_calls,
        });
        if !reply.provider_replay_items.is_empty() {
            assistant_message["openaiResponsesShadow"] = Value::Bool(true);
        }
        if let Some(reasoning_content) = reply
            .reasoning_content
            .as_ref()
            .filter(|value| !value.trim().is_empty())
        {
            assistant_message["reasoning_content"] = Value::String(reasoning_content.clone());
        }
        messages.push(assistant_message.clone());
        provider_transcript.push(assistant_message);

        let mut provider_tool_results = Vec::new();
        let mut browser_tool_calls = Vec::new();
        let mut browser_tool_outputs = Vec::new();
        if !tool_calls.is_empty() {
            if cancellation.load(Ordering::SeqCst) || turn_was_cancelled(session_id, turn_id) {
                return Err(AgentRuntimeError::Core("turn cancelled".to_string()));
            }
            emit_turn_state(session_id, turn_id, "waiting_for_tool", "tool_call_started");
            let runtime = ToolExecutionRuntime::from_model_capabilities(&request.capabilities);
            let dispatcher = &request.host_dispatcher;
            let browser_paused = progress_guard.browser_automation_paused;
            // ponytail: All tools parallel by default — model decides what to batch.
            // Single call skips thread::scope overhead.  New tools inherit parallel
            // capability automatically; no per-tool opt-in needed.
            let mut outputs: Vec<Value> = if tool_calls.len() > 1
                && stop_after_plan_finalize.is_none()
            {
                std::thread::scope(|s| {
                    tool_calls
                        .iter()
                        .map(|call| {
                            let call = call.clone();
                            s.spawn(move || {
                                if browser_paused
                                    && tool_protocol::is_browser_tool_name(&call.name)
                                {
                                    return json!({
                                        "content": "Browser automation is paused because an upload or permission dialog is blocking the page. Close the dialog, then retry.",
                                        "raw": {
                                            "ok": false,
                                            "status": "blocked",
                                            "browserBlocked": true,
                                            "skipped": true,
                                            "reason": "browser_automation_paused",
                                        }
                                    });
                                }
                                execute_model_tool_with_runtime(
                                    session_id,
                                    turn_id,
                                    dispatcher,
                                    cancellation,
                                    runtime,
                                    call,
                                )
                            })
                        })
                        .collect::<Vec<_>>()
                        .into_iter()
                        .map(|h| h.join().expect("tool thread panicked"))
                        .collect()
                })
            } else {
                tool_calls
                    .iter()
                    .map(|call| {
                        if browser_paused && tool_protocol::is_browser_tool_name(&call.name) {
                            return json!({
                                "content": "Browser automation is paused because an upload or permission dialog is blocking the page. Close the dialog, then retry.",
                                "raw": {
                                    "ok": false,
                                    "status": "blocked",
                                    "browserBlocked": true,
                                    "skipped": true,
                                    "reason": "browser_automation_paused",
                                }
                            });
                        }
                        execute_model_tool_with_runtime(
                            session_id,
                            turn_id,
                            dispatcher,
                            cancellation,
                            runtime,
                            call.clone(),
                        )
                    })
                    .collect()
            };
            let tool_call_ids: Vec<String> = tool_calls.iter().map(|c| c.id.clone()).collect();
            tools::enforce_turn_tool_budget(session_id, turn_id, &mut outputs, &tool_call_ids);
            let plan_finalize_completed = stop_after_plan_finalize.is_some()
                && tool_calls.iter().zip(outputs.iter()).any(|(call, output)| {
                    call.name == PLAN_FINALIZE_MODEL_TOOL
                        && output.pointer("/raw/phase").and_then(Value::as_str)
                            == Some(PLAN_PHASE_REVIEWING)
                });
            for (call, output) in tool_calls.iter().zip(outputs.into_iter()) {
                let (content, evidence_ref) = guarded_tool_result_content(&output, 24_000);
                provider_tool_results.push(content.clone());
                if tool_protocol::is_browser_tool_name(&call.name) {
                    progress_guard.browser_tools_used_this_turn = progress_guard
                        .browser_tools_used_this_turn
                        .saturating_add(1);
                }
                if let Some(parsed) =
                    browser_loop_detector::parse_browser_tool_call(&call.name, &call.arguments)
                {
                    browser_tool_calls.push(parsed);
                    browser_tool_outputs.push(output.clone());
                }
                if tool_protocol::is_browser_tool_blocked_output(&output) {
                    progress_guard.browser_automation_paused = true;
                }
                if let Some(evidence_ref) = evidence_ref {
                    emit_context_trimmed(
                        session_id,
                        json!({
                            "reason": "tool_output_truncated_for_provider",
                            "evidenceRef": evidence_ref,
                        }),
                    );
                }
                let mut tool_message = json!({
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": content,
                });
                if !provider_replay_items.is_empty() {
                    tool_message["openaiResponsesShadow"] = Value::Bool(true);
                    let output_item =
                        openai_responses::function_call_output_item(&call.id, content.clone());
                    provider_replay_items.push(output_item.clone());
                    messages.push(output_item);
                }
                messages.push(tool_message.clone());
                provider_transcript.push(tool_message);
                if let Some(content) =
                    provider_image_message_from_tool_output(&output, &request.capabilities)
                {
                    let user_message = json!({
                        "role": "user",
                        "content": content,
                    });
                    messages.push(user_message.clone());
                    provider_transcript.push(user_message);
                }
            }
            crate::native_backend::turns::clear_active_ui_message_id(session_id, turn_id);
            emit_turn_state(
                session_id,
                turn_id,
                if request.capabilities.supports_streaming {
                    "streaming_model"
                } else {
                    "calling_model"
                },
                "tool_results_ready",
            );
            if plan_finalize_completed {
                return Ok(ModelLoopResult {
                    final_text: None,
                    metadata: Some(json!({
                        "planReview": {
                            "requested": true,
                            "stoppedAfterFinalize": true,
                        }
                    })),
                    provider_transcript,
                    provider_replay_items,
                    ui_text_committed: false,
                });
            }
        }

        // microCompact + MidTurn 压缩 — 在 model loop 中间减小 context。
        // 两级阈值：先 microCompact 清理旧工具结果（不调 LLM），
        // 如果 token 仍超限，MidTurn 用非损 checkpoint 替换旧消息（不调 LLM）。
        let current_tokens = estimate_messages_tokens(&messages);
        if current_tokens > MICRO_COMPACT_THRESHOLD {
            let cleared = micro_compact_messages(&mut messages, MICRO_COMPACT_KEEP_RECENT);
            if cleared > 0 {
                emit_context_trimmed(
                    session_id,
                    json!({
                        "reason": "micro_compact",
                        "clearedToolResults": cleared,
                        "tokensBefore": current_tokens,
                    }),
                );
            }
            if let Some((before, after)) = midturn_compact_messages(&mut messages) {
                emit_context_trimmed(
                    session_id,
                    json!({
                        "reason": "midturn_compress",
                        "tokensBefore": before,
                        "tokensAfter": after,
                    }),
                );
            }
        }

        if let Some(nudge) = progress_guard
            .browser_loop_detector
            .observe_browser_tools(&browser_tool_calls, &browser_tool_outputs)
        {
            messages.push(json!({
                "role": "system",
                "content": nudge,
            }));
        }
        if progress_guard.browser_automation_paused {
            messages.push(json!({
                "role": "system",
                "content": tool_protocol::BROWSER_BLOCKED_CORRECTIVE_PROMPT,
            }));
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
                    provider_transcript,
                    cancellation,
                    reason,
                    observed_occurrences,
                    commit_assistant_text,
                );
            }
        }
    }
}

pub(crate) fn synthesize_after_progress_guard(
    session_id: &str,
    turn_id: &str,
    request: &ModelRequest,
    mut messages: Vec<Value>,
    mut provider_transcript: Vec<Value>,
    cancellation: &Arc<AtomicBool>,
    reason: &str,
    observed_occurrences: usize,
    commit_assistant_text: bool,
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
    let clarification_tools = progress_guard_clarification_tools(request);
    let reply = call_model_once_for_loop(
        session_id,
        turn_id,
        &request.provider,
        &request.model,
        &messages,
        &clarification_tools,
        &request.capabilities,
        cancellation,
        commit_assistant_text,
    )?;
    if reply.tool_calls.is_empty() {
        return Ok(
            ModelLoopResult::final_text(reply.content.unwrap_or_default())
                .with_ui_text_committed(reply.ui_message_id.is_some())
                .with_provider_transcript(provider_transcript)
                .with_provider_replay_items(reply.provider_replay_items),
        );
    }
    if reply.tool_calls.len() != 1
        || reply
            .tool_calls
            .first()
            .is_none_or(|call| call.name != LYRA_CLARIFICATION_ASK_TOOL)
    {
        return Err(AgentRuntimeError::Core(
            "provider requested non-clarification tools during progress-guard synthesis"
                .to_string(),
        ));
    }
    let mut provider_replay_items = reply.provider_replay_items.clone();
    if !provider_replay_items.is_empty() {
        messages.extend(provider_replay_items.clone());
    }
    let tool_call = reply
        .tool_calls
        .first()
        .expect("checked clarification call")
        .clone();
    let assistant_content = reply.content.unwrap_or_default();
    let assistant_message = json!({
        "role": "assistant",
        "content": assistant_content,
        "tool_calls": [{
            "id": tool_call.id,
            "type": "function",
            "function": {
                "name": tool_call.name,
                "arguments": serde_json::to_string(&tool_call.arguments)
                    .unwrap_or_else(|_| "{}".to_string())
            }
        }],
    });
    messages.push(assistant_message.clone());
    provider_transcript.push(assistant_message);
    emit_turn_state(
        session_id,
        turn_id,
        "waiting_for_tool",
        "progress_guard_clarification_started",
    );
    let output = execute_model_tool_with_runtime(
        session_id,
        turn_id,
        &request.host_dispatcher,
        cancellation,
        ToolExecutionRuntime::from_model_capabilities(&request.capabilities),
        tool_call.clone(),
    );
    let (content, _) = guarded_tool_result_content(&output, 24_000);
    let tool_message = json!({
        "role": "tool",
        "tool_call_id": tool_call.id,
        "content": content,
    });
    messages.push(tool_message.clone());
    provider_transcript.push(tool_message);
    messages.push(json!({
        "role": "system",
        "content": "Member answered structured clarification. Produce final answer now from gathered evidence and member decision. Do not call more tools.",
    }));
    emit_turn_state(
        session_id,
        turn_id,
        if request.capabilities.supports_streaming {
            "streaming_model"
        } else {
            "calling_model"
        },
        "tool_progress_guard_after_clarification",
    );
    let no_tools = Vec::new();
    let final_reply = call_model_once_for_loop(
        session_id,
        turn_id,
        &request.provider,
        &request.model,
        &messages,
        &no_tools,
        &request.capabilities,
        cancellation,
        commit_assistant_text,
    )?;
    if !final_reply.tool_calls.is_empty() {
        return Err(AgentRuntimeError::Core(
            "provider requested tools after progress-guard clarification".to_string(),
        ));
    }
    provider_replay_items.extend(final_reply.provider_replay_items.clone());
    Ok(
        ModelLoopResult::final_text(final_reply.content.unwrap_or_default())
            .with_ui_text_committed(final_reply.ui_message_id.is_some())
            .with_provider_transcript(provider_transcript)
            .with_provider_replay_items(provider_replay_items),
    )
}

fn progress_guard_clarification_tools(request: &ModelRequest) -> Vec<Value> {
    if !request.capabilities.supports_tool_calling {
        return Vec::new();
    }
    request
        .tools
        .iter()
        .filter(|tool| {
            tool.pointer("/function/name").and_then(Value::as_str)
                == Some(LYRA_CLARIFICATION_ASK_TOOL)
        })
        .cloned()
        .collect()
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
    set_oma_execution_parent_status(session_id, "retrying");
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
    if is_provider_transport_error(error) {
        return false;
    }
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
}

/// Classify a `reqwest::Error` into a transport category using reqwest's typed
/// predicates — never its message text — so the category stays correct across
/// reqwest versions and wording changes.
fn classify_reqwest_transport(error: &reqwest::Error) -> ProviderTransportKind {
    if error.is_timeout() {
        ProviderTransportKind::Timeout
    } else if error.is_connect() {
        ProviderTransportKind::Connect
    } else if error.is_decode() || error.is_body() {
        ProviderTransportKind::StreamInterrupted
    } else {
        ProviderTransportKind::Other
    }
}

/// Build a typed transport error from a failed request. A `reqwest` send/read
/// failure is always a transport failure (HTTP error *responses* never fail
/// these calls — they are inspected via the status code instead).
fn reqwest_transport_error(error: reqwest::Error) -> AgentRuntimeError {
    AgentRuntimeError::ProviderTransport {
        kind: classify_reqwest_transport(&error),
        detail: error.to_string(),
    }
}

/// Classify a failure that occurs while reading lines from the streamed SSE
/// response body. Such a read fails mid-stream when the provider drops the
/// connection or the body transfer/decoding is interrupted; reqwest surfaces it
/// as an I/O error wrapping a `reqwest::Error`. Recover the typed reqwest
/// category when present; otherwise a body read failure is by construction a
/// stream interruption.
fn streaming_body_read_error(error: std::io::Error) -> AgentRuntimeError {
    let kind = error
        .get_ref()
        .and_then(|inner| inner.downcast_ref::<reqwest::Error>())
        .map(classify_reqwest_transport)
        .unwrap_or(ProviderTransportKind::StreamInterrupted);
    AgentRuntimeError::ProviderTransport {
        kind,
        detail: format!("provider streaming response body read failed: {error}"),
    }
}

/// A provider transport failure is identified by the typed error variant, not by
/// matching on the error's message text.
pub(crate) fn is_provider_transport_error(error: &AgentRuntimeError) -> bool {
    matches!(error, AgentRuntimeError::ProviderTransport { .. })
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
    commit_assistant_text: bool,
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
        commit_assistant_text,
    )
}

fn provider_response_error_text(
    provider: &NativeProviderProfile,
    status: reqwest::StatusCode,
    body_text: &str,
) -> AgentRuntimeError {
    providers::mimo_faults::provider_http_error_from_text(
        &provider.route_id,
        status.as_u16(),
        body_text,
    )
}

fn provider_body_preview(body_text: &str) -> String {
    const MAX_PREVIEW_CHARS: usize = 512;
    let compact = body_text.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= MAX_PREVIEW_CHARS {
        return compact;
    }
    let preview = compact.chars().take(MAX_PREVIEW_CHARS).collect::<String>();
    format!("{preview}...")
}

fn retry_after_milliseconds(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    headers
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
        .map(|seconds| seconds.saturating_mul(1_000))
}

fn provider_response_error_from_response(
    provider: &NativeProviderProfile,
    status: reqwest::StatusCode,
    response: reqwest::blocking::Response,
) -> AgentRuntimeError {
    let retry_after = retry_after_milliseconds(response.headers());
    let body = response
        .text()
        .unwrap_or_else(|error| format!("failed to read provider error body: {error}"));
    let error = provider_response_error_text(provider, status, &body);
    match retry_after {
        Some(milliseconds) => {
            AgentRuntimeError::Core(format!("{} [retry-after-ms:{milliseconds}]", error))
        }
        None => error,
    }
}

fn read_provider_json_body(
    provider: &NativeProviderProfile,
    status: reqwest::StatusCode,
    response: reqwest::blocking::Response,
) -> AgentRuntimeResult<Value> {
    let retry_after = retry_after_milliseconds(response.headers());
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("unknown")
        .to_string();
    let body_text = response.text().map_err(|error| AgentRuntimeError::ProviderTransport {
        kind: classify_reqwest_transport(&error),
        detail: format!(
            "failed to read provider response body for route `{}`: status {}, content-type {}, error: {}",
            provider.route_id,
            status.as_u16(),
            content_type,
            error
        ),
    })?;
    if !status.is_success() {
        let error = provider_response_error_text(provider, status, &body_text);
        return Err(match retry_after {
            Some(milliseconds) => {
                AgentRuntimeError::Core(format!("{} [retry-after-ms:{milliseconds}]", error))
            }
            None => error,
        });
    }
    serde_json::from_str::<Value>(&body_text).map_err(|error| {
        let preview = provider_body_preview(&body_text);
        AgentRuntimeError::Core(format!(
            "provider response JSON decode failed for route `{}`: status {}, content-type {}, error: {}; body preview: {}",
            provider.route_id,
            status.as_u16(),
            content_type,
            error,
            if preview.is_empty() { "<empty>" } else { preview.as_str() }
        ))
    })
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
        let mut stream_transport_retries: u8 = 0;
        let mut stream_fallback_attempted = false;
        let mut last_stream_transport_error: Option<AgentRuntimeError> = None;
        loop {
            let mut committed_any: Option<bool> = None;
            match scheduled_provider_request(session_id, provider, model, cancellation, || {
                call_model_once_streaming_inner(
                    session_id,
                    turn_id,
                    provider,
                    model,
                    messages,
                    tools,
                    cancellation,
                    commit_assistant_text,
                    &mut committed_any,
                )
            }) {
                Ok(reply) => return Ok(reply),
                Err(error) if is_empty_model_reply_error(&error) => break,
                Err(error) if is_provider_transport_error(&error) => {
                    // Safe to replay the whole streaming turn only when the
                    // route's parser confirms nothing was committed before the
                    // failure (`Some(false)`). `None` means the parser doesn't
                    // report commit state (dedicated protocols) and `Some(true)`
                    // means a partial assistant/tool delta already landed — both
                    // stay conservative: no replay, fail the turn (the original
                    // behavior), because replaying would duplicate or corrupt
                    // the committed timeline.
                    let safe_to_retry = committed_any == Some(false)
                        && stream_transport_retries < MAX_STREAM_TRANSPORT_RETRIES;
                    // Non-streaming fallback (Claude Code pattern): when the
                    // streaming turn failed and nothing was committed, retry the
                    // SAME turn non-streaming once. Non-streaming has no partial
                    // SSE state to corrupt, so it is safe as long as the stream
                    // didn't already commit an increment — `committed_any ==
                    // Some(true)` must never fall back (the non-streaming reply
                    // would re-emit the full assistant text, duplicating the
                    // committed delta).
                    //
                    // ponytail: Fix 5 — 但在流式场景中，committed_any=true 只可能
                    // 来自已提交的 assistant text 或已 emit 的 diff preview（tool
                    // call 在流结束后才 finalize，不会在流中完成）。清除已提交的
                    // draft 后，non-streaming fallback 可安全重新生成完整回复。
                    let can_fallback = if !stream_fallback_attempted && committed_any == Some(true)
                    {
                        clear_failed_assistant_draft(session_id, turn_id);
                        true
                    } else {
                        !stream_fallback_attempted && committed_any != Some(true)
                    };
                    emit_provider_protocol_event(
                        session_id,
                        turn_id,
                        json!({
                            "type": "stream_transport_error",
                            "routeId": provider.route_id,
                            "streaming": true,
                            "fallbackAttempted": !safe_to_retry && can_fallback,
                            "safeRetryAttempted": safe_to_retry,
                            "committedBefore": committed_any == Some(true),
                            "message": error.to_string(),
                        }),
                    );
                    if safe_to_retry {
                        stream_transport_retries += 1;
                        emit_provider_retry(
                            session_id,
                            turn_id,
                            "stream_transport_safe_retry",
                            stream_transport_retries,
                            "streaming transport failed before any committed increment; replaying the turn",
                        );
                        sleep_before_provider_retry(stream_transport_retries, cancellation)?;
                        continue;
                    }
                    if can_fallback {
                        stream_fallback_attempted = true;
                        last_stream_transport_error = Some(error);
                        emit_provider_retry(
                            session_id,
                            turn_id,
                            "stream_transport_fallback_to_non_streaming",
                            1,
                            "streaming transport failed; retrying the turn non-streaming",
                        );
                        sleep_before_provider_retry(MAX_STREAM_TRANSPORT_RETRIES, cancellation)?;
                        break; // fall through to the non-streaming path below
                    }
                    // Committed partial state — cannot replay or fall back.
                    // Finalize any tool left running so the next round doesn't
                    // see "[Tool did not finish ...]" for this aborted attempt.
                    let _finish_ok = finish_running_tools_for_failed_turn(session_id, turn_id);
                    eprintln!(
                        "[DEBUG committed path] finish_done={} committed_any={:?}",
                        _finish_ok, committed_any
                    );
                    return Err(AgentRuntimeError::Core(format!(
                        "provider streaming transport failed for route `{}`; non-streaming fallback was not attempted because replaying a partially-read SSE turn can duplicate or corrupt assistant/tool state: {}",
                        provider.route_id, error
                    )));
                }
                Err(error) => return Err(error),
            }
        }
        // Reached only via `break` (empty-reply or non-streaming fallback). For
        // the fallback case we must surface the original streaming transport
        // error if the non-streaming attempt also fails, instead of masking it.
        if stream_fallback_attempted {
            let mut reply = match scheduled_provider_request(
                session_id,
                provider,
                model,
                cancellation,
                || {
                    call_model_once_non_streaming_checked(
                        session_id,
                        turn_id,
                        provider,
                        model,
                        messages,
                        tools,
                        cancellation,
                    )
                },
            ) {
                Ok(reply) => reply,
                Err(non_streaming_error) => {
                    // Before failing the turn, finalize any tool left running by
                    // the aborted streaming attempt so it isn't reported to the
                    // next round as "[Tool did not finish ...]".
                    finish_running_tools_for_failed_turn(session_id, turn_id);
                    let streaming_error = last_stream_transport_error
                        .map(|e| e.to_string())
                        .unwrap_or_default();
                    return Err(AgentRuntimeError::Core(format!(
                        "provider streaming transport failed for route `{}` and non-streaming fallback also failed; streaming error: {}; non-streaming error: {}",
                        provider.route_id, streaming_error, non_streaming_error
                    )));
                }
            };
            normalize_model_reply_protocol(&mut reply, tools)?;
            if commit_assistant_text {
                crate::native_backend::turns::commit_visible_assistant_reply(
                    session_id, turn_id, &mut reply, &None,
                );
            }
            return Ok(reply);
        }
    }
    let mut reply = scheduled_provider_request(session_id, provider, model, cancellation, || {
        call_model_once_non_streaming_checked(
            session_id,
            turn_id,
            provider,
            model,
            messages,
            tools,
            cancellation,
        )
    })?;
    normalize_model_reply_protocol(&mut reply, tools)?;
    if commit_assistant_text {
        crate::native_backend::turns::commit_visible_assistant_reply(
            session_id, turn_id, &mut reply, &None,
        );
    }
    Ok(reply)
}

fn scheduled_provider_request(
    session_id: &str,
    provider: &NativeProviderProfile,
    model: &str,
    cancellation: &Arc<AtomicBool>,
    request: impl FnOnce() -> AgentRuntimeResult<ModelReply>,
) -> AgentRuntimeResult<ModelReply> {
    // An Oma worker stays queued until it owns a shared provider slot. Solo
    // sessions have no Oma parent, so these are intentional no-ops there.
    set_oma_execution_parent_status(session_id, "queued");
    let permit = acquire_provider_request_permit(provider, model, cancellation)?;
    set_oma_execution_parent_status(session_id, "running");
    let result = request();
    release_provider_request_permit(permit, &result);
    result
}

/// Finalize any tool still in `running` status for this turn as `failed`, so a
/// transport-aborted streaming attempt doesn't leak into the next round as
/// "[Tool did not finish; omitting output from provider context.]" — the
/// tool is reported as a clean failure instead. Best-effort: a state-lock
/// failure is swallowed because the caller is already on an error path.
/// Returns `true` if the state lock was acquired (regardless of whether any
/// tool was actually finalized).
fn finish_running_tools_for_failed_turn(session_id: &str, turn_id: &str) -> bool {
    let mut state = match crate::native_backend::state::state().lock() {
        Ok(state) => state,
        Err(_) => return false,
    };
    let Some(session) = state.sessions.get_mut(session_id) else {
        return true;
    };
    crate::native_backend::activity::finish_running_tools_for_turn(
        session,
        turn_id,
        "failed",
        json!({
            "error": "provider streaming transport failed before this tool could finish",
            "reason": "transport_failure",
        }),
    );
    true
}

fn call_model_once_non_streaming_checked(
    session_id: &str,
    turn_id: &str,
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    cancellation: &Arc<AtomicBool>,
) -> AgentRuntimeResult<ModelReply> {
    if cancellation.load(Ordering::SeqCst) || turn_was_cancelled(session_id, turn_id) {
        return Err(AgentRuntimeError::Core("turn cancelled".to_string()));
    }
    let reply = call_model_once_non_streaming(provider, model, messages, tools)?;
    if cancellation.load(Ordering::SeqCst) || turn_was_cancelled(session_id, turn_id) {
        return Err(AgentRuntimeError::Core("turn cancelled".to_string()));
    }
    Ok(reply)
}

pub(crate) fn call_model_once_non_streaming(
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
) -> AgentRuntimeResult<ModelReply> {
    if route_uses_openai_responses(provider)? {
        let response = build_openai_responses_request(provider, model, messages, tools, false)?
            .send()
            .map_err(reqwest_transport_error)?;
        let status = response.status();
        let body = read_provider_json_body(provider, status, response)?;
        let mut reply = openai_responses::parse_response_body(&body, tools)?;
        normalize_model_reply_protocol(&mut reply, tools)?;
        return Ok(reply);
    }
    if route_uses_anthropic_messages(provider)? {
        let response = build_anthropic_messages_request(provider, model, messages, tools, false)?
            .send()
            .map_err(reqwest_transport_error)?;
        let status = response.status();
        let body = read_provider_json_body(provider, status, response)?;
        let mut reply = anthropic_messages::parse_response_body(&body, tools)?;
        normalize_model_reply_protocol(&mut reply, tools)?;
        return Ok(reply);
    }
    if route_uses_gemini_generate_content(provider)? {
        let response =
            build_gemini_generate_content_request(provider, model, messages, tools, false)?
                .send()
                .map_err(reqwest_transport_error)?;
        let status = response.status();
        let body = read_provider_json_body(provider, status, response)?;
        let mut reply = gemini_generate_content::parse_response_body(&body, tools)?;
        normalize_model_reply_protocol(&mut reply, tools)?;
        return Ok(reply);
    }
    if route_uses_aws_bedrock_converse(provider)? {
        let response = build_aws_bedrock_converse_request(provider, model, messages, tools)?
            .send()
            .map_err(reqwest_transport_error)?;
        let status = response.status();
        let body = read_provider_json_body(provider, status, response)?;
        let mut reply = aws_bedrock_converse::parse_response_body(&body, tools)?;
        normalize_model_reply_protocol(&mut reply, tools)?;
        return Ok(reply);
    }
    if route_uses_ollama_chat(provider)? {
        let response = build_ollama_chat_request(provider, model, messages, tools, false)?
            .send()
            .map_err(reqwest_transport_error)?;
        let status = response.status();
        let body = read_provider_json_body(provider, status, response)?;
        let mut reply = ollama_chat::parse_response_body(&body, tools)?;
        normalize_model_reply_protocol(&mut reply, tools)?;
        return Ok(reply);
    }
    let response = build_openai_compatible_request(provider, model, messages, tools, false)?
        .send()
        .map_err(reqwest_transport_error)?;
    let status = response.status();
    let body = read_provider_json_body(provider, status, response)?;
    let message = body.pointer("/choices/0/message").ok_or_else(|| {
        AgentRuntimeError::Core("provider returned no assistant message".to_string())
    })?;
    // Strip inline <think>…</think> reasoning from non-streaming content too, so
    // reasoning models that lack a dedicated reasoning field don't leak it into
    // the visible message. Extracted reasoning is merged into the reasoning
    // channel. Only applied to the freshly-parsed provider response here — NOT to
    // content_to_plain_text, which also replays stored history.
    let raw_content = openai_chat::message_content(message.get("content"));
    let mut reasoning = openai_chat::message_reasoning_text(message);
    let content = raw_content.map(|text| {
        let scrubbed = openai_chat::scrub_think_blocks(&text);
        if !scrubbed.reasoning.trim().is_empty() {
            match reasoning.as_mut() {
                Some(existing) => existing.push_str(&scrubbed.reasoning),
                None => reasoning = Some(scrubbed.reasoning.clone()),
            }
        }
        scrubbed.visible
    });
    let allowed_tool_names = openai_chat::tool_name_set(tools);
    let tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| openai_chat::parse_tool_call(item, &allowed_tool_names))
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
    let stop_signal = TurnStopSignal::from_raw(
        body.pointer("/choices/0/finish_reason")
            .and_then(Value::as_str),
    );
    Ok(ModelReply {
        content,
        reasoning_content: reasoning,
        tool_calls,
        ui_message_id: None,
        provider_replay_items: Vec::new(),
        stop_signal,
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
    let mut committed_any: Option<bool> = None;
    call_model_once_streaming_inner(
        session_id,
        turn_id,
        provider,
        model,
        messages,
        tools,
        cancellation,
        true,
        &mut committed_any,
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
    committed_any: &mut Option<bool>,
) -> AgentRuntimeResult<ModelReply> {
    // Dedicated protocol parsers (responses/anthropic/gemini/ollama) don't
    // report per-stream commit state yet, so `committed_any` stays `None` for
    // them — the caller treats that as "not safe to replay" and fails the turn
    // (the existing conservative behavior). Only the OpenAI-compatible path
    // tracks commits and can opt in to safe transport retry.
    *committed_any = None;
    if route_uses_openai_responses(provider)? {
        let response = build_openai_responses_request(provider, model, messages, tools, true)?
            .send()
            .map_err(reqwest_transport_error)?;
        let status = response.status();
        if !status.is_success() {
            return Err(provider_response_error_from_response(
                provider, status, response,
            ));
        }
        let mut reply = openai_responses::parse_streaming_response(
            BufReader::new(response),
            session_id,
            turn_id,
            cancellation,
            tools,
            commit_assistant_text,
        )?;
        normalize_model_reply_protocol(&mut reply, tools)?;
        return Ok(reply);
    }
    if route_uses_anthropic_messages(provider)? {
        let response = build_anthropic_messages_request(provider, model, messages, tools, true)?
            .send()
            .map_err(reqwest_transport_error)?;
        let status = response.status();
        if !status.is_success() {
            return Err(provider_response_error_from_response(
                provider, status, response,
            ));
        }
        let mut reply = anthropic_messages::parse_streaming_response(
            BufReader::new(response),
            session_id,
            turn_id,
            cancellation,
            tools,
            commit_assistant_text,
        )?;
        normalize_model_reply_protocol(&mut reply, tools)?;
        return Ok(reply);
    }
    if route_uses_gemini_generate_content(provider)? {
        let response =
            build_gemini_generate_content_request(provider, model, messages, tools, true)?
                .send()
                .map_err(reqwest_transport_error)?;
        let status = response.status();
        if !status.is_success() {
            return Err(provider_response_error_from_response(
                provider, status, response,
            ));
        }
        let mut reply = gemini_generate_content::parse_streaming_response(
            BufReader::new(response),
            session_id,
            turn_id,
            cancellation,
            tools,
            commit_assistant_text,
        )?;
        normalize_model_reply_protocol(&mut reply, tools)?;
        return Ok(reply);
    }
    if route_uses_aws_bedrock_converse(provider)? {
        return Err(AgentRuntimeError::Core(
            "AWS Bedrock Converse streaming is not supported yet; mark this model as non-streaming"
                .to_string(),
        ));
    }
    if route_uses_ollama_chat(provider)? {
        let response = build_ollama_chat_request(provider, model, messages, tools, true)?
            .send()
            .map_err(reqwest_transport_error)?;
        let status = response.status();
        if !status.is_success() {
            return Err(provider_response_error_from_response(
                provider, status, response,
            ));
        }
        let mut reply = ollama_chat::parse_streaming_response(
            BufReader::new(response),
            session_id,
            turn_id,
            cancellation,
            tools,
            commit_assistant_text,
        )?;
        normalize_model_reply_protocol(&mut reply, tools)?;
        return Ok(reply);
    }
    // OpenAI-compatible path: track whether any increment was committed so the
    // caller can safely replay the turn if the transport fails before the first
    // committed delta. A pre-stream `.send()` failure leaves this at Some(false)
    // (set just below), which is the safe-to-retry case.
    *committed_any = Some(false);
    let response = build_openai_compatible_request(provider, model, messages, tools, true)?
        .send()
        .map_err(reqwest_transport_error)?;
    let status = response.status();
    if !status.is_success() {
        return Err(provider_response_error_from_response(
            provider, status, response,
        ));
    }
    let mut stream_committed = false;
    let result = parse_streaming_response_with_commit(
        BufReader::new(response),
        session_id,
        turn_id,
        cancellation,
        tools,
        commit_assistant_text,
        &mut stream_committed,
    );
    *committed_any = Some(stream_committed);
    result
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn parse_streaming_response<R: BufRead>(
    reader: R,
    session_id: &str,
    turn_id: &str,
    cancellation: &Arc<AtomicBool>,
    tools: &[Value],
) -> AgentRuntimeResult<ModelReply> {
    let mut committed_any = false;
    parse_streaming_response_with_commit(
        reader,
        session_id,
        turn_id,
        cancellation,
        tools,
        true,
        &mut committed_any,
    )
}

fn build_openai_compatible_request(
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    streaming: bool,
) -> AgentRuntimeResult<reqwest::blocking::RequestBuilder> {
    if providers::routes::mimo::is_mimo_route(&provider.route_id) {
        providers::routes::mimo::validate_thinking_replay(messages, model, tools)?;
    }
    let body = openai_chat::build_request_body(model, messages, tools, streaming);
    let client = provider_http_client_builder(streaming)
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let route = providers::registry::require_route(&provider.route_id)?;
    if let Some(route_hook) = providers::registry::hosted_openai_route_hook(&provider.route_id) {
        let url = providers::transport::http::endpoint_url(provider, route_hook.endpoint_path())?;
        let body = route_hook.decorate_request_body(body, provider, model)?;
        let request = route_hook.apply_request_headers(client.post(url), provider)?;
        return Ok(request.json(&body));
    }

    let url = providers::transport::http::chat_completions_url(provider)?;
    let request = apply_route_model_auth(client.post(url), provider, &route)?;
    Ok(request.json(&body))
}

fn apply_route_model_auth(
    builder: reqwest::blocking::RequestBuilder,
    provider: &NativeProviderProfile,
    route: &providers::types::ProviderRouteDescriptor,
) -> AgentRuntimeResult<reqwest::blocking::RequestBuilder> {
    if providers::transport::auth::resolve_api_key(provider).is_none()
        && route.auth_kind.contains("none")
    {
        return Ok(builder);
    }
    providers::transport::auth::apply_model_auth(builder, provider)
}

fn route_uses_openai_responses(provider: &NativeProviderProfile) -> AgentRuntimeResult<bool> {
    let route = providers::registry::require_route(&provider.route_id)?;
    Ok(route.protocol_id == openai_responses::PROTOCOL_ID)
}

fn route_uses_anthropic_messages(provider: &NativeProviderProfile) -> AgentRuntimeResult<bool> {
    let route = providers::registry::require_route(&provider.route_id)?;
    Ok(route.protocol_id == anthropic_messages::PROTOCOL_ID)
}

fn route_uses_gemini_generate_content(
    provider: &NativeProviderProfile,
) -> AgentRuntimeResult<bool> {
    let route = providers::registry::require_route(&provider.route_id)?;
    Ok(route.protocol_id == gemini_generate_content::PROTOCOL_ID)
}

fn route_uses_aws_bedrock_converse(provider: &NativeProviderProfile) -> AgentRuntimeResult<bool> {
    let route = providers::registry::require_route(&provider.route_id)?;
    Ok(route.protocol_id == aws_bedrock_converse::PROTOCOL_ID)
}

fn route_uses_ollama_chat(provider: &NativeProviderProfile) -> AgentRuntimeResult<bool> {
    let route = providers::registry::require_route(&provider.route_id)?;
    Ok(route.protocol_id == ollama_chat::PROTOCOL_ID)
}

fn build_openai_responses_request(
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    streaming: bool,
) -> AgentRuntimeResult<reqwest::blocking::RequestBuilder> {
    let body = openai_responses::build_request_body(
        model,
        messages,
        tools,
        streaming,
        openai_responses_request_options()?,
    )?;
    let client = provider_http_client_builder(streaming)
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let url = providers::transport::http::endpoint_url(provider, openai_responses::ENDPOINT_PATH)?;
    let request = providers::transport::auth::apply_model_auth(client.post(url), provider)?;
    Ok(request.json(&body))
}

fn build_anthropic_messages_request(
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    streaming: bool,
) -> AgentRuntimeResult<reqwest::blocking::RequestBuilder> {
    if providers::routes::mimo::is_mimo_route(&provider.route_id) {
        providers::routes::mimo::validate_thinking_replay(messages, model, tools)?;
    }
    let mut body = anthropic_messages::build_request_body(model, messages, tools, streaming)?;
    if providers::routes::mimo::is_anthropic_route(&provider.route_id) {
        let tool_calling = !tools.is_empty();
        providers::routes::mimo::apply_mimo_model_parameters(&mut body, model, tool_calling);
    }
    let client = provider_http_client_builder(streaming)
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let url =
        providers::transport::http::endpoint_url(provider, anthropic_messages::ENDPOINT_PATH)?;
    let request = anthropic_messages::apply_headers(client.post(url), provider)?;
    Ok(request.json(&body))
}

fn build_gemini_generate_content_request(
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    streaming: bool,
) -> AgentRuntimeResult<reqwest::blocking::RequestBuilder> {
    let body = gemini_generate_content::build_request_body(messages, tools)?;
    let client = provider_http_client_builder(streaming)
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let path = if streaming {
        gemini_generate_content::stream_generate_content_path(model)?
    } else {
        gemini_generate_content::generate_content_path(model)?
    };
    let url = providers::transport::http::endpoint_url(provider, &path)?;
    let request = gemini_generate_content::apply_headers(client.post(url), provider)?;
    Ok(request.json(&body))
}

fn build_aws_bedrock_converse_request(
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
) -> AgentRuntimeResult<reqwest::blocking::RequestBuilder> {
    let body = aws_bedrock_converse::build_request_body(messages, tools)?;
    let client = provider_http_client_builder(false)
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let path = aws_bedrock_converse::converse_path(model)?;
    let url = providers::transport::http::endpoint_url(provider, &path)?;
    aws_bedrock_converse::build_signed_json_request(&client, provider, &url, &body)
}

fn build_ollama_chat_request(
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    streaming: bool,
) -> AgentRuntimeResult<reqwest::blocking::RequestBuilder> {
    let body = ollama_chat::build_request_body(model, messages, tools, streaming)?;
    let client = provider_http_client_builder(streaming)
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let url = providers::transport::http::endpoint_url(provider, ollama_chat::CHAT_ENDPOINT_PATH)?;
    let request = ollama_chat::apply_headers(client.post(url), provider)?;
    Ok(request.json(&body))
}

fn openai_responses_request_options() -> AgentRuntimeResult<openai_responses::RequestOptions> {
    let state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let stateful_prompt_contract = crate::native_backend::turns::env_bool_override(
        "LYRA_OPENAI_RESPONSES_STATEFUL_PROMPT_CONTRACT",
    )
    .unwrap_or(state.config.openai_responses_stateful_prompt_contract);
    let previous_response_id = std::env::var("LYRA_OPENAI_RESPONSES_PREVIOUS_RESPONSE_ID")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    Ok(openai_responses::RequestOptions {
        reasoning_effort: state.config.reasoning_effort.clone(),
        verbosity: state.config.verbosity.clone(),
        service_tier: state.config.service_tier.clone(),
        stateful_prompt_contract,
        previous_response_id,
    })
}

fn parse_streaming_response_with_commit<R: BufRead>(
    reader: R,
    session_id: &str,
    turn_id: &str,
    cancellation: &Arc<AtomicBool>,
    tools: &[Value],
    commit_assistant_text: bool,
    committed_any: &mut bool,
) -> AgentRuntimeResult<ModelReply> {
    let mut state = ProviderStreamState::default();
    let mut ui_message_id: Option<String> = None;
    let mut delta_batcher = StreamDeltaBatcher::default();
    let buffer_assistant_text = false;
    let allowed_tool_names = openai_chat::tool_name_set(tools);
    let started_at = Instant::now();

    for line in reader.lines() {
        if cancellation.load(Ordering::SeqCst) || turn_was_cancelled(session_id, turn_id) {
            *committed_any = state.committed_any;
            return Err(AgentRuntimeError::Core("turn cancelled".to_string()));
        }
        if provider_streaming_total_deadline_exceeded(started_at) {
            *committed_any = state.committed_any;
            return Err(provider_streaming_total_timeout_error());
        }
        // A stall here (provider keeps the socket open but stops sending) is
        // bounded by the client's per-operation idle timeout configured in
        // `provider_http_client_builder`; it surfaces as a `reqwest::Error` whose
        // `is_timeout()` is true, classified below into a typed transport Timeout
        // that the caller's safe-retry / non-streaming fallback can recover from.
        let line = line.map_err(|error| {
            *committed_any = state.committed_any;
            streaming_body_read_error(error)
        })?;
        let Some(event) = openai_chat::parse_sse_line(&line)? else {
            continue;
        };
        let openai_chat::SseEvent::Data(value) = event else {
            break;
        };
        if let Some(error) = value.get("error") {
            *committed_any = state.committed_any;
            return Err(AgentRuntimeError::Core(format!(
                "provider streaming error: {error}"
            )));
        }
        if let Err(error) = map_provider_stream_chunk(
            &value,
            &mut state,
            &mut ui_message_id,
            &mut delta_batcher,
            buffer_assistant_text,
            session_id,
            turn_id,
        ) {
            *committed_any = state.committed_any;
            return Err(error);
        }
    }
    // From here on every remaining failure (finalize/normalize/commit) happens
    // after all streaming increments have been applied, so the committed flag is
    // final for the rest of the function.
    *committed_any = state.committed_any;

    // Flush any held-back partial tag the scrubber kept across the final delta.
    // If it turned out not to be a real tag it surfaces as visible text; trailing
    // in-block reasoning is routed to the reasoning channel.
    let flushed = state.think_scrubber.flush();
    if !flushed.reasoning.is_empty() {
        state.reasoning_chars = state
            .reasoning_chars
            .saturating_add(flushed.reasoning.chars().count());
        state.reasoning_content.push_str(&flushed.reasoning);
        if delta_batcher.push_reasoning(
            &flushed.reasoning,
            &mut ui_message_id,
            session_id,
            turn_id,
        )? {
            state.committed_any = true;
        }
    }
    if !flushed.visible.is_empty() {
        if !buffer_assistant_text {
            if delta_batcher.push_visible(
                &flushed.visible,
                &mut ui_message_id,
                session_id,
                turn_id,
            )? {
                state.committed_any = true;
            }
        }
        state.content.push_str(&flushed.visible);
    }
    if delta_batcher.flush(&mut ui_message_id, session_id, turn_id)? {
        state.committed_any = true;
    }
    *committed_any = state.committed_any;

    let mut tool_calls =
        openai_chat::finalize_streaming_tool_calls(state.tool_calls, &allowed_tool_names)?;
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

    let streamed_message_id = ui_message_id.filter(|id| !id.is_empty());
    let stop_signal = TurnStopSignal::from_raw(state.finish_reason.as_deref());
    let mut reply = ModelReply {
        content: (!state.content.trim().is_empty()).then_some(state.content),
        reasoning_content: (!state.reasoning_content.trim().is_empty())
            .then_some(state.reasoning_content),
        tool_calls,
        ui_message_id: streamed_message_id.clone(),
        provider_replay_items: Vec::new(),
        stop_signal,
    };
    normalize_model_reply_protocol(&mut reply, tools)?;
    if commit_assistant_text {
        crate::native_backend::turns::commit_visible_assistant_reply(
            session_id,
            turn_id,
            &mut reply,
            &streamed_message_id,
        );
    } else {
        reply.ui_message_id = streamed_message_id;
    }
    Ok(reply)
}

pub(crate) fn provider_streaming_total_deadline_exceeded(started_at: Instant) -> bool {
    started_at.elapsed() > streaming_total_timeout()
}

pub(crate) fn provider_streaming_total_timeout_error() -> AgentRuntimeError {
    AgentRuntimeError::ProviderTransport {
        kind: ProviderTransportKind::Timeout,
        detail: format!(
            "provider streaming response exceeded total deadline of {} seconds",
            streaming_total_timeout().as_secs()
        ),
    }
}

pub(crate) fn map_provider_stream_chunk(
    value: &Value,
    state: &mut ProviderStreamState,
    ui_message_id: &mut Option<String>,
    delta_batcher: &mut StreamDeltaBatcher,
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
    if let Some(raw_text) = openai_chat::message_content(delta.get("content"))
        && !raw_text.is_empty()
    {
        // Strip inline <think>…</think> reasoning before it can reach the visible
        // message. Reasoning-model providers (DeepSeek/Qwen/MiniMax/Kimi) inline
        // reasoning into `content`; without this it leaks into the chat and also
        // poisons the missing-tool-call heuristic downstream. The scrubber is
        // stateful so a tag split across stream chunks is handled correctly.
        let scrubbed = state.think_scrubber.feed(&raw_text);
        if !scrubbed.reasoning.is_empty() {
            state.reasoning_chars = state
                .reasoning_chars
                .saturating_add(scrubbed.reasoning.chars().count());
            state.reasoning_content.push_str(&scrubbed.reasoning);
            if delta_batcher.push_reasoning(
                &scrubbed.reasoning,
                ui_message_id,
                session_id,
                turn_id,
            )? {
                state.committed_any = true;
            }
        }
        if !scrubbed.visible.is_empty() {
            let candidate = format!("{}{}", state.content, scrubbed.visible);
            if contains_leaked_internal_protocol_markers(&candidate) {
                return Err(AgentRuntimeError::Core(
                    "provider emitted textual tool protocol leak instead of a structured Lyra tool call"
                        .to_string(),
                ));
            }
            if !buffer_assistant_text {
                if delta_batcher.push_visible(
                    &scrubbed.visible,
                    ui_message_id,
                    session_id,
                    turn_id,
                )? {
                    state.committed_any = true;
                }
            }
            state.content.push_str(&scrubbed.visible);
        }
    }
    if let Some(reasoning) = openai_chat::message_reasoning_text(delta) {
        state.reasoning_chars = state
            .reasoning_chars
            .saturating_add(reasoning.chars().count());
        state.reasoning_content.push_str(&reasoning);
        if delta_batcher.push_reasoning(&reasoning, ui_message_id, session_id, turn_id)? {
            state.committed_any = true;
        }
    }
    if let Some(chunks) = delta.get("tool_calls").and_then(Value::as_array) {
        if delta_batcher.flush(ui_message_id, session_id, turn_id)? {
            state.committed_any = true;
        }
        for chunk in chunks {
            let index = chunk.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            let accumulator = state.tool_calls.entry(index).or_default();
            if let Some(id) = chunk.get("id").and_then(Value::as_str)
                && openai_chat::is_valid_tool_call_id(id)
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
        let preview_emitted =
            crate::native_backend::tools::maybe_emit_streaming_diff_previews_from_accumulators(
                session_id,
                turn_id,
                &state.tool_calls,
            );
        // A streaming tool-call preview mutates session state (records a
        // preview activity), so a later transport failure is no longer safely
        // retryable. Only mark committed when a preview was actually emitted;
        // a throttled or skipped preview does not block safe retry / fallback.
        if preview_emitted {
            state.committed_any = true;
        }
    }
    Ok(())
}

pub(crate) fn normalize_model_reply_protocol(
    reply: &mut ModelReply,
    tools: &[Value],
) -> AgentRuntimeResult<()> {
    let allowed_tool_names = openai_chat::tool_name_set(tools);
    for call in &mut reply.tool_calls {
        if let Some(name) = openai_chat::repair_tool_name(&call.name, &allowed_tool_names) {
            call.name = name;
        }
    }
    let Some(content) = reply.content.take() else {
        if reply.tool_calls.is_empty() && should_retry_missing_tool_call(None, tools, true) {
            return Err(AgentRuntimeError::Core(
                "assistant promised tool use without structured tool_call".to_string(),
            ));
        }
        return Ok(());
    };
    if contains_leaked_internal_protocol_markers(&content) {
        return Err(AgentRuntimeError::Core(
            "provider emitted textual tool protocol leak instead of a structured Lyra tool call"
                .to_string(),
        ));
    }
    if contains_textual_tool_call_marker(&content, &allowed_tool_names) {
        return Err(AgentRuntimeError::Core(
            "provider emitted textual tool-call syntax instead of a structured Lyra tool call"
                .to_string(),
        ));
    }
    tool_protocol::validate_visible_assistant_text_protocol(&content)?;
    let sanitized = if reply.stop_signal == TurnStopSignal::MaxTokens {
        tool_protocol::sanitize_truncated_assistant_text(&content)
    } else {
        sanitize_visible_assistant_text(&content)
    };
    if reply.tool_calls.is_empty()
        && should_retry_missing_tool_call(sanitized.as_deref(), tools, true)
    {
        return Err(AgentRuntimeError::Core(
            "assistant promised tool use without structured tool_call".to_string(),
        ));
    }
    reply.content = sanitized;
    if reply.tool_calls.is_empty()
        && reply
            .content
            .as_ref()
            .is_none_or(|value| value.trim().is_empty())
    {
        return Err(AgentRuntimeError::Core(
            "provider returned no assistant text or tool call".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn normalize_visible_assistant_text(content: &str) -> Option<String> {
    sanitize_visible_assistant_text(content)
}

pub(crate) fn contains_textual_tool_call_marker(
    content: &str,
    allowed_tool_names: &HashSet<String>,
) -> bool {
    contains_textual_structured_tool_shape(content, allowed_tool_names)
}

fn clear_failed_assistant_draft(session_id: &str, turn_id: &str) {
    if let Some(message_id) = active_ui_message_id(session_id, turn_id) {
        let _ = remove_assistant_message(session_id, &message_id);
    }
    clear_active_ui_message_id(session_id, turn_id);
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
    names.insert(LYRA_SESSION_READ_MESSAGE_TOOL.to_string());
    names
}

pub(crate) fn find_ascii_case_insensitive(
    haystack: &str,
    needle: &str,
    from: usize,
) -> Option<usize> {
    crate::native_backend::tool_protocol::find_ascii_case_insensitive(haystack, needle, from)
}

pub(crate) fn model_capabilities(
    provider: &NativeProviderProfile,
    model: &str,
) -> ModelCapabilityProfile {
    let profile = provider
        .models
        .iter()
        .find(|candidate| candidate.id == model);
    if let Some(profile) = profile {
        return ModelCapabilityProfile {
            supports_image_input: profile.supports_image_input,
            supports_tool_calling: profile.supports_tool_calling,
            supports_streaming: profile.supports_streaming,
            context_window: profile.context_window,
        };
    }
    let route = providers::registry::require_route(&provider.route_id).ok();
    let discovered = providers::model_capabilities::discovered_model(
        model.to_string(),
        Some(model.to_string()),
        None,
        route.as_ref(),
    );
    ModelCapabilityProfile {
        supports_image_input: discovered.supports_image_input,
        supports_tool_calling: discovered.supports_tool_calling,
        supports_streaming: discovered.supports_streaming,
        context_window: discovered.context_window,
    }
}

fn observe_successful_provider_capabilities(
    session_id: &str,
    request: &ModelRequest,
    messages: &[Value],
    reply: &ModelReply,
) {
    if providers::model_capabilities::messages_contain_provider_images(messages) {
        let _ = providers::model_capabilities::record_observed_model_capability(
            session_id,
            &request.provider.id,
            &request.model,
            providers::model_capabilities::ObservedCapability::ImageInput,
            true,
            "provider_request_with_images_succeeded",
        );
    }
    if !request.tools.is_empty() && !reply.tool_calls.is_empty() {
        let _ = providers::model_capabilities::record_observed_model_capability(
            session_id,
            &request.provider.id,
            &request.model,
            providers::model_capabilities::ObservedCapability::ToolCalling,
            true,
            "provider_returned_tool_calls",
        );
    }
    if request.capabilities.supports_streaming {
        let _ = providers::model_capabilities::record_observed_model_capability(
            session_id,
            &request.provider.id,
            &request.model,
            providers::model_capabilities::ObservedCapability::Streaming,
            true,
            "provider_streaming_request_succeeded",
        );
    }
}

#[cfg(test)]
mod stop_signal_tests {
    use super::*;

    #[test]
    fn maps_openai_finish_reasons() {
        assert_eq!(
            TurnStopSignal::from_raw(Some("tool_calls")),
            TurnStopSignal::ToolUse
        );
        assert_eq!(
            TurnStopSignal::from_raw(Some("stop")),
            TurnStopSignal::EndTurn
        );
        assert_eq!(
            TurnStopSignal::from_raw(Some("length")),
            TurnStopSignal::MaxTokens
        );
        assert_eq!(
            TurnStopSignal::from_raw(Some("max_output_tokens")),
            TurnStopSignal::MaxTokens
        );
    }

    #[test]
    fn maps_anthropic_and_bedrock_stop_reasons() {
        assert_eq!(
            TurnStopSignal::from_raw(Some("tool_use")),
            TurnStopSignal::ToolUse
        );
        assert_eq!(
            TurnStopSignal::from_raw(Some("end_turn")),
            TurnStopSignal::EndTurn
        );
        assert_eq!(
            TurnStopSignal::from_raw(Some("max_tokens")),
            TurnStopSignal::MaxTokens
        );
    }

    #[test]
    fn is_case_insensitive_and_trims() {
        // Gemini reports uppercase STOP.
        assert_eq!(
            TurnStopSignal::from_raw(Some(" STOP ")),
            TurnStopSignal::EndTurn
        );
        assert_eq!(
            TurnStopSignal::from_raw(Some("Tool_Use")),
            TurnStopSignal::ToolUse
        );
    }

    #[test]
    fn unknown_or_missing_is_unknown() {
        assert_eq!(TurnStopSignal::from_raw(None), TurnStopSignal::Unknown);
        assert_eq!(TurnStopSignal::from_raw(Some("")), TurnStopSignal::Unknown);
        assert_eq!(
            TurnStopSignal::from_raw(Some("content_filter")),
            TurnStopSignal::Unknown
        );
    }

    #[test]
    fn default_is_unknown() {
        assert_eq!(TurnStopSignal::default(), TurnStopSignal::Unknown);
    }

    #[test]
    fn preserves_numeric_retry_after_for_the_shared_scheduler() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::RETRY_AFTER,
            "3".parse().expect("header value"),
        );
        assert_eq!(retry_after_milliseconds(&headers), Some(3_000));
        assert_eq!(
            retry_after_from_error(&AgentRuntimeError::Core(
                "provider rate limited [retry-after-ms:3000]".to_string()
            )),
            Some(Duration::from_millis(3_000))
        );
    }
}
