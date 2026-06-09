//! PDF reader extension points.

/// Evaluation note for available PDF extraction paths.
#[allow(dead_code)]
pub(crate) const PDF_EXTRACTION_EVALUATION: &str =
    "default=lyra-docs-core/lopdf; optional candidates=pdf-extract,pdfium-render,PDF.js sidecar";
