use serde::Serialize;

/// Index state for a project, reported to the agent and UI.
///
/// Serialized with `tag = "state"` so the JSON shape is:
/// `{ "state": "ready", "fileCount": 123, "symbolCount": 456 }` — matches
/// the `projectContext.status` shape the prompt template expects.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum IndexStatus {
    Idle,
    Indexing { progress: f64 },
    Ready { file_count: u64, symbol_count: u64 },
    Failed { error: String },
}

impl IndexStatus {
    pub fn idle() -> Self {
        Self::Idle
    }
}