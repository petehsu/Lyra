use serde_json::{Value, json};

fn point(relative: bool) -> Value {
    let mut coordinate = json!({"type":"number","minimum":0});
    if relative {
        coordinate["maximum"] = json!(1);
    }
    json!({"type":"object","properties":{"x":coordinate,"y":coordinate},"required":["x","y"],"additionalProperties":false})
}

fn cell() -> Value {
    json!({"type":"object","properties":{"row":{"type":"integer","minimum":1},"column":{"type":"integer","minimum":1}},"required":["row","column"],"additionalProperties":false,
        "description":"1-based row and column of a published grid mark. Rows downward, columns rightward. DOM grids address real control centers; image-lines grids address visible line intersections, not cells between lines. Do not guess dimensions or infer clickability from a grid. Omit position/point/path when using cell."})
}

fn anchor() -> Value {
    json!({"type":"object","properties":{"anchor":{"oneOf":[{"type":"string","enum":["center","lastInput"]},cell()]},"direction":{"type":"string","enum":["up","down","left","right","upLeft","upRight","downLeft","downRight"]},"steps":{"type":"integer","minimum":1,"maximum":1600}},"required":["anchor"],"additionalProperties":false,"description":"Explicit spatial intent within mark. System computes coordinates. Grid center must be unique (odd dimensions); lastInput is the last delivered location for this object, not an inferred opponent move. Optional direction/steps move through observed grid cells. On other objects center/lastInput works without direction. Exclusive with cell/position/point/path."})
}

pub(super) fn see_schema() -> Value {
    super::object_schema(
        [
            ("tabId", super::browser_tab_id_schema()),
            ("targetMode", super::browser_target_mode_schema()),
            (
                "highlightTargets",
                json!({"type":"boolean","default":true,"description":"Draw only thin real-object boxes and short marks. No selector text or DOM tooltip overlay."}),
            ),
            (
                "region",
                json!({"type":"string","description":"Previously seen mark to magnify with surrounding context. Marks stay the same."}),
            ),
            ("cell", cell()),
            (
                "representation",
                json!({"type":"string","enum":["image","structure"],"default":"image","description":"structure returns rendered DOM facts without pixels; use with region/cell to retrieve omitted state details. Canvas internals require image."}),
            ),
            (
                "zoom",
                json!({"type":"number","minimum":1,"maximum":4,"description":"Enlarge captured pixels up to 4x; does not change webpage layout. Region views enlarge automatically. With region and cell, show a five-by-five-cell neighborhood using global row/column addresses."}),
            ),
            (
                "offset",
                json!({"type":"integer","minimum":0,"description":"nextOffset from a crowded visual scene. Other visible objects remain indexed."}),
            ),
            (
                "maxMarks",
                json!({"type":"integer","minimum":1,"maximum":160,"default":80}),
            ),
            (
                "downsampleForVision",
                json!({"type":"boolean","default":true}),
            ),
            ("timeoutMs", super::browser_timeout_ms_schema()),
        ],
        &[],
    )
}

pub(super) fn action_schema() -> Value {
    let step = super::object_schema(
        [
            (
                "interaction",
                json!({"type":"string","enum":["click","doubleClick","rightClick","hover","drag","scroll","type","press"]}),
            ),
            (
                "mark",
                json!({"type":"string","description":"Short mark printed in the referenced image. Resolves the same real object at execution time."}),
            ),
            ("position", point(true)),
            ("cell", cell()),
            (
                "toMark",
                json!({"type":"string","description":"Drag destination mark."}),
            ),
            ("at", anchor()),
            ("toAt", anchor()),
            ("toPosition", point(true)),
            ("toCell", cell()),
            ("point", point(false)),
            ("to", point(false)),
            (
                "path",
                json!({"type":"array","minItems":2,"maxItems":128,"items":point(false),"description":"Continuous drag waypoints: fractions 0..1 within mark, or image pixels without mark. Does not release between points."}),
            ),
            (
                "durationMs",
                json!({"type":"number","minimum":0,"maximum":3000,"description":"Total drag motion duration, default 300ms."}),
            ),
            (
                "holdMs",
                json!({"type":"integer","minimum":0,"maximum":3000,"description":"Hold mouse/key down, then always release, including on interruption."}),
            ),
            (
                "modifiers",
                json!({"type":"array","items":{"enum":["shift","control","alt","meta"]}}),
            ),
            (
                "button",
                json!({"type":"string","enum":["left","middle","right"]}),
            ),
            (
                "scrollDx",
                json!({"type":"number","minimum":-10000,"maximum":10000}),
            ),
            (
                "scrollDy",
                json!({"type":"number","minimum":-10000,"maximum":10000}),
            ),
            (
                "text",
                json!({"type":"string","description":"Text for a marked editable control."}),
            ),
            ("clear", json!({"type":"boolean","default":false})),
            (
                "key",
                json!({"type":"string","description":"Key/chord, e.g. ArrowRight, Space, Control+a. The document keeps keyboard focus across steps."}),
            ),
        ],
        &["interaction"],
    );
    let mut schema = step.clone();
    let properties = schema["properties"].as_object_mut().unwrap();
    properties.insert("tabId".into(), super::browser_tab_id_schema());
    properties.insert("targetMode".into(), super::browser_target_mode_schema());
    properties.insert("captureId".into(), json!({"type":"string","description":"Optional for marks: automatically binds the latest observation actually returned to this task on this tab. Explicit IDs never silently switch. REQUIRED for raw image points; single-use. Observations expire after five minutes."}));
    properties.insert("effect".into(), super::browser_action_effect_schema());
    properties.insert("steps".into(), json!({"type":"array","minItems":1,"maxItems":16,"items":step,"description":"Explicit known actions only, sharing the declared effect. Stops on failure/navigation and reports completed count. Do not pre-plan an opponent's unknown response."}));
    properties.insert("observe".into(), json!({"type":"string","enum":["auto","image","structure","none"],"default":"auto","description":"auto preserves observation mode: rendered state after structure input, marked image after visual input. structure reads DOM render facts without pixels; image captures pixels. Reuse the result; no extra map/see required."}));
    properties.insert("timeoutMs".into(), super::browser_timeout_ms_schema());
    properties.insert("settleTimeoutMs".into(), json!({"type":"integer","minimum":0,"maximum":2000,"description":"Bounded rendered-state/paint wait for either observation mode. 0 skips sampling. Quiet is not task completion. Use after for a known condition; no wait when observe=none."}));
    properties.insert("after".into(), json!({"type":"object","properties":{
        "until":{"type":"string","enum":["textContains","textGone","targetHidden","targetEnabled","stateChanged"]},
        "text":{"type":"string","minLength":1,"description":"Exact expected page text, required for textContains/textGone."},
        "mark":{"type":"string","description":"Known mark; required for target/state conditions, optional text scope. Omit for main-page text."},
        "timeoutMs":{"type":"integer","minimum":0,"maximum":30000,"default":10000}
    },"required":["until"],"additionalProperties":false,"description":"After delivering input once, wait for an explicit rendered condition and return the resulting scene in this call. No new map or model round is needed. Pick a condition that establishes the desired transition; quiet or text already present before input does not prove a new response. conditionMet establishes only this condition, not overall task success. Incompatible with observe=none."}));
    properties.insert("interaction".into(), json!({"type":"string","enum":["click","doubleClick","rightClick","hover","drag","scroll","type","press","sequence"],"default":"click"}));
    schema["required"] = json!(["effect"]);
    schema
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scene_schema_exposes_marks_regions_and_bounded_continuous_input() {
        let see = see_schema();
        assert!(see["properties"].get("region").is_some());
        assert!(see["properties"].get("annotate").is_none());
        let act = action_schema();
        assert_eq!(
            act["properties"]["position"]["properties"]["x"]["maximum"],
            1
        );
        assert_eq!(act["properties"]["steps"]["maxItems"], 16);
        assert_eq!(act["properties"]["path"]["maxItems"], 128);
        assert_eq!(act["properties"]["observe"]["default"], "auto");
        assert_eq!(act["properties"]["after"]["required"], json!(["until"]));
        assert_eq!(
            act["properties"]["after"]["properties"]["timeoutMs"]["maximum"],
            30000
        );
        assert!(
            act["properties"]["after"]["properties"]["until"]["enum"]
                .as_array()
                .unwrap()
                .contains(&json!("stateChanged"))
        );
        assert_eq!(act["properties"]["cell"]["properties"]["row"]["minimum"], 1);
        assert_eq!(
            act["properties"]["steps"]["items"]["properties"]["toCell"]["required"],
            json!(["row", "column"])
        );
        assert!(
            act["properties"]["steps"]["items"]["properties"]
                .get("effect")
                .is_none()
        );
    }
}
