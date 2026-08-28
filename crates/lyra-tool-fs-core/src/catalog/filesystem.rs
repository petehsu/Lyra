use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    // read_file/grep/glob were removed: the direct provider tools
    // read_file/grep/glob dispatch to the same backing functions and are
    // always in the model's tool list — the Tool-FS manifests were pure
    // double registration. list_files has no direct equivalent and stays.
    [(
        "list_files",
        "list",
        "List directory",
        "List files in a directory.",
        Some("list_files"),
    )]
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
