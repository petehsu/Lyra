use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

/// Tracks the state of files that have been read by the agent.
/// Prevents editing conflicts and avoids re-reading unchanged files.
///
/// Ported from Claude Code's `FileStateCache` — simplified for Lyra's Rust architecture.
///
/// Core idea: when the agent reads a file, we record its content + timestamp.
/// Before editing, we verify the file hasn't been externally modified.
/// If unchanged, we can return a cheap stub instead of re-reading.
#[derive(Default)]
pub struct FileStateCache {
    entries: HashMap<String, FileStateEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FileStateEntry {
    /// Content that was read (None if this was a partial read with offset/limit).
    pub content: Option<String>,
    /// Monotonic timestamp (ms) when the file was last read.
    pub read_at_ms: u64,
    /// Disk modification time (ms) observed at read time.
    pub disk_mtime_ms: u64,
    /// If this was a partial read (offset + limit), the range.
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

impl FileStateCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record that a file was read with its full content.
    pub fn record_read(&mut self, path: &str, content: &str) {
        let now = current_time_ms();
        let mtime = file_mtime_ms(path).unwrap_or(now);
        self.entries.insert(
            normalize_path(path),
            FileStateEntry {
                content: Some(content.to_string()),
                read_at_ms: now,
                disk_mtime_ms: mtime,
                offset: None,
                limit: None,
            },
        );
    }

    /// Record that a file was partially read (offset + limit).
    pub fn record_partial_read(&mut self, path: &str, offset: usize, limit: usize) {
        let now = current_time_ms();
        let mtime = file_mtime_ms(path).unwrap_or(now);
        self.entries.insert(
            normalize_path(path),
            FileStateEntry {
                content: None, // We don't have the full content
                read_at_ms: now,
                disk_mtime_ms: mtime,
                offset: Some(offset),
                limit: Some(limit),
            },
        );
    }

    /// Check if a file has been read before.
    pub fn was_read(&self, path: &str) -> bool {
        self.entries.contains_key(&normalize_path(path))
    }

    /// Check if a file has been externally modified since it was last read.
    ///
    /// Returns `true` if the file appears unchanged (safe to edit).
    /// Returns `false` if the file was modified or was never read.
    pub fn is_unchanged(&self, path: &str) -> bool {
        let key = normalize_path(path);
        let Some(entry) = self.entries.get(&key) else {
            return false;
        };

        // Partial reads can't be safely compared — assume changed
        if entry.offset.is_some() {
            return false;
        }

        let Some(current_mtime) = file_mtime_ms(path) else {
            return false;
        };

        // Same mtime → definitely unchanged
        if current_mtime == entry.disk_mtime_ms {
            return true;
        }

        // mtime changed but content might be the same (e.g. cloud sync touches mtime)
        // Read and compare — this is the expensive path
        if let Some(full_content) = &entry.content {
            if let Ok(disk_content) = fs::read_to_string(path) {
                return disk_content == *full_content;
            }
        }

        false
    }

    /// Get the cached content if available and unchanged.
    /// Returns `None` if not cached, partial read, or externally modified.
    pub fn get_cached_content(&self, path: &str) -> Option<&str> {
        let key = normalize_path(path);
        let entry = self.entries.get(&key)?;

        if !self.is_unchanged(path) {
            return None;
        }

        entry.content.as_deref()
    }

    /// Clear all cached entries. Called after compaction.
    pub fn clear(&mut self) {
        self.entries.clear();
    }

    /// Get the number of cached entries.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Check if the cache is empty.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Convert to a map for serialization (used by compact to restore file state).
    pub fn to_map(&self) -> HashMap<String, FileStateEntry> {
        self.entries.clone()
    }

    /// Restore from a serialized map (used after compact to restore known-good state).
    pub fn from_map(map: HashMap<String, FileStateEntry>) -> Self {
        Self { entries: map }
    }
}

fn normalize_path(path: &str) -> String {
    // Normalize path separators and remove trailing slashes
    let normalized = path.replace('\\', "/");
    normalized.trim_end_matches('/').to_string()
}

fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn file_mtime_ms(path: &str) -> Option<u64> {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64)
}

/// Stub returned when a file is unchanged since last read.
/// Saves tokens by avoiding re-injecting known content.
pub const FILE_UNCHANGED_STUB: &str =
    "File unchanged since last read — no need to re-read unless you expect external modifications.";
