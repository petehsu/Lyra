//! Language-server runtime shared by the editor and Agent.

mod acquire;
mod catalog;
mod diagnostics;
mod events;
mod requests;
mod runtime;
mod uri;

use std::sync::Arc;

#[cfg(feature = "node-api")]
use napi::bindgen_prelude::*;
#[cfg(feature = "node-api")]
use napi_derive::napi;
use serde::{Deserialize, Serialize};

#[cfg(not(feature = "node-api"))]
type Result<T> = std::result::Result<T, Error>;

#[cfg(not(feature = "node-api"))]
#[derive(Debug, Clone)]
pub struct Error {
    reason: String,
}

#[cfg(not(feature = "node-api"))]
#[derive(Debug, Clone, Copy)]
pub enum Status {
    InvalidArg,
}

#[cfg(not(feature = "node-api"))]
impl Error {
    pub fn new(_status: Status, reason: String) -> Self {
        Self { reason }
    }
}

#[cfg(not(feature = "node-api"))]
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.reason)
    }
}

#[cfg(not(feature = "node-api"))]
impl std::error::Error for Error {}

pub type RustEventCallback = Arc<dyn Fn(String) + Send + Sync + 'static>;

#[cfg_attr(feature = "node-api", napi(object))]
pub struct LspDocumentRequest {
    pub session_id: String,
    pub file_path: String,
    pub language_id: String,
    pub content: String,
    pub version: i32,
    pub project_root: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct LspCompletionRequest {
    pub session_id: String,
    pub file_path: String,
    pub language_id: String,
    pub line: u32,
    pub column: u32,
    pub version: i32,
    pub project_root: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct LspPositionRequest {
    pub file_path: String,
    pub language_id: String,
    pub line: u32,
    pub column: u32,
    pub project_root: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspLocation {
    pub file_path: String,
    pub start_line: u32,
    pub start_character: u32,
    pub end_line: u32,
    pub end_character: u32,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspHoverResult {
    pub contents: String,
    pub start_line: Option<u32>,
    pub start_character: Option<u32>,
    pub end_line: Option<u32>,
    pub end_character: Option<u32>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspCompletionItem {
    pub label: String,
    pub insert_text: Option<String>,
    pub detail: Option<String>,
    pub documentation: Option<String>,
    pub kind: Option<u32>,
    pub sort_text: Option<String>,
    pub filter_text: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspCompletionResult {
    pub items: Vec<LspCompletionItem>,
    pub is_incomplete: bool,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspDiagnostic {
    pub file_path: String,
    pub severity: u32,
    pub message: String,
    pub source: Option<String>,
    pub code: Option<String>,
    pub start_line: u32,
    pub start_character: u32,
    pub end_line: u32,
    pub end_character: u32,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspSymbol {
    pub name: String,
    pub kind: u32,
    pub file_path: String,
    pub start_line: u32,
    pub start_character: u32,
    pub end_line: u32,
    pub end_character: u32,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspRuntimeEvent {
    pub kind: String,
    pub session_id: Option<String>,
    pub file_path: Option<String>,
    pub language_id: Option<String>,
    pub project_root: Option<String>,
    pub status: Option<String>,
    pub message: Option<String>,
    pub server_id: Option<String>,
    pub diagnostics: Option<Vec<LspDiagnostic>>,
    pub acquire_id: Option<String>,
    pub received_bytes: Option<f64>,
    pub total_bytes: Option<f64>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct LspDiagnosticsRequest {
    pub file_path: Option<String>,
    pub project_root: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct LspEnsureRequest {
    pub project_root: String,
    pub language_id: Option<String>,
}

pub fn register_rust_event_callback(callback: RustEventCallback) {
    events::register_event_callback(callback);
}

pub fn clear_rust_event_callback() {
    events::clear_event_callback();
}

#[cfg_attr(feature = "node-api", napi)]
pub fn open_document(request: LspDocumentRequest) -> Result<()> {
    requests::open_document(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn change_document(request: LspDocumentRequest) -> Result<()> {
    requests::change_document(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn save_document(request: LspDocumentRequest) -> Result<()> {
    requests::save_document(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn close_document(request: LspDocumentRequest) -> Result<()> {
    requests::close_document(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn completion(request: LspCompletionRequest) -> Result<LspCompletionResult> {
    requests::completion(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn goto_definition(request: LspPositionRequest) -> Result<Vec<LspLocation>> {
    requests::goto_definition(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn find_references(request: LspPositionRequest) -> Result<Vec<LspLocation>> {
    requests::find_references(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn hover(request: LspPositionRequest) -> Result<Option<LspHoverResult>> {
    requests::hover(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn document_symbols(request: LspPositionRequest) -> Result<Vec<LspSymbol>> {
    requests::document_symbols(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn diagnostics(request: LspDiagnosticsRequest) -> Result<Vec<LspDiagnostic>> {
    if let Some(path) = request
        .file_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        Ok(diagnostics::for_path(path))
    } else {
        Ok(diagnostics::for_workspace(request.project_root.as_deref()))
    }
}

#[cfg_attr(feature = "node-api", napi)]
pub fn ensure_project_servers(request: LspEnsureRequest) -> Result<Vec<String>> {
    if let Some(language_id) = request
        .language_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        acquire::ensure_language(language_id, Some(request.project_root.as_str()))
            .map(|id| vec![id])
            .map_err(uri::to_error)
    } else {
        Ok(acquire::ensure_project_servers(&request.project_root))
    }
}

#[cfg_attr(feature = "node-api", napi)]
pub fn shutdown() -> Result<()> {
    runtime::shutdown()
}

pub fn language_id_for_path(path: &str) -> Option<&'static str> {
    catalog::language_id_for_path(path)
}

pub fn language_supported(language_id: &str) -> bool {
    catalog::supported_language(language_id)
}

pub fn upsert_diagnostics(file_path: &str, items: Vec<LspDiagnostic>) -> u64 {
    diagnostics::upsert_for_path(file_path, items)
}

pub fn wait_for_diagnostics(
    file_path: &str,
    min_generation: u64,
    timeout: std::time::Duration,
) -> Vec<LspDiagnostic> {
    diagnostics::wait_for_update(file_path, min_generation, timeout)
}

pub fn diagnostics_generation(file_path: &str) -> u64 {
    diagnostics::generation_for_path(file_path)
}

pub fn error_diagnostics(items: &[LspDiagnostic], limit: usize) -> Vec<LspDiagnostic> {
    diagnostics::error_diagnostics(items, limit)
}

pub fn workspace_error_count(project_root: &str) -> usize {
    diagnostics::workspace_error_count(project_root)
}

pub fn format_error_block(items: &[LspDiagnostic]) -> Option<String> {
    diagnostics::format_error_block(items)
}

pub fn workspace_analysis_note(project_root: Option<&str>) -> Option<String> {
    diagnostics::workspace_analysis_note(project_root)
}

pub fn ensure_language_binary(
    language_id: &str,
    project_root: Option<&str>,
) -> std::result::Result<String, String> {
    acquire::ensure_language(language_id, project_root)
}

pub fn warmup_project_servers(project_root: &str) -> Vec<String> {
    runtime::warmup_primary_servers(project_root)
}

pub fn refresh_cached_servers() {
    acquire::refresh_cached_servers()
}
