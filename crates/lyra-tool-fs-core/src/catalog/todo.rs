use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![
        super::s(
            "/tools/todo/read",
            "todo",
            "read",
            "Read todos",
            "Read active Lyra todos.",
            Some("todo_read"),
        ),
        super::s(
            "/tools/todo/write",
            "todo",
            "write",
            "Write todos",
            "Update active Lyra todos.",
            Some("todo_write"),
        ),
    ]
}
