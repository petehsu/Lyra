use super::*;

pub(crate) fn execute_terminal_tool_adapter(
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
        "terminal",
        action,
        host_adapter_arguments(arguments, action),
        started_at,
    )
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TerminalToolSpec {
    pub(crate) name: &'static str,
    pub(crate) host_method: &'static str,
    pub(crate) action: &'static str,
    pub(crate) read_only: bool,
}

pub(crate) const TERMINAL_TOOL_SPECS: &[TerminalToolSpec] = &[
    TerminalToolSpec {
        name: "terminal_list",
        host_method: "terminal.list",
        action: "list",
        read_only: true,
    },
    TerminalToolSpec {
        name: "terminal_read",
        host_method: "terminal.read",
        action: "read",
        read_only: true,
    },
    // terminal_write is not model-visible; it exists so write_stdin's
    // permission checks (terminal_action_requires_policy("write")) resolve.
    TerminalToolSpec {
        name: "terminal_write",
        host_method: "terminal.write",
        action: "write",
        read_only: false,
    },
];

#[cfg(test)]
pub(crate) fn terminal_tool_specs() -> &'static [TerminalToolSpec] {
    TERMINAL_TOOL_SPECS
}

#[cfg(test)]
pub(crate) fn terminal_tool_names() -> impl Iterator<Item = &'static str> {
    TERMINAL_TOOL_SPECS.iter().map(|spec| spec.name)
}

pub(crate) fn terminal_action_spec(action: &str) -> Option<TerminalToolSpec> {
    TERMINAL_TOOL_SPECS
        .iter()
        .copied()
        .find(|spec| spec.action == action)
}

pub(crate) fn terminal_action_is_read_only(action: &str) -> bool {
    terminal_action_spec(action).is_some_and(|spec| spec.read_only)
}

pub(crate) fn terminal_action_requires_policy(action: &str) -> bool {
    terminal_action_spec(action).is_some_and(|spec| !spec.read_only)
}
