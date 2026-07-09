use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    [
        (
            "read_file",
            "read",
            "Read file",
            "Read a workspace file.",
            Some("read_file"),
        ),
        (
            "grep",
            "grep",
            "Search file contents",
            "Search file contents by regex or exact text.",
            Some("grep"),
        ),
        (
            "glob",
            "glob",
            "Find files by pattern",
            "Find files matching a glob pattern.",
            Some("glob"),
        ),
        (
            "list_files",
            "list",
            "List directory",
            "List files in a directory.",
            Some("list_files"),
        ),
    ]
    .into_iter()
    .map(|(operation_suffix, operation, title, summary, handle)| {
        super::s(
            &format!("/tools/filesystem/{operation_suffix}"),
            "filesystem",
            operation,
            title,
            summary,
            handle,
        )
    })
    .collect()
}
