use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    [
        ("list", "List hardware devices", Some("hardware_list")),
        (
            "inspect",
            "Inspect hardware device",
            Some("hardware_inspect"),
        ),
        (
            "capabilities",
            "Search hardware capabilities",
            Some("hardware_capabilities"),
        ),
        ("os_status", "Inspect hardware OS status", None),
        (
            "permissions_request",
            "Request hardware OS permission",
            None,
        ),
        ("session_open", "Open hardware session", None),
        ("session_read", "Read hardware session", None),
        ("session_write", "Write hardware session", None),
        ("session_close", "Close hardware session", None),
        ("invoke", "Invoke hardware capability", None),
        ("run_action", "Run hardware action", None),
    ]
    .into_iter()
    .map(|(operation, title, handle)| {
        super::s(
            &format!("/tools/hardware/{operation}"),
            "hardware",
            operation,
            title,
            title,
            handle,
        )
    })
    .collect()
}
