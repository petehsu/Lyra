use thiserror::Error;

#[derive(Debug, Error)]
pub enum RenderError {
    #[error("math render failed: {0}")]
    Math(String),
    #[error("mermaid render failed: {0}")]
    Mermaid(String),
    #[error("highlight failed: {0}")]
    Highlight(String),
}

pub type RenderResult<T> = Result<T, RenderError>;
