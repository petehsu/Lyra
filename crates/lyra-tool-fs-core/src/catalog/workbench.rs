use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![
        super::s(
            "/tools/workbench/list_tabs",
            "workbench",
            "list_tabs",
            "List workbench tabs",
            "List Lyra workbench tabs.",
            Some("workbench_list_tabs"),
        ),
        super::s(
            "/tools/workbench/read_workspace",
            "workbench",
            "read_workspace",
            "Read workspace",
            "Read visible workspace state.",
            Some("workbench_read_workspace"),
        ),
        super::s(
            "/tools/workbench/read_tab",
            "workbench",
            "read_tab",
            "Read workbench tab",
            "Read one Lyra workbench tab.",
            Some("workbench_read_tab"),
        ),
        super::s(
            "/tools/workbench/capture_visual_evidence",
            "workbench",
            "capture_visual_evidence",
            "Capture workspace visual evidence",
            "Capture visible Lyra workspace visual evidence for model vision, including the workspace window, Image Viewer, file previews, terminal surfaces, and browser tab screenshots.",
            Some("workbench_capture_visual_evidence"),
        ),
        super::s(
            "/tools/workbench/activate_tab",
            "workbench",
            "activate_tab",
            "Activate workbench tab",
            "Activate one Lyra workbench tab.",
            None,
        ),
    ]
}
