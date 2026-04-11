pub mod error;
pub mod parser;
pub mod search;
pub mod types;

pub use error::DocumentParseError;
pub use parser::{probe_document, read_document_text, search_document_text};
pub use types::{
    DocumentFormat, DocumentProbeRequest, DocumentProbeResult, DocumentReadRequest,
    DocumentReadResult, DocumentReadScope, DocumentSearchMatch, DocumentSearchRequest,
    DocumentSearchResult,
};
