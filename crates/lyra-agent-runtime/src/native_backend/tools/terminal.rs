use super::*;

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
        name: "terminal_create",
        host_method: "terminal.create",
        action: "create",
        read_only: true,
    },
    TerminalToolSpec {
        name: "terminal_read",
        host_method: "terminal.read",
        action: "read",
        read_only: true,
    },
    TerminalToolSpec {
        name: "terminal_screen",
        host_method: "terminal.screen",
        action: "screen",
        read_only: true,
    },
    TerminalToolSpec {
        name: "terminal_wait",
        host_method: "terminal.wait",
        action: "wait",
        read_only: true,
    },
    TerminalToolSpec {
        name: "terminal_write",
        host_method: "terminal.write",
        action: "write",
        read_only: false,
    },
    TerminalToolSpec {
        name: "terminal_close",
        host_method: "terminal.close",
        action: "close",
        read_only: false,
    },
    TerminalToolSpec {
        name: "terminal_events",
        host_method: "terminal.events.read",
        action: "events",
        read_only: true,
    },
    TerminalToolSpec {
        name: "terminal_read_until",
        host_method: "terminal.waitUntil",
        action: "read_until",
        read_only: true,
    },
    TerminalToolSpec {
        name: "terminal_run",
        host_method: "terminal.input.execute",
        action: "run",
        read_only: false,
    },
    TerminalToolSpec {
        name: "terminal_input",
        host_method: "terminal.input.execute",
        action: "input",
        read_only: false,
    },
    TerminalToolSpec {
        name: "terminal_keys",
        host_method: "terminal.input.execute",
        action: "keys",
        read_only: false,
    },
    TerminalToolSpec {
        name: "terminal_resize",
        host_method: "terminal.resize",
        action: "resize",
        read_only: false,
    },
    TerminalToolSpec {
        name: "terminal_signal",
        host_method: "terminal.processes.signal",
        action: "signal",
        read_only: false,
    },
    TerminalToolSpec {
        name: "terminal_processes",
        host_method: "terminal.processes.read",
        action: "processes",
        read_only: true,
    },
    TerminalToolSpec {
        name: "terminal_command_status",
        host_method: "terminal.command.status",
        action: "command_status",
        read_only: true,
    },
    TerminalToolSpec {
        name: "terminal_map",
        host_method: "terminal.map.read",
        action: "map",
        read_only: true,
    },
    TerminalToolSpec {
        name: "terminal_act",
        host_method: "terminal.act.execute",
        action: "act",
        read_only: false,
    },
    TerminalToolSpec {
        name: "terminal_attach_agent",
        host_method: "terminal.attachments.attach",
        action: "attach_agent",
        read_only: false,
    },
    TerminalToolSpec {
        name: "terminal_detach_agent",
        host_method: "terminal.attachments.detach",
        action: "detach_agent",
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

pub(crate) fn terminal_tool_spec(name: &str) -> Option<TerminalToolSpec> {
    TERMINAL_TOOL_SPECS
        .iter()
        .copied()
        .find(|spec| spec.name == name)
}

pub(crate) fn terminal_action_spec(action: &str) -> Option<TerminalToolSpec> {
    TERMINAL_TOOL_SPECS
        .iter()
        .copied()
        .find(|spec| spec.action == action)
}

pub(crate) fn terminal_host_tool_mapping(
    name: &str,
    arguments: Value,
) -> Option<(String, String, String, Value)> {
    let spec = terminal_tool_spec(name)?;
    let mut input = arguments.as_object().cloned().unwrap_or_default();
    input.insert("action".to_string(), Value::String(spec.action.to_string()));
    Some((
        spec.host_method.to_string(),
        "terminal".to_string(),
        spec.action.to_string(),
        Value::Object(input),
    ))
}

pub(crate) fn terminal_action_is_read_only(action: &str) -> bool {
    terminal_action_spec(action).is_some_and(|spec| spec.read_only)
}

pub(crate) fn terminal_action_requires_policy(action: &str) -> bool {
    terminal_action_spec(action).is_some_and(|spec| !spec.read_only)
}
