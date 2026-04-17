use lyra_code_intel_core::{
    CodeGraphExpandParams, CodeIndexRebuildParams, CodeIntelService, CodeSearchSymbolParams,
    CodeSearchTextParams,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock, RwLock};

static CODE_INTEL_SERVICES: OnceLock<RwLock<HashMap<String, Arc<CodeIntelService>>>> =
    OnceLock::new();

fn code_intel_services() -> &'static RwLock<HashMap<String, Arc<CodeIntelService>>> {
    CODE_INTEL_SERVICES.get_or_init(|| RwLock::new(HashMap::new()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodeStorageRequest {
    storage_root: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodeIndexRebuildRequest {
    storage_root: String,
    #[serde(default)]
    project_root: Option<String>,
    #[serde(default)]
    roots: Vec<String>,
    #[serde(default)]
    include_hidden: Option<bool>,
    #[serde(default)]
    force: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodeSearchTextRequest {
    storage_root: String,
    #[serde(default)]
    query: Option<String>,
    #[serde(default)]
    pattern: Option<String>,
    #[serde(default)]
    project_root: Option<String>,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    roots: Vec<String>,
    #[serde(default)]
    include_hidden: Option<bool>,
    #[serde(default)]
    glob: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default)]
    case_sensitive: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodeSearchSymbolRequest {
    storage_root: String,
    #[serde(default)]
    query: Option<String>,
    #[serde(default)]
    symbol: Option<String>,
    #[serde(default)]
    project_root: Option<String>,
    #[serde(default)]
    roots: Vec<String>,
    #[serde(default)]
    include_hidden: Option<bool>,
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    language: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodeGraphExpandRequest {
    storage_root: String,
    #[serde(default)]
    symbol: Option<String>,
    #[serde(default)]
    query: Option<String>,
    #[serde(default)]
    project_root: Option<String>,
    #[serde(default)]
    roots: Vec<String>,
    #[serde(default)]
    include_hidden: Option<bool>,
    #[serde(default)]
    depth: Option<u8>,
    #[serde(default)]
    limit: Option<usize>,
}

pub fn read_code_index_status_json(request_json: String) -> Result<String, String> {
    let request: CodeStorageRequest =
        serde_json::from_str(&request_json).map_err(|error| format!("invalid request: {error}"))?;
    let service = service_for_storage_root(&request.storage_root)?;
    serde_json::to_string(&service.index_status())
        .map_err(|error| format!("serialize response failed: {error}"))
}

pub fn rebuild_code_index_json(request_json: String) -> Result<String, String> {
    let request: CodeIndexRebuildRequest =
        serde_json::from_str(&request_json).map_err(|error| format!("invalid request: {error}"))?;
    let service = service_for_storage_root(&request.storage_root)?;
    let roots = resolve_roots(request.project_root.as_deref(), &request.roots, None)?;
    let response = service.rebuild_index(CodeIndexRebuildParams {
        roots,
        include_hidden: request.include_hidden.unwrap_or(false),
        force: request.force.unwrap_or(false),
    })?;
    serde_json::to_string(&response).map_err(|error| format!("serialize response failed: {error}"))
}

pub fn search_code_text_json(request_json: String) -> Result<String, String> {
    let request: CodeSearchTextRequest =
        serde_json::from_str(&request_json).map_err(|error| format!("invalid request: {error}"))?;
    let service = service_for_storage_root(&request.storage_root)?;
    let query = request
        .query
        .or(request.pattern)
        .map(|value| value.trim().to_string())
        .filter(|value| value.is_empty() == false)
        .ok_or_else(|| "query is required".to_string())?;
    let roots = resolve_roots(
        request.project_root.as_deref(),
        &request.roots,
        request.path.as_deref(),
    )?;
    let response = service.search_text(CodeSearchTextParams {
        query,
        roots,
        include_hidden: request.include_hidden.unwrap_or(false),
        glob: request.glob,
        limit: request.limit.unwrap_or(40),
        case_sensitive: request.case_sensitive.unwrap_or(false),
    })?;
    serde_json::to_string(&response).map_err(|error| format!("serialize response failed: {error}"))
}

pub fn search_code_symbol_json(request_json: String) -> Result<String, String> {
    let request: CodeSearchSymbolRequest =
        serde_json::from_str(&request_json).map_err(|error| format!("invalid request: {error}"))?;
    let service = service_for_storage_root(&request.storage_root)?;
    let query = request
        .query
        .or(request.symbol)
        .map(|value| value.trim().to_string())
        .filter(|value| value.is_empty() == false)
        .ok_or_else(|| "query is required".to_string())?;
    let roots = resolve_roots(request.project_root.as_deref(), &request.roots, None)?;
    let response = service.search_symbol(CodeSearchSymbolParams {
        query,
        roots,
        include_hidden: request.include_hidden.unwrap_or(false),
        limit: request.limit.unwrap_or(40),
        kind: request.kind,
        language: request.language,
    })?;
    serde_json::to_string(&response).map_err(|error| format!("serialize response failed: {error}"))
}

pub fn expand_code_graph_json(request_json: String) -> Result<String, String> {
    let request: CodeGraphExpandRequest =
        serde_json::from_str(&request_json).map_err(|error| format!("invalid request: {error}"))?;
    let service = service_for_storage_root(&request.storage_root)?;
    let symbol = request
        .symbol
        .or(request.query)
        .map(|value| value.trim().to_string())
        .filter(|value| value.is_empty() == false)
        .ok_or_else(|| "symbol is required".to_string())?;
    let roots = resolve_roots(request.project_root.as_deref(), &request.roots, None)?;
    let response = service.expand_graph(CodeGraphExpandParams {
        symbol,
        roots,
        include_hidden: request.include_hidden.unwrap_or(false),
        depth: request.depth.unwrap_or(1),
        limit: request.limit.unwrap_or(80),
    })?;
    serde_json::to_string(&response).map_err(|error| format!("serialize response failed: {error}"))
}

fn service_for_storage_root(storage_root: &str) -> Result<Arc<CodeIntelService>, String> {
    let trimmed = storage_root.trim();
    if trimmed.is_empty() {
        return Err("storageRoot is required".to_string());
    }
    let key = trimmed.to_string();
    if let Ok(guard) = code_intel_services().read() {
        if let Some(service) = guard.get(&key) {
            return Ok(service.clone());
        }
    }

    std::fs::create_dir_all(trimmed)
        .map_err(|error| format!("failed to create storage root {trimmed}: {error}"))?;
    let service = Arc::new(CodeIntelService::new(trimmed));
    let mut guard = code_intel_services()
        .write()
        .map_err(|_| "code intel service lock poisoned".to_string())?;
    let entry = guard.entry(key).or_insert_with(|| service.clone());
    Ok(entry.clone())
}

fn resolve_roots(
    project_root: Option<&str>,
    roots: &[String],
    path: Option<&str>,
) -> Result<Vec<PathBuf>, String> {
    let mut resolved = Vec::<PathBuf>::new();
    if roots.is_empty() == false {
        for root in roots {
            let trimmed = root.trim();
            if trimmed.is_empty() {
                continue;
            }
            resolved.push(resolve_path(trimmed)?);
        }
    } else if let Some(path) = path {
        let trimmed = path.trim();
        if trimmed.is_empty() == false {
            resolved.push(resolve_path(trimmed)?);
        }
    } else if let Some(project_root) = project_root {
        let trimmed = project_root.trim();
        if trimmed.is_empty() == false {
            resolved.push(resolve_path(trimmed)?);
        }
    } else {
        resolved.push(
            std::env::current_dir()
                .map_err(|error| format!("failed to read current dir: {error}"))?,
        );
    }

    if resolved.is_empty() {
        return Err("resolved roots are empty".to_string());
    }
    Ok(resolved)
}

fn resolve_path(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        return Ok(path);
    }
    Ok(std::env::current_dir()
        .map_err(|error| format!("failed to read current dir: {error}"))?
        .join(path))
}
