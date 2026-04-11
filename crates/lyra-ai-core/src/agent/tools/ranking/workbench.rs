use super::ToolPlanningProfile;

const TABS_LIST: &str = "workbench.tabs.list";
const DOCUMENT_INSPECT: &str = "workbench.document.inspect";
const DOCUMENT_READ: &str = "workbench.document.read";
const TAB_READ: &str = "workbench.tab.read";
const DOCUMENT_SEARCH: &str = "workbench.document.search";
const TAB_EXTRACT_TEXT: &str = "workbench.tab.extract_text";
const WORKSPACE_READ: &str = "workbench.workspace.read";
const TAB_CAPTURE_VISUAL: &str = "workbench.tab.capture_visual";
const WEB_TARGET_SCAN: &str = "workbench.web_target.scan";
const WEB_GRAPH_BUILD: &str = "workbench.web_graph.build";
const WEB_GRAPH_QUERY: &str = "workbench.web_graph.query";
const WEB_ACTION_SAFE: &str = "workbench.web_action.safe";
const WEB_ACTION_MUTATE: &str = "workbench.web_action.mutate";
const WEB_ACTION_NAVIGATE: &str = "workbench.web_action.navigate";
const WEB_ACTION_WAIT: &str = "workbench.web_action.wait";

pub(super) fn tool_priority(tool: &ToolPlanningProfile) -> i32 {
    match tool.definition.name.as_str() {
        WEB_TARGET_SCAN => 42,
        WEB_GRAPH_BUILD => 34,
        WEB_GRAPH_QUERY => 32,
        TABS_LIST => 36,
        WEB_ACTION_SAFE => 35,
        WEB_ACTION_WAIT => 34,
        DOCUMENT_INSPECT => 34,
        DOCUMENT_READ => 32,
        TAB_READ => 28,
        DOCUMENT_SEARCH => 24,
        TAB_EXTRACT_TEXT => 20,
        WEB_ACTION_MUTATE => 18,
        WEB_ACTION_NAVIGATE => 17,
        WORKSPACE_READ => 16,
        TAB_CAPTURE_VISUAL => 6,
        _ => 0,
    }
}
