use crate::types::{CodeSearchSymbolMatch, IndexedFile, IndexedSymbol};
use once_cell::sync::Lazy;
use regex::Regex;

static RUST_FN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)").expect("valid regex")
});
static RUST_TYPE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"^\s*(?:pub\s+)?(struct|enum|trait|mod|type|const|static)\s+([A-Za-z_][A-Za-z0-9_]*)",
    )
    .expect("valid regex")
});
static PY_FN_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)").expect("valid regex"));
static PY_CLASS_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)").expect("valid regex"));
static JS_FN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][$A-Za-z0-9_]*)")
        .expect("valid regex")
});
static JS_CLASS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\s*(?:export\s+)?class\s+([A-Za-z_][$A-Za-z0-9_]*)").expect("valid regex")
});
static JS_TYPE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\s*(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_][$A-Za-z0-9_]*)")
        .expect("valid regex")
});
static JS_VAR_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][$A-Za-z0-9_]*)")
        .expect("valid regex")
});

pub fn language_from_extension(extension: Option<&str>) -> String {
    match extension {
        Some("ts") | Some("tsx") | Some("mts") | Some("cts") => "typescript",
        Some("js") | Some("jsx") | Some("mjs") | Some("cjs") => "javascript",
        Some("rs") => "rust",
        Some("py") | Some("pyi") => "python",
        _ => "plaintext",
    }
    .to_string()
}

pub fn extract_symbols(content: &str, language: &str) -> Vec<IndexedSymbol> {
    let mut symbols = Vec::new();
    for (index, line) in content.lines().enumerate() {
        let line_number = index as u32 + 1;
        match language {
            "rust" => {
                if let Some(capture) = RUST_FN_RE.captures(line) {
                    if let Some(name) = capture.get(1) {
                        symbols.push(IndexedSymbol {
                            name: name.as_str().to_string(),
                            kind: "function".to_string(),
                            line: line_number,
                            column: name.start() as u32 + 1,
                            language: language.to_string(),
                        });
                        continue;
                    }
                }
                if let Some(capture) = RUST_TYPE_RE.captures(line) {
                    let kind = capture
                        .get(1)
                        .map(|value| value.as_str())
                        .unwrap_or("symbol");
                    if let Some(name) = capture.get(2) {
                        symbols.push(IndexedSymbol {
                            name: name.as_str().to_string(),
                            kind: kind.to_string(),
                            line: line_number,
                            column: name.start() as u32 + 1,
                            language: language.to_string(),
                        });
                    }
                }
            }
            "python" => {
                if let Some(capture) = PY_FN_RE.captures(line) {
                    if let Some(name) = capture.get(1) {
                        symbols.push(IndexedSymbol {
                            name: name.as_str().to_string(),
                            kind: "function".to_string(),
                            line: line_number,
                            column: name.start() as u32 + 1,
                            language: language.to_string(),
                        });
                        continue;
                    }
                }
                if let Some(capture) = PY_CLASS_RE.captures(line) {
                    if let Some(name) = capture.get(1) {
                        symbols.push(IndexedSymbol {
                            name: name.as_str().to_string(),
                            kind: "class".to_string(),
                            line: line_number,
                            column: name.start() as u32 + 1,
                            language: language.to_string(),
                        });
                    }
                }
            }
            "typescript" | "javascript" => {
                if let Some(capture) = JS_FN_RE.captures(line) {
                    if let Some(name) = capture.get(1) {
                        symbols.push(IndexedSymbol {
                            name: name.as_str().to_string(),
                            kind: "function".to_string(),
                            line: line_number,
                            column: name.start() as u32 + 1,
                            language: language.to_string(),
                        });
                        continue;
                    }
                }
                if let Some(capture) = JS_CLASS_RE.captures(line) {
                    if let Some(name) = capture.get(1) {
                        symbols.push(IndexedSymbol {
                            name: name.as_str().to_string(),
                            kind: "class".to_string(),
                            line: line_number,
                            column: name.start() as u32 + 1,
                            language: language.to_string(),
                        });
                        continue;
                    }
                }
                if let Some(capture) = JS_TYPE_RE.captures(line) {
                    if let Some(name) = capture.get(1) {
                        symbols.push(IndexedSymbol {
                            name: name.as_str().to_string(),
                            kind: "type".to_string(),
                            line: line_number,
                            column: name.start() as u32 + 1,
                            language: language.to_string(),
                        });
                        continue;
                    }
                }
                if let Some(capture) = JS_VAR_RE.captures(line) {
                    if let Some(name) = capture.get(1) {
                        symbols.push(IndexedSymbol {
                            name: name.as_str().to_string(),
                            kind: "variable".to_string(),
                            line: line_number,
                            column: name.start() as u32 + 1,
                            language: language.to_string(),
                        });
                    }
                }
            }
            _ => {}
        }
    }
    symbols
}

pub fn search_symbols(
    files: &[IndexedFile],
    query: &str,
    limit: usize,
    kind: Option<&str>,
    language: Option<&str>,
) -> (Vec<CodeSearchSymbolMatch>, bool) {
    let normalized_query = query.trim().to_lowercase();
    let normalized_kind = kind.map(|value| value.trim().to_lowercase());
    let normalized_language = language.map(|value| value.trim().to_lowercase());
    let mut scored = Vec::<(u32, CodeSearchSymbolMatch)>::new();

    if normalized_query.is_empty() {
        return (Vec::new(), false);
    }

    for file in files {
        for symbol in &file.symbols {
            let symbol_name = symbol.name.to_lowercase();
            if symbol_name.contains(&normalized_query) == false {
                continue;
            }
            if let Some(expected_kind) = normalized_kind.as_deref() {
                if symbol.kind.to_lowercase() != expected_kind {
                    continue;
                }
            }
            if let Some(expected_language) = normalized_language.as_deref() {
                if symbol.language.to_lowercase() != expected_language {
                    continue;
                }
            }

            let score = if symbol_name == normalized_query {
                100
            } else if symbol_name.starts_with(&normalized_query) {
                80
            } else {
                60
            };

            scored.push((
                score,
                CodeSearchSymbolMatch {
                    name: symbol.name.clone(),
                    kind: symbol.kind.clone(),
                    file_path: file.path.clone(),
                    relative_path: file.relative_path.clone(),
                    line: symbol.line,
                    column: symbol.column,
                    language: symbol.language.clone(),
                },
            ));
        }
    }

    scored.sort_by(|(left_score, left), (right_score, right)| {
        right_score
            .cmp(left_score)
            .then_with(|| left.file_path.cmp(&right.file_path))
            .then_with(|| left.line.cmp(&right.line))
            .then_with(|| left.column.cmp(&right.column))
    });

    let truncated = scored.len() > limit;
    let symbols = scored
        .into_iter()
        .take(limit)
        .map(|(_, value)| value)
        .collect::<Vec<_>>();

    (symbols, truncated)
}
