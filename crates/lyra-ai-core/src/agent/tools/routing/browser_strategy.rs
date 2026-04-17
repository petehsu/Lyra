use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::RwLock;

use crate::agent::types::AgentToolCall;

const NATIVE_SKELETON_READ: &str = "workbench.web_skeleton.read";
const NATIVE_QUERY_FIND: &str = "workbench.web_query.find";
const NATIVE_CONTEXT_READ: &str = "workbench.web_context.read";
const NATIVE_SCAN_AND_ACT: &str = "workbench.web_scan_and_act";
const NATIVE_ACTION_SAFE: &str = "workbench.web_action.safe";
const NATIVE_ACTION_MUTATE: &str = "workbench.web_action.mutate";
const NATIVE_ACTION_NAVIGATE: &str = "workbench.web_action.navigate";
const NATIVE_ACTION_WAIT: &str = "workbench.web_action.wait";
const BROWSER_USE_PREPARE: &str = "browser_use.session.prepare";
const BROWSER_USE_STATE: &str = "browser_use.page.state";
const BROWSER_USE_EXTRACT: &str = "browser_use.page.extract";
const BROWSER_USE_SAFE: &str = "browser_use.page.safe";
const BROWSER_USE_MUTATE: &str = "browser_use.page.mutate";
const BROWSER_USE_NAVIGATE: &str = "browser_use.page.navigate";
const BROWSER_USE_WAIT: &str = "browser_use.page.wait";
const BROWSER_USE_AGENT_RUN: &str = "browser_use.agent.run";

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStrategyRuntimeState {
    pub preferred_engine: Option<String>,
    pub browser_use_health: Option<String>,
    #[serde(default)]
    pub browser_use_tool_exposed: bool,
}

#[derive(Clone, Debug, Default)]
pub struct BrowserStrategyRoutingContext {
    pub last_browser_strategy: Option<String>,
    pub browser_use_session_ready: bool,
    pub native_live_candidate_ready: bool,
    pub native_widget_ready: bool,
    pub last_action_verified: bool,
    pub strategy_lease_active: bool,
    pub last_browser_failure_family: Option<String>,
    pub in_long_running_flow: bool,
    pub preferred_engine: Option<String>,
    pub browser_use_health: Option<String>,
    pub browser_use_tool_exposed: bool,
}

static BROWSER_STRATEGY_RUNTIME_STATE: Lazy<RwLock<BrowserStrategyRuntimeState>> =
    Lazy::new(|| RwLock::new(BrowserStrategyRuntimeState::default()));

pub fn set_browser_strategy_runtime_state(state: BrowserStrategyRuntimeState) {
    if let Ok(mut guard) = BROWSER_STRATEGY_RUNTIME_STATE.write() {
        *guard = state;
    }
}

pub fn get_browser_strategy_runtime_state() -> BrowserStrategyRuntimeState {
    BROWSER_STRATEGY_RUNTIME_STATE
        .read()
        .map(|guard| guard.clone())
        .unwrap_or_default()
}

pub fn merge_browser_strategy_runtime_state(
    context: Option<BrowserStrategyRoutingContext>,
) -> Option<BrowserStrategyRoutingContext> {
    let runtime = get_browser_strategy_runtime_state();
    let runtime_has_signal = runtime.preferred_engine.is_some()
        || runtime.browser_use_health.is_some()
        || runtime.browser_use_tool_exposed;
    match (context, runtime_has_signal) {
        (None, false) => None,
        (Some(mut value), _) => {
            value.preferred_engine = runtime.preferred_engine;
            value.browser_use_health = runtime.browser_use_health;
            value.browser_use_tool_exposed = runtime.browser_use_tool_exposed;
            Some(value)
        }
        (None, true) => Some(BrowserStrategyRoutingContext {
            preferred_engine: runtime.preferred_engine,
            browser_use_health: runtime.browser_use_health,
            browser_use_tool_exposed: runtime.browser_use_tool_exposed,
            ..BrowserStrategyRoutingContext::default()
        }),
    }
}

fn is_native_browser_tool(name: &str) -> bool {
    matches!(
        name,
        NATIVE_SKELETON_READ
            | NATIVE_QUERY_FIND
            | NATIVE_CONTEXT_READ
            | NATIVE_SCAN_AND_ACT
            | NATIVE_ACTION_SAFE
            | NATIVE_ACTION_MUTATE
            | NATIVE_ACTION_NAVIGATE
            | NATIVE_ACTION_WAIT
    )
}

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

fn is_browser_tool(name: &str) -> bool {
    is_native_browser_tool(name) || is_browser_use_tool(name)
}

fn has_scan_session(output: &Value) -> bool {
    output
        .get("scanSessionId")
        .and_then(Value::as_str)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn has_live_candidates(output: &Value) -> bool {
    output.get("bestMatch").is_some()
        || output.get("bestNode").is_some()
        || output
            .get("matches")
            .and_then(Value::as_array)
            .map(|items| !items.is_empty())
            .unwrap_or(false)
        || output
            .get("nodes")
            .and_then(Value::as_array)
            .map(|items| !items.is_empty())
            .unwrap_or(false)
}

fn is_long_running_tool(name: &str) -> bool {
    matches!(
        name,
        NATIVE_ACTION_NAVIGATE
            | NATIVE_ACTION_WAIT
            | BROWSER_USE_NAVIGATE
            | BROWSER_USE_WAIT
            | BROWSER_USE_AGENT_RUN
    )
}

pub fn derive_browser_strategy_routing_context(
    tool_calls: &[AgentToolCall],
) -> Option<BrowserStrategyRoutingContext> {
    let recent_browser_calls: Vec<&AgentToolCall> = tool_calls
        .iter()
        .rev()
        .filter(|call| is_browser_tool(&call.tool_name))
        .take(8)
        .collect();
    if recent_browser_calls.is_empty() {
        return None;
    }

    let mut context = BrowserStrategyRoutingContext::default();

    for call in &recent_browser_calls {
        if context.last_browser_strategy.is_none() && call.status == "completed" {
            if is_browser_use_tool(&call.tool_name) {
                context.last_browser_strategy = Some("browser_use".to_string());
                context.strategy_lease_active = true;
            } else if is_native_browser_tool(&call.tool_name) {
                context.last_browser_strategy = Some("native".to_string());
                context.strategy_lease_active = true;
            }
        }

        if context.last_browser_failure_family.is_none()
            && (call.status == "failed" || call.error_code.is_some())
        {
            if is_browser_use_tool(&call.tool_name) {
                context.last_browser_failure_family = Some("browser_use".to_string());
            } else if is_native_browser_tool(&call.tool_name) {
                context.last_browser_failure_family = Some("native".to_string());
            }
        }

        if !context.in_long_running_flow && is_long_running_tool(&call.tool_name) {
            context.in_long_running_flow = true;
        }

        let Some(output) = call.output.as_ref() else {
            continue;
        };

        if call.tool_name == BROWSER_USE_PREPARE && call.status == "completed" {
            context.browser_use_session_ready = true;
        }
        if is_browser_use_tool(&call.tool_name)
            && call.status == "completed"
            && output
                .get("session")
                .and_then(|value| value.get("ready"))
                .and_then(Value::as_bool)
                == Some(true)
        {
            context.browser_use_session_ready = true;
        }
        if call.tool_name == NATIVE_QUERY_FIND
            && call.status == "completed"
            && has_scan_session(output)
            && has_live_candidates(output)
        {
            context.native_live_candidate_ready = true;
        }
        if call.tool_name == NATIVE_SCAN_AND_ACT
            && call.status == "completed"
            && (has_scan_session(output) || output.get("selectedCandidate").is_some())
        {
            context.native_live_candidate_ready = true;
            context.native_widget_ready = true;
        }
        if call.tool_name == NATIVE_SKELETON_READ
            && call.status == "completed"
            && output
                .get("nodes")
                .and_then(Value::as_array)
                .map(|items| !items.is_empty())
                .unwrap_or(false)
        {
            context.native_widget_ready = true;
        }
        if is_native_browser_tool(&call.tool_name)
            && call.status == "completed"
            && output.get("verified").and_then(Value::as_bool) == Some(true)
        {
            context.last_action_verified = true;
        }
        if call.tool_name == NATIVE_SCAN_AND_ACT
            && call.status == "completed"
            && output.get("goalSatisfied").and_then(Value::as_bool) == Some(true)
        {
            context.last_action_verified = true;
        }
    }

    Some(context)
}
