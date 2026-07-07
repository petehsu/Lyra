#[cfg(feature = "node-api")]
use napi::bindgen_prelude::*;
#[cfg(feature = "node-api")]
use napi_derive::napi;

pub mod command_tracker;
mod events;
pub mod input_controller;
mod lifecycle;
mod live_output;
mod permission_api;
pub mod permissions;
mod process_api;
pub mod process_model;
mod protocol;
mod pty_io;
mod query;
pub mod sensitive_input;
mod session_runtime;
mod shell;
pub mod shell_integration;
pub mod signals;

pub(crate) use events::emit_command_completion;
use events::{register_rust_event_callback as register_callback, RustEventCallback};
pub use protocol::*;

#[cfg(not(feature = "node-api"))]
type Result<T> = std::result::Result<T, Error>;

#[cfg(not(feature = "node-api"))]
#[derive(Debug, Clone)]
pub struct Error {
    reason: String,
}

#[cfg(not(feature = "node-api"))]
#[derive(Debug, Clone, Copy)]
pub enum Status {
    InvalidArg,
}

#[cfg(not(feature = "node-api"))]
impl Error {
    pub fn new(_status: Status, reason: String) -> Self {
        Self { reason }
    }
}

#[cfg(not(feature = "node-api"))]
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.reason)
    }
}

#[cfg(not(feature = "node-api"))]
impl std::error::Error for Error {}

pub(crate) const DEFAULT_READ_MAX_BYTES: usize = 8 * 1024;
pub(crate) const DEFAULT_READ_WAIT_MS: u64 = 750;
pub(crate) const MAX_SESSION_BUFFER_BYTES: usize = 256 * 1024;

pub(crate) fn to_error(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}

pub fn register_rust_event_callback(callback: RustEventCallback) {
    register_callback(callback);
}

pub fn clear_rust_event_callback() {
    events::clear_rust_event_callback();
}

#[cfg_attr(feature = "node-api", napi)]
pub fn create_session(request: TerminalCreateRequest) -> Result<TerminalSessionSnapshot> {
    session_runtime::create_session(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn shell_launch_plan(
    request: TerminalShellLaunchPlanRequest,
) -> Result<TerminalShellLaunchPlanResponse> {
    pty_io::shell_launch_plan(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn write_session(request: TerminalWriteRequest) -> Result<()> {
    session_runtime::write_session(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn read_session(request: TerminalReadRequest) -> Result<TerminalReadResponse> {
    session_runtime::read_session(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn resize_session(request: TerminalResizeRequest) -> Result<()> {
    session_runtime::resize_session(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn close_session(request: TerminalCloseRequest) -> Result<()> {
    session_runtime::close_session(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn shutdown() -> Result<()> {
    session_runtime::shutdown()
}

#[cfg_attr(feature = "node-api", napi)]
pub fn evaluate_permission(
    request: TerminalPermissionEvaluateRequest,
) -> Result<TerminalPermissionEvaluateResponse> {
    permission_api::evaluate_permission(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn respond_permission(
    request: TerminalPermissionRespondRequest,
) -> Result<TerminalPermissionRespondResponse> {
    permission_api::respond_permission(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn read_processes(
    request: TerminalProcessesReadRequest,
) -> Result<TerminalProcessesReadResponse> {
    process_api::read_processes(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn signal_process(
    request: TerminalProcessSignalRequest,
) -> Result<TerminalProcessSignalResponse> {
    process_api::signal_process(request)
}

#[cfg(test)]
mod tests;