use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    [
        ("list", "List terminal sessions", Some("terminal_list")),
        ("create", "Create terminal session", None),
        ("read", "Read terminal output", Some("terminal_read")),
        ("screen", "Read terminal screen", Some("terminal_screen")),
        ("wait", "Wait terminal", Some("terminal_wait")),
        ("write", "Write terminal input", None),
        ("close", "Close terminal session", None),
        ("events", "Read terminal events", None),
        ("read_until", "Read terminal until", None),
        ("run", "Run terminal command", Some("terminal_run")),
        ("input", "Submit terminal input", Some("terminal_input")),
        ("keys", "Press terminal keys", None),
        ("resize", "Resize terminal", None),
        ("signal", "Signal terminal process", None),
        ("processes", "Read terminal processes", None),
        ("command_status", "Read command status", None),
        ("map", "Map terminal screen", None),
        ("act", "Act in terminal UI", None),
        ("attach_agent", "Attach terminal agent", None),
        ("detach_agent", "Detach terminal agent", None),
    ]
    .into_iter()
    .map(|(operation, title, handle)| {
        super::s(
            &format!("/tools/terminal/{operation}"),
            "terminal",
            operation,
            title,
            title,
            handle,
        )
    })
    .collect()
}
