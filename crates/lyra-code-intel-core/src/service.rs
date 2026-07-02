use crate::engine::CodeGraphEngine;
use crate::status::IndexStatus;
use crate::types::*;
use glob::Pattern;
use regex::RegexBuilder;
use std::collections::{HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::Instant;

pub struct CodeIntelService {
    engine: CodeGraphEngine,
    last_root: RwLock<Option<PathBuf>>,
}

impl CodeIntelService {
    pub fn new(storage_root: impl AsRef<Path>) -> Self {
        Self {
            engine: CodeGraphEngine::new(storage_root.as_ref().to_path_buf()),
            last_root: RwLock::new(None),
        }
    }

    pub fn index_status(&self) -> CodeIndexStatus {
        let root = self.last_root.read().ok().and_then(|guard| guard.clone());
        root.as_deref()
            .map(|root| status_for(self.engine.status_sync(root)))
            .unwrap_or_else(idle_status)
    }

    pub fn rebuild_index(
        &self,
        request: CodeIndexRebuildParams,
    ) -> Result<CodeIndexRebuildResponse, String> {
        let root = first_root(&request.roots)?;
        *self
            .last_root
            .write()
            .map_err(|_| "code index root lock poisoned".to_string())? = Some(root.clone());
        if request.force {
            self.engine.rebuild_project_sync(root.clone())?;
        } else {
            self.engine.index_project_sync(root.clone())?;
        }
        Ok(CodeIndexRebuildResponse {
            status: status_for(self.engine.status_sync(&root)),
            roots: request
                .roots
                .iter()
                .map(|path| path.display().to_string())
                .collect(),
            truncated: false,
        })
    }

    pub fn search_text(
        &self,
        request: CodeSearchTextParams,
    ) -> Result<CodeSearchTextResponse, String> {
        let started = Instant::now();
        let root = first_root(&request.roots)?;
        let matcher = TextMatcher::new(
            &request.query,
            request.case_sensitive,
            request.regex,
            request.glob.as_deref(),
        )?;
        let mut matches = Vec::new();
        let mut truncated = false;

        for path in source_files(&request.roots, request.include_hidden) {
            if matches.len() >= request.limit {
                truncated = true;
                break;
            }
            if !matcher.path_matches(&path) {
                continue;
            }
            let Ok(text) = fs::read_to_string(&path) else {
                continue;
            };
            for (index, line) in text.lines().enumerate() {
                if matcher.line_matches(line) {
                    matches.push(CodeSearchTextMatch {
                        path: path.display().to_string(),
                        relative_path: relative_path(&root, &path),
                        line: (index + 1) as u32,
                        excerpt: truncate(line.trim(), 240),
                    });
                    if matches.len() >= request.limit {
                        truncated = true;
                        break;
                    }
                }
            }
        }

        Ok(CodeSearchTextResponse {
            query: request.query,
            root_path: root.display().to_string(),
            case_sensitive: request.case_sensitive,
            truncated,
            elapsed_ms: started.elapsed().as_millis() as u64,
            used_index: false,
            matches,
        })
    }

    pub fn search_symbol(
        &self,
        request: CodeSearchSymbolParams,
    ) -> Result<CodeSearchSymbolResponse, String> {
        let started = Instant::now();
        let root = first_root(&request.roots)?;
        remember_root(&self.last_root, &root)?;
        let symbols = self
            .engine
            .search_symbols_sync(&root, &request.query, request.limit)?
            .into_iter()
            .filter(|symbol| {
                request
                    .kind
                    .as_deref()
                    .is_none_or(|kind| symbol.symbol.kind.eq_ignore_ascii_case(kind))
            })
            .filter(|symbol| {
                request.language.as_deref().is_none_or(|language| {
                    language_for_path(&symbol.symbol.location.file).eq_ignore_ascii_case(language)
                })
            })
            .map(|symbol| CodeSearchSymbolMatch {
                name: symbol.symbol.name,
                kind: symbol.symbol.kind,
                file_path: symbol.symbol.location.file.clone(),
                relative_path: relative_path(&root, Path::new(&symbol.symbol.location.file)),
                line: symbol.symbol.location.line,
                column: symbol.symbol.location.column,
                language: language_for_path(&symbol.symbol.location.file),
            })
            .collect::<Vec<_>>();

        Ok(CodeSearchSymbolResponse {
            query: request.query,
            root_path: root.display().to_string(),
            truncated: symbols.len() >= request.limit,
            elapsed_ms: started.elapsed().as_millis() as u64,
            used_index: true,
            symbols,
        })
    }

    pub fn expand_graph(
        &self,
        request: CodeGraphExpandParams,
    ) -> Result<CodeGraphExpandResponse, String> {
        let root = first_root(&request.roots)?;
        remember_root(&self.last_root, &root)?;
        let result = self
            .engine
            .explore_sync(&root, &request.symbol, request.limit)?;
        let mut nodes = Vec::new();
        let mut edges = Vec::new();
        let mut seen = HashSet::new();

        for item in result.symbols {
            let root_id = node_id_for_symbol(&item.symbol);
            push_node(&mut nodes, &mut seen, root_id.clone(), &item.symbol);
            for caller in item.callers {
                let caller_id = caller.node_id.to_string();
                push_node(&mut nodes, &mut seen, caller_id.clone(), &caller.symbol);
                edges.push(CodeGraphEdge {
                    from: caller_id,
                    to: root_id.clone(),
                    relation: "calls".to_string(),
                    confidence: 1.0,
                });
            }
            for callee in item.callees {
                let callee_id = callee.node_id.to_string();
                push_node(&mut nodes, &mut seen, callee_id.clone(), &callee.symbol);
                edges.push(CodeGraphEdge {
                    from: root_id.clone(),
                    to: callee_id,
                    relation: "calls".to_string(),
                    confidence: 1.0,
                });
            }
        }

        for edge in result.synthesized_edges {
            edges.push(CodeGraphEdge {
                from: edge.from_node_id.to_string(),
                to: edge.to_node_id.to_string(),
                relation: edge.edge_type,
                confidence: 0.75,
            });
        }

        Ok(CodeGraphExpandResponse {
            symbol: request.symbol,
            nodes,
            edges,
            meta: CodeGraphMeta {
                truncated: false,
                elapsed_ms: result.elapsed_ms,
                semantic_coverage: 1.0,
            },
        })
    }
}

fn remember_root(lock: &RwLock<Option<PathBuf>>, root: &Path) -> Result<(), String> {
    *lock
        .write()
        .map_err(|_| "code index root lock poisoned".to_string())? = Some(root.to_path_buf());
    Ok(())
}

fn first_root(roots: &[PathBuf]) -> Result<PathBuf, String> {
    roots
        .first()
        .cloned()
        .ok_or_else(|| "at least one root is required".to_string())
}

fn status_for(status: IndexStatus) -> CodeIndexStatus {
    match status {
        IndexStatus::Idle => idle_status(),
        IndexStatus::Indexing { progress } => CodeIndexStatus {
            state: CodeIndexState::Building,
            indexed_files: 0,
            indexed_dirs: 0,
            last_built_at: None,
            progress: Some(progress),
            error: None,
        },
        IndexStatus::Ready {
            file_count,
            symbol_count: _,
        } => CodeIndexStatus {
            state: CodeIndexState::Ready,
            indexed_files: file_count,
            indexed_dirs: 0,
            last_built_at: None,
            progress: Some(1.0),
            error: None,
        },
        IndexStatus::Failed { error } => CodeIndexStatus {
            state: CodeIndexState::Failed,
            indexed_files: 0,
            indexed_dirs: 0,
            last_built_at: None,
            progress: None,
            error: Some(error),
        },
    }
}

fn idle_status() -> CodeIndexStatus {
    CodeIndexStatus {
        state: CodeIndexState::Idle,
        indexed_files: 0,
        indexed_dirs: 0,
        last_built_at: None,
        progress: None,
        error: None,
    }
}

struct TextMatcher {
    query: String,
    case_sensitive: bool,
    regex: Option<regex::Regex>,
    glob: Option<Pattern>,
}

impl TextMatcher {
    fn new(
        query: &str,
        case_sensitive: bool,
        regex: bool,
        glob: Option<&str>,
    ) -> Result<Self, String> {
        let compiled = if regex {
            Some(
                RegexBuilder::new(query)
                    .case_insensitive(!case_sensitive)
                    .build()
                    .map_err(|error| format!("invalid regex: {error}"))?,
            )
        } else {
            None
        };
        let glob = glob
            .map(Pattern::new)
            .transpose()
            .map_err(|error| format!("invalid glob: {error}"))?;
        Ok(Self {
            query: if case_sensitive {
                query.to_string()
            } else {
                query.to_ascii_lowercase()
            },
            case_sensitive,
            regex: compiled,
            glob,
        })
    }

    fn line_matches(&self, line: &str) -> bool {
        if let Some(regex) = &self.regex {
            return regex.is_match(line);
        }
        if self.case_sensitive {
            line.contains(&self.query)
        } else {
            line.to_ascii_lowercase().contains(&self.query)
        }
    }

    fn path_matches(&self, path: &Path) -> bool {
        self.glob
            .as_ref()
            .is_none_or(|glob| glob.matches_path(path))
    }
}

fn source_files(roots: &[PathBuf], include_hidden: bool) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut queue = roots.iter().cloned().collect::<VecDeque<_>>();
    while let Some(path) = queue.pop_front() {
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        if metadata.is_file() {
            files.push(path);
            continue;
        }
        if !metadata.is_dir() {
            continue;
        }
        let Ok(entries) = fs::read_dir(&path) else {
            continue;
        };
        for entry in entries.flatten() {
            let child = entry.path();
            let name = child
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            if (!include_hidden && name.starts_with('.')) || excluded_dir(name) {
                continue;
            }
            queue.push_back(child);
        }
    }
    files
}

fn excluded_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules" | "target" | "dist" | "build" | "coverage" | ".git"
    )
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .display()
        .to_string()
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn language_for_path(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("unknown")
        .to_string()
}

fn node_id_for_symbol(symbol: &codegraph_server::ai_query::SymbolInfo) -> String {
    format!(
        "{}:{}:{}",
        symbol.location.file, symbol.location.line, symbol.name
    )
}

fn push_node(
    nodes: &mut Vec<CodeGraphNode>,
    seen: &mut HashSet<String>,
    id: String,
    symbol: &codegraph_server::ai_query::SymbolInfo,
) {
    if !seen.insert(id.clone()) {
        return;
    }
    nodes.push(CodeGraphNode {
        id,
        kind: symbol.kind.clone(),
        name: symbol.name.clone(),
        file_path: symbol.location.file.clone(),
        line: symbol.location.line,
        column: symbol.location.column,
        language: language_for_path(&symbol.location.file),
    });
}
