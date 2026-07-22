use super::*;

const MAX_INTERACT_ACTIONS: usize = 12;

pub(crate) async fn execute_browser_interact_tool_adapter(
    session_id: &str,
    turn_id: &str,
    dispatcher: &Option<Arc<HostCapabilityDispatcher>>,
    cancellation: &CancellationToken,
    runtime: ToolExecutionRuntime,
    tool_call_id: &str,
    arguments: Value,
    started_at: &str,
) -> Value {
    let input = strip_tool_fs_metadata(arguments);
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            tool_call_id,
            "browser",
            "Browser interact",
            "running",
            input.clone(),
            None,
            started_at,
            None,
        ),
        "toolStarted",
    );
    if cancellation.is_cancelled() {
        return finish_browser_interact(
            session_id,
            turn_id,
            tool_call_id,
            input,
            started_at,
            json!({
                "content": "Lyra browser interact was cancelled before execution.",
                "cancelled": true,
            }),
        );
    }
    let Some(dispatcher) = dispatcher.as_ref() else {
        return finish_browser_interact(
            session_id,
            turn_id,
            tool_call_id,
            input,
            started_at,
            tool_failure_output(
                "host_unavailable",
                "Lyra host capability bridge is not available for browser interact.",
                "Open the Workbench Browser surface and retry browser interact.",
                None,
            ),
        );
    };

    match run_browser_interact(
        session_id,
        turn_id,
        dispatcher,
        cancellation,
        runtime,
        tool_call_id,
        &input,
    )
    .await
    {
        Ok(output) => {
            finish_browser_interact(session_id, turn_id, tool_call_id, input, started_at, output)
        }
        Err(failure) => finish_browser_interact(
            session_id,
            turn_id,
            tool_call_id,
            input,
            started_at,
            tool_failure_output(
                &failure.code,
                &failure.message,
                failure.recommended_next_action.as_deref().unwrap_or(
                    "Retry with fewer actions or split navigate/wait/read into separate tools.",
                ),
                failure.detail,
            ),
        ),
    }
}

#[derive(Clone, Debug)]
struct InteractFailure {
    code: String,
    message: String,
    recommended_next_action: Option<String>,
    detail: Option<Value>,
}

fn finish_browser_interact(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: Value,
    started_at: &str,
    output: Value,
) -> Value {
    let status = if output.get("cancelled").and_then(Value::as_bool) == Some(true) {
        "cancelled"
    } else if output.get("error").is_some() {
        "failed"
    } else {
        "completed"
    };
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            tool_call_id,
            "browser",
            "Browser interact",
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

async fn run_browser_interact(
    session_id: &str,
    turn_id: &str,
    dispatcher: &Arc<HostCapabilityDispatcher>,
    cancellation: &CancellationToken,
    runtime: ToolExecutionRuntime,
    tool_call_id: &str,
    input: &Value,
) -> Result<Value, InteractFailure> {
    let actions = input
        .get("actions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if actions.is_empty() {
        return Err(InteractFailure {
            code: "missing_actions".to_string(),
            message: "browser interact requires a non-empty actions array".to_string(),
            recommended_next_action: Some(
                "Provide actions like navigate, wait, click, scroll, type, then extract."
                    .to_string(),
            ),
            detail: None,
        });
    }
    if actions.len() > MAX_INTERACT_ACTIONS {
        return Err(InteractFailure {
            code: "too_many_actions".to_string(),
            message: format!("browser interact supports at most {MAX_INTERACT_ACTIONS} actions"),
            recommended_next_action: Some(
                "Split into multiple interact calls or use workflow replay for long flows."
                    .to_string(),
            ),
            detail: None,
        });
    }

    let shared = shared_interact_context(input);
    let extract = value_string(input, "extract")
        .unwrap_or_else(|| "read".to_string())
        .to_ascii_lowercase();
    let baseline_snapshot_id = value_string(input, "baselineSnapshotId");

    let mut action_trace = Vec::new();
    for (index, action) in actions.iter().enumerate() {
        if cancellation.is_cancelled() {
            return Ok(json!({
                "content": format!("Browser interact cancelled after {} action(s).", index),
                "cancelled": true,
                "actionTrace": action_trace,
            }));
        }
        let step = execute_interact_action(
            session_id,
            turn_id,
            dispatcher,
            cancellation,
            runtime,
            &format!("{tool_call_id}-step-{index}"),
            &shared,
            action,
        )
        .await?;
        let failed = step.get("ok").and_then(Value::as_bool) == Some(false);
        action_trace.push(step.clone());
        if failed {
            return Ok(json!({
                "content": format!(
                    "Browser interact stopped at action {} ({})",
                    index + 1,
                    step.get("kind").and_then(Value::as_str).unwrap_or("unknown")
                ),
                "ok": false,
                "failedAt": index,
                "actionTrace": action_trace,
                "recommendedNextAction": step.get("recommendedNextAction").cloned().unwrap_or(Value::Null),
            }));
        }
    }

    let mut extract_results = Map::new();
    if matches!(extract.as_str(), "read" | "both") {
        let read = execute_interact_action(
            session_id,
            turn_id,
            dispatcher,
            cancellation,
            runtime,
            &format!("{tool_call_id}-extract-read"),
            &shared,
            &json!({ "kind": "read" }),
        )
        .await?;
        extract_results.insert("read".to_string(), read);
    }
    if matches!(extract.as_str(), "map" | "both") {
        let map = execute_interact_action(
            session_id,
            turn_id,
            dispatcher,
            cancellation,
            runtime,
            &format!("{tool_call_id}-extract-map"),
            &shared,
            &json!({ "kind": "map" }),
        )
        .await?;
        extract_results.insert("map".to_string(), map);
    }

    let primary_extract = extract_results
        .get("read")
        .or_else(|| extract_results.get("map"))
        .cloned()
        .unwrap_or(Value::Null);
    let snapshot = capture_page_snapshot(session_id, &primary_extract, Some("interact"));
    let snapshot_diff = baseline_snapshot_id.as_deref().and_then(|baseline| {
        snapshot
            .as_ref()
            .and_then(|current| diff_page_snapshots(baseline, current))
    });

    let content = interact_content(&action_trace, snapshot.as_ref(), snapshot_diff.as_ref());
    Ok(json!({
        "content": content,
        "ok": true,
        "extract": extract,
        "actionTrace": action_trace,
        "extractResults": Value::Object(extract_results),
        "pageSnapshot": snapshot,
        "pageSnapshotDiff": snapshot_diff,
        "recommendedPlaybook": "navigate → wait → map → act/type → read",
        "recommendedNextAction": if snapshot_diff.as_ref().is_some_and(|diff| !diff.changed) {
            "Page may be unchanged; verify with map/read or a stronger wait before retrying the same action."
        } else {
            "Use extractResults.read/map targetRefs for the next act/type step, or call browser.judge_task before declaring completion."
        },
    }))
}

fn shared_interact_context(input: &Value) -> Map<String, Value> {
    let mut shared = Map::new();
    for key in [
        "tabId",
        "targetMode",
        "workflowId",
        "cacheMode",
        "authState",
        "useLiveLoginState",
        "browserMode",
        "query",
        "includeShadowDom",
        "includeIframes",
    ] {
        if let Some(value) = input.get(key) {
            shared.insert(key.to_string(), value.clone());
        }
    }
    shared
}

async fn execute_interact_action(
    session_id: &str,
    turn_id: &str,
    dispatcher: &Arc<HostCapabilityDispatcher>,
    cancellation: &CancellationToken,
    runtime: ToolExecutionRuntime,
    tool_call_id: &str,
    shared: &Map<String, Value>,
    action: &Value,
) -> Result<Value, InteractFailure> {
    if cancellation.is_cancelled() {
        return Ok(json!({ "ok": false, "cancelled": true }));
    }
    let kind = action
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    let (host_method, host_action) = interact_host_mapping(&kind)?;
    let mut payload = Map::new();
    for (key, value) in shared {
        payload.insert(key.clone(), value.clone());
    }
    if let Some(object) = action.as_object() {
        for (key, value) in object {
            if key != "kind" {
                payload.insert(key.clone(), value.clone());
            }
        }
    }
    match kind.as_str() {
        "click" => {
            payload
                .entry("interaction".to_string())
                .or_insert_with(|| Value::String("click".to_string()));
        }
        "hover" => {
            payload.insert(
                "interaction".to_string(),
                Value::String("hover".to_string()),
            );
        }
        "type" if !payload.contains_key("text") => {
            if let Some(value) = action.get("value").cloned() {
                payload.insert("text".to_string(), value);
            }
        }
        _ => {}
    }
    let _timeout_ms = action
        .get("timeoutMs")
        .and_then(Value::as_u64)
        .unwrap_or_else(|| default_tool_timeout_ms("lyra_lumen", host_action));
    let mut payload_value = Value::Object(payload);
    let effect = validate_browser_action_effect("lyra_lumen", host_action, &payload_value)
        .map_err(|failure| InteractFailure {
            code: failure.code.to_string(),
            message: failure.message,
            recommended_next_action: Some(
                "Declare the action effect explicitly or split observation from mutation."
                    .to_string(),
            ),
            detail: Some(failure.detail),
        })?;
    payload_value = browser_host_adapter_arguments(payload_value, host_action, runtime);
    payload_value = attach_runtime_cancellation(
        payload_value,
        session_id,
        turn_id,
        tool_call_id,
        "lyra_lumen",
        host_action,
    );
    let (payload_value, timeout_ms) =
        apply_tool_timeout_policy(payload_value, "lyra_lumen", host_action);
    let _guard = BrowserConcurrencyGuard::try_acquire().map_err(|message| InteractFailure {
        code: "browser_concurrency_limited".to_string(),
        message,
        recommended_next_action: Some(
            "Wait for in-flight browser tools to finish, then retry interact.".to_string(),
        ),
        detail: None,
    })?;
    let result = invoke_host_capability_with_timeout_async(
        dispatcher.clone(),
        host_method.to_string(),
        payload_value,
        timeout_ms,
    )
    .await;
    let mut step = json!({
        "kind": kind,
        "hostMethod": host_method,
        "ok": result.is_ok(),
    });
    match result {
        Ok(value) => {
            if value.get("ok").and_then(Value::as_bool) == Some(false)
                || value.get("error").is_some_and(|error| !error.is_null())
            {
                step["ok"] = Value::Bool(false);
            }
            step["result"] = value;
        }
        Err(error) => {
            step["ok"] = Value::Bool(false);
            step["error"] = Value::String(error);
            step["recommendedNextAction"] = Value::String(
                "Change strategy with wait, locate, explain_target, or browser_ax.".to_string(),
            );
        }
    }
    Ok(step)
}

fn interact_host_mapping(kind: &str) -> Result<(&'static str, &'static str), InteractFailure> {
    Ok(match kind {
        "navigate" | "goto" | "open" => ("lyraLumen.navigate", "navigate"),
        "reload" | "refresh" => ("lyraLumen.reload", "reload"),
        "detect_qr" | "qr" | "scan_qr" => ("lyraLumen.detectQr", "detect_qr"),
        "wait" => ("lyraLumen.wait", "wait"),
        "read_until" => ("lyraLumen.wait", "read_until"),
        "click" | "hover" | "act" => ("lyraLumen.act", "act"),
        "type" | "fill" => ("lyraLumen.type", "type"),
        "press" => ("lyraLumen.press", "press"),
        "submit" => ("lyraLumen.submit", "submit"),
        "scroll" => ("lyraLumen.scroll", "scroll"),
        "scroll_to_target" => ("lyraLumen.scroll", "scroll_to_target"),
        "ensure_visible" => ("lyraLumen.scroll", "ensure_visible"),
        "reveal" => ("lyraLumen.reveal", "reveal"),
        "read" => ("lyraLumen.read", "read"),
        "map" => ("lyraLumen.map", "map"),
        other => {
            return Err(InteractFailure {
                code: "unsupported_action".to_string(),
                message: format!("unsupported browser interact action kind: {other}"),
                recommended_next_action: Some(
                    "Use navigate, wait, click, scroll, type, press, reveal, read, or map."
                        .to_string(),
                ),
                detail: None,
            });
        }
    })
}

fn interact_content(
    action_trace: &[Value],
    snapshot: Option<&PageSnapshot>,
    diff: Option<&PageSnapshotDiff>,
) -> String {
    let mut out = format!(
        "Browser interact completed {} action(s).",
        action_trace.len()
    );
    if let Some(snapshot) = snapshot {
        out.push_str(&format!("\nSnapshot: {} ({})", snapshot.url, snapshot.id));
    }
    if let Some(diff) = diff {
        out.push_str(&format!("\n{}", diff.summary));
    }
    out
}