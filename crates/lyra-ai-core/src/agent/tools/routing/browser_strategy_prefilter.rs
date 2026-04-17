use super::browser_strategy::BrowserStrategyRoutingContext;

const BROWSER_USE_PREPARE: &str = "browser_use.session.prepare";
const BROWSER_USE_STATE: &str = "browser_use.page.state";
const BROWSER_USE_EXTRACT: &str = "browser_use.page.extract";
const BROWSER_USE_SAFE: &str = "browser_use.page.safe";
const BROWSER_USE_MUTATE: &str = "browser_use.page.mutate";
const BROWSER_USE_NAVIGATE: &str = "browser_use.page.navigate";
const BROWSER_USE_WAIT: &str = "browser_use.page.wait";
const BROWSER_USE_AGENT_RUN: &str = "browser_use.agent.run";
const NATIVE_SKELETON_READ: &str = "workbench.web_skeleton.read";
const NATIVE_QUERY_FIND: &str = "workbench.web_query.find";
const NATIVE_CONTEXT_READ: &str = "workbench.web_context.read";
const NATIVE_FOCUS_PROBE: &str = "workbench.web_focus.probe";
const NATIVE_SCAN_AND_ACT: &str = "workbench.web_scan_and_act";
const NATIVE_SAFE: &str = "workbench.web_action.safe";
const NATIVE_MUTATE: &str = "workbench.web_action.mutate";
const NATIVE_NAVIGATE: &str = "workbench.web_action.navigate";
const NATIVE_WAIT: &str = "workbench.web_action.wait";

fn is_browser_use_tool(name: &str) -> bool {
    matches!(
        name,
        BROWSER_USE_PREPARE
            | BROWSER_USE_STATE
            | BROWSER_USE_EXTRACT
            | BROWSER_USE_SAFE
            | BROWSER_USE_MUTATE
            | BROWSER_USE_NAVIGATE
            | BROWSER_USE_WAIT
            | BROWSER_USE_AGENT_RUN
    )
}

fn is_native_tool(name: &str) -> bool {
    matches!(
        name,
        NATIVE_SKELETON_READ
            | NATIVE_QUERY_FIND
            | NATIVE_CONTEXT_READ
            | NATIVE_FOCUS_PROBE
            | NATIVE_SCAN_AND_ACT
            | NATIVE_SAFE
            | NATIVE_MUTATE
            | NATIVE_NAVIGATE
            | NATIVE_WAIT
    )
}

pub fn browser_strategy_prefilter_bonus(
    tool_name: &str,
    context: Option<&BrowserStrategyRoutingContext>,
) -> i32 {
    let Some(context) = context else {
        return 0;
    };

    let mut bonus = 0;
    let browser_use_healthy = context.browser_use_health.as_deref() == Some("healthy");

    if !context.browser_use_tool_exposed || !browser_use_healthy {
        bonus += match tool_name {
            BROWSER_USE_PREPARE
            | BROWSER_USE_STATE
            | BROWSER_USE_EXTRACT
            | BROWSER_USE_SAFE
            | BROWSER_USE_MUTATE
            | BROWSER_USE_NAVIGATE
            | BROWSER_USE_WAIT
            | BROWSER_USE_AGENT_RUN => -120,
            _ => 0,
        };
    }

    bonus += match context.preferred_engine.as_deref() {
        Some("lyra_direct") => match tool_name {
            NATIVE_SKELETON_READ | NATIVE_QUERY_FIND | NATIVE_CONTEXT_READ | NATIVE_FOCUS_PROBE
            | NATIVE_SCAN_AND_ACT | NATIVE_SAFE | NATIVE_MUTATE | NATIVE_NAVIGATE | NATIVE_WAIT => {
                20
            }
            BROWSER_USE_PREPARE
            | BROWSER_USE_STATE
            | BROWSER_USE_EXTRACT
            | BROWSER_USE_SAFE
            | BROWSER_USE_MUTATE
            | BROWSER_USE_NAVIGATE
            | BROWSER_USE_WAIT
            | BROWSER_USE_AGENT_RUN => -40,
            _ => 0,
        },
        Some("browser_use") => {
            if browser_use_healthy && context.browser_use_tool_exposed {
                match tool_name {
                    BROWSER_USE_PREPARE
                    | BROWSER_USE_STATE
                    | BROWSER_USE_EXTRACT
                    | BROWSER_USE_SAFE
                    | BROWSER_USE_MUTATE
                    | BROWSER_USE_NAVIGATE
                    | BROWSER_USE_WAIT
                    | BROWSER_USE_AGENT_RUN => 24,
                    NATIVE_SKELETON_READ | NATIVE_QUERY_FIND | NATIVE_CONTEXT_READ
                    | NATIVE_FOCUS_PROBE | NATIVE_SAFE | NATIVE_MUTATE | NATIVE_SCAN_AND_ACT
                    | NATIVE_NAVIGATE | NATIVE_WAIT => -10,
                    _ => 0,
                }
            } else {
                match tool_name {
                    NATIVE_SKELETON_READ | NATIVE_QUERY_FIND | NATIVE_CONTEXT_READ
                    | NATIVE_FOCUS_PROBE | NATIVE_SAFE | NATIVE_MUTATE | NATIVE_SCAN_AND_ACT
                    | NATIVE_NAVIGATE | NATIVE_WAIT => 16,
                    _ => 0,
                }
            }
        }
        _ => 0,
    };

    if context.native_live_candidate_ready {
        bonus += match tool_name {
            NATIVE_SCAN_AND_ACT => 22,
            NATIVE_MUTATE | NATIVE_SAFE => 12,
            NATIVE_WAIT => 8,
            NATIVE_FOCUS_PROBE => 10,
            NATIVE_SKELETON_READ => -4,
            NATIVE_QUERY_FIND => 8,
            NATIVE_CONTEXT_READ => 4,
            BROWSER_USE_SAFE | BROWSER_USE_MUTATE | BROWSER_USE_WAIT => -6,
            BROWSER_USE_PREPARE => -10,
            _ => 0,
        };
    }

    if context.native_widget_ready {
        bonus += match tool_name {
            NATIVE_SCAN_AND_ACT => 22,
            NATIVE_MUTATE | NATIVE_SAFE | NATIVE_WAIT => 18,
            NATIVE_FOCUS_PROBE => 12,
            NATIVE_SKELETON_READ => 10,
            NATIVE_QUERY_FIND => 4,
            NATIVE_CONTEXT_READ => 8,
            BROWSER_USE_SAFE | BROWSER_USE_MUTATE | BROWSER_USE_WAIT => -8,
            BROWSER_USE_PREPARE => -10,
            _ => 0,
        };
    }

    if context.last_action_verified {
        bonus += match tool_name {
            NATIVE_SCAN_AND_ACT => 16,
            NATIVE_MUTATE | NATIVE_SAFE | NATIVE_WAIT => 10,
            NATIVE_FOCUS_PROBE => 6,
            NATIVE_QUERY_FIND | NATIVE_CONTEXT_READ | NATIVE_SKELETON_READ => -8,
            BROWSER_USE_SAFE | BROWSER_USE_MUTATE | BROWSER_USE_WAIT => -6,
            _ => 0,
        };
    }

    if context.browser_use_session_ready {
        bonus += match tool_name {
            BROWSER_USE_PREPARE => -10,
            BROWSER_USE_STATE | BROWSER_USE_EXTRACT | BROWSER_USE_SAFE | BROWSER_USE_MUTATE => 10,
            BROWSER_USE_NAVIGATE | BROWSER_USE_WAIT | BROWSER_USE_AGENT_RUN => 14,
            _ => 0,
        };
    } else if browser_use_healthy && context.browser_use_tool_exposed {
        bonus += match tool_name {
            BROWSER_USE_PREPARE => 8,
            _ => 0,
        };
    }

    if context.strategy_lease_active {
        bonus += match context.last_browser_strategy.as_deref() {
            Some("browser_use") => {
                if is_browser_use_tool(tool_name) {
                    16
                } else if is_native_tool(tool_name) {
                    -8
                } else {
                    0
                }
            }
            Some("native") => {
                if is_native_tool(tool_name) {
                    12
                } else if is_browser_use_tool(tool_name) {
                    -6
                } else {
                    0
                }
            }
            _ => 0,
        };
    }

    bonus += match context.last_browser_failure_family.as_deref() {
        Some("native") => match tool_name {
            BROWSER_USE_PREPARE => 12,
            BROWSER_USE_STATE | BROWSER_USE_EXTRACT | BROWSER_USE_SAFE => 36,
            BROWSER_USE_MUTATE => 40,
            BROWSER_USE_NAVIGATE | BROWSER_USE_WAIT | BROWSER_USE_AGENT_RUN => 18,
            NATIVE_SKELETON_READ | NATIVE_QUERY_FIND | NATIVE_CONTEXT_READ | NATIVE_FOCUS_PROBE
            | NATIVE_SCAN_AND_ACT | NATIVE_MUTATE | NATIVE_SAFE => -32,
            _ => 0,
        },
        Some("browser_use") => match tool_name {
            NATIVE_SKELETON_READ | NATIVE_QUERY_FIND | NATIVE_CONTEXT_READ | NATIVE_FOCUS_PROBE
            | NATIVE_SCAN_AND_ACT | NATIVE_SAFE | NATIVE_MUTATE => 12,
            BROWSER_USE_SAFE | BROWSER_USE_MUTATE | BROWSER_USE_WAIT | BROWSER_USE_AGENT_RUN => -10,
            _ => 0,
        },
        _ => 0,
    };

    if context.in_long_running_flow {
        bonus += match tool_name {
            BROWSER_USE_NAVIGATE | BROWSER_USE_WAIT | BROWSER_USE_AGENT_RUN => 10,
            BROWSER_USE_STATE | BROWSER_USE_EXTRACT => 4,
            NATIVE_NAVIGATE | NATIVE_WAIT => -4,
            _ => 0,
        };
    }

    bonus
}
