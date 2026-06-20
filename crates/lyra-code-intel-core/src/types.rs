use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const INDEX_VERSION: u32 = 2;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CodeIndexState {
    Idle,
    Building,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeIndexStatus {
    pub state: CodeIndexState,
    pub indexed_files: u64,
    pub indexed_dirs: u64,
    pub last_built_at: Option<String>,
    pub progress: Option<f64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeIndexRebuildResponse {
    pub status: CodeIndexStatus,
    pub roots: Vec<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone)]
pub struct CodeIndexRebuildParams {
    pub roots: Vec<PathBuf>,
    pub include_hidden: bool,
    pub force: bool,
}

#[derive(Debug, Clone)]
pub struct CodeSearchTextParams {
    pub query: String,
    pub roots: Vec<PathBuf>,
    pub include_hidden: bool,
    pub glob: Option<String>,
    pub limit: usize,
    pub case_sensitive: bool,
    pub regex: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeSearchTextMatch {
    pub path: String,
    pub relative_path: String,
    pub line: u32,
    pub excerpt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeSearchTextResponse {
    pub query: String,
    pub root_path: String,
    pub case_sensitive: bool,
    pub truncated: bool,
    pub elapsed_ms: u64,
    pub used_index: bool,
    pub matches: Vec<CodeSearchTextMatch>,
}

#[derive(Debug, Clone)]
pub struct CodeSearchSymbolParams {
    pub query: String,
    pub roots: Vec<PathBuf>,
    pub include_hidden: bool,
    pub limit: usize,
    pub kind: Option<String>,
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeSearchSymbolMatch {
    pub name: String,
    pub kind: String,
    pub file_path: String,
    pub relative_path: String,
    pub line: u32,
    pub column: u32,
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeSearchSymbolResponse {
    pub query: String,
    pub root_path: String,
    pub truncated: bool,
    pub elapsed_ms: u64,
    pub used_index: bool,
    pub symbols: Vec<CodeSearchSymbolMatch>,
}

#[derive(Debug, Clone)]
pub struct CodeGraphExpandParams {
    pub symbol: String,
    pub roots: Vec<PathBuf>,
    pub include_hidden: bool,
    pub depth: u8,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeGraphNode {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub file_path: String,
    pub line: u32,
    pub column: u32,
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeGraphEdge {
    pub from: String,
    pub to: String,
    pub relation: String,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeGraphMeta {
    pub truncated: bool,
    pub elapsed_ms: u64,
    pub semantic_coverage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeGraphExpandResponse {
    pub symbol: String,
    pub nodes: Vec<CodeGraphNode>,
    pub edges: Vec<CodeGraphEdge>,
    pub meta: CodeGraphMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedSymbol {
    pub name: String,
    pub kind: String,
    pub line: u32,
    pub column: u32,
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedFile {
    pub path: String,
    pub relative_path: String,
    pub file_name: String,
    pub extension: Option<String>,
    pub modified_at: u64,
    pub size_bytes: u64,
    pub symbols: Vec<IndexedSymbol>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexSnapshot {
    pub version: u32,
    pub roots: Vec<String>,
    pub include_hidden: bool,
    pub indexed_at: u64,
    pub indexed_dirs: u64,
    pub truncated: bool,
    pub files: Vec<IndexedFile>,
}
