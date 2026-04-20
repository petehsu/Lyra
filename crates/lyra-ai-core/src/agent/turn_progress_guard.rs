use serde_json::Value;

use crate::agent::turn_guardrails::{
    browser_workflow_batch_advanced, browser_workflow_batch_stalled,
    has_browser_workflow_stall_failure, interaction_timeout_message,
};
use crate::agent::types::AgentToolCall;
use crate::provider::types::AgentToolInvocation;

pub const AGENT_TURN_PAUSED_SOFT_CAP: &str = "AGENT_TURN_PAUSED_SOFT_CAP";
pub const AGENT_TURN_PAUSED_NO_PROGRESS: &str = "AGENT_TURN_PAUSED_NO_PROGRESS";

#[derive(Clone, Debug)]
pub struct PauseReason {
    pub code: String,
    pub message: String,
}

#[derive(Default)]
pub struct TurnProgressGuardState {
    caller_soft_cap: Option<u32>,
    soft_cap_message: Option<String>,
    repeated_tool_fingerprint: Option<(String, u32)>,
    repeated_failure_fingerprint: Option<(String, u32)>,
    repeated_loop_fingerprint: Option<(String, u32)>,
    repeated_zero_write: Option<(String, u32)>,
    consecutive_browser_stall_batches: u32,
    browser_workflow_advanced_once: bool,
}

impl TurnProgressGuardState {
    pub fn new(caller_soft_cap: Option<u32>, soft_cap_message: Option<String>) -> Self {
        Self {
            caller_soft_cap,
            soft_cap_message,
            ..Self::default()
        }
    }

    pub fn before_step(&self, step_index: u32) -> Option<PauseReason> {
        let cap = self.caller_soft_cap?;
        if step_index < cap {
            return None;
        }
        Some(PauseReason {
            code: AGENT_TURN_PAUSED_SOFT_CAP.to_string(),
            message: self.soft_cap_message.clone().unwrap_or_else(|| {
                format!(
                    "the current request reached the caller-provided soft cap ({cap} tool steps)"
                )
            }),
        })
    }

    pub fn observe_inference(
        &mut self,
        assistant_text: &str,
        tool_calls: &[AgentToolInvocation],
    ) -> Option<PauseReason> {
        if tool_calls.is_empty() {
            self.repeated_tool_fingerprint = None;
            self.repeated_loop_fingerprint = None;
            return None;
        }

        let tool_fingerprint = fingerprint_tool_invocations(tool_calls);
        let tool_count =
            bump_repeated_fingerprint(&mut self.repeated_tool_fingerprint, tool_fingerprint);

        let loop_fingerprint = format!(
            "{}::{}",
            assistant_text.trim(),
            fingerprint_tool_invocations(tool_calls)
        );
        let loop_count =
            bump_repeated_fingerprint(&mut self.repeated_loop_fingerprint, loop_fingerprint);

        if tool_count >= 3 || loop_count >= 3 {
            return Some(PauseReason {
                code: AGENT_TURN_PAUSED_NO_PROGRESS.to_string(),
                message:
                    "I detected a repeated tool loop with the same plan and inputs, so I paused instead of spinning."
                        .to_string(),
            });
        }

        None
    }

    pub fn observe_tool_results(&mut self, tool_calls: &[AgentToolCall]) -> Option<PauseReason> {
        let batch_advanced = browser_workflow_batch_advanced(tool_calls);
        if batch_advanced {
            self.browser_workflow_advanced_once = true;
        }

        if browser_workflow_batch_stalled(tool_calls) {
            self.consecutive_browser_stall_batches =
                self.consecutive_browser_stall_batches.saturating_add(1);
            let browser_stall_threshold = if self.browser_workflow_advanced_once {
                6
            } else {
                4
            };
            if self.consecutive_browser_stall_batches >= browser_stall_threshold {
                return Some(PauseReason {
                    code: AGENT_TURN_PAUSED_NO_PROGRESS.to_string(),
                    message: "the browser workflow retried several local actions without any verified state transition, so I paused to avoid looping".to_string(),
                });
            }
        } else if batch_advanced {
            self.consecutive_browser_stall_batches = 0;
        }

        if let Some(message) = interaction_timeout_message(tool_calls) {
            return Some(PauseReason {
                code: AGENT_TURN_PAUSED_NO_PROGRESS.to_string(),
                message,
            });
        }

        if let Some(fingerprint) = fingerprint_recoverable_failure(tool_calls) {
            let count =
                bump_repeated_fingerprint(&mut self.repeated_failure_fingerprint, fingerprint);
            let repeated_failure_threshold = if has_browser_workflow_stall_failure(tool_calls) {
                if self.browser_workflow_advanced_once {
                    6
                } else {
                    4
                }
            } else {
                3
            };
            if count >= repeated_failure_threshold {
                return Some(PauseReason {
                    code: AGENT_TURN_PAUSED_NO_PROGRESS.to_string(),
                    message:
                        "the same recoverable tool failure repeated several times without converging"
                            .to_string(),
                });
            }
        } else {
            self.repeated_failure_fingerprint = None;
        }

        if let Some(path) = fingerprint_zero_write(tool_calls) {
            let count = bump_repeated_fingerprint(&mut self.repeated_zero_write, path);
            if count >= 2 {
                return Some(PauseReason {
                    code: AGENT_TURN_PAUSED_NO_PROGRESS.to_string(),
                    message:
                        "the same file write loop produced no net change, so I paused to avoid thrashing"
                            .to_string(),
                });
            }
        } else {
            self.repeated_zero_write = None;
        }

        None
    }
}

fn bump_repeated_fingerprint(slot: &mut Option<(String, u32)>, fingerprint: String) -> u32 {
    if let Some((current, count)) = slot.as_mut() {
        if *current == fingerprint {
            *count += 1;
            return *count;
        }
    }
    *slot = Some((fingerprint, 1));
    1
}

fn fingerprint_tool_invocations(tool_calls: &[AgentToolInvocation]) -> String {
    tool_calls
        .iter()
        .map(|tool_call| {
            let normalized = normalize_json_value(&tool_call.input);
            format!(
                "{}:{}",
                tool_call.name,
                serde_json::to_string(&normalized).unwrap_or_else(|_| "{}".to_string())
            )
        })
        .collect::<Vec<_>>()
        .join("|")
}

fn normalize_json_value(value: &Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.iter().map(normalize_json_value).collect()),
        Value::Object(map) => {
            let mut entries = map.iter().collect::<Vec<_>>();
            entries.sort_by(|left, right| left.0.cmp(right.0));
            let mut normalized = serde_json::Map::new();
            for (key, value) in entries {
                normalized.insert(key.clone(), normalize_json_value(value));
            }
            Value::Object(normalized)
        }
        _ => value.clone(),
    }
}

fn fingerprint_recoverable_failure(tool_calls: &[AgentToolCall]) -> Option<String> {
    let fingerprints = tool_calls
        .iter()
        .filter_map(|tool_call| {
            if tool_call.status == "failed" {
                let code = tool_call.error_code.clone().unwrap_or_default();
                let message = tool_call.error_message.clone().unwrap_or_default();
                return Some(format!(
                    "failed:{}:{}:{}",
                    tool_call.tool_name, code, message
                ));
            }
            let kind = tool_call
                .output
                .as_ref()
                .and_then(|output| output.get("kind"))
                .and_then(Value::as_str)?;
            if matches!(
                kind,
                "no_match" | "unchanged" | "interactive_advisory" | "interactive_policy_blocked"
            ) {
                let path = extract_tool_path(tool_call).unwrap_or_default();
                return Some(format!(
                    "recoverable:{}:{}:{}",
                    tool_call.tool_name, kind, path
                ));
            }
            None
        })
        .collect::<Vec<_>>();

    if fingerprints.is_empty() {
        None
    } else {
        Some(fingerprints.join("|"))
    }
}

fn fingerprint_zero_write(tool_calls: &[AgentToolCall]) -> Option<String> {
    let fingerprints = tool_calls
        .iter()
        .filter_map(|tool_call| {
            if !matches!(
                tool_call.tool_name.as_str(),
                "filesystem.write" | "filesystem.edit" | "filesystem.multi_edit"
            ) {
                return None;
            }
            let kind = tool_call
                .output
                .as_ref()
                .and_then(|output| output.get("kind"))
                .and_then(Value::as_str)?;
            if !matches!(kind, "unchanged" | "no_match") {
                return None;
            }
            extract_tool_path(tool_call)
        })
        .collect::<Vec<_>>();
    if fingerprints.is_empty() {
        None
    } else {
        Some(fingerprints.join("|"))
    }
}

fn extract_tool_path(tool_call: &AgentToolCall) -> Option<String> {
    tool_call
        .output
        .as_ref()
        .and_then(|output| output.get("path"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            tool_call
                .input
                .as_object()
                .and_then(|input| input.get("path"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}
