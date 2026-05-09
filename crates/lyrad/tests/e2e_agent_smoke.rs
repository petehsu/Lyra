#![cfg(unix)]

use lyra_runtime_protocol::{RuntimeEnvelope, PROTOCOL_VERSION};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

#[test]
fn e2e_agent_smoke_completes_tool_turn_over_socket() {
    let temp = tempfile::tempdir().expect("tempdir");
    let workspace = temp.path().join("workspace");
    std::fs::create_dir_all(&workspace).expect("workspace");
    std::fs::write(workspace.join("Cargo.toml"), "[package]\nname = \"demo\"\n").expect("file");
    let model = MockModelServer::start(2);
    let mut daemon = LyradProcess::start(temp.path().join("lyrad.sock"));
    let mut client = RuntimeClient::connect(daemon.socket_path());

    let handshake = client.request(
        "runtime.handshake",
        json!({ "protocolVersion": PROTOCOL_VERSION, "clientName": "e2e-smoke" }),
    );
    assert_eq!(handshake["serverName"], "lyrad");
    upsert_profile(&mut client, temp.path(), model.base_url());
    let detail = client.request(
        "agent.sessions.create",
        json!({
            "storageRoot": temp.path().join("ai").to_string_lossy(),
            "title": "Smoke",
            "profileId": "profile-e2e",
            "projectRoot": workspace.to_string_lossy()
        }),
    );
    let session_id = detail["session"]["id"]
        .as_str()
        .expect("session")
        .to_string();

    let send = client.request(
        "agent.turn.send",
        json!({
            "storageRoot": temp.path().join("ai").to_string_lossy(),
            "sessionId": session_id,
            "input": { "text": "List files in the current directory", "attachments": [] },
            "options": {}
        }),
    );
    let turn_id = send["turnId"].as_str().expect("turn").to_string();
    let events = client.collect_agent_events(&session_id, &turn_id, Duration::from_secs(30));
    let phases = event_phases(&events);
    assert!(phases.contains(&"runtime_turn_started".to_string()));
    assert!(phases.contains(&"tool_operation_started".to_string()));
    assert!(phases.contains(&"tool_operation_completed".to_string()));
    assert!(phases.contains(&"runtime_turn_completed".to_string()));
    let final_detail = client.request(
        "agent.sessions.read",
        json!({
            "storageRoot": temp.path().join("ai").to_string_lossy(),
            "sessionId": session_id
        }),
    );
    assert!(final_detail["messages"]
        .as_array()
        .unwrap()
        .iter()
        .any(|message| {
            message["role"] == "assistant"
                && message["content"]
                    .as_str()
                    .unwrap_or_default()
                    .contains("Listed workspace files")
        }));
    assert_eq!(model.request_count(), 2);
    daemon.kill();
}

#[test]
fn e2e_agent_smoke_handles_three_concurrent_clients() {
    let temp = tempfile::tempdir().expect("tempdir");
    let model = MockModelServer::start(6);
    let mut daemon = LyradProcess::start(temp.path().join("lyrad-concurrent.sock"));
    let mut setup_client = RuntimeClient::connect(daemon.socket_path());
    upsert_profile(&mut setup_client, temp.path(), model.base_url());

    let mut handles = Vec::new();
    for index in 0..3 {
        let socket_path = daemon.socket_path().to_path_buf();
        let storage_root = temp.path().join("ai");
        let workspace = temp.path().join(format!("workspace-{index}"));
        std::fs::create_dir_all(&workspace).expect("workspace");
        std::fs::write(workspace.join(format!("file-{index}.txt")), "demo").expect("file");
        handles.push(thread::spawn(move || {
            let mut client = RuntimeClient::connect(&socket_path);
            let detail = client.request(
                "agent.sessions.create",
                json!({
                    "storageRoot": storage_root.to_string_lossy(),
                    "title": format!("Concurrent {index}"),
                    "profileId": "profile-e2e",
                    "projectRoot": workspace.to_string_lossy()
                }),
            );
            let session_id = detail["session"]["id"]
                .as_str()
                .expect("session")
                .to_string();
            let send = client.request(
                "agent.turn.send",
                json!({
                    "storageRoot": storage_root.to_string_lossy(),
                    "sessionId": session_id,
                    "input": { "text": "List files", "attachments": [] },
                    "options": {}
                }),
            );
            let turn_id = send["turnId"].as_str().expect("turn").to_string();
            let events =
                client.collect_agent_events(&session_id, &turn_id, Duration::from_secs(30));
            assert!(event_phases(&events).contains(&"runtime_turn_completed".to_string()));
            let seen_session_ids = events
                .iter()
                .filter_map(|event| event["payload"]["sessionId"].as_str())
                .collect::<Vec<_>>();
            assert!(seen_session_ids.iter().all(|id| !id.is_empty()));
            session_id
        }));
    }

    let mut session_ids = Vec::new();
    for handle in handles {
        session_ids.push(handle.join().expect("client"));
    }
    session_ids.sort();
    session_ids.dedup();
    assert_eq!(session_ids.len(), 3);
    assert_eq!(model.request_count(), 6);
    daemon.kill();
}

fn upsert_profile(client: &mut RuntimeClient, root: &Path, base_url: &str) {
    client.request(
        "model.profile.upsert",
        json!({
            "storageRoot": root.join("ai").to_string_lossy(),
            "id": "profile-e2e",
            "name": "E2E",
            "providerId": "openai",
            "protocolId": "openai_chat_completions",
            "connectionConfig": { "baseUrl": base_url },
            "authConfig": {},
            "secretValues": { "apiKey": "test-key" },
            "headers": {},
            "model": "e2e-model",
            "modelRuntimeMetadata": { "contextWindow": 128000 },
            "customModels": [],
            "isDefault": true
        }),
    );
}

fn event_phases(events: &[Value]) -> Vec<String> {
    events
        .iter()
        .filter_map(|event| event["payload"]["eventType"].as_str())
        .map(ToString::to_string)
        .collect()
}

struct RuntimeClient {
    stream: UnixStream,
    reader: BufReader<UnixStream>,
    next_id: usize,
    event_buffer: Vec<Value>,
}

impl RuntimeClient {
    fn connect(socket_path: &Path) -> Self {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match UnixStream::connect(socket_path) {
                Ok(stream) => {
                    stream
                        .set_read_timeout(Some(Duration::from_secs(30)))
                        .expect("timeout");
                    let reader = BufReader::new(stream.try_clone().expect("clone"));
                    return Self {
                        stream,
                        reader,
                        next_id: 0,
                        event_buffer: Vec::new(),
                    };
                }
                Err(error) if Instant::now() < deadline => {
                    let _ = error;
                    thread::sleep(Duration::from_millis(25));
                }
                Err(error) => panic!("failed to connect daemon socket: {error}"),
            }
        }
    }

    fn request(&mut self, method: &str, payload: Value) -> Value {
        self.next_id += 1;
        let id = format!("req-{}", self.next_id);
        let envelope = RuntimeEnvelope::Request {
            id: id.clone(),
            method: method.to_string(),
            payload,
        };
        self.write_envelope(&envelope);
        loop {
            match self.read_envelope() {
                RuntimeEnvelope::Response {
                    id: response_id,
                    ok,
                    result,
                    error,
                } if response_id == id => {
                    if !ok {
                        panic!("runtime request failed: {:?}", error);
                    }
                    return result.unwrap_or(Value::Null);
                }
                RuntimeEnvelope::Event { event, payload } => {
                    self.event_buffer
                        .push(json!({ "event": event, "payload": payload }));
                }
                _ => {}
            }
        }
    }

    fn collect_agent_events(
        &mut self,
        session_id: &str,
        turn_id: &str,
        timeout: Duration,
    ) -> Vec<Value> {
        let deadline = Instant::now() + timeout;
        let mut events = Vec::new();
        let mut pending_buffer = Vec::new();
        for entry in std::mem::take(&mut self.event_buffer) {
            if agent_event_matches(&entry, session_id, turn_id) {
                let event_type = entry["payload"]["eventType"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string();
                events.push(entry);
                if event_type == "runtime_turn_completed" {
                    self.event_buffer = pending_buffer;
                    return events;
                }
            } else {
                pending_buffer.push(entry);
            }
        }
        self.event_buffer = pending_buffer;
        while Instant::now() < deadline {
            if let RuntimeEnvelope::Event { event, payload } = self.read_envelope() {
                let entry = json!({ "event": event, "payload": payload });
                if agent_event_matches(&entry, session_id, turn_id) {
                    let event_type = entry["payload"]["eventType"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string();
                    events.push(entry);
                    if event_type == "runtime_turn_completed" {
                        return events;
                    }
                } else {
                    self.event_buffer.push(entry);
                }
            }
        }
        panic!("timed out waiting for runtime_turn_completed");
    }

    fn write_envelope(&mut self, envelope: &RuntimeEnvelope) {
        let line = serde_json::to_string(envelope).expect("encode");
        self.stream.write_all(line.as_bytes()).expect("write");
        self.stream.write_all(b"\n").expect("newline");
    }

    fn read_envelope(&mut self) -> RuntimeEnvelope {
        let mut line = String::new();
        self.reader.read_line(&mut line).expect("read");
        if line.trim().is_empty() {
            panic!("daemon socket closed");
        }
        serde_json::from_str(&line).expect("decode envelope")
    }
}

fn agent_event_matches(entry: &Value, session_id: &str, turn_id: &str) -> bool {
    entry["event"] == "agent.runtime"
        && entry["payload"]["sessionId"] == session_id
        && entry["payload"]["runtimeTurnId"] == turn_id
}

struct LyradProcess {
    child: Child,
    socket_path: PathBuf,
}

impl LyradProcess {
    fn start(socket_path: PathBuf) -> Self {
        let child = Command::new(env!("CARGO_BIN_EXE_lyrad"))
            .arg("--socket")
            .arg(&socket_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn lyrad");
        Self { child, socket_path }
    }

    fn socket_path(&self) -> &Path {
        &self.socket_path
    }

    fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for LyradProcess {
    fn drop(&mut self) {
        self.kill();
    }
}

struct MockModelServer {
    base_url: String,
    requests: Arc<AtomicUsize>,
    handle: Option<thread::JoinHandle<()>>,
}

impl MockModelServer {
    fn start(expected_requests: usize) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("model listener");
        let base_url = format!("http://{}", listener.local_addr().expect("addr"));
        let requests = Arc::new(AtomicUsize::new(0));
        let server_requests = Arc::clone(&requests);
        let handle = thread::spawn(move || {
            for _ in 0..expected_requests {
                let (mut stream, _) = listener.accept().expect("accept model");
                let body = read_http_body(&mut stream);
                server_requests.fetch_add(1, Ordering::Relaxed);
                let response_body = if body.contains("Runtime ToolFS result") {
                    sse_content("Listed workspace files.")
                } else {
                    sse_tool_call()
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );
                stream.write_all(response.as_bytes()).expect("model write");
            }
        });
        Self {
            base_url,
            requests,
            handle: Some(handle),
        }
    }

    fn base_url(&self) -> &str {
        &self.base_url
    }

    fn request_count(&self) -> usize {
        self.requests.load(Ordering::Relaxed)
    }
}

impl Drop for MockModelServer {
    fn drop(&mut self) {
        let _ = self.handle.take();
    }
}

fn read_http_body(stream: &mut TcpStream) -> String {
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .expect("timeout");
    let mut buffer = Vec::new();
    let mut temp = [0_u8; 1024];
    let header_end;
    loop {
        let read = stream.read(&mut temp).expect("read model request");
        assert!(read > 0, "model request ended before headers");
        buffer.extend_from_slice(&temp[..read]);
        if let Some(index) = find_header_end(&buffer) {
            header_end = index;
            break;
        }
    }
    let headers = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let content_length = headers
        .lines()
        .find_map(|line| {
            line.strip_prefix("Content-Length:")
                .or_else(|| line.strip_prefix("content-length:"))
                .and_then(|value| value.trim().parse::<usize>().ok())
        })
        .unwrap_or(0);
    let body_start = header_end + 4;
    while buffer.len().saturating_sub(body_start) < content_length {
        let read = stream.read(&mut temp).expect("read model body");
        assert!(read > 0, "model request ended before body");
        buffer.extend_from_slice(&temp[..read]);
    }
    String::from_utf8_lossy(&buffer[body_start..body_start + content_length]).to_string()
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn sse_tool_call() -> String {
    "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-list\",\"function\":{\"name\":\"list_directory\",\"arguments\":\"{\\\"path\\\":\\\".\\\"}\"}}]}}]}\n\ndata: [DONE]\n\n".to_string()
}

fn sse_content(content: &str) -> String {
    format!(
        "data: {{\"choices\":[{{\"delta\":{{\"content\":\"{content}\"}}}}]}}\n\ndata: [DONE]\n\n"
    )
}
