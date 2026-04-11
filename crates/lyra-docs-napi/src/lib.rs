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
