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
    BackendError, Bounds, ComputerAction, ComputerNode, ComputerNodeSource, ComputerNodeState,
    MapRequest, MapStrategy, Platform,
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
    fn AXValueGetType(value: AXValueRef) -> c_int;
    fn AXValueGetValue(value: AXValueRef, the_type: c_int, value_ptr: *mut c_void) -> Boolean;
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
    let cf_string =
        unsafe { CFStringCreateWithCString(ptr::null(), c_string.as_ptr(), CFSTRING_ENCODING_UTF8) };
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

    fn act(
        &self,
        os_ref: &str,
        action: ComputerAction,
        text: Option<&str>,
    ) -> Result<(), BackendError> {
        ensure_trusted()?;
        let Some(os_path) = os_path_from_ref(os_ref) else {
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

        match action {
            ComputerAction::SetText => {
                let text = text.unwrap_or_default();
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
            // Press / Focus / Toggle / Select / Scroll all map to AXPress in v1;
            // richer actions (e.g. AXIncrement/AXScrollToVisible) can specialize later.
            _ => {
                let action_name = match action {
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
                        format!("AXUIElementPerformAction({action_name}) failed with AXError {err}."),
                    ))
                }
            }
        }
    }
}
