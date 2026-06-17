use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![
        super::s(
            "/tools/computer/map",
            "computer",
            "map",
            "Map computer accessibility tree",
            "Read the desktop accessibility tree (osRef) of the focused window for semantic, non-visual control. Level-1 Lyra surfaces: surface lyra-browser (browser_ax), lyra-terminal (terminal regions), lyra-files (file-manager entries, read-only). Omit surface to auto-route from the active workbench tab; surface native forces OS accessibility for external apps.",
            Some("computer_map"),
        ),
        super::s(
            "/tools/computer/find",
            "computer",
            "find",
            "Find computer accessibility node",
            "Find desktop nodes by role and name within a fresh accessibility snapshot, returning osRefs. Honors the same surface routing as computer.map (lyra-browser auto-routes to browser_ax when a browser tab is active).",
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
