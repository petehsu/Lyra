use super::*;

static REJECTED_PROMPT_CACHE_PROFILES: OnceLock<StdMutex<HashSet<String>>> = OnceLock::new();

pub(crate) fn rejected_prompt_cache_profiles() -> &'static StdMutex<HashSet<String>> {
    REJECTED_PROMPT_CACHE_PROFILES.get_or_init(|| StdMutex::new(HashSet::new()))
}

pub(crate) fn prompt_cache_profile_key(provider_id: &str, route_id: &str, model: &str) -> String {
    format!("{provider_id}\u{1f}{route_id}\u{1f}{model}")
}

pub(crate) fn mark_prompt_cache_rejected(provider: &NativeProviderProfile, model: &str) {
    if let Ok(mut profiles) = rejected_prompt_cache_profiles().lock() {
        profiles.insert(prompt_cache_profile_key(
            &provider.id,
            &provider.route_id,
            model,
        ));
    }
}

pub(crate) fn stateful_responses_enabled(messages: &[Value]) -> bool {
    lyra_request_context(messages)
        .and_then(|context| context.pointer("/stateful/enabled"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

pub(crate) fn advance_stateful_responses(
    messages: &mut [Value],
    response_id: Option<&str>,
    input_start: usize,
) {
    if !stateful_responses_enabled(messages) {
        return;
    }
    let Some(context) = messages
        .first_mut()
        .and_then(|message| message.get_mut("lyraRequestContext"))
    else {
        return;
    };
    context["stateful"]["previousResponseId"] = response_id
        .map(|value| Value::String(value.to_string()))
        .unwrap_or(Value::Null);
    context["stateful"]["inputStart"] = if response_id.is_some() {
        json!(input_start)
    } else {
        json!(0)
    };
}

pub(crate) fn reset_stateful_responses(messages: &mut [Value]) {
    let Some(context) = messages
        .first_mut()
        .and_then(|message| message.get_mut("lyraRequestContext"))
    else {
        return;
    };
    context["stateful"]["previousResponseId"] = Value::Null;
    context["stateful"]["inputStart"] = json!(0);
}

pub(crate) fn disable_stateful_responses(messages: &mut [Value]) {
    let Some(context) = messages
        .first_mut()
        .and_then(|message| message.get_mut("lyraRequestContext"))
    else {
        return;
    };
    context["stateful"]["enabled"] = json!(false);
    context["stateful"]["previousResponseId"] = Value::Null;
    context["stateful"]["inputStart"] = json!(0);
}

pub(crate) fn disable_prompt_cache(messages: &mut [Value]) {
    let Some(context) = messages
        .first_mut()
        .and_then(|message| message.get_mut("lyraRequestContext"))
    else {
        return;
    };
    context["promptCacheEnabled"] = json!(false);
    context["openaiExplicitPromptCache"] = json!(false);
    context["anthropicPromptCache"] = json!(false);
    context["bedrockPromptCache"] = json!(false);
}

pub(crate) fn retained_provider_replay_items(
    items: &[Value],
    tool_calls: &[ModelToolCall],
) -> Vec<Value> {
    items
        .iter()
        .filter(|item| {
            let Some(kind @ ("function_call" | "function_call_output")) =
                item.get("type").and_then(Value::as_str)
            else {
                return true;
            };
            let id = if kind == "function_call" {
                item.get("call_id").or_else(|| item.get("id"))
            } else {
                item.get("call_id")
            }
            .and_then(Value::as_str);
            id.is_some_and(|id| tool_calls.iter().any(|call| call.id == id))
        })
        .cloned()
        .collect()
}

pub(crate) fn append_provider_context_update(
    messages: &mut Vec<Value>,
    provider_transcript: &mut Vec<Value>,
    kind: &str,
    content: impl AsRef<str>,
) {
    let content = content.as_ref().trim().replace("</", "&lt;/");
    let message = json!({
        "role": "user",
        "content": format!(
            "<lyra-context-update version=\"1\" trusted=\"true\" kind=\"{kind}\">\n{}\n</lyra-context-update>",
            content
        ),
        "lyraInternalContext": true,
    });
    messages.push(message.clone());
    provider_transcript.push(message);
}

/// Retry-only instruction. It may affect the next physical request, but must
/// never become durable provider history or poison future prompt-cache tails.
pub(crate) fn append_attempt_local_context_update(
    messages: &mut Vec<Value>,
    overlay_start: &mut Option<usize>,
    kind: &str,
    content: impl AsRef<str>,
) {
    begin_attempt_local_overlay(messages, overlay_start);
    let content = content.as_ref().trim().replace("</", "&lt;/");
    messages.push(json!({
        "role": "user",
        "content": format!(
            "<lyra-attempt-recovery version=\"1\" trusted=\"true\" kind=\"{kind}\">\n{}\n</lyra-attempt-recovery>",
            content
        ),
        "lyraInternalContext": true,
        "lyraAttemptLocal": true,
    }));
}

pub(crate) fn begin_attempt_local_overlay(messages: &[Value], overlay_start: &mut Option<usize>) {
    overlay_start.get_or_insert(messages.len());
}

pub(crate) fn clear_attempt_local_overlay(
    messages: &mut Vec<Value>,
    overlay_start: &mut Option<usize>,
) {
    if let Some(start) = overlay_start.take() {
        messages.truncate(start.min(messages.len()));
    }
}

pub(crate) fn rejected_provider_parameter(
    error: &AgentRuntimeError,
    parameters: &[&'static str],
) -> Option<&'static str> {
    let AgentRuntimeError::ProviderFailure { failure } = error else {
        return None;
    };
    if !matches!(failure.http_status, Some(400 | 404 | 422)) {
        return None;
    }
    let body = failure
        .body_preview
        .as_deref()
        .and_then(|body| serde_json::from_str::<Value>(body).ok())?;
    let rejected_parameter = [
        body.pointer("/error/param"),
        body.pointer("/error/parameter"),
        body.get("param"),
        body.get("parameter"),
    ]
    .into_iter()
    .flatten()
    .find_map(Value::as_str)?
    .trim()
    .to_ascii_lowercase();
    parameters.iter().copied().find(|parameter| {
        rejected_parameter == *parameter
            || rejected_parameter
                .strip_prefix(parameter)
                .is_some_and(|suffix| suffix.starts_with('.') || suffix.starts_with('['))
    })
}

pub(crate) fn model_loop_observation_metadata(
    observations: &ModelLoopObservations,
    messages: &[Value],
    include_openai_state: bool,
) -> Value {
    let mut metadata = json!({
        "providerUsage": observations.usage.as_json(),
    });
    if !observations.warnings.is_empty() {
        metadata["providerWarnings"] = Value::Array(observations.warnings.clone());
    }
    if include_openai_state
        && stateful_responses_enabled(messages)
        && let (Some(context), Some(response_id)) = (
            lyra_request_context(messages),
            observations.latest_response_id.as_deref(),
        )
    {
        metadata["openaiResponsesState"] = json!({
            "responseId": response_id,
            "providerId": context.get("providerId").cloned().unwrap_or(Value::Null),
            "routeId": context.get("routeId").cloned().unwrap_or(Value::Null),
            "model": context.get("model").cloned().unwrap_or(Value::Null),
            "contextEpoch": context.get("contextEpoch").cloned().unwrap_or(Value::Null),
            "store": true,
        });
    }
    metadata
}

pub(crate) fn with_model_loop_observations(
    result: ModelLoopResult,
    observations: &ModelLoopObservations,
    messages: &[Value],
    include_openai_state: bool,
) -> ModelLoopResult {
    result.with_merged_metadata(model_loop_observation_metadata(
        observations,
        messages,
        include_openai_state,
    ))
}

pub(crate) fn checkpoint_model_loop_observations(
    session_id: &str,
    turn_id: &str,
    observations: &ModelLoopObservations,
    messages: &[Value],
) {
    super::session_runtime::record_turn_provider_metadata(
        session_id,
        turn_id,
        model_loop_observation_metadata(observations, messages, false),
    );
}
