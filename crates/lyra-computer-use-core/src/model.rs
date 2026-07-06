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
    /// Type text character-by-character via keyboard events (CGEvent postToPid).
    /// Falls back to AXValue set when the element is settable.
    TypeText,
    /// Flip a checkbox/switch/disclosure (TogglePattern).
    Toggle,
    /// Select an item in a list/menu/radio group (SelectionItemPattern).
    Select,
    /// Scroll the element (AXScrollToVisible / CGEvent scrollWheel / ScrollPattern).
    Scroll,
    /// Press a key or key-combination (xdotool syntax, e.g. "cmd+c").
    PressKey,
    /// Invoke a secondary accessibility action (AXShowMenu / AXOpen / etc.).
    SecondaryAction,
    /// Drag from one coordinate to another (coordinate-only, shared mode).
    Drag,
}

impl ComputerAction {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "press" | "click" => Some(ComputerAction::Press),
            "focus" => Some(ComputerAction::Focus),
            "setText" | "type" => Some(ComputerAction::SetText),
            "typeText" => Some(ComputerAction::TypeText),
            "toggle" => Some(ComputerAction::Toggle),
            "select" => Some(ComputerAction::Select),
            "scroll" => Some(ComputerAction::Scroll),
            "pressKey" => Some(ComputerAction::PressKey),
            "secondaryAction" => Some(ComputerAction::SecondaryAction),
            "drag" => Some(ComputerAction::Drag),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            ComputerAction::Press => "press",
            ComputerAction::Focus => "focus",
            ComputerAction::SetText => "setText",
            ComputerAction::TypeText => "typeText",
            ComputerAction::Toggle => "toggle",
            ComputerAction::Select => "select",
            ComputerAction::Scroll => "scroll",
            ComputerAction::PressKey => "pressKey",
            ComputerAction::SecondaryAction => "secondaryAction",
            ComputerAction::Drag => "drag",
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

/// Per-call input delivery strategy. Orthogonal to [`SessionMode`]: the
/// session mode governs whether foreground-steal is *allowed* at all, while
/// the delivery mode governs *how* input is synthesized when it is.
///
/// - `Background` (default): PostMessage to the target window's deepest child
///   HWND — no focus steal, no cursor move. Falls back to SendInput when the
///   target is known to reject PostMessage (Chromium, XAML/UWP, terminals) or
///   when modifiers must be held (PostMessage does not update `GetKeyState`).
/// - `Foreground`: SendInput against the system input queue, briefly fronting
///   the target then restoring the prior foreground. The only path that reaches
///   Chromium content, WPF drag, and apps behind UIPI isolation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeliveryMode {
    Background,
    Foreground,
}

impl Default for DeliveryMode {
    fn default() -> Self {
        Self::Background
    }
}

impl DeliveryMode {
    pub fn parse(value: &str) -> Self {
        match value {
            "foreground" => Self::Foreground,
            _ => Self::Background,
        }
    }

    pub fn is_foreground(self) -> bool {
        matches!(self, Self::Foreground)
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
    /// Text payload for `SetText` / `TypeText`; ignored by other actions.
    pub text: Option<String>,
    /// Session mode gate (§5). Defaults to `Shared`.
    pub mode: SessionMode,
    /// Key specification for `PressKey` (xdotool syntax, e.g. "cmd+c").
    pub key: Option<String>,
    /// Action name for `SecondaryAction` (e.g. "AXShowMenu").
    pub action_name: Option<String>,
    /// Scroll direction: "up" / "down" / "left" / "right".
    pub direction: Option<String>,
    /// Scroll pages (fractional supported). Defaults to 1.
    pub pages: Option<f64>,
    /// Drag start coordinate (screen-space pixels).
    pub from_x: Option<f64>,
    pub from_y: Option<f64>,
    /// Drag end coordinate (screen-space pixels).
    pub to_x: Option<f64>,
    pub to_y: Option<f64>,
    /// Per-call input delivery strategy. See [`DeliveryMode`].
    pub delivery_mode: DeliveryMode,
}

impl Default for ActRequest {
    fn default() -> Self {
        Self {
            os_ref: String::new(),
            action: ComputerAction::Press,
            text: None,
            mode: SessionMode::Shared,
            key: None,
            action_name: None,
            direction: None,
            pages: None,
            from_x: None,
            from_y: None,
            to_x: None,
            to_y: None,
            delivery_mode: DeliveryMode::Background,
        }
    }
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

/// A normalized desktop window entry for `computer.list_apps`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerWindowEntry {
    /// Opaque window handle the backend can re-resolve at focus time.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_ref: Option<String>,
    pub title: String,
    #[serde(skip_serializing_if = "is_false")]
    pub is_focused: bool,
}

/// A running desktop application entry for `computer.list_apps`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerAppEntry {
    /// Opaque app handle the backend can re-resolve at focus time.
    pub app_ref: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    #[serde(skip_serializing_if = "is_false")]
    pub is_foreground: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub windows: Vec<ComputerWindowEntry>,
}

/// Request to list running desktop applications.
#[derive(Clone, Debug)]
pub struct ListAppsRequest {
    /// Hard cap on returned apps; backends must respect it.
    pub max_apps: usize,
    /// When true, include apps without a focused/visible window.
    pub include_background: bool,
}

impl Default for ListAppsRequest {
    fn default() -> Self {
        Self {
            max_apps: 50,
            include_background: false,
        }
    }
}

/// Snapshot of foreground app / window / focused control for `computer.observe`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerObserveResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub foreground_app: Option<ComputerAppEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focused_window: Option<ComputerWindowEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focused_control: Option<ComputerNode>,
}

/// Request to raise an app or window to the foreground (`computer.focus`).
///
/// Session-level focus is distinct from element-level `computer.act(action: focus)`.
/// At least one target field must be populated.
#[derive(Clone, Debug, Default)]
pub struct ComputerFocusRequest {
    pub app_ref: Option<String>,
    pub pid: Option<i64>,
    pub bundle_id: Option<String>,
    pub window_title: Option<String>,
    pub window_ref: Option<String>,
}

impl ComputerFocusRequest {
    pub fn has_target(&self) -> bool {
        self.app_ref.is_some()
            || self.pid.is_some()
            || self.bundle_id.is_some()
            || self.window_title.is_some()
            || self.window_ref.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delivery_mode_parse_foreground() {
        assert_eq!(DeliveryMode::parse("foreground"), DeliveryMode::Foreground);
        assert!(DeliveryMode::parse("foreground").is_foreground());
    }

    #[test]
    fn delivery_mode_parse_background_default() {
        assert_eq!(DeliveryMode::parse("background"), DeliveryMode::Background);
        assert!(!DeliveryMode::parse("background").is_foreground());
    }

    #[test]
    fn delivery_mode_parse_unknown_falls_back_to_background() {
        assert_eq!(DeliveryMode::parse(""), DeliveryMode::Background);
        assert_eq!(DeliveryMode::parse("fg"), DeliveryMode::Background);
        assert_eq!(DeliveryMode::parse("Foreground"), DeliveryMode::Background);
    }

    #[test]
    fn delivery_mode_default_is_background() {
        assert_eq!(DeliveryMode::default(), DeliveryMode::Background);
    }
}
