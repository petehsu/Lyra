use serde_json::Value;
use std::collections::HashMap;

const WINDOW_SIZE: usize = 20;
const REPETITION_NUDGE_AT: [usize; 3] = [4, 7, 11];
const STAGNANT_PAGE_THRESHOLD: usize = 4;
const ALTERNATING_PATTERN_MIN: usize = 4;

#[derive(Debug, Default)]
pub(crate) struct BrowserLoopDetector {
    recent_action_hashes: Vec<String>,
    max_repetition_count: usize,
    consecutive_stagnant_pages: usize,
    last_page_fingerprint: Option<String>,
}

fn normalize_search_query(value: &str) -> String {
    let mut tokens = value
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_alphanumeric() || ch.is_whitespace() { ch } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .map(str::to_string)
        .collect::<Vec<_>>();
    tokens.sort();
    tokens.dedup();
    tokens.join(" ")
}

pub(crate) fn parse_browser_tool_call(name: &str, args: &Value) -> Option<(String, String, Value)> {
    if let Some(path) = args.get("path").and_then(Value::as_str) {
        if path == "/tools/browser/interact" {
            return Some(("browser".to_string(), "interact".to_string(), args.clone()));
        }
        if let Some(action) = path.strip_prefix("/tools/browser/") {
            if !action.is_empty() {
                return Some(("browser".to_string(), action.to_string(), args.clone()));
            }
        }
        if let Some(action) = path.strip_prefix("/tools/computer/") {
            if !action.is_empty() {
                return Some(("computer".to_string(), action.to_string(), args.clone()));
            }
        }
    }
    if name == "lyra_lumen" || name == "lyra_computer" {
        let action = args
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or("tool")
            .to_string();
        return Some((name.to_string(), action, args.clone()));
    }
    None
}

fn browser_tool_action_hash(name: &str, action: &str, args: &Value) -> Option<String> {
    if name != "lyra_lumen" && name != "browser" && name != "lyra_computer" && name != "computer" {
        return None;
    }
    if matches!(action, "wait" | "done" | "read" | "map" | "see") {
        return None;
    }
    if action == "interact" {
        if let Some(actions) = args.get("actions").and_then(Value::as_array) {
            let kinds = actions
                .iter()
                .filter_map(|step| step.get("kind").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join(">");
            if !kinds.is_empty() {
                return Some(format!("browser:interact:{kinds}"));
            }
        }
        return Some("browser:interact".to_string());
    }
    let mut payload = format!("{name}:{action}");
    if let Some(target_ref) = args.get("targetRef").and_then(Value::as_str) {
        payload.push_str(&format!(":targetRef={target_ref}"));
    }
    if let Some(os_ref) = args.get("osRef").and_then(Value::as_str) {
        payload.push_str(&format!(":osRef={os_ref}"));
    }
    if let Some(action_name) = args.get("action").and_then(Value::as_str) {
        payload.push_str(&format!(":action={action_name}"));
    }
    if let Some(interaction) = args.get("interaction").and_then(Value::as_str) {
        payload.push_str(&format!(":interaction={interaction}"));
    }
    if let Some(query) = args
        .get("query")
        .or_else(|| args.get("text"))
        .and_then(Value::as_str)
    {
        payload.push_str(&format!(":text={}", normalize_search_query(query)));
    }
    if let Some(url) = args.get("url").and_then(Value::as_str) {
        payload.push_str(&format!(":url={url}"));
    }
    Some(payload)
}

fn page_fingerprint_from_output(output: &Value) -> Option<String> {
    let url = output
        .pointer("/url")
        .or_else(|| output.pointer("/data/url"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let element_count = output
        .pointer("/elements")
        .or_else(|| output.pointer("/data/elements"))
        .and_then(Value::as_array)
        .map(|items| items.len())
        .or_else(|| {
            output
                .pointer("/nodes")
                .or_else(|| output.pointer("/data/nodes"))
                .and_then(Value::as_array)
                .map(|items| items.len())
        })
        .or_else(|| {
            output
                .pointer("/elementCount")
                .or_else(|| output.pointer("/data/elementCount"))
                .and_then(Value::as_u64)
                .map(|count| count as usize)
        })
        .unwrap_or(0);
    let status = output
        .pointer("/status/state")
        .or_else(|| output.pointer("/data/status/state"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if url.is_empty() && element_count == 0 && status.is_empty() {
        return None;
    }
    Some(format!("{url}|elements={element_count}|status={status}"))
}

fn detect_alternating_pattern(hashes: &[String]) -> Option<String> {
    if hashes.len() < ALTERNATING_PATTERN_MIN {
        return None;
    }
    let tail = &hashes[hashes.len() - ALTERNATING_PATTERN_MIN..];
    if tail[0] == tail[2] && tail[1] == tail[3] && tail[0] != tail[1] {
        return Some(format!("{} <-> {}", tail[0], tail[1]));
    }
    None
}

impl BrowserLoopDetector {
    pub(crate) fn observe_browser_tools(
        &mut self,
        calls: &[(String, String, Value)],
        outputs: &[Value],
    ) -> Option<String> {
        let mut nudges = Vec::new();
        for ((name, action, args), output) in calls.iter().zip(outputs.iter()) {
            if let Some(hash) = browser_tool_action_hash(name, action, args) {
                self.recent_action_hashes.push(hash);
                if self.recent_action_hashes.len() > WINDOW_SIZE {
                    let overflow = self.recent_action_hashes.len() - WINDOW_SIZE;
                    self.recent_action_hashes.drain(0..overflow);
                }
                let mut counts = HashMap::new();
                for entry in &self.recent_action_hashes {
                    *counts.entry(entry.clone()).or_insert(0_usize) += 1;
                }
                self.max_repetition_count = counts.values().copied().max().unwrap_or(0);
            }
            if let Some(fingerprint) = page_fingerprint_from_output(output) {
                if self.last_page_fingerprint.as_deref() == Some(fingerprint.as_str()) {
                    self.consecutive_stagnant_pages += 1;
                } else {
                    self.consecutive_stagnant_pages = 0;
                    self.last_page_fingerprint = Some(fingerprint);
                }
            }
        }

        if REPETITION_NUDGE_AT.contains(&self.max_repetition_count) {
            nudges.push(format!(
                "Automation loop hint: a similar browser/computer action repeated {} times in the last {} automation steps. If each attempt is making progress, continue. Otherwise change strategy with browser.interact, locate/find, explain_target, browser_ax/computer.explain, or see.",
                self.max_repetition_count,
                self.recent_action_hashes.len()
            ));
        }
        if let Some(alternating) = detect_alternating_pattern(&self.recent_action_hashes) {
            nudges.push(format!(
                "Automation oscillation hint: actions are alternating between two strategies ({alternating}). Pick one path (navigate→wait→map→read or browser.interact) instead of switching back and forth."
            ));
        }
        if self.consecutive_stagnant_pages >= STAGNANT_PAGE_THRESHOLD {
            nudges.push(format!(
                "Automation stagnation hint: the surface evidence (URL/node count/status) has not changed across {} consecutive browser/computer tool results. Try a different reveal/locate path, wait for navigation to finish, or escalate with browser_ax/computer.diff.",
                self.consecutive_stagnant_pages
            ));
        }
        if nudges.is_empty() {
            None
        } else {
            Some(nudges.join(" "))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalizes_search_tokens_for_hashing() {
        assert_eq!(
            normalize_search_query("Site:Example.com ANSWERS votes"),
            normalize_search_query("votes answers site example com")
        );
    }

    #[test]
    fn parses_computer_tool_fs_paths() {
        let parsed = parse_browser_tool_call(
            "tool_fs_run",
            &json!({"path": "/tools/computer/map", "strategy": "interactive"}),
        )
        .expect("computer path");
        assert_eq!(parsed.0, "computer");
        assert_eq!(parsed.1, "map");
    }

    #[test]
    fn emits_repetition_nudge_for_computer_actions() {
        let mut detector = BrowserLoopDetector::default();
        let call = (
            "computer".to_string(),
            "act".to_string(),
            json!({"osRef": "osax:0/1", "action": "press"}),
        );
        let output = json!({"ok": true, "nodes": [], "status": {"state": "ready"}});
        let mut nudge = None;
        for _ in 0..5 {
            nudge = detector.observe_browser_tools(&[call.clone()], &[output.clone()]);
        }
        assert!(nudge.is_some());
    }

    #[test]
    fn emits_oscillation_nudge_for_alternating_actions() {
        let mut detector = BrowserLoopDetector::default();
        let call_a = (
            "browser".to_string(),
            "act".to_string(),
            json!({ "targetRef": "lumen:scroll-down" }),
        );
        let call_b = (
            "browser".to_string(),
            "act".to_string(),
            json!({ "targetRef": "lumen:map-again" }),
        );
        let output = json!({"url": "https://example.test", "elements": []});
        let mut nudge = None;
        for pair in 0..2 {
            let _ = pair;
            nudge = detector.observe_browser_tools(&[call_a.clone(), call_b.clone()], &[output.clone(), output.clone()]);
        }
        assert!(nudge.is_some_and(|text| text.contains("oscillation")));
    }

    #[test]
    fn emits_repetition_nudge_after_threshold() {
        let mut detector = BrowserLoopDetector::default();
        let call = (
            "lyra_lumen".to_string(),
            "act".to_string(),
            json!({"targetRef": "lumen:btn"}),
        );
        let output = json!({"url": "https://example.test", "elements": []});
        let mut nudge = None;
        for _ in 0..5 {
            nudge = detector.observe_browser_tools(&[call.clone()], &[output.clone()]);
        }
        assert!(nudge.is_some());
    }
}