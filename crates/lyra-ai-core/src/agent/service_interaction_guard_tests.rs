use crate::agent::default_turn_runtime::sanitize_planning_output;
use crate::agent::turn_guardrails::{
    browser_action_failure_requires_retry, browser_action_has_verified_transition,
    browser_observed_without_action, browser_observed_without_local_action,
    browser_workflow_batch_advanced, browser_workflow_batch_stalled, has_browser_automation_tools,
    interaction_timeout_message, local_browser_workflow_ready, restricted_browser_action_tools,
};
use crate::agent::turn_progress_guard::{TurnProgressGuardState, AGENT_TURN_PAUSED_NO_PROGRESS};
use crate::agent::types::AgentToolCall;
use crate::provider::types::AgentToolDefinition;
use serde_json::json;

fn failed_tool_call(message: &str) -> AgentToolCall {
    AgentToolCall {
        id: "tool-1".to_string(),
        session_id: "session-1".to_string(),
        turn_id: "turn-1".to_string(),
        tool_name: "request_user_input".to_string(),
        input: json!({}),
        output: None,
        status: "failed".to_string(),
        error_code: Some("AGENT_TURN_FAILED".to_string()),
        error_message: Some(message.to_string()),
        started_at: 1,
        finished_at: Some(2),
    }
}

fn failed_tool_call_with_code(code: &str, message: &str) -> AgentToolCall {
    AgentToolCall {
        id: "tool-1".to_string(),
        session_id: "session-1".to_string(),
        turn_id: "turn-1".to_string(),
        tool_name: "lyra.web.action.mutate".to_string(),
        input: json!({}),
        output: None,
        status: "failed".to_string(),
        error_code: Some(code.to_string()),
        error_message: Some(message.to_string()),
        started_at: 1,
        finished_at: Some(2),
    }
}

fn completed_tool_call(name: &str) -> AgentToolCall {
    AgentToolCall {
        id: "tool-2".to_string(),
        session_id: "session-1".to_string(),
        turn_id: "turn-1".to_string(),
        tool_name: name.to_string(),
        input: json!({}),
        output: Some(json!({ "ok": true })),
        status: "completed".to_string(),
        error_code: None,
        error_message: None,
        started_at: 1,
        finished_at: Some(2),
    }
}

fn completed_verified_browser_action(name: &str, transition: &str) -> AgentToolCall {
    AgentToolCall {
        id: "tool-verified".to_string(),
        session_id: "session-1".to_string(),
        turn_id: "turn-1".to_string(),
        tool_name: name.to_string(),
        input: json!({}),
        output: Some(json!({
            "verified": true,
            "verification": {
                "stateTransition": transition
            }
        })),
        status: "completed".to_string(),
        error_code: None,
        error_message: None,
        started_at: 1,
        finished_at: Some(2),
    }
}

#[test]
fn detects_interaction_timeout_failures() {
    let message = interaction_timeout_message(&[failed_tool_call(
        "plan question timed out waiting for user input",
    )]);
    assert!(message.is_some());
}

#[test]
fn progress_guard_pauses_on_interaction_timeout() {
    let mut guard = TurnProgressGuardState::default();
    let reason = guard.observe_tool_results(&[failed_tool_call(
        "plan approval timed out waiting for user response",
    )]);
    assert!(reason.is_some());
    let reason = reason.expect("pause reason");
    assert_eq!(reason.code, AGENT_TURN_PAUSED_NO_PROGRESS);
    assert!(reason.message.contains("waiting on a user decision"));
}

#[test]
fn progress_guard_pauses_on_approval_required_failure() {
    let mut guard = TurnProgressGuardState::default();
    let reason = guard.observe_tool_results(&[failed_tool_call_with_code(
        "AGENT_TOOL_APPROVAL_REQUIRED",
        "external tool requires user approval: lyra.web.action.mutate",
    )]);
    assert!(reason.is_some());
    let reason = reason.expect("pause reason");
    assert_eq!(reason.code, AGENT_TURN_PAUSED_NO_PROGRESS);
    assert!(reason.message.contains("needs your approval"));
}

#[test]
fn planning_sanitizer_keeps_only_structured_steps() {
    let sanitized = sanitize_planning_output(
        "我会模拟这个过程。\n虽然我无法直接操作浏览器。\n\n计划：\n1. 读取页面状态\n2. 定位目标控件\n3. 执行动作",
    );
    assert_eq!(sanitized, "1. 读取页面状态\n2. 定位目标控件\n3. 执行动作");
}

#[test]
fn browser_workflow_retry_guard_requires_structured_retryable_failure() {
    assert!(browser_action_failure_requires_retry(&[
        failed_tool_call_with_code(
            "workflow_not_advanced",
            "the browser workflow did not advance",
        )
    ]));
    assert!(browser_action_failure_requires_retry(&[
        failed_tool_call_with_code("node_not_found", "unable to resolve target node",)
    ]));
    assert!(!browser_action_failure_requires_retry(&[
        completed_tool_call("lyra.web.action.safe",)
    ]));
    assert!(!browser_action_failure_requires_retry(&[
        failed_tool_call_with_code(
            "protected_verification_widget",
            "captcha challenge requires user handoff",
        )
    ]));
}

#[test]
fn browser_tool_guard_requires_actual_browser_tools() {
    let browser_tools = vec![
        AgentToolDefinition {
            name: "lyra.web.query.find".to_string(),
            description: "query the current page skeleton".to_string(),
            input_schema: json!({"type": "object"}),
        },
        AgentToolDefinition {
            name: "filesystem.read_range".to_string(),
            description: "read a file range".to_string(),
            input_schema: json!({"type": "object"}),
        },
    ];
    assert!(has_browser_automation_tools(&browser_tools));

    let non_browser_tools = vec![AgentToolDefinition {
        name: "filesystem.read_range".to_string(),
        description: "read a file range".to_string(),
        input_schema: json!({"type": "object"}),
    }];
    assert!(!has_browser_automation_tools(&non_browser_tools));
}

#[test]
fn browser_observation_without_action_is_detected() {
    assert!(browser_observed_without_action(&[
        completed_tool_call("lyra.web.skeleton.read"),
        completed_tool_call("workbench.tab.read"),
    ]));
    assert!(!browser_observed_without_action(&[
        completed_tool_call("lyra.web.skeleton.read"),
        completed_tool_call("lyra.web.action.safe"),
    ]));
}

#[test]
fn simple_tab_observation_does_not_require_local_browser_action() {
    assert!(!browser_observed_without_local_action(&[
        completed_tool_call("workbench.tabs.list"),
        completed_tool_call("workbench.tab.read"),
    ]));
}

#[test]
fn browser_observation_without_local_action_treats_navigation_as_insufficient() {
    assert!(browser_observed_without_local_action(&[
        completed_tool_call("lyra.web.skeleton.read"),
        completed_tool_call("lyra.web.action.navigate"),
    ]));
    assert!(!browser_observed_without_local_action(&[
        completed_tool_call("lyra.web.skeleton.read"),
        completed_tool_call("lyra.web.action.mutate"),
    ]));
}

#[test]
fn local_browser_workflow_ready_requires_real_web_context() {
    assert!(local_browser_workflow_ready(&[AgentToolCall {
        id: "tool-widget".to_string(),
        session_id: "session-1".to_string(),
        turn_id: "turn-1".to_string(),
        tool_name: "lyra.web.skeleton.read".to_string(),
        input: json!({}),
        output: Some(json!({
            "nodes": [{
                "nodeId": "node-1",
                "widgetId": "widget-1",
                "widgetKind": "history-list"
            }]
        })),
        status: "completed".to_string(),
        error_code: None,
        error_message: None,
        started_at: 1,
        finished_at: Some(2),
    }]));
    assert!(local_browser_workflow_ready(&[AgentToolCall {
        id: "tool-scan".to_string(),
        session_id: "session-1".to_string(),
        turn_id: "turn-1".to_string(),
        tool_name: "lyra.web.query.find".to_string(),
        input: json!({}),
        output: Some(json!({
            "scanSessionId": "scan-1",
            "bestMatch": {
                "nodeId": "cand-1"
            }
        })),
        status: "completed".to_string(),
        error_code: None,
        error_message: None,
        started_at: 1,
        finished_at: Some(2),
    }]));
    assert!(!local_browser_workflow_ready(&[completed_tool_call(
        "workbench.tabs.list",
    )]));
}

#[test]
fn restricted_browser_action_tools_drop_observation_only_fallbacks() {
    let tools = vec![
        AgentToolDefinition {
            name: "lyra.web.skeleton.read".to_string(),
            description: "read page skeleton".to_string(),
            input_schema: json!({"type": "object"}),
        },
        AgentToolDefinition {
            name: "lyra.web.query.find".to_string(),
            description: "query skeleton nodes".to_string(),
            input_schema: json!({"type": "object"}),
        },
        AgentToolDefinition {
            name: "workbench.tab.capture_visual".to_string(),
            description: "capture screenshot".to_string(),
            input_schema: json!({"type": "object"}),
        },
        AgentToolDefinition {
            name: "lyra.web.action.mutate".to_string(),
            description: "mutate page".to_string(),
            input_schema: json!({"type": "object"}),
        },
    ];

    let restricted = restricted_browser_action_tools(&tools);
    let names = restricted
        .iter()
        .map(|tool| tool.name.as_str())
        .collect::<Vec<_>>();
    assert!(names.contains(&"lyra.web.skeleton.read"));
    assert!(names.contains(&"lyra.web.query.find"));
    assert!(names.contains(&"lyra.web.action.mutate"));
    assert!(!names.contains(&"workbench.tab.capture_visual"));
}

#[test]
fn browser_workflow_stall_batch_detection_requires_stall_failure_family() {
    let stalled = vec![failed_tool_call_with_code(
        "workflow_not_advanced",
        "expand/collapse did not change local region state",
    )];
    assert!(browser_workflow_batch_stalled(&stalled));
    assert!(!browser_workflow_batch_advanced(&stalled));

    let rebinding_failure = vec![failed_tool_call_with_code(
        "candidate_stale",
        "candidate target is no longer available in the active workflow context",
    )];
    assert!(!browser_workflow_batch_stalled(&rebinding_failure));

    let advanced = vec![completed_verified_browser_action(
        "lyra.web.action.mutate",
        "workflow_advanced",
    )];
    assert!(browser_workflow_batch_advanced(&advanced));
    assert!(!browser_workflow_batch_stalled(&advanced));
    assert!(browser_action_has_verified_transition(&advanced[0]));
}

#[test]
fn progress_guard_pauses_after_consecutive_browser_stall_batches() {
    let mut guard = TurnProgressGuardState::default();
    let stalled_batch = vec![failed_tool_call_with_code(
        "workflow_not_advanced",
        "expand/collapse did not change local region state",
    )];
    assert!(guard.observe_tool_results(&stalled_batch).is_none());
    assert!(guard.observe_tool_results(&stalled_batch).is_none());
    assert!(guard.observe_tool_results(&stalled_batch).is_none());
    let reason = guard.observe_tool_results(&stalled_batch);
    assert!(reason.is_some());
    let reason = reason.expect("pause reason");
    assert_eq!(reason.code, AGENT_TURN_PAUSED_NO_PROGRESS);
    assert!(reason.message.contains("browser workflow retried"));
}

#[test]
fn progress_guard_resets_browser_stall_counter_after_verified_advance() {
    let mut guard = TurnProgressGuardState::default();
    let stalled_batch = vec![failed_tool_call_with_code(
        "workflow_not_advanced",
        "expand/collapse did not change local region state",
    )];
    let advanced_batch = vec![completed_verified_browser_action(
        "lyra.web.action.safe",
        "workflow_advanced",
    )];

    assert!(guard.observe_tool_results(&stalled_batch).is_none());
    assert!(guard.observe_tool_results(&advanced_batch).is_none());
    assert!(guard.observe_tool_results(&stalled_batch).is_none());
    assert!(guard.observe_tool_results(&stalled_batch).is_none());
}

#[test]
fn progress_guard_allows_more_retries_after_verified_browser_progress() {
    let mut guard = TurnProgressGuardState::default();
    let advanced_batch = vec![completed_verified_browser_action(
        "lyra.web.action.mutate",
        "workflow_advanced",
    )];
    let stalled_batch = vec![failed_tool_call_with_code(
        "no_state_transition",
        "submit did not produce a clear field change or widget transition",
    )];

    assert!(guard.observe_tool_results(&advanced_batch).is_none());
    for _ in 0..5 {
        assert!(guard.observe_tool_results(&stalled_batch).is_none());
    }
    let reason = guard.observe_tool_results(&stalled_batch);
    assert!(reason.is_some());
    let reason = reason.expect("pause reason");
    assert_eq!(reason.code, AGENT_TURN_PAUSED_NO_PROGRESS);
}
