use serde_json::Value;

use crate::agent::types::AgentToolCall;

const WEB_TARGET_SCAN: &str = "workbench.web_target.scan";
const WEB_GRAPH_BUILD: &str = "workbench.web_graph.build";
const WEB_GRAPH_QUERY: &str = "workbench.web_graph.query";
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
    pub last_failure_code: Option<String>,
    pub last_web_tool_name: Option<String>,
    pub last_graph_fallback_succeeded: bool,
    pub last_mutate_draft_only: bool,
    pub last_mutate_submitted: bool,
}

fn is_web_tool(name: &str) -> bool {
    matches!(
        name,
        WEB_TARGET_SCAN
            | WEB_GRAPH_BUILD
            | WEB_GRAPH_QUERY
            | WEB_ACTION_SAFE
            | WEB_ACTION_MUTATE
            | WEB_ACTION_NAVIGATE
            | WEB_ACTION_WAIT
    )
}

fn has_non_empty_array(value: Option<&Value>) -> bool {
    value.and_then(Value::as_array)
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
    name == WEB_ACTION_MUTATE
}

fn candidate_interactable_bool(candidate: &Value, key: &str) -> bool {
    candidate
        .get("interactable")
        .and_then(|value| value.get(key))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn scan_has_interactable_candidate(output: &Value, key: &str) -> bool {
    output
        .get("bestCandidate")
        .map(|candidate| candidate_interactable_bool(candidate, key))
        .unwrap_or(false)
        || output
            .get("candidates")
            .and_then(Value::as_array)
            .map(|items| items.iter().any(|candidate| candidate_interactable_bool(candidate, key)))
            .unwrap_or(false)
}

fn output_bool(output: &Value, key: &str) -> Option<bool> {
    output.get(key).and_then(Value::as_bool)
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

        let Some(output) = call.output.as_ref() else {
            continue;
        };

        if has_scan_session(output) {
            context.has_live_scan_session = true;
        }
        if call.tool_name == WEB_TARGET_SCAN
            && (has_non_empty_array(output.get("candidates")) || output.get("bestCandidate").is_some())
        {
            context.has_live_candidates = true;
            if scan_has_interactable_candidate(output, "typable") {
                context.has_typable_candidate = true;
            }
            if scan_has_interactable_candidate(output, "clickable") {
                context.has_clickable_candidate = true;
            }
        }
        if is_mutate_tool(&call.tool_name) && call.status == "completed" {
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
        }
        if matches!(call.tool_name.as_str(), WEB_GRAPH_BUILD | WEB_GRAPH_QUERY) && call.status == "completed"
        {
            context.last_graph_fallback_succeeded = true;
        }
    }

    Some(context)
}
