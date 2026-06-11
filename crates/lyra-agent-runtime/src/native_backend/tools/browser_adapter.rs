use super::*;

pub(crate) fn execute_browser_tool_adapter(
    session_id: &str,
    turn_id: &str,
    dispatcher: &Option<Arc<HostCapabilityDispatcher>>,
    cancellation: &Arc<AtomicBool>,
    runtime: ToolExecutionRuntime,
    tool_call_id: &str,
    host_method: &str,
    action: &str,
    arguments: Value,
    started_at: &str,
) -> Value {
    execute_host_tool_adapter(
        session_id,
        turn_id,
        dispatcher,
        cancellation,
        tool_call_id,
        host_method,
        "lyra_lumen",
        action,
        browser_host_adapter_arguments(arguments, action, runtime),
        started_at,
    )
}
