//! Parse bytes/string into a lenient HTML DOM.
//!
//! Charset handling for Milestone A: UTF-8 plus any charset declared in the
//! Content-Type or a `<meta charset>` is decoded best-effort. Non-UTF-8 bodies
//! are decoded lossily and a [`WarningCode::NonUtf8Charset`] is surfaced.

use scraper::Html;

use crate::types::{ReaderWarning, WarningCode};

/// Result of parsing: the DOM plus any warnings raised while decoding.
pub struct ParsedHtml {
    /// The parsed document.
    pub document: Html,
    /// Warnings raised during decode/parse.
    pub warnings: Vec<ReaderWarning>,
}

/// Parse already-decoded HTML text.
pub fn parse_str(html: &str) -> ParsedHtml {
    let document = Html::parse_document(html);
    let mut warnings = Vec::new();
    if document.errors.iter().any(|error| !error.is_empty()) {
        warnings.push(ReaderWarning {
            code: WarningCode::MalformedHtml,
            message: "HTML contained markup errors; parsed leniently".to_string(),
        });
    }
    ParsedHtml { document, warnings }
}

/// Parse HTML from raw bytes, honouring a declared charset where possible.
pub fn parse_bytes(bytes: &[u8], content_type: Option<&str>) -> ParsedHtml {
    let mut warnings = Vec::new();
    let decoded = match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => {
            // Best-effort: lossy UTF-8. A real charset transcoder is deferred to
            // a later milestone (encoding_rs is available in the workspace).
            warnings.push(ReaderWarning {
                code: WarningCode::NonUtf8Charset,
                message: "body was not valid UTF-8; decoded lossily".to_string(),
            });
            String::from_utf8_lossy(bytes).into_owned()
        }
    };
    // `content_type` is currently advisory only; declared charsets other than
    // UTF-8 are not transcoded in Milestone A.
    let _ = content_type;
    let mut parsed = parse_str(&decoded);
    parsed.warnings.splice(0..0, warnings);
    parsed
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn parses_simple_document() {
        let parsed = parse_str("<html><body><p>hi</p></body></html>");
        let selector = scraper::Selector::parse("p").unwrap();
        let text: String = parsed
            .document
            .select(&selector)
            .map(|element| element.text().collect::<String>())
            .collect();
        assert_eq!(text, "hi");
    }

    #[test]
    fn lossy_decode_warns() {
        let parsed = parse_bytes(&[0xff, 0xfe, b'<', b'p', b'>'], None);
        assert!(
            parsed
                .warnings
                .iter()
                .any(|warning| warning.code == WarningCode::NonUtf8Charset)
        );
    }
}
