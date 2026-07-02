// CodeGraph-backed code intelligence.
//
// `CodeIntelService` is the synchronous compatibility entry point for
// `lyrad`'s older HTTP handlers. `CodeGraphEngine` is the shared engine used
// by both that service and agent-runtime native tools.

mod context;
mod engine;
mod explore;
mod resolution;
mod service;
mod status;
mod types;
mod watcher;

pub use context::ProjectContext;
pub use engine::{CodeGraphEngine, StalenessInfo};
pub use explore::{ExploreResult, ExploreSymbol};
pub use status::IndexStatus;

// Synchronous compatibility service used by lyrad.
pub use service::CodeIntelService;
pub use types::{
    CodeGraphEdge, CodeGraphExpandParams, CodeGraphExpandResponse, CodeGraphMeta, CodeGraphNode,
    CodeIndexRebuildParams, CodeIndexRebuildResponse, CodeIndexState, CodeIndexStatus,
    CodeSearchSymbolMatch, CodeSearchSymbolParams, CodeSearchSymbolResponse, CodeSearchTextMatch,
    CodeSearchTextParams, CodeSearchTextResponse, IndexSnapshot, IndexedFile, IndexedSymbol,
};
