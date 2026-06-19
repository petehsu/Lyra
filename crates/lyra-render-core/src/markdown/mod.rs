mod details;
mod parser;

pub use details::parse_markdown_with_details as parse_markdown;
pub(crate) use parser::parse_markdown_plain;
