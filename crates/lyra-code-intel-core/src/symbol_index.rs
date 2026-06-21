use crate::types::{CodeSearchSymbolMatch, IndexedFile, IndexedSymbol};
use once_cell::sync::Lazy;
use regex::Regex;
use tree_sitter::{Language, Parser, Query, QueryCursor, StreamingIterator};

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

/// Tags queries per language. The kind is encoded in the capture suffix
/// (`@definition.<kind>`) so mapping to `IndexedSymbol.kind` is near-identity.
/// These are intentionally hand-written rather than reusing each grammar's
/// shipped `tags.scm`, which collapses kinds (Rust struct/enum/type → class)
/// and, for TypeScript, only matches `.d.ts` signature nodes.
const RUST_TAGS_QUERY: &str = r#"
(function_item name: (identifier) @name) @definition.function
(struct_item   name: (type_identifier) @name) @definition.struct
(enum_item     name: (type_identifier) @name) @definition.enum
(trait_item    name: (type_identifier) @name) @definition.trait
(mod_item      name: (identifier) @name) @definition.mod
(type_item     name: (type_identifier) @name) @definition.type
(const_item    name: (identifier) @name) @definition.const
(static_item   name: (identifier) @name) @definition.static
"#;

const PYTHON_TAGS_QUERY: &str = r#"
(function_definition name: (identifier) @name) @definition.function
(class_definition    name: (identifier) @name) @definition.class
"#;

const TYPESCRIPT_TAGS_QUERY: &str = r#"
(function_declaration name: (identifier) @name) @definition.function
(generator_function_declaration name: (identifier) @name) @definition.function
(class_declaration name: (type_identifier) @name) @definition.class
(abstract_class_declaration name: (type_identifier) @name) @definition.class
(interface_declaration name: (type_identifier) @name) @definition.type
(type_alias_declaration name: (type_identifier) @name) @definition.type
(enum_declaration name: (identifier) @name) @definition.type
(lexical_declaration (variable_declarator
   name: (identifier) @name
   value: [(arrow_function) (function_expression)])) @definition.function
(lexical_declaration (variable_declarator name: (identifier) @name)) @definition.variable
(variable_declaration (variable_declarator name: (identifier) @name)) @definition.variable
"#;

const JAVASCRIPT_TAGS_QUERY: &str = r#"
(function_declaration name: (identifier) @name) @definition.function
(generator_function_declaration name: (identifier) @name) @definition.function
(class_declaration name: (identifier) @name) @definition.class
(lexical_declaration (variable_declarator
   name: (identifier) @name
   value: [(arrow_function) (function_expression)])) @definition.function
(lexical_declaration (variable_declarator name: (identifier) @name)) @definition.variable
(variable_declaration (variable_declarator name: (identifier) @name)) @definition.variable
"#;

/// Resolve the tree-sitter grammar and tags query for a language/extension
/// pair. `.tsx` uses the TSX grammar; everything else maps off `language`.
fn grammar_for(language: &str, extension: Option<&str>) -> Option<(Language, &'static str)> {
    match language {
        "rust" => Some((tree_sitter_rust::LANGUAGE.into(), RUST_TAGS_QUERY)),
        "python" => Some((tree_sitter_python::LANGUAGE.into(), PYTHON_TAGS_QUERY)),
        "typescript" => {
            let is_tsx = matches!(extension, Some("tsx"));
            let language = if is_tsx {
                tree_sitter_typescript::LANGUAGE_TSX.into()
            } else {
                tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
            };
            Some((language, TYPESCRIPT_TAGS_QUERY))
        }
        "javascript" => Some((
            tree_sitter_javascript::LANGUAGE.into(),
            JAVASCRIPT_TAGS_QUERY,
        )),
        _ => None,
    }
}

/// Normalize the capture-suffix kind to the kind strings the index exposes.
/// `method` collapses to `function`; TS interface/enum/type_alias are encoded
/// directly as `@definition.type` in the query for parity with the old
/// regex extractor, so nothing else is rewritten here.
fn map_kind(raw: &str) -> &str {
    match raw {
        "method" => "function",
        other => other,
    }
}

pub fn extract_symbols(
    content: &str,
    language: &str,
    extension: Option<&str>,
) -> Vec<IndexedSymbol> {
    if let Some((grammar, query_source)) = grammar_for(language, extension) {
        if let Some(symbols) =
            extract_symbols_tree_sitter(content, language, &grammar, query_source)
        {
            return symbols;
        }
    }
    extract_symbols_regex(content, language)
}

fn extract_symbols_tree_sitter(
    content: &str,
    language: &str,
    grammar: &Language,
    query_source: &str,
) -> Option<Vec<IndexedSymbol>> {
    let mut parser = Parser::new();
    parser.set_language(grammar).ok()?;
    let tree = parser.parse(content.as_bytes(), None)?;
    let query = Query::new(grammar, query_source).ok()?;
    let capture_names = query.capture_names();

    let source = content.as_bytes();
    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(&query, tree.root_node(), source);
    let mut symbols = Vec::<IndexedSymbol>::new();

    while let Some(query_match) = matches.next() {
        let mut name_node = None;
        let mut kind = None;
        for capture in query_match.captures {
            let capture_name = capture_names[capture.index as usize];
            if capture_name == "name" {
                name_node = Some(capture.node);
            } else if let Some(suffix) = capture_name.strip_prefix("definition.") {
                kind = Some(suffix);
            }
        }

        let (Some(node), Some(kind)) = (name_node, kind) else {
            continue;
        };
        let Ok(name) = node.utf8_text(source) else {
            continue;
        };
        let position = node.start_position();
        let line = position.row as u32 + 1;
        let column = position.column as u32 + 1;
        let kind = map_kind(kind).to_string();

        // A `const f = () => {}` matches both the arrow-function pattern and the
        // generic variable pattern. Dedupe by position, preferring the more
        // specific (non-`variable`) kind.
        if let Some(existing) = symbols
            .iter_mut()
            .find(|symbol| symbol.line == line && symbol.column == column)
        {
            if existing.kind == "variable" && kind != "variable" {
                existing.kind = kind;
            }
            continue;
        }

        symbols.push(IndexedSymbol {
            name: name.to_string(),
            kind,
            line,
            column,
            language: language.to_string(),
        });
    }

    Some(symbols)
}

fn extract_symbols_regex(content: &str, language: &str) -> Vec<IndexedSymbol> {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn find<'a>(symbols: &'a [IndexedSymbol], name: &str) -> Option<&'a IndexedSymbol> {
        symbols.iter().find(|symbol| symbol.name == name)
    }

    #[test]
    fn rust_symbols_cover_all_kinds() {
        let source = "pub fn alpha() {}\nstruct Beta;\nenum Gamma {}\ntrait Delta {}\nmod epsilon {}\ntype Zeta = u8;\nconst ETA: u8 = 1;\nstatic THETA: u8 = 2;\n";
        let symbols = extract_symbols(source, "rust", Some("rs"));
        let expect = [
            ("alpha", "function"),
            ("Beta", "struct"),
            ("Gamma", "enum"),
            ("Delta", "trait"),
            ("epsilon", "mod"),
            ("Zeta", "type"),
            ("ETA", "const"),
            ("THETA", "static"),
        ];
        for (name, kind) in expect {
            let symbol = find(&symbols, name).unwrap_or_else(|| panic!("missing {name}"));
            assert_eq!(symbol.kind, kind, "kind for {name}");
            assert_eq!(symbol.language, "rust");
        }
    }

    #[test]
    fn rust_column_is_one_based_byte_offset() {
        // `alpha` starts after "pub fn " (7 bytes) on line 1.
        let symbols = extract_symbols("pub fn alpha() {}\n", "rust", Some("rs"));
        let alpha = find(&symbols, "alpha").unwrap();
        assert_eq!(alpha.line, 1);
        assert_eq!(alpha.column, 8);
    }

    #[test]
    fn python_functions_and_classes() {
        let source = "def handler():\n    pass\nclass Widget:\n    pass\n";
        let symbols = extract_symbols(source, "python", Some("py"));
        assert_eq!(find(&symbols, "handler").unwrap().kind, "function");
        assert_eq!(find(&symbols, "Widget").unwrap().kind, "class");
    }

    #[test]
    fn typescript_kinds_match_parity() {
        let source = "export function run() {}\nexport class Service {}\nexport interface Shape {}\nexport type Id = string;\nexport enum Color { Red }\nconst handler = () => {};\nconst count = 1;\n";
        let symbols = extract_symbols(source, "typescript", Some("ts"));
        assert_eq!(find(&symbols, "run").unwrap().kind, "function");
        assert_eq!(find(&symbols, "Service").unwrap().kind, "class");
        // interface/enum collapse to "type" for parity with the old extractor.
        assert_eq!(find(&symbols, "Shape").unwrap().kind, "type");
        assert_eq!(find(&symbols, "Id").unwrap().kind, "type");
        assert_eq!(find(&symbols, "Color").unwrap().kind, "type");
        // Arrow const is a function, not a variable (dedupe prefers function).
        assert_eq!(find(&symbols, "handler").unwrap().kind, "function");
        assert_eq!(find(&symbols, "count").unwrap().kind, "variable");
    }

    #[test]
    fn tsx_uses_tsx_grammar() {
        let source = "export const View = () => <div />;\n";
        let symbols = extract_symbols(source, "typescript", Some("tsx"));
        assert_eq!(find(&symbols, "View").unwrap().kind, "function");
    }

    #[test]
    fn broken_syntax_does_not_panic() {
        // Unbalanced braces: tree-sitter is error-tolerant and still returns a
        // (partial) tree, so this must not panic. It typically still recovers
        // the `broken` definition from the error node.
        let source = "pub fn broken( {{{ \n";
        let symbols = extract_symbols(source, "rust", Some("rs"));
        assert!(symbols.iter().all(|s| s.line >= 1));
    }

    #[test]
    fn regex_fallback_used_for_unparseable_input() {
        // Force the fallback path directly to confirm it still extracts symbols.
        let symbols = extract_symbols_regex("pub fn legacy() {}\n", "rust");
        assert!(symbols
            .iter()
            .any(|s| s.name == "legacy" && s.kind == "function"));
    }

    #[test]
    fn plaintext_yields_no_symbols() {
        let symbols = extract_symbols("just some prose\n", "plaintext", None);
        assert!(symbols.is_empty());
    }
}
