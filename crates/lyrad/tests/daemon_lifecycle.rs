use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
#[cfg(windows)]
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};

struct DaemonProcess {
    child: Child,
}

impl DaemonProcess {
    fn spawn(endpoint: &str, temp: &TempDir) -> Self {
        let agent_home = temp.path().join("agent");
        let runtime_dir = agent_home.join("runtime");
        let child = Command::new(env!("CARGO_BIN_EXE_lyrad"))
            .arg("--socket")
            .arg(endpoint)
            .env("LYRA_AGENT_HOME", &agent_home)
            .env("LYRA_AGENT_RUNTIME_DIR", &runtime_dir)
            .env("JCODE_HOME", &agent_home)
            .env("JCODE_RUNTIME_DIR", &runtime_dir)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn lyrad");
        Self { child }
    }

    fn assert_running(&mut self) {
        assert!(self.child.try_wait().expect("try_wait").is_none());
    }

    fn kill_and_wait(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for DaemonProcess {
    fn drop(&mut self) {
        self.kill_and_wait();
    }
}

fn unique_endpoint(temp: &TempDir) -> String {
    #[cfg(unix)]
    {
        temp.path()
            .join("runtime")
            .join("lyrad.sock")
            .to_string_lossy()
            .into_owned()
    }
    #[cfg(windows)]
    {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        format!(r"\\.\pipe\lyrad-test-{}-{nanos}", std::process::id())
    }
}

#[cfg(unix)]
async fn connect(endpoint: &str) -> std::io::Result<tokio::net::UnixStream> {
    tokio::net::UnixStream::connect(endpoint).await
}

#[cfg(windows)]
async fn connect(
    endpoint: &str,
) -> std::io::Result<tokio::net::windows::named_pipe::NamedPipeClient> {
    tokio::net::windows::named_pipe::ClientOptions::new().open(endpoint)
}

async fn wait_for_connect<S, F, Fut>(mut connect_fn: F, daemon: &mut DaemonProcess) -> S
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = std::io::Result<S>>,
{
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        match connect_fn().await {
            Ok(stream) => return stream,
            Err(error) if Instant::now() < deadline => {
                if let Some(status) = daemon.child.try_wait().expect("try_wait") {
                    panic!("lyrad exited before accepting connections: {status}");
                }
                let _ = error;
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(error) => panic!("timed out connecting to lyrad: {error}"),
        }
    }
}

async fn request<S>(stream: &mut S, id: &str, method: &str, payload: Value) -> Value
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let request = json!({
        "kind": "request",
        "id": id,
        "method": method,
        "payload": payload,
    });
    stream
        .write_all(format!("{request}\n").as_bytes())
        .await
        .expect("write request");
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).await.expect("read response");
    serde_json::from_str(&line).expect("response json")
}

async fn handshake<S>(stream: &mut S) -> Value
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    request(
        stream,
        "handshake-1",
        "runtime.handshake",
        json!({ "protocolVersion": 1, "clientName": "daemon-lifecycle-test" }),
    )
    .await
}

#[tokio::test]
async fn daemon_accepts_handshake_and_reconnects_after_disconnect() {
    let temp = TempDir::new().expect("tempdir");
    let endpoint = unique_endpoint(&temp);
    let mut daemon = DaemonProcess::spawn(&endpoint, &temp);
    let mut first = wait_for_connect(|| connect(&endpoint), &mut daemon).await;
    let first_response = handshake(&mut first).await;
    assert_eq!(first_response["kind"], "response");
    assert_eq!(first_response["ok"], true);
    assert_eq!(first_response["result"]["protocolVersion"], 1);
    assert_eq!(
        first_response["result"]["capabilities"],
        json!(["agent.codegraph.status"])
    );

    drop(first);
    let mut second = wait_for_connect(|| connect(&endpoint), &mut daemon).await;
    let second_response = handshake(&mut second).await;
    assert_eq!(second_response["ok"], true);
    daemon.assert_running();
}

#[tokio::test]
async fn daemon_reports_handshake_protocol_mismatch() {
    let temp = TempDir::new().expect("tempdir");
    let endpoint = unique_endpoint(&temp);
    let mut daemon = DaemonProcess::spawn(&endpoint, &temp);
    let mut stream = wait_for_connect(|| connect(&endpoint), &mut daemon).await;

    let response = request(
        &mut stream,
        "bad-handshake",
        "runtime.handshake",
        json!({ "protocolVersion": 99, "clientName": "bad-client" }),
    )
    .await;

    assert_eq!(response["kind"], "response");
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"]["code"], "PROTOCOL_VERSION_MISMATCH");
    daemon.assert_running();
}

#[tokio::test]
async fn daemon_second_instance_exits_without_stealing_endpoint() {
    let temp = TempDir::new().expect("tempdir");
    let endpoint = unique_endpoint(&temp);
    let mut first = DaemonProcess::spawn(&endpoint, &temp);
    let mut stream = wait_for_connect(|| connect(&endpoint), &mut first).await;
    assert_eq!(handshake(&mut stream).await["ok"], true);

    let mut second = DaemonProcess::spawn(&endpoint, &temp);
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if second.child.try_wait().expect("try_wait").is_some() {
            break;
        }
        assert!(Instant::now() < deadline, "second daemon did not exit");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    first.assert_running();
    drop(stream);
    let mut stream = wait_for_connect(|| connect(&endpoint), &mut first).await;
    assert_eq!(handshake(&mut stream).await["ok"], true);
}

#[tokio::test]
async fn daemon_recovers_from_stale_socket_after_crash() {
    let temp = TempDir::new().expect("tempdir");
    let endpoint = unique_endpoint(&temp);
    let mut first = DaemonProcess::spawn(&endpoint, &temp);
    let mut stream = wait_for_connect(|| connect(&endpoint), &mut first).await;
    assert_eq!(handshake(&mut stream).await["ok"], true);
    drop(stream);
    first.kill_and_wait();

    let mut second = DaemonProcess::spawn(&endpoint, &temp);
    let mut stream = wait_for_connect(|| connect(&endpoint), &mut second).await;
    assert_eq!(handshake(&mut stream).await["ok"], true);
}

#[cfg(unix)]
#[tokio::test]
async fn daemon_unix_socket_is_private() {
    use std::os::unix::fs::PermissionsExt;

    let temp = TempDir::new().expect("tempdir");
    let endpoint = unique_endpoint(&temp);
    let mut daemon = DaemonProcess::spawn(&endpoint, &temp);
    let _stream = wait_for_connect(|| connect(&endpoint), &mut daemon).await;
    let mode = std::fs::metadata(&endpoint)
        .expect("socket metadata")
        .permissions()
        .mode()
        & 0o777;

    assert_eq!(mode, 0o600);
}
