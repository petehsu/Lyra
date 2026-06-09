use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use lyra_docs_core::{
    probe_document, read_document_text, search_document_text, DocumentProbeRequest,
    DocumentReadRequest, DocumentSearchRequest,
};
use napi::{Error, Result, Status};
use napi_derive::napi;
use serde::{de::DeserializeOwned, Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsonProbeRequest {
    bytes_base64: String,
    mime_hint: Option<String>,
    url_hint: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsonReadRequest {
    bytes_base64: String,
    mime_hint: Option<String>,
    url_hint: Option<String>,
    scope: lyra_docs_core::DocumentReadScope,
    page_start: Option<u32>,
    page_end: Option<u32>,
    visible_pages: Option<Vec<u32>>,
    current_page: Option<u32>,
    max_chars: Option<usize>,
    cursor: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsonSearchRequest {
    bytes_base64: String,
    mime_hint: Option<String>,
    url_hint: Option<String>,
    query: String,
    max_matches: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsonAgentReadRequest {
    bytes_base64: String,
    mime_hint: Option<String>,
    url_hint: Option<String>,
    preset: Option<String>,
    format: Option<String>,
    mode: Option<String>,
    query_focus: Option<String>,
    user_task: Option<String>,
    max_chars: Option<usize>,
    max_tokens: Option<usize>,
    include_raw: Option<bool>,
    chunking: Option<bool>,
}

fn parse_json<T: DeserializeOwned>(input: &str) -> Result<T> {
    serde_json::from_str(input)
        .map_err(|error| Error::new(Status::InvalidArg, format!("invalid JSON payload: {error}")))
}

fn stringify_json<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("failed to serialize JSON payload: {error}"),
        )
    })
}

fn docs_error(code: &str, message: impl Into<String>) -> Error {
    Error::new(
        Status::GenericFailure,
        format!("DOCS_ERROR::{code}::{}", message.into()),
    )
}

fn decode_bytes(input: &str) -> Result<Vec<u8>> {
    BASE64_STANDARD.decode(input.as_bytes()).map_err(|error| {
        Error::new(
            Status::InvalidArg,
            format!("invalid bytesBase64 payload: {error}"),
        )
    })
}

#[napi]
pub fn probe_document_json(input: String) -> Result<String> {
    let request: JsonProbeRequest = parse_json(&input)?;
    let request = DocumentProbeRequest {
        bytes: decode_bytes(&request.bytes_base64)?,
        mime_hint: request.mime_hint,
        url_hint: request.url_hint,
    };
    let result =
        probe_document(request).map_err(|error| docs_error(error.code(), error.to_string()))?;
    stringify_json(&result)
}

#[napi]
pub fn read_document_text_json(input: String) -> Result<String> {
    let request: JsonReadRequest = parse_json(&input)?;
    let request = DocumentReadRequest {
        bytes: decode_bytes(&request.bytes_base64)?,
        mime_hint: request.mime_hint,
        url_hint: request.url_hint,
        scope: request.scope,
        page_start: request.page_start,
        page_end: request.page_end,
        visible_pages: request.visible_pages.unwrap_or_default(),
        current_page: request.current_page,
        max_chars: request.max_chars,
        cursor: request.cursor,
    };
    let result =
        read_document_text(request).map_err(|error| docs_error(error.code(), error.to_string()))?;
    stringify_json(&result)
}

#[napi]
pub fn search_document_text_json(input: String) -> Result<String> {
    let request: JsonSearchRequest = parse_json(&input)?;
    let request = DocumentSearchRequest {
        bytes: decode_bytes(&request.bytes_base64)?,
        mime_hint: request.mime_hint,
        url_hint: request.url_hint,
        query: request.query,
        max_matches: request.max_matches,
    };
    let result = search_document_text(request)
        .map_err(|error| docs_error(error.code(), error.to_string()))?;
    stringify_json(&result)
}

#[napi]
pub fn read_agent_document_json(input: String) -> Result<String> {
    let request: JsonAgentReadRequest = parse_json(&input)?;
    let mut options = lyra_agent_reader::ReaderOptions {
        preset: preset_from_opt(request.preset.as_deref()),
        output_format: output_format_from_opt(request.format.as_deref()),
        mode: mode_from_opt(request.mode.as_deref()),
        query_focus: request.query_focus,
        user_task: request.user_task,
        max_chars: request.max_chars,
        max_tokens: request.max_tokens,
        include_raw: request.include_raw.unwrap_or(false),
        trusted_local: true,
        max_bytes: Some(64 * 1024 * 1024),
        ..lyra_agent_reader::ReaderOptions::default()
    };
    if options.query_focus.is_some() || options.user_task.is_some() {
        options.content_filter = lyra_agent_reader::ContentFilterMode::Hybrid;
    }
    if request.chunking.unwrap_or(true) {
        options.chunking.mode = lyra_agent_reader::ChunkingMode::Block;
    }
    options.apply_preset_defaults();
    let reader_request = lyra_agent_reader::ReaderRequest {
        input: lyra_agent_reader::ReaderInput::Bytes {
            bytes: decode_bytes(&request.bytes_base64)?,
            mime: request.mime_hint,
            base_url: request.url_hint,
        },
        options,
    };
    let no_fetch = NoFetchProvider;
    let result = lyra_agent_reader::read(&reader_request, &no_fetch)
        .map_err(|error| docs_error("agent_reader_failed", error.to_string()))?;
    stringify_json(&result)
}

struct NoFetchProvider;

impl lyra_agent_reader::FetchProvider for NoFetchProvider {
    fn fetch(
        &self,
        request: &lyra_agent_reader::FetchRequest<'_>,
    ) -> std::result::Result<lyra_agent_reader::FetchResponse, lyra_agent_reader::ReaderError> {
        Err(lyra_agent_reader::ReaderError::Fetch {
            message: "docs NAPI does not perform network fetches".to_string(),
            final_url: Some(request.url.to_string()),
            status: None,
        })
    }
}

fn preset_from_opt(value: Option<&str>) -> lyra_agent_reader::ReaderPreset {
    match value {
        Some("research") => lyra_agent_reader::ReaderPreset::Research,
        Some("index") => lyra_agent_reader::ReaderPreset::Index,
        Some("reader") => lyra_agent_reader::ReaderPreset::Reader,
        Some("raw") => lyra_agent_reader::ReaderPreset::Raw,
        _ => lyra_agent_reader::ReaderPreset::Agent,
    }
}

fn output_format_from_opt(value: Option<&str>) -> lyra_agent_reader::ReaderOutputFormat {
    match value {
        Some("text") => lyra_agent_reader::ReaderOutputFormat::Text,
        Some("json") => lyra_agent_reader::ReaderOutputFormat::Json,
        Some("chunks") => lyra_agent_reader::ReaderOutputFormat::Chunks,
        Some("frontmatter+markdown") | Some("frontmatterMarkdown") => {
            lyra_agent_reader::ReaderOutputFormat::FrontmatterMarkdown
        }
        _ => lyra_agent_reader::ReaderOutputFormat::Markdown,
    }
}

fn mode_from_opt(value: Option<&str>) -> lyra_agent_reader::ExtractionMode {
    match value {
        Some("full") => lyra_agent_reader::ExtractionMode::Full,
        Some("text") => lyra_agent_reader::ExtractionMode::Text,
        Some("raw") => lyra_agent_reader::ExtractionMode::Raw,
        _ => lyra_agent_reader::ExtractionMode::Main,
    }
}
