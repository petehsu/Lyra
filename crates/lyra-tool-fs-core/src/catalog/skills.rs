use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![
        super::s(
            "/tools/skills/list",
            "skills",
            "list",
            "List skills",
            "List installed Lyra skills.",
            Some("skill_list"),
        ),
        super::s(
            "/tools/skills/inspect",
            "skills",
            "inspect",
            "Inspect skill",
            "Inspect one Lyra skill.",
            None,
        ),
        super::s(
            "/tools/skills/activate",
            "skills",
            "activate",
            "Activate skill",
            "Activate one Lyra skill.",
            None,
        ),
        super::s(
            "/tools/skills/deactivate",
            "skills",
            "deactivate",
            "Deactivate skill",
            "Deactivate one Lyra skill.",
            None,
        ),
    ]
}
