use napi::{Error, Result, Status};
use napi_derive::napi;

#[napi(js_name = "evaluateNativeCalculatorJson")]
pub fn evaluate_native_calculator_json(payload: String) -> Result<String> {
    lyra_calculator_core::evaluate_native_json(&payload)
        .map_err(|message| Error::new(Status::InvalidArg, message))
}
