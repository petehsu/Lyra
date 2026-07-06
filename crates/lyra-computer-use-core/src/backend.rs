//! The cross-platform backend contract and the snapshot store.
//!
//! A [`ComputerBackend`] is the single seam every platform implements. The
//! generic machinery in [`crate::runtime`] turns backend output into the JSON
//! facade and runs the act -> diff closed loop, so a new platform only has to
//! satisfy this trait.

use crate::model::{
    ActOutcome, ActRequest, BackendError, ComputerAppEntry, ComputerFocusRequest, ComputerNode,
    ComputerObserveResult, ListAppsRequest, MapRequest,
};

/// One platform's accessibility integration.
///
/// Implementations must treat `os_ref` as opaque on the way in: re-resolve it
/// against the *current* tree rather than holding a live native handle between
/// calls (§6.1).
pub trait ComputerBackend: Send + Sync {
    /// Whether this backend can run on the current OS/process. A backend that
    /// returns `false` short-circuits to an `unsupported` status.
    fn is_available(&self) -> bool;

    /// Read a slice of the Computer Tree according to `request`.
    fn map(&self, request: &MapRequest) -> Result<Vec<ComputerNode>, BackendError>;

    /// Re-resolve `os_ref` and read its current normalized node, or `None` when
    /// the reference is stale (no longer present in the tree).
    fn resolve(&self, os_ref: &str) -> Result<Option<ComputerNode>, BackendError>;

    /// Re-resolve `os_ref` and perform `action`. The runtime layer wraps this
    /// with before/after snapshots to produce the closed-loop diff, so backends
    /// only need to perform the action itself.
    fn act(&self, request: &ActRequest) -> Result<(), BackendError>;

    /// List running desktop applications and their visible windows.
    fn list_apps(&self, request: &ListAppsRequest) -> Result<Vec<ComputerAppEntry>, BackendError>;

    /// Read the foreground app, focused window, and focused accessibility control.
    fn observe(&self) -> Result<ComputerObserveResult, BackendError>;

    /// Raise an app or window to the foreground (session-level focus).
    fn focus(&self, request: &ComputerFocusRequest) -> Result<(), BackendError>;
}

/// Builds the human-readable change list between two snapshots of one node
/// (§6.3). Empty when nothing observable changed — which the runtime surfaces as
/// a "no observable change" warning rather than silent success.
pub fn diff_nodes(before: &ComputerNode, after: &ComputerNode) -> Vec<String> {
    let mut changes = Vec::new();
    if before.name != after.name {
        changes.push(format!("name: {:?} -> {:?}", before.name, after.name));
    }
    if before.value != after.value {
        changes.push(format!("value: {:?} -> {:?}", before.value, after.value));
    }
    let b = &before.state;
    let a = &after.state;
    if b.checked != a.checked {
        changes.push(format!("checked: {:?} -> {:?}", b.checked, a.checked));
    }
    if b.selected != a.selected {
        changes.push(format!("selected: {:?} -> {:?}", b.selected, a.selected));
    }
    if b.expanded != a.expanded {
        changes.push(format!("expanded: {:?} -> {:?}", b.expanded, a.expanded));
    }
    if b.focused != a.focused {
        changes.push(format!("focused: {:?} -> {:?}", b.focused, a.focused));
    }
    changes
}

/// Convenience: assemble an [`ActOutcome`] from before/after snapshots.
pub fn act_outcome(
    ok: bool,
    os_ref: &str,
    action: crate::model::ComputerAction,
    before: Option<ComputerNode>,
    after: Option<ComputerNode>,
) -> ActOutcome {
    let changed = match (&before, &after) {
        (Some(b), Some(a)) => diff_nodes(b, a),
        _ => Vec::new(),
    };
    ActOutcome {
        ok,
        os_ref: os_ref.to_string(),
        action: action.as_str().to_string(),
        before,
        after,
        changed,
    }
}
