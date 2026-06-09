//! Image reader extension points.

/// Default image extraction path order.
#[allow(dead_code)]
pub(crate) const IMAGE_EXTRACTION_ORDER: &[&str] = &["metadata", "ocr", "caption"];
