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
use windows::Win32::Foundation::{BOOL, CloseHandle, HANDLE, HWND, LPARAM, POINT, RECT, WPARAM};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};
use windows::Win32::System::Threading::{
    AttachThreadInput, GetCurrentProcess, GetCurrentThreadId, OpenProcess, OpenProcessToken,
    PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::Security::{
    GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, TokenIntegrityLevel,
    TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
};
use windows::Win32::Graphics::Gdi::{ClientToScreen, ScreenToClient};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationInvokePattern,
    IUIAutomationScrollItemPattern, IUIAutomationSelectionItemPattern, IUIAutomationTogglePattern,
    IUIAutomationTreeWalker, IUIAutomationValuePattern, ToggleState_On, UIA_ButtonControlTypeId,
    UIA_CheckBoxControlTypeId, UIA_ComboBoxControlTypeId, UIA_DocumentControlTypeId,
    UIA_EditControlTypeId, UIA_HyperlinkControlTypeId, UIA_ImageControlTypeId,
    UIA_InvokePatternId, UIA_ListItemControlTypeId, UIA_MenuItemControlTypeId,
    UIA_RadioButtonControlTypeId, UIA_ScrollItemPatternId, UIA_SelectionItemPatternId,
    UIA_SplitButtonControlTypeId, UIA_TextControlTypeId, UIA_TogglePatternId, UIA_ValuePatternId,
    UIA_WindowControlTypeId, UIA_CONTROLTYPE_ID,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    KEYBD_EVENT_FLAGS, MOUSE_EVENT_FLAGS, MapVirtualKeyW, MAPVK_VK_TO_VSC, SendInput, VIRTUAL_KEY,
    WHEEL_DELTA, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_KEYUP,
    KEYEVENTF_UNICODE, MOUSEINPUT, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN,
    MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
    MOUSEEVENTF_WHEEL, VK_0, VK_1, VK_2, VK_3, VK_4, VK_5, VK_6, VK_7, VK_8, VK_9, VK_A, VK_B,
    VK_BACK, VK_C, VK_CONTROL, VK_D, VK_DELETE, VK_DOWN, VK_E, VK_ESCAPE, VK_F, VK_F1, VK_F10,
    VK_F11, VK_F12, VK_F2, VK_F3, VK_F4, VK_F5, VK_F6, VK_F7, VK_F8, VK_F9, VK_G, VK_H, VK_I,
    VK_J, VK_K, VK_L, VK_LEFT, VK_LWIN, VK_M, VK_MENU, VK_N, VK_O, VK_P, VK_Q, VK_R, VK_RETURN,
    VK_RIGHT, VK_S, VK_SHIFT, VK_SPACE, VK_T, VK_TAB, VK_U, VK_UP, VK_V, VK_W, VK_X, VK_Y, VK_Z,
};
use windows::Win32::UI::WindowsAndMessaging::{
    ChildWindowFromPointEx, CWP_SKIPDISABLED, CWP_SKIPINVISIBLE, CWP_SKIPTRANSPARENT, EnumWindows,
    GetAncestor, GetClassNameW, GetForegroundWindow, GetSystemMetrics, GetWindowTextLengthW,
    GetWindowTextW, GetWindowThreadProcessId, IsChild, IsWindowVisible, PostMessageW,
    QueryFullProcessImageNameW, SetForegroundWindow, GA_ROOT, SM_CXSCREEN, SM_CYSCREEN,
    WM_CHAR, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MBUTTONUP,
    WM_MOUSEMOVE, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
};

use crate::backend::ComputerBackend;
use crate::model::{
    ActRequest, BackendError, ComputerAction, ComputerAppEntry, ComputerFocusRequest,
    ComputerNode, ComputerNodeSource, ComputerNodeState, ComputerObserveResult, ComputerWindowEntry,
    DeliveryMode, ListAppsRequest, MapRequest, MapStrategy, Platform,
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
            ComputerAction::TypeText,
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
        // scrollable content surfaces Scroll so the Agent can page through.
        "document" => vec![ComputerAction::Focus, ComputerAction::Scroll],
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
        if base == "textbox"
            && element
                .CurrentIsPassword()
                .map(|b| b.as_bool())
                .unwrap_or(false)
        {
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
        let entry = grouped
            .entry(window.pid)
            .or_insert_with(|| ComputerAppEntry {
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

// ---------------------------------------------------------------------------
// Input synthesis helpers (SendInput — Win32 equivalent of CGEvent postToPid)
//
// ponytail: These mirror the macOS backend's CGEvent helpers. Semantic actions
// (ValuePattern / InvokePattern) stay preferred; SendInput is the fallback for
// hosts that don't expose a UIA pattern (Electron text fields, custom controls).
// ---------------------------------------------------------------------------

/// Absolute-coordinate normalization range used by SendInput mouse events
/// (0..=0xFFFF maps to the full primary monitor).
const MOUSE_COORD_MAX: i32 = 0xFFFF;

/// `(width, height)` of the primary monitor in pixels.
fn screen_size() -> (i32, i32) {
    unsafe {
        let width = GetSystemMetrics(SM_CXSCREEN);
        let height = GetSystemMetrics(SM_CYSCREEN);
        (width, height)
    }
}

/// Center of a UIA element's bounding rect, in screen-space pixels.
/// Returns None when the rect is empty or unavailable.
fn element_center(element: &IUIAutomationElement) -> Option<(i32, i32)> {
    unsafe {
        let rect = element.CurrentBoundingRectangle().ok()?;
        if rect.right <= rect.left || rect.bottom <= rect.top {
            return None;
        }
        Some(((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2))
    }
}

/// A resolved modifier key (virtual-key code only; SendInput handles flag state
/// implicitly via down/up ordering, unlike macOS CGEventFlags).
struct WinModifier {
    vk: VIRTUAL_KEY,
}

/// Map a single key token ("a", "return", "f5") to a Windows virtual-key code.
fn win_key_code_for(token: &str) -> Option<VIRTUAL_KEY> {
    Some(match token {
        "a" => VK_A, "b" => VK_B, "c" => VK_C, "d" => VK_D, "e" => VK_E, "f" => VK_F,
        "g" => VK_G, "h" => VK_H, "i" => VK_I, "j" => VK_J, "k" => VK_K, "l" => VK_L,
        "m" => VK_M, "n" => VK_N, "o" => VK_O, "p" => VK_P, "q" => VK_Q, "r" => VK_R,
        "s" => VK_S, "t" => VK_T, "u" => VK_U, "v" => VK_V, "w" => VK_W, "x" => VK_X,
        "y" => VK_Y, "z" => VK_Z,
        "0" => VK_0, "1" => VK_1, "2" => VK_2, "3" => VK_3, "4" => VK_4,
        "5" => VK_5, "6" => VK_6, "7" => VK_7, "8" => VK_8, "9" => VK_9,
        "return" | "enter" => VK_RETURN,
        "tab" => VK_TAB,
        "space" | "spacebar" => VK_SPACE,
        "escape" | "esc" => VK_ESCAPE,
        "backspace" | "back" => VK_BACK,
        "delete" | "del" => VK_DELETE,
        "left" => VK_LEFT,
        "right" => VK_RIGHT,
        "up" => VK_UP,
        "down" => VK_DOWN,
        "f1" => VK_F1, "f2" => VK_F2, "f3" => VK_F3, "f4" => VK_F4,
        "f5" => VK_F5, "f6" => VK_F6, "f7" => VK_F7, "f8" => VK_F8,
        "f9" => VK_F9, "f10" => VK_F10, "f11" => VK_F11, "f12" => VK_F12,
        _ => return None,
    })
}

/// Map a modifier token. `cmd`/`command` map to VK_CONTROL so macOS-style
/// shortcuts ("cmd+c") behave as their Windows equivalent on this platform;
/// `win`/`super`/`meta` map to the real Windows key.
fn parse_win_modifier(token: &str) -> Option<WinModifier> {
    Some(match token {
        "ctrl" | "control" | "cmd" | "command" => WinModifier { vk: VK_CONTROL },
        "shift" => WinModifier { vk: VK_SHIFT },
        "alt" | "option" => WinModifier { vk: VK_MENU },
        "win" | "super" | "meta" => WinModifier { vk: VK_LWIN },
        _ => return None,
    })
}

/// Parse a key spec like "ctrl+c" / "cmd+a" / "shift+win+s" into the primary
/// virtual-key code and a list of modifiers. Splits on '+', last token is the
/// key, preceding tokens are modifiers.
fn parse_win_key_spec(spec: &str) -> Option<(VIRTUAL_KEY, Vec<WinModifier>)> {
    let tokens: Vec<String> = spec
        .split('+')
        .map(|t| t.trim().to_lowercase())
        .filter(|t| !t.is_empty())
        .collect();
    if tokens.is_empty() {
        return None;
    }
    let key_token = tokens.last()?;
    let mut modifiers = Vec::new();
    for mod_token in tokens.iter().take(tokens.len() - 1) {
        modifiers.push(parse_win_modifier(mod_token)?);
    }
    let key = win_key_code_for(key_token)?;
    Some((key, modifiers))
}

/// Scroll wheel delta: 12 lines per page, matching the macOS backend.
fn scroll_wheel_delta(pages: f64) -> i32 {
    let raw = (12.0 * pages).round();
    raw.max(1.0).min(i32::MAX as f64) as i32
}

/// 10-step linear interpolation for drag, matching the macOS backend.
fn drag_points(from: (i32, i32), to: (i32, i32)) -> Vec<(i32, i32)> {
    (1..=10)
        .map(|step| {
            let progress = step as f64 / 10.0;
            let x = from.0 as f64 + (to.0 as f64 - from.0 as f64) * progress;
            let y = from.1 as f64 + (to.1 as f64 - from.1 as f64) * progress;
            (x.round() as i32, y.round() as i32)
        })
        .collect()
}

fn keyboard_input(vk: VIRTUAL_KEY, scan: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: scan,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn mouse_input(dx: i32, dy: i32, data: u32, flags: MOUSE_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx,
                dy,
                mouseData: data,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

/// Submit a batch of INPUT events via SendInput. No-ops on an empty slice.
fn send_inputs(inputs: &[INPUT]) {
    if inputs.is_empty() {
        return;
    }
    // SAFETY: SendInput reads `inputs.len()` INPUT records from the pointer;
    // the slice owns valid, fully-initialized INPUT values.
    unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        );
    }
}

/// Type text via KEYEVENTF_UNICODE — one keydown/keyup per UTF-16 code unit.
/// Mirrors macOS CGEventKeyboardSetUnicodeString.
fn send_unicode_input(text: &str) {
    for unit in text.encode_utf16() {
        let down = keyboard_input(VIRTUAL_KEY(0), unit, KEYEVENTF_UNICODE);
        let up = keyboard_input(VIRTUAL_KEY(0), unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
        send_inputs(&[down, up]);
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

/// Press a key with modifiers: modifier-down → key-down/up → modifier-up
/// (reverse order). Mirrors macOS PressKey CGEvent sequencing.
fn send_key_combo(vk: VIRTUAL_KEY, modifiers: &[WinModifier]) {
    let mut events: Vec<INPUT> = Vec::with_capacity(modifiers.len() * 2 + 2);
    for m in modifiers {
        events.push(keyboard_input(m.vk, 0, KEYBD_EVENT_FLAGS(0)));
    }
    events.push(keyboard_input(vk, 0, KEYBD_EVENT_FLAGS(0)));
    events.push(keyboard_input(vk, 0, KEYEVENTF_KEYUP));
    for m in modifiers.iter().rev() {
        events.push(keyboard_input(m.vk, 0, KEYEVENTF_KEYUP));
    }
    send_inputs(&events);
}

/// Send a mouse wheel event. `delta` in wheel clicks (positive = up/forward).
/// `mouseData` carries the full delta (delta × WHEEL_DELTA) as a signed u32.
fn send_scroll_wheel(delta: i32, horizontal: bool) {
    let data = ((delta as i64) * (WHEEL_DELTA as i64)) as u32;
    let flags = if horizontal {
        MOUSEEVENTF_HWHEEL
    } else {
        MOUSEEVENTF_WHEEL
    };
    send_inputs(&[mouse_input(0, 0, data, flags)]);
}

/// Move the mouse to screen-space (x, y) and apply the given button flags.
/// Coordinates are normalized to the 0..=0xFFFF range SendInput expects.
fn send_mouse_absolute(x: i32, y: i32, flags: MOUSE_EVENT_FLAGS, data: u32) {
    let (sw, sh) = screen_size();
    let dx = ((x as i64 * MOUSE_COORD_MAX as i64) / sw.max(1) as i64) as i32;
    let dy = ((y as i64 * MOUSE_COORD_MAX as i64) / sh.max(1) as i64) as i32;
    let flags = flags | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE;
    send_inputs(&[mouse_input(dx, dy, data, flags)]);
}

/// Right-click at screen-space (x, y).
fn send_right_click(x: i32, y: i32) {
    send_mouse_absolute(x, y, MOUSEEVENTF_RIGHTDOWN, 0);
    std::thread::sleep(std::time::Duration::from_millis(50));
    send_mouse_absolute(x, y, MOUSEEVENTF_RIGHTUP, 0);
}

/// Double left-click at screen-space (x, y).
fn send_double_click(x: i32, y: i32) {
    for _ in 0..2 {
        send_mouse_absolute(x, y, MOUSEEVENTF_LEFTDOWN, 0);
        std::thread::sleep(std::time::Duration::from_millis(10));
        send_mouse_absolute(x, y, MOUSEEVENTF_LEFTUP, 0);
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

// ---------------------------------------------------------------------------
// Background input helpers — PostMessage path (ported from cua-driver)
//
// Strategy: default to PostMessageW (async, no focus steal, no cursor move).
// Fall back to SendInput (existing helpers above) when the target is known to
// reject PostMessage, or when the caller explicitly requests delivery_mode:
// "foreground".
// ---------------------------------------------------------------------------

/// MK_LBUTTON / MK_RBUTTON — wParam flags for WM_*BUTTONDOWN messages.
const MK_LBUTTON: u32 = 0x0001;
const MK_RBUTTON: u32 = 0x0002;
const MK_MBUTTON: u32 = 0x0010;

/// Inter-key delay for PostMessage keyboard events (ms).
const POST_KEY_DELAY_MS: u64 = 4;
/// Inter-click delay for PostMessage mouse events (ms).
const POST_CLICK_DELAY_MS: u64 = 35;

// ── UIPI (User Interface Privilege Isolation) ──────────────────────────────

/// Windows mandatory integrity-level RIDs.
#[allow(dead_code)]
mod il {
    pub const UNTRUSTED: u32 = 0x0000;
    pub const LOW: u32 = 0x1000;
    pub const MEDIUM: u32 = 0x2000;
    pub const MEDIUM_PLUS: u32 = 0x2100;
    pub const HIGH: u32 = 0x3000;
    pub const SYSTEM: u32 = 0x4000;
}

/// Human-readable name for an integrity-level RID.
fn il_name(rid: u32) -> &'static str {
    match rid {
        il::UNTRUSTED => "Untrusted",
        il::LOW => "Low",
        il::MEDIUM => "Medium",
        il::MEDIUM_PLUS => "Medium+",
        il::HIGH => "High",
        il::SYSTEM => "System",
        _ => "unknown",
    }
}

/// Read the mandatory integrity level (last sub-authority of the integrity SID)
/// of a process handle. Returns `None` on any API failure.
unsafe fn process_integrity_rid(process: HANDLE) -> Option<u32> {
    let mut token = HANDLE::default();
    if OpenProcessToken(process, TOKEN_QUERY, &mut token).is_err() {
        return None;
    }
    let mut needed: u32 = 0;
    let _ = GetTokenInformation(token, TokenIntegrityLevel, None, 0, &mut needed);
    if needed == 0 {
        let _ = CloseHandle(token);
        return None;
    }
    let mut buf = vec![0u8; needed as usize];
    let ok = GetTokenInformation(
        token,
        TokenIntegrityLevel,
        Some(buf.as_mut_ptr() as _),
        needed,
        &mut needed,
    )
    .is_ok();
    let _ = CloseHandle(token);
    if !ok {
        return None;
    }
    let tml = &*(buf.as_ptr() as *const TOKEN_MANDATORY_LABEL);
    let sid = tml.Label.Sid;
    let count_ptr = GetSidSubAuthorityCount(sid);
    if count_ptr.is_null() {
        return None;
    }
    let count = *count_ptr;
    if count == 0 {
        return None;
    }
    let rid_ptr = GetSidSubAuthority(sid, (count - 1) as u32);
    if rid_ptr.is_null() {
        return None;
    }
    Some(*rid_ptr)
}

/// If posting messages from the current process to `hwnd` would be silently
/// blocked by UIPI, return a diagnostic string. Otherwise `None`.
///
/// UIPI blocks PostMessage of input-class messages from a lower-integrity
/// process to a higher-integrity window. The call still returns TRUE — the
/// message is queued but the elevated target's message pump filters it out.
/// Without this check, type_text / hotkey / click silently no-op against
/// elevated apps.
fn post_message_blocked_by_uipi(hwnd: HWND) -> Option<String> {
    let mut pid: u32 = 0;
    if unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) } == 0 || pid == 0 {
        return None;
    }
    let own = unsafe { process_integrity_rid(GetCurrentProcess()) }?;
    let target_handle =
        unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let target = unsafe { process_integrity_rid(target_handle) };
    let _ = unsafe { CloseHandle(target_handle) };
    let target = target?;
    if target > own {
        Some(format!(
            "UIPI: target hwnd 0x{:x} (pid {}) is at {} integrity; Lyra is at {} integrity. \
             PostMessage to a higher-integrity window is silently dropped. \
             Common cause: a Win32 app whose manifest requests requireAdministrator. \
             Run Lyra elevated to drive these, or use deliveryMode \"foreground\".",
            hwnd.0 as usize,
            pid,
            il_name(target),
            il_name(own),
        ))
    } else {
        None
    }
}

// ── Target window detection ────────────────────────────────────────────────

/// Window class prefixes for Chromium-based browsers and Electron apps.
/// PostMessage(WM_LBUTTONDOWN) to these does not fire DOM onclick handlers —
/// Chromium's input thread requires events with SendInput-queue origin.
const CHROMIUM_CLASS_PREFIXES: &[&str] = &["Chrome_WidgetWin_", "CefBrowser"];

/// Window classes for XAML / UWP / WinUI3 hosts. Their CoreInput dispatcher
/// only consumes events from the system input queue, not posted messages.
const XAML_HOST_CLASSES: &[&str] = &[
    "ApplicationFrameWindow",
    "WinUIDesktopWin32WindowClass",
    "Windows.UI.Core.CoreWindow",
    "Microsoft.UI.Content.DesktopChildSiteBridge",
];

/// Process .exe basenames that host XAML content (more reliable than class name
/// for modern apps like Win 11 Notepad which keeps the legacy "Notepad" class).
const XAML_HOST_EXES: &[&str] = &[
    "notepad.exe",
    "calculatorapp.exe",
    "calc.exe",
    "applicationframehost.exe",
    "photos.exe",
    "systemsettings.exe",
];

/// Window class prefixes for terminal emulators. PostMessage(WM_CHAR) is
/// silently dropped by these hosts — they consume keyboard input through
/// console / conpty channels, not the GUI message queue.
const TERMINAL_CLASS_PREFIXES: &[&str] = &[
    "CASCADIA_HOSTING_WINDOW_CLASS",
    "ConsoleWindowClass",
    "mintty",
    "nvim",
    "Vim",
];

/// Pure function: does `class_name` match a known Chromium-family class?
fn class_matches_chromium(class_name: &str) -> bool {
    !class_name.is_empty() && CHROMIUM_CLASS_PREFIXES.iter().any(|p| class_name.starts_with(p))
}

/// Pure function: does `class_name` OR `exe_basename` indicate a XAML host?
fn class_matches_xaml(class_name: &str, exe_basename: &str) -> bool {
    if XAML_HOST_CLASSES.iter().any(|c| class_name == *c) {
        return true;
    }
    let exe_lower = exe_basename.to_ascii_lowercase();
    XAML_HOST_EXES.iter().any(|e| exe_lower == *e)
}

/// Pure function: does `class_name` match a known terminal-host class?
fn class_matches_terminal(class_name: &str) -> bool {
    !class_name.is_empty() && TERMINAL_CLASS_PREFIXES.iter().any(|p| class_name.starts_with(p))
}

/// Read the window class name of `hwnd` via GetClassNameW.
fn hwnd_class_name(hwnd: HWND) -> String {
    let mut buf = [0u16; 256];
    let n = unsafe { GetClassNameW(hwnd, &mut buf) };
    if n <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..n as usize])
}

/// Read the owning process .exe basename of `hwnd`.
fn hwnd_exe_basename(hwnd: HWND) -> String {
    let mut pid: u32 = 0;
    let tid = unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if tid == 0 || pid == 0 {
        return String::new();
    }
    let handle = match unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) } {
        Ok(h) => h,
        Err(_) => return String::new(),
    };
    let mut buf = [0u16; 1024];
    let mut len: u32 = buf.len() as u32;
    let result = unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0),
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut len,
        )
    };
    let _ = unsafe { CloseHandle(handle) };
    if result.is_err() || len == 0 {
        return String::new();
    }
    let path = String::from_utf16_lossy(&buf[..len as usize]);
    path.rsplit(|c: char| c == '\\' || c == '/')
        .next()
        .unwrap_or(&path)
        .to_ascii_lowercase()
}

/// `true` if `hwnd` is a Chromium-based browser / Electron top-level frame.
fn is_chromium_target_window(hwnd: HWND) -> bool {
    class_matches_chromium(&hwnd_class_name(hwnd))
}

/// `true` if `hwnd` should bypass PostMessage and route through SendInput /
/// UIA patterns. Dual signal: window class name OR owning process .exe name.
fn is_xaml_host_window(hwnd: HWND) -> bool {
    let cls = hwnd_class_name(hwnd);
    let exe = hwnd_exe_basename(hwnd);
    class_matches_xaml(&cls, &exe)
}

/// `true` if `hwnd` is a known terminal emulator host.
fn is_terminal_window(hwnd: HWND) -> bool {
    class_matches_terminal(&hwnd_class_name(hwnd))
}

// ── Deepest child HWND resolution ──────────────────────────────────────────

/// Recurse from `root` down to the deepest visible child that contains
/// `screen_pt`, mirroring cua-driver's DeepestChildFromScreenPoint.
///
/// Posting to the deepest child avoids the top-level window responding to
/// WM_LBUTTONDOWN by activating itself (focus-steal).
fn deepest_child(root: HWND, screen_pt: POINT) -> (HWND, POINT) {
    let mut current = root;
    for _ in 0..16 {
        let mut client = screen_pt;
        unsafe {
            let _ = ScreenToClient(current, &mut client);
        }
        let child = unsafe {
            ChildWindowFromPointEx(
                current,
                client,
                CWP_SKIPINVISIBLE | CWP_SKIPDISABLED | CWP_SKIPTRANSPARENT,
            )
        };
        if child.0.is_null() || child == current {
            break;
        }
        if !unsafe { IsChild(root, child) }.as_bool() && child != root {
            break;
        }
        current = child;
    }
    let mut client = screen_pt;
    unsafe {
        let _ = ScreenToClient(current, &mut client);
    }
    (current, client)
}

// ── PostMessage mouse path ─────────────────────────────────────────────────

/// Pack two 16-bit integers into a LPARAM (low word = x, high word = y).
/// Matches the receiver-side GET_X_LPARAM / GET_Y_LPARAM sign-extension.
fn pack_lparam(x: i32, y: i32) -> LPARAM {
    let clamp = |v: i32| v.clamp(i16::MIN as i32, i16::MAX as i32) as u16;
    let packed = (clamp(x) as u32) | ((clamp(y) as u32) << 16);
    LPARAM(packed as isize)
}

/// Post a click at **client-area** coordinates of `root_hwnd`. Resolves to the
/// deepest child HWND at the click point before posting.
fn post_click(root: HWND, x: i32, y: i32, count: usize, button: &str) -> Result<(), BackendError> {
    let mut screen_pt = POINT { x, y };
    unsafe {
        let _ = ClientToScreen(root, &mut screen_pt);
    }
    let (target, client) = deepest_child(root, screen_pt);
    post_click_on(target, client.x, client.y, count, button)
}

/// Internal: post click messages to `hwnd` using its own client coordinates.
fn post_click_on(hwnd: HWND, x: i32, y: i32, count: usize, button: &str) -> Result<(), BackendError> {
    if let Some(msg) = post_message_blocked_by_uipi(hwnd) {
        return Err(BackendError::new("uipiBlocked", msg));
    }
    let (down_msg, up_msg, mk_flag) = match button {
        "right" => (WM_RBUTTONDOWN, WM_RBUTTONUP, MK_RBUTTON),
        "middle" => (WM_MBUTTONDOWN, WM_MBUTTONUP, MK_MBUTTON),
        _ => (WM_LBUTTONDOWN, WM_LBUTTONUP, MK_LBUTTON),
    };
    let lparam = pack_lparam(x, y);
    let wdown = WPARAM(mk_flag as usize);
    let wup = WPARAM(0);
    for i in 0..count {
        unsafe {
            let _ = PostMessageW(hwnd, WM_MOUSEMOVE, WPARAM(0), lparam);
            let _ = PostMessageW(hwnd, down_msg, wdown, lparam);
            std::thread::sleep(std::time::Duration::from_millis(POST_CLICK_DELAY_MS));
            let _ = PostMessageW(hwnd, up_msg, wup, lparam);
        }
        if i + 1 < count {
            std::thread::sleep(std::time::Duration::from_millis(80));
        }
    }
    Ok(())
}

/// Post a press-drag-release gesture via PostMessage.
/// Coordinates are root-hwnd client-area relative.
fn post_drag(
    hwnd: HWND,
    from_x: i32,
    from_y: i32,
    to_x: i32,
    to_y: i32,
    button: &str,
) -> Result<(), BackendError> {
    let (down_msg, up_msg, mk_flag) = match button {
        "right" => (WM_RBUTTONDOWN, WM_RBUTTONUP, MK_RBUTTON),
        "middle" => (WM_MBUTTONDOWN, WM_MBUTTONUP, MK_MBUTTON),
        _ => (WM_LBUTTONDOWN, WM_LBUTTONUP, MK_LBUTTON),
    };
    let wparam = WPARAM(mk_flag as usize);
    let steps = 10;
    for i in 1..=steps {
        let t = i as f64 / steps as f64;
        let ix = from_x + ((to_x - from_x) as f64 * t).round() as i32;
        let iy = from_y + ((to_y - from_y) as f64 * t).round() as i32;
        let lparam = pack_lparam(ix, iy);
        let msg = if i == 1 {
            // First step: button down + move
            unsafe {
                let _ = PostMessageW(hwnd, down_msg, wparam, pack_lparam(from_x, from_y));
                std::thread::sleep(std::time::Duration::from_millis(POST_CLICK_DELAY_MS));
                let _ = PostMessageW(hwnd, WM_MOUSEMOVE, wparam, lparam);
            }
            continue;
        } else if i == steps {
            // Last step: move + button up
            unsafe {
                let _ = PostMessageW(hwnd, WM_MOUSEMOVE, wparam, lparam);
                std::thread::sleep(std::time::Duration::from_millis(16));
                let _ = PostMessageW(hwnd, up_msg, WPARAM(0), lparam);
            }
            continue;
        }
        unsafe {
            let _ = PostMessageW(hwnd, WM_MOUSEMOVE, wparam, lparam);
        }
        std::thread::sleep(std::time::Duration::from_millis(16));
    }
    Ok(())
}

// ── PostMessage keyboard path ──────────────────────────────────────────────

/// If the target's UI thread has a focused child window that's a descendant
/// of `parent`, return that child. Uses AttachThreadInput to read the target
/// thread's focus state — top-level WindowProcs don't forward keyboard
/// messages to embedded editors automatically.
fn focused_descendant(parent: HWND) -> Option<HWND> {
    if parent.0.is_null() {
        return None;
    }
    let mut target_pid: u32 = 0;
    let target_thread = unsafe { GetWindowThreadProcessId(parent, Some(&mut target_pid)) };
    if target_thread == 0 {
        return None;
    }
    let our_thread = unsafe { GetCurrentThreadId() };
    let focused = if our_thread == target_thread {
        unsafe { windows::Win32::UI::Input::KeyboardAndMouse::GetFocus() }
    } else {
        let _ = unsafe { AttachThreadInput(our_thread, target_thread, true) };
        let f = unsafe { windows::Win32::UI::Input::KeyboardAndMouse::GetFocus() };
        let _ = unsafe { AttachThreadInput(our_thread, target_thread, false) };
        f
    };
    if focused.0.is_null() || focused == parent {
        return None;
    }
    if unsafe { IsChild(parent, focused) }.as_bool() {
        Some(focused)
    } else {
        None
    }
}

/// Post a Unicode character as WM_CHAR, retargeting to the focused child if any.
fn post_char(hwnd: HWND, ch: char) -> Result<(), BackendError> {
    if let Some(msg) = post_message_blocked_by_uipi(hwnd) {
        return Err(BackendError::new("uipiBlocked", msg));
    }
    let h = focused_descendant(hwnd).unwrap_or(hwnd);
    let code = ch as u32 as usize;
    unsafe {
        let _ = PostMessageW(h, WM_CHAR, WPARAM(code), LPARAM(1));
    }
    Ok(())
}

/// Post all characters in `text` as WM_CHAR messages. Line breaks (`\n`/`\r`)
/// are emitted as real Enter keystrokes (WM_KEYDOWN/UP VK_RETURN) — most
/// rich-text Win32 controls drop WM_CHAR(0x0A/0x0D).
fn post_type_text(hwnd: HWND, text: &str) -> Result<(), BackendError> {
    if let Some(msg) = post_message_blocked_by_uipi(hwnd) {
        return Err(BackendError::new("uipiBlocked", msg));
    }
    let h = focused_descendant(hwnd).unwrap_or(hwnd);
    let mut prev_was_cr = false;
    for ch in text.chars() {
        match ch {
            '\n' if prev_was_cr => {
                prev_was_cr = false;
            }
            '\n' | '\r' => {
                // Real Enter keystroke, not WM_CHAR(0x0D)
                let scan = unsafe { MapVirtualKeyW(VK_RETURN.0 as u32, MAPVK_VK_TO_VSC) };
                let lp_down = 1u32 | (scan << 16);
                let lp_up = lp_down | (1u32 << 30) | (1u32 << 31);
                unsafe {
                    let _ = PostMessageW(h, WM_KEYDOWN, WPARAM(VK_RETURN.0 as usize), LPARAM(lp_down as isize));
                    std::thread::sleep(std::time::Duration::from_millis(POST_KEY_DELAY_MS));
                    let _ = PostMessageW(h, WM_KEYUP, WPARAM(VK_RETURN.0 as usize), LPARAM(lp_up as isize));
                }
                prev_was_cr = ch == '\r';
                std::thread::sleep(std::time::Duration::from_millis(POST_KEY_DELAY_MS + 20));
            }
            _ => {
                prev_was_cr = false;
                let code = ch as u32 as usize;
                unsafe {
                    let _ = PostMessageW(h, WM_CHAR, WPARAM(code), LPARAM(1));
                }
                std::thread::sleep(std::time::Duration::from_millis(POST_KEY_DELAY_MS));
            }
        }
    }
    Ok(())
}

/// Press a key with modifiers via WM_KEYDOWN/WM_KEYUP. Has Alt → WM_SYSKEYDOWN/UP.
fn post_key(hwnd: HWND, vk: VIRTUAL_KEY, modifiers: &[WinModifier]) -> Result<(), BackendError> {
    if let Some(msg) = post_message_blocked_by_uipi(hwnd) {
        return Err(BackendError::new("uipiBlocked", msg));
    }
    let has_alt = modifiers.iter().any(|m| m.vk == VK_MENU);
    let scan = unsafe { MapVirtualKeyW(vk.0 as u32, MAPVK_VK_TO_VSC) };
    let repeat_lp = |scan: u32, extended: bool, key_up: bool| {
        let mut lp: u32 = 1;
        lp |= scan << 16;
        if extended {
            lp |= 1 << 24;
        }
        if key_up {
            lp |= (1 << 30) | (1 << 31);
        }
        LPARAM(lp as isize)
    };
    let (down_msg, up_msg) = if has_alt {
        (WM_SYSKEYDOWN, WM_SYSKEYUP)
    } else {
        (WM_KEYDOWN, WM_KEYUP)
    };
    unsafe {
        // Press modifiers
        for m in modifiers {
            let ms = MapVirtualKeyW(m.vk.0 as u32, MAPVK_VK_TO_VSC);
            let _ = PostMessageW(hwnd, down_msg, WPARAM(m.vk.0 as usize), repeat_lp(ms, false, false));
        }
        // Press key
        let _ = PostMessageW(hwnd, down_msg, WPARAM(vk.0 as usize), repeat_lp(scan, is_extended_key(vk), false));
        std::thread::sleep(std::time::Duration::from_millis(POST_KEY_DELAY_MS));
        // Release key
        let _ = PostMessageW(hwnd, up_msg, WPARAM(vk.0 as usize), repeat_lp(scan, is_extended_key(vk), true));
        // Release modifiers (reverse)
        for m in modifiers.iter().rev() {
            let ms = MapVirtualKeyW(m.vk.0 as u32, MAPVK_VK_TO_VSC);
            let _ = PostMessageW(hwnd, up_msg, WPARAM(m.vk.0 as usize), repeat_lp(ms, false, true));
        }
    }
    Ok(())
}

/// Whether a virtual key is an "extended key" (arrows, nav cluster, right-side
/// modifiers). Affects the EXTENDEDKEY flag in KEYBDINPUT / LPARAM.
fn is_extended_key(vk: VIRTUAL_KEY) -> bool {
    matches!(
        vk,
        VK_DELETE | VK_INSERT | VK_HOME | VK_END
            | VK_LEFT | VK_RIGHT | VK_UP | VK_DOWN
            | VK_RWIN
    )
}

// ── HWND acquisition from UIA element ──────────────────────────────────────

/// Get the top-level window HWND for a UIA element.
///
/// 1. `CurrentNativeWindowHandle` — the element's own window if it is one.
/// 2. Fallback: `element_center` + `WindowFromPoint` + `GetAncestor(GA_ROOT)`.
fn element_hwnd(element: &IUIAutomationElement) -> Option<HWND> {
    // SAFETY: CurrentNativeWindowHandle reads a property; 0 means "not a window".
    let hwnd_raw = unsafe { element.CurrentNativeWindowHandle().unwrap_or(0) };
    if hwnd_raw != 0 {
        return Some(HWND(hwnd_raw as isize));
    }
    // Fallback: hit-test the element center.
    let (x, y) = element_center(element)?;
    let top = unsafe { windows::Win32::UI::WindowsAndMessaging::WindowFromPoint(POINT { x, y }) };
    if top.0.is_null() {
        return None;
    }
    let root = unsafe { GetAncestor(top, GA_ROOT) };
    if root.0.is_null() {
        Some(top)
    } else {
        Some(root)
    }
}

/// Whether a PostMessage mouse path should be used for this HWND, or whether we
/// must fall back to SendInput.
fn prefers_postmessage_mouse(hwnd: HWND) -> bool {
    !is_chromium_target_window(hwnd) && !is_xaml_host_window(hwnd)
}

/// Whether a PostMessage keyboard path should be used for this HWND, or whether
/// we must fall back to SendInput.
fn prefers_postmessage_keyboard(hwnd: HWND) -> bool {
    !is_chromium_target_window(hwnd)
        && !is_xaml_host_window(hwnd)
        && !is_terminal_window(hwnd)
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

    fn act(&self, request: &ActRequest) -> Result<(), BackendError> {
        let Some(os_path) = os_path_from_ref(&request.os_ref) else {
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
            match request.action {
                ComputerAction::SetText => {
                    let pattern: IUIAutomationValuePattern = element
                        .GetCurrentPatternAs(UIA_ValuePatternId)
                        .map_err(|_| {
                            BackendError::new(
                                "patternUnavailable",
                                "Target does not support the Value pattern (setText).",
                            )
                        })?;
                    let value = BSTR::from(request.text.as_deref().unwrap_or_default());
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
                ComputerAction::TypeText => {
                    let text = request.text.as_deref().unwrap_or_default();
                    if text.is_empty() {
                        return Ok(());
                    }
                    // 1. ValuePattern.SetValue when the element is writable
                    //    (standard Edit / Document / ComboBox fields).
                    if let Ok(pattern) = element
                        .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                    {
                        let is_read_only = pattern
                            .CurrentIsReadOnly()
                            .map(|b| b.as_bool())
                            .unwrap_or(true);
                        if !is_read_only {
                            let value = BSTR::from(text);
                            return pattern.SetValue(&value).map_err(|error| {
                                BackendError::new("uiaActionFailed", error.message().to_string())
                            });
                        }
                    }
                    // 2. Background + non-terminal: PostMessage WM_CHAR (no focus steal).
                    //    Terminal hosts drop WM_CHAR; Chromium/XAML too. Fall through
                    //    to SendInput for those, or when delivery_mode is foreground.
                    if request.delivery_mode.is_foreground() {
                        let _ = element.SetFocus();
                    }
                    if !request.delivery_mode.is_foreground() {
                        if let Some(hwnd) = element_hwnd(&element) {
                            if prefers_postmessage_keyboard(hwnd) {
                                return post_type_text(hwnd, text);
                            }
                        }
                    }
                    // 3. Fallback: focus + SendInput Unicode key events.
                    send_unicode_input(text);
                    Ok(())
                }

                ComputerAction::PressKey => {
                    let spec = request.key.as_deref().ok_or_else(|| {
                        BackendError::new(
                            "invalidArgument",
                            "pressKey requires a key specification.",
                        )
                    })?;
                    let (vk, modifiers) = parse_win_key_spec(spec).ok_or_else(|| {
                        BackendError::new(
                            "invalidArgument",
                            format!("Unsupported key spec {spec:?}."),
                        )
                    })?;
                    // Background + no modifiers + non-Chromium/XAML: PostMessage.
                    // PostMessage does NOT update GetKeyState, so modifier combos
                    // (ctrl+s etc.) are silently dropped by TranslateAccelerator.
                    if !request.delivery_mode.is_foreground()
                        && modifiers.is_empty()
                    {
                        if let Some(hwnd) = element_hwnd(&element) {
                            if prefers_postmessage_keyboard(hwnd) {
                                return post_key(hwnd, vk, &modifiers);
                            }
                        }
                    }
                    // Fallback: focus + SendInput key combo.
                    let _ = element.SetFocus();
                    send_key_combo(vk, &modifiers);
                    Ok(())
                }

                ComputerAction::SecondaryAction => {
                    let action_name = request.action_name.as_deref().ok_or_else(|| {
                        BackendError::new(
                            "invalidArgument",
                            "secondaryAction requires an actionName.",
                        )
                    })?;
                    // ponytail: Windows UIA has no AXUIElementPerformAction
                    // equivalent. Map the three most common AX action names to
                    // coordinate-level primitives. The upgrade path is
                    // enumerating UIA patterns (Invoke / ExpandCollapse / ...).
                    match action_name {
                        "AXShowMenu" => {
                            let (x, y) = element_center(&element).ok_or_else(|| {
                                BackendError::new(
                                    "uiaActionFailed",
                                    "Target has no bounding rect for right-click.",
                                )
                            })?;
                            // Background + non-Chromium/XAML: PostMessage right-click.
                            if !request.delivery_mode.is_foreground() {
                                if let Some(hwnd) = element_hwnd(&element) {
                                    if prefers_postmessage_mouse(hwnd) {
                                        let mut pt = POINT { x, y };
                                        let _ = ScreenToClient(hwnd, &mut pt);
                                        return post_click(hwnd, pt.x, pt.y, 1, "right");
                                    }
                                }
                            }
                            send_right_click(x, y);
                            Ok(())
                        }
                        "AXOpen" => {
                            let (x, y) = element_center(&element).ok_or_else(|| {
                                BackendError::new(
                                    "uiaActionFailed",
                                    "Target has no bounding rect for double-click.",
                                )
                            })?;
                            // Background + non-Chromium/XAML: PostMessage double-click.
                            if !request.delivery_mode.is_foreground() {
                                if let Some(hwnd) = element_hwnd(&element) {
                                    if prefers_postmessage_mouse(hwnd) {
                                        let mut pt = POINT { x, y };
                                        let _ = ScreenToClient(hwnd, &mut pt);
                                        return post_click(hwnd, pt.x, pt.y, 2, "left");
                                    }
                                }
                            }
                            send_double_click(x, y);
                            Ok(())
                        }
                        "AXCancel" => {
                            // Background + non-Chromium/XAML: PostMessage VK_ESCAPE.
                            if !request.delivery_mode.is_foreground() {
                                if let Some(hwnd) = element_hwnd(&element) {
                                    if prefers_postmessage_keyboard(hwnd) {
                                        return post_key(hwnd, VK_ESCAPE, &[]);
                                    }
                                }
                            }
                            send_key_combo(VK_ESCAPE, &[]);
                            Ok(())
                        }
                        other => Err(BackendError::unsupported(format!(
                            "secondaryAction {other:?} is not mapped on the Windows backend."
                        ))),
                    }
                }

                ComputerAction::Scroll => {
                    let direction = request.direction.as_deref().unwrap_or("down");
                    let pages = request.pages.unwrap_or(1.0);
                    // 1. Prefer the semantic ScrollItemPattern.ScrollIntoView.
                    if let Ok(pattern) = element
                        .GetCurrentPatternAs::<IUIAutomationScrollItemPattern>(
                            UIA_ScrollItemPatternId,
                        )
                    {
                        if pattern
                            .ScrollIntoView()
                            .map_err(|error| {
                                BackendError::new("uiaActionFailed", error.message().to_string())
                            })
                            .is_ok()
                        {
                            return Ok(());
                        }
                    }
                    // 2. Fallback: position the cursor over the element center
                    //    and send a mouse wheel event.
                    let (x, y) = element_center(&element).ok_or_else(|| {
                        BackendError::new(
                            "uiaActionFailed",
                            "Target has no bounding rect for scroll wheel.",
                        )
                    })?;
                    let delta = scroll_wheel_delta(pages);
                    let (signed_delta, horizontal) = match direction {
                        "up" => (delta, false),
                        "down" => (-delta, false),
                        "left" => (delta, true),
                        "right" => (-delta, true),
                        _ => {
                            return Err(BackendError::new(
                                "invalidArgument",
                                format!("Unsupported scroll direction {direction:?}."),
                            ))
                        }
                    };
                    send_mouse_absolute(x, y, MOUSE_EVENT_FLAGS(0), 0);
                    send_scroll_wheel(signed_delta, horizontal);
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    Ok(())
                }

                ComputerAction::Drag => {
                    // PostMessage drag does NOT move the physical pointer, so it
                    // is safe in any session mode. Only SendInput drag (foreground
                    // delivery) requires shared mode.
                    if request.delivery_mode.is_foreground()
                        && !request.mode.allows_foreground_steal()
                    {
                        return Err(BackendError::unsupported(
                            "drag in foreground mode requires shared mode — it moves the physical pointer.",
                        ));
                    }
                    let from_x = request.from_x.ok_or_else(|| {
                        BackendError::new("invalidArgument", "drag requires fromX.")
                    })? as i32;
                    let from_y = request.from_y.ok_or_else(|| {
                        BackendError::new("invalidArgument", "drag requires fromY.")
                    })? as i32;
                    let to_x = request.to_x.ok_or_else(|| {
                        BackendError::new("invalidArgument", "drag requires toX.")
                    })? as i32;
                    let to_y = request.to_y.ok_or_else(|| {
                        BackendError::new("invalidArgument", "drag requires toY.")
                    })? as i32;
                    // Background + non-Chromium/XAML: PostMessage drag (no focus steal).
                    if !request.delivery_mode.is_foreground() {
                        if let Some(hwnd) = element_hwnd(&element) {
                            if prefers_postmessage_mouse(hwnd) {
                                let mut from_pt = POINT { x: from_x, y: from_y };
                                let mut to_pt = POINT { x: to_x, y: to_y };
                                let _ = ScreenToClient(hwnd, &mut from_pt);
                                let _ = ScreenToClient(hwnd, &mut to_pt);
                                return post_drag(
                                    hwnd,
                                    from_pt.x,
                                    from_pt.y,
                                    to_pt.x,
                                    to_pt.y,
                                    "left",
                                );
                            }
                        }
                    }
                    // Fallback: SendInput drag (move+down → 10× drag → up).
                    send_mouse_absolute(from_x, from_y, MOUSEEVENTF_LEFTDOWN, 0);
                    std::thread::sleep(std::time::Duration::from_millis(30));
                    for point in drag_points((from_x, from_y), (to_x, to_y)) {
                        send_mouse_absolute(point.0, point.1, MOUSEEVENTF_LEFTDOWN, 0);
                        std::thread::sleep(std::time::Duration::from_millis(16));
                    }
                    send_mouse_absolute(to_x, to_y, MOUSEEVENTF_LEFTUP, 0);
                    Ok(())
                }

                // Press / Focus: prefer InvokePattern; fall back to SetFocus so
                // focusable-but-not-invokable controls still work.
                _ => {
                    if let Ok(invoke) = element
                        .GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId)
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
        let focused_window = foreground_app
            .as_ref()
            .and_then(|app| app.windows.iter().find(|window| window.is_focused).cloned());
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scroll_wheel_delta_whole_pages() {
        assert_eq!(scroll_wheel_delta(1.0), 12);
        assert_eq!(scroll_wheel_delta(3.0), 36);
    }

    #[test]
    fn scroll_wheel_delta_fractional_pages() {
        assert_eq!(scroll_wheel_delta(0.5), 6);
        assert_eq!(scroll_wheel_delta(3.5), 42);
    }

    #[test]
    fn scroll_wheel_delta_clamps_minimum() {
        assert_eq!(scroll_wheel_delta(0.0), 1);
        assert_eq!(scroll_wheel_delta(-5.0), 1);
    }

    #[test]
    fn parse_win_key_spec_simple_key() {
        let (code, mods) = parse_win_key_spec("c").unwrap();
        assert_eq!(code, VK_C);
        assert!(mods.is_empty());
    }

    #[test]
    fn parse_win_key_spec_ctrl_combo() {
        let (code, mods) = parse_win_key_spec("ctrl+c").unwrap();
        assert_eq!(code, VK_C);
        assert_eq!(mods.len(), 1);
        assert_eq!(mods[0].vk, VK_CONTROL);
    }

    #[test]
    fn parse_win_key_spec_cmd_maps_to_ctrl() {
        let (code, mods) = parse_win_key_spec("cmd+a").unwrap();
        assert_eq!(code, VK_A);
        assert_eq!(mods[0].vk, VK_CONTROL);
    }

    #[test]
    fn parse_win_key_spec_multi_modifier() {
        let (code, mods) = parse_win_key_spec("shift+ctrl+s").unwrap();
        assert_eq!(code, VK_S);
        assert_eq!(mods.len(), 2);
        assert_eq!(mods[0].vk, VK_SHIFT);
        assert_eq!(mods[1].vk, VK_CONTROL);
    }

    #[test]
    fn parse_win_key_spec_unknown_returns_none() {
        assert!(parse_win_key_spec("ctrl+xyz").is_none());
    }

    #[test]
    fn parse_win_key_spec_case_insensitive() {
        let (code, _) = parse_win_key_spec("CTRL+TAB").unwrap();
        assert_eq!(code, VK_TAB);
    }

    #[test]
    fn drag_points_ten_steps() {
        let pts = drag_points((0, 0), (100, 50));
        assert_eq!(pts.len(), 10);
        assert_eq!(pts[0], (10, 5));
        assert_eq!(pts[9], (100, 50));
    }

    // ── PostMessage detector pure functions ────────────────────────────────

    #[test]
    fn class_matches_chromium_known_prefixes() {
        assert!(class_matches_chromium("Chrome_WidgetWin_0"));
        assert!(class_matches_chromium("Chrome_WidgetWin_1"));
        assert!(class_matches_chromium("CefBrowserWindow"));
        assert!(class_matches_chromium("CefBrowserWidget"));
    }

    #[test]
    fn class_matches_chromium_rejects_unrelated() {
        assert!(!class_matches_chromium("Notepad"));
        assert!(!class_matches_chromium("WinUIDesktopWin32WindowClass"));
        assert!(!class_matches_chromium(""));
    }

    #[test]
    fn class_matches_xaml_by_class_name() {
        assert!(class_matches_xaml("ApplicationFrameWindow", ""));
        assert!(class_matches_xaml("WinUIDesktopWin32WindowClass", ""));
        assert!(class_matches_xaml("Windows.UI.Core.CoreWindow", ""));
        assert!(class_matches_xaml(
            "Microsoft.UI.Content.DesktopChildSiteBridge",
            ""
        ));
    }

    #[test]
    fn class_matches_xaml_by_exe_name() {
        assert!(class_matches_xaml("", "notepad.exe"));
        assert!(class_matches_xaml("", "CalculatorApp.exe"));
        assert!(class_matches_xaml("", "calc.exe"));
        assert!(class_matches_xaml("", "ApplicationFrameHost.exe"));
        assert!(class_matches_xaml("", "Photos.exe"));
        assert!(class_matches_xaml("", "SystemSettings.exe"));
    }

    #[test]
    fn class_matches_xaml_rejects_unrelated() {
        assert!(!class_matches_xaml("Notepad", "explorer.exe"));
        assert!(!class_matches_xaml("Chrome_WidgetWin_0", "chrome.exe"));
    }

    #[test]
    fn class_matches_terminal_known_prefixes() {
        assert!(class_matches_terminal("CASCADIA_HOSTING_WINDOW_CLASS"));
        assert!(class_matches_terminal("ConsoleWindowClass"));
        assert!(class_matches_terminal("mintty"));
        assert!(class_matches_terminal("nvim"));
        assert!(class_matches_terminal("Vim"));
    }

    #[test]
    fn class_matches_terminal_rejects_unrelated() {
        assert!(!class_matches_terminal("Notepad"));
        assert!(!class_matches_terminal("Chrome_WidgetWin_0"));
        assert!(!class_matches_terminal(""));
    }

    // ── Integrity level RID mapping ────────────────────────────────────────

    #[test]
    fn il_name_known_rids() {
        assert_eq!(il_name(il::UNTRUSTED), "Untrusted");
        assert_eq!(il_name(il::LOW), "Low");
        assert_eq!(il_name(il::MEDIUM), "Medium");
        assert_eq!(il_name(il::MEDIUM_PLUS), "Medium+");
        assert_eq!(il_name(il::HIGH), "High");
        assert_eq!(il_name(il::SYSTEM), "System");
    }

    #[test]
    fn il_name_unknown_rid() {
        assert_eq!(il_name(0x9999), "unknown");
    }

    // ── LPARAM packing (MAKELPARAM equivalent) ─────────────────────────────

    #[test]
    fn pack_lparam_basic() {
        let lp = pack_lparam(100, 200);
        let x = (lp.0 as u32) & 0xFFFF;
        let y = ((lp.0 as u32) >> 16) & 0xFFFF;
        assert_eq!(x, 100);
        assert_eq!(y, 200);
    }

    #[test]
    fn pack_lparam_clamps_oversized() {
        let lp = pack_lparam(i32::MAX, i32::MIN);
        let x = (lp.0 as u32) & 0xFFFF;
        let y = ((lp.0 as u32) >> 16) & 0xFFFF;
        assert_eq!(x, i16::MAX as u16);
        assert_eq!(y, i16::MIN as u16);
    }
}
