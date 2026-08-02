mod handlers;
mod modules;
mod router;

#[cfg(any(unix, windows))]
use std::collections::HashMap;
#[cfg(any(unix, windows))]
use std::env;
#[cfg(windows)]
use std::ffi::c_void;
#[cfg(any(unix, windows))]
use std::fs::{File, OpenOptions};
#[cfg(unix)]
use std::io;
#[cfg(windows)]
use std::io;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
#[cfg(unix)]
use std::os::unix::io::AsRawFd;
#[cfg(unix)]
use std::os::unix::net::UnixStream as StdUnixStream;
#[cfg(unix)]
use std::path::Path;
#[cfg(any(unix, windows))]
use std::path::PathBuf;
#[cfg(any(unix, windows))]
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(any(unix, windows))]
use std::sync::{mpsc as std_mpsc, Arc, Mutex};
#[cfg(any(unix, windows))]
use std::time::Duration;

#[cfg(any(unix, windows))]
use fs2::FileExt;
#[cfg(any(unix, windows))]
use lyra_agent_runtime::{
    clear_host_capability_dispatcher as clear_agent_host_capability_dispatcher,
    clear_runtime_event_callback as clear_agent_event_callback,
    register_host_capability_dispatcher as register_agent_host_capability_dispatcher,
    register_runtime_event_callback as register_agent_event_callback,
    set_runtime_backend as set_agent_runtime_backend, LyraAgentBackend,
};
#[cfg(any(unix, windows))]
use lyra_download_core::{
    clear_aria2_resource_lease_dispatcher,
    clear_rust_event_callback as clear_download_event_callback,
    register_aria2_resource_lease_dispatcher,
    register_rust_event_callback as register_download_event_callback,
};
#[cfg(any(unix, windows))]
use lyra_lsp_core::{
    clear_rust_event_callback as clear_lsp_event_callback,
    register_rust_event_callback as register_lsp_event_callback, shutdown as shutdown_lsp,
};
#[cfg(any(unix, windows))]
use lyra_performance_core::{
    clear_performance_event_callback, register_performance_event_callback,
};
#[cfg(any(unix, windows))]
use lyra_runtime_protocol::{
    RuntimeConnectionRole, RuntimeEnvelope, RuntimeError, RuntimeHelloV2Request,
};
#[cfg(any(unix, windows))]
use lyra_terminal_core::{
    clear_rust_event_callback as clear_terminal_event_callback,
    register_rust_event_callback as register_terminal_event_callback,
    shutdown as shutdown_terminal,
};
#[cfg(any(unix, windows))]
use serde_json::{json, Value};
#[cfg(any(unix, windows))]
use tokio::io::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader};
#[cfg(windows)]
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
#[cfg(unix)]
use tokio::net::{UnixListener, UnixStream};
#[cfg(any(unix, windows))]
use tokio::sync::{
    mpsc::{unbounded_channel, UnboundedSender},
    OwnedSemaphorePermit, Semaphore,
};
#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{CloseHandle, GetLastError, LocalFree, HANDLE},
    Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
        SDDL_REVISION_1,
    },
    Security::{GetTokenInformation, TokenUser, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER},
    System::Threading::{GetCurrentProcess, OpenProcessToken},
};

pub(crate) const RUNTIME_NAME: &str = "lyrad";
const RUNTIME_USAGE: &str = "Lyra Runtime daemon\n\nUsage: lyrad --socket <PATH_OR_PIPE>\n\nOptions:\n  --socket <PATH_OR_PIPE>  Runtime socket path (Unix) or named pipe (Windows)\n  -h, --help               Print help\n  -V, --version            Print version";
#[cfg(any(unix, windows))]
const TOKIO_WORKER_STACK_SIZE_BYTES: usize = 16 * 1024 * 1024;
#[cfg(any(unix, windows))]
const TERMINAL_RUNTIME_EVENT_NAME: &str = "terminal.runtime";
#[cfg(any(unix, windows))]
const LSP_RUNTIME_EVENT_NAME: &str = "lsp.runtime";
#[cfg(any(unix, windows))]
const DOWNLOAD_RUNTIME_EVENT_NAME: &str = "download.runtime";
#[cfg(any(unix, windows))]
const AGENT_RUNTIME_EVENT_NAME: &str = "agent.runtime";
#[cfg(any(unix, windows))]
const PERFORMANCE_RUNTIME_EVENT_NAME: &str = "performance.kernel";
#[cfg(any(unix, windows))]
const DEFAULT_HOST_CAPABILITY_TIMEOUT: Duration = Duration::from_secs(30);
#[cfg(any(unix, windows))]
const MAX_HOST_CAPABILITY_TIMEOUT: Duration = Duration::from_secs(120);
#[cfg(any(unix, windows))]
const HOST_CAPABILITY_TIMEOUT_GRACE: Duration = Duration::from_secs(5);
#[cfg(any(unix, windows))]
const MAX_RUNTIME_FRAME_BYTES: usize = 8 * 1024 * 1024;
#[cfg(any(unix, windows))]
const MAX_PENDING_PERFORMANCE_REQUESTS: usize = 32;

fn main() {
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    if arguments
        .iter()
        .any(|argument| argument == "--help" || argument == "-h")
    {
        println!("{RUNTIME_USAGE}");
        return;
    }
    if arguments
        .iter()
        .any(|argument| argument == "--version" || argument == "-V")
    {
        println!("{RUNTIME_NAME} {}", env!("CARGO_PKG_VERSION"));
        return;
    }

    #[cfg(any(unix, windows))]
    if let Some(code) =
        lyra_process_lifecycle_core::run_parent_watcher_from_args(arguments.iter().cloned())
    {
        std::process::exit(code);
    }

    run();
}

#[cfg(unix)]
fn run() {
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_stack_size(TOKIO_WORKER_STACK_SIZE_BYTES)
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("failed to initialize {RUNTIME_NAME} runtime: {error}");
            std::process::exit(1);
        }
    };

    runtime.block_on(run_unix_runtime());
}

#[cfg(windows)]
fn run() {
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_stack_size(TOKIO_WORKER_STACK_SIZE_BYTES)
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("failed to initialize {RUNTIME_NAME} runtime: {error}");
            std::process::exit(1);
        }
    };

    runtime.block_on(run_windows_runtime());
}

#[cfg(not(any(unix, windows)))]
fn run() {
    eprintln!("lyrad local socket runtime is not implemented for this target");
    std::process::exit(1);
}

#[cfg(any(unix, windows))]
#[derive(Clone)]
struct ConnectionContext {
    outgoing: UnboundedSender<RuntimeEnvelope>,
    performance_requests: PerformanceRequestGate,
}

#[cfg(any(unix, windows))]
#[derive(Clone)]
struct PerformanceRequestGate {
    pending: Arc<Semaphore>,
    executing: Arc<Semaphore>,
}

#[cfg(any(unix, windows))]
struct PerformanceRequestPermit {
    _pending: OwnedSemaphorePermit,
    _executing: OwnedSemaphorePermit,
}

#[cfg(any(unix, windows))]
impl PerformanceRequestGate {
    fn new(max_pending: usize) -> Self {
        Self {
            pending: Arc::new(Semaphore::new(max_pending)),
            executing: Arc::new(Semaphore::new(1)),
        }
    }

    async fn enter(&self) -> Result<PerformanceRequestPermit, RuntimeError> {
        let pending = self.pending.clone().try_acquire_owned().map_err(|_| {
            router::runtime_error(
                "RUNTIME_BUSY",
                "performance request queue is full; retry after pending updates settle",
            )
        })?;
        let executing = self.executing.clone().acquire_owned().await.map_err(|_| {
            router::runtime_error("RUNTIME_UNAVAILABLE", "performance request queue is closed")
        })?;
        Ok(PerformanceRequestPermit {
            _pending: pending,
            _executing: executing,
        })
    }
}

#[cfg(any(unix, windows))]
impl Default for PerformanceRequestGate {
    fn default() -> Self {
        Self::new(MAX_PENDING_PERFORMANCE_REQUESTS)
    }
}

#[cfg(any(unix, windows))]
#[derive(Clone)]
struct DaemonSessionManager {
    inner: Arc<DaemonSessionManagerInner>,
    performance_requests: PerformanceRequestGate,
}

#[cfg(any(unix, windows))]
#[derive(Default)]
struct DaemonSessionManagerInner {
    next_id: AtomicU64,
    connections: Mutex<HashMap<u64, ConnectionRegistration>>,
    pending_requests: Mutex<HashMap<String, std_mpsc::Sender<Result<Value, RuntimeError>>>>,
}

#[cfg(any(unix, windows))]
struct ConnectionRegistration {
    outgoing: UnboundedSender<RuntimeEnvelope>,
    role: Option<RuntimeConnectionRole>,
    lease_id: Option<String>,
}

#[cfg(any(unix, windows))]
impl Default for DaemonSessionManager {
    fn default() -> Self {
        Self {
            inner: Arc::new(DaemonSessionManagerInner::default()),
            performance_requests: PerformanceRequestGate::default(),
        }
    }
}

#[cfg(any(unix, windows))]
impl DaemonSessionManager {
    fn register(&self, outgoing: UnboundedSender<RuntimeEnvelope>) -> u64 {
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        if let Ok(mut connections) = self.inner.connections.lock() {
            connections.insert(
                id,
                ConnectionRegistration {
                    outgoing,
                    role: None,
                    lease_id: None,
                },
            );
        }
        id
    }

    fn unregister(&self, id: u64) {
        let mut primary_disconnected = false;
        if let Ok(mut connections) = self.inner.connections.lock() {
            primary_disconnected = connections.remove(&id).is_some_and(|connection| {
                connection.role == Some(RuntimeConnectionRole::PrimaryHost)
            });
        }
        if primary_disconnected {
            if let Ok(mut pending) = self.inner.pending_requests.lock() {
                for (_, sender) in pending.drain() {
                    let _ = sender.send(Err(RuntimeError::new(
                        "CAPABILITY_BRIDGE_DISCONNECTED",
                        "primary host disconnected before replying",
                    )));
                }
            }
        }
    }

    fn claim(
        &self,
        id: u64,
        role: RuntimeConnectionRole,
        lease_id: String,
    ) -> Result<(), RuntimeError> {
        let mut connections = self.inner.connections.lock().map_err(|_| {
            router::runtime_error("RUNTIME_UNAVAILABLE", "connection registry lock failed")
        })?;
        let Some(current) = connections.get(&id) else {
            return Err(router::runtime_error(
                "RUNTIME_CONNECTION_NOT_FOUND",
                "runtime connection closed during handshake",
            ));
        };
        if current.role.is_some() {
            return Err(router::runtime_error(
                "RUNTIME_DUPLICATE_HANDSHAKE",
                "runtime connection already completed its handshake",
            ));
        }
        if connections.iter().any(|(other_id, connection)| {
            *other_id != id && connection.lease_id.as_deref() == Some(lease_id.as_str())
        }) {
            return Err(router::runtime_error(
                "RUNTIME_DUPLICATE_LEASE",
                "runtime connection lease is already active",
            ));
        }
        if role == RuntimeConnectionRole::PrimaryHost
            && connections.iter().any(|(other_id, connection)| {
                *other_id != id && connection.role == Some(RuntimeConnectionRole::PrimaryHost)
            })
        {
            return Err(router::runtime_error(
                "RUNTIME_PRIMARY_HOST_EXISTS",
                "a primary host connection is already active",
            ));
        }
        let current = connections.get_mut(&id).expect("connection checked above");
        current.role = Some(role);
        current.lease_id = Some(lease_id);
        Ok(())
    }

    fn is_primary_host(&self, id: u64) -> bool {
        self.inner
            .connections
            .lock()
            .ok()
            .and_then(|connections| {
                connections
                    .get(&id)
                    .map(|connection| connection.role == Some(RuntimeConnectionRole::PrimaryHost))
            })
            .unwrap_or(false)
    }

    fn broadcast(&self, envelope: RuntimeEnvelope) {
        let Ok(connections) = self.inner.connections.lock() else {
            return;
        };
        for connection in connections.values() {
            let _ = connection.outgoing.send(envelope.clone());
        }
    }

    fn request(&self, method: String, payload: Value) -> Result<Value, RuntimeError> {
        let timeout = host_capability_timeout(&payload);
        self.request_with_timeout(method, payload, timeout)
    }

    fn request_with_timeout(
        &self,
        method: String,
        payload: Value,
        timeout: Duration,
    ) -> Result<Value, RuntimeError> {
        let req_id = format!(
            "srv-req-{}",
            self.inner.next_id.fetch_add(1, Ordering::Relaxed)
        );
        let outgoing = self
            .inner
            .connections
            .lock()
            .ok()
            .and_then(|connections| {
                connections
                    .values()
                    .find(|connection| connection.role == Some(RuntimeConnectionRole::PrimaryHost))
                    .map(|connection| connection.outgoing.clone())
            })
            .ok_or_else(|| {
                RuntimeError::new(
                    "CAPABILITY_BRIDGE_DISCONNECTED",
                    "no primary host is connected",
                )
            })?;
        let (tx, rx) = std_mpsc::channel();
        self.inner
            .pending_requests
            .lock()
            .map_err(|_| {
                RuntimeError::new(
                    "CAPABILITY_BRIDGE_DISCONNECTED",
                    "host capability request registry is unavailable",
                )
            })?
            .insert(req_id.clone(), tx);
        if outgoing
            .send(RuntimeEnvelope::Request {
                id: req_id.clone(),
                method,
                payload,
            })
            .is_err()
        {
            if let Ok(mut pending) = self.inner.pending_requests.lock() {
                pending.remove(&req_id);
            }
            return Err(RuntimeError::new(
                "CAPABILITY_BRIDGE_DISCONNECTED",
                "primary host connection closed",
            ));
        }

        match rx.recv_timeout(timeout) {
            Ok(res) => res,
            Err(std_mpsc::RecvTimeoutError::Timeout) => {
                if let Ok(mut pending) = self.inner.pending_requests.lock() {
                    pending.remove(&req_id);
                }
                Err(RuntimeError::new(
                    "CAPABILITY_BRIDGE_TIMEOUT",
                    format!(
                        "host capability request timed out after {}ms",
                        timeout.as_millis()
                    ),
                ))
            }
            Err(std_mpsc::RecvTimeoutError::Disconnected) => Err(RuntimeError::new(
                "CAPABILITY_BRIDGE_DISCONNECTED",
                "host capability reply channel closed before reply received",
            )),
        }
    }

    #[cfg(test)]
    fn connection_count(&self) -> usize {
        self.inner
            .connections
            .lock()
            .map(|connections| connections.len())
            .unwrap_or(0)
    }
}

#[cfg(any(unix, windows))]
fn host_capability_timeout(payload: &Value) -> Duration {
    let requested = payload
        .get("timeoutMs")
        .or_else(|| payload.pointer("/runtimeCancellation/timeoutMs"))
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| Duration::from_millis(value.round() as u64) + HOST_CAPABILITY_TIMEOUT_GRACE)
        .unwrap_or(DEFAULT_HOST_CAPABILITY_TIMEOUT);
    requested.min(MAX_HOST_CAPABILITY_TIMEOUT)
}

#[cfg(unix)]
struct UnixRuntimeGuard {
    socket_path: PathBuf,
    lock_file: File,
}

#[cfg(unix)]
impl Drop for UnixRuntimeGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.socket_path);
        let _ = self.lock_file.unlock();
    }
}

#[cfg(unix)]
fn chmod_path(path: &Path, mode: u32) -> io::Result<()> {
    let mut permissions = std::fs::metadata(path)?.permissions();
    permissions.set_mode(mode);
    std::fs::set_permissions(path, permissions)
}

#[cfg(windows)]
struct WindowsRuntimeGuard {
    lock_file: File,
}

#[cfg(windows)]
impl Drop for WindowsRuntimeGuard {
    fn drop(&mut self) {
        let _ = self.lock_file.unlock();
    }
}

#[cfg(windows)]
fn windows_runtime_lock_path(pipe_name: &str) -> PathBuf {
    let sanitized = pipe_name
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>();
    std::env::temp_dir()
        .join("lyra-runtime")
        .join(format!("{sanitized}.lock"))
}

#[cfg(windows)]
fn acquire_windows_runtime_guard(pipe_name: &str) -> WindowsRuntimeGuard {
    let lock_path = windows_runtime_lock_path(pipe_name);
    if let Some(parent) = lock_path.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            eprintln!(
                "failed to create runtime lock directory {}: {error}",
                parent.display()
            );
            std::process::exit(1);
        }
    }
    let lock_file = match OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
    {
        Ok(file) => file,
        Err(error) => {
            eprintln!(
                "failed to open runtime lock {}: {error}",
                lock_path.display()
            );
            std::process::exit(1);
        }
    };
    match lock_file.try_lock_exclusive() {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
            eprintln!("{RUNTIME_NAME} is already running for pipe {pipe_name}");
            std::process::exit(0);
        }
        Err(error) => {
            eprintln!("failed to lock runtime pipe {pipe_name}: {error}");
            std::process::exit(1);
        }
    }
    WindowsRuntimeGuard { lock_file }
}

#[cfg(unix)]
fn acquire_unix_runtime_guard(socket_path: &Path) -> UnixRuntimeGuard {
    let Some(parent) = socket_path.parent() else {
        eprintln!(
            "runtime socket path has no parent: {}",
            socket_path.display()
        );
        std::process::exit(1);
    };
    if let Err(error) = std::fs::create_dir_all(parent) {
        eprintln!(
            "failed to create socket directory {}: {error}",
            parent.display()
        );
        std::process::exit(1);
    }
    if let Err(error) = chmod_path(parent, 0o700) {
        eprintln!(
            "failed to secure socket directory {}: {error}",
            parent.display()
        );
        std::process::exit(1);
    }

    let lock_path = socket_path.with_extension("sock.lock");
    let lock_file = match OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(&lock_path)
    {
        Ok(file) => file,
        Err(error) => {
            eprintln!(
                "failed to open runtime lock {}: {error}",
                lock_path.display()
            );
            std::process::exit(1);
        }
    };
    match lock_file.try_lock_exclusive() {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
            eprintln!(
                "{RUNTIME_NAME} is already running for socket {}",
                socket_path.display()
            );
            std::process::exit(0);
        }
        Err(error) => {
            eprintln!(
                "failed to lock runtime socket {}: {error}",
                socket_path.display()
            );
            std::process::exit(1);
        }
    }

    if socket_path.exists() {
        if StdUnixStream::connect(socket_path).is_ok() {
            eprintln!(
                "{RUNTIME_NAME} is already serving socket {}",
                socket_path.display()
            );
            std::process::exit(0);
        }
        if let Err(error) = std::fs::remove_file(socket_path) {
            eprintln!(
                "failed to remove stale runtime socket {}: {error}",
                socket_path.display()
            );
            std::process::exit(1);
        }
    }

    UnixRuntimeGuard {
        socket_path: socket_path.to_path_buf(),
        lock_file,
    }
}

#[cfg(target_os = "linux")]
fn peer_uid(stream: &UnixStream) -> io::Result<libc::uid_t> {
    let mut credentials = libc::ucred {
        pid: 0,
        uid: 0,
        gid: 0,
    };
    let mut credentials_len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    let result = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut credentials as *mut libc::ucred).cast(),
            &mut credentials_len,
        )
    };
    if result == 0 {
        Ok(credentials.uid)
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(any(
    target_os = "macos",
    target_os = "freebsd",
    target_os = "openbsd",
    target_os = "netbsd",
    target_os = "dragonfly"
))]
fn peer_uid(stream: &UnixStream) -> io::Result<libc::uid_t> {
    let mut uid: libc::uid_t = 0;
    let mut gid: libc::gid_t = 0;
    let result = unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) };
    if result == 0 {
        Ok(uid)
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(all(
    unix,
    not(any(
        target_os = "linux",
        target_os = "macos",
        target_os = "freebsd",
        target_os = "openbsd",
        target_os = "netbsd",
        target_os = "dragonfly"
    ))
))]
fn peer_uid(_stream: &UnixStream) -> io::Result<libc::uid_t> {
    Ok(unsafe { libc::geteuid() })
}

#[cfg(unix)]
fn is_authorized_unix_peer(stream: &UnixStream) -> io::Result<bool> {
    Ok(peer_uid(stream)? == unsafe { libc::geteuid() })
}

#[cfg(unix)]
async fn run_unix_runtime() {
    let socket_path = resolve_socket_path();
    let _guard = acquire_unix_runtime_guard(&socket_path);

    let listener = match UnixListener::bind(&socket_path) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!(
                "failed to bind runtime socket {}: {error}",
                socket_path.display()
            );
            std::process::exit(1);
        }
    };
    if let Err(error) = chmod_path(&socket_path, 0o600) {
        eprintln!(
            "failed to secure runtime socket {}: {error}",
            socket_path.display()
        );
        std::process::exit(1);
    }

    let sessions = DaemonSessionManager::default();
    register_runtime_hooks(&sessions);
    loop {
        match listener.accept().await {
            Ok((stream, _addr)) => {
                match is_authorized_unix_peer(&stream) {
                    Ok(true) => {}
                    Ok(false) => {
                        eprintln!("rejected runtime connection from another local user");
                        continue;
                    }
                    Err(error) => {
                        eprintln!("failed to verify runtime peer credentials: {error}");
                        continue;
                    }
                }
                let sessions = sessions.clone();
                tokio::spawn(async move {
                    if let Err(error) = serve_connection(stream, sessions).await {
                        eprintln!("runtime connection error: {}", error.message);
                    }
                });
            }
            Err(error) => {
                eprintln!("failed to accept runtime connection: {error}");
                shutdown_runtime_modules();
                break;
            }
        }
    }
}

#[cfg(windows)]
async fn run_windows_runtime() {
    let _job_guard = lyra_process_lifecycle_core::install_windows_kill_on_close_job().ok();
    let pipe_name = resolve_pipe_name();
    let _guard = acquire_windows_runtime_guard(&pipe_name);
    let mut pipe_security = match WindowsPipeSecurity::current_user() {
        Ok(security) => security,
        Err(error) => {
            eprintln!("failed to prepare runtime named pipe security: {error}");
            shutdown_runtime_modules();
            std::process::exit(1);
        }
    };
    let sessions = DaemonSessionManager::default();
    register_runtime_hooks(&sessions);
    loop {
        let server = match unsafe {
            ServerOptions::new()
                .create_with_security_attributes_raw(&pipe_name, pipe_security.as_mut_ptr())
        } {
            Ok(server) => server,
            Err(error) => {
                eprintln!("failed to create runtime named pipe {pipe_name}: {error}");
                shutdown_runtime_modules();
                std::process::exit(1);
            }
        };
        if let Err(error) = server.connect().await {
            eprintln!("failed to accept runtime named pipe connection: {error}");
            shutdown_runtime_modules();
            std::process::exit(1);
        }
        let sessions = sessions.clone();
        tokio::spawn(async move {
            if let Err(error) = serve_connection(server, sessions).await {
                eprintln!("runtime connection error: {}", error.message);
            }
        });
    }
}

#[cfg(unix)]
fn resolve_socket_path() -> PathBuf {
    PathBuf::from(resolve_socket_argument_or_exit(env::args().skip(1)))
}

#[cfg(windows)]
fn resolve_pipe_name() -> String {
    resolve_socket_argument_or_exit(env::args().skip(1))
}

#[cfg(any(unix, windows))]
fn parse_socket_argument(args: impl IntoIterator<Item = String>) -> Result<String, &'static str> {
    let mut args = args.into_iter();
    while let Some(argument) = args.next() {
        if argument == "--socket" {
            return args
                .next()
                .filter(|value| !value.trim().is_empty())
                .ok_or("--socket requires a non-empty value");
        }
    }
    Err("missing required --socket argument")
}

#[cfg(any(unix, windows))]
fn resolve_socket_argument_or_exit(args: impl IntoIterator<Item = String>) -> String {
    parse_socket_argument(args).unwrap_or_else(|error| {
        eprintln!("lyrad: {error}\n\n{RUNTIME_USAGE}");
        std::process::exit(2);
    })
}

#[cfg(windows)]
struct WindowsPipeSecurity {
    descriptor: *mut c_void,
    attrs: SECURITY_ATTRIBUTES,
}

#[cfg(windows)]
impl WindowsPipeSecurity {
    fn current_user() -> io::Result<Self> {
        let user_sid = current_user_sid_string()?;
        let sddl = format!("D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;{user_sid})");
        let mut descriptor = std::ptr::null_mut();
        let wide = wide_null(&sddl);
        let ok = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                wide.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Self {
            descriptor,
            attrs: SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: descriptor,
                bInheritHandle: 0,
            },
        })
    }

    fn as_mut_ptr(&mut self) -> *mut c_void {
        (&mut self.attrs as *mut SECURITY_ATTRIBUTES).cast()
    }
}

#[cfg(windows)]
impl Drop for WindowsPipeSecurity {
    fn drop(&mut self) {
        if !self.descriptor.is_null() {
            unsafe {
                let _ = LocalFree(self.descriptor);
            }
        }
    }
}

#[cfg(windows)]
fn current_user_sid_string() -> io::Result<String> {
    let mut token: HANDLE = std::ptr::null_mut();
    let opened = unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) };
    if opened == 0 {
        return Err(io::Error::last_os_error());
    }
    let result = current_user_sid_string_from_token(token);
    unsafe {
        let _ = CloseHandle(token);
    }
    result
}

#[cfg(windows)]
fn current_user_sid_string_from_token(token: HANDLE) -> io::Result<String> {
    let mut needed = 0_u32;
    unsafe {
        let _ = GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut needed);
    }
    if needed == 0 {
        return Err(io::Error::from_raw_os_error(unsafe {
            GetLastError() as i32
        }));
    }
    let mut buffer = vec![0_u8; needed as usize];
    let ok = unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            buffer.as_mut_ptr().cast(),
            needed,
            &mut needed,
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    let token_user = unsafe { &*(buffer.as_ptr().cast::<TOKEN_USER>()) };
    let mut sid_string = std::ptr::null_mut();
    let ok = unsafe { ConvertSidToStringSidW(token_user.User.Sid, &mut sid_string) };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    let value = unsafe { wide_ptr_to_string(sid_string) };
    unsafe {
        let _ = LocalFree(sid_string.cast());
    }
    Ok(value)
}

#[cfg(windows)]
fn wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
unsafe fn wide_ptr_to_string(value: *const u16) -> String {
    let mut len = 0_usize;
    while *value.add(len) != 0 {
        len += 1;
    }
    String::from_utf16_lossy(std::slice::from_raw_parts(value, len))
}

#[cfg(any(unix, windows))]
fn forward_json_event(sessions: &DaemonSessionManager, event_name: &str, payload_json: &str) {
    let payload = match serde_json::from_str::<Value>(payload_json) {
        Ok(payload) => payload,
        Err(error) => json!({
            "kind": "error",
            "message": format!("failed to decode {event_name} payload: {error}")
        }),
    };
    sessions.broadcast(RuntimeEnvelope::Event {
        event: event_name.to_string(),
        payload,
    });
}

#[cfg(any(unix, windows))]
fn register_runtime_hooks(sessions: &DaemonSessionManager) {
    set_agent_runtime_backend(Arc::new(LyraAgentBackend));

    let terminal_sessions = sessions.clone();
    register_terminal_event_callback(Arc::new(move |event_json| {
        forward_json_event(&terminal_sessions, TERMINAL_RUNTIME_EVENT_NAME, &event_json);
    }));

    let lsp_sessions = sessions.clone();
    register_lsp_event_callback(Arc::new(move |event_json| {
        forward_json_event(&lsp_sessions, LSP_RUNTIME_EVENT_NAME, &event_json);
    }));

    let download_sessions = sessions.clone();
    register_download_event_callback(Arc::new(move |event_json| {
        forward_json_event(&download_sessions, DOWNLOAD_RUNTIME_EVENT_NAME, &event_json);
    }));

    let aria2_lease_sessions = sessions.clone();
    register_aria2_resource_lease_dispatcher(Arc::new(move |method, payload_json| {
        let payload = serde_json::from_str::<Value>(&payload_json)
            .map_err(|error| format!("failed to parse aria2 lease payload: {error}"))?;
        aria2_lease_sessions
            .request(method.to_string(), payload)
            .and_then(|result| {
                serde_json::to_string(&result).map_err(|error| {
                    RuntimeError::new(
                        "SERDE_ENCODE_FAILED",
                        format!("failed to serialize aria2 lease response: {error}"),
                    )
                })
            })
            .map_err(|error| error.message)
    }));

    let agent_sessions = sessions.clone();
    register_agent_event_callback(Arc::new(move |event_json| {
        forward_json_event(&agent_sessions, AGENT_RUNTIME_EVENT_NAME, &event_json);
    }));

    let performance_sessions = sessions.clone();
    register_performance_event_callback(Arc::new(move |event_json| {
        forward_json_event(
            &performance_sessions,
            PERFORMANCE_RUNTIME_EVENT_NAME,
            &event_json,
        );
    }));

    let host_sessions = sessions.clone();
    register_agent_host_capability_dispatcher(Arc::new(move |method, payload_json| {
        let payload = match serde_json::from_str::<Value>(&payload_json) {
            Ok(val) => val,
            Err(e) => return Err(format!("Failed to parse payload: {e}")),
        };
        match host_sessions.request(method, payload) {
            Ok(result) => serde_json::to_string(&result)
                .map_err(|e| format!("Failed to serialize response: {e}")),
            Err(error) => Err(error.message),
        }
    }));
}

#[cfg(any(unix, windows))]
fn shutdown_runtime_modules() {
    let _ = shutdown_terminal();
    let _ = shutdown_lsp();
    clear_terminal_event_callback();
    clear_lsp_event_callback();
    clear_download_event_callback();
    clear_aria2_resource_lease_dispatcher();
    clear_agent_event_callback();
    clear_performance_event_callback();
    clear_agent_host_capability_dispatcher();
}

#[cfg(any(unix, windows))]
async fn write_loop<W>(
    mut writer: W,
    mut receiver: tokio::sync::mpsc::UnboundedReceiver<RuntimeEnvelope>,
) where
    W: AsyncWrite + Unpin,
{
    while let Some(envelope) = receiver.recv().await {
        let encoded = match serde_json::to_vec(&envelope) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if writer.write_all(&encoded).await.is_err() {
            break;
        }
        if writer.write_all(b"\n").await.is_err() {
            break;
        }
    }
}

#[cfg(any(unix, windows))]
async fn handle_request_envelope(
    connection: ConnectionContext,
    id: String,
    method: String,
    payload: Value,
) {
    let outgoing = connection.outgoing.clone();
    let result = if method.starts_with("performance.") {
        let _permit = connection.performance_requests.enter().await;
        match _permit {
            Ok(_permit) => tokio::task::spawn_blocking(move || {
                router::handle_runtime_request(&method, payload)
            })
            .await
            .map_err(|error| router::runtime_error("TASK_JOIN_FAILED", error.to_string()))
            .and_then(|result| result),
            Err(error) => Err(error),
        }
    } else {
        tokio::task::spawn_blocking(move || router::handle_runtime_request(&method, payload))
            .await
            .map_err(|error| router::runtime_error("TASK_JOIN_FAILED", error.to_string()))
            .and_then(|result| result)
    };
    let response = runtime_response(id, result);
    let _ = outgoing.send(response);
}

#[cfg(any(unix, windows))]
fn runtime_response(id: String, result: Result<Value, RuntimeError>) -> RuntimeEnvelope {
    match result {
        Ok(result) => RuntimeEnvelope::Response {
            id,
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(error) => RuntimeEnvelope::Response {
            id,
            ok: false,
            result: None,
            error: Some(error),
        },
    }
}

#[cfg(unix)]
async fn serve_connection(
    stream: UnixStream,
    sessions: DaemonSessionManager,
) -> Result<(), RuntimeError> {
    let (reader, writer) = stream.into_split();
    serve_stream(reader, writer, sessions).await
}

#[cfg(windows)]
async fn serve_connection(
    stream: NamedPipeServer,
    sessions: DaemonSessionManager,
) -> Result<(), RuntimeError> {
    let (reader, writer) = tokio::io::split(stream);
    serve_stream(reader, writer, sessions).await
}

#[cfg(any(unix, windows))]
async fn serve_stream<R, W>(
    reader: R,
    writer: W,
    sessions: DaemonSessionManager,
) -> Result<(), RuntimeError>
where
    R: tokio::io::AsyncRead + Unpin,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let (outgoing, receiver) = unbounded_channel::<RuntimeEnvelope>();
    let connection_id = sessions.register(outgoing.clone());
    let context = ConnectionContext {
        outgoing: outgoing.clone(),
        performance_requests: sessions.performance_requests.clone(),
    };

    let writer_task = tokio::spawn(write_loop(writer, receiver));
    let mut reader = BufReader::new(reader);
    let mut handshake_complete = false;

    let result = async {
        while let Some(line) = read_runtime_frame(&mut reader).await? {
            if line.trim().is_empty() {
                continue;
            }
            let envelope: RuntimeEnvelope = serde_json::from_str(&line).map_err(|error| {
                router::runtime_error("PROTOCOL_DECODE_FAILED", error.to_string())
            })?;
            match envelope {
                RuntimeEnvelope::Request {
                    id,
                    method,
                    payload,
                } => {
                    if method == "runtime.handshake" {
                        let result = if handshake_complete {
                            Err(router::runtime_error(
                                "RUNTIME_DUPLICATE_HANDSHAKE",
                                "runtime connection already completed its handshake",
                            ))
                        } else {
                            serde_json::from_value::<RuntimeHelloV2Request>(payload.clone())
                                .map_err(|error| {
                                    router::runtime_error("BAD_REQUEST", error.to_string())
                                })
                                .and_then(|hello| {
                                    let role = hello.connection_role.clone();
                                    let lease_id = hello.connection_lease_id.clone();
                                    router::handle_runtime_request(&method, payload).and_then(
                                        |response| {
                                            sessions
                                                .claim(connection_id, role, lease_id)
                                                .map(|()| response)
                                        },
                                    )
                                })
                        };
                        handshake_complete = result.is_ok();
                        let _ = outgoing.send(runtime_response(id, result));
                        continue;
                    }
                    if !handshake_complete {
                        let _ = outgoing.send(runtime_response(
                            id,
                            Err(router::runtime_error(
                                "RUNTIME_HANDSHAKE_REQUIRED",
                                "RuntimeHelloV2 must complete before other requests",
                            )),
                        ));
                        continue;
                    }
                    tokio::spawn(handle_request_envelope(
                        context.clone(),
                        id,
                        method,
                        payload,
                    ));
                }
                RuntimeEnvelope::Response {
                    id,
                    ok,
                    result,
                    error,
                } => {
                    if !handshake_complete || !sessions.is_primary_host(connection_id) {
                        continue;
                    }
                    if let Ok(mut pending) = sessions.inner.pending_requests.lock() {
                        if let Some(tx) = pending.remove(&id) {
                            let val = if ok {
                                Ok(result.unwrap_or(Value::Null))
                            } else {
                                Err(error.unwrap_or_else(|| {
                                    router::runtime_error("UNKNOWN_ERROR", "unknown error")
                                }))
                            };
                            let _ = tx.send(val);
                        }
                    }
                }
                RuntimeEnvelope::Event { .. } => {}
            }
        }
        Ok(())
    }
    .await;

    writer_task.abort();
    sessions.unregister(connection_id);
    result
}

#[cfg(any(unix, windows))]
async fn read_runtime_frame<R>(reader: &mut BufReader<R>) -> Result<Option<String>, RuntimeError>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut buffer = Vec::new();
    loop {
        let read = reader
            .read_until(b'\n', &mut buffer)
            .await
            .map_err(|error| router::runtime_error("SOCKET_READ_FAILED", error.to_string()))?;
        if buffer.len() > MAX_RUNTIME_FRAME_BYTES {
            return Err(router::runtime_error(
                "PROTOCOL_FRAME_TOO_LARGE",
                format!(
                    "runtime protocol frame exceeded {} bytes",
                    MAX_RUNTIME_FRAME_BYTES
                ),
            ));
        }
        if read == 0 {
            if buffer.is_empty() {
                return Ok(None);
            }
            break;
        }
        if buffer.last() == Some(&b'\n') {
            break;
        }
    }
    if buffer.last() == Some(&b'\n') {
        buffer.pop();
    }
    if buffer.last() == Some(&b'\r') {
        buffer.pop();
    }
    String::from_utf8(buffer)
        .map(Some)
        .map_err(|error| router::runtime_error("PROTOCOL_DECODE_FAILED", error.to_string()))
}

#[cfg(test)]
mod tests {
    use crate::router::handle_runtime_request;
    use crate::{parse_socket_argument, DaemonSessionManager, PerformanceRequestGate};
    use lyra_runtime_protocol::{RuntimeConnectionRole, RuntimeEnvelope};
    use tokio::sync::mpsc::unbounded_channel;

    #[test]
    fn parses_a_required_non_empty_runtime_socket() {
        assert_eq!(
            parse_socket_argument(vec!["--socket".to_string(), "/tmp/lyrad.sock".to_string()]),
            Ok("/tmp/lyrad.sock".to_string())
        );
        assert_eq!(
            parse_socket_argument(Vec::<String>::new()),
            Err("missing required --socket argument")
        );
        assert_eq!(
            parse_socket_argument(vec!["--socket".to_string(), "  ".to_string()]),
            Err("--socket requires a non-empty value")
        );
    }

    #[test]
    fn registers_unregisters_and_broadcasts_connections() {
        let manager = DaemonSessionManager::default();
        let (sender, mut receiver) = unbounded_channel();
        let id = manager.register(sender);

        assert_eq!(manager.connection_count(), 1);
        manager.broadcast(RuntimeEnvelope::Event {
            event: "runtime.test".to_string(),
            payload: serde_json::json!({ "ok": true }),
        });
        assert!(receiver.try_recv().is_ok());
        manager.unregister(id);
        assert_eq!(manager.connection_count(), 0);
    }

    #[test]
    fn performance_request_gate_rejects_excess_waiters() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let gate = PerformanceRequestGate::new(1);
            let active = gate.enter().await.expect("first request admitted");
            let error = gate.enter().await.err().expect("second request rejected");
            assert_eq!(error.code, "RUNTIME_BUSY");
            drop(active);
            assert!(gate.enter().await.is_ok());
        });
    }

    #[test]
    fn host_capability_request_times_out_without_reply() {
        let manager = DaemonSessionManager::default();
        let (sender, _receiver) = unbounded_channel();
        let connection_id = manager.register(sender);
        manager
            .claim(
                connection_id,
                RuntimeConnectionRole::PrimaryHost,
                "desktop-lease".to_string(),
            )
            .expect("primary host claim");
        let error = manager
            .request_with_timeout(
                "workbench.readTab".to_string(),
                serde_json::json!({ "tabId": "browser-tab-1" }),
                std::time::Duration::from_millis(10),
            )
            .expect_err("request should time out");

        assert_eq!(error.code, "CAPABILITY_BRIDGE_TIMEOUT");
        assert!(manager
            .inner
            .pending_requests
            .lock()
            .expect("pending lock")
            .is_empty());
    }

    #[test]
    fn permits_one_primary_host_and_rejects_duplicate_leases() {
        let manager = DaemonSessionManager::default();
        let (first_sender, _first_receiver) = unbounded_channel();
        let (second_sender, _second_receiver) = unbounded_channel();
        let (third_sender, _third_receiver) = unbounded_channel();
        let first = manager.register(first_sender);
        let second = manager.register(second_sender);
        let third = manager.register(third_sender);

        manager
            .claim(
                first,
                RuntimeConnectionRole::PrimaryHost,
                "desktop-lease".to_string(),
            )
            .expect("first primary host");
        let duplicate_primary = manager
            .claim(
                second,
                RuntimeConnectionRole::PrimaryHost,
                "other-lease".to_string(),
            )
            .expect_err("second primary host must be rejected");
        assert_eq!(duplicate_primary.code, "RUNTIME_PRIMARY_HOST_EXISTS");
        let duplicate_lease = manager
            .claim(
                third,
                RuntimeConnectionRole::AuxiliaryClient,
                "desktop-lease".to_string(),
            )
            .expect_err("duplicate lease must be rejected");
        assert_eq!(duplicate_lease.code, "RUNTIME_DUPLICATE_LEASE");
    }

    #[test]
    fn runtime_reload_route_is_registered() {
        let result =
            handle_runtime_request("runtime.reload", serde_json::json!({})).expect("reload route");

        assert_eq!(result["status"], "reloaded");
    }

    #[test]
    fn runtime_identity_route_reports_the_running_binary() {
        let result = handle_runtime_request("runtime.identity", serde_json::json!({}))
            .expect("identity route");

        let expected_component_version =
            option_env!("LYRA_COMPONENT_VERSION").unwrap_or(env!("CARGO_PKG_VERSION"));
        assert_eq!(result["componentVersion"], expected_component_version);
        assert!(semver::Version::parse(expected_component_version).is_ok());
        assert!(result["buildId"]
            .as_str()
            .is_some_and(|value| !value.is_empty()));
        assert_eq!(
            result["protocolMinVersion"],
            lyra_runtime_protocol::PROTOCOL_MIN_VERSION
        );
        assert_eq!(
            result["protocolMaxVersion"],
            lyra_runtime_protocol::PROTOCOL_MAX_VERSION
        );
    }

    #[tokio::test]
    async fn runtime_frame_reader_rejects_oversized_lines() {
        let data = vec![b'a'; crate::MAX_RUNTIME_FRAME_BYTES + 1];
        let mut reader = tokio::io::BufReader::new(data.as_slice());
        let error = crate::read_runtime_frame(&mut reader)
            .await
            .expect_err("oversized frame");

        assert_eq!(error.code, "PROTOCOL_FRAME_TOO_LARGE");
    }

    #[tokio::test]
    async fn runtime_frame_reader_accepts_newline_delimited_json() {
        let mut reader = tokio::io::BufReader::new(br#"{"kind":"Event"}"#.as_slice());
        let line = crate::read_runtime_frame(&mut reader)
            .await
            .expect("read frame")
            .expect("line");

        assert_eq!(line, r#"{"kind":"Event"}"#);
    }

    #[cfg(unix)]
    #[test]
    fn chmod_path_sets_unix_mode() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().expect("tempdir");
        crate::chmod_path(temp.path(), 0o700).expect("chmod path");

        let mode = std::fs::metadata(temp.path())
            .expect("metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o700);
    }

    #[cfg(windows)]
    #[test]
    fn windows_runtime_lock_path_is_stable_for_pipe_name() {
        let path = crate::windows_runtime_lock_path(r"\\.\pipe\lyra-runtime-test");

        assert!(path.to_string_lossy().contains("lyra-runtime"));
        assert!(path
            .file_name()
            .and_then(std::ffi::OsStr::to_str)
            .is_some_and(|name| name.ends_with(".lock") && !name.contains('\\')));
    }

    #[cfg(windows)]
    #[test]
    fn windows_pipe_security_descriptor_can_be_created_for_current_user() {
        let _security =
            crate::WindowsPipeSecurity::current_user().expect("current-user pipe security");
    }

    #[test]
    fn download_routes_are_registered() {
        let temp = tempfile::tempdir().expect("tempdir");
        let storage_root = temp.path().to_string_lossy();

        let snapshot = handle_runtime_request(
            "download.list",
            serde_json::json!({ "storageRoot": storage_root }),
        )
        .expect("download list route");
        assert_eq!(snapshot["tasks"].as_array().expect("tasks").len(), 0);

        let settings = handle_runtime_request(
            "download.settings.read",
            serde_json::json!({ "storageRoot": storage_root }),
        )
        .expect("download settings route");
        assert_eq!(settings["version"], 1);

        let remote_status = handle_runtime_request(
            "download.remote.status",
            serde_json::json!({ "storageRoot": storage_root }),
        )
        .expect("download remote status route");
        assert_eq!(remote_status["running"], false);
    }

    #[test]
    fn agent_routes_are_registered() {
        let snapshot = handle_runtime_request(
            "agent.session.create",
            serde_json::json!({ "title": "Route Test" }),
        )
        .expect("agent create route");
        assert_eq!(snapshot["title"], "Route Test");

        let session_id = snapshot["id"].as_str().expect("session id");
        let read = handle_runtime_request(
            "agent.session.read",
            serde_json::json!({ "sessionId": session_id }),
        )
        .expect("agent read route");
        assert_eq!(read["id"], session_id);

        let bound = handle_runtime_request(
            "agent.session.bindProject",
            serde_json::json!({
                "sessionId": session_id,
                "workingDir": "/"
            }),
        )
        .expect("agent bind project route");
        assert_eq!(bound["id"], session_id);
        assert_eq!(bound["workingDir"], "/");

        let rollback_preview = handle_runtime_request(
            "agent.rollback.preview",
            serde_json::json!({
                "sessionId": session_id,
                "messageId": "missing-message"
            }),
        )
        .expect("agent rollback preview route");
        assert_eq!(rollback_preview["available"], false);

        let rollback_restore = handle_runtime_request(
            "agent.rollback.restore",
            serde_json::json!({
                "sessionId": session_id,
                "messageId": "missing-message",
                "mode": "taskAndWorkspace"
            }),
        )
        .expect_err("rollback restore without checkpoint should fail");
        assert_eq!(rollback_restore.code, "RUNTIME_ERROR");
    }

    #[test]
    fn unknown_agent_route_errors() {
        let error = handle_runtime_request("agent.unknown", serde_json::json!({}))
            .expect_err("unknown route should fail");
        assert_eq!(error.code, "METHOD_NOT_FOUND");
    }

    #[test]
    fn performance_routes_are_registered() {
        let status = handle_runtime_request("performance.status", serde_json::json!({}))
            .expect("performance status");
        assert_eq!(status["authorizationRequired"], true);

        let registered = handle_runtime_request(
            "performance.registerResource",
            serde_json::json!({
                "resourceId": "browserPage:route-test",
                "kind": "browserPage",
                "coreKey": "https://example.test",
                "stateKey": "web-state:route-test",
                "lifecycle": "hotHidden",
                "sharedSignature": "https://example.test/home"
            }),
        )
        .expect("performance register");
        assert_eq!(registered["event"]["resourceId"], "browserPage:route-test");
    }
}
