use lopdf::Document;

use crate::error::DocumentParseError;
use crate::search::excerpt_for_match;
use crate::types::{
    DocumentFormat, DocumentProbeResult, DocumentReadRequest, DocumentReadResult,
    DocumentReadScope, DocumentSearchMatch, DocumentSearchRequest, DocumentSearchResult,
};

fn load_document(bytes: &[u8]) -> Result<Document, DocumentParseError> {
    Document::load_mem(bytes).map_err(|error| {
        let message = error.to_string();
        if message.to_ascii_lowercase().contains("password") {
            return DocumentParseError::PasswordRequired;
        }
        DocumentParseError::ParseFailed(message)
    })
}

fn sorted_page_numbers(document: &Document) -> Vec<u32> {
    let mut pages = document
        .get_pages()
        .into_iter()
        .map(|(page_no, _)| page_no)
        .collect::<Vec<_>>();
    pages.sort_unstable();
    pages
}

fn resolve_target_pages(
    request: &DocumentReadRequest,
    page_numbers: &[u32],
) -> Result<Vec<u32>, DocumentParseError> {
    let pages = match request.scope {
        DocumentReadScope::Full => page_numbers.to_vec(),
        DocumentReadScope::CurrentPage => request.current_page.into_iter().collect::<Vec<_>>(),
        DocumentReadScope::Visible => request.visible_pages.clone(),
        DocumentReadScope::PageRange => {
            let start = request
                .page_start
                .ok_or(DocumentParseError::PageOutOfRange)?;
            let end = request.page_end.unwrap_or(start);
            if start > end {
                return Err(DocumentParseError::PageOutOfRange);
            }
            (start..=end).collect::<Vec<_>>()
        }
    };

    if pages.is_empty() {
        return Err(DocumentParseError::PageOutOfRange);
    }
    if pages
        .iter()
        .any(|page| page_numbers.contains(page) == false)
    {
        return Err(DocumentParseError::PageOutOfRange);
    }
    Ok(pages)
}

fn read_full_text_for_pages(
    document: &Document,
    pages: &[u32],
) -> Result<String, DocumentParseError> {
    document
        .extract_text(pages)
        .map(|text| text.replace("\r\n", "\n").replace('\r', "\n"))
        .map_err(|error| DocumentParseError::ParseFailed(error.to_string()))
}

pub fn probe_pdf(bytes: &[u8]) -> Result<DocumentProbeResult, DocumentParseError> {
    let document = load_document(bytes)?;
    let pages = sorted_page_numbers(&document);
    let sample_text = if pages.is_empty() {
        String::new()
    } else {
        read_full_text_for_pages(&document, &[pages[0]])?
    };
    Ok(DocumentProbeResult {
        format: DocumentFormat::Pdf,
        page_count: Some(pages.len() as u32),
        encrypted: document.is_encrypted(),
        text_available: sample_text.trim().is_empty() == false,
    })
}

pub fn read_pdf_text(
    request: &DocumentReadRequest,
) -> Result<DocumentReadResult, DocumentParseError> {
    let document = load_document(&request.bytes)?;
    let page_numbers = sorted_page_numbers(&document);
    let target_pages = resolve_target_pages(request, &page_numbers)?;
    let full_text = read_full_text_for_pages(&document, &target_pages)?;
    let total_chars = full_text.chars().count();
    if full_text.trim().is_empty() {
        return Ok(DocumentReadResult {
            format: DocumentFormat::Pdf,
            page_count: Some(page_numbers.len() as u32),
            text: String::new(),
            start_char: 0,
            end_char: 0,
            total_chars: 0,
            truncated: false,
            has_more: false,
            next_cursor: None,
            extraction_method: "pdf:rust-parser".to_string(),
            empty_reason: Some("document-empty-text".to_string()),
        });
    }

    let start_char = request.cursor.unwrap_or(0).min(total_chars);
    let max_chars = request.max_chars.unwrap_or(28_000).max(1);
    let text = full_text
        .chars()
        .skip(start_char)
        .take(max_chars)
        .collect::<String>();
    let slice_chars = text.chars().count();
    let end_char = start_char + slice_chars;
    let has_more = end_char < total_chars;

    Ok(DocumentReadResult {
        format: DocumentFormat::Pdf,
        page_count: Some(page_numbers.len() as u32),
        text,
        start_char,
        end_char,
        total_chars,
        truncated: has_more,
        has_more,
        next_cursor: if has_more { Some(end_char) } else { None },
        extraction_method: "pdf:rust-parser".to_string(),
        empty_reason: None,
    })
}

pub fn search_pdf_text(
    request: &DocumentSearchRequest,
) -> Result<DocumentSearchResult, DocumentParseError> {
    let document = load_document(&request.bytes)?;
    let page_numbers = sorted_page_numbers(&document);
    let query = request.query.trim();
    if query.is_empty() {
        return Ok(DocumentSearchResult {
            format: DocumentFormat::Pdf,
            page_count: Some(page_numbers.len() as u32),
            matches: Vec::new(),
            truncated: false,
        });
    }

    let query_lower = query.to_ascii_lowercase();
    let max_matches = request.max_matches.unwrap_or(20).max(1);
    let mut matches = Vec::new();

    for page_index in page_numbers.iter().copied() {
        let page_text = read_full_text_for_pages(&document, &[page_index])?;
        let haystack = page_text.to_ascii_lowercase();
        let mut search_from = 0usize;
        while matches.len() < max_matches {
            let Some(relative) = haystack[search_from..].find(&query_lower) else {
                break;
            };
            let start = search_from + relative;
            let end = start + query_lower.len();
            matches.push(DocumentSearchMatch {
                page_index: Some(page_index),
                excerpt: excerpt_for_match(&page_text, start, end, 120),
                start_char: Some(start),
                end_char: Some(end),
            });
            search_from = end;
        }
        if matches.len() >= max_matches {
            break;
        }
    }

    Ok(DocumentSearchResult {
        format: DocumentFormat::Pdf,
        page_count: Some(page_numbers.len() as u32),
        truncated: matches.len() >= max_matches,
        matches,
    })
}
