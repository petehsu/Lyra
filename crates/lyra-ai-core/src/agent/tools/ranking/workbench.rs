use super::ToolPlanningProfile;

const TABS_LIST: &str = "workbench.tabs.list";
const DOCUMENT_INSPECT: &str = "workbench.document.inspect";
const DOCUMENT_READ: &str = "workbench.document.read";
const TAB_READ: &str = "workbench.tab.read";
const DOCUMENT_SEARCH: &str = "workbench.document.search";
const TAB_EXTRACT_TEXT: &str = "workbench.tab.extract_text";
const WORKSPACE_READ: &str = "workbench.workspace.read";
const TAB_CAPTURE_VISUAL: &str = "workbench.tab.capture_visual";
const WEB_SKELETON_READ: &str = "lyra.web.skeleton.read";
const WEB_QUERY_FIND: &str = "lyra.web.query.find";
const WEB_CONTEXT_READ: &str = "lyra.web.context.read";
const WEB_FOCUS_PROBE: &str = "lyra.web.focus.probe";
const WEB_SCAN_AND_ACT: &str = "lyra.web.scan.act";
const WEB_ACTION_SAFE: &str = "lyra.web.action.safe";
const WEB_ACTION_MUTATE: &str = "lyra.web.action.mutate";
const WEB_ACTION_NAVIGATE: &str = "lyra.web.action.navigate";
const WEB_ACTION_WAIT: &str = "lyra.web.action.wait";

pub(super) fn tool_priority(tool: &ToolPlanningProfile) -> i32 {
    match tool.definition.name.as_str() {
        WEB_SCAN_AND_ACT => 62,
        WEB_SKELETON_READ => 58,
        WEB_QUERY_FIND => 56,
        WEB_CONTEXT_READ => 52,
        WEB_FOCUS_PROBE => 42,
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
