#[cfg(feature = "node-api")]
use napi::bindgen_prelude::*;
#[cfg(feature = "node-api")]
use napi_derive::napi;

pub mod attachments;
pub mod command_tracker;
mod events;
pub mod input_controller;
mod live_output;
mod memory;
mod memory_api;
mod memory_writer;
mod permission_api;
pub mod permissions;
mod process_api;
pub mod process_model;
mod protocol;
mod pty_io;
mod query;
mod screen;
mod screen_api;
pub mod sensitive_input;
mod session_runtime;
mod shell;
pub mod shell_integration;
pub mod signals;
pub mod terminal_agents;
pub mod tui_act;
pub mod tui_map;

pub use attachments::{
    TerminalAttachmentAttachRequest, TerminalAttachmentAttachResponse,
    TerminalAttachmentDetachRequest, TerminalAttachmentDetachResponse,
    TerminalAttachmentListRequest, TerminalAttachmentListResponse, TerminalAttachmentPauseRequest,
    TerminalAttachmentResumeRequest, TerminalAttachmentSnapshot, TerminalAttachmentWriteRequest,
    TerminalAttachmentWriteResponse,
};
pub(crate) use events::emit_command_completion;
use events::{register_rust_event_callback as register_callback, RustEventCallback};
pub use protocol::*;
pub use screen::{
    TerminalScreenCell, TerminalScreenCursorPosition, TerminalScreenInputModes, TerminalScreenLink,
    TerminalScreenRegion, TerminalScreenSnapshot, TerminalScreenState, TerminalScreenStyle,
    TerminalScreenVisibleRow,
};
pub use terminal_agents::{
    TerminalAgentLaunchRequest, TerminalAgentLaunchResponse, TerminalAgentRelation,
};
pub use tui_act::{TuiActPlan, TuiActTarget};

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
pub(crate) const MEMORY_WORKER_OUTPUT_BATCH_BYTES: usize = 64 * 1024;

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
pub fn restore_sessions(request: TerminalRestoreRequest) -> Result<Vec<TerminalSessionSnapshot>> {
    session_runtime::restore_sessions(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn create_observer_session(
    request: TerminalObserverCreateRequest,
) -> Result<TerminalSessionSnapshot> {
    session_runtime::create_observer_session(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn record_observer_input(request: TerminalObserverInputRequest) -> Result<()> {
    session_runtime::record_observer_input(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn record_observer_output(request: TerminalObserverOutputRequest) -> Result<()> {
    session_runtime::record_observer_output(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn resize_observer_session(request: TerminalObserverResizeRequest) -> Result<()> {
    session_runtime::resize_observer_session(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn record_observer_exit(request: TerminalObserverExitRequest) -> Result<()> {
    session_runtime::record_observer_exit(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn close_observer_session(request: TerminalObserverCloseRequest) -> Result<()> {
    session_runtime::close_observer_session(request)
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
pub fn read_screen(request: TerminalScreenReadRequest) -> Result<TerminalScreenReadResponse> {
    screen_api::read_screen(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn read_map(request: TerminalMapReadRequest) -> Result<TerminalMapReadResponse> {
    screen_api::read_map(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn execute_act(request: TerminalActExecuteRequest) -> Result<TerminalActExecuteResponse> {
    screen_api::execute_act(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn execute_input(request: TerminalInputExecuteRequest) -> Result<TerminalInputExecuteResponse> {
    screen_api::execute_input(request)
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

#[cfg_attr(feature = "node-api", napi)]
pub fn read_command_status(
    request: TerminalCommandStatusRequest,
) -> Result<TerminalCommandStatusResponse> {
    process_api::read_command_status(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn wait_command(request: TerminalCommandWaitRequest) -> Result<TerminalCommandWaitResponse> {
    process_api::wait_command(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn read_command_output(
    request: TerminalCommandOutputReadRequest,
) -> Result<TerminalCommandOutputReadResponse> {
    process_api::read_command_output(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn wait_until(request: TerminalWaitUntilRequest) -> Result<TerminalWaitUntilResponse> {
    screen_api::wait_until(request)
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
pub fn read_memory_timeline(request: TerminalMemoryTimelineReadRequest) -> Result<String> {
    memory_api::read_memory_timeline(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn read_events(request: TerminalEventsReadRequest) -> Result<String> {
    memory_api::read_events(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn read_commands(request: TerminalCommandsReadRequest) -> Result<String> {
    memory_api::read_commands(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn read_output_range(request: TerminalOutputRangeReadRequest) -> Result<String> {
    memory_api::read_output_range(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn list_artifacts(request: TerminalArtifactsListRequest) -> Result<String> {
    memory_api::list_artifacts(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn read_stored_sessions(request: TerminalStoredSessionsReadRequest) -> Result<String> {
    memory_api::read_stored_sessions(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn record_permission_requested(request: TerminalPermissionEventRequest) -> Result<()> {
    memory_api::record_permission_requested(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn record_permission_granted(request: TerminalPermissionEventRequest) -> Result<()> {
    memory_api::record_permission_granted(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn record_permission_denied(request: TerminalPermissionEventRequest) -> Result<()> {
    memory_api::record_permission_denied(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn record_permission_expired(request: TerminalPermissionEventRequest) -> Result<()> {
    memory_api::record_permission_expired(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn record_handoff_started(request: TerminalHandoffEventRequest) -> Result<()> {
    memory_api::record_handoff_started(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn record_handoff_completed(request: TerminalHandoffEventRequest) -> Result<()> {
    memory_api::record_handoff_completed(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn mark_output_policy(request: TerminalOutputPolicyMarkerRequest) -> Result<()> {
    memory_api::mark_output_policy(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn attach_agent(
    request: TerminalAttachmentAttachRequest,
) -> Result<TerminalAttachmentAttachResponse> {
    attachments::attach_agent(request).map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn detach_agent(
    request: TerminalAttachmentDetachRequest,
) -> Result<TerminalAttachmentDetachResponse> {
    attachments::detach_agent(request).map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn list_attachments(
    request: TerminalAttachmentListRequest,
) -> Result<TerminalAttachmentListResponse> {
    attachments::list_attachments(request).map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn pause_attachment(
    request: TerminalAttachmentPauseRequest,
) -> Result<TerminalAttachmentDetachResponse> {
    attachments::pause_attachment(request).map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn resume_attachment(
    request: TerminalAttachmentResumeRequest,
) -> Result<TerminalAttachmentDetachResponse> {
    attachments::resume_attachment(request).map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn authorize_attachment_write(
    request: TerminalAttachmentWriteRequest,
) -> Result<TerminalAttachmentWriteResponse> {
    attachments::authorize_write(request).map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn launch_terminal_agent(
    request: TerminalAgentLaunchRequest,
) -> Result<TerminalAgentLaunchResponse> {
    terminal_agents::launch_terminal_agent(request).map_err(to_error)
}

#[cfg(test)]
mod tests;
