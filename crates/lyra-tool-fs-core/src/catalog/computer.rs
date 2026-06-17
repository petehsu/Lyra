use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![
        super::s(
            "/tools/computer/map",
            "computer",
            "map",
            "Map computer accessibility tree",
            "Read the desktop accessibility tree (osRef) of the focused window for semantic, non-visual control of native apps.",
            Some("computer_map"),
        ),
        super::s(
            "/tools/computer/find",
            "computer",
            "find",
            "Find computer accessibility node",
            "Find desktop nodes by role and name within a fresh accessibility snapshot, returning osRefs.",
            Some("computer_find"),
        ),
        super::s(
            "/tools/computer/act",
            "computer",
            "act",
            "Act on computer node",
            "Press, focus, set text, toggle, or select a desktop node by osRef; returns a before/after diff for verification.",
            None,
        ),
        super::s(
            "/tools/computer/diff",
            "computer",
            "diff",
            "Diff computer accessibility state",
            "Re-read a desktop node by osRef, or compute the observation diff (added/removed/changed) against an earlier computer.map snapshot.",
            Some("computer_diff"),
        ),
        super::s(
            "/tools/computer/explain",
            "computer",
            "explain",
            "Explain computer node",
            "Explain whether semantic OS control is available, whether an osRef is still resolvable, and the recommended next path.",
            Some("computer_explain"),
        ),
    ]
}
