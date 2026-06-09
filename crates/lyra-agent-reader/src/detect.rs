//! Format detection from MIME type, file extension, and magic bytes.
//!
//! Resolution order: an explicit, specific MIME type wins; otherwise the file
//! extension; otherwise leading magic bytes; otherwise a textual/binary default
//! based on whether the bytes look like UTF-8 text.

use crate::types::{DetectedBy, Detection, Format};

/// Detect the format of `bytes`, using optional `mime` and `path_or_url` hints.
pub fn detect(bytes: &[u8], mime: Option<&str>, path_or_url: Option<&str>) -> Detection {
    if let Some(detection) = detect_from_mime(mime) {
        return detection;
    }
    if let Some(detection) = path_or_url.and_then(detect_from_extension) {
        return detection;
    }
    if let Some(detection) = detect_from_magic(bytes) {
        return detection;
    }
    detect_default(bytes, mime)
}

fn normalize_mime(mime: &str) -> String {
    mime.split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
}

fn detect_from_mime(mime: Option<&str>) -> Option<Detection> {
    let raw = mime?;
    let normalized = normalize_mime(raw);
    if normalized.is_empty() {
        return None;
    }
    let format = match normalized.as_str() {
        "text/html" | "application/xhtml+xml" => Some(Format::Html),
        "text/markdown" | "text/x-markdown" => Some(Format::Markdown),
        "text/plain" => Some(Format::Text),
        "application/json" | "application/ld+json" => Some(Format::Json),
        "application/rss+xml" => Some(Format::Rss),
        "application/atom+xml" => Some(Format::Atom),
        "text/xml" | "application/xml" => Some(Format::Xml),
        "application/pdf" => Some(Format::Pdf),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => {
            Some(Format::Docx)
        }
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => Some(Format::Xlsx),
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => {
            Some(Format::Pptx)
        }
        "text/csv" | "text/tab-separated-values" => Some(Format::Csv),
        "application/zip" => Some(Format::Zip),
        _ => mime_family(&normalized),
    }?;
    Some(Detection {
        format,
        mime_type: Some(raw.to_string()),
        detected_by: DetectedBy::MimeType,
        confidence: 1.0,
    })
}

fn mime_family(normalized: &str) -> Option<Format> {
    if normalized.starts_with("image/") {
        return Some(Format::Image);
    }
    if normalized.ends_with("+json") {
        return Some(Format::Json);
    }
    if normalized.ends_with("+xml") {
        return Some(Format::Xml);
    }
    if normalized.starts_with("text/") {
        return Some(Format::Text);
    }
    None
}

fn detect_from_extension(path_or_url: &str) -> Option<Detection> {
    // Strip query/fragment before looking at the extension.
    let path = path_or_url.split(['?', '#']).next().unwrap_or(path_or_url);
    let ext = path.rsplit('.').next()?.to_ascii_lowercase();
    if ext == path.to_ascii_lowercase() {
        // No dot at all — `rsplit` returns the whole string.
        return None;
    }
    let format = match ext.as_str() {
        "html" | "htm" | "xhtml" => Format::Html,
        "md" | "markdown" => Format::Markdown,
        "txt" | "text" => Format::Text,
        "json" => Format::Json,
        "rss" => Format::Rss,
        "atom" => Format::Atom,
        "xml" => Format::Xml,
        "pdf" => Format::Pdf,
        "docx" => Format::Docx,
        "xlsx" => Format::Xlsx,
        "pptx" => Format::Pptx,
        "csv" => Format::Csv,
        "tsv" => Format::Csv,
        "zip" => Format::Zip,
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "tiff" | "tif" | "bmp" | "svg" => Format::Image,
        _ => return None,
    };
    Some(Detection {
        format,
        mime_type: mime_guess::from_ext(&ext).first_raw().map(str::to_string),
        detected_by: DetectedBy::Extension,
        confidence: 0.8,
    })
}

fn detect_from_magic(bytes: &[u8]) -> Option<Detection> {
    let format = magic_format(bytes)?;
    Some(Detection {
        format,
        mime_type: None,
        detected_by: DetectedBy::MagicBytes,
        confidence: 0.95,
    })
}

fn magic_format(bytes: &[u8]) -> Option<Format> {
    if bytes.starts_with(b"%PDF-") {
        return Some(Format::Pdf);
    }
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some(Format::Image);
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some(Format::Image); // JPEG
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some(Format::Image);
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some(Format::Image);
    }
    if bytes.starts_with(&[b'B', b'M']) {
        return Some(Format::Image); // BMP
    }
    // ZIP-family (also OOXML containers). We cannot distinguish docx/xlsx/pptx
    // from a bare zip via the leading bytes alone, so report Zip; callers that
    // already have an OOXML MIME type take the MIME branch above.
    if bytes.starts_with(&[b'P', b'K', 0x03, 0x04]) || bytes.starts_with(&[b'P', b'K', 0x05, 0x06])
    {
        return Some(Format::Zip);
    }
    None
}

fn detect_default(bytes: &[u8], mime: Option<&str>) -> Detection {
    let looks_text = looks_like_text(bytes);
    let format = if looks_text {
        sniff_textual(bytes)
    } else {
        Format::UnknownBinary
    };
    Detection {
        format,
        mime_type: mime.map(str::to_string),
        detected_by: DetectedBy::Default,
        confidence: if looks_text { 0.4 } else { 0.3 },
    }
}

/// A cheap heuristic: a short prefix decodes as UTF-8 without NUL bytes.
fn looks_like_text(bytes: &[u8]) -> bool {
    let prefix = &bytes[..bytes.len().min(1024)];
    if prefix.contains(&0) {
        return false;
    }
    std::str::from_utf8(prefix).is_ok()
}

fn sniff_textual(bytes: &[u8]) -> Format {
    let prefix = &bytes[..bytes.len().min(512)];
    let text = match std::str::from_utf8(prefix) {
        Ok(value) => value.trim_start(),
        Err(_) => return Format::Text,
    };
    let lower = text.to_ascii_lowercase();
    if lower.starts_with("<!doctype html") || lower.starts_with("<html") {
        return Format::Html;
    }
    if lower.starts_with("<?xml") || lower.starts_with('<') {
        if lower.contains("<rss") {
            return Format::Rss;
        }
        if lower.contains("<feed") {
            return Format::Atom;
        }
        if lower.contains("<html") {
            return Format::Html;
        }
        return Format::Xml;
    }
    let trimmed = text.trim_start();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        return Format::Json;
    }
    Format::Text
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn mime_html_wins() {
        let d = detect(b"<html></html>", Some("text/html; charset=utf-8"), None);
        assert_eq!(d.format, Format::Html);
        assert_eq!(d.detected_by, DetectedBy::MimeType);
        assert!((d.confidence - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn markdown_by_extension() {
        let d = detect(b"# hi", None, Some("https://x.test/readme.md"));
        assert_eq!(d.format, Format::Markdown);
        assert_eq!(d.detected_by, DetectedBy::Extension);
    }

    #[test]
    fn extension_ignores_query_string() {
        let d = detect(b"# hi", None, Some("https://x.test/readme.md?v=2#frag"));
        assert_eq!(d.format, Format::Markdown);
    }

    #[test]
    fn pdf_by_magic() {
        let d = detect(b"%PDF-1.7\n...", None, None);
        assert_eq!(d.format, Format::Pdf);
        assert_eq!(d.detected_by, DetectedBy::MagicBytes);
    }

    #[test]
    fn png_by_magic() {
        let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0];
        let d = detect(&png, None, None);
        assert_eq!(d.format, Format::Image);
    }

    #[test]
    fn rss_mime() {
        let d = detect(b"<rss></rss>", Some("application/rss+xml"), None);
        assert_eq!(d.format, Format::Rss);
    }

    #[test]
    fn plus_json_family() {
        let d = detect(b"{}", Some("application/vnd.api+json"), None);
        assert_eq!(d.format, Format::Json);
    }

    #[test]
    fn ambiguous_text_default_low_confidence() {
        let d = detect(b"just some words here", None, None);
        assert_eq!(d.format, Format::Text);
        assert_eq!(d.detected_by, DetectedBy::Default);
        assert!(d.confidence < 0.5);
    }

    #[test]
    fn sniff_html_without_hints() {
        let d = detect(b"<!doctype html><html><body>hi</body></html>", None, None);
        assert_eq!(d.format, Format::Html);
        assert_eq!(d.detected_by, DetectedBy::Default);
    }

    #[test]
    fn binary_default() {
        let d = detect(&[0, 1, 2, 3, 255, 254], None, None);
        assert_eq!(d.format, Format::UnknownBinary);
    }
}
