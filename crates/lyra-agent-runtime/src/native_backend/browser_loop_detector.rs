use serde_json::Value;
use std::collections::HashMap;

pub(crate) mod visual;

const WINDOW_SIZE: usize = 20;
const REPETITION_NUDGE_AT: [usize; 3] = [4, 7, 11];
const STAGNANT_PAGE_THRESHOLD: usize = 4;
const ALTERNATING_PATTERN_MIN: usize = 4;

#[derive(Debug, Default)]
pub(crate) struct BrowserLoopDetector {
    recent_action_hashes: Vec<String>,
    max_repetition_count: usize,
    semantic_pages: HashMap<String, (String, usize)>,
    visual_pages: HashMap<String, (String, usize)>,
}

fn normalize_search_query(value: &str) -> String {
    let mut tokens = value
        .to_lowercase()
        .chars()
        .map(|ch| {
            if ch.is_alphanumeric() || ch.is_whitespace() {
                ch
            } else {
                ' '
            }
        })
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
        if let Some(action) = path.strip_prefix("/tools/browser/") {
            if !action.is_empty() {
                return Some((
                    "browser".to_string(),
                    action.to_string(),
                    args.get("args").unwrap_or(args).clone(),
                ));
            }
        }
        if let Some(action) = path.strip_prefix("/tools/computer/") {
            if !action.is_empty() {
                return Some((
                    "computer".to_string(),
                    action.to_string(),
                    args.get("args").unwrap_or(args).clone(),
                ));
            }
        }
    }
    for (prefix, domain) in [("browser_", "browser"), ("computer_", "computer")] {
        if let Some(action) = name.strip_prefix(prefix) {
            return Some((domain.into(), action.into(), args.clone()));
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
    for key in [
        "tabId",
        "targetMode",
        "mark",
        "cell",
        "toMark",
        "toCell",
        "position",
        "toPosition",
        "point",
        "to",
        "path",
        "key",
        "steps",
        "scrollDx",
        "scrollDy",
    ] {
        if let Some(value) = args.get(key) {
            payload.push_str(&format!(":{key}={value}"));
        }
    }
    Some(payload)
}

fn page_fingerprint_from_output(output: &Value) -> Option<String> {
    let output = output.get("data").unwrap_or(output);
    // A URL or node count is identity/coverage, never evidence of task progress.
    // Missing state is not evidence that a previous state stayed unchanged.
    let elements = output.get("elements").or_else(|| output.get("nodes"));
    let text = output.get("content").filter(|v| v.is_string());
    let status = output.get("status");
    let notes = output.get("pageNotes");
    if elements.is_none() && text.is_none() && status.is_none() && notes.is_none() {
        return None;
    }
    let elements = elements.and_then(Value::as_array).map(|items| {
        items
            .iter()
            .map(|item| {
                let mut facts = serde_json::Map::new();
                for key in [
                    "targetRef",
                    "label",
                    "name",
                    "role",
                    "value",
                    "checked",
                    "pressed",
                    "selected",
                    "expanded",
                    "disabled",
                    "visibility",
                    "state",
                    "states",
                    "semantics",
                    "stateHint",
                    "valuePreview",
                    "textSnippet",
                ] {
                    if let Some(value) = item.get(key) {
                        facts.insert(key.into(), value.clone());
                    }
                }
                Value::Object(facts)
            })
            .collect::<Vec<_>>()
    });
    Some(serde_json::json!({"url":output["url"],"elements":elements,"text":text,"status":status,"notes":notes}).to_string())
}

fn page_scope(args: &Value, output: &Value) -> String {
    let output = output.get("raw").unwrap_or(output);
    let tab = args
        .get("tabId")
        .or_else(|| output.get("tabId"))
        .and_then(Value::as_str)
        .unwrap_or("active");
    let mode = args
        .get("targetMode")
        .or_else(|| output.get("targetMode"))
        .and_then(Value::as_str)
        .unwrap_or("live");
    format!("{tab}|{mode}")
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
        if calls.is_empty() {
            return None;
        }
        let mut nudges = Vec::new();
        let mut observed_action = false;
        for ((name, action, args), output) in calls.iter().zip(outputs.iter()) {
            let page_scope = page_scope(args, output);
            if let Some(scene) = visual::scene(output) {
                // Rich scene evidence supersedes the old semantic sample for this page.
                self.semantic_pages.remove(&page_scope);
                let scope = visual::scope(args, output, &scene);
                let fingerprint =
                    format!("{}|{}", scene["evidence"]["fingerprint"], scene["pageText"]);
                if !self.visual_pages.contains_key(&scope) && self.visual_pages.len() >= 32 {
                    self.visual_pages.clear();
                }
                let entry = self
                    .visual_pages
                    .entry(scope)
                    .or_insert((fingerprint.clone(), 0));
                if entry.0 == fingerprint {
                    entry.1 += 1;
                } else {
                    *entry = (fingerprint, 1);
                }
                if [3, 6, 10].contains(&entry.1) {
                    nudges.push(format!("Visual progress hint: {} observations show the same region pixels and page text. Inspect lastAction and changedCells before repeating input: a delivered click or observation budget ending is not an input failure. If detail is ambiguous, use see with region and cell to enlarge that location. Source inspection remains available: use it to test a concrete hypothesis, then verify against the current page. Repeating an unchanged overview adds no evidence.", entry.1));
                }
                continue;
            }
            let decoded = output.get("raw").unwrap_or(output);

            if let Some(hash) = browser_tool_action_hash(name, action, args) {
                observed_action = true;
                self.recent_action_hashes
                    .push(format!("{page_scope}:{hash}"));
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
            if let Some(fingerprint) = page_fingerprint_from_output(decoded) {
                if !self.semantic_pages.contains_key(&page_scope) && self.semantic_pages.len() >= 32
                {
                    self.semantic_pages.clear();
                }
                let entry = self
                    .semantic_pages
                    .entry(page_scope)
                    .or_insert((fingerprint.clone(), 0));
                if entry.0 == fingerprint {
                    entry.1 += 1;
                } else {
                    *entry = (fingerprint, 1);
                    self.recent_action_hashes.clear();
                    self.max_repetition_count = 0;
                    observed_action = false;
                }
                if [STAGNANT_PAGE_THRESHOLD + 1, 8, 12].contains(&entry.1) {
                    nudges.push(format!("Automation stagnation hint: {} observations repeat the same rendered controls/text. Compare the user's requested outcome with this evidence: if already satisfied, finish now. Otherwise identify the missing fact and use the existing target/region for one focused observation or diagnosis; do not rebuild an unchanged map. Source inspection remains available for a concrete discrepancy.", entry.1));
                }
            }
        }

        if observed_action && REPETITION_NUDGE_AT.contains(&self.max_repetition_count) {
            nudges.push(format!(
                "Automation loop hint: a similar browser/computer action repeated {} times in the last {} automation steps. If each attempt is making progress, continue. Otherwise check whether the user's goal is already satisfied. Reuse the current target/region for a focused outcome check; map only when the needed target is missing.",
                self.max_repetition_count,
                self.recent_action_hashes.len()
            ));
        }
        if let Some(alternating) = observed_action
            .then(|| detect_alternating_pattern(&self.recent_action_hashes))
            .flatten()
        {
            nudges.push(format!(
                "Automation oscillation hint: actions are alternating between two strategies ({alternating}). Use the current evidence to choose one recovery hypothesis. Finish if the requested outcome is already established; do not add navigation or map calls as a ritual."
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
            nudge = detector.observe_browser_tools(
                &[call_a.clone(), call_b.clone()],
                &[output.clone(), output.clone()],
            );
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

#[cfg(test)]
mod visual_tests {
    use super::*;
    use serde_json::json;
    fn output(pixel: &str, capture: usize) -> Value {
        json!({"raw":{"tabId":"tab","observation":{"scene":{"captureId":capture,"documentKey":"doc","pageText":"Your turn","evidence":{"fingerprint":pixel}}}}})
    }
    #[test]
    fn parses_direct_tools_and_unwraps_tool_fs_arguments() {
        assert_eq!(
            parse_browser_tool_call("browser_vact", &json!({"cell":{"row":1,"column":2}}))
                .unwrap()
                .1,
            "vact"
        );
        let parsed = parse_browser_tool_call(
            "tool_fs_run",
            &json!({"path":"/tools/browser/see","args":{"region":"1"}}),
        )
        .unwrap();
        assert_eq!(parsed.2, json!({"region":"1"}));
        assert_ne!(
            browser_tool_action_hash(
                "browser",
                "vact",
                &json!({"mark":"a","cell":{"row":1,"column":2}})
            ),
            browser_tool_action_hash(
                "browser",
                "vact",
                &json!({"mark":"a","cell":{"row":2,"column":2}})
            )
        );
    }
    #[test]
    fn repeated_visual_evidence_is_detected_despite_new_capture_ids_and_source_inspection() {
        let mut detector = BrowserLoopDetector::default();
        let call = ("browser".into(), "see".into(), json!({"tabId":"tab"}));
        assert!(
            detector
                .observe_browser_tools(&[call.clone()], &[output("same", 1)])
                .is_none()
        );
        assert!(detector.observe_browser_tools(&[], &[]).is_none()); // source analysis is neither blocked nor a reset
        assert!(
            detector
                .observe_browser_tools(&[call.clone()], &[output("same", 2)])
                .is_none()
        );
        let hint = detector
            .observe_browser_tools(&[call], &[output("same", 3)])
            .unwrap();
        assert!(hint.contains("Source inspection remains available"));
        assert!(hint.contains("region and cell"));
    }
    #[test]
    fn changed_pixels_and_other_tabs_do_not_count_as_stagnation() {
        let mut detector = BrowserLoopDetector::default();
        for i in 0..12 {
            let call = (
                "browser".into(),
                "vact".into(),
                json!({"tabId":"tab","cell":{"row":i+1,"column":8}}),
            );
            assert!(
                detector
                    .observe_browser_tools(&[call], &[output(&i.to_string(), i)])
                    .is_none()
            );
        }
        let mut detector = BrowserLoopDetector::default();
        for tab in ["a", "b", "c"] {
            let call = ("browser".into(), "see".into(), json!({"tabId":tab}));
            assert!(
                detector
                    .observe_browser_tools(&[call], &[output("same", 1)])
                    .is_none()
            );
        }
    }
    #[test]
    fn compacted_provider_content_still_carries_visual_fingerprint() {
        let raw = output("p", 1);
        let compact = json!({"scene":raw["raw"]["observation"]["scene"]});
        let wrapped = json!({"content":format!("{compact}\n\nEvidence activity ID: call")});
        assert_eq!(
            visual::scene(&wrapped).unwrap()["evidence"]["fingerprint"],
            "p"
        );
    }

    #[test]
    fn semantic_waits_cannot_leave_stale_warnings_across_real_scene_progress() {
        let mut detector = BrowserLoopDetector::default();
        let wait = ("browser".into(), "wait".into(), json!({"tabId":"tab"}));
        let wait_result =
            json!({"raw":{"tabId":"tab","url":"https://example.test","content":"Ready"}});
        for _ in 0..5 {
            detector.observe_browser_tools(&[wait.clone()], &[wait_result.clone()]);
        }
        let scene = ("browser".into(), "vact".into(), json!({"tabId":"tab"}));
        assert!(
            detector
                .observe_browser_tools(&[scene], &[output("new board", 6)])
                .is_none()
        );
        assert!(
            detector
                .observe_browser_tools(&[wait], &[wait_result])
                .is_none()
        );
        assert!(detector.observe_browser_tools(&[], &[]).is_none());
    }

    #[test]
    fn url_only_is_not_stagnation_and_same_size_changed_controls_are_progress() {
        let mut detector = BrowserLoopDetector::default();
        let wait = ("browser".into(), "wait".into(), json!({}));
        for _ in 0..12 {
            assert!(
                detector
                    .observe_browser_tools(
                        &[wait.clone()],
                        &[json!({"url":"https://example.test"})]
                    )
                    .is_none()
            );
        }
        let action = (
            "browser".into(),
            "act".into(),
            json!({"targetRef":"button"}),
        );
        for i in 0..12 {
            assert!(detector.observe_browser_tools(&[action.clone()], &[json!({"url":"https://example.test","elements":[{"targetRef":"button","value":i}]})]).is_none());
        }
    }

    #[test]
    fn identical_semantic_pages_in_other_tabs_do_not_accumulate_stagnation() {
        let mut detector = BrowserLoopDetector::default();
        for tab in ["a", "b", "c", "d", "e", "f"] {
            assert!(
                detector
                    .observe_browser_tools(
                        &[("browser".into(), "map".into(), json!({"tabId":tab}))],
                        &[json!({"url":"same","elements":[]})]
                    )
                    .is_none()
            );
        }
    }
}
