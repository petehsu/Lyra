use crate::graph_engine;
use crate::scanner::{normalize_path, read_text_file, scan_workspace};
use crate::storage::{load_snapshot, save_snapshot, snapshot_file};
use crate::symbol_index::{extract_symbols, language_from_extension, search_symbols};
use crate::text_index::search_text;
use crate::types::{
    CodeGraphExpandParams, CodeGraphExpandResponse, CodeIndexRebuildParams,
    CodeIndexRebuildResponse, CodeIndexState, CodeIndexStatus, CodeSearchSymbolParams,
    CodeSearchSymbolResponse, CodeSearchTextParams, CodeSearchTextResponse, IndexSnapshot,
    IndexedFile, INDEX_VERSION,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const MAX_INDEX_FILES: usize = 20_000;
const MAX_INDEX_FILE_BYTES: u64 = 256_000;
const DEFAULT_SEARCH_LIMIT: usize = 40;
const MAX_SEARCH_LIMIT: usize = 400;
const DEFAULT_GRAPH_LIMIT: usize = 80;

#[derive(Clone)]
struct ServiceState {
    status: CodeIndexStatus,
    snapshot: Option<Arc<IndexSnapshot>>,
}

pub struct CodeIntelService {
    storage_root: PathBuf,
    state: RwLock<ServiceState>,
}

impl CodeIntelService {
    pub fn new(storage_root: impl AsRef<Path>) -> Self {
        Self {
            storage_root: storage_root.as_ref().to_path_buf(),
            state: RwLock::new(ServiceState {
                status: CodeIndexStatus {
                    state: CodeIndexState::Idle,
                    indexed_files: 0,
                    indexed_dirs: 0,
                    last_built_at: None,
                    progress: None,
                    error: None,
                },
                snapshot: None,
            }),
        }
    }

    pub fn index_status(&self) -> CodeIndexStatus {
        self.state
            .read()
            .map(|guard| guard.status.clone())
            .unwrap_or(CodeIndexStatus {
                state: CodeIndexState::Failed,
                indexed_files: 0,
                indexed_dirs: 0,
                last_built_at: None,
                progress: None,
                error: Some("index state lock poisoned".to_string()),
            })
    }

    pub fn rebuild_index(
        &self,
        request: CodeIndexRebuildParams,
    ) -> Result<CodeIndexRebuildResponse, String> {
        let roots = normalize_roots(request.roots)?;
        let root_strings = roots
            .iter()
            .map(|value| normalize_path(value))
            .collect::<Vec<_>>();

        {
            let mut guard = self
                .state
                .write()
                .map_err(|_| "index state lock poisoned".to_string())?;
            guard.status.state = CodeIndexState::Building;
            guard.status.progress = Some(0.0);
            guard.status.error = None;
        }

        let previous = if request.force {
            None
        } else {
            self.load_matching_snapshot(&root_strings, request.include_hidden)?
        };

        let started_at = Instant::now();
        let (snapshot, status) = build_snapshot(roots, request.include_hidden, previous)?;
        let snapshot_path = snapshot_file(&self.storage_root);
        save_snapshot(&snapshot_path, &snapshot)?;

        let response = CodeIndexRebuildResponse {
            status: status.clone(),
            roots: root_strings,
            truncated: snapshot.truncated,
        };

        let mut guard = self
            .state
            .write()
            .map_err(|_| "index state lock poisoned".to_string())?;
        guard.snapshot = Some(Arc::new(snapshot));
        guard.status = CodeIndexStatus {
            progress: Some(1.0),
            ..status
        };

        let _ = started_at;
        Ok(response)
    }

    pub fn search_text(
        &self,
        mut request: CodeSearchTextParams,
    ) -> Result<CodeSearchTextResponse, String> {
        request.limit = clamp_limit(request.limit, DEFAULT_SEARCH_LIMIT);
        let started_at = Instant::now();
        let snapshot = self.ensure_snapshot(&request.roots, request.include_hidden)?;
        let (matches, truncated) = search_text(
            &snapshot.files,
            &request.query,
            request.case_sensitive,
            request.regex,
            request.glob.as_deref(),
            request.limit,
        );
        let root_path = snapshot.roots.first().cloned().unwrap_or_default();
        Ok(CodeSearchTextResponse {
            query: request.query,
            root_path,
            case_sensitive: request.case_sensitive,
            truncated,
            elapsed_ms: started_at.elapsed().as_millis() as u64,
            used_index: true,
            matches,
        })
    }

    pub fn search_symbol(
        &self,
        mut request: CodeSearchSymbolParams,
    ) -> Result<CodeSearchSymbolResponse, String> {
        request.limit = clamp_limit(request.limit, DEFAULT_SEARCH_LIMIT);
        let started_at = Instant::now();
        let snapshot = self.ensure_snapshot(&request.roots, request.include_hidden)?;
        let (symbols, truncated) = search_symbols(
            &snapshot.files,
            &request.query,
            request.limit,
            request.kind.as_deref(),
            request.language.as_deref(),
        );
        let root_path = snapshot.roots.first().cloned().unwrap_or_default();
        Ok(CodeSearchSymbolResponse {
            query: request.query,
            root_path,
            truncated,
            elapsed_ms: started_at.elapsed().as_millis() as u64,
            used_index: true,
            symbols,
        })
    }

    pub fn expand_graph(
        &self,
        mut request: CodeGraphExpandParams,
    ) -> Result<CodeGraphExpandResponse, String> {
        request.limit = clamp_limit(request.limit, DEFAULT_GRAPH_LIMIT);
        let snapshot = self.ensure_snapshot(&request.roots, request.include_hidden)?;
        Ok(graph_engine::expand_graph(&snapshot, &request))
    }

    fn ensure_snapshot(
        &self,
        roots: &[PathBuf],
        include_hidden: bool,
    ) -> Result<Arc<IndexSnapshot>, String> {
        let normalized_roots = normalize_roots(roots.to_vec())?;
        let root_strings = normalized_roots
            .iter()
            .map(|value| normalize_path(value))
            .collect::<Vec<_>>();

        {
            let guard = self
                .state
                .read()
                .map_err(|_| "index state lock poisoned".to_string())?;
            if let Some(snapshot) = guard.snapshot.as_ref() {
                if snapshot.roots == root_strings && snapshot.include_hidden == include_hidden {
                    return Ok(snapshot.clone());
                }
            }
        }

        if let Some(snapshot) = self.load_matching_snapshot(&root_strings, include_hidden)? {
            let snapshot = Arc::new(snapshot);
            let status = CodeIndexStatus {
                state: CodeIndexState::Ready,
                indexed_files: snapshot.files.len() as u64,
                indexed_dirs: snapshot.indexed_dirs,
                last_built_at: Some(snapshot.indexed_at.to_string()),
                progress: Some(1.0),
                error: None,
            };
            let mut guard = self
                .state
                .write()
                .map_err(|_| "index state lock poisoned".to_string())?;
            guard.snapshot = Some(snapshot.clone());
            guard.status = status;
            return Ok(snapshot);
        }

        self.rebuild_index(CodeIndexRebuildParams {
            roots: normalized_roots,
            include_hidden,
            force: false,
        })?;

        let guard = self
            .state
            .read()
            .map_err(|_| "index state lock poisoned".to_string())?;
        guard
            .snapshot
            .clone()
            .ok_or_else(|| "index rebuild completed without snapshot".to_string())
    }

    fn load_matching_snapshot(
        &self,
        roots: &[String],
        include_hidden: bool,
    ) -> Result<Option<IndexSnapshot>, String> {
        let snapshot_path = snapshot_file(&self.storage_root);
        let Some(snapshot) = load_snapshot(&snapshot_path)? else {
            return Ok(None);
        };
        if snapshot.roots == roots && snapshot.include_hidden == include_hidden {
            return Ok(Some(snapshot));
        }
        Ok(None)
    }
}

fn build_snapshot(
    roots: Vec<PathBuf>,
    include_hidden: bool,
    previous: Option<IndexSnapshot>,
) -> Result<(IndexSnapshot, CodeIndexStatus), String> {
    let scan = scan_workspace(&roots, include_hidden, MAX_INDEX_FILES)?;
    let mut previous_map = HashMap::<String, IndexedFile>::new();
    if let Some(snapshot) = previous {
        for file in snapshot.files {
            previous_map.insert(file.path.clone(), file);
        }
    }

    let mut files = Vec::<IndexedFile>::new();
    for scanned in scan.files {
        let absolute_path = normalize_path(&scanned.path);
        if let Some(previous_file) = previous_map.get(&absolute_path) {
            if previous_file.modified_at == scanned.modified_at
                && previous_file.size_bytes == scanned.size_bytes
            {
                files.push(previous_file.clone());
                continue;
            }
        }

        let Some(content) = read_text_file(&scanned.path, MAX_INDEX_FILE_BYTES) else {
            continue;
        };
        let language = language_from_extension(scanned.extension.as_deref());
        let symbols = extract_symbols(&content, &language, scanned.extension.as_deref());
        // Content is only needed to extract symbols; full-text search reads from
        // disk on demand, so we drop it from the snapshot.
        files.push(IndexedFile {
            path: absolute_path,
            relative_path: scanned.relative_path,
            file_name: scanned.file_name,
            extension: scanned.extension,
            modified_at: scanned.modified_at,
            size_bytes: scanned.size_bytes,
            symbols,
        });
    }

    let roots_as_strings = roots
        .iter()
        .map(|value| normalize_path(value))
        .collect::<Vec<_>>();
    let indexed_at = unix_seconds_now();
    let snapshot = IndexSnapshot {
        version: INDEX_VERSION,
        roots: roots_as_strings.clone(),
        include_hidden,
        indexed_at,
        indexed_dirs: scan.scanned_dirs,
        truncated: scan.truncated,
        files,
    };

    let status = CodeIndexStatus {
        state: CodeIndexState::Ready,
        indexed_files: snapshot.files.len() as u64,
        indexed_dirs: snapshot.indexed_dirs,
        last_built_at: Some(indexed_at.to_string()),
        progress: Some(1.0),
        error: if scan.truncated {
            Some("index truncated at file cap".to_string())
        } else {
            None
        },
    };

    Ok((snapshot, status))
}

fn normalize_roots(roots: Vec<PathBuf>) -> Result<Vec<PathBuf>, String> {
    let mut normalized = Vec::<PathBuf>::new();
    for root in roots {
        let resolved = if root.is_absolute() {
            root
        } else {
            std::env::current_dir()
                .map_err(|error| format!("failed to read current dir: {error}"))?
                .join(root)
        };
        if resolved.exists() == false {
            continue;
        }
        let canonical = resolved
            .canonicalize()
            .unwrap_or_else(|_| resolved.to_path_buf());
        if normalized.contains(&canonical) == false {
            normalized.push(canonical);
        }
    }
    if normalized.is_empty() {
        return Err("resolved index roots are empty".to_string());
    }
    Ok(normalized)
}

fn clamp_limit(value: usize, fallback: usize) -> usize {
    let effective = if value == 0 { fallback } else { value };
    effective.min(MAX_SEARCH_LIMIT).max(1)
}

fn unix_seconds_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{load_snapshot, snapshot_file};
    use std::fs;
    use tempfile::TempDir;

    fn project_dir() -> TempDir {
        let dir = TempDir::new().unwrap();
        // scan_workspace uses `require_git(true)`, so the tree must be a git repo.
        fs::create_dir_all(dir.path().join(".git")).unwrap();
        dir
    }

    #[test]
    fn rebuild_writes_v2_snapshot_without_content() {
        let storage = TempDir::new().unwrap();
        let project = project_dir();
        fs::write(project.path().join("lib.rs"), "pub fn alpha() {}\n").unwrap();

        let service = CodeIntelService::new(storage.path());
        service
            .rebuild_index(CodeIndexRebuildParams {
                roots: vec![project.path().to_path_buf()],
                include_hidden: false,
                force: true,
            })
            .unwrap();

        let snapshot_path = snapshot_file(storage.path());
        assert!(snapshot_path.ends_with("index.v2.json"));
        let snapshot = load_snapshot(&snapshot_path).unwrap().unwrap();
        assert_eq!(snapshot.version, 2);
        assert!(snapshot
            .files
            .iter()
            .any(|file| file.symbols.iter().any(|symbol| symbol.name == "alpha")));
    }

    #[test]
    fn symbol_and_text_search_round_trip() {
        let storage = TempDir::new().unwrap();
        let project = project_dir();
        fs::write(
            project.path().join("lib.rs"),
            "pub fn alpha() {}\n// needle\n",
        )
        .unwrap();
        let service = CodeIntelService::new(storage.path());

        let symbols = service
            .search_symbol(CodeSearchSymbolParams {
                query: "alpha".to_string(),
                roots: vec![project.path().to_path_buf()],
                include_hidden: false,
                limit: 40,
                kind: None,
                language: None,
            })
            .unwrap();
        assert!(symbols.symbols.iter().any(|symbol| symbol.name == "alpha"));

        let text = service
            .search_text(CodeSearchTextParams {
                query: "needle".to_string(),
                roots: vec![project.path().to_path_buf()],
                include_hidden: false,
                glob: None,
                limit: 40,
                case_sensitive: false,
                regex: false,
            })
            .unwrap();
        assert_eq!(text.matches.len(), 1);
        assert_eq!(text.matches[0].line, 2);
    }
}
