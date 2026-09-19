use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use serde_json::Value;

use super::events::emit_event;
use super::uri::{file_uri_to_path, path_to_file_uri};
use super::{LspDiagnostic, LspRuntimeEvent};

struct StoredDiagnostics {
    generation: u64,
    items: Vec<LspDiagnostic>,
}

static STORE: Lazy<Mutex<HashMap<String, StoredDiagnostics>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static WORKSPACE_NOTES: Lazy<Mutex<HashMap<String, String>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn is_workspace_analysis_message(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    (lower.contains("toolchain") && lower.contains("is not installed"))
        || lower.contains("rustc --print cfg")
        || lower.contains("can't find crate for `std`")
        || (lower.contains("rustup") && lower.contains("not installed"))
}

pub fn record_workspace_note(project_root: &str, note: &str) {
    let root = project_root.trim();
    if root.is_empty() || note.trim().is_empty() {
        return;
    }
    let mut guard = WORKSPACE_NOTES
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    guard.insert(root.to_string(), note.trim().to_string());
}

pub fn workspace_analysis_note(project_root: Option<&str>) -> Option<String> {
    let root = project_root
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let guard = WORKSPACE_NOTES
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    guard.get(root).cloned()
}

pub fn upsert(uri: &str, file_path: Option<&str>, items: Vec<LspDiagnostic>) -> u64 {
    let mut guard = STORE.lock().unwrap_or_else(|error| error.into_inner());
    let generation = guard
        .get(uri)
        .map(|entry| entry.generation.saturating_add(1))
        .unwrap_or(1);
    guard.insert(
        uri.to_string(),
        StoredDiagnostics {
            generation,
            items: items.clone(),
        },
    );
    drop(guard);
    emit_event(LspRuntimeEvent {
        file_path: file_path
            .map(str::to_string)
            .or_else(|| file_uri_to_path(uri)),
        diagnostics: Some(items),
        ..super::events::default_event("diagnostics")
    });
    generation
}

pub fn upsert_for_path(file_path: &str, items: Vec<LspDiagnostic>) -> u64 {
    let path = PathBuf::from(file_path);
    let uri = path_to_file_uri(&path).unwrap_or_else(|_| format!("file://{file_path}"));
    upsert(&uri, Some(file_path), items)
}

pub fn generation_for_path(file_path: &str) -> u64 {
    let Ok(uri) = path_to_file_uri(Path::new(file_path)) else {
        return 0;
    };
    let guard = STORE.lock().unwrap_or_else(|error| error.into_inner());
    guard.get(&uri).map(|entry| entry.generation).unwrap_or(0)
}

pub fn for_path(file_path: &str) -> Vec<LspDiagnostic> {
    let Ok(uri) = path_to_file_uri(Path::new(file_path)) else {
        return Vec::new();
    };
    let guard = STORE.lock().unwrap_or_else(|error| error.into_inner());
    guard
        .get(&uri)
        .map(|entry| entry.items.clone())
        .unwrap_or_default()
}

pub fn for_workspace(project_root: Option<&str>) -> Vec<LspDiagnostic> {
    let guard = STORE.lock().unwrap_or_else(|error| error.into_inner());
    let mut items = guard
        .values()
        .flat_map(|entry| entry.items.iter().cloned())
        .collect::<Vec<_>>();
    if let Some(root) = project_root {
        let prefix = root.trim();
        items.retain(|item| item.file_path.starts_with(prefix));
    }
    items
}

pub fn wait_for_update(
    file_path: &str,
    min_generation: u64,
    timeout: Duration,
) -> Vec<LspDiagnostic> {
    let deadline = Instant::now() + timeout;
    loop {
        if generation_for_path(file_path) > min_generation {
            return for_path(file_path);
        }
        if Instant::now() >= deadline {
            return for_path(file_path);
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

pub fn apply_publish_diagnostics(params: &Value, uri_paths: &HashMap<String, String>) {
    let Some(uri) = params.get("uri").and_then(Value::as_str) else {
        return;
    };
    let file_path = uri_paths
        .get(uri)
        .cloned()
        .or_else(|| file_uri_to_path(uri));
    let items = params
        .get("diagnostics")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| parse_diagnostic(entry, file_path.as_deref().unwrap_or("")))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    upsert(uri, file_path.as_deref(), items);
}

fn parse_diagnostic(value: &Value, file_path: &str) -> Option<LspDiagnostic> {
    let message = value.get("message")?.as_str()?.to_string();
    let range = value.get("range")?;
    let start = range.get("start")?;
    let end = range.get("end")?;
    let code = match value.get("code") {
        Some(Value::String(text)) => Some(text.clone()),
        Some(Value::Number(number)) => Some(number.to_string()),
        _ => None,
    };
    Some(LspDiagnostic {
        file_path: file_path.to_string(),
        severity: value.get("severity").and_then(Value::as_u64).unwrap_or(1) as u32,
        message,
        source: value
            .get("source")
            .and_then(Value::as_str)
            .map(str::to_string),
        code,
        start_line: start.get("line")?.as_u64()? as u32,
        start_character: start.get("character")?.as_u64()? as u32,
        end_line: end.get("line")?.as_u64()? as u32,
        end_character: end.get("character")?.as_u64()? as u32,
    })
}

pub fn workspace_error_count(project_root: &str) -> usize {
    let items = for_workspace(Some(project_root));
    error_diagnostics(&items, items.len()).len()
}

pub fn error_diagnostics(items: &[LspDiagnostic], limit: usize) -> Vec<LspDiagnostic> {
    items
        .iter()
        .filter(|item| item.severity == 1)
        .take(limit)
        .cloned()
        .collect()
}

pub fn format_error_block(items: &[LspDiagnostic]) -> Option<String> {
    if items.is_empty() {
        return None;
    }
    let mut lines = vec!["LSP errors detected in this file, please fix:".to_string()];
    for item in items {
        lines.push(format!(
            "{}:{}:{}: {}",
            item.file_path,
            item.start_line.saturating_add(1),
            item.start_character.saturating_add(1),
            item.message
        ));
    }
    Some(lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn publish_diagnostics_replace_the_uri_store() {
        let uri = "file:///tmp/lyra-diag-store.rs";
        apply_publish_diagnostics(
            &json!({
                "uri": uri,
                "diagnostics": [{
                    "message": "missing type",
                    "severity": 1,
                    "range": {
                        "start": { "line": 2, "character": 0 },
                        "end": { "line": 2, "character": 4 }
                    }
                }]
            }),
            &HashMap::new(),
        );
        let items = for_path("/tmp/lyra-diag-store.rs");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].message, "missing type");
        apply_publish_diagnostics(&json!({ "uri": uri, "diagnostics": [] }), &HashMap::new());
        assert!(for_path("/tmp/lyra-diag-store.rs").is_empty());
    }

    #[test]
    fn error_formatter_skips_warnings_and_caps() {
        let items = (0..25)
            .map(|index| LspDiagnostic {
                file_path: "lib.rs".to_string(),
                severity: if index == 0 { 2 } else { 1 },
                message: format!("e{index}"),
                source: None,
                code: None,
                start_line: index,
                start_character: 0,
                end_line: index,
                end_character: 1,
            })
            .collect::<Vec<_>>();
        let errors = error_diagnostics(&items, 20);
        assert_eq!(errors.len(), 20);
        assert!(errors.iter().all(|item| item.severity == 1));
        let block = format_error_block(&errors).expect("block");
        assert!(block.contains("lib.rs:2:1: e1"));
    }

    #[test]
    fn rustc_probe_stderr_is_a_workspace_note_not_a_server_crash() {
        assert!(is_workspace_analysis_message(
            "rustc --print cfg failed: toolchain '1.95.0' is not installed"
        ));
        assert!(is_workspace_analysis_message(
            "error: toolchain '1.95.0' is not installed"
        ));
        assert!(!is_workspace_analysis_message("indexed 12 files in 40ms"));
        record_workspace_note(
            "/tmp/lyra-workspace-note",
            "toolchain '1.95.0' is not installed",
        );
        assert_eq!(
            workspace_analysis_note(Some("/tmp/lyra-workspace-note")).as_deref(),
            Some("toolchain '1.95.0' is not installed")
        );
        assert!(workspace_analysis_note(Some("/tmp/other-root")).is_none());
    }

    #[test]
    fn workspace_error_count_ignores_warnings() {
        let root = "/tmp/lyra-workspace-error-count";
        let path = format!("{root}/src/lib.rs");
        upsert_for_path(
            &path,
            vec![
                LspDiagnostic {
                    file_path: path.clone(),
                    severity: 1,
                    message: "err".to_string(),
                    source: None,
                    code: None,
                    start_line: 0,
                    start_character: 0,
                    end_line: 0,
                    end_character: 1,
                },
                LspDiagnostic {
                    file_path: path.clone(),
                    severity: 2,
                    message: "warn".to_string(),
                    source: None,
                    code: None,
                    start_line: 1,
                    start_character: 0,
                    end_line: 1,
                    end_character: 1,
                },
            ],
        );
        assert_eq!(workspace_error_count(root), 1);
        assert_eq!(workspace_error_count("/tmp/other-root"), 0);
    }
}
