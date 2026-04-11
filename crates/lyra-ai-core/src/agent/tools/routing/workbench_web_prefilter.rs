use crate::agent::tools::external::{
    ExternalToolApprovalMode, ExternalToolSideEffectLevel, ExternalToolSideEffects,
};

use super::web_context::WorkbenchWebRoutingContext;

const WEB_TARGET_SCAN: &str = "workbench.web_target.scan";
const WEB_GRAPH_BUILD: &str = "workbench.web_graph.build";
const WEB_GRAPH_QUERY: &str = "workbench.web_graph.query";
const TAB_READ: &str = "workbench.tab.read";
const TAB_EXTRACT_TEXT: &str = "workbench.tab.extract_text";
const WEB_ACTION_SAFE: &str = "workbench.web_action.safe";
const WEB_ACTION_MUTATE: &str = "workbench.web_action.mutate";
const WEB_ACTION_NAVIGATE: &str = "workbench.web_action.navigate";
const WEB_ACTION_WAIT: &str = "workbench.web_action.wait";

pub fn workbench_web_prefilter_bonus(
    tool_name: &str,
    approval_mode: ExternalToolApprovalMode,
    side_effects: &ExternalToolSideEffects,
    context: Option<&WorkbenchWebRoutingContext>,
) -> i32 {
    let base = match tool_name {
        WEB_TARGET_SCAN => 20,
        WEB_GRAPH_BUILD => 10,
        WEB_GRAPH_QUERY => 9,
        WEB_ACTION_SAFE => 12,
        WEB_ACTION_WAIT => 11,
        WEB_ACTION_MUTATE => 8,
        WEB_ACTION_NAVIGATE => 6,
        _ => 0,
    };

    if base == 0 {
        return 0;
    }

    let approval_bonus = match approval_mode {
        ExternalToolApprovalMode::Auto => 3,
        ExternalToolApprovalMode::Ask => 0,
        ExternalToolApprovalMode::Deny => -20,
    };

    let side_effect_bonus = match side_effects.level {
        ExternalToolSideEffectLevel::ReadOnly => 3,
        ExternalToolSideEffectLevel::NetworkRead => 0,
        ExternalToolSideEffectLevel::SessionMutation => -1,
        ExternalToolSideEffectLevel::WorkspaceWrite => -4,
        ExternalToolSideEffectLevel::ExternalMutation => -6,
    };

    let mut context_bonus = 0;
    if let Some(context) = context {
        if context.has_live_candidates {
            context_bonus += match tool_name {
                WEB_ACTION_SAFE | WEB_ACTION_WAIT => 18,
                WEB_ACTION_MUTATE => 30,
                WEB_ACTION_NAVIGATE => 8,
                WEB_TARGET_SCAN => -8,
                WEB_GRAPH_BUILD => -30,
                WEB_GRAPH_QUERY => -18,
                TAB_READ => -16,
                TAB_EXTRACT_TEXT => -20,
                _ => 0,
            };
        } else if context.has_live_scan_session {
            context_bonus += match tool_name {
                WEB_ACTION_SAFE | WEB_ACTION_WAIT | WEB_ACTION_MUTATE => 10,
                WEB_TARGET_SCAN => -4,
                WEB_GRAPH_BUILD => -12,
                WEB_GRAPH_QUERY => -6,
                TAB_READ => -8,
                TAB_EXTRACT_TEXT => -10,
                _ => 0,
            };
        } else {
            context_bonus += match tool_name {
                WEB_TARGET_SCAN => 16,
                WEB_GRAPH_BUILD => -8,
                WEB_GRAPH_QUERY => -4,
                _ => 0,
            };
        }

        context_bonus += match context.last_failure_code.as_deref() {
            Some("candidate_stale") | Some("candidate_not_found") | Some("postcondition_timeout") => {
                match tool_name {
                    WEB_TARGET_SCAN => 14,
                    WEB_GRAPH_QUERY => 8,
                    WEB_ACTION_MUTATE | WEB_ACTION_SAFE => -8,
                    _ => 0,
                }
            }
            Some("no_interactable_candidates") | Some("selector_budget_exhausted") => match tool_name {
                WEB_TARGET_SCAN => 8,
                WEB_GRAPH_QUERY => 6,
                WEB_GRAPH_BUILD => 4,
                _ => 0,
            },
            Some("active_visible_page_required") => match tool_name {
                WEB_TARGET_SCAN
                | WEB_GRAPH_BUILD
                | WEB_GRAPH_QUERY
                | WEB_ACTION_SAFE
                | WEB_ACTION_WAIT
                | WEB_ACTION_MUTATE
                | WEB_ACTION_NAVIGATE => -20,
                _ => 0,
            },
            _ => 0,
        };

        if context.last_graph_fallback_succeeded {
            context_bonus += match tool_name {
                WEB_GRAPH_QUERY => 4,
                WEB_GRAPH_BUILD => 2,
                WEB_TARGET_SCAN => -2,
                _ => 0,
            };
        }

        if context.last_mutate_draft_only {
            context_bonus += match tool_name {
                WEB_ACTION_WAIT => -72,
                WEB_ACTION_MUTATE => 28,
                WEB_ACTION_SAFE => 8,
                WEB_TARGET_SCAN => 14,
                WEB_GRAPH_QUERY => -10,
                WEB_GRAPH_BUILD => -18,
                TAB_READ => -20,
                TAB_EXTRACT_TEXT => -28,
                _ => 0,
            };
        }

        if context.last_mutate_submitted {
            context_bonus += match tool_name {
                WEB_ACTION_WAIT => 18,
                WEB_ACTION_MUTATE => -10,
                WEB_TARGET_SCAN => -6,
                TAB_READ => 10,
                TAB_EXTRACT_TEXT => 14,
                _ => 0,
            };
        }

        if context.has_typable_candidate && !context.last_mutate_submitted {
            context_bonus += match tool_name {
                WEB_ACTION_MUTATE => 16,
                WEB_ACTION_SAFE => 8,
                WEB_ACTION_WAIT => -16,
                TAB_READ => -12,
                TAB_EXTRACT_TEXT => -16,
                WEB_GRAPH_BUILD => -10,
                WEB_GRAPH_QUERY => -8,
                _ => 0,
            };
        }

        if context.has_clickable_candidate && !context.last_mutate_submitted {
            context_bonus += match tool_name {
                WEB_ACTION_MUTATE => 8,
                WEB_ACTION_SAFE => 6,
                TAB_READ => -6,
                TAB_EXTRACT_TEXT => -8,
                _ => 0,
            };
        }
    } else {
        context_bonus += match tool_name {
            WEB_TARGET_SCAN => 16,
            WEB_GRAPH_BUILD => -8,
            WEB_GRAPH_QUERY => -4,
            _ => 0,
        };
    }

    base + approval_bonus + side_effect_bonus + context_bonus
}
