use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![
        super::s(
            "/tools/browser_ax/map",
            "browser_ax",
            "map",
            "Map browser accessibility tree",
            "Read the page accessibility tree (axRef) for cross-origin OAuth/ARIA controls DOM cannot reach.",
            Some("browser_ax_map"),
        ),
        super::s(
            "/tools/browser_ax/query",
            "browser_ax",
            "query",
            "Query browser accessibility snapshot",
            "Find AX nodes by role, name, or provider within the latest browser_ax.map snapshot.",
            Some("browser_ax_query"),
        ),
        super::s(
            "/tools/browser_ax/act",
            "browser_ax",
            "act",
            "Act on accessibility node",
            "Click, hover, focus, toggle, or select an AX node by axRef.",
            None,
        ),
        super::s(
            "/tools/browser_ax/focus",
            "browser_ax",
            "focus",
            "Move accessibility focus",
            "Move keyboard focus through the accessibility tree and report the focus trail.",
            None,
        ),
        super::s(
            "/tools/browser_ax/press",
            "browser_ax",
            "press",
            "Press key on accessibility node",
            "Focus an AX node and press a keyboard key.",
            None,
        ),
        super::s(
            "/tools/browser_ax/explain",
            "browser_ax",
            "explain",
            "Explain accessibility node",
            "Explain why DOM cannot see a control, whether AX can, and whether visual/user action is required.",
            Some("browser_ax_explain"),
        ),
    ]
}
