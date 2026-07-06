use super::*;

use std::collections::HashSet;
use std::sync::OnceLock;
use std::time::Instant;

use lyra_code_intel_core::IndexStatus;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::codegraph::engine;

/// P6 dynamic-fragment budget: a fixed ~30% slice of the typical 4k system
/// prompt budget. When the prompt budget is larger this stays fixed (per the
/// "固定额度上限" decision) so P0-P5 stable layers are never squeezed by
/// CodeGraph fragments. Raised from 800 → 1600 to accommodate intent-driven
/// analysis fragments (impact, tests, cycles, dead imports, hot paths,
/// patterns, file symbols, memory) alongside the existing neighborhoods.
pub(crate) const CODEGRAPH_FRAGMENT_BUDGET_TOKENS: usize = 1600;

/// Soft per-symbol neighborhood token cost (compressed summary). Used to gate
/// how many symbols we pre-fetch before exceeding the budget.
const NEIGHBORHOOD_TOKEN_COST: usize = 160;

/// Maximum symbols resolved per turn. Even if the budget allows more, we cap
/// here to keep per-turn query latency bounded.
const MAX_RESOLVED_SYMBOLS: usize = 3;

/// LRU cache cap for the signal cache.
const SIGNAL_CACHE_MAX_ENTRIES: usize = 32;

// ── Intent query caps ─────────────────────────────────────────────────────

/// Sub-budget for intent-driven deep queries (impact, tests, cycles, etc.).
/// The neighborhoods use NEIGHBORHOOD_TOKEN_COST * MAX_RESOLVED_SYMBOLS ≈ 480
/// tokens; the remaining ~1120 is split between neighborhoods and intent
/// fragments. This sub-budget caps intent queries at 800 tokens so they never
/// dominate the fragment budget.
const INTENT_QUERY_BUDGET_TOKENS: usize = 800;

const MAX_FILE_SYMBOLS: usize = 5;
const MAX_RELATED_TESTS: usize = 5;
const MAX_CIRCULAR_DEPS: usize = 3;
const MAX_DEAD_IMPORTS: usize = 5;
const MAX_HOT_PATHS: usize = 5;
const MAX_PATTERN_MATCHES: usize = 5;
const MAX_MEMORY_HITS: usize = 3;

// ── Public types (consumed by prompt_policy + turns) ─────────────────────

/// CodeGraph signals derived deterministically from the latest user message
/// and session state. Drives the P6 `codegraph_fragments` prompt section.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodeGraphSignals {
    /// Candidate symbol names extracted from the user message (pre-resolution).
    pub mentioned_symbols: Vec<String>,
    /// Resolved symbol neighborhoods (≤ MAX_RESOLVED_SYMBOLS, budget-gated).
    pub resolved_neighborhoods: Vec<SymbolNeighborhood>,
    /// Stale files that intersect with files mentioned in the user message.
    pub stale_files_relevant: Vec<String>,
    /// Index state label: "ready" | "indexing" | "idle" | "failed".
    pub graph_state: String,
    /// Audit log of every codegraph query executed this turn.
    pub queries_executed: Vec<QueryRecord>,
    pub cache_hits: u32,
    pub cache_misses: u32,
    // ── Intent-driven fragments (Phase 2: deep analysis) ──
    /// Detected user intent for this turn.
    pub intent: String,
    /// Blast-radius analysis for the top resolved symbol (edit/refactor intent).
    pub impact_analysis: Option<ImpactSummary>,
    /// Tests related to the top resolved symbol (test intent).
    pub related_tests: Vec<TestRef>,
    /// Circular dependency chains (refactor/architecture intent).
    pub circular_deps: Vec<CycleRef>,
    /// Dead imports in mentioned files (refactor/cleanup intent).
    pub dead_imports: Vec<DeadImportRef>,
    /// Hot-path functions (optimize intent).
    pub hot_paths: Vec<HotPathRef>,
    /// Error-handling pattern matches in mentioned files (debug intent).
    pub pattern_matches: Vec<PatternMatchRef>,
    /// Top-level symbols in mentioned files (file→symbol resolution).
    pub file_symbols: Vec<FileSymbolSummary>,
    /// CodeGraph memory search hits (debug/architecture/explore intent).
    pub memory_hits: Vec<MemoryHit>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SymbolNeighborhood {
    pub name: String,
    pub file: Option<String>,
    pub line: Option<u32>,
    pub kind: String,
    pub direct_callers: Vec<NeighborSummary>,
    pub direct_callees: Vec<NeighborSummary>,
    pub impact_depth2_count: usize,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NeighborSummary {
    pub name: String,
    pub file: Option<String>,
    pub kind: String,
}

// ── Intent-driven fragment types ──────────────────────────────────────────

/// Blast-radius summary for a symbol the user wants to edit/refactor.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImpactSummary {
    pub symbol: String,
    pub file: Option<String>,
    pub direct_impacted: usize,
    pub indirect_impacted: usize,
    pub risk_level: String,
    pub files_affected: usize,
    pub top_callers: Vec<NeighborSummary>,
}

/// A test related to a symbol or file the user mentioned.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TestRef {
    pub name: String,
    pub file: String,
    pub relationship: String, // "calls_target" | "same_file" | "adjacent_file"
}

/// A circular dependency chain.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CycleRef {
    pub files: Vec<String>,
    pub length: usize,
}

/// An unused import in a file the user mentioned.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeadImportRef {
    pub file: String,
    pub imported_module: String,
    pub line: Option<u32>,
}

/// A hot-path function (high caller score — optimize carefully).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HotPathRef {
    pub name: String,
    pub file: String,
    pub score: f64,
    pub direct_callers: usize,
}

/// A pattern match (error-handling or structural).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PatternMatchRef {
    pub name: String,
    pub kind: String,
    pub file: String,
    pub line: u32,
    pub matched_in: String,
}

/// A top-level symbol in a file the user mentioned (file→symbol resolution).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileSymbolSummary {
    pub name: String,
    pub kind: String,
    pub file: String,
    pub line: u32,
    pub visibility: String,
}

/// A codegraph memory search hit (prior debug notes / decisions).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryHit {
    pub title: String,
    pub kind: String,
    pub content: String,
    pub score: f32,
    pub related_file: Option<String>,
}

/// Detected user intent from the latest message (deterministic keyword match).
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum MessageIntent {
    Edit,
    Refactor,
    Test,
    Debug,
    Optimize,
    Cleanup,
    Architecture,
    Explore,
    Review,
    #[default]
    Other,
}

impl MessageIntent {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Edit => "edit",
            Self::Refactor => "refactor",
            Self::Test => "test",
            Self::Debug => "debug",
            Self::Optimize => "optimize",
            Self::Cleanup => "cleanup",
            Self::Architecture => "architecture",
            Self::Explore => "explore",
            Self::Review => "review",
            Self::Other => "other",
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueryRecord {
    pub tool: String,
    pub query: String,
    pub elapsed_ms: u64,
    pub result_count: usize,
}

/// Observability report persisted into `session.snapshot.promptDelivery`.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodeGraphFragmentReport {
    pub signals_attached: bool,
    pub symbols_resolved: usize,
    pub queries_executed: Vec<QueryRecord>,
    pub cache_hits: u32,
    pub cache_misses: u32,
    pub estimated_tokens: usize,
    pub budget_tokens: usize,
    pub dropped_symbols: Vec<String>,
    pub intent: String,
    pub intent_queries_executed: usize,
    pub impact_attached: bool,
    pub tests_attached: bool,
    pub circular_deps_attached: bool,
    pub dead_imports_attached: bool,
    pub hot_paths_attached: bool,
    pub pattern_matches_attached: bool,
    pub file_symbols_attached: bool,
    pub memory_hits_attached: bool,
}

impl CodeGraphSignals {
    /// True when there is anything worth rendering into the P6 section.
    pub(crate) fn has_content(&self) -> bool {
        !self.resolved_neighborhoods.is_empty()
            || !self.stale_files_relevant.is_empty()
            || self.impact_analysis.is_some()
            || !self.related_tests.is_empty()
            || !self.circular_deps.is_empty()
            || !self.dead_imports.is_empty()
            || !self.hot_paths.is_empty()
            || !self.pattern_matches.is_empty()
            || !self.file_symbols.is_empty()
            || !self.memory_hits.is_empty()
    }

    /// Build the observability report for PromptBuildReport.
    pub(crate) fn fragment_report(&self, budget_tokens: usize) -> CodeGraphFragmentReport {
        let estimated_tokens = self.estimated_fragment_tokens();
        let resolved_names: HashSet<&str> = self
            .resolved_neighborhoods
            .iter()
            .map(|nb| nb.name.as_str())
            .collect();
        let dropped = self
            .mentioned_symbols
            .iter()
            .filter(|s| !resolved_names.contains(s.as_str()))
            .cloned()
            .collect();
        // Count intent queries: total queries minus the neighborhood queries
        // (search_symbols_sync + explore_sync per resolved neighborhood).
        let nb_query_count = self
            .queries_executed
            .iter()
            .filter(|q| q.tool == "search_symbols_sync" || q.tool == "explore_sync")
            .count();
        let intent_queries_executed = self.queries_executed.len().saturating_sub(nb_query_count);
        CodeGraphFragmentReport {
            signals_attached: self.has_content(),
            symbols_resolved: self.resolved_neighborhoods.len(),
            queries_executed: self.queries_executed.clone(),
            cache_hits: self.cache_hits,
            cache_misses: self.cache_misses,
            estimated_tokens,
            budget_tokens,
            dropped_symbols: dropped,
            intent: self.intent.clone(),
            intent_queries_executed,
            impact_attached: self.impact_analysis.is_some(),
            tests_attached: !self.related_tests.is_empty(),
            circular_deps_attached: !self.circular_deps.is_empty(),
            dead_imports_attached: !self.dead_imports.is_empty(),
            hot_paths_attached: !self.hot_paths.is_empty(),
            pattern_matches_attached: !self.pattern_matches.is_empty(),
            file_symbols_attached: !self.file_symbols.is_empty(),
            memory_hits_attached: !self.memory_hits.is_empty(),
        }
    }

    pub(crate) fn estimated_fragment_tokens(&self) -> usize {
        let per_nb = NEIGHBORHOOD_TOKEN_COST;
        let nb_tokens = self.resolved_neighborhoods.len() * per_nb;
        let stale_tokens = if self.stale_files_relevant.is_empty() {
            0
        } else {
            40 + self.stale_files_relevant.iter().map(|f| f.chars().count().div_ceil(4)).sum::<usize>()
        };
        let impact_tokens = if self.impact_analysis.is_some() { 120 } else { 0 };
        let tests_tokens = self.related_tests.len() * 40;
        let cycles_tokens = self.circular_deps.len() * 60;
        let dead_tokens = self.dead_imports.len() * 30;
        let hot_tokens = self.hot_paths.len() * 30;
        let pattern_tokens = self.pattern_matches.len() * 30;
        let file_sym_tokens = self.file_symbols.len() * 30;
        let memory_tokens = self.memory_hits.len() * 80;
        nb_tokens
            + stale_tokens
            + impact_tokens
            + tests_tokens
            + cycles_tokens
            + dead_tokens
            + hot_tokens
            + pattern_tokens
            + file_sym_tokens
            + memory_tokens
    }
}

// ── Cache ─────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct CachedNeighborhood {
    neighborhood: SymbolNeighborhood,
    /// The codegraph index was fresh when this was cached. If the index
    /// becomes stale, the cache is invalidated.
    cached_fresh: bool,
}

struct CodeGraphSignalCache {
    neighborhoods: Vec<((PathBuf, String), CachedNeighborhood)>,
    last_message_signature: u64,
    last_working_dir: Option<PathBuf>,
}

impl CodeGraphSignalCache {
    fn new() -> Self {
        Self {
            neighborhoods: Vec::new(),
            last_message_signature: 0,
            last_working_dir: None,
        }
    }

    fn get(&mut self, root: &Path, symbol: &str) -> Option<&SymbolNeighborhood> {
        let key = (root.to_path_buf(), symbol.to_string());
        if let Some(idx) = self.neighborhoods.iter().position(|(k, _)| *k == key) {
            // Move-to-end for LRU.
            let entry = self.neighborhoods.remove(idx);
            self.neighborhoods.push(entry);
            self.neighborhoods.last().map(|(_, v)| &v.neighborhood)
        } else {
            None
        }
    }

    fn insert(&mut self, root: &Path, symbol: String, nb: SymbolNeighborhood, fresh: bool) {
        let key = (root.to_path_buf(), symbol);
        // Remove existing entry for the key (re-insert at end).
        self.neighborhoods.retain(|(k, _)| *k != key);
        self.neighborhoods.push((
            key,
            CachedNeighborhood {
                neighborhood: nb,
                cached_fresh: fresh,
            },
        ));
        // LRU bound.
        if self.neighborhoods.len() > SIGNAL_CACHE_MAX_ENTRIES {
            self.neighborhoods.remove(0);
        }
    }

    fn invalidate_all(&mut self) {
        self.neighborhoods.clear();
    }
}

static SIGNAL_CACHE: OnceLock<std::sync::Mutex<CodeGraphSignalCache>> = OnceLock::new();

fn signal_cache() -> &'static std::sync::Mutex<CodeGraphSignalCache> {
    SIGNAL_CACHE.get_or_init(|| std::sync::Mutex::new(CodeGraphSignalCache::new()))
}

// ── Signal derivation ─────────────────────────────────────────────────────

/// Detect the user's intent from their latest message. Pure deterministic
/// keyword matching (no LLM, no scene-module touching). Returns the first
/// matching intent by priority, or `Other` if none match.
///
/// Priority order matters: Debug before Edit (a "fix the bug" message is more
/// usefully Debug than Edit), Refactor before Architecture (explicit refactor
/// is more actionable than generic architecture).
fn detect_intent(text: &str) -> MessageIntent {
    let lower = text.to_ascii_lowercase();

    // Debug: error/bug/fail/stack trace/调试/报错/失败
    const DEBUG_KW: &[&str] = &[
        "debug", "bug", "error", "fail", "crash", "stack trace", "exception",
        "panic", "traceback", "wrong", "broken", "doesn't work", "does not work",
        "调试", "报错", "错误", "失败", "崩溃", "异常", "有问题", "不工作", "坏了",
    ];
    if DEBUG_KW.iter().any(|kw| lower.contains(kw)) {
        return MessageIntent::Debug;
    }

    // Refactor: refactor/restructure/重组/重构
    const REFACTOR_KW: &[&str] = &[
        "refactor", "restructure", "reorganize", "clean up code", "split into",
        "extract method", "extract function", "重组", "重构", "重新组织",
    ];
    if REFACTOR_KW.iter().any(|kw| lower.contains(kw)) {
        return MessageIntent::Refactor;
    }

    // Test: test/spec/跑测/单元测试
    const TEST_KW: &[&str] = &[
        "test", "tests", "spec", "specs", "unit test", "run test", "coverage",
        "mock", "assert", "测试", "跑测", "单元测试", "用例",
    ];
    if TEST_KW.iter().any(|kw| lower.contains(kw)) {
        return MessageIntent::Test;
    }

    // Optimize: optimize/performance/性能/加速
    const OPTIMIZE_KW: &[&str] = &[
        "optimize", "optimization", "performance", "speed up", "faster", "latency",
        "bottleneck", "优化", "性能", "加速", "慢", "瓶颈",
    ];
    if OPTIMIZE_KW.iter().any(|kw| lower.contains(kw)) {
        return MessageIntent::Optimize;
    }

    // Cleanup: cleanup/dead code/unused/清理/死代码
    const CLEANUP_KW: &[&str] = &[
        "cleanup", "clean up", "dead code", "unused", "remove unused", "prune",
        "清理", "死代码", "无用", "废弃", "清理掉",
    ];
    if CLEANUP_KW.iter().any(|kw| lower.contains(kw)) {
        return MessageIntent::Cleanup;
    }

    // Architecture: architecture/design/依赖/循环/circular
    const ARCH_KW: &[&str] = &[
        "architecture", "design", "dependency", "dependencies", "circular", "coupling",
        "module structure", "design doc", "架构", "设计", "依赖", "循环", "耦合",
        "模块结构", "层次",
    ];
    if ARCH_KW.iter().any(|kw| lower.contains(kw)) {
        return MessageIntent::Architecture;
    }

    // Review: review/审查/code review/检查
    const REVIEW_KW: &[&str] = &[
        "review", "code review", "audit", "inspect", "审查", "检查", "审核",
    ];
    if REVIEW_KW.iter().any(|kw| lower.contains(kw)) {
        return MessageIntent::Review;
    }

    // Edit: modify/edit/update/change/fix/修复/修改
    const EDIT_KW: &[&str] = &[
        "modify", "edit", "update", "change", "fix", "add", "implement", "write",
        "modify", "create", "generate", "改", "修改", "改動", "修复", "添加", "实现",
        "生成", "写入", "更新", "调整",
    ];
    if EDIT_KW.iter().any(|kw| lower.contains(kw)) {
        return MessageIntent::Edit;
    }

    // Explore: explore/understand/了解/分析/看看
    const EXPLORE_KW: &[&str] = &[
        "explore", "understand", "analyze", "explain", "how does", "what does",
        "show me", "look at", "看看", "了解", "分析", "解释", "什么意思",
    ];
    if EXPLORE_KW.iter().any(|kw| lower.contains(kw)) {
        return MessageIntent::Explore;
    }

    MessageIntent::Other
}

/// Extract candidate symbol tokens from the user message.
///
/// This is **deterministic identifier extraction**, not keyword/scene matching.
/// We scan for identifier-shaped tokens (`[_a-zA-Z][_a-zA-Z0-9]{2,}`), filter
/// out common English stop-words and file-path fragments, and return the
/// longest remaining candidates (longer tokens are more likely to be real
/// symbol names than short ones).
fn extract_candidate_symbols(text: &str) -> Vec<String> {
    const STOP_WORDS: &[&str] = &[
        "the", "and", "for", "you", "are", "this", "that", "with", "have", "from",
        "was", "will", "your", "but", "not", "can", "all", "any", "get", "set",
        "use", "how", "why", "what", "who", "when", "where", "which", "into",
        "our", "out", "now", "let", "try", "make", "like", "than", "then",
        "them", "they", "their", "there", "these", "those", "some", "such",
        "very", "just", "also", "only", "more", "most", "much", "many",
        "should", "could", "would", "about", "after", "before", "between",
        "through", "during", "while", "since", "until", "because", "being",
        "having", "doing", "going", "looking", "something", "nothing",
        "everything", "anything", "please", "thanks", "thank", "help",
        "need", "want", "know", "think", "feel", "seem", "find", "found",
        "here", "code", "file", "files", "function", "functions", "class",
        "classes", "method", "methods", "variable", "variables", "type",
        "types", "module", "modules", "import", "exports", "return", "returns",
        "param", "params", "arg", "args", "true", "false", "null", "none",
        "void", "self", "this", "super", "base", "main", "test", "tests",
        "spec", "specs", "describe", "expect", "assert", "done", "next",
        "prev", "current", "value", "name", "key", "data", "result", "error",
        "errors", "status", "state", "context", "request", "response",
        "project", "workspace", "change", "changes", "feature", "fix", "fixes",
        "bug", "bugs", "issue", "issues", "task", "tasks", "todo", "step",
        "steps", "plan", "plans", "review", "refactor", "test", "testing",
        "build", "deploy", "run", "running", "start", "stop", "pause",
        "resume", "create", "update", "delete", "remove", "add", "new",
        "old", "first", "last", "one", "two", "three", "four", "five",
    ];

    let mut candidates: Vec<(String, usize)> = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        let is_start = b.is_ascii_alphabetic() || b == b'_';
        if !is_start {
            i += 1;
            continue;
        }
        // Also allow `::` or `.` inside (rust path / method access) — but only
        // count the trailing segment as the symbol name candidate.
        let start = i;
        while i < bytes.len() {
            let c = bytes[i];
            if c.is_ascii_alphanumeric() || c == b'_' {
                i += 1;
            } else if (c == b':' || c == b'.') && i + 1 < bytes.len() && (bytes[i + 1].is_ascii_alphanumeric() || bytes[i + 1] == b'_') {
                i += 1;
            } else {
                break;
            }
        }
        let token = &text[start..i];
        // Take the last segment after `::` or `.` as the symbol candidate.
        let candidate = token.rsplit([':', '.']).next().unwrap_or(token);
        if candidate.len() < 3 {
            continue;
        }
        let lower = candidate.to_ascii_lowercase();
        if STOP_WORDS.contains(&lower.as_str()) {
            continue;
        }
        // Skip pure numbers.
        if candidate.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        candidates.push((candidate.to_string(), candidate.len()));
    }

    // Deduplicate + sort by length desc (longer = more likely a real symbol).
    candidates.sort_by(|a, b| b.1.cmp(&a.1));
    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter_map(|(s, _)| {
            if seen.insert(s.to_ascii_lowercase()) {
                Some(s)
            } else {
                None
            }
        })
        .take(8) // Upper bound on candidates we'll try to resolve.
        .collect()
}

/// Extract file paths mentioned in the user message (for stale-file matching).
fn extract_mentioned_files(text: &str) -> Vec<String> {
    let mut files = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        // Look for path-shaped tokens: contain `/` and end with a file extension.
        let b = bytes[i];
        if !(b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-' || b == b'~') {
            i += 1;
            continue;
        }
        let start = i;
        while i < bytes.len() {
            let c = bytes[i];
            if c.is_ascii_alphanumeric() || c == b'.' || c == b'_' || c == b'-' || c == b'/' || c == b'~' {
                i += 1;
            } else {
                break;
            }
        }
        let token = &text[start..i];
        if token.contains('/') && token.contains('.') {
            files.push(token.to_string());
        }
    }
    files
}

/// Hash the (working_dir, normalized message) pair for cache hit detection.
fn message_signature(working_dir: &Path, text: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325; // FNV-1a offset basis
    let dir_bytes = working_dir.to_string_lossy().as_bytes();
    for &b in dir_bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h ^= 0x7c; // separator
    h = h.wrapping_mul(0x100000001b3);
    // Normalize: lowercase + collapse whitespace.
    let normalized: String = text
        .chars()
        .map(|c| if c.is_whitespace() { ' ' } else { c.to_ascii_lowercase() })
        .collect();
    let collapsed: String = normalized.split_whitespace().collect::<Vec<_>>().join(" ");
    for &b in collapsed.as_bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

// ── Main entry point ──────────────────────────────────────────────────────

/// Build CodeGraph signals for the current turn. Pure Rust, deterministic,
/// zero LLM. All codegraph queries are sync and μs-ms level.
pub(crate) fn codegraph_signals_for_prompt(
    working_dir: Option<&Path>,
    latest_user_text: &str,
    _session_id: Option<&str>,
    budget_tokens: usize,
) -> CodeGraphSignals {
    let Some(working_dir) = working_dir.filter(|d| !d.as_os_str().is_empty()) {
        return CodeGraphSignals::default();
    };

    // 1. Check index state — bail to empty signals if not Ready (degrade to
    //    the existing projectContext summary).
    let status = engine().status_sync(working_dir);
    let graph_state = match &status {
        IndexStatus::Ready { .. } => "ready",
        IndexStatus::Indexing { .. } => "indexing",
        IndexStatus::Failed { .. } => "failed",
        IndexStatus::Idle => "idle",
    };
    if graph_state != "ready" {
        return CodeGraphSignals {
            graph_state: graph_state.to_string(),
            ..Default::default()
        };
    }

    // 2. Cache short-circuit: same working_dir + same normalized message →
    //    reuse cached neighborhoods (zero codegraph queries this turn).
    let sig = message_signature(working_dir, latest_user_text);
    let mut cache = signal_cache().lock().expect("codegraph signal cache poisoned");
    let cache_hit_message = cache.last_message_signature == sig
        && cache.last_working_dir.as_deref() == Some(working_dir);

    // 3. Extract candidate symbols (deterministic identifier extraction).
    let candidates = extract_candidate_symbols(latest_user_text);
    if candidates.is_empty() && cache_hit_message {
        // No new symbols and message unchanged → return a minimal signals
        // object (the prompt section won't render anyway since neighborhoods
        // would be empty).
        return CodeGraphSignals {
            graph_state: graph_state.to_string(),
            cache_hits: cache.cache_hits,
            ..Default::default()
        };
    }

    // 4. Check staleness — if files changed since last index, invalidate the
    //    neighborhood cache (simplified: full invalidation, since staleness
    //    doesn't tell us which symbols are affected).
    let staleness = engine().staleness_sync(working_dir).ok();
    let is_fresh = staleness.as_ref().map(|s| !s.stale).unwrap_or(true);
    let mentioned_files = extract_mentioned_files(latest_user_text);
    let stale_files_relevant: Vec<String> = match &staleness {
        Some(s) if s.stale => s
            .changed_files
            .iter()
            .filter(|f| {
                let f_norm = f.replace('\\', "/");
                mentioned_files
                    .iter()
                    .any(|m| m.replace('\\', "/").ends_with(&f_norm) || f_norm.ends_with(m.as_str()))
            })
            .cloned()
            .collect(),
        _ => Vec::new(),
    };

    if !is_fresh {
        cache.invalidate_all();
    }

    // 5. Resolve candidates → neighborhoods. For each candidate, try
    //    search_symbols_sync then explore_sync. Budget-gate: stop once we
    //    hit MAX_RESOLVED_SYMBOLS or exceed budget_tokens.
    let mut signals = CodeGraphSignals {
        mentioned_symbols: candidates.clone(),
        graph_state: graph_state.to_string(),
        stale_files_relevant,
        ..Default::default()
    };

    let mut total_cost = 0usize;
    let mut resolved_count = 0usize;
    let mut cache_hits = 0u32;
    let mut cache_misses = 0u32;
    let mut queries: Vec<QueryRecord> = Vec::new();

    for candidate in &candidates {
        if resolved_count >= MAX_RESOLVED_SYMBOLS {
            break;
        }
        if total_cost + NEIGHBORHOOD_TOKEN_COST > budget_tokens {
            break;
        }

        // Cache lookup.
        if let Some(cached) = cache.get(working_dir, candidate) {
            cache_hits += 1;
            total_cost += NEIGHBORHOOD_TOKEN_COST;
            signals.resolved_neighborhoods.push(cached.clone());
            resolved_count += 1;
            continue;
        }
        cache_misses += 1;

        // search_symbols_sync to find the symbol.
        let t0 = Instant::now();
        let search_result = engine().search_symbols_sync(working_dir, candidate, 1);
        let elapsed = t0.elapsed().as_millis() as u64;
        let result_count = match &search_result {
            Ok(v) => v.len(),
            Err(_) => 0,
        };
        queries.push(QueryRecord {
            tool: "search_symbols_sync".to_string(),
            query: candidate.clone(),
            elapsed_ms: elapsed,
            result_count,
        });
        let Some(match_) = search_result.ok().and_then(|v| v.into_iter().next()) else {
            continue;
        };

        // explore_sync to get callers + callees in one call.
        let t0 = Instant::now();
        let explore_result = engine().explore_sync(working_dir, &match_.symbol.name, 1);
        let elapsed = t0.elapsed().as_millis() as u64;
        let result_count = match &explore_result {
            Ok(r) => r.symbols.len(),
            Err(_) => 0,
        };
        queries.push(QueryRecord {
            tool: "explore_sync".to_string(),
            query: match_.symbol.name.clone(),
            elapsed_ms: elapsed,
            result_count,
        });

        let Ok(explore) = explore_result else {
            continue;
        };

        // Compress into SymbolNeighborhood.
        let Some(explore_sym) = explore.symbols.into_iter().next() else {
            continue;
        };
        let nb = compress_neighborhood(&explore_sym);
        total_cost += NEIGHBORHOOD_TOKEN_COST;
        signals.resolved_neighborhoods.push(nb.clone());
        resolved_count += 1;
        cache.insert(working_dir, candidate.clone(), nb, is_fresh);
    }

    // 6. Detect user intent (deterministic keyword match — does not touch
    //    the existing select_scene_modules keyword/regex system).
    let intent = detect_intent(latest_user_text);
    signals.intent = intent.as_str().to_string();

    // 7. File → symbol resolution. For each mentioned file, query top-level
    //    symbols. This closes the gap where "edit src/auth.ts" (no symbol
    //    named) would previously only trigger a stale-files warning.
    let mut intent_cost = 0usize;
    if !mentioned_files.is_empty() && intent_cost < INTENT_QUERY_BUDGET_TOKENS {
        let file_syms = resolve_file_symbols(
            working_dir,
            &mentioned_files,
            &mut queries,
            &mut intent_cost,
        );
        if !file_syms.is_empty() {
            signals.file_symbols = file_syms.into_iter().take(MAX_FILE_SYMBOLS).collect();
        }
    }

    // 8. Intent-driven deep queries. Each intent triggers specific codegraph
    //    MCP tool calls via run_mcp_tool_sync (μs-ms, no LLM, no network).
    //    Results are compressed into typed fragments and budget-gated.
    match &intent {
        MessageIntent::Edit | MessageIntent::Refactor => {
            // Impact analysis on the top resolved neighborhood.
            if let Some(top_nb) = signals.resolved_neighborhoods.first() {
                if intent_cost < INTENT_QUERY_BUDGET_TOKENS {
                    let impact = run_impact_query(working_dir, top_nb, &mut queries, &mut intent_cost);
                    if impact.is_some() {
                        signals.impact_analysis = impact;
                    }
                }
            }
            if intent == MessageIntent::Refactor {
                // Circular deps — only cycles touching mentioned files/neighborhoods.
                if intent_cost < INTENT_QUERY_BUDGET_TOKENS {
                    let cycles = run_circular_deps(working_dir, &mentioned_files, &signals.resolved_neighborhoods, 10, &mut queries, &mut intent_cost);
                    signals.circular_deps = cycles.into_iter().take(MAX_CIRCULAR_DEPS).collect();
                }
                // Dead imports in mentioned files.
                if !mentioned_files.is_empty() && intent_cost < INTENT_QUERY_BUDGET_TOKENS {
                    let dead = run_dead_imports(working_dir, &mentioned_files, &mut queries, &mut intent_cost);
                    signals.dead_imports = dead.into_iter().take(MAX_DEAD_IMPORTS).collect();
                }
            }
        }
        MessageIntent::Test => {
            if let Some(top_nb) = signals.resolved_neighborhoods.first() {
                if intent_cost < INTENT_QUERY_BUDGET_TOKENS {
                    let tests = run_related_tests(working_dir, top_nb, &mut queries, &mut intent_cost);
                    signals.related_tests = tests.into_iter().take(MAX_RELATED_TESTS).collect();
                }
            }
        }
        MessageIntent::Optimize => {
            if intent_cost < INTENT_QUERY_BUDGET_TOKENS {
                let hot = run_hot_paths(working_dir, &mentioned_files, &signals.resolved_neighborhoods, &mut queries, &mut intent_cost);
                signals.hot_paths = hot.into_iter().take(MAX_HOT_PATHS).collect();
            }
        }
        MessageIntent::Debug => {
            // Error-handling patterns in mentioned files.
            if !mentioned_files.is_empty() && intent_cost < INTENT_QUERY_BUDGET_TOKENS {
                let patterns = run_error_search(working_dir, &mentioned_files, &mut queries, &mut intent_cost);
                signals.pattern_matches = patterns.into_iter().take(MAX_PATTERN_MATCHES).collect();
            }
            // Memory search (debug notes / known issues).
            if intent_cost < INTENT_QUERY_BUDGET_TOKENS {
                let mem = run_memory_search(working_dir, latest_user_text, &mut queries, &mut intent_cost);
                if !mem.is_empty() {
                    signals.memory_hits = mem.into_iter().take(MAX_MEMORY_HITS).collect();
                }
            }
        }
        MessageIntent::Architecture => {
            // Global circular deps.
            if intent_cost < INTENT_QUERY_BUDGET_TOKENS {
                let cycles = run_circular_deps(working_dir, &[], &[], 20, &mut queries, &mut intent_cost);
                signals.circular_deps = cycles.into_iter().take(MAX_CIRCULAR_DEPS).collect();
            }
            // Memory search (architectural decisions).
            if intent_cost < INTENT_QUERY_BUDGET_TOKENS {
                let mem = run_memory_search(working_dir, latest_user_text, &mut queries, &mut intent_cost);
                if !mem.is_empty() {
                    signals.memory_hits = mem.into_iter().take(MAX_MEMORY_HITS).collect();
                }
            }
        }
        MessageIntent::Cleanup => {
            if !mentioned_files.is_empty() && intent_cost < INTENT_QUERY_BUDGET_TOKENS {
                let dead = run_dead_imports(working_dir, &mentioned_files, &mut queries, &mut intent_cost);
                signals.dead_imports = dead.into_iter().take(MAX_DEAD_IMPORTS).collect();
            }
        }
        MessageIntent::Explore => {
            // Memory search (project context / conventions).
            if intent_cost < INTENT_QUERY_BUDGET_TOKENS {
                let mem = run_memory_search(working_dir, latest_user_text, &mut queries, &mut intent_cost);
                if !mem.is_empty() {
                    signals.memory_hits = mem.into_iter().take(MAX_MEMORY_HITS).collect();
                }
            }
        }
        MessageIntent::Review | MessageIntent::Other => {
            // No additional queries — neighborhoods are sufficient.
        }
    }

    // 9. If impact analysis was resolved, patch the fake impact_depth2_count
    //    on the corresponding neighborhood with the real value.
    if let Some(ref impact) = signals.impact_analysis {
        if let Some(nb) = signals.resolved_neighborhoods.iter_mut().find(|n| n.name == impact.symbol) {
            nb.impact_depth2_count = impact.direct_impacted + impact.indirect_impacted;
        }
    }

    // 10. Update cache metadata.
    cache.last_message_signature = sig;
    cache.last_working_dir = Some(working_dir.to_path_buf());

    signals.queries_executed = queries;
    signals.cache_hits = cache_hits;
    signals.cache_misses = cache_misses;
    signals
}

/// Compress an `ExploreSymbol` (which may carry many callers/callees) into a
/// tight `SymbolNeighborhood` summary (~120-160 tokens).
fn compress_neighborhood(
    explore: &lyra_code_intel_core::ExploreSymbol,
) -> SymbolNeighborhood {
    let sym = &explore.symbol;
    let file = Some(sym.location.file.clone());
    let line = Some(sym.location.line);

    // Top 3 callers by name (explore already returns them ranked).
    let direct_callers = explore
        .callers
        .iter()
        .take(3)
        .map(|c| NeighborSummary {
            name: c.symbol.name.clone(),
            file: Some(c.symbol.location.file.clone()),
            kind: c.symbol.kind.clone(),
        })
        .collect();

    let direct_callees = explore
        .callees
        .iter()
        .take(3)
        .map(|c| NeighborSummary {
            name: c.symbol.name.clone(),
            file: Some(c.symbol.location.file.clone()),
            kind: c.symbol.kind.clone(),
        })
        .collect();

    // impact_depth2_count is not directly returned by explore; approximate
    // with callers.len() + callees.len() as a rough blast-radius signal.
    let impact_depth2_count = explore.callers.len() + explore.callees.len();

    SymbolNeighborhood {
        name: sym.name.clone(),
        file,
        line,
        kind: sym.kind.clone(),
        direct_callers,
        direct_callees,
        impact_depth2_count,
    }
}

// ── Intent-driven query helpers ────────────────────────────────────────────
//
// All helpers call `engine().run_mcp_tool_sync(root, tool_name, args)` — the
// same path used by the `codegraph_server` native handle. Returns `Value`
// which we parse into typed fragments. On error, returns empty / None
// (silent degradation — the prompt just won't carry that fragment).

/// Run a codegraph MCP tool synchronously and record the query in the audit log.
fn run_mcp_tool(
    working_dir: &Path,
    tool_name: &str,
    args: Value,
    queries: &mut Vec<QueryRecord>,
) -> Option<Value> {
    let t0 = Instant::now();
    let result = engine().run_mcp_tool_sync(working_dir, tool_name, args);
    let elapsed = t0.elapsed().as_millis() as u64;
    match &result {
        Ok(v) => {
            let count = v
                .as_array()
                .map(|a| a.len())
                .or_else(|| {
                    v.get("results")
                        .and_then(|r| r.as_array())
                        .map(|a| a.len())
                        .or_else(|| v.get("total").and_then(|t| t.as_u64()).map(|n| n as usize))
                })
                .unwrap_or(0);
            queries.push(QueryRecord {
                tool: tool_name.to_string(),
                query: short_query_desc(&result),
                elapsed_ms: elapsed,
                result_count: count,
            });
            Some(v.clone())
        }
        Err(e) => {
            queries.push(QueryRecord {
                tool: tool_name.to_string(),
                query: e.clone(),
                elapsed_ms: elapsed,
                result_count: 0,
            });
            None
        }
    }
}

fn short_query_desc(v: &Value) -> String {
    // Best-effort short description for the audit log.
    if let Some(s) = v.get("symbol").and_then(|s| s.as_str()) {
        return s.to_string();
    }
    if let Some(s) = v.get("query").and_then(|s| s.as_str()) {
        return s.to_string();
    }
    if let Some(arr) = first_result_array(v) {
        if let Some(first) = arr.first() {
            if let Some(name) = first.get("name").and_then(|n| n.as_str()) {
                return name.to_string();
            }
        }
    }
    "—".to_string()
}

fn first_result_array(v: &Value) -> Option<&Vec<Value>> {
    for key in ["results", "symbols", "functions", "callers", "callees", "dependencies", "nodes", "edges", "matches", "files", "tests", "cycles", "deadImports", "functions"] {
        if let Some(arr) = v.get(key).and_then(Value::as_array) {
            return Some(arr);
        }
    }
    None
}

/// Resolve mentioned files → top-level symbols via `codegraph_symbol_search`.
fn resolve_file_symbols(
    working_dir: &Path,
    mentioned_files: &[String],
    queries: &mut Vec<QueryRecord>,
    intent_cost: &mut usize,
) -> Vec<FileSymbolSummary> {
    let mut syms = Vec::new();
    for file in mentioned_files.iter().take(3) {
        if *intent_cost >= INTENT_QUERY_BUDGET_TOKENS {
            break;
        }
        let basename = file.rsplit(['/', '\\']).next().unwrap_or(file);
        let stem = basename.rsplit('.').next_back().map(|_| basename.rsplit('.').next().unwrap_or(basename)).unwrap_or(basename);
        let result = run_mcp_tool(
            working_dir,
            "codegraph_symbol_search",
            json!({ "query": stem, "limit": 10 }),
            queries,
        );
        let Some(v) = result else { continue };
        let Some(arr) = first_result_array(&v) else { continue };
        for item in arr {
            if syms.len() >= MAX_FILE_SYMBOLS {
                break;
            }
            // Only keep symbols whose path matches the mentioned file.
            let path = item.get("symbol").and_then(|s| s.get("location")).and_then(|l| l.get("file")).and_then(|f| f.as_str());
            let path = path.or_else(|| item.get("path").and_then(|p| p.as_str()));
            if let Some(p) = path {
                if !p.ends_with(file.as_str()) && !file.ends_with(p) {
                    continue;
                }
            }
            let name = item
                .get("symbol").and_then(|s| s.get("name")).and_then(|n| n.as_str())
                .or_else(|| item.get("name").and_then(|n| n.as_str()));
            let kind = item
                .get("symbol").and_then(|s| s.get("kind")).and_then(|k| k.as_str())
                .or_else(|| item.get("kind").and_then(|k| k.as_str()))
                .unwrap_or("unknown");
            let line = item
                .get("symbol").and_then(|s| s.get("location")).and_then(|l| l.get("line")).and_then(|l| l.as_u64())
                .or_else(|| item.get("line").and_then(|l| l.as_u64()))
                .unwrap_or(0) as u32;
            let visibility = item
                .get("symbol").and_then(|s| s.get("visibility")).and_then(|v| v.as_str())
                .or_else(|| item.get("visibility").and_then(|v| v.as_str()))
                .unwrap_or("unknown");
            if let Some(name) = name {
                syms.push(FileSymbolSummary {
                    name: name.to_string(),
                    kind: kind.to_string(),
                    file: path.unwrap_or(file).to_string(),
                    line,
                    visibility: visibility.to_string(),
                });
                *intent_cost += 30;
            }
        }
    }
    syms
}

/// Run `codegraph_analyze_impact` for a symbol, return compressed summary.
fn run_impact_query(
    working_dir: &Path,
    nb: &SymbolNeighborhood,
    queries: &mut Vec<QueryRecord>,
    intent_cost: &mut usize,
) -> Option<ImpactSummary> {
    let result = run_mcp_tool(
        working_dir,
        "codegraph_analyze_impact",
        json!({ "symbol": nb.name, "changeType": "modify" }),
        queries,
    );
    let v = result?;
    let direct = v.get("directImpacted").and_then(|d| d.as_u64()).unwrap_or(0) as usize;
    let indirect = v.get("indirectImpacted").and_then(|d| d.as_u64()).unwrap_or(0) as usize;
    let risk = v.get("riskLevel").and_then(|r| r.as_str()).unwrap_or("unknown");
    let files_affected = v.get("filesAffected").and_then(|f| f.as_u64()).unwrap_or(0) as usize;
    // Extract top callers from the impacted array.
    let top_callers: Vec<NeighborSummary> = v
        .get("impacted")
        .and_then(|i| i.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let name = item.get("name").and_then(|n| n.as_str())?;
                    let path = item.get("path").and_then(|p| p.as_str());
                    Some(NeighborSummary {
                        name: name.to_string(),
                        file: path.map(|p| p.to_string()),
                        kind: "function".to_string(),
                    })
                })
                .take(5)
                .collect()
        })
        .unwrap_or_default();
    *intent_cost += 120;
    Some(ImpactSummary {
        symbol: nb.name.clone(),
        file: nb.file.clone(),
        direct_impacted: direct,
        indirect_impacted: indirect,
        risk_level: risk.to_string(),
        files_affected,
        top_callers,
    })
}

/// Run `codegraph_find_related_tests` for a symbol's file.
fn run_related_tests(
    working_dir: &Path,
    nb: &SymbolNeighborhood,
    queries: &mut Vec<QueryRecord>,
    intent_cost: &mut usize,
) -> Vec<TestRef> {
    let file = match &nb.file {
        Some(f) => f.clone(),
        None => return Vec::new(),
    };
    let result = run_mcp_tool(
        working_dir,
        "codegraph_find_related_tests",
        json!({ "path": file }),
        queries,
    );
    let Some(v) = result else { return Vec::new() };
    let tests = v.get("tests").and_then(|t| t.as_array());
    let arr = match tests {
        Some(a) => a,
        None => return Vec::new(),
    };
    let out: Vec<TestRef> = arr
        .iter()
        .filter_map(|item| {
            let name = item.get("name").and_then(|n| n.as_str())?;
            let path = item.get("path").and_then(|p| p.as_str())?;
            let relationship = item.get("relationship").and_then(|r| r.as_str()).unwrap_or("related");
            Some(TestRef {
                name: name.to_string(),
                file: path.to_string(),
                relationship: relationship.to_string(),
            })
        })
        .collect();
    *intent_cost += out.len() * 40;
    out
}

/// Run `codegraph_find_circular_deps`. If `mentioned_files` is non-empty,
/// filter to only cycles containing those files; otherwise return all.
fn run_circular_deps(
    working_dir: &Path,
    mentioned_files: &[String],
    neighborhoods: &[SymbolNeighborhood],
    max_cycle_length: usize,
    queries: &mut Vec<QueryRecord>,
    intent_cost: &mut usize,
) -> Vec<CycleRef> {
    let result = run_mcp_tool(
        working_dir,
        "codegraph_find_circular_deps",
        json!({ "maxCycleLength": max_cycle_length }),
        queries,
    );
    let Some(v) = result else { return Vec::new() };
    let cycles = v.get("cycles").and_then(|c| c.as_array());
    let arr = match cycles {
        Some(a) => a,
        None => return Vec::new(),
    };
    let nb_files: HashSet<String> = neighborhoods
        .iter()
        .filter_map(|nb| nb.file.as_ref().map(|f| f.replace('\\', "/")))
        .collect();
    let out: Vec<CycleRef> = arr
        .iter()
        .filter_map(|item| {
            let files: Vec<String> = item
                .get("files")
                .and_then(|f| f.as_array())?
                .iter()
                .filter_map(|f| f.as_str().map(|s| s.to_string()))
                .collect();
            if files.is_empty() {
                return None;
            }
            let length = item.get("length").and_then(|l| l.as_u64()).unwrap_or(files.len() as u64) as usize;
            // If mentioned_files is non-empty, filter to cycles touching them.
            if !mentioned_files.is_empty() {
                let mentioned_set: HashSet<String> = mentioned_files.iter().map(|f| f.replace('\\', "/")).collect();
                let touches = files.iter().any(|f| {
                    let f_norm = f.replace('\\', "/");
                    mentioned_set.iter().any(|m| f_norm.ends_with(m.as_str()) || m.ends_with(f_norm.as_str()))
                });
                if !touches {
                    return None;
                }
            }
            // Also include cycles touching neighborhood files.
            if !nb_files.is_empty() {
                let touches = files.iter().any(|f| {
                    let f_norm = f.replace('\\', "/");
                    nb_files.iter().any(|nb| f_norm.ends_with(nb.as_str()) || nb.ends_with(f_norm.as_str()))
                });
                if !touches && !mentioned_files.is_empty() {
                    return None;
                }
            }
            *intent_cost += 60;
            Some(CycleRef { files, length })
        })
        .collect();
    out
}

/// Run `codegraph_find_dead_imports` for mentioned files.
fn run_dead_imports(
    working_dir: &Path,
    mentioned_files: &[String],
    queries: &mut Vec<QueryRecord>,
    intent_cost: &mut usize,
) -> Vec<DeadImportRef> {
    let mut out = Vec::new();
    for file in mentioned_files.iter().take(3) {
        if *intent_cost >= INTENT_QUERY_BUDGET_TOKENS {
            break;
        }
        let result = run_mcp_tool(
            working_dir,
            "codegraph_find_dead_imports",
            json!({ "file": file }),
            queries,
        );
        let Some(v) = result else { continue };
        let dead = v.get("deadImports").and_then(|d| d.as_array());
        if let Some(arr) = dead {
            for item in arr {
                if out.len() >= MAX_DEAD_IMPORTS {
                    break;
                }
                let imported = item.get("importedModule").and_then(|m| m.as_str()).unwrap_or("?");
                let line = item.get("line").and_then(|l| l.as_u64()).map(|n| n as u32);
                out.push(DeadImportRef {
                    file: file.clone(),
                    imported_module: imported.to_string(),
                    line,
                });
                *intent_cost += 30;
            }
        }
    }
    out
}

/// Run `codegraph_find_hot_paths`, filter to mentioned files / neighborhoods.
fn run_hot_paths(
    working_dir: &Path,
    mentioned_files: &[String],
    neighborhoods: &[SymbolNeighborhood],
    queries: &mut Vec<QueryRecord>,
    intent_cost: &mut usize,
) -> Vec<HotPathRef> {
    let result = run_mcp_tool(
        working_dir,
        "codegraph_find_hot_paths",
        json!({ "limit": 20 }),
        queries,
    );
    let Some(v) = result else { return Vec::new() };
    let funcs = v.get("functions").and_then(|f| f.as_array());
    let arr = match funcs {
        Some(a) => a,
        None => return Vec::new(),
    };
    let nb_names: HashSet<&str> = neighborhoods.iter().map(|nb| nb.name.as_str()).collect();
    let mentioned_set: HashSet<String> = mentioned_files.iter().map(|f| f.replace('\\', "/")).collect();
    let out: Vec<HotPathRef> = arr
        .iter()
        .filter_map(|item| {
            let name = item.get("name").and_then(|n| n.as_str())?;
            let path = item.get("path").and_then(|p| p.as_str())?;
            // Filter: symbol name in neighborhoods OR file in mentioned files.
            let in_nb = nb_names.contains(name);
            let in_mentioned = mentioned_set.iter().any(|m| {
                let p_norm = path.replace('\\', "/");
                p_norm.ends_with(m.as_str()) || m.ends_with(p_norm.as_str())
            });
            if !in_nb && !in_mentioned {
                return None;
            }
            let score = item.get("score").and_then(|s| s.as_f64()).unwrap_or(0.0);
            let direct_callers = item.get("directCallers").and_then(|d| d.as_u64()).unwrap_or(0) as usize;
            *intent_cost += 30;
            Some(HotPathRef {
                name: name.to_string(),
                file: path.to_string(),
                score,
                direct_callers,
            })
        })
        .collect();
    out
}

/// Run `codegraph_search_by_error`, filter to mentioned files.
fn run_error_search(
    working_dir: &Path,
    mentioned_files: &[String],
    queries: &mut Vec<QueryRecord>,
    intent_cost: &mut usize,
) -> Vec<PatternMatchRef> {
    let result = run_mcp_tool(
        working_dir,
        "codegraph_search_by_error",
        json!({ "mode": "any", "limit": 20 }),
        queries,
    );
    let Some(v) = result else { return Vec::new() };
    let funcs = v.get("functions").and_then(|f| f.as_array());
    let arr = match funcs {
        Some(a) => a,
        None => return Vec::new(),
    };
    let mentioned_set: HashSet<String> = mentioned_files.iter().map(|f| f.replace('\\', "/")).collect();
    let out: Vec<PatternMatchRef> = arr
        .iter()
        .filter_map(|item| {
            let name = item.get("name").and_then(|n| n.as_str())?;
            let path = item.get("path").and_then(|p| p.as_str())?;
            let in_mentioned = mentioned_set.iter().any(|m| {
                let p_norm = path.replace('\\', "/");
                p_norm.ends_with(m.as_str()) || m.ends_with(p_norm.as_str())
            });
            if !in_mentioned {
                return None;
            }
            let kind = item.get("errorRole").and_then(|k| k.as_str()).unwrap_or("any");
            let line = item.get("lineStart").and_then(|l| l.as_u64()).unwrap_or(0) as u32;
            let matched_in = item.get("errorRole").and_then(|k| k.as_str()).unwrap_or("any");
            *intent_cost += 30;
            Some(PatternMatchRef {
                name: name.to_string(),
                kind: kind.to_string(),
                file: path.to_string(),
                line,
                matched_in: matched_in.to_string(),
            })
        })
        .collect();
    out
}

/// Run `codegraph_memory_search`. Silent failure if embeddings not initialized.
fn run_memory_search(
    working_dir: &Path,
    query: &str,
    queries: &mut Vec<QueryRecord>,
    intent_cost: &mut usize,
) -> Vec<MemoryHit> {
    let result = run_mcp_tool(
        working_dir,
        "codegraph_memory_search",
        json!({ "query": query, "limit": MAX_MEMORY_HITS + 2 }),
        queries,
    );
    let Some(v) = result else { return Vec::new() };
    // Memory search returns results array.
    let results = v.get("results").and_then(|r| r.as_array());
    let arr = match results {
        Some(a) => a,
        None => return Vec::new(),
    };
    arr.iter()
        .filter_map(|item| {
            let memory = item.get("memory")?;
            let title = memory.get("title").and_then(|t| t.as_str())?;
            let kind = memory
                .get("kind")
                .and_then(|k| k.as_str())
                .or_else(|| memory.get("kindDiscriminant").and_then(|k| k.as_str()))
                .unwrap_or("unknown");
            let content = memory.get("content").and_then(|c| c.as_str()).unwrap_or("");
            // Truncate content to ~200 chars.
            let truncated: String = content.chars().take(200).collect();
            let score = item.get("score").and_then(|s| s.as_f64()).unwrap_or(0.0) as f32;
            let related_file = memory
                .get("codeLinks")
                .and_then(|l| l.as_array())
                .and_then(|arr| arr.first())
                .and_then(|link| link.get("nodeId").and_then(|n| n.as_str()))
                .map(|s| s.to_string());
            *intent_cost += 80;
            Some(MemoryHit {
                title: title.to_string(),
                kind: kind.to_string(),
                content: truncated,
                score,
                related_file,
            })
        })
        .collect()
}

// ── Serialization helpers (consumed by turns.rs + prompt_policy.rs) ───────

/// Serialize signals into the `runtime_context["codegraphSignals"]` JSON value.
pub(crate) fn codegraph_signals_to_runtime_value(signals: &CodeGraphSignals) -> Value {
    json!(signals)
}

/// Extract signals from `runtime_context["codegraphSignals"]` (set by turns.rs)
/// for the prompt_policy P6 renderer. Returns None when the key is absent or
/// empty — in which case the P6 section is skipped.
pub(crate) fn extract_codegraph_signals(runtime_context: &Value) -> Option<CodeGraphSignals> {
    let raw = runtime_context.get("codegraphSignals")?;
    if raw.is_null() {
        return None;
    }
    let signals: CodeGraphSignals = serde_json::from_value(raw.clone()).ok()?;
    if signals.has_content() {
        Some(signals)
    } else {
        None
    }
}

/// Render signals into the template-facing JSON value.
pub(crate) fn codegraph_signals_to_template_value(signals: &CodeGraphSignals) -> Value {
    json!(signals)
}

/// Build presearchHints entries from resolved signals. Each neighborhood
/// generates 1 hint pointing at `codegraph_get_ai_context` so the model can
/// pull full detail via tool_fs_run when it wants to act on the symbol.
/// Intent-driven fragments generate additional hints for their corresponding
/// tools.
pub(crate) fn codegraph_presearch_hints_from_signals(signals: &CodeGraphSignals) -> Vec<Value> {
    let mut hints = Vec::new();

    // Neighborhood → get_ai_context hints.
    for nb in &signals.resolved_neighborhoods {
        hints.push(json!({
            "query": nb.name.clone(),
            "path": "/tools/codegraph/get_ai_context",
            "handle": "codegraph_get_ai_context",
            "title": format!("Get AI context for {}", nb.name),
            "domain": "codegraph",
            "operation": "get_ai_context",
            "summary": format!(
                "Pre-fetched neighborhood for `{}` ({}). Call for full callers/callees/tests/memory detail.",
                nb.name, nb.kind
            ),
            "runHint": format!("Use intent=\"modify\" for {}", nb.name),
            "score": 12.0,
            "matchedFields": ["codegraphSignal"],
            "matchReason": "codegraphSignalPresearch",
            "recommendedNextAction": "tool_fs_run",
            "source": "codegraphSignalPresearch"
        }));
    }

    // Impact analysis → analyze_impact hint.
    if let Some(ref impact) = signals.impact_analysis {
        hints.push(json!({
            "query": impact.symbol.clone(),
            "path": "/tools/codegraph/analyze_impact",
            "handle": "codegraph_analyze_impact",
            "title": format!("Impact analysis for {}", impact.symbol),
            "domain": "codegraph",
            "operation": "analyze_impact",
            "summary": format!("Risk: {}, {} direct + {} indirect impacts.", impact.risk_level, impact.direct_impacted, impact.indirect_impacted),
            "score": 10.0,
            "matchedFields": ["codegraphSignal"],
            "matchReason": "codegraphSignalPresearch",
            "recommendedNextAction": "tool_fs_run",
            "source": "codegraphSignalPresearch"
        }));
    }

    // Related tests → find_related_tests hint.
    if !signals.related_tests.is_empty() {
        hints.push(json!({
            "query": signals.resolved_neighborhoods.first().map(|nb| nb.name.clone()).unwrap_or_default(),
            "path": "/tools/codegraph/find_related_tests",
            "handle": "codegraph_find_related_tests",
            "title": "Find related tests",
            "domain": "codegraph",
            "operation": "find_related_tests",
            "summary": format!("{} related test(s) pre-fetched.", signals.related_tests.len()),
            "score": 10.0,
            "matchedFields": ["codegraphSignal"],
            "matchReason": "codegraphSignalPresearch",
            "recommendedNextAction": "tool_fs_run",
            "source": "codegraphSignalPresearch"
        }));
    }

    // Circular deps → find_circular_deps hint.
    if !signals.circular_deps.is_empty() {
        hints.push(json!({
            "query": "circular deps",
            "path": "/tools/codegraph/find_circular_deps",
            "handle": "codegraph_find_circular_deps",
            "title": "Circular dependencies",
            "domain": "codegraph",
            "operation": "find_circular_deps",
            "summary": format!("{} circular dep chain(s) detected.", signals.circular_deps.len()),
            "score": 10.0,
            "matchedFields": ["codegraphSignal"],
            "matchReason": "codegraphSignalPresearch",
            "recommendedNextAction": "tool_fs_run",
            "source": "codegraphSignalPresearch"
        }));
    }

    // Memory hits → memory_search hint.
    if !signals.memory_hits.is_empty() {
        hints.push(json!({
            "query": "memory search",
            "path": "/tools/codegraph/memory_search",
            "handle": "codegraph_memory_search",
            "title": "Search CodeGraph memory",
            "domain": "codegraph",
            "operation": "memory_search",
            "summary": format!("{} memory hit(s) pre-fetched.", signals.memory_hits.len()),
            "score": 10.0,
            "matchedFields": ["codegraphSignal"],
            "matchReason": "codegraphSignalPresearch",
            "recommendedNextAction": "tool_fs_run",
            "source": "codegraphSignalPresearch"
        }));
    }

    hints
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_candidate_symbols_filters_stopwords() {
        let candidates = extract_candidate_symbols("please fix the handleLoginSubmit function");
        // "please", "fix", "the", "function" are filtered; "handleLoginSubmit" remains.
        assert!(candidates.contains(&"handleLoginSubmit".to_string()));
        assert!(!candidates.iter().any(|c| c == "please" || c == "the" || c == "function"));
    }

    #[test]
    fn extract_candidate_symbols_handles_rust_paths() {
        let candidates = extract_candidate_symbols("look at ax_controller::axActOnNode");
        // The trailing segment after `::` is the candidate.
        assert!(candidates.contains(&"axActOnNode".to_string()));
    }

    #[test]
    fn extract_candidate_symbols_dedups() {
        let candidates = extract_candidate_symbols("foo bar foo bar fooBar");
        let lower: Vec<_> = candidates.iter().map(|s| s.to_ascii_lowercase()).collect();
        // Each unique candidate appears once.
        assert_eq!(lower.iter().filter(|s| *s == "foo").count(), 1);
        assert_eq!(lower.iter().filter(|s| *s == "bar").count(), 1);
        assert!(lower.contains(&"foobar".to_string()));
    }

    #[test]
    fn extract_mentioned_files_finds_paths() {
        let files = extract_mentioned_files("edit src/main/agent/codegraph.rs please");
        assert!(files.iter().any(|f| f.contains("codegraph.rs")));
    }

    #[test]
    fn message_signature_is_stable_for_same_input() {
        let dir = Path::new("/tmp/proj");
        let a = message_signature(dir, "Fix the login bug");
        let b = message_signature(dir, "fix  the  login  bug");
        // Whitespace differences normalize to the same signature.
        assert_eq!(a, b);
    }

    #[test]
    fn empty_signals_has_no_content() {
        let s = CodeGraphSignals::default();
        assert!(!s.has_content());
    }

    #[test]
    fn signals_with_neighborhood_has_content() {
        let s = CodeGraphSignals {
            resolved_neighborhoods: vec![SymbolNeighborhood {
                name: "foo".to_string(),
                kind: "function".to_string(),
                ..Default::default()
            }],
            ..Default::default()
        };
        assert!(s.has_content());
    }

    #[test]
    fn presearch_hints_empty_when_no_neighborhoods() {
        let s = CodeGraphSignals::default();
        assert!(codegraph_presearch_hints_from_signals(&s).is_empty());
    }

    #[test]
    fn presearch_hints_generated_for_each_neighborhood() {
        let s = CodeGraphSignals {
            resolved_neighborhoods: vec![
                SymbolNeighborhood {
                    name: "foo".to_string(),
                    kind: "function".to_string(),
                    ..Default::default()
                },
                SymbolNeighborhood {
                    name: "bar".to_string(),
                    kind: "class".to_string(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let hints = codegraph_presearch_hints_from_signals(&s);
        assert_eq!(hints.len(), 2);
        assert_eq!(hints[0]["source"], "codegraphSignalPresearch");
        assert_eq!(hints[1]["handle"], "codegraph_get_ai_context");
    }

    #[test]
    fn fragment_report_marks_dropped_symbols() {
        let s = CodeGraphSignals {
            mentioned_symbols: vec!["foo".to_string(), "bar".to_string(), "baz".to_string()],
            resolved_neighborhoods: vec![SymbolNeighborhood {
                name: "foo".to_string(),
                kind: "function".to_string(),
                ..Default::default()
            }],
            ..Default::default()
        };
        let report = s.fragment_report(800);
        assert_eq!(report.symbols_resolved, 1);
        assert!(report.dropped_symbols.contains(&"bar".to_string()));
        assert!(report.dropped_symbols.contains(&"baz".to_string()));
        assert!(!report.dropped_symbols.contains(&"foo".to_string()));
    }

    // ── Intent detection tests ──

    #[test]
    fn detect_intent_edit_chinese() {
        assert_eq!(detect_intent("修复登录bug"), MessageIntent::Debug); // "bug" + "修复" → Debug wins
    }

    #[test]
    fn detect_intent_edit_english() {
        assert_eq!(detect_intent("update the config file"), MessageIntent::Edit);
    }

    #[test]
    fn detect_intent_refactor() {
        assert_eq!(detect_intent("重构这个模块"), MessageIntent::Refactor);
        assert_eq!(detect_intent("refactor the auth service"), MessageIntent::Refactor);
    }

    #[test]
    fn detect_intent_test() {
        assert_eq!(detect_intent("跑一下测试"), MessageIntent::Test);
        assert_eq!(detect_intent("add unit test for login"), MessageIntent::Test);
    }

    #[test]
    fn detect_intent_debug() {
        assert_eq!(detect_intent("报错了"), MessageIntent::Debug);
        assert_eq!(detect_intent("this throws an error"), MessageIntent::Debug);
    }

    #[test]
    fn detect_intent_optimize() {
        assert_eq!(detect_intent("优化性能"), MessageIntent::Optimize);
        assert_eq!(detect_intent("make it faster"), MessageIntent::Optimize);
    }

    #[test]
    fn detect_intent_cleanup() {
        assert_eq!(detect_intent("清理死代码"), MessageIntent::Cleanup);
        assert_eq!(detect_intent("remove unused imports"), MessageIntent::Cleanup);
    }

    #[test]
    fn detect_intent_architecture() {
        assert_eq!(detect_intent("看下架构"), MessageIntent::Architecture);
        assert_eq!(detect_intent("check circular deps"), MessageIntent::Architecture);
    }

    #[test]
    fn detect_intent_other() {
        assert_eq!(detect_intent("你好"), MessageIntent::Other);
        assert_eq!(detect_intent("hello world"), MessageIntent::Other);
    }

    #[test]
    fn has_content_with_impact() {
        let s = CodeGraphSignals {
            impact_analysis: Some(ImpactSummary {
                symbol: "foo".to_string(),
                risk_level: "high".to_string(),
                direct_impacted: 5,
                ..Default::default()
            }),
            ..Default::default()
        };
        assert!(s.has_content());
    }

    #[test]
    fn has_content_with_file_symbols() {
        let s = CodeGraphSignals {
            file_symbols: vec![FileSymbolSummary {
                name: "foo".to_string(),
                kind: "function".to_string(),
                file: "src/foo.ts".to_string(),
                line: 1,
                visibility: "public".to_string(),
            }],
            ..Default::default()
        };
        assert!(s.has_content());
    }

    #[test]
    fn empty_signals_intent_is_other() {
        let s = CodeGraphSignals::default();
        assert_eq!(s.intent, "other");
    }

    #[test]
    fn presearch_hints_include_intent_fragments() {
        let s = CodeGraphSignals {
            resolved_neighborhoods: vec![SymbolNeighborhood {
                name: "foo".to_string(),
                kind: "function".to_string(),
                ..Default::default()
            }],
            impact_analysis: Some(ImpactSummary {
                symbol: "foo".to_string(),
                risk_level: "medium".to_string(),
                direct_impacted: 3,
                indirect_impacted: 2,
                ..Default::default()
            }),
            related_tests: vec![TestRef {
                name: "test_foo".to_string(),
                file: "tests/foo.test.ts".to_string(),
                relationship: "calls_target".to_string(),
            }],
            ..Default::default()
        };
        let hints = codegraph_presearch_hints_from_signals(&s);
        // 1 neighborhood + 1 impact + 1 tests = 3 hints.
        assert_eq!(hints.len(), 3);
        assert!(hints.iter().any(|h| h["handle"] == "codegraph_get_ai_context"));
        assert!(hints.iter().any(|h| h["handle"] == "codegraph_analyze_impact"));
        assert!(hints.iter().any(|h| h["handle"] == "codegraph_find_related_tests"));
    }
}