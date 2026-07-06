//! JSON facade over the active [`ComputerBackend`].
//!
//! Platform N-API shims call these `*_json` entry points with a JSON string and
//! get a JSON string back, so the napi layer stays a thin marshaller. This is
//! also where the act -> diff closed loop (ยง6.3) and the find query (ยง3.1) live,
//! independent of platform.

use serde_json::{json, Value};

use crate::backend::{act_outcome, ComputerBackend};
use crate::model::{
    ActRequest, BackendError, ComputerAction, ComputerFocusRequest, ComputerNode, DeliveryMode,
    ListAppsRequest, MapRequest, MapStrategy, Platform, SessionMode,
};
use crate::snapshot_store::{get_snapshot, observation_diff, remember_snapshot};

/// Selects the backend for the current OS. Returns `None` on platforms without
/// an implementation; callers render an `unsupported` status in that case.
fn active_backend() -> Option<Box<dyn ComputerBackend>> {
    #[cfg(target_os = "macos")]
    {
        Some(Box::new(crate::macos::MacBackend::new()))
    }
    #[cfg(windows)]
    {
        Some(Box::new(crate::windows::WindowsBackend::new()))
    }
    #[cfg(all(target_os = "linux", feature = "linux-atspi"))]
    {
        Some(Box::new(crate::linux::LinuxBackend::new()))
    }
    #[cfg(not(any(
        target_os = "macos",
        windows,
        all(target_os = "linux", feature = "linux-atspi")
    )))]
    {
        None
    }
}

fn unsupported_message() -> String {
    format!(
        "Computer Use semantic control is not implemented for {} yet.",
        std::env::consts::OS
    )
}

fn node_to_value(node: &ComputerNode) -> Value {
    serde_json::to_value(node).unwrap_or_else(|_| json!({}))
}

fn error_envelope(error: &BackendError) -> Value {
    json!({
        "ok": false,
        "platform": Platform::current().as_str(),
        "error": { "kind": error.kind, "message": error.message }
    })
}

fn unsupported_envelope(nodes_field: bool) -> Value {
    let mut envelope = json!({
        "ok": true,
        "platform": Platform::current().as_str(),
        "status": {
            "ok": false,
            "state": "unsupported",
            "message": unsupported_message()
        }
    });
    if nodes_field {
        envelope["nodes"] = json!([]);
    }
    envelope
}

/// `computer.map`: read a slice of the Computer Tree.
///
/// Request fields: `strategy` ("interactive"|"document"), `maxNodes` (1..=400).
pub fn map_json(payload: &str) -> String {
    let request: Value = serde_json::from_str(payload).unwrap_or_else(|_| json!({}));
    let strategy = request
        .get("strategy")
        .and_then(Value::as_str)
        .map(MapStrategy::parse)
        .unwrap_or(MapStrategy::Interactive);
    let max_nodes = request
        .get("maxNodes")
        .and_then(Value::as_u64)
        .map(|value| value.clamp(1, 400) as usize)
        .unwrap_or(200);
    let map_request = MapRequest {
        strategy,
        max_nodes,
    };

    let Some(backend) = active_backend() else {
        return unsupported_envelope(true).to_string();
    };
    if !backend.is_available() {
        return unsupported_envelope(true).to_string();
    }

    match backend.map(&map_request) {
        Ok(nodes) => {
            // Remember the snapshot so a later computer.diff can compute the
            // observation diff against this baseline (ยง3.2 / D2).
            let snapshot_id = remember_snapshot(&nodes);
            let values = nodes.iter().map(node_to_value).collect::<Vec<_>>();
            json!({
                "ok": true,
                "platform": Platform::current().as_str(),
                "snapshotId": snapshot_id,
                "status": {
                    "ok": true,
                    "state": "available",
                    "message": "Computer Tree snapshot was read.",
                    "nodeCount": values.len()
                },
                "nodes": values
            })
            .to_string()
        }
        Err(error) => {
            // Permission / availability problems are reported as a non-fatal
            // status with an empty tree, matching the browser_ax map contract.
            json!({
                "ok": true,
                "platform": Platform::current().as_str(),
                "status": {
                    "ok": false,
                    "state": error.kind,
                    "message": error.message
                },
                "nodes": []
            })
            .to_string()
        }
    }
}

/// `computer.find`: query a fresh tree by role / name substring (ยง3.1).
///
/// Request fields: `role`, `nameIncludes`, `maxResults` (1..=50), plus `strategy`.
pub fn find_json(payload: &str) -> String {
    let request: Value = serde_json::from_str(payload).unwrap_or_else(|_| json!({}));
    let role_filter = request
        .get("role")
        .and_then(Value::as_str)
        .map(|value| value.to_ascii_lowercase());
    let name_filter = request
        .get("nameIncludes")
        .and_then(Value::as_str)
        .map(|value| value.to_ascii_lowercase());
    let max_results = request
        .get("maxResults")
        .and_then(Value::as_u64)
        .map(|value| value.clamp(1, 50) as usize)
        .unwrap_or(10);
    let strategy = request
        .get("strategy")
        .and_then(Value::as_str)
        .map(MapStrategy::parse)
        .unwrap_or(MapStrategy::Interactive);

    let Some(backend) = active_backend() else {
        return unsupported_envelope(true).to_string();
    };
    if !backend.is_available() {
        return unsupported_envelope(true).to_string();
    }

    let map_request = MapRequest {
        strategy,
        max_nodes: 400,
    };
    match backend.map(&map_request) {
        Ok(nodes) => {
            // Remember the full read so the matched osRefs share a diffable
            // baseline, mirroring computer.map.
            let snapshot_id = remember_snapshot(&nodes);
            let matched = nodes
                .into_iter()
                .filter(|node| match &role_filter {
                    Some(role) => node.role == *role,
                    None => true,
                })
                .filter(|node| match &name_filter {
                    Some(name) => node.name.to_ascii_lowercase().contains(name),
                    None => true,
                })
                .take(max_results)
                .map(|node| node_to_value(&node))
                .collect::<Vec<_>>();
            json!({
                "ok": true,
                "platform": Platform::current().as_str(),
                "snapshotId": snapshot_id,
                "matchCount": matched.len(),
                "nodes": matched
            })
            .to_string()
        }
        Err(error) => error_envelope(&error).to_string(),
    }
}

/// `computer.act`: re-resolve `osRef`, act, and return the before/after diff
/// (ยง6.3). Request fields: `osRef`, `action`, `text` (for setText).
pub fn act_json(payload: &str) -> String {
    let request: Value = serde_json::from_str(payload).unwrap_or_else(|_| json!({}));
    let os_ref = request.get("osRef").and_then(Value::as_str).unwrap_or("");
    if os_ref.is_empty() {
        return error_envelope(&BackendError::new(
            "invalidArgument",
            "computer.act requires an osRef from computer.map.",
        ))
        .to_string();
    }
    let action_str = request
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("press");
    let Some(action) = ComputerAction::parse(action_str) else {
        return error_envelope(&BackendError::new(
            "unsupportedAction",
            format!("Unknown computer action {action_str:?}."),
        ))
        .to_string();
    };
    let text = request.get("text").and_then(Value::as_str).map(String::from);
    let mode = request
        .get("mode")
        .and_then(Value::as_str)
        .map(SessionMode::parse)
        .unwrap_or(SessionMode::Shared);
    // Set by the host only after it has resolved a sensitive-value-ref to
    // plaintext out-of-band (the secret never passed through the agent). This
    // is the one sanctioned exception to the secure-field setText block (ยง11).
    let credential_fill = request
        .get("credentialFill")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    // --- New action parameters ---
    let key = request.get("key").and_then(Value::as_str).map(String::from);
    let action_name = request
        .get("actionName")
        .and_then(Value::as_str)
        .map(String::from);
    let direction = request
        .get("direction")
        .and_then(Value::as_str)
        .map(String::from);
    let pages = request.get("pages").and_then(Value::as_f64);
    let from_x = request.get("fromX").and_then(Value::as_f64);
    let from_y = request.get("fromY").and_then(Value::as_f64);
    let to_x = request.get("toX").and_then(Value::as_f64);
    let to_y = request.get("toY").and_then(Value::as_f64);
    let delivery_mode = request
        .get("deliveryMode")
        .and_then(Value::as_str)
        .map(DeliveryMode::parse)
        .unwrap_or_default();

    let act_request = ActRequest {
        os_ref: os_ref.to_string(),
        action,
        text,
        mode,
        key,
        action_name,
        direction,
        pages,
        from_x,
        from_y,
        to_x,
        to_y,
        delivery_mode,
    };

    // Background modes are true background (ยง14.2): refuse foreground-stealing
    // actions rather than silently activating the target.
    if action == ComputerAction::Focus && !mode.allows_foreground_steal() {
        let mut value = error_envelope(&BackendError::new(
            "foregroundStealBlocked",
            format!(
                "focus would raise the window; not allowed in {} mode. Use shared mode or a semantic action (press/setText/toggle).",
                mode.as_str()
            ),
        ));
        value["osRef"] = json!(os_ref);
        value["action"] = json!(action.as_str());
        value["mode"] = json!(mode.as_str());
        return value.to_string();
    }

    // Drag moves the physical pointer — shared mode only.
    if action == ComputerAction::Drag && !mode.allows_foreground_steal() {
        let mut value = error_envelope(&BackendError::new(
            "foregroundStealBlocked",
            format!(
                "drag requires shared mode to move the physical pointer; not allowed in {} mode.",
                mode.as_str()
            ),
        ));
        value["osRef"] = json!(os_ref);
        value["action"] = json!(action.as_str());
        value["mode"] = json!(mode.as_str());
        return value.to_string();
    }

    // delivery_mode:"foreground" steals focus (SendInput + SetForegroundWindow);
    // background/isolated session modes forbid that.
    if delivery_mode.is_foreground() && !mode.allows_foreground_steal() {
        let mut value = error_envelope(&BackendError::new(
            "foregroundStealBlocked",
            format!(
                "deliveryMode \"foreground\" would steal focus; not allowed in {} mode. \
                 Use deliveryMode \"background\" (PostMessage) or switch to shared mode.",
                mode.as_str()
            ),
        ));
        value["osRef"] = json!(os_ref);
        value["action"] = json!(action.as_str());
        value["mode"] = json!(mode.as_str());
        return value.to_string();
    }

    let Some(backend) = active_backend() else {
        return error_envelope(&BackendError::unsupported(unsupported_message())).to_string();
    };
    if !backend.is_available() {
        return error_envelope(&BackendError::unsupported(unsupported_message())).to_string();
    }

    // Closed loop: snapshot the node, act, snapshot again, diff.
    let before = backend.resolve(os_ref).unwrap_or(None);

    // Hard-block writing into secure (password) fields (ยง11) โ�� UNLESS this is a
    // credential fill, where the host resolved a sensitive-value-ref to
    // plaintext out-of-band and the agent never saw the secret. Plain `setText`
    // with agent-authored text into a password field stays blocked.
    if action == ComputerAction::SetText
        && before.as_ref().is_some_and(|node| node.secure)
        && !credential_fill
    {
        let mut value = error_envelope(&BackendError::new(
            "secureFieldBlocked",
            "Refusing agent-authored text into a secure (password) field. Pass a sensitiveValueRef to autofill from the vault, or ask the member to enter it themselves.",
        ));
        value["osRef"] = json!(os_ref);
        value["action"] = json!(action.as_str());
        value["blocked"] = json!(true);
        return value.to_string();
    }

    match backend.act(&act_request) {
        Ok(()) => {
            let after = backend.resolve(os_ref).unwrap_or(None);
            let outcome = act_outcome(true, os_ref, action, before, after);
            let mut value = serde_json::to_value(&outcome).unwrap_or_else(|_| json!({}));
            value["platform"] = json!(Platform::current().as_str());
            value["mode"] = json!(mode.as_str());
            if credential_fill {
                // Audit marker. The secret itself is never echoed: secure nodes
                // suppress `value` in their normalized form.
                value["credentialFill"] = json!(true);
            }
            if outcome.changed.is_empty() {
                value["warning"] = json!(
                    "Action reported success but no observable state change was detected; verify with computer.map."
                );
            }
            value.to_string()
        }
        Err(error) => {
            let mut value = error_envelope(&error);
            value["osRef"] = json!(os_ref);
            value["action"] = json!(action.as_str());
            value.to_string()
        }
    }
}

/// `computer.diff`: two modes (ยง3.2 / D2).
///
/// - `baselineSnapshotId` present: re-read the full tree and return the
///   observation diff (added / removed / changed) against that earlier
///   `computer.map` snapshot, plus a fresh `snapshotId` for chaining.
/// - `osRef` only: re-read that single node's current state to verify a prior
///   action or detect a stale reference.
pub fn diff_json(payload: &str) -> String {
    let request: Value = serde_json::from_str(payload).unwrap_or_else(|_| json!({}));
    let baseline_id = request
        .get("baselineSnapshotId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty());

    if let Some(baseline_id) = baseline_id {
        return snapshot_diff_json(baseline_id, &request);
    }

    let os_ref = request.get("osRef").and_then(Value::as_str).unwrap_or("");
    if os_ref.is_empty() {
        return error_envelope(&BackendError::new(
            "invalidArgument",
            "computer.diff requires an osRef, or a baselineSnapshotId for a snapshot diff.",
        ))
        .to_string();
    }

    let Some(backend) = active_backend() else {
        return error_envelope(&BackendError::unsupported(unsupported_message())).to_string();
    };

    match backend.resolve(os_ref) {
        Ok(Some(node)) => json!({
            "ok": true,
            "platform": Platform::current().as_str(),
            "present": true,
            "node": node_to_value(&node)
        })
        .to_string(),
        Ok(None) => json!({
            "ok": true,
            "platform": Platform::current().as_str(),
            "present": false,
            "message": "Node is no longer present; the osRef is stale."
        })
        .to_string(),
        Err(error) => error_envelope(&error).to_string(),
    }
}

/// Observation diff between an earlier snapshot and a fresh read of the tree.
fn snapshot_diff_json(baseline_id: &str, request: &Value) -> String {
    let Some(baseline) = get_snapshot(baseline_id) else {
        return json!({
            "ok": true,
            "platform": Platform::current().as_str(),
            "baselineFound": false,
            "message": "Baseline snapshot is missing or expired; re-run computer.map."
        })
        .to_string();
    };

    let strategy = request
        .get("strategy")
        .and_then(Value::as_str)
        .map(MapStrategy::parse)
        .unwrap_or(MapStrategy::Interactive);
    let max_nodes = request
        .get("maxNodes")
        .and_then(Value::as_u64)
        .map(|value| value.clamp(1, 400) as usize)
        .unwrap_or(200);

    let Some(backend) = active_backend() else {
        return error_envelope(&BackendError::unsupported(unsupported_message())).to_string();
    };

    let map_request = MapRequest {
        strategy,
        max_nodes,
    };
    match backend.map(&map_request) {
        Ok(fresh) => {
            let diff = observation_diff(&baseline, &fresh);
            let snapshot_id = remember_snapshot(&fresh);
            let mut value = serde_json::to_value(&diff).unwrap_or_else(|_| json!({}));
            value["ok"] = json!(true);
            value["platform"] = json!(Platform::current().as_str());
            value["baselineFound"] = json!(true);
            value["baselineSnapshotId"] = json!(baseline_id);
            value["snapshotId"] = json!(snapshot_id);
            if diff.is_empty() {
                value["message"] = json!("No observable change since the baseline snapshot.");
            }
            value.to_string()
        }
        Err(error) => error_envelope(&error).to_string(),
    }
}

/// `computer.explain`: report whether semantic control is available on this OS
/// and what the recommended path is, so the Agent can decide on escalation
/// (ยง4 Level 1->2->3). Request fields: `osRef` (optional).
pub fn explain_json(payload: &str) -> String {
    let request: Value = serde_json::from_str(payload).unwrap_or_else(|_| json!({}));
    let os_ref = request.get("osRef").and_then(Value::as_str);

    let Some(backend) = active_backend() else {
        return json!({
            "ok": true,
            "platform": Platform::current().as_str(),
            "semanticAvailable": false,
            "recommendation": "vision-fallback",
            "fallback": "vision",
            "nextRecommendedAction": "computer.see",
            "message": format!("{} Use computer.see to read it visually.", unsupported_message())
        })
        .to_string();
    };
    if !backend.is_available() {
        return json!({
            "ok": true,
            "platform": Platform::current().as_str(),
            "semanticAvailable": false,
            "recommendation": "vision-fallback",
            "fallback": "vision",
            "nextRecommendedAction": "computer.see",
            "message": format!("{} Use computer.see to read it visually.", unsupported_message())
        })
        .to_string();
    }

    let resolved = match os_ref {
        Some(reference) => backend.resolve(reference).unwrap_or(None),
        None => None,
    };

    // Secure (password) fields are hard-blocked: surface that explicitly (ยง11).
    if let Some(node) = resolved.as_ref().filter(|node| node.secure) {
        return json!({
            "ok": true,
            "platform": Platform::current().as_str(),
            "semanticAvailable": true,
            "blocked": true,
            "recommendation": "user-action",
            "message": "This is a secure (password) field. Lyra will not read or type into it; the member must enter it.",
            "node": node_to_value(node)
        })
        .to_string();
    }

    let (recommendation, message) = match (os_ref, &resolved) {
        (Some(_), Some(_)) => (
            "semantic",
            "Node is reachable through OS accessibility; use computer.act with its osRef.",
        ),
        (Some(_), None) => (
            "remap",
            "osRef is stale; re-run computer.map to obtain a fresh osRef.",
        ),
        (None, _) => (
            "semantic",
            "OS accessibility is available; start with computer.map then computer.act.",
        ),
    };
    json!({
        "ok": true,
        "platform": Platform::current().as_str(),
        "semanticAvailable": true,
        "blocked": false,
        "recommendation": recommendation,
        "message": message,
        "node": resolved.as_ref().map(node_to_value)
    })
    .to_string()
}

/// `computer.list_apps`: enumerate running desktop applications.
///
/// Request fields: `maxApps` (1..=100), `includeBackground` (default false).
pub fn list_apps_json(payload: &str) -> String {
    let request: Value = serde_json::from_str(payload).unwrap_or_else(|_| json!({}));
    let max_apps = request
        .get("maxApps")
        .and_then(Value::as_u64)
        .map(|value| value.clamp(1, 100) as usize)
        .unwrap_or(50);
    let include_background = request
        .get("includeBackground")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let list_request = ListAppsRequest {
        max_apps,
        include_background,
    };

    let Some(backend) = active_backend() else {
        return unsupported_envelope(false).to_string();
    };
    if !backend.is_available() {
        return unsupported_envelope(false).to_string();
    }

    match backend.list_apps(&list_request) {
        Ok(apps) => {
            let values = apps
                .iter()
                .map(|app| serde_json::to_value(app).unwrap_or_else(|_| json!({})))
                .collect::<Vec<_>>();
            json!({
                "ok": true,
                "platform": Platform::current().as_str(),
                "status": {
                    "ok": true,
                    "state": "available",
                    "message": "Desktop applications were listed.",
                    "appCount": values.len()
                },
                "apps": values
            })
            .to_string()
        }
        Err(error) => json!({
            "ok": true,
            "platform": Platform::current().as_str(),
            "status": {
                "ok": false,
                "state": error.kind,
                "message": error.message
            },
            "apps": []
        })
        .to_string(),
    }
}

/// `computer.observe`: read foreground app, focused window, and focused control.
pub fn observe_json(_payload: &str) -> String {
    let Some(backend) = active_backend() else {
        return json!({
            "ok": true,
            "platform": Platform::current().as_str(),
            "status": {
                "ok": false,
                "state": "unsupported",
                "message": unsupported_message()
            }
        })
        .to_string();
    };
    if !backend.is_available() {
        return json!({
            "ok": true,
            "platform": Platform::current().as_str(),
            "status": {
                "ok": false,
                "state": "unsupported",
                "message": unsupported_message()
            }
        })
        .to_string();
    }

    match backend.observe() {
        Ok(observation) => {
            let mut value = serde_json::to_value(&observation).unwrap_or_else(|_| json!({}));
            if let Value::Object(ref mut map) = value {
                map.insert("ok".to_string(), json!(true));
                map.insert("platform".to_string(), json!(Platform::current().as_str()));
                map.insert(
                    "status".to_string(),
                    json!({
                        "ok": true,
                        "state": "available",
                        "message": "Desktop foreground state was observed."
                    }),
                );
            }
            value.to_string()
        }
        Err(error) => json!({
            "ok": true,
            "platform": Platform::current().as_str(),
            "status": {
                "ok": false,
                "state": error.kind,
                "message": error.message
            }
        })
        .to_string(),
    }
}

/// `computer.focus`: raise an app or window to the foreground (session-level).
///
/// Request fields: `appRef`, `pid`, `bundleId`, `windowTitle`, `windowRef`, `mode`.
/// Background/isolated modes refuse foreground steal (`foregroundStealBlocked`).
pub fn focus_json(payload: &str) -> String {
    let request: Value = serde_json::from_str(payload).unwrap_or_else(|_| json!({}));
    let mode = request
        .get("mode")
        .and_then(Value::as_str)
        .map(SessionMode::parse)
        .unwrap_or(SessionMode::Shared);

    if !mode.allows_foreground_steal() {
        return error_envelope(&BackendError::new(
            "foregroundStealBlocked",
            format!(
                "computer.focus would raise an app/window; not allowed in {} mode. Use shared mode.",
                mode.as_str()
            ),
        ))
        .to_string();
    }

    let focus_request = ComputerFocusRequest {
        app_ref: request
            .get("appRef")
            .and_then(Value::as_str)
            .map(str::to_string),
        pid: request.get("pid").and_then(Value::as_i64),
        bundle_id: request
            .get("bundleId")
            .and_then(Value::as_str)
            .map(str::to_string),
        window_title: request
            .get("windowTitle")
            .and_then(Value::as_str)
            .map(str::to_string),
        window_ref: request
            .get("windowRef")
            .and_then(Value::as_str)
            .map(str::to_string),
    };

    if !focus_request.has_target() {
        return error_envelope(&BackendError::new(
            "invalidArgument",
            "computer.focus requires appRef, pid, bundleId, windowTitle, or windowRef.",
        ))
        .to_string();
    }

    let Some(backend) = active_backend() else {
        return error_envelope(&BackendError::unsupported(unsupported_message())).to_string();
    };
    if !backend.is_available() {
        return error_envelope(&BackendError::unsupported(unsupported_message())).to_string();
    }

    match backend.focus(&focus_request) {
        Ok(()) => json!({
            "ok": true,
            "platform": Platform::current().as_str(),
            "mode": mode.as_str(),
            "focused": true,
            "message": "Application or window was brought to the foreground."
        })
        .to_string(),
        Err(error) => error_envelope(&error).to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_on_unsupported_platform_reports_status() {
        // On non-macOS hosts the facade must degrade to an unsupported status
        // rather than erroring, so the tool family stays callable everywhere.
        let out = map_json("{}");
        let value: Value = serde_json::from_str(&out).expect("valid json");
        assert_eq!(value["ok"], json!(true));
        assert!(value.get("nodes").is_some());
    }

    #[test]
    fn act_requires_os_ref() {
        let out = act_json("{}");
        let value: Value = serde_json::from_str(&out).expect("valid json");
        assert_eq!(value["ok"], json!(false));
        assert_eq!(value["error"]["kind"], json!("invalidArgument"));
    }

    #[test]
    fn act_rejects_unknown_action() {
        let out = act_json(r#"{"osRef":"osax:0/1","action":"levitate"}"#);
        let value: Value = serde_json::from_str(&out).expect("valid json");
        assert_eq!(value["ok"], json!(false));
        assert_eq!(value["error"]["kind"], json!("unsupportedAction"));
    }

    #[test]
    fn explain_reports_recommendation() {
        let out = explain_json("{}");
        let value: Value = serde_json::from_str(&out).expect("valid json");
        assert_eq!(value["ok"], json!(true));
        assert!(value.get("recommendation").is_some());
    }

    #[test]
    fn focus_is_blocked_in_background_mode() {
        // A focus/raise would steal the foreground, which background modes
        // forbid (ยง14.2). This gate runs before any backend call, so it is
        // testable on every platform.
        let out = act_json(r#"{"osRef":"osax:0/1","action":"focus","mode":"background-semantic"}"#);
        let value: Value = serde_json::from_str(&out).expect("valid json");
        assert_eq!(value["ok"], json!(false));
        assert_eq!(value["error"]["kind"], json!("foregroundStealBlocked"));
        assert_eq!(value["mode"], json!("background-semantic"));
    }

    #[test]
    fn focus_is_allowed_in_shared_mode_gate() {
        // In shared mode the foreground-steal gate must not trip; on an
        // unsupported platform it then degrades to an unsupported error rather
        // than a foregroundStealBlocked error.
        let out = act_json(r#"{"osRef":"osax:0/1","action":"focus","mode":"shared"}"#);
        let value: Value = serde_json::from_str(&out).expect("valid json");
        assert_ne!(value["error"]["kind"], json!("foregroundStealBlocked"));
    }

    #[test]
    fn list_apps_on_unsupported_platform_reports_status() {
        let out = list_apps_json("{}");
        let value: Value = serde_json::from_str(&out).expect("valid json");
        assert_eq!(value["ok"], json!(true));
        assert!(value.get("apps").is_some());
    }

    #[test]
    fn observe_on_unsupported_platform_reports_status() {
        let out = observe_json("{}");
        let value: Value = serde_json::from_str(&out).expect("valid json");
        assert_eq!(value["ok"], json!(true));
        assert!(value.get("status").is_some());
    }

    #[test]
    fn focus_requires_target() {
        let out = focus_json("{}");
        let value: Value = serde_json::from_str(&out).expect("valid json");
        assert_eq!(value["ok"], json!(false));
        assert_eq!(value["error"]["kind"], json!("invalidArgument"));
    }

    #[test]
    fn session_focus_is_blocked_in_background_mode() {
        let out = focus_json(r#"{"appRef":"osxapp:42","mode":"background-semantic"}"#);
        let value: Value = serde_json::from_str(&out).expect("valid json");
        assert_eq!(value["ok"], json!(false));
        assert_eq!(value["error"]["kind"], json!("foregroundStealBlocked"));
    }

    #[test]
    fn session_focus_is_allowed_in_shared_mode_gate() {
        let out = focus_json(r#"{"appRef":"osxapp:42","mode":"shared"}"#);
        let value: Value = serde_json::from_str(&out).expect("valid json");
        assert_ne!(value["error"]["kind"], json!("foregroundStealBlocked"));
    }

    #[test]
    fn delivery_mode_foreground_blocked_in_background_semantic() {
        let out = act_json(
            r#"{"osRef":"osax:0/1","action":"pressKey","key":"return","mode":"background-semantic","deliveryMode":"foreground"}"#,
        );
        let value: Value = serde_json::from_str(&out).expect("valid json");
        assert_eq!(value["ok"], json!(false));
        assert_eq!(value["error"]["kind"], json!("foregroundStealBlocked"));
        assert_eq!(value["mode"], json!("background-semantic"));
    }
}
