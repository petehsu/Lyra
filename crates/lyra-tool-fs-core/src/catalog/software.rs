use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![
        super::s(
            "/tools/software/list_capabilities",
            "software",
            "list_capabilities",
            "List software capabilities",
            "List installed software adapters.",
            None,
        ),
        super::s(
            "/tools/software/inspect_capability",
            "software",
            "inspect_capability",
            "Inspect software capability",
            "Inspect a software adapter capability.",
            None,
        ),
        super::s(
            "/tools/software/read_state",
            "software",
            "read_state",
            "Read software state",
            "Read lightweight software state.",
            None,
        ),
        super::s(
            "/tools/software/invoke_capability",
            "software",
            "invoke_capability",
            "Invoke software capability",
            "Invoke a software adapter capability.",
            None,
        ),
    ]
}
