use napi::{Error, Result, Status};
use napi_derive::napi;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadOsAxRequest {
    max_nodes: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActOsAxRequest {
    os_path: String,
    interaction: Option<String>,
}

#[napi(js_name = "readOsAxTreeJson")]
pub fn read_os_ax_tree_json(payload: String) -> Result<String> {
    let request = serde_json::from_str::<ReadOsAxRequest>(&payload).unwrap_or(ReadOsAxRequest {
        max_nodes: Some(120),
    });
    os_ax::read_tree(request.max_nodes.unwrap_or(120).clamp(1, 300))
        .map(|value| value.to_string())
        .map_err(|message| Error::new(Status::GenericFailure, message))
}

#[napi(js_name = "actOnOsAxNodeJson")]
pub fn act_on_os_ax_node_json(payload: String) -> Result<String> {
    let request = serde_json::from_str::<ActOsAxRequest>(&payload).map_err(|error| {
        Error::new(
            Status::InvalidArg,
            format!("invalid OS AX action payload: {error}"),
        )
    })?;
    os_ax::act_on_node(
        &request.os_path,
        request.interaction.as_deref().unwrap_or("click"),
    )
    .map(|value| value.to_string())
    .map_err(|message| Error::new(Status::GenericFailure, message))
}

// Computer Use semantic surface. These delegate to `lyra-computer-use-core`,
// which owns the cross-platform ComputerNode/osRef contract and the act -> diff
// closed loop. This crate is the macOS N-API shim for that core; Windows/Linux
// shims plug the same facade behind their own backends. See
// `Desktop-Computer-Use-Architecture.md`.

#[napi(js_name = "computerMapJson")]
pub fn computer_map_json(payload: String) -> String {
    lyra_computer_use_core::map_json(&payload)
}

#[napi(js_name = "computerFindJson")]
pub fn computer_find_json(payload: String) -> String {
    lyra_computer_use_core::find_json(&payload)
}

#[napi(js_name = "computerActJson")]
pub fn computer_act_json(payload: String) -> String {
    lyra_computer_use_core::act_json(&payload)
}

#[napi(js_name = "computerDiffJson")]
pub fn computer_diff_json(payload: String) -> String {
    lyra_computer_use_core::diff_json(&payload)
}

#[napi(js_name = "computerExplainJson")]
pub fn computer_explain_json(payload: String) -> String {
    lyra_computer_use_core::explain_json(&payload)
}

#[napi(js_name = "computerListAppsJson")]
pub fn computer_list_apps_json(payload: String) -> String {
    lyra_computer_use_core::list_apps_json(&payload)
}

#[napi(js_name = "computerObserveJson")]
pub fn computer_observe_json(payload: String) -> String {
    lyra_computer_use_core::observe_json(&payload)
}

#[napi(js_name = "computerFocusJson")]
pub fn computer_focus_json(payload: String) -> String {
    lyra_computer_use_core::focus_json(&payload)
}

#[cfg(not(target_os = "macos"))]
mod os_ax {
    use serde_json::{json, Value};

    pub(super) fn read_tree(_max_nodes: usize) -> std::result::Result<Value, String> {
        Ok(json!({
            "ok": true,
            "platform": std::env::consts::OS,
            "status": {
                "ok": false,
                "platform": std::env::consts::OS,
                "state": "unsupported",
                "message": "OS Accessibility tree reading is only implemented for macOS."
            },
            "nodes": []
        }))
    }

    pub(super) fn act_on_node(
        _os_path: &str,
        _interaction: &str,
    ) -> std::result::Result<Value, String> {
        Ok(json!({
            "ok": false,
            "platform": std::env::consts::OS,
            "error": {
                "kind": "unsupported",
                "message": "OS Accessibility actions are only implemented for macOS."
            }
        }))
    }
}

#[cfg(target_os = "macos")]
mod os_ax {
    use serde_json::{json, Value};
    use std::ffi::{c_void, CString};
    use std::os::raw::{c_char, c_int, c_uchar, c_ulong};
    use std::ptr;

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

    fn status(
        state: &str,
        ok: bool,
        message: impl Into<String>,
        node_count: Option<usize>,
    ) -> Value {
        json!({
            "ok": ok,
            "platform": "macos",
            "state": state,
            "message": message.into(),
            "nodeCount": node_count
        })
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

    fn read_bounds(element: AXUIElementRef) -> Option<Value> {
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
        Some(json!({
            "x": point.x.round() as i64,
            "y": point.y.round() as i64,
            "width": size.width.round() as i64,
            "height": size.height.round() as i64
        }))
    }

    fn normalize_role(role: &str) -> String {
        match role {
            "AXButton" => "button",
            "AXLink" => "link",
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

    fn capabilities_for_role(role: &str, has_bounds: bool) -> Vec<&'static str> {
        match role {
            "button" | "link" | "menuitem" => {
                if has_bounds {
                    vec!["click", "focus", "press"]
                } else {
                    vec!["focus", "press"]
                }
            }
            "textbox" | "combobox" => vec!["focus", "type", "press"],
            "checkbox" | "radio" => {
                if has_bounds {
                    vec!["focus", "toggle", "click", "press"]
                } else {
                    vec!["focus", "toggle", "press"]
                }
            }
            "statictext" | "heading" => Vec::new(),
            _ => {
                if has_bounds {
                    vec!["focus", "click"]
                } else {
                    vec!["focus"]
                }
            }
        }
    }

    fn root_element() -> std::result::Result<CfOwned, String> {
        let system = unsafe { AXUIElementCreateSystemWide() };
        let system = CfOwned::new(system as CFTypeRef)
            .ok_or_else(|| "AXUIElementCreateSystemWide returned null".to_string())?;
        copy_named_attr(system.as_type() as AXUIElementRef, "AXFocusedWindow")
            .or_else(|| copy_named_attr(system.as_type() as AXUIElementRef, "AXFocusedUIElement"))
            .ok_or_else(|| {
                "No focused macOS accessibility window or element is available.".to_string()
            })
    }

    fn traverse(element: AXUIElementRef, path: &str, max_nodes: usize, nodes: &mut Vec<Value>) {
        if nodes.len() >= max_nodes {
            return;
        }
        let raw_role =
            read_string_attr(element, "AXRole").unwrap_or_else(|| "AXUnknown".to_string());
        let role = normalize_role(&raw_role);
        let name = read_string_attr(element, "AXTitle")
            .or_else(|| read_string_attr(element, "AXDescription"))
            .or_else(|| read_string_attr(element, "AXValue"))
            .unwrap_or_default();
        let screen_bounds = read_bounds(element);
        if !name.is_empty() || screen_bounds.is_some() || role == "window" {
            let capabilities = capabilities_for_role(&role, screen_bounds.is_some());
            nodes.push(json!({
                "osPath": path,
                "role": role,
                "name": name,
                "screenBounds": screen_bounds,
                "actionCapabilities": capabilities
            }));
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
            if nodes.len() >= max_nodes {
                break;
            }
            let child = unsafe { CFArrayGetValueAtIndex(children.as_type() as CFArrayRef, index) };
            if child.is_null() {
                continue;
            }
            traverse(
                child as AXUIElementRef,
                &format!("{path}/{index}"),
                max_nodes,
                nodes,
            );
        }
    }

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

    pub(super) fn read_tree(max_nodes: usize) -> std::result::Result<Value, String> {
        if unsafe { AXIsProcessTrusted() } == 0 {
            return Ok(json!({
                "ok": true,
                "platform": "macos",
                "status": status(
                    "permissionDenied",
                    false,
                    "macOS Accessibility permission is not granted for Lyra.",
                    None,
                ),
                "nodes": []
            }));
        }
        let root = match root_element() {
            Ok(root) => root,
            Err(message) => {
                return Ok(json!({
                    "ok": true,
                    "platform": "macos",
                    "status": status("unavailable", false, message, None),
                    "nodes": []
                }));
            }
        };
        let mut nodes = Vec::new();
        traverse(root.as_type() as AXUIElementRef, "0", max_nodes, &mut nodes);
        Ok(json!({
            "ok": true,
            "platform": "macos",
            "status": status("available", true, "macOS Accessibility tree was read.", Some(nodes.len())),
            "nodes": nodes
        }))
    }

    pub(super) fn act_on_node(
        os_path: &str,
        interaction: &str,
    ) -> std::result::Result<Value, String> {
        if unsafe { AXIsProcessTrusted() } == 0 {
            return Ok(json!({
                "ok": false,
                "platform": "macos",
                "error": {
                    "kind": "permissionDenied",
                    "message": "macOS Accessibility permission is not granted for Lyra."
                }
            }));
        }
        if !matches!(interaction, "click" | "select" | "toggle") {
            return Ok(json!({
                "ok": false,
                "platform": "macos",
                "error": {
                    "kind": "unsupportedInteraction",
                    "message": "OS AX v1 supports click/select/toggle through AXPress."
                }
            }));
        }
        let root = root_element()?;
        let Some(element) = resolve_path(root.as_type() as AXUIElementRef, os_path) else {
            return Ok(json!({
                "ok": false,
                "platform": "macos",
                "error": {
                    "kind": "staleOsAxRef",
                    "message": "OS AX path is no longer present in the focused window."
                }
            }));
        };
        let action = cf_string("AXPress")
            .ok_or_else(|| "Failed to create AXPress action string.".to_string())?;
        let err = unsafe {
            AXUIElementPerformAction(
                element.as_type() as AXUIElementRef,
                action.as_type() as CFStringRef,
            )
        };
        if err == AX_ERROR_SUCCESS {
            Ok(json!({
                "ok": true,
                "platform": "macos",
                "method": "osAx",
                "osPath": os_path
            }))
        } else {
            Ok(json!({
                "ok": false,
                "platform": "macos",
                "error": {
                    "kind": "osAxActionFailed",
                    "message": format!("AXUIElementPerformAction failed with AXError {err}.")
                }
            }))
        }
    }
}
