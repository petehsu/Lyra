use super::*;

pub(crate) async fn execute_workbench_tool_adapter(
    session_id: &str,
    turn_id: &str,
    dispatcher: &Option<Arc<HostCapabilityDispatcher>>,
    cancellation: &CancellationToken,
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
        "workbench",
        action,
        host_adapter_arguments(arguments, action),
        started_at,
    )
    .await
}
