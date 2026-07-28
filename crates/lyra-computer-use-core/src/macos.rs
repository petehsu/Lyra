//! macOS Accessibility backend.
//!
//! Absorbs the CoreFoundation/AXUIElement FFI that previously lived inline in
//! `lyra-accessibility-napi` and promotes it to a [`ComputerBackend`]. The
//! `os_ref` scheme is `osax:<role-index-path>` (e.g. `osax:0/3/1`), which the
//! backend re-walks from the focused window at action time — an opaque token to
//! callers, a concrete path here (§6.1).
//!
//! Actions are performed through `AXUIElementPerformAction` / value-setting,
//! which act on the element directly and generally do not require pulling the
//! window to the foreground — this is what makes the semantic path naturally
//! "background + non-visual" (§0.3).

#![cfg(target_os = "macos")]

use std::ffi::{c_void, CString};
use std::os::raw::{c_char, c_int, c_uchar, c_ulong};
use std::ptr;

use crate::backend::ComputerBackend;
use crate::model::{
    ActRequest, BackendError, Bounds, ComputerAction, ComputerAppEntry, ComputerFocusRequest,
    ComputerNode, ComputerNodeSource, ComputerNodeState, ComputerObserveResult,
    ComputerWindowEntry, ListAppsRequest, MapRequest, MapStrategy, Platform,
};

type Boolean = c_uchar;
type CFIndex = isize;
type CFTypeID = c_ulong;
type CFTypeRef = *const c_void;
type CFStringRef = *const c_void;
type CFArrayRef = *const c_void;
type AXUIElementRef = *const c_void;
type AXValueRef = *const c_void;
type AXError = c_int;
type PidT = i32;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct CGSize {
    width: f64,
    height: f64,
}

const AX_ERROR_SUCCESS: AXError = 0;
const AX_VALUE_CGPOINT: c_int = 1;
const AX_VALUE_CGSIZE: c_int = 2;
const CFSTRING_ENCODING_UTF8: u32 = 0x0800_0100;

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> Boolean;
    fn AXUIElementCreateSystemWide() -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    fn AXUIElementSetAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: CFTypeRef,
    ) -> AXError;
    fn AXUIElementPerformAction(element: AXUIElementRef, action: CFStringRef) -> AXError;
    fn AXUIElementCreateApplication(pid: PidT) -> AXUIElementRef;
    fn AXUIElementGetPid(element: AXUIElementRef, pid: *mut PidT) -> AXError;
    fn AXValueGetType(value: AXValueRef) -> c_int;
    fn AXValueGetValue(value: AXValueRef, the_type: c_int, value_ptr: *mut c_void) -> Boolean;
    fn AXUIElementCopyActionNames(element: AXUIElementRef, names: *mut CFArrayRef) -> AXError;
    fn AXUIElementIsAttributeSettable(
        element: AXUIElementRef,
        attribute: CFStringRef,
        settable: *mut Boolean,
    ) -> AXError;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(value: CFTypeRef);
    fn CFRetain(value: CFTypeRef) -> CFTypeRef;
    fn CFGetTypeID(value: CFTypeRef) -> CFTypeID;
    fn CFStringGetTypeID() -> CFTypeID;
    fn CFBooleanGetTypeID() -> CFTypeID;
    fn CFBooleanGetValue(value: CFTypeRef) -> Boolean;
    fn CFStringGetLength(value: CFStringRef) -> CFIndex;
    fn CFStringCreateWithCString(
        alloc: CFTypeRef,
        c_str: *const c_char,
        encoding: u32,
    ) -> CFStringRef;
    fn CFStringGetCString(
        value: CFStringRef,
        buffer: *mut c_char,
        buffer_size: CFIndex,
        encoding: u32,
    ) -> Boolean;
    fn CFArrayGetTypeID() -> CFTypeID;
    fn CFArrayGetCount(array: CFArrayRef) -> CFIndex;
    fn CFArrayGetValueAtIndex(array: CFArrayRef, index: CFIndex) -> *const c_void;
    static kCFBooleanTrue: CFTypeRef;
}

// CoreGraphics event types and constants for CGEvent-based input simulation.
type CGEventSourceRef = *const c_void;
type CGEventRef = *const c_void;
type CGEventSourceStateID = u32;
type CGEventType = u32;
type CGMouseButton = u32;
type CGEventField = u32;
type CGEventFlags = u64;
type UniChar = u16;

const KCG_STATE_EVENT_SESSION: CGEventSourceStateID = 1;
const KCG_EVENT_MOUSE_MOVED: CGEventType = 5;
const KCG_EVENT_LEFT_MOUSE_DOWN: CGEventType = 1;
const KCG_EVENT_LEFT_MOUSE_UP: CGEventType = 2;
const KCG_EVENT_LEFT_MOUSE_DRAGGED: CGEventType = 6;
const KCG_EVENT_LEFT_MOUSE: CGMouseButton = 0;
const KCG_MOUSE_EVENT_CLICK_STATE: CGEventField = 1;
const KCG_SCROLL_EVENT_UNIT_LINE: u32 = 1;
const KCG_EVENT_FLAG_MASK_COMMAND: CGEventFlags = 0x100000;
const KCG_EVENT_FLAG_MASK_SHIFT: CGEventFlags = 0x200000;
const KCG_EVENT_FLAG_MASK_ALTERNATE: CGEventFlags = 0x80000;
const KCG_EVENT_FLAG_MASK_CONTROL: CGEventFlags = 0x40000;

// Virtual key codes from Carbon.HIToolbox (Events.h). Used by press_key.
const VK_ANSI_A: u16 = 0;
const VK_ANSI_S: u16 = 1;
const VK_ANSI_D: u16 = 2;
const VK_ANSI_F: u16 = 3;
const VK_ANSI_H: u16 = 4;
const VK_ANSI_G: u16 = 5;
const VK_ANSI_Z: u16 = 6;
const VK_ANSI_X: u16 = 7;
const VK_ANSI_C: u16 = 8;
const VK_ANSI_V: u16 = 9;
const VK_ANSI_B: u16 = 11;
const VK_ANSI_Q: u16 = 12;
const VK_ANSI_W: u16 = 13;
const VK_ANSI_E: u16 = 14;
const VK_ANSI_R: u16 = 15;
const VK_ANSI_Y: u16 = 16;
const VK_ANSI_T: u16 = 17;
const VK_ANSI_1: u16 = 18;
const VK_ANSI_2: u16 = 19;
const VK_ANSI_3: u16 = 20;
const VK_ANSI_4: u16 = 21;
const VK_ANSI_6: u16 = 22;
const VK_ANSI_5: u16 = 23;
const VK_ANSI_EQUAL: u16 = 24;
const VK_ANSI_9: u16 = 25;
const VK_ANSI_7: u16 = 26;
const VK_ANSI_MINUS: u16 = 27;
const VK_ANSI_8: u16 = 28;
const VK_ANSI_0: u16 = 29;
const VK_ANSI_RIGHT_BRACKET: u16 = 30;
const VK_ANSI_O: u16 = 31;
const VK_ANSI_U: u16 = 32;
const VK_ANSI_LEFT_BRACKET: u16 = 33;
const VK_ANSI_I: u16 = 34;
const VK_ANSI_P: u16 = 35;
const VK_RETURN: u16 = 36;
const VK_ANSI_L: u16 = 37;
const VK_ANSI_J: u16 = 38;
const VK_ANSI_QUOTE: u16 = 39;
const VK_ANSI_K: u16 = 40;
const VK_ANSI_SEMICOLON: u16 = 41;
const VK_ANSI_BACKSLASH: u16 = 42;
const VK_ANSI_COMMA: u16 = 43;
const VK_ANSI_SLASH: u16 = 44;
const VK_ANSI_N: u16 = 45;
const VK_ANSI_M: u16 = 46;
const VK_ANSI_PERIOD: u16 = 47;
const VK_TAB: u16 = 48;
const VK_SPACE: u16 = 49;
const VK_ANSI_GRAVE: u16 = 50;
const VK_DELETE: u16 = 51; // Backspace
const VK_ESCAPE: u16 = 53;
const VK_F5: u16 = 96;
const VK_F6: u16 = 97;
const VK_F7: u16 = 98;
const VK_F3: u16 = 99;
const VK_F8: u16 = 100;
const VK_F9: u16 = 101;
const VK_F11: u16 = 103;
const VK_F13: u16 = 105;
const VK_F14: u16 = 107;
const VK_F10: u16 = 109;
const VK_F12: u16 = 111;
const VK_F15: u16 = 113;
const VK_HELP: u16 = 114;
const VK_HOME: u16 = 115;
const VK_PAGE_UP: u16 = 116;
const VK_FORWARD_DELETE: u16 = 117;
const VK_F4: u16 = 118;
const VK_END: u16 = 119;
const VK_F2: u16 = 120;
const VK_PAGE_DOWN: u16 = 121;
const VK_F1: u16 = 122;
const VK_LEFT_ARROW: u16 = 123;
const VK_RIGHT_ARROW: u16 = 124;
const VK_DOWN_ARROW: u16 = 125;
const VK_UP_ARROW: u16 = 126;
const VK_COMMAND: u16 = 55;
const VK_SHIFT: u16 = 56;
const VK_CAPS_LOCK: u16 = 57;
const VK_OPTION: u16 = 58;
const VK_CONTROL: u16 = 59;
const VK_RIGHT_SHIFT: u16 = 60;
const VK_RIGHT_OPTION: u16 = 61;
const VK_RIGHT_CONTROL: u16 = 62;
const VK_FUNCTION: u16 = 63;
const VK_F16: u16 = 124;
const VK_F17: u16 = 125;
const VK_F18: u16 = 126;
const VK_F19: u16 = 127;
const VK_F20: u16 = 128;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventSourceCreate(stateID: CGEventSourceStateID) -> CGEventSourceRef;
    fn CGEventCreate(source: CGEventSourceRef, virtualKey: u16, keyDown: Boolean) -> CGEventRef;
    fn CGEventCreateMouseEvent(
        source: CGEventSourceRef,
        mouseType: CGEventType,
        mouseCursorPosition: CGPoint,
        mouseButton: CGMouseButton,
    ) -> CGEventRef;
    fn CGEventCreateScrollWheelEvent2(
        source: CGEventSourceRef,
        units: u32,
        wheelCount: u32,
        wheel1: i32,
        wheel2: i32,
        wheel3: i32,
    ) -> CGEventRef;
    fn CGEventPostToPid(pid: PidT, event: CGEventRef);
    fn CGEventSetIntegerValueField(event: CGEventRef, field: CGEventField, value: i64);
    fn CGEventSetFlags(event: CGEventRef, flags: CGEventFlags);
    fn CGEventKeyboardSetUnicodeString(
        event: CGEventRef,
        maxStringLength: UniChar,
        uniChars: *const UniChar,
        actualStringLength: UniChar,
    );
    fn CGEventGetLocation(event: CGEventRef) -> CGPoint;
    fn CGEventSourceFlagsState(source: CGEventSourceRef, state: u32) -> CGEventFlags;
}

/// RAII wrapper that releases the owned CoreFoundation reference on drop.
struct CfOwned(CFTypeRef);

impl CfOwned {
    fn new(value: CFTypeRef) -> Option<Self> {
        if value.is_null() {
            None
        } else {
            Some(Self(value))
        }
    }

    fn as_type(&self) -> CFTypeRef {
        self.0
    }
}

impl Drop for CfOwned {
    fn drop(&mut self) {
        unsafe {
            CFRelease(self.0);
        }
    }
}

fn cf_string(value: &str) -> Option<CfOwned> {
    let c_string = CString::new(value).ok()?;
    let cf_string = unsafe {
        CFStringCreateWithCString(ptr::null(), c_string.as_ptr(), CFSTRING_ENCODING_UTF8)
    };
    CfOwned::new(cf_string as CFTypeRef)
}

fn copy_attr(element: AXUIElementRef, attr: CFStringRef) -> Option<CfOwned> {
    let mut value: CFTypeRef = ptr::null();
    let err = unsafe { AXUIElementCopyAttributeValue(element, attr, &mut value) };
    if err == AX_ERROR_SUCCESS {
        CfOwned::new(value)
    } else {
        None
    }
}

fn copy_named_attr(element: AXUIElementRef, attr_name: &str) -> Option<CfOwned> {
    let attr = cf_string(attr_name)?;
    copy_attr(element, attr.as_type() as CFStringRef)
}

fn cf_string_to_string(value: CFStringRef) -> Option<String> {
    if value.is_null() {
        return None;
    }
    let len = unsafe { CFStringGetLength(value) };
    let buffer_len = len.saturating_mul(4).saturating_add(1).max(1) as usize;
    let mut buffer = vec![0_u8; buffer_len];
    let ok = unsafe {
        CFStringGetCString(
            value,
            buffer.as_mut_ptr() as *mut c_char,
            buffer_len as CFIndex,
            CFSTRING_ENCODING_UTF8,
        )
    };
    if ok == 0 {
        return None;
    }
    let nul = buffer
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(buffer.len());
    String::from_utf8(buffer[..nul].to_vec()).ok()
}

fn read_string_attr(element: AXUIElementRef, attr_name: &str) -> Option<String> {
    let value = copy_named_attr(element, attr_name)?;
    let is_string = unsafe { CFGetTypeID(value.as_type()) == CFStringGetTypeID() };
    if !is_string {
        return None;
    }
    cf_string_to_string(value.as_type() as CFStringRef).filter(|text| !text.trim().is_empty())
}

fn read_bool_attr(element: AXUIElementRef, attr_name: &str) -> Option<bool> {
    let value = copy_named_attr(element, attr_name)?;
    let is_bool = unsafe { CFGetTypeID(value.as_type()) == CFBooleanGetTypeID() };
    if !is_bool {
        return None;
    }
    Some(unsafe { CFBooleanGetValue(value.as_type()) } != 0)
}

fn read_bounds(element: AXUIElementRef) -> Option<Bounds> {
    let position_value = copy_named_attr(element, "AXPosition")?;
    let size_value = copy_named_attr(element, "AXSize")?;
    if unsafe { AXValueGetType(position_value.as_type() as AXValueRef) } != AX_VALUE_CGPOINT {
        return None;
    }
    if unsafe { AXValueGetType(size_value.as_type() as AXValueRef) } != AX_VALUE_CGSIZE {
        return None;
    }
    let mut point = CGPoint::default();
    let mut size = CGSize::default();
    let point_ok = unsafe {
        AXValueGetValue(
            position_value.as_type() as AXValueRef,
            AX_VALUE_CGPOINT,
            &mut point as *mut CGPoint as *mut c_void,
        )
    };
    let size_ok = unsafe {
        AXValueGetValue(
            size_value.as_type() as AXValueRef,
            AX_VALUE_CGSIZE,
            &mut size as *mut CGSize as *mut c_void,
        )
    };
    if point_ok == 0 || size_ok == 0 || size.width <= 0.0 || size.height <= 0.0 {
        return None;
    }
    Some(Bounds {
        x: point.x.round() as i64,
        y: point.y.round() as i64,
        width: size.width.round() as i64,
        height: size.height.round() as i64,
    })
}

fn normalize_role(role: &str) -> String {
    match role {
        "AXButton" => "button",
        "AXLink" => "link",
        // Secure (password) fields surface as AXSecureTextField; normalize to a
        // distinct role so the runtime can hard-block setText and value reads.
        "AXSecureTextField" => "securetextbox",
        "AXTextField" | "AXTextArea" => "textbox",
        "AXCheckBox" => "checkbox",
        "AXRadioButton" => "radio",
        "AXMenuItem" => "menuitem",
        "AXPopUpButton" => "combobox",
        "AXWindow" => "window",
        "AXGroup" => "group",
        "AXStaticText" => "statictext",
        "AXHeading" => "heading",
        "AXImage" => "image",
        other => other.strip_prefix("AX").unwrap_or(other),
    }
    .to_ascii_lowercase()
}

fn actions_for_role(role: &str) -> Vec<ComputerAction> {
    match role {
        "button" | "link" | "menuitem" => {
            vec![ComputerAction::Press, ComputerAction::Focus]
        }
        "textbox" => vec![
            ComputerAction::Focus,
            ComputerAction::SetText,
            ComputerAction::Press,
        ],
        // Secure fields are focusable but never offer setText: typing into
        // password fields is hard-blocked (§11).
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
        "statictext" | "heading" | "image" => Vec::new(),
        _ => vec![ComputerAction::Focus],
    }
}

/// Whether a normalized role is actionable for the `interactive` strategy.
fn is_actionable(role: &str) -> bool {
    !actions_for_role(role).is_empty()
}

fn read_state(element: AXUIElementRef, role: &str) -> ComputerNodeState {
    let mut state = ComputerNodeState::default();
    state.enabled = read_bool_attr(element, "AXEnabled");
    state.focused = read_bool_attr(element, "AXFocused");
    if role == "checkbox" || role == "radio" {
        // AXValue is 0/1 for toggles; surface as `checked`.
        if let Some(value) = copy_named_attr(element, "AXValue") {
            let is_bool = unsafe { CFGetTypeID(value.as_type()) == CFBooleanGetTypeID() };
            if is_bool {
                state.checked = Some(unsafe { CFBooleanGetValue(value.as_type()) } != 0);
            }
        }
    }
    state.selected = read_bool_attr(element, "AXSelected");
    state.expanded = read_bool_attr(element, "AXExpanded");
    state
}

fn root_element() -> Result<CfOwned, BackendError> {
    let system = unsafe { AXUIElementCreateSystemWide() };
    let system = CfOwned::new(system as CFTypeRef).ok_or_else(|| {
        BackendError::new("unavailable", "AXUIElementCreateSystemWide returned null")
    })?;
    copy_named_attr(system.as_type() as AXUIElementRef, "AXFocusedWindow")
        .or_else(|| copy_named_attr(system.as_type() as AXUIElementRef, "AXFocusedUIElement"))
        .ok_or_else(|| {
            BackendError::new(
                "unavailable",
                "No focused macOS accessibility window or element is available.",
            )
        })
}

/// Builds a [`ComputerNode`] for `element` at re-resolution `path`.
fn node_for_element(element: AXUIElementRef, path: &str) -> ComputerNode {
    let raw_role = read_string_attr(element, "AXRole").unwrap_or_else(|| "AXUnknown".to_string());
    let role = normalize_role(&raw_role);
    let secure = role == "securetextbox";
    // Never read the contents of a secure field, and never expose its value as
    // the accessible name either (§11).
    let name = if secure {
        read_string_attr(element, "AXTitle")
            .or_else(|| read_string_attr(element, "AXDescription"))
            .unwrap_or_else(|| "Secure input".to_string())
    } else {
        read_string_attr(element, "AXTitle")
            .or_else(|| read_string_attr(element, "AXDescription"))
            .or_else(|| read_string_attr(element, "AXValue"))
            .unwrap_or_default()
    };
    let value = if secure {
        None
    } else {
        read_string_attr(element, "AXValue")
    };
    let bounds = read_bounds(element);
    let state = read_state(element, &role);
    let actions = actions_for_role(&role);
    ComputerNode {
        os_ref: format!("osax:{path}"),
        platform: Platform::Darwin,
        app: None,
        window: None,
        role,
        name,
        value,
        bounds,
        state,
        actions,
        source: ComputerNodeSource::OsAx,
        secure,
        os_path: path.to_string(),
    }
}

fn traverse(
    element: AXUIElementRef,
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
        MapStrategy::Document => {
            !node.name.is_empty() || node.bounds.is_some() || node.role == "window"
        }
    };
    if keep {
        nodes.push(node);
    }
    let Some(children) = copy_named_attr(element, "AXChildren") else {
        return;
    };
    let is_array = unsafe { CFGetTypeID(children.as_type()) == CFArrayGetTypeID() };
    if !is_array {
        return;
    }
    let count = unsafe { CFArrayGetCount(children.as_type() as CFArrayRef) };
    for index in 0..count {
        if nodes.len() >= request.max_nodes {
            break;
        }
        let child = unsafe { CFArrayGetValueAtIndex(children.as_type() as CFArrayRef, index) };
        if child.is_null() {
            continue;
        }
        traverse(
            child as AXUIElementRef,
            &format!("{path}/{index}"),
            request,
            nodes,
        );
    }
}

/// Re-walks a `role-index` path from the focused window. Returns a retained
/// element the caller owns. This is the macOS realization of `os_ref` re-resolve.
fn resolve_path(root: AXUIElementRef, os_path: &str) -> Option<CfOwned> {
    let parts = os_path
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if parts.first().copied() != Some("0") {
        return None;
    }
    let mut current = CfOwned::new(unsafe { CFRetain(root as CFTypeRef) })?;
    for part in parts.into_iter().skip(1) {
        let index = part.parse::<CFIndex>().ok()?;
        let children = copy_named_attr(current.as_type() as AXUIElementRef, "AXChildren")?;
        let is_array = unsafe { CFGetTypeID(children.as_type()) == CFArrayGetTypeID() };
        if !is_array {
            return None;
        }
        let count = unsafe { CFArrayGetCount(children.as_type() as CFArrayRef) };
        if index < 0 || index >= count {
            return None;
        }
        let child = unsafe { CFArrayGetValueAtIndex(children.as_type() as CFArrayRef, index) };
        if child.is_null() {
            return None;
        }
        current = CfOwned::new(unsafe { CFRetain(child as CFTypeRef) })?;
    }
    Some(current)
}

/// Strips the `osax:` scheme from an `os_ref` to recover the role-index path.
fn os_path_from_ref(os_ref: &str) -> Option<&str> {
    os_ref.strip_prefix("osax:")
}

fn ensure_trusted() -> Result<(), BackendError> {
    if unsafe { AXIsProcessTrusted() } == 0 {
        return Err(BackendError::permission_denied(
            "macOS Accessibility permission is not granted for Lyra.",
        ));
    }
    Ok(())
}

fn system_wide_element() -> Result<CfOwned, BackendError> {
    let system = unsafe { AXUIElementCreateSystemWide() };
    CfOwned::new(system as CFTypeRef).ok_or_else(|| {
        BackendError::new("unavailable", "AXUIElementCreateSystemWide returned null")
    })
}

fn app_element_for_pid(pid: PidT) -> Option<CfOwned> {
    let app = unsafe { AXUIElementCreateApplication(pid) };
    CfOwned::new(app as CFTypeRef)
}

fn pid_for_element(element: AXUIElementRef) -> Option<PidT> {
    let mut pid: PidT = 0;
    let err = unsafe { AXUIElementGetPid(element, &mut pid) };
    if err == AX_ERROR_SUCCESS && pid > 0 {
        Some(pid)
    } else {
        None
    }
}

fn focused_application_element() -> Option<CfOwned> {
    let system = system_wide_element().ok()?;
    copy_named_attr(system.as_type() as AXUIElementRef, "AXFocusedApplication")
}

fn focused_ui_element() -> Option<CfOwned> {
    let system = system_wide_element().ok()?;
    copy_named_attr(system.as_type() as AXUIElementRef, "AXFocusedUIElement")
}

fn focused_window_element() -> Option<CfOwned> {
    let system = system_wide_element().ok()?;
    copy_named_attr(system.as_type() as AXUIElementRef, "AXFocusedWindow")
}

fn app_ref_for_pid(pid: PidT) -> String {
    format!("osxapp:{pid}")
}

fn window_ref_for_pid(pid: PidT, index: usize) -> String {
    format!("osxwin:{pid}/{index}")
}

fn parse_app_ref(app_ref: &str) -> Option<PidT> {
    app_ref.strip_prefix("osxapp:")?.parse().ok()
}

fn parse_window_ref(window_ref: &str) -> Option<(PidT, usize)> {
    let remainder = window_ref.strip_prefix("osxwin:")?;
    let (pid_text, index_text) = remainder.rsplit_once('/')?;
    Some((pid_text.parse().ok()?, index_text.parse().ok()?))
}

fn read_windows_for_app(app: AXUIElementRef, pid: PidT) -> Vec<ComputerWindowEntry> {
    let Some(children) = copy_named_attr(app, "AXWindows") else {
        return Vec::new();
    };
    let is_array = unsafe { CFGetTypeID(children.as_type()) == CFArrayGetTypeID() };
    if !is_array {
        return Vec::new();
    }
    let count = unsafe { CFArrayGetCount(children.as_type() as CFArrayRef) };
    let focused_window = focused_window_element();
    let mut windows = Vec::new();
    for index in 0..count {
        let child = unsafe { CFArrayGetValueAtIndex(children.as_type() as CFArrayRef, index) };
        if child.is_null() {
            continue;
        }
        let title = read_string_attr(child as AXUIElementRef, "AXTitle").unwrap_or_default();
        let is_focused = focused_window.as_ref().is_some_and(|focused| unsafe {
            CFGetTypeID(focused.as_type()) == CFGetTypeID(child as CFTypeRef)
        });
        windows.push(ComputerWindowEntry {
            window_ref: Some(window_ref_for_pid(pid, index as usize)),
            title,
            is_focused,
        });
    }
    windows
}

fn app_entry_for_pid(pid: PidT, is_foreground: bool) -> Option<ComputerAppEntry> {
    let app = app_element_for_pid(pid)?;
    let name = read_string_attr(app.as_type() as AXUIElementRef, "AXTitle")
        .or_else(|| libproc::proc_pid::name(pid).ok())
        .unwrap_or_else(|| format!("pid-{pid}"));
    let windows = read_windows_for_app(app.as_type() as AXUIElementRef, pid);
    if windows.is_empty() && !is_foreground {
        return None;
    }
    Some(ComputerAppEntry {
        app_ref: app_ref_for_pid(pid),
        name,
        pid: Some(pid as i64),
        bundle_id: None,
        is_foreground,
        windows,
    })
}

fn set_app_frontmost(pid: PidT) -> Result<(), BackendError> {
    let app = app_element_for_pid(pid).ok_or_else(|| {
        BackendError::new(
            "appNotFound",
            format!("No accessibility application exists for pid {pid}."),
        )
    })?;
    let attr = cf_string("AXFrontmost")
        .ok_or_else(|| BackendError::new("internal", "Failed to build AXFrontmost key."))?;
    let err = unsafe {
        AXUIElementSetAttributeValue(
            app.as_type() as AXUIElementRef,
            attr.as_type() as CFStringRef,
            kCFBooleanTrue,
        )
    };
    if err == AX_ERROR_SUCCESS {
        Ok(())
    } else {
        Err(BackendError::new(
            "focusFailed",
            format!("AXFrontmost failed with AXError {err} for pid {pid}."),
        ))
    }
}

fn raise_window(pid: PidT, index: usize) -> Result<(), BackendError> {
    let app = app_element_for_pid(pid).ok_or_else(|| {
        BackendError::new(
            "appNotFound",
            format!("No accessibility application exists for pid {pid}."),
        )
    })?;
    let children =
        copy_named_attr(app.as_type() as AXUIElementRef, "AXWindows").ok_or_else(|| {
            BackendError::new(
                "windowNotFound",
                format!("Application pid {pid} has no AXWindows."),
            )
        })?;
    let is_array = unsafe { CFGetTypeID(children.as_type()) == CFArrayGetTypeID() };
    if !is_array {
        return Err(BackendError::new(
            "windowNotFound",
            format!("Application pid {pid} has no window list."),
        ));
    }
    let count = unsafe { CFArrayGetCount(children.as_type() as CFArrayRef) };
    if index >= count as usize {
        return Err(BackendError::new(
            "windowNotFound",
            format!("Window index {index} is out of range for pid {pid}."),
        ));
    }
    let child =
        unsafe { CFArrayGetValueAtIndex(children.as_type() as CFArrayRef, index as CFIndex) };
    if child.is_null() {
        return Err(BackendError::new(
            "windowNotFound",
            format!("Window index {index} is null for pid {pid}."),
        ));
    }
    set_app_frontmost(pid)?;
    let action = cf_string("AXRaise")
        .ok_or_else(|| BackendError::new("internal", "Failed to build AXRaise action."))?;
    let err = unsafe {
        AXUIElementPerformAction(child as AXUIElementRef, action.as_type() as CFStringRef)
    };
    if err == AX_ERROR_SUCCESS {
        Ok(())
    } else {
        Err(BackendError::new(
            "focusFailed",
            format!("AXRaise failed with AXError {err} for pid {pid} window {index}."),
        ))
    }
}

// ---------------------------------------------------------------------------
// Key mapping (xdotool-style "cmd+c" → virtual key code + modifier flags)
// ---------------------------------------------------------------------------

/// Modifier key resolved to (flag, virtualKeyCode).
struct ParsedModifier {
    flag: CGEventFlags,
    key_code: u16,
}

/// Parse a key specification like "cmd+c", "shift+tab", "ctrl+a" into the
/// target key code and a list of modifiers. Returns None on unknown tokens.
fn parse_key_spec(spec: &str) -> Option<(u16, Vec<ParsedModifier>)> {
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
        modifiers.push(parse_modifier(mod_token)?);
    }
    let key_code = key_code_for(key_token)?;
    Some((key_code, modifiers))
}

fn parse_modifier(token: &str) -> Option<ParsedModifier> {
    match token {
        "cmd" | "command" | "super" | "meta" => Some(ParsedModifier {
            flag: KCG_EVENT_FLAG_MASK_COMMAND,
            key_code: VK_COMMAND,
        }),
        "shift" => Some(ParsedModifier {
            flag: KCG_EVENT_FLAG_MASK_SHIFT,
            key_code: VK_SHIFT,
        }),
        "option" | "alt" => Some(ParsedModifier {
            flag: KCG_EVENT_FLAG_MASK_ALTERNATE,
            key_code: VK_OPTION,
        }),
        "control" | "ctrl" => Some(ParsedModifier {
            flag: KCG_EVENT_FLAG_MASK_CONTROL,
            key_code: VK_CONTROL,
        }),
        _ => None,
    }
}

fn key_code_for(token: &str) -> Option<u16> {
    Some(match token {
        "a" => VK_ANSI_A,
        "b" => VK_ANSI_B,
        "c" => VK_ANSI_C,
        "d" => VK_ANSI_D,
        "e" => VK_ANSI_E,
        "f" => VK_ANSI_F,
        "g" => VK_ANSI_G,
        "h" => VK_ANSI_H,
        "i" => VK_ANSI_I,
        "j" => VK_ANSI_J,
        "k" => VK_ANSI_K,
        "l" => VK_ANSI_L,
        "m" => VK_ANSI_M,
        "n" => VK_ANSI_N,
        "o" => VK_ANSI_O,
        "p" => VK_ANSI_P,
        "q" => VK_ANSI_Q,
        "r" => VK_ANSI_R,
        "s" => VK_ANSI_S,
        "t" => VK_ANSI_T,
        "u" => VK_ANSI_U,
        "v" => VK_ANSI_V,
        "w" => VK_ANSI_W,
        "x" => VK_ANSI_X,
        "y" => VK_ANSI_Y,
        "z" => VK_ANSI_Z,
        "0" => VK_ANSI_0,
        "1" => VK_ANSI_1,
        "2" => VK_ANSI_2,
        "3" => VK_ANSI_3,
        "4" => VK_ANSI_4,
        "5" => VK_ANSI_5,
        "6" => VK_ANSI_6,
        "7" => VK_ANSI_7,
        "8" => VK_ANSI_8,
        "9" => VK_ANSI_9,
        "return" | "enter" => VK_RETURN,
        "tab" => VK_TAB,
        "space" | "spacebar" => VK_SPACE,
        "escape" | "esc" => VK_ESCAPE,
        "backspace" | "delete" => VK_DELETE,
        "forwarddelete" | "del" => VK_FORWARD_DELETE,
        "insert" => VK_HELP,
        "up" => VK_UP_ARROW,
        "down" => VK_DOWN_ARROW,
        "left" => VK_LEFT_ARROW,
        "right" => VK_RIGHT_ARROW,
        "home" => VK_HOME,
        "end" => VK_END,
        "pageup" | "page_up" | "prior" => VK_PAGE_UP,
        "pagedown" | "page_down" | "next" => VK_PAGE_DOWN,
        "caps_lock" => VK_CAPS_LOCK,
        "f1" => VK_F1,
        "f2" => VK_F2,
        "f3" => VK_F3,
        "f4" => VK_F4,
        "f5" => VK_F5,
        "f6" => VK_F6,
        "f7" => VK_F7,
        "f8" => VK_F8,
        "f9" => VK_F9,
        "f10" => VK_F10,
        "f11" => VK_F11,
        "f12" => VK_F12,
        "f13" => VK_F13,
        "f14" => VK_F14,
        "f15" => VK_F15,
        "f16" => VK_F16,
        "f17" => VK_F17,
        "f18" => VK_F18,
        "f19" => VK_F19,
        "f20" => VK_F20,
        "-" | "minus" => VK_ANSI_MINUS,
        "=" | "equal" => VK_ANSI_EQUAL,
        "[" | "left_bracket" => VK_ANSI_LEFT_BRACKET,
        "]" | "right_bracket" => VK_ANSI_RIGHT_BRACKET,
        "\\" | "backslash" => VK_ANSI_BACKSLASH,
        ";" | "semicolon" => VK_ANSI_SEMICOLON,
        "'" | "quote" => VK_ANSI_QUOTE,
        "`" | "grave" => VK_ANSI_GRAVE,
        "," | "comma" => VK_ANSI_COMMA,
        "." | "period" => VK_ANSI_PERIOD,
        "/" | "slash" => VK_ANSI_SLASH,
        _ => return None,
    })
}

// ---------------------------------------------------------------------------
// Input simulation helpers (CGEvent postToPid — does not steal foreground)
// ---------------------------------------------------------------------------

/// Scroll wheel delta: 12 lines per page, matching open-codex-computer-use.
fn scroll_wheel_delta(pages: f64) -> i32 {
    let raw = (12.0 * pages).round();
    let clamped = raw.max(1.0).min(i32::MAX as f64);
    clamped as i32
}

/// Split text into UTF-16 chunks of at most `max_units` code units, aligning
/// on Unicode scalar boundaries so surrogate pairs stay together.
fn unicode_chunks(text: &str, max_units: usize) -> Vec<Vec<UniChar>> {
    if max_units == 0 {
        return Vec::new();
    }
    let mut chunks: Vec<Vec<UniChar>> = Vec::new();
    let mut current: Vec<UniChar> = Vec::new();
    for ch in text.chars() {
        let units: Vec<UniChar> = String::from(ch).encode_utf16().collect();
        if !current.is_empty() && current.len() + units.len() > max_units {
            chunks.push(std::mem::take(&mut current));
        }
        current.extend(units);
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

/// ponytail: 10-step linear interpolation for drag. Not spring-smoothed;
/// upgrade to easing curve if visual quality matters.
fn drag_points(from: CGPoint, to: CGPoint) -> Vec<CGPoint> {
    (1..=10)
        .map(|step| {
            let progress = step as f64 / 10.0;
            CGPoint {
                x: from.x + (to.x - from.x) * progress,
                y: from.y + (to.y - from.y) * progress,
            }
        })
        .collect()
}

/// The macOS Accessibility [`ComputerBackend`].
pub struct MacBackend;

impl MacBackend {
    pub fn new() -> Self {
        MacBackend
    }
}

impl Default for MacBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl ComputerBackend for MacBackend {
    fn is_available(&self) -> bool {
        true
    }

    fn map(&self, request: &MapRequest) -> Result<Vec<ComputerNode>, BackendError> {
        ensure_trusted()?;
        let root = root_element()?;
        let mut nodes = Vec::new();
        traverse(root.as_type() as AXUIElementRef, "0", request, &mut nodes);
        Ok(nodes)
    }

    fn resolve(&self, os_ref: &str) -> Result<Option<ComputerNode>, BackendError> {
        ensure_trusted()?;
        let Some(os_path) = os_path_from_ref(os_ref) else {
            return Err(BackendError::new(
                "invalidOsRef",
                "Computer osRef must use the osax: scheme.",
            ));
        };
        let root = root_element()?;
        match resolve_path(root.as_type() as AXUIElementRef, os_path) {
            Some(element) => Ok(Some(node_for_element(
                element.as_type() as AXUIElementRef,
                os_path,
            ))),
            None => Ok(None),
        }
    }

    fn act(&self, request: &ActRequest) -> Result<(), BackendError> {
        ensure_trusted()?;
        let Some(os_path) = os_path_from_ref(&request.os_ref) else {
            return Err(BackendError::new(
                "invalidOsRef",
                "Computer osRef must use the osax: scheme.",
            ));
        };
        let root = root_element()?;
        let element = resolve_path(root.as_type() as AXUIElementRef, os_path).ok_or_else(|| {
            BackendError::stale_os_ref("Computer osRef is no longer present in the focused window.")
        })?;
        let element_ref = element.as_type() as AXUIElementRef;

        match request.action {
            ComputerAction::SetText => {
                let text = request.text.as_deref().unwrap_or_default();
                let attr = cf_string("AXValue")
                    .ok_or_else(|| BackendError::new("internal", "Failed to build AXValue key."))?;
                let value = cf_string(text).ok_or_else(|| {
                    BackendError::new("internal", "Failed to build AXValue payload.")
                })?;
                let err = unsafe {
                    AXUIElementSetAttributeValue(
                        element_ref,
                        attr.as_type() as CFStringRef,
                        value.as_type(),
                    )
                };
                if err == AX_ERROR_SUCCESS {
                    Ok(())
                } else {
                    Err(BackendError::new(
                        "osAxActionFailed",
                        format!("AXUIElementSetAttributeValue failed with AXError {err}."),
                    ))
                }
            }

            ComputerAction::TypeText => {
                let text = request.text.as_deref().unwrap_or_default();
                // Prefer AXValue set when the element supports it (covers
                // Electron/Feishu rich text that doesn't reliably receive
                // background keyboard events).
                let ax_value = cf_string("AXValue")
                    .ok_or_else(|| BackendError::new("internal", "Failed to build AXValue key."))?;
                let mut settable: Boolean = 0;
                let can_set = unsafe {
                    AXUIElementIsAttributeSettable(
                        element_ref,
                        ax_value.as_type() as CFStringRef,
                        &mut settable,
                    ) == AX_ERROR_SUCCESS
                        && settable != 0
                };
                if can_set {
                    let value = cf_string(text).ok_or_else(|| {
                        BackendError::new("internal", "Failed to build AXValue payload.")
                    })?;
                    let err = unsafe {
                        AXUIElementSetAttributeValue(
                            element_ref,
                            ax_value.as_type() as CFStringRef,
                            value.as_type(),
                        )
                    };
                    if err == AX_ERROR_SUCCESS {
                        return Ok(());
                    }
                }
                // Fallback: Unicode keyboard events via CGEvent postToPid.
                let pid = pid_for_element(element_ref).ok_or_else(|| {
                    BackendError::new("internal", "Cannot resolve pid for typeText target.")
                })?;
                let source = unsafe { CGEventSourceCreate(KCG_STATE_EVENT_SESSION) };
                if source.is_null() {
                    return Err(BackendError::new(
                        "internal",
                        "Failed to create CGEventSource for typeText.",
                    ));
                }
                for chunk in unicode_chunks(text, 64) {
                    let down = unsafe { CGEventCreate(source, 0, 1) };
                    let up = unsafe { CGEventCreate(source, 0, 0) };
                    if down.is_null() || up.is_null() {
                        continue;
                    }
                    let len = chunk.len() as UniChar;
                    unsafe {
                        CGEventKeyboardSetUnicodeString(down, len, chunk.as_ptr(), len);
                        CGEventKeyboardSetUnicodeString(up, len, chunk.as_ptr(), len);
                        CGEventPostToPid(pid, down);
                        CGEventPostToPid(pid, up);
                        // ponytail: 20ms sleep matches open-codex; not tunable yet.
                        std::thread::sleep(std::time::Duration::from_millis(20));
                    }
                }
                Ok(())
            }

            ComputerAction::PressKey => {
                let spec = request.key.as_deref().ok_or_else(|| {
                    BackendError::new("invalidArgument", "pressKey requires a key specification.")
                })?;
                let (key_code, modifiers) = parse_key_spec(spec).ok_or_else(|| {
                    BackendError::new("invalidArgument", format!("Unsupported key spec {spec:?}."))
                })?;
                let pid = pid_for_element(element_ref).ok_or_else(|| {
                    BackendError::new("internal", "Cannot resolve pid for pressKey target.")
                })?;
                let mut active_flags: CGEventFlags = 0;
                // Modifier keyDown
                for modifier in &modifiers {
                    let event = unsafe { CGEventCreate(std::ptr::null(), modifier.key_code, 1) };
                    if event.is_null() {
                        continue;
                    }
                    active_flags |= modifier.flag;
                    unsafe {
                        CGEventSetFlags(event, active_flags);
                        CGEventPostToPid(pid, event);
                    }
                }
                // Main key down + up
                let key_down = unsafe { CGEventCreate(std::ptr::null(), key_code, 1) };
                let key_up = unsafe { CGEventCreate(std::ptr::null(), key_code, 0) };
                if !key_down.is_null() && !key_up.is_null() {
                    unsafe {
                        CGEventSetFlags(key_down, active_flags);
                        CGEventSetFlags(key_up, active_flags);
                        CGEventPostToPid(pid, key_down);
                        CGEventPostToPid(pid, key_up);
                    }
                }
                // Modifier keyUp (reverse order)
                for modifier in modifiers.iter().rev() {
                    let event = unsafe { CGEventCreate(std::ptr::null(), modifier.key_code, 0) };
                    if event.is_null() {
                        continue;
                    }
                    active_flags &= !modifier.flag;
                    unsafe {
                        CGEventSetFlags(event, active_flags);
                        CGEventPostToPid(pid, event);
                    }
                }
                Ok(())
            }

            ComputerAction::SecondaryAction => {
                let action_name = request.action_name.as_deref().ok_or_else(|| {
                    BackendError::new("invalidArgument", "secondaryAction requires an actionName.")
                })?;
                // Verify the element exposes this action before performing it.
                let mut names: CFArrayRef = std::ptr::null();
                let err = unsafe { AXUIElementCopyActionNames(element_ref, &mut names) };
                if err != AX_ERROR_SUCCESS || names.is_null() {
                    return Err(BackendError::new(
                        "osAxActionFailed",
                        "Cannot enumerate accessibility actions for this element.",
                    ));
                }
                let count = unsafe { CFArrayGetCount(names) };
                let mut found = false;
                for index in 0..count {
                    let name_ref = unsafe { CFArrayGetValueAtIndex(names, index) };
                    if name_ref.is_null() {
                        continue;
                    }
                    if let Some(name_str) = cf_string_to_string(name_ref as CFStringRef) {
                        if name_str == action_name {
                            found = true;
                            break;
                        }
                    }
                }
                if !found {
                    return Err(BackendError::new(
                        "invalidArgument",
                        format!("{action_name:?} is not a valid action for this element."),
                    ));
                }
                let cf_action = cf_string(action_name).ok_or_else(|| {
                    BackendError::new("internal", "Failed to build AX action string.")
                })?;
                let err = unsafe {
                    AXUIElementPerformAction(element_ref, cf_action.as_type() as CFStringRef)
                };
                if err == AX_ERROR_SUCCESS {
                    Ok(())
                } else {
                    Err(BackendError::new(
                        "osAxActionFailed",
                        format!(
                            "AXUIElementPerformAction({action_name}) failed with AXError {err}."
                        ),
                    ))
                }
            }

            ComputerAction::Scroll => {
                let direction = request.direction.as_deref().unwrap_or("down");
                let pages = request.pages.unwrap_or(1.0);
                let pid = pid_for_element(element_ref).ok_or_else(|| {
                    BackendError::new("internal", "Cannot resolve pid for scroll target.")
                })?;
                let delta = scroll_wheel_delta(pages);
                let (wheel1, wheel2) = match direction {
                    "up" => (delta, 0),
                    "down" => (-delta, 0),
                    "left" => (0, delta),
                    "right" => (0, -delta),
                    _ => {
                        return Err(BackendError::new(
                            "invalidArgument",
                            format!("Unsupported scroll direction {direction:?}."),
                        ))
                    }
                };
                let event = unsafe {
                    CGEventCreateScrollWheelEvent2(
                        std::ptr::null(),
                        KCG_SCROLL_EVENT_UNIT_LINE,
                        2,
                        wheel1,
                        wheel2,
                        0,
                    )
                };
                if event.is_null() {
                    return Err(BackendError::new(
                        "internal",
                        "Failed to create scroll wheel event.",
                    ));
                }
                unsafe {
                    CGEventPostToPid(pid, event);
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                Ok(())
            }

            ComputerAction::Drag => {
                if !request.mode.allows_foreground_steal() {
                    return Err(BackendError::unsupported(
                        "drag requires shared mode — it moves the physical pointer.",
                    ));
                }
                let (from_x, from_y) = (request.from_x, request.from_y);
                let (to_x, to_y) = (request.to_x, request.to_y);
                let from_x = from_x
                    .ok_or_else(|| BackendError::new("invalidArgument", "drag requires fromX."))?;
                let from_y = from_y
                    .ok_or_else(|| BackendError::new("invalidArgument", "drag requires fromY."))?;
                let to_x =
                    to_x.ok_or_else(|| BackendError::new("invalidArgument", "drag requires toX."))?;
                let to_y =
                    to_y.ok_or_else(|| BackendError::new("invalidArgument", "drag requires toY."))?;
                let pid = pid_for_element(element_ref).ok_or_else(|| {
                    BackendError::new("internal", "Cannot resolve pid for drag target.")
                })?;
                let source = unsafe { CGEventSourceCreate(KCG_STATE_EVENT_SESSION) };
                if source.is_null() {
                    return Err(BackendError::new(
                        "internal",
                        "Failed to create CGEventSource for drag.",
                    ));
                }
                let from = CGPoint {
                    x: from_x,
                    y: from_y,
                };
                let to = CGPoint { x: to_x, y: to_y };
                // mouseMoved → leftMouseDown → 10× leftMouseDragged → leftMouseUp
                unsafe {
                    let moved = CGEventCreateMouseEvent(
                        source,
                        KCG_EVENT_MOUSE_MOVED,
                        from,
                        KCG_EVENT_LEFT_MOUSE,
                    );
                    if !moved.is_null() {
                        CGEventPostToPid(pid, moved);
                        std::thread::sleep(std::time::Duration::from_millis(30));
                    }
                    let down = CGEventCreateMouseEvent(
                        source,
                        KCG_EVENT_LEFT_MOUSE_DOWN,
                        from,
                        KCG_EVENT_LEFT_MOUSE,
                    );
                    if !down.is_null() {
                        CGEventSetIntegerValueField(down, KCG_MOUSE_EVENT_CLICK_STATE, 1);
                        CGEventPostToPid(pid, down);
                        std::thread::sleep(std::time::Duration::from_millis(30));
                    }
                    for point in drag_points(from, to) {
                        let dragged = CGEventCreateMouseEvent(
                            source,
                            KCG_EVENT_LEFT_MOUSE_DRAGGED,
                            point,
                            KCG_EVENT_LEFT_MOUSE,
                        );
                        if !dragged.is_null() {
                            CGEventSetIntegerValueField(dragged, KCG_MOUSE_EVENT_CLICK_STATE, 1);
                            CGEventPostToPid(pid, dragged);
                            std::thread::sleep(std::time::Duration::from_millis(16));
                        }
                    }
                    let up = CGEventCreateMouseEvent(
                        source,
                        KCG_EVENT_LEFT_MOUSE_UP,
                        to,
                        KCG_EVENT_LEFT_MOUSE,
                    );
                    if !up.is_null() {
                        CGEventSetIntegerValueField(up, KCG_MOUSE_EVENT_CLICK_STATE, 1);
                        CGEventPostToPid(pid, up);
                    }
                }
                Ok(())
            }

            // Press / Focus / Toggle / Select: AXPress / AXRaise via AXUIElementPerformAction.
            _ => {
                let action_name = match request.action {
                    ComputerAction::Focus => "AXRaise",
                    _ => "AXPress",
                };
                let cf_action = cf_string(action_name).ok_or_else(|| {
                    BackendError::new("internal", "Failed to build AX action string.")
                })?;
                let err = unsafe {
                    AXUIElementPerformAction(element_ref, cf_action.as_type() as CFStringRef)
                };
                if err == AX_ERROR_SUCCESS {
                    Ok(())
                } else {
                    Err(BackendError::new(
                        "osAxActionFailed",
                        format!(
                            "AXUIElementPerformAction({action_name}) failed with AXError {err}."
                        ),
                    ))
                }
            }
        }
    }

    fn list_apps(&self, request: &ListAppsRequest) -> Result<Vec<ComputerAppEntry>, BackendError> {
        ensure_trusted()?;
        let foreground_pid = focused_application_element()
            .and_then(|app| pid_for_element(app.as_type() as AXUIElementRef));

        let mut pids = libproc::processes::pids_by_type(libproc::processes::ProcFilter::All)
            .map_err(|error| BackendError::new("procListFailed", error.to_string()))?;
        pids.sort_unstable();
        pids.dedup();

        let mut apps = Vec::new();
        for pid in pids {
            let pid = pid as PidT;
            if pid <= 0 {
                continue;
            }
            let is_foreground = foreground_pid == Some(pid);
            if !request.include_background && !is_foreground {
                if app_element_for_pid(pid).is_none() {
                    continue;
                }
                let Some(app) = app_element_for_pid(pid) else {
                    continue;
                };
                let windows = read_windows_for_app(app.as_type() as AXUIElementRef, pid);
                if windows.is_empty() {
                    continue;
                }
            }
            if let Some(entry) = app_entry_for_pid(pid, is_foreground) {
                apps.push(entry);
            }
            if apps.len() >= request.max_apps {
                break;
            }
        }

        apps.sort_by(|left, right| {
            right
                .is_foreground
                .cmp(&left.is_foreground)
                .then_with(|| left.name.cmp(&right.name))
        });
        Ok(apps)
    }

    fn observe(&self) -> Result<ComputerObserveResult, BackendError> {
        ensure_trusted()?;
        let foreground_app = focused_application_element()
            .and_then(|app| pid_for_element(app.as_type() as AXUIElementRef))
            .and_then(|pid| app_entry_for_pid(pid, true));

        let focused_window = focused_window_element().map(|window| ComputerWindowEntry {
            window_ref: foreground_app
                .as_ref()
                .and_then(|app| app.pid)
                .and_then(|pid| {
                    foreground_app.as_ref().and_then(|entry| {
                        entry
                            .windows
                            .iter()
                            .position(|candidate| candidate.is_focused)
                            .map(|index| window_ref_for_pid(pid as PidT, index))
                    })
                }),
            title: read_string_attr(window.as_type() as AXUIElementRef, "AXTitle")
                .unwrap_or_default(),
            is_focused: true,
        });

        let focused_control = focused_ui_element()
            .map(|element| node_for_element(element.as_type() as AXUIElementRef, "focused"));

        Ok(ComputerObserveResult {
            foreground_app,
            focused_window,
            focused_control,
        })
    }

    fn focus(&self, request: &ComputerFocusRequest) -> Result<(), BackendError> {
        ensure_trusted()?;
        if request.bundle_id.is_some() {
            return Err(BackendError::new(
                "unsupported",
                "bundleId focus is not implemented on macOS yet; use appRef or pid.",
            ));
        }
        if let Some(window_ref) = request.window_ref.as_deref() {
            let Some((pid, index)) = parse_window_ref(window_ref) else {
                return Err(BackendError::new(
                    "invalidArgument",
                    "windowRef must use the osxwin:<pid>/<index> scheme on macOS.",
                ));
            };
            return raise_window(pid, index);
        }
        if let Some(title) = request.window_title.as_deref() {
            let apps = self.list_apps(&ListAppsRequest {
                max_apps: 100,
                include_background: true,
            })?;
            for app in &apps {
                for (index, window) in app.windows.iter().enumerate() {
                    if window.title != title {
                        continue;
                    }
                    let pid = window
                        .window_ref
                        .as_deref()
                        .and_then(parse_window_ref)
                        .map(|(pid, _)| pid)
                        .or_else(|| app.pid.map(|value| value as PidT))
                        .ok_or_else(|| {
                            BackendError::new(
                                "windowNotFound",
                                format!("Window titled {title:?} has no resolvable pid."),
                            )
                        })?;
                    return raise_window(pid, index);
                }
            }
            return Err(BackendError::new(
                "windowNotFound",
                format!("No window titled {title:?} was found."),
            ));
        }

        let pid = if let Some(app_ref) = request.app_ref.as_deref() {
            parse_app_ref(app_ref).ok_or_else(|| {
                BackendError::new(
                    "invalidArgument",
                    "appRef must use the osxapp:<pid> scheme on macOS.",
                )
            })?
        } else if let Some(pid) = request.pid {
            pid as PidT
        } else {
            return Err(BackendError::new(
                "invalidArgument",
                "computer.focus requires appRef, pid, windowRef, or windowTitle on macOS.",
            ));
        };

        set_app_frontmost(pid)
    }
}

// ---------------------------------------------------------------------------
// Pure-logic self-checks (no macOS framework calls, safe on any platform)
// ---------------------------------------------------------------------------

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
    fn parse_key_spec_simple_key() {
        let (code, mods) = parse_key_spec("c").expect("single key should parse");
        assert_eq!(code, VK_ANSI_C);
        assert!(mods.is_empty());
    }

    #[test]
    fn parse_key_spec_cmd_combo() {
        let (code, mods) = parse_key_spec("cmd+c").expect("cmd+c should parse");
        assert_eq!(code, VK_ANSI_C);
        assert_eq!(mods.len(), 1);
        assert_eq!(mods[0].flag, KCG_EVENT_FLAG_MASK_COMMAND);
        assert_eq!(mods[0].key_code, VK_COMMAND);
    }

    #[test]
    fn parse_key_spec_multi_modifier() {
        let (code, mods) = parse_key_spec("shift+cmd+a").expect("shift+cmd+a should parse");
        assert_eq!(code, VK_ANSI_A);
        assert_eq!(mods.len(), 2);
        assert_eq!(mods[0].flag, KCG_EVENT_FLAG_MASK_SHIFT);
        assert_eq!(mods[1].flag, KCG_EVENT_FLAG_MASK_COMMAND);
    }

    #[test]
    fn parse_key_spec_unknown_key_returns_none() {
        assert!(parse_key_spec("cmd+xyz").is_none());
    }

    #[test]
    fn parse_key_spec_case_insensitive() {
        let (code, _) = parse_key_spec("CMD+TAB").expect("case-insensitive parse");
        assert_eq!(code, VK_TAB);
    }

    #[test]
    fn unicode_chunks_ascii() {
        let chunks = unicode_chunks("hello", 64);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].len(), 5);
    }

    #[test]
    fn unicode_chunks_splits_on_boundary() {
        let chunks = unicode_chunks("abcdef", 3);
        assert_eq!(chunks.len(), 2);
        assert_eq!(
            chunks[0],
            vec![b'a' as UniChar, b'b' as UniChar, b'c' as UniChar]
        );
        assert_eq!(
            chunks[1],
            vec![b'd' as UniChar, b'e' as UniChar, b'f' as UniChar]
        );
    }

    #[test]
    fn unicode_chunks_surrogate_pair_stays_together() {
        // U+1F600 (😀) is a surrogate pair (2 UTF-16 units).
        // With max_units=2, it must stay in one chunk.
        let chunks = unicode_chunks("a😀b", 2);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].len(), 1); // 'a'
        assert_eq!(chunks[1].len(), 2); // surrogate pair
        assert_eq!(chunks[2].len(), 1); // 'b'
    }
}
