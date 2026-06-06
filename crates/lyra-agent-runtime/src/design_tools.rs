use serde_json::{Value, json};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DesignStyle {
    pub id: &'static str,
    pub title: &'static str,
    pub summary: &'static str,
    pub tokens: &'static [&'static str],
    pub guidelines: &'static [&'static str],
    pub components: &'static [&'static str],
}

const DESIGN_STYLES: &[DesignStyle] = &[
    DesignStyle {
        id: "operational-dashboard",
        title: "Operational Dashboard",
        summary: "Dense, scannable layouts for repeated work, with restrained surfaces and strong table/filter ergonomics.",
        tokens: &[
            "neutral surface",
            "8px radius maximum",
            "compact type scale",
            "status color reserved for state",
        ],
        guidelines: &[
            "Prioritize information density and predictable controls.",
            "Use cards only for repeated items, dialogs, or framed tools.",
            "Expose filters, sorting, and keyboard-friendly actions close to the data.",
        ],
        components: &[
            "toolbar",
            "data table",
            "split pane",
            "status row",
            "side panel",
        ],
    },
    DesignStyle {
        id: "creative-editor",
        title: "Creative Editor",
        summary: "Tool-first creation surfaces with canvas priority, icon controls, and stable dimensions for palettes and inspectors.",
        tokens: &[
            "canvas-first layout",
            "icon tool buttons",
            "segmented modes",
            "inspector panels",
        ],
        guidelines: &[
            "Keep the primary canvas full and visually unobstructed.",
            "Use familiar icons for editing actions with hover labels.",
            "Avoid layout shifts when tool labels or values change.",
        ],
        components: &[
            "tool rail",
            "canvas",
            "properties inspector",
            "layers list",
            "asset picker",
        ],
    },
    DesignStyle {
        id: "ai-workbench",
        title: "AI Workbench",
        summary: "Conversation plus evidence surfaces where tool activity, artifacts, and verification are visible without crowding the main flow.",
        tokens: &[
            "timeline rhythm",
            "evidence disclosure",
            "monospace metadata",
            "clear activity state",
        ],
        guidelines: &[
            "Show tool activity as factual runtime state, not prose pasted into the transcript.",
            "Keep detailed evidence behind explicit expansion.",
            "Separate planning, execution, and verification states.",
        ],
        components: &[
            "message timeline",
            "tool activity row",
            "artifact preview",
            "todo strip",
            "detail drawer",
        ],
    },
];

pub fn is_design_task(text: &str) -> bool {
    let value = text.to_lowercase();
    [
        "design",
        "ui",
        "ux",
        "screen",
        "frontend",
        "interface",
        "layout",
        "style",
        "component",
        "界面",
        "设计",
        "前端",
        "样式",
        "页面",
        "组件",
        "交互",
    ]
    .iter()
    .any(|needle| value.contains(needle))
}

pub fn execute_design_tool(name: &str, input: &Value) -> Value {
    match name {
        "lyra_design_search_styles" => search_styles(input),
        "lyra_design_get_style_details" => style_details(input),
        _ => json!({
            "ok": false,
            "error": {
                "code": "capabilityUnavailable",
                "message": format!("Unknown Lyra design tool: {name}")
            }
        }),
    }
}

fn search_styles(input: &Value) -> Value {
    let query = input
        .get("query")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    let limit = input.get("limit").and_then(Value::as_u64).unwrap_or(3) as usize;
    let mut styles = DESIGN_STYLES
        .iter()
        .filter(|style| {
            query.trim().is_empty()
                || style.id.contains(&query)
                || style.title.to_lowercase().contains(&query)
                || style.summary.to_lowercase().contains(&query)
                || style
                    .components
                    .iter()
                    .any(|component| component.to_lowercase().contains(&query))
        })
        .cloned()
        .collect::<Vec<_>>();
    if styles.is_empty() {
        styles = DESIGN_STYLES.to_vec();
    }
    json!({
        "styles": styles.into_iter().take(limit.max(1)).map(style_summary_json).collect::<Vec<_>>(),
        "guidance": "Run /tools/design/get_style_details for the closest style before producing a UI design.",
    })
}

fn style_details(input: &Value) -> Value {
    let style_id = input
        .get("styleId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let style = DESIGN_STYLES
        .iter()
        .find(|style| style.id == style_id)
        .unwrap_or(&DESIGN_STYLES[0]);
    json!({
        "style": style_json(style),
        "requiredOutput": {
            "section": "Design Research Summary",
            "items": ["selected references", "applicable patterns", "constraints used"]
        }
    })
}

fn style_summary_json(style: DesignStyle) -> Value {
    json!({
        "styleId": style.id,
        "title": style.title,
        "summary": style.summary,
        "components": style.components,
    })
}

fn style_json(style: &DesignStyle) -> Value {
    json!({
        "styleId": style.id,
        "title": style.title,
        "summary": style.summary,
        "tokens": style.tokens,
        "guidelines": style.guidelines,
        "components": style.components,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn design_task_detection_covers_ui_requests() {
        assert!(is_design_task("重新设计这个设置页面"));
        assert!(is_design_task("Build a UI for a dashboard"));
        assert!(!is_design_task("run cargo test"));
    }

    #[test]
    fn design_tools_return_lyra_named_references_without_external_branding() {
        let search = execute_design_tool(
            "lyra_design_search_styles",
            &json!({ "query": "dashboard" }),
        );
        assert_eq!(search["styles"][0]["styleId"], "operational-dashboard");
        let detail = execute_design_tool(
            "lyra_design_get_style_details",
            &json!({ "styleId": "operational-dashboard" }),
        );
        assert_eq!(
            detail["requiredOutput"]["section"],
            "Design Research Summary"
        );
        let text = serde_json::to_string(&detail).expect("serialize detail");
        assert!(!text.to_lowercase().contains("refero"));
    }
}
