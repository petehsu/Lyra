pub mod ansi;
pub mod ast;
pub mod cache;
pub mod error;
pub mod highlight;
pub mod link;
pub mod linkify;
pub mod markdown;
pub mod math;
pub mod mermaid;
pub mod options;
pub mod pipeline;
pub mod preprocess;
pub mod safety;

pub use ansi::{render_agent_markdown, render_document_ansi, render_markdown_ansi};
pub use ast::{HighlightSpan, InlineNode, LyraRenderDocument, RenderBlock};
pub use cache::invalidate_cache;
pub use error::{RenderError, RenderResult};
pub use highlight::{highlight_code, highlight_request};
pub use link::{normalize_link_display_text, normalize_link_href};
pub use markdown::parse_standard_markdown;
pub use options::{
    apply_render_document_overrides, parse_render_document_mode, HighlightRequest,
    RenderDocumentMode, RenderDocumentOptions, RenderTheme,
};
pub use pipeline::render_document;
pub use preprocess::fix_common_markdown_issues;
pub use safety::{is_safe_image_src, is_safe_link_url, sanitize_image_src, sanitize_link_href};
