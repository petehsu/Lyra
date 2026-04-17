use crate::types::{
    CodeGraphEdge, CodeGraphExpandParams, CodeGraphExpandResponse, CodeGraphMeta, CodeGraphNode,
    IndexSnapshot, IndexedFile,
};
use regex::Regex;
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
    let escaped = regex::escape(symbol_name);
    let Ok(pattern) = Regex::new(&format!(r"\b{escaped}\b")) else {
        return (Vec::new(), false);
    };

    let mut references = Vec::new();
    let mut truncated = false;
    for file in files {
        for (line_index, line) in file.content.lines().enumerate() {
            if references.len() >= limit {
                truncated = true;
                break;
            }
            let Some(matched) = pattern.find(line) else {
                continue;
            };
            let node_id = format!(
                "ref:{}:{}:{}:{}",
                file.path,
                line_index + 1,
                matched.start() + 1,
                symbol_name
            );
            let node = CodeGraphNode {
                id: node_id.clone(),
                kind: "reference".to_string(),
                name: symbol_name.to_string(),
                file_path: file.path.clone(),
                line: line_index as u32 + 1,
                column: matched.start() as u32 + 1,
                language: language_for_file(file),
            };
            let edge = CodeGraphEdge {
                from: source_node_id.to_string(),
                to: node_id,
                relation: "references".to_string(),
                confidence: 0.7,
            };
            references.push((node, edge));
        }
        if truncated {
            break;
        }
    }

    (references, truncated)
}

fn language_for_file(file: &IndexedFile) -> String {
    file.symbols
        .first()
        .map(|value| value.language.clone())
        .unwrap_or_else(|| "plaintext".to_string())
}
