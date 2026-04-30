use crate::error_code::INTERNAL_ERROR_CODE;
use crate::error_code::INVALID_REQUEST_ERROR_CODE;
use lyra_app_server_protocol as api;
use lyra_local_search as search;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use tokio::sync::Mutex;

const DEFAULT_LOCAL_SEARCH_LIMIT: usize = 50;
const DEFAULT_TEXT_LIMIT_BYTES: u64 = 1_000_000;
const DEFAULT_READ_LIMIT_BYTES: usize = 200_000;

#[derive(Clone, Default)]
pub(crate) struct LocalSearchService {
    engine: Arc<search::LocalSearchEngine>,
    pending_searches: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl LocalSearchService {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn engine(&self) -> Arc<search::LocalSearchEngine> {
        self.engine.clone()
    }

    pub(crate) async fn status(
        &self,
        params: api::LocalSearchStatusParams,
    ) -> Result<api::LocalSearchStatusResponse, api::JSONRPCErrorError> {
        let mut status = to_api_status(self.engine.status());
        if !params.roots.is_empty() {
            let requested = params
                .roots
                .iter()
                .map(|root| PathBuf::from(root).to_string_lossy().to_string())
                .collect::<Vec<_>>();
            status.roots.retain(|root| requested.contains(&root.root));
        }
        Ok(api::LocalSearchStatusResponse { status })
    }

    pub(crate) async fn index_root(
        &self,
        params: api::LocalSearchIndexRootParams,
    ) -> Result<api::LocalSearchIndexRootResponse, api::JSONRPCErrorError> {
        if params.root.trim().is_empty() {
            return Err(invalid_request("root must not be empty"));
        }
        let engine = self.engine.clone();
        let options = search::LocalSearchIndexRootOptions {
            root: PathBuf::from(params.root),
            include_hidden: params.include_hidden.unwrap_or(false),
            include_vendor: params.include_vendor.unwrap_or(false),
            respect_gitignore: params.respect_gitignore.unwrap_or(true),
            content_mode: params
                .content_mode
                .map(to_core_content_mode)
                .unwrap_or(search::LocalSearchContentMode::Auto),
            max_file_size_bytes: params
                .max_file_size_bytes
                .unwrap_or(DEFAULT_TEXT_LIMIT_BYTES),
        };
        let status = tokio::task::spawn_blocking(move || engine.index_root(options, None))
            .await
            .map_err(|error| internal_error(format!("local search index task failed: {error}")))?
            .map_err(|error| internal_error(format!("local search index failed: {error}")))?;
        Ok(api::LocalSearchIndexRootResponse {
            status: to_api_status(status),
        })
    }

    pub(crate) async fn search(
        &self,
        params: api::LocalSearchSearchParams,
    ) -> Result<api::LocalSearchSearchResponse, api::JSONRPCErrorError> {
        let cancel_flag = self
            .cancel_flag_for_token(params.cancellation_token.as_deref())
            .await;
        let token = params.cancellation_token.clone();
        let engine = self.engine.clone();
        let options = search::LocalSearchOptions {
            query: params.query.clone(),
            roots: params.roots.iter().map(PathBuf::from).collect(),
            kinds: params.kinds.into_iter().map(to_core_kind).collect(),
            extensions: params.extensions,
            limit: params.limit.unwrap_or(DEFAULT_LOCAL_SEARCH_LIMIT),
            include_hidden: params.include_hidden.unwrap_or(false),
            include_vendor: params.include_vendor.unwrap_or(false),
            respect_gitignore: params.respect_gitignore.unwrap_or(true),
            content_mode: params
                .content_mode
                .map(to_core_content_mode)
                .unwrap_or(search::LocalSearchContentMode::Auto),
            max_file_size_bytes: params
                .max_file_size_bytes
                .unwrap_or(DEFAULT_TEXT_LIMIT_BYTES),
            enable_fuzzy: true,
            enable_extension_match: true,
        };

        let response = tokio::task::spawn_blocking({
            let cancel_flag = cancel_flag.clone();
            move || engine.search(options, Some(cancel_flag))
        })
        .await
        .map_err(|error| internal_error(format!("local search task failed: {error}")))?
        .map_err(|error| internal_error(format!("local search failed: {error}")))?;

        if let Some(token) = token {
            self.clear_cancel_flag(&token, &cancel_flag).await;
        }

        Ok(to_api_search_response(response))
    }

    pub(crate) async fn read_result(
        &self,
        params: api::LocalSearchReadResultParams,
    ) -> Result<api::LocalSearchReadResultResponse, api::JSONRPCErrorError> {
        if params.path.trim().is_empty() {
            return Err(invalid_request("path must not be empty"));
        }
        let engine = self.engine.clone();
        let options = search::LocalSearchReadOptions {
            root: params.root.map(PathBuf::from),
            path: PathBuf::from(params.path),
            offset: params.offset.unwrap_or(0),
            max_bytes: params.max_bytes.unwrap_or(DEFAULT_READ_LIMIT_BYTES),
        };
        let response = tokio::task::spawn_blocking(move || engine.read_result(options))
            .await
            .map_err(|error| internal_error(format!("local search read task failed: {error}")))?
            .map_err(|error| internal_error(format!("local search read failed: {error}")))?;
        Ok(api::LocalSearchReadResultResponse {
            path: response.path.to_string_lossy().to_string(),
            offset: response.offset,
            bytes_read: response.bytes_read,
            contents: response.contents,
            truncated: response.truncated,
        })
    }

    pub(crate) async fn extract_text(
        &self,
        params: api::LocalSearchExtractTextParams,
    ) -> Result<api::LocalSearchExtractTextResponse, api::JSONRPCErrorError> {
        if params.path.trim().is_empty() {
            return Err(invalid_request("path must not be empty"));
        }
        let engine = self.engine.clone();
        let options = search::LocalSearchExtractTextOptions {
            path: PathBuf::from(params.path),
            max_bytes: params.max_bytes.unwrap_or(DEFAULT_READ_LIMIT_BYTES),
        };
        let response = tokio::task::spawn_blocking(move || engine.extract_text(options))
            .await
            .map_err(|error| internal_error(format!("local text extraction task failed: {error}")))?
            .map_err(|error| internal_error(format!("local text extraction failed: {error}")))?;
        Ok(api::LocalSearchExtractTextResponse {
            path: response.path.to_string_lossy().to_string(),
            text: response.text,
            truncated: response.truncated,
            extraction_method: response.extraction_method,
        })
    }

    async fn cancel_flag_for_token(&self, token: Option<&str>) -> Arc<AtomicBool> {
        let Some(token) = token.filter(|token| !token.trim().is_empty()) else {
            return Arc::new(AtomicBool::new(false));
        };
        let mut pending = self.pending_searches.lock().await;
        if let Some(existing) = pending.get(token) {
            existing.store(true, Ordering::Relaxed);
        }
        let flag = Arc::new(AtomicBool::new(false));
        pending.insert(token.to_string(), flag.clone());
        flag
    }

    async fn clear_cancel_flag(&self, token: &str, flag: &Arc<AtomicBool>) {
        let mut pending = self.pending_searches.lock().await;
        if let Some(current) = pending.get(token)
            && Arc::ptr_eq(current, flag)
        {
            pending.remove(token);
        }
    }
}

fn to_api_search_response(response: search::LocalSearchResponse) -> api::LocalSearchSearchResponse {
    api::LocalSearchSearchResponse {
        query: response.query,
        roots: response
            .roots
            .into_iter()
            .map(|root| root.to_string_lossy().to_string())
            .collect(),
        results: response.results.into_iter().map(to_api_result).collect(),
        total_match_count: response.total_match_count,
        truncated: response.truncated,
        index_state: to_api_index_state(response.index_state),
    }
}

fn to_api_result(result: search::LocalSearchResult) -> api::LocalSearchResult {
    api::LocalSearchResult {
        path: result.path.to_string_lossy().to_string(),
        display_path: result.display_path,
        root: result.root.to_string_lossy().to_string(),
        kind: to_api_kind(result.kind),
        score: result.score,
        source: to_api_source(result.source),
        match_kind: to_api_match_kind(result.match_kind),
        snippet: result.snippet,
        metadata: result.metadata.map(to_api_metadata),
        index_state: to_api_index_state(result.index_state),
    }
}

fn to_api_metadata(metadata: search::LocalSearchMetadata) -> api::LocalSearchMetadata {
    api::LocalSearchMetadata {
        extension: metadata.extension,
        size_bytes: metadata.size_bytes,
        modified_at: metadata.modified_at,
        created_at: metadata.created_at,
        hidden: metadata.hidden,
    }
}

fn to_api_status(status: search::LocalSearchStatus) -> api::LocalSearchStatus {
    api::LocalSearchStatus {
        state: to_api_index_state(status.state),
        roots: status
            .roots
            .into_iter()
            .map(|root| api::LocalSearchRootStatus {
                root: root.root.to_string_lossy().to_string(),
                state: to_api_index_state(root.state),
                indexed_file_count: root.indexed_file_count,
                indexed_dir_count: root.indexed_dir_count,
                indexed_content_file_count: root.indexed_content_file_count,
                last_indexed_at: root.last_indexed_at,
                error: root.error,
            })
            .collect(),
        indexed_file_count: status.indexed_file_count,
        indexed_dir_count: status.indexed_dir_count,
        indexed_content_file_count: status.indexed_content_file_count,
        sqlite_fts_available: status.sqlite_fts_available,
    }
}

fn to_core_kind(kind: api::LocalSearchKind) -> search::LocalSearchKind {
    match kind {
        api::LocalSearchKind::File => search::LocalSearchKind::File,
        api::LocalSearchKind::Directory => search::LocalSearchKind::Directory,
    }
}

fn to_api_kind(kind: search::LocalSearchKind) -> api::LocalSearchKind {
    match kind {
        search::LocalSearchKind::File => api::LocalSearchKind::File,
        search::LocalSearchKind::Directory => api::LocalSearchKind::Directory,
    }
}

fn to_core_content_mode(mode: api::LocalSearchContentMode) -> search::LocalSearchContentMode {
    match mode {
        api::LocalSearchContentMode::Disabled => search::LocalSearchContentMode::Disabled,
        api::LocalSearchContentMode::Auto => search::LocalSearchContentMode::Auto,
        api::LocalSearchContentMode::Required => search::LocalSearchContentMode::Required,
    }
}

fn to_api_source(source: search::LocalSearchSource) -> api::LocalSearchSource {
    match source {
        search::LocalSearchSource::Index => api::LocalSearchSource::Index,
        search::LocalSearchSource::Walker => api::LocalSearchSource::Walker,
        search::LocalSearchSource::Content => api::LocalSearchSource::Content,
        search::LocalSearchSource::Symbol => api::LocalSearchSource::Symbol,
    }
}

fn to_api_match_kind(kind: search::LocalSearchMatchKind) -> api::LocalSearchMatchKind {
    match kind {
        search::LocalSearchMatchKind::Initial => api::LocalSearchMatchKind::Initial,
        search::LocalSearchMatchKind::FileName => api::LocalSearchMatchKind::FileName,
        search::LocalSearchMatchKind::Path => api::LocalSearchMatchKind::Path,
        search::LocalSearchMatchKind::Extension => api::LocalSearchMatchKind::Extension,
        search::LocalSearchMatchKind::Content => api::LocalSearchMatchKind::Content,
        search::LocalSearchMatchKind::Metadata => api::LocalSearchMatchKind::Metadata,
        search::LocalSearchMatchKind::Fuzzy => api::LocalSearchMatchKind::Fuzzy,
    }
}

fn to_api_index_state(state: search::LocalSearchIndexState) -> api::LocalSearchIndexState {
    match state {
        search::LocalSearchIndexState::Empty => api::LocalSearchIndexState::Empty,
        search::LocalSearchIndexState::Indexing => api::LocalSearchIndexState::Indexing,
        search::LocalSearchIndexState::Ready => api::LocalSearchIndexState::Ready,
        search::LocalSearchIndexState::Partial => api::LocalSearchIndexState::Partial,
        search::LocalSearchIndexState::Failed => api::LocalSearchIndexState::Failed,
        search::LocalSearchIndexState::Walker => api::LocalSearchIndexState::Walker,
    }
}

fn invalid_request(message: impl Into<String>) -> api::JSONRPCErrorError {
    api::JSONRPCErrorError {
        code: INVALID_REQUEST_ERROR_CODE,
        message: message.into(),
        data: None,
    }
}

fn internal_error(message: impl Into<String>) -> api::JSONRPCErrorError {
    api::JSONRPCErrorError {
        code: INTERNAL_ERROR_CODE,
        message: message.into(),
        data: None,
    }
}
