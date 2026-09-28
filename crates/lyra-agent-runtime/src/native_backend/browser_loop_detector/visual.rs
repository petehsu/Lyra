use serde_json::{Value, json};

/// Read both full host output and the compact provider representation after budgeting.
pub(crate) fn scene(output: &Value) -> Option<Value> {
    for path in [
        "/raw/observation/scene",
        "/raw/scene",
        "/observation/scene",
        "/scene",
    ] {
        if let Some(scene) = output.pointer(path)
            && scene
                .pointer("/evidence/fingerprint")
                .and_then(Value::as_str)
                .is_some()
        {
            return Some(scene.clone());
        }
    }
    let content = output.get("content")?.as_str()?;
    let value = serde_json::Deserializer::from_str(content)
        .into_iter::<Value>()
        .next()?
        .ok()?;
    scene(&value)
}

pub(crate) fn scope(args: &Value, output: &Value, scene: &Value) -> String {
    let args = args.get("args").unwrap_or(args);
    let tab = args
        .get("tabId")
        .or_else(|| output.get("tabId"))
        .or_else(|| output.pointer("/raw/tabId"))
        .and_then(Value::as_str)
        .unwrap_or("active");
    let mode = args
        .get("targetMode")
        .or_else(|| output.get("targetMode"))
        .or_else(|| output.pointer("/raw/targetMode"))
        .and_then(Value::as_str)
        .unwrap_or("live");
    format!(
        "{tab}|{mode}|{}",
        scene["documentKey"].as_str().unwrap_or("unknown")
    )
}

/// Transport IDs/elapsed time do not constitute new task evidence.
pub(crate) fn progress(scene: &Value) -> Value {
    json!({"document":scene["documentKey"], "pixels":scene["evidence"]["fingerprint"],
        "text":scene["pageText"], "view":scene["view"], "lastAction":scene["lastAction"]})
}

pub(crate) fn action(args: &Value) -> Value {
    let mut args = args.clone();
    if let Some(object) = args.as_object_mut() {
        if let Some(nested) = object.get_mut("args") {
            *nested = action(nested);
        }
        for key in ["captureId", "timeoutMs", "settleTimeoutMs"] {
            object.remove(key);
        }
    }
    args
}
