mod host;
mod limits;
mod policy;
mod runner;

use std::path::PathBuf;
use std::time::Duration;

use thiserror::Error;

pub use host::{WasiComponentHost, WasiRunOutcome};
pub use limits::WasiExecutionLimits;
pub use policy::{
    APP_DATA_READ_PERMISSION, APP_DATA_WRITE_PERMISSION, DirectoryAccess, ResolvedPreopen,
    ResolvedWasiPolicy, TEMP_READ_PERMISSION, TEMP_WRITE_PERMISSION, WasiComponentPolicy,
    WasiDirectoryPermission, WasiDirectoryRoots,
};
pub use runner::{
    WASI_RUNNER_PROTOCOL_VERSION, WasiRunnerError, WasiRunnerLimits, WasiRunnerRequest,
    WasiRunnerResponse, WasiRunnerStatus, execute_runner_request,
};

pub type Result<T> = std::result::Result<T, HostError>;

#[derive(Debug, Error)]
pub enum HostError {
    #[error("unknown WASI backend permission `{0}`")]
    UnknownWasiPermission(String),
    #[error("the manifest grants {0} access but no host directory was supplied")]
    MissingDirectoryRoot(&'static str),
    #[error("invalid WASI directory root {}: {reason}", path.display())]
    InvalidDirectoryRoot { path: PathBuf, reason: String },
    #[error("application data and temporary data resolve to the same directory: {}", .0.display())]
    OverlappingDirectoryRoots(PathBuf),
    #[error("I/O error at {}: {source}", path.display())]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("execution limit `{0}` must be greater than zero")]
    InvalidLimit(&'static str),
    #[error("component is {actual} bytes, exceeding the {maximum}-byte limit")]
    ComponentTooLarge { actual: usize, maximum: usize },
    #[error("invalid WebAssembly component: {0}")]
    Component(#[source] wasmtime::Error),
    #[error("WASI component runtime error: {0}")]
    Runtime(#[source] wasmtime::Error),
    #[error("could not start the WASI execution deadline timer: {0}")]
    TimerThread(#[source] std::io::Error),
    #[error("WASI component exceeded its {:?} execution deadline", .0)]
    TimedOut(Duration),
}

#[cfg(test)]
mod tests;
