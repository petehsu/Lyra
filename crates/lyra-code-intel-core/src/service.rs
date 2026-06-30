// ponytail: stub — real implementation will use codegraph engine in Phase 2.
// All methods return empty/error results. This exists only to keep the workspace
// compiling while codegraph crates are integrated.

use crate::types::*;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

pub struct CodeIntelService {
    _storage_root: PathBuf,
    status: RwLock<CodeIndexStatus>,
}

impl CodeIntelService {
    pub fn new(storage_root: impl AsRef<Path>) -> Self {
        Self {
            _storage_root: storage_root.as_ref().to_path_buf(),
            status: RwLock::new(CodeIndexStatus {
                state: CodeIndexState::Idle,
                indexed_files: 0,
                indexed_dirs: 0,
                last_built_at: None,
                progress: None,
                error: None,
            }),
        }
    }

    pub fn index_status(&self) -> CodeIndexStatus {
        self.status
            .read()
            .map(|g| g.clone())
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
        _request: CodeIndexRebuildParams,
    ) -> Result<CodeIndexRebuildResponse, String> {
        Err("code-intel stub: not implemented yet (codegraph integration pending)".to_string())
    }

    pub fn search_text(
        &self,
        _request: CodeSearchTextParams,
    ) -> Result<CodeSearchTextResponse, String> {
        Err("code-intel stub: not implemented yet (codegraph integration pending)".to_string())
    }

    pub fn search_symbol(
        &self,
        _request: CodeSearchSymbolParams,
    ) -> Result<CodeSearchSymbolResponse, String> {
        Err("code-intel stub: not implemented yet (codegraph integration pending)".to_string())
    }

    pub fn expand_graph(
        &self,
        _request: CodeGraphExpandParams,
    ) -> Result<CodeGraphExpandResponse, String> {
        Err("code-intel stub: not implemented yet (codegraph integration pending)".to_string())
    }
}