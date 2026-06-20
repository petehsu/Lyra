use crate::text_index::{build_word_matcher, line_searcher};
use crate::types::{
    CodeGraphEdge, CodeGraphExpandParams, CodeGraphExpandResponse, CodeGraphMeta, CodeGraphNode,
    IndexSnapshot, IndexedFile,
};
use grep_matcher::Matcher;
use grep_searcher::{Searcher, Sink, SinkMatch};
use std::collections::HashSet;
use std::time::Instant;

pub fn expand_graph(
    snapshot: &IndexSnapshot,
    params: &CodeGraphExpandParams,
) -> CodeGraphExpandResponse {
    let started_at = Instant::now();
    let normalized_symbol = params.symbol.trim().to_lowercase();
    let mut nodes = Vec::<CodeGraphNode>::new();
    let mut edges = Vec::<CodeGraphEdge>::new();
    let mut node_ids = HashSet::<String>::new();
    let mut truncated = false;

    if normalized_symbol.is_empty() {
        return CodeGraphExpandResponse {
            symbol: params.symbol.clone(),
            nodes,
            edges,
            meta: CodeGraphMeta {
                truncated: false,
                elapsed_ms: started_at.elapsed().as_millis() as u64,
                semantic_coverage: 0.0,
            },
        };
    }

    let max_nodes = params.limit.max(1);
    let mut definitions = find_definitions(&snapshot.files, &normalized_symbol);
    definitions.sort_by(|left, right| {
        left.1
            .name
            .cmp(&right.1.name)
            .then_with(|| left.0.path.cmp(&right.0.path))
            .then_with(|| left.1.line.cmp(&right.1.line))
    });

    for (file, symbol) in definitions {
        if nodes.len() >= max_nodes {
            truncated = true;
            break;
        }
        let node_id = format!(
            "def:{}:{}:{}:{}",
            file.path, symbol.line, symbol.column, symbol.name
        );
        if node_ids.insert(node_id.clone()) {
            nodes.push(CodeGraphNode {
                id: node_id.clone(),
                kind: "definition".to_string(),
                name: symbol.name.clone(),
                file_path: file.path.clone(),
                line: symbol.line,
                column: symbol.column,
                language: symbol.language.clone(),
            });
        }

        if params.depth > 0 {
            let remaining = max_nodes.saturating_sub(nodes.len());
            if remaining == 0 {
                truncated = true;
                break;
            }
            let (references, reference_truncated) =
                find_references(&snapshot.files, &symbol.name, &node_id, remaining);
            if reference_truncated {
                truncated = true;
            }
            for (node, edge) in references {
                if nodes.len() >= max_nodes {
                    truncated = true;
                    break;
                }
                if node_ids.insert(node.id.clone()) {
                    nodes.push(node);
                    edges.push(edge);
                }
            }
        }
    }

    let semantic_coverage = if nodes.is_empty() { 0.0 } else { 1.0 };
    CodeGraphExpandResponse {
        symbol: params.symbol.clone(),
        nodes,
        edges,
        meta: CodeGraphMeta {
            truncated,
            elapsed_ms: started_at.elapsed().as_millis() as u64,
            semantic_coverage,
        },
    }
}

fn find_definitions<'a>(
    files: &'a [IndexedFile],
    normalized_symbol: &str,
) -> Vec<(&'a IndexedFile, &'a crate::types::IndexedSymbol)> {
    let mut definitions = Vec::new();
    for file in files {
        for symbol in &file.symbols {
            if symbol.name.to_lowercase().contains(normalized_symbol) {
                definitions.push((file, symbol));
            }
        }
    }
    definitions
}

fn find_references(
    files: &[IndexedFile],
    symbol_name: &str,
    source_node_id: &str,
    limit: usize,
) -> (Vec<(CodeGraphNode, CodeGraphEdge)>, bool) {
    let Some(matcher) = build_word_matcher(symbol_name) else {
        return (Vec::new(), false);
    };
    let mut searcher = line_searcher();

    let mut references = Vec::new();
    let mut truncated = false;
    for file in files {
        if references.len() >= limit {
            truncated = true;
            break;
        }
        let mut sink = ReferenceSink {
            matcher: &matcher,
            symbol_name,
            source_node_id,
            file_path: &file.path,
            language: language_for_file(file),
            out: &mut references,
            limit,
            truncated: false,
        };
        // Files removed since indexing surface as IO errors; skip them.
        let _ = searcher.search_path(&matcher, &file.path, &mut sink);
        if sink.truncated {
            truncated = true;
            break;
        }
    }

    (references, truncated)
}

struct ReferenceSink<'a> {
    matcher: &'a grep_regex::RegexMatcher,
    symbol_name: &'a str,
    source_node_id: &'a str,
    file_path: &'a str,
    language: String,
    out: &'a mut Vec<(CodeGraphNode, CodeGraphEdge)>,
    limit: usize,
    truncated: bool,
}

impl Sink for ReferenceSink<'_> {
    type Error = std::io::Error;

    fn matched(
        &mut self,
        _searcher: &Searcher,
        sink_match: &SinkMatch<'_>,
    ) -> Result<bool, std::io::Error> {
        let line_number = sink_match.line_number().unwrap_or(0);
        // Recover the byte column within the matched line for parity with the
        // previous `matched.start() + 1` behaviour.
        let column = self
            .matcher
            .find(sink_match.bytes())
            .ok()
            .flatten()
            .map(|m| m.start() as u32 + 1)
            .unwrap_or(1);
        let node_id = format!(
            "ref:{}:{}:{}:{}",
            self.file_path, line_number, column, self.symbol_name
        );
        let node = CodeGraphNode {
            id: node_id.clone(),
            kind: "reference".to_string(),
            name: self.symbol_name.to_string(),
            file_path: self.file_path.to_string(),
            line: line_number as u32,
            column,
            language: self.language.clone(),
        };
        let edge = CodeGraphEdge {
            from: self.source_node_id.to_string(),
            to: node_id,
            relation: "references".to_string(),
            confidence: 0.7,
        };
        self.out.push((node, edge));
        if self.out.len() >= self.limit {
            self.truncated = true;
            return Ok(false);
        }
        Ok(true)
    }
}

fn language_for_file(file: &IndexedFile) -> String {
    file.symbols
        .first()
        .map(|value| value.language.clone())
        .unwrap_or_else(|| "plaintext".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{CodeGraphExpandParams, IndexedSymbol, INDEX_VERSION};
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    fn indexed_file(dir: &Path, name: &str, contents: &str, symbols: Vec<IndexedSymbol>) -> IndexedFile {
        let path = dir.join(name);
        fs::write(&path, contents).unwrap();
        IndexedFile {
            path: path.to_string_lossy().to_string(),
            relative_path: name.to_string(),
            file_name: name.to_string(),
            extension: Path::new(name)
                .extension()
                .map(|e| e.to_string_lossy().to_string()),
            modified_at: 0,
            size_bytes: contents.len() as u64,
            symbols,
        }
    }

    #[test]
    fn expand_finds_definition_and_references() {
        let dir = TempDir::new().unwrap();
        let def = indexed_file(
            dir.path(),
            "def.rs",
            "pub fn Foo() {}\n",
            vec![IndexedSymbol {
                name: "Foo".to_string(),
                kind: "function".to_string(),
                line: 1,
                column: 8,
                language: "rust".to_string(),
            }],
        );
        let usage = indexed_file(dir.path(), "use.rs", "fn caller() {\n    Foo();\n}\n", Vec::new());
        let snapshot = IndexSnapshot {
            version: INDEX_VERSION,
            roots: vec![dir.path().to_string_lossy().to_string()],
            include_hidden: false,
            indexed_at: 0,
            indexed_dirs: 0,
            truncated: false,
            files: vec![def, usage],
        };

        let response = expand_graph(
            &snapshot,
            &CodeGraphExpandParams {
                symbol: "Foo".to_string(),
                roots: vec![dir.path().to_path_buf()],
                include_hidden: false,
                depth: 1,
                limit: 80,
            },
        );

        let definition = response
            .nodes
            .iter()
            .find(|node| node.kind == "definition")
            .expect("definition node");
        assert_eq!(definition.name, "Foo");
        assert_eq!(definition.line, 1);
        assert_eq!(definition.column, 8);

        let reference = response
            .nodes
            .iter()
            .find(|node| node.kind == "reference" && node.file_path.ends_with("use.rs"))
            .expect("reference node in use.rs");
        // `Foo()` appears at column 5 of line 2 in use.rs.
        assert_eq!(reference.line, 2);
        assert_eq!(reference.column, 5);
        assert!(response.edges.iter().any(|edge| edge.relation == "references"));
    }
}
