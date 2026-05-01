use std::ffi::{CStr, CString, NulError};
use std::os::raw::{c_char, c_int, c_void};
use std::ptr::NonNull;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ResourceKernelError {
    #[error("resource field contains an interior nul byte")]
    InvalidString(#[from] NulError),
    #[error("resource kernel allocation failed")]
    AllocationFailed,
    #[error("resource kernel returned invalid utf8")]
    InvalidUtf8,
    #[error("resource snapshot json is invalid: {0}")]
    InvalidSnapshot(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, ResourceKernelError>;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceRecord {
    pub resource_id: String,
    pub kind: String,
    pub label: String,
    pub view_id: String,
    pub state_key: String,
    pub core_key: String,
    pub lifecycle_state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tab_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(default)]
    pub pid: i64,
    #[serde(default)]
    pub visible: bool,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub updated_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessResourceSnapshot {
    pub pid: i64,
    pub memory_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSnapshot {
    pub generation: u64,
    pub captured_at: u64,
    pub process: ProcessResourceSnapshot,
    pub resources: Vec<ResourceRecord>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityActionRequest {
    pub activity_id: String,
    pub action: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityActionResult {
    pub ok: bool,
    pub supported: bool,
    pub message: String,
}

unsafe extern "C" {
    fn lyra_resource_kernel_create() -> *mut c_void;
    fn lyra_resource_kernel_destroy(handle: *mut c_void);
    fn lyra_resource_kernel_register_or_update(
        handle: *mut c_void,
        resource_id: *const c_char,
        kind: *const c_char,
        label: *const c_char,
        view_id: *const c_char,
        state_key: *const c_char,
        core_key: *const c_char,
        lifecycle_state: *const c_char,
        tab_id: *const c_char,
        address: *const c_char,
        pid: i64,
        visible: c_int,
    ) -> u64;
    fn lyra_resource_kernel_remove(handle: *mut c_void, resource_id: *const c_char) -> u64;
    fn lyra_resource_kernel_request_lifecycle(
        handle: *mut c_void,
        resource_id: *const c_char,
        target_state: *const c_char,
    ) -> u64;
    fn lyra_resource_kernel_read_snapshot_json(handle: *mut c_void) -> *mut c_char;
    fn lyra_resource_kernel_read_system_snapshot_json(handle: *mut c_void) -> *mut c_char;
    fn lyra_resource_kernel_request_activity_action(
        handle: *mut c_void,
        activity_id: *const c_char,
        action: *const c_char,
    ) -> *mut c_char;
    fn lyra_resource_kernel_free_string(value: *mut c_char);
}

pub struct ResourceKernel {
    handle: NonNull<c_void>,
}

// The native kernel serializes access internally with a mutex and does not call
// back into Rust, so the handle can be moved across NAPI worker threads.
unsafe impl Send for ResourceKernel {}
unsafe impl Sync for ResourceKernel {}

impl ResourceKernel {
    pub fn new() -> Result<Self> {
        let handle = unsafe { lyra_resource_kernel_create() };
        let handle = NonNull::new(handle).ok_or(ResourceKernelError::AllocationFailed)?;
        Ok(Self { handle })
    }

    pub fn register_or_update(&self, record: ResourceRecord) -> Result<u64> {
        let resource_id = CString::new(record.resource_id)?;
        let kind = CString::new(record.kind)?;
        let label = CString::new(record.label)?;
        let view_id = CString::new(record.view_id)?;
        let state_key = CString::new(record.state_key)?;
        let core_key = CString::new(record.core_key)?;
        let lifecycle_state = CString::new(record.lifecycle_state)?;
        let tab_id = CString::new(record.tab_id.unwrap_or_default())?;
        let address = CString::new(record.address.unwrap_or_default())?;
        Ok(unsafe {
            lyra_resource_kernel_register_or_update(
                self.handle.as_ptr(),
                resource_id.as_ptr(),
                kind.as_ptr(),
                label.as_ptr(),
                view_id.as_ptr(),
                state_key.as_ptr(),
                core_key.as_ptr(),
                lifecycle_state.as_ptr(),
                tab_id.as_ptr(),
                address.as_ptr(),
                record.pid,
                if record.visible { 1 } else { 0 },
            )
        })
    }

    pub fn remove(&self, resource_id: &str) -> Result<u64> {
        let resource_id = CString::new(resource_id)?;
        Ok(unsafe { lyra_resource_kernel_remove(self.handle.as_ptr(), resource_id.as_ptr()) })
    }

    pub fn request_lifecycle(&self, resource_id: &str, target_state: &str) -> Result<u64> {
        let resource_id = CString::new(resource_id)?;
        let target_state = CString::new(target_state)?;
        Ok(unsafe {
            lyra_resource_kernel_request_lifecycle(
                self.handle.as_ptr(),
                resource_id.as_ptr(),
                target_state.as_ptr(),
            )
        })
    }

    pub fn read_snapshot_json(&self) -> Result<String> {
        let ptr = unsafe { lyra_resource_kernel_read_snapshot_json(self.handle.as_ptr()) };
        self.take_native_string(ptr)
    }

    pub fn read_system_snapshot_json(&self) -> Result<String> {
        let ptr = unsafe { lyra_resource_kernel_read_system_snapshot_json(self.handle.as_ptr()) };
        self.take_native_string(ptr)
    }

    pub fn request_activity_action_json(&self, request: ActivityActionRequest) -> Result<String> {
        let activity_id = CString::new(request.activity_id)?;
        let action = CString::new(request.action)?;
        let ptr = unsafe {
            lyra_resource_kernel_request_activity_action(
                self.handle.as_ptr(),
                activity_id.as_ptr(),
                action.as_ptr(),
            )
        };
        self.take_native_string(ptr)
    }

    fn take_native_string(&self, ptr: *mut c_char) -> Result<String> {
        let ptr = NonNull::new(ptr).ok_or(ResourceKernelError::AllocationFailed)?;
        let value = unsafe { CStr::from_ptr(ptr.as_ptr()) }
            .to_str()
            .map_err(|_| ResourceKernelError::InvalidUtf8)?
            .to_owned();
        unsafe {
            lyra_resource_kernel_free_string(ptr.as_ptr());
        }
        Ok(value)
    }

    pub fn read_snapshot(&self) -> Result<ResourceSnapshot> {
        Ok(serde_json::from_str(&self.read_snapshot_json()?)?)
    }

    pub fn request_activity_action(
        &self,
        request: ActivityActionRequest,
    ) -> Result<ActivityActionResult> {
        Ok(serde_json::from_str(
            &self.request_activity_action_json(request)?,
        )?)
    }
}

impl Drop for ResourceKernel {
    fn drop(&mut self) {
        unsafe {
            lyra_resource_kernel_destroy(self.handle.as_ptr());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_and_read_snapshot() {
        let kernel = ResourceKernel::new().expect("kernel");
        kernel
            .register_or_update(ResourceRecord {
                resource_id: "browser:test".to_string(),
                kind: "browser-page".to_string(),
                label: "Example".to_string(),
                view_id: "tab:test".to_string(),
                state_key: "state:test".to_string(),
                core_key: "site:example.com".to_string(),
                lifecycle_state: "foreground".to_string(),
                tab_id: Some("test".to_string()),
                address: Some("https://example.com/".to_string()),
                pid: 0,
                visible: true,
                created_at: 0,
                updated_at: 0,
            })
            .expect("register");
        let snapshot = kernel.read_snapshot().expect("snapshot");
        assert_eq!(snapshot.resources.len(), 1);
        assert_eq!(snapshot.resources[0].core_key, "site:example.com");
    }

    #[test]
    fn system_snapshot_includes_lyra_runtime_and_activity_actions() {
        let kernel = ResourceKernel::new().expect("kernel");
        kernel
            .register_or_update(ResourceRecord {
                resource_id: "browser:test".to_string(),
                kind: "browser-page".to_string(),
                label: "Example".to_string(),
                view_id: "tab:test".to_string(),
                state_key: "state:test".to_string(),
                core_key: "site:example.com".to_string(),
                lifecycle_state: "foreground".to_string(),
                tab_id: Some("test".to_string()),
                address: Some("https://example.com/".to_string()),
                pid: 0,
                visible: true,
                created_at: 0,
                updated_at: 0,
            })
            .expect("register");

        let snapshot: serde_json::Value =
            serde_json::from_str(&kernel.read_system_snapshot_json().expect("system snapshot"))
                .expect("valid system snapshot json");
        assert_eq!(snapshot["runtimeName"], "Lyra Sentinel Runtime");
        assert!(snapshot["activities"].as_array().expect("activities").len() >= 2);

        let result = kernel
            .request_activity_action(ActivityActionRequest {
                activity_id: "lyra-resource:browser:test".to_string(),
                action: "suspend".to_string(),
            })
            .expect("activity action");
        assert!(result.ok);
        let next = kernel.read_snapshot().expect("snapshot");
        assert_eq!(next.resources[0].lifecycle_state, "warm-suspended");
    }
}
