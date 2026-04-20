use once_cell::sync::Lazy;
use regex::Regex;

use crate::agent::tools::derive_workbench_web_routing_context;
use crate::agent::types::{AgentToolCall, AGENT_TOOL_APPROVAL_REQUIRED};
use crate::provider::types::AgentToolDefinition;

static FACTUAL_CLAIM_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?x)
        (\b\d{4}\b)
        |(\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*%\b)
        |(\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:ms|s|m|h|d|KB|MB|GB|TB|kHz|MHz|GHz|°C|°F)\b)
        |(\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b)
        |(\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b)
        ",
    )
    .expect("valid factual claim regex")
});

pub fn has_browser_automation_tools(tools: &[AgentToolDefinition]) -> bool {
    tools.iter().any(|tool| {
        tool.name.starts_with("lyra.web.")
            || tool.name.starts_with("browser_use.")
            || matches!(
                tool.name.as_str(),
                "workbench.tabs.list"
                    | "workbench.tab.read"
                    | "workbench.tab.extract_text"
                    | "lyra.web.skeleton.read"
            )
    })
}

fn is_browser_observation_tool_name(name: &str) -> bool {
    (name.starts_with("lyra.web.")
        && !name.starts_with("lyra.web.action.")
        && name != "lyra.web.focus.probe"
        && name != "lyra.web.scan.act")
        || matches!(
            name,
            "workbench.tabs.list"
                | "workbench.tab.read"
                | "workbench.tab.extract_text"
                | "workbench.tab.capture_visual"
                | "browser_use.session.prepare"
                | "browser_use.page.state"
                | "browser_use.page.extract"
        )
}

fn is_browser_interaction_observation_tool_name(name: &str) -> bool {
    (name.starts_with("lyra.web.")
        && !name.starts_with("lyra.web.action.")
        && name != "lyra.web.focus.probe"
        && name != "lyra.web.scan.act")
        || matches!(
            name,
            "workbench.tab.capture_visual"
                | "browser_use.session.prepare"
                | "browser_use.page.state"
                | "browser_use.page.extract"
        )
}

fn is_browser_action_tool_name(name: &str) -> bool {
    matches!(
        name,
        "lyra.web.focus.probe"
            | "lyra.web.scan.act"
            | "lyra.web.action.safe"
            | "lyra.web.action.mutate"
            | "lyra.web.action.navigate"
            | "lyra.web.action.wait"
            | "browser_use.page.safe"
            | "browser_use.page.mutate"
            | "browser_use.page.navigate"
            | "browser_use.page.wait"
            | "browser_use.agent.run"
    )
}

fn is_local_browser_action_tool_name(name: &str) -> bool {
    matches!(
        name,
        "lyra.web.focus.probe"
            | "lyra.web.scan.act"
            | "lyra.web.action.safe"
            | "lyra.web.action.mutate"
            | "lyra.web.action.wait"
            | "browser_use.page.safe"
            | "browser_use.page.mutate"
            | "browser_use.page.wait"
            | "browser_use.agent.run"
    )
}

fn has_browser_interaction_observation_progress(tool_calls: &[AgentToolCall]) -> bool {
    tool_calls.iter().any(|call| {
        call.status == "completed" && is_browser_interaction_observation_tool_name(&call.tool_name)
    })
}

fn has_browser_action_attempt(tool_calls: &[AgentToolCall]) -> bool {
    tool_calls
        .iter()
        .any(|call| is_browser_action_tool_name(&call.tool_name))
}

fn has_local_browser_action_attempt(tool_calls: &[AgentToolCall]) -> bool {
    tool_calls
        .iter()
        .any(|call| is_local_browser_action_tool_name(&call.tool_name))
}

pub fn browser_observed_without_action(tool_calls: &[AgentToolCall]) -> bool {
    has_browser_interaction_observation_progress(tool_calls)
        && !has_browser_action_attempt(tool_calls)
}

pub fn browser_observed_without_local_action(tool_calls: &[AgentToolCall]) -> bool {
    has_browser_interaction_observation_progress(tool_calls)
        && !has_local_browser_action_attempt(tool_calls)
}

pub fn browser_action_retry_message() -> String {
    "[Execution Requirement] You already inspected the open webpage, so do not end the turn with an observation-only answer. Before you conclude that the task cannot be completed, you must attempt at least one local page action tool or obtain a structured local browser action error. A navigation attempt does not satisfy this requirement when the task still requires in-page interaction. Reuse page observations that already exist. Prefer the native workbench page tools first, starting with scan_and_act, then skeleton read, structured query, local context read, focus probe, hover/safe actions, mutate actions, and wait. If a control appears only after hover or menu reveal, perform the hover step before concluding the control is absent.".to_string()
}

pub fn browser_action_unmet_message() -> String {
    "I paused because the browser task only used observation tools and still never attempted a local page action. I need at least one real local browser action attempt or a structured local action failure before I can honestly conclude the task.".to_string()
}

pub fn browser_workflow_retry_message() -> String {
    "[Execution Requirement] The local browser workflow is still incomplete because the latest browser action failed with a retryable structured error. Continue from the current local workflow state, prefer skeleton/query/context reads and local focus probe state, and avoid broad fallback rebuilds unless the local workflow fails again.".to_string()
}

pub fn browser_workflow_unmet_message() -> String {
    "I paused because the latest browser action failed with a retryable structured workflow error and I still have not advanced the local browser workflow.".to_string()
}

pub fn grounding_retry_message() -> String {
    "[Grounding Requirement] The previous draft answer was definitive but this turn has no verification evidence yet.\nBefore concluding, do exactly one of the following:\n1. Use tools to verify the core claims.\n2. Ask a blocking clarifying question that removes the ambiguity.\nDo not end with an unverified definitive answer."
        .to_string()
}

pub fn grounding_unmet_message() -> String {
    "I paused because I still do not have verification evidence for a definitive answer. Please confirm whether I should verify with tools now, or provide additional constraints so I can answer accurately.".to_string()
}

pub fn has_verification_evidence(tool_calls: &[AgentToolCall]) -> bool {
    tool_calls.iter().any(|call| {
        call.status == "completed"
            && !matches!(
                call.tool_name.as_str(),
                "request_user_input" | "plan.submit_for_approval"
            )
    })
}

pub fn should_emit_live_assistant_delta(plan_mode: bool) -> bool {
    // Do not expose pre-gate draft answers in normal execution. This prevents
    // "answer first, ask later" UX when quality clarification is required.
    plan_mode
}

fn question_like_input(input: &str) -> bool {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return false;
    }
    trimmed.contains('?') || trimmed.contains('？')
}

fn count_declarative_segments(text: &str) -> usize {
    text.split(|ch| matches!(ch, '.' | '!' | '。' | '！' | ';' | '；' | '\n'))
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .filter(|segment| !segment.ends_with('?') && !segment.ends_with('？'))
        .count()
}

fn assistant_answer_looks_definitive(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.contains('?') || trimmed.contains('？') {
        return false;
    }
    count_declarative_segments(trimmed) >= 2
}

pub fn grounding_guard_reason(user_input: &str, assistant_text: &str) -> Option<&'static str> {
    if !assistant_answer_looks_definitive(assistant_text) {
        return None;
    }
    if question_like_input(user_input) {
        return Some("question_turn_without_evidence");
    }
    let declarative_count = count_declarative_segments(assistant_text);
    if declarative_count >= 3 && FACTUAL_CLAIM_RE.is_match(assistant_text) {
        return Some("structured_factual_claims_without_evidence");
    }
    None
}

pub fn restricted_browser_action_tools(tools: &[AgentToolDefinition]) -> Vec<AgentToolDefinition> {
    let allowed_names = [
        "workbench.tabs.list",
        "workbench.tab.read",
        "lyra.web.skeleton.read",
        "lyra.web.query.find",
        "lyra.web.context.read",
        "lyra.web.focus.probe",
        "lyra.web.scan.act",
        "lyra.web.action.safe",
        "lyra.web.action.mutate",
        "lyra.web.action.navigate",
        "lyra.web.action.wait",
        "browser_use.session.prepare",
        "browser_use.page.state",
        "browser_use.page.safe",
        "browser_use.page.mutate",
        "browser_use.page.navigate",
        "browser_use.page.wait",
        "browser_use.agent.run",
    ];
    let filtered = tools
        .iter()
        .filter(|tool| allowed_names.contains(&tool.name.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if filtered.is_empty() {
        tools.to_vec()
    } else {
        filtered
    }
}

pub fn local_browser_workflow_ready(tool_calls: &[AgentToolCall]) -> bool {
    derive_workbench_web_routing_context(tool_calls)
        .map(|web| {
            web.focus_atlas_ready
                || web.widget_graph_ready
                || web.native_widget_ready
                || web.has_live_candidates
                || web.active_widget_id.is_some()
                || web.active_item_id.is_some()
                || web.active_focus_region_id.is_some()
        })
        .unwrap_or(false)
}

fn is_retryable_browser_workflow_failure_code(code: &str) -> bool {
    matches!(
        code,
        "candidate_stale"
            | "candidate_not_found"
            | "scan_session_not_found"
            | "node_not_found"
            | "postcondition_timeout"
            | "hover_reveal_required"
            | "reveal_not_observed"
            | "menu_not_opened"
            | "list_item_not_changed"
            | "mode_not_switched"
            | "workflow_not_advanced"
            | "wrong_widget_target"
            | "no_state_transition"
    )
}

pub fn browser_action_failure_requires_retry(tool_calls: &[AgentToolCall]) -> bool {
    tool_calls
        .iter()
        .rev()
        .find(|call| is_browser_action_tool_name(&call.tool_name))
        .map(|call| {
            call.status == "failed"
                && call
                    .error_code
                    .as_deref()
                    .map(is_retryable_browser_workflow_failure_code)
                    .unwrap_or(false)
        })
        .unwrap_or(false)
}

fn is_browser_workflow_tool_name(name: &str) -> bool {
    name.starts_with("lyra.web.") || name.starts_with("browser_use.")
}

pub fn browser_action_has_verified_transition(tool_call: &AgentToolCall) -> bool {
    if tool_call.status != "completed" || !is_local_browser_action_tool_name(&tool_call.tool_name) {
        return false;
    }
    let Some(output) = tool_call.output.as_ref() else {
        return false;
    };
    if tool_call.tool_name == "lyra.web.action.wait" {
        return output
            .get("satisfied")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
    }
    if output
        .get("verified")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
    {
        let state_transition = output
            .pointer("/verification/stateTransition")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        return !state_transition.trim().is_empty()
            && !state_transition.eq_ignore_ascii_case("none");
    }
    false
}

pub fn browser_workflow_batch_advanced(tool_calls: &[AgentToolCall]) -> bool {
    tool_calls
        .iter()
        .any(browser_action_has_verified_transition)
}

fn is_workflow_stall_failure_code(code: &str) -> bool {
    matches!(
        code,
        "no_state_transition"
            | "workflow_not_advanced"
            | "wrong_widget_target"
            | "list_item_not_changed"
            | "mode_not_switched"
            | "menu_not_opened"
            | "reveal_not_observed"
            | "hover_reveal_required"
    )
}

pub fn browser_workflow_batch_stalled(tool_calls: &[AgentToolCall]) -> bool {
    let has_browser_tool = tool_calls
        .iter()
        .any(|call| is_browser_workflow_tool_name(&call.tool_name));
    if !has_browser_tool {
        return false;
    }
    let has_local_action_attempt = tool_calls
        .iter()
        .any(|call| is_local_browser_action_tool_name(&call.tool_name));
    if !has_local_action_attempt || browser_workflow_batch_advanced(tool_calls) {
        return false;
    }
    tool_calls.iter().any(|call| {
        call.status == "failed"
            && call
                .error_code
                .as_deref()
                .map(is_workflow_stall_failure_code)
                .unwrap_or(false)
    })
}

pub fn has_browser_workflow_stall_failure(tool_calls: &[AgentToolCall]) -> bool {
    tool_calls.iter().any(|call| {
        call.status == "failed"
            && is_local_browser_action_tool_name(&call.tool_name)
            && call
                .error_code
                .as_deref()
                .map(is_workflow_stall_failure_code)
                .unwrap_or(false)
    })
}

pub fn interaction_timeout_message(tool_calls: &[AgentToolCall]) -> Option<String> {
    tool_calls.iter().find_map(|tool_call| {
        if tool_call.status == "failed"
            && tool_call.error_code.as_deref() == Some(AGENT_TOOL_APPROVAL_REQUIRED)
        {
            return Some(
                "I paused because a tool action needs your approval before I can continue."
                    .to_string(),
            );
        }
        if tool_call.status == "failed" && tool_call.error_code.as_deref() == Some("AGENT_TOOL_DENIED")
        {
            return Some(
                "I paused because a required tool action was denied, so I cannot claim it completed."
                    .to_string(),
            );
        }
        let message = tool_call.error_message.as_deref()?;
        if message.contains("timed out waiting for user input")
            || message.contains("timed out waiting for user response")
        {
            return Some(
                "I paused because the turn is waiting on a user decision that never reached the UI in time."
                    .to_string(),
            );
        }
        None
    })
}
