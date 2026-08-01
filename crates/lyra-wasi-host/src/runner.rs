use std::collections::BTreeSet;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    APP_DATA_READ_PERMISSION, APP_DATA_WRITE_PERMISSION, HostError, TEMP_READ_PERMISSION,
    TEMP_WRITE_PERMISSION, WasiComponentHost, WasiComponentPolicy, WasiDirectoryRoots,
    WasiExecutionLimits, WasiRunOutcome,
};

pub const WASI_RUNNER_PROTOCOL_VERSION: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WasiRunnerLimits {
    pub max_component_bytes: u64,
    pub max_memory_bytes: u64,
    pub max_table_elements: u64,
    pub max_instances: u64,
    pub max_tables: u64,
    pub max_memories: u64,
    pub max_random_bytes: u64,
    pub fuel: u64,
    pub timeout_millis: u64,
}

impl Default for WasiRunnerLimits {
    fn default() -> Self {
        let limits = WasiExecutionLimits::default();
        Self {
            max_component_bytes: limits.max_component_bytes as u64,
            max_memory_bytes: limits.max_memory_bytes as u64,
            max_table_elements: limits.max_table_elements as u64,
            max_instances: limits.max_instances as u64,
            max_tables: limits.max_tables as u64,
            max_memories: limits.max_memories as u64,
            max_random_bytes: limits.max_random_bytes,
            fuel: limits.fuel,
            timeout_millis: limits.timeout.as_millis() as u64,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WasiRunnerRequest {
    pub component_path: PathBuf,
    pub expected_sha256: String,
    pub app_data_root: PathBuf,
    pub temporary_root: PathBuf,
    pub permissions: Vec<String>,
    pub limits: WasiRunnerLimits,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WasiRunnerStatus {
    Success,
    GuestFailure,
    Error,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WasiRunnerError {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WasiRunnerResponse {
    pub protocol_version: u32,
    pub status: WasiRunnerStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<WasiRunnerError>,
}

impl WasiRunnerResponse {
    pub fn invalid_arguments(message: impl Into<String>) -> Self {
        Self::error("invalidArguments", message)
    }

    pub const fn exit_code(&self) -> i32 {
        match self.status {
            WasiRunnerStatus::Success => 0,
            WasiRunnerStatus::GuestFailure => 10,
            WasiRunnerStatus::Error => 2,
        }
    }

    fn success(status: WasiRunnerStatus) -> Self {
        Self {
            protocol_version: WASI_RUNNER_PROTOCOL_VERSION,
            status,
            error: None,
        }
    }

    fn error(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            protocol_version: WASI_RUNNER_PROTOCOL_VERSION,
            status: WasiRunnerStatus::Error,
            error: Some(WasiRunnerError {
                code: code.into(),
                message: message.into(),
            }),
        }
    }
}

pub fn execute_runner_request(request: &WasiRunnerRequest) -> WasiRunnerResponse {
    match execute(request) {
        Ok(WasiRunOutcome::Success) => WasiRunnerResponse::success(WasiRunnerStatus::Success),
        Ok(WasiRunOutcome::GuestFailure) => {
            WasiRunnerResponse::success(WasiRunnerStatus::GuestFailure)
        }
        Err(error) => WasiRunnerResponse::error(error.code, error.message),
    }
}

#[derive(Debug)]
struct RunnerFailure {
    code: &'static str,
    message: String,
}

impl RunnerFailure {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

fn execute(request: &WasiRunnerRequest) -> Result<WasiRunOutcome, RunnerFailure> {
    let limits = resolve_limits(&request.limits)?;
    let permissions = validate_permissions(&request.permissions)?;
    let app_data_root = validate_directory_root("application data", &request.app_data_root)?;
    let temporary_root = validate_directory_root("temporary data", &request.temporary_root)?;
    if app_data_root.starts_with(&temporary_root) || temporary_root.starts_with(&app_data_root) {
        return Err(RunnerFailure::new(
            "invalidRoots",
            "application data and temporary data roots must not overlap",
        ));
    }
    let component_bytes = read_verified_component(
        &request.component_path,
        &request.expected_sha256,
        limits.max_component_bytes,
    )?;
    let policy = WasiComponentPolicy::from_manifest_permissions(
        permissions.iter().map(String::as_str),
        WasiDirectoryRoots {
            app_data: Some(app_data_root),
            temporary: Some(temporary_root),
        },
    )
    .map_err(map_host_error)?;
    let host = WasiComponentHost::new(limits).map_err(map_host_error)?;
    host.run_component(&component_bytes, &policy)
        .map_err(map_host_error)
}

fn resolve_limits(requested: &WasiRunnerLimits) -> Result<WasiExecutionLimits, RunnerFailure> {
    let ceiling = WasiRunnerLimits::default();
    validate_bounded_limit(
        "maxComponentBytes",
        requested.max_component_bytes,
        ceiling.max_component_bytes,
    )?;
    validate_bounded_limit(
        "maxMemoryBytes",
        requested.max_memory_bytes,
        ceiling.max_memory_bytes,
    )?;
    validate_bounded_limit(
        "maxTableElements",
        requested.max_table_elements,
        ceiling.max_table_elements,
    )?;
    validate_bounded_limit(
        "maxInstances",
        requested.max_instances,
        ceiling.max_instances,
    )?;
    validate_bounded_limit("maxTables", requested.max_tables, ceiling.max_tables)?;
    validate_bounded_limit("maxMemories", requested.max_memories, ceiling.max_memories)?;
    validate_bounded_limit(
        "maxRandomBytes",
        requested.max_random_bytes,
        ceiling.max_random_bytes,
    )?;
    validate_bounded_limit("fuel", requested.fuel, ceiling.fuel)?;
    validate_bounded_limit(
        "timeoutMillis",
        requested.timeout_millis,
        ceiling.timeout_millis,
    )?;

    Ok(WasiExecutionLimits {
        max_component_bytes: usize_limit("maxComponentBytes", requested.max_component_bytes)?,
        max_memory_bytes: usize_limit("maxMemoryBytes", requested.max_memory_bytes)?,
        max_table_elements: usize_limit("maxTableElements", requested.max_table_elements)?,
        max_instances: usize_limit("maxInstances", requested.max_instances)?,
        max_tables: usize_limit("maxTables", requested.max_tables)?,
        max_memories: usize_limit("maxMemories", requested.max_memories)?,
        max_random_bytes: requested.max_random_bytes,
        fuel: requested.fuel,
        timeout: Duration::from_millis(requested.timeout_millis),
    })
}

fn validate_bounded_limit(
    name: &'static str,
    value: u64,
    maximum: u64,
) -> Result<(), RunnerFailure> {
    if value == 0 || value > maximum {
        return Err(RunnerFailure::new(
            "invalidLimits",
            format!("{name} must be between 1 and {maximum}"),
        ));
    }
    Ok(())
}

fn usize_limit(name: &'static str, value: u64) -> Result<usize, RunnerFailure> {
    usize::try_from(value).map_err(|_| {
        RunnerFailure::new(
            "invalidLimits",
            format!("{name} cannot be represented on this platform"),
        )
    })
}

fn validate_permissions(permissions: &[String]) -> Result<BTreeSet<String>, RunnerFailure> {
    if permissions.len() > 4 {
        return Err(RunnerFailure::new(
            "invalidPermissions",
            "at most four WASI directory permissions may be declared",
        ));
    }
    let allowed = [
        APP_DATA_READ_PERMISSION,
        APP_DATA_WRITE_PERMISSION,
        TEMP_READ_PERMISSION,
        TEMP_WRITE_PERMISSION,
    ];
    let mut unique = BTreeSet::new();
    for permission in permissions {
        if !allowed.contains(&permission.as_str()) {
            return Err(RunnerFailure::new(
                "invalidPermissions",
                format!("unsupported WASI permission `{permission}`"),
            ));
        }
        if !unique.insert(permission.clone()) {
            return Err(RunnerFailure::new(
                "invalidPermissions",
                format!("duplicate WASI permission `{permission}`"),
            ));
        }
    }
    Ok(unique)
}

fn validate_directory_root(label: &'static str, path: &Path) -> Result<PathBuf, RunnerFailure> {
    if !path.is_absolute() {
        return Err(RunnerFailure::new(
            "invalidRoots",
            format!("{label} root must be an absolute path"),
        ));
    }
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        RunnerFailure::new(
            "invalidRoots",
            format!("could not inspect {label} root: {error}"),
        )
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(RunnerFailure::new(
            "invalidRoots",
            format!("{label} root must be a real directory"),
        ));
    }
    fs::canonicalize(path).map_err(|error| {
        RunnerFailure::new(
            "invalidRoots",
            format!("could not resolve {label} root: {error}"),
        )
    })
}

fn read_verified_component(
    path: &Path,
    expected_sha256: &str,
    maximum_bytes: usize,
) -> Result<Vec<u8>, RunnerFailure> {
    if !path.is_absolute() || path.extension() != Some(OsStr::new("wasm")) {
        return Err(RunnerFailure::new(
            "invalidComponentPath",
            "component path must be an absolute .wasm file",
        ));
    }
    if expected_sha256.len() != 64
        || !expected_sha256
            .bytes()
            .all(|value| value.is_ascii_hexdigit())
    {
        return Err(RunnerFailure::new(
            "invalidDigest",
            "expected SHA-256 must contain exactly 64 hexadecimal characters",
        ));
    }
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        RunnerFailure::new(
            "invalidComponentPath",
            format!("could not inspect component: {error}"),
        )
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(RunnerFailure::new(
            "invalidComponentPath",
            "component must be a real regular file",
        ));
    }
    let file_size = usize::try_from(metadata.len()).map_err(|_| {
        RunnerFailure::new(
            "componentTooLarge",
            "component size cannot be represented on this platform",
        )
    })?;
    if file_size > maximum_bytes {
        return Err(RunnerFailure::new(
            "componentTooLarge",
            format!("component is {file_size} bytes, exceeding the {maximum_bytes}-byte limit"),
        ));
    }
    let bytes = fs::read(path).map_err(|error| {
        RunnerFailure::new(
            "componentReadFailed",
            format!("could not read component: {error}"),
        )
    })?;
    if bytes.len() > maximum_bytes {
        return Err(RunnerFailure::new(
            "componentTooLarge",
            format!(
                "component is {} bytes, exceeding the {maximum_bytes}-byte limit",
                bytes.len()
            ),
        ));
    }
    let actual_sha256 = format!("{:x}", Sha256::digest(&bytes));
    if !actual_sha256.eq_ignore_ascii_case(expected_sha256) {
        return Err(RunnerFailure::new(
            "integrityMismatch",
            "component SHA-256 does not match its signed manifest",
        ));
    }
    Ok(bytes)
}

fn map_host_error(error: HostError) -> RunnerFailure {
    let code = match &error {
        HostError::UnknownWasiPermission(_) => "invalidPermissions",
        HostError::MissingDirectoryRoot(_)
        | HostError::InvalidDirectoryRoot { .. }
        | HostError::OverlappingDirectoryRoots(_) => "invalidRoots",
        HostError::InvalidLimit(_) => "invalidLimits",
        HostError::ComponentTooLarge { .. } => "componentTooLarge",
        HostError::Component(_) => "componentRejected",
        HostError::Runtime(_) => "executionFailed",
        HostError::TimerThread(_) => "hostFailed",
        HostError::TimedOut(_) => "timedOut",
        HostError::Io { .. } => "componentReadFailed",
    };
    RunnerFailure::new(code, error.to_string())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use sha2::{Digest, Sha256};
    use tempfile::TempDir;

    use super::{WasiRunnerLimits, WasiRunnerRequest, WasiRunnerStatus, execute_runner_request};

    fn fixture(bytes: &[u8]) -> Result<(TempDir, WasiRunnerRequest), Box<dyn std::error::Error>> {
        let root = TempDir::new()?;
        let component_path = root.path().join("component.wasm");
        fs::write(&component_path, bytes)?;
        let app_data_root = root.path().join("app-data");
        let temporary_root = root.path().join("temporary");
        fs::create_dir(&app_data_root)?;
        fs::create_dir(&temporary_root)?;
        Ok((
            root,
            WasiRunnerRequest {
                component_path,
                expected_sha256: format!("{:x}", Sha256::digest(bytes)),
                app_data_root,
                temporary_root,
                permissions: Vec::new(),
                limits: WasiRunnerLimits::default(),
            },
        ))
    }

    #[test]
    fn native_executable_bytes_are_rejected_as_non_components()
    -> Result<(), Box<dyn std::error::Error>> {
        let (_root, request) = fixture(b"#!/bin/sh\nexit 0\n")?;
        let response = execute_runner_request(&request);

        assert_eq!(response.status, WasiRunnerStatus::Error);
        assert_eq!(
            response.error.map(|error| error.code),
            Some("componentRejected".to_owned())
        );
        Ok(())
    }

    #[test]
    fn signed_manifest_digest_is_checked_before_compilation()
    -> Result<(), Box<dyn std::error::Error>> {
        let (_root, mut request) = fixture(b"not a component")?;
        request.expected_sha256 = "0".repeat(64);
        let response = execute_runner_request(&request);

        assert_eq!(response.status, WasiRunnerStatus::Error);
        assert_eq!(
            response.error.map(|error| error.code),
            Some("integrityMismatch".to_owned())
        );
        Ok(())
    }

    #[test]
    fn callers_cannot_raise_runner_hard_limits() -> Result<(), Box<dyn std::error::Error>> {
        let (_root, mut request) = fixture(b"not a component")?;
        request.limits.max_memory_bytes += 1;
        let response = execute_runner_request(&request);

        assert_eq!(response.status, WasiRunnerStatus::Error);
        assert_eq!(
            response.error.map(|error| error.code),
            Some("invalidLimits".to_owned())
        );
        Ok(())
    }

    #[test]
    fn undeclared_permissions_fail_closed() -> Result<(), Box<dyn std::error::Error>> {
        let (_root, mut request) = fixture(b"not a component")?;
        request.permissions.push("wasi:sockets.tcp".to_owned());
        let response = execute_runner_request(&request);

        assert_eq!(response.status, WasiRunnerStatus::Error);
        assert_eq!(
            response.error.map(|error| error.code),
            Some("invalidPermissions".to_owned())
        );
        Ok(())
    }
}
