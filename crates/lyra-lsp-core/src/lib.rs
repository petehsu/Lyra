//! Small synchronous facade for the language-server runtime.
//!
//! Process lifecycle and JSON-RPC transport live in `runtime`; document and
//! position request handling lives in `requests`. Keeping the N-API-facing
//! contracts here makes the public surface easy to audit.

mod requests;
mod runtime;

use std::sync::Arc;

#[cfg(feature = "node-api")]
use napi::bindgen_prelude::*;
#[cfg(feature = "node-api")]
use napi_derive::napi;
use serde::Serialize;

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
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspLocation {
    pub file_path: String,
    pub start_line: u32,
    pub start_character: u32,
    pub end_line: u32,
    pub end_character: u32,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspHoverResult {
    pub contents: String,
    pub start_line: Option<u32>,
    pub start_character: Option<u32>,
    pub end_line: Option<u32>,
    pub end_character: Option<u32>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
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
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspCompletionResult {
    pub items: Vec<LspCompletionItem>,
    pub is_incomplete: bool,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspRuntimeEvent {
    pub kind: String,
    pub session_id: Option<String>,
    pub file_path: Option<String>,
    pub language_id: Option<String>,
    pub project_root: Option<String>,
    pub status: Option<String>,
    pub message: Option<String>,
}

pub fn register_rust_event_callback(callback: RustEventCallback) {
    runtime::register_event_callback(callback);
}

pub fn clear_rust_event_callback() {
    runtime::clear_event_callback();
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
pub fn shutdown() -> Result<()> {
    runtime::shutdown()
}
