//! Lyra Computer Use core.
//!
//! Cross-platform, semantic-first desktop control: a single object model
//! ([`model::ComputerNode`]) addressed by an opaque, re-resolvable handle
//! ([`model::ComputerNode::os_ref`]), one backend seam
//! ([`backend::ComputerBackend`]) per OS, and a JSON facade
//! ([`runtime`]) that platform N-API shims call. The act -> diff closed loop
//! lives in [`runtime`] so non-visual callers can verify every action.
//!
//! See `Desktop-Computer-Use-Architecture.md` for the full design. This crate is
//! a pure library: it owns no Electron bridge and is not a native-owned desktop
//! module. The macOS backend currently realizes the contract; Windows (UIA) and
//! Linux (AT-SPI) plug in behind the same trait.

pub mod backend;
pub mod model;
pub mod runtime;
pub mod snapshot_store;

#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(windows)]
pub mod windows;

#[cfg(all(target_os = "linux", feature = "linux-atspi"))]
pub mod linux;

pub use model::{
    ActOutcome, ActRequest, BackendError, Bounds, ComputerAction, ComputerAppEntry,
    ComputerFocusRequest, ComputerNode, ComputerNodeSource, ComputerNodeState,
    ComputerObserveResult, ComputerWindowEntry, ListAppsRequest, MapRequest, MapStrategy, Platform,
    SessionMode,
};

pub use runtime::{
    act_json, diff_json, explain_json, find_json, focus_json, list_apps_json, map_json, observe_json,
};
