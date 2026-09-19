use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![
        super::s(
            "/tools/browser_ax/map",
            "browser_ax",
            "map",
            "Map browser accessibility tree",
            "Read the page accessibility tree (axRef) for cross-origin OAuth/ARIA controls DOM cannot reach. Optional role/name/provider filters return matching nodes from the same snapshot.",
            Some("browser_ax_map"),
        ),
        super::s(
            "/tools/browser_ax/act",
            "browser_ax",
            "act",
            "Act on accessibility node",
            "Click, hover, focus, toggle, select, or press a key on an AX node by axRef.",
            None,
        ),
    ]
}
