#![cfg_attr(test, allow(clippy::await_holding_lock))]

mod compaction;
mod environment;
mod interrupts;
mod messages;
mod prompting;
mod provider;
mod response_recovery;
mod status;
mod streaming;
mod tools;
mod turn_execution;
mod turn_loops;
mod turn_streaming_broadcast;
mod turn_streaming_mpsc;
mod utils;

use self::streaming::{
    send_stream_keepalive_broadcast, send_stream_keepalive_mpsc, stream_keepalive_ticker,
};
use self::tools::{print_tool_summary, tool_output_to_content_blocks};
use self::utils::trace_enabled;
use crate::build;
use crate::bus::{Bus, BusEvent, SubagentStatus, ToolEvent, ToolStatus};
use crate::cache_tracker::CacheTracker;
use crate::compaction::CompactionEvent;
use crate::id;
use crate::logging;
use crate::message::{
    ContentBlock, Message, Role, StreamEvent, TOOL_OUTPUT_MISSING_TEXT, ToolCall, ToolDefinition,
};
use crate::protocol::{HistoryMessage, ServerEvent};
use crate::provider::{NativeToolResult, Provider, ProviderRuntimeState};
use crate::session::{GitState, Session, SessionStatus, StoredDisplayRole, StoredMessage};
use crate::skill::SkillRegistry;
use crate::tool::{Registry, ToolContext, ToolExecutionMode};
use anyhow::Result;
use futures::StreamExt;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex as StdMutex};
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc};

use interrupts::{EmptyToolResultRecovery, NoToolCallOutcome, PostToolInterruptOutcome};
pub use jcode_agent_runtime::{
    BackgroundToolSignal, GracefulShutdownSignal, InterruptSignal, SoftInterruptMessage,
    SoftInterruptQueue, SoftInterruptSource, StreamError,
};

const JCODE_NATIVE_TOOLS: &[&str] = &["selfdev", "communicate"];
const MAX_INLINE_LUMEN_IMAGE_BASE64_CHARS: usize = 48 * 1024;
const LUMEN_VISUAL_FALLBACK_LABEL: &str = "lyra lumen visual fallback";
const TOOL_IMAGE_LABEL_PREFIX: &str = "[Attached image associated with the preceding tool result:";
static RECOVERED_TEXT_WRAPPED_TOOL_CALLS: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);
static JCODE_REPO_SOURCE_STATE: LazyLock<(Option<String>, Option<bool>)> = LazyLock::new(|| {
    crate::build::get_repo_dir()
        .map(|repo_dir| {
            (
                build::current_git_hash(&repo_dir).ok(),
                build::is_working_tree_dirty(&repo_dir).ok(),
            )
        })
        .unwrap_or((None, None))
});
static WORKING_GIT_STATE_CACHE: LazyLock<StdMutex<HashMap<PathBuf, Option<GitState>>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));
const STREAM_KEEPALIVE_PONG_ID: u64 = 0;

fn stable_hash_str(value: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

fn stable_hash_json<T: serde::Serialize + ?Sized>(value: &T) -> u64 {
    let encoded = serde_json::to_string(value).unwrap_or_default();
    stable_hash_str(&encoded)
}

fn stable_json_len<T: serde::Serialize + ?Sized>(value: &T) -> usize {
    serde_json::to_string(value)
        .map(|encoded| encoded.len())
        .unwrap_or_default()
}

fn message_hashes(messages: &[Message]) -> Vec<u64> {
    messages.iter().map(stable_hash_json).collect()
}

fn usage_json(
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_read_input_tokens: Option<u64>,
    cache_creation_input_tokens: Option<u64>,
) -> Option<serde_json::Value> {
    if input_tokens.is_none()
        && output_tokens.is_none()
        && cache_read_input_tokens.is_none()
        && cache_creation_input_tokens.is_none()
    {
        return None;
    }
    Some(serde_json::json!({
        "inputTokens": input_tokens.unwrap_or(0),
        "outputTokens": output_tokens.unwrap_or(0),
        "cacheReadInputTokens": cache_read_input_tokens,
        "cacheCreationInputTokens": cache_creation_input_tokens
    }))
}

fn assembled_context_dynamic_system_context(
    snapshot: &crate::memory::agent_runtime::ContextSnapshot,
) -> Option<String> {
    let dynamic_layers = snapshot
        .layers
        .iter()
        .filter(|layer| {
            !matches!(
                layer.kind,
                crate::memory::agent_runtime::ContextLayerKind::Tail
                    | crate::memory::agent_runtime::ContextLayerKind::LatestUserIntent
            )
        })
        .cloned()
        .collect::<Vec<_>>();
    serde_json::to_string(&serde_json::json!({
        "lyraContextSnapshotId": snapshot.context_snapshot_id,
        "runtimeTurnId": snapshot.runtime_turn_id,
        "layers": dynamic_layers
    }))
    .ok()
}

fn non_tool_user_message(message: &Message) -> bool {
    matches!(message.role, Role::User)
        && message
            .content
            .iter()
            .any(|block| !matches!(block, ContentBlock::ToolResult { .. }))
}

fn replacement_latest_user_message(context: &AssembledProviderContext) -> Option<Message> {
    context
        .messages
        .iter()
        .rev()
        .find(|message| non_tool_user_message(message))
        .cloned()
}

fn text_from_memory_payload(item: &crate::memory::agent_runtime::TimelineProjectionItem) -> String {
    item.payload_json
        .get("text")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn tool_call_blocks_from_memory_payload(payload: &serde_json::Value) -> Vec<ContentBlock> {
    payload
        .get("toolCalls")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|tool| {
            let id = tool.get("id").and_then(serde_json::Value::as_str)?;
            let name = tool.get("name").and_then(serde_json::Value::as_str)?;
            let input = tool
                .get("input")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            Some(ContentBlock::ToolUse {
                id: id.to_string(),
                name: name.to_string(),
                input,
            })
        })
        .collect()
}

fn content_blocks_from_memory_payload(payload: &serde_json::Value) -> Option<Vec<ContentBlock>> {
    payload
        .get("contentBlocks")
        .cloned()
        .and_then(|value| serde_json::from_value::<Vec<ContentBlock>>(value).ok())
}

fn provider_message_from_memory_timeline_item(
    item: &crate::memory::agent_runtime::TimelineProjectionItem,
    latest_user_event_id: Option<&str>,
    latest_user_replacement: Option<&Message>,
) -> Option<Message> {
    use crate::memory::agent_runtime::EventRole as MemoryEventRole;

    match item.kind.as_str() {
        "user_message" if item.role == MemoryEventRole::User => {
            if latest_user_event_id == Some(item.event_id.as_str())
                && let Some(message) = latest_user_replacement
            {
                return Some(message.clone());
            }
            Some(Message {
                role: Role::User,
                content: vec![ContentBlock::Text {
                    text: text_from_memory_payload(item),
                    cache_control: None,
                }],
                timestamp: None,
                tool_duration_ms: None,
            })
        }
        "user_context_message" if item.role == MemoryEventRole::User => {
            let content = content_blocks_from_memory_payload(&item.payload_json)?;
            Some(Message {
                role: Role::User,
                content,
                timestamp: None,
                tool_duration_ms: None,
            })
        }
        "assistant_message" if item.role == MemoryEventRole::Assistant => {
            let mut content = Vec::new();
            let text = text_from_memory_payload(item);
            if !text.trim().is_empty() {
                content.push(ContentBlock::Text {
                    text,
                    cache_control: None,
                });
            }
            content.extend(tool_call_blocks_from_memory_payload(&item.payload_json));
            if content.is_empty() {
                return None;
            }
            Some(Message {
                role: Role::Assistant,
                content,
                timestamp: None,
                tool_duration_ms: None,
            })
        }
        "tool_result" => {
            let payload = &item.payload_json;
            let tool_call_id = payload
                .get("toolCallId")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(item.event_id.as_str())
                .to_string();
            let content = payload
                .get("output")
                .map(|output| {
                    output
                        .get("content")
                        .and_then(serde_json::Value::as_str)
                        .map(ToOwned::to_owned)
                        .unwrap_or_else(|| output.to_string())
                })
                .unwrap_or_default();
            let is_error = payload
                .get("status")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|status| status != "success" && status != "success_partial")
                .then_some(true);
            Some(Message {
                role: Role::User,
                content: vec![ContentBlock::ToolResult {
                    tool_use_id: tool_call_id,
                    content,
                    is_error,
                }],
                timestamp: None,
                tool_duration_ms: None,
            })
        }
        _ => None,
    }
}

fn messages_from_context_snapshot(
    snapshot: &crate::memory::agent_runtime::ContextSnapshot,
    latest_user_replacement: Option<&Message>,
) -> Vec<Message> {
    let latest_user_event_id = snapshot
        .layers
        .iter()
        .find(|layer| {
            matches!(
                layer.kind,
                crate::memory::agent_runtime::ContextLayerKind::LatestUserIntent
            )
        })
        .and_then(|layer| layer.payload_json.get("event"))
        .and_then(|event| event.get("eventId"))
        .and_then(serde_json::Value::as_str);

    snapshot
        .layers
        .iter()
        .find(|layer| {
            matches!(
                layer.kind,
                crate::memory::agent_runtime::ContextLayerKind::Tail
            )
        })
        .and_then(|layer| layer.payload_json.get("timeline"))
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| {
            serde_json::from_value::<crate::memory::agent_runtime::TimelineProjectionItem>(
                value.clone(),
            )
            .ok()
        })
        .filter_map(|item| {
            provider_message_from_memory_timeline_item(
                &item,
                latest_user_event_id,
                latest_user_replacement,
            )
        })
        .collect()
}

fn stored_message_bootstrap_source_id(
    event: &crate::memory::agent_runtime::SessionEventRecord,
) -> Option<String> {
    event
        .lineage_json
        .get("sourceStoredMessageId")
        .and_then(serde_json::Value::as_str)
        .or_else(|| {
            event
                .payload_json
                .get("messageId")
                .and_then(serde_json::Value::as_str)
        })
        .map(ToOwned::to_owned)
}

fn content_text_for_memory_payload(content: &[ContentBlock]) -> String {
    content
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text { text, .. } | ContentBlock::Reasoning { text } => {
                Some(text.clone())
            }
            ContentBlock::Image { .. } => Some("[image]".to_string()),
            ContentBlock::ToolUse { .. }
            | ContentBlock::ToolResult { .. }
            | ContentBlock::OpenAICompaction { .. } => None,
        })
        .filter(|text| !text.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn tool_calls_for_memory_payload(content: &[ContentBlock]) -> Vec<serde_json::Value> {
    content
        .iter()
        .filter_map(|block| match block {
            ContentBlock::ToolUse { id, name, input } => Some(serde_json::json!({
                "id": id,
                "name": name,
                "input": input
            })),
            _ => None,
        })
        .collect()
}

fn bootstrap_events_from_stored_message(
    message: &StoredMessage,
    runtime_turn_id: &str,
) -> Vec<crate::memory::agent_runtime::NewSessionEvent> {
    use crate::memory::agent_runtime::{
        EventRole as MemoryEventRole, ModelContextPolicy as MemoryModelContextPolicy,
        NewSessionEvent, UiPolicy as MemoryUiPolicy, Visibility as MemoryVisibility,
    };

    if message.display_role.is_some() {
        return Vec::new();
    }

    let source_lineage = serde_json::json!({ "sourceStoredMessageId": message.id });
    match message.role {
        Role::User => {
            let mut events = Vec::new();
            let context_blocks = message
                .content
                .iter()
                .filter(|block| !matches!(block, ContentBlock::ToolResult { .. }))
                .cloned()
                .collect::<Vec<_>>();
            if !context_blocks.is_empty() {
                events.push(NewSessionEvent {
                    kind: "user_context_message".to_string(),
                    role: MemoryEventRole::User,
                    payload: serde_json::json!({
                        "contentBlocks": context_blocks,
                        "text": content_text_for_memory_payload(&message.content),
                        "messageId": message.id
                    }),
                    visibility: MemoryVisibility::UserVisible,
                    model_context_policy: MemoryModelContextPolicy::Include,
                    ui_policy: MemoryUiPolicy::ShowInTimeline,
                    runtime_turn_id: Some(runtime_turn_id.to_string()),
                    lineage_json: source_lineage.clone(),
                });
            }
            for block in &message.content {
                if let ContentBlock::ToolResult {
                    tool_use_id,
                    content,
                    is_error,
                } = block
                {
                    events.push(NewSessionEvent {
                        kind: "tool_result".to_string(),
                        role: MemoryEventRole::Tool,
                        payload: serde_json::json!({
                            "toolCallId": tool_use_id,
                            "status": if is_error.unwrap_or(false) { "failed_retryable" } else { "success" },
                            "output": { "content": content },
                            "recommendedNextActions": []
                        }),
                        visibility: MemoryVisibility::UserVisible,
                        model_context_policy: MemoryModelContextPolicy::IncludeAsRuntimeState,
                        ui_policy: MemoryUiPolicy::ShowInTimeline,
                        runtime_turn_id: Some(runtime_turn_id.to_string()),
                        lineage_json: source_lineage.clone(),
                    });
                }
            }
            events
        }
        Role::Assistant => {
            let text = content_text_for_memory_payload(&message.content);
            let tool_calls = tool_calls_for_memory_payload(&message.content);
            if text.trim().is_empty() && tool_calls.is_empty() {
                return Vec::new();
            }
            vec![NewSessionEvent {
                kind: "assistant_message".to_string(),
                role: MemoryEventRole::Assistant,
                payload: serde_json::json!({
                    "text": text,
                    "toolCalls": tool_calls,
                    "messageId": message.id
                }),
                visibility: MemoryVisibility::UserVisible,
                model_context_policy: MemoryModelContextPolicy::Include,
                ui_policy: MemoryUiPolicy::ShowInTimeline,
                runtime_turn_id: Some(runtime_turn_id.to_string()),
                lineage_json: source_lineage,
            }]
        }
    }
}

fn attached_tool_image_label(block: Option<&ContentBlock>) -> Option<&str> {
    let ContentBlock::Text { text, .. } = block? else {
        return None;
    };
    let trimmed = text.trim();
    let label = trimmed
        .strip_prefix(TOOL_IMAGE_LABEL_PREFIX)?
        .strip_suffix(']')?
        .trim();
    if label.is_empty() { None } else { Some(label) }
}

fn is_large_lumen_visual_fallback(label: Option<&str>, data: &str) -> bool {
    label
        .map(|value| value.eq_ignore_ascii_case(LUMEN_VISUAL_FALLBACK_LABEL))
        .unwrap_or(false)
        && data.len() > MAX_INLINE_LUMEN_IMAGE_BASE64_CHARS
}

fn provider_nonvision_image_omission_text(label: Option<&str>) -> String {
    match label {
        Some(label) if !label.trim().is_empty() => format!(
            "[1 image attachment omitted because the active model/provider does not currently support image input: {}]",
            label.trim()
        ),
        _ => {
            "[1 image attachment omitted because the active model/provider does not currently support image input.]"
                .to_string()
        }
    }
}

fn provider_lumen_visual_fallback_omission_text() -> String {
    "[Lyra Lumen visual fallback image is available in Lyra UI; it was not re-sent inline to the model because it exceeds the provider-context size limit. Prefer lyra_lumen.map/read/focus_scan; call lyra_lumen.see only when fresh visual evidence is required.]"
        .to_string()
}

fn filter_content_for_provider_context(
    content: Vec<ContentBlock>,
    supports_image_input: bool,
) -> Vec<ContentBlock> {
    let mut filtered = Vec::with_capacity(content.len());
    let mut index = 0usize;

    while index < content.len() {
        match &content[index] {
            ContentBlock::Image { data, .. } => {
                let next_label = attached_tool_image_label(content.get(index + 1));
                if !supports_image_input {
                    filtered.push(ContentBlock::Text {
                        text: provider_nonvision_image_omission_text(next_label),
                        cache_control: None,
                    });
                    index += if next_label.is_some() { 2 } else { 1 };
                    continue;
                }

                if is_large_lumen_visual_fallback(next_label, data) {
                    filtered.push(ContentBlock::Text {
                        text: provider_lumen_visual_fallback_omission_text(),
                        cache_control: None,
                    });
                    index += 2;
                    continue;
                }

                filtered.push(content[index].clone());
                index += 1;
            }
            _ => {
                filtered.push(content[index].clone());
                index += 1;
            }
        }
    }

    filtered
}

fn filter_messages_for_provider_context(
    messages: Vec<Message>,
    supports_image_input: bool,
) -> Vec<Message> {
    messages
        .into_iter()
        .map(|mut message| {
            message.content =
                filter_content_for_provider_context(message.content, supports_image_input);
            message
        })
        .collect()
}

fn kv_cache_request_event(
    messages: &[Message],
    tools: &[ToolDefinition],
    system_static: &str,
    ephemeral_messages: &[Message],
) -> ServerEvent {
    let ephemeral_hash = if ephemeral_messages.is_empty() {
        None
    } else {
        Some(stable_hash_json(ephemeral_messages))
    };
    ServerEvent::KvCacheRequest {
        system_static_hash: stable_hash_str(system_static),
        tools_hash: stable_hash_json(tools),
        messages_hash: stable_hash_json(messages),
        message_hashes: message_hashes(messages),
        message_count: messages.len(),
        tool_count: tools.len(),
        system_static_chars: system_static.chars().count(),
        tools_json_chars: stable_json_len(tools),
        messages_json_chars: stable_json_len(messages),
        ephemeral_hash,
        ephemeral_chars: stable_json_len(ephemeral_messages),
        ephemeral_message_count: ephemeral_messages.len(),
    }
}

/// Token usage from the last API request
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_input_tokens: Option<u64>,
    pub cache_creation_input_tokens: Option<u64>,
}

#[derive(Debug, Clone)]
struct RewindUndoSnapshot {
    messages: Vec<StoredMessage>,
    provider_session_id: Option<String>,
    session_provider_session_id: Option<String>,
    visible_message_count: usize,
}

#[derive(Debug, Clone)]
pub struct AssembledProviderContext {
    pub session_id: String,
    pub runtime_turn_id: String,
    pub context_snapshot_id: String,
    pub messages: Vec<Message>,
    pub dynamic_system_context: Option<String>,
}

pub struct Agent {
    provider: Arc<dyn Provider>,
    registry: Registry,
    skills: Arc<SkillRegistry>,
    session: Session,
    active_skill: Option<String>,
    allowed_tools: Option<HashSet<String>>,
    /// Provider-specific session ID for conversation resume (e.g., Claude Code CLI session)
    provider_session_id: Option<String>,
    /// Last upstream provider (OpenRouter) observed for this session
    last_upstream_provider: Option<String>,
    /// Last observed transport/connection type for this session
    last_connection_type: Option<String>,
    /// Last provider-supplied human-readable transport detail for this session
    last_status_detail: Option<String>,
    /// Pending swarm alerts to inject into the next turn
    pending_alerts: Vec<String>,
    /// Transient reminder injected into provider requests for the current turn only.
    /// Not persisted to session history.
    current_turn_system_reminder: Option<String>,
    /// Tool call ids observed in the current session transcript.
    tool_call_ids: HashSet<String>,
    /// Tool result ids observed in the current session transcript.
    tool_result_ids: HashSet<String>,
    /// Number of stored session messages already indexed for missing tool-output repair.
    tool_output_scan_index: usize,
    /// Soft interrupt queue: messages to inject at next safe point without cancelling
    /// Uses std::sync::Mutex so it can be accessed without async, even while agent is processing
    soft_interrupt_queue: SoftInterruptQueue,
    /// Signal from client to move the currently executing tool to background
    background_tool_signal: InterruptSignal,
    /// Signal to gracefully stop generation (checkpoint partial response and exit)
    graceful_shutdown: InterruptSignal,
    /// Client-side cache tracking for detecting append-only violations
    cache_tracker: CacheTracker,
    /// Last token usage from API request (for debug socket queries)
    last_usage: TokenUsage,
    /// Locked tool list: once the first API request is sent, freeze the tool list
    /// to avoid cache invalidation when MCP tools arrive asynchronously.
    /// Cleared on compaction/reset.
    locked_tools: Option<Vec<ToolDefinition>>,
    /// Override system prompt (used by ambient mode to inject a custom prompt)
    system_prompt_override: Option<String>,
    /// Whether memory features are enabled for this session
    memory_enabled: bool,
    /// One-step undo snapshot captured before the most recent rewind.
    rewind_undo_snapshot: Option<RewindUndoSnapshot>,
    /// Channel for tools to request stdin input from the user
    stdin_request_tx: Option<tokio::sync::mpsc::UnboundedSender<crate::tool::StdinInputRequest>>,
    /// Canonical reducer-backed view of runtime provider/model selection.
    provider_runtime_state: ProviderRuntimeState,
    assembled_provider_context: Option<AssembledProviderContext>,
    assembled_provider_context_message_floor: Option<usize>,
}

impl Agent {
    fn should_track_client_cache(&self) -> bool {
        match std::env::var("JCODE_TRACK_CLIENT_CACHE") {
            Ok(value) => {
                let value = value.trim();
                !value.is_empty() && value != "0" && !value.eq_ignore_ascii_case("false")
            }
            Err(_) => false,
        }
    }

    fn build_base(
        provider: Arc<dyn Provider>,
        registry: Registry,
        session: Session,
        allowed_tools: Option<HashSet<String>>,
    ) -> Self {
        let skills = SkillRegistry::shared_snapshot();
        let initial_provider_model = provider.model();
        Self {
            provider,
            registry,
            skills,
            session,
            active_skill: None,
            allowed_tools,
            provider_session_id: None,
            last_upstream_provider: None,
            last_connection_type: None,
            last_status_detail: None,
            pending_alerts: Vec::new(),
            current_turn_system_reminder: None,
            tool_call_ids: HashSet::new(),
            tool_result_ids: HashSet::new(),
            tool_output_scan_index: 0,
            soft_interrupt_queue: Arc::new(std::sync::Mutex::new(Vec::new())),
            background_tool_signal: InterruptSignal::new(),
            graceful_shutdown: InterruptSignal::new(),
            cache_tracker: CacheTracker::new(),
            last_usage: TokenUsage::default(),
            locked_tools: None,
            system_prompt_override: None,
            memory_enabled: true,
            rewind_undo_snapshot: None,
            stdin_request_tx: None,
            provider_runtime_state: ProviderRuntimeState::observed(initial_provider_model),
            assembled_provider_context: None,
            assembled_provider_context_message_floor: None,
        }
    }

    fn current_skills_snapshot(&self) -> Arc<SkillRegistry> {
        self.registry
            .skills()
            .try_read()
            .map(|skills| Arc::new(skills.clone()))
            .unwrap_or_else(|_| self.skills.clone())
    }

    pub fn available_skill_names(&self) -> Vec<String> {
        self.current_skills_snapshot()
            .list()
            .iter()
            .map(|skill| skill.name.clone())
            .collect()
    }

    pub fn new(provider: Arc<dyn Provider>, registry: Registry) -> Self {
        let mut agent = Self::build_base(provider, registry, Session::create(None, None), None);
        agent.session.mark_active();
        agent.session.model = Some(agent.provider.model());
        agent.session.provider_key =
            crate::session::derive_session_provider_key(agent.provider.name());
        agent.session.ensure_initial_session_context_message();
        agent.seed_compaction_from_session();
        agent.log_env_snapshot("create");
        agent
    }

    pub fn new_with_session(
        provider: Arc<dyn Provider>,
        registry: Registry,
        session: Session,
        allowed_tools: Option<HashSet<String>>,
    ) -> Self {
        let mut agent = Self::build_base(provider, registry, session, allowed_tools);
        agent.session.mark_active();
        if agent.session.provider_key.is_none() {
            agent.session.provider_key =
                crate::session::derive_session_provider_key(agent.provider.name());
        }
        if let Some(model) = agent.session.model.clone() {
            if let Err(e) =
                crate::provider::set_model_with_auth_refresh(agent.provider.as_ref(), &model)
            {
                logging::error(&format!(
                    "Failed to restore session model '{}': {}",
                    model, e
                ));
            }
        } else {
            agent.session.model = Some(agent.provider.model());
        }
        agent.restore_reasoning_effort_from_session();
        agent.session.ensure_initial_session_context_message();
        agent.sync_memory_dedup_state_from_session();
        agent.seed_compaction_from_session();
        agent.log_env_snapshot("attach");
        agent
    }

    fn seed_compaction_from_session(&mut self) {
        logging::info(&format!(
            "seed_compaction_from_session: session has {} messages",
            self.session.messages.len()
        ));
        let compaction = self.registry.compaction();
        let mut manager = match compaction.try_write() {
            Ok(manager) => manager,
            Err(_) => {
                logging::warn(
                    "seed_compaction_from_session: compaction lock unavailable, skipping restore",
                );
                return;
            }
        };
        manager.reset();
        let budget = self.provider.context_window();
        manager.set_budget(budget);
        if let Some(state) = self.session.compaction.as_ref() {
            manager.restore_persisted_stored_state_with(state, &self.session.messages);
        } else {
            manager.seed_restored_stored_messages_with(&self.session.messages);
        }
        let sanitized_state = if manager.discard_oversized_openai_native_compaction() {
            Some(manager.persisted_state())
        } else {
            None
        };
        logging::info(&format!(
            "seed_compaction_from_session: seeded compaction with {} messages",
            self.session.messages.len()
        ));
        drop(manager);
        if let Some(state) = sanitized_state {
            self.session.compaction = state;
            self.persist_session_best_effort("sanitized oversized OpenAI native compaction");
        }
    }

    fn sync_memory_dedup_state_from_session(&self) {
        crate::memory::sync_injected_memories(
            &self.session.id,
            &self.session.injected_memory_ids(),
        );
    }

    fn record_memory_injection_in_session(&mut self, memory: &crate::memory::PendingMemory) {
        let count = memory.count.max(1);
        let age_ms = memory.computed_at.elapsed().as_millis() as u64;
        let summary = if count == 1 {
            "🧠 auto-recalled 1 memory".to_string()
        } else {
            format!("🧠 auto-recalled {} memories", count)
        };
        let display_prompt = memory.display_prompt.clone().unwrap_or_else(|| {
            if memory.prompt.trim().is_empty() {
                "# Memory\n\n## Notes\n1. (empty injection payload)".to_string()
            } else {
                memory.prompt.clone()
            }
        });

        self.session.record_memory_injection(
            summary,
            display_prompt,
            count as u32,
            age_ms,
            memory.memory_ids.clone(),
        );
        if let Err(err) = self.session.save() {
            logging::warn(&format!(
                "Failed to persist memory injection for session {}: {}",
                self.session.id, err
            ));
        }
    }

    fn persist_session_best_effort(&mut self, context: &str) {
        if let Err(err) = self.session.save() {
            logging::warn(&format!(
                "Failed to persist {} for session {}: {}",
                context, self.session.id, err
            ));
        }
    }

    fn reset_runtime_state_for_session_change(&mut self) {
        self.active_skill = None;
        self.last_upstream_provider = None;
        self.last_connection_type = None;
        self.last_status_detail = None;
        self.pending_alerts.clear();
        self.current_turn_system_reminder = None;
        self.reset_tool_output_tracking();
        if let Ok(mut queue) = self.soft_interrupt_queue.lock() {
            queue.clear();
        }
        self.background_tool_signal.reset();
        self.graceful_shutdown.reset();
        self.cache_tracker.reset();
        self.last_usage = TokenUsage::default();
        self.locked_tools = None;
        self.rewind_undo_snapshot = None;
        self.clear_assembled_provider_context();
    }

    fn sync_session_compaction_state_from_manager(
        &mut self,
        manager: &crate::compaction::CompactionManager,
    ) {
        let new_state = manager.persisted_state();
        if self.session.compaction != new_state {
            self.session.compaction = new_state;
            if let Err(err) = self.session.save() {
                logging::error(&format!(
                    "Failed to persist compaction state for session {}: {}",
                    self.session.id, err
                ));
            }
        }
    }

    fn apply_openai_native_compaction(
        &mut self,
        encrypted_content: String,
        compacted_count: usize,
    ) -> Result<()> {
        let encrypted_content_len = encrypted_content.len();
        let (summary_text, openai_encrypted_content) =
            if crate::provider::openai_request::openai_encrypted_content_is_sendable(
                &encrypted_content,
            ) {
                (String::new(), Some(encrypted_content))
            } else {
                logging::warn(&format!(
                    "Discarding oversized OpenAI native compaction payload before persist ({} chars)",
                    encrypted_content_len,
                ));
                (
                    crate::provider::openai_request::openai_encrypted_content_fallback_summary(
                        encrypted_content_len,
                    ),
                    None,
                )
            };
        let state = crate::session::StoredCompactionState {
            summary_text,
            openai_encrypted_content,
            covers_up_to_turn: compacted_count,
            original_turn_count: compacted_count,
            compacted_count,
        };

        self.session.compaction = Some(state.clone());
        let compaction = self.registry.compaction();
        if let Ok(mut manager) = compaction.try_write() {
            manager.set_budget(self.provider.context_window());
            manager.restore_persisted_stored_state_with(&state, &self.session.messages);
        }

        self.cache_tracker.reset();
        self.locked_tools = None;
        self.provider_session_id = None;
        self.session.provider_session_id = None;
        self.session.save()?;
        crate::runtime_memory_log::emit_event(
            crate::runtime_memory_log::RuntimeMemoryLogEvent::new(
                "native_compaction_applied",
                "provider_native_compaction_persisted",
            )
            .with_session_id(self.session.id.clone())
            .force_attribution(),
        );
        Ok(())
    }

    #[cfg(test)]
    fn messages_for_provider(&mut self) -> (Vec<Message>, Option<CompactionEvent>) {
        let supports_image_input = self.provider.supports_image_input();
        if self.provider.supports_compaction() || self.session.compaction.is_some() {
            let compaction = self.registry.compaction();
            match compaction.try_write() {
                Ok(mut manager) => {
                    let discarded_oversized_native =
                        manager.discard_oversized_openai_native_compaction();
                    let messages = {
                        let all_messages = self.session.provider_messages();
                        let provider_context_messages = filter_messages_for_provider_context(
                            all_messages.to_vec(),
                            supports_image_input,
                        );
                        if self.provider.uses_jcode_compaction() {
                            let action = manager.ensure_context_fits(
                                &provider_context_messages,
                                self.provider.clone(),
                            );
                            match action {
                                crate::compaction::CompactionAction::BackgroundStarted {
                                    trigger,
                                } => {
                                    logging::info(&format!(
                                        "Background compaction started ({})",
                                        trigger
                                    ));
                                }
                                crate::compaction::CompactionAction::HardCompacted(dropped) => {
                                    logging::warn(&format!(
                                        "Emergency hard compact: dropped {} messages (context was critical)",
                                        dropped
                                    ));
                                }
                                crate::compaction::CompactionAction::None => {}
                            }
                        }
                        manager.messages_for_api_with(&provider_context_messages)
                    };
                    let event = manager.take_compaction_event();
                    if event.is_some() || discarded_oversized_native {
                        self.sync_session_compaction_state_from_manager(&manager);
                    }
                    if event.is_some() {
                        self.note_compaction_applied();
                        self.persist_session_best_effort("compaction completion");
                    }
                    let user_count = messages
                        .iter()
                        .filter(|message| matches!(message.role, Role::User))
                        .count();
                    let assistant_count = messages.len().saturating_sub(user_count);
                    logging::info(&format!(
                        "messages_for_provider (compaction): returning {} messages (user={}, assistant={})",
                        messages.len(),
                        user_count,
                        assistant_count,
                    ));
                    return (messages, event);
                }
                Err(_) => {
                    logging::info("messages_for_provider: compaction lock failed, using session");
                }
            };
        }

        let all_messages = self.session.provider_messages();
        let messages =
            filter_messages_for_provider_context(all_messages.to_vec(), supports_image_input);
        let user_count = messages
            .iter()
            .filter(|message| matches!(message.role, Role::User))
            .count();
        let assistant_count = messages.len().saturating_sub(user_count);
        logging::info(&format!(
            "messages_for_provider (session): returning {} messages (user={}, assistant={})",
            messages.len(),
            user_count,
            assistant_count,
        ));
        (messages, None)
    }

    fn bootstrap_assembled_provider_context_from_session(&mut self) {
        if self.assembled_provider_context.is_some() {
            return;
        }
        let Ok(store) = crate::memory::agent_runtime::AgentMemoryStore::new_default() else {
            return;
        };
        if let Err(err) = store.ensure_session_with_id(
            &self.session.id,
            crate::memory::agent_runtime::CreateSessionInput {
                title: Some(self.session.display_title_or_name().to_string()),
                working_dir: self.session.working_dir.clone(),
                provider_key: self.session.provider_key.clone(),
                model: self
                    .session
                    .model
                    .clone()
                    .or_else(|| Some(self.provider.model())),
            },
        ) {
            logging::warn(&format!(
                "Failed to ensure memory session before provider context assembly: {}",
                err
            ));
            return;
        }

        let runtime_turn_id = crate::id::new_id("runtime-turn");
        let existing_events = match store.read_events_by_session(&self.session.id) {
            Ok(events) => events,
            Err(err) => {
                logging::warn(&format!(
                    "Failed to read memory events before provider context assembly: {}",
                    err
                ));
                Vec::new()
            }
        };
        let existing_source_ids = existing_events
            .iter()
            .filter_map(stored_message_bootstrap_source_id)
            .collect::<HashSet<_>>();
        let mut latest_user_event_id = existing_events
            .iter()
            .rev()
            .find(|event| {
                event.role == crate::memory::agent_runtime::EventRole::User
                    && event.visibility == crate::memory::agent_runtime::Visibility::UserVisible
            })
            .map(|event| event.event_id.clone());

        for message in &self.session.messages {
            if existing_source_ids.contains(&message.id) {
                continue;
            }
            for event in bootstrap_events_from_stored_message(message, &runtime_turn_id) {
                match store.append_event(&self.session.id, event) {
                    Ok(record) => {
                        if record.role == crate::memory::agent_runtime::EventRole::User
                            && record.visibility
                                == crate::memory::agent_runtime::Visibility::UserVisible
                        {
                            latest_user_event_id = Some(record.event_id);
                        }
                    }
                    Err(err) => logging::warn(&format!(
                        "Failed to bootstrap stored message {} into memory context: {}",
                        message.id, err
                    )),
                }
            }
        }

        if let Err(err) = store.start_runtime_turn_with_id(
            &self.session.id,
            runtime_turn_id.clone(),
            latest_user_event_id.as_deref(),
            None,
        ) {
            logging::warn(&format!(
                "Failed to start memory runtime turn before provider context assembly: {}",
                err
            ));
            return;
        }
        let snapshot = match store.build_context(
            &self.session.id,
            &runtime_turn_id,
            self.provider.context_window() as i64,
        ) {
            Ok(snapshot) => snapshot,
            Err(err) => {
                logging::warn(&format!(
                    "Failed to build provider context from memory snapshot: {}",
                    err
                ));
                return;
            }
        };
        let messages = messages_from_context_snapshot(&snapshot, None);
        self.assembled_provider_context = Some(AssembledProviderContext {
            session_id: snapshot.session_id.clone(),
            runtime_turn_id: snapshot.runtime_turn_id.clone(),
            context_snapshot_id: snapshot.context_snapshot_id.clone(),
            messages,
            dynamic_system_context: assembled_context_dynamic_system_context(&snapshot),
        });
        self.assembled_provider_context_message_floor = None;
    }

    fn refresh_assembled_provider_context_from_memory(&mut self) {
        let Some(existing) = self.assembled_provider_context.clone() else {
            return;
        };
        let latest_user_replacement = replacement_latest_user_message(&existing);
        let Ok(store) = crate::memory::agent_runtime::AgentMemoryStore::new_default() else {
            return;
        };
        let Ok(snapshot) = store.build_context(
            &existing.session_id,
            &existing.runtime_turn_id,
            self.provider.context_window() as i64,
        ) else {
            return;
        };
        let messages = messages_from_context_snapshot(&snapshot, latest_user_replacement.as_ref());
        self.assembled_provider_context = Some(AssembledProviderContext {
            session_id: snapshot.session_id.clone(),
            runtime_turn_id: snapshot.runtime_turn_id.clone(),
            context_snapshot_id: snapshot.context_snapshot_id.clone(),
            messages,
            dynamic_system_context: assembled_context_dynamic_system_context(&snapshot),
        });
        self.assembled_provider_context_message_floor = None;
    }

    fn provider_messages_from_context_assembler(
        &mut self,
    ) -> (Vec<Message>, Option<CompactionEvent>) {
        self.bootstrap_assembled_provider_context_from_session();
        self.refresh_assembled_provider_context_from_memory();
        let Some(context) = self.assembled_provider_context.clone() else {
            logging::error(
                "provider_messages_from_context_assembler: missing context snapshot; refusing old transcript provider input",
            );
            return (Vec::new(), None);
        };

        let supports_image_input = self.provider.supports_image_input();
        let messages = filter_messages_for_provider_context(context.messages, supports_image_input);
        let user_count = messages
            .iter()
            .filter(|message| matches!(message.role, Role::User))
            .count();
        let assistant_count = messages.len().saturating_sub(user_count);
        logging::info(&format!(
            "provider_messages_from_context_assembler: context_snapshot={} messages={} user={} assistant={}",
            context.context_snapshot_id,
            messages.len(),
            user_count,
            assistant_count,
        ));
        (messages, None)
    }

    fn provider_messages_for_context_management(&mut self) -> Vec<Message> {
        #[cfg(not(test))]
        {
            let (messages, _) = self.provider_messages_from_context_assembler();
            messages
        }
        #[cfg(test)]
        {
            self.session.messages_for_provider()
        }
    }

    fn record_assistant_provider_event(&self, text: &str, tool_calls: &[ToolCall]) {
        let Some(context) = self.assembled_provider_context.as_ref() else {
            return;
        };
        if text.trim().is_empty() && tool_calls.is_empty() {
            return;
        }
        let Ok(store) = crate::memory::agent_runtime::AgentMemoryStore::new_default() else {
            return;
        };
        let tool_calls_json = tool_calls
            .iter()
            .map(|tool| {
                serde_json::json!({
                    "id": tool.id,
                    "name": tool.name,
                    "input": tool.input
                })
            })
            .collect::<Vec<_>>();
        let event = crate::memory::agent_runtime::NewSessionEvent {
            kind: "assistant_message".to_string(),
            role: crate::memory::agent_runtime::EventRole::Assistant,
            payload: serde_json::json!({
                "text": text,
                "toolCalls": tool_calls_json
            }),
            visibility: crate::memory::agent_runtime::Visibility::UserVisible,
            model_context_policy: crate::memory::agent_runtime::ModelContextPolicy::Include,
            ui_policy: crate::memory::agent_runtime::UiPolicy::ShowInTimeline,
            runtime_turn_id: Some(context.runtime_turn_id.clone()),
            lineage_json: serde_json::json!({ "provider": self.provider.name() }),
        };
        if let Err(error) = store.append_event(&context.session_id, event) {
            logging::warn(&format!(
                "Failed to record assistant provider event for runtime turn {}: {}",
                context.runtime_turn_id, error
            ));
        }
        for tool in tool_calls {
            if let Err(error) = store.record_tool_call_started(
                &context.session_id,
                &context.runtime_turn_id,
                &tool.id,
                &tool.name,
                tool.input.clone(),
            ) {
                logging::warn(&format!(
                    "Failed to record tool call {} for runtime turn {}: {}",
                    tool.id, context.runtime_turn_id, error
                ));
            }
        }
    }

    fn record_user_context_provider_event(&self, content: &[ContentBlock]) {
        let Some(context) = self.assembled_provider_context.as_ref() else {
            return;
        };
        if content.is_empty() {
            return;
        }
        let Ok(store) = crate::memory::agent_runtime::AgentMemoryStore::new_default() else {
            return;
        };
        let event = crate::memory::agent_runtime::NewSessionEvent {
            kind: "user_context_message".to_string(),
            role: crate::memory::agent_runtime::EventRole::User,
            payload: serde_json::json!({ "contentBlocks": content }),
            visibility: crate::memory::agent_runtime::Visibility::UserVisible,
            model_context_policy: crate::memory::agent_runtime::ModelContextPolicy::Include,
            ui_policy: crate::memory::agent_runtime::UiPolicy::ShowInTimeline,
            runtime_turn_id: Some(context.runtime_turn_id.clone()),
            lineage_json: serde_json::json!({ "source": "provider_context_attachment" }),
        };
        if let Err(error) = store.append_event(&context.session_id, event) {
            logging::warn(&format!(
                "Failed to record user context provider event for runtime turn {}: {}",
                context.runtime_turn_id, error
            ));
        }
    }

    fn record_tool_result_provider_event(
        &self,
        tool: &ToolCall,
        status: crate::memory::agent_runtime::ToolResultStatus,
        content: String,
        error: Option<String>,
    ) {
        let Some(context) = self.assembled_provider_context.as_ref() else {
            return;
        };
        let Ok(store) = crate::memory::agent_runtime::AgentMemoryStore::new_default() else {
            return;
        };
        let recommended_next_actions = if error.is_some() {
            vec!["inspect_runtime_state_before_retry".to_string()]
        } else {
            Vec::new()
        };
        if let Err(err) = store.append_tool_result_for_call(
            &context.session_id,
            &context.runtime_turn_id,
            &tool.id,
            &tool.name,
            status,
            tool.input.clone(),
            serde_json::json!({ "content": content, "error": error }),
            recommended_next_actions,
        ) {
            logging::warn(&format!(
                "Failed to record tool result {} for runtime turn {}: {}",
                tool.id, context.runtime_turn_id, err
            ));
        }
    }

    fn context_assembler_dynamic_system_context(&self) -> Option<&str> {
        self.assembled_provider_context
            .as_ref()
            .and_then(|context| context.dynamic_system_context.as_deref())
    }

    fn record_provider_request_started(
        &self,
        tools: &[ToolDefinition],
        messages: &[Message],
        system_static: &str,
        system_dynamic: &str,
        resume_session_id: Option<&str>,
    ) -> Option<String> {
        let context = self.assembled_provider_context.as_ref()?;
        let store = crate::memory::agent_runtime::AgentMemoryStore::new_default().ok()?;
        let request_json = serde_json::json!({
            "messageCount": messages.len(),
            "messageHashes": message_hashes(messages),
            "systemStaticHash": stable_hash_str(system_static),
            "systemDynamicHash": stable_hash_str(system_dynamic),
            "resumeSessionId": resume_session_id,
        });
        let provider_model = self
            .session
            .model
            .clone()
            .unwrap_or_else(|| self.provider.model());
        match store.record_provider_request_started(
            &context.session_id,
            &context.runtime_turn_id,
            &context.context_snapshot_id,
            serde_json::to_value(tools).unwrap_or_else(|_| serde_json::json!([])),
            self.session.provider_key.as_deref(),
            Some(provider_model.as_str()),
            request_json,
        ) {
            Ok(provider_request_id) => Some(provider_request_id),
            Err(error) => {
                logging::warn(&format!(
                    "Failed to record provider request for context {}: {}",
                    context.context_snapshot_id, error
                ));
                None
            }
        }
    }

    fn record_provider_request_finished(
        &self,
        provider_request_id: Option<&str>,
        status: &str,
        usage: Option<serde_json::Value>,
        error: Option<serde_json::Value>,
    ) {
        let (Some(context), Some(provider_request_id)) = (
            self.assembled_provider_context.as_ref(),
            provider_request_id,
        ) else {
            return;
        };
        let Ok(store) = crate::memory::agent_runtime::AgentMemoryStore::new_default() else {
            return;
        };
        if let Err(err) = store.record_provider_request_finished(
            &context.session_id,
            &context.runtime_turn_id,
            provider_request_id,
            status,
            usage,
            error,
        ) {
            logging::warn(&format!(
                "Failed to finish provider request {}: {}",
                provider_request_id, err
            ));
        }
    }

    fn record_client_cache_request(&mut self, messages: &[Message]) {
        if !self.should_track_client_cache() {
            return;
        }

        let fast_snapshot =
            if !self.provider.uses_jcode_compaction() && self.session.compaction.is_none() {
                let previous_count = self.cache_tracker.previous_message_count();
                let prefix_hashes = self.session.provider_message_prefix_hashes();
                let current_count = prefix_hashes.len();
                let current_full_hash = prefix_hashes.last().copied();
                let prefix_hash_at_previous_count =
                    if previous_count == 0 || previous_count > current_count {
                        None
                    } else {
                        Some(prefix_hashes[previous_count - 1])
                    };
                Some((
                    current_count,
                    prefix_hash_at_previous_count,
                    current_full_hash,
                ))
            } else {
                None
            };

        let violation =
            if let Some((current_count, prefix_hash_at_previous_count, current_full_hash)) =
                fast_snapshot
            {
                self.cache_tracker.record_prefix_hash_snapshot(
                    current_count,
                    prefix_hash_at_previous_count,
                    current_full_hash,
                )
            } else {
                self.cache_tracker.record_request(messages)
            };

        if let Some(violation) = violation {
            logging::warn(&format!(
                "CLIENT_CACHE_VIOLATION: {} | turn={} messages={}",
                violation.reason, violation.turn, violation.message_count
            ));
        }
    }

    fn repair_missing_tool_outputs(&mut self) -> usize {
        if self.tool_output_scan_index > self.session.messages.len() {
            self.reset_tool_output_tracking();
        }

        let scan_start = self.tool_output_scan_index;
        let mut new_result_ids = Vec::new();
        let mut assistant_tool_uses: Vec<(usize, Vec<String>)> = Vec::new();

        for (index, msg) in self.session.messages.iter().enumerate().skip(scan_start) {
            match msg.role {
                Role::User => {
                    for block in &msg.content {
                        if let ContentBlock::ToolResult { tool_use_id, .. } = block {
                            new_result_ids.push(tool_use_id.clone());
                        }
                    }
                }
                Role::Assistant => {
                    let tool_uses = msg
                        .content
                        .iter()
                        .filter_map(|block| match block {
                            ContentBlock::ToolUse { id, .. } => Some(id.clone()),
                            _ => None,
                        })
                        .collect::<Vec<_>>();
                    if !tool_uses.is_empty() {
                        assistant_tool_uses.push((index, tool_uses));
                    }
                }
            }
        }

        self.tool_result_ids.extend(new_result_ids);

        let mut missing_repairs: Vec<(usize, Vec<String>)> = Vec::new();
        for (index, tool_uses) in assistant_tool_uses {
            let mut missing_for_message = Vec::new();
            for id in tool_uses {
                self.tool_call_ids.insert(id.clone());
                if !self.tool_result_ids.contains(&id) {
                    missing_for_message.push(id);
                }
            }
            if !missing_for_message.is_empty() {
                missing_repairs.push((index, missing_for_message));
            }
        }

        self.tool_output_scan_index = self.session.messages.len();

        let mut repaired = 0usize;
        let mut inserted = 0usize;
        for (index, missing_for_message) in missing_repairs {
            for (offset, id) in missing_for_message.iter().enumerate() {
                let tool_block = ContentBlock::ToolResult {
                    tool_use_id: id.clone(),
                    content: TOOL_OUTPUT_MISSING_TEXT.to_string(),
                    is_error: Some(true),
                };
                let stored_message = StoredMessage {
                    id: id::new_id("message"),
                    role: Role::User,
                    content: vec![tool_block],
                    display_role: None,
                    timestamp: Some(chrono::Utc::now()),
                    tool_duration_ms: None,
                    token_usage: None,
                };
                self.session
                    .insert_message(index + 1 + inserted + offset, stored_message);
                self.tool_result_ids.insert(id.clone());
                repaired += 1;
            }
            inserted += missing_for_message.len();
        }

        self.tool_output_scan_index = self.session.messages.len();

        if repaired > 0 {
            self.persist_session_best_effort("missing tool-output repair");
            self.cache_tracker.reset();
            self.locked_tools = None;
        }

        repaired
    }

    fn reset_tool_output_tracking(&mut self) {
        self.tool_call_ids.clear();
        self.tool_result_ids.clear();
        self.tool_output_scan_index = 0;
    }

    pub fn session_id(&self) -> &str {
        &self.session.id
    }

    pub fn set_assembled_provider_context(&mut self, context: AssembledProviderContext) {
        self.assembled_provider_context = Some(context);
        self.assembled_provider_context_message_floor = None;
        self.cache_tracker.reset();
        self.locked_tools = None;
    }

    pub fn clear_assembled_provider_context(&mut self) {
        self.assembled_provider_context = None;
        self.assembled_provider_context_message_floor = None;
    }

    fn freeze_assembled_provider_context_message_floor(&mut self) {
        if let Some(context) = self.assembled_provider_context.as_ref()
            && self.assembled_provider_context_message_floor.is_none()
        {
            self.assembled_provider_context_message_floor = Some(context.messages.len());
        }
    }

    pub(crate) fn set_working_dir_for_pending_context(&mut self, working_dir: Option<String>) {
        if working_dir.is_some() {
            self.session.working_dir = working_dir;
            self.session.refresh_initial_session_context_message();
        }
    }

    /// Mark this agent session as closed and persist it.
    pub fn mark_closed(&mut self) {
        self.persist_soft_interrupt_snapshot();
        self.session.mark_closed();
        if !self.session.messages.is_empty() {
            self.persist_session_best_effort("session close state");
        }
    }

    pub fn mark_crashed(&mut self, message: Option<String>) {
        self.persist_soft_interrupt_snapshot();
        self.session.mark_crashed(message);
        if !self.session.messages.is_empty() {
            self.persist_session_best_effort("session crash state");
        }
    }

    /// Get the last token usage from the most recent API request
    pub fn last_usage(&self) -> &TokenUsage {
        &self.last_usage
    }

    /// Export the full conversation as a markdown transcript.
    pub fn export_conversation_markdown(&self) -> String {
        let mut md = String::new();
        for msg in &self.session.messages {
            let role_label = match msg.role {
                Role::User => "User",
                Role::Assistant => "Assistant",
            };
            md.push_str(&format!("### {}\n\n", role_label));
            for block in &msg.content {
                match block {
                    ContentBlock::Text { text, .. } => {
                        md.push_str(text);
                        md.push_str("\n\n");
                    }
                    ContentBlock::Reasoning { text } => {
                        md.push_str(&format!("*Thinking:* {}\n\n", text));
                    }
                    ContentBlock::ToolUse { name, input, .. } => {
                        let input_str = serde_json::to_string_pretty(input)
                            .unwrap_or_else(|_| input.to_string());
                        md.push_str(&format!(
                            "**Tool: `{}`**\n```json\n{}\n```\n\n",
                            name, input_str
                        ));
                    }
                    ContentBlock::ToolResult {
                        content, is_error, ..
                    } => {
                        let label = if is_error == &Some(true) {
                            "Error"
                        } else {
                            "Result"
                        };
                        // Truncate very long results
                        let display = if content.len() > 2000 {
                            format!(
                                "{}... (truncated, {} chars total)",
                                crate::util::truncate_str(content, 2000),
                                content.len()
                            )
                        } else {
                            content.clone()
                        };
                        md.push_str(&format!("**{}:**\n```\n{}\n```\n\n", label, display));
                    }
                    ContentBlock::Image { .. } => {
                        md.push_str("[Image]\n\n");
                    }
                    ContentBlock::OpenAICompaction { .. } => {
                        md.push_str("[OpenAI native compaction]\n\n");
                    }
                }
            }
        }
        md
    }
}

#[cfg(test)]
#[path = "agent_tests.rs"]
mod tests;
