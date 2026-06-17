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

use windows::core::BSTR;
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

use crate::backend::ComputerBackend;
use crate::model::{
    BackendError, ComputerAction, ComputerNode, ComputerNodeSource, ComputerNodeState, MapRequest,
    MapStrategy, Platform,
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
}
