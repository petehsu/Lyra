//! Cross-platform Computer Use object model.
//!
//! This is the foundational contract described in
//! `Desktop-Computer-Use-Architecture.md` §3 (Computer Tree) and §6.1 (osRef).
//! Every platform backend (macOS AX, Windows UIA, Linux AT-SPI) normalizes its
//! native tree into [`ComputerNode`] values and accepts an opaque [`OsRef`] to
//! re-resolve a node at action time. The model deliberately carries no native
//! handle: an `OsRef` is a string token the backend knows how to re-walk, never
//! a dereferenceable pointer.

use serde::{Deserialize, Serialize};

/// Platforms a node can originate from. Matches the desktop `platform` union.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    #[serde(rename = "darwin")]
    Darwin,
    #[serde(rename = "win32")]
    Win32,
    Linux,
    /// Reported by backends that are not implemented on the current OS.
    Unsupported,
}

impl Platform {
    /// The platform Lyra is currently running on.
    pub fn current() -> Self {
        match std::env::consts::OS {
            "macos" => Platform::Darwin,
            "windows" => Platform::Win32,
            "linux" => Platform::Linux,
            _ => Platform::Unsupported,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Platform::Darwin => "darwin",
            Platform::Win32 => "win32",
            Platform::Linux => "linux",
            Platform::Unsupported => "unsupported",
        }
    }
}

/// Semantic actions a node may support. Mirrors `ComputerAction` in the spec and
/// the browser-side `actionCapabilities` union so the Agent sees one vocabulary
/// across DOM and OS surfaces.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ComputerAction {
    /// Activate the element (AXPress / InvokePattern / Action.doAction).
    Press,
    /// Move focus to the element without activating it.
    Focus,
    /// Replace the element's text value (AXValue / ValuePattern.SetValue).
    SetText,
    /// Flip a checkbox/switch/disclosure (TogglePattern).
    Toggle,
    /// Select an item in a list/menu/radio group (SelectionItemPattern).
    Select,
    /// Scroll the element (ScrollPattern).
    Scroll,
}

impl ComputerAction {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "press" | "click" => Some(ComputerAction::Press),
            "focus" => Some(ComputerAction::Focus),
            "setText" | "type" => Some(ComputerAction::SetText),
            "toggle" => Some(ComputerAction::Toggle),
            "select" => Some(ComputerAction::Select),
            "scroll" => Some(ComputerAction::Scroll),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            ComputerAction::Press => "press",
            ComputerAction::Focus => "focus",
            ComputerAction::SetText => "setText",
            ComputerAction::Toggle => "toggle",
            ComputerAction::Select => "select",
            ComputerAction::Scroll => "scroll",
        }
    }
}

/// Screen-space rectangle. Present only when the backend can read geometry;
/// the Agent must never depend on it for addressing (that is what `os_ref` is
/// for) — bounds exist for visual fallback (Level 3) and overlap diagnostics.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Bounds {
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
}

/// Interaction state flags. Optional so a backend only reports what it knows.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerNodeState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focused: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expanded: Option<bool>,
}

impl ComputerNodeState {
    /// Returns true when no flag is populated (used to omit empty state objects).
    pub fn is_empty(&self) -> bool {
        self.focused.is_none()
            && self.enabled.is_none()
            && self.selected.is_none()
            && self.checked.is_none()
            && self.expanded.is_none()
    }
}

/// How a node was obtained. Drives Level 1/2/3 reasoning and auditing (§4).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ComputerNodeSource {
    InternalIpc,
    OsAx,
    AppAdapter,
    VisionInferred,
}

/// A single normalized element in the Computer Tree.
///
/// `os_ref` is the opaque re-resolution token (§6.1). `os_path` is the macOS
/// backend's concrete re-resolution scheme (role/index path) and is carried for
/// diagnostics; other backends may leave it empty and encode everything in
/// `os_ref`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerNode {
    /// Opaque, backend-resolvable handle. Stable enough to survive between a
    /// `map` and a following `act`/`diff` within a snapshot's lifetime.
    pub os_ref: String,
    pub platform: Platform,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window: Option<String>,
    pub role: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bounds: Option<Bounds>,
    #[serde(skip_serializing_if = "ComputerNodeState::is_empty")]
    pub state: ComputerNodeState,
    pub actions: Vec<ComputerAction>,
    pub source: ComputerNodeSource,
    /// True for secure inputs (password fields). Such nodes are hard-blocked
    /// from `setText` and never carry a readable `value` (§11).
    #[serde(skip_serializing_if = "is_false")]
    pub secure: bool,
    /// Backend-specific re-resolution detail (macOS role/index path). Empty when
    /// the backend folds re-resolution entirely into `os_ref`.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub os_path: String,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// Session mode governing how aggressively an action may touch the desktop
/// (§5). The two background modes are *true background* (§14.2): they must never
/// steal the foreground, so the runtime refuses focus/raise and any
/// coordinate-synthesis path in those modes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SessionMode {
    /// User-visible; foreground steal (focus/raise) is allowed.
    Shared,
    /// Not allowed to steal focus; semantic actions only.
    BackgroundSemantic,
    /// Long-running background work in an isolated space; semantic only.
    IsolatedSession,
}

impl SessionMode {
    pub fn parse(value: &str) -> Self {
        match value {
            "background-semantic" | "background" => SessionMode::BackgroundSemantic,
            "isolated-session" | "isolated" => SessionMode::IsolatedSession,
            _ => SessionMode::Shared,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            SessionMode::Shared => "shared",
            SessionMode::BackgroundSemantic => "background-semantic",
            SessionMode::IsolatedSession => "isolated-session",
        }
    }

    /// Whether this mode permits foreground-stealing actions (focus/raise).
    pub fn allows_foreground_steal(self) -> bool {
        matches!(self, SessionMode::Shared)
    }
}

/// Filter applied while reading the tree, mirroring browser_ax strategies (§6.2).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MapStrategy {
    /// Only actionable controls (default). Keeps the tree small.
    Interactive,
    /// Reading structure: include text/headings as well.
    Document,
}

impl MapStrategy {
    pub fn parse(value: &str) -> Self {
        match value {
            "document" => MapStrategy::Document,
            _ => MapStrategy::Interactive,
        }
    }
}

/// Request to read (a slice of) the Computer Tree.
#[derive(Clone, Debug)]
pub struct MapRequest {
    pub strategy: MapStrategy,
    /// Hard cap on returned nodes; backends must respect it to avoid tree blow-up.
    pub max_nodes: usize,
}

impl Default for MapRequest {
    fn default() -> Self {
        Self {
            strategy: MapStrategy::Interactive,
            max_nodes: 200,
        }
    }
}

/// Request to act on a previously-mapped node.
#[derive(Clone, Debug)]
pub struct ActRequest {
    pub os_ref: String,
    pub action: ComputerAction,
    /// Text payload for `SetText`; ignored by other actions.
    pub text: Option<String>,
    /// Session mode gate (§5). Defaults to `Shared`.
    pub mode: SessionMode,
}

/// The outcome of re-resolving + acting on a node, plus the closed-loop diff
/// (§6.3): the node's state before and after, so a non-visual caller can verify
/// the action took effect instead of flying blind.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActOutcome {
    pub ok: bool,
    pub os_ref: String,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before: Option<ComputerNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after: Option<ComputerNode>,
    /// Human-readable summary of what changed, e.g. "checked: false -> true".
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub changed: Vec<String>,
}

/// Structured error returned by a backend. Kinds are stable strings the host /
/// Agent can branch on (e.g. `permissionDenied`, `staleOsRef`).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendError {
    pub kind: String,
    pub message: String,
}

impl BackendError {
    pub fn new(kind: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            kind: kind.into(),
            message: message.into(),
        }
    }

    pub fn permission_denied(message: impl Into<String>) -> Self {
        Self::new("permissionDenied", message)
    }

    pub fn stale_os_ref(message: impl Into<String>) -> Self {
        Self::new("staleOsRef", message)
    }

    pub fn unsupported(message: impl Into<String>) -> Self {
        Self::new("unsupported", message)
    }
}
