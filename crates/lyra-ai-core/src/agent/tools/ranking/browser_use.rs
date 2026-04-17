use super::ToolPlanningProfile;

const SESSION_PREPARE: &str = "browser_use.session.prepare";
const PAGE_STATE: &str = "browser_use.page.state";
const PAGE_EXTRACT: &str = "browser_use.page.extract";
const PAGE_SAFE: &str = "browser_use.page.safe";
const PAGE_MUTATE: &str = "browser_use.page.mutate";
const PAGE_NAVIGATE: &str = "browser_use.page.navigate";
const PAGE_WAIT: &str = "browser_use.page.wait";
const AGENT_RUN: &str = "browser_use.agent.run";

pub(super) fn tool_priority(tool: &ToolPlanningProfile) -> i32 {
    match tool.definition.name.as_str() {
        SESSION_PREPARE => 33,
        PAGE_STATE => 31,
        PAGE_EXTRACT => 27,
        PAGE_SAFE => 30,
        PAGE_WAIT => 28,
        PAGE_MUTATE => 22,
        PAGE_NAVIGATE => 20,
        AGENT_RUN => 18,
        _ => 0,
    }
}
