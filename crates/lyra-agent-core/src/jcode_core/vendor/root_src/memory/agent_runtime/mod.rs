//! Structured Agent memory runtime.
//!
//! This module is the Rust-owned truth layer for Lyra Agent sessions. The
//! existing `crate::session` transcript remains available to the vendored
//! provider loop while this module owns UI projection, runtime-turn state,
//! context snapshots, trim/archive metadata, and shared/frozen memory truth.

pub mod archive;
pub mod clock;
pub mod context;
pub mod event;
pub mod ids;
pub mod migration;
pub mod projection;
pub mod recovery;
pub mod runtime_turn;
pub mod schema;
pub mod session;
pub mod shared;
pub mod store;
pub mod trim;
pub mod visibility;

pub use context::{ContextLayer, ContextLayerKind, ContextSnapshot};
pub use event::{NewSessionEvent, SessionEventRecord};
pub use projection::{AgentMemorySnapshot, TimelineProjectionItem};
pub use runtime_turn::{RuntimeTurnRecord, RuntimeTurnState, ToolResultStatus};
pub use schema::{AgentMemoryError, AgentMemoryResult, SCHEMA_VERSION};
pub use session::{CreateSessionInput, SessionRecord, SessionStatus};
pub use shared::{SharedMemoryRecord, SharedMemoryStatus};
pub use store::AgentMemoryStore;
pub use visibility::{EventRole, ModelContextPolicy, UiPolicy, Visibility};

#[cfg(test)]
mod tests;
