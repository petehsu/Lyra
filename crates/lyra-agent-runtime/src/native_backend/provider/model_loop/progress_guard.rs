use super::*;

#[derive(Debug, Default)]
pub(crate) struct ModelLoopProgressGuard {
    last_fingerprint: Option<String>,
    repeated_occurrences: usize,
    pub(super) browser_loop_detector: browser_loop_detector::BrowserLoopDetector,
    pub(super) browser_automation_paused: bool,
    pub(super) browser_tools_used_this_turn: usize,
    pub(super) tool_loop_detector: tool_loop_detector::ToolLoopDetector,
}

#[derive(Debug)]
pub(crate) enum ModelLoopProgressAction {
    Continue,
    Warn {
        reason: &'static str,
        observed_occurrences: usize,
    },
    Synthesize {
        reason: &'static str,
        observed_occurrences: usize,
    },
}

impl ModelLoopProgressGuard {
    pub(super) fn observe_tool_round(
        &mut self,
        calls: &[ModelToolCall],
        provider_results: &[String],
    ) -> ModelLoopProgressAction {
        if calls.is_empty() {
            self.last_fingerprint = None;
            self.repeated_occurrences = 0;
            return ModelLoopProgressAction::Continue;
        }

        let fingerprint = tool_round_progress_fingerprint(calls, provider_results);
        if self.last_fingerprint.as_deref() == Some(fingerprint.as_str()) {
            self.repeated_occurrences = self.repeated_occurrences.saturating_add(1);
        } else {
            self.last_fingerprint = Some(fingerprint);
            self.repeated_occurrences = 1;
        }

        let reason = "repeated_identical_tool_round_without_new_evidence";
        if self.repeated_occurrences >= REPEATED_TOOL_ROUND_HARD_OCCURRENCES {
            return ModelLoopProgressAction::Synthesize {
                reason,
                observed_occurrences: self.repeated_occurrences,
            };
        }
        if self.repeated_occurrences == REPEATED_TOOL_ROUND_SOFT_OCCURRENCES {
            return ModelLoopProgressAction::Warn {
                reason,
                observed_occurrences: self.repeated_occurrences,
            };
        }
        ModelLoopProgressAction::Continue
    }
}

pub(crate) fn tool_round_progress_fingerprint(
    calls: &[ModelToolCall],
    provider_results: &[String],
) -> String {
    let calls = calls
        .iter()
        .map(|call| {
            format!(
                "{}:{}",
                call.name,
                serde_json::to_string(&call.arguments).unwrap_or_else(|_| "{}".to_string())
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let results = provider_results
        .iter()
        .map(|content| {
            let content = content
                .lines()
                .filter(|line| {
                    !line.starts_with("Evidence activity ID: ")
                        && !line.starts_with("Failed tool activity ID (not valid evidence): ")
                })
                .collect::<Vec<_>>()
                .join("\n");
            format!("{}:{content}", content.chars().count())
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!("calls:\n{calls}\nresults:\n{results}")
}

pub(crate) fn tool_output_failed(output: &Value) -> bool {
    output.get("error").is_some_and(|value| !value.is_null())
        || matches!(
            output.get("status").and_then(Value::as_str),
            Some("failed" | "cancelled")
        )
        || output.get("cancelled").and_then(Value::as_bool) == Some(true)
        || output.pointer("/raw/ok").and_then(Value::as_bool) == Some(false)
        || output.pointer("/raw/success").and_then(Value::as_bool) == Some(false)
}

pub(crate) fn provider_visible_tool_result_content(
    output: &Value,
    tool_call_id: &str,
    max_chars: usize,
) -> (String, Option<Value>) {
    let (content, evidence_ref) = guarded_tool_result_content(output, max_chars);
    let label = if tool_output_failed(output) {
        "Failed tool activity ID (not valid evidence)"
    } else {
        "Evidence activity ID"
    };
    (
        format!("{content}\n\n{label}: {tool_call_id}"),
        evidence_ref,
    )
}
