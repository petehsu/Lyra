mod catalog;
mod error;
mod model;
mod operation;
mod registry;
mod scene;
mod schema;
mod search;

pub use catalog::domain_summary;
pub use error::ToolFsError;
pub use model::{
    DEFAULT_TOOL_TIMEOUT_MS, MAX_TOOL_TIMEOUT_MS, PROVIDER_VISIBLE_TOOL_NAMES, PinnedToolHandle,
    ResolvedToolRun, TOOL_FS_INSPECT, TOOL_FS_LIST, TOOL_FS_READ_DOC, TOOL_FS_RUN,
    TOOL_FS_SCHEMA_VERSION, TOOL_FS_SEARCH, ToolChangeRecord, ToolDirectory, ToolDirectoryEntry,
    ToolManifest, ToolManifestProvider, ToolResultEnvelope, ToolSearchResponse, ToolSearchResult,
    provider_tool_names,
};
pub use operation::{
    ToolOperationContext, ToolOperationEnvelope, ToolTraceRecord, new_operation_envelope,
};
pub use registry::{ToolFsRegistry, normalize_tool_path};
pub use scene::{ToolScene, ToolSceneSignals, infer_scene};
pub use schema::{attach_schema_id, schema_id_for_path};
