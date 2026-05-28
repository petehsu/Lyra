use super::*;
use crate::agent::environment::EnvSnapshotDetail;
use crate::message::{Message, StreamEvent, ToolDefinition};
use crate::provider::{EventStream, Provider};
use crate::tool::Registry;
use crate::tool::ToolOutput;
use async_trait::async_trait;
use std::sync::Mutex as StdMutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::mpsc as tokio_mpsc;
use tokio_stream::wrappers::ReceiverStream;

struct DelayedProvider {
    open_delay: Duration,
    first_event_delay: Duration,
}

struct NativeAutoCompactionProvider;

struct ToolThenEmptyThenTextProvider {
    calls: Arc<AtomicUsize>,
}

struct ToolThenAlwaysEmptyProvider {
    calls: Arc<AtomicUsize>,
}

struct CaptureProvider {
    messages: Arc<StdMutex<Vec<Vec<Message>>>>,
    systems: Arc<StdMutex<Vec<String>>>,
}

#[async_trait]
impl Provider for DelayedProvider {
    async fn complete(
        &self,
        _messages: &[Message],
        _tools: &[ToolDefinition],
        _system: &str,
        _resume_session_id: Option<&str>,
    ) -> Result<EventStream> {
        tokio::time::sleep(self.open_delay).await;

        let first_event_delay = self.first_event_delay;
        let (tx, rx) = tokio_mpsc::channel::<Result<StreamEvent>>(8);
        tokio::spawn(async move {
            tokio::time::sleep(first_event_delay).await;
            let _ = tx
                .send(Ok(StreamEvent::TextDelta("hello".to_string())))
                .await;
            let _ = tx
                .send(Ok(StreamEvent::MessageEnd {
                    stop_reason: Some("end_turn".to_string()),
                }))
                .await;
        });

        Ok(Box::pin(ReceiverStream::new(rx)))
    }

    fn name(&self) -> &str {
        "delayed"
    }

    fn fork(&self) -> Arc<dyn Provider> {
        Arc::new(Self {
            open_delay: self.open_delay,
            first_event_delay: self.first_event_delay,
        })
    }
}

#[tokio::test]
async fn split_prompt_includes_current_task_focus_reminder() {
    let provider: Arc<dyn Provider> = Arc::new(NativeAutoCompactionProvider);
    let registry = Registry::new(provider.clone()).await;
    let agent = Agent::new(provider, registry);

    let split = agent.build_system_prompt_split(None);

    assert!(split.dynamic_part.contains("# Current Task Focus"));
    assert!(
        split
            .dynamic_part
            .contains("latest real user message is the active request")
    );
    assert!(split.dynamic_part.contains("Do not resume suspended work"));
}

#[async_trait]
impl Provider for NativeAutoCompactionProvider {
    async fn complete(
        &self,
        _messages: &[Message],
        _tools: &[ToolDefinition],
        _system: &str,
        _resume_session_id: Option<&str>,
    ) -> Result<EventStream> {
        let (_tx, rx) = tokio_mpsc::channel::<Result<StreamEvent>>(1);
        Ok(Box::pin(ReceiverStream::new(rx)))
    }

    fn name(&self) -> &str {
        "openai"
    }

    fn supports_compaction(&self) -> bool {
        true
    }

    fn uses_jcode_compaction(&self) -> bool {
        false
    }

    fn context_window(&self) -> usize {
        1_000
    }

    fn fork(&self) -> Arc<dyn Provider> {
        Arc::new(Self)
    }

    async fn complete_simple(&self, _prompt: &str, _system: &str) -> Result<String> {
        Ok("manual summary from native-auto provider".to_string())
    }
}

#[async_trait]
impl Provider for ToolThenEmptyThenTextProvider {
    async fn complete(
        &self,
        _messages: &[Message],
        _tools: &[ToolDefinition],
        _system: &str,
        _resume_session_id: Option<&str>,
    ) -> Result<EventStream> {
        let call = self.calls.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = tokio_mpsc::channel::<Result<StreamEvent>>(8);
        tokio::spawn(async move {
            match call {
                0 => {
                    let _ = tx
                        .send(Ok(StreamEvent::ToolUseStart {
                            id: "call_1".to_string(),
                            name: "bash".to_string(),
                        }))
                        .await;
                    let _ = tx
                        .send(Ok(StreamEvent::ToolInputDelta(
                            r#"{"command":"printf tool-output","timeout":10000}"#.to_string(),
                        )))
                        .await;
                    let _ = tx.send(Ok(StreamEvent::ToolUseEnd)).await;
                }
                1 => {}
                _ => {
                    let _ = tx
                        .send(Ok(StreamEvent::TextDelta(
                            "final answer after tool result".to_string(),
                        )))
                        .await;
                }
            }
            let _ = tx
                .send(Ok(StreamEvent::MessageEnd {
                    stop_reason: Some("stop".to_string()),
                }))
                .await;
        });

        Ok(Box::pin(ReceiverStream::new(rx)))
    }

    fn name(&self) -> &str {
        "tool-empty-text"
    }

    fn fork(&self) -> Arc<dyn Provider> {
        Arc::new(Self {
            calls: Arc::clone(&self.calls),
        })
    }
}

#[async_trait]
impl Provider for ToolThenAlwaysEmptyProvider {
    async fn complete(
        &self,
        _messages: &[Message],
        _tools: &[ToolDefinition],
        _system: &str,
        _resume_session_id: Option<&str>,
    ) -> Result<EventStream> {
        let call = self.calls.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = tokio_mpsc::channel::<Result<StreamEvent>>(8);
        tokio::spawn(async move {
            if call == 0 {
                let _ = tx
                    .send(Ok(StreamEvent::ToolUseStart {
                        id: "call_1".to_string(),
                        name: "bash".to_string(),
                    }))
                    .await;
                let _ = tx
                    .send(Ok(StreamEvent::ToolInputDelta(
                        r#"{"command":"printf tool-output","timeout":10000}"#.to_string(),
                    )))
                    .await;
                let _ = tx.send(Ok(StreamEvent::ToolUseEnd)).await;
            }
            let _ = tx
                .send(Ok(StreamEvent::MessageEnd {
                    stop_reason: Some("stop".to_string()),
                }))
                .await;
        });

        Ok(Box::pin(ReceiverStream::new(rx)))
    }

    fn name(&self) -> &str {
        "tool-always-empty"
    }

    fn fork(&self) -> Arc<dyn Provider> {
        Arc::new(Self {
            calls: Arc::clone(&self.calls),
        })
    }
}

#[async_trait]
impl Provider for CaptureProvider {
    async fn complete(
        &self,
        messages: &[Message],
        _tools: &[ToolDefinition],
        system: &str,
        _resume_session_id: Option<&str>,
    ) -> Result<EventStream> {
        self.messages.lock().unwrap().push(messages.to_vec());
        self.systems.lock().unwrap().push(system.to_string());
        let (tx, rx) = tokio_mpsc::channel::<Result<StreamEvent>>(8);
        tokio::spawn(async move {
            let _ = tx
                .send(Ok(StreamEvent::TextDelta("resumed answer".to_string())))
                .await;
            let _ = tx
                .send(Ok(StreamEvent::MessageEnd {
                    stop_reason: Some("end_turn".to_string()),
                }))
                .await;
        });
        Ok(Box::pin(ReceiverStream::new(rx)))
    }

    fn name(&self) -> &str {
        "capture"
    }

    fn fork(&self) -> Arc<dyn Provider> {
        Arc::new(Self {
            messages: Arc::clone(&self.messages),
            systems: Arc::clone(&self.systems),
        })
    }
}

#[tokio::test]
async fn continue_streaming_with_system_reminder_does_not_append_empty_user_message() {
    let _guard = crate::storage::lock_test_env();
    let messages = Arc::new(StdMutex::new(Vec::new()));
    let systems = Arc::new(StdMutex::new(Vec::new()));
    let provider: Arc<dyn Provider> = Arc::new(CaptureProvider {
        messages: Arc::clone(&messages),
        systems: Arc::clone(&systems),
    });
    let registry = Registry::new(provider.clone()).await;
    let mut agent = Agent::new(provider, registry);
    agent.add_message(
        Role::User,
        vec![ContentBlock::Text {
            text: "original request".to_string(),
            cache_control: None,
        }],
    );
    agent.session.save().expect("save original request");
    let store =
        crate::memory::agent_runtime::AgentMemoryStore::new_default().expect("agent memory store");
    store
        .ensure_session_with_id(
            &agent.session.id,
            crate::memory::agent_runtime::CreateSessionInput {
                title: Some("resume test".to_string()),
                working_dir: None,
                provider_key: None,
                model: None,
            },
        )
        .expect("ensure memory session");
    let user_event = store
        .append_event(
            &agent.session.id,
            crate::memory::agent_runtime::NewSessionEvent::user_message("original request"),
        )
        .expect("append memory user event");
    let runtime_turn_id = "runtime_turn_resume_test";
    store
        .start_runtime_turn_with_id(
            &agent.session.id,
            runtime_turn_id,
            Some(user_event.event_id.as_str()),
            None,
        )
        .expect("start memory runtime turn");
    let context_snapshot = store
        .build_context(&agent.session.id, runtime_turn_id, 128_000)
        .expect("build memory context");
    agent.set_assembled_provider_context(AssembledProviderContext {
        session_id: agent.session.id.clone(),
        runtime_turn_id: runtime_turn_id.to_string(),
        context_snapshot_id: context_snapshot.context_snapshot_id,
        messages: vec![Message {
            role: Role::User,
            content: vec![ContentBlock::Text {
                text: "original request".to_string(),
                cache_control: None,
            }],
            timestamp: None,
            tool_duration_ms: None,
        }],
        dynamic_system_context: None,
    });

    let (event_tx, _event_rx) = tokio_mpsc::unbounded_channel();
    agent
        .continue_streaming_mpsc_with_system_reminder("resume after reload".to_string(), event_tx)
        .await
        .expect("resume existing transcript");

    assert!(
        agent
            .session
            .messages
            .iter()
            .filter(|message| message.role == Role::User)
            .all(|message| message.content.iter().any(|block| match block {
                ContentBlock::Text { text, .. } => !text.trim().is_empty(),
                _ => true,
            })),
        "resume should not persist a blank user turn"
    );
    assert!(
        agent
            .session
            .messages
            .iter()
            .any(|message| message.role == Role::Assistant
                && message.content.iter().any(|block| matches!(
                    block,
                    ContentBlock::Text { text, .. } if text == "resumed answer"
                )))
    );
    let provider_messages = messages.lock().unwrap();
    assert!(
        provider_messages[0].len() >= 1,
        "resume should preserve existing provider context"
    );
    let captured_systems = systems.lock().unwrap();
    assert!(
        captured_systems
            .first()
            .is_some_and(|system| system.contains("resume after reload")),
        "recovery reminder belongs in dynamic system context, not as a pseudo user message"
    );
    assert!(!provider_messages[0].iter().any(|message| {
        matches!(message.role, Role::User)
            && message.content.iter().any(|block| {
                matches!(block, ContentBlock::Text { text, .. } if text.contains("resume after reload"))
            })
    }));
    assert!(
        provider_messages[0].iter().all(|message| {
            message.content.iter().any(|block| match block {
                ContentBlock::Text { text, .. } => !text.trim().is_empty(),
                _ => true,
            })
        }),
        "provider context should not include a blank user turn"
    );
}

#[tokio::test]
async fn provider_input_comes_from_context_snapshot_not_old_transcript() {
    let _guard = crate::storage::lock_test_env();
    let messages = Arc::new(StdMutex::new(Vec::new()));
    let systems = Arc::new(StdMutex::new(Vec::new()));
    let provider: Arc<dyn Provider> = Arc::new(CaptureProvider {
        messages: Arc::clone(&messages),
        systems: Arc::clone(&systems),
    });
    let registry = Registry::new(provider.clone()).await;
    let mut agent = Agent::new(provider, registry);
    agent.add_message(
        Role::User,
        vec![ContentBlock::Text {
            text: "old transcript must not reach provider".to_string(),
            cache_control: None,
        }],
    );

    let store =
        crate::memory::agent_runtime::AgentMemoryStore::new_default().expect("agent memory store");
    store
        .ensure_session_with_id(
            &agent.session.id,
            crate::memory::agent_runtime::CreateSessionInput {
                title: Some("context provider smoke".to_string()),
                working_dir: None,
                provider_key: None,
                model: None,
            },
        )
        .expect("ensure memory session");
    let user_event = store
        .append_event(
            &agent.session.id,
            crate::memory::agent_runtime::NewSessionEvent::user_message("context snapshot request"),
        )
        .expect("append memory user event");
    let runtime_turn_id = "runtime_turn_context_provider_smoke";
    store
        .start_runtime_turn_with_id(
            &agent.session.id,
            runtime_turn_id,
            Some(user_event.event_id.as_str()),
            None,
        )
        .expect("start memory runtime turn");
    let context_snapshot = store
        .build_context(&agent.session.id, runtime_turn_id, 128_000)
        .expect("build memory context");
    agent.set_assembled_provider_context(AssembledProviderContext {
        session_id: agent.session.id.clone(),
        runtime_turn_id: runtime_turn_id.to_string(),
        context_snapshot_id: context_snapshot.context_snapshot_id,
        messages: vec![Message {
            role: Role::User,
            content: vec![ContentBlock::Text {
                text: "context snapshot request".to_string(),
                cache_control: None,
            }],
            timestamp: None,
            tool_duration_ms: None,
        }],
        dynamic_system_context: None,
    });

    let (event_tx, _event_rx) = tokio_mpsc::unbounded_channel();
    agent
        .run_turn_streaming_mpsc(event_tx)
        .await
        .expect("run context-backed provider turn");

    let provider_messages = messages.lock().unwrap();
    assert_eq!(provider_messages.len(), 1);
    let provider_text = provider_messages[0]
        .iter()
        .flat_map(|message| message.content.iter())
        .filter_map(|block| match block {
            ContentBlock::Text { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n");
    assert!(provider_text.contains("context snapshot request"));
    assert!(!provider_text.contains("old transcript must not reach provider"));
    assert!(!provider_text.contains("<system-reminder>"));

    let turn = store
        .read_runtime_turn(&agent.session.id, runtime_turn_id)
        .expect("read runtime turn")
        .expect("runtime turn");
    assert!(turn.context_snapshot_ref.is_some());
    assert!(turn.provider_request_ref.is_some());
}

#[test]
fn tool_output_to_content_blocks_preserves_labeled_images() {
    let output = ToolOutput::new("Image ready").with_labeled_image(
        "image/png",
        "ZmFrZQ==",
        "screenshots/example.png",
    );

    let blocks = tool_output_to_content_blocks("call_1".to_string(), output, true);
    assert_eq!(blocks.len(), 3);

    match &blocks[0] {
        ContentBlock::ToolResult {
            tool_use_id,
            content,
            is_error,
        } => {
            assert_eq!(tool_use_id, "call_1");
            assert_eq!(content, "Image ready");
            assert_eq!(*is_error, None);
        }
        other => panic!("expected tool result, got {other:?}"),
    }

    match &blocks[1] {
        ContentBlock::Image { media_type, data } => {
            assert_eq!(media_type, "image/png");
            assert_eq!(data, "ZmFrZQ==");
        }
        other => panic!("expected image block, got {other:?}"),
    }

    match &blocks[2] {
        ContentBlock::Text { text, .. } => {
            assert!(text.contains("screenshots/example.png"));
            assert!(text.contains("preceding tool result"));
        }
        other => panic!("expected trailing label text, got {other:?}"),
    }
}

#[test]
fn tool_output_to_content_blocks_preserves_images_when_provider_lacks_vision() {
    let output = ToolOutput::new("Image ready").with_labeled_image(
        "image/png",
        "ZmFrZQ==",
        "browser screenshot",
    );

    let blocks = tool_output_to_content_blocks("call_1".to_string(), output, false);
    assert_eq!(blocks.len(), 3);
    assert!(matches!(blocks[0], ContentBlock::ToolResult { .. }));
    match &blocks[1] {
        ContentBlock::Image { media_type, data } => {
            assert_eq!(media_type, "image/png");
            assert_eq!(data, "ZmFrZQ==");
        }
        other => panic!("expected image block, got {other:?}"),
    }
    match &blocks[2] {
        ContentBlock::Text { text, .. } => {
            assert!(text.contains("browser screenshot"));
        }
        other => panic!("expected trailing label text, got {other:?}"),
    }
}

#[test]
fn tool_output_to_content_blocks_preserves_large_lumen_visual_fallback_images() {
    let output = ToolOutput::new("Captured Lyra Lumen visual fallback evidence.")
        .with_labeled_image(
            "image/png",
            "a".repeat((48 * 1024) + 1),
            "lyra lumen visual fallback",
        );

    let blocks = tool_output_to_content_blocks("call_1".to_string(), output, true);
    assert_eq!(blocks.len(), 3);
    assert!(matches!(blocks[0], ContentBlock::ToolResult { .. }));
    match &blocks[1] {
        ContentBlock::Image { media_type, data } => {
            assert_eq!(media_type, "image/png");
            assert_eq!(data.len(), (48 * 1024) + 1);
        }
        other => panic!("expected image block, got {other:?}"),
    }
    match &blocks[2] {
        ContentBlock::Text { text, .. } => {
            assert!(text.contains("lyra lumen visual fallback"));
        }
        other => panic!("expected trailing label text, got {other:?}"),
    }
}

#[test]
fn provider_context_filters_images_without_removing_session_blocks() {
    let blocks = tool_output_to_content_blocks(
        "call_1".to_string(),
        ToolOutput::new("Captured Lyra Lumen visual fallback evidence.").with_labeled_image(
            "image/png",
            "a".repeat((48 * 1024) + 1),
            "lyra lumen visual fallback",
        ),
        true,
    );
    assert!(
        blocks
            .iter()
            .any(|block| matches!(block, ContentBlock::Image { .. })),
        "session/UI blocks should retain the real image"
    );

    let messages = vec![Message {
        role: Role::User,
        content: blocks.clone(),
        timestamp: None,
        tool_duration_ms: None,
    }];
    let filtered = filter_messages_for_provider_context(messages, true);
    assert!(
        filtered[0]
            .content
            .iter()
            .all(|block| !matches!(block, ContentBlock::Image { .. })),
        "provider context should omit oversized Lumen fallback image"
    );
    assert!(
        filtered[0].content.iter().any(|block| matches!(
            block,
            ContentBlock::Text { text, .. }
                if text.contains("available in Lyra UI")
                    && !text.contains("Image attachment omitted from model context")
        )),
        "provider-only context should explain the omitted image without reusing the UI-visible failure text"
    );
    assert!(
        blocks
            .iter()
            .any(|block| matches!(block, ContentBlock::Image { .. })),
        "filtering must not mutate the session/UI blocks"
    );

    let nonvision_messages = vec![Message {
        role: Role::User,
        content: blocks,
        timestamp: None,
        tool_duration_ms: None,
    }];
    let nonvision_filtered = filter_messages_for_provider_context(nonvision_messages, false);
    assert!(
        nonvision_filtered[0]
            .content
            .iter()
            .all(|block| !matches!(block, ContentBlock::Image { .. }))
    );
    assert!(nonvision_filtered[0].content.iter().any(|block| matches!(
        block,
        ContentBlock::Text { text, .. } if text.contains("does not currently support image input")
    )));
}

#[tokio::test]
async fn run_turn_streaming_mpsc_emits_keepalive_while_provider_is_quiet() {
    let _guard = crate::storage::lock_test_env();
    let provider: Arc<dyn Provider> = Arc::new(DelayedProvider {
        open_delay: Duration::from_secs(2),
        first_event_delay: Duration::from_secs(2),
    });
    let registry = Registry::new(provider.clone()).await;
    let mut agent = Agent::new(provider, registry);
    agent.add_message(
        Role::User,
        vec![ContentBlock::Text {
            text: "test".to_string(),
            cache_control: None,
        }],
    );

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let task = tokio::spawn(async move { agent.run_turn_streaming_mpsc(tx).await });

    let mut saw_keepalive = false;
    let keepalive_deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < keepalive_deadline {
        match tokio::time::timeout(Duration::from_secs(1), rx.recv()).await {
            Ok(Some(ServerEvent::Pong { id })) => {
                assert_eq!(id, STREAM_KEEPALIVE_PONG_ID);
                saw_keepalive = true;
                break;
            }
            Ok(Some(ServerEvent::TextDelta { text })) => {
                panic!("expected keepalive before text delta, got: {text}");
            }
            Ok(Some(_)) => {}
            Ok(None) => panic!("channel closed before keepalive"),
            Err(_) => {
                assert!(
                    !task.is_finished(),
                    "streaming task finished before keepalive arrived"
                );
            }
        }
    }
    assert!(saw_keepalive, "expected keepalive before provider response");

    let mut saw_text = false;
    let text_deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < text_deadline {
        match tokio::time::timeout(Duration::from_secs(1), rx.recv()).await {
            Ok(Some(ServerEvent::TextDelta { text })) => {
                assert_eq!(text, "hello");
                saw_text = true;
                break;
            }
            Ok(Some(ServerEvent::Pong { id })) => {
                assert_eq!(id, STREAM_KEEPALIVE_PONG_ID);
            }
            Ok(Some(_)) => {}
            Ok(None) => panic!("channel closed before text delta"),
            Err(_) => {
                assert!(
                    !task.is_finished(),
                    "streaming task finished before text delta arrived"
                );
            }
        }
    }

    assert!(saw_text, "expected delayed provider text after keepalive");
    task.await.unwrap().unwrap();
}

#[tokio::test]
async fn run_turn_streaming_mpsc_retries_empty_response_after_tool_result() {
    let _guard = crate::storage::lock_test_env();
    let prev_memory_home = std::env::var_os("LYRA_AGENT_MEMORY_HOME");
    let memory_home = tempfile::TempDir::new().expect("memory home");
    crate::env::set_var("LYRA_AGENT_MEMORY_HOME", memory_home.path());
    let calls = Arc::new(AtomicUsize::new(0));
    let provider: Arc<dyn Provider> = Arc::new(ToolThenEmptyThenTextProvider {
        calls: Arc::clone(&calls),
    });
    let registry = Registry::new(provider.clone()).await;
    let mut agent = Agent::new(provider, registry);
    agent.add_message(
        Role::User,
        vec![ContentBlock::Text {
            text: "use a tool then answer".to_string(),
            cache_control: None,
        }],
    );

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    agent.run_turn_streaming_mpsc(tx).await.unwrap();
    while rx.recv().await.is_some() {}

    assert_eq!(calls.load(Ordering::SeqCst), 3);
    assert!(
        agent
            .last_assistant_text()
            .unwrap_or_default()
            .contains("final answer after tool result")
    );
    assert!(agent.session.messages.iter().all(|message| {
        message.content.iter().all(|block| match block {
            ContentBlock::Text { text, .. } => !text.contains("empty_tool_result_recovery"),
            _ => true,
        })
    }));
    let memory_events = crate::memory::agent_runtime::AgentMemoryStore::new_default()
        .expect("memory store")
        .read_events_by_session(agent.session_id())
        .expect("memory events");
    assert!(
        memory_events
            .iter()
            .any(|event| event.kind == "empty_tool_result_recovery")
    );
    if let Some(prev) = prev_memory_home {
        crate::env::set_var("LYRA_AGENT_MEMORY_HOME", prev);
    } else {
        crate::env::remove_var("LYRA_AGENT_MEMORY_HOME");
    }
}

#[tokio::test]
async fn run_turn_streaming_mpsc_falls_back_after_repeated_empty_tool_result_response() {
    let _guard = crate::storage::lock_test_env();
    let calls = Arc::new(AtomicUsize::new(0));
    let provider: Arc<dyn Provider> = Arc::new(ToolThenAlwaysEmptyProvider {
        calls: Arc::clone(&calls),
    });
    let registry = Registry::new(provider.clone()).await;
    let mut agent = Agent::new(provider, registry);
    agent.add_message(
        Role::User,
        vec![ContentBlock::Text {
            text: "use a tool then answer".to_string(),
            cache_control: None,
        }],
    );

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    agent.run_turn_streaming_mpsc(tx).await.unwrap();

    let mut streamed_text = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            ServerEvent::TextDelta { text } => streamed_text.push_str(&text),
            ServerEvent::Error { message, .. } => {
                panic!("fallback recovery should not emit an error event: {message}");
            }
            _ => {}
        }
    }

    assert_eq!(calls.load(Ordering::SeqCst), 4);
    assert!(streamed_text.contains("latest available result"));
    assert!(streamed_text.contains("tool-output"));
    assert!(
        agent
            .last_assistant_text()
            .unwrap_or_default()
            .contains("latest available result")
    );
}

#[tokio::test]
async fn messages_for_provider_replays_persisted_native_compaction_in_auto_mode() {
    let provider: Arc<dyn Provider> = Arc::new(NativeAutoCompactionProvider);
    let registry = Registry::new(provider.clone()).await;
    let mut agent = Agent::new(provider, registry);

    agent.add_message(
        Role::User,
        vec![ContentBlock::Text {
            text: "first".to_string(),
            cache_control: None,
        }],
    );
    agent.add_message(
        Role::Assistant,
        vec![ContentBlock::Text {
            text: "second".to_string(),
            cache_control: None,
        }],
    );

    agent
        .apply_openai_native_compaction("enc_auto".to_string(), 1)
        .expect("persist native compaction");

    let (messages, event) = agent.messages_for_provider();
    assert!(event.is_none());
    assert!(!messages.is_empty());
    match &messages[0].content[0] {
        ContentBlock::OpenAICompaction { encrypted_content } => {
            assert_eq!(encrypted_content, "enc_auto");
        }
        other => panic!("expected OpenAI compaction block, got {other:?}"),
    }
    assert!(
        messages
            .iter()
            .any(|message| message.role == Role::Assistant)
    );
}

#[tokio::test]
async fn oversized_openai_native_compaction_is_persisted_as_text_fallback() {
    let provider: Arc<dyn Provider> = Arc::new(NativeAutoCompactionProvider);
    let registry = Registry::new(provider.clone()).await;
    let mut agent = Agent::new(provider, registry);

    agent.add_message(
        Role::User,
        vec![ContentBlock::Text {
            text: "first".to_string(),
            cache_control: None,
        }],
    );
    agent.add_message(
        Role::Assistant,
        vec![ContentBlock::Text {
            text: "second".to_string(),
            cache_control: None,
        }],
    );

    let oversized =
        "x".repeat(crate::provider::openai_request::OPENAI_ENCRYPTED_CONTENT_SAFE_MAX_CHARS + 1);
    agent
        .apply_openai_native_compaction(oversized, 1)
        .expect("persist fallback compaction");

    let state = agent
        .session
        .compaction
        .as_ref()
        .expect("compaction should be persisted");
    assert!(state.openai_encrypted_content.is_none());
    assert!(
        state
            .summary_text
            .contains("OpenAI native compaction state was discarded")
    );

    let (messages, event) = agent.messages_for_provider();
    assert!(event.is_none());
    assert!(!messages.is_empty());
    assert!(messages.iter().all(|message| {
        message
            .content
            .iter()
            .all(|block| !matches!(block, ContentBlock::OpenAICompaction { .. }))
    }));
    match &messages[0].content[0] {
        ContentBlock::Text { text, .. } => {
            assert!(text.contains("Previous Conversation Summary"));
            assert!(text.contains("OpenAI native compaction state was discarded"));
        }
        other => panic!("expected text fallback summary, got {other:?}"),
    }
    assert!(
        messages
            .iter()
            .any(|message| message.role == Role::Assistant)
    );
}

#[tokio::test]
async fn messages_for_provider_applies_manual_compaction_in_native_auto_mode() {
    let provider: Arc<dyn Provider> = Arc::new(NativeAutoCompactionProvider);
    let registry = Registry::new(provider.clone()).await;
    let mut agent = Agent::new(provider, registry);

    for i in 0..30 {
        agent.add_message(
            Role::User,
            vec![ContentBlock::Text {
                text: format!("turn {i} {}", "x".repeat(120)),
                cache_control: None,
            }],
        );
    }

    agent.provider_session_id = Some("stale-provider-session".to_string());
    agent.session.provider_session_id = Some("stale-provider-session".to_string());

    let provider_messages = agent.provider_messages();
    let (message, success) = agent.request_manual_compaction();
    assert!(success, "manual compaction should start: {message}");

    let deadline = Instant::now() + Duration::from_secs(2);
    let mut event = None;
    let mut compacted_messages = Vec::new();
    while Instant::now() < deadline {
        let (messages, maybe_event) = agent.messages_for_provider();
        if maybe_event.is_some() {
            event = maybe_event;
            compacted_messages = messages;
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    let event = event.expect("manual compaction event should be applied");
    assert_eq!(event.trigger, "manual");
    assert!(agent.session.compaction.is_some());
    assert!(agent.provider_session_id.is_none());
    assert!(agent.session.provider_session_id.is_none());
    assert!(compacted_messages.len() < provider_messages.len());
    match &compacted_messages[0].content[0] {
        ContentBlock::Text { text, .. } => {
            assert!(text.contains("Previous Conversation Summary"));
            assert!(text.contains("manual summary from native-auto provider"));
        }
        other => panic!("expected text summary block, got {other:?}"),
    }
}

// ── InterruptSignal tests ────────────────────────────────────────────────

#[tokio::test]
async fn interrupt_signal_fire_before_notified_does_not_hang() {
    // Regression test: fire() called BEFORE notified().await must not hang.
    // The old code called notify_waiters() which drops the notification if
    // nobody is waiting yet. The flag is still set so the fast path catches it,
    // but only if the future is created before the flag check.
    let sig = InterruptSignal::new();
    sig.fire(); // fire before anyone is waiting
    tokio::time::timeout(std::time::Duration::from_millis(100), sig.notified())
        .await
        .expect("notified() hung when signal was already set before call");
}

#[tokio::test]
async fn interrupt_signal_fire_concurrent_with_notified() {
    // Regression test for the race window: fire() is called concurrently while
    // notified() is being set up. The fix (create future before flag check) ensures
    // the notify_waiters() in fire() wakes the registered future.
    let sig = Arc::new(InterruptSignal::new());
    let sig2 = Arc::clone(&sig);

    // Spawn a task that fires after a tiny delay, giving the main task time to
    // enter notified() but before it reaches notified().await.
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        sig2.fire();
    });

    tokio::time::timeout(std::time::Duration::from_millis(500), sig.notified())
        .await
        .expect("notified() hung during concurrent fire()");
}

#[tokio::test]
async fn interrupt_signal_is_set_false_initially() {
    let sig = InterruptSignal::new();
    assert!(!sig.is_set());
}

#[tokio::test]
async fn interrupt_signal_is_set_true_after_fire() {
    let sig = InterruptSignal::new();
    sig.fire();
    assert!(sig.is_set());
}

#[tokio::test]
async fn interrupt_signal_reset_clears_flag() {
    let sig = InterruptSignal::new();
    sig.fire();
    assert!(sig.is_set());
    sig.reset();
    assert!(!sig.is_set());
}

#[tokio::test]
async fn interrupt_signal_notified_completes_after_fire() {
    let sig = Arc::new(InterruptSignal::new());
    let sig2 = Arc::clone(&sig);

    let handle = tokio::spawn(async move {
        sig2.notified().await;
    });

    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    sig.fire();

    tokio::time::timeout(std::time::Duration::from_millis(200), handle)
        .await
        .expect("notified() task timed out after fire()")
        .expect("task panicked");
}

#[tokio::test]
async fn new_agent_registers_active_pid_and_clear_swaps_it() {
    let _guard = crate::storage::lock_test_env();
    let provider: Arc<dyn Provider> = Arc::new(NativeAutoCompactionProvider);
    let registry = Registry::new(provider.clone()).await;
    let mut agent = Agent::new(provider, registry);

    let first_session_id = agent.session_id().to_string();
    assert!(
        crate::session::active_session_ids().contains(&first_session_id),
        "fresh agent session should be tracked as active"
    );

    agent.clear();

    let second_session_id = agent.session_id().to_string();
    let active = crate::session::active_session_ids();
    assert_ne!(first_session_id, second_session_id);
    assert!(
        active.contains(&second_session_id),
        "replacement session should be tracked as active"
    );
    assert!(
        !active.contains(&first_session_id),
        "cleared session should no longer be tracked as active"
    );
}

fn seed_transient_session_state(agent: &mut Agent) {
    agent.push_alert("pending alert".to_string());
    agent.queue_soft_interrupt(
        "queued interrupt".to_string(),
        true,
        SoftInterruptSource::User,
    );
    agent.background_tool_signal.fire();
    agent.request_graceful_shutdown();
    agent.tool_call_ids.insert("tool_call_old".to_string());
    agent.tool_result_ids.insert("tool_result_old".to_string());
    agent.tool_output_scan_index = 7;
    agent.last_upstream_provider = Some("upstream_old".to_string());
    agent.last_connection_type = Some("websocket".to_string());
    agent.current_turn_system_reminder = Some("reminder".to_string());
    agent.last_usage = TokenUsage {
        input_tokens: 11,
        output_tokens: 17,
        cache_read_input_tokens: Some(3),
        cache_creation_input_tokens: Some(5),
    };
    agent.locked_tools = Some(vec![ToolDefinition {
        name: "test_tool".to_string(),
        description: "test tool".to_string(),
        input_schema: serde_json::json!({"type": "object"}),
    }]);
}

#[tokio::test]
async fn clear_resets_runtime_interrupt_and_queue_state() {
    let _guard = crate::storage::lock_test_env();
    let provider: Arc<dyn Provider> = Arc::new(NativeAutoCompactionProvider);
    let registry = Registry::new(provider.clone()).await;
    let mut agent = Agent::new(provider, registry);

    seed_transient_session_state(&mut agent);
    assert_eq!(agent.soft_interrupt_count(), 1);
    assert!(agent.background_tool_signal().is_set());
    assert!(agent.graceful_shutdown_signal().is_set());

    agent.clear();

    assert_eq!(agent.soft_interrupt_count(), 0);
    assert!(!agent.background_tool_signal().is_set());
    assert!(!agent.graceful_shutdown_signal().is_set());
    assert_eq!(agent.pending_alert_count(), 0);
    assert!(agent.tool_call_ids.is_empty());
    assert!(agent.tool_result_ids.is_empty());
    assert_eq!(agent.tool_output_scan_index, 0);
    assert!(agent.last_upstream_provider.is_none());
    assert!(agent.last_connection_type.is_none());
    assert!(agent.current_turn_system_reminder.is_none());
    assert_eq!(agent.last_usage.input_tokens, 0);
    assert_eq!(agent.last_usage.output_tokens, 0);
    assert!(agent.locked_tools.is_none());
}

#[tokio::test]
async fn restore_session_resets_runtime_interrupt_and_queue_state() {
    let _guard = crate::storage::lock_test_env();
    let provider: Arc<dyn Provider> = Arc::new(NativeAutoCompactionProvider);
    let registry = Registry::new(provider.clone()).await;
    let mut agent = Agent::new(provider, registry);

    let mut restored_session = crate::session::Session::create_with_id(
        "session_restore_resets_runtime_state".to_string(),
        None,
        None,
    );
    restored_session.save().expect("save restored session");

    seed_transient_session_state(&mut agent);
    assert_eq!(agent.soft_interrupt_count(), 1);
    assert!(agent.background_tool_signal().is_set());
    assert!(agent.graceful_shutdown_signal().is_set());

    let status = agent
        .restore_session(&restored_session.id)
        .expect("restore session should succeed");

    assert_eq!(status, crate::session::SessionStatus::Active);
    assert_eq!(agent.session_id(), restored_session.id);
    assert_eq!(agent.soft_interrupt_count(), 0);
    assert!(!agent.background_tool_signal().is_set());
    assert!(!agent.graceful_shutdown_signal().is_set());
    assert_eq!(agent.pending_alert_count(), 0);
    assert!(agent.tool_call_ids.is_empty());
    assert!(agent.tool_result_ids.is_empty());
    assert_eq!(agent.tool_output_scan_index, 0);
    assert!(agent.last_upstream_provider.is_none());
    assert!(agent.last_connection_type.is_none());
    assert!(agent.current_turn_system_reminder.is_none());
    assert_eq!(agent.last_usage.input_tokens, 0);
    assert_eq!(agent.last_usage.output_tokens, 0);
    assert!(agent.locked_tools.is_none());
}

#[tokio::test]
async fn restore_session_rehydrates_injected_memory_ids() {
    let _guard = crate::storage::lock_test_env();
    crate::memory::clear_all_pending_memory();

    let provider: Arc<dyn Provider> = Arc::new(NativeAutoCompactionProvider);
    let registry = Registry::new(provider.clone()).await;
    let mut agent = Agent::new(provider, registry);

    let mut restored_session = crate::session::Session::create_with_id(
        "session_restore_memory_dedup".to_string(),
        None,
        None,
    );
    restored_session.record_memory_injection(
        "🧠 auto-recalled 1 memory".to_string(),
        "persisted memory".to_string(),
        1,
        5,
        vec!["memory-persisted".to_string()],
    );
    restored_session.save().expect("save restored session");

    crate::memory::mark_memories_injected(&restored_session.id, &["memory-stale".to_string()]);

    agent
        .restore_session(&restored_session.id)
        .expect("restore session should succeed");

    assert!(crate::memory::is_memory_injected(
        &restored_session.id,
        "memory-persisted"
    ));
    assert!(
        !crate::memory::is_memory_injected(&restored_session.id, "memory-stale"),
        "restore should replace stale in-memory dedup state with persisted session data"
    );

    crate::memory::clear_all_pending_memory();
}

#[tokio::test]
async fn build_memory_prompt_nonblocking_defers_pending_memory_during_tool_loop() {
    let _guard = crate::storage::lock_test_env();
    crate::memory::clear_all_pending_memory();

    let provider: Arc<dyn Provider> = Arc::new(NativeAutoCompactionProvider);
    let registry = Registry::new(provider.clone()).await;
    let agent = Agent::new(provider, registry);
    let session_id = agent.session.id.clone();

    crate::memory::set_pending_memory_with_ids(
        &session_id,
        "remember this later".to_string(),
        1,
        vec!["memory-deferred".to_string()],
    );

    let tool_loop_messages = vec![
        Message::user("hello"),
        Message {
            role: Role::Assistant,
            content: vec![ContentBlock::ToolUse {
                id: "call_1".to_string(),
                name: "bash".to_string(),
                input: serde_json::json!({}),
            }],
            timestamp: Some(chrono::Utc::now()),
            tool_duration_ms: None,
        },
        Message::tool_result("call_1", "ok", false),
    ];

    let pending = agent.build_memory_prompt_nonblocking(&tool_loop_messages, None);
    assert!(pending.is_none(), "memory should not inject mid tool loop");
    assert!(crate::memory::has_pending_memory(&session_id));

    let next_turn_messages = vec![Message::user("follow up")];
    let pending = agent.build_memory_prompt_nonblocking(&next_turn_messages, None);
    assert!(
        pending.is_some(),
        "memory should inject on the next real user turn"
    );
    assert!(!crate::memory::has_pending_memory(&session_id));

    crate::memory::clear_all_pending_memory();
}

#[tokio::test]
async fn mark_closed_persists_soft_interrupts_for_restore_after_reload() {
    let _guard = crate::storage::lock_test_env();
    let temp = tempfile::TempDir::new().expect("temp dir");
    let prev_home = std::env::var_os("JCODE_HOME");
    crate::env::set_var("JCODE_HOME", temp.path());

    let provider: Arc<dyn Provider> = Arc::new(NativeAutoCompactionProvider);
    let registry = Registry::new(provider.clone()).await;
    let mut agent = Agent::new(provider.clone(), registry.clone());
    let session_id = agent.session_id().to_string();
    agent.session.save().expect("save active session");
    agent.queue_soft_interrupt(
        "resume me after reload".to_string(),
        true,
        SoftInterruptSource::System,
    );

    agent.mark_closed();

    let mut restored = Agent::new(provider, registry);
    restored
        .restore_session(&session_id)
        .expect("restore session with persisted interrupts");

    assert_eq!(restored.soft_interrupt_count(), 1);
    assert!(restored.has_urgent_interrupt());
    assert!(
        crate::soft_interrupt_store::load(&session_id)
            .expect("store should be readable after restore")
            .is_empty()
    );

    if let Some(prev_home) = prev_home {
        crate::env::set_var("JCODE_HOME", prev_home);
    } else {
        crate::env::remove_var("JCODE_HOME");
    }
}

#[tokio::test]
async fn env_snapshot_detail_is_minimal_for_empty_sessions_and_full_after_history() {
    let _guard = crate::storage::lock_test_env();
    let provider: Arc<dyn Provider> = Arc::new(NativeAutoCompactionProvider);
    let registry = Registry::new(provider.clone()).await;
    let mut agent = Agent::new(provider, registry);

    assert_eq!(agent.env_snapshot_detail(), EnvSnapshotDetail::Minimal);
    agent.session.provider_key = Some("mimo-token-plan".to_string());
    let minimal = agent.build_env_snapshot("create", agent.env_snapshot_detail());
    assert_eq!(minimal.provider, "mimo-token-plan");
    assert!(minimal.jcode_git_hash.is_none());
    assert!(minimal.jcode_git_dirty.is_none());
    assert!(minimal.working_git.is_none());

    agent
        .session
        .append_stored_message(crate::session::StoredMessage {
            id: "msg_env_snapshot_detail".to_string(),
            role: crate::message::Role::User,
            content: vec![ContentBlock::Text {
                text: "hello".to_string(),
                cache_control: None,
            }],
            display_role: None,
            timestamp: None,
            tool_duration_ms: None,
            token_usage: None,
        });

    assert_eq!(agent.env_snapshot_detail(), EnvSnapshotDetail::Full);
}
