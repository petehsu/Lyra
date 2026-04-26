use anyhow::Context;
use chrono::Utc;
use lyra_app_server_protocol::ThreadItem;
use lyra_app_server_protocol::UserInput;
use lyra_utils_home_dir::find_lyra_home;
use lyra_utils_output_truncation::approx_token_count;
use rusqlite::Connection;
use rusqlite::OptionalExtension;
use rusqlite::params;
use serde_json::json;
use sha2::Digest;
use sha2::Sha256;
use std::cmp::Ordering;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const SHARED_MEMORY_FILE: &str = "shared_memory.md";
const SHARED_AUDIT_FILE: &str = "shared_memory.audit.jsonl";
const FROZEN_MEMORY_FILE: &str = "frozen_memory.md";
const FROZEN_AUDIT_FILE: &str = "frozen_memory.audit.jsonl";
const DYNAMIC_PROMPT_CACHE_FILE: &str = "dynamic_prompt_cache.md";
const SHARED_TRUTH_DB_NAME: &str = "shared_truth.sqlite";
const FROZEN_TRUTH_DB_NAME: &str = "frozen_truth.sqlite";
const CONFLICT_SETS_DB_NAME: &str = "conflict_sets.sqlite";
const TRIGGER_MARKS_DB_NAME: &str = "trigger_marks.sqlite";
const MEMORY_JOBS_DB_NAME: &str = "memory_jobs.sqlite";
const PROMPT_CACHE_DB_NAME: &str = "prompt_cache.sqlite";
const SHARED_INDEX_DB_NAME: &str = "shared_index.sqlite";
const MEMORY_COMPACTION_LOG_FILE: &str = "memory_compaction.log";
const CUTS_MANIFEST_FILE: &str = "cuts.manifest.json";
const CUT_PACK_PREFIX: &str = "cut_pack_";
const CUT_PACK_EXT: &str = ".sqlite";
const CURRENT_SESSION_PROMPT_LIMIT: usize = 12;
const SHARED_SECTION_CHAR_LIMIT: usize = 12_000;
const SESSION_SECTION_CHAR_LIMIT: usize = 12_000;
const DYNAMIC_CACHE_CHAR_LIMIT: usize = 8_000;
const S_RAW_SAMPLE_WINDOW: usize = 30;
const OUTPUT_P95_WINDOW: usize = 30;

const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS: i64 = 200_000;
const DEFAULT_TRIM_OUTPUT_RESERVE_MIN_TOKENS: i64 = 1_200;
const DEFAULT_TRIM_OUTPUT_RESERVE_MAX_TOKENS: i64 = 6_000;
const DEFAULT_TRIM_OUTPUT_RESERVE_PAD_TOKENS: i64 = 800;
const DEFAULT_TRIM_GROWTH_EMA_ALPHA: f64 = 0.35;
const DEFAULT_TRIM_RETRIEVAL_EMA_ALPHA: f64 = 0.20;
const DEFAULT_TRIM_DIRT_WEIGHT_DUP: f64 = 0.35;
const DEFAULT_TRIM_DIRT_WEIGHT_STALE: f64 = 0.25;
const DEFAULT_TRIM_DIRT_WEIGHT_CONFLICT: f64 = 0.20;
const DEFAULT_TRIM_DIRT_WEIGHT_LOW_VALUE: f64 = 0.20;
const DEFAULT_TRIM_TRIGGER_BASE_RATIO: f64 = 0.82;
const DEFAULT_TRIM_TRIGGER_RATIO_MIN: f64 = 0.72;
const DEFAULT_TRIM_TRIGGER_RATIO_MAX: f64 = 0.90;
const DEFAULT_TRIM_TRIGGER_DIRT_COEF: f64 = 0.10;
const DEFAULT_TRIM_TRIGGER_GROWTH_COEF: f64 = 0.08;
const DEFAULT_TRIM_TRIGGER_RETRIEVAL_COEF: f64 = 0.05;
const DEFAULT_TRIM_KEEP_BASE_RATIO: f64 = 0.66;
const DEFAULT_TRIM_KEEP_RATIO_MIN: f64 = 0.50;
const DEFAULT_TRIM_KEEP_RATIO_MAX: f64 = 0.78;
const DEFAULT_TRIM_KEEP_DIRT_COEF: f64 = 0.08;
const DEFAULT_TRIM_KEEP_GROWTH_COEF: f64 = 0.06;
const DEFAULT_TRIM_KEEP_RETRIEVAL_COEF: f64 = 0.10;
const DEFAULT_TRIM_DELTA_MIN_RATIO: f64 = 0.08;
const DEFAULT_TRIM_DELTA_MAX_RATIO: f64 = 0.35;
const DEFAULT_TRIM_HARD_LIMIT_RATIO: f64 = 0.95;
const DEFAULT_TRIM_COOLDOWN_TURNS: i64 = 2;
const DEFAULT_TRIM_HYSTERESIS_MIN_RATIO: f64 = 0.06;
const DEFAULT_HEAD_BASE_RATIO: f64 = 0.16;
const DEFAULT_HEAD_MIN_RATIO: f64 = 0.08;
const DEFAULT_HEAD_MAX_RATIO: f64 = 0.22;
const DEFAULT_HEAD_DECAY_TURNS: f64 = 18.0;
const DEFAULT_PINNED_MAX_RATIO: f64 = 0.30;
const DEFAULT_TAIL_BASE_RATIO: f64 = 0.34;
const DEFAULT_TAIL_MIN_RATIO: f64 = 0.22;
const DEFAULT_TAIL_MAX_RATIO: f64 = 0.45;
const DEFAULT_TAIL_UNRESOLVED_BOOST: f64 = 0.12;
const DEFAULT_CUT_PACK_MAX_BYTES: i64 = 32 * 1024 * 1024;
const DEFAULT_CUT_PACK_ROLL_INTERVAL_MS: i64 = 86_400_000;
const DEFAULT_TOKEN_CHECKPOINT_LOOKBACK_TURNS: i64 = 2;
const DEFAULT_TOKEN_CHECKPOINT_MAX_EVENTS_PER_RUN: i64 = 12;
const DEFAULT_TOKEN_TRIGGER_COOLDOWN_MS: i64 = 2_000;
const DEFAULT_TOKEN_TRIGGER_BATCH_LIMIT: i64 = 48;
const DEFAULT_TOKEN_TRIGGER_MAX_CPU_MS: i64 = 120;
const DEFAULT_SHARED_CLASSIFY_SCORE_THRESHOLD: f64 = 0.72;

#[derive(Debug, Clone, Default)]
pub struct LyraMemoryWriteOutcome {
    pub trimmed: bool,
    pub shared_updated: bool,
    pub frozen_updated: bool,
    pub prompt_cache_updated: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct LyraMemoryPromptContext {
    pub(crate) truth_root_path: String,
    pub(crate) current_session_id: String,
    pub(crate) current_session_sqlite_path: String,
    pub(crate) shared_truth_sqlite_path: String,
    pub(crate) frozen_truth_sqlite_path: String,
    pub(crate) conflict_sets_sqlite_path: String,
    pub(crate) shared_memory_path: String,
    pub(crate) frozen_memory_path: String,
    pub(crate) dynamic_prompt_cache_path: String,
    pub(crate) current_session_excerpt: String,
    pub(crate) shared_memory: String,
    pub(crate) frozen_memory: String,
    pub(crate) dynamic_prompt_cache: String,
}

#[derive(Debug)]
struct SessionDialogPromptEntry {
    msg_id: String,
    turn_index: i64,
    role: String,
    content_raw: String,
    created_at_iso: String,
    created_at_ms: i64,
    token_count: i64,
    item_type: String,
}

#[derive(Debug, Clone)]
struct MemoryControllerConfig {
    model_context_window_tokens: i64,
    trim_output_reserve_min_tokens: i64,
    trim_output_reserve_max_tokens: i64,
    trim_output_reserve_pad_tokens: i64,
    trim_growth_ema_alpha: f64,
    trim_retrieval_ema_alpha: f64,
    trim_dirt_weight_dup: f64,
    trim_dirt_weight_stale: f64,
    trim_dirt_weight_conflict: f64,
    trim_dirt_weight_low_value: f64,
    trim_trigger_base_ratio: f64,
    trim_trigger_ratio_min: f64,
    trim_trigger_ratio_max: f64,
    trim_trigger_dirt_coef: f64,
    trim_trigger_growth_coef: f64,
    trim_trigger_retrieval_coef: f64,
    trim_keep_base_ratio: f64,
    trim_keep_ratio_min: f64,
    trim_keep_ratio_max: f64,
    trim_keep_dirt_coef: f64,
    trim_keep_growth_coef: f64,
    trim_keep_retrieval_coef: f64,
    trim_delta_min_ratio: f64,
    trim_delta_max_ratio: f64,
    trim_hard_limit_ratio: f64,
    trim_cooldown_turns: i64,
    trim_hysteresis_min_ratio: f64,
    head_base_ratio: f64,
    head_min_ratio: f64,
    head_max_ratio: f64,
    head_decay_turns: f64,
    pinned_max_ratio: f64,
    tail_base_ratio: f64,
    tail_min_ratio: f64,
    tail_max_ratio: f64,
    tail_unresolved_boost: f64,
    cut_pack_max_bytes: i64,
    cut_pack_roll_interval_ms: i64,
    token_checkpoint_lookback_turns: i64,
    token_checkpoint_max_events_per_run: i64,
    token_trigger_cooldown_ms: i64,
    token_trigger_batch_limit: i64,
    token_trigger_max_cpu_ms: i64,
    shared_classify_score_threshold: f64,
}

impl Default for MemoryControllerConfig {
    fn default() -> Self {
        Self {
            model_context_window_tokens: DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
            trim_output_reserve_min_tokens: DEFAULT_TRIM_OUTPUT_RESERVE_MIN_TOKENS,
            trim_output_reserve_max_tokens: DEFAULT_TRIM_OUTPUT_RESERVE_MAX_TOKENS,
            trim_output_reserve_pad_tokens: DEFAULT_TRIM_OUTPUT_RESERVE_PAD_TOKENS,
            trim_growth_ema_alpha: DEFAULT_TRIM_GROWTH_EMA_ALPHA,
            trim_retrieval_ema_alpha: DEFAULT_TRIM_RETRIEVAL_EMA_ALPHA,
            trim_dirt_weight_dup: DEFAULT_TRIM_DIRT_WEIGHT_DUP,
            trim_dirt_weight_stale: DEFAULT_TRIM_DIRT_WEIGHT_STALE,
            trim_dirt_weight_conflict: DEFAULT_TRIM_DIRT_WEIGHT_CONFLICT,
            trim_dirt_weight_low_value: DEFAULT_TRIM_DIRT_WEIGHT_LOW_VALUE,
            trim_trigger_base_ratio: DEFAULT_TRIM_TRIGGER_BASE_RATIO,
            trim_trigger_ratio_min: DEFAULT_TRIM_TRIGGER_RATIO_MIN,
            trim_trigger_ratio_max: DEFAULT_TRIM_TRIGGER_RATIO_MAX,
            trim_trigger_dirt_coef: DEFAULT_TRIM_TRIGGER_DIRT_COEF,
            trim_trigger_growth_coef: DEFAULT_TRIM_TRIGGER_GROWTH_COEF,
            trim_trigger_retrieval_coef: DEFAULT_TRIM_TRIGGER_RETRIEVAL_COEF,
            trim_keep_base_ratio: DEFAULT_TRIM_KEEP_BASE_RATIO,
            trim_keep_ratio_min: DEFAULT_TRIM_KEEP_RATIO_MIN,
            trim_keep_ratio_max: DEFAULT_TRIM_KEEP_RATIO_MAX,
            trim_keep_dirt_coef: DEFAULT_TRIM_KEEP_DIRT_COEF,
            trim_keep_growth_coef: DEFAULT_TRIM_KEEP_GROWTH_COEF,
            trim_keep_retrieval_coef: DEFAULT_TRIM_KEEP_RETRIEVAL_COEF,
            trim_delta_min_ratio: DEFAULT_TRIM_DELTA_MIN_RATIO,
            trim_delta_max_ratio: DEFAULT_TRIM_DELTA_MAX_RATIO,
            trim_hard_limit_ratio: DEFAULT_TRIM_HARD_LIMIT_RATIO,
            trim_cooldown_turns: DEFAULT_TRIM_COOLDOWN_TURNS,
            trim_hysteresis_min_ratio: DEFAULT_TRIM_HYSTERESIS_MIN_RATIO,
            head_base_ratio: DEFAULT_HEAD_BASE_RATIO,
            head_min_ratio: DEFAULT_HEAD_MIN_RATIO,
            head_max_ratio: DEFAULT_HEAD_MAX_RATIO,
            head_decay_turns: DEFAULT_HEAD_DECAY_TURNS,
            pinned_max_ratio: DEFAULT_PINNED_MAX_RATIO,
            tail_base_ratio: DEFAULT_TAIL_BASE_RATIO,
            tail_min_ratio: DEFAULT_TAIL_MIN_RATIO,
            tail_max_ratio: DEFAULT_TAIL_MAX_RATIO,
            tail_unresolved_boost: DEFAULT_TAIL_UNRESOLVED_BOOST,
            cut_pack_max_bytes: DEFAULT_CUT_PACK_MAX_BYTES,
            cut_pack_roll_interval_ms: DEFAULT_CUT_PACK_ROLL_INTERVAL_MS,
            token_checkpoint_lookback_turns: DEFAULT_TOKEN_CHECKPOINT_LOOKBACK_TURNS,
            token_checkpoint_max_events_per_run: DEFAULT_TOKEN_CHECKPOINT_MAX_EVENTS_PER_RUN,
            token_trigger_cooldown_ms: DEFAULT_TOKEN_TRIGGER_COOLDOWN_MS,
            token_trigger_batch_limit: DEFAULT_TOKEN_TRIGGER_BATCH_LIMIT,
            token_trigger_max_cpu_ms: DEFAULT_TOKEN_TRIGGER_MAX_CPU_MS,
            shared_classify_score_threshold: DEFAULT_SHARED_CLASSIFY_SCORE_THRESHOLD,
        }
    }
}

#[derive(Debug, Clone)]
struct SessionMessage {
    msg_id: String,
    turn_index: i64,
    role: String,
    content_raw: String,
    token_count: i64,
    created_at_ms: i64,
    created_at_iso: String,
    metadata_json: String,
}

#[derive(Debug, Clone)]
struct TrimDecision {
    should_trim: bool,
    force_trim: bool,
    trim_amount: i64,
    b_budget: i64,
    l_live_tokens: i64,
    t_trigger: i64,
    t_keep: i64,
    u_pressure: f64,
    g_growth: f64,
    d_dirt: f64,
    r_retrieval: f64,
    s_reserved: i64,
    s_raw: i64,
    s_hist: i64,
    output_reserve: i64,
}

pub(crate) fn lyra_truth_root_path(lyra_home: &Path) -> PathBuf {
    lyra_home.join("modules").join("ai")
}

pub async fn persist_thread_item_to_lyra_memory_truth(
    thread_id: &str,
    turn_id: &str,
    item: &ThreadItem,
) -> anyhow::Result<LyraMemoryWriteOutcome> {
    let lyra_home = find_lyra_home().context("resolve Lyra home for Lyra memory truth")?;
    let thread_id = thread_id.to_string();
    let turn_id = turn_id.to_string();
    let item = item.clone();
    let outcome = tokio::task::spawn_blocking(move || {
        persist_thread_item_sync(lyra_home.as_ref(), &thread_id, &turn_id, &item)
    })
    .await
    .context("join Lyra memory truth persistence task")??;
    Ok(outcome)
}

pub(crate) fn initialize_thread_memory_truth(
    lyra_home: &Path,
    thread_id: &str,
) -> anyhow::Result<()> {
    let root = lyra_truth_root_path(lyra_home);
    ensure_lyra_truth_layout(&root)?;

    let session_id = sanitize_session_id(thread_id);
    let session_root = root.join("sessions").join(&session_id);
    ensure_session_layout(&session_root)?;

    let session_db_path = session_root.join("session.sqlite");
    let connection = Connection::open(&session_db_path)?;
    ensure_session_dialog_schema(&connection)?;
    recover_trim_journal(&root, &session_id, &session_db_path, &connection)?;

    write_dynamic_prompt_cache_snapshot(&root, &session_id, &session_db_path)?;
    Ok(())
}

pub(crate) fn load_memory_prompt_context(
    lyra_home: &Path,
    thread_id: &str,
) -> anyhow::Result<Option<LyraMemoryPromptContext>> {
    let root = lyra_truth_root_path(lyra_home);
    ensure_lyra_truth_layout(&root)?;

    let session_id = sanitize_session_id(thread_id);
    let session_root = root.join("sessions").join(&session_id);
    ensure_session_layout(&session_root)?;
    let session_db_path = session_root.join("session.sqlite");

    let shared_root = root.join("shared");
    let shared_memory = truncate_for_prompt(
        &read_text_file(shared_root.join(SHARED_MEMORY_FILE))?,
        SHARED_SECTION_CHAR_LIMIT,
    );
    let frozen_memory = truncate_for_prompt(
        &read_text_file(shared_root.join(FROZEN_MEMORY_FILE))?,
        SHARED_SECTION_CHAR_LIMIT,
    );
    let dynamic_prompt_cache = truncate_for_prompt(
        &read_text_file(shared_root.join(DYNAMIC_PROMPT_CACHE_FILE))?,
        DYNAMIC_CACHE_CHAR_LIMIT,
    );
    let current_session_excerpt = truncate_for_prompt(
        &read_current_session_excerpt(&session_db_path, CURRENT_SESSION_PROMPT_LIMIT)?,
        SESSION_SECTION_CHAR_LIMIT,
    );

    if shared_memory.is_empty()
        && frozen_memory.is_empty()
        && dynamic_prompt_cache.is_empty()
        && current_session_excerpt.is_empty()
    {
        return Ok(None);
    }

    Ok(Some(LyraMemoryPromptContext {
        truth_root_path: root.display().to_string(),
        current_session_id: session_id,
        current_session_sqlite_path: session_db_path.display().to_string(),
        shared_truth_sqlite_path: shared_root.join(SHARED_TRUTH_DB_NAME).display().to_string(),
        frozen_truth_sqlite_path: shared_root.join(FROZEN_TRUTH_DB_NAME).display().to_string(),
        conflict_sets_sqlite_path: shared_root
            .join(CONFLICT_SETS_DB_NAME)
            .display()
            .to_string(),
        shared_memory_path: shared_root.join(SHARED_MEMORY_FILE).display().to_string(),
        frozen_memory_path: shared_root.join(FROZEN_MEMORY_FILE).display().to_string(),
        dynamic_prompt_cache_path: shared_root
            .join(DYNAMIC_PROMPT_CACHE_FILE)
            .display()
            .to_string(),
        current_session_excerpt,
        shared_memory,
        frozen_memory,
        dynamic_prompt_cache,
    }))
}

pub(crate) fn ensure_lyra_truth_layout(root: &Path) -> anyhow::Result<()> {
    let sessions_root = root.join("sessions");
    let shared_root = root.join("shared");
    let runtime_root = root.join("runtime");
    let metrics_root = root.join("metrics");

    fs::create_dir_all(&sessions_root)?;
    fs::create_dir_all(&shared_root)?;
    fs::create_dir_all(&runtime_root)?;
    fs::create_dir_all(&metrics_root)?;

    ensure_text_file(&shared_root.join(SHARED_MEMORY_FILE))?;
    ensure_text_file(&shared_root.join(SHARED_AUDIT_FILE))?;
    ensure_text_file(&shared_root.join(FROZEN_MEMORY_FILE))?;
    ensure_text_file(&shared_root.join(FROZEN_AUDIT_FILE))?;
    ensure_text_file(&shared_root.join(DYNAMIC_PROMPT_CACHE_FILE))?;
    ensure_text_file(&metrics_root.join(MEMORY_COMPACTION_LOG_FILE))?;

    let shared_truth_db = Connection::open(shared_root.join(SHARED_TRUTH_DB_NAME))?;
    ensure_truth_db_schema(&shared_truth_db)?;

    let frozen_truth_db = Connection::open(shared_root.join(FROZEN_TRUTH_DB_NAME))?;
    ensure_truth_db_schema(&frozen_truth_db)?;

    let conflict_sets_db = Connection::open(shared_root.join(CONFLICT_SETS_DB_NAME))?;
    conflict_sets_db.execute_batch(
        r#"
create table if not exists conflict_sets (
    conflict_id text primary key,
    namespace text not null,
    conflict_key text not null,
    candidate_memory_ids text not null,
    decision_status text not null,
    resolution_memory_id text,
    created_at_ms integer not null,
    created_at_iso text not null,
    updated_at_ms integer not null,
    updated_at_iso text not null
);
create index if not exists idx_conflict_sets_status on conflict_sets(decision_status, updated_at_ms desc);
        "#,
    )?;

    let trigger_marks_db = Connection::open(runtime_root.join(TRIGGER_MARKS_DB_NAME))?;
    trigger_marks_db.execute_batch(
        r#"
create table if not exists trigger_marks (
    mark_id text primary key,
    session_id text not null,
    trigger_kind text not null,
    source_ref text not null,
    analysis_result text not null,
    candidate_state text not null default 'candidate',
    score real not null default 0,
    last_analyzed_turn_index integer,
    needs_recheck integer not null,
    created_at_ms integer not null,
    created_at_iso text not null,
    updated_at_ms integer not null,
    updated_at_iso text not null
);
create index if not exists idx_trigger_marks_session_state on trigger_marks(session_id, candidate_state, updated_at_ms desc);
        "#,
    )?;
    ensure_column_if_missing(
        &trigger_marks_db,
        "trigger_marks",
        "candidate_state",
        "text not null default 'candidate'",
    )?;
    ensure_column_if_missing(
        &trigger_marks_db,
        "trigger_marks",
        "score",
        "real not null default 0",
    )?;
    ensure_column_if_missing(
        &trigger_marks_db,
        "trigger_marks",
        "last_analyzed_turn_index",
        "integer",
    )?;

    let memory_jobs_db = Connection::open(runtime_root.join(MEMORY_JOBS_DB_NAME))?;
    memory_jobs_db.execute_batch(
        r#"
create table if not exists memory_jobs (
    job_id text primary key,
    session_id text,
    job_kind text not null,
    status text not null,
    payload_json text not null,
    attempt_count integer not null,
    error_message text,
    created_at_ms integer not null,
    created_at_iso text not null,
    updated_at_ms integer not null,
    updated_at_iso text not null
);
create table if not exists review_candidates (
    candidate_id text primary key,
    session_id text not null,
    source_ref text not null,
    score real not null,
    content_preview text not null,
    metadata_json text not null,
    created_at_ms integer not null,
    created_at_iso text not null
);
        "#,
    )?;

    let prompt_cache_db = Connection::open(runtime_root.join(PROMPT_CACHE_DB_NAME))?;
    prompt_cache_db.execute_batch(
        r#"
create table if not exists prompt_cache (
    cache_key text primary key,
    session_id text not null,
    level text not null,
    snapshot_json text not null,
    updated_at_ms integer not null,
    updated_at_iso text not null
);
        "#,
    )?;

    let shared_index_db = Connection::open(shared_root.join(SHARED_INDEX_DB_NAME))?;
    shared_index_db.execute_batch(
        r#"
create table if not exists shared_entries (
    space text not null,
    entry_key text not null,
    content text not null,
    digest text not null,
    updated_at_ms integer not null,
    updated_at_iso text not null,
    primary key(space, entry_key)
);
        "#,
    )?;

    rebuild_truth_projection(
        &shared_root.join(SHARED_TRUTH_DB_NAME),
        &shared_root.join(SHARED_MEMORY_FILE),
    )?;
    rebuild_truth_projection(
        &shared_root.join(FROZEN_TRUTH_DB_NAME),
        &shared_root.join(FROZEN_MEMORY_FILE),
    )?;

    Ok(())
}

fn persist_thread_item_sync(
    lyra_home: &Path,
    thread_id: &str,
    turn_id: &str,
    item: &ThreadItem,
) -> anyhow::Result<LyraMemoryWriteOutcome> {
    let Some((role, msg_id, content_raw, stream_id)) =
        session_dialog_entry(thread_id, turn_id, item)
    else {
        return Ok(LyraMemoryWriteOutcome::default());
    };

    let root = lyra_truth_root_path(lyra_home);
    ensure_lyra_truth_layout(&root)?;

    let session_id = sanitize_session_id(thread_id);
    let session_root = root.join("sessions").join(&session_id);
    ensure_session_layout(&session_root)?;

    let db_path = session_root.join("session.sqlite");
    let connection = Connection::open(&db_path)?;
    ensure_session_dialog_schema(&connection)?;

    let already_exists: Option<String> = connection
        .query_row(
            "select msg_id from session_dialog where msg_id = ?1 limit 1",
            params![msg_id],
            |row| row.get(0),
        )
        .optional()?;
    if already_exists.is_some() {
        return Ok(LyraMemoryWriteOutcome::default());
    }

    let controller_config = load_memory_controller_config(lyra_home);
    let turn_index = resolve_turn_index(&connection, turn_id)?;
    let now = Utc::now();
    let now_ms = now.timestamp_millis();
    let now_iso = now.to_rfc3339();
    let char_count = i64::try_from(content_raw.chars().count()).unwrap_or(i64::MAX);
    let token_count = i64::try_from(approx_token_count(&content_raw)).unwrap_or(i64::MAX);
    let metadata_json = json!({
        "thread_id": thread_id,
        "turn_id": turn_id,
        "item_type": item_type_name(item),
    })
    .to_string();

    connection.execute(
        r#"
insert into session_dialog (
    msg_id,
    turn_index,
    role,
    content_raw,
    token_count,
    char_count,
    created_at_ms,
    created_at_iso,
    updated_at_ms,
    metadata_json,
    stream_id
) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        "#,
        params![
            msg_id,
            turn_index,
            role,
            content_raw,
            token_count,
            char_count,
            now_ms,
            now_iso,
            now_ms,
            metadata_json,
            stream_id,
        ],
    )?;

    let mut outcome = LyraMemoryWriteOutcome::default();
    let trim_outcome = maybe_run_adaptive_trim(
        &root,
        &session_id,
        &db_path,
        &connection,
        &controller_config,
        turn_index,
        msg_id.as_str(),
    )?;
    if trim_outcome {
        outcome.trimmed = true;
    }

    let promote_outcome =
        process_trigger_candidates(&root, &session_id, turn_index, item, &controller_config)?;
    outcome.shared_updated = promote_outcome.shared_updated;
    outcome.frozen_updated = promote_outcome.frozen_updated;

    write_dynamic_prompt_cache_snapshot(&root, &session_id, &db_path)?;
    outcome.prompt_cache_updated = true;
    Ok(outcome)
}

fn ensure_session_layout(session_root: &Path) -> anyhow::Result<()> {
    fs::create_dir_all(session_root)?;
    fs::create_dir_all(session_root.join("cuts"))?;
    fs::create_dir_all(session_root.join("manifests"))?;
    ensure_file_with_contents(
        &session_root.join("manifests").join(CUTS_MANIFEST_FILE),
        b"{\n  \"version\": 1,\n  \"cuts\": []\n}\n",
    )?;
    Ok(())
}

fn ensure_session_dialog_schema(connection: &Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        r#"
create table if not exists session_dialog (
    msg_id text primary key,
    turn_index integer not null,
    role text not null,
    content_raw text not null,
    token_count integer,
    char_count integer not null,
    created_at_ms integer not null,
    created_at_iso text not null,
    updated_at_ms integer not null,
    metadata_json text not null,
    stream_id text
);
create index if not exists idx_session_dialog_turn on session_dialog(turn_index asc, created_at_ms asc);
create index if not exists idx_session_dialog_created on session_dialog(created_at_ms asc);
create table if not exists session_turn_index (
    turn_id text primary key,
    turn_index integer not null
);
create table if not exists trim_journal (
    trim_batch_id text primary key,
    session_id text not null,
    state text not null,
    live_token_before integer not null,
    live_token_after integer,
    trigger_tokens integer not null,
    keep_tokens integer not null,
    archived_count integer not null,
    deleted_count integer not null,
    source_msg_ids_json text not null,
    removed_msg_ids_json text not null,
    error_message text,
    created_at_ms integer not null,
    created_at_iso text not null,
    updated_at_ms integer not null,
    updated_at_iso text not null
);
create index if not exists idx_trim_journal_state on trim_journal(state, updated_at_ms desc);
create table if not exists trim_signal_samples (
    sample_id text primary key,
    trim_batch_id text,
    turn_index integer not null,
    signal_kind text not null,
    signal_value real not null,
    created_at_ms integer not null,
    created_at_iso text not null
);
create index if not exists idx_trim_signal_kind on trim_signal_samples(signal_kind, created_at_ms desc);
create table if not exists trim_controller_state (
    key text primary key,
    value_real real,
    value_int integer,
    value_text text,
    updated_at_ms integer not null,
    updated_at_iso text not null
);
create table if not exists pinned_items (
    pin_id text primary key,
    pin_kind text not null,
    msg_id text,
    source_ref text,
    value_text text not null,
    status text not null,
    metadata_json text not null,
    created_at_ms integer not null,
    created_at_iso text not null,
    updated_at_ms integer not null,
    updated_at_iso text not null
);
create index if not exists idx_pinned_items_status on pinned_items(status, updated_at_ms desc);
create table if not exists retrieval_ledger (
    ledger_id text primary key,
    turn_index integer not null,
    selected_items integer not null,
    cited_selected_items integer not null,
    created_at_ms integer not null,
    created_at_iso text not null
);
create index if not exists idx_retrieval_ledger_turn on retrieval_ledger(turn_index desc);
        "#,
    )?;
    Ok(())
}

fn resolve_turn_index(connection: &Connection, turn_id: &str) -> anyhow::Result<i64> {
    let existing: Option<i64> = connection
        .query_row(
            "select turn_index from session_turn_index where turn_id = ?1 limit 1",
            params![turn_id],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(index) = existing {
        return Ok(index);
    }

    let next_index: i64 = connection.query_row(
        "select coalesce(max(turn_index), -1) + 1 from session_turn_index",
        [],
        |row| row.get(0),
    )?;
    connection.execute(
        "insert into session_turn_index (turn_id, turn_index) values (?1, ?2)",
        params![turn_id, next_index],
    )?;
    Ok(next_index)
}

fn write_dynamic_prompt_cache_snapshot(
    root: &Path,
    session_id: &str,
    session_db_path: &Path,
) -> anyhow::Result<()> {
    let shared_root = root.join("shared");
    let shared_memory = read_text_file(shared_root.join(SHARED_MEMORY_FILE))?;
    let frozen_memory = read_text_file(shared_root.join(FROZEN_MEMORY_FILE))?;
    let session_excerpt =
        read_current_session_excerpt(session_db_path, CURRENT_SESSION_PROMPT_LIMIT)?;
    let now = Utc::now();
    let now_ms = now.timestamp_millis();
    let now_iso = now.to_rfc3339();

    let snapshot_markdown = format!(
        "# Lyra Dynamic Prompt Cache\n\nGenerated at: {now_iso}\nSession ID: {session_id}\nSession DB: {}\n\n## Shared Memory\n{}\n\n## Frozen Memory\n{}\n\n## Current Session Excerpt\n{}\n",
        session_db_path.display(),
        render_markdown_section(&shared_memory),
        render_markdown_section(&frozen_memory),
        render_markdown_section(&session_excerpt),
    );
    fs::write(
        shared_root.join(DYNAMIC_PROMPT_CACHE_FILE),
        snapshot_markdown,
    )?;

    let runtime_root = root.join("runtime");
    let prompt_cache_db = Connection::open(runtime_root.join(PROMPT_CACHE_DB_NAME))?;
    let snapshot_json = json!({
        "session_id": session_id,
        "session_db_path": session_db_path.display().to_string(),
        "shared_memory": shared_memory,
        "frozen_memory": frozen_memory,
        "current_session_excerpt": session_excerpt,
    })
    .to_string();
    prompt_cache_db.execute(
        r#"
insert into prompt_cache (
    cache_key,
    session_id,
    level,
    snapshot_json,
    updated_at_ms,
    updated_at_iso
) values (?1, ?2, ?3, ?4, ?5, ?6)
on conflict(cache_key) do update set
    session_id = excluded.session_id,
    level = excluded.level,
    snapshot_json = excluded.snapshot_json,
    updated_at_ms = excluded.updated_at_ms,
    updated_at_iso = excluded.updated_at_iso
        "#,
        params![
            format!("session:{session_id}:latest"),
            session_id,
            "session",
            snapshot_json,
            now_ms,
            now_iso,
        ],
    )?;

    Ok(())
}

fn read_current_session_excerpt(session_db_path: &Path, limit: usize) -> anyhow::Result<String> {
    if !session_db_path.exists() {
        return Ok(String::new());
    }

    let connection = Connection::open(session_db_path)?;
    ensure_session_dialog_schema(&connection)?;
    let mut statement = connection.prepare(
        r#"
select msg_id, turn_index, role, content_raw, token_count, created_at_ms, created_at_iso, metadata_json
from session_dialog
order by turn_index desc, created_at_ms desc
limit ?1
        "#,
    )?;
    let rows = statement.query_map(params![i64::try_from(limit).unwrap_or(i64::MAX)], |row| {
        let msg_id: String = row.get(0)?;
        let turn_index: i64 = row.get(1)?;
        let role: String = row.get(2)?;
        let content_raw: String = row.get(3)?;
        let token_count: Option<i64> = row.get(4)?;
        let created_at_ms: i64 = row.get(5)?;
        let created_at_iso: String = row.get(6)?;
        let metadata_json: String = row.get(7)?;
        let item_type = serde_json::from_str::<serde_json::Value>(&metadata_json)
            .ok()
            .and_then(|value| {
                value
                    .get("item_type")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| "unknown".to_string());
        let computed_token_count = token_count
            .unwrap_or_else(|| i64::try_from(approx_token_count(&content_raw)).unwrap_or(i64::MAX));
        Ok(SessionDialogPromptEntry {
            msg_id,
            turn_index,
            role,
            content_raw,
            created_at_ms,
            created_at_iso,
            token_count: computed_token_count,
            item_type,
        })
    })?;

    let mut entries = Vec::new();
    for row in rows {
        entries.push(row?);
    }
    entries.reverse();

    Ok(entries
        .into_iter()
        .map(|entry| {
            format!(
                "### [{}:{}] {}\n{}",
                entry.role,
                entry.item_type,
                entry.created_at_iso,
                entry.content_raw.trim()
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n"))
}

fn read_text_file(path: PathBuf) -> anyhow::Result<String> {
    if !path.exists() {
        return Ok(String::new());
    }
    Ok(fs::read_to_string(path)?.trim().to_string())
}

fn truncate_for_prompt(input: &str, limit: usize) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let total_chars = trimmed.chars().count();
    if total_chars <= limit {
        return trimmed.to_string();
    }

    let head_limit = limit.saturating_mul(2) / 3;
    let tail_limit = limit.saturating_sub(head_limit);
    let head = trimmed.chars().take(head_limit).collect::<String>();
    let tail = trimmed
        .chars()
        .skip(total_chars.saturating_sub(tail_limit))
        .collect::<String>();
    format!(
        "{head}\n\n[... truncated {} chars from Lyra memory truth ...]\n\n{tail}",
        total_chars.saturating_sub(limit)
    )
}

fn render_markdown_section(text: &str) -> String {
    if text.trim().is_empty() {
        "_empty_".to_string()
    } else {
        text.trim().to_string()
    }
}

fn ensure_text_file(path: &Path) -> anyhow::Result<()> {
    ensure_file_with_contents(path, b"")
}

fn ensure_file_with_contents(path: &Path, contents: &[u8]) -> anyhow::Result<()> {
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, contents)?;
    Ok(())
}

fn ensure_truth_db_schema(connection: &Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        r#"
create table if not exists memory_entries (
    memory_id text primary key,
    namespace text not null,
    kind text not null,
    value text not null,
    evidence_refs text not null,
    confidence real not null,
    stability real not null,
    status text not null,
    revision integer not null,
    supersedes text,
    created_at_ms integer not null,
    created_at_iso text not null,
    updated_at_ms integer not null,
    updated_at_iso text not null
);
create index if not exists idx_memory_entries_namespace_kind_status on memory_entries(namespace, kind, status, updated_at_ms desc);
create table if not exists memory_updates (
    update_id text primary key,
    memory_id text not null,
    update_mode text not null,
    old_value_digest text,
    new_value_digest text not null,
    update_reason text not null,
    evidence_source text not null,
    confidence real not null,
    created_at_ms integer not null,
    created_at_iso text not null
);
create index if not exists idx_memory_updates_memory on memory_updates(memory_id, created_at_ms desc);
        "#,
    )?;
    Ok(())
}

fn ensure_column_if_missing(
    connection: &Connection,
    table: &str,
    column: &str,
    column_spec: &str,
) -> anyhow::Result<()> {
    let pragma = format!("pragma table_info({table})");
    let mut statement = connection.prepare(&pragma)?;
    let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
    for result in columns {
        if result?.eq_ignore_ascii_case(column) {
            return Ok(());
        }
    }
    let sql = format!("alter table {table} add column {column} {column_spec}");
    connection.execute_batch(&sql)?;
    Ok(())
}

fn rebuild_truth_projection(truth_db_path: &Path, projection_path: &Path) -> anyhow::Result<()> {
    if !truth_db_path.exists() {
        ensure_file_with_contents(projection_path, b"")?;
        return Ok(());
    }
    let connection = Connection::open(truth_db_path)?;
    ensure_truth_db_schema(&connection)?;
    let mut statement = connection.prepare(
        r#"
select memory_id, namespace, kind, value, confidence, stability, status, revision, updated_at_iso
from memory_entries
where status in ('active', 'deprecated', 'conflict_candidate')
order by namespace asc, kind asc, updated_at_ms desc
        "#,
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, f64>(4)?,
            row.get::<_, f64>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, i64>(7)?,
            row.get::<_, String>(8)?,
        ))
    })?;

    let mut sections = Vec::new();
    for row in rows {
        let (
            memory_id,
            namespace,
            kind,
            value,
            confidence,
            stability,
            status,
            revision,
            updated_at_iso,
        ) = row?;
        sections.push(format!(
            "### {namespace}/{kind}\n- memory_id: `{memory_id}`\n- status: `{status}`\n- revision: `{revision}`\n- confidence: `{confidence:.3}`\n- stability: `{stability:.3}`\n- updated_at: `{updated_at_iso}`\n\n{value}"
        ));
    }
    let content = if sections.is_empty() {
        "# Memory Projection\n\n_empty_\n".to_string()
    } else {
        format!("# Memory Projection\n\n{}\n", sections.join("\n\n"))
    };
    fs::write(projection_path, content)?;
    Ok(())
}

fn load_memory_controller_config(lyra_home: &Path) -> MemoryControllerConfig {
    let mut config = MemoryControllerConfig::default();
    let config_path = lyra_home.join("config.toml");
    let raw = match fs::read_to_string(&config_path) {
        Ok(raw) => raw,
        Err(_) => return config,
    };
    let value: toml::Value = match toml::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return config,
    };
    let memories = match value.get("memories").and_then(toml::Value::as_table) {
        Some(table) => table,
        None => return config,
    };

    let read_i64 = |key: &str| -> Option<i64> {
        memories.get(key).and_then(|value| match value {
            toml::Value::Integer(v) => Some(*v),
            toml::Value::Float(v) => Some(*v as i64),
            _ => None,
        })
    };
    let read_f64 = |key: &str| -> Option<f64> {
        memories.get(key).and_then(|value| match value {
            toml::Value::Integer(v) => Some(*v as f64),
            toml::Value::Float(v) => Some(*v),
            _ => None,
        })
    };

    if let Some(v) = read_i64("model_context_window_tokens") {
        config.model_context_window_tokens = v.max(1);
    }
    if let Some(v) = read_i64("trim_output_reserve_min_tokens") {
        config.trim_output_reserve_min_tokens = v.max(0);
    }
    if let Some(v) = read_i64("trim_output_reserve_max_tokens") {
        config.trim_output_reserve_max_tokens = v.max(config.trim_output_reserve_min_tokens);
    }
    if let Some(v) = read_i64("trim_output_reserve_pad_tokens") {
        config.trim_output_reserve_pad_tokens = v.max(0);
    }
    if let Some(v) = read_f64("trim_growth_ema_alpha") {
        config.trim_growth_ema_alpha = clamp01(v);
    }
    if let Some(v) = read_f64("trim_retrieval_ema_alpha") {
        config.trim_retrieval_ema_alpha = clamp01(v);
    }
    if let Some(v) = read_f64("trim_dirt_weight_dup") {
        config.trim_dirt_weight_dup = clamp01(v);
    }
    if let Some(v) = read_f64("trim_dirt_weight_stale") {
        config.trim_dirt_weight_stale = clamp01(v);
    }
    if let Some(v) = read_f64("trim_dirt_weight_conflict") {
        config.trim_dirt_weight_conflict = clamp01(v);
    }
    if let Some(v) = read_f64("trim_dirt_weight_low_value") {
        config.trim_dirt_weight_low_value = clamp01(v);
    }
    if let Some(v) = read_f64("trim_trigger_base_ratio") {
        config.trim_trigger_base_ratio = clamp01(v);
    }
    if let Some(v) = read_f64("trim_trigger_ratio_min") {
        config.trim_trigger_ratio_min = clamp01(v);
    }
    if let Some(v) = read_f64("trim_trigger_ratio_max") {
        config.trim_trigger_ratio_max = clamp01(v).max(config.trim_trigger_ratio_min);
    }
    if let Some(v) = read_f64("trim_trigger_dirt_coef") {
        config.trim_trigger_dirt_coef = clamp01(v);
    }
    if let Some(v) = read_f64("trim_trigger_growth_coef") {
        config.trim_trigger_growth_coef = clamp01(v);
    }
    if let Some(v) = read_f64("trim_trigger_retrieval_coef") {
        config.trim_trigger_retrieval_coef = clamp01(v);
    }
    if let Some(v) = read_f64("trim_keep_base_ratio") {
        config.trim_keep_base_ratio = clamp01(v);
    }
    if let Some(v) = read_f64("trim_keep_ratio_min") {
        config.trim_keep_ratio_min = clamp01(v);
    }
    if let Some(v) = read_f64("trim_keep_ratio_max") {
        config.trim_keep_ratio_max = clamp01(v).max(config.trim_keep_ratio_min);
    }
    if let Some(v) = read_f64("trim_keep_dirt_coef") {
        config.trim_keep_dirt_coef = clamp01(v);
    }
    if let Some(v) = read_f64("trim_keep_growth_coef") {
        config.trim_keep_growth_coef = clamp01(v);
    }
    if let Some(v) = read_f64("trim_keep_retrieval_coef") {
        config.trim_keep_retrieval_coef = clamp01(v);
    }
    if let Some(v) = read_f64("trim_delta_min_ratio") {
        config.trim_delta_min_ratio = clamp01(v);
    }
    if let Some(v) = read_f64("trim_delta_max_ratio") {
        config.trim_delta_max_ratio = clamp01(v).max(config.trim_delta_min_ratio);
    }
    if let Some(v) = read_f64("trim_hard_limit_ratio") {
        config.trim_hard_limit_ratio = clamp01(v).max(0.1);
    }
    if let Some(v) = read_i64("trim_cooldown_turns") {
        config.trim_cooldown_turns = v.max(0);
    }
    if let Some(v) = read_f64("trim_hysteresis_min_ratio") {
        config.trim_hysteresis_min_ratio = clamp01(v);
    }
    if let Some(v) = read_f64("head_base_ratio") {
        config.head_base_ratio = clamp01(v);
    }
    if let Some(v) = read_f64("head_min_ratio") {
        config.head_min_ratio = clamp01(v);
    }
    if let Some(v) = read_f64("head_max_ratio") {
        config.head_max_ratio = clamp01(v).max(config.head_min_ratio);
    }
    if let Some(v) = read_f64("head_decay_turns") {
        config.head_decay_turns = v.max(1.0);
    }
    if let Some(v) = read_f64("pinned_max_ratio") {
        config.pinned_max_ratio = clamp01(v);
    }
    if let Some(v) = read_f64("tail_base_ratio") {
        config.tail_base_ratio = clamp01(v);
    }
    if let Some(v) = read_f64("tail_min_ratio") {
        config.tail_min_ratio = clamp01(v);
    }
    if let Some(v) = read_f64("tail_max_ratio") {
        config.tail_max_ratio = clamp01(v).max(config.tail_min_ratio);
    }
    if let Some(v) = read_f64("tail_unresolved_boost") {
        config.tail_unresolved_boost = clamp01(v);
    }
    if let Some(v) = read_i64("cut_pack_max_bytes") {
        config.cut_pack_max_bytes = v.max(1024 * 1024);
    }
    if let Some(v) = read_i64("cut_pack_roll_interval_ms") {
        config.cut_pack_roll_interval_ms = v.max(60_000);
    }
    if let Some(v) = read_i64("token_checkpoint_lookback_turns") {
        config.token_checkpoint_lookback_turns = v.max(1);
    }
    if let Some(v) = read_i64("token_checkpoint_max_events_per_run") {
        config.token_checkpoint_max_events_per_run = v.max(1);
    }
    if let Some(v) = read_i64("token_trigger_cooldown_ms") {
        config.token_trigger_cooldown_ms = v.max(0);
    }
    if let Some(v) = read_i64("token_trigger_batch_limit") {
        config.token_trigger_batch_limit = v.max(1);
    }
    if let Some(v) = read_i64("token_trigger_max_cpu_ms") {
        config.token_trigger_max_cpu_ms = v.max(1);
    }
    if let Some(v) = read_f64("shared_classify_score_threshold") {
        config.shared_classify_score_threshold = clamp01(v);
    }

    config
}

fn maybe_run_adaptive_trim(
    root: &Path,
    session_id: &str,
    session_db_path: &Path,
    connection: &Connection,
    config: &MemoryControllerConfig,
    current_turn_index: i64,
    current_msg_id: &str,
) -> anyhow::Result<bool> {
    let messages = load_session_messages(connection)?;
    if messages.len() <= 4 {
        return Ok(false);
    }

    let l_live_tokens = messages
        .iter()
        .map(|message| message.token_count.max(0))
        .sum::<i64>();
    if l_live_tokens <= 0 {
        return Ok(false);
    }

    let output_reserve = compute_output_reserve(connection, config)?;
    let s_raw = compute_s_raw_reserved(root, session_id, session_db_path)?;
    let now = Utc::now();
    let now_ms = now.timestamp_millis();
    let now_iso = now.to_rfc3339();
    connection.execute(
        r#"
insert into trim_signal_samples (
    sample_id, trim_batch_id, turn_index, signal_kind, signal_value, created_at_ms, created_at_iso
) values (?1, null, ?2, ?3, ?4, ?5, ?6)
        "#,
        params![
            format!("sample-{}", Uuid::new_v4()),
            current_turn_index,
            "s_raw",
            s_raw as f64,
            now_ms,
            now_iso,
        ],
    )?;
    let s_hist = compute_recent_p95_signal(connection, "s_raw", S_RAW_SAMPLE_WINDOW)?;
    let s_reserved = s_raw.max(if s_hist > 0 { s_hist } else { s_raw });
    let b_budget = (config.model_context_window_tokens - output_reserve - s_reserved).max(0);
    if b_budget <= 0 {
        return Ok(false);
    }

    let g_growth = compute_growth_signal(connection, l_live_tokens, config.trim_growth_ema_alpha)?;
    let d_dirt = compute_dirt_signal(root, session_id, connection, &messages, config)?;
    let r_retrieval = compute_retrieval_signal(connection, config.trim_retrieval_ema_alpha)?;

    let decision = compute_trim_decision(
        config,
        b_budget,
        l_live_tokens,
        g_growth,
        d_dirt,
        r_retrieval,
        s_reserved,
        s_raw,
        s_hist,
        output_reserve,
        current_turn_index,
        connection,
    )?;
    if !decision.should_trim {
        upsert_controller_state_i64(
            connection,
            "prev_live_tokens",
            l_live_tokens,
            now_ms,
            now_iso.as_str(),
        )?;
        return Ok(false);
    }

    let keep_ids =
        select_keep_msg_ids(connection, &messages, &decision, config, current_turn_index)?;
    let keep_set: HashSet<String> = keep_ids.into_iter().collect();
    let mut removed = Vec::new();
    for message in messages.iter() {
        if !keep_set.contains(&message.msg_id) {
            removed.push(message.clone());
        }
    }
    if removed.is_empty() {
        upsert_controller_state_i64(
            connection,
            "prev_live_tokens",
            l_live_tokens,
            now_ms,
            now_iso.as_str(),
        )?;
        return Ok(false);
    }

    let trim_batch_id = format!("trim_{}_{}", now_ms, Uuid::new_v4().simple());
    run_trim_pipeline(
        root,
        session_id,
        session_db_path,
        connection,
        config,
        &trim_batch_id,
        &removed,
        &decision,
        current_turn_index,
        current_msg_id,
        now_ms,
        now_iso.as_str(),
    )?;
    Ok(true)
}

fn run_trim_pipeline(
    root: &Path,
    session_id: &str,
    _session_db_path: &Path,
    connection: &Connection,
    config: &MemoryControllerConfig,
    trim_batch_id: &str,
    removed: &[SessionMessage],
    decision: &TrimDecision,
    current_turn_index: i64,
    current_msg_id: &str,
    now_ms: i64,
    now_iso: &str,
) -> anyhow::Result<()> {
    let source_msg_ids: Vec<String> = removed
        .iter()
        .map(|message| message.msg_id.clone())
        .collect();
    let source_json = serde_json::to_string(&source_msg_ids)?;

    connection.execute(
        r#"
insert or replace into trim_journal (
    trim_batch_id, session_id, state, live_token_before, live_token_after, trigger_tokens, keep_tokens,
    archived_count, deleted_count, source_msg_ids_json, removed_msg_ids_json,
    error_message, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
) values (?1, ?2, 'pending_trim', ?3, null, ?4, ?5, 0, 0, ?6, '[]', null, ?7, ?8, ?9, ?10)
        "#,
        params![
            trim_batch_id,
            session_id,
            decision.l_live_tokens,
            decision.t_trigger,
            decision.t_keep,
            source_json,
            now_ms,
            now_iso,
            now_ms,
            now_iso,
        ],
    )?;

    let archive_result = archive_removed_messages(
        root,
        session_id,
        trim_batch_id,
        removed,
        config,
        now_ms,
        now_iso,
    )?;
    let removed_json = serde_json::to_string(&source_msg_ids)?;
    connection.execute(
        r#"
update trim_journal
set state = 'archived',
    archived_count = ?2,
    removed_msg_ids_json = ?3,
    updated_at_ms = ?4,
    updated_at_iso = ?5
where trim_batch_id = ?1
        "#,
        params![
            trim_batch_id,
            archive_result.archived_count,
            removed_json,
            now_ms,
            now_iso,
        ],
    )?;

    let mut deleted = 0_i64;
    for message in removed {
        deleted += connection.execute(
            "delete from session_dialog where msg_id = ?1",
            params![message.msg_id],
        )? as i64;
    }
    let live_after_tokens: i64 = connection.query_row(
        "select coalesce(sum(coalesce(token_count, 0)), 0) from session_dialog",
        [],
        |row| row.get(0),
    )?;
    connection.execute(
        r#"
update trim_journal
set state = 'live_deleted',
    deleted_count = ?2,
    live_token_after = ?3,
    updated_at_ms = ?4,
    updated_at_iso = ?5
where trim_batch_id = ?1
        "#,
        params![trim_batch_id, deleted, live_after_tokens, now_ms, now_iso,],
    )?;

    write_cut_manifest_mapping(
        root,
        session_id,
        trim_batch_id,
        archive_result.pack_id.as_str(),
        now_ms,
        now_iso,
    )?;
    connection.execute(
        r#"
update trim_journal
set state = 'manifest_committed',
    updated_at_ms = ?2,
    updated_at_iso = ?3
where trim_batch_id = ?1
        "#,
        params![trim_batch_id, now_ms, now_iso],
    )?;

    connection.execute(
        r#"
insert into trim_signal_samples (
    sample_id, trim_batch_id, turn_index, signal_kind, signal_value, created_at_ms, created_at_iso
) values (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        "#,
        params![
            format!("sample-{}", Uuid::new_v4()),
            trim_batch_id,
            current_turn_index,
            "dup_ratio",
            archive_result.dup_ratio,
            now_ms,
            now_iso,
        ],
    )?;

    upsert_controller_state_i64(
        connection,
        "last_trim_turn_index",
        current_turn_index,
        now_ms,
        now_iso,
    )?;
    upsert_controller_state_i64(
        connection,
        "prev_live_tokens",
        live_after_tokens,
        now_ms,
        now_iso,
    )?;
    upsert_controller_state_i64(connection, "last_trim_at_ms", now_ms, now_ms, now_iso)?;

    maybe_run_token_checkpoint(
        root,
        session_id,
        connection,
        config,
        current_turn_index,
        current_msg_id,
        now_ms,
        now_iso,
    )?;

    Ok(())
}

#[derive(Debug, Clone)]
struct ArchiveResult {
    pack_id: String,
    archived_count: i64,
    dedupe_ref_count: i64,
    dup_ratio: f64,
}

fn archive_removed_messages(
    root: &Path,
    session_id: &str,
    trim_batch_id: &str,
    removed: &[SessionMessage],
    config: &MemoryControllerConfig,
    now_ms: i64,
    now_iso: &str,
) -> anyhow::Result<ArchiveResult> {
    let cuts_root = root.join("sessions").join(session_id).join("cuts");
    fs::create_dir_all(&cuts_root)?;
    let (pack_id, pack_path) = resolve_active_cut_pack(&cuts_root, config, now_ms)?;
    let connection = Connection::open(&pack_path)?;
    ensure_cut_pack_schema(&connection)?;

    let mut archived_count = 0_i64;
    let mut dedupe_ref_count = 0_i64;
    for message in removed {
        let content_kind = classify_content_kind(message.content_raw.as_str());
        let normalized = normalize_content(message.content_raw.as_str(), content_kind.as_str());
        let raw_digest = sha256_hex(message.content_raw.as_bytes());
        let normalized_digest = sha256_hex(normalized.as_bytes());

        if let Some(existing_archive_id) =
            find_exact_archive_id(&cuts_root, raw_digest.as_str(), normalized_digest.as_str())?
        {
            let dedupe_ref_id = format!("dref_{}", Uuid::new_v4());
            connection.execute(
                r#"
insert into cut_refs (
    dedupe_ref_id, source_archive_id, target_archive_id, dedupe_reason,
    similarity_score, similarity_features, decision_mode, created_at_ms, created_at_iso
) values (?1, ?2, ?3, 'exact_hash', 1.0, ?4, 'auto_ref', ?5, ?6)
                "#,
                params![
                    dedupe_ref_id,
                    format!("source:{}", message.msg_id),
                    existing_archive_id,
                    "{}",
                    now_ms,
                    now_iso,
                ],
            )?;
            dedupe_ref_count += 1;
            continue;
        }

        let near_match = find_near_duplicate_candidate(
            &connection,
            content_kind.as_str(),
            normalized.as_str(),
            message.token_count,
        )?;
        let normalized_token_count =
            i64::try_from(approx_token_count(normalized.as_str())).unwrap_or(i64::MAX);
        let normalized_char_count = i64::try_from(normalized.chars().count()).unwrap_or(i64::MAX);
        let archive_id = format!("arc_{}", Uuid::new_v4());
        connection.execute(
            r#"
insert into cut_payload (
    archive_id, source_session_id, source_msg_start_id, source_msg_end_id, role,
    content_raw, content_normalized, content_kind,
    token_count_raw, char_count_raw, token_count_normalized, char_count_normalized,
    raw_digest, normalized_digest, trim_batch_id, created_at_ms, created_at_iso
) values (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
            "#,
            params![
                archive_id,
                session_id,
                message.msg_id,
                message.role,
                message.content_raw,
                normalized,
                content_kind,
                message.token_count,
                i64::try_from(message.content_raw.chars().count()).unwrap_or(i64::MAX),
                normalized_token_count,
                normalized_char_count,
                raw_digest,
                normalized_digest,
                trim_batch_id,
                now_ms,
                now_iso,
            ],
        )?;
        archived_count += 1;

        if let Some((target_archive_id, similarity_score, similarity_features)) = near_match {
            let dedupe_ref_id = format!("dref_{}", Uuid::new_v4());
            connection.execute(
                r#"
insert into cut_refs (
    dedupe_ref_id, source_archive_id, target_archive_id, dedupe_reason,
    similarity_score, similarity_features, decision_mode, created_at_ms, created_at_iso
) values (?1, ?2, ?3, 'near_duplicate', ?4, ?5, 'candidate_only', ?6, ?7)
                "#,
                params![
                    dedupe_ref_id,
                    archive_id,
                    target_archive_id,
                    similarity_score,
                    similarity_features,
                    now_ms,
                    now_iso,
                ],
            )?;
            dedupe_ref_count += 1;
        }
    }

    connection.execute(
        r#"
insert or replace into cut_meta (
    trim_batch_id, pack_id, omitted_span_summary, archived_count, dedupe_ref_count,
    created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        "#,
        params![
            trim_batch_id,
            pack_id,
            "[]",
            archived_count,
            dedupe_ref_count,
            now_ms,
            now_iso,
            now_ms,
            now_iso,
        ],
    )?;
    connection.execute(
        r#"
insert or replace into cut_shard_map (
    trim_batch_id, pack_id, created_at_ms, created_at_iso
) values (?1, ?2, ?3, ?4)
        "#,
        params![trim_batch_id, pack_id, now_ms, now_iso],
    )?;

    let total = archived_count + dedupe_ref_count;
    let dup_ratio = if total <= 0 {
        0.0
    } else {
        dedupe_ref_count as f64 / total as f64
    };
    Ok(ArchiveResult {
        pack_id,
        archived_count,
        dedupe_ref_count,
        dup_ratio,
    })
}

fn ensure_cut_pack_schema(connection: &Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        r#"
create table if not exists cut_payload (
    archive_id text primary key,
    source_session_id text not null,
    source_msg_start_id text not null,
    source_msg_end_id text not null,
    role text not null,
    content_raw text not null,
    content_normalized text not null,
    content_kind text not null,
    token_count_raw integer not null,
    char_count_raw integer not null,
    token_count_normalized integer not null,
    char_count_normalized integer not null,
    raw_digest text not null,
    normalized_digest text not null,
    trim_batch_id text not null,
    created_at_ms integer not null,
    created_at_iso text not null
);
create index if not exists idx_cut_payload_raw_digest on cut_payload(raw_digest);
create index if not exists idx_cut_payload_norm_digest on cut_payload(normalized_digest);
create table if not exists cut_refs (
    dedupe_ref_id text primary key,
    source_archive_id text not null,
    target_archive_id text not null,
    dedupe_reason text not null,
    similarity_score real,
    similarity_features text,
    decision_mode text not null,
    created_at_ms integer not null,
    created_at_iso text not null
);
create table if not exists cut_meta (
    trim_batch_id text primary key,
    pack_id text not null,
    omitted_span_summary text not null,
    archived_count integer not null,
    dedupe_ref_count integer not null,
    created_at_ms integer not null,
    created_at_iso text not null,
    updated_at_ms integer not null,
    updated_at_iso text not null
);
create table if not exists cut_shard_map (
    trim_batch_id text primary key,
    pack_id text not null,
    created_at_ms integer not null,
    created_at_iso text not null
);
        "#,
    )?;
    Ok(())
}

fn write_cut_manifest_mapping(
    root: &Path,
    session_id: &str,
    trim_batch_id: &str,
    pack_id: &str,
    now_ms: i64,
    now_iso: &str,
) -> anyhow::Result<()> {
    let manifest_path = root
        .join("sessions")
        .join(session_id)
        .join("manifests")
        .join(CUTS_MANIFEST_FILE);
    let mut value: serde_json::Value = if manifest_path.exists() {
        serde_json::from_str(&fs::read_to_string(&manifest_path)?).unwrap_or_else(|_| {
            json!({
                "version": 2,
                "active_pack_id": pack_id,
                "cuts": []
            })
        })
    } else {
        json!({
            "version": 2,
            "active_pack_id": pack_id,
            "cuts": []
        })
    };
    value["version"] = json!(2);
    value["active_pack_id"] = json!(pack_id);
    if !value.get("cuts").is_some_and(serde_json::Value::is_array) {
        value["cuts"] = json!([]);
    }
    if let Some(array) = value
        .get_mut("cuts")
        .and_then(serde_json::Value::as_array_mut)
    {
        let already_exists = array.iter().any(|entry| {
            entry
                .get("trim_batch_id")
                .and_then(serde_json::Value::as_str)
                == Some(trim_batch_id)
        });
        if !already_exists {
            array.push(json!({
                "trim_batch_id": trim_batch_id,
                "pack_id": pack_id,
                "created_at_ms": now_ms,
                "created_at_iso": now_iso,
            }));
        }
    }
    fs::write(manifest_path, serde_json::to_string_pretty(&value)?)?;
    Ok(())
}

fn resolve_active_cut_pack(
    cuts_root: &Path,
    config: &MemoryControllerConfig,
    now_ms: i64,
) -> anyhow::Result<(String, PathBuf)> {
    let mut pack_ids: Vec<String> = fs::read_dir(cuts_root)?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(CUT_PACK_PREFIX) && name.ends_with(CUT_PACK_EXT) {
                Some(name.trim_end_matches(CUT_PACK_EXT).to_string())
            } else {
                None
            }
        })
        .collect();
    pack_ids.sort();
    if let Some(last_pack) = pack_ids.last() {
        let path = cuts_root.join(format!("{last_pack}{CUT_PACK_EXT}"));
        let metadata = fs::metadata(&path).ok();
        let size = metadata
            .as_ref()
            .map(|m| i64::try_from(m.len()).unwrap_or(i64::MAX))
            .unwrap_or(0);
        let modified_ms = metadata
            .and_then(|m| m.modified().ok())
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
            .unwrap_or(now_ms);
        let expired = now_ms.saturating_sub(modified_ms) >= config.cut_pack_roll_interval_ms;
        if size < config.cut_pack_max_bytes && !expired {
            return Ok((last_pack.clone(), path));
        }
    }
    let next_num = pack_ids
        .last()
        .and_then(|pack| pack.rsplit('_').next())
        .and_then(|tail| tail.parse::<u32>().ok())
        .unwrap_or(0)
        + 1;
    let pack_id = format!("{CUT_PACK_PREFIX}{next_num:04}");
    let path = cuts_root.join(format!("{pack_id}{CUT_PACK_EXT}"));
    Ok((pack_id, path))
}

fn find_exact_archive_id(
    cuts_root: &Path,
    raw_digest: &str,
    normalized_digest: &str,
) -> anyhow::Result<Option<String>> {
    if !cuts_root.exists() {
        return Ok(None);
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(cuts_root)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(CUT_PACK_PREFIX) && name.ends_with(CUT_PACK_EXT) {
            entries.push(path);
        }
    }
    entries.sort();
    entries.reverse();
    for path in entries {
        let connection = Connection::open(path)?;
        ensure_cut_pack_schema(&connection)?;
        let archive_id: Option<String> = connection
            .query_row(
                r#"
select archive_id
from cut_payload
where raw_digest = ?1 or normalized_digest = ?2
order by created_at_ms desc
limit 1
                "#,
                params![raw_digest, normalized_digest],
                |row| row.get(0),
            )
            .optional()?;
        if archive_id.is_some() {
            return Ok(archive_id);
        }
    }
    Ok(None)
}

fn find_near_duplicate_candidate(
    connection: &Connection,
    content_kind: &str,
    normalized: &str,
    token_count: i64,
) -> anyhow::Result<Option<(String, f64, String)>> {
    let mut statement = connection.prepare(
        r#"
select archive_id, content_normalized, token_count_normalized
from cut_payload
where content_kind = ?1
order by created_at_ms desc
limit 32
        "#,
    )?;
    let rows = statement.query_map(params![content_kind], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })?;
    let current_tokens = tokenize_for_overlap(normalized);
    if current_tokens.is_empty() {
        return Ok(None);
    }
    let mut best: Option<(String, f64, String)> = None;
    for row in rows {
        let (archive_id, candidate_text, candidate_tokens_count) = row?;
        let token_delta = (candidate_tokens_count - token_count).abs();
        if token_delta > 64 {
            continue;
        }
        let candidate_tokens = tokenize_for_overlap(candidate_text.as_str());
        if candidate_tokens.is_empty() {
            continue;
        }
        let intersection = current_tokens.intersection(&candidate_tokens).count() as f64;
        let union = current_tokens.union(&candidate_tokens).count() as f64;
        if union <= 0.0 {
            continue;
        }
        let jaccard = intersection / union;
        let threshold = if content_kind == "prose" || content_kind == "mixed" {
            0.86
        } else {
            0.93
        };
        if jaccard < threshold {
            continue;
        }
        let features = json!({
            "jaccard": jaccard,
            "token_delta": token_delta,
        })
        .to_string();
        match &best {
            Some((_, score, _)) if *score >= jaccard => {}
            _ => {
                best = Some((archive_id, jaccard, features));
            }
        }
    }
    Ok(best)
}

fn compute_trim_decision(
    config: &MemoryControllerConfig,
    b_budget: i64,
    l_live_tokens: i64,
    g_growth: f64,
    d_dirt: f64,
    r_retrieval: f64,
    s_reserved: i64,
    s_raw: i64,
    s_hist: i64,
    output_reserve: i64,
    current_turn_index: i64,
    connection: &Connection,
) -> anyhow::Result<TrimDecision> {
    let b = b_budget.max(1) as f64;
    let l = l_live_tokens.max(0) as f64;
    let u_pressure = (l / b).clamp(0.0, 10.0);
    let rho_trigger = (config.trim_trigger_base_ratio
        - config.trim_trigger_dirt_coef * d_dirt
        - config.trim_trigger_growth_coef * g_growth
        + config.trim_trigger_retrieval_coef * r_retrieval)
        .clamp(config.trim_trigger_ratio_min, config.trim_trigger_ratio_max);
    let t_trigger = (rho_trigger * b).round() as i64;

    let rho_keep = (config.trim_keep_base_ratio + config.trim_keep_retrieval_coef * r_retrieval
        - config.trim_keep_dirt_coef * d_dirt
        - config.trim_keep_growth_coef * g_growth)
        .clamp(config.trim_keep_ratio_min, config.trim_keep_ratio_max);
    let t_keep = (rho_keep * b).round() as i64;
    let raw_trim = (l_live_tokens - t_keep).max(0);
    let trim_min = (config.trim_delta_min_ratio * b).round() as i64;
    let trim_max = (config.trim_delta_max_ratio * b).round() as i64;
    let trim_amount = raw_trim.clamp(trim_min.max(0), trim_max.max(trim_min.max(0)));

    let last_trim_turn =
        read_controller_state_i64(connection, "last_trim_turn_index")?.unwrap_or(-1);
    let turns_since_last_trim = current_turn_index.saturating_sub(last_trim_turn);
    let enter_trim =
        l_live_tokens >= t_trigger && turns_since_last_trim >= config.trim_cooldown_turns;
    let force_trim = l_live_tokens >= (config.trim_hard_limit_ratio * b).round() as i64;
    let hysteresis = (t_trigger - t_keep) >= (config.trim_hysteresis_min_ratio * b).round() as i64;
    let should_trim = force_trim || (enter_trim && hysteresis && trim_amount > 0);

    Ok(TrimDecision {
        should_trim,
        force_trim,
        trim_amount,
        b_budget: b_budget.max(0),
        l_live_tokens,
        t_trigger,
        t_keep,
        u_pressure,
        g_growth,
        d_dirt,
        r_retrieval,
        s_reserved,
        s_raw,
        s_hist,
        output_reserve,
    })
}

fn compute_output_reserve(
    connection: &Connection,
    config: &MemoryControllerConfig,
) -> anyhow::Result<i64> {
    let mut statement = connection.prepare(
        r#"
select coalesce(token_count, 0)
from session_dialog
where role = 'assistant'
order by created_at_ms desc
limit ?1
        "#,
    )?;
    let rows = statement.query_map(
        params![i64::try_from(OUTPUT_P95_WINDOW).unwrap_or(i64::MAX)],
        |row| row.get::<_, i64>(0),
    )?;
    let mut values = Vec::new();
    for row in rows {
        values.push(row?.max(0));
    }
    let p95 = percentile_i64(&values, 0.95).unwrap_or(config.trim_output_reserve_min_tokens);
    Ok((p95 + config.trim_output_reserve_pad_tokens).clamp(
        config.trim_output_reserve_min_tokens,
        config.trim_output_reserve_max_tokens,
    ))
}

fn compute_s_raw_reserved(
    root: &Path,
    session_id: &str,
    session_db_path: &Path,
) -> anyhow::Result<i64> {
    let shared_root = root.join("shared");
    let shared = read_text_file(shared_root.join(SHARED_MEMORY_FILE))?;
    let frozen = read_text_file(shared_root.join(FROZEN_MEMORY_FILE))?;
    let dynamic = read_text_file(shared_root.join(DYNAMIC_PROMPT_CACHE_FILE))?;
    let excerpt = read_current_session_excerpt(session_db_path, CURRENT_SESSION_PROMPT_LIMIT)?;
    let mut reserved = 512_i64;
    reserved += i64::try_from(approx_token_count(&shared)).unwrap_or(i64::MAX);
    reserved += i64::try_from(approx_token_count(&frozen)).unwrap_or(i64::MAX);
    reserved += i64::try_from(approx_token_count(&dynamic)).unwrap_or(i64::MAX) / 2;
    reserved += i64::try_from(approx_token_count(&excerpt)).unwrap_or(i64::MAX) / 4;

    // Dynamic S excludes session live window and uses runtime blocks + shared/frozen injections.
    let session_salt = i64::try_from(approx_token_count(session_id)).unwrap_or(0);
    Ok((reserved + session_salt / 8).max(0))
}

fn compute_recent_p95_signal(
    connection: &Connection,
    signal_kind: &str,
    limit: usize,
) -> anyhow::Result<i64> {
    let mut statement = connection.prepare(
        r#"
select signal_value
from trim_signal_samples
where signal_kind = ?1
order by created_at_ms desc
limit ?2
        "#,
    )?;
    let rows = statement.query_map(
        params![signal_kind, i64::try_from(limit).unwrap_or(i64::MAX)],
        |row| row.get::<_, f64>(0),
    )?;
    let mut values = Vec::new();
    for row in rows {
        values.push(row?);
    }
    if values.len() < 5 {
        return Ok(0);
    }
    values.sort_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal));
    let index = ((values.len() - 1) as f64 * 0.95).round() as usize;
    Ok(values[index].round() as i64)
}

fn compute_growth_signal(
    connection: &Connection,
    live_tokens: i64,
    alpha: f64,
) -> anyhow::Result<f64> {
    let prev_live =
        read_controller_state_i64(connection, "prev_live_tokens")?.unwrap_or(live_tokens);
    let delta = (live_tokens - prev_live).max(0) as f64;
    let prev_ema =
        read_controller_state_f64(connection, "ema_delta_tokens_per_turn")?.unwrap_or(delta);
    let ema = alpha * delta + (1.0 - alpha) * prev_ema;
    let now = Utc::now();
    upsert_controller_state_f64(
        connection,
        "ema_delta_tokens_per_turn",
        ema,
        now.timestamp_millis(),
        now.to_rfc3339().as_str(),
    )?;
    let budget = live_tokens.max(1) as f64;
    Ok((ema / budget).clamp(0.0, 1.0))
}

fn compute_dirt_signal(
    root: &Path,
    session_id: &str,
    connection: &Connection,
    messages: &[SessionMessage],
    config: &MemoryControllerConfig,
) -> anyhow::Result<f64> {
    let stale_ratio = compute_stale_ratio(connection, messages)?;
    let low_value_ratio = compute_low_value_ratio(messages);
    let conflict_ratio = compute_conflict_ratio(root, session_id)?;
    let dup_ratio = read_recent_dup_ratio(connection)?;
    Ok((config.trim_dirt_weight_dup * dup_ratio
        + config.trim_dirt_weight_stale * stale_ratio
        + config.trim_dirt_weight_conflict * conflict_ratio
        + config.trim_dirt_weight_low_value * low_value_ratio)
        .clamp(0.0, 1.0))
}

fn compute_stale_ratio(
    connection: &Connection,
    messages: &[SessionMessage],
) -> anyhow::Result<f64> {
    if messages.is_empty() {
        return Ok(0.0);
    }
    let max_turn = messages.iter().map(|m| m.turn_index).max().unwrap_or(0);
    let stale_threshold = max_turn.saturating_sub(8);
    let pinned_ids = load_active_pinned_msg_ids(connection)?;
    let stale = messages
        .iter()
        .filter(|message| {
            message.turn_index <= stale_threshold && !pinned_ids.contains(&message.msg_id)
        })
        .count();
    Ok(stale as f64 / messages.len() as f64)
}

fn compute_low_value_ratio(messages: &[SessionMessage]) -> f64 {
    if messages.is_empty() {
        return 0.0;
    }
    let low = messages
        .iter()
        .filter(|message| {
            (message.role == "tool" || message.role == "system") && message.token_count < 24
        })
        .count();
    low as f64 / messages.len() as f64
}

fn compute_conflict_ratio(root: &Path, _session_id: &str) -> anyhow::Result<f64> {
    let db_path = root.join("shared").join(CONFLICT_SETS_DB_NAME);
    if !db_path.exists() {
        return Ok(0.0);
    }
    let connection = Connection::open(db_path)?;
    let open_count: i64 = connection.query_row(
        "select count(*) from conflict_sets where decision_status = 'open'",
        [],
        |row| row.get(0),
    )?;
    Ok((open_count as f64 / 32.0).clamp(0.0, 1.0))
}

fn read_recent_dup_ratio(connection: &Connection) -> anyhow::Result<f64> {
    let mut statement = connection.prepare(
        r#"
select signal_value
from trim_signal_samples
where signal_kind = 'dup_ratio'
order by created_at_ms desc
limit 8
        "#,
    )?;
    let rows = statement.query_map([], |row| row.get::<_, f64>(0))?;
    let mut values = Vec::new();
    for row in rows {
        values.push(row?.clamp(0.0, 1.0));
    }
    if values.is_empty() {
        return Ok(0.0);
    }
    let avg = values.iter().sum::<f64>() / values.len() as f64;
    Ok(avg.clamp(0.0, 1.0))
}

fn compute_retrieval_signal(connection: &Connection, alpha: f64) -> anyhow::Result<f64> {
    let (selected, cited): (i64, i64) = connection.query_row(
        r#"
select coalesce(sum(selected_items), 0), coalesce(sum(cited_selected_items), 0)
from (
    select selected_items, cited_selected_items
    from retrieval_ledger
    order by turn_index desc
    limit 24
)
        "#,
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let ratio = if selected <= 0 {
        0.0
    } else {
        (cited as f64 / selected as f64).clamp(0.0, 1.0)
    };
    let prev_ema =
        read_controller_state_f64(connection, "ema_retrieval_hit_ratio")?.unwrap_or(ratio);
    let ema = alpha * ratio + (1.0 - alpha) * prev_ema;
    let now = Utc::now();
    upsert_controller_state_f64(
        connection,
        "ema_retrieval_hit_ratio",
        ema,
        now.timestamp_millis(),
        now.to_rfc3339().as_str(),
    )?;
    Ok(ema.clamp(0.0, 1.0))
}

fn select_keep_msg_ids(
    connection: &Connection,
    messages: &[SessionMessage],
    decision: &TrimDecision,
    config: &MemoryControllerConfig,
    current_turn_index: i64,
) -> anyhow::Result<Vec<String>> {
    let b = decision.b_budget.max(1) as f64;
    let keep_target = (decision.l_live_tokens - decision.trim_amount).max(0);
    let pinned_ids = load_active_pinned_msg_ids(connection)?;
    let unresolved_count = count_unresolved_commitments(connection)?;
    let unresolved_ratio = if pinned_ids.is_empty() {
        0.0
    } else {
        (unresolved_count as f64 / pinned_ids.len() as f64).clamp(0.0, 1.0)
    };

    let pinned_messages: Vec<&SessionMessage> = messages
        .iter()
        .filter(|message| pinned_ids.contains(&message.msg_id))
        .collect();
    let pinned_tokens = pinned_messages
        .iter()
        .map(|message| message.token_count.max(0))
        .sum::<i64>();
    let p_budget = (config.pinned_max_ratio * b).round() as i64;
    let p_alloc = pinned_tokens.min(p_budget).max(0);

    let decay = (-(current_turn_index as f64) / config.head_decay_turns).exp();
    let h_alloc = ((config.head_base_ratio * b * decay)
        .clamp(config.head_min_ratio * b, config.head_max_ratio * b))
    .round() as i64;
    let t_alloc = ((config.tail_base_ratio + config.tail_unresolved_boost * unresolved_ratio) * b)
        .clamp(config.tail_min_ratio * b, config.tail_max_ratio * b)
        .round() as i64;
    let m_alloc = (keep_target - (p_alloc + h_alloc + t_alloc)).max(0);

    let mut selected = HashSet::new();
    let mut tokens_used = 0_i64;

    for message in messages {
        if tokens_used >= h_alloc {
            break;
        }
        selected.insert(message.msg_id.clone());
        tokens_used += message.token_count.max(0);
    }

    tokens_used = 0;
    for message in messages.iter().rev() {
        if tokens_used >= t_alloc {
            break;
        }
        selected.insert(message.msg_id.clone());
        tokens_used += message.token_count.max(0);
    }

    tokens_used = 0;
    for message in pinned_messages {
        if tokens_used >= p_alloc {
            break;
        }
        selected.insert(message.msg_id.clone());
        tokens_used += message.token_count.max(0);
    }

    let mut candidates: Vec<&SessionMessage> = messages
        .iter()
        .filter(|message| !selected.contains(&message.msg_id))
        .collect();
    candidates.sort_by(|left, right| {
        let left_score = salience_score(connection, left);
        let right_score = salience_score(connection, right);
        right_score
            .partial_cmp(&left_score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| right.turn_index.cmp(&left.turn_index))
    });
    tokens_used = 0;
    for message in candidates {
        if tokens_used >= m_alloc {
            break;
        }
        selected.insert(message.msg_id.clone());
        tokens_used += message.token_count.max(0);
    }

    Ok(selected.into_iter().collect())
}

fn salience_score(connection: &Connection, message: &SessionMessage) -> f64 {
    let mut score = 0.0;
    if message.role == "user" {
        score += 1.2;
    } else if message.role == "assistant" {
        score += 0.9;
    } else {
        score += 0.4;
    }
    let lower = message.content_raw.to_lowercase();
    if lower.contains("must") || lower.contains("required") || lower.contains("constraint") {
        score += 1.4;
    }
    if lower.contains("todo") || lower.contains("fixme") || lower.contains("next step") {
        score += 1.1;
    }
    if lower.contains("failed") || lower.contains("error") {
        score += 0.8;
    }
    if message.role == "tool" && message.token_count > 160 {
        score -= 0.5;
    }
    if let Ok(pinned_ids) = load_active_pinned_msg_ids(connection) {
        if pinned_ids.contains(&message.msg_id) {
            score += 3.0;
        }
    }
    score
}

fn load_session_messages(connection: &Connection) -> anyhow::Result<Vec<SessionMessage>> {
    let mut statement = connection.prepare(
        r#"
select msg_id, turn_index, role, content_raw, coalesce(token_count, 0), created_at_ms, created_at_iso, metadata_json
from session_dialog
order by turn_index asc, created_at_ms asc
        "#,
    )?;
    let rows = statement.query_map([], |row| {
        Ok(SessionMessage {
            msg_id: row.get(0)?,
            turn_index: row.get(1)?,
            role: row.get(2)?,
            content_raw: row.get(3)?,
            token_count: row.get(4)?,
            created_at_ms: row.get(5)?,
            created_at_iso: row.get(6)?,
            metadata_json: row.get(7)?,
        })
    })?;
    let mut messages = Vec::new();
    for row in rows {
        let mut message = row?;
        if message.token_count <= 0 {
            message.token_count =
                i64::try_from(approx_token_count(&message.content_raw)).unwrap_or(i64::MAX);
        }
        messages.push(message);
    }
    Ok(messages)
}

fn load_active_pinned_msg_ids(connection: &Connection) -> anyhow::Result<HashSet<String>> {
    let mut statement = connection.prepare(
        r#"
select msg_id
from pinned_items
where status = 'active' and msg_id is not null
        "#,
    )?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    let mut set = HashSet::new();
    for row in rows {
        set.insert(row?);
    }
    Ok(set)
}

fn count_unresolved_commitments(connection: &Connection) -> anyhow::Result<usize> {
    let count: i64 = connection.query_row(
        "select count(*) from pinned_items where pin_kind = 'unresolved_commitments' and status = 'active'",
        [],
        |row| row.get(0),
    )?;
    Ok(usize::try_from(count.max(0)).unwrap_or(usize::MAX))
}

fn percentile_i64(values: &[i64], percentile: f64) -> Option<i64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let index = ((sorted.len() - 1) as f64 * percentile.clamp(0.0, 1.0)).round() as usize;
    sorted.get(index).copied()
}

fn process_trigger_candidates(
    root: &Path,
    session_id: &str,
    current_turn_index: i64,
    item: &ThreadItem,
    config: &MemoryControllerConfig,
) -> anyhow::Result<LyraMemoryWriteOutcome> {
    let mut outcome = LyraMemoryWriteOutcome::default();
    let runtime_db = Connection::open(root.join("runtime").join(TRIGGER_MARKS_DB_NAME))?;
    let now = Utc::now();
    let now_ms = now.timestamp_millis();
    let now_iso = now.to_rfc3339();
    let mark_id = format!("mark_{}", Uuid::new_v4());
    let source_ref = format!("{session_id}:{current_turn_index}:{}", item_type_name(item));
    runtime_db.execute(
        r#"
insert or replace into trigger_marks (
    mark_id, session_id, trigger_kind, source_ref, analysis_result, candidate_state,
    score, last_analyzed_turn_index, needs_recheck, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
) values (?1, ?2, ?3, ?4, 'pending', 'candidate', 0.0, null, 0, ?5, ?6, ?7, ?8)
        "#,
        params![
            mark_id,
            session_id,
            item_type_name(item),
            source_ref,
            now_ms,
            now_iso,
            now_ms,
            now_iso,
        ],
    )?;

    let last_checkpoint_ms =
        read_controller_state_i64_from_runtime(&runtime_db, "token_checkpoint_last_ms")?
            .unwrap_or(0);
    if now_ms.saturating_sub(last_checkpoint_ms) < config.token_trigger_cooldown_ms {
        return Ok(outcome);
    }

    let session_db = Connection::open(
        root.join("sessions")
            .join(session_id)
            .join("session.sqlite"),
    )?;
    ensure_session_dialog_schema(&session_db)?;
    let shared_db_path = root.join("shared").join(SHARED_TRUTH_DB_NAME);
    let frozen_db_path = root.join("shared").join(FROZEN_TRUTH_DB_NAME);
    let conflict_db_path = root.join("shared").join(CONFLICT_SETS_DB_NAME);
    let shared_db = Connection::open(&shared_db_path)?;
    ensure_truth_db_schema(&shared_db)?;
    let frozen_db = Connection::open(&frozen_db_path)?;
    ensure_truth_db_schema(&frozen_db)?;
    let conflict_db = Connection::open(&conflict_db_path)?;

    let lookback_start = current_turn_index.saturating_sub(config.token_checkpoint_lookback_turns);
    let mut statement = runtime_db.prepare(
        r#"
select mark_id, source_ref
from trigger_marks
where session_id = ?1
  and candidate_state = 'candidate'
order by created_at_ms asc
limit ?2
        "#,
    )?;
    let rows = statement.query_map(
        params![
            session_id,
            config
                .token_checkpoint_max_events_per_run
                .min(config.token_trigger_batch_limit)
        ],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    )?;

    for row in rows {
        let (candidate_id, source_ref) = row?;
        let turn_index =
            parse_turn_index_from_source_ref(source_ref.as_str()).unwrap_or(current_turn_index);
        if turn_index < lookback_start {
            runtime_db.execute(
                "update trigger_marks set candidate_state='expired', analysis_result='lookback_expired', updated_at_ms=?2, updated_at_iso=?3 where mark_id=?1",
                params![candidate_id, now_ms, now_iso],
            )?;
            continue;
        }
        let message = fetch_session_message_by_turn_index(&session_db, turn_index)?;
        let Some(message) = message else {
            runtime_db.execute(
                "update trigger_marks set candidate_state='rejected', analysis_result='missing_source', updated_at_ms=?2, updated_at_iso=?3 where mark_id=?1",
                params![candidate_id, now_ms, now_iso],
            )?;
            continue;
        };
        let classification = classify_shared_candidate(&message);
        if classification.score < config.shared_classify_score_threshold {
            runtime_db.execute(
                "update trigger_marks set candidate_state='rejected', score=?2, analysis_result='below_threshold', last_analyzed_turn_index=?3, updated_at_ms=?4, updated_at_iso=?5 where mark_id=?1",
                params![candidate_id, classification.score, message.turn_index, now_ms, now_iso],
            )?;
            continue;
        }

        if classification.target_space == "frozen" {
            promote_memory_entry(
                &frozen_db,
                &conflict_db,
                "frozen",
                &classification.namespace,
                &classification.kind,
                &classification.value,
                classification.score,
                now_ms,
                now_iso.as_str(),
                root,
            )?;
            outcome.frozen_updated = true;
        } else {
            promote_memory_entry(
                &shared_db,
                &conflict_db,
                "shared",
                &classification.namespace,
                &classification.kind,
                &classification.value,
                classification.score,
                now_ms,
                now_iso.as_str(),
                root,
            )?;
            outcome.shared_updated = true;
        }

        runtime_db.execute(
            "update trigger_marks set candidate_state='promoted', score=?2, analysis_result='promoted', last_analyzed_turn_index=?3, updated_at_ms=?4, updated_at_iso=?5 where mark_id=?1",
            params![candidate_id, classification.score, message.turn_index, now_ms, now_iso],
        )?;
    }

    if outcome.shared_updated {
        rebuild_truth_projection(
            &shared_db_path,
            &root.join("shared").join(SHARED_MEMORY_FILE),
        )?;
    }
    if outcome.frozen_updated {
        rebuild_truth_projection(
            &frozen_db_path,
            &root.join("shared").join(FROZEN_MEMORY_FILE),
        )?;
    }

    if outcome.shared_updated || outcome.frozen_updated {
        append_truth_audit(
            root,
            if outcome.frozen_updated {
                "frozen"
            } else {
                "shared"
            },
            now_ms,
            now_iso.as_str(),
        )?;
    }

    upsert_controller_state_i64_from_runtime(
        &runtime_db,
        "token_checkpoint_last_ms",
        now_ms,
        now_ms,
        now_iso.as_str(),
    )?;

    Ok(outcome)
}

#[derive(Debug, Clone)]
struct SharedCandidateClassification {
    target_space: String,
    namespace: String,
    kind: String,
    value: String,
    score: f64,
}

fn classify_shared_candidate(message: &SessionMessage) -> SharedCandidateClassification {
    let lower = message.content_raw.to_lowercase();
    let mut result = SharedCandidateClassification {
        target_space: "shared".to_string(),
        namespace: "conversation".to_string(),
        kind: "fact".to_string(),
        value: message.content_raw.trim().to_string(),
        score: 0.0,
    };
    if lower.contains("my name is") || lower.contains("i am ") {
        result.target_space = "frozen".to_string();
        result.namespace = "user_profile".to_string();
        result.kind = "name".to_string();
        result.score = 0.92;
        result.value = extract_after_keyword(message.content_raw.as_str(), &["my name is", "i am"])
            .unwrap_or_else(|| message.content_raw.trim().to_string());
        return result;
    }
    if lower.contains("i prefer") || lower.contains("please always") || lower.contains("i usually")
    {
        result.namespace = "user_preference".to_string();
        result.kind = "preference".to_string();
        result.score = 0.81;
        return result;
    }
    if lower.contains("must") || lower.contains("constraint") || lower.contains("do not") {
        result.namespace = "project_constraint".to_string();
        result.kind = "constraint".to_string();
        result.score = 0.78;
        return result;
    }
    result.score = if message.role == "user" { 0.64 } else { 0.52 };
    result
}

fn promote_memory_entry(
    truth_db: &Connection,
    conflict_db: &Connection,
    target_space: &str,
    namespace: &str,
    kind: &str,
    value: &str,
    confidence: f64,
    now_ms: i64,
    now_iso: &str,
    root: &Path,
) -> anyhow::Result<()> {
    ensure_truth_db_schema(truth_db)?;
    let existing: Option<(String, String, i64, String)> = truth_db
        .query_row(
            r#"
select memory_id, value, revision, status
from memory_entries
where namespace = ?1 and kind = ?2 and status in ('active', 'conflict_candidate')
order by updated_at_ms desc
limit 1
            "#,
            params![namespace, kind],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;

    match existing {
        Some((memory_id, existing_value, revision, existing_status))
            if existing_value == value && existing_status == "active" =>
        {
            truth_db.execute(
                r#"
update memory_entries
set confidence = ?2,
    stability = min(1.0, stability + 0.02),
    revision = ?3,
    updated_at_ms = ?4,
    updated_at_iso = ?5
where memory_id = ?1
                "#,
                params![memory_id, confidence, revision + 1, now_ms, now_iso],
            )?;
            write_truth_update(
                truth_db,
                &memory_id,
                "merge",
                &existing_value,
                value,
                "stability_evidence",
                target_space,
                confidence,
                now_ms,
                now_iso,
            )?;
        }
        Some((existing_memory_id, existing_value, _revision, _status))
            if existing_value != value =>
        {
            let candidate_memory_id = format!("mem_{}", Uuid::new_v4());
            truth_db.execute(
                r#"
insert into memory_entries (
    memory_id, namespace, kind, value, evidence_refs, confidence, stability, status, revision,
    supersedes, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
) values (?1, ?2, ?3, ?4, ?5, ?6, 0.5, 'conflict_candidate', 1, ?7, ?8, ?9, ?10, ?11)
                "#,
                params![
                    candidate_memory_id,
                    namespace,
                    kind,
                    value,
                    "[]",
                    confidence,
                    existing_memory_id,
                    now_ms,
                    now_iso,
                    now_ms,
                    now_iso,
                ],
            )?;
            write_truth_update(
                truth_db,
                &candidate_memory_id,
                "replace",
                &existing_value,
                value,
                "conflict_candidate",
                target_space,
                confidence,
                now_ms,
                now_iso,
            )?;
            upsert_conflict_set(
                conflict_db,
                namespace,
                format!("{namespace}/{kind}").as_str(),
                &[existing_memory_id.as_str(), candidate_memory_id.as_str()],
                now_ms,
                now_iso,
            )?;
        }
        _ => {
            let memory_id = format!("mem_{}", Uuid::new_v4());
            truth_db.execute(
                r#"
insert into memory_entries (
    memory_id, namespace, kind, value, evidence_refs, confidence, stability, status, revision,
    supersedes, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
) values (?1, ?2, ?3, ?4, ?5, ?6, 0.6, 'active', 1, null, ?7, ?8, ?9, ?10)
                "#,
                params![
                    memory_id, namespace, kind, value, "[]", confidence, now_ms, now_iso, now_ms,
                    now_iso,
                ],
            )?;
            write_truth_update(
                truth_db,
                &memory_id,
                "replace",
                "",
                value,
                "promoted_candidate",
                target_space,
                confidence,
                now_ms,
                now_iso,
            )?;
        }
    }

    // Rebuild projection in-place when conflict states change.
    let projection_path = if target_space == "frozen" {
        root.join("shared").join(FROZEN_MEMORY_FILE)
    } else {
        root.join("shared").join(SHARED_MEMORY_FILE)
    };
    let db_path = if target_space == "frozen" {
        root.join("shared").join(FROZEN_TRUTH_DB_NAME)
    } else {
        root.join("shared").join(SHARED_TRUTH_DB_NAME)
    };
    rebuild_truth_projection(&db_path, &projection_path)?;

    Ok(())
}

fn write_truth_update(
    truth_db: &Connection,
    memory_id: &str,
    update_mode: &str,
    old_value: &str,
    new_value: &str,
    update_reason: &str,
    evidence_source: &str,
    confidence: f64,
    now_ms: i64,
    now_iso: &str,
) -> anyhow::Result<()> {
    let old_digest = if old_value.trim().is_empty() {
        None
    } else {
        Some(sha256_hex(old_value.as_bytes()))
    };
    let new_digest = sha256_hex(new_value.as_bytes());
    truth_db.execute(
        r#"
insert into memory_updates (
    update_id, memory_id, update_mode, old_value_digest, new_value_digest, update_reason,
    evidence_source, confidence, created_at_ms, created_at_iso
) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        "#,
        params![
            format!("upd_{}", Uuid::new_v4()),
            memory_id,
            update_mode,
            old_digest,
            new_digest,
            update_reason,
            evidence_source,
            confidence,
            now_ms,
            now_iso,
        ],
    )?;
    Ok(())
}

fn upsert_conflict_set(
    conflict_db: &Connection,
    namespace: &str,
    conflict_key: &str,
    candidate_memory_ids: &[&str],
    now_ms: i64,
    now_iso: &str,
) -> anyhow::Result<()> {
    let existing: Option<(String, String)> = conflict_db
        .query_row(
            r#"
select conflict_id, candidate_memory_ids
from conflict_sets
where namespace = ?1 and conflict_key = ?2 and decision_status = 'open'
order by updated_at_ms desc
limit 1
            "#,
            params![namespace, conflict_key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    match existing {
        Some((conflict_id, existing_ids_json)) => {
            let mut ids: Vec<String> = serde_json::from_str(&existing_ids_json).unwrap_or_default();
            for candidate_id in candidate_memory_ids {
                if !ids.iter().any(|existing_id| existing_id == candidate_id) {
                    ids.push((*candidate_id).to_string());
                }
            }
            conflict_db.execute(
                r#"
update conflict_sets
set candidate_memory_ids = ?2,
    updated_at_ms = ?3,
    updated_at_iso = ?4
where conflict_id = ?1
                "#,
                params![conflict_id, serde_json::to_string(&ids)?, now_ms, now_iso],
            )?;
        }
        None => {
            conflict_db.execute(
                r#"
insert into conflict_sets (
    conflict_id, namespace, conflict_key, candidate_memory_ids, decision_status,
    resolution_memory_id, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
) values (?1, ?2, ?3, ?4, 'open', null, ?5, ?6, ?7, ?8)
                "#,
                params![
                    format!("conf_{}", Uuid::new_v4()),
                    namespace,
                    conflict_key,
                    serde_json::to_string(candidate_memory_ids)?,
                    now_ms,
                    now_iso,
                    now_ms,
                    now_iso,
                ],
            )?;
        }
    }
    Ok(())
}

fn append_truth_audit(
    root: &Path,
    target_space: &str,
    now_ms: i64,
    now_iso: &str,
) -> anyhow::Result<()> {
    let file = if target_space == "frozen" {
        root.join("shared").join(FROZEN_AUDIT_FILE)
    } else {
        root.join("shared").join(SHARED_AUDIT_FILE)
    };
    let line = json!({
        "update_id": format!("audit_{}", Uuid::new_v4()),
        "target_space": target_space,
        "update_reason": "auto_promotion",
        "created_at_ms": now_ms,
        "created_at_iso": now_iso,
    })
    .to_string();
    let mut existing = fs::read_to_string(&file).unwrap_or_default();
    if !existing.is_empty() && !existing.ends_with('\n') {
        existing.push('\n');
    }
    existing.push_str(&line);
    existing.push('\n');
    fs::write(file, existing)?;
    Ok(())
}

fn maybe_run_token_checkpoint(
    root: &Path,
    session_id: &str,
    connection: &Connection,
    config: &MemoryControllerConfig,
    current_turn_index: i64,
    current_msg_id: &str,
    now_ms: i64,
    now_iso: &str,
) -> anyhow::Result<()> {
    let last_checkpoint_turn =
        read_controller_state_i64(connection, "token_checkpoint_last_turn")?.unwrap_or(-1);
    let delta_turns = current_turn_index.saturating_sub(last_checkpoint_turn);
    if delta_turns < config.token_checkpoint_lookback_turns {
        return Ok(());
    }
    let selected_items = 4_i64;
    let cited_items = 0_i64;
    connection.execute(
        r#"
insert into retrieval_ledger (
    ledger_id, turn_index, selected_items, cited_selected_items, created_at_ms, created_at_iso
) values (?1, ?2, ?3, ?4, ?5, ?6)
        "#,
        params![
            format!("ledger_{}_{}", current_turn_index, current_msg_id),
            current_turn_index,
            selected_items,
            cited_items,
            now_ms,
            now_iso,
        ],
    )?;
    upsert_controller_state_i64(
        connection,
        "token_checkpoint_last_turn",
        current_turn_index,
        now_ms,
        now_iso,
    )?;

    let runtime_db = Connection::open(root.join("runtime").join(TRIGGER_MARKS_DB_NAME))?;
    upsert_controller_state_i64_from_runtime(
        &runtime_db,
        format!("{session_id}:token_checkpoint_last_turn").as_str(),
        current_turn_index,
        now_ms,
        now_iso,
    )?;

    Ok(())
}

fn recover_trim_journal(
    root: &Path,
    session_id: &str,
    _session_db_path: &Path,
    connection: &Connection,
) -> anyhow::Result<()> {
    let mut statement = connection.prepare(
        r#"
select trim_batch_id, state, removed_msg_ids_json, updated_at_ms, updated_at_iso
from trim_journal
where state in ('pending_trim', 'archived', 'live_deleted')
order by updated_at_ms asc
        "#,
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, String>(4)?,
        ))
    })?;

    for row in rows {
        let (trim_batch_id, state, removed_msg_ids_json, updated_at_ms, updated_at_iso) = row?;
        match state.as_str() {
            "pending_trim" => {
                connection.execute(
                    r#"
update trim_journal
set state = 'failed_recoverable',
    error_message = 'recovery_marked_from_pending_trim',
    updated_at_ms = ?2,
    updated_at_iso = ?3
where trim_batch_id = ?1
                    "#,
                    params![trim_batch_id, updated_at_ms, updated_at_iso],
                )?;
            }
            "archived" => {
                let ids: Vec<String> =
                    serde_json::from_str(&removed_msg_ids_json).unwrap_or_default();
                let mut deleted = 0_i64;
                for msg_id in ids {
                    deleted += connection.execute(
                        "delete from session_dialog where msg_id = ?1",
                        params![msg_id],
                    )? as i64;
                }
                connection.execute(
                    r#"
update trim_journal
set state = 'live_deleted',
    deleted_count = coalesce(deleted_count, 0) + ?2,
    updated_at_ms = ?3,
    updated_at_iso = ?4
where trim_batch_id = ?1
                    "#,
                    params![trim_batch_id, deleted, updated_at_ms, updated_at_iso],
                )?;
                write_cut_manifest_mapping(
                    root,
                    session_id,
                    trim_batch_id.as_str(),
                    "recovered",
                    updated_at_ms,
                    updated_at_iso.as_str(),
                )?;
                connection.execute(
                    "update trim_journal set state='manifest_committed', updated_at_ms=?2, updated_at_iso=?3 where trim_batch_id=?1",
                    params![trim_batch_id, updated_at_ms, updated_at_iso],
                )?;
            }
            "live_deleted" => {
                write_cut_manifest_mapping(
                    root,
                    session_id,
                    trim_batch_id.as_str(),
                    "recovered",
                    updated_at_ms,
                    updated_at_iso.as_str(),
                )?;
                connection.execute(
                    "update trim_journal set state='manifest_committed', updated_at_ms=?2, updated_at_iso=?3 where trim_batch_id=?1",
                    params![trim_batch_id, updated_at_ms, updated_at_iso],
                )?;
            }
            _ => {}
        }
    }
    Ok(())
}

fn fetch_session_message_by_turn_index(
    connection: &Connection,
    turn_index: i64,
) -> anyhow::Result<Option<SessionMessage>> {
    connection
        .query_row(
            r#"
select msg_id, turn_index, role, content_raw, coalesce(token_count, 0), created_at_ms, created_at_iso, metadata_json
from session_dialog
where turn_index = ?1
order by created_at_ms desc
limit 1
            "#,
            params![turn_index],
            |row| {
                Ok(SessionMessage {
                    msg_id: row.get(0)?,
                    turn_index: row.get(1)?,
                    role: row.get(2)?,
                    content_raw: row.get(3)?,
                    token_count: row.get(4)?,
                    created_at_ms: row.get(5)?,
                    created_at_iso: row.get(6)?,
                    metadata_json: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn parse_turn_index_from_source_ref(source_ref: &str) -> Option<i64> {
    let mut parts = source_ref.split(':');
    let _session = parts.next()?;
    parts.next()?.parse::<i64>().ok()
}

fn read_controller_state_i64(connection: &Connection, key: &str) -> anyhow::Result<Option<i64>> {
    connection
        .query_row(
            "select value_int from trim_controller_state where key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(Into::into)
}

fn read_controller_state_f64(connection: &Connection, key: &str) -> anyhow::Result<Option<f64>> {
    connection
        .query_row(
            "select value_real from trim_controller_state where key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(Into::into)
}

fn upsert_controller_state_i64(
    connection: &Connection,
    key: &str,
    value: i64,
    now_ms: i64,
    now_iso: &str,
) -> anyhow::Result<()> {
    connection.execute(
        r#"
insert into trim_controller_state (key, value_int, value_real, value_text, updated_at_ms, updated_at_iso)
values (?1, ?2, null, null, ?3, ?4)
on conflict(key) do update set
    value_int = excluded.value_int,
    value_real = excluded.value_real,
    value_text = excluded.value_text,
    updated_at_ms = excluded.updated_at_ms,
    updated_at_iso = excluded.updated_at_iso
        "#,
        params![key, value, now_ms, now_iso],
    )?;
    Ok(())
}

fn upsert_controller_state_f64(
    connection: &Connection,
    key: &str,
    value: f64,
    now_ms: i64,
    now_iso: &str,
) -> anyhow::Result<()> {
    connection.execute(
        r#"
insert into trim_controller_state (key, value_int, value_real, value_text, updated_at_ms, updated_at_iso)
values (?1, null, ?2, null, ?3, ?4)
on conflict(key) do update set
    value_int = excluded.value_int,
    value_real = excluded.value_real,
    value_text = excluded.value_text,
    updated_at_ms = excluded.updated_at_ms,
    updated_at_iso = excluded.updated_at_iso
        "#,
        params![key, value, now_ms, now_iso],
    )?;
    Ok(())
}

fn read_controller_state_i64_from_runtime(
    connection: &Connection,
    key: &str,
) -> anyhow::Result<Option<i64>> {
    let result = connection
        .query_row(
            "select value_int from runtime_state where key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional();
    match result {
        Ok(value) => Ok(value),
        Err(rusqlite::Error::SqliteFailure(error, _))
            if error.code == rusqlite::ErrorCode::Unknown
                || error.code == rusqlite::ErrorCode::CannotOpen =>
        {
            Ok(None)
        }
        Err(rusqlite::Error::SqliteFailure(error, maybe_message))
            if maybe_message
                .as_deref()
                .is_some_and(|message| message.contains("no such table: runtime_state")) =>
        {
            let _ = error;
            Ok(None)
        }
        Err(error) => Err(error.into()),
    }
}

fn upsert_controller_state_i64_from_runtime(
    connection: &Connection,
    key: &str,
    value: i64,
    now_ms: i64,
    now_iso: &str,
) -> anyhow::Result<()> {
    connection.execute_batch(
        r#"
create table if not exists runtime_state (
    key text primary key,
    value_int integer,
    updated_at_ms integer not null,
    updated_at_iso text not null
);
        "#,
    )?;
    connection.execute(
        r#"
insert into runtime_state (key, value_int, updated_at_ms, updated_at_iso)
values (?1, ?2, ?3, ?4)
on conflict(key) do update set
    value_int = excluded.value_int,
    updated_at_ms = excluded.updated_at_ms,
    updated_at_iso = excluded.updated_at_iso
        "#,
        params![key, value, now_ms, now_iso],
    )?;
    Ok(())
}

fn sha256_hex(input: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input);
    let digest = hasher.finalize();
    digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

fn normalize_content(content: &str, content_kind: &str) -> String {
    if matches!(content_kind, "code" | "command" | "path" | "config") {
        return content.to_string();
    }
    let normalized = content
        .chars()
        .map(|ch| if ch.is_whitespace() { ' ' } else { ch })
        .collect::<String>();
    normalized
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_lowercase()
}

fn classify_content_kind(content: &str) -> String {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return "prose".to_string();
    }
    if trimmed.contains('\n')
        && (trimmed.contains('{') || trimmed.contains("fn ") || trimmed.contains("class "))
    {
        return "code".to_string();
    }
    if trimmed.starts_with('/') || trimmed.starts_with("./") || trimmed.starts_with("~/") {
        return "path".to_string();
    }
    if trimmed.starts_with("git ")
        || trimmed.starts_with("npm ")
        || trimmed.starts_with("cargo ")
        || trimmed.starts_with("pnpm ")
    {
        return "command".to_string();
    }
    if trimmed.contains('=') && trimmed.contains('\n') {
        return "config".to_string();
    }
    if trimmed.contains("```") {
        return "mixed".to_string();
    }
    "prose".to_string()
}

fn tokenize_for_overlap(value: &str) -> HashSet<String> {
    value
        .split_whitespace()
        .map(|token| token.trim().to_lowercase())
        .filter(|token| token.len() >= 2)
        .collect()
}

fn clamp01(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

fn extract_after_keyword(input: &str, keywords: &[&str]) -> Option<String> {
    let lower = input.to_lowercase();
    for keyword in keywords {
        if let Some(index) = lower.find(keyword) {
            let start = index + keyword.len();
            let suffix = input.get(start..)?.trim();
            if !suffix.is_empty() {
                return Some(suffix.to_string());
            }
        }
    }
    None
}

fn sanitize_session_id(thread_id: &str) -> String {
    let trimmed = thread_id.trim();
    if trimmed.is_empty() {
        return "unknown-session".to_string();
    }
    trimmed
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn session_dialog_entry(
    thread_id: &str,
    turn_id: &str,
    item: &ThreadItem,
) -> Option<(&'static str, String, String, Option<String>)> {
    let stream_id = Some(format!("{thread_id}:{turn_id}"));
    match item {
        ThreadItem::UserMessage { id, content } => Some((
            "user",
            id.clone(),
            content
                .iter()
                .map(render_user_input)
                .collect::<Vec<_>>()
                .join("\n"),
            stream_id,
        )),
        ThreadItem::HookPrompt { id, fragments } => Some((
            "system",
            id.clone(),
            format!(
                "[hook_prompt]\n{}",
                fragments
                    .iter()
                    .map(|fragment| fragment.text.trim())
                    .filter(|fragment| !fragment.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n")
            ),
            stream_id,
        )),
        ThreadItem::AgentMessage { id, text, .. } => {
            Some(("assistant", id.clone(), text.clone(), stream_id))
        }
        ThreadItem::Plan { id, text } => Some((
            "assistant",
            id.clone(),
            format!("[plan]\n{text}"),
            stream_id,
        )),
        ThreadItem::Reasoning { .. } => None,
        ThreadItem::CommandExecution {
            id,
            command,
            cwd,
            status,
            aggregated_output,
            exit_code,
            duration_ms,
            ..
        } => Some((
            "tool",
            id.clone(),
            join_sections(&[
                Some("[command_execution]".to_string()),
                Some(format!("command: {command}")),
                Some(format!("cwd: {}", cwd.display())),
                Some(format!("status: {:?}", status)),
                exit_code.map(|value| format!("exit_code: {value}")),
                duration_ms.map(|value| format!("duration_ms: {value}")),
                aggregated_output
                    .as_ref()
                    .map(|output| format!("output:\n{}", output.trim())),
            ]),
            stream_id,
        )),
        ThreadItem::FileChange {
            id,
            changes,
            status,
        } => Some((
            "tool",
            id.clone(),
            join_sections(&[
                Some("[file_change]".to_string()),
                Some(format!("status: {:?}", status)),
                Some(format!(
                    "changes:\n{}",
                    serde_json::to_string_pretty(changes)
                        .unwrap_or_else(|_| format!("{changes:?}"))
                )),
            ]),
            stream_id,
        )),
        ThreadItem::McpToolCall {
            id,
            server,
            tool,
            status,
            arguments,
            result,
            error,
            duration_ms,
            ..
        } => Some((
            "tool",
            id.clone(),
            join_sections(&[
                Some("[mcp_tool_call]".to_string()),
                Some(format!("server: {server}")),
                Some(format!("tool: {tool}")),
                Some(format!("status: {:?}", status)),
                Some(format!(
                    "arguments:\n{}",
                    serde_json::to_string_pretty(arguments)
                        .unwrap_or_else(|_| arguments.to_string())
                )),
                result.as_ref().map(|value| {
                    format!(
                        "result:\n{}",
                        serde_json::to_string_pretty(value)
                            .unwrap_or_else(|_| format!("{value:?}"))
                    )
                }),
                error.as_ref().map(|value| {
                    format!(
                        "error:\n{}",
                        serde_json::to_string_pretty(value)
                            .unwrap_or_else(|_| format!("{value:?}"))
                    )
                }),
                duration_ms.map(|value| format!("duration_ms: {value}")),
            ]),
            stream_id,
        )),
        ThreadItem::DynamicToolCall {
            id,
            tool,
            arguments,
            status,
            content_items,
            success,
            duration_ms,
        } => Some((
            "tool",
            id.clone(),
            join_sections(&[
                Some("[dynamic_tool_call]".to_string()),
                Some(format!("tool: {tool}")),
                Some(format!("status: {:?}", status)),
                success.map(|value| format!("success: {value}")),
                duration_ms.map(|value| format!("duration_ms: {value}")),
                Some(format!(
                    "arguments:\n{}",
                    serde_json::to_string_pretty(arguments)
                        .unwrap_or_else(|_| arguments.to_string())
                )),
                content_items.as_ref().map(|value| {
                    format!(
                        "content_items:\n{}",
                        serde_json::to_string_pretty(value)
                            .unwrap_or_else(|_| format!("{value:?}"))
                    )
                }),
            ]),
            stream_id,
        )),
        ThreadItem::CollabAgentToolCall {
            id,
            tool,
            status,
            sender_thread_id,
            receiver_thread_ids,
            prompt,
            model,
            reasoning_effort,
            agents_states,
        } => Some((
            "tool",
            id.clone(),
            join_sections(&[
                Some("[collab_agent_tool_call]".to_string()),
                Some(format!("tool: {:?}", tool)),
                Some(format!("status: {:?}", status)),
                Some(format!("sender_thread_id: {sender_thread_id}")),
                Some(format!(
                    "receiver_thread_ids: {}",
                    receiver_thread_ids.join(", ")
                )),
                prompt
                    .as_ref()
                    .map(|value| format!("prompt:\n{}", value.trim())),
                model.as_ref().map(|value| format!("model: {value}")),
                reasoning_effort.map(|value| format!("reasoning_effort: {value}")),
                Some(format!(
                    "agents_states:\n{}",
                    serde_json::to_string_pretty(agents_states)
                        .unwrap_or_else(|_| format!("{agents_states:?}"))
                )),
            ]),
            stream_id,
        )),
        ThreadItem::WebSearch { id, query, action } => Some((
            "tool",
            id.clone(),
            join_sections(&[
                Some("[web_search]".to_string()),
                Some(format!("query: {query}")),
                action.as_ref().map(|value| {
                    format!(
                        "action:\n{}",
                        serde_json::to_string_pretty(value)
                            .unwrap_or_else(|_| format!("{value:?}"))
                    )
                }),
            ]),
            stream_id,
        )),
        ThreadItem::ImageView { id, path } => Some((
            "tool",
            id.clone(),
            format!("[image_view]\npath: {}", path.display()),
            stream_id,
        )),
        ThreadItem::ImageGeneration {
            id,
            status,
            revised_prompt,
            result,
            saved_path,
        } => Some((
            "tool",
            id.clone(),
            join_sections(&[
                Some("[image_generation]".to_string()),
                Some(format!("status: {status}")),
                revised_prompt
                    .as_ref()
                    .map(|value| format!("revised_prompt:\n{}", value.trim())),
                Some(format!("result:\n{}", result.trim())),
                saved_path
                    .as_ref()
                    .map(|value| format!("saved_path: {}", value.display())),
            ]),
            stream_id,
        )),
        ThreadItem::EnteredReviewMode { id, review } => Some((
            "system",
            id.clone(),
            format!("[review_mode_entered]\n{review}"),
            stream_id,
        )),
        ThreadItem::ExitedReviewMode { id, review } => Some((
            "system",
            id.clone(),
            format!("[review_mode_exited]\n{review}"),
            stream_id,
        )),
    }
}

fn join_sections(sections: &[Option<String>]) -> String {
    sections
        .iter()
        .filter_map(|value| value.as_ref())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn item_type_name(item: &ThreadItem) -> &'static str {
    match item {
        ThreadItem::UserMessage { .. } => "userMessage",
        ThreadItem::HookPrompt { .. } => "hookPrompt",
        ThreadItem::AgentMessage { .. } => "agentMessage",
        ThreadItem::Plan { .. } => "plan",
        ThreadItem::Reasoning { .. } => "reasoning",
        ThreadItem::CommandExecution { .. } => "commandExecution",
        ThreadItem::FileChange { .. } => "fileChange",
        ThreadItem::McpToolCall { .. } => "mcpToolCall",
        ThreadItem::DynamicToolCall { .. } => "dynamicToolCall",
        ThreadItem::CollabAgentToolCall { .. } => "collabAgentToolCall",
        ThreadItem::WebSearch { .. } => "webSearch",
        ThreadItem::ImageView { .. } => "imageView",
        ThreadItem::ImageGeneration { .. } => "imageGeneration",
        ThreadItem::EnteredReviewMode { .. } => "enteredReviewMode",
        ThreadItem::ExitedReviewMode { .. } => "exitedReviewMode",
    }
}

fn render_user_input(input: &UserInput) -> String {
    match input {
        UserInput::Text { text, .. } => text.clone(),
        UserInput::Image { url } => format!("[image] {url}"),
        UserInput::LocalImage { path } => format!("[local_image] {}", path.display()),
        UserInput::Skill { name, path } => format!("[skill] {name} ({})", path.display()),
        UserInput::Mention { name, path } => format!("[mention] {name} ({path})"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_dialog_entry_skips_reasoning_items() {
        let item = ThreadItem::Reasoning {
            id: "reasoning-1".to_string(),
            summary: vec!["summary".to_string()],
            content: vec!["raw thought".to_string()],
        };

        assert!(session_dialog_entry("thread-1", "turn-1", &item).is_none());
    }

    #[test]
    fn session_dialog_entry_persists_agent_messages() {
        let item = ThreadItem::AgentMessage {
            id: "message-1".to_string(),
            text: "visible answer".to_string(),
            phase: None,
            memory_citation: None,
        };

        let entry = session_dialog_entry("thread-1", "turn-1", &item).expect("entry");
        assert_eq!(entry.0, "assistant");
        assert_eq!(entry.1, "message-1");
        assert_eq!(entry.2, "visible answer");
    }
}
