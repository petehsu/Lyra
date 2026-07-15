use serde_json::Value;

const WINDOW_SIZE: usize = 30;
const SOFT_THRESHOLD: usize = 3;
const HARD_THRESHOLD: usize = 5;
const ALTERNATING_PATTERN_MIN: usize = 4;

#[derive(Debug, Default)]
pub(crate) struct ToolLoopDetector {
    recent_signatures: Vec<String>,
    /// Running count of consecutive identical *failing* calls.
    /// Reset to 0 when a different signature is observed or a call succeeds.
    consecutive_identical_failures: usize,
    last_signature: Option<String>,
}

/// Normalized signature for a tool call: `tool_path` + sorted key args.
/// This is intentionally lossy — we only care about detecting identical
/// retries, not distinguishing legitimate variations.
pub(crate) fn tool_call_signature(tool_path: &str, args: &Value) -> String {
    let mut sig = tool_path.to_string();
    if let Some(obj) = args.as_object() {
        let mut keys: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();
        keys.sort();
        for key in keys {
            if let Some(val) = obj.get(key) {
                let val_str = match val {
                    Value::String(s) => s.clone(),
                    Value::Number(n) => n.to_string(),
                    Value::Bool(b) => b.to_string(),
                    Value::Null => "null".to_string(),
                    _ => serde_json::to_string(val).unwrap_or_default(),
                };
                // Truncate long values to keep the signature compact
                let truncated = if val_str.len() > 200 {
                    format!("{}…", &val_str[..200])
                } else {
                    val_str
                };
                sig.push(':');
                sig.push_str(key);
                sig.push('=');
                sig.push_str(&truncated);
            }
        }
    }
    sig
}

fn detect_alternating_pattern(signatures: &[String]) -> Option<String> {
    if signatures.len() < ALTERNATING_PATTERN_MIN {
        return None;
    }
    let tail = &signatures[signatures.len() - ALTERNATING_PATTERN_MIN..];
    if tail[0] == tail[2] && tail[1] == tail[3] && tail[0] != tail[1] {
        return Some(format!("{} <-> {}", tail[0], tail[1]));
    }
    None
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
        if self.last_signature.as_deref() == Some(signature.as_str())
            && self.consecutive_identical_failures >= HARD_THRESHOLD
        {
            return LoopDetectorAction::Block(format!(
                "Tool {tool_path} has been called {} times with identical failing arguments. \
                 This call is blocked. You must use a different tool or approach.",
                self.consecutive_identical_failures
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
        self.recent_signatures.push(signature.clone());
        if self.recent_signatures.len() > WINDOW_SIZE {
            let overflow = self.recent_signatures.len() - WINDOW_SIZE;
            self.recent_signatures.drain(0..overflow);
        }

        // Track consecutive identical failing calls
        if self.last_signature.as_deref() == Some(signature.as_str()) && failed {
            self.consecutive_identical_failures =
                self.consecutive_identical_failures.saturating_add(1);
        } else {
            self.consecutive_identical_failures = if failed { 1 } else { 0 };
            self.last_signature = Some(signature.clone());
        }

        // Hard threshold: block the call
        if self.consecutive_identical_failures >= HARD_THRESHOLD {
            return LoopDetectorAction::Block(format!(
                "Tool {tool_path} has been called {} times with identical failing arguments. \
                 This call is blocked. You must use a different tool or approach.",
                self.consecutive_identical_failures
            ));
        }

        // Soft threshold: inject warning
        if self.consecutive_identical_failures >= SOFT_THRESHOLD {
            return LoopDetectorAction::Warn(format!(
                "This is your {}{} identical failing call to {tool_path} with the same arguments. \
                 Previous calls failed. Change your approach — try a different tool, \
                 different arguments, or research the error.",
                self.consecutive_identical_failures,
                ordinal_suffix(self.consecutive_identical_failures),
            ));
        }

        // Alternating pattern detection (cross-tool)
        if let Some(alternating) = detect_alternating_pattern(&self.recent_signatures) {
            return LoopDetectorAction::Warn(format!(
                "Actions are alternating between two tools ({alternating}) without progress. \
                 Pick one approach instead of switching back and forth."
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
            assert!(matches!(action, LoopDetectorAction::Continue), "call {} should continue", i);
        }
        let action = detector.observe("/tools/filesystem/grep", &args, true);
        assert!(matches!(action, LoopDetectorAction::Warn(_)), "3rd call should warn");
    }

    #[test]
    fn hard_block_at_5_identical_failures() {
        let mut detector = ToolLoopDetector::default();
        let args = json!({"path": "/tools/browser/map"});
        for _ in 0..4 {
            let _ = detector.observe("/tools/browser/map", &args, true);
        }
        let action = detector.observe("/tools/browser/map", &args, true);
        assert!(matches!(action, LoopDetectorAction::Block(_)), "5th call should block");
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
        assert!(matches!(action, LoopDetectorAction::Block(_)), "pre_check should block after hard threshold");
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
        assert!(matches!(action, LoopDetectorAction::Continue), "pre_check should allow different args");
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
        assert!(matches!(action, LoopDetectorAction::Continue), "different args should not trigger");
    }

    #[test]
    fn alternating_pattern_detected() {
        let mut detector = ToolLoopDetector::default();
        let args_a = json!({"path": "/tools/browser/map"});
        let args_b = json!({"path": "/tools/browser/read"});
        // A fails, B fails, A fails, B fails
        for _ in 0..2 {
            let _ = detector.observe("/tools/browser/map", &args_a, true);
            let _ = detector.observe("/tools/browser/read", &args_b, true);
        }
        let action = detector.observe("/tools/browser/map", &args_a, true);
        assert!(matches!(action, LoopDetectorAction::Warn(_)), "alternating pattern should warn");
    }

    #[test]
    fn signature_is_deterministic() {
        let args = json!({"b": 2, "a": 1});
        let sig1 = tool_call_signature("/tools/test", &args);
        let sig2 = tool_call_signature("/tools/test", &json!({"a": 1, "b": 2}));
        assert_eq!(sig1, sig2, "signature should be order-independent");
    }
}