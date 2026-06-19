use once_cell::sync::Lazy;
use tree_sitter_highlight::{Highlight, HighlightConfiguration, HighlightEvent, Highlighter};

use crate::ast::HighlightSpan;
use crate::error::{RenderError, RenderResult};

use super::names::HIGHLIGHT_NAMES;

const TYPESCRIPT_SUPPLEMENT_QUERY: &str = include_str!("../../queries/typescript-supplement.scm");

struct LanguageHighlightSpec {
    language: tree_sitter::Language,
    name: &'static str,
    highlights_query: &'static str,
    highlights_supplement: &'static str,
    injection_query: &'static str,
    locals_query: &'static str,
}

fn language_spec(language: &str) -> Option<LanguageHighlightSpec> {
    match language.to_ascii_lowercase().as_str() {
        "rust" | "rs" => Some(LanguageHighlightSpec {
            language: tree_sitter_rust::LANGUAGE.into(),
            name: "rust",
            highlights_query: tree_sitter_rust::HIGHLIGHTS_QUERY,
            highlights_supplement: "",
            injection_query: tree_sitter_rust::INJECTIONS_QUERY,
            locals_query: "",
        }),
        "typescript" | "ts" => Some(LanguageHighlightSpec {
            language: tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            name: "typescript",
            highlights_query: tree_sitter_typescript::HIGHLIGHTS_QUERY,
            highlights_supplement: TYPESCRIPT_SUPPLEMENT_QUERY,
            injection_query: "",
            locals_query: "",
        }),
        "tsx" => Some(LanguageHighlightSpec {
            language: tree_sitter_typescript::LANGUAGE_TSX.into(),
            name: "tsx",
            highlights_query: tree_sitter_typescript::HIGHLIGHTS_QUERY,
            highlights_supplement: TYPESCRIPT_SUPPLEMENT_QUERY,
            injection_query: "",
            locals_query: "",
        }),
        "javascript" | "js" => Some(LanguageHighlightSpec {
            language: tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            name: "javascript",
            highlights_query: tree_sitter_typescript::HIGHLIGHTS_QUERY,
            highlights_supplement: TYPESCRIPT_SUPPLEMENT_QUERY,
            injection_query: "",
            locals_query: "",
        }),
        "python" | "py" => Some(LanguageHighlightSpec {
            language: tree_sitter_python::LANGUAGE.into(),
            name: "python",
            highlights_query: tree_sitter_python::HIGHLIGHTS_QUERY,
            highlights_supplement: "",
            injection_query: "",
            locals_query: "",
        }),
        "json" => Some(LanguageHighlightSpec {
            language: tree_sitter_json::LANGUAGE.into(),
            name: "json",
            highlights_query: tree_sitter_json::HIGHLIGHTS_QUERY,
            highlights_supplement: "",
            injection_query: "",
            locals_query: "",
        }),
        "bash" | "sh" | "shell" => Some(LanguageHighlightSpec {
            language: tree_sitter_bash::LANGUAGE.into(),
            name: "bash",
            highlights_query: tree_sitter_bash::HIGHLIGHT_QUERY,
            highlights_supplement: "",
            injection_query: "",
            locals_query: "",
        }),
        _ => None,
    }
}

fn combined_highlights_query(spec: &LanguageHighlightSpec) -> String {
    if spec.highlights_supplement.is_empty() {
        return spec.highlights_query.to_string();
    }
    let mut query = String::from(spec.highlights_query);
    query.push('\n');
    query.push_str(spec.highlights_supplement);
    query
}

fn build_configuration(spec: &LanguageHighlightSpec) -> HighlightConfiguration {
    let highlights_query = combined_highlights_query(spec);
    let mut configuration = HighlightConfiguration::new(
        spec.language.clone(),
        spec.name,
        &highlights_query,
        spec.injection_query,
        spec.locals_query,
    )
    .unwrap_or_else(|error| {
        panic!(
            "failed to initialize {} highlight configuration: {error}",
            spec.name
        );
    });
    configuration.configure(HIGHLIGHT_NAMES);
    configuration
}

fn lazy_configuration(language: &str) -> Option<&'static HighlightConfiguration> {
    static RUST: Lazy<HighlightConfiguration> =
        Lazy::new(|| build_configuration(&language_spec("rust").expect("rust spec")));
    static TYPESCRIPT: Lazy<HighlightConfiguration> =
        Lazy::new(|| build_configuration(&language_spec("typescript").expect("typescript spec")));
    static TSX: Lazy<HighlightConfiguration> =
        Lazy::new(|| build_configuration(&language_spec("tsx").expect("tsx spec")));
    static JAVASCRIPT: Lazy<HighlightConfiguration> = Lazy::new(|| {
        build_configuration(&language_spec("javascript").expect("javascript spec"))
    });
    static PYTHON: Lazy<HighlightConfiguration> =
        Lazy::new(|| build_configuration(&language_spec("python").expect("python spec")));
    static JSON: Lazy<HighlightConfiguration> =
        Lazy::new(|| build_configuration(&language_spec("json").expect("json spec")));
    static BASH: Lazy<HighlightConfiguration> =
        Lazy::new(|| build_configuration(&language_spec("bash").expect("bash spec")));

    match language.to_ascii_lowercase().as_str() {
        "rust" | "rs" => Some(&RUST),
        "typescript" | "ts" => Some(&TYPESCRIPT),
        "tsx" => Some(&TSX),
        "javascript" | "js" => Some(&JAVASCRIPT),
        "python" | "py" => Some(&PYTHON),
        "json" => Some(&JSON),
        "bash" | "sh" | "shell" => Some(&BASH),
        _ => None,
    }
}

fn scope_for_highlight(highlight: Highlight) -> String {
    HIGHLIGHT_NAMES
        .get(highlight.0)
        .map(|name| (*name).to_string())
        .unwrap_or_else(|| "source".to_string())
}

fn push_span(spans: &mut Vec<HighlightSpan>, start: usize, end: usize, scope: String) {
    if start >= end {
        return;
    }
    if let Some(last) = spans.last_mut() {
        if last.scope == scope && last.end == start {
            last.end = end;
            return;
        }
    }
    spans.push(HighlightSpan { start, end, scope });
}

pub fn highlight_with_tree_sitter(language: &str, source: &str) -> RenderResult<Vec<HighlightSpan>> {
    if source.is_empty() {
        return Ok(Vec::new());
    }

    let configuration = lazy_configuration(language)
        .ok_or_else(|| RenderError::Highlight(format!("unknown language: {language}")))?;
    let mut highlighter = Highlighter::new();
    let mut highlight_stack: Vec<Highlight> = Vec::new();
    let mut spans = Vec::new();

    let mut events = highlighter
        .highlight(configuration, source.as_bytes(), None, |_| None)
        .map_err(|error| RenderError::Highlight(error.to_string()))?;

    while let Some(event) = events.next() {
        let event = event.map_err(|error| RenderError::Highlight(error.to_string()))?;
        match event {
            HighlightEvent::Source { start, end } => {
                if let Some(highlight) = highlight_stack.last() {
                    push_span(&mut spans, start, end, scope_for_highlight(*highlight));
                }
            }
            HighlightEvent::HighlightStart(highlight) => {
                highlight_stack.push(highlight);
            }
            HighlightEvent::HighlightEnd => {
                highlight_stack.pop();
            }
        }
    }

    if spans.is_empty() {
        return Ok(super::highlight_fallback(source));
    }

    Ok(spans)
}