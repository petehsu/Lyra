use super::{
    list_artifacts, mark_output_policy, metadata_for_session, read_commands, read_events,
    read_output_projection, read_output_range, read_stored_sessions, read_timeline, record_close,
    record_exit, record_handoff_completed, record_handoff_started, record_output,
    record_permission_granted, record_permission_requested, record_process_started, record_resize,
    record_session_created, record_shell_integration_event, record_write, replay_screen_snapshot,
    ArtifactsListInput, CloseInput, CommandsReadInput, EventsReadInput, HandoffEventInput,
    MemoryContext, OutputPolicyMarkerInput, OutputRangeReadInput, PermissionEventInput,
    ProcessStartedInput, ResizeInput, SessionCreatedInput, TimelineReadInput, WriteInput,
};
use crate::shell_integration::{ShellIntegrationEvent, ShellIntegrationEventKind};
use serde_json::{json, Value};
use std::fs;
use std::io::Write as _;

fn temp_root(name: &str) -> String {
    let root = std::env::temp_dir().join(format!(
        "lyra-terminal-memory-rust-{name}-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&root).expect("create temp root");
    root.to_string_lossy().to_string()
}

fn create_input(root: &str, session_id: &str) -> SessionCreatedInput {
    SessionCreatedInput {
        storage_root: root.to_string(),
        session_id: session_id.to_string(),
        title: "Terminal".to_string(),
        cwd: Some("/workspace".to_string()),
        shell: "/bin/zsh".to_string(),
        cols: 80,
        rows: 24,
        source: "user".to_string(),
        mode: "shell".to_string(),
        command: None,
        persist: true,
        actor_json: None,
        correlation_json: None,
    }
}

fn jsonl(path: &str) -> Vec<Value> {
    fs::read_to_string(path)
        .expect("read jsonl")
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).expect("parse json"))
        .collect()
}

#[test]
fn terminal_memory_records_output_indexes_and_timeline() {
    let root = temp_root("output");
    let session_id = format!("session-{}", uuid::Uuid::new_v4());
    record_session_created(create_input(&root, &session_id)).expect("record create");
    let context = MemoryContext {
        storage_root: root.clone(),
        session_id: session_id.clone(),
    };
    record_output(&context, b"hello\r\n").expect("record output");
    record_output(&context, "\x1b[31mred\x1b[0m\nError: boom".as_bytes()).expect("record output");
    record_exit(&context, 1).expect("record exit");

    let memory: Value =
        serde_json::from_str(&metadata_for_session(&root, &session_id, false).expect("metadata"))
            .expect("parse metadata");
    assert_eq!(
        fs::read_to_string(memory["rawOutputPath"].as_str().expect("raw path"))
            .expect("raw output"),
        "hello\r\n\x1b[31mred\x1b[0m\nError: boom"
    );
    assert_eq!(
        fs::read_to_string(memory["outputTextPath"].as_str().expect("text path"))
            .expect("text output"),
        "hello\nred\nError: boom"
    );
    assert_eq!(memory["lineCount"], 3);
    assert_eq!(memory["errorCount"], 1);
    assert_eq!(memory["latestOutputPreview"], "Error: boom");

    let events = jsonl(memory["eventLogPath"].as_str().expect("event path"));
    let kinds = events
        .iter()
        .map(|event| event["kind"].as_str().unwrap_or_default())
        .collect::<Vec<_>>();
    assert_eq!(
        kinds,
        vec![
            "session_created",
            "output_chunk",
            "output_chunk",
            "process_exited"
        ]
    );
    assert_eq!(events[1]["payload"]["rawOffset"], 0);
    assert_eq!(events[2]["payload"]["textPreview"], "red Error: boom");

    let lines = jsonl(memory["lineIndexPath"].as_str().expect("line path"));
    assert_eq!(lines[2]["outputEventSeq"], 4);
    let errors = jsonl(memory["errorIndexPath"].as_str().expect("error path"));
    assert_eq!(errors.len(), 1);

    let timeline: Value = serde_json::from_str(
        &read_timeline(TimelineReadInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            cursor: None,
            limit: Some(10),
            kinds: None,
            actors: None,
            command_id: None,
            tool_call_id: None,
            agent_session_id: None,
            seq_start: None,
            seq_end: None,
            time_start_ms: None,
            time_end_ms: None,
            audit: None,
            actor_json: None,
            correlation_json: None,
        })
        .expect("timeline"),
    )
    .expect("parse timeline");
    assert_eq!(timeline["items"].as_array().expect("items").len(), 4);
    fs::remove_dir_all(root).ok();
}

#[test]
fn terminal_memory_records_agent_command_correlation() {
    let root = temp_root("agent");
    let session_id = format!("session-{}", uuid::Uuid::new_v4());
    record_session_created(create_input(&root, &session_id)).expect("record create");
    record_write(WriteInput {
        storage_root: root.clone(),
        session_id: session_id.clone(),
        data: None,
        text: Some("npm test".to_string()),
        keys: None,
        append_newline: true,
        source: Some("agent".to_string()),
        actor_json: Some(
            json!({
                "kind": "agent",
                "agentSessionId": "agent-1",
                "runtimeTurnId": "turn-1",
                "toolCallId": "tool-1"
            })
            .to_string(),
        ),
        correlation_json: Some(
            json!({
                "agentSessionId": "agent-1",
                "runtimeTurnId": "turn-1",
                "toolCallId": "tool-1",
                "terminalToolName": "terminal.write",
                "commandId": "command-1"
            })
            .to_string(),
        ),
    })
    .expect("record write");
    record_close(CloseInput {
        storage_root: root.clone(),
        session_id: session_id.clone(),
        actor_json: Some(json!({ "kind": "agent", "agentSessionId": "agent-1" }).to_string()),
        correlation_json: Some(
            json!({ "agentSessionId": "agent-1", "terminalToolName": "terminal.close" })
                .to_string(),
        ),
    })
    .expect("record close");

    let memory: Value =
        serde_json::from_str(&metadata_for_session(&root, &session_id, false).expect("metadata"))
            .expect("parse metadata");
    let events = jsonl(memory["eventLogPath"].as_str().expect("event path"));
    assert_eq!(events[1]["kind"], "input_text");
    assert_eq!(events[1]["actor"]["kind"], "agent");
    assert_eq!(events[1]["correlation"]["commandId"], "command-1");
    assert_eq!(events[2]["kind"], "command_submitted");
    assert_eq!(events[3]["kind"], "command_started");
    assert!(events.iter().any(|event| event["kind"] == "session_closed"));
    assert!(events.iter().any(|event| event["kind"] == "agent_detached"));
    let commands = jsonl(memory["commandsPath"].as_str().expect("commands path"));
    assert_eq!(commands[0]["commandText"], "npm test");
    assert_eq!(commands[0]["status"], "running");
    let attachments = jsonl(
        memory["attachmentsPath"]
            .as_str()
            .expect("attachments path"),
    );
    assert_eq!(attachments.len(), 1);
    assert_eq!(attachments[0]["status"], "detached");
    fs::remove_dir_all(root).ok();
}

#[test]
fn terminal_events_read_paginates_and_filters() {
    let root = temp_root("events-read");
    let session_id = format!("session-{}", uuid::Uuid::new_v4());
    record_session_created(create_input(&root, &session_id)).expect("record create");
    record_write(WriteInput {
        storage_root: root.clone(),
        session_id: session_id.clone(),
        data: None,
        text: Some("cargo test".to_string()),
        keys: None,
        append_newline: true,
        source: Some("agent".to_string()),
        actor_json: Some(json!({ "kind": "agent", "agentSessionId": "agent-1" }).to_string()),
        correlation_json: Some(
            json!({ "agentSessionId": "agent-1", "terminalToolName": "terminal.write" })
                .to_string(),
        ),
    })
    .expect("record write");
    let context = MemoryContext {
        storage_root: root.clone(),
        session_id: session_id.clone(),
    };
    record_output(&context, b"ok\n").expect("record output");
    record_resize(ResizeInput {
        storage_root: root.clone(),
        session_id: session_id.clone(),
        cols: 100,
        rows: 30,
        actor_json: None,
        correlation_json: None,
    })
    .expect("record resize");
    record_exit(&context, 0).expect("record exit");

    let first_page: Value = serde_json::from_str(
        &read_events(EventsReadInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            cursor: None,
            limit: Some(2),
            kinds: None,
            actors: None,
            audit: None,
            actor_json: None,
            correlation_json: None,
        })
        .expect("events"),
    )
    .expect("parse events");
    let first_items = first_page["items"].as_array().expect("items");
    assert_eq!(first_page["cursor"], "0");
    assert_eq!(first_page["nextCursor"], "2");
    assert_eq!(first_page["hasMore"], true);
    assert_eq!(first_items.len(), 2);
    assert_eq!(first_items[0]["kind"], "session_created");
    assert_eq!(first_items[1]["kind"], "input_text");

    let second_page: Value = serde_json::from_str(
        &read_events(EventsReadInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            cursor: Some("2".to_string()),
            limit: Some(10),
            kinds: None,
            actors: None,
            audit: None,
            actor_json: None,
            correlation_json: None,
        })
        .expect("events"),
    )
    .expect("parse events");
    let second_items = second_page["items"].as_array().expect("items");
    assert_eq!(second_page["nextCursor"], "8");
    assert_eq!(second_page["hasMore"], false);
    assert_eq!(
        second_items
            .iter()
            .map(|item| item["kind"].as_str().unwrap_or_default())
            .collect::<Vec<_>>(),
        vec![
            "command_submitted",
            "command_started",
            "output_chunk",
            "input_resize",
            "process_exited",
            "command_completed"
        ]
    );

    let output_events: Value = serde_json::from_str(
        &read_events(EventsReadInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            cursor: Some("not-a-cursor".to_string()),
            limit: Some(10),
            kinds: Some(vec!["output_chunk".to_string()]),
            actors: Some(vec!["process".to_string()]),
            audit: None,
            actor_json: None,
            correlation_json: None,
        })
        .expect("events"),
    )
    .expect("parse events");
    let output_items = output_events["items"].as_array().expect("items");
    assert_eq!(output_events["cursor"], "0");
    assert_eq!(output_items.len(), 1);
    assert_eq!(output_items[0]["kind"], "output_chunk");
    assert_eq!(output_items[0]["actor"]["kind"], "process");

    let agent_events: Value = serde_json::from_str(
        &read_events(EventsReadInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            cursor: None,
            limit: Some(10),
            kinds: None,
            actors: Some(vec!["agent".to_string()]),
            audit: None,
            actor_json: None,
            correlation_json: None,
        })
        .expect("events"),
    )
    .expect("parse events");
    let agent_items = agent_events["items"].as_array().expect("items");
    assert_eq!(agent_items.len(), 3);
    assert_eq!(agent_items[0]["kind"], "input_text");
    assert_eq!(agent_items[1]["kind"], "command_submitted");
    assert_eq!(agent_items[2]["kind"], "command_started");
    assert_eq!(
        agent_items[0]["correlation"]["terminalToolName"],
        "terminal.write"
    );
    fs::remove_dir_all(root).ok();
}

#[test]
fn terminal_commands_read_paginates_and_filters_status() {
    let root = temp_root("commands-read");
    let session_id = format!("session-{}", uuid::Uuid::new_v4());
    record_session_created(create_input(&root, &session_id)).expect("record create");
    record_write(WriteInput {
        storage_root: root.clone(),
        session_id: session_id.clone(),
        data: None,
        text: Some("cargo test".to_string()),
        keys: None,
        append_newline: true,
        source: Some("agent".to_string()),
        actor_json: Some(json!({ "kind": "agent", "agentSessionId": "agent-1" }).to_string()),
        correlation_json: Some(
            json!({
                "agentSessionId": "agent-1",
                "terminalToolName": "terminal.write",
                "commandId": "command-1"
            })
            .to_string(),
        ),
    })
    .expect("record write");
    record_exit(
        &MemoryContext {
            storage_root: root.clone(),
            session_id: session_id.clone(),
        },
        0,
    )
    .expect("record exit");

    let first_page: Value = serde_json::from_str(
        &read_commands(CommandsReadInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            cursor: None,
            limit: Some(1),
            status: None,
            audit: None,
            actor_json: None,
            correlation_json: None,
        })
        .expect("commands"),
    )
    .expect("parse commands");
    let first_items = first_page["items"].as_array().expect("items");
    assert_eq!(first_page["cursor"], "0");
    assert_eq!(first_page["nextCursor"], "1");
    assert_eq!(first_page["hasMore"], true);
    assert_eq!(first_items.len(), 1);
    assert_eq!(first_items[0]["commandSeq"], 1);
    assert_eq!(first_items[0]["status"], "running");
    assert_eq!(first_items[0]["commandId"], "command-1");

    let second_page: Value = serde_json::from_str(
        &read_commands(CommandsReadInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            cursor: Some("1".to_string()),
            limit: Some(10),
            status: None,
            audit: None,
            actor_json: None,
            correlation_json: None,
        })
        .expect("commands"),
    )
    .expect("parse commands");
    let second_items = second_page["items"].as_array().expect("items");
    assert_eq!(second_page["nextCursor"], "2");
    assert_eq!(second_page["hasMore"], false);
    assert_eq!(second_items.len(), 1);
    assert_eq!(second_items[0]["status"], "completed");
    assert_eq!(second_items[0]["exitCode"], 0);

    let completed_only: Value = serde_json::from_str(
        &read_commands(CommandsReadInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            cursor: Some("not-a-cursor".to_string()),
            limit: Some(10),
            status: Some("completed".to_string()),
            audit: None,
            actor_json: None,
            correlation_json: None,
        })
        .expect("commands"),
    )
    .expect("parse commands");
    let completed_items = completed_only["items"].as_array().expect("items");
    assert_eq!(completed_only["cursor"], "0");
    assert_eq!(completed_items.len(), 1);
    assert_eq!(completed_items[0]["commandSeq"], 2);
    assert_eq!(completed_items[0]["commandId"], "command-1");

    let command_timeline: Value = serde_json::from_str(
        &read_timeline(TimelineReadInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            cursor: None,
            limit: Some(10),
            kinds: None,
            actors: None,
            command_id: Some("command-1".to_string()),
            tool_call_id: None,
            agent_session_id: Some("agent-1".to_string()),
            seq_start: Some(2),
            seq_end: None,
            time_start_ms: None,
            time_end_ms: None,
            audit: None,
            actor_json: None,
            correlation_json: None,
        })
        .expect("timeline"),
    )
    .expect("parse timeline");
    let timeline_items = command_timeline["items"].as_array().expect("items");
    assert_eq!(
        timeline_items
            .iter()
            .map(|item| item["kind"].as_str().unwrap_or_default())
            .collect::<Vec<_>>(),
        vec![
            "input_text",
            "command_submitted",
            "command_started",
            "process_exited",
            "command_completed"
        ]
    );
    fs::remove_dir_all(root).ok();
}

#[test]
fn shell_integration_command_end_completes_active_command() {
    let root = temp_root("shell-command-end");
    let session_id = format!("session-{}", uuid::Uuid::new_v4());
    record_session_created(create_input(&root, &session_id)).expect("record create");
    record_write(WriteInput {
        storage_root: root.clone(),
        session_id: session_id.clone(),
        data: None,
        text: Some("printf done".to_string()),
        keys: None,
        append_newline: true,
        source: Some("agent".to_string()),
        actor_json: Some(json!({ "kind": "agent", "agentSessionId": "agent-1" }).to_string()),
        correlation_json: Some(
            json!({
                "agentSessionId": "agent-1",
                "terminalToolName": "terminal.write",
                "commandId": "command-shell-1"
            })
            .to_string(),
        ),
    })
    .expect("record write");
    let context = MemoryContext {
        storage_root: root.clone(),
        session_id: session_id.clone(),
    };
    record_output(&context, b"done\n").expect("record output");
    record_shell_integration_event(
        &context,
        &ShellIntegrationEvent {
            kind: ShellIntegrationEventKind::CommandEnd,
            raw: "133;D;0".to_string(),
            command_id: None,
            command: None,
            cwd: None,
            exit_code: Some(0),
            signal: None,
            confidence: 1.0,
        },
    )
    .expect("record shell command end");

    let commands: Value = serde_json::from_str(
        &read_commands(CommandsReadInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            cursor: None,
            limit: Some(10),
            status: Some("completed".to_string()),
            audit: None,
            actor_json: None,
            correlation_json: None,
        })
        .expect("commands"),
    )
    .expect("parse commands");
    let items = commands["items"].as_array().expect("items");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["commandId"], "command-shell-1");
    assert_eq!(items[0]["exitCode"], 0);
    assert_eq!(items[0]["outputTextRange"]["end"], 5);
    fs::remove_dir_all(root).ok();
}

#[test]
fn command_completion_writes_command_artifact_files_without_breaking_session_output() {
    let root = temp_root("command-artifacts");
    let session_id = format!("session-{}", uuid::Uuid::new_v4());
    record_session_created(create_input(&root, &session_id)).expect("record create");
    record_write(WriteInput {
        storage_root: root.clone(),
        session_id: session_id.clone(),
        data: None,
        text: Some("printf one".to_string()),
        keys: None,
        append_newline: true,
        source: Some("agent".to_string()),
        actor_json: Some(json!({ "kind": "agent", "agentSessionId": "agent-1" }).to_string()),
        correlation_json: Some(
            json!({
                "agentSessionId": "agent-1",
                "runtimeTurnId": "turn-1",
                "toolCallId": "tool-1",
                "terminalToolName": "terminal.write",
                "commandId": "command-1"
            })
            .to_string(),
        ),
    })
    .expect("record write");
    let context = MemoryContext {
        storage_root: root.clone(),
        session_id: session_id.clone(),
    };
    record_output(&context, b"one\n").expect("record output");
    let completion = record_shell_integration_event(
        &context,
        &ShellIntegrationEvent {
            kind: ShellIntegrationEventKind::CommandEnd,
            raw: "133;D;0".to_string(),
            command_id: None,
            command: None,
            cwd: None,
            exit_code: Some(0),
            signal: None,
            confidence: 1.0,
        },
    )
    .expect("record shell command end")
    .expect("completion projection");

    assert_eq!(completion.command_id, "command-1");
    assert_eq!(completion.status, "completed");
    assert_eq!(completion.exit_code, Some(0));
    assert_eq!(completion.correlation["agentSessionId"], "agent-1");
    assert_eq!(
        fs::read_to_string(&completion.command_output_text_path).expect("command text"),
        "one\n"
    );
    assert_eq!(
        fs::read(&completion.command_raw_output_path).expect("command raw"),
        b"one\n"
    );
    let command_events = jsonl(&completion.command_events_path);
    assert!(command_events
        .iter()
        .any(|event| event["kind"] == "output_chunk"));
    assert!(command_events
        .iter()
        .any(|event| event["kind"] == "command_completed"));

    let meta: Value = serde_json::from_str(
        &fs::read_to_string(&completion.command_meta_path).expect("read command meta"),
    )
    .expect("parse command meta");
    assert_eq!(meta["commandId"], "command-1");
    assert_eq!(
        meta["commandOutputTextPath"],
        completion.command_output_text_path
    );

    let summary: Value = serde_json::from_str(
        &fs::read_to_string(&completion.command_summary_path).expect("read command summary"),
    )
    .expect("parse command summary");
    assert_eq!(summary["firstOutputPreview"], "one");
    assert_eq!(summary["eventCount"], command_events.len() as u64);

    let memory: Value =
        serde_json::from_str(&metadata_for_session(&root, &session_id, false).expect("metadata"))
            .expect("parse metadata");
    assert!(memory["commandArtifactsRootPath"]
        .as_str()
        .expect("command artifact root")
        .ends_with("/commands"));
    assert_eq!(
        fs::read_to_string(memory["outputTextPath"].as_str().expect("session output"))
            .expect("session output"),
        "one\n"
    );
    let commands = jsonl(memory["commandsPath"].as_str().expect("commands path"));
    let completed = commands
        .iter()
        .find(|command| command["status"] == "completed")
        .expect("completed command");
    assert_eq!(
        completed["commandOutputTextPath"],
        completion.command_output_text_path
    );
    fs::remove_dir_all(root).ok();
}

#[test]
fn empty_shell_command_start_does_not_create_command_or_artifact() {
    let root = temp_root("empty-command");
    let session_id = format!("session-{}", uuid::Uuid::new_v4());
    record_session_created(create_input(&root, &session_id)).expect("record create");
    let context = MemoryContext {
        storage_root: root.clone(),
        session_id: session_id.clone(),
    };
    let completion = record_shell_integration_event(
        &context,
        &ShellIntegrationEvent {
            kind: ShellIntegrationEventKind::CommandStart,
            raw: "133;C;command=".to_string(),
            command_id: None,
            command: Some("   ".to_string()),
            cwd: None,
            exit_code: None,
            signal: None,
            confidence: 1.0,
        },
    )
    .expect("record empty command");
    assert!(completion.is_none());

    let memory: Value =
        serde_json::from_str(&metadata_for_session(&root, &session_id, false).expect("metadata"))
            .expect("parse metadata");
    let commands = jsonl(memory["commandsPath"].as_str().expect("commands path"));
    assert!(commands.is_empty());
    let command_root = memory["commandArtifactsRootPath"]
        .as_str()
        .expect("command artifacts root");
    let child_count = fs::read_dir(command_root)
        .expect("read command root")
        .count();
    assert_eq!(child_count, 0);
    let events = jsonl(memory["eventLogPath"].as_str().expect("events path"));
    assert!(events.iter().any(|event| {
        event["kind"] == "shell_integration" && event["payload"]["ignoredReason"] == "empty_command"
    }));
    fs::remove_dir_all(root).ok();
}

#[test]
fn terminal_output_read_range_reads_text_and_raw_artifacts() {
    let root = temp_root("output-range");
    let session_id = format!("session-{}", uuid::Uuid::new_v4());
    record_session_created(create_input(&root, &session_id)).expect("record create");
    let context = MemoryContext {
        storage_root: root.clone(),
        session_id: session_id.clone(),
    };
    record_output(&context, b"hello\n").expect("record output");
    record_output(&context, "\x1b[31mred\x1b[0m\n".as_bytes()).expect("record output");

    let text_range: Value = serde_json::from_str(
        &read_output_range(OutputRangeReadInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            start: 6,
            end: 9,
            raw: false,
            audit: None,
            actor_json: None,
            correlation_json: None,
        })
        .expect("text range"),
    )
    .expect("parse text range");
    assert_eq!(text_range["raw"], false);
    assert_eq!(text_range["encoding"], "utf8");
    assert_eq!(text_range["output"], "red");
    assert_eq!(text_range["range"]["start"], 6);
    assert_eq!(text_range["range"]["end"], 9);
    assert_eq!(text_range["nextStart"], 9);
    assert_eq!(text_range["totalBytes"], 10);
    assert_eq!(text_range["truncated"], false);
    assert_eq!(
        text_range["memory"]["outputTextPath"]
            .as_str()
            .expect("output path")
            .ends_with("session-output.txt"),
        true
    );

    let raw_range: Value = serde_json::from_str(
        &read_output_range(OutputRangeReadInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            start: 6,
            end: 14,
            raw: true,
            audit: None,
            actor_json: None,
            correlation_json: None,
        })
        .expect("raw range"),
    )
    .expect("parse raw range");
    assert_eq!(raw_range["raw"], true);
    assert_eq!(raw_range["encoding"], "utf8-lossy");
    assert_eq!(raw_range["output"], "\x1b[31mred");
    assert_eq!(raw_range["range"]["start"], 6);
    assert_eq!(raw_range["range"]["end"], 14);
    assert_eq!(raw_range["byteLength"], 8);

    let empty_range: Value = serde_json::from_str(
        &read_output_range(OutputRangeReadInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            start: 100,
            end: 50,
            raw: false,
            audit: None,
            actor_json: None,
            correlation_json: None,
        })
        .expect("empty range"),
    )
    .expect("parse empty range");
    assert_eq!(empty_range["output"], "");
    assert_eq!(empty_range["range"]["start"], 10);
    assert_eq!(empty_range["range"]["end"], 10);
    fs::remove_dir_all(root).ok();
}

#[test]
fn terminal_artifacts_processes_and_command_ranges_are_kernel_managed() {
    let root = temp_root("artifacts-process");
    let session_id = format!("session-{}", uuid::Uuid::new_v4());
    record_session_created(create_input(&root, &session_id)).expect("record create");
    record_process_started(ProcessStartedInput {
        storage_root: root.clone(),
        session_id: session_id.clone(),
        process_id: Some(4242),
        shell: "/bin/zsh".to_string(),
        cwd: Some("/workspace".to_string()),
        command: None,
        mode: "shell".to_string(),
        source: "user".to_string(),
        cols: 80,
        rows: 24,
        actor_json: None,
        correlation_json: None,
    })
    .expect("record process");
    record_write(WriteInput {
        storage_root: root.clone(),
        session_id: session_id.clone(),
        data: None,
        text: Some("echo hi".to_string()),
        keys: None,
        append_newline: true,
        source: Some("agent".to_string()),
        actor_json: Some(json!({ "kind": "agent", "agentSessionId": "agent-1" }).to_string()),
        correlation_json: Some(
            json!({
                "agentSessionId": "agent-1",
                "terminalToolName": "terminal.write",
                "commandId": "command-1"
            })
            .to_string(),
        ),
    })
    .expect("record write");
    let context = MemoryContext {
        storage_root: root.clone(),
        session_id: session_id.clone(),
    };
    record_output(&context, b"hi\n").expect("record output");
    record_exit(&context, 0).expect("record exit");

    let artifacts: Value = serde_json::from_str(
        &list_artifacts(ArtifactsListInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            audit: None,
            actor_json: None,
            correlation_json: None,
        })
        .expect("artifacts"),
    )
    .expect("parse artifacts");
    let artifact_labels = artifacts["items"]
        .as_array()
        .expect("items")
        .iter()
        .map(|item| item["label"].as_str().unwrap_or_default())
        .collect::<Vec<_>>();
    assert!(artifact_labels.contains(&"session-output.summary.json"));
    assert!(artifact_labels.contains(&"processes.jsonl"));
    assert!(artifact_labels.contains(&"screen-diffs.jsonl"));
    assert!(artifact_labels.contains(&"retention.json"));

    let memory = &artifacts["memory"];
    let output_summary: Value = serde_json::from_str(
        &fs::read_to_string(memory["outputSummaryPath"].as_str().expect("summary path"))
            .expect("read output summary"),
    )
    .expect("parse output summary");
    assert_eq!(output_summary["projectionRecommendation"], "inline");
    assert_eq!(output_summary["commands"][0]["commandId"], "command-1");
    assert_eq!(output_summary["commands"][0]["outputTextRange"]["start"], 0);
    assert_eq!(output_summary["commands"][0]["outputTextRange"]["end"], 3);
    assert_eq!(output_summary["commands"][0]["firstOutputPreview"], "hi");
    assert_eq!(output_summary["commands"][0]["lastOutputPreview"], "hi");
    assert_eq!(output_summary["commands"][0]["lastErrorLines"], json!([]));
    assert_eq!(output_summary["commands"][0]["estimatedTokens"], 1);
    let lines = jsonl(memory["lineIndexPath"].as_str().expect("line path"));
    assert_eq!(lines[0]["commandId"], "command-1");

    let processes = jsonl(memory["processesPath"].as_str().expect("processes path"));
    assert_eq!(processes[0]["status"], "running");
    assert_eq!(processes[1]["status"], "exited");

    let events = jsonl(memory["eventLogPath"].as_str().expect("events path"));
    let kinds = events
        .iter()
        .map(|event| event["kind"].as_str().unwrap_or_default())
        .collect::<Vec<_>>();
    assert!(kinds.contains(&"process_started"));
    assert!(kinds.contains(&"process_tree_snapshot"));
    assert!(kinds.contains(&"command_completed"));
    fs::remove_dir_all(root).ok();
}

#[test]
fn terminal_memory_skips_corrupt_jsonl_lines_and_records_repair_warning() {
    let root = temp_root("corrupt-events");
    let session_id = format!("session-{}", uuid::Uuid::new_v4());
    record_session_created(create_input(&root, &session_id)).expect("record create");
    let memory: Value =
        serde_json::from_str(&metadata_for_session(&root, &session_id, false).expect("metadata"))
            .expect("parse metadata");
    let event_path = memory["eventLogPath"].as_str().expect("event path");
    let mut events_file = fs::OpenOptions::new()
        .append(true)
        .open(event_path)
        .expect("open events");
    writeln!(events_file, "{{ this is not json").expect("write corrupt line");

    let events: Value = serde_json::from_str(
        &read_events(EventsReadInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            cursor: None,
            limit: Some(10),
            kinds: None,
            actors: None,
            audit: None,
            actor_json: None,
            correlation_json: None,
        })
        .expect("events"),
    )
    .expect("parse events");
    assert_eq!(events["items"].as_array().expect("items").len(), 1);
    let repairs = jsonl(memory["repairLogPath"].as_str().expect("repair path"));
    assert_eq!(repairs[0]["warning"], "corrupt_jsonl_line_skipped");
    fs::remove_dir_all(root).ok();
}

#[test]
fn output_projection_reads_large_artifact_by_range_and_clamps_utf8_cursor() {
    let root = temp_root("large-projection");
    let session_id = format!("session-{}", uuid::Uuid::new_v4());
    record_session_created(create_input(&root, &session_id)).expect("record create");
    let memory: Value =
        serde_json::from_str(&metadata_for_session(&root, &session_id, false).expect("metadata"))
            .expect("parse metadata");
    let output_path = memory["outputTextPath"].as_str().expect("output path");
    let mut large = "éclair\n".repeat(1024);
    large.push_str(&"x".repeat(2 * 1024 * 1024));
    fs::write(output_path, large).expect("write large output");

    let first = read_output_projection(&root, &session_id, 0, 8).expect("read first projection");
    assert_eq!(first.output, "éclair\n");
    assert_eq!(first.cursor, 8);
    assert!(first.truncated);

    let clamped =
        read_output_projection(&root, &session_id, 1, 8).expect("read clamped projection");
    assert_eq!(clamped.output, "éclair\n");
    assert_eq!(clamped.cursor, 8);
    fs::remove_dir_all(root).ok();
}

#[test]
fn output_projection_reads_100mb_fixture_without_loading_full_file() {
    let root = temp_root("large-100mb");
    let session_id = format!("session-{}", uuid::Uuid::new_v4());
    let paths = super::paths_for_session(&root, &session_id);
    fs::create_dir_all(paths.output_text_path.parent().expect("output parent"))
        .expect("create output dir");
    let file = fs::File::create(&paths.output_text_path).expect("create sparse output");
    file.set_len(100 * 1024 * 1024).expect("set sparse length");

    let projection = read_output_projection(&root, &session_id, 0, 16).expect("read projection");
    assert_eq!(projection.output.len(), 16);
    assert_eq!(projection.cursor, 16);
    assert!(projection.truncated);
    fs::remove_dir_all(root).ok();
}

#[test]
fn terminal_memory_rebuilds_output_indexes_from_text_artifact() {
    let root = temp_root("rebuild-output-indexes");
    let session_id = format!("session-{}", uuid::Uuid::new_v4());
    let paths = super::paths_for_session(&root, &session_id);
    fs::create_dir_all(paths.output_text_path.parent().expect("output parent"))
        .expect("create output dir");
    fs::write(&paths.output_text_path, "first\nError: recovered\nlast").expect("write output");

    let memory: Value =
        serde_json::from_str(&metadata_for_session(&root, &session_id, false).expect("metadata"))
            .expect("parse metadata");
    assert_eq!(memory["lineCount"], 3);
    assert_eq!(memory["errorCount"], 1);
    assert_eq!(memory["latestOutputPreview"], "last");
    let lines = jsonl(memory["lineIndexPath"].as_str().expect("line path"));
    assert_eq!(lines[0]["recovered"], true);
    assert_eq!(lines[1]["textPreview"], "Error: recovered");
    let errors = jsonl(memory["errorIndexPath"].as_str().expect("error path"));
    assert_eq!(errors.len(), 1);
    fs::remove_dir_all(root).ok();
}

#[test]
fn permission_events_link_to_commands_and_audit_projection_answers_approval() {
    let root = temp_root("permission-audit");
    let session_id = format!("session-{}", uuid::Uuid::new_v4());
    record_session_created(create_input(&root, &session_id)).expect("record create");
    let permission = PermissionEventInput {
        storage_root: root.clone(),
        session_id: session_id.clone(),
        permission_id: "permission-1".to_string(),
        action: Some("terminal.write".to_string()),
        risk: Some("shell".to_string()),
        summary: Some("Run npm test".to_string()),
        title: Some("Run shell command".to_string()),
        detail: Some("terminal.write text=npm test".to_string()),
        command_id: Some("command-1".to_string()),
        input_id: Some("input-1".to_string()),
        agent_session_id: Some("agent-1".to_string()),
        runtime_turn_id: Some("turn-1".to_string()),
        tool_call_id: Some("tool-1".to_string()),
        decision: None,
        reason: None,
        expires_at: None,
        actor_json: Some(json!({ "kind": "agent", "agentSessionId": "agent-1" }).to_string()),
        correlation_json: Some(
            json!({
                "agentSessionId": "agent-1",
                "runtimeTurnId": "turn-1",
                "toolCallId": "tool-1",
                "commandId": "command-1",
                "inputId": "input-1"
            })
            .to_string(),
        ),
    };
    record_permission_requested(permission.clone()).expect("permission requested");
    record_permission_granted(PermissionEventInput {
        decision: Some("allowed".to_string()),
        actor_json: Some(json!({ "kind": "human_user", "displayName": "Pete" }).to_string()),
        ..permission
    })
    .expect("permission granted");
    record_write(WriteInput {
        storage_root: root.clone(),
        session_id: session_id.clone(),
        data: None,
        text: Some("npm test".to_string()),
        keys: None,
        append_newline: true,
        source: Some("agent".to_string()),
        actor_json: Some(json!({ "kind": "agent", "agentSessionId": "agent-1" }).to_string()),
        correlation_json: Some(
            json!({
                "agentSessionId": "agent-1",
                "runtimeTurnId": "turn-1",
                "toolCallId": "tool-1",
                "terminalToolName": "terminal.write",
                "commandId": "command-1",
                "inputId": "input-1",
                "permissionId": "permission-1"
            })
            .to_string(),
        ),
    })
    .expect("record write");

    let memory: Value =
        serde_json::from_str(&metadata_for_session(&root, &session_id, false).expect("metadata"))
            .expect("parse metadata");
    let permissions = jsonl(
        memory["permissionsPath"]
            .as_str()
            .expect("permissions path"),
    );
    assert_eq!(permissions.len(), 2);
    assert_eq!(permissions[0]["status"], "pending");
    assert_eq!(permissions[1]["status"], "granted");
    assert_eq!(permissions[1]["commandId"], "command-1");

    let timeline: Value = serde_json::from_str(
        &read_timeline(TimelineReadInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            cursor: None,
            limit: Some(20),
            kinds: None,
            actors: None,
            command_id: Some("command-1".to_string()),
            tool_call_id: Some("tool-1".to_string()),
            agent_session_id: Some("agent-1".to_string()),
            seq_start: None,
            seq_end: None,
            time_start_ms: None,
            time_end_ms: None,
            audit: None,
            actor_json: None,
            correlation_json: None,
        })
        .expect("timeline"),
    )
    .expect("parse timeline");
    let input_item = timeline["items"]
        .as_array()
        .expect("items")
        .iter()
        .find(|item| item["kind"] == "input_text")
        .expect("input item");
    assert_eq!(
        input_item["audit"]["permissionChain"]
            .as_array()
            .expect("permission chain")
            .len(),
        2
    );
    assert_eq!(input_item["audit"]["latestPermission"]["status"], "granted");
    assert!(input_item["audit"]["answer"]
        .as_str()
        .expect("answer")
        .contains("approval: granted"));
    fs::remove_dir_all(root).ok();
}

#[test]
fn audit_read_handoff_policy_indexes_and_screen_replay_are_recoverable() {
    let root = temp_root("recovery-audit-policy");
    let session_id = format!("session-{}", uuid::Uuid::new_v4());
    record_session_created(SessionCreatedInput {
        cols: 12,
        rows: 3,
        ..create_input(&root, &session_id)
    })
    .expect("record create");
    let context = MemoryContext {
        storage_root: root.clone(),
        session_id: session_id.clone(),
    };
    record_output(&context, b"hello\n").expect("record output");
    record_resize(ResizeInput {
        storage_root: root.clone(),
        session_id: session_id.clone(),
        cols: 20,
        rows: 4,
        actor_json: None,
        correlation_json: None,
    })
    .expect("record resize");
    record_output(&context, b"after").expect("record output");
    record_handoff_started(HandoffEventInput {
        storage_root: root.clone(),
        session_id: session_id.clone(),
        handoff_id: Some("handoff-1".to_string()),
        from_actor_json: Some(json!({ "kind": "agent", "agentSessionId": "agent-1" }).to_string()),
        to_actor_json: Some(json!({ "kind": "human_user" }).to_string()),
        reason: Some("user_takeover".to_string()),
        summary: Some("Agent handed terminal control to user".to_string()),
        status: Some("started".to_string()),
        actor_json: None,
        correlation_json: Some(json!({ "agentSessionId": "agent-1" }).to_string()),
    })
    .expect("handoff started");
    record_handoff_completed(HandoffEventInput {
        storage_root: root.clone(),
        session_id: session_id.clone(),
        handoff_id: Some("handoff-1".to_string()),
        from_actor_json: Some(json!({ "kind": "agent", "agentSessionId": "agent-1" }).to_string()),
        to_actor_json: Some(json!({ "kind": "human_user" }).to_string()),
        reason: Some("user_takeover".to_string()),
        summary: Some("User accepted terminal control".to_string()),
        status: Some("completed".to_string()),
        actor_json: None,
        correlation_json: Some(json!({ "agentSessionId": "agent-1" }).to_string()),
    })
    .expect("handoff completed");
    mark_output_policy(OutputPolicyMarkerInput {
        storage_root: root.clone(),
        session_id: session_id.clone(),
        start: 0,
        end: 5,
        policy: "encrypted".to_string(),
        reason: Some("secret".to_string()),
        encrypted_ref: Some("vault://terminal/secret".to_string()),
        actor_json: None,
        correlation_json: None,
    })
    .expect("mark output policy");

    let _ = read_output_range(OutputRangeReadInput {
        storage_root: root.clone(),
        session_id: session_id.clone(),
        start: 0,
        end: 5,
        raw: false,
        audit: Some(true),
        actor_json: Some(json!({ "kind": "human_user", "displayName": "Auditor" }).to_string()),
        correlation_json: Some(json!({ "investigationId": "audit-1" }).to_string()),
    })
    .expect("audit read");

    let memory: Value =
        serde_json::from_str(&metadata_for_session(&root, &session_id, false).expect("metadata"))
            .expect("parse metadata");
    let events = jsonl(memory["eventLogPath"].as_str().expect("events path"));
    let kinds = events
        .iter()
        .map(|event| event["kind"].as_str().unwrap_or_default())
        .collect::<Vec<_>>();
    assert!(kinds.contains(&"handoff_started"));
    assert!(kinds.contains(&"handoff_completed"));
    assert!(kinds.contains(&"audit_read"));
    assert!(kinds.contains(&"output_policy_marked"));

    let redactions = jsonl(
        memory["outputRedactionsPath"]
            .as_str()
            .expect("redactions path"),
    );
    assert_eq!(redactions[0]["encrypted"], true);
    assert_eq!(redactions[0]["range"]["start"], 0);

    let compaction: Value = serde_json::from_str(
        &fs::read_to_string(
            memory["outputCompactionPath"]
                .as_str()
                .expect("compaction path"),
        )
        .expect("read compaction"),
    )
    .expect("parse compaction");
    assert_eq!(
        compaction["coordinateSpace"],
        "original_output_byte_offsets"
    );

    let screen = replay_screen_snapshot(&root, &session_id, false, Some(10), Some(1024))
        .expect("replay screen");
    assert!(screen.visible_text.contains("after"));
    assert_eq!(screen.rows, 4);
    assert_eq!(screen.cols, 20);

    let stored: Value =
        serde_json::from_str(&read_stored_sessions(&root).expect("stored sessions"))
            .expect("parse stored");
    let stored_items = stored["items"].as_array().expect("stored items");
    assert_eq!(stored_items.len(), 1);
    assert_eq!(stored_items[0]["restoration"]["ptyRestorable"], false);
    assert_eq!(stored_items[0]["restoration"]["ptyRecreatable"], true);
    assert_eq!(
        stored_items[0]["restoration"]["liveProcessRestorable"],
        false
    );
    assert_eq!(
        stored_items[0]["restoration"]["liveProcessReconnectable"],
        true
    );
    assert_eq!(
        stored_items[0]["restoration"]["reconnectRequiresLivePtyHost"],
        true
    );

    let index_manifest_path = memory["indexManifestPath"]
        .as_str()
        .expect("index manifest path");
    let index_manifest: Value = serde_json::from_str(
        &fs::read_to_string(index_manifest_path).expect("read index manifest"),
    )
    .expect("parse index manifest");
    assert_eq!(
        index_manifest["decision"]["truthStore"],
        "jsonl_text_artifacts"
    );
    let session_index = jsonl(
        memory["terminalSessionsIndexPath"]
            .as_str()
            .expect("session index path"),
    );
    assert_eq!(session_index[0]["restoreState"]["ptyRestorable"], false);
    assert_eq!(session_index[0]["restoreState"]["ptyRecreatable"], true);
    assert_eq!(
        session_index[0]["restoreState"]["liveProcessRestorable"],
        false
    );
    assert_eq!(
        session_index[0]["restoreState"]["liveProcessReconnectable"],
        true
    );
    assert_eq!(
        session_index[0]["restoreState"]["reconnectRequiresLivePtyHost"],
        true
    );
    fs::remove_dir_all(root).ok();
}

#[test]
fn replay_from_events_rebuilds_timeline_output_indexes_and_v2_indexes() {
    let root = temp_root("replay-rebuild");
    let session_id = format!("session-{}", uuid::Uuid::new_v4());
    record_session_created(create_input(&root, &session_id)).expect("record create");
    let context = MemoryContext {
        storage_root: root.clone(),
        session_id: session_id.clone(),
    };
    record_output(&context, b"first\nError: second\n").expect("record output");
    record_exit(&context, 1).expect("record exit");

    let paths = super::paths_for_session(&root, &session_id);
    let original_events = jsonl(paths.events_path.to_str().expect("event path"));
    fs::remove_file(&paths.ui_timeline_path).expect("remove timeline");
    fs::remove_file(&paths.line_index_path).expect("remove line index");
    fs::remove_file(&paths.error_index_path).expect("remove error index");
    fs::remove_file(&paths.index_manifest_path).expect("remove index manifest");
    fs::remove_file(&paths.index_events_path).expect("remove event index");

    super::rebuild_output_indexes_from_text(&paths, &session_id).expect("rebuild output indexes");
    super::rebuild_index_store_from_paths(&session_id, &paths).expect("rebuild v2 indexes");
    let timeline: Value = serde_json::from_str(
        &read_timeline(TimelineReadInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            cursor: None,
            limit: Some(20),
            kinds: None,
            actors: None,
            command_id: None,
            tool_call_id: None,
            agent_session_id: None,
            seq_start: None,
            seq_end: None,
            time_start_ms: None,
            time_end_ms: None,
            audit: None,
            actor_json: None,
            correlation_json: None,
        })
        .expect("timeline"),
    )
    .expect("parse timeline");
    assert_eq!(
        timeline["items"].as_array().expect("items").len(),
        original_events.len()
    );
    let lines = jsonl(paths.line_index_path.to_str().expect("line index path"));
    assert_eq!(lines.len(), 2);
    let errors = jsonl(paths.error_index_path.to_str().expect("error index path"));
    assert_eq!(errors.len(), 1);
    let event_index = jsonl(paths.index_events_path.to_str().expect("event index path"));
    assert_eq!(event_index.len(), original_events.len());
    fs::remove_dir_all(root).ok();
}
