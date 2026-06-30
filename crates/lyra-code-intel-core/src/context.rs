use serde::Serialize;

use crate::status::IndexStatus;

/// Project-level overview generated from the code graph.
/// Injected into `runtime_context.projectContext` in the prompt (Phase 4).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectContext {
    pub status: IndexStatus,
    pub file_count: u64,
    pub symbol_count: u64,
    /// Symbols that look like entry points: `main`, `main()`, route handlers, etc.
    pub entry_points: Vec<String>,
    /// Distinct top-level directories under the project root.
    pub key_modules: Vec<String>,
    /// Programming languages detected in the graph.
    pub languages: Vec<String>,
    /// Framework resolver summary inferred from indexed paths and languages.
    pub frameworks: Vec<String>,
    /// Cross-language bridge families inferred for prompt/tool guidance.
    pub bridges: Vec<String>,
    /// Compact architecture hint for prompt injection.
    pub architecture: Option<String>,
}