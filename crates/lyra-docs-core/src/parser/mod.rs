mod pdf;

use crate::error::DocumentParseError;
use crate::types::{
    DocumentFormat, DocumentProbeRequest, DocumentProbeResult, DocumentReadRequest,
    DocumentReadResult, DocumentSearchRequest, DocumentSearchResult,
};

pub use pdf::{probe_pdf, read_pdf_text, search_pdf_text};

fn infer_format(mime_hint: Option<&str>, url_hint: Option<&str>, bytes: &[u8]) -> DocumentFormat {
    let lower_mime = mime_hint.unwrap_or_default().trim().to_ascii_lowercase();
    if lower_mime.contains("application/pdf") {
        return DocumentFormat::Pdf;
    }
    let lower_url = url_hint.unwrap_or_default().trim().to_ascii_lowercase();
    if lower_url.ends_with(".pdf") || lower_url.contains(".pdf?") {
        return DocumentFormat::Pdf;
    }
    if bytes.starts_with(b"%PDF-") {
        return DocumentFormat::Pdf;
    }
    DocumentFormat::Unknown
}

pub fn probe_document(
    request: DocumentProbeRequest,
) -> Result<DocumentProbeResult, DocumentParseError> {
    match infer_format(
        request.mime_hint.as_deref(),
        request.url_hint.as_deref(),
        &request.bytes,
    ) {
        DocumentFormat::Pdf => probe_pdf(&request.bytes),
        DocumentFormat::Unknown => Ok(DocumentProbeResult {
            format: DocumentFormat::Unknown,
            page_count: None,
            encrypted: false,
            text_available: false,
        }),
    }
}

pub fn read_document_text(
    request: DocumentReadRequest,
) -> Result<DocumentReadResult, DocumentParseError> {
    match infer_format(
        request.mime_hint.as_deref(),
        request.url_hint.as_deref(),
        &request.bytes,
    ) {
        DocumentFormat::Pdf => read_pdf_text(&request),
        DocumentFormat::Unknown => Err(DocumentParseError::UnsupportedFormat),
    }
}

pub fn search_document_text(
    request: DocumentSearchRequest,
) -> Result<DocumentSearchResult, DocumentParseError> {
    match infer_format(
        request.mime_hint.as_deref(),
        request.url_hint.as_deref(),
        &request.bytes,
    ) {
        DocumentFormat::Pdf => search_pdf_text(&request),
        DocumentFormat::Unknown => Err(DocumentParseError::UnsupportedFormat),
    }
}
