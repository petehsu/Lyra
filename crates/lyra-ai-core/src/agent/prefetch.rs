use crate::provider::types::AgentToolInvocation;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Cached prefetch result keyed by a composite key.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PrefetchEntry {
    pub data: Value,
    pub timestamp_ms: u64,
}

/// Shared cache for prefetch results.
#[derive(Default, Clone)]
pub struct PrefetchCache {
    inner: Arc<Mutex<HashMap<String, PrefetchEntry>>>,
}

impl PrefetchCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Store a prefetch result.
    pub fn store(&self, key: &str, data: Value) {
        if let Ok(mut cache) = self.inner.lock() {
            cache.insert(
                key.to_string(),
                PrefetchEntry {
                    data,
                    timestamp_ms: now_ms(),
                },
            );
        }
    }

    /// Retrieve a prefetch result if available and not stale.
    pub fn get(&self, key: &str, max_age_ms: u64) -> Option<Value> {
        let Ok(cache) = self.inner.lock() else {
            return None;
        };
        let entry = cache.get(key)?;
        let now = now_ms();
        if now.saturating_sub(entry.timestamp_ms) > max_age_ms {
            return None;
        }
        Some(entry.data.clone())
    }

    /// Clear all stale entries older than max_age_ms.
    pub fn purge_stale(&self, max_age_ms: u64) {
        let Ok(mut cache) = self.inner.lock() else {
            return;
        };
        let now = now_ms();
        cache.retain(|_, entry| now.saturating_sub(entry.timestamp_ms) <= max_age_ms);
    }

    /// Clear all entries (called after turn completion or compaction).
    pub fn clear(&self) {
        if let Ok(mut cache) = self.inner.lock() {
            cache.clear();
        }
    }

    /// Export cache entries for checkpoint persistence.
    pub fn to_map(&self) -> HashMap<String, PrefetchEntry> {
        let Ok(cache) = self.inner.lock() else {
            return HashMap::new();
        };
        cache.clone()
    }

    /// Restore cache entries from checkpoint.
    pub fn restore_from_map(&self, map: HashMap<String, PrefetchEntry>) {
        if let Ok(mut cache) = self.inner.lock() {
            *cache = map;
        }
    }
}

/// Schedule background prefetch tasks based on detected tool calls.
/// This is called during API streaming when tool_calls become visible.
/// All prefetch operations are fire-and-forget — failures are silently ignored.
pub fn schedule_prefetch(
    tool_calls: &[AgentToolInvocation],
    project_root: Option<&str>,
    cache: &PrefetchCache,
) {
    let project_root_owned = project_root.map(String::from);
    for invocation in tool_calls {
        let key = format!("{}_{}", invocation.name, invocation.id);
        let cache_clone = cache.clone();
        let input = invocation.input.clone();
        let tool_name = invocation.name.clone();
        let project_root = project_root_owned.clone();

        // Spawn background thread for each prefetch task
        std::thread::spawn(move || {
            let result = match tool_name.as_str() {
                // Prefetch file metadata for read/write operations
                "filesystem.read"
                | "filesystem.read_range"
                | "filesystem.write"
                | "filesystem.edit"
                | "filesystem.multi_edit" => {
                    prefetch_file_metadata(&input, project_root.as_deref())
                }
                // Prefetch directory listing for list operations
                "filesystem.list" => prefetch_directory_listing(&input, project_root.as_deref()),
                _ => None,
            };

            if let Some(data) = result {
                cache_clone.store(&key, data);
            }
        });
    }
}

/// Consume a prefetch result for a specific tool call.
pub fn consume_prefetch(
    tool_name: &str,
    tool_call_id: &str,
    cache: &PrefetchCache,
    max_age_ms: u64,
) -> Option<Value> {
    let key = format!("{tool_name}_{tool_call_id}");
    cache.get(&key, max_age_ms)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ---- Prefetch Implementations ----

/// Prefetch file metadata (existence, size, mtime) before a read/write operation.
fn prefetch_file_metadata(input: &Value, _project_root: Option<&str>) -> Option<Value> {
    let path = input.get("path").and_then(|v| v.as_str())?;
    let meta = std::fs::metadata(path).ok()?;
    Some(serde_json::json!({
        "path": path,
        "exists": true,
        "len": meta.len(),
        "modified": meta.modified().ok().map(|t|
            t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).ok()
        ).flatten(),
    }))
}

/// Prefetch directory listing before a list operation.
fn prefetch_directory_listing(input: &Value, _project_root: Option<&str>) -> Option<Value> {
    let path = input.get("path").and_then(|v| v.as_str())?;
    let entries = std::fs::read_dir(path).ok()?;
    let mut file_names = Vec::new();
    for entry in entries.flatten() {
        if let Some(name) = entry.file_name().to_str() {
            file_names.push(name.to_string());
        }
    }
    Some(serde_json::json!({
        "path": path,
        "entries": file_names,
    }))
}
