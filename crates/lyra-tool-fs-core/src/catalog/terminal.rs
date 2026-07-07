use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    [
        ("list", "List terminal sessions", Some("terminal_list")),
        ("read", "Read terminal output", Some("terminal_read")),
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
