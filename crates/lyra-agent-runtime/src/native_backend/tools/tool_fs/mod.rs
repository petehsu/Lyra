use super::*;
use lyra_tool_fs_core::{
    DEFAULT_TOOL_TIMEOUT_MS, PROVIDER_VISIBLE_TOOL_NAMES, TOOL_FS_INSPECT, TOOL_FS_LIST,
    TOOL_FS_READ_DOC, TOOL_FS_RUN, TOOL_FS_SCHEMA_VERSION, TOOL_FS_SEARCH, ToolChangeRecord,
    ToolFsError, ToolFsRegistry, ToolManifest, ToolManifestProvider, ToolOperationContext,
    ToolOperationEnvelope, ToolResultEnvelope, ToolScene, ToolTraceRecord, attach_schema_id,
    provider_tool_names,
};
use std::collections::BTreeMap;

const MAX_TOOL_FS_RAW_CHARS: usize = 32_000;
const MAX_TOOL_FS_CONTENT_CHARS: usize = 16_000;
const LOCAL_CODE_SEARCH_TOOL_PATHS: [&str; 3] = [
    "/tools/code/search_project",
    "/tools/code/search_code",
    "/tools/code/search_symbol",
];

mod execute;
mod operation;
mod provider_tools;
mod registry;
mod result;
mod target;
mod usage_cache;

use operation::*;
use registry::*;
use result::*;
use target::*;
use usage_cache::*;

pub(crate) use execute::execute_tool_fs_model_tool;
pub(crate) use provider_tools::{is_tool_fs_model_tool, model_provider_tools, model_tool_names};
pub(crate) use provider_tools::{pinned_handles_for_scene, root_summary_for_scene};
pub(crate) use registry::{
    runtime_manifest_source_summary, runtime_registry, runtime_registry_with_dispatcher,
};
pub(crate) use target::{RuntimeToolTarget, path_for_activity, runtime_target_for_manifest};
pub(crate) use usage_cache::{
    cached_handles_for_scene, inspected_descriptors_for_session, presearch_hints_for_message,
};

fn is_local_code_search_tool_path(path: &str) -> bool {
    let normalized = lyra_tool_fs_core::normalize_tool_path(path);
    LOCAL_CODE_SEARCH_TOOL_PATHS.contains(&normalized.as_str())
}

fn local_code_search_tools_available() -> bool {
    lyra_search_core::search_index_ready(None).unwrap_or(false)
}

fn local_code_search_unavailable_diagnostics() -> Vec<Value> {
    vec![json!({
        "code": "local_search_index_not_ready",
        "domain": "code",
        "message": "Local code search tools are hidden until the native V3 local search index is ready.",
        "recoverable": true,
    })]
}

fn local_code_search_unavailable_failure(tool_path: &str) -> NativeToolFailure {
    NativeToolFailure::new(
        "local_search_index_not_ready",
        format!("Tool-FS target {tool_path} is unavailable until the native V3 local search index is ready."),
        "Wait for local indexing to finish, then search or inspect Tool-FS again.",
    )
    .with_detail(json!({
        "toolPath": tool_path,
        "engine": "local-search-v3",
    }))
}
