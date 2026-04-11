use thiserror::Error;

#[derive(Debug, Error)]
pub enum DocumentParseError {
    #[error("document format is unsupported")]
    UnsupportedFormat,
    #[error("document could not be parsed: {0}")]
    ParseFailed(String),
    #[error("document requires a password")]
    PasswordRequired,
    #[error("document contains no readable text")]
    EmptyText,
    #[error("requested page range is out of range")]
    PageOutOfRange,
}

impl DocumentParseError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::UnsupportedFormat => "document_unsupported_format",
            Self::ParseFailed(_) => "document_parse_failed",
            Self::PasswordRequired => "document_encrypted_password_required",
            Self::EmptyText => "document_empty_text",
            Self::PageOutOfRange => "document_page_out_of_range",
        }
    }
}
