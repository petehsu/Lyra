use napi::{Error, Result, Status};
use napi_derive::napi;

#[napi(js_name = "planNativeDownloadJson")]
pub fn plan_native_download_json(payload: String) -> Result<String> {
    lyra_download_core::plan_download_json(&payload)
        .map_err(|message| Error::new(Status::InvalidArg, message))
}
