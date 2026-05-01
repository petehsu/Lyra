use napi::{Error, Result, Status};
use napi_derive::napi;
use once_cell::sync::Lazy;

use lyra_resource_core::{ActivityActionRequest, ResourceKernel, ResourceRecord};

static RESOURCE_KERNEL: Lazy<ResourceKernel> =
    Lazy::new(|| ResourceKernel::new().expect("create resource kernel"));

fn to_napi_error(error: impl std::fmt::Display) -> Error {
    Error::new(Status::GenericFailure, error.to_string())
}

#[napi(js_name = "registerOrUpdateResourceJson")]
pub fn register_or_update_resource_json(payload: String) -> Result<u64> {
    let record: ResourceRecord = serde_json::from_str(&payload).map_err(to_napi_error)?;
    RESOURCE_KERNEL
        .register_or_update(record)
        .map_err(to_napi_error)
}

#[napi(js_name = "removeResource")]
pub fn remove_resource(resource_id: String) -> Result<u64> {
    RESOURCE_KERNEL.remove(&resource_id).map_err(to_napi_error)
}

#[napi(js_name = "requestLifecycle")]
pub fn request_lifecycle(resource_id: String, target_state: String) -> Result<u64> {
    RESOURCE_KERNEL
        .request_lifecycle(&resource_id, &target_state)
        .map_err(to_napi_error)
}

#[napi(js_name = "readSnapshotJson")]
pub fn read_snapshot_json() -> Result<String> {
    RESOURCE_KERNEL.read_snapshot_json().map_err(to_napi_error)
}

#[napi(js_name = "readSystemSnapshotJson")]
pub fn read_system_snapshot_json() -> Result<String> {
    RESOURCE_KERNEL
        .read_system_snapshot_json()
        .map_err(to_napi_error)
}

#[napi(js_name = "requestActivityActionJson")]
pub fn request_activity_action_json(payload: String) -> Result<String> {
    let request: ActivityActionRequest = serde_json::from_str(&payload).map_err(to_napi_error)?;
    RESOURCE_KERNEL
        .request_activity_action_json(request)
        .map_err(to_napi_error)
}
