use serde_json::Value;

use crate::agent::types::AgentToolCall;

const WEB_SKELETON_READ: &str = "workbench.web_skeleton.read";
const WEB_QUERY_FIND: &str = "workbench.web_query.find";
const WEB_CONTEXT_READ: &str = "workbench.web_context.read";
const WEB_FOCUS_PROBE: &str = "workbench.web_focus.probe";
const WEB_SCAN_AND_ACT: &str = "workbench.web_scan_and_act";
const WEB_ACTION_SAFE: &str = "workbench.web_action.safe";
const WEB_ACTION_MUTATE: &str = "workbench.web_action.mutate";
const WEB_ACTION_NAVIGATE: &str = "workbench.web_action.navigate";
const WEB_ACTION_WAIT: &str = "workbench.web_action.wait";

#[derive(Clone, Debug, Default)]
pub struct WorkbenchWebRoutingContext {
    pub has_live_scan_session: bool,
    pub has_live_candidates: bool,
    pub has_typable_candidate: bool,
    pub has_clickable_candidate: bool,
    pub page_mode: Option<String>,
    pub focus_atlas_ready: bool,
    pub widget_graph_ready: bool,
    pub native_widget_ready: bool,
    pub active_widget_id: Option<String>,
    pub active_item_id: Option<String>,
    pub active_focus_region_id: Option<String>,
    pub current_browser_subgoal: Option<String>,
    pub last_reveal_observed: bool,
    pub last_focus_probe_verified: bool,
    pub last_focus_delta_observed: bool,
    pub last_action_verified: bool,
    pub last_workflow_failure: Option<String>,
    pub last_verification_failure: Option<String>,
    pub last_failure_code: Option<String>,
    pub last_web_tool_name: Option<String>,
    pub last_graph_fallback_succeeded: bool,
    pub last_mutate_draft_only: bool,
    pub last_mutate_submitted: bool,
}

fn is_web_tool(name: &str) -> bool {
    matches!(
        name,
        WEB_SKELETON_READ
            | WEB_QUERY_FIND
            | WEB_CONTEXT_READ
            | WEB_FOCUS_PROBE
            | WEB_SCAN_AND_ACT
            | WEB_ACTION_SAFE
            | WEB_ACTION_MUTATE
            | WEB_ACTION_NAVIGATE
            | WEB_ACTION_WAIT
    )
}

fn has_non_empty_array(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_array)
        .map(|items| !items.is_empty())
        .unwrap_or(false)
}

fn has_scan_session(output: &Value) -> bool {
    output
        .get("scanSessionId")
        .and_then(Value::as_str)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn is_mutate_tool(name: &str) -> bool {
    name == WEB_ACTION_MUTATE || name == WEB_SCAN_AND_ACT
}

fn output_string(output: &Value, key: &str) -> Option<String> {
    output
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn output_nested_string(output: &Value, path: &[&str]) -> Option<String> {
    let mut current = output;
    for segment in path {
        current = current.get(*segment)?;
    }
    current
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn output_bool(output: &Value, key: &str) -> Option<bool> {
    output.get(key).and_then(Value::as_bool)
}

fn output_nested_bool(output: &Value, path: &[&str]) -> Option<bool> {
    let mut current = output;
    for segment in path {
        current = current.get(*segment)?;
    }
    current.as_bool()
}

fn candidate_capability_bool(candidate: &Value, key: &str) -> bool {
    candidate
        .get("capabilities")
        .and_then(|value| value.get(key))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn scan_has_interactable_candidate(output: &Value, key: &str) -> bool {
    output
        .get("bestMatch")
        .map(|candidate| candidate_capability_bool(candidate, key))
        .unwrap_or(false)
        || output
            .get("bestNode")
            .map(|candidate| candidate_capability_bool(candidate, key))
            .unwrap_or(false)
        || output
            .get("matches")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .any(|candidate| candidate_capability_bool(candidate, key))
            })
            .unwrap_or(false)
        || output
            .get("nodes")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .any(|candidate| candidate_capability_bool(candidate, key))
            })
            .unwrap_or(false)
}

fn output_node_string(output: &Value, key: &str) -> Option<String> {
    output_nested_string(output, &["bestMatch", key])
        .or_else(|| output_nested_string(output, &["bestNode", key]))
        .or_else(|| output_nested_string(output, &["node", key]))
        .or_else(|| output_nested_string(output, &["selectedCandidate", key]))
        .or_else(|| output_nested_string(output, &["actionResult", "verification", key]))
}

pub fn derive_workbench_web_routing_context(
    tool_calls: &[AgentToolCall],
) -> Option<WorkbenchWebRoutingContext> {
    let recent_web_calls: Vec<&AgentToolCall> = tool_calls
        .iter()
        .rev()
        .filter(|call| is_web_tool(&call.tool_name))
        .take(5)
        .collect();
    if recent_web_calls.is_empty() {
        return None;
    }

    let mut context = WorkbenchWebRoutingContext::default();

    for call in &recent_web_calls {
        if context.last_web_tool_name.is_none() {
            context.last_web_tool_name = Some(call.tool_name.clone());
        }
        if context.last_failure_code.is_none() {
            context.last_failure_code = call.error_code.clone();
        }
        if context.last_workflow_failure.is_none() {
            context.last_workflow_failure = call.error_code.clone().filter(|value| {
                matches!(
                    value.as_str(),
                    "hover_reveal_required"
                        | "reveal_not_observed"
                        | "menu_not_opened"
                        | "list_item_not_changed"
                        | "mode_not_switched"
                        | "workflow_not_advanced"
                        | "wrong_widget_target"
                        | "no_state_transition"
                )
            });
        }
        if context.current_browser_subgoal.is_none() {
            context.current_browser_subgoal = match call.error_code.as_deref() {
                Some("hover_reveal_required" | "reveal_not_observed") => {
                    Some("reveal item actions".to_string())
                }
                Some("menu_not_opened") => Some("open item menu".to_string()),
                Some("list_item_not_changed") => Some("execute menu action".to_string()),
                Some("mode_not_switched") => Some("toggle mode".to_string()),
                Some("workflow_not_advanced") => Some("act".to_string()),
                _ => None,
            };
        }

        let Some(output) = call.output.as_ref() else {
            continue;
        };

        if has_scan_session(output) {
            context.has_live_scan_session = true;
        }
        if !context.focus_atlas_ready {
            context.focus_atlas_ready = output.get("skeletonVersion").is_some()
                || output.get("atlas").is_some()
                || output.get("regions").is_some();
        }
        if context.page_mode.is_none() {
            context.page_mode = output_string(output, "pageMode")
                .or_else(|| output_nested_string(output, &["atlas", "pageMode"]));
        }
        if context.active_focus_region_id.is_none() {
            context.active_focus_region_id = output_string(output, "activeRegionId")
                .or_else(|| output_string(output, "activeFocusRegionId"))
                .or_else(|| output_nested_string(output, &["atlas", "activeFocusRegionId"]));
        }
        if !context.last_focus_probe_verified {
            context.last_focus_probe_verified = output_bool(output, "focusProbeVerified")
                .or_else(|| output_bool(output, "lastFocusProbeVerified"))
                .unwrap_or(false);
        }
        if !context.last_focus_delta_observed {
            context.last_focus_delta_observed = output_bool(output, "focusDeltaObserved")
                .or_else(|| output_bool(output, "lastFocusDeltaObserved"))
                .unwrap_or(false);
        }
        if context.active_widget_id.is_none() {
            context.active_widget_id = output_node_string(output, "widgetId")
                .or_else(|| output_node_string(output, "ownerWidgetId"))
                .or_else(|| output_node_string(output, "groupId"))
                .or_else(|| output_nested_string(output, &["verification", "widgetId"]));
        }
        if context.active_item_id.is_none() {
            let widget_kind = output_node_string(output, "widgetKind");
            let widget_id = output_node_string(output, "widgetId");
            let owner_widget_id = output_node_string(output, "ownerWidgetId")
                .or_else(|| output_node_string(output, "groupId"));
            if matches!(
                widget_kind.as_deref(),
                Some("list-item" | "menu-trigger" | "menu-panel")
            ) {
                context.active_item_id = widget_id.or(owner_widget_id);
            } else if owner_widget_id.is_some() {
                context.active_item_id = owner_widget_id;
            }
        }

        if call.tool_name == WEB_SKELETON_READ && has_non_empty_array(output.get("nodes")) {
            context.widget_graph_ready = true;
            context.native_widget_ready = true;
            if context.current_browser_subgoal.is_none() {
                context.current_browser_subgoal = Some("locate target".to_string());
            }
        }
        if (call.tool_name == WEB_QUERY_FIND || call.tool_name == WEB_CONTEXT_READ)
            && (has_non_empty_array(output.get("matches"))
                || has_non_empty_array(output.get("nodes"))
                || output.get("bestMatch").is_some()
                || output.get("bestNode").is_some())
        {
            context.has_live_candidates = true;
            if scan_has_interactable_candidate(output, "editable") {
                context.has_typable_candidate = true;
            }
            if scan_has_interactable_candidate(output, "clickable") {
                context.has_clickable_candidate = true;
            }
            if context.current_browser_subgoal.is_none() {
                context.current_browser_subgoal = Some("locate target".to_string());
            }
            if output_nested_string(output, &["bestMatch", "discoveryMode"])
                .map(|value| value == "hover_revealed" || value == "action_revealed")
                .unwrap_or(false)
            {
                context.last_reveal_observed = true;
                if context.current_browser_subgoal.is_none() {
                    context.current_browser_subgoal = Some("open item menu".to_string());
                }
            }
        }
        if call.tool_name == WEB_SCAN_AND_ACT {
            if output.get("selectedCandidate").is_some() {
                context.has_live_candidates = true;
                if output_nested_string(output, &["selectedCandidate", "role"])
                    .map(|value| matches!(value.as_str(), "textbox" | "searchbox" | "combobox"))
                    .unwrap_or(false)
                    || output_nested_string(output, &["selectedCandidate", "tagName"])
                        .map(|value| value == "input" || value == "textarea" || value == "select")
                        .unwrap_or(false)
                    || output_nested_bool(output, &["selectedCandidate", "interactable", "typable"])
                        .unwrap_or(false)
                {
                    context.has_typable_candidate = true;
                }
                if output_nested_bool(output, &["selectedCandidate", "interactable", "clickable"])
                    .unwrap_or(false)
                {
                    context.has_clickable_candidate = true;
                }
            }
            if output_bool(output, "verified").unwrap_or(false)
                || output_bool(output, "goalSatisfied").unwrap_or(false)
                || output_bool(output, "ok").unwrap_or(false)
            {
                context.last_action_verified = true;
            }
            if output_bool(output, "goalSatisfied") == Some(false)
                && context.last_workflow_failure.is_none()
            {
                context.last_workflow_failure = Some("workflow_not_advanced".to_string());
            }
            if output_nested_string(output, &["actionResult", "verification", "stateTransition"])
                .map(|value| value == "menu_opened" || value == "region_expanded")
                .unwrap_or(false)
            {
                context.last_reveal_observed = true;
            }
        }
        if call.tool_name == WEB_FOCUS_PROBE {
            context.focus_atlas_ready = output.get("atlas").is_some();
            if output_bool(output, "focusProbeVerified") == Some(true) {
                context.last_focus_probe_verified = true;
            }
            if output_bool(output, "focusDeltaObserved") == Some(true) {
                context.last_focus_delta_observed = true;
            }
            if context.current_browser_subgoal.is_none() {
                context.current_browser_subgoal = Some("locate target".to_string());
            }
        }
        if is_mutate_tool(&call.tool_name) && call.status == "completed" {
            if output_bool(output, "verified") == Some(true) {
                context.last_action_verified = true;
            }
            if context.last_verification_failure.is_none() {
                context.last_verification_failure = output
                    .get("verification")
                    .and_then(|value| value.get("reason"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string);
            }
            if output_bool(output, "submitted") == Some(true) {
                context.last_mutate_submitted = true;
            }
            if output_bool(output, "draftOnly") == Some(true)
                || (output_bool(output, "submitted") == Some(false)
                    && output
                        .get("actionKind")
                        .and_then(Value::as_str)
                        .map(|value| matches!(value, "type" | "clear_and_type" | "press_key"))
                        .unwrap_or(false))
            {
                context.last_mutate_draft_only = true;
            }
            if output_nested_string(output, &["verification", "stateTransition"])
                .map(|value| value == "menu_opened" || value == "region_expanded")
                .unwrap_or(false)
            {
                context.last_reveal_observed = true;
            }
        }
    }

    Some(context)
}
