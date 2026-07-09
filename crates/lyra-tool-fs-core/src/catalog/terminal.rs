use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    [
        (
            "list",
            "list",
            "List terminal sessions",
            "List terminal sessions",
            Some("terminal_list"),
        ),
        (
            "read",
            "read",
            "Read terminal output",
            "Read terminal output",
            Some("terminal_read"),
        ),
        (
            "write",
            "write",
            "Write to terminal",
            "Send input to an existing terminal session.",
            Some("terminal_write"),
        ),
    ]
    .into_iter()
    .map(|(operation, op_id, title, summary, handle)| {
        super::s(
            &format!("/tools/terminal/{operation}"),
            "terminal",
            op_id,
            title,
            summary,
            handle,
        )
    })
    .collect()
}
