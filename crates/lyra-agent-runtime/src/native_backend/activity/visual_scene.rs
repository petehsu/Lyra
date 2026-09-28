use super::*;

/// The provider sees formatted text, not the activity panel's raw object.
/// Keep the actionable scene identity and receipts even when maps are large.
pub(super) fn format_visual_scene(value: &Value) -> String {
    let mut output = Map::new();
    for key in [
        "ok",
        "tabId",
        "targetMode",
        "captureId",
        "captureAgeMs",
        "completed",
        "dispatched",
        "reason",
        "error",
        "message",
        "mapAppendix",
        "inputDelivery",
        "targetRef",
        "indexCount",
        "presentedCount",
        "observationError",
        "observationWait",
        "matched",
        "completion",
        "until",
        "waitState",
        "coverage",
        "content",
        "url",
        "title",
        "scope",
        "elapsedMs",
        "stopReason",
        "truncated",
        "nextRecommendedAction",
    ] {
        if let Some(field) = value.get(key) {
            output.insert(key.into(), field.clone());
        }
    }
    if let Some(results) = value.get("results").and_then(Value::as_array) {
        output.insert(
            "steps".into(),
            Value::Array(
                results
                    .iter()
                    .map(|result| {
                        let mut receipt = Map::new();
                        for key in [
                            "ok",
                            "interaction",
                            "mark",
                            "cell",
                            "dispatched",
                            "error",
                            "message",
                        ] {
                            if let Some(field) = result.get(key) {
                                receipt.insert(key.into(), field.clone());
                            }
                        }
                        Value::Object(receipt)
                    })
                    .collect(),
            ),
        );
    }
    if let Some(scene) = value
        .pointer("/observation/scene")
        .or_else(|| value.get("scene"))
    {
        let mut compact = Map::new();
        for key in [
            "captureId",
            "totalVisible",
            "unmarkedCount",
            "nextOffset",
            "region",
            "coordinates",
            "documentKey",
            "evidence",
            "rendered",
            "lastInput",
            "observationKind",
            "coverage",
            "pageText",
            "view",
            "lastAction",
        ] {
            if let Some(field) = scene.get(key) {
                compact.insert(key.into(), field.clone());
            }
        }
        if let Some(marks) = scene.get("marks").and_then(Value::as_array) {
            // Boxes already carry their marks in the attached image. Region
            // geometry matters for canvas input; repeated control rectangles do not.
            compact.insert(
                "controls".into(),
                Value::Array(
                    marks
                        .iter()
                        .filter(|mark| mark["kind"] != "region")
                        .filter_map(|mark| mark.get("mark").cloned())
                        .collect(),
                ),
            );
            compact.insert(
                "regions".into(),
                Value::Array(
                    marks
                        .iter()
                        .filter(|mark| mark["kind"] == "region")
                        .cloned()
                        .collect(),
                ),
            );
            compact.insert(
                "disabled".into(),
                Value::Array(
                    marks
                        .iter()
                        .filter(|mark| mark["disabled"] == true)
                        .filter_map(|mark| mark.get("mark").cloned())
                        .collect(),
                ),
            );
        }
        output.insert("scene".into(), Value::Object(compact));
    }
    serde_json::to_string(&output).unwrap_or_default()
}
