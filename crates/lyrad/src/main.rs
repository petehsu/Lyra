mod handlers;
mod modules;
mod router;

#[cfg(unix)]
use std::collections::HashMap;
#[cfg(unix)]
use std::env;
#[cfg(unix)]
use std::path::PathBuf;
#[cfg(unix)]
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(unix)]
use std::sync::{Arc, Mutex};

#[cfg(unix)]
use lyra_download_core::{
    clear_rust_event_callback as clear_download_event_callback,
    register_rust_event_callback as register_download_event_callback,
};
#[cfg(unix)]
use lyra_lsp_core::{
    clear_rust_event_callback as clear_lsp_event_callback,
    register_rust_event_callback as register_lsp_event_callback, shutdown as shutdown_lsp,
};
#[cfg(unix)]
use lyra_runtime_protocol::{RuntimeEnvelope, RuntimeError};
#[cfg(unix)]
use lyra_terminal_core::{
    clear_rust_event_callback as clear_terminal_event_callback,
    register_rust_event_callback as register_terminal_event_callback,
    shutdown as shutdown_terminal,
};
#[cfg(unix)]
use serde_json::{json, Value};
#[cfg(unix)]
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
#[cfg(unix)]
use tokio::net::{UnixListener, UnixStream};
#[cfg(unix)]
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

pub(crate) const RUNTIME_NAME: &str = "lyrad";
#[cfg(unix)]
const TOKIO_WORKER_STACK_SIZE_BYTES: usize = 16 * 1024 * 1024;
#[cfg(unix)]
const TERMINAL_RUNTIME_EVENT_NAME: &str = "terminal.runtime";
#[cfg(unix)]
const LSP_RUNTIME_EVENT_NAME: &str = "lsp.runtime";
#[cfg(unix)]
const DOWNLOAD_RUNTIME_EVENT_NAME: &str = "download.runtime";

fn main() {
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

#[cfg(not(unix))]
fn run() {
    eprintln!("lyrad local socket runtime is currently implemented for unix targets only");
    std::process::exit(1);
}

#[cfg(unix)]
#[derive(Clone)]
struct ConnectionContext {
    outgoing: UnboundedSender<RuntimeEnvelope>,
}

#[cfg(unix)]
#[derive(Clone, Default)]
struct DaemonSessionManager {
    inner: Arc<DaemonSessionManagerInner>,
}

#[cfg(unix)]
#[derive(Default)]
struct DaemonSessionManagerInner {
    next_id: AtomicU64,
    connections: Mutex<HashMap<u64, UnboundedSender<RuntimeEnvelope>>>,
}

#[cfg(unix)]
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

    #[cfg(test)]
    fn connection_count(&self) -> usize {
        self.inner
            .connections
            .lock()
            .map(|connections| connections.len())
            .unwrap_or(0)
    }
}

#[cfg(unix)]
async fn run_unix_runtime() {
    let socket_path = resolve_socket_path();
    if let Some(parent) = socket_path.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            eprintln!(
                "failed to create socket directory {}: {error}",
                parent.display()
            );
            std::process::exit(1);
        }
    }
    if socket_path.exists() {
        let _ = std::fs::remove_file(&socket_path);
    }

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

    let sessions = DaemonSessionManager::default();
    register_runtime_hooks(&sessions);
    loop {
        match listener.accept().await {
            Ok((stream, _addr)) => {
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
                std::process::exit(1);
            }
        }
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

#[cfg(unix)]
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

#[cfg(unix)]
fn register_runtime_hooks(sessions: &DaemonSessionManager) {
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
}

#[cfg(unix)]
fn shutdown_runtime_modules() {
    let _ = shutdown_terminal();
    let _ = shutdown_lsp();
    clear_terminal_event_callback();
    clear_lsp_event_callback();
    clear_download_event_callback();
}

#[cfg(unix)]
async fn write_loop(
    mut writer: tokio::net::unix::OwnedWriteHalf,
    mut receiver: tokio::sync::mpsc::UnboundedReceiver<RuntimeEnvelope>,
) {
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

#[cfg(unix)]
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
                RuntimeEnvelope::Response { .. } | RuntimeEnvelope::Event { .. } => {}
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
    fn runtime_reload_route_is_registered() {
        let result =
            handle_runtime_request("runtime.reload", serde_json::json!({})).expect("reload route");

        assert_eq!(result["status"], "reloaded");
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

}
