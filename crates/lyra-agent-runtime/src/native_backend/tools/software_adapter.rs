use super::*;

pub(crate) fn execute_software_tool_adapter(
    session_id: &str,
    turn_id: &str,
    dispatcher: &Option<Arc<HostCapabilityDispatcher>>,
    cancellation: &Arc<AtomicBool>,
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
        "software",
        action,
        host_adapter_arguments(arguments, action),
        started_at,
    )
}

pub(crate) fn execute_software_capability_tool_adapter(
    session_id: &str,
    turn_id: &str,
    dispatcher: &Option<Arc<HostCapabilityDispatcher>>,
    cancellation: &Arc<AtomicBool>,
    tool_call_id: &str,
    software_id: &str,
    action_id: &str,
    arguments: Value,
    started_at: &str,
) -> Value {
    execute_host_tool_adapter(
        session_id,
        turn_id,
        dispatcher,
        cancellation,
        tool_call_id,
        "software.invokeCapability",
        "software",
        "invoke_capability",
        software_capability_adapter_arguments(arguments, software_id, action_id),
        started_at,
    )
}
