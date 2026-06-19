#[cfg(feature = "highlight")]
mod engine;
#[cfg(feature = "highlight")]
mod names;

use crate::ast::HighlightSpan;
use crate::error::RenderResult;
use crate::options::HighlightRequest;

pub fn highlight_code(language: &str, source: &str) -> Vec<HighlightSpan> {
    #[cfg(feature = "highlight")]
    {
        if let Ok(spans) = engine::highlight_with_tree_sitter(language, source) {
            return spans;
        }
    }
    let _ = language;
    highlight_fallback(source)
}

pub fn highlight_request(request: &HighlightRequest) -> RenderResult<Vec<HighlightSpan>> {
    Ok(highlight_code(&request.language, &request.source))
}

pub fn highlight_fallback(source: &str) -> Vec<HighlightSpan> {
    if source.is_empty() {
        return Vec::new();
    }
    vec![HighlightSpan {
        start: 0,
        end: source.len(),
        scope: "source".to_string(),
    }]
}

#[cfg(all(test, feature = "highlight"))]
mod tests {
    use super::*;

    #[test]
    fn highlights_rust_keywords_and_comments() {
        let source = "fn main() {\n    // hello\n    let x = 1;\n}\n";
        let spans = highlight_code("rust", source);
        let scopes: Vec<_> = spans.iter().map(|span| span.scope.as_str()).collect();
        assert!(scopes.iter().any(|scope| scope.contains("function")));
        assert!(scopes.iter().any(|scope| scope.contains("comment")));
        assert!(scopes.iter().any(|scope| scope.contains("keyword") || scope.contains("type")));
    }

    #[test]
    fn highlights_typescript_declarations() {
        let source = "export interface User {\n  id: string;\n}\n";
        let spans = highlight_code("typescript", source);
        assert!(spans.iter().any(|span| span.scope.contains("keyword")));
        assert!(spans.iter().any(|span| span.scope.contains("type")));
    }
}