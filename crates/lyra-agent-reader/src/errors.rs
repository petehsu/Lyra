//! Error types for the agent reader.

use thiserror::Error;

use crate::types::ReaderEngineAttempt;

/// Convenience alias for reader fallible operations.
pub type ReaderResult<T> = Result<T, ReaderError>;

/// Errors produced while fetching, detecting, parsing, or rendering content.
#[derive(Debug, Error)]
pub enum ReaderError {
    /// Network/transport failure while fetching a URL.
    #[error("fetch failed: {message}")]
    Fetch {
        /// Human-readable cause.
        message: String,
        /// Final URL reached before the failure, if known.
        final_url: Option<String>,
        /// HTTP status code, if a response was received.
        status: Option<u16>,
    },

    /// The remote server refused access (401/403/451).
    #[error("access denied with status {status}")]
    AccessDenied {
        /// HTTP status code.
        status: u16,
        /// Final URL reached.
        final_url: String,
        /// Reported content type, if any.
        content_type: Option<String>,
    },

    /// Body could not be decoded as text under the supported charsets.
    #[error("decode failed: {0}")]
    Decode(String),

    /// The detected format is not handled by this milestone (e.g. PDF, image).
    #[error("unsupported format: {format} ({mime})")]
    UnsupportedFormat {
        /// Short format label (e.g. `pdf`, `image`).
        format: String,
        /// Reported or detected MIME type.
        mime: String,
        /// Final URL reached, if any.
        final_url: Option<String>,
    },

    /// HTML/DOM could not be parsed or a selector failed to build.
    #[error("parse failed: {0}")]
    Parse(String),

    /// Size/byte/char budget exceeded in a non-recoverable way.
    #[error("budget exceeded: {0}")]
    Budget(String),

    /// Local file I/O failure.
    #[error("io failed: {0}")]
    Io(String),

    /// Every configured engine was tried and none produced a usable result.
    #[error("all reader engines failed: {message}")]
    EnginesExhausted {
        /// Human-readable summary of the final failure.
        message: String,
        /// Ordered attempts across engines.
        attempts: Vec<ReaderEngineAttempt>,
        /// Final URL reached before failure, if known.
        final_url: Option<String>,
    },
}

impl ReaderError {
    /// Deterministic follow-up guidance for caller-facing tools.
    pub fn recommended_next_action(&self) -> Option<&'static str> {
        match self {
            ReaderError::UnsupportedFormat { format, .. } if format == "pdf" => {
                Some("Use the document reader adapter; if the PDF is image-only, enable OCR.")
            }
            ReaderError::UnsupportedFormat { format, .. } if format == "image" => {
                Some("Use the image reader adapter with OCR or caption extraction enabled.")
            }
            ReaderError::UnsupportedFormat { format, .. }
                if matches!(format.as_str(), "docx" | "xlsx" | "pptx") =>
            {
                Some("Enable the Office adapter or LibreOffice conversion path.")
            }
            ReaderError::AccessDenied { .. } => {
                Some("Use a browser-rendered path with an authorized session.")
            }
            ReaderError::Fetch { message, .. }
                if message.contains("browser snapshot")
                    || message.contains("browser rendering") =>
            {
                Some("Use a browser-rendered snapshot or enable the Workbench Browser path.")
            }
            ReaderError::Budget(_) => {
                Some("Use a narrower target selector, query focus, or overflow=chunks.")
            }
            ReaderError::EnginesExhausted { .. } => {
                Some("Retry with a different engine, narrower scope, or a browser session.")
            }
            _ => None,
        }
    }

    /// Engine attempts recorded for this failure, when available.
    pub fn engine_attempts(&self) -> &[ReaderEngineAttempt] {
        match self {
            ReaderError::EnginesExhausted { attempts, .. } => attempts,
            _ => &[],
        }
    }
}
