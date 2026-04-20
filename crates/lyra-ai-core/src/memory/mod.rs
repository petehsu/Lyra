use std::collections::{BTreeMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use napi::Result;
use once_cell::sync::Lazy;
use regex::Regex;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::agent::emit_runtime_event;
use crate::agent::types::AgentRuntimeEvent;
use crate::auth::service::resolve_secret_values;
use crate::auth::store::KeyringSecretStore;
use crate::error::{
    ms_to_iso, normalize_required_text, now_iso, now_ms, parse_json, to_error, to_json,
};
use crate::paths::{ensure_ai_dirs, resolve_ai_paths, AiPaths};
use crate::profile::types::{AiProviderProfile, StoredAiProviderProfile};
use crate::provider;
use crate::provider::types::{fallback_models, AgentInferenceMessage, AgentInferenceMessageRole};
use crate::storage::registry_db;
use crate::storage::schema::{ensure_registry_schema, open_sqlite};

const MEMORY_ARCHITECTURE_RESET_KEY: &str = "memory_architecture_reset_v1";
const MEMORY_CONFIG_FILENAME: &str = "memory_config.json";
const SHARED_MEMORY_FILENAME: &str = "shared_memory.md";
const SHARED_AUDIT_FILENAME: &str = "shared_memory.audit.jsonl";
const FROZEN_MEMORY_FILENAME: &str = "frozen_memory.md";
const FROZEN_AUDIT_FILENAME: &str = "frozen_memory.audit.jsonl";
const DYNAMIC_PROMPT_CACHE_FILENAME: &str = "dynamic_prompt_cache.md";
const SHARED_INDEX_FILENAME: &str = "shared_index.sqlite";
const TRIGGER_MARKS_FILENAME: &str = "trigger_marks.sqlite";
const MEMORY_JOBS_FILENAME: &str = "memory_jobs.sqlite";
const PROMPT_CACHE_FILENAME: &str = "prompt_cache.sqlite";
const MEMORY_COMPACTION_LOG_FILENAME: &str = "memory_compaction.log";
const MAX_PROMPT_CACHE_ENTRIES: usize = 12;
const COMPACTION_ENTRY_TRIGGER_COUNT: usize = 6;
const MEMORY_SCHEDULER_BATCH_LIMIT: i64 = 32;
const MEMORY_JOB_LEASE_MS: i64 = 30_000;
const MEMORY_JOB_RETRY_BACKOFF_MS: i64 = 15_000;
const MEMORY_COMPACTION_TARGET_COUNT: usize = 4;

static LONG_TERM_TRIGGER_REGEXES: Lazy<Vec<(Regex, &'static str, f64)>> = Lazy::new(|| {
    vec![
        // Preferences
        (
            Regex::new(r"(?i)\b(always|never|prefer|please use|remember|default to|avoid|don't use|use .+ instead)\b")
                .expect("long-term regex 1"),
            "preference",
            0.92,
        ),
        // Coding style preferences
        (
            Regex::new(r"(?i)\b(coding style|naming convention|indent|tabs|spaces|semicolons|single quotes|double quotes)\b")
                .expect("long-term regex coding-style"),
            "preference",
            0.90,
        ),
        // Framework/language preferences
        (
            Regex::new(r"(?i)\b(use (react|vue|angular|svelte|tailwind|rust|python|typescript|go))\b")
                .expect("long-term regex framework"),
            "preference",
            0.89,
        ),
        // Project constraints
        (
            Regex::new(r"(?i)\b(project|repo|codebase|workspace|build command|test command|deploy)\b")
                .expect("long-term regex 2"),
            "project_constraint",
            0.88,
        ),
        // Build and test commands
        (
            Regex::new(r"(?i)\b(npm run|pnpm|yarn|cargo|make|gradle|maven|pytest|jest|vitest)\s")
                .expect("long-term regex build"),
            "project_constraint",
            0.90,
        ),
        // Profile info
        (
            Regex::new(r"(?i)\b(my name is|i am|i'm|my email|my role|i work as|language|timezone|locale)\b")
                .expect("long-term regex 3"),
            "profile",
            0.90,
        ),
        // Corrections/updates
        (
            Regex::new(r"(?i)\b(actually|correction|i meant|update that|change that to|not .+ but)\b")
                .expect("long-term regex correction"),
            "correction",
            0.88,
        ),
        // Chinese preferences
        (
            Regex::new(r"(请记住|以后|默认|不要|总是|偏好|习惯|风格)")
                .expect("long-term regex cn-pref"),
            "preference",
            0.90,
        ),
        // Chinese project constraints
        (
            Regex::new(r"(项目|仓库|代码库|构建命令|测试命令|部署)")
                .expect("long-term regex cn-project"),
            "project_constraint",
            0.88,
        ),
        // Chinese profile
        (
            Regex::new(r"(我叫|我的名字|我是|语言|时区|电邮)")
                .expect("long-term regex cn-profile"),
            "profile",
            0.90,
        ),
        // Chinese corrections
        (
            Regex::new(r"(更正|其实|不对|应该是|改成)")
                .expect("long-term regex cn-correction"),
            "correction",
            0.88,
        ),
    ]
});

/// Patterns indicating volatile/temporary content — reduce trigger score
static VOLATILE_EXCLUSION_REGEXES: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        Regex::new(
            r"(?i)\b(just this time|for now only|temporarily|one-off|this once|only for this)\b",
        )
        .expect("volatile regex 1"),
        Regex::new(r"(只是这次|暂时|临时|仅这一次|这次而已)").expect("volatile regex cn"),
    ]
});

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiMemoryConfig {
    pub version: u32,
    pub default_context_window: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_analysis_profile_id: Option<String>,
    pub output_reserve_min_tokens: i64,
    pub output_reserve_max_tokens: i64,
    pub system_reserve_min_tokens: i64,
    pub system_reserve_max_tokens: i64,
    pub shared_injection_min_tokens: i64,
    pub shared_injection_max_tokens: i64,
    pub tool_history_min_tokens: i64,
    pub tool_history_max_tokens: i64,
    pub guard_slack_min_tokens: i64,
    pub guard_slack_max_tokens: i64,
    pub live_budget_cap_tokens: i64,
    pub head_ratio: f64,
    pub middle_ratio: f64,
    pub tail_ratio: f64,
    pub trim_extra_min_tokens: i64,
    pub trim_extra_ratio: f64,
    pub checkpoint_min_tokens: i64,
    pub checkpoint_ratio: f64,
    pub syntax_cooldown_ms: i64,
    pub checkpoint_batch_size: i64,
    pub checkpoint_cpu_budget_ms: i64,
    pub cut_dedupe_similarity_threshold: f64,
    pub cuts_size_trigger_bytes: i64,
    pub cuts_size_target_bytes: i64,
    pub shared_classify_score_threshold: f64,
    pub enable_model_guided_compaction: bool,
    /// Manual model tier override: "small", "medium", "large"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_tier_override: Option<String>,
    /// Context window threshold for medium tier (default 64000)
    #[serde(default = "default_medium_tier_threshold")]
    pub medium_tier_threshold: i64,
    /// Context window threshold for large tier (default 200000)
    #[serde(default = "default_large_tier_threshold")]
    pub large_tier_threshold: i64,
    /// Enable model-based refinement for syntax triggers
    #[serde(default = "default_true")]
    pub syntax_model_refine_enabled: bool,
    /// Max syntax trigger jobs per session per 60s
    #[serde(default = "default_syntax_rate_limit")]
    pub syntax_rate_limit_per_minute: i64,
    /// Enable model-based summarization when trimming archived messages
    #[serde(default)]
    pub enable_trim_summarization: bool,
    /// Max token budget for loading cut files during recall (0 = unlimited)
    #[serde(default = "default_cut_recall_budget")]
    pub cut_recall_token_budget: i64,
    /// Max tokens for a single message before it gets truncated in context
    #[serde(default = "default_message_truncate_tokens")]
    pub message_truncate_tokens: i64,
}

fn default_medium_tier_threshold() -> i64 {
    64_000
}
fn default_large_tier_threshold() -> i64 {
    200_000
}
fn default_true() -> bool {
    true
}
fn default_syntax_rate_limit() -> i64 {
    3
}
fn default_cut_recall_budget() -> i64 {
    80_000
}
fn default_message_truncate_tokens() -> i64 {
    2_000
}

impl Default for AiMemoryConfig {
    fn default() -> Self {
        Self {
            version: 1,
            default_context_window: 200_000,
            memory_analysis_profile_id: None,
            output_reserve_min_tokens: 4_000,
            output_reserve_max_tokens: 16_000,
            system_reserve_min_tokens: 2_000,
            system_reserve_max_tokens: 8_000,
            shared_injection_min_tokens: 3_000,
            shared_injection_max_tokens: 30_000,
            tool_history_min_tokens: 2_000,
            tool_history_max_tokens: 15_000,
            guard_slack_min_tokens: 3_000,
            guard_slack_max_tokens: 8_000,
            live_budget_cap_tokens: 500_000,
            head_ratio: 0.10,
            middle_ratio: 0.25,
            tail_ratio: 0.65,
            trim_extra_min_tokens: 6_000,
            trim_extra_ratio: 0.10,
            checkpoint_min_tokens: 6_000,
            checkpoint_ratio: 0.15,
            syntax_cooldown_ms: 30_000,
            checkpoint_batch_size: 24,
            checkpoint_cpu_budget_ms: 250,
            cut_dedupe_similarity_threshold: 0.985,
            cuts_size_trigger_bytes: 32 * 1024 * 1024,
            cuts_size_target_bytes: 24 * 1024 * 1024,
            shared_classify_score_threshold: 0.82,
            enable_model_guided_compaction: false,
            model_tier_override: None,
            medium_tier_threshold: 64_000,
            large_tier_threshold: 200_000,
            syntax_model_refine_enabled: true,
            syntax_rate_limit_per_minute: 3,
            enable_trim_summarization: false,
            cut_recall_token_budget: 80_000,
            message_truncate_tokens: 2_000,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAiMemoryConfigRequest {
    pub storage_root: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAiMemoryConfigRequest {
    pub storage_root: String,
    pub config: AiMemoryConfig,
}

#[derive(Clone, Debug)]
pub struct MemoryRuntimePhaseEvent {
    pub phase: String,
    pub payload: Value,
}

#[derive(Clone, Debug)]
pub struct MemoryTurnContext {
    pub messages: Vec<AgentInferenceMessage>,
    pub memory_snapshot: MemoryPromptSnapshot,
}

#[derive(Clone, Debug, Default)]
pub struct MemoryPromptSnapshot {
    pub memory_recall_results: String,
    pub user_habits_and_preferences: String,
    pub frozen_memory_facts: String,
}

#[derive(Clone, Debug)]
pub struct MemorySessionMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub turn_id: Option<String>,
    pub created_at: i64,
    pub token_count: i64,
    pub char_count: i64,
    pub anchor_score: f64,
    pub anchor_kind: Option<String>,
    pub project_root: Option<String>,
}

#[derive(Clone, Debug)]
struct MemoryPaths {
    ai: AiPaths,
    config_path: PathBuf,
    shared_memory_path: PathBuf,
    shared_audit_path: PathBuf,
    frozen_memory_path: PathBuf,
    frozen_audit_path: PathBuf,
    dynamic_prompt_cache_path: PathBuf,
    shared_index_db_path: PathBuf,
    trigger_marks_db_path: PathBuf,
    memory_jobs_db_path: PathBuf,
    prompt_cache_db_path: PathBuf,
    compaction_log_path: PathBuf,
}

#[derive(Clone, Debug)]
struct SessionMemoryPaths {
    session_root: PathBuf,
    session_db_path: PathBuf,
    cuts_root: PathBuf,
    manifests_root: PathBuf,
}

#[derive(Clone, Debug)]
struct MemoryBudget {
    shared_budget: i64,
    head_budget: i64,
    middle_budget: i64,
    tail_budget: i64,
    trim_trigger: i64,
    checkpoint_trigger: i64,
}

#[derive(Clone, Debug)]
struct SyntaxTriggerHit {
    kind: String,
    score: f64,
}

#[derive(Clone, Debug)]
struct SharedMemoryEntry {
    id: String,
    layer: String,
    scope: String,
    project_root: Option<String>,
    content: String,
    source_session_id: Option<String>,
    source_message_id: Option<String>,
    stable_key: String,
    content_hash: String,
    revision: i64,
    accepted: bool,
    score: f64,
    last_used: Option<i64>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoryJobPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    project_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trigger_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    threshold_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    layer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    scope: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoryAnalysisDecision {
    accepted: bool,
    layer: String,
    scope: String,
    content: String,
    score: f64,
    update_mode: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoryCompactionDecision {
    items: Vec<MemoryCompactionItem>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoryCompactionItem {
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    score: Option<f64>,
}

#[derive(Clone, Debug)]
struct EmittedMemoryEvent {
    session_id: String,
    event: MemoryRuntimePhaseEvent,
}

pub fn get_config(request: GetAiMemoryConfigRequest) -> Result<AiMemoryConfig> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    load_memory_config(&storage_root)
}

pub fn update_config(request: UpdateAiMemoryConfigRequest) -> Result<AiMemoryConfig> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let paths = ensure_memory_bootstrap(&storage_root)?;
    let mut config = request.config;
    sanitize_config(&mut config);
    fs::write(&paths.config_path, to_json(&config)?).map_err(|error| {
        to_error(format!(
            "failed to write memory config {}: {error}",
            paths.config_path.display()
        ))
    })?;
    Ok(config)
}

pub fn initialize_session_storage(storage_root: &str, session_id: &str) -> Result<()> {
    let paths = ensure_memory_bootstrap(storage_root)?;
    let session_paths = resolve_session_memory_paths(&paths, session_id);
    ensure_session_dirs(&session_paths)?;
    let connection = open_sqlite(&session_paths.session_db_path)?;
    ensure_session_schema(&connection)?;
    Ok(())
}

pub fn delete_session_storage(storage_root: &str, session_id: &str) -> Result<()> {
    let paths = ensure_memory_bootstrap(storage_root)?;
    let session_paths = resolve_session_memory_paths(&paths, session_id);
    if session_paths.session_root.exists() {
        fs::remove_dir_all(&session_paths.session_root).map_err(|error| {
            to_error(format!(
                "failed to remove memory session directory {}: {error}",
                session_paths.session_root.display()
            ))
        })?;
    }
    Ok(())
}

pub fn append_session_dialog_message(
    storage_root: &str,
    session_id: &str,
    message_id: &str,
    role: &str,
    content: &str,
    turn_id: Option<&str>,
    project_root: Option<&str>,
) -> Result<Vec<MemoryRuntimePhaseEvent>> {
    let paths = ensure_memory_bootstrap(storage_root)?;
    let config = load_memory_config(storage_root)?;
    let session_paths = resolve_session_memory_paths(&paths, session_id);
    ensure_session_dirs(&session_paths)?;

    let connection = open_sqlite(&session_paths.session_db_path)?;
    ensure_session_schema(&connection)?;

    let char_count = content.chars().count() as i64;
    let token_count = estimate_token_count(content);
    let syntax_hit = detect_syntax_trigger(role, content)
        .or_else(|| detect_semantic_trigger_candidate(role, content, token_count, &config));
    let anchor_kind = syntax_hit.as_ref().map(|hit| hit.kind.clone());
    let anchor_score = compute_anchor_score(role, content, syntax_hit.as_ref());
    let created_at = now_ms();
    let created_at_iso = now_iso();
    connection
        .execute(
            "insert into session_dialog(
               id, session_id, role, content, turn_id, created_at, created_at_iso, updated_at, updated_at_iso,
               token_count, char_count, anchor_score, anchor_kind, project_root, source_device, revision
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'local', 1)
             on conflict(id) do update set
               role = excluded.role,
               content = excluded.content,
               turn_id = excluded.turn_id,
               updated_at = excluded.updated_at,
               updated_at_iso = excluded.updated_at_iso,
               token_count = excluded.token_count,
               char_count = excluded.char_count,
               anchor_score = excluded.anchor_score,
               anchor_kind = excluded.anchor_kind,
               project_root = excluded.project_root,
               revision = session_dialog.revision + 1",
            params![
                message_id,
                session_id,
                role,
                content,
                turn_id,
                created_at,
                &created_at_iso,
                created_at,
                &created_at_iso,
                token_count,
                char_count,
                anchor_score,
                anchor_kind,
                project_root,
            ],
        )
        .map_err(|error| to_error(format!("failed to append session dialog: {error}")))?;

    let mut events = trim_live_session_if_needed(storage_root, session_id, &config)?;

    if role == "user" {
        enqueue_memory_jobs(
            storage_root,
            session_id,
            message_id,
            content,
            token_count,
            turn_id,
            project_root,
            syntax_hit,
        )?;
    }

    Ok(std::mem::take(&mut events))
}

pub fn build_turn_context(
    storage_root: &str,
    session_id: &str,
    profile: &AiProviderProfile,
    project_root: Option<&str>,
) -> Result<MemoryTurnContext> {
    let config = load_memory_config(storage_root)?;
    let budget = resolve_budget(&config, profile);
    let mut all_messages = load_combined_messages(storage_root, session_id)?;
    all_messages.sort_by_key(|message| message.created_at);

    let selected_messages = select_context_messages(&all_messages, &budget);
    let shared_entries = select_shared_entries(storage_root, session_id, &budget, project_root)?;
    let prompt_cache_text = if shared_entries.is_empty() {
        None
    } else {
        Some(render_memory_injection(&shared_entries))
    };
    persist_prompt_cache(
        storage_root,
        session_id,
        prompt_cache_text.as_deref(),
        &shared_entries,
    )?;

    let mut messages = Vec::new();

    let truncate_limit = config.message_truncate_tokens;
    messages.extend(selected_messages.into_iter().filter_map(|entry| {
        let content = truncate_message_content(&entry.content, truncate_limit);
        match entry.role.as_str() {
            "user" => Some(AgentInferenceMessage {
                role: AgentInferenceMessageRole::User,
                content,
                tool_call_id: None,
                tool_calls: Vec::new(),
            }),
            "assistant" => Some(AgentInferenceMessage {
                role: AgentInferenceMessageRole::Assistant,
                content,
                tool_call_id: None,
                tool_calls: Vec::new(),
            }),
            _ => None,
        }
    }));

    let memory_snapshot = render_memory_snapshot_sections(&shared_entries);
    Ok(MemoryTurnContext {
        messages,
        memory_snapshot,
    })
}

pub fn kick_memory_pipeline(
    storage_root: &str,
    session_id: &str,
    _turn_id: &str,
    _project_root: Option<String>,
) -> Result<()> {
    ensure_memory_bootstrap(storage_root)?;
    // Process queued memory jobs (syntax triggers, token checkpoints, compaction)
    let _ = process_due_memory_jobs(storage_root, Some(session_id));
    Ok(())
}

#[allow(dead_code)]
pub fn process_memory_jobs_now(
    storage_root: &str,
    session_id: &str,
    _turn_id: &str,
    _project_root: Option<&str>,
) -> Result<Vec<MemoryRuntimePhaseEvent>> {
    let (_processed, events) = process_due_memory_jobs(storage_root, Some(session_id))?;
    Ok(events
        .into_iter()
        .filter(|event| event.session_id == session_id)
        .map(|event| event.event)
        .collect())
}

pub fn run_scheduler_tick(storage_root: &str) -> Result<usize> {
    let (processed, _events) = process_due_memory_jobs(storage_root, None)?;
    Ok(processed)
}

fn sanitize_config(config: &mut AiMemoryConfig) {
    config.version = config.version.max(1);
    config.default_context_window = config.default_context_window.max(8_000);
    config.output_reserve_min_tokens = config.output_reserve_min_tokens.max(1_000);
    config.output_reserve_max_tokens = config
        .output_reserve_max_tokens
        .max(config.output_reserve_min_tokens);
    config.system_reserve_min_tokens = config.system_reserve_min_tokens.max(500);
    config.system_reserve_max_tokens = config
        .system_reserve_max_tokens
        .max(config.system_reserve_min_tokens);
    config.shared_injection_min_tokens = config.shared_injection_min_tokens.max(500);
    config.shared_injection_max_tokens = config
        .shared_injection_max_tokens
        .max(config.shared_injection_min_tokens);
    config.tool_history_min_tokens = config.tool_history_min_tokens.max(500);
    config.tool_history_max_tokens = config
        .tool_history_max_tokens
        .max(config.tool_history_min_tokens);
    config.guard_slack_min_tokens = config.guard_slack_min_tokens.max(500);
    config.guard_slack_max_tokens = config
        .guard_slack_max_tokens
        .max(config.guard_slack_min_tokens);
    config.live_budget_cap_tokens = config.live_budget_cap_tokens.max(8_000);
    config.head_ratio = config.head_ratio.clamp(0.05, 0.5);
    config.middle_ratio = config.middle_ratio.clamp(0.05, 0.6);
    config.tail_ratio = config.tail_ratio.clamp(0.05, 0.8);
    let total_ratio = config.head_ratio + config.middle_ratio + config.tail_ratio;
    config.head_ratio /= total_ratio;
    config.middle_ratio /= total_ratio;
    config.tail_ratio /= total_ratio;
    config.trim_extra_min_tokens = config.trim_extra_min_tokens.max(1_000);
    config.trim_extra_ratio = config.trim_extra_ratio.clamp(0.02, 0.5);
    config.checkpoint_min_tokens = config.checkpoint_min_tokens.max(500);
    config.checkpoint_ratio = config.checkpoint_ratio.clamp(0.05, 0.5);
    config.syntax_cooldown_ms = config.syntax_cooldown_ms.max(1_000);
    config.checkpoint_batch_size = config.checkpoint_batch_size.max(1);
    config.checkpoint_cpu_budget_ms = config.checkpoint_cpu_budget_ms.max(10);
    config.cut_dedupe_similarity_threshold =
        config.cut_dedupe_similarity_threshold.clamp(0.8, 0.999);
    config.cuts_size_trigger_bytes = config.cuts_size_trigger_bytes.max(4 * 1024 * 1024);
    config.cuts_size_target_bytes = config
        .cuts_size_target_bytes
        .max(2 * 1024 * 1024)
        .min(config.cuts_size_trigger_bytes);
    config.shared_classify_score_threshold =
        config.shared_classify_score_threshold.clamp(0.5, 0.99);
    config.medium_tier_threshold = config.medium_tier_threshold.max(16_000);
    config.large_tier_threshold = config
        .large_tier_threshold
        .max(config.medium_tier_threshold + 16_000);
    config.syntax_rate_limit_per_minute = config.syntax_rate_limit_per_minute.max(1).min(20);
    config.cut_recall_token_budget = config.cut_recall_token_budget.max(0);
    config.message_truncate_tokens = config.message_truncate_tokens.max(200);
}

fn ensure_memory_bootstrap(storage_root: &str) -> Result<MemoryPaths> {
    let storage_root = normalize_required_text(storage_root, "storageRoot")?;
    let ai_paths = resolve_ai_paths(&storage_root)?;
    ensure_ai_dirs(&ai_paths)?;
    let memory_paths = MemoryPaths {
        config_path: ai_paths.runtime_root.join(MEMORY_CONFIG_FILENAME),
        shared_memory_path: ai_paths.shared_root.join(SHARED_MEMORY_FILENAME),
        shared_audit_path: ai_paths.shared_root.join(SHARED_AUDIT_FILENAME),
        frozen_memory_path: ai_paths.shared_root.join(FROZEN_MEMORY_FILENAME),
        frozen_audit_path: ai_paths.shared_root.join(FROZEN_AUDIT_FILENAME),
        dynamic_prompt_cache_path: ai_paths.shared_root.join(DYNAMIC_PROMPT_CACHE_FILENAME),
        shared_index_db_path: ai_paths.shared_root.join(SHARED_INDEX_FILENAME),
        trigger_marks_db_path: ai_paths.runtime_root.join(TRIGGER_MARKS_FILENAME),
        memory_jobs_db_path: ai_paths.runtime_root.join(MEMORY_JOBS_FILENAME),
        prompt_cache_db_path: ai_paths.runtime_root.join(PROMPT_CACHE_FILENAME),
        compaction_log_path: ai_paths.metrics_root.join(MEMORY_COMPACTION_LOG_FILENAME),
        ai: ai_paths,
    };

    let registry = open_sqlite(&memory_paths.ai.registry_db_path)?;
    ensure_registry_schema(&registry)?;

    maybe_reset_legacy_agent_state(&memory_paths, &registry)?;
    ensure_shared_file(
        &memory_paths.config_path,
        &to_json(&AiMemoryConfig::default())?,
    )?;
    ensure_shared_file(&memory_paths.shared_memory_path, "# Shared Memory\n")?;
    ensure_shared_file(&memory_paths.shared_audit_path, "")?;
    ensure_shared_file(&memory_paths.frozen_memory_path, "# Frozen Memory\n")?;
    ensure_shared_file(&memory_paths.frozen_audit_path, "")?;
    ensure_shared_file(
        &memory_paths.dynamic_prompt_cache_path,
        "# Dynamic Prompt Cache\n",
    )?;
    ensure_shared_file(&memory_paths.compaction_log_path, "")?;

    let shared_index = open_sqlite(&memory_paths.shared_index_db_path)?;
    ensure_shared_index_schema(&shared_index)?;

    let trigger_marks = open_sqlite(&memory_paths.trigger_marks_db_path)?;
    ensure_trigger_marks_schema(&trigger_marks)?;

    let memory_jobs = open_sqlite(&memory_paths.memory_jobs_db_path)?;
    ensure_memory_jobs_schema(&memory_jobs)?;

    let prompt_cache = open_sqlite(&memory_paths.prompt_cache_db_path)?;
    ensure_prompt_cache_schema(&prompt_cache)?;

    Ok(memory_paths)
}

fn maybe_reset_legacy_agent_state(
    paths: &MemoryPaths,
    registry: &rusqlite::Connection,
) -> Result<()> {
    let already_reset = registry
        .query_row(
            "select value from metadata where key = ?1",
            params![MEMORY_ARCHITECTURE_RESET_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| to_error(format!("failed to read memory reset marker: {error}")))?;
    if already_reset.is_some() {
        return Ok(());
    }

    registry
        .execute("delete from agent_runtime_events", [])
        .map_err(|error| {
            to_error(format!(
                "failed to clear legacy agent runtime events: {error}"
            ))
        })?;
    registry
        .execute("delete from agent_tool_calls", [])
        .map_err(|error| to_error(format!("failed to clear legacy agent tool calls: {error}")))?;
    registry
        .execute("delete from agent_messages", [])
        .map_err(|error| to_error(format!("failed to clear legacy agent messages: {error}")))?;
    registry
        .execute("delete from agent_turns", [])
        .map_err(|error| to_error(format!("failed to clear legacy agent turns: {error}")))?;
    registry
        .execute("delete from agent_sessions", [])
        .map_err(|error| to_error(format!("failed to clear legacy agent sessions: {error}")))?;

    clear_directory_children(&paths.ai.sessions_root)?;
    for path in [
        &paths.shared_index_db_path,
        &paths.trigger_marks_db_path,
        &paths.memory_jobs_db_path,
        &paths.prompt_cache_db_path,
        &paths.shared_memory_path,
        &paths.shared_audit_path,
        &paths.frozen_memory_path,
        &paths.frozen_audit_path,
        &paths.dynamic_prompt_cache_path,
        &paths.compaction_log_path,
    ] {
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }

    registry
        .execute(
            "insert into metadata(key, value) values (?1, ?2)
             on conflict(key) do update set value = excluded.value",
            params![MEMORY_ARCHITECTURE_RESET_KEY, now_ms().to_string()],
        )
        .map_err(|error| to_error(format!("failed to write memory reset marker: {error}")))?;
    Ok(())
}

fn clear_directory_children(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(path).map_err(|error| {
        to_error(format!(
            "failed to read directory {}: {error}",
            path.display()
        ))
    })? {
        let entry = entry.map_err(|error| {
            to_error(format!(
                "failed to read directory entry {}: {error}",
                path.display()
            ))
        })?;
        let entry_path = entry.path();
        if entry_path.is_dir() {
            fs::remove_dir_all(&entry_path).map_err(|error| {
                to_error(format!(
                    "failed to remove directory {}: {error}",
                    entry_path.display()
                ))
            })?;
        } else {
            fs::remove_file(&entry_path).map_err(|error| {
                to_error(format!(
                    "failed to remove file {}: {error}",
                    entry_path.display()
                ))
            })?;
        }
    }
    Ok(())
}

fn ensure_shared_file(path: &Path, contents: &str) -> Result<()> {
    if path.exists() {
        return Ok(());
    }
    fs::write(path, contents).map_err(|error| {
        to_error(format!(
            "failed to initialize file {}: {error}",
            path.display()
        ))
    })
}

fn load_memory_config(storage_root: &str) -> Result<AiMemoryConfig> {
    let paths = ensure_memory_bootstrap(storage_root)?;
    let raw = fs::read_to_string(&paths.config_path).map_err(|error| {
        to_error(format!(
            "failed to read memory config {}: {error}",
            paths.config_path.display()
        ))
    })?;
    let mut config = parse_json::<AiMemoryConfig>(&raw)?;
    sanitize_config(&mut config);
    Ok(config)
}

fn resolve_session_memory_paths(paths: &MemoryPaths, session_id: &str) -> SessionMemoryPaths {
    let session_root = paths.ai.sessions_root.join(session_id);
    SessionMemoryPaths {
        session_db_path: session_root.join("session.sqlite"),
        cuts_root: session_root.join("cuts"),
        manifests_root: session_root.join("manifests"),
        session_root,
    }
}

fn ensure_session_dirs(paths: &SessionMemoryPaths) -> Result<()> {
    for directory in [&paths.session_root, &paths.cuts_root, &paths.manifests_root] {
        fs::create_dir_all(directory).map_err(|error| {
            to_error(format!(
                "failed to create memory session directory {}: {error}",
                directory.display()
            ))
        })?;
    }
    Ok(())
}

fn ensure_session_schema(connection: &rusqlite::Connection) -> Result<()> {
    connection
        .execute_batch(
            r#"
            create table if not exists metadata (
              key text primary key,
              value text not null
            );
            create table if not exists session_dialog (
              id text primary key,
              session_id text not null,
              role text not null,
              content text not null,
              turn_id text,
              turn_index integer,
              created_at integer not null,
              created_at_iso text not null default '',
              updated_at integer,
              updated_at_iso text,
              token_count integer not null,
              char_count integer not null,
              anchor_score real not null default 0,
              anchor_kind text,
              project_root text,
              stream_id text,
              metadata_json text,
              source_device text not null default 'local',
              revision integer not null default 1
            );
            create index if not exists idx_session_dialog_created_at on session_dialog(created_at asc);
            create index if not exists idx_session_dialog_anchor on session_dialog(anchor_score desc, created_at desc);
            "#,
        )
        .map_err(|error| to_error(format!("failed to initialize session memory schema: {error}")))?;
    // Additive migration for existing databases
    for col in [
        "alter table session_dialog add column turn_index integer",
        "alter table session_dialog add column created_at_iso text not null default ''",
        "alter table session_dialog add column updated_at integer",
        "alter table session_dialog add column updated_at_iso text",
        "alter table session_dialog add column stream_id text",
        "alter table session_dialog add column metadata_json text",
        "alter table session_dialog add column source_device text not null default 'local'",
        "alter table session_dialog add column revision integer not null default 1",
    ] {
        let _ = connection.execute(col, []);
    }
    Ok(())
}

fn ensure_cut_schema(connection: &rusqlite::Connection) -> Result<()> {
    connection
        .execute_batch(
            r#"
            create table if not exists cut_payload (
              id text primary key,
              session_id text not null,
              role text not null,
              content text not null,
              content_hash text not null default '',
              turn_id text,
              created_at integer not null,
              created_at_iso text not null default '',
              token_count integer not null,
              char_count integer not null,
              anchor_score real not null default 0,
              anchor_kind text,
              project_root text,
              source_device text not null default 'local'
            );
            create table if not exists cut_refs (
              source_message_id text not null,
              archived_message_id text not null,
              relation text not null,
              dedupe_reason text not null default 'trimmed',
              similarity_score real,
              created_at integer not null,
              created_at_iso text not null default '',
              primary key(source_message_id, archived_message_id)
            );
            create table if not exists cut_meta (
              key text primary key,
              value text not null
            );
            create index if not exists idx_cut_payload_created_at on cut_payload(created_at asc);
            create index if not exists idx_cut_payload_hash on cut_payload(content_hash);
            "#,
        )
        .map_err(|error| to_error(format!("failed to initialize cut schema: {error}")))?;
    // Additive migration for existing databases
    for col in [
        "alter table cut_payload add column content_hash text not null default ''",
        "alter table cut_payload add column created_at_iso text not null default ''",
        "alter table cut_payload add column source_device text not null default 'local'",
        "alter table cut_refs add column dedupe_reason text not null default 'trimmed'",
        "alter table cut_refs add column similarity_score real",
        "alter table cut_refs add column created_at_iso text not null default ''",
    ] {
        let _ = connection.execute(col, []);
    }
    Ok(())
}

fn ensure_shared_index_schema(connection: &rusqlite::Connection) -> Result<()> {
    connection
        .execute_batch(
            r#"
            create table if not exists entries (
              id text primary key,
              layer text not null,
              scope text not null,
              project_root text,
              content text not null,
              source_session_id text,
              source_message_id text,
              stable_key text not null,
              content_hash text not null,
              revision integer not null,
              accepted integer not null default 0,
              score real not null,
              last_used integer,
              created_at integer not null,
              created_at_iso text not null default '',
              updated_at integer not null,
              updated_at_iso text not null default '',
              embedding_json text
            );
            create unique index if not exists idx_entries_stable_key on entries(stable_key);
            create index if not exists idx_entries_scope_updated on entries(scope, updated_at desc);
            create index if not exists idx_entries_source on entries(source_session_id, source_message_id);
            "#,
        )
        .map_err(|error| to_error(format!("failed to initialize shared index schema: {error}")))?;
    // Additive migration for existing databases
    for col in [
        "alter table entries add column created_at_iso text not null default ''",
        "alter table entries add column updated_at_iso text not null default ''",
        "alter table entries add column embedding_json text",
    ] {
        let _ = connection.execute(col, []);
    }
    Ok(())
}

fn ensure_trigger_marks_schema(connection: &rusqlite::Connection) -> Result<()> {
    connection
        .execute_batch(
            r#"
            create table if not exists trigger_marks (
              session_id text not null,
              message_id text not null,
              trigger_kind text not null,
              fingerprint text not null,
              token_count integer,
              created_at integer not null,
              created_at_iso text not null default '',
              processed_at integer,
              processed_at_iso text,
              primary key(session_id, message_id, trigger_kind)
            );
            create table if not exists token_checkpoints (
              session_id text primary key,
              scanned_tokens integer not null default 0,
              last_scanned_at integer,
              last_scanned_at_iso text
            );
            "#,
        )
        .map_err(|error| {
            to_error(format!(
                "failed to initialize trigger marks schema: {error}"
            ))
        })?;
    // Additive migration
    for col in [
        "alter table trigger_marks add column created_at_iso text not null default ''",
        "alter table trigger_marks add column processed_at_iso text",
        "alter table token_checkpoints add column last_scanned_at_iso text",
    ] {
        let _ = connection.execute(col, []);
    }
    Ok(())
}

fn ensure_memory_jobs_schema(connection: &rusqlite::Connection) -> Result<()> {
    connection
        .execute_batch(
            r#"
            create table if not exists jobs (
              id text primary key,
              job_type text not null,
              session_id text not null,
              message_id text,
              payload_json text not null,
              status text not null,
              attempts integer not null default 0,
              lease_expires_at integer,
              next_retry_at integer,
              error_message text,
              created_at integer not null,
              updated_at integer not null
            );
            create index if not exists idx_memory_jobs_status on jobs(status, next_retry_at, updated_at);
            create index if not exists idx_memory_jobs_session on jobs(session_id, created_at asc);
            "#,
        )
        .map_err(|error| to_error(format!("failed to initialize memory jobs schema: {error}")))?;
    Ok(())
}

fn ensure_prompt_cache_schema(connection: &rusqlite::Connection) -> Result<()> {
    connection
        .execute_batch(
            r#"
            create table if not exists prompt_cache (
              session_id text primary key,
              injected_text text not null,
              reasons_json text not null,
              updated_at integer not null,
              updated_at_iso text not null default ''
            );
            "#,
        )
        .map_err(|error| to_error(format!("failed to initialize prompt cache schema: {error}")))?;
    let _ = connection.execute(
        "alter table prompt_cache add column updated_at_iso text not null default ''",
        [],
    );
    Ok(())
}

fn resolve_budget(config: &AiMemoryConfig, profile: &AiProviderProfile) -> MemoryBudget {
    let context_window = fallback_models(profile)
        .into_iter()
        .find(|model| model.id == profile.model)
        .and_then(|model| model.context_window)
        .or_else(|| {
            fallback_models(profile)
                .into_iter()
                .find_map(|model| model.context_window)
        })
        .unwrap_or(config.default_context_window)
        .max(8_000);

    // Determine model tier: small / medium / large
    let tier = config
        .model_tier_override
        .as_deref()
        .and_then(|t| match t {
            "small" | "medium" | "large" => Some(t),
            _ => None,
        })
        .unwrap_or_else(|| {
            if context_window >= config.large_tier_threshold {
                "large"
            } else if context_window >= config.medium_tier_threshold {
                "medium"
            } else {
                "small"
            }
        });

    // Tier-dependent budget ratios
    let (output_ratio, system_ratio, shared_ratio, tool_ratio, guard_ratio) = match tier {
        "large" => (0.08, 0.04, 0.15, 0.08, 0.03),
        "medium" => (0.10, 0.05, 0.10, 0.06, 0.05),
        _ /* small */ => (0.125, 0.0625, 0.078, 0.047, 0.0625),
    };
    // Tier-dependent max caps
    let (shared_max, tool_max) = match tier {
        "large" => (60_000_i64, 20_000_i64),
        "medium" => (20_000, 12_000),
        _ => (
            config.shared_injection_max_tokens,
            config.tool_history_max_tokens,
        ),
    };

    let output_reserve = clamp_percent(
        context_window,
        output_ratio,
        config.output_reserve_min_tokens,
        config.output_reserve_max_tokens,
    );
    let system_reserve = clamp_percent(
        context_window,
        system_ratio,
        config.system_reserve_min_tokens,
        config.system_reserve_max_tokens,
    );
    let shared_reserve = clamp_percent(
        context_window,
        shared_ratio,
        config.shared_injection_min_tokens,
        shared_max,
    );
    let tool_reserve = clamp_percent(
        context_window,
        tool_ratio,
        config.tool_history_min_tokens,
        tool_max,
    );
    let guard_slack = clamp_percent(
        context_window,
        guard_ratio,
        config.guard_slack_min_tokens,
        config.guard_slack_max_tokens,
    );

    let live_budget = (context_window
        - output_reserve
        - system_reserve
        - shared_reserve
        - tool_reserve
        - guard_slack)
        .max(4_000)
        .min(config.live_budget_cap_tokens);
    let head_budget = (live_budget as f64 * config.head_ratio).round() as i64;
    let middle_budget = (live_budget as f64 * config.middle_ratio).round() as i64;
    let tail_budget = live_budget - head_budget - middle_budget;
    let trim_trigger = live_budget
        + std::cmp::max(
            config.trim_extra_min_tokens,
            (live_budget as f64 * config.trim_extra_ratio).round() as i64,
        );
    // Large models: raise checkpoint trigger to 20% of live_budget
    let checkpoint_ratio = if tier == "large" {
        0.20
    } else {
        config.checkpoint_ratio
    };
    let checkpoint_trigger = std::cmp::max(
        config.checkpoint_min_tokens,
        (live_budget as f64 * checkpoint_ratio).round() as i64,
    );

    MemoryBudget {
        shared_budget: shared_reserve,
        head_budget,
        middle_budget,
        tail_budget,
        trim_trigger,
        checkpoint_trigger,
    }
}

fn clamp_percent(context_window: i64, ratio: f64, min_value: i64, max_value: i64) -> i64 {
    ((context_window as f64 * ratio).round() as i64)
        .max(min_value)
        .min(max_value)
}

fn estimate_token_count(text: &str) -> i64 {
    if text.trim().is_empty() {
        return 1;
    }
    let mut ascii_non_whitespace = 0_i64;
    let mut non_ascii = 0_i64;
    let mut whitespace = 0_i64;
    let mut punctuation = 0_i64;
    for ch in text.chars() {
        if ch.is_whitespace() {
            whitespace += 1;
        } else if !ch.is_ascii() {
            non_ascii += 1;
        } else if ch.is_ascii_punctuation() {
            punctuation += 1;
        } else {
            ascii_non_whitespace += 1;
        }
    }
    let ascii_tokens = (ascii_non_whitespace + 3) / 4;
    let non_ascii_tokens = ((non_ascii as f64) * 0.75).ceil() as i64;
    let whitespace_tokens = (whitespace + 5) / 6;
    let punctuation_tokens = (punctuation + 1) / 2;
    (ascii_tokens + non_ascii_tokens + whitespace_tokens + punctuation_tokens).max(1)
}

/// Truncate a message's content if it exceeds `max_tokens` estimated tokens.
/// Keeps the beginning of the message (typically the most context-setting part)
/// and appends a truncation notice.
fn truncate_message_content(content: &str, max_tokens: i64) -> String {
    let est = estimate_token_count(content);
    if est <= max_tokens || max_tokens <= 0 {
        return content.to_string();
    }
    // Approximate: the ratio of chars to tokens lets us estimate a char cut point.
    let total_chars = content.len() as f64;
    let ratio = max_tokens as f64 / est as f64;
    // Cut at a char boundary, slightly inside the ratio to leave room for the notice
    let target_chars = ((total_chars * ratio) * 0.95) as usize;
    // Find the nearest whitespace boundary to avoid cutting mid-word/character
    let cut_point = content[..target_chars.min(content.len())]
        .rfind(|c: char| c.is_whitespace())
        .unwrap_or(target_chars.min(content.len()));
    if cut_point < 50 {
        // If cut point is too small, just return as-is (edge case)
        return content.to_string();
    }
    let truncated = &content[..cut_point];
    format!("{truncated}\n\n[... truncated, {est} tokens → ~{max_tokens} tokens]")
}

fn detect_syntax_trigger(role: &str, content: &str) -> Option<SyntaxTriggerHit> {
    if role != "user" {
        return None;
    }
    let mut best: Option<SyntaxTriggerHit> = None;
    for (regex, kind, score) in LONG_TERM_TRIGGER_REGEXES.iter() {
        if regex.is_match(content) {
            let mut adjusted_score = *score;
            // Volatile exclusion: reduce score if content is temporary
            for volatile_regex in VOLATILE_EXCLUSION_REGEXES.iter() {
                if volatile_regex.is_match(content) {
                    adjusted_score -= 0.3;
                    break;
                }
            }
            if adjusted_score > best.as_ref().map(|h| h.score).unwrap_or(0.0) {
                best = Some(SyntaxTriggerHit {
                    kind: (*kind).to_string(),
                    score: adjusted_score.max(0.0),
                });
            }
        }
    }
    best
}

fn normalize_lexical_token(raw: &str) -> String {
    raw.chars()
        .filter(|ch| ch.is_alphanumeric() || !ch.is_ascii())
        .collect::<String>()
        .to_lowercase()
}

fn lexical_variety_score(text: &str) -> f64 {
    let tokens = text
        .split_whitespace()
        .map(normalize_lexical_token)
        .filter(|token| token.chars().count() >= 2)
        .collect::<Vec<_>>();
    if tokens.len() < 4 {
        return 0.0;
    }
    let unique = tokens.iter().collect::<HashSet<_>>().len();
    (unique as f64 / tokens.len() as f64).clamp(0.0, 1.0)
}

fn count_non_empty_lines(text: &str) -> usize {
    text.lines().filter(|line| !line.trim().is_empty()).count()
}

fn count_sentence_breaks(text: &str) -> usize {
    text.chars()
        .filter(|ch| matches!(ch, '.' | '!' | '?' | '。' | '！' | '？' | ';' | '；'))
        .count()
}

fn detect_semantic_trigger_candidate(
    role: &str,
    content: &str,
    token_count: i64,
    config: &AiMemoryConfig,
) -> Option<SyntaxTriggerHit> {
    if role != "user" || !config.syntax_model_refine_enabled {
        return None;
    }

    let trimmed = content.trim();
    if trimmed.is_empty() {
        return None;
    }

    let non_whitespace_chars = trimmed.chars().filter(|ch| !ch.is_whitespace()).count();
    if non_whitespace_chars < 28 {
        return None;
    }

    let line_count = count_non_empty_lines(trimmed);
    let sentence_breaks = count_sentence_breaks(trimmed);
    let token_estimate = token_count.max(estimate_token_count(trimmed));
    let has_structure = line_count >= 2 || sentence_breaks >= 1;
    if token_estimate < 14 && !has_structure {
        return None;
    }

    let lexical_variety = lexical_variety_score(trimmed);
    let structural_score = if has_structure { 0.08 } else { 0.0 };
    let score = (0.52
        + ((token_estimate.min(80) as f64 / 80.0) * 0.18)
        + ((line_count.min(4) as f64 / 4.0) * 0.10)
        + (lexical_variety * 0.12)
        + structural_score)
        .clamp(0.55, 0.79);

    Some(SyntaxTriggerHit {
        kind: "semantic_candidate".to_string(),
        score,
    })
}

fn compute_anchor_score(role: &str, content: &str, syntax_hit: Option<&SyntaxTriggerHit>) -> f64 {
    let mut score = syntax_hit.map(|hit| hit.score).unwrap_or(0.0);
    if role == "user" {
        score = score.max(0.22);
    }
    let token_estimate = estimate_token_count(content);
    let line_count = count_non_empty_lines(content);
    let sentence_breaks = count_sentence_breaks(content);
    let non_whitespace_chars = content.chars().filter(|ch| !ch.is_whitespace()).count();
    if line_count >= 3 {
        score = score.max(0.66);
    }
    if token_estimate >= 48 {
        score = score.max(0.72);
    } else if token_estimate >= 24 {
        score = score.max(0.60);
    }
    if sentence_breaks >= 2 && token_estimate >= 14 {
        score = score.max(0.57);
    }
    if non_whitespace_chars >= 160 {
        score = score.max(0.62);
    }
    score.min(1.0)
}

fn enqueue_memory_jobs(
    storage_root: &str,
    session_id: &str,
    message_id: &str,
    content: &str,
    token_count: i64,
    turn_id: Option<&str>,
    project_root: Option<&str>,
    syntax_hit: Option<SyntaxTriggerHit>,
) -> Result<()> {
    let paths = ensure_memory_bootstrap(storage_root)?;
    let jobs = open_sqlite(&paths.memory_jobs_db_path)?;
    ensure_memory_jobs_schema(&jobs)?;
    let trigger_marks = open_sqlite(&paths.trigger_marks_db_path)?;
    ensure_trigger_marks_schema(&trigger_marks)?;
    let config = load_memory_config(storage_root)?;

    let now = now_ms();
    if let Some(hit) = syntax_hit {
        let fingerprint = digest_key(content);
        let existing = trigger_marks
            .query_row(
                "select processed_at, created_at from trigger_marks
                 where session_id = ?1 and message_id = ?2 and trigger_kind = ?3",
                params![session_id, message_id, hit.kind],
                |row| Ok((row.get::<_, Option<i64>>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()
            .map_err(|error| to_error(format!("failed to read syntax trigger mark: {error}")))?;
        let allow_enqueue = existing
            .map(|(processed_at, created_at)| {
                let last_seen = processed_at.unwrap_or(created_at);
                now - last_seen >= config.syntax_cooldown_ms
            })
            .unwrap_or(true);
        if allow_enqueue {
            trigger_marks
                .execute(
                    "insert into trigger_marks(session_id, message_id, trigger_kind, fingerprint, token_count, created_at, created_at_iso, processed_at, processed_at_iso)
                     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, null, null)
                     on conflict(session_id, message_id, trigger_kind) do update set
                       fingerprint = excluded.fingerprint,
                       token_count = excluded.token_count,
                       created_at = excluded.created_at,
                       created_at_iso = excluded.created_at_iso,
                       processed_at = null,
                       processed_at_iso = null",
                    params![session_id, message_id, hit.kind, fingerprint, token_count, now, ms_to_iso(now)],
                )
                .map_err(|error| to_error(format!("failed to write trigger mark: {error}")))?;
            insert_memory_job(
                &jobs,
                "syntax_trigger",
                session_id,
                Some(message_id),
                &MemoryJobPayload {
                    turn_id: turn_id.map(str::to_string),
                    project_root: project_root.map(str::to_string),
                    content: Some(content.to_string()),
                    score: Some(hit.score),
                    trigger_kind: Some(hit.kind),
                    ..MemoryJobPayload::default()
                },
            )?;
        }
    }

    let scanned_tokens = trigger_marks
        .query_row(
            "select scanned_tokens from token_checkpoints where session_id = ?1",
            params![session_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| to_error(format!("failed to read token checkpoint: {error}")))?
        .unwrap_or(0);

    if token_count + scanned_tokens
        >= resolve_budget(
            &config,
            &AiProviderProfile {
                id: "memory-default".to_string(),
                name: "memory-default".to_string(),
                provider_id: "memory".to_string(),
                protocol_id: "memory".to_string(),
                preset_id: None,
                connection_config: BTreeMap::new(),
                auth_config: BTreeMap::new(),
                configured_secret_fields: Vec::new(),
                headers: BTreeMap::new(),
                model: "memory-default".to_string(),
                custom_models: Vec::new(),
                discovery_state: crate::profile::types::AiModelDiscoveryState {
                    status: "idle".to_string(),
                    last_checked_at: None,
                    error_message: None,
                    models: Vec::new(),
                },
                is_default: false,
                created_at: now,
                updated_at: now,
            },
        )
        .checkpoint_trigger
    {
        insert_memory_job(
            &jobs,
            "token_checkpoint",
            session_id,
            None,
            &MemoryJobPayload {
                turn_id: turn_id.map(str::to_string),
                project_root: project_root.map(str::to_string),
                threshold_tokens: Some(token_count),
                ..MemoryJobPayload::default()
            },
        )?;
        trigger_marks
            .execute(
                "insert into token_checkpoints(session_id, scanned_tokens, last_scanned_at, last_scanned_at_iso)
                 values (?1, ?2, ?3, ?4)
                 on conflict(session_id) do update set
                   scanned_tokens = 0,
                   last_scanned_at = excluded.last_scanned_at,
                   last_scanned_at_iso = excluded.last_scanned_at_iso",
                params![session_id, 0, now, ms_to_iso(now)],
            )
            .map_err(|error| to_error(format!("failed to reset token checkpoint: {error}")))?;
    } else {
        trigger_marks
            .execute(
                "insert into token_checkpoints(session_id, scanned_tokens, last_scanned_at, last_scanned_at_iso)
                 values (?1, ?2, ?3, ?4)
                 on conflict(session_id) do update set
                   scanned_tokens = token_checkpoints.scanned_tokens + excluded.scanned_tokens,
                   last_scanned_at = excluded.last_scanned_at,
                   last_scanned_at_iso = excluded.last_scanned_at_iso",
                params![session_id, token_count, now, ms_to_iso(now)],
            )
            .map_err(|error| to_error(format!("failed to update token checkpoint: {error}")))?;
    }

    Ok(())
}

fn insert_memory_job(
    connection: &rusqlite::Connection,
    job_type: &str,
    session_id: &str,
    message_id: Option<&str>,
    payload: &impl Serialize,
) -> Result<()> {
    let now = now_ms();
    let now_iso_str = ms_to_iso(now);
    connection
        .execute(
            "insert into jobs(id, job_type, session_id, message_id, payload_json, status, attempts, lease_expires_at, next_retry_at, error_message, created_at, updated_at)
             values (?1, ?2, ?3, ?4, ?5, 'queued', 0, null, ?6, null, ?7, ?8)",
            params![
                format!("memory-job-{}", uuid::Uuid::new_v4()),
                job_type,
                session_id,
                message_id,
                to_json(payload)?,
                now,
                now,
                now,
            ],
        )
        .map_err(|error| to_error(format!("failed to insert memory job: {error}")))?;
    let _ = now_iso_str; // ISO tracked via updated_at on status transitions
    Ok(())
}

fn insert_memory_job_if_absent(
    connection: &rusqlite::Connection,
    job_type: &str,
    session_id: &str,
    message_id: Option<&str>,
    payload: &impl Serialize,
) -> Result<()> {
    let payload_json = to_json(payload)?;
    let existing = connection
        .query_row(
            "select 1
             from jobs
             where job_type = ?1
               and session_id = ?2
               and coalesce(message_id, '') = coalesce(?3, '')
               and payload_json = ?4
               and status in ('queued', 'retry_backoff', 'running')
             limit 1",
            params![job_type, session_id, message_id, payload_json],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| to_error(format!("failed to query existing memory job: {error}")))?;
    if existing.is_some() {
        return Ok(());
    }

    let now = now_ms();
    connection
        .execute(
            "insert into jobs(id, job_type, session_id, message_id, payload_json, status, attempts, lease_expires_at, next_retry_at, error_message, created_at, updated_at)
             values (?1, ?2, ?3, ?4, ?5, 'queued', 0, null, ?6, null, ?7, ?8)",
            params![
                format!("memory-job-{}", uuid::Uuid::new_v4()),
                job_type,
                session_id,
                message_id,
                payload_json,
                now,
                now,
                now,
            ],
        )
        .map_err(|error| to_error(format!("failed to insert memory job: {error}")))?;
    Ok(())
}

fn trim_live_session_if_needed(
    storage_root: &str,
    session_id: &str,
    config: &AiMemoryConfig,
) -> Result<Vec<MemoryRuntimePhaseEvent>> {
    let paths = ensure_memory_bootstrap(storage_root)?;
    let session_paths = resolve_session_memory_paths(&paths, session_id);
    let connection = open_sqlite(&session_paths.session_db_path)?;
    ensure_session_schema(&connection)?;
    let mut messages = load_session_dialog(&connection, session_id)?;
    let total_tokens = messages
        .iter()
        .map(|message| message.token_count)
        .sum::<i64>();
    let dummy_profile = AiProviderProfile {
        id: "memory-default".to_string(),
        name: "memory-default".to_string(),
        provider_id: "memory".to_string(),
        protocol_id: "memory".to_string(),
        preset_id: None,
        connection_config: BTreeMap::new(),
        auth_config: BTreeMap::new(),
        configured_secret_fields: Vec::new(),
        headers: BTreeMap::new(),
        model: "memory-default".to_string(),
        custom_models: Vec::new(),
        discovery_state: crate::profile::types::AiModelDiscoveryState {
            status: "idle".to_string(),
            last_checked_at: None,
            error_message: None,
            models: Vec::new(),
        },
        is_default: false,
        created_at: now_ms(),
        updated_at: now_ms(),
    };
    let budget = resolve_budget(config, &dummy_profile);
    if total_tokens <= budget.trim_trigger {
        return Ok(Vec::new());
    }

    messages.sort_by_key(|message| message.created_at);
    let keep_ids = select_keep_ids(&messages, &budget);
    let archived = messages
        .into_iter()
        .filter(|message| !keep_ids.contains(&message.id))
        .collect::<Vec<_>>();
    if archived.is_empty() {
        return Ok(Vec::new());
    }

    // --- Summarization step (Codex-style) ---
    // When enabled, try to compress archived messages into a summary that
    // retains key information but uses far fewer tokens.
    let summary_message = if config.enable_trim_summarization && archived.len() >= 3 {
        generate_trim_summary(storage_root, config, &archived)
    } else {
        None
    };

    // If summarization produced a result, inject it into session_dialog
    // so it becomes part of the live context going forward.
    if let Some(ref summary) = summary_message {
        let summary_id = format!("summary-{}", uuid::Uuid::new_v4());
        let summary_now = now_ms();
        connection
            .execute(
                "insert into session_dialog(
                   id, session_id, role, content, turn_id, created_at, created_at_iso,
                   updated_at, updated_at_iso, token_count, char_count,
                   anchor_score, anchor_kind, project_root, source_device, revision
                 ) values (?1, ?2, 'assistant', ?3, null, ?4, ?5, ?6, ?7, ?8, ?9, 0.8, 'summary', null, 'local', 1)",
                params![
                    &summary_id,
                    session_id,
                    summary,
                    summary_now,
                    ms_to_iso(summary_now),
                    summary_now,
                    ms_to_iso(summary_now),
                    estimate_token_count(summary),
                    summary.len() as i64,
                ],
            )
            .map_err(|e| to_error(format!("failed to insert summary message: {e}")))?;
    }

    let cut_id = format!(
        "cut_{:013}_{}",
        now_ms(),
        &uuid::Uuid::new_v4().simple().to_string()[..8]
    );
    let cut_path = session_paths.cuts_root.join(format!("{cut_id}.sqlite"));
    let cut_connection = open_sqlite(&cut_path)?;
    ensure_cut_schema(&cut_connection)?;

    for message in &archived {
        if is_duplicate_cut_payload(
            &cut_connection,
            message,
            config.cut_dedupe_similarity_threshold,
        )? {
            continue;
        }
        let content_hash = digest_key(&message.content);
        let cut_created_at = now_ms();
        let cut_created_at_iso = now_iso();
        cut_connection
            .execute(
                "insert into cut_payload(
                   id, session_id, role, content, content_hash, turn_id, created_at, created_at_iso,
                   token_count, char_count, anchor_score, anchor_kind, project_root, source_device
                 ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'local')",
                params![
                    &message.id,
                    session_id,
                    &message.role,
                    &message.content,
                    &content_hash,
                    &message.turn_id,
                    cut_created_at,
                    &cut_created_at_iso,
                    message.token_count,
                    message.char_count,
                    message.anchor_score,
                    &message.anchor_kind,
                    &message.project_root,
                ],
            )
            .map_err(|error| to_error(format!("failed to write cut payload: {error}")))?;
        let ref_created_at = now_ms();
        cut_connection
            .execute(
                "insert into cut_refs(source_message_id, archived_message_id, relation, dedupe_reason, similarity_score, created_at, created_at_iso)
                 values (?1, ?2, 'trimmed', 'trimmed', null, ?3, ?4)",
                params![&message.id, &message.id, ref_created_at, ms_to_iso(ref_created_at)],
            )
            .map_err(|error| to_error(format!("failed to write cut refs: {error}")))?;
    }
    let meta_now = now_ms();
    cut_connection
        .execute(
            "insert into cut_meta(key, value) values ('cutId', ?1), ('createdAt', ?2), ('createdAtIso', ?3)",
            params![cut_id, meta_now.to_string(), now_iso()],
        )
        .map_err(|error| to_error(format!("failed to write cut metadata: {error}")))?;

    for message in &archived {
        connection
            .execute(
                "delete from session_dialog where id = ?1",
                params![&message.id],
            )
            .map_err(|error| to_error(format!("failed to delete trimmed dialog row: {error}")))?;
    }

    // Update cuts manifest
    let archived_tokens: i64 = archived.iter().map(|m| m.token_count).sum();
    update_cuts_manifest(
        &session_paths,
        session_id,
        &cut_id,
        archived.len(),
        archived_tokens,
    )?;

    maybe_compact_cuts(&session_paths, config)?;
    let compaction_now = now_ms();
    append_compaction_log(
        &paths.compaction_log_path,
        &format!(
            "{}\t{}\t{}\t{}\t{}\n",
            compaction_now,
            ms_to_iso(compaction_now),
            session_id,
            archived.len(),
            cut_path.display()
        ),
    )?;

    Ok(vec![MemoryRuntimePhaseEvent {
        phase: "memory_trimmed".to_string(),
        payload: json!({
            "cutId": cut_path
                .file_stem()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_default(),
            "removedCount": archived.len(),
            "removedTokens": archived_tokens,
        }),
    }])
}

fn maybe_compact_cuts(session_paths: &SessionMemoryPaths, config: &AiMemoryConfig) -> Result<()> {
    let mut cut_files = fs::read_dir(&session_paths.cuts_root)
        .map_err(|error| to_error(format!("failed to read cuts directory: {error}")))?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("sqlite"))
        .collect::<Vec<_>>();
    cut_files.sort();
    let total_size = cut_files
        .iter()
        .filter_map(|path| {
            fs::metadata(path)
                .ok()
                .map(|metadata| metadata.len() as i64)
        })
        .sum::<i64>();
    if total_size < config.cuts_size_trigger_bytes || cut_files.len() < 2 {
        return Ok(());
    }

    let compact_id = format!("cut_{:013}_compact", now_ms());
    let compact_path = session_paths.cuts_root.join(format!("{compact_id}.sqlite"));
    let compact = open_sqlite(&compact_path)?;
    ensure_cut_schema(&compact)?;

    let mut compact_msg_count = 0_usize;
    let mut compact_token_count = 0_i64;
    for path in &cut_files {
        let connection = open_sqlite(path)?;
        ensure_cut_schema(&connection)?;
        let rows = load_cut_messages(&connection)?;
        for row in rows {
            // Use insert or replace to avoid silently discarding newer versions
            let _ = compact.execute(
                "insert or replace into cut_payload(
                   id, session_id, role, content, content_hash, turn_id, created_at, created_at_iso,
                   token_count, char_count, anchor_score, anchor_kind, project_root, source_device
                 ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'local')",
                params![
                    row.id,
                    session_id_from_cut_path(session_paths, path),
                    row.role,
                    row.content,
                    digest_key(&row.content),
                    row.turn_id,
                    row.created_at,
                    ms_to_iso(row.created_at),
                    row.token_count,
                    row.char_count,
                    row.anchor_score,
                    row.anchor_kind,
                    row.project_root,
                ],
            );
            compact_msg_count += 1;
            compact_token_count += row.token_count;
        }
        // Also merge cut_refs
        let _ = connection
            .prepare("select source_message_id, archived_message_id, relation, dedupe_reason, similarity_score, created_at, created_at_iso from cut_refs")
            .and_then(|mut stmt| {
                let refs: Vec<_> = stmt.query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, Option<f64>>(4)?,
                        r.get::<_, i64>(5)?,
                        r.get::<_, String>(6)?,
                    ))
                })?.filter_map(|r| r.ok()).collect();
                for (src, arch, rel, reason, sim, ts, iso) in refs {
                    let _ = compact.execute(
                        "insert or ignore into cut_refs(source_message_id, archived_message_id, relation, dedupe_reason, similarity_score, created_at, created_at_iso) values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                        params![src, arch, rel, reason, sim, ts, iso],
                    );
                }
                Ok(())
            });
    }

    // Track which files we're about to remove for manifest cleanup
    let mut removed_cut_ids: Vec<String> = Vec::new();
    cut_files.sort();
    while current_total_cut_size(&session_paths.cuts_root)? > config.cuts_size_target_bytes
        && cut_files.len() > 1
    {
        if let Some(path) = cut_files.first().cloned() {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                removed_cut_ids.push(stem.to_string());
            }
            let _ = fs::remove_file(&path);
            cut_files.remove(0);
        } else {
            break;
        }
    }

    // Sync manifest: remove deleted cuts, add the new compact entry
    sync_manifest_after_compact(
        session_paths,
        &removed_cut_ids,
        &compact_id,
        compact_msg_count,
        compact_token_count,
    )?;

    Ok(())
}

fn session_id_from_cut_path(_session_paths: &SessionMemoryPaths, _path: &Path) -> String {
    // The original session id is stored on each row, so this value is overwritten by row data.
    String::new()
}

fn current_total_cut_size(cuts_root: &Path) -> Result<i64> {
    Ok(fs::read_dir(cuts_root)
        .map_err(|error| to_error(format!("failed to read cuts directory: {error}")))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry.metadata().ok().map(|metadata| metadata.len() as i64))
        .sum())
}

fn append_compaction_log(path: &Path, line: &str) -> Result<()> {
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| {
            to_error(format!(
                "failed to open compaction log {}: {error}",
                path.display()
            ))
        })?;
    file.write_all(line.as_bytes())
        .map_err(|error| to_error(format!("failed to write compaction log: {error}")))?;
    Ok(())
}

fn update_cuts_manifest(
    session_paths: &SessionMemoryPaths,
    session_id: &str,
    cut_id: &str,
    message_count: usize,
    token_count: i64,
) -> Result<()> {
    let manifest_path = session_paths.manifests_root.join("cuts.manifest.json");
    let mut manifest: Value = if manifest_path.exists() {
        let text = fs::read_to_string(&manifest_path)
            .map_err(|e| to_error(format!("failed to read cuts manifest: {e}")))?;
        serde_json::from_str(&text)
            .unwrap_or_else(|_| json!({"session_id": session_id, "cuts": []}))
    } else {
        json!({"session_id": session_id, "cuts": []})
    };
    let now = now_ms();
    let cuts = manifest
        .as_object_mut()
        .and_then(|obj| obj.get_mut("cuts"))
        .and_then(|v| v.as_array_mut());
    if let Some(cuts) = cuts {
        cuts.push(json!({
            "cut_id": cut_id,
            "created_at_ms": now,
            "created_at_iso": now_iso(),
            "message_count": message_count,
            "token_count": token_count,
            "file_path": format!("cuts/{cut_id}.sqlite"),
        }));
    }
    manifest["updated_at_ms"] = json!(now);
    manifest["updated_at_iso"] = json!(now_iso());
    fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&manifest).unwrap_or_default(),
    )
    .map_err(|e| to_error(format!("failed to write cuts manifest: {e}")))?;
    Ok(())
}

/// Remove deleted cut entries from manifest and add the new compact entry.
fn sync_manifest_after_compact(
    session_paths: &SessionMemoryPaths,
    removed_cut_ids: &[String],
    compact_cut_id: &str,
    message_count: usize,
    token_count: i64,
) -> Result<()> {
    let manifest_path = session_paths.manifests_root.join("cuts.manifest.json");
    if !manifest_path.exists() {
        return Ok(());
    }
    let text = fs::read_to_string(&manifest_path).map_err(|e| {
        to_error(format!(
            "failed to read cuts manifest for compact sync: {e}"
        ))
    })?;
    let mut manifest: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({"cuts": []}));

    if let Some(cuts) = manifest
        .as_object_mut()
        .and_then(|obj| obj.get_mut("cuts"))
        .and_then(|v| v.as_array_mut())
    {
        // Remove entries whose cut_id matches a deleted file
        cuts.retain(|entry| {
            let id = entry.get("cut_id").and_then(Value::as_str).unwrap_or("");
            !removed_cut_ids.iter().any(|removed| removed == id)
        });
        // Add the new compact entry
        let now = now_ms();
        cuts.push(json!({
            "cut_id": compact_cut_id,
            "created_at_ms": now,
            "created_at_iso": now_iso(),
            "message_count": message_count,
            "token_count": token_count,
            "file_path": format!("cuts/{compact_cut_id}.sqlite"),
            "compacted": true,
        }));
    }
    let now = now_ms();
    manifest["updated_at_ms"] = json!(now);
    manifest["updated_at_iso"] = json!(now_iso());
    fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&manifest).unwrap_or_default(),
    )
    .map_err(|e| to_error(format!("failed to write compacted manifest: {e}")))?;
    Ok(())
}

/// Generate a summary of archived messages using the configured LLM.
/// Returns None if summarization is not configured or fails.
fn generate_trim_summary(
    storage_root: &str,
    config: &AiMemoryConfig,
    archived: &[MemorySessionMessage],
) -> Option<String> {
    use crate::provider;
    use crate::provider::types::{AgentInferenceMessage, AgentInferenceMessageRole};

    let profile_id = config.memory_analysis_profile_id.as_deref()?;
    let profile = crate::storage::registry_db::read_profile_record(storage_root, profile_id)
        .ok()
        .flatten()?;
    let secrets = crate::auth::service::resolve_secret_values(
        &profile.secret_refs,
        None,
        &crate::auth::store::KeyringSecretStore,
    )
    .ok()?;

    // Build the conversation transcript for summarization
    let mut transcript = String::new();
    for msg in archived {
        let role_label = if msg.role == "user" {
            "User"
        } else {
            "Assistant"
        };
        // Truncate very long messages in the transcript to avoid blowing up the summary prompt
        let content = if msg.content.len() > 3000 {
            format!(
                "{}... [truncated, {} chars total]",
                &msg.content[..3000],
                msg.content.len()
            )
        } else {
            msg.content.clone()
        };
        transcript.push_str(&format!("[{role_label}]: {content}\n\n"));
    }

    let prompt = format!(
        "Summarize the following conversation excerpt into 1-2 concise paragraphs. \
         Preserve key facts, decisions, preferences, file paths, and action items. \
         Omit greetings, filler, and redundant back-and-forth. Output the summary only.\n\n\
         ---\n{transcript}"
    );

    let messages = vec![AgentInferenceMessage {
        role: AgentInferenceMessageRole::User,
        content: prompt,
        tool_call_id: None,
        tool_calls: Vec::new(),
    }];

    let result = provider::run_agent_inference(
        &profile.to_public(),
        &secrets,
        &messages,
        &[],
        None::<&mut dyn FnMut(&str)>,
        None::<&mut dyn FnMut(&str)>,
    )
    .ok()?;

    let summary = result.assistant_text.trim().to_string();
    if summary.is_empty() || summary.len() < 20 {
        return None;
    }

    Some(format!(
        "[Summary of {} earlier messages]\n{summary}",
        archived.len()
    ))
}

fn is_duplicate_cut_payload(
    connection: &rusqlite::Connection,
    candidate: &MemorySessionMessage,
    threshold: f64,
) -> Result<bool> {
    // Phase 1: SHA256 exact dedup — cheapest check first
    let candidate_hash = digest_key(&candidate.content);
    let exact_match = connection
        .query_row(
            "select id from cut_payload where content_hash = ?1 limit 1",
            params![&candidate_hash],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| to_error(format!("failed to read cut dedupe hash: {error}")))?;
    if exact_match.is_some() {
        // Write dedupe reference only (no duplicate payload)
        let ref_now = now_ms();
        let _ = connection.execute(
            "insert or ignore into cut_refs(source_message_id, archived_message_id, relation, dedupe_reason, similarity_score, created_at, created_at_iso)
             values (?1, ?2, 'dedupe', 'exact_hash', 1.0, ?3, ?4)",
            params![&candidate.id, &candidate.id, ref_now, ms_to_iso(ref_now)],
        );
        return Ok(true);
    }

    // Phase 2: Near-duplicate candidate narrowing + Jaccard check
    let candidate_len = candidate.content.len() as f64;
    let length_min = (candidate_len * 0.8) as i64;
    let length_max = (candidate_len * 1.2) as i64;
    let mut statement = connection
        .prepare(
            "select id, content from cut_payload
             where length(content) between ?1 and ?2
             order by created_at desc limit 20",
        )
        .map_err(|error| to_error(format!("failed to prepare cut dedupe query: {error}")))?;
    let candidates: Vec<(String, String)> = statement
        .query_map(params![length_min, length_max], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| to_error(format!("failed to query cut dedupe candidates: {error}")))?
        .filter_map(|row| row.ok())
        .collect();

    for (existing_id, existing_content) in &candidates {
        let sim = similarity_score(existing_content, &candidate.content);
        if sim >= threshold {
            let ref_now = now_ms();
            let _ = connection.execute(
                "insert or ignore into cut_refs(source_message_id, archived_message_id, relation, dedupe_reason, similarity_score, created_at, created_at_iso)
                 values (?1, ?2, 'dedupe', 'near_duplicate', ?3, ?4, ?5)",
                params![&candidate.id, existing_id, sim, ref_now, ms_to_iso(ref_now)],
            );
            return Ok(true);
        }
    }
    Ok(false)
}

fn similarity_score(a: &str, b: &str) -> f64 {
    if a == b {
        return 1.0;
    }
    let left = normalized_bigrams(a);
    let right = normalized_bigrams(b);
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let left_len = left.len() as f64;
    let right_len = right.len() as f64;
    let overlap = left.intersection(&right).count() as f64;
    (2.0 * overlap) / (left_len + right_len)
}

fn normalized_bigrams(value: &str) -> HashSet<String> {
    let normalized = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    let chars = normalized.chars().collect::<Vec<_>>();
    if chars.len() < 2 {
        return HashSet::new();
    }
    (0..chars.len() - 1)
        .map(|index| format!("{}{}", chars[index], chars[index + 1]))
        .collect()
}

fn load_session_dialog(
    connection: &rusqlite::Connection,
    session_id: &str,
) -> Result<Vec<MemorySessionMessage>> {
    let mut statement = connection
        .prepare(
            "select id, role, content, turn_id, created_at, token_count, char_count, anchor_score, anchor_kind, project_root
             from session_dialog
             where session_id = ?1
             order by created_at asc",
        )
        .map_err(|error| to_error(format!("failed to prepare session dialog query: {error}")))?;
    let rows = statement
        .query_map(params![session_id], |row| {
            Ok(MemorySessionMessage {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                turn_id: row.get(3)?,
                created_at: row.get(4)?,
                token_count: row.get(5)?,
                char_count: row.get(6)?,
                anchor_score: row.get(7)?,
                anchor_kind: row.get(8)?,
                project_root: row.get(9)?,
            })
        })
        .map_err(|error| to_error(format!("failed to query session dialog rows: {error}")))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| to_error(format!("failed to collect session dialog rows: {error}")))
}

fn load_cut_messages(connection: &rusqlite::Connection) -> Result<Vec<MemorySessionMessage>> {
    let mut statement = connection
        .prepare(
            "select id, role, content, turn_id, created_at, token_count, char_count, anchor_score, anchor_kind, project_root
             from cut_payload
             order by created_at asc",
        )
        .map_err(|error| to_error(format!("failed to prepare cut payload query: {error}")))?;
    let rows = statement
        .query_map([], |row| {
            Ok(MemorySessionMessage {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                turn_id: row.get(3)?,
                created_at: row.get(4)?,
                token_count: row.get(5)?,
                char_count: row.get(6)?,
                anchor_score: row.get(7)?,
                anchor_kind: row.get(8)?,
                project_root: row.get(9)?,
            })
        })
        .map_err(|error| to_error(format!("failed to query cut rows: {error}")))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| to_error(format!("failed to collect cut rows: {error}")))
}

fn load_combined_messages(
    storage_root: &str,
    session_id: &str,
) -> Result<Vec<MemorySessionMessage>> {
    let config = load_memory_config(storage_root)?;
    let paths = ensure_memory_bootstrap(storage_root)?;
    let session_paths = resolve_session_memory_paths(&paths, session_id);
    let connection = open_sqlite(&session_paths.session_db_path)?;
    ensure_session_schema(&connection)?;
    let mut messages = load_session_dialog(&connection, session_id)?;

    if session_paths.cuts_root.exists() {
        let mut cut_paths = fs::read_dir(&session_paths.cuts_root)
            .map_err(|error| to_error(format!("failed to read cuts directory: {error}")))?
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("sqlite"))
            .collect::<Vec<_>>();
        cut_paths.sort();

        let token_budget = config.cut_recall_token_budget;
        if token_budget <= 0 {
            // Unlimited: load all cut files
            for cut_path in cut_paths.into_iter().rev() {
                let cut = open_sqlite(&cut_path)?;
                ensure_cut_schema(&cut)?;
                messages.extend(load_cut_messages(&cut)?);
            }
        } else {
            // Token-budget-based loading: newest first, stop when budget exhausted
            let mut consumed = 0_i64;
            for cut_path in cut_paths.into_iter().rev() {
                if consumed >= token_budget {
                    break;
                }
                let cut = open_sqlite(&cut_path)?;
                ensure_cut_schema(&cut)?;
                let cut_messages = load_cut_messages(&cut)?;
                for msg in cut_messages {
                    if consumed >= token_budget {
                        break;
                    }
                    consumed += msg.token_count;
                    messages.push(msg);
                }
            }
        }
    }

    Ok(messages)
}

fn select_keep_ids(messages: &[MemorySessionMessage], budget: &MemoryBudget) -> HashSet<String> {
    let selected = select_context_messages(messages, budget);
    selected.into_iter().map(|message| message.id).collect()
}

fn select_context_messages(
    messages: &[MemorySessionMessage],
    budget: &MemoryBudget,
) -> Vec<MemorySessionMessage> {
    if messages.is_empty() {
        return Vec::new();
    }

    let mut selected_indexes = HashSet::<usize>::new();
    let mut consumed_head = 0_i64;
    for (index, message) in messages.iter().enumerate() {
        if consumed_head >= budget.head_budget {
            break;
        }
        selected_indexes.insert(index);
        consumed_head += message.token_count.max(1);
    }

    let mut consumed_tail = 0_i64;
    for index in (0..messages.len()).rev() {
        if consumed_tail >= budget.tail_budget {
            break;
        }
        selected_indexes.insert(index);
        consumed_tail += messages[index].token_count.max(1);
    }

    let mut anchor_candidates = messages
        .iter()
        .enumerate()
        .filter(|(index, _)| !selected_indexes.contains(index))
        .filter(|(_, message)| message.anchor_score > 0.0)
        .map(|(index, message)| (index, message.anchor_score, message.created_at))
        .collect::<Vec<_>>();
    anchor_candidates.sort_by(|left, right| {
        right
            .1
            .partial_cmp(&left.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| right.2.cmp(&left.2))
    });

    let mut consumed_middle = 0_i64;
    for (index, _score, _created_at) in anchor_candidates {
        if consumed_middle >= budget.middle_budget {
            break;
        }
        for neighbor in index.saturating_sub(1)..=(index + 1).min(messages.len() - 1) {
            if selected_indexes.insert(neighbor) {
                consumed_middle += messages[neighbor].token_count.max(1);
            }
            if consumed_middle >= budget.middle_budget {
                break;
            }
        }
    }

    let mut selected = selected_indexes.into_iter().collect::<Vec<_>>();
    selected.sort_unstable();
    selected
        .into_iter()
        .map(|index| messages[index].clone())
        .collect()
}

fn process_due_memory_jobs(
    storage_root: &str,
    session_filter: Option<&str>,
) -> Result<(usize, Vec<EmittedMemoryEvent>)> {
    let paths = ensure_memory_bootstrap(storage_root)?;
    let config = load_memory_config(storage_root)?;
    let jobs_connection = open_sqlite(&paths.memory_jobs_db_path)?;
    ensure_memory_jobs_schema(&jobs_connection)?;
    let trigger_marks = open_sqlite(&paths.trigger_marks_db_path)?;
    ensure_trigger_marks_schema(&trigger_marks)?;

    reclaim_stale_job_leases(&jobs_connection)?;
    let batch_size = config
        .checkpoint_batch_size
        .max(1)
        .min(MEMORY_SCHEDULER_BATCH_LIMIT);
    let jobs = lease_jobs(&jobs_connection, session_filter, batch_size)?;
    let mut emitted = Vec::new();
    let mut refreshed_sessions = BTreeMap::<String, (String, Option<String>)>::new();
    let mut processed = 0_usize;
    let mut syntax_jobs_processed = 0_i64;
    let syntax_rate_limit = config.syntax_rate_limit_per_minute;

    for job in jobs {
        let payload = parse_json::<MemoryJobPayload>(&job.payload_json)?;
        let turn_id =
            resolve_turn_id_for_job(storage_root, &job.session_id, payload.turn_id.as_deref())?;
        let project_root = resolve_job_project_root(
            storage_root,
            &job.session_id,
            payload.project_root.as_deref(),
        )?;

        // Rate-limit syntax trigger jobs per batch
        if job.job_type == "syntax_trigger" && syntax_jobs_processed >= syntax_rate_limit {
            // Return excess syntax jobs to queue immediately so the next scheduler tick can pick
            // them up without waiting for the lease timeout.
            requeue_job(&jobs_connection, &job.id)?;
            continue;
        }

        let result = match job.job_type.as_str() {
            "syntax_trigger" => process_syntax_job(
                storage_root,
                &job.session_id,
                &turn_id,
                project_root.as_deref(),
                job.message_id.as_deref(),
                &payload,
                &config,
                &jobs_connection,
            ),
            "token_checkpoint" => process_checkpoint_job(
                storage_root,
                &job.session_id,
                &turn_id,
                project_root.as_deref(),
                &payload,
                &config,
                &jobs_connection,
            ),
            "model_guided_compaction" => process_compaction_job(
                storage_root,
                &job.session_id,
                &turn_id,
                project_root.as_deref(),
                &payload,
                &config,
            ),
            _ => Ok(Vec::new()),
        };

        match result {
            Ok(job_events) => {
                complete_job(&jobs_connection, &job.id)?;
                if job.job_type == "syntax_trigger" {
                    if let Some(message_id) = job.message_id.as_deref() {
                        mark_trigger_processed(&trigger_marks, &job.session_id, message_id)?;
                    }
                    syntax_jobs_processed += 1;
                }
                processed += 1;
                refreshed_sessions.insert(
                    job.session_id.clone(),
                    (turn_id.clone(), project_root.clone()),
                );
                for event in job_events {
                    emit_persisted_memory_event(
                        storage_root,
                        &job.session_id,
                        &turn_id,
                        &event.phase,
                        event.payload.clone(),
                    )?;
                    emitted.push(EmittedMemoryEvent {
                        session_id: job.session_id.clone(),
                        event,
                    });
                }
            }
            Err(error) => {
                fail_job(&jobs_connection, &job.id, &error.to_string())?;
            }
        }
    }

    for (session_id, (turn_id, project_root)) in refreshed_sessions {
        refresh_prompt_cache_snapshot(storage_root, &session_id, project_root.as_deref())?;
        let event = MemoryRuntimePhaseEvent {
            phase: "memory_prompt_cache_updated".to_string(),
            payload: json!({
                "sessionId": session_id,
            }),
        };
        emit_persisted_memory_event(
            storage_root,
            &session_id,
            &turn_id,
            &event.phase,
            event.payload.clone(),
        )?;
        emitted.push(EmittedMemoryEvent { session_id, event });
    }

    Ok((processed, emitted))
}

#[derive(Clone, Debug)]
struct LeasedMemoryJob {
    id: String,
    job_type: String,
    session_id: String,
    message_id: Option<String>,
    payload_json: String,
}

fn reclaim_stale_job_leases(connection: &rusqlite::Connection) -> Result<()> {
    let now = now_ms();
    connection
        .execute(
            "update jobs
             set status = 'retry_backoff',
                 lease_expires_at = null,
                 next_retry_at = ?1,
                 updated_at = ?1
             where status = 'running'
               and coalesce(lease_expires_at, 0) <= ?1",
            params![now],
        )
        .map_err(|error| to_error(format!("failed to reclaim stale memory jobs: {error}")))?;
    Ok(())
}

fn lease_jobs(
    connection: &rusqlite::Connection,
    session_filter: Option<&str>,
    batch_size: i64,
) -> Result<Vec<LeasedMemoryJob>> {
    let now = now_ms();
    let sql = if session_filter.is_some() {
        "select id, job_type, session_id, message_id, payload_json
         from jobs
         where session_id = ?1
           and status in ('queued', 'retry_backoff')
           and coalesce(next_retry_at, 0) <= ?2
         order by created_at asc
         limit ?3"
    } else {
        "select id, job_type, session_id, message_id, payload_json
         from jobs
         where status in ('queued', 'retry_backoff')
           and coalesce(next_retry_at, 0) <= ?1
         order by created_at asc
         limit ?2"
    };
    let mut statement = connection
        .prepare(sql)
        .map_err(|error| to_error(format!("failed to prepare memory job lease query: {error}")))?;
    let leased = if let Some(session_id) = session_filter {
        let rows = statement
            .query_map(params![session_id, now, batch_size], |row| {
                Ok(LeasedMemoryJob {
                    id: row.get(0)?,
                    job_type: row.get(1)?,
                    session_id: row.get(2)?,
                    message_id: row.get(3)?,
                    payload_json: row.get(4)?,
                })
            })
            .map_err(|error| to_error(format!("failed to query memory jobs: {error}")))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| to_error(format!("failed to collect memory jobs: {error}")))?
    } else {
        let rows = statement
            .query_map(params![now, batch_size], |row| {
                Ok(LeasedMemoryJob {
                    id: row.get(0)?,
                    job_type: row.get(1)?,
                    session_id: row.get(2)?,
                    message_id: row.get(3)?,
                    payload_json: row.get(4)?,
                })
            })
            .map_err(|error| to_error(format!("failed to query memory jobs: {error}")))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| to_error(format!("failed to collect memory jobs: {error}")))?
    };

    for job in &leased {
        connection
            .execute(
                "update jobs
                 set status = 'running',
                     attempts = attempts + 1,
                     lease_expires_at = ?2,
                     updated_at = ?3
                 where id = ?1",
                params![job.id, now + MEMORY_JOB_LEASE_MS, now],
            )
            .map_err(|error| to_error(format!("failed to lease memory job: {error}")))?;
    }
    Ok(leased)
}

fn complete_job(connection: &rusqlite::Connection, job_id: &str) -> Result<()> {
    connection
        .execute(
            "update jobs
             set status = 'completed',
                 lease_expires_at = null,
                 next_retry_at = null,
                 error_message = null,
                 updated_at = ?2
             where id = ?1",
            params![job_id, now_ms()],
        )
        .map_err(|error| to_error(format!("failed to complete memory job: {error}")))?;
    Ok(())
}

fn requeue_job(connection: &rusqlite::Connection, job_id: &str) -> Result<()> {
    connection
        .execute(
            "update jobs
             set status = 'queued',
                 lease_expires_at = null,
                 next_retry_at = null,
                 updated_at = ?2
             where id = ?1",
            params![job_id, now_ms()],
        )
        .map_err(|error| to_error(format!("failed to requeue memory job: {error}")))?;
    Ok(())
}

fn fail_job(connection: &rusqlite::Connection, job_id: &str, error_message: &str) -> Result<()> {
    let now = now_ms();
    connection
        .execute(
            "update jobs
             set status = 'retry_backoff',
                 lease_expires_at = null,
                 next_retry_at = ?2,
                 error_message = ?3,
                 updated_at = ?4
             where id = ?1",
            params![
                job_id,
                now + MEMORY_JOB_RETRY_BACKOFF_MS,
                error_message,
                now
            ],
        )
        .map_err(|error| to_error(format!("failed to back off memory job: {error}")))?;
    Ok(())
}

fn mark_trigger_processed(
    connection: &rusqlite::Connection,
    session_id: &str,
    message_id: &str,
) -> Result<()> {
    let now = now_ms();
    connection
        .execute(
            "update trigger_marks
             set processed_at = ?3, processed_at_iso = ?4
             where session_id = ?1 and message_id = ?2",
            params![session_id, message_id, now, ms_to_iso(now)],
        )
        .map_err(|error| to_error(format!("failed to mark trigger processed: {error}")))?;
    Ok(())
}

fn resolve_turn_id_for_job(
    storage_root: &str,
    session_id: &str,
    payload_turn_id: Option<&str>,
) -> Result<String> {
    if let Some(turn_id) = payload_turn_id.filter(|value| !value.trim().is_empty()) {
        return Ok(turn_id.to_string());
    }
    let latest_turn = registry_db::list_agent_turns(storage_root, session_id)?
        .into_iter()
        .last()
        .map(|turn| turn.id);
    Ok(latest_turn.unwrap_or_else(|| format!("memory-turn-{}", uuid::Uuid::new_v4())))
}

fn resolve_job_project_root(
    storage_root: &str,
    session_id: &str,
    payload_project_root: Option<&str>,
) -> Result<Option<String>> {
    if let Some(project_root) = payload_project_root.filter(|value| !value.trim().is_empty()) {
        return Ok(Some(project_root.to_string()));
    }
    Ok(registry_db::read_agent_session(storage_root, session_id)?
        .and_then(|session| session.project_root))
}

fn process_syntax_job(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    project_root: Option<&str>,
    message_id: Option<&str>,
    payload: &MemoryJobPayload,
    config: &AiMemoryConfig,
    jobs_connection: &rusqlite::Connection,
) -> Result<Vec<MemoryRuntimePhaseEvent>> {
    let content = payload.content.as_deref().unwrap_or_default().trim();
    if content.is_empty() {
        return Ok(Vec::new());
    }

    let ((decision, analysis_mode), fallback_scope) = analyze_memory_candidate(
        storage_root,
        session_id,
        project_root,
        payload,
        content,
        config,
    )?;
    if !decision.accepted && payload.trigger_kind.as_deref() == Some("semantic_candidate") {
        return Ok(vec![MemoryRuntimePhaseEvent {
            phase: "memory_candidate_rejected".to_string(),
            payload: json!({
                "reason": "semantic_candidate_rejected",
                "analysisMode": analysis_mode,
                "scope": decision.scope,
                "layer": decision.layer,
                "score": decision.score,
                "fallbackScope": fallback_scope,
            }),
        }]);
    }
    let entry = upsert_shared_entry(
        storage_root,
        &decision.layer,
        &decision.scope,
        if decision.scope == "project" {
            project_root
        } else {
            None
        },
        &decision.content,
        Some(session_id),
        message_id,
        decision.accepted,
        decision.score,
    )?;
    persist_memory_markdown(storage_root, &entry)?;
    maybe_enqueue_compaction_job(storage_root, jobs_connection, session_id, turn_id, &entry)?;

    Ok(vec![MemoryRuntimePhaseEvent {
        phase: if entry.layer == "frozen" {
            "memory_frozen_updated".to_string()
        } else {
            "memory_shared_updated".to_string()
        },
        payload: json!({
            "entryId": entry.id,
            "layer": entry.layer,
            "accepted": entry.accepted,
            "scope": entry.scope,
            "analysisMode": analysis_mode,
            "updateMode": decision.update_mode,
            "fallbackScope": fallback_scope,
        }),
    }])
}

fn process_checkpoint_job(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    project_root: Option<&str>,
    _payload: &MemoryJobPayload,
    config: &AiMemoryConfig,
    jobs_connection: &rusqlite::Connection,
) -> Result<Vec<MemoryRuntimePhaseEvent>> {
    let messages = load_combined_messages(storage_root, session_id)?;
    let recent_users = messages
        .into_iter()
        .filter(|message| message.role == "user")
        .rev()
        .take(8)
        .collect::<Vec<_>>();
    let mut events = Vec::new();
    for message in recent_users {
        if message.anchor_score < 0.65 || message.content.len() < 24 {
            continue;
        }
        let payload = MemoryJobPayload {
            turn_id: Some(turn_id.to_string()),
            project_root: project_root.map(str::to_string),
            content: Some(message.content.clone()),
            score: Some(message.anchor_score),
            trigger_kind: message.anchor_kind.clone(),
            layer: Some(if message.anchor_kind.as_deref() == Some("profile") {
                "frozen".to_string()
            } else {
                "shared".to_string()
            }),
            scope: Some(
                if message.anchor_kind.as_deref() == Some("project_constraint") {
                    "project".to_string()
                } else if message.anchor_kind.as_deref() == Some("profile") {
                    "user".to_string()
                } else {
                    "global".to_string()
                },
            ),
            ..MemoryJobPayload::default()
        };
        let ((decision, analysis_mode), _) = analyze_memory_candidate(
            storage_root,
            session_id,
            project_root,
            &payload,
            &message.content,
            config,
        )?;
        let entry = upsert_shared_entry(
            storage_root,
            &decision.layer,
            &decision.scope,
            if decision.scope == "project" {
                project_root
            } else {
                None
            },
            &decision.content,
            Some(session_id),
            Some(&message.id),
            decision.accepted,
            decision.score,
        )?;
        persist_memory_markdown(storage_root, &entry)?;
        maybe_enqueue_compaction_job(storage_root, jobs_connection, session_id, turn_id, &entry)?;
        events.push(MemoryRuntimePhaseEvent {
            phase: if entry.layer == "frozen" {
                "memory_frozen_updated".to_string()
            } else {
                "memory_shared_updated".to_string()
            },
            payload: json!({
                "entryId": entry.id,
                "layer": entry.layer,
                "accepted": entry.accepted,
                "scope": entry.scope,
                "analysisMode": analysis_mode,
                "updateMode": decision.update_mode,
            }),
        });
    }
    Ok(events)
}

fn process_compaction_job(
    storage_root: &str,
    session_id: &str,
    _turn_id: &str,
    project_root: Option<&str>,
    payload: &MemoryJobPayload,
    config: &AiMemoryConfig,
) -> Result<Vec<MemoryRuntimePhaseEvent>> {
    let layer = payload.layer.as_deref().unwrap_or("shared");
    let scope = payload.scope.as_deref().unwrap_or("global");
    let effective_project_root = if scope == "project" {
        project_root
    } else {
        None
    };
    let entries = read_compaction_candidates(storage_root, layer, scope, effective_project_root)?;
    if entries.len() < COMPACTION_ENTRY_TRIGGER_COUNT {
        return Ok(Vec::new());
    }

    let (decision, compaction_mode) = build_compaction_decision(
        storage_root,
        session_id,
        layer,
        scope,
        effective_project_root,
        &entries,
        config,
    )?;
    let canonical_items = normalize_compaction_items(&decision.items);
    if canonical_items.is_empty() {
        return Ok(Vec::new());
    }

    let mut kept_stable_keys = HashSet::new();
    for item in canonical_items {
        let entry = upsert_shared_entry(
            storage_root,
            layer,
            scope,
            effective_project_root,
            &item.content,
            Some(session_id),
            None,
            true,
            item.score
                .unwrap_or(config.shared_classify_score_threshold.max(0.9)),
        )?;
        kept_stable_keys.insert(entry.stable_key.clone());
    }

    let deprecated = entries
        .into_iter()
        .filter(|entry| !kept_stable_keys.contains(&entry.stable_key))
        .collect::<Vec<_>>();
    deprecate_shared_entries(storage_root, &deprecated)?;
    rewrite_memory_markdown(storage_root, layer)?;

    Ok(vec![MemoryRuntimePhaseEvent {
        phase: if layer == "frozen" {
            "memory_frozen_updated".to_string()
        } else {
            "memory_shared_updated".to_string()
        },
        payload: json!({
            "layer": layer,
            "scope": scope,
            "compaction": true,
            "compactionMode": compaction_mode,
            "deprecatedCount": deprecated.len(),
            "keptCount": kept_stable_keys.len(),
        }),
    }])
}

fn maybe_enqueue_compaction_job(
    storage_root: &str,
    jobs_connection: &rusqlite::Connection,
    session_id: &str,
    turn_id: &str,
    entry: &SharedMemoryEntry,
) -> Result<()> {
    if !entry.accepted {
        return Ok(());
    }
    let relevant = read_compaction_candidates(
        storage_root,
        &entry.layer,
        &entry.scope,
        entry.project_root.as_deref(),
    )?;
    if relevant.len() < COMPACTION_ENTRY_TRIGGER_COUNT {
        return Ok(());
    }

    insert_memory_job_if_absent(
        jobs_connection,
        "model_guided_compaction",
        session_id,
        None,
        &MemoryJobPayload {
            turn_id: Some(turn_id.to_string()),
            project_root: entry.project_root.clone(),
            layer: Some(entry.layer.clone()),
            scope: Some(entry.scope.clone()),
            ..MemoryJobPayload::default()
        },
    )
}

fn read_compaction_candidates(
    storage_root: &str,
    layer: &str,
    scope: &str,
    project_root: Option<&str>,
) -> Result<Vec<SharedMemoryEntry>> {
    let paths = ensure_memory_bootstrap(storage_root)?;
    let connection = open_sqlite(&paths.shared_index_db_path)?;
    ensure_shared_index_schema(&connection)?;
    let mut entries = read_shared_entries(&connection, Some(layer), true)?;
    entries.retain(|entry| {
        entry.scope == scope
            && match scope {
                "project" => entry.project_root.as_deref() == project_root,
                _ => true,
            }
    });
    entries.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| right.updated_at.cmp(&left.updated_at))
    });
    Ok(entries)
}

fn analyze_memory_candidate(
    storage_root: &str,
    session_id: &str,
    project_root: Option<&str>,
    payload: &MemoryJobPayload,
    content: &str,
    config: &AiMemoryConfig,
) -> Result<((MemoryAnalysisDecision, &'static str), String)> {
    let fallback = heuristic_memory_decision(payload, content, config);
    let fallback_scope = fallback.scope.clone();

    // If model refinement is disabled, use heuristic only
    if !config.syntax_model_refine_enabled {
        return Ok(((fallback, "heuristic"), fallback_scope));
    }

    let Some(profile) = resolve_memory_analysis_profile(storage_root, session_id, config)? else {
        return Ok(((fallback, "heuristic"), fallback_scope));
    };

    let secrets = resolve_secret_values(&profile.secret_refs, None, &KeyringSecretStore)?;
    let user_prompt = format!(
        "Classify whether this user message should become durable IDE memory. Return JSON only with keys accepted, layer, scope, content, score, updateMode.\n\
         Allowed layer values: shared, frozen.\n\
         Allowed scope values: project, global, user.\n\
         Allowed updateMode values: replace, merge, deprecate.\n\
         Prefer concise canonical memory text, not a quote dump.\n\
         Reject volatile requests, one-off tasks, or step-local chatter.\n\
         Project root: {}.\n\
         Fallback layer: {}.\n\
         Fallback scope: {}.\n\
         Fallback score: {:.3}.\n\
         Candidate content:\n{}",
        project_root.unwrap_or(""),
        fallback.layer,
        fallback.scope,
        fallback.score,
        content.trim()
    );
    let response = provider::run_agent_inference(
        &profile.to_public(),
        &secrets,
        &[AgentInferenceMessage {
            role: AgentInferenceMessageRole::User,
            content: user_prompt,
            tool_call_id: None,
            tool_calls: Vec::new(),
        }],
        &[],
        None,
        None,
    );
    let Ok(response) = response else {
        return Ok(((fallback, "heuristic"), fallback_scope));
    };
    let Some(mut decision) = parse_model_json::<MemoryAnalysisDecision>(&response.assistant_text)
    else {
        return Ok(((fallback, "heuristic"), fallback_scope));
    };

    if decision.content.trim().is_empty() {
        decision.content = fallback.content.clone();
    } else {
        decision.content = canonicalize_memory_content(&decision.content);
    }
    if !matches!(decision.layer.as_str(), "shared" | "frozen") {
        decision.layer = fallback.layer.clone();
    }
    if !matches!(decision.scope.as_str(), "project" | "global" | "user") {
        decision.scope = fallback.scope.clone();
    }
    if decision.scope == "project" && project_root.is_none() {
        decision.scope = "global".to_string();
    }
    decision.score = decision.score.clamp(0.0, 1.0);
    if !matches!(
        decision.update_mode.as_str(),
        "replace" | "merge" | "deprecate"
    ) {
        decision.update_mode = "merge".to_string();
    }

    Ok(((decision, "model"), fallback_scope))
}

fn heuristic_memory_decision(
    payload: &MemoryJobPayload,
    content: &str,
    config: &AiMemoryConfig,
) -> MemoryAnalysisDecision {
    let trigger_kind = payload.trigger_kind.as_deref();
    let layer = payload.layer.clone().unwrap_or_else(|| {
        if trigger_kind == Some("profile") {
            "frozen".to_string()
        } else {
            "shared".to_string()
        }
    });
    let mut scope = payload.scope.clone().unwrap_or_else(|| {
        if trigger_kind == Some("project_constraint") {
            "project".to_string()
        } else if layer == "frozen" {
            "user".to_string()
        } else {
            "global".to_string()
        }
    });
    if !matches!(scope.as_str(), "project" | "global" | "user") {
        scope = "global".to_string();
    }
    let score = payload.score.unwrap_or(0.0).clamp(0.0, 1.0);
    MemoryAnalysisDecision {
        accepted: score >= config.shared_classify_score_threshold,
        layer,
        scope,
        content: canonicalize_memory_content(content),
        score,
        update_mode: "merge".to_string(),
    }
}

fn resolve_memory_analysis_profile(
    storage_root: &str,
    session_id: &str,
    config: &AiMemoryConfig,
) -> Result<Option<StoredAiProviderProfile>> {
    let mut candidates = Vec::new();
    if let Some(profile_id) = config.memory_analysis_profile_id.as_deref() {
        candidates.push(profile_id.to_string());
    }
    if let Some(profile_id) = registry_db::read_agent_session(storage_root, session_id)?
        .and_then(|session| session.profile_id)
    {
        candidates.push(profile_id);
    }
    for candidate in candidates {
        if let Some(profile) = registry_db::read_profile_record(storage_root, &candidate)? {
            if profile_supports_memory_analysis(&profile) {
                return Ok(Some(profile));
            }
        }
    }
    Ok(registry_db::read_default_profile_record(storage_root)?
        .filter(profile_supports_memory_analysis))
}

fn profile_supports_memory_analysis(profile: &StoredAiProviderProfile) -> bool {
    matches!(
        profile.protocol_id.as_str(),
        "openai_compatible" | "lmstudio_openai" | "anthropic_messages"
    )
}

fn parse_model_json<T: serde::de::DeserializeOwned>(value: &str) -> Option<T> {
    if let Ok(parsed) = serde_json::from_str::<T>(value.trim()) {
        return Some(parsed);
    }
    let trimmed = value.trim();
    let fenced = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```JSON"))
        .or_else(|| trimmed.strip_prefix("```"));
    if let Some(fenced) = fenced {
        let inner = fenced.trim();
        if let Some(stripped) = inner.strip_suffix("```") {
            if let Ok(parsed) = serde_json::from_str::<T>(stripped.trim()) {
                return Some(parsed);
            }
        }
    }
    for (open, close) in [('{', '}'), ('[', ']')] {
        if let Some(start) = trimmed.find(open) {
            if let Some(end) = trimmed.rfind(close) {
                if end > start {
                    if let Ok(parsed) = serde_json::from_str::<T>(&trimmed[start..=end]) {
                        return Some(parsed);
                    }
                }
            }
        }
    }
    None
}

fn build_compaction_decision(
    storage_root: &str,
    session_id: &str,
    layer: &str,
    scope: &str,
    project_root: Option<&str>,
    entries: &[SharedMemoryEntry],
    config: &AiMemoryConfig,
) -> Result<(MemoryCompactionDecision, &'static str)> {
    if config.enable_model_guided_compaction {
        if let Some(profile) = resolve_memory_analysis_profile(storage_root, session_id, config)? {
            let secrets = resolve_secret_values(&profile.secret_refs, None, &KeyringSecretStore)?;
            let prompt = format!(
                "Consolidate these durable IDE memory items into at most {} canonical entries. Return JSON only with {{\"items\":[{{\"content\":\"...\",\"score\":0.0}}]}}.\n\
                 Keep the same layer and scope semantics.\n\
                 Layer: {}.\n\
                 Scope: {}.\n\
                 Project root: {}.\n\
                 Entries:\n{}",
                MEMORY_COMPACTION_TARGET_COUNT,
                layer,
                scope,
                project_root.unwrap_or(""),
                entries
                    .iter()
                    .map(|entry| format!("- ({:.3}) {}", entry.score, entry.content.replace('\n', " ")))
                    .collect::<Vec<_>>()
                    .join("\n")
            );
            if let Ok(response) = provider::run_agent_inference(
                &profile.to_public(),
                &secrets,
                &[AgentInferenceMessage {
                    role: AgentInferenceMessageRole::User,
                    content: prompt,
                    tool_call_id: None,
                    tool_calls: Vec::new(),
                }],
                &[],
                None,
                None,
            ) {
                if let Some(mut decision) =
                    parse_model_json::<MemoryCompactionDecision>(&response.assistant_text)
                {
                    decision.items = normalize_compaction_items(&decision.items);
                    if !decision.items.is_empty() {
                        return Ok((decision, "model"));
                    }
                }
            }
        }
    }

    let items = entries
        .iter()
        .take(MEMORY_COMPACTION_TARGET_COUNT)
        .map(|entry| MemoryCompactionItem {
            content: entry.content.clone(),
            score: Some(entry.score),
        })
        .collect::<Vec<_>>();
    Ok((
        MemoryCompactionDecision {
            items: normalize_compaction_items(&items),
        },
        "heuristic",
    ))
}

fn normalize_compaction_items(items: &[MemoryCompactionItem]) -> Vec<MemoryCompactionItem> {
    let mut seen = HashSet::new();
    items
        .iter()
        .filter_map(|item| {
            let content = canonicalize_memory_content(&item.content);
            if content.is_empty() {
                return None;
            }
            let fingerprint = content.to_lowercase();
            if !seen.insert(fingerprint) {
                return None;
            }
            Some(MemoryCompactionItem {
                content,
                score: item.score.map(|score| score.clamp(0.0, 1.0)),
            })
        })
        .take(MEMORY_COMPACTION_TARGET_COUNT)
        .collect()
}

fn canonicalize_memory_content(content: &str) -> String {
    normalize_whitespace(content)
}

/// Simple whitespace normalization — used for non-archive contexts.
fn normalize_whitespace(content: &str) -> String {
    content
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

/// Full archive text normalization per design doc:
/// 1. Remove Unicode punctuation (P* categories)
/// 2. Remove emoji & pictographic symbols
/// 3. Fold consecutive whitespace
/// 4. Preserve language chars + digits + structural separators
fn normalize_archive_text(content: &str) -> String {
    let mut result = String::with_capacity(content.len());
    for ch in content.chars() {
        if is_emoji_or_pictographic(ch) {
            continue;
        }
        if ch.is_ascii_punctuation() || is_unicode_punctuation(ch) {
            continue;
        }
        result.push(ch);
    }
    normalize_whitespace(&result)
}

fn is_unicode_punctuation(ch: char) -> bool {
    // Unicode General Categories for punctuation: Pc, Pd, Pe, Pf, Pi, Po, Ps
    matches!(
        unicode_general_category(ch),
        'c' | 'd' | 'e' | 'f' | 'i' | 'o' | 's'
    )
}

fn unicode_general_category(ch: char) -> char {
    // Simplified: check major Unicode punctuation ranges
    let cp = ch as u32;
    match cp {
        // Common Unicode punctuation blocks
        0x2000..=0x206F => 'o', // General Punctuation
        0x2E00..=0x2E7F => 'o', // Supplemental Punctuation
        0x3000..=0x303F => 'o', // CJK Symbols and Punctuation
        0xFE30..=0xFE4F => 'o', // CJK Compatibility Forms
        0xFE50..=0xFE6F => 'o', // Small Form Variants
        0xFF01..=0xFF0F | 0xFF1A..=0xFF20 | 0xFF3B..=0xFF40 | 0xFF5B..=0xFF65 => 'o', // Fullwidth punctuation
        _ => '_', // Not punctuation
    }
}

fn is_emoji_or_pictographic(ch: char) -> bool {
    let cp = ch as u32;
    matches!(cp,
        0x1F300..=0x1F9FF |  // Misc Symbols & Pictographs, Emoticons, etc.
        0x2600..=0x26FF   |  // Misc Symbols
        0x2700..=0x27BF   |  // Dingbats
        0xFE00..=0xFE0F   |  // Variation Selectors
        0x200D            |  // Zero Width Joiner
        0x20E3            |  // Combining Enclosing Keycap
        0x1F000..=0x1F02F |  // Mahjong, Domino
        0x1FA00..=0x1FA6F |  // Chess
        0x1FA70..=0x1FAFF |  // Symbols Extended-A
        0xE0020..=0xE007F    // Tags
    )
}

/// Compute TF-IDF-like sparse vector from text content.
/// Returns sorted Vec of (term, tf_weight) pairs for cosine similarity.
fn compute_tfidf_vector(content: &str) -> Vec<(String, f64)> {
    let mut term_counts: BTreeMap<String, usize> = BTreeMap::new();
    let tokens: Vec<String> = content
        .split(|c: char| c.is_whitespace() || c.is_ascii_punctuation())
        .filter(|t| t.len() >= 2 && t.len() <= 80)
        .map(|t| t.to_lowercase())
        .collect();
    let total = tokens.len().max(1) as f64;
    for token in &tokens {
        *term_counts.entry(token.clone()).or_insert(0) += 1;
    }
    // Also add bigrams for better semantic matching
    for pair in tokens.windows(2) {
        let bigram = format!("{}_{}", pair[0], pair[1]);
        *term_counts.entry(bigram).or_insert(0) += 1;
    }
    let mut vector: Vec<(String, f64)> = term_counts
        .into_iter()
        .map(|(term, count)| {
            // TF = count / total, no IDF (single-document context)
            let tf = (count as f64) / total;
            (term, tf)
        })
        .collect();
    // Normalize to unit vector
    let magnitude = vector.iter().map(|(_, w)| w * w).sum::<f64>().sqrt();
    if magnitude > 0.0 {
        for (_, w) in &mut vector {
            *w /= magnitude;
        }
    }
    // Keep top terms only to limit storage
    vector.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    vector.truncate(128);
    vector
}

/// Cosine similarity between two TF-IDF sparse vectors.
fn tfidf_cosine_similarity(a: &[(String, f64)], b: &[(String, f64)]) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    // Build map for b
    let b_map: BTreeMap<&str, f64> = b.iter().map(|(k, v)| (k.as_str(), *v)).collect();
    let dot: f64 = a
        .iter()
        .filter_map(|(term, weight)| b_map.get(term.as_str()).map(|bw| weight * bw))
        .sum();
    // Both vectors are already normalized to unit length, so dot product = cosine
    dot.clamp(0.0, 1.0)
}

fn upsert_shared_entry(
    storage_root: &str,
    layer: &str,
    scope: &str,
    project_root: Option<&str>,
    content: &str,
    source_session_id: Option<&str>,
    source_message_id: Option<&str>,
    accepted: bool,
    score: f64,
) -> Result<SharedMemoryEntry> {
    let paths = ensure_memory_bootstrap(storage_root)?;
    let connection = open_sqlite(&paths.shared_index_db_path)?;
    ensure_shared_index_schema(&connection)?;
    let stable_key = digest_key(&format!(
        "{layer}:{scope}:{}",
        content.trim().to_lowercase()
    ));
    let now = now_ms();
    let existing = connection
        .query_row(
            "select id, revision, created_at from entries where stable_key = ?1",
            params![stable_key],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| to_error(format!("failed to query shared entry: {error}")))?;

    let entry = if let Some((id, revision, created_at)) = existing {
        let now_iso_str = ms_to_iso(now);
        let embedding = compute_tfidf_vector(content.trim());
        let embedding_json = serde_json::to_string(&embedding).ok();
        let entry = SharedMemoryEntry {
            id,
            layer: layer.to_string(),
            scope: scope.to_string(),
            project_root: project_root.map(str::to_string),
            content: content.trim().to_string(),
            source_session_id: source_session_id.map(str::to_string),
            source_message_id: source_message_id.map(str::to_string),
            stable_key: stable_key.clone(),
            content_hash: digest_key(content),
            revision: revision + 1,
            accepted,
            score,
            last_used: None,
            created_at,
            updated_at: now,
        };
        connection
            .execute(
                "update entries
                 set layer = ?2,
                     scope = ?3,
                     project_root = ?4,
                     content = ?5,
                     source_session_id = ?6,
                     source_message_id = ?7,
                     content_hash = ?8,
                     revision = ?9,
                     accepted = ?10,
                     score = ?11,
                     updated_at = ?12,
                     updated_at_iso = ?13,
                     embedding_json = ?14
                 where stable_key = ?1",
                params![
                    &entry.stable_key,
                    &entry.layer,
                    &entry.scope,
                    &entry.project_root,
                    &entry.content,
                    &entry.source_session_id,
                    &entry.source_message_id,
                    &entry.content_hash,
                    entry.revision,
                    if entry.accepted { 1 } else { 0 },
                    entry.score,
                    entry.updated_at,
                    &now_iso_str,
                    &embedding_json,
                ],
            )
            .map_err(|error| to_error(format!("failed to update shared entry: {error}")))?;
        entry
    } else {
        let now_iso_str = ms_to_iso(now);
        let embedding = compute_tfidf_vector(content.trim());
        let embedding_json = serde_json::to_string(&embedding).ok();
        let entry = SharedMemoryEntry {
            id: format!("memory-entry-{}", uuid::Uuid::new_v4()),
            layer: layer.to_string(),
            scope: scope.to_string(),
            project_root: project_root.map(str::to_string),
            content: content.trim().to_string(),
            source_session_id: source_session_id.map(str::to_string),
            source_message_id: source_message_id.map(str::to_string),
            stable_key: stable_key.clone(),
            content_hash: digest_key(content),
            revision: 1,
            accepted,
            score,
            last_used: None,
            created_at: now,
            updated_at: now,
        };
        connection
            .execute(
                "insert into entries(
                   id, layer, scope, project_root, content, source_session_id, source_message_id,
                   stable_key, content_hash, revision, accepted, score, last_used,
                   created_at, created_at_iso, updated_at, updated_at_iso, embedding_json
                 ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, null, ?13, ?14, ?15, ?16, ?17)",
                params![
                    &entry.id,
                    &entry.layer,
                    &entry.scope,
                    &entry.project_root,
                    &entry.content,
                    &entry.source_session_id,
                    &entry.source_message_id,
                    &entry.stable_key,
                    &entry.content_hash,
                    entry.revision,
                    if entry.accepted { 1 } else { 0 },
                    entry.score,
                    entry.created_at,
                    &now_iso_str,
                    entry.updated_at,
                    &now_iso_str,
                    &embedding_json,
                ],
            )
            .map_err(|error| to_error(format!("failed to insert shared entry: {error}")))?;
        entry
    };

    write_memory_audit(
        storage_root,
        &entry,
        if entry.revision == 1 {
            "replace"
        } else {
            "merge"
        },
    )?;
    Ok(entry)
}

fn write_memory_audit(storage_root: &str, entry: &SharedMemoryEntry, action: &str) -> Result<()> {
    let paths = ensure_memory_bootstrap(storage_root)?;
    let path = if entry.layer == "frozen" {
        &paths.frozen_audit_path
    } else {
        &paths.shared_audit_path
    };
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| {
            to_error(format!(
                "failed to open memory audit {}: {error}",
                path.display()
            ))
        })?;
    let line = format!(
        "{}\n",
        to_json(&json!({
            "id": entry.id,
            "stableKey": entry.stable_key,
            "layer": entry.layer,
            "scope": entry.scope,
            "action": action,
            "accepted": entry.accepted,
            "revision": entry.revision,
            "score": entry.score,
            "sourceSessionId": entry.source_session_id,
            "sourceMessageId": entry.source_message_id,
            "updatedAt": entry.updated_at,
            "content": entry.content,
        }))?
    );
    file.write_all(line.as_bytes())
        .map_err(|error| to_error(format!("failed to write memory audit entry: {error}")))?;
    Ok(())
}

fn persist_memory_markdown(storage_root: &str, entry: &SharedMemoryEntry) -> Result<()> {
    rewrite_memory_markdown(storage_root, &entry.layer)
}

fn rewrite_memory_markdown(storage_root: &str, layer: &str) -> Result<()> {
    let paths = ensure_memory_bootstrap(storage_root)?;
    let path = if layer == "frozen" {
        &paths.frozen_memory_path
    } else {
        &paths.shared_memory_path
    };
    let connection = open_sqlite(&paths.shared_index_db_path)?;
    ensure_shared_index_schema(&connection)?;
    let accepted_entries = read_shared_entries(&connection, Some(layer), true)?;
    let header = if layer == "frozen" {
        "# Frozen Memory\n"
    } else {
        "# Shared Memory\n"
    };
    let mut contents = String::from(header);
    for item in accepted_entries {
        contents.push_str(&format!(
            "- [{}] {}\n",
            item.scope,
            item.content.replace('\n', " ")
        ));
    }
    fs::write(path, contents).map_err(|error| {
        to_error(format!(
            "failed to write memory markdown {}: {error}",
            path.display()
        ))
    })?;
    Ok(())
}

fn deprecate_shared_entries(storage_root: &str, entries: &[SharedMemoryEntry]) -> Result<()> {
    if entries.is_empty() {
        return Ok(());
    }
    let paths = ensure_memory_bootstrap(storage_root)?;
    let connection = open_sqlite(&paths.shared_index_db_path)?;
    ensure_shared_index_schema(&connection)?;
    let now = now_ms();
    for entry in entries {
        connection
            .execute(
                "update entries
                 set accepted = 0,
                     revision = ?2,
                     updated_at = ?3
                 where id = ?1",
                params![&entry.id, entry.revision + 1, now],
            )
            .map_err(|error| to_error(format!("failed to deprecate shared entry: {error}")))?;
        let mut deprecated = entry.clone();
        deprecated.accepted = false;
        deprecated.revision += 1;
        deprecated.updated_at = now;
        write_memory_audit(storage_root, &deprecated, "deprecate")?;
    }
    Ok(())
}

fn read_shared_entries(
    connection: &rusqlite::Connection,
    layer: Option<&str>,
    accepted_only: bool,
) -> Result<Vec<SharedMemoryEntry>> {
    let sql = if layer.is_some() {
        if accepted_only {
            "select id, layer, scope, project_root, content, source_session_id, source_message_id, stable_key, content_hash, revision, accepted, score, last_used, created_at, updated_at
             from entries where layer = ?1 and accepted = 1 order by updated_at desc"
        } else {
            "select id, layer, scope, project_root, content, source_session_id, source_message_id, stable_key, content_hash, revision, accepted, score, last_used, created_at, updated_at
             from entries where layer = ?1 order by updated_at desc"
        }
    } else if accepted_only {
        "select id, layer, scope, project_root, content, source_session_id, source_message_id, stable_key, content_hash, revision, accepted, score, last_used, created_at, updated_at
         from entries where accepted = 1 order by updated_at desc"
    } else {
        "select id, layer, scope, project_root, content, source_session_id, source_message_id, stable_key, content_hash, revision, accepted, score, last_used, created_at, updated_at
         from entries order by updated_at desc"
    };
    let mut statement = connection
        .prepare(sql)
        .map_err(|error| to_error(format!("failed to prepare shared entry query: {error}")))?;
    let query = if let Some(layer) = layer {
        statement.query_map(params![layer], map_shared_entry)
    } else {
        statement.query_map([], map_shared_entry)
    }
    .map_err(|error| to_error(format!("failed to query shared entries: {error}")))?;
    query
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| to_error(format!("failed to collect shared entries: {error}")))
}

fn map_shared_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<SharedMemoryEntry> {
    Ok(SharedMemoryEntry {
        id: row.get(0)?,
        layer: row.get(1)?,
        scope: row.get(2)?,
        project_root: row.get(3)?,
        content: row.get(4)?,
        source_session_id: row.get(5)?,
        source_message_id: row.get(6)?,
        stable_key: row.get(7)?,
        content_hash: row.get(8)?,
        revision: row.get(9)?,
        accepted: row.get::<_, i64>(10)? != 0,
        score: row.get(11)?,
        last_used: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

fn select_shared_entries(
    storage_root: &str,
    session_id: &str,
    budget: &MemoryBudget,
    project_root: Option<&str>,
) -> Result<Vec<SharedMemoryEntry>> {
    let paths = ensure_memory_bootstrap(storage_root)?;
    let connection = open_sqlite(&paths.shared_index_db_path)?;
    ensure_shared_index_schema(&connection)?;
    let mut candidates = read_shared_entries(&connection, None, true)?;

    // Build query vector from recent session messages for semantic matching
    let query_vector = build_query_vector(storage_root, session_id);

    candidates.sort_by(|left, right| {
        score_shared_candidate_hybrid(right, project_root, &query_vector)
            .partial_cmp(&score_shared_candidate_hybrid(
                left,
                project_root,
                &query_vector,
            ))
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| right.updated_at.cmp(&left.updated_at))
    });

    let mut selected = Vec::new();
    let mut consumed = 0_i64;
    for mut candidate in candidates.into_iter().take(MAX_PROMPT_CACHE_ENTRIES * 2) {
        let token_cost = estimate_token_count(&candidate.content);
        if consumed + token_cost > budget.shared_budget {
            continue;
        }
        consumed += token_cost;
        candidate.last_used = Some(now_ms());
        connection
            .execute(
                "update entries set last_used = ?2 where id = ?1",
                params![&candidate.id, candidate.last_used],
            )
            .map_err(|error| to_error(format!("failed to touch shared entry usage: {error}")))?;
        selected.push(candidate);
        if selected.len() >= MAX_PROMPT_CACHE_ENTRIES {
            break;
        }
    }
    persist_prompt_cache(
        storage_root,
        session_id,
        Some(&render_memory_injection(&selected)),
        &selected,
    )?;
    Ok(selected)
}

/// Build a query TF-IDF vector from recent user messages in the session
fn build_query_vector(storage_root: &str, session_id: &str) -> Vec<(String, f64)> {
    let Ok(messages) = load_combined_messages(storage_root, session_id) else {
        return Vec::new();
    };
    let recent_user_text: String = messages
        .iter()
        .rev()
        .filter(|m| m.role == "user")
        .take(5)
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    if recent_user_text.is_empty() {
        return Vec::new();
    }
    compute_tfidf_vector(&recent_user_text)
}

/// Hybrid scoring: base_score * 0.3 + recency * 0.2 + tfidf_similarity * 0.5
fn score_shared_candidate_hybrid(
    entry: &SharedMemoryEntry,
    project_root: Option<&str>,
    query_vector: &[(String, f64)],
) -> f64 {
    // Base score with scope bonuses
    let mut base_score = entry.score;
    if entry.scope == "project"
        && project_root.is_some()
        && entry.project_root.as_deref() == project_root
    {
        base_score += 0.4;
    } else if entry.scope == "global" {
        base_score += 0.1;
    } else if entry.layer == "frozen" {
        base_score += 0.05;
    }

    // Time-based decay: frozen layer exempt
    let decay = if entry.layer == "frozen" {
        1.0
    } else {
        let now = now_ms();
        let last_used = entry.last_used.unwrap_or(entry.updated_at);
        let days_since = ((now - last_used) as f64) / (86_400_000.0);
        1.0 / (1.0 + days_since * 0.01)
    };
    base_score *= decay;

    // Recency score (0-1 range, based on updated_at)
    let now = now_ms();
    let age_days = ((now - entry.updated_at) as f64) / 86_400_000.0;
    let recency_score = 1.0 / (1.0 + age_days * 0.005);

    // TF-IDF semantic similarity
    let semantic_score = if query_vector.is_empty() {
        0.0
    } else {
        let entry_vector = compute_tfidf_vector(&entry.content);
        tfidf_cosine_similarity(query_vector, &entry_vector)
    };

    // Weighted combination
    0.3 * base_score + 0.2 * recency_score + 0.5 * semantic_score
}

/// Legacy non-hybrid scoring for contexts without query vector
fn score_shared_candidate(entry: &SharedMemoryEntry, project_root: Option<&str>) -> f64 {
    score_shared_candidate_hybrid(entry, project_root, &[])
}

fn render_memory_injection(entries: &[SharedMemoryEntry]) -> String {
    entries
        .iter()
        .map(|entry| {
            format!(
                "- [{}:{}] {}",
                entry.layer,
                entry.scope,
                entry.content.replace('\n', " ")
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn render_memory_snapshot_sections(entries: &[SharedMemoryEntry]) -> MemoryPromptSnapshot {
    let mut recall = Vec::new();
    let mut user_preferences = Vec::new();
    let mut frozen = Vec::new();

    for entry in entries {
        let normalized = entry.content.replace('\n', " ");
        let bullet = format!("- [{}:{}] {}", entry.layer, entry.scope, normalized);
        if entry.layer == "frozen" {
            frozen.push(bullet);
            continue;
        }
        if entry.scope == "user" {
            user_preferences.push(bullet);
            continue;
        }
        recall.push(bullet);
    }

    MemoryPromptSnapshot {
        memory_recall_results: if recall.is_empty() {
            "- none".to_string()
        } else {
            recall.join("\n")
        },
        user_habits_and_preferences: if user_preferences.is_empty() {
            "- none".to_string()
        } else {
            user_preferences.join("\n")
        },
        frozen_memory_facts: if frozen.is_empty() {
            "- none".to_string()
        } else {
            frozen.join("\n")
        },
    }
}

fn persist_prompt_cache(
    storage_root: &str,
    session_id: &str,
    injected_text: Option<&str>,
    entries: &[SharedMemoryEntry],
) -> Result<()> {
    let paths = ensure_memory_bootstrap(storage_root)?;
    let connection = open_sqlite(&paths.prompt_cache_db_path)?;
    ensure_prompt_cache_schema(&connection)?;
    let injected = injected_text.unwrap_or("");
    let reasons = entries
        .iter()
        .map(|entry| {
            json!({
                "entryId": entry.id,
                "layer": entry.layer,
                "scope": entry.scope,
                "score": entry.score,
            })
        })
        .collect::<Vec<_>>();
    let pc_now = now_ms();
    connection
        .execute(
            "insert into prompt_cache(session_id, injected_text, reasons_json, updated_at, updated_at_iso)
             values (?1, ?2, ?3, ?4, ?5)
             on conflict(session_id) do update set
               injected_text = excluded.injected_text,
               reasons_json = excluded.reasons_json,
               updated_at = excluded.updated_at,
               updated_at_iso = excluded.updated_at_iso",
            params![session_id, injected, to_json(&reasons)?, pc_now, ms_to_iso(pc_now)],
        )
        .map_err(|error| to_error(format!("failed to persist prompt cache: {error}")))?;
    Ok(())
}

fn refresh_prompt_cache_snapshot(
    storage_root: &str,
    session_id: &str,
    project_root: Option<&str>,
) -> Result<()> {
    let paths = ensure_memory_bootstrap(storage_root)?;
    let connection = open_sqlite(&paths.shared_index_db_path)?;
    ensure_shared_index_schema(&connection)?;
    let entries = select_shared_entries(
        storage_root,
        session_id,
        &resolve_budget(
            &load_memory_config(storage_root)?,
            &AiProviderProfile {
                id: "memory-default".to_string(),
                name: "memory-default".to_string(),
                provider_id: "memory".to_string(),
                protocol_id: "memory".to_string(),
                preset_id: None,
                connection_config: BTreeMap::new(),
                auth_config: BTreeMap::new(),
                configured_secret_fields: Vec::new(),
                headers: BTreeMap::new(),
                model: "memory-default".to_string(),
                custom_models: Vec::new(),
                discovery_state: crate::profile::types::AiModelDiscoveryState {
                    status: "idle".to_string(),
                    last_checked_at: None,
                    error_message: None,
                    models: Vec::new(),
                },
                is_default: false,
                created_at: now_ms(),
                updated_at: now_ms(),
            },
        ),
        project_root,
    )?;
    let mut content = String::from("# Dynamic Prompt Cache\n");
    for entry in entries.iter().take(MAX_PROMPT_CACHE_ENTRIES) {
        content.push_str(&format!(
            "- [{}:{}] {}\n",
            entry.layer,
            entry.scope,
            entry.content.replace('\n', " ")
        ));
    }
    fs::write(&paths.dynamic_prompt_cache_path, content).map_err(|error| {
        to_error(format!(
            "failed to refresh dynamic prompt cache {}: {error}",
            paths.dynamic_prompt_cache_path.display()
        ))
    })?;
    drop(connection);
    Ok(())
}

fn emit_persisted_memory_event(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    phase: &str,
    payload: Value,
) -> Result<()> {
    let event = AgentRuntimeEvent {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        phase: phase.to_string(),
        payload,
        timestamp: now_ms(),
    };
    let stored = registry_db::append_agent_runtime_event(storage_root, &event)?;
    emit_runtime_event(stored);
    Ok(())
}

fn digest_key(value: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hex::encode(hasher.finalize())
}

// --- Public API for agent tools ---

/// Public wrapper around `upsert_shared_entry` for agent tool use.
pub fn upsert_shared_entry_public(
    storage_root: &str,
    layer: &str,
    scope: &str,
    project_root: Option<&str>,
    content: &str,
    source_session_id: Option<&str>,
    source_message_id: Option<&str>,
    accepted: bool,
    score: f64,
) -> Result<()> {
    upsert_shared_entry(
        storage_root,
        layer,
        scope,
        project_root,
        content,
        source_session_id,
        source_message_id,
        accepted,
        score,
    )?;
    Ok(())
}

/// Recall (search) shared memory entries by query text.
/// Uses TF-IDF cosine similarity + keyword matching.
/// Returns up to `limit` entries sorted by relevance.
pub fn recall_shared_entries(
    storage_root: &str,
    query: &str,
    scope_filter: Option<&str>,
    project_root: Option<&str>,
    limit: usize,
) -> Result<Vec<Value>> {
    let paths = ensure_memory_bootstrap(storage_root)?;
    let connection = open_sqlite(&paths.shared_index_db_path)?;
    ensure_shared_index_schema(&connection)?;

    let mut candidates = read_shared_entries(&connection, None, true)?;

    // Apply scope filter
    if let Some(scope) = scope_filter {
        candidates.retain(|e| e.scope == scope);
    }

    // For project scope, also filter by project
    if let Some(pr) = project_root {
        candidates.retain(|e| e.scope != "project" || e.project_root.as_deref() == Some(pr));
    }

    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    // Build query vector for TF-IDF matching
    let query_vec = compute_tfidf_vector(query);
    let query_lower = query.to_lowercase();
    let query_words: Vec<&str> = query_lower.split_whitespace().collect();

    // Score each candidate
    let mut scored: Vec<(f64, &SharedMemoryEntry)> = candidates
        .iter()
        .map(|entry| {
            // TF-IDF similarity (try to get cached embedding from DB)
            let entry_vec = compute_tfidf_vector(&entry.content);
            let tfidf_sim = tfidf_cosine_similarity(&query_vec, &entry_vec);

            // Keyword overlap bonus
            let content_lower = entry.content.to_lowercase();
            let keyword_hits = query_words
                .iter()
                .filter(|w| w.len() >= 2 && content_lower.contains(**w))
                .count();
            let keyword_score = if query_words.is_empty() {
                0.0
            } else {
                keyword_hits as f64 / query_words.len() as f64
            };

            let combined = 0.6 * tfidf_sim + 0.4 * keyword_score;
            (combined, entry)
        })
        .filter(|(score, _)| *score > 0.05)
        .collect();

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    let results: Vec<Value> = scored
        .into_iter()
        .take(limit)
        .map(|(score, entry)| {
            json!({
                "id": entry.id,
                "layer": entry.layer,
                "scope": entry.scope,
                "content": entry.content,
                "score": (score * 1000.0).round() / 1000.0,
                "updatedAt": entry.updated_at,
            })
        })
        .collect();

    Ok(results)
}
