use std::cell::RefCell;

use arborium::Highlighter;

use crate::ast::HighlightSpan;
use crate::error::{RenderError, RenderResult};

fn arborium_language(language: &str) -> Option<&'static str> {
    match language.to_ascii_lowercase().as_str() {
        "rust" | "rs" => Some("rust"),
        "typescript" | "ts" => Some("typescript"),
        "tsx" => Some("tsx"),
        "javascript" | "js" => Some("javascript"),
        "python" | "py" => Some("python"),
        "json" => Some("json"),
        "bash" | "sh" | "shell" => Some("bash"),
        _ => None,
    }
}

thread_local! {
    static HIGHLIGHTER: RefCell<Highlighter> = RefCell::new(Highlighter::new());
}

pub fn highlight_with_arborium(language: &str, source: &str) -> RenderResult<Vec<HighlightSpan>> {
    if source.is_empty() {
        return Ok(Vec::new());
    }

    let language_key = arborium_language(language)
        .ok_or_else(|| RenderError::Highlight(format!("unknown language: {language}")))?;

    let spans = HIGHLIGHTER.with(|highlighter| {
        highlighter
            .borrow_mut()
            .highlight_spans(language_key, source)
            .map_err(|error| RenderError::Highlight(error.to_string()))
    })?;

    let mapped = spans
        .into_iter()
        .map(|span| HighlightSpan {
            start: span.start as usize,
            end: span.end as usize,
            scope: span.capture,
        })
        .collect::<Vec<_>>();

    if mapped.is_empty() {
        return Ok(super::highlight_fallback(source));
    }

    Ok(mapped)
}
