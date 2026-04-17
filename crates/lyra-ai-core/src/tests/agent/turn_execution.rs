use std::collections::BTreeMap;
use std::fs::write;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use once_cell::sync::Lazy;
use serde_json::{json, Value};

use crate::agent::service::{
    answer_question, bind_session_project, create_session, enter_plan_mode, get_session, send_turn,
    submit_command_approval,
};
use crate::agent::tools::{set_skill_prompts, SkillPromptEntry};
use crate::agent::types::{
    AgentAnswerQuestionRequest, AgentBindSessionProjectRequest, AgentCreateSessionRequest,
    AgentEnterPlanModeRequest, AgentGetSessionRequest, AgentPendingInteractionKind,
    AgentPendingInteractionStatus, AgentPlanState, AgentPlanStatus, AgentSendTurnRequest,
    CommandApprovalSubmitRequest, AGENT_PROVIDER_INVALID_RESPONSE,
};
use crate::profile::service::upsert_profile;
use crate::profile::types::UpsertAiProfileRequest;
use crate::storage::registry_db;
use crate::tests::support::TempStorageRoot;

static SKILL_PROMPTS_TEST_GUARD: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));
static ENV_TEST_GUARD: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

struct MockOpenAiServer {
    base_url: String,
    requests: Arc<Mutex<Vec<Value>>>,
    handle: Option<JoinHandle<()>>,
}

impl MockOpenAiServer {
    fn start(responses: Vec<String>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock openai server");
        let addr = listener.local_addr().expect("mock server local addr");
        let requests = Arc::new(Mutex::new(Vec::<Value>::new()));
        let requests_for_thread = Arc::clone(&requests);
        let handle = thread::spawn(move || {
            for response in responses {
                let (stream, _) = listener.accept().expect("accept mock request");
                handle_connection(stream, &requests_for_thread, &response);
            }
        });
        Self {
            base_url: format!("http://{addr}"),
            requests,
            handle: Some(handle),
        }
    }

    fn finish(mut self) -> Vec<Value> {
        if let Some(handle) = self.handle.take() {
            handle.join().expect("join mock server");
        }
        self.requests.lock().expect("lock mock requests").clone()
    }
}

fn handle_connection(stream: TcpStream, requests: &Arc<Mutex<Vec<Value>>>, response: &str) {
    let mut reader = BufReader::new(stream);
    let mut content_length = 0_usize;
    loop {
        let mut line = String::new();
        let bytes = reader
            .read_line(&mut line)
            .expect("read mock request header");
        if bytes == 0 || line == "\r\n" {
            break;
        }
        let lower = line.to_ascii_lowercase();
        if let Some(raw_value) = lower.strip_prefix("content-length:") {
            content_length = raw_value.trim().parse::<usize>().unwrap_or(0);
        }
    }

    let mut body = vec![0_u8; content_length];
    if content_length > 0 {
        reader
            .read_exact(&mut body)
            .expect("read mock request body");
    }
    if let Ok(value) = serde_json::from_slice::<Value>(&body) {
        requests.lock().expect("lock requests").push(value);
    }

    let mut stream = reader.into_inner();
    let payload = response.as_bytes();
    let header = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        payload.len()
    );
    stream
        .write_all(header.as_bytes())
        .expect("write mock response header");
    stream.write_all(payload).expect("write mock response body");
}

fn create_openai_compatible_profile(storage_root: &str, base_url: &str) -> String {
    let profile = upsert_profile(UpsertAiProfileRequest {
        storage_root: storage_root.to_string(),
        id: None,
        name: "Test OpenAI Compatible".to_string(),
        provider_id: "custom_openai_compatible".to_string(),
        protocol_id: "openai_compatible".to_string(),
        preset_id: None,
        connection_config: [("baseUrl".to_string(), base_url.to_string())]
            .into_iter()
            .collect::<BTreeMap<_, _>>(),
        auth_config: BTreeMap::new(),
        secret_values: None,
        clear_secret_fields: None,
        headers: None,
        model: "test-model".to_string(),
        custom_models: None,
    })
    .expect("upsert test profile");
    profile.id
}

fn simple_stream_response(content: &str) -> String {
    format!(
        "data: {}\n\ndata: [DONE]\n\n",
        json!({
            "choices": [{
                "delta": {
                    "content": content
                }
            }],
            "usage": {
                "prompt_tokens": 8,
                "completion_tokens": 4,
                "total_tokens": 12
            }
        })
    )
}

fn empty_stream_response() -> String {
    format!(
        "data: {}\n\ndata: [DONE]\n\n",
        json!({
            "choices": [{
                "delta": {}
            }],
            "usage": {
                "prompt_tokens": 8,
                "completion_tokens": 0,
                "total_tokens": 8
            }
        })
    )
}

struct EnvVarReset {
    key: &'static str,
    previous: Option<String>,
}

impl EnvVarReset {
    fn set(key: &'static str, value: &str) -> Self {
        let previous = std::env::var(key).ok();
        std::env::set_var(key, value);
        Self { key, previous }
    }
}

impl Drop for EnvVarReset {
    fn drop(&mut self) {
        if let Some(previous) = self.previous.as_deref() {
            std::env::set_var(self.key, previous);
        } else {
            std::env::remove_var(self.key);
        }
    }
}

#[test]
fn old_text_not_found_returns_no_match_and_turn_completes() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let target_file = std::path::PathBuf::from(&storage_root).join("target.txt");
    write(&target_file, "alpha\nbeta\ngamma\n").expect("seed target file");

    let edit_arguments = json!({
        "path": target_file.to_string_lossy(),
        "oldText": "missing-snippet",
        "newText": "replacement",
    })
    .to_string();
    let first_response = format!(
        "data: {}\n\ndata: [DONE]\n\n",
        json!({
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_tool_1",
                        "type": "function",
                        "function": {
                            "name": "filesystem_edit",
                            "arguments": edit_arguments,
                        }
                    }]
                }
            }]
        })
    );
    let second_response = format!(
        "data: {}\n\ndata: [DONE]\n\n",
        json!({
            "choices": [{
                "delta": {
                    "content": "I could not match the requested oldText, please refine the edit target."
                }
            }],
            "usage": {
                "prompt_tokens": 9,
                "completion_tokens": 7,
                "total_tokens": 16
            }
        })
    );
    let server = MockOpenAiServer::start(vec![first_response, second_response]);
    let profile_id = create_openai_compatible_profile(&storage_root, &server.base_url);

    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Tool Failure Recovery".to_string()),
        profile_id: Some(profile_id),
    })
    .expect("create session");

    let result = send_turn(AgentSendTurnRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
        input: "replace the old snippet".to_string(),
        profile_id: None,
        project_root: None,
        max_steps: Some(4),
        enable_planning: false,
        planning_min_chars: None,
        enable_reflection: false,
        reflection_min_tool_calls: None,
        enable_context_collapse: None,
    })
    .expect("send turn with no-match edit");

    let requests = server.finish();
    assert_eq!(requests.len(), 2, "expected two inference requests");
    let first_request = requests.first().expect("first request");
    let tool_names = first_request
        .get("tools")
        .and_then(Value::as_array)
        .expect("tools array")
        .iter()
        .filter_map(|tool| {
            tool.get("function")
                .and_then(|function| function.get("name"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect::<Vec<_>>();
    assert!(
        tool_names.iter().any(|name| name == "filesystem_edit"),
        "expected sanitized filesystem_edit in wire tools: {tool_names:?}"
    );
    let first_message = first_request
        .get("messages")
        .and_then(Value::as_array)
        .and_then(|messages| messages.first())
        .expect("first message");
    assert_eq!(
        first_message.get("role").and_then(Value::as_str),
        Some("system"),
        "first request message must be system prompt"
    );
    assert!(
        first_message
            .get("content")
            .and_then(Value::as_str)
            .is_some_and(|content| content.contains("You are Lyra")),
        "system prompt should include Lyra identity"
    );

    assert_eq!(result.turn.status, "completed");
    assert_eq!(result.tool_calls.len(), 1);
    let edit_tool = result.tool_calls.first().expect("edit tool call");
    assert_eq!(edit_tool.status, "completed");
    assert_eq!(edit_tool.tool_name, "filesystem.edit");
    assert!(edit_tool
        .output
        .as_ref()
        .and_then(|payload| payload.get("kind"))
        .and_then(Value::as_str)
        .is_some_and(|kind| kind == "no_match"));
    assert!(edit_tool.error_code.is_none());
    assert!(edit_tool.error_message.is_none());

    let assistant = result
        .assistant_message
        .expect("assistant fallback message");
    assert!(assistant.content.contains("oldText"));

    let detail = get_session(AgentGetSessionRequest {
        storage_root,
        session_id: session.id,
    })
    .expect("get session detail");
    let phases = detail
        .runtime_events
        .iter()
        .map(|event| event.phase.as_str())
        .collect::<Vec<_>>();
    assert!(
        phases.contains(&"tool_finished"),
        "expected tool_finished event, got {phases:?}"
    );
    assert!(
        phases.contains(&"completed"),
        "expected completed event, got {phases:?}"
    );
    assert!(
        phases.contains(&"prompt_compiled"),
        "expected prompt_compiled event, got {phases:?}"
    );
    assert!(
        phases.iter().all(|phase| *phase != "failed"),
        "turn should not be marked failed when edit returns no_match"
    );
}

#[test]
fn empty_provider_completion_fails_turn_instead_of_completing() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let server = MockOpenAiServer::start(vec![empty_stream_response()]);
    let profile_id = create_openai_compatible_profile(&storage_root, &server.base_url);

    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Empty provider response".to_string()),
        profile_id: Some(profile_id),
    })
    .expect("create session");

    let result = send_turn(AgentSendTurnRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
        input: "say hello".to_string(),
        profile_id: None,
        project_root: None,
        max_steps: Some(2),
        enable_planning: false,
        planning_min_chars: None,
        enable_reflection: false,
        reflection_min_tool_calls: None,
        enable_context_collapse: None,
    })
    .expect("send turn");

    let _requests = server.finish();
    assert_eq!(result.turn.status, "failed");
    assert_eq!(
        result.turn.error_code.as_deref(),
        Some(AGENT_PROVIDER_INVALID_RESPONSE)
    );
    assert!(result.tool_calls.is_empty());
    let assistant_message = result
        .assistant_message
        .as_ref()
        .expect("failure assistant message");
    assert!(
        assistant_message
            .content
            .contains(AGENT_PROVIDER_INVALID_RESPONSE),
        "expected failure assistant message to include structured error code: {}",
        assistant_message.content
    );

    let detail = get_session(AgentGetSessionRequest {
        storage_root,
        session_id: session.id,
    })
    .expect("get session detail");
    assert!(
        detail
            .runtime_events
            .iter()
            .all(|event| event.phase != "completed"),
        "empty provider response must not emit completed"
    );
}

#[test]
fn assistant_delta_events_are_transient_and_not_persisted() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();

    let response = format!(
        "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
        json!({
            "choices": [{
                "delta": {
                    "content": "Hello"
                }
            }]
        }),
        json!({
            "choices": [{
                "delta": {
                    "content": " Lyra"
                }
            }],
            "usage": {
                "prompt_tokens": 3,
                "completion_tokens": 2,
                "total_tokens": 5
            }
        })
    );
    let server = MockOpenAiServer::start(vec![response]);
    let profile_id = create_openai_compatible_profile(&storage_root, &server.base_url);

    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Assistant Delta".to_string()),
        profile_id: Some(profile_id),
    })
    .expect("create session");

    let result = send_turn(AgentSendTurnRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
        input: "say hello".to_string(),
        profile_id: None,
        project_root: None,
        max_steps: Some(2),
        enable_planning: false,
        planning_min_chars: None,
        enable_reflection: false,
        reflection_min_tool_calls: None,
        enable_context_collapse: None,
    })
    .expect("send turn");
    let _requests = server.finish();

    assert_eq!(result.turn.status, "completed");
    assert_eq!(
        result
            .assistant_message
            .as_ref()
            .map(|message| message.content.as_str()),
        Some("Hello Lyra")
    );

    let detail = get_session(AgentGetSessionRequest {
        storage_root,
        session_id: session.id,
    })
    .expect("get session detail");
    assert!(
        detail
            .runtime_events
            .iter()
            .all(|event| event.phase != "assistant_delta"),
        "assistant_delta must not be persisted in runtime_events"
    );
}

#[test]
fn latest_user_message_is_repeated_only_for_provider_input() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let server = MockOpenAiServer::start(vec![simple_stream_response("done")]);
    let profile_id = create_openai_compatible_profile(&storage_root, &server.base_url);

    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Prompt Repetition".to_string()),
        profile_id: Some(profile_id),
    })
    .expect("create session");

    let result = send_turn(AgentSendTurnRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
        input: "abc".to_string(),
        profile_id: None,
        project_root: None,
        max_steps: Some(2),
        enable_planning: false,
        planning_min_chars: None,
        enable_reflection: false,
        reflection_min_tool_calls: None,
        enable_context_collapse: None,
    })
    .expect("send turn");

    assert_eq!(result.turn.status, "completed");
    let requests = server.finish();
    let first_request = requests.first().expect("first request");
    let last_message = first_request
        .get("messages")
        .and_then(Value::as_array)
        .and_then(|messages| messages.last())
        .expect("last provider message");
    assert_eq!(
        last_message.get("content").and_then(Value::as_str),
        Some("abc\n\nabc")
    );

    let detail = get_session(AgentGetSessionRequest {
        storage_root,
        session_id: session.id,
    })
    .expect("get session detail");
    assert_eq!(
        detail
            .messages
            .iter()
            .rev()
            .find(|message| message.role == "user")
            .map(|message| message.content.as_str()),
        Some("abc")
    );
    let main_postprocess = detail
        .runtime_events
        .iter()
        .find(|event| event.phase == "input_postprocessed")
        .expect("input_postprocessed event");
    assert_eq!(
        main_postprocess
            .payload
            .get("target")
            .and_then(Value::as_str),
        Some("main")
    );
    assert_eq!(
        main_postprocess.payload.get("mode").and_then(Value::as_str),
        Some("full_double")
    );
}

#[test]
fn planning_request_uses_repeated_input() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let planning_response = simple_stream_response("1. Inspect\n2. Fix");
    let final_response = simple_stream_response("done");
    let server = MockOpenAiServer::start(vec![planning_response, final_response]);
    let profile_id = create_openai_compatible_profile(&storage_root, &server.base_url);

    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Planning Repetition".to_string()),
        profile_id: Some(profile_id),
    })
    .expect("create session");

    let input =
        "Please inspect this repository carefully and produce a concrete implementation plan for fixing the failing integration tests without touching unrelated files.";
    let result = send_turn(AgentSendTurnRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
        input: input.to_string(),
        profile_id: None,
        project_root: None,
        max_steps: Some(2),
        enable_planning: true,
        planning_min_chars: Some(100),
        enable_reflection: false,
        reflection_min_tool_calls: None,
        enable_context_collapse: None,
    })
    .expect("send turn");

    assert_eq!(result.turn.status, "completed");
    let requests = server.finish();
    assert_eq!(requests.len(), 2, "expected planning + main requests");
    let planning_request = requests.first().expect("planning request");
    let planning_message = planning_request
        .get("messages")
        .and_then(Value::as_array)
        .and_then(|messages| messages.get(1))
        .expect("planning user message");
    let planning_content = planning_message
        .get("content")
        .and_then(Value::as_str)
        .expect("planning content");
    assert!(planning_content.contains("[Lyra Internal Planning Module]"));
    assert!(planning_content.matches(input).count() >= 2);

    let detail = get_session(AgentGetSessionRequest {
        storage_root,
        session_id: session.id,
    })
    .expect("get session detail");
    assert!(
        detail.runtime_events.iter().any(|event| {
            event.phase == "input_postprocessed"
                && event.payload.get("target").and_then(Value::as_str) == Some("planning")
        }),
        "expected planning input_postprocessed event"
    );
}

#[test]
fn planning_injects_only_structured_steps_into_main_request() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let planning_response = simple_stream_response(
        "我需要理解用户请求，并模拟这个过程。\n虽然我无法直接操作浏览器，但我可以模拟界面。\n\n计划：\n1. 先读取当前页面状态\n2. 定位相关控件\n3. 执行需要的页面操作",
    );
    let final_response = simple_stream_response("done");
    let server = MockOpenAiServer::start(vec![planning_response, final_response]);
    let profile_id = create_openai_compatible_profile(&storage_root, &server.base_url);

    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Planning Sanitization".to_string()),
        profile_id: Some(profile_id),
    })
    .expect("create session");

    let result = send_turn(AgentSendTurnRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
        input: "请在我打开的网页里执行操作".to_string(),
        profile_id: None,
        project_root: None,
        max_steps: Some(2),
        enable_planning: true,
        planning_min_chars: Some(1),
        enable_reflection: false,
        reflection_min_tool_calls: None,
        enable_context_collapse: None,
    })
    .expect("send turn");

    assert_eq!(result.turn.status, "completed");
    let requests = server.finish();
    assert_eq!(requests.len(), 2, "expected planning + main requests");
    let main_request = requests.get(1).expect("main request");
    let plan_message = main_request
        .get("messages")
        .and_then(Value::as_array)
        .and_then(|messages| {
            messages.iter().find(|message| {
                message
                    .get("content")
                    .and_then(Value::as_str)
                    .is_some_and(|content| content.starts_with("[Plan]\n"))
            })
        })
        .expect("main request plan message");
    let plan_content = plan_message
        .get("content")
        .and_then(Value::as_str)
        .expect("plan content");
    assert!(plan_content.contains("1. 先读取当前页面状态"));
    assert!(plan_content.contains("2. 定位相关控件"));
    assert!(plan_content.contains("3. 执行需要的页面操作"));
    assert!(!plan_content.contains("虽然我无法直接操作浏览器"));
    assert!(!plan_content.contains("模拟界面"));
}

fn long_input_degrades_repetition_under_tight_budget() {
    let _guard = ENV_TEST_GUARD.lock().expect("lock env test guard");
    let _window = EnvVarReset::set("LYRA_CONTEXT_WINDOW", "40000");

    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let server = MockOpenAiServer::start(vec![simple_stream_response("done")]);
    let profile_id = create_openai_compatible_profile(&storage_root, &server.base_url);

    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Budgeted Repetition".to_string()),
        profile_id: Some(profile_id),
    })
    .expect("create session");

    let input = "long log line ".repeat(3_200);
    let result = send_turn(AgentSendTurnRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
        input: input.clone(),
        profile_id: None,
        project_root: None,
        max_steps: Some(2),
        enable_planning: false,
        planning_min_chars: None,
        enable_reflection: false,
        reflection_min_tool_calls: None,
        enable_context_collapse: None,
    })
    .expect("send turn");

    assert_eq!(result.turn.status, "completed");
    let requests = server.finish();
    let first_request = requests.first().expect("first request");
    let last_message = first_request
        .get("messages")
        .and_then(Value::as_array)
        .and_then(|messages| messages.last())
        .expect("last provider message");
    let provider_input = last_message
        .get("content")
        .and_then(Value::as_str)
        .expect("provider content");
    assert_ne!(provider_input, format!("{input}\n\n{input}"));
    assert!(provider_input.contains("Re-read the latest request carefully."));

    let detail = get_session(AgentGetSessionRequest {
        storage_root,
        session_id: session.id,
    })
    .expect("get session detail");
    assert!(
        detail.runtime_events.iter().any(|event| {
            event.phase == "input_postprocessed"
                && event.payload.get("target").and_then(Value::as_str) == Some("main")
                && event.payload.get("mode").and_then(Value::as_str) == Some("anchor_only")
        }),
        "expected anchor_only main input_postprocessed event"
    );
}

#[test]
fn auto_compact_rebuilds_current_task_anchor_after_summary() {
    let _guard = ENV_TEST_GUARD.lock().expect("lock env test guard");
    let _window = EnvVarReset::set("LYRA_CONTEXT_WINDOW", "45000");

    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let compact_response = simple_stream_response(
        "<summary>Earlier work was summarized and the task is still active.</summary>",
    );
    let final_response = simple_stream_response("done");
    let server = MockOpenAiServer::start(vec![compact_response, final_response]);
    let profile_id = create_openai_compatible_profile(&storage_root, &server.base_url);

    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Post Compact Anchor".to_string()),
        profile_id: Some(profile_id),
    })
    .expect("create session");

    let input = "critical task detail ".repeat(5_000);
    let result = send_turn(AgentSendTurnRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
        input,
        profile_id: None,
        project_root: None,
        max_steps: Some(2),
        enable_planning: false,
        planning_min_chars: None,
        enable_reflection: false,
        reflection_min_tool_calls: None,
        enable_context_collapse: None,
    })
    .expect("send turn");

    assert_eq!(result.turn.status, "completed");
    let requests = server.finish();
    assert_eq!(requests.len(), 2, "expected auto-compact + final inference");
    let final_request = requests.get(1).expect("final request");
    let final_messages = final_request
        .get("messages")
        .and_then(Value::as_array)
        .expect("final request messages");
    assert!(
        final_messages.iter().any(|message| {
            message
                .get("content")
                .and_then(Value::as_str)
                .is_some_and(|content| content.contains("<context_boundary>"))
        }),
        "expected compact boundary marker"
    );
    assert!(
        final_messages.iter().any(|message| {
            message
                .get("content")
                .and_then(Value::as_str)
                .is_some_and(|content| content.contains("Current task anchor:"))
        }),
        "expected post-compact task anchor"
    );

    let detail = get_session(AgentGetSessionRequest {
        storage_root,
        session_id: session.id,
    })
    .expect("get session detail");
    assert!(
        detail.runtime_events.iter().any(|event| {
            event.phase == "input_postprocessed"
                && event.payload.get("target").and_then(Value::as_str)
                    == Some("post_compact_anchor")
        }),
        "expected post_compact_anchor event"
    );
}

#[test]
fn repeated_tool_loop_pauses_turn_without_fixed_step_limit() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();

    let tool_arguments = json!({
        "pattern": "hello",
        "path": storage_root,
        "limit": 5,
    })
    .to_string();
    let repeated_response = format!(
        "data: {}\n\ndata: [DONE]\n\n",
        json!({
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_search_1",
                        "type": "function",
                        "function": {
                            "name": "filesystem_search",
                            "arguments": tool_arguments,
                        }
                    }]
                }
            }]
        })
    );
    let server = MockOpenAiServer::start(vec![
        repeated_response.clone(),
        repeated_response.clone(),
        repeated_response,
    ]);
    let profile_id = create_openai_compatible_profile(&storage_root, &server.base_url);

    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Repeated Tool Loop".to_string()),
        profile_id: Some(profile_id),
    })
    .expect("create session");

    let result = send_turn(AgentSendTurnRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
        input: "keep searching forever".to_string(),
        profile_id: None,
        project_root: None,
        max_steps: None,
        enable_planning: false,
        planning_min_chars: None,
        enable_reflection: false,
        reflection_min_tool_calls: None,
        enable_context_collapse: None,
    })
    .expect("send turn");

    let requests = server.finish();
    assert_eq!(requests.len(), 3, "expected three inference attempts");
    assert_eq!(result.turn.status, "paused");
    assert!(
        result
            .assistant_message
            .as_ref()
            .is_some_and(|message| message.content.contains("paused")),
        "expected paused assistant explanation"
    );

    let detail = get_session(AgentGetSessionRequest {
        storage_root,
        session_id: session.id,
    })
    .expect("get session detail");
    let phases = detail
        .runtime_events
        .iter()
        .map(|event| event.phase.as_str())
        .collect::<Vec<_>>();
    assert!(
        phases.contains(&"paused"),
        "expected paused phase, got {phases:?}"
    );
    assert!(
        phases.iter().all(|phase| *phase != "failed"),
        "paused turn should not be marked failed"
    );
}

#[test]
fn simple_observation_turn_uses_standard_strategy_without_language_routing() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let server = MockOpenAiServer::start(vec![simple_stream_response("Looks healthy.")]);
    let profile_id = create_openai_compatible_profile(&storage_root, &server.base_url);

    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Observation Fast Path".to_string()),
        profile_id: Some(profile_id),
    })
    .expect("create session");

    let result = send_turn(AgentSendTurnRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
        input: "看一下电脑现在状态怎么样".to_string(),
        profile_id: None,
        project_root: None,
        max_steps: None,
        enable_planning: false,
        planning_min_chars: None,
        enable_reflection: false,
        reflection_min_tool_calls: None,
        enable_context_collapse: None,
    })
    .expect("send turn");

    assert_eq!(result.turn.status, "completed");
    let requests = server.finish();
    assert_eq!(
        requests.len(),
        1,
        "observation fast path should skip planning"
    );
    let first_request = requests.first().expect("first request");
    let system_prompt = first_request
        .get("messages")
        .and_then(Value::as_array)
        .and_then(|messages| messages.first())
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .expect("system prompt");
    assert!(system_prompt.contains("## Turn Strategy"));
    assert!(system_prompt.contains("standard execution"));
    assert!(!system_prompt.contains("bounded observational fast path"));

    let detail = get_session(AgentGetSessionRequest {
        storage_root,
        session_id: session.id,
    })
    .expect("get session detail");
    assert!(
        detail.runtime_events.iter().any(|event| {
            event.phase == "turn_strategy_selected"
                && event.payload.get("strategy").and_then(Value::as_str)
                    == Some("standard_execution")
        }),
        "expected standard_execution runtime event"
    );
}

#[test]
fn oversized_active_skills_are_truncated_but_turn_succeeds() {
    let _guard = SKILL_PROMPTS_TEST_GUARD
        .lock()
        .expect("lock skill prompts guard");
    set_skill_prompts(vec![SkillPromptEntry {
        skill_id: "skill.long".to_string(),
        name: "Long Skill".to_string(),
        content: "x".repeat(40_000),
    }]);
    struct SkillPromptsReset;
    impl Drop for SkillPromptsReset {
        fn drop(&mut self) {
            set_skill_prompts(Vec::new());
        }
    }
    let _reset = SkillPromptsReset;

    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let response = format!(
        "data: {}\n\ndata: [DONE]\n\n",
        json!({
            "choices": [{
                "delta": {
                    "content": "done"
                }
            }],
            "usage": {
                "prompt_tokens": 8,
                "completion_tokens": 2,
                "total_tokens": 10
            }
        })
    );
    let server = MockOpenAiServer::start(vec![response]);
    let profile_id = create_openai_compatible_profile(&storage_root, &server.base_url);

    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Prompt Truncation".to_string()),
        profile_id: Some(profile_id),
    })
    .expect("create session");

    let result = send_turn(AgentSendTurnRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
        input: "say done".to_string(),
        profile_id: None,
        project_root: None,
        max_steps: Some(2),
        enable_planning: false,
        planning_min_chars: None,
        enable_reflection: false,
        reflection_min_tool_calls: None,
        enable_context_collapse: None,
    })
    .expect("send turn");

    let requests = server.finish();
    assert_eq!(result.turn.status, "completed");
    let first_request = requests.first().expect("first request");
    let first_message = first_request
        .get("messages")
        .and_then(Value::as_array)
        .and_then(|messages| messages.first())
        .expect("first message");
    assert_eq!(
        first_message.get("role").and_then(Value::as_str),
        Some("system")
    );
    assert!(
        first_message
            .get("content")
            .and_then(Value::as_str)
            .is_some_and(|content| content.contains("[truncated]")),
        "expected truncated marker in system prompt"
    );

    let detail = get_session(AgentGetSessionRequest {
        storage_root,
        session_id: session.id,
    })
    .expect("get session detail");
    let prompt_compiled = detail
        .runtime_events
        .iter()
        .find(|event| event.phase == "prompt_compiled")
        .expect("prompt_compiled event");
    assert_eq!(
        prompt_compiled
            .payload
            .get("truncated")
            .and_then(Value::as_bool),
        Some(true)
    );
    let truncated_sections = prompt_compiled
        .payload
        .get("truncatedSections")
        .and_then(Value::as_array)
        .expect("truncatedSections array");
    assert!(
        truncated_sections
            .iter()
            .filter_map(Value::as_str)
            .any(|section| section == "activated_skill_prompts"),
        "expected activated_skill_prompts in truncated sections: {truncated_sections:?}"
    );
}

#[test]
fn plan_mode_resets_stale_draft_when_project_root_changes() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let old_root = std::path::PathBuf::from(&storage_root).join("old-project");
    let new_root = std::path::PathBuf::from(&storage_root).join("website");
    std::fs::create_dir_all(&old_root).expect("create old project root");
    std::fs::create_dir_all(&new_root).expect("create new project root");

    let response = simple_stream_response(
        "<proposed_plan>\n# New Website Plan\n- Audit the bound project root\n- Define the company-site information architecture\n- Implement the approved homepage after review\n</proposed_plan>",
    );
    let server = MockOpenAiServer::start(vec![response]);
    let profile_id = create_openai_compatible_profile(&storage_root, &server.base_url);

    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Plan Project Switch".to_string()),
        profile_id: Some(profile_id),
    })
    .expect("create session");

    bind_session_project(AgentBindSessionProjectRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
        project_root: old_root.to_string_lossy().to_string(),
    })
    .expect("bind old root");
    enter_plan_mode(AgentEnterPlanModeRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
    })
    .expect("enter plan mode");

    registry_db::upsert_agent_plan(
        &storage_root,
        &session.id,
        &AgentPlanState {
            status: AgentPlanStatus::Draft,
            version: 4,
            draft_markdown: format!("Inspect the old app at {}", old_root.to_string_lossy()),
            proposed_markdown: None,
            approved_markdown: None,
            last_submitted_version: None,
            updated_at: 1,
        },
    )
    .expect("seed stale plan");

    let result = send_turn(AgentSendTurnRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
        input: "帮我做一个公司官网".to_string(),
        profile_id: None,
        project_root: Some(new_root.to_string_lossy().to_string()),
        max_steps: Some(2),
        enable_planning: false,
        planning_min_chars: None,
        enable_reflection: false,
        reflection_min_tool_calls: None,
        enable_context_collapse: None,
    })
    .expect("send plan turn");

    assert_eq!(result.turn.status, "completed");
    let _requests = server.finish();

    let detail = get_session(AgentGetSessionRequest {
        storage_root,
        session_id: session.id,
    })
    .expect("get session detail");
    let plan = detail.plan.expect("plan state");
    assert_eq!(plan.status, AgentPlanStatus::Submitted);
    assert_eq!(plan.version, 1);
    assert!(
        !plan
            .draft_markdown
            .contains(&old_root.to_string_lossy().to_string()),
        "stale project path should be cleared from the refreshed draft"
    );
    assert!(
        plan.draft_markdown.contains("New Website Plan"),
        "new project scope should produce a fresh plan instead of keeping the stale draft"
    );
}

#[test]
fn proposed_plan_text_creates_pending_plan_approval() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let response = simple_stream_response(
        "<proposed_plan>\n# Company Website Plan\n- Audit the current repo\n- Define the information architecture\n- Implement the approved homepage sections\n</proposed_plan>",
    );
    let server = MockOpenAiServer::start(vec![response]);
    let profile_id = create_openai_compatible_profile(&storage_root, &server.base_url);

    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Plan fallback".to_string()),
        profile_id: Some(profile_id),
    })
    .expect("create session");

    enter_plan_mode(AgentEnterPlanModeRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
    })
    .expect("enter plan mode");

    let result = send_turn(AgentSendTurnRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
        input: "帮我做一个公司官网".to_string(),
        profile_id: None,
        project_root: None,
        max_steps: Some(2),
        enable_planning: false,
        planning_min_chars: None,
        enable_reflection: false,
        reflection_min_tool_calls: None,
        enable_context_collapse: None,
    })
    .expect("send plan turn");

    assert_eq!(result.turn.status, "completed");
    let _requests = server.finish();

    let detail = get_session(AgentGetSessionRequest {
        storage_root,
        session_id: session.id,
    })
    .expect("get session detail");
    let pending = detail
        .pending_interactions
        .iter()
        .filter(|interaction| {
            interaction.kind == AgentPendingInteractionKind::PlanApproval
                && interaction.status == AgentPendingInteractionStatus::Pending
        })
        .collect::<Vec<_>>();
    assert_eq!(
        pending.len(),
        1,
        "expected synthesized plan approval interaction"
    );
    assert!(pending[0]
        .payload
        .get("proposedMarkdown")
        .and_then(Value::as_str)
        .is_some_and(|value| value.contains("Company Website Plan")));
    assert_eq!(
        detail.plan.as_ref().map(|plan| plan.status.clone()),
        Some(AgentPlanStatus::Submitted)
    );
    let phases = detail
        .runtime_events
        .iter()
        .map(|event| event.phase.as_str())
        .collect::<Vec<_>>();
    assert!(phases.contains(&"interaction_pending"));
    assert!(phases.contains(&"interaction_queue_updated"));
    assert!(phases.contains(&"plan_approval_requested"));
}

#[test]
fn request_user_input_round_trips_through_pending_interaction() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let question_arguments = json!({
        "questions": [{
            "id": "site_style",
            "header": "Style",
            "question": "Which visual direction should the company site use?",
            "options": [
                {
                    "label": "Corporate (Recommended)",
                    "description": "Structured, sober, and credibility-first."
                },
                {
                    "label": "Bold",
                    "description": "More expressive and marketing-driven."
                }
            ]
        }],
        "allowNote": true
    })
    .to_string();
    let first_response = format!(
        "data: {}\n\ndata: [DONE]\n\n",
        json!({
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_question_1",
                        "type": "function",
                        "function": {
                            "name": "request_user_input",
                            "arguments": question_arguments,
                        }
                    }]
                }
            }]
        })
    );
    let second_response = simple_stream_response("收到，我会按 Corporate 风格继续规划。");
    let server = MockOpenAiServer::start(vec![first_response, second_response]);
    let profile_id = create_openai_compatible_profile(&storage_root, &server.base_url);

    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Question round trip".to_string()),
        profile_id: Some(profile_id),
    })
    .expect("create session");

    let storage_root_for_turn = storage_root.clone();
    let session_id_for_turn = session.id.clone();
    let turn_handle = thread::spawn(move || {
        send_turn(AgentSendTurnRequest {
            storage_root: storage_root_for_turn,
            session_id: session_id_for_turn,
            input: "帮我规划一个官网".to_string(),
            profile_id: None,
            project_root: None,
            max_steps: Some(3),
            enable_planning: false,
            planning_min_chars: None,
            enable_reflection: false,
            reflection_min_tool_calls: None,
            enable_context_collapse: None,
        })
    });

    let (turn_id, request_id) = loop {
        let detail = get_session(AgentGetSessionRequest {
            storage_root: storage_root.clone(),
            session_id: session.id.clone(),
        })
        .expect("get session detail");
        if let Some(interaction) = detail.pending_interactions.iter().find(|interaction| {
            interaction.kind == AgentPendingInteractionKind::UserQuestion
                && interaction.status == AgentPendingInteractionStatus::Pending
        }) {
            break (interaction.turn_id.clone(), interaction.id.clone());
        }
        thread::sleep(Duration::from_millis(25));
    };

    answer_question(AgentAnswerQuestionRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
        turn_id,
        request_id,
        answers: json!({
            "site_style": {
                "label": "Corporate (Recommended)"
            }
        }),
        note: Some("偏稳重，中文站".to_string()),
    })
    .expect("answer question");

    let result = turn_handle
        .join()
        .expect("join send turn thread")
        .expect("send turn result");
    assert_eq!(result.turn.status, "completed");
    assert!(
        result
            .assistant_message
            .as_ref()
            .is_some_and(|message| message.content.contains("Corporate")),
        "expected assistant to continue after answering the structured question"
    );

    let detail = get_session(AgentGetSessionRequest {
        storage_root,
        session_id: session.id,
    })
    .expect("get session detail");
    assert!(
        detail.pending_interactions.iter().all(|interaction| {
            interaction.kind != AgentPendingInteractionKind::UserQuestion
                || interaction.status != AgentPendingInteractionStatus::Pending
        }),
        "question interaction should be resolved after answering"
    );

    let _requests = server.finish();
}

#[test]
fn command_approval_allow_always_unblocks_current_turn_without_project_root() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let command_arguments = json!({
        "command": "printf 'approval-roundtrip\\n'"
    })
    .to_string();
    let first_response = format!(
        "data: {}\n\ndata: [DONE]\n\n",
        json!({
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_terminal_1",
                        "type": "function",
                        "function": {
                            "name": "terminal_exec",
                            "arguments": command_arguments,
                        }
                    }]
                }
            }]
        })
    );
    let second_response = simple_stream_response("command completed after approval");
    let server = MockOpenAiServer::start(vec![first_response, second_response]);
    let profile_id = create_openai_compatible_profile(&storage_root, &server.base_url);

    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Command approval allow always".to_string()),
        profile_id: Some(profile_id),
    })
    .expect("create session");

    let storage_root_for_turn = storage_root.clone();
    let session_id_for_turn = session.id.clone();
    let turn_handle = thread::spawn(move || {
        send_turn(AgentSendTurnRequest {
            storage_root: storage_root_for_turn,
            session_id: session_id_for_turn,
            input: "run a simple terminal command".to_string(),
            profile_id: None,
            project_root: None,
            max_steps: Some(3),
            enable_planning: false,
            planning_min_chars: None,
            enable_reflection: false,
            reflection_min_tool_calls: None,
            enable_context_collapse: None,
        })
    });

    let (turn_id, tool_call_id) = loop {
        let detail = get_session(AgentGetSessionRequest {
            storage_root: storage_root.clone(),
            session_id: session.id.clone(),
        })
        .expect("get session detail");
        if let Some(interaction) = detail.pending_interactions.iter().find(|interaction| {
            interaction.kind == AgentPendingInteractionKind::CommandApproval
                && interaction.status == AgentPendingInteractionStatus::Pending
        }) {
            break (interaction.turn_id.clone(), interaction.id.clone());
        }
        thread::sleep(Duration::from_millis(25));
    };

    submit_command_approval(CommandApprovalSubmitRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
        turn_id,
        tool_call_id,
        decision: "allow_always".to_string(),
    })
    .expect("submit command approval");

    let result = turn_handle
        .join()
        .expect("join send turn thread")
        .expect("send turn result");
    assert_eq!(result.turn.status, "completed");
    assert!(
        result
            .assistant_message
            .as_ref()
            .is_some_and(|message| message.content.contains("completed")),
        "expected assistant to continue after approval"
    );
    assert!(
        result
            .tool_calls
            .iter()
            .any(|call| { call.tool_name == "terminal.exec" && call.status == "completed" }),
        "terminal.exec should complete after allow_always"
    );
    assert!(
        result
            .tool_calls
            .iter()
            .all(|call| { call.error_code.as_deref() != Some("AGENT_TOOL_APPROVAL_REQUIRED") }),
        "allow_always should not leave approval-required failure in final tool calls"
    );

    let detail = get_session(AgentGetSessionRequest {
        storage_root,
        session_id: session.id,
    })
    .expect("get session detail");
    assert!(
        detail.pending_interactions.iter().all(|interaction| {
            interaction.kind != AgentPendingInteractionKind::CommandApproval
                || interaction.status != AgentPendingInteractionStatus::Pending
        }),
        "command approval interaction should be resolved after allowing"
    );
    assert!(
        detail
            .runtime_events
            .iter()
            .all(|event| event.phase != "paused"),
        "turn should not pause after allow_always"
    );

    let _requests = server.finish();
}

#[test]
fn plan_mode_plain_text_without_structured_interaction_pauses_after_retry() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let server = MockOpenAiServer::start(vec![
        simple_stream_response("我需要先确认一些关键信息，然后再制定计划。"),
        simple_stream_response("在拿到这些信息前我还不能提交计划。"),
    ]);
    let profile_id = create_openai_compatible_profile(&storage_root, &server.base_url);

    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Plan enforcement".to_string()),
        profile_id: Some(profile_id),
    })
    .expect("create session");

    enter_plan_mode(AgentEnterPlanModeRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
    })
    .expect("enter plan mode");

    let result = send_turn(AgentSendTurnRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
        input: "帮我做一个公司官网".to_string(),
        profile_id: None,
        project_root: None,
        max_steps: Some(3),
        enable_planning: false,
        planning_min_chars: None,
        enable_reflection: false,
        reflection_min_tool_calls: None,
        enable_context_collapse: None,
    })
    .expect("send plan turn");

    assert_eq!(result.turn.status, "paused");
    let requests = server.finish();
    assert_eq!(requests.len(), 2, "expected one enforcement retry request");

    let second_request = requests.get(1).expect("second request");
    let second_messages = second_request
        .get("messages")
        .and_then(Value::as_array)
        .expect("second request messages");
    let enforcement_message = second_messages
        .last()
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .expect("enforcement user message");
    assert!(
        enforcement_message.contains("Plan Mode Enforcement"),
        "expected plan enforcement prompt in retry request: {enforcement_message}"
    );

    let detail = get_session(AgentGetSessionRequest {
        storage_root,
        session_id: session.id,
    })
    .expect("get session detail");
    assert!(
        detail.pending_interactions.is_empty(),
        "plain-text plan drift should pause instead of fabricating pending interactions"
    );
}
