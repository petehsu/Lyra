use crate::live_output::{
    append_output, live_output_projection, new_running_state, Utf8StreamDecoder,
};
use crate::pty_io::normalize_terminal_cwd;
use crate::MAX_SESSION_BUFFER_BYTES;

use super::{
    close_session, create_session, read_session, write_session, TerminalCloseRequest,
    TerminalCreateRequest, TerminalReadRequest, TerminalWriteRequest,
};
use std::thread;
use std::time::Duration;

#[test]
fn utf8_stream_decoder_preserves_split_box_drawing() {
    let mut decoder = Utf8StreamDecoder::default();
    assert_eq!(decoder.decode(&[0xE2]), "");
    assert_eq!(decoder.decode(&[0x94]), "");
    assert_eq!(decoder.decode(&[0x80, b' ', 0xE2, 0x95]), "─ ");
    assert_eq!(decoder.decode(&[0xB0]), "╰");
}

#[test]
fn utf8_stream_decoder_replaces_invalid_bytes_without_poisoning_next_text() {
    let mut decoder = Utf8StreamDecoder::default();
    assert_eq!(decoder.decode(&[0xFF, b'a']), "\u{FFFD}a");
    assert_eq!(decoder.decode("中文".as_bytes()), "中文");
}

#[test]
fn live_output_buffers_are_bounded() {
    let state = new_running_state();
    let data = vec![b'a'; MAX_SESSION_BUFFER_BYTES + 1024];
    append_output(&state, &data);

    let guard = state.0.lock().expect("lock state");
    assert_eq!(guard.buffer.len(), MAX_SESSION_BUFFER_BYTES);
    assert_eq!(guard.text_buffer.len(), MAX_SESSION_BUFFER_BYTES);
    assert_eq!(guard.retained_start, 1024);
    assert_eq!(guard.text_retained_start, 1024);
    assert_eq!(guard.total_bytes, data.len() as u64);
    assert_eq!(guard.total_text_bytes, data.len() as u64);
    let (_, output, truncated) = live_output_projection(&guard, 0, 16);
    assert_eq!(output, "aaaaaaaaaaaaaaaa");
    assert!(truncated);
}

#[test]
fn default_terminal_cwd_uses_user_home_when_unspecified() {
    let expected_home = if cfg!(windows) {
        std::env::var("USERPROFILE").ok().or_else(|| {
            let drive = std::env::var("HOMEDRIVE").ok()?;
            let path = std::env::var("HOMEPATH").ok()?;
            Some(format!("{drive}{path}"))
        })
    } else {
        std::env::var("HOME").ok()
    }
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());

    assert_eq!(normalize_terminal_cwd(None), expected_home);
    assert_eq!(
        normalize_terminal_cwd(Some("  /explicit/workspace  ")).as_deref(),
        Some("/explicit/workspace")
    );
}

fn shell_request(command: &str) -> TerminalCreateRequest {
    TerminalCreateRequest {
        session_id: None,
        title: Some("test".to_string()),
        cwd: None,
        shell: None,
        cols: 80,
        rows: 24,
        source: Some("ai".to_string()),
        mode: Some("command".to_string()),
        command: Some(command.to_string()),
        env: None,
        persist: Some(false),
        storage_root: None,
        actor_json: None,
        correlation_json: None,
    }
}

#[test]
fn ai_source_command_session_can_be_read() {
    let snapshot = create_session(shell_request("printf 'hello'")).expect("create command session");
    thread::sleep(Duration::from_millis(150));
    let output = read_session(TerminalReadRequest {
        session_id: snapshot.session_id.clone(),
        cursor: None,
        max_bytes: None,
        wait_ms: Some(1000),
        storage_root: None,
    })
    .expect("read session");
    assert!(output.output.contains("hello"));
    assert_eq!(output.reason.as_deref(), Some("output"));
    close_session(TerminalCloseRequest {
        session_id: snapshot.session_id,
        storage_root: None,
        actor_json: None,
        correlation_json: None,
    })
    .expect("close session");
}

#[test]
fn shell_session_accepts_key_writes() {
    let snapshot = create_session(TerminalCreateRequest {
        session_id: None,
        title: Some("shell".to_string()),
        cwd: None,
        shell: None,
        cols: 80,
        rows: 24,
        source: Some("ai".to_string()),
        mode: Some("shell".to_string()),
        command: None,
        env: None,
        persist: Some(false),
        storage_root: None,
        actor_json: None,
        correlation_json: None,
    })
    .expect("create shell session");
    let cursor = read_session(TerminalReadRequest {
        session_id: snapshot.session_id.clone(),
        cursor: Some("0".to_string()),
        max_bytes: Some(65_536),
        wait_ms: Some(2_000),
        storage_root: None,
    })
    .expect("read current output")
    .cursor;
    write_session(TerminalWriteRequest {
        session_id: snapshot.session_id.clone(),
        data: None,
        text: Some("printf 'ping'".to_string()),
        keys: Some(vec!["enter".to_string()]),
        append_newline: None,
        source: Some("ai".to_string()),
        storage_root: None,
        actor_json: None,
        correlation_json: None,
    })
    .expect("write shell session");
    thread::sleep(Duration::from_millis(200));
    let mut combined = String::new();
    let mut c = cursor;
    for _ in 0..8 {
        let output = read_session(TerminalReadRequest {
            session_id: snapshot.session_id.clone(),
            cursor: Some(c),
            max_bytes: None,
            wait_ms: Some(2_000),
            storage_root: None,
        })
        .expect("read terminal output");
        c = output.cursor;
        combined.push_str(&output.output);
        if combined.contains("ping") {
            break;
        }
    }
    assert!(
        combined.contains("ping"),
        "terminal output did not contain 'ping': {combined:?}"
    );
    close_session(TerminalCloseRequest {
        session_id: snapshot.session_id,
        storage_root: None,
        actor_json: None,
        correlation_json: None,
    })
    .expect("close shell session");
}

#[test]
fn wait_session_returns_exit_when_process_exits_without_output() {
    let snapshot = create_session(shell_request("true")).expect("create command session");
    let output = read_session(TerminalReadRequest {
        session_id: snapshot.session_id.clone(),
        cursor: Some("0".to_string()),
        max_bytes: Some(16),
        wait_ms: Some(1000),
        storage_root: None,
    })
    .expect("wait for exit");
    assert_eq!(output.output, "");
    assert_eq!(output.running, false);
    assert_eq!(output.exit_code, Some(0));
    assert_eq!(output.reason.as_deref(), Some("exit"));
    close_session(TerminalCloseRequest {
        session_id: snapshot.session_id,
        storage_root: None,
        actor_json: None,
        correlation_json: None,
    })
    .expect("close session");
}

#[test]
fn read_session_strips_ansi_control_sequences() {
    let snapshot = create_session(shell_request("printf '\\033[31mred\\033[0m'"))
        .expect("create command session");
    let output = read_session(TerminalReadRequest {
        session_id: snapshot.session_id.clone(),
        cursor: Some("0".to_string()),
        max_bytes: Some(16),
        wait_ms: Some(1000),
        storage_root: None,
    })
    .expect("read ansi output");
    assert_eq!(output.output, "red");
    close_session(TerminalCloseRequest {
        session_id: snapshot.session_id,
        storage_root: None,
        actor_json: None,
        correlation_json: None,
    })
    .expect("close session");
}
