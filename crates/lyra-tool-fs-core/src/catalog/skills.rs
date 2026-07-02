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
        super::s(
            "/tools/skills/install_local",
            "skills",
            "install_local",
            "Install local skill",
            "Install a Lyra skill from a local folder, SKILL.md file, or zip archive.",
            None,
        ),
        super::s(
            "/tools/skills/install_git",
            "skills",
            "install_git",
            "Install Git skill",
            "Install a Lyra skill from a Git repository URL with optional ref and subdir.",
            None,
        ),
        super::s(
            "/tools/skills/install_store",
            "skills",
            "install_store",
            "Install store skill",
            "Install a Lyra skill from the dynamic skill store by skillId.",
            None,
        ),
        super::s(
            "/tools/skills/uninstall",
            "skills",
            "uninstall",
            "Uninstall skill",
            "Uninstall one Lyra skill by skillId.",
            None,
        ),
    ]
}
