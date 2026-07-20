use serde_json::Value;

const SOFT_THRESHOLD: usize = 3;
const HARD_THRESHOLD: usize = 5;

#[derive(Debug, Default)]
pub(crate) struct ToolLoopDetector {
    last_failed_signature: Option<String>,
    consecutive_failures: usize,
}

pub(crate) fn tool_call_signature(tool_path: &str, args: &Value) -> String {
    format!(
        "{tool_path}:{}",
        serde_json::to_string(&canonical_json(args)).unwrap_or_default()
    )
}

fn canonical_json(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort();
            Value::Object(
                keys.into_iter()
                    .map(|key| (key.clone(), canonical_json(&object[key])))
                    .collect(),
            )
        }
        Value::Array(values) => Value::Array(values.iter().map(canonical_json).collect()),
        _ => value.clone(),
    }
}

pub(crate) enum LoopDetectorAction {
    Continue,
    Warn(String),
    Block(String),
}

impl ToolLoopDetector {
    /// Non-mutating check: would this call be blocked based on prior history?
    /// Called before tool execution to skip dispatch entirely.
    pub(crate) fn pre_check(&self, tool_path: &str, args: &Value) -> LoopDetectorAction {
        let signature = tool_call_signature(tool_path, args);
        if self.last_failed_signature.as_deref() == Some(signature.as_str())
            && self.consecutive_failures >= HARD_THRESHOLD
        {
            return LoopDetectorAction::Block(format!(
                "Tool {tool_path} has failed {} consecutive times with identical arguments. \
                 This call is blocked. You must use a different tool or approach.",
                self.consecutive_failures,
            ));
        }
        LoopDetectorAction::Continue
    }

    pub(crate) fn observe(
        &mut self,
        tool_path: &str,
        args: &Value,
        failed: bool,
    ) -> LoopDetectorAction {
        let signature = tool_call_signature(tool_path, args);
        if !failed {
            self.last_failed_signature = None;
            self.consecutive_failures = 0;
            return LoopDetectorAction::Continue;
        }
        if self.last_failed_signature.as_deref() == Some(signature.as_str()) {
            self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        } else {
            self.last_failed_signature = Some(signature);
            self.consecutive_failures = 1;
        }

        if self.consecutive_failures >= HARD_THRESHOLD {
            return LoopDetectorAction::Block(format!(
                "Tool {tool_path} has failed {} consecutive times with identical arguments. \
                 This call is blocked. You must use a different tool or approach.",
                self.consecutive_failures,
            ));
        }

        if self.consecutive_failures >= SOFT_THRESHOLD {
            return LoopDetectorAction::Warn(format!(
                "This is your {}{} consecutive identical failing call to {tool_path}. \
                 Previous calls failed. Change your approach — try a different tool, \
                 different arguments, or research the error.",
                self.consecutive_failures,
                ordinal_suffix(self.consecutive_failures),
            ));
        }

        LoopDetectorAction::Continue
    }
}

fn ordinal_suffix(n: usize) -> &'static str {
    match n % 10 {
        1 if n % 100 != 11 => "st",
        2 if n % 100 != 12 => "nd",
        3 if n % 100 != 13 => "rd",
        _ => "th",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn soft_warning_at_3_identical_failures() {
        let mut detector = ToolLoopDetector::default();
        let args = json!({"path": "/tools/filesystem/grep", "pattern": "foo"});
        for i in 0..2 {
            let action = detector.observe("/tools/filesystem/grep", &args, true);
            assert!(
                matches!(action, LoopDetectorAction::Continue),
                "call {} should continue",
                i
            );
        }
        let action = detector.observe("/tools/filesystem/grep", &args, true);
        assert!(
            matches!(action, LoopDetectorAction::Warn(_)),
            "3rd call should warn"
        );
    }

    #[test]
    fn hard_block_at_5_identical_failures() {
        let mut detector = ToolLoopDetector::default();
        let args = json!({"path": "/tools/browser/map"});
        for _ in 0..4 {
            let _ = detector.observe("/tools/browser/map", &args, true);
        }
        let action = detector.observe("/tools/browser/map", &args, true);
        assert!(
            matches!(action, LoopDetectorAction::Block(_)),
            "5th call should block"
        );
    }

    #[test]
    fn pre_check_blocks_after_hard_threshold() {
        let mut detector = ToolLoopDetector::default();
        let args = json!({"path": "/tools/filesystem/grep", "pattern": "foo"});
        for _ in 0..5 {
            let _ = detector.observe("/tools/filesystem/grep", &args, true);
        }
        // pre_check should now block the same call
        let action = detector.pre_check("/tools/filesystem/grep", &args);
        assert!(
            matches!(action, LoopDetectorAction::Block(_)),
            "pre_check should block after hard threshold"
        );
    }

    #[test]
    fn pre_check_allows_different_args() {
        let mut detector = ToolLoopDetector::default();
        let args_a = json!({"path": "/tools/filesystem/grep", "pattern": "foo"});
        for _ in 0..5 {
            let _ = detector.observe("/tools/filesystem/grep", &args_a, true);
        }
        let args_b = json!({"path": "/tools/filesystem/grep", "pattern": "bar"});
        let action = detector.pre_check("/tools/filesystem/grep", &args_b);
        assert!(
            matches!(action, LoopDetectorAction::Continue),
            "pre_check should allow different args"
        );
    }

    #[test]
    fn success_resets_consecutive_count() {
        let mut detector = ToolLoopDetector::default();
        let args = json!({"path": "/tools/filesystem/read", "filePath": "/a/b"});
        for _ in 0..3 {
            let _ = detector.observe("/tools/filesystem/read", &args, true);
        }
        // A successful call resets
        let action = detector.observe("/tools/filesystem/read", &args, false);
        assert!(matches!(action, LoopDetectorAction::Continue));
        // Next failure starts from 1
        let action = detector.observe("/tools/filesystem/read", &args, true);
        assert!(matches!(action, LoopDetectorAction::Continue));
    }

    #[test]
    fn different_args_dont_trigger_warning() {
        let mut detector = ToolLoopDetector::default();
        let args_a = json!({"path": "/tools/filesystem/grep", "pattern": "foo"});
        let args_b = json!({"path": "/tools/filesystem/grep", "pattern": "bar"});
        for _ in 0..2 {
            let _ = detector.observe("/tools/filesystem/grep", &args_a, true);
        }
        let action = detector.observe("/tools/filesystem/grep", &args_b, true);
        assert!(
            matches!(action, LoopDetectorAction::Continue),
            "different args should not trigger"
        );
    }

    #[test]
    fn another_call_breaks_the_failure_sequence() {
        let mut detector = ToolLoopDetector::default();
        let args_a = json!({"path": "/tools/browser/map"});
        let args_b = json!({"path": "/tools/browser/read"});
        for _ in 0..4 {
            let _ = detector.observe("/tools/browser/map", &args_a, true);
        }
        let _ = detector.observe("/tools/browser/read", &args_b, true);
        let action = detector.observe("/tools/browser/map", &args_a, true);
        assert!(
            matches!(action, LoopDetectorAction::Continue),
            "an unrelated call must break the consecutive sequence"
        );
    }

    #[test]
    fn signature_is_deterministic() {
        let args = json!({"b": 2, "a": 1});
        let sig1 = tool_call_signature("/tools/test", &args);
        let sig2 = tool_call_signature("/tools/test", &json!({"a": 1, "b": 2}));
        assert_eq!(sig1, sig2, "signature should be order-independent");
    }

    #[test]
    fn plan_retries_with_different_arguments_are_distinct() {
        let first = tool_call_signature(
            "update_plan",
            &json!({
                "action": "finalize",
                "summary": "first attempt",
                "investigationEvidenceIds": ["invented-a"],
            }),
        );
        let second = tool_call_signature(
            "update_plan",
            &json!({
                "action": "finalize",
                "summary": "second attempt",
                "investigationEvidenceIds": ["invented-b"],
            }),
        );
        assert_ne!(first, second);

        let mut detector = ToolLoopDetector::default();
        for index in 0..4 {
            let action = detector.observe(
                "update_plan",
                &json!({
                    "action": "finalize",
                    "summary": format!("attempt {index}"),
                    "investigationEvidenceIds": [format!("invented-{index}")],
                }),
                true,
            );
            assert!(!matches!(action, LoopDetectorAction::Block(_)));
        }
        assert!(matches!(
            detector.observe(
                "update_plan",
                &json!({
                    "action": "finalize",
                    "summary": "last attempt",
                    "investigationEvidenceIds": ["invented-last"],
                }),
                true,
            ),
            LoopDetectorAction::Continue
        ));
    }

    #[test]
    fn todo_failures_are_not_counted_across_other_tools() {
        let mut detector = ToolLoopDetector::default();
        for index in 0..4 {
            let action = detector.observe(
                "todo_write",
                &json!({
                    "action": "finish",
                    "status": "completed",
                    "summary": format!("attempt {index}"),
                    "evidenceIds": [format!("evidence-{index}")],
                }),
                true,
            );
            assert!(!matches!(action, LoopDetectorAction::Block(_)));
            let _ = detector.observe(
                "tool_fs_run",
                &json!({ "path": "/tools/browser/read", "args": { "tabId": index } }),
                false,
            );
        }
        assert!(matches!(
            detector.observe(
                "todo_write",
                &json!({
                    "action": "finish",
                    "status": "completed",
                    "summary": "last attempt",
                    "evidenceIds": ["evidence-last"],
                }),
                true,
            ),
            LoopDetectorAction::Continue
        ));
    }

    #[test]
    fn signature_compares_the_full_argument_value() {
        let prefix = "x".repeat(400);
        let first = tool_call_signature("write_file", &json!({ "content": format!("{prefix}a") }));
        let second = tool_call_signature("write_file", &json!({ "content": format!("{prefix}b") }));
        assert_ne!(first, second);
    }
}
