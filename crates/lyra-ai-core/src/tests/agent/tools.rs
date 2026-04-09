use std::fs::{create_dir_all, write};
use std::path::PathBuf;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::agent::terminal_policy::{
    select_terminal_interaction_policy, TerminalInteractionPolicy,
    TerminalInteractionPolicyKind,
};
use crate::agent::tools::{
    execute_readonly_tool, execute_tool_with_progress, grant_approval_once, ToolExecutionContext,
};
use crate::agent::types::{
    AgentCreateSessionRequest, AGENT_PLAN_APPROVAL_REQUIRED, AGENT_PLAN_QUESTION_REQUIRED,
    AGENT_TOOL_READ_BLOCKED,
};
use crate::storage::registry_db;
use crate::tests::support::TempStorageRoot;

fn create_workspace_root(temp: &TempStorageRoot) -> PathBuf {
    let root = PathBuf::from(temp.as_string()).join("workspace");
    create_dir_all(&root).expect("create workspace root");
    root
}

fn tool_context<'a>(
    storage_root: Option<&'a str>,
    project_root: Option<&'a str>,
    tool_call_id: Option<&'a str>,
    terminal_policy: Option<&'a TerminalInteractionPolicy>,
    plan_mode: bool,
) -> ToolExecutionContext<'a> {
    ToolExecutionContext {
        storage_root,
        project_root,
        agent_session_id: Some("test-agent-session"),
        agent_turn_id: Some("test-turn"),
        tool_call_id,
        terminal_policy,
        plan_mode,
    }
}

#[test]
fn filesystem_list_respects_limit() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    write(root.join("a.txt"), "a").expect("write a.txt");
    write(root.join("b.txt"), "b").expect("write b.txt");

    let result = execute_readonly_tool(
        "filesystem.list",
        &json!({
            "path": root.to_string_lossy(),
            "limit": 1,
        }),
        None,
    )
    .expect("run list tool");

    assert_eq!(result.get("truncated").and_then(Value::as_bool), Some(true));
    let entries = result
        .get("entries")
        .and_then(Value::as_array)
        .expect("list entries");
    assert_eq!(entries.len(), 1);
}

#[test]
fn filesystem_search_honors_glob_filter() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let src_dir = root.join("src");
    create_dir_all(&src_dir).expect("create src dir");
    write(
        src_dir.join("main.rs"),
        "fn main() { println!(\"Hello Agent\"); }\n",
    )
    .expect("write rust file");
    write(root.join("notes.txt"), "agent appears here too\n").expect("write text file");

    let result = execute_readonly_tool(
        "filesystem.search",
        &json!({
            "pattern": "agent",
            "path": root.to_string_lossy(),
            "glob": "*.rs",
            "limit": 20,
        }),
        None,
    )
    .expect("run search tool");

    let matches = result
        .get("matches")
        .and_then(Value::as_array)
        .expect("search matches");
    assert_eq!(matches.len(), 1);
    let relative_path = matches[0]
        .get("relativePath")
        .and_then(Value::as_str)
        .expect("relative path");
    assert_eq!(relative_path, "src/main.rs");
}

#[test]
fn filesystem_read_range_reports_unsupported_for_missing_file() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let missing_path = root.join("missing.txt");

    let result = execute_readonly_tool(
        "filesystem.read_range",
        &json!({
            "path": missing_path.to_string_lossy(),
            "startLine": 1,
            "endLine": 5,
        }),
        None,
    )
    .expect("run read_range tool");

    assert_eq!(
        result.get("kind").and_then(Value::as_str),
        Some("unsupported")
    );
}

#[test]
fn rejects_unknown_tool_names() {
    let error = execute_readonly_tool("filesystem.unknown", &json!({}), None)
        .expect_err("unknown tool should fail");
    assert_eq!(error.code, AGENT_TOOL_READ_BLOCKED);
}

#[test]
fn bound_project_root_scopes_relative_defaults() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    write(root.join("scoped.txt"), "scoped\n").expect("write scoped file");

    let result =
        execute_readonly_tool("filesystem.list", &json!({}), Some(&root.to_string_lossy()))
            .expect("run list with bound scope");
    let listed_path = result
        .get("path")
        .and_then(Value::as_str)
        .expect("listed path");
    let listed_canonical = PathBuf::from(listed_path)
        .canonicalize()
        .expect("canonical listed path");
    let root_canonical = root.canonicalize().expect("canonical root path");
    assert_eq!(listed_canonical, root_canonical);
}

#[test]
fn bound_project_root_blocks_outside_paths() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let outside_file = PathBuf::from(temp.as_string()).join("outside.txt");
    write(&outside_file, "outside\n").expect("write outside file");

    let error = execute_readonly_tool(
        "filesystem.read_range",
        &json!({
            "path": outside_file.to_string_lossy(),
            "startLine": 1,
            "endLine": 1,
        }),
        Some(&root.to_string_lossy()),
    )
    .expect_err("outside path should be blocked");
    assert_eq!(error.code, AGENT_TOOL_READ_BLOCKED);
}

#[test]
fn filesystem_write_creates_file() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let file_path = root.join("src").join("main.rs");

    let result = execute_readonly_tool(
        "filesystem.write",
        &json!({
            "path": file_path.to_string_lossy(),
            "content": "fn main() {}\n",
        }),
        None,
    )
    .expect("write file");

    assert_eq!(result.get("created").and_then(Value::as_bool), Some(true));
    let saved = std::fs::read_to_string(file_path).expect("read saved file");
    assert_eq!(saved, "fn main() {}\n");
}

#[test]
fn filesystem_edit_replaces_text() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let file_path = root.join("app.txt");
    write(&file_path, "hello old world\n").expect("seed file");

    let result = execute_readonly_tool(
        "filesystem.edit",
        &json!({
            "path": file_path.to_string_lossy(),
            "oldText": "old",
            "newText": "new",
        }),
        None,
    )
    .expect("edit file");

    assert_eq!(result.get("replacements").and_then(Value::as_u64), Some(1));
    let saved = std::fs::read_to_string(file_path).expect("read edited file");
    assert_eq!(saved, "hello new world\n");
}

#[test]
fn filesystem_multi_edit_applies_all_replacements() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let file_path = root.join("multi.txt");
    write(&file_path, "hello world\nhello world\n").expect("seed multi file");

    let result = execute_readonly_tool(
        "filesystem.multi_edit",
        &json!({
            "path": file_path.to_string_lossy(),
            "edits": [
                {
                    "oldText": "hello",
                    "newText": "hi",
                    "replaceAll": true,
                },
                {
                    "oldText": "world",
                    "newText": "lyra",
                    "replaceAll": true,
                }
            ]
        }),
        None,
    )
    .expect("multi edit file");

    assert_eq!(result.get("editCount").and_then(Value::as_u64), Some(2));
    let saved = std::fs::read_to_string(file_path).expect("read multi edited file");
    assert_eq!(saved, "hi lyra\nhi lyra\n");
}

#[test]
fn filesystem_write_reports_first_changed_line_for_update() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let file_path = root.join("update.txt");
    write(&file_path, "line1\nline2\nline3\n").expect("seed update file");

    let result = execute_readonly_tool(
        "filesystem.write",
        &json!({
            "path": file_path.to_string_lossy(),
            "content": "line1\nline2-changed\nline3\n",
        }),
        None,
    )
    .expect("write update");

    assert_eq!(
        result.get("firstChangedLine").and_then(Value::as_u64),
        Some(2)
    );
}

#[test]
fn filesystem_edit_reports_first_changed_line() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let file_path = root.join("edit-line.txt");
    write(&file_path, "a\nb\nc\n").expect("seed edit line file");

    let result = execute_readonly_tool(
        "filesystem.edit",
        &json!({
            "path": file_path.to_string_lossy(),
            "oldText": "b",
            "newText": "b2",
        }),
        None,
    )
    .expect("edit line");

    assert_eq!(
        result.get("firstChangedLine").and_then(Value::as_u64),
        Some(2)
    );
}

#[test]
fn filesystem_write_progress_emits_text_chunks() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let file_path = root.join("progress.txt");
    let mut saw_chunk = false;
    let mut saw_baseline = false;

    let result = execute_tool_with_progress(
        "filesystem.write",
        &json!({
            "path": file_path.to_string_lossy(),
            "content": "chunk-a\nchunk-b\n",
        }),
        ToolExecutionContext::readonly(None),
        |progress: Value| {
            if progress
                .get("stage")
                .and_then(Value::as_str)
                .is_some_and(|value| value == "baseline")
            {
                saw_baseline = true;
            }
            if progress
                .get("chunkText")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.is_empty())
            {
                saw_chunk = true;
            }
        },
    )
    .expect("write with progress");

    assert_eq!(result.get("kind").and_then(Value::as_str), Some("created"));
    assert!(saw_baseline);
    assert!(saw_chunk);
}

#[test]
fn filesystem_edit_returns_no_match_instead_of_error() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let file_path = root.join("no-match.txt");
    write(&file_path, "alpha\nbeta\ngamma\n").expect("seed no match file");

    let result = execute_readonly_tool(
        "filesystem.edit",
        &json!({
            "path": file_path.to_string_lossy(),
            "oldText": "missing-segment",
            "newText": "replacement",
        }),
        None,
    )
    .expect("edit should not fail on no match");

    assert_eq!(result.get("kind").and_then(Value::as_str), Some("no_match"));
    assert_eq!(result.get("replacements").and_then(Value::as_u64), Some(0));
    let saved = std::fs::read_to_string(file_path).expect("read untouched file");
    assert_eq!(saved, "alpha\nbeta\ngamma\n");
}

#[test]
fn filesystem_multi_edit_allows_partial_application() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let file_path = root.join("multi-partial.txt");
    write(&file_path, "first\nsecond\nthird\n").expect("seed partial multi file");

    let result = execute_readonly_tool(
        "filesystem.multi_edit",
        &json!({
            "path": file_path.to_string_lossy(),
            "edits": [
                {
                    "oldText": "first",
                    "newText": "FIRST",
                },
                {
                    "oldText": "missing",
                    "newText": "MISSING",
                },
                {
                    "oldText": "second",
                    "newText": "SECOND",
                }
            ]
        }),
        None,
    )
    .expect("multi edit partial should not fail");

    assert_eq!(result.get("kind").and_then(Value::as_str), Some("partial"));
    assert_eq!(
        result.get("appliedEditCount").and_then(Value::as_u64),
        Some(2)
    );
    assert_eq!(result.get("replacements").and_then(Value::as_u64), Some(2));
    let not_found = result
        .get("notFoundEditIndexes")
        .and_then(Value::as_array)
        .expect("not found edit indexes");
    assert_eq!(not_found.len(), 1);
    assert_eq!(not_found[0].as_u64(), Some(2));

    let saved = std::fs::read_to_string(file_path).expect("read partial multi edited file");
    assert_eq!(saved, "FIRST\nSECOND\nthird\n");
}

#[test]
fn terminal_exec_returns_interactive_advisory_for_tui_commands() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let root_string = root.to_string_lossy().to_string();
    let policy = select_terminal_interaction_policy("看一下电脑现在状态怎么样");

    let result = execute_tool_with_progress(
        "terminal.exec",
        &json!({
            "command": "htop",
        }),
        tool_context(
            None,
            Some(root_string.as_str()),
            Some("terminal-exec-advisory"),
            Some(&policy),
            false,
        ),
        |_| {},
    )
    .expect("terminal exec should return advisory");

    assert_eq!(
        result.get("kind").and_then(Value::as_str),
        Some("interactive_advisory")
    );
    assert_eq!(
        result
            .get("interactiveCategory")
            .and_then(Value::as_str),
        Some("fullscreen_tui")
    );
    assert_eq!(
        result.get("suggestedTool").and_then(Value::as_str),
        Some("terminal.session.start")
    );
    assert!(
        result
            .get("suggestedAlternative")
            .and_then(Value::as_str)
            .is_some(),
        "expected non-interactive rewrite advice"
    );
}

#[test]
fn terminal_session_shell_mode_is_blocked_without_explicit_request() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let root_string = root.to_string_lossy().to_string();
    let policy = select_terminal_interaction_policy("看一下电脑现在状态怎么样");

    let result = execute_tool_with_progress(
        "terminal.session.start",
        &json!({
            "mode": "shell",
        }),
        tool_context(
            None,
            Some(root_string.as_str()),
            Some("terminal-shell-blocked"),
            Some(&policy),
            false,
        ),
        |_| {},
    )
    .expect("shell mode should be policy blocked");

    assert_eq!(
        result.get("kind").and_then(Value::as_str),
        Some("interactive_policy_blocked")
    );
    assert_eq!(result.get("mode").and_then(Value::as_str), Some("shell"));
}

#[test]
fn terminal_session_command_mode_can_start_and_read_output() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let root_string = root.to_string_lossy().to_string();
    let policy = select_terminal_interaction_policy("看一下电脑现在状态怎么样");
    let command = "printf 'hello-from-session\\n'";

    grant_approval_once(
        "terminal-session-command",
        &json!({
            "command": command,
        }),
    );

    let started = execute_tool_with_progress(
        "terminal.session.start",
        &json!({
            "mode": "command",
            "command": command,
            "cwd": root_string,
        }),
        tool_context(
            None,
            Some(root_string.as_str()),
            Some("terminal-session-command"),
            Some(&policy),
            false,
        ),
        |_| {},
    )
    .expect("start command session");

    assert_eq!(started.get("kind").and_then(Value::as_str), Some("started"));
    let session_id = started
        .get("sessionId")
        .and_then(Value::as_str)
        .expect("session id")
        .to_string();

    let read = execute_tool_with_progress(
        "terminal.session.read",
        &json!({
            "sessionId": session_id,
            "waitMs": 1000,
        }),
        tool_context(None, Some(root_string.as_str()), None, Some(&policy), false),
        |_| {},
    )
    .expect("read command session");

    assert_eq!(read.get("kind").and_then(Value::as_str), Some("read"));
    assert!(
        read.get("output")
            .and_then(Value::as_str)
            .is_some_and(|value| value.contains("hello-from-session")),
        "expected command session output"
    );

    execute_tool_with_progress(
        "terminal.session.close",
        &json!({
            "sessionId": read
                .get("sessionId")
                .and_then(Value::as_str)
                .expect("session id in read response"),
        }),
        tool_context(None, Some(root_string.as_str()), None, Some(&policy), false),
        |_| {},
    )
    .expect("close command session");
}

#[test]
fn terminal_session_shell_mode_honors_one_time_approval() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let root_string = root.to_string_lossy().to_string();
    let policy = TerminalInteractionPolicy {
        kind: TerminalInteractionPolicyKind::RequireRequestedTui,
        reasons: vec!["user explicitly asked for an interactive shell".to_string()],
        explicit_tui_request: true,
        user_insistence: true,
    };

    let error = execute_tool_with_progress(
        "terminal.session.start",
        &json!({
            "mode": "shell",
            "cwd": root_string,
        }),
        tool_context(
            None,
            Some(root_string.as_str()),
            Some("terminal-shell-approval"),
            Some(&policy),
            false,
        ),
        |_| {},
    )
    .expect_err("shell mode should require approval");
    assert_eq!(error.code, "AGENT_TOOL_APPROVAL_REQUIRED");

    grant_approval_once("terminal-shell-approval", &json!({}));

    let started = execute_tool_with_progress(
        "terminal.session.start",
        &json!({
            "mode": "shell",
            "cwd": root_string,
        }),
        tool_context(
            None,
            Some(root_string.as_str()),
            Some("terminal-shell-approval"),
            Some(&policy),
            false,
        ),
        |_| {},
    )
    .expect("approved shell mode should start");

    let session_id = started
        .get("sessionId")
        .and_then(Value::as_str)
        .expect("session id")
        .to_string();
    let shell_command = "printf 'shell-ready\\n'";

    grant_approval_once(
        "terminal-shell-write",
        &json!({
            "command": shell_command,
            "sessionId": session_id,
        }),
    );

    execute_tool_with_progress(
        "terminal.session.write",
        &json!({
            "sessionId": session_id,
            "text": shell_command,
            "appendNewline": true,
        }),
        tool_context(
            None,
            Some(root_string.as_str()),
            Some("terminal-shell-write"),
            Some(&policy),
            false,
        ),
        |_| {},
    )
    .expect("write safe shell command");

    let mut cursor: Option<String> = None;
    let mut observed_output = String::new();
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline && !observed_output.contains("shell-ready") {
        let read = execute_tool_with_progress(
            "terminal.session.read",
            &json!({
                "sessionId": started
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .expect("session id"),
                "waitMs": 250,
                "cursor": cursor,
            }),
            tool_context(None, Some(root_string.as_str()), None, Some(&policy), false),
            |_| {},
        )
        .expect("read shell session");

        if let Some(chunk) = read.get("output").and_then(Value::as_str) {
            observed_output.push_str(chunk);
        }
        cursor = read
            .get("cursor")
            .and_then(Value::as_str)
            .map(str::to_string);
        if observed_output.contains("shell-ready") {
            break;
        }
        thread::sleep(Duration::from_millis(50));
    }

    assert!(
        observed_output.contains("shell-ready"),
        "expected shell output after write"
    );

    execute_tool_with_progress(
        "terminal.session.close",
        &json!({
            "sessionId": session_id,
        }),
        tool_context(None, Some(root_string.as_str()), None, Some(&policy), false),
        |_| {},
    )
    .expect("close shell session");
}

#[test]
fn request_user_input_requires_plan_response() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();

    let error = execute_tool_with_progress(
        "request_user_input",
        &json!({
            "questions": [
                {
                    "id": "scope",
                    "header": "Scope",
                    "question": "Which scope should Lyra target?",
                    "options": [
                        { "label": "A", "description": "Option A" },
                        { "label": "B", "description": "Option B" }
                    ]
                }
            ],
            "allowNote": true
        }),
        tool_context(
            Some(storage_root.as_str()),
            None,
            Some("plan-question-call"),
            None,
            true,
        ),
        |_| {},
    )
    .expect_err("request_user_input should wait on the UI");

    assert_eq!(error.code, AGENT_PLAN_QUESTION_REQUIRED);
    assert_eq!(
        error
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("allowNote"))
            .and_then(Value::as_bool),
        Some(true)
    );
}

#[test]
fn request_user_input_is_available_outside_plan_mode() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();

    let error = execute_tool_with_progress(
        "request_user_input",
        &json!({
            "questions": [
                {
                    "id": "layout",
                    "header": "Layout",
                    "question": "Which landing-page layout should Lyra use?",
                    "allowOther": true,
                    "options": [
                        { "label": "Hero first", "description": "Lead with the hero section", "preview": "<Hero />" },
                        { "label": "Product first", "description": "Lead with product proof" }
                    ]
                }
            ],
            "allowNote": true
        }),
        tool_context(
            Some(storage_root.as_str()),
            None,
            Some("default-question-call"),
            None,
            false,
        ),
        |_| {},
    )
    .expect_err("request_user_input should still wait on the UI in default mode");

    assert_eq!(error.code, AGENT_PLAN_QUESTION_REQUIRED);
    assert_eq!(
        error
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("questions"))
            .and_then(Value::as_array)
            .and_then(|questions| questions.first())
            .and_then(Value::as_object)
            .and_then(|question| question.get("allowOther"))
            .and_then(Value::as_bool),
        Some(true)
    );
}

#[test]
fn plan_update_and_submit_persist_plan_state() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let session = crate::agent::service::create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Plan".to_string()),
        profile_id: None,
    })
    .expect("create session");

    let updated = execute_tool_with_progress(
        "plan.update_draft",
        &json!({
            "draftMarkdown": "# Plan\n\n1. Inspect\n2. Implement\n"
        }),
        ToolExecutionContext {
            storage_root: Some(storage_root.as_str()),
            project_root: None,
            agent_session_id: Some(session.id.as_str()),
            agent_turn_id: Some("plan-turn"),
            tool_call_id: Some("plan-update-call"),
            terminal_policy: None,
            plan_mode: true,
        },
        |_| {},
    )
    .expect("update draft");
    assert_eq!(updated.get("kind").and_then(Value::as_str), Some("plan_draft_updated"));

    let saved = registry_db::read_agent_plan(&storage_root, &session.id)
        .expect("read plan")
        .expect("plan exists");
    assert_eq!(saved.version, 1);
    assert_eq!(saved.draft_markdown, "# Plan\n\n1. Inspect\n2. Implement\n");

    let error = execute_tool_with_progress(
        "plan.submit_for_approval",
        &json!({
            "planMarkdown": "# Plan\n\n1. Inspect\n2. Implement\n",
            "summary": "Ready for implementation"
        }),
        ToolExecutionContext {
            storage_root: Some(storage_root.as_str()),
            project_root: None,
            agent_session_id: Some(session.id.as_str()),
            agent_turn_id: Some("plan-turn"),
            tool_call_id: Some("plan-submit-call"),
            terminal_policy: None,
            plan_mode: true,
        },
        |_| {},
    )
    .expect_err("submit should require approval");

    assert_eq!(error.code, AGENT_PLAN_APPROVAL_REQUIRED);
    let submitted = registry_db::read_agent_plan(&storage_root, &session.id)
        .expect("read submitted plan")
        .expect("submitted plan exists");
    assert_eq!(submitted.status, crate::agent::types::AgentPlanStatus::Submitted);
    assert_eq!(submitted.last_submitted_version, Some(1));
    assert_eq!(
        submitted.proposed_markdown.as_deref(),
        Some("# Plan\n\n1. Inspect\n2. Implement\n")
    );
}

#[test]
fn plan_mode_blocks_mutating_terminal_exec_commands() {
    let temp = TempStorageRoot::new();
    let root = create_workspace_root(&temp);
    let root_string = root.to_string_lossy().to_string();
    let policy = select_terminal_interaction_policy("请先规划，不要直接实现");

    let result = execute_tool_with_progress(
        "terminal.exec",
        &json!({
            "command": "npm install",
            "cwd": root_string,
        }),
        tool_context(
            None,
            Some(root_string.as_str()),
            Some("plan-mode-terminal"),
            Some(&policy),
            true,
        ),
        |_| {},
    )
    .expect("plan mode should deny mutating command");

    assert_eq!(result.get("kind").and_then(Value::as_str), Some("denied"));
    assert_eq!(
        result.get("planModeReadonly").and_then(Value::as_bool),
        Some(true)
    );
}
