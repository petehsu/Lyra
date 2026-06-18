//! Windows UI Automation backend.
//!
//! Realizes [`ComputerBackend`] on Windows through the UIA COM client. The
//! `os_ref` scheme is `uia:<child-index-path>` (e.g. `uia:0/3/1`), re-walked
//! from the focused element's top-level window via the raw TreeWalker at action
//! time — opaque to callers, a concrete path here, exactly like the macOS
//! `osax:` scheme (§6.1).
//!
//! UIA pattern invokes (`InvokePattern.Invoke`, `ValuePattern.SetValue`,
//! `TogglePattern.Toggle`, `SelectionItemPattern.Select`) act on the element
//! directly and do not require foreground activation, which is what makes the
//! semantic path naturally background + non-visual (§0.3). Secure inputs are
//! detected via `CurrentIsPassword` and surfaced as `secure: true`.
//!
//! NOTE: This file is compiled only on Windows and has not been compiled on the
//! macOS dev host. The shapes follow windows-rs 0.57 signatures verified against
//! the vendored crate, but first real compilation must happen on Windows.

#![cfg(windows)]

use std::collections::HashMap;

use windows::core::BSTR;
use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationInvokePattern,
    IUIAutomationSelectionItemPattern, IUIAutomationTogglePattern, IUIAutomationTreeWalker,
    IUIAutomationValuePattern, ToggleState_On, UIA_ButtonControlTypeId, UIA_CheckBoxControlTypeId,
    UIA_ComboBoxControlTypeId, UIA_CONTROLTYPE_ID, UIA_DocumentControlTypeId, UIA_EditControlTypeId,
    UIA_HyperlinkControlTypeId, UIA_ImageControlTypeId, UIA_InvokePatternId,
    UIA_ListItemControlTypeId, UIA_MenuItemControlTypeId, UIA_RadioButtonControlTypeId,
    UIA_SelectionItemPatternId, UIA_SplitButtonControlTypeId, UIA_TextControlTypeId,
    UIA_TogglePatternId, UIA_ValuePatternId, UIA_WindowControlTypeId,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsWindowVisible, SetForegroundWindow,
};

use crate::backend::ComputerBackend;
use crate::model::{
    BackendError, ComputerAction, ComputerAppEntry, ComputerFocusRequest, ComputerNode,
    ComputerNodeSource, ComputerNodeState, ComputerObserveResult, ComputerWindowEntry,
    ListAppsRequest, MapRequest, MapStrategy, Platform,
};

/// Maps a UIA control type id to our normalized role vocabulary (shared with
/// the macOS backend so the Agent sees one set of roles).
///
/// Uses equality comparisons rather than a `match` on the imported constants:
/// UIA_*ControlTypeId are non-upper-case `const` values, which in a match arm
/// would be treated as catch-all bindings (and warn), not value comparisons.
fn normalize_control_type(control_type: UIA_CONTROLTYPE_ID) -> &'static str {
    if control_type == UIA_ButtonControlTypeId || control_type == UIA_SplitButtonControlTypeId {
        "button"
    } else if control_type == UIA_HyperlinkControlTypeId {
        "link"
    } else if control_type == UIA_EditControlTypeId {
        "textbox"
    } else if control_type == UIA_CheckBoxControlTypeId {
        "checkbox"
    } else if control_type == UIA_RadioButtonControlTypeId {
        "radio"
    } else if control_type == UIA_MenuItemControlTypeId {
        "menuitem"
    } else if control_type == UIA_ComboBoxControlTypeId {
        "combobox"
    } else if control_type == UIA_WindowControlTypeId {
        "window"
    } else if control_type == UIA_ListItemControlTypeId {
        "listitem"
    } else if control_type == UIA_TextControlTypeId {
        "statictext"
    } else if control_type == UIA_ImageControlTypeId {
        "image"
    } else if control_type == UIA_DocumentControlTypeId {
        "document"
    } else {
        "group"
    }
}

fn actions_for_role(role: &str) -> Vec<ComputerAction> {
    match role {
        "button" | "link" | "menuitem" => vec![ComputerAction::Press, ComputerAction::Focus],
        "textbox" => vec![
            ComputerAction::Focus,
            ComputerAction::SetText,
            ComputerAction::Press,
        ],
        // Secure fields are focusable but never offer setText (§11).
        "securetextbox" => vec![ComputerAction::Focus],
        "combobox" => vec![
            ComputerAction::Focus,
            ComputerAction::Press,
            ComputerAction::Select,
        ],
        "checkbox" | "radio" => vec![
            ComputerAction::Focus,
            ComputerAction::Toggle,
            ComputerAction::Press,
        ],
        "listitem" => vec![ComputerAction::Focus, ComputerAction::Select],
        "statictext" | "image" => Vec::new(),
        _ => vec![ComputerAction::Focus],
    }
}

fn is_actionable(role: &str) -> bool {
    !actions_for_role(role).is_empty()
}

fn bstr_to_string(value: BSTR) -> String {
    value.to_string()
}

/// Initializes COM for this thread (idempotent; ignores RPC_E_CHANGED_MODE).
fn ensure_com() {
    // SAFETY: CoInitializeEx is safe to call repeatedly; a differing mode on an
    // already-initialized thread returns S_FALSE / RPC_E_CHANGED_MODE which we
    // intentionally ignore.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

fn automation() -> Result<IUIAutomation, BackendError> {
    ensure_com();
    // SAFETY: standard CUIAutomation activation.
    unsafe {
        CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
            .map_err(|error| BackendError::new("uiaUnavailable", error.message().to_string()))
    }
}

/// The focused element's top-level window, used as the stable root for the
/// child-index path. Falls back to the focused element itself.
fn root_element(automation: &IUIAutomation) -> Result<IUIAutomationElement, BackendError> {
    // SAFETY: GetFocusedElement returns a COM element or an error.
    unsafe {
        automation
            .GetFocusedElement()
            .or_else(|_| automation.GetRootElement())
            .map_err(|error| {
                BackendError::new(
                    "unavailable",
                    format!("No focused UIA element is available: {}", error.message()),
                )
            })
    }
}

fn read_role(element: &IUIAutomationElement) -> String {
    // SAFETY: CurrentControlType / CurrentIsPassword read element properties.
    unsafe {
        let control_type = element
            .CurrentControlType()
            .unwrap_or(UIA_CONTROLTYPE_ID(0));
        let base = normalize_control_type(control_type);
        if base == "textbox" && element.CurrentIsPassword().map(|b| b.as_bool()).unwrap_or(false) {
            "securetextbox".to_string()
        } else {
            base.to_string()
        }
    }
}

fn read_name(element: &IUIAutomationElement, secure: bool) -> String {
    if secure {
        return "Secure input".to_string();
    }
    // SAFETY: CurrentName reads the accessible name.
    unsafe {
        element
            .CurrentName()
            .map(bstr_to_string)
            .unwrap_or_default()
            .trim()
            .to_string()
    }
}

fn read_value(element: &IUIAutomationElement, secure: bool) -> Option<String> {
    if secure {
        return None;
    }
    // SAFETY: query the ValuePattern; absence is not an error.
    unsafe {
        let pattern: IUIAutomationValuePattern =
            element.GetCurrentPatternAs(UIA_ValuePatternId).ok()?;
        let value = pattern.CurrentValue().ok()?;
        let text = bstr_to_string(value);
        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    }
}

fn read_state(element: &IUIAutomationElement, role: &str) -> ComputerNodeState {
    let mut state = ComputerNodeState::default();
    // SAFETY: property/pattern reads; failures degrade to None.
    unsafe {
        if let Ok(enabled) = element.CurrentIsEnabled() {
            state.enabled = Some(enabled.as_bool());
        }
        if role == "checkbox" || role == "radio" {
            if let Ok(pattern) =
                element.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)
            {
                if let Ok(toggle) = pattern.CurrentToggleState() {
                    state.checked = Some(toggle == ToggleState_On);
                }
            }
        }
        if let Ok(pattern) = element
            .GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId)
        {
            if let Ok(selected) = pattern.CurrentIsSelected() {
                state.selected = Some(selected.as_bool());
            }
        }
    }
    state
}

fn node_for_element(element: &IUIAutomationElement, path: &str) -> ComputerNode {
    let role = read_role(element);
    let secure = role == "securetextbox";
    let name = read_name(element, secure);
    let value = read_value(element, secure);
    let state = read_state(element, &role);
    let actions = actions_for_role(&role);
    ComputerNode {
        os_ref: format!("uia:{path}"),
        platform: Platform::Win32,
        app: None,
        window: None,
        role,
        name,
        value,
        bounds: None,
        state,
        actions,
        source: ComputerNodeSource::OsAx,
        secure,
        os_path: path.to_string(),
    }
}

fn traverse(
    walker: &IUIAutomationTreeWalker,
    element: &IUIAutomationElement,
    path: &str,
    request: &MapRequest,
    nodes: &mut Vec<ComputerNode>,
) {
    if nodes.len() >= request.max_nodes {
        return;
    }
    let node = node_for_element(element, path);
    let keep = match request.strategy {
        MapStrategy::Interactive => is_actionable(&node.role) || node.role == "window",
        MapStrategy::Document => !node.name.is_empty() || node.role == "window",
    };
    if keep {
        nodes.push(node);
    }

    // SAFETY: TreeWalker child/sibling traversal; each call returns an element
    // or an error when there is no further child/sibling.
    unsafe {
        let mut child = match walker.GetFirstChildElement(element) {
            Ok(child) => child,
            Err(_) => return,
        };
        let mut index = 0;
        loop {
            if nodes.len() >= request.max_nodes {
                break;
            }
            traverse(walker, &child, &format!("{path}/{index}"), request, nodes);
            child = match walker.GetNextSiblingElement(&child) {
                Ok(next) => next,
                Err(_) => break,
            };
            index += 1;
        }
    }
}

/// Strips the `uia:` scheme and re-walks the child-index path from the root.
fn resolve_path(
    walker: &IUIAutomationTreeWalker,
    root: &IUIAutomationElement,
    os_path: &str,
) -> Option<IUIAutomationElement> {
    let parts = os_path
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if parts.first().copied() != Some("0") {
        return None;
    }
    let mut current = root.clone();
    for part in parts.into_iter().skip(1) {
        let target_index = part.parse::<usize>().ok()?;
        // SAFETY: walk to the Nth child via first-child + sibling chain.
        unsafe {
            let mut child = walker.GetFirstChildElement(&current).ok()?;
            let mut index = 0;
            while index < target_index {
                child = walker.GetNextSiblingElement(&child).ok()?;
                index += 1;
            }
            current = child;
        }
    }
    Some(current)
}

fn os_path_from_ref(os_ref: &str) -> Option<&str> {
    os_ref.strip_prefix("uia:")
}

fn app_ref_for_pid(pid: u32) -> String {
    format!("winapp:{pid}")
}

fn window_ref_for_hwnd(hwnd: HWND) -> String {
    format!("winwin:{:#x}", hwnd.0 as usize)
}

fn parse_app_ref(app_ref: &str) -> Option<u32> {
    app_ref.strip_prefix("winapp:")?.parse().ok()
}

fn parse_window_ref(window_ref: &str) -> Option<HWND> {
    let remainder = window_ref.strip_prefix("winwin:")?;
    let value = if let Some(hex) = remainder.strip_prefix("0x") {
        usize::from_str_radix(hex, 16).ok()?
    } else {
        remainder.parse().ok()?
    };
    Some(HWND(value as isize))
}

fn hwnd_title(hwnd: HWND) -> String {
    // SAFETY: reads the window title for a valid HWND.
    unsafe {
        let length = GetWindowTextLengthW(hwnd);
        if length <= 0 {
            return String::new();
        }
        let mut buffer = vec![0_u16; length as usize + 1];
        let copied = GetWindowTextW(hwnd, &mut buffer);
        if copied <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buffer[..copied as usize])
    }
}

struct VisibleWindow {
    hwnd: HWND,
    title: String,
    pid: u32,
}

struct EnumWindowsState {
    foreground: HWND,
    windows: Vec<VisibleWindow>,
}

unsafe extern "system" fn collect_visible_windows(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let state = &mut *(lparam.0 as *mut EnumWindowsState);
    if hwnd.0 == 0 {
        return BOOL::from(true);
    }
    if IsWindowVisible(hwnd).as_bool() == false {
        return BOOL::from(true);
    }
    let title = hwnd_title(hwnd);
    if title.is_empty() {
        return BOOL::from(true);
    }
    let mut pid = 0_u32;
    // SAFETY: writes the owning process id for a valid HWND.
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
    }
    if pid == 0 {
        return BOOL::from(true);
    }
    state.windows.push(VisibleWindow { hwnd, title, pid });
    BOOL::from(true)
}

fn visible_windows() -> Result<(HWND, Vec<VisibleWindow>), BackendError> {
    // SAFETY: EnumWindows invokes the callback for each top-level window.
    unsafe {
        let foreground = GetForegroundWindow();
        let mut state = EnumWindowsState {
            foreground,
            windows: Vec::new(),
        };
        EnumWindows(
            Some(collect_visible_windows),
            LPARAM(&mut state as *mut EnumWindowsState as isize),
        )
        .map_err(|error| BackendError::new("enumWindowsFailed", error.message().to_string()))?;
        Ok((foreground, state.windows))
    }
}

fn apps_from_windows(
    windows: &[VisibleWindow],
    foreground: HWND,
    request: &ListAppsRequest,
) -> Vec<ComputerAppEntry> {
    let mut grouped: HashMap<u32, ComputerAppEntry> = HashMap::new();
    for window in windows {
        let entry = grouped.entry(window.pid).or_insert_with(|| ComputerAppEntry {
            app_ref: app_ref_for_pid(window.pid),
            name: window.title.clone(),
            pid: Some(window.pid as i64),
            bundle_id: None,
            is_foreground: false,
            windows: Vec::new(),
        });
        let is_focused = window.hwnd == foreground;
        if is_focused {
            entry.is_foreground = true;
            entry.name = window.title.clone();
        }
        entry.windows.push(ComputerWindowEntry {
            window_ref: Some(window_ref_for_hwnd(window.hwnd)),
            title: window.title.clone(),
            is_focused,
        });
    }
    let mut apps = grouped.into_values().collect::<Vec<_>>();
    if !request.include_background {
        apps.retain(|app| app.is_foreground || !app.windows.is_empty());
    }
    apps.sort_by(|left, right| {
        right
            .is_foreground
            .cmp(&left.is_foreground)
            .then_with(|| left.name.cmp(&right.name))
    });
    apps.truncate(request.max_apps);
    apps
}

fn focus_hwnd(hwnd: HWND) -> Result<(), BackendError> {
    // SAFETY: raises an existing visible top-level window.
    unsafe {
        if SetForegroundWindow(hwnd).as_bool() {
            Ok(())
        } else {
            Err(BackendError::new(
                "focusFailed",
                "SetForegroundWindow returned false; the target may be unavailable.",
            ))
        }
    }
}

/// The Windows UIA [`ComputerBackend`].
pub struct WindowsBackend;

impl WindowsBackend {
    pub fn new() -> Self {
        WindowsBackend
    }
}

impl Default for WindowsBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl ComputerBackend for WindowsBackend {
    fn is_available(&self) -> bool {
        automation().is_ok()
    }

    fn map(&self, request: &MapRequest) -> Result<Vec<ComputerNode>, BackendError> {
        let automation = automation()?;
        let root = root_element(&automation)?;
        // SAFETY: RawViewWalker returns the raw tree walker.
        let walker = unsafe {
            automation
                .RawViewWalker()
                .map_err(|error| BackendError::new("uiaUnavailable", error.message().to_string()))?
        };
        let mut nodes = Vec::new();
        traverse(&walker, &root, "0", request, &mut nodes);
        Ok(nodes)
    }

    fn resolve(&self, os_ref: &str) -> Result<Option<ComputerNode>, BackendError> {
        let Some(os_path) = os_path_from_ref(os_ref) else {
            return Err(BackendError::new(
                "invalidOsRef",
                "Computer osRef must use the uia: scheme on Windows.",
            ));
        };
        let automation = automation()?;
        let root = root_element(&automation)?;
        let walker = unsafe {
            automation
                .RawViewWalker()
                .map_err(|error| BackendError::new("uiaUnavailable", error.message().to_string()))?
        };
        match resolve_path(&walker, &root, os_path) {
            Some(element) => Ok(Some(node_for_element(&element, os_path))),
            None => Ok(None),
        }
    }

    fn act(
        &self,
        os_ref: &str,
        action: ComputerAction,
        text: Option<&str>,
    ) -> Result<(), BackendError> {
        let Some(os_path) = os_path_from_ref(os_ref) else {
            return Err(BackendError::new(
                "invalidOsRef",
                "Computer osRef must use the uia: scheme on Windows.",
            ));
        };
        let automation = automation()?;
        let root = root_element(&automation)?;
        let walker = unsafe {
            automation
                .RawViewWalker()
                .map_err(|error| BackendError::new("uiaUnavailable", error.message().to_string()))?
        };
        let element = resolve_path(&walker, &root, os_path).ok_or_else(|| {
            BackendError::stale_os_ref("Computer osRef is no longer present in the focused window.")
        })?;

        // SAFETY: each branch queries the matching control pattern and invokes
        // it. Pattern absence becomes a structured error, not UB.
        unsafe {
            match action {
                ComputerAction::SetText => {
                    let pattern: IUIAutomationValuePattern = element
                        .GetCurrentPatternAs(UIA_ValuePatternId)
                        .map_err(|_| {
                            BackendError::new(
                                "patternUnavailable",
                                "Target does not support the Value pattern (setText).",
                            )
                        })?;
                    let value = BSTR::from(text.unwrap_or_default());
                    pattern.SetValue(&value).map_err(|error| {
                        BackendError::new("uiaActionFailed", error.message().to_string())
                    })
                }
                ComputerAction::Toggle => {
                    let pattern: IUIAutomationTogglePattern = element
                        .GetCurrentPatternAs(UIA_TogglePatternId)
                        .map_err(|_| {
                            BackendError::new(
                                "patternUnavailable",
                                "Target does not support the Toggle pattern.",
                            )
                        })?;
                    pattern.Toggle().map_err(|error| {
                        BackendError::new("uiaActionFailed", error.message().to_string())
                    })
                }
                ComputerAction::Select => {
                    let pattern: IUIAutomationSelectionItemPattern = element
                        .GetCurrentPatternAs(UIA_SelectionItemPatternId)
                        .map_err(|_| {
                            BackendError::new(
                                "patternUnavailable",
                                "Target does not support the SelectionItem pattern.",
                            )
                        })?;
                    pattern.Select().map_err(|error| {
                        BackendError::new("uiaActionFailed", error.message().to_string())
                    })
                }
                // Press / Focus / Scroll: prefer InvokePattern; fall back to
                // SetFocus so focusable-but-not-invokable controls still work.
                _ => {
                    if let Ok(invoke) =
                        element.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId)
                    {
                        invoke.Invoke().map_err(|error| {
                            BackendError::new("uiaActionFailed", error.message().to_string())
                        })
                    } else {
                        element.SetFocus().map_err(|error| {
                            BackendError::new("uiaActionFailed", error.message().to_string())
                        })
                    }
                }
            }
        }
    }

    fn list_apps(&self, request: &ListAppsRequest) -> Result<Vec<ComputerAppEntry>, BackendError> {
        let (foreground, windows) = visible_windows()?;
        Ok(apps_from_windows(&windows, foreground, request))
    }

    fn observe(&self) -> Result<ComputerObserveResult, BackendError> {
        let (foreground, windows) = visible_windows()?;
        let apps = apps_from_windows(
            &windows,
            foreground,
            &ListAppsRequest {
                max_apps: 100,
                include_background: true,
            },
        );
        let foreground_app = apps.into_iter().find(|app| app.is_foreground);
        let focused_window = foreground_app.as_ref().and_then(|app| {
            app.windows
                .iter()
                .find(|window| window.is_focused)
                .cloned()
        });
        let automation = automation()?;
        let focused_control = unsafe {
            automation
                .GetFocusedElement()
                .ok()
                .map(|element| node_for_element(&element, "focused"))
        };
        Ok(ComputerObserveResult {
            foreground_app,
            focused_window,
            focused_control,
        })
    }

    fn focus(&self, request: &ComputerFocusRequest) -> Result<(), BackendError> {
        if request.bundle_id.is_some() {
            return Err(BackendError::new(
                "unsupported",
                "bundleId focus is not implemented on Windows yet; use appRef, pid, or windowRef.",
            ));
        }
        if let Some(window_ref) = request.window_ref.as_deref() {
            let Some(hwnd) = parse_window_ref(window_ref) else {
                return Err(BackendError::new(
                    "invalidArgument",
                    "windowRef must use the winwin:<hwnd> scheme on Windows.",
                ));
            };
            return focus_hwnd(hwnd);
        }
        if let Some(title) = request.window_title.as_deref() {
            let (_, windows) = visible_windows()?;
            let window = windows
                .iter()
                .find(|window| window.title == title)
                .ok_or_else(|| {
                    BackendError::new(
                        "windowNotFound",
                        format!("No window titled {title:?} was found."),
                    )
                })?;
            return focus_hwnd(window.hwnd);
        }
        let pid = if let Some(app_ref) = request.app_ref.as_deref() {
            parse_app_ref(app_ref).ok_or_else(|| {
                BackendError::new(
                    "invalidArgument",
                    "appRef must use the winapp:<pid> scheme on Windows.",
                )
            })?
        } else if let Some(pid) = request.pid {
            pid as u32
        } else {
            return Err(BackendError::new(
                "invalidArgument",
                "computer.focus requires appRef, pid, windowRef, or windowTitle on Windows.",
            ));
        };
        let (foreground, windows) = visible_windows()?;
        let window = windows
            .iter()
            .find(|window| window.pid == pid)
            .ok_or_else(|| {
                BackendError::new(
                    "appNotFound",
                    format!("No visible window was found for pid {pid}."),
                )
            })?;
        let _ = foreground;
        focus_hwnd(window.hwnd)
    }
}
