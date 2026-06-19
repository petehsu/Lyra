use super::*;

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageSnapshot {
    pub id: String,
    pub session_id: String,
    pub url: String,
    pub title: Option<String>,
    pub text_chars: usize,
    pub element_count: usize,
    pub text_fingerprint: String,
    pub text_excerpt: String,
    pub captured_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageSnapshotDiff {
    pub changed: bool,
    pub url_changed: bool,
    pub text_chars_delta: i64,
    pub element_count_delta: i64,
    pub summary: String,
}

static PAGE_SNAPSHOTS: OnceLock<Mutex<HashMap<String, PageSnapshot>>> = OnceLock::new();

fn page_snapshots() -> &'static Mutex<HashMap<String, PageSnapshot>> {
    PAGE_SNAPSHOTS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn capture_page_snapshot(
    session_id: &str,
    output: &Value,
    label: Option<&str>,
) -> Option<PageSnapshot> {
    let url = output
        .pointer("/raw/url")
        .or_else(|| output.pointer("/url"))
        .or_else(|| output.pointer("/raw/finalUrl"))
        .or_else(|| output.pointer("/finalUrl"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let title = output
        .pointer("/raw/title")
        .or_else(|| output.pointer("/title"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let text = extract_snapshot_text(output);
    if url.is_empty() && text.is_empty() {
        return None;
    }
    let element_count = output
        .pointer("/raw/elements")
        .or_else(|| output.pointer("/elements"))
        .and_then(Value::as_array)
        .map(Vec::len)
        .or_else(|| {
            output
                .pointer("/raw/elementCount")
                .or_else(|| output.pointer("/elementCount"))
                .and_then(Value::as_u64)
                .map(|count| count as usize)
        })
        .unwrap_or(0);
    let text_chars = text.chars().count();
    let snapshot = PageSnapshot {
        id: format!("page-snap-{}-{}", session_id, Uuid::new_v4().simple()),
        session_id: session_id.to_string(),
        url: url.to_string(),
        title,
        text_chars,
        element_count,
        text_fingerprint: fingerprint_text(&text),
        text_excerpt: truncate_page_snapshot_text(&text, 500),
        captured_at: Utc::now().to_rfc3339(),
    };
    if let Ok(mut store) = page_snapshots().lock() {
        store.insert(snapshot.id.clone(), snapshot.clone());
        let prefix = format!("page-snap-{session_id}-");
        let mut ids = store
            .keys()
            .filter(|id| id.starts_with(&prefix))
            .cloned()
            .collect::<Vec<_>>();
        ids.sort();
        while ids.len() > 40 {
            if let Some(oldest) = ids.first().cloned() {
                store.remove(&oldest);
                ids.remove(0);
            } else {
                break;
            }
        }
    }
    if label.is_some() {
        // label reserved for future tagged snapshots
    }
    Some(snapshot)
}

pub(crate) fn diff_page_snapshots(
    baseline_id: &str,
    current: &PageSnapshot,
) -> Option<PageSnapshotDiff> {
    let baseline = page_snapshots().lock().ok()?.get(baseline_id).cloned()?;
    let url_changed = baseline.url != current.url;
    let text_chars_delta = current.text_chars as i64 - baseline.text_chars as i64;
    let element_count_delta = current.element_count as i64 - baseline.element_count as i64;
    let fingerprint_changed = baseline.text_fingerprint != current.text_fingerprint;
    let changed = url_changed || fingerprint_changed || element_count_delta != 0;
    let summary = if !changed {
        "No meaningful page change detected since the baseline snapshot.".to_string()
    } else {
        format!(
            "Page changed: urlChanged={url_changed}, textCharsDelta={text_chars_delta}, elementCountDelta={element_count_delta}"
        )
    };
    Some(PageSnapshotDiff {
        changed,
        url_changed,
        text_chars_delta,
        element_count_delta,
        summary,
    })
}

fn extract_snapshot_text(output: &Value) -> String {
    for pointer in [
        "/raw/compactText",
        "/compactText",
        "/raw/text",
        "/text",
        "/raw/markdown",
        "/markdown",
        "/content",
    ] {
        if let Some(text) = output.pointer(pointer).and_then(Value::as_str) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    String::new()
}

fn truncate_page_snapshot_text(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut output = text.chars().take(max_chars).collect::<String>();
    output.push_str("\n[truncated]");
    output
}

fn fingerprint_text(text: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}
