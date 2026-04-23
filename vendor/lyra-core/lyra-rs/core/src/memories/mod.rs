//! Memory subsystem backed by Lyra memory truth.
//!
//! Startup no longer runs Lyra's legacy phase-1/phase-2 extraction pipeline.
//! Instead, the active memory entrypoints initialize Lyra truth and read prompt
//! context directly from that truth.

pub(crate) mod citations;
#[cfg(test)]
mod control;
mod lyra_truth;
pub(crate) mod prompts;
mod start;
#[cfg(test)]
mod tests;
pub(crate) mod usage;

pub use lyra_truth::persist_thread_item_to_lyra_memory_truth;
/// Starts Lyra memory truth initialization for eligible root sessions.
pub(crate) use start::start_memories_startup_task;

use lyra_utils_absolute_path::AbsolutePathBuf;
use std::path::Path;
use std::path::PathBuf;

pub(crate) fn lyra_truth_root_path(lyra_home: &Path) -> PathBuf {
    lyra_truth::lyra_truth_root_path(lyra_home)
}

pub fn memory_root(lyra_home: &AbsolutePathBuf) -> AbsolutePathBuf {
    let root = lyra_truth_root_path(lyra_home.as_ref());
    AbsolutePathBuf::from_absolute_path(root)
        .expect("Lyra memory runtime root must always be absolute")
}
