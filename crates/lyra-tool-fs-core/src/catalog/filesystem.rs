use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![
        super::s(
            "/tools/filesystem/list_files",
            "filesystem",
            "list",
            "List files",
            "List workspace directory entries.",
            Some("list_files"),
        ),
        super::s(
            "/tools/filesystem/read_file",
            "filesystem",
            "read",
            "Read file",
            "Read a workspace file.",
            Some("read_file"),
        ),
        super::s(
            "/tools/filesystem/read_range",
            "filesystem",
            "read",
            "Read file range",
            "Read a line range from a workspace file.",
            Some("read_range"),
        ),
        super::s(
            "/tools/filesystem/glob",
            "filesystem",
            "glob",
            "Glob files",
            "Find files by glob.",
            Some("find_files"),
        ),
        super::s(
            "/tools/filesystem/write_file",
            "filesystem",
            "write",
            "Write file",
            "Write a workspace file.",
            None,
        ),
        super::s(
            "/tools/filesystem/edit_file",
            "filesystem",
            "edit",
            "Edit file",
            "Replace text in a workspace file.",
            None,
        ),
        super::s(
            "/tools/filesystem/strict_edit",
            "filesystem",
            "strict_edit",
            "Strict edit",
            "Replace exact text in a file after verifying the file was read and has not changed.",
            Some("strict_edit"),
        ),
        super::s(
            "/tools/filesystem/multi_edit",
            "filesystem",
            "multiedit",
            "Multi-edit file",
            "Apply multiple exact replacements.",
            None,
        ),
        super::s(
            "/tools/filesystem/apply_patch",
            "filesystem",
            "apply_patch",
            "Apply patch",
            "Apply structured workspace patch operations.",
            Some("apply_patch"),
        ),
    ]
}
