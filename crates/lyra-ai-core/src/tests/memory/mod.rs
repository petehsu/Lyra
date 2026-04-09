use std::collections::BTreeMap;
use std::fs::read_to_string;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde_json::{json, Value};

use crate::agent::service::create_session;
use crate::agent::types::AgentCreateSessionRequest;
use crate::memory::{
    append_session_dialog_message, get_config, run_scheduler_tick, update_config,
    GetAiMemoryConfigRequest, UpdateAiMemoryConfigRequest,
};
use crate::paths::resolve_ai_paths;
use crate::profile::service::upsert_profile;
use crate::profile::types::UpsertAiProfileRequest;
use crate::storage::registry_db;
use crate::tests::support::TempStorageRoot;

struct MockOpenAiServer {
    base_url: String,
    requests: Arc<Mutex<Vec<Value>>>,
    shutdown: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl MockOpenAiServer {
    fn start(responses: Vec<String>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock openai server");
        listener
            .set_nonblocking(true)
            .expect("set mock listener nonblocking");
        let addr = listener.local_addr().expect("mock server local addr");
        let requests = Arc::new(Mutex::new(Vec::<Value>::new()));
        let requests_for_thread = Arc::clone(&requests);
        let shutdown = Arc::new(AtomicBool::new(false));
        let shutdown_for_thread = Arc::clone(&shutdown);
        let handle = thread::spawn(move || {
            for response in responses {
                loop {
                    if shutdown_for_thread.load(Ordering::Relaxed) {
                        return;
                    }
                    match listener.accept() {
                        Ok((stream, _)) => {
                            handle_connection(stream, &requests_for_thread, &response);
                            break;
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(10));
                        }
                        Err(error) => panic!("accept mock request: {error}"),
                    }
                }
            }
        });
        Self {
            base_url: format!("http://{addr}"),
            requests,
            shutdown,
            handle: Some(handle),
        }
    }

    fn finish(mut self) -> Vec<Value> {
        self.shutdown.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            handle.join().expect("join mock server");
        }
        self.requests.lock().expect("lock mock requests").clone()
    }
}

fn handle_connection(stream: TcpStream, requests: &Arc<Mutex<Vec<Value>>>, response: &str) {
    stream
        .set_nonblocking(false)
        .expect("set accepted mock stream blocking");
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
        name: "Memory Analysis".to_string(),
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

#[test]
fn create_session_bootstraps_memory_storage_layout() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();

    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Memory Layout".to_string()),
        profile_id: None,
    })
    .expect("create session");

    let paths = resolve_ai_paths(&storage_root).expect("resolve ai paths");
    let session_root = paths.sessions_root.join(&session.id);
    assert!(session_root.join("session.sqlite").exists());
    assert!(session_root.join("cuts").exists());
    assert!(paths.shared_root.join("shared_memory.md").exists());
    assert!(paths.shared_root.join("frozen_memory.md").exists());
    assert!(paths.runtime_root.join("memory_config.json").exists());
    assert!(paths.runtime_root.join("memory_jobs.sqlite").exists());
    assert!(paths.runtime_root.join("prompt_cache.sqlite").exists());
}

#[test]
fn memory_config_round_trips() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();

    let default_config = get_config(GetAiMemoryConfigRequest {
        storage_root: storage_root.clone(),
    })
    .expect("get default memory config");
    assert_eq!(default_config.default_context_window, 200_000);

    let updated = update_config(UpdateAiMemoryConfigRequest {
        storage_root: storage_root.clone(),
        config: crate::memory::AiMemoryConfig {
            memory_analysis_profile_id: Some("memory-profile".to_string()),
            default_context_window: 200_000,
            ..default_config.clone()
        },
    })
    .expect("update memory config");

    assert_eq!(updated.default_context_window, 200_000);
    assert_eq!(
        updated.memory_analysis_profile_id.as_deref(),
        Some("memory-profile")
    );

    let reloaded =
        get_config(GetAiMemoryConfigRequest { storage_root }).expect("reload memory config");
    assert_eq!(reloaded.default_context_window, 200_000);
    assert_eq!(
        reloaded.memory_analysis_profile_id.as_deref(),
        Some("memory-profile")
    );
}

#[test]
fn scheduler_uses_memory_analysis_profile_for_shared_updates() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let response = format!(
        "data: {}\n\ndata: [DONE]\n\n",
        json!({
            "choices": [{
                "delta": {
                    "content": "{\"accepted\":true,\"layer\":\"shared\",\"scope\":\"global\",\"content\":\"User prefers Rust-first changes and runs cargo check before deeper validation.\",\"score\":0.94,\"updateMode\":\"merge\"}"
                }
            }]
        })
    );
    let server = MockOpenAiServer::start(vec![response]);
    let analysis_profile_id = create_openai_compatible_profile(&storage_root, &server.base_url);

    let default_config = get_config(GetAiMemoryConfigRequest {
        storage_root: storage_root.clone(),
    })
    .expect("load default config");
    update_config(UpdateAiMemoryConfigRequest {
        storage_root: storage_root.clone(),
        config: crate::memory::AiMemoryConfig {
            memory_analysis_profile_id: Some(analysis_profile_id.clone()),
            enable_model_guided_compaction: true,
            ..default_config
        },
    })
    .expect("update memory config");

    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Memory Analysis Session".to_string()),
        profile_id: Some(analysis_profile_id.clone()),
    })
    .expect("create session");
    let turn = registry_db::create_agent_turn(&storage_root, &session.id, &analysis_profile_id)
        .expect("create agent turn");
    append_session_dialog_message(
        &storage_root,
        &session.id,
        "memory-message-1",
        "user",
        "Please remember that I prefer Rust-first changes and cargo check before anything deeper.",
        Some(&turn.id),
        None,
    )
    .expect("append dialog message");

    let processed = run_scheduler_tick(&storage_root).expect("run scheduler");
    let requests = server.finish();
    assert_eq!(processed, 1);
    assert_eq!(requests.len(), 1, "expected one memory analysis request");

    let paths = resolve_ai_paths(&storage_root).expect("resolve ai paths");
    let shared_memory = read_to_string(paths.shared_root.join("shared_memory.md"))
        .expect("read shared memory markdown");
    assert!(
        shared_memory.contains(
            "User prefers Rust-first changes and runs cargo check before deeper validation."
        ),
        "shared memory should contain model-canonicalized text: {shared_memory}"
    );
}

#[test]
fn scheduler_runs_model_guided_compaction_and_writes_deprecations() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let mut responses = Vec::new();
    for index in 0..6 {
        responses.push(format!(
            "data: {}\n\ndata: [DONE]\n\n",
            json!({
                "choices": [{
                    "delta": {
                        "content": format!(
                            "{{\"accepted\":true,\"layer\":\"shared\",\"scope\":\"global\",\"content\":\"Rust workflow preference {} with cargo check first.\",\"score\":0.9,\"updateMode\":\"merge\"}}",
                            index + 1
                        )
                    }
                }]
            })
        ));
    }
    responses.push(format!(
        "data: {}\n\ndata: [DONE]\n\n",
        json!({
            "choices": [{
                "delta": {
                    "content": "{\"items\":[{\"content\":\"Prefer a Rust-first workflow and run cargo check before deeper validation.\",\"score\":0.98},{\"content\":\"Keep edits aligned with the existing project conventions.\",\"score\":0.9}]}"
                }
            }]
        })
    ));
    let server = MockOpenAiServer::start(responses);
    let analysis_profile_id = create_openai_compatible_profile(&storage_root, &server.base_url);

    let default_config = get_config(GetAiMemoryConfigRequest {
        storage_root: storage_root.clone(),
    })
    .expect("load default config");
    update_config(UpdateAiMemoryConfigRequest {
        storage_root: storage_root.clone(),
        config: crate::memory::AiMemoryConfig {
            memory_analysis_profile_id: Some(analysis_profile_id.clone()),
            enable_model_guided_compaction: true,
            ..default_config
        },
    })
    .expect("update memory config");

    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Memory Compaction Session".to_string()),
        profile_id: Some(analysis_profile_id.clone()),
    })
    .expect("create session");
    let turn = registry_db::create_agent_turn(&storage_root, &session.id, &analysis_profile_id)
        .expect("create agent turn");

    for index in 0..6 {
        append_session_dialog_message(
            &storage_root,
            &session.id,
            &format!("memory-compaction-message-{index}"),
            "user",
            &format!(
                "Always remember Rust workflow preference {} and cargo check first.",
                index + 1
            ),
            Some(&turn.id),
            None,
        )
        .expect("append compaction seed message");
    }

    let first_tick = run_scheduler_tick(&storage_root).expect("run first scheduler tick");
    let second_tick = run_scheduler_tick(&storage_root).expect("run second scheduler tick");
    let third_tick = run_scheduler_tick(&storage_root).expect("run third scheduler tick");
    let requests = server.finish();
    assert_eq!(first_tick, 3);
    assert_eq!(second_tick, 3);
    assert_eq!(third_tick, 1);
    assert_eq!(
        requests.len(),
        7,
        "expected six analysis calls plus one compaction call"
    );

    let paths = resolve_ai_paths(&storage_root).expect("resolve ai paths");
    let shared_memory = read_to_string(paths.shared_root.join("shared_memory.md"))
        .expect("read compacted shared memory markdown");
    assert!(
        shared_memory
            .contains("Prefer a Rust-first workflow and run cargo check before deeper validation."),
        "expected compacted canonical entry: {shared_memory}"
    );
    assert!(
        !shared_memory.contains("workflow preference 6"),
        "compaction should remove individual noisy entries: {shared_memory}"
    );

    let audit = read_to_string(paths.shared_root.join("shared_memory.audit.jsonl"))
        .expect("read shared memory audit");
    assert!(
        audit.contains("\"action\":\"deprecate\""),
        "expected deprecate audit entries after compaction: {audit}"
    );
}
