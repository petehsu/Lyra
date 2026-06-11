use crate::live_output::Utf8StreamDecoder;
use crate::memory;
use crate::pty_io::normalize_terminal_cwd;

use super::{
    close_observer_session, close_session, create_observer_session, create_session, read_screen,
    read_session, record_observer_input, record_observer_output, resize_observer_session,
    write_session, TerminalCloseRequest, TerminalCreateRequest, TerminalObserverCloseRequest,
    TerminalObserverCreateRequest, TerminalObserverInputRequest, TerminalObserverOutputRequest,
    TerminalObserverResizeRequest, TerminalReadRequest, TerminalScreenReadRequest,
    TerminalWriteRequest,
};
use serde_json::Value;
use std::fs;
use std::thread;
use std::time::Duration;

fn temp_root(name: &str) -> String {
    let root = std::env::temp_dir().join(format!(
        "lyra-terminal-core-{name}-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&root).expect("create temp root");
    root.to_string_lossy().to_string()
}

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

fn shell_request(command: &str, storage_root: Option<String>) -> TerminalCreateRequest {
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
        storage_root,
        actor_json: None,
        correlation_json: None,
    }
}

fn current_output_cursor(session_id: &str, storage_root: &str) -> String {
    read_session(TerminalReadRequest {
        session_id: session_id.to_string(),
        cursor: Some("0".to_string()),
        max_bytes: Some(65_536),
        wait_ms: Some(2_000),
        storage_root: Some(storage_root.to_string()),
    })
    .expect("read current output")
    .cursor
}

fn read_until_contains(session_id: &str, storage_root: &str, cursor: String, needle: &str) {
    let mut cursor = cursor;
    let mut combined = String::new();
    for _ in 0..8 {
        let output = read_session(TerminalReadRequest {
            session_id: session_id.to_string(),
            cursor: Some(cursor),
            max_bytes: None,
            wait_ms: Some(2_000),
            storage_root: Some(storage_root.to_string()),
        })
        .expect("read terminal output");
        cursor = output.cursor;
        combined.push_str(&output.output);
        if combined.contains(needle) {
            return;
        }
    }
    panic!("terminal output did not contain {needle:?}: {combined:?}");
}

#[test]
fn observed_external_pty_session_feeds_rust_memory_and_screen() {
    let root = temp_root("observer-external-pty");
    let snapshot = create_observer_session(TerminalObserverCreateRequest {
        session_id: "visible-session-1".to_string(),
        title: Some("Default".to_string()),
        cwd: Some("/workspace".to_string()),
        shell: Some("/bin/zsh".to_string()),
        cols: 80,
        rows: 24,
        source: Some("user".to_string()),
        mode: Some("shell".to_string()),
        command: None,
        persist: Some(true),
        storage_root: root.clone(),
        actor_json: Some("{\"kind\":\"human_user\"}".to_string()),
        correlation_json: Some("{\"terminalTabId\":\"tab-1\"}".to_string()),
    })
    .expect("create observer");
    assert_eq!(snapshot.session_id, "visible-session-1");
    assert_eq!(snapshot.shell, "/bin/zsh");

    record_observer_input(TerminalObserverInputRequest {
        session_id: snapshot.session_id.clone(),
        data: None,
        text: Some("npm test".to_string()),
        keys: None,
        append_newline: Some(true),
        source: Some("agent".to_string()),
        storage_root: Some(root.clone()),
        actor_json: Some("{\"kind\":\"agent\",\"agentSessionId\":\"agent-1\"}".to_string()),
        correlation_json: Some(
            "{\"agentSessionId\":\"agent-1\",\"terminalToolName\":\"terminal.write\"}".to_string(),
        ),
    })
    .expect("record input");
    record_observer_output(TerminalObserverOutputRequest {
        session_id: snapshot.session_id.clone(),
        data: "hello \u{1b}[31mred\u{1b}[0m\r\n".to_string(),
        storage_root: Some(root.clone()),
    })
    .expect("record output");

    let output = read_session(TerminalReadRequest {
        session_id: snapshot.session_id.clone(),
        cursor: Some("0".to_string()),
        max_bytes: Some(1024),
        wait_ms: Some(0),
        storage_root: Some(root.clone()),
    })
    .expect("read observed output");
    assert_eq!(output.reason.as_deref(), Some("output"));
    assert!(output.output.contains("hello red"));
    assert!(output.running);
    assert!(output.memory.is_some());

    resize_observer_session(TerminalObserverResizeRequest {
        session_id: snapshot.session_id.clone(),
        cols: 100,
        rows: 30,
        storage_root: Some(root.clone()),
        actor_json: None,
        correlation_json: None,
    })
    .expect("resize observer");
    let screen = read_screen(TerminalScreenReadRequest {
        session_id: snapshot.session_id.clone(),
        storage_root: Some(root.clone()),
        cursor: None,
        include_scrollback: Some(false),
        max_rows: Some(30),
        max_bytes: Some(4096),
        selected_text: None,
    })
    .expect("read observed screen");
    assert_eq!(screen.cols, 100);
    assert_eq!(screen.rows, 30);
    assert!(screen.visible_text.contains("hello red"));
    assert!(screen.memory.is_some());

    let memory: Value =
        serde_json::from_str(output.memory.as_ref().expect("memory")).expect("parse memory");
    let events = fs::read_to_string(memory["eventLogPath"].as_str().expect("event path"))
        .expect("read events");
    assert!(events.contains("\"kind\":\"session_created\""));
    assert!(events.contains("\"kind\":\"input_text\""));
    assert!(events.contains("\"kind\":\"output_chunk\""));
    assert!(events.contains("\"kind\":\"screen_diff\""));

    close_observer_session(TerminalObserverCloseRequest {
        session_id: snapshot.session_id,
        storage_root: Some(root.clone()),
        actor_json: None,
        correlation_json: None,
    })
    .expect("close observer");
    fs::remove_dir_all(root).ok();
}

#[test]
fn ai_source_command_session_can_be_read() {
    let root = temp_root("command-read");
    let snapshot = create_session(shell_request("printf 'hello'", Some(root.clone())))
        .expect("create command session");
    thread::sleep(Duration::from_millis(150));
    let output = read_session(TerminalReadRequest {
        session_id: snapshot.session_id.clone(),
        cursor: None,
        max_bytes: None,
        wait_ms: Some(1000),
        storage_root: Some(root.clone()),
    })
    .expect("read session");
    assert!(output.output.contains("hello"));
    assert_eq!(output.reason.as_deref(), Some("output"));
    close_session(TerminalCloseRequest {
        session_id: snapshot.session_id,
        storage_root: Some(root.clone()),
        actor_json: None,
        correlation_json: None,
    })
    .expect("close session");
    fs::remove_dir_all(root).ok();
}

#[test]
fn shell_session_accepts_key_writes() {
    let root = temp_root("key-write");
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
        storage_root: Some(root.clone()),
        actor_json: None,
        correlation_json: None,
    })
    .expect("create shell session");
    let cursor = current_output_cursor(&snapshot.session_id, &root);
    write_session(TerminalWriteRequest {
        session_id: snapshot.session_id.clone(),
        data: None,
        text: Some("printf 'ping'".to_string()),
        keys: Some(vec!["enter".to_string()]),
        append_newline: None,
        source: Some("ai".to_string()),
        storage_root: Some(root.clone()),
        actor_json: None,
        correlation_json: None,
    })
    .expect("write shell session");
    thread::sleep(Duration::from_millis(200));
    read_until_contains(&snapshot.session_id, &root, cursor, "ping");
    close_session(TerminalCloseRequest {
        session_id: snapshot.session_id,
        storage_root: Some(root.clone()),
        actor_json: None,
        correlation_json: None,
    })
    .expect("close shell session");
    fs::remove_dir_all(root).ok();
}

#[test]
fn shell_session_appends_newline_to_data_writes() {
    let root = temp_root("append-newline");
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
        storage_root: Some(root.clone()),
        actor_json: None,
        correlation_json: None,
    })
    .expect("create shell session");
    let cursor = current_output_cursor(&snapshot.session_id, &root);
    write_session(TerminalWriteRequest {
        session_id: snapshot.session_id.clone(),
        data: Some("printf 'newline-data'".to_string()),
        text: None,
        keys: None,
        append_newline: Some(true),
        source: Some("ai".to_string()),
        storage_root: Some(root.clone()),
        actor_json: None,
        correlation_json: None,
    })
    .expect("write shell session");
    thread::sleep(Duration::from_millis(200));
    read_until_contains(&snapshot.session_id, &root, cursor, "newline-data");
    close_session(TerminalCloseRequest {
        session_id: snapshot.session_id,
        storage_root: Some(root.clone()),
        actor_json: None,
        correlation_json: None,
    })
    .expect("close shell session");
    fs::remove_dir_all(root).ok();
}

#[test]
fn read_session_uses_memory_output_cursor_without_skipping_long_output() {
    let root = temp_root("cursor-read");
    let snapshot = create_session(shell_request("printf 'abcdef'", Some(root.clone())))
        .expect("create command session");
    let first = read_session(TerminalReadRequest {
        session_id: snapshot.session_id.clone(),
        cursor: Some("0".to_string()),
        max_bytes: Some(3),
        wait_ms: Some(1000),
        storage_root: Some(root.clone()),
    })
    .expect("read first chunk");
    assert_eq!(first.output, "abc");
    assert_eq!(first.cursor, "3");
    assert!(first.truncated);
    assert_eq!(first.reason.as_deref(), Some("output"));

    let second = read_session(TerminalReadRequest {
        session_id: snapshot.session_id.clone(),
        cursor: Some(first.cursor),
        max_bytes: Some(3),
        wait_ms: Some(1000),
        storage_root: Some(root.clone()),
    })
    .expect("read second chunk");
    assert_eq!(second.output, "def");
    assert_eq!(second.cursor, "6");
    assert!(!second.truncated);

    close_session(TerminalCloseRequest {
        session_id: snapshot.session_id,
        storage_root: Some(root.clone()),
        actor_json: None,
        correlation_json: None,
    })
    .expect("close session");
    fs::remove_dir_all(root).ok();
}

#[test]
fn wait_session_returns_exit_when_process_exits_without_output() {
    let root = temp_root("wait-exit");
    let snapshot =
        create_session(shell_request("true", Some(root.clone()))).expect("create command session");
    let output = read_session(TerminalReadRequest {
        session_id: snapshot.session_id.clone(),
        cursor: Some("0".to_string()),
        max_bytes: Some(16),
        wait_ms: Some(1000),
        storage_root: Some(root.clone()),
    })
    .expect("wait for exit");
    assert_eq!(output.output, "");
    assert_eq!(output.cursor, "0");
    assert_eq!(output.running, false);
    assert_eq!(output.exit_code, Some(0));
    assert_eq!(output.reason.as_deref(), Some("exit"));

    close_session(TerminalCloseRequest {
        session_id: snapshot.session_id,
        storage_root: Some(root.clone()),
        actor_json: None,
        correlation_json: None,
    })
    .expect("close session");
    fs::remove_dir_all(root).ok();
}

#[test]
fn wait_session_returns_timeout_when_running_without_output() {
    let root = temp_root("wait-timeout");
    let snapshot = create_session(shell_request("sleep 1", Some(root.clone())))
        .expect("create command session");
    let output = read_session(TerminalReadRequest {
        session_id: snapshot.session_id.clone(),
        cursor: Some("0".to_string()),
        max_bytes: Some(16),
        wait_ms: Some(50),
        storage_root: Some(root.clone()),
    })
    .expect("wait timeout");
    assert_eq!(output.output, "");
    assert_eq!(output.cursor, "0");
    assert!(output.running);
    assert_eq!(output.exit_code, None);
    assert_eq!(output.reason.as_deref(), Some("timeout"));

    close_session(TerminalCloseRequest {
        session_id: snapshot.session_id,
        storage_root: Some(root.clone()),
        actor_json: None,
        correlation_json: None,
    })
    .expect("close session");
    fs::remove_dir_all(root).ok();
}

#[test]
fn read_session_reads_stripped_text_and_preserves_raw_output_artifact() {
    let root = temp_root("ansi-read");
    let snapshot = create_session(shell_request(
        "printf '\\033[31mred\\033[0m'",
        Some(root.clone()),
    ))
    .expect("create command session");
    let output = read_session(TerminalReadRequest {
        session_id: snapshot.session_id.clone(),
        cursor: Some("0".to_string()),
        max_bytes: Some(16),
        wait_ms: Some(1000),
        storage_root: Some(root.clone()),
    })
    .expect("read ansi output");
    assert_eq!(output.output, "red");
    let memory_json = output.memory.as_ref().expect("memory metadata");
    let memory: Value = serde_json::from_str(memory_json).expect("parse memory");
    let raw = fs::read_to_string(memory["rawOutputPath"].as_str().expect("raw path"))
        .expect("read raw output");
    assert!(raw.contains("\x1b[31mred\x1b[0m"));

    close_session(TerminalCloseRequest {
        session_id: snapshot.session_id,
        storage_root: Some(root.clone()),
        actor_json: None,
        correlation_json: None,
    })
    .expect("close session");
    fs::remove_dir_all(root).ok();
}

#[test]
fn screen_read_returns_visible_screen_and_records_diff_events() {
    let root = temp_root("screen-read");
    let snapshot = create_session(shell_request(
        "printf '\\033[2J\\033[Hafter'",
        Some(root.clone()),
    ))
    .expect("create command session");
    let output = read_session(TerminalReadRequest {
        session_id: snapshot.session_id.clone(),
        cursor: Some("0".to_string()),
        max_bytes: Some(64),
        wait_ms: Some(1000),
        storage_root: Some(root.clone()),
    })
    .expect("wait for output");
    assert_eq!(output.reason.as_deref(), Some("output"));

    let screen = read_screen(TerminalScreenReadRequest {
        session_id: snapshot.session_id.clone(),
        storage_root: Some(root.clone()),
        cursor: None,
        include_scrollback: Some(false),
        max_rows: Some(24),
        max_bytes: Some(1024),
        selected_text: None,
    })
    .expect("read screen");
    assert!(screen.visible_text.starts_with("after"));
    assert_eq!(screen.mode, "normal");
    assert!(screen.screen_version > 0);
    assert_eq!(screen.cursor, screen.screen_version.to_string());
    assert!(screen
        .visible_rows
        .iter()
        .any(|row| row.text.starts_with("after")));
    assert_eq!(screen.input_modes.mouse_reporting, "none");
    assert!(screen.memory.is_some());

    let memory: Value =
        serde_json::from_str(screen.memory.as_ref().expect("memory")).expect("parse memory");
    let events = fs::read_to_string(memory["eventLogPath"].as_str().expect("event path"))
        .expect("read events");
    assert!(events.contains("\"kind\":\"screen_diff\""));
    assert!(events.contains("\"previousScreenVersion\""));
    assert!(events.contains("\"dirtyRowRanges\""));
    assert!(events.contains("\"inputModes\""));

    close_session(TerminalCloseRequest {
        session_id: snapshot.session_id,
        storage_root: Some(root.clone()),
        actor_json: None,
        correlation_json: None,
    })
    .expect("close session");
    fs::remove_dir_all(root).ok();
}

#[test]
fn screen_read_enriches_selection_active_command_prompt_and_regions() {
    let root = temp_root("screen-context");
    let session_id = format!("session-{}", uuid::Uuid::new_v4());
    memory::record_session_created(memory::SessionCreatedInput {
        storage_root: root.clone(),
        session_id: session_id.clone(),
        title: "Terminal".to_string(),
        cwd: None,
        shell: "/bin/zsh".to_string(),
        cols: 80,
        rows: 24,
        source: "user".to_string(),
        mode: "shell".to_string(),
        command: None,
        persist: false,
        actor_json: None,
        correlation_json: None,
    })
    .expect("record session");
    memory::record_write(memory::WriteInput {
        storage_root: root.clone(),
        session_id: session_id.clone(),
        data: None,
        text: Some("npm test".to_string()),
        keys: None,
        append_newline: true,
        source: Some("agent".to_string()),
        actor_json: None,
        correlation_json: Some(serde_json::json!({ "commandId": "command-1" }).to_string()),
    })
    .expect("record command");
    memory::record_output(
        &memory::MemoryContext {
            storage_root: root.clone(),
            session_id: session_id.clone(),
        },
        b"\x1b]633;LyraPrompt\x07lyra % ",
    )
    .expect("record output");

    let screen = read_screen(TerminalScreenReadRequest {
        session_id: session_id.clone(),
        storage_root: Some(root.clone()),
        cursor: None,
        include_scrollback: Some(false),
        max_rows: Some(24),
        max_bytes: Some(4096),
        selected_text: Some(" lyra % ".to_string()),
    })
    .expect("read screen");

    assert_eq!(screen.selected_text.as_deref(), Some("lyra %"));
    assert_eq!(screen.active_command.as_deref(), Some("npm test"));
    assert_eq!(screen.prompt.as_deref(), Some("lyra %"));
    assert!(screen
        .regions
        .iter()
        .any(|region| region.kind == "prompt" && region.text == "lyra %"));

    fs::remove_dir_all(root).ok();
}
