use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::mpsc,
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
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind local test server");
    let address = listener.local_addr().expect("local address");
    let status_line = status_line.to_string();
    let content_type = content_type.to_string();
    let body = body.to_string();
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept local request");
        let mut buffer = [0_u8; 1024];
        let _ = stream.read(&mut buffer);
        let response = format!(
            "{status_line}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        );
        stream
            .write_all(response.as_bytes())
            .expect("write local response");
    });
    format!("http://{address}/index.html")
}

mod foundation;
mod memory;
mod provider_loop;
mod terminal_tools;
