use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![
        super::s(
            "/tools/computer/list_apps",
            "computer",
            "list_apps",
            "List desktop applications",
            "List running desktop applications and their visible windows, including the foreground app. Level-1 merge: also includes open Lyra workbench tabs (browser, terminal, file manager) when internal surface routing is configured.",
            Some("computer_list_apps"),
        ),
        super::s(
            "/tools/computer/observe",
            "computer",
            "observe",
            "Observe desktop foreground state",
            "Read the foreground application, focused window, and focused accessibility control without mapping the full tree. Level-1 merge: when a Lyra browser or terminal tab is active, reports that tab as the foreground surface.",
            Some("computer_observe"),
        ),
        super::s(
            "/tools/computer/focus",
            "computer",
            "focus",
            "Focus desktop application or window",
            "Raise a native desktop app or window to the foreground (session-level focus). Distinct from computer.act(action: focus) which targets a single accessibility node. Shared mode only — background/isolated sessions refuse foreground steal.",
            None,
        ),
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
        super::s(
            "/tools/computer/see",
            "computer",
            "see",
            "Capture desktop screenshot",
            "Visual fallback (Level 3): screenshot the screen or focused window so the model can read native UI that has no accessibility node (canvas, custom-drawn widgets). Pure observation — does not steal focus or act. Use only after computer.map/explain shows semantic control cannot reach the target.",
            Some("computer_see"),
        ),
    ]
}
