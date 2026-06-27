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
    pub software_active: bool,
    pub active_skills: Vec<String>,
}

pub fn infer_scene(signals: &ToolSceneSignals) -> ToolScene {
    let session_kind = signals.session_kind.as_deref().unwrap_or_default().trim();
    if matches!(session_kind, "project-code" | "code") {
        return ToolScene::ProjectCode;
    }
    if matches!(session_kind, "automation") {
        return ToolScene::Automation;
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
        ToolScene::ProjectCode => vec!["terminal", "todo", "workbench"],
        ToolScene::Git => vec!["terminal", "todo", "workbench"],
        ToolScene::Terminal => vec!["terminal", "todo", "workbench"],
        ToolScene::Browser => vec!["browser", "workbench", "web"],
        ToolScene::Workbench => vec!["workbench", "browser", "todo"],
        ToolScene::Automation => vec!["todo", "terminal", "software", "workbench"],
        ToolScene::General => vec!["workbench", "browser", "memory", "todo"],
    }
}

pub(crate) fn pinned_handle_names(scene: ToolScene) -> Vec<&'static str> {
    match scene {
        ToolScene::ProjectCode => vec!["todo_write", "terminal_list", "terminal_read"],
        ToolScene::Git => vec!["terminal_list", "terminal_read", "todo_write"],
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
            "workbench_list_terminals",
            "workbench_activate_tab",
            "workbench_close_tab",
            "workbench_reorder_tab",
            "workbench_split_tabs",
            "workbench_detach_split",
            "workbench_open_terminal",
            "workbench_focus_terminal",
            "workbench_close_terminal",
            "workbench_move_terminal",
            "workbench_extract_tab_text",
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
