use super::*;
const MIN_TOOL_TIMEOUT_MS: u64 = 250;
const DEFAULT_HOST_TOOL_TIMEOUT_MS: u64 = 15_000;
const DEFAULT_BROWSER_TOOL_TIMEOUT_MS: u64 = 8_000;
const DEFAULT_BROWSER_WAIT_TIMEOUT_MS: u64 = 30_000;
const DEFAULT_SOFTWARE_TOOL_TIMEOUT_MS: u64 = 30_000;
const MAX_TOOL_TIMEOUT_MS: u64 = 120_000;
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
                        | ("lyra_ax", _)
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

pub(crate) fn requested_timeout_ms(input: &Value) -> Option<u64> {
    input
        .get("timeoutMs")
        .or_else(|| input.pointer("/runtimeCancellation/timeoutMs"))
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.round() as u64)
}

pub(crate) fn default_tool_timeout_ms(display_name: &str, action: &str) -> u64 {
    match (display_name, action) {
        ("lyra_lumen", "wait" | "read_until") => DEFAULT_BROWSER_WAIT_TIMEOUT_MS,
        ("lyra_lumen", _) => DEFAULT_BROWSER_TOOL_TIMEOUT_MS,
        ("lyra_ax", _) => DEFAULT_BROWSER_TOOL_TIMEOUT_MS,
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
