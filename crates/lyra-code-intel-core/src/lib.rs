// Phase 2: codegraph-backed code intelligence.
//
// The old `CodeIntelService` stub (`service.rs` + `types.rs`) is retained
// for `lyrad`'s synchronous HTTP handlers — those haven't been migrated
// to the async codegraph engine yet. The new `CodeGraphEngine` is the
// async entry point for agent-runtime (Phase 3+).

mod engine;
mod service;
mod status;
mod types;
mod context;
mod explore;
mod watcher;
mod resolution;

pub use context::ProjectContext;
pub use engine::{CodeGraphEngine, StalenessInfo};
pub use explore::{ExploreResult, ExploreSymbol};
pub use status::IndexStatus;

// Legacy stub — still used by lyrad.
pub use service::CodeIntelService;
pub use types::{
    CodeGraphEdge, CodeGraphExpandParams, CodeGraphExpandResponse, CodeGraphMeta, CodeGraphNode,
    CodeIndexRebuildParams, CodeIndexRebuildResponse, CodeIndexState, CodeIndexStatus,
    CodeSearchSymbolMatch, CodeSearchSymbolParams, CodeSearchSymbolResponse, CodeSearchTextMatch,
    CodeSearchTextParams, CodeSearchTextResponse, IndexSnapshot, IndexedFile, IndexedSymbol,
};