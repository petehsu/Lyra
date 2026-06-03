#[allow(dead_code)]
#[path = "../src/input_controller.rs"]
mod input_controller;
#[allow(dead_code)]
#[path = "../src/permissions.rs"]
mod permissions;
#[allow(dead_code)]
#[path = "../src/sensitive_input.rs"]
mod sensitive_input;

use std::fs;
use std::path::PathBuf;

use input_controller::{
    InputController, InputExecutionStatus, SemanticInputAction, SemanticInputRequest,
};
use lyra_terminal_core::command_tracker::{
    prompt_snapshot, ByteRange, CommandCompletion, CommandObservationFrame, CommandStatus,
    CommandSubmission, CommandTracker, OutputSummaryInput,
};
use lyra_terminal_core::process_model::TerminalProcessModel;
use lyra_terminal_core::tui_act::{resolve_plan, TuiActContext, TuiActRequest};
use lyra_terminal_core::{tui_map, TerminalScreenState};
use permissions::{
    PermissionResponse, TerminalPermissionDecision, TerminalPermissionRisk, TerminalPermissionScope,
};
use serde_json::json;

const REQUIRED_FIXTURES: &[&str] = &[
    "npm-install-long-output.txt",
    "npm-test-failure-stack.txt",
    "npm-run-dev-server.txt",
    "cargo-test-success.txt",
    "cargo-test-failure.txt",
    "github-cli-auth-code.txt",
    "cli-wizard-approval.txt",
    "less-search-quit.ansi",
    "vim-edit-save-quit.ansi",
    "git-add-p-hunk-flow.txt",
    "node-repl.txt",
    "python-repl.txt",
    "debugger-prompt.txt",
    "ssh-remote-limited.txt",
];

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}

fn fixture(name: &str) -> String {
    fs::read_to_string(fixture_path(name)).unwrap_or_else(|error| {
        panic!("failed to read fixture {name}: {error}");
    })
}

fn fixture_body(name: &str) -> String {
    fixture(name)
        .lines()
        .filter(|line| !line.starts_with("# terminal-fixture-v1:"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn fixture_screen_bytes(name: &str) -> Vec<u8> {
    fixture_body(name).replace('\n', "\r\n").into_bytes()
}

fn decode_escaped_ansi(name: &str) -> Vec<u8> {
    let source = fixture_body(name);
    let mut bytes = Vec::new();
    let mut chars = source.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            let mut buf = [0; 4];
            bytes.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
            continue;
        }
        match chars.next() {
            Some('x') => {
                let high = chars.next().expect("hex high nibble");
                let low = chars.next().expect("hex low nibble");
                let value =
                    u8::from_str_radix(&format!("{high}{low}"), 16).expect("valid hex escape");
                bytes.push(value);
            }
            Some('r') => bytes.push(b'\r'),
            Some('n') => bytes.push(b'\n'),
            Some('\\') => bytes.push(b'\\'),
            Some(other) => {
                bytes.push(b'\\');
                let mut buf = [0; 4];
                bytes.extend_from_slice(other.encode_utf8(&mut buf).as_bytes());
            }
            None => bytes.push(b'\\'),
        }
    }
    bytes
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn frame(text_offset: u64, raw_offset: u64, screen_version: u64) -> CommandObservationFrame {
    CommandObservationFrame {
        output_text_offset: text_offset,
        raw_output_offset: raw_offset,
        screen_version,
        cwd: Some("/workspace".to_string()),
        prompt: Some(prompt_snapshot(
            true,
            Some("lyra %".to_string()),
            Some("/workspace".to_string()),
            Some("zsh".to_string()),
            Some("main".to_string()),
            Some(String::new()),
        )),
        actor: json!({ "kind": "agent", "agentSessionId": "agent-1" }),
        correlation: json!({
            "agentSessionId": "agent-1",
            "runtimeTurnId": "turn-1",
            "toolCallId": "tool-1"
        }),
        permission_id: Some("permission-1".to_string()),
        process_ids: vec![42],
    }
}

fn deny_permission(
    controller: &mut InputController,
    first: &input_controller::InputExecutionResult,
    request: &SemanticInputRequest,
    reason: &str,
) {
    controller.permissions_mut().respond(PermissionResponse {
        permission_id: first.permission_id.clone().expect("permission id"),
        session_id: request.session_id.clone(),
        input_id: first.input_id.clone(),
        action: request.action.as_contract_name().to_string(),
        decision: TerminalPermissionDecision::Deny,
        risk: first.risk,
        scope: TerminalPermissionScope::one_shot(request.session_id.clone()),
        reason: Some(reason.to_string()),
        actor_json: request.actor_json.clone(),
        correlation_json: request.correlation_json.clone(),
        now_ms: request.now_ms,
    });
}

#[test]
fn real_workflow_fixtures_are_present_and_redacted() {
    for name in REQUIRED_FIXTURES {
        let content = fixture(name);
        assert!(
            content.starts_with("# terminal-fixture-v1:"),
            "{name} has a semantic fixture header"
        );
        assert!(content.len() > 80, "{name} has useful replay content");
        assert!(
            !content.contains("ghp_"),
            "{name} does not contain a GitHub token"
        );
        assert!(
            !content.contains("BEGIN PRIVATE KEY"),
            "{name} does not contain private key material"
        );
    }

    let gh = fixture("github-cli-auth-code.txt");
    assert!(gh.contains("XXXX-XXXX"));
    assert!(!gh.contains("1234-5678"));

    let ssh = fixture("ssh-remote-limited.txt");
    assert!(ssh.contains("limited=true"));
    assert!(ssh.contains("remote destructive action requires elevated approval"));
}

#[test]
fn real_workflow_fixtures_replay_to_kernel_screen() {
    for (name, expected) in [
        ("npm-test-failure-stack.txt", "AssertionError"),
        ("npm-run-dev-server.txt", "http://127.0.0.1:5173/"),
        ("cargo-test-success.txt", "test result: ok"),
        ("cargo-test-failure.txt", "test result: FAILED"),
        ("debugger-prompt.txt", "debug>"),
    ] {
        let mut state = TerminalScreenState::new(24, 100);
        state.feed(&fixture_screen_bytes(name));
        let snapshot = state.snapshot(true, Some(80), Some(64 * 1024));
        assert!(
            snapshot.visible_text.contains(expected)
                || snapshot
                    .scrollback_text
                    .as_deref()
                    .unwrap_or("")
                    .contains(expected),
            "{name} should replay expected text"
        );
        assert_eq!(snapshot.mode, "normal");
        assert!(snapshot.screen_version > 0);
    }
}

#[test]
fn tui_fixtures_map_regions_and_plan_actions() {
    let mut wizard = TerminalScreenState::new(18, 80);
    wizard.feed(&fixture_screen_bytes("cli-wizard-approval.txt"));
    let wizard_snapshot = wizard.snapshot(false, Some(18), Some(16 * 1024));
    let (regions, truncated) = tui_map::regions_from_snapshot(&wizard_snapshot, Some(64), true);
    assert!(!truncated);
    let approval_region = regions
        .iter()
        .find(|region| region.text.contains("Allow once"))
        .expect("approval menu region");

    let plan = resolve_plan(
        TuiActContext {
            current_screen_cursor: &wizard_snapshot.cursor,
            regions: &regions,
        },
        TuiActRequest {
            action: "confirm".to_string(),
            region_id: Some(approval_region.region_id.clone()),
            screen_cursor: Some(wizard_snapshot.cursor.clone()),
            text: None,
            direction: None,
            amount: None,
            reason: Some("release gate approves one wizard action".to_string()),
        },
    )
    .expect("confirm plan");
    assert_eq!(plan.input_action, "submitInput");
    assert_eq!(plan.keys, vec!["enter"]);

    let vim_bytes = decode_escaped_ansi("vim-edit-save-quit.ansi");
    let exit_alt = find_subsequence(&vim_bytes, b"\x1b[?1049l").expect("alternate exit");
    let mut vim = TerminalScreenState::new(24, 80);
    vim.feed(&vim_bytes[..exit_alt]);
    let vim_snapshot = vim.snapshot(false, Some(24), Some(16 * 1024));
    assert_eq!(vim_snapshot.mode, "alternate");
    assert!(String::from_utf8_lossy(&vim_bytes).contains("src/main.rs"));
    assert!(vim_snapshot.screen_version > 0);
}

#[test]
fn command_tracker_summarizes_failure_fixture_boundaries() {
    let output = fixture_body("npm-test-failure-stack.txt");
    let mut tracker = CommandTracker::new("session-fixture");
    tracker.submit_command(CommandSubmission {
        command_id: Some("command-npm-test".to_string()),
        command_text: Some("npm test -- --runInBand".to_string()),
        frame: frame(0, 0, 1),
        status: CommandStatus::Running,
        confidence: 1.0,
        boundary_source: "fixture_start".to_string(),
    });
    tracker.complete_command(CommandCompletion {
        command_id: Some("command-npm-test".to_string()),
        exit_code: Some(1),
        signal: None,
        frame: frame(output.len() as u64, output.as_bytes().len() as u64, 2),
        confidence: 1.0,
        boundary_source: "fixture_exit".to_string(),
    });

    let error_lines = output
        .lines()
        .filter(|line| line.contains("FAIL") || line.contains("AssertionError"))
        .map(str::to_string)
        .collect::<Vec<_>>();
    let summary = tracker.summarize_output(OutputSummaryInput {
        command_id: "command-npm-test".to_string(),
        output: output.clone(),
        error_lines,
        output_text_range: ByteRange {
            start: 0,
            end: output.len() as u64,
        },
        raw_output_range: ByteRange {
            start: 0,
            end: output.as_bytes().len() as u64,
        },
    });

    let command = tracker
        .latest_command("command-npm-test")
        .expect("completed command");
    assert_eq!(command.exit_code, Some(1));
    assert_eq!(summary.status, CommandStatus::Failed);
    assert!(summary
        .last_error_lines
        .iter()
        .any(|line| line.contains("AssertionError")));
    assert_eq!(summary.raw_output_range.end, output.as_bytes().len() as u64);
}

#[test]
fn security_gate_denies_writes_and_marks_dangerous_actions() {
    let mut controller = InputController::new();
    let mut request =
        SemanticInputRequest::run_command("terminal-session-1", "rm -rf ./build", 1_000);
    request.actor_json = Some(r#"{"kind":"agent","agentSessionId":"agent-1"}"#.to_string());
    request.correlation_json =
        Some(r#"{"agentSessionId":"agent-1","runtimeTurnId":"turn-1"}"#.to_string());

    let first = controller.plan(request.clone());
    assert_eq!(first.status, InputExecutionStatus::NeedsApproval);
    assert_eq!(first.risk, TerminalPermissionRisk::Shell);
    deny_permission(
        &mut controller,
        &first,
        &request,
        "release gate denies destructive command",
    );
    request.input_id = Some(first.input_id);
    let denied = controller.plan(request);
    assert_eq!(denied.status, InputExecutionStatus::Denied);
    assert!(denied.operations.is_empty());

    let mut signal = SemanticInputRequest::run_command("terminal-session-1", "ignored", 1_100);
    signal.action = SemanticInputAction::SendSignal;
    signal.command = None;
    signal.signal = Some("SIGKILL".to_string());
    let signal_first = controller.plan(signal);
    assert_eq!(signal_first.status, InputExecutionStatus::NeedsApproval);
    assert_eq!(signal_first.risk, TerminalPermissionRisk::Dangerous);
}

#[test]
fn ansi_fuzz_and_unicode_resize_are_bounded() {
    let cases: &[&[u8]] = &[
        b"\x1b[?1049h\x1b[Hpartial alternate",
        b"\x1b]133;C;command=npm%20test\x07output\x1b]133;D;1\x07",
        b"\xff\xfeinvalid utf8 does not panic",
        b"\x1b[9999;9999Hfar cursor\x1b[2Jclear",
        b"\x1b[?2004hbracketed paste\x1b[?2004l",
    ];

    for bytes in cases {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mut state = TerminalScreenState::new(12, 40);
            state.feed(bytes);
            let wide = format!("wide {}\n", "\u{754c}");
            state.feed(wide.as_bytes());
            state.resize(10, 32);
            let snapshot = state.snapshot(true, Some(20), Some(8 * 1024));
            assert!(snapshot.rows <= 10);
            assert!(snapshot.cols <= 32);
            assert!(snapshot.visible_text.len() <= 8 * 1024);
        }));
        assert!(result.is_ok(), "ANSI parser should not panic for {bytes:?}");
    }
}

#[test]
fn remote_sessions_are_limited_for_process_and_signal_gate() {
    let mut model = TerminalProcessModel::new("session-remote", None);
    assert!(model.limited);
    model.mark_remote_limited("ssh remote process tree unavailable");
    assert_eq!(
        model.limited_reason.as_deref(),
        Some("ssh remote process tree unavailable")
    );
}
