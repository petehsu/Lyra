use serde_json::{Map, Value, json};

use crate::native_backend::{NativeReasoningControl, NativeReasoningKind};

use super::protocol::{
    anthropic_messages, gemini_generate_content, openai_chat_completions, openai_responses,
};
use super::routes;

const DEFAULT_EFFORT_VALUES: [&str; 5] = ["none", "low", "medium", "high", "xhigh"];
const DEFAULT_BUDGET_MIN: u32 = 1024;
const DEFAULT_BUDGET_MAX: u32 = 16_000;

pub(crate) fn from_models_dev_metadata(metadata: &Value) -> Option<NativeReasoningControl> {
    let options = metadata.get("reasoning_options")?.as_array()?;
    if options.is_empty() {
        return None;
    }
    let mut effort_values: Option<Vec<String>> = None;
    let mut has_toggle = false;
    let mut has_budget = false;
    let mut budget_min = None;
    let mut budget_max = None;
    for option in options {
        match option.get("type").and_then(Value::as_str) {
            Some("effort") => {
                let values = option
                    .get("values")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(normalize_level)
                    .collect::<Vec<_>>();
                if !values.is_empty() {
                    effort_values = Some(values);
                }
            }
            Some("toggle") => has_toggle = true,
            Some("budget_tokens") => {
                has_budget = true;
                budget_min = option
                    .get("min")
                    .and_then(Value::as_u64)
                    .map(|value| value as u32);
                budget_max = option
                    .get("max")
                    .and_then(Value::as_u64)
                    .map(|value| value as u32);
            }
            _ => {}
        }
    }
    if let Some(values) = effort_values {
        return Some(NativeReasoningControl {
            kind: NativeReasoningKind::Effort,
            values,
            budget_min: None,
            budget_max: None,
        });
    }
    if has_budget {
        let mut values = Vec::new();
        if has_toggle {
            values.push("none".to_string());
        }
        values.push("high".to_string());
        values.push("max".to_string());
        return Some(NativeReasoningControl {
            kind: NativeReasoningKind::Budget,
            values,
            budget_min,
            budget_max,
        });
    }
    if has_toggle {
        return Some(NativeReasoningControl {
            kind: NativeReasoningKind::Toggle,
            values: vec!["none".to_string(), "high".to_string()],
            budget_min: None,
            budget_max: None,
        });
    }
    None
}

pub(crate) fn catalog_options(
    protocol_id: &str,
    route_id: &str,
    supports_reasoning_effort: Option<bool>,
    control: Option<&NativeReasoningControl>,
) -> Vec<String> {
    if let Some(control) = control {
        if control.values.is_empty() || !protocol_encodes(protocol_id, route_id, control.kind) {
            return Vec::new();
        }
        return control.values.clone();
    }
    if supports_reasoning_effort == Some(false) {
        return Vec::new();
    }
    if protocol_id == openai_responses::PROTOCOL_ID {
        return default_effort_values();
    }
    if protocol_id == openai_chat_completions::PROTOCOL_ID
        && supports_reasoning_effort == Some(true)
    {
        return default_effort_values();
    }
    Vec::new()
}

pub(crate) fn selected_if_allowed(
    selected: Option<&str>,
    protocol_id: &str,
    route_id: &str,
    supports_reasoning_effort: Option<bool>,
    control: Option<&NativeReasoningControl>,
) -> Option<String> {
    let selected = normalize_selected(selected)?;
    catalog_options(protocol_id, route_id, supports_reasoning_effort, control)
        .into_iter()
        .find(|value| value == &selected)
}

pub(crate) fn apply(
    body: &mut Value,
    protocol_id: &str,
    route_id: &str,
    control: Option<&NativeReasoningControl>,
    selected: Option<&str>,
    supports_reasoning_effort: Option<bool>,
) {
    let Some(selected) = selected_if_allowed(
        selected,
        protocol_id,
        route_id,
        supports_reasoning_effort,
        control,
    ) else {
        return;
    };
    match control.map(|control| control.kind) {
        Some(NativeReasoningKind::Toggle) => apply_toggle(body, protocol_id, &selected),
        Some(NativeReasoningKind::Budget) => {
            apply_budget(body, protocol_id, route_id, control, &selected)
        }
        Some(NativeReasoningKind::Effort) | None => {
            apply_effort(body, protocol_id, route_id, &selected)
        }
    }
}

fn protocol_encodes(protocol_id: &str, route_id: &str, kind: NativeReasoningKind) -> bool {
    match kind {
        NativeReasoningKind::Effort => matches!(
            protocol_id,
            openai_responses::PROTOCOL_ID
                | openai_chat_completions::PROTOCOL_ID
                | anthropic_messages::PROTOCOL_ID
                | gemini_generate_content::PROTOCOL_ID
        ),
        NativeReasoningKind::Toggle => matches!(
            protocol_id,
            openai_chat_completions::PROTOCOL_ID
                | anthropic_messages::PROTOCOL_ID
                | gemini_generate_content::PROTOCOL_ID
        ),
        NativeReasoningKind::Budget => {
            protocol_id == anthropic_messages::PROTOCOL_ID
                || protocol_id == gemini_generate_content::PROTOCOL_ID
                || route_id == routes::openrouter::ROUTE_ID
        }
    }
}

fn apply_effort(body: &mut Value, protocol_id: &str, route_id: &str, selected: &str) {
    if protocol_id == openai_responses::PROTOCOL_ID {
        body["reasoning"] = json!({ "effort": selected });
        return;
    }
    if protocol_id == anthropic_messages::PROTOCOL_ID {
        if selected == "none" {
            body["thinking"] = json!({ "type": "disabled" });
            if let Some(object) = body.as_object_mut() {
                object.remove("effort");
            }
            return;
        }
        body["thinking"] = json!({ "type": "adaptive" });
        body["effort"] = Value::String(selected.to_string());
        return;
    }
    if protocol_id == gemini_generate_content::PROTOCOL_ID {
        apply_gemini_thinking_level(body, selected);
        return;
    }
    if protocol_id == openai_chat_completions::PROTOCOL_ID {
        if route_id == routes::openrouter::ROUTE_ID {
            body["reasoning"] = json!({ "effort": selected });
            return;
        }
        body["reasoning_effort"] = Value::String(selected.to_string());
    }
}

fn apply_toggle(body: &mut Value, protocol_id: &str, selected: &str) {
    let enabled = selected != "none";
    if protocol_id == anthropic_messages::PROTOCOL_ID
        || protocol_id == openai_chat_completions::PROTOCOL_ID
    {
        body["thinking"] = json!({
            "type": if enabled { "enabled" } else { "disabled" }
        });
        return;
    }
    if protocol_id == gemini_generate_content::PROTOCOL_ID {
        let thinking = nested_object_field(body, "generationConfig", "thinkingConfig");
        if enabled {
            thinking.insert("includeThoughts".to_string(), json!(true));
            thinking.remove("thinkingBudget");
        } else {
            thinking.insert("thinkingBudget".to_string(), json!(0));
            thinking.insert("includeThoughts".to_string(), json!(false));
        }
    }
}

fn apply_budget(
    body: &mut Value,
    protocol_id: &str,
    route_id: &str,
    control: Option<&NativeReasoningControl>,
    selected: &str,
) {
    if selected == "none" {
        apply_toggle(body, protocol_id, "none");
        return;
    }
    let tokens = budget_tokens(control, selected);
    if protocol_id == anthropic_messages::PROTOCOL_ID {
        body["thinking"] = json!({
            "type": "enabled",
            "budget_tokens": tokens,
        });
        return;
    }
    if protocol_id == gemini_generate_content::PROTOCOL_ID {
        let thinking = nested_object_field(body, "generationConfig", "thinkingConfig");
        thinking.insert("includeThoughts".to_string(), json!(true));
        thinking.insert("thinkingBudget".to_string(), json!(tokens));
        return;
    }
    if route_id == routes::openrouter::ROUTE_ID {
        body["reasoning"] = json!({ "max_tokens": tokens });
    }
}

fn apply_gemini_thinking_level(body: &mut Value, selected: &str) {
    let thinking = nested_object_field(body, "generationConfig", "thinkingConfig");
    if selected == "none" {
        thinking.insert("thinkingBudget".to_string(), json!(0));
        thinking.insert("includeThoughts".to_string(), json!(false));
        thinking.remove("thinkingLevel");
        return;
    }
    let level = match selected {
        "max" | "xhigh" => "high",
        other => other,
    };
    thinking.insert("includeThoughts".to_string(), json!(true));
    thinking.insert("thinkingLevel".to_string(), json!(level));
}

fn budget_tokens(control: Option<&NativeReasoningControl>, selected: &str) -> u32 {
    let min = control
        .and_then(|control| control.budget_min)
        .unwrap_or(DEFAULT_BUDGET_MIN);
    let max = control
        .and_then(|control| control.budget_max)
        .unwrap_or(DEFAULT_BUDGET_MAX)
        .max(min);
    if selected == "max" {
        return max;
    }
    min.saturating_add(max.saturating_sub(min) / 2)
}

fn nested_object_field<'a>(
    value: &'a mut Value,
    first: &str,
    second: &str,
) -> &'a mut Map<String, Value> {
    let parent = object_field(value, first);
    if !parent.get(second).is_some_and(Value::is_object) {
        parent.insert(second.to_string(), json!({}));
    }
    parent
        .get_mut(second)
        .and_then(Value::as_object_mut)
        .expect("nested object field")
}

fn object_field<'a>(value: &'a mut Value, key: &str) -> &'a mut Map<String, Value> {
    if !value.get(key).is_some_and(Value::is_object) {
        value[key] = json!({});
    }
    value
        .get_mut(key)
        .and_then(Value::as_object_mut)
        .expect("object field")
}

fn default_effort_values() -> Vec<String> {
    DEFAULT_EFFORT_VALUES
        .iter()
        .map(|value| (*value).to_string())
        .collect()
}

fn normalize_selected(selected: Option<&str>) -> Option<String> {
    let value = selected?.trim().to_ascii_lowercase();
    if value.is_empty() || value == "default" {
        return None;
    }
    Some(value)
}

fn normalize_level(value: &Value) -> Option<String> {
    if value.is_null() {
        return Some("none".to_string());
    }
    let value = value.as_str()?.trim().to_ascii_lowercase();
    if value.is_empty() {
        return None;
    }
    Some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn effort_control(values: &[&str]) -> NativeReasoningControl {
        NativeReasoningControl {
            kind: NativeReasoningKind::Effort,
            values: values.iter().map(|value| (*value).to_string()).collect(),
            budget_min: None,
            budget_max: None,
        }
    }

    #[test]
    fn parses_effort_values_and_maps_null_to_none() {
        let control = from_models_dev_metadata(&json!({
            "reasoning_options": [{ "type": "effort", "values": [null, "low", "HIGH"] }]
        }))
        .expect("control");
        assert_eq!(control.kind, NativeReasoningKind::Effort);
        assert_eq!(control.values, ["none", "low", "high"]);
    }

    #[test]
    fn prefers_effort_over_toggle_and_budget() {
        let control = from_models_dev_metadata(&json!({
            "reasoning_options": [
                { "type": "toggle" },
                { "type": "effort", "values": ["high", "max"] },
                { "type": "budget_tokens", "min": 1024 }
            ]
        }))
        .expect("control");
        assert_eq!(control.kind, NativeReasoningKind::Effort);
        assert_eq!(control.values, ["high", "max"]);
    }

    #[test]
    fn empty_reasoning_options_mean_no_control() {
        assert!(from_models_dev_metadata(&json!({ "reasoning_options": [] })).is_none());
    }

    #[test]
    fn hides_options_when_protocol_cannot_encode_budget() {
        let control = NativeReasoningControl {
            kind: NativeReasoningKind::Budget,
            values: vec!["high".to_string(), "max".to_string()],
            budget_min: Some(1024),
            budget_max: Some(8000),
        };
        assert!(
            catalog_options(
                openai_chat_completions::PROTOCOL_ID,
                "custom_openai_compatible",
                Some(true),
                Some(&control),
            )
            .is_empty()
        );
        assert_eq!(
            catalog_options(
                anthropic_messages::PROTOCOL_ID,
                "anthropic",
                None,
                Some(&control),
            ),
            ["high", "max"]
        );
    }

    #[test]
    fn chat_completions_writes_reasoning_effort() {
        let mut body = json!({ "model": "gpt-test", "messages": [] });
        apply(
            &mut body,
            openai_chat_completions::PROTOCOL_ID,
            "custom_openai_compatible",
            Some(&effort_control(&["none", "low", "high"])),
            Some("high"),
            Some(true),
        );
        assert_eq!(body["reasoning_effort"], "high");
    }

    #[test]
    fn openrouter_writes_reasoning_object() {
        let mut body = json!({ "model": "gpt-test", "messages": [] });
        apply(
            &mut body,
            openai_chat_completions::PROTOCOL_ID,
            routes::openrouter::ROUTE_ID,
            Some(&effort_control(&["low", "high"])),
            Some("low"),
            Some(true),
        );
        assert_eq!(body["reasoning"]["effort"], "low");
        assert!(body.get("reasoning_effort").is_none());
    }

    #[test]
    fn anthropic_writes_adaptive_effort_and_can_disable() {
        let mut body = json!({ "model": "claude", "messages": [] });
        apply(
            &mut body,
            anthropic_messages::PROTOCOL_ID,
            "anthropic",
            Some(&effort_control(&["none", "low", "high"])),
            Some("high"),
            None,
        );
        assert_eq!(body["thinking"]["type"], "adaptive");
        assert_eq!(body["effort"], "high");

        apply(
            &mut body,
            anthropic_messages::PROTOCOL_ID,
            "anthropic",
            Some(&effort_control(&["none", "low", "high"])),
            Some("none"),
            None,
        );
        assert_eq!(body["thinking"]["type"], "disabled");
        assert!(body.get("effort").is_none());
    }

    #[test]
    fn gemini_writes_thinking_level() {
        let mut body = json!({ "contents": [] });
        apply(
            &mut body,
            gemini_generate_content::PROTOCOL_ID,
            "google_gemini",
            Some(&effort_control(&["minimal", "low", "high"])),
            Some("high"),
            None,
        );
        assert_eq!(
            body["generationConfig"]["thinkingConfig"]["thinkingLevel"],
            "high"
        );
        assert_eq!(
            body["generationConfig"]["thinkingConfig"]["includeThoughts"],
            true
        );
    }

    #[test]
    fn does_not_write_a_level_the_model_does_not_advertise() {
        let mut body = json!({ "model": "o3" });
        apply(
            &mut body,
            openai_chat_completions::PROTOCOL_ID,
            "openai",
            Some(&effort_control(&["low", "medium", "high"])),
            Some("xhigh"),
            Some(true),
        );
        assert!(body.get("reasoning_effort").is_none());
    }

    #[test]
    fn budget_high_is_midpoint_and_max_is_catalog_max() {
        let control = NativeReasoningControl {
            kind: NativeReasoningKind::Budget,
            values: vec!["high".to_string(), "max".to_string()],
            budget_min: Some(1000),
            budget_max: Some(5000),
        };
        let mut high = json!({});
        apply(
            &mut high,
            anthropic_messages::PROTOCOL_ID,
            "anthropic",
            Some(&control),
            Some("high"),
            None,
        );
        assert_eq!(high["thinking"]["budget_tokens"], 3000);
        let mut max = json!({});
        apply(
            &mut max,
            anthropic_messages::PROTOCOL_ID,
            "anthropic",
            Some(&control),
            Some("max"),
            None,
        );
        assert_eq!(max["thinking"]["budget_tokens"], 5000);
    }
}
