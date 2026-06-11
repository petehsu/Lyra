use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    sync::{OnceLock, mpsc},
};

fn read_http_json_body(stream: &mut std::net::TcpStream) -> Value {
    let mut headers = Vec::new();
    let mut byte = [0_u8; 1];
    while !headers.ends_with(b"\r\n\r\n") {
        stream.read_exact(&mut byte).expect("read header byte");
        headers.push(byte[0]);
    }
    let header_text = String::from_utf8_lossy(&headers);
    let content_length = header_text
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .expect("content length");
    let mut body = vec![0_u8; content_length];
    stream.read_exact(&mut body).expect("read request body");
    serde_json::from_slice(&body).expect("json request body")
}

fn model_tool_names(request: &Value) -> Vec<String> {
    request["tools"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|tool| {
            tool.pointer("/function/name")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect()
}

fn expected_provider_tool_names() -> Vec<String> {
    vec![
        "tool_fs_search".to_string(),
        "tool_fs_list".to_string(),
        "tool_fs_read_doc".to_string(),
        "tool_fs_inspect".to_string(),
        "tool_fs_run".to_string(),
        LYRA_TURN_FINISH_TOOL.to_string(),
    ]
}

fn start_test_runtime_turn(session_id: &str) -> String {
    let turn_id = format!("turn-test-{}", Uuid::new_v4());
    let cancellation = Arc::new(AtomicBool::new(false));
    let mut state = state().lock().expect("state lock");
    let session = state.sessions.get_mut(session_id).expect("session");
    session.snapshot["turnStatus"] = Value::String("running".to_string());
    session.snapshot["activeTurnId"] = Value::String(turn_id.clone());
    session.snapshot["follow"] = json!({ "running": true, "activity": "test" });
    session.runtime_turns.push(runtime_turn(
        &turn_id,
        session_id,
        "calling_model",
        None,
        None,
    ));
    state
        .active_cancellations
        .insert(turn_id.clone(), cancellation);
    turn_id
}

fn ensure_test_local_search_index_ready(root: &Path) {
    static SEARCH_STORAGE: OnceLock<tempfile::TempDir> = OnceLock::new();
    let storage = SEARCH_STORAGE.get_or_init(|| tempfile::tempdir().expect("search storage"));
    // Tests run in one process and Lyra search-core reads this hidden override
    // when no explicit storageRoot is supplied by Agent tools.
    unsafe {
        std::env::set_var("LYRA_SEARCH_STORAGE_ROOT", storage.path());
    }
    let root = root.canonicalize().expect("canonical search test root");
    let root_text = root.to_string_lossy().to_string();
    let _ = lyra_search_core::search_local_stream_start_json(
        json!({
            "query": "needle",
            "scopePreset": "custom",
            "customRoots": [root_text.clone()],
            "limit": 1
        })
        .to_string(),
    );
    for _ in 0..120 {
        let status = lyra_search_core::read_search_index_status_json(json!({}).to_string())
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok());
        if status
            .as_ref()
            .and_then(|status| status.get("roots"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .any(|entry| {
                entry
                    .get("root")
                    .and_then(Value::as_str)
                    .is_some_and(|status_root| test_paths_equivalent(status_root, &root))
                    && entry.get("state").and_then(Value::as_str) == Some("ready")
                    && entry
                        .get("indexedFiles")
                        .and_then(Value::as_u64)
                        .unwrap_or(0)
                        > 0
            })
        {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
    panic!("test local search index did not become ready");
}

fn test_paths_equivalent(status_root: &str, expected: &Path) -> bool {
    let status = PathBuf::from(status_root);
    if status == expected {
        return true;
    }
    status.canonicalize().is_ok_and(|status| status == expected)
}

fn ensure_test_local_search_tools_available() {
    static SEARCH_WORKSPACE: OnceLock<tempfile::TempDir> = OnceLock::new();
    let workspace = SEARCH_WORKSPACE.get_or_init(|| {
        let dir = tempfile::tempdir().expect("search workspace");
        fs::create_dir_all(dir.path().join("src")).expect("create search workspace src");
        fs::write(dir.path().join("README.md"), "needle local search\n")
            .expect("write search workspace readme");
        fs::write(dir.path().join("src/lib.rs"), "pub fn build_widget() {}\n")
            .expect("write search workspace lib");
        dir
    });
    ensure_test_local_search_index_ready(workspace.path());
}

fn tool_fs_run_call(id: &str, path: &str, args: Value) -> ModelToolCall {
    ModelToolCall {
        id: id.to_string(),
        name: "tool_fs_run".to_string(),
        arguments: json!({
            "path": path,
            "args": args,
        }),
    }
}

fn tool_fs_run_call_with_permission_mode(
    id: &str,
    path: &str,
    args: Value,
    permission_mode: &str,
) -> ModelToolCall {
    ModelToolCall {
        id: id.to_string(),
        name: "tool_fs_run".to_string(),
        arguments: json!({
            "path": path,
            "args": args,
            "permissionMode": permission_mode,
        }),
    }
}

fn wait_for_pending_permission(session_id: &str) -> String {
    for _ in 0..200 {
        if let Some(id) = state().lock().ok().and_then(|state| {
            state
                .pending_permissions
                .values()
                .find(|request| request.session_id == session_id && request.allowed.is_none())
                .map(|request| request.id.clone())
        }) {
            return id;
        }
        thread::sleep(Duration::from_millis(10));
    }
    panic!("pending permission not observed")
}

fn wait_for_pending_clarification(session_id: &str) -> String {
    for _ in 0..200 {
        if let Some(id) = state().lock().ok().and_then(|state| {
            state
                .pending_clarifications
                .values()
                .find(|request| request.session_id == session_id && request.answer.is_none())
                .map(|request| request.id.clone())
        }) {
            return id;
        }
        thread::sleep(Duration::from_millis(10));
    }
    panic!("pending clarification not observed")
}

fn serve_http_once(status_line: &str, content_type: &str, body: &str) -> String {
    serve_http_bytes_once(status_line, content_type, body.as_bytes())
}

fn serve_http_bytes_once(status_line: &str, content_type: &str, body: &[u8]) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind local test server");
    let address = listener.local_addr().expect("local address");
    let status_line = status_line.to_string();
    let content_type = content_type.to_string();
    let body = body.to_vec();
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept local request");
        let mut buffer = [0_u8; 1024];
        let _ = stream.read(&mut buffer);
        let response = format!(
            "{status_line}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
            body.len()
        );
        stream
            .write_all(response.as_bytes())
            .expect("write local response");
        stream.write_all(&body).expect("write local response body");
    });
    format!("http://{address}/index.html")
}

fn serve_http_redirect_once(location: &str) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind local redirect server");
    let address = listener.local_addr().expect("local address");
    let location = location.to_string();
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept local redirect request");
        let mut buffer = [0_u8; 1024];
        let _ = stream.read(&mut buffer);
        let response = format!(
            "HTTP/1.1 302 Found\r\nlocation: {location}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
        );
        stream
            .write_all(response.as_bytes())
            .expect("write local redirect response");
    });
    format!("http://{address}/redirect")
}

fn build_simple_pdf(text: &str) -> Vec<u8> {
    let stream = format!("BT /F1 24 Tf 72 720 Td ({}) Tj ET", text);
    let objects = vec![
        "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n".to_string(),
        "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n".to_string(),
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n".to_string(),
        format!(
            "4 0 obj\n<< /Length {} >>\nstream\n{}\nendstream\nendobj\n",
            stream.len(),
            stream
        ),
        "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n".to_string(),
    ];
    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets = vec![0usize];
    for object in &objects {
        offsets.push(pdf.len());
        pdf.push_str(object);
    }
    let xref_offset = pdf.len();
    pdf.push_str("xref\n0 6\n");
    pdf.push_str("0000000000 65535 f \n");
    for offset in offsets.iter().skip(1) {
        pdf.push_str(&format!("{:010} 00000 n \n", offset));
    }
    pdf.push_str("trailer\n<< /Root 1 0 R /Size 6 >>\n");
    pdf.push_str(&format!("startxref\n{}\n%%EOF\n", xref_offset));
    pdf.into_bytes()
}

mod foundation;
mod hardware_tools;
mod memory;
mod provider_loop;
mod terminal_tools;
