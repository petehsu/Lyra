use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
};

fn read_http_request(stream: &mut std::net::TcpStream) -> (String, Value) {
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
    (
        header_text.into_owned(),
        serde_json::from_slice(&body).expect("json request body"),
    )
}

fn read_http_json_body(stream: &mut std::net::TcpStream) -> Value {
    read_http_request(stream).1
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
        LYRA_CLARIFICATION_ASK_TOOL.to_string(),
        PLAN_BEGIN_MODEL_TOOL.to_string(),
        PLAN_WRITE_MODEL_TOOL.to_string(),
        PLAN_FINALIZE_MODEL_TOOL.to_string(),
        PLAN_REVISE_MODEL_TOOL.to_string(),
        TODO_WRITE_MODEL_TOOL.to_string(),
        TODO_UPDATE_MODEL_TOOL.to_string(),
        TODO_FINISH_MODEL_TOOL.to_string(),
        EDIT_FILE_MODEL_TOOL.to_string(),
        WRITE_FILE_MODEL_TOOL.to_string(),
        APPLY_PATCH_MODEL_TOOL.to_string(),
        EXEC_COMMAND_MODEL_TOOL.to_string(),
        WRITE_STDIN_MODEL_TOOL.to_string(),
        "tool_fs_search".to_string(),
        "tool_fs_list".to_string(),
        "tool_fs_read_doc".to_string(),
        "tool_fs_inspect".to_string(),
        "tool_fs_run".to_string(),
        LYRA_SESSION_READ_MESSAGE_TOOL.to_string(),
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
mod memory_compress;
mod phase2_memory;
mod phase3_memory;
mod phase4_memory;
mod phase5_memory;
mod phase6_memory;
mod phase7_memory;
mod provider_loop;
mod terminal_tools;
mod trim;
