use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;
use std::ffi::OsStr;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

pub const HELPER_PROTOCOL_VERSION: u32 = 1;
pub const DEFAULT_HELPER_TCP_ADDR: &str = "127.0.0.1:37691";
pub const MACOS_DEFAULT_HELPER_SOCKET: &str = "/var/run/lyra-performance-helper.sock";
pub const LINUX_DEFAULT_HELPER_SOCKET: &str = "/run/lyra-performance-helper.sock";
pub const DEFAULT_HELPER_SAMPLE_MS: u64 = 120;
pub const HELPER_SOCKET_ENV: &str = "LYRA_PERFORMANCE_HELPER_SOCKET";
pub const HELPER_TCP_ENV: &str = "LYRA_PERFORMANCE_HELPER_TCP";
pub const HELPER_BIN_ENV: &str = "LYRA_PERFORMANCE_HELPER_BIN";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceHelperRequest {
    pub method: String,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceHelperResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceHelperStatus {
    pub protocol_version: u32,
    pub platform: String,
    pub adapter_kind: String,
    pub process_id: u32,
    pub elevated: bool,
    pub service_mode: bool,
    pub transport: String,
    pub can_sample_processes: bool,
    pub can_apply_pressure_policy: bool,
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceHelperSampleProcessesRequest {
    #[serde(default)]
    pub process_ids: Vec<u32>,
    #[serde(default)]
    pub sample_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceProcessSample {
    pub process_id: u32,
    pub exists: bool,
    pub resident_memory_bytes: u64,
    pub virtual_memory_bytes: u64,
    pub cpu_percent: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceHelperProcessSamples {
    pub at: i64,
    pub sample_ms: u64,
    pub samples: Vec<PerformanceProcessSample>,
}

pub fn configured_helper_transport() -> Option<String> {
    if let Some(socket) = non_empty_env(HELPER_SOCKET_ENV) {
        return Some(format!("unix:{socket}"));
    }
    if let Some(tcp) = non_empty_env(HELPER_TCP_ENV) {
        return Some(format!("tcp:{tcp}"));
    }
    non_empty_env(HELPER_BIN_ENV)
        .map(|bin| format!("stdio:{bin}"))
        .or_else(default_helper_transport)
}

pub fn call_configured_helper(request: &PerformanceHelperRequest) -> Result<Option<Value>, String> {
    if let Some(socket_path) = non_empty_env(HELPER_SOCKET_ENV).or_else(default_helper_socket) {
        return call_unix_helper(Path::new(&socket_path), request).map(Some);
    }
    if let Some(addr) = non_empty_env(HELPER_TCP_ENV) {
        return call_tcp_helper(&addr, request).map(Some);
    }
    if let Some(bin) = non_empty_env(HELPER_BIN_ENV) {
        return call_stdio_helper(&bin, request).map(Some);
    }
    Ok(None)
}

pub fn call_helper_status() -> Result<Option<PerformanceHelperStatus>, String> {
    let result = call_configured_helper(&PerformanceHelperRequest {
        method: "helper.status".to_string(),
        payload: Value::Null,
    })?;
    result
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| error.to_string())
}

pub fn call_helper_sample_processes(
    request: PerformanceHelperSampleProcessesRequest,
) -> Result<Option<PerformanceHelperProcessSamples>, String> {
    let payload = serde_json::to_value(request).map_err(|error| error.to_string())?;
    let result = call_configured_helper(&PerformanceHelperRequest {
        method: "helper.sampleProcesses".to_string(),
        payload,
    })?;
    result
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| error.to_string())
}

pub fn helper_status(transport: impl Into<String>, service_mode: bool) -> PerformanceHelperStatus {
    let elevated = helper_is_elevated();
    let mut notes = vec![format!(
        "{} adapter helper is {}",
        adapter_kind_for_platform(),
        if elevated {
            "authorized"
        } else {
            "not elevated"
        }
    )];
    if !elevated {
        notes.push(
            "install and start the OS helper as root/admin to enable full kernel mode".to_string(),
        );
    }

    PerformanceHelperStatus {
        protocol_version: HELPER_PROTOCOL_VERSION,
        platform: std::env::consts::OS.to_string(),
        adapter_kind: adapter_kind_for_platform().to_string(),
        process_id: std::process::id(),
        elevated,
        service_mode,
        transport: transport.into(),
        can_sample_processes: true,
        can_apply_pressure_policy: elevated,
        notes,
    }
}

pub fn handle_helper_request(
    request: PerformanceHelperRequest,
    transport: &str,
    service_mode: bool,
) -> PerformanceHelperResponse {
    match request.method.as_str() {
        "helper.status" => success(helper_status(transport, service_mode)),
        "helper.sampleProcesses" => match serde_json::from_value(request.payload) {
            Ok(request) => success(sample_processes(request)),
            Err(error) => failure(error.to_string()),
        },
        other => failure(format!("unknown helper method: {other}")),
    }
}

pub fn run_stdio(service_mode: bool) -> Result<(), String> {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let line = line.map_err(|error| error.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let response = handle_request_line(&line, "stdio", service_mode);
        write_response_line(&mut stdout, &response)?;
    }
    Ok(())
}

pub fn run_oneshot(request_json: Option<String>) -> Result<(), String> {
    let line = match request_json {
        Some(value) => value,
        None => {
            let mut value = String::new();
            std::io::stdin()
                .read_to_string(&mut value)
                .map_err(|error| error.to_string())?;
            value
        }
    };
    let response = handle_request_line(line.trim(), "stdio", false);
    write_response_line(&mut std::io::stdout(), &response)
}

#[cfg(unix)]
pub fn serve_unix_socket(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::UnixListener;

    if path.exists() {
        std::fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    let listener = UnixListener::bind(path).map_err(|error| error.to_string())?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o666))
        .map_err(|error| error.to_string())?;
    for stream in listener.incoming() {
        match stream {
            Ok(mut stream) => {
                if let Err(error) = handle_connected_stream(&mut stream, "unix", true) {
                    eprintln!("[lyra-performance-helper] unix client failed: {error}");
                }
            }
            Err(error) => eprintln!("[lyra-performance-helper] unix accept failed: {error}"),
        }
    }
    Ok(())
}

#[cfg(not(unix))]
pub fn serve_unix_socket(_path: &Path) -> Result<(), String> {
    Err("unix sockets are not supported on this target".to_string())
}

pub fn serve_tcp(addr: &str) -> Result<(), String> {
    let listener = TcpListener::bind(addr).map_err(|error| error.to_string())?;
    for stream in listener.incoming() {
        match stream {
            Ok(mut stream) => {
                if let Err(error) = handle_connected_stream(&mut stream, "tcp", true) {
                    eprintln!("[lyra-performance-helper] tcp client failed: {error}");
                }
            }
            Err(error) => eprintln!("[lyra-performance-helper] tcp accept failed: {error}"),
        }
    }
    Ok(())
}

pub fn sample_processes(
    request: PerformanceHelperSampleProcessesRequest,
) -> PerformanceHelperProcessSamples {
    let process_ids = request
        .process_ids
        .into_iter()
        .filter(|process_id| *process_id > 0)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let sample_ms = request.sample_ms.unwrap_or(DEFAULT_HELPER_SAMPLE_MS);
    let pids = process_ids
        .iter()
        .copied()
        .map(Pid::from_u32)
        .collect::<Vec<_>>();
    let mut system = System::new();
    let refresh_kind = ProcessRefreshKind::nothing().with_memory().with_cpu();
    system.refresh_processes_specifics(ProcessesToUpdate::Some(&pids), true, refresh_kind);
    if sample_ms > 0 {
        std::thread::sleep(Duration::from_millis(sample_ms));
        system.refresh_processes_specifics(ProcessesToUpdate::Some(&pids), true, refresh_kind);
    }

    let samples = process_ids
        .into_iter()
        .map(|process_id| {
            let pid = Pid::from_u32(process_id);
            match system.process(pid) {
                Some(process) => PerformanceProcessSample {
                    process_id,
                    exists: true,
                    resident_memory_bytes: process.memory(),
                    virtual_memory_bytes: process.virtual_memory(),
                    cpu_percent: process.cpu_usage(),
                    name: os_str_to_string(process.name()),
                },
                None => PerformanceProcessSample {
                    process_id,
                    exists: false,
                    resident_memory_bytes: 0,
                    virtual_memory_bytes: 0,
                    cpu_percent: 0.0,
                    name: None,
                },
            }
        })
        .collect();

    PerformanceHelperProcessSamples {
        at: Utc::now().timestamp_millis(),
        sample_ms,
        samples,
    }
}

fn handle_connected_stream<S: Read + Write>(
    stream: &mut S,
    transport: &str,
    service_mode: bool,
) -> Result<(), String> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|error| error.to_string())?;
    let response = handle_request_line(&line, transport, service_mode);
    write_response_line(reader.get_mut(), &response)
}

fn handle_request_line(
    line: &str,
    transport: &str,
    service_mode: bool,
) -> PerformanceHelperResponse {
    match serde_json::from_str::<PerformanceHelperRequest>(line) {
        Ok(request) => handle_helper_request(request, transport, service_mode),
        Err(error) => failure(error.to_string()),
    }
}

fn write_response_line<W: Write>(
    writer: &mut W,
    response: &PerformanceHelperResponse,
) -> Result<(), String> {
    let line = serde_json::to_string(response).map_err(|error| error.to_string())?;
    writer
        .write_all(line.as_bytes())
        .and_then(|_| writer.write_all(b"\n"))
        .and_then(|_| writer.flush())
        .map_err(|error| error.to_string())
}

#[cfg(unix)]
fn call_unix_helper(path: &Path, request: &PerformanceHelperRequest) -> Result<Value, String> {
    use std::os::unix::net::UnixStream;

    let mut stream = UnixStream::connect(path).map_err(|error| error.to_string())?;
    request_over_stream(&mut stream, request)
}

#[cfg(not(unix))]
fn call_unix_helper(_path: &Path, _request: &PerformanceHelperRequest) -> Result<Value, String> {
    Err("unix helper transport is not supported on this target".to_string())
}

fn call_tcp_helper(addr: &str, request: &PerformanceHelperRequest) -> Result<Value, String> {
    let mut stream = TcpStream::connect(addr).map_err(|error| error.to_string())?;
    request_over_stream(&mut stream, request)
}

fn call_stdio_helper(bin: &str, request: &PerformanceHelperRequest) -> Result<Value, String> {
    let mut child = Command::new(bin)
        .arg("--oneshot")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "failed to open helper stdin".to_string())?;
        let line = serde_json::to_string(request).map_err(|error| error.to_string())?;
        stdin
            .write_all(line.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .map_err(|error| error.to_string())?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    decode_response_line(String::from_utf8_lossy(&output.stdout).trim())
}

fn request_over_stream<S: Read + Write>(
    stream: &mut S,
    request: &PerformanceHelperRequest,
) -> Result<Value, String> {
    let line = serde_json::to_string(request).map_err(|error| error.to_string())?;
    stream
        .write_all(line.as_bytes())
        .and_then(|_| stream.write_all(b"\n"))
        .and_then(|_| stream.flush())
        .map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(stream);
    let mut response_line = String::new();
    reader
        .read_line(&mut response_line)
        .map_err(|error| error.to_string())?;
    decode_response_line(response_line.trim())
}

fn decode_response_line(line: &str) -> Result<Value, String> {
    let response: PerformanceHelperResponse =
        serde_json::from_str(line).map_err(|error| error.to_string())?;
    if response.ok {
        return Ok(response.result.unwrap_or(Value::Null));
    }
    Err(response
        .error
        .unwrap_or_else(|| "helper returned an unknown error".to_string()))
}

fn success<T: Serialize>(result: T) -> PerformanceHelperResponse {
    match serde_json::to_value(result) {
        Ok(result) => PerformanceHelperResponse {
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

fn failure(error: String) -> PerformanceHelperResponse {
    PerformanceHelperResponse {
        ok: false,
        result: None,
        error: Some(error),
    }
}

fn adapter_kind_for_platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "serviceManagementLaunchDaemon",
        "windows" => "windowsServiceJobObject",
        "linux" => "cgroupV2SystemdPsi",
        _ => "unsupported",
    }
}

#[cfg(unix)]
fn helper_is_elevated() -> bool {
    unsafe { libc::geteuid() == 0 }
}

#[cfg(windows)]
fn helper_is_elevated() -> bool {
    use windows_sys::Win32::Foundation::FALSE;
    use windows_sys::Win32::Security::{
        AllocateAndInitializeSid, CheckTokenMembership, FreeSid, PSID, SECURITY_NT_AUTHORITY,
    };
    use windows_sys::Win32::System::SystemServices::{
        DOMAIN_ALIAS_RID_ADMINS, SECURITY_BUILTIN_DOMAIN_RID,
    };

    unsafe {
        let mut administrators_group: PSID = std::ptr::null_mut();
        let allocated = AllocateAndInitializeSid(
            &SECURITY_NT_AUTHORITY,
            2,
            SECURITY_BUILTIN_DOMAIN_RID as u32,
            DOMAIN_ALIAS_RID_ADMINS as u32,
            0,
            0,
            0,
            0,
            0,
            0,
            &mut administrators_group,
        );
        if allocated == FALSE {
            return false;
        }
        let mut is_member = FALSE;
        let checked =
            CheckTokenMembership(std::ptr::null_mut(), administrators_group, &mut is_member);
        FreeSid(administrators_group);
        checked != FALSE && is_member != FALSE
    }
}

#[cfg(not(any(unix, windows)))]
fn helper_is_elevated() -> bool {
    false
}

fn non_empty_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn default_helper_transport() -> Option<String> {
    default_helper_socket().map(|socket| format!("unix:{socket}"))
}

fn default_helper_socket() -> Option<String> {
    let socket = match std::env::consts::OS {
        "macos" => MACOS_DEFAULT_HELPER_SOCKET,
        "linux" => LINUX_DEFAULT_HELPER_SOCKET,
        _ => return None,
    };
    if Path::new(socket).exists() {
        Some(socket.to_string())
    } else {
        None
    }
}

fn os_str_to_string(value: &OsStr) -> Option<String> {
    let value = value.to_string_lossy().trim().to_string();
    if value.is_empty() { None } else { Some(value) }
}
