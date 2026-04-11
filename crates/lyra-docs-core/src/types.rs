use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DocumentFormat {
    Pdf,
    Unknown,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentProbeRequest {
    pub bytes: Vec<u8>,
    pub mime_hint: Option<String>,
    pub url_hint: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentProbeResult {
    pub format: DocumentFormat,
    pub page_count: Option<u32>,
    pub encrypted: bool,
    pub text_available: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DocumentReadScope {
    Full,
    CurrentPage,
    Visible,
    PageRange,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentReadRequest {
    pub bytes: Vec<u8>,
    pub mime_hint: Option<String>,
    pub url_hint: Option<String>,
    pub scope: DocumentReadScope,
    pub page_start: Option<u32>,
    pub page_end: Option<u32>,
    #[serde(default)]
    pub visible_pages: Vec<u32>,
    pub current_page: Option<u32>,
    pub max_chars: Option<usize>,
    pub cursor: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentReadResult {
    pub format: DocumentFormat,
    pub page_count: Option<u32>,
    pub text: String,
    pub start_char: usize,
    pub end_char: usize,
    pub total_chars: usize,
    pub truncated: bool,
    pub has_more: bool,
    pub next_cursor: Option<usize>,
    pub extraction_method: String,
    pub empty_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSearchRequest {
    pub bytes: Vec<u8>,
    pub mime_hint: Option<String>,
    pub url_hint: Option<String>,
    pub query: String,
    pub max_matches: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSearchMatch {
    pub page_index: Option<u32>,
    pub excerpt: String,
    pub start_char: Option<usize>,
    pub end_char: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSearchResult {
    pub format: DocumentFormat,
    pub page_count: Option<u32>,
    pub matches: Vec<DocumentSearchMatch>,
    pub truncated: bool,
}
