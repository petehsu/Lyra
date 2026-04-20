use crate::agent::tools::external::{
    ExternalToolApprovalMode, ExternalToolSideEffectLevel, ExternalToolSideEffects,
};

use super::web_context::WorkbenchWebRoutingContext;

const WEB_SKELETON_READ: &str = "lyra.web.skeleton.read";
const WEB_QUERY_FIND: &str = "lyra.web.query.find";
const WEB_CONTEXT_READ: &str = "lyra.web.context.read";
const WEB_FOCUS_PROBE: &str = "lyra.web.focus.probe";
const WEB_SCAN_AND_ACT: &str = "lyra.web.scan.act";
const TAB_READ: &str = "workbench.tab.read";
const TAB_EXTRACT_TEXT: &str = "workbench.tab.extract_text";
const WEB_ACTION_SAFE: &str = "lyra.web.action.safe";
const WEB_ACTION_MUTATE: &str = "lyra.web.action.mutate";
const WEB_ACTION_NAVIGATE: &str = "lyra.web.action.navigate";
const WEB_ACTION_WAIT: &str = "lyra.web.action.wait";

pub fn workbench_web_prefilter_bonus(
    tool_name: &str,
    approval_mode: ExternalToolApprovalMode,
    side_effects: &ExternalToolSideEffects,
    context: Option<&WorkbenchWebRoutingContext>,
) -> i32 {
    let base = match tool_name {
        WEB_SKELETON_READ => 28,
        WEB_QUERY_FIND => 26,
        WEB_CONTEXT_READ => 24,
        WEB_SCAN_AND_ACT => 30,
        WEB_FOCUS_PROBE => 18,
        WEB_ACTION_SAFE => 14,
        WEB_ACTION_WAIT => 12,
        WEB_ACTION_MUTATE => 10,
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
                WEB_SCAN_AND_ACT => 34,
                WEB_ACTION_MUTATE => 28,
                WEB_ACTION_SAFE => 28,
                WEB_ACTION_WAIT => 12,
                WEB_CONTEXT_READ => 4,
                WEB_FOCUS_PROBE => 8,
                WEB_QUERY_FIND => -16,
                WEB_SKELETON_READ => -18,
                TAB_READ => -18,
                TAB_EXTRACT_TEXT => -20,
                _ => 0,
            };
        } else if context.has_live_scan_session {
            context_bonus += match tool_name {
                WEB_SCAN_AND_ACT => 24,
                WEB_QUERY_FIND => 12,
                WEB_CONTEXT_READ => 10,
                WEB_FOCUS_PROBE => 10,
                WEB_ACTION_SAFE | WEB_ACTION_WAIT | WEB_ACTION_MUTATE => 8,
                WEB_SKELETON_READ => 6,
                TAB_READ => -8,
                TAB_EXTRACT_TEXT => -10,
                _ => 0,
            };
        } else {
            context_bonus += match tool_name {
                WEB_SCAN_AND_ACT => 26,
                WEB_SKELETON_READ => 24,
                WEB_QUERY_FIND => 18,
                WEB_CONTEXT_READ => 14,
                WEB_FOCUS_PROBE => 10,
                _ => 0,
            };
        }

        context_bonus += match context.last_failure_code.as_deref() {
            Some("candidate_stale")
            | Some("candidate_not_found")
            | Some("postcondition_timeout") => match tool_name {
                WEB_SCAN_AND_ACT => 14,
                WEB_QUERY_FIND | WEB_CONTEXT_READ => 14,
                WEB_SKELETON_READ => 10,
                WEB_ACTION_MUTATE | WEB_ACTION_SAFE => -8,
                _ => 0,
            },
            Some("no_interactable_candidates") | Some("selector_budget_exhausted") => {
                match tool_name {
                    WEB_SCAN_AND_ACT => 12,
                    WEB_SKELETON_READ => 12,
                    WEB_QUERY_FIND | WEB_CONTEXT_READ => 10,
                    _ => 0,
                }
            }
            Some("active_visible_page_required") => match tool_name {
                WEB_SKELETON_READ | WEB_QUERY_FIND | WEB_CONTEXT_READ | WEB_FOCUS_PROBE
                | WEB_SCAN_AND_ACT | WEB_ACTION_SAFE | WEB_ACTION_WAIT | WEB_ACTION_MUTATE
                | WEB_ACTION_NAVIGATE => -20,
                _ => 0,
            },
            _ => 0,
        };

        if context.active_widget_id.is_some() {
            context_bonus += match tool_name {
                WEB_SCAN_AND_ACT => 18,
                WEB_ACTION_MUTATE | WEB_ACTION_SAFE | WEB_ACTION_WAIT => 12,
                WEB_QUERY_FIND | WEB_CONTEXT_READ => 10,
                WEB_SKELETON_READ => 6,
                TAB_READ => -12,
                TAB_EXTRACT_TEXT => -14,
                _ => 0,
            };
        }

        if context.widget_graph_ready || context.native_widget_ready {
            context_bonus += match tool_name {
                WEB_SCAN_AND_ACT => 24,
                WEB_ACTION_MUTATE | WEB_ACTION_SAFE | WEB_ACTION_WAIT => 18,
                WEB_QUERY_FIND | WEB_CONTEXT_READ => 8,
                WEB_SKELETON_READ => -10,
                TAB_READ => -16,
                TAB_EXTRACT_TEXT => -18,
                _ => 0,
            };
        }

        if context.active_item_id.is_some() {
            context_bonus += match tool_name {
                WEB_SCAN_AND_ACT => 24,
                WEB_ACTION_MUTATE => 18,
                WEB_ACTION_SAFE => 14,
                WEB_ACTION_WAIT => 10,
                WEB_QUERY_FIND | WEB_CONTEXT_READ => 8,
                WEB_SKELETON_READ => 4,
                TAB_READ => -16,
                TAB_EXTRACT_TEXT => -18,
                _ => 0,
            };
        }

        if context.focus_atlas_ready {
            context_bonus += match tool_name {
                WEB_SCAN_AND_ACT => 18,
                WEB_SKELETON_READ => -6,
                WEB_QUERY_FIND => 12,
                WEB_CONTEXT_READ => 10,
                WEB_ACTION_SAFE | WEB_ACTION_MUTATE | WEB_ACTION_WAIT => 10,
                TAB_READ => -8,
                TAB_EXTRACT_TEXT => -10,
                _ => 0,
            };
        }

        if context.active_focus_region_id.is_some() {
            context_bonus += match tool_name {
                WEB_SCAN_AND_ACT => 20,
                WEB_ACTION_SAFE | WEB_ACTION_MUTATE | WEB_ACTION_WAIT => 12,
                WEB_QUERY_FIND | WEB_CONTEXT_READ => 10,
                WEB_SKELETON_READ => 6,
                TAB_READ => -10,
                TAB_EXTRACT_TEXT => -12,
                _ => 0,
            };
        }

        if context.last_reveal_observed {
            context_bonus += match tool_name {
                WEB_SCAN_AND_ACT => 20,
                WEB_ACTION_MUTATE => 16,
                WEB_ACTION_SAFE => 10,
                WEB_CONTEXT_READ => 10,
                WEB_QUERY_FIND => 6,
                WEB_SKELETON_READ => 2,
                TAB_READ => -14,
                TAB_EXTRACT_TEXT => -16,
                _ => 0,
            };
        }

        if context.last_focus_delta_observed || context.last_focus_probe_verified {
            context_bonus += match tool_name {
                WEB_SCAN_AND_ACT => 12,
                WEB_ACTION_SAFE | WEB_ACTION_MUTATE | WEB_ACTION_WAIT => 8,
                WEB_FOCUS_PROBE => 10,
                WEB_CONTEXT_READ => 8,
                WEB_QUERY_FIND => 4,
                _ => 0,
            };
        }

        context_bonus += match context.current_browser_subgoal.as_deref() {
            Some("locate item") => match tool_name {
                WEB_SCAN_AND_ACT => 28,
                WEB_SKELETON_READ => 16,
                WEB_QUERY_FIND => 24,
                WEB_CONTEXT_READ => 18,
                WEB_FOCUS_PROBE => 8,
                WEB_ACTION_SAFE => 6,
                WEB_ACTION_MUTATE => -6,
                TAB_READ => -12,
                TAB_EXTRACT_TEXT => -16,
                _ => 0,
            },
            Some("reveal item actions") => match tool_name {
                WEB_SCAN_AND_ACT => 26,
                WEB_ACTION_SAFE => 22,
                WEB_FOCUS_PROBE => 14,
                WEB_CONTEXT_READ => 14,
                WEB_QUERY_FIND => 10,
                WEB_SKELETON_READ => 8,
                WEB_ACTION_MUTATE => 4,
                TAB_READ => -16,
                TAB_EXTRACT_TEXT => -20,
                _ => 0,
            },
            Some("open item menu") => match tool_name {
                WEB_SCAN_AND_ACT => 26,
                WEB_ACTION_MUTATE => 22,
                WEB_ACTION_SAFE => 8,
                WEB_ACTION_WAIT => 6,
                WEB_CONTEXT_READ => 10,
                WEB_QUERY_FIND => 8,
                WEB_SKELETON_READ => 4,
                TAB_READ => -14,
                TAB_EXTRACT_TEXT => -18,
                _ => 0,
            },
            Some("execute menu action") => match tool_name {
                WEB_SCAN_AND_ACT => 30,
                WEB_ACTION_MUTATE => 26,
                WEB_ACTION_WAIT => 10,
                WEB_CONTEXT_READ => 10,
                WEB_QUERY_FIND => 4,
                TAB_READ => -16,
                TAB_EXTRACT_TEXT => -20,
                _ => 0,
            },
            Some("locate mode switcher") => match tool_name {
                WEB_SCAN_AND_ACT => 18,
                WEB_SKELETON_READ => 10,
                WEB_QUERY_FIND => 14,
                WEB_CONTEXT_READ => 12,
                WEB_ACTION_SAFE => 8,
                _ => 0,
            },
            Some("toggle mode") => match tool_name {
                WEB_SCAN_AND_ACT => 28,
                WEB_ACTION_MUTATE => 22,
                WEB_ACTION_WAIT => 8,
                WEB_FOCUS_PROBE => 8,
                WEB_QUERY_FIND => 10,
                WEB_CONTEXT_READ => 12,
                WEB_SKELETON_READ => 4,
                _ => 0,
            },
            Some("locate composer") => match tool_name {
                WEB_SCAN_AND_ACT => 20,
                WEB_SKELETON_READ => 12,
                WEB_QUERY_FIND => 18,
                WEB_CONTEXT_READ => 14,
                WEB_FOCUS_PROBE => 10,
                WEB_ACTION_SAFE => 6,
                _ => 0,
            },
            Some("type") => match tool_name {
                WEB_SCAN_AND_ACT => 30,
                WEB_ACTION_MUTATE => 26,
                WEB_ACTION_SAFE => 6,
                WEB_CONTEXT_READ => 8,
                WEB_ACTION_WAIT => -16,
                _ => 0,
            },
            Some("submit") => match tool_name {
                WEB_SCAN_AND_ACT => 30,
                WEB_ACTION_MUTATE => 24,
                WEB_ACTION_WAIT => 12,
                WEB_CONTEXT_READ => 8,
                WEB_ACTION_SAFE => 4,
                _ => 0,
            },
            Some("wait for response/state transition") => match tool_name {
                WEB_SCAN_AND_ACT => -18,
                WEB_ACTION_WAIT => 28,
                WEB_ACTION_MUTATE => -12,
                WEB_ACTION_SAFE => -6,
                WEB_QUERY_FIND => -8,
                WEB_CONTEXT_READ => -4,
                WEB_SKELETON_READ => -10,
                TAB_READ => -14,
                TAB_EXTRACT_TEXT => -16,
                _ => 0,
            },
            _ => 0,
        };

        if context.last_action_verified {
            context_bonus += match tool_name {
                WEB_SCAN_AND_ACT => 20,
                WEB_ACTION_MUTATE | WEB_ACTION_SAFE | WEB_ACTION_WAIT => 16,
                WEB_FOCUS_PROBE => 6,
                WEB_QUERY_FIND | WEB_CONTEXT_READ => -8,
                WEB_SKELETON_READ => -12,
                _ => 0,
            };
        }

        if matches!(
            context.last_workflow_failure.as_deref(),
            Some(
                "hover_reveal_required"
                    | "reveal_not_observed"
                    | "menu_not_opened"
                    | "list_item_not_changed"
                    | "mode_not_switched"
                    | "workflow_not_advanced"
            )
        ) {
            context_bonus += match tool_name {
                WEB_SCAN_AND_ACT => 24,
                WEB_ACTION_SAFE => 16,
                WEB_ACTION_MUTATE => 12,
                WEB_FOCUS_PROBE => 10,
                WEB_QUERY_FIND | WEB_CONTEXT_READ => 12,
                WEB_SKELETON_READ => 10,
                TAB_READ => -14,
                TAB_EXTRACT_TEXT => -18,
                _ => 0,
            };
        }

        if context.last_mutate_draft_only {
            context_bonus += match tool_name {
                WEB_SCAN_AND_ACT => 18,
                WEB_ACTION_MUTATE => 32,
                WEB_CONTEXT_READ => 12,
                WEB_QUERY_FIND => 10,
                WEB_ACTION_SAFE => 8,
                WEB_SKELETON_READ => -14,
                WEB_ACTION_WAIT => -56,
                _ => 0,
            };
        }

        if context.last_mutate_submitted {
            context_bonus += match tool_name {
                WEB_SCAN_AND_ACT => 8,
                WEB_ACTION_WAIT => 18,
                WEB_ACTION_MUTATE => -10,
                WEB_SKELETON_READ => -6,
                WEB_QUERY_FIND => -6,
                WEB_CONTEXT_READ => -4,
                TAB_READ => 10,
                TAB_EXTRACT_TEXT => 14,
                _ => 0,
            };
        }

        if context.has_typable_candidate && !context.last_mutate_submitted {
            context_bonus += match tool_name {
                WEB_SCAN_AND_ACT => 28,
                WEB_ACTION_MUTATE => 24,
                WEB_ACTION_SAFE => 8,
                WEB_QUERY_FIND | WEB_CONTEXT_READ => 10,
                WEB_SKELETON_READ => -8,
                WEB_ACTION_WAIT => -16,
                TAB_READ => -12,
                TAB_EXTRACT_TEXT => -16,
                _ => 0,
            };
        }

        if context.has_clickable_candidate && !context.last_mutate_submitted {
            context_bonus += match tool_name {
                WEB_SCAN_AND_ACT => 20,
                WEB_ACTION_MUTATE => 10,
                WEB_ACTION_SAFE => 8,
                WEB_QUERY_FIND => 6,
                TAB_READ => -6,
                TAB_EXTRACT_TEXT => -8,
                _ => 0,
            };
        }
    } else {
        context_bonus += match tool_name {
            WEB_SCAN_AND_ACT => 28,
            WEB_SKELETON_READ => 22,
            WEB_QUERY_FIND => 18,
            WEB_CONTEXT_READ => 14,
            _ => 0,
        };
    }

    base + approval_bonus + side_effect_bonus + context_bonus
}
