use super::*;

include!(concat!(env!("OUT_DIR"), "/design_catalog.rs"));

/// `design_reference` tool — gives the Agent a curated library of real-world
/// DESIGN.md design system documents (colors, typography, spacing, patterns)
/// from production websites.
///
/// Actions:
/// - `list` (default): returns all brands + one-line descriptions
/// - `read`: returns the full DESIGN.md for a given `brand`
pub(crate) fn tool_design_reference(input: &Value) -> NativeToolResult {
    let action = value_string(input, "action").unwrap_or_else(|| "list".to_string());
    match action.as_str() {
        "list" => {
            let entries: Vec<Value> = DESIGN_CATALOG
                .iter()
                .map(|entry| {
                    json!({
                        "brand": entry.brand,
                        "description": entry.description,
                    })
                })
                .collect();
            Ok(NativeToolSuccess {
                content: format!(
                    "{} design references available. Call design_reference with action=read and brand=<name> to read a full DESIGN.md.",
                    entries.len()
                ),
                raw: json!({
                    "count": entries.len(),
                    "references": entries,
                }),
                recommended_next_action: Some(
                    "Pick a brand that matches the target design language, then call design_reference with action=read, brand=<name>."
                        .to_string(),
                ),
            })
        }
        "read" => {
            let brand = required_value_string(input, "brand")?;
            DESIGN_CATALOG
                .iter()
                .find(|entry| entry.brand == brand)
                .map(|entry| NativeToolSuccess {
                    content: entry.content.to_string(),
                    raw: json!({
                        "brand": entry.brand,
                        "bytes": entry.content.len(),
                    }),
                    recommended_next_action: None,
                })
                .ok_or_else(|| {
                    NativeToolFailure::new(
                        "brand_not_found",
                        format!("Unknown design reference brand: {brand}"),
                        "Call design_reference with action=list to see available brands.",
                    )
                })
        }
        _ => Err(NativeToolFailure::new(
            "bad_action",
            format!("Unknown action: {action}"),
            "Use action=list to see all design references, or action=read with a brand name.",
        )),
    }
}
