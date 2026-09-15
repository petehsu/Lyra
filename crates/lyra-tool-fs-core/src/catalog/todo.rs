use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    // /tools/todo/write was removed: the direct todo_write/todo_update/
    // todo_finish model tools cover writes with the same backing functions.
    // /tools/todo/read stays — the direct tool set has no todo read.
    vec![super::s(
        "/tools/todo/read",
        "todo",
        "read",
        "Read todos",
        "Read active Lyra todos. This path cannot change status. To mark items in_progress, completed, failed, or skipped, call native todo_update, todo_write, or todo_finish.",
        Some("todo_read"),
    )]
}
