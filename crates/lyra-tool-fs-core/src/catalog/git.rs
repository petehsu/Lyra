use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![
        super::s(
            "/tools/git/status",
            "git",
            "status",
            "Git status",
            "Read Git repository status.",
            Some("git_status"),
        ),
        super::s(
            "/tools/git/diff",
            "git",
            "diff",
            "Git diff",
            "Read Git diff for a changed file.",
            Some("git_diff"),
        ),
        super::s(
            "/tools/git/stage",
            "git",
            "stage",
            "Git stage",
            "Stage a Git file.",
            None,
        ),
        super::s(
            "/tools/git/unstage",
            "git",
            "unstage",
            "Git unstage",
            "Unstage a Git file.",
            None,
        ),
        super::s(
            "/tools/git/discard",
            "git",
            "discard",
            "Git discard",
            "Discard a changed file.",
            None,
        ),
        super::s(
            "/tools/git/log",
            "git",
            "log",
            "Git log",
            "Read recent Git commits.",
            Some("git_log"),
        ),
        super::s(
            "/tools/git/show",
            "git",
            "show",
            "Git show",
            "Show a Git object or commit.",
            Some("git_show"),
        ),
        super::s(
            "/tools/git/branch",
            "git",
            "branch",
            "Git branch",
            "Read current Git branch state.",
            Some("git_branch"),
        ),
    ]
}
