use crossbeam_channel::Receiver;
use crossbeam_channel::Sender;
use crossbeam_channel::after;
use crossbeam_channel::never;
use crossbeam_channel::select;
use crossbeam_channel::unbounded;
use ignore::WalkBuilder;
use ignore::overrides::OverrideBuilder;
use nucleo::Config;
use nucleo::Injector;
use nucleo::Matcher;
use nucleo::Nucleo;
use nucleo::Utf32String;
use nucleo::pattern::CaseMatching;
use nucleo::pattern::Normalization;
use serde::Serialize;
use std::num::NonZero;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Condvar;
use std::sync::Mutex;
use std::sync::RwLock;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;
use tokio::process::Command;

#[cfg(test)]
use nucleo::Utf32Str;
#[cfg(test)]
use nucleo::pattern::AtomKind;
#[cfg(test)]
use nucleo::pattern::Pattern;

mod cli;
mod local;
mod native;

pub use cli::Cli;
pub use local::*;

/// A single match result returned from the search.
///
/// * `score` – Relevance score returned by `nucleo`.
/// * `path`  – Path to the matched entry (file or directory), relative to the
///   search directory.
/// * `match_type` – Whether this match is a file or directory.
/// * `indices` – Optional list of character indices that matched the query.
///   These are only filled when the caller of [`run`] sets
///   `options.compute_indices` to `true`. The indices vector follows the
///   guidance from `nucleo::pattern::Pattern::indices`: they are
///   unique and sorted in ascending order so that callers can use
///   them directly for highlighting.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FileMatch {
    pub score: u32,
    pub path: PathBuf,
    pub match_type: MatchType,
    pub root: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indices: Option<Vec<u32>>, // Sorted & deduplicated when present
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MatchType {
    File,
    Directory,
}

impl FileMatch {
    pub fn full_path(&self) -> PathBuf {
        self.root.join(&self.path)
    }
}

/// Returns the final path component for a matched path, falling back to the full path.
pub fn file_name_from_path(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

#[derive(Debug)]
pub struct FileSearchResults {
    pub matches: Vec<FileMatch>,
    pub total_match_count: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
pub struct FileSearchSnapshot {
    pub query: String,
    pub matches: Vec<FileMatch>,
    pub total_match_count: usize,
    pub scanned_file_count: usize,
    pub walk_complete: bool,
}

#[derive(Debug, Clone)]
pub struct FileSearchOptions {
    pub limit: NonZero<usize>,
    pub exclude: Vec<String>,
    pub threads: NonZero<usize>,
    pub compute_indices: bool,
    /// Toggle ignore-file processing in the walker.
    ///
    /// When enabled, `.gitignore` files are scoped by
    /// `WalkBuilder::require_git(true)`, so they are honored only when the
    /// traversed path is inside a git repository. When disabled, the walker
    /// turns off `.gitignore`, git-global/exclude rules, `.ignore`, and
    /// parent-directory ignore scanning.
    pub respect_gitignore: bool,
}

const INITIAL_CANDIDATE_SCORE_BASE: u32 = 1_000_000;
const INITIAL_CANDIDATE_RANK_STEP: u32 = 100_000;
const INITIAL_CANDIDATE_DEPTH_STEP: u32 = 1_000;
const FILENAME_EXACT_MATCH_BONUS: u32 = 300_000;
const FILENAME_PREFIX_MATCH_BONUS: u32 = 240_000;
const FILENAME_SUBSTRING_MATCH_BONUS: u32 = 180_000;
const FILENAME_TOKEN_MATCH_BONUS: u32 = 130_000;
const FILENAME_FUZZY_MATCH_BONUS: u32 = 70_000;
const FUZZY_CANDIDATE_RERANK_MULTIPLIER: usize = 4;

const COMMON_PROJECT_ENTRY_NAMES: &[&str] = &[
    ".env",
    ".env.example",
    ".gitignore",
    "BUILD.bazel",
    "Cargo.toml",
    "Gemfile",
    "go.mod",
    "Makefile",
    "package.json",
    "pnpm-workspace.yaml",
    "pom.xml",
    "pyproject.toml",
    "README",
    "README.md",
    "requirements.txt",
    "settings.gradle",
    "tsconfig.json",
    "vite.config.js",
    "vite.config.mjs",
    "vite.config.ts",
];

const SHALLOW_RECOMMENDED_EXTENSIONS: &[&str] = &[
    "c", "cc", "cpp", "cs", "css", "go", "h", "hpp", "html", "java", "js", "jsx", "json", "kt",
    "md", "mjs", "py", "rs", "swift", "toml", "ts", "tsx", "xml", "yaml", "yml",
];

impl Default for FileSearchOptions {
    fn default() -> Self {
        Self {
            #[expect(clippy::unwrap_used)]
            limit: NonZero::new(20).unwrap(),
            exclude: Vec::new(),
            #[expect(clippy::unwrap_used)]
            threads: NonZero::new(2).unwrap(),
            compute_indices: false,
            respect_gitignore: true,
        }
    }
}

pub trait SessionReporter: Send + Sync + 'static {
    /// Called when the debounced top-N changes.
    fn on_update(&self, snapshot: &FileSearchSnapshot);

    /// Called when the session becomes idle or is cancelled. Guaranteed to be called at least once per update_query.
    fn on_complete(&self);
}

pub struct FileSearchSession {
    inner: Arc<SessionInner>,
}

impl FileSearchSession {
    /// Update the query. This should be cheap relative to re-walking.
    pub fn update_query(&self, pattern_text: &str) {
        let _ = self
            .inner
            .work_tx
            .send(WorkSignal::QueryUpdated(pattern_text.to_string()));
    }
}

impl Drop for FileSearchSession {
    fn drop(&mut self) {
        self.inner.shutdown.store(true, Ordering::Relaxed);
        let _ = self.inner.work_tx.send(WorkSignal::Shutdown);
    }
}

pub fn create_session(
    search_directories: Vec<PathBuf>,
    options: FileSearchOptions,
    reporter: Arc<dyn SessionReporter>,
    cancel_flag: Option<Arc<AtomicBool>>,
) -> anyhow::Result<FileSearchSession> {
    let FileSearchOptions {
        limit,
        exclude,
        threads,
        compute_indices,
        respect_gitignore,
    } = options;

    let Some(primary_search_directory) = search_directories.first() else {
        anyhow::bail!("at least one search directory is required");
    };
    let override_matcher = build_override_matcher(primary_search_directory, &exclude)?;
    let (work_tx, work_rx) = unbounded();

    let notify_tx = work_tx.clone();
    let notify = Arc::new(move || {
        let _ = notify_tx.send(WorkSignal::NucleoNotify);
    });
    let nucleo = Nucleo::new(
        Config::DEFAULT.match_paths(),
        notify,
        Some(threads.get()),
        1,
    );
    let injector = nucleo.injector();

    let cancelled = cancel_flag.unwrap_or_else(|| Arc::new(AtomicBool::new(false)));

    let inner = Arc::new(SessionInner {
        search_directories,
        limit: limit.get(),
        threads: threads.get(),
        compute_indices,
        respect_gitignore,
        cancelled,
        shutdown: Arc::new(AtomicBool::new(false)),
        reporter,
        work_tx,
    });

    let matcher_inner = inner.clone();
    thread::spawn(move || matcher_worker(matcher_inner, work_rx, nucleo));

    let walker_inner = inner.clone();
    thread::spawn(move || walker_worker(walker_inner, override_matcher, injector));

    Ok(FileSearchSession { inner })
}

pub trait Reporter {
    fn report_match(&self, file_match: &FileMatch);
    fn warn_matches_truncated(&self, total_match_count: usize, shown_match_count: usize);
    fn warn_no_search_pattern(&self, search_directory: &Path);
}

pub async fn run_main<T: Reporter>(
    Cli {
        pattern,
        limit,
        cwd,
        compute_indices,
        json: _,
        exclude,
        threads,
    }: Cli,
    reporter: T,
) -> anyhow::Result<()> {
    let search_directory = match cwd {
        Some(dir) => dir,
        None => std::env::current_dir()?,
    };
    let pattern_text = match pattern {
        Some(pattern) => pattern,
        None => {
            reporter.warn_no_search_pattern(&search_directory);
            #[cfg(unix)]
            Command::new("ls")
                .arg("-al")
                .current_dir(search_directory)
                .stdout(std::process::Stdio::inherit())
                .stderr(std::process::Stdio::inherit())
                .status()
                .await?;
            #[cfg(windows)]
            {
                Command::new("cmd")
                    .arg("/c")
                    .arg(search_directory)
                    .stdout(std::process::Stdio::inherit())
                    .stderr(std::process::Stdio::inherit())
                    .status()
                    .await?;
            }
            return Ok(());
        }
    };

    let _ = threads;
    let engine = LocalSearchEngine::new();
    engine.index_root(
        LocalSearchIndexRootOptions {
            root: search_directory.to_path_buf(),
            include_hidden: false,
            include_vendor: false,
            respect_gitignore: true,
            content_mode: LocalSearchContentMode::Auto,
            max_file_size_bytes: 256 * 1024,
        },
        None,
    )?;
    let response = engine.search(
        LocalSearchOptions {
            query: pattern_text.clone(),
            roots: vec![search_directory.to_path_buf()],
            kinds: vec![LocalSearchKind::File, LocalSearchKind::Directory],
            extensions: Vec::new(),
            limit: limit.get(),
            include_hidden: false,
            include_vendor: false,
            respect_gitignore: true,
            content_mode: LocalSearchContentMode::Auto,
            max_file_size_bytes: 256 * 1024,
            enable_fuzzy: true,
            enable_extension_match: true,
            query_mode: LocalSearchQueryMode::Normal,
        },
        None,
    )?;
    let total_match_count = response.total_match_count;
    let mut matches = Vec::new();
    for result in response.results {
        let relative = result
            .path
            .strip_prefix(&search_directory)
            .map(Path::to_path_buf)
            .unwrap_or_else(|_| result.path.clone());
        let relative_text = relative.to_string_lossy();
        if exclude.iter().any(|pattern| relative_text.contains(pattern)) {
            continue;
        }
        matches.push(FileMatch {
            score: result.score,
            path: relative,
            match_type: match result.kind {
                LocalSearchKind::File => MatchType::File,
                LocalSearchKind::Directory => MatchType::Directory,
            },
            root: search_directory.to_path_buf(),
            indices: compute_indices.then(Vec::new),
        });
    }
    let match_count = matches.len();
    let matches_truncated = total_match_count > match_count;

    for file_match in matches {
        reporter.report_match(&file_match);
    }
    if matches_truncated {
        reporter.warn_matches_truncated(total_match_count, match_count);
    }

    Ok(())
}

/// The worker threads will periodically check `cancel_flag` to see if they
/// should stop processing files.
pub fn run(
    pattern_text: &str,
    roots: Vec<PathBuf>,
    options: FileSearchOptions,
    cancel_flag: Option<Arc<AtomicBool>>,
) -> anyhow::Result<FileSearchResults> {
    let reporter = Arc::new(RunReporter::default());
    let session = create_session(roots, options, reporter.clone(), cancel_flag)?;

    session.update_query(pattern_text);

    let snapshot = reporter.wait_for_complete();
    Ok(FileSearchResults {
        matches: snapshot.matches,
        total_match_count: snapshot.total_match_count,
    })
}

/// Sort matches in-place by descending score, then ascending path.
#[cfg(test)]
fn sort_matches(matches: &mut [(u32, String)]) {
    matches.sort_by(cmp_by_score_desc_then_path_asc::<(u32, String), _, _>(
        |t| t.0,
        |t| t.1.as_str(),
    ));
}

/// Returns a comparator closure suitable for `slice.sort_by(...)` that orders
/// items by descending score and then ascending path using the provided accessors.
pub fn cmp_by_score_desc_then_path_asc<T, FScore, FPath>(
    score_of: FScore,
    path_of: FPath,
) -> impl FnMut(&T, &T) -> std::cmp::Ordering
where
    FScore: Fn(&T) -> u32,
    FPath: Fn(&T) -> &str,
{
    use std::cmp::Ordering;
    move |a, b| match score_of(b).cmp(&score_of(a)) {
        Ordering::Equal => path_of(a).cmp(path_of(b)),
        other => other,
    }
}

#[cfg(test)]
fn create_pattern(pattern: &str) -> Pattern {
    Pattern::new(
        pattern,
        CaseMatching::Ignore,
        Normalization::Smart,
        AtomKind::Fuzzy,
    )
}

struct SessionInner {
    search_directories: Vec<PathBuf>,
    limit: usize,
    threads: usize,
    compute_indices: bool,
    respect_gitignore: bool,
    cancelled: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
    reporter: Arc<dyn SessionReporter>,
    work_tx: Sender<WorkSignal>,
}

enum WorkSignal {
    QueryUpdated(String),
    NucleoNotify,
    WalkComplete,
    Shutdown,
}

fn build_override_matcher(
    search_directory: &Path,
    exclude: &[String],
) -> anyhow::Result<Option<ignore::overrides::Override>> {
    if exclude.is_empty() {
        return Ok(None);
    }
    let mut override_builder = OverrideBuilder::new(search_directory);
    for exclude in exclude {
        let exclude_pattern = format!("!{exclude}");
        override_builder.add(&exclude_pattern)?;
    }
    let matcher = override_builder.build()?;
    Ok(Some(matcher))
}

fn get_file_path<'a>(path: &'a Path, search_directories: &[PathBuf]) -> Option<(usize, &'a str)> {
    let mut best_match: Option<(usize, &Path)> = None;
    for (idx, root) in search_directories.iter().enumerate() {
        if let Ok(rel_path) = path.strip_prefix(root) {
            let root_depth = root.components().count();
            match best_match {
                Some((best_idx, _))
                    if search_directories[best_idx].components().count() >= root_depth => {}
                _ => {
                    best_match = Some((idx, rel_path));
                }
            }
        }
    }

    let (root_idx, rel_path) = best_match?;
    rel_path.to_str().map(|p| (root_idx, p))
}

fn path_component_count(path: &Path) -> usize {
    path.components().count()
}

fn file_name_eq_ignore_ascii_case(path: &Path, candidates: &[&str]) -> bool {
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    candidates
        .iter()
        .any(|candidate| file_name.eq_ignore_ascii_case(candidate))
}

fn extension_is_shallow_recommended(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|extension| extension.to_str()) else {
        return false;
    };
    SHALLOW_RECOMMENDED_EXTENSIONS
        .iter()
        .any(|candidate| extension.eq_ignore_ascii_case(candidate))
}

fn is_common_project_entry(path: &Path) -> bool {
    file_name_eq_ignore_ascii_case(path, COMMON_PROJECT_ENTRY_NAMES)
        || path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.to_ascii_lowercase().starts_with("readme."))
}

fn initial_candidate_rank(path: &Path, match_type: MatchType) -> Option<(u8, usize)> {
    let depth = path_component_count(path);
    if depth == 0 {
        return None;
    }
    let is_project_entry = is_common_project_entry(path);
    if is_project_entry {
        return Some((if depth == 1 { 0 } else { 2 }, depth));
    }
    if depth == 1 {
        return Some((1, depth));
    }
    if match_type == MatchType::File && depth <= 3 && extension_is_shallow_recommended(path) {
        return Some((3, depth));
    }
    None
}

fn initial_candidate_score(rank: u8, depth: usize) -> u32 {
    INITIAL_CANDIDATE_SCORE_BASE
        .saturating_sub(u32::from(rank) * INITIAL_CANDIDATE_RANK_STEP)
        .saturating_sub((depth as u32) * INITIAL_CANDIDATE_DEPTH_STEP)
}

fn collect_initial_candidates(
    snapshot: &nucleo::Snapshot<Arc<str>>,
    search_directories: &[PathBuf],
    limit: usize,
    compute_indices: bool,
) -> Vec<FileMatch> {
    let mut matches = snapshot
        .matches()
        .iter()
        .filter_map(|match_| {
            let item = snapshot.get_item(match_.idx)?;
            let full_path = item.data.as_ref();
            let (root_idx, relative_path) =
                get_file_path(Path::new(full_path), search_directories)?;
            if relative_path.is_empty() {
                return None;
            }
            let path = PathBuf::from(relative_path);
            let match_type = if Path::new(full_path).is_dir() {
                MatchType::Directory
            } else {
                MatchType::File
            };
            let (rank, depth) = initial_candidate_rank(&path, match_type)?;
            Some((
                rank,
                depth,
                match_type,
                FileMatch {
                    score: initial_candidate_score(rank, depth),
                    path,
                    match_type,
                    root: search_directories[root_idx].clone(),
                    indices: compute_indices.then(Vec::new),
                },
            ))
        })
        .collect::<Vec<_>>();

    matches.sort_by(
        |(left_rank, left_depth, left_type, left), (right_rank, right_depth, right_type, right)| {
            left_rank
                .cmp(right_rank)
                .then_with(|| left_depth.cmp(right_depth))
                .then_with(|| match (left_type, right_type) {
                    (MatchType::Directory, MatchType::File) => std::cmp::Ordering::Less,
                    (MatchType::File, MatchType::Directory) => std::cmp::Ordering::Greater,
                    _ => std::cmp::Ordering::Equal,
                })
                .then_with(|| left.path.cmp(&right.path))
        },
    );

    matches
        .into_iter()
        .map(|(_, _, _, file_match)| file_match)
        .take(limit)
        .collect()
}

fn normalized_file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_lowercase()
}

fn normalized_file_stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_lowercase()
}

fn query_tokens(query: &str) -> Vec<String> {
    query
        .split(|ch: char| ch.is_whitespace() || matches!(ch, '/' | '\\' | '-' | '_' | '.'))
        .map(str::trim)
        .filter(|token| token.len() > 1)
        .map(str::to_lowercase)
        .collect()
}

fn fuzzy_subsequence_gap_count(needle: &str, haystack: &str) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }

    let mut gaps = 0usize;
    let mut previous_match: Option<usize> = None;
    let mut haystack_chars = haystack.chars().enumerate();
    for needle_char in needle.chars() {
        let (index, _) = haystack_chars.find(|(_, haystack_char)| *haystack_char == needle_char)?;
        if let Some(previous_index) = previous_match
            && index > previous_index + 1
        {
            gaps += 1;
        }
        previous_match = Some(index);
    }
    Some(gaps)
}

fn filename_match_bonus(path: &Path, query: &str, match_type: MatchType) -> u32 {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return 0;
    }

    let file_name = normalized_file_name(path);
    if file_name.is_empty() {
        return 0;
    }
    let file_stem = normalized_file_stem(path);
    let targets = [file_name.as_str(), file_stem.as_str()];

    let bonus = if targets.iter().any(|target| *target == query) {
        FILENAME_EXACT_MATCH_BONUS
    } else if targets.iter().any(|target| target.starts_with(&query)) {
        FILENAME_PREFIX_MATCH_BONUS
    } else if targets.iter().any(|target| target.contains(&query)) {
        FILENAME_SUBSTRING_MATCH_BONUS
    } else {
        let tokens = query_tokens(&query);
        if !tokens.is_empty()
            && targets
                .iter()
                .any(|target| tokens.iter().all(|token| target.contains(token)))
        {
            FILENAME_TOKEN_MATCH_BONUS
        } else {
            targets
                .iter()
                .filter_map(|target| fuzzy_subsequence_gap_count(&query, target))
                .min()
                .map(|gaps| {
                    FILENAME_FUZZY_MATCH_BONUS.saturating_sub((gaps as u32).saturating_mul(1_000))
                })
                .unwrap_or(0)
        }
    };

    if match_type == MatchType::Directory {
        return bonus / 2;
    }
    bonus
}

fn collect_fuzzy_matches(
    snapshot: &nucleo::Snapshot<Arc<str>>,
    search_directories: &[PathBuf],
    limit: usize,
    query: &str,
    compute_indices: bool,
    indices_matcher: &mut Option<Matcher>,
) -> Vec<FileMatch> {
    let pattern = snapshot.pattern().column_pattern(0);
    let candidate_limit = limit
        .saturating_mul(FUZZY_CANDIDATE_RERANK_MULTIPLIER)
        .max(limit);
    let mut matches = snapshot
        .matches()
        .iter()
        .take(candidate_limit)
        .filter_map(|match_| {
            let item = snapshot.get_item(match_.idx)?;
            let full_path = item.data.as_ref();
            let (root_idx, relative_path) =
                get_file_path(Path::new(full_path), search_directories)?;
            if relative_path.is_empty() {
                return None;
            }
            let indices = if compute_indices {
                indices_matcher.as_mut().map(|indices_matcher| {
                    let mut idx_vec = Vec::<u32>::new();
                    let haystack = item.matcher_columns[0].slice(..);
                    let _ = pattern.indices(haystack, indices_matcher, &mut idx_vec);
                    idx_vec.sort_unstable();
                    idx_vec.dedup();
                    idx_vec
                })
            } else {
                None
            };
            let match_type = if Path::new(full_path).is_dir() {
                MatchType::Directory
            } else {
                MatchType::File
            };
            Some(FileMatch {
                score: match_.score.saturating_add(filename_match_bonus(
                    Path::new(relative_path),
                    query,
                    match_type,
                )),
                path: PathBuf::from(relative_path),
                match_type,
                root: search_directories[root_idx].clone(),
                indices,
            })
        })
        .collect::<Vec<_>>();

    matches.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.path.cmp(&right.path))
    });
    matches.truncate(limit);
    matches
}

/// Walks the search directories and feeds discovered paths into `nucleo`
/// via the injector.
///
/// The walker uses `require_git(true)` to match git's own ignore semantics:
/// git never reads `.gitignore` files from directories above the repository
/// root. Without this flag, the `ignore` crate reads `.gitignore` files from
/// *all* ancestor directories—a deliberate divergence from git intended for
/// non-git use cases—allowing a broad parent ignore (e.g. `~/.gitignore`
/// containing `*`) to silently suppress every file in the walk.
///
/// When `respect_gitignore` is `false`, all git-related ignore processing is
/// disabled regardless of this flag.
fn walker_worker(
    inner: Arc<SessionInner>,
    override_matcher: Option<ignore::overrides::Override>,
    injector: Injector<Arc<str>>,
) {
    let Some(first_root) = inner.search_directories.first() else {
        let _ = inner.work_tx.send(WorkSignal::WalkComplete);
        return;
    };

    let mut walk_builder = WalkBuilder::new(first_root);
    for root in inner.search_directories.iter().skip(1) {
        walk_builder.add(root);
    }
    walk_builder
        .threads(inner.threads)
        // Allow hidden entries.
        .hidden(false)
        // Do not follow symlinks during broad fallback walks; indexed search also
        // avoids links, and following them can turn home-directory scans into
        // unbounded traversals through mirrored app containers.
        .follow_links(false)
        // Keep ignore behavior aligned with git repositories: only apply
        // gitignore rules when a git context exists.
        .require_git(true);
    if !inner.respect_gitignore {
        walk_builder
            .git_ignore(false)
            .git_global(false)
            .git_exclude(false)
            .ignore(false)
            .parents(false);
    }
    if let Some(override_matcher) = override_matcher {
        walk_builder.overrides(override_matcher);
    }

    let walker = walk_builder.build_parallel();

    walker.run(|| {
        const CHECK_INTERVAL: usize = 1024;
        let mut n = 0;
        let search_directories = inner.search_directories.clone();
        let injector = injector.clone();
        let cancelled = inner.cancelled.clone();
        let shutdown = inner.shutdown.clone();

        Box::new(move |entry| {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => return ignore::WalkState::Continue,
            };
            let path = entry.path();
            let Some(full_path) = path.to_str() else {
                return ignore::WalkState::Continue;
            };
            if let Some((_, relative_path)) = get_file_path(path, &search_directories)
                && !relative_path.is_empty()
            {
                injector.push(Arc::from(full_path), |_, cols| {
                    cols[0] = Utf32String::from(relative_path);
                });
            }
            n += 1;
            if n >= CHECK_INTERVAL {
                if cancelled.load(Ordering::Relaxed) || shutdown.load(Ordering::Relaxed) {
                    return ignore::WalkState::Quit;
                }
                n = 0;
            }
            ignore::WalkState::Continue
        })
    });
    let _ = inner.work_tx.send(WorkSignal::WalkComplete);
}

fn matcher_worker(
    inner: Arc<SessionInner>,
    work_rx: Receiver<WorkSignal>,
    mut nucleo: Nucleo<Arc<str>>,
) -> anyhow::Result<()> {
    const TICK_TIMEOUT_MS: u64 = 10;
    let config = Config::DEFAULT.match_paths();
    let mut indices_matcher = inner.compute_indices.then(|| Matcher::new(config.clone()));
    let cancel_requested = || inner.cancelled.load(Ordering::Relaxed);
    let shutdown_requested = || inner.shutdown.load(Ordering::Relaxed);

    let mut last_query = String::new();
    let mut next_notify = never();
    let mut will_notify = false;
    let mut force_report_without_change = false;
    let mut walk_complete = false;

    loop {
        select! {
            recv(work_rx) -> signal => {
                let Ok(signal) = signal else {
                    break;
                };
                match signal {
                    WorkSignal::QueryUpdated(query) => {
                        let query_changed = query != last_query;
                        let append = query.starts_with(&last_query);
                        nucleo.pattern.reparse(
                            0,
                            &query,
                            CaseMatching::Ignore,
                            Normalization::Smart,
                            append,
                        );
                        last_query = query;
                        force_report_without_change = !query_changed;
                        will_notify = true;
                        next_notify = after(Duration::from_millis(0));
                    }
                    WorkSignal::NucleoNotify => {
                        if !will_notify {
                            will_notify = true;
                            next_notify = after(Duration::from_millis(TICK_TIMEOUT_MS));
                        }
                    }
                    WorkSignal::WalkComplete => {
                        walk_complete = true;
                        if !will_notify {
                            will_notify = true;
                            next_notify = after(Duration::from_millis(0));
                        }
                    }
                    WorkSignal::Shutdown => {
                        break;
                    }
                }
            }
            recv(next_notify) -> _ => {
                will_notify = false;
                let status = nucleo.tick(TICK_TIMEOUT_MS);
                if status.changed || force_report_without_change {
                    force_report_without_change = false;
                    let snapshot = nucleo.snapshot();
                    let limit = inner.limit.min(snapshot.matched_item_count() as usize);
                    let matches = if last_query.is_empty() {
                        collect_initial_candidates(
                            snapshot,
                            &inner.search_directories,
                            limit,
                            inner.compute_indices,
                        )
                    } else {
                        collect_fuzzy_matches(
                            snapshot,
                            &inner.search_directories,
                            limit,
                            &last_query,
                            inner.compute_indices,
                            &mut indices_matcher,
                        )
                    };

                    let snapshot = FileSearchSnapshot {
                        query: last_query.clone(),
                        matches,
                        total_match_count: snapshot.matched_item_count() as usize,
                        scanned_file_count: snapshot.item_count() as usize,
                        walk_complete,
                    };
                    inner.reporter.on_update(&snapshot);
                }
                if !status.running && walk_complete {
                    inner.reporter.on_complete();
                }
            }
            default(Duration::from_millis(100)) => {
                // Occasionally check the cancel flag.
            }
        }

        if cancel_requested() || shutdown_requested() {
            break;
        }
    }

    // If we cancelled or otherwise exited the loop, make sure the reporter is notified.
    inner.reporter.on_complete();

    Ok(())
}

#[derive(Default)]
struct RunReporter {
    snapshot: RwLock<FileSearchSnapshot>,
    completed: (Condvar, Mutex<bool>),
}

impl SessionReporter for RunReporter {
    fn on_update(&self, snapshot: &FileSearchSnapshot) {
        #[allow(clippy::unwrap_used)]
        let mut guard = self.snapshot.write().unwrap();
        *guard = snapshot.clone();
    }

    fn on_complete(&self) {
        let (cv, mutex) = &self.completed;
        #[allow(clippy::unwrap_used)]
        let mut completed = mutex.lock().unwrap();
        *completed = true;
        cv.notify_all();
    }
}

impl RunReporter {
    fn wait_for_complete(&self) -> FileSearchSnapshot {
        let (cv, mutex) = &self.completed;
        #[allow(clippy::unwrap_used)]
        let mut completed = mutex.lock().unwrap();
        while !*completed {
            #[allow(clippy::unwrap_used)]
            {
                completed = cv.wait(completed).unwrap();
            }
        }
        #[allow(clippy::unwrap_used)]
        self.snapshot.read().unwrap().clone()
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;
    use pretty_assertions::assert_eq;
    use std::fs;
    use std::sync::Arc;
    use std::sync::Condvar;
    use std::sync::Mutex;
    use std::sync::atomic::AtomicBool;
    use std::thread;
    use std::time::Duration;
    use std::time::Instant;
    use tempfile::TempDir;

    #[test]
    fn verify_score_is_none_for_non_match() {
        let mut utf32buf = Vec::<char>::new();
        let line = "hello";
        let mut matcher = Matcher::new(Config::DEFAULT);
        let haystack: Utf32Str<'_> = Utf32Str::new(line, &mut utf32buf);
        let pattern = create_pattern("zzz");
        let score = pattern.score(haystack, &mut matcher);
        assert_eq!(score, None);
    }

    #[test]
    fn tie_breakers_sort_by_path_when_scores_equal() {
        let mut matches = vec![
            (100, "b_path".to_string()),
            (100, "a_path".to_string()),
            (90, "zzz".to_string()),
        ];

        sort_matches(&mut matches);

        // Highest score first; ties broken alphabetically.
        let expected = vec![
            (100, "a_path".to_string()),
            (100, "b_path".to_string()),
            (90, "zzz".to_string()),
        ];

        assert_eq!(matches, expected);
    }

    #[test]
    fn file_name_from_path_uses_basename() {
        assert_eq!(file_name_from_path("foo/bar.txt"), "bar.txt");
    }

    #[test]
    fn file_name_from_path_falls_back_to_full_path() {
        assert_eq!(file_name_from_path(""), "");
    }

    #[derive(Default)]
    struct RecordingReporter {
        updates: Mutex<Vec<FileSearchSnapshot>>,
        complete_times: Mutex<Vec<Instant>>,
        complete_cv: Condvar,
        update_cv: Condvar,
    }

    impl RecordingReporter {
        fn wait_until<T, F>(
            &self,
            mutex: &Mutex<T>,
            cv: &Condvar,
            timeout: Duration,
            mut predicate: F,
        ) -> bool
        where
            F: FnMut(&T) -> bool,
        {
            let deadline = Instant::now() + timeout;
            let mut state = mutex.lock().unwrap();
            loop {
                if predicate(&state) {
                    return true;
                }
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return false;
                }
                let (next_state, wait_result) = cv.wait_timeout(state, remaining).unwrap();
                state = next_state;
                if wait_result.timed_out() {
                    return predicate(&state);
                }
            }
        }

        fn wait_for_complete(&self, timeout: Duration) -> bool {
            self.wait_until(
                &self.complete_times,
                &self.complete_cv,
                timeout,
                |completes| !completes.is_empty(),
            )
        }
        fn clear(&self) {
            self.updates.lock().unwrap().clear();
            self.complete_times.lock().unwrap().clear();
        }

        fn updates(&self) -> Vec<FileSearchSnapshot> {
            self.updates.lock().unwrap().clone()
        }

        fn wait_for_updates_at_least(&self, min_len: usize, timeout: Duration) -> bool {
            self.wait_until(&self.updates, &self.update_cv, timeout, |updates| {
                updates.len() >= min_len
            })
        }

        fn snapshot(&self) -> FileSearchSnapshot {
            self.updates
                .lock()
                .unwrap()
                .last()
                .cloned()
                .unwrap_or_default()
        }
    }

    impl SessionReporter for RecordingReporter {
        fn on_update(&self, snapshot: &FileSearchSnapshot) {
            let mut updates = self.updates.lock().unwrap();
            updates.push(snapshot.clone());
            self.update_cv.notify_all();
        }

        fn on_complete(&self) {
            {
                let mut complete_times = self.complete_times.lock().unwrap();
                complete_times.push(Instant::now());
            }
            self.complete_cv.notify_all();
        }
    }

    fn create_temp_tree(file_count: usize) -> TempDir {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..file_count {
            let path = dir.path().join(format!("file-{i:04}.txt"));
            fs::write(path, format!("contents {i}")).unwrap();
        }
        dir
    }

    #[test]
    fn session_scanned_file_count_is_monotonic_across_queries() {
        let dir = create_temp_tree(/*file_count*/ 200);
        let reporter = Arc::new(RecordingReporter::default());
        let session = create_session(
            vec![dir.path().to_path_buf()],
            FileSearchOptions::default(),
            reporter.clone(),
            /*cancel_flag*/ None,
        )
        .expect("session");

        session.update_query("file-00");
        thread::sleep(Duration::from_millis(20));
        let first_snapshot = reporter.snapshot();
        session.update_query("file-01");
        thread::sleep(Duration::from_millis(20));
        let second_snapshot = reporter.snapshot();
        let _ = reporter.wait_for_complete(Duration::from_secs(5));
        let completed_snapshot = reporter.snapshot();

        assert!(second_snapshot.scanned_file_count >= first_snapshot.scanned_file_count);
        assert!(completed_snapshot.scanned_file_count >= second_snapshot.scanned_file_count);
    }

    #[test]
    fn session_streams_updates_before_walk_complete() {
        let dir = create_temp_tree(/*file_count*/ 600);
        let reporter = Arc::new(RecordingReporter::default());
        let session = create_session(
            vec![dir.path().to_path_buf()],
            FileSearchOptions::default(),
            reporter.clone(),
            /*cancel_flag*/ None,
        )
        .expect("session");

        session.update_query("file-0");
        let completed = reporter.wait_for_complete(Duration::from_secs(5));

        assert!(completed);
        let updates = reporter.updates();
        assert!(updates.iter().any(|snapshot| !snapshot.walk_complete));
    }

    #[test]
    fn session_accepts_query_updates_after_walk_complete() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("alpha.txt"), "alpha").unwrap();
        fs::write(dir.path().join("beta.txt"), "beta").unwrap();
        let reporter = Arc::new(RecordingReporter::default());
        let session = create_session(
            vec![dir.path().to_path_buf()],
            FileSearchOptions::default(),
            reporter.clone(),
            /*cancel_flag*/ None,
        )
        .expect("session");

        session.update_query("alpha");
        assert!(reporter.wait_for_complete(Duration::from_secs(5)));
        let updates_before = reporter.updates().len();

        session.update_query("beta");
        assert!(reporter.wait_for_updates_at_least(updates_before + 1, Duration::from_secs(5),));

        let updates = reporter.updates();
        let last_update = updates.last().cloned().expect("update");
        assert!(
            last_update
                .matches
                .iter()
                .any(|file_match| file_match.path.to_string_lossy().contains("beta.txt"))
        );
    }

    #[test]
    fn session_emits_complete_when_query_changes_with_no_matches() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("alpha.txt"), "alpha").unwrap();
        fs::write(dir.path().join("beta.txt"), "beta").unwrap();
        let reporter = Arc::new(RecordingReporter::default());
        let session = create_session(
            vec![dir.path().to_path_buf()],
            FileSearchOptions::default(),
            reporter.clone(),
            /*cancel_flag*/ None,
        )
        .expect("session");

        session.update_query("asdf");
        assert!(reporter.wait_for_complete(Duration::from_secs(5)));

        let completed_snapshot = reporter.snapshot();
        assert_eq!(completed_snapshot.matches, Vec::new());
        assert_eq!(completed_snapshot.total_match_count, 0);

        reporter.clear();

        session.update_query("asdfa");
        assert!(reporter.wait_for_complete(Duration::from_secs(5)));
        assert!(!reporter.updates().is_empty());
    }

    #[test]
    fn dropping_session_does_not_cancel_siblings_with_shared_cancel_flag() {
        let root_a = create_temp_tree(/*file_count*/ 200);
        let root_b = create_temp_tree(/*file_count*/ 4_000);
        let cancel_flag = Arc::new(AtomicBool::new(false));

        let reporter_a = Arc::new(RecordingReporter::default());
        let session_a = create_session(
            vec![root_a.path().to_path_buf()],
            FileSearchOptions::default(),
            reporter_a,
            Some(cancel_flag.clone()),
        )
        .expect("session_a");

        let reporter_b = Arc::new(RecordingReporter::default());
        let session_b = create_session(
            vec![root_b.path().to_path_buf()],
            FileSearchOptions::default(),
            reporter_b.clone(),
            Some(cancel_flag),
        )
        .expect("session_b");

        session_a.update_query("file-0");
        session_b.update_query("file-1");

        thread::sleep(Duration::from_millis(5));
        drop(session_a);

        let completed = reporter_b.wait_for_complete(Duration::from_secs(5));
        assert_eq!(completed, true);
    }

    #[test]
    fn session_emits_updates_when_query_changes() {
        let dir = create_temp_tree(/*file_count*/ 200);
        let reporter = Arc::new(RecordingReporter::default());
        let session = create_session(
            vec![dir.path().to_path_buf()],
            FileSearchOptions::default(),
            reporter.clone(),
            /*cancel_flag*/ None,
        )
        .expect("session");

        session.update_query("zzzzzzzz");
        let completed = reporter.wait_for_complete(Duration::from_secs(5));
        assert!(completed);

        reporter.clear();

        session.update_query("zzzzzzzzq");
        let completed = reporter.wait_for_complete(Duration::from_secs(5));
        assert!(completed);

        let updates = reporter.updates();
        assert_eq!(updates.len(), 1);
    }

    #[test]
    fn run_returns_matches_for_query() {
        let dir = create_temp_tree(/*file_count*/ 40);
        let options = FileSearchOptions {
            limit: NonZero::new(20).unwrap(),
            exclude: Vec::new(),
            threads: NonZero::new(2).unwrap(),
            compute_indices: false,
            respect_gitignore: true,
        };
        let results = run(
            "file-000",
            vec![dir.path().to_path_buf()],
            options,
            /*cancel_flag*/ None,
        )
        .expect("run ok");

        assert!(!results.matches.is_empty());
        assert!(results.total_match_count >= results.matches.len());
        assert!(
            results
                .matches
                .iter()
                .any(|m| m.path.to_string_lossy().contains("file-0000.txt"))
        );
    }

    #[test]
    fn run_prioritizes_basename_matches_over_parent_directory_matches() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("context/deeply/nested")).unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::write(
            dir.path().join("context/deeply/nested/index.ts"),
            "export const nested = true;",
        )
        .unwrap();
        fs::write(
            dir.path().join("src/context.ts"),
            "export const direct = true;",
        )
        .unwrap();

        let results = run(
            "context",
            vec![dir.path().to_path_buf()],
            FileSearchOptions {
                limit: NonZero::new(20).unwrap(),
                exclude: Vec::new(),
                threads: NonZero::new(2).unwrap(),
                compute_indices: false,
                respect_gitignore: true,
            },
            /*cancel_flag*/ None,
        )
        .expect("run ok");

        assert_eq!(
            results.matches.first().map(|m| m.path.as_path()),
            Some(Path::new("src/context.ts"))
        );
    }

    #[test]
    fn run_empty_query_returns_initial_candidates_without_root() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::create_dir_all(dir.path().join("docs/guides")).unwrap();
        fs::write(dir.path().join("Cargo.toml"), "[package]\nname = \"demo\"").unwrap();
        fs::write(dir.path().join("README.md"), "readme").unwrap();
        fs::write(dir.path().join("src/lib.rs"), "pub fn demo() {}").unwrap();
        fs::write(dir.path().join("docs/guides/intro.md"), "intro").unwrap();

        let results = run(
            "",
            vec![dir.path().to_path_buf()],
            FileSearchOptions {
                limit: NonZero::new(20).unwrap(),
                exclude: Vec::new(),
                threads: NonZero::new(2).unwrap(),
                compute_indices: true,
                respect_gitignore: true,
            },
            /*cancel_flag*/ None,
        )
        .expect("run ok");

        assert!(
            results
                .matches
                .iter()
                .all(|m| !m.path.as_os_str().is_empty())
        );
        assert!(
            results
                .matches
                .iter()
                .any(|m| m.path == Path::new("Cargo.toml"))
        );
        assert!(
            results
                .matches
                .iter()
                .any(|m| m.path == Path::new("src") && m.match_type == MatchType::Directory)
        );
        assert!(
            results
                .matches
                .iter()
                .all(|m| m.indices.as_deref() == Some(&[]))
        );
    }

    #[test]
    fn session_empty_query_streams_initial_candidates() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("package.json"), "{}").unwrap();
        fs::write(dir.path().join("src/main.ts"), "export {}").unwrap();
        let reporter = Arc::new(RecordingReporter::default());
        let session = create_session(
            vec![dir.path().to_path_buf()],
            FileSearchOptions {
                limit: NonZero::new(20).unwrap(),
                compute_indices: true,
                ..Default::default()
            },
            reporter.clone(),
            /*cancel_flag*/ None,
        )
        .expect("session");

        session.update_query("");
        assert!(reporter.wait_for_complete(Duration::from_secs(5)));

        let snapshot = reporter.snapshot();
        assert_eq!(snapshot.query, "");
        assert!(
            snapshot
                .matches
                .iter()
                .all(|m| !m.path.as_os_str().is_empty())
        );
        assert!(
            snapshot
                .matches
                .iter()
                .any(|m| m.path == Path::new("package.json"))
        );
        assert!(
            snapshot
                .matches
                .iter()
                .any(|m| m.path == Path::new("src") && m.match_type == MatchType::Directory)
        );
    }

    #[test]
    fn run_returns_directory_matches_for_query() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("docs/guides")).unwrap();
        fs::write(dir.path().join("docs/guides/intro.md"), "intro").unwrap();
        fs::write(dir.path().join("docs/readme.md"), "readme").unwrap();

        let results = run(
            "guides",
            vec![dir.path().to_path_buf()],
            FileSearchOptions {
                limit: NonZero::new(20).unwrap(),
                exclude: Vec::new(),
                threads: NonZero::new(2).unwrap(),
                compute_indices: false,
                respect_gitignore: true,
            },
            /*cancel_flag*/ None,
        )
        .expect("run ok");

        assert!(results.matches.iter().any(|m| {
            m.path == std::path::Path::new("docs").join("guides")
                && m.match_type == MatchType::Directory
        }));
    }

    #[test]
    fn cancel_exits_run() {
        let dir = create_temp_tree(/*file_count*/ 200);
        let cancel_flag = Arc::new(AtomicBool::new(true));
        let search_dir = dir.path().to_path_buf();
        let options = FileSearchOptions {
            compute_indices: false,
            ..Default::default()
        };
        let (tx, rx) = std::sync::mpsc::channel();

        let handle = thread::spawn(move || {
            let result = run("file-", vec![search_dir], options, Some(cancel_flag));
            let _ = tx.send(result);
        });

        let result = rx
            .recv_timeout(Duration::from_secs(2))
            .expect("run should exit after cancellation");
        handle.join().unwrap();

        let results = result.expect("run ok");
        assert_eq!(results.matches, Vec::new());
        assert_eq!(results.total_match_count, 0);
    }

    /// Regression test for #3493: a parent directory's `.gitignore` with `*`
    /// must not suppress files discovered inside a child "repo" directory.
    ///
    /// The fixture intentionally omits `git init` so that no `.git` directory
    /// exists. With `require_git(true)`, the walker skips all gitignore
    /// processing, making the parent's broad ignore harmless.
    #[test]
    fn parent_gitignore_outside_repo_does_not_hide_repo_files() {
        let temp = tempfile::tempdir().unwrap();
        let parent = temp.path().join("home");
        let repo = parent.join("repo");
        fs::create_dir_all(repo.join(".vscode")).unwrap();

        fs::write(parent.join(".gitignore"), "*\n!.gitignore\n").unwrap();
        fs::write(
            repo.join(".gitignore"),
            ".vscode/*\n!.vscode/\n!.vscode/settings.json\n!package.json\n",
        )
        .unwrap();
        fs::write(repo.join("package.json"), "{ \"name\": \"demo\" }\n").unwrap();
        fs::write(repo.join(".vscode/settings.json"), "{ \"editor\": true }\n").unwrap();

        let respect_results = run(
            "package",
            vec![repo.clone()],
            FileSearchOptions {
                limit: NonZero::new(20).unwrap(),
                exclude: Vec::new(),
                threads: NonZero::new(2).unwrap(),
                compute_indices: false,
                respect_gitignore: true,
            },
            /*cancel_flag*/ None,
        )
        .expect("run ok");
        assert!(
            respect_results
                .matches
                .iter()
                .any(|m| m.path.as_path() == Path::new("package.json"))
        );

        let nested_file_results = run(
            "settings",
            vec![repo],
            FileSearchOptions {
                limit: NonZero::new(20).unwrap(),
                exclude: Vec::new(),
                threads: NonZero::new(2).unwrap(),
                compute_indices: false,
                respect_gitignore: true,
            },
            /*cancel_flag*/ None,
        )
        .expect("run ok");
        assert!(
            nested_file_results
                .matches
                .iter()
                .any(|m| m.path.as_path() == Path::new(".vscode/settings.json"))
        );
    }

    #[test]
    fn git_repo_still_respects_local_gitignore_when_enabled() {
        let temp = tempfile::tempdir().unwrap();
        let parent = temp.path().join("home");
        let repo = parent.join("repo");
        fs::create_dir_all(repo.join(".vscode")).unwrap();

        fs::write(parent.join(".gitignore"), "*\n!.gitignore\n").unwrap();
        fs::write(
            repo.join(".gitignore"),
            ".vscode/*\n!.vscode/\n!.vscode/settings.json\n!package.json\n",
        )
        .unwrap();
        fs::write(repo.join("package.json"), "{ \"name\": \"demo\" }\n").unwrap();
        fs::write(repo.join(".vscode/settings.json"), "{ \"editor\": true }\n").unwrap();
        fs::write(
            repo.join(".vscode/extensions.json"),
            "{ \"extensions\": [] }\n",
        )
        .unwrap();

        fs::create_dir_all(repo.join(".git")).unwrap();

        let package_results = run(
            "package",
            vec![repo.clone()],
            FileSearchOptions {
                limit: NonZero::new(20).unwrap(),
                exclude: Vec::new(),
                threads: NonZero::new(2).unwrap(),
                compute_indices: false,
                respect_gitignore: true,
            },
            /*cancel_flag*/ None,
        )
        .expect("run ok");
        assert!(
            package_results
                .matches
                .iter()
                .any(|m| m.path.as_path() == Path::new("package.json"))
        );

        let ignored_results = run(
            "extensions.json",
            vec![repo.clone()],
            FileSearchOptions {
                limit: NonZero::new(20).unwrap(),
                exclude: Vec::new(),
                threads: NonZero::new(2).unwrap(),
                compute_indices: false,
                respect_gitignore: true,
            },
            /*cancel_flag*/ None,
        )
        .expect("run ok");
        assert!(
            !ignored_results
                .matches
                .iter()
                .any(|m| m.path.as_path() == Path::new(".vscode/extensions.json"))
        );

        let whitelisted_results = run(
            "settings.json",
            vec![repo],
            FileSearchOptions {
                limit: NonZero::new(20).unwrap(),
                exclude: Vec::new(),
                threads: NonZero::new(2).unwrap(),
                compute_indices: false,
                respect_gitignore: true,
            },
            /*cancel_flag*/ None,
        )
        .expect("run ok");
        assert!(
            whitelisted_results
                .matches
                .iter()
                .any(|m| m.path.as_path() == Path::new(".vscode/settings.json"))
        );
    }
}
