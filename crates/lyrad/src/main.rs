mod handlers;
mod modules;
mod router;

#[cfg(any(unix, windows))]
use std::collections::HashMap;
#[cfg(any(unix, windows))]
use std::env;
#[cfg(unix)]
use std::fs::{File, OpenOptions};
#[cfg(unix)]
use std::io;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
#[cfg(unix)]
use std::os::unix::io::AsRawFd;
#[cfg(unix)]
use std::os::unix::net::UnixStream as StdUnixStream;
#[cfg(unix)]
use std::path::{Path, PathBuf};
#[cfg(any(unix, windows))]
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(any(unix, windows))]
use std::sync::{mpsc as std_mpsc, Arc, Mutex};
#[cfg(any(unix, windows))]
use std::time::Duration;

#[cfg(unix)]
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
    clear_rust_event_callback as clear_download_event_callback,
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
use lyra_runtime_protocol::{RuntimeEnvelope, RuntimeError};
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
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

pub(crate) const RUNTIME_NAME: &str = "lyrad";
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

fn main() {
    #[cfg(any(unix, windows))]
    if let Some(code) =
        lyra_process_lifecycle_core::run_parent_watcher_from_args(std::env::args().skip(1))
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
}

#[cfg(any(unix, windows))]
#[derive(Clone, Default)]
struct DaemonSessionManager {
    inner: Arc<DaemonSessionManagerInner>,
}

#[cfg(any(unix, windows))]
#[derive(Default)]
struct DaemonSessionManagerInner {
    next_id: AtomicU64,
    connections: Mutex<HashMap<u64, UnboundedSender<RuntimeEnvelope>>>,
    pending_requests: Mutex<HashMap<String, std_mpsc::Sender<Result<Value, RuntimeError>>>>,
}

#[cfg(any(unix, windows))]
impl DaemonSessionManager {
    fn register(&self, outgoing: UnboundedSender<RuntimeEnvelope>) -> u64 {
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        if let Ok(mut connections) = self.inner.connections.lock() {
            connections.insert(id, outgoing);
        }
        id
    }

    fn unregister(&self, id: u64) {
        if let Ok(mut connections) = self.inner.connections.lock() {
            connections.remove(&id);
        }
    }

    fn broadcast(&self, envelope: RuntimeEnvelope) {
        let Ok(connections) = self.inner.connections.lock() else {
            return;
        };
        for outgoing in connections.values() {
            let _ = outgoing.send(envelope.clone());
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
        let (tx, rx) = std_mpsc::channel();
        if let Ok(mut pending) = self.inner.pending_requests.lock() {
            pending.insert(req_id.clone(), tx);
        }

        self.broadcast(RuntimeEnvelope::Request {
            id: req_id.clone(),
            method,
            payload,
        });

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

#[cfg(not(any(
    target_os = "linux",
    target_os = "macos",
    target_os = "freebsd",
    target_os = "openbsd",
    target_os = "netbsd",
    target_os = "dragonfly"
)))]
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
    let sessions = DaemonSessionManager::default();
    register_runtime_hooks(&sessions);
    loop {
        let server = match ServerOptions::new().create(&pipe_name) {
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
    let mut args = env::args().skip(1);
    while let Some(argument) = args.next() {
        if argument == "--socket" {
            if let Some(value) = args.next() {
                return PathBuf::from(value);
            }
        }
    }
    panic!("missing required --socket argument");
}

#[cfg(windows)]
fn resolve_pipe_name() -> String {
    let mut args = env::args().skip(1);
    while let Some(argument) = args.next() {
        if argument == "--socket" {
            if let Some(value) = args.next() {
                return value;
            }
        }
    }
    panic!("missing required --socket argument");
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
    let response =
        match tokio::task::spawn_blocking(move || router::handle_runtime_request(&method, payload))
            .await
        {
            Ok(Ok(result)) => RuntimeEnvelope::Response {
                id,
                ok: true,
                result: Some(result),
                error: None,
            },
            Ok(Err(error)) => RuntimeEnvelope::Response {
                id,
                ok: false,
                result: None,
                error: Some(error),
            },
            Err(error) => RuntimeEnvelope::Response {
                id,
                ok: false,
                result: None,
                error: Some(router::runtime_error("TASK_JOIN_FAILED", error.to_string())),
            },
        };
    let _ = outgoing.send(response);
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
    };

    let writer_task = tokio::spawn(write_loop(writer, receiver));
    let mut lines = BufReader::new(reader).lines();

    let result = async {
        while let Some(line) = lines
            .next_line()
            .await
            .map_err(|error| router::runtime_error("SOCKET_READ_FAILED", error.to_string()))?
        {
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

#[cfg(test)]
mod tests {
    use crate::router::handle_runtime_request;
    use crate::DaemonSessionManager;
    use lyra_runtime_protocol::RuntimeEnvelope;
    use tokio::sync::mpsc::unbounded_channel;

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
    fn host_capability_request_times_out_without_reply() {
        let manager = DaemonSessionManager::default();
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
    fn runtime_reload_route_is_registered() {
        let result =
            handle_runtime_request("runtime.reload", serde_json::json!({})).expect("reload route");

        assert_eq!(result["status"], "reloaded");
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
