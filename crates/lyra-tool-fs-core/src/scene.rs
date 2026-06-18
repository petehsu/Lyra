use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolScene {
    General,
    ProjectCode,
    Git,
    Terminal,
    Browser,
    Workbench,
    Design,
    Automation,
}

impl ToolScene {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::General => "general",
            Self::ProjectCode => "project-code",
            Self::Git => "git",
            Self::Terminal => "terminal",
            Self::Browser => "browser",
            Self::Workbench => "workbench",
            Self::Design => "design",
            Self::Automation => "automation",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value.trim() {
            "project-code" => Self::ProjectCode,
            "git" => Self::Git,
            "terminal" => Self::Terminal,
            "browser" => Self::Browser,
            "workbench" => Self::Workbench,
            "design" => Self::Design,
            "automation" => Self::Automation,
            _ => Self::General,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolSceneSignals {
    pub session_kind: Option<String>,
    pub project_bound: bool,
    pub working_dir: Option<String>,
    pub git_repo: bool,
    pub active_tab_kind: Option<String>,
    pub focused_tab_kind: Option<String>,
    pub terminal_active: bool,
    pub browser_active: bool,
    pub editor_active: bool,
    pub design_active: bool,
    pub software_active: bool,
    pub active_skills: Vec<String>,
}

pub fn infer_scene(signals: &ToolSceneSignals) -> ToolScene {
    let session_kind = signals.session_kind.as_deref().unwrap_or_default().trim();
    if matches!(session_kind, "design") {
        return ToolScene::Design;
    }
    if matches!(session_kind, "project-code" | "code") {
        return ToolScene::ProjectCode;
    }
    if matches!(session_kind, "automation") {
        return ToolScene::Automation;
    }
    if signals.design_active
        || signals
            .active_skills
            .iter()
            .any(|skill| skill == "lyra-design-research")
        || signal_kind_matches(signals, ["design", "image", "canvas"])
    {
        return ToolScene::Design;
    }
    if signals.terminal_active || signal_kind_matches(signals, ["terminal"]) {
        return ToolScene::Terminal;
    }
    if signals.browser_active || signal_kind_matches(signals, ["browser", "lumen", "web"]) {
        return ToolScene::Browser;
    }
    if signals.editor_active || signal_kind_matches(signals, ["file", "editor", "code"]) {
        return ToolScene::ProjectCode;
    }
    if signals.software_active || signal_kind_matches(signals, ["software", "app"]) {
        return ToolScene::Automation;
    }
    if signals.git_repo {
        return ToolScene::Git;
    }
    if signals.project_bound
        || signals
            .working_dir
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
    {
        return ToolScene::ProjectCode;
    }
    if signal_kind_matches(signals, ["workbench"]) {
        return ToolScene::Workbench;
    }
    ToolScene::General
}

fn signal_kind_matches<const N: usize>(signals: &ToolSceneSignals, needles: [&str; N]) -> bool {
    [&signals.active_tab_kind, &signals.focused_tab_kind]
        .into_iter()
        .filter_map(|value| value.as_deref())
        .map(str::to_ascii_lowercase)
        .any(|value| needles.iter().any(|needle| value.contains(needle)))
}

pub(crate) fn scene_domain_order(scene: ToolScene) -> Vec<&'static str> {
    match scene {
        ToolScene::ProjectCode => vec!["filesystem", "code", "shell", "git", "terminal"],
        ToolScene::Git => vec!["git", "filesystem", "code", "shell", "terminal"],
        ToolScene::Terminal => vec!["terminal", "shell", "filesystem", "code", "git"],
        ToolScene::Browser => vec!["browser", "workbench", "web", "filesystem", "code"],
        ToolScene::Workbench => vec!["workbench", "browser", "filesystem", "todo"],
        ToolScene::Design => vec!["design", "filesystem", "code", "browser", "web"],
        ToolScene::Automation => vec!["todo", "shell", "terminal", "software", "workbench"],
        ToolScene::General => vec!["workbench", "browser", "memory", "todo", "filesystem"],
    }
}

pub(crate) fn pinned_handle_names(scene: ToolScene) -> Vec<&'static str> {
    match scene {
        ToolScene::ProjectCode => vec![
            "find_files",
            "search_code",
            "read_file",
            "read_range",
            "strict_edit",
            "apply_patch",
            "run_command",
            "git_status",
            "git_diff",
            "todo_write",
        ],
        ToolScene::Git => vec![
            "search_code",
            "read_file",
            "read_range",
            "strict_edit",
            "apply_patch",
            "run_command",
            "git_status",
            "git_diff",
            "git_log",
        ],
        ToolScene::Terminal => vec![
            "terminal_list",
            "terminal_read",
            "terminal_run",
            "terminal_wait",
        ],
        ToolScene::Browser => vec![
            "workbench_list_tabs",
            "browser_locate",
            "browser_find",
            "browser_map",
            "browser_read",
            "web_search",
        ],
        ToolScene::Workbench => vec![
            "workbench_list_tabs",
            "workbench_read_workspace",
            "workbench_read_tab",
            "workbench_capture_visual_evidence",
        ],
        ToolScene::Design => vec![
            "design_search_styles",
            "design_get_style_details",
            "read_file",
        ],
        ToolScene::Automation => vec!["todo_read", "todo_write", "run_command", "terminal_run"],
        ToolScene::General => vec![
            "workbench_list_tabs",
            "workbench_read_workspace",
            "memory_search",
            "todo_read",
        ],
    }
}
